/**
 * M-Pesa Routes
 * 
 * RESTful API endpoints for M-Pesa settlement processing including:
 * - Settlement initiation and management
 * - M-Pesa B2C payment webhook callbacks
 * - Settlement status tracking and audit trails
 * - Integration with HBAR payment processing workflow
 */

import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { body, param, query, validationResult } from 'express-validator';
import { mpesaService, SettlementRequest, MpesaCallbackResult } from '../services/mpesaService';
import { paymentProcessingWorkflowService } from '../services/paymentProcessingWorkflowService';

const router = express.Router();

// Rate limiting for M-Pesa operations
const settlementRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 settlement requests per windowMs
  message: {
    error: 'Too many settlement requests, please try again later.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const callbackRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // Allow frequent callback requests from M-Pesa
  message: {
    error: 'Too many callback requests, please try again later.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
});

const statusRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // Allow frequent status checks
  message: {
    error: 'Too many status requests, please try again later.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
});

/**
 * @route   POST /api/mpesa/initiate-settlement
 * @desc    Initiate KES settlement to artisan M-Pesa account
 * @access  Private
 * @body    {artisanId, artisanMpesaNumber, artisanName, originalPaymentId, originalTransactionId, amountHBAR, amountUSD, amountKES, exchangeRateUSDKES, settlementReason, productId?, orderReference?}
 */
router.post(
  '/initiate-settlement',
  settlementRateLimit,
  [
    body('artisanId')
      .isString()
      .isLength({ min: 1, max: 100 })
      .withMessage('Artisan ID is required and must be between 1-100 characters'),
    body('artisanMpesaNumber')
      .matches(/^(\+254|254|0)[17]\d{8}$/)
      .withMessage('Valid Kenyan M-Pesa number is required (format: +254XXXXXXXXX, 254XXXXXXXXX, or 0XXXXXXXXX)'),
    body('artisanName')
      .isString()
      .isLength({ min: 1, max: 100 })
      .withMessage('Artisan name is required and must be between 1-100 characters'),
    body('originalPaymentId')
      .isString()
      .matches(/^pay_\d+_[a-f0-9]{16}$/)
      .withMessage('Valid payment request ID is required'),
    body('originalTransactionId')
      .isString()
      .notEmpty()
      .withMessage('Original transaction ID is required'),
    body('amountHBAR')
      .isString()
      .matches(/^\d+(\.\d{1,8})?$/)
      .withMessage('Valid HBAR amount is required (up to 8 decimal places)'),
    body('amountUSD')
      .isFloat({ min: 0.01, max: 50000 })
      .withMessage('USD amount must be between $0.01 and $50,000'),
    body('amountKES')
      .isFloat({ min: 10, max: 5000000 })
      .withMessage('KES amount must be between KES 10 and KES 5,000,000'),
    body('exchangeRateUSDKES')
      .isFloat({ min: 1, max: 500 })
      .withMessage('Exchange rate must be between 1 and 500 KES per USD'),
    body('settlementReason')
      .isString()
      .isLength({ min: 10, max: 200 })
      .withMessage('Settlement reason is required (10-200 characters)'),
    body('productId')
      .optional()
      .isString()
      .isLength({ min: 1, max: 100 })
      .withMessage('Product ID must be between 1-100 characters if provided'),
    body('orderReference')
      .optional()
      .isString()
      .isLength({ min: 1, max: 100 })
      .withMessage('Order reference must be between 1-100 characters if provided'),
  ],
  async (req: Request, res: Response) => {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request parameters',
          details: errors.array(),
        });
      }

      const settlementRequest: SettlementRequest = req.body;

      // Initiate M-Pesa settlement
      const settlementId = await mpesaService.initiateSettlement(settlementRequest);

      res.status(201).json({
        success: true,
        data: {
          settlementId,
          settlementDetails: {
            artisanId: settlementRequest.artisanId,
            artisanMpesaNumber: settlementRequest.artisanMpesaNumber,
            amountKES: settlementRequest.amountKES,
            settlementReason: settlementRequest.settlementReason,
            initiatedAt: new Date().toISOString(),
          },
          instructions: {
            status: 'Settlement initiated successfully',
            estimatedCompletion: 'Within 5-10 minutes',
            supportInfo: 'Contact support if settlement is not received within 30 minutes',
          },
        },
      });

    } catch (error: any) {
      console.error('Settlement initiation failed:', error);
      
      res.status(500).json({
        success: false,
        error: error.message || 'Settlement initiation failed',
        code: 'SETTLEMENT_FAILED',
      });
    }
  }
);

