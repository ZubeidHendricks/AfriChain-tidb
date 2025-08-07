# 🛡️ Agentic Counterfeit Detection System

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.104+-00a393.svg)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18+-61dafb.svg)](https://reactjs.org)

An enterprise-grade AI-powered counterfeit detection system that uses multi-agent orchestration, vector embeddings, LLM analysis, and zkSNARK cryptographic proofs to identify and prevent counterfeit products across e-commerce platforms.

## 🚀 Key Features

### Core Detection Capabilities
- **🤖 Multi-Agent AI System** - Orchestrated AI agents for comprehensive analysis
- **🔍 LLM-Powered Analysis** - Advanced authenticity scoring using Claude/GPT models  
- **📊 Vector Embedding Search** - Semantic similarity detection for product matching
- **⚡ Rule-Based Detection** - Dynamic rule engine for rapid identification
- **📱 Real-Time Monitoring** - Continuous marketplace surveillance

### Enterprise Security
- **🔐 zkSNARK Cryptographic Proofs** - Zero-knowledge proof verification for maximum security
- **🔗 Immutable Audit Trails** - Blockchain-anchored audit logs with Merkle tree verification
- **📋 Regulatory Compliance** - SOC 2, GDPR, and industry compliance reporting
- **🏢 Enterprise Integration** - ServiceNow GRC, SAP GRC, MetricStream connectivity

### Advanced Features
- **🏪 Brand Registration System** - Verified brand portal with document management
- **📧 Multi-Channel Alerts** - Email, SMS, Slack, webhook notifications
- **⚖️ Automated Enforcement** - Takedown requests with appeals workflow
- **📈 Analytics Dashboard** - Real-time metrics and performance monitoring
- **🔄 High-Performance Caching** - Redis-backed proof verification optimization

## 🏗️ Architecture Overview

```mermaid
graph TB
    subgraph "Frontend Layer"
        UI[Admin Dashboard UI]
        Mobile[Mobile App]
    end
    
    subgraph "API Layer"
        API[FastAPI REST API]
        WS[WebSocket Gateway]
    end
    
    subgraph "Agent Layer"
        Orch[Orchestrator Agent]
        Auth[Authenticity Analyzer]
        Rules[Rule Engine]
        Notif[Notification Agent]
        Enf[Enforcement Agent]
    end
    
    subgraph "Services Layer"
        ZK[zkSNARK Service]
        Embed[Embedding Service]
        Brand[Brand Service]
        Audit[Audit Trail Service]
        Cache[Proof Cache]
    end
    
    subgraph "Data Layer"
        PG[(PostgreSQL)]
        Vec[(Vector DB)]
        Redis[(Redis Cache)]
        BC[Blockchain Anchor]
    end
    
    UI --> API
    Mobile --> API
    API --> Orch
    Orch --> Auth
    Orch --> Rules
    Orch --> Notif
    Orch --> Enf
    Auth --> ZK
    Auth --> Embed
    Services --> PG
    Services --> Vec
    Services --> Redis
    Audit --> BC
```

## 🛠️ Tech Stack

### Backend
- **Python 3.11+** - Core application runtime
- **FastAPI** - High-performance async web framework
- **SQLAlchemy 2.0** - Modern async ORM
- **PostgreSQL 15+** - Primary database with vector extensions
- **Redis 7+** - Caching and session management
- **Celery** - Distributed task processing

### AI & ML
- **OpenAI GPT-4** - Primary LLM for authenticity analysis
- **Anthropic Claude** - Secondary LLM for analysis diversity
- **Sentence Transformers** - Vector embeddings generation
- **pgvector** - Vector similarity search in PostgreSQL

### Cryptographic Security
- **Circom 2.0** - zkSNARK circuit development
- **snarkjs** - Proof generation and verification
- **Web3.py** - Blockchain integration for audit anchoring
- **cryptography** - Enterprise-grade cryptographic operations

### Frontend
- **React 18** - Modern UI framework
- **TypeScript** - Type-safe development
- **Vite** - Fast build tooling
- **Tailwind CSS** - Utility-first styling
- **Recharts** - Data visualization

### DevOps & Infrastructure
- **Docker & Docker Compose** - Containerization
- **Kubernetes** - Container orchestration
- **GitHub Actions** - CI/CD pipelines
- **Prometheus & Grafana** - Monitoring and observability

## 📋 Prerequisites

- **Python 3.11+**
- **Node.js 18+**
- **PostgreSQL 15+** with pgvector extension
- **Redis 7+**
- **Docker & Docker Compose** (recommended)

### For zkSNARK Features (Optional)
- **Circom 2.0**
- **snarkjs CLI**
- **Trusted setup files**

## 🚀 Quick Start

### 1. Clone the Repository
```bash
git clone https://github.com/ZubeidHendricks/verichainX-hedera.git
cd verichainX-hedera
```

### 2. Environment Setup
```bash
# Copy environment template
cp .env.example .env

# Edit configuration
nano .env
```

### 3. Quick Deploy to Digital Ocean (Recommended)

#### Option A: App Platform (5 minutes)
```bash
# Deploy via Digital Ocean Console:
# 1. Go to https://cloud.digitalocean.com/apps
# 2. Create App from GitHub
# 3. Select: ZubeidHendricks/verichainX-hedera
# 4. Use .do/app.yaml configuration
# 5. Set your API keys in environment variables
# 6. Deploy!
```

#### Option B: Droplet Deployment (15 minutes)
```bash
# Make deployment script executable
chmod +x deploy-to-do.sh

# Run automated deployment
./deploy-to-do.sh
```

#### Option C: Local Docker Deployment
```bash
# Start all services locally
docker-compose up -d

# Initialize database
docker-compose exec api python -m alembic upgrade head

# Create initial admin user
docker-compose exec api python -m counterfeit_detection.scripts.create_admin
```

### 4. Manual Development Setup
```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate  # Linux/Mac
# venv\Scripts\activate    # Windows

# Install dependencies
pip install -r requirements.txt
pip install -r requirements-dev.txt

# Set up database
createdb counterfeit_detection
python -m alembic upgrade head

# Install frontend dependencies
cd src/frontend/admin-dashboard
npm install
npm run build
cd ../../..

# Start services
python -m counterfeit_detection.main
```

## 🔧 Configuration

### Environment Variables

```bash
# Core Application
API_HOST=0.0.0.0
API_PORT=8000
DEBUG=false
SECRET_KEY=your-secret-key-here

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/counterfeit_detection
REDIS_URL=redis://localhost:6379/0

# AI Services
OPENAI_API_KEY=your-openai-api-key
ANTHROPIC_API_KEY=your-anthropic-api-key

# Vector Embeddings
EMBEDDING_MODEL=all-MiniLM-L6-v2
VECTOR_DIMENSIONS=384

# zkSNARK Configuration (Optional)
ZKSNARK_ENABLED=true
CIRCUITS_PATH=/opt/circuits
TRUSTED_SETUP_PATH=/opt/trusted-setup

# Enterprise Integration
SERVICENOW_URL=your-servicenow-instance
SERVICENOW_USERNAME=your-username
SERVICENOW_PASSWORD=your-password

# Blockchain Anchoring
ETHEREUM_RPC_URL=https://mainnet.infura.io/v3/your-project-id
ANCHOR_PRIVATE_KEY=your-private-key

# Notification Services
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SLACK_WEBHOOK_URL=your-slack-webhook-url
```

### API Documentation

Once the application is running, visit:
- **API Documentation**: http://localhost:8000/docs
- **Alternative Docs**: http://localhost:8000/redoc
- **Admin Dashboard**: http://localhost:8000/admin

### Key API Endpoints

```http
# Product Analysis
POST /api/v1/products/analyze
GET  /api/v1/products/{product_id}/analysis

# Brand Management
POST /api/v1/brands/register
GET  /api/v1/brands/{brand_id}/verification-status

# Rule Management
POST /api/v1/rules/
GET  /api/v1/rules/active

# Analytics
GET  /api/v1/analytics/metrics
GET  /api/v1/analytics/performance

# Compliance (Enterprise)
GET  /api/v1/compliance/overview
POST /api/v1/compliance/reports/generate

# zkSNARK Proofs (Enterprise)
POST /api/v1/zkproof/generate
GET  /api/v1/zkproof/{proof_id}/verify
```

## 🔄 Development Workflow

### Running Tests
```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=src/counterfeit_detection --cov-report=html

# Run specific test categories
pytest tests/agents/  # Agent tests
pytest tests/api/     # API tests
pytest tests/services/  # Service tests
```

### Code Quality
```bash
# Linting
black src/ tests/
isort src/ tests/
flake8 src/ tests/

# Type checking
mypy src/counterfeit_detection
```

### Database Migrations
```bash
# Create new migration
alembic revision --autogenerate -m "Description of changes"

# Apply migrations
alembic upgrade head

# Rollback migration
alembic downgrade -1
```

## 🏢 Enterprise Features

### zkSNARK Cryptographic Verification

The system supports enterprise-grade cryptographic verification using zkSNARK proofs:

```python
# Generate proof for product authenticity
from counterfeit_detection.services import ZKProofService

zkproof_service = ZKProofService()
proof = await zkproof_service.generate_product_proof(
    product_id="prod_123",
    brand_id="brand_456",
    metadata=product_metadata
)

# Verify proof
verification = await zkproof_service.verify_proof(proof.id)
assert verification.is_valid
```

### Compliance Reporting

Generate regulatory compliance reports:

```python
from counterfeit_detection.services import AuditTrailService

audit_service = AuditTrailService()
report = await audit_service.generate_compliance_report(
    period_start=datetime(2024, 1, 1),
    period_end=datetime(2024, 12, 31),
    report_type="regulatory"
)
```

## 📊 Monitoring & Observability

### Metrics Endpoints
- Health check: `GET /health`
- Metrics: `GET /metrics` (Prometheus format)
- Agent status: `GET /api/v1/agents/status`

### Performance Monitoring
- Response time tracking
- Agent performance metrics
- Database query optimization
- zkSNARK verification timing

## 🔒 Security

### Authentication & Authorization
- JWT-based authentication
- Role-based access control (RBAC)
- API key management for external integrations

### Data Protection
- Encryption at rest and in transit
- PII data anonymization
- GDPR compliance features
- Audit logging for all operations

### Cryptographic Security
- zkSNARK zero-knowledge proofs
- Blockchain audit trail anchoring
- Merkle tree integrity verification
- Enterprise PKI integration

## 🚀 Deployment

### Digital Ocean Deployment (Recommended)

#### App Platform
```bash
# Fastest deployment option
# Uses .do/app.yaml configuration
# Managed services with auto-scaling
# Built-in SSL and monitoring
# Cost: ~$25-50/month
```

#### Droplet Deployment
```bash
# Run the automated deployment script
./deploy-to-do.sh

# Manual deployment
# 1. Create droplet (s-2vcpu-4gb)
# 2. Setup Docker and dependencies
# 3. Clone repository and build
# 4. Configure firewall and SSL
# Cost: ~$24/month
```

#### Access Your Deployed Application
- 🌐 **Frontend**: `https://your-app.ondigitalocean.app/`
- 📡 **API**: `https://your-app.ondigitalocean.app/api/`
- 📚 **API Docs**: `https://your-app.ondigitalocean.app/api/docs`
- 🔗 **Hedera Service**: `https://your-app.ondigitalocean.app/hedera/`

### Alternative Deployments

#### Docker Deployment
```bash
# Production deployment
docker-compose -f docker-compose.prod.yml up -d

# Scale API instances
docker-compose up -d --scale api=3
```

#### Kubernetes Deployment
```bash
# Deploy to Kubernetes
kubectl apply -f k8s/

# Check deployment status
kubectl get pods -l app=counterfeit-detection
```

## 📈 Performance & Scaling

### Performance Benchmarks
- **API Response Time**: < 200ms (95th percentile)
- **Product Analysis**: < 2 seconds average
- **zkSNARK Verification**: < 500ms with caching
- **Throughput**: 1000+ requests/second

### Scaling Strategies
- Horizontal API scaling
- Database read replicas
- Redis clustering
- CDN for static assets
- Load balancing with health checks

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

### Development Setup
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Run the test suite
6. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

### Documentation
- [API Documentation](docs/api-documentation.md)
- [Deployment Guide](docs/deployment-guide.md)
- [Enterprise Setup](docs/enterprise-setup.md)
- [Troubleshooting](docs/troubleshooting.md)

---

**Built with ❤️ using modern AI and cryptographic technologies**