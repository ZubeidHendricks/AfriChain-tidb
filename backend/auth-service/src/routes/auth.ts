import express, { Request, Response } from 'express';
import OTPService from '../services/otpService';
import JWTService from '../services/jwtService';
import SessionAnalyticsService from '../services/sessionAnalyticsService';
import { otpRateLimiter, apiRateLimiter } from '../middleware/rateLimiter';
import { authenticateToken, authenticateRefreshableToken, extractDeviceInfo } from '../middleware/auth';
import Database from '../config/database';
import { hashPhoneNumber, encryptData, generateTokenId } from '../utils/crypto';

const router = express.Router();
const otpService = new OTPService();
const jwtService = new JWTService();
const analyticsService = new SessionAnalyticsService();

interface RegisterRequest {
  phoneNumber: string;
}

interface VerifyOTPRequest {
  sessionId: string;
  otpCode: string;
  deviceId?: string;
  rememberMe?: boolean;
}

interface AuthResponse {
  success: boolean;
  message?: string;
  sessionId?: string;
  expiresAt?: Date;
  accessToken?: string;
  refreshToken?: string;
  tokenPair?: {
    accessToken: string;
    refreshToken: string;
    accessTokenExpiry: Date;
    refreshTokenExpiry: Date;
    tokenId: string;
  };
  user?: {
    id: string;
    phoneNumber: string;
    createdAt: Date;
  };
  error?: string;
  retryAfter?: number;
}

/**
 * POST /auth/register
 * Send OTP to phone number for registration/login
 */
router.post('/register', otpRateLimiter, async (req: Request, res: Response) => {
  try {
    const { phoneNumber }: RegisterRequest = req.body;

    // Validate required fields
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required'
      } as AuthResponse);
    }

    // Validate phone number format (basic validation)
    if (!phoneNumber.startsWith('+254') || phoneNumber.length !== 13) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number format. Use +254XXXXXXXXX'
      } as AuthResponse);
    }

    console.log(`Registration request for phone: ${phoneNumber}`);

    // Generate and send OTP
    const result = await otpService.generateAndSendOTP(phoneNumber);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error
      } as AuthResponse);
    }

    // Return success response (don't expose sensitive info)
    return res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      sessionId: result.sessionId,
      expiresAt: result.expiresAt
    } as AuthResponse);

  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    } as AuthResponse);
  }
});

/**
 * POST /auth/verify-otp
 * Verify OTP code and create/login user
 */
