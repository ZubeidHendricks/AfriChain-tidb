"""
Vector search API endpoints for similarity-based product search.
"""

from typing import List, Optional, Dict, Any
from uuid import UUID
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi import status
import structlog

from ..schemas.search import (
    SimilarProductsResponse,
    TextSimilarityRequest,
    ImageSimilarityRequest,
    HybridSimilarityRequest,
    SimilarProduct,
    VectorSearchStats
)
from ...services.embedding_service import EmbeddingService
from ...services.product_service import ProductService
from ...db.repositories.vector_repository import VectorRepository
from ...db.repositories.product_repository import ProductRepository
from ...models.enums import ProductCategory, ProductStatus
from ...core.database import get_db_session

router = APIRouter(prefix="/search", tags=["vector-search"])
logger = structlog.get_logger(module=__name__)


def get_embedding_service() -> EmbeddingService:
    """Dependency to get embedding service."""
    return EmbeddingService()


def get_product_service(
    db_session=Depends(get_db_session)
) -> ProductService:
    """Dependency to get product service."""
    product_repository = ProductRepository(db_session)
    return ProductService(product_repository)


def get_vector_repository(
    db_session=Depends(get_db_session)
) -> VectorRepository:
    """Dependency to get vector repository."""
    return VectorRepository(db_session)


@router.post("/similar/text", response_model=SimilarProductsResponse)
async def find_similar_by_text(
    request: TextSimilarityRequest,
    embedding_service: EmbeddingService = Depends(get_embedding_service),
    vector_repo: VectorRepository = Depends(get_vector_repository)
):
    """
    Find similar products based on text description.
    
    This endpoint generates a text embedding from the query description
    and finds products with similar text embeddings in the database.
    """
    try:
        logger.info(
            "Text similarity search requested",
            query_length=len(request.query_text),
            limit=request.limit,
            threshold=request.similarity_threshold
        )
        
        # Generate embedding for query text
        query_embedding = await embedding_service.generate_text_embedding(request.query_text)
        
        # Perform similarity search
        similar_products_data = await vector_repo.find_similar_products_by_text(
            query_embedding=query_embedding,
            category=request.category,
            supplier_id=request.supplier_id,
            price_min=request.price_min,
            price_max=request.price_max,
            status=request.status,
            limit=request.limit,
            similarity_threshold=request.similarity_threshold
        )
        
        # Convert to response format
        similar_products = [
            SimilarProduct(
                product_id=item["product_id"],
                description=item["description"],
                category=item["category"],
                price=item["price"],
                brand=item["brand"],
                supplier_id=item["supplier_id"],
                image_urls=item["image_urls"] or [],
                thumbnail_urls=item["thumbnail_urls"] or [],
                status=item["status"],
                authenticity_score=item["authenticity_score"],
                created_at=item["created_at"],
                similarity_score=item["similarity_score"]
            )
            for item in similar_products_data
        ]
        
        response = SimilarProductsResponse(
            similar_products=similar_products,
            query_type="text",
            total_matches=len(similar_products),
            query_time_ms=0,  # Would be calculated in a full implementation
            search_parameters={
                "query_text": request.query_text,
                "similarity_threshold": request.similarity_threshold,
                "category": request.category.value if request.category else None,
                "supplier_id": str(request.supplier_id) if request.supplier_id else None
            }
        )
        
        logger.info(
            "Text similarity search completed",
            results_count=len(similar_products),
            avg_similarity=sum(p.similarity_score for p in similar_products) / len(similar_products) if similar_products else 0
        )
        
        return response
        
    except Exception as e:
        logger.error("Text similarity search failed", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to perform text similarity search: {str(e)}"
        )


