import { describe, test, expect } from '@jest/globals';
import {
  hashPhoneNumber,
  encryptData,
  decryptData,
  generateOTP,
  hashOTP,
  verifyOTP,
  generateOTPSignature,
  verifyOTPSignature,
  generateSessionId,
  generateTokenId
} from '../../utils/crypto';

describe('Crypto Utilities', () => {
  describe('Phone Number Hashing', () => {
    test('should hash phone numbers consistently', () => {
      const phone = '+254712345678';
      const hash1 = hashPhoneNumber(phone);
      const hash2 = hashPhoneNumber(phone);
      
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA256 hex length
    });

    test('should produce different hashes for different phone numbers', () => {
      const phone1 = '+254712345678';
      const phone2 = '+254787654321';
      
      const hash1 = hashPhoneNumber(phone1);
      const hash2 = hashPhoneNumber(phone2);
      
      expect(hash1).not.toBe(hash2);
    });

    test('should handle phone number trimming', () => {
      const phone = '+254712345678';
      const phoneWithSpaces = ' +254712345678 ';
      
      const hash1 = hashPhoneNumber(phone);
      const hash2 = hashPhoneNumber(phoneWithSpaces);
      
      expect(hash1).toBe(hash2);
    });
  });

  describe('Data Encryption/Decryption', () => {
    test('should encrypt and decrypt data correctly', () => {
      const originalData = '+254712345678';
      
      const encrypted = encryptData(originalData);
      const decrypted = decryptData(encrypted);
      
      expect(decrypted).toBe(originalData);
      expect(encrypted).not.toBe(originalData);
      expect(encrypted).toContain(':'); // IV:encrypted format
    });

    test('should produce different encrypted values for same data', () => {
      const data = 'sensitive-data';
      
      const encrypted1 = encryptData(data);
      const encrypted2 = encryptData(data);
      
      expect(encrypted1).not.toBe(encrypted2); // Different IVs
      expect(decryptData(encrypted1)).toBe(data);
      expect(decryptData(encrypted2)).toBe(data);
    });
  });

  describe('OTP Generation and Verification', () => {
    test('should generate 6-digit OTP', () => {
      const otp = generateOTP();
      
      expect(otp).toMatch(/^\d{6}$/);
      expect(otp.length).toBe(6);
    });

    test('should generate different OTPs', () => {
      const otp1 = generateOTP();
      const otp2 = generateOTP();
      
      // Very unlikely to be the same (1 in 900,000 chance)
      expect(otp1).not.toBe(otp2);
    });

    test('should hash and verify OTP correctly', () => {
      const otp = '123456';
      
      const hash = hashOTP(otp);
      const isValid = verifyOTP(otp, hash);
      
      expect(isValid).toBe(true);
      expect(hash).not.toBe(otp);
    });

    test('should reject invalid OTP', () => {
      const otp = '123456';
      const wrongOtp = '654321';
      
      const hash = hashOTP(otp);
      const isValid = verifyOTP(wrongOtp, hash);
      
      expect(isValid).toBe(false);
    });
  });

  describe('OTP Signature Generation and Verification', () => {
    test('should generate and verify OTP signature correctly', () => {
      const phoneNumber = '+254712345678';
      const otp = '123456';
      const expiryTime = Date.now() + 300000; // 5 minutes
      
      const signature = generateOTPSignature(phoneNumber, otp, expiryTime);
      const isValid = verifyOTPSignature(phoneNumber, otp, expiryTime, signature);
      
      expect(isValid).toBe(true);
      expect(signature).toHaveLength(64); // SHA256 hex length
    });

    test('should reject signature with wrong phone number', () => {
      const phoneNumber = '+254712345678';
      const wrongPhone = '+254787654321';
      const otp = '123456';
      const expiryTime = Date.now() + 300000;
      
      const signature = generateOTPSignature(phoneNumber, otp, expiryTime);
      const isValid = verifyOTPSignature(wrongPhone, otp, expiryTime, signature);
      
      expect(isValid).toBe(false);
    });

    test('should reject signature with wrong OTP', () => {
      const phoneNumber = '+254712345678';
      const otp = '123456';
      const wrongOtp = '654321';
      const expiryTime = Date.now() + 300000;
      
      const signature = generateOTPSignature(phoneNumber, otp, expiryTime);
      const isValid = verifyOTPSignature(phoneNumber, wrongOtp, expiryTime, signature);
      
      expect(isValid).toBe(false);
    });

    test('should reject signature with wrong expiry time', () => {
      const phoneNumber = '+254712345678';
      const otp = '123456';
      const expiryTime = Date.now() + 300000;
      const wrongExpiry = Date.now() + 600000;
      
      const signature = generateOTPSignature(phoneNumber, otp, expiryTime);
      const isValid = verifyOTPSignature(phoneNumber, otp, wrongExpiry, signature);
      
      expect(isValid).toBe(false);
    });
  });

  describe('ID Generation', () => {
    test('should generate unique session IDs', () => {
      const id1 = generateSessionId();
      const id2 = generateSessionId();
      
      expect(id1).not.toBe(id2);
      expect(id1).toHaveLength(64); // 32 bytes as hex
      expect(id2).toHaveLength(64);
    });

    test('should generate valid UUID token IDs', () => {
      const id1 = generateTokenId();
      const id2 = generateTokenId();
      
      expect(id1).not.toBe(id2);
      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(id2).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
  });
});