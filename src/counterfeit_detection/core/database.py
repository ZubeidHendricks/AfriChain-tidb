"""
Database configuration and session management.
"""

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import declarative_base
import structlog

from .config import get_settings

logger = structlog.get_logger(__name__)

# Database base class
Base = declarative_base()

# Global engine and session maker
_engine = None
_session_maker = None


def get_engine():
    """Get the database engine."""
    global _engine
    if _engine is None:
        settings = get_settings()
        _engine = create_async_engine(
            settings.database_url,
            echo=settings.debug,
            pool_pre_ping=True,
            pool_recycle=3600
        )
        logger.info("Database engine created", database_url=settings.database_url)
    return _engine


def get_session_maker():
    """Get the session maker."""
    global _session_maker
    if _session_maker is None:
        engine = get_engine()
        _session_maker = async_sessionmaker(
            engine,
            class_=AsyncSession,
            expire_on_commit=False
        )
        logger.info("Database session maker created")
    return _session_maker


async def get_db_session() -> AsyncSession:
    """
    Dependency to get database session.
    This should be used with FastAPI's Depends.
    """
    session_maker = get_session_maker()
    async with session_maker() as session:
        try:
            yield session
        except Exception as e:
            logger.error("Database session error", error=str(e))
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_database():
    """Initialize database schema."""
    engine = get_engine()
    
    # Import all models to ensure they're registered
    from ..models import database
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    logger.info("Database schema initialized")


async def close_database():
    """Close database connections."""
    global _engine
    if _engine:
        await _engine.dispose()
        logger.info("Database connections closed")