import MultiChannelSessionService, { MobileSession, AuthChannel } from './multiChannelSessionService';
import JWTService, { JWTPayload } from './jwtService';
import Database from '../config/database';
import RedisClient from '../config/redis';
import { hashPhoneNumber, generateTokenId } from '../utils/crypto';

export interface MobileAuthRequest {
  phoneNumber: string;
  deviceId: string;
  appVersion: string;
  platform: 'ios' | 'android';
  pushToken?: string;
  deviceInfo: {
    deviceModel?: string;
    osVersion?: string;
    appBuildNumber?: string;
    timezone?: string;
    locale?: string;
  };
}

export interface MobileAuthResponse {
  success: boolean;
  sessionId?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: Date;
  pushNotificationEnabled?: boolean;
  securityAlerts?: {
    newDeviceAlert: boolean;
    locationChangeAlert: boolean;
    suspiciousActivityAlert: boolean;
  };
  error?: string;
}

export interface PushNotificationPayload {
  type: 'security' | 'authentication' | 'session';
  title: string;
  body: string;
  data: {
    userId: string;
    deviceId?: string;
    sessionId?: string;
    eventType: string;
    timestamp: string;
    requiresAction?: boolean;
  };
}

export interface MobileSecurityEvent {
  type: 'new_device' | 'location_change' | 'suspicious_login' | 'token_refresh' | 'session_timeout';
  userId: string;
  deviceId: string;
  sessionId: string;
  metadata: {
    ipAddress?: string;
    location?: string;
    deviceInfo?: any;
    riskLevel: 'low' | 'medium' | 'high';
    timestamp: Date;
  };
}

class MobileAuthService {
  private multiChannelSession: MultiChannelSessionService;
  private jwtService: JWTService;
  private database: Database;
  private redis: RedisClient;

  // Redis key patterns for mobile-specific data
  private readonly MOBILE_KEYS = {
    DEVICE_REGISTRY: 'mobile:device:',
    PUSH_TOKENS: 'mobile:push:',
    SECURITY_EVENTS: 'mobile:security:',
    DEVICE_FINGERPRINT: 'mobile:fingerprint:',
    SESSION_METADATA: 'mobile:session:'
  };

  constructor() {
    this.multiChannelSession = new MultiChannelSessionService();
    this.jwtService = new JWTService();
    this.database = Database.getInstance();
    this.redis = RedisClient.getInstance();
  }

  /**
   * Authenticate mobile user and create session
   */
  async authenticateMobileUser(
    userId: string,
    authRequest: MobileAuthRequest,
    otpVerified: boolean = false
  ): Promise<MobileAuthResponse> {
    try {
      // Validate device registration
      const deviceRegistration = await this.validateDeviceRegistration(
        userId,
        authRequest.deviceId,
        authRequest.deviceInfo
      );

      if (!deviceRegistration.allowed) {
        return {
          success: false,
          error: deviceRegistration.reason || 'Device not authorized'
        };
      }

      // Check for security risks
      const securityCheck = await this.performSecurityCheck(userId, authRequest);
      
      if (securityCheck.riskLevel === 'high' && !otpVerified) {
        return {
          success: false,
          error: 'Additional verification required for security'
        };
      }

      // Create mobile session
      const mobileSession = await this.multiChannelSession.createChannelSession(
        userId,
        authRequest.phoneNumber,
        'mobile',
        {
          deviceId: authRequest.deviceId,
          appVersion: authRequest.appVersion,
          pushToken: authRequest.pushToken,
          deviceInfo: {
            platform: authRequest.platform,
            userAgent: `${authRequest.platform}-${authRequest.appVersion}`,
            ipAddress: 'mobile-client'
          },
          metadata: {
            appVersion: authRequest.appVersion,
            platform: authRequest.platform,
            deviceModel: authRequest.deviceInfo.deviceModel,
            osVersion: authRequest.deviceInfo.osVersion,
            registeredAt: new Date().toISOString()
          }
        }
      ) as MobileSession;

      // Generate JWT tokens for mobile
      const tokenPair = await this.jwtService.generateTokenPair(
        userId,
        authRequest.phoneNumber,
        authRequest.deviceId,
        true, // Mobile sessions are longer-lived
        {
          platform: authRequest.platform,
          userAgent: `${authRequest.platform}-${authRequest.appVersion}`,
          ipAddress: 'mobile-client'
        },
        'mobile'
      );

      // Register device and store push token
      await this.registerMobileDevice(userId, authRequest);

      // Store session metadata
      await this.storeMobileSessionMetadata(mobileSession.sessionId, authRequest);

      // Trigger security notifications if needed
      if (deviceRegistration.isNewDevice || securityCheck.riskLevel === 'medium') {
        await this.triggerSecurityNotification({
          type: deviceRegistration.isNewDevice ? 'new_device' : 'suspicious_login',
          userId,
          deviceId: authRequest.deviceId,
          sessionId: mobileSession.sessionId,
          metadata: {
            deviceInfo: authRequest.deviceInfo,
            riskLevel: securityCheck.riskLevel,
            timestamp: new Date()
          }
        });
      }

      return {
        success: true,
        sessionId: mobileSession.sessionId,
        accessToken: tokenPair.accessToken,
        refreshToken: tokenPair.refreshToken,
        expiresAt: tokenPair.accessTokenExpiry,
        pushNotificationEnabled: !!authRequest.pushToken,
        securityAlerts: {
          newDeviceAlert: deviceRegistration.isNewDevice,
          locationChangeAlert: securityCheck.locationChanged || false,
          suspiciousActivityAlert: securityCheck.riskLevel === 'medium'
        }
      };

    } catch (error) {
      console.error('Mobile authentication error:', error);
      return {
        success: false,
        error: 'Authentication failed'
      };
    }
  }

