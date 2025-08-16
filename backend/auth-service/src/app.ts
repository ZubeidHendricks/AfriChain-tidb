import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import Database from './config/database';
import RedisClient from './config/redis';
import authRoutes from './routes/auth';
import ussdRoutes from './routes/ussd';
import mobileRoutes from './routes/mobile';
import crossChannelRoutes from './routes/crossChannel';
import productRoutes from './routes/products';
import qrCodeRoutes from './routes/qrCodeRoutes';
import verificationRoutes from './routes/verificationRoutes';
import analyticsRoutes from './routes/analyticsRoutes';
import { authenticateToken } from './middleware/auth';

class App {
  public app: Application;
  private port: number;

  constructor(port: number = 3000) {
    this.app = express();
    this.port = port;
    
    this.initializeMiddlewares();
    this.initializeRoutes();
    this.initializeErrorHandling();
  }

  private initializeMiddlewares(): void {
    // Security middlewares
    this.app.use(helmet({
      contentSecurityPolicy: false, // Disable for API
      crossOriginEmbedderPolicy: false
    }));

    // CORS configuration
    this.app.use(cors({
      origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:5173'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
    }));

    // Compression
    this.app.use(compression());

    // Request logging
    this.app.use(morgan('combined', {
      skip: (req, res) => res.statusCode < 400 // Only log errors in production
    }));

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Global rate limiting (very permissive)
    const globalLimiter = rateLimit({
      windowMs: 1 * 60 * 1000, // 1 minute
      max: 100, // 100 requests per minute
      message: {
        success: false,
        error: 'Too many requests from this IP, please try again later.'
      },
      standardHeaders: true,
      legacyHeaders: false,
    });
    this.app.use(globalLimiter);

    // Request ID for tracing
    this.app.use((req, res, next) => {
      const requestId = Math.random().toString(36).substring(7);
      req.headers['x-request-id'] = requestId;
      res.setHeader('X-Request-ID', requestId);
      next();
    });
  }

