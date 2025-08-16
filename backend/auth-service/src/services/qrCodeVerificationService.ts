import { createHash } from 'crypto';
import { NftTokenModel } from '../models/Nft';
import { ProductModel } from '../models/Product';
import { QrCodeModel } from '../models/QrCode';
import { getHederaNftService } from './hederaNftService';
import { getQrCodeService } from './qrCodeService';
import { 
  QrCodeDataPayload, 
  QrCodeValidationResult,
  QrCodeScanData,
  QrCodeType
} from '../types/qrTypes';

/**
 * Verification Configuration
 */
export interface VerificationConfig {
  enableBlockchainVerification: boolean;
  enableProductVerification: boolean;
  enableNftVerification: boolean;
  enableSecurityChecks: boolean;
  verificationTimeout: number; // milliseconds
  cacheVerificationResults: boolean;
  allowExpiredQrCodes: boolean;
  strictModeEnabled: boolean;
}

/**
 * Verification Context
 */
export interface VerificationContext {
  scanId: string;
  timestamp: Date;
  ipAddress?: string;
  userAgent?: string;
  deviceType?: 'mobile' | 'tablet' | 'desktop' | 'unknown';
  platform?: string;
  browser?: string;
  location?: {
    country?: string;
    region?: string;
    city?: string;
    latitude?: number;
    longitude?: number;
    timezone?: string;
  };
  referrer?: string;
  campaignSource?: string;
  scanMethod: 'camera' | 'upload' | 'api';
  appVersion?: string;
}

/**
 * Verification Result
 */
export interface VerificationResult {
  isValid: boolean;
  isAuthentic: boolean;
  scanId: string;
  qrCodeId?: string;
  trackingId?: string;
  data?: QrCodeDataPayload;
  verificationTime: number; // milliseconds
  timestamp: Date;
  errors: string[];
  warnings: string[];
  metadata: {
    format?: string;
    version?: string;
    errorCorrectionLevel?: string;
    dataSize: number;
  };
  security: {
    hashValid?: boolean;
    signatureValid?: boolean;
    notExpired: boolean;
    notTampered: boolean;
    riskLevel: 'low' | 'medium' | 'high';
  };
  product?: {
    id: string;
    name: string;
    brand: string;
    category: string;
    manufacturer: string;
    isActive: boolean;
    verificationStatus: 'verified' | 'pending' | 'rejected';
  };
  nft?: {
    tokenId: string;
    serialNumber: number;
    owner: string;
    mintingStatus: 'confirmed' | 'pending' | 'failed';
    blockchainVerified: boolean;
  };
  blockchain?: {
    networkVerified: boolean;
    consensusTimestamp?: Date;
    transactionId?: string;
    blockHeight?: number;
  };
  analytics: {
    isFirstScan: boolean;
    totalScans: number;
    uniqueScans: number;
    lastScannedAt?: Date;
    scanLocation?: string;
  };
  recommendations?: string[];
}

/**
 * QR Code Verification Service
 * Handles QR code scanning, validation, and authenticity verification
 */
export class QrCodeVerificationService {
  private config: VerificationConfig;
  private nftTokenModel: NftTokenModel;
  private productModel: ProductModel;
  private qrCodeModel: QrCodeModel;
  private verificationCache: Map<string, VerificationResult> = new Map();

  constructor(config: Partial<VerificationConfig> = {}) {
    this.config = {
      enableBlockchainVerification: process.env.QR_BLOCKCHAIN_VERIFICATION !== 'false',
      enableProductVerification: process.env.QR_PRODUCT_VERIFICATION !== 'false',
      enableNftVerification: process.env.QR_NFT_VERIFICATION !== 'false',
      enableSecurityChecks: process.env.QR_SECURITY_CHECKS !== 'false',
      verificationTimeout: parseInt(process.env.QR_VERIFICATION_TIMEOUT || '10000'),
      cacheVerificationResults: process.env.QR_CACHE_VERIFICATION !== 'false',
      allowExpiredQrCodes: process.env.QR_ALLOW_EXPIRED === 'true',
      strictModeEnabled: process.env.QR_STRICT_MODE === 'true',
      ...config
    };

    this.nftTokenModel = new NftTokenModel();
    this.productModel = new ProductModel();
    this.qrCodeModel = new QrCodeModel();

    console.log('🔍 QR Code Verification Service initialized');
  }

