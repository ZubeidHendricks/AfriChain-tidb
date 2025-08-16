import { v4 as uuidv4 } from 'uuid';
import Database from '../config/database';
import RedisClient from '../config/redis';
import SMSService from './smsService';
import { hashPhoneNumber, generateOTPSignature, verifyOTPSignature, verifyOTP } from '../utils/crypto';

interface OTPSession {
  id: string;
  phoneNumberHash: string;
  phoneNumber: string;
  otpHash: string;
  signature: string;
  expiresAt: Date;
  attempts: number;
  verified: boolean;
}

interface OTPGenerationResult {
  success: boolean;
  sessionId?: string;
  expiresAt?: Date;
  error?: string;
}

interface OTPVerificationResult {
  success: boolean;
  sessionId?: string;
  error?: string;
}

class OTPService {
  private smsService: SMSService;
  private readonly OTP_EXPIRY_MINUTES = 5;
  private readonly MAX_VERIFICATION_ATTEMPTS = 3;

  constructor() {
    this.smsService = new SMSService();
  }

  /**
   * Generate and send OTP to phone number
   */
  public async generateAndSendOTP(phoneNumber: string): Promise<OTPGenerationResult> {
    try {
      const phoneHash = hashPhoneNumber(phoneNumber);
      
      // Check if there's already an active OTP session
      await this.cleanupExpiredSessions(phoneHash);
      
      const existingSession = await this.getActiveSession(phoneHash);
      if (existingSession) {
        return {
          success: false,
          error: 'An OTP is already active for this phone number. Please wait before requesting a new one.'
        };
      }

      // Generate and send OTP via SMS
      const smsResult = await this.smsService.sendOTP(phoneNumber);
      
      if (!smsResult.success || !smsResult.otp || !smsResult.otpHash) {
        return {
          success: false,
          error: smsResult.error || 'Failed to send OTP'
        };
      }

      // Create OTP session
      const sessionId = uuidv4();
      const expiresAt = new Date(Date.now() + this.OTP_EXPIRY_MINUTES * 60 * 1000);
      const signature = generateOTPSignature(phoneNumber, smsResult.otp, expiresAt.getTime());

      // Store in database
      await this.storeOTPSession({
        id: sessionId,
        phoneNumberHash: phoneHash,
        phoneNumber: phoneNumber,
        otpHash: smsResult.otpHash,
        signature: signature,
        expiresAt: expiresAt,
        attempts: 0,
        verified: false
      });

      // Store in Redis for faster access
      const redis = RedisClient.getInstance();
      await redis.setOtpSession(sessionId, {
        phoneNumberHash: phoneHash,
        phoneNumber: phoneNumber,
        otpHash: smsResult.otpHash,
        signature: signature,
        expiresAt: expiresAt.toISOString(),
        attempts: 0,
        verified: false
      }, this.OTP_EXPIRY_MINUTES * 60);

      console.log(`OTP session created: ${sessionId} for ${phoneNumber}`);

      return {
        success: true,
        sessionId: sessionId,
        expiresAt: expiresAt
      };

    } catch (error) {
      console.error('Error generating OTP:', error);
      return {
        success: false,
        error: 'Internal server error'
      };
    }
  }

  /**
   * Verify OTP code
   */
  public async verifyOTP(sessionId: string, otpCode: string): Promise<OTPVerificationResult> {
    try {
      // Get session from Redis first (faster)
      const redis = RedisClient.getInstance();
      let sessionData = await redis.getOtpSession(sessionId);

      // Fallback to database if not in Redis
      if (!sessionData) {
        sessionData = await this.getSessionFromDatabase(sessionId);
        if (!sessionData) {
          return {
            success: false,
            error: 'Invalid or expired OTP session'
          };
        }
      }

      // Check if session is expired
      const expiresAt = new Date(sessionData.expiresAt);
      if (expiresAt < new Date()) {
        await this.cleanupSession(sessionId, sessionData.phoneNumberHash);
        return {
          success: false,
          error: 'OTP has expired. Please request a new one.'
        };
      }

      // Check if already verified
      if (sessionData.verified) {
        return {
          success: false,
          error: 'OTP has already been used'
        };
      }

      // Check max attempts
      if (sessionData.attempts >= this.MAX_VERIFICATION_ATTEMPTS) {
        await this.cleanupSession(sessionId, sessionData.phoneNumberHash);
        return {
          success: false,
          error: 'Maximum verification attempts exceeded. Please request a new OTP.'
        };
      }

      // Verify OTP
      const isValidOTP = verifyOTP(otpCode, sessionData.otpHash);
      
      // Increment attempts
      sessionData.attempts += 1;
      await this.updateSessionAttempts(sessionId, sessionData.attempts);

      if (!isValidOTP) {
        const remainingAttempts = this.MAX_VERIFICATION_ATTEMPTS - sessionData.attempts;
        return {
          success: false,
          error: `Invalid OTP. ${remainingAttempts} attempts remaining.`
        };
      }

      // Verify HMAC signature for additional security
      const signatureValid = verifyOTPSignature(
        sessionData.phoneNumber,
        otpCode,
        expiresAt.getTime(),
        sessionData.signature
      );

      if (!signatureValid) {
        console.error('OTP signature verification failed for session:', sessionId);
        return {
          success: false,
          error: 'Security verification failed'
        };
      }

      // Mark as verified
      await this.markSessionVerified(sessionId);
      
      console.log(`OTP verified successfully for session: ${sessionId}`);

      return {
        success: true,
        sessionId: sessionId
      };

    } catch (error) {
      console.error('Error verifying OTP:', error);
      return {
        success: false,
        error: 'Internal server error'
      };
    }
  }

