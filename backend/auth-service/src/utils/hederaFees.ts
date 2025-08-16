import { Hbar, TransactionId } from '@hashgraph/sdk';
import { getHederaClientManager } from '../config/hedera';

/**
 * Fee estimation for different operation types
 */
export interface FeeEstimation {
  operationType: string;
  baseFee: Hbar;
  networkFee: Hbar;
  totalFee: Hbar;
  estimatedTime: number; // seconds
  confidence: 'low' | 'medium' | 'high';
  lastUpdated: Date;
}

/**
 * Transaction cost breakdown
 */
export interface TransactionCost {
  transactionId: string;
  operationType: string;
  estimatedFee: Hbar;
  actualFee?: Hbar;
  savings?: Hbar;
  timestamp: Date;
  status: 'estimated' | 'completed' | 'failed';
}

/**
 * Fee management configuration
 */
export interface FeeConfig {
  maxTransactionFee: Hbar;
  feeBuffer: number; // percentage (e.g., 20 for 20% buffer)
  autoOptimization: boolean;
  trackingEnabled: boolean;
  alertThreshold: Hbar; // Alert if fees exceed this amount
}

/**
 * Batch operation pricing
 */
export interface BatchPricing {
  singleOperationFee: Hbar;
  batchSize: number;
  batchFee: Hbar;
  savings: Hbar;
  savingsPercentage: number;
  recommendedBatchSize: number;
}

/**
 * Hedera Fee Management System
 * Handles fee estimation, optimization, and cost tracking
 */
export class HederaFeeManager {
  private config: FeeConfig;
  private feeHistory: TransactionCost[] = [];
  private lastFeeUpdate: Date | null = null;

  constructor(config?: Partial<FeeConfig>) {
    this.config = {
      maxTransactionFee: new Hbar(100),
      feeBuffer: 20, // 20% buffer
      autoOptimization: true,
      trackingEnabled: true,
      alertThreshold: new Hbar(50),
      ...config
    };
  }

  /**
   * Estimate fees for NFT minting operation
   */
  async estimateNFTMintingFee(metadata?: any): Promise<FeeEstimation> {
    try {
      console.log('💰 Estimating NFT minting fees...');

      // Base fee for NFT token creation and minting
      const baseFee = new Hbar(20); // Approximate base cost
      
      // Additional fees based on metadata size
      let metadataFee = new Hbar(0);
      if (metadata) {
        const metadataSize = JSON.stringify(metadata).length;
        const metadataSizeKB = Math.ceil(metadataSize / 1024);
        metadataFee = new Hbar(metadataSizeKB * 0.1); // 0.1 HBAR per KB
      }

      // Network congestion factor (simplified)
      const networkFee = await this.getNetworkCongestionFee();
      
      // Calculate total with buffer
      const subtotal = baseFee.plus(metadataFee).plus(networkFee);
      const bufferAmount = subtotal.toTinybars().multipliedBy(this.config.feeBuffer).dividedBy(100);
      const totalFee = Hbar.fromTinybars(subtotal.toTinybars().plus(bufferAmount));

      const estimation: FeeEstimation = {
        operationType: 'nft_mint',
        baseFee,
        networkFee: metadataFee.plus(networkFee),
        totalFee,
        estimatedTime: 10, // seconds
        confidence: 'medium',
        lastUpdated: new Date()
      };

      console.log(`✅ NFT minting fee estimated: ${totalFee.toString()}`);
      return estimation;

    } catch (error) {
      console.error('❌ Fee estimation failed:', error);
      
      // Return conservative estimate on error
      return {
        operationType: 'nft_mint',
        baseFee: new Hbar(25),
        networkFee: new Hbar(5),
        totalFee: new Hbar(30),
        estimatedTime: 15,
        confidence: 'low',
        lastUpdated: new Date()
      };
    }
  }

