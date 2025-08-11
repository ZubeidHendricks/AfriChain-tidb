# API Specifications

## Overview
RESTful API specifications for the Counterfeit Product Detection system using FastAPI with automatic OpenAPI documentation.

## Base Configuration
- **Base URL**: `https://api.counterfeit-detection.com/api/v1`
- **Authentication**: JWT Bearer tokens
- **Content-Type**: `application/json` (except file uploads)
- **Rate Limiting**: 100 requests/minute per API key

## Core Endpoints

### Health Check
```http
GET /health
```
**Response:**
```json
{
    "status": "healthy",
    "version": "1.0.0",
    "timestamp": "2025-01-20T10:30:00Z",
    "database": "connected",
    "redis": "connected",
    "services": {
        "llm_provider": "available",
        "vector_search": "available"
    }
}
```

### Product Ingestion

#### Ingest Product Metadata
```http
POST /products/ingest
Content-Type: multipart/form-data
Authorization: Bearer <jwt-token>
```

**Request Body (multipart/form-data):**
```
description: "High-quality leather handbag with gold hardware"
category: "handbags"
price: 299.99
brand: "LuxuryBrand"
supplier_id: "supplier-uuid-123"
images: [file1.jpg, file2.jpg]  # Multiple image files
```

**Response (201 Created):**
```json
{
    "product_id": "prod-uuid-456",
    "status": "ingested",
    "message": "Product metadata successfully ingested",
    "processing_status": "queued_for_analysis",
    "estimated_analysis_time": "30s"
}
```

**Error Response (400 Bad Request):**
```json
{
    "error": "validation_error",
    "message": "Invalid product data",
    "details": [
        {
            "field": "price",
            "error": "Price must be a positive number"
        }
    ]
}
```

#### Get Product Details
```http
GET /products/{product_id}
Authorization: Bearer <jwt-token>
```

**Response (200 OK):**
```json
{
    "product_id": "prod-uuid-456",
    "description": "High-quality leather handbag with gold hardware",
    "category": "handbags",
    "price": 299.99,
    "brand": "LuxuryBrand",
    "supplier": {
        "id": "supplier-uuid-123",
        "name": "Global Fashion Supplies",
        "reputation_score": 0.85
    },
    "image_urls": [
        "https://storage.example.com/images/prod-456-1.jpg",
        "https://storage.example.com/images/prod-456-2.jpg"
    ],
    "status": "active",
    "created_at": "2025-01-20T10:15:00Z",
    "analysis_results": {
        "authenticity_score": 87.5,
        "confidence": 0.92,
        "status": "likely_authentic",
        "last_analyzed": "2025-01-20T10:16:30Z"
    }
}
```

### Authenticity Analysis

#### Trigger Product Analysis
```http
POST /products/{product_id}/analyze
Authorization: Bearer <jwt-token>
```

**Request Body:**
```json
{
    "force_reanalysis": false,
    "include_reasoning": true,
    "comparison_limit": 10
}
```

**Response (202 Accepted):**
```json
{
    "analysis_id": "analysis-uuid-789",
    "product_id": "prod-uuid-456",
    "status": "processing",
    "estimated_completion": "2025-01-20T10:18:00Z"
}
```

#### Get Analysis Results
```http
GET /analyses/{analysis_id}
Authorization: Bearer <jwt-token>
```

**Response (200 OK):**
```json
{
    "analysis_id": "analysis-uuid-789",
    "product_id": "prod-uuid-456",
    "agent_id": "authenticity-analyzer-1",
    "authenticity_score": 87.5,
    "confidence_score": 0.92,
    "status": "completed",
    "reasoning": "Product description matches authentic luxury handbag patterns. Price point is consistent with genuine brand products. Supplier has good reputation score (0.85). No red flags detected in product imagery.",
    "comparison_products": [
        {
            "product_id": "prod-uuid-123",
            "similarity_score": 0.94,
            "authenticity_score": 95.2
        }
    ],
    "performance_metrics": {
        "analysis_duration_ms": 2847,
        "llm_model": "gpt-4",
        "llm_tokens_used": 1250
    },
    "created_at": "2025-01-20T10:16:15Z",
    "completed_at": "2025-01-20T10:16:18Z"
}
```