  private initializeRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (req: Request, res: Response) => {
      res.status(200).json({
        success: true,
        message: 'Auth service is healthy',
        timestamp: new Date().toISOString(),
        version: process.env.APP_VERSION || '1.0.0'
      });
    });

    // API status endpoint
    this.app.get('/status', (req: Request, res: Response) => {
      res.status(200).json({
        success: true,
        service: 'africhain-auth-service',
        version: process.env.APP_VERSION || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      });
    });

    // Protected endpoint example
    this.app.get('/protected', authenticateToken, (req: Request, res: Response) => {
      res.status(200).json({
        success: true,
        message: 'Access granted to protected resource',
        user: req.user
      });
    });

    // Mount auth routes
    this.app.use('/auth', authRoutes);

    // Mount USSD routes
    this.app.use('/ussd', ussdRoutes);

    // Mount mobile routes
    this.app.use('/mobile', mobileRoutes);

    // Mount cross-channel routes
    this.app.use('/cross-channel', crossChannelRoutes);

    // Mount product routes
    this.app.use('/products', productRoutes);

    // Mount QR code routes
    this.app.use('/api/qr', qrCodeRoutes);

    // Mount verification routes (public API)
    this.app.use('/api/verify', verificationRoutes);

    // Mount analytics routes (privacy-compliant)
    this.app.use('/api/analytics', analyticsRoutes);

    // API documentation endpoint
    this.app.get('/api-docs', (req: Request, res: Response) => {
      res.status(200).json({
        success: true,
        title: 'AfriChain Authentication Service API',
        version: '1.0.0',
        endpoints: {
          'POST /auth/register': 'Send OTP to phone number for registration',
          'POST /auth/verify-otp': 'Verify OTP and get JWT token',
          'POST /auth/resend-otp': 'Resend OTP to phone number',
          'POST /auth/logout': 'Logout and blacklist token',
          'GET /auth/profile': 'Get user profile (requires auth)',
          'POST /ussd/callback': 'USSD callback for Africa\'s Talking integration',
          'GET /ussd/test': 'Test USSD service locally (development only)',
          'POST /ussd/simulate': 'Simulate USSD interaction for testing',
          'POST /mobile/register': 'Mobile app registration with OTP',
          'POST /mobile/verify-otp': 'Verify OTP and create mobile session',
          'POST /mobile/refresh-session': 'Refresh mobile authentication tokens',
          'GET /mobile/devices': 'Get user\'s registered mobile devices',
          'GET /cross-channel/overview': 'Get session overview across all channels',
          'POST /cross-channel/sync': 'Synchronize session data between channels',
          'POST /cross-channel/switch': 'Handle channel switching',
          'POST /products/register': 'Register new product with images to IPFS',
          'GET /products': 'Get user\'s products with pagination and filters',
          'GET /products/:id': 'Get detailed product information',
          'PUT /products/:id': 'Update product information (excluding images)',
          'POST /products/:id/images': 'Add additional images to existing product',
          'DELETE /products/:id': 'Delete product and all associated images',
          'GET /products/:id/images/:cid': 'Get specific product image by IPFS CID',
          'GET /products/health': 'Product service health check',
          'POST /api/qr/generate/product/:productId': 'Generate QR code for product',
          'POST /api/qr/generate/nft/:tokenId/:serialNumber': 'Generate QR code for NFT',
          'POST /api/qr/generate/custom': 'Generate custom QR code',
          'POST /api/qr/generate/batch': 'Batch QR code generation',
          'POST /api/qr/verify': 'Verify QR code data and authenticity',
          'GET /api/qr/verify/product/:productId': 'Quick product verification by ID',
          'GET /api/qr/verify/nft/:tokenId/:serialNumber': 'Quick NFT verification',
          'GET /api/qr/analytics/:qrCodeId': 'Get QR code analytics data',
          'GET /api/qr/analytics/summary': 'Get summary analytics for all QR codes',
          'GET /api/qr/templates': 'Get available QR code templates',
          'POST /api/qr/templates': 'Create custom QR code template',
          'GET /api/verify/:qrData': 'Verify QR code authenticity (public API)',
          'POST /api/verify': 'Verify QR code with POST data (public API)',
          'GET /api/verify/health': 'Verification service health check',
          'GET /api/verify/stats': 'Get public verification statistics',
          'GET /api/verify/blockchain/:tokenId/:serialNumber': 'Get blockchain NFT information',
          'GET /api/verify/product/:productId': 'Get public product information',
          'POST /api/verify/batch': 'Batch verify multiple QR codes',
          'GET /api/verify/analytics/summary': 'Get public analytics summary',
          'POST /api/analytics/track': 'Track verification event (privacy-compliant)',
          'GET /api/analytics/aggregated': 'Get aggregated analytics data (no personal info)',
          'GET /api/analytics/privacy-settings/:sessionId': 'Get privacy settings for session',
          'PUT /api/analytics/privacy-settings/:sessionId': 'Update privacy settings for session',
          'POST /api/analytics/data-cleanup': 'Perform manual data cleanup (admin only)',
          'GET /api/analytics/retention-policy': 'Get data retention policy information',
          'GET /api/analytics/privacy-compliance': 'Get privacy compliance report',
          'GET /api/analytics/health': 'Analytics service health check',
          'GET /health': 'Health check endpoint',
          'GET /status': 'Service status information',
          'GET /protected': 'Protected endpoint example'
        },
        authentication: {
          type: 'Bearer Token (JWT)',
          header: 'Authorization: Bearer <token>'
        }
      });
    });

    // 404 handler for unknown routes
    this.app.use('*', (req: Request, res: Response) => {
      res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        path: req.originalUrl,
        method: req.method
      });
    });
  }

  private initializeErrorHandling(): void {
    // Global error handler
    this.app.use((error: Error, req: Request, res: Response, next: any) => {
      console.error('Global error handler:', error);

      // Don't expose internal error details in production
      const isDevelopment = process.env.NODE_ENV === 'development';

      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: isDevelopment ? error.message : 'Something went wrong',
        ...(isDevelopment && { stack: error.stack })
      });
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      // Don't exit the process in production
      if (process.env.NODE_ENV === 'development') {
        process.exit(1);
      }
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      // Graceful shutdown
      this.shutdown();
    });

    // Handle SIGTERM (e.g., from Docker or Kubernetes)
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down gracefully');
      this.shutdown();
    });

    // Handle SIGINT (e.g., Ctrl+C)
    process.on('SIGINT', () => {
      console.log('SIGINT received, shutting down gracefully');
      this.shutdown();
    });
  }

  public async initialize(): Promise<void> {
    try {
      // Initialize database connection
      console.log('Connecting to database...');
      const db = Database.getInstance();
      await db.connect();
      await db.initializeTables();

      // Initialize Redis connection
      console.log('Connecting to Redis...');
      const redis = RedisClient.getInstance();
      await redis.connect();

      console.log('All services initialized successfully');

    } catch (error) {
      console.error('Failed to initialize services:', error);
      process.exit(1);
    }
  }

  public listen(): void {
    this.app.listen(this.port, () => {
      console.log(`🚀 Auth Service running on port ${this.port}`);
      console.log(`📚 API Documentation: http://localhost:${this.port}/api-docs`);
      console.log(`💓 Health Check: http://localhost:${this.port}/health`);
      console.log(`📊 Status: http://localhost:${this.port}/status`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  }

  public async start(): Promise<void> {
    try {
      await this.initialize();
      this.listen();
    } catch (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
  }

  public shutdown(): void {
    console.log('Shutting down gracefully...');
    
    // Close database connections
    Database.getInstance().disconnect().catch(console.error);
    
    // Close Redis connections
    RedisClient.getInstance().disconnect().catch(console.error);
    
    // Exit process
    setTimeout(() => {
      console.log('Force closing server');
      process.exit(0);
    }, 5000); // Give 5 seconds for cleanup
  }
}

export default App;