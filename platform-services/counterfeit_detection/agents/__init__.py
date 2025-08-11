"""
Multi-agent system package for counterfeit detection.

This package implements the multi-agent architecture framework with:
- BaseAgent abstract class for agent development
- AgentOrchestrator for workflow coordination
- Agent utilities for communication, registry, and monitoring
"""

from .base import (
    BaseAgent,
    AgentMessage,
    AgentResponse,
    AgentMetadata,
    AgentCapability,
    AgentStatus
)
from .orchestrator import (
    AgentOrchestrator,
    Workflow,
    WorkflowStep,
    WorkflowExecution
)
from .utils import (
    MessageBus,
    MessageRouter,
    AgentRegistry,
    AgentHealth,
    MetricsCollector,
    AgentMetrics,
    MetricType
)

__all__ = [
    # Base agent classes
    "BaseAgent",
    "AgentMessage", 
    "AgentResponse",
    "AgentMetadata",
    "AgentCapability",
    "AgentStatus",
    
    # Orchestrator classes
    "AgentOrchestrator",
    "Workflow",
    "WorkflowStep", 
    "WorkflowExecution",
    
    # Utility classes
    "MessageBus",
    "MessageRouter",
    "AgentRegistry",
    "AgentHealth",
    "MetricsCollector",
    "AgentMetrics",
    "MetricType"
]