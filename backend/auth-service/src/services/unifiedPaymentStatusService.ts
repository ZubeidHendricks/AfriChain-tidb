/**
 * Unified Payment Status Tracking Service
 * 
 * Comprehensive payment status tracking system featuring:
 * - Real-time payment status monitoring across all payment methods
 * - Unified status tracking for HBAR payments, M-Pesa transactions, and currency conversions
 * - Payment lifecycle event tracking from initiation to completion
 * - Cross-platform status synchronization and updates
 * - Comprehensive payment analytics and reporting
 * - Customer notification system for status changes
 * - Administrative dashboard for payment oversight
 */

import { EventEmitter } from 'events';
import Database from '../config/database';
import { PaymentRequest, PaymentTransaction } from './hbarPaymentService';
import { MpesaPaymentRequest, MpesaTransaction } from './mpesaPaymentRequestService';
import { RealTimeConversionResult } from './realTimeCurrencyConversionService';
import { paymentMonitoringService } from './paymentMonitoringService';
import { mpesaPaymentRequestService } from './mpesaPaymentRequestService';

export interface UnifiedPaymentStatus {
  paymentId: string;
  paymentType: 'hbar' | 'mpesa' | 'cross_chain';
  status: 'initiated' | 'pending' | 'processing' | 'confirmed' | 'settled' | 'completed' | 'failed' | 'cancelled' | 'refunded';
  subStatus?: string;
  timestamp: string;
  details: {
    amount: number;
    currency: string;
    originalAmount?: number;
    originalCurrency?: string;
    exchangeRate?: number;
  };
  customer: {
    customerId?: string;
    email?: string;
    phone?: string;
    name?: string;
  };
  progress: PaymentProgress;
  relatedPayments: RelatedPayment[];
  metadata: PaymentMetadata;
}

export interface PaymentProgress {
  currentStep: number;
  totalSteps: number;
  stepName: string;
  stepDescription: string;
  estimatedCompletion?: string;
  nextSteps: string[];
  completedSteps: CompletedStep[];
  blockers?: PaymentBlocker[];
}

export interface CompletedStep {
  stepNumber: number;
  stepName: string;
  completedAt: string;
  duration: number; // milliseconds
  status: 'success' | 'warning' | 'error';
  details?: any;
}

export interface PaymentBlocker {
  blockerId: string;
  blockerType: 'insufficient_funds' | 'network_congestion' | 'validation_failure' | 'system_error' | 'manual_review';
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  estimatedResolution?: string;
  actionRequired?: string;
  contactInfo?: string;
}

export interface RelatedPayment {
  paymentId: string;
  paymentType: 'hbar' | 'mpesa' | 'conversion';
  relationship: 'parent' | 'child' | 'settlement' | 'refund' | 'conversion';
  status: string;
  amount: number;
  currency: string;
  timestamp: string;
}

export interface PaymentMetadata {
  productId?: string;
  productName?: string;
  orderId?: string;
  merchantId?: string;
  referenceNumber?: string;
  paymentMethod: string;
  ipAddress?: string;
  userAgent?: string;
  location?: {
    country: string;
    region?: string;
    city?: string;
  };
  fees: {
    networkFee?: number;
    serviceFee?: number;
    conversionFee?: number;
    totalFees: number;
  };
  riskScore?: number;
  compliance: {
    kycStatus?: 'pending' | 'verified' | 'failed';
    amlCheck?: 'passed' | 'flagged' | 'reviewing';
    sanctionCheck?: 'clear' | 'flagged';
  };
}

export interface PaymentStatusUpdate {
  paymentId: string;
  previousStatus: string;
  newStatus: string;
  timestamp: string;
  triggeredBy: 'system' | 'user' | 'external' | 'webhook';
  source: string;
  reason?: string;
  details?: any;
  notificationSent: boolean;
  notificationChannels: string[];
}

export interface PaymentAnalytics {
  totalPayments: number;
  paymentsByStatus: { [status: string]: number };
  paymentsByType: { [type: string]: number };
  averageProcessingTime: { [type: string]: number };
  successRate: number;
  failureReasons: { [reason: string]: number };
  volumeByTimeframe: {
    hourly: { [hour: string]: number };
    daily: { [date: string]: number };
    weekly: { [week: string]: number };
  };
  topCustomers: Array<{
    customerId: string;
    paymentCount: number;
    totalVolume: number;
    currency: string;
  }>;
  geographicDistribution: { [country: string]: number };
  revenueMetrics: {
    totalFees: number;
    feesByType: { [type: string]: number };
    averageFeePerTransaction: number;
  };
}

