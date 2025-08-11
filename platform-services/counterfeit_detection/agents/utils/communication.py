"""
Agent communication utilities for Redis-based message passing.
"""

import asyncio
import json
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Callable, Awaitable

import structlog
from redis.asyncio import Redis

from ..base import AgentMessage, AgentResponse
from ...config.redis import get_redis_client

logger = structlog.get_logger(module=__name__)


class MessageBus:
    """
    Centralized message bus for agent communication using Redis pub/sub.
    
    Provides high-level messaging patterns:
    - Point-to-point messaging
    - Broadcast messaging  
    - Request-response patterns
    - Message routing and filtering
    """
    
    def __init__(self):
        self.redis_client: Optional[Redis] = None
        self.subscribers: Dict[str, Callable[[AgentMessage], Awaitable[None]]] = {}
        self.response_handlers: Dict[str, asyncio.Future] = {}
        self.running_tasks: List[asyncio.Task] = []
        self.shutdown_event = asyncio.Event()
        
        self.logger = structlog.get_logger(component="message_bus")
    
    async def initialize(self) -> None:
        """Initialize Redis connection and start message listeners."""
        try:
            self.redis_client = await get_redis_client()
            self.logger.info("Message bus initialized")
            
        except Exception as e:
            self.logger.error("Failed to initialize message bus", error=str(e))
            raise
    
    async def shutdown(self) -> None:
        """Shutdown message bus and clean up resources."""
        try:
            self.shutdown_event.set()
            
            # Cancel running tasks
            for task in self.running_tasks:
                task.cancel()
            
            if self.running_tasks:
                await asyncio.gather(*self.running_tasks, return_exceptions=True)
            
            # Close Redis connection
            if self.redis_client:
                await self.redis_client.close()
            
            self.logger.info("Message bus shutdown")
            
        except Exception as e:
            self.logger.error("Error during message bus shutdown", error=str(e))
    
    async def send_message(
        self, 
        recipient_id: str, 
        message_type: str,
        payload: Dict[str, Any],
        sender_id: str,
        priority: int = 0,
        correlation_id: Optional[str] = None
    ) -> None:
        """
        Send point-to-point message to specific agent.
        
        Args:
            recipient_id: Target agent ID
            message_type: Type of message
            payload: Message payload
            sender_id: Sending agent ID
            priority: Message priority (higher = more urgent)
            correlation_id: Optional correlation ID for request-response
        """
        if not self.redis_client:
            raise RuntimeError("Message bus not initialized")
        
        message = AgentMessage(
            sender_id=sender_id,
            recipient_id=recipient_id,
            message_type=message_type,
            payload=payload,
            priority=priority,
            correlation_id=correlation_id
        )
        
        routing_key = f"agent.{recipient_id}"
        
        try:
            await self.redis_client.publish(routing_key, message.json())
            
            self.logger.debug(
                "Message sent",
                message_id=message.message_id,
                sender_id=sender_id,
                recipient_id=recipient_id,
                message_type=message_type
            )
            
        except Exception as e:
            self.logger.error(
                "Failed to send message",
                error=str(e),
                recipient_id=recipient_id,
                message_type=message_type
            )
            raise
    
    async def broadcast_message(
        self,
        message_type: str,
        payload: Dict[str, Any],
        sender_id: str,
        agent_type: Optional[str] = None,
        priority: int = 0
    ) -> None:
        """
        Broadcast message to all agents or agents of specific type.
        
        Args:
            message_type: Type of message
            payload: Message payload
            sender_id: Sending agent ID
            agent_type: Optional agent type filter
            priority: Message priority
        """
        if not self.redis_client:
            raise RuntimeError("Message bus not initialized")
        
        message = AgentMessage(
            sender_id=sender_id,
            message_type=message_type,
            payload=payload,
            priority=priority
        )
        
        if agent_type:
            routing_key = f"broadcast.{agent_type}"
        else:
            routing_key = "broadcast.all"
        
        try:
            await self.redis_client.publish(routing_key, message.json())
            
            self.logger.info(
                "Message broadcasted",
                message_id=message.message_id,
                sender_id=sender_id,
                message_type=message_type,
                agent_type=agent_type or "all"
            )
            
        except Exception as e:
            self.logger.error(
                "Failed to broadcast message",
                error=str(e),
                message_type=message_type
            )
            raise
    
    async def send_request(
        self,
        recipient_id: str,
        message_type: str,
        payload: Dict[str, Any],
        sender_id: str,
        timeout: float = 30.0
    ) -> Optional[AgentResponse]:
        """
        Send request message and wait for response.
        
        Args:
            recipient_id: Target agent ID
            message_type: Type of request
            payload: Request payload
            sender_id: Sending agent ID
            timeout: Response timeout in seconds
            
        Returns:
            Response from target agent or None if timeout
        """
        correlation_id = str(uuid.uuid4())
        
        # Set up response future
        response_future = asyncio.Future()
        self.response_handlers[correlation_id] = response_future
        
        try:
            # Send request message
            await self.send_message(
                recipient_id=recipient_id,
                message_type=message_type,
                payload=payload,
                sender_id=sender_id,
                correlation_id=correlation_id
            )
            
            # Wait for response
            response = await asyncio.wait_for(response_future, timeout=timeout)
            return response
            
        except asyncio.TimeoutError:
            self.logger.warning(
                "Request timeout",
                correlation_id=correlation_id,
                recipient_id=recipient_id,
                timeout=timeout
            )
            return None
        except Exception as e:
            self.logger.error(
                "Request failed",
                error=str(e),
                correlation_id=correlation_id
            )
            raise
        finally:
            # Clean up response handler
            self.response_handlers.pop(correlation_id, None)
    
    async def subscribe(
        self,
        channels: List[str],
        message_handler: Callable[[AgentMessage], Awaitable[None]]
    ) -> None:
        """
        Subscribe to message channels with handler.
        
        Args:
            channels: List of channel patterns to subscribe to
            message_handler: Async function to handle messages
        """
        if not self.redis_client:
            raise RuntimeError("Message bus not initialized")
        
        # Start listener task
        listener_task = asyncio.create_task(
            self._channel_listener(channels, message_handler)
        )
        self.running_tasks.append(listener_task)
        
        self.logger.info("Subscribed to channels", channels=channels)
    
    async def subscribe_responses(
        self,
        agent_id: str
    ) -> None:
        """
        Subscribe to response channel for an agent.
        
        Args:
            agent_id: Agent ID to listen for responses
        """
        response_channel = f"response.{agent_id}"
        
        response_task = asyncio.create_task(
            self._response_listener(response_channel)
        )
        self.running_tasks.append(response_task)
        
        self.logger.info("Subscribed to response channel", channel=response_channel)
    
    async def send_response(
        self,
        response: AgentResponse,
        recipient_id: str
    ) -> None:
        """
        Send response message back to requester.
        
        Args:
            response: Response to send
            recipient_id: ID of agent that sent the original request
        """
        if not self.redis_client:
            raise RuntimeError("Message bus not initialized")
        
        response_channel = f"response.{recipient_id}"
        
        try:
            await self.redis_client.publish(response_channel, response.json())
            
            self.logger.debug(
                "Response sent",
                correlation_id=response.correlation_id,
                recipient_id=recipient_id
            )
            
        except Exception as e:
            self.logger.error(
                "Failed to send response",
                error=str(e),
                correlation_id=response.correlation_id
            )
            raise
    
    async def _channel_listener(
        self,
        channels: List[str],
        message_handler: Callable[[AgentMessage], Awaitable[None]]
    ) -> None:
        """Listen for messages on specified channels."""
        pubsub = None
        try:
            pubsub = self.redis_client.pubsub()
            await pubsub.subscribe(*channels)
            
            self.logger.info("Channel listener started", channels=channels)
            
            async for message in pubsub.listen():
                if self.shutdown_event.is_set():
                    break
                
                if message["type"] == "message":
                    try:
                        message_dict = json.loads(message["data"])
                        agent_message = AgentMessage(**message_dict)
                        await message_handler(agent_message)
                        
                    except Exception as e:
                        self.logger.error(
                            "Error handling message",
                            error=str(e),
                            channel=message["channel"]
                        )
                        
        except Exception as e:
            self.logger.error("Channel listener error", error=str(e))
        finally:
            if pubsub:
                await pubsub.unsubscribe()
                await pubsub.close()
    
    async def _response_listener(self, response_channel: str) -> None:
        """Listen for response messages."""
        pubsub = None
        try:
            pubsub = self.redis_client.pubsub()
            await pubsub.subscribe(response_channel)
            
            self.logger.info("Response listener started", channel=response_channel)
            
            async for message in pubsub.listen():
                if self.shutdown_event.is_set():
                    break
                
                if message["type"] == "message":
                    try:
                        response_dict = json.loads(message["data"])
                        response = AgentResponse(**response_dict)
                        
                        # Find and complete response future
                        correlation_id = response.correlation_id
                        if correlation_id in self.response_handlers:
                            future = self.response_handlers[correlation_id]
                            if not future.done():
                                future.set_result(response)
                                
                    except Exception as e:
                        self.logger.error(
                            "Error handling response",
                            error=str(e),
                            channel=response_channel
                        )
                        
        except Exception as e:
            self.logger.error("Response listener error", error=str(e))
        finally:
            if pubsub:
                await pubsub.unsubscribe()
                await pubsub.close()


