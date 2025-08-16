import jwt, { SignOptions, JwtPayload } from 'jsonwebtoken';
import { createHash, randomBytes } from 'crypto';
import RedisClient from '../config/redis';
import Database from '../config/database';
import { generateTokenId } from '../utils/crypto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiry: Date;
  refreshTokenExpiry: Date;
  tokenId: string;
}

export interface JWTPayload extends JwtPayload {
  userId: string;
  phoneNumber: string;
  tokenId: string;
  deviceId?: string;
  sessionId?: string;
  tokenType: 'access' | 'refresh';
  channel?: 'web' | 'mobile' | 'ussd';
  deviceInfo?: {
    platform?: string;
    userAgent?: string;
    ipAddress?: string;
  };
}

export interface TokenValidationResult {
  valid: boolean;
  decoded?: JWTPayload;
  error?: string;
  needsRefresh?: boolean;
}

export interface RefreshResult {
  success: boolean;
  tokenPair?: TokenPair;
  error?: string;
}

class JWTService {
  private accessTokenSecret: string;
  private refreshTokenSecret: string;
  private redis: RedisClient;
  private database: Database;

  // Token expiry configurations
  private readonly ACCESS_TOKEN_EXPIRY = '15m';        // Short-lived access tokens
  private readonly REFRESH_TOKEN_EXPIRY = '7d';        // Long-lived refresh tokens
  private readonly REFRESH_TOKEN_LONG_EXPIRY = '30d';  // Extended for "remember me"
  
  // Redis key patterns
  private readonly REDIS_KEYS = {
    BLACKLIST: 'jwt:blacklist:',
    REFRESH_TOKEN: 'jwt:refresh:',
    USER_SESSIONS: 'jwt:sessions:',
    DEVICE_SESSION: 'jwt:device:',
    TOKEN_FAMILY: 'jwt:family:'
  };

  constructor() {
    this.accessTokenSecret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'change-access-secret-in-production';
    this.refreshTokenSecret = process.env.JWT_REFRESH_SECRET || 'change-refresh-secret-in-production';
    this.redis = RedisClient.getInstance();
    this.database = Database.getInstance();
  }

  /**
   * Generate a complete token pair (access + refresh tokens)
   */
  async generateTokenPair(
    userId: string,
    phoneNumber: string,
    deviceId?: string,
    rememberMe: boolean = false,
    deviceInfo?: JWTPayload['deviceInfo'],
    channel: 'web' | 'mobile' | 'ussd' = 'web'
  ): Promise<TokenPair> {
    const tokenId = generateTokenId();
    const sessionId = generateTokenId();
    
    // Determine expiry based on remember me preference
    const refreshExpiry = rememberMe ? this.REFRESH_TOKEN_LONG_EXPIRY : this.REFRESH_TOKEN_EXPIRY;
    
    // Create access token
    const accessTokenOptions: SignOptions = {
      expiresIn: this.ACCESS_TOKEN_EXPIRY,
      issuer: 'africhain-auth',
      audience: 'africhain-app',
      subject: userId
    };

    const accessPayload: Omit<JWTPayload, 'iat' | 'exp' | 'aud' | 'iss' | 'sub'> = {
      userId,
      phoneNumber,
      tokenId,
      deviceId,
      sessionId,
      tokenType: 'access',
      channel,
      deviceInfo
    };

    const accessToken = jwt.sign(accessPayload, this.accessTokenSecret, accessTokenOptions);

    // Create refresh token
    const refreshTokenOptions: SignOptions = {
      expiresIn: refreshExpiry,
      issuer: 'africhain-auth',
      audience: 'africhain-refresh',
      subject: userId
    };

    const refreshPayload: Omit<JWTPayload, 'iat' | 'exp' | 'aud' | 'iss' | 'sub'> = {
      userId,
      phoneNumber,
      tokenId,
      deviceId,
      sessionId,
      tokenType: 'refresh',
      channel,
      deviceInfo
    };

    const refreshToken = jwt.sign(refreshPayload, this.refreshTokenSecret, refreshTokenOptions);

    // Calculate expiry dates
    const accessTokenExpiry = new Date(Date.now() + this.parseExpiry(this.ACCESS_TOKEN_EXPIRY));
    const refreshTokenExpiry = new Date(Date.now() + this.parseExpiry(refreshExpiry));

    // Store refresh token in Redis with device association
    await this.storeRefreshToken(tokenId, refreshToken, userId, deviceId, refreshTokenExpiry);

    // Store session information
    await this.storeSessionInfo(sessionId, userId, deviceId, deviceInfo, refreshTokenExpiry);

    // Update user's active sessions
    await this.updateUserSessions(userId, sessionId, deviceId);

    return {
      accessToken,
      refreshToken,
      accessTokenExpiry,
      refreshTokenExpiry,
      tokenId
    };
  }

