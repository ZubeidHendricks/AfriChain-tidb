/**
 * Payment Processing Workflow Service
 * 
 * Comprehensive payment workflow management system featuring:
 * - Payment confirmation to order processing trigger
 * - Payment status updates for users via multiple channels
 * - Payment refund capability for failed orders
 * - Comprehensive payment logging and audit trails
 * - Order fulfillment integration
 * - Customer notification system
 */

import { EventEmitter } from 'events';
import Database from '../config/database';
import { PaymentRequest, PaymentTransaction } from './hbarPaymentService';
import { paymentMonitoringService } from './paymentMonitoringService';
import { mpesaService, SettlementRequest } from './mpesaService';

export interface OrderProcessingRequest {
  paymentRequestId: string;
  paymentTransactionId: string;
  productId: string;
  productName: string;
  customerInfo: {
    email?: string;
    accountId?: string;
    deliveryAddress?: string;
  };
  paymentDetails: {
    amountHBAR: string;
    amountUSD: number;
    transactionHash: string;
    confirmationTime: string;
  };
  fulfillmentInstructions: {
    fulfillmentType: 'digital' | 'physical' | 'hybrid';
    priority: 'standard' | 'express' | 'priority';
    specialInstructions?: string;
  };
}

export interface OrderFulfillmentResult {
  orderId: string;
  fulfillmentStatus: 'pending' | 'processing' | 'fulfilled' | 'failed' | 'cancelled';
  trackingInfo?: {
    trackingNumber?: string;
    carrier?: string;
    estimatedDelivery?: string;
  };
  digitalAssets?: {
    downloadLinks: string[];
    accessCodes: string[];
    expirationDate?: string;
  };
  fulfillmentTimestamp: string;
  fulfillmentNotes?: string;
}

export interface PaymentStatusUpdate {
  paymentRequestId: string;
  status: 'pending' | 'confirmed' | 'processing' | 'completed' | 'failed' | 'refunded';
  message: string;
  timestamp: string;
  details?: any;
  notificationChannels: Array<'email' | 'sms' | 'push' | 'webhook'>;
  customerVisible: boolean;
}

export interface RefundRequest {
  originalPaymentRequestId: string;
  originalTransactionId: string;
  refundReason: 'order_cancelled' | 'product_unavailable' | 'quality_issue' | 'customer_request' | 'system_error';
  refundAmount: string; // HBAR amount
  refundAmountUSD: number;
  customerAccountId: string;
  customerEmail?: string;
  refundNotes?: string;
  priority: 'standard' | 'urgent';
  requestedBy: string;
  approvedBy?: string;
}

export interface RefundResult {
  refundId: string;
  refundTransactionId: string;
  refundTransactionHash: string;
  refundStatus: 'requested' | 'approved' | 'processing' | 'completed' | 'failed' | 'rejected';
  refundAmount: string;
  refundFee: string;
  netRefundAmount: string;
  processedAt: string;
  estimatedArrival: string;
  refundNotes?: string;
}

export interface PaymentAuditLog {
  logId: string;
  paymentRequestId: string;
  eventType: 'payment_created' | 'payment_confirmed' | 'order_processed' | 'refund_requested' | 'refund_completed' | 'status_updated';
  eventData: any;
  timestamp: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
}

export interface WorkflowConfiguration {
  autoProcessOrders: boolean;
  requireManualApproval: boolean;
  refundApprovalRequired: boolean;
  maxRefundAmount: number; // USD
  orderProcessingTimeout: number; // minutes
  customerNotificationChannels: Array<'email' | 'sms' | 'push'>;
  adminNotificationChannels: Array<'email' | 'slack' | 'webhook'>;
  auditLogRetention: number; // days
}

export class PaymentProcessingWorkflowService extends EventEmitter {
  private db: Database;
  private config: WorkflowConfiguration;
  private activeOrders: Map<string, OrderProcessingRequest> = new Map();
  private pendingRefunds: Map<string, RefundRequest> = new Map();