  /**
   * Refresh mobile session tokens
   */
  async refreshMobileSession(
    refreshToken: string,
    deviceId: string,
    currentAppVersion?: string
  ): Promise<MobileAuthResponse> {
    try {
      // Refresh token using JWT service
      const refreshResult = await this.jwtService.refreshAccessToken(refreshToken);

      if (!refreshResult.success || !refreshResult.tokenPair) {
        return {
          success: false,
          error: 'Failed to refresh session'
        };
      }

      // Update session metadata with new app version if provided
      if (currentAppVersion) {
        await this.updateMobileSessionVersion(deviceId, currentAppVersion);
      }

      // Trigger token refresh security event
      const decoded = require('jsonwebtoken').decode(refreshToken) as JWTPayload;
      if (decoded?.userId) {
        await this.triggerSecurityNotification({
          type: 'token_refresh',
          userId: decoded.userId,
          deviceId,
          sessionId: decoded.sessionId || '',
          metadata: {
            deviceInfo: decoded.deviceInfo,
            riskLevel: 'low',
            timestamp: new Date()
          }
        });
      }

      return {
        success: true,
        accessToken: refreshResult.tokenPair.accessToken,
        refreshToken: refreshResult.tokenPair.refreshToken,
        expiresAt: refreshResult.tokenPair.accessTokenExpiry
      };

    } catch (error) {
      console.error('Mobile session refresh error:', error);
      return {
        success: false,
        error: 'Session refresh failed'
      };
    }
  }

  /**
   * Update push notification token for device
   */
  async updatePushToken(userId: string, deviceId: string, pushToken: string): Promise<boolean> {
    try {
      const redis = this.redis.getClient();
      const pushKey = `${this.MOBILE_KEYS.PUSH_TOKENS}${userId}:${deviceId}`;
      
      await redis.setEx(pushKey, 365 * 24 * 60 * 60, JSON.stringify({
        pushToken,
        deviceId,
        updatedAt: new Date().toISOString()
      }));

      return true;

    } catch (error) {
      console.error('Error updating push token:', error);
      return false;
    }
  }