  /**
   * Validate an access token
   */
  async validateAccessToken(token: string): Promise<TokenValidationResult> {
    try {
      // Check if token is blacklisted
      const isBlacklisted = await this.isTokenBlacklisted(token);
      if (isBlacklisted) {
        return {
          valid: false,
          error: 'Token has been revoked'
        };
      }

      // Verify token signature and decode
      const decoded = jwt.verify(token, this.accessTokenSecret) as JWTPayload;

      // Additional validation checks
      if (decoded.tokenType !== 'access') {
        return {
          valid: false,
          error: 'Invalid token type'
        };
      }

      // Check if user session is still valid
      const sessionValid = await this.isSessionValid(decoded.sessionId, decoded.userId);
      if (!sessionValid) {
        return {
          valid: false,
          error: 'Session has been terminated'
        };
      }

      return {
        valid: true,
        decoded
      };

    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        return {
          valid: false,
          error: 'Token has expired',
          needsRefresh: true
        };
      }
      
      if (error instanceof jwt.JsonWebTokenError) {
        return {
          valid: false,
          error: 'Invalid token'
        };
      }

      return {
        valid: false,
        error: 'Token validation failed'
      };
    }
  }

  /**
   * Validate a refresh token
   */
  async validateRefreshToken(token: string): Promise<TokenValidationResult> {
    try {
      // Verify token signature and decode
      const decoded = jwt.verify(token, this.refreshTokenSecret) as JWTPayload;

      // Check token type
      if (decoded.tokenType !== 'refresh') {
        return {
          valid: false,
          error: 'Invalid token type'
        };
      }

      // Check if refresh token exists in Redis
      const storedToken = await this.getStoredRefreshToken(decoded.tokenId);
      if (!storedToken || storedToken !== token) {
        return {
          valid: false,
          error: 'Refresh token not found or invalid'
        };
      }

      // Check if session is still valid
      const sessionValid = await this.isSessionValid(decoded.sessionId, decoded.userId);
      if (!sessionValid) {
        return {
          valid: false,
          error: 'Session has been terminated'
        };
      }

      return {
        valid: true,
        decoded
      };

    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        // Clean up expired refresh token
        try {
          const expired = jwt.decode(token) as JWTPayload;
          if (expired?.tokenId) {
            await this.revokeRefreshToken(expired.tokenId);
          }
        } catch {}

        return {
          valid: false,
          error: 'Refresh token has expired'
        };
      }

      return {
        valid: false,
        error: 'Invalid refresh token'
      };
    }
  }

  /**
   * Refresh an access token using a valid refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<RefreshResult> {
    try {
      // Validate refresh token first
      const validation = await this.validateRefreshToken(refreshToken);
      if (!validation.valid || !validation.decoded) {
        return {
          success: false,
          error: validation.error || 'Invalid refresh token'
        };
      }

      const decoded = validation.decoded;

      // Generate new token pair with same session but new token ID
      const newTokenPair = await this.generateTokenPair(
        decoded.userId,
        decoded.phoneNumber,
        decoded.deviceId,
        false, // Don't extend expiry on refresh
        decoded.deviceInfo
      );

      // Revoke the old refresh token to prevent reuse
      await this.revokeRefreshToken(decoded.tokenId);

      return {
        success: true,
        tokenPair: newTokenPair
      };

    } catch (error) {
      console.error('Error refreshing access token:', error);
      return {
        success: false,
        error: 'Failed to refresh token'
      };
    }
  }

  /**
   * Revoke a token (blacklist access token and remove refresh token)
   */
  async revokeToken(accessToken: string, refreshToken?: string): Promise<boolean> {
    try {
      const promises: Promise<any>[] = [];

      // Blacklist access token
      promises.push(this.blacklistAccessToken(accessToken));

      // If refresh token provided, revoke it
      if (refreshToken) {
        try {
          const decoded = jwt.decode(refreshToken) as JWTPayload;
          if (decoded?.tokenId) {
            promises.push(this.revokeRefreshToken(decoded.tokenId));
          }
        } catch {
          // Ignore decode errors for revocation
        }
      }

      await Promise.all(promises);
      return true;

    } catch (error) {
      console.error('Error revoking tokens:', error);
      return false;
    }
  }

  /**
   * Revoke all tokens for a user (global logout)
   */
  async revokeAllUserTokens(userId: string): Promise<boolean> {
    try {
      // Get all user sessions
      const userSessions = await this.getUserSessions(userId);

      const promises: Promise<any>[] = [];

      // Revoke all refresh tokens for this user
      for (const sessionId of userSessions) {
        promises.push(this.revokeSession(sessionId));
      }

      // Clear user sessions list
      promises.push(this.clearUserSessions(userId));

      await Promise.all(promises);
      return true;

    } catch (error) {
      console.error('Error revoking all user tokens:', error);
      return false;
    }
  }

  /**
   * Get active sessions for a user
   */
  async getUserActiveSessions(userId: string): Promise<Array<{
    sessionId: string;
    deviceId?: string;
    deviceInfo?: JWTPayload['deviceInfo'];
    createdAt: Date;
    expiresAt: Date;
  }>> {
    try {
      const sessions = await this.getUserSessions(userId);
      const sessionDetails: Array<any> = [];

      for (const sessionId of sessions) {
        const sessionInfo = await this.getSessionInfo(sessionId);
        if (sessionInfo) {
          sessionDetails.push(sessionInfo);
        }
      }

      return sessionDetails;

    } catch (error) {
      console.error('Error getting user active sessions:', error);
      return [];
    }
  }

  /**
   * Revoke a specific session
   */
  async revokeSession(sessionId: string): Promise<boolean> {
    try {
      const sessionInfo = await this.getSessionInfo(sessionId);
      if (!sessionInfo) {
        return false;
      }

      // Remove session from Redis
      const redis = this.redis.getClient();
      await redis.del(`${this.REDIS_KEYS.DEVICE_SESSION}${sessionId}`);

      // Remove session from user's session list
      if (sessionInfo.userId) {
        await redis.sRem(`${this.REDIS_KEYS.USER_SESSIONS}${sessionInfo.userId}`, sessionId);
      }

      return true;

    } catch (error) {
      console.error('Error revoking session:', error);
      return false;
    }
  }

  // Private helper methods

  private parseExpiry(expiry: string): number {
    const unit = expiry.slice(-1);
    const value = parseInt(expiry.slice(0, -1));

    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      default: return 15 * 60 * 1000; // Default 15 minutes
    }
  }

  private async storeRefreshToken(
    tokenId: string,
    token: string,
    userId: string,
    deviceId?: string,
    expiresAt?: Date
  ): Promise<void> {
    const redis = this.redis.getClient();
    const key = `${this.REDIS_KEYS.REFRESH_TOKEN}${tokenId}`;
    
    const tokenData = JSON.stringify({
      token,
      userId,
      deviceId,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt?.toISOString()
    });

    const ttl = expiresAt ? Math.floor((expiresAt.getTime() - Date.now()) / 1000) : 7 * 24 * 60 * 60;
    await redis.setEx(key, ttl, tokenData);
  }

  private async getStoredRefreshToken(tokenId: string): Promise<string | null> {
    try {
      const redis = this.redis.getClient();
      const data = await redis.get(`${this.REDIS_KEYS.REFRESH_TOKEN}${tokenId}`);
      if (data) {
        const parsed = JSON.parse(data);
        return parsed.token;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async revokeRefreshToken(tokenId: string): Promise<void> {
    const redis = this.redis.getClient();
    await redis.del(`${this.REDIS_KEYS.REFRESH_TOKEN}${tokenId}`);
  }

  private async blacklistAccessToken(token: string): Promise<void> {
    try {
      const decoded = jwt.decode(token) as JWTPayload;
      if (!decoded?.exp || !decoded?.tokenId) return;

      const redis = this.redis.getClient();
      const key = `${this.REDIS_KEYS.BLACKLIST}${decoded.tokenId}`;
      const ttl = decoded.exp - Math.floor(Date.now() / 1000);

      if (ttl > 0) {
        await redis.setEx(key, ttl, 'blacklisted');
      }
    } catch {
      // Ignore errors in blacklisting
    }
  }

  private async isTokenBlacklisted(token: string): Promise<boolean> {
    try {
      const decoded = jwt.decode(token) as JWTPayload;
      if (!decoded?.tokenId) return false;

      const redis = this.redis.getClient();
      const result = await redis.get(`${this.REDIS_KEYS.BLACKLIST}${decoded.tokenId}`);
      return result !== null;
    } catch {
      return false;
    }
  }

  private async storeSessionInfo(
    sessionId: string,
    userId: string,
    deviceId?: string,
    deviceInfo?: JWTPayload['deviceInfo'],
    expiresAt?: Date
  ): Promise<void> {
    const redis = this.redis.getClient();
    const key = `${this.REDIS_KEYS.DEVICE_SESSION}${sessionId}`;
    
    const sessionData = JSON.stringify({
      sessionId,
      userId,
      deviceId,
      deviceInfo,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt?.toISOString()
    });

    const ttl = expiresAt ? Math.floor((expiresAt.getTime() - Date.now()) / 1000) : 30 * 24 * 60 * 60;
    await redis.setEx(key, ttl, sessionData);
  }

  private async getSessionInfo(sessionId: string): Promise<any> {
    try {
      const redis = this.redis.getClient();
      const data = await redis.get(`${this.REDIS_KEYS.DEVICE_SESSION}${sessionId}`);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  private async isSessionValid(sessionId?: string, userId?: string): Promise<boolean> {
    if (!sessionId || !userId) return false;
    
    try {
      const sessionInfo = await this.getSessionInfo(sessionId);
      return sessionInfo && sessionInfo.userId === userId;
    } catch {
      return false;
    }
  }

  private async updateUserSessions(userId: string, sessionId: string, deviceId?: string): Promise<void> {
    const redis = this.redis.getClient();
    const key = `${this.REDIS_KEYS.USER_SESSIONS}${userId}`;
    
    // Add session to user's active sessions set
    await redis.sAdd(key, sessionId);
    
    // Set TTL for cleanup
    await redis.expire(key, 30 * 24 * 60 * 60); // 30 days
  }

  private async getUserSessions(userId: string): Promise<string[]> {
    try {
      const redis = this.redis.getClient();
      const key = `${this.REDIS_KEYS.USER_SESSIONS}${userId}`;
      return await redis.sMembers(key);
    } catch {
      return [];
    }
  }

  private async clearUserSessions(userId: string): Promise<void> {
    const redis = this.redis.getClient();
    await redis.del(`${this.REDIS_KEYS.USER_SESSIONS}${userId}`);
  }
}

export default JWTService;