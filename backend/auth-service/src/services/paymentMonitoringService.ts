/**
 * Payment Monitoring Service
 * 
 * Advanced real-time payment monitoring system featuring:
 * - Hedera Mirror Node API integration for transaction monitoring
 * - Real-time transaction status polling and confirmation
 * - Payment timeout and failure handling with automatic retries
 * - Transaction hash tracking and validation
 * - Webhook notifications for payment events
 * - Payment analytics and reporting
 */

import axios from 'axios';
import { EventEmitter } from 'events';
import Database from '../config/database';
import { PaymentRequest, PaymentTransaction, ExchangeRateData } from './hbarPaymentService';

export interface MirrorNodeTransaction {
  transaction_id: string;
  consensus_timestamp: string;
  transaction_hash: string;
  transfers: Array<{
    account: string;
    amount: number;
  }>;
  memo_base64?: string;
  result: string;
  charged_tx_fee: number;
  max_fee: string;
  valid_start_timestamp: string;
  valid_duration_seconds: number;
  node: string;
  scheduled: boolean;
}

export interface PaymentMonitoringConfig {
  mirrorNodeUrl: string;
  pollingIntervalMs: number;
  maxRetries: number;
  timeoutMinutes: number;
  webhookUrl?: string;
  enableAnalytics: boolean;
  batchSize: number;
}

export interface MonitoringSession {
  sessionId: string;
  paymentRequestId: string;
  startTime: string;
  endTime?: string;
  status: 'active' | 'completed' | 'timeout' | 'failed' | 'cancelled';
  lastCheckTime: string;
  retryCount: number;
  transactionFound: boolean;
  monitoringEvents: MonitoringEvent[];
}

export interface MonitoringEvent {
  timestamp: string;
  type: 'started' | 'polling' | 'transaction_found' | 'validation_success' | 'validation_failed' | 'timeout' | 'error';
  data: any;
  message: string;
}

export interface PaymentAnalytics {
  totalMonitoredPayments: number;
  successfulPayments: number;
  failedPayments: number;
  timeoutPayments: number;
  averageConfirmationTime: number;
  averagePollingCycles: number;
  popularPaymentAmounts: Array<{ amount: string; count: number }>;
  hourlyPaymentVolume: Array<{ hour: string; count: number; totalAmount: string }>;
  paymentTrends: {
    dailyGrowth: number;
    weeklyGrowth: number;
    monthlyGrowth: number;
  };
}

export class PaymentMonitoringService extends EventEmitter {
  private db: Database;
  private config: PaymentMonitoringConfig;
  private activeSessions: Map<string, MonitoringSession> = new Map();
  private pollingIntervals: Map<string, NodeJS.Timeout> = new Map();
  private transactionCache: Map<string, MirrorNodeTransaction[]> = new Map();

  private readonly DEFAULT_CONFIG: PaymentMonitoringConfig = {
    mirrorNodeUrl: process.env.HEDERA_MIRROR_NODE_URL || 'https://testnet.mirrornode.hedera.com',
    pollingIntervalMs: 10000, // Poll every 10 seconds
    maxRetries: 30, // Maximum 30 retries (5 minutes total)
    timeoutMinutes: 5, // Timeout after 5 minutes
    enableAnalytics: true,
    batchSize: 100,
  };

  constructor(config?: Partial<PaymentMonitoringConfig>) {
    super();
    this.db = Database.getInstance();
    this.config = { ...this.DEFAULT_CONFIG, ...config };
    this.startCleanupRoutine();
  }

  /**
   * Start monitoring a payment request
   */
  async startMonitoring(paymentRequest: PaymentRequest): Promise<string> {
    try {
      const sessionId = this.generateSessionId();
      
      const session: MonitoringSession = {
        sessionId,
        paymentRequestId: paymentRequest.requestId,
        startTime: new Date().toISOString(),
        status: 'active',
        lastCheckTime: new Date().toISOString(),
        retryCount: 0,
        transactionFound: false,
        monitoringEvents: [{
          timestamp: new Date().toISOString(),
          type: 'started',
          data: { paymentRequestId: paymentRequest.requestId },
          message: 'Payment monitoring started',
        }],
      };

      this.activeSessions.set(sessionId, session);
      
      // Start polling for this session
      await this.startPolling(session, paymentRequest);

      // Store monitoring session in database
      await this.storeMonitoringSession(session);

      console.log('Payment monitoring started:', {
        sessionId,
        paymentRequestId: paymentRequest.requestId,
        memo: paymentRequest.memo,
        amount: paymentRequest.priceHBAR,
      });

      return sessionId;

    } catch (error) {
      console.error('Failed to start payment monitoring:', error);
      throw new Error('Payment monitoring initialization failed');
    }
  }