export interface StatusNotificationConfig {
  customerId: string;
  paymentId: string;
  channels: Array<'email' | 'sms' | 'push' | 'webhook'>;
  triggers: Array<'status_change' | 'milestone' | 'error' | 'completion'>;
  preferences: {
    frequency: 'immediate' | 'batched' | 'daily_summary';
    quietHours?: {
      start: string; // HH:MM format
      end: string;   // HH:MM format
      timezone: string;
    };
  };
}

export interface PaymentSearchCriteria {
  paymentId?: string;
  customerId?: string;
  email?: string;
  phone?: string;
  status?: string[];
  paymentType?: string[];
  dateRange?: {
    start: string;
    end: string;
  };
  amountRange?: {
    min: number;
    max: number;
    currency: string;
  };
  productId?: string;
  orderId?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'timestamp' | 'amount' | 'status';
  sortOrder?: 'asc' | 'desc';
}

export class UnifiedPaymentStatusService extends EventEmitter {
  private db: Database;
  private paymentStatuses: Map<string, UnifiedPaymentStatus> = new Map();
  private statusHistory: Map<string, PaymentStatusUpdate[]> = new Map();
  private customerNotifications: Map<string, StatusNotificationConfig> = new Map();
  private analyticsCache: Map<string, any> = new Map();
  
  private readonly ANALYTICS_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_HISTORY_ENTRIES = 1000;
  private readonly NOTIFICATION_BATCH_SIZE = 100;

  // Payment step definitions for different payment types
  private readonly PAYMENT_STEPS = {
    hbar: [
      { step: 1, name: 'Payment Initiated', description: 'Payment request created and QR code generated' },
      { step: 2, name: 'Awaiting Transaction', description: 'Waiting for HBAR transaction on Hedera network' },
      { step: 3, name: 'Transaction Detected', description: 'Transaction found and being validated' },
      { step: 4, name: 'Transaction Confirmed', description: 'Transaction validated and confirmed' },
      { step: 5, name: 'Order Processing', description: 'Order fulfillment initiated' },
      { step: 6, name: 'Completed', description: 'Payment processed and order fulfilled' },
    ],
    mpesa: [
      { step: 1, name: 'STK Push Initiated', description: 'M-Pesa STK push request sent to customer' },
      { step: 2, name: 'Customer Authorization', description: 'Waiting for customer PIN entry' },
      { step: 3, name: 'Transaction Processing', description: 'M-Pesa processing the payment' },
      { step: 4, name: 'Transaction Confirmed', description: 'Payment confirmed by M-Pesa' },
      { step: 5, name: 'Settlement Processing', description: 'Initiating merchant settlement' },
      { step: 6, name: 'Completed', description: 'Payment settled to merchant account' },
    ],
    cross_chain: [
      { step: 1, name: 'Payment Initiated', description: 'Cross-chain payment request created' },
      { step: 2, name: 'Source Payment', description: 'Processing source currency payment' },
      { step: 3, name: 'Currency Conversion', description: 'Converting between currencies' },
      { step: 4, name: 'Target Settlement', description: 'Settling to target payment method' },
      { step: 5, name: 'Confirmation', description: 'All payments confirmed and reconciled' },
      { step: 6, name: 'Completed', description: 'Cross-chain payment completed successfully' },
    ],
  };

  constructor() {
    super();
    this.db = Database.getInstance();
    this.setupEventListeners();
    this.startBackgroundProcessing();
  }

