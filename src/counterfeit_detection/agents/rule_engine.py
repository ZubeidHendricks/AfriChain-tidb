"""
Rule Engine Agent for threshold-based detection and configurable rules.

This agent implements the rule engine system that works alongside LLM analysis
to provide threshold-based flagging, custom detection patterns, and dynamic
rule management capabilities.
"""

import asyncio
import json
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional, Set, Tuple
from uuid import uuid4

import structlog
from pydantic import BaseModel, Field, validator

from ..agents.base import BaseAgent, AgentCapability, AgentMessage, AgentResponse, AgentStatus
from ..core.database import get_db_session
from ..db.repositories.product_repository import ProductRepository
from ..db.repositories.rule_repository import RuleRepository
from ..models.enums import ProductCategory, RuleType, RuleAction
from ..models.database import DetectionRule

logger = structlog.get_logger(__name__)


class RuleMatch(BaseModel):
    """Represents a rule match result."""
    rule_id: str
    rule_name: str
    rule_type: RuleType
    priority: int
    action: RuleAction
    confidence: float = Field(ge=0.0, le=1.0)
    evidence: Dict[str, Any] = Field(default_factory=dict)
    triggered_at: datetime = Field(default_factory=datetime.utcnow)


class RuleEvaluationResult(BaseModel):
    """Result of rule evaluation for a product."""
    product_id: str
    agent_id: str
    evaluation_id: str = Field(default_factory=lambda: str(uuid4()))
    total_rules_evaluated: int
    matched_rules: List[RuleMatch] = Field(default_factory=list)
    highest_priority_action: Optional[RuleAction] = None
    overall_risk_score: float = Field(ge=0.0, le=100.0, default=0.0)
    evaluation_duration_ms: float
    created_at: datetime = Field(default_factory=datetime.utcnow)
    
    @validator('matched_rules')
    def sort_by_priority(cls, v):
        """Sort matches by priority (highest first)."""
        return sorted(v, key=lambda x: x.priority, reverse=True)


class ThresholdEvaluator:
    """Handles threshold-based rule evaluation."""
    
    @staticmethod
    def evaluate_threshold_rule(
        rule: DetectionRule, 
        product_data: Dict[str, Any], 
        analysis_score: Optional[float] = None
    ) -> Optional[RuleMatch]:
        """
        Evaluate a threshold rule against product data.
        
        Args:
            rule: The threshold rule to evaluate
            product_data: Product information
            analysis_score: LLM authenticity score (0-100)
            
        Returns:
            RuleMatch if rule is triggered, None otherwise
        """
        config = rule.config
        threshold = config.get("score_threshold", 50.0)
        action = RuleAction(config.get("action", "flag"))
        
        # Check if analysis score is available and below threshold
        if analysis_score is not None and analysis_score < threshold:
            confidence = min(1.0, (threshold - analysis_score) / threshold)
            
            return RuleMatch(
                rule_id=rule.id,
                rule_name=rule.name,
                rule_type=rule.rule_type,
                priority=rule.priority,
                action=action,
                confidence=confidence,
                evidence={
                    "analysis_score": analysis_score,
                    "threshold": threshold,
                    "score_difference": threshold - analysis_score
                }
            )
        
        return None


class KeywordEvaluator:
    """Handles keyword-based rule evaluation."""
    
    @staticmethod
    def evaluate_keyword_rule(
        rule: DetectionRule, 
        product_data: Dict[str, Any]
    ) -> Optional[RuleMatch]:
        """
        Evaluate a keyword rule against product data.
        
        Args:
            rule: The keyword rule to evaluate
            product_data: Product information
            
        Returns:
            RuleMatch if rule is triggered, None otherwise
        """
        config = rule.config
        patterns = config.get("patterns", [])
        case_sensitive = config.get("case_sensitive", False)
        match_type = config.get("match_type", "any")  # "any" or "all"
        action = RuleAction(config.get("action", "flag"))
        
        # Check product description and title
        text_fields = []
        if "description" in product_data:
            text_fields.append(product_data["description"])
        if "title" in product_data:
            text_fields.append(product_data["title"])
        
        search_text = " ".join(text_fields)
        if not case_sensitive:
            search_text = search_text.lower()
            patterns = [p.lower() for p in patterns]
        
        matches = []
        for pattern in patterns:
            if pattern in search_text:
                matches.append(pattern)
        
        # Determine if rule is triggered based on match_type
        triggered = False
        if match_type == "any" and matches:
            triggered = True
        elif match_type == "all" and len(matches) == len(patterns):
            triggered = True
        
        if triggered:
            confidence = len(matches) / len(patterns)
            
            return RuleMatch(
                rule_id=rule.id,
                rule_name=rule.name,
                rule_type=rule.rule_type,
                priority=rule.priority,
                action=action,
                confidence=confidence,
                evidence={
                    "matched_patterns": matches,
                    "match_type": match_type,
                    "total_patterns": len(patterns)
                }
            )
        
        return None


