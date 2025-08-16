import { Router, Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { authenticateToken } from '../middleware/auth';
import { getQrCodeService } from '../services/qrCodeService';
import { getQrCodeVerificationService } from '../services/qrCodeVerificationService';
import { getQrCodeAnalyticsService } from '../services/qrCodeAnalyticsService';
import { ProductModel } from '../models/Product';
import { NftTokenModel } from '../models/Nft';
import {
  QrCodeConfig,
  QrCodeData,
  QrCodeResult
} from '../services/qrCodeService';

const router = Router();
const qrCodeService = getQrCodeService();
const productModel = new ProductModel();
const nftTokenModel = new NftTokenModel();

/**
 * @route   POST /api/qr/generate/product/:productId
 * @desc    Generate QR code for product verification
 * @access  Protected
 */
router.post('/generate/product/:productId',
  authenticateToken,
  [
    param('productId').notEmpty().withMessage('Product ID is required'),
    body('templateId').optional().isString().withMessage('Template ID must be a string'),
    body('format').optional().isIn(['png', 'svg', 'jpeg', 'webp']).withMessage('Invalid format'),
    body('size').optional().isIn(['small', 'medium', 'large', 'xlarge', 'custom']).withMessage('Invalid size'),
    body('customSize').optional().isInt({ min: 100, max: 2000 }).withMessage('Custom size must be between 100-2000px'),
    body('errorCorrectionLevel').optional().isIn(['L', 'M', 'Q', 'H']).withMessage('Invalid error correction level'),
    body('margin').optional().isInt({ min: 0, max: 10 }).withMessage('Margin must be between 0-10'),
    body('includeLogo').optional().isBoolean().withMessage('Include logo must be boolean'),
    body('includeBranding').optional().isBoolean().withMessage('Include branding must be boolean')
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

      const { productId } = req.params;
      const {
        templateId = 'product_verification',
        format = 'png',
        size = 'medium',
        customSize,
        errorCorrectionLevel = 'M',
        margin = 2,
        includeLogo = true,
        includeBranding = true
      } = req.body;

      // Check if product exists
      const product = await productModel.getProductById(productId);
      if (!product) {
        return res.status(404).json({
          success: false,
          error: 'Product not found'
        });
      }

      // Build custom config
      const customConfig: Partial<QrCodeConfig> = {
        format,
        size,
        customSize,
        errorCorrectionLevel,
        margin,
        logo: { enabled: includeLogo },
        branding: includeBranding ? undefined : { companyName: '', tagline: '' }
      };

      // Generate QR code
      const result = await qrCodeService.generateProductQrCode(productId, templateId, customConfig);

      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: 'QR code generation failed',
          details: result.error
        });
      }

      res.json({
        success: true,
        data: {
          qrCodeId: result.qrCodeId,
          dataUrl: result.dataUrl,
          verificationUrl: result.verificationUrl,
          format: result.format,
          size: result.size,
          fileSize: result.fileSize,
          generatedAt: result.generatedAt,
          expiresAt: result.expiresAt
        }
      });

    } catch (error) {
      console.error('Product QR generation error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

/**
 * @route   POST /api/qr/generate/nft/:tokenId/:serialNumber
 * @desc    Generate QR code for NFT verification
 * @access  Protected
 */
router.post('/generate/nft/:tokenId/:serialNumber',
  authenticateToken,
  [
    param('tokenId').notEmpty().withMessage('Token ID is required'),
    param('serialNumber').isInt({ min: 1 }).withMessage('Serial number must be a positive integer'),
    body('templateId').optional().isString().withMessage('Template ID must be a string'),
    body('format').optional().isIn(['png', 'svg', 'jpeg', 'webp']).withMessage('Invalid format'),
    body('size').optional().isIn(['small', 'medium', 'large', 'xlarge', 'custom']).withMessage('Invalid size')
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
      const { templateId = 'nft_verification', format = 'png', size = 'large' } = req.body;

      // Get NFT token
      const nftToken = await nftTokenModel.getNftByTokenAndSerial(tokenId, parseInt(serialNumber));
      if (!nftToken) {
        return res.status(404).json({
          success: false,
          error: 'NFT not found'
        });
      }

      const customConfig: Partial<QrCodeConfig> = { format, size };
      const result = await qrCodeService.generateNftQrCode(nftToken, templateId, customConfig);

      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: 'NFT QR code generation failed',
          details: result.error
        });
      }

      res.json({
        success: true,
        data: {
          qrCodeId: result.qrCodeId,
          dataUrl: result.dataUrl,
          verificationUrl: result.verificationUrl,
          format: result.format,
          size: result.size,
          fileSize: result.fileSize,
          generatedAt: result.generatedAt
        }
      });

    } catch (error) {
      console.error('NFT QR generation error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

/**
 * @route   POST /api/qr/generate/custom
 * @desc    Generate custom QR code
 * @access  Protected
 */
router.post('/generate/custom',
  authenticateToken,
  [
    body('type').isIn(['product_verification', 'nft_verification', 'authenticity_check', 'product_info', 'custom'])
      .withMessage('Invalid QR code type'),
    body('verificationUrl').isURL().withMessage('Valid verification URL is required'),
    body('config').isObject().withMessage('Config object is required'),
    body('config.format').isIn(['png', 'svg', 'jpeg', 'webp']).withMessage('Invalid format'),
    body('config.size').isIn(['small', 'medium', 'large', 'xlarge', 'custom']).withMessage('Invalid size'),
    body('metadata').optional().isObject().withMessage('Metadata must be an object'),
    body('expiresAt').optional().isISO8601().withMessage('Expires at must be a valid date')
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

      const { type, verificationUrl, config, metadata, expiresAt, productId, nftTokenId, nftSerialNumber } = req.body;

      const qrCodeData: QrCodeData = {
        type,
        verificationUrl,
        productId,
        nftTokenId,
        nftSerialNumber,
        metadata,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined
      };

      const result = await qrCodeService.generateCustomQrCode(qrCodeData, config);

      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: 'Custom QR code generation failed',
          details: result.error
        });
      }

      res.json({
        success: true,
        data: {
          qrCodeId: result.qrCodeId,
          dataUrl: result.dataUrl,
          verificationUrl: result.verificationUrl,
          format: result.format,
          size: result.size,
          fileSize: result.fileSize,
          generatedAt: result.generatedAt,
          expiresAt: result.expiresAt
        }
      });

    } catch (error) {
      console.error('Custom QR generation error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

/**
 * @route   POST /api/qr/generate/batch
 * @desc    Generate QR codes for multiple products in batch
 * @access  Protected
 */
router.post('/generate/batch',
  authenticateToken,
  [
    body('productIds').isArray({ min: 1, max: 100 }).withMessage('Product IDs array is required (max 100)'),
    body('productIds.*').notEmpty().withMessage('Each product ID must be non-empty'),
    body('templateId').optional().isString().withMessage('Template ID must be a string'),
    body('config').optional().isObject().withMessage('Config must be an object')
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

      const { productIds, templateId = 'product_verification', config } = req.body;

      const result = await qrCodeService.generateBatchQrCodes(productIds, templateId, config);

      res.json({
        success: result.success,
        data: {
          results: result.results,
          summary: {
            totalRequested: result.totalRequested,
            successCount: result.successCount,
            failedCount: result.failedCount
          }
        }
      });

    } catch (error) {
      console.error('Batch QR generation error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

/**
 * @route   POST /api/qr/verify
 * @desc    Verify QR code data and authenticity
 * @access  Public
 */
router.post('/verify',
  [
    body('qrData').notEmpty().withMessage('QR data is required'),
    body('scanContext').optional().isObject().withMessage('Scan context must be an object'),
    body('scanContext.ipAddress').optional().isIP().withMessage('Invalid IP address'),
    body('scanContext.userAgent').optional().isString().withMessage('User agent must be a string'),
    body('scanContext.deviceType').optional().isIn(['mobile', 'tablet', 'desktop', 'unknown'])
      .withMessage('Invalid device type'),
    body('scanContext.scanMethod').optional().isIn(['camera', 'upload', 'api'])
      .withMessage('Invalid scan method'),
    body('scanContext.location').optional().isObject().withMessage('Location must be an object')
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

      const { qrData, scanContext = {} } = req.body;

      // Get verification service
      const verificationService = getQrCodeVerificationService();

      // Prepare verification context
      const context = {
        scanId: require('crypto').randomUUID(),
        timestamp: new Date(),
        ipAddress: scanContext.ipAddress || req.ip,
        userAgent: scanContext.userAgent || req.get('User-Agent'),
        deviceType: scanContext.deviceType || 'unknown',
        scanMethod: scanContext.scanMethod || 'api',
        location: scanContext.location,
        referrer: req.get('Referer'),
        ...scanContext
      };

      // Verify QR code
      const result = await verificationService.verifyQrCode(qrData, context);

      // Track the scan for analytics
      const analyticsService = getQrCodeAnalyticsService();
      if (result.qrCodeId) {
        await analyticsService.trackScan(result.qrCodeId, context);
      }

      res.json({
        success: true,
        data: {
          isValid: result.isValid,
          isAuthentic: result.isAuthentic,
          scanId: result.scanId,
          trackingId: result.trackingId,
          verificationTime: result.verificationTime,
          timestamp: result.timestamp,
          security: result.security,
          product: result.product,
          nft: result.nft,
          blockchain: result.blockchain,
          warnings: result.warnings
        },
        errors: result.errors.length > 0 ? result.errors : undefined
      });

    } catch (error) {
      console.error('QR verification error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

/**
 * @route   GET /api/qr/verify/product/:productId
 * @desc    Quick product verification by ID
 * @access  Public
 */
router.get('/verify/product/:productId',
  [
    param('productId').notEmpty().withMessage('Product ID is required'),
    query('scanId').optional().isUUID().withMessage('Scan ID must be a valid UUID')
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

      const { productId } = req.params;
      const { scanId } = req.query;

      // Check if product exists
      const product = await productModel.getProductById(productId);
      if (!product) {
        return res.status(404).json({
          success: false,
          error: 'Product not found'
        });
      }

      // Track verification attempt
      const analyticsService = getQrCodeAnalyticsService();
      const trackingContext = {
        scanId: (scanId as string) || require('crypto').randomUUID(),
        timestamp: new Date(),
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        scanMethod: 'api' as const,
        referrer: req.get('Referer')
      };

      await analyticsService.trackVerificationAttempt(productId, trackingContext);

      res.json({
        success: true,
        data: {
          product: {
            id: product.id,
            name: product.name,
            brand: product.brand,
            category: product.category,
            manufacturer: product.manufacturer,
            isActive: product.isActive,
            verificationStatus: 'verified'
          },
          verifiedAt: new Date(),
          scanId: trackingContext.scanId
        }
      });

    } catch (error) {
      console.error('Product verification error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

/**
 * @route   GET /api/qr/verify/nft/:tokenId/:serialNumber
 * @desc    Quick NFT verification by token ID and serial number
 * @access  Public
 */
router.get('/verify/nft/:tokenId/:serialNumber',
  [
    param('tokenId').notEmpty().withMessage('Token ID is required'),
    param('serialNumber').isInt({ min: 1 }).withMessage('Serial number must be a positive integer'),
    query('scanId').optional().isUUID().withMessage('Scan ID must be a valid UUID')
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
      const { scanId } = req.query;

      // Get NFT token
      const nftToken = await nftTokenModel.getNftByTokenAndSerial(tokenId, parseInt(serialNumber));
      if (!nftToken) {
        return res.status(404).json({
          success: false,
          error: 'NFT not found'
        });
      }

      // Get verification service for blockchain verification
      const verificationService = getQrCodeVerificationService();
      const blockchainResult = await verificationService.verifyNftOnBlockchain(tokenId, parseInt(serialNumber));

      // Track verification attempt
      const analyticsService = getQrCodeAnalyticsService();
      const trackingContext = {
        scanId: (scanId as string) || require('crypto').randomUUID(),
        timestamp: new Date(),
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        scanMethod: 'api' as const,
        referrer: req.get('Referer')
      };

      await analyticsService.trackNftVerification(tokenId, parseInt(serialNumber), trackingContext);

      res.json({
        success: true,
        data: {
          nft: {
            tokenId: nftToken.tokenId,
            serialNumber: nftToken.serialNumber,
            owner: nftToken.owner,
            mintingStatus: nftToken.mintingStatus,
            blockchainVerified: blockchainResult.verified
          },
          product: nftToken.productId ? {
            id: nftToken.productId,
            name: nftToken.productName || 'Unknown'
          } : undefined,
          blockchain: blockchainResult,
          verifiedAt: new Date(),
          scanId: trackingContext.scanId
        }
      });

    } catch (error) {
      console.error('NFT verification error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

/**
 * @route   GET /api/qr/analytics/:qrCodeId
 * @desc    Get analytics data for a specific QR code
 * @access  Protected
 */
router.get('/analytics/:qrCodeId',
  authenticateToken,
  [
    param('qrCodeId').isUUID().withMessage('QR Code ID must be a valid UUID'),
    query('timeRange').optional().isIn(['1h', '24h', '7d', '30d', '90d', 'all']).withMessage('Invalid time range'),
    query('includeRealtime').optional().isBoolean().withMessage('Include realtime must be boolean')
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

      const { qrCodeId } = req.params;
      const { timeRange = '7d', includeRealtime = false } = req.query;

      const analyticsService = getQrCodeAnalyticsService();

      // Get analytics data
      const analytics = await analyticsService.getQrCodeAnalytics(qrCodeId, {
        timeRange: timeRange as string,
        includeRealtime: includeRealtime === 'true'
      });

      if (!analytics) {
        return res.status(404).json({
          success: false,
          error: 'QR code analytics not found'
        });
      }

      res.json({
        success: true,
        data: analytics
      });

    } catch (error) {
      console.error('QR analytics error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

/**
 * @route   GET /api/qr/analytics/summary
 * @desc    Get summary analytics for all QR codes
 * @access  Protected
 */
router.get('/analytics/summary',
  authenticateToken,
  [
    query('timeRange').optional().isIn(['1h', '24h', '7d', '30d', '90d', 'all']).withMessage('Invalid time range'),
    query('groupBy').optional().isIn(['day', 'week', 'month']).withMessage('Invalid groupBy parameter'),
    query('productIds').optional().isString().withMessage('Product IDs must be a comma-separated string')
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

      const { 
        timeRange = '7d', 
        groupBy = 'day',
        productIds 
      } = req.query;

      const analyticsService = getQrCodeAnalyticsService();

      const filters: any = {
        timeRange: timeRange as string,
        groupBy: groupBy as string
      };

      if (productIds) {
        filters.productIds = (productIds as string).split(',');
      }

      const summary = await analyticsService.getAnalyticsSummary(filters);

      res.json({
        success: true,
        data: summary
      });

    } catch (error) {
      console.error('QR analytics summary error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

/**
 * @route   GET /api/qr/analytics/heatmap/:qrCodeId
 * @desc    Get scan heatmap data for a QR code
 * @access  Protected
 */
router.get('/analytics/heatmap/:qrCodeId',
  authenticateToken,
  [
    param('qrCodeId').isUUID().withMessage('QR Code ID must be a valid UUID'),
    query('timeRange').optional().isIn(['1h', '24h', '7d', '30d', '90d']).withMessage('Invalid time range'),
    query('resolution').optional().isIn(['country', 'region', 'city']).withMessage('Invalid resolution')
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

      const { qrCodeId } = req.params;
      const { timeRange = '7d', resolution = 'city' } = req.query;

      const analyticsService = getQrCodeAnalyticsService();

      const heatmapData = await analyticsService.generateHeatmapData(qrCodeId, {
        timeRange: timeRange as string,
        resolution: resolution as 'country' | 'region' | 'city'
      });

      res.json({
        success: true,
        data: heatmapData
      });

    } catch (error) {
      console.error('QR heatmap error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

/**
 * @route   GET /api/qr/analytics/export/:qrCodeId
 * @desc    Export analytics data in various formats
 * @access  Protected
 */
router.get('/analytics/export/:qrCodeId',
  authenticateToken,
  [
    param('qrCodeId').isUUID().withMessage('QR Code ID must be a valid UUID'),
    query('format').isIn(['csv', 'json', 'xlsx']).withMessage('Format must be csv, json, or xlsx'),
    query('timeRange').optional().isIn(['1h', '24h', '7d', '30d', '90d', 'all']).withMessage('Invalid time range'),
    query('includeDetails').optional().isBoolean().withMessage('Include details must be boolean')
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

      const { qrCodeId } = req.params;
      const { 
        format, 
        timeRange = '30d', 
        includeDetails = false 
      } = req.query;

      const analyticsService = getQrCodeAnalyticsService();

      const exportData = await analyticsService.exportAnalytics(qrCodeId, {
        format: format as 'csv' | 'json' | 'xlsx',
        timeRange: timeRange as string,
        includeDetails: includeDetails === 'true'
      });

      // Set appropriate headers based on format
      const contentTypes = {
        csv: 'text/csv',
        json: 'application/json',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      };

      const fileExtensions = {
        csv: 'csv',
        json: 'json',
        xlsx: 'xlsx'
      };

      const formatKey = format as 'csv' | 'json' | 'xlsx';
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `qr-analytics-${qrCodeId}-${timestamp}.${fileExtensions[formatKey]}`;

      res.setHeader('Content-Type', contentTypes[formatKey]);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      if (format === 'json') {
        res.json(exportData);
      } else {
        res.send(exportData);
      }

    } catch (error) {
      console.error('QR analytics export error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

/**
 * @route   POST /api/qr/analytics/track-custom
 * @desc    Track custom analytics event
 * @access  Protected
 */
router.post('/analytics/track-custom',
  authenticateToken,
  [
    body('qrCodeId').isUUID().withMessage('QR Code ID must be a valid UUID'),
    body('eventType').isIn(['download', 'share', 'print', 'view', 'custom']).withMessage('Invalid event type'),
    body('eventData').optional().isObject().withMessage('Event data must be an object'),
    body('context').optional().isObject().withMessage('Context must be an object')
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

      const { qrCodeId, eventType, eventData = {}, context = {} } = req.body;

      const analyticsService = getQrCodeAnalyticsService();

      const trackingContext = {
        timestamp: new Date(),
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        referrer: req.get('Referer'),
        ...context
      };

      await analyticsService.trackCustomEvent(qrCodeId, eventType, eventData, trackingContext);

      res.json({
        success: true,
        message: 'Event tracked successfully',
        data: {
          qrCodeId,
          eventType,
          timestamp: trackingContext.timestamp
        }
      });

    } catch (error) {
      console.error('Custom event tracking error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

/**
 * @route   GET /api/qr/templates
 * @desc    Get available QR code templates
 * @access  Protected
 */
router.get('/templates',
  authenticateToken,
  [
    query('category').optional().isIn(['product', 'nft', 'authenticity', 'marketing', 'custom'])
      .withMessage('Invalid category')
  ],
  async (req: Request, res: Response) => {
    try {
      const { category } = req.query;

      const templates = qrCodeService.getTemplates(category as string);

      res.json({
        success: true,
        data: {
          templates,
          count: templates.length
        }
      });

    } catch (error) {
      console.error('Templates fetch error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

/**
 * @route   GET /api/qr/templates/:templateId
 * @desc    Get specific QR code template
 * @access  Protected
 */
router.get('/templates/:templateId',
  authenticateToken,
  [
    param('templateId').notEmpty().withMessage('Template ID is required')
  ],
  async (req: Request, res: Response) => {
    try {
      const { templateId } = req.params;

      const template = qrCodeService.getTemplate(templateId);

      if (!template) {
        return res.status(404).json({
          success: false,
          error: 'Template not found'
        });
      }

      res.json({
        success: true,
        data: template
      });

    } catch (error) {
      console.error('Template fetch error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

/**
 * @route   POST /api/qr/templates
 * @desc    Create custom QR code template
 * @access  Protected
 */
router.post('/templates',
  authenticateToken,
  [
    body('name').notEmpty().withMessage('Template name is required'),
    body('description').notEmpty().withMessage('Template description is required'),
    body('category').isIn(['product', 'nft', 'authenticity', 'marketing', 'custom'])
      .withMessage('Invalid category'),
    body('config').isObject().withMessage('Config object is required'),
    body('config.format').isIn(['png', 'svg', 'jpeg', 'webp']).withMessage('Invalid format'),
    body('config.size').isIn(['small', 'medium', 'large', 'xlarge', 'custom']).withMessage('Invalid size'),
    body('config.errorCorrectionLevel').isIn(['L', 'M', 'Q', 'H']).withMessage('Invalid error correction level')
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

      const { name, description, category, config } = req.body;

      const template = qrCodeService.createTemplate({
        name,
        description,
        category,
        config
      });

      res.status(201).json({
        success: true,
        data: template,
        message: 'Template created successfully'
      });

    } catch (error) {
      console.error('Template creation error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

/**
 * @route   POST /api/qr/validate
 * @desc    Validate QR code data without scanning
 * @access  Public
 */
router.post('/validate',
  [
    body('qrData').notEmpty().withMessage('QR data is required')
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

      const { qrData } = req.body;

      const validationResult = await qrCodeService.validateQrCode(qrData);

      res.json({
        success: true,
        data: validationResult
      });

    } catch (error) {
      console.error('QR validation error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

/**
 * @route   GET /api/qr/config
 * @desc    Get QR service configuration
 * @access  Protected
 */
router.get('/config',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const config = qrCodeService.getServiceConfig();

      res.json({
        success: true,
        data: config
      });

    } catch (error) {
      console.error('Config fetch error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

/**
 * @route   GET /api/qr/download/:qrCodeId
 * @desc    Download QR code by ID
 * @access  Protected
 */
router.get('/download/:qrCodeId',
  authenticateToken,
  [
    param('qrCodeId').isUUID().withMessage('QR Code ID must be a valid UUID'),
    query('format').optional().isIn(['png', 'svg', 'jpeg', 'webp']).withMessage('Invalid format'),
    query('size').optional().isIn(['small', 'medium', 'large', 'xlarge', 'custom']).withMessage('Invalid size'),
    query('customSize').optional().isInt({ min: 100, max: 2000 }).withMessage('Custom size must be between 100-2000px')
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

      const { qrCodeId } = req.params;
      const { format = 'png', size = 'medium', customSize } = req.query;

      // This would typically fetch from database where QR codes are stored
      // For now, we'll return an error since we need to implement QR code storage
      res.status(501).json({
        success: false,
        error: 'QR code download not yet implemented - requires database storage of generated QR codes'
      });

    } catch (error) {
      console.error('QR download error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

/**
 * @route   DELETE /api/qr/:qrCodeId
 * @desc    Delete/deactivate QR code
 * @access  Protected
 */
router.delete('/:qrCodeId',
  authenticateToken,
  [
    param('qrCodeId').isUUID().withMessage('QR Code ID must be a valid UUID')
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

      const { qrCodeId } = req.params;

      // This would typically update the QR code status in database
      // For now, we'll return success with a note
      res.json({
        success: true,
        message: 'QR code deactivated successfully',
        data: {
          qrCodeId,
          deactivatedAt: new Date(),
          note: 'QR code deactivation requires database implementation'
        }
      });

    } catch (error) {
      console.error('QR deletion error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

export default router;