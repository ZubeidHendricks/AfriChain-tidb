import express, { Request, Response } from 'express';
import CrossChannelSessionCoordinator, { CrossChannelSyncRequest } from '../services/crossChannelSessionCoordinator';
import { authenticateToken } from '../middleware/auth';
import { apiRateLimiter } from '../middleware/rateLimiter';

const router = express.Router();
const crossChannelCoordinator = new CrossChannelSessionCoordinator();

interface CrossChannelResponse {
  success: boolean;
  message?: string;
  data?: any;
  error?: string;
}

/**
 * GET /cross-channel/overview
 * Get comprehensive session overview across all channels for current user
 */
router.get('/overview', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      } as CrossChannelResponse);
    }

    console.log(`Getting cross-channel overview for user: ${req.user.userId}`);

    const overview = await crossChannelCoordinator.getUserSessionOverview(req.user.userId);

    return res.status(200).json({
      success: true,
      message: 'Session overview retrieved successfully',
      data: overview
    } as CrossChannelResponse);

  } catch (error) {
    console.error('Cross-channel overview error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    } as CrossChannelResponse);
  }
});

/**
 * POST /cross-channel/sync
 * Synchronize session data between channels
 */
router.post('/sync', authenticateToken, apiRateLimiter, async (req: Request, res: Response) => {
  try {
    const { fromChannel, toChannel, sessionId, metadata } = req.body;

    if (!fromChannel || !toChannel || !sessionId) {
      return res.status(400).json({
        success: false,
        error: 'From channel, to channel, and session ID are required'
      } as CrossChannelResponse);
    }

    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      } as CrossChannelResponse);
    }

    // Validate channel types
    const validChannels = ['web', 'mobile', 'ussd'];
    if (!validChannels.includes(fromChannel) || !validChannels.includes(toChannel)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid channel type. Must be: web, mobile, or ussd'
      } as CrossChannelResponse);
    }

    console.log(`Cross-channel sync: ${fromChannel} -> ${toChannel} for user ${req.user.userId}`);

    const syncRequest: CrossChannelSyncRequest = {
      fromChannel,
      toChannel,
      userId: req.user.userId,
      sessionId,
      metadata
    };

    const syncResult = await crossChannelCoordinator.synchronizeChannelSessions(syncRequest);

    if (!syncResult.success) {
      return res.status(400).json({
        success: false,
        error: syncResult.error,
        data: { conflicts: syncResult.conflicts }
      } as CrossChannelResponse);
    }

    return res.status(200).json({
      success: true,
      message: 'Session synchronized successfully',
      data: {
        syncedSessionId: syncResult.syncedSessionId,
        conflicts: syncResult.conflicts || []
      }
    } as CrossChannelResponse);

  } catch (error) {
    console.error('Cross-channel sync error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    } as CrossChannelResponse);
  }
});

/**
 * POST /cross-channel/switch
 * Handle channel switch with automatic session management
 */
router.post('/switch', authenticateToken, apiRateLimiter, async (req: Request, res: Response) => {
  try {
    const { fromChannel, toChannel, newSessionId } = req.body;

    if (!fromChannel || !toChannel || !newSessionId) {
      return res.status(400).json({
        success: false,
        error: 'From channel, to channel, and new session ID are required'
      } as CrossChannelResponse);
    }

    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      } as CrossChannelResponse);
    }

    console.log(`Channel switch: ${fromChannel} -> ${toChannel} for user ${req.user.userId}`);

    const switchResult = await crossChannelCoordinator.handleChannelSwitch(
      req.user.userId,
      fromChannel,
      toChannel,
      newSessionId
    );

    if (!switchResult) {
      return res.status(500).json({
        success: false,
        error: 'Failed to handle channel switch'
      } as CrossChannelResponse);
    }

    return res.status(200).json({
      success: true,
      message: 'Channel switch handled successfully'
    } as CrossChannelResponse);

  } catch (error) {
    console.error('Channel switch error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    } as CrossChannelResponse);
  }
});

/**
 * GET /cross-channel/conflicts
 * Detect and resolve session conflicts across channels
 */
router.get('/conflicts', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      } as CrossChannelResponse);
    }

    console.log(`Detecting conflicts for user: ${req.user.userId}`);

    const conflicts = await crossChannelCoordinator.detectAndResolveConflicts(req.user.userId);

    return res.status(200).json({
      success: true,
      message: 'Conflict detection completed',
      data: {
        conflictsFound: conflicts.length,
        conflictsResolved: conflicts.filter(c => c.resolved).length,
        conflicts
      }
    } as CrossChannelResponse);

  } catch (error) {
    console.error('Conflict detection error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    } as CrossChannelResponse);
  }
});

/**
 * POST /cross-channel/broadcast
 * Broadcast event to all active sessions across channels
 */
router.post('/broadcast', authenticateToken, apiRateLimiter, async (req: Request, res: Response) => {
  try {
    const { eventType, data, excludeCurrentSession } = req.body;

    if (!eventType || !data) {
      return res.status(400).json({
        success: false,
        error: 'Event type and data are required'
      } as CrossChannelResponse);
    }

    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      } as CrossChannelResponse);
    }

    console.log(`Broadcasting event "${eventType}" for user: ${req.user.userId}`);

    const broadcastResult = await crossChannelCoordinator.broadcastToAllChannels(
      req.user.userId,
      {
        type: eventType,
        data,
        excludeSessionId: excludeCurrentSession ? req.user.sessionId : undefined
      }
    );

    if (!broadcastResult) {
      return res.status(500).json({
        success: false,
        error: 'Failed to broadcast event'
      } as CrossChannelResponse);
    }

    return res.status(200).json({
      success: true,
      message: 'Event broadcasted successfully'
    } as CrossChannelResponse);

  } catch (error) {
    console.error('Broadcast error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    } as CrossChannelResponse);
  }
});

/**
 * POST /cross-channel/cleanup
 * Clean up expired cross-channel data (admin endpoint)
 */
router.post('/cleanup', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      } as CrossChannelResponse);
    }

    // In a real implementation, this would check for admin privileges
    console.log(`Cross-channel cleanup requested by user: ${req.user.userId}`);

    await crossChannelCoordinator.cleanupExpiredCrossChannelData();

    return res.status(200).json({
      success: true,
      message: 'Cross-channel data cleanup completed'
    } as CrossChannelResponse);

  } catch (error) {
    console.error('Cleanup error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    } as CrossChannelResponse);
  }
});

/**
 * GET /cross-channel/health
 * Health check for cross-channel session coordinator
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const healthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'cross-channel-coordinator',
      version: '1.0.0',
      features: {
        sessionSynchronization: true,
        channelSwitching: true,
        conflictResolution: true,
        eventBroadcasting: true,
        automaticCleanup: true
      }
    };

    return res.json(healthStatus);

  } catch (error) {
    console.error('Cross-channel health check error:', error);
    return res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      service: 'cross-channel-coordinator',
      error: 'Service unavailable'
    });
  }
});

export default router;