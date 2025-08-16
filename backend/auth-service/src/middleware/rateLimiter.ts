import { Request, Response, NextFunction } from 'express';
import RedisClient from '../config/redis';
import { hashPhoneNumber } from '../utils/crypto';

interface RateLimitOptions {
  windowMs: number; // Time window in milliseconds
  maxAttempts: number; // Maximum attempts per window
  message?: string;
  skipSuccessfulRequests?: boolean;
}

const defaultOptions: RateLimitOptions = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxAttempts: 3,
  message: 'Too many OTP requests. Please try again later.',
  skipSuccessfulRequests: false
};

export const createRateLimiter = (options: Partial<RateLimitOptions> = {}) => {
  const config = { ...defaultOptions, ...options };
  
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const phoneNumber = req.body.phoneNumber;
      
      if (!phoneNumber) {
        return res.status(400).json({
          success: false,
          error: 'Phone number is required'
        });
      }

      const phoneHash = hashPhoneNumber(phoneNumber);
      const redis = RedisClient.getInstance();
      
      // Get current count for this phone number
      const currentCount = await redis.getRateLimit(phoneHash);
      
      if (currentCount >= config.maxAttempts) {
        return res.status(429).json({
          success: false,
          error: config.message,
          retryAfter: Math.ceil(config.windowMs / 1000)
        });
      }

      // Increment the counter
      await redis.incrementRateLimit(phoneHash, Math.ceil(config.windowMs / 1000));
      
      // Add rate limit info to response headers
      res.set({
        'X-RateLimit-Limit': config.maxAttempts.toString(),
        'X-RateLimit-Remaining': Math.max(0, config.maxAttempts - currentCount - 1).toString(),
        'X-RateLimit-Reset': new Date(Date.now() + config.windowMs).toISOString()
      });

      next();
    } catch (error) {
      console.error('Rate limiter error:', error);
      // Don't block requests if Redis fails, but log the error
      next();
    }
  };
};

// Specific rate limiter for OTP requests (3 requests per 15 minutes)
export const otpRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxAttempts: 3,
  message: 'Too many OTP requests. Please wait 15 minutes before trying again.'
});

// General API rate limiter (more permissive)
export const apiRateLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  maxAttempts: 20,
  message: 'Too many requests. Please slow down.'
});

export { RateLimitOptions };