import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

import { errorHandler } from './middleware/errorHandler';
import { hederaRoutes } from './routes/hedera';
import { healthRoutes } from './routes/health';
import { connectRedis } from './config/redis';
import { initializeHedera } from './config/hedera';
import { messageHandler } from './services/messageHandler';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/health', healthRoutes);
app.use('/api/v1/hedera', hederaRoutes);

// Error handling
app.use(errorHandler);

// Startup function
async function startServer() {
  try {
    // Initialize Redis connection
    await connectRedis();
    console.log('✅ Redis connected successfully');

    // Initialize Hedera client
    await initializeHedera();
    console.log('✅ Hedera client initialized');

    // Start Redis message handler
    await messageHandler.startListening();
    console.log('✅ Redis message handler started');

    // Start server
    app.listen(PORT, () => {
      console.log(`🚀 Hedera Agent Service running on port ${PORT}`);
      console.log(`📡 Environment: ${process.env.NODE_ENV}`);
      console.log(`🔗 Network: ${process.env.HEDERA_NETWORK}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('📴 Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('📴 Shutting down gracefully...');
  process.exit(0);
});

startServer();