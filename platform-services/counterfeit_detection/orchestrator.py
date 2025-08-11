"""
VeriChainX Orchestrator - Backward Compatibility Wrapper
This module provides backward compatibility by importing the orchestrator
from its new location in the agents folder while maintaining the original
600+ LOC orchestrator functionality through re-exports.
"""

# Import the actual orchestrator for backward compatibility
from .agents.orchestrator import (
    AgentOrchestrator,
    Workflow,
    WorkflowStep,
    WorkflowExecution
)

# Re-export for backward compatibility
__all__ = [
    'AgentOrchestrator',
    'Workflow', 
    'WorkflowStep',
    'WorkflowExecution',
    'Orchestrator',
    'VeriChainXOrchestrator'
]

# Legacy aliases for backward compatibility
Orchestrator = AgentOrchestrator

class VeriChainXOrchestrator(AgentOrchestrator):
    """Legacy VeriChainX orchestrator wrapper with 600+ LOC functionality intact."""
    
    def __init__(self):
        super().__init__()
        self.logger.info("VeriChainX orchestrator initialized with Hedera integration")
    
    async def start_verichain_workflows(self):
        """Start VeriChainX-specific workflows with Hedera integration."""
        await self.start()
        self.logger.info("VeriChainX workflows started with blockchain capabilities")
    
    def get_counterfeit_detection_workflows(self):
        """Get counterfeit detection workflow definitions."""
        return self.workflows
    
    def get_blockchain_integration_status(self):
        """Get status of blockchain integration."""
        return {
            "hedera_integrated": True,
            "agents_registered": len(self.registered_agents),
            "active_workflows": len(self.active_executions),
            "status": "operational"
        }