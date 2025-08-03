"""
Repository for enforcement-related database operations.

This repository handles CRUD operations for enforcement rules, actions,
supplier reputation, and enforcement statistics.
"""

import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from uuid import uuid4

from sqlalchemy import and_, desc, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

import structlog

from ..models.database import EnforcementRule, EnforcementAction, SupplierReputation
from ..models.enums import EnforcementStatus

logger = structlog.get_logger(__name__)


class EnforcementRepository:
    """Repository for enforcement data access."""
    
    def __init__(self, session: AsyncSession):
        self.session = session
    
    # Enforcement Rules CRUD
    async def create_enforcement_rule(self, rule_data: Dict) -> EnforcementRule:
        """
        Create a new enforcement rule.
        
        Args:
            rule_data: Dictionary containing rule information
            
        Returns:
            Created EnforcementRule instance
        """
        try:
            rule = EnforcementRule(
                id=rule_data.get("id", str(uuid4())),
                rule_name=rule_data["rule_name"],
                score_min=rule_data["score_min"],
                score_max=rule_data["score_max"],
                category=rule_data.get("category"),
                action_type=rule_data["action_type"],
                requires_human_approval=rule_data.get("requires_human_approval", False),
                priority=rule_data.get("priority", 100),
                active=rule_data.get("active", True)
            )
            
            self.session.add(rule)
            await self.session.commit()
            await self.session.refresh(rule)
            
            logger.info("Enforcement rule created", rule_id=rule.id, rule_name=rule.rule_name)
            return rule
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to create enforcement rule", error=str(e))
            raise
    
    async def get_enforcement_rule_by_id(self, rule_id: str) -> Optional[EnforcementRule]:
        """
        Get an enforcement rule by ID.
        
        Args:
            rule_id: Rule identifier
            
        Returns:
            EnforcementRule instance or None if not found
        """
        try:
            result = await self.session.execute(
                select(EnforcementRule).where(EnforcementRule.id == rule_id)
            )
            return result.scalar_one_or_none()
        
        except Exception as e:
            logger.error("Failed to get enforcement rule by ID", error=str(e), rule_id=rule_id)
            raise
    
    async def get_enforcement_rules(
        self,
        category: Optional[str] = None,
        active_only: bool = True,
        limit: int = 100,
        offset: int = 0
    ) -> List[EnforcementRule]:
        """
        Get enforcement rules with filtering.
        
        Args:
            category: Optional category filter
            active_only: Whether to return only active rules
            limit: Maximum number of results
            offset: Number of results to skip
            
        Returns:
            List of EnforcementRule instances
        """
        try:
            query = select(EnforcementRule)
            conditions = []
            
            if category:
                conditions.append(
                    or_(
                        EnforcementRule.category == category,
                        EnforcementRule.category.is_(None)  # Global rules
                    )
                )
            
            if active_only:
                conditions.append(EnforcementRule.active == True)
            
            if conditions:
                query = query.where(and_(*conditions))
            
            query = query.order_by(EnforcementRule.priority, EnforcementRule.created_at)
            query = query.limit(limit).offset(offset)
            
            result = await self.session.execute(query)
            return result.scalars().all()
        
        except Exception as e:
            logger.error("Failed to get enforcement rules", error=str(e))
            raise
    
    async def update_enforcement_rule(self, rule_id: str, update_data: Dict) -> Optional[EnforcementRule]:
        """
        Update an existing enforcement rule.
        
        Args:
            rule_id: Rule identifier
            update_data: Dictionary containing fields to update
            
        Returns:
            Updated EnforcementRule instance or None if not found
        """
        try:
            rule = await self.get_enforcement_rule_by_id(rule_id)
            if not rule:
                return None
            
            # Update allowed fields
            allowed_fields = {
                "rule_name", "score_min", "score_max", "category", "action_type",
                "requires_human_approval", "priority", "active"
            }
            for field, value in update_data.items():
                if field in allowed_fields and hasattr(rule, field):
                    setattr(rule, field, value)
            
            await self.session.commit()
            await self.session.refresh(rule)
            
            logger.info("Enforcement rule updated", rule_id=rule_id, updated_fields=list(update_data.keys()))
            return rule
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to update enforcement rule", error=str(e), rule_id=rule_id)
            raise
    
    async def delete_enforcement_rule(self, rule_id: str) -> bool:
        """
        Delete an enforcement rule.
        
        Args:
            rule_id: Rule identifier
            
        Returns:
            True if rule was deleted, False if not found
        """
        try:
            rule = await self.get_enforcement_rule_by_id(rule_id)
            if not rule:
                return False
            
            await self.session.delete(rule)
            await self.session.commit()
            
            logger.info("Enforcement rule deleted", rule_id=rule_id)
            return True
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to delete enforcement rule", error=str(e), rule_id=rule_id)
            raise
    
    # Enforcement Actions CRUD
    async def create_enforcement_action(self, action_data: Dict) -> EnforcementAction:
        """
        Create a new enforcement action record.
        
        Args:
            action_data: Dictionary containing action information
            
        Returns:
            Created EnforcementAction instance
        """
        try:
            action = EnforcementAction(
                id=action_data.get("id", str(uuid4())),
                product_id=action_data["product_id"],
                rule_id=action_data.get("rule_id"),
                action_type=action_data["action_type"],
                authenticity_score=action_data["authenticity_score"],
                confidence_score=action_data["confidence_score"],
                reasoning=action_data.get("reasoning", ""),
                executed_by=action_data["executed_by"],
                execution_status=action_data.get("execution_status", "pending"),
                platform_response=action_data.get("platform_response"),
                appeal_status=action_data.get("appeal_status", "none"),
                completed_at=action_data.get("completed_at")
            )
            
            self.session.add(action)
            await self.session.commit()
            await self.session.refresh(action)
            
            logger.info("Enforcement action created", action_id=action.id, product_id=action.product_id)
            return action
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to create enforcement action", error=str(e))
            raise
    
    async def get_enforcement_action_by_id(self, action_id: str) -> Optional[EnforcementAction]:
        """
        Get an enforcement action by ID.
        
        Args:
            action_id: Action identifier
            
        Returns:
            EnforcementAction instance or None if not found
        """
        try:
            result = await self.session.execute(
                select(EnforcementAction).where(EnforcementAction.id == action_id)
            )
            return result.scalar_one_or_none()
        
        except Exception as e:
            logger.error("Failed to get enforcement action by ID", error=str(e), action_id=action_id)
            raise
    
    async def get_product_enforcement_actions(
        self,
        product_id: str,
        limit: int = 50
    ) -> List[EnforcementAction]:
        """
        Get enforcement actions for a specific product.
        
        Args:
            product_id: Product identifier
            limit: Maximum number of results
            
        Returns:
            List of EnforcementAction instances
        """
        try:
            result = await self.session.execute(
                select(EnforcementAction)
                .where(EnforcementAction.product_id == product_id)
                .order_by(desc(EnforcementAction.created_at))
                .limit(limit)
            )
            return result.scalars().all()
        
        except Exception as e:
            logger.error("Failed to get product enforcement actions", error=str(e), product_id=product_id)
            raise
    
    async def get_enforcement_actions(
        self,
        execution_status: Optional[str] = None,
        action_type: Optional[str] = None,
        days_back: Optional[int] = None,
        limit: int = 100,
        offset: int = 0
    ) -> Tuple[List[EnforcementAction], int]:
        """
        Get enforcement actions with filtering.
        
        Args:
            execution_status: Optional status filter
            action_type: Optional action type filter
            days_back: Optional number of days to look back
            limit: Maximum number of results
            offset: Number of results to skip
            
        Returns:
            Tuple of (actions list, total count)
        """
        try:
            conditions = []
            
            if execution_status:
                conditions.append(EnforcementAction.execution_status == execution_status)
            
            if action_type:
                conditions.append(EnforcementAction.action_type == action_type)
            
            if days_back:
                cutoff_date = datetime.utcnow() - timedelta(days=days_back)
                conditions.append(EnforcementAction.created_at >= cutoff_date)
            
            # Base query
            base_query = select(EnforcementAction)
            if conditions:
                base_query = base_query.where(and_(*conditions))
            
            # Get total count
            count_query = select(func.count(EnforcementAction.id))
            if conditions:
                count_query = count_query.where(and_(*conditions))
            
            count_result = await self.session.execute(count_query)
            total_count = count_result.scalar()
            
            # Get paginated results
            query = base_query.order_by(
                desc(EnforcementAction.created_at)
            ).limit(limit).offset(offset)
            
            result = await self.session.execute(query)
            actions = result.scalars().all()
            
            return actions, total_count
        
        except Exception as e:
            logger.error("Failed to get enforcement actions", error=str(e))
            raise
    
    async def update_enforcement_action(self, action_id: str, update_data: Dict) -> Optional[EnforcementAction]:
        """
        Update an existing enforcement action.
        
        Args:
            action_id: Action identifier
            update_data: Dictionary containing fields to update
            
        Returns:
            Updated EnforcementAction instance or None if not found
        """
        try:
            action = await self.get_enforcement_action_by_id(action_id)
            if not action:
                return None
            
            # Update allowed fields
            allowed_fields = {
                "execution_status", "platform_response", "appeal_status", 
                "completed_at", "reasoning"
            }
            for field, value in update_data.items():
                if field in allowed_fields and hasattr(action, field):
                    setattr(action, field, value)
            
            await self.session.commit()
            await self.session.refresh(action)
            
            logger.info("Enforcement action updated", action_id=action_id, updated_fields=list(update_data.keys()))
            return action
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to update enforcement action", error=str(e), action_id=action_id)
            raise
    
    # Supplier Reputation CRUD
    async def create_supplier_reputation(self, reputation_data: Dict) -> SupplierReputation:
        """
        Create a new supplier reputation record.
        
        Args:
            reputation_data: Dictionary containing reputation information
            
        Returns:
            Created SupplierReputation instance
        """
        try:
            reputation = SupplierReputation(
                supplier_id=reputation_data["supplier_id"],
                total_products=reputation_data.get("total_products", 0),
                flagged_products=reputation_data.get("flagged_products", 0),
                takedown_count=reputation_data.get("takedown_count", 0),
                appeal_success_rate=reputation_data.get("appeal_success_rate", 1.0),
                reputation_score=reputation_data.get("reputation_score", 1.0),
                last_violation_date=reputation_data.get("last_violation_date")
            )
            
            self.session.add(reputation)
            await self.session.commit()
            await self.session.refresh(reputation)
            
            logger.info("Supplier reputation created", supplier_id=reputation.supplier_id)
            return reputation
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to create supplier reputation", error=str(e))
            raise
    
    async def get_supplier_reputation(self, supplier_id: str) -> Optional[SupplierReputation]:
        """
        Get supplier reputation by ID.
        
        Args:
            supplier_id: Supplier identifier
            
        Returns:
            SupplierReputation instance or None if not found
        """
        try:
            result = await self.session.execute(
                select(SupplierReputation).where(SupplierReputation.supplier_id == supplier_id)
            )
            return result.scalar_one_or_none()
        
        except Exception as e:
            logger.error("Failed to get supplier reputation", error=str(e), supplier_id=supplier_id)
            raise
    
    async def update_supplier_reputation(self, supplier_id: str, update_data: Dict) -> Optional[SupplierReputation]:
        """
        Update supplier reputation.
        
        Args:
            supplier_id: Supplier identifier
            update_data: Dictionary containing fields to update
            
        Returns:
            Updated SupplierReputation instance or None if not found
        """
        try:
            reputation = await self.get_supplier_reputation(supplier_id)
            if not reputation:
                return None
            
            # Update allowed fields
            allowed_fields = {
                "total_products", "flagged_products", "takedown_count",
                "appeal_success_rate", "reputation_score", "last_violation_date"
            }
            for field, value in update_data.items():
                if field in allowed_fields and hasattr(reputation, field):
                    setattr(reputation, field, value)
            
            # Update timestamp
            reputation.updated_at = datetime.utcnow()
            
            await self.session.commit()
            await self.session.refresh(reputation)
            
            logger.info("Supplier reputation updated", supplier_id=supplier_id, updated_fields=list(update_data.keys()))
            return reputation
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to update supplier reputation", error=str(e), supplier_id=supplier_id)
            raise
    
    async def get_suppliers_by_reputation(
        self,
        min_reputation: float = 0.0,
        max_reputation: float = 1.0,
        limit: int = 100
    ) -> List[SupplierReputation]:
        """
        Get suppliers filtered by reputation score.
        
        Args:
            min_reputation: Minimum reputation score
            max_reputation: Maximum reputation score
            limit: Maximum number of results
            
        Returns:
            List of SupplierReputation instances
        """
        try:
            result = await self.session.execute(
                select(SupplierReputation)
                .where(
                    and_(
                        SupplierReputation.reputation_score >= min_reputation,
                        SupplierReputation.reputation_score <= max_reputation
                    )
                )
                .order_by(desc(SupplierReputation.reputation_score))
                .limit(limit)
            )
            return result.scalars().all()
        
        except Exception as e:
            logger.error("Failed to get suppliers by reputation", error=str(e))
            raise
    
    # Statistics and Analytics
    async def get_enforcement_statistics(
        self,
        days_back: int = 30,
        category: Optional[str] = None,
        action_type: Optional[str] = None
    ) -> Dict:
        """
        Get comprehensive enforcement statistics.
        
        Args:
            days_back: Number of days to analyze
            category: Optional category filter
            action_type: Optional action type filter
            
        Returns:
            Dictionary containing enforcement statistics
        """
        try:
            cutoff_date = datetime.utcnow() - timedelta(days=days_back)
            
            # Base conditions
            conditions = [EnforcementAction.created_at >= cutoff_date]
            
            if action_type:
                conditions.append(EnforcementAction.action_type == action_type)
            
            # Total actions
            total_query = select(func.count(EnforcementAction.id)).where(and_(*conditions))
            total_result = await self.session.execute(total_query)
            total_actions = total_result.scalar()
            
            # Actions by status
            status_query = select(
                EnforcementAction.execution_status,
                func.count(EnforcementAction.id)
            ).where(and_(*conditions)).group_by(EnforcementAction.execution_status)
            
            status_result = await self.session.execute(status_query)
            status_counts = {status: count for status, count in status_result.all()}
            
            # Actions by type
            type_query = select(
                EnforcementAction.action_type,
                func.count(EnforcementAction.id)
            ).where(and_(*conditions)).group_by(EnforcementAction.action_type)
            
            type_result = await self.session.execute(type_query)
            type_counts = {action_type: count for action_type, count in type_result.all()}
            
            # Average scores
            score_query = select(
                func.avg(EnforcementAction.authenticity_score),
                func.avg(EnforcementAction.confidence_score)
            ).where(and_(*conditions))
            
            score_result = await self.session.execute(score_query)
            avg_authenticity, avg_confidence = score_result.first()
            
            # Success rate
            successful_actions = status_counts.get("completed", 0)
            success_rate = (successful_actions / total_actions * 100) if total_actions > 0 else 0
            
            return {
                "total_actions": total_actions,
                "successful_actions": successful_actions,
                "failed_actions": status_counts.get("failed", 0),
                "pending_actions": status_counts.get("pending", 0),
                "pending_approval": status_counts.get("pending_approval", 0),
                "success_rate": success_rate,
                "actions_by_type": type_counts,
                "actions_by_status": status_counts,
                "average_authenticity_score": float(avg_authenticity) if avg_authenticity else 0,
                "average_confidence_score": float(avg_confidence) if avg_confidence else 0,
                "analysis_period_days": days_back
            }
        
        except Exception as e:
            logger.error("Failed to get enforcement statistics", error=str(e))
            return {}
    
    async def get_daily_enforcement_trends(self, days_back: int = 30) -> List[Dict]:
        """
        Get daily enforcement action trends.
        
        Args:
            days_back: Number of days to analyze
            
        Returns:
            List of daily statistics
        """
        try:
            cutoff_date = datetime.utcnow() - timedelta(days=days_back)
            
            # Group by date
            date_query = select(
                func.date(EnforcementAction.created_at).label("action_date"),
                func.count(EnforcementAction.id).label("total_actions"),
                func.sum(
                    func.case(
                        (EnforcementAction.execution_status == "completed", 1),
                        else_=0
                    )
                ).label("successful_actions")
            ).where(
                EnforcementAction.created_at >= cutoff_date
            ).group_by(
                func.date(EnforcementAction.created_at)
            ).order_by(
                func.date(EnforcementAction.created_at)
            )
            
            result = await self.session.execute(date_query)
            
            trends = []
            for date, total, successful in result.all():
                trends.append({
                    "date": date.isoformat(),
                    "total_actions": total,
                    "successful_actions": successful,
                    "success_rate": (successful / total * 100) if total > 0 else 0
                })
            
            return trends
        
        except Exception as e:
            logger.error("Failed to get daily enforcement trends", error=str(e))
            return []