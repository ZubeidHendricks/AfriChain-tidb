import {
  Client,
  TransactionId,
  TransactionReceiptQuery,
  TransactionRecordQuery,
  AccountBalanceQuery,
  TokenInfoQuery,
  TokenNftInfoQuery,
  Status
} from '@hashgraph/sdk';
import { getHederaClientManager } from '../config/hedera';
import { NftTokenModel, NftTransactionModel } from '../models/Nft';
import { EventEmitter } from 'events';

/**
 * Monitoring Configuration
 */
export interface NftMonitoringConfig {
  pollInterval: number; // milliseconds between monitoring cycles
  maxRetries: number; // max retries for failed operations
  retryDelay: number; // delay between retries in milliseconds
  batchSize: number; // number of transactions to process per batch
  enableAutoRecovery: boolean; // auto-retry failed transactions
  monitoringEnabled: boolean; // enable/disable monitoring
  healthCheckInterval: number; // health check frequency in milliseconds
}

/**
 * Transaction Status Update
 */
export interface TransactionStatusUpdate {
  transactionId: string;
  nftTokenId: string;
  previousStatus: 'pending' | 'confirmed' | 'failed';
  newStatus: 'pending' | 'confirmed' | 'failed';
  consensusTimestamp?: Date;
  transactionFee?: number;
  errorMessage?: string;
  retryAttempt?: number;
}

/**
 * Blockchain Sync Status
 */
export interface BlockchainSyncStatus {
  lastSyncTimestamp: Date;
  pendingTransactions: number;
  confirmedTransactions: number;
  failedTransactions: number;
  syncHealth: 'healthy' | 'degraded' | 'unhealthy';
  averageConfirmationTime: number; // in milliseconds
  errorRate: number; // percentage of failed transactions
  uptime: number; // service uptime in milliseconds
}

/**
 * NFT Monitoring Service
 * Handles blockchain transaction monitoring and metadata synchronization
 */
export class NftMonitoringService extends EventEmitter {
  private config: NftMonitoringConfig;
  private nftTokenModel: NftTokenModel;
  private nftTransactionModel: NftTransactionModel;
  private isRunning: boolean = false;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private startTime: Date = new Date();
  private syncStatus: BlockchainSyncStatus;
  private retryQueue: Map<string, number> = new Map(); // transactionId -> retry count

  constructor(config: Partial<NftMonitoringConfig> = {}) {
    super();

    this.config = {
      pollInterval: parseInt(process.env.NFT_MONITOR_POLL_INTERVAL || '30000'), // 30 seconds
      maxRetries: parseInt(process.env.NFT_MONITOR_MAX_RETRIES || '5'),
      retryDelay: parseInt(process.env.NFT_MONITOR_RETRY_DELAY || '60000'), // 1 minute
      batchSize: parseInt(process.env.NFT_MONITOR_BATCH_SIZE || '20'),
      enableAutoRecovery: process.env.NFT_MONITOR_AUTO_RECOVERY !== 'false',
      monitoringEnabled: process.env.NFT_MONITOR_ENABLED !== 'false',
      healthCheckInterval: parseInt(process.env.NFT_MONITOR_HEALTH_INTERVAL || '300000'), // 5 minutes
      ...config
    };

    this.nftTokenModel = new NftTokenModel();
    this.nftTransactionModel = new NftTransactionModel();

    this.syncStatus = {
      lastSyncTimestamp: new Date(),
      pendingTransactions: 0,
      confirmedTransactions: 0,
      failedTransactions: 0,
      syncHealth: 'healthy',
      averageConfirmationTime: 0,
      errorRate: 0,
      uptime: 0
    };

    console.log('🔍 NFT Monitoring Service initialized');
  }

