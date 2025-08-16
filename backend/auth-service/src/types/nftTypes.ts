/**
 * NFT Types and Interfaces
 * Comprehensive type definitions for NFT operations
 */

/**
 * NFT Metadata Structure
 * Based on Hedera and OpenSea standards
 */
export interface NftMetadata {
  name: string;
  description: string;
  image: string; // IPFS URL
  external_url?: string;
  properties: {
    productId: string;
    productName: string;
    category: string;
    brand?: string;
    model?: string;
    serialNumber?: string;
    batchNumber?: string;
    manufacturer: {
      name?: string;
      address?: string;
      country?: string;
    };
    registration: {
      timestamp: string; // ISO8601
      registrar: string; // User ID
      platform: string;
    };
    authenticity: {
      verified: boolean;
      verificationMethod: string;
      verificationDate: string; // ISO8601
    };
    media: {
      images: Array<{
        type: 'primary' | 'additional' | 'certificate';
        ipfs: string;
        thumbnails: {
          small: string;
          medium: string;
          large: string;
        };
      }>;
      certificates?: string[]; // IPFS URLs
    };
  };
  attributes: Array<{
    trait_type: string;
    value: string | number;
    display_type?: 'number' | 'boost_percentage' | 'boost_number' | 'date';
    max_value?: number;
  }>;
}

/**
 * NFT Minting Request
 */
export interface NftMintingRequest {
  productId: string;
  tokenName?: string;
  tokenSymbol?: string;
  customMetadata?: Record<string, any>;
  memo?: string;
}

/**
 * Batch NFT Minting Request
 */
export interface BatchNftMintingRequest {
  productIds: string[];
  tokenName?: string;
  tokenSymbol?: string;
  batchSize?: number;
  memo?: string;
}

/**
 * NFT Minting Result
 */
export interface NftMintingResult {
  success: boolean;
  nftTokenId?: string; // Internal ID
  tokenId?: string; // Hedera token ID
  serialNumber?: number;
  transactionId?: string;
  consensusTimestamp?: string;
  metadataUri?: string;
  mintingCost?: number; // HBAR
  estimatedFee?: number; // HBAR
  error?: string;
  metadata?: NftMetadata;
}

/**
 * Batch NFT Minting Result
 */
export interface BatchNftMintingResult {
  success: boolean;
  totalRequested: number;
  successfulMints: number;
  failedMints: number;
  results: NftMintingResult[];
  totalCost?: number; // HBAR
  estimatedCost?: number; // HBAR
  savings?: number; // HBAR saved vs individual minting
  batchTransactionId?: string;
  error?: string;
}

/**
 * NFT Token Creation Configuration
 */
export interface NftTokenCreationConfig {
  tokenName: string;
  tokenSymbol: string;
  treasuryAccountId: string;
  supplyType: 'INFINITE' | 'FINITE';
  maxSupply?: number;
  enableFreezing: boolean;
  enableKyc: boolean;
  wipeKey?: string;
  freezeKey?: string;
  kycKey?: string;
  pauseKey?: string;
  feeScheduleKey?: string;
  customFees?: Array<{
    feeCollectorAccountId: string;
    hbarAmount?: number;
    tokenAmount?: number;
    denominatingTokenId?: string;
    allCollectorsAreExempt?: boolean;
  }>;
  memo?: string;
}

/**
 * NFT Transfer Request
 */
export interface NftTransferRequest {
  tokenId: string;
  serialNumber: number;
  fromAccountId: string;
  toAccountId: string;
  memo?: string;
}

/**
 * NFT Association Request
 */
export interface NftAssociationRequest {
  accountId: string;
  tokenIds: string[];
}

/**
 * NFT Ownership Verification
 */
export interface NftOwnership {
  tokenId: string;
  serialNumber: number;
  accountId: string;
  isOwned: boolean;
  metadata?: NftMetadata;
  lastTransferTimestamp?: string;
  acquisitionMethod?: 'mint' | 'transfer' | 'purchase';
}

/**
 * NFT Query Parameters
 */
export interface NftQueryParams {
  userId?: string;
  productId?: string;
  tokenId?: string;
  status?: 'pending' | 'confirmed' | 'failed';
  page?: number;
  limit?: number;
  sortBy?: 'created_at' | 'updated_at' | 'minting_cost';
  sortOrder?: 'ASC' | 'DESC';
  includeMetadata?: boolean;
  includeTransactions?: boolean;
}

/**
 * NFT Statistics
 */
export interface NftStatistics {
  totalNfts: number;
  mintedNfts: number;
  pendingNfts: number;
  failedNfts: number;
  totalMintingCost: number;
  averageMintingCost: number;
  mintingSuccessRate: number;
  recentActivity: Array<{
    type: 'mint' | 'transfer' | 'burn';
    timestamp: string;
    tokenId?: string;
    serialNumber?: number;
    cost?: number;
  }>;
}

/**
 * NFT Health Status
 */
export interface NftServiceHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  hederaConnection: boolean;
  tokenCreationCapability: boolean;
  mintingCapability: boolean;
  metadataStorage: boolean;
  lastSuccessfulMint?: string;
  errorRate: number;
  avgMintingTime: number; // seconds
  queuedOperations: number;
  issues: string[];
}

/**
 * NFT Event Types for notifications/monitoring
 */
