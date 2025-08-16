/**
 * M-Pesa Service
 * 
 * Comprehensive Safaricom M-Pesa Business to Customer (B2C) API integration featuring:
 * - M-Pesa B2C API authentication and transaction processing
 * - Automated KES settlement to artisan M-Pesa accounts
 * - Transaction result webhook handling and confirmation
 * - Settlement status tracking and audit logging
 * - Error handling with retry logic for failed transactions
 * - SMS notification integration for settlement confirmations
 */

import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import Database from '../config/database';

export interface MpesaConfig {
  consumerKey: string;
  consumerSecret: string;
  businessShortCode: string;
  passkey: string;
  initiatorName: string;
  securityCredential: string;
  callbackUrl: string;
  baseUrl: string;
  environment: 'sandbox' | 'production';
}

export interface MpesaAuthResponse {
  access_token: string;
  expires_in: string;
  token_type: string;
}

export interface B2CPaymentRequest {
  amount: number;
  phoneNumber: string;
  commandId: 'SalaryPayment' | 'BusinessPayment' | 'PromotionPayment';
  remarks?: string;
  occasion?: string;
  recipientName?: string;
  referenceNumber?: string;
}

export interface B2CPaymentResponse {
  conversationId: string;
  originatorConversationId: string;
  responseCode: string;
  responseDescription: string;
  requestId?: string;
}

export interface MpesaCallbackResult {
  conversationId: string;
  originatorConversationId: string;
  responseCode: string;
  responseDescription: string;
  transactionId?: string;
  transactionReceipt?: string;
  transactionAmount?: number;
  b2CWorkingAccountAvailableFunds?: number;
  b2CUtilityAccountAvailableFunds?: number;
  transactionCompletedDateTime?: string;
  receiverPartyPublicName?: string;
  b2CChargesPaidAccountAvailableFunds?: number;
  b2CRecipientIsRegisteredCustomer?: string;
}

export interface SettlementRequest {
  artisanId: string;
  artisanMpesaNumber: string;
  artisanName: string;
  originalPaymentId: string;
  originalTransactionId: string;
  amountHBAR: string;
  amountUSD: number;
  amountKES: number;
  exchangeRateUSDKES: number;
  settlementReason: string;
  productId?: string;
  orderReference?: string;
}

export interface SettlementResult {
  settlementId: string;
  settlementStatus: 'initiated' | 'pending' | 'completed' | 'failed' | 'cancelled';
  mpesaConversationId?: string;
  mpesaTransactionId?: string;
  mpesaTransactionReceipt?: string;
  settlementAmount: number;
  settlementCurrency: 'KES';
  processingFee: number;
  netSettlementAmount: number;
  initiatedAt: string;
  completedAt?: string;
  failureReason?: string;
  retryCount: number;
  maxRetries: number;
  nextRetryAt?: string;
}

export interface SettlementAuditLog {
  logId: string;
  settlementId: string;
  eventType: 'settlement_initiated' | 'mpesa_request_sent' | 'mpesa_callback_received' | 'settlement_completed' | 'settlement_failed' | 'retry_attempted';
  eventData: any;
  timestamp: string;
  userId?: string;
  ipAddress?: string;
}

export class MpesaService extends EventEmitter {
  private db: Database;
  private config: MpesaConfig;
  private httpClient: AxiosInstance;
  private accessToken: string = '';
  private tokenExpiry: Date = new Date();
  private activeSettlements: Map<string, SettlementResult> = new Map();
  private retryQueues: Map<string, NodeJS.Timeout> = new Map();

  private readonly DEFAULT_CONFIG: Partial<MpesaConfig> = {
    baseUrl: process.env.MPESA_BASE_URL || 'https://sandbox.safaricom.co.ke',
    environment: (process.env.MPESA_ENVIRONMENT as 'sandbox' | 'production') || 'sandbox',
    callbackUrl: process.env.MPESA_CALLBACK_URL || 'https://your-domain.com/api/mpesa/callback',
  };

