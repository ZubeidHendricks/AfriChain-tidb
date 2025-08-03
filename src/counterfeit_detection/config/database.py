"""
Database configuration and connection management.
"""

import structlog
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .settings import get_settings

logger = structlog.get_logger(module=__name__)
settings = get_settings()

# Create async engine with connection pooling and security settings
engine = create_async_engine(
    settings.database_url,
    echo=settings.app_debug,
    pool_size=20,
    max_overflow=30,
    pool_pre_ping=True,  # Validate connections before use
    pool_recycle=3600,   # Recycle connections every hour
    pool_timeout=30,     # Timeout for getting connection from pool
    # Security: Prevent SQL injection in connection params
    connect_args={
        "charset": "utf8mb4",
        "autocommit": False,
    } if not settings.tidb_ssl_verify else {
        "charset": "utf8mb4", 
        "autocommit": False,
        "ssl_disabled": False,
    }
)

# Create session factory
async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False
)


class Base(DeclarativeBase):
    """Base class for all database models."""
    pass


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """
    Dependency to get database session.
    
    Yields:
        AsyncSession: Database session
    """
    async with async_session_maker() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def check_database_connection() -> bool:
    """
    Check if database connection is working.
    
    Returns:
        bool: True if connection is successful, False otherwise
    """
    try:
        async with async_session_maker() as session:
            result = await session.execute("SELECT 1 as health_check")
            row = result.fetchone()
            if row and row[0] == 1:
                logger.debug("Database connection check successful")
                return True
            logger.warning("Database connection check returned unexpected result")
            return False
    except Exception as e:
        logger.error("Database connection check failed", error=str(e), error_type=type(e).__name__)
        return False