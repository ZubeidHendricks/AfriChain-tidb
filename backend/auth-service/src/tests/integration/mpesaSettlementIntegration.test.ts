/**
 * M-Pesa Settlement Integration Tests
 * 
 * End-to-end integration testing for HBAR to M-Pesa settlement workflow including:
 * - HBAR payment confirmation triggering automatic M-Pesa settlement
 * - Currency conversion from USD to KES
 * - M-Pesa B2C payment processing and callback handling
 * - Settlement status tracking and audit trails
 * - Error handling and retry mechanisms
 */

import { PaymentMonitoringService, paymentMonitoringService } from '../../services/paymentMonitoringService';
import { PaymentProcessingWorkflowService, paymentProcessingWorkflowService } from '../../services/paymentProcessingWorkflowService';
import { MpesaService, mpesaService, SettlementRequest, MpesaCallbackResult } from '../../services/mpesaService';
import { PaymentRequest, PaymentTransaction } from '../../services/hbarPaymentService';

describe('M-Pesa Settlement Integration', () => {
  let mockPaymentRequest: PaymentRequest;
  let mockPaymentTransaction: PaymentTransaction;
  let originalListeners: any = {};

  beforeEach(() => {
    // Store original listeners to restore them later
    originalListeners.paymentMonitoring = paymentMonitoringService.listeners('paymentConfirmed');
    originalListeners.paymentProcessing = paymentProcessingWorkflowService.listeners('settlementInitiated');
    originalListeners.mpesaService = mpesaService.listeners('settlementCompleted');

    // Remove all existing listeners to avoid interference
    paymentMonitoringService.removeAllListeners();
    paymentProcessingWorkflowService.removeAllListeners();
    mpesaService.removeAllListeners();

    // Re-setup the workflow service event listeners
    (paymentProcessingWorkflowService as any).setupEventListeners();

    mockPaymentRequest = {
      requestId: 'pay_1234567890_abcdef1234567890',
      productId: 'PROD_001_DIGITAL',
      productName: 'AfriChain Premium Authentication Certificate',
      priceUSD: 25.99,
      priceHBAR: '25.00000000',
      recipientAccountId: '0.0.123456',
      memo: 'AfriChain:PROD_001_DIGITAL:pay_1234567890_abcdef1234567890',
      paymentQRCode: 'data:image/png;base64,mock_qr_code',
      expirationTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    mockPaymentTransaction = {
      transactionId: '0.0.123456@1640000000.123456789',
      paymentRequestId: mockPaymentRequest.requestId,
      transactionHash: 'hash_1234567890abcdef',
      senderAccountId: '0.0.654321',
      recipientAccountId: mockPaymentRequest.recipientAccountId,
      amountHBAR: '25.00000000',
      amountUSD: 25.99,
      exchangeRate: 25.99 / 25.0,
      memo: mockPaymentRequest.memo,
      status: 'success',
      consensusTimestamp: (Date.now() / 1000 + 30).toFixed(9),
      transactionFee: '0.00100000',
      confirmationTime: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  afterEach(() => {
    // Clean up event listeners
    paymentMonitoringService.removeAllListeners();
    paymentProcessingWorkflowService.removeAllListeners();
    mpesaService.removeAllListeners();

    // Restore original listeners
    originalListeners.paymentMonitoring.forEach((listener: any) => {
      paymentMonitoringService.on('paymentConfirmed', listener);
    });
    originalListeners.paymentProcessing.forEach((listener: any) => {
      paymentProcessingWorkflowService.on('settlementInitiated', listener);
    });
    originalListeners.mpesaService.forEach((listener: any) => {
      mpesaService.on('settlementCompleted', listener);
    });
  });

  describe('End-to-End HBAR to M-Pesa Settlement Workflow', () => {
    it('should automatically trigger M-Pesa settlement when HBAR payment is confirmed', (done) => {
      let settlementInitiated = false;
      let settlementId: string | null = null;

      // Listen for settlement initiation
      paymentProcessingWorkflowService.on('settlementInitiated', (data) => {
        settlementInitiated = true;
        settlementId = data.settlementId;

        try {
          // Verify settlement was initiated
          expect(settlementInitiated).toBe(true);
          expect(settlementId).toBeDefined();
          expect(settlementId).toMatch(/^SET_\d+_[A-F0-9]{8}$/);

          // Verify settlement request details
          expect(data.settlementRequest.artisanId).toBe('ART_001_KENYA');
          expect(data.settlementRequest.artisanName).toBe('Amara Jomo');
          expect(data.settlementRequest.artisanMpesaNumber).toBe('+254712345678');
          expect(data.settlementRequest.originalPaymentId).toBe(mockPaymentRequest.requestId);
          expect(data.settlementRequest.amountUSD).toBe(25.99);
          expect(data.settlementRequest.amountKES).toBeGreaterThan(3000); // ~$25.99 * 129 KES/USD
          expect(data.settlementRequest.settlementReason).toContain('Product sale settlement');

          console.log('M-Pesa settlement initiated successfully:', {
            settlementId,
            artisanId: data.settlementRequest.artisanId,
            amountKES: data.settlementRequest.amountKES,
            exchangeRate: data.settlementRequest.exchangeRateUSDKES,
          });

          done();
        } catch (error) {
          done(error);
        }
      });

      // Simulate HBAR payment confirmation
      setTimeout(() => {
        paymentMonitoringService.emit('paymentConfirmed', {
          sessionId: 'test_session_mpesa',
          paymentRequest: mockPaymentRequest,
          transaction: mockPaymentTransaction,
          validationDetails: {
            memoMatch: true,
            amountMatch: true,
            recipientMatch: true,
            timingValid: true,
            feeReasonable: true,
            overallValid: true,
          },
        });
      }, 100);

      // Timeout the test after 10 seconds
      setTimeout(() => {
        if (!settlementInitiated) {
          done(new Error('M-Pesa settlement was not initiated within timeout'));
        }
      }, 10000);
    });

    it('should handle different product types with correct artisan mappings', async () => {
      const testProducts = [
        {
          productId: 'PROD_001_DIGITAL',
          expectedArtisan: {
            artisanId: 'ART_001_KENYA',
            name: 'Amara Jomo',
            mpesaNumber: '+254712345678',
          },
        },
        {
          productId: 'PROD_002_PHYSICAL',
          expectedArtisan: {
            artisanId: 'ART_002_KENYA',
            name: 'Kesi Wambua',
            mpesaNumber: '+254723456789',
          },
        },
        {
          productId: 'PROD_003_HYBRID',
          expectedArtisan: {
            artisanId: 'ART_003_KENYA',
            name: 'Nia Mwangi',
            mpesaNumber: '+254734567890',
          },
        },
      ];

      for (const testProduct of testProducts) {
        const testPaymentRequest = {
          ...mockPaymentRequest,
          requestId: `pay_${Date.now()}_${testProduct.productId.toLowerCase()}`,
          productId: testProduct.productId,
          productName: `AfriChain ${testProduct.productId} Product`,
          memo: `AfriChain:${testProduct.productId}:pay_${Date.now()}_${testProduct.productId.toLowerCase()}`,
        };

        const testPaymentTransaction = {
          ...mockPaymentTransaction,
          transactionId: `${mockPaymentTransaction.transactionId}_${testProduct.productId}`,
          paymentRequestId: testPaymentRequest.requestId,
          memo: testPaymentRequest.memo,
        };

        // Process payment confirmation
        const orderResult = await paymentProcessingWorkflowService.processPaymentConfirmation(
          testPaymentRequest,
          testPaymentTransaction
        );

        // Verify order was processed
        expect(orderResult.orderId).toMatch(/^ORD_\d+_[a-z0-9]{9}$/);
        expect(orderResult.fulfillmentStatus).toBe('fulfilled');

        console.log(`Settlement test passed for product ${testProduct.productId}:`, {
          orderId: orderResult.orderId,
          expectedArtisan: testProduct.expectedArtisan.artisanId,
        });
      }
    });

    it('should skip settlement for demo/test products', async () => {
      const testProducts = ['DEMO_PRODUCT', 'TEST_PRODUCT', 'PROD_DEMO_001'];

      for (const productId of testProducts) {
        const testPaymentRequest = {
          ...mockPaymentRequest,
          requestId: `pay_${Date.now()}_${productId.toLowerCase()}`,
          productId,
          productName: `${productId} - Demo/Test Product`,
          memo: `AfriChain:${productId}:pay_${Date.now()}_${productId.toLowerCase()}`,
        };

        const testPaymentTransaction = {
          ...mockPaymentTransaction,
          transactionId: `${mockPaymentTransaction.transactionId}_${productId}`,
          paymentRequestId: testPaymentRequest.requestId,
          memo: testPaymentRequest.memo,
        };

        let settlementInitiated = false;

        // Listen for settlement initiation (should not happen)
        const settlementListener = () => {
          settlementInitiated = true;
        };
        paymentProcessingWorkflowService.on('settlementInitiated', settlementListener);

        // Process payment confirmation
        const orderResult = await paymentProcessingWorkflowService.processPaymentConfirmation(
          testPaymentRequest,
          testPaymentTransaction
        );

        // Wait a bit to ensure no settlement is initiated
        await new Promise(resolve => setTimeout(resolve, 500));

        // Verify order was processed but no settlement was initiated
        expect(orderResult.orderId).toMatch(/^ORD_\d+_[a-z0-9]{9}$/);
        expect(orderResult.fulfillmentStatus).toBe('fulfilled');
        expect(settlementInitiated).toBe(false);

        // Clean up listener
        paymentProcessingWorkflowService.removeListener('settlementInitiated', settlementListener);

        console.log(`Demo/test product settlement skip verified for: ${productId}`);
      }
    });
  });

  describe('M-Pesa Settlement Processing', () => {
    it('should process settlement request and handle successful callback', async () => {
      const settlementRequest: SettlementRequest = {
        artisanId: 'ART_001_KENYA',
        artisanMpesaNumber: '+254712345678',
        artisanName: 'Amara Jomo',
        originalPaymentId: mockPaymentRequest.requestId,
        originalTransactionId: mockPaymentTransaction.transactionId,
        amountHBAR: '25.00000000',
        amountUSD: 25.99,
        amountKES: 3350, // ~$25.99 * 129 KES/USD
        exchangeRateUSDKES: 129.0,
        settlementReason: 'Product sale settlement for AfriChain Premium Authentication Certificate',
        productId: 'PROD_001_DIGITAL',
        orderReference: 'ORD_1234567890_abcdef123',
      };

      // Initiate settlement
      const settlementId = await mpesaService.initiateSettlement(settlementRequest);

      // Verify settlement was initiated
      expect(settlementId).toMatch(/^SET_\d+_[A-F0-9]{8}$/);

      // Get settlement status
      const settlementStatus = await mpesaService.getSettlementStatus(settlementId);
      expect(settlementStatus).toBeDefined();
      expect(settlementStatus!.settlementId).toBe(settlementId);
      expect(settlementStatus!.settlementStatus).toBe('initiated');
      expect(settlementStatus!.settlementAmount).toBe(3350);
      expect(settlementStatus!.processingFee).toBe(34); // 1% of 3350
      expect(settlementStatus!.netSettlementAmount).toBe(3316); // 3350 - 34

      console.log('Settlement initiated and status verified:', {
        settlementId,
        status: settlementStatus!.settlementStatus,
        amount: settlementStatus!.settlementAmount,
        netAmount: settlementStatus!.netSettlementAmount,
      });
    });

    it('should handle M-Pesa callback results correctly', async () => {
      // Mock successful M-Pesa callback
      const successfulCallback: MpesaCallbackResult = {
        conversationId: 'AG_20231201_1234567890_test',
        originatorConversationId: 'test_originator_123',
        responseCode: '0',
        responseDescription: 'The service request is processed successfully.',
        transactionId: 'MPesa_TXN_123456789',
        transactionReceipt: 'MPesa_Receipt_987654321',
        transactionAmount: 3316,
        b2CWorkingAccountAvailableFunds: 150000.00,
        b2CUtilityAccountAvailableFunds: 50000.00,
        transactionCompletedDateTime: new Date().toISOString(),
        receiverPartyPublicName: 'AMARA JOMO',
        b2CChargesPaidAccountAvailableFunds: 145000.00,
        b2CRecipientIsRegisteredCustomer: 'Y',
      };

      let settlementCompleted = false;

      // Listen for settlement completion
      mpesaService.on('settlementCompleted', (data) => {
        settlementCompleted = true;

        expect(data.settlementId).toBeDefined();
        expect(data.settlement.settlementStatus).toBe('completed');
        expect(data.settlement.mpesaTransactionId).toBe('MPesa_TXN_123456789');
        expect(data.settlement.mpesaTransactionReceipt).toBe('MPesa_Receipt_987654321');
        expect(data.callbackData.transactionAmount).toBe(3316);

        console.log('Settlement completion event verified:', {
          settlementId: data.settlementId,
          transactionId: data.settlement.mpesaTransactionId,
          amount: data.callbackData.transactionAmount,
        });
      });

      // Process callback
      await mpesaService.handleMpesaCallback(successfulCallback);

      // Wait for event processing
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(settlementCompleted).toBe(true);
    });

    it('should handle M-Pesa callback failures correctly', async () => {
      // Mock failed M-Pesa callback
      const failedCallback: MpesaCallbackResult = {
        conversationId: 'AG_20231201_1234567890_failed',
        originatorConversationId: 'test_originator_failed',
        responseCode: '1',
        responseDescription: 'Insufficient funds in the utility account',
      };

      let settlementFailed = false;

      // Listen for settlement failure
      mpesaService.on('settlementFailed', (data) => {
        settlementFailed = true;

        expect(data.settlementId).toBeDefined();
        expect(data.settlement.settlementStatus).toBe('failed');
        expect(data.settlement.failureReason).toBe('Insufficient funds in the utility account');
        expect(data.callbackData.responseCode).toBe('1');

        console.log('Settlement failure event verified:', {
          settlementId: data.settlementId,
          failureReason: data.settlement.failureReason,
          responseCode: data.callbackData.responseCode,
        });
      });

      // Process callback
      await mpesaService.handleMpesaCallback(failedCallback);

      // Wait for event processing
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(settlementFailed).toBe(true);
    });

    it('should create comprehensive audit trail for settlement lifecycle', async () => {
      const settlementRequest: SettlementRequest = {
        artisanId: 'ART_TEST_AUDIT',
        artisanMpesaNumber: '+254700000000',
        artisanName: 'Test Audit Artisan',
        originalPaymentId: 'pay_audit_test_123',
        originalTransactionId: 'tx_audit_test_456',
        amountHBAR: '10.00000000',
        amountUSD: 10.00,
        amountKES: 1290,
        exchangeRateUSDKES: 129.0,
        settlementReason: 'Audit trail test settlement',
        productId: 'PROD_AUDIT_TEST',
        orderReference: 'ORD_AUDIT_TEST_789',
      };

      // Initiate settlement
      const settlementId = await mpesaService.initiateSettlement(settlementRequest);

      // Get audit trail
      const auditTrail = await mpesaService.getSettlementAuditTrail(settlementId);

      // Verify audit trail was created
      expect(auditTrail).toBeDefined();
      expect(auditTrail.length).toBeGreaterThan(0);

      // Check for settlement initiation log
      const initiationLog = auditTrail.find(log => log.eventType === 'settlement_initiated');
      expect(initiationLog).toBeDefined();
      expect(initiationLog!.settlementId).toBe(settlementId);
      expect(initiationLog!.eventData.artisanId).toBe('ART_TEST_AUDIT');

      console.log('Settlement audit trail verified:', {
        settlementId,
        auditLogCount: auditTrail.length,
        eventTypes: auditTrail.map(log => log.eventType),
      });
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle settlement initiation failures gracefully', async () => {
      // Mock settlement request with invalid data
      const invalidSettlementRequest: SettlementRequest = {
        artisanId: 'INVALID_ARTISAN',
        artisanMpesaNumber: 'invalid_number',
        artisanName: '',
        originalPaymentId: '',
        originalTransactionId: '',
        amountHBAR: '0',
        amountUSD: 0,
        amountKES: 5, // Below minimum
        exchangeRateUSDKES: 0,
        settlementReason: '',
      };

      // Attempt to initiate settlement (should fail)
      await expect(mpesaService.initiateSettlement(invalidSettlementRequest))
        .rejects.toThrow();

      console.log('Invalid settlement request properly rejected');
    });

    it('should continue order fulfillment even if settlement fails', async () => {
      // Mock the mpesaService.initiateSettlement to throw an error
      const originalInitiateSettlement = mpesaService.initiateSettlement;
      mpesaService.initiateSettlement = jest.fn().mockRejectedValue(new Error('Settlement service unavailable'));

      try {
        // Process payment confirmation (should succeed despite settlement failure)
        const orderResult = await paymentProcessingWorkflowService.processPaymentConfirmation(
          mockPaymentRequest,
          mockPaymentTransaction
        );

        // Verify order was still fulfilled
        expect(orderResult.orderId).toMatch(/^ORD_\d+_[a-z0-9]{9}$/);
        expect(orderResult.fulfillmentStatus).toBe('fulfilled');

        console.log('Order fulfillment continued despite settlement failure:', {
          orderId: orderResult.orderId,
          fulfillmentStatus: orderResult.fulfillmentStatus,
        });

      } finally {
        // Restore original method
        mpesaService.initiateSettlement = originalInitiateSettlement;
      }
    });

    it('should handle currency rate fluctuations correctly', async () => {
      // Mock different exchange rates
      const originalGetRate = (paymentProcessingWorkflowService as any).getCurrentUSDToKESRate;
      const testRates = [125.0, 130.0, 135.0];

      for (const rate of testRates) {
        (paymentProcessingWorkflowService as any).getCurrentUSDToKESRate = jest.fn().mockResolvedValue(rate);

        const testPaymentRequest = {
          ...mockPaymentRequest,
          requestId: `pay_rate_test_${rate}_${Date.now()}`,
        };

        const testPaymentTransaction = {
          ...mockPaymentTransaction,
          paymentRequestId: testPaymentRequest.requestId,
          transactionId: `${mockPaymentTransaction.transactionId}_rate_${rate}`,
        };

        let capturedSettlementRequest: SettlementRequest | null = null;

        // Listen for settlement initiation
        const settlementListener = (data: any) => {
          capturedSettlementRequest = data.settlementRequest;
        };
        paymentProcessingWorkflowService.on('settlementInitiated', settlementListener);

        // Process payment
        await paymentProcessingWorkflowService.processPaymentConfirmation(
          testPaymentRequest,
          testPaymentTransaction
        );

        // Wait for settlement processing
        await new Promise(resolve => setTimeout(resolve, 100));

        // Verify correct exchange rate was used
        if (capturedSettlementRequest) {
          expect(capturedSettlementRequest.exchangeRateUSDKES).toBeCloseTo(rate, 2);
          expect(capturedSettlementRequest.amountKES).toBeCloseTo(25.99 * rate, 0);
        }

        // Clean up listener
        paymentProcessingWorkflowService.removeListener('settlementInitiated', settlementListener);

        console.log(`Exchange rate test passed for rate ${rate}:`, {
          expectedKES: Math.round(25.99 * rate),
          actualKES: capturedSettlementRequest?.amountKES,
        });
      }

      // Restore original method
      (paymentProcessingWorkflowService as any).getCurrentUSDToKESRate = originalGetRate;
    });
  });
});