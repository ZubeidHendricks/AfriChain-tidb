"""
Enforcement Agent for automated product enforcement actions.

This agent handles automated enforcement actions against counterfeit products,
including product takedown, pausing, and supplier notifications.
"""

import asyncio
import json
from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional, Any
from uuid import uuid4

import structlog
from pydantic import BaseModel, Field

from .base import BaseAgent, AgentCapability, AgentMessage, AgentResponse
from ..core.database import get_db_session
from ..db.repositories.enforcement_repository import EnforcementRepository
from ..services.enforcement_service import EnforcementService
from ..services.platform_connectors.factory import PlatformConnectorFactory
from ..models.enums import ProductStatus, EnforcementAction, EnforcementStatus

logger = structlog.get_logger(__name__)


class EnforcementResult(BaseModel):
    """Result of an enforcement action."""
    
    action_id: str = Field(default_factory=lambda: str(uuid4()))
    product_id: str
    action_type: EnforcementAction
    status: EnforcementStatus
    authenticity_score: int
    confidence_score: float
    reasoning: str
    executed_by: str
    platform_response: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None
    execution_duration_ms: float = 0.0
    created_at: datetime = Field(default_factory=datetime.utcnow)


class EnforcementRequest(BaseModel):
    """Request for enforcement action."""
    
    product_id: str
    action_type: Optional[EnforcementAction] = None  # Auto-determined if None
    authenticity_score: int
    confidence_score: float
    reasoning: str
    rule_matches: List[str] = Field(default_factory=list)
    priority_override: bool = False
    requires_approval: bool = False
    supplier_id: Optional[str] = None


class BatchEnforcementResult(BaseModel):
    """Result of batch enforcement actions."""
    
    batch_id: str = Field(default_factory=lambda: str(uuid4()))
    total_actions: int
    successful_actions: int
    failed_actions: int
    pending_approval: int
    results: List[EnforcementResult]
    processing_duration_ms: float
    created_at: datetime = Field(default_factory=datetime.utcnow)


