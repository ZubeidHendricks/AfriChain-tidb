"""
Pydantic schemas for product API endpoints.
"""

from datetime import datetime
from decimal import Decimal
from typing import Optional, List, Dict, Any
from uuid import UUID

from pydantic import BaseModel, Field, validator, root_validator
from pydantic.types import PositiveFloat

from ....models.enums import ProductCategory, ProductStatus


class ProductIngestRequest(BaseModel):
    """Request model for product ingestion."""
    
    description: str = Field(
        min_length=10,
        max_length=2000,
        description="Product description"
    )
    category: ProductCategory = Field(
        description="Product category"
    )
    price: Decimal = Field(
        gt=0,
        max_digits=10,
        decimal_places=2,
        description="Product price in USD"
    )
    brand: Optional[str] = Field(
        None,
        max_length=100,
        description="Product brand name"
    )
    supplier_id: UUID = Field(
        description="Supplier UUID"
    )
    
    # Optional metadata
    sku: Optional[str] = Field(
        None,
        max_length=100,
        description="Stock Keeping Unit"
    )
    upc: Optional[str] = Field(
        None,
        max_length=50,
        description="Universal Product Code"
    )
    weight: Optional[Decimal] = Field(
        None,
        gt=0,
        max_digits=8,
        decimal_places=3,
        description="Product weight in kg"
    )
    dimensions: Optional[Dict[str, float]] = Field(
        None,
        description="Product dimensions (length, width, height in cm)"
    )
    manufacturer: Optional[str] = Field(
        None,
        max_length=255,
        description="Product manufacturer"
    )
    country_of_origin: Optional[str] = Field(
        None,
        max_length=100,
        description="Country where product was manufactured"
    )
    external_product_id: Optional[str] = Field(
        None,
        max_length=255,
        description="External platform product ID"
    )
    source_platform: Optional[str] = Field(
        None,
        max_length=100,
        description="Source platform or marketplace"
    )
    
    @validator('description')
    def validate_description(cls, v):
        """Validate product description."""
        if not v or not v.strip():
            raise ValueError("Description cannot be empty")
        
        # Check for suspicious patterns that might indicate counterfeit
        suspicious_keywords = [
            'replica', 'fake', 'knockoff', 'copy', 'imitation',
            'inspired by', 'similar to', 'same as original'
        ]
        
        lower_desc = v.lower()
        for keyword in suspicious_keywords:
            if keyword in lower_desc:
                # Don't reject, but flag for additional scrutiny
                pass
        
        return v.strip()
    
    @validator('brand')
    def validate_brand(cls, v):
        """Validate brand name."""
        if v:
            v = v.strip()
            if not v:
                return None
            
            # Check for common misspellings of luxury brands
            # This would be expanded with a comprehensive brand database
            known_brands = {
                'nike', 'adidas', 'apple', 'samsung', 'rolex',
                'louis vuitton', 'gucci', 'prada', 'chanel'
            }
            
            # Just normalize for now
            return v
        return v
    
    @validator('dimensions')
    def validate_dimensions(cls, v):
        """Validate product dimensions."""
        if v:
            required_keys = {'length', 'width', 'height'}
            if not all(key in v for key in required_keys):
                raise ValueError("Dimensions must include length, width, and height")
            
            for key, value in v.items():
                if not isinstance(value, (int, float)) or value <= 0:
                    raise ValueError(f"Dimension {key} must be a positive number")
            
            # Reasonable limits (in cm)
            for key, value in v.items():
                if value > 1000:  # 10 meters max
                    raise ValueError(f"Dimension {key} exceeds maximum allowed value")
        
        return v
    
    @root_validator
    def validate_category_price_consistency(cls, values):
        """Validate that price is reasonable for the category."""
        category = values.get('category')
        price = values.get('price')
        
        if category and price:
            # Define reasonable price ranges by category
            price_ranges = {
                ProductCategory.ELECTRONICS: (1, 50000),
                ProductCategory.CLOTHING: (5, 5000),
                ProductCategory.ACCESSORIES: (1, 2000),
                ProductCategory.SHOES: (10, 3000),
                ProductCategory.BAGS: (10, 20000),
                ProductCategory.JEWELRY: (5, 100000),
                ProductCategory.WATCHES: (10, 500000),
                ProductCategory.COSMETICS: (1, 500),
                ProductCategory.PHARMACEUTICALS: (1, 1000),
                ProductCategory.AUTOMOTIVE: (10, 100000),
                ProductCategory.SPORTING_GOODS: (5, 10000),
                ProductCategory.HOME_GARDEN: (1, 5000),
                ProductCategory.TOYS: (1, 500),
                ProductCategory.BOOKS: (1, 200),
                ProductCategory.OTHER: (0.1, 100000),
            }
            
            min_price, max_price = price_ranges.get(category, (0.1, 100000))
            if not (min_price <= float(price) <= max_price):
                # Don't reject, but this could be flagged for review
                pass
        
        return values
    
    class Config:
        schema_extra = {
            "example": {
                "description": "Authentic Nike Air Jordan 1 Retro High OG sneakers in Chicago colorway",
                "category": "shoes",
                "price": 170.00,
                "brand": "Nike",
                "supplier_id": "123e4567-e89b-12d3-a456-426614174000",
                "sku": "AIR-JORDAN-1-CHI",
                "weight": 0.8,
                "dimensions": {
                    "length": 32.0,
                    "width": 12.0,
                    "height": 11.0
                },
                "manufacturer": "Nike Inc.",
                "country_of_origin": "Vietnam",
                "external_product_id": "EXT-12345",
                "source_platform": "partner_marketplace"
            }
        }