  constructor(config: MpesaConfig) {
    super();
    this.config = { ...this.DEFAULT_CONFIG, ...config } as MpesaConfig;
    this.db = Database.getInstance();
    this.initializeHttpClient();
    this.startBackgroundProcessing();
  }

  /**
   * Initialize settlement from HBAR payment confirmation
   */
  async initiateSettlement(settlementRequest: SettlementRequest): Promise<string> {
    try {
      const settlementId = this.generateSettlementId();
      
      // Calculate processing fee (1% of settlement amount)
      const processingFee = Math.round(settlementRequest.amountKES * 0.01);
      const netSettlementAmount = settlementRequest.amountKES - processingFee;

      // Validate minimum settlement amount (KES 10)
      if (netSettlementAmount < 10) {
        throw new Error('Settlement amount too small (minimum KES 10 after fees)');
      }

      // Validate M-Pesa phone number format
      const phoneNumber = this.formatMpesaPhoneNumber(settlementRequest.artisanMpesaNumber);
      
      const settlementResult: SettlementResult = {
        settlementId,
        settlementStatus: 'initiated',
        settlementAmount: settlementRequest.amountKES,
        settlementCurrency: 'KES',
        processingFee,
        netSettlementAmount,
        initiatedAt: new Date().toISOString(),
        retryCount: 0,
        maxRetries: 3,
      };

      // Store settlement record
      this.activeSettlements.set(settlementId, settlementResult);
      await this.storeSettlementRecord(settlementId, settlementRequest, settlementResult);

      // Log settlement initiation
      await this.createSettlementAuditLog({
        settlementId,
        eventType: 'settlement_initiated',
        eventData: {
          artisanId: settlementRequest.artisanId,
          originalPaymentId: settlementRequest.originalPaymentId,
          amountKES: settlementRequest.amountKES,
          netAmount: netSettlementAmount,
        },
      });

      // Process M-Pesa payment
      await this.processB2CPayment(settlementId, settlementRequest, netSettlementAmount);

      console.log('Settlement initiated:', {
        settlementId,
        artisanId: settlementRequest.artisanId,
        amountKES: settlementRequest.amountKES,
        netAmount: netSettlementAmount,
      });

      return settlementId;

    } catch (error) {
      console.error('Settlement initiation failed:', error);
      throw new Error('Settlement initiation failed');
    }
  }

  /**
   * Process B2C payment to artisan M-Pesa account
   */
  async processB2CPayment(
    settlementId: string, 
    settlementRequest: SettlementRequest, 
    amount: number
  ): Promise<void> {
    try {
      // Ensure we have a valid access token
      await this.ensureValidAccessToken();

      const phoneNumber = this.formatMpesaPhoneNumber(settlementRequest.artisanMpesaNumber);
      
      const b2cRequest: B2CPaymentRequest = {
        amount,
        phoneNumber,
        commandId: 'BusinessPayment',
        remarks: `AfriChain settlement for order ${settlementRequest.orderReference || settlementRequest.originalPaymentId}`,
        occasion: 'Product sale settlement',
        recipientName: settlementRequest.artisanName,
        referenceNumber: settlementId,
      };

      const response = await this.sendB2CPayment(b2cRequest);

      // Update settlement with M-Pesa response
      const settlement = this.activeSettlements.get(settlementId);
      if (settlement) {
        settlement.settlementStatus = 'pending';
        settlement.mpesaConversationId = response.conversationId;
        
        await this.updateSettlementRecord(settlementId, settlement);
      }

      // Log M-Pesa request
      await this.createSettlementAuditLog({
        settlementId,
        eventType: 'mpesa_request_sent',
        eventData: {
          conversationId: response.conversationId,
          responseCode: response.responseCode,
          responseDescription: response.responseDescription,
          amount,
          phoneNumber,
        },
      });

      console.log('M-Pesa B2C payment initiated:', {
        settlementId,
        conversationId: response.conversationId,
        amount,
        phoneNumber,
      });

    } catch (error) {
      console.error('M-Pesa B2C payment failed:', error);
      
      // Update settlement status to failed
      const settlement = this.activeSettlements.get(settlementId);
      if (settlement) {
        settlement.settlementStatus = 'failed';
        settlement.failureReason = error instanceof Error ? error.message : String(error);
        
        await this.updateSettlementRecord(settlementId, settlement);
        await this.scheduleRetry(settlementId, settlementRequest, amount);
      }

      throw error;
    }
  }

