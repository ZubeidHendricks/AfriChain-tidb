"""
Product service for business logic and file handling.
"""

import asyncio
import io
import os
import uuid
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import List, Optional, Dict, Any, Tuple
from uuid import UUID

import aiofiles
from fastapi import UploadFile, HTTPException
from PIL import Image
import structlog

from ..db.repositories.product_repository import ProductRepository
from ..models.enums import ProductCategory, ProductStatus
from ..api.v1.schemas.products import (
    ProductIngestRequest,
    ProductIngestResponse,
    FileUploadValidation
)
from .embedding_service import EmbeddingService

logger = structlog.get_logger(module=__name__)


class ImageProcessor:
    """Utility class for image processing operations."""
    
    def __init__(self, 
                 base_path: str = "storage/products",
                 thumbnail_size: Tuple[int, int] = (300, 300),
                 max_image_size: Tuple[int, int] = (1920, 1920)):
        self.base_path = Path(base_path)
        self.thumbnail_size = thumbnail_size
        self.max_image_size = max_image_size
        self.logger = structlog.get_logger(component="image_processor")
    
    async def process_image(self, 
                          image_file: UploadFile, 
                          product_id: UUID,
                          image_index: int) -> Tuple[str, str]:
        """
        Process uploaded image: resize, generate thumbnail, save to storage.
        
        Args:
            image_file: Uploaded image file
            product_id: Product UUID
            image_index: Index of image in the product's image list
            
        Returns:
            Tuple of (image_url, thumbnail_url)
        """
        try:
            # Create product directory
            product_dir = self.base_path / str(product_id)
            product_dir.mkdir(parents=True, exist_ok=True)
            
            # Generate filenames
            file_extension = image_file.filename.split('.')[-1].lower()
            image_filename = f"image_{image_index}.{file_extension}"
            thumbnail_filename = f"thumb_{image_index}.{file_extension}"
            
            image_path = product_dir / image_filename
            thumbnail_path = product_dir / thumbnail_filename
            
            # Read image data
            image_data = await image_file.read()
            
            # Process with PIL
            with Image.open(io.BytesIO(image_data)) as img:
                # Convert to RGB if necessary
                if img.mode in ('RGBA', 'P'):
                    img = img.convert('RGB')
                
                # Resize main image if too large
                if img.size[0] > self.max_image_size[0] or img.size[1] > self.max_image_size[1]:
                    img.thumbnail(self.max_image_size, Image.Resampling.LANCZOS)
                
                # Save main image
                img.save(image_path, quality=85, optimize=True)
                
                # Create and save thumbnail
                thumb_img = img.copy()
                thumb_img.thumbnail(self.thumbnail_size, Image.Resampling.LANCZOS)
                thumb_img.save(thumbnail_path, quality=80, optimize=True)
            
            # Generate URLs (in production, these would be CDN URLs)
            image_url = f"/storage/products/{product_id}/{image_filename}"
            thumbnail_url = f"/storage/products/{product_id}/{thumbnail_filename}"
            
            self.logger.info(
                "Image processed successfully",
                product_id=str(product_id),
                image_index=image_index,
                original_size=len(image_data),
                image_path=str(image_path)
            )
            
            return image_url, thumbnail_url
            
        except Exception as e:
            self.logger.error(
                "Failed to process image",
                product_id=str(product_id),
                image_index=image_index,
                error=str(e)
            )
            raise