  /**
   * Create or update unified payment status
   */
  async createPaymentStatus(paymentData: {
    paymentId: string;
    paymentType: 'hbar' | 'mpesa' | 'cross_chain';
    initialStatus: 'initiated' | 'pending';
    amount: number;
    currency: string;
    customer: any;
    metadata?: any;
  }): Promise<UnifiedPaymentStatus> {
    try {
      const steps = this.PAYMENT_STEPS[paymentData.paymentType];
      const currentStep = paymentData.initialStatus === 'initiated' ? 1 : 2;

      const paymentStatus: UnifiedPaymentStatus = {
        paymentId: paymentData.paymentId,
        paymentType: paymentData.paymentType,
        status: paymentData.initialStatus,
        timestamp: new Date().toISOString(),
        details: {
          amount: paymentData.amount,
          currency: paymentData.currency,
        },
        customer: paymentData.customer || {},
        progress: {
          currentStep,
          totalSteps: steps.length,
          stepName: steps[currentStep - 1].name,
          stepDescription: steps[currentStep - 1].description,
          nextSteps: steps.slice(currentStep).map(s => s.name),
          completedSteps: [{
            stepNumber: currentStep,
            stepName: steps[currentStep - 1].name,
            completedAt: new Date().toISOString(),
            duration: 0,
            status: 'success',
          }],
        },
        relatedPayments: [],
        metadata: {
          paymentMethod: paymentData.paymentType,
          fees: {
            totalFees: 0,
          },
          compliance: {},
          ...paymentData.metadata,
        },
      };

      // Store payment status
      this.paymentStatuses.set(paymentData.paymentId, paymentStatus);
      await this.storePaymentStatus(paymentStatus);

      // Initialize status history
      const statusUpdate: PaymentStatusUpdate = {
        paymentId: paymentData.paymentId,
        previousStatus: 'none',
        newStatus: paymentData.initialStatus,
        timestamp: new Date().toISOString(),
        triggeredBy: 'system',
        source: 'unified-payment-status-service',
        notificationSent: false,
        notificationChannels: [],
      };

      this.addStatusHistory(paymentData.paymentId, statusUpdate);

      // Emit creation event
      this.emit('paymentStatusCreated', {
        paymentId: paymentData.paymentId,
        paymentStatus,
      });

      console.log('Unified payment status created:', {
        paymentId: paymentData.paymentId,
        paymentType: paymentData.paymentType,
        status: paymentData.initialStatus,
        amount: paymentData.amount,
        currency: paymentData.currency,
      });

      return paymentStatus;

    } catch (error) {
      console.error('Failed to create payment status:', error);
      throw error;
    }
  }

  /**
   * Update payment status with progress tracking
   */
  async updatePaymentStatus(
    paymentId: string,
    newStatus: UnifiedPaymentStatus['status'],
    updateData?: {
      subStatus?: string;
      details?: Partial<UnifiedPaymentStatus['details']>;
      metadata?: Partial<PaymentMetadata>;
      triggeredBy?: 'system' | 'user' | 'external' | 'webhook';
      source?: string;
      reason?: string;
      relatedPayments?: RelatedPayment[];
      blockers?: PaymentBlocker[];
    }
  ): Promise<UnifiedPaymentStatus> {
    try {
      const existingStatus = this.paymentStatuses.get(paymentId);
      if (!existingStatus) {
        throw new Error(`Payment status not found: ${paymentId}`);
      }

      const previousStatus = existingStatus.status;
      const stepUpdate = this.calculateStepProgress(existingStatus.paymentType, newStatus);

      // Update payment status
      const updatedStatus: UnifiedPaymentStatus = {
        ...existingStatus,
        status: newStatus,
        subStatus: updateData?.subStatus,
        timestamp: new Date().toISOString(),
        details: {
          ...existingStatus.details,
          ...updateData?.details,
        },
        progress: {
          ...existingStatus.progress,
          ...stepUpdate,
          blockers: updateData?.blockers,
        },
        relatedPayments: updateData?.relatedPayments 
          ? [...existingStatus.relatedPayments, ...updateData.relatedPayments]
          : existingStatus.relatedPayments,
        metadata: {
          ...existingStatus.metadata,
          ...updateData?.metadata,
        },
      };

      // Store updated status
      this.paymentStatuses.set(paymentId, updatedStatus);
      await this.storePaymentStatus(updatedStatus);

      // Record status history
      const statusUpdate: PaymentStatusUpdate = {
        paymentId,
        previousStatus,
        newStatus,
        timestamp: new Date().toISOString(),
        triggeredBy: updateData?.triggeredBy || 'system',
        source: updateData?.source || 'unified-payment-status-service',
        reason: updateData?.reason,
        notificationSent: false,
        notificationChannels: [],
      };

      this.addStatusHistory(paymentId, statusUpdate);

      // Send notifications if configured
      await this.sendStatusNotifications(paymentId, statusUpdate);

      // Emit status update event
      this.emit('paymentStatusUpdated', {
        paymentId,
        previousStatus,
        newStatus,
        paymentStatus: updatedStatus,
        statusUpdate,
      });

      console.log('Payment status updated:', {
        paymentId,
        previousStatus,
        newStatus,
        currentStep: updatedStatus.progress.currentStep,
        stepName: updatedStatus.progress.stepName,
      });

      return updatedStatus;

    } catch (error) {
      console.error('Failed to update payment status:', error);
      throw error;
    }
  }

