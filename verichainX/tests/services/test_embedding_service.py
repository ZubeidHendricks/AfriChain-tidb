"""
Tests for EmbeddingService functionality.
"""

import asyncio
import io
from typing import List
from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from PIL import Image

from src.counterfeit_detection.services.embedding_service import EmbeddingService


class TestEmbeddingService:
    """Test EmbeddingService functionality."""
    
    @pytest.fixture
    def mock_openai_client(self):
        """Mock OpenAI client."""
        client = AsyncMock()
        
        # Mock embedding response
        mock_response = MagicMock()
        mock_response.data = [MagicMock()]
        mock_response.data[0].embedding = [0.1] * 1536  # 1536-dimensional vector
        
        client.embeddings.create.return_value = mock_response
        return client
    
    @pytest.fixture
    def mock_clip_model(self):
        """Mock CLIP model."""
        with patch('src.counterfeit_detection.services.embedding_service.SentenceTransformer') as mock_st:
            mock_model = MagicMock()
            mock_model.encode.return_value = [0.1] * 512  # 512-dimensional vector
            mock_st.return_value = mock_model
            yield mock_model
    
    @pytest.fixture
    def embedding_service(self, mock_openai_client):
        """Create embedding service with mocked dependencies."""
        return EmbeddingService(openai_client=mock_openai_client)
    
    @pytest.fixture
    def sample_image_data(self):
        """Create sample image data."""
        img = Image.new('RGB', (100, 100), color='red')
        img_bytes = io.BytesIO()
        img.save(img_bytes, format='JPEG')
        return img_bytes.getvalue()
    
    @pytest.mark.asyncio
    async def test_generate_text_embedding_success(self, embedding_service, mock_openai_client):
        """Test successful text embedding generation."""
        text = "High-quality leather handbag with gold hardware"
        
        embedding = await embedding_service.generate_text_embedding(text)
        
        assert len(embedding) == 1536
        assert all(isinstance(x, float) for x in embedding)
        mock_openai_client.embeddings.create.assert_called_once_with(
            model="text-embedding-3-small",
            input=text,
            dimensions=1536
        )
    
    @pytest.mark.asyncio
    async def test_generate_text_embedding_empty_text(self, embedding_service):
        """Test text embedding generation with empty text."""
        with pytest.raises(ValueError, match="Text cannot be empty"):
            await embedding_service.generate_text_embedding("")
    
    @pytest.mark.asyncio
    async def test_generate_text_embedding_caching(self, embedding_service, mock_openai_client):
        """Test text embedding caching."""
        text = "Sample product description"
        
        # First call
        embedding1 = await embedding_service.generate_text_embedding(text)
        
        # Second call (should use cache)
        embedding2 = await embedding_service.generate_text_embedding(text)
        
        assert embedding1 == embedding2
        # Should only call OpenAI once due to caching
        mock_openai_client.embeddings.create.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_generate_text_embeddings_batch(self, embedding_service, mock_openai_client):
        """Test batch text embedding generation."""
        texts = [
            "First product description",
            "Second product description", 
            "Third product description"
        ]
        
        # Mock batch response
        mock_response = MagicMock()
        mock_response.data = [MagicMock() for _ in texts]
        for i, data in enumerate(mock_response.data):
            data.embedding = [0.1 + i * 0.1] * 1536
        
        mock_openai_client.embeddings.create.return_value = mock_response
        
        embeddings = await embedding_service.generate_text_embeddings_batch(texts)
        
        assert len(embeddings) == 3
        assert all(len(emb) == 1536 for emb in embeddings)
        mock_openai_client.embeddings.create.assert_called_once_with(
            model="text-embedding-3-small",
            input=texts,
            dimensions=1536
        )
    
    @pytest.mark.asyncio
    async def test_generate_text_embeddings_batch_empty(self, embedding_service):
        """Test batch embedding generation with empty list."""
        embeddings = await embedding_service.generate_text_embeddings_batch([])
        assert embeddings == []
    
    def test_generate_image_embedding_success(self, embedding_service, mock_clip_model, sample_image_data):
        """Test successful image embedding generation."""
        embedding = embedding_service.generate_image_embedding(sample_image_data)
        
        assert len(embedding) == 512
        assert all(isinstance(x, float) for x in embedding)
        mock_clip_model.encode.assert_called_once()
    
    def test_generate_image_embedding_caching(self, embedding_service, mock_clip_model, sample_image_data):
        """Test image embedding caching."""
        # First call
        embedding1 = embedding_service.generate_image_embedding(sample_image_data)
        
        # Second call (should use cache)
        embedding2 = embedding_service.generate_image_embedding(sample_image_data)
        
        assert embedding1 == embedding2
        # Should only call CLIP model once due to caching
        mock_clip_model.encode.assert_called_once()
    
    def test_generate_image_embeddings_batch(self, embedding_service, mock_clip_model):
        """Test batch image embedding generation."""
        # Create multiple test images
        image_data_list = []
        for color in ['red', 'green', 'blue']:
            img = Image.new('RGB', (100, 100), color=color)
            img_bytes = io.BytesIO()
            img.save(img_bytes, format='JPEG')
            image_data_list.append(img_bytes.getvalue())
        
        # Mock batch response
        mock_clip_model.encode.return_value = [[0.1 + i * 0.1] * 512 for i in range(len(image_data_list))]
        
        embeddings = embedding_service.generate_image_embeddings_batch(image_data_list)
        
        assert len(embeddings) == 3
        assert all(len(emb) == 512 for emb in embeddings)
        mock_clip_model.encode.assert_called_once()
    
    def test_generate_image_embeddings_batch_empty(self, embedding_service):
        """Test batch image embedding generation with empty list."""
        embeddings = embedding_service.generate_image_embeddings_batch([])
        assert embeddings == []
    
    @pytest.mark.asyncio
    async def test_process_product_embeddings(self, embedding_service, mock_clip_model, sample_image_data):
        """Test processing both text and image embeddings for a product."""
        description = "Luxury leather handbag with premium materials"
        image_data_list = [sample_image_data]
        
        # Mock clip model behavior
        mock_clip_model.encode.return_value = [[0.1] * 512]
        
        text_embedding, image_embeddings = await embedding_service.process_product_embeddings(
            description, image_data_list
        )
        
        assert len(text_embedding) == 1536
        assert len(image_embeddings) == 1
        assert len(image_embeddings[0]) == 512
    
    def test_normalize_vector(self, embedding_service):
        """Test vector normalization."""
        vector = [1.0, 2.0, 3.0]
        normalized = embedding_service._normalize_vector(vector)
        
        # Check that normalized vector has unit length
        import math
        magnitude = math.sqrt(sum(x * x for x in normalized))
        assert abs(magnitude - 1.0) < 1e-6
    
    def test_normalize_zero_vector(self, embedding_service):
        """Test normalization of zero vector."""
        vector = [0.0, 0.0, 0.0]
        normalized = embedding_service._normalize_vector(vector)
        
        # Zero vector should remain unchanged
        assert normalized == vector
    
    def test_get_cache_stats(self, embedding_service):
        """Test cache statistics retrieval."""
        stats = embedding_service.get_cache_stats()
        
        expected_keys = {
            'text_cache_size', 'image_cache_size', 'text_model', 
            'text_dimensions', 'image_dimensions', 'batch_size'
        }
        assert set(stats.keys()) == expected_keys
        assert stats['text_dimensions'] == 1536
        assert stats['image_dimensions'] == 512
        assert stats['text_model'] == "text-embedding-3-small"
    
    def test_clear_cache(self, embedding_service):
        """Test cache clearing."""
        # Add some items to cache
        embedding_service._text_cache['test'] = [0.1] * 1536
        embedding_service._image_cache['test'] = [0.1] * 512
        
        assert len(embedding_service._text_cache) == 1
        assert len(embedding_service._image_cache) == 1
        
        embedding_service.clear_cache()
        
        assert len(embedding_service._text_cache) == 0
        assert len(embedding_service._image_cache) == 0
    
    @pytest.mark.asyncio
    async def test_openai_api_error_handling(self, embedding_service, mock_openai_client):
        """Test handling of OpenAI API errors."""
        mock_openai_client.embeddings.create.side_effect = Exception("API Error")
        
        with pytest.raises(Exception, match="API Error"):
            await embedding_service.generate_text_embedding("test text")
    
    def test_image_processing_error_handling(self, embedding_service):
        """Test handling of image processing errors."""
        invalid_image_data = b"not an image"
        
        with pytest.raises(Exception):
            embedding_service.generate_image_embedding(invalid_image_data)
    
    def test_image_format_conversion(self, embedding_service, mock_clip_model):
        """Test conversion of different image formats."""
        # Create RGBA image (should be converted to RGB)
        img = Image.new('RGBA', (100, 100), color=(255, 0, 0, 128))
        img_bytes = io.BytesIO()
        img.save(img_bytes, format='PNG')
        image_data = img_bytes.getvalue()
        
        embedding = embedding_service.generate_image_embedding(image_data)
        
        assert len(embedding) == 512
        mock_clip_model.encode.assert_called_once()
        
        # Verify that the image was converted to RGB
        call_args = mock_clip_model.encode.call_args[0]
        processed_image = call_args[0]
        assert processed_image.mode == 'RGB'


