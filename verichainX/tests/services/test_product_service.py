"""
Tests for ProductService functionality.
"""

import asyncio
import io
import tempfile
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import pytest
from fastapi import UploadFile
from PIL import Image

from src.counterfeit_detection.services.product_service import ProductService, ImageProcessor
from src.counterfeit_detection.api.v1.schemas.products import ProductIngestRequest
from src.counterfeit_detection.models.enums import ProductCategory, ProductStatus


class TestImageProcessor:
    """Test ImageProcessor functionality."""
    
    @pytest.fixture
    def image_processor(self):
        """Create image processor for testing."""
        with tempfile.TemporaryDirectory() as temp_dir:
            yield ImageProcessor(base_path=temp_dir)
    
    @pytest.fixture
    def mock_image_file(self):
        """Create mock image file."""
        # Create a simple test image
        img = Image.new('RGB', (100, 100), color='red')
        img_bytes = io.BytesIO()
        img.save(img_bytes, format='JPEG')
        img_bytes.seek(0)
        
        # Create UploadFile
        upload_file = UploadFile(
            filename="test_image.jpg",
            file=img_bytes,
            size=len(img_bytes.getvalue()),
            headers={"content-type": "image/jpeg"}
        )
        
        return upload_file
    
    @pytest.mark.asyncio
    async def test_process_image_success(self, image_processor, mock_image_file):
        """Test successful image processing."""
        product_id = uuid4()
        image_index = 0
        
        image_url, thumbnail_url = await image_processor.process_image(
            mock_image_file, product_id, image_index
        )
        
        assert image_url is not None
        assert thumbnail_url is not None
        assert str(product_id) in image_url
        assert str(product_id) in thumbnail_url
        assert "image_0" in image_url
        assert "thumb_0" in thumbnail_url
    
    @pytest.mark.asyncio
    async def test_process_multiple_images(self, image_processor):
        """Test processing multiple images."""
        product_id = uuid4()
        
        # Create multiple test images
        images = []
        for i in range(3):
            img = Image.new('RGB', (100, 100), color=['red', 'green', 'blue'][i])
            img_bytes = io.BytesIO()
            img.save(img_bytes, format='JPEG')
            img_bytes.seek(0)
            
            upload_file = UploadFile(
                filename=f"test_image_{i}.jpg",
                file=img_bytes,
                size=len(img_bytes.getvalue()),
                headers={"content-type": "image/jpeg"}
            )
            images.append(upload_file)
        
        # Process all images
        results = []
        for i, image_file in enumerate(images):
            result = await image_processor.process_image(image_file, product_id, i)
            results.append(result)
        
        assert len(results) == 3
        for i, (image_url, thumbnail_url) in enumerate(results):
            assert f"image_{i}" in image_url
            assert f"thumb_{i}" in thumbnail_url


