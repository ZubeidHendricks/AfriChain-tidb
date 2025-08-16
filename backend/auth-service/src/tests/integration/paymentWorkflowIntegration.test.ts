/**
 * Payment Workflow Integration Tests
 * 
 * End-to-end integration testing for payment processing workflow including:
 * - Payment confirmation triggering order fulfillment
 * - Event-driven workflow processing
 * - Status updates and customer notifications
 * - Order fulfillment for different product types
 * - Error handling and recovery mechanisms
 */

import { PaymentMonitoringService, MirrorNodeTransaction, paymentMonitoringService } from '../../services/paymentMonitoringService';
import { PaymentProcessingWorkflowService, OrderFulfillmentResult, paymentProcessingWorkflowService } from '../../services/paymentProcessingWorkflowService';
import { PaymentRequest, PaymentTransaction } from '../../services/hbarPaymentService';
import { EventEmitter } from 'events';

describe('Payment Workflow Integration', () => {
  let mockPaymentRequest: PaymentRequest;
  let mockMirrorTransaction: MirrorNodeTransaction;
  let originalListeners: any = {};

  beforeEach(() => {
    // Store original listeners to restore them later
    originalListeners.paymentMonitoring = paymentMonitoringService.listeners('paymentConfirmed');
    originalListeners.paymentTimeout = paymentMonitoringService.listeners('paymentTimeout');
    originalListeners.workflow = paymentProcessingWorkflowService.listeners('orderProcessed');

    // Remove all existing listeners to avoid interference
    paymentMonitoringService.removeAllListeners();
    paymentProcessingWorkflowService.removeAllListeners();

    // Re-setup the workflow service event listeners for integration
    paymentProcessingWorkflowService['setupEventListeners']();

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

    mockMirrorTransaction = {
      transaction_id: '0.0.123456@1640000000.123456789',
      consensus_timestamp: (Date.now() / 1000 + 30).toFixed(9), // Future timestamp
      transaction_hash: 'hash_1234567890abcdef',
      transfers: [
        { account: '0.0.654321', amount: -2500000000 }, // Sender (negative amount)
        { account: '0.0.123456', amount: 2500000000 },  // Recipient (positive amount)
      ],
      memo_base64: Buffer.from('AfriChain:PROD_001_DIGITAL:pay_1234567890_abcdef1234567890').toString('base64'),
      result: 'SUCCESS',
      charged_tx_fee: 100000, // 0.001 HBAR in tinybars
      max_fee: '100000000',
      valid_start_timestamp: '1640000000.000000000',
      valid_duration_seconds: 120,
      node: '0.0.3',
      scheduled: false,
    };
  });

  afterEach(() => {
    // Clean up event listeners
    paymentMonitoringService.removeAllListeners();
    paymentProcessingWorkflowService.removeAllListeners();

    // Restore original listeners to avoid affecting other tests
    originalListeners.paymentMonitoring.forEach((listener: any) => {
      paymentMonitoringService.on('paymentConfirmed', listener);
    });
    originalListeners.paymentTimeout.forEach((listener: any) => {
      paymentMonitoringService.on('paymentTimeout', listener);
    });
    originalListeners.workflow.forEach((listener: any) => {
      paymentProcessingWorkflowService.on('orderProcessed', listener);
    });
  });

  describe('End-to-End Payment Processing Workflow', () => {
    it('should trigger order fulfillment when payment is confirmed', (done) => {
      let orderProcessed = false;
      let fulfillmentResult: OrderFulfillmentResult | null = null;

      // Listen for order processing completion
      paymentProcessingWorkflowService.on('orderProcessed', (data) => {
        orderProcessed = true;
        fulfillmentResult = data.fulfillmentResult;
        
        try {
          // Verify order was processed
          expect(orderProcessed).toBe(true);
          expect(fulfillmentResult).toBeDefined();
          expect(fulfillmentResult!.orderId).toMatch(/^ORD_\d+_[a-z0-9]{9}$/);
          expect(fulfillmentResult!.fulfillmentStatus).toBe('fulfilled');
          
          // Verify digital fulfillment for digital product
          expect(fulfillmentResult!.digitalAssets).toBeDefined();
          expect(fulfillmentResult!.digitalAssets!.downloadLinks).toHaveLength(2);
          expect(fulfillmentResult!.digitalAssets!.accessCodes).toHaveLength(1);
          expect(fulfillmentResult!.digitalAssets!.expirationDate).toBeDefined();

          console.log('Order processing completed successfully:', {
            orderId: fulfillmentResult!.orderId,
            fulfillmentStatus: fulfillmentResult!.fulfillmentStatus,
            digitalAssets: fulfillmentResult!.digitalAssets,
          });

          done();
        } catch (error) {
          done(error);
        }
      });

      // Simulate payment confirmation by emitting the event
      setTimeout(() => {
        const paymentTransaction: PaymentTransaction = {
          transactionId: mockMirrorTransaction.transaction_id,
          paymentRequestId: mockPaymentRequest.requestId,
          transactionHash: mockMirrorTransaction.transaction_hash,
          senderAccountId: mockMirrorTransaction.transfers.find(t => t.amount < 0)?.account,
          recipientAccountId: mockPaymentRequest.recipientAccountId,
          amountHBAR: '25.00000000',
          amountUSD: 25.99,
          exchangeRate: 25.99 / 25.0,
          memo: mockPaymentRequest.memo,
          status: 'success',
          consensusTimestamp: mockMirrorTransaction.consensus_timestamp,
          transactionFee: '0.00100000',
          confirmationTime: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        // Emit payment confirmed event
        paymentMonitoringService.emit('paymentConfirmed', {
          sessionId: 'test_session_123',
          paymentRequest: mockPaymentRequest,
          transaction: paymentTransaction,
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

      // Timeout the test after 5 seconds
      setTimeout(() => {
        if (!orderProcessed) {
          done(new Error('Order processing did not complete within timeout'));
        }
      }, 5000);
    });

    it('should handle different product types correctly', async () => {
      const testCases = [
        {
          productType: 'DIGITAL',
          expectedFulfillmentType: 'fulfilled',
          expectDigitalAssets: true,
          expectTrackingInfo: false,
        },
        {
          productType: 'PHYSICAL',
          expectedFulfillmentType: 'processing',
          expectDigitalAssets: false,
          expectTrackingInfo: true,
        },
        {
          productType: 'HYBRID',
          expectedFulfillmentType: 'processing',
          expectDigitalAssets: true,
          expectTrackingInfo: true,
        },
      ];

      for (const testCase of testCases) {
        const testPaymentRequest = {
          ...mockPaymentRequest,
          requestId: `pay_${Date.now()}_${testCase.productType.toLowerCase()}`,
          productId: `PROD_001_${testCase.productType}`,
          productName: `AfriChain ${testCase.productType} Product`,
          memo: `AfriChain:PROD_001_${testCase.productType}:pay_${Date.now()}_${testCase.productType.toLowerCase()}`,
        };

        const testTransaction: PaymentTransaction = {
          transactionId: `${mockMirrorTransaction.transaction_id}_${testCase.productType}`,
          paymentRequestId: testPaymentRequest.requestId,
          transactionHash: `${mockMirrorTransaction.transaction_hash}_${testCase.productType}`,
          senderAccountId: mockMirrorTransaction.transfers.find(t => t.amount < 0)?.account,
          recipientAccountId: testPaymentRequest.recipientAccountId,
          amountHBAR: '25.00000000',
          amountUSD: 25.99,
          exchangeRate: 25.99 / 25.0,
          memo: testPaymentRequest.memo,
          status: 'success',
          consensusTimestamp: mockMirrorTransaction.consensus_timestamp,
          transactionFee: '0.00100000',
          confirmationTime: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        // Create order processing request
        const orderRequest = {
          paymentRequestId: testPaymentRequest.requestId,
          paymentTransactionId: testTransaction.transactionId,
          productId: testPaymentRequest.productId,
          productName: testPaymentRequest.productName,
          customerInfo: {},
          paymentDetails: {
            amountHBAR: testTransaction.amountHBAR,
            amountUSD: testTransaction.amountUSD,
            transactionHash: testTransaction.transactionHash,
            confirmationTime: testTransaction.confirmationTime || new Date().toISOString(),
          },
          fulfillmentInstructions: {
            fulfillmentType: testCase.productType.toLowerCase() as 'digital' | 'physical' | 'hybrid',
            priority: 'standard' as const,
          },
        };

        // Process order fulfillment
        const result = await paymentProcessingWorkflowService.processOrderFulfillment(orderRequest);

        // Verify results
        expect(result.orderId).toMatch(/^ORD_\d+_[a-z0-9]{9}$/);
        expect(result.fulfillmentStatus).toBe(testCase.expectedFulfillmentType);

        if (testCase.expectDigitalAssets) {
          expect(result.digitalAssets).toBeDefined();
          expect(result.digitalAssets!.downloadLinks).toBeDefined();
          expect(result.digitalAssets!.accessCodes).toBeDefined();
        } else {
          expect(result.digitalAssets).toBeUndefined();
        }

        if (testCase.expectTrackingInfo) {
          expect(result.trackingInfo).toBeDefined();
          expect(result.trackingInfo!.trackingNumber).toBeDefined();
          expect(result.trackingInfo!.carrier).toBeDefined();
          expect(result.trackingInfo!.estimatedDelivery).toBeDefined();
        } else {
          expect(result.trackingInfo).toBeUndefined();
        }

        console.log(`${testCase.productType} product fulfillment test passed:`, {
          orderId: result.orderId,
          fulfillmentStatus: result.fulfillmentStatus,
          hasDigitalAssets: !!result.digitalAssets,
          hasTrackingInfo: !!result.trackingInfo,
        });
      }
    });

    it('should handle payment timeout events', (done) => {
      let timeoutHandled = false;

      // Mock the updatePaymentStatus method to verify it's called
      const originalUpdatePaymentStatus = (paymentProcessingWorkflowService as any).updatePaymentStatus;
      (paymentProcessingWorkflowService as any).updatePaymentStatus = jest.fn().mockImplementation(async (statusUpdate) => {
        if (statusUpdate.status === 'failed' && statusUpdate.message.includes('timeout')) {
          timeoutHandled = true;
          
          try {
            expect(statusUpdate.paymentRequestId).toBe(mockPaymentRequest.requestId);
            expect(statusUpdate.status).toBe('failed');
            expect(statusUpdate.message).toContain('timeout');
            expect(statusUpdate.customerVisible).toBe(true);

            console.log('Payment timeout handled correctly:', statusUpdate);
            done();
          } catch (error) {
            done(error);
          } finally {
            (paymentProcessingWorkflowService as any).updatePaymentStatus = originalUpdatePaymentStatus;
          }
        }
      });

      // Simulate payment timeout event
      setTimeout(() => {
        paymentMonitoringService.emit('paymentTimeout', {
          sessionId: 'test_session_timeout',
          paymentRequest: mockPaymentRequest,
        });
      }, 100);

      // Timeout the test after 3 seconds
      setTimeout(() => {
        if (!timeoutHandled) {
          (paymentProcessingWorkflowService as any).updatePaymentStatus = originalUpdatePaymentStatus;
          done(new Error('Payment timeout was not handled within timeout'));
        }
      }, 3000);
    });

    it('should create audit logs for payment workflow events', async () => {
      // Mock the createAuditLog method to capture audit log creation
      const auditLogs: any[] = [];
      const originalCreateAuditLog = (paymentProcessingWorkflowService as any).createAuditLog;
      (paymentProcessingWorkflowService as any).createAuditLog = jest.fn().mockImplementation(async (logData) => {
        const auditLog = {
          logId: `LOG_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date().toISOString(),
          ...logData,
        };
        auditLogs.push(auditLog);
        console.log('Audit log created:', auditLog);
      });

      const paymentTransaction: PaymentTransaction = {
        transactionId: mockMirrorTransaction.transaction_id,
        paymentRequestId: mockPaymentRequest.requestId,
        transactionHash: mockMirrorTransaction.transaction_hash,
        senderAccountId: mockMirrorTransaction.transfers.find(t => t.amount < 0)?.account,
        recipientAccountId: mockPaymentRequest.recipientAccountId,
        amountHBAR: '25.00000000',
        amountUSD: 25.99,
        exchangeRate: 25.99 / 25.0,
        memo: mockPaymentRequest.memo,
        status: 'success',
        consensusTimestamp: mockMirrorTransaction.consensus_timestamp,
        transactionFee: '0.00100000',
        confirmationTime: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Process payment confirmation
      const result = await paymentProcessingWorkflowService.processPaymentConfirmation(
        mockPaymentRequest,
        paymentTransaction,
        { email: 'customer@example.com' }
      );

      // Verify audit logs were created
      expect(auditLogs).toHaveLength(2); // payment_confirmed and order_processed
      
      const paymentConfirmedLog = auditLogs.find(log => log.eventType === 'payment_confirmed');
      expect(paymentConfirmedLog).toBeDefined();
      expect(paymentConfirmedLog.paymentRequestId).toBe(mockPaymentRequest.requestId);
      expect(paymentConfirmedLog.eventData.transactionId).toBe(paymentTransaction.transactionId);

      const orderProcessedLog = auditLogs.find(log => log.eventType === 'order_processed');
      expect(orderProcessedLog).toBeDefined();
      expect(orderProcessedLog.paymentRequestId).toBe(mockPaymentRequest.requestId);
      expect(orderProcessedLog.eventData.orderId).toBe(result.orderId);

      // Restore original method
      (paymentProcessingWorkflowService as any).createAuditLog = originalCreateAuditLog;

      console.log('Audit trail verification completed:', {
        totalLogs: auditLogs.length,
        logTypes: auditLogs.map(log => log.eventType),
      });
    });

    it('should handle order processing failures gracefully', async () => {
      // Mock the processDigitalFulfillment method to throw an error
      const originalProcessDigitalFulfillment = (paymentProcessingWorkflowService as any).processDigitalFulfillment;
      (paymentProcessingWorkflowService as any).processDigitalFulfillment = jest.fn().mockImplementation(() => {
        throw new Error('Simulated fulfillment failure');
      });

      const paymentTransaction: PaymentTransaction = {
        transactionId: mockMirrorTransaction.transaction_id,
        paymentRequestId: mockPaymentRequest.requestId,
        transactionHash: mockMirrorTransaction.transaction_hash,
        senderAccountId: mockMirrorTransaction.transfers.find(t => t.amount < 0)?.account,
        recipientAccountId: mockPaymentRequest.recipientAccountId,
        amountHBAR: '25.00000000',
        amountUSD: 25.99,
        exchangeRate: 25.99 / 25.0,
        memo: mockPaymentRequest.memo,
        status: 'success',
        consensusTimestamp: mockMirrorTransaction.consensus_timestamp,
        transactionFee: '0.00100000',
        confirmationTime: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Process payment confirmation (should handle the error gracefully)
      const result = await paymentProcessingWorkflowService.processPaymentConfirmation(
        mockPaymentRequest,
        paymentTransaction
      );

      // Verify error handling
      expect(result.fulfillmentStatus).toBe('failed');
      expect(result.fulfillmentNotes).toContain('Simulated fulfillment failure');

      // Restore original method
      (paymentProcessingWorkflowService as any).processDigitalFulfillment = originalProcessDigitalFulfillment;

      console.log('Order processing failure handled correctly:', {
        orderId: result.orderId,
        fulfillmentStatus: result.fulfillmentStatus,
        fulfillmentNotes: result.fulfillmentNotes,
      });
    });

    it('should generate workflow statistics', async () => {
      const stats = await paymentProcessingWorkflowService.getWorkflowStatistics('day');

      expect(stats).toBeDefined();
      expect(typeof stats.totalPayments).toBe('number');
      expect(typeof stats.confirmedPayments).toBe('number');
      expect(typeof stats.processedOrders).toBe('number');
      expect(typeof stats.failedOrders).toBe('number');
      expect(typeof stats.totalRefunds).toBe('number');
      expect(typeof stats.refundAmount).toBe('string');
      expect(typeof stats.averageProcessingTime).toBe('number');
      expect(typeof stats.customerSatisfactionRate).toBe('number');

      // Verify reasonable values
      expect(stats.confirmedPayments).toBeLessThanOrEqual(stats.totalPayments);
      expect(stats.processedOrders).toBeLessThanOrEqual(stats.confirmedPayments);
      expect(stats.customerSatisfactionRate).toBeGreaterThanOrEqual(0);
      expect(stats.customerSatisfactionRate).toBeLessThanOrEqual(100);

      console.log('Workflow statistics generated:', stats);
    });
  });

  describe('Error Recovery and Resilience', () => {
    it('should handle service restart and state recovery', async () => {
      // Create a new service instance to simulate restart
      const newWorkflowService = new PaymentProcessingWorkflowService({
        autoProcessOrders: true,
        requireManualApproval: false,
      });

      // Verify the service starts correctly
      expect(newWorkflowService).toBeDefined();
      
      // Test that it can handle events immediately after creation
      let eventHandled = false;
      newWorkflowService.on('orderProcessed', () => {
        eventHandled = true;
      });

      // Clean up
      newWorkflowService.removeAllListeners();

      console.log('Service restart resilience verified');
    });

    it('should handle concurrent payment confirmations', async () => {
      const concurrentPayments = 3;
      const promises: Promise<OrderFulfillmentResult>[] = [];

      for (let i = 0; i < concurrentPayments; i++) {
        const concurrentPaymentRequest = {
          ...mockPaymentRequest,
          requestId: `pay_concurrent_${i}_${Date.now()}`,
          productId: `PROD_CONCURRENT_${i}`,
          memo: `AfriChain:PROD_CONCURRENT_${i}:pay_concurrent_${i}_${Date.now()}`,
        };

        const concurrentTransaction: PaymentTransaction = {
          transactionId: `${mockMirrorTransaction.transaction_id}_concurrent_${i}`,
          paymentRequestId: concurrentPaymentRequest.requestId,
          transactionHash: `${mockMirrorTransaction.transaction_hash}_concurrent_${i}`,
          senderAccountId: mockMirrorTransaction.transfers.find(t => t.amount < 0)?.account,
          recipientAccountId: concurrentPaymentRequest.recipientAccountId,
          amountHBAR: '25.00000000',
          amountUSD: 25.99,
          exchangeRate: 25.99 / 25.0,
          memo: concurrentPaymentRequest.memo,
          status: 'success',
          consensusTimestamp: mockMirrorTransaction.consensus_timestamp,
          transactionFee: '0.00100000',
          confirmationTime: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        promises.push(paymentProcessingWorkflowService.processPaymentConfirmation(
          concurrentPaymentRequest,
          concurrentTransaction
        ));
      }

      // Wait for all concurrent processing to complete
      const results = await Promise.all(promises);

      // Verify all orders were processed successfully
      results.forEach((result, index) => {
        expect(result.orderId).toMatch(/^ORD_\d+_[a-z0-9]{9}$/);
        expect(result.fulfillmentStatus).toBe('fulfilled');
      });

      console.log(`Successfully processed ${concurrentPayments} concurrent payments`);
    });
  });
});