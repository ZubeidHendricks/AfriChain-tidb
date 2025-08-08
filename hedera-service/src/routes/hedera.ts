import { Router, Request, Response } from 'express';
import { getHederaClient } from '../config/hedera';
import { publishToChannel } from '../config/redis';
import { testHederaConnection, createTestTransaction } from '../utils/hederaTest';

const router = Router();

// Basic ping-pong test endpoint for cross-service communication
router.post('/ping', async (req: Request, res: Response) => {
  try {
    const { message, source } = req.body;

    // Log the ping request
    console.log(`Received ping from ${source}: ${message}`);

    // Publish response to Redis channel for Python service
    await publishToChannel('hedera.agent.responses', {
      type: 'ping_response',
      message: 'pong',
      source: 'hedera-service',
      timestamp: new Date().toISOString(),
      original_message: message,
    });

    res.json({
      success: true,
      response: 'pong',
      timestamp: new Date().toISOString(),
      received_from: source,
    });
  } catch (error) {
    console.error('Ping endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Hedera connection test endpoint
router.get('/status', async (req: Request, res: Response) => {
  try {
    const client = getHederaClient();
    const accountId = process.env.HEDERA_ACCOUNT_ID;

    res.json({
      success: true,
      network: process.env.HEDERA_NETWORK || 'testnet',
      account_id: accountId,
      client_status: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Hedera status error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Hedera client not available',
    });
  }
});

// Hedera SDK connectivity test endpoint
router.get('/test-connection', async (req: Request, res: Response) => {
  try {
    const result = await testHederaConnection();
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    console.error('Hedera connection test error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Connection test failed',
    });
  }
});

// Mock transaction test endpoint
router.post('/test-transaction', async (req: Request, res: Response) => {
  try {
    const result = await createTestTransaction();
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    console.error('Test transaction error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Test transaction failed',
    });
  }
});

export { router as hederaRoutes };