"""
Application configuration settings.
"""

import os
from typing import Optional
from pydantic import BaseSettings, Field


class Settings(BaseSettings):
    """Application settings."""
    
    # Database configuration
    database_url: str = Field(
        default="mysql://root:password@localhost:4000/counterfeit_detection",
        env="DATABASE_URL"
    )
    
    # OpenAI configuration
    openai_api_key: Optional[str] = Field(default=None, env="OPENAI_API_KEY")
    
    # Vector embedding configuration
    text_embedding_model: str = Field(default="text-embedding-3-small", env="TEXT_EMBEDDING_MODEL")
    text_embedding_dimensions: int = Field(default=1536, env="TEXT_EMBEDDING_DIMENSIONS")
    image_embedding_model: str = Field(default="sentence-transformers/clip-ViT-B-32", env="IMAGE_EMBEDDING_MODEL")
    image_embedding_dimensions: int = Field(default=512, env="IMAGE_EMBEDDING_DIMENSIONS")
    embedding_batch_size: int = Field(default=32, env="EMBEDDING_BATCH_SIZE")
    
    # Storage configuration
    storage_base_path: str = Field(default="storage/products", env="STORAGE_BASE_PATH")
    max_file_size_mb: int = Field(default=5, env="MAX_FILE_SIZE_MB")
    max_files_per_product: int = Field(default=10, env="MAX_FILES_PER_PRODUCT")
    
    # API configuration
    api_v1_prefix: str = "/api/v1"
    cors_origins: list = ["*"]
    
    # Logging configuration
    log_level: str = Field(default="INFO", env="LOG_LEVEL")
    
    # Development settings
    debug: bool = Field(default=False, env="DEBUG")
    
    class Config:
        env_file = ".env"
        case_sensitive = False


# Global settings instance
_settings: Optional[Settings] = None


def get_settings() -> Settings:
    """Get application settings singleton."""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings