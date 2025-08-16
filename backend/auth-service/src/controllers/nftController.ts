import { Request, Response } from 'express';
import { getHederaNftService } from '../services/hederaNftService';
import { getNftMetadataValidator } from '../utils/nftMetadataValidator';
import { getIpfsMetadataStorage } from '../utils/ipfsMetadataStorage';
import { ProductModel } from '../models/Product';
import {
  NftMetadata,
  NftMintingRequest,
  BatchNftMintingRequest,
  NftValidationResult
} from '../types/nftTypes';

/**
 * NFT Controller
 * Business logic for NFT operations
 */
export class NftController {
  private nftService = getHederaNftService();
  private productModel = new ProductModel();
  private validator = getNftMetadataValidator();
  private ipfsStorage = getIpfsMetadataStorage();

  /**
   * Generate NFT metadata from product data
   */
  async generateMetadataFromProduct(productId: string): Promise<{
    success: boolean;
    metadata?: NftMetadata;
    error?: string;
  }> {
    try {
      const product = await this.productModel.getProductById(productId);
      
      if (!product) {
        return {
          success: false,
          error: 'Product not found'
        };
      }

      // Get product images from IPFS
      const images = product.imageHashes || [];
      const primaryImage = images[0] || 'ipfs://QmDefaultProductImage';

      const metadata: NftMetadata = {
        name: `${product.name} Authenticity Certificate`,
        description: `This NFT certifies the authenticity of ${product.name}, a ${product.category} product manufactured by ${product.manufacturer}. This certificate serves as immutable proof of origin and authenticity on the blockchain.`,
        image: primaryImage,
        external_url: `https://africhain.io/product/${productId}`,
        properties: {
          productId: product.id,
          productName: product.name,
          category: product.category,
          brand: product.brand || 'Unknown',
          model: product.model || 'N/A',
          serialNumber: product.serialNumber,
          manufacturer: {
            name: product.manufacturer,
            address: product.manufacturerAddress || 'Not specified',
            country: product.manufacturerCountry || 'Not specified',
            contact: product.manufacturerContact || ''
          },
          registration: {
            timestamp: product.createdAt.toISOString(),
            registrar: product.userId,
            platform: 'AfriChain',
            location: product.registrationLocation || 'Unknown'
          },
          authenticity: {
            verified: product.verificationStatus === 'verified',
            verificationMethod: product.verificationMethod || 'platform_verification',
            verificationDate: product.verifiedAt ? product.verifiedAt.toISOString() : new Date().toISOString(),
            verificationLevel: product.verificationLevel || 'standard'
          },
          specifications: {
            dimensions: product.dimensions,
            weight: product.weight,
            color: product.color,
            material: product.material,
            warranty: product.warrantyPeriod
          },
          media: {
            images: images.map((hash, index) => ({
              type: index === 0 ? 'primary' : 'additional',
              ipfs: hash,
              description: index === 0 ? 'Main product image' : `Additional view ${index}`,
              thumbnails: {
                small: `${hash}?size=150`,
                medium: `${hash}?size=300`,
                large: `${hash}?size=600`
              }
            })),
            certificates: product.certificateHashes || [],
            documents: product.documentHashes || []
          },
          supply_chain: {
            origin: product.origin || 'Unknown',
            distributors: product.distributors ? product.distributors.split(',') : [],
            retailers: product.retailers ? product.retailers.split(',') : [],
            currentLocation: product.currentLocation || 'Unknown'
          }
        },
        attributes: [
          {
            trait_type: 'Category',
            value: product.category
          },
          {
            trait_type: 'Manufacturer',
            value: product.manufacturer
          },
          {
            trait_type: 'Brand',
            value: product.brand || 'Unknown'
          },
          {
            trait_type: 'Verification Status',
            value: product.verificationStatus === 'verified' ? 'Verified' : 'Pending',
            display_type: 'string'
          },
          {
            trait_type: 'Registration Date',
            value: product.createdAt.toISOString(),
            display_type: 'date'
          },
          {
            trait_type: 'Authenticity Score',
            value: product.authenticityScore || 85,
            display_type: 'boost_percentage'
          }
        ]
      };

      // Add optional attributes
      if (product.price) {
        metadata.attributes.push({
          trait_type: 'Original Price',
          value: product.price,
          display_type: 'number'
        });
      }

      if (product.warrantyPeriod) {
        metadata.attributes.push({
          trait_type: 'Warranty Period (months)',
          value: parseInt(product.warrantyPeriod),
          display_type: 'number'
        });
      }

      if (product.productionDate) {
        metadata.attributes.push({
          trait_type: 'Production Date',
          value: product.productionDate.toISOString(),
          display_type: 'date'
        });
      }

      return {
        success: true,
        metadata
      };

    } catch (error) {
      console.error('❌ Failed to generate metadata from product:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Metadata generation failed'
      };
    }
  }

