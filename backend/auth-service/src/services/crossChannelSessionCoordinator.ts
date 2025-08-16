import MultiChannelSessionService, { ChannelSession, AuthChannel, CrossChannelEvent } from './multiChannelSessionService';
import MobileAuthService from './mobileAuthService';
import RedisClient from '../config/redis';
import { generateTokenId } from '../utils/crypto';

export interface CrossChannelSyncRequest {
  fromChannel: AuthChannel;
  toChannel: AuthChannel;
  userId: string;
  sessionId: string;
  metadata?: Record<string, any>;
}

export interface CrossChannelSyncResponse {
  success: boolean;
  syncedSessionId?: string;
  conflicts?: Array<{
    channel: AuthChannel;
    sessionId: string;
    conflict: string;
  }>;
  error?: string;
}

export interface ChannelSessionState {
  channel: AuthChannel;
  sessionId: string;
  userId: string;
  isActive: boolean;
  lastActiveAt: Date;
  deviceId?: string;
  metadata: Record<string, any>;
}

export interface SessionSyncPolicy {
  allowMultipleSessions: boolean;
  maxSessionsPerChannel: number;
  syncDataAcrossChannels: boolean;
  conflictResolution: 'latest_wins' | 'preserve_existing' | 'user_choice';
  autoInvalidateOnChannelSwitch: boolean;
}

export interface UserSessionOverview {
  userId: string;
  totalActiveSessions: number;
  channelBreakdown: {
    web: number;
    mobile: number;
    ussd: number;
  };
  sessions: Array<{
    sessionId: string;
    channel: AuthChannel;
    deviceId?: string;
    createdAt: Date;
    lastActiveAt: Date;
    isActive: boolean;
    platform?: string;
    appVersion?: string;
  }>;
  crossChannelEvents: Array<{
    eventType: string;
    fromChannel: AuthChannel;
    toChannel: AuthChannel;
    timestamp: Date;
    metadata: Record<string, any>;
  }>;
}

class CrossChannelSessionCoordinator {
  private multiChannelSession: MultiChannelSessionService;
  private mobileAuthService: MobileAuthService;
  private redis: RedisClient;

  // Redis key patterns for cross-channel coordination
  private readonly CROSS_CHANNEL_KEYS = {
    SYNC_LOCK: 'cross_channel:sync_lock:',
    SESSION_MAP: 'cross_channel:session_map:',
    SYNC_EVENTS: 'cross_channel:events:',
    USER_OVERVIEW: 'cross_channel:overview:',
    CONFLICT_LOG: 'cross_channel:conflicts:'
  };

  // Default session sync policy
  private readonly DEFAULT_SYNC_POLICY: SessionSyncPolicy = {
    allowMultipleSessions: true,
    maxSessionsPerChannel: 3,
    syncDataAcrossChannels: true,
    conflictResolution: 'latest_wins',
    autoInvalidateOnChannelSwitch: false
  };

  constructor() {
    this.multiChannelSession = new MultiChannelSessionService();
    this.mobileAuthService = new MobileAuthService();
    this.redis = RedisClient.getInstance();
  }