class EnforcementAgent(BaseAgent):
    """Agent responsible for automated enforcement actions."""
    
    def __init__(self, agent_id: str):
        """Initialize enforcement agent."""
        capabilities = [
            AgentCapability(
                name="execute_enforcement",
                description="Execute enforcement action against a product"
            ),
            AgentCapability(
                name="batch_enforce",
                description="Execute multiple enforcement actions in batch"
            ),
            AgentCapability(
                name="evaluate_action",
                description="Evaluate what enforcement action should be taken"
            ),
            AgentCapability(
                name="rollback_action",
                description="Rollback a previously executed enforcement action"
            )
        ]
        
        super().__init__(
            agent_id=agent_id,
            agent_type="enforcement_agent",
            capabilities=capabilities
        )
        
        # Initialize services
        self.enforcement_service: Optional[EnforcementService] = None
        self.enforcement_repository: Optional[EnforcementRepository] = None
        self.platform_factory: Optional[PlatformConnectorFactory] = None
        
        # Performance metrics
        self.total_actions_executed = 0
        self.total_execution_time = 0.0
        self.action_type_stats = {}
        self.platform_stats = {}
        self.rollback_count = 0
    
    async def start(self):
        """Start the enforcement agent and initialize services."""
        await super().start()
        
        try:
            # Initialize enforcement service
            self.enforcement_service = EnforcementService()
            
            # Initialize platform connector factory
            self.platform_factory = PlatformConnectorFactory()
            
            logger.info("Enforcement agent started successfully", agent_id=self.agent_id)
            
        except Exception as e:
            logger.error("Failed to start enforcement agent", error=str(e), agent_id=self.agent_id)
            raise
    
    async def process_message(self, message: AgentMessage) -> AgentResponse:
        """Process incoming messages for enforcement actions."""
        try:
            if message.message_type == "execute_enforcement":
                return await self._handle_execute_enforcement(message)
            
            elif message.message_type == "batch_enforce":
                return await self._handle_batch_enforce(message)
            
            elif message.message_type == "evaluate_action":
                return await self._handle_evaluate_action(message)
            
            elif message.message_type == "rollback_action":
                return await self._handle_rollback_action(message)
            
            elif message.message_type == "get_enforcement_stats":
                return await self._handle_get_stats(message)
            
            else:
                return AgentResponse(
                    success=False,
                    message=f"Unknown message type: {message.message_type}",
                    agent_id=self.agent_id
                )
        
        except Exception as e:
            logger.error("Error processing enforcement message", 
                        error=str(e), 
                        message_type=message.message_type,
                        agent_id=self.agent_id)
            
            return AgentResponse(
                success=False,
                message=f"Error processing message: {str(e)}",
                agent_id=self.agent_id
            )
    
    async def _handle_execute_enforcement(self, message: AgentMessage) -> AgentResponse:
        """Handle execute enforcement message."""
        try:
            request_data = message.payload
            request = EnforcementRequest(**request_data)
            
            result = await self.execute_enforcement_action(request)
            
            return AgentResponse(
                success=result.status == EnforcementStatus.COMPLETED,
                message=f"Enforcement action {result.status.value}",
                result=result.dict(),
                agent_id=self.agent_id
            )
        
        except Exception as e:
            logger.error("Failed to execute enforcement action", error=str(e))
            return AgentResponse(
                success=False,
                message=f"Failed to execute enforcement: {str(e)}",
                agent_id=self.agent_id
            )
    
    async def _handle_batch_enforce(self, message: AgentMessage) -> AgentResponse:
        """Handle batch enforcement message."""
        try:
            requests_data = message.payload.get("requests", [])
            requests = [EnforcementRequest(**req) for req in requests_data]
            
            result = await self.execute_batch_enforcement(requests)
            
            return AgentResponse(
                success=result.failed_actions == 0,
                message=f"Batch enforcement completed: {result.successful_actions}/{result.total_actions} successful",
                result=result.dict(),
                agent_id=self.agent_id
            )
        
        except Exception as e:
            logger.error("Failed to execute batch enforcement", error=str(e))
            return AgentResponse(
                success=False,
                message=f"Failed to execute batch enforcement: {str(e)}",
                agent_id=self.agent_id
            )
    
    async def _handle_evaluate_action(self, message: AgentMessage) -> AgentResponse:
        """Handle action evaluation message."""
        try:
            product_data = message.payload
            
            recommended_action = await self.evaluate_enforcement_action(
                product_id=product_data["product_id"],
                authenticity_score=product_data["authenticity_score"],
                confidence_score=product_data["confidence_score"],
                category=product_data.get("category"),
                supplier_id=product_data.get("supplier_id")
            )
            
            return AgentResponse(
                success=True,
                message="Action evaluation completed",
                result={
                    "recommended_action": recommended_action.value,
                    "product_id": product_data["product_id"]
                },
                agent_id=self.agent_id
            )
        
        except Exception as e:
            logger.error("Failed to evaluate enforcement action", error=str(e))
            return AgentResponse(
                success=False,
                message=f"Failed to evaluate action: {str(e)}",
                agent_id=self.agent_id
            )
    
    async def _handle_rollback_action(self, message: AgentMessage) -> AgentResponse:
        """Handle rollback action message."""
        try:
            action_id = message.payload.get("action_id")
            reason = message.payload.get("reason", "Manual rollback")
            
            success = await self.rollback_enforcement_action(action_id, reason)
            
            if success:
                self.rollback_count += 1
            
            return AgentResponse(
                success=success,
                message="Rollback completed" if success else "Rollback failed",
                result={"action_id": action_id, "rollback_successful": success},
                agent_id=self.agent_id
            )
        
        except Exception as e:
            logger.error("Failed to rollback enforcement action", error=str(e))
            return AgentResponse(
                success=False,
                message=f"Failed to rollback action: {str(e)}",
                agent_id=self.agent_id
            )
    
    async def _handle_get_stats(self, message: AgentMessage) -> AgentResponse:
        """Handle get enforcement statistics message."""
        try:
            stats = {
                "agent_id": self.agent_id,
                "total_actions_executed": self.total_actions_executed,
                "average_execution_time_ms": (
                    self.total_execution_time / self.total_actions_executed 
                    if self.total_actions_executed > 0 else 0
                ),
                "action_type_distribution": self.action_type_stats,
                "platform_distribution": self.platform_stats,
                "rollback_count": self.rollback_count,
                "processed_messages": self.processed_messages,
                "error_count": self.error_count,
                "status": self.status.value,
                "uptime_seconds": (datetime.utcnow() - self.started_at).total_seconds() if self.started_at else 0
            }
            
            return AgentResponse(
                success=True,
                message="Enforcement statistics retrieved",
                result=stats,
                agent_id=self.agent_id
            )
        
        except Exception as e:
            logger.error("Failed to get enforcement statistics", error=str(e))
            return AgentResponse(
                success=False,
                message=f"Failed to get statistics: {str(e)}",
                agent_id=self.agent_id
            )
    
    async def execute_enforcement_action(self, request: EnforcementRequest) -> EnforcementResult:
        """
        Execute a single enforcement action.
        
        Args:
            request: Enforcement action request
            
        Returns:
            EnforcementResult with action details and status
        """
        start_time = datetime.utcnow()
        action_id = str(uuid4())
        
        try:
            async with get_db_session() as session:
                if not self.enforcement_repository:
                    self.enforcement_repository = EnforcementRepository(session)
                
                # Determine action type if not specified
                if not request.action_type:
                    request.action_type = await self.evaluate_enforcement_action(
                        product_id=request.product_id,
                        authenticity_score=request.authenticity_score,
                        confidence_score=request.confidence_score
                    )
                
                # Check if action requires approval
                if request.requires_approval and not request.priority_override:
                    result = EnforcementResult(
                        action_id=action_id,
                        product_id=request.product_id,
                        action_type=request.action_type,
                        status=EnforcementStatus.PENDING_APPROVAL,
                        authenticity_score=request.authenticity_score,
                        confidence_score=request.confidence_score,
                        reasoning=request.reasoning,
                        executed_by=self.agent_id
                    )
                    
                    # Log pending action
                    await self.enforcement_repository.create_enforcement_action({
                        "id": action_id,
                        "product_id": request.product_id,
                        "action_type": request.action_type.value,
                        "authenticity_score": request.authenticity_score,
                        "confidence_score": request.confidence_score,
                        "reasoning": request.reasoning,
                        "executed_by": self.agent_id,
                        "execution_status": "pending_approval"
                    })
                    
                    return result
                
                # Execute the action via platform connector
                platform_response = await self._execute_platform_action(
                    request.product_id, 
                    request.action_type
                )
                
                # Determine execution status
                if platform_response and platform_response.get("success", False):
                    execution_status = EnforcementStatus.COMPLETED
                    status_message = "Action executed successfully"
                else:
                    execution_status = EnforcementStatus.FAILED
                    status_message = platform_response.get("error", "Unknown platform error")
                
                # Calculate execution duration
                execution_duration = (datetime.utcnow() - start_time).total_seconds() * 1000
                
                # Create result
                result = EnforcementResult(
                    action_id=action_id,
                    product_id=request.product_id,
                    action_type=request.action_type,
                    status=execution_status,
                    authenticity_score=request.authenticity_score,
                    confidence_score=request.confidence_score,
                    reasoning=request.reasoning,
                    executed_by=self.agent_id,
                    platform_response=platform_response,
                    error_message=status_message if execution_status == EnforcementStatus.FAILED else None,
                    execution_duration_ms=execution_duration
                )
                
                # Log the action
                await self.enforcement_repository.create_enforcement_action({
                    "id": action_id,
                    "product_id": request.product_id,
                    "action_type": request.action_type.value,
                    "authenticity_score": request.authenticity_score,
                    "confidence_score": request.confidence_score,
                    "reasoning": request.reasoning,
                    "executed_by": self.agent_id,
                    "execution_status": execution_status.value.lower(),
                    "platform_response": platform_response,
                    "completed_at": datetime.utcnow() if execution_status == EnforcementStatus.COMPLETED else None
                })
                
                # Update performance metrics
                self.total_actions_executed += 1
                self.total_execution_time += execution_duration
                
                action_type_key = request.action_type.value
                self.action_type_stats[action_type_key] = self.action_type_stats.get(action_type_key, 0) + 1
                
                # Notify supplier if action was successful
                if execution_status == EnforcementStatus.COMPLETED and request.supplier_id:
                    await self._notify_supplier(request.supplier_id, request.action_type, request.product_id)
                
                logger.info(
                    "Enforcement action executed",
                    action_id=action_id,
                    product_id=request.product_id,
                    action_type=request.action_type.value,
                    status=execution_status.value,
                    duration_ms=execution_duration
                )
                
                return result
        
        except Exception as e:
            execution_duration = (datetime.utcnow() - start_time).total_seconds() * 1000
            
            logger.error(
                "Failed to execute enforcement action",
                error=str(e),
                product_id=request.product_id,
                action_type=request.action_type.value if request.action_type else "unknown"
            )
            
            return EnforcementResult(
                action_id=action_id,
                product_id=request.product_id,
                action_type=request.action_type or EnforcementAction.NONE,
                status=EnforcementStatus.FAILED,
                authenticity_score=request.authenticity_score,
                confidence_score=request.confidence_score,
                reasoning=request.reasoning,
                executed_by=self.agent_id,
                error_message=str(e),
                execution_duration_ms=execution_duration
            )
    
    async def execute_batch_enforcement(self, requests: List[EnforcementRequest]) -> BatchEnforcementResult:
        """
        Execute multiple enforcement actions in batch.
        
        Args:
            requests: List of enforcement requests
            
        Returns:
            BatchEnforcementResult with summary and individual results
        """
        start_time = datetime.utcnow()
        
        try:
            # Execute actions concurrently with semaphore to limit concurrency
            semaphore = asyncio.Semaphore(5)  # Limit to 5 concurrent actions
            
            async def execute_with_semaphore(request):
                async with semaphore:
                    return await self.execute_enforcement_action(request)
            
            # Execute all actions
            results = await asyncio.gather(
                *[execute_with_semaphore(request) for request in requests],
                return_exceptions=True
            )
            
            # Process results
            enforcement_results = []
            successful_actions = 0
            failed_actions = 0
            pending_approval = 0
            
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    # Handle exceptions
                    failed_result = EnforcementResult(
                        product_id=requests[i].product_id,
                        action_type=requests[i].action_type or EnforcementAction.NONE,
                        status=EnforcementStatus.FAILED,
                        authenticity_score=requests[i].authenticity_score,
                        confidence_score=requests[i].confidence_score,
                        reasoning=requests[i].reasoning,
                        executed_by=self.agent_id,
                        error_message=str(result)
                    )
                    enforcement_results.append(failed_result)
                    failed_actions += 1
                else:
                    enforcement_results.append(result)
                    if result.status == EnforcementStatus.COMPLETED:
                        successful_actions += 1
                    elif result.status == EnforcementStatus.PENDING_APPROVAL:
                        pending_approval += 1
                    else:
                        failed_actions += 1
            
            processing_duration = (datetime.utcnow() - start_time).total_seconds() * 1000
            
            batch_result = BatchEnforcementResult(
                total_actions=len(requests),
                successful_actions=successful_actions,
                failed_actions=failed_actions,
                pending_approval=pending_approval,
                results=enforcement_results,
                processing_duration_ms=processing_duration
            )
            
            logger.info(
                "Batch enforcement completed",
                batch_id=batch_result.batch_id,
                total_actions=batch_result.total_actions,
                successful_actions=successful_actions,
                failed_actions=failed_actions,
                pending_approval=pending_approval,
                duration_ms=processing_duration
            )
            
            return batch_result
        
        except Exception as e:
            processing_duration = (datetime.utcnow() - start_time).total_seconds() * 1000
            
            logger.error("Failed to execute batch enforcement", error=str(e))
            
            return BatchEnforcementResult(
                total_actions=len(requests),
                successful_actions=0,
                failed_actions=len(requests),
                pending_approval=0,
                results=[],
                processing_duration_ms=processing_duration
            )
    
    async def evaluate_enforcement_action(
        self,
        product_id: str,
        authenticity_score: int,
        confidence_score: float,
        category: Optional[str] = None,
        supplier_id: Optional[str] = None
    ) -> EnforcementAction:
        """
        Evaluate what enforcement action should be taken based on product analysis.
        
        Args:
            product_id: Product identifier
            authenticity_score: Authenticity score (0-100)
            confidence_score: Analysis confidence (0.0-1.0)
            category: Product category for category-specific rules
            supplier_id: Supplier ID for reputation-based decisions
            
        Returns:
            Recommended EnforcementAction
        """
        try:
            if not self.enforcement_service:
                self.enforcement_service = EnforcementService()
            
            # Use enforcement service to determine action
            action = await self.enforcement_service.determine_enforcement_action(
                authenticity_score=authenticity_score,
                confidence_score=confidence_score,
                category=category,
                supplier_id=supplier_id
            )
            
            return action
        
        except Exception as e:
            logger.error("Failed to evaluate enforcement action", error=str(e), product_id=product_id)
            # Default to warning for failed evaluations
            return EnforcementAction.WARNING
    
    async def rollback_enforcement_action(self, action_id: str, reason: str) -> bool:
        """
        Rollback a previously executed enforcement action.
        
        Args:
            action_id: Action identifier to rollback
            reason: Reason for rollback
            
        Returns:
            True if rollback successful, False otherwise
        """
        try:
            async with get_db_session() as session:
                if not self.enforcement_repository:
                    self.enforcement_repository = EnforcementRepository(session)
                
                # Get the original action
                original_action = await self.enforcement_repository.get_enforcement_action_by_id(action_id)
                if not original_action:
                    logger.error("Enforcement action not found for rollback", action_id=action_id)
                    return False
                
                # Execute rollback via platform connector
                rollback_response = await self._execute_platform_rollback(
                    original_action.product_id,
                    EnforcementAction(original_action.action_type)
                )
                
                if rollback_response and rollback_response.get("success", False):
                    # Update original action status
                    await self.enforcement_repository.update_enforcement_action(action_id, {
                        "execution_status": "rolled_back",
                        "platform_response": {
                            **original_action.platform_response,
                            "rollback_response": rollback_response,
                            "rollback_reason": reason,
                            "rollback_timestamp": datetime.utcnow().isoformat()
                        }
                    })
                    
                    logger.info("Enforcement action rolled back successfully", 
                               action_id=action_id, reason=reason)
                    return True
                else:
                    logger.error("Platform rollback failed", 
                                action_id=action_id, 
                                response=rollback_response)
                    return False
        
        except Exception as e:
            logger.error("Failed to rollback enforcement action", error=str(e), action_id=action_id)
            return False
    
    async def _execute_platform_action(self, product_id: str, action_type: EnforcementAction) -> Dict[str, Any]:
        """Execute action via platform connector."""
        try:
            if not self.platform_factory:
                self.platform_factory = PlatformConnectorFactory()
            
            # Get platform connector (default to generic if specific platform not available)
            connector = await self.platform_factory.get_connector("default")
            
            # Execute action based on type
            if action_type == EnforcementAction.TAKEDOWN:
                response = await connector.remove_product(product_id)
            elif action_type == EnforcementAction.PAUSE:
                response = await connector.pause_product(product_id)
            elif action_type == EnforcementAction.VISIBILITY_REDUCE:
                response = await connector.reduce_visibility(product_id, 0.1)  # Reduce to 10% visibility
            elif action_type == EnforcementAction.WARNING:
                response = {"success": True, "action": "warning_logged"}
            else:
                response = {"success": True, "action": "no_action"}
            
            # Track platform stats
            platform_key = connector.__class__.__name__
            self.platform_stats[platform_key] = self.platform_stats.get(platform_key, 0) + 1
            
            return response
        
        except Exception as e:
            logger.error("Failed to execute platform action", error=str(e), product_id=product_id)
            return {"success": False, "error": str(e)}
    
    async def _execute_platform_rollback(self, product_id: str, original_action: EnforcementAction) -> Dict[str, Any]:
        """Execute rollback action via platform connector."""
        try:
            if not self.platform_factory:
                self.platform_factory = PlatformConnectorFactory()
            
            connector = await self.platform_factory.get_connector("default")
            
            # Execute reverse action
            if original_action == EnforcementAction.TAKEDOWN:
                # Restore product
                response = await connector.restore_product(product_id)
            elif original_action == EnforcementAction.PAUSE:
                # Unpause product
                response = await connector.unpause_product(product_id)
            elif original_action == EnforcementAction.VISIBILITY_REDUCE:
                # Restore full visibility
                response = await connector.restore_visibility(product_id)
            else:
                response = {"success": True, "action": "rollback_completed"}
            
            return response
        
        except Exception as e:
            logger.error("Failed to execute platform rollback", error=str(e), product_id=product_id)
            return {"success": False, "error": str(e)}
    
    async def _notify_supplier(self, supplier_id: str, action_type: EnforcementAction, product_id: str):
        """Notify supplier about enforcement action."""
        try:
            if not self.platform_factory:
                self.platform_factory = PlatformConnectorFactory()
            
            connector = await self.platform_factory.get_connector("default")
            
            message = f"Enforcement action {action_type.value} has been taken on product {product_id}"
            await connector.notify_supplier(supplier_id, message)
            
            logger.info("Supplier notified of enforcement action", 
                       supplier_id=supplier_id, 
                       action=action_type.value,
                       product_id=product_id)
        
        except Exception as e:
            logger.error("Failed to notify supplier", error=str(e), supplier_id=supplier_id)