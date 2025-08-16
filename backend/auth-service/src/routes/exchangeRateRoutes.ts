/**
 * Exchange Rate API Routes
 * 
 * Comprehensive REST API endpoints for exchange rate functionality featuring:
 * - HBAR to USD real-time exchange rates
 * - USD to KES currency conversion for M-Pesa settlements
 * - Cross-currency rate calculations
 * - Historical rate data and analytics
 * - Rate alerts and notifications
 * - Rate statistics and market data
 */

import express, { Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import rateLimit from 'express-rate-limit';
import { exchangeRateService, ExchangeRateData, CrossRateCalculation } from '../services/exchangeRateService';

const router = express.Router();

// Rate limiting for exchange rate endpoints
const exchangeRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // Higher limit for rate checking
  message: 'Too many exchange rate requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

const calculationRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // Moderate limit for calculations
  message: 'Too many rate calculation requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// Validation middleware
const validateRequest = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array(),
    });
  }
  next();
};

// Error handling middleware
const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * GET /api/exchange-rate/hbar-usd
 * Get current HBAR to USD exchange rate
 */
router.get('/hbar-usd',
  exchangeRateLimit,
  [
    query('forceFresh')
      .optional()
      .isBoolean()
      .withMessage('forceFresh must be a boolean'),
  ],
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { forceFresh = false } = req.query;
      
      const rate = await exchangeRateService.getHBARToUSDRate(Boolean(forceFresh));

      res.json({
        success: true,
        data: {
          sourcePair: rate.sourcePair,
          rate: rate.rate,
          source: rate.source,
          timestamp: rate.timestamp,
          validUntil: rate.validUntil,
          confidence: rate.confidence,
          volume24h: rate.volume24h,
          change24h: rate.change24h,
          changePercent24h: rate.changePercent24h,
        },
      });

    } catch (error) {
      console.error('Failed to get HBAR to USD rate:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get HBAR to USD rate',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    }
  })
);

/**
 * GET /api/exchange-rate/usd-kes
 * Get current USD to KES exchange rate
 */
router.get('/usd-kes',
  exchangeRateLimit,
  [
    query('forceFresh')
      .optional()
      .isBoolean()
      .withMessage('forceFresh must be a boolean'),
  ],
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { forceFresh = false } = req.query;
      
      const rate = await exchangeRateService.getUSDToKESRate(Boolean(forceFresh));

      res.json({
        success: true,
        data: {
          sourcePair: rate.sourcePair,
          rate: rate.rate,
          source: rate.source,
          timestamp: rate.timestamp,
          validUntil: rate.validUntil,
          confidence: rate.confidence,
          volume24h: rate.volume24h,
          change24h: rate.change24h,
          changePercent24h: rate.changePercent24h,
        },
      });

    } catch (error) {
      console.error('Failed to get USD to KES rate:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get USD to KES rate',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    }
  })
);

/**
 * POST /api/exchange-rate/convert
 * Calculate cross-currency conversion
 */
router.post('/convert',
  calculationRateLimit,
  [
    body('fromCurrency')
      .notEmpty()
      .isIn(['HBAR', 'USD', 'KES'])
      .withMessage('Valid fromCurrency is required (HBAR, USD, or KES)'),
    body('toCurrency')
      .notEmpty()
      .isIn(['HBAR', 'USD', 'KES'])
      .withMessage('Valid toCurrency is required (HBAR, USD, or KES)'),
    body('amount')
      .isFloat({ min: 0.000001 })
      .withMessage('Amount must be a positive number'),
  ],
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const { fromCurrency, toCurrency, amount } = req.body;

    try {
      // Validate that currencies are different
      if (fromCurrency === toCurrency) {
        return res.status(400).json({
          success: false,
          error: 'Invalid conversion request',
          message: 'From and to currencies must be different',
        });
      }

      const conversion = await exchangeRateService.calculateCrossRate(
        fromCurrency,
        toCurrency,
        parseFloat(amount)
      );

      res.json({
        success: true,
        message: 'Currency conversion calculated successfully',
        data: {
          fromCurrency: conversion.fromCurrency,
          toCurrency: conversion.toCurrency,
          amount: conversion.amount,
          convertedAmount: conversion.convertedAmount,
          exchangeRate: conversion.exchangeRate,
          intermediateRates: conversion.intermediateRates,
          calculatedAt: conversion.calculatedAt,
          confidence: conversion.confidence,
          fees: conversion.fees,
        },
      });

    } catch (error) {
      console.error('Currency conversion failed:', error);
      res.status(500).json({
        success: false,
        error: 'Currency conversion failed',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    }
  })
);

