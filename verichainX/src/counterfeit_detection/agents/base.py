"""
Base agent class and core data structures for the multi-agent system.
"""

import asyncio
import json
import uuid
from abc import ABC, abstractmethod
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Union

import structlog
from pydantic import BaseModel, Field
from redis.asyncio import Redis

from ..config.redis import get_redis_client

logger = structlog.get_logger(module=__name__)


class AgentStatus(Enum):
    """Agent lifecycle status enumeration."""
    STOPPED = "stopped"
    STARTING = "starting"
    RUNNING = "running"
    STOPPING = "stopping"
    ERROR = "error"
    PAUSED = "paused"


class AgentMessage(BaseModel):
    """Message structure for agent communication."""
    message_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    sender_id: str = Field(..., description="ID of the sending agent")
    recipient_id: Optional[str] = Field(None, description="ID of recipient agent (None for broadcast)")
    message_type: str = Field(..., description="Type of message")
    payload: Dict[str, Any] = Field(default_factory=dict, description="Message payload")
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    correlation_id: Optional[str] = Field(None, description="ID for request/response correlation")
    priority: int = Field(0, description="Message priority (higher = more urgent)")
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }


class AgentResponse(BaseModel):
    """Response structure for agent message processing."""
    success: bool = Field(..., description="Whether processing was successful")
    result: Optional[Dict[str, Any]] = Field(None, description="Response data")
    error: Optional[str] = Field(None, description="Error message if failed")
    processing_time_ms: float = Field(..., description="Processing time in milliseconds")
    correlation_id: Optional[str] = Field(None, description="Correlation ID from original message")


class AgentCapability(BaseModel):
    """Agent capability definition."""
    name: str = Field(..., description="Capability name")
    description: str = Field(..., description="Capability description")
    input_types: List[str] = Field(..., description="Supported input message types")
    output_types: List[str] = Field(..., description="Produced output message types")


class AgentMetadata(BaseModel):
    """Agent metadata for registry."""
    agent_id: str = Field(..., description="Unique agent identifier")
    agent_type: str = Field(..., description="Agent type/class")
    version: str = Field(default="1.0.0", description="Agent version")
    capabilities: List[AgentCapability] = Field(default_factory=list)
    status: AgentStatus = Field(default=AgentStatus.STOPPED)
    started_at: Optional[datetime] = Field(None)
    last_heartbeat: Optional[datetime] = Field(None)
    processed_messages: int = Field(default=0)
    error_count: int = Field(default=0)


