"""
Pytest configuration and fixtures.
"""

import os
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from httpx import AsyncClient

# Set test environment
os.environ["APP_ENV"] = "testing"
os.environ["APP_DEBUG"] = "false"
os.environ["TIDB_HOST"] = "localhost"
os.environ["TIDB_USER"] = "test"
os.environ["TIDB_PASSWORD"] = "test"
os.environ["TIDB_DATABASE"] = "test_db"
os.environ["SECRET_KEY"] = "test_secret_key"

from src.counterfeit_detection.main import app


@pytest.fixture
def client() -> TestClient:
    """
    Create test client for FastAPI app.
    
    Returns:
        TestClient: FastAPI test client
    """
    return TestClient(app)


@pytest_asyncio.fixture
async def async_client() -> AsyncGenerator[AsyncClient, None]:
    """
    Create async test client for FastAPI app.
    
    Yields:
        AsyncClient: Async test client
    """
    async with AsyncClient(app=app, base_url="http://test") as client:
        yield client