  /**
   * Verify QR code from string data
   */
  async verifyQrCode(
    qrData: string,
    context: VerificationContext
  ): Promise<VerificationResult> {
    const startTime = Date.now();
    const scanId = context.scanId;

    try {
      console.log(`🔍 Starting QR code verification for scan: ${scanId}`);

      // Initialize result object
      const result: VerificationResult = {
        isValid: false,
        isAuthentic: false,
        scanId,
        verificationTime: 0,
        timestamp: new Date(),
        errors: [],
        warnings: [],
        metadata: {
          dataSize: qrData.length
        },
        security: {
          notExpired: false,
          notTampered: false,
          riskLevel: 'medium'
        },
        analytics: {
          isFirstScan: true,
          totalScans: 0,
          uniqueScans: 0
        }
      };

      // Step 1: Parse and validate QR code data
      const parseResult = await this.parseQrCodeData(qrData);
      if (!parseResult.isValid) {
        result.errors.push(...parseResult.errors);
        result.verificationTime = Date.now() - startTime;
        return result;
      }

      result.data = parseResult.data!;
      result.qrCodeId = parseResult.data!.metadata?.productId || parseResult.data!.productId;
      result.trackingId = parseResult.data!.trackingId;
      result.metadata = { ...result.metadata, ...parseResult.metadata };

      // Step 2: Security validation
      if (this.config.enableSecurityChecks) {
        const securityResult = await this.performSecurityChecks(parseResult.data!, qrData);
        result.security = { ...result.security, ...securityResult };
        
        if (!securityResult.notTampered || (!securityResult.notExpired && !this.config.allowExpiredQrCodes)) {
          result.errors.push('Security validation failed');
          result.security.riskLevel = 'high';
          result.verificationTime = Date.now() - startTime;
          return result;
        }
      }

      // Step 3: Database verification
      const dbVerification = await this.verifyWithDatabase(parseResult.data!);
      if (dbVerification.qrCodeRecord) {
        result.qrCodeId = dbVerification.qrCodeRecord.qrCodeId;
        result.trackingId = dbVerification.qrCodeRecord.trackingId;
      }

      // Step 4: Product verification
      if (this.config.enableProductVerification && parseResult.data!.productId) {
        const productResult = await this.verifyProduct(parseResult.data!.productId);
        result.product = productResult;
        
        if (!productResult?.isActive) {
          result.warnings.push('Product is not active');
        }
      }

      // Step 5: NFT verification
      if (this.config.enableNftVerification && parseResult.data!.nftTokenId) {
        const nftResult = await this.verifyNft(
          parseResult.data!.nftTokenId,
          parseResult.data!.nftSerialNumber
        );
        result.nft = nftResult;
      }

      // Step 6: Blockchain verification
      if (this.config.enableBlockchainVerification && result.nft) {
        const blockchainResult = await this.verifyOnBlockchain(
          result.nft.tokenId,
          result.nft.serialNumber
        );
        result.blockchain = blockchainResult;
        result.nft.blockchainVerified = blockchainResult.networkVerified;
      }

      // Step 7: Analytics and tracking
      const analyticsResult = await this.updateAnalytics(result.qrCodeId!, context);
      result.analytics = analyticsResult;

      // Step 8: Final validation
      result.isValid = result.errors.length === 0;
      result.isAuthentic = this.calculateAuthenticity(result);
      result.security.riskLevel = this.calculateRiskLevel(result);
      result.recommendations = this.generateRecommendations(result);

      // Record scan in database
      await this.recordScan(result, context);

      result.verificationTime = Date.now() - startTime;

      // Cache result if enabled
      if (this.config.cacheVerificationResults && result.isValid) {
        this.verificationCache.set(result.qrCodeId!, result);
      }

      console.log(`✅ QR code verification completed for scan: ${scanId} (${result.verificationTime}ms)`);
      return result;

    } catch (error) {
      console.error(`❌ QR code verification failed for scan: ${scanId}:`, error);
      
      const result: VerificationResult = {
        isValid: false,
        isAuthentic: false,
        scanId,
        verificationTime: Date.now() - startTime,
        timestamp: new Date(),
        errors: [error instanceof Error ? error.message : 'Verification failed'],
        warnings: [],
        metadata: { dataSize: qrData.length },
        security: {
          notExpired: false,
          notTampered: false,
          riskLevel: 'high'
        },
        analytics: {
          isFirstScan: true,
          totalScans: 0,
          uniqueScans: 0
        }
      };

      return result;
    }
  }

