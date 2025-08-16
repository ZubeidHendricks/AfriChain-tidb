/**
 * QR Code Verification Service
 * 
 * This service handles the verification of QR codes against blockchain records
 * and product database information.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { getMirrorService, BlockchainVerificationResult } from './hederaMirrorService';
import { getProductById } from '../models/Product';
import { getNftTokenByProductId } from '../models/Nft';

export interface QRPayload {
  productId: string;
  nftTokenId?: string;
  nftSerialNumber?: number;
  timestamp: number;
  signature: string;
  version: string;
}

export interface VerificationResult {
  isValid: boolean;
  isAuthentic: boolean;
  productId: string;
  productName?: string;
  nftTokenId?: string;
  nftSerialNumber?: number;
  verificationTimestamp: string;
  blockchainConfirmed?: boolean;
  metadata?: {
    brand?: string;
    category?: string;
    manufacturer?: string;
    originCountry?: string;
    registrationDate?: string;
    verificationScore?: number;
  };
  warnings?: string[];
  errors?: string[];
  blockchainDetails?: BlockchainVerificationResult;
}

export class QRVerificationService {
  private secretKey: string;
  private maxAge: number; // Maximum age in milliseconds

  constructor(secretKey?: string, maxAge = 24 * 60 * 60 * 1000) { // 24 hours default
    this.secretKey = secretKey || process.env.QR_VERIFICATION_SECRET || 'default-secret-key';
    this.maxAge = maxAge;
  }

  /**
   * Parse and validate QR code payload
   */
  parseQRPayload(qrData: string): QRPayload | null {
    try {
      // Try to decode base64 URL-safe encoded payload
      const decoded = Buffer.from(qrData, 'base64url').toString('utf-8');
      const payload = JSON.parse(decoded) as QRPayload;

      // Validate required fields
      if (!payload.productId || !payload.timestamp || !payload.signature || !payload.version) {
        throw new Error('Missing required fields in QR payload');
      }

      return payload;
    } catch (error) {
      console.error('Failed to parse QR payload:', error);
      return null;
    }
  }

  /**
   * Verify HMAC signature of QR payload
   */
  verifySignature(payload: QRPayload): boolean {
    try {
      // Create the data string that was originally signed
      const dataToSign = `${payload.productId}:${payload.nftTokenId || ''}:${payload.nftSerialNumber || ''}:${payload.timestamp}:${payload.version}`;
      
      // Calculate expected signature
      const expectedSignature = createHmac('sha256', this.secretKey)
        .update(dataToSign)
        .digest('hex');

      // Use timing-safe comparison
      return timingSafeEqual(
        Buffer.from(payload.signature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
      );
    } catch (error) {
      console.error('Signature verification failed:', error);
      return false;
    }
  }

  /**
   * Check if QR code is within valid time window
   */
  isWithinValidTimeWindow(timestamp: number): boolean {
    const now = Date.now();
    const age = now - timestamp;
    return age >= 0 && age <= this.maxAge;
  }

  /**
   * Get product information from database
   */
  async getProductInfo(productId: string): Promise<any> {
    try {
      const product = await getProductById(productId);
      return product;
    } catch (error) {
      console.error('Failed to get product info:', error);
      return null;
    }
  }

  /**
   * Get NFT information from database
   */
  async getNFTInfo(productId: string): Promise<any> {
    try {
      const nftToken = await getNftTokenByProductId(productId);
      return nftToken;
    } catch (error) {
      console.error('Failed to get NFT info:', error);
      return null;
    }
  }

  /**
   * Verify product against blockchain records
   */
  async verifyBlockchain(
    tokenId: string,
    serialNumber: number,
    expectedOwner?: string,
    expectedMetadataHash?: string
  ): Promise<BlockchainVerificationResult> {
    try {
      const mirrorService = getMirrorService(process.env.HEDERA_NETWORK);
      return await mirrorService.verifyProductNFT(
        tokenId,
        serialNumber,
        expectedOwner,
        expectedMetadataHash
      );
    } catch (error) {
      return {
        exists: false,
        isValid: false,
        verificationTimestamp: new Date().toISOString(),
        errors: [error instanceof Error ? error.message : 'Blockchain verification failed'],
        warnings: [],
      };
    }
  }

  /**
   * Calculate verification score based on various factors
   */
  calculateVerificationScore(
    signatureValid: boolean,
    timestampValid: boolean,
    productExists: boolean,
    nftExists: boolean,
    blockchainValid: boolean
  ): number {
    let score = 0;
    
    if (signatureValid) score += 20;
    if (timestampValid) score += 10;
    if (productExists) score += 20;
    if (nftExists) score += 25;
    if (blockchainValid) score += 25;

    return score;
  }

  /**
   * Comprehensive QR code verification
   */
  async verifyQRCode(qrData: string): Promise<VerificationResult> {
    const result: VerificationResult = {
      isValid: false,
      isAuthentic: false,
      productId: '',
      verificationTimestamp: new Date().toISOString(),
      warnings: [],
      errors: [],
    };

    try {
      // Step 1: Parse QR payload
      const payload = this.parseQRPayload(qrData);
      if (!payload) {
        result.errors?.push('Invalid QR code format');
        return result;
      }

      result.productId = payload.productId;
      result.nftTokenId = payload.nftTokenId;
      result.nftSerialNumber = payload.nftSerialNumber;

      // Step 2: Verify signature
      const signatureValid = this.verifySignature(payload);
      if (!signatureValid) {
        result.errors?.push('QR code signature verification failed - possible tampering detected');
        return result;
      }

      // Step 3: Check timestamp validity
      const timestampValid = this.isWithinValidTimeWindow(payload.timestamp);
      if (!timestampValid) {
        result.warnings?.push('QR code has expired or has invalid timestamp');
      }

      // Step 4: Get product information
      const productInfo = await this.getProductInfo(payload.productId);
      if (!productInfo) {
        result.errors?.push('Product not found in database');
        return result;
      }

      result.productName = productInfo.product_name;
      result.metadata = {
        brand: productInfo.brand,
        category: productInfo.category,
        manufacturer: productInfo.manufacturer_name,
        originCountry: productInfo.origin_country,
        registrationDate: productInfo.created_at,
      };

      // Step 5: Get NFT information from database
      let nftInfo = null;
      if (payload.nftTokenId && payload.nftSerialNumber) {
        nftInfo = await this.getNFTInfo(payload.productId);
        
        if (!nftInfo) {
          result.warnings?.push('NFT not found in database');
        } else if (
          nftInfo.token_id !== payload.nftTokenId || 
          nftInfo.serial_number !== payload.nftSerialNumber
        ) {
          result.errors?.push('NFT information mismatch');
          return result;
        }
      }

      // Step 6: Blockchain verification (if NFT exists)
      let blockchainResult: BlockchainVerificationResult | null = null;
      if (payload.nftTokenId && payload.nftSerialNumber) {
        blockchainResult = await this.verifyBlockchain(
          payload.nftTokenId,
          payload.nftSerialNumber,
          nftInfo?.user_id,
          nftInfo?.metadata_hash
        );

        result.blockchainDetails = blockchainResult;
        result.blockchainConfirmed = blockchainResult.exists && blockchainResult.isValid;

        if (!blockchainResult.exists) {
          result.errors?.push('NFT not found on blockchain');
        } else if (!blockchainResult.isValid) {
          result.errors?.push('Blockchain verification failed');
          result.errors?.push(...(blockchainResult.errors || []));
        }

        if (blockchainResult.warnings) {
          result.warnings?.push(...blockchainResult.warnings);
        }
      } else {
        result.warnings?.push('No NFT information available for blockchain verification');
      }

      // Step 7: Calculate overall verification score
      const verificationScore = this.calculateVerificationScore(
        signatureValid,
        timestampValid,
        !!productInfo,
        !!nftInfo,
        blockchainResult?.isValid || false
      );

      if (result.metadata) {
        result.metadata.verificationScore = verificationScore;
      }

      // Step 8: Determine final authenticity
      result.isValid = signatureValid && !!productInfo;
      result.isAuthentic = result.isValid && 
                          verificationScore >= 75 && 
                          (result.errors?.length || 0) === 0;

      // Add final assessment messages
      if (result.isAuthentic) {
        if (verificationScore === 100) {
          result.warnings?.unshift('Product is fully verified and authentic');
        } else {
          result.warnings?.unshift(`Product appears authentic (verification score: ${verificationScore}%)`);
        }
      } else if (result.isValid) {
        result.warnings?.unshift(`Product verification incomplete (score: ${verificationScore}%)`);
      }

    } catch (error) {
      result.errors?.push(error instanceof Error ? error.message : 'Verification process failed');
    }

    return result;
  }

  /**
   * Verify QR code with caching support
   */
  async verifyQRCodeCached(qrData: string, useCache = true): Promise<VerificationResult> {
    // For now, implement without caching. Can add Redis caching later.
    return this.verifyQRCode(qrData);
  }

  /**
   * Get verification statistics
   */
  async getVerificationStats(): Promise<{
    totalVerifications: number;
    authenticCount: number;
    counterfeitCount: number;
    averageScore: number;
  }> {
    // This would typically come from a database query
    // For now, return mock data
    return {
      totalVerifications: 0,
      authenticCount: 0,
      counterfeitCount: 0,
      averageScore: 0,
    };
  }

  /**
   * Health check for the verification service
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; details: string[] }> {
    const details: string[] = [];
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    try {
      // Check Mirror Node connectivity
      const mirrorService = getMirrorService(process.env.HEDERA_NETWORK);
      const mirrorHealth = await mirrorService.getHealthStatus();
      details.push(`Mirror Node: ${mirrorHealth.status} (${mirrorHealth.details})`);
      
      if (mirrorHealth.status !== 'healthy') {
        status = mirrorHealth.status;
      }

      // Check if secret key is configured
      if (this.secretKey === 'default-secret-key') {
        details.push('Warning: Using default secret key');
        if (status === 'healthy') status = 'degraded';
      } else {
        details.push('Secret key: Configured');
      }

      // Check database connectivity (mock for now)
      details.push('Database: Connected');

    } catch (error) {
      status = 'unhealthy';
      details.push(`Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return { status, details };
  }
}

// Export default instance
export const qrVerificationService = new QRVerificationService();

export default qrVerificationService;