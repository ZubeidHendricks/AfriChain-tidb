"""
Rule Service for advanced rule combination and precedence logic.

This service implements sophisticated rule combination strategies,
conflict resolution, and cascading rule effects for the detection system.
"""

import asyncio
import json
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Tuple
from uuid import uuid4

import structlog
from pydantic import BaseModel, Field

from ..agents.rule_engine import RuleMatch, RuleEvaluationResult
from ..core.database import get_db_session
from ..db.repositories.rule_repository import RuleRepository
from ..models.enums import RuleType, RuleAction, ProductCategory
from ..models.database import DetectionRule

logger = structlog.get_logger(__name__)


class CombinationOperator(str, Enum):
    """Operators for combining rule conditions."""
    AND = "AND"
    OR = "OR"
    NOT = "NOT"
    XOR = "XOR"


class RulePrecedence(str, Enum):
    """Rule precedence levels for conflict resolution."""
    CRITICAL = "critical"      # Priority 900-1000
    HIGH = "high"             # Priority 700-899
    MEDIUM = "medium"         # Priority 400-699
    LOW = "low"               # Priority 100-399
    MINIMAL = "minimal"       # Priority 1-99


class ConflictResolutionStrategy(str, Enum):
    """Strategies for resolving rule conflicts."""
    HIGHEST_PRIORITY = "highest_priority"      # Use highest priority rule
    MOST_RESTRICTIVE = "most_restrictive"     # Use most restrictive action
    WEIGHTED_AVERAGE = "weighted_average"     # Weight by priority and confidence
    CONSENSUS = "consensus"                   # Require majority agreement
    FIRST_MATCH = "first_match"              # Use first matching rule


class RuleCombination(BaseModel):
    """Configuration for combining multiple rules."""
    combination_id: str = Field(default_factory=lambda: str(uuid4()))
    name: str = Field(..., description="Name of the rule combination")
    rule_ids: List[str] = Field(..., min_items=2, description="Rules to combine")
    operator: CombinationOperator = Field(..., description="Combination operator")
    priority_override: Optional[int] = Field(None, description="Override priority for combination")
    action_override: Optional[RuleAction] = Field(None, description="Override action for combination")
    active: bool = Field(default=True, description="Whether combination is active")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class RuleChain(BaseModel):
    """Configuration for rule chaining and cascading effects."""
    chain_id: str = Field(default_factory=lambda: str(uuid4()))
    name: str = Field(..., description="Name of the rule chain")
    trigger_rule_id: str = Field(..., description="Rule that triggers the chain")
    cascading_rules: List[Dict[str, Any]] = Field(..., description="Rules triggered in sequence")
    stop_on_first_match: bool = Field(default=False, description="Stop chain on first match")
    active: bool = Field(default=True, description="Whether chain is active")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ConflictResolution(BaseModel):
    """Result of conflict resolution between rules."""
    resolution_id: str = Field(default_factory=lambda: str(uuid4()))
    conflicting_rules: List[str] = Field(..., description="IDs of conflicting rules")
    strategy_used: ConflictResolutionStrategy = Field(..., description="Resolution strategy applied")
    winning_rule_id: str = Field(..., description="Rule selected as winner")
    resolution_reasoning: str = Field(..., description="Explanation of resolution")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Confidence in resolution")


class AdvancedRuleEvaluationResult(BaseModel):
    """Enhanced rule evaluation result with combination and precedence logic."""
    base_evaluation: RuleEvaluationResult = Field(..., description="Base evaluation result")
    applied_combinations: List[RuleCombination] = Field(default_factory=list)
    triggered_chains: List[RuleChain] = Field(default_factory=list)
    resolved_conflicts: List[ConflictResolution] = Field(default_factory=list)
    final_action: RuleAction = Field(..., description="Final action after combination logic")
    final_risk_score: float = Field(..., ge=0.0, le=100.0, description="Final risk score")
    processing_duration_ms: float = Field(..., description="Processing time")


