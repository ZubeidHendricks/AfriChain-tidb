"""
Tests for RuleEngine agent functionality.

This module tests the rule engine's ability to evaluate products against
detection rules, handle rule combinations, and resolve conflicts.
"""

import asyncio
import json
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from src.counterfeit_detection.agents.rule_engine import (
    RuleEngine,
    RuleMatch,
    RuleEvaluationResult,
    ThresholdEvaluator,
    KeywordEvaluator,
    SupplierEvaluator,
    PriceAnomalyEvaluator
)
from src.counterfeit_detection.agents.base import AgentMessage, AgentResponse
from src.counterfeit_detection.models.enums import RuleType, RuleAction, ProductCategory
from src.counterfeit_detection.models.database import DetectionRule


class TestRuleEngine:
    """Test RuleEngine agent functionality."""
    
    @pytest.fixture
    def mock_db_session(self):
        """Mock database session."""
        with patch('src.counterfeit_detection.core.database.get_db_session') as mock_session:
            session_context = AsyncMock()
            session_context.__aenter__ = AsyncMock(return_value=session_context)
            session_context.__aexit__ = AsyncMock(return_value=None)
            mock_session.return_value = session_context
            yield session_context
    
    @pytest.fixture
    def mock_product(self):
        """Mock product for testing."""
        product = MagicMock()
        product.id = uuid4()
        product.description = "High-quality leather handbag with gold hardware"
        product.category = ProductCategory.BAGS
        product.price = Decimal("299.99")
        product.brand = "LuxuryBrand"
        product.supplier_id = uuid4()
        product.supplier_reputation = 0.8
        return product
    
    @pytest.fixture
    def mock_threshold_rule(self):
        """Mock threshold detection rule."""
        rule = DetectionRule(
            id=str(uuid4()),
            name="Low Authenticity Threshold",
            rule_type=RuleType.THRESHOLD,
            config={
                "score_threshold": 30.0,
                "action": "flag"
            },
            priority=100,
            active=True,
            category=None
        )
        return rule
    
    @pytest.fixture
    def mock_keyword_rule(self):
        """Mock keyword detection rule."""
        rule = DetectionRule(
            id=str(uuid4()),
            name="Suspicious Keywords",
            rule_type=RuleType.KEYWORD,
            config={
                "patterns": ["replica", "fake", "knockoff"],
                "case_sensitive": False,
                "action": "remove",
                "match_type": "any"
            },
            priority=200,
            active=True,
            category=None
        )
        return rule
    
    @pytest.fixture
    def mock_supplier_rule(self):
        """Mock supplier detection rule."""
        rule = DetectionRule(
            id=str(uuid4()),
            name="Supplier Reputation Check",
            rule_type=RuleType.SUPPLIER,
            config={
                "reputation_threshold": 0.5,
                "action": "flag"
            },
            priority=150,
            active=True,
            category=None
        )
        return rule
    
    @pytest.fixture
    async def rule_engine(self, mock_db_session):
        """Create rule engine for testing."""
        engine = RuleEngine("test-rule-engine")
        # Don't actually start to avoid Redis dependencies
        engine.status = engine.status.RUNNING
        
        # Mock repositories
        engine.rule_repository = AsyncMock()
        engine.product_repository = AsyncMock()
        
        yield engine
    
    @pytest.mark.asyncio
    async def test_agent_initialization(self):
        """Test rule engine agent initialization."""
        engine = RuleEngine("test-engine")
        
        assert engine.agent_id == "test-engine"
        assert engine.agent_type == "rule_engine"
        assert len(engine.capabilities) == 2
        
        capability_names = [cap.name for cap in engine.capabilities]
        assert "rule_evaluation" in capability_names
        assert "batch_rule_evaluation" in capability_names
    
    @pytest.mark.asyncio
    async def test_process_message_rule_evaluation(self, rule_engine):
        """Test processing rule evaluation message."""
        product_id = str(uuid4())
        
        with patch.object(rule_engine, 'evaluate_product_rules') as mock_evaluate:
            mock_result = RuleEvaluationResult(
                product_id=product_id,
                agent_id=rule_engine.agent_id,
                total_rules_evaluated=3,
                matched_rules=[],
                highest_priority_action=None,
                overall_risk_score=25.0,
                evaluation_duration_ms=150.0
            )
            mock_evaluate.return_value = mock_result
            
            message = AgentMessage(
                sender_id="test-sender",
                message_type="rule_evaluation_request",
                payload={"product_id": product_id, "analysis_score": 75.0}
            )
            
            response = await rule_engine.process_message(message)
            
            assert response.success is True
            assert response.result["product_id"] == product_id
            assert response.result["overall_risk_score"] == 25.0
            mock_evaluate.assert_called_once_with(product_id, 75.0, False)
    
    @pytest.mark.asyncio
    async def test_evaluate_product_rules_success(
        self, 
        rule_engine, 
        mock_product,
        mock_threshold_rule,
        mock_keyword_rule
    ):
        """Test successful product rule evaluation."""
        # Mock repository responses
        rule_engine.product_repository.get_product_by_id.return_value = mock_product
        rule_engine.rule_repository = AsyncMock()
        
        # Mock rule loading
        rules = [mock_threshold_rule, mock_keyword_rule]
        
        with patch.object(rule_engine, '_get_applicable_rules') as mock_get_rules, \
             patch.object(rule_engine, '_evaluate_single_rule') as mock_eval_rule:
            
            mock_get_rules.return_value = rules
            
            # Mock rule evaluation results
            threshold_match = RuleMatch(
                rule_id=mock_threshold_rule.id,
                rule_name=mock_threshold_rule.name,
                rule_type=mock_threshold_rule.rule_type,
                priority=mock_threshold_rule.priority,
                action=RuleAction.FLAG,
                confidence=0.8,
                evidence={"analysis_score": 25.0, "threshold": 30.0}
            )
            
            mock_eval_rule.side_effect = [threshold_match, None]  # First rule matches, second doesn't
            
            result = await rule_engine.evaluate_product_rules(
                str(mock_product.id), 
                analysis_score=25.0
            )
            
            assert result.product_id == str(mock_product.id)
            assert result.total_rules_evaluated == 2
            assert len(result.matched_rules) == 1
            assert result.matched_rules[0].rule_id == mock_threshold_rule.id
            assert result.highest_priority_action == RuleAction.FLAG
            assert result.overall_risk_score > 0
    
    @pytest.mark.asyncio
    async def test_evaluate_product_not_found(self, rule_engine):
        """Test evaluation of non-existent product."""
        rule_engine.product_repository.get_product_by_id.return_value = None
        
        with pytest.raises(ValueError, match="Product .+ not found"):
            await rule_engine.evaluate_product_rules(str(uuid4()))
    
    @pytest.mark.asyncio
    async def test_get_applicable_rules_with_cache(self, rule_engine, mock_threshold_rule):
        """Test getting applicable rules with caching."""
        category = ProductCategory.ELECTRONICS
        
        # Set up cache
        rule_engine.rules_cache = {
            f"category_{category.value}": [mock_threshold_rule],
            "category_general": []
        }
        rule_engine.rules_cache_timestamp = rule_engine._get_current_time()
        
        with patch.object(rule_engine, '_is_cache_valid', return_value=True):
            rules = await rule_engine._get_applicable_rules(category)
            
            assert len(rules) == 1
            assert rules[0].id == mock_threshold_rule.id
    
    @pytest.mark.asyncio
    async def test_refresh_rules_cache(self, rule_engine, mock_threshold_rule, mock_keyword_rule):
        """Test refreshing rules cache from database."""
        rules = [mock_threshold_rule, mock_keyword_rule]
        
        # Mock the repository
        mock_rule_repo = AsyncMock()
        mock_rule_repo.get_active_rules.return_value = rules
        
        with patch('src.counterfeit_detection.db.repositories.rule_repository.RuleRepository', return_value=mock_rule_repo):
            await rule_engine._refresh_rules_cache()
            
            assert len(rule_engine.rules_cache) > 0
            assert rule_engine.rules_cache_timestamp is not None
    
    @pytest.mark.asyncio
    async def test_calculate_overall_risk_score(self, rule_engine):
        """Test overall risk score calculation."""
        matches = [
            RuleMatch(
                rule_id="rule1",
                rule_name="High Priority Rule",
                rule_type=RuleType.THRESHOLD,
                priority=200,
                action=RuleAction.FLAG,
                confidence=0.9,
                evidence={}
            ),
            RuleMatch(
                rule_id="rule2",
                rule_name="Medium Priority Rule", 
                rule_type=RuleType.KEYWORD,
                priority=100,
                action=RuleAction.MONITOR,
                confidence=0.7,
                evidence={}
            )
        ]
        
        risk_score = rule_engine._calculate_overall_risk_score(matches)
        
        assert isinstance(risk_score, float)
        assert 0 <= risk_score <= 100
        assert risk_score > 0  # Should be positive with matches
    
    @pytest.mark.asyncio
    async def test_get_highest_priority_action(self, rule_engine):
        """Test getting highest priority action from matches."""
        matches = [
            RuleMatch(
                rule_id="rule1",
                rule_name="Low Priority",
                rule_type=RuleType.THRESHOLD,
                priority=100,
                action=RuleAction.MONITOR,
                confidence=0.8,
                evidence={}
            ),
            RuleMatch(
                rule_id="rule2",
                rule_name="High Priority",
                rule_type=RuleType.KEYWORD,
                priority=200,
                action=RuleAction.FLAG,
                confidence=0.9,
                evidence={}
            )
        ]
        
        # Manually sort matches by priority for test
        matches.sort(key=lambda x: x.priority, reverse=True)
        
        action = rule_engine._get_highest_priority_action(matches)
        assert action == RuleAction.FLAG  # Higher priority rule action