export interface NftEvent {
  type: 'mint_started' | 'mint_completed' | 'mint_failed' | 'transfer_completed' | 'metadata_updated';
  timestamp: string;
  userId: string;
  productId?: string;
  nftTokenId?: string;
  tokenId?: string;
  serialNumber?: number;
  transactionId?: string;
  error?: string;
  metadata?: Record<string, any>;
}

/**
 * NFT Validation Result
 */
export interface NftValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  metadata?: {
    isValidFormat: boolean;
    hasRequiredFields: boolean;
    ipfsLinksValid: boolean;
    totalSize: number; // bytes
  };
}

/**
 * NFT Cost Estimation
 */
export interface NftCostEstimation {
  baseMintingFee: number; // HBAR
  metadataStorageFee: number; // HBAR
  networkFees: number; // HBAR
  totalEstimatedCost: number; // HBAR
  confidence: 'low' | 'medium' | 'high';
  factors: Array<{
    factor: string;
    impact: number; // HBAR
    description: string;
  }>;
  batchPricing?: {
    singleCost: number;
    batchCost: number;
    savings: number;
    recommendedBatchSize: number;
  };
}

/**
 * NFT Token Information (from Hedera)
 */
export interface HederaNftTokenInfo {
  tokenId: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: number;
  treasuryAccountId: string;
  adminKey?: string;
  kycKey?: string;
  freezeKey?: string;
  wipeKey?: string;
  supplyKey?: string;
  feeScheduleKey?: string;
  pauseKey?: string;
  createdTimestamp: string;
  modifiedTimestamp: string;
  memo?: string;
  tokenType: 'NON_FUNGIBLE_UNIQUE';
  supplyType: 'INFINITE' | 'FINITE';
  maxSupply?: number;
  freezeDefault: boolean;
  kycRequired: boolean;
  deleted: boolean;
  paused: boolean;
}

/**
 * NFT Serial Information (from Hedera)
 */
export interface HederaNftSerialInfo {
  tokenId: string;
  serialNumber: number;
  accountId?: string;
  createdTimestamp: string;
  modifiedTimestamp: string;
  metadata?: string; // Base64 encoded
  metadataUri?: string;
  deleted: boolean;
  spender?: string;
}

/**
 * Transaction Receipt for NFT Operations
 */
export interface NftTransactionReceipt {
  transactionId: string;
  status: 'SUCCESS' | 'FAIL' | 'UNKNOWN';
  consensusTimestamp: string;
  transactionFee: number; // HBAR
  tokenId?: string;
  serialNumbers?: number[];
  newTokenId?: string;
  exchangeRate?: {
    hbars: number;
    cents: number;
    expirationTime: string;
  };
  topicSequenceNumber?: number;
  accountId?: string;
  fileId?: string;
  contractId?: string;
  scheduleId?: string;
}

/**
 * NFT Marketplace Listing (for future use)
 */
export interface NftMarketplaceListing {
  listingId: string;
  nftTokenId: string;
  tokenId: string;
  serialNumber: number;
  sellerId: string;
  price: number; // HBAR
  currency: 'HBAR' | 'USD';
  listingType: 'fixed_price' | 'auction';
  status: 'active' | 'sold' | 'cancelled' | 'expired';
  createdAt: string;
  expiresAt?: string;
  description?: string;
  metadata?: NftMetadata;
  bids?: Array<{
    bidderId: string;
    amount: number;
    timestamp: string;
    status: 'active' | 'withdrawn' | 'accepted';
  }>;
}

/**
 * NFT Analytics Data
 */
export interface NftAnalytics {
  timeframe: '24h' | '7d' | '30d' | '90d' | 'all';
  mintingVolume: {
    count: number;
    totalCost: number; // HBAR
    averageCost: number; // HBAR
    trend: 'up' | 'down' | 'stable';
  };
  userActivity: {
    activeUsers: number;
    newUsers: number;
    returningUsers: number;
  };
  popularCategories: Array<{
    category: string;
    count: number;
    percentage: number;
  }>;
  geographicDistribution: Array<{
    country: string;
    count: number;
    percentage: number;
  }>;
  costAnalysis: {
    totalFeesPaid: number; // HBAR
    averageFeePerMint: number; // HBAR
    feeOptimizationSavings: number; // HBAR
  };
  errorAnalysis: {
    totalErrors: number;
    errorRate: number; // percentage
    commonErrors: Array<{
      error: string;
      count: number;
      impact: 'low' | 'medium' | 'high';
    }>;
  };
}

/**
 * Export all types
 */
export type {
  // Core types
  NftMetadata,
  NftMintingRequest,
  BatchNftMintingRequest,
  NftMintingResult,
  BatchNftMintingResult,
  
  // Configuration types
  NftTokenCreationConfig,
  NftTransferRequest,
  NftAssociationRequest,
  
  // Query and response types
  NftOwnership,
  NftQueryParams,
  NftStatistics,
  NftServiceHealth,
  
  // Validation and estimation types
  NftValidationResult,
  NftCostEstimation,
  
  // Hedera-specific types
  HederaNftTokenInfo,
  HederaNftSerialInfo,
  NftTransactionReceipt,
  
  // Event and analytics types
  NftEvent,
  NftMarketplaceListing,
  NftAnalytics
};