/**
 * QR Code Types and Interfaces
 * Comprehensive type definitions for QR code generation and management
 */

/**
 * QR Code Format Types
 */
export type QrCodeFormat = 'png' | 'svg' | 'jpeg' | 'webp';

/**
 * QR Code Size Types
 */
export type QrCodeSize = 'small' | 'medium' | 'large' | 'xlarge' | 'custom';

/**
 * Error Correction Levels
 */
export type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

/**
 * QR Code Types
 */
export type QrCodeType = 
  | 'product_verification' 
  | 'nft_verification' 
  | 'authenticity_check' 
  | 'product_info' 
  | 'batch_verification'
  | 'marketing_campaign'
  | 'certificate_download'
  | 'custom';

/**
 * Template Categories
 */
export type TemplateCategory = 'product' | 'nft' | 'authenticity' | 'marketing' | 'certificate' | 'custom';

/**
 * QR Code Color Configuration
 */
export interface QrCodeColors {
  dark: string;
  light: string;
  gradient?: {
    enabled: boolean;
    type: 'linear' | 'radial';
    colors: string[];
    direction?: number; // degrees for linear gradient
  };
}

/**
 * Logo Configuration
 */
export interface LogoConfig {
  enabled: boolean;
  path?: string;
  url?: string;
  base64?: string;
  size?: number;
  position?: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  opacity?: number;
  border?: {
    enabled: boolean;
    width: number;
    color: string;
    radius: number;
  };
}

/**
 * Branding Configuration
 */
export interface BrandingConfig {
  companyName?: string;
  tagline?: string;
  website?: string;
  colors?: {
    primary: string;
    secondary: string;
    accent?: string;
  };
  fonts?: {
    primary: string;
    secondary: string;
  };
  layout?: {
    position: 'top' | 'bottom' | 'side';
    height?: number;
    padding?: number;
  };
}

/**
 * QR Code Generation Configuration
 */
export interface QrCodeGenerationConfig {
  format: QrCodeFormat;
  size: QrCodeSize;
  customSize?: number;
  customDimensions?: {
    width: number;
    height: number;
  };
  errorCorrectionLevel: ErrorCorrectionLevel;
  margin: number;
  color?: QrCodeColors;
  logo?: LogoConfig;
  branding?: BrandingConfig;
  quality?: number; // 0-100 for JPEG/WebP
  compression?: {
    enabled: boolean;
    level: number; // 1-9
  };
  effects?: {
    rounded: boolean;
    gradient: boolean;
    shadow: boolean;
    border: boolean;
  };
}

/**
 * QR Code Data Payload
 */
export interface QrCodeDataPayload {
  type: QrCodeType;
  version: string;
  productId?: string;
  nftTokenId?: string;
  nftSerialNumber?: number;
  batchId?: string;
  verificationUrl: string;
  fallbackUrl?: string;
  trackingId?: string;
  expiresAt?: Date;
  metadata?: {
    productName?: string;
    brand?: string;
    category?: string;
    description?: string;
    serialNumber?: string;
    manufacturingDate?: Date;
    expirationDate?: Date;
    certificationLevel?: string;
    tags?: string[];
  };
  security?: {
    hash: string;
    signature?: string;
    encryptionLevel?: 'none' | 'basic' | 'advanced';
  };
  analytics?: {
    trackScans: boolean;
    trackLocation: boolean;
    trackDevice: boolean;
    campaignId?: string;
  };
  additionalData?: Record<string, any>;
}

/**
 * QR Code Generation Result
 */
export interface QrCodeGenerationResult {
  success: boolean;
  qrCodeId: string;
  trackingId?: string;
  output: {
    dataUrl?: string;
    buffer?: Buffer;
    svg?: string;
    base64?: string;
    filePath?: string;
  };
  metadata: {
    verificationUrl: string;
    format: QrCodeFormat;
    size: {
      width: number;
      height: number;
    };
    fileSize: number;
    compression?: number;
    quality?: number;
  };
  timing: {
    generatedAt: Date;
    processingTime: number; // milliseconds
  };
  expiration?: {
    expiresAt: Date;
    ttl: number; // seconds
  };
  analytics: {
    enabled: boolean;
    trackingUrl?: string;
    dashboardUrl?: string;
  };
  error?: string;
  warnings?: string[];
}

/**
 * QR Code Template Definition
 */
export interface QrCodeTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  config: QrCodeGenerationConfig;
  preview?: {
    thumbnailUrl?: string;
    sampleData?: QrCodeDataPayload;
  };
  usage: {
    isDefault?: boolean;
    isPublic: boolean;
    useCount: number;
    rating?: number;
  };
  metadata: {
    version: string;
    author?: string;
    tags: string[];
    createdAt: Date;
    updatedAt: Date;
  };
  restrictions?: {
    allowedTypes?: QrCodeType[];
    maxSize?: number;
    maxUsage?: number;
    expirationDate?: Date;
  };
}

/**
 * Batch QR Code Generation Request
 */
