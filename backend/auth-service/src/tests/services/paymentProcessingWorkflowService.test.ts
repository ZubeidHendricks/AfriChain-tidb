/**
 * Payment Processing Workflow Service Tests
 * 
 * Comprehensive test suite for the payment processing workflow including:
 * - Payment confirmation to order processing trigger
 * - Payment status updates for users
 * - Payment refund capability for failed orders
 * - Comprehensive payment logging and audit trails
 */

import { PaymentProcessingWorkflowService, PaymentStatusUpdate, RefundRequest } from '../../services/paymentProcessingWorkflowService';
import { PaymentRequest, PaymentTransaction } from '../../services/hbarPaymentService';

describe('PaymentProcessingWorkflowService', () => {
  let workflowService: PaymentProcessingWorkflowService;

  beforeEach(() => {
    workflowService = new PaymentProcessingWorkflowService({
      autoProcessOrders: true,
      requireManualApproval: false,
      refundApprovalRequired: false, // Disable for testing
    });
  });

  afterEach(() => {
    // Clean up event listeners
    workflowService.removeAllListeners();
    
    // Clear any intervals/timeouts that might be running
    jest.clearAllTimers();
  });

  describe('Payment Confirmation Processing', () => {
    it('should process payment confirmation and trigger order fulfillment', async () => {
      const mockPaymentRequest: PaymentRequest = {
        requestId: 'pay_1234567890_abcdef1234567890',
        productId: 'PROD_001',
        productName: 'AfriChain Premium Authentication',
        priceUSD: 25.99,
        priceHBAR: '25.00000000',
        recipientAccountId: '0.0.123456',
        memo: 'AfriChain-PROD_001-pay_1234567890_abcdef1234567890',
        paymentQRCode: 'data:image/png;base64,mock_qr_code',
        expirationTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const mockTransaction: PaymentTransaction = {
        transactionId: 'TXN_1234567890_abcdef',
        paymentRequestId: mockPaymentRequest.requestId,
        transactionHash: 'hash_1234567890abcdef',
        amountHBAR: '25.00000000',
        amountUSD: 25.99,
        recipientAccountId: '0.0.123456',
        exchangeRate: 1.0,
        memo: mockPaymentRequest.memo,
        status: 'success',
        confirmationTime: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await workflowService.processPaymentConfirmation(
        mockPaymentRequest,
        mockTransaction,
        { email: 'customer@example.com' }
      );

      expect(result).toBeDefined();
      expect(result.orderId).toBeDefined();
      expect(result.fulfillmentStatus).toBe('fulfilled');
      expect(result.digitalAssets).toBeDefined();
      expect(result.digitalAssets!.downloadLinks).toHaveLength(2);
      expect(result.digitalAssets!.accessCodes).toHaveLength(1);
    });

    it('should handle payment confirmation processing even with invalid data', async () => {
      const mockPaymentRequest: PaymentRequest = {
        requestId: 'pay_invalid',
        productId: '',
        productName: '',
        priceUSD: -1,
        priceHBAR: 'invalid',
        recipientAccountId: '0.0.123456',
        memo: '',
        paymentQRCode: '',
        expirationTime: new Date().toISOString(),
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const mockTransaction: PaymentTransaction = {
        transactionId: 'TXN_invalid',
        paymentRequestId: mockPaymentRequest.requestId,
        transactionHash: '',
        amountHBAR: 'invalid',
        amountUSD: -1,
        recipientAccountId: '0.0.123456',
        exchangeRate: 1.0,
        memo: '',
        status: 'failed',
        confirmationTime: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await workflowService.processPaymentConfirmation(mockPaymentRequest, mockTransaction);
      
      expect(result).toBeDefined();
      expect(result.orderId).toBeDefined();
      expect(result.fulfillmentStatus).toBe('fulfilled');
    });
  });

  describe('Order Fulfillment Processing', () => {
    it('should process digital order fulfillment successfully', async () => {
      const orderRequest = {
        paymentRequestId: 'pay_1234567890_abcdef1234567890',
        paymentTransactionId: 'TXN_1234567890_abcdef',
        productId: 'PROD_001',
        productName: 'AfriChain Premium Authentication',
        customerInfo: { email: 'customer@example.com' },
        paymentDetails: {
          amountHBAR: '25.00000000',
          amountUSD: 25.99,
          transactionHash: 'hash_1234567890abcdef',
          confirmationTime: new Date().toISOString(),
        },
        fulfillmentInstructions: {
          fulfillmentType: 'digital' as const,
          priority: 'standard' as const,
        },
      };

      const result = await workflowService.processOrderFulfillment(orderRequest);

      expect(result).toBeDefined();
      expect(result.fulfillmentStatus).toBe('fulfilled');
      expect(result.digitalAssets).toBeDefined();
      expect(result.digitalAssets!.downloadLinks).toContain('https://africhain.com/downloads/product-certificate.pdf');
      expect(result.digitalAssets!.downloadLinks).toContain('https://africhain.com/downloads/authenticity-report.json');
      expect(result.digitalAssets!.accessCodes).toHaveLength(1);
      expect(result.digitalAssets!.expirationDate).toBeDefined();
    });

    it('should handle physical order fulfillment', async () => {
      const orderRequest = {
        paymentRequestId: 'pay_1234567890_abcdef1234567890',
        paymentTransactionId: 'TXN_1234567890_abcdef',
        productId: 'PROD_002',
        productName: 'Physical Product',
        customerInfo: { 
          email: 'customer@example.com',
          deliveryAddress: '123 Main St, City, Country'
        },
        paymentDetails: {
          amountHBAR: '50.00000000',
          amountUSD: 49.99,
          transactionHash: 'hash_1234567890abcdef',
          confirmationTime: new Date().toISOString(),
        },
        fulfillmentInstructions: {
          fulfillmentType: 'physical' as const,
          priority: 'express' as const,
        },
      };

      const result = await workflowService.processOrderFulfillment(orderRequest);

      expect(result).toBeDefined();
      expect(result.fulfillmentStatus).toBe('processing');
      expect(result.trackingInfo).toBeDefined();
      expect(result.trackingInfo!.trackingNumber).toBeDefined();
      expect(result.trackingInfo!.carrier).toBe('DHL Express');
      expect(result.trackingInfo!.estimatedDelivery).toBeDefined();
    });
  });

  describe('Refund Processing', () => {
    it('should request refund successfully', async () => {
      const refundRequest: RefundRequest = {
        originalPaymentRequestId: 'pay_1234567890_abcdef1234567890',
        originalTransactionId: 'TXN_1234567890_abcdef',
        refundReason: 'customer_request',
        refundAmount: '25.00000000',
        refundAmountUSD: 25.99,
        customerAccountId: '0.0.654321',
        customerEmail: 'customer@example.com',
        priority: 'standard',
        requestedBy: 'customer_service',
      };

      const refundId = await workflowService.requestRefund(refundRequest);

      expect(refundId).toBeDefined();
      expect(refundId).toMatch(/^REF_\d+_[a-z0-9]+$/);
    });

    it('should handle refund request with auto-approval', async () => {
      const refundRequest: RefundRequest = {
        originalPaymentRequestId: 'pay_1234567890_abcdef1234567890',
        originalTransactionId: 'TXN_1234567890_abcdef',
        refundReason: 'system_error', // This will trigger auto-approval
        refundAmount: '25.00000000',
        refundAmountUSD: 25.99,
        customerAccountId: '0.0.654321',
        customerEmail: 'customer@example.com',
        priority: 'urgent',
        requestedBy: 'admin',
      };

      // Test the refund request - it should auto-approve for system errors
      const refundId = await workflowService.requestRefund(refundRequest);
      
      expect(refundId).toBeDefined();
      expect(refundId).toMatch(/^REF_\d+_[a-z0-9]+$/);
      
      // Since it's auto-approved, we can't test the manual approval
      // but we can verify the refund was requested successfully
    });

    it('should validate refund requests properly', async () => {
      const invalidRefundRequest: RefundRequest = {
        originalPaymentRequestId: '',
        originalTransactionId: 'TXN_1234567890_abcdef',
        refundReason: 'customer_request',
        refundAmount: '-1',
        refundAmountUSD: -1,
        customerAccountId: '0.0.654321',
        priority: 'standard',
        requestedBy: 'customer_service',
      };

      await expect(
        workflowService.requestRefund(invalidRefundRequest)
      ).rejects.toThrow('Original payment request ID is required');
    });
  });

  describe('Audit Trail', () => {
    it('should retrieve payment audit trail', async () => {
      const paymentRequestId = 'pay_1234567890_abcdef1234567890';
      
      const auditTrail = await workflowService.getPaymentAuditTrail(paymentRequestId);

      expect(auditTrail).toBeDefined();
      expect(Array.isArray(auditTrail)).toBe(true);
      expect(auditTrail.length).toBeGreaterThan(0);
    });
  });

  describe('Workflow Statistics', () => {
    it('should provide workflow statistics', async () => {
      const stats = await workflowService.getWorkflowStatistics('day');

      expect(stats).toBeDefined();
      expect(typeof stats.totalPayments).toBe('number');
      expect(typeof stats.confirmedPayments).toBe('number');
      expect(stats.customerSatisfactionRate).toBeLessThanOrEqual(100);
    });
  });
});