  private readonly DEFAULT_CONFIG: WorkflowConfiguration = {
    autoProcessOrders: true,
    requireManualApproval: false,
    refundApprovalRequired: true,
    maxRefundAmount: 1000, // $1000 USD
    orderProcessingTimeout: 30, // 30 minutes
    customerNotificationChannels: ['email'],
    adminNotificationChannels: ['email', 'webhook'],
    auditLogRetention: 90, // 90 days
  };

  constructor(config?: Partial<WorkflowConfiguration>) {
    super();
    this.db = Database.getInstance();
    this.config = { ...this.DEFAULT_CONFIG, ...config };
    this.setupEventListeners();
    this.startBackgroundProcessing();
  }

  /**
   * Process payment confirmation and trigger order fulfillment
   */
  async processPaymentConfirmation(
    paymentRequest: PaymentRequest,
    paymentTransaction: PaymentTransaction,
    customerInfo?: any
  ): Promise<OrderFulfillmentResult> {
    try {
      // Log payment confirmation
      await this.createAuditLog({
        paymentRequestId: paymentRequest.requestId,
        eventType: 'payment_confirmed',
        eventData: {
          transactionId: paymentTransaction.transactionId,
          amount: paymentTransaction.amountHBAR,
          amountUSD: paymentTransaction.amountUSD,
        },
      });

      // Create order processing request
      const orderRequest: OrderProcessingRequest = {
        paymentRequestId: paymentRequest.requestId,
        paymentTransactionId: paymentTransaction.transactionId,
        productId: paymentRequest.productId,
        productName: paymentRequest.productName,
        customerInfo: customerInfo || {},
        paymentDetails: {
          amountHBAR: paymentTransaction.amountHBAR,
          amountUSD: paymentTransaction.amountUSD,
          transactionHash: paymentTransaction.transactionHash,
          confirmationTime: paymentTransaction.confirmationTime || new Date().toISOString(),
        },
        fulfillmentInstructions: {
          fulfillmentType: 'digital', // Default to digital for AfriChain products
          priority: 'standard',
        },
      };

      // Store order for processing
      this.activeOrders.set(paymentRequest.requestId, orderRequest);

      // Update payment status
      await this.updatePaymentStatus({
        paymentRequestId: paymentRequest.requestId,
        status: 'confirmed',
        message: 'Payment confirmed, processing order',
        timestamp: new Date().toISOString(),
        notificationChannels: this.config.customerNotificationChannels,
        customerVisible: true,
      });

      let fulfillmentResult: OrderFulfillmentResult;

      if (this.config.autoProcessOrders && !this.config.requireManualApproval) {
        // Auto-process the order
        fulfillmentResult = await this.processOrderFulfillment(orderRequest);
      } else {
        // Queue for manual approval
        fulfillmentResult = {
          orderId: this.generateOrderId(),
          fulfillmentStatus: 'pending',
          fulfillmentTimestamp: new Date().toISOString(),
          fulfillmentNotes: 'Order queued for manual approval',
        };

        // Notify administrators
        await this.notifyAdministrators('order_approval_required', {
          orderRequest,
          paymentDetails: orderRequest.paymentDetails,
        });
      }

      // Initiate M-Pesa settlement if order is successfully fulfilled
      if (fulfillmentResult.fulfillmentStatus === 'fulfilled' || fulfillmentResult.fulfillmentStatus === 'processing') {
        try {
          await this.initiateKESSettlement(paymentRequest, paymentTransaction, fulfillmentResult);
        } catch (error) {
          console.error('M-Pesa settlement initiation failed:', error);
          // Continue with order processing - settlement failure shouldn't block fulfillment
        }
      }

      // Log order processing
      await this.createAuditLog({
        paymentRequestId: paymentRequest.requestId,
        eventType: 'order_processed',
        eventData: {
          orderId: fulfillmentResult.orderId,
          fulfillmentStatus: fulfillmentResult.fulfillmentStatus,
        },
      });

      // Emit workflow event
      this.emit('orderProcessed', {
        paymentRequest,
        paymentTransaction,
        orderRequest,
        fulfillmentResult,
      });

      console.log('Payment confirmation processed:', {
        paymentRequestId: paymentRequest.requestId,
        orderId: fulfillmentResult.orderId,
        fulfillmentStatus: fulfillmentResult.fulfillmentStatus,
      });

      return fulfillmentResult;

    } catch (error) {
      console.error('Payment confirmation processing failed:', error);
      
      // Update payment status to failed
      await this.updatePaymentStatus({
        paymentRequestId: paymentRequest.requestId,
        status: 'failed',
        message: 'Order processing failed',
        timestamp: new Date().toISOString(),
        details: { error: error instanceof Error ? error.message : String(error) },
        notificationChannels: this.config.customerNotificationChannels,
        customerVisible: true,
      });

      throw error;
    }
  }