/**
 * @route   POST /api/mpesa/callback/result
 * @desc    Handle M-Pesa B2C payment result callback
 * @access  Public (M-Pesa webhook)
 */
router.post(
  '/callback/result',
  callbackRateLimit,
  [
    body('Result.ConversationID')
      .isString()
      .notEmpty()
      .withMessage('Conversation ID is required'),
    body('Result.OriginatorConversationID')
      .isString()
      .notEmpty()
      .withMessage('Originator Conversation ID is required'),
    body('Result.ResponseCode')
      .isString()
      .notEmpty()
      .withMessage('Response code is required'),
    body('Result.ResponseDescription')
      .isString()
      .notEmpty()
      .withMessage('Response description is required'),
  ],
  async (req: Request, res: Response) => {
    try {
      console.log('M-Pesa callback received:', JSON.stringify(req.body, null, 2));

      // Validate basic callback structure
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        console.error('Invalid M-Pesa callback structure:', errors.array());
        return res.status(400).json({
          ResultCode: 1,
          ResultDesc: 'Invalid callback structure',
        });
      }

      // Extract callback data from M-Pesa format
      const result = req.body.Result;
      const callbackData: MpesaCallbackResult = {
        conversationId: result.ConversationID,
        originatorConversationId: result.OriginatorConversationID,
        responseCode: result.ResponseCode,
        responseDescription: result.ResponseDescription,
      };

      // Extract additional result parameters if successful
      if (result.ResponseCode === '0' && result.ResultParameters) {
        const resultParameters = result.ResultParameters.ResultParameter;
        
        // Parse result parameters array
        resultParameters.forEach((param: any) => {
          switch (param.Key) {
            case 'TransactionID':
              callbackData.transactionId = param.Value;
              break;
            case 'TransactionReceipt':
              callbackData.transactionReceipt = param.Value;
              break;
            case 'TransactionAmount':
              callbackData.transactionAmount = parseFloat(param.Value);
              break;
            case 'B2CWorkingAccountAvailableFunds':
              callbackData.b2CWorkingAccountAvailableFunds = parseFloat(param.Value);
              break;
            case 'B2CUtilityAccountAvailableFunds':
              callbackData.b2CUtilityAccountAvailableFunds = parseFloat(param.Value);
              break;
            case 'TransactionCompletedDateTime':
              callbackData.transactionCompletedDateTime = param.Value;
              break;
            case 'ReceiverPartyPublicName':
              callbackData.receiverPartyPublicName = param.Value;
              break;
            case 'B2CChargesPaidAccountAvailableFunds':
              callbackData.b2CChargesPaidAccountAvailableFunds = parseFloat(param.Value);
              break;
            case 'B2CRecipientIsRegisteredCustomer':
              callbackData.b2CRecipientIsRegisteredCustomer = param.Value;
              break;
          }
        });
      }

      // Process the callback
      await mpesaService.handleMpesaCallback(callbackData);

      // Respond to M-Pesa with success
      res.json({
        ResultCode: 0,
        ResultDesc: 'Callback processed successfully',
      });

    } catch (error: any) {
      console.error('M-Pesa callback processing failed:', error);
      
      // Always respond to M-Pesa to prevent retries
      res.json({
        ResultCode: 1,
        ResultDesc: 'Callback processing failed',
      });
    }
  }
);

/**
 * @route   POST /api/mpesa/callback/timeout
 * @desc    Handle M-Pesa B2C payment timeout callback
 * @access  Public (M-Pesa webhook)
 */
