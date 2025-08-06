#!/bin/bash
set -e

echo "🌊 VeriChainX Digital Ocean Deployment Script"
echo "=============================================="

# Configuration
DROPLET_NAME="verichainx-hedera-demo"
REGION="nyc1"
SIZE="s-2vcpu-4gb"
IMAGE="ubuntu-22-04-x64"
DOMAIN=${DOMAIN:-"your-domain.com"}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Step 1: Create droplet using Claude MCP
print_status "Creating Digital Ocean droplet..."
claude -p "Create a Digital Ocean droplet with name: $DROPLET_NAME, region: $REGION, size: $SIZE, image: $IMAGE, enable monitoring and IPv6. Add tag 'verichainx'. Return the droplet ID and IP addresses." --allowedTools "mcp__digitalocean*"

# Wait for user to provide droplet details
echo ""
echo "Please provide the droplet IP address from the output above:"
read -p "Droplet IP: " DROPLET_IP

if [ -z "$DROPLET_IP" ]; then
    print_error "Droplet IP is required"
    exit 1
fi

print_success "Using droplet IP: $DROPLET_IP"

# Step 2: Wait for droplet to be ready
print_status "Waiting for droplet to be ready..."
sleep 30

# Step 3: Setup SSH connection
print_status "Setting up SSH connection..."
ssh-keyscan -H "$DROPLET_IP" >> ~/.ssh/known_hosts 2>/dev/null

# Step 4: Deploy application
print_status "Deploying VeriChainX to droplet..."

# Create deployment script to run on the server
cat > deploy-remote.sh << 'EOF'
#!/bin/bash
set -e

echo "🚀 Setting up VeriChainX on Digital Ocean droplet"

# Update system
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
systemctl enable docker
systemctl start docker

# Install Docker Compose
apt install docker-compose-plugin -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# Install Python 3.11
apt install software-properties-common -y
add-apt-repository ppa:deadsnakes/ppa -y
apt update
apt install python3.11 python3.11-venv python3.11-dev python3.11-pip -y

# Create app directory
mkdir -p /opt/verichainx
cd /opt/verichainx

# Clone repository
git clone https://github.com/ZubeidHendricks/verichainX-hedera.git .

# Create production environment file
cat > .env.production << 'ENVEOF'
# API Configuration
API_HOST=0.0.0.0
API_PORT=8000
DEBUG=false
SECRET_KEY=your-production-secret-key-change-this

# Database Configuration (using SQLite for demo)
DATABASE_URL=sqlite:///./verichainx.db

# Redis Configuration (local)
REDIS_URL=redis://localhost:6379/0

# AI Service Configuration
OPENAI_API_KEY=${OPENAI_API_KEY:-demo-key}
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-demo-key}

# Hedera Configuration
HEDERA_NETWORK=testnet
HEDERA_ACCOUNT_ID=0.0.4752063
HEDERA_PRIVATE_KEY=demo-private-key

# Vector Database
EMBEDDING_MODEL=all-MiniLM-L6-v2
VECTOR_DIMENSIONS=384

# Frontend Configuration
FRONTEND_URL=http://$(curl -s ifconfig.me)
API_BASE_URL=http://$(curl -s ifconfig.me):8000/api
ENVEOF

# Setup Python environment for the main API
cd verichainX
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Setup Hedera service
cd hedera-service
npm install
npm run build

# Setup Frontend
cd ../src/frontend/admin-dashboard
npm install
npm run build

# Go back to root
cd /opt/verichainx

# Create Docker Compose for production
cat > docker-compose.production.yml << 'DOCKEREOF'
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  api:
    build:
      context: ./verichainX
      dockerfile: Dockerfile
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=sqlite:///./data/verichainx.db
      - REDIS_URL=redis://redis:6379/0
      - API_HOST=0.0.0.0
      - API_PORT=8000
      - DEBUG=false
    volumes:
      - api_data:/app/data
    depends_on:
      - redis
    restart: unless-stopped

  hedera-service:
    build:
      context: ./verichainX/hedera-service
      dockerfile: Dockerfile
    ports:
      - "3001:3001"
    environment:
      - HEDERA_NETWORK=testnet
      - PORT=3001
    restart: unless-stopped

  frontend:
    build:
      context: ./verichainX/src/frontend/admin-dashboard
      dockerfile: Dockerfile
    ports:
      - "80:80"
    depends_on:
      - api
      - hedera-service
    restart: unless-stopped

volumes:
  redis_data:
  api_data:
DOCKEREOF

# Create Dockerfiles if they don't exist
if [ ! -f ./verichainX/Dockerfile ]; then
cat > ./verichainX/Dockerfile << 'APIEOF'
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create data directory
RUN mkdir -p /app/data

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Start application
CMD ["python", "-m", "uvicorn", "src.counterfeit_detection.main:app", "--host", "0.0.0.0", "--port", "8000"]
APIEOF
fi

if [ ! -f ./verichainX/hedera-service/Dockerfile ]; then
cat > ./verichainX/hedera-service/Dockerfile << 'HEDERAEOF'
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build application
RUN npm run build

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

# Start application
CMD ["npm", "start"]
HEDERAEOF
fi

if [ ! -f ./verichainX/src/frontend/admin-dashboard/Dockerfile ]; then
cat > ./verichainX/src/frontend/admin-dashboard/Dockerfile << 'FRONTEOF'
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build application
RUN npm run build

# Production image
FROM nginx:alpine

# Copy built application
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
FRONTEOF

# Create nginx config for frontend
cat > ./verichainX/src/frontend/admin-dashboard/nginx.conf << 'NGINXEOF'
server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://api:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /hedera {
        proxy_pass http://hedera-service:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINXEOF
fi

# Start the application
echo "🚀 Starting VeriChainX services..."
docker-compose -f docker-compose.production.yml up --build -d

echo "✅ Deployment complete!"
echo "🌐 Application URLs:"
echo "   Frontend: http://$(curl -s ifconfig.me)"
echo "   API: http://$(curl -s ifconfig.me):8000"
echo "   API Docs: http://$(curl -s ifconfig.me):8000/docs"
echo "   Hedera Service: http://$(curl -s ifconfig.me):3001"
echo ""
echo "📊 Check service status:"
echo "   docker-compose -f docker-compose.production.yml ps"
echo ""
echo "📋 View logs:"
echo "   docker-compose -f docker-compose.production.yml logs -f"
EOF

# Copy deployment script to server and execute
scp deploy-remote.sh root@$DROPLET_IP:/tmp/
ssh root@$DROPLET_IP 'chmod +x /tmp/deploy-remote.sh && /tmp/deploy-remote.sh'

print_success "Deployment completed!"
print_status "Your VeriChainX application is now running at:"
echo "  🌐 Frontend: http://$DROPLET_IP"
echo "  📡 API: http://$DROPLET_IP:8000"
echo "  📚 API Docs: http://$DROPLET_IP:8000/docs"
echo "  🔗 Hedera Service: http://$DROPLET_IP:3001"

# Step 5: Configure firewall
print_status "Configuring firewall..."
claude -p "Configure firewall for droplet IP $DROPLET_IP to allow HTTP (80), HTTPS (443), SSH (22), and custom ports 8000, 3001" --allowedTools "mcp__digitalocean*"

print_success "🎉 VeriChainX is now live on Digital Ocean!"
print_warning "Remember to:"
echo "  1. Point your domain to $DROPLET_IP"
echo "  2. Set up SSL certificates"
echo "  3. Configure your API keys in the environment"
echo "  4. Monitor the application logs"