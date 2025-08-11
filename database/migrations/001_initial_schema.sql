-- Initial database schema for counterfeit detection system
-- Compatible with TiDB Serverless

-- Enable foreign key checks
SET foreign_key_checks = 1;

-- Suppliers table
CREATE TABLE IF NOT EXISTS suppliers (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    contact_email VARCHAR(255),
    contact_phone VARCHAR(50),
    company_name VARCHAR(255),
    address TEXT,
    country VARCHAR(100),
    status ENUM('active', 'suspended', 'banned', 'pending_verification', 'verified') NOT NULL DEFAULT 'pending_verification',
    risk_score DECIMAL(3,2) DEFAULT 0.0,
    verification_documents JSON,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_supplier_status (status),
    INDEX idx_supplier_risk_score (risk_score),
    INDEX idx_supplier_country (country)
);

-- Products table with vector embedding support
CREATE TABLE IF NOT EXISTS products (
    id CHAR(36) PRIMARY KEY,
    description TEXT NOT NULL,
    category ENUM('electronics', 'clothing', 'accessories', 'shoes', 'bags', 'jewelry', 'watches', 'cosmetics', 'pharmaceuticals', 'automotive', 'sporting_goods', 'home_garden', 'toys', 'books', 'other') NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    brand VARCHAR(100),
    supplier_id CHAR(36) NOT NULL,
    image_urls JSON,
    thumbnail_urls JSON,
    
    -- Vector embeddings stored as JSON for TiDB compatibility
    description_embedding JSON COMMENT 'Vector(1536) for semantic search',
    image_embedding JSON COMMENT 'Vector(1536) for image similarity',
    
    -- Product metadata
    sku VARCHAR(100),
    upc VARCHAR(50),
    weight DECIMAL(8,3) COMMENT 'Weight in kg',
    dimensions JSON COMMENT '{"length": x, "width": y, "height": z}',
    manufacturer VARCHAR(255),
    country_of_origin VARCHAR(100),
    
    -- Status and tracking
    status ENUM('active', 'flagged', 'removed', 'pending_review', 'verified_authentic', 'confirmed_counterfeit') NOT NULL DEFAULT 'active',
    authenticity_score DECIMAL(3,2) COMMENT '0.0 to 1.0, null if not analyzed',
    confidence_score DECIMAL(3,2) COMMENT '0.0 to 1.0, confidence in authenticity_score',
    last_analyzed_at TIMESTAMP NULL,
    analysis_count INT DEFAULT 0,
    
    -- Additional fields
    external_product_id VARCHAR(255) COMMENT 'Original platform product ID',
    source_platform VARCHAR(100) COMMENT 'Where product was scraped/submitted from',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
    
    INDEX idx_product_status (status),
    INDEX idx_product_category (category),
    INDEX idx_product_brand (brand),
    INDEX idx_product_supplier (supplier_id),
    INDEX idx_product_authenticity (authenticity_score),
    INDEX idx_product_analyzed (last_analyzed_at),
    INDEX idx_product_external (external_product_id),
    
    CONSTRAINT chk_price_positive CHECK (price > 0),
    CONSTRAINT chk_authenticity_score CHECK (authenticity_score IS NULL OR (authenticity_score >= 0 AND authenticity_score <= 1)),
    CONSTRAINT chk_confidence_score CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1))
);

-- Analysis results table
CREATE TABLE IF NOT EXISTS analysis_results (
    id CHAR(36) PRIMARY KEY,
    product_id CHAR(36) NOT NULL,
    supplier_id CHAR(36) NOT NULL,
    
    -- Analysis metadata
    analysis_type VARCHAR(50) NOT NULL COMMENT 'llm, rule_based, image, hybrid',
    status ENUM('pending', 'in_progress', 'completed', 'failed', 'requires_manual_review') NOT NULL DEFAULT 'pending',
    
    -- Results
    authenticity_score DECIMAL(3,2) COMMENT '0.0 to 1.0',
    confidence_score DECIMAL(3,2) COMMENT '0.0 to 1.0',
    risk_factors JSON COMMENT 'Array of identified risk factors',
    evidence JSON COMMENT 'Supporting evidence for the analysis',
    
    -- Processing details
    processing_time_ms INT,
    model_version VARCHAR(100),
    agent_id VARCHAR(255) COMMENT 'ID of the agent that performed analysis',
    
    -- Human review
    requires_manual_review BOOLEAN DEFAULT FALSE,
    manual_review_notes TEXT,
    reviewed_by VARCHAR(255),
    reviewed_at TIMESTAMP NULL,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
    
    INDEX idx_analysis_product (product_id),
    INDEX idx_analysis_supplier (supplier_id),
    INDEX idx_analysis_type (analysis_type),
    INDEX idx_analysis_status (status),
    INDEX idx_analysis_score (authenticity_score),
    INDEX idx_analysis_manual_review (requires_manual_review),
    
    CONSTRAINT chk_analysis_authenticity_score CHECK (authenticity_score IS NULL OR (authenticity_score >= 0 AND authenticity_score <= 1)),
    CONSTRAINT chk_analysis_confidence_score CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1))
);

