# Project Structure Architecture

## Overview
Standard Python project structure for the Counterfeit Product Detection system using FastAPI, with clear separation of concerns and modularity.

## Root Directory Structure
```
counterfeit-detection/
├── README.md
├── requirements.txt          # Production dependencies
├── requirements-dev.txt      # Development dependencies  
├── pyproject.toml           # Modern Python project configuration
├── .env.example             # Environment variables template
├── .gitignore
├── Dockerfile
├── docker-compose.yml       # Local development environment
├── .pre-commit-config.yaml  # Code quality hooks
├── pytest.ini              # Test configuration
├── mypy.ini                # Type checking configuration
│
├── src/                     # Main application source code
│   └── counterfeit_detection/
│       ├── __init__.py
│       ├── main.py          # FastAPI application entry point
│       ├── config/          # Configuration management
│       ├── api/             # API routes and endpoints
│       ├── agents/          # Multi-agent system
│       ├── models/          # Database models and schemas
│       ├── services/        # Business logic services
│       ├── utils/           # Utility functions and helpers
│       └── db/              # Database connection and migrations
│
├── tests/                   # Test suite
│   ├── __init__.py
│   ├── conftest.py          # Pytest configuration and fixtures
│   ├── unit/                # Unit tests
│   ├── integration/         # Integration tests
│   └── e2e/                 # End-to-end tests
│
├── frontend/                # React frontend (separate from Python backend)
│   ├── public/
│   ├── src/
│   ├── package.json
│   └── ...
│
├── docs/                    # Documentation
│   ├── architecture/        # Architecture documentation
│   ├── api/                # API documentation
│   └── deployment/         # Deployment guides
│
├── scripts/                 # Utility scripts
│   ├── setup.py            # Development environment setup
│   ├── migrate.py          # Database migration script
│   └── seed.py             # Database seeding for development
│
└── docker/                  # Docker configuration files
    ├── Dockerfile.backend
    ├── Dockerfile.frontend  
    └── nginx.conf
```

## Backend Source Structure (src/counterfeit_detection/)

### Main Application (main.py)
```python
# src/counterfeit_detection/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config.settings import get_settings
from .api.v1.router import api_router
from .db.database import init_database

app = FastAPI(
    title="Counterfeit Detection API",
    description="AI-powered counterfeit product detection system",
    version="1.0.0"
)

# Middleware, routes, startup events
```

### Configuration (config/)
```
config/
├── __init__.py
├── settings.py              # Pydantic settings with environment variables
├── database.py             # Database configuration
├── logging.py              # Logging configuration
└── security.py            # Security and authentication settings
```

**Key files:**
- `settings.py` - Main application settings using Pydantic
- `database.py` - TiDB connection settings and pool configuration
- `logging.py` - Structured logging setup with correlation IDs

### API Layer (api/)
```
api/
├── __init__.py
├── dependencies.py          # FastAPI dependencies (auth, db sessions, etc.)
├── v1/                     # API version 1
│   ├── __init__.py
│   ├── router.py           # Main API router
│   ├── endpoints/          # Individual endpoint modules
│   │   ├── __init__.py
│   │   ├── products.py     # Product ingestion endpoints
│   │   ├── analysis.py     # Authenticity analysis endpoints
│   │   ├── admin.py        # Admin dashboard endpoints
│   │   ├── health.py       # Health check endpoints
│   │   └── webhooks.py     # Webhook endpoints
│   └── schemas/            # Pydantic request/response models
│       ├── __init__.py
│       ├── products.py     # Product-related schemas
│       ├── analysis.py     # Analysis-related schemas
│       └── common.py       # Common schemas (pagination, etc.)
```

**Key patterns:**
- `/api/v1/products/ingest` - Product metadata ingestion
- `/api/v1/products/{product_id}/analyze` - Trigger authenticity analysis
- `/api/v1/admin/dashboard/metrics` - Dashboard metrics
- `/api/v1/health` - Health check endpoint

### Multi-Agent System (agents/)
```
agents/
├── __init__.py
├── base.py                 # BaseAgent abstract class
├── orchestrator.py         # Agent orchestration and coordination
├── authenticity_analyzer.py # LLM-powered authenticity analysis
├── rule_engine.py          # Rule-based detection engine
├── notification_agent.py   # Alert and notification handling
└── utils/
    ├── __init__.py
    ├── communication.py    # Agent-to-agent communication
    ├── registry.py         # Agent discovery and registration
    └── monitoring.py       # Agent health monitoring
```

**Key classes:**
- `BaseAgent` - Abstract base class for all agents
- `AuthenticityAnalyzer` - Main LLM analysis agent
- `RuleEngine` - Configurable rule-based detection
- `AgentOrchestrator` - Coordinates agent workflows

