"""
Product API endpoints for ingestion and management.
"""

import asyncio
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from ....config.database import get_database_session
from ....db.repositories.product_repository import ProductRepository
from ....services.product_service import ProductService, ImageProcessor
from ....api.v1.schemas.products import (
    ProductIngestRequest,
    ProductIngestResponse,
    ProductResponse,
    ProductListResponse,
    ProductSearchRequest,
    ProductUpdateRequest,
    ProductStatisticsResponse,
    FileUploadValidation
)
from ....models.enums import ProductCategory, ProductStatus

logger = structlog.get_logger(module=__name__)

router = APIRouter(prefix="/products", tags=["products"])


async def get_product_service(session: AsyncSession = Depends(get_database_session)) -> ProductService:
    """Dependency to get product service."""
    repository = ProductRepository(session)
    image_processor = ImageProcessor()
    return ProductService(repository, image_processor)


@router.post("/ingest", 
            response_model=ProductIngestResponse,
            status_code=status.HTTP_201_CREATED,
            summary="Ingest Product Metadata",
            description="Ingest product metadata with images for authenticity analysis")
async def ingest_product(
    # Form data fields
    description: str = Form(..., min_length=10, max_length=2000, description="Product description"),
    category: ProductCategory = Form(..., description="Product category"),
    price: float = Form(..., gt=0, description="Product price in USD"),
    supplier_id: str = Form(..., description="Supplier UUID"),
    brand: str = Form(None, max_length=100, description="Product brand name"),
    sku: str = Form(None, max_length=100, description="Stock Keeping Unit"),
    upc: str = Form(None, max_length=50, description="Universal Product Code"),
    weight: float = Form(None, gt=0, description="Product weight in kg"),
    manufacturer: str = Form(None, max_length=255, description="Product manufacturer"),
    country_of_origin: str = Form(None, max_length=100, description="Country of origin"),
    external_product_id: str = Form(None, max_length=255, description="External platform product ID"),
    source_platform: str = Form(None, max_length=100, description="Source platform"),
    
    # File uploads
    images: List[UploadFile] = File(..., description="Product images (max 10, 5MB each)"),
    
    # Dependencies
    product_service: ProductService = Depends(get_product_service)
):
    """
    Ingest product metadata with images.
    
    This endpoint accepts product information via multipart/form-data to support
    image uploads. The product will be stored in the database and queued for
    authenticity analysis.
    
    **Rate Limiting**: 10 requests per minute
    **Authentication**: JWT Bearer token required
    """
    try:
        # Validate supplier_id format
        try:
            supplier_uuid = UUID(supplier_id)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="Invalid supplier_id format. Must be a valid UUID."
            )
        
        # Create product request object
        product_request = ProductIngestRequest(
            description=description,
            category=category,
            price=price,
            brand=brand,
            supplier_id=supplier_uuid,
            sku=sku,
            upc=upc,
            weight=weight,
            manufacturer=manufacturer,
            country_of_origin=country_of_origin,
            external_product_id=external_product_id,
            source_platform=source_platform
        )
        
        # Ingest product
        result = await product_service.ingest_product(product_request, images)
        
        logger.info(
            "Product ingestion API called",
            product_id=str(result.product_id),
            category=category.value,
            brand=brand,
            status=result.status
        )
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Product ingestion failed",
            error=str(e),
            category=category.value if 'category' in locals() else None
        )
        raise HTTPException(
            status_code=500,
            detail="Internal server error during product ingestion"
        )


@router.get("/{product_id}",
            response_model=ProductResponse,
            summary="Get Product by ID",
            description="Retrieve detailed product information by UUID")
async def get_product(
    product_id: UUID,
    product_service: ProductService = Depends(get_product_service)
):
    """Get product details by ID."""
    try:
        product = await product_service.get_product_by_id(product_id)
        
        if not product:
            raise HTTPException(
                status_code=404,
                detail=f"Product with ID {product_id} not found"
            )
        
        return ProductResponse.from_orm(product)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to get product",
            product_id=str(product_id),
            error=str(e)
        )
        raise HTTPException(
            status_code=500,
            detail="Internal server error retrieving product"
        )


