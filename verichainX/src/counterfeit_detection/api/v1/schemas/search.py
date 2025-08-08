"""
Pydantic schemas for vector search API endpoints.
"""

from typing import List, Optional, Dict, Any
from uuid import UUID
from decimal import Decimal
from datetime import datetime

from pydantic import BaseModel, Field, validator

from ...models.enums import ProductCategory, ProductStatus


class TextSimilarityRequest(BaseModel):
    """Request model for text-based similarity search."""
    
    query_text: str = Field(
        ..., 
        min_length=10, 
        max_length=2000,
        description="Text description to find similar products"
    )
    category: Optional[ProductCategory] = Field(
        None,
        description="Filter results by product category"
    )
    supplier_id: Optional[UUID] = Field(
        None,
        description="Filter results by supplier ID"
    )
    price_min: Optional[Decimal] = Field(
        None,
        ge=0,
        description="Minimum price filter"
    )
    price_max: Optional[Decimal] = Field(
        None,
        ge=0,
        description="Maximum price filter"
    )
    status: Optional[ProductStatus] = Field(
        None,
        description="Filter results by product status"
    )
    limit: int = Field(
        10,
        ge=1,
        le=50,
        description="Maximum number of results to return"
    )
    similarity_threshold: float = Field(
        0.7,
        ge=0.0,
        le=1.0,
        description="Minimum similarity score (0.0-1.0)"
    )
    
    @validator('price_max')
    def validate_price_range(cls, v, values):
        if v is not None and 'price_min' in values and values['price_min'] is not None:
            if v < values['price_min']:
                raise ValueError('price_max must be greater than or equal to price_min')
        return v


class ImageSimilarityRequest(BaseModel):
    """Request model for image-based similarity search."""
    
    category: Optional[ProductCategory] = Field(
        None,
        description="Filter results by product category"
    )
    supplier_id: Optional[UUID] = Field(
        None,
        description="Filter results by supplier ID"
    )
    price_min: Optional[Decimal] = Field(
        None,
        ge=0,
        description="Minimum price filter"
    )
    price_max: Optional[Decimal] = Field(
        None,
        ge=0,
        description="Maximum price filter"
    )
    status: Optional[ProductStatus] = Field(
        None,
        description="Filter results by product status"
    )
    limit: int = Field(
        10,
        ge=1,
        le=50,
        description="Maximum number of results to return"
    )
    similarity_threshold: float = Field(
        0.7,
        ge=0.0,
        le=1.0,
        description="Minimum similarity score (0.0-1.0)"
    )
    
    @validator('price_max')
    def validate_price_range(cls, v, values):
        if v is not None and 'price_min' in values and values['price_min'] is not None:
            if v < values['price_min']:
                raise ValueError('price_max must be greater than or equal to price_min')
        return v


class HybridSimilarityRequest(BaseModel):
    """Request model for hybrid text+image similarity search."""
    
    query_text: str = Field(
        ..., 
        min_length=10, 
        max_length=2000,
        description="Text description to find similar products"
    )
    text_weight: float = Field(
        0.7,
        ge=0.0,
        le=1.0,
        description="Weight for text similarity (0.0-1.0)"
    )
    image_weight: float = Field(
        0.3,
        ge=0.0,
        le=1.0,
        description="Weight for image similarity (0.0-1.0)"
    )
    category: Optional[ProductCategory] = Field(
        None,
        description="Filter results by product category"
    )
    supplier_id: Optional[UUID] = Field(
        None,
        description="Filter results by supplier ID"
    )
    price_min: Optional[Decimal] = Field(
        None,
        ge=0,
        description="Minimum price filter"
    )
    price_max: Optional[Decimal] = Field(
        None,
        ge=0,
        description="Maximum price filter"
    )
    status: Optional[ProductStatus] = Field(
        None,
        description="Filter results by product status"
    )
    limit: int = Field(
        10,
        ge=1,
        le=50,
        description="Maximum number of results to return"
    )
    similarity_threshold: float = Field(
        0.7,
        ge=0.0,
        le=1.0,
        description="Minimum similarity score (0.0-1.0)"
    )
    
    @validator('image_weight')
    def validate_weights_sum(cls, v, values):
        if 'text_weight' in values:
            total_weight = v + values['text_weight']
            if abs(total_weight - 1.0) > 0.001:
                raise ValueError('text_weight and image_weight must sum to 1.0')
        return v
    
    @validator('price_max')
    def validate_price_range(cls, v, values):
        if v is not None and 'price_min' in values and values['price_min'] is not None:
            if v < values['price_min']:
                raise ValueError('price_max must be greater than or equal to price_min')
        return v


