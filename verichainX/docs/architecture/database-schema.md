# Database Schema Architecture

## Overview
TiDB Serverless database schema for the Counterfeit Product Detection system with support for both relational and vector data.

## Core Tables

### products
Primary table for storing product metadata and embeddings.

```sql
CREATE TABLE products (
    id VARCHAR(36) PRIMARY KEY,  -- UUID
    description TEXT NOT NULL,
    category VARCHAR(100),
    price DECIMAL(10,2),
    brand VARCHAR(100),
    supplier_id VARCHAR(36),
    image_urls JSON,  -- Array of image URLs
    
    -- Vector embeddings (1536 dimensions for OpenAI embeddings)
    description_embedding VECTOR(1536),
    image_embedding VECTOR(1536),
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    status ENUM('active', 'flagged', 'removed') DEFAULT 'active',
    
    -- Indexes
    INDEX idx_category (category),
    INDEX idx_brand (brand),
    INDEX idx_supplier (supplier_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at),
    
    -- Vector indexes for similarity search
    VECTOR INDEX idx_description_vector (description_embedding),
    VECTOR INDEX idx_image_vector (image_embedding)
);
```

### suppliers
Information about product suppliers and their reputation.

```sql
CREATE TABLE suppliers (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    contact_email VARCHAR(255),
    reputation_score DECIMAL(3,2) DEFAULT 0.00,  -- 0.00-1.00
    total_products INT DEFAULT 0,
    flagged_products INT DEFAULT 0,
    verified BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_reputation (reputation_score),
    INDEX idx_verified (verified)
);
```

### authenticity_analyses
Results from LLM authenticity analysis.

```sql
CREATE TABLE authenticity_analyses (
    id VARCHAR(36) PRIMARY KEY,
    product_id VARCHAR(36) NOT NULL,
    agent_id VARCHAR(100) NOT NULL,  -- Which agent performed analysis
    
    -- Analysis results
    authenticity_score DECIMAL(5,2) NOT NULL,  -- 0.00-100.00
    confidence_score DECIMAL(3,2) NOT NULL,    -- 0.00-1.00
    reasoning TEXT,
    comparison_products JSON,  -- Array of similar product IDs used for comparison
    
    -- Performance metrics
    analysis_duration_ms INT,
    llm_model VARCHAR(50),
    llm_tokens_used INT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    INDEX idx_product_id (product_id),
    INDEX idx_authenticity_score (authenticity_score),
    INDEX idx_created_at (created_at)
);
```

### detection_rules
Configurable rules for authenticity detection.

```sql
CREATE TABLE detection_rules (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    rule_type ENUM('threshold', 'keyword', 'supplier', 'price_anomaly', 'brand_verification') NOT NULL,
    
    -- Rule configuration (JSON for flexibility)
    config JSON NOT NULL,
    -- Example configs:
    -- threshold: {"score_threshold": 70, "action": "flag"}
    -- keyword: {"patterns": ["replica", "fake"], "action": "remove"}
    -- supplier: {"blacklist": ["supplier_id_1"], "action": "flag"}
    
    priority INT DEFAULT 100,  -- Higher number = higher priority
    active BOOLEAN DEFAULT TRUE,
    category VARCHAR(100),  -- Apply rule only to specific categories
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_rule_type (rule_type),
    INDEX idx_active (active),
    INDEX idx_priority (priority),
    INDEX idx_category (category)
);
```

### enforcement_actions
Track enforcement actions taken on products.

```sql
CREATE TABLE enforcement_actions (
    id VARCHAR(36) PRIMARY KEY,
    product_id VARCHAR(36) NOT NULL,
    rule_id VARCHAR(36),  -- NULL if manual action
    
    action_type ENUM('flag', 'pause', 'remove', 'warn', 'restore') NOT NULL,
    reason TEXT,
    triggered_by ENUM('rule', 'manual', 'agent') NOT NULL,
    triggered_by_user VARCHAR(100),  -- User ID if manual
    
    -- Reversal tracking
    reversed BOOLEAN DEFAULT FALSE,
    reversed_at TIMESTAMP NULL,
    reversed_by VARCHAR(100),
    reversal_reason TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (rule_id) REFERENCES detection_rules(id) ON DELETE SET NULL,
    
    INDEX idx_product_id (product_id),
    INDEX idx_action_type (action_type),
    INDEX idx_triggered_by (triggered_by),
    INDEX idx_created_at (created_at)
);
```

