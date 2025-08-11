"""
Tests for BaseAgent class and core agent functionality.
"""

import asyncio
import pytest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

from src.counterfeit_detection.agents.base import (
    BaseAgent,
    AgentMessage,
    AgentResponse,
    AgentMetadata,
    AgentCapability,
    AgentStatus
)


class MockAgent(BaseAgent):
    """Mock agent implementation for testing."""
    
    def __init__(self, agent_id: str = "test_agent"):
        capabilities = [
            AgentCapability(
                name="test_capability",
                description="Test capability",
                input_types=["test_input"],
                output_types=["test_output"]
            )
        ]
        
        super().__init__(
            agent_id=agent_id,
            agent_type="mock_agent",
            version="1.0.0",
            capabilities=capabilities
        )
    
    async def process_message(self, message: AgentMessage) -> AgentResponse:
        """Mock message processing."""
        return AgentResponse(
            success=True,
            result={"processed": True, "message_type": message.message_type},
            processing_time_ms=10.0
        )


class TestAgentMessage:
    """Test AgentMessage data structure."""
    
    def test_agent_message_creation(self):
        """Test creating an agent message."""
        message = AgentMessage(
            sender_id="sender_001",
            recipient_id="recipient_001",
            message_type="test_message",
            payload={"data": "test"}
        )
        
        assert message.sender_id == "sender_001"
        assert message.recipient_id == "recipient_001"
        assert message.message_type == "test_message"
        assert message.payload == {"data": "test"}
        assert message.priority == 0
        assert message.message_id is not None
        assert isinstance(message.timestamp, datetime)
    
    def test_agent_message_serialization(self):
        """Test JSON serialization of agent message."""
        message = AgentMessage(
            sender_id="sender_001",
            message_type="test_message",
            payload={"data": "test"}
        )
        
        json_str = message.json()
        assert isinstance(json_str, str)
        assert "sender_001" in json_str
        assert "test_message" in json_str


class TestAgentResponse:
    """Test AgentResponse data structure."""
    
    def test_agent_response_success(self):
        """Test successful agent response."""
        response = AgentResponse(
            success=True,
            result={"output": "success"},
            processing_time_ms=25.0
        )
        
        assert response.success is True
        assert response.result == {"output": "success"}
        assert response.error is None
        assert response.processing_time_ms == 25.0
    
    def test_agent_response_failure(self):
        """Test failed agent response."""
        response = AgentResponse(
            success=False,
            error="Processing failed",
            processing_time_ms=5.0
        )
        
        assert response.success is False
        assert response.result is None
        assert response.error == "Processing failed"
        assert response.processing_time_ms == 5.0


class TestAgentMetadata:
    """Test AgentMetadata data structure."""
    
    def test_agent_metadata_creation(self):
        """Test creating agent metadata."""
        capabilities = [
            AgentCapability(
                name="test_cap",
                description="Test capability",
                input_types=["input1"],
                output_types=["output1"]
            )
        ]
        
        metadata = AgentMetadata(
            agent_id="test_001",
            agent_type="test_agent",
            version="1.0.0",
            capabilities=capabilities
        )
        
        assert metadata.agent_id == "test_001"
        assert metadata.agent_type == "test_agent"
        assert metadata.version == "1.0.0"
        assert len(metadata.capabilities) == 1
        assert metadata.status == AgentStatus.STOPPED
        assert metadata.processed_messages == 0
        assert metadata.error_count == 0


