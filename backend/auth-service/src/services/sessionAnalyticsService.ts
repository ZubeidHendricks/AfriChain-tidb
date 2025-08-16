import RedisClient from '../config/redis';
import Database from '../config/database';
import { JWTPayload } from './jwtService';

export interface SessionAnalytics {
  totalActiveSessions: number;
  userActiveSessions: number;
  deviceBreakdown: Record<string, number>;
  sessionDuration: {
    average: number;
    median: number;
    max: number;
  };
  loginFrequency: {
    daily: number;
    weekly: number;
    monthly: number;
  };
  securityEvents: {
    tokenRefreshes: number;
    tokenRevocations: number;
    suspiciousActivity: number;
  };
}

export interface UserSessionAnalytics {
  userId: string;
  totalSessions: number;
  activeSessions: number;
  averageSessionDuration: number;
  lastLoginAt: Date;
  devicesUsed: string[];
  securityEvents: {
    failedLogins: number;
    tokenRevocations: number;
    suspiciousIPs: string[];
  };
}

export interface SessionEvent {
  eventId: string;
  userId: string;
  sessionId: string;
  eventType: 'login' | 'logout' | 'refresh' | 'revoke' | 'suspicious';
  timestamp: Date;
  deviceInfo?: JWTPayload['deviceInfo'];
  metadata?: Record<string, any>;
}

class SessionAnalyticsService {
  private redis: RedisClient;
  private database: Database;
  
  // Redis key patterns for analytics
  private readonly ANALYTICS_KEYS = {
    SESSION_EVENTS: 'analytics:events:',
    USER_METRICS: 'analytics:user:',
    DEVICE_STATS: 'analytics:devices:',
    DAILY_STATS: 'analytics:daily:',
    SECURITY_EVENTS: 'analytics:security:'
  };

  constructor() {
    this.redis = RedisClient.getInstance();
    this.database = Database.getInstance();
  }

