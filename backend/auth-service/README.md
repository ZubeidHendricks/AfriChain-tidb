# AfriChain Authentication Service

A robust, production-ready authentication service for the AfriChain Authenticity platform, featuring phone number registration with SMS OTP verification using Africa's Talking API.

## 🚀 Features

### Core Authentication
- **Phone Number Registration**: Kenyan phone number (+254) validation and registration
- **SMS OTP Verification**: 6-digit OTP codes with 5-minute expiry
- **JWT Token Management**: Secure token generation with blacklisting support
- **Rate Limiting**: 3 OTP requests per 15 minutes per phone number

### Security & Performance
- **End-to-End Encryption**: Phone numbers encrypted at rest
- **HMAC Signatures**: OTP integrity verification with HMAC-SHA256
- **Redis Session Management**: Fast session storage and rate limiting
- **Comprehensive Security**: Helmet.js, CORS, input validation

### Infrastructure
- **TiDB Database**: Scalable cloud database with connection pooling
- **Redis Cache**: Session management and rate limiting
- **Docker Support**: Full containerization with multi-stage builds
- **Health Checks**: Comprehensive monitoring endpoints

## 🛠️ Technology Stack

- **Runtime**: Node.js 18+ with TypeScript
- **Framework**: Express.js with comprehensive middleware
- **Database**: TiDB (MySQL-compatible) with connection pooling
- **Cache**: Redis for sessions and rate limiting
- **SMS Provider**: Africa's Talking API
- **Authentication**: JWT with RS256 signing
- **Security**: bcrypt, helmet, rate limiting
- **Testing**: Jest with comprehensive test coverage
- **DevOps**: Docker, Docker Compose

## 📋 Prerequisites

- Node.js 18+
- Redis server
- TiDB database (or MySQL-compatible database)
- Africa's Talking API credentials

## 🔧 Installation

### Local Development Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd africhain-auth-service
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Configuration**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Database Setup**
   ```bash
   # The service will automatically create tables on first run
   npm run dev
   ```

### Docker Setup

1. **Build and run with Docker Compose**
   ```bash
   docker-compose up -d
   ```

2. **Or build manually**
   ```bash
   docker build -t africhain-auth .
   docker run -p 3000:3000 --env-file .env africhain-auth
   ```

## ⚙️ Configuration

### Environment Variables

Create a `.env` file based on `.env.example`:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# Africa's Talking SMS
AFRICASTALKING_API_KEY=your_api_key
AFRICASTALKING_USERNAME=sandbox
SMS_SENDER_ID=AfriChain

# JWT & Security
JWT_SECRET=your_secure_jwt_secret
ENCRYPTION_KEY=your_32_byte_encryption_key
HASH_SECRET=your_hash_secret

# Database (TiDB)
DB_HOST=gateway01.ap-southeast-1.prod.aws.tidbcloud.com
DB_PORT=4000
DB_USER=your_user
DB_PASSWORD=your_password
DB_NAME=africhain_auth

# Redis
REDIS_URL=redis://localhost:6379
```

### Database Schema

The service automatically creates these tables:

```sql
-- Users table with encrypted phone numbers
CREATE TABLE users (
  id VARCHAR(36) PRIMARY KEY,
  phone_number_hash VARCHAR(64) UNIQUE NOT NULL,
  encrypted_phone TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_phone_hash (phone_number_hash)
);

-- OTP sessions with HMAC signatures
CREATE TABLE otp_sessions (
  id VARCHAR(36) PRIMARY KEY,
  phone_number_hash VARCHAR(64) NOT NULL,
  otp_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  attempts INT DEFAULT 0,
  verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_phone_expires (phone_number_hash, expires_at),
  INDEX idx_expires (expires_at)
);

-- Rate limiting tracking
CREATE TABLE rate_limits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  phone_number_hash VARCHAR(64) NOT NULL,
  request_count INT DEFAULT 1,
  window_start TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  INDEX idx_phone_expires (phone_number_hash, expires_at)
);
```

## 🚦 API Documentation

### Base URL: `http://localhost:3000`

### Authentication Endpoints

#### 1. Register Phone Number
```http
POST /auth/register
Content-Type: application/json

{
  "phoneNumber": "+254712345678"
}
```

**Response:**
```json
{
  "success": true,
  "message": "OTP sent successfully",
  "sessionId": "uuid-session-id",
  "expiresAt": "2024-01-01T00:05:00Z"
}
```