class TestEmbeddingServiceConfiguration:
    """Test EmbeddingService configuration and settings."""
    
    def test_default_configuration(self):
        """Test default configuration values."""
        service = EmbeddingService()
        
        assert service.text_model == "text-embedding-3-small"
        assert service.text_dimensions == 1536
        assert service.image_dimensions == 512
        assert service.batch_size == 32
    
    @patch('src.counterfeit_detection.services.embedding_service.get_settings')
    def test_custom_configuration(self, mock_get_settings):
        """Test custom configuration from settings."""
        mock_settings = MagicMock()
        mock_settings.openai_api_key = "test-key"
        mock_get_settings.return_value = mock_settings
        
        service = EmbeddingService()
        
        # Verify that settings were used
        mock_get_settings.assert_called_once()
    
    def test_lazy_clip_model_loading(self):
        """Test that CLIP model is loaded lazily."""
        service = EmbeddingService()
        
        # Model should not be loaded initially
        assert service._clip_model is None
        
        # Accessing clip_model property should trigger loading
        with patch('src.counterfeit_detection.services.embedding_service.SentenceTransformer') as mock_st:
            mock_model = MagicMock()
            mock_st.return_value = mock_model
            
            model = service.clip_model
            
            assert model == mock_model
            mock_st.assert_called_once_with('sentence-transformers/clip-ViT-B-32')
    
    @pytest.mark.asyncio
    async def test_batch_size_handling(self, mock_openai_client):
        """Test batch size handling in batch processing."""
        service = EmbeddingService(openai_client=mock_openai_client)
        service.batch_size = 2  # Small batch size for testing
        
        texts = ["text1", "text2", "text3", "text4", "text5"]  # 5 texts, batch_size=2
        
        # Mock multiple batch responses  
        def mock_create_embedding(**kwargs):
            mock_response = MagicMock()
            input_texts = kwargs['input']
            mock_response.data = [MagicMock() for _ in input_texts]
            for i, data in enumerate(mock_response.data):
                data.embedding = [0.1 + i * 0.1] * 1536
            return mock_response
        
        mock_openai_client.embeddings.create.side_effect = mock_create_embedding
        
        embeddings = await service.generate_text_embeddings_batch(texts)
        
        assert len(embeddings) == 5
        # Should make 3 API calls: batch1(2), batch2(2), batch3(1)
        assert mock_openai_client.embeddings.create.call_count == 3