  /**
   * Parse QR code data
   */
  private async parseQrCodeData(qrData: string): Promise<{
    isValid: boolean;
    data?: QrCodeDataPayload;
    errors: string[];
    metadata: any;
  }> {
    try {
      // Try to parse as JSON
      const parsed = JSON.parse(qrData);

      // Basic structure validation
      if (!parsed.type || !parsed.verificationUrl) {
        return {
          isValid: false,
          errors: ['Invalid QR code format: missing required fields'],
          metadata: {}
        };
      }

      // Validate QR code type
      const validTypes: QrCodeType[] = [
        'product_verification',
        'nft_verification',
        'authenticity_check',
        'product_info',
        'batch_verification',
        'marketing_campaign',
        'certificate_download',
        'custom'
      ];

      if (!validTypes.includes(parsed.type)) {
        return {
          isValid: false,
          errors: ['Invalid QR code type'],
          metadata: {}
        };
      }

      // Convert to QrCodeDataPayload format
      const data: QrCodeDataPayload = {
        type: parsed.type,
        version: parsed.version || '1.0',
        productId: parsed.productId,
        nftTokenId: parsed.nftTokenId,
        nftSerialNumber: parsed.nftSerialNumber,
        batchId: parsed.batchId,
        verificationUrl: parsed.verificationUrl,
        fallbackUrl: parsed.fallbackUrl,
        trackingId: parsed.trackingId || parsed.id,
        expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : undefined,
        metadata: parsed.metadata,
        security: parsed.security || {
          hash: this.generateDataHash(qrData),
          encryptionLevel: 'none'
        },
        analytics: parsed.analytics || {
          trackScans: true,
          trackLocation: false,
          trackDevice: true
        },
        additionalData: parsed.additionalData
      };

      return {
        isValid: true,
        data,
        errors: [],
        metadata: {
          version: parsed.version || '1.0',
          format: 'json',
          errorCorrectionLevel: parsed.errorCorrectionLevel
        }
      };

    } catch (error) {
      return {
        isValid: false,
        errors: ['Invalid QR code format: not valid JSON'],
        metadata: {}
      };
    }
  }

  /**
   * Perform security checks
   */
  private async performSecurityChecks(
    data: QrCodeDataPayload,
    originalData: string
  ): Promise<{
    hashValid?: boolean;
    signatureValid?: boolean;
    notExpired: boolean;
    notTampered: boolean;
    riskLevel: 'low' | 'medium' | 'high';
  }> {
    const checks = {
      hashValid: true,
      signatureValid: true,
      notExpired: true,
      notTampered: true,
      riskLevel: 'low' as const
    };

    // Check expiration
    if (data.expiresAt) {
      checks.notExpired = new Date() <= data.expiresAt;
    }

    // Verify hash if present
    if (data.security?.hash) {
      const calculatedHash = this.generateDataHash(originalData);
      checks.hashValid = calculatedHash === data.security.hash;
      checks.notTampered = checks.hashValid;
    }

    // Verify signature if present
    if (data.security?.signature) {
      // In a real implementation, this would verify the cryptographic signature
      checks.signatureValid = true; // Placeholder
    }

    // Calculate risk level
    if (!checks.notExpired || !checks.notTampered) {
      checks.riskLevel = 'high';
    } else if (!checks.hashValid || !checks.signatureValid) {
      checks.riskLevel = 'medium';
    }

    return checks;
  }