class SupplierEvaluator:
    """Handles supplier-based rule evaluation."""
    
    @staticmethod
    def evaluate_supplier_rule(
        rule: DetectionRule, 
        product_data: Dict[str, Any]
    ) -> Optional[RuleMatch]:
        """
        Evaluate a supplier rule against product data.
        
        Args:
            rule: The supplier rule to evaluate
            product_data: Product information
            
        Returns:
            RuleMatch if rule is triggered, None otherwise
        """
        config = rule.config
        blacklist = set(config.get("blacklist", []))
        whitelist = set(config.get("whitelist", []))
        reputation_threshold = config.get("reputation_threshold", 0.0)
        action = RuleAction(config.get("action", "flag"))
        
        supplier_id = product_data.get("supplier_id")
        supplier_reputation = product_data.get("supplier_reputation", 1.0)
        
        triggered = False
        evidence = {}
        confidence = 0.0
        
        # Check blacklist
        if supplier_id and supplier_id in blacklist:
            triggered = True
            confidence = 1.0
            evidence["blacklist_match"] = True
            evidence["supplier_id"] = supplier_id
        
        # Check whitelist (if specified, only whitelisted suppliers are allowed)
        elif whitelist and supplier_id not in whitelist:
            triggered = True
            confidence = 0.8
            evidence["whitelist_violation"] = True
            evidence["supplier_id"] = supplier_id
        
        # Check reputation threshold
        elif supplier_reputation < reputation_threshold:
            triggered = True
            confidence = (reputation_threshold - supplier_reputation) / reputation_threshold
            evidence["reputation_below_threshold"] = True
            evidence["supplier_reputation"] = supplier_reputation
            evidence["reputation_threshold"] = reputation_threshold
        
        if triggered:
            return RuleMatch(
                rule_id=rule.id,
                rule_name=rule.name,
                rule_type=rule.rule_type,
                priority=rule.priority,
                action=action,
                confidence=confidence,
                evidence=evidence
            )
        
        return None


class PriceAnomalyEvaluator:
    """Handles price anomaly rule evaluation."""
    
    @staticmethod
    def evaluate_price_anomaly_rule(
        rule: DetectionRule, 
        product_data: Dict[str, Any],
        market_data: Optional[Dict[str, Any]] = None
    ) -> Optional[RuleMatch]:
        """
        Evaluate a price anomaly rule against product data.
        
        Args:
            rule: The price anomaly rule to evaluate
            product_data: Product information
            market_data: Market pricing information
            
        Returns:
            RuleMatch if rule is triggered, None otherwise
        """
        config = rule.config
        deviation_threshold = config.get("deviation_threshold", 0.5)  # 50% deviation
        min_price_ratio = config.get("min_price_ratio", 0.1)  # 10% of expected price
        action = RuleAction(config.get("action", "flag"))
        
        product_price = product_data.get("price", 0.0)
        if isinstance(product_price, Decimal):
            product_price = float(product_price)
        
        # Use market data if available, otherwise use heuristics
        if market_data and "average_price" in market_data:
            average_price = market_data["average_price"]
            
            # Calculate price deviation
            if average_price > 0:
                deviation = abs(product_price - average_price) / average_price
                price_ratio = product_price / average_price
                
                # Check for suspicious pricing
                if deviation > deviation_threshold or price_ratio < min_price_ratio:
                    confidence = min(1.0, deviation / deviation_threshold)
                    
                    return RuleMatch(
                        rule_id=rule.id,
                        rule_name=rule.name,
                        rule_type=rule.rule_type,
                        priority=rule.priority,
                        action=action,
                        confidence=confidence,
                        evidence={
                            "product_price": product_price,
                            "average_price": average_price,
                            "deviation": deviation,
                            "price_ratio": price_ratio,
                            "deviation_threshold": deviation_threshold
                        }
                    )
        
        # Heuristic-based evaluation for luxury brands
        brand = product_data.get("brand", "").lower()
        luxury_brands = {"rolex", "gucci", "louis vuitton", "prada", "hermès", "chanel"}
        
        if any(luxury_brand in brand for luxury_brand in luxury_brands):
            # Luxury items below $50 are highly suspicious
            if product_price < 50.0:
                return RuleMatch(
                    rule_id=rule.id,
                    rule_name=rule.name,
                    rule_type=rule.rule_type,
                    priority=rule.priority,
                    action=action,
                    confidence=0.95,
                    evidence={
                        "product_price": product_price,
                        "luxury_brand_detected": True,
                        "suspicious_low_price": True
                    }
                )
        
        return None


