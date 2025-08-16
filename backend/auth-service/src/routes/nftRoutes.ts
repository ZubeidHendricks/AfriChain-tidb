import { Router, Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { authenticateToken } from '../middleware/auth';
import { getHederaNftService } from '../services/hederaNftService';
import { getNftMetadataValidator } from '../utils/nftMetadataValidator';
import { getIpfsMetadataStorage } from '../utils/ipfsMetadataStorage';
import { ProductModel } from '../models/Product';
import {
  NftMetadata,
  NftMintingRequest,
  BatchNftMintingRequest,
  NftTransferRequest,
  NftAssociationRequest,
  NftTokenCreationConfig
} from '../types/nftTypes';

const router = Router();

/**
 * @route   POST /api/nfts/mint-single
 * @desc    Mint single NFT for a product
 * @access  Protected
 */
router.post('/mint-single',
  authenticateToken,
  [
    body('productId').notEmpty().withMessage('Product ID is required'),
    body('metadata').isObject().withMessage('Metadata object is required'),
    body('metadata.name').notEmpty().withMessage('NFT name is required'),
    body('metadata.description').notEmpty().withMessage('NFT description is required'),
    body('metadata.image').notEmpty().withMessage('NFT image URL is required'),
    body('metadata.properties.productId').notEmpty().withMessage('Product ID in metadata is required'),
    body('tokenName').optional().isString(),
    body('tokenSymbol').optional().isString(),
    body('memo').optional().isString()
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const userId = req.user?.id;
      const { productId, metadata, tokenName, tokenSymbol, memo } = req.body;

      // Verify product exists and belongs to user
      const productModel = new ProductModel();
      const product = await productModel.getProductById(productId);
      
      if (!product) {
        return res.status(404).json({
          success: false,
          error: 'Product not found'
        });
      }

      if (product.userId !== userId) {
        return res.status(403).json({
          success: false,
          error: 'You do not have permission to mint NFT for this product'
        });
      }

      // Check if NFT already exists for this product
      const nftService = getHederaNftService();
      const tokenModel = nftService.getTokenModel();
      const existingTokens = await tokenModel.getNftTokensByProductId(productId);
      
      if (existingTokens.length > 0) {
        return res.status(409).json({
          success: false,
          error: 'NFT already exists for this product',
          existingToken: {
            id: existingTokens[0].id,
            tokenId: existingTokens[0].tokenId,
            serialNumber: existingTokens[0].serialNumber,
            status: existingTokens[0].mintingStatus
          }
        });
      }

      // Validate metadata
      const validator = getNftMetadataValidator();
      const validation = await validator.validateMetadata(metadata);
      
      if (!validation.isValid) {
        return res.status(400).json({
          success: false,
          error: 'Metadata validation failed',
          validationErrors: validation.errors,
          validationWarnings: validation.warnings
        });
      }

      // Create minting request
      const mintingRequest: NftMintingRequest = {
        productId,
        tokenName: tokenName || `${product.name} Authenticity Certificate`,
        tokenSymbol: tokenSymbol || 'AFRI-AUTH',
        memo: memo || `AfriChain NFT for ${product.name}`
      };

      // Store metadata on IPFS first
      const ipfsStorage = getIpfsMetadataStorage();
      const ipfsResult = await ipfsStorage.storeMetadata(metadata, {
        pinName: `${product.name}-NFT-Metadata`,
        retryOnFailure: true
      });

      if (!ipfsResult.success) {
        return res.status(500).json({
          success: false,
          error: 'Failed to store metadata on IPFS',
          details: ipfsResult.error
        });
      }

      // Update metadata with IPFS hash
      const enrichedMetadata: NftMetadata = {
        ...metadata,
        properties: {
          ...metadata.properties,
          ipfs: {
            hash: ipfsResult.ipfsHash,
            gateway: ipfsResult.gatewayUrl,
            storedAt: ipfsResult.uploadedAt
          }
        }
      };

      // Mint NFT
      const result = await nftService.mintNft(userId, productId, mintingRequest, enrichedMetadata);

      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: 'NFT minting failed',
          details: result.error
        });
      }

      // Update product with NFT information
      await productModel.updateProduct(productId, {
        nftTokenId: result.tokenId,
        nftSerialNumber: result.serialNumber,
        nftMintingStatus: 'confirmed',
        nftTransactionId: result.transactionId
      });

      res.status(201).json({
        success: true,
        message: 'NFT minted successfully',
        data: {
          nftTokenId: result.nftTokenId,
          tokenId: result.tokenId,
          serialNumber: result.serialNumber,
          transactionId: result.transactionId,
          consensusTimestamp: result.consensusTimestamp,
          mintingCost: result.mintingCost,
          ipfsHash: ipfsResult.ipfsHash,
          gatewayUrl: ipfsResult.gatewayUrl,
          metadata: result.metadata
        }
      });

    } catch (error) {
      console.error('❌ NFT minting endpoint error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'NFT minting failed'
      });
    }
  }
);