  /**
   * Estimate fees for NFT transfer operation
   */
  async estimateNFTTransferFee(): Promise<FeeEstimation> {
    try {
      console.log('💰 Estimating NFT transfer fees...');

      const baseFee = new Hbar(1); // Base transfer cost
      const networkFee = await this.getNetworkCongestionFee();
      
      const subtotal = baseFee.plus(networkFee);
      const bufferAmount = subtotal.toTinybars().multipliedBy(this.config.feeBuffer).dividedBy(100);
      const totalFee = Hbar.fromTinybars(subtotal.toTinybars().plus(bufferAmount));

      const estimation: FeeEstimation = {
        operationType: 'nft_transfer',
        baseFee,
        networkFee,
        totalFee,
        estimatedTime: 5, // seconds
        confidence: 'high',
        lastUpdated: new Date()
      };

      console.log(`✅ NFT transfer fee estimated: ${totalFee.toString()}`);
      return estimation;

    } catch (error) {
      console.error('❌ Transfer fee estimation failed:', error);
      
      return {
        operationType: 'nft_transfer',
        baseFee: new Hbar(1.5),
        networkFee: new Hbar(0.5),
        totalFee: new Hbar(2),
        estimatedTime: 10,
        confidence: 'low',
        lastUpdated: new Date()
      };
    }
  }

  /**
   * Estimate fees for token association
   */
  async estimateTokenAssociationFee(): Promise<FeeEstimation> {
    try {
      console.log('💰 Estimating token association fees...');

      const baseFee = new Hbar(5); // Base association cost
      const networkFee = await this.getNetworkCongestionFee();
      
      const subtotal = baseFee.plus(networkFee);
      const bufferAmount = subtotal.toTinybars().multipliedBy(this.config.feeBuffer).dividedBy(100);
      const totalFee = Hbar.fromTinybars(subtotal.toTinybars().plus(bufferAmount));

      const estimation: FeeEstimation = {
        operationType: 'token_association',
        baseFee,
        networkFee,
        totalFee,
        estimatedTime: 5, // seconds
        confidence: 'high',
        lastUpdated: new Date()
      };

      console.log(`✅ Token association fee estimated: ${totalFee.toString()}`);
      return estimation;

    } catch (error) {
      console.error('❌ Association fee estimation failed:', error);
      
      return {
        operationType: 'token_association',
        baseFee: new Hbar(6),
        networkFee: new Hbar(1),
        totalFee: new Hbar(7),
        estimatedTime: 10,
        confidence: 'low',
        lastUpdated: new Date()
      };
    }
  }

  /**
   * Calculate batch minting pricing
   */
  async calculateBatchPricing(itemCount: number): Promise<BatchPricing> {
    try {
      console.log(`💰 Calculating batch pricing for ${itemCount} NFTs...`);

      const singleOperation = await this.estimateNFTMintingFee();
      const singleOperationFee = singleOperation.totalFee;

      // Batch efficiency gains (reduced per-item network overhead)
      const batchEfficiency = Math.min(0.3, itemCount * 0.02); // Up to 30% savings
      const batchMultiplier = 1 - batchEfficiency;

      const naiveTotalFee = Hbar.fromTinybars(
        singleOperationFee.toTinybars().multipliedBy(itemCount)
      );
      
      const batchFee = Hbar.fromTinybars(
        naiveTotalFee.toTinybars().multipliedBy(batchMultiplier)
      );

      const savings = naiveTotalFee.minus(batchFee);
      const savingsPercentage = (batchEfficiency * 100);

      // Recommend optimal batch size (balance between savings and risk)
      const recommendedBatchSize = Math.min(Math.max(10, Math.floor(itemCount / 3)), 50);

      const batchPricing: BatchPricing = {
        singleOperationFee,
        batchSize: itemCount,
        batchFee,
        savings,
        savingsPercentage,
        recommendedBatchSize
      };

      console.log(`✅ Batch pricing calculated: ${batchFee.toString()} (${savingsPercentage.toFixed(1)}% savings)`);
      return batchPricing;

    } catch (error) {
      console.error('❌ Batch pricing calculation failed:', error);
      throw error;
    }
  }

