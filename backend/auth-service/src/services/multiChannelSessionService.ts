import RedisClient from '../config/redis';
import JWTService from './jwtService';
import SessionAnalyticsService from './sessionAnalyticsService';
import { JWTPayload } from './jwtService';

export type AuthChannel = 'web' | 'ussd' | 'mobile';

export interface ChannelSession {
  sessionId: string;
  userId: string;
  phoneNumber: string;
  channel: AuthChannel;
  deviceId?: string;
  deviceInfo?: JWTPayload['deviceInfo'];
  createdAt: Date;
  lastActiveAt: Date;
  expiresAt: Date;
  metadata?: Record<string, any>;
}

export interface USSDSession extends ChannelSession {
  channel: 'ussd';
  ussdSessionId?: string;
  menuState?: string;
  metadata: {
    lastMenuAction?: string;
    stepCount?: number;
    networkCode?: string;
  };
}

export interface MobileSession extends ChannelSession {
  channel: 'mobile';
  appVersion?: string;
  pushToken?: string;
  metadata: {
    platform?: string;
    appBuild?: string;
    permissions?: string[];
  };
}

export interface WebSession extends ChannelSession {
  channel: 'web';
  browserInfo?: string;
  ipAddress?: string;
  metadata: {
    userAgent?: string;
    referrer?: string;
    sessionTokens?: {
      accessToken: string;
      refreshToken: string;
    };
  };
}

export interface CrossChannelEvent {
  eventId: string;
  userId: string;
  eventType: 'login' | 'logout' | 'security_alert' | 'session_expired' | 'password_change';
  sourceChannel: AuthChannel;
  targetChannels: AuthChannel[];
  timestamp: Date;
  metadata?: Record<string, any>;
}

class MultiChannelSessionService {
  private redis: RedisClient;
  private jwtService: JWTService;
  private analyticsService: SessionAnalyticsService;

  // Redis key patterns for multi-channel sessions
  private readonly SESSION_KEYS = {
    USER_SESSIONS: 'multichannel:user:sessions:',     // User's all active sessions
    CHANNEL_SESSION: 'multichannel:session:',         // Individual session data
    USSD_STATE: 'multichannel:ussd:state:',          // USSD session state
    MOBILE_PUSH: 'multichannel:mobile:push:',        // Mobile push tokens
    CROSS_CHANNEL_EVENTS: 'multichannel:events:',    // Cross-channel events
    SESSION_SYNC: 'multichannel:sync:',               // Session synchronization
  };

  constructor() {
    this.redis = RedisClient.getInstance();
    this.jwtService = new JWTService();
    this.analyticsService = new SessionAnalyticsService();
  }