/**
 * @route   POST /api/nfts/mint-batch
 * @desc    Mint multiple NFTs in batch
 * @access  Protected
 */
router.post('/mint-batch',
  authenticateToken,
  [
    body('productIds').isArray().withMessage('Product IDs must be an array').isLength({ min: 1 }).withMessage('At least one product ID is required'),
    body('metadataList').isArray().withMessage('Metadata list must be an array'),
    body('batchSize').optional().isInt({ min: 1, max: 50 }).withMessage('Batch size must be between 1 and 50'),
    body('tokenName').optional().isString(),
    body('tokenSymbol').optional().isString(),
    body('memo').optional().isString()
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const userId = req.user?.id;
      const { productIds, metadataList, batchSize, tokenName, tokenSymbol, memo } = req.body;

      if (productIds.length !== metadataList.length) {
        return res.status(400).json({
          success: false,
          error: 'Product IDs and metadata list must have the same length'
        });
      }

      // Verify all products exist and belong to user
      const productModel = new ProductModel();
      const products = await Promise.all(
        productIds.map((productId: string) => productModel.getProductById(productId))
      );

      const invalidProducts = products.filter((product, index) => 
        !product || product.userId !== userId
      );

      if (invalidProducts.length > 0) {
        return res.status(403).json({
          success: false,
          error: 'Some products not found or access denied',
          invalidCount: invalidProducts.length
        });
      }

      // Check for existing NFTs
      const nftService = getHederaNftService();
      const tokenModel = nftService.getTokenModel();
      const existingChecks = await Promise.all(
        productIds.map((productId: string) => tokenModel.getNftTokensByProductId(productId))
      );

      const productsWithExistingNfts = existingChecks
        .map((tokens, index) => tokens.length > 0 ? productIds[index] : null)
        .filter(Boolean);

      if (productsWithExistingNfts.length > 0) {
        return res.status(409).json({
          success: false,
          error: 'Some products already have NFTs',
          productsWithExistingNfts
        });
      }

      // Create batch request
      const batchRequest: BatchNftMintingRequest = {
        productIds,
        batchSize: batchSize || 10,
        tokenName: tokenName || 'AfriChain Authenticity Certificate',
        tokenSymbol: tokenSymbol || 'AFRI-AUTH',
        memo: memo || 'AfriChain batch NFT minting'
      };

      // Store all metadata on IPFS first
      const ipfsStorage = getIpfsMetadataStorage();
      console.log('📁 Storing batch metadata on IPFS...');
      
      const ipfsResults = await Promise.allSettled(
        metadataList.map((metadata: NftMetadata, index: number) =>
          ipfsStorage.storeMetadata(metadata, {
            pinName: `${products[index]!.name}-NFT-Metadata-Batch`,
            retryOnFailure: true
          })
        )
      );

      // Process IPFS results
      const enrichedMetadataList: NftMetadata[] = [];
      const ipfsFailures: Array<{ index: number; error: string }> = [];

      ipfsResults.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value.success) {
          const ipfsResult = result.value;
          enrichedMetadataList.push({
            ...metadataList[index],
            properties: {
              ...metadataList[index].properties,
              ipfs: {
                hash: ipfsResult.ipfsHash,
                gateway: ipfsResult.gatewayUrl,
                storedAt: ipfsResult.uploadedAt
              }
            }
          });
        } else {
          const error = result.status === 'rejected' 
            ? result.reason 
            : (result.value as any).error;
          ipfsFailures.push({ index, error });
          enrichedMetadataList.push(metadataList[index]); // Use original metadata
        }
      });

      // Proceed with minting even if some IPFS uploads failed (with warnings)
      const result = await nftService.mintBatchNfts(userId, batchRequest, enrichedMetadataList);

      // Update products with NFT information
      if (result.results.length > 0) {
        const updatePromises = result.results.map(async (mintResult, index) => {
          if (mintResult.success) {
            return productModel.updateProduct(productIds[index], {
              nftTokenId: mintResult.tokenId,
              nftSerialNumber: mintResult.serialNumber,
              nftMintingStatus: 'confirmed',
              nftTransactionId: mintResult.transactionId
            });
          }
        });

        await Promise.allSettled(updatePromises);
      }

      res.status(201).json({
        success: result.success,
        message: `Batch minting completed: ${result.successfulMints}/${result.totalRequested} successful`,
        data: {
          totalRequested: result.totalRequested,
          successfulMints: result.successfulMints,
          failedMints: result.failedMints,
          totalCost: result.totalCost,
          estimatedCost: result.estimatedCost,
          savings: result.savings,
          results: result.results,
          ipfsFailures: ipfsFailures.length > 0 ? ipfsFailures : undefined
        }
      });

    } catch (error) {
      console.error('❌ Batch NFT minting endpoint error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Batch minting failed'
      });
    }
  }
);

