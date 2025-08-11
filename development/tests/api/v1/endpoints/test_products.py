"""
Tests for product API endpoints.
"""

import io
import json
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import status
from fastapi.testclient import TestClient

from src.counterfeit_detection.main import app
from src.counterfeit_detection.models.enums import ProductCategory, ProductStatus
from src.counterfeit_detection.api.v1.schemas.products import ProductIngestResponse


class TestProductsAPI:
    """Test product API endpoints."""
    
    @pytest.fixture
    def client(self):
        """Create test client."""
        return TestClient(app)
    
    @pytest.fixture
    def mock_product_service(self):
        """Mock product service."""
        with patch('src.counterfeit_detection.api.v1.endpoints.products.get_product_service') as mock:
            service = AsyncMock()
            mock.return_value = service
            yield service
    
    @pytest.fixture
    def sample_product_data(self):
        """Sample product data for testing."""
        return {
            "description": "Test product description for API testing purposes",
            "category": "electronics",
            "price": 99.99,
            "supplier_id": str(uuid4()),
            "brand": "TestBrand",
            "sku": "TEST-001"
        }
    
    @pytest.fixture
    def sample_image_files(self):
        """Sample image files for testing."""
        files = []
        for i in range(2):
            file_content = f"fake image data {i}".encode()
            files.append(
                ("images", (f"test_{i}.jpg", io.BytesIO(file_content), "image/jpeg"))
            )
        return files
    
    def test_ingest_product_success(self, client, mock_product_service, sample_product_data, sample_image_files):
        """Test successful product ingestion."""
        # Mock service response
        mock_response = ProductIngestResponse(
            product_id=uuid4(),
            status="success",
            message="Product ingested successfully",
            processing_time_ms=250.0,
            uploaded_images=[
                "http://example.com/image1.jpg",
                "http://example.com/image2.jpg"
            ],
            uploaded_thumbnails=[
                "http://example.com/thumb1.jpg",
                "http://example.com/thumb2.jpg"
            ],
            failed_uploads=[],
            validation_warnings=[],
            next_steps=["Product queued for authenticity analysis"]
        )
        
        mock_product_service.ingest_product.return_value = mock_response
        
        # Make request
        response = client.post(
            "/api/v1/products/ingest",
            data=sample_product_data,
            files=sample_image_files
        )
        
        # Verify response
        assert response.status_code == status.HTTP_201_CREATED
        response_data = response.json()
        
        assert response_data["status"] == "success"
        assert "product_id" in response_data
        assert len(response_data["uploaded_images"]) == 2
        assert len(response_data["uploaded_thumbnails"]) == 2
        assert response_data["processing_time_ms"] > 0
        
        # Verify service was called
        mock_product_service.ingest_product.assert_called_once()
    
    def test_ingest_product_invalid_supplier_id(self, client, sample_product_data, sample_image_files):
        """Test product ingestion with invalid supplier ID."""
        sample_product_data["supplier_id"] = "invalid-uuid"
        
        response = client.post(
            "/api/v1/products/ingest",
            data=sample_product_data,
            files=sample_image_files
        )
        
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "Invalid supplier_id format" in response.json()["detail"]
    
    def test_ingest_product_no_images(self, client, sample_product_data):
        """Test product ingestion without images."""
        response = client.post(
            "/api/v1/products/ingest",
            data=sample_product_data,
            files=[]
        )
        
        assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    
    def test_ingest_product_invalid_category(self, client, sample_product_data, sample_image_files):
        """Test product ingestion with invalid category."""
        sample_product_data["category"] = "invalid_category"
        
        response = client.post(
            "/api/v1/products/ingest",
            data=sample_product_data,
            files=sample_image_files
        )
        
        assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    
    def test_ingest_product_negative_price(self, client, sample_product_data, sample_image_files):
        """Test product ingestion with negative price."""
        sample_product_data["price"] = -10.0
        
        response = client.post(
            "/api/v1/products/ingest",
            data=sample_product_data,
            files=sample_image_files
        )
        
        assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    
    def test_get_product_success(self, client, mock_product_service):
        """Test successful product retrieval."""
        product_id = uuid4()
        
        # Mock product
        mock_product = MagicMock()
        mock_product.id = product_id
        mock_product.description = "Test product"
        mock_product.category = ProductCategory.ELECTRONICS
        mock_product.price = Decimal("99.99")
        mock_product.status = ProductStatus.ACTIVE
        
        mock_product_service.get_product_by_id.return_value = mock_product
        
        response = client.get(f"/api/v1/products/{product_id}")
        
        assert response.status_code == status.HTTP_200_OK
        
        # Verify service was called
        mock_product_service.get_product_by_id.assert_called_once_with(product_id)
    
    def test_get_product_not_found(self, client, mock_product_service):
        """Test product retrieval when product doesn't exist."""
        product_id = uuid4()
        mock_product_service.get_product_by_id.return_value = None
        
        response = client.get(f"/api/v1/products/{product_id}")
        
        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert f"Product with ID {product_id} not found" in response.json()["detail"]
    
    def test_get_product_invalid_uuid(self, client):
        """Test product retrieval with invalid UUID."""
        response = client.get("/api/v1/products/invalid-uuid")
        
        assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    
    def test_search_products_success(self, client, mock_product_service):
        """Test successful product search."""
        search_request = {
            "description": "test",
            "category": "electronics",
            "price_min": 50.0,
            "price_max": 200.0,
            "page": 1,
            "page_size": 10
        }
        
        # Mock search results
        mock_products = [MagicMock(), MagicMock()]
        total_count = 25
        
        mock_product_service.search_products.return_value = (mock_products, total_count)
        
        response = client.post("/api/v1/products/search", json=search_request)
        
        assert response.status_code == status.HTTP_200_OK
        response_data = response.json()
        
        assert response_data["total_count"] == total_count
        assert response_data["page"] == 1
        assert response_data["page_size"] == 10
        assert response_data["has_next"] is True
        assert response_data["has_previous"] is False
        
        # Verify service was called with correct parameters
        mock_product_service.search_products.assert_called_once()
    
    def test_search_products_invalid_price_range(self, client):
        """Test product search with invalid price range."""
        search_request = {
            "price_min": 200.0,
            "price_max": 50.0,  # Max less than min
            "page": 1,
            "page_size": 10
        }
        
        response = client.post("/api/v1/products/search", json=search_request)
        
        assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
        assert "price_min must be less than price_max" in response.json()["detail"][0]["msg"]
    
    def test_search_products_invalid_authenticity_score(self, client):
        """Test product search with invalid authenticity score."""
        search_request = {
            "authenticity_score_min": 1.5,  # > 1.0
            "page": 1,
            "page_size": 10
        }
        
        response = client.post("/api/v1/products/search", json=search_request)
        
        assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    
    def test_update_product_success(self, client, mock_product_service):
        """Test successful product update."""
        product_id = uuid4()
        update_request = {
            "description": "Updated description",
            "price": 149.99,
            "status": "flagged"
        }
        
        # Mock updated product
        mock_updated_product = MagicMock()
        mock_updated_product.id = product_id
        mock_updated_product.description = "Updated description"
        
        mock_product_service.update_product.return_value = mock_updated_product
        
        response = client.put(f"/api/v1/products/{product_id}", json=update_request)
        
        assert response.status_code == status.HTTP_200_OK
        
        # Verify service was called
        mock_product_service.update_product.assert_called_once()
        call_args = mock_product_service.update_product.call_args
        assert call_args[0][0] == product_id
        assert "description" in call_args[0][1]
        assert "price" in call_args[0][1]
        assert "status" in call_args[0][1]
    
    def test_update_product_not_found(self, client, mock_product_service):
        """Test product update when product doesn't exist."""
        product_id = uuid4()
        update_request = {"description": "Updated description"}
        
        mock_product_service.update_product.return_value = None
        
        response = client.put(f"/api/v1/products/{product_id}", json=update_request)
        
        assert response.status_code == status.HTTP_404_NOT_FOUND
    
    def test_update_product_no_fields(self, client):
        """Test product update with no fields provided."""
        product_id = uuid4()
        
        response = client.put(f"/api/v1/products/{product_id}", json={})
        
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "No fields provided for update" in response.json()["detail"]
    
    def test_get_products_by_category_success(self, client, mock_product_service):
        """Test getting products by category."""
        mock_products = [MagicMock(), MagicMock()]
        total_count = 15
        
        mock_product_service.search_products.return_value = (mock_products, total_count)
        
        response = client.get("/api/v1/products/category/electronics")
        
        assert response.status_code == status.HTTP_200_OK
        response_data = response.json()
        
        assert response_data["total_count"] == total_count
        assert response_data["page"] == 1
        assert response_data["page_size"] == 20
        
        # Verify service was called with category filter
        mock_product_service.search_products.assert_called_once()
        call_args = mock_product_service.search_products.call_args
        assert call_args[0][0]["category"] == ProductCategory.ELECTRONICS
    
    def test_get_products_by_category_invalid_page(self, client):
        """Test getting products by category with invalid page."""
        response = client.get("/api/v1/products/category/electronics?page=0")
        
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "Page must be >= 1" in response.json()["detail"]
    
    def test_get_products_by_category_invalid_page_size(self, client):
        """Test getting products by category with invalid page size."""
        response = client.get("/api/v1/products/category/electronics?page_size=200")
        
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "Page size must be between 1 and 100" in response.json()["detail"]
    
    def test_get_flagged_products_success(self, client, mock_product_service):
        """Test getting flagged products."""
        # Mock repository
        mock_repository = AsyncMock()
        mock_flagged_products = [MagicMock(), MagicMock()]
        mock_repository.get_flagged_products.return_value = mock_flagged_products
        
        # Mock search for total count
        mock_product_service.search_products.return_value = ([], 8)
        
        with patch('src.counterfeit_detection.api.v1.endpoints.products.ProductRepository') as mock_repo_class:
            mock_repo_class.return_value = mock_repository
            
            response = client.get("/api/v1/products/flagged/list")
        
        assert response.status_code == status.HTTP_200_OK
        response_data = response.json()
        
        assert response_data["page"] == 1
        assert response_data["page_size"] == 20
    
    def test_get_product_statistics_success(self, client, mock_product_service):
        """Test getting product statistics."""
        mock_stats = {
            "total_products": 150,
            "products_by_status": {"active": 120, "flagged": 30},
            "products_by_category": {"electronics": 80, "clothing": 70},
            "average_authenticity_score": 0.78,
            "analyzed_products": 140,
            "analysis_coverage": 93.3
        }
        
        mock_product_service.get_product_statistics.return_value = mock_stats
        
        response = client.get("/api/v1/products/statistics/overview")
        
        assert response.status_code == status.HTTP_200_OK
        response_data = response.json()
        
        assert response_data["total_products"] == 150
        assert response_data["average_authenticity_score"] == 0.78
        assert response_data["analysis_coverage"] == 93.3
        
        mock_product_service.get_product_statistics.assert_called_once()
    
    def test_update_product_status_success(self, client, mock_product_service):
        """Test updating product status."""
        product_id = uuid4()
        
        # Mock repository
        mock_repository = AsyncMock()
        mock_repository.update_product_status.return_value = True
        
        with patch('src.counterfeit_detection.api.v1.endpoints.products.ProductRepository') as mock_repo_class:
            mock_repo_class.return_value = mock_repository
            
            response = client.patch(
                f"/api/v1/products/{product_id}/status",
                params={"status": "flagged", "notes": "Manual review required"}
            )
        
        assert response.status_code == status.HTTP_200_OK
        response_data = response.json()
        
        assert response_data["message"] == "Product status updated successfully"
        assert response_data["status"] == "flagged"
        
        mock_repository.update_product_status.assert_called_once_with(
            product_id, ProductStatus.FLAGGED, "Manual review required"
        )
    
    def test_update_product_status_not_found(self, client, mock_product_service):
        """Test updating status of non-existent product."""
        product_id = uuid4()
        
        # Mock repository
        mock_repository = AsyncMock()
        mock_repository.update_product_status.return_value = False
        
        with patch('src.counterfeit_detection.api.v1.endpoints.products.ProductRepository') as mock_repo_class:
            mock_repo_class.return_value = mock_repository
            
            response = client.patch(
                f"/api/v1/products/{product_id}/status",
                params={"status": "flagged"}
            )
        
        assert response.status_code == status.HTTP_404_NOT_FOUND
    
    def test_products_health_check(self, client):
        """Test products API health check."""
        response = client.get("/api/v1/products/health/check")
        
        assert response.status_code == status.HTTP_200_OK
        response_data = response.json()
        
        assert response_data["status"] == "healthy"
        assert response_data["service"] == "products_api"
        assert "timestamp" in response_data