  /**
   * Synchronize session data across channels
   */
  async synchronizeChannelSessions(request: CrossChannelSyncRequest): Promise<CrossChannelSyncResponse> {
    const lockId = `${request.userId}:${Date.now()}`;
    
    try {
      // Acquire distributed lock for this user's session synchronization
      const lockAcquired = await this.acquireSyncLock(request.userId, lockId);
      if (!lockAcquired) {
        return {
          success: false,
          error: 'Another synchronization is in progress'
        };
      }

      // Get current session state for both channels
      const fromSession = await this.multiChannelSession.getChannelSession(request.sessionId);
      if (!fromSession) {
        return {
          success: false,
          error: 'Source session not found'
        };
      }

      // Get existing sessions in target channel
      const userSessions = await this.multiChannelSession.getUserSessions(request.userId);
      const targetChannelSessions = userSessions.filter(s => s.channel === request.toChannel);

      // Apply session sync policy
      const syncPolicy = await this.getUserSyncPolicy(request.userId);
      const syncResult = await this.applySyncPolicy(
        fromSession,
        targetChannelSessions,
        request,
        syncPolicy
      );

      if (!syncResult.success) {
        return syncResult;
      }

      // Create or update session in target channel
      const syncedSession = await this.createSyncedSession(fromSession, request);

      // Record cross-channel event
      await this.recordCrossChannelEvent({
        eventType: 'session_sync',
        userId: request.userId,
        fromChannel: request.fromChannel,
        toChannel: request.toChannel,
        metadata: {
          fromSessionId: request.sessionId,
          toSessionId: syncedSession.sessionId,
          syncTimestamp: new Date().toISOString(),
          ...request.metadata
        }
      });

      // Update session mapping
      await this.updateSessionMapping(request.userId, fromSession, syncedSession);

      return {
        success: true,
        syncedSessionId: syncedSession.sessionId,
        conflicts: syncResult.conflicts || []
      };

    } catch (error) {
      console.error('Cross-channel synchronization error:', error);
      return {
        success: false,
        error: 'Synchronization failed'
      };
    } finally {
      // Always release the lock
      await this.releaseSyncLock(request.userId, lockId);
    }
  }

  /**
   * Get comprehensive overview of user's sessions across all channels
   */
  async getUserSessionOverview(userId: string): Promise<UserSessionOverview> {
    try {
      // Get all user sessions
      const allSessions = await this.multiChannelSession.getUserSessions(userId);

      // Count sessions by channel
      const channelBreakdown = {
        web: allSessions.filter(s => s.channel === 'web').length,
        mobile: allSessions.filter(s => s.channel === 'mobile').length,
        ussd: allSessions.filter(s => s.channel === 'ussd').length
      };

      // Get cross-channel events
      const crossChannelEvents = await this.getUserCrossChannelEvents(userId);

      // Format session details
      const sessionDetails = allSessions.map(session => ({
        sessionId: session.sessionId,
        channel: session.channel,
        deviceId: session.deviceId,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
        isActive: this.isSessionActive(session),
        platform: session.metadata?.platform,
        appVersion: session.metadata?.appVersion
      }));

      return {
        userId,
        totalActiveSessions: sessionDetails.filter(s => s.isActive).length,
        channelBreakdown,
        sessions: sessionDetails,
        crossChannelEvents
      };

    } catch (error) {
      console.error('Error getting user session overview:', error);
      return {
        userId,
        totalActiveSessions: 0,
        channelBreakdown: { web: 0, mobile: 0, ussd: 0 },
        sessions: [],
        crossChannelEvents: []
      };
    }
  }

  /**
   * Handle automatic session cleanup when switching channels
   */
  async handleChannelSwitch(
    userId: string,
    fromChannel: AuthChannel,
    toChannel: AuthChannel,
    newSessionId: string
  ): Promise<boolean> {
    try {
      const syncPolicy = await this.getUserSyncPolicy(userId);
      
      if (!syncPolicy.autoInvalidateOnChannelSwitch) {
        return true; // No automatic cleanup needed
      }

      // Get sessions in the previous channel
      const userSessions = await this.multiChannelSession.getUserSessions(userId);
      const fromChannelSessions = userSessions.filter(s => s.channel === fromChannel);

      // Invalidate old sessions in the previous channel
      const invalidationPromises = fromChannelSessions.map(session =>
        this.multiChannelSession.invalidateSession(session.sessionId)
      );

      await Promise.all(invalidationPromises);

      // Record channel switch event
      await this.recordCrossChannelEvent({
        eventType: 'channel_switch',
        userId,
        fromChannel,
        toChannel,
        metadata: {
          newSessionId,
          invalidatedSessions: fromChannelSessions.length,
          timestamp: new Date().toISOString()
        }
      });

      return true;

    } catch (error) {
      console.error('Error handling channel switch:', error);
      return false;
    }
  }