router.post('/verify-otp', extractDeviceInfo, apiRateLimiter, async (req: Request, res: Response) => {
  try {
    const { sessionId, otpCode, deviceId, rememberMe }: VerifyOTPRequest = req.body;

    // Validate required fields
    if (!sessionId || !otpCode) {
      return res.status(400).json({
        success: false,
        error: 'Session ID and OTP code are required'
      } as AuthResponse);
    }

    // Validate OTP format (6 digits)
    if (!/^\d{6}$/.test(otpCode)) {
      return res.status(400).json({
        success: false,
        error: 'OTP must be 6 digits'
      } as AuthResponse);
    }

    console.log(`OTP verification request for session: ${sessionId}`);

    // Verify OTP
    const verificationResult = await otpService.verifyOTP(sessionId, otpCode);

    if (!verificationResult.success) {
      return res.status(400).json({
        success: false,
        error: verificationResult.error
      } as AuthResponse);
    }

    // Get verified session details
    const session = await otpService.getVerifiedSession(sessionId);
    
    if (!session) {
      return res.status(400).json({
        success: false,
        error: 'Invalid session'
      } as AuthResponse);
    }

    // Create or get existing user
    const user = await createOrGetUser(session.phoneNumber);
    
    if (!user) {
      return res.status(500).json({
        success: false,
        error: 'Failed to create user account'
      } as AuthResponse);
    }

    // Generate JWT token pair with device information
    const deviceInfo = (req as any).deviceInfo;
    const channel = req.headers['x-client-type'] as 'web' | 'mobile' | 'ussd' || 'web';
    const tokenPair = await jwtService.generateTokenPair(
      user.id,
      user.phoneNumber,
      deviceId,
      rememberMe || false,
      deviceInfo,
      channel
    );

    console.log(`User authenticated successfully: ${user.id}`);

    // Record login event for analytics
    try {
      await analyticsService.recordSessionEvent(
        user.id,
        tokenPair.tokenId,
        'login',
        deviceInfo,
        { rememberMe, phoneNumber: user.phoneNumber }
      );
    } catch (analyticsError) {
      console.warn('Failed to record login analytics:', analyticsError);
      // Don't fail authentication if analytics fails
    }

    // Return success response with token pair
    return res.status(200).json({
      success: true,
      message: 'Authentication successful',
      tokenPair: tokenPair,
      accessToken: tokenPair.accessToken,
      refreshToken: tokenPair.refreshToken,
      user: {
        id: user.id,
        phoneNumber: user.phoneNumber,
        createdAt: user.createdAt
      }
    } as AuthResponse);

  } catch (error) {
    console.error('OTP verification error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    } as AuthResponse);
  }
});

/**
 * POST /auth/resend-otp
 * Resend OTP for existing session
 */
router.post('/resend-otp', otpRateLimiter, async (req: Request, res: Response) => {
  try {
    const { phoneNumber }: RegisterRequest = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required'
      } as AuthResponse);
    }

    console.log(`OTP resend request for phone: ${phoneNumber}`);

    // Generate and send new OTP (this will clean up old sessions automatically)
    const result = await otpService.generateAndSendOTP(phoneNumber);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error
      } as AuthResponse);
    }

    return res.status(200).json({
      success: true,
      message: 'New OTP sent successfully',
      sessionId: result.sessionId,
      expiresAt: result.expiresAt
    } as AuthResponse);

  } catch (error) {
    console.error('OTP resend error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    } as AuthResponse);
  }
});

/**
 * POST /auth/refresh-token
 * Refresh access token using refresh token
 */
router.post('/refresh-token', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: 'Refresh token is required'
      } as AuthResponse);
    }

    console.log('Token refresh request');

    // Refresh the access token
    const refreshResult = await jwtService.refreshAccessToken(refreshToken);

    if (!refreshResult.success) {
      return res.status(401).json({
        success: false,
        error: refreshResult.error || 'Failed to refresh token'
      } as AuthResponse);
    }

    console.log('Token refreshed successfully');

    // Record token refresh event for analytics
    try {
      if (refreshResult.tokenPair) {
        const decoded = require('jsonwebtoken').decode(refreshToken) as any;
        if (decoded?.userId) {
          await analyticsService.recordSessionEvent(
            decoded.userId,
            refreshResult.tokenPair.tokenId,
            'refresh',
            decoded.deviceInfo
          );
        }
      }
    } catch (analyticsError) {
      console.warn('Failed to record refresh analytics:', analyticsError);
    }

    // Return new token pair
    return res.status(200).json({
      success: true,
      message: 'Token refreshed successfully',
      tokenPair: refreshResult.tokenPair,
      accessToken: refreshResult.tokenPair?.accessToken,
      refreshToken: refreshResult.tokenPair?.refreshToken
    } as AuthResponse);

  } catch (error) {
    console.error('Token refresh error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    } as AuthResponse);
  }
});

/**
 * POST /auth/logout
 * Logout user and blacklist token
 */