class TestProductValidation:
    """Test product schema validation."""
    
    def test_product_ingest_request_validation(self):
        """Test ProductIngestRequest validation."""
        from src.counterfeit_detection.api.v1.schemas.products import ProductIngestRequest
        
        # Valid request
        valid_data = {
            "description": "Valid product description for testing",
            "category": ProductCategory.ELECTRONICS,
            "price": Decimal("99.99"),
            "supplier_id": uuid4()
        }
        
        request = ProductIngestRequest(**valid_data)
        assert request.description == valid_data["description"]
        assert request.category == valid_data["category"]
        assert request.price == valid_data["price"]
    
    def test_product_ingest_request_invalid_description(self):
        """Test ProductIngestRequest with invalid description."""
        from src.counterfeit_detection.api.v1.schemas.products import ProductIngestRequest
        from pydantic import ValidationError
        
        # Too short description
        with pytest.raises(ValidationError):
            ProductIngestRequest(
                description="Short",  # Less than 10 characters
                category=ProductCategory.ELECTRONICS,
                price=Decimal("99.99"),
                supplier_id=uuid4()
            )
        
        # Empty description
        with pytest.raises(ValidationError):
            ProductIngestRequest(
                description="",
                category=ProductCategory.ELECTRONICS,
                price=Decimal("99.99"),
                supplier_id=uuid4()
            )
    
    def test_product_ingest_request_invalid_price(self):
        """Test ProductIngestRequest with invalid price."""
        from src.counterfeit_detection.api.v1.schemas.products import ProductIngestRequest
        from pydantic import ValidationError
        
        # Negative price
        with pytest.raises(ValidationError):
            ProductIngestRequest(
                description="Valid product description",
                category=ProductCategory.ELECTRONICS,
                price=Decimal("-10.00"),
                supplier_id=uuid4()
            )
        
        # Zero price
        with pytest.raises(ValidationError):
            ProductIngestRequest(
                description="Valid product description",
                category=ProductCategory.ELECTRONICS,
                price=Decimal("0.00"),
                supplier_id=uuid4()
            )
    
    def test_product_search_request_validation(self):
        """Test ProductSearchRequest validation."""
        from src.counterfeit_detection.api.v1.schemas.products import ProductSearchRequest
        
        # Valid search request
        search_request = ProductSearchRequest(
            description="test product",
            category=ProductCategory.ELECTRONICS,
            price_min=50.0,
            price_max=200.0,
            page=1,
            page_size=20
        )
        
        assert search_request.description == "test product"
        assert search_request.category == ProductCategory.ELECTRONICS
        assert search_request.price_min == 50.0
        assert search_request.price_max == 200.0
    
    def test_product_search_request_invalid_price_range(self):
        """Test ProductSearchRequest with invalid price range."""
        from src.counterfeit_detection.api.v1.schemas.products import ProductSearchRequest
        from pydantic import ValidationError
        
        # price_min > price_max
        with pytest.raises(ValidationError):
            ProductSearchRequest(
                price_min=200.0,
                price_max=50.0
            )