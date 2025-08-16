import express, { Request, Response } from 'express';
import MobileAuthService, { MobileAuthRequest, PushNotificationPayload } from '../services/mobileAuthService';
import OTPService from '../services/otpService';
import { apiRateLimiter } from '../middleware/rateLimiter';
import { authenticateToken, extractDeviceInfo } from '../middleware/auth';
import { hashPhoneNumber } from '../utils/crypto';

const router = express.Router();
const mobileAuthService = new MobileAuthService();
const otpService = new OTPService();

interface MobileRegisterRequest {
  phoneNumber: string;
  deviceId: string;
  appVersion: string;
  platform: 'ios' | 'android';
  deviceInfo: {
    deviceModel?: string;
    osVersion?: string;
    appBuildNumber?: string;
    timezone?: string;
    locale?: string;
  };
}

interface MobileVerifyRequest {
  sessionId: string;
  otpCode: string;
  mobileAuth: MobileAuthRequest;
}

interface MobileResponse {
  success: boolean;
  message?: string;
  data?: any;
  error?: string;
}

/**
 * POST /mobile/register
 * Mobile app registration - sends OTP and prepares mobile session
 */
router.post('/register', apiRateLimiter, async (req: Request, res: Response) => {
  try {
    const {
      phoneNumber,
      deviceId,
      appVersion,
      platform,
      deviceInfo
    }: MobileRegisterRequest = req.body;

    // Validate required fields
    if (!phoneNumber || !deviceId || !appVersion || !platform) {
      return res.status(400).json({
        success: false,
        error: 'Phone number, device ID, app version, and platform are required'
      } as MobileResponse);
    }

    // Validate phone number format
    if (!phoneNumber.startsWith('+254') || phoneNumber.length !== 13) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number format. Use +254XXXXXXXXX'
      } as MobileResponse);
    }

    // Validate platform
    if (!['ios', 'android'].includes(platform)) {
      return res.status(400).json({
        success: false,
        error: 'Platform must be either "ios" or "android"'
      } as MobileResponse);
    }

    console.log(`Mobile registration request: ${phoneNumber} on ${platform} device ${deviceId}`);

    // Generate and send OTP
    const otpResult = await otpService.generateAndSendOTP(phoneNumber);

    if (!otpResult.success) {
      return res.status(400).json({
        success: false,
        error: otpResult.error
      } as MobileResponse);
    }

    // Return success with mobile-specific metadata
    return res.status(200).json({
      success: true,
      message: 'OTP sent to mobile device',
      data: {
        sessionId: otpResult.sessionId,
        expiresAt: otpResult.expiresAt,
        mobileMetadata: {
          platform,
          appVersion,
          deviceId,
          supportsPushNotifications: true,
          biometricAuthAvailable: platform === 'ios' // Example logic
        }
      }
    } as MobileResponse);

  } catch (error) {
    console.error('Mobile registration error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    } as MobileResponse);
  }
});

/**
 * POST /mobile/verify-otp
 * Verify OTP and create mobile authentication session
 */
router.post('/verify-otp', extractDeviceInfo, apiRateLimiter, async (req: Request, res: Response) => {
  try {
    const { sessionId, otpCode, mobileAuth }: MobileVerifyRequest = req.body;

    // Validate required fields
    if (!sessionId || !otpCode || !mobileAuth) {
      return res.status(400).json({
        success: false,
        error: 'Session ID, OTP code, and mobile auth data are required'
      } as MobileResponse);
    }

    // Validate OTP format
    if (!/^\d{6}$/.test(otpCode)) {
      return res.status(400).json({
        success: false,
        error: 'OTP must be 6 digits'
      } as MobileResponse);
    }

    console.log(`Mobile OTP verification for session: ${sessionId}`);

    // Verify OTP first
    const otpVerification = await otpService.verifyOTP(sessionId, otpCode);

    if (!otpVerification.success) {
      return res.status(400).json({
        success: false,
        error: otpVerification.error
      } as MobileResponse);
    }

    // Get verified session details
    const session = await otpService.getVerifiedSession(sessionId);
    
    if (!session) {
      return res.status(400).json({
        success: false,
        error: 'Invalid session'
      } as MobileResponse);
    }

    // Create or get user ID (simplified - would check database for existing user)
    const phoneHash = hashPhoneNumber(session.phoneNumber);
    const userId = phoneHash; // Simplified for demo

    // Authenticate mobile user
    const mobileAuthResult = await mobileAuthService.authenticateMobileUser(
      userId,
      {
        ...mobileAuth,
        phoneNumber: session.phoneNumber
      },
      true // OTP was verified
    );

    if (!mobileAuthResult.success) {
      return res.status(400).json({
        success: false,
        error: mobileAuthResult.error
      } as MobileResponse);
    }

    console.log(`Mobile authentication successful for user: ${userId}`);

    return res.status(200).json({
      success: true,
      message: 'Mobile authentication successful',
      data: {
        user: {
          id: userId,
          phoneNumber: session.phoneNumber
        },
        authentication: {
          accessToken: mobileAuthResult.accessToken,
          refreshToken: mobileAuthResult.refreshToken,
          expiresAt: mobileAuthResult.expiresAt,
          sessionId: mobileAuthResult.sessionId
        },
        mobile: {
          pushNotificationEnabled: mobileAuthResult.pushNotificationEnabled,
          securityAlerts: mobileAuthResult.securityAlerts,
          deviceRegistered: true
        }
      }
    } as MobileResponse);

  } catch (error) {
    console.error('Mobile OTP verification error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    } as MobileResponse);
  }
});

/**
 * POST /mobile/refresh-session
 * Refresh mobile session tokens
 */
router.post('/refresh-session', apiRateLimiter, async (req: Request, res: Response) => {
  try {
    const { refreshToken, deviceId, appVersion } = req.body;

    if (!refreshToken || !deviceId) {
      return res.status(400).json({
        success: false,
        error: 'Refresh token and device ID are required'
      } as MobileResponse);
    }

    console.log(`Mobile session refresh for device: ${deviceId}`);

    const refreshResult = await mobileAuthService.refreshMobileSession(
      refreshToken,
      deviceId,
      appVersion
    );

    if (!refreshResult.success) {
      return res.status(401).json({
        success: false,
        error: refreshResult.error
      } as MobileResponse);
    }

    return res.status(200).json({
      success: true,
      message: 'Mobile session refreshed successfully',
      data: {
        accessToken: refreshResult.accessToken,
        refreshToken: refreshResult.refreshToken,
        expiresAt: refreshResult.expiresAt
      }
    } as MobileResponse);

  } catch (error) {
    console.error('Mobile session refresh error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    } as MobileResponse);
  }
});

/**
 * POST /mobile/update-push-token
 * Update push notification token for device
 */
router.post('/update-push-token', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { deviceId, pushToken } = req.body;

    if (!deviceId || !pushToken) {
      return res.status(400).json({
        success: false,
        error: 'Device ID and push token are required'
      } as MobileResponse);
    }

    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      } as MobileResponse);
    }

    console.log(`Updating push token for user ${req.user.userId}, device ${deviceId}`);

    const updateResult = await mobileAuthService.updatePushToken(
      req.user.userId,
      deviceId,
      pushToken
    );

    if (!updateResult) {
      return res.status(500).json({
        success: false,
        error: 'Failed to update push token'
      } as MobileResponse);
    }

    return res.status(200).json({
      success: true,
      message: 'Push token updated successfully'
    } as MobileResponse);

  } catch (error) {
    console.error('Update push token error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    } as MobileResponse);
  }
});