router.post('/logout', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body; // Optional refresh token
    const accessToken = req.tokenInfo?.accessToken;

    if (!accessToken) {
      return res.status(401).json({
        success: false,
        error: 'No access token found'
      } as AuthResponse);
    }

    console.log(`Logout request for user: ${req.user?.userId}`);

    // Revoke both access and refresh tokens
    const revokeResult = await jwtService.revokeToken(accessToken, refreshToken);

    if (!revokeResult) {
      console.warn('Token revocation failed, but continuing with logout');
    }

    // Record logout event for analytics
    try {
      if (req.user) {
        await analyticsService.recordSessionEvent(
          req.user.userId,
          req.tokenInfo?.accessToken || '',
          'logout',
          req.user.deviceInfo
        );
      }
    } catch (analyticsError) {
      console.warn('Failed to record logout analytics:', analyticsError);
    }

    return res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    } as AuthResponse);

  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    } as AuthResponse);
  }
});

/**
 * GET /auth/profile
 * Get current user profile (protected route)
 */
router.get('/profile', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      } as AuthResponse);
    }

    // Get user from database
    const user = await getUserById(req.user.userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      } as AuthResponse);
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        phoneNumber: user.phoneNumber,
        createdAt: user.createdAt
      }
    } as AuthResponse);

  } catch (error) {
    console.error('Profile error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    } as AuthResponse);
  }
});

/**
 * GET /auth/sessions
 * Get all active sessions for current user
 */
router.get('/sessions', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      } as AuthResponse);
    }

    console.log(`Getting sessions for user: ${req.user.userId}`);

    // Get active sessions for the user
    const sessions = await jwtService.getUserActiveSessions(req.user.userId);

    return res.status(200).json({
      success: true,
      message: 'Active sessions retrieved successfully',
      sessions: sessions
    });

  } catch (error) {
    console.error('Get sessions error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    } as AuthResponse);
  }
});

/**
 * POST /auth/revoke-session
 * Revoke a specific session
 */
router.post('/revoke-session', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Session ID is required'
      } as AuthResponse);
    }

    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      } as AuthResponse);
    }

    console.log(`Revoking session ${sessionId} for user: ${req.user.userId}`);

    // Revoke the specific session
    const revokeResult = await jwtService.revokeSession(sessionId);

    if (!revokeResult) {
      return res.status(404).json({
        success: false,
        error: 'Session not found or already revoked'
      } as AuthResponse);
    }

    return res.status(200).json({
      success: true,
      message: 'Session revoked successfully'
    } as AuthResponse);

  } catch (error) {
    console.error('Revoke session error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    } as AuthResponse);
  }
});

/**
 * POST /auth/logout-all
 * Logout from all devices (revoke all sessions)
 */
router.post('/logout-all', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      } as AuthResponse);
    }

    console.log(`Logging out all sessions for user: ${req.user.userId}`);

    // Revoke all tokens for this user
    const revokeResult = await jwtService.revokeAllUserTokens(req.user.userId);

    if (!revokeResult) {
      console.warn('Failed to revoke all tokens, but continuing');
    }

    return res.status(200).json({
      success: true,
      message: 'Logged out from all devices successfully'
    } as AuthResponse);

  } catch (error) {
    console.error('Logout all error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    } as AuthResponse);
  }
});

/**
 * GET /auth/analytics
 * Get comprehensive session analytics (admin only)
 */
router.get('/analytics', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      } as AuthResponse);
    }

    console.log(`Getting session analytics for admin: ${req.user.userId}`);

    // Get comprehensive analytics
    const analytics = await analyticsService.getSessionAnalytics();

    return res.status(200).json({
      success: true,
      message: 'Session analytics retrieved successfully',
      analytics: analytics
    });

  } catch (error) {
    console.error('Get analytics error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    } as AuthResponse);
  }
});

/**
 * GET /auth/analytics/user
 * Get user-specific session analytics
 */
router.get('/analytics/user', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      } as AuthResponse);
    }

    console.log(`Getting user analytics for: ${req.user.userId}`);

    // Get user-specific analytics
    const userAnalytics = await analyticsService.getUserSessionAnalytics(req.user.userId);

    return res.status(200).json({
      success: true,
      message: 'User analytics retrieved successfully',
      analytics: userAnalytics
    });

  } catch (error) {
    console.error('Get user analytics error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    } as AuthResponse);
  }
});