class TestProductService:
    """Test ProductService functionality."""
    
    @pytest.fixture
    def mock_repository(self):
        """Create mock product repository."""
        repository = AsyncMock()
        return repository
    
    @pytest.fixture
    def mock_image_processor(self):
        """Create mock image processor."""
        processor = AsyncMock()
        processor.process_image.return_value = (
            "http://example.com/image.jpg",
            "http://example.com/thumb.jpg"
        )
        return processor
    
    @pytest.fixture
    def product_service(self, mock_repository, mock_image_processor):
        """Create product service with mocked dependencies."""
        return ProductService(mock_repository, mock_image_processor)
    
    @pytest.fixture
    def product_request(self):
        """Create sample product request."""
        return ProductIngestRequest(
            description="Test product description for testing purposes",
            category=ProductCategory.ELECTRONICS,
            price=Decimal("99.99"),
            brand="TestBrand",
            supplier_id=uuid4()
        )
    
    @pytest.fixture
    def mock_image_files(self):
        """Create mock image files."""
        files = []
        for i in range(2):
            img_bytes = io.BytesIO(b"fake image data")
            upload_file = UploadFile(
                filename=f"test_{i}.jpg",
                file=img_bytes,
                size=len(b"fake image data"),
                headers={"content-type": "image/jpeg"}
            )
            files.append(upload_file)
        return files
    
    @pytest.mark.asyncio
    async def test_ingest_product_success(self, product_service, product_request, mock_image_files):
        """Test successful product ingestion."""
        # Mock repository response
        mock_product = MagicMock()
        mock_product.id = uuid4()
        mock_product.category = ProductCategory.ELECTRONICS
        mock_product.brand = "TestBrand"
        
        product_service.product_repository.create_product.return_value = mock_product
        
        # Test ingestion
        result = await product_service.ingest_product(product_request, mock_image_files)
        
        assert result.status == "success"
        assert result.product_id == mock_product.id
        assert len(result.uploaded_images) == 2
        assert len(result.uploaded_thumbnails) == 2
        assert result.processing_time_ms > 0
        
        # Verify repository was called
        product_service.product_repository.create_product.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_ingest_product_no_images(self, product_service, product_request):
        """Test product ingestion fails with no images."""
        with pytest.raises(Exception):  # HTTPException would be raised in real scenario
            await product_service.ingest_product(product_request, [])
    
    @pytest.mark.asyncio
    async def test_validation_warnings_generation(self, product_service, mock_image_files):
        """Test validation warnings generation."""
        # Test luxury brand with low price
        luxury_request = ProductIngestRequest(
            description="Authentic Rolex watch replica for testing",
            category=ProductCategory.WATCHES,
            price=Decimal("50.00"),  # Very low for luxury brand
            brand="Rolex",
            supplier_id=uuid4()
        )
        
        mock_product = MagicMock()
        mock_product.id = uuid4()
        mock_product.category = ProductCategory.WATCHES
        mock_product.brand = "Rolex"
        
        product_service.product_repository.create_product.return_value = mock_product
        
        result = await product_service.ingest_product(luxury_request, mock_image_files)
        
        # Should have warnings about luxury brand with low price and suspicious keywords
        assert len(result.validation_warnings) > 0
        assert any("luxury brand" in warning.lower() for warning in result.validation_warnings)
        assert any("replica" in warning.lower() for warning in result.validation_warnings)
    
    @pytest.mark.asyncio
    async def test_next_steps_generation(self, product_service, mock_image_files):
        """Test next steps generation."""
        electronics_request = ProductIngestRequest(
            description="High-end electronics device for testing",
            category=ProductCategory.ELECTRONICS,
            price=Decimal("599.99"),
            brand="TechBrand",
            supplier_id=uuid4()
        )
        
        mock_product = MagicMock()
        mock_product.id = uuid4()
        mock_product.category = ProductCategory.ELECTRONICS
        mock_product.brand = "TechBrand"
        
        product_service.product_repository.create_product.return_value = mock_product
        
        result = await product_service.ingest_product(electronics_request, mock_image_files)
        
        # Should have category-specific next steps
        assert len(result.next_steps) > 0
        assert any("authenticity analysis" in step.lower() for step in result.next_steps)
        assert any("technical specification" in step.lower() for step in result.next_steps)
    
    @pytest.mark.asyncio
    async def test_image_processing_failure_handling(self, product_service, product_request, mock_image_files):
        """Test handling of image processing failures."""
        # Mock image processor to fail on second image
        def mock_process_image(file, product_id, index):
            if index == 1:
                raise Exception("Image processing failed")
            return ("http://example.com/image.jpg", "http://example.com/thumb.jpg")
        
        product_service.image_processor.process_image.side_effect = mock_process_image
        
        mock_product = MagicMock()
        mock_product.id = uuid4()
        mock_product.category = ProductCategory.ELECTRONICS
        
        product_service.product_repository.create_product.return_value = mock_product
        
        result = await product_service.ingest_product(product_request, mock_image_files)
        
        # Should have one successful upload and one failure
        assert len(result.uploaded_images) == 1
        assert len(result.failed_uploads) == 1
        assert result.status == "success"  # Overall success despite one failure
    
    @pytest.mark.asyncio
    async def test_get_product_by_id(self, product_service):
        """Test getting product by ID."""
        product_id = uuid4()
        mock_product = MagicMock()
        mock_product.id = product_id
        
        product_service.product_repository.get_product_by_id.return_value = mock_product
        
        result = await product_service.get_product_by_id(product_id)
        
        assert result == mock_product
        product_service.product_repository.get_product_by_id.assert_called_once_with(product_id)
    
    @pytest.mark.asyncio
    async def test_search_products(self, product_service):
        """Test product search functionality."""
        search_params = {
            'category': ProductCategory.ELECTRONICS,
            'price_min': 50.0,
            'price_max': 500.0
        }
        
        mock_products = [MagicMock(), MagicMock()]
        total_count = 15
        
        product_service.product_repository.search_products.return_value = (mock_products, total_count)
        
        result = await product_service.search_products(search_params, limit=10, offset=0)
        
        assert result == (mock_products, total_count)
        product_service.product_repository.search_products.assert_called_once_with(
            search_params, 10, 0
        )
    
    @pytest.mark.asyncio
    async def test_update_product(self, product_service):
        """Test product update functionality."""
        product_id = uuid4()
        update_data = {'price': Decimal('199.99'), 'status': ProductStatus.FLAGGED}
        
        mock_updated_product = MagicMock()
        product_service.product_repository.update_product.return_value = mock_updated_product
        
        result = await product_service.update_product(product_id, update_data)
        
        assert result == mock_updated_product
        product_service.product_repository.update_product.assert_called_once_with(
            product_id, update_data
        )
    
    @pytest.mark.asyncio
    async def test_get_product_statistics(self, product_service):
        """Test getting product statistics."""
        mock_stats = {
            'total_products': 100,
            'products_by_status': {'active': 80, 'flagged': 20},
            'average_authenticity_score': 0.75
        }
        
        product_service.product_repository.get_statistics.return_value = mock_stats
        
        result = await product_service.get_product_statistics()
        
        assert result == mock_stats
        product_service.product_repository.get_statistics.assert_called_once()


