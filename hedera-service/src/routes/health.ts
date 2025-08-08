import { Router, Request, Response } from 'express';
import { getRedisClient } from '../config/redis';
import { checkHederaConnection } from '../config/hedera';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    // Check Redis connection
    const redisClient = getRedisClient();
    await redisClient.ping();
    const redisStatus = 'connected';

    // Check Hedera connection
    const hederaConnected = await checkHederaConnection();
    const hederaStatus = hederaConnected ? 'connected' : 'disconnected';

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        redis: redisStatus,
        hedera: hederaStatus,
      },
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export { router as healthRoutes };