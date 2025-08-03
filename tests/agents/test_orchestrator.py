"""
Tests for AgentOrchestrator functionality.
"""

import asyncio
import pytest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

from src.counterfeit_detection.agents.orchestrator import (
    AgentOrchestrator,
    Workflow,
    WorkflowStep,
    WorkflowExecution
)
from src.counterfeit_detection.agents.base import (
    AgentMessage,
    AgentResponse,
    AgentMetadata,
    AgentStatus
)


class TestWorkflowStep:
    """Test WorkflowStep data structure."""
    
    def test_workflow_step_creation(self):
        """Test creating a workflow step."""
        step = WorkflowStep(
            step_id="step_001",
            agent_type="test_agent",
            message_type="process_data",
            payload={"data": "test"},
            depends_on=["step_000"],
            timeout=30.0,
            retry_count=2
        )
        
        assert step.step_id == "step_001"
        assert step.agent_type == "test_agent"
        assert step.message_type == "process_data"
        assert step.payload == {"data": "test"}
        assert step.depends_on == ["step_000"]
        assert step.timeout == 30.0
        assert step.retry_count == 2


class TestWorkflow:
    """Test Workflow data structure."""
    
    def test_workflow_creation(self):
        """Test creating a workflow."""
        steps = [
            WorkflowStep(
                step_id="step_001",
                agent_type="analyzer",
                message_type="analyze",
                payload={"input": "data"}
            ),
            WorkflowStep(
                step_id="step_002",
                agent_type="processor",
                message_type="process",
                payload={},
                depends_on=["step_001"]
            )
        ]
        
        workflow = Workflow(
            workflow_id="workflow_001",
            name="Test Workflow",
            description="A test workflow",
            steps=steps
        )
        
        assert workflow.workflow_id == "workflow_001"
        assert workflow.name == "Test Workflow"
        assert workflow.description == "A test workflow"
        assert len(workflow.steps) == 2
        assert isinstance(workflow.created_at, datetime)