### Data Models (models/)
```
models/
├── __init__.py
├── database.py             # SQLAlchemy database models
├── schemas.py              # Pydantic schemas for API
└── enums.py               # Shared enums and constants
```

**Key models match database schema:**
- `Product` - Main product model with vector embeddings
- `AuthenticityAnalysis` - Analysis results
- `DetectionRule` - Configurable detection rules
- `EnforcementAction` - Enforcement action tracking

### Business Services (services/)
```
services/
├── __init__.py
├── product_service.py      # Product ingestion and management
├── analysis_service.py     # Authenticity analysis orchestration
├── embedding_service.py    # Vector embedding generation
├── notification_service.py # Alert and notification handling
├── enforcement_service.py  # Enforcement action execution
└── metrics_service.py      # Performance and business metrics
```

**Service responsibilities:**
- Handle business logic separate from API endpoints
- Coordinate between agents and database
- Manage external integrations (LLM APIs, notification services)

### Database Layer (db/)
```
db/
├── __init__.py
├── database.py             # Database connection and session management
├── migrations/             # Database migration scripts
│   ├── __init__.py
│   ├── 001_initial_schema.sql
│   ├── 002_add_vector_indexes.sql
│   └── ...
└── repositories/           # Data access layer
    ├── __init__.py
    ├── product_repository.py
    ├── analysis_repository.py
    └── rule_repository.py
```

### Utilities (utils/)
```
utils/
├── __init__.py
├── logger.py               # Logging utilities with correlation IDs
├── security.py            # JWT handling, password hashing
├── validators.py          # Custom validation functions
├── exceptions.py          # Custom exception classes
├── file_utils.py          # File upload and processing
└── vector_utils.py        # Vector embedding utilities
```

## Test Structure (tests/)

### Test Organization
```
tests/
├── conftest.py             # Shared fixtures and test configuration
├── unit/                   # Fast, isolated unit tests
│   ├── test_services/
│   ├── test_agents/
│   ├── test_models/
│   └── test_utils/
├── integration/            # Integration tests with external services
│   ├── test_api/
│   ├── test_database/
│   └── test_agents/
└── e2e/                   # End-to-end workflow tests
    ├── test_product_flow.py
    ├── test_analysis_flow.py
    └── test_dashboard_flow.py
```

### Key Test Patterns
- **Unit tests**: Mock external dependencies, test individual functions
- **Integration tests**: Real database connections, API calls
- **E2E tests**: Complete user workflows from API to database

## Configuration Files

### requirements.txt (Production)
```
fastapi==0.104.1
uvicorn[standard]==0.24.0
sqlalchemy==2.0.23
alembic==1.12.1
redis==5.0.1
openai==1.3.7
anthropic==0.7.8
sentence-transformers==2.2.2
pydantic==2.5.0
pydantic-settings==2.1.0
python-multipart==0.0.6
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4
python-dotenv==1.0.0
structlog==23.2.0
httpx==0.25.2
pillow==10.1.0
numpy==1.25.2
pandas==2.1.4
scikit-learn==1.3.2
```

### requirements-dev.txt (Development)
```
-r requirements.txt
pytest==7.4.3
pytest-asyncio==0.21.1
pytest-cov==4.1.0
httpx==0.25.2
black==23.11.0
isort==5.12.0
flake8==6.1.0
mypy==1.7.1
pre-commit==3.6.0
```

### pyproject.toml
```toml
[build-system]
requires = ["setuptools>=61.0", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "counterfeit-detection"
version = "1.0.0"
description = "AI-powered counterfeit product detection system"
authors = [{name = "Your Team", email = "team@example.com"}]
requires-python = ">=3.11"

[tool.black]
line-length = 88
target-version = ['py311']

[tool.isort]
profile = "black"
multi_line_output = 3

[tool.mypy]
python_version = "3.11"
strict = true
ignore_missing_imports = true

[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
python_classes = ["Test*"]
python_functions = ["test_*"]
addopts = "--cov=src --cov-report=html --cov-report=term-missing"
```

## File Naming Conventions

### Python Files
- **Modules**: `snake_case.py`
- **Classes**: `PascalCase`
- **Functions/Variables**: `snake_case`
- **Constants**: `UPPER_SNAKE_CASE`

### API Endpoints
- **REST pattern**: `/api/v1/resource/{id}/action`
- **Plural resources**: `/products`, `/analyses`
- **Actions**: `/products/{id}/analyze`, `/rules/{id}/activate`

### Database Tables
- **Table names**: `snake_case` (plural)
- **Column names**: `snake_case`
- **Foreign keys**: `{table}_id`
- **Indexes**: `idx_{columns}`