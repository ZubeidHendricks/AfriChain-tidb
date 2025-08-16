/**
 * HBAR Payment Service
 * 
 * Comprehensive Hedera Hashgraph (HBAR) payment processing service featuring:
 * - Hedera SDK integration for cryptocurrency payments
 * - Payment request generation with accurate HBAR amounts
 * - Real-time transaction monitoring and confirmation
 * - Payment account management and security
 * - Transaction validation and audit trails
 * - Exchange rate integration for dynamic pricing
 */

import {
  Client,
  AccountId,
  PrivateKey,
  TransferTransaction,
  TransactionId,
  Hbar,
  TransactionReceipt,
  TransactionRecord,
  AccountBalanceQuery,
} from '@hashgraph/sdk';
import Database from '../config/database';
import crypto from 'crypto';
import { paymentMonitoringService, MonitoringSession } from './paymentMonitoringService';

export interface PaymentRequest {
  requestId: string;
  productId: string;
  productName: string;
  priceUSD: number;
  priceHBAR: string;
  recipientAccountId: string;
  memo: string;
  paymentQRCode: string;
  expirationTime: string;
  status: 'pending' | 'paid' | 'expired' | 'failed';
  createdAt: string;
  updatedAt: string;
}

export interface PaymentTransaction {
  transactionId: string;
  paymentRequestId: string;
  transactionHash: string;
  senderAccountId?: string;
  recipientAccountId: string;
  amountHBAR: string;
  amountUSD: number;
  exchangeRate: number;
  memo: string;
  status: 'submitted' | 'pending' | 'success' | 'failed';
  consensusTimestamp?: string;
  transactionFee?: string;
  receipt?: any;
  confirmationTime?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentConfig {
  treasuryAccountId: string;
  treasuryPrivateKey: string;
  networkType: 'testnet' | 'mainnet';
  defaultTimeout: number; // seconds
  exchangeRateSource: 'coinbase' | 'binance' | 'coingecko';
  transactionMemo: string;
  minPaymentAmount: number; // USD
  maxPaymentAmount: number; // USD
}

export interface ExchangeRateData {
  hbarToUSD: number;
  source: string;
  timestamp: string;
  validUntil: string;
  confidence: number;
}

export interface PaymentMonitoringResult {
  transactionFound: boolean;
  transactionStatus: 'success' | 'failed' | 'pending';
  amountReceived: string;
  consensusTimestamp?: string;
  receipt?: TransactionReceipt;
  record?: TransactionRecord;
  monitoringSessionId?: string;
  monitoringSession?: MonitoringSession;
  validationDetails?: any;
}

export class HBARPaymentService {
  private client: Client;
  private db: Database;
  private treasuryAccountId: AccountId;
  private treasuryPrivateKey: PrivateKey;
  private config: PaymentConfig;
  private exchangeRateCache: Map<string, ExchangeRateData> = new Map();

  private readonly DEFAULT_CONFIG: PaymentConfig = {
    treasuryAccountId: process.env.HEDERA_TREASURY_ACCOUNT_ID || '0.0.123456',
    treasuryPrivateKey: process.env.HEDERA_TREASURY_PRIVATE_KEY || '',
    networkType: (process.env.HEDERA_NETWORK as 'testnet' | 'mainnet') || 'testnet',
    defaultTimeout: 300, // 5 minutes
    exchangeRateSource: 'coingecko',
    transactionMemo: 'AfriChain Product Purchase',
    minPaymentAmount: 1.0, // $1 USD minimum
    maxPaymentAmount: 10000.0, // $10,000 USD maximum
  };

  constructor(config?: Partial<PaymentConfig>) {
    this.config = { ...this.DEFAULT_CONFIG, ...config };
    this.db = Database.getInstance();
    this.initializeHederaClient();
  }

  /**
   * Initialize Hedera client connection
   */
  private initializeHederaClient(): void {
    try {
      // Configure client for testnet or mainnet
      if (this.config.networkType === 'testnet') {
        this.client = Client.forTestnet();
      } else {
        this.client = Client.forMainnet();
      }

      // Set operator account for transaction fees
      this.treasuryAccountId = AccountId.fromString(this.config.treasuryAccountId);
      this.treasuryPrivateKey = PrivateKey.fromString(this.config.treasuryPrivateKey);
      
      this.client.setOperator(this.treasuryAccountId, this.treasuryPrivateKey);

      console.log('HBAR Payment Service initialized:', {
        network: this.config.networkType,
        treasuryAccount: this.config.treasuryAccountId,
        exchangeRateSource: this.config.exchangeRateSource,
      });

    } catch (error) {
      console.error('Failed to initialize Hedera client:', error);
      throw new Error('HBAR payment service initialization failed');
    }
  }