  /**
   * Get mobile devices for user
   */
  async getUserMobileDevices(userId: string): Promise<Array<{
    deviceId: string;
    platform: string;
    appVersion: string;
    lastActiveAt: Date;
    registeredAt: Date;
    pushEnabled: boolean;
  }>> {
    try {
      const devices = [];
      const sessions = await this.multiChannelSession.getUserSessions(userId);
      
      for (const session of sessions) {
        if (session.channel === 'mobile') {
          const mobileSession = session as MobileSession;
          const pushToken = await this.getPushToken(userId, mobileSession.deviceId);
          
          devices.push({
            deviceId: mobileSession.deviceId,
            platform: mobileSession.platform,
            appVersion: mobileSession.appVersion,
            lastActiveAt: mobileSession.lastActiveAt,
            registeredAt: mobileSession.createdAt,
            pushEnabled: !!pushToken
          });
        }
      }

      return devices;

    } catch (error) {
      console.error('Error getting user mobile devices:', error);
      return [];
    }
  }

  /**
   * Revoke mobile device access
   */
  async revokeMobileDevice(userId: string, deviceId: string): Promise<boolean> {
    try {
      // Get all sessions for this device
      const userSessions = await this.multiChannelSession.getUserSessions(userId);
      const deviceSessions = userSessions.filter(
        session => session.deviceId === deviceId && session.channel === 'mobile'
      );

      // Invalidate all sessions for this device
      const revokePromises = deviceSessions.map(session =>
        this.multiChannelSession.invalidateSession(session.sessionId)
      );

      await Promise.all(revokePromises);

      // Remove device registration
      await this.removeMobileDevice(userId, deviceId);

      // Trigger security notification
      await this.triggerSecurityNotification({
        type: 'new_device', // Reusing type for device removal notification
        userId,
        deviceId,
        sessionId: 'revoked',
        metadata: {
          riskLevel: 'low',
          timestamp: new Date()
        }
      });

      return true;

    } catch (error) {
      console.error('Error revoking mobile device:', error);
      return false;
    }
  }

  /**
   * Send push notification to user's devices
   */
  async sendPushNotification(
    userId: string,
    payload: PushNotificationPayload,
    targetDeviceId?: string
  ): Promise<boolean> {
    try {
      const pushTokens = targetDeviceId
        ? [await this.getPushToken(userId, targetDeviceId)].filter(Boolean)
        : await this.getAllUserPushTokens(userId);

      if (pushTokens.length === 0) {
        console.log(`No push tokens found for user ${userId}`);
        return true; // Not an error, just no tokens to send to
      }

      // In a real implementation, integrate with Firebase Cloud Messaging or similar
      console.log(`Would send push notification to ${pushTokens.length} devices:`, {
        tokens: pushTokens,
        payload
      });

      // Store notification for audit trail
      await this.storePushNotificationRecord(userId, payload, pushTokens.length);

      return true;

    } catch (error) {
      console.error('Error sending push notification:', error);
      return false;
    }
  }

  // Private helper methods

  private async validateDeviceRegistration(
    userId: string,
    deviceId: string,
    deviceInfo: any
  ): Promise<{ allowed: boolean; isNewDevice: boolean; reason?: string }> {
    try {
      const redis = this.redis.getClient();
      const deviceKey = `${this.MOBILE_KEYS.DEVICE_REGISTRY}${userId}:${deviceId}`;
      const existingDevice = await redis.get(deviceKey);

      if (!existingDevice) {
        // New device - check if user has too many devices
        const userDevices = await this.getUserMobileDevices(userId);
        if (userDevices.length >= 5) { // Max 5 devices per user
          return {
            allowed: false,
            isNewDevice: true,
            reason: 'Maximum number of devices reached'
          };
        }

        return { allowed: true, isNewDevice: true };
      }

      // Existing device - validate fingerprint
      const deviceData = JSON.parse(existingDevice);
      const fingerprintMatch = await this.validateDeviceFingerprint(deviceId, deviceInfo);

      if (!fingerprintMatch) {
        return {
          allowed: false,
          isNewDevice: false,
          reason: 'Device fingerprint mismatch'
        };
      }

      return { allowed: true, isNewDevice: false };

    } catch (error) {
      console.error('Error validating device registration:', error);
      return { allowed: false, isNewDevice: false, reason: 'Validation failed' };
    }
  }

