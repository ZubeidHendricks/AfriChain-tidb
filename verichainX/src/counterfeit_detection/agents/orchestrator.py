"""
Agent orchestrator for coordinating multi-agent workflows and managing agent lifecycle.
"""

import asyncio
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Set, Any
from collections import defaultdict

import structlog
from pydantic import BaseModel, Field

from .base import (
    BaseAgent, 
    AgentMessage, 
    AgentResponse, 
    AgentMetadata, 
    AgentStatus
)
from ..config.redis import get_redis_client

logger = structlog.get_logger(module=__name__)


class WorkflowStep(BaseModel):
    """Single step in a workflow definition."""
    step_id: str = Field(..., description="Unique step identifier")
    agent_type: str = Field(..., description="Type of agent to execute this step")
    message_type: str = Field(..., description="Message type to send to agent")
    payload: Dict[str, Any] = Field(default_factory=dict, description="Step payload")
    depends_on: List[str] = Field(default_factory=list, description="Step dependencies")
    timeout: float = Field(30.0, description="Step timeout in seconds")
    retry_count: int = Field(0, description="Number of retries on failure")


class Workflow(BaseModel):
    """Workflow definition for coordinating multiple agents."""
    workflow_id: str = Field(..., description="Unique workflow identifier")
    name: str = Field(..., description="Human-readable workflow name")
    description: str = Field("", description="Workflow description")
    steps: List[WorkflowStep] = Field(..., description="Workflow steps")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class WorkflowExecution(BaseModel):
    """Runtime state of workflow execution."""
    execution_id: str = Field(..., description="Unique execution identifier")
    workflow_id: str = Field(..., description="Workflow being executed")
    status: str = Field("pending", description="Execution status")
    started_at: Optional[datetime] = Field(None)
    completed_at: Optional[datetime] = Field(None)
    current_step: Optional[str] = Field(None)
    completed_steps: Set[str] = Field(default_factory=set)
    failed_steps: Set[str] = Field(default_factory=set)
    step_results: Dict[str, Any] = Field(default_factory=dict)
    error_message: Optional[str] = Field(None)