class TestProductServiceValidation:
    """Test product service validation logic."""
    
    @pytest.fixture
    def product_service(self):
        """Create basic product service."""
        mock_repo = AsyncMock()
        mock_processor = AsyncMock()
        return ProductService(mock_repo, mock_processor)
    
    @pytest.mark.asyncio
    async def test_file_validation_max_files(self, product_service):
        """Test file validation for maximum file count."""
        # Create too many files
        files = []
        for i in range(15):  # Exceeds default max of 10
            upload_file = UploadFile(
                filename=f"test_{i}.jpg",
                file=io.BytesIO(b"test"),
                headers={"content-type": "image/jpeg"}
            )
            files.append(upload_file)
        
        with pytest.raises(Exception):  # Would be HTTPException in real scenario
            await product_service._validate_files(files)
    
    @pytest.mark.asyncio
    async def test_file_validation_file_size(self, product_service):
        """Test file validation for file size."""
        # Create oversized file
        large_data = b"x" * (6 * 1024 * 1024)  # 6MB, exceeds 5MB limit
        upload_file = UploadFile(
            filename="large_file.jpg",
            file=io.BytesIO(large_data),
            size=len(large_data),
            headers={"content-type": "image/jpeg"}
        )
        
        with pytest.raises(Exception):  # Would be HTTPException in real scenario
            await product_service._validate_files([upload_file])
    
    @pytest.mark.asyncio
    async def test_file_validation_file_type(self, product_service):
        """Test file validation for file type."""
        # Create unsupported file type
        upload_file = UploadFile(
            filename="document.pdf",
            file=io.BytesIO(b"test"),
            headers={"content-type": "application/pdf"}
        )
        
        with pytest.raises(Exception):  # Would be HTTPException in real scenario
            await product_service._validate_files([upload_file])
    
    def test_validation_warnings_suspicious_keywords(self, product_service):
        """Test validation warnings for suspicious keywords."""
        request = ProductIngestRequest(
            description="This is a fake replica knockoff copy of the original product",
            category=ProductCategory.ELECTRONICS,
            price=Decimal("50.00"),
            supplier_id=uuid4()
        )
        
        # This would be called during ingestion
        warnings = asyncio.run(product_service._generate_validation_warnings(request))
        
        # Should detect multiple suspicious keywords
        suspicious_warnings = [w for w in warnings if any(
            keyword in w.lower() for keyword in ['fake', 'replica', 'knockoff', 'copy']
        )]
        assert len(suspicious_warnings) >= 4  # Should detect all 4 keywords
    
    def test_validation_warnings_price_category_mismatch(self, product_service):
        """Test validation warnings for price-category mismatches."""
        request = ProductIngestRequest(
            description="High-end jewelry piece",
            category=ProductCategory.JEWELRY,
            price=Decimal("5.00"),  # Very low for jewelry
            supplier_id=uuid4()
        )
        
        warnings = asyncio.run(product_service._generate_validation_warnings(request))
        
        # Should warn about unusually low price for jewelry
        price_warnings = [w for w in warnings if 'price' in w.lower() and 'low' in w.lower()]
        assert len(price_warnings) > 0