  /**
   * Process order fulfillment
   */
  async processOrderFulfillment(orderRequest: OrderProcessingRequest): Promise<OrderFulfillmentResult> {
    try {
      const orderId = this.generateOrderId();

      // Update status to processing
      await this.updatePaymentStatus({
        paymentRequestId: orderRequest.paymentRequestId,
        status: 'processing',
        message: 'Order is being fulfilled',
        timestamp: new Date().toISOString(),
        notificationChannels: this.config.customerNotificationChannels,
        customerVisible: true,
      });

      // Process based on fulfillment type
      let fulfillmentResult: OrderFulfillmentResult;

      switch (orderRequest.fulfillmentInstructions.fulfillmentType) {
        case 'digital':
          fulfillmentResult = await this.processDigitalFulfillment(orderId, orderRequest);
          break;
        case 'physical':
          fulfillmentResult = await this.processPhysicalFulfillment(orderId, orderRequest);
          break;
        case 'hybrid':
          fulfillmentResult = await this.processHybridFulfillment(orderId, orderRequest);
          break;
        default:
          throw new Error('Unknown fulfillment type');
      }

      // Update final status
      await this.updatePaymentStatus({
        paymentRequestId: orderRequest.paymentRequestId,
        status: 'completed',
        message: 'Order fulfilled successfully',
        timestamp: new Date().toISOString(),
        details: { orderId, trackingInfo: fulfillmentResult.trackingInfo },
        notificationChannels: this.config.customerNotificationChannels,
        customerVisible: true,
      });

      // Remove from active orders
      this.activeOrders.delete(orderRequest.paymentRequestId);

      return fulfillmentResult;

    } catch (error) {
      console.error('Order fulfillment failed:', error);
      
      const failedResult: OrderFulfillmentResult = {
        orderId: this.generateOrderId(),
        fulfillmentStatus: 'failed',
        fulfillmentTimestamp: new Date().toISOString(),
        fulfillmentNotes: `Fulfillment failed: ${error instanceof Error ? error.message : String(error)}`,
      };

      // Update status to failed
      await this.updatePaymentStatus({
        paymentRequestId: orderRequest.paymentRequestId,
        status: 'failed',
        message: 'Order fulfillment failed',
        timestamp: new Date().toISOString(),
        details: { error: error instanceof Error ? error.message : String(error) },
        notificationChannels: this.config.customerNotificationChannels,
        customerVisible: true,
      });

      return failedResult;
    }
  }

  /**
   * Request payment refund
   */
  async requestRefund(refundRequest: RefundRequest): Promise<string> {
    try {
      // Validate refund request
      await this.validateRefundRequest(refundRequest);

      const refundId = this.generateRefundId();
      
      // Store refund request
      this.pendingRefunds.set(refundId, refundRequest);
      await this.storeRefundRequest(refundId, refundRequest);

      // Log refund request
      await this.createAuditLog({
        paymentRequestId: refundRequest.originalPaymentRequestId,
        eventType: 'refund_requested',
        eventData: {
          refundId,
          refundAmount: refundRequest.refundAmount,
          refundReason: refundRequest.refundReason,
          requestedBy: refundRequest.requestedBy,
        },
      });

      // Check if auto-approval is possible
      if (this.canAutoApproveRefund(refundRequest)) {
        await this.approveRefund(refundId, 'system_auto_approval');
      } else {
        // Notify administrators for approval
        await this.notifyAdministrators('refund_approval_required', {
          refundId,
          refundRequest,
        });
      }

      console.log('Refund requested:', {
        refundId,
        originalPaymentId: refundRequest.originalPaymentRequestId,
        amount: refundRequest.refundAmount,
        reason: refundRequest.refundReason,
      });

      return refundId;

    } catch (error) {
      console.error('Refund request failed:', error);
      throw error;
    }
  }

