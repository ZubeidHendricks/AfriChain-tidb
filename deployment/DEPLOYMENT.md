# 🚀 Deployment Guide

This guide covers various deployment options for the Agentic Counterfeit Detection System, from local development to enterprise production environments.

## 📋 Prerequisites

### System Requirements
- **CPU**: 4+ cores recommended (8+ for production)
- **RAM**: 8GB minimum (16GB+ for production)
- **Storage**: 50GB+ available space
- **Network**: Stable internet connection for AI APIs

### Software Requirements
- **Docker & Docker Compose** (recommended)
- **Python 3.11+** 
- **Node.js 18+**
- **PostgreSQL 15+** with pgvector extension
- **Redis 7+**

### Optional Components
- **Kubernetes cluster** (for production)
- **Circom 2.0** (for zkSNARK features)
- **Neo4j** (for knowledge graph features)

## 🐳 Docker Deployment (Recommended)

### Quick Start
```bash
# Clone repository
git clone https://github.com/your-org/agentic-counterfeit-detection.git
cd agentic-counterfeit-detection

# Copy environment file
cp .env.example .env

# Edit environment variables
nano .env

# Start all services
docker-compose up -d

# Check service status
docker-compose ps

# View logs
docker-compose logs -f api
```

### Production Docker Setup
```bash
# Use production compose file
docker-compose -f docker-compose.prod.yml up -d

# Scale API instances
docker-compose -f docker-compose.prod.yml up -d --scale api=3

# Enable SSL with Let's Encrypt
docker-compose -f docker-compose.prod.yml -f docker-compose.ssl.yml up -d
```

### Docker Compose Services
```yaml
# docker-compose.yml overview
version: '3.8'
services:
  api:          # FastAPI application
  postgres:     # Primary database
  redis:        # Cache and message broker
  celery:       # Background task processing
  frontend:     # React admin dashboard
  nginx:        # Reverse proxy and load balancer
  monitoring:   # Prometheus & Grafana
```

## ☸️ Kubernetes Deployment

### Prerequisites
```bash
# Ensure kubectl is configured
kubectl cluster-info

# Create namespace
kubectl create namespace counterfeit-detection

# Set context
kubectl config set-context --current --namespace=counterfeit-detection
```

### Deploy Infrastructure
```bash
# Deploy PostgreSQL
kubectl apply -f k8s/postgres/

# Deploy Redis
kubectl apply -f k8s/redis/

# Deploy application
kubectl apply -f k8s/app/

# Deploy ingress
kubectl apply -f k8s/ingress/
```

### Monitor Deployment
```bash
# Check pod status
kubectl get pods

# Check services
kubectl get services

# View logs
kubectl logs -f deployment/api

# Scale deployment
kubectl scale deployment api --replicas=5
```

### Helm Chart Deployment
```bash
# Add repository
helm repo add counterfeit-detection ./helm-chart

# Install with custom values
helm install counterfeit-detection ./helm-chart -f values.prod.yaml

# Upgrade deployment
helm upgrade counterfeit-detection ./helm-chart
```

## 🔧 Manual Installation

### 1. Database Setup
```bash
# PostgreSQL
sudo apt-get install postgresql-15 postgresql-contrib
sudo -u postgres createdb counterfeit_detection

# Install pgvector extension
sudo -u postgres psql counterfeit_detection -c "CREATE EXTENSION vector;"

# Redis
sudo apt-get install redis-server
sudo systemctl enable redis-server
```

### 2. Python Backend
```bash
# Create virtual environment
python3.11 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
pip install -r requirements-prod.txt

# Run database migrations
alembic upgrade head

# Start API server
uvicorn counterfeit_detection.main:app --host 0.0.0.0 --port 8000

# Start Celery worker
celery -A counterfeit_detection.core.celery worker --loglevel=info
```

### 3. Frontend Setup
```bash
cd src/frontend/admin-dashboard

# Install dependencies
npm install

# Build for production
npm run build

# Serve with nginx or apache
sudo cp -r dist/* /var/www/html/
```

## 🌐 Cloud Platform Deployments

### AWS Deployment

#### ECS with Fargate
```bash
# Build and push images
aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin <account>.dkr.ecr.us-west-2.amazonaws.com

docker build -t counterfeit-detection-api .
docker tag counterfeit-detection-api:latest <account>.dkr.ecr.us-west-2.amazonaws.com/counterfeit-detection-api:latest
docker push <account>.dkr.ecr.us-west-2.amazonaws.com/counterfeit-detection-api:latest

# Deploy with CDK or CloudFormation
cdk deploy CounterfeitDetectionStack
```

#### EKS Deployment
```bash
# Create EKS cluster
eksctl create cluster --name counterfeit-detection --region us-west-2 --nodes 3

# Deploy application
kubectl apply -f k8s/aws/

# Configure ALB ingress
kubectl apply -f k8s/aws/ingress-alb.yaml
```

### Google Cloud Platform

#### Cloud Run Deployment
```bash
# Build and deploy
gcloud run deploy counterfeit-detection-api \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --max-instances 10
```

#### GKE Deployment
```bash
# Create GKE cluster
gcloud container clusters create counterfeit-detection \
  --num-nodes 3 \
  --machine-type n1-standard-4 \
  --zone us-central1-a

# Deploy application
kubectl apply -f k8s/gcp/
```

### Azure Deployment

