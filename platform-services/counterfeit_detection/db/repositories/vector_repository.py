"""
Vector repository for similarity search operations using TiDB vector capabilities.
"""

import json
from typing import List, Optional, Dict, Any, Tuple
from uuid import UUID
from decimal import Decimal

from sqlalchemy import text, select, and_
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from ...models.database import Product
from ...models.enums import ProductCategory, ProductStatus


class VectorRepository:
    """Repository for vector similarity search operations."""
    
    def __init__(self, session: AsyncSession):
        self.session = session
        self.logger = structlog.get_logger(component="vector_repository")
    
    async def find_similar_products_by_text(
        self,
        query_embedding: List[float],
        category: Optional[ProductCategory] = None,
        supplier_id: Optional[UUID] = None,
        price_min: Optional[Decimal] = None,
        price_max: Optional[Decimal] = None,
        status: Optional[ProductStatus] = None,
        limit: int = 10,
        similarity_threshold: float = 0.7
    ) -> List[Dict[str, Any]]:
        """
        Find similar products based on text embedding using cosine similarity.
        
        Args:
            query_embedding: 1536-dimensional query vector
            category: Optional product category filter
            supplier_id: Optional supplier filter
            price_min: Optional minimum price filter
            price_max: Optional maximum price filter
            status: Optional product status filter
            limit: Maximum number of results
            similarity_threshold: Minimum similarity score (0.0-1.0)
            
        Returns:
            List of similar products with similarity scores
        """
        try:
            # Build WHERE clause conditions
            conditions = ["description_embedding IS NOT NULL"]
            params = {
                "query_embedding": json.dumps(query_embedding),
                "threshold": similarity_threshold,
                "limit": limit
            }
            
            if category:
                conditions.append("category = :category")
                params["category"] = category.value
            
            if supplier_id:
                conditions.append("supplier_id = :supplier_id")
                params["supplier_id"] = str(supplier_id)
            
            if price_min is not None:
                conditions.append("price >= :price_min")
                params["price_min"] = price_min
            
            if price_max is not None:
                conditions.append("price <= :price_max")
                params["price_max"] = price_max
            
            if status:
                conditions.append("status = :status")
                params["status"] = status.value
            
            where_clause = " AND ".join(conditions)
            
            # TiDB vector similarity query using cosine distance
            # Note: TiDB uses <=> operator for cosine distance (0 = identical, 2 = opposite)
            # Similarity score = 1 - (distance / 2)
            query = text(f"""
                SELECT 
                    id,
                    description,
                    category,
                    price,
                    brand,
                    supplier_id,
                    image_urls,
                    thumbnail_urls,
                    status,
                    authenticity_score,
                    created_at,
                    1 - (JSON_EXTRACT(description_embedding, '$') <=> JSON_EXTRACT(:query_embedding, '$')) / 2 as similarity_score
                FROM products 
                WHERE {where_clause}
                  AND 1 - (JSON_EXTRACT(description_embedding, '$') <=> JSON_EXTRACT(:query_embedding, '$')) / 2 > :threshold
                ORDER BY JSON_EXTRACT(description_embedding, '$') <=> JSON_EXTRACT(:query_embedding, '$')
                LIMIT :limit
            """)
            
            result = await self.session.execute(query, params)
            rows = result.fetchall()
            
            # Convert to dictionaries
            similar_products = []
            for row in rows:
                similar_products.append({
                    "product_id": row.id,
                    "description": row.description,
                    "category": row.category,
                    "price": float(row.price) if row.price else None,
                    "brand": row.brand,
                    "supplier_id": row.supplier_id,
                    "image_urls": row.image_urls,
                    "thumbnail_urls": row.thumbnail_urls,
                    "status": row.status,
                    "authenticity_score": float(row.authenticity_score) if row.authenticity_score else None,
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                    "similarity_score": float(row.similarity_score)
                })
            
            self.logger.info(
                "Text similarity search completed",
                query_dimension=len(query_embedding),
                results_count=len(similar_products),
                threshold=similarity_threshold,
                filters={
                    "category": category.value if category else None,
                    "supplier_id": str(supplier_id) if supplier_id else None,
                    "price_range": f"{price_min}-{price_max}" if price_min or price_max else None
                }
            )
            
            return similar_products
            
        except Exception as e:
            self.logger.error(
                "Failed to perform text similarity search",
                error=str(e),
                query_dimension=len(query_embedding)
            )
            raise
    
    async def find_similar_products_by_image(
        self,
        query_embedding: List[float],
        category: Optional[ProductCategory] = None,
        supplier_id: Optional[UUID] = None,
        price_min: Optional[Decimal] = None,
        price_max: Optional[Decimal] = None,
        status: Optional[ProductStatus] = None,
        limit: int = 10,
        similarity_threshold: float = 0.7
    ) -> List[Dict[str, Any]]:
        """
        Find similar products based on image embedding using cosine similarity.
        
        Args:
            query_embedding: 512-dimensional image query vector
            category: Optional product category filter
            supplier_id: Optional supplier filter
            price_min: Optional minimum price filter
            price_max: Optional maximum price filter
            status: Optional product status filter
            limit: Maximum number of results
            similarity_threshold: Minimum similarity score (0.0-1.0)
            
        Returns:
            List of similar products with similarity scores
        """
        try:
            # Build WHERE clause conditions
            conditions = ["image_embedding IS NOT NULL"]
            params = {
                "query_embedding": json.dumps(query_embedding),
                "threshold": similarity_threshold,
                "limit": limit
            }
            
            if category:
                conditions.append("category = :category")
                params["category"] = category.value
            
            if supplier_id:
                conditions.append("supplier_id = :supplier_id")
                params["supplier_id"] = str(supplier_id)
            
            if price_min is not None:
                conditions.append("price >= :price_min")
                params["price_min"] = price_min
            
            if price_max is not None:
                conditions.append("price <= :price_max")
                params["price_max"] = price_max
            
            if status:
                conditions.append("status = :status")
                params["status"] = status.value
            
            where_clause = " AND ".join(conditions)
            
            # TiDB vector similarity query for image embeddings
            query = text(f"""
                SELECT 
                    id,
                    description,
                    category,
                    price,
                    brand,
                    supplier_id,
                    image_urls,
                    thumbnail_urls,
                    status,
                    authenticity_score,
                    created_at,
                    1 - (JSON_EXTRACT(image_embedding, '$') <=> JSON_EXTRACT(:query_embedding, '$')) / 2 as similarity_score
                FROM products 
                WHERE {where_clause}
                  AND 1 - (JSON_EXTRACT(image_embedding, '$') <=> JSON_EXTRACT(:query_embedding, '$')) / 2 > :threshold
                ORDER BY JSON_EXTRACT(image_embedding, '$') <=> JSON_EXTRACT(:query_embedding, '$')
                LIMIT :limit
            """)
            
            result = await self.session.execute(query, params)
            rows = result.fetchall()
            
            # Convert to dictionaries
            similar_products = []
            for row in rows:
                similar_products.append({
                    "product_id": row.id,
                    "description": row.description,
                    "category": row.category,
                    "price": float(row.price) if row.price else None,
                    "brand": row.brand,
                    "supplier_id": row.supplier_id,
                    "image_urls": row.image_urls,
                    "thumbnail_urls": row.thumbnail_urls,
                    "status": row.status,
                    "authenticity_score": float(row.authenticity_score) if row.authenticity_score else None,
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                    "similarity_score": float(row.similarity_score)
                })
            
            self.logger.info(
                "Image similarity search completed",
                query_dimension=len(query_embedding),
                results_count=len(similar_products),
                threshold=similarity_threshold
            )
            
            return similar_products
            
        except Exception as e:
            self.logger.error(
                "Failed to perform image similarity search",
                error=str(e),
                query_dimension=len(query_embedding)
            )
            raise
    
    async def find_hybrid_similar_products(
        self,
        text_embedding: List[float],
        image_embedding: List[float],
        text_weight: float = 0.7,
        image_weight: float = 0.3,
        category: Optional[ProductCategory] = None,
        supplier_id: Optional[UUID] = None,
        price_min: Optional[Decimal] = None,
        price_max: Optional[Decimal] = None,
        status: Optional[ProductStatus] = None,
        limit: int = 10,
        similarity_threshold: float = 0.7
    ) -> List[Dict[str, Any]]:
        """
        Find similar products using hybrid text + image similarity search.
        
        Args:
            text_embedding: 1536-dimensional text query vector
            image_embedding: 512-dimensional image query vector
            text_weight: Weight for text similarity (0.0-1.0)
            image_weight: Weight for image similarity (0.0-1.0)
            category: Optional product category filter
            supplier_id: Optional supplier filter
            price_min: Optional minimum price filter
            price_max: Optional maximum price filter
            status: Optional product status filter
            limit: Maximum number of results
            similarity_threshold: Minimum combined similarity score (0.0-1.0)
            
        Returns:
            List of similar products with combined similarity scores
        """
        try:
            # Normalize weights
            total_weight = text_weight + image_weight
            if total_weight > 0:
                text_weight = text_weight / total_weight
                image_weight = image_weight / total_weight
            
            # Build WHERE clause conditions
            conditions = [
                "description_embedding IS NOT NULL",
                "image_embedding IS NOT NULL"
            ]
            params = {
                "text_embedding": json.dumps(text_embedding),
                "image_embedding": json.dumps(image_embedding),
                "text_weight": text_weight,
                "image_weight": image_weight,
                "threshold": similarity_threshold,
                "limit": limit
            }
            
            if category:
                conditions.append("category = :category")
                params["category"] = category.value
            
            if supplier_id:
                conditions.append("supplier_id = :supplier_id")
                params["supplier_id"] = str(supplier_id)
            
            if price_min is not None:
                conditions.append("price >= :price_min")
                params["price_min"] = price_min
            
            if price_max is not None:
                conditions.append("price <= :price_max")
                params["price_max"] = price_max
            
            if status:
                conditions.append("status = :status")
                params["status"] = status.value
            
            where_clause = " AND ".join(conditions)
            
            # Hybrid similarity query combining text and image similarities
            query = text(f"""
                SELECT 
                    id,
                    description,
                    category,
                    price,
                    brand,
                    supplier_id,
                    image_urls,
                    thumbnail_urls,
                    status,
                    authenticity_score,
                    created_at,
                    (
                        :text_weight * (1 - (JSON_EXTRACT(description_embedding, '$') <=> JSON_EXTRACT(:text_embedding, '$')) / 2) +
                        :image_weight * (1 - (JSON_EXTRACT(image_embedding, '$') <=> JSON_EXTRACT(:image_embedding, '$')) / 2)
                    ) as combined_similarity_score,
                    (1 - (JSON_EXTRACT(description_embedding, '$') <=> JSON_EXTRACT(:text_embedding, '$')) / 2) as text_similarity,
                    (1 - (JSON_EXTRACT(image_embedding, '$') <=> JSON_EXTRACT(:image_embedding, '$')) / 2) as image_similarity
                FROM products 
                WHERE {where_clause}
                  AND (
                      :text_weight * (1 - (JSON_EXTRACT(description_embedding, '$') <=> JSON_EXTRACT(:text_embedding, '$')) / 2) +
                      :image_weight * (1 - (JSON_EXTRACT(image_embedding, '$') <=> JSON_EXTRACT(:image_embedding, '$')) / 2)
                  ) > :threshold
                ORDER BY combined_similarity_score DESC
                LIMIT :limit
            """)
            
            result = await self.session.execute(query, params)
            rows = result.fetchall()
            
            # Convert to dictionaries
            similar_products = []
            for row in rows:
                similar_products.append({
                    "product_id": row.id,
                    "description": row.description,
                    "category": row.category,
                    "price": float(row.price) if row.price else None,
                    "brand": row.brand,
                    "supplier_id": row.supplier_id,
                    "image_urls": row.image_urls,
                    "thumbnail_urls": row.thumbnail_urls,
                    "status": row.status,
                    "authenticity_score": float(row.authenticity_score) if row.authenticity_score else None,
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                    "combined_similarity_score": float(row.combined_similarity_score),
                    "text_similarity": float(row.text_similarity),
                    "image_similarity": float(row.image_similarity)
                })
            
            self.logger.info(
                "Hybrid similarity search completed",
                text_dimension=len(text_embedding),
                image_dimension=len(image_embedding),
                text_weight=text_weight,
                image_weight=image_weight,
                results_count=len(similar_products),
                threshold=similarity_threshold
            )
            
            return similar_products
            
        except Exception as e:
            self.logger.error(
                "Failed to perform hybrid similarity search",
                error=str(e),
                text_dimension=len(text_embedding),
                image_dimension=len(image_embedding)
            )
            raise
    
    async def get_vector_statistics(self) -> Dict[str, Any]:
        """
        Get statistics about vector embeddings in the database.
        
        Returns:
            Dictionary containing embedding statistics
        """
        try:
            stats_query = text("""
                SELECT 
                    COUNT(*) as total_products,
                    COUNT(description_embedding) as products_with_text_embeddings,
                    COUNT(image_embedding) as products_with_image_embeddings,
                    COUNT(CASE WHEN description_embedding IS NOT NULL AND image_embedding IS NOT NULL THEN 1 END) as products_with_both_embeddings,
                    AVG(authenticity_score) as avg_authenticity_score
                FROM products
            """)
            
            result = await self.session.execute(stats_query)
            row = result.fetchone()
            
            stats = {
                "total_products": row.total_products,
                "products_with_text_embeddings": row.products_with_text_embeddings,
                "products_with_image_embeddings": row.products_with_image_embeddings,
                "products_with_both_embeddings": row.products_with_both_embeddings,
                "text_embedding_coverage": (row.products_with_text_embeddings / row.total_products * 100) if row.total_products > 0 else 0,
                "image_embedding_coverage": (row.products_with_image_embeddings / row.total_products * 100) if row.total_products > 0 else 0,
                "hybrid_search_coverage": (row.products_with_both_embeddings / row.total_products * 100) if row.total_products > 0 else 0,
                "avg_authenticity_score": float(row.avg_authenticity_score) if row.avg_authenticity_score else None
            }
            
            self.logger.info("Vector statistics retrieved", **stats)
            return stats
            
        except Exception as e:
            self.logger.error("Failed to get vector statistics", error=str(e))
            raise
    
    async def create_vector_indexes(self) -> None:
        """
        Create vector indexes for improved similarity search performance.
        Note: This would require TiDB vector index support.
        """
        try:
            # Note: TiDB vector indexes syntax may vary
            # This is a placeholder for when TiDB fully supports vector indexes
            index_queries = [
                "-- CREATE VECTOR INDEX idx_description_vector ON products (description_embedding)",
                "-- CREATE VECTOR INDEX idx_image_vector ON products (image_embedding)"
            ]
            
            self.logger.info("Vector index creation skipped (TiDB vector indexes not yet supported)")
            
        except Exception as e:
            self.logger.error("Failed to create vector indexes", error=str(e))
            raise