  private async performSecurityCheck(
    userId: string,
    authRequest: MobileAuthRequest
  ): Promise<{ riskLevel: 'low' | 'medium' | 'high'; locationChanged?: boolean }> {
    try {
      // Check for rapid login attempts
      const recentLogins = await this.getRecentLoginAttempts(userId);
      if (recentLogins.length > 5) {
        return { riskLevel: 'high' };
      }

      // Check for new device patterns
      const deviceHistory = await this.getUserMobileDevices(userId);
      const isNewDeviceType = !deviceHistory.some(d => d.platform === authRequest.platform);

      if (isNewDeviceType && deviceHistory.length > 0) {
        return { riskLevel: 'medium' };
      }

      // Basic risk assessment
      return { riskLevel: 'low' };

    } catch (error) {
      console.error('Error performing security check:', error);
      return { riskLevel: 'medium' };
    }
  }

  private async registerMobileDevice(userId: string, authRequest: MobileAuthRequest): Promise<void> {
    const redis = this.redis.getClient();
    const deviceKey = `${this.MOBILE_KEYS.DEVICE_REGISTRY}${userId}:${authRequest.deviceId}`;
    
    const deviceData = {
      userId,
      deviceId: authRequest.deviceId,
      platform: authRequest.platform,
      appVersion: authRequest.appVersion,
      deviceInfo: authRequest.deviceInfo,
      registeredAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString()
    };

    await redis.setEx(deviceKey, 365 * 24 * 60 * 60, JSON.stringify(deviceData)); // 1 year

    // Store push token separately if provided
    if (authRequest.pushToken) {
      await this.updatePushToken(userId, authRequest.deviceId, authRequest.pushToken);
    }

    // Create device fingerprint
    await this.createDeviceFingerprint(authRequest.deviceId, authRequest.deviceInfo);
  }

  private async storeMobileSessionMetadata(sessionId: string, authRequest: MobileAuthRequest): Promise<void> {
    const redis = this.redis.getClient();
    const sessionKey = `${this.MOBILE_KEYS.SESSION_METADATA}${sessionId}`;
    
    const metadata = {
      sessionId,
      deviceId: authRequest.deviceId,
      platform: authRequest.platform,
      appVersion: authRequest.appVersion,
      deviceInfo: authRequest.deviceInfo,
      createdAt: new Date().toISOString()
    };

    await redis.setEx(sessionKey, 30 * 24 * 60 * 60, JSON.stringify(metadata)); // 30 days
  }

  private async triggerSecurityNotification(event: MobileSecurityEvent): Promise<void> {
    try {
      // Store security event
      await this.storeSecurityEvent(event);

      // Generate push notification payload
      const payload: PushNotificationPayload = {
        type: 'security',
        title: this.getSecurityEventTitle(event.type),
        body: this.getSecurityEventBody(event.type, event.metadata),
        data: {
          userId: event.userId,
          deviceId: event.deviceId,
          sessionId: event.sessionId,
          eventType: event.type,
          timestamp: event.metadata.timestamp.toISOString(),
          requiresAction: event.metadata.riskLevel === 'high'
        }
      };

      // Send push notification to other devices
      await this.sendPushNotification(event.userId, payload, event.deviceId);

    } catch (error) {
      console.error('Error triggering security notification:', error);
    }
  }

  private async validateDeviceFingerprint(deviceId: string, deviceInfo: any): Promise<boolean> {
    try {
      const redis = this.redis.getClient();
      const fingerprintKey = `${this.MOBILE_KEYS.DEVICE_FINGERPRINT}${deviceId}`;
      const storedFingerprint = await redis.get(fingerprintKey);

      if (!storedFingerprint) {
        return false;
      }

      const fingerprint = JSON.parse(storedFingerprint);
      
      // Compare key device characteristics
      return fingerprint.deviceModel === deviceInfo.deviceModel &&
             fingerprint.osVersion === deviceInfo.osVersion;

    } catch (error) {
      console.error('Error validating device fingerprint:', error);
      return false;
    }
  }