  /**
   * Verify with database
   */
  private async verifyWithDatabase(data: QrCodeDataPayload): Promise<{
    qrCodeRecord?: any;
    isRegistered: boolean;
  }> {
    try {
      // Try to find QR code record by tracking ID or product ID
      let qrCodeRecord = null;
      
      if (data.trackingId) {
        qrCodeRecord = await this.qrCodeModel.getQrCodeByQrId(data.trackingId);
      }

      return {
        qrCodeRecord,
        isRegistered: !!qrCodeRecord
      };

    } catch (error) {
      console.warn('⚠️ Database verification failed:', error);
      return {
        isRegistered: false
      };
    }
  }

  /**
   * Verify product
   */
  private async verifyProduct(productId: string): Promise<{
    id: string;
    name: string;
    brand: string;
    category: string;
    manufacturer: string;
    isActive: boolean;
    verificationStatus: 'verified' | 'pending' | 'rejected';
  } | null> {
    try {
      const product = await this.productModel.getProductById(productId);
      
      if (!product) {
        return null;
      }

      return {
        id: product.id,
        name: product.name,
        brand: product.brand,
        category: product.category,
        manufacturer: product.manufacturer,
        isActive: product.isActive !== false,
        verificationStatus: product.verificationStatus || 'pending'
      };

    } catch (error) {
      console.warn(`⚠️ Product verification failed for ${productId}:`, error);
      return null;
    }
  }

  /**
   * Verify NFT
   */
  private async verifyNft(
    nftTokenId: string,
    serialNumber?: number
  ): Promise<{
    tokenId: string;
    serialNumber: number;
    owner: string;
    mintingStatus: 'confirmed' | 'pending' | 'failed';
    blockchainVerified: boolean;
  } | null> {
    try {
      let nftToken = null;
      
      if (serialNumber) {
        nftToken = await this.nftTokenModel.getNftTokenByTokenIdAndSerial(nftTokenId, serialNumber);
      } else {
        const tokens = await this.nftTokenModel.getNftTokensByTokenId(nftTokenId);
        nftToken = tokens[0] || null;
      }

      if (!nftToken) {
        return null;
      }

      return {
        tokenId: nftToken.tokenId,
        serialNumber: nftToken.serialNumber,
        owner: nftToken.userId,
        mintingStatus: nftToken.mintingStatus || 'pending',
        blockchainVerified: false // Will be updated by blockchain verification
      };

    } catch (error) {
      console.warn(`⚠️ NFT verification failed for ${nftTokenId}:${serialNumber}:`, error);
      return null;
    }
  }

  /**
   * Verify on blockchain
   */
  private async verifyOnBlockchain(
    tokenId: string,
    serialNumber: number
  ): Promise<{
    networkVerified: boolean;
    consensusTimestamp?: Date;
    transactionId?: string;
    blockHeight?: number;
  }> {
    try {
      const nftService = getHederaNftService();
      const ownership = await nftService.verifyOwnership(tokenId, serialNumber);

      return {
        networkVerified: ownership.exists,
        consensusTimestamp: ownership.consensusTimestamp,
        transactionId: ownership.transactionId
      };

    } catch (error) {
      console.warn(`⚠️ Blockchain verification failed for ${tokenId}:${serialNumber}:`, error);
      return {
        networkVerified: false
      };
    }
  }