/**
 * @route   POST /api/nfts/transfer
 * @desc    Transfer NFT to another account
 * @access  Protected
 */
router.post('/transfer',
  authenticateToken,
  [
    body('tokenId').notEmpty().withMessage('Token ID is required'),
    body('serialNumber').isInt({ min: 1 }).withMessage('Serial number must be a positive integer'),
    body('toAccountId').matches(/^0\.0\.\d+$/).withMessage('Invalid Hedera account ID format'),
    body('memo').optional().isString()
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const userId = req.user?.id;
      const { tokenId, serialNumber, toAccountId, memo } = req.body;

      // Verify user owns the NFT
      const nftService = getHederaNftService();
      const tokenModel = nftService.getTokenModel();
      const nftToken = await tokenModel.getNftTokenByTokenIdAndSerial(tokenId, serialNumber);

      if (!nftToken) {
        return res.status(404).json({
          success: false,
          error: 'NFT not found'
        });
      }

      if (nftToken.userId !== userId) {
        return res.status(403).json({
          success: false,
          error: 'You do not own this NFT'
        });
      }

      // Get current treasury account (from account)
      const treasuryId = process.env.HEDERA_TREASURY_ID!;

      // Create transfer request
      const transferRequest: NftTransferRequest = {
        tokenId,
        serialNumber,
        fromAccountId: treasuryId,
        toAccountId,
        memo: memo || `AfriChain NFT Transfer - ${tokenId}:${serialNumber}`
      };

      // Execute transfer
      const result = await nftService.transferNft(transferRequest);

      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: 'NFT transfer failed',
          details: result.error
        });
      }

      res.json({
        success: true,
        message: 'NFT transferred successfully',
        data: {
          tokenId,
          serialNumber,
          fromAccountId: treasuryId,
          toAccountId,
          transactionId: result.transactionId
        }
      });

    } catch (error) {
      console.error('❌ NFT transfer endpoint error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Transfer failed'
      });
    }
  }
);

/**
 * @route   POST /api/nfts/associate
 * @desc    Associate token with account
 * @access  Protected
 */
router.post('/associate',
  authenticateToken,
  [
    body('accountId').matches(/^0\.0\.\d+$/).withMessage('Invalid Hedera account ID format'),
    body('tokenIds').isArray().withMessage('Token IDs must be an array')
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { accountId, tokenIds } = req.body;

      const associationRequest: NftAssociationRequest = {
        accountId,
        tokenIds
      };

      const nftService = getHederaNftService();
      const result = await nftService.associateTokens(associationRequest);

      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: 'Token association failed',
          details: result.error
        });
      }

      res.json({
        success: true,
        message: 'Tokens associated successfully',
        data: {
          accountId,
          tokenIds,
          transactionId: result.transactionId
        }
      });

    } catch (error) {
      console.error('❌ Token association endpoint error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Association failed'
      });
    }
  }
);

/**
 * @route   GET /api/nfts/cost-estimate
 * @desc    Get cost estimation for NFT operations
 * @access  Protected
 */
router.get('/cost-estimate',
  authenticateToken,
  [
    query('operation').isIn(['mint', 'transfer', 'associate']).withMessage('Invalid operation type'),
    query('batchSize').optional().isInt({ min: 1, max: 100 }).withMessage('Batch size must be between 1 and 100')
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { operation, batchSize } = req.query;
      const operationType = operation as 'mint' | 'transfer' | 'associate';
      const batchSizeNum = batchSize ? parseInt(batchSize as string) : undefined;

      // Sample metadata for cost estimation (if minting)
      let sampleMetadata: NftMetadata | undefined;
      if (operationType === 'mint') {
        sampleMetadata = {
          name: 'Sample Product Certificate',
          description: 'Sample description for cost estimation',
          image: 'ipfs://QmSampleImageHash',
          properties: {
            productId: 'sample-product-id',
            productName: 'Sample Product',
            category: 'Electronics',
            brand: 'SampleBrand',
            manufacturer: {
              name: 'Sample Manufacturing Co.',
              address: '123 Sample Street',
              country: 'Sample Country'
            },
            registration: {
              timestamp: new Date().toISOString(),
              registrar: 'sample-user-id',
              platform: 'AfriChain'
            },
            authenticity: {
              verified: true,
              verificationMethod: 'manufacturer_certificate',
              verificationDate: new Date().toISOString()
            }
          },
          attributes: [
            { trait_type: 'Category', value: 'Electronics' },
            { trait_type: 'Verification Status', value: 'Verified' }
          ]
        };
      }

      const nftService = getHederaNftService();
      const estimation = await nftService.estimateNftCost(operationType, sampleMetadata, batchSizeNum);

      res.json({
        success: true,
        data: {
          operation: operationType,
          batchSize: batchSizeNum,
          estimation
        }
      });

    } catch (error) {
      console.error('❌ Cost estimation endpoint error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Cost estimation failed'
      });
    }
  }
);

