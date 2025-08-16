/**
 * M-Pesa Payment Request Routes Integration Tests
 * 
 * Comprehensive integration testing for M-Pesa payment request API routes including:
 * - STK Push payment initiation endpoints
 * - Payment status checking and monitoring
 * - Payment validation and confirmation webhooks
 * - Payment cancellation and reconciliation
 * - Error handling and validation
 * - Rate limiting and security
 */

import request from 'supertest';
import express from 'express';
import { mpesaPaymentRequestService, MpesaPaymentRequest } from '../../services/mpesaPaymentRequestService';
import mpesaPaymentRequestRoutes from '../../routes/mpesaPaymentRequestRoutes';

// Create test app
const app = express();
app.use(express.json());
app.use('/api/mpesa/payment-request', mpesaPaymentRequestRoutes);

// Mock the service to avoid external dependencies
jest.mock('../../services/mpesaPaymentRequestService');

describe('M-Pesa Payment Request Routes Integration', () => {
  let mockPaymentRequest: MpesaPaymentRequest;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    mockPaymentRequest = {
      paymentRequestId: 'mpesa_req_1234567890_abcdef12',
      customerMpesaNumber: '254712345678',
      customerName: 'John Doe',
      amount: 1000,
      currency: 'KES',
      description: 'Test payment',
      merchantRequestId: 'MR123456789',
      checkoutRequestId: 'COR123456789',
      originalHBARPaymentId: 'pay_hbar_123',
      originalOrderId: 'order_456',
      accountReference: 'ACC12345',
      transactionDesc: 'Test payment transaction',
      status: 'pending',
      responseCode: '0',
      responseDescription: 'Success. Request accepted for processing',
      phoneNumber: '254712345678',
      expirationTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      callbackUrl: 'https://example.com/callback',
      resultUrl: 'https://example.com/result',
      queueTimeoutUrl: 'https://example.com/timeout',
      retryCount: 0,
      maxRetries: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  describe('POST /api/mpesa/payment-request/stk-push', () => {
    it('should initiate STK Push payment successfully', async () => {
      // Mock successful STK Push initiation
      (mpesaPaymentRequestService.initiateSTKPush as jest.Mock).mockResolvedValue(mockPaymentRequest);

      const response = await request(app)
        .post('/api/mpesa/payment-request/stk-push')
        .send({
          customerPhone: '+254712345678',
          amount: 1000,
          accountReference: 'ACC12345',
          transactionDesc: 'Test payment',
          originalHBARPaymentId: 'pay_hbar_123',
          originalOrderId: 'order_456',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('STK Push initiated successfully');
      expect(response.body.data.paymentRequestId).toBe(mockPaymentRequest.paymentRequestId);
      expect(response.body.data.merchantRequestId).toBe(mockPaymentRequest.merchantRequestId);
      expect(response.body.data.checkoutRequestId).toBe(mockPaymentRequest.checkoutRequestId);
      expect(response.body.data.amount).toBe(1000);
      expect(response.body.data.status).toBe('pending');

      // Verify service was called with correct parameters
      expect(mpesaPaymentRequestService.initiateSTKPush).toHaveBeenCalledWith(
        '+254712345678',
        1000,
        'ACC12345',
        'Test payment',
        'pay_hbar_123',
        'order_456'
      );
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/mpesa/payment-request/stk-push')
        .send({
          // Missing required fields
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
      expect(response.body.details).toHaveLength(4); // customerPhone, amount, accountReference, transactionDesc
    });

    it('should validate phone number format', async () => {
      const response = await request(app)
        .post('/api/mpesa/payment-request/stk-push')
        .send({
          customerPhone: 'invalid-phone',
          amount: 1000,
          accountReference: 'ACC12345',
          transactionDesc: 'Test payment',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.details.some((detail: any) => 
        detail.path === 'customerPhone' && detail.msg.includes('Valid Kenyan phone number')
      )).toBe(true);
    });

    it('should validate amount range', async () => {
      const response = await request(app)
        .post('/api/mpesa/payment-request/stk-push')
        .send({
          customerPhone: '+254712345678',
          amount: 200000, // Above maximum
          accountReference: 'ACC12345',
          transactionDesc: 'Test payment',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.details.some((detail: any) => 
        detail.path === 'amount' && detail.msg.includes('between KES 1 and KES 150,000')
      )).toBe(true);
    });

    it('should handle service errors', async () => {
      // Mock service error
      (mpesaPaymentRequestService.initiateSTKPush as jest.Mock).mockRejectedValue(
        new Error('M-Pesa service unavailable')
      );

      const response = await request(app)
        .post('/api/mpesa/payment-request/stk-push')
        .send({
          customerPhone: '+254712345678',
          amount: 1000,
          accountReference: 'ACC12345',
          transactionDesc: 'Test payment',
        });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('STK Push initiation failed');
      expect(response.body.message).toBe('M-Pesa service unavailable');
    });
  });

  describe('GET /api/mpesa/payment-request/:paymentRequestId/status', () => {
    it('should get payment request status successfully', async () => {
      // Mock successful status retrieval
      (mpesaPaymentRequestService.getPaymentRequest as jest.Mock).mockResolvedValue(mockPaymentRequest);

      const response = await request(app)
        .get('/api/mpesa/payment-request/mpesa_req_1234567890_abcdef12/status');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.paymentRequestId).toBe(mockPaymentRequest.paymentRequestId);
      expect(response.body.data.status).toBe(mockPaymentRequest.status);
      expect(response.body.data.amount).toBe(mockPaymentRequest.amount);
      expect(response.body.data.merchantRequestId).toBe(mockPaymentRequest.merchantRequestId);

      // Verify service was called
      expect(mpesaPaymentRequestService.getPaymentRequest).toHaveBeenCalledWith(
        'mpesa_req_1234567890_abcdef12'
      );
    });

    it('should return 404 for non-existent payment request', async () => {
      // Mock payment request not found
      (mpesaPaymentRequestService.getPaymentRequest as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .get('/api/mpesa/payment-request/mpesa_req_nonexistent_12345678/status');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Payment request not found');
    });

    it('should validate payment request ID format', async () => {
      const response = await request(app)
        .get('/api/mpesa/payment-request/invalid-id/status');

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
    });
  });

  describe('POST /api/mpesa/payment-request/:paymentRequestId/check-status', () => {
    it('should check STK Push status with M-Pesa successfully', async () => {
      const mockStatusResult = {
        resultCode: '0',
        resultDesc: 'Success',
        merchantRequestId: 'MR123456789',
        checkoutRequestId: 'COR123456789',
        responseCode: '0',
        responseDescription: 'Payment successful',
      };

      // Mock payment request and status check
      (mpesaPaymentRequestService.getPaymentRequest as jest.Mock).mockResolvedValue(mockPaymentRequest);
      (mpesaPaymentRequestService.checkSTKPushStatus as jest.Mock).mockResolvedValue(mockStatusResult);

      const response = await request(app)
        .post('/api/mpesa/payment-request/mpesa_req_1234567890_abcdef12/check-status');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('STK Push status check completed');
      expect(response.body.data.paymentRequestId).toBe('mpesa_req_1234567890_abcdef12');
      expect(response.body.data.statusResult).toEqual(mockStatusResult);

      // Verify service calls
      expect(mpesaPaymentRequestService.getPaymentRequest).toHaveBeenCalledWith(
        'mpesa_req_1234567890_abcdef12'
      );
      expect(mpesaPaymentRequestService.checkSTKPushStatus).toHaveBeenCalledWith(
        mockPaymentRequest.checkoutRequestId
      );
    });
  });

  describe('POST /api/mpesa/payment-request/:paymentRequestId/cancel', () => {
    it('should cancel payment request successfully', async () => {
      // Mock successful cancellation
      (mpesaPaymentRequestService.cancelPaymentRequest as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/mpesa/payment-request/mpesa_req_1234567890_abcdef12/cancel')
        .send({
          reason: 'Customer requested cancellation',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Payment request cancelled successfully');
      expect(response.body.data.paymentRequestId).toBe('mpesa_req_1234567890_abcdef12');
      expect(response.body.data.reason).toBe('Customer requested cancellation');

      // Verify service was called
      expect(mpesaPaymentRequestService.cancelPaymentRequest).toHaveBeenCalledWith(
        'mpesa_req_1234567890_abcdef12',
        'Customer requested cancellation'
      );
    });

    it('should validate cancellation reason', async () => {
      const response = await request(app)
        .post('/api/mpesa/payment-request/mpesa_req_1234567890_abcdef12/cancel')
        .send({
          reason: 'Too short', // Less than 5 characters
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
    });
  });

  describe('POST /api/mpesa/payment-request/callback/stk-push', () => {
    it('should handle successful STK Push callback', async () => {
      // Mock successful callback handling
      (mpesaPaymentRequestService.handleSTKCallback as jest.Mock).mockResolvedValue(undefined);

      const callbackPayload = {
        Body: {
          stkCallback: {
            MerchantRequestID: 'MR123456789',
            CheckoutRequestID: 'COR123456789',
            ResultCode: 0,
            ResultDesc: 'The service request is processed successfully.',
            CallbackMetadata: {
              Item: [
                { Name: 'Amount', Value: 1000 },
                { Name: 'MpesaReceiptNumber', Value: 'QA123456789' },
                { Name: 'Balance', Value: 5000 },
                { Name: 'TransactionDate', Value: 20231201120000 },
                { Name: 'PhoneNumber', Value: 254712345678 },
              ],
            },
          },
        },
      };

      const response = await request(app)
        .post('/api/mpesa/payment-request/callback/stk-push')
        .send(callbackPayload);

      expect(response.status).toBe(200);
      expect(response.body.ResultCode).toBe(0);
      expect(response.body.ResultDesc).toBe('Callback processed successfully');

      // Verify service was called with correct data
      expect(mpesaPaymentRequestService.handleSTKCallback).toHaveBeenCalledWith({
        merchantRequestId: 'MR123456789',
        checkoutRequestId: 'COR123456789',
        resultCode: '0',
        resultDesc: 'The service request is processed successfully.',
        callbackMetadata: {
          amount: 1000,
          mpesaReceiptNumber: 'QA123456789',
          balance: 5000,
          transactionDate: '20231201120000',
          phoneNumber: '254712345678',
        },
      });
    });

    it('should handle failed STK Push callback', async () => {
      // Mock callback handling
      (mpesaPaymentRequestService.handleSTKCallback as jest.Mock).mockResolvedValue(undefined);

      const failedCallbackPayload = {
        Body: {
          stkCallback: {
            MerchantRequestID: 'MR123456789',
            CheckoutRequestID: 'COR123456789',
            ResultCode: 1,
            ResultDesc: 'The balance is insufficient for the transaction.',
          },
        },
      };

      const response = await request(app)
        .post('/api/mpesa/payment-request/callback/stk-push')
        .send(failedCallbackPayload);

      expect(response.status).toBe(200);
      expect(response.body.ResultCode).toBe(0);
      expect(response.body.ResultDesc).toBe('Callback processed successfully');

      // Verify service was called with failed callback data
      expect(mpesaPaymentRequestService.handleSTKCallback).toHaveBeenCalledWith({
        merchantRequestId: 'MR123456789',
        checkoutRequestId: 'COR123456789',
        resultCode: '1',
        resultDesc: 'The balance is insufficient for the transaction.',
        callbackMetadata: undefined,
      });
    });

    it('should handle invalid callback structure', async () => {
      const invalidCallbackPayload = {
        // Missing required structure
        InvalidData: 'test',
      };

      const response = await request(app)
        .post('/api/mpesa/payment-request/callback/stk-push')
        .send(invalidCallbackPayload);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Invalid callback data structure');
    });

    it('should handle callback processing errors gracefully', async () => {
      // Mock service error
      (mpesaPaymentRequestService.handleSTKCallback as jest.Mock).mockRejectedValue(
        new Error('Callback processing failed')
      );

      const callbackPayload = {
        Body: {
          stkCallback: {
            MerchantRequestID: 'MR123456789',
            CheckoutRequestID: 'COR123456789',
            ResultCode: 0,
            ResultDesc: 'Success',
          },
        },
      };

      const response = await request(app)
        .post('/api/mpesa/payment-request/callback/stk-push')
        .send(callbackPayload);

      expect(response.status).toBe(200);
      expect(response.body.ResultCode).toBe(1);
      expect(response.body.ResultDesc).toBe('Callback processing failed');
    });
  });

  describe('POST /api/mpesa/payment-request/validation', () => {
    it('should handle payment validation request', async () => {
      // Mock successful validation
      (mpesaPaymentRequestService.handlePaymentValidation as jest.Mock).mockResolvedValue({
        resultCode: '0',
        resultDesc: 'Payment validation successful',
      });

      const validationPayload = {
        TransactionType: 'Pay Bill',
        TransID: 'TXN123456789',
        TransTime: '20231201120000',
        TransAmount: '1000.00',
        BusinessShortCode: '123456',
        BillRefNumber: 'ACC12345',
        MSISDN: '254712345678',
        FirstName: 'John',
        LastName: 'Doe',
      };

      const response = await request(app)
        .post('/api/mpesa/payment-request/validation')
        .send(validationPayload);

      expect(response.status).toBe(200);
      expect(response.body.ResultCode).toBe('0');
      expect(response.body.ResultDesc).toBe('Payment validation successful');

      // Verify service was called
      expect(mpesaPaymentRequestService.handlePaymentValidation).toHaveBeenCalled();
    });

    it('should handle validation failures', async () => {
      // Mock validation failure
      (mpesaPaymentRequestService.handlePaymentValidation as jest.Mock).mockResolvedValue({
        resultCode: '1',
        resultDesc: 'Payment validation failed',
      });

      const validationPayload = {
        TransactionType: 'Pay Bill',
        TransID: 'INVALID_TXN',
        TransTime: '20231201120000',
        TransAmount: '1000.00',
        BusinessShortCode: '123456',
        BillRefNumber: 'INVALID_REF',
        MSISDN: '254712345678',
      };

      const response = await request(app)
        .post('/api/mpesa/payment-request/validation')
        .send(validationPayload);

      expect(response.status).toBe(200);
      expect(response.body.ResultCode).toBe('1');
      expect(response.body.ResultDesc).toBe('Payment validation failed');
    });
  });

  describe('POST /api/mpesa/payment-request/confirmation', () => {
    it('should handle payment confirmation request', async () => {
      // Mock successful confirmation
      (mpesaPaymentRequestService.handlePaymentConfirmation as jest.Mock).mockResolvedValue({
        resultCode: '0',
        resultDesc: 'Payment confirmation processed successfully',
      });

      const confirmationPayload = {
        TransactionType: 'Pay Bill',
        TransID: 'TXN123456789',
        TransTime: '20231201120000',
        TransAmount: '1000.00',
        BusinessShortCode: '123456',
        BillRefNumber: 'ACC12345',
        MSISDN: '254712345678',
        FirstName: 'John',
        LastName: 'Doe',
      };

      const response = await request(app)
        .post('/api/mpesa/payment-request/confirmation')
        .send(confirmationPayload);

      expect(response.status).toBe(200);
      expect(response.body.ResultCode).toBe('0');
      expect(response.body.ResultDesc).toBe('Payment confirmation processed successfully');

      // Verify service was called
      expect(mpesaPaymentRequestService.handlePaymentConfirmation).toHaveBeenCalled();
    });
  });

  describe('POST /api/mpesa/payment-request/reconcile', () => {
    it('should perform payment reconciliation successfully', async () => {
      const mockReconciliationResult = {
        totalRequests: 100,
        completedPayments: 95,
        failedPayments: 3,
        pendingPayments: 2,
        totalAmount: 50000,
        reconciliationStatus: 'balanced' as const,
        discrepancies: [],
        lastReconciledAt: new Date().toISOString(),
      };

      // Mock successful reconciliation
      (mpesaPaymentRequestService.reconcilePayments as jest.Mock).mockResolvedValue(mockReconciliationResult);

      const response = await request(app)
        .post('/api/mpesa/payment-request/reconcile')
        .send({
          startDate: '2023-12-01T00:00:00Z',
          endDate: '2023-12-31T23:59:59Z',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Payment reconciliation completed');
      expect(response.body.data).toEqual(mockReconciliationResult);

      // Verify service was called with correct dates
      expect(mpesaPaymentRequestService.reconcilePayments).toHaveBeenCalledWith(
        new Date('2023-12-01T00:00:00Z'),
        new Date('2023-12-31T23:59:59Z')
      );
    });

    it('should validate date range', async () => {
      const response = await request(app)
        .post('/api/mpesa/payment-request/reconcile')
        .send({
          startDate: '2023-12-31T23:59:59Z',
          endDate: '2023-12-01T00:00:00Z', // End date before start date
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Invalid date range');
      expect(response.body.message).toBe('Start date must be before end date');
    });
  });

  describe('GET /api/mpesa/payment-request/health', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/api/mpesa/payment-request/health');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.service).toBe('mpesa-payment-request');
      expect(response.body.data.status).toBe('healthy');
      expect(response.body.data.features).toEqual({
        stkPush: true,
        paymentValidation: true,
        paymentConfirmation: true,
        reconciliation: true,
        callbacks: true,
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle service unavailable errors', async () => {
      // Mock service error
      (mpesaPaymentRequestService.getPaymentRequest as jest.Mock).mockRejectedValue(
        new Error('Database connection failed')
      );

      const response = await request(app)
        .get('/api/mpesa/payment-request/mpesa_req_1234567890_abcdef12/status');

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Failed to get payment request status');
    });

    it('should handle validation errors consistently', async () => {
      const response = await request(app)
        .post('/api/mpesa/payment-request/stk-push')
        .send({
          customerPhone: 'invalid',
          amount: -100,
          accountReference: '',
          transactionDesc: '',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
      expect(response.body.details).toBeDefined();
      expect(Array.isArray(response.body.details)).toBe(true);
    });
  });
});