  /**
   * Detect and resolve session conflicts across channels
   */
  async detectAndResolveConflicts(userId: string): Promise<Array<{
    conflict: string;
    affectedSessions: string[];
    resolution: string;
    resolved: boolean;
  }>> {
    try {
      const conflicts = [];
      const userSessions = await this.multiChannelSession.getUserSessions(userId);
      const syncPolicy = await this.getUserSyncPolicy(userId);

      // Check for too many sessions per channel
      const channelCounts = this.groupSessionsByChannel(userSessions);
      
      for (const [channel, sessions] of Object.entries(channelCounts)) {
        if (sessions.length > syncPolicy.maxSessionsPerChannel) {
          const conflict = {
            conflict: `Too many ${channel} sessions (${sessions.length}/${syncPolicy.maxSessionsPerChannel})`,
            affectedSessions: sessions.map(s => s.sessionId),
            resolution: '',
            resolved: false
          };

          // Apply conflict resolution
          if (syncPolicy.conflictResolution === 'latest_wins') {
            // Keep only the most recent sessions
            const sortedSessions = sessions.sort((a, b) => 
              b.lastActiveAt.getTime() - a.lastActiveAt.getTime()
            );
            
            const sessionsToRemove = sortedSessions.slice(syncPolicy.maxSessionsPerChannel);
            
            for (const session of sessionsToRemove) {
              await this.multiChannelSession.invalidateSession(session.sessionId);
            }

            conflict.resolution = `Removed ${sessionsToRemove.length} oldest sessions`;
            conflict.resolved = true;
          }

          conflicts.push(conflict);
        }
      }

      // Check for data inconsistencies across channels
      const dataConflicts = await this.detectDataInconsistencies(userSessions);
      conflicts.push(...dataConflicts);

      // Log conflicts for audit
      if (conflicts.length > 0) {
        await this.logConflictResolution(userId, conflicts);
      }

      return conflicts;

    } catch (error) {
      console.error('Error detecting session conflicts:', error);
      return [];
    }
  }

  /**
   * Broadcast session event to all user's active sessions
   */
  async broadcastToAllChannels(
    userId: string,
    event: {
      type: string;
      data: Record<string, any>;
      excludeSessionId?: string;
    }
  ): Promise<boolean> {
    try {
      const userSessions = await this.multiChannelSession.getUserSessions(userId);
      const activeSessions = userSessions.filter(s => 
        this.isSessionActive(s) && s.sessionId !== event.excludeSessionId
      );

      const broadcastPromises = activeSessions.map(async session => {
        switch (session.channel) {
          case 'mobile':
            // Send push notification for mobile sessions
            if (session.deviceId) {
              return this.mobileAuthService.sendPushNotification(userId, {
                type: 'session',
                title: 'Account Activity',
                body: this.formatEventMessage(event.type, event.data),
                data: {
                  userId,
                  deviceId: session.deviceId,
                  sessionId: session.sessionId,
                  eventType: event.type,
                  timestamp: new Date().toISOString(),
                  ...event.data
                }
              });
            }
            break;

          case 'web':
            // For web sessions, store event for next request
            await this.storeWebSessionEvent(session.sessionId, event);
            break;

          case 'ussd':
            // USSD sessions are short-lived, skip broadcasting
            break;
        }
      });

      await Promise.all(broadcastPromises);
      return true;

    } catch (error) {
      console.error('Error broadcasting to all channels:', error);
      return false;
    }
  }

