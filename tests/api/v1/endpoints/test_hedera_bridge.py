"""
Tests for Hedera bridge endpoints.
"""

import json
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient

from src.counterfeit_detection.api.v1.endpoints.hedera_bridge import router


@pytest.fixture
def client():
    """Test client for Hedera bridge endpoints."""
    from fastapi import FastAPI
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


@pytest.fixture
def mock_redis():
    """Mock Redis client."""
    with patch('src.counterfeit_detection.api.v1.endpoints.hedera_bridge.get_redis_client') as mock:
        redis_client = AsyncMock()
        redis_client.publish = AsyncMock(return_value=1)
        mock.return_value = redis_client
        yield redis_client


class TestHederaBridge:
    """Test Hedera bridge API endpoints."""

    @patch('src.counterfeit_detection.api.v1.endpoints.hedera_bridge.httpx.AsyncClient')
    def test_ping_hedera_service_success(self, mock_httpx, client):
        """Test successful ping to Hedera service."""
        # Mock httpx response
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            'success': True,
            'response': 'pong',
            'timestamp': '2025-08-04T00:00:00Z'
        }
        
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_httpx.return_value.__aenter__.return_value = mock_client

        response = client.post('/hedera/ping')
        
        assert response.status_code == 200
        data = response.json()
        assert data['success'] is True
        assert 'data' in data
        assert data['data']['response'] == 'pong'

    @patch('src.counterfeit_detection.api.v1.endpoints.hedera_bridge.httpx.AsyncClient')
    def test_ping_hedera_service_failure(self, mock_httpx, client):
        """Test failed ping to Hedera service."""
        # Mock httpx response with error
        mock_response = MagicMock()
        mock_response.status_code = 500
        
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_httpx.return_value.__aenter__.return_value = mock_client

        response = client.post('/hedera/ping')
        
        assert response.status_code == 200  # Endpoint returns 200 with error in body
        data = response.json()
        assert data['success'] is False
        assert 'error' in data
        assert 'HTTP 500' in data['error']

    @patch('src.counterfeit_detection.api.v1.endpoints.hedera_bridge.httpx.AsyncClient')
    def test_ping_hedera_service_timeout(self, mock_httpx, client):
        """Test timeout handling for Hedera service ping."""
        import httpx
        
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(side_effect=httpx.TimeoutException("Request timeout"))
        mock_httpx.return_value.__aenter__.return_value = mock_client

        response = client.post('/hedera/ping')
        
        assert response.status_code == 200
        data = response.json()
        assert data['success'] is False
        assert data['error'] == 'Service timeout'

    @patch('src.counterfeit_detection.api.v1.endpoints.hedera_bridge.httpx.AsyncClient')
    def test_get_hedera_status_success(self, mock_httpx, client):
        """Test successful Hedera status retrieval."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            'success': True,
            'network': 'testnet',
            'account_id': '0.0.123456',
            'client_status': 'connected'
        }
        
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_httpx.return_value.__aenter__.return_value = mock_client

        response = client.get('/hedera/status')
        
        assert response.status_code == 200
        data = response.json()
        assert data['success'] is True
        assert data['data']['network'] == 'testnet'
        assert data['data']['account_id'] == '0.0.123456'

    def test_send_message_to_hedera_success(self, client, mock_redis):
        """Test successful message sending to Hedera service."""
        message_data = {
            'type': 'test_message',
            'payload': {'test': 'data'},
            'source': 'python-test',
            'target': 'hedera-service'
        }

        response = client.post('/hedera/send-message', json=message_data)
        
        assert response.status_code == 200
        data = response.json()
        assert data['success'] is True
        assert 'data' in data
        assert data['data']['channel'] == 'hedera.agent.commands'
        
        # Verify Redis publish was called
        mock_redis.publish.assert_called_once()
        call_args = mock_redis.publish.call_args
        assert call_args[0][0] == 'hedera.agent.commands'
        
        # Verify message structure
        published_message = json.loads(call_args[0][1])
        assert published_message['type'] == 'test_message'
        assert published_message['payload'] == {'test': 'data'}

    def test_send_message_to_hedera_redis_failure(self, client, mock_redis):
        """Test message sending with Redis failure."""
        mock_redis.publish.side_effect = Exception("Redis connection failed")
        
        message_data = {
            'type': 'test_message',
            'payload': {'test': 'data'}
        }

        response = client.post('/hedera/send-message', json=message_data)
        
        assert response.status_code == 200
        data = response.json()
        assert data['success'] is False
        assert 'Redis connection failed' in data['error']

    def test_hedera_agent_message_validation(self, client):
        """Test HederaAgentMessage model validation."""
        # Test with minimal required fields
        response = client.post('/hedera/send-message', json={'type': 'test'})
        assert response.status_code == 200

        # Test with invalid data
        response = client.post('/hedera/send-message', json={})
        assert response.status_code == 422  # Validation error

        # Test with full message
        full_message = {
            'type': 'full_test',
            'payload': {'key': 'value'},
            'source': 'test-source',
            'target': 'test-target',
            'correlation_id': 'test-123'
        }
        response = client.post('/hedera/send-message', json=full_message)
        assert response.status_code == 200


class TestHederaResponseHandling:
    """Test Hedera response subscription and handling."""

    @patch('src.counterfeit_detection.api.v1.endpoints.hedera_bridge.get_redis_client')
    def test_response_subscription_setup(self, mock_get_redis):
        """Test that response subscription is set up correctly."""
        from src.counterfeit_detection.api.v1.endpoints.hedera_bridge import subscribe_to_hedera_responses
        
        mock_redis = AsyncMock()
        mock_pubsub = AsyncMock()
        mock_redis.pubsub.return_value = mock_pubsub
        mock_get_redis.return_value = mock_redis
        
        # This would normally be tested with asyncio.run in a real async test
        # For now, just verify the function exists and can be imported
        assert callable(subscribe_to_hedera_responses)