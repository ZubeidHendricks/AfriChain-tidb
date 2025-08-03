"""
Pydantic schemas for authenticity analysis API endpoints.
"""

from typing import List, Optional, Dict, Any
from uuid import UUID
from datetime import datetime

from pydantic import BaseModel, Field, validator


class AnalysisOptions(BaseModel):
    """Options for customizing analysis behavior."""
    
    include_image_analysis: bool = Field(
        True,
        description="Whether to include image-based analysis"
    )
    include_price_analysis: bool = Field(
        True,
        description="Whether to include price reasonableness analysis"
    )
    similarity_threshold: float = Field(
        0.7,
        ge=0.0,
        le=1.0,
        description="Minimum similarity threshold for product comparison"
    )
    comparison_product_limit: int = Field(
        10,
        ge=1,
        le=50,
        description="Number of similar products to retrieve for comparison"
    )
    llm_temperature: float = Field(
        0.1,
        ge=0.0,
        le=1.0,
        description="LLM temperature for analysis consistency"
    )


class AnalysisRequest(BaseModel):
    """Request model for single product authenticity analysis."""
    
    product_id: UUID = Field(..., description="Product ID to analyze")
    force_reanalysis: bool = Field(
        False,
        description="Force new analysis even if recent analysis exists"
    )
    analysis_options: Optional[AnalysisOptions] = Field(
        None,
        description="Custom analysis options"
    )
    priority: str = Field(
        "normal",
        regex="^(low|normal|high|urgent)$",
        description="Analysis priority level"
    )


class BatchAnalysisRequest(BaseModel):
    """Request model for batch product authenticity analysis."""
    
    product_ids: List[UUID] = Field(
        ...,
        min_items=1,
        max_items=100,
        description="List of product IDs to analyze"
    )
    force_reanalysis: bool = Field(
        False,
        description="Force new analysis even if recent analysis exists"
    )
    analysis_options: Optional[AnalysisOptions] = Field(
        None,
        description="Custom analysis options applied to all products"
    )
    priority: str = Field(
        "normal",
        regex="^(low|normal|high|urgent)$",
        description="Analysis priority level for all products"
    )


class AnalysisResponse(BaseModel):
    """Response model for authenticity analysis results."""
    
    analysis_id: str = Field(..., description="Unique analysis identifier")
    product_id: str = Field(..., description="Product ID that was analyzed")
    status: str = Field(
        ...,
        description="Analysis status (queued, in_progress, completed, failed)"
    )
    authenticity_score: Optional[float] = Field(
        None,
        ge=0.0,
        le=100.0,
        description="Authenticity score (0-100, higher is more authentic)"
    )
    confidence_score: Optional[float] = Field(
        None,
        ge=0.0,
        le=1.0,
        description="Confidence in the authenticity assessment (0.0-1.0)"
    )
    reasoning: Optional[str] = Field(
        None,
        description="Detailed explanation of the scoring decision"
    )
    red_flags: List[str] = Field(
        default_factory=list,
        description="List of concerning authenticity indicators"
    )
    positive_indicators: List[str] = Field(
        default_factory=list,
        description="List of positive authenticity signals"
    )
    component_scores: Dict[str, float] = Field(
        default_factory=dict,
        description="Individual component scores"
    )
    comparison_products: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Similar products used for comparison"
    )
    analysis_duration_ms: float = Field(
        ...,
        ge=0.0,
        description="Analysis processing time in milliseconds"
    )
    llm_model: Optional[str] = Field(
        None,
        description="LLM model used for analysis"
    )
    agent_id: Optional[str] = Field(
        None,
        description="ID of the agent that performed the analysis"
    )
    requires_manual_review: Optional[bool] = Field(
        None,
        description="Whether this analysis requires manual review"
    )
    created_at: Optional[str] = Field(
        None,
        description="Analysis creation timestamp"
    )
    message: str = Field(
        ...,
        description="Status message or additional information"
    )
    
    class Config:
        schema_extra = {
            "example": {
                "analysis_id": "550e8400-e29b-41d4-a716-446655440000",
                "product_id": "550e8400-e29b-41d4-a716-446655440001",
                "status": "completed",
                "authenticity_score": 75.5,
                "confidence_score": 0.89,
                "reasoning": "Product shows consistent branding and pricing with authentic items. Description quality is good with specific technical details. Price point is reasonable for the category.",
                "red_flags": ["Generic supplier information", "Limited product history"],
                "positive_indicators": ["Detailed technical specifications", "Consistent branding", "Reasonable pricing"],
                "component_scores": {
                    "description_quality": 82.0,
                    "price_reasonableness": 78.0,
                    "supplier_trustworthiness": 65.0,
                    "overall_consistency": 81.0
                },
                "comparison_products": [
                    {
                        "product_id": "550e8400-e29b-41d4-a716-446655440002",
                        "similarity_score": 0.94,
                        "price": 299.99,
                        "brand": "AuthenticBrand"
                    }
                ],
                "analysis_duration_ms": 2847.5,
                "llm_model": "gpt-4",
                "agent_id": "authenticity-analyzer-a1b2c3d4",
                "requires_manual_review": false,
                "created_at": "2024-01-15T14:30:22Z",
                "message": "Analysis completed successfully"
            }
        }