  /**
   * Approve refund
   */
  async approveRefund(refundId: string, approvedBy: string): Promise<RefundResult> {
    try {
      const refundRequest = this.pendingRefunds.get(refundId);
      if (!refundRequest) {
        throw new Error('Refund request not found');
      }

      // Update approval
      refundRequest.approvedBy = approvedBy;

      // Process refund via HBAR payment service
      const refundResult = await this.processHBARRefund(refundRequest);

      // Update refund status
      await this.updateRefundStatus(refundId, 'completed', refundResult);

      // Log refund completion
      await this.createAuditLog({
        paymentRequestId: refundRequest.originalPaymentRequestId,
        eventType: 'refund_completed',
        eventData: {
          refundId,
          refundTransactionId: refundResult.refundTransactionId,
          refundAmount: refundResult.refundAmount,
          approvedBy,
        },
      });

      // Notify customer
      await this.notifyCustomerRefundCompleted(refundRequest, refundResult);

      // Remove from pending refunds
      this.pendingRefunds.delete(refundId);

      console.log('Refund approved and processed:', {
        refundId,
        transactionId: refundResult.refundTransactionId,
        amount: refundResult.refundAmount,
      });

      return refundResult;

    } catch (error) {
      console.error('Refund approval failed:', error);
      throw error;
    }
  }

  /**
   * Get payment audit trail
   */
  async getPaymentAuditTrail(paymentRequestId: string): Promise<PaymentAuditLog[]> {
    try {
      const auditLogs = await this.getStoredAuditLogs(paymentRequestId);
      return auditLogs;
    } catch (error) {
      console.error('Failed to get audit trail:', error);
      throw error;
    }
  }

  /**
   * Get workflow statistics
   */
  async getWorkflowStatistics(timeframe: 'day' | 'week' | 'month' = 'day'): Promise<{
    totalPayments: number;
    confirmedPayments: number;
    processedOrders: number;
    failedOrders: number;
    totalRefunds: number;
    refundAmount: string;
    averageProcessingTime: number;
    customerSatisfactionRate: number;
  }> {
    try {
      // Mock statistics - would be calculated from database in production
      return {
        totalPayments: 234,
        confirmedPayments: 218,
        processedOrders: 210,
        failedOrders: 8,
        totalRefunds: 12,
        refundAmount: '45.67890123',
        averageProcessingTime: 145, // seconds
        customerSatisfactionRate: 96.8, // percentage
      };
    } catch (error) {
      console.error('Failed to get workflow statistics:', error);
      throw error;
    }
  }

  // Private methods

  private setupEventListeners(): void {
    // Listen to payment monitoring events
    paymentMonitoringService.on('paymentConfirmed', async (data) => {
      try {
        await this.processPaymentConfirmation(
          data.paymentRequest,
          data.transaction,
          data.customerInfo
        );
      } catch (error) {
        console.error('Failed to process payment confirmation event:', error);
      }
    });

    paymentMonitoringService.on('paymentTimeout', async (data) => {
      await this.updatePaymentStatus({
        paymentRequestId: data.paymentRequest.requestId,
        status: 'failed',
        message: 'Payment timeout - no transaction found',
        timestamp: new Date().toISOString(),
        notificationChannels: this.config.customerNotificationChannels,
        customerVisible: true,
      });
    });
  }