class TestThresholdEvaluator:
    """Test ThresholdEvaluator functionality."""
    
    def test_evaluate_threshold_rule_triggered(self):
        """Test threshold rule evaluation when rule is triggered."""
        rule = DetectionRule(
            id="test-rule",
            name="Test Threshold",
            rule_type=RuleType.THRESHOLD,
            config={"score_threshold": 50.0, "action": "flag"},
            priority=100,
            active=True
        )
        
        product_data = {"description": "test product"}
        analysis_score = 30.0  # Below threshold
        
        match = ThresholdEvaluator.evaluate_threshold_rule(rule, product_data, analysis_score)
        
        assert match is not None
        assert match.rule_id == "test-rule"
        assert match.action == RuleAction.FLAG
        assert match.confidence > 0
        assert match.evidence["analysis_score"] == 30.0
        assert match.evidence["threshold"] == 50.0
    
    def test_evaluate_threshold_rule_not_triggered(self):
        """Test threshold rule evaluation when rule is not triggered."""
        rule = DetectionRule(
            id="test-rule",
            name="Test Threshold",
            rule_type=RuleType.THRESHOLD,
            config={"score_threshold": 50.0, "action": "flag"},
            priority=100,
            active=True
        )
        
        product_data = {"description": "test product"}
        analysis_score = 75.0  # Above threshold
        
        match = ThresholdEvaluator.evaluate_threshold_rule(rule, product_data, analysis_score)
        
        assert match is None
    
    def test_evaluate_threshold_rule_no_score(self):
        """Test threshold rule evaluation when no analysis score is provided."""
        rule = DetectionRule(
            id="test-rule",
            name="Test Threshold",
            rule_type=RuleType.THRESHOLD,
            config={"score_threshold": 50.0, "action": "flag"},
            priority=100,
            active=True
        )
        
        product_data = {"description": "test product"}
        
        match = ThresholdEvaluator.evaluate_threshold_rule(rule, product_data, None)
        
        assert match is None


