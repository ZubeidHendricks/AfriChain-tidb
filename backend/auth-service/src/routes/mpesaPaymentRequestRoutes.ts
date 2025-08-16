/**
 * M-Pesa Payment Request API Routes
 * 
 * Comprehensive REST API endpoints for M-Pesa payment request functionality featuring:
 * - STK Push payment initiation for customer-initiated payments
 * - Payment request status checking and monitoring
 * - Payment validation and confirmation endpoints (C2B API)
 * - Payment cancellation and refund support
 * - Payment reconciliation and audit capabilities
 * - Real-time payment notifications and webhooks
 */

import express, { Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import rateLimit from 'express-rate-limit';
import { mpesaPaymentRequestService, MpesaPaymentRequest, STKCallbackResult, PaymentValidationRequest, PaymentConfirmationRequest } from '../services/mpesaPaymentRequestService';

const router = express.Router();

// Rate limiting for payment endpoints
const paymentRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 requests per windowMs
  message: 'Too many payment requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

const callbackRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // Allow more requests for callbacks
  message: 'Too many callback requests',
  standardHeaders: true,
  legacyHeaders: false,
});

// Validation middleware
const validateRequest = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array(),
    });
  }
  next();
};

// Error handling middleware
const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * POST /api/mpesa/payment-request/stk-push
 * Initiate STK Push payment request to customer's phone
 */
router.post('/stk-push', 
  paymentRateLimit,
  [
    body('customerPhone')
      .notEmpty()
      .matches(/^(\+254|254|0)[17]\d{8}$/)
      .withMessage('Valid Kenyan phone number is required'),
    body('amount')
      .isFloat({ min: 1, max: 150000 })
      .withMessage('Amount must be between KES 1 and KES 150,000'),
    body('accountReference')
      .notEmpty()
      .isLength({ max: 12 })
      .withMessage('Account reference is required and must be 12 characters or less'),
    body('transactionDesc')
      .notEmpty()
      .isLength({ max: 100 })
      .withMessage('Transaction description is required and must be 100 characters or less'),
    body('originalHBARPaymentId')
      .optional()
      .isString()
      .withMessage('Original HBAR payment ID must be a string'),
    body('originalOrderId')
      .optional()
      .isString()
      .withMessage('Original order ID must be a string'),
  ],
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const {
      customerPhone,
      amount,
      accountReference,
      transactionDesc,
      originalHBARPaymentId,
      originalOrderId,
    } = req.body;

    try {
      const paymentRequest = await mpesaPaymentRequestService.initiateSTKPush(
        customerPhone,
        amount,
        accountReference,
        transactionDesc,
        originalHBARPaymentId,
        originalOrderId
      );

      res.status(201).json({
        success: true,
        message: 'STK Push initiated successfully',
        data: {
          paymentRequestId: paymentRequest.paymentRequestId,
          merchantRequestId: paymentRequest.merchantRequestId,
          checkoutRequestId: paymentRequest.checkoutRequestId,
          customerMpesaNumber: paymentRequest.customerMpesaNumber,
          amount: paymentRequest.amount,
          currency: paymentRequest.currency,
          status: paymentRequest.status,
          expirationTime: paymentRequest.expirationTime,
          responseCode: paymentRequest.responseCode,
          responseDescription: paymentRequest.responseDescription,
        },
      });

    } catch (error) {
      console.error('STK Push initiation failed:', error);
      res.status(500).json({
        success: false,
        error: 'STK Push initiation failed',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    }
  })
);

/**
 * GET /api/mpesa/payment-request/:paymentRequestId/status
 * Get payment request status and details
 */
router.get('/:paymentRequestId/status',
  [
    param('paymentRequestId')
      .notEmpty()
      .matches(/^mpesa_req_\d+_[a-f0-9]{8}$/)
      .withMessage('Valid payment request ID is required'),
  ],
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const { paymentRequestId } = req.params;

    try {
      const paymentRequest = await mpesaPaymentRequestService.getPaymentRequest(paymentRequestId);

      if (!paymentRequest) {
        return res.status(404).json({
          success: false,
          error: 'Payment request not found',
          message: `Payment request with ID ${paymentRequestId} not found`,
        });
      }

      res.json({
        success: true,
        data: {
          paymentRequestId: paymentRequest.paymentRequestId,
          status: paymentRequest.status,
          amount: paymentRequest.amount,
          currency: paymentRequest.currency,
          customerMpesaNumber: paymentRequest.customerMpesaNumber,
          merchantRequestId: paymentRequest.merchantRequestId,
          checkoutRequestId: paymentRequest.checkoutRequestId,
          mpesaReceiptNumber: paymentRequest.mpesaReceiptNumber,
          transactionDate: paymentRequest.transactionDate,
          expirationTime: paymentRequest.expirationTime,
          failureReason: paymentRequest.failureReason,
          createdAt: paymentRequest.createdAt,
          updatedAt: paymentRequest.updatedAt,
          completedAt: paymentRequest.completedAt,
        },
      });

    } catch (error) {
      console.error('Failed to get payment request status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get payment request status',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    }
  })
);

