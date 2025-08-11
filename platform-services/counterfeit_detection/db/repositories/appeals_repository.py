"""
Repository for appeals and override data operations.

This repository handles CRUD operations for appeals, manual overrides,
and false positive feedback management.
"""

import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
from uuid import uuid4

from sqlalchemy import and_, desc, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

import structlog

from ..models.appeals import Appeal, Override, FalsePositiveFeedback

logger = structlog.get_logger(__name__)


class AppealsRepository:
    """Repository for appeals and override data access."""
    
    def __init__(self, session: AsyncSession):
        self.session = session
    
    # Appeal operations
    async def create_appeal(self, appeal_data: Dict) -> Appeal:
        """
        Create a new appeal record.
        
        Args:
            appeal_data: Dictionary containing appeal information
            
        Returns:
            Created Appeal instance
        """
        try:
            appeal = Appeal(
                id=appeal_data.get("id", str(uuid4())),
                action_id=appeal_data["action_id"],
                supplier_id=appeal_data["supplier_id"],
                appeal_reason=appeal_data["appeal_reason"],
                evidence_urls=appeal_data.get("evidence_urls", []),
                supplier_contact=appeal_data.get("supplier_contact"),
                priority_level=appeal_data.get("priority_level", "normal"),
                required_approval_level=appeal_data["required_approval_level"],
                status=appeal_data.get("status", "submitted"),
                sla_deadline=appeal_data.get("sla_deadline")
            )
            
            self.session.add(appeal)
            await self.session.commit()
            await self.session.refresh(appeal)
            
            logger.info("Appeal created", appeal_id=appeal.id, action_id=appeal.action_id)
            return appeal
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to create appeal", error=str(e))
            raise
    
    async def get_appeal_by_id(self, appeal_id: str) -> Optional[Appeal]:
        """
        Get an appeal by ID.
        
        Args:
            appeal_id: Appeal identifier
            
        Returns:
            Appeal instance or None if not found
        """
        try:
            result = await self.session.execute(
                select(Appeal).where(Appeal.id == appeal_id)
            )
            return result.scalar_one_or_none()
        
        except Exception as e:
            logger.error("Failed to get appeal by ID", error=str(e), appeal_id=appeal_id)
            raise
    
    async def get_appeals_by_action(self, action_id: str) -> List[Appeal]:
        """
        Get all appeals for a specific enforcement action.
        
        Args:
            action_id: Enforcement action identifier
            
        Returns:
            List of Appeal instances
        """
        try:
            result = await self.session.execute(
                select(Appeal)
                .where(Appeal.action_id == action_id)
                .order_by(desc(Appeal.submitted_at))
            )
            return result.scalars().all()
        
        except Exception as e:
            logger.error("Failed to get appeals by action", error=str(e), action_id=action_id)
            raise
    
    async def get_appeals(
        self,
        status: Optional[str] = None,
        supplier_id: Optional[str] = None,
        reviewer_id: Optional[str] = None,
        priority_level: Optional[str] = None,
        overdue_only: bool = False,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        limit: int = 100,
        offset: int = 0
    ) -> Tuple[List[Appeal], int]:
        """
        Get appeals with filtering options.
        
        Args:
            status: Filter by appeal status
            supplier_id: Filter by supplier
            reviewer_id: Filter by reviewer
            priority_level: Filter by priority level
            overdue_only: Only return overdue appeals
            start_date: Filter by submission start date
            end_date: Filter by submission end date
            limit: Maximum number of results
            offset: Number of results to skip
            
        Returns:
            Tuple of (appeals list, total count)
        """
        try:
            conditions = []
            
            if status:
                conditions.append(Appeal.status == status)
            
            if supplier_id:
                conditions.append(Appeal.supplier_id == supplier_id)
            
            if reviewer_id:
                conditions.append(Appeal.reviewer_id == reviewer_id)
            
            if priority_level:
                conditions.append(Appeal.priority_level == priority_level)
            
            if overdue_only:
                conditions.append(
                    and_(
                        Appeal.sla_deadline.isnot(None),
                        Appeal.sla_deadline < datetime.utcnow(),
                        Appeal.status.in_(["submitted", "under_review"])
                    )
                )
            
            if start_date:
                conditions.append(Appeal.submitted_at >= start_date)
            
            if end_date:
                conditions.append(Appeal.submitted_at <= end_date)
            
            # Base query
            base_query = select(Appeal)
            if conditions:
                base_query = base_query.where(and_(*conditions))
            
            # Get total count
            count_query = select(func.count(Appeal.id))
            if conditions:
                count_query = count_query.where(and_(*conditions))
            
            count_result = await self.session.execute(count_query)
            total_count = count_result.scalar()
            
            # Get paginated results
            query = base_query.order_by(
                # Priority order: overdue first, then by priority level, then by submission date
                func.case(
                    (and_(Appeal.sla_deadline < datetime.utcnow(), Appeal.status.in_(["submitted", "under_review"])), 0),
                    else_=1
                ),
                func.case(
                    (Appeal.priority_level == "critical", 0),
                    (Appeal.priority_level == "high", 1),
                    (Appeal.priority_level == "normal", 2),
                    (Appeal.priority_level == "low", 3),
                    else_=4
                ),
                desc(Appeal.submitted_at)
            ).limit(limit).offset(offset)
            
            result = await self.session.execute(query)
            appeals = result.scalars().all()
            
            return appeals, total_count
        
        except Exception as e:
            logger.error("Failed to get appeals", error=str(e))
            raise
    
    async def update_appeal(self, appeal_id: str, update_data: Dict) -> Optional[Appeal]:
        """
        Update an existing appeal.
        
        Args:
            appeal_id: Appeal identifier
            update_data: Dictionary containing fields to update
            
        Returns:
            Updated Appeal instance or None if not found
        """
        try:
            appeal = await self.get_appeal_by_id(appeal_id)
            if not appeal:
                return None
            
            # Update allowed fields
            allowed_fields = {
                "status", "reviewer_id", "reviewer_comments", "reviewed_at",
                "decision", "approval_level", "reinstatement_conditions",
                "sla_deadline", "priority_level"
            }
            
            for field, value in update_data.items():
                if field in allowed_fields and hasattr(appeal, field):
                    setattr(appeal, field, value)
            
            # Update timestamp
            appeal.updated_at = datetime.utcnow()
            
            await self.session.commit()
            await self.session.refresh(appeal)
            
            logger.info("Appeal updated", appeal_id=appeal_id, updated_fields=list(update_data.keys()))
            return appeal
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to update appeal", error=str(e), appeal_id=appeal_id)
            raise
    
    # Override operations
    async def create_override(self, override_data: Dict) -> Override:
        """
        Create a new override record.
        
        Args:
            override_data: Dictionary containing override information
            
        Returns:
            Created Override instance
        """
        try:
            override = Override(
                id=override_data.get("id", str(uuid4())),
                action_id=override_data["action_id"],
                override_by=override_data["override_by"],
                justification=override_data["justification"],
                original_action=override_data["original_action"],
                new_action=override_data.get("new_action"),
                approval_level=override_data["approval_level"],
                override_type=override_data.get("override_type", "manual_admin_override"),
                executed_at=override_data.get("executed_at", datetime.utcnow())
            )
            
            self.session.add(override)
            await self.session.commit()
            await self.session.refresh(override)
            
            logger.info("Override created", override_id=override.id, action_id=override.action_id)
            return override
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to create override", error=str(e))
            raise
    
    async def get_override_by_id(self, override_id: str) -> Optional[Override]:
        """Get override by ID."""
        try:
            result = await self.session.execute(
                select(Override).where(Override.id == override_id)
            )
            return result.scalar_one_or_none()
        
        except Exception as e:
            logger.error("Failed to get override by ID", error=str(e), override_id=override_id)
            raise
    
    async def get_overrides_by_action(self, action_id: str) -> List[Override]:
        """Get all overrides for a specific enforcement action."""
        try:
            result = await self.session.execute(
                select(Override)
                .where(Override.action_id == action_id)
                .order_by(desc(Override.executed_at))
            )
            return result.scalars().all()
        
        except Exception as e:
            logger.error("Failed to get overrides by action", error=str(e), action_id=action_id)
            raise
    
    async def get_overrides(
        self,
        override_by: Optional[str] = None,
        approval_level: Optional[str] = None,
        override_type: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        limit: int = 100,
        offset: int = 0
    ) -> Tuple[List[Override], int]:
        """Get overrides with filtering options."""
        try:
            conditions = []
            
            if override_by:
                conditions.append(Override.override_by == override_by)
            
            if approval_level:
                conditions.append(Override.approval_level == approval_level)
            
            if override_type:
                conditions.append(Override.override_type == override_type)
            
            if start_date:
                conditions.append(Override.executed_at >= start_date)
            
            if end_date:
                conditions.append(Override.executed_at <= end_date)
            
            # Base query
            base_query = select(Override)
            if conditions:
                base_query = base_query.where(and_(*conditions))
            
            # Get total count
            count_query = select(func.count(Override.id))
            if conditions:
                count_query = count_query.where(and_(*conditions))
            
            count_result = await self.session.execute(count_query)
            total_count = count_result.scalar()
            
            # Get paginated results
            query = base_query.order_by(
                desc(Override.executed_at)
            ).limit(limit).offset(offset)
            
            result = await self.session.execute(query)
            overrides = result.scalars().all()
            
            return overrides, total_count
        
        except Exception as e:
            logger.error("Failed to get overrides", error=str(e))
            raise
    
    # False Positive Feedback operations
    async def create_feedback(self, feedback_data: Dict) -> FalsePositiveFeedback:
        """
        Create false positive feedback record.
        
        Args:
            feedback_data: Dictionary containing feedback information
            
        Returns:
            Created FalsePositiveFeedback instance
        """
        try:
            feedback = FalsePositiveFeedback(
                id=feedback_data.get("id", str(uuid4())),
                action_id=feedback_data["action_id"],
                feedback_type=feedback_data["feedback_type"],
                description=feedback_data["description"],
                provided_by=feedback_data["provided_by"],
                confidence_impact=feedback_data.get("confidence_impact"),
                suggested_improvements=feedback_data.get("suggested_improvements", []),
                status=feedback_data.get("status", "pending_review"),
                created_at=feedback_data.get("created_at", datetime.utcnow())
            )
            
            self.session.add(feedback)
            await self.session.commit()
            await self.session.refresh(feedback)
            
            logger.info("False positive feedback created", 
                       feedback_id=feedback.id, 
                       action_id=feedback.action_id)
            return feedback
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to create false positive feedback", error=str(e))
            raise
    
    async def get_feedback_by_id(self, feedback_id: str) -> Optional[FalsePositiveFeedback]:
        """Get feedback by ID."""
        try:
            result = await self.session.execute(
                select(FalsePositiveFeedback).where(FalsePositiveFeedback.id == feedback_id)
            )
            return result.scalar_one_or_none()
        
        except Exception as e:
            logger.error("Failed to get feedback by ID", error=str(e), feedback_id=feedback_id)
            raise
    
    async def get_feedback(
        self,
        action_id: Optional[str] = None,
        feedback_type: Optional[str] = None,
        status: Optional[str] = None,
        provided_by: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        limit: int = 100,
        offset: int = 0
    ) -> Tuple[List[FalsePositiveFeedback], int]:
        """Get feedback records with filtering options."""
        try:
            conditions = []
            
            if action_id:
                conditions.append(FalsePositiveFeedback.action_id == action_id)
            
            if feedback_type:
                conditions.append(FalsePositiveFeedback.feedback_type == feedback_type)
            
            if status:
                conditions.append(FalsePositiveFeedback.status == status)
            
            if provided_by:
                conditions.append(FalsePositiveFeedback.provided_by == provided_by)
            
            if start_date:
                conditions.append(FalsePositiveFeedback.created_at >= start_date)
            
            if end_date:
                conditions.append(FalsePositiveFeedback.created_at <= end_date)
            
            # Base query
            base_query = select(FalsePositiveFeedback)
            if conditions:
                base_query = base_query.where(and_(*conditions))
            
            # Get total count
            count_query = select(func.count(FalsePositiveFeedback.id))
            if conditions:
                count_query = count_query.where(and_(*conditions))
            
            count_result = await self.session.execute(count_query)
            total_count = count_result.scalar()
            
            # Get paginated results
            query = base_query.order_by(
                desc(FalsePositiveFeedback.created_at)
            ).limit(limit).offset(offset)
            
            result = await self.session.execute(query)
            feedback_records = result.scalars().all()
            
            return feedback_records, total_count
        
        except Exception as e:
            logger.error("Failed to get feedback records", error=str(e))
            raise
    
    async def update_feedback(self, feedback_id: str, update_data: Dict) -> Optional[FalsePositiveFeedback]:
        """Update feedback record."""
        try:
            feedback = await self.get_feedback_by_id(feedback_id)
            if not feedback:
                return None
            
            # Update allowed fields
            allowed_fields = {
                "status", "reviewed_by", "review_comments", "reviewed_at",
                "resolution_action", "model_updated"
            }
            
            for field, value in update_data.items():
                if field in allowed_fields and hasattr(feedback, field):
                    setattr(feedback, field, value)
            
            await self.session.commit()
            await self.session.refresh(feedback)
            
            logger.info("Feedback updated", feedback_id=feedback_id)
            return feedback
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to update feedback", error=str(e), feedback_id=feedback_id)
            raise
    
    # Statistics and analytics
    async def get_appeal_statistics(
        self,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """Get appeal statistics for reporting."""
        try:
            conditions = []
            
            if start_date:
                conditions.append(Appeal.submitted_at >= start_date)
            
            if end_date:
                conditions.append(Appeal.submitted_at <= end_date)
            
            # Total appeals
            total_query = select(func.count(Appeal.id))
            if conditions:
                total_query = total_query.where(and_(*conditions))
            
            total_result = await self.session.execute(total_query)
            total_appeals = total_result.scalar()
            
            # Appeals by status
            status_query = select(
                Appeal.status,
                func.count(Appeal.id)
            ).group_by(Appeal.status)
            
            if conditions:
                status_query = status_query.where(and_(*conditions))
            
            status_result = await self.session.execute(status_query)
            status_counts = {status: count for status, count in status_result.all()}
            
            # Appeals by decision
            decision_query = select(
                Appeal.decision,
                func.count(Appeal.id)
            ).where(Appeal.decision.isnot(None)).group_by(Appeal.decision)
            
            if conditions:
                decision_query = decision_query.where(and_(*conditions))
            
            decision_result = await self.session.execute(decision_query)
            decision_counts = {decision: count for decision, count in decision_result.all()}
            
            # Overdue appeals
            overdue_query = select(func.count(Appeal.id)).where(
                and_(
                    Appeal.sla_deadline < datetime.utcnow(),
                    Appeal.status.in_(["submitted", "under_review"])
                )
            )
            
            if conditions:
                overdue_query = overdue_query.where(and_(*conditions))
            
            overdue_result = await self.session.execute(overdue_query)
            overdue_count = overdue_result.scalar()
            
            # Success rate calculation
            approved_appeals = decision_counts.get("overturned", 0) + decision_counts.get("partial", 0)
            total_decided = sum(decision_counts.values())
            success_rate = (approved_appeals / total_decided * 100) if total_decided > 0 else 0
            
            return {
                "total_appeals": total_appeals,
                "appeals_by_status": status_counts,
                "appeals_by_decision": decision_counts,
                "overdue_appeals": overdue_count,
                "appeal_success_rate": success_rate,
                "total_decided_appeals": total_decided,
                "approved_appeals": approved_appeals
            }
        
        except Exception as e:
            logger.error("Failed to get appeal statistics", error=str(e))
            raise
    
    async def cleanup_old_appeals(self, retention_days: int = 365) -> int:
        """Clean up old appeal records based on retention policy."""
        try:
            cutoff_date = datetime.utcnow() - timedelta(days=retention_days)
            
            # Get old completed appeals
            result = await self.session.execute(
                select(Appeal).where(
                    and_(
                        Appeal.submitted_at < cutoff_date,
                        Appeal.status.in_(["approved", "denied", "expired"])
                    )
                )
            )
            old_appeals = result.scalars().all()
            
            # Delete old appeals
            for appeal in old_appeals:
                await self.session.delete(appeal)
            
            await self.session.commit()
            
            logger.info("Old appeals cleaned up", 
                       deleted_count=len(old_appeals), 
                       cutoff_date=cutoff_date)
            return len(old_appeals)
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to cleanup old appeals", error=str(e))
            raise