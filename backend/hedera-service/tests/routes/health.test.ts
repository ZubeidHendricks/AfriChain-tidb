/**
 * Tests for health endpoint.
 */

import request from 'supertest';
import express from 'express';
import { healthRoutes } from '../../src/routes/health';

describe('Health Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use('/health', healthRoutes);
  });

  it('should return health status', async () => {
    const response = await request(app)
      .get('/health')
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'healthy',
      services: {
        redis: 'connected',
        hedera: 'connected',
      },
    });

    expect(response.body.timestamp).toBeDefined();
    expect(response.body.version).toBeDefined();
    expect(response.body.environment).toBe('test');
  });

  it('should handle health check errors gracefully', async () => {
    // Mock Redis to fail
    const mockError = new Error('Redis connection failed');
    const { getRedisClient } = require('../../src/config/redis');
    getRedisClient.mockReturnValueOnce({
      ping: jest.fn().mockRejectedValueOnce(mockError),
    });

    const response = await request(app)
      .get('/health')
      .expect(503);

    expect(response.body).toMatchObject({
      status: 'unhealthy',
      error: 'Redis connection failed',
    });

    expect(response.body.timestamp).toBeDefined();
  });
});