  /**
   * Update analytics
   */
  private async updateAnalytics(
    qrCodeId: string,
    context: VerificationContext
  ): Promise<{
    isFirstScan: boolean;
    totalScans: number;
    uniqueScans: number;
    lastScannedAt?: Date;
    scanLocation?: string;
  }> {
    try {
      // Get existing analytics
      const analytics = await this.qrCodeModel.getScanAnalytics(qrCodeId);
      
      // Determine if this is a unique scan (by IP address)
      const isUniqueScan = context.ipAddress ? 
        !analytics.recentScans.some(scan => scan.ipAddress === context.ipAddress) : 
        true;

      // Update scan statistics
      await this.qrCodeModel.updateScanStatistics(qrCodeId, isUniqueScan);

      const scanLocation = context.location ? 
        `${context.location.city || ''}, ${context.location.country || ''}`.replace(/^, |, $/g, '') : 
        undefined;

      return {
        isFirstScan: analytics.totalScans === 0,
        totalScans: analytics.totalScans + 1,
        uniqueScans: analytics.uniqueScans + (isUniqueScan ? 1 : 0),
        lastScannedAt: new Date(),
        scanLocation
      };

    } catch (error) {
      console.warn(`⚠️ Analytics update failed for QR code ${qrCodeId}:`, error);
      return {
        isFirstScan: true,
        totalScans: 1,
        uniqueScans: 1
      };
    }
  }

  /**
   * Record scan in database
   */
  private async recordScan(
    result: VerificationResult,
    context: VerificationContext
  ): Promise<void> {
    try {
      if (!result.qrCodeId) return;

      await this.qrCodeModel.recordScan({
        scanId: context.scanId,
        qrCodeId: result.qrCodeId,
        trackingId: result.trackingId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        deviceType: context.deviceType,
        platform: context.platform,
        browser: context.browser,
        country: context.location?.country,
        region: context.location?.region,
        city: context.location?.city,
        latitude: context.location?.latitude,
        longitude: context.location?.longitude,
        timezone: context.location?.timezone,
        referrer: context.referrer,
        campaignSource: context.campaignSource,
        scanMethod: context.scanMethod,
        isSuccessful: result.isValid,
        verificationTime: result.verificationTime,
        errorMessage: result.errors.length > 0 ? result.errors.join('; ') : undefined
      });

    } catch (error) {
      console.warn('⚠️ Failed to record scan:', error);
    }
  }

  /**
   * Calculate authenticity score
   */
  private calculateAuthenticity(result: VerificationResult): boolean {
    const checks = [
      result.security.notTampered,
      result.security.notExpired,
      result.product?.isActive !== false,
      result.nft?.blockchainVerified !== false,
      result.blockchain?.networkVerified !== false
    ];

    const passedChecks = checks.filter(Boolean).length;
    const totalChecks = checks.filter(check => check !== undefined).length;

    return totalChecks > 0 && (passedChecks / totalChecks) >= 0.8;
  }

  /**
   * Calculate risk level
   */
  private calculateRiskLevel(result: VerificationResult): 'low' | 'medium' | 'high' {
    let riskScore = 0;

    // Security risks
    if (!result.security.notExpired) riskScore += 3;
    if (!result.security.notTampered) riskScore += 4;
    if (result.security.hashValid === false) riskScore += 2;
    if (result.security.signatureValid === false) riskScore += 2;

    // Data risks
    if (!result.product?.isActive) riskScore += 2;
    if (result.nft && !result.nft.blockchainVerified) riskScore += 3;
    if (result.blockchain && !result.blockchain.networkVerified) riskScore += 4;

    // Error risks
    if (result.errors.length > 0) riskScore += result.errors.length;

    if (riskScore >= 6) return 'high';
    if (riskScore >= 3) return 'medium';
    return 'low';
  }

