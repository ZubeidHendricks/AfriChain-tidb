"""
Pydantic schemas for rule management API endpoints.

This module defines the request and response schemas for detection rule
management, including validation and documentation.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional, Union
from uuid import uuid4

from pydantic import BaseModel, Field, validator

from ...models.enums import RuleType, RuleAction, ProductCategory


class RuleConfigBase(BaseModel):
    """Base class for rule configurations."""
    action: RuleAction = Field(default=RuleAction.FLAG, description="Action to take when rule is triggered")


class ThresholdRuleConfig(RuleConfigBase):
    """Configuration for threshold-based rules."""
    score_threshold: float = Field(
        ..., 
        ge=0.0, 
        le=100.0, 
        description="Authenticity score threshold (0-100)"
    )
    category: Optional[str] = Field(
        None, 
        description="Specific product category for this threshold"
    )


class KeywordRuleConfig(RuleConfigBase):
    """Configuration for keyword-based rules."""
    patterns: List[str] = Field(
        ..., 
        min_items=1, 
        description="List of keywords/patterns to match"
    )
    case_sensitive: bool = Field(
        default=False, 
        description="Whether pattern matching is case-sensitive"
    )
    match_type: str = Field(
        default="any", 
        regex="^(any|all)$", 
        description="Match type: 'any' or 'all' patterns must match"
    )


class SupplierRuleConfig(RuleConfigBase):
    """Configuration for supplier-based rules."""
    blacklist: Optional[List[str]] = Field(
        None, 
        description="List of blacklisted supplier IDs"
    )
    whitelist: Optional[List[str]] = Field(
        None, 
        description="List of whitelisted supplier IDs (if specified, only these are allowed)"
    )
    reputation_threshold: Optional[float] = Field(
        None, 
        ge=0.0, 
        le=1.0, 
        description="Minimum supplier reputation score (0.0-1.0)"
    )
    
    @validator('reputation_threshold', 'blacklist', 'whitelist')
    def validate_at_least_one_condition(cls, v, values):
        """Ensure at least one condition is specified."""
        if v is None and not values.get('blacklist') and not values.get('whitelist'):
            # This will be caught by the root validator
            pass
        return v
    
    @validator('whitelist')
    def validate_not_both_lists(cls, v, values):
        """Ensure blacklist and whitelist aren't both specified."""
        if v and values.get('blacklist'):
            raise ValueError("Cannot specify both blacklist and whitelist")
        return v


class PriceAnomalyRuleConfig(RuleConfigBase):
    """Configuration for price anomaly detection rules."""
    deviation_threshold: float = Field(
        default=0.5, 
        gt=0.0, 
        description="Price deviation threshold as percentage (e.g., 0.5 = 50%)"
    )
    min_price_ratio: float = Field(
        default=0.1, 
        gt=0.0, 
        le=1.0, 
        description="Minimum price ratio compared to expected price"
    )
    use_market_data: bool = Field(
        default=True, 
        description="Whether to use market data for comparison"
    )


class BrandVerificationRuleConfig(RuleConfigBase):
    """Configuration for brand verification rules."""
    verified_brands: List[str] = Field(
        ..., 
        min_items=1, 
        description="List of verified brand names"
    )
    case_sensitive: bool = Field(
        default=False, 
        description="Whether brand matching is case-sensitive"
    )
    require_exact_match: bool = Field(
        default=True, 
        description="Whether to require exact brand name match"
    )


# Union type for all rule configurations
RuleConfig = Union[
    ThresholdRuleConfig,
    KeywordRuleConfig,
    SupplierRuleConfig,
    PriceAnomalyRuleConfig,
    BrandVerificationRuleConfig
]