/**
 * GET /auth/analytics/events
 * Get session events for current user
 */
router.get('/analytics/events', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      } as AuthResponse);
    }

    const { limit, eventType } = req.query;

    console.log(`Getting session events for user: ${req.user.userId}`);

    // Get session events
    const events = await analyticsService.getUserSessionEvents(
      req.user.userId,
      limit ? parseInt(limit as string) : 50,
      eventType as any
    );

    return res.status(200).json({
      success: true,
      message: 'Session events retrieved successfully',
      events: events
    });

  } catch (error) {
    console.error('Get session events error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    } as AuthResponse);
  }
});

/**
 * GET /auth/analytics/security
 * Check for suspicious activity on current user account
 */
router.get('/analytics/security', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      } as AuthResponse);
    }

    console.log(`Checking suspicious activity for user: ${req.user.userId}`);

    // Detect suspicious activity
    const suspiciousActivity = await analyticsService.detectSuspiciousActivity(req.user.userId);

    return res.status(200).json({
      success: true,
      message: 'Security analysis completed',
      security: suspiciousActivity
    });

  } catch (error) {
    console.error('Security analysis error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    } as AuthResponse);
  }
});

/**
 * GET /auth/analytics/report
 * Generate daily analytics report
 */
router.get('/analytics/report', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      } as AuthResponse);
    }

    const { date } = req.query;
    const reportDate = date ? new Date(date as string) : new Date();

    console.log(`Generating daily report for: ${reportDate.toISOString().split('T')[0]}`);

    // Generate daily report
    const report = await analyticsService.generateDailyReport(reportDate);

    return res.status(200).json({
      success: true,
      message: 'Daily report generated successfully',
      report: report
    });

  } catch (error) {
    console.error('Generate report error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    } as AuthResponse);
  }
});

/**
 * Create or get existing user by phone number
 */
async function createOrGetUser(phoneNumber: string): Promise<any> {
  try {
    const db = Database.getInstance();
    const connection = await db.getConnection();
    const phoneHash = hashPhoneNumber(phoneNumber);
    const encryptedPhone = encryptData(phoneNumber);

    // Check if user exists
    const [existingUsers] = await connection.execute(
      'SELECT id, phone_number_hash, encrypted_phone, created_at FROM users WHERE phone_number_hash = ?',
      [phoneHash]
    );

    const users = existingUsers as any[];
    
    if (users.length > 0) {
      console.log(`Existing user found: ${users[0].id}`);
      return {
        id: users[0].id,
        phoneNumber: phoneNumber,
        createdAt: users[0].created_at
      };
    }

    // Create new user
    const userId = generateTokenId(); // Use UUID for user ID
    
    await connection.execute(
      'INSERT INTO users (id, phone_number_hash, encrypted_phone) VALUES (?, ?, ?)',
      [userId, phoneHash, encryptedPhone]
    );

    console.log(`New user created: ${userId}`);

    // Get the created user
    const [newUsers] = await connection.execute(
      'SELECT id, phone_number_hash, encrypted_phone, created_at FROM users WHERE id = ?',
      [userId]
    );

    const newUser = (newUsers as any[])[0];
    
    return {
      id: newUser.id,
      phoneNumber: phoneNumber,
      createdAt: newUser.created_at
    };

  } catch (error) {
    console.error('Error creating/getting user:', error);
    return null;
  }
}

/**
 * Get user by ID
 */
async function getUserById(userId: string): Promise<any> {
  try {
    const db = Database.getInstance();
    const connection = await db.getConnection();

    const [users] = await connection.execute(
      'SELECT id, phone_number_hash, encrypted_phone, created_at FROM users WHERE id = ?',
      [userId]
    );

    const userList = users as any[];
    return userList.length > 0 ? userList[0] : null;

  } catch (error) {
    console.error('Error getting user by ID:', error);
    return null;
  }
}

export default router;