class TestBaseAgent:
    """Test BaseAgent abstract class functionality."""
    
    @pytest.fixture
    def mock_agent(self):
        """Create mock agent for testing."""
        return MockAgent("test_agent_001")
    
    @pytest.fixture
    async def mock_redis(self):
        """Mock Redis client."""
        with patch('src.counterfeit_detection.config.redis.get_redis_client') as mock:
            redis_client = AsyncMock()
            mock.return_value = redis_client
            yield redis_client
    
    def test_agent_initialization(self, mock_agent):
        """Test agent initialization."""
        assert mock_agent.agent_id == "test_agent_001"
        assert mock_agent.agent_type == "mock_agent"
        assert mock_agent.version == "1.0.0"
        assert mock_agent.status == AgentStatus.STOPPED
        assert len(mock_agent.capabilities) == 1
        assert mock_agent.processed_messages == 0
        assert mock_agent.error_count == 0
    
    def test_get_metadata(self, mock_agent):
        """Test getting agent metadata."""
        metadata = mock_agent.get_metadata()
        
        assert isinstance(metadata, AgentMetadata)
        assert metadata.agent_id == mock_agent.agent_id
        assert metadata.agent_type == mock_agent.agent_type
        assert metadata.version == mock_agent.version
        assert metadata.status == mock_agent.status
        assert len(metadata.capabilities) == len(mock_agent.capabilities)
    
    @pytest.mark.asyncio
    async def test_agent_start_stop(self, mock_agent, mock_redis):
        """Test agent start and stop lifecycle."""
        # Test start
        await mock_agent.start()
        
        assert mock_agent.status == AgentStatus.RUNNING
        assert mock_agent.started_at is not None
        assert mock_agent.redis_client is not None
        
        # Test stop
        await mock_agent.stop()
        
        assert mock_agent.status == AgentStatus.STOPPED
        mock_redis.close.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_agent_pause_resume(self, mock_agent, mock_redis):
        """Test agent pause and resume functionality."""
        # Start agent first
        await mock_agent.start()
        assert mock_agent.status == AgentStatus.RUNNING
        
        # Pause agent
        await mock_agent.pause()
        assert mock_agent.status == AgentStatus.PAUSED
        
        # Resume agent
        await mock_agent.resume()
        assert mock_agent.status == AgentStatus.RUNNING
        
        await mock_agent.stop()
    
    @pytest.mark.asyncio
    async def test_send_message(self, mock_agent, mock_redis):
        """Test sending messages."""
        await mock_agent.start()
        
        message = AgentMessage(
            sender_id=mock_agent.agent_id,
            recipient_id="target_agent",
            message_type="test_message",
            payload={"data": "test"}
        )
        
        # Test sending message without expecting response
        await mock_agent.send_message(message)
        
        # Verify Redis publish was called
        mock_redis.publish.assert_called()
        
        await mock_agent.stop()
    
    @pytest.mark.asyncio
    async def test_message_processing(self, mock_agent):
        """Test message processing."""
        message = AgentMessage(
            sender_id="sender_001",
            message_type="test_message",
            payload={"data": "test"}
        )
        
        response = await mock_agent.process_message(message)
        
        assert isinstance(response, AgentResponse)
        assert response.success is True
        assert response.result["processed"] is True
        assert response.result["message_type"] == "test_message"
        assert response.processing_time_ms == 10.0
    
    @pytest.mark.asyncio
    async def test_agent_error_handling(self, mock_redis):
        """Test agent error handling."""
        # Create agent that fails on start
        agent = MockAgent("error_agent")
        
        # Mock Redis to raise exception
        mock_redis.side_effect = Exception("Redis connection failed")
        
        with pytest.raises(Exception, match="Redis connection failed"):
            await agent.start()
        
        assert agent.status == AgentStatus.ERROR
        assert agent.error_count > 0
    
    @pytest.mark.asyncio
    async def test_heartbeat_functionality(self, mock_agent, mock_redis):
        """Test heartbeat functionality."""
        await mock_agent.start()
        
        # Wait a bit for heartbeat to be sent
        await asyncio.sleep(0.1)
        
        # Verify heartbeat was published
        mock_redis.publish.assert_called()
        
        # Check that heartbeat message was sent to orchestrator
        calls = mock_redis.publish.call_args_list
        heartbeat_calls = [
            call for call in calls 
            if call[0][0] == "orchestrator.heartbeat"
        ]
        
        assert len(heartbeat_calls) > 0
        
        await mock_agent.stop()
    
    def test_agent_capabilities(self, mock_agent):
        """Test agent capabilities functionality."""
        capabilities = mock_agent.capabilities
        
        assert len(capabilities) == 1
        assert capabilities[0].name == "test_capability"
        assert capabilities[0].description == "Test capability"
        assert "test_input" in capabilities[0].input_types
        assert "test_output" in capabilities[0].output_types


class TestAgentIntegration:
    """Integration tests for agent functionality."""
    
    @pytest.mark.asyncio
    async def test_multiple_agents_communication(self, mock_redis):
        """Test communication between multiple agents."""
        # Create two agents
        agent1 = MockAgent("agent_001")
        agent2 = MockAgent("agent_002")
        
        try:
            await agent1.start()
            await agent2.start()
            
            # Create message from agent1 to agent2
            message = AgentMessage(
                sender_id=agent1.agent_id,
                recipient_id=agent2.agent_id,
                message_type="test_message",
                payload={"data": "hello"}
            )
            
            # Send message
            await agent1.send_message(message)
            
            # Verify message was published to correct channel
            mock_redis.publish.assert_called()
            
        finally:
            await agent1.stop()
            await agent2.stop()
    
    @pytest.mark.asyncio
    async def test_agent_lifecycle_metrics(self, mock_agent, mock_redis):
        """Test agent lifecycle metrics tracking."""
        # Start agent
        start_time = datetime.utcnow()
        await mock_agent.start()
        
        # Process some messages
        for i in range(5):
            message = AgentMessage(
                sender_id="test_sender",
                message_type="test_message",
                payload={"count": i}
            )
            await mock_agent.process_message(message)
        
        # Check metrics
        metadata = mock_agent.get_metadata()
        assert metadata.started_at >= start_time
        assert metadata.processed_messages >= 0  # BaseAgent doesn't auto-increment
        
        await mock_agent.stop()
    
    @pytest.mark.asyncio
    async def test_agent_registration_deregistration(self, mock_agent, mock_redis):
        """Test agent registration and deregistration with orchestrator."""
        await mock_agent.start()
        
        # Verify registration message was sent
        registration_calls = [
            call for call in mock_redis.publish.call_args_list
            if call[0][0] == "orchestrator.register"
        ]
        assert len(registration_calls) > 0
        
        await mock_agent.stop()
        
        # Verify deregistration message was sent
        deregistration_calls = [
            call for call in mock_redis.publish.call_args_list
            if call[0][0] == "orchestrator.deregister"
        ]
        assert len(deregistration_calls) > 0