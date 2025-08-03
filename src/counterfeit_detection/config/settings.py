"""
Application settings and configuration management.
"""

from functools import lru_cache
from typing import List, Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False
    )
    
    # Database Configuration
    tidb_host: str = Field(..., description="TiDB host")
    tidb_port: int = Field(4000, description="TiDB port")
    tidb_user: str = Field(..., description="TiDB username")
    tidb_password: str = Field(..., description="TiDB password")
    tidb_database: str = Field(..., description="TiDB database name")
    tidb_ssl_verify: bool = Field(True, description="TiDB SSL verification")
    
    # Redis Configuration
    redis_url: str = Field("redis://localhost:6379/0", description="Redis connection URL")
    
    # AI Service Configuration
    openai_api_key: str = Field(..., description="OpenAI API key")
    anthropic_api_key: Optional[str] = Field(None, description="Anthropic API key (fallback)")
    
    # Application Configuration
    app_env: str = Field("development", description="Application environment")
    app_debug: bool = Field(False, description="Debug mode")
    secret_key: str = Field(..., description="Application secret key")
    jwt_algorithm: str = Field("HS256", description="JWT algorithm")
    jwt_expire_minutes: int = Field(30, description="JWT expiration time in minutes")
    
    # API Configuration
    api_v1_prefix: str = Field("/api/v1", description="API v1 prefix")
    cors_origins: List[str] = Field(
        ["http://localhost:3000", "http://localhost:8000"],
        description="CORS allowed origins"
    )
    
    # Logging Configuration
    log_level: str = Field("INFO", description="Logging level")
    log_format: str = Field("json", description="Log format")
    
    # Rate Limiting
    rate_limit_per_minute: int = Field(60, description="Rate limit per minute")
    
    @property
    def database_url(self) -> str:
        """Construct TiDB connection URL with proper URL encoding."""
        from urllib.parse import quote_plus
        
        # URL encode credentials to handle special characters
        encoded_user = quote_plus(self.tidb_user)
        encoded_password = quote_plus(self.tidb_password)
        
        base_url = (
            f"mysql+aiomysql://{encoded_user}:{encoded_password}"
            f"@{self.tidb_host}:{self.tidb_port}/{self.tidb_database}"
        )
        
        # Add SSL parameters if enabled
        if self.tidb_ssl_verify:
            base_url += "?ssl_verify_cert=true&ssl_check_hostname=true"
        
        return base_url


@lru_cache()
def get_settings() -> Settings:
    """Get cached application settings."""
    return Settings()