#### 2. Verify OTP
```http
POST /auth/verify-otp
Content-Type: application/json

{
  "sessionId": "uuid-session-id",
  "otpCode": "123456"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Authentication successful",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "user-uuid",
    "phoneNumber": "+254712345678",
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

#### 3. Resend OTP
```http
POST /auth/resend-otp
Content-Type: application/json

{
  "phoneNumber": "+254712345678"
}
```

#### 4. User Profile (Protected)
```http
GET /auth/profile
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

#### 5. Logout
```http
POST /auth/logout
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### Utility Endpoints

#### Health Check
```http
GET /health
```

#### Service Status
```http
GET /status
```

#### API Documentation
```http
GET /api-docs
```

## 🧪 Testing

### Run Tests
```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch

# Run specific test file
npm test -- crypto.test.ts
```

### Test Coverage

The test suite includes:
- **Unit Tests**: Crypto utilities, OTP service, SMS service
- **Integration Tests**: API endpoints, database operations
- **Security Tests**: Rate limiting, input validation
- **Error Handling**: Graceful error scenarios

Target coverage: 90%+ across all modules

## 🔐 Security Features

### Data Protection
- Phone numbers encrypted at rest using AES-256
- OTP codes hashed with bcrypt (cost factor 10)
- HMAC signatures for OTP integrity verification
- Secure session management with Redis TTL

### Rate Limiting
- OTP requests: 3 per 15 minutes per phone number
- API requests: 20 per 5 minutes per IP
- Global rate limit: 100 per minute per IP

### Token Security
- JWT with secure secret and expiry
- Token blacklisting on logout
- Signature verification for all protected routes

### Input Validation
- Phone number format validation (Kenyan numbers)
- OTP format validation (6 digits)
- SQL injection prevention
- XSS protection with helmet.js

## 📊 Monitoring & Logging

### Health Monitoring
```bash
# Check service health
curl http://localhost:3000/health

# Get detailed status
curl http://localhost:3000/status
```

### Logging
- Request/response logging with Morgan
- Error logging with stack traces (development)
- Performance metrics logging
- Security event logging

### Metrics
- Response times
- Error rates
- Active sessions
- Rate limit violations

## 🚀 Deployment

### Docker Production Build

```dockerfile
# Multi-stage build for optimal image size
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:18-alpine AS production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

### Environment-Specific Configs

- **Development**: Debug logging, auto-reload
- **Staging**: Production-like with debug info
- **Production**: Optimized performance, security headers

## 🔧 Development

### Available Scripts

```bash
# Development with hot reload
npm run dev

# Build TypeScript
npm run build

# Start production server
npm start

# Run linting
npm run lint

# Fix linting issues
npm run lint:fix

# Type checking
npm run type-check
```

### Code Quality

- **TypeScript**: Strict mode enabled
- **ESLint**: Airbnb configuration with custom rules
- **Prettier**: Consistent code formatting
- **Husky**: Pre-commit hooks for quality checks

## 🐛 Troubleshooting

### Common Issues

1. **Redis Connection Failed**
   ```bash
   # Check Redis status
   redis-cli ping
   
   # Start Redis service
   sudo systemctl start redis
   ```

2. **Database Connection Failed**
   ```bash
   # Verify TiDB credentials in .env
   # Check network connectivity
   telnet your-tidb-host 4000
   ```

3. **SMS Not Sending**
   ```bash
   # Verify Africa's Talking credentials
   # Check account balance
   curl -X GET https://api.africastalking.com/version1/user?username=your_username \
     -H "apiKey: your_api_key"
   ```

4. **Rate Limiting Issues**
   ```bash
   # Clear rate limit for phone number (Redis)
   redis-cli del "rate_limit:phone_hash"
   ```

## 📚 API Rate Limits

| Endpoint | Limit | Window |
|----------|--------|--------|
| `/auth/register` | 3 requests | 15 minutes |
| `/auth/resend-otp` | 3 requests | 15 minutes |
| `/auth/verify-otp` | 20 requests | 5 minutes |
| Global API | 100 requests | 1 minute |

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## 📞 Support

For support, please contact the AfriChain development team or create an issue in this repository.

## 🔄 Version History

- **v1.0.0**: Initial release with phone number authentication
- **v1.1.0**: Added JWT token management
- **v1.2.0**: Enhanced security and rate limiting