class BatchAnalysisResponse(BaseModel):
    """Response model for batch analysis requests."""
    
    batch_id: str = Field(..., description="Unique batch identifier")
    total_requested: int = Field(
        ...,
        ge=0,
        description="Total number of products requested for analysis"
    )
    queued_count: int = Field(
        ...,
        ge=0,
        description="Number of products successfully queued for analysis"
    )
    invalid_product_ids: List[str] = Field(
        default_factory=list,
        description="Product IDs that were invalid or not found"
    )
    status: str = Field(
        ...,
        description="Batch processing status"
    )
    message: str = Field(
        ...,
        description="Status message or additional information"
    )
    estimated_completion_time: Optional[str] = Field(
        None,
        description="Estimated completion time for the batch"
    )
    
    class Config:
        schema_extra = {
            "example": {
                "batch_id": "batch-550e8400-e29b-41d4-a716-446655440000",
                "total_requested": 25,
                "queued_count": 23,
                "invalid_product_ids": [
                    "550e8400-e29b-41d4-a716-446655440099",
                    "550e8400-e29b-41d4-a716-446655440098"
                ],
                "status": "queued",
                "message": "Queued 23 products for analysis",
                "estimated_completion_time": "2024-01-15T15:00:00Z"
            }
        }


class AnalysisStatistics(BaseModel):
    """Statistics about authenticity analyses."""
    
    total_analyses: int = Field(
        ...,
        ge=0,
        description="Total number of analyses performed"
    )
    status_breakdown: Dict[str, int] = Field(
        ...,
        description="Count of analyses by status"
    )
    average_authenticity_score: float = Field(
        ...,
        ge=0.0,
        le=100.0,
        description="Average authenticity score across all analyses"
    )
    average_confidence_score: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Average confidence score across all analyses"
    )
    average_processing_time_ms: float = Field(
        ...,
        ge=0.0,
        description="Average analysis processing time in milliseconds"
    )
    requiring_manual_review: int = Field(
        ...,
        ge=0,
        description="Number of analyses requiring manual review"
    )
    suspicious_products: int = Field(
        ...,
        ge=0,
        description="Number of products with low authenticity scores"
    )
    recent_analyses_24h: int = Field(
        ...,
        ge=0,
        description="Number of analyses performed in the last 24 hours"
    )
    suspicious_percentage: float = Field(
        ...,
        ge=0.0,
        le=100.0,
        description="Percentage of products flagged as suspicious"
    )
    review_required_percentage: float = Field(
        ...,
        ge=0.0,
        le=100.0,
        description="Percentage of analyses requiring manual review"
    )
    
    class Config:
        schema_extra = {
            "example": {
                "total_analyses": 5420,
                "status_breakdown": {
                    "completed": 5380,
                    "failed": 25,
                    "pending": 15
                },
                "average_authenticity_score": 73.2,
                "average_confidence_score": 0.84,
                "average_processing_time_ms": 2156.7,
                "requiring_manual_review": 287,
                "suspicious_products": 423,
                "recent_analyses_24h": 156,
                "suspicious_percentage": 7.8,
                "review_required_percentage": 5.3
            }
        }


class AgentPerformanceStats(BaseModel):
    """Performance statistics for authenticity analysis agents."""
    
    agent_statistics: Dict[str, Dict[str, Any]] = Field(
        ...,
        description="Performance stats by agent ID"
    )
    total_agents: int = Field(
        ...,
        ge=0,
        description="Total number of active agents"
    )
    
    class Config:
        schema_extra = {
            "example": {
                "agent_statistics": {
                    "authenticity-analyzer-a1b2c3d4": {
                        "total_analyses": 1250,
                        "average_authenticity_score": 74.8,
                        "average_confidence_score": 0.87,
                        "average_processing_time_ms": 2234.5,
                        "manual_review_count": 67,
                        "manual_review_rate": 5.36
                    },
                    "authenticity-analyzer-e5f6g7h8": {
                        "total_analyses": 1180,
                        "average_authenticity_score": 72.1,
                        "average_confidence_score": 0.82,
                        "average_processing_time_ms": 2087.3,
                        "manual_review_count": 73,
                        "manual_review_rate": 6.19
                    }
                },
                "total_agents": 2
            }
        }


class ReviewUpdateRequest(BaseModel):
    """Request model for updating analysis review status."""
    
    reviewer: str = Field(
        ...,
        min_length=1,
        max_length=255,
        description="Name or ID of the reviewer"
    )
    notes: str = Field(
        ...,
        min_length=1,
        max_length=2000,
        description="Review notes and findings"
    )
    requires_further_review: bool = Field(
        False,
        description="Whether the analysis requires additional review"
    )
    manual_authenticity_score: Optional[float] = Field(
        None,
        ge=0.0,
        le=100.0,
        description="Manual override authenticity score if needed"
    )
    
    class Config:
        schema_extra = {
            "example": {
                "reviewer": "john.doe@company.com",
                "notes": "Reviewed product images and description. Authenticity score appears accurate based on brand guidelines and market comparison.",
                "requires_further_review": False,
                "manual_authenticity_score": None
            }
        }