router.post(
  '/callback/timeout',
  callbackRateLimit,
  async (req: Request, res: Response) => {
    try {
      console.log('M-Pesa timeout callback received:', JSON.stringify(req.body, null, 2));

      // Extract timeout callback data
      const result = req.body.Result || req.body;
      const timeoutData: MpesaCallbackResult = {
        conversationId: result.ConversationID || result.conversationId,
        originatorConversationId: result.OriginatorConversationID || result.originatorConversationId,
        responseCode: '1', // Timeout response code
        responseDescription: 'Request timeout',
      };

      // Process the timeout
      await mpesaService.handleMpesaCallback(timeoutData);

      // Respond to M-Pesa with success
      res.json({
        ResultCode: 0,
        ResultDesc: 'Timeout callback processed successfully',
      });

    } catch (error: any) {
      console.error('M-Pesa timeout callback processing failed:', error);
      
      // Always respond to M-Pesa to prevent retries
      res.json({
        ResultCode: 1,
        ResultDesc: 'Timeout callback processing failed',
      });
    }
  }
);

/**
 * @route   GET /api/mpesa/settlement/:settlementId
 * @desc    Get settlement status and details
 * @access  Private
 * @params  {settlementId}
 */
router.get(
  '/settlement/:settlementId',
  statusRateLimit,
  [
    param('settlementId')
      .matches(/^SET_\d+_[A-F0-9]{8}$/)
      .withMessage('Invalid settlement ID format'),
  ],
  async (req: Request, res: Response) => {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request parameters',
          details: errors.array(),
        });
      }

      const { settlementId } = req.params;

      // Get settlement status
      const settlement = await mpesaService.getSettlementStatus(settlementId);

      if (!settlement) {
        return res.status(404).json({
          success: false,
          error: 'Settlement not found',
          code: 'SETTLEMENT_NOT_FOUND',
        });
      }

      res.json({
        success: true,
        data: {
          settlement,
          settlementInfo: {
            settlementId: settlement.settlementId,
            status: settlement.settlementStatus,
            amount: `KES ${settlement.settlementAmount.toFixed(2)}`,
            netAmount: `KES ${settlement.netSettlementAmount.toFixed(2)}`,
            processingFee: `KES ${settlement.processingFee.toFixed(2)}`,
            initiatedAt: settlement.initiatedAt,
            completedAt: settlement.completedAt,
            mpesaTransactionId: settlement.mpesaTransactionId,
            mpesaTransactionReceipt: settlement.mpesaTransactionReceipt,
          },
          statusDescription: getSettlementStatusDescription(settlement.settlementStatus),
        },
      });

    } catch (error: any) {
      console.error('Settlement status retrieval failed:', error);
      
      res.status(500).json({
        success: false,
        error: error.message || 'Settlement status retrieval failed',
        code: 'STATUS_RETRIEVAL_FAILED',
      });
    }
  }
);

/**
 * @route   GET /api/mpesa/settlement/:settlementId/audit
 * @desc    Get settlement audit trail
 * @access  Private
 * @params  {settlementId}
 */
router.get(
  '/settlement/:settlementId/audit',
  statusRateLimit,
  [
    param('settlementId')
      .matches(/^SET_\d+_[A-F0-9]{8}$/)
      .withMessage('Invalid settlement ID format'),
  ],
  async (req: Request, res: Response) => {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request parameters',
          details: errors.array(),
        });
      }

      const { settlementId } = req.params;

      // Get settlement audit trail
      const auditLogs = await mpesaService.getSettlementAuditTrail(settlementId);

      res.json({
        success: true,
        data: {
          settlementId,
          auditTrail: auditLogs,
          summary: {
            totalEvents: auditLogs.length,
            eventTypes: [...new Set(auditLogs.map(log => log.eventType))],
            firstEvent: auditLogs.length > 0 ? auditLogs[0].timestamp : null,
            lastEvent: auditLogs.length > 0 ? auditLogs[auditLogs.length - 1].timestamp : null,
          },
        },
      });

    } catch (error: any) {
      console.error('Settlement audit trail retrieval failed:', error);
      
      res.status(500).json({
        success: false,
        error: error.message || 'Settlement audit trail retrieval failed',
        code: 'AUDIT_RETRIEVAL_FAILED',
      });
    }
  }
);

/**
 * @route   POST /api/mpesa/test-settlement
 * @desc    Test M-Pesa settlement with minimal amount (sandbox only)
 * @access  Private (development only)
 * @body    {mpesaNumber, amount}
 */
