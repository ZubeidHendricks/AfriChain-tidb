import {
  TokenCreateTransaction,
  TokenMintTransaction,
  TokenAssociateTransaction,
  TransferTransaction,
  TokenType,
  TokenSupplyType,
  Hbar,
  TransactionReceipt,
  TransactionResponse,
  AccountId,
  PrivateKey,
  TokenId,
  Status
} from '@hashgraph/sdk';
import { getHederaClientManager } from '../config/hedera';
import { getHederaFeeManager, FeeEstimation } from '../utils/hederaFees';
import { NftTokenModel, NftTransactionModel } from '../models/Nft';
import {
  NftMetadata,
  NftMintingRequest,
  BatchNftMintingRequest,
  NftMintingResult,
  BatchNftMintingResult,
  NftTokenCreationConfig,
  NftTransferRequest,
  NftAssociationRequest,
  NftOwnership,
  NftValidationResult,
  NftCostEstimation,
  HederaNftTokenInfo,
  HederaNftSerialInfo,
  NftTransactionReceipt,
  NftEvent,
  NftServiceHealth
} from '../types/nftTypes';
import crypto from 'crypto';

/**
 * Hedera NFT Service
 * Comprehensive NFT minting, management, and metadata service
 */
export class HederaNftService {
  private nftTokenModel: NftTokenModel;
  private nftTransactionModel: NftTransactionModel;
  private feeManager: ReturnType<typeof getHederaFeeManager>;
  private eventListeners: Map<string, Function[]> = new Map();

  constructor() {
    this.nftTokenModel = new NftTokenModel();
    this.nftTransactionModel = new NftTransactionModel();
    this.feeManager = getHederaFeeManager();
  }

  /**
   * Initialize NFT service and database tables
   */
  async initialize(): Promise<void> {
    try {
      console.log('🚀 Initializing Hedera NFT Service...');
      
      await this.nftTokenModel.initializeTables();
      await this.nftTransactionModel.initializeTables();
      
      console.log('✅ Hedera NFT Service initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize NFT Service:', error);
      throw error;
    }
  }

  /**
   * Create NFT token on Hedera network
   */
  async createNftToken(config: NftTokenCreationConfig): Promise<{
    tokenId: string;
    transactionId: string;
    receipt: TransactionReceipt;
  }> {
    try {
      console.log('🔨 Creating NFT token on Hedera network...');
      
      const manager = getHederaClientManager();
      const client = await manager.getClient();
      const operatorId = manager.getOperatorId();
      const operatorKey = manager.getOperatorKey();

      // Create token creation transaction
      const tokenCreateTransaction = new TokenCreateTransaction()
        .setTokenName(config.tokenName)
        .setTokenSymbol(config.tokenSymbol)
        .setTokenType(TokenType.NonFungibleUnique)
        .setSupplyType(config.supplyType === 'FINITE' ? TokenSupplyType.Finite : TokenSupplyType.Infinite)
        .setTreasuryAccountId(config.treasuryAccountId)
        .setAdminKey(operatorKey)
        .setSupplyKey(operatorKey)
        .setMaxTransactionFee(new Hbar(100))
        .setTransactionMemo(config.memo || 'AfriChain NFT Token Creation');

      // Set max supply for finite tokens
      if (config.supplyType === 'FINITE' && config.maxSupply) {
        tokenCreateTransaction.setMaxSupply(config.maxSupply);
      }

      // Set optional keys
      if (config.enableFreezing && config.freezeKey) {
        tokenCreateTransaction.setFreezeKey(PrivateKey.fromString(config.freezeKey));
      }
      if (config.enableKyc && config.kycKey) {
        tokenCreateTransaction.setKycKey(PrivateKey.fromString(config.kycKey));
      }
      if (config.wipeKey) {
        tokenCreateTransaction.setWipeKey(PrivateKey.fromString(config.wipeKey));
      }

      // Execute transaction
      const response = await tokenCreateTransaction.execute(client);
      const receipt = await response.getReceipt(client);
      
      if (receipt.status !== Status.Success) {
        throw new Error(`Token creation failed: ${receipt.status}`);
      }

      const tokenId = receipt.tokenId!.toString();
      const transactionId = response.transactionId.toString();

      console.log(`✅ NFT token created successfully: ${tokenId}`);
      
      return {
        tokenId,
        transactionId,
        receipt
      };

    } catch (error) {
      console.error('❌ Failed to create NFT token:', error);
      throw error;
    }
  }

