import dotenv from 'dotenv';
import App from './app';

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
  'AFRICASTALKING_API_KEY',
  'JWT_SECRET',
  'ENCRYPTION_KEY',
  'HASH_SECRET'
];

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingEnvVars.forEach(envVar => {
    console.error(`   - ${envVar}`);
  });
  console.error('\n📝 Please check your .env file and ensure all required variables are set.');
  process.exit(1);
}

// Optional environment variables with defaults
const defaults = {
  PORT: '3000',
  NODE_ENV: 'development',
  AFRICASTALKING_USERNAME: 'sandbox',
  SMS_SENDER_ID: 'AfriChain',
  JWT_EXPIRES_IN: '24h',
  REDIS_URL: 'redis://localhost:6379',
  DB_HOST: 'localhost',
  DB_PORT: '4000',
  DB_USER: 'root',
  DB_NAME: 'africhain_auth',
  APP_VERSION: '1.0.0'
};

// Set defaults for missing optional env vars
Object.entries(defaults).forEach(([key, value]) => {
  if (!process.env[key]) {
    process.env[key] = value;
  }
});

// Parse port
const port = parseInt(process.env.PORT || '3000', 10);

if (isNaN(port) || port < 1 || port > 65535) {
  console.error('❌ Invalid PORT environment variable. Must be a number between 1 and 65535.');
  process.exit(1);
}

// Display startup information
console.log('🎯 Starting AfriChain Authentication Service...');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`📦 Version: ${process.env.APP_VERSION}`);
console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
console.log(`🚪 Port: ${port}`);
console.log(`📱 SMS Provider: Africa's Talking (${process.env.AFRICASTALKING_USERNAME})`);
console.log(`🔒 JWT Expiry: ${process.env.JWT_EXPIRES_IN}`);
console.log(`🗄️  Database: TiDB (${process.env.DB_HOST}:${process.env.DB_PORT})`);
console.log(`⚡ Redis: ${process.env.REDIS_URL}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// Create and start the app
const app = new App(port);

// Start the server
app.start().catch((error) => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});

// Handle graceful shutdown
const gracefulShutdown = () => {
  console.log('\n🛑 Received shutdown signal...');
  app.shutdown();
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);