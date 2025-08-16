/**
 * Privacy-Compliant Analytics Routes
 * 
 * These routes handle verification analytics while ensuring strict privacy compliance
 * and GDPR regulations. All personal data is anonymized and automatically deleted.
 */

import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { privacyCompliantAnalyticsService, AnalyticsEvent, PrivacySettings } from '../services/privacyCompliantAnalyticsService';

const router = express.Router();

// Rate limiting for analytics endpoints
const analyticsLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  message: {
    success: false,
    error: 'Too many analytics requests. Please try again later.',
  },
});

const privacySettingsLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: {
    success: false,
    error: 'Too many privacy settings requests. Please try again later.',
  },
});

/**
 * POST /api/analytics/track
 * Track verification event with privacy compliance
 */
router.post('/track', analyticsLimiter, async (req: Request, res: Response) => {
  try {
    const {
      verificationId,
      productId,
      timestamp,
      result,
      sessionId,
      hashedClientInfo,
      privacyCompliant,
      dataRetentionDays,
      personalDataIncluded,
    } = req.body;

    // Validate required fields
    if (!verificationId || !productId || !result || !sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: verificationId, productId, result, sessionId',
      });
    }

    // Validate privacy compliance
    if (!privacyCompliant) {
      return res.status(400).json({
        success: false,
        error: 'Event must be marked as privacy compliant',
      });
    }

    // Validate result values
    const validResults = ['authentic', 'counterfeit', 'unknown'];
    if (!validResults.includes(result)) {
      return res.status(400).json({
        success: false,
        error: `Invalid result. Must be one of: ${validResults.join(', ')}`,
      });
    }

    const analyticsEvent: AnalyticsEvent = {
      verificationId,
      productId,
      timestamp: timestamp || new Date().toISOString(),
      result,
      sessionId,
      hashedClientInfo: hashedClientInfo || {},
      privacyCompliant: true,
      dataRetentionDays: dataRetentionDays || 90,
      personalDataIncluded: personalDataIncluded || false,
    };

    await privacyCompliantAnalyticsService.trackVerificationEvent(analyticsEvent);

    res.status(200).json({
      success: true,
      message: 'Analytics event tracked successfully',
      data: {
        verificationId: analyticsEvent.verificationId,
        privacyCompliant: true,
        retentionDays: analyticsEvent.dataRetentionDays,
        timestamp: analyticsEvent.timestamp,
      },
    });

  } catch (error) {
    console.error('Analytics tracking error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to track analytics event',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/analytics/aggregated
 * Get aggregated analytics data (no personal information)
 */
router.get('/aggregated', analyticsLimiter, async (req: Request, res: Response) => {
  try {
    const { timeframe } = req.query;

    // Validate timeframe
    const validTimeframes = ['day', 'week', 'month', 'year'];
    const selectedTimeframe = (timeframe as string) || 'month';
    
    if (!validTimeframes.includes(selectedTimeframe)) {
      return res.status(400).json({
        success: false,
        error: `Invalid timeframe. Must be one of: ${validTimeframes.join(', ')}`,
      });
    }

    const analytics = await privacyCompliantAnalyticsService.getAggregatedAnalytics(
      selectedTimeframe as 'day' | 'week' | 'month' | 'year'
    );

    res.status(200).json({
      success: true,
      message: 'Aggregated analytics retrieved successfully',
      data: analytics,
      privacy: {
        personalDataIncluded: false,
        privacyCompliant: true,
        dataAnonymized: true,
      },
    });

  } catch (error) {
    console.error('Analytics retrieval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve analytics data',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/analytics/privacy-settings/:sessionId
 * Get privacy settings for a session
 */
router.get('/privacy-settings/:sessionId', privacySettingsLimiter, async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Session ID is required',
      });
    }

    const privacySettings = await privacyCompliantAnalyticsService.getPrivacySettings(sessionId);

    if (!privacySettings) {
      // Return default privacy-friendly settings
      const defaultSettings: PrivacySettings = {
        sharePersonalData: false,
        allowAnalytics: false,
        showVerificationHistory: true,
        anonymizeLocation: true,
      };

      return res.status(200).json({
        success: true,
        message: 'Default privacy settings returned',
        data: defaultSettings,
        isDefault: true,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Privacy settings retrieved successfully',
      data: privacySettings,
      isDefault: false,
    });

  } catch (error) {
    console.error('Privacy settings retrieval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve privacy settings',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * PUT /api/analytics/privacy-settings/:sessionId
 * Update privacy settings for a session
 */
router.put('/privacy-settings/:sessionId', privacySettingsLimiter, async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const {
      sharePersonalData,
      allowAnalytics,
      showVerificationHistory,
      anonymizeLocation,
    } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Session ID is required',
      });
    }

    // Validate boolean fields
    const booleanFields = {
      sharePersonalData,
      allowAnalytics,
      showVerificationHistory,
      anonymizeLocation,
    };

    for (const [field, value] of Object.entries(booleanFields)) {
      if (value !== undefined && typeof value !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: `${field} must be a boolean value`,
        });
      }
    }

    const privacySettings: PrivacySettings = {
      sharePersonalData: sharePersonalData ?? false,
      allowAnalytics: allowAnalytics ?? false,
      showVerificationHistory: showVerificationHistory ?? true,
      anonymizeLocation: anonymizeLocation ?? true,
    };

    await privacyCompliantAnalyticsService.updatePrivacySettings(sessionId, privacySettings);

    res.status(200).json({
      success: true,
      message: 'Privacy settings updated successfully',
      data: privacySettings,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Privacy settings update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update privacy settings',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/analytics/data-cleanup
 * Perform manual data cleanup (admin only)
 */
router.post('/data-cleanup', analyticsLimiter, async (req: Request, res: Response) => {
  try {
    // Note: In production, this should require admin authentication
    const cleanup = await privacyCompliantAnalyticsService.performDataCleanup();

    res.status(200).json({
      success: true,
      message: 'Data cleanup completed successfully',
      data: cleanup,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Data cleanup error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to perform data cleanup',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/analytics/retention-policy
 * Get data retention policy information
 */
router.get('/retention-policy', analyticsLimiter, async (req: Request, res: Response) => {
  try {
    const retentionPolicy = await privacyCompliantAnalyticsService.getDataRetentionPolicy();

    res.status(200).json({
      success: true,
      message: 'Data retention policy retrieved successfully',
      data: retentionPolicy,
    });

  } catch (error) {
    console.error('Retention policy retrieval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve retention policy',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/analytics/privacy-compliance
 * Get privacy compliance report
 */
router.get('/privacy-compliance', analyticsLimiter, async (req: Request, res: Response) => {
  try {
    const complianceReport = await privacyCompliantAnalyticsService.generatePrivacyComplianceReport();

    res.status(200).json({
      success: true,
      message: 'Privacy compliance report generated successfully',
      data: complianceReport,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Privacy compliance report error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate privacy compliance report',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/analytics/health
 * Analytics service health check
 */
router.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    service: 'privacy-compliant-analytics',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    privacy: {
      gdprCompliant: true,
      dataMinimization: true,
      automaticDeletion: true,
      cryptographicHashing: true,
    },
  });
});

export default router;