### Detection Rules Management

#### List Detection Rules
```http
GET /rules
Authorization: Bearer <jwt-token>
```

**Query Parameters:**
- `rule_type`: Filter by rule type (threshold, keyword, supplier, etc.)
- `active`: Filter by active status (true/false)
- `category`: Filter by product category

**Response (200 OK):**
```json
{
    "rules": [
        {
            "id": "rule-uuid-001",
            "name": "Low Score Auto-Flag",
            "rule_type": "threshold",
            "config": {
                "score_threshold": 30,
                "action": "flag"
            },
            "priority": 100,
            "active": true,
            "category": null,
            "created_at": "2025-01-15T09:00:00Z"
        }
    ],
    "total": 1,
    "page": 1,
    "limit": 50
}
```

#### Create Detection Rule
```http
POST /rules
Authorization: Bearer <jwt-token>
Content-Type: application/json
```

**Request Body:**
```json
{
    "name": "Keyword Blacklist",
    "rule_type": "keyword",
    "config": {
        "patterns": ["replica", "fake", "knockoff"],
        "case_sensitive": false,
        "action": "remove"
    },
    "priority": 90,
    "active": true,
    "category": "luxury_goods"
}
```

**Response (201 Created):**
```json
{
    "id": "rule-uuid-002",
    "name": "Keyword Blacklist",
    "rule_type": "keyword",
    "config": {
        "patterns": ["replica", "fake", "knockoff"],
        "case_sensitive": false,
        "action": "remove"
    },
    "priority": 90,
    "active": true,
    "category": "luxury_goods",
    "created_at": "2025-01-20T10:30:00Z"
}
```

### Enforcement Actions

#### List Enforcement Actions
```http
GET /enforcement/actions
Authorization: Bearer <jwt-token>
```

**Response (200 OK):**
```json
{
    "actions": [
        {
            "id": "action-uuid-001",
            "product_id": "prod-uuid-456",
            "action_type": "flag",
            "reason": "Low authenticity score (25.3)",
            "triggered_by": "rule",
            "rule_id": "rule-uuid-001",
            "reversed": false,
            "created_at": "2025-01-20T10:20:00Z"
        }
    ],
    "total": 1,
    "page": 1,
    "limit": 50
}
```

#### Reverse Enforcement Action
```http
POST /enforcement/actions/{action_id}/reverse
Authorization: Bearer <jwt-token>
```

**Request Body:**
```json
{
    "reason": "False positive - manual review confirmed authenticity"
}
```

### Admin Dashboard APIs

#### Get Dashboard Metrics
```http
GET /admin/dashboard/metrics
Authorization: Bearer <jwt-token>
```

**Query Parameters:**
- `time_range`: Period for metrics (1h, 24h, 7d, 30d)
- `category`: Filter by product category

**Response (200 OK):**
```json
{
    "time_range": "24h",
    "metrics": {
        "detection_metrics": {
            "total_products_analyzed": 1247,
            "authentic_products": 1089,
            "flagged_products": 158,
            "detection_rate": 87.3,
            "false_positive_rate": 3.2
        },
        "performance_metrics": {
            "avg_analysis_time_ms": 2340,
            "agent_uptime": 99.8,
            "vector_search_avg_time_ms": 245
        },
        "business_metrics": {
            "counterfeit_reduction": 52.1,
            "supplier_trust_score": 0.91
        }
    },
    "timestamp": "2025-01-20T10:30:00Z"
}
```

#### Get Agent Activity Logs
```http
GET /admin/agents/activities
Authorization: Bearer <jwt-token>
```

**Query Parameters:**
- `agent_id`: Filter by specific agent
- `agent_type`: Filter by agent type
- `status`: Filter by activity status
- `product_id`: Filter by product