@router.post("/search",
            response_model=ProductListResponse,
            summary="Search Products",
            description="Search products with various filters and pagination")
async def search_products(
    search_request: ProductSearchRequest,
    product_service: ProductService = Depends(get_product_service)
):
    """Search products with filters."""
    try:
        # Calculate offset from page
        offset = (search_request.page - 1) * search_request.page_size
        
        # Prepare search parameters
        search_params = {}
        
        if search_request.description:
            search_params['description'] = search_request.description
        if search_request.brand:
            search_params['brand'] = search_request.brand
        if search_request.category:
            search_params['category'] = search_request.category
        if search_request.status:
            search_params['status'] = search_request.status
        if search_request.price_min:
            search_params['price_min'] = search_request.price_min
        if search_request.price_max:
            search_params['price_max'] = search_request.price_max
        if search_request.authenticity_score_min is not None:
            search_params['authenticity_score_min'] = search_request.authenticity_score_min
        if search_request.authenticity_score_max is not None:
            search_params['authenticity_score_max'] = search_request.authenticity_score_max
        if search_request.supplier_id:
            search_params['supplier_id'] = search_request.supplier_id
        if search_request.created_after:
            search_params['created_after'] = search_request.created_after
        if search_request.created_before:
            search_params['created_before'] = search_request.created_before
        
        search_params['order_by'] = search_request.order_by
        search_params['order_direction'] = search_request.order_direction
        
        # Execute search
        products, total_count = await product_service.search_products(
            search_params,
            limit=search_request.page_size,
            offset=offset
        )
        
        # Convert to response models
        product_responses = [ProductResponse.from_orm(product) for product in products]
        
        # Calculate pagination info
        has_next = offset + search_request.page_size < total_count
        has_previous = search_request.page > 1
        
        response = ProductListResponse(
            products=product_responses,
            total_count=total_count,
            page=search_request.page,
            page_size=search_request.page_size,
            has_next=has_next,
            has_previous=has_previous
        )
        
        logger.info(
            "Product search completed",
            filters=search_params,
            page=search_request.page,
            total_count=total_count,
            returned_count=len(product_responses)
        )
        
        return response
        
    except Exception as e:
        logger.error(
            "Product search failed",
            error=str(e),
            search_params=dict(search_request)
        )
        raise HTTPException(
            status_code=500,
            detail="Internal server error during product search"
        )


@router.put("/{product_id}",
            response_model=ProductResponse,
            summary="Update Product",
            description="Update product information")
async def update_product(
    product_id: UUID,
    update_request: ProductUpdateRequest,
    product_service: ProductService = Depends(get_product_service)
):
    """Update product information."""
    try:
        # Prepare update data (exclude None values)
        update_data = {}
        
        for field, value in update_request.dict(exclude_unset=True).items():
            if value is not None:
                update_data[field] = value
        
        if not update_data:
            raise HTTPException(
                status_code=400,
                detail="No fields provided for update"
            )
        
        # Update product
        updated_product = await product_service.update_product(product_id, update_data)
        
        if not updated_product:
            raise HTTPException(
                status_code=404,
                detail=f"Product with ID {product_id} not found"
            )
        
        logger.info(
            "Product updated",
            product_id=str(product_id),
            updated_fields=list(update_data.keys())
        )
        
        return ProductResponse.from_orm(updated_product)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Product update failed",
            product_id=str(product_id),
            error=str(e)
        )
        raise HTTPException(
            status_code=500,
            detail="Internal server error during product update"
        )


@router.get("/category/{category}",
            response_model=ProductListResponse,
            summary="Get Products by Category",
            description="Retrieve products filtered by category")