  /**
   * Create a new payment request for a product
   */
  async createPaymentRequest(
    productId: string,
    productName: string,
    priceUSD: number,
    customerInfo?: { email?: string; accountId?: string }
  ): Promise<PaymentRequest> {
    try {
      // Validate payment amount
      if (priceUSD < this.config.minPaymentAmount || priceUSD > this.config.maxPaymentAmount) {
        throw new Error(`Payment amount must be between $${this.config.minPaymentAmount} and $${this.config.maxPaymentAmount}`);
      }

      // Get current HBAR exchange rate
      const exchangeRate = await this.getCurrentExchangeRate();
      const priceHBAR = (priceUSD / exchangeRate.hbarToUSD).toFixed(8);

      // Generate unique payment request ID
      const requestId = this.generatePaymentRequestId();

      // Create payment memo for identification
      const memo = `AfriChain:${productId}:${requestId}`;

      // Calculate expiration time (default 5 minutes)
      const expirationTime = new Date(Date.now() + this.config.defaultTimeout * 1000).toISOString();

      // Generate payment QR code data
      const paymentQRCode = await this.generatePaymentQRCode({
        recipientAccountId: this.config.treasuryAccountId,
        amount: priceHBAR,
        memo,
      });

      const paymentRequest: PaymentRequest = {
        requestId,
        productId,
        productName,
        priceUSD,
        priceHBAR,
        recipientAccountId: this.config.treasuryAccountId,
        memo,
        paymentQRCode,
        expirationTime,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Store payment request in database
      await this.storePaymentRequest(paymentRequest, exchangeRate);

      // Start payment monitoring
      try {
        const monitoringSessionId = await paymentMonitoringService.startMonitoring(paymentRequest);
        console.log('Payment monitoring started:', { requestId, monitoringSessionId });
      } catch (error) {
        console.error('Failed to start payment monitoring:', error);
        // Continue without monitoring for now
      }

      console.log('Payment request created:', {
        requestId,
        productId,
        priceUSD,
        priceHBAR,
        exchangeRate: exchangeRate.hbarToUSD,
      });

      return paymentRequest;

    } catch (error) {
      console.error('Failed to create payment request:', error);
      throw new Error('Payment request creation failed');
    }
  }

  /**
   * Monitor payment for a specific request
   */
  async monitorPaymentRequest(requestId: string): Promise<PaymentMonitoringResult> {
    try {
      // Get payment request details
      const paymentRequest = await this.getPaymentRequest(requestId);
      if (!paymentRequest) {
        throw new Error('Payment request not found');
      }

      // Check if already paid
      if (paymentRequest.status === 'paid') {
        return {
          transactionFound: true,
          transactionStatus: 'success',
          amountReceived: paymentRequest.priceHBAR,
        };
      }

      // Check for expiration
      if (new Date() > new Date(paymentRequest.expirationTime)) {
        await this.updatePaymentRequestStatus(requestId, 'expired');
        return {
          transactionFound: false,
          transactionStatus: 'failed',
          amountReceived: '0',
        };
      }

      // Get active monitoring sessions for this payment request
      const activeSessions = paymentMonitoringService.getActiveSessions();
      const monitoringSession = activeSessions.find(
        session => session.paymentRequestId === requestId
      );

      if (monitoringSession) {
        // Return monitoring session status
        return {
          transactionFound: monitoringSession.transactionFound,
          transactionStatus: monitoringSession.status === 'completed' ? 'success' : 
                           monitoringSession.status === 'timeout' ? 'failed' : 'pending',
          amountReceived: monitoringSession.transactionFound ? paymentRequest.priceHBAR : '0',
          monitoringSessionId: monitoringSession.sessionId,
          monitoringSession,
        };
      }

      // Fallback to direct transaction search if no monitoring session
      const searchStartTime = new Date(Date.now() - 30 * 60 * 1000);
      const matchingTransactions = await paymentMonitoringService.searchTransactionsByMemo(
        paymentRequest.memo,
        searchStartTime
      );

      if (matchingTransactions.length > 0) {
        const transaction = matchingTransactions[0];
        
        // Validate transaction
        const validation = paymentMonitoringService.validatePaymentTransaction(
          transaction,
          paymentRequest,
          this.config.treasuryAccountId
        );

        if (validation.isValid) {
          // Record successful payment
          const paymentTransaction = this.convertMirrorTransactionToPayment(transaction, paymentRequest);
          await this.recordPaymentTransaction(requestId, paymentTransaction);
          await this.updatePaymentRequestStatus(requestId, 'paid');

          return {
            transactionFound: true,
            transactionStatus: 'success',
            amountReceived: paymentTransaction.amountHBAR,
            consensusTimestamp: transaction.consensus_timestamp,
            validationDetails: validation.validationDetails,
          };
        }
      }

      // No matching payment found yet
      return {
        transactionFound: false,
        transactionStatus: 'pending',
        amountReceived: '0',
      };

    } catch (error) {
      console.error('Payment monitoring failed:', error);
      throw new Error('Payment monitoring failed');
    }
  }

  /**
   * Get current HBAR to USD exchange rate
   */
  async getCurrentExchangeRate(): Promise<ExchangeRateData> {
    try {
      const cacheKey = `hbar_usd_${this.config.exchangeRateSource}`;
      const cached = this.exchangeRateCache.get(cacheKey);

      // Return cached rate if still valid (5 minutes)
      if (cached && new Date() < new Date(cached.validUntil)) {
        return cached;
      }

      // Fetch fresh exchange rate
      const exchangeRate = await this.fetchExchangeRateFromSource();
      
      // Cache for 5 minutes
      const validUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const rateData: ExchangeRateData = {
        ...exchangeRate,
        validUntil,
      };

      this.exchangeRateCache.set(cacheKey, rateData);
      return rateData;

    } catch (error) {
      console.error('Failed to get exchange rate:', error);
      
      // Return fallback rate if available
      const fallback = this.exchangeRateCache.get(`hbar_usd_fallback`);
      if (fallback) {
        console.warn('Using fallback exchange rate');
        return fallback;
      }
      
      throw new Error('Exchange rate unavailable');
    }
  }

  /**
   * Get payment request by ID
   */
  async getPaymentRequest(requestId: string): Promise<PaymentRequest | null> {
    try {
      // This would query the database for the payment request
      // For now, return mock data
      return {
        requestId,
        productId: 'prod123',
        productName: 'Sample Product',
        priceUSD: 25.00,
        priceHBAR: '500.12345678',
        recipientAccountId: this.config.treasuryAccountId,
        memo: `AfriChain:prod123:${requestId}`,
        paymentQRCode: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
        expirationTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

    } catch (error) {
      console.error('Failed to get payment request:', error);
      return null;
    }
  }

  /**
   * Get payment transaction by request ID
   */
  async getPaymentTransaction(requestId: string): Promise<PaymentTransaction | null> {
    try {
      // This would query the database for the payment transaction
      // Mock implementation for now
      return null;

    } catch (error) {
      console.error('Failed to get payment transaction:', error);
      return null;
    }
  }

  /**
   * Get treasury account balance
   */
  async getTreasuryBalance(): Promise<{ hbar: string; usd: number }> {
    try {
      const balance = await new AccountBalanceQuery()
        .setAccountId(this.treasuryAccountId)
        .execute(this.client);

      const hbarBalance = balance.hbars.toString();
      const exchangeRate = await this.getCurrentExchangeRate();
      const usdBalance = parseFloat(hbarBalance) * exchangeRate.hbarToUSD;

      return {
        hbar: hbarBalance,
        usd: usdBalance,
      };

    } catch (error) {
      console.error('Failed to get treasury balance:', error);
      throw new Error('Treasury balance query failed');
    }
  }

  /**
   * Process refund for failed order
   */
  async processRefund(
    originalTransactionId: string,
    refundAmount: string,
    recipientAccountId: string,
    memo: string
  ): Promise<PaymentTransaction> {
    try {
      // Create refund transaction
      const refundTransaction = new TransferTransaction()
        .addHbarTransfer(this.treasuryAccountId, Hbar.fromString(`-${refundAmount}`))
        .addHbarTransfer(AccountId.fromString(recipientAccountId), Hbar.fromString(refundAmount))
        .setTransactionMemo(`REFUND: ${memo}`)
        .setTransactionId(TransactionId.generate(this.treasuryAccountId));

      // Sign and execute transaction
      const response = await refundTransaction.execute(this.client);
      const receipt = await response.getReceipt(this.client);

      if (receipt.status.toString() !== 'SUCCESS') {
        throw new Error(`Refund transaction failed: ${receipt.status}`);
      }

      const refundRecord: PaymentTransaction = {
        transactionId: response.transactionId.toString(),
        paymentRequestId: originalTransactionId,
        transactionHash: response.transactionId.toString(),
        recipientAccountId,
        amountHBAR: refundAmount,
        amountUSD: 0, // Calculate from exchange rate
        exchangeRate: 0,
        memo: `REFUND: ${memo}`,
        status: 'success',
        consensusTimestamp: receipt.consensusTimestamp?.toString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      console.log('Refund processed successfully:', {
        transactionId: response.transactionId.toString(),
        amount: refundAmount,
        recipient: recipientAccountId,
      });

      return refundRecord;

    } catch (error) {
      console.error('Refund processing failed:', error);
      throw new Error('Refund processing failed');
    }
  }

  // Private helper methods

  private generatePaymentRequestId(): string {
    return `pay_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  private async generatePaymentQRCode(paymentData: {
    recipientAccountId: string;
    amount: string;
    memo: string;
  }): Promise<string> {
    // Generate QR code for Hedera wallet apps
    const paymentUrl = `hedera://pay?account=${paymentData.recipientAccountId}&amount=${paymentData.amount}&memo=${encodeURIComponent(paymentData.memo)}`;
    
    // In production, would use a QR code library to generate actual QR code image
    // For now, return base64 placeholder
    return `data:image/png;base64,${Buffer.from(paymentUrl).toString('base64')}`;
  }

  private async fetchExchangeRateFromSource(): Promise<ExchangeRateData> {
    try {
      // Mock implementation - in production would call actual exchange rate APIs
      const mockRate = 0.05 + Math.random() * 0.01; // $0.05-$0.06 per HBAR

      return {
        hbarToUSD: mockRate,
        source: this.config.exchangeRateSource,
        timestamp: new Date().toISOString(),
        validUntil: '',
        confidence: 0.95,
      };

    } catch (error) {
      console.error('Exchange rate fetch failed:', error);
      throw error;
    }
  }

  private convertMirrorTransactionToPayment(
    mirrorTransaction: any,
    paymentRequest: PaymentRequest
  ): PaymentTransaction {
    const treasuryTransfer = mirrorTransaction.transfers.find(
      (transfer: any) => transfer.account === paymentRequest.recipientAccountId && transfer.amount > 0
    );

    const amountHBAR = treasuryTransfer ? (treasuryTransfer.amount / 100000000).toFixed(8) : '0';
    
    return {
      transactionId: mirrorTransaction.transaction_id,
      paymentRequestId: paymentRequest.requestId,
      transactionHash: mirrorTransaction.transaction_hash,
      senderAccountId: mirrorTransaction.transfers.find((t: any) => t.amount < 0)?.account,
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

  private async storePaymentRequest(
    paymentRequest: PaymentRequest,
    exchangeRate: ExchangeRateData
  ): Promise<void> {
    try {
      // Mock database storage - in production would insert into payments table
      console.log('Storing payment request:', {
        requestId: paymentRequest.requestId,
        productId: paymentRequest.productId,
        priceUSD: paymentRequest.priceUSD,
        priceHBAR: paymentRequest.priceHBAR,
        exchangeRate: exchangeRate.hbarToUSD,
      });

    } catch (error) {
      console.error('Failed to store payment request:', error);
      throw error;
    }
  }

  private async updatePaymentRequestStatus(
    requestId: string,
    status: PaymentRequest['status']
  ): Promise<void> {
    try {
      // Mock database update - in production would update payments table
      console.log('Updating payment request status:', { requestId, status });

    } catch (error) {
      console.error('Failed to update payment request status:', error);
      throw error;
    }
  }

  private async recordPaymentTransaction(
    requestId: string,
    transaction: PaymentTransaction
  ): Promise<void> {
    try {
      // Mock database storage - in production would insert into payment_transactions table
      console.log('Recording payment transaction:', {
        requestId,
        transactionId: transaction.transactionId,
        amount: transaction.amountHBAR,
        status: transaction.status,
      });

    } catch (error) {
      console.error('Failed to record payment transaction:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const hbarPaymentService = new HBARPaymentService();

export default hbarPaymentService;