export interface BatchQrCodeRequest {
  items: Array<{
    id: string;
    data: QrCodeDataPayload;
    config?: Partial<QrCodeGenerationConfig>;
    templateId?: string;
  }>;
  globalConfig?: Partial<QrCodeGenerationConfig>;
  templateId?: string;
  output: {
    format: 'individual' | 'zip' | 'pdf';
    compression: boolean;
    includePreviews: boolean;
  };
  metadata: {
    batchName?: string;
    description?: string;
    tags?: string[];
  };
}

/**
 * Batch QR Code Generation Result
 */
export interface BatchQrCodeResult {
  success: boolean;
  batchId: string;
  summary: {
    totalRequested: number;
    successfulGenerated: number;
    failed: number;
    warnings: number;
    totalSize: number; // bytes
    processingTime: number; // milliseconds
  };
  results: QrCodeGenerationResult[];
  output?: {
    zipBuffer?: Buffer;
    zipUrl?: string;
    pdfBuffer?: Buffer;
    pdfUrl?: string;
  };
  errors?: Array<{
    itemId: string;
    error: string;
  }>;
  analytics: {
    batchTrackingUrl?: string;
    individualTrackingUrls: string[];
  };
  generatedAt: Date;
}

/**
 * QR Code Scan Data
 */
export interface QrCodeScanData {
  scanId: string;
  qrCodeId: string;
  trackingId?: string;
  timestamp: Date;
  data: QrCodeDataPayload;
  scanner: {
    ipAddress?: string;
    userAgent?: string;
    deviceType?: 'mobile' | 'tablet' | 'desktop' | 'unknown';
    platform?: string;
    browser?: string;
  };
  location?: {
    country?: string;
    region?: string;
    city?: string;
    latitude?: number;
    longitude?: number;
    timezone?: string;
  };
  context: {
    referrer?: string;
    campaignSource?: string;
    scanMethod: 'camera' | 'upload' | 'api';
    appVersion?: string;
  };
  verification: {
    isValid: boolean;
    isExpired: boolean;
    verificationTime: number; // milliseconds
    errors?: string[];
  };
}

/**
 * QR Code Analytics Summary
 */
export interface QrCodeAnalyticsSummary {
  qrCodeId: string;
  trackingId?: string;
  period: {
    startDate: Date;
    endDate: Date;
  };
  metrics: {
    totalScans: number;
    uniqueScans: number;
    successfulScans: number;
    failedScans: number;
    averageScansPerDay: number;
    peakScanTime: Date;
  };
  demographics: {
    topCountries: Array<{ country: string; scans: number; percentage: number }>;
    topCities: Array<{ city: string; scans: number; percentage: number }>;
    deviceTypes: Array<{ type: string; scans: number; percentage: number }>;
    platforms: Array<{ platform: string; scans: number; percentage: number }>;
  };
  engagement: {
    scansByHour: number[];
    scansByDay: number[];
    retentionRate: number;
    bounceRate: number;
  };
  performance: {
    averageVerificationTime: number;
    errorRate: number;
    topErrors: Array<{ error: string; count: number }>;
  };
}

/**
 * QR Code Service Configuration
 */
export interface QrCodeServiceConfig {
  baseUrl: string;
  storage: {
    provider: 'local' | 'aws-s3' | 'azure-blob' | 'gcp-storage' | 'ipfs';
    bucket?: string;
    region?: string;
    credentials?: Record<string, any>;
  };
  cdn: {
    enabled: boolean;
    baseUrl?: string;
    cacheTtl?: number;
  };
  analytics: {
    enabled: boolean;
    provider?: 'internal' | 'google-analytics' | 'mixpanel' | 'segment';
    trackingId?: string;
    retentionDays?: number;
  };
  security: {
    encryption: {
      enabled: boolean;
      algorithm?: string;
      keyLength?: number;
    };
    signing: {
      enabled: boolean;
      algorithm?: string;
    };
    rateLimit: {
      enabled: boolean;
      maxRequestsPerMinute?: number;
      maxBatchSize?: number;
    };
  };
  processing: {
    maxConcurrentJobs: number;
    maxQueueSize: number;
    timeoutSeconds: number;
    retryAttempts: number;
  };
  templates: {
    allowCustomTemplates: boolean;
    maxCustomTemplates?: number;
    templateCacheSize?: number;
  };
  quality: {
    defaultQuality: number;
    maxQuality: number;
    compressionLevel: number;
    optimizeForWeb: boolean;
  };
  features: {
    batchGeneration: boolean;
    logoSupport: boolean;
    brandingSupport: boolean;
    customFonts: boolean;
    effects: boolean;
    animations: boolean;
  };
}

/**
 * QR Code Validation Result
 */
export interface QrCodeValidationResult {
  isValid: boolean;
  data?: QrCodeDataPayload;
  errors: string[];
  warnings: string[];
  metadata: {
    format?: string;
    version?: string;
    errorCorrectionLevel?: string;
    dataSize: number;
    verifiedAt: Date;
  };
  security: {
    hashValid?: boolean;
    signatureValid?: boolean;
    notExpired: boolean;
    notTampered: boolean;
  };
  recommendations?: string[];
}

/**
 * Export all types for easy import
 */
export type {
  QrCodeFormat,
  QrCodeSize,
  ErrorCorrectionLevel,
  QrCodeType,
  TemplateCategory
};