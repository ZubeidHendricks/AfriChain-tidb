import crypto from 'crypto';
import bcrypt from 'bcryptjs';

// Environment variables for encryption
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const HASH_SECRET = process.env.HASH_SECRET || 'default-secret-change-in-production';
const IV_LENGTH = 16; // For AES, this is always 16

/**
 * Hash a phone number for consistent indexing
 */
export function hashPhoneNumber(phoneNumber: string): string {
  return crypto.createHmac('sha256', HASH_SECRET)
    .update(phoneNumber.trim())
    .digest('hex');
}

/**
 * Encrypt sensitive data like phone numbers
 */
export function encryptData(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipher('aes-256-cbc', ENCRYPTION_KEY);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt sensitive data
 */
export function decryptData(text: string): string {
  const textParts = text.split(':');
  const iv = Buffer.from(textParts.shift()!, 'hex');
  const encryptedText = textParts.join(':');
  
  const decipher = crypto.createDecipher('aes-256-cbc', ENCRYPTION_KEY);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Generate a 6-digit OTP
 */
export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Hash OTP for secure storage
 */
export function hashOTP(otp: string): string {
  return bcrypt.hashSync(otp, 10);
}

/**
 * Verify OTP against hash
 */
export function verifyOTP(otp: string, hash: string): boolean {
  return bcrypt.compareSync(otp, hash);
}

/**
 * Generate HMAC signature for OTP with expiry
 */
export function generateOTPSignature(phoneNumber: string, otp: string, expiryTime: number): string {
  const payload = `${phoneNumber}:${otp}:${expiryTime}`;
  return crypto.createHmac('sha256', HASH_SECRET)
    .update(payload)
    .digest('hex');
}

/**
 * Verify HMAC signature for OTP
 */
export function verifyOTPSignature(phoneNumber: string, otp: string, expiryTime: number, signature: string): boolean {
  const expectedSignature = generateOTPSignature(phoneNumber, otp, expiryTime);
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
}

/**
 * Generate secure random session ID
 */
export function generateSessionId(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate JWT token ID for blacklisting
 */
export function generateTokenId(): string {
  return crypto.randomUUID();
}