@router.post("/similar/image", response_model=SimilarProductsResponse)
async def find_similar_by_image(
    image: UploadFile = File(..., description="Product image for similarity search"),
    category: Optional[ProductCategory] = Form(None),
    supplier_id: Optional[str] = Form(None),
    price_min: Optional[float] = Form(None),
    price_max: Optional[float] = Form(None),
    status: Optional[ProductStatus] = Form(None),
    limit: int = Form(10, ge=1, le=50),
    similarity_threshold: float = Form(0.7, ge=0.0, le=1.0),
    embedding_service: EmbeddingService = Depends(get_embedding_service),
    vector_repo: VectorRepository = Depends(get_vector_repository)
):
    """
    Find similar products based on uploaded image.
    
    This endpoint generates an image embedding from the uploaded image
    and finds products with similar image embeddings in the database.
    """
    try:
        logger.info(
            "Image similarity search requested",
            filename=image.filename,
            content_type=image.content_type,
            limit=limit,
            threshold=similarity_threshold
        )
        
        # Validate image file
        if not image.content_type or not image.content_type.startswith("image/"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File must be an image"
            )
        
        # Read image data
        image_data = await image.read()
        
        # Generate embedding for query image
        query_embedding = embedding_service.generate_image_embedding(image_data)
        
        # Parse supplier_id if provided
        parsed_supplier_id = None
        if supplier_id:
            try:
                parsed_supplier_id = UUID(supplier_id)
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid supplier_id format"
                )
        
        # Perform similarity search
        similar_products_data = await vector_repo.find_similar_products_by_image(
            query_embedding=query_embedding,
            category=category,
            supplier_id=parsed_supplier_id,
            price_min=Decimal(str(price_min)) if price_min is not None else None,
            price_max=Decimal(str(price_max)) if price_max is not None else None,
            status=status,
            limit=limit,
            similarity_threshold=similarity_threshold
        )
        
        # Convert to response format
        similar_products = [
            SimilarProduct(
                product_id=item["product_id"],
                description=item["description"],
                category=item["category"],
                price=item["price"],
                brand=item["brand"],
                supplier_id=item["supplier_id"],
                image_urls=item["image_urls"] or [],
                thumbnail_urls=item["thumbnail_urls"] or [],
                status=item["status"],
                authenticity_score=item["authenticity_score"],
                created_at=item["created_at"],
                similarity_score=item["similarity_score"]
            )
            for item in similar_products_data
        ]
        
        response = SimilarProductsResponse(
            similar_products=similar_products,
            query_type="image",
            total_matches=len(similar_products),
            query_time_ms=0,  # Would be calculated in a full implementation
            search_parameters={
                "image_filename": image.filename,
                "similarity_threshold": similarity_threshold,
                "category": category.value if category else None,
                "supplier_id": supplier_id
            }
        )
        
        logger.info(
            "Image similarity search completed",
            results_count=len(similar_products),
            avg_similarity=sum(p.similarity_score for p in similar_products) / len(similar_products) if similar_products else 0
        )
        
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Image similarity search failed", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to perform image similarity search: {str(e)}"
        )