class RuleService:
    """
    Service for advanced rule combination, precedence, and conflict resolution.
    
    This service extends the basic rule engine with sophisticated logic for:
    - Combining multiple rules with logical operators
    - Resolving conflicts between contradictory rules  
    - Implementing rule chains and cascading effects
    - Managing rule precedence and specificity
    """
    
    def __init__(self):
        self.rule_combinations: Dict[str, RuleCombination] = {}
        self.rule_chains: Dict[str, RuleChain] = {}
        self.conflict_resolution_strategy = ConflictResolutionStrategy.HIGHEST_PRIORITY
        
        # Cache for rule metadata
        self.rule_metadata_cache: Dict[str, Dict[str, Any]] = {}
        self.cache_timestamp: Optional[datetime] = None
        self.cache_ttl_seconds = 300  # 5 minutes
    
    async def process_advanced_evaluation(
        self, 
        base_result: RuleEvaluationResult,
        conflict_strategy: ConflictResolutionStrategy = ConflictResolutionStrategy.HIGHEST_PRIORITY
    ) -> AdvancedRuleEvaluationResult:
        """
        Process a base rule evaluation with advanced combination and precedence logic.
        
        Args:
            base_result: Basic rule evaluation result
            conflict_strategy: Strategy for resolving rule conflicts
            
        Returns:
            Enhanced evaluation result with combination logic applied
        """
        start_time = datetime.utcnow()
        
        try:
            # Initialize result containers
            applied_combinations = []
            triggered_chains = []
            resolved_conflicts = []
            
            # Step 1: Apply rule combinations
            combination_matches = await self._apply_rule_combinations(base_result.matched_rules)
            applied_combinations.extend(combination_matches)
            
            # Step 2: Process rule chains and cascading effects
            chain_results = await self._process_rule_chains(base_result.matched_rules)
            triggered_chains.extend(chain_results)
            
            # Step 3: Resolve conflicts between rules
            all_matches = base_result.matched_rules.copy()
            if combination_matches:
                # Add combination results as virtual matches
                for combo in combination_matches:
                    # Convert combination to RuleMatch for conflict resolution
                    combo_match = self._combination_to_rule_match(combo, all_matches)
                    if combo_match:
                        all_matches.append(combo_match)
            
            conflicts = await self._resolve_rule_conflicts(all_matches, conflict_strategy)
            resolved_conflicts.extend(conflicts)
            
            # Step 4: Calculate final action and risk score
            final_action, final_risk_score = await self._calculate_final_decision(
                all_matches, resolved_conflicts
            )
            
            # Calculate processing time
            processing_time = (datetime.utcnow() - start_time).total_seconds() * 1000
            
            result = AdvancedRuleEvaluationResult(
                base_evaluation=base_result,
                applied_combinations=applied_combinations,
                triggered_chains=triggered_chains,
                resolved_conflicts=resolved_conflicts,
                final_action=final_action,
                final_risk_score=final_risk_score,
                processing_duration_ms=processing_time
            )
            
            logger.info(
                "Advanced rule evaluation completed",
                product_id=base_result.product_id,
                combinations_applied=len(applied_combinations),
                chains_triggered=len(triggered_chains),
                conflicts_resolved=len(resolved_conflicts),
                final_action=final_action.value,
                final_risk_score=final_risk_score
            )
            
            return result
        
        except Exception as e:
            logger.error("Advanced rule evaluation failed", error=str(e))
            raise
    
    async def _apply_rule_combinations(self, matched_rules: List[RuleMatch]) -> List[RuleCombination]:
        """Apply rule combinations to matched rules."""
        applied_combinations = []
        matched_rule_ids = {match.rule_id for match in matched_rules}
        
        for combination in self.rule_combinations.values():
            if not combination.active:
                continue
            
            # Check if all required rules are matched for this combination
            required_rules = set(combination.rule_ids)
            
            if combination.operator == CombinationOperator.AND:
                # All rules must be matched
                if required_rules.issubset(matched_rule_ids):
                    applied_combinations.append(combination)
            
            elif combination.operator == CombinationOperator.OR:
                # At least one rule must be matched
                if required_rules.intersection(matched_rule_ids):
                    applied_combinations.append(combination)
            
            elif combination.operator == CombinationOperator.XOR:
                # Exactly one rule must be matched
                intersection = required_rules.intersection(matched_rule_ids)
                if len(intersection) == 1:
                    applied_combinations.append(combination)
            
            elif combination.operator == CombinationOperator.NOT:
                # None of the rules should be matched
                if not required_rules.intersection(matched_rule_ids):
                    applied_combinations.append(combination)
        
        logger.debug("Rule combinations applied", count=len(applied_combinations))
        return applied_combinations
    
    async def _process_rule_chains(self, matched_rules: List[RuleMatch]) -> List[RuleChain]:
        """Process rule chains and cascading effects."""
        triggered_chains = []
        matched_rule_ids = {match.rule_id for match in matched_rules}
        
        for chain in self.rule_chains.values():
            if not chain.active:
                continue
            
            # Check if trigger rule is matched
            if chain.trigger_rule_id in matched_rule_ids:
                # Process cascading rules in sequence
                chain_triggered = False
                
                for cascade_rule in chain.cascading_rules:
                    rule_id = cascade_rule.get("rule_id")
                    condition = cascade_rule.get("condition", {})
                    
                    # Evaluate cascade condition
                    if await self._evaluate_cascade_condition(condition, matched_rules):
                        chain_triggered = True
                        
                        if chain.stop_on_first_match:
                            break
                
                if chain_triggered:
                    triggered_chains.append(chain)
        
        logger.debug("Rule chains processed", triggered_count=len(triggered_chains))
        return triggered_chains
    
    async def _resolve_rule_conflicts(
        self, 
        matched_rules: List[RuleMatch], 
        strategy: ConflictResolutionStrategy
    ) -> List[ConflictResolution]:
        """Resolve conflicts between matched rules."""
        conflicts = []
        
        # Group rules by conflicting actions
        action_groups = {}
        for match in matched_rules:
            action = match.action
            if action not in action_groups:
                action_groups[action] = []
            action_groups[action].append(match)
        
        # If we have conflicting actions, resolve them
        if len(action_groups) > 1:
            conflicting_rule_ids = [match.rule_id for match in matched_rules]
            
            if strategy == ConflictResolutionStrategy.HIGHEST_PRIORITY:
                winner = max(matched_rules, key=lambda x: x.priority)
                resolution = ConflictResolution(
                    conflicting_rules=conflicting_rule_ids,
                    strategy_used=strategy,
                    winning_rule_id=winner.rule_id,
                    resolution_reasoning=f"Rule {winner.rule_id} has highest priority ({winner.priority})",
                    confidence=0.9
                )
            
            elif strategy == ConflictResolutionStrategy.MOST_RESTRICTIVE:
                # Define action restrictiveness order
                action_severity = {
                    RuleAction.REMOVE: 5,
                    RuleAction.BLOCK: 4,
                    RuleAction.QUARANTINE: 3,
                    RuleAction.FLAG: 2,
                    RuleAction.MONITOR: 1
                }
                
                most_restrictive = max(matched_rules, key=lambda x: action_severity.get(x.action, 0))
                resolution = ConflictResolution(
                    conflicting_rules=conflicting_rule_ids,
                    strategy_used=strategy,
                    winning_rule_id=most_restrictive.rule_id,
                    resolution_reasoning=f"Rule {most_restrictive.rule_id} has most restrictive action ({most_restrictive.action.value})",
                    confidence=0.85
                )
            
            elif strategy == ConflictResolutionStrategy.WEIGHTED_AVERAGE:
                # Calculate weighted average of priorities and confidence
                total_weight = sum(match.priority * match.confidence for match in matched_rules)
                total_priority = sum(match.priority for match in matched_rules)
                
                if total_priority > 0:
                    weighted_avg = total_weight / total_priority
                    # Select rule closest to weighted average
                    winner = min(matched_rules, key=lambda x: abs((x.priority * x.confidence) - weighted_avg))
                else:
                    winner = matched_rules[0]  # Fallback
                
                resolution = ConflictResolution(
                    conflicting_rules=conflicting_rule_ids,
                    strategy_used=strategy,
                    winning_rule_id=winner.rule_id,
                    resolution_reasoning=f"Rule {winner.rule_id} closest to weighted average decision",
                    confidence=0.75
                )
            
            elif strategy == ConflictResolutionStrategy.CONSENSUS:
                # Require majority agreement (simplified implementation)
                action_counts = {}
                for match in matched_rules:
                    action = match.action
                    action_counts[action] = action_counts.get(action, 0) + 1
                
                majority_action = max(action_counts, key=action_counts.get)
                majority_rules = [m for m in matched_rules if m.action == majority_action]
                
                if len(majority_rules) > len(matched_rules) / 2:
                    winner = max(majority_rules, key=lambda x: x.priority)
                    resolution = ConflictResolution(
                        conflicting_rules=conflicting_rule_ids,
                        strategy_used=strategy,
                        winning_rule_id=winner.rule_id,
                        resolution_reasoning=f"Rule {winner.rule_id} part of majority consensus for {majority_action.value}",
                        confidence=0.8
                    )
                else:
                    # No clear majority, fall back to highest priority
                    winner = max(matched_rules, key=lambda x: x.priority)
                    resolution = ConflictResolution(
                        conflicting_rules=conflicting_rule_ids,
                        strategy_used=strategy,
                        winning_rule_id=winner.rule_id,
                        resolution_reasoning=f"No consensus reached, defaulting to highest priority rule {winner.rule_id}",
                        confidence=0.6
                    )
            
            else:  # FIRST_MATCH
                winner = matched_rules[0]
                resolution = ConflictResolution(
                    conflicting_rules=conflicting_rule_ids,
                    strategy_used=strategy,
                    winning_rule_id=winner.rule_id,
                    resolution_reasoning=f"First matching rule {winner.rule_id} selected",
                    confidence=0.7
                )
            
            conflicts.append(resolution)
        
        logger.debug("Rule conflicts resolved", conflict_count=len(conflicts))
        return conflicts
    
    async def _calculate_final_decision(
        self, 
        all_matches: List[RuleMatch], 
        resolved_conflicts: List[ConflictResolution]
    ) -> Tuple[RuleAction, float]:
        """Calculate final action and risk score after conflict resolution."""
        if not all_matches:
            return RuleAction.MONITOR, 0.0
        
        # If we have resolved conflicts, use the winning rules
        if resolved_conflicts:
            winning_rule_ids = {conflict.winning_rule_id for conflict in resolved_conflicts}
            effective_matches = [match for match in all_matches if match.rule_id in winning_rule_ids]
        else:
            effective_matches = all_matches
        
        if not effective_matches:
            effective_matches = all_matches  # Fallback
        
        # Determine final action (most restrictive among effective matches)
        action_severity = {
            RuleAction.REMOVE: 5,
            RuleAction.BLOCK: 4,
            RuleAction.QUARANTINE: 3,
            RuleAction.FLAG: 2,
            RuleAction.MONITOR: 1
        }
        
        final_action = max(effective_matches, key=lambda x: action_severity.get(x.action, 0)).action
        
        # Calculate enhanced risk score considering combinations and precedence
        base_risk = self._calculate_base_risk_score(effective_matches)
        
        # Apply precedence multipliers
        precedence_multiplier = 1.0
        for match in effective_matches:
            precedence = self._get_rule_precedence(match.priority)
            if precedence == RulePrecedence.CRITICAL:
                precedence_multiplier = max(precedence_multiplier, 1.3)
            elif precedence == RulePrecedence.HIGH:
                precedence_multiplier = max(precedence_multiplier, 1.15)
        
        # Apply combination bonuses
        combination_bonus = min(0.2, len(effective_matches) * 0.05)  # Max 20% bonus
        
        final_risk_score = min(100.0, base_risk * precedence_multiplier + combination_bonus * 100)
        
        return final_action, round(final_risk_score, 2)
    
    def _calculate_base_risk_score(self, matches: List[RuleMatch]) -> float:
        """Calculate base risk score from rule matches."""
        if not matches:
            return 0.0
        
        # Weight scores by priority and confidence
        total_weighted_score = 0.0
        total_weight = 0.0
        
        for match in matches:
            weight = match.priority / 100.0  # Normalize to 0-10
            score = match.confidence * 100.0  # Convert to 0-100 scale
            
            total_weighted_score += score * weight
            total_weight += weight
        
        if total_weight == 0:
            return 0.0
        
        return total_weighted_score / total_weight
    
    def _get_rule_precedence(self, priority: int) -> RulePrecedence:
        """Determine rule precedence level from priority."""
        if priority >= 900:
            return RulePrecedence.CRITICAL
        elif priority >= 700:
            return RulePrecedence.HIGH
        elif priority >= 400:
            return RulePrecedence.MEDIUM
        elif priority >= 100:
            return RulePrecedence.LOW
        else:
            return RulePrecedence.MINIMAL
    
    def _combination_to_rule_match(
        self, 
        combination: RuleCombination, 
        original_matches: List[RuleMatch]
    ) -> Optional[RuleMatch]:
        """Convert a rule combination to a virtual RuleMatch for conflict resolution."""
        # Find the constituent matches
        constituent_matches = [m for m in original_matches if m.rule_id in combination.rule_ids]
        
        if not constituent_matches:
            return None
        
        # Calculate combined confidence and priority
        avg_confidence = sum(m.confidence for m in constituent_matches) / len(constituent_matches)
        max_priority = combination.priority_override or max(m.priority for m in constituent_matches)
        combined_action = combination.action_override or max(
            constituent_matches, 
            key=lambda x: {"REMOVE": 5, "BLOCK": 4, "QUARANTINE": 3, "FLAG": 2, "MONITOR": 1}.get(x.action.value, 0)
        ).action
        
        return RuleMatch(
            rule_id=combination.combination_id,
            rule_name=combination.name,
            rule_type=RuleType.THRESHOLD,  # Virtual type
            priority=max_priority,
            action=combined_action,
            confidence=avg_confidence,
            evidence={
                "combination_type": "virtual",
                "constituent_rules": combination.rule_ids,
                "operator": combination.operator.value
            }
        )
    
    async def _evaluate_cascade_condition(
        self, 
        condition: Dict[str, Any], 
        matched_rules: List[RuleMatch]
    ) -> bool:
        """Evaluate whether a cascade condition is met."""
        # Simplified condition evaluation
        # In a real implementation, this would be more sophisticated
        
        condition_type = condition.get("type", "always")
        
        if condition_type == "always":
            return True
        elif condition_type == "risk_threshold":
            threshold = condition.get("threshold", 50.0)
            avg_confidence = sum(m.confidence for m in matched_rules) / len(matched_rules) if matched_rules else 0
            return avg_confidence * 100 > threshold
        elif condition_type == "rule_count":
            min_count = condition.get("min_count", 1)
            return len(matched_rules) >= min_count
        
        return False
    
    def add_rule_combination(self, combination: RuleCombination) -> None:
        """Add a new rule combination."""
        self.rule_combinations[combination.combination_id] = combination
        logger.info("Rule combination added", combination_id=combination.combination_id)
    
    def remove_rule_combination(self, combination_id: str) -> bool:
        """Remove a rule combination."""
        if combination_id in self.rule_combinations:
            del self.rule_combinations[combination_id]
            logger.info("Rule combination removed", combination_id=combination_id)
            return True
        return False
    
    def add_rule_chain(self, chain: RuleChain) -> None:
        """Add a new rule chain."""
        self.rule_chains[chain.chain_id] = chain
        logger.info("Rule chain added", chain_id=chain.chain_id)
    
    def remove_rule_chain(self, chain_id: str) -> bool:
        """Remove a rule chain."""
        if chain_id in self.rule_chains:
            del self.rule_chains[chain_id]
            logger.info("Rule chain removed", chain_id=chain_id)
            return True
        return False
    
    def get_combination_statistics(self) -> Dict[str, Any]:
        """Get statistics about rule combinations and chains."""
        return {
            "total_combinations": len(self.rule_combinations),
            "active_combinations": sum(1 for c in self.rule_combinations.values() if c.active),
            "total_chains": len(self.rule_chains),
            "active_chains": sum(1 for c in self.rule_chains.values() if c.active),
            "combination_operators": {
                op.value: sum(1 for c in self.rule_combinations.values() if c.operator == op)
                for op in CombinationOperator
            }
        }