  /**
   * Track actual transaction costs
   */
  recordTransactionCost(cost: TransactionCost): void {
    if (!this.config.trackingEnabled) {
      return;
    }

    this.feeHistory.push(cost);

    // Keep only recent history (last 1000 transactions)
    if (this.feeHistory.length > 1000) {
      this.feeHistory = this.feeHistory.slice(-1000);
    }

    // Check for cost alerts
    if (cost.actualFee && cost.actualFee.toTinybars().isGreaterThan(this.config.alertThreshold.toTinybars())) {
      console.warn(`⚠️ High transaction fee detected: ${cost.actualFee.toString()} for ${cost.operationType}`);
    }

    console.log(`📊 Transaction cost recorded: ${cost.operationType} - ${cost.actualFee?.toString() || 'Estimated'}`);
  }

  /**
   * Get fee statistics and insights
   */
  getFeeStatistics(): {
    totalTransactions: number;
    totalCosts: Hbar;
    averageCost: Hbar;
    costByOperation: Record<string, { count: number; totalCost: Hbar; avgCost: Hbar }>;
    lastMonth: { transactions: number; totalCost: Hbar };
  } {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    const completedTransactions = this.feeHistory.filter(cost => cost.actualFee);
    const lastMonthTransactions = completedTransactions.filter(cost => cost.timestamp >= oneMonthAgo);

    const totalCosts = completedTransactions.reduce(
      (sum, cost) => sum.plus(cost.actualFee || new Hbar(0)),
      new Hbar(0)
    );

    const lastMonthCosts = lastMonthTransactions.reduce(
      (sum, cost) => sum.plus(cost.actualFee || new Hbar(0)),
      new Hbar(0)
    );

    const averageCost = completedTransactions.length > 0
      ? Hbar.fromTinybars(totalCosts.toTinybars().dividedBy(completedTransactions.length))
      : new Hbar(0);

    // Group by operation type
    const costByOperation: Record<string, { count: number; totalCost: Hbar; avgCost: Hbar }> = {};
    
    completedTransactions.forEach(cost => {
      if (!costByOperation[cost.operationType]) {
        costByOperation[cost.operationType] = {
          count: 0,
          totalCost: new Hbar(0),
          avgCost: new Hbar(0)
        };
      }
      
      const opStats = costByOperation[cost.operationType];
      opStats.count++;
      opStats.totalCost = opStats.totalCost.plus(cost.actualFee || new Hbar(0));
      opStats.avgCost = Hbar.fromTinybars(opStats.totalCost.toTinybars().dividedBy(opStats.count));
    });

    return {
      totalTransactions: completedTransactions.length,
      totalCosts,
      averageCost,
      costByOperation,
      lastMonth: {
        transactions: lastMonthTransactions.length,
        totalCost: lastMonthCosts
      }
    };
  }

  /**
   * Get network congestion fee multiplier
   */
  private async getNetworkCongestionFee(): Promise<Hbar> {
    try {
      // In a production environment, you would query actual network metrics
      // For now, we return a base congestion fee
      
      const currentHour = new Date().getHours();
      
      // Higher fees during peak hours (simplified model)
      let congestionMultiplier = 1.0;
      if (currentHour >= 9 && currentHour <= 17) {
        congestionMultiplier = 1.2; // 20% higher during business hours
      }
      
      const baseCongestionFee = new Hbar(0.5);
      return Hbar.fromTinybars(baseCongestionFee.toTinybars().multipliedBy(congestionMultiplier));
      
    } catch (error) {
      console.error('❌ Failed to get network congestion fee:', error);
      return new Hbar(1); // Conservative default
    }
  }

