-- Migration 002: Add vector indexes for improved similarity search performance
-- This migration adds TiDB vector indexes for the embedding columns

-- Vector indexes for improved similarity search performance
-- Note: TiDB vector index syntax may vary depending on version
-- These are placeholder indexes that would be created when TiDB fully supports vector indexes

-- Create index on description embeddings for text similarity search
-- ALTER TABLE products ADD VECTOR INDEX idx_description_vector (description_embedding);

-- Create index on image embeddings for image similarity search  
-- ALTER TABLE products ADD VECTOR INDEX idx_image_vector (image_embedding);

-- For now, we create regular indexes on related columns that are used in filtering
CREATE INDEX IF NOT EXISTS idx_products_category_status ON products (category, status);
CREATE INDEX IF NOT EXISTS idx_products_supplier_status ON products (supplier_id, status);
CREATE INDEX IF NOT EXISTS idx_products_price_category ON products (price, category);
CREATE INDEX IF NOT EXISTS idx_products_brand_category ON products (brand, category);
CREATE INDEX IF NOT EXISTS idx_products_authenticity_score ON products (authenticity_score);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products (created_at);

-- Composite index for common filter combinations
CREATE INDEX IF NOT EXISTS idx_products_category_supplier_status ON products (category, supplier_id, status);

-- Index for products with embeddings (for statistics and coverage queries)
CREATE INDEX IF NOT EXISTS idx_products_with_embeddings ON products (
    (CASE WHEN description_embedding IS NOT NULL THEN 1 ELSE 0 END),
    (CASE WHEN image_embedding IS NOT NULL THEN 1 ELSE 0 END)
);

-- Add comments to document the vector embedding columns
ALTER TABLE products MODIFY COLUMN description_embedding JSON COMMENT 'Text embedding vector (1536-dim) stored as JSON for TiDB compatibility';
ALTER TABLE products MODIFY COLUMN image_embedding JSON COMMENT 'Image embedding vector (512-dim) stored as JSON for TiDB compatibility';