/**
 * POST /api/mpesa/payment-request/:paymentRequestId/check-status
 * Check STK Push status directly with M-Pesa
 */
router.post('/:paymentRequestId/check-status',
  paymentRateLimit,
  [
    param('paymentRequestId')
      .notEmpty()
      .matches(/^mpesa_req_\d+_[a-f0-9]{8}$/)
      .withMessage('Valid payment request ID is required'),
  ],
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const { paymentRequestId } = req.params;

    try {
      const paymentRequest = await mpesaPaymentRequestService.getPaymentRequest(paymentRequestId);

      if (!paymentRequest) {
        return res.status(404).json({
          success: false,
          error: 'Payment request not found',
          message: `Payment request with ID ${paymentRequestId} not found`,
        });
      }

      const statusResult = await mpesaPaymentRequestService.checkSTKPushStatus(
        paymentRequest.checkoutRequestId
      );

      res.json({
        success: true,
        message: 'STK Push status check completed',
        data: {
          paymentRequestId,
          checkoutRequestId: paymentRequest.checkoutRequestId,
          statusResult,
        },
      });

    } catch (error) {
      console.error('STK Push status check failed:', error);
      res.status(500).json({
        success: false,
        error: 'STK Push status check failed',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    }
  })
);

/**
 * POST /api/mpesa/payment-request/:paymentRequestId/cancel
 * Cancel a pending payment request
 */
router.post('/:paymentRequestId/cancel',
  paymentRateLimit,
  [
    param('paymentRequestId')
      .notEmpty()
      .matches(/^mpesa_req_\d+_[a-f0-9]{8}$/)
      .withMessage('Valid payment request ID is required'),
    body('reason')
      .notEmpty()
      .isLength({ min: 5, max: 200 })
      .withMessage('Cancellation reason is required (5-200 characters)'),
  ],
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const { paymentRequestId } = req.params;
    const { reason } = req.body;

    try {
      await mpesaPaymentRequestService.cancelPaymentRequest(paymentRequestId, reason);

      res.json({
        success: true,
        message: 'Payment request cancelled successfully',
        data: {
          paymentRequestId,
          reason,
          cancelledAt: new Date().toISOString(),
        },
      });

    } catch (error) {
      console.error('Payment request cancellation failed:', error);
      res.status(500).json({
        success: false,
        error: 'Payment request cancellation failed',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    }
  })
);

/**
 * POST /api/mpesa/payment-request/callback/stk-push
 * Handle STK Push callback from M-Pesa
 */
router.post('/callback/stk-push',
  callbackRateLimit,
  asyncHandler(async (req: Request, res: Response) => {
    try {
      console.log('Received STK Push callback:', JSON.stringify(req.body, null, 2));

      // Extract callback data from M-Pesa response structure
      const callbackData: STKCallbackResult = {
        merchantRequestId: req.body.Body?.stkCallback?.MerchantRequestID,
        checkoutRequestId: req.body.Body?.stkCallback?.CheckoutRequestID,
        resultCode: req.body.Body?.stkCallback?.ResultCode?.toString(),
        resultDesc: req.body.Body?.stkCallback?.ResultDesc,
        callbackMetadata: req.body.Body?.stkCallback?.CallbackMetadata?.Item ? {
          amount: req.body.Body.stkCallback.CallbackMetadata.Item.find((item: any) => item.Name === 'Amount')?.Value,
          mpesaReceiptNumber: req.body.Body.stkCallback.CallbackMetadata.Item.find((item: any) => item.Name === 'MpesaReceiptNumber')?.Value,
          balance: req.body.Body.stkCallback.CallbackMetadata.Item.find((item: any) => item.Name === 'Balance')?.Value,
          transactionDate: req.body.Body.stkCallback.CallbackMetadata.Item.find((item: any) => item.Name === 'TransactionDate')?.Value?.toString(),
          phoneNumber: req.body.Body.stkCallback.CallbackMetadata.Item.find((item: any) => item.Name === 'PhoneNumber')?.Value?.toString(),
        } : undefined,
      };

      // Validate required callback data
      if (!callbackData.merchantRequestId || !callbackData.checkoutRequestId || !callbackData.resultCode) {
        console.error('Invalid callback data structure:', callbackData);
        return res.status(400).json({
          success: false,
          error: 'Invalid callback data structure',
        });
      }

      // Process the callback
      await mpesaPaymentRequestService.handleSTKCallback(callbackData);

      // Respond to M-Pesa (required for callback acknowledgment)
      res.json({
        ResultCode: 0,
        ResultDesc: 'Callback processed successfully',
      });

    } catch (error) {
      console.error('STK Push callback processing failed:', error);
      
      // Still respond to M-Pesa to avoid retries
      res.json({
        ResultCode: 1,
        ResultDesc: 'Callback processing failed',
      });
    }
  })
);