/**
 * GET /api/exchange-rate/:sourcePair/history
 * Get exchange rate history for a currency pair
 */
router.get('/:sourcePair/history',
  exchangeRateLimit,
  [
    param('sourcePair')
      .notEmpty()
      .matches(/^(HBAR\/USD|USD\/KES|HBAR\/KES)$/)
      .withMessage('Valid source pair is required (HBAR/USD, USD/KES, or HBAR/KES)'),
    query('timeframe')
      .optional()
      .isIn(['1h', '24h', '7d', '30d'])
      .withMessage('Valid timeframe is required (1h, 24h, 7d, 30d)'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 1000 })
      .withMessage('Limit must be between 1 and 1000'),
  ],
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const { sourcePair } = req.params;
    const { timeframe = '24h', limit = 100 } = req.query;

    try {
      const history = await exchangeRateService.getRateHistory(
        sourcePair,
        timeframe as '1h' | '24h' | '7d' | '30d',
        parseInt(limit as string)
      );

      res.json({
        success: true,
        data: {
          sourcePair,
          timeframe,
          totalRecords: history.length,
          history: history.map(record => ({
            exchangeRateId: record.exchangeRateId,
            rate: record.rate,
            timestamp: record.timestamp,
            volume: record.volume,
            high24h: record.high24h,
            low24h: record.low24h,
            source: record.source,
          })),
        },
      });

    } catch (error) {
      console.error('Failed to get rate history:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get rate history',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    }
  })
);

/**
 * GET /api/exchange-rate/:sourcePair/statistics
 * Get detailed statistics for a currency pair
 */
router.get('/:sourcePair/statistics',
  exchangeRateLimit,
  [
    param('sourcePair')
      .notEmpty()
      .matches(/^(HBAR\/USD|USD\/KES)$/)
      .withMessage('Valid source pair is required (HBAR/USD or USD/KES)'),
  ],
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const { sourcePair } = req.params;

    try {
      const statistics = await exchangeRateService.getRateStatistics(sourcePair);

      res.json({
        success: true,
        data: {
          sourcePair,
          current: {
            rate: statistics.current.rate,
            source: statistics.current.source,
            timestamp: statistics.current.timestamp,
            confidence: statistics.current.confidence,
          },
          statistics: {
            volatility: statistics.volatility,
            trend: statistics.trend,
            support: statistics.support,
            resistance: statistics.resistance,
            volume24h: statistics.volume24h,
          },
          history24h: {
            totalRecords: statistics.history24h.length,
            firstRecord: statistics.history24h[0]?.timestamp,
            lastRecord: statistics.history24h[statistics.history24h.length - 1]?.timestamp,
          },
        },
      });

    } catch (error) {
      console.error('Failed to get rate statistics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get rate statistics',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    }
  })
);

/**
 * POST /api/exchange-rate/bulk-convert
 * Perform multiple currency conversions in a single request
 */