class BaseAgent(ABC):
    """
    Abstract base class for all agents in the multi-agent system.
    
    Provides core functionality for:
    - Agent lifecycle management
    - Redis-based communication
    - Message processing
    - Health monitoring
    """
    
    def __init__(
        self, 
        agent_id: str, 
        agent_type: str,
        version: str = "1.0.0",
        capabilities: Optional[List[AgentCapability]] = None
    ):
        """
        Initialize base agent.
        
        Args:
            agent_id: Unique identifier for this agent instance
            agent_type: Type/class of agent
            version: Agent version
            capabilities: List of agent capabilities
        """
        self.agent_id = agent_id
        self.agent_type = agent_type
        self.version = version
        self.capabilities = capabilities or []
        
        self.status = AgentStatus.STOPPED
        self.redis_client: Optional[Redis] = None
        self.message_handlers: Dict[str, callable] = {}
        self.running_tasks: List[asyncio.Task] = []
        self.shutdown_event = asyncio.Event()
        
        # Performance metrics
        self.processed_messages = 0
        self.error_count = 0
        self.started_at: Optional[datetime] = None
        self.last_heartbeat: Optional[datetime] = None
        
        # Setup logger with agent context
        self.logger = structlog.get_logger(
            agent_id=agent_id,
            agent_type=agent_type
        )
    
    async def start(self) -> None:
        """Start the agent and register with the orchestrator."""
        if self.status != AgentStatus.STOPPED:
            raise RuntimeError(f"Agent {self.agent_id} is not in STOPPED state")
        
        try:
            self.status = AgentStatus.STARTING
            self.started_at = datetime.utcnow()
            
            # Initialize Redis connection
            self.redis_client = await get_redis_client()
            
            # Register message handlers
            await self._setup_message_handlers()
            
            # Start background tasks
            self._start_background_tasks()
            
            # Register with orchestrator
            await self._register_with_orchestrator()
            
            self.status = AgentStatus.RUNNING
            self.logger.info("Agent started successfully")
            
        except Exception as e:
            self.status = AgentStatus.ERROR
            self.error_count += 1
            self.logger.error("Failed to start agent", error=str(e))
            raise
    
    async def stop(self) -> None:
        """Gracefully stop the agent and clean up resources."""
        if self.status not in [AgentStatus.RUNNING, AgentStatus.PAUSED]:
            return
        
        try:
            self.status = AgentStatus.STOPPING
            self.logger.info("Stopping agent")
            
            # Signal shutdown to background tasks
            self.shutdown_event.set()
            
            # Wait for running tasks to complete
            if self.running_tasks:
                await asyncio.gather(*self.running_tasks, return_exceptions=True)
            
            # Deregister from orchestrator
            await self._deregister_from_orchestrator()
            
            # Close Redis connection
            if self.redis_client:
                await self.redis_client.close()
            
            self.status = AgentStatus.STOPPED
            self.logger.info("Agent stopped successfully")
            
        except Exception as e:
            self.status = AgentStatus.ERROR
            self.error_count += 1
            self.logger.error("Error stopping agent", error=str(e))
            raise
    
    async def pause(self) -> None:
        """Pause agent processing."""
        if self.status == AgentStatus.RUNNING:
            self.status = AgentStatus.PAUSED
            self.logger.info("Agent paused")
    
    async def resume(self) -> None:
        """Resume agent processing."""
        if self.status == AgentStatus.PAUSED:
            self.status = AgentStatus.RUNNING
            self.logger.info("Agent resumed")
    
    async def send_message(
        self, 
        message: AgentMessage,
        timeout: float = 30.0
    ) -> Optional[AgentResponse]:
        """
        Send message to another agent or broadcast.
        
        Args:
            message: Message to send
            timeout: Response timeout in seconds
            
        Returns:
            Response from recipient agent if expecting response
        """
        if not self.redis_client:
            raise RuntimeError("Agent not started - Redis client not available")
        
        try:
            # Determine routing key
            if message.recipient_id:
                routing_key = f"agent.{message.recipient_id}"
            else:
                routing_key = f"broadcast.{message.message_type}"
            
            # Serialize and publish message
            message_json = message.json()
            await self.redis_client.publish(routing_key, message_json)
            
            self.logger.debug(
                "Message sent",
                message_id=message.message_id,
                recipient=message.recipient_id or "broadcast",
                message_type=message.message_type
            )
            
            # If correlation_id is set, wait for response
            if message.correlation_id:
                return await self._wait_for_response(message.correlation_id, timeout)
            
            return None
            
        except Exception as e:
            self.error_count += 1
            self.logger.error(
                "Failed to send message",
                error=str(e),
                message_id=message.message_id
            )
            raise
    
    @abstractmethod
    async def process_message(self, message: AgentMessage) -> AgentResponse:
        """
        Process incoming message from another agent.
        
        Args:
            message: Incoming message to process
            
        Returns:
            Response to send back to sender
        """
        pass
    
    def get_metadata(self) -> AgentMetadata:
        """Get current agent metadata."""
        return AgentMetadata(
            agent_id=self.agent_id,
            agent_type=self.agent_type,
            version=self.version,
            capabilities=self.capabilities,
            status=self.status,
            started_at=self.started_at,
            last_heartbeat=self.last_heartbeat,
            processed_messages=self.processed_messages,
            error_count=self.error_count
        )
    
    async def _setup_message_handlers(self) -> None:
        """Setup Redis message handlers."""
        # Subscribe to agent-specific messages
        agent_channel = f"agent.{self.agent_id}"
        
        # Subscribe to broadcast messages for agent type
        broadcast_channel = f"broadcast.{self.agent_type}"
        
        # Start message listener task
        listener_task = asyncio.create_task(
            self._message_listener([agent_channel, broadcast_channel])
        )
        self.running_tasks.append(listener_task)
    
    async def _message_listener(self, channels: List[str]) -> None:
        """Listen for incoming messages on Redis channels."""
        try:
            pubsub = self.redis_client.pubsub()
            await pubsub.subscribe(*channels)
            
            self.logger.info("Message listener started", channels=channels)
            
            async for message in pubsub.listen():
                if self.shutdown_event.is_set():
                    break
                
                if message["type"] == "message":
                    await self._handle_incoming_message(message["data"])
                    
        except Exception as e:
            self.logger.error("Message listener error", error=str(e))
            self.error_count += 1
        finally:
            if pubsub:
                await pubsub.unsubscribe()
                await pubsub.close()
    
    async def _handle_incoming_message(self, message_data: str) -> None:
        """Handle incoming message from Redis."""
        if self.status != AgentStatus.RUNNING:
            return  # Ignore messages when not running
        
        try:
            # Parse message
            message_dict = json.loads(message_data)
            message = AgentMessage(**message_dict)
            
            # Process message
            start_time = asyncio.get_event_loop().time()
            response = await self.process_message(message)
            processing_time = (asyncio.get_event_loop().time() - start_time) * 1000
            
            response.processing_time_ms = processing_time
            response.correlation_id = message.correlation_id
            
            # Send response if correlation_id is present
            if message.correlation_id:
                await self._send_response(message.sender_id, response)
            
            self.processed_messages += 1
            self.logger.debug(
                "Message processed",
                message_id=message.message_id,
                message_type=message.message_type,
                processing_time_ms=processing_time
            )
            
        except Exception as e:
            self.error_count += 1
            self.logger.error("Error processing message", error=str(e))
    
    async def _send_response(self, recipient_id: str, response: AgentResponse) -> None:
        """Send response back to message sender."""
        response_channel = f"response.{recipient_id}"
        response_json = response.json()
        await self.redis_client.publish(response_channel, response_json)
    
    async def _wait_for_response(
        self, 
        correlation_id: str, 
        timeout: float
    ) -> Optional[AgentResponse]:
        """Wait for response with given correlation ID."""
        response_channel = f"response.{self.agent_id}"
        pubsub = self.redis_client.pubsub()
        
        try:
            await pubsub.subscribe(response_channel)
            
            async def listen_for_response():
                async for message in pubsub.listen():
                    if message["type"] == "message":
                        response_dict = json.loads(message["data"])
                        response = AgentResponse(**response_dict)
                        if response.correlation_id == correlation_id:
                            return response
                return None
            
            # Wait for response with timeout
            return await asyncio.wait_for(listen_for_response(), timeout=timeout)
            
        except asyncio.TimeoutError:
            self.logger.warning("Response timeout", correlation_id=correlation_id)
            return None
        finally:
            await pubsub.unsubscribe()
            await pubsub.close()
    
    def _start_background_tasks(self) -> None:
        """Start background tasks for agent operation."""
        # Heartbeat task
        heartbeat_task = asyncio.create_task(self._heartbeat_loop())
        self.running_tasks.append(heartbeat_task)
    
    async def _heartbeat_loop(self) -> None:
        """Send periodic heartbeat to orchestrator."""
        while not self.shutdown_event.is_set():
            try:
                self.last_heartbeat = datetime.utcnow()
                
                # Send heartbeat message
                heartbeat_msg = AgentMessage(
                    sender_id=self.agent_id,
                    message_type="heartbeat",
                    payload={"timestamp": self.last_heartbeat.isoformat()}
                )
                
                await self.redis_client.publish("orchestrator.heartbeat", heartbeat_msg.json())
                
                # Wait 30 seconds before next heartbeat
                await asyncio.sleep(30)
                
            except Exception as e:
                self.logger.error("Heartbeat error", error=str(e))
                await asyncio.sleep(5)  # Short retry delay
    
    async def _register_with_orchestrator(self) -> None:
        """Register agent with the orchestrator."""
        registration_msg = AgentMessage(
            sender_id=self.agent_id,
            message_type="agent_register",
            payload=self.get_metadata().dict()
        )
        
        await self.redis_client.publish("orchestrator.register", registration_msg.json())
        self.logger.info("Registered with orchestrator")
    
    async def _deregister_from_orchestrator(self) -> None:
        """Deregister agent from the orchestrator."""
        deregistration_msg = AgentMessage(
            sender_id=self.agent_id,
            message_type="agent_deregister",
            payload={"agent_id": self.agent_id}
        )
        
        await self.redis_client.publish("orchestrator.deregister", deregistration_msg.json())
        self.logger.info("Deregistered from orchestrator")