  private startBackgroundProcessing(): void {
    // Process timeout orders every minute
    setInterval(async () => {
      await this.processTimeoutOrders();
    }, 60000);

    // Clean up old audit logs daily
    setInterval(async () => {
      await this.cleanupOldAuditLogs();
    }, 24 * 60 * 60 * 1000);
  }

  private async processDigitalFulfillment(orderId: string, orderRequest: OrderProcessingRequest): Promise<OrderFulfillmentResult> {
    // Mock digital fulfillment - generate download links, access codes, etc.
    return {
      orderId,
      fulfillmentStatus: 'fulfilled',
      digitalAssets: {
        downloadLinks: [
          'https://africhain.com/downloads/product-certificate.pdf',
          'https://africhain.com/downloads/authenticity-report.json',
        ],
        accessCodes: ['ACC-' + Math.random().toString(36).substr(2, 9).toUpperCase()],
        expirationDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
      },
      fulfillmentTimestamp: new Date().toISOString(),
      fulfillmentNotes: 'Digital assets generated and delivered',
    };
  }

  private async processPhysicalFulfillment(orderId: string, orderRequest: OrderProcessingRequest): Promise<OrderFulfillmentResult> {
    // Mock physical fulfillment - create shipping labels, etc.
    return {
      orderId,
      fulfillmentStatus: 'processing',
      trackingInfo: {
        trackingNumber: 'TRK' + Math.random().toString(36).substr(2, 9).toUpperCase(),
        carrier: 'DHL Express',
        estimatedDelivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
      },
      fulfillmentTimestamp: new Date().toISOString(),
      fulfillmentNotes: 'Physical product shipped',
    };
  }

  private async processHybridFulfillment(orderId: string, orderRequest: OrderProcessingRequest): Promise<OrderFulfillmentResult> {
    // Combine digital and physical fulfillment
    const digitalResult = await this.processDigitalFulfillment(orderId, orderRequest);
    const physicalResult = await this.processPhysicalFulfillment(orderId, orderRequest);

    return {
      orderId,
      fulfillmentStatus: 'processing',
      digitalAssets: digitalResult.digitalAssets,
      trackingInfo: physicalResult.trackingInfo,
      fulfillmentTimestamp: new Date().toISOString(),
      fulfillmentNotes: 'Hybrid fulfillment: digital assets delivered, physical product shipped',
    };
  }

  private async processHBARRefund(refundRequest: RefundRequest): Promise<RefundResult> {
    // Mock HBAR refund processing
    const refundTransactionId = 'REFUND_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const refundFee = '0.001'; // 0.001 HBAR transaction fee
    const netRefundAmount = (parseFloat(refundRequest.refundAmount) - parseFloat(refundFee)).toFixed(8);

    return {
      refundId: this.generateRefundId(),
      refundTransactionId,
      refundTransactionHash: 'hash_' + refundTransactionId,
      refundStatus: 'completed',
      refundAmount: refundRequest.refundAmount,
      refundFee,
      netRefundAmount,
      processedAt: new Date().toISOString(),
      estimatedArrival: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 minutes
      refundNotes: 'HBAR refund processed successfully',
    };
  }

