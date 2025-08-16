import QRCode from 'qrcode';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { NftToken } from '../models/Nft';
import { ProductModel } from '../models/Product';
import { getIpfsMetadataStorage } from '../utils/ipfsMetadataStorage';
import crypto from 'crypto';

/**
 * QR Code Generation Configuration
 */
export interface QrCodeConfig {
  format: 'png' | 'svg' | 'jpeg' | 'webp';
  size: 'small' | 'medium' | 'large' | 'xlarge' | 'custom';
  customSize?: number;
  errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H';
  margin: number;
  color?: {
    dark: string;
    light: string;
  };
  logo?: {
    enabled: boolean;
    path?: string;
    size?: number;
  };
  branding?: {
    companyName?: string;
    tagline?: string;
    colors?: {
      primary: string;
      secondary: string;
    };
  };
}

/**
 * QR Code Data Content
 */
export interface QrCodeData {
  type: 'product_verification' | 'nft_verification' | 'authenticity_check' | 'product_info' | 'custom';
  productId?: string;
  nftTokenId?: string;
  nftSerialNumber?: number;
  verificationUrl: string;
  additionalData?: Record<string, any>;
  expiresAt?: Date;
  metadata?: {
    productName?: string;
    brand?: string;
    category?: string;
    description?: string;
  };
}

/**
 * QR Code Generation Result
 */
export interface QrCodeResult {
  success: boolean;
  qrCodeId: string;
  dataUrl?: string;
  buffer?: Buffer;
  svg?: string;
  verificationUrl: string;
  format: string;
  size: {
    width: number;
    height: number;
  };
  fileSize: number;
  generatedAt: Date;
  expiresAt?: Date;
  error?: string;
}

/**
 * QR Code Template
 */
export interface QrCodeTemplate {
  id: string;
  name: string;
  description: string;
  config: QrCodeConfig;
  category: 'product' | 'nft' | 'authenticity' | 'marketing' | 'custom';
  isDefault?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * QR Code Analytics Data
 */
export interface QrCodeAnalytics {
  qrCodeId: string;
  scans: number;
  uniqueScans: number;
  lastScanned: Date;
  scanLocations: Array<{
    country?: string;
    region?: string;
    city?: string;
    latitude?: number;
    longitude?: number;
    count: number;
  }>;
  deviceTypes: Array<{
    type: 'mobile' | 'tablet' | 'desktop' | 'unknown';
    count: number;
  }>;
  scanHistory: Array<{
    timestamp: Date;
    ipAddress?: string;
    userAgent?: string;
    referrer?: string;
  }>;
}

/**
 * QR Code Service
 * Handles QR code generation, customization, and management
 */
export class QrCodeService {
  private productModel: ProductModel;
  private baseUrl: string;
  private defaultTemplates: Map<string, QrCodeTemplate> = new Map();

  constructor() {
    this.productModel = new ProductModel();
    this.baseUrl = process.env.QR_BASE_URL || process.env.FRONTEND_URL || 'https://africhain.app';
    this.initializeDefaultTemplates();
  }