@router.post("/similar/hybrid", response_model=SimilarProductsResponse)
async def find_similar_hybrid(
    text: str = Form(..., min_length=10, max_length=2000),
    image: UploadFile = File(..., description="Product image for similarity search"),
    text_weight: float = Form(0.7, ge=0.0, le=1.0),
    image_weight: float = Form(0.3, ge=0.0, le=1.0),
    category: Optional[ProductCategory] = Form(None),
    supplier_id: Optional[str] = Form(None),
    price_min: Optional[float] = Form(None),
    price_max: Optional[float] = Form(None),
    status: Optional[ProductStatus] = Form(None),
    limit: int = Form(10, ge=1, le=50),
    similarity_threshold: float = Form(0.7, ge=0.0, le=1.0),
    embedding_service: EmbeddingService = Depends(get_embedding_service),
    vector_repo: VectorRepository = Depends(get_vector_repository)
):
    """
    Find similar products using hybrid text + image similarity search.
    
    This endpoint combines text and image embeddings with configurable weights
    to find products that are similar in both description and visual appearance.
    """
    try:
        logger.info(
            "Hybrid similarity search requested",
            text_length=len(text),
            filename=image.filename,
            text_weight=text_weight,
            image_weight=image_weight,
            limit=limit,
            threshold=similarity_threshold
        )
        
        # Validate weights sum
        if abs(text_weight + image_weight - 1.0) > 0.001:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="text_weight and image_weight must sum to 1.0"
            )
        
        # Validate image file
        if not image.content_type or not image.content_type.startswith("image/"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File must be an image"
            )
        
        # Read image data
        image_data = await image.read()
        
        # Generate embeddings
        text_embedding, image_embeddings = await embedding_service.process_product_embeddings(
            text, [image_data]
        )
        image_embedding = image_embeddings[0] if image_embeddings else None
        
        if not image_embedding:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to generate image embedding"
            )
        
        # Parse supplier_id if provided
        parsed_supplier_id = None
        if supplier_id:
            try:
                parsed_supplier_id = UUID(supplier_id)
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid supplier_id format"
                )
        
        # Perform hybrid similarity search
        similar_products_data = await vector_repo.find_hybrid_similar_products(
            text_embedding=text_embedding,
            image_embedding=image_embedding,
            text_weight=text_weight,
            image_weight=image_weight,
            category=category,
            supplier_id=parsed_supplier_id,
            price_min=Decimal(str(price_min)) if price_min is not None else None,
            price_max=Decimal(str(price_max)) if price_max is not None else None,
            status=status,
            limit=limit,
            similarity_threshold=similarity_threshold
        )
        
        # Convert to response format
        similar_products = []
        for item in similar_products_data:
            product = SimilarProduct(
                product_id=item["product_id"],
                description=item["description"],
                category=item["category"],
                price=item["price"],
                brand=item["brand"],
                supplier_id=item["supplier_id"],
                image_urls=item["image_urls"] or [],
                thumbnail_urls=item["thumbnail_urls"] or [],
                status=item["status"],
                authenticity_score=item["authenticity_score"],
                created_at=item["created_at"],
                similarity_score=item["combined_similarity_score"]
            )
            
            # Add detailed similarity scores
            if hasattr(product, 'extra'):
                product.extra = {
                    "text_similarity": item["text_similarity"],
                    "image_similarity": item["image_similarity"],
                    "combined_similarity": item["combined_similarity_score"]
                }
            
            similar_products.append(product)
        
        response = SimilarProductsResponse(
            similar_products=similar_products,
            query_type="hybrid",
            total_matches=len(similar_products),
            query_time_ms=0,  # Would be calculated in a full implementation
            search_parameters={
                "text": text,
                "image_filename": image.filename,
                "text_weight": text_weight,
                "image_weight": image_weight,
                "similarity_threshold": similarity_threshold,
                "category": category.value if category else None,
                "supplier_id": supplier_id
            }
        )
        
        logger.info(
            "Hybrid similarity search completed",
            results_count=len(similar_products),
            avg_similarity=sum(p.similarity_score for p in similar_products) / len(similar_products) if similar_products else 0
        )
        
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Hybrid similarity search failed", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to perform hybrid similarity search: {str(e)}"
        )