async def get_products_by_category(
    category: ProductCategory,
    page: int = 1,
    page_size: int = 20,
    product_service: ProductService = Depends(get_product_service)
):
    """Get products by category."""
    try:
        if page < 1:
            raise HTTPException(status_code=400, detail="Page must be >= 1")
        if page_size < 1 or page_size > 100:
            raise HTTPException(status_code=400, detail="Page size must be between 1 and 100")
        
        offset = (page - 1) * page_size
        
        # Search products by category
        search_params = {'category': category}
        products, total_count = await product_service.search_products(
            search_params,
            limit=page_size,
            offset=offset
        )
        
        product_responses = [ProductResponse.from_orm(product) for product in products]
        
        has_next = offset + page_size < total_count
        has_previous = page > 1
        
        response = ProductListResponse(
            products=product_responses,
            total_count=total_count,
            page=page,
            page_size=page_size,
            has_next=has_next,
            has_previous=has_previous
        )
        
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Get products by category failed",
            category=category.value,
            error=str(e)
        )
        raise HTTPException(
            status_code=500,
            detail="Internal server error retrieving products by category"
        )


@router.get("/flagged/list",
            response_model=ProductListResponse,
            summary="Get Flagged Products",
            description="Retrieve products flagged for review")
async def get_flagged_products(
    page: int = 1,
    page_size: int = 20,
    product_service: ProductService = Depends(get_product_service)
):
    """Get products flagged for review."""
    try:
        if page < 1:
            raise HTTPException(status_code=400, detail="Page must be >= 1")
        if page_size < 1 or page_size > 100:
            raise HTTPException(status_code=400, detail="Page size must be between 1 and 100")
        
        offset = (page - 1) * page_size
        
        # Get flagged products
        repository = ProductRepository(product_service.product_repository.session)
        products = await repository.get_flagged_products(limit=page_size, offset=offset)
        
        # Get total count for flagged products
        search_params = {
            'status': [ProductStatus.FLAGGED, ProductStatus.PENDING_REVIEW],
            'authenticity_score_max': 0.3
        }
        _, total_count = await product_service.search_products(search_params, limit=1, offset=0)
        
        product_responses = [ProductResponse.from_orm(product) for product in products]
        
        has_next = offset + page_size < total_count
        has_previous = page > 1
        
        response = ProductListResponse(
            products=product_responses,
            total_count=total_count,
            page=page,
            page_size=page_size,
            has_next=has_next,
            has_previous=has_previous
        )
        
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Get flagged products failed",
            error=str(e)
        )
        raise HTTPException(
            status_code=500,
            detail="Internal server error retrieving flagged products"
        )


@router.get("/statistics/overview",
            response_model=ProductStatisticsResponse,
            summary="Get Product Statistics",
            description="Retrieve comprehensive product statistics")
async def get_product_statistics(
    product_service: ProductService = Depends(get_product_service)
):
    """Get product statistics and overview."""
    try:
        statistics = await product_service.get_product_statistics()
        
        return ProductStatisticsResponse(**statistics)
        
    except Exception as e:
        logger.error(
            "Get product statistics failed",
            error=str(e)
        )
        raise HTTPException(
            status_code=500,
            detail="Internal server error retrieving product statistics"
        )


@router.patch("/{product_id}/status",
              summary="Update Product Status",
              description="Update product status (admin only)")
async def update_product_status(
    product_id: UUID,
    status: ProductStatus,
    notes: Optional[str] = None,
    product_service: ProductService = Depends(get_product_service)
):
    """Update product status."""
    try:
        repository = ProductRepository(product_service.product_repository.session)
        success = await repository.update_product_status(product_id, status, notes)
        
        if not success:
            raise HTTPException(
                status_code=404,
                detail=f"Product with ID {product_id} not found"
            )
        
        logger.info(
            "Product status updated",
            product_id=str(product_id),
            new_status=status.value,
            notes=notes
        )
        
        return {"message": "Product status updated successfully", "status": status.value}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Product status update failed",
            product_id=str(product_id),
            status=status.value,
            error=str(e)
        )
        raise HTTPException(
            status_code=500,
            detail="Internal server error updating product status"
        )


# Health check for products API
@router.get("/health/check",
            summary="Products API Health Check",
            description="Check the health of the products API")
async def products_health_check():
    """Health check for products API."""
    return {
        "status": "healthy",
        "service": "products_api",
        "timestamp": asyncio.get_event_loop().time()
    }