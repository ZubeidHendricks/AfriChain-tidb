"""
Enforcement Service for determining and executing enforcement actions.

This service contains the business logic for evaluating enforcement actions
based on authenticity scores, supplier reputation, and enforcement rules.
"""

import asyncio
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from decimal import Decimal

import structlog

from ..core.database import get_db_session
from ..db.repositories.enforcement_repository import EnforcementRepository
from ..models.enums import EnforcementAction, ProductStatus
from ..models.enforcement import EnforcementRule, SupplierReputation

logger = structlog.get_logger(__name__)


class EnforcementService:
    """Service for enforcement business logic."""
    
    # Default enforcement thresholds by category
    DEFAULT_THRESHOLDS = {
        "luxury_goods": {
            EnforcementAction.TAKEDOWN: (0, 20),
            EnforcementAction.PAUSE: (20, 40),
            EnforcementAction.VISIBILITY_REDUCE: (40, 65),
            EnforcementAction.WARNING: (65, 85),
            EnforcementAction.NONE: (85, 100)
        },
        "electronics": {
            EnforcementAction.TAKEDOWN: (0, 25),
            EnforcementAction.PAUSE: (25, 45),
            EnforcementAction.VISIBILITY_REDUCE: (45, 70),
            EnforcementAction.WARNING: (70, 85),
            EnforcementAction.NONE: (85, 100)
        },
        "fashion": {
            EnforcementAction.TAKEDOWN: (0, 15),
            EnforcementAction.PAUSE: (15, 35),
            EnforcementAction.VISIBILITY_REDUCE: (35, 60),
            EnforcementAction.WARNING: (60, 80),
            EnforcementAction.NONE: (80, 100)
        },
        "default": {
            EnforcementAction.TAKEDOWN: (0, 20),
            EnforcementAction.PAUSE: (20, 40),
            EnforcementAction.VISIBILITY_REDUCE: (40, 65),
            EnforcementAction.WARNING: (65, 85),
            EnforcementAction.NONE: (85, 100)
        }
    }
    
    def __init__(self):
        """Initialize enforcement service."""
        self.enforcement_repository: Optional[EnforcementRepository] = None
        self._rules_cache: Dict[str, List[EnforcementRule]] = {}
        self._cache_timestamp: Optional[datetime] = None
        self._cache_ttl_seconds = 300  # 5 minutes
    
    async def determine_enforcement_action(
        self,
        authenticity_score: int,
        confidence_score: float,
        category: Optional[str] = None,
        supplier_id: Optional[str] = None,
        product_id: Optional[str] = None
    ) -> EnforcementAction:
        """
        Determine the appropriate enforcement action based on analysis results.
        
        Args:
            authenticity_score: Product authenticity score (0-100)
            confidence_score: Analysis confidence (0.0-1.0)  
            category: Product category for category-specific rules
            supplier_id: Supplier ID for reputation-based adjustments
            product_id: Product ID for history-based decisions
            
        Returns:
            Recommended EnforcementAction
        """
        try:
            # Get applicable enforcement rules
            rules = await self._get_applicable_rules(category)
            
            # Find matching rule
            matching_rule = await self._find_matching_rule(
                rules, authenticity_score, confidence_score, category
            )
            
            if matching_rule:
                action = EnforcementAction(matching_rule.action_type)
                logger.info(
                    "Enforcement action determined by rule",
                    rule_id=matching_rule.id,
                    rule_name=matching_rule.rule_name,
                    action=action.value,
                    authenticity_score=authenticity_score,
                    confidence_score=confidence_score
                )
            else:
                # Fall back to default thresholds
                action = await self._determine_action_by_thresholds(
                    authenticity_score, category
                )
                logger.info(
                    "Enforcement action determined by default thresholds",
                    action=action.value,
                    authenticity_score=authenticity_score,
                    category=category
                )
            
            # Adjust action based on supplier reputation
            if supplier_id:
                action = await self._adjust_action_for_supplier(
                    action, supplier_id, authenticity_score
                )
            
            # Apply confidence-based adjustments
            action = await self._adjust_action_for_confidence(action, confidence_score)
            
            return action
        
        except Exception as e:
            logger.error(
                "Failed to determine enforcement action",
                error=str(e),
                authenticity_score=authenticity_score,
                confidence_score=confidence_score
            )
            # Default to warning on errors
            return EnforcementAction.WARNING
    
    async def requires_human_approval(
        self,
        action: EnforcementAction,
        authenticity_score: int,
        confidence_score: float,
        category: Optional[str] = None
    ) -> bool:
        """
        Determine if an enforcement action requires human approval.
        
        Args:
            action: Proposed enforcement action
            authenticity_score: Product authenticity score
            confidence_score: Analysis confidence
            category: Product category
            
        Returns:
            True if human approval is required
        """
        try:
            # High-impact actions always require approval if confidence is low
            high_impact_actions = {EnforcementAction.TAKEDOWN}
            if action in high_impact_actions and confidence_score < 0.9:
                return True
            
            # Check for rule-based approval requirements
            rules = await self._get_applicable_rules(category)
            matching_rule = await self._find_matching_rule(
                rules, authenticity_score, confidence_score, category
            )
            
            if matching_rule and matching_rule.requires_human_approval:
                return True
            
            # Edge case: scores near threshold boundaries
            if await self._is_near_threshold_boundary(authenticity_score, category):
                return True
            
            return False
        
        except Exception as e:
            logger.error("Failed to check approval requirement", error=str(e))
            # Default to requiring approval on errors
            return True
    
    async def get_enforcement_statistics(
        self,
        days_back: int = 30,
        category: Optional[str] = None,
        action_type: Optional[EnforcementAction] = None
    ) -> Dict:
        """
        Get enforcement action statistics.
        
        Args:
            days_back: Number of days to analyze
            category: Optional category filter
            action_type: Optional action type filter
            
        Returns:
            Dictionary containing enforcement statistics
        """
        try:
            async with get_db_session() as session:
                if not self.enforcement_repository:
                    self.enforcement_repository = EnforcementRepository(session)
                
                stats = await self.enforcement_repository.get_enforcement_statistics(
                    days_back=days_back,
                    category=category,
                    action_type=action_type.value if action_type else None
                )
                
                return stats
        
        except Exception as e:
            logger.error("Failed to get enforcement statistics", error=str(e))
            return {}
    
    async def update_supplier_reputation(
        self,
        supplier_id: str,
        action_taken: EnforcementAction,
        was_justified: bool
    ) -> None:
        """
        Update supplier reputation based on enforcement action results.
        
        Args:
            supplier_id: Supplier identifier
            action_taken: Enforcement action that was taken
            was_justified: Whether the action was justified (appeal outcome)
        """
        try:
            async with get_db_session() as session:
                if not self.enforcement_repository:
                    self.enforcement_repository = EnforcementRepository(session)
                
                reputation = await self.enforcement_repository.get_supplier_reputation(supplier_id)
                
                if not reputation:
                    # Create new reputation record
                    reputation_data = {
                        "supplier_id": supplier_id,
                        "total_products": 1,
                        "flagged_products": 1 if action_taken != EnforcementAction.NONE else 0,
                        "takedown_count": 1 if action_taken == EnforcementAction.TAKEDOWN else 0,
                        "reputation_score": 0.8 if was_justified else 0.6,
                        "last_violation_date": datetime.utcnow() if action_taken != EnforcementAction.NONE else None
                    }
                    await self.enforcement_repository.create_supplier_reputation(reputation_data)
                else:
                    # Update existing reputation
                    updates = {}
                    
                    if action_taken != EnforcementAction.NONE:
                        updates["flagged_products"] = reputation.flagged_products + 1
                        updates["last_violation_date"] = datetime.utcnow()
                    
                    if action_taken == EnforcementAction.TAKEDOWN:
                        updates["takedown_count"] = reputation.takedown_count + 1
                    
                    # Adjust reputation score
                    if was_justified:
                        # Justified action - small reputation decrease
                        new_score = max(0.0, reputation.reputation_score - 0.05)
                    else:
                        # Unjustified action - increase reputation (false positive)
                        new_score = min(1.0, reputation.reputation_score + 0.1)
                    
                    updates["reputation_score"] = new_score
                    
                    await self.enforcement_repository.update_supplier_reputation(
                        supplier_id, updates
                    )
                
                logger.info(
                    "Supplier reputation updated",
                    supplier_id=supplier_id,
                    action=action_taken.value,
                    justified=was_justified
                )
        
        except Exception as e:
            logger.error("Failed to update supplier reputation", error=str(e), supplier_id=supplier_id)
    
    async def _get_applicable_rules(self, category: Optional[str] = None) -> List[EnforcementRule]:
        """Get applicable enforcement rules, with caching."""
        try:
            # Check cache
            cache_key = category or "default"
            now = datetime.utcnow()
            
            if (self._cache_timestamp and 
                (now - self._cache_timestamp).total_seconds() < self._cache_ttl_seconds and
                cache_key in self._rules_cache):
                return self._rules_cache[cache_key]
            
            # Fetch from database
            async with get_db_session() as session:
                if not self.enforcement_repository:
                    self.enforcement_repository = EnforcementRepository(session)
                
                rules = await self.enforcement_repository.get_enforcement_rules(
                    category=category,
                    active_only=True
                )
                
                # Update cache
                self._rules_cache[cache_key] = rules
                self._cache_timestamp = now
                
                return rules
        
        except Exception as e:
            logger.error("Failed to get enforcement rules", error=str(e))
            return []
    
    async def _find_matching_rule(
        self,
        rules: List[EnforcementRule],
        authenticity_score: int,
        confidence_score: float,
        category: Optional[str] = None
    ) -> Optional[EnforcementRule]:
        """Find the highest priority rule that matches the criteria."""
        try:
            matching_rules = []
            
            for rule in rules:
                # Check score range
                if not (rule.score_min <= authenticity_score <= rule.score_max):
                    continue
                
                # Check category match (if rule specifies category)
                if rule.category and rule.category != category:
                    continue
                
                matching_rules.append(rule)
            
            if not matching_rules:
                return None
            
            # Return highest priority rule (lowest priority number)
            return min(matching_rules, key=lambda r: r.priority)
        
        except Exception as e:
            logger.error("Failed to find matching rule", error=str(e))
            return None
    
    async def _determine_action_by_thresholds(
        self,
        authenticity_score: int,
        category: Optional[str] = None
    ) -> EnforcementAction:
        """Determine action using default thresholds."""
        try:
            thresholds = self.DEFAULT_THRESHOLDS.get(category, self.DEFAULT_THRESHOLDS["default"])
            
            for action, (min_score, max_score) in thresholds.items():
                if min_score <= authenticity_score < max_score:
                    return action
            
            # Default fallback
            return EnforcementAction.NONE
        
        except Exception as e:
            logger.error("Failed to determine action by thresholds", error=str(e))
            return EnforcementAction.WARNING
    
    async def _adjust_action_for_supplier(
        self,
        action: EnforcementAction,
        supplier_id: str,
        authenticity_score: int
    ) -> EnforcementAction:
        """Adjust enforcement action based on supplier reputation."""
        try:
            async with get_db_session() as session:
                if not self.enforcement_repository:
                    self.enforcement_repository = EnforcementRepository(session)
                
                reputation = await self.enforcement_repository.get_supplier_reputation(supplier_id)
                
                if not reputation:
                    # No reputation data - use default action
                    return action
                
                reputation_score = float(reputation.reputation_score)
                
                # High reputation suppliers get more lenient treatment
                if reputation_score >= 0.8:
                    if action == EnforcementAction.TAKEDOWN and authenticity_score > 15:
                        action = EnforcementAction.PAUSE
                    elif action == EnforcementAction.PAUSE and authenticity_score > 35:
                        action = EnforcementAction.VISIBILITY_REDUCE
                
                # Low reputation suppliers get stricter treatment
                elif reputation_score <= 0.3:
                    if action == EnforcementAction.WARNING and authenticity_score < 75:
                        action = EnforcementAction.VISIBILITY_REDUCE
                    elif action == EnforcementAction.VISIBILITY_REDUCE and authenticity_score < 55:
                        action = EnforcementAction.PAUSE
                
                logger.debug(
                    "Action adjusted for supplier reputation",
                    supplier_id=supplier_id,
                    reputation_score=reputation_score,
                    original_action=action.value,
                    adjusted_action=action.value
                )
                
                return action
        
        except Exception as e:
            logger.error("Failed to adjust action for supplier", error=str(e))
            return action
    
    async def _adjust_action_for_confidence(
        self,
        action: EnforcementAction,
        confidence_score: float
    ) -> EnforcementAction:
        """Adjust enforcement action based on analysis confidence."""
        try:
            # High-impact actions require high confidence
            if action == EnforcementAction.TAKEDOWN and confidence_score < 0.85:
                action = EnforcementAction.PAUSE
            elif action == EnforcementAction.PAUSE and confidence_score < 0.7:
                action = EnforcementAction.VISIBILITY_REDUCE
            elif action == EnforcementAction.VISIBILITY_REDUCE and confidence_score < 0.6:
                action = EnforcementAction.WARNING
            
            return action
        
        except Exception as e:
            logger.error("Failed to adjust action for confidence", error=str(e))
            return action
    
    async def _is_near_threshold_boundary(
        self,
        authenticity_score: int,
        category: Optional[str] = None,
        boundary_margin: int = 5
    ) -> bool:
        """Check if score is near action threshold boundaries."""
        try:
            thresholds = self.DEFAULT_THRESHOLDS.get(category, self.DEFAULT_THRESHOLDS["default"])
            
            for action, (min_score, max_score) in thresholds.items():
                # Check if score is within margin of boundary
                if (abs(authenticity_score - min_score) <= boundary_margin or
                    abs(authenticity_score - max_score) <= boundary_margin):
                    return True
            
            return False
        
        except Exception as e:
            logger.error("Failed to check threshold boundary", error=str(e))
            return False