@router.get("/similar/product/{product_id}", response_model=SimilarProductsResponse)
async def find_similar_to_existing_product(
    product_id: UUID,
    query_type: str = Query("hybrid", regex="^(text|image|hybrid)$"),
    text_weight: float = Query(0.7, ge=0.0, le=1.0),
    image_weight: float = Query(0.3, ge=0.0, le=1.0),
    category: Optional[ProductCategory] = Query(None),
    supplier_id: Optional[UUID] = Query(None),
    price_min: Optional[float] = Query(None),
    price_max: Optional[float] = Query(None),
    status: Optional[ProductStatus] = Query(None),
    limit: int = Query(10, ge=1, le=50),
    similarity_threshold: float = Query(0.7, ge=0.0, le=1.0),
    product_service: ProductService = Depends(get_product_service),
    vector_repo: VectorRepository = Depends(get_vector_repository)
):
    """
    Find products similar to an existing product in the database.
    
    This endpoint uses the embeddings of an existing product to find similar products.
    The query_type parameter determines whether to use text, image, or hybrid similarity.
    """
    try:
        logger.info(
            "Product similarity search requested",
            product_id=str(product_id),
            query_type=query_type,
            limit=limit,
            threshold=similarity_threshold
        )
        
        # Get the source product
        source_product = await product_service.get_product_by_id(product_id)
        if not source_product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Product with ID {product_id} not found"
            )
        
        # Check if product has required embeddings
        if query_type in ["text", "hybrid"] and not source_product.description_embedding:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Product {product_id} does not have text embedding for {query_type} search"
            )
        
        if query_type in ["image", "hybrid"] and not source_product.image_embedding:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Product {product_id} does not have image embedding for {query_type} search"
            )
        
        # Perform similarity search based on query type
        if query_type == "text":
            similar_products_data = await vector_repo.find_similar_products_by_text(
                query_embedding=source_product.description_embedding,
                category=category,
                supplier_id=supplier_id,
                price_min=Decimal(str(price_min)) if price_min is not None else None,
                price_max=Decimal(str(price_max)) if price_max is not None else None,
                status=status,
                limit=limit + 1,  # +1 to account for source product
                similarity_threshold=similarity_threshold
            )
        elif query_type == "image":
            similar_products_data = await vector_repo.find_similar_products_by_image(
                query_embedding=source_product.image_embedding,
                category=category,
                supplier_id=supplier_id,
                price_min=Decimal(str(price_min)) if price_min is not None else None,
                price_max=Decimal(str(price_max)) if price_max is not None else None,
                status=status,
                limit=limit + 1,  # +1 to account for source product
                similarity_threshold=similarity_threshold
            )
        else:  # hybrid
            similar_products_data = await vector_repo.find_hybrid_similar_products(
                text_embedding=source_product.description_embedding,
                image_embedding=source_product.image_embedding,
                text_weight=text_weight,
                image_weight=image_weight,
                category=category,
                supplier_id=supplier_id,
                price_min=Decimal(str(price_min)) if price_min is not None else None,
                price_max=Decimal(str(price_max)) if price_max is not None else None,
                status=status,
                limit=limit + 1,  # +1 to account for source product
                similarity_threshold=similarity_threshold
            )
        
        # Filter out the source product and limit results
        filtered_products_data = [
            item for item in similar_products_data 
            if str(item["product_id"]) != str(product_id)
        ][:limit]
        
        # Convert to response format
        similar_products = [
            SimilarProduct(
                product_id=item["product_id"],
                description=item["description"],
                category=item["category"],
                price=item["price"],
                brand=item["brand"],
                supplier_id=item["supplier_id"],
                image_urls=item["image_urls"] or [],
                thumbnail_urls=item["thumbnail_urls"] or [],
                status=item["status"],
                authenticity_score=item["authenticity_score"],
                created_at=item["created_at"],
                similarity_score=item.get("combined_similarity_score", item["similarity_score"])
            )
            for item in filtered_products_data
        ]
        
        response = SimilarProductsResponse(
            similar_products=similar_products,
            query_type=query_type,
            total_matches=len(similar_products),
            query_time_ms=0,  # Would be calculated in a full implementation
            search_parameters={
                "source_product_id": str(product_id),
                "query_type": query_type,
                "text_weight": text_weight if query_type == "hybrid" else None,
                "image_weight": image_weight if query_type == "hybrid" else None,
                "similarity_threshold": similarity_threshold,
                "category": category.value if category else None,
                "supplier_id": str(supplier_id) if supplier_id else None
            }
        )
        
        logger.info(
            "Product similarity search completed",
            source_product_id=str(product_id),
            query_type=query_type,
            results_count=len(similar_products)
        )
        
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Product similarity search failed", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to perform product similarity search: {str(e)}"
        )


@router.get("/stats", response_model=VectorSearchStats)
async def get_vector_search_statistics(
    vector_repo: VectorRepository = Depends(get_vector_repository)
):
    """
    Get statistics about vector embeddings and search capabilities.
    
    Returns information about embedding coverage, search performance,
    and database statistics for vector operations.
    """
    try:
        logger.info("Vector search statistics requested")
        
        stats = await vector_repo.get_vector_statistics()
        
        response = VectorSearchStats(
            total_products=stats["total_products"],
            products_with_text_embeddings=stats["products_with_text_embeddings"],
            products_with_image_embeddings=stats["products_with_image_embeddings"],
            products_with_both_embeddings=stats["products_with_both_embeddings"],
            text_embedding_coverage=stats["text_embedding_coverage"],
            image_embedding_coverage=stats["image_embedding_coverage"],
            hybrid_search_coverage=stats["hybrid_search_coverage"],
            avg_authenticity_score=stats["avg_authenticity_score"],
            search_capabilities={
                "text_search": stats["products_with_text_embeddings"] > 0,
                "image_search": stats["products_with_image_embeddings"] > 0,
                "hybrid_search": stats["products_with_both_embeddings"] > 0
            }
        )
        
        logger.info(
            "Vector search statistics retrieved",
            total_products=stats["total_products"],
            text_coverage=stats["text_embedding_coverage"],
            image_coverage=stats["image_embedding_coverage"]
        )
        
        return response
        
    except Exception as e:
        logger.error("Failed to get vector search statistics", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve vector search statistics: {str(e)}"
        )