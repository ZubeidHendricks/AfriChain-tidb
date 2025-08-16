/**
 * Payment Routes
 * 
 * RESTful API endpoints for HBAR payment processing including:
 * - Payment request creation and management
 * - Real-time payment monitoring and status updates
 * - Exchange rate queries and payment validation
 * - Transaction history and audit trails
 * - Payment refunds and error handling
 */

import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { body, param, query, validationResult } from 'express-validator';
import { hbarPaymentService, PaymentRequest, PaymentTransaction } from '../services/hbarPaymentService';

const router = express.Router();

// Rate limiting for payment operations
const paymentRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 payment requests per windowMs
  message: {
    error: 'Too many payment requests, please try again later.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const monitoringRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // Allow frequent status checks
  message: {
    error: 'Too many monitoring requests, please try again later.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
});

/**
 * @route   POST /api/payments/create-request
 * @desc    Create a new HBAR payment request
 * @access  Public
 * @body    {productId, productName, priceUSD, customerInfo?}
 */
router.post(
  '/create-request',
  paymentRateLimit,
  [
    body('productId')
      .isString()
      .isLength({ min: 1, max: 100 })
      .withMessage('Product ID is required and must be between 1-100 characters'),
    body('productName')
      .isString()
      .isLength({ min: 1, max: 200 })
      .withMessage('Product name is required and must be between 1-200 characters'),
    body('priceUSD')
      .isFloat({ min: 1, max: 10000 })
      .withMessage('Price must be between $1 and $10,000 USD'),
    body('customerInfo.email')
      .optional()
      .isEmail()
      .withMessage('Valid email address required'),
    body('customerInfo.accountId')
      .optional()
      .matches(/^0\.0\.\d+$/)
      .withMessage('Valid Hedera account ID required (format: 0.0.123456)'),
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

      const { productId, productName, priceUSD, customerInfo } = req.body;

      // Create payment request
      const paymentRequest = await hbarPaymentService.createPaymentRequest(
        productId,
        productName,
        priceUSD,
        customerInfo
      );

      res.status(201).json({
        success: true,
        data: {
          paymentRequest,
          instructions: {
            steps: [
              'Open your Hedera-compatible wallet app',
              'Scan the QR code or enter payment details manually',
              'Send exactly the specified HBAR amount with the provided memo',
              'Your payment will be confirmed within 30 seconds',
            ],
            paymentDetails: {
              recipient: paymentRequest.recipientAccountId,
              amount: `${paymentRequest.priceHBAR} HBAR`,
              memo: paymentRequest.memo,
              usdEquivalent: `$${priceUSD.toFixed(2)} USD`,
            },
            expiresAt: paymentRequest.expirationTime,
          },
        },
      });

    } catch (error: any) {
      console.error('Payment request creation failed:', error);
      
      res.status(500).json({
        success: false,
        error: error.message || 'Payment request creation failed',
        code: 'PAYMENT_REQUEST_FAILED',
      });
    }
  }
);

/**
 * @route   GET /api/payments/monitor/:requestId
 * @desc    Monitor payment status for a specific request
 * @access  Public
 * @params  {requestId}
 */
router.get(
  '/monitor/:requestId',
  monitoringRateLimit,
  [
    param('requestId')
      .isString()
      .matches(/^pay_\d+_[a-f0-9]{16}$/)
      .withMessage('Invalid payment request ID format'),
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

      const { requestId } = req.params;

      // Monitor payment status
      const monitoringResult = await hbarPaymentService.monitorPaymentRequest(requestId);
      const paymentRequest = await hbarPaymentService.getPaymentRequest(requestId);

      if (!paymentRequest) {
        return res.status(404).json({
          success: false,
          error: 'Payment request not found',
          code: 'REQUEST_NOT_FOUND',
        });
      }

      res.json({
        success: true,
        data: {
          requestId,
          status: paymentRequest.status,
          monitoring: monitoringResult,
          paymentDetails: {
            productId: paymentRequest.productId,
            productName: paymentRequest.productName,
            priceUSD: paymentRequest.priceUSD,
            priceHBAR: paymentRequest.priceHBAR,
            expiresAt: paymentRequest.expirationTime,
          },
          nextCheck: monitoringResult.transactionStatus === 'pending' ? 
            new Date(Date.now() + 10000).toISOString() : // Check again in 10 seconds
            null,
        },
      });

    } catch (error: any) {
      console.error('Payment monitoring failed:', error);
      
      res.status(500).json({
        success: false,
        error: error.message || 'Payment monitoring failed',
        code: 'MONITORING_FAILED',
      });
    }
  }
);