#### Container Instances
```bash
# Create resource group
az group create --name counterfeit-detection --location eastus

# Deploy container group
az container create \
  --resource-group counterfeit-detection \
  --name counterfeit-detection-api \
  --image your-registry/counterfeit-detection-api:latest \
  --cpu 2 \
  --memory 4 \
  --ip-address public \
  --ports 8000
```

#### AKS Deployment
```bash
# Create AKS cluster
az aks create \
  --resource-group counterfeit-detection \
  --name counterfeit-detection-cluster \
  --node-count 3 \
  --node-vm-size Standard_D4s_v3

# Deploy application
kubectl apply -f k8s/azure/
```

## 🔒 Security Configuration

### SSL/TLS Setup
```bash
# Let's Encrypt with Certbot
sudo certbot --nginx -d your-domain.com

# Or use custom certificates
sudo cp your-cert.pem /etc/ssl/certs/
sudo cp your-key.pem /etc/ssl/private/
```

### Firewall Configuration
```bash
# UFW (Ubuntu)
sudo ufw allow 22    # SSH
sudo ufw allow 80    # HTTP
sudo ufw allow 443   # HTTPS
sudo ufw enable

# iptables rules
iptables -A INPUT -p tcp --dport 8000 -s 10.0.0.0/8 -j ACCEPT
```

### Security Hardening
```bash
# Create non-root user
useradd -m -s /bin/bash counterfeit-detection
usermod -aG docker counterfeit-detection

# Set file permissions
chmod 600 .env
chmod 700 scripts/
chown -R counterfeit-detection:counterfeit-detection /opt/counterfeit-detection/
```

## 📊 Monitoring Setup

### Prometheus & Grafana
```bash
# Start monitoring stack
docker-compose -f docker-compose.monitoring.yml up -d

# Access Grafana
open http://localhost:3000
# Default: admin/admin
```

### Application Monitoring
```bash
# Install APM agents
pip install opentelemetry-api opentelemetry-sdk
pip install opentelemetry-instrumentation-fastapi

# Configure tracing
export OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:14268/api/traces
```

### Log Management
```bash
# ELK Stack
docker-compose -f docker-compose.elk.yml up -d

# Configure log forwarding
filebeat -e -c filebeat.yml
```

## 🔄 CI/CD Pipeline

### GitHub Actions
```yaml
# .github/workflows/deploy.yml
name: Deploy to Production
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Deploy to production
        run: |
          ./scripts/deploy-production.sh
```

### GitLab CI
```yaml
# .gitlab-ci.yml
stages:
  - test
  - build
  - deploy

deploy_production:
  stage: deploy
  script:
    - ./scripts/deploy-production.sh
  only:
    - main
```

## 🧪 Testing Deployment

### Health Checks
```bash
# API health
curl -f http://localhost:8000/health

# Database connectivity
curl -f http://localhost:8000/health/db

# Redis connectivity
curl -f http://localhost:8000/health/redis
```

### Load Testing
```bash
# Install k6
sudo apt-get install k6

# Run load tests
k6 run tests/load/api-load-test.js

# Artillery testing
artillery run tests/load/artillery-config.yml
```

### Integration Testing
```bash
# Run integration tests
pytest tests/integration/ -v

# End-to-end tests
npm run test:e2e
```

## 🔧 Maintenance

### Database Maintenance
```bash
# Database backups
pg_dump counterfeit_detection > backup_$(date +%Y%m%d).sql

# Automated backups
crontab -e
# 0 2 * * * /usr/local/bin/backup-database.sh
```

### Updates and Patches
```bash
# Update application
git pull origin main
docker-compose pull
docker-compose up -d

# Database migrations
alembic upgrade head

# Clear caches
redis-cli FLUSHALL
```

### Scaling Operations
```bash
# Horizontal scaling
docker-compose up -d --scale api=5 --scale celery=3

# Vertical scaling (Kubernetes)
kubectl patch deployment api -p '{"spec":{"template":{"spec":{"containers":[{"name":"api","resources":{"requests":{"memory":"2Gi","cpu":"1000m"}}}]}}}}'
```

## 🆘 Troubleshooting

### Common Issues

#### Container Won't Start
```bash
# Check logs
docker-compose logs api

# Check resource usage
docker stats

# Restart services
docker-compose restart api
```

#### Database Connection Issues
```bash
# Test connection
psql -h localhost -U counterfeit_user -d counterfeit_detection -c "SELECT 1;"

# Check PostgreSQL logs
docker-compose logs postgres

# Verify network connectivity
docker-compose exec api ping postgres
```

#### Performance Issues
```bash
# Monitor resource usage
htop
iostat -x 1
free -m

# Check application metrics
curl http://localhost:8000/metrics

# Profile application
py-spy top --pid $(pgrep -f uvicorn)
```

### Debug Mode
```bash
# Enable debug logging
export DEBUG=true
export LOG_LEVEL=DEBUG

# Start with debug configuration
docker-compose -f docker-compose.debug.yml up
```

## 📚 Additional Resources

- [API Documentation](http://localhost:8000/docs)
- [Monitoring Dashboard](http://localhost:3000)
- [Admin Panel](http://localhost:8000/admin)
- [Health Checks](http://localhost:8000/health)

## 🔗 Related Documentation

- [Configuration Guide](CONFIGURATION.md)
- [Security Guide](SECURITY.md)
- [Monitoring Guide](MONITORING.md)
- [Troubleshooting Guide](TROUBLESHOOTING.md)

---

For production deployments, always review security configurations and follow your organization's DevOps practices.