  /**
   * Handle M-Pesa callback result
   */
  async handleMpesaCallback(callbackData: MpesaCallbackResult): Promise<void> {
    try {
      const { conversationId, responseCode } = callbackData;
      
      // Find settlement by conversation ID
      const settlementId = await this.findSettlementByConversationId(conversationId);
      if (!settlementId) {
        console.warn('Settlement not found for conversation ID:', conversationId);
        return;
      }

      const settlement = this.activeSettlements.get(settlementId);
      if (!settlement) {
        console.warn('Active settlement not found:', settlementId);
        return;
      }

      // Log callback received
      await this.createSettlementAuditLog({
        settlementId,
        eventType: 'mpesa_callback_received',
        eventData: callbackData,
      });

      if (responseCode === '0') {
        // Settlement successful
        settlement.settlementStatus = 'completed';
        settlement.mpesaTransactionId = callbackData.transactionId;
        settlement.mpesaTransactionReceipt = callbackData.transactionReceipt;
        settlement.completedAt = new Date().toISOString();

        await this.updateSettlementRecord(settlementId, settlement);
        
        // Log completion
        await this.createSettlementAuditLog({
          settlementId,
          eventType: 'settlement_completed',
          eventData: {
            transactionId: callbackData.transactionId,
            transactionReceipt: callbackData.transactionReceipt,
            amount: callbackData.transactionAmount,
          },
        });

        // Send completion notification
        await this.sendSettlementNotification(settlementId, settlement, 'completed');

        // Emit success event
        this.emit('settlementCompleted', {
          settlementId,
          settlement,
          callbackData,
        });

        // Remove from active settlements
        this.activeSettlements.delete(settlementId);

        console.log('Settlement completed successfully:', {
          settlementId,
          transactionId: callbackData.transactionId,
          amount: callbackData.transactionAmount,
        });

      } else {
        // Settlement failed
        settlement.settlementStatus = 'failed';
        settlement.failureReason = callbackData.responseDescription;

        await this.updateSettlementRecord(settlementId, settlement);
        
        // Log failure
        await this.createSettlementAuditLog({
          settlementId,
          eventType: 'settlement_failed',
          eventData: {
            responseCode: callbackData.responseCode,
            responseDescription: callbackData.responseDescription,
          },
        });

        // Send failure notification
        await this.sendSettlementNotification(settlementId, settlement, 'failed');

        // Emit failure event
        this.emit('settlementFailed', {
          settlementId,
          settlement,
          callbackData,
        });

        console.log('Settlement failed:', {
          settlementId,
          responseCode: callbackData.responseCode,
          responseDescription: callbackData.responseDescription,
        });
      }

    } catch (error) {
      console.error('M-Pesa callback handling failed:', error);
    }
  }

  /**
   * Get settlement status
   */
  async getSettlementStatus(settlementId: string): Promise<SettlementResult | null> {
    try {
      const activeSettlement = this.activeSettlements.get(settlementId);
      if (activeSettlement) {
        return activeSettlement;
      }

      // Check database for completed settlements
      return await this.getStoredSettlementRecord(settlementId);

    } catch (error) {
      console.error('Failed to get settlement status:', error);
      return null;
    }
  }

  /**
   * Get settlement audit trail
   */
  async getSettlementAuditTrail(settlementId: string): Promise<SettlementAuditLog[]> {
    try {
      return await this.getStoredSettlementAuditLogs(settlementId);
    } catch (error) {
      console.error('Failed to get settlement audit trail:', error);
      return [];
    }
  }

  // Private methods

  private initializeHttpClient(): void {
    this.httpClient = axios.create({
      baseURL: this.config.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'AfriChain-MPesa-Client/1.0',
      },
    });