**Response (200 OK):**
```json
{
    "activities": [
        {
            "id": "activity-uuid-001",
            "agent_id": "authenticity-analyzer-1",
            "agent_type": "authenticity_analyzer",
            "activity_type": "analysis",
            "product_id": "prod-uuid-456",
            "status": "completed",
            "duration_ms": 2847,
            "details": {
                "llm_model": "gpt-4",
                "tokens_used": 1250,
                "comparison_products_count": 5
            },
            "created_at": "2025-01-20T10:16:15Z"
        }
    ],
    "total": 1,
    "page": 1,
    "limit": 50
}
```

### Real-time Updates

#### WebSocket Connection
```http
GET /ws/dashboard
Upgrade: websocket
Authorization: Bearer <jwt-token>
```

**WebSocket Messages:**
```json
{
    "type": "product_analyzed",
    "data": {
        "product_id": "prod-uuid-456",
        "authenticity_score": 87.5,
        "status": "likely_authentic",
        "timestamp": "2025-01-20T10:16:18Z"
    }
}

{
    "type": "enforcement_action",
    "data": {
        "product_id": "prod-uuid-789",
        "action_type": "flag",
        "reason": "Low authenticity score",
        "timestamp": "2025-01-20T10:20:00Z"
    }
}

{
    "type": "agent_status",
    "data": {
        "agent_id": "authenticity-analyzer-1",
        "status": "active",
        "current_task": "analyzing_product_123",
        "timestamp": "2025-01-20T10:25:00Z"
    }
}
```

## Advanced Features (Epic 6)

### Brand Registration

#### Register Brand
```http
POST /brands/register
Authorization: Bearer <jwt-token>
Content-Type: multipart/form-data
```

**Request Body:**
```
name: "LuxuryBrand Official"
contact_email: "verification@luxurybrand.com"
verification_documents: [document1.pdf, document2.pdf]
```

#### Submit Official Product
```http
POST /brands/{brand_id}/products
Authorization: Bearer <jwt-token>
```

**Request Body:**
```json
{
    "official_name": "Signature Leather Handbag - Model SLH-2024",
    "official_description": "Authentic luxury handbag crafted from premium Italian leather...",
    "official_price": 899.99,
    "official_images": ["image1.jpg", "image2.jpg"],
    "zkproof_data": "serialized_zksnark_proof_string"
}
```

### zkSNARK Verification

#### Verify Product with zkProof
```http
POST /products/{product_id}/verify-proof
Authorization: Bearer <jwt-token>
```

**Request Body:**
```json
{
    "zkproof": "serialized_proof_data",
    "brand_id": "brand-uuid-123"
}
```

**Response (200 OK):**
```json
{
    "verification_result": "valid",
    "brand_verified": true,
    "proof_timestamp": "2025-01-20T10:30:00Z",
    "authenticity_boost": 15.2
}
```

## Error Handling

### Standard Error Format
```json
{
    "error": "error_code",
    "message": "Human-readable error message",
    "details": {},
    "timestamp": "2025-01-20T10:30:00Z",
    "request_id": "req-uuid-123"
}
```

### Common Error Codes
- **400**: `validation_error`, `invalid_request`
- **401**: `unauthorized`, `invalid_token`
- **403**: `forbidden`, `insufficient_permissions`
- **404**: `not_found`, `resource_not_found`
- **429**: `rate_limit_exceeded`
- **500**: `internal_error`, `service_unavailable`

## Rate Limiting

### Limits by Endpoint Type
- **Product ingestion**: 10 requests/minute
- **Analysis requests**: 20 requests/minute  
- **Dashboard queries**: 100 requests/minute
- **General API**: 100 requests/minute

### Rate Limit Headers
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1705745400
```

## Authentication

### JWT Token Format
```json
{
    "sub": "user-uuid-123",
    "role": "admin",
    "permissions": ["read:products", "write:products", "admin:dashboard"],
    "exp": 1705745400,
    "iat": 1705659000
}
```

### Permission Levels
- **`read:products`**: View product data
- **`write:products`**: Ingest and modify products
- **`read:analysis`**: View analysis results
- **`write:rules`**: Manage detection rules
- **`admin:dashboard`**: Access admin features
- **`admin:enforcement`**: Manage enforcement actions