  /**
   * Generate recommendations
   */
  private generateRecommendations(result: VerificationResult): string[] {
    const recommendations: string[] = [];

    if (!result.security.notExpired) {
      recommendations.push('QR code has expired - verify product through alternative means');
    }

    if (!result.security.notTampered) {
      recommendations.push('QR code may have been tampered with - verify authenticity carefully');
    }

    if (result.product && !result.product.isActive) {
      recommendations.push('Product is inactive - contact manufacturer for verification');
    }

    if (result.nft && !result.nft.blockchainVerified) {
      recommendations.push('NFT could not be verified on blockchain - check network connectivity');
    }

    if (result.security.riskLevel === 'high') {
      recommendations.push('High risk detected - additional verification recommended');
    }

    if (result.warnings.length > 0) {
      recommendations.push('Review warnings and proceed with caution');
    }

    return recommendations;
  }

  /**
   * Generate data hash
   */
  private generateDataHash(data: string): string {
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Validate QR code against schema
   */
  async validateQrCodeSchema(qrData: QrCodeDataPayload): Promise<QrCodeValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required fields validation
    if (!qrData.type) errors.push('QR code type is required');
    if (!qrData.verificationUrl) errors.push('Verification URL is required');

    // Type-specific validation
    switch (qrData.type) {
      case 'product_verification':
        if (!qrData.productId) errors.push('Product ID is required for product verification');
        break;
      case 'nft_verification':
        if (!qrData.nftTokenId) errors.push('NFT Token ID is required for NFT verification');
        if (!qrData.nftSerialNumber) errors.push('NFT Serial Number is required for NFT verification');
        break;
      case 'batch_verification':
        if (!qrData.batchId) errors.push('Batch ID is required for batch verification');
        break;
    }

    // URL validation
    try {
      new URL(qrData.verificationUrl);
    } catch {
      errors.push('Invalid verification URL format');
    }

    // Expiration validation
    const notExpired = !qrData.expiresAt || new Date() <= qrData.expiresAt;
    if (!notExpired) {
      if (this.config.allowExpiredQrCodes) {
        warnings.push('QR code has expired');
      } else {
        errors.push('QR code has expired');
      }
    }

    return {
      isValid: errors.length === 0,
      data: qrData,
      errors,
      warnings,
      metadata: {
        dataSize: JSON.stringify(qrData).length,
        verifiedAt: new Date()
      },
      security: {
        hashValid: !!qrData.security?.hash,
        signatureValid: !!qrData.security?.signature,
        notExpired,
        notTampered: true // Would need additional verification
      },
      recommendations: warnings.length > 0 ? ['Review warnings before proceeding'] : []
    };
  }

  /**
   * Get verification statistics
   */
  async getVerificationStatistics(): Promise<{
    totalVerifications: number;
    successfulVerifications: number;
    failedVerifications: number;
    averageVerificationTime: number;
    securityIssuesDetected: number;
    cacheHitRate: number;
  }> {
    // This would be implemented with proper database queries
    // For now, return placeholder data
    return {
      totalVerifications: 0,
      successfulVerifications: 0,
      failedVerifications: 0,
      averageVerificationTime: 0,
      securityIssuesDetected: 0,
      cacheHitRate: 0
    };
  }

  /**
   * Clear verification cache
   */
  clearCache(): void {
    this.verificationCache.clear();
    console.log('✅ Verification cache cleared');
  }

  /**
   * Get service configuration
   */
  getConfig(): VerificationConfig {
    return { ...this.config };
  }

  /**
   * Update service configuration
   */
  updateConfig(newConfig: Partial<VerificationConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('✅ Verification service configuration updated');
  }
}

// Create singleton instance
let verificationService: QrCodeVerificationService | null = null;

/**
 * Get singleton verification service instance
 */
export const getQrCodeVerificationService = (config?: Partial<VerificationConfig>): QrCodeVerificationService => {
  if (!verificationService) {
    verificationService = new QrCodeVerificationService(config);
  }
  return verificationService;
};

/**
 * Verify QR code (convenience function)
 */
export const verifyQrCode = async (
  qrData: string,
  context: VerificationContext
): Promise<VerificationResult> => {
  const service = getQrCodeVerificationService();
  return await service.verifyQrCode(qrData, context);
};

export default QrCodeVerificationService;