  /**
   * Start monitoring service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('⚠️ NFT monitoring service is already running');
      return;
    }

    if (!this.config.monitoringEnabled) {
      console.log('📴 NFT monitoring service is disabled');
      return;
    }

    try {
      console.log('🚀 Starting NFT monitoring service...');
      
      this.isRunning = true;
      this.startTime = new Date();

      // Start monitoring cycle
      this.monitoringInterval = setInterval(
        () => this.runMonitoringCycle(),
        this.config.pollInterval
      );

      // Start health check cycle
      this.healthCheckInterval = setInterval(
        () => this.runHealthCheck(),
        this.config.healthCheckInterval
      );

      // Run initial monitoring cycle
      await this.runMonitoringCycle();
      
      // Run initial health check
      await this.runHealthCheck();

      this.emit('service_started', {
        timestamp: new Date(),
        config: this.config
      });

      console.log('✅ NFT monitoring service started successfully');

    } catch (error) {
      console.error('❌ Failed to start NFT monitoring service:', error);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Stop monitoring service
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      console.warn('⚠️ NFT monitoring service is not running');
      return;
    }

    console.log('🛑 Stopping NFT monitoring service...');

    this.isRunning = false;

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    this.emit('service_stopped', {
      timestamp: new Date(),
      uptime: Date.now() - this.startTime.getTime()
    });

    console.log('✅ NFT monitoring service stopped');
  }

  /**
   * Run monitoring cycle
   */
  private async runMonitoringCycle(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      console.log('🔄 Running NFT monitoring cycle...');

      // Monitor pending transactions
      await this.monitorPendingTransactions();

      // Process retry queue
      if (this.config.enableAutoRecovery) {
        await this.processRetryQueue();
      }

      // Sync NFT metadata with blockchain
      await this.syncNftMetadata();

      // Update sync status
      await this.updateSyncStatus();

      console.log('✅ NFT monitoring cycle completed');

    } catch (error) {
      console.error('❌ NFT monitoring cycle failed:', error);
      
      this.syncStatus.syncHealth = 'degraded';
      this.emit('monitoring_error', {
        timestamp: new Date(),
        error: error instanceof Error ? error.message : 'Monitoring cycle failed'
      });
    }
  }

  /**
   * Monitor pending transactions
   */
  private async monitorPendingTransactions(): Promise<void> {
    try {
      const manager = getHederaClientManager();
      const client = await manager.getClient();

      // Get pending transactions from database
      const pendingTransactions = await this.getPendingTransactions();

      if (pendingTransactions.length === 0) {
        console.log('📭 No pending transactions to monitor');
        return;
      }

      console.log(`🔍 Monitoring ${pendingTransactions.length} pending transactions`);

      // Process transactions in batches
      const batches = this.chunkArray(pendingTransactions, this.config.batchSize);

      for (const batch of batches) {
        const batchPromises = batch.map(transaction => 
          this.checkTransactionStatus(client, transaction)
        );

        const results = await Promise.allSettled(batchPromises);
        
        // Process results
        results.forEach((result, index) => {
          const transaction = batch[index]!;
          
          if (result.status === 'rejected') {
            console.warn(`⚠️ Failed to check transaction ${transaction.transactionId}:`, result.reason);
            this.addToRetryQueue(transaction.transactionId);
          }
        });

        // Add delay between batches to avoid rate limiting
        if (batches.length > 1) {
          await this.sleep(1000);
        }
      }

    } catch (error) {
      console.error('❌ Failed to monitor pending transactions:', error);
      throw error;
    }
  }

  /**
   * Check individual transaction status
   */
  private async checkTransactionStatus(
    client: Client, 
    transaction: any
  ): Promise<void> {
    try {
      const transactionId = TransactionId.fromString(transaction.transactionId);
      
      // Get transaction receipt
      const receiptQuery = new TransactionReceiptQuery()
        .setTransactionId(transactionId);

      const receipt = await receiptQuery.execute(client);

      // Update transaction status based on receipt
      const update: TransactionStatusUpdate = {
        transactionId: transaction.transactionId,
        nftTokenId: transaction.nftTokenId,
        previousStatus: transaction.status,
        newStatus: receipt.status === Status.Success ? 'confirmed' : 'failed',
        consensusTimestamp: receipt.consensusTimestamp ? new Date(receipt.consensusTimestamp.toString()) : undefined
      };

      // Get transaction record for more details if confirmed
      if (receipt.status === Status.Success) {
        try {
          const recordQuery = new TransactionRecordQuery()
            .setTransactionId(transactionId);

          const record = await recordQuery.execute(client);
          
          update.transactionFee = record.transactionFee.toTinybars().toNumber() / 100000000;

          // For mint transactions, get serial numbers
          if (transaction.transactionType === 'mint' && record.receipt.serials) {
            const serialNumbers = record.receipt.serials.map(s => s.toNumber());
            
            // Update NFT token with serial number if not set
            const nftToken = await this.nftTokenModel.getNftTokenById(transaction.nftTokenId);
            if (nftToken && nftToken.serialNumber === 0 && serialNumbers.length > 0) {
              await this.nftTokenModel.updateNftTokenMintingStatus(transaction.nftTokenId, {
                serialNumber: serialNumbers[0]!,
                mintingStatus: 'confirmed'
              });
            }
          }

        } catch (recordError) {
          console.warn(`⚠️ Failed to get transaction record for ${transaction.transactionId}:`, recordError);
        }
      } else {
        update.errorMessage = `Transaction failed with status: ${receipt.status}`;
      }

      // Update database
      await this.updateTransactionStatus(update);

      console.log(`✅ Transaction ${transaction.transactionId} status updated: ${update.previousStatus} -> ${update.newStatus}`);

    } catch (error) {
      console.error(`❌ Failed to check transaction status for ${transaction.transactionId}:`, error);
      
      // If transaction not found, it might still be processing
      if (error.toString().includes('RECEIPT_NOT_FOUND')) {
        console.log(`⏳ Transaction ${transaction.transactionId} still processing`);
        return;
      }

      throw error;
    }
  }

  /**
   * Sync NFT metadata with blockchain
   */
  private async syncNftMetadata(): Promise<void> {
    try {
      console.log('🔄 Syncing NFT metadata with blockchain...');

      const manager = getHederaClientManager();
      const client = await manager.getClient();

      // Get confirmed NFTs that need metadata sync
      const nftsToSync = await this.getNftsForSync();

      for (const nft of nftsToSync) {
        try {
          // Query NFT info from Hedera
          const nftInfoQuery = new TokenNftInfoQuery()
            .setTokenId(nft.tokenId)
            .setNftId(nft.serialNumber);

          const nftInfo = await nftInfoQuery.execute(client);

          // Check if metadata is consistent
          const blockchainMetadata = nftInfo.metadata;
          const localMetadataHash = nft.metadataHash;

          if (blockchainMetadata) {
            const blockchainMetadataHash = this.generateMetadataHash(blockchainMetadata);
            
            if (blockchainMetadataHash !== localMetadataHash) {
              console.log(`🔄 Metadata mismatch detected for NFT ${nft.tokenId}:${nft.serialNumber}`);
              
              // Emit metadata sync event
              this.emit('metadata_mismatch', {
                nftTokenId: nft.id,
                tokenId: nft.tokenId,
                serialNumber: nft.serialNumber,
                localHash: localMetadataHash,
                blockchainHash: blockchainMetadataHash,
                timestamp: new Date()
              });
            }
          }

          // Update ownership information
          const currentOwner = nftInfo.accountId?.toString();
          if (currentOwner && currentOwner !== nft.userId) {
            console.log(`🔄 Ownership change detected for NFT ${nft.tokenId}:${nft.serialNumber}`);
            
            this.emit('ownership_change', {
              nftTokenId: nft.id,
              tokenId: nft.tokenId,
              serialNumber: nft.serialNumber,
              previousOwner: nft.userId,
              newOwner: currentOwner,
              timestamp: new Date()
            });
          }

        } catch (error) {
          console.warn(`⚠️ Failed to sync metadata for NFT ${nft.tokenId}:${nft.serialNumber}:`, error);
        }

        // Add delay between queries to avoid rate limiting
        await this.sleep(500);
      }

      console.log(`✅ NFT metadata sync completed for ${nftsToSync.length} NFTs`);

    } catch (error) {
      console.error('❌ NFT metadata sync failed:', error);
      throw error;
    }
  }

  /**
   * Process retry queue for failed operations
   */
  private async processRetryQueue(): Promise<void> {
    if (this.retryQueue.size === 0) {
      return;
    }

    console.log(`🔄 Processing retry queue (${this.retryQueue.size} items)...`);

    const retryEntries = Array.from(this.retryQueue.entries());
    
    for (const [transactionId, retryCount] of retryEntries) {
      if (retryCount >= this.config.maxRetries) {
        console.log(`❌ Transaction ${transactionId} exceeded max retries (${this.config.maxRetries})`);
        
        // Mark as permanently failed
        await this.markTransactionAsFailed(transactionId, 'Exceeded maximum retry attempts');
        this.retryQueue.delete(transactionId);
        
        this.emit('transaction_failed_permanently', {
          transactionId,
          retryCount,
          timestamp: new Date()
        });
        
        continue;
      }

      try {
        // Retry checking transaction status
        const manager = getHederaClientManager();
        const client = await manager.getClient();
        
        const transaction = await this.getTransactionById(transactionId);
        if (transaction) {
          await this.checkTransactionStatus(client, transaction);
          
          // If successful, remove from retry queue
          this.retryQueue.delete(transactionId);
          
          console.log(`✅ Successfully retried transaction ${transactionId}`);
        }

      } catch (error) {
        console.warn(`⚠️ Retry failed for transaction ${transactionId}:`, error);
        
        // Increment retry count
        this.retryQueue.set(transactionId, retryCount + 1);
      }

      // Add delay between retries
      await this.sleep(this.config.retryDelay / this.retryQueue.size);
    }
  }

  /**
   * Run health check
   */
  private async runHealthCheck(): Promise<void> {
    try {
      console.log('🏥 Running NFT monitoring health check...');

      const manager = getHederaClientManager();
      const healthStatus = await manager.getHealthStatusWithRefresh();

      // Update sync status based on health
      if (healthStatus.status === 'unhealthy') {
        this.syncStatus.syncHealth = 'unhealthy';
      } else if (healthStatus.status === 'degraded') {
        this.syncStatus.syncHealth = 'degraded';
      } else {
        this.syncStatus.syncHealth = 'healthy';
      }

      this.emit('health_check_completed', {
        timestamp: new Date(),
        hederaHealth: healthStatus,
        syncStatus: this.syncStatus
      });

      console.log(`✅ Health check completed - Status: ${this.syncStatus.syncHealth}`);

    } catch (error) {
      console.error('❌ Health check failed:', error);
      this.syncStatus.syncHealth = 'unhealthy';
      
      this.emit('health_check_failed', {
        timestamp: new Date(),
        error: error instanceof Error ? error.message : 'Health check failed'
      });
    }
  }

  /**
   * Update sync status metrics
   */
  private async updateSyncStatus(): Promise<void> {
    try {
      const now = new Date();
      
      // Get transaction statistics
      const stats = await this.getTransactionStatistics();
      
      this.syncStatus = {
        lastSyncTimestamp: now,
        pendingTransactions: stats.pending,
        confirmedTransactions: stats.confirmed,
        failedTransactions: stats.failed,
        syncHealth: this.syncStatus.syncHealth, // Keep current health status
        averageConfirmationTime: stats.avgConfirmationTime,
        errorRate: stats.total > 0 ? (stats.failed / stats.total) * 100 : 0,
        uptime: now.getTime() - this.startTime.getTime()
      };

    } catch (error) {
      console.error('❌ Failed to update sync status:', error);
    }
  }

  /**
   * Helper methods
   */
  private async getPendingTransactions(): Promise<any[]> {
    // Implementation would query the database for pending transactions
    // For now, return empty array as placeholder
    return [];
  }

  private async getNftsForSync(): Promise<any[]> {
    // Implementation would query the database for NFTs needing sync
    // For now, return empty array as placeholder
    return [];
  }

  private async getTransactionById(transactionId: string): Promise<any | null> {
    try {
      return await this.nftTransactionModel.getNftTransactionByTransactionId(transactionId);
    } catch (error) {
      console.error(`❌ Failed to get transaction ${transactionId}:`, error);
      return null;
    }
  }

  private async updateTransactionStatus(update: TransactionStatusUpdate): Promise<void> {
    try {
      // Find transaction record
      const transaction = await this.nftTransactionModel.getNftTransactionByTransactionId(update.transactionId);
      if (!transaction) {
        console.warn(`⚠️ Transaction not found: ${update.transactionId}`);
        return;
      }

      // Update transaction status
      await this.nftTransactionModel.updateNftTransactionStatus(transaction.id, {
        status: update.newStatus,
        consensusTimestamp: update.consensusTimestamp,
        transactionFeeHbar: update.transactionFee,
        errorMessage: update.errorMessage
      });

      // Update NFT token status if needed
      if (update.newStatus === 'confirmed' || update.newStatus === 'failed') {
        await this.nftTokenModel.updateNftTokenMintingStatus(update.nftTokenId, {
          mintingStatus: update.newStatus
        });
      }

      // Emit status update event
      this.emit('transaction_status_updated', update);

    } catch (error) {
      console.error('❌ Failed to update transaction status:', error);
      throw error;
    }
  }

  private async markTransactionAsFailed(transactionId: string, errorMessage: string): Promise<void> {
    try {
      const transaction = await this.nftTransactionModel.getNftTransactionByTransactionId(transactionId);
      if (transaction) {
        await this.nftTransactionModel.updateNftTransactionStatus(transaction.id, {
          status: 'failed',
          errorMessage
        });
      }
    } catch (error) {
      console.error(`❌ Failed to mark transaction as failed: ${transactionId}`, error);
    }
  }

  private async getTransactionStatistics(): Promise<{
    total: number;
    pending: number;
    confirmed: number;
    failed: number;
    avgConfirmationTime: number;
  }> {
    // Placeholder implementation
    return {
      total: 0,
      pending: 0,
      confirmed: 0,
      failed: 0,
      avgConfirmationTime: 0
    };
  }

  private addToRetryQueue(transactionId: string): void {
    const currentRetries = this.retryQueue.get(transactionId) || 0;
    this.retryQueue.set(transactionId, currentRetries + 1);
  }

  private generateMetadataHash(metadata: Uint8Array): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(metadata).digest('hex');
  }

  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Public interface methods
   */
  
  /**
   * Get current sync status
   */
  getSyncStatus(): BlockchainSyncStatus {
    return { ...this.syncStatus };
  }

  /**
   * Get monitoring configuration
   */
  getConfig(): NftMonitoringConfig {
    return { ...this.config };
  }

  /**
   * Update monitoring configuration
   */
  updateConfig(newConfig: Partial<NftMonitoringConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('✅ NFT monitoring configuration updated');
  }

  /**
   * Force sync for specific NFT
   */
  async forceSyncNft(tokenId: string, serialNumber: number): Promise<void> {
    try {
      console.log(`🔄 Force syncing NFT ${tokenId}:${serialNumber}...`);

      const manager = getHederaClientManager();
      const client = await manager.getClient();

      const nftInfoQuery = new TokenNftInfoQuery()
        .setTokenId(tokenId)
        .setNftId(serialNumber);

      const nftInfo = await nftInfoQuery.execute(client);

      this.emit('nft_sync_completed', {
        tokenId,
        serialNumber,
        nftInfo,
        timestamp: new Date()
      });

      console.log(`✅ NFT ${tokenId}:${serialNumber} sync completed`);

    } catch (error) {
      console.error(`❌ Failed to force sync NFT ${tokenId}:${serialNumber}:`, error);
      throw error;
    }
  }

  /**
   * Check if service is running
   */
  isServiceRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get service uptime
   */
  getUptime(): number {
    return Date.now() - this.startTime.getTime();
  }

  /**
   * Get retry queue status
   */
  getRetryQueueStatus(): { transactionId: string; retryCount: number }[] {
    return Array.from(this.retryQueue.entries()).map(([transactionId, retryCount]) => ({
      transactionId,
      retryCount
    }));
  }
}

// Create singleton instance
let monitoringService: NftMonitoringService | null = null;

/**
 * Get singleton monitoring service instance
 */
export const getNftMonitoringService = (config?: Partial<NftMonitoringConfig>): NftMonitoringService => {
  if (!monitoringService) {
    monitoringService = new NftMonitoringService(config);
  }
  return monitoringService;
};

/**
 * Initialize and start monitoring service
 */
export const initializeNftMonitoring = async (config?: Partial<NftMonitoringConfig>): Promise<NftMonitoringService> => {
  const service = getNftMonitoringService(config);
  await service.start();
  return service;
};

export default NftMonitoringService;