  /**
   * Optimize fees based on historical data
   */
  optimizeFees(): {
    recommendedBuffer: number;
    recommendedMaxFee: Hbar;
    suggestions: string[];
  } {
    if (!this.config.autoOptimization) {
      return {
        recommendedBuffer: this.config.feeBuffer,
        recommendedMaxFee: this.config.maxTransactionFee,
        suggestions: ['Auto-optimization is disabled']
      };
    }

    const stats = this.getFeeStatistics();
    const suggestions: string[] = [];
    
    let recommendedBuffer = this.config.feeBuffer;
    let recommendedMaxFee = this.config.maxTransactionFee;

    // Analyze fee accuracy
    const accuracyAnalysis = this.analyzeFeeAccuracy();
    
    if (accuracyAnalysis.overestimationRate > 50) {
      recommendedBuffer = Math.max(5, this.config.feeBuffer - 5);
      suggestions.push('Consider reducing fee buffer - fees are frequently overestimated');
    } else if (accuracyAnalysis.underestimationRate > 20) {
      recommendedBuffer = Math.min(50, this.config.feeBuffer + 10);
      suggestions.push('Consider increasing fee buffer - fees are sometimes underestimated');
    }

    // Analyze maximum fee usage
    if (stats.averageCost.toTinybars().isLessThan(this.config.maxTransactionFee.toTinybars().dividedBy(2))) {
      recommendedMaxFee = Hbar.fromTinybars(stats.averageCost.toTinybars().multipliedBy(5));
      suggestions.push('Consider lowering maximum transaction fee limit');
    }

    if (suggestions.length === 0) {
      suggestions.push('Current fee configuration appears optimal');
    }

    return {
      recommendedBuffer,
      recommendedMaxFee,
      suggestions
    };
  }

  /**
   * Analyze fee estimation accuracy
   */
  private analyzeFeeAccuracy(): {
    totalComparisons: number;
    accurateEstimations: number;
    overestimationRate: number;
    underestimationRate: number;
    averageError: number;
  } {
    const comparisons = this.feeHistory.filter(cost => 
      cost.estimatedFee && cost.actualFee && cost.status === 'completed'
    );

    if (comparisons.length === 0) {
      return {
        totalComparisons: 0,
        accurateEstimations: 0,
        overestimationRate: 0,
        underestimationRate: 0,
        averageError: 0
      };
    }

    let accurateCount = 0;
    let overestimationCount = 0;
    let underestimationCount = 0;
    let totalError = 0;

    comparisons.forEach(cost => {
      const estimated = cost.estimatedFee!.toTinybars().toNumber();
      const actual = cost.actualFee!.toTinybars().toNumber();
      const error = Math.abs(estimated - actual) / actual;
      
      totalError += error;
      
      if (error <= 0.1) { // Within 10%
        accurateCount++;
      } else if (estimated > actual) {
        overestimationCount++;
      } else {
        underestimationCount++;
      }
    });

    return {
      totalComparisons: comparisons.length,
      accurateEstimations: accurateCount,
      overestimationRate: (overestimationCount / comparisons.length) * 100,
      underestimationRate: (underestimationCount / comparisons.length) * 100,
      averageError: (totalError / comparisons.length) * 100
    };
  }

  /**
   * Get configuration
   */
  getConfig(): FeeConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<FeeConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('✅ Fee management configuration updated');
  }

  /**
   * Clear fee history
   */
  clearHistory(): void {
    this.feeHistory = [];
    console.log('✅ Fee history cleared');
  }

  /**
   * Export fee history for analysis
   */
  exportHistory(): TransactionCost[] {
    return [...this.feeHistory];
  }
}

// Create singleton instance
let feeManager: HederaFeeManager | null = null;

/**
 * Get singleton fee manager instance
 */
export const getHederaFeeManager = (config?: Partial<FeeConfig>): HederaFeeManager => {
  if (!feeManager) {
    feeManager = new HederaFeeManager(config);
  }
  return feeManager;
};

export default HederaFeeManager;