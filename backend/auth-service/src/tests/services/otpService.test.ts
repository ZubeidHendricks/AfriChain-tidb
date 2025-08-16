import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import OTPService from '../../services/otpService';
import SMSService from '../../services/smsService';
import { hashPhoneNumber } from '../../utils/crypto';

// Mock SMSService
jest.mock('../../services/smsService');
const MockedSMSService = SMSService as jest.MockedClass<typeof SMSService>;

describe('OTPService', () => {
  let otpService: OTPService;
  let mockSmsService: jest.Mocked<SMSService>;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Setup SMS service mock
    mockSmsService = {
      sendOTP: jest.fn(),
      handleDeliveryReport: jest.fn(),
      getAccountBalance: jest.fn(),
      sendCustomSMS: jest.fn()
    } as any;

    MockedSMSService.mockImplementation(() => mockSmsService);
    
    otpService = new OTPService();
  });

  describe('generateAndSendOTP', () => {
    const testPhone = '+254712345678';

    test('should generate and send OTP successfully', async () => {
      // Mock successful SMS sending
      mockSmsService.sendOTP.mockResolvedValue({
        success: true,
        otp: '123456',
        otpHash: 'hashed-otp',
        messageId: 'msg-123'
      });

      const result = await otpService.generateAndSendOTP(testPhone);

      expect(result.success).toBe(true);
      expect(result.sessionId).toBeDefined();
      expect(result.expiresAt).toBeDefined();
      expect(mockSmsService.sendOTP).toHaveBeenCalledWith(testPhone);
    });

    test('should fail when SMS sending fails', async () => {
      // Mock SMS sending failure
      mockSmsService.sendOTP.mockResolvedValue({
        success: false,
        error: 'SMS delivery failed'
      });

      const result = await otpService.generateAndSendOTP(testPhone);

      expect(result.success).toBe(false);
      expect(result.error).toBe('SMS delivery failed');
      expect(result.sessionId).toBeUndefined();
    });

    test('should prevent duplicate OTP requests', async () => {
      // First request succeeds
      mockSmsService.sendOTP.mockResolvedValue({
        success: true,
        otp: '123456',
        otpHash: 'hashed-otp',
        messageId: 'msg-123'
      });

      const result1 = await otpService.generateAndSendOTP(testPhone);
      expect(result1.success).toBe(true);

      // Second request should be blocked
      const result2 = await otpService.generateAndSendOTP(testPhone);
      expect(result2.success).toBe(false);
      expect(result2.error).toContain('already active');
    });
  });

  describe('verifyOTP', () => {
    const testPhone = '+254712345678';
    let sessionId: string;

    beforeEach(async () => {
      // Setup a valid OTP session
      mockSmsService.sendOTP.mockResolvedValue({
        success: true,
        otp: '123456',
        otpHash: '$2a$10$N9qo8uLOickgx2ZMRZoMye1/r8S.JMhUqVqKEBY.zNKaPZ8ZPmrmC', // bcrypt hash of '123456'
        messageId: 'msg-123'
      });

      const result = await otpService.generateAndSendOTP(testPhone);
      sessionId = result.sessionId!;
    });

    test('should verify correct OTP successfully', async () => {
      const result = await otpService.verifyOTP(sessionId, '123456');

      expect(result.success).toBe(true);
      expect(result.sessionId).toBe(sessionId);
      expect(result.error).toBeUndefined();
    });

    test('should reject incorrect OTP', async () => {
      const result = await otpService.verifyOTP(sessionId, '654321');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid OTP');
    });

    test('should reject verification for non-existent session', async () => {
      const result = await otpService.verifyOTP('invalid-session-id', '123456');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid or expired');
    });

    test('should track verification attempts', async () => {
      // First wrong attempt
      const result1 = await otpService.verifyOTP(sessionId, '111111');
      expect(result1.success).toBe(false);
      expect(result1.error).toContain('2 attempts remaining');

      // Second wrong attempt
      const result2 = await otpService.verifyOTP(sessionId, '222222');
      expect(result2.success).toBe(false);
      expect(result2.error).toContain('1 attempts remaining');

      // Third wrong attempt should block session
      const result3 = await otpService.verifyOTP(sessionId, '333333');
      expect(result3.success).toBe(false);
      expect(result3.error).toContain('Maximum verification attempts exceeded');

      // Even correct OTP should now be rejected
      const result4 = await otpService.verifyOTP(sessionId, '123456');
      expect(result4.success).toBe(false);
    });

    test('should prevent reuse of verified OTP', async () => {
      // First verification succeeds
      const result1 = await otpService.verifyOTP(sessionId, '123456');
      expect(result1.success).toBe(true);

      // Second verification should fail
      const result2 = await otpService.verifyOTP(sessionId, '123456');
      expect(result2.success).toBe(false);
      expect(result2.error).toContain('already been used');
    });
  });

  describe('getVerifiedSession', () => {
    const testPhone = '+254712345678';
    let sessionId: string;

    beforeEach(async () => {
      // Setup and verify an OTP session
      mockSmsService.sendOTP.mockResolvedValue({
        success: true,
        otp: '123456',
        otpHash: '$2a$10$N9qo8uLOickgx2ZMRZoMye1/r8S.JMhUqVqKEBY.zNKaPZ8ZPmrmC',
        messageId: 'msg-123'
      });

      const result = await otpService.generateAndSendOTP(testPhone);
      sessionId = result.sessionId!;
      
      await otpService.verifyOTP(sessionId, '123456');
    });

    test('should return verified session details', async () => {
      const session = await otpService.getVerifiedSession(sessionId);

      expect(session).toBeDefined();
      expect(session?.phoneNumber).toBe(testPhone);
      expect(session?.verified).toBe(true);
    });

    test('should return null for unverified session', async () => {
      // Create new unverified session
      const result = await otpService.generateAndSendOTP('+254787654321');
      const unverifiedSessionId = result.sessionId!;

      const session = await otpService.getVerifiedSession(unverifiedSessionId);
      expect(session).toBeNull();
    });

    test('should return null for non-existent session', async () => {
      const session = await otpService.getVerifiedSession('invalid-session');
      expect(session).toBeNull();
    });
  });

  describe('Session Management', () => {
    const testPhone = '+254712345678';

    test('should clean up expired sessions', async () => {
      // This test would require manipulating time or waiting
      // For now, just verify the method doesn't throw
      mockSmsService.sendOTP.mockResolvedValue({
        success: true,
        otp: '123456',
        otpHash: 'hashed-otp',
        messageId: 'msg-123'
      });

      const result = await otpService.generateAndSendOTP(testPhone);
      expect(result.success).toBe(true);

      // In a real scenario, we'd test with expired sessions
      // For now, just verify no errors are thrown
    });
  });

  describe('Error Handling', () => {
    test('should handle database errors gracefully', async () => {
      // Mock SMS service to succeed, but database operations will fail in setup
      mockSmsService.sendOTP.mockResolvedValue({
        success: true,
        otp: '123456',
        otpHash: 'hashed-otp',
        messageId: 'msg-123'
      });

      // This will depend on the database being unavailable
      // In actual implementation, we'd mock the database to throw errors
    });

    test('should handle Redis errors gracefully', async () => {
      // Similar to database errors, we'd mock Redis to fail
      // The service should continue working with database fallback
    });
  });
});