class ProductService:
    """Service class for product business logic."""
    
    def __init__(self, 
                 product_repository: ProductRepository,
                 image_processor: Optional[ImageProcessor] = None,
                 file_validation: Optional[FileUploadValidation] = None,
                 embedding_service: Optional[EmbeddingService] = None):
        self.product_repository = product_repository
        self.image_processor = image_processor or ImageProcessor()
        self.file_validation = file_validation or FileUploadValidation()
        self.embedding_service = embedding_service or EmbeddingService()
        
        self.logger = structlog.get_logger(component="product_service")
    
    async def ingest_product(self, 
                           product_request: ProductIngestRequest,
                           image_files: List[UploadFile]) -> ProductIngestResponse:
        """
        Ingest a new product with images.
        
        Args:
            product_request: Product metadata
            image_files: List of uploaded image files
            
        Returns:
            ProductIngestResponse with processing results
        """
        start_time = asyncio.get_event_loop().time()
        
        try:
            # Validate files
            await self._validate_files(image_files)
            
            # Generate product ID
            product_id = uuid.uuid4()
            
            # Process images concurrently
            image_results = await self._process_images(image_files, product_id)
            
            # Prepare product data
            product_data = self._prepare_product_data(
                product_request, 
                product_id, 
                image_results
            )
            
            # Save to database
            product = await self.product_repository.create_product(product_data)
            
            # Generate embeddings asynchronously after product creation
            asyncio.create_task(self._generate_product_embeddings(
                product.id, 
                product_request.description, 
                image_files
            ))
            
            # Calculate processing time
            processing_time = (asyncio.get_event_loop().time() - start_time) * 1000
            
            # Generate validation warnings
            warnings = await self._generate_validation_warnings(product_request)
            
            # Generate next steps
            next_steps = self._generate_next_steps(product)
            
            # Create response
            response = ProductIngestResponse(
                product_id=product.id,
                status="success",
                message="Product ingested successfully",
                processing_time_ms=processing_time,
                uploaded_images=[result['image_url'] for result in image_results if result['success']],
                uploaded_thumbnails=[result['thumbnail_url'] for result in image_results if result['success']],
                failed_uploads=[
                    {"filename": result['filename'], "error": result['error']} 
                    for result in image_results if not result['success']
                ],
                validation_warnings=warnings,
                next_steps=next_steps
            )
            
            self.logger.info(
                "Product ingested successfully",
                product_id=str(product_id),
                processing_time_ms=processing_time,
                image_count=len([r for r in image_results if r['success']]),
                failed_uploads=len([r for r in image_results if not r['success']])
            )
            
            # Queue for analysis (would integrate with agent system)
            await self._queue_for_analysis(product)
            
            return response
            
        except Exception as e:
            processing_time = (asyncio.get_event_loop().time() - start_time) * 1000
            
            self.logger.error(
                "Product ingestion failed",
                error=str(e),
                processing_time_ms=processing_time
            )
            
            # Return error response
            return ProductIngestResponse(
                product_id=uuid.uuid4(),  # Placeholder
                status="error",
                message=f"Product ingestion failed: {str(e)}",
                processing_time_ms=processing_time,
                uploaded_images=[],
                uploaded_thumbnails=[],
                failed_uploads=[],
                validation_warnings=[],
                next_steps=[]
            )
    
    async def _validate_files(self, image_files: List[UploadFile]) -> None:
        """Validate uploaded files."""
        if not image_files:
            raise HTTPException(
                status_code=400,
                detail="At least one image is required"
            )
        
        if len(image_files) > self.file_validation.max_files:
            raise HTTPException(
                status_code=400,
                detail=f"Maximum {self.file_validation.max_files} images allowed"
            )
        
        for file in image_files:
            # Check file size
            if file.size and file.size > self.file_validation.max_file_size:
                raise HTTPException(
                    status_code=400,
                    detail=f"File {file.filename} exceeds maximum size of {self.file_validation.max_file_size} bytes"
                )
            
            # Check file extension
            if file.filename:
                extension = file.filename.split('.')[-1].lower()
                if extension not in self.file_validation.allowed_extensions:
                    raise HTTPException(
                        status_code=400,
                        detail=f"File type .{extension} not allowed. Allowed types: {', '.join(self.file_validation.allowed_extensions)}"
                    )
            
            # Check MIME type
            if file.content_type not in self.file_validation.allowed_mime_types:
                raise HTTPException(
                    status_code=400,
                    detail=f"MIME type {file.content_type} not allowed"
                )
    
    async def _process_images(self, 
                            image_files: List[UploadFile], 
                            product_id: UUID) -> List[Dict[str, Any]]:
        """Process uploaded images concurrently."""
        tasks = []
        
        for index, image_file in enumerate(image_files):
            task = self._process_single_image(image_file, product_id, index)
            tasks.append(task)
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        processed_results = []
        for index, result in enumerate(results):
            if isinstance(result, Exception):
                processed_results.append({
                    'success': False,
                    'filename': image_files[index].filename,
                    'error': str(result),
                    'image_url': None,
                    'thumbnail_url': None
                })
            else:
                processed_results.append({
                    'success': True,
                    'filename': image_files[index].filename,
                    'error': None,
                    'image_url': result[0],
                    'thumbnail_url': result[1]
                })
        
        return processed_results
    
    async def _process_single_image(self, 
                                  image_file: UploadFile, 
                                  product_id: UUID,
                                  index: int) -> Tuple[str, str]:
        """Process a single image file."""
        try:
            # Reset file pointer
            await image_file.seek(0)
            
            # Process image
            image_url, thumbnail_url = await self.image_processor.process_image(
                image_file, product_id, index
            )
            
            return image_url, thumbnail_url
            
        except Exception as e:
            self.logger.error(
                "Failed to process single image",
                filename=image_file.filename,
                product_id=str(product_id),
                index=index,
                error=str(e)
            )
            raise
    
    def _prepare_product_data(self, 
                            product_request: ProductIngestRequest,
                            product_id: UUID,
                            image_results: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Prepare product data for database insertion."""
        successful_images = [r for r in image_results if r['success']]
        
        image_urls = [r['image_url'] for r in successful_images]
        thumbnail_urls = [r['thumbnail_url'] for r in successful_images]
        
        product_data = {
            'id': product_id,
            'description': product_request.description,
            'category': product_request.category,
            'price': product_request.price,
            'brand': product_request.brand,
            'supplier_id': product_request.supplier_id,
            'image_urls': image_urls,
            'thumbnail_urls': thumbnail_urls,
            'sku': product_request.sku,
            'upc': product_request.upc,
            'weight': product_request.weight,
            'dimensions': product_request.dimensions,
            'manufacturer': product_request.manufacturer,
            'country_of_origin': product_request.country_of_origin,
            'external_product_id': product_request.external_product_id,
            'source_platform': product_request.source_platform,
            'status': ProductStatus.ACTIVE,
            'analysis_count': 0
        }
        
        return product_data
    
    async def _generate_validation_warnings(self, 
                                          product_request: ProductIngestRequest) -> List[str]:
        """Generate validation warnings for the product."""
        warnings = []
        
        # Price validation warnings
        if product_request.category == ProductCategory.ELECTRONICS and product_request.price < 10:
            warnings.append("Price is unusually low for electronics category - flagged for review")
        
        if product_request.category == ProductCategory.JEWELRY and product_request.price < 50:
            warnings.append("Price is unusually low for jewelry category - flagged for review")
        
        # Brand validation warnings
        if product_request.brand:
            luxury_brands = ['rolex', 'louis vuitton', 'gucci', 'prada', 'chanel']
            if any(brand.lower() in product_request.brand.lower() for brand in luxury_brands):
                if product_request.price < 500:
                    warnings.append("Luxury brand product with unusually low price - flagged for review")
        
        # Description validation warnings
        suspicious_keywords = ['replica', 'fake', 'knockoff', 'copy', 'inspired by']
        desc_lower = product_request.description.lower()
        for keyword in suspicious_keywords:
            if keyword in desc_lower:
                warnings.append(f"Suspicious keyword '{keyword}' found in description - flagged for review")
        
        return warnings
    
    def _generate_next_steps(self, product) -> List[str]:
        """Generate next steps for the ingested product."""
        next_steps = [
            "Product queued for authenticity analysis",
            "Vector embeddings will be generated for similarity search",
            "Supplier risk assessment initiated"
        ]
        
        # Add category-specific steps
        if product.category in [ProductCategory.ELECTRONICS, ProductCategory.WATCHES]:
            next_steps.append("Technical specification verification scheduled")
        
        if product.category in [ProductCategory.CLOTHING, ProductCategory.SHOES, ProductCategory.BAGS]:
            next_steps.append("Material and craftsmanship analysis queued")
        
        if product.brand and any(luxury in product.brand.lower() for luxury in ['rolex', 'louis', 'gucci']):
            next_steps.append("Luxury brand authentication process initiated")
        
        return next_steps
    
    async def _generate_product_embeddings(self, 
                                      product_id: UUID, 
                                      description: str,
                                      image_files: List[UploadFile]) -> None:
        """
        Generate embeddings for product text and images asynchronously.
        
        Args:
            product_id: Product UUID
            description: Product description text
            image_files: List of uploaded image files
        """
        try:
            self.logger.info(
                "Starting embedding generation",
                product_id=str(product_id),
                description_length=len(description),
                image_count=len(image_files)
            )
            
            # Read image data
            image_data = []
            for image_file in image_files:
                try:
                    # Reset file position
                    await image_file.seek(0)
                    content = await image_file.read()
                    image_data.append(content)
                except Exception as e:
                    self.logger.warning(
                        "Failed to read image for embedding",
                        product_id=str(product_id),
                        filename=image_file.filename,
                        error=str(e)
                    )
            
            # Generate embeddings
            text_embedding, image_embeddings = await self.embedding_service.process_product_embeddings(
                description, image_data
            )
            
            # Update product with embeddings
            embedding_data = {
                'description_embedding': text_embedding,
                'image_embedding': image_embeddings[0] if image_embeddings else None  # Use first image embedding
            }
            
            await self.product_repository.update_product(product_id, embedding_data)
            
            self.logger.info(
                "Successfully generated product embeddings",
                product_id=str(product_id),
                text_embedding_dim=len(text_embedding),
                image_embeddings_count=len(image_embeddings)
            )
            
        except Exception as e:
            self.logger.error(
                "Failed to generate product embeddings",
                product_id=str(product_id),
                error=str(e)
            )
            # Don't raise - embedding generation failure shouldn't fail the process
    
    async def _queue_for_analysis(self, product) -> None:
        """Queue product for analysis by the multi-agent system."""
        try:
            # This would integrate with the AgentOrchestrator to trigger analysis
            # For now, just log the action
            self.logger.info(
                "Product queued for analysis",
                product_id=str(product.id),
                category=product.category.value,
                brand=product.brand
            )
            
            # In a full implementation, this would:
            # 1. Create a workflow for the product analysis
            # 2. Queue it with the AgentOrchestrator
            # 3. Trigger embedding generation
            # 4. Start authenticity analysis
            
        except Exception as e:
            self.logger.error(
                "Failed to queue product for analysis",
                product_id=str(product.id),
                error=str(e)
            )
            # Don't raise - analysis queueing failure shouldn't fail ingestion
    
    async def get_product_by_id(self, product_id: UUID):
        """Get product by ID."""
        return await self.product_repository.get_product_by_id(product_id)
    
    async def search_products(self, 
                            search_params: Dict[str, Any],
                            limit: int = 20,
                            offset: int = 0):
        """Search products with filters."""
        return await self.product_repository.search_products(
            search_params, limit, offset
        )
    
    async def update_product(self, 
                           product_id: UUID,
                           update_data: Dict[str, Any]):
        """Update product information."""
        return await self.product_repository.update_product(product_id, update_data)
    
    async def get_product_statistics(self):
        """Get product statistics."""
        return await self.product_repository.get_statistics()