  /**
   * Get payment status by ID
   */
  async getPaymentStatus(paymentId: string): Promise<UnifiedPaymentStatus | null> {
    try {
      // Check memory cache first
      const cachedStatus = this.paymentStatuses.get(paymentId);
      if (cachedStatus) {
        return cachedStatus;
      }

      // Fetch from database
      const status = await this.fetchPaymentStatusFromDB(paymentId);
      if (status) {
        this.paymentStatuses.set(paymentId, status);
      }

      return status;

    } catch (error) {
      console.error('Failed to get payment status:', error);
      throw error;
    }
  }

  /**
   * Search payments with advanced filtering
   */
  async searchPayments(criteria: PaymentSearchCriteria): Promise<{
    payments: UnifiedPaymentStatus[];
    totalCount: number;
    hasMore: boolean;
  }> {
    try {
      // Apply filters to in-memory cache for demo
      let filteredPayments = Array.from(this.paymentStatuses.values());

      // Apply filters
      if (criteria.paymentId) {
        filteredPayments = filteredPayments.filter(p => p.paymentId.includes(criteria.paymentId!));
      }

      if (criteria.customerId) {
        filteredPayments = filteredPayments.filter(p => 
          p.customer.customerId === criteria.customerId
        );
      }

      if (criteria.email) {
        filteredPayments = filteredPayments.filter(p => 
          p.customer.email?.toLowerCase().includes(criteria.email!.toLowerCase())
        );
      }

      if (criteria.phone) {
        filteredPayments = filteredPayments.filter(p => 
          p.customer.phone?.includes(criteria.phone!)
        );
      }

      if (criteria.status && criteria.status.length > 0) {
        filteredPayments = filteredPayments.filter(p => 
          criteria.status!.includes(p.status)
        );
      }

      if (criteria.paymentType && criteria.paymentType.length > 0) {
        filteredPayments = filteredPayments.filter(p => 
          criteria.paymentType!.includes(p.paymentType)
        );
      }

      if (criteria.dateRange) {
        const startDate = new Date(criteria.dateRange.start);
        const endDate = new Date(criteria.dateRange.end);
        filteredPayments = filteredPayments.filter(p => {
          const paymentDate = new Date(p.timestamp);
          return paymentDate >= startDate && paymentDate <= endDate;
        });
      }

      if (criteria.amountRange) {
        filteredPayments = filteredPayments.filter(p => 
          p.details.amount >= criteria.amountRange!.min &&
          p.details.amount <= criteria.amountRange!.max &&
          p.details.currency === criteria.amountRange!.currency
        );
      }

      if (criteria.productId) {
        filteredPayments = filteredPayments.filter(p => 
          p.metadata.productId === criteria.productId
        );
      }

      if (criteria.orderId) {
        filteredPayments = filteredPayments.filter(p => 
          p.metadata.orderId === criteria.orderId
        );
      }

      // Apply sorting
      const sortBy = criteria.sortBy || 'timestamp';
      const sortOrder = criteria.sortOrder || 'desc';
      
      filteredPayments.sort((a, b) => {
        let aValue: any, bValue: any;
        
        switch (sortBy) {
          case 'timestamp':
            aValue = new Date(a.timestamp).getTime();
            bValue = new Date(b.timestamp).getTime();
            break;
          case 'amount':
            aValue = a.details.amount;
            bValue = b.details.amount;
            break;
          case 'status':
            aValue = a.status;
            bValue = b.status;
            break;
          default:
            aValue = a.timestamp;
            bValue = b.timestamp;
        }

        if (sortOrder === 'asc') {
          return aValue > bValue ? 1 : -1;
        } else {
          return aValue < bValue ? 1 : -1;
        }
      });

      // Apply pagination
      const offset = criteria.offset || 0;
      const limit = criteria.limit || 50;
      const totalCount = filteredPayments.length;
      const paginatedPayments = filteredPayments.slice(offset, offset + limit);
      const hasMore = offset + limit < totalCount;

      return {
        payments: paginatedPayments,
        totalCount,
        hasMore,
      };

    } catch (error) {
      console.error('Failed to search payments:', error);
      throw error;
    }
  }