-- Alerts table
CREATE TABLE IF NOT EXISTS alerts (
    id CHAR(36) PRIMARY KEY,
    product_id CHAR(36) NOT NULL,
    analysis_result_id CHAR(36),
    
    -- Alert details
    title VARCHAR(255) NOT NULL,
    description TEXT,
    severity ENUM('low', 'medium', 'high', 'critical') NOT NULL,
    status ENUM('open', 'acknowledged', 'in_progress', 'resolved', 'closed', 'false_positive') NOT NULL DEFAULT 'open',
    
    -- Classification
    alert_type VARCHAR(100) NOT NULL COMMENT 'counterfeit_detected, suspicious_activity, etc.',
    risk_score DECIMAL(3,2) COMMENT '0.0 to 1.0',
    
    -- Actions and response
    recommended_action ENUM('none', 'warning', 'product_removal', 'supplier_suspension', 'account_ban', 'legal_notice', 'platform_removal'),
    action_taken ENUM('none', 'warning', 'product_removal', 'supplier_suspension', 'account_ban', 'legal_notice', 'platform_removal'),
    action_taken_at TIMESTAMP NULL,
    action_taken_by VARCHAR(255),
    
    -- Assignment and handling
    assigned_to VARCHAR(255),
    assigned_at TIMESTAMP NULL,
    resolved_at TIMESTAMP NULL,
    resolution_notes TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (analysis_result_id) REFERENCES analysis_results(id) ON DELETE SET NULL,
    
    INDEX idx_alert_product (product_id),
    INDEX idx_alert_severity (severity),
    INDEX idx_alert_status (status),
    INDEX idx_alert_type (alert_type),
    INDEX idx_alert_assigned (assigned_to),
    INDEX idx_alert_risk_score (risk_score),
    
    CONSTRAINT chk_alert_risk_score CHECK (risk_score IS NULL OR (risk_score >= 0 AND risk_score <= 1))
);

-- Notification logs table
CREATE TABLE IF NOT EXISTS notification_logs (
    id CHAR(36) PRIMARY KEY,
    alert_id CHAR(36),
    
    -- Notification details
    notification_type ENUM('email', 'sms', 'webhook', 'in_app', 'slack', 'teams') NOT NULL,
    recipient VARCHAR(255) NOT NULL,
    subject VARCHAR(500),
    message TEXT,
    
    -- Delivery tracking
    sent_at TIMESTAMP NULL,
    delivered_at TIMESTAMP NULL,
    failed_at TIMESTAMP NULL,
    failure_reason TEXT,
    retry_count INT DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (alert_id) REFERENCES alerts(id) ON DELETE SET NULL,
    
    INDEX idx_notification_alert (alert_id),
    INDEX idx_notification_type (notification_type),
    INDEX idx_notification_recipient (recipient),
    INDEX idx_notification_sent (sent_at)
);

-- Users table for authentication and authorization
CREATE TABLE IF NOT EXISTS users (
    id CHAR(36) PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    
    -- Profile information
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    role ENUM('admin', 'moderator', 'analyst', 'viewer', 'api_user') NOT NULL DEFAULT 'viewer',
    
    -- Account status
    is_active BOOLEAN DEFAULT TRUE,
    is_verified BOOLEAN DEFAULT FALSE,
    last_login_at TIMESTAMP NULL,
    failed_login_attempts INT DEFAULT 0,
    locked_until TIMESTAMP NULL,
    
    -- API access
    api_key_hash VARCHAR(255),
    api_key_created_at TIMESTAMP NULL,
    api_rate_limit INT DEFAULT 1000 COMMENT 'requests per hour',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_user_email (email),
    INDEX idx_user_username (username),
    INDEX idx_user_role (role),
    INDEX idx_user_active (is_active)
);

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36),
    
    -- Action details
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100),
    resource_id VARCHAR(255),
    
    -- Request details
    ip_address VARCHAR(45) COMMENT 'IPv6 compatible',
    user_agent VARCHAR(500),
    
    -- Change tracking
    old_values JSON,
    new_values JSON,
    
    -- Additional context
    notes TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    
    INDEX idx_audit_user (user_id),
    INDEX idx_audit_action (action),
    INDEX idx_audit_resource (resource_type, resource_id),
    INDEX idx_audit_created (created_at)
);

-- Insert initial admin user (password: 'admin123' - should be changed in production)
INSERT INTO users (id, username, email, password_hash, first_name, last_name, role, is_active, is_verified) 
VALUES (
    UUID(),
    'admin',
    'admin@counterfeit-detection.com',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LdWgPnfOKsqMWpQz6', -- bcrypt hash of 'admin123'
    'System',
    'Administrator',
    'admin',
    TRUE,
    TRUE
) ON DUPLICATE KEY UPDATE id=id;

-- Insert test supplier for development
INSERT INTO suppliers (id, name, contact_email, company_name, status) 
VALUES (
    UUID(),
    'Test Supplier Ltd',
    'contact@testsupplier.com',
    'Test Supplier Limited',
    'verified'
) ON DUPLICATE KEY UPDATE id=id;