  private generateOrderId(): string {
    return `ORD_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateRefundId(): string {
    return `REF_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private canAutoApproveRefund(refundRequest: RefundRequest): boolean {
    return (
      !this.config.refundApprovalRequired ||
      refundRequest.refundAmountUSD <= this.config.maxRefundAmount / 10 || // Auto-approve small refunds
      refundRequest.refundReason === 'system_error'
    );
  }

  private async validateRefundRequest(refundRequest: RefundRequest): Promise<void> {
    if (!refundRequest.originalPaymentRequestId) {
      throw new Error('Original payment request ID is required');
    }
    if (!refundRequest.refundAmount || parseFloat(refundRequest.refundAmount) <= 0) {
      throw new Error('Valid refund amount is required');
    }
    if (refundRequest.refundAmountUSD > this.config.maxRefundAmount) {
      throw new Error(`Refund amount exceeds maximum allowed: $${this.config.maxRefundAmount}`);
    }
  }

  // Mock database and notification methods

  private async updatePaymentStatus(statusUpdate: PaymentStatusUpdate): Promise<void> {
    console.log('Payment status updated:', statusUpdate);
    // In production, would update database and send notifications
  }

  private async createAuditLog(logData: Partial<PaymentAuditLog>): Promise<void> {
    const auditLog: PaymentAuditLog = {
      logId: `LOG_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      ...logData,
    } as PaymentAuditLog;

    console.log('Audit log created:', auditLog);
    // In production, would store in database
  }

  private async notifyAdministrators(eventType: string, data: any): Promise<void> {
    console.log('Admin notification:', { eventType, data });
    // In production, would send notifications via configured channels
  }

  private async notifyCustomerRefundCompleted(refundRequest: RefundRequest, refundResult: RefundResult): Promise<void> {
    console.log('Customer refund notification:', {
      customerEmail: refundRequest.customerEmail,
      refundAmount: refundResult.refundAmount,
      transactionId: refundResult.refundTransactionId,
    });
    // In production, would send customer notifications
  }

  private async storeRefundRequest(refundId: string, refundRequest: RefundRequest): Promise<void> {
    console.log('Storing refund request:', { refundId, refundRequest });
  }

  private async updateRefundStatus(refundId: string, status: string, result: RefundResult): Promise<void> {
    console.log('Updating refund status:', { refundId, status, result });
  }

  private async getStoredAuditLogs(paymentRequestId: string): Promise<PaymentAuditLog[]> {
    // Mock audit logs
    return [
      {
        logId: 'LOG_001',
        paymentRequestId,
        eventType: 'payment_created',
        eventData: { amount: '25.00' },
        timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      },
      {
        logId: 'LOG_002',
        paymentRequestId,
        eventType: 'payment_confirmed',
        eventData: { transactionId: 'TX_123' },
        timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      },
    ];
  }

  private async processTimeoutOrders(): Promise<void> {
    const timeout = this.config.orderProcessingTimeout * 60 * 1000;
    const cutoff = Date.now() - timeout;

    for (const [paymentRequestId, orderRequest] of this.activeOrders.entries()) {
      const orderTime = new Date(orderRequest.paymentDetails.confirmationTime).getTime();
      if (orderTime < cutoff) {
        console.log('Order timeout detected:', paymentRequestId);
        await this.updatePaymentStatus({
          paymentRequestId,
          status: 'failed',
          message: 'Order processing timeout',
          timestamp: new Date().toISOString(),
          notificationChannels: ['email'],
          customerVisible: false,
        });
        this.activeOrders.delete(paymentRequestId);
      }
    }
  }

  private async initiateKESSettlement(
    paymentRequest: PaymentRequest,
    paymentTransaction: PaymentTransaction,
    fulfillmentResult: OrderFulfillmentResult
  ): Promise<void> {
    try {
      // Extract artisan information from product ID or metadata
      const artisanInfo = await this.extractArtisanInfo(paymentRequest.productId);
      
      if (!artisanInfo) {
        console.log('No artisan info found for product, skipping M-Pesa settlement:', paymentRequest.productId);
        return;
      }

      // Get current USD to KES exchange rate (mock for now)
      const usdToKesRate = await this.getCurrentUSDToKESRate();
      const settlementAmountKES = Math.round(paymentTransaction.amountUSD * usdToKesRate);

      // Create settlement request
      const settlementRequest: SettlementRequest = {
        artisanId: artisanInfo.artisanId,
        artisanMpesaNumber: artisanInfo.mpesaNumber,
        artisanName: artisanInfo.name,
        originalPaymentId: paymentRequest.requestId,
        originalTransactionId: paymentTransaction.transactionId,
        amountHBAR: paymentTransaction.amountHBAR,
        amountUSD: paymentTransaction.amountUSD,
        amountKES: settlementAmountKES,
        exchangeRateUSDKES: usdToKesRate,
        settlementReason: `Product sale settlement for ${paymentRequest.productName}`,
        productId: paymentRequest.productId,
        orderReference: fulfillmentResult.orderId,
      };

      // Initiate M-Pesa settlement
      const settlementId = await mpesaService.initiateSettlement(settlementRequest);

      // Log settlement initiation
      await this.createAuditLog({
        paymentRequestId: paymentRequest.requestId,
        eventType: 'settlement_initiated',
        eventData: {
          settlementId,
          artisanId: artisanInfo.artisanId,
          amountKES: settlementAmountKES,
          exchangeRate: usdToKesRate,
        },
      });

      console.log('M-Pesa settlement initiated:', {
        settlementId,
        paymentRequestId: paymentRequest.requestId,
        orderId: fulfillmentResult.orderId,
        artisanId: artisanInfo.artisanId,
        amountKES: settlementAmountKES,
      });

      // Emit settlement event
      this.emit('settlementInitiated', {
        settlementId,
        paymentRequest,
        paymentTransaction,
        fulfillmentResult,
        settlementRequest,
      });

    } catch (error) {
      console.error('Failed to initiate KES settlement:', error);
      
      // Log settlement failure
      await this.createAuditLog({
        paymentRequestId: paymentRequest.requestId,
        eventType: 'settlement_failed',
        eventData: {
          error: error instanceof Error ? error.message : String(error),
          paymentAmount: paymentTransaction.amountUSD,
        },
      });

      throw error;
    }
  }

  private async extractArtisanInfo(productId: string): Promise<{
    artisanId: string;
    name: string;
    mpesaNumber: string;
  } | null> {
    try {
      // Mock artisan extraction - in production would query product/artisan database
      // For demo purposes, create mock artisan data based on product ID
      
      if (productId.includes('DEMO') || productId.includes('TEST')) {
        // Demo/test products don't trigger real settlements
        return null;
      }

      // Mock artisan data - in production this would come from database
      const mockArtisans = {
        'PROD_001_DIGITAL': {
          artisanId: 'ART_001_KENYA',
          name: 'Amara Jomo',
          mpesaNumber: '+254712345678',
        },
        'PROD_002_PHYSICAL': {
          artisanId: 'ART_002_KENYA',
          name: 'Kesi Wambua',
          mpesaNumber: '+254723456789',
        },
        'PROD_003_HYBRID': {
          artisanId: 'ART_003_KENYA',
          name: 'Nia Mwangi',
          mpesaNumber: '+254734567890',
        },
      };

      const artisanInfo = mockArtisans[productId as keyof typeof mockArtisans];
      
      if (artisanInfo) {
        console.log('Found artisan info for product:', { productId, artisanId: artisanInfo.artisanId });
        return artisanInfo;
      }

      // Default artisan for unknown products
      return {
        artisanId: 'ART_DEFAULT_KENYA',
        name: 'AfriChain Artisan',
        mpesaNumber: '+254700000000',
      };

    } catch (error) {
      console.error('Failed to extract artisan info:', error);
      return null;
    }
  }

  private async getCurrentUSDToKESRate(): Promise<number> {
    try {
      // Mock exchange rate - in production would fetch from currency API
      // Current approximate USD to KES rate
      const baseRate = 129.0; // ~129 KES per USD
      const variation = (Math.random() - 0.5) * 2; // ±1 KES variation
      const currentRate = baseRate + variation;

      console.log('Current USD to KES exchange rate:', currentRate);
      return currentRate;

    } catch (error) {
      console.error('Failed to get USD to KES exchange rate:', error);
      // Fallback rate
      return 129.0;
    }
  }

  private async cleanupOldAuditLogs(): Promise<void> {
    console.log('Cleaning up audit logs older than', this.config.auditLogRetention, 'days');
    // In production, would delete old audit logs from database
  }
}

// Export singleton instance
export const paymentProcessingWorkflowService = new PaymentProcessingWorkflowService();

export default paymentProcessingWorkflowService;