  /**
   * Mint single NFT
   */
  async mintNft(
    userId: string,
    productId: string,
    request: NftMintingRequest,
    metadata: NftMetadata
  ): Promise<NftMintingResult> {
    try {
      console.log(`🎯 Minting NFT for product: ${productId}`);
      
      const manager = getHederaClientManager();
      const client = await manager.getClient();

      // Validate metadata
      const validation = await this.validateMetadata(metadata);
      if (!validation.isValid) {
        return {
          success: false,
          error: `Metadata validation failed: ${validation.errors.join(', ')}`
        };
      }

      // Get fee estimation
      const feeEstimation = await this.feeManager.estimateNFTMintingFee(metadata);
      
      // Create metadata hash
      const metadataString = JSON.stringify(metadata);
      const metadataHash = crypto.createHash('sha256').update(metadataString).digest('hex');
      const metadataBytes = Buffer.from(metadataString, 'utf8');

      // Create database record first (pending status)
      const nftTokenId = await this.nftTokenModel.createNftToken({
        productId,
        userId,
        tokenId: '', // Will be updated after minting
        serialNumber: 0, // Will be updated after minting
        metadataHash,
        mintingStatus: 'pending',
        mintingCostHbar: feeEstimation.totalFee.toTinybars().toNumber() / 100000000
      });

      try {
        // Get or create token (for now, assume we have a default token)
        const tokenId = process.env.HEDERA_DEFAULT_NFT_TOKEN_ID || await this.getOrCreateDefaultToken();

        // Create mint transaction
        const mintTransaction = new TokenMintTransaction()
          .setTokenId(tokenId)
          .addMetadata(metadataBytes)
          .setMaxTransactionFee(feeEstimation.totalFee.plus(new Hbar(10))) // Add buffer
          .setTransactionMemo(request.memo || `AfriChain NFT Mint - Product ${productId}`);

        // Execute mint transaction
        const response = await mintTransaction.execute(client);
        const receipt = await response.getReceipt(client);

        if (receipt.status !== Status.Success) {
          throw new Error(`NFT minting failed: ${receipt.status}`);
        }

        const serialNumbers = receipt.serials!;
        const serialNumber = serialNumbers[0]!.toNumber();
        const transactionId = response.transactionId.toString();
        const consensusTimestamp = receipt.consensusTimestamp?.toString();

        // Record transaction
        await this.nftTransactionModel.createNftTransaction({
          nftTokenId,
          transactionId,
          transactionType: 'mint',
          toAccountId: manager.getConfig().treasuryId,
          status: 'confirmed',
          transactionFeeHbar: feeEstimation.totalFee.toTinybars().toNumber() / 100000000
        });

        // Update NFT token record
        await this.nftTokenModel.updateNftTokenMintingStatus(nftTokenId, {
          mintingStatus: 'confirmed',
          mintingTransactionId: transactionId,
          tokenId,
          serialNumber,
          mintingCostHbar: feeEstimation.totalFee.toTinybars().toNumber() / 100000000
        });

        // Emit event
        this.emitEvent({
          type: 'mint_completed',
          timestamp: new Date().toISOString(),
          userId,
          productId,
          nftTokenId,
          tokenId,
          serialNumber,
          transactionId,
          metadata: metadata
        });

        const result: NftMintingResult = {
          success: true,
          nftTokenId,
          tokenId,
          serialNumber,
          transactionId,
          consensusTimestamp,
          mintingCost: feeEstimation.totalFee.toTinybars().toNumber() / 100000000,
          estimatedFee: feeEstimation.totalFee.toTinybars().toNumber() / 100000000,
          metadata
        };

        console.log(`✅ NFT minted successfully: Token ${tokenId}, Serial ${serialNumber}`);
        return result;

      } catch (mintError) {
        // Update database record to failed status
        await this.nftTokenModel.updateNftTokenMintingStatus(nftTokenId, {
          mintingStatus: 'failed'
        });

        // Record failed transaction
        await this.nftTransactionModel.createNftTransaction({
          nftTokenId,
          transactionId: 'failed',
          transactionType: 'mint',
          status: 'failed',
          errorMessage: mintError instanceof Error ? mintError.message : 'Minting failed'
        });

        // Emit failure event
        this.emitEvent({
          type: 'mint_failed',
          timestamp: new Date().toISOString(),
          userId,
          productId,
          nftTokenId,
          error: mintError instanceof Error ? mintError.message : 'Minting failed'
        });

        throw mintError;
      }

    } catch (error) {
      console.error('❌ NFT minting failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'NFT minting failed'
      };
    }
  }

