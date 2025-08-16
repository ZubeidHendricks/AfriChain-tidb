import { beforeAll, afterAll, beforeEach } from '@jest/globals';
import Database from '../config/database';
import RedisClient from '../config/redis';

// Test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-bytes-long';
process.env.HASH_SECRET = 'test-hash-secret';
process.env.AFRICASTALKING_API_KEY = 'test-api-key';
process.env.AFRICASTALKING_USERNAME = 'sandbox';
process.env.DB_NAME = 'africhain_auth_test';
process.env.REDIS_URL = 'redis://localhost:6379/1'; // Use database 1 for tests

// Global test setup
beforeAll(async () => {
  try {
    // Initialize test database
    const db = Database.getInstance();
    await db.connect();
    await db.initializeTables();

    // Initialize test Redis
    const redis = RedisClient.getInstance();
    await redis.connect();
    
    console.log('Test environment initialized');
  } catch (error) {
    console.error('Failed to initialize test environment:', error);
    throw error;
  }
});

// Clean up after each test
beforeEach(async () => {
  try {
    // Clear test database tables
    const db = Database.getInstance();
    const connection = await db.getConnection();
    
    await connection.execute('DELETE FROM otp_sessions');
    await connection.execute('DELETE FROM rate_limits');
    await connection.execute('DELETE FROM users');

    // Clear test Redis database
    const redis = RedisClient.getInstance();
    const client = redis.getClient();
    await client.flushDb();
    
  } catch (error) {
    console.warn('Test cleanup warning:', error);
  }
});

// Global test teardown
afterAll(async () => {
  try {
    // Close database connections
    const db = Database.getInstance();
    await db.disconnect();

    // Close Redis connections
    const redis = RedisClient.getInstance();
    await redis.disconnect();
    
    console.log('Test environment cleaned up');
  } catch (error) {
    console.error('Failed to cleanup test environment:', error);
  }
});