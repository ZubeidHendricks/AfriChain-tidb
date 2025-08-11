"""
Tests for health check endpoints.
"""

import pytest
from unittest.mock import patch, AsyncMock

from fastapi.testclient import TestClient
from httpx import AsyncClient


def test_root_endpoint(client: TestClient):
    """Test root endpoint."""
    response = client.get("/")
    assert response.status_code == 200
    
    data = response.json()
    assert data["message"] == "Counterfeit Product Detection API"
    assert data["version"] == "1.0.0"
    assert data["status"] == "operational"


@pytest.mark.asyncio
async def test_health_check_healthy(async_client: AsyncClient):
    """Test health check with all services healthy."""
    with patch("src.counterfeit_detection.api.v1.endpoints.health.check_database_connection", new_callable=AsyncMock) as mock_db, \
         patch("src.counterfeit_detection.api.v1.endpoints.health.check_redis_connection", new_callable=AsyncMock) as mock_redis:
        
        mock_db.return_value = True
        mock_redis.return_value = True
        
        response = await async_client.get("/api/v1/health")
        assert response.status_code == 200
        
        data = response.json()
        assert data["status"] == "healthy"
        assert data["version"] == "1.0.0"
        assert data["services"]["database"]["status"] == "healthy"
        assert data["services"]["redis"]["status"] == "healthy"
        assert data["services"]["api"]["status"] == "healthy"


@pytest.mark.asyncio 
async def test_health_check_database_down(async_client: AsyncClient):
    """Test health check with database down."""
    with patch("src.counterfeit_detection.api.v1.endpoints.health.check_database_connection", new_callable=AsyncMock) as mock_db, \
         patch("src.counterfeit_detection.api.v1.endpoints.health.check_redis_connection", new_callable=AsyncMock) as mock_redis:
        
        mock_db.return_value = False
        mock_redis.return_value = True
        
        response = await async_client.get("/api/v1/health")
        assert response.status_code == 503
        
        data = response.json()
        assert "Database connection unavailable" in data["detail"]


@pytest.mark.asyncio
async def test_health_check_degraded(async_client: AsyncClient):
    """Test health check with Redis down but database up."""
    with patch("src.counterfeit_detection.api.v1.endpoints.health.check_database_connection", new_callable=AsyncMock) as mock_db, \
         patch("src.counterfeit_detection.api.v1.endpoints.health.check_redis_connection", new_callable=AsyncMock) as mock_redis:
        
        mock_db.return_value = True
        mock_redis.return_value = False
        
        response = await async_client.get("/api/v1/health")
        assert response.status_code == 200
        
        data = response.json()
        assert data["status"] == "degraded"
        assert data["services"]["database"]["status"] == "healthy"
        assert data["services"]["redis"]["status"] == "unhealthy"


@pytest.mark.asyncio
async def test_liveness_probe(async_client: AsyncClient):
    """Test liveness probe endpoint."""
    response = await async_client.get("/api/v1/health/liveness")
    assert response.status_code == 200
    
    data = response.json()
    assert data["status"] == "alive"


@pytest.mark.asyncio
async def test_readiness_probe_ready(async_client: AsyncClient):
    """Test readiness probe when ready."""
    with patch("src.counterfeit_detection.api.v1.endpoints.health.check_database_connection", new_callable=AsyncMock) as mock_db, \
         patch("src.counterfeit_detection.api.v1.endpoints.health.check_redis_connection", new_callable=AsyncMock) as mock_redis:
        
        mock_db.return_value = True
        mock_redis.return_value = True
        
        response = await async_client.get("/api/v1/health/readiness")
        assert response.status_code == 200
        
        data = response.json()
        assert data["status"] == "ready"


@pytest.mark.asyncio
async def test_readiness_probe_not_ready(async_client: AsyncClient):
    """Test readiness probe when not ready."""
    with patch("src.counterfeit_detection.api.v1.endpoints.health.check_database_connection", new_callable=AsyncMock) as mock_db, \
         patch("src.counterfeit_detection.api.v1.endpoints.health.check_redis_connection", new_callable=AsyncMock) as mock_redis:
        
        mock_db.return_value = False
        mock_redis.return_value = True
        
        response = await async_client.get("/api/v1/health/readiness")
        assert response.status_code == 503
        
        data = response.json()
        assert "Services not ready" in data["detail"]