class MessageRouter:
    """
    Advanced message routing with filtering and transformation capabilities.
    """
    
    def __init__(self, message_bus: MessageBus):
        self.message_bus = message_bus
        self.routes: Dict[str, List[Callable]] = {}
        self.middleware: List[Callable] = []
        
        self.logger = structlog.get_logger(component="message_router")
    
    def add_route(
        self, 
        message_type: str, 
        handler: Callable[[AgentMessage], Awaitable[Optional[AgentResponse]]]
    ) -> None:
        """Add message handler for specific message type."""
        if message_type not in self.routes:
            self.routes[message_type] = []
        self.routes[message_type].append(handler)
        
        self.logger.debug("Route added", message_type=message_type)
    
    def add_middleware(
        self, 
        middleware: Callable[[AgentMessage], Awaitable[AgentMessage]]
    ) -> None:
        """Add middleware for message processing."""
        self.middleware.append(middleware)
        self.logger.debug("Middleware added")
    
    async def route_message(self, message: AgentMessage) -> Optional[AgentResponse]:
        """
        Route message through middleware and handlers.
        
        Args:
            message: Message to route
            
        Returns:
            Response from handler if any
        """
        try:
            # Apply middleware
            processed_message = message
            for middleware in self.middleware:
                processed_message = await middleware(processed_message)
            
            # Find handlers for message type
            handlers = self.routes.get(processed_message.message_type, [])
            
            if not handlers:
                self.logger.warning(
                    "No handlers for message type",
                    message_type=processed_message.message_type
                )
                return None
            
            # Execute handlers (use first one for now)
            handler = handlers[0]
            response = await handler(processed_message)
            
            return response
            
        except Exception as e:
            self.logger.error(
                "Error routing message",
                error=str(e),
                message_type=message.message_type
            )
            
            # Return error response
            return AgentResponse(
                success=False,
                error=str(e),
                processing_time_ms=0,
                correlation_id=message.correlation_id
            )


# Utility functions for common messaging patterns

async def send_heartbeat(
    message_bus: MessageBus,
    agent_id: str,
    metadata: Dict[str, Any]
) -> None:
    """Send heartbeat message to orchestrator."""
    await message_bus.send_message(
        recipient_id="orchestrator",
        message_type="heartbeat",
        payload={
            "agent_id": agent_id,
            "timestamp": datetime.utcnow().isoformat(),
            "metadata": metadata
        },
        sender_id=agent_id
    )


async def request_agent_status(
    message_bus: MessageBus,
    requester_id: str,
    target_agent_id: str,
    timeout: float = 10.0
) -> Optional[Dict[str, Any]]:
    """Request status from another agent."""
    response = await message_bus.send_request(
        recipient_id=target_agent_id,
        message_type="status_request",
        payload={},
        sender_id=requester_id,
        timeout=timeout
    )
    
    if response and response.success:
        return response.result
    return None


async def broadcast_shutdown(
    message_bus: MessageBus,
    sender_id: str,
    reason: str = "System shutdown"
) -> None:
    """Broadcast shutdown message to all agents."""
    await message_bus.broadcast_message(
        message_type="shutdown",
        payload={"reason": reason},
        sender_id=sender_id,
        priority=10  # High priority
    )