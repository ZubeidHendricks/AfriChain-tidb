import { beforeAll, afterAll, beforeEach } from '@jest/globals';

// Minimal test environment setup without external services
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-testing-only';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-bytes-long!!';
process.env.HASH_SECRET = 'test-hash-secret-for-testing';
process.env.AFRICASTALKING_API_KEY = 'test-api-key';
process.env.AFRICASTALKING_USERNAME = 'sandbox';
process.env.DB_NAME = 'africhain_auth_test';
process.env.REDIS_URL = 'redis://localhost:6379/1';

// Mock external services for unit tests
jest.mock('../config/database', () => ({
  getInstance: jest.fn(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    getConnection: jest.fn().mockResolvedValue({
      execute: jest.fn().mockResolvedValue([[]]),
      end: jest.fn().mockResolvedValue(undefined)
    }),
    disconnect: jest.fn().mockResolvedValue(undefined),
    initializeTables: jest.fn().mockResolvedValue(undefined)
  }))
}));

jest.mock('../config/redis', () => ({
  getInstance: jest.fn(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    getClient: jest.fn(() => ({
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      setEx: jest.fn().mockResolvedValue('OK'),
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      flushDb: jest.fn().mockResolvedValue('OK')
    })),
    disconnect: jest.fn().mockResolvedValue(undefined)
  }))
}));

console.log('Test environment setup with mocked services');