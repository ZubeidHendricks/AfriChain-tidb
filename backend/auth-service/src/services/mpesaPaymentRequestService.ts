/**
 * M-Pesa Payment Request Service
 * 
 * Advanced M-Pesa payment request and callback handling service featuring:
 * - Customer-initiated M-Pesa payment requests (C2B API)
 * - Payment request validation and processing
 * - Advanced callback handling with retry mechanisms
 * - Payment reconciliation and status tracking
 * - Customer notification system
 * - Integration with HBAR payment workflow
 */

import { EventEmitter } from 'events';
import axios, { AxiosResponse } from 'axios';
import crypto from 'crypto';
import Database from '../config/database';
import { mpesaService, MpesaCallbackResult } from './mpesaService';
import { paymentProcessingWorkflowService } from './paymentProcessingWorkflowService';

export interface MpesaPaymentRequest {
  paymentRequestId: string;
  customerMpesaNumber: string;
  customerName?: string;
  amount: number;
  currency: 'KES';
  description: string;
  merchantRequestId: string;
  checkoutRequestId: string;
  originalHBARPaymentId?: string;
  originalOrderId?: string;
  accountReference: string;
  transactionDesc: string;
  status: 'initiated' | 'pending' | 'completed' | 'failed' | 'cancelled' | 'timeout';
  responseCode?: string;
  responseDescription?: string;
  mpesaReceiptNumber?: string;
  transactionDate?: string;
  phoneNumber: string;
  expirationTime: string;
  callbackUrl: string;
  resultUrl: string;
  queueTimeoutUrl: string;
  retryCount: number;
  maxRetries: number;
  lastRetryAt?: string;
  completedAt?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface STKPushRequest {
  businessShortCode: string;
  password: string;
  timestamp: string;
  transactionType: 'CustomerPayBillOnline' | 'CustomerBuyGoodsOnline';
  amount: number;
  partyA: string; // Customer phone number
  partyB: string; // Business short code
  phoneNumber: string;
  callBackURL: string;
  accountReference: string;
  transactionDesc: string;
}

export interface STKPushResponse {
  merchantRequestId: string;
  checkoutRequestId: string;
  responseCode: string;
  responseDescription: string;
  customerMessage: string;
}

export interface STKCallbackResult {
  merchantRequestId: string;
  checkoutRequestId: string;
  resultCode: string;
  resultDesc: string;
  callbackMetadata?: {
    amount?: number;
    mpesaReceiptNumber?: string;
    balance?: string;
    transactionDate?: string;
    phoneNumber?: string;
  };
}

export interface PaymentValidationRequest {
  transactionType: string;
  transactionId: string;
  transactionTime: string;
  transactionAmount: string;
  businessShortCode: string;
  billRefNumber: string;
  invoiceNumber?: string;
  orgAccountBalance?: string;
  thirdPartyTransId?: string;
  msisdn: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
}

export interface PaymentConfirmationRequest {
  transactionType: string;
  transactionId: string;
  transactionTime: string;
  transactionAmount: string;
  businessShortCode: string;
  billRefNumber: string;
  invoiceNumber?: string;
  orgAccountBalance?: string;
  thirdPartyTransId?: string;
  msisdn: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
}

export interface PaymentReconciliationResult {
  totalRequests: number;
  completedPayments: number;
  failedPayments: number;
  pendingPayments: number;
  totalAmount: number;
  reconciliationStatus: 'balanced' | 'discrepancy' | 'pending';
  discrepancies: Array<{
    paymentRequestId: string;
    expected: number;
    actual: number;
    reason: string;
  }>;
  lastReconciledAt: string;
}

export class MpesaPaymentRequestService extends EventEmitter {
  private db: Database;
  private accessToken: string = '';
  private tokenExpiresAt: Date = new Date();
  private activePaymentRequests: Map<string, MpesaPaymentRequest> = new Map();
  private callbackRetryQueue: Map<string, number> = new Map();