/**
 * GET /mobile/devices
 * Get all mobile devices for current user
 */
router.get('/devices', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      } as MobileResponse);
    }

    console.log(`Getting mobile devices for user: ${req.user.userId}`);

    const devices = await mobileAuthService.getUserMobileDevices(req.user.userId);

    return res.status(200).json({
      success: true,
      message: 'Mobile devices retrieved successfully',
      data: {
        devices,
        totalCount: devices.length
      }
    } as MobileResponse);

  } catch (error) {
    console.error('Get mobile devices error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    } as MobileResponse);
  }
});

/**
 * DELETE /mobile/devices/:deviceId
 * Revoke access for a mobile device
 */
router.delete('/devices/:deviceId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: 'Device ID is required'
      } as MobileResponse);
    }

    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      } as MobileResponse);
    }

    console.log(`Revoking mobile device ${deviceId} for user: ${req.user.userId}`);

    const revokeResult = await mobileAuthService.revokeMobileDevice(
      req.user.userId,
      deviceId
    );

    if (!revokeResult) {
      return res.status(404).json({
        success: false,
        error: 'Device not found or already revoked'
      } as MobileResponse);
    }

    return res.status(200).json({
      success: true,
      message: 'Mobile device access revoked successfully'
    } as MobileResponse);

  } catch (error) {
    console.error('Revoke mobile device error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    } as MobileResponse);
  }
});

/**
 * POST /mobile/send-notification
 * Send push notification to user's devices (admin/test endpoint)
 */
router.post('/send-notification', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { title, body, targetDeviceId, data = {} } = req.body;

    if (!title || !body) {
      return res.status(400).json({
        success: false,
        error: 'Title and body are required'
      } as MobileResponse);
    }

    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      } as MobileResponse);
    }

    console.log(`Sending push notification to user: ${req.user.userId}`);

    const payload: PushNotificationPayload = {
      type: 'authentication',
      title,
      body,
      data: {
        userId: req.user.userId,
        eventType: 'manual_notification',
        timestamp: new Date().toISOString(),
        ...data
      }
    };

    const sendResult = await mobileAuthService.sendPushNotification(
      req.user.userId,
      payload,
      targetDeviceId
    );

    if (!sendResult) {
      return res.status(500).json({
        success: false,
        error: 'Failed to send push notification'
      } as MobileResponse);
    }

    return res.status(200).json({
      success: true,
      message: 'Push notification sent successfully'
    } as MobileResponse);

  } catch (error) {
    console.error('Send push notification error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    } as MobileResponse);
  }
});

/**
 * GET /mobile/health
 * Health check for mobile authentication service
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const healthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'mobile-auth',
      version: '1.0.0',
      features: {
        pushNotifications: true,
        deviceManagement: true,
        securityAlerts: true,
        sessionRefresh: true
      }
    };

    return res.json(healthStatus);

  } catch (error) {
    console.error('Mobile auth health check error:', error);
    return res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      service: 'mobile-auth',
      error: 'Service unavailable'
    });
  }
});

export default router;