router.post(
  '/test-settlement',
  settlementRateLimit,
  [
    body('mpesaNumber')
      .matches(/^(\+254|254|0)[17]\d{8}$/)
      .withMessage('Valid Kenyan M-Pesa number is required'),
    body('amount')
      .isFloat({ min: 10, max: 100 })
      .withMessage('Test amount must be between KES 10 and KES 100'),
  ],
  async (req: Request, res: Response) => {
    try {
      // Only allow in non-production environments
      if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({
          success: false,
          error: 'Test settlement not available in production',
          code: 'PRODUCTION_TEST_DISABLED',
        });
      }

      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request parameters',
          details: errors.array(),
        });
      }

      const { mpesaNumber, amount } = req.body;

      // Create test settlement request
      const testSettlementRequest: SettlementRequest = {
        artisanId: 'TEST_ARTISAN',
        artisanMpesaNumber: mpesaNumber,
        artisanName: 'Test Artisan',
        originalPaymentId: `pay_test_${Date.now()}_0123456789abcdef`,
        originalTransactionId: `test_tx_${Date.now()}`,
        amountHBAR: '10.00000000',
        amountUSD: 5.0,
        amountKES: amount,
        exchangeRateUSDKES: amount / 5.0,
        settlementReason: 'Test settlement for M-Pesa integration',
        productId: 'TEST_PRODUCT',
        orderReference: `TEST_ORDER_${Date.now()}`,
      };

      // Initiate test settlement
      const settlementId = await mpesaService.initiateSettlement(testSettlementRequest);

      res.status(201).json({
        success: true,
        data: {
          settlementId,
          testDetails: {
            mpesaNumber,
            amount: `KES ${amount.toFixed(2)}`,
            purpose: 'M-Pesa integration testing',
            environment: 'sandbox',
            estimatedCompletion: 'Within 2-5 minutes',
          },
          warning: 'This is a test settlement in sandbox environment',
        },
      });

    } catch (error: any) {
      console.error('Test settlement failed:', error);
      
      res.status(500).json({
        success: false,
        error: error.message || 'Test settlement failed',
        code: 'TEST_SETTLEMENT_FAILED',
      });
    }
  }
);

/**
 * @route   GET /api/mpesa/health
 * @desc    Check M-Pesa service health and configuration
 * @access  Private
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    // Check environment variables
    const requiredEnvVars = [
      'MPESA_CONSUMER_KEY',
      'MPESA_CONSUMER_SECRET',
      'MPESA_BUSINESS_SHORT_CODE',
      'MPESA_PASSKEY',
      'MPESA_INITIATOR_NAME',
      'MPESA_SECURITY_CREDENTIAL',
      'MPESA_CALLBACK_URL',
    ];

    const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

    res.json({
      success: true,
      data: {
        status: missingEnvVars.length === 0 ? 'healthy' : 'configuration_incomplete',
        environment: process.env.MPESA_ENVIRONMENT || 'sandbox',
        baseUrl: process.env.MPESA_BASE_URL || 'https://sandbox.safaricom.co.ke',
        configurationComplete: missingEnvVars.length === 0,
        missingConfiguration: missingEnvVars,
        serviceInfo: {
          name: 'M-Pesa Settlement Service',
          version: '1.0.0',
          features: [
            'B2C Payments',
            'Webhook Callbacks',
            'Settlement Tracking',
            'Audit Logging',
            'Retry Logic',
          ],
        },
        lastCheck: new Date().toISOString(),
      },
    });

  } catch (error: any) {
    console.error('M-Pesa health check failed:', error);
    
    res.status(500).json({
      success: false,
      error: error.message || 'Health check failed',
      code: 'HEALTH_CHECK_FAILED',
    });
  }
});

// Helper function to get user-friendly status descriptions
function getSettlementStatusDescription(status: string): string {
  switch (status) {
    case 'initiated':
      return 'Settlement has been initiated and is being processed';
    case 'pending':
      return 'M-Pesa payment request has been sent, awaiting confirmation';
    case 'completed':
      return 'Settlement has been completed successfully';
    case 'failed':
      return 'Settlement failed - please contact support';
    case 'cancelled':
      return 'Settlement was cancelled';
    default:
      return 'Unknown settlement status';
  }
}

export default router;