class TestKeywordEvaluator:
    """Test KeywordEvaluator functionality."""
    
    def test_evaluate_keyword_rule_match_any(self):
        """Test keyword rule evaluation with 'any' match type."""
        rule = DetectionRule(
            id="test-rule",
            name="Suspicious Keywords",
            rule_type=RuleType.KEYWORD,
            config={
                "patterns": ["replica", "fake", "knockoff"],
                "case_sensitive": False,
                "action": "remove",
                "match_type": "any"
            },
            priority=200,
            active=True
        )
        
        product_data = {
            "description": "This is a replica handbag with premium materials",
            "title": "Designer Handbag"
        }
        
        match = KeywordEvaluator.evaluate_keyword_rule(rule, product_data)
        
        assert match is not None
        assert match.rule_id == "test-rule"
        assert match.action == RuleAction.REMOVE
        assert "replica" in match.evidence["matched_patterns"]
    
    def test_evaluate_keyword_rule_match_all(self):
        """Test keyword rule evaluation with 'all' match type."""
        rule = DetectionRule(
            id="test-rule",
            name="Multiple Keywords",
            rule_type=RuleType.KEYWORD,
            config={
                "patterns": ["luxury", "handbag"],
                "case_sensitive": False,
                "action": "flag",
                "match_type": "all"
            },
            priority=150,
            active=True
        )
        
        product_data = {
            "description": "Luxury handbag with premium materials"
        }
        
        match = KeywordEvaluator.evaluate_keyword_rule(rule, product_data)
        
        assert match is not None
        assert match.confidence == 1.0  # All patterns matched
        assert len(match.evidence["matched_patterns"]) == 2
    
    def test_evaluate_keyword_rule_case_sensitive(self):
        """Test keyword rule evaluation with case sensitivity."""
        rule = DetectionRule(
            id="test-rule",
            name="Case Sensitive",
            rule_type=RuleType.KEYWORD,
            config={
                "patterns": ["FAKE"],
                "case_sensitive": True,
                "action": "flag",
                "match_type": "any"
            },
            priority=100,
            active=True
        )
        
        # Should not match due to case sensitivity
        product_data = {"description": "This is a fake product"}
        match = KeywordEvaluator.evaluate_keyword_rule(rule, product_data)
        assert match is None
        
        # Should match with correct case
        product_data = {"description": "This is a FAKE product"}
        match = KeywordEvaluator.evaluate_keyword_rule(rule, product_data)
        assert match is not None