  private readonly MPESA_BASE_URL = process.env.MPESA_BASE_URL || 'https://sandbox.safaricom.co.ke';
  private readonly CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY || '';
  private readonly CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET || '';
  private readonly BUSINESS_SHORT_CODE = process.env.MPESA_BUSINESS_SHORT_CODE || '';
  private readonly PASSKEY = process.env.MPESA_PASSKEY || '';
  private readonly CALLBACK_BASE_URL = process.env.MPESA_CALLBACK_URL || '';

  constructor() {
    super();
    this.db = Database.getInstance();
    this.initializeService();
    this.startBackgroundProcessing();
  }

  /**
   * Initiate STK Push payment request to customer's phone
   */
  async initiateSTKPush(
    customerPhone: string,
    amount: number,
    accountReference: string,
    transactionDesc: string,
    originalHBARPaymentId?: string,
    originalOrderId?: string
  ): Promise<MpesaPaymentRequest> {
    try {
      // Validate inputs
      this.validateSTKPushRequest(customerPhone, amount, accountReference);

      // Ensure access token is valid
      await this.ensureValidAccessToken();

      // Format phone number
      const formattedPhone = this.formatPhoneNumber(customerPhone);

      // Generate payment request ID
      const paymentRequestId = this.generatePaymentRequestId();

      // Generate timestamp and password
      const timestamp = this.generateTimestamp();
      const password = this.generateSTKPassword(timestamp);

      // Prepare STK Push request
      const stkRequest: STKPushRequest = {
        businessShortCode: this.BUSINESS_SHORT_CODE,
        password,
        timestamp,
        transactionType: 'CustomerPayBillOnline',
        amount,
        partyA: formattedPhone,
        partyB: this.BUSINESS_SHORT_CODE,
        phoneNumber: formattedPhone,
        callBackURL: `${this.CALLBACK_BASE_URL}/api/mpesa/callback/stk-push`,
        accountReference,
        transactionDesc,
      };

      // Send STK Push request to M-Pesa
      const response = await this.sendSTKPushRequest(stkRequest);

      // Create payment request record
      const paymentRequest: MpesaPaymentRequest = {
        paymentRequestId,
        customerMpesaNumber: formattedPhone,
        amount,
        currency: 'KES',
        description: transactionDesc,
        merchantRequestId: response.merchantRequestId,
        checkoutRequestId: response.checkoutRequestId,
        originalHBARPaymentId,
        originalOrderId,
        accountReference,
        transactionDesc,
        status: response.responseCode === '0' ? 'pending' : 'failed',
        responseCode: response.responseCode,
        responseDescription: response.responseDescription,
        phoneNumber: formattedPhone,
        expirationTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 minutes
        callbackUrl: stkRequest.callBackURL,
        resultUrl: stkRequest.callBackURL,
        queueTimeoutUrl: stkRequest.callBackURL,
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Store payment request
      await this.storePaymentRequest(paymentRequest);
      this.activePaymentRequests.set(paymentRequestId, paymentRequest);

      // Log STK Push initiation
      console.log('STK Push initiated:', {
        paymentRequestId,
        merchantRequestId: response.merchantRequestId,
        checkoutRequestId: response.checkoutRequestId,
        amount,
        phoneNumber: formattedPhone,
        status: paymentRequest.status,
      });

      // Emit event
      this.emit('stkPushInitiated', {
        paymentRequest,
        response,
      });

      return paymentRequest;

    } catch (error) {
      console.error('STK Push initiation failed:', error);
      throw new Error(`STK Push initiation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Handle STK Push callback from M-Pesa
   */
  async handleSTKCallback(callbackData: STKCallbackResult): Promise<void> {
    try {
      console.log('Processing STK callback:', callbackData);

      // Find payment request by checkout request ID
      const paymentRequest = await this.findPaymentRequestByCheckoutId(callbackData.checkoutRequestId);
      
      if (!paymentRequest) {
        console.warn('Payment request not found for checkout ID:', callbackData.checkoutRequestId);
        return;
      }

      // Update payment request status based on result code
      const updatedPaymentRequest = await this.updatePaymentRequestFromCallback(paymentRequest, callbackData);

      // Process successful payment
      if (callbackData.resultCode === '0' && callbackData.callbackMetadata) {
        await this.processSuccessfulPayment(updatedPaymentRequest, callbackData.callbackMetadata);
      } else {
        await this.processFailedPayment(updatedPaymentRequest, callbackData.resultDesc);
      }

      // Emit event
      this.emit('stkCallbackProcessed', {
        paymentRequest: updatedPaymentRequest,
        callbackData,
        success: callbackData.resultCode === '0',
      });

    } catch (error) {
      console.error('STK callback processing failed:', error);
      throw error;
    }
  }

  /**
   * Handle payment validation requests (C2B API)
   */
  async handlePaymentValidation(validationData: PaymentValidationRequest): Promise<{
    resultCode: string;
    resultDesc: string;
  }> {
    try {
      console.log('Processing payment validation:', validationData);

      // Validate payment details
      const isValid = await this.validateIncomingPayment(validationData);

      if (isValid) {
        // Create preliminary payment record
        await this.createPreliminaryPaymentRecord(validationData);

        return {
          resultCode: '0',
          resultDesc: 'Payment validation successful',
        };
      } else {
        return {
          resultCode: '1',
          resultDesc: 'Payment validation failed',
        };
      }

    } catch (error) {
      console.error('Payment validation failed:', error);
      return {
        resultCode: '1',
        resultDesc: 'Payment validation error',
      };
    }
  }

  /**
   * Handle payment confirmation requests (C2B API)
   */
  async handlePaymentConfirmation(confirmationData: PaymentConfirmationRequest): Promise<{
    resultCode: string;
    resultDesc: string;
  }> {
    try {
      console.log('Processing payment confirmation:', confirmationData);

      // Process confirmed payment
      await this.processConfirmedPayment(confirmationData);

      // Emit event
      this.emit('paymentConfirmed', {
        confirmationData,
        timestamp: new Date().toISOString(),
      });

      return {
        resultCode: '0',
        resultDesc: 'Payment confirmation processed successfully',
      };

    } catch (error) {
      console.error('Payment confirmation processing failed:', error);
      return {
        resultCode: '1',
        resultDesc: 'Payment confirmation processing failed',
      };
    }
  }

  /**
   * Check STK Push status by checkout request ID
   */
  async checkSTKPushStatus(checkoutRequestId: string): Promise<{
    resultCode: string;
    resultDesc: string;
    merchantRequestId?: string;
    checkoutRequestId?: string;
    responseCode?: string;
    responseDescription?: string;
    customerMessage?: string;
  }> {
    try {
      await this.ensureValidAccessToken();

      const response = await axios.post(
        `${this.MPESA_BASE_URL}/mpesa/stkpushquery/v1/query`,
        {
          BusinessShortCode: this.BUSINESS_SHORT_CODE,
          Password: this.generateSTKPassword(this.generateTimestamp()),
          Timestamp: this.generateTimestamp(),
          CheckoutRequestID: checkoutRequestId,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data;

    } catch (error) {
      console.error('STK Push status check failed:', error);
      throw new Error('STK Push status check failed');
    }
  }

  /**
   * Get payment request by ID
   */
  async getPaymentRequest(paymentRequestId: string): Promise<MpesaPaymentRequest | null> {
    try {
      // Check active requests first
      const activeRequest = this.activePaymentRequests.get(paymentRequestId);
      if (activeRequest) {
        return activeRequest;
      }

      // Query database
      return await this.getStoredPaymentRequest(paymentRequestId);

    } catch (error) {
      console.error('Failed to get payment request:', error);
      return null;
    }
  }

  /**
   * Cancel payment request
   */
  async cancelPaymentRequest(paymentRequestId: string, reason: string): Promise<void> {
    try {
      const paymentRequest = await this.getPaymentRequest(paymentRequestId);
      
      if (!paymentRequest) {
        throw new Error('Payment request not found');
      }

      if (paymentRequest.status === 'completed') {
        throw new Error('Cannot cancel completed payment');
      }

      // Update status to cancelled
      paymentRequest.status = 'cancelled';
      paymentRequest.failureReason = reason;
      paymentRequest.updatedAt = new Date().toISOString();

      await this.updateStoredPaymentRequest(paymentRequest);
      this.activePaymentRequests.set(paymentRequestId, paymentRequest);

      // Emit event
      this.emit('paymentCancelled', {
        paymentRequest,
        reason,
      });

      console.log('Payment request cancelled:', { paymentRequestId, reason });

    } catch (error) {
      console.error('Failed to cancel payment request:', error);
      throw error;
    }
  }

  /**
   * Reconcile payments for a given period
   */
  async reconcilePayments(startDate: Date, endDate: Date): Promise<PaymentReconciliationResult> {
    try {
      // Get all payment requests in the period
      const paymentRequests = await this.getPaymentRequestsInPeriod(startDate, endDate);

      // Calculate reconciliation metrics
      const totalRequests = paymentRequests.length;
      const completedPayments = paymentRequests.filter(p => p.status === 'completed').length;
      const failedPayments = paymentRequests.filter(p => p.status === 'failed').length;
      const pendingPayments = paymentRequests.filter(p => p.status === 'pending').length;
      const totalAmount = paymentRequests
        .filter(p => p.status === 'completed')
        .reduce((sum, p) => sum + p.amount, 0);

      // Check for discrepancies (mock implementation)
      const discrepancies: Array<{
        paymentRequestId: string;
        expected: number;
        actual: number;
        reason: string;
      }> = [];

      const reconciliationResult: PaymentReconciliationResult = {
        totalRequests,
        completedPayments,
        failedPayments,
        pendingPayments,
        totalAmount,
        reconciliationStatus: discrepancies.length === 0 ? 'balanced' : 'discrepancy',
        discrepancies,
        lastReconciledAt: new Date().toISOString(),
      };

      console.log('Payment reconciliation completed:', reconciliationResult);

      return reconciliationResult;

    } catch (error) {
      console.error('Payment reconciliation failed:', error);
      throw error;
    }
  }

  // Private methods

  private async initializeService(): Promise<void> {
    try {
      // Load active payment requests from database
      await this.loadActivePaymentRequests();

      // Set up event listeners
      this.setupEventListeners();

      console.log('M-Pesa Payment Request Service initialized');

    } catch (error) {
      console.error('Failed to initialize M-Pesa Payment Request Service:', error);
    }
  }

  private setupEventListeners(): void {
    // Listen for payment processing workflow events
    paymentProcessingWorkflowService.on('orderProcessed', async (data) => {
      // Check if this order should trigger M-Pesa payment request
      if (data.fulfillmentResult.fulfillmentStatus === 'fulfilled') {
        console.log('Order fulfilled, payment processing complete:', data.fulfillmentResult.orderId);
      }
    });
  }

  private startBackgroundProcessing(): void {
    // Process expired payment requests every minute
    setInterval(async () => {
      await this.processExpiredPaymentRequests();
    }, 60000);

    // Retry failed callbacks every 5 minutes
    setInterval(async () => {
      await this.retryFailedCallbacks();
    }, 5 * 60000);

    // Clean up old payment requests daily
    setInterval(async () => {
      await this.cleanupOldPaymentRequests();
    }, 24 * 60 * 60 * 1000);
  }

  private async ensureValidAccessToken(): Promise<void> {
    if (this.accessToken && new Date() < this.tokenExpiresAt) {
      return;
    }

    try {
      const auth = Buffer.from(`${this.CONSUMER_KEY}:${this.CONSUMER_SECRET}`).toString('base64');
      
      const response = await axios.get(
        `${this.MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
        {
          headers: {
            'Authorization': `Basic ${auth}`,
          },
        }
      );

      this.accessToken = response.data.access_token;
      this.tokenExpiresAt = new Date(Date.now() + (response.data.expires_in - 60) * 1000);

      console.log('M-Pesa access token refreshed');

    } catch (error) {
      console.error('Failed to get M-Pesa access token:', error);
      throw new Error('M-Pesa authentication failed');
    }
  }

  private validateSTKPushRequest(phone: string, amount: number, accountReference: string): void {
    if (!phone || !/^(\+254|254|0)[17]\d{8}$/.test(phone)) {
      throw new Error('Valid Kenyan phone number is required');
    }

    if (!amount || amount < 1 || amount > 150000) {
      throw new Error('Amount must be between KES 1 and KES 150,000');
    }

    if (!accountReference || accountReference.length > 12) {
      throw new Error('Account reference is required and must be 12 characters or less');
    }
  }

  private formatPhoneNumber(phone: string): string {
    // Convert to 254XXXXXXXXX format
    if (phone.startsWith('+254')) {
      return phone.substring(1);
    } else if (phone.startsWith('0')) {
      return '254' + phone.substring(1);
    } else if (phone.startsWith('254')) {
      return phone;
    } else {
      throw new Error('Invalid phone number format');
    }
  }

  private generatePaymentRequestId(): string {
    return `mpesa_req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  private generateTimestamp(): string {
    return new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  }

  private generateSTKPassword(timestamp: string): string {
    const concatenated = this.BUSINESS_SHORT_CODE + this.PASSKEY + timestamp;
    return Buffer.from(concatenated).toString('base64');
  }

  private async sendSTKPushRequest(request: STKPushRequest): Promise<STKPushResponse> {
    try {
      const response: AxiosResponse<STKPushResponse> = await axios.post(
        `${this.MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
        request,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data;

    } catch (error) {
      console.error('STK Push request failed:', error);
      throw new Error('STK Push request failed');
    }
  }

  private async findPaymentRequestByCheckoutId(checkoutRequestId: string): Promise<MpesaPaymentRequest | null> {
    // Search active requests
    for (const request of this.activePaymentRequests.values()) {
      if (request.checkoutRequestId === checkoutRequestId) {
        return request;
      }
    }

    // Search database
    return await this.getStoredPaymentRequestByCheckoutId(checkoutRequestId);
  }

  private async updatePaymentRequestFromCallback(
    paymentRequest: MpesaPaymentRequest,
    callbackData: STKCallbackResult
  ): Promise<MpesaPaymentRequest> {
    const updatedRequest = { ...paymentRequest };

    if (callbackData.resultCode === '0') {
      updatedRequest.status = 'completed';
      updatedRequest.completedAt = new Date().toISOString();
      
      if (callbackData.callbackMetadata) {
        updatedRequest.mpesaReceiptNumber = callbackData.callbackMetadata.mpesaReceiptNumber;
        updatedRequest.transactionDate = callbackData.callbackMetadata.transactionDate;
      }
    } else {
      updatedRequest.status = 'failed';
      updatedRequest.failureReason = callbackData.resultDesc;
    }

    updatedRequest.updatedAt = new Date().toISOString();

    await this.updateStoredPaymentRequest(updatedRequest);
    this.activePaymentRequests.set(paymentRequest.paymentRequestId, updatedRequest);

    return updatedRequest;
  }

  private async processSuccessfulPayment(
    paymentRequest: MpesaPaymentRequest,
    metadata: NonNullable<STKCallbackResult['callbackMetadata']>
  ): Promise<void> {
    try {
      console.log('Processing successful M-Pesa payment:', {
        paymentRequestId: paymentRequest.paymentRequestId,
        amount: metadata.amount,
        mpesaReceiptNumber: metadata.mpesaReceiptNumber,
      });

      // If this was linked to an HBAR payment, update that workflow
      if (paymentRequest.originalHBARPaymentId) {
        await this.linkMpesaPaymentToHBARWorkflow(paymentRequest, metadata);
      }

      // Send customer notification
      await this.sendCustomerPaymentNotification(paymentRequest, true);

      // Emit success event
      this.emit('paymentSuccessful', {
        paymentRequest,
        metadata,
      });

    } catch (error) {
      console.error('Failed to process successful payment:', error);
      throw error;
    }
  }

  private async processFailedPayment(
    paymentRequest: MpesaPaymentRequest,
    failureReason: string
  ): Promise<void> {
    try {
      console.log('Processing failed M-Pesa payment:', {
        paymentRequestId: paymentRequest.paymentRequestId,
        failureReason,
      });

      // Send customer notification
      await this.sendCustomerPaymentNotification(paymentRequest, false, failureReason);

      // Emit failure event
      this.emit('paymentFailed', {
        paymentRequest,
        failureReason,
      });

    } catch (error) {
      console.error('Failed to process failed payment:', error);
      throw error;
    }
  }

  private async validateIncomingPayment(validationData: PaymentValidationRequest): Promise<boolean> {
    // Mock validation logic - in production would check against expected payments
    return true;
  }

  private async createPreliminaryPaymentRecord(validationData: PaymentValidationRequest): Promise<void> {
    console.log('Creating preliminary payment record:', validationData);
    // Mock implementation
  }

  private async processConfirmedPayment(confirmationData: PaymentConfirmationRequest): Promise<void> {
    console.log('Processing confirmed payment:', confirmationData);
    // Mock implementation
  }

  private async linkMpesaPaymentToHBARWorkflow(
    paymentRequest: MpesaPaymentRequest,
    metadata: NonNullable<STKCallbackResult['callbackMetadata']>
  ): Promise<void> {
    console.log('Linking M-Pesa payment to HBAR workflow:', {
      mpesaPaymentId: paymentRequest.paymentRequestId,
      hbarPaymentId: paymentRequest.originalHBARPaymentId,
      amount: metadata.amount,
    });
    // Mock implementation
  }

  private async sendCustomerPaymentNotification(
    paymentRequest: MpesaPaymentRequest,
    success: boolean,
    failureReason?: string
  ): Promise<void> {
    console.log('Sending customer notification:', {
      paymentRequestId: paymentRequest.paymentRequestId,
      phoneNumber: paymentRequest.phoneNumber,
      success,
      failureReason,
    });
    // Mock implementation
  }

  private async processExpiredPaymentRequests(): Promise<void> {
    const now = new Date();
    
    for (const [requestId, request] of this.activePaymentRequests.entries()) {
      if (request.status === 'pending' && new Date(request.expirationTime) < now) {
        request.status = 'timeout';
        request.failureReason = 'Payment request expired';
        request.updatedAt = new Date().toISOString();

        await this.updateStoredPaymentRequest(request);
        this.activePaymentRequests.delete(requestId);

        this.emit('paymentExpired', { paymentRequest: request });
      }
    }
  }

  private async retryFailedCallbacks(): Promise<void> {
    // Mock implementation for callback retry logic
    console.log('Processing callback retries...');
  }

  private async cleanupOldPaymentRequests(): Promise<void> {
    // Remove payment requests older than 30 days
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    for (const [requestId, request] of this.activePaymentRequests.entries()) {
      if (new Date(request.createdAt) < cutoff) {
        this.activePaymentRequests.delete(requestId);
      }
    }
    
    console.log('Cleaned up old payment requests');
  }

  // Mock database methods
  private async loadActivePaymentRequests(): Promise<void> {
    console.log('Loading active payment requests from database...');
  }

  private async storePaymentRequest(paymentRequest: MpesaPaymentRequest): Promise<void> {
    console.log('Storing payment request:', paymentRequest.paymentRequestId);
  }

  private async getStoredPaymentRequest(paymentRequestId: string): Promise<MpesaPaymentRequest | null> {
    console.log('Getting stored payment request:', paymentRequestId);
    return null;
  }

  private async getStoredPaymentRequestByCheckoutId(checkoutRequestId: string): Promise<MpesaPaymentRequest | null> {
    console.log('Getting stored payment request by checkout ID:', checkoutRequestId);
    return null;
  }

  private async updateStoredPaymentRequest(paymentRequest: MpesaPaymentRequest): Promise<void> {
    console.log('Updating stored payment request:', paymentRequest.paymentRequestId);
  }

  private async getPaymentRequestsInPeriod(startDate: Date, endDate: Date): Promise<MpesaPaymentRequest[]> {
    console.log('Getting payment requests in period:', { startDate, endDate });
    return [];
  }
}

// Export singleton instance
export const mpesaPaymentRequestService = new MpesaPaymentRequestService();

export default mpesaPaymentRequestService;