"""
Repository for managing detection rules in the database.

This repository handles CRUD operations for detection rules and provides
methods for retrieving rules based on various criteria.
"""

import json
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from uuid import uuid4

from sqlalchemy import and_, desc, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

import structlog

from ..models.database import DetectionRule, Product
from ..models.enums import RuleType, RuleAction, ProductCategory

logger = structlog.get_logger(__name__)


class RuleRepository:
    """Repository for detection rule data access."""
    
    def __init__(self, session: AsyncSession):
        self.session = session
    
    async def create_rule(self, rule_data: Dict) -> DetectionRule:
        """
        Create a new detection rule.
        
        Args:
            rule_data: Dictionary containing rule information
            
        Returns:
            Created DetectionRule instance
        """
        try:
            rule = DetectionRule(
                id=rule_data.get("id", str(uuid4())),
                name=rule_data["name"],
                rule_type=RuleType(rule_data["rule_type"]),
                config=rule_data["config"],
                priority=rule_data.get("priority", 100),
                active=rule_data.get("active", True),
                category=rule_data.get("category")
            )
            
            self.session.add(rule)
            await self.session.commit()
            await self.session.refresh(rule)
            
            logger.info("Rule created", rule_id=rule.id, rule_name=rule.name)
            return rule
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to create rule", error=str(e))
            raise
    
    async def get_rule_by_id(self, rule_id: str) -> Optional[DetectionRule]:
        """
        Get a detection rule by ID.
        
        Args:
            rule_id: Rule identifier
            
        Returns:
            DetectionRule instance or None if not found
        """
        try:
            result = await self.session.execute(
                select(DetectionRule).where(DetectionRule.id == rule_id)
            )
            return result.scalar_one_or_none()
        
        except Exception as e:
            logger.error("Failed to get rule by ID", error=str(e), rule_id=rule_id)
            raise
    
    async def get_active_rules(
        self, 
        rule_type: Optional[RuleType] = None,
        category: Optional[str] = None
    ) -> List[DetectionRule]:
        """
        Get all active detection rules, optionally filtered by type and category.
        
        Args:
            rule_type: Optional rule type filter
            category: Optional category filter
            
        Returns:
            List of active DetectionRule instances
        """
        try:
            query = select(DetectionRule).where(DetectionRule.active == True)
            
            if rule_type:
                query = query.where(DetectionRule.rule_type == rule_type)
            
            if category:
                query = query.where(
                    or_(
                        DetectionRule.category == category,
                        DetectionRule.category.is_(None)  # Include general rules
                    )
                )
            
            # Order by priority (highest first)
            query = query.order_by(desc(DetectionRule.priority))
            
            result = await self.session.execute(query)
            return result.scalars().all()
        
        except Exception as e:
            logger.error("Failed to get active rules", error=str(e))
            raise
    
    async def update_rule(self, rule_id: str, update_data: Dict) -> Optional[DetectionRule]:
        """
        Update an existing detection rule.
        
        Args:
            rule_id: Rule identifier
            update_data: Dictionary containing fields to update
            
        Returns:
            Updated DetectionRule instance or None if not found
        """
        try:
            rule = await self.get_rule_by_id(rule_id)
            if not rule:
                return None
            
            # Update allowed fields
            allowed_fields = {"name", "config", "priority", "active", "category"}
            for field, value in update_data.items():
                if field in allowed_fields and hasattr(rule, field):
                    setattr(rule, field, value)
            
            # Update timestamp
            rule.updated_at = datetime.utcnow()
            
            await self.session.commit()
            await self.session.refresh(rule)
            
            logger.info("Rule updated", rule_id=rule.id, updated_fields=list(update_data.keys()))
            return rule
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to update rule", error=str(e), rule_id=rule_id)
            raise
    
    async def delete_rule(self, rule_id: str) -> bool:
        """
        Delete a detection rule.
        
        Args:
            rule_id: Rule identifier
            
        Returns:
            True if rule was deleted, False if not found
        """
        try:
            rule = await self.get_rule_by_id(rule_id)
            if not rule:
                return False
            
            await self.session.delete(rule)
            await self.session.commit()
            
            logger.info("Rule deleted", rule_id=rule_id)
            return True
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to delete rule", error=str(e), rule_id=rule_id)
            raise
    
    async def search_rules(
        self,
        rule_type: Optional[RuleType] = None,
        category: Optional[str] = None,
        active: Optional[bool] = None,
        priority_min: Optional[int] = None,
        priority_max: Optional[int] = None,
        limit: int = 100,
        offset: int = 0
    ) -> Tuple[List[DetectionRule], int]:
        """
        Search detection rules with various filters.
        
        Args:
            rule_type: Optional rule type filter
            category: Optional category filter
            active: Optional active status filter
            priority_min: Minimum priority filter
            priority_max: Maximum priority filter
            limit: Maximum number of results
            offset: Number of results to skip
            
        Returns:
            Tuple of (rules list, total count)
        """
        try:
            # Build query
            conditions = []
            
            if rule_type:
                conditions.append(DetectionRule.rule_type == rule_type)
            
            if category:
                conditions.append(DetectionRule.category == category)
            
            if active is not None:
                conditions.append(DetectionRule.active == active)
            
            if priority_min is not None:
                conditions.append(DetectionRule.priority >= priority_min)
            
            if priority_max is not None:
                conditions.append(DetectionRule.priority <= priority_max)
            
            base_query = select(DetectionRule)
            if conditions:
                base_query = base_query.where(and_(*conditions))
            
            # Get total count
            count_query = select(func.count(DetectionRule.id))
            if conditions:
                count_query = count_query.where(and_(*conditions))
            
            count_result = await self.session.execute(count_query)
            total_count = count_result.scalar()
            
            # Get paginated results
            query = base_query.order_by(
                desc(DetectionRule.priority),
                DetectionRule.created_at
            ).limit(limit).offset(offset)
            
            result = await self.session.execute(query)
            rules = result.scalars().all()
            
            return rules, total_count
        
        except Exception as e:
            logger.error("Failed to search rules", error=str(e))
            raise
    
    async def get_rules_by_type(self, rule_type: RuleType) -> List[DetectionRule]:
        """
        Get all rules of a specific type.
        
        Args:
            rule_type: Type of rules to retrieve
            
        Returns:
            List of DetectionRule instances
        """
        try:
            result = await self.session.execute(
                select(DetectionRule)
                .where(DetectionRule.rule_type == rule_type)
                .order_by(desc(DetectionRule.priority))
            )
            return result.scalars().all()
        
        except Exception as e:
            logger.error("Failed to get rules by type", error=str(e), rule_type=rule_type)
            raise
    
    async def get_rules_by_category(self, category: str) -> List[DetectionRule]:
        """
        Get all rules for a specific category.
        
        Args:
            category: Product category
            
        Returns:
            List of DetectionRule instances
        """
        try:
            result = await self.session.execute(
                select(DetectionRule)
                .where(
                    and_(
                        DetectionRule.active == True,
                        or_(
                            DetectionRule.category == category,
                            DetectionRule.category.is_(None)  # Include general rules
                        )
                    )
                )
                .order_by(desc(DetectionRule.priority))
            )
            return result.scalars().all()
        
        except Exception as e:
            logger.error("Failed to get rules by category", error=str(e), category=category)
            raise
    
    async def get_rule_statistics(self) -> Dict:
        """
        Get statistics about detection rules.
        
        Returns:
            Dictionary containing rule statistics
        """
        try:
            # Total rules count
            total_result = await self.session.execute(
                select(func.count(DetectionRule.id))
            )
            total_rules = total_result.scalar()
            
            # Active rules count
            active_result = await self.session.execute(
                select(func.count(DetectionRule.id))
                .where(DetectionRule.active == True)
            )
            active_rules = active_result.scalar()
            
            # Rules by type
            type_result = await self.session.execute(
                select(DetectionRule.rule_type, func.count(DetectionRule.id))
                .group_by(DetectionRule.rule_type)
            )
            rules_by_type = {rule_type.value: count for rule_type, count in type_result.all()}
            
            # Rules by category
            category_result = await self.session.execute(
                select(DetectionRule.category, func.count(DetectionRule.id))
                .group_by(DetectionRule.category)
            )
            rules_by_category = {
                category or "general": count 
                for category, count in category_result.all()
            }
            
            # Priority distribution
            priority_result = await self.session.execute(
                select(
                    func.min(DetectionRule.priority),
                    func.max(DetectionRule.priority),
                    func.avg(DetectionRule.priority)
                )
                .where(DetectionRule.active == True)
            )
            min_priority, max_priority, avg_priority = priority_result.first()
            
            return {
                "total_rules": total_rules,
                "active_rules": active_rules,
                "inactive_rules": total_rules - active_rules,
                "rules_by_type": rules_by_type,
                "rules_by_category": rules_by_category,
                "priority_stats": {
                    "min": min_priority or 0,
                    "max": max_priority or 0,
                    "average": float(avg_priority) if avg_priority else 0.0
                }
            }
        
        except Exception as e:
            logger.error("Failed to get rule statistics", error=str(e))
            raise
    
    async def validate_rule_config(self, rule_type: RuleType, config: Dict) -> Tuple[bool, List[str]]:
        """
        Validate rule configuration based on rule type.
        
        Args:
            rule_type: Type of rule to validate
            config: Configuration dictionary
            
        Returns:
            Tuple of (is_valid, error_messages)
        """
        errors = []
        
        try:
            if rule_type == RuleType.THRESHOLD:
                if "score_threshold" not in config:
                    errors.append("score_threshold is required for threshold rules")
                elif not isinstance(config["score_threshold"], (int, float)):
                    errors.append("score_threshold must be a number")
                elif not 0 <= config["score_threshold"] <= 100:
                    errors.append("score_threshold must be between 0 and 100")
                
                if "action" in config:
                    try:
                        RuleAction(config["action"])
                    except ValueError:
                        errors.append(f"Invalid action: {config['action']}")
            
            elif rule_type == RuleType.KEYWORD:
                if "patterns" not in config:
                    errors.append("patterns array is required for keyword rules")
                elif not isinstance(config["patterns"], list):
                    errors.append("patterns must be an array")
                elif not config["patterns"]:
                    errors.append("patterns array cannot be empty")
                
                if "match_type" in config and config["match_type"] not in ["any", "all"]:
                    errors.append("match_type must be 'any' or 'all'")
            
            elif rule_type == RuleType.SUPPLIER:
                has_blacklist = "blacklist" in config and config["blacklist"]
                has_whitelist = "whitelist" in config and config["whitelist"]
                has_reputation = "reputation_threshold" in config
                
                if not any([has_blacklist, has_whitelist, has_reputation]):
                    errors.append("Supplier rules must have blacklist, whitelist, or reputation_threshold")
                
                if has_reputation:
                    threshold = config["reputation_threshold"]
                    if not isinstance(threshold, (int, float)):
                        errors.append("reputation_threshold must be a number")
                    elif not 0 <= threshold <= 1:
                        errors.append("reputation_threshold must be between 0 and 1")
            
            elif rule_type == RuleType.PRICE_ANOMALY:
                if "deviation_threshold" in config:
                    threshold = config["deviation_threshold"]
                    if not isinstance(threshold, (int, float)):
                        errors.append("deviation_threshold must be a number")
                    elif threshold <= 0:
                        errors.append("deviation_threshold must be positive")
                
                if "min_price_ratio" in config:
                    ratio = config["min_price_ratio"]
                    if not isinstance(ratio, (int, float)):
                        errors.append("min_price_ratio must be a number")
                    elif not 0 < ratio <= 1:
                        errors.append("min_price_ratio must be between 0 and 1")
            
            elif rule_type == RuleType.BRAND_VERIFICATION:
                if "verified_brands" not in config:
                    errors.append("verified_brands array is required for brand verification rules")
                elif not isinstance(config["verified_brands"], list):
                    errors.append("verified_brands must be an array")
            
            return len(errors) == 0, errors
        
        except Exception as e:
            logger.error("Rule config validation failed", error=str(e))
            return False, [f"Validation error: {str(e)}"]
    
    async def bulk_create_rules(self, rules_data: List[Dict]) -> List[DetectionRule]:
        """
        Create multiple detection rules in a single transaction.
        
        Args:
            rules_data: List of rule data dictionaries
            
        Returns:
            List of created DetectionRule instances
        """
        try:
            created_rules = []
            
            for rule_data in rules_data:
                rule = DetectionRule(
                    id=rule_data.get("id", str(uuid4())),
                    name=rule_data["name"],
                    rule_type=RuleType(rule_data["rule_type"]),
                    config=rule_data["config"],
                    priority=rule_data.get("priority", 100),
                    active=rule_data.get("active", True),
                    category=rule_data.get("category")
                )
                
                self.session.add(rule)
                created_rules.append(rule)
            
            await self.session.commit()
            
            # Refresh all rules to get database-generated fields
            for rule in created_rules:
                await self.session.refresh(rule)
            
            logger.info("Bulk rule creation completed", count=len(created_rules))
            return created_rules
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to bulk create rules", error=str(e))
            raise
    
    async def toggle_rule_status(self, rule_id: str) -> Optional[DetectionRule]:
        """
        Toggle the active status of a detection rule.
        
        Args:
            rule_id: Rule identifier
            
        Returns:
            Updated DetectionRule instance or None if not found
        """
        try:
            rule = await self.get_rule_by_id(rule_id)
            if not rule:
                return None
            
            rule.active = not rule.active
            rule.updated_at = datetime.utcnow()
            
            await self.session.commit()
            await self.session.refresh(rule)
            
            logger.info("Rule status toggled", rule_id=rule_id, active=rule.active)
            return rule
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to toggle rule status", error=str(e), rule_id=rule_id)
            raise