class SimilarProduct(BaseModel):
    """Model for a similar product in search results."""
    
    product_id: UUID = Field(..., description="Unique product identifier")
    description: str = Field(..., description="Product description")
    category: ProductCategory = Field(..., description="Product category")
    price: Optional[float] = Field(None, description="Product price")
    brand: Optional[str] = Field(None, description="Product brand")
    supplier_id: UUID = Field(..., description="Supplier identifier")
    image_urls: List[str] = Field(default_factory=list, description="Product image URLs")
    thumbnail_urls: List[str] = Field(default_factory=list, description="Product thumbnail URLs")
    status: ProductStatus = Field(..., description="Product status")
    authenticity_score: Optional[float] = Field(
        None, 
        ge=0.0, 
        le=1.0,
        description="Authenticity score (0.0-1.0)"
    )
    created_at: Optional[str] = Field(None, description="Product creation timestamp")
    similarity_score: float = Field(
        ..., 
        ge=0.0, 
        le=1.0,
        description="Similarity score to query (0.0-1.0)"
    )
    
    class Config:
        use_enum_values = True


class SimilarProductsResponse(BaseModel):
    """Response model for similarity search results."""
    
    similar_products: List[SimilarProduct] = Field(
        ...,
        description="List of similar products found"
    )
    query_type: str = Field(
        ...,
        description="Type of similarity search performed (text, image, hybrid)"
    )
    total_matches: int = Field(
        ...,
        ge=0,
        description="Total number of products found"
    )
    query_time_ms: float = Field(
        ...,
        ge=0,
        description="Query execution time in milliseconds"
    )
    search_parameters: Dict[str, Any] = Field(
        ...,
        description="Parameters used for the search"
    )
    
    class Config:
        schema_extra = {
            "example": {
                "similar_products": [
                    {
                        "product_id": "550e8400-e29b-41d4-a716-446655440000",
                        "description": "High-quality leather handbag with gold hardware",
                        "category": "bags",
                        "price": 299.99,
                        "brand": "LuxuryBrand",
                        "supplier_id": "550e8400-e29b-41d4-a716-446655440001",
                        "image_urls": ["https://example.com/image1.jpg"],
                        "thumbnail_urls": ["https://example.com/thumb1.jpg"],
                        "status": "active",
                        "authenticity_score": 0.95,
                        "created_at": "2024-01-15T10:30:00Z",
                        "similarity_score": 0.94
                    }
                ],
                "query_type": "text",
                "total_matches": 1,
                "query_time_ms": 245.7,
                "search_parameters": {
                    "query_text": "luxury leather handbag",
                    "similarity_threshold": 0.7,
                    "category": "bags"
                }
            }
        }


class VectorSearchStats(BaseModel):
    """Statistics about vector search capabilities."""
    
    total_products: int = Field(
        ...,
        ge=0,
        description="Total number of products in database"
    )
    products_with_text_embeddings: int = Field(
        ...,
        ge=0,
        description="Number of products with text embeddings"
    )
    products_with_image_embeddings: int = Field(
        ...,
        ge=0,
        description="Number of products with image embeddings"
    )
    products_with_both_embeddings: int = Field(
        ...,
        ge=0,
        description="Number of products with both text and image embeddings"
    )
    text_embedding_coverage: float = Field(
        ...,
        ge=0.0,
        le=100.0,
        description="Percentage of products with text embeddings"
    )
    image_embedding_coverage: float = Field(
        ...,
        ge=0.0,
        le=100.0,
        description="Percentage of products with image embeddings"
    )
    hybrid_search_coverage: float = Field(
        ...,
        ge=0.0,
        le=100.0,
        description="Percentage of products supporting hybrid search"
    )
    avg_authenticity_score: Optional[float] = Field(
        None,
        ge=0.0,
        le=1.0,
        description="Average authenticity score across all products"
    )
    search_capabilities: Dict[str, bool] = Field(
        ...,
        description="Available search capabilities"
    )
    
    class Config:
        schema_extra = {
            "example": {
                "total_products": 1500,
                "products_with_text_embeddings": 1450,
                "products_with_image_embeddings": 1200,
                "products_with_both_embeddings": 1150,
                "text_embedding_coverage": 96.7,
                "image_embedding_coverage": 80.0,
                "hybrid_search_coverage": 76.7,
                "avg_authenticity_score": 0.78,
                "search_capabilities": {
                    "text_search": True,
                    "image_search": True,
                    "hybrid_search": True
                }
            }
        }