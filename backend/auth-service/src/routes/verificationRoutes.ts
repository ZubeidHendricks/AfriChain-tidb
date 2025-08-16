/**
 * Verification Routes
 * 
 * Public API endpoints for QR code verification and product authenticity checking.
 * These endpoints are designed to be accessed by consumers and verification apps.
 */

import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { qrVerificationService } from '../services/qrVerificationService';
import { getMirrorService } from '../services/hederaMirrorService';

const router = express.Router();

// Rate limiting for verification endpoints
const verificationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many verification requests from this IP, please try again later.',
    retryAfter: 15 * 60, // 15 minutes in seconds
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to all verification routes
router.use(verificationRateLimit);

/**
 * @route GET /api/verify/:qrData
 * @desc Verify a QR code's authenticity
 * @access Public
 */
router.get('/verify/:qrData', async (req: Request, res: Response) => {
  try {
    const { qrData } = req.params;
    
    if (!qrData) {
      return res.status(400).json({
        error: 'QR code data is required',
        code: 'MISSING_QR_DATA'
      });
    }

    // Decode URL-encoded QR data if necessary
    const decodedQrData = decodeURIComponent(qrData);

    // Perform verification
    const verificationResult = await qrVerificationService.verifyQRCode(decodedQrData);

    // Log verification attempt (for analytics)
    console.log(`Verification attempt - Product: ${verificationResult.productId}, Result: ${verificationResult.isAuthentic ? 'AUTHENTIC' : 'NOT_AUTHENTIC'}, IP: ${req.ip}`);

    res.json({
      success: true,
      result: verificationResult,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({
      error: 'Verification service temporarily unavailable',
      code: 'VERIFICATION_ERROR',
      details: process.env.NODE_ENV === 'development' ? error instanceof Error ? error.message : 'Unknown error' : undefined
    });
  }
});

/**
 * @route POST /api/verify
 * @desc Verify a QR code using POST request (for large payloads)
 * @access Public
 */
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const { qrData, useCache = true } = req.body;
    
    if (!qrData) {
      return res.status(400).json({
        error: 'QR code data is required',
        code: 'MISSING_QR_DATA'
      });
    }

    // Perform verification with optional caching
    const verificationResult = await qrVerificationService.verifyQRCodeCached(qrData, useCache);

    // Log verification attempt
    console.log(`Verification attempt (POST) - Product: ${verificationResult.productId}, Result: ${verificationResult.isAuthentic ? 'AUTHENTIC' : 'NOT_AUTHENTIC'}, IP: ${req.ip}`);

    res.json({
      success: true,
      result: verificationResult,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({
      error: 'Verification service temporarily unavailable',
      code: 'VERIFICATION_ERROR',
      details: process.env.NODE_ENV === 'development' ? error instanceof Error ? error.message : 'Unknown error' : undefined
    });
  }
});

/**
 * @route GET /api/verify/health
 * @desc Check verification service health
 * @access Public
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const healthStatus = await qrVerificationService.healthCheck();
    
    const statusCode = healthStatus.status === 'healthy' ? 200 : 
                      healthStatus.status === 'degraded' ? 200 : 503;

    res.status(statusCode).json({
      status: healthStatus.status,
      timestamp: new Date().toISOString(),
      details: healthStatus.details,
      services: {
        qrVerification: healthStatus.status,
        blockchain: 'checking...',
      }
    });

  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
      details: [error instanceof Error ? error.message : 'Unknown error']
    });
  }
});

/**
 * @route GET /api/verify/stats
 * @desc Get verification statistics
 * @access Public (limited data)
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await qrVerificationService.getVerificationStats();
    
    // Return limited public statistics
    res.json({
      success: true,
      stats: {
        totalVerifications: stats.totalVerifications,
        authenticityRate: stats.totalVerifications > 0 ? 
          ((stats.authenticCount / stats.totalVerifications) * 100).toFixed(1) + '%' : '0%',
        lastUpdated: new Date().toISOString(),
      }
    });

  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({
      error: 'Statistics temporarily unavailable',
      code: 'STATS_ERROR'
    });
  }
});

/**
 * @route GET /api/verify/blockchain/:tokenId/:serialNumber
 * @desc Get blockchain information for a specific NFT
 * @access Public
 */
router.get('/blockchain/:tokenId/:serialNumber', async (req: Request, res: Response) => {
  try {
    const { tokenId, serialNumber } = req.params;
    
    if (!tokenId || !serialNumber) {
      return res.status(400).json({
        error: 'Token ID and serial number are required',
        code: 'MISSING_PARAMETERS'
      });
    }

    const mirrorService = getMirrorService(process.env.HEDERA_NETWORK);
    
    // Get NFT information
    const nftInfo = await mirrorService.getNFTInfo(tokenId, parseInt(serialNumber));
    
    if (!nftInfo) {
      return res.status(404).json({
        error: 'NFT not found on blockchain',
        code: 'NFT_NOT_FOUND'
      });
    }

    // Get token information
    const tokenInfo = await mirrorService.getTokenInfo(tokenId);
    
    // Get transaction history
    const transactions = await mirrorService.getNFTTransactionHistory(
      tokenId, 
      parseInt(serialNumber), 
      5
    );

    res.json({
      success: true,
      data: {
        nft: nftInfo,
        token: tokenInfo,
        transactions: transactions,
        retrievedAt: new Date().toISOString(),
      }
    });

  } catch (error) {
    console.error('Blockchain query error:', error);
    res.status(500).json({
      error: 'Blockchain query failed',
      code: 'BLOCKCHAIN_ERROR',
      details: process.env.NODE_ENV === 'development' ? error instanceof Error ? error.message : 'Unknown error' : undefined
    });
  }
});

/**
 * @route GET /api/verify/product/:productId
 * @desc Get public product information for verification
 * @access Public
 */
router.get('/product/:productId', async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    
    if (!productId) {
      return res.status(400).json({
        error: 'Product ID is required',
        code: 'MISSING_PRODUCT_ID'
      });
    }

    const productInfo = await qrVerificationService.getProductInfo(productId);
    
    if (!productInfo) {
      return res.status(404).json({
        error: 'Product not found',
        code: 'PRODUCT_NOT_FOUND'
      });
    }

    // Return only public information
    const publicProductInfo = {
      id: productInfo.id,
      name: productInfo.product_name,
      category: productInfo.category,
      brand: productInfo.brand,
      manufacturer: productInfo.manufacturer_name,
      originCountry: productInfo.origin_country,
      registrationDate: productInfo.created_at,
      status: productInfo.status,
      // Don't include sensitive information like user_id, detailed addresses, etc.
    };

    res.json({
      success: true,
      product: publicProductInfo,
      retrievedAt: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Product query error:', error);
    res.status(500).json({
      error: 'Product query failed',
      code: 'PRODUCT_ERROR'
    });
  }
});

/**
 * @route GET /api/verify/batch
 * @desc Verify multiple QR codes in batch (limited to prevent abuse)
 * @access Public
 */
router.post('/batch', async (req: Request, res: Response) => {
  try {
    const { qrCodes } = req.body;
    
    if (!Array.isArray(qrCodes) || qrCodes.length === 0) {
      return res.status(400).json({
        error: 'QR codes array is required',
        code: 'MISSING_QR_CODES'
      });
    }

    // Limit batch size to prevent abuse
    if (qrCodes.length > 10) {
      return res.status(400).json({
        error: 'Batch size limited to 10 QR codes',
        code: 'BATCH_SIZE_EXCEEDED'
      });
    }

    // Process verifications in parallel
    const verificationPromises = qrCodes.map(async (qrData, index) => {
      try {
        const result = await qrVerificationService.verifyQRCode(qrData);
        return { index, success: true, result };
      } catch (error) {
        return { 
          index, 
          success: false, 
          error: error instanceof Error ? error.message : 'Verification failed' 
        };
      }
    });

    const results = await Promise.all(verificationPromises);

    res.json({
      success: true,
      results,
      batchSize: qrCodes.length,
      processedAt: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Batch verification error:', error);
    res.status(500).json({
      error: 'Batch verification failed',
      code: 'BATCH_ERROR'
    });
  }
});

/**
 * @route GET /api/verify/analytics/summary
 * @desc Get public analytics summary
 * @access Public
 */
router.get('/analytics/summary', async (req: Request, res: Response) => {
  try {
    // Return basic public analytics
    const summary = {
      platform: 'AfriChain Authenticity Verification',
      description: 'Blockchain-powered product authenticity verification',
      features: [
        'QR Code Verification',
        'Blockchain Integration',
        'Real-time Validation',
        'Tamper Detection'
      ],
      supportedNetworks: ['Hedera Hashgraph'],
      apiVersion: '1.0.0',
      lastUpdated: new Date().toISOString(),
    };

    res.json({
      success: true,
      summary
    });

  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({
      error: 'Analytics temporarily unavailable',
      code: 'ANALYTICS_ERROR'
    });
  }
});

export default router;