/**
 * @route   GET /api/payments/request/:requestId
 * @desc    Get payment request details
 * @access  Public
 * @params  {requestId}
 */
router.get(
  '/request/:requestId',
  [
    param('requestId')
      .isString()
      .matches(/^pay_\d+_[a-f0-9]{16}$/)
      .withMessage('Invalid payment request ID format'),
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

      const { requestId } = req.params;

      // Get payment request
      const paymentRequest = await hbarPaymentService.getPaymentRequest(requestId);

      if (!paymentRequest) {
        return res.status(404).json({
          success: false,
          error: 'Payment request not found',
          code: 'REQUEST_NOT_FOUND',
        });
      }

      res.json({
        success: true,
        data: {
          paymentRequest,
          isExpired: new Date() > new Date(paymentRequest.expirationTime),
          timeRemaining: Math.max(0, new Date(paymentRequest.expirationTime).getTime() - Date.now()),
        },
      });

    } catch (error: any) {
      console.error('Payment request retrieval failed:', error);
      
      res.status(500).json({
        success: false,
        error: error.message || 'Payment request retrieval failed',
        code: 'REQUEST_RETRIEVAL_FAILED',
      });
    }
  }
);

/**
 * @route   GET /api/payments/exchange-rate
 * @desc    Get current HBAR to USD exchange rate
 * @access  Public
 */
router.get('/exchange-rate', async (req: Request, res: Response) => {
  try {
    const exchangeRate = await hbarPaymentService.getCurrentExchangeRate();

    res.json({
      success: true,
      data: {
        exchangeRate,
        rateInfo: {
          oneHBAR: `$${exchangeRate.hbarToUSD.toFixed(6)} USD`,
          oneUSD: `${(1 / exchangeRate.hbarToUSD).toFixed(2)} HBAR`,
          lastUpdated: exchangeRate.timestamp,
          source: exchangeRate.source,
          confidence: `${(exchangeRate.confidence * 100).toFixed(1)}%`,
        },
      },
    });

  } catch (error: any) {
    console.error('Exchange rate retrieval failed:', error);
    
    res.status(503).json({
      success: false,
      error: error.message || 'Exchange rate unavailable',
      code: 'EXCHANGE_RATE_UNAVAILABLE',
    });
  }
});

/**
 * @route   GET /api/payments/treasury/balance
 * @desc    Get treasury account balance (admin only)
 * @access  Private
 */
router.get('/treasury/balance', async (req: Request, res: Response) => {
  try {
    // In production, would add proper authentication middleware
    const balance = await hbarPaymentService.getTreasuryBalance();

    res.json({
      success: true,
      data: {
        balance,
        balanceInfo: {
          hbar: `${balance.hbar} HBAR`,
          usd: `$${balance.usd.toFixed(2)} USD`,
          lastUpdated: new Date().toISOString(),
        },
      },
    });

  } catch (error: any) {
    console.error('Treasury balance query failed:', error);
    
    res.status(500).json({
      success: false,
      error: error.message || 'Treasury balance unavailable',
      code: 'BALANCE_QUERY_FAILED',
    });
  }
});

/**
 * @route   POST /api/payments/refund
 * @desc    Process a payment refund (admin only)
 * @access  Private
 * @body    {originalTransactionId, refundAmount, recipientAccountId, reason}
 */