class AgentOrchestrator:
    """
    Central orchestrator for managing agents and coordinating workflows.
    
    Responsibilities:
    - Agent registration and discovery
    - Health monitoring and failure detection
    - Workflow execution and coordination
    - Load balancing across agent instances
    """
    
    def __init__(self):
        self.redis_client = None
        self.registered_agents: Dict[str, AgentMetadata] = {}
        self.agent_instances: Dict[str, List[str]] = defaultdict(list)  # agent_type -> [agent_ids]
        self.workflows: Dict[str, Workflow] = {}
        self.active_executions: Dict[str, WorkflowExecution] = {}
        self.running_tasks: List[asyncio.Task] = []
        self.shutdown_event = asyncio.Event()
        
        self.logger = structlog.get_logger(
            component="orchestrator"
        )
    
    async def start(self) -> None:
        """Start the orchestrator and begin monitoring agents."""
        try:
            self.logger.info("Starting agent orchestrator")
            
            # Initialize Redis connection
            self.redis_client = await get_redis_client()
            
            # Start background tasks
            self._start_background_tasks()
            
            self.logger.info("Agent orchestrator started successfully")
            
        except Exception as e:
            self.logger.error("Failed to start orchestrator", error=str(e))
            raise
    
    async def stop(self) -> None:
        """Stop the orchestrator and clean up resources."""
        try:
            self.logger.info("Stopping agent orchestrator")
            
            # Signal shutdown
            self.shutdown_event.set()
            
            # Wait for background tasks
            if self.running_tasks:
                await asyncio.gather(*self.running_tasks, return_exceptions=True)
            
            # Close Redis connection
            if self.redis_client:
                await self.redis_client.close()
            
            self.logger.info("Agent orchestrator stopped")
            
        except Exception as e:
            self.logger.error("Error stopping orchestrator", error=str(e))
            raise
    
    def register_workflow(self, workflow: Workflow) -> None:
        """Register a workflow definition."""
        self.workflows[workflow.workflow_id] = workflow
        self.logger.info(
            "Workflow registered",
            workflow_id=workflow.workflow_id,
            name=workflow.name,
            steps=len(workflow.steps)
        )
    
    async def execute_workflow(
        self, 
        workflow_id: str, 
        initial_payload: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Execute a workflow asynchronously.
        
        Args:
            workflow_id: ID of workflow to execute
            initial_payload: Initial data to pass to workflow
            
        Returns:
            Execution ID for tracking workflow progress
        """
        if workflow_id not in self.workflows:
            raise ValueError(f"Workflow {workflow_id} not found")
        
        workflow = self.workflows[workflow_id]
        execution_id = f"exec_{workflow_id}_{int(datetime.utcnow().timestamp())}"
        
        execution = WorkflowExecution(
            execution_id=execution_id,
            workflow_id=workflow_id,
            status="running",
            started_at=datetime.utcnow()
        )
        
        self.active_executions[execution_id] = execution
        
        # Start workflow execution in background
        task = asyncio.create_task(
            self._execute_workflow_steps(execution, workflow, initial_payload or {})
        )
        self.running_tasks.append(task)
        
        self.logger.info(
            "Workflow execution started",
            execution_id=execution_id,
            workflow_id=workflow_id
        )
        
        return execution_id
    
    async def get_execution_status(self, execution_id: str) -> Optional[WorkflowExecution]:
        """Get current status of workflow execution."""
        return self.active_executions.get(execution_id)
    
    def get_registered_agents(self) -> Dict[str, AgentMetadata]:
        """Get all currently registered agents."""
        return self.registered_agents.copy()
    
    def get_agents_by_type(self, agent_type: str) -> List[AgentMetadata]:
        """Get all agents of a specific type."""
        return [
            agent for agent in self.registered_agents.values()
            if agent.agent_type == agent_type
        ]
    
    async def send_message_to_agent(
        self, 
        agent_id: str, 
        message: AgentMessage,
        timeout: float = 30.0
    ) -> Optional[AgentResponse]:
        """Send message to a specific agent."""
        if agent_id not in self.registered_agents:
            raise ValueError(f"Agent {agent_id} not registered")
        
        # Set up response listener
        response_channel = f"response.orchestrator"
        correlation_id = message.correlation_id or message.message_id
        
        try:
            # Send message
            agent_channel = f"agent.{agent_id}"
            message_json = message.json()
            await self.redis_client.publish(agent_channel, message_json)
            
            self.logger.debug(
                "Message sent to agent",
                agent_id=agent_id,
                message_id=message.message_id,
                message_type=message.message_type
            )
            
            # Wait for response if correlation_id is set
            if correlation_id:
                return await self._wait_for_response(correlation_id, timeout)
            
            return None
            
        except Exception as e:
            self.logger.error(
                "Failed to send message to agent",
                agent_id=agent_id,
                error=str(e)
            )
            raise
    
    async def broadcast_message(
        self, 
        message: AgentMessage, 
        agent_type: Optional[str] = None
    ) -> None:
        """Broadcast message to all agents or agents of specific type."""
        try:
            if agent_type:
                routing_key = f"broadcast.{agent_type}"
                target_agents = [a for a in self.registered_agents.values() if a.agent_type == agent_type]
            else:
                routing_key = "broadcast.all"
                target_agents = list(self.registered_agents.values())
            
            message_json = message.json()
            await self.redis_client.publish(routing_key, message_json)
            
            self.logger.info(
                "Message broadcasted",
                message_type=message.message_type,
                agent_type=agent_type or "all",
                target_count=len(target_agents)
            )
            
        except Exception as e:
            self.logger.error("Failed to broadcast message", error=str(e))
            raise
    
    def _start_background_tasks(self) -> None:
        """Start background monitoring and management tasks."""
        # Agent registration listener
        registration_task = asyncio.create_task(self._registration_listener())
        self.running_tasks.append(registration_task)
        
        # Heartbeat monitor
        heartbeat_task = asyncio.create_task(self._heartbeat_monitor())
        self.running_tasks.append(heartbeat_task)
        
        # Workflow cleanup
        cleanup_task = asyncio.create_task(self._cleanup_completed_workflows())
        self.running_tasks.append(cleanup_task)
    
    async def _registration_listener(self) -> None:
        """Listen for agent registration and deregistration messages."""
        try:
            pubsub = self.redis_client.pubsub()
            await pubsub.subscribe("orchestrator.register", "orchestrator.deregister")
            
            self.logger.info("Registration listener started")
            
            async for message in pubsub.listen():
                if self.shutdown_event.is_set():
                    break
                
                if message["type"] == "message":
                    await self._handle_registration_message(
                        message["channel"], message["data"]
                    )
                    
        except Exception as e:
            self.logger.error("Registration listener error", error=str(e))
        finally:
            if pubsub:
                await pubsub.unsubscribe()
                await pubsub.close()
    
    async def _handle_registration_message(self, channel: str, message_data: str) -> None:
        """Handle agent registration/deregistration messages."""
        try:
            message_dict = json.loads(message_data)
            agent_message = AgentMessage(**message_dict)
            
            if channel == "orchestrator.register":
                # Agent registration
                metadata = AgentMetadata(**agent_message.payload)
                self.registered_agents[metadata.agent_id] = metadata
                self.agent_instances[metadata.agent_type].append(metadata.agent_id)
                
                self.logger.info(
                    "Agent registered",
                    agent_id=metadata.agent_id,
                    agent_type=metadata.agent_type
                )
                
            elif channel == "orchestrator.deregister":
                # Agent deregistration
                agent_id = agent_message.payload.get("agent_id")
                if agent_id in self.registered_agents:
                    metadata = self.registered_agents[agent_id]
                    del self.registered_agents[agent_id]
                    
                    if agent_id in self.agent_instances[metadata.agent_type]:
                        self.agent_instances[metadata.agent_type].remove(agent_id)
                    
                    self.logger.info(
                        "Agent deregistered",
                        agent_id=agent_id,
                        agent_type=metadata.agent_type
                    )
                    
        except Exception as e:
            self.logger.error("Error handling registration message", error=str(e))
    
    async def _heartbeat_monitor(self) -> None:
        """Monitor agent heartbeats and mark inactive agents."""
        try:
            pubsub = self.redis_client.pubsub()
            await pubsub.subscribe("orchestrator.heartbeat")
            
            self.logger.info("Heartbeat monitor started")
            
            # Start heartbeat timeout checker
            timeout_task = asyncio.create_task(self._check_heartbeat_timeouts())
            
            async for message in pubsub.listen():
                if self.shutdown_event.is_set():
                    timeout_task.cancel()
                    break
                
                if message["type"] == "message":
                    await self._handle_heartbeat_message(message["data"])
                    
        except Exception as e:
            self.logger.error("Heartbeat monitor error", error=str(e))
        finally:
            if pubsub:
                await pubsub.unsubscribe()
                await pubsub.close()
    
    async def _handle_heartbeat_message(self, message_data: str) -> None:
        """Handle heartbeat message from agent."""
        try:
            message_dict = json.loads(message_data)
            agent_message = AgentMessage(**message_dict)
            
            agent_id = agent_message.sender_id
            if agent_id in self.registered_agents:
                # Update last heartbeat time
                timestamp_str = agent_message.payload.get("timestamp")
                if timestamp_str:
                    timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                    self.registered_agents[agent_id].last_heartbeat = timestamp
                    
        except Exception as e:
            self.logger.error("Error handling heartbeat", error=str(e))
    
    async def _check_heartbeat_timeouts(self) -> None:
        """Check for agents that haven't sent heartbeats and mark them as inactive."""
        while not self.shutdown_event.is_set():
            try:
                current_time = datetime.utcnow()
                timeout_threshold = current_time - timedelta(minutes=2)  # 2 minute timeout
                
                inactive_agents = []
                for agent_id, metadata in self.registered_agents.items():
                    if (metadata.last_heartbeat and 
                        metadata.last_heartbeat < timeout_threshold and
                        metadata.status == AgentStatus.RUNNING):
                        
                        inactive_agents.append(agent_id)
                
                # Mark inactive agents
                for agent_id in inactive_agents:
                    self.registered_agents[agent_id].status = AgentStatus.ERROR
                    self.logger.warning(
                        "Agent marked as inactive due to heartbeat timeout",
                        agent_id=agent_id
                    )
                
                # Wait 30 seconds before next check
                await asyncio.sleep(30)
                
            except Exception as e:
                self.logger.error("Error checking heartbeat timeouts", error=str(e))
                await asyncio.sleep(5)
    
    async def _execute_workflow_steps(
        self, 
        execution: WorkflowExecution, 
        workflow: Workflow,
        context: Dict[str, Any]
    ) -> None:
        """Execute workflow steps in dependency order."""
        try:
            execution.status = "running"
            
            # Build dependency graph
            step_map = {step.step_id: step for step in workflow.steps}
            ready_steps = [step for step in workflow.steps if not step.depends_on]
            
            while ready_steps and execution.status == "running":
                # Execute ready steps in parallel
                step_tasks = []
                for step in ready_steps:
                    task = asyncio.create_task(
                        self._execute_workflow_step(execution, step, context)
                    )
                    step_tasks.append((step.step_id, task))
                
                # Wait for step completion
                for step_id, task in step_tasks:
                    try:
                        result = await task
                        execution.completed_steps.add(step_id)
                        execution.step_results[step_id] = result
                        
                        # Update context with step results
                        if result and isinstance(result, dict):
                            context.update(result)
                            
                    except Exception as e:
                        execution.failed_steps.add(step_id)
                        execution.error_message = str(e)
                        execution.status = "failed"
                        break
                
                if execution.status == "failed":
                    break
                
                # Find next ready steps
                ready_steps = []
                for step in workflow.steps:
                    if (step.step_id not in execution.completed_steps and
                        step.step_id not in execution.failed_steps and
                        all(dep in execution.completed_steps for dep in step.depends_on)):
                        ready_steps.append(step)
            
            # Mark execution as completed if all steps succeeded
            if execution.status == "running" and len(execution.completed_steps) == len(workflow.steps):
                execution.status = "completed"
            
            execution.completed_at = datetime.utcnow()
            
            self.logger.info(
                "Workflow execution completed",
                execution_id=execution.execution_id,
                status=execution.status,
                completed_steps=len(execution.completed_steps),
                total_steps=len(workflow.steps)
            )
            
        except Exception as e:
            execution.status = "failed"
            execution.error_message = str(e)
            execution.completed_at = datetime.utcnow()
            
            self.logger.error(
                "Workflow execution failed",
                execution_id=execution.execution_id,
                error=str(e)
            )
    
    async def _execute_workflow_step(
        self, 
        execution: WorkflowExecution, 
        step: WorkflowStep,
        context: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Execute a single workflow step."""
        execution.current_step = step.step_id
        
        # Find available agent of required type
        available_agents = [
            agent for agent in self.registered_agents.values()
            if (agent.agent_type == step.agent_type and 
                agent.status == AgentStatus.RUNNING)
        ]
        
        if not available_agents:
            raise RuntimeError(f"No available agents of type {step.agent_type}")
        
        # Use simple round-robin for load balancing
        agent = available_agents[0]
        
        # Create step message
        step_message = AgentMessage(
            sender_id="orchestrator",
            recipient_id=agent.agent_id,
            message_type=step.message_type,
            payload={**step.payload, **context},
            correlation_id=f"{execution.execution_id}_{step.step_id}"
        )
        
        # Execute step with retries
        for attempt in range(step.retry_count + 1):
            try:
                response = await self.send_message_to_agent(
                    agent.agent_id, 
                    step_message, 
                    step.timeout
                )
                
                if response and response.success:
                    self.logger.info(
                        "Workflow step completed",
                        execution_id=execution.execution_id,
                        step_id=step.step_id,
                        agent_id=agent.agent_id
                    )
                    return response.result
                else:
                    error_msg = response.error if response else "No response from agent"
                    raise RuntimeError(f"Step failed: {error_msg}")
                    
            except Exception as e:
                if attempt < step.retry_count:
                    self.logger.warning(
                        "Workflow step failed, retrying",
                        execution_id=execution.execution_id,
                        step_id=step.step_id,
                        attempt=attempt + 1,
                        error=str(e)
                    )
                    await asyncio.sleep(1)  # Brief delay before retry
                else:
                    raise
        
        raise RuntimeError(f"Step {step.step_id} failed after {step.retry_count + 1} attempts")
    
    async def _wait_for_response(
        self, 
        correlation_id: str, 
        timeout: float
    ) -> Optional[AgentResponse]:
        """Wait for response message with correlation ID."""
        response_channel = "response.orchestrator"
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
            
            return await asyncio.wait_for(listen_for_response(), timeout=timeout)
            
        except asyncio.TimeoutError:
            self.logger.warning("Response timeout", correlation_id=correlation_id)
            return None
        finally:
            await pubsub.unsubscribe()
            await pubsub.close()
    
    async def _cleanup_completed_workflows(self) -> None:
        """Clean up completed workflow executions periodically."""
        while not self.shutdown_event.is_set():
            try:
                # Clean up executions completed more than 1 hour ago
                cutoff_time = datetime.utcnow() - timedelta(hours=1)
                completed_executions = [
                    exec_id for exec_id, execution in self.active_executions.items()
                    if (execution.completed_at and 
                        execution.completed_at < cutoff_time and
                        execution.status in ["completed", "failed"])
                ]
                
                for exec_id in completed_executions:
                    del self.active_executions[exec_id]
                
                if completed_executions:
                    self.logger.info(
                        "Cleaned up completed workflow executions",
                        count=len(completed_executions)
                    )
                
                # Wait 1 hour before next cleanup
                await asyncio.sleep(3600)
                
            except Exception as e:
                self.logger.error("Error during workflow cleanup", error=str(e))
                await asyncio.sleep(300)  # 5 minute retry delay