  /**
   * Create a new multi-channel session
   */
  async createChannelSession(
    userId: string,
    phoneNumber: string,
    channel: AuthChannel,
    options: {
      deviceId?: string;
      deviceInfo?: JWTPayload['deviceInfo'];
      ussdSessionId?: string;
      appVersion?: string;
      pushToken?: string;
      browserInfo?: string;
      ipAddress?: string;
      metadata?: Record<string, any>;
    } = {}
  ): Promise<ChannelSession> {
    try {
      const redis = this.redis.getClient();
      const sessionId = this.generateSessionId(channel);
      const now = new Date();
      
      // Create base session
      const baseSession: ChannelSession = {
        sessionId,
        userId,
        phoneNumber,
        channel,
        deviceId: options.deviceId,
        deviceInfo: options.deviceInfo,
        createdAt: now,
        lastActiveAt: now,
        expiresAt: this.calculateSessionExpiry(channel, now),
        metadata: options.metadata || {}
      };

      // Create channel-specific session
      let channelSession: ChannelSession;
      
      switch (channel) {
        case 'ussd':
          channelSession = {
            ...baseSession,
            ussdSessionId: options.ussdSessionId,
            metadata: {
              ...baseSession.metadata,
              lastMenuAction: 'start',
              stepCount: 0,
              networkCode: options.deviceInfo?.platform
            }
          } as USSDSession;
          
          // Store USSD state separately for quick access
          if (options.ussdSessionId) {
            await redis.setEx(
              `${this.SESSION_KEYS.USSD_STATE}${options.ussdSessionId}`,
              5 * 60, // 5 minutes for USSD
              JSON.stringify({ sessionId, userId, menuState: 'main' })
            );
          }
          break;

        case 'mobile':
          channelSession = {
            ...baseSession,
            appVersion: options.appVersion,
            pushToken: options.pushToken,
            metadata: {
              ...baseSession.metadata,
              platform: options.deviceInfo?.platform,
              appBuild: options.appVersion,
              permissions: []
            }
          } as MobileSession;
          
          // Store push token for notifications
          if (options.pushToken) {
            await redis.setEx(
              `${this.SESSION_KEYS.MOBILE_PUSH}${userId}`,
              30 * 24 * 60 * 60, // 30 days
              JSON.stringify({ pushToken: options.pushToken, sessionId })
            );
          }
          break;

        case 'web':
          channelSession = {
            ...baseSession,
            browserInfo: options.browserInfo,
            ipAddress: options.ipAddress,
            metadata: {
              ...baseSession.metadata,
              userAgent: options.deviceInfo?.userAgent,
              referrer: options.metadata?.referrer
            }
          } as WebSession;
          break;

        default:
          channelSession = baseSession;
      }

      // Store session data
      await redis.setEx(
        `${this.SESSION_KEYS.CHANNEL_SESSION}${sessionId}`,
        this.getSessionTTL(channel),
        JSON.stringify(channelSession)
      );

      // Add to user's session list
      await redis.sAdd(`${this.SESSION_KEYS.USER_SESSIONS}${userId}`, sessionId);
      await redis.expire(`${this.SESSION_KEYS.USER_SESSIONS}${userId}`, 7 * 24 * 60 * 60); // 7 days

      // Record session creation event
      await this.analyticsService.recordSessionEvent(
        userId,
        sessionId,
        'login',
        options.deviceInfo,
        { channel, ...options.metadata }
      );

      // Trigger cross-channel event
      await this.publishCrossChannelEvent({
        eventId: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userId,
        eventType: 'login',
        sourceChannel: channel,
        targetChannels: ['web', 'mobile', 'ussd'].filter(c => c !== channel) as AuthChannel[],
        timestamp: now,
        metadata: { newSessionChannel: channel }
      });

      console.log(`Multi-channel session created: ${sessionId} (${channel}) for user: ${userId}`);
      return channelSession;

    } catch (error) {
      console.error('Error creating multi-channel session:', error);
      throw error;
    }
  }

  /**
   * Get session by session ID
   */
  async getChannelSession(sessionId: string): Promise<ChannelSession | null> {
    try {
      const redis = this.redis.getClient();
      const sessionData = await redis.get(`${this.SESSION_KEYS.CHANNEL_SESSION}${sessionId}`);
      
      if (!sessionData) {
        return null;
      }

      const session: ChannelSession = JSON.parse(sessionData);
      
      // Check if session has expired
      if (new Date() > new Date(session.expiresAt)) {
        await this.invalidateSession(sessionId);
        return null;
      }

      return session;

    } catch (error) {
      console.error('Error getting channel session:', error);
      return null;
    }
  }

  /**
   * Update session last activity
   */
  async updateSessionActivity(sessionId: string, metadata?: Record<string, any>): Promise<boolean> {
    try {
      const redis = this.redis.getClient();
      const session = await this.getChannelSession(sessionId);
      
      if (!session) {
        return false;
      }

      // Update last active time and metadata
      session.lastActiveAt = new Date();
      if (metadata) {
        session.metadata = { ...session.metadata, ...metadata };
      }

      // For USSD, extend timeout on activity
      const ttl = session.channel === 'ussd' ? 5 * 60 : this.getSessionTTL(session.channel);
      
      await redis.setEx(
        `${this.SESSION_KEYS.CHANNEL_SESSION}${sessionId}`,
        ttl,
        JSON.stringify(session)
      );

      return true;

    } catch (error) {
      console.error('Error updating session activity:', error);
      return false;
    }
  }

