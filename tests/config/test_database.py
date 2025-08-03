"""
Tests for database configuration.
"""

import pytest
from unittest.mock import AsyncMock, patch

from src.counterfeit_detection.config.database import check_database_connection


@pytest.mark.asyncio
async def test_database_connection_success():
    """Test successful database connection check."""
    with patch("src.counterfeit_detection.config.database.async_session_maker") as mock_session_maker:
        # Mock successful database response
        mock_session = AsyncMock()
        mock_result = AsyncMock()
        mock_result.fetchone.return_value = (1,)
        mock_session.execute.return_value = mock_result
        mock_session_maker.return_value.__aenter__.return_value = mock_session
        
        result = await check_database_connection()
        assert result is True
        mock_session.execute.assert_called_once_with("SELECT 1 as health_check")


@pytest.mark.asyncio
async def test_database_connection_failure():
    """Test database connection check failure."""
    with patch("src.counterfeit_detection.config.database.async_session_maker") as mock_session_maker:
        # Mock database exception
        mock_session_maker.side_effect = Exception("Connection failed")
        
        result = await check_database_connection()
        assert result is False


@pytest.mark.asyncio
async def test_database_connection_unexpected_result():
    """Test database connection check with unexpected result."""
    with patch("src.counterfeit_detection.config.database.async_session_maker") as mock_session_maker:
        # Mock unexpected database response
        mock_session = AsyncMock()
        mock_result = AsyncMock()
        mock_result.fetchone.return_value = None
        mock_session.execute.return_value = mock_result
        mock_session_maker.return_value.__aenter__.return_value = mock_session
        
        result = await check_database_connection()
        assert result is False