  /**
   * Validate product for NFT minting
   */
  async validateProductForMinting(productId: string, userId: string): Promise<{
    success: boolean;
    product?: any;
    issues?: string[];
    error?: string;
  }> {
    try {
      const product = await this.productModel.getProductById(productId);

      if (!product) {
        return {
          success: false,
          error: 'Product not found'
        };
      }

      if (product.userId !== userId) {
        return {
          success: false,
          error: 'You do not have permission to mint NFT for this product'
        };
      }

      const issues: string[] = [];

      // Check required fields
      if (!product.name || product.name.trim().length === 0) {
        issues.push('Product name is required');
      }

      if (!product.category) {
        issues.push('Product category is required');
      }

      if (!product.manufacturer) {
        issues.push('Product manufacturer is required');
      }

      // Check for existing NFT
      const tokenModel = this.nftService.getTokenModel();
      const existingTokens = await tokenModel.getNftTokensByProductId(productId);
      
      if (existingTokens.length > 0) {
        issues.push('Product already has an NFT minted');
      }

      // Check images
      if (!product.imageHashes || product.imageHashes.length === 0) {
        issues.push('At least one product image is required');
      }

      // Warnings (don't block minting but should be noted)
      const warnings: string[] = [];

      if (product.verificationStatus !== 'verified') {
        warnings.push('Product is not yet verified - consider verifying before minting');
      }

      if (!product.serialNumber) {
        warnings.push('Product serial number not provided');
      }

      if (!product.manufacturerAddress) {
        warnings.push('Manufacturer address not provided');
      }

      if (warnings.length > 0) {
        issues.push(...warnings.map(w => `Warning: ${w}`));
      }

      return {
        success: issues.filter(i => !i.startsWith('Warning:')).length === 0,
        product,
        issues: issues.length > 0 ? issues : undefined
      };

    } catch (error) {
      console.error('❌ Failed to validate product for minting:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Product validation failed'
      };
    }
  }