  /**
   * Initialize default QR code templates
   */
  private initializeDefaultTemplates(): void {
    // Product Verification Template
    this.defaultTemplates.set('product_verification', {
      id: 'product_verification',
      name: 'Product Verification',
      description: 'Standard QR code for product authenticity verification',
      category: 'product',
      isDefault: true,
      config: {
        format: 'png',
        size: 'medium',
        errorCorrectionLevel: 'M',
        margin: 2,
        color: {
          dark: '#1a202c',
          light: '#ffffff'
        },
        logo: {
          enabled: true,
          size: 60
        },
        branding: {
          companyName: 'AfriChain',
          tagline: 'Authenticity Verified',
          colors: {
            primary: '#2B6CB0',
            secondary: '#4299E1'
          }
        }
      },
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // NFT Verification Template
    this.defaultTemplates.set('nft_verification', {
      id: 'nft_verification',
      name: 'NFT Certificate',
      description: 'Premium QR code for NFT authenticity certificates',
      category: 'nft',
      isDefault: true,
      config: {
        format: 'png',
        size: 'large',
        errorCorrectionLevel: 'Q',
        margin: 3,
        color: {
          dark: '#2D3748',
          light: '#F7FAFC'
        },
        logo: {
          enabled: true,
          size: 80
        },
        branding: {
          companyName: 'AfriChain',
          tagline: 'Blockchain Verified',
          colors: {
            primary: '#805AD5',
            secondary: '#B794F6'
          }
        }
      },
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Marketing Template
    this.defaultTemplates.set('marketing', {
      id: 'marketing',
      name: 'Marketing Campaign',
      description: 'Eye-catching QR code for marketing campaigns',
      category: 'marketing',
      config: {
        format: 'png',
        size: 'large',
        errorCorrectionLevel: 'H',
        margin: 4,
        color: {
          dark: '#E53E3E',
          light: '#FFF5F5'
        },
        logo: {
          enabled: true,
          size: 100
        },
        branding: {
          companyName: 'AfriChain',
          tagline: 'Scan to Verify',
          colors: {
            primary: '#E53E3E',
            secondary: '#FC8181'
          }
        }
      },
      createdAt: new Date(),
      updatedAt: new Date()
    });

    console.log('✅ Default QR code templates initialized');
  }

  /**
   * Generate QR code for product verification
   */
  async generateProductQrCode(
    productId: string,
    templateId: string = 'product_verification',
    customConfig?: Partial<QrCodeConfig>
  ): Promise<QrCodeResult> {
    try {
      console.log(`🔲 Generating QR code for product: ${productId}`);

      // Get product details
      const product = await this.productModel.getProductById(productId);
      if (!product) {
        throw new Error(`Product not found: ${productId}`);
      }

      // Get template
      const template = this.defaultTemplates.get(templateId);
      if (!template) {
        throw new Error(`Template not found: ${templateId}`);
      }

      // Merge configuration
      const config: QrCodeConfig = {
        ...template.config,
        ...customConfig
      };

      // Create verification URL
      const verificationUrl = `${this.baseUrl}/verify/product/${productId}`;

      // Prepare QR code data
      const qrCodeData: QrCodeData = {
        type: 'product_verification',
        productId,
        verificationUrl,
        metadata: {
          productName: product.name,
          brand: product.brand,
          category: product.category,
          description: product.description
        }
      };

      // Generate QR code
      const result = await this.generateQrCode(qrCodeData, config);

      console.log(`✅ QR code generated for product: ${productId}`);
      return result;

    } catch (error) {
      console.error(`❌ Failed to generate product QR code for ${productId}:`, error);
      return {
        success: false,
        qrCodeId: '',
        verificationUrl: '',
        format: '',
        size: { width: 0, height: 0 },
        fileSize: 0,
        generatedAt: new Date(),
        error: error instanceof Error ? error.message : 'QR code generation failed'
      };
    }
  }

  /**
   * Generate QR code for NFT verification
   */
  async generateNftQrCode(
    nftToken: NftToken,
    templateId: string = 'nft_verification',
    customConfig?: Partial<QrCodeConfig>
  ): Promise<QrCodeResult> {
    try {
      console.log(`🔲 Generating NFT QR code for token: ${nftToken.tokenId}:${nftToken.serialNumber}`);

      // Get template
      const template = this.defaultTemplates.get(templateId);
      if (!template) {
        throw new Error(`Template not found: ${templateId}`);
      }

      // Merge configuration
      const config: QrCodeConfig = {
        ...template.config,
        ...customConfig
      };

      // Create verification URL
      const verificationUrl = `${this.baseUrl}/verify/nft/${nftToken.tokenId}/${nftToken.serialNumber}`;

      // Get product details if available
      let metadata: any = {};
      if (nftToken.productId) {
        const product = await this.productModel.getProductById(nftToken.productId);
        if (product) {
          metadata = {
            productName: product.name,
            brand: product.brand,
            category: product.category,
            description: product.description
          };
        }
      }

      // Prepare QR code data
      const qrCodeData: QrCodeData = {
        type: 'nft_verification',
        nftTokenId: nftToken.tokenId,
        nftSerialNumber: nftToken.serialNumber,
        productId: nftToken.productId,
        verificationUrl,
        metadata,
        additionalData: {
          mintingStatus: nftToken.mintingStatus,
          metadataHash: nftToken.metadataHash,
          metadataUri: nftToken.metadataUri
        }
      };

      // Generate QR code
      const result = await this.generateQrCode(qrCodeData, config);

      console.log(`✅ NFT QR code generated for token: ${nftToken.tokenId}:${nftToken.serialNumber}`);
      return result;

    } catch (error) {
      console.error(`❌ Failed to generate NFT QR code:`, error);
      return {
        success: false,
        qrCodeId: '',
        verificationUrl: '',
        format: '',
        size: { width: 0, height: 0 },
        fileSize: 0,
        generatedAt: new Date(),
        error: error instanceof Error ? error.message : 'NFT QR code generation failed'
      };
    }
  }

  /**
   * Generate custom QR code
   */
  async generateCustomQrCode(
    data: QrCodeData,
    config: QrCodeConfig
  ): Promise<QrCodeResult> {
    try {
      console.log(`🔲 Generating custom QR code`);
      
      const result = await this.generateQrCode(data, config);
      
      console.log(`✅ Custom QR code generated`);
      return result;

    } catch (error) {
      console.error(`❌ Failed to generate custom QR code:`, error);
      return {
        success: false,
        qrCodeId: '',
        verificationUrl: '',
        format: '',
        size: { width: 0, height: 0 },
        fileSize: 0,
        generatedAt: new Date(),
        error: error instanceof Error ? error.message : 'Custom QR code generation failed'
      };
    }
  }

  /**
   * Core QR code generation logic
   */
  private async generateQrCode(data: QrCodeData, config: QrCodeConfig): Promise<QrCodeResult> {
    const qrCodeId = uuidv4();
    const generatedAt = new Date();

    // Determine size in pixels
    const sizeMap = {
      small: 200,
      medium: 300,
      large: 400,
      xlarge: 600,
      custom: config.customSize || 300
    };
    
    const size = sizeMap[config.size];

    // Create QR code data string
    const qrDataString = JSON.stringify({
      id: qrCodeId,
      type: data.type,
      url: data.verificationUrl,
      productId: data.productId,
      nftTokenId: data.nftTokenId,
      nftSerialNumber: data.nftSerialNumber,
      timestamp: generatedAt.toISOString(),
      expires: data.expiresAt?.toISOString(),
      metadata: data.metadata
    });

    // QR code generation options
    const qrOptions = {
      errorCorrectionLevel: config.errorCorrectionLevel,
      type: 'image/png' as const,
      quality: 0.92,
      margin: config.margin,
      width: size,
      color: config.color || { dark: '#000000', light: '#ffffff' }
    };

    try {
      let finalBuffer: Buffer;
      let dataUrl: string | undefined;
      let svg: string | undefined;

      if (config.format === 'svg') {
        // Generate SVG QR code
        svg = await QRCode.toString(qrDataString, {
          ...qrOptions,
          type: 'svg'
        });
        finalBuffer = Buffer.from(svg);
      } else {
        // Generate raster QR code
        const qrBuffer = await QRCode.toBuffer(qrDataString, qrOptions);
        
        // Apply logo if enabled
        if (config.logo?.enabled && config.logo.path) {
          finalBuffer = await this.addLogoToQrCode(qrBuffer, config.logo, size);
        } else {
          finalBuffer = qrBuffer;
        }

        // Apply branding if specified
        if (config.branding) {
          finalBuffer = await this.addBrandingToQrCode(finalBuffer, config.branding, size);
        }

        // Convert format if needed
        if (config.format !== 'png') {
          finalBuffer = await this.convertQrCodeFormat(finalBuffer, config.format);
        }

        // Generate data URL for web use
        dataUrl = `data:image/${config.format};base64,${finalBuffer.toString('base64')}`;
      }

      return {
        success: true,
        qrCodeId,
        dataUrl,
        buffer: finalBuffer,
        svg,
        verificationUrl: data.verificationUrl,
        format: config.format,
        size: { width: size, height: size },
        fileSize: finalBuffer.length,
        generatedAt,
        expiresAt: data.expiresAt
      };

    } catch (error) {
      throw new Error(`QR code generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Add logo to QR code
   */
  private async addLogoToQrCode(
    qrBuffer: Buffer, 
    logoConfig: NonNullable<QrCodeConfig['logo']>, 
    qrSize: number
  ): Promise<Buffer> {
    try {
      const logoSize = logoConfig.size || Math.floor(qrSize * 0.2);
      const logoPath = logoConfig.path || this.getDefaultLogoPath();

      // Load and resize logo
      const logo = await sharp(logoPath)
        .resize(logoSize, logoSize, { 
          fit: 'contain', 
          background: { r: 255, g: 255, b: 255, alpha: 0 } 
        })
        .png()
        .toBuffer();

      // Composite logo onto QR code
      const result = await sharp(qrBuffer)
        .composite([{
          input: logo,
          top: Math.floor((qrSize - logoSize) / 2),
          left: Math.floor((qrSize - logoSize) / 2)
        }])
        .png()
        .toBuffer();

      return result;

    } catch (error) {
      console.warn('⚠️ Failed to add logo to QR code, using original:', error);
      return qrBuffer;
    }
  }

  /**
   * Add branding to QR code
   */
  private async addBrandingToQrCode(
    qrBuffer: Buffer, 
    branding: NonNullable<QrCodeConfig['branding']>, 
    qrSize: number
  ): Promise<Buffer> {
    try {
      const brandingHeight = 60;
      const totalHeight = qrSize + brandingHeight;
      const primaryColor = branding.colors?.primary || '#2B6CB0';

      // Create branding banner
      const brandingBanner = await sharp({
        create: {
          width: qrSize,
          height: brandingHeight,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 }
        }
      })
      .png()
      .toBuffer();

      // Composite QR code with branding
      const result = await sharp({
        create: {
          width: qrSize,
          height: totalHeight,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 }
        }
      })
      .composite([
        { input: qrBuffer, top: 0, left: 0 },
        { input: brandingBanner, top: qrSize, left: 0 }
      ])
      .png()
      .toBuffer();

      return result;

    } catch (error) {
      console.warn('⚠️ Failed to add branding to QR code, using original:', error);
      return qrBuffer;
    }
  }

  /**
   * Convert QR code to different format
   */
  private async convertQrCodeFormat(buffer: Buffer, format: string): Promise<Buffer> {
    try {
      const sharpInstance = sharp(buffer);

      switch (format) {
        case 'jpeg':
          return await sharpInstance.jpeg({ quality: 92 }).toBuffer();
        case 'webp':
          return await sharpInstance.webp({ quality: 92 }).toBuffer();
        case 'png':
        default:
          return await sharpInstance.png().toBuffer();
      }
    } catch (error) {
      console.warn(`⚠️ Failed to convert QR code to ${format}, using PNG:`, error);
      return buffer;
    }
  }

  /**
   * Get default logo path
   */
  private getDefaultLogoPath(): string {
    // In production, this would point to the actual AfriChain logo
    return process.env.DEFAULT_LOGO_PATH || 'assets/logo.png';
  }

  /**
   * Generate batch QR codes for multiple products
   */
  async generateBatchQrCodes(
    productIds: string[],
    templateId: string = 'product_verification',
    customConfig?: Partial<QrCodeConfig>
  ): Promise<{
    success: boolean;
    results: QrCodeResult[];
    successCount: number;
    failedCount: number;
    totalRequested: number;
  }> {
    try {
      console.log(`🔲 Generating batch QR codes for ${productIds.length} products`);

      const results: QrCodeResult[] = [];
      const promises = productIds.map(productId => 
        this.generateProductQrCode(productId, templateId, customConfig)
      );

      const settledResults = await Promise.allSettled(promises);
      let successCount = 0;
      let failedCount = 0;

      settledResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
          if (result.value.success) {
            successCount++;
          } else {
            failedCount++;
          }
        } else {
          results.push({
            success: false,
            qrCodeId: '',
            verificationUrl: '',
            format: '',
            size: { width: 0, height: 0 },
            fileSize: 0,
            generatedAt: new Date(),
            error: `Failed to generate QR code for product ${productIds[index]}: ${result.reason}`
          });
          failedCount++;
        }
      });

      console.log(`✅ Batch QR code generation completed: ${successCount} successful, ${failedCount} failed`);

      return {
        success: successCount > 0,
        results,
        successCount,
        failedCount,
        totalRequested: productIds.length
      };

    } catch (error) {
      console.error('❌ Batch QR code generation failed:', error);
      return {
        success: false,
        results: [],
        successCount: 0,
        failedCount: productIds.length,
        totalRequested: productIds.length
      };
    }
  }

  /**
   * Get available templates
   */
  getTemplates(category?: string): QrCodeTemplate[] {
    const templates = Array.from(this.defaultTemplates.values());
    
    if (category) {
      return templates.filter(template => template.category === category);
    }
    
    return templates;
  }

  /**
   * Get template by ID
   */
  getTemplate(templateId: string): QrCodeTemplate | null {
    return this.defaultTemplates.get(templateId) || null;
  }

  /**
   * Create custom template
   */
  createTemplate(template: Omit<QrCodeTemplate, 'id' | 'createdAt' | 'updatedAt'>): QrCodeTemplate {
    const newTemplate: QrCodeTemplate = {
      ...template,
      id: uuidv4(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.defaultTemplates.set(newTemplate.id, newTemplate);
    console.log(`✅ Custom template created: ${newTemplate.name}`);
    
    return newTemplate;
  }

  /**
   * Validate QR code data
   */
  async validateQrCode(qrCodeData: string): Promise<{
    isValid: boolean;
    data?: QrCodeData;
    error?: string;
  }> {
    try {
      const parsed = JSON.parse(qrCodeData);
      
      // Basic validation
      if (!parsed.id || !parsed.type || !parsed.url) {
        return {
          isValid: false,
          error: 'Invalid QR code format: missing required fields'
        };
      }

      // Check expiration
      if (parsed.expires) {
        const expiryDate = new Date(parsed.expires);
        if (expiryDate < new Date()) {
          return {
            isValid: false,
            error: 'QR code has expired'
          };
        }
      }

      return {
        isValid: true,
        data: parsed
      };

    } catch (error) {
      return {
        isValid: false,
        error: 'Invalid QR code format: not valid JSON'
      };
    }
  }

  /**
   * Get service configuration
   */
  getServiceConfig(): {
    baseUrl: string;
    supportedFormats: string[];
    supportedSizes: string[];
    errorCorrectionLevels: string[];
    maxCustomSize: number;
    templateCount: number;
  } {
    return {
      baseUrl: this.baseUrl,
      supportedFormats: ['png', 'svg', 'jpeg', 'webp'],
      supportedSizes: ['small', 'medium', 'large', 'xlarge', 'custom'],
      errorCorrectionLevels: ['L', 'M', 'Q', 'H'],
      maxCustomSize: 2000,
      templateCount: this.defaultTemplates.size
    };
  }
}

// Create singleton instance
let qrCodeService: QrCodeService | null = null;

/**
 * Get singleton QR code service instance
 */
export const getQrCodeService = (): QrCodeService => {
  if (!qrCodeService) {
    qrCodeService = new QrCodeService();
  }
  return qrCodeService;
};

/**
 * Generate QR code for product verification (convenience function)
 */
export const generateProductQrCode = async (
  productId: string,
  templateId?: string,
  customConfig?: Partial<QrCodeConfig>
): Promise<QrCodeResult> => {
  const service = getQrCodeService();
  return await service.generateProductQrCode(productId, templateId, customConfig);
};

/**
 * Generate QR code for NFT verification (convenience function)
 */
export const generateNftQrCode = async (
  nftToken: NftToken,
  templateId?: string,
  customConfig?: Partial<QrCodeConfig>
): Promise<QrCodeResult> => {
  const service = getQrCodeService();
  return await service.generateNftQrCode(nftToken, templateId, customConfig);
};

export default QrCodeService;