/**
 * @route   GET /api/nfts/user/:userId
 * @desc    Get user's NFT tokens
 * @access  Protected
 */
router.get('/user/:userId',
  authenticateToken,
  [
    param('userId').notEmpty().withMessage('User ID is required'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    query('status').optional().isIn(['pending', 'confirmed', 'failed']).withMessage('Invalid status')
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { userId } = req.params;
      const currentUserId = req.user?.id;

      // Users can only view their own NFTs unless they have admin privileges
      if (userId !== currentUserId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied'
        });
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const status = req.query.status as string;

      const nftService = getHederaNftService();
      const tokenModel = nftService.getTokenModel();

      const result = await tokenModel.getNftTokensByUserId(userId, {
        page,
        limit,
        status,
        sortBy: 'created_at',
        sortOrder: 'DESC'
      });

      // Get statistics
      const statistics = await tokenModel.getNftTokenStatistics(userId);

      res.json({
        success: true,
        data: {
          tokens: result.tokens,
          pagination: {
            page: result.page,
            totalPages: result.totalPages,
            total: result.total,
            limit
          },
          statistics
        }
      });

    } catch (error) {
      console.error('❌ Get user NFTs endpoint error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Failed to fetch NFTs'
      });
    }
  }
);

/**
 * @route   GET /api/nfts/token/:tokenId/:serialNumber
 * @desc    Get NFT details and ownership
 * @access  Public
 */
router.get('/token/:tokenId/:serialNumber',
  [
    param('tokenId').matches(/^0\.0\.\d+$/).withMessage('Invalid token ID format'),
    param('serialNumber').isInt({ min: 1 }).withMessage('Serial number must be a positive integer')
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { tokenId, serialNumber } = req.params;
      const serialNum = parseInt(serialNumber);

      const nftService = getHederaNftService();
      
      // Get token from database
      const tokenModel = nftService.getTokenModel();
      const nftToken = await tokenModel.getNftTokenByTokenIdAndSerial(tokenId, serialNum);

      // Get ownership information from Hedera
      const ownership = await nftService.verifyOwnership(tokenId, serialNum);

      // Get transaction history
      let transactions = [];
      if (nftToken) {
        const transactionModel = nftService.getTransactionModel();
        transactions = await transactionModel.getNftTransactionsByTokenId(nftToken.id);
      }

      res.json({
        success: true,
        data: {
          token: nftToken,
          ownership,
          transactions
        }
      });

    } catch (error) {
      console.error('❌ Get NFT token endpoint error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Failed to fetch NFT details'
      });
    }
  }
);

/**
 * @route   GET /api/nfts/health
 * @desc    Get NFT service health status
 * @access  Protected (Admin)
 */
router.get('/health',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const nftService = getHederaNftService();
      const health = await nftService.getServiceHealth();

      res.json({
        success: true,
        data: health
      });

    } catch (error) {
      console.error('❌ NFT service health endpoint error:', error);
      res.status(500).json({
        success: false,
        error: 'Health check failed',
        message: error instanceof Error ? error.message : 'Service health check failed'
      });
    }
  }
);

/**
 * @route   POST /api/nfts/create-token
 * @desc    Create new NFT token (Admin only)
 * @access  Protected (Admin)
 */
router.post('/create-token',
  authenticateToken,
  [
    body('tokenName').notEmpty().withMessage('Token name is required'),
    body('tokenSymbol').notEmpty().withMessage('Token symbol is required'),
    body('treasuryAccountId').matches(/^0\.0\.\d+$/).withMessage('Invalid treasury account ID format'),
    body('supplyType').isIn(['FINITE', 'INFINITE']).withMessage('Supply type must be FINITE or INFINITE'),
    body('maxSupply').optional().isInt({ min: 1 }).withMessage('Max supply must be a positive integer'),
    body('memo').optional().isString()
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { tokenName, tokenSymbol, treasuryAccountId, supplyType, maxSupply, memo } = req.body;

      const tokenConfig: NftTokenCreationConfig = {
        tokenName,
        tokenSymbol,
        treasuryAccountId,
        supplyType,
        maxSupply,
        enableFreezing: false,
        enableKyc: false,
        memo: memo || `${tokenName} token creation`
      };

      const nftService = getHederaNftService();
      const result = await nftService.createNftToken(tokenConfig);

      res.status(201).json({
        success: true,
        message: 'NFT token created successfully',
        data: result
      });

    } catch (error) {
      console.error('❌ Create NFT token endpoint error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Token creation failed'
      });
    }
  }
);

export default router;