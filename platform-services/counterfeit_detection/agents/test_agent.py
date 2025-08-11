"""
Simple test agent for demonstrating the multi-agent framework functionality.
"""

import asyncio
import json
from datetime import datetime
from typing import Dict, Any, Optional

import structlog

from .base import BaseAgent, AgentMessage, AgentResponse, AgentCapability

logger = structlog.get_logger(module=__name__)


class TestAgent(BaseAgent):
    """
    Simple test agent that demonstrates basic agent functionality.
    
    Capabilities:
    - Echo messages back to sender
    - Perform simple calculations
    - Health status reporting
    - Custom message processing
    """
    
    def __init__(self, agent_id: str = "test_agent_001"):
        # Define agent capabilities
        capabilities = [
            AgentCapability(
                name="echo",
                description="Echo messages back to sender",
                input_types=["echo_request"],
                output_types=["echo_response"]
            ),
            AgentCapability(
                name="calculator",
                description="Perform basic mathematical calculations",
                input_types=["calculation_request"],
                output_types=["calculation_response"]
            ),
            AgentCapability(
                name="health_check",
                description="Report agent health status",
                input_types=["health_request"],
                output_types=["health_response"]
            )
        ]
        
        super().__init__(
            agent_id=agent_id,
            agent_type="test_agent", 
            version="1.0.0",
            capabilities=capabilities
        )
        
        # Test agent specific state
        self.processed_requests = 0
        self.calculation_cache: Dict[str, float] = {}
        
        self.logger.info("Test agent initialized", agent_id=agent_id)
    
    async def process_message(self, message: AgentMessage) -> AgentResponse:
        """
        Process incoming messages based on message type.
        
        Args:
            message: Incoming message to process
            
        Returns:
            Response to send back to sender
        """
        start_time = asyncio.get_event_loop().time()
        
        try:
            self.processed_requests += 1
            
            response_data = None
            
            # Route message based on type
            if message.message_type == "echo_request":
                response_data = await self._handle_echo_request(message)
            elif message.message_type == "calculation_request":
                response_data = await self._handle_calculation_request(message)
            elif message.message_type == "health_request":
                response_data = await self._handle_health_request(message)
            elif message.message_type == "status_request":
                response_data = await self._handle_status_request(message)
            elif message.message_type == "ping":
                response_data = await self._handle_ping_request(message)
            else:
                # Unknown message type
                return AgentResponse(
                    success=False,
                    error=f"Unknown message type: {message.message_type}",
                    processing_time_ms=0
                )
            
            processing_time = (asyncio.get_event_loop().time() - start_time) * 1000
            
            self.logger.debug(
                "Message processed successfully",
                message_type=message.message_type,
                processing_time_ms=processing_time
            )
            
            return AgentResponse(
                success=True,
                result=response_data,
                processing_time_ms=processing_time
            )
            
        except Exception as e:
            processing_time = (asyncio.get_event_loop().time() - start_time) * 1000
            
            self.logger.error(
                "Error processing message",
                message_type=message.message_type,
                error=str(e),
                processing_time_ms=processing_time
            )
            
            return AgentResponse(
                success=False,
                error=str(e),
                processing_time_ms=processing_time
            )
    
    async def _handle_echo_request(self, message: AgentMessage) -> Dict[str, Any]:
        """Handle echo request - simply return the payload."""
        echo_text = message.payload.get("text", "")
        
        return {
            "echo": echo_text,
            "original_sender": message.sender_id,
            "timestamp": datetime.utcnow().isoformat(),
            "processed_by": self.agent_id
        }
    
    async def _handle_calculation_request(self, message: AgentMessage) -> Dict[str, Any]:
        """Handle calculation request - perform basic math operations."""
        operation = message.payload.get("operation")
        operands = message.payload.get("operands", [])
        
        if not operation or not operands:
            raise ValueError("Missing operation or operands")
        
        # Check cache first
        cache_key = f"{operation}:{json.dumps(operands)}"
        if cache_key in self.calculation_cache:
            result = self.calculation_cache[cache_key]
            from_cache = True
        else:
            # Perform calculation
            result = await self._perform_calculation(operation, operands)
            self.calculation_cache[cache_key] = result
            from_cache = False
        
        return {
            "operation": operation,
            "operands": operands,
            "result": result,
            "from_cache": from_cache,
            "processed_by": self.agent_id
        }
    
    async def _handle_health_request(self, message: AgentMessage) -> Dict[str, Any]:
        """Handle health check request."""
        return {
            "status": self.status.value,
            "uptime_seconds": (
                (datetime.utcnow() - self.started_at).total_seconds()
                if self.started_at else 0
            ),
            "processed_messages": self.processed_messages,
            "processed_requests": self.processed_requests,
            "error_count": self.error_count,
            "cache_size": len(self.calculation_cache),
            "last_heartbeat": (
                self.last_heartbeat.isoformat()
                if self.last_heartbeat else None
            ),
            "capabilities": [cap.name for cap in self.capabilities]
        }
    
    async def _handle_status_request(self, message: AgentMessage) -> Dict[str, Any]:
        """Handle general status request."""
        metadata = self.get_metadata()
        
        return {
            "agent_id": metadata.agent_id,
            "agent_type": metadata.agent_type,
            "version": metadata.version,
            "status": metadata.status.value,
            "capabilities": [
                {
                    "name": cap.name,
                    "description": cap.description,
                    "input_types": cap.input_types,
                    "output_types": cap.output_types
                }
                for cap in metadata.capabilities
            ],
            "metrics": {
                "processed_messages": metadata.processed_messages,
                "error_count": metadata.error_count,
                "started_at": metadata.started_at.isoformat() if metadata.started_at else None,
                "last_heartbeat": metadata.last_heartbeat.isoformat() if metadata.last_heartbeat else None
            }
        }
    
    async def _handle_ping_request(self, message: AgentMessage) -> Dict[str, Any]:
        """Handle ping request - simple connectivity test."""
        return {
            "pong": True,
            "timestamp": datetime.utcnow().isoformat(),
            "agent_id": self.agent_id,
            "request_id": message.message_id
        }
    
    async def _perform_calculation(self, operation: str, operands: list) -> float:
        """Perform mathematical calculation."""
        if operation == "add":
            return sum(operands)
        elif operation == "subtract":
            if len(operands) < 2:
                raise ValueError("Subtract requires at least 2 operands")
            result = operands[0]
            for op in operands[1:]:
                result -= op
            return result
        elif operation == "multiply":
            result = 1
            for op in operands:
                result *= op
            return result
        elif operation == "divide":
            if len(operands) != 2:
                raise ValueError("Divide requires exactly 2 operands")
            if operands[1] == 0:
                raise ValueError("Division by zero")
            return operands[0] / operands[1]
        elif operation == "power":
            if len(operands) != 2:
                raise ValueError("Power requires exactly 2 operands")
            return operands[0] ** operands[1]
        elif operation == "sqrt":
            if len(operands) != 1:
                raise ValueError("Square root requires exactly 1 operand")
            if operands[0] < 0:
                raise ValueError("Cannot calculate square root of negative number")
            return operands[0] ** 0.5
        else:
            raise ValueError(f"Unknown operation: {operation}")


