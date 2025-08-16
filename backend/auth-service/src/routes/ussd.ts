import express, { Request, Response } from 'express';
import USSDService, { USSDRequest } from '../services/ussdService';
import MultiChannelSessionService from '../services/multiChannelSessionService';
import { apiRateLimiter } from '../middleware/rateLimiter';

const router = express.Router();
const ussdService = new USSDService();
const multiChannelSession = new MultiChannelSessionService();

interface AfricasTalkingUSSDRequest {
  sessionId?: string;
  serviceCode: string;
  phoneNumber: string;
  text: string;
  networkCode?: string;
}

/**
 * POST /ussd/callback
 * Handle incoming USSD requests from Africa's Talking
 */
router.post('/callback', apiRateLimiter, async (req: Request, res: Response) => {
  try {
    const {
      sessionId,
      serviceCode,
      phoneNumber,
      text,
      networkCode
    }: AfricasTalkingUSSDRequest = req.body;

    console.log(`USSD Callback: ${phoneNumber} - Session: ${sessionId} - Text: ${text}`);

    // Validate required fields
    if (!phoneNumber || !serviceCode) {
      console.error('Invalid USSD request: missing phoneNumber or serviceCode');
      return res.status(400).send('Invalid request parameters');
    }

    // Normalize phone number format
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    
    if (!normalizedPhone) {
      console.error(`Invalid phone number format: ${phoneNumber}`);
      return res.send('END Invalid phone number format.');
    }

    // Create USSD request object
    const ussdRequest: USSDRequest = {
      sessionId,
      serviceCode,
      phoneNumber: normalizedPhone,
      text: text || '',
      networkCode
    };

    // Process USSD request
    const ussdResponse = await ussdService.processUSSDRequest(ussdRequest);

    console.log(`USSD Response: ${ussdResponse.response.substring(0, 50)}... (End: ${ussdResponse.endSession})`);

    // Return USSD response in Africa's Talking format
    return res.type('text/plain').send(ussdResponse.response);

  } catch (error) {
    console.error('USSD callback error:', error);
    return res.type('text/plain').send('END Service temporarily unavailable. Please try again later.');
  }
});

/**
 * GET /ussd/test
 * Test USSD service locally (development only)
 */
router.get('/test', async (req: Request, res: Response) => {
  try {
    const {
      phoneNumber = '+254712345678',
      text = '',
      sessionId = 'test-session-123'
    } = req.query;

    if (process.env.NODE_ENV === 'production') {
      return res.status(404).json({ error: 'Test endpoint not available in production' });
    }

    const ussdRequest: USSDRequest = {
      sessionId: sessionId as string,
      serviceCode: '*789#',
      phoneNumber: phoneNumber as string,
      text: text as string,
      networkCode: 'TEST'
    };

    const ussdResponse = await ussdService.processUSSDRequest(ussdRequest);

    return res.json({
      success: true,
      request: ussdRequest,
      response: ussdResponse
    });

  } catch (error) {
    console.error('USSD test error:', error);
    return res.status(500).json({
      success: false,
      error: 'Test failed'
    });
  }
});

/**
 * GET /ussd/sessions/:userId
 * Get active USSD sessions for user (admin/debug endpoint)
 */
router.get('/sessions/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    // Get all sessions for user
    const sessions = await multiChannelSession.getUserSessions(userId);
    const ussdSessions = sessions.filter(session => session.channel === 'ussd');

    return res.json({
      success: true,
      userId,
      ussdSessions: ussdSessions.length,
      sessions: ussdSessions
    });

  } catch (error) {
    console.error('Error getting USSD sessions:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve sessions'
    });
  }
});

/**
 * POST /ussd/simulate
 * Simulate USSD interaction for testing
 */
router.post('/simulate', async (req: Request, res: Response) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(404).json({ error: 'Simulation endpoint not available in production' });
    }

    const {
      phoneNumber,
      sessionId,
      steps = []
    } = req.body;

    if (!phoneNumber || !Array.isArray(steps)) {
      return res.status(400).json({
        success: false,
        error: 'phoneNumber and steps array are required'
      });
    }

    const simulationResults = [];
    let currentSessionId = sessionId || `sim-${Date.now()}`;
    let currentText = '';

    // Simulate each step
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      currentText = i === 0 ? step : `${currentText}*${step}`;

      const ussdRequest: USSDRequest = {
        sessionId: currentSessionId,
        serviceCode: '*789#',
        phoneNumber,
        text: currentText,
        networkCode: 'SIM'
      };

      const ussdResponse = await ussdService.processUSSDRequest(ussdRequest);
      
      simulationResults.push({
        step: i + 1,
        input: step,
        fullText: currentText,
        response: ussdResponse.response,
        endSession: ussdResponse.endSession
      });

      // Stop if session ended
      if (ussdResponse.endSession) {
        break;
      }
    }

    return res.json({
      success: true,
      phoneNumber,
      sessionId: currentSessionId,
      steps: simulationResults
    });

  } catch (error) {
    console.error('USSD simulation error:', error);
    return res.status(500).json({
      success: false,
      error: 'Simulation failed'
    });
  }
});

/**
 * DELETE /ussd/sessions/:sessionId
 * Manually terminate USSD session
 */
router.delete('/sessions/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Session ID is required'
      });
    }

    // Invalidate the session
    const success = await multiChannelSession.invalidateSession(sessionId);

    if (success) {
      return res.json({
        success: true,
        message: 'USSD session terminated successfully'
      });
    } else {
      return res.status(404).json({
        success: false,
        error: 'Session not found or already terminated'
      });
    }

  } catch (error) {
    console.error('Error terminating USSD session:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to terminate session'
    });
  }
});

/**
 * GET /ussd/health
 * Health check for USSD service
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    // Basic health check
    const healthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'ussd',
      version: '1.0.0'
    };

    return res.json(healthStatus);

  } catch (error) {
    console.error('USSD health check error:', error);
    return res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      service: 'ussd',
      error: 'Service unavailable'
    });
  }
});

/**
 * Normalize phone number to +254 format
 */
function normalizePhoneNumber(phoneNumber: string): string | null {
  // Remove all non-digits
  const cleaned = phoneNumber.replace(/\D/g, '');
  
  // Handle different formats
  if (cleaned.startsWith('254') && cleaned.length === 12) {
    return `+${cleaned}`;
  } else if (cleaned.startsWith('0') && cleaned.length === 10) {
    return `+254${cleaned.substring(1)}`;
  } else if (cleaned.length === 9) {
    return `+254${cleaned}`;
  } else if (phoneNumber.startsWith('+254') && phoneNumber.length === 13) {
    return phoneNumber;
  }
  
  return null; // Invalid format
}

export default router;