    // Add request interceptor for authentication
    this.httpClient.interceptors.request.use(async (config) => {
      if (config.url !== '/oauth/v1/generate' && config.url !== '/mpesa/b2c/v1/paymentrequest') {
        await this.ensureValidAccessToken();
        config.headers.Authorization = `Bearer ${this.accessToken}`;
      }
      return config;
    });
  }

  private async ensureValidAccessToken(): Promise<void> {
    if (this.accessToken && new Date() < this.tokenExpiry) {
      return; // Token is still valid
    }

    try {
      const auth = Buffer.from(`${this.config.consumerKey}:${this.config.consumerSecret}`).toString('base64');
      
      const response = await axios.get(`${this.config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
      });

      const authData: MpesaAuthResponse = response.data;
      this.accessToken = authData.access_token;
      this.tokenExpiry = new Date(Date.now() + (parseInt(authData.expires_in) - 60) * 1000); // Refresh 1 min early

      console.log('M-Pesa access token refreshed:', {
        tokenType: authData.token_type,
        expiresIn: authData.expires_in,
      });

    } catch (error) {
      console.error('M-Pesa authentication failed:', error);
      throw new Error('M-Pesa authentication failed');
    }
  }

  private async sendB2CPayment(request: B2CPaymentRequest): Promise<B2CPaymentResponse> {
    try {
      const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
      const password = Buffer.from(`${this.config.businessShortCode}${this.config.passkey}${timestamp}`).toString('base64');

      const payload = {
        InitiatorName: this.config.initiatorName,
        SecurityCredential: this.config.securityCredential,
        CommandID: request.commandId,
        Amount: request.amount,
        PartyA: this.config.businessShortCode,
        PartyB: request.phoneNumber,
        Remarks: request.remarks || 'AfriChain settlement',
        QueueTimeOutURL: `${this.config.callbackUrl}/timeout`,
        ResultURL: `${this.config.callbackUrl}/result`,
        Occasion: request.occasion || 'Payment',
      };

      const response = await this.httpClient.post('/mpesa/b2c/v1/paymentrequest', payload);
      return response.data;

    } catch (error) {
      console.error('M-Pesa B2C API request failed:', error);
      throw error;
    }
  }

  private formatMpesaPhoneNumber(phoneNumber: string): string {
    // Remove any non-digit characters
    let cleaned = phoneNumber.replace(/\D/g, '');
    
    // Handle different formats
    if (cleaned.startsWith('0')) {
      cleaned = '254' + cleaned.slice(1); // Replace leading 0 with 254
    } else if (cleaned.startsWith('254')) {
      // Already in correct format
    } else if (cleaned.startsWith('7') || cleaned.startsWith('1')) {
      cleaned = '254' + cleaned; // Add 254 prefix
    }
    
    // Validate length (should be 12 digits: 254XXXXXXXXX)
    if (cleaned.length !== 12) {
      throw new Error('Invalid M-Pesa phone number format');
    }
    
    return cleaned;
  }

  private generateSettlementId(): string {
    return `SET_${Date.now()}_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  }

  private async scheduleRetry(
    settlementId: string, 
    settlementRequest: SettlementRequest, 
    amount: number
  ): Promise<void> {
    const settlement = this.activeSettlements.get(settlementId);
    if (!settlement || settlement.retryCount >= settlement.maxRetries) {
      return;
    }

    // Calculate exponential backoff delay (2^retryCount * 60 seconds)
    const delayMs = Math.pow(2, settlement.retryCount) * 60 * 1000;
    settlement.nextRetryAt = new Date(Date.now() + delayMs).toISOString();

    await this.updateSettlementRecord(settlementId, settlement);

    const retryTimeout = setTimeout(async () => {
      try {
        settlement.retryCount++;
        
        await this.createSettlementAuditLog({
          settlementId,
          eventType: 'retry_attempted',
          eventData: {
            retryCount: settlement.retryCount,
            maxRetries: settlement.maxRetries,
          },
        });

        await this.processB2CPayment(settlementId, settlementRequest, amount);
        
      } catch (error) {
        console.error('Settlement retry failed:', error);
      } finally {
        this.retryQueues.delete(settlementId);
      }
    }, delayMs);

    this.retryQueues.set(settlementId, retryTimeout);
  }

  private startBackgroundProcessing(): void {
    // Clean up old settlements every hour
    setInterval(() => {
      this.cleanupOldSettlements();
    }, 60 * 60 * 1000);

    // Process pending settlements every 10 minutes
    setInterval(() => {
      this.processPendingSettlements();
    }, 10 * 60 * 1000);
  }

  private cleanupOldSettlements(): void {
    const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
    
    for (const [settlementId, settlement] of this.activeSettlements.entries()) {
      const settlementTime = new Date(settlement.initiatedAt).getTime();
      if (settlementTime < cutoff) {
        console.log('Cleaning up old settlement:', settlementId);
        this.activeSettlements.delete(settlementId);
        
        const retryTimeout = this.retryQueues.get(settlementId);
        if (retryTimeout) {
          clearTimeout(retryTimeout);
          this.retryQueues.delete(settlementId);
        }
      }
    }
  }

  private async processPendingSettlements(): Promise<void> {
    // Query database for settlements that might need status updates
    console.log('Processing pending settlements...');
  }

  // Mock database methods (would be implemented with actual database)

  private async storeSettlementRecord(
    settlementId: string, 
    request: SettlementRequest, 
    result: SettlementResult
  ): Promise<void> {
    console.log('Storing settlement record:', { settlementId, request, result });
    // In production, store in settlements table
  }

  private async updateSettlementRecord(settlementId: string, settlement: SettlementResult): Promise<void> {
    console.log('Updating settlement record:', { settlementId, settlement });
    // In production, update settlements table
  }

  private async getStoredSettlementRecord(settlementId: string): Promise<SettlementResult | null> {
    console.log('Getting stored settlement record:', settlementId);
    // In production, query settlements table
    return null;
  }

  private async findSettlementByConversationId(conversationId: string): Promise<string | null> {
    // Check active settlements first
    for (const [settlementId, settlement] of this.activeSettlements.entries()) {
      if (settlement.mpesaConversationId === conversationId) {
        return settlementId;
      }
    }
    
    // In production, query database for stored settlements
    console.log('Finding settlement by conversation ID:', conversationId);
    return null;
  }

  private async createSettlementAuditLog(logData: Partial<SettlementAuditLog>): Promise<void> {
    const auditLog: SettlementAuditLog = {
      logId: `SLOG_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      timestamp: new Date().toISOString(),
      ...logData,
    } as SettlementAuditLog;

    console.log('Settlement audit log created:', auditLog);
    // In production, store in settlement_audit_logs table
  }

  private async getStoredSettlementAuditLogs(settlementId: string): Promise<SettlementAuditLog[]> {
    console.log('Getting settlement audit logs:', settlementId);
    // In production, query settlement_audit_logs table
    return [];
  }

  private async sendSettlementNotification(
    settlementId: string, 
    settlement: SettlementResult, 
    status: 'completed' | 'failed'
  ): Promise<void> {
    console.log('Sending settlement notification:', {
      settlementId,
      status,
      amount: settlement.netSettlementAmount,
    });
    // In production, send SMS notification to artisan
  }
}

// Export singleton instance for dependency injection
export const mpesaService = new MpesaService({
  consumerKey: process.env.MPESA_CONSUMER_KEY || '',
  consumerSecret: process.env.MPESA_CONSUMER_SECRET || '',
  businessShortCode: process.env.MPESA_BUSINESS_SHORT_CODE || '',
  passkey: process.env.MPESA_PASSKEY || '',
  initiatorName: process.env.MPESA_INITIATOR_NAME || '',
  securityCredential: process.env.MPESA_SECURITY_CREDENTIAL || '',
  callbackUrl: process.env.MPESA_CALLBACK_URL || 'https://your-domain.com/api/mpesa/callback',
  baseUrl: process.env.MPESA_BASE_URL || 'https://sandbox.safaricom.co.ke',
  environment: (process.env.MPESA_ENVIRONMENT as 'sandbox' | 'production') || 'sandbox',
});

export default mpesaService;