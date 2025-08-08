"""
Pydantic schemas for enforcement API endpoints.

This module contains request and response models for enforcement
rule management, action execution, and appeals.
"""

from datetime import datetime
from decimal import Decimal
from typing import Dict, List, Optional, Any
from uuid import uuid4

from pydantic import BaseModel, Field, validator

from ...models.enums import EnforcementAction, EnforcementStatus, AppealStatus


# Base schemas
class EnforcementRuleBase(BaseModel):
    """Base schema for enforcement rules."""
    
    rule_name: str = Field(..., min_length=1, max_length=200, description="Name of the enforcement rule")
    score_min: int = Field(..., ge=0, le=100, description="Minimum authenticity score for rule application")
    score_max: int = Field(..., ge=0, le=100, description="Maximum authenticity score for rule application")
    category: Optional[str] = Field(None, max_length=100, description="Product category for rule application")
    action_type: EnforcementAction = Field(..., description="Action to take when rule matches")
    requires_human_approval: bool = Field(False, description="Whether action requires human approval")
    priority: int = Field(100, ge=1, le=1000, description="Rule priority (lower number = higher priority)")
    active: bool = Field(True, description="Whether rule is active")
    
    @validator('score_max')
    def score_max_must_be_greater_than_min(cls, v, values):
        if 'score_min' in values and v < values['score_min']:
            raise ValueError('score_max must be greater than or equal to score_min')
        return v


class EnforcementRuleCreate(EnforcementRuleBase):
    """Schema for creating enforcement rules."""
    pass


class EnforcementRuleUpdate(BaseModel):
    """Schema for updating enforcement rules."""
    
    rule_name: Optional[str] = Field(None, min_length=1, max_length=200)
    score_min: Optional[int] = Field(None, ge=0, le=100)
    score_max: Optional[int] = Field(None, ge=0, le=100)
    category: Optional[str] = Field(None, max_length=100)
    action_type: Optional[EnforcementAction] = None
    requires_human_approval: Optional[bool] = None
    priority: Optional[int] = Field(None, ge=1, le=1000)
    active: Optional[bool] = None


class EnforcementRuleResponse(EnforcementRuleBase):
    """Schema for enforcement rule responses."""
    
    id: str = Field(..., description="Rule identifier")
    created_at: datetime = Field(..., description="Rule creation timestamp")
    
    class Config:
        from_attributes = True


# Enforcement Action schemas
class EnforcementActionBase(BaseModel):
    """Base schema for enforcement actions."""
    
    product_id: str = Field(..., description="Product identifier")
    action_type: EnforcementAction = Field(..., description="Type of enforcement action")
    authenticity_score: int = Field(..., ge=0, le=100, description="Product authenticity score")
    confidence_score: float = Field(..., ge=0.0, le=1.0, description="Analysis confidence score")
    reasoning: str = Field(..., min_length=1, description="Reasoning for the action")
    rule_id: Optional[str] = Field(None, description="ID of rule that triggered the action")


class EnforcementActionCreate(EnforcementActionBase):
    """Schema for creating enforcement actions."""
    
    priority_override: bool = Field(False, description="Override normal priority rules")
    supplier_id: Optional[str] = Field(None, description="Supplier identifier for notifications")


class ManualEnforcementRequest(BaseModel):
    """Schema for manual enforcement action requests."""
    
    product_id: str = Field(..., description="Product identifier")
    action_type: EnforcementAction = Field(..., description="Type of enforcement action")
    reason: str = Field(..., min_length=1, description="Reason for manual action")
    override_rules: bool = Field(False, description="Override automatic rules")
    executed_by: str = Field(..., description="User ID executing the action")


class EnforcementActionResponse(EnforcementActionBase):
    """Schema for enforcement action responses."""
    
    id: str = Field(..., description="Action identifier")
    executed_by: str = Field(..., description="Agent or user that executed the action")
    execution_status: EnforcementStatus = Field(..., description="Current execution status")
    platform_response: Optional[Dict[str, Any]] = Field(None, description="Platform API response")
    appeal_status: AppealStatus = Field(..., description="Current appeal status")
    created_at: datetime = Field(..., description="Action creation timestamp")
    completed_at: Optional[datetime] = Field(None, description="Action completion timestamp")
    
    class Config:
        from_attributes = True


# Batch operations
class BatchEnforcementRequest(BaseModel):
    """Schema for batch enforcement requests."""
    
    actions: List[EnforcementActionCreate] = Field(..., min_items=1, max_items=100)
    batch_reason: Optional[str] = Field(None, description="Reason for batch operation")


class BatchEnforcementResponse(BaseModel):
    """Schema for batch enforcement responses."""
    
    batch_id: str = Field(default_factory=lambda: str(uuid4()))
    total_actions: int = Field(..., description="Total number of actions in batch")
    successful_actions: int = Field(..., description="Number of successful actions")
    failed_actions: int = Field(..., description="Number of failed actions")
    pending_approval: int = Field(..., description="Number of actions pending approval")
    results: List[EnforcementActionResponse] = Field(..., description="Individual action results")
    processing_duration_ms: float = Field(..., description="Total processing time in milliseconds")
    created_at: datetime = Field(default_factory=datetime.utcnow)


# Appeals schemas
class AppealSubmission(BaseModel):
    """Schema for appeal submissions."""
    
    action_id: str = Field(..., description="ID of the enforcement action being appealed")
    reason: str = Field(..., min_length=10, description="Detailed reason for the appeal")
    evidence_urls: List[str] = Field(default_factory=list, description="URLs to supporting evidence")
    supplier_contact: Optional[str] = Field(None, description="Supplier contact information")