  /**
   * Mint multiple NFTs in batch
   */
  async mintBatchNfts(
    userId: string,
    request: BatchNftMintingRequest,
    metadataList: NftMetadata[]
  ): Promise<BatchNftMintingResult> {
    try {
      console.log(`🔄 Starting batch NFT minting for ${request.productIds.length} products`);
      
      if (request.productIds.length !== metadataList.length) {
        return {
          success: false,
          totalRequested: request.productIds.length,
          successfulMints: 0,
          failedMints: 0,
          results: [],
          error: 'Product IDs and metadata list lengths do not match'
        };
      }

      const batchSize = request.batchSize || 10; // Process in smaller batches
      const results: NftMintingResult[] = [];
      let successfulMints = 0;
      let failedMints = 0;
      let totalCost = 0;

      // Calculate estimated costs
      const costEstimation = await this.feeManager.calculateBatchPricing(request.productIds.length);

      // Process in smaller batches to avoid timeout
      for (let i = 0; i < request.productIds.length; i += batchSize) {
        const batchProductIds = request.productIds.slice(i, i + batchSize);
        const batchMetadata = metadataList.slice(i, i + batchSize);

        console.log(`🔨 Processing batch ${Math.floor(i / batchSize) + 1} (${batchProductIds.length} items)`);

        // Process each item in the batch
        const batchPromises = batchProductIds.map(async (productId, index) => {
          const metadata = batchMetadata[index]!;
          const mintRequest: NftMintingRequest = {
            productId,
            tokenName: request.tokenName,
            tokenSymbol: request.tokenSymbol,
            memo: request.memo
          };

          return await this.mintNft(userId, productId, mintRequest, metadata);
        });

        const batchResults = await Promise.allSettled(batchPromises);

        // Process batch results
        batchResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            const mintResult = result.value;
            results.push(mintResult);
            
            if (mintResult.success) {
              successfulMints++;
              totalCost += mintResult.mintingCost || 0;
            } else {
              failedMints++;
            }
          } else {
            failedMints++;
            results.push({
              success: false,
              error: result.reason instanceof Error ? result.reason.message : 'Batch minting failed'
            });
          }
        });