  private async createDeviceFingerprint(deviceId: string, deviceInfo: any): Promise<void> {
    const redis = this.redis.getClient();
    const fingerprintKey = `${this.MOBILE_KEYS.DEVICE_FINGERPRINT}${deviceId}`;
    
    const fingerprint = {
      deviceId,
      deviceModel: deviceInfo.deviceModel,
      osVersion: deviceInfo.osVersion,
      timezone: deviceInfo.timezone,
      locale: deviceInfo.locale,
      createdAt: new Date().toISOString()
    };

    await redis.setEx(fingerprintKey, 365 * 24 * 60 * 60, JSON.stringify(fingerprint));
  }

  private async getPushToken(userId: string, deviceId: string): Promise<string | null> {
    try {
      const redis = this.redis.getClient();
      const pushKey = `${this.MOBILE_KEYS.PUSH_TOKENS}${userId}:${deviceId}`;
      const data = await redis.get(pushKey);
      
      if (data) {
        const parsed = JSON.parse(data);
        return parsed.pushToken;
      }
      
      return null;

    } catch (error) {
      console.error('Error getting push token:', error);
      return null;
    }
  }

  private async getAllUserPushTokens(userId: string): Promise<string[]> {
    try {
      const redis = this.redis.getClient();
      const pattern = `${this.MOBILE_KEYS.PUSH_TOKENS}${userId}:*`;
      const keys = await redis.keys(pattern);
      
      const tokens = [];
      for (const key of keys) {
        const data = await redis.get(key);
        if (data) {
          const parsed = JSON.parse(data);
          tokens.push(parsed.pushToken);
        }
      }
      
      return tokens.filter(Boolean);

    } catch (error) {
      console.error('Error getting user push tokens:', error);
      return [];
    }
  }

  private async removeMobileDevice(userId: string, deviceId: string): Promise<void> {
    const redis = this.redis.getClient();
    
    const keysToDelete = [
      `${this.MOBILE_KEYS.DEVICE_REGISTRY}${userId}:${deviceId}`,
      `${this.MOBILE_KEYS.PUSH_TOKENS}${userId}:${deviceId}`,
      `${this.MOBILE_KEYS.DEVICE_FINGERPRINT}${deviceId}`
    ];

    await Promise.all(keysToDelete.map(key => redis.del(key)));
  }

  private async updateMobileSessionVersion(deviceId: string, appVersion: string): Promise<void> {
    // Implementation would update the session metadata with new app version
    console.log(`Updating app version for device ${deviceId} to ${appVersion}`);
  }

  private async getRecentLoginAttempts(userId: string): Promise<any[]> {
    // Implementation would return recent login attempts for security analysis
    return [];
  }

  private async storeSecurityEvent(event: MobileSecurityEvent): Promise<void> {
    const redis = this.redis.getClient();
    const eventKey = `${this.MOBILE_KEYS.SECURITY_EVENTS}${event.userId}:${Date.now()}`;
    
    await redis.setEx(eventKey, 7 * 24 * 60 * 60, JSON.stringify(event)); // 7 days
  }

  private async storePushNotificationRecord(
    userId: string,
    payload: PushNotificationPayload,
    tokenCount: number
  ): Promise<void> {
    // Implementation would store notification records for audit purposes
    console.log(`Push notification sent to ${tokenCount} devices for user ${userId}`);
  }

  private getSecurityEventTitle(eventType: string): string {
    const titles = {
      'new_device': 'New Device Login',
      'location_change': 'Login from New Location',
      'suspicious_login': 'Suspicious Login Activity',
      'token_refresh': 'Session Refreshed',
      'session_timeout': 'Session Expired'
    };
    
    return titles[eventType as keyof typeof titles] || 'Security Alert';
  }

  private getSecurityEventBody(eventType: string, metadata: any): string {
    const bodies = {
      'new_device': `A new ${metadata.deviceInfo?.platform || 'device'} device was used to access your account.`,
      'location_change': 'Your account was accessed from a new location.',
      'suspicious_login': 'Unusual login activity was detected on your account.',
      'token_refresh': 'Your session was refreshed on a mobile device.',
      'session_timeout': 'Your mobile session has expired for security.'
    };
    
    return bodies[eventType as keyof typeof bodies] || 'Security event detected on your account.';
  }
}

export default MobileAuthService;