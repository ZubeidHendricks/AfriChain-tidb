"""
Appeals Service for managing supplier appeals and manual overrides.

This service handles the appeal submission, review workflow, and product
reinstatement processes with comprehensive approval chains.
"""

import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from uuid import uuid4
from enum import Enum

import structlog

from ..core.database import get_db_session
from ..db.repositories.appeals_repository import AppealsRepository
from ..db.repositories.enforcement_repository import EnforcementRepository
from ..models.enums import AppealStatus, EnforcementAction, EnforcementStatus
from ..services.audit_service import AuditService

logger = structlog.get_logger(__name__)


class ApprovalLevel(str, Enum):
    """Approval levels for different types of appeals."""
    AUTOMATED = "automated"
    SUPERVISOR = "supervisor"
    MANAGER = "manager"
    SENIOR_MANAGER = "senior_manager"
    EXECUTIVE = "executive"


class AppealOutcome(str, Enum):
    """Possible outcomes of appeal reviews."""
    UPHELD = "upheld"           # Original action was correct
    OVERTURNED = "overturned"   # Action was wrong, fully reverse
    PARTIAL = "partial"         # Action was partially wrong, modify
    PENDING = "pending"         # Still under review


class AppealsService:
    """Service for managing appeals and manual overrides."""
    
    def __init__(self):
        """Initialize appeals service."""
        self.appeals_repository: Optional[AppealsRepository] = None
        self.enforcement_repository: Optional[EnforcementRepository] = None
        self.audit_service: Optional[AuditService] = None
        
        # Appeal approval requirements by action type
        self.approval_requirements = {
            EnforcementAction.WARNING: ApprovalLevel.AUTOMATED,
            EnforcementAction.VISIBILITY_REDUCE: ApprovalLevel.SUPERVISOR,
            EnforcementAction.PAUSE: ApprovalLevel.MANAGER,
            EnforcementAction.TAKEDOWN: ApprovalLevel.SENIOR_MANAGER,
            EnforcementAction.SUPPLIER_SUSPENSION: ApprovalLevel.EXECUTIVE,
            EnforcementAction.ACCOUNT_BAN: ApprovalLevel.EXECUTIVE
        }
        
        # SLA timelines for appeal processing (in hours)
        self.appeal_sla = {
            ApprovalLevel.AUTOMATED: 1,
            ApprovalLevel.SUPERVISOR: 24,
            ApprovalLevel.MANAGER: 48,
            ApprovalLevel.SENIOR_MANAGER: 72,
            ApprovalLevel.EXECUTIVE: 120
        }
    
    async def submit_appeal(
        self,
        action_id: str,
        supplier_id: str,
        reason: str,
        evidence_urls: List[str] = None,
        supplier_contact: Optional[str] = None,
        priority_level: str = "normal"
    ) -> str:
        """
        Submit an appeal for an enforcement action.
        
        Args:
            action_id: ID of enforcement action being appealed
            supplier_id: Supplier submitting the appeal
            reason: Detailed reason for the appeal
            evidence_urls: URLs to supporting evidence
            supplier_contact: Supplier contact information
            priority_level: Priority level of the appeal
            
        Returns:
            Appeal ID
        """
        try:
            async with get_db_session() as session:
                if not self.appeals_repository:
                    self.appeals_repository = AppealsRepository(session)
                if not self.enforcement_repository:
                    self.enforcement_repository = EnforcementRepository(session)
                if not self.audit_service:
                    self.audit_service = AuditService()
                
                # Get the original enforcement action
                action = await self.enforcement_repository.get_enforcement_action_by_id(action_id)
                if not action:
                    raise ValueError(f"Enforcement action {action_id} not found")
                
                # Check if action can be appealed
                if action.appeal_status not in [AppealStatus.NONE.value, AppealStatus.DENIED.value]:
                    raise ValueError(f"Action {action_id} already has an active appeal")
                
                # Determine required approval level
                action_type = EnforcementAction(action.action_type)
                required_approval = self.approval_requirements.get(action_type, ApprovalLevel.MANAGER)
                
                appeal_id = str(uuid4())
                
                # Create appeal record
                appeal_data = {
                    "id": appeal_id,
                    "action_id": action_id,
                    "supplier_id": supplier_id,
                    "appeal_reason": reason,
                    "evidence_urls": evidence_urls or [],
                    "supplier_contact": supplier_contact,
                    "priority_level": priority_level,
                    "required_approval_level": required_approval.value,
                    "status": AppealStatus.SUBMITTED.value,
                    "sla_deadline": datetime.utcnow() + timedelta(hours=self.appeal_sla[required_approval])
                }
                
                appeal = await self.appeals_repository.create_appeal(appeal_data)
                
                # Update enforcement action appeal status
                await self.enforcement_repository.update_enforcement_action(
                    action_id, {"appeal_status": AppealStatus.SUBMITTED.value}
                )
                
                # Log appeal submission
                await self.audit_service.log_enforcement_action(
                    action_id=appeal_id,
                    product_id=action.product_id,
                    action_type=EnforcementAction.WARNING,  # Appeal submission is like a warning
                    authenticity_score=action.authenticity_score,
                    confidence_score=float(action.confidence_score),
                    reasoning=f"Appeal submitted: {reason}",
                    executed_by=supplier_id,
                    context={
                        "appeal_type": "supplier_appeal",
                        "original_action_id": action_id,
                        "evidence_count": len(evidence_urls or []),
                        "priority_level": priority_level
                    }
                )
                
                # Trigger automated review if applicable
                if required_approval == ApprovalLevel.AUTOMATED:
                    await self._process_automated_review(appeal_id)
                
                logger.info(
                    "Appeal submitted",
                    appeal_id=appeal_id,
                    action_id=action_id,
                    supplier_id=supplier_id,
                    required_approval=required_approval.value
                )
                
                return appeal_id
        
        except Exception as e:
            logger.error("Failed to submit appeal", error=str(e), action_id=action_id)
            raise
    
    async def review_appeal(
        self,
        appeal_id: str,
        reviewer_id: str,
        decision: AppealOutcome,
        reviewer_comments: str,
        approval_level: ApprovalLevel,
        reinstatement_conditions: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Review and decide on an appeal.
        
        Args:
            appeal_id: Appeal identifier
            reviewer_id: ID of reviewing user
            decision: Appeal decision outcome
            reviewer_comments: Detailed reviewer comments
            approval_level: Level of reviewer making decision
            reinstatement_conditions: Conditions for reinstatement if applicable
            
        Returns:
            True if review was successful
        """
        try:
            async with get_db_session() as session:
                if not self.appeals_repository:
                    self.appeals_repository = AppealsRepository(session)
                if not self.enforcement_repository:
                    self.enforcement_repository = EnforcementRepository(session)
                
                # Get appeal details
                appeal = await self.appeals_repository.get_appeal_by_id(appeal_id)
                if not appeal:
                    raise ValueError(f"Appeal {appeal_id} not found")
                
                # Verify reviewer has sufficient approval level
                required_level = ApprovalLevel(appeal.required_approval_level)
                if not self._has_sufficient_approval_level(approval_level, required_level):
                    raise ValueError(f"Insufficient approval level. Required: {required_level.value}")
                
                # Update appeal with review decision
                review_data = {
                    "status": AppealStatus.UNDER_REVIEW.value if decision == AppealOutcome.PENDING else AppealStatus.APPROVED.value if decision in [AppealOutcome.OVERTURNED, AppealOutcome.PARTIAL] else AppealStatus.DENIED.value,
                    "reviewer_id": reviewer_id,
                    "reviewer_comments": reviewer_comments,
                    "reviewed_at": datetime.utcnow(),
                    "decision": decision.value,
                    "approval_level": approval_level.value,
                    "reinstatement_conditions": reinstatement_conditions
                }
                
                await self.appeals_repository.update_appeal(appeal_id, review_data)
                
                # Update original enforcement action based on decision
                if decision == AppealOutcome.OVERTURNED:
                    await self._process_full_reinstatement(appeal.action_id, reviewer_id, reviewer_comments)
                elif decision == AppealOutcome.PARTIAL:
                    await self._process_partial_reinstatement(appeal.action_id, reviewer_id, reinstatement_conditions)
                elif decision == AppealOutcome.UPHELD:
                    # Appeal denied, original action stands
                    await self.enforcement_repository.update_enforcement_action(
                        appeal.action_id, {"appeal_status": AppealStatus.DENIED.value}
                    )
                
                # Log review decision
                if self.audit_service:
                    await self.audit_service.log_enforcement_action(
                        action_id=appeal_id,
                        product_id="unknown",  # Would need to fetch from original action
                        action_type=EnforcementAction.WARNING,
                        authenticity_score=0,
                        confidence_score=1.0,
                        reasoning=f"Appeal review: {decision.value} - {reviewer_comments}",
                        executed_by=reviewer_id,
                        context={
                            "appeal_review": True,
                            "decision": decision.value,
                            "original_action_id": appeal.action_id,
                            "approval_level": approval_level.value
                        }
                    )
                
                logger.info(
                    "Appeal reviewed",
                    appeal_id=appeal_id,
                    decision=decision.value,
                    reviewer_id=reviewer_id,
                    approval_level=approval_level.value
                )
                
                return True
        
        except Exception as e:
            logger.error("Failed to review appeal", error=str(e), appeal_id=appeal_id)
            raise
    
    async def manual_override(
        self,
        action_id: str,
        override_by: str,
        justification: str,
        new_action: Optional[EnforcementAction] = None,
        approval_level: ApprovalLevel = ApprovalLevel.MANAGER
    ) -> str:
        """
        Execute manual override of an enforcement action.
        
        Args:
            action_id: ID of action to override
            override_by: User ID executing override
            justification: Detailed justification for override
            new_action: New action to apply (None for complete reversal)
            approval_level: Level of approval for override
            
        Returns:
            Override record ID
        """
        try:
            async with get_db_session() as session:
                if not self.enforcement_repository:
                    self.enforcement_repository = EnforcementRepository(session)
                if not self.appeals_repository:
                    self.appeals_repository = AppealsRepository(session)
                
                # Get original action
                action = await self.enforcement_repository.get_enforcement_action_by_id(action_id)
                if not action:
                    raise ValueError(f"Enforcement action {action_id} not found")
                
                # Verify override authorization
                original_action_type = EnforcementAction(action.action_type)
                required_level = self.approval_requirements.get(original_action_type, ApprovalLevel.MANAGER)
                
                if not self._has_sufficient_approval_level(approval_level, required_level):
                    raise ValueError(f"Insufficient approval level for override. Required: {required_level.value}")
                
                override_id = str(uuid4())
                
                # Create override record
                override_data = {
                    "id": override_id,
                    "action_id": action_id,
                    "override_by": override_by,
                    "justification": justification,
                    "original_action": action.action_type,
                    "new_action": new_action.value if new_action else None,
                    "approval_level": approval_level.value,
                    "override_type": "manual_admin_override"
                }
                
                override_record = await self.appeals_repository.create_override(override_data)
                
                # Execute the override
                if new_action:
                    # Apply new action
                    await self._execute_replacement_action(action_id, new_action, override_by, justification)
                else:
                    # Complete reversal
                    await self._execute_action_reversal(action_id, override_by, justification)
                
                # Log override
                if self.audit_service:
                    await self.audit_service.log_enforcement_action(
                        action_id=override_id,
                        product_id=action.product_id,
                        action_type=new_action or EnforcementAction.NONE,
                        authenticity_score=action.authenticity_score,
                        confidence_score=float(action.confidence_score),
                        reasoning=f"Manual override: {justification}",
                        executed_by=override_by,
                        context={
                            "override_type": "manual_admin",
                            "original_action": action.action_type,
                            "original_action_id": action_id,
                            "approval_level": approval_level.value
                        }
                    )
                
                logger.info(
                    "Manual override executed",
                    override_id=override_id,
                    action_id=action_id,
                    override_by=override_by,
                    new_action=new_action.value if new_action else "reversal"
                )
                
                return override_id
        
        except Exception as e:
            logger.error("Failed to execute manual override", error=str(e), action_id=action_id)
            raise
    
    async def get_appeals(
        self,
        status: Optional[AppealStatus] = None,
        supplier_id: Optional[str] = None,
        reviewer_id: Optional[str] = None,
        priority_level: Optional[str] = None,
        overdue_only: bool = False,
        limit: int = 100,
        offset: int = 0
    ) -> Tuple[List[Dict], int]:
        """
        Get appeals with filtering options.
        
        Args:
            status: Filter by appeal status
            supplier_id: Filter by supplier
            reviewer_id: Filter by reviewer
            priority_level: Filter by priority
            overdue_only: Only return overdue appeals
            limit: Maximum results
            offset: Results offset
            
        Returns:
            Tuple of (appeals list, total count)
        """
        try:
            async with get_db_session() as session:
                if not self.appeals_repository:
                    self.appeals_repository = AppealsRepository(session)
                
                appeals, total_count = await self.appeals_repository.get_appeals(
                    status=status.value if status else None,
                    supplier_id=supplier_id,
                    reviewer_id=reviewer_id,
                    priority_level=priority_level,
                    overdue_only=overdue_only,
                    limit=limit,
                    offset=offset
                )
                
                # Convert to response format
                appeal_responses = []
                for appeal in appeals:
                    appeal_data = {
                        "id": appeal.id,
                        "action_id": appeal.action_id,
                        "supplier_id": appeal.supplier_id,
                        "appeal_reason": appeal.appeal_reason,
                        "evidence_urls": appeal.evidence_urls,
                        "status": appeal.status,
                        "priority_level": appeal.priority_level,
                        "required_approval_level": appeal.required_approval_level,
                        "reviewer_id": appeal.reviewer_id,
                        "reviewer_comments": appeal.reviewer_comments,
                        "decision": appeal.decision,
                        "submitted_at": appeal.submitted_at,
                        "reviewed_at": appeal.reviewed_at,
                        "sla_deadline": appeal.sla_deadline,
                        "is_overdue": appeal.sla_deadline < datetime.utcnow() if appeal.sla_deadline else False
                    }
                    appeal_responses.append(appeal_data)
                
                return appeal_responses, total_count
        
        except Exception as e:
            logger.error("Failed to get appeals", error=str(e))
            raise
    
    async def create_false_positive_feedback(
        self,
        action_id: str,
        feedback_type: str,
        description: str,
        provided_by: str,
        confidence_impact: Optional[float] = None,
        suggested_improvements: Optional[List[str]] = None
    ) -> str:
        """
        Create feedback for false positive detection to improve model.
        
        Args:
            action_id: Original enforcement action ID
            feedback_type: Type of feedback ('false_positive', 'model_error', etc.)
            description: Detailed description of the issue
            provided_by: User providing feedback
            confidence_impact: Impact on confidence scoring
            suggested_improvements: Suggested model improvements
            
        Returns:
            Feedback record ID
        """
        try:
            async with get_db_session() as session:
                if not self.appeals_repository:
                    self.appeals_repository = AppealsRepository(session)
                
                feedback_id = str(uuid4())
                
                feedback_data = {
                    "id": feedback_id,
                    "action_id": action_id,
                    "feedback_type": feedback_type,
                    "description": description,
                    "provided_by": provided_by,
                    "confidence_impact": confidence_impact,
                    "suggested_improvements": suggested_improvements or [],
                    "status": "pending_review",
                    "created_at": datetime.utcnow()
                }
                
                feedback = await self.appeals_repository.create_feedback(feedback_data)
                
                # Log feedback creation
                if self.audit_service:
                    await self.audit_service.log_enforcement_action(
                        action_id=feedback_id,
                        product_id="unknown",
                        action_type=EnforcementAction.WARNING,
                        authenticity_score=0,
                        confidence_score=1.0,
                        reasoning=f"False positive feedback: {description}",
                        executed_by=provided_by,
                        context={
                            "feedback_type": feedback_type,
                            "original_action_id": action_id,
                            "model_improvement": True
                        }
                    )
                
                logger.info(
                    "False positive feedback created",
                    feedback_id=feedback_id,
                    action_id=action_id,
                    feedback_type=feedback_type
                )
                
                return feedback_id
        
        except Exception as e:
            logger.error("Failed to create false positive feedback", error=str(e))
            raise
    
    async def _process_automated_review(self, appeal_id: str) -> None:
        """Process automated appeal review for low-severity actions."""
        try:
            # For automated reviews, we might check simple criteria
            # This is a simplified implementation
            auto_decision = AppealOutcome.PENDING  # Would have more logic here
            
            await self.review_appeal(
                appeal_id=appeal_id,
                reviewer_id="system_automated_review",
                decision=auto_decision,
                reviewer_comments="Automated preliminary review completed. Human review required.",
                approval_level=ApprovalLevel.AUTOMATED
            )
        
        except Exception as e:
            logger.error("Failed to process automated review", error=str(e), appeal_id=appeal_id)
    
    async def _process_full_reinstatement(self, action_id: str, reviewer_id: str, reason: str) -> None:
        """Process complete reinstatement of a product."""
        try:
            # This would integrate with the platform connectors to restore the product
            await self.enforcement_repository.update_enforcement_action(
                action_id, {
                    "execution_status": "rolled_back",
                    "appeal_status": AppealStatus.APPROVED.value,
                    "platform_response": {
                        "rollback_reason": reason,
                        "rolled_back_by": reviewer_id,
                        "rollback_timestamp": datetime.utcnow().isoformat()
                    }
                }
            )
            
            logger.info("Full reinstatement processed", action_id=action_id, reviewer_id=reviewer_id)
        
        except Exception as e:
            logger.error("Failed to process full reinstatement", error=str(e), action_id=action_id)
    
    async def _process_partial_reinstatement(
        self, 
        action_id: str, 
        reviewer_id: str, 
        conditions: Optional[Dict[str, Any]]
    ) -> None:
        """Process partial reinstatement with conditions."""
        try:
            # This would apply modified enforcement action
            await self.enforcement_repository.update_enforcement_action(
                action_id, {
                    "execution_status": "modified",
                    "appeal_status": AppealStatus.APPROVED.value,
                    "platform_response": {
                        "modification_reason": "Partial appeal approval",
                        "modified_by": reviewer_id,
                        "modification_conditions": conditions,
                        "modification_timestamp": datetime.utcnow().isoformat()
                    }
                }
            )
            
            logger.info("Partial reinstatement processed", action_id=action_id, reviewer_id=reviewer_id)
        
        except Exception as e:
            logger.error("Failed to process partial reinstatement", error=str(e), action_id=action_id)
    
    async def _execute_replacement_action(
        self, 
        original_action_id: str, 
        new_action: EnforcementAction, 
        executed_by: str, 
        reason: str
    ) -> None:
        """Execute replacement enforcement action."""
        try:
            # This would execute the new action via enforcement agent
            # For now, just update the record
            await self.enforcement_repository.update_enforcement_action(
                original_action_id, {
                    "action_type": new_action.value,
                    "execution_status": "completed",
                    "reasoning": f"Override replacement: {reason}",
                    "executed_by": executed_by,
                    "completed_at": datetime.utcnow()
                }
            )
            
            logger.info("Replacement action executed", 
                       original_action_id=original_action_id, 
                       new_action=new_action.value)
        
        except Exception as e:
            logger.error("Failed to execute replacement action", error=str(e))
    
    async def _execute_action_reversal(self, action_id: str, executed_by: str, reason: str) -> None:
        """Execute complete reversal of enforcement action."""
        try:
            # This would use the platform connectors to reverse the action
            await self.enforcement_repository.update_enforcement_action(
                action_id, {
                    "execution_status": "rolled_back",
                    "reasoning": f"Manual override reversal: {reason}",
                    "executed_by": executed_by,
                    "completed_at": datetime.utcnow()
                }
            )
            
            logger.info("Action reversal executed", action_id=action_id, executed_by=executed_by)
        
        except Exception as e:
            logger.error("Failed to execute action reversal", error=str(e))
    
    def _has_sufficient_approval_level(self, user_level: ApprovalLevel, required_level: ApprovalLevel) -> bool:
        """Check if user has sufficient approval level."""
        level_hierarchy = {
            ApprovalLevel.AUTOMATED: 0,
            ApprovalLevel.SUPERVISOR: 1,
            ApprovalLevel.MANAGER: 2,
            ApprovalLevel.SENIOR_MANAGER: 3,
            ApprovalLevel.EXECUTIVE: 4
        }
        
        return level_hierarchy[user_level] >= level_hierarchy[required_level]