  /**
   * Clean up expired cross-channel data
   */
  async cleanupExpiredCrossChannelData(): Promise<void> {
    try {
      const redis = this.redis.getClient();
      const now = Date.now();
      const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days

      // Clean up old cross-channel events
      const eventKeys = await redis.keys(`${this.CROSS_CHANNEL_KEYS.SYNC_EVENTS}*`);
      
      for (const key of eventKeys) {
        const events = await redis.lRange(key, 0, -1);
        const validEvents = events.filter(eventStr => {
          try {
            const event = JSON.parse(eventStr);
            return (now - new Date(event.timestamp).getTime()) < maxAge;
          } catch {
            return false;
          }
        });

        if (validEvents.length < events.length) {
          await redis.del(key);
          if (validEvents.length > 0) {
            await redis.lPush(key, ...validEvents);
            await redis.expire(key, 30 * 24 * 60 * 60); // 30 days
          }
        }
      }

      // Clean up old session mappings
      const mappingKeys = await redis.keys(`${this.CROSS_CHANNEL_KEYS.SESSION_MAP}*`);
      
      for (const key of mappingKeys) {
        const mappingData = await redis.get(key);
        if (mappingData) {
          try {
            const mapping = JSON.parse(mappingData);
            if ((now - new Date(mapping.lastUpdated).getTime()) > maxAge) {
              await redis.del(key);
            }
          } catch {
            await redis.del(key);
          }
        }
      }

      console.log(`Cleaned up ${eventKeys.length + mappingKeys.length} expired cross-channel data entries`);

    } catch (error) {
      console.error('Error cleaning up expired cross-channel data:', error);
    }
  }

  // Private helper methods

  private async acquireSyncLock(userId: string, lockId: string): Promise<boolean> {
    try {
      const redis = this.redis.getClient();
      const lockKey = `${this.CROSS_CHANNEL_KEYS.SYNC_LOCK}${userId}`;
      const result = await redis.setNX(lockKey, lockId);
      
      if (result) {
        await redis.expire(lockKey, 30); // 30 second lock timeout
        return true;
      }
      
      return false;

    } catch (error) {
      console.error('Error acquiring sync lock:', error);
      return false;
    }
  }

  private async releaseSyncLock(userId: string, lockId: string): Promise<void> {
    try {
      const redis = this.redis.getClient();
      const lockKey = `${this.CROSS_CHANNEL_KEYS.SYNC_LOCK}${userId}`;
      
      // Only release if we own the lock
      const currentLock = await redis.get(lockKey);
      if (currentLock === lockId) {
        await redis.del(lockKey);
      }

    } catch (error) {
      console.error('Error releasing sync lock:', error);
    }
  }

  private async getUserSyncPolicy(userId: string): Promise<SessionSyncPolicy> {
    // For now, return default policy. In a real implementation,
    // this would fetch user-specific or admin-configured policies
    return this.DEFAULT_SYNC_POLICY;
  }

  private async applySyncPolicy(
    fromSession: ChannelSession,
    targetChannelSessions: ChannelSession[],
    request: CrossChannelSyncRequest,
    policy: SessionSyncPolicy
  ): Promise<CrossChannelSyncResponse> {
    
    if (!policy.allowMultipleSessions && targetChannelSessions.length > 0) {
      return {
        success: false,
        error: 'Multiple sessions not allowed in target channel'
      };
    }

    if (targetChannelSessions.length >= policy.maxSessionsPerChannel) {
      const conflicts = targetChannelSessions.map(session => ({
        channel: session.channel,
        sessionId: session.sessionId,
        conflict: 'Maximum sessions exceeded'
      }));

      if (policy.conflictResolution === 'latest_wins') {
        // Remove oldest sessions
        const sortedSessions = targetChannelSessions.sort((a, b) => 
          a.lastActiveAt.getTime() - b.lastActiveAt.getTime()
        );
        
        const sessionsToRemove = sortedSessions.slice(0, 1);
        for (const session of sessionsToRemove) {
          await this.multiChannelSession.invalidateSession(session.sessionId);
        }
      } else {
        return {
          success: false,
          conflicts,
          error: 'Session limit exceeded'
        };
      }
    }

    return { success: true };
  }

  private async createSyncedSession(
    fromSession: ChannelSession,
    request: CrossChannelSyncRequest
  ): Promise<ChannelSession> {
    
    const syncedSession = await this.multiChannelSession.createChannelSession(
      request.userId,
      fromSession.phoneNumber,
      request.toChannel,
      {
        deviceId: fromSession.deviceId,
        deviceInfo: fromSession.metadata?.deviceInfo,
        metadata: {
          ...fromSession.metadata,
          syncedFrom: request.fromChannel,
          syncedAt: new Date().toISOString(),
          ...request.metadata
        }
      }
    );

    return syncedSession;
  }