class FileUploadValidation(BaseModel):
    """File upload validation parameters."""
    
    max_file_size: int = Field(
        default=5 * 1024 * 1024,  # 5MB
        description="Maximum file size in bytes"
    )
    max_files: int = Field(
        default=10,
        description="Maximum number of files"
    )
    allowed_extensions: List[str] = Field(
        default=['jpg', 'jpeg', 'png', 'webp'],
        description="Allowed file extensions"
    )
    allowed_mime_types: List[str] = Field(
        default=['image/jpeg', 'image/png', 'image/webp'],
        description="Allowed MIME types"
    )


class ProductIngestResponse(BaseModel):
    """Response model for product ingestion."""
    
    product_id: UUID = Field(
        description="Generated product UUID"
    )
    status: str = Field(
        description="Ingestion status"
    )
    message: str = Field(
        description="Status message"
    )
    processing_time_ms: float = Field(
        description="Processing time in milliseconds"
    )
    
    # File upload results
    uploaded_images: List[str] = Field(
        default_factory=list,
        description="URLs of successfully uploaded images"
    )
    uploaded_thumbnails: List[str] = Field(
        default_factory=list,
        description="URLs of generated thumbnail images"
    )
    failed_uploads: List[Dict[str, str]] = Field(
        default_factory=list,
        description="Information about failed uploads"
    )
    
    # Validation results
    validation_warnings: List[str] = Field(
        default_factory=list,
        description="Non-blocking validation warnings"
    )
    
    # Next steps
    next_steps: List[str] = Field(
        default_factory=list,
        description="Recommended next steps"
    )
    
    class Config:
        schema_extra = {
            "example": {
                "product_id": "123e4567-e89b-12d3-a456-426614174000",
                "status": "success",
                "message": "Product ingested successfully",
                "processing_time_ms": 245.6,
                "uploaded_images": [
                    "https://storage.example.com/products/123e4567/image_1.jpg",
                    "https://storage.example.com/products/123e4567/image_2.jpg"
                ],
                "uploaded_thumbnails": [
                    "https://storage.example.com/products/123e4567/thumb_1.jpg",
                    "https://storage.example.com/products/123e4567/thumb_2.jpg"
                ],
                "failed_uploads": [],
                "validation_warnings": [
                    "Price is unusually low for this category - flagged for review"
                ],
                "next_steps": [
                    "Product queued for authenticity analysis",
                    "Vector embeddings will be generated",
                    "Supplier risk assessment initiated"
                ]
            }
        }


class ProductResponse(BaseModel):
    """Response model for product information."""
    
    id: UUID
    description: str
    category: ProductCategory
    price: Decimal
    brand: Optional[str]
    supplier_id: UUID
    image_urls: Optional[List[str]]
    thumbnail_urls: Optional[List[str]]
    
    # Metadata
    sku: Optional[str]
    upc: Optional[str]
    weight: Optional[Decimal]
    dimensions: Optional[Dict[str, float]]
    manufacturer: Optional[str]
    country_of_origin: Optional[str]
    
    # Status and analysis
    status: ProductStatus
    authenticity_score: Optional[Decimal]
    confidence_score: Optional[Decimal]
    last_analyzed_at: Optional[datetime]
    analysis_count: int
    
    # Additional fields
    external_product_id: Optional[str]
    source_platform: Optional[str]
    
    # Timestamps
    created_at: datetime
    updated_at: datetime
    
    class Config:
        orm_mode = True
        json_encoders = {
            Decimal: float,
            datetime: lambda v: v.isoformat()
        }


class ProductListResponse(BaseModel):
    """Response model for product listings."""
    
    products: List[ProductResponse]
    total_count: int
    page: int
    page_size: int
    has_next: bool
    has_previous: bool
    
    class Config:
        schema_extra = {
            "example": {
                "products": [],
                "total_count": 150,
                "page": 1,
                "page_size": 20,
                "has_next": True,
                "has_previous": False
            }
        }


