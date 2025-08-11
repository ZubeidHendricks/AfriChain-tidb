"""
Embedding service for generating vector embeddings of text and images.
"""

import asyncio
import logging
from typing import List, Optional, Dict, Any, Tuple
import numpy as np
from openai import AsyncOpenAI
from sentence_transformers import SentenceTransformer
from PIL import Image
import io
import json
from datetime import datetime

from ..core.config import get_settings
from ..core.logging import get_logger


class EmbeddingService:
    """Service for generating text and image embeddings."""
    
    def __init__(self, openai_client: Optional[AsyncOpenAI] = None):
        """Initialize embedding service."""
        self.settings = get_settings()
        self.logger = get_logger(__name__)
        
        # OpenAI client for text embeddings
        self.openai_client = openai_client or AsyncOpenAI(
            api_key=self.settings.openai_api_key
        )
        
        # CLIP model for image embeddings (loaded lazily)
        self._clip_model = None
        
        # Configuration
        self.text_model = "text-embedding-3-small"
        self.text_dimensions = 1536
        self.image_dimensions = 512
        self.batch_size = 32
        
        # Embedding cache
        self._text_cache: Dict[str, List[float]] = {}
        self._image_cache: Dict[str, List[float]] = {}
        
        self.logger.info("EmbeddingService initialized")
    
    @property
    def clip_model(self) -> SentenceTransformer:
        """Lazy load CLIP model."""
        if self._clip_model is None:
            self.logger.info("Loading CLIP model: sentence-transformers/clip-ViT-B-32")
            self._clip_model = SentenceTransformer('sentence-transformers/clip-ViT-B-32')
            self.logger.info("CLIP model loaded successfully")
        return self._clip_model
    
    async def generate_text_embedding(self, text: str) -> List[float]:
        """
        Generate text embedding using OpenAI text-embedding-3-small.
        
        Args:
            text: Text to embed
            
        Returns:
            1536-dimensional embedding vector
        """
        if not text or not text.strip():
            raise ValueError("Text cannot be empty")
        
        # Check cache first
        cache_key = self._get_text_cache_key(text)
        if cache_key in self._text_cache:
            self.logger.debug(f"Using cached embedding for text: {text[:50]}...")
            return self._text_cache[cache_key]
        
        try:
            self.logger.debug(f"Generating embedding for text: {text[:100]}...")
            
            response = await self.openai_client.embeddings.create(
                model=self.text_model,
                input=text.strip(),
                dimensions=self.text_dimensions
            )
            
            embedding = response.data[0].embedding
            
            # Cache the result
            self._text_cache[cache_key] = embedding
            
            self.logger.debug(f"Generated {len(embedding)}-dimensional text embedding")
            return embedding
            
        except Exception as e:
            self.logger.error(f"Failed to generate text embedding: {e}")
            raise
    
    async def generate_text_embeddings_batch(self, texts: List[str]) -> List[List[float]]:
        """
        Generate text embeddings in batches for efficiency.
        
        Args:
            texts: List of texts to embed
            
        Returns:
            List of 1536-dimensional embedding vectors
        """
        if not texts:
            return []
        
        embeddings = []
        
        # Process in batches
        for i in range(0, len(texts), self.batch_size):
            batch = texts[i:i + self.batch_size]
            
            # Check cache for each text in batch
            batch_embeddings = []
            texts_to_embed = []
            cached_indices = {}
            
            for j, text in enumerate(batch):
                cache_key = self._get_text_cache_key(text)
                if cache_key in self._text_cache:
                    batch_embeddings.append(self._text_cache[cache_key])
                    cached_indices[j] = len(batch_embeddings) - 1
                else:
                    texts_to_embed.append(text)
            
            # Generate embeddings for non-cached texts
            if texts_to_embed:
                try:
                    self.logger.debug(f"Generating embeddings for batch of {len(texts_to_embed)} texts")
                    
                    response = await self.openai_client.embeddings.create(
                        model=self.text_model,
                        input=texts_to_embed,
                        dimensions=self.text_dimensions
                    )
                    
                    new_embeddings = [data.embedding for data in response.data]
                    
                    # Cache new embeddings
                    for text, embedding in zip(texts_to_embed, new_embeddings):
                        cache_key = self._get_text_cache_key(text)
                        self._text_cache[cache_key] = embedding
                    
                    # Merge cached and new embeddings in correct order
                    new_embedding_idx = 0
                    for j in range(len(batch)):
                        if j in cached_indices:
                            continue
                        else:
                            batch_embeddings.insert(j, new_embeddings[new_embedding_idx])
                            new_embedding_idx += 1
                    
                except Exception as e:
                    self.logger.error(f"Failed to generate batch embeddings: {e}")
                    # Fallback to individual generation
                    for text in texts_to_embed:
                        try:
                            embedding = await self.generate_text_embedding(text)
                            batch_embeddings.append(embedding)
                        except Exception as individual_error:
                            self.logger.error(f"Failed individual embedding: {individual_error}")
                            # Use zero vector as fallback
                            batch_embeddings.append([0.0] * self.text_dimensions)
            
            embeddings.extend(batch_embeddings)
        
        self.logger.info(f"Generated {len(embeddings)} text embeddings")
        return embeddings
    
    def generate_image_embedding(self, image_data: bytes) -> List[float]:
        """
        Generate image embedding using CLIP model.
        
        Args:
            image_data: Raw image bytes
            
        Returns:
            512-dimensional embedding vector
        """
        # Check cache first
        cache_key = self._get_image_cache_key(image_data)
        if cache_key in self._image_cache:
            self.logger.debug("Using cached image embedding")
            return self._image_cache[cache_key]
        
        try:
            # Load and preprocess image
            image = Image.open(io.BytesIO(image_data))
            
            # Convert to RGB if necessary
            if image.mode != 'RGB':
                image = image.convert('RGB')
            
            # Generate embedding using CLIP
            self.logger.debug("Generating image embedding with CLIP")
            embedding = self.clip_model.encode(image, convert_to_tensor=False)
            
            # Convert to list and ensure correct dimensions
            if hasattr(embedding, 'tolist'):
                embedding = embedding.tolist()
            
            # Normalize embedding
            embedding = self._normalize_vector(embedding)
            
            # Cache the result
            self._image_cache[cache_key] = embedding
            
            self.logger.debug(f"Generated {len(embedding)}-dimensional image embedding")
            return embedding
            
        except Exception as e:
            self.logger.error(f"Failed to generate image embedding: {e}")
            raise
    
    def generate_image_embeddings_batch(self, image_data_list: List[bytes]) -> List[List[float]]:
        """
        Generate image embeddings in batches for efficiency.
        
        Args:
            image_data_list: List of raw image bytes
            
        Returns:
            List of 512-dimensional embedding vectors
        """
        if not image_data_list:
            return []
        
        embeddings = []
        images_to_embed = []
        cached_embeddings = {}
        
        # Check cache for each image
        for i, image_data in enumerate(image_data_list):
            cache_key = self._get_image_cache_key(image_data)
            if cache_key in self._image_cache:
                cached_embeddings[i] = self._image_cache[cache_key]
            else:
                images_to_embed.append((i, image_data))
        
        # Generate embeddings for non-cached images
        if images_to_embed:
            try:
                self.logger.debug(f"Generating embeddings for batch of {len(images_to_embed)} images")
                
                # Load images
                images = []
                for _, image_data in images_to_embed:
                    image = Image.open(io.BytesIO(image_data))
                    if image.mode != 'RGB':
                        image = image.convert('RGB')
                    images.append(image)
                
                # Generate embeddings in batch
                batch_embeddings = self.clip_model.encode(images, convert_to_tensor=False)
                
                # Process and cache embeddings
                for (original_idx, image_data), embedding in zip(images_to_embed, batch_embeddings):
                    if hasattr(embedding, 'tolist'):
                        embedding = embedding.tolist()
                    
                    embedding = self._normalize_vector(embedding)
                    
                    # Cache the result
                    cache_key = self._get_image_cache_key(image_data)
                    self._image_cache[cache_key] = embedding
                    cached_embeddings[original_idx] = embedding
                
            except Exception as e:
                self.logger.error(f"Failed to generate batch image embeddings: {e}")
                # Fallback to individual generation
                for original_idx, image_data in images_to_embed:
                    try:
                        embedding = self.generate_image_embedding(image_data)
                        cached_embeddings[original_idx] = embedding
                    except Exception as individual_error:
                        self.logger.error(f"Failed individual image embedding: {individual_error}")
                        # Use zero vector as fallback
                        cached_embeddings[original_idx] = [0.0] * self.image_dimensions
        
        # Reconstruct embeddings in original order
        for i in range(len(image_data_list)):
            embeddings.append(cached_embeddings[i])
        
        self.logger.info(f"Generated {len(embeddings)} image embeddings")
        return embeddings
    
    async def process_product_embeddings(
        self, 
        description: str, 
        image_data_list: List[bytes]
    ) -> Tuple[List[float], List[List[float]]]:
        """
        Process both text and image embeddings for a product.
        
        Args:
            description: Product description text
            image_data_list: List of product image data
            
        Returns:
            Tuple of (text_embedding, image_embeddings)
        """
        start_time = datetime.now()
        
        try:
            # Generate text embedding
            text_embedding_task = self.generate_text_embedding(description)
            
            # Generate image embeddings (run in executor to avoid blocking)
            loop = asyncio.get_event_loop()
            image_embeddings_task = loop.run_in_executor(
                None, 
                self.generate_image_embeddings_batch, 
                image_data_list
            )
            
            # Wait for both to complete
            text_embedding, image_embeddings = await asyncio.gather(
                text_embedding_task,
                image_embeddings_task
            )
            
            processing_time = (datetime.now() - start_time).total_seconds() * 1000
            
            self.logger.info(
                f"Processed embeddings for product: "
                f"text_dim={len(text_embedding)}, "
                f"images={len(image_embeddings)}, "
                f"time={processing_time:.2f}ms"
            )
            
            return text_embedding, image_embeddings
            
        except Exception as e:
            self.logger.error(f"Failed to process product embeddings: {e}")
            raise
    
    def _get_text_cache_key(self, text: str) -> str:
        """Generate cache key for text."""
        import hashlib
        return hashlib.md5(text.strip().encode()).hexdigest()
    
    def _get_image_cache_key(self, image_data: bytes) -> str:
        """Generate cache key for image data."""
        import hashlib
        return hashlib.md5(image_data).hexdigest()
    
    def _normalize_vector(self, vector: List[float]) -> List[float]:
        """Normalize vector to unit length."""
        np_vector = np.array(vector)
        norm = np.linalg.norm(np_vector)
        if norm == 0:
            return vector
        return (np_vector / norm).tolist()
    
    def get_cache_stats(self) -> Dict[str, Any]:
        """Get embedding cache statistics."""
        return {
            "text_cache_size": len(self._text_cache),
            "image_cache_size": len(self._image_cache),
            "text_model": self.text_model,
            "text_dimensions": self.text_dimensions,
            "image_dimensions": self.image_dimensions,
            "batch_size": self.batch_size
        }
    
    def clear_cache(self) -> None:
        """Clear embedding caches."""
        self._text_cache.clear()
        self._image_cache.clear()
        self.logger.info("Embedding caches cleared")