router.post('/bulk-convert',
  calculationRateLimit,
  [
    body('conversions')
      .isArray({ min: 1, max: 10 })
      .withMessage('Conversions array is required (1-10 items)'),
    body('conversions.*.fromCurrency')
      .notEmpty()
      .isIn(['HBAR', 'USD', 'KES'])
      .withMessage('Valid fromCurrency is required for each conversion'),
    body('conversions.*.toCurrency')
      .notEmpty()
      .isIn(['HBAR', 'USD', 'KES'])
      .withMessage('Valid toCurrency is required for each conversion'),
    body('conversions.*.amount')
      .isFloat({ min: 0.000001 })
      .withMessage('Amount must be a positive number for each conversion'),
  ],
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const { conversions } = req.body;

    try {
      const results: CrossRateCalculation[] = [];
      const errors: any[] = [];

      // Process each conversion
      for (let i = 0; i < conversions.length; i++) {
        const conversion = conversions[i];
        
        try {
          // Validate currencies are different
          if (conversion.fromCurrency === conversion.toCurrency) {
            errors.push({
              index: i,
              error: 'From and to currencies must be different',
            });
            continue;
          }

          const result = await exchangeRateService.calculateCrossRate(
            conversion.fromCurrency,
            conversion.toCurrency,
            parseFloat(conversion.amount)
          );
          
          results.push(result);

        } catch (error) {
          errors.push({
            index: i,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      res.json({
        success: true,
        message: 'Bulk currency conversion completed',
        data: {
          totalRequests: conversions.length,
          successfulConversions: results.length,
          failedConversions: errors.length,
          results,
          errors: errors.length > 0 ? errors : undefined,
        },
      });

    } catch (error) {
      console.error('Bulk currency conversion failed:', error);
      res.status(500).json({
        success: false,
        error: 'Bulk currency conversion failed',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    }
  })
);

/**
 * GET /api/exchange-rate/current-rates
 * Get all current exchange rates in a single response
 */
router.get('/current-rates',
  exchangeRateLimit,
  [
    query('includeCross')
      .optional()
      .isBoolean()
      .withMessage('includeCross must be a boolean'),
  ],
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const { includeCross = true } = req.query;

    try {
      // Fetch primary rates in parallel
      const [hbarToUSD, usdToKES] = await Promise.all([
        exchangeRateService.getHBARToUSDRate(),
        exchangeRateService.getUSDToKESRate(),
      ]);

      const rates: { [key: string]: any } = {
        'HBAR/USD': {
          rate: hbarToUSD.rate,
          source: hbarToUSD.source,
          timestamp: hbarToUSD.timestamp,
          confidence: hbarToUSD.confidence,
        },
        'USD/KES': {
          rate: usdToKES.rate,
          source: usdToKES.source,
          timestamp: usdToKES.timestamp,
          confidence: usdToKES.confidence,
        },
      };

      // Calculate cross rates if requested
      if (Boolean(includeCross)) {
        const hbarToKES = hbarToUSD.rate * usdToKES.rate;
        
        rates['HBAR/KES'] = {
          rate: hbarToKES,
          source: 'calculated',
          timestamp: new Date().toISOString(),
          confidence: Math.min(hbarToUSD.confidence, usdToKES.confidence),
          intermediateRates: {
            'HBAR/USD': hbarToUSD.rate,
            'USD/KES': usdToKES.rate,
          },
        };

        // Add reverse rates
        rates['USD/HBAR'] = {
          rate: 1 / hbarToUSD.rate,
          source: 'calculated',
          timestamp: new Date().toISOString(),
          confidence: hbarToUSD.confidence,
        };

        rates['KES/USD'] = {
          rate: 1 / usdToKES.rate,
          source: 'calculated',
          timestamp: new Date().toISOString(),
          confidence: usdToKES.confidence,
        };

        rates['KES/HBAR'] = {
          rate: 1 / hbarToKES,
          source: 'calculated',
          timestamp: new Date().toISOString(),
          confidence: Math.min(hbarToUSD.confidence, usdToKES.confidence),
        };
      }

      res.json({
        success: true,
        data: {
          timestamp: new Date().toISOString(),
          includeCrossRates: Boolean(includeCross),
          rateCount: Object.keys(rates).length,
          rates,
        },
      });

    } catch (error) {
      console.error('Failed to get current rates:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get current rates',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    }
  })
);

/**
 * GET /api/exchange-rate/health
 * Health check endpoint for exchange rate service
 */
router.get('/health', asyncHandler(async (req: Request, res: Response) => {
  try {
    // Test basic rate fetching to verify service health
    const startTime = Date.now();
    
    const [hbarRate, kesRate] = await Promise.allSettled([
      exchangeRateService.getHBARToUSDRate(),
      exchangeRateService.getUSDToKESRate(),
    ]);

    const responseTime = Date.now() - startTime;

    const healthStatus = {
      service: 'exchange-rate',
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      responseTime: `${responseTime}ms`,
      features: {
        hbarRates: hbarRate.status === 'fulfilled',
        kesRates: kesRate.status === 'fulfilled',
        crossRateCalculation: true,
        rateHistory: true,
        rateStatistics: true,
        bulkConversion: true,
      },
      rateProviders: {
        hbar: ['coingecko', 'coinbase', 'cryptocompare'],
        kes: ['exchangerate-api', 'currencyapi'],
      },
    };

    const statusCode = (hbarRate.status === 'fulfilled' && kesRate.status === 'fulfilled') ? 200 : 206;

    res.status(statusCode).json({
      success: true,
      data: healthStatus,
    });

  } catch (error) {
    console.error('Exchange rate health check failed:', error);
    res.status(503).json({
      success: false,
      error: 'Service unhealthy',
      message: error instanceof Error ? error.message : 'Unknown error occurred',
    });
  }
}));

// Error handling middleware
router.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Exchange Rate API Error:', error);

  // Handle specific error types
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: 'Validation error',
      message: error.message,
    });
  }

  if (error.name === 'TimeoutError') {
    return res.status(504).json({
      success: false,
      error: 'Request timeout',
      message: 'Exchange rate provider took too long to respond',
    });
  }

  // Generic error response
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred',
  });
});

export default router;