class AppealReview(BaseModel):
    """Schema for appeal reviews."""
    
    action_id: str = Field(..., description="ID of the enforcement action")
    decision: AppealStatus = Field(..., description="Appeal decision")
    reviewer_comments: str = Field(..., min_length=1, description="Reviewer comments")
    reviewed_by: str = Field(..., description="User ID of reviewer")


class AppealResponse(BaseModel):
    """Schema for appeal responses."""
    
    appeal_id: str = Field(..., description="Appeal identifier")
    action_id: str = Field(..., description="Related enforcement action ID")
    status: AppealStatus = Field(..., description="Current appeal status")
    reason: str = Field(..., description="Appeal reason")
    evidence_urls: List[str] = Field(..., description="Supporting evidence URLs")
    reviewer_comments: Optional[str] = Field(None, description="Reviewer comments")
    submitted_at: datetime = Field(..., description="Appeal submission timestamp")
    reviewed_at: Optional[datetime] = Field(None, description="Appeal review timestamp")
    reviewed_by: Optional[str] = Field(None, description="Reviewer user ID")
    
    class Config:
        from_attributes = True


# Supplier reputation schemas
class SupplierReputationResponse(BaseModel):
    """Schema for supplier reputation responses."""
    
    supplier_id: str = Field(..., description="Supplier identifier")
    total_products: int = Field(..., description="Total products from supplier")
    flagged_products: int = Field(..., description="Number of flagged products")
    takedown_count: int = Field(..., description="Number of takedown actions")
    appeal_success_rate: float = Field(..., description="Rate of successful appeals")
    reputation_score: float = Field(..., description="Overall reputation score (0.0-1.0)")
    last_violation_date: Optional[datetime] = Field(None, description="Date of last violation")
    updated_at: datetime = Field(..., description="Last update timestamp")
    
    class Config:
        from_attributes = True


# Statistics and analytics schemas
class EnforcementStatistics(BaseModel):
    """Schema for enforcement statistics."""
    
    total_actions: int = Field(..., description="Total number of enforcement actions")
    successful_actions: int = Field(..., description="Number of successful actions")
    failed_actions: int = Field(..., description="Number of failed actions")
    pending_actions: int = Field(..., description="Number of pending actions")
    pending_approval: int = Field(..., description="Number of actions pending approval")
    success_rate: float = Field(..., description="Success rate percentage")
    actions_by_type: Dict[str, int] = Field(..., description="Actions grouped by type")
    actions_by_status: Dict[str, int] = Field(..., description="Actions grouped by status")
    average_authenticity_score: float = Field(..., description="Average authenticity score")
    average_confidence_score: float = Field(..., description="Average confidence score")
    analysis_period_days: int = Field(..., description="Number of days analyzed")


class DailyEnforcementTrend(BaseModel):
    """Schema for daily enforcement trends."""
    
    date: str = Field(..., description="Date in ISO format")
    total_actions: int = Field(..., description="Total actions on this date")
    successful_actions: int = Field(..., description="Successful actions on this date")
    success_rate: float = Field(..., description="Success rate for this date")


class EnforcementTrendsResponse(BaseModel):
    """Schema for enforcement trends response."""
    
    trends: List[DailyEnforcementTrend] = Field(..., description="Daily trend data")
    period_days: int = Field(..., description="Number of days in analysis period")
    generated_at: datetime = Field(default_factory=datetime.utcnow)


# Rule evaluation schemas
class ActionEvaluationRequest(BaseModel):
    """Schema for action evaluation requests."""
    
    product_id: str = Field(..., description="Product identifier")
    authenticity_score: int = Field(..., ge=0, le=100, description="Product authenticity score")
    confidence_score: float = Field(..., ge=0.0, le=1.0, description="Analysis confidence score")
    category: Optional[str] = Field(None, description="Product category")
    supplier_id: Optional[str] = Field(None, description="Supplier identifier")


class ActionEvaluationResponse(BaseModel):
    """Schema for action evaluation responses."""
    
    product_id: str = Field(..., description="Product identifier")
    recommended_action: EnforcementAction = Field(..., description="Recommended enforcement action")
    requires_approval: bool = Field(..., description="Whether action requires human approval")
    matching_rules: List[str] = Field(..., description="List of matching rule IDs")
    reasoning: str = Field(..., description="Explanation for the recommendation")
    confidence_adjustment: Optional[str] = Field(None, description="Confidence-based adjustments made")
    supplier_adjustment: Optional[str] = Field(None, description="Supplier reputation adjustments made")


# Rollback schemas
class RollbackRequest(BaseModel):
    """Schema for action rollback requests."""
    
    action_id: str = Field(..., description="ID of action to rollback")
    reason: str = Field(..., min_length=1, description="Reason for rollback")
    executed_by: str = Field(..., description="User ID executing the rollback")


class RollbackResponse(BaseModel):
    """Schema for rollback responses."""
    
    action_id: str = Field(..., description="ID of action that was rolled back")
    rollback_successful: bool = Field(..., description="Whether rollback was successful")
    rollback_reason: str = Field(..., description="Reason for rollback")
    rollback_timestamp: datetime = Field(default_factory=datetime.utcnow)
    platform_response: Optional[Dict[str, Any]] = Field(None, description="Platform response to rollback")