  /**
   * Get active OTP session for phone number
   */
  private async getActiveSession(phoneHash: string): Promise<OTPSession | null> {
    try {
      const db = Database.getInstance();
      const connection = await db.getConnection();

      const [rows] = await connection.execute(
        'SELECT * FROM otp_sessions WHERE phone_number_hash = ? AND expires_at > NOW() AND verified = FALSE ORDER BY created_at DESC LIMIT 1',
        [phoneHash]
      );

      const sessions = rows as any[];
      return sessions.length > 0 ? sessions[0] : null;

    } catch (error) {
      console.error('Error getting active session:', error);
      return null;
    }
  }

  /**
   * Store OTP session in database
   */
  private async storeOTPSession(session: OTPSession): Promise<void> {
    const db = Database.getInstance();
    const connection = await db.getConnection();

    await connection.execute(
      'INSERT INTO otp_sessions (id, phone_number_hash, otp_hash, expires_at, attempts, verified) VALUES (?, ?, ?, ?, ?, ?)',
      [session.id, session.phoneNumberHash, session.otpHash, session.expiresAt, session.attempts, session.verified]
    );
  }

  /**
   * Get session from database
   */
  private async getSessionFromDatabase(sessionId: string): Promise<any> {
    const db = Database.getInstance();
    const connection = await db.getConnection();

    const [rows] = await connection.execute(
      'SELECT * FROM otp_sessions WHERE id = ?',
      [sessionId]
    );

    const sessions = rows as any[];
    return sessions.length > 0 ? sessions[0] : null;
  }

  /**
   * Update session attempt count
   */
  private async updateSessionAttempts(sessionId: string, attempts: number): Promise<void> {
    const db = Database.getInstance();
    const connection = await db.getConnection();

    // Update database
    await connection.execute(
      'UPDATE otp_sessions SET attempts = ? WHERE id = ?',
      [attempts, sessionId]
    );

    // Update Redis
    const redis = RedisClient.getInstance();
    const sessionData = await redis.getOtpSession(sessionId);
    if (sessionData) {
      sessionData.attempts = attempts;
      await redis.setOtpSession(sessionId, sessionData, this.OTP_EXPIRY_MINUTES * 60);
    }
  }

  /**
   * Mark session as verified
   */
  private async markSessionVerified(sessionId: string): Promise<void> {
    const db = Database.getInstance();
    const connection = await db.getConnection();

    // Update database
    await connection.execute(
      'UPDATE otp_sessions SET verified = TRUE WHERE id = ?',
      [sessionId]
    );

    // Update Redis
    const redis = RedisClient.getInstance();
    const sessionData = await redis.getOtpSession(sessionId);
    if (sessionData) {
      sessionData.verified = true;
      await redis.setOtpSession(sessionId, sessionData, this.OTP_EXPIRY_MINUTES * 60);
    }
  }

  /**
   * Cleanup expired sessions
   */
  private async cleanupExpiredSessions(phoneHash: string): Promise<void> {
    const db = Database.getInstance();
    const connection = await db.getConnection();

    await connection.execute(
      'DELETE FROM otp_sessions WHERE phone_number_hash = ? AND expires_at <= NOW()',
      [phoneHash]
    );
  }

  /**
   * Cleanup specific session
   */
  private async cleanupSession(sessionId: string, phoneHash: string): Promise<void> {
    const db = Database.getInstance();
    const connection = await db.getConnection();

    // Remove from database
    await connection.execute(
      'DELETE FROM otp_sessions WHERE id = ?',
      [sessionId]
    );

    // Remove from Redis
    const redis = RedisClient.getInstance();
    await redis.deleteOtpSession(sessionId);
  }

  /**
   * Get session details (for user account creation)
   */
  public async getVerifiedSession(sessionId: string): Promise<OTPSession | null> {
    try {
      const redis = RedisClient.getInstance();
      const sessionData = await redis.getOtpSession(sessionId);

      if (sessionData && sessionData.verified) {
        return sessionData;
      }

      // Fallback to database
      const dbSession = await this.getSessionFromDatabase(sessionId);
      if (dbSession && dbSession.verified) {
        return dbSession;
      }

      return null;

    } catch (error) {
      console.error('Error getting verified session:', error);
      return null;
    }
  }
}

export default OTPService;
export { OTPGenerationResult, OTPVerificationResult, OTPSession };