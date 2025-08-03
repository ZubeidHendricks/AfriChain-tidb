"""
Health check endpoint for system monitoring.
"""

from datetime import datetime
from typing import Dict, Any

import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ....config.database import check_database_connection
from ....config.redis import check_redis_connection

logger = structlog.get_logger(module=__name__)

router = APIRouter()


class HealthResponse(BaseModel):
    """Health check response model."""
    status: str
    timestamp: datetime
    services: Dict[str, Any]
    version: str


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """
    Comprehensive health check endpoint.
    
    Returns:
        HealthResponse: System health status including all services
        
    Raises:
        HTTPException: If critical services are unavailable
    """
    # Check database connection with logging
    try:
        db_healthy = await check_database_connection()
        if not db_healthy:
            logger.warning("Database health check failed")
    except Exception as e:
        logger.error("Database health check error", error=str(e))
        db_healthy = False
    
    # Check Redis connection with logging
    try:
        redis_healthy = await check_redis_connection()
        if not redis_healthy:
            logger.warning("Redis health check failed")
    except Exception as e:
        logger.error("Redis health check error", error=str(e))
        redis_healthy = False
    
    # Determine overall status
    overall_status = "healthy" if db_healthy and redis_healthy else "degraded"
    
    # Log health check results
    logger.info(
        "Health check completed",
        overall_status=overall_status,
        database_healthy=db_healthy,
        redis_healthy=redis_healthy
    )
    
    # Build response
    response = HealthResponse(
        status=overall_status,
        timestamp=datetime.utcnow(),
        version="1.0.0",
        services={
            "database": {
                "status": "healthy" if db_healthy else "unhealthy",
                "type": "TiDB Serverless",
                "description": "Primary database for product and analysis data"
            },
            "redis": {
                "status": "healthy" if redis_healthy else "unhealthy", 
                "type": "Redis Cache",
                "description": "Agent communication and caching layer"
            },
            "api": {
                "status": "healthy",
                "type": "FastAPI",
                "description": "REST API service"
            }
        }
    )
    
    # Return 503 if critical services are down
    if not db_healthy:
        raise HTTPException(
            status_code=503,
            detail="Database connection unavailable"
        )
    
    return response


@router.get("/health/liveness")
async def liveness_probe() -> Dict[str, str]:
    """
    Kubernetes liveness probe endpoint.
    
    Returns:
        Dict[str, str]: Simple alive status
    """
    return {"status": "alive"}


@router.get("/health/readiness")
async def readiness_probe() -> Dict[str, str]:
    """
    Kubernetes readiness probe endpoint.
    
    Returns:
        Dict[str, str]: Ready status if all services are available
        
    Raises:
        HTTPException: If services are not ready
    """
    db_healthy = await check_database_connection()
    redis_healthy = await check_redis_connection()
    
    if not (db_healthy and redis_healthy):
        raise HTTPException(
            status_code=503,
            detail="Services not ready"
        )
    
    return {"status": "ready"}