# Utility functions for testing the framework

async def create_test_agent(agent_id: str = "test_agent_001") -> TestAgent:
    """Create and start a test agent."""
    agent = TestAgent(agent_id)
    await agent.start()
    return agent


async def test_agent_communication():
    """Test basic agent communication."""
    logger.info("Starting agent communication test")
    
    # Create and start test agent
    agent = await create_test_agent("test_agent_001")
    
    try:
        # Wait a moment for agent to fully initialize
        await asyncio.sleep(1)
        
        # Test echo functionality
        echo_message = AgentMessage(
            sender_id="test_orchestrator",
            recipient_id=agent.agent_id,
            message_type="echo_request",
            payload={"text": "Hello, test agent!"},
            correlation_id="test_echo_001"
        )
        
        response = await agent.send_message(echo_message, timeout=10.0)
        if response:
            logger.info("Echo test successful", response=response.result)
        else:
            logger.error("Echo test failed - no response")
        
        # Test calculation functionality
        calc_message = AgentMessage(
            sender_id="test_orchestrator",
            recipient_id=agent.agent_id,
            message_type="calculation_request",
            payload={
                "operation": "add",
                "operands": [10, 20, 30]
            },
            correlation_id="test_calc_001"
        )
        
        response = await agent.send_message(calc_message, timeout=10.0)
        if response:
            logger.info("Calculation test successful", response=response.result)
        else:
            logger.error("Calculation test failed - no response")
        
        # Test health check
        health_message = AgentMessage(
            sender_id="test_orchestrator",
            recipient_id=agent.agent_id,
            message_type="health_request",
            payload={},
            correlation_id="test_health_001"
        )
        
        response = await agent.send_message(health_message, timeout=10.0)
        if response:
            logger.info("Health check successful", response=response.result)
        else:
            logger.error("Health check failed - no response")
            
    finally:
        # Clean up
        await agent.stop()
        logger.info("Agent communication test completed")


async def test_multiple_agents():
    """Test multiple agents working together."""
    logger.info("Starting multiple agents test")
    
    # Create multiple test agents
    agents = []
    for i in range(3):
        agent_id = f"test_agent_{i:03d}"
        agent = await create_test_agent(agent_id)
        agents.append(agent)
    
    try:
        # Wait for agents to initialize
        await asyncio.sleep(2)
        
        # Send ping to all agents
        ping_tasks = []
        for i, agent in enumerate(agents):
            ping_message = AgentMessage(
                sender_id="test_orchestrator",
                recipient_id=agent.agent_id,
                message_type="ping",
                payload={},
                correlation_id=f"ping_{i:03d}"
            )
            
            task = agent.send_message(ping_message, timeout=5.0)
            ping_tasks.append((agent.agent_id, task))
        
        # Wait for all responses
        for agent_id, task in ping_tasks:
            response = await task
            if response and response.success:
                logger.info("Ping successful", agent_id=agent_id, result=response.result)
            else:
                logger.error("Ping failed", agent_id=agent_id)
                
    finally:
        # Clean up all agents
        for agent in agents:
            await agent.stop()
        logger.info("Multiple agents test completed")


if __name__ == "__main__":
    # Run tests if executed directly
    async def main():
        await test_agent_communication()
        await test_multiple_agents()
    
    asyncio.run(main())