  /**
   * Stop monitoring a specific session
   */
  async stopMonitoring(sessionId: string, reason: 'cancelled' | 'completed' | 'timeout' = 'cancelled'): Promise<void> {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        console.warn('Monitoring session not found:', sessionId);
        return;
      }

      // Clear polling interval
      const interval = this.pollingIntervals.get(sessionId);
      if (interval) {
        clearInterval(interval);
        this.pollingIntervals.delete(sessionId);
      }

      // Update session status
      session.status = reason;
      session.endTime = new Date().toISOString();
      session.monitoringEvents.push({
        timestamp: new Date().toISOString(),
        type: reason === 'timeout' ? 'timeout' : 'error',
        data: { reason },
        message: `Monitoring stopped: ${reason}`,
      });

      // Remove from active sessions
      this.activeSessions.delete(sessionId);

      // Update database
      await this.updateMonitoringSession(session);

      console.log('Payment monitoring stopped:', { sessionId, reason });

    } catch (error) {
      console.error('Failed to stop payment monitoring:', error);
      throw new Error('Payment monitoring stop failed');
    }
  }

  /**
   * Get monitoring session status
   */
  async getMonitoringStatus(sessionId: string): Promise<MonitoringSession | null> {
    try {
      const session = this.activeSessions.get(sessionId);
      if (session) {
        return session;
      }

      // Check database for completed sessions
      return await this.getStoredMonitoringSession(sessionId);

    } catch (error) {
      console.error('Failed to get monitoring status:', error);
      return null;
    }
  }

  /**
   * Get all active monitoring sessions
   */
  getActiveSessions(): MonitoringSession[] {
    return Array.from(this.activeSessions.values());
  }

  /**
   * Search for transactions by memo using Hedera Mirror Node
   */
  async searchTransactionsByMemo(memo: string, startTime: Date): Promise<MirrorNodeTransaction[]> {
    try {
      const cacheKey = `${memo}_${startTime.getTime()}`;
      const cached = this.transactionCache.get(cacheKey);
      
      if (cached) {
        return cached;
      }

      // Query Hedera Mirror Node API
      const startTimestamp = (startTime.getTime() / 1000).toFixed(9);
      const url = `${this.config.mirrorNodeUrl}/api/v1/transactions`;
      
      const params = {
        'timestamp': `gte:${startTimestamp}`,
        'order': 'desc',
        'limit': this.config.batchSize,
        'result': 'success',
      };

      const response = await axios.get(url, { params, timeout: 10000 });
      const transactions: MirrorNodeTransaction[] = response.data.transactions || [];

      // Filter transactions by memo
      const matchingTransactions = transactions.filter(tx => {
        if (!tx.memo_base64) return false;
        try {
          const decodedMemo = Buffer.from(tx.memo_base64, 'base64').toString('utf-8');
          return decodedMemo.includes(memo);
        } catch {
          return false;
        }
      });

      // Cache results for 30 seconds
      this.transactionCache.set(cacheKey, matchingTransactions);
      setTimeout(() => this.transactionCache.delete(cacheKey), 30000);

      return matchingTransactions;

    } catch (error) {
      console.error('Mirror Node transaction search failed:', error);
      return [];
    }
  }

  /**
   * Validate payment transaction against payment request
   */
  validatePaymentTransaction(
    transaction: MirrorNodeTransaction,
    paymentRequest: PaymentRequest,
    treasuryAccountId: string
  ): { isValid: boolean; validationDetails: any } {
    try {
      const validationDetails = {
        memoMatch: false,
        amountMatch: false,
        recipientMatch: false,
        timingValid: false,
        feeReasonable: false,
        overallValid: false,
      };

      // Validate memo
      if (transaction.memo_base64) {
        try {
          const decodedMemo = Buffer.from(transaction.memo_base64, 'base64').toString('utf-8');
          validationDetails.memoMatch = decodedMemo.includes(paymentRequest.memo);
        } catch {
          validationDetails.memoMatch = false;
        }
      }

      // Validate recipient and amount
      const treasuryTransfer = transaction.transfers.find(
        transfer => transfer.account === treasuryAccountId && transfer.amount > 0
      );

      if (treasuryTransfer) {
        validationDetails.recipientMatch = true;
        
        // Convert tinybars to HBAR (1 HBAR = 100,000,000 tinybars)
        const receivedHBAR = treasuryTransfer.amount / 100000000;
        const expectedHBAR = parseFloat(paymentRequest.priceHBAR);
        const tolerance = expectedHBAR * 0.02; // 2% tolerance for fees
        
        validationDetails.amountMatch = Math.abs(receivedHBAR - expectedHBAR) <= tolerance;
      }

      // Validate timing (transaction should be after payment request creation)
      // Convert consensus timestamp from seconds to milliseconds for JavaScript Date
      const txTimestampMs = parseFloat(transaction.consensus_timestamp) * 1000;
      const txTimestamp = new Date(txTimestampMs);
      const requestTimestamp = new Date(paymentRequest.createdAt);
      validationDetails.timingValid = txTimestamp >= requestTimestamp;

      // Validate transaction fee is reasonable (should be less than 0.01 HBAR)
      const feeHBAR = transaction.charged_tx_fee / 100000000;
      validationDetails.feeReasonable = feeHBAR <= 0.01;

      // Overall validation
      validationDetails.overallValid = 
        validationDetails.memoMatch &&
        validationDetails.amountMatch &&
        validationDetails.recipientMatch &&
        validationDetails.timingValid &&
        validationDetails.feeReasonable;

      return {
        isValid: validationDetails.overallValid,
        validationDetails,
      };

    } catch (error) {
      console.error('Payment validation failed:', error);
      return {
        isValid: false,
        validationDetails: { error: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  /**
   * Get payment analytics
   */
  async getPaymentAnalytics(timeframe: 'day' | 'week' | 'month' = 'day'): Promise<PaymentAnalytics> {
    try {
      if (!this.config.enableAnalytics) {
        throw new Error('Analytics are disabled');
      }

      const analytics = await this.calculatePaymentAnalytics(timeframe);
      return analytics;

    } catch (error) {
      console.error('Failed to get payment analytics:', error);
      throw error;
    }
  }

  /**
   * Process webhook notification for payment events
   */
  async sendWebhookNotification(event: string, data: any): Promise<void> {
    try {
      if (!this.config.webhookUrl) {
        return;
      }

      const payload = {
        event,
        timestamp: new Date().toISOString(),
        data,
      };

      await axios.post(this.config.webhookUrl, payload, {
        timeout: 5000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'AfriChain-Payment-Monitor/1.0',
        },
      });

      console.log('Webhook notification sent:', { event, webhookUrl: this.config.webhookUrl });

    } catch (error) {
      console.error('Webhook notification failed:', error);
    }
  }

  // Private methods

  private async startPolling(session: MonitoringSession, paymentRequest: PaymentRequest): Promise<void> {
    const treasuryAccountId = paymentRequest.recipientAccountId;
    
    const poll = async () => {
      try {
        session.lastCheckTime = new Date().toISOString();
        session.retryCount++;

        // Check if payment request has expired
        if (new Date() > new Date(paymentRequest.expirationTime)) {
          await this.stopMonitoring(session.sessionId, 'timeout');
          this.emit('paymentTimeout', { sessionId: session.sessionId, paymentRequest });
          return;
        }

        // Check if max retries exceeded
        if (session.retryCount > this.config.maxRetries) {
          await this.stopMonitoring(session.sessionId, 'timeout');
          this.emit('paymentTimeout', { sessionId: session.sessionId, paymentRequest });
          return;
        }

        session.monitoringEvents.push({
          timestamp: new Date().toISOString(),
          type: 'polling',
          data: { retryCount: session.retryCount },
          message: `Polling attempt ${session.retryCount}`,
        });

        // Search for transactions
        const searchStartTime = new Date(Date.now() - 30 * 60 * 1000); // Last 30 minutes
        const transactions = await this.searchTransactionsByMemo(paymentRequest.memo, searchStartTime);

        if (transactions.length > 0) {
          // Validate each transaction
          for (const transaction of transactions) {
            const validation = this.validatePaymentTransaction(transaction, paymentRequest, treasuryAccountId);
            
            if (validation.isValid) {
              // Payment found and validated!
              session.transactionFound = true;
              session.status = 'completed';
              
              session.monitoringEvents.push({
                timestamp: new Date().toISOString(),
                type: 'transaction_found',
                data: { transaction, validation },
                message: 'Valid payment transaction found',
              });

              session.monitoringEvents.push({
                timestamp: new Date().toISOString(),
                type: 'validation_success',
                data: { validationDetails: validation.validationDetails },
                message: 'Payment validation successful',
              });

              // Convert to PaymentTransaction format
              const paymentTransaction = this.convertToPaymentTransaction(transaction, paymentRequest);

              // Stop monitoring
              await this.stopMonitoring(session.sessionId, 'completed');

              // Emit success event
              this.emit('paymentConfirmed', {
                sessionId: session.sessionId,
                paymentRequest,
                transaction: paymentTransaction,
                validationDetails: validation.validationDetails,
              });

              // Send webhook notification
              await this.sendWebhookNotification('payment_confirmed', {
                sessionId: session.sessionId,
                paymentRequestId: paymentRequest.requestId,
                transaction: paymentTransaction,
              });

              return;
            } else {
              session.monitoringEvents.push({
                timestamp: new Date().toISOString(),
                type: 'validation_failed',
                data: { transaction, validation },
                message: 'Transaction found but validation failed',
              });
            }
          }
        }

        // Update session in database
        await this.updateMonitoringSession(session);

      } catch (error) {
        console.error('Polling error for session', session.sessionId, error);
        
        session.monitoringEvents.push({
          timestamp: new Date().toISOString(),
          type: 'error',
          data: { error: error instanceof Error ? error.message : String(error) },
          message: 'Polling error occurred',
        });

        this.emit('pollingError', { sessionId: session.sessionId, error });
      }
    };

    // Start polling immediately, then at intervals
    await poll();
    
    const interval = setInterval(poll, this.config.pollingIntervalMs);
    this.pollingIntervals.set(session.sessionId, interval);
  }

  private convertToPaymentTransaction(
    mirrorTransaction: MirrorNodeTransaction,
    paymentRequest: PaymentRequest
  ): PaymentTransaction {
    const treasuryTransfer = mirrorTransaction.transfers.find(
      transfer => transfer.account === paymentRequest.recipientAccountId && transfer.amount > 0
    );

    const amountHBAR = treasuryTransfer ? (treasuryTransfer.amount / 100000000).toFixed(8) : '0';
    
    return {
      transactionId: mirrorTransaction.transaction_id,
      paymentRequestId: paymentRequest.requestId,
      transactionHash: mirrorTransaction.transaction_hash,
      senderAccountId: mirrorTransaction.transfers.find(t => t.amount < 0)?.account,
      recipientAccountId: paymentRequest.recipientAccountId,
      amountHBAR,
      amountUSD: parseFloat(amountHBAR) * (paymentRequest.priceUSD / parseFloat(paymentRequest.priceHBAR)),
      exchangeRate: paymentRequest.priceUSD / parseFloat(paymentRequest.priceHBAR),
      memo: paymentRequest.memo,
      status: 'success',
      consensusTimestamp: mirrorTransaction.consensus_timestamp,
      transactionFee: (mirrorTransaction.charged_tx_fee / 100000000).toFixed(8),
      confirmationTime: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  private generateSessionId(): string {
    return `monitor_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private startCleanupRoutine(): void {
    // Clean up old cache entries and completed sessions every 5 minutes
    setInterval(() => {
      this.cleanupOldSessions();
      this.cleanupTransactionCache();
    }, 5 * 60 * 1000);
  }

  private cleanupOldSessions(): void {
    const cutoff = Date.now() - (this.config.timeoutMinutes * 60 * 1000);
    
    for (const [sessionId, session] of this.activeSessions.entries()) {
      const sessionTime = new Date(session.startTime).getTime();
      if (sessionTime < cutoff) {
        this.stopMonitoring(sessionId, 'timeout');
      }
    }
  }

  private cleanupTransactionCache(): void {
    // Clear all cached transactions older than 5 minutes
    this.transactionCache.clear();
  }

  // Mock database methods (would be implemented with actual database)

  private async storeMonitoringSession(session: MonitoringSession): Promise<void> {
    console.log('Storing monitoring session:', session.sessionId);
  }

  private async updateMonitoringSession(session: MonitoringSession): Promise<void> {
    console.log('Updating monitoring session:', session.sessionId);
  }

  private async getStoredMonitoringSession(sessionId: string): Promise<MonitoringSession | null> {
    console.log('Getting stored monitoring session:', sessionId);
    return null;
  }

  private async calculatePaymentAnalytics(timeframe: string): Promise<PaymentAnalytics> {
    // Mock analytics data
    return {
      totalMonitoredPayments: 456,
      successfulPayments: 423,
      failedPayments: 12,
      timeoutPayments: 21,
      averageConfirmationTime: 18.7, // seconds
      averagePollingCycles: 3.2,
      popularPaymentAmounts: [
        { amount: '25.00', count: 89 },
        { amount: '50.00', count: 67 },
        { amount: '100.00', count: 45 },
      ],
      hourlyPaymentVolume: Array.from({ length: 24 }, (_, i) => ({
        hour: `${i.toString().padStart(2, '0')}:00`,
        count: Math.floor(Math.random() * 20) + 5,
        totalAmount: (Math.random() * 1000 + 100).toFixed(2),
      })),
      paymentTrends: {
        dailyGrowth: 12.5,
        weeklyGrowth: 8.3,
        monthlyGrowth: 15.7,
      },
    };
  }
}

// Export singleton instance
export const paymentMonitoringService = new PaymentMonitoringService();

export default paymentMonitoringService;