  /**
   * Get payment status history
   */
  async getPaymentStatusHistory(paymentId: string): Promise<PaymentStatusUpdate[]> {
    try {
      const history = this.statusHistory.get(paymentId) || [];
      return [...history].sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    } catch (error) {
      console.error('Failed to get payment status history:', error);
      throw error;
    }
  }

  /**
   * Configure status notifications for a customer
   */
  async configureNotifications(config: StatusNotificationConfig): Promise<void> {
    try {
      this.customerNotifications.set(config.paymentId, config);
      await this.storeNotificationConfig(config);

      console.log('Notification configuration updated:', {
        customerId: config.customerId,
        paymentId: config.paymentId,
        channels: config.channels,
        triggers: config.triggers,
      });

    } catch (error) {
      console.error('Failed to configure notifications:', error);
      throw error;
    }
  }

  /**
   * Get payment analytics
   */
  async getPaymentAnalytics(timeframe: '1h' | '24h' | '7d' | '30d' = '24h'): Promise<PaymentAnalytics> {
    try {
      const cacheKey = `analytics_${timeframe}`;
      const cached = this.analyticsCache.get(cacheKey);
      
      if (cached && (Date.now() - cached.timestamp) < this.ANALYTICS_CACHE_DURATION) {
        return cached.data;
      }

      // Calculate analytics from payment data
      const analytics = await this.calculateAnalytics(timeframe);
      
      // Cache results
      this.analyticsCache.set(cacheKey, {
        data: analytics,
        timestamp: Date.now(),
      });

      return analytics;

    } catch (error) {
      console.error('Failed to get payment analytics:', error);
      throw error;
    }
  }