  /**
   * Create complete NFT package from product
   */
  async createNftFromProduct(productId: string, userId: string, options: {
    tokenName?: string;
    tokenSymbol?: string;
    memo?: string;
    storeOnIpfs?: boolean;
  } = {}): Promise<{
    success: boolean;
    data?: any;
    error?: string;
    warnings?: string[];
  }> {
    try {
      // Validate product
      const productValidation = await this.validateProductForMinting(productId, userId);
      
      if (!productValidation.success) {
        return {
          success: false,
          error: productValidation.error,
          warnings: productValidation.issues
        };
      }

      const product = productValidation.product!;

      // Generate metadata
      const metadataResult = await this.generateMetadataFromProduct(productId);
      
      if (!metadataResult.success) {
        return {
          success: false,
          error: metadataResult.error
        };
      }

      const metadata = metadataResult.metadata!;

      // Validate metadata
      const validation = await this.validator.validateMetadata(metadata);
      
      if (!validation.isValid) {
        return {
          success: false,
          error: 'Generated metadata validation failed',
          warnings: validation.errors
        };
      }

      let ipfsResult = null;
      let enrichedMetadata = metadata;

      // Store on IPFS if requested
      if (options.storeOnIpfs !== false) {
        ipfsResult = await this.ipfsStorage.storeMetadata(metadata, {
          pinName: `${product.name}-NFT-Metadata`,
          retryOnFailure: true
        });

        if (ipfsResult.success) {
          enrichedMetadata = {
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
        }
      }

      // Create minting request
      const mintingRequest: NftMintingRequest = {
        productId,
        tokenName: options.tokenName || `${product.name} Authenticity Certificate`,
        tokenSymbol: options.tokenSymbol || 'AFRI-AUTH',
        memo: options.memo || `AfriChain NFT for ${product.name}`
      };

      // Mint NFT
      const mintResult = await this.nftService.mintNft(userId, productId, mintingRequest, enrichedMetadata);

      if (!mintResult.success) {
        return {
          success: false,
          error: mintResult.error
        };
      }

      // Update product with NFT information
      await this.productModel.updateProduct(productId, {
        nftTokenId: mintResult.tokenId,
        nftSerialNumber: mintResult.serialNumber,
        nftMintingStatus: 'confirmed',
        nftTransactionId: mintResult.transactionId
      });

      return {
        success: true,
        data: {
          nft: {
            nftTokenId: mintResult.nftTokenId,
            tokenId: mintResult.tokenId,
            serialNumber: mintResult.serialNumber,
            transactionId: mintResult.transactionId,
            consensusTimestamp: mintResult.consensusTimestamp,
            mintingCost: mintResult.mintingCost
          },
          ipfs: ipfsResult ? {
            hash: ipfsResult.ipfsHash,
            gateway: ipfsResult.gatewayUrl,
            success: ipfsResult.success
          } : null,
          metadata: enrichedMetadata,
          validation: {
            isValid: validation.isValid,
            warnings: validation.warnings
          }
        },
        warnings: validation.warnings.length > 0 ? validation.warnings : undefined
      };

    } catch (error) {
      console.error('❌ Failed to create NFT from product:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'NFT creation failed'
      };
    }
  }

  /**
   * Get comprehensive NFT information
   */
  async getNftInfo(tokenId: string, serialNumber: number): Promise<{
    success: boolean;
    data?: any;
    error?: string;
  }> {
    try {
      // Get token from database
      const tokenModel = this.nftService.getTokenModel();
      const nftToken = await tokenModel.getNftTokenByTokenIdAndSerial(tokenId, serialNumber);

      if (!nftToken) {
        return {
          success: false,
          error: 'NFT not found in database'
        };
      }

      // Get product information
      const product = await this.productModel.getProductById(nftToken.productId);

      // Get ownership from blockchain
      const ownership = await this.nftService.verifyOwnership(tokenId, serialNumber);

      // Get transaction history
      const transactionModel = this.nftService.getTransactionModel();
      const transactions = await transactionModel.getNftTransactionsByTokenId(nftToken.id);

      // Try to retrieve metadata from IPFS if available
      let retrievedMetadata = null;
      if (nftToken.metadataUri) {
        const ipfsHash = nftToken.metadataUri.replace(/^ipfs:\/\//, '');
        const metadataResult = await this.ipfsStorage.retrieveMetadata(ipfsHash, {
          validateHash: nftToken.metadataHash
        });

        if (metadataResult.success) {
          retrievedMetadata = metadataResult.metadata;
        }
      }

      return {
        success: true,
        data: {
          nft: nftToken,
          product,
          ownership,
          transactions,
          metadata: retrievedMetadata,
          verification: {
            metadataHashMatches: retrievedMetadata ? 
              this.validator.generateMetadataHash(retrievedMetadata) === nftToken.metadataHash : 
              null,
            onChainOwnership: ownership.isOwned,
            transactionHistory: transactions.length
          }
        }
      };

    } catch (error) {
      console.error('❌ Failed to get NFT info:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to retrieve NFT information'
      };
    }
  }

  /**
   * Get user's NFT portfolio
   */
  async getUserNftPortfolio(userId: string): Promise<{
    success: boolean;
    data?: any;
    error?: string;
  }> {
    try {
      const tokenModel = this.nftService.getTokenModel();

      // Get user's tokens with pagination
      const tokensResult = await tokenModel.getNftTokensByUserId(userId, {
        page: 1,
        limit: 100,
        sortBy: 'created_at',
        sortOrder: 'DESC'
      });

      // Get statistics
      const statistics = await tokenModel.getNftTokenStatistics(userId);

      // Get product information for each NFT
      const enrichedTokens = await Promise.all(
        tokensResult.tokens.map(async (token) => {
          const product = await this.productModel.getProductById(token.productId);
          return {
            ...token,
            product: product ? {
              id: product.id,
              name: product.name,
              category: product.category,
              manufacturer: product.manufacturer,
              imageUrl: product.imageHashes?.[0] || null
            } : null
          };
        })
      );

      // Categorize by status
      const byStatus = {
        confirmed: enrichedTokens.filter(t => t.mintingStatus === 'confirmed'),
        pending: enrichedTokens.filter(t => t.mintingStatus === 'pending'),
        failed: enrichedTokens.filter(t => t.mintingStatus === 'failed')
      };

      // Categorize by product type
      const byCategory = enrichedTokens.reduce((acc, token) => {
        if (token.product?.category) {
          if (!acc[token.product.category]) {
            acc[token.product.category] = [];
          }
          acc[token.product.category].push(token);
        }
        return acc;
      }, {} as Record<string, any[]>);

      return {
        success: true,
        data: {
          tokens: enrichedTokens,
          statistics,
          categorization: {
            byStatus,
            byCategory
          },
          pagination: {
            page: tokensResult.page,
            totalPages: tokensResult.totalPages,
            total: tokensResult.total
          }
        }
      };

    } catch (error) {
      console.error('❌ Failed to get user NFT portfolio:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to retrieve NFT portfolio'
      };
    }
  }

  /**
   * Verify NFT authenticity
   */
  async verifyNftAuthenticity(tokenId: string, serialNumber: number): Promise<{
    success: boolean;
    data?: any;
    error?: string;
  }> {
    try {
      // Get comprehensive NFT info
      const nftInfo = await this.getNftInfo(tokenId, serialNumber);
      
      if (!nftInfo.success) {
        return nftInfo;
      }

      const { nft, product, ownership, metadata } = nftInfo.data;

      // Perform authenticity checks
      const checks = {
        nftExists: !!nft,
        productExists: !!product,
        onChainOwnership: ownership.isOwned,
        metadataIntegrity: metadata ? 
          this.validator.generateMetadataHash(metadata) === nft.metadataHash : 
          false,
        mintingConfirmed: nft.mintingStatus === 'confirmed',
        validTokenFormat: /^0\.0\.\d+$/.test(tokenId),
        validSerialNumber: serialNumber > 0
      };

      // Calculate authenticity score
      const totalChecks = Object.keys(checks).length;
      const passedChecks = Object.values(checks).filter(Boolean).length;
      const authenticityScore = (passedChecks / totalChecks) * 100;

      // Determine authenticity level
      let authenticityLevel: 'authentic' | 'questionable' | 'invalid';
      if (authenticityScore >= 90) {
        authenticityLevel = 'authentic';
      } else if (authenticityScore >= 70) {
        authenticityLevel = 'questionable';
      } else {
        authenticityLevel = 'invalid';
      }

      return {
        success: true,
        data: {
          tokenId,
          serialNumber,
          authenticityScore,
          authenticityLevel,
          checks,
          nft: nft ? {
            id: nft.id,
            productId: nft.productId,
            mintingStatus: nft.mintingStatus,
            createdAt: nft.createdAt
          } : null,
          product: product ? {
            id: product.id,
            name: product.name,
            manufacturer: product.manufacturer,
            verificationStatus: product.verificationStatus
          } : null,
          ownership,
          recommendations: this.generateAuthenticityRecommendations(checks, authenticityLevel)
        }
      };

    } catch (error) {
      console.error('❌ Failed to verify NFT authenticity:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Authenticity verification failed'
      };
    }
  }

  /**
   * Generate recommendations based on authenticity checks
   */
  private generateAuthenticityRecommendations(checks: Record<string, boolean>, level: string): string[] {
    const recommendations: string[] = [];

    if (!checks.nftExists) {
      recommendations.push('This NFT is not registered in the AfriChain database');
    }

    if (!checks.productExists) {
      recommendations.push('The associated product is not found in our system');
    }

    if (!checks.onChainOwnership) {
      recommendations.push('NFT ownership could not be verified on the blockchain');
    }

    if (!checks.metadataIntegrity) {
      recommendations.push('Metadata integrity check failed - data may have been tampered with');
    }

    if (!checks.mintingConfirmed) {
      recommendations.push('NFT minting is not confirmed on the blockchain');
    }

    if (level === 'authentic') {
      recommendations.push('This NFT passes all authenticity checks and appears to be genuine');
    } else if (level === 'questionable') {
      recommendations.push('Some authenticity checks failed - verify with the manufacturer or seller');
    } else {
      recommendations.push('This NFT has significant authenticity concerns - exercise extreme caution');
    }

    return recommendations;
  }
}

export default NftController;