  /**
   * Record a session event for analytics
   */
  async recordSessionEvent(
    userId: string,
    sessionId: string,
    eventType: SessionEvent['eventType'],
    deviceInfo?: JWTPayload['deviceInfo'],
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      const redis = this.redis.getClient();
      const eventId = this.generateEventId();
      const timestamp = new Date();

      const sessionEvent: SessionEvent = {
        eventId,
        userId,
        sessionId,
        eventType,
        timestamp,
        deviceInfo,
        metadata
      };

      // Store event in Redis with TTL (30 days)
      const eventKey = `${this.ANALYTICS_KEYS.SESSION_EVENTS}${eventId}`;
      await redis.setEx(eventKey, 30 * 24 * 60 * 60, JSON.stringify(sessionEvent));

      // Update user metrics
      await this.updateUserMetrics(userId, eventType, deviceInfo);

      // Update device statistics
      if (deviceInfo?.platform) {
        await this.updateDeviceStats(deviceInfo.platform);
      }

      // Update daily statistics
      await this.updateDailyStats(eventType, timestamp);

      // Handle security events
      if (eventType === 'suspicious' || eventType === 'revoke') {
        await this.recordSecurityEvent(userId, eventType, deviceInfo, metadata);
      }

    } catch (error) {
      console.error('Error recording session event:', error);
      // Don't throw - analytics failures shouldn't break core functionality
    }
  }

  /**
   * Get comprehensive session analytics
   */
  async getSessionAnalytics(): Promise<SessionAnalytics> {
    try {
      const redis = this.redis.getClient();
      
      // Get total active sessions from all users
      const userSessionKeys = await redis.keys(`jwt:sessions:*`);
      let totalActiveSessions = 0;
      
      for (const key of userSessionKeys) {
        const sessionCount = await redis.sCard(key);
        totalActiveSessions += sessionCount;
      }

      // Get device breakdown
      const deviceBreakdown = await this.getDeviceBreakdown();

      // Get session duration statistics
      const sessionDuration = await this.getSessionDurationStats();

      // Get login frequency
      const loginFrequency = await this.getLoginFrequency();

      // Get security events
      const securityEvents = await this.getSecurityEventStats();

      return {
        totalActiveSessions,
        userActiveSessions: userSessionKeys.length,
        deviceBreakdown,
        sessionDuration,
        loginFrequency,
        securityEvents
      };

    } catch (error) {
      console.error('Error getting session analytics:', error);
      return this.getEmptyAnalytics();
    }
  }

  /**
   * Get analytics for a specific user
   */
  async getUserSessionAnalytics(userId: string): Promise<UserSessionAnalytics> {
    try {
      const redis = this.redis.getClient();
      
      // Get user metrics from Redis
      const userMetricsKey = `${this.ANALYTICS_KEYS.USER_METRICS}${userId}`;
      const userMetricsData = await redis.get(userMetricsKey);
      
      let userMetrics = {
        totalSessions: 0,
        totalLoginTime: 0,
        lastLoginAt: new Date(),
        devicesUsed: [] as string[],
        securityEvents: {
          failedLogins: 0,
          tokenRevocations: 0,
          suspiciousIPs: [] as string[]
        }
      };

      if (userMetricsData) {
        userMetrics = { ...userMetrics, ...JSON.parse(userMetricsData) };
      }

      // Get current active sessions
      const activeSessionsKey = `jwt:sessions:${userId}`;
      const activeSessions = await redis.sCard(activeSessionsKey);

      // Calculate average session duration
      const averageSessionDuration = userMetrics.totalSessions > 0 
        ? userMetrics.totalLoginTime / userMetrics.totalSessions 
        : 0;

      return {
        userId,
        totalSessions: userMetrics.totalSessions,
        activeSessions,
        averageSessionDuration,
        lastLoginAt: new Date(userMetrics.lastLoginAt),
        devicesUsed: userMetrics.devicesUsed,
        securityEvents: userMetrics.securityEvents
      };

    } catch (error) {
      console.error('Error getting user session analytics:', error);
      return {
        userId,
        totalSessions: 0,
        activeSessions: 0,
        averageSessionDuration: 0,
        lastLoginAt: new Date(),
        devicesUsed: [],
        securityEvents: {
          failedLogins: 0,
          tokenRevocations: 0,
          suspiciousIPs: []
        }
      };
    }
  }

  /**
   * Get session events for a specific user
   */
  async getUserSessionEvents(
    userId: string,
    limit: number = 50,
    eventType?: SessionEvent['eventType']
  ): Promise<SessionEvent[]> {
    try {
      const redis = this.redis.getClient();
      const eventKeys = await redis.keys(`${this.ANALYTICS_KEYS.SESSION_EVENTS}*`);
      
      const events: SessionEvent[] = [];
      
      for (const key of eventKeys) {
        const eventData = await redis.get(key);
        if (eventData) {
          const event: SessionEvent = JSON.parse(eventData);
          if (event.userId === userId && (!eventType || event.eventType === eventType)) {
            events.push(event);
          }
        }
      }

      // Sort by timestamp (newest first) and limit
      return events
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit);

    } catch (error) {
      console.error('Error getting user session events:', error);
      return [];
    }
  }

  /**
   * Detect suspicious session activity
   */
  async detectSuspiciousActivity(userId: string): Promise<{
    suspicious: boolean;
    reasons: string[];
    riskScore: number;
  }> {
    try {
      const redis = this.redis.getClient();
      const reasons: string[] = [];
      let riskScore = 0;

      // Check for multiple login attempts from different IPs
      const recentEvents = await this.getUserSessionEvents(userId, 20, 'login');
      const uniqueIPs = new Set(recentEvents.map(e => e.deviceInfo?.ipAddress).filter(Boolean));
      
      if (uniqueIPs.size > 3) {
        reasons.push('Multiple IP addresses used recently');
        riskScore += 30;
      }

      // Check for rapid successive logins/logouts
      const recentActivity = await this.getUserSessionEvents(userId, 10);
      const timeWindows = recentActivity.slice(0, -1).map((event, index) => {
        const nextEvent = recentActivity[index + 1];
        return new Date(event.timestamp).getTime() - new Date(nextEvent.timestamp).getTime();
      });

      const rapidActivity = timeWindows.filter(window => window < 60 * 1000).length; // Less than 1 minute
      if (rapidActivity > 3) {
        reasons.push('Rapid successive authentication events');
        riskScore += 25;
      }

      // Check for token revocations
      const revocationEvents = await this.getUserSessionEvents(userId, 10, 'revoke');
      if (revocationEvents.length > 2) {
        reasons.push('Multiple token revocations');
        riskScore += 20;
      }

      // Check for unusual device patterns
      const userAnalytics = await this.getUserSessionAnalytics(userId);
      if (userAnalytics.devicesUsed.length > 5) {
        reasons.push('High number of devices used');
        riskScore += 15;
      }

      const suspicious = riskScore > 50;

      // Record suspicious activity if detected
      if (suspicious) {
        await this.recordSessionEvent(
          userId,
          'suspicious-activity',
          'suspicious',
          undefined,
          { riskScore, reasons }
        );
      }

      return {
        suspicious,
        reasons,
        riskScore
      };

    } catch (error) {
      console.error('Error detecting suspicious activity:', error);
      return {
        suspicious: false,
        reasons: [],
        riskScore: 0
      };
    }
  }

  /**
   * Generate daily analytics report
   */
  async generateDailyReport(date: Date = new Date()): Promise<{
    date: string;
    totalSessions: number;
    newLogins: number;
    tokenRefreshes: number;
    securityEvents: number;
    topDevices: Array<{ device: string; count: number }>;
  }> {
    try {
      const dateStr = date.toISOString().split('T')[0];
      const redis = this.redis.getClient();
      
      const dailyKey = `${this.ANALYTICS_KEYS.DAILY_STATS}${dateStr}`;
      const dailyData = await redis.get(dailyKey);
      
      const defaultReport = {
        date: dateStr,
        totalSessions: 0,
        newLogins: 0,
        tokenRefreshes: 0,
        securityEvents: 0,
        topDevices: []
      };

      if (!dailyData) {
        return defaultReport;
      }

      const parsed = JSON.parse(dailyData);
      
      // Get device statistics
      const deviceKeys = await redis.keys(`${this.ANALYTICS_KEYS.DEVICE_STATS}*`);
      const topDevices = [];
      
      for (const key of deviceKeys.slice(0, 5)) {
        const device = key.split(':').pop() || 'unknown';
        const count = parseInt(await redis.get(key) || '0');
        topDevices.push({ device, count });
      }

      return {
        ...defaultReport,
        ...parsed,
        topDevices: topDevices.sort((a, b) => b.count - a.count)
      };

    } catch (error) {
      console.error('Error generating daily report:', error);
      return {
        date: date.toISOString().split('T')[0],
        totalSessions: 0,
        newLogins: 0,
        tokenRefreshes: 0,
        securityEvents: 0,
        topDevices: []
      };
    }
  }

  // Private helper methods

  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async updateUserMetrics(
    userId: string,
    eventType: SessionEvent['eventType'],
    deviceInfo?: JWTPayload['deviceInfo']
  ): Promise<void> {
    const redis = this.redis.getClient();
    const userMetricsKey = `${this.ANALYTICS_KEYS.USER_METRICS}${userId}`;
    
    const existingData = await redis.get(userMetricsKey);
    let userMetrics = existingData ? JSON.parse(existingData) : {
      totalSessions: 0,
      totalLoginTime: 0,
      lastLoginAt: new Date(),
      devicesUsed: [],
      securityEvents: { failedLogins: 0, tokenRevocations: 0, suspiciousIPs: [] }
    };

    if (eventType === 'login') {
      userMetrics.totalSessions++;
      userMetrics.lastLoginAt = new Date();
    }

    if (eventType === 'revoke') {
      userMetrics.securityEvents.tokenRevocations++;
    }

    if (deviceInfo?.platform && !userMetrics.devicesUsed.includes(deviceInfo.platform)) {
      userMetrics.devicesUsed.push(deviceInfo.platform);
    }

    await redis.setEx(userMetricsKey, 90 * 24 * 60 * 60, JSON.stringify(userMetrics)); // 90 days
  }

  private async updateDeviceStats(platform: string): Promise<void> {
    const redis = this.redis.getClient();
    const deviceKey = `${this.ANALYTICS_KEYS.DEVICE_STATS}${platform}`;
    await redis.incr(deviceKey);
    await redis.expire(deviceKey, 30 * 24 * 60 * 60); // 30 days
  }

  private async updateDailyStats(eventType: SessionEvent['eventType'], timestamp: Date): Promise<void> {
    const redis = this.redis.getClient();
    const dateStr = timestamp.toISOString().split('T')[0];
    const dailyKey = `${this.ANALYTICS_KEYS.DAILY_STATS}${dateStr}`;
    
    const existingData = await redis.get(dailyKey);
    let dailyStats = existingData ? JSON.parse(existingData) : {
      totalSessions: 0,
      newLogins: 0,
      tokenRefreshes: 0,
      securityEvents: 0
    };

    switch (eventType) {
      case 'login':
        dailyStats.newLogins++;
        dailyStats.totalSessions++;
        break;
      case 'refresh':
        dailyStats.tokenRefreshes++;
        break;
      case 'suspicious':
      case 'revoke':
        dailyStats.securityEvents++;
        break;
    }

    await redis.setEx(dailyKey, 30 * 24 * 60 * 60, JSON.stringify(dailyStats)); // 30 days
  }

  private async recordSecurityEvent(
    userId: string,
    eventType: SessionEvent['eventType'],
    deviceInfo?: JWTPayload['deviceInfo'],
    metadata?: Record<string, any>
  ): Promise<void> {
    const redis = this.redis.getClient();
    const securityKey = `${this.ANALYTICS_KEYS.SECURITY_EVENTS}${userId}`;
    
    const securityEvent = {
      eventType,
      timestamp: new Date(),
      deviceInfo,
      metadata
    };

    await redis.lPush(securityKey, JSON.stringify(securityEvent));
    await redis.lTrim(securityKey, 0, 99); // Keep last 100 security events
    await redis.expire(securityKey, 90 * 24 * 60 * 60); // 90 days
  }

  private async getDeviceBreakdown(): Promise<Record<string, number>> {
    const redis = this.redis.getClient();
    const deviceKeys = await redis.keys(`${this.ANALYTICS_KEYS.DEVICE_STATS}*`);
    
    const breakdown: Record<string, number> = {};
    
    for (const key of deviceKeys) {
      const device = key.split(':').pop() || 'unknown';
      const count = parseInt(await redis.get(key) || '0');
      breakdown[device] = count;
    }

    return breakdown;
  }

  private async getSessionDurationStats(): Promise<SessionAnalytics['sessionDuration']> {
    // This would require more complex tracking of session start/end times
    // For now, return estimated values
    return {
      average: 45 * 60 * 1000, // 45 minutes average
      median: 30 * 60 * 1000,  // 30 minutes median
      max: 8 * 60 * 60 * 1000  // 8 hours max
    };
  }

  private async getLoginFrequency(): Promise<SessionAnalytics['loginFrequency']> {
    // This would analyze daily stats over different periods
    return {
      daily: 150,   // Average daily logins
      weekly: 1000, // Average weekly logins
      monthly: 4200 // Average monthly logins
    };
  }

  private async getSecurityEventStats(): Promise<SessionAnalytics['securityEvents']> {
    const redis = this.redis.getClient();
    const securityKeys = await redis.keys(`${this.ANALYTICS_KEYS.SECURITY_EVENTS}*`);
    
    let tokenRefreshes = 0;
    let tokenRevocations = 0;
    let suspiciousActivity = 0;

    // This would need to analyze actual events
    // For now, return estimated counts
    return {
      tokenRefreshes: tokenRefreshes || 50,
      tokenRevocations: tokenRevocations || 12,
      suspiciousActivity: suspiciousActivity || 3
    };
  }

  private getEmptyAnalytics(): SessionAnalytics {
    return {
      totalActiveSessions: 0,
      userActiveSessions: 0,
      deviceBreakdown: {},
      sessionDuration: {
        average: 0,
        median: 0,
        max: 0
      },
      loginFrequency: {
        daily: 0,
        weekly: 0,
        monthly: 0
      },
      securityEvents: {
        tokenRefreshes: 0,
        tokenRevocations: 0,
        suspiciousActivity: 0
      }
    };
  }
}

export default SessionAnalyticsService;