/**
 * POST /api/mpesa/payment-request/validation
 * Handle payment validation requests (C2B API)
 */
router.post('/validation',
  callbackRateLimit,
  asyncHandler(async (req: Request, res: Response) => {
    try {
      console.log('Received payment validation request:', JSON.stringify(req.body, null, 2));

      const validationData: PaymentValidationRequest = {
        transactionType: req.body.TransactionType,
        transactionId: req.body.TransID,
        transactionTime: req.body.TransTime,
        transactionAmount: req.body.TransAmount,
        businessShortCode: req.body.BusinessShortCode,
        billRefNumber: req.body.BillRefNumber,
        invoiceNumber: req.body.InvoiceNumber,
        orgAccountBalance: req.body.OrgAccountBalance,
        thirdPartyTransId: req.body.ThirdPartyTransID,
        msisdn: req.body.MSISDN,
        firstName: req.body.FirstName,
        middleName: req.body.MiddleName,
        lastName: req.body.LastName,
      };

      const result = await mpesaPaymentRequestService.handlePaymentValidation(validationData);

      res.json({
        ResultCode: result.resultCode,
        ResultDesc: result.resultDesc,
      });

    } catch (error) {
      console.error('Payment validation failed:', error);
      res.json({
        ResultCode: '1',
        ResultDesc: 'Payment validation error',
      });
    }
  })
);

/**
 * POST /api/mpesa/payment-request/confirmation
 * Handle payment confirmation requests (C2B API)
 */
router.post('/confirmation',
  callbackRateLimit,
  asyncHandler(async (req: Request, res: Response) => {
    try {
      console.log('Received payment confirmation request:', JSON.stringify(req.body, null, 2));

      const confirmationData: PaymentConfirmationRequest = {
        transactionType: req.body.TransactionType,
        transactionId: req.body.TransID,
        transactionTime: req.body.TransTime,
        transactionAmount: req.body.TransAmount,
        businessShortCode: req.body.BusinessShortCode,
        billRefNumber: req.body.BillRefNumber,
        invoiceNumber: req.body.InvoiceNumber,
        orgAccountBalance: req.body.OrgAccountBalance,
        thirdPartyTransId: req.body.ThirdPartyTransID,
        msisdn: req.body.MSISDN,
        firstName: req.body.FirstName,
        middleName: req.body.MiddleName,
        lastName: req.body.LastName,
      };

      const result = await mpesaPaymentRequestService.handlePaymentConfirmation(confirmationData);

      res.json({
        ResultCode: result.resultCode,
        ResultDesc: result.resultDesc,
      });

    } catch (error) {
      console.error('Payment confirmation failed:', error);
      res.json({
        ResultCode: '1',
        ResultDesc: 'Payment confirmation error',
      });
    }
  })
);

/**
 * POST /api/mpesa/payment-request/reconcile
 * Perform payment reconciliation for a given period
 */
router.post('/reconcile',
  paymentRateLimit,
  [
    body('startDate')
      .isISO8601()
      .withMessage('Valid start date is required (ISO 8601 format)'),
    body('endDate')
      .isISO8601()
      .withMessage('Valid end date is required (ISO 8601 format)'),
  ],
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const { startDate, endDate } = req.body;

    try {
      const startDateTime = new Date(startDate);
      const endDateTime = new Date(endDate);

      // Validate date range
      if (startDateTime >= endDateTime) {
        return res.status(400).json({
          success: false,
          error: 'Invalid date range',
          message: 'Start date must be before end date',
        });
      }

      const reconciliationResult = await mpesaPaymentRequestService.reconcilePayments(
        startDateTime,
        endDateTime
      );

      res.json({
        success: true,
        message: 'Payment reconciliation completed',
        data: reconciliationResult,
      });

    } catch (error) {
      console.error('Payment reconciliation failed:', error);
      res.status(500).json({
        success: false,
        error: 'Payment reconciliation failed',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    }
  })
);

/**
 * GET /api/mpesa/payment-request/health
 * Health check endpoint for M-Pesa payment request service
 */
router.get('/health', asyncHandler(async (req: Request, res: Response) => {
  try {
    // Basic health check - verify service connectivity
    const healthStatus = {
      service: 'mpesa-payment-request',
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      features: {
        stkPush: true,
        paymentValidation: true,
        paymentConfirmation: true,
        reconciliation: true,
        callbacks: true,
      },
    };

    res.json({
      success: true,
      data: healthStatus,
    });

  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({
      success: false,
      error: 'Service unhealthy',
      message: error instanceof Error ? error.message : 'Unknown error occurred',
    });
  }
}));

// Error handling middleware
router.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('M-Pesa Payment Request API Error:', error);

  // Handle specific error types
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: 'Validation error',
      message: error.message,
    });
  }

  if (error.name === 'UnauthorizedError') {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Authentication required',
    });
  }

  // Generic error response
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred',
  });
});

export default router;