### agent_activities
Log of all agent activities for monitoring and debugging.

```sql
CREATE TABLE agent_activities (
    id VARCHAR(36) PRIMARY KEY,
    agent_id VARCHAR(100) NOT NULL,
    agent_type VARCHAR(50) NOT NULL,  -- 'authenticity_analyzer', 'orchestrator', etc.
    
    activity_type VARCHAR(50) NOT NULL,  -- 'analysis', 'communication', 'error', etc.
    product_id VARCHAR(36),  -- NULL if not product-specific
    
    -- Activity details
    status ENUM('started', 'completed', 'failed') NOT NULL,
    duration_ms INT,
    details JSON,  -- Flexible storage for activity-specific data
    error_message TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_agent_id (agent_id),
    INDEX idx_agent_type (agent_type),
    INDEX idx_activity_type (activity_type),
    INDEX idx_product_id (product_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
);
```

### notifications
Alert notifications sent to users.

```sql
CREATE TABLE notifications (
    id VARCHAR(36) PRIMARY KEY,
    product_id VARCHAR(36) NOT NULL,
    notification_type ENUM('slack', 'email', 'webhook') NOT NULL,
    
    recipient VARCHAR(255) NOT NULL,  -- email, slack channel, webhook URL
    subject VARCHAR(255),
    message TEXT NOT NULL,
    
    -- Delivery tracking
    status ENUM('pending', 'sent', 'failed', 'delivered') DEFAULT 'pending',
    sent_at TIMESTAMP NULL,
    delivered_at TIMESTAMP NULL,
    error_message TEXT,
    retry_count INT DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    
    INDEX idx_product_id (product_id),
    INDEX idx_notification_type (notification_type),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
);
```

## Advanced Tables (Epic 6)

### brands
Verified brand information for zkSNARK verification.

```sql
CREATE TABLE brands (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(200) NOT NULL UNIQUE,
    contact_email VARCHAR(255) NOT NULL,
    verification_status ENUM('pending', 'verified', 'rejected') DEFAULT 'pending',
    
    -- Brand verification documents
    verification_documents JSON,  -- URLs to uploaded documents
    verified_at TIMESTAMP NULL,
    verified_by VARCHAR(100),
    
    -- zkSNARK proof information
    public_key TEXT,  -- For zkSNARK verification
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_verification_status (verification_status),
    INDEX idx_name (name)
);
```

### brand_products
Official product catalog from verified brands.

```sql
CREATE TABLE brand_products (
    id VARCHAR(36) PRIMARY KEY,
    brand_id VARCHAR(36) NOT NULL,
    
    -- Official product information
    official_name VARCHAR(300) NOT NULL,
    official_description TEXT NOT NULL,
    official_price DECIMAL(10,2),
    official_images JSON,  -- Array of official image URLs
    
    -- zkSNARK proof
    zkproof_data TEXT,  -- Serialized zkSNARK proof
    proof_verified BOOLEAN DEFAULT FALSE,
    
    -- Vector embeddings for official products
    description_embedding VECTOR(1536),
    image_embedding VECTOR(1536),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
    
    INDEX idx_brand_id (brand_id),
    INDEX idx_proof_verified (proof_verified),
    VECTOR INDEX idx_official_description_vector (description_embedding),
    VECTOR INDEX idx_official_image_vector (image_embedding)
);
```

## Relationships and Constraints

### Key Relationships
- `products.supplier_id` → `suppliers.id`
- `authenticity_analyses.product_id` → `products.id`
- `enforcement_actions.product_id` → `products.id`
- `enforcement_actions.rule_id` → `detection_rules.id`
- `notifications.product_id` → `products.id`
- `brand_products.brand_id` → `brands.id`

### Performance Considerations
- Vector indexes for similarity search on embeddings
- Composite indexes for common query patterns
- Partitioning by date for large tables (agent_activities, notifications)
- Connection pooling for high concurrency

### Data Retention
- `agent_activities`: 90 days (configurable)
- `notifications`: 365 days
- `authenticity_analyses`: Permanent (for ML model training)
- All other tables: Permanent unless manually archived