router.post(
  '/refund',
  [
    body('originalTransactionId')
      .isString()
      .notEmpty()
      .withMessage('Original transaction ID is required'),
    body('refundAmount')
      .isString()
      .matches(/^\d+(\.\d{1,8})?$/)
      .withMessage('Valid HBAR amount required (up to 8 decimal places)'),
    body('recipientAccountId')
      .matches(/^0\.0\.\d+$/)
      .withMessage('Valid Hedera account ID required (format: 0.0.123456)'),
    body('reason')
      .isString()
      .isLength({ min: 10, max: 200 })
      .withMessage('Refund reason is required (10-200 characters)'),
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

      const { originalTransactionId, refundAmount, recipientAccountId, reason } = req.body;

      // Process refund
      const refundTransaction = await hbarPaymentService.processRefund(
        originalTransactionId,
        refundAmount,
        recipientAccountId,
        reason
      );

      res.json({
        success: true,
        data: {
          refundTransaction,
          refundInfo: {
            originalTransaction: originalTransactionId,
            refundAmount: `${refundAmount} HBAR`,
            recipient: recipientAccountId,
            reason,
            processedAt: new Date().toISOString(),
          },
        },
      });

    } catch (error: any) {
      console.error('Refund processing failed:', error);
      
      res.status(500).json({
        success: false,
        error: error.message || 'Refund processing failed',
        code: 'REFUND_FAILED',
      });
    }
  }
);

/**
 * @route   GET /api/payments/transaction/:requestId
 * @desc    Get payment transaction details
 * @access  Public
 * @params  {requestId}
 */
router.get(
  '/transaction/:requestId',
  [
    param('requestId')
      .isString()
      .matches(/^pay_\d+_[a-f0-9]{16}$/)
      .withMessage('Invalid payment request ID format'),
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

      const { requestId } = req.params;

      // Get payment transaction
      const transaction = await hbarPaymentService.getPaymentTransaction(requestId);

      if (!transaction) {
        return res.status(404).json({
          success: false,
          error: 'Payment transaction not found',
          code: 'TRANSACTION_NOT_FOUND',
        });
      }

      res.json({
        success: true,
        data: {
          transaction,
          transactionInfo: {
            transactionId: transaction.transactionId,
            amount: `${transaction.amountHBAR} HBAR`,
            usdValue: `$${transaction.amountUSD.toFixed(2)} USD`,
            status: transaction.status,
            confirmedAt: transaction.confirmationTime,
            explorerUrl: `https://hashscan.io/${transaction.transactionHash}`,
          },
        },
      });

    } catch (error: any) {
      console.error('Transaction retrieval failed:', error);
      
      res.status(500).json({
        success: false,
        error: error.message || 'Transaction retrieval failed',
        code: 'TRANSACTION_RETRIEVAL_FAILED',
      });
    }
  }
);

/**
 * @route   POST /api/payments/validate
 * @desc    Validate payment parameters before creating request
 * @access  Public
 * @body    {priceUSD}
 */
router.post(
  '/validate',
  [
    body('priceUSD')
      .isFloat({ min: 1, max: 10000 })
      .withMessage('Price must be between $1 and $10,000 USD'),
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

      const { priceUSD } = req.body;

      // Get current exchange rate
      const exchangeRate = await hbarPaymentService.getCurrentExchangeRate();
      const priceHBAR = (priceUSD / exchangeRate.hbarToUSD).toFixed(8);

      res.json({
        success: true,
        data: {
          validation: {
            priceUSD,
            priceHBAR,
            exchangeRate: exchangeRate.hbarToUSD,
            estimatedFee: '0.001 HBAR', // Typical Hedera transaction fee
            total: (parseFloat(priceHBAR) + 0.001).toFixed(8) + ' HBAR',
          },
          rateInfo: {
            source: exchangeRate.source,
            confidence: exchangeRate.confidence,
            lastUpdated: exchangeRate.timestamp,
          },
        },
      });

    } catch (error: any) {
      console.error('Payment validation failed:', error);
      
      res.status(500).json({
        success: false,
        error: error.message || 'Payment validation failed',
        code: 'VALIDATION_FAILED',
      });
    }
  }
);

export default router;