class TestAgentOrchestrator:
    """Test AgentOrchestrator functionality."""
    
    @pytest.fixture
    async def mock_redis(self):
        """Mock Redis client."""
        with patch('src.counterfeit_detection.config.redis.get_redis_client') as mock:
            redis_client = AsyncMock()
            mock.return_value = redis_client
            yield redis_client
    
    @pytest.fixture
    async def orchestrator(self, mock_redis):
        """Create orchestrator for testing."""
        orchestrator = AgentOrchestrator()
        await orchestrator.start()
        yield orchestrator
        await orchestrator.stop()
    
    @pytest.mark.asyncio
    async def test_orchestrator_initialization(self, mock_redis):
        """Test orchestrator initialization."""
        orchestrator = AgentOrchestrator()
        
        assert len(orchestrator.registered_agents) == 0
        assert len(orchestrator.workflows) == 0
        assert len(orchestrator.active_executions) == 0
        
        await orchestrator.start()
        
        assert orchestrator.redis_client is not None
        assert len(orchestrator.running_tasks) > 0
        
        await orchestrator.stop()
    
    def test_workflow_registration(self, orchestrator):
        """Test workflow registration."""
        workflow = Workflow(
            workflow_id="test_workflow",
            name="Test Workflow",
            steps=[
                WorkflowStep(
                    step_id="step_001",
                    agent_type="test_agent",
                    message_type="test_message",
                    payload={}
                )
            ]
        )
        
        orchestrator.register_workflow(workflow)
        
        assert "test_workflow" in orchestrator.workflows
        assert orchestrator.workflows["test_workflow"] == workflow
    
    @pytest.mark.asyncio
    async def test_agent_registration_handling(self, orchestrator, mock_redis):
        """Test agent registration message handling."""
        # Create mock agent metadata
        metadata = AgentMetadata(
            agent_id="test_agent_001",
            agent_type="test_agent",
            version="1.0.0"
        )
        
        # Simulate registration message
        registration_message = AgentMessage(
            sender_id="test_agent_001",
            message_type="agent_register",
            payload=metadata.dict()
        )
        
        # Test registration handling
        await orchestrator._handle_registration_message(
            "orchestrator.register",
            registration_message.json()
        )
        
        # Verify agent was registered
        assert "test_agent_001" in orchestrator.registered_agents
        assert orchestrator.registered_agents["test_agent_001"].agent_id == "test_agent_001"
        assert "test_agent_001" in orchestrator.agent_instances["test_agent"]
    
    @pytest.mark.asyncio
    async def test_agent_deregistration_handling(self, orchestrator):
        """Test agent deregistration message handling."""
        # First register an agent
        metadata = AgentMetadata(
            agent_id="test_agent_001",
            agent_type="test_agent"
        )
        orchestrator.registered_agents["test_agent_001"] = metadata
        orchestrator.agent_instances["test_agent"].append("test_agent_001")
        
        # Create deregistration message
        deregistration_message = AgentMessage(
            sender_id="test_agent_001",
            message_type="agent_deregister",
            payload={"agent_id": "test_agent_001"}
        )
        
        # Test deregistration handling
        await orchestrator._handle_registration_message(
            "orchestrator.deregister",
            deregistration_message.json()
        )
        
        # Verify agent was deregistered
        assert "test_agent_001" not in orchestrator.registered_agents
        assert "test_agent_001" not in orchestrator.agent_instances["test_agent"]
    
    def test_get_agents_by_type(self, orchestrator):
        """Test getting agents by type."""
        # Register test agents
        for i in range(3):
            metadata = AgentMetadata(
                agent_id=f"agent_{i:03d}",
                agent_type="test_agent"
            )
            orchestrator.registered_agents[f"agent_{i:03d}"] = metadata
        
        # Register different type agent
        metadata = AgentMetadata(
            agent_id="other_agent_001",
            agent_type="other_agent"
        )
        orchestrator.registered_agents["other_agent_001"] = metadata
        
        # Test filtering by type
        test_agents = orchestrator.get_agents_by_type("test_agent")
        other_agents = orchestrator.get_agents_by_type("other_agent")
        
        assert len(test_agents) == 3
        assert len(other_agents) == 1
        assert all(agent.agent_type == "test_agent" for agent in test_agents)
        assert other_agents[0].agent_type == "other_agent"
    
    @pytest.mark.asyncio
    async def test_send_message_to_agent(self, orchestrator, mock_redis):
        """Test sending message to specific agent."""
        # Register test agent
        metadata = AgentMetadata(
            agent_id="test_agent_001",
            agent_type="test_agent",
            status=AgentStatus.RUNNING
        )
        orchestrator.registered_agents["test_agent_001"] = metadata
        
        # Create test message
        message = AgentMessage(
            sender_id="orchestrator",
            recipient_id="test_agent_001",
            message_type="test_message",
            payload={"data": "test"}
        )
        
        # Send message
        await orchestrator.send_message_to_agent("test_agent_001", message)
        
        # Verify Redis publish was called
        mock_redis.publish.assert_called()
        
        # Check the channel and message
        call_args = mock_redis.publish.call_args
        channel, message_json = call_args[0]
        
        assert channel == "agent.test_agent_001"
        assert "test_message" in message_json
    
    @pytest.mark.asyncio
    async def test_broadcast_message(self, orchestrator, mock_redis):
        """Test broadcasting message to agents."""
        message = AgentMessage(
            sender_id="orchestrator",
            message_type="broadcast_message",
            payload={"announcement": "test"}
        )
        
        # Test broadcast to all agents
        await orchestrator.broadcast_message(message)
        
        # Verify Redis publish was called with broadcast channel
        mock_redis.publish.assert_called_with("broadcast.all", message.json())
        
        # Test broadcast to specific agent type
        await orchestrator.broadcast_message(message, agent_type="test_agent")
        
        # Verify Redis publish was called with type-specific channel
        mock_redis.publish.assert_called_with("broadcast.test_agent", message.json())
    
    @pytest.mark.asyncio
    async def test_workflow_execution_simple(self, orchestrator):
        """Test simple workflow execution."""
        # Create simple workflow
        workflow = Workflow(
            workflow_id="simple_workflow",
            name="Simple Test Workflow",
            steps=[
                WorkflowStep(
                    step_id="step_001",
                    agent_type="test_agent",
                    message_type="process",
                    payload={"input": "data"}
                )
            ]
        )
        
        orchestrator.register_workflow(workflow)
        
        # Register mock agent
        metadata = AgentMetadata(
            agent_id="test_agent_001",
            agent_type="test_agent",
            status=AgentStatus.RUNNING
        )
        orchestrator.registered_agents["test_agent_001"] = metadata
        
        # Execute workflow
        execution_id = await orchestrator.execute_workflow("simple_workflow")
        
        # Verify execution was created
        assert execution_id in orchestrator.active_executions
        
        execution = orchestrator.active_executions[execution_id]
        assert execution.workflow_id == "simple_workflow"
        assert execution.status in ["running", "pending"]
    
    @pytest.mark.asyncio
    async def test_workflow_execution_with_dependencies(self, orchestrator):
        """Test workflow execution with step dependencies."""
        # Create workflow with dependencies
        workflow = Workflow(
            workflow_id="dependency_workflow",
            name="Dependency Test Workflow",
            steps=[
                WorkflowStep(
                    step_id="step_001",
                    agent_type="analyzer",
                    message_type="analyze",
                    payload={"input": "data"}
                ),
                WorkflowStep(
                    step_id="step_002",
                    agent_type="processor",
                    message_type="process",
                    payload={},
                    depends_on=["step_001"]
                ),
                WorkflowStep(
                    step_id="step_003",
                    agent_type="finalizer",
                    message_type="finalize",
                    payload={},
                    depends_on=["step_002"]
                )
            ]
        )
        
        orchestrator.register_workflow(workflow)
        
        # Register mock agents
        for agent_type in ["analyzer", "processor", "finalizer"]:
            metadata = AgentMetadata(
                agent_id=f"{agent_type}_001",
                agent_type=agent_type,
                status=AgentStatus.RUNNING
            )
            orchestrator.registered_agents[f"{agent_type}_001"] = metadata
        
        # Execute workflow
        execution_id = await orchestrator.execute_workflow("dependency_workflow")
        
        # Verify execution was created
        assert execution_id in orchestrator.active_executions
        
        execution = orchestrator.active_executions[execution_id]
        assert execution.workflow_id == "dependency_workflow"
        assert len(workflow.steps) == 3
    
    @pytest.mark.asyncio
    async def test_heartbeat_handling(self, orchestrator):
        """Test agent heartbeat handling."""
        # Register test agent
        metadata = AgentMetadata(
            agent_id="test_agent_001",
            agent_type="test_agent"
        )
        orchestrator.registered_agents["test_agent_001"] = metadata
        
        # Create heartbeat message
        heartbeat_time = datetime.utcnow()
        heartbeat_message = AgentMessage(
            sender_id="test_agent_001",
            message_type="heartbeat",
            payload={"timestamp": heartbeat_time.isoformat()}
        )
        
        # Handle heartbeat
        await orchestrator._handle_heartbeat_message(heartbeat_message.json())
        
        # Verify heartbeat was processed
        updated_metadata = orchestrator.registered_agents["test_agent_001"]
        assert updated_metadata.last_heartbeat is not None
        assert updated_metadata.last_heartbeat >= heartbeat_time
    
    def test_get_execution_status(self, orchestrator):
        """Test getting workflow execution status."""
        # Create mock execution
        execution = WorkflowExecution(
            execution_id="test_exec_001",
            workflow_id="test_workflow",
            status="running"
        )
        orchestrator.active_executions["test_exec_001"] = execution
        
        # Test getting status
        status = orchestrator.get_execution_status("test_exec_001")
        assert status == execution
        
        # Test non-existent execution
        status = orchestrator.get_execution_status("non_existent")
        assert status is None
    
    def test_get_registered_agents(self, orchestrator):
        """Test getting all registered agents."""
        # Register test agents
        for i in range(3):
            metadata = AgentMetadata(
                agent_id=f"agent_{i:03d}",
                agent_type="test_agent"
            )
            orchestrator.registered_agents[f"agent_{i:03d}"] = metadata
        
        # Get all agents
        agents = orchestrator.get_registered_agents()
        
        assert len(agents) == 3
        assert isinstance(agents, dict)
        assert all(isinstance(metadata, AgentMetadata) for metadata in agents.values())
        
        # Ensure it's a copy, not the original
        agents["new_agent"] = AgentMetadata(agent_id="new", agent_type="new")
        assert "new_agent" not in orchestrator.registered_agents