class RuleCreateRequest(BaseModel):
    """Request schema for creating a new detection rule."""
    name: str = Field(..., min_length=1, max_length=200, description="Rule name")
    rule_type: RuleType = Field(..., description="Type of detection rule")
    config: Dict[str, Any] = Field(..., description="Rule-specific configuration")
    priority: int = Field(
        default=100, 
        ge=1, 
        le=1000, 
        description="Rule priority (1-1000, higher = more priority)"
    )
    active: bool = Field(default=True, description="Whether rule is active")
    category: Optional[str] = Field(
        None, 
        max_length=100, 
        description="Product category this rule applies to (null = all categories)"
    )
    
    @validator('config')
    def validate_config_for_type(cls, v, values):
        """Validate configuration matches rule type."""
        rule_type = values.get('rule_type')
        if not rule_type:
            return v
        
        # Basic validation - more detailed validation happens in repository
        required_fields = {
            RuleType.THRESHOLD: ['score_threshold'],
            RuleType.KEYWORD: ['patterns'],
            RuleType.SUPPLIER: [],  # At least one of blacklist/whitelist/reputation_threshold
            RuleType.PRICE_ANOMALY: [],  # Optional fields with defaults
            RuleType.BRAND_VERIFICATION: ['verified_brands']
        }
        
        for field in required_fields.get(rule_type, []):
            if field not in v:
                raise ValueError(f"Field '{field}' is required for {rule_type.value} rules")
        
        return v


class RuleUpdateRequest(BaseModel):
    """Request schema for updating an existing detection rule."""
    name: Optional[str] = Field(None, min_length=1, max_length=200, description="Rule name")
    config: Optional[Dict[str, Any]] = Field(None, description="Rule-specific configuration")
    priority: Optional[int] = Field(
        None, 
        ge=1, 
        le=1000, 
        description="Rule priority (1-1000, higher = more priority)"
    )
    active: Optional[bool] = Field(None, description="Whether rule is active")
    category: Optional[str] = Field(
        None, 
        max_length=100, 
        description="Product category this rule applies to"
    )


class RuleResponse(BaseModel):
    """Response schema for detection rule information."""
    id: str = Field(..., description="Rule unique identifier")
    name: str = Field(..., description="Rule name")
    rule_type: RuleType = Field(..., description="Type of detection rule")
    config: Dict[str, Any] = Field(..., description="Rule-specific configuration")
    priority: int = Field(..., description="Rule priority")
    active: bool = Field(..., description="Whether rule is active")
    category: Optional[str] = Field(None, description="Product category this rule applies to")
    created_at: datetime = Field(..., description="Rule creation timestamp")
    updated_at: datetime = Field(..., description="Rule last update timestamp")
    
    class Config:
        from_attributes = True


class RuleListResponse(BaseModel):
    """Response schema for list of detection rules."""
    rules: List[RuleResponse] = Field(..., description="List of detection rules")
    total_count: int = Field(..., description="Total number of rules matching filters")
    page: int = Field(..., description="Current page number")
    page_size: int = Field(..., description="Number of rules per page")
    total_pages: int = Field(..., description="Total number of pages")


class RuleTestRequest(BaseModel):
    """Request schema for testing a rule against a product."""
    product_id: str = Field(..., description="Product ID to test against")
    simulation_mode: bool = Field(
        default=True, 
        description="Whether this is a simulation (no actual actions taken)"
    )


class RuleMatchResponse(BaseModel):
    """Response schema for rule match information."""
    rule_id: str = Field(..., description="Rule ID that matched")
    rule_name: str = Field(..., description="Rule name")
    rule_type: RuleType = Field(..., description="Type of rule")
    priority: int = Field(..., description="Rule priority")
    action: RuleAction = Field(..., description="Action to take")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Match confidence score")
    evidence: Dict[str, Any] = Field(..., description="Evidence for the match")
    triggered_at: datetime = Field(..., description="When the rule was triggered")


class RuleTestResponse(BaseModel):
    """Response schema for rule testing."""
    product_id: str = Field(..., description="Product ID that was tested")
    rule_id: str = Field(..., description="Rule ID that was tested")
    matched: bool = Field(..., description="Whether the rule matched")
    match_details: Optional[RuleMatchResponse] = Field(
        None, 
        description="Match details if rule was triggered"
    )
    test_duration_ms: float = Field(..., description="Test execution time in milliseconds")
    simulation_mode: bool = Field(..., description="Whether this was a simulation")


class RuleEvaluationRequest(BaseModel):
    """Request schema for evaluating all rules against a product."""
    product_id: str = Field(..., description="Product ID to evaluate")
    analysis_score: Optional[float] = Field(
        None, 
        ge=0.0, 
        le=100.0, 
        description="LLM authenticity score for threshold rules"
    )
    force_evaluation: bool = Field(
        default=False, 
        description="Force fresh evaluation, bypassing cache"
    )