  /**
   * Get real-time payment dashboard data
   */
  async getDashboardData(): Promise<{
    recentPayments: UnifiedPaymentStatus[];
    statusCounts: { [status: string]: number };
    processingTimes: { [type: string]: number };
    alerts: Array<{
      type: 'warning' | 'error' | 'info';
      message: string;
      timestamp: string;
      paymentId?: string;
    }>;
    systemHealth: {
      totalPayments: number;
      successRate: number;
      averageProcessingTime: number;
      systemStatus: 'healthy' | 'degraded' | 'down';
    };
  }> {
    try {
      const allPayments = Array.from(this.paymentStatuses.values());
      
      // Recent payments (last 50)
      const recentPayments = allPayments
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 50);

      // Status counts
      const statusCounts: { [status: string]: number } = {};
      allPayments.forEach(payment => {
        statusCounts[payment.status] = (statusCounts[payment.status] || 0) + 1;
      });

      // Processing times by type
      const processingTimes: { [type: string]: number } = {
        hbar: 180000, // 3 minutes average
        mpesa: 120000, // 2 minutes average
        cross_chain: 300000, // 5 minutes average
      };

      // Generate alerts for problematic payments
      const alerts = this.generateSystemAlerts(allPayments);

      // System health metrics
      const totalPayments = allPayments.length;
      const successfulPayments = allPayments.filter(p => 
        p.status === 'completed' || p.status === 'settled'
      ).length;
      const successRate = totalPayments > 0 ? (successfulPayments / totalPayments) * 100 : 0;
      const averageProcessingTime = 150000; // Mock 2.5 minutes average

      const systemHealth = {
        totalPayments,
        successRate,
        averageProcessingTime,
        systemStatus: (successRate > 95 ? 'healthy' : successRate > 85 ? 'degraded' : 'down') as 'healthy' | 'degraded' | 'down',
      };

      return {
        recentPayments,
        statusCounts,
        processingTimes,
        alerts,
        systemHealth,
      };

    } catch (error) {
      console.error('Failed to get dashboard data:', error);
      throw error;
    }
  }

  // Private helper methods

  private setupEventListeners(): void {
    // Listen to HBAR payment events
    paymentMonitoringService.on('paymentConfirmed', async (data) => {
      await this.updatePaymentStatus(
        data.paymentRequest.requestId,
        'confirmed',
        {
          triggeredBy: 'system',
          source: 'hbar-payment-monitoring',
          reason: 'HBAR transaction confirmed on Hedera network',
          details: {
            amount: data.transaction.amountUSD,
            currency: 'USD',
            originalAmount: parseFloat(data.transaction.amountHBAR),
            originalCurrency: 'HBAR',
            exchangeRate: data.transaction.exchangeRate,
          },
        }
      );
    });

    paymentMonitoringService.on('paymentTimeout', async (data) => {
      await this.updatePaymentStatus(
        data.paymentRequest.requestId,
        'failed',
        {
          triggeredBy: 'system',
          source: 'hbar-payment-monitoring',
          reason: 'Payment timeout - no transaction received',
          blockers: [{
            blockerId: `timeout_${Date.now()}`,
            blockerType: 'manual_review',
            description: 'Payment timed out without receiving transaction',
            severity: 'medium',
            actionRequired: 'Contact customer or retry payment',
          }],
        }
      );
    });

    // Listen to M-Pesa payment events
    mpesaPaymentRequestService.on('stkPushInitiated', async (data) => {
      await this.updatePaymentStatus(
        data.paymentRequestId,
        'pending',
        {
          triggeredBy: 'system',
          source: 'mpesa-payment-service',
          reason: 'STK Push sent to customer phone',
          subStatus: 'awaiting_customer_authorization',
        }
      );
    });

    mpesaPaymentRequestService.on('paymentCompleted', async (data) => {
      await this.updatePaymentStatus(
        data.paymentRequestId,
        'confirmed',
        {
          triggeredBy: 'external',
          source: 'mpesa-callback',
          reason: 'M-Pesa payment confirmed by Safaricom',
          details: {
            amount: data.amount,
            currency: 'KES',
          },
        }
      );
    });

    mpesaPaymentRequestService.on('paymentFailed', async (data) => {
      await this.updatePaymentStatus(
        data.paymentRequestId,
        'failed',
        {
          triggeredBy: 'external',
          source: 'mpesa-callback',
          reason: data.reason || 'M-Pesa payment failed',
          blockers: [{
            blockerId: `mpesa_fail_${Date.now()}`,
            blockerType: data.reason?.includes('insufficient') ? 'insufficient_funds' : 'system_error',
            description: data.reason || 'M-Pesa payment failed',
            severity: 'high',
            actionRequired: 'Customer should retry payment or use alternative method',
          }],
        }
      );
    });
  }

  private startBackgroundProcessing(): void {
    // Update analytics cache every 5 minutes
    setInterval(async () => {
      try {
        await this.refreshAnalyticsCache();
      } catch (error) {
        console.error('Failed to refresh analytics cache:', error);
      }
    }, 5 * 60 * 1000);

    // Clean up old history entries every hour
    setInterval(() => {
      this.cleanupOldHistory();
    }, 60 * 60 * 1000);

    // Process pending notifications every 30 seconds
    setInterval(async () => {
      await this.processPendingNotifications();
    }, 30 * 1000);
  }

  private calculateStepProgress(
    paymentType: string, 
    status: string
  ): Partial<PaymentProgress> {
    const steps = this.PAYMENT_STEPS[paymentType as keyof typeof this.PAYMENT_STEPS];
    if (!steps) return {};

    let currentStep = 1;
    let stepName = steps[0].name;
    let stepDescription = steps[0].description;

    // Map status to step
    switch (status) {
      case 'initiated':
        currentStep = 1;
        break;
      case 'pending':
        currentStep = 2;
        break;
      case 'processing':
        currentStep = 3;
        break;
      case 'confirmed':
        currentStep = 4;
        break;
      case 'settled':
        currentStep = 5;
        break;
      case 'completed':
        currentStep = 6;
        break;
      case 'failed':
      case 'cancelled':
        // Don't update step for final failure states
        return {};
    }

    if (currentStep <= steps.length) {
      stepName = steps[currentStep - 1].name;
      stepDescription = steps[currentStep - 1].description;
    }

    return {
      currentStep,
      stepName,
      stepDescription,
      nextSteps: steps.slice(currentStep).map(s => s.name),
    };
  }

  private addStatusHistory(paymentId: string, statusUpdate: PaymentStatusUpdate): void {
    if (!this.statusHistory.has(paymentId)) {
      this.statusHistory.set(paymentId, []);
    }

    const history = this.statusHistory.get(paymentId)!;
    history.push(statusUpdate);

    // Trim history if too long
    if (history.length > this.MAX_HISTORY_ENTRIES) {
      history.splice(0, history.length - this.MAX_HISTORY_ENTRIES);
    }
  }

  private async sendStatusNotifications(
    paymentId: string,
    statusUpdate: PaymentStatusUpdate
  ): Promise<void> {
    try {
      const notificationConfig = this.customerNotifications.get(paymentId);
      if (!notificationConfig) return;

      // Check if this status change should trigger notifications
      const shouldNotify = notificationConfig.triggers.includes('status_change') ||
        (statusUpdate.newStatus === 'completed' && notificationConfig.triggers.includes('completion')) ||
        (statusUpdate.newStatus === 'failed' && notificationConfig.triggers.includes('error'));

      if (!shouldNotify) return;

      // Send notifications via configured channels
      const sentChannels: string[] = [];

      for (const channel of notificationConfig.channels) {
        try {
          await this.sendNotification(channel, paymentId, statusUpdate, notificationConfig);
          sentChannels.push(channel);
        } catch (error) {
          console.error(`Failed to send ${channel} notification:`, error);
        }
      }

      // Update status update with notification info
      statusUpdate.notificationSent = sentChannels.length > 0;
      statusUpdate.notificationChannels = sentChannels;

    } catch (error) {
      console.error('Failed to send status notifications:', error);
    }
  }

  private async sendNotification(
    channel: string,
    paymentId: string,
    statusUpdate: PaymentStatusUpdate,
    config: StatusNotificationConfig
  ): Promise<void> {
    // Mock notification sending - in production would integrate with actual notification services
    console.log(`${channel.toUpperCase()} notification sent:`, {
      customerId: config.customerId,
      paymentId,
      status: statusUpdate.newStatus,
      timestamp: statusUpdate.timestamp,
    });
  }

  private async calculateAnalytics(timeframe: string): Promise<PaymentAnalytics> {
    const allPayments = Array.from(this.paymentStatuses.values());
    
    // Filter by timeframe
    const now = Date.now();
    let windowMs: number;
    
    switch (timeframe) {
      case '1h':
        windowMs = 60 * 60 * 1000;
        break;
      case '24h':
        windowMs = 24 * 60 * 60 * 1000;
        break;
      case '7d':
        windowMs = 7 * 24 * 60 * 60 * 1000;
        break;
      case '30d':
        windowMs = 30 * 24 * 60 * 60 * 1000;
        break;
      default:
        windowMs = 24 * 60 * 60 * 1000;
    }

    const cutoffTime = new Date(now - windowMs);
    const recentPayments = allPayments.filter(payment => 
      new Date(payment.timestamp) >= cutoffTime
    );

    // Calculate analytics
    const totalPayments = recentPayments.length;
    
    const paymentsByStatus: { [status: string]: number } = {};
    const paymentsByType: { [type: string]: number } = {};
    const successfulPayments = recentPayments.filter(p => 
      p.status === 'completed' || p.status === 'settled'
    );

    recentPayments.forEach(payment => {
      paymentsByStatus[payment.status] = (paymentsByStatus[payment.status] || 0) + 1;
      paymentsByType[payment.paymentType] = (paymentsByType[payment.paymentType] || 0) + 1;
    });

    const successRate = totalPayments > 0 ? (successfulPayments.length / totalPayments) * 100 : 0;

    // Mock additional analytics
    const analytics: PaymentAnalytics = {
      totalPayments,
      paymentsByStatus,
      paymentsByType,
      averageProcessingTime: {
        hbar: 180000, // 3 minutes
        mpesa: 120000, // 2 minutes
        cross_chain: 300000, // 5 minutes
      },
      successRate,
      failureReasons: {
        'timeout': 12,
        'insufficient_funds': 8,
        'network_error': 5,
        'validation_failure': 3,
      },
      volumeByTimeframe: {
        hourly: {},
        daily: {},
        weekly: {},
      },
      topCustomers: [
        { customerId: 'CUST_001', paymentCount: 15, totalVolume: 1250.50, currency: 'USD' },
        { customerId: 'CUST_002', paymentCount: 12, totalVolume: 980.25, currency: 'USD' },
        { customerId: 'CUST_003', paymentCount: 10, totalVolume: 750.00, currency: 'USD' },
      ],
      geographicDistribution: {
        'Kenya': 45,
        'Nigeria': 23,
        'South Africa': 18,
        'Ghana': 12,
        'Uganda': 8,
      },
      revenueMetrics: {
        totalFees: 128.75,
        feesByType: {
          network: 65.25,
          service: 45.50,
          conversion: 18.00,
        },
        averageFeePerTransaction: 2.15,
      },
    };

    return analytics;
  }

  private generateSystemAlerts(payments: UnifiedPaymentStatus[]): Array<{
    type: 'warning' | 'error' | 'info';
    message: string;
    timestamp: string;
    paymentId?: string;
  }> {
    const alerts: Array<{
      type: 'warning' | 'error' | 'info';
      message: string;
      timestamp: string;
      paymentId?: string;
    }> = [];

    // Check for stuck payments
    const stuckPayments = payments.filter(p => {
      const age = Date.now() - new Date(p.timestamp).getTime();
      return (p.status === 'pending' || p.status === 'processing') && age > 10 * 60 * 1000; // 10 minutes
    });

    stuckPayments.forEach(payment => {
      alerts.push({
        type: 'warning',
        message: `Payment ${payment.paymentId} stuck in ${payment.status} status for over 10 minutes`,
        timestamp: new Date().toISOString(),
        paymentId: payment.paymentId,
      });
    });

    // Check for high failure rate
    const recentPayments = payments.filter(p => 
      Date.now() - new Date(p.timestamp).getTime() < 60 * 60 * 1000 // Last hour
    );
    
    if (recentPayments.length > 10) {
      const failedCount = recentPayments.filter(p => p.status === 'failed').length;
      const failureRate = (failedCount / recentPayments.length) * 100;
      
      if (failureRate > 20) {
        alerts.push({
          type: 'error',
          message: `High failure rate detected: ${failureRate.toFixed(1)}% in the last hour`,
          timestamp: new Date().toISOString(),
        });
      }
    }

    return alerts.slice(0, 10); // Limit to 10 most recent alerts
  }

  private async refreshAnalyticsCache(): Promise<void> {
    const timeframes = ['1h', '24h', '7d', '30d'] as const;
    
    for (const timeframe of timeframes) {
      try {
        const analytics = await this.calculateAnalytics(timeframe);
        this.analyticsCache.set(`analytics_${timeframe}`, {
          data: analytics,
          timestamp: Date.now(),
        });
      } catch (error) {
        console.error(`Failed to refresh analytics cache for ${timeframe}:`, error);
      }
    }
  }

  private cleanupOldHistory(): void {
    const cutoffTime = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days
    
    for (const [paymentId, history] of this.statusHistory.entries()) {
      const filteredHistory = history.filter(update => 
        new Date(update.timestamp).getTime() > cutoffTime
      );
      
      if (filteredHistory.length === 0) {
        this.statusHistory.delete(paymentId);
      } else {
        this.statusHistory.set(paymentId, filteredHistory);
      }
    }
  }

  private async processPendingNotifications(): Promise<void> {
    // Mock notification processing - in production would handle queued notifications
    console.log('Processing pending notifications...');
  }

  // Mock database methods - in production would use actual database

  private async storePaymentStatus(status: UnifiedPaymentStatus): Promise<void> {
    // Mock database storage
    console.log('Storing payment status to database:', status.paymentId);
  }

  private async fetchPaymentStatusFromDB(paymentId: string): Promise<UnifiedPaymentStatus | null> {
    // Mock database fetch
    return null;
  }

  private async storeNotificationConfig(config: StatusNotificationConfig): Promise<void> {
    // Mock database storage
    console.log('Storing notification config:', config.paymentId);
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    this.paymentStatuses.clear();
    this.statusHistory.clear();
    this.customerNotifications.clear();
    this.analyticsCache.clear();
    this.removeAllListeners();
    console.log('Unified payment status service cleaned up');
  }
}

// Export singleton instance
export const unifiedPaymentStatusService = new UnifiedPaymentStatusService();

export default unifiedPaymentStatusService;