# Multi-stage Docker build for optimal image size
FROM node:18-alpine AS base

# Install security updates and necessary tools
RUN apk update && apk upgrade && apk add --no-cache \
    dumb-init \
    && rm -rf /var/cache/apk/*

# Create app directory and user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
WORKDIR /app

# Copy package files
COPY --chown=nodejs:nodejs package*.json ./

# Development dependencies stage
FROM base AS deps
RUN npm ci --include=dev && npm cache clean --force

# Build stage
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs . .

# Build the application
RUN npm run build

# Production dependencies stage
FROM base AS prod-deps
ENV NODE_ENV=production
RUN npm ci --only=production && npm cache clean --force

# Production stage
FROM base AS production

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Copy production dependencies
COPY --from=prod-deps --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copy built application
COPY --from=build --chown=nodejs:nodejs /app/dist ./dist
COPY --chown=nodejs:nodejs package*.json ./

# Create necessary directories
RUN mkdir -p /app/logs && chown -R nodejs:nodejs /app/logs

# Switch to non-root user
USER nodejs

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:$PORT/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Expose port
EXPOSE 3000

# Start with dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]

# Labels for better container management
LABEL \
  org.opencontainers.image.title="AfriChain Authentication Service" \
  org.opencontainers.image.description="Phone number authentication with SMS OTP for AfriChain platform" \
  org.opencontainers.image.vendor="AfriChain" \
  org.opencontainers.image.version="1.0.0" \
  org.opencontainers.image.created="2024-01-01T00:00:00Z" \
  org.opencontainers.image.source="https://github.com/africhain/auth-service" \
  org.opencontainers.image.documentation="https://github.com/africhain/auth-service/blob/main/README.md"