class TestWorkflowExecution:
    """Test WorkflowExecution functionality."""
    
    def test_workflow_execution_creation(self):
        """Test creating workflow execution."""
        execution = WorkflowExecution(
            execution_id="exec_001",
            workflow_id="workflow_001"
        )
        
        assert execution.execution_id == "exec_001"
        assert execution.workflow_id == "workflow_001"
        assert execution.status == "pending"
        assert execution.started_at is None
        assert execution.completed_at is None
        assert len(execution.completed_steps) == 0
        assert len(execution.failed_steps) == 0
        assert len(execution.step_results) == 0
    
    def test_workflow_execution_status_updates(self):
        """Test workflow execution status updates."""
        execution = WorkflowExecution(
            execution_id="exec_001",
            workflow_id="workflow_001"
        )
        
        # Update to running
        execution.status = "running"
        execution.started_at = datetime.utcnow()
        
        assert execution.status == "running"
        assert execution.started_at is not None
        
        # Complete a step
        execution.completed_steps.add("step_001")
        execution.step_results["step_001"] = {"result": "success"}
        
        assert "step_001" in execution.completed_steps
        assert execution.step_results["step_001"]["result"] == "success"
        
        # Complete execution
        execution.status = "completed"
        execution.completed_at = datetime.utcnow()
        
        assert execution.status == "completed"
        assert execution.completed_at is not None