        // Add delay between batches to avoid rate limiting
        if (i + batchSize < request.productIds.length) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // 2-second delay
        }
      }

      const batchResult: BatchNftMintingResult = {
        success: successfulMints > 0,
        totalRequested: request.productIds.length,
        successfulMints,
        failedMints,
        results,
        totalCost,
        estimatedCost: costEstimation.batchFee.toTinybars().toNumber() / 100000000,
        savings: costEstimation.savings.toTinybars().toNumber() / 100000000
      };

      console.log(`✅ Batch minting completed: ${successfulMints}/${request.productIds.length} successful`);
      return batchResult;

    } catch (error) {
      console.error('❌ Batch NFT minting failed:', error);
      return {
        success: false,
        totalRequested: request.productIds.length,
        successfulMints: 0,
        failedMints: request.productIds.length,
        results: [],
        error: error instanceof Error ? error.message : 'Batch minting failed'
      };
    }
  }

  /**
   * Transfer NFT to another account
   */
  async transferNft(request: NftTransferRequest): Promise<{
    success: boolean;
    transactionId?: string;
    error?: string;
  }> {
    try {
      console.log(`🔄 Transferring NFT ${request.tokenId}:${request.serialNumber}`);
      
      const manager = getHederaClientManager();
      const client = await manager.getClient();

      // Create transfer transaction
      const transferTransaction = new TransferTransaction()
        .addNftTransfer(request.tokenId, request.serialNumber, request.fromAccountId, request.toAccountId)
        .setTransactionMemo(request.memo || 'AfriChain NFT Transfer')
        .setMaxTransactionFee(new Hbar(5));

      // Execute transaction
      const response = await transferTransaction.execute(client);
      const receipt = await response.getReceipt(client);

      if (receipt.status !== Status.Success) {
        throw new Error(`NFT transfer failed: ${receipt.status}`);
      }

      const transactionId = response.transactionId.toString();

      // Find NFT token record
      const nftToken = await this.nftTokenModel.getNftTokenByTokenIdAndSerial(
        request.tokenId,
        request.serialNumber
      );

      if (nftToken) {
        // Record transfer transaction
        await this.nftTransactionModel.createNftTransaction({
          nftTokenId: nftToken.id,
          transactionId,
          transactionType: 'transfer',
          fromAccountId: request.fromAccountId,
          toAccountId: request.toAccountId,
          status: 'confirmed'
        });

        // Emit transfer event
        this.emitEvent({
          type: 'transfer_completed',
          timestamp: new Date().toISOString(),
          userId: nftToken.userId,
          productId: nftToken.productId,
          nftTokenId: nftToken.id,
          tokenId: request.tokenId,
          serialNumber: request.serialNumber,
          transactionId
        });
      }

      console.log(`✅ NFT transferred successfully: ${transactionId}`);
      return {
        success: true,
        transactionId
      };

    } catch (error) {
      console.error('❌ NFT transfer failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Transfer failed'
      };
    }
  }

  /**
   * Associate tokens with an account
   */
  async associateTokens(request: NftAssociationRequest): Promise<{
    success: boolean;
    transactionId?: string;
    error?: string;
  }> {
    try {
      console.log(`🔗 Associating ${request.tokenIds.length} tokens with account ${request.accountId}`);
      
      const manager = getHederaClientManager();
      const client = await manager.getClient();

      // Create association transaction
      const associateTransaction = new TokenAssociateTransaction()
        .setAccountId(request.accountId)
        .setTokenIds(request.tokenIds.map(id => TokenId.fromString(id)))
        .setMaxTransactionFee(new Hbar(10));

      // Execute transaction
      const response = await associateTransaction.execute(client);
      const receipt = await response.getReceipt(client);

      if (receipt.status !== Status.Success) {
        throw new Error(`Token association failed: ${receipt.status}`);
      }

      const transactionId = response.transactionId.toString();

      console.log(`✅ Tokens associated successfully: ${transactionId}`);
      return {
        success: true,
        transactionId
      };

    } catch (error) {
      console.error('❌ Token association failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Association failed'
      };
    }
  }

  /**
   * Verify NFT ownership
   */
  async verifyOwnership(tokenId: string, serialNumber: number): Promise<NftOwnership> {
    try {
      console.log(`🔍 Verifying ownership of NFT ${tokenId}:${serialNumber}`);
      
      const manager = getHederaClientManager();
      const client = await manager.getClient();

      // Get NFT info from Hedera
      const nftInfo = await client.getTokenNftInfo(tokenId, serialNumber);
      const isOwned = !!nftInfo.accountId;
      const accountId = nftInfo.accountId?.toString() || '';

      // Get local database record
      const nftToken = await this.nftTokenModel.getNftTokenByTokenIdAndSerial(tokenId, serialNumber);

      const ownership: NftOwnership = {
        tokenId,
        serialNumber,
        accountId,
        isOwned,
        lastTransferTimestamp: nftInfo.createdTimestamp?.toString(),
        acquisitionMethod: nftToken ? 'mint' : 'transfer'
      };

      return ownership;

    } catch (error) {
      console.error('❌ Ownership verification failed:', error);
      return {
        tokenId,
        serialNumber,
        accountId: '',
        isOwned: false
      };
    }
  }

  /**
   * Get NFT cost estimation
   */
  async estimateNftCost(
    operationType: 'mint' | 'transfer' | 'associate',
    metadata?: NftMetadata,
    batchSize?: number
  ): Promise<NftCostEstimation> {
    try {
      let feeEstimation: FeeEstimation;
      
      switch (operationType) {
        case 'mint':
          feeEstimation = await this.feeManager.estimateNFTMintingFee(metadata);
          break;
        case 'transfer':
          feeEstimation = await this.feeManager.estimateNFTTransferFee();
          break;
        case 'associate':
          feeEstimation = await this.feeManager.estimateTokenAssociationFee();
          break;
        default:
          throw new Error(`Unknown operation type: ${operationType}`);
      }

      const estimation: NftCostEstimation = {
        baseMintingFee: feeEstimation.baseFee.toTinybars().toNumber() / 100000000,
        metadataStorageFee: 0,
        networkFees: feeEstimation.networkFee.toTinybars().toNumber() / 100000000,
        totalEstimatedCost: feeEstimation.totalFee.toTinybars().toNumber() / 100000000,
        confidence: feeEstimation.confidence,
        factors: [
          {
            factor: 'Base operation fee',
            impact: feeEstimation.baseFee.toTinybars().toNumber() / 100000000,
            description: `Standard ${operationType} operation cost`
          },
          {
            factor: 'Network congestion',
            impact: feeEstimation.networkFee.toTinybars().toNumber() / 100000000,
            description: 'Additional fees based on network conditions'
          }
        ]
      };

      // Add batch pricing if applicable
      if (batchSize && batchSize > 1 && operationType === 'mint') {
        const batchPricing = await this.feeManager.calculateBatchPricing(batchSize);
        estimation.batchPricing = {
          singleCost: batchPricing.singleOperationFee.toTinybars().toNumber() / 100000000,
          batchCost: batchPricing.batchFee.toTinybars().toNumber() / 100000000,
          savings: batchPricing.savings.toTinybars().toNumber() / 100000000,
          recommendedBatchSize: batchPricing.recommendedBatchSize
        };
      }

      return estimation;

    } catch (error) {
      console.error('❌ Cost estimation failed:', error);
      throw error;
    }
  }

  /**
   * Validate NFT metadata
   */
  async validateMetadata(metadata: NftMetadata): Promise<NftValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required fields validation
    if (!metadata.name || metadata.name.trim().length === 0) {
      errors.push('Name is required');
    }
    if (!metadata.description || metadata.description.trim().length === 0) {
      errors.push('Description is required');
    }
    if (!metadata.image || metadata.image.trim().length === 0) {
      errors.push('Image URL is required');
    }
    if (!metadata.properties?.productId) {
      errors.push('Product ID is required in properties');
    }

    // Format validation
    const isValidFormat = true; // JSON format is implicit
    const hasRequiredFields = errors.length === 0;
    
    // Check IPFS links (simplified validation)
    const ipfsLinksValid = this.validateIpfsLinks(metadata);
    if (!ipfsLinksValid) {
      warnings.push('Some IPFS links may be invalid or unreachable');
    }

    // Check metadata size
    const totalSize = JSON.stringify(metadata).length;
    if (totalSize > 100000) { // 100KB limit
      warnings.push('Metadata is quite large, consider optimizing');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      metadata: {
        isValidFormat,
        hasRequiredFields,
        ipfsLinksValid,
        totalSize
      }
    };
  }

  /**
   * Get service health status
   */
  async getServiceHealth(): Promise<NftServiceHealth> {
    try {
      const manager = getHederaClientManager();
      const hederaHealth = await manager.getHealthStatusWithRefresh();
      
      // Check recent minting activity
      const recentTokens = await this.nftTokenModel.getRecentNftTokens(10);
      const lastSuccessfulMint = recentTokens.find(token => token.mintingStatus === 'confirmed');
      
      // Calculate error rate (simplified)
      const errorRate = recentTokens.length > 0 
        ? (recentTokens.filter(token => token.mintingStatus === 'failed').length / recentTokens.length) * 100
        : 0;

      const health: NftServiceHealth = {
        status: hederaHealth.status === 'healthy' ? 'healthy' : 'degraded',
        hederaConnection: hederaHealth.status !== 'unhealthy',
        tokenCreationCapability: hederaHealth.status === 'healthy',
        mintingCapability: hederaHealth.status === 'healthy',
        metadataStorage: true, // Assuming IPFS is working
        lastSuccessfulMint: lastSuccessfulMint?.createdAt.toISOString(),
        errorRate,
        avgMintingTime: 10, // Simplified average
        queuedOperations: 0, // No queue implementation yet
        issues: hederaHealth.error ? [hederaHealth.error] : []
      };

      return health;

    } catch (error) {
      console.error('❌ Health check failed:', error);
      return {
        status: 'unhealthy',
        hederaConnection: false,
        tokenCreationCapability: false,
        mintingCapability: false,
        metadataStorage: false,
        errorRate: 100,
        avgMintingTime: -1,
        queuedOperations: 0,
        issues: [error instanceof Error ? error.message : 'Service health check failed']
      };
    }
  }

  /**
   * Get or create default NFT token
   */
  private async getOrCreateDefaultToken(): Promise<string> {
    // For now, return a default token ID
    // In production, this would create a default AfriChain NFT token if needed
    const defaultTokenId = process.env.HEDERA_DEFAULT_NFT_TOKEN_ID;
    
    if (defaultTokenId) {
      return defaultTokenId;
    }

    // Create default token
    const defaultConfig: NftTokenCreationConfig = {
      tokenName: 'AfriChain Authenticity Certificate',
      tokenSymbol: 'AFRI-AUTH',
      treasuryAccountId: process.env.HEDERA_TREASURY_ID!,
      supplyType: 'INFINITE',
      enableFreezing: false,
      enableKyc: false,
      memo: 'AfriChain default NFT token for product authenticity certificates'
    };

    const result = await this.createNftToken(defaultConfig);
    return result.tokenId;
  }

  /**
   * Validate IPFS links in metadata
   */
  private validateIpfsLinks(metadata: NftMetadata): boolean {
    // Simplified IPFS validation - check if URLs start with valid IPFS patterns
    const ipfsPattern = /^(ipfs:\/\/|https:\/\/ipfs\.io\/ipfs\/|https:\/\/gateway\.pinata\.cloud\/ipfs\/)/;
    
    if (metadata.image && !ipfsPattern.test(metadata.image)) {
      return false;
    }

    if (metadata.properties?.media?.images) {
      for (const image of metadata.properties.media.images) {
        if (!ipfsPattern.test(image.ipfs)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Event management
   */
  addEventListener(eventType: string, callback: Function): void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, []);
    }
    this.eventListeners.get(eventType)!.push(callback);
  }

  removeEventListener(eventType: string, callback: Function): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  private emitEvent(event: NftEvent): void {
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(event);
        } catch (error) {
          console.error('❌ Event listener error:', error);
        }
      });
    }
  }

  /**
   * Get database models for direct access
   */
  getTokenModel(): NftTokenModel {
    return this.nftTokenModel;
  }

  getTransactionModel(): NftTransactionModel {
    return this.nftTransactionModel;
  }
}

// Create singleton instance
let nftService: HederaNftService | null = null;

/**
 * Get singleton NFT service instance
 */
export const getHederaNftService = (): HederaNftService => {
  if (!nftService) {
    nftService = new HederaNftService();
  }
  return nftService;
};

/**
 * Initialize NFT service
 */
export const initializeNftService = async (): Promise<HederaNftService> => {
  const service = getHederaNftService();
  await service.initialize();
  return service;
};

export default HederaNftService;