class RuleEngine(BaseAgent):
    """
    Rule Engine Agent for configurable detection rules and threshold-based flagging.
    
    This agent evaluates products against a configurable set of detection rules,
    including threshold-based, keyword, supplier, price anomaly, and brand verification rules.
    """
    
    def __init__(self, agent_id: str):
        # Define agent capabilities
        capabilities = [
            AgentCapability(
                name="rule_evaluation",
                description="Evaluate products against detection rules",
                input_schema={
                    "product_id": "string",
                    "analysis_score": "number (optional)",
                    "force_evaluation": "boolean (optional)"
                },
                output_schema={
                    "evaluation_id": "string",
                    "matched_rules": "array",
                    "overall_risk_score": "number",
                    "recommended_action": "string"
                }
            ),
            AgentCapability(
                name="batch_rule_evaluation",
                description="Evaluate multiple products against detection rules",
                input_schema={
                    "product_ids": "array of strings",
                    "analysis_scores": "object mapping product_id to score (optional)"
                },
                output_schema={
                    "total_evaluated": "number",
                    "evaluations": "array",
                    "summary_stats": "object"
                }
            )
        ]
        
        super().__init__(
            agent_id=agent_id,
            agent_type="rule_engine",
            capabilities=capabilities
        )
        
        # Rule evaluators
        self.threshold_evaluator = ThresholdEvaluator()
        self.keyword_evaluator = KeywordEvaluator()
        self.supplier_evaluator = SupplierEvaluator()
        self.price_evaluator = PriceAnomalyEvaluator()
        
        # Performance metrics
        self.total_evaluations = 0
        self.total_evaluation_time = 0.0
        self.rules_cache: Dict[str, List[DetectionRule]] = {}
        self.rules_cache_timestamp: Optional[datetime] = None
        self.cache_ttl_seconds = 300  # 5 minutes
        
        # Repositories (initialized in start method)
        self.rule_repository: Optional[RuleRepository] = None
        self.product_repository: Optional[ProductRepository] = None
        
    async def start(self) -> None:
        """Start the rule engine agent."""
        try:
            async with get_db_session() as session:
                self.rule_repository = RuleRepository(session)
                self.product_repository = ProductRepository(session)
            
            await super().start()
            logger.info("Rule engine agent started", agent_id=self.agent_id)
            
        except Exception as e:
            logger.error("Failed to start rule engine agent", error=str(e))
            self.status = AgentStatus.ERROR
            raise
    
    async def process_message(self, message: AgentMessage) -> AgentResponse:
        """Process incoming messages for rule evaluation."""
        try:
            if message.message_type == "rule_evaluation_request":
                return await self._handle_rule_evaluation(message)
            
            elif message.message_type == "batch_rule_evaluation_request":
                return await self._handle_batch_rule_evaluation(message)
            
            elif message.message_type == "get_rule_stats":
                return await self._handle_get_stats(message)
            
            elif message.message_type == "refresh_rules_cache":
                return await self._handle_refresh_cache(message)
            
            else:
                return AgentResponse(
                    success=False,
                    error=f"Unknown message type: {message.message_type}"
                )
        
        except Exception as e:
            logger.error("Error processing message", error=str(e), message_type=message.message_type)
            return AgentResponse(
                success=False,
                error=f"Error processing message: {str(e)}"
            )
    
    async def _handle_rule_evaluation(self, message: AgentMessage) -> AgentResponse:
        """Handle single product rule evaluation request."""
        payload = message.payload
        product_id = payload.get("product_id")
        analysis_score = payload.get("analysis_score")
        force_evaluation = payload.get("force_evaluation", False)
        
        if not product_id:
            return AgentResponse(
                success=False,
                error="product_id is required"
            )
        
        try:
            result = await self.evaluate_product_rules(
                product_id, analysis_score, force_evaluation
            )
            
            return AgentResponse(
                success=True,
                result={
                    "evaluation_id": result.evaluation_id,
                    "product_id": result.product_id,
                    "total_rules_evaluated": result.total_rules_evaluated,
                    "matched_rules": [match.dict() for match in result.matched_rules],
                    "highest_priority_action": result.highest_priority_action.value if result.highest_priority_action else None,
                    "overall_risk_score": result.overall_risk_score,
                    "evaluation_duration_ms": result.evaluation_duration_ms
                }
            )
        
        except Exception as e:
            logger.error("Rule evaluation failed", error=str(e), product_id=product_id)
            return AgentResponse(
                success=False,
                error=f"Rule evaluation failed: {str(e)}"
            )
    
    async def _handle_batch_rule_evaluation(self, message: AgentMessage) -> AgentResponse:
        """Handle batch product rule evaluation request."""
        payload = message.payload
        product_ids = payload.get("product_ids", [])
        analysis_scores = payload.get("analysis_scores", {})
        
        if not product_ids:
            return AgentResponse(
                success=False,
                error="product_ids array is required"
            )
        
        evaluations = []
        successful_count = 0
        error_count = 0
        
        # Process products in parallel (limited concurrency)
        semaphore = asyncio.Semaphore(5)  # Limit to 5 concurrent evaluations
        
        async def evaluate_single(pid: str) -> Optional[Dict[str, Any]]:
            async with semaphore:
                try:
                    analysis_score = analysis_scores.get(pid)
                    result = await self.evaluate_product_rules(pid, analysis_score)
                    return {
                        "evaluation_id": result.evaluation_id,
                        "product_id": result.product_id,
                        "matched_rules_count": len(result.matched_rules),
                        "highest_priority_action": result.highest_priority_action.value if result.highest_priority_action else None,
                        "overall_risk_score": result.overall_risk_score,
                        "evaluation_duration_ms": result.evaluation_duration_ms
                    }
                except Exception as e:
                    logger.error("Batch evaluation failed for product", error=str(e), product_id=pid)
                    return None
        
        # Execute batch evaluation
        tasks = [evaluate_single(pid) for pid in product_ids]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for result in results:
            if isinstance(result, Exception):
                error_count += 1
            elif result is not None:
                evaluations.append(result)
                successful_count += 1
            else:
                error_count += 1
        
        return AgentResponse(
            success=True,
            result={
                "total_requested": len(product_ids),
                "successful_count": successful_count,
                "error_count": error_count,
                "evaluations": evaluations,
                "summary_stats": {
                    "avg_risk_score": sum(e["overall_risk_score"] for e in evaluations) / len(evaluations) if evaluations else 0,
                    "high_risk_count": sum(1 for e in evaluations if e["overall_risk_score"] > 70),
                    "action_distribution": self._calculate_action_distribution(evaluations)
                }
            }
        )
    
    async def _handle_get_stats(self, message: AgentMessage) -> AgentResponse:
        """Handle request for rule engine statistics."""
        return AgentResponse(
            success=True,
            result={
                "agent_id": self.agent_id,
                "status": self.status.value,
                "total_evaluations": self.total_evaluations,
                "average_evaluation_time_ms": (
                    self.total_evaluation_time / self.total_evaluations 
                    if self.total_evaluations > 0 else 0
                ),
                "rules_cache_size": sum(len(rules) for rules in self.rules_cache.values()),
                "cache_last_updated": self.rules_cache_timestamp.isoformat() if self.rules_cache_timestamp else None,
                "processed_messages": self.processed_messages,
                "error_count": self.error_count
            }
        )
    
    async def _handle_refresh_cache(self, message: AgentMessage) -> AgentResponse:
        """Handle request to refresh rules cache."""
        try:
            await self._refresh_rules_cache()
            return AgentResponse(
                success=True,
                result={
                    "cache_refreshed": True,
                    "rules_loaded": sum(len(rules) for rules in self.rules_cache.values()),
                    "cache_timestamp": self.rules_cache_timestamp.isoformat()
                }
            )
        except Exception as e:
            return AgentResponse(
                success=False,
                error=f"Failed to refresh cache: {str(e)}"
            )
    
    async def evaluate_product_rules(
        self, 
        product_id: str, 
        analysis_score: Optional[float] = None,
        force_evaluation: bool = False
    ) -> RuleEvaluationResult:
        """
        Evaluate a product against all applicable detection rules.
        
        Args:
            product_id: ID of product to evaluate
            analysis_score: LLM authenticity score (0-100)
            force_evaluation: Skip caching and force fresh evaluation
            
        Returns:
            RuleEvaluationResult with all rule matches
        """
        start_time = datetime.utcnow()
        
        try:
            # Get product data
            async with get_db_session() as session:
                product_repo = ProductRepository(session)
                product = await product_repo.get_product_by_id(product_id)
                
                if not product:
                    raise ValueError(f"Product {product_id} not found")
                
                # Convert product to dictionary for rule evaluation
                product_data = {
                    "id": str(product.id),
                    "title": getattr(product, 'title', ''),
                    "description": product.description or '',
                    "category": product.category,
                    "price": product.price,
                    "brand": product.brand or '',
                    "supplier_id": str(product.supplier_id) if product.supplier_id else None,
                    "supplier_reputation": getattr(product, 'supplier_reputation', 1.0)
                }
                
                # Get applicable rules
                rules = await self._get_applicable_rules(product.category)
                
                # Evaluate rules
                matched_rules = []
                for rule in rules:
                    match = await self._evaluate_single_rule(rule, product_data, analysis_score)
                    if match:
                        matched_rules.append(match)
                
                # Calculate overall risk score and determine highest priority action
                overall_risk_score = self._calculate_overall_risk_score(matched_rules)
                highest_priority_action = self._get_highest_priority_action(matched_rules)
                
                # Calculate duration
                duration_ms = (datetime.utcnow() - start_time).total_seconds() * 1000
                
                # Update metrics
                self.total_evaluations += 1
                self.total_evaluation_time += duration_ms
                
                result = RuleEvaluationResult(
                    product_id=product_id,
                    agent_id=self.agent_id,
                    total_rules_evaluated=len(rules),
                    matched_rules=matched_rules,
                    highest_priority_action=highest_priority_action,
                    overall_risk_score=overall_risk_score,
                    evaluation_duration_ms=duration_ms
                )
                
                logger.info(
                    "Rule evaluation completed",
                    product_id=product_id,
                    rules_evaluated=len(rules),
                    rules_matched=len(matched_rules),
                    risk_score=overall_risk_score,
                    duration_ms=duration_ms
                )
                
                return result
        
        except Exception as e:
            logger.error("Rule evaluation failed", error=str(e), product_id=product_id)
            raise
    
    async def _get_applicable_rules(self, category: ProductCategory) -> List[DetectionRule]:
        """Get rules applicable to a product category."""
        # Check cache first
        if self._is_cache_valid():
            cache_key = f"category_{category.value}"
            if cache_key in self.rules_cache:
                return self.rules_cache[cache_key]
        
        # Refresh cache if needed
        await self._refresh_rules_cache()
        
        # Return category-specific rules + general rules
        category_rules = self.rules_cache.get(f"category_{category.value}", [])
        general_rules = self.rules_cache.get("category_general", [])
        
        return category_rules + general_rules
    
    async def _refresh_rules_cache(self) -> None:
        """Refresh the rules cache from database."""
        try:
            async with get_db_session() as session:
                rule_repo = RuleRepository(session)
                all_rules = await rule_repo.get_active_rules()
                
                # Group rules by category
                new_cache = {}
                for rule in all_rules:
                    cache_key = f"category_{rule.category or 'general'}"
                    if cache_key not in new_cache:
                        new_cache[cache_key] = []
                    new_cache[cache_key].append(rule)
                
                # Sort rules by priority within each category
                for rules in new_cache.values():
                    rules.sort(key=lambda r: r.priority, reverse=True)
                
                self.rules_cache = new_cache
                self.rules_cache_timestamp = datetime.utcnow()
                
                logger.info(
                    "Rules cache refreshed",
                    total_rules=len(all_rules),
                    categories=len(new_cache)
                )
        
        except Exception as e:
            logger.error("Failed to refresh rules cache", error=str(e))
            raise
    
    def _is_cache_valid(self) -> bool:
        """Check if rules cache is still valid."""
        if not self.rules_cache_timestamp:
            return False
        
        cache_age = (datetime.utcnow() - self.rules_cache_timestamp).total_seconds()
        return cache_age < self.cache_ttl_seconds
    
    async def _evaluate_single_rule(
        self, 
        rule: DetectionRule, 
        product_data: Dict[str, Any], 
        analysis_score: Optional[float] = None
    ) -> Optional[RuleMatch]:
        """Evaluate a single rule against product data."""
        try:
            if rule.rule_type == RuleType.THRESHOLD:
                return self.threshold_evaluator.evaluate_threshold_rule(
                    rule, product_data, analysis_score
                )
            
            elif rule.rule_type == RuleType.KEYWORD:
                return self.keyword_evaluator.evaluate_keyword_rule(
                    rule, product_data
                )
            
            elif rule.rule_type == RuleType.SUPPLIER:
                return self.supplier_evaluator.evaluate_supplier_rule(
                    rule, product_data
                )
            
            elif rule.rule_type == RuleType.PRICE_ANOMALY:
                return self.price_evaluator.evaluate_price_anomaly_rule(
                    rule, product_data
                )
            
            elif rule.rule_type == RuleType.BRAND_VERIFICATION:
                # TODO: Implement brand verification rule evaluation
                logger.debug("Brand verification rules not yet implemented", rule_id=rule.id)
                return None
            
            else:
                logger.warning("Unknown rule type", rule_type=rule.rule_type, rule_id=rule.id)
                return None
        
        except Exception as e:
            logger.error("Rule evaluation error", error=str(e), rule_id=rule.id)
            return None
    
    def _calculate_overall_risk_score(self, matched_rules: List[RuleMatch]) -> float:
        """Calculate overall risk score based on matched rules."""
        if not matched_rules:
            return 0.0
        
        # Weight scores by priority and confidence
        total_weighted_score = 0.0
        total_weight = 0.0
        
        for match in matched_rules:
            # Use priority as weight (higher priority = more weight)
            weight = match.priority / 100.0  # Normalize to 0-1
            score = match.confidence * 100.0  # Convert to 0-100 scale
            
            total_weighted_score += score * weight
            total_weight += weight
        
        if total_weight == 0:
            return 0.0
        
        base_score = total_weighted_score / total_weight
        
        # Apply bonus for multiple rule matches (compound risk)
        if len(matched_rules) > 1:
            bonus_factor = 1.0 + (len(matched_rules) - 1) * 0.1  # 10% bonus per additional rule
            base_score = min(100.0, base_score * bonus_factor)
        
        return round(base_score, 2)
    
    def _get_highest_priority_action(self, matched_rules: List[RuleMatch]) -> Optional[RuleAction]:
        """Get the highest priority action from matched rules."""
        if not matched_rules:
            return None
        
        # Rules are already sorted by priority in RuleEvaluationResult
        highest_priority_match = matched_rules[0]
        return highest_priority_match.action
    
    def _calculate_action_distribution(self, evaluations: List[Dict[str, Any]]) -> Dict[str, int]:
        """Calculate distribution of recommended actions."""
        distribution = {}
        for evaluation in evaluations:
            action = evaluation.get("highest_priority_action", "none")
            distribution[action] = distribution.get(action, 0) + 1
        return distribution