class ProductSearchRequest(BaseModel):
    """Request model for product search."""
    
    # Text search
    description: Optional[str] = Field(
        None,
        max_length=500,
        description="Search in product descriptions"
    )
    brand: Optional[str] = Field(
        None,
        max_length=100,
        description="Filter by brand"
    )
    
    # Category and status filters
    category: Optional[ProductCategory] = Field(
        None,
        description="Filter by category"
    )
    status: Optional[List[ProductStatus]] = Field(
        None,
        description="Filter by status (multiple allowed)"
    )
    
    # Price range
    price_min: Optional[PositiveFloat] = Field(
        None,
        description="Minimum price"
    )
    price_max: Optional[PositiveFloat] = Field(
        None,
        description="Maximum price"
    )
    
    # Authenticity score range
    authenticity_score_min: Optional[float] = Field(
        None,
        ge=0,
        le=1,
        description="Minimum authenticity score"
    )
    authenticity_score_max: Optional[float] = Field(
        None,
        ge=0,
        le=1,
        description="Maximum authenticity score"
    )
    
    # Supplier filter
    supplier_id: Optional[UUID] = Field(
        None,
        description="Filter by supplier"
    )
    
    # Date range
    created_after: Optional[datetime] = Field(
        None,
        description="Products created after this date"
    )
    created_before: Optional[datetime] = Field(
        None,
        description="Products created before this date"
    )
    
    # Sorting
    order_by: Optional[str] = Field(
        'created_at',
        description="Field to order by"
    )
    order_direction: Optional[str] = Field(
        'desc',
        regex='^(asc|desc)$',
        description="Sort direction"
    )
    
    # Pagination
    page: int = Field(
        1,
        ge=1,
        description="Page number"
    )
    page_size: int = Field(
        20,
        ge=1,
        le=100,
        description="Number of items per page"
    )
    
    @validator('authenticity_score_min', 'authenticity_score_max')
    def validate_authenticity_scores(cls, v):
        """Validate authenticity score ranges."""
        if v is not None and not (0 <= v <= 1):
            raise ValueError("Authenticity score must be between 0 and 1")
        return v
    
    @root_validator
    def validate_score_range(cls, values):
        """Validate that min scores are less than max scores."""
        price_min = values.get('price_min')
        price_max = values.get('price_max')
        
        if price_min and price_max and price_min > price_max:
            raise ValueError("price_min must be less than price_max")
        
        auth_min = values.get('authenticity_score_min')
        auth_max = values.get('authenticity_score_max')
        
        if auth_min and auth_max and auth_min > auth_max:
            raise ValueError("authenticity_score_min must be less than authenticity_score_max")
        
        return values
    
    class Config:
        schema_extra = {
            "example": {
                "description": "Nike shoes",
                "category": "shoes",
                "brand": "Nike",
                "price_min": 50.0,
                "price_max": 300.0,
                "authenticity_score_min": 0.7,
                "status": ["active", "flagged"],
                "order_by": "authenticity_score",
                "order_direction": "asc",
                "page": 1,
                "page_size": 20
            }
        }


class ProductUpdateRequest(BaseModel):
    """Request model for product updates."""
    
    description: Optional[str] = Field(
        None,
        min_length=10,
        max_length=2000,
        description="Updated product description"
    )
    category: Optional[ProductCategory] = Field(
        None,
        description="Updated product category"
    )
    price: Optional[Decimal] = Field(
        None,
        gt=0,
        max_digits=10,
        decimal_places=2,
        description="Updated product price"
    )
    brand: Optional[str] = Field(
        None,
        max_length=100,
        description="Updated product brand"
    )
    status: Optional[ProductStatus] = Field(
        None,
        description="Updated product status"
    )
    
    # Optional metadata
    sku: Optional[str] = Field(
        None,
        max_length=100,
        description="Updated SKU"
    )
    upc: Optional[str] = Field(
        None,
        max_length=50,
        description="Updated UPC"
    )
    weight: Optional[Decimal] = Field(
        None,
        gt=0,
        max_digits=8,
        decimal_places=3,
        description="Updated weight in kg"
    )
    dimensions: Optional[Dict[str, float]] = Field(
        None,
        description="Updated dimensions"
    )
    manufacturer: Optional[str] = Field(
        None,
        max_length=255,
        description="Updated manufacturer"
    )
    
    class Config:
        schema_extra = {
            "example": {
                "description": "Updated product description with more details",
                "price": 199.99,
                "status": "flagged"
            }
        }


class ProductStatisticsResponse(BaseModel):
    """Response model for product statistics."""
    
    total_products: int
    products_by_status: Dict[str, int]
    products_by_category: Dict[str, int]
    average_authenticity_score: Optional[float]
    analyzed_products: int
    analysis_coverage: float
    
    class Config:
        schema_extra = {
            "example": {
                "total_products": 1250,
                "products_by_status": {
                    "active": 980,
                    "flagged": 45,
                    "removed": 12,
                    "pending_review": 213
                },
                "products_by_category": {
                    "electronics": 340,
                    "clothing": 290,
                    "shoes": 220,
                    "accessories": 180,
                    "other": 220
                },
                "average_authenticity_score": 0.78,
                "analyzed_products": 1100,
                "analysis_coverage": 88.0
            }
        }