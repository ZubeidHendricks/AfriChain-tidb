"""
Tests for TestAgent implementation.
"""

import asyncio
import pytest
from unittest.mock import AsyncMock, patch

from src.counterfeit_detection.agents.test_agent import (
    TestAgent,
    create_test_agent,
    test_agent_communication,
    test_multiple_agents
)
from src.counterfeit_detection.agents.base import (
    AgentMessage,
    AgentResponse,
    AgentStatus
)


class TestTestAgent:
    """Test TestAgent implementation."""
    
    @pytest.fixture
    def test_agent(self):
        """Create test agent for testing."""
        return TestAgent("test_agent_001")
    
    @pytest.fixture
    async def mock_redis(self):
        """Mock Redis client."""
        with patch('src.counterfeit_detection.config.redis.get_redis_client') as mock:
            redis_client = AsyncMock()
            mock.return_value = redis_client
            yield redis_client
    
    def test_test_agent_initialization(self, test_agent):
        """Test TestAgent initialization."""
        assert test_agent.agent_id == "test_agent_001"
        assert test_agent.agent_type == "test_agent"
        assert test_agent.version == "1.0.0"
        assert len(test_agent.capabilities) == 3
        
        # Check capabilities
        capability_names = [cap.name for cap in test_agent.capabilities]
        assert "echo" in capability_names
        assert "calculator" in capability_names
        assert "health_check" in capability_names
        
        # Check initial state
        assert test_agent.processed_requests == 0
        assert len(test_agent.calculation_cache) == 0
    
    @pytest.mark.asyncio
    async def test_echo_request_handling(self, test_agent):
        """Test echo request processing."""
        message = AgentMessage(
            sender_id="test_sender",
            message_type="echo_request",
            payload={"text": "Hello, World!"}
        )
        
        response = await test_agent.process_message(message)
        
        assert response.success is True
        assert response.result["echo"] == "Hello, World!"
        assert response.result["original_sender"] == "test_sender"
        assert response.result["processed_by"] == test_agent.agent_id
        assert "timestamp" in response.result
        assert test_agent.processed_requests == 1
    
    @pytest.mark.asyncio
    async def test_calculation_request_handling(self, test_agent):
        """Test calculation request processing."""
        # Test addition
        message = AgentMessage(
            sender_id="test_sender",
            message_type="calculation_request",
            payload={
                "operation": "add",
                "operands": [10, 20, 30]
            }
        )
        
        response = await test_agent.process_message(message)
        
        assert response.success is True
        assert response.result["operation"] == "add"
        assert response.result["operands"] == [10, 20, 30]
        assert response.result["result"] == 60
        assert response.result["from_cache"] is False
        assert test_agent.processed_requests == 1
        
        # Test that result is cached
        response2 = await test_agent.process_message(message)
        assert response2.result["from_cache"] is True
        assert len(test_agent.calculation_cache) == 1
    
    @pytest.mark.asyncio
    async def test_calculation_operations(self, test_agent):
        """Test various calculation operations."""
        operations_tests = [
            ("add", [5, 3], 8),
            ("subtract", [10, 3], 7),
            ("multiply", [4, 5], 20),
            ("divide", [15, 3], 5),
            ("power", [2, 3], 8),
            ("sqrt", [16], 4)
        ]
        
        for operation, operands, expected in operations_tests:
            message = AgentMessage(
                sender_id="test_sender",
                message_type="calculation_request",
                payload={
                    "operation": operation,
                    "operands": operands
                }
            )
            
            response = await test_agent.process_message(message)
            
            assert response.success is True, f"Operation {operation} failed"
            assert response.result["result"] == expected, f"Operation {operation}: expected {expected}, got {response.result['result']}"
    
    @pytest.mark.asyncio
    async def test_calculation_error_handling(self, test_agent):
        """Test calculation error handling."""
        # Test division by zero
        message = AgentMessage(
            sender_id="test_sender",
            message_type="calculation_request",
            payload={
                "operation": "divide",
                "operands": [10, 0]
            }
        )
        
        response = await test_agent.process_message(message)
        
        assert response.success is False
        assert "Division by zero" in response.error
        
        # Test unknown operation
        message = AgentMessage(
            sender_id="test_sender",
            message_type="calculation_request",
            payload={
                "operation": "unknown_op",
                "operands": [1, 2]
            }
        )
        
        response = await test_agent.process_message(message)
        
        assert response.success is False
        assert "Unknown operation" in response.error
        
        # Test missing operands
        message = AgentMessage(
            sender_id="test_sender",
            message_type="calculation_request",
            payload={
                "operation": "add",
                "operands": []
            }
        )
        
        response = await test_agent.process_message(message)
        
        assert response.success is False
        assert "Missing operation or operands" in response.error
    
    @pytest.mark.asyncio
    async def test_health_request_handling(self, test_agent, mock_redis):
        """Test health request processing."""
        # Start agent to set started_at
        await test_agent.start()
        
        message = AgentMessage(
            sender_id="test_sender",
            message_type="health_request",
            payload={}
        )
        
        response = await test_agent.process_message(message)
        
        assert response.success is True
        assert response.result["status"] == AgentStatus.RUNNING.value
        assert response.result["uptime_seconds"] >= 0
        assert response.result["processed_messages"] >= 0
        assert response.result["processed_requests"] >= 1
        assert response.result["error_count"] == 0
        assert response.result["cache_size"] == 0
        assert len(response.result["capabilities"]) == 3
        
        await test_agent.stop()
    
    @pytest.mark.asyncio
    async def test_status_request_handling(self, test_agent):
        """Test status request processing."""
        message = AgentMessage(
            sender_id="test_sender",
            message_type="status_request",
            payload={}
        )
        
        response = await test_agent.process_message(message)
        
        assert response.success is True
        assert response.result["agent_id"] == test_agent.agent_id
        assert response.result["agent_type"] == test_agent.agent_type
        assert response.result["version"] == test_agent.version
        assert response.result["status"] == test_agent.status.value
        assert len(response.result["capabilities"]) == 3
        
        # Check capability details
        capabilities = response.result["capabilities"]
        echo_cap = next(cap for cap in capabilities if cap["name"] == "echo")
        assert echo_cap["description"] == "Echo messages back to sender"
        assert "echo_request" in echo_cap["input_types"]
        assert "echo_response" in echo_cap["output_types"]
    
    @pytest.mark.asyncio
    async def test_ping_request_handling(self, test_agent):
        """Test ping request processing."""
        message = AgentMessage(
            sender_id="test_sender",
            message_type="ping",
            payload={}
        )
        
        response = await test_agent.process_message(message)
        
        assert response.success is True
        assert response.result["pong"] is True
        assert response.result["agent_id"] == test_agent.agent_id
        assert response.result["request_id"] == message.message_id
        assert "timestamp" in response.result
    
    @pytest.mark.asyncio
    async def test_unknown_message_type(self, test_agent):
        """Test handling of unknown message types."""
        message = AgentMessage(
            sender_id="test_sender",
            message_type="unknown_message",
            payload={}
        )
        
        response = await test_agent.process_message(message)
        
        assert response.success is False
        assert "Unknown message type" in response.error
    
    @pytest.mark.asyncio
    async def test_performance_metrics(self, test_agent):
        """Test that performance metrics are tracked."""
        message = AgentMessage(
            sender_id="test_sender",
            message_type="ping",
            payload={}
        )
        
        response = await test_agent.process_message(message)
        
        assert response.success is True
        assert response.processing_time_ms > 0
        assert isinstance(response.processing_time_ms, float)
    
    @pytest.mark.asyncio
    async def test_create_test_agent_function(self, mock_redis):
        """Test create_test_agent utility function."""
        agent = await create_test_agent("utility_test_agent")
        
        assert agent.agent_id == "utility_test_agent"
        assert agent.status == AgentStatus.RUNNING
        
        await agent.stop()
    
    @pytest.mark.asyncio
    async def test_concurrent_message_processing(self, test_agent):
        """Test concurrent message processing."""
        # Create multiple messages
        messages = []
        for i in range(10):
            message = AgentMessage(
                sender_id=f"sender_{i:03d}",
                message_type="calculation_request",
                payload={
                    "operation": "add",
                    "operands": [i, i * 2]
                }
            )
            messages.append(message)
        
        # Process messages concurrently
        tasks = [test_agent.process_message(msg) for msg in messages]
        responses = await asyncio.gather(*tasks)
        
        # Verify all responses
        assert len(responses) == 10
        for i, response in enumerate(responses):
            assert response.success is True
            expected_result = i + (i * 2)  # i + i*2
            assert response.result["result"] == expected_result
        
        assert test_agent.processed_requests == 10
    
    @pytest.mark.asyncio
    async def test_calculation_cache_behavior(self, test_agent):
        """Test calculation cache behavior."""
        # Same calculation should be cached
        message1 = AgentMessage(
            sender_id="sender_1",
            message_type="calculation_request",
            payload={"operation": "multiply", "operands": [6, 7]}
        )
        
        message2 = AgentMessage(
            sender_id="sender_2", 
            message_type="calculation_request",
            payload={"operation": "multiply", "operands": [6, 7]}
        )
        
        # First calculation
        response1 = await test_agent.process_message(message1)
        assert response1.success is True
        assert response1.result["from_cache"] is False
        assert response1.result["result"] == 42
        
        # Second identical calculation should use cache
        response2 = await test_agent.process_message(message2)
        assert response2.success is True
        assert response2.result["from_cache"] is True
        assert response2.result["result"] == 42
        
        # Different calculation should not use cache
        message3 = AgentMessage(
            sender_id="sender_3",
            message_type="calculation_request", 
            payload={"operation": "multiply", "operands": [6, 8]}
        )
        
        response3 = await test_agent.process_message(message3)
        assert response3.success is True
        assert response3.result["from_cache"] is False
        assert response3.result["result"] == 48
        
        # Verify cache has 2 entries
        assert len(test_agent.calculation_cache) == 2