class TestSupplierEvaluator:
    """Test SupplierEvaluator functionality."""
    
    def test_evaluate_supplier_rule_blacklist(self):
        """Test supplier rule evaluation with blacklist."""
        rule = DetectionRule(
            id="test-rule",
            name="Blacklisted Suppliers",
            rule_type=RuleType.SUPPLIER,
            config={
                "blacklist": ["supplier-123", "supplier-456"],
                "action": "block"
            },
            priority=300,
            active=True
        )
        
        product_data = {
            "supplier_id": "supplier-123",
            "supplier_reputation": 0.8
        }
        
        match = SupplierEvaluator.evaluate_supplier_rule(rule, product_data)
        
        assert match is not None
        assert match.action == RuleAction.BLOCK
        assert match.confidence == 1.0
        assert match.evidence["blacklist_match"] is True
    
    def test_evaluate_supplier_rule_reputation(self):
        """Test supplier rule evaluation with reputation threshold."""
        rule = DetectionRule(
            id="test-rule",
            name="Low Reputation",
            rule_type=RuleType.SUPPLIER,
            config={
                "reputation_threshold": 0.7,
                "action": "flag"
            },
            priority=200,
            active=True
        )
        
        product_data = {
            "supplier_id": "supplier-789",
            "supplier_reputation": 0.3  # Below threshold
        }
        
        match = SupplierEvaluator.evaluate_supplier_rule(rule, product_data)
        
        assert match is not None
        assert match.evidence["reputation_below_threshold"] is True
        assert match.evidence["supplier_reputation"] == 0.3
    
    def test_evaluate_supplier_rule_whitelist_violation(self):
        """Test supplier rule evaluation with whitelist violation."""
        rule = DetectionRule(
            id="test-rule",
            name="Whitelisted Only",
            rule_type=RuleType.SUPPLIER,
            config={
                "whitelist": ["trusted-supplier-1", "trusted-supplier-2"],
                "action": "quarantine"
            },
            priority=250,
            active=True
        )
        
        product_data = {
            "supplier_id": "unknown-supplier",
            "supplier_reputation": 0.9
        }
        
        match = SupplierEvaluator.evaluate_supplier_rule(rule, product_data)
        
        assert match is not None
        assert match.action == RuleAction.QUARANTINE
        assert match.evidence["whitelist_violation"] is True


class TestPriceAnomalyEvaluator:
    """Test PriceAnomalyEvaluator functionality."""
    
    def test_evaluate_price_anomaly_with_market_data(self):
        """Test price anomaly evaluation with market data."""
        rule = DetectionRule(
            id="test-rule",
            name="Price Deviation",
            rule_type=RuleType.PRICE_ANOMALY,
            config={
                "deviation_threshold": 0.5,  # 50%
                "action": "flag"
            },
            priority=150,
            active=True
        )
        
        product_data = {"price": 50.0, "brand": "normalBrand"}
        market_data = {"average_price": 200.0}
        
        match = PriceAnomalyEvaluator.evaluate_price_anomaly_rule(
            rule, product_data, market_data
        )
        
        assert match is not None
        assert match.evidence["product_price"] == 50.0
        assert match.evidence["average_price"] == 200.0
        assert match.evidence["deviation"] > 0.5
    
    def test_evaluate_price_anomaly_luxury_brand_heuristic(self):
        """Test price anomaly evaluation with luxury brand heuristic."""
        rule = DetectionRule(
            id="test-rule",
            name="Luxury Price Check",
            rule_type=RuleType.PRICE_ANOMALY,
            config={
                "action": "flag"
            },
            priority=200,
            active=True
        )
        
        product_data = {
            "price": 25.0,  # Suspiciously low for luxury
            "brand": "Rolex"
        }
        
        match = PriceAnomalyEvaluator.evaluate_price_anomaly_rule(rule, product_data)
        
        assert match is not None
        assert match.confidence == 0.95
        assert match.evidence["luxury_brand_detected"] is True
        assert match.evidence["suspicious_low_price"] is True
    
    def test_evaluate_price_anomaly_no_trigger(self):
        """Test price anomaly evaluation when no anomaly is detected."""
        rule = DetectionRule(
            id="test-rule",
            name="Price Check",
            rule_type=RuleType.PRICE_ANOMALY,
            config={
                "deviation_threshold": 0.5,
                "action": "flag"
            },
            priority=100,
            active=True
        )
        
        product_data = {"price": 180.0, "brand": "normalBrand"}
        market_data = {"average_price": 200.0}
        
        match = PriceAnomalyEvaluator.evaluate_price_anomaly_rule(
            rule, product_data, market_data
        )
        
        assert match is None  # Small deviation, should not trigger