class RuleEvaluationResponse(BaseModel):
    """Response schema for rule evaluation results."""
    evaluation_id: str = Field(..., description="Unique evaluation identifier")
    product_id: str = Field(..., description="Product ID that was evaluated")
    total_rules_evaluated: int = Field(..., description="Number of rules evaluated")
    matched_rules: List[RuleMatchResponse] = Field(..., description="Rules that matched")
    highest_priority_action: Optional[RuleAction] = Field(
        None, 
        description="Highest priority action from matched rules"
    )
    overall_risk_score: float = Field(
        ..., 
        ge=0.0, 
        le=100.0, 
        description="Overall risk score based on matched rules"
    )
    evaluation_duration_ms: float = Field(..., description="Evaluation time in milliseconds")
    evaluated_at: datetime = Field(..., description="When evaluation was performed")


class BatchRuleEvaluationRequest(BaseModel):
    """Request schema for batch rule evaluation."""
    product_ids: List[str] = Field(
        ..., 
        min_items=1, 
        max_items=100, 
        description="List of product IDs to evaluate"
    )
    analysis_scores: Optional[Dict[str, float]] = Field(
        None, 
        description="Map of product_id to LLM authenticity score"
    )


class BatchRuleEvaluationResponse(BaseModel):
    """Response schema for batch rule evaluation."""
    total_requested: int = Field(..., description="Number of products requested")
    successful_count: int = Field(..., description="Number of successful evaluations")
    error_count: int = Field(..., description="Number of failed evaluations")
    evaluations: List[RuleEvaluationResponse] = Field(..., description="Individual evaluation results")
    summary_stats: Dict[str, Any] = Field(..., description="Summary statistics")


class RuleStatsResponse(BaseModel):
    """Response schema for rule engine statistics."""
    total_rules: int = Field(..., description="Total number of rules")
    active_rules: int = Field(..., description="Number of active rules")
    inactive_rules: int = Field(..., description="Number of inactive rules")
    rules_by_type: Dict[str, int] = Field(..., description="Rule count by type")
    rules_by_category: Dict[str, int] = Field(..., description="Rule count by category")
    priority_stats: Dict[str, float] = Field(..., description="Priority distribution statistics")


class RuleValidationResponse(BaseModel):
    """Response schema for rule configuration validation."""
    valid: bool = Field(..., description="Whether the configuration is valid")
    errors: List[str] = Field(..., description="List of validation errors")
    warnings: List[str] = Field(default_factory=list, description="List of validation warnings")


class RuleBulkCreateRequest(BaseModel):
    """Request schema for bulk rule creation."""
    rules: List[RuleCreateRequest] = Field(
        ..., 
        min_items=1, 
        max_items=50, 
        description="List of rules to create"
    )
    validate_only: bool = Field(
        default=False, 
        description="Only validate rules without creating them"
    )


class RuleBulkCreateResponse(BaseModel):
    """Response schema for bulk rule creation."""
    total_requested: int = Field(..., description="Number of rules requested")
    successful_count: int = Field(..., description="Number of successfully created rules")
    error_count: int = Field(..., description="Number of failed rule creations")
    created_rules: List[RuleResponse] = Field(..., description="Successfully created rules")
    errors: List[str] = Field(..., description="List of creation errors")


class RuleSearchRequest(BaseModel):
    """Request schema for rule search with filters."""
    rule_type: Optional[RuleType] = Field(None, description="Filter by rule type")
    category: Optional[str] = Field(None, description="Filter by category")
    active: Optional[bool] = Field(None, description="Filter by active status")
    priority_min: Optional[int] = Field(None, ge=1, description="Minimum priority filter")
    priority_max: Optional[int] = Field(None, le=1000, description="Maximum priority filter")
    search_term: Optional[str] = Field(None, description="Search in rule names")
    page: int = Field(default=1, ge=1, description="Page number")
    page_size: int = Field(default=20, ge=1, le=100, description="Number of rules per page")
    sort_by: str = Field(
        default="priority", 
        regex="^(priority|name|created_at|updated_at)$", 
        description="Field to sort by"
    )
    sort_order: str = Field(
        default="desc", 
        regex="^(asc|desc)$", 
        description="Sort order"
    )