class TestAgentIntegrationFunctions:
    """Test integration test functions."""
    
    @pytest.fixture
    async def mock_redis(self):
        """Mock Redis client."""
        with patch('src.counterfeit_detection.config.redis.get_redis_client') as mock:
            redis_client = AsyncMock()
            mock.return_value = redis_client
            yield redis_client
    
    @pytest.mark.asyncio
    async def test_agent_communication_integration(self, mock_redis):
        """Test test_agent_communication function."""
        # This would normally run the integration test
        # For unit tests, we just verify it can be called without error
        
        # Mock the agent creation and messaging
        with patch('src.counterfeit_detection.agents.test_agent.create_test_agent') as mock_create:
            mock_agent = AsyncMock()
            mock_agent.agent_id = "test_agent_001"
            mock_agent.send_message.return_value = AsyncMock(
                success=True,
                result={"echo": "test response"}
            )
            mock_create.return_value = mock_agent
            
            # This should complete without error
            await test_agent_communication()
            
            # Verify agent was created and used
            mock_create.assert_called_once()
            mock_agent.stop.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_multiple_agents_integration(self, mock_redis):
        """Test test_multiple_agents function."""
        # Mock multiple agent creation
        with patch('src.counterfeit_detection.agents.test_agent.create_test_agent') as mock_create:
            mock_agents = []
            for i in range(3):
                mock_agent = AsyncMock()
                mock_agent.agent_id = f"test_agent_{i:03d}"
                mock_agent.send_message.return_value = AsyncMock(
                    success=True,
                    result={"pong": True}
                )
                mock_agents.append(mock_agent)
            
            mock_create.side_effect = mock_agents
            
            # This should complete without error
            await test_multiple_agents()
            
            # Verify all agents were created and stopped
            assert mock_create.call_count == 3
            for mock_agent in mock_agents:
                mock_agent.stop.assert_called_once()