  /**
   * Get all active sessions for a user
   */
  async getUserSessions(userId: string): Promise<ChannelSession[]> {
    try {
      const redis = this.redis.getClient();
      const sessionIds = await redis.sMembers(`${this.SESSION_KEYS.USER_SESSIONS}${userId}`);
      
      const sessions: ChannelSession[] = [];
      
      for (const sessionId of sessionIds) {
        const session = await this.getChannelSession(sessionId);
        if (session) {
          sessions.push(session);
        } else {
          // Clean up invalid session ID
          await redis.sRem(`${this.SESSION_KEYS.USER_SESSIONS}${userId}`, sessionId);
        }
      }

      return sessions;

    } catch (error) {
      console.error('Error getting user sessions:', error);
      return [];
    }
  }

  /**
   * Invalidate a specific session
   */
  async invalidateSession(sessionId: string): Promise<boolean> {
    try {
      const redis = this.redis.getClient();
      const session = await this.getChannelSession(sessionId);
      
      if (!session) {
        return false;
      }

      // Remove session data
      await redis.del(`${this.SESSION_KEYS.CHANNEL_SESSION}${sessionId}`);
      await redis.sRem(`${this.SESSION_KEYS.USER_SESSIONS}${session.userId}`, sessionId);

      // Clean up channel-specific data
      switch (session.channel) {
        case 'ussd':
          const ussdSession = session as USSDSession;
          if (ussdSession.ussdSessionId) {
            await redis.del(`${this.SESSION_KEYS.USSD_STATE}${ussdSession.ussdSessionId}`);
          }
          break;

        case 'mobile':
          // Keep push token but mark session as inactive
          break;

        case 'web':
          const webSession = session as WebSession;
          if (webSession.metadata?.sessionTokens) {
            // Blacklist JWT tokens
            await this.jwtService.revokeToken(
              webSession.metadata.sessionTokens.accessToken,
              webSession.metadata.sessionTokens.refreshToken
            );
          }
          break;
      }

      // Record logout event
      await this.analyticsService.recordSessionEvent(
        session.userId,
        sessionId,
        'logout',
        session.deviceInfo,
        { channel: session.channel, reason: 'session_invalidated' }
      );

      console.log(`Session invalidated: ${sessionId} (${session.channel})`);
      return true;

    } catch (error) {
      console.error('Error invalidating session:', error);
      return false;
    }
  }

  /**
   * Invalidate all sessions for a user across all channels
   */
  async invalidateAllUserSessions(userId: string, excludeSessionId?: string): Promise<number> {
    try {
      const sessions = await this.getUserSessions(userId);
      let invalidatedCount = 0;

      for (const session of sessions) {
        if (session.sessionId !== excludeSessionId) {
          const success = await this.invalidateSession(session.sessionId);
          if (success) {
            invalidatedCount++;
          }
        }
      }

      // Trigger cross-channel logout event
      if (invalidatedCount > 0) {
        await this.publishCrossChannelEvent({
          eventId: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          userId,
          eventType: 'logout',
          sourceChannel: 'web', // Default source
          targetChannels: ['web', 'mobile', 'ussd'],
          timestamp: new Date(),
          metadata: { reason: 'logout_all', excludedSession: excludeSessionId }
        });
      }

      console.log(`Invalidated ${invalidatedCount} sessions for user: ${userId}`);
      return invalidatedCount;

    } catch (error) {
      console.error('Error invalidating all user sessions:', error);
      return 0;
    }
  }

  /**
   * Authenticate user by phone number for USSD
   */
  async authenticateByPhoneNumber(phoneNumber: string, ussdSessionId?: string): Promise<ChannelSession | null> {
    try {
      // For USSD, we don't require existing session - create one if user exists
      // This would typically verify against the users table
      const redis = this.redis.getClient();
      
      // Check if there's an existing USSD session
      if (ussdSessionId) {
        const ussdStateData = await redis.get(`${this.SESSION_KEYS.USSD_STATE}${ussdSessionId}`);
        if (ussdStateData) {
          const { sessionId } = JSON.parse(ussdStateData);
          const existingSession = await this.getChannelSession(sessionId);
          if (existingSession && existingSession.phoneNumber === phoneNumber) {
            return existingSession;
          }
        }
      }

      // For this implementation, we'll need to integrate with user lookup
      // For now, return null - this should be implemented with actual user verification
      return null;

    } catch (error) {
      console.error('Error authenticating by phone number:', error);
      return null;
    }
  }