  private async recordCrossChannelEvent(event: CrossChannelEvent): Promise<void> {
    const redis = this.redis.getClient();
    const eventKey = `${this.CROSS_CHANNEL_KEYS.SYNC_EVENTS}${event.userId}`;
    
    const eventData = JSON.stringify({
      ...event,
      timestamp: new Date()
    });

    await redis.lPush(eventKey, eventData);
    await redis.lTrim(eventKey, 0, 99); // Keep last 100 events
    await redis.expire(eventKey, 30 * 24 * 60 * 60); // 30 days
  }

  private async updateSessionMapping(
    userId: string,
    fromSession: ChannelSession,
    toSession: ChannelSession
  ): Promise<void> {
    const redis = this.redis.getClient();
    const mappingKey = `${this.CROSS_CHANNEL_KEYS.SESSION_MAP}${userId}`;
    
    const mapping = {
      userId,
      sessionMappings: [
        {
          fromChannel: fromSession.channel,
          fromSessionId: fromSession.sessionId,
          toChannel: toSession.channel,
          toSessionId: toSession.sessionId,
          createdAt: new Date().toISOString()
        }
      ],
      lastUpdated: new Date().toISOString()
    };

    await redis.setEx(mappingKey, 30 * 24 * 60 * 60, JSON.stringify(mapping));
  }

  private async getUserCrossChannelEvents(userId: string): Promise<Array<any>> {
    try {
      const redis = this.redis.getClient();
      const eventKey = `${this.CROSS_CHANNEL_KEYS.SYNC_EVENTS}${userId}`;
      const events = await redis.lRange(eventKey, 0, 49); // Last 50 events
      
      return events.map(eventStr => {
        try {
          return JSON.parse(eventStr);
        } catch {
          return null;
        }
      }).filter(Boolean);

    } catch (error) {
      console.error('Error getting cross-channel events:', error);
      return [];
    }
  }

  private isSessionActive(session: ChannelSession): boolean {
    const now = Date.now();
    const lastActive = session.lastActiveAt.getTime();
    const timeout = session.channel === 'ussd' ? 5 * 60 * 1000 : 30 * 60 * 1000; // 5 min for USSD, 30 min for others
    
    return (now - lastActive) < timeout;
  }

  private groupSessionsByChannel(sessions: ChannelSession[]): Record<string, ChannelSession[]> {
    return sessions.reduce((groups, session) => {
      const channel = session.channel;
      if (!groups[channel]) {
        groups[channel] = [];
      }
      groups[channel].push(session);
      return groups;
    }, {} as Record<string, ChannelSession[]>);
  }

  private async detectDataInconsistencies(sessions: ChannelSession[]): Promise<Array<any>> {
    // Implementation would check for data inconsistencies across channels
    // such as different phone numbers, user IDs, etc.
    return [];
  }

  private async logConflictResolution(userId: string, conflicts: Array<any>): Promise<void> {
    const redis = this.redis.getClient();
    const conflictKey = `${this.CROSS_CHANNEL_KEYS.CONFLICT_LOG}${userId}`;
    
    const logEntry = {
      userId,
      conflicts,
      timestamp: new Date().toISOString(),
      resolved: conflicts.filter(c => c.resolved).length
    };

    await redis.lPush(conflictKey, JSON.stringify(logEntry));
    await redis.lTrim(conflictKey, 0, 99); // Keep last 100 conflict logs
    await redis.expire(conflictKey, 30 * 24 * 60 * 60); // 30 days
  }

  private formatEventMessage(eventType: string, data: Record<string, any>): string {
    const messages = {
      'session_sync': 'Your session was synchronized across devices',
      'channel_switch': 'You switched to a different app or device',
      'security_alert': 'Security event detected on your account',
      'session_expired': 'Your session has expired'
    };
    
    return messages[eventType as keyof typeof messages] || 'Account activity detected';
  }

  private async storeWebSessionEvent(sessionId: string, event: any): Promise<void> {
    // Implementation would store event for web sessions to be retrieved on next request
    console.log(`Storing web session event for ${sessionId}:`, event);
  }
}

export default CrossChannelSessionCoordinator;