  /**
   * Publish cross-channel event
   */
  async publishCrossChannelEvent(event: CrossChannelEvent): Promise<void> {
    try {
      const redis = this.redis.getClient();
      
      // Store event for processing
      await redis.setEx(
        `${this.SESSION_KEYS.CROSS_CHANNEL_EVENTS}${event.eventId}`,
        24 * 60 * 60, // 24 hours
        JSON.stringify(event)
      );

      // For now, just log the event
      // In production, this would trigger actual notifications/updates
      console.log(`Cross-channel event published: ${event.eventType} from ${event.sourceChannel} to [${event.targetChannels.join(', ')}]`);

    } catch (error) {
      console.error('Error publishing cross-channel event:', error);
    }
  }

  /**
   * Get USSD session state
   */
  async getUSSDState(ussdSessionId: string): Promise<{ sessionId: string; userId: string; menuState: string } | null> {
    try {
      const redis = this.redis.getClient();
      const stateData = await redis.get(`${this.SESSION_KEYS.USSD_STATE}${ussdSessionId}`);
      
      if (!stateData) {
        return null;
      }

      return JSON.parse(stateData);

    } catch (error) {
      console.error('Error getting USSD state:', error);
      return null;
    }
  }

  /**
   * Update USSD session state
   */
  async updateUSSDState(ussdSessionId: string, menuState: string, metadata?: Record<string, any>): Promise<boolean> {
    try {
      const redis = this.redis.getClient();
      const currentState = await this.getUSSDState(ussdSessionId);
      
      if (!currentState) {
        return false;
      }

      const updatedState = {
        ...currentState,
        menuState,
        metadata: { ...currentState, ...metadata }
      };

      await redis.setEx(
        `${this.SESSION_KEYS.USSD_STATE}${ussdSessionId}`,
        5 * 60, // 5 minutes
        JSON.stringify(updatedState)
      );

      // Update the main session activity
      await this.updateSessionActivity(currentState.sessionId, { menuState, ...metadata });

      return true;

    } catch (error) {
      console.error('Error updating USSD state:', error);
      return false;
    }
  }

  /**
   * Get mobile push token for user
   */
  async getMobilePushToken(userId: string): Promise<string | null> {
    try {
      const redis = this.redis.getClient();
      const pushData = await redis.get(`${this.SESSION_KEYS.MOBILE_PUSH}${userId}`);
      
      if (!pushData) {
        return null;
      }

      const { pushToken } = JSON.parse(pushData);
      return pushToken;

    } catch (error) {
      console.error('Error getting mobile push token:', error);
      return null;
    }
  }

  // Private helper methods

  private generateSessionId(channel: AuthChannel): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 9);
    return `${channel}_${timestamp}_${random}`;
  }

  private calculateSessionExpiry(channel: AuthChannel, now: Date): Date {
    const expiry = new Date(now);
    
    switch (channel) {
      case 'ussd':
        expiry.setMinutes(expiry.getMinutes() + 5); // 5 minutes for USSD
        break;
      case 'mobile':
        expiry.setDate(expiry.getDate() + 30); // 30 days for mobile
        break;
      case 'web':
        expiry.setDate(expiry.getDate() + 7); // 7 days for web
        break;
      default:
        expiry.setDate(expiry.getDate() + 1); // 1 day default
    }
    
    return expiry;
  }

  private getSessionTTL(channel: AuthChannel): number {
    switch (channel) {
      case 'ussd':
        return 5 * 60; // 5 minutes
      case 'mobile':
        return 30 * 24 * 60 * 60; // 30 days
      case 'web':
        return 7 * 24 * 60 * 60; // 7 days
      default:
        return 24 * 60 * 60; // 1 day default
    }
  }
}

export default MultiChannelSessionService;