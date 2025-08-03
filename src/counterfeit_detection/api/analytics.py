"""
Analytics API endpoints for accessing system metrics and performance data.

Provides REST API endpoints for the admin dashboard to access detection analytics,
performance metrics, bias monitoring, and system health information.
"""

from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, validator
import structlog

from ..core.auth import get_current_admin_user
from ..core.database import get_db_session
from ..services.analytics_service import AnalyticsService
from ..services.metrics_collector import MetricsCollector
from ..services.bias_detector import BiasDetector, BiasMetric
from ..services.performance_monitor import PerformanceMonitor
from ..models.user import User

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/analytics", tags=["analytics"])


# Request/Response Models

class DateRangeRequest(BaseModel):
    """Date range for analytics queries."""
    start_date: datetime
    end_date: datetime
    
    @validator('end_date')
    def end_date_after_start_date(cls, v, values):
        if 'start_date' in values and v <= values['start_date']:
            raise ValueError('end_date must be after start_date')
        return v


class AnalyticsFilters(BaseModel):
    """Filters for analytics queries."""
    category: Optional[str] = None
    supplier_id: Optional[str] = None
    minimum_score: Optional[float] = Field(None, ge=0, le=100)
    maximum_score: Optional[float] = Field(None, ge=0, le=100)


class DetectionAnalyticsResponse(BaseModel):
    """Response model for detection analytics."""
    period: Dict[str, Any]
    filters: Dict[str, Any]
    core_metrics: Dict[str, Any]
    target_achievement: Dict[str, Any]
    time_series: List[Dict[str, Any]]
    category_breakdown: Dict[str, Any]
    generated_at: str


class PerformanceMetricsResponse(BaseModel):
    """Response model for performance metrics."""
    period: Dict[str, Any]
    response_time: Dict[str, Any]
    throughput: Dict[str, Any]
    error_rates: Dict[str, Any]
    uptime: Dict[str, Any]
    target_achievement: Dict[str, Any]
    agent_metrics: Optional[Dict[str, Any]] = None
    generated_at: str


class BiasAnalysisResponse(BaseModel):
    """Response model for bias analysis."""
    period: Dict[str, Any]
    overall_bias_score: float
    bias_threshold: float
    bias_alert_triggered: bool
    bias_by_attribute: Dict[str, Any]
    generated_at: str


class SystemHealthResponse(BaseModel):
    """Response model for system health."""
    overall_status: str
    components: List[Dict[str, Any]]
    resource_usage: Dict[str, float]
    active_alerts: List[Dict[str, Any]]
    performance_score: float
    recommendations: List[str]
    timestamp: str


# Dependency injection

async def get_analytics_service() -> AnalyticsService:
    """Get analytics service instance."""
    return AnalyticsService()


async def get_metrics_collector() -> MetricsCollector:
    """Get metrics collector instance."""
    # In a real implementation, this would be a singleton
    return MetricsCollector()


async def get_bias_detector() -> BiasDetector:
    """Get bias detector instance."""
    return BiasDetector()


async def get_performance_monitor() -> PerformanceMonitor:
    """Get performance monitor instance."""
    return PerformanceMonitor()


# Analytics Endpoints

@router.get("/detection-rate", response_model=DetectionAnalyticsResponse)
async def get_detection_analytics(
    period: str = Query("7d", description="Time period: 1d, 7d, 30d, 90d, or custom"),
    start_date: Optional[datetime] = Query(None, description="Custom start date (ISO format)"),
    end_date: Optional[datetime] = Query(None, description="Custom end date (ISO format)"),
    category: Optional[str] = Query(None, description="Filter by product category"),
    supplier_id: Optional[str] = Query(None, description="Filter by supplier ID"),
    analytics_service: AnalyticsService = Depends(get_analytics_service),
    current_user: User = Depends(get_current_admin_user)
):
    """
    Get detection rate analytics for the specified period.
    
    Provides comprehensive detection metrics including:
    - Detection rate (targeting 85%+)
    - False positive rate
    - Precision and recall
    - Time series data
    - Category breakdown
    """
    try:
        # Parse time period
        if period == "custom":
            if not start_date or not end_date:
                raise HTTPException(
                    status_code=400,
                    detail="start_date and end_date are required for custom period"
                )
        else:
            end_date = datetime.utcnow()
            if period == "1d":
                start_date = end_date - timedelta(days=1)
            elif period == "7d":
                start_date = end_date - timedelta(days=7)
            elif period == "30d":
                start_date = end_date - timedelta(days=30)
            elif period == "90d":
                start_date = end_date - timedelta(days=90)
            else:
                raise HTTPException(status_code=400, detail="Invalid period")
        
        # Get analytics
        analytics = await analytics_service.calculate_detection_analytics(
            start_date=start_date,
            end_date=end_date,
            category_filter=category,
            supplier_filter=supplier_id
        )
        
        logger.info(
            "Detection analytics requested",
            user_id=current_user.id,
            period=period,
            category=category,
            supplier_id=supplier_id
        )
        
        return DetectionAnalyticsResponse(**analytics)
        
    except Exception as e:
        logger.error("Failed to get detection analytics", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to retrieve detection analytics")


@router.get("/false-positives", response_model=Dict[str, Any])
async def get_false_positive_analytics(
    period: str = Query("30d", description="Time period: 7d, 30d, 90d"),
    include_root_cause: bool = Query(True, description="Include root cause analysis"),
    analytics_service: AnalyticsService = Depends(get_analytics_service),
    current_user: User = Depends(get_current_admin_user)
):
    """
    Get false positive analytics and trends.
    
    Provides detailed false positive tracking including:
    - Current false positive rate vs 5% target
    - Trends by category, supplier, and detection rule
    - Root cause analysis
    - Alert status
    """
    try:
        # Parse time period
        end_date = datetime.utcnow()
        if period == "7d":
            start_date = end_date - timedelta(days=7)
        elif period == "30d":
            start_date = end_date - timedelta(days=30)
        elif period == "90d":
            start_date = end_date - timedelta(days=90)
        else:
            raise HTTPException(status_code=400, detail="Invalid period")
        
        # Get false positive analytics
        analytics = await analytics_service.calculate_false_positive_analytics(
            start_date=start_date,
            end_date=end_date,
            include_root_cause=include_root_cause
        )
        
        logger.info(
            "False positive analytics requested",
            user_id=current_user.id,
            period=period,
            include_root_cause=include_root_cause
        )
        
        return analytics
        
    except Exception as e:
        logger.error("Failed to get false positive analytics", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to retrieve false positive analytics")


@router.get("/performance", response_model=PerformanceMetricsResponse)
async def get_performance_metrics(
    period: str = Query("1h", description="Time period: 1h, 6h, 24h, 7d"),
    component: Optional[str] = Query(None, description="Filter by component name"),
    include_agent_details: bool = Query(True, description="Include detailed agent metrics"),
    analytics_service: AnalyticsService = Depends(get_analytics_service),
    current_user: User = Depends(get_current_admin_user)
):
    """
    Get system performance metrics.
    
    Provides comprehensive performance monitoring including:
    - Response times (targeting <3s per product)
    - Throughput metrics
    - Error rates
    - Uptime statistics
    - Agent performance details
    """
    try:
        # Parse time period
        end_date = datetime.utcnow()
        if period == "1h":
            start_date = end_date - timedelta(hours=1)
        elif period == "6h":
            start_date = end_date - timedelta(hours=6)
        elif period == "24h":
            start_date = end_date - timedelta(days=1)
        elif period == "7d":
            start_date = end_date - timedelta(days=7)
        else:
            raise HTTPException(status_code=400, detail="Invalid period")
        
        # Get performance metrics
        metrics = await analytics_service.calculate_performance_metrics(
            start_date=start_date,
            end_date=end_date,
            include_agent_details=include_agent_details
        )
        
        logger.info(
            "Performance metrics requested",
            user_id=current_user.id,
            period=period,
            component=component
        )
        
        return PerformanceMetricsResponse(**metrics)
        
    except Exception as e:
        logger.error("Failed to get performance metrics", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to retrieve performance metrics")


@router.get("/bias-report", response_model=BiasAnalysisResponse)
async def get_bias_analysis(
    period: str = Query("30d", description="Time period: 7d, 30d, 90d"),
    attributes: Optional[List[str]] = Query(None, description="Attributes to analyze for bias"),
    analytics_service: AnalyticsService = Depends(get_analytics_service),
    current_user: User = Depends(get_current_admin_user)
):
    """
    Get bias detection and fairness analysis.
    
    Provides comprehensive bias monitoring including:
    - Overall bias score vs 1% threshold
    - Demographic parity analysis
    - Equalized odds assessment
    - Per-attribute bias detection
    - Fairness recommendations
    """
    try:
        # Parse time period
        end_date = datetime.utcnow()
        if period == "7d":
            start_date = end_date - timedelta(days=7)
        elif period == "30d":
            start_date = end_date - timedelta(days=30)
        elif period == "90d":
            start_date = end_date - timedelta(days=90)
        else:
            raise HTTPException(status_code=400, detail="Invalid period")
        
        # Get bias analysis
        bias_metrics = await analytics_service.calculate_bias_metrics(
            start_date=start_date,
            end_date=end_date,
            protected_attributes=attributes
        )
        
        logger.info(
            "Bias analysis requested",
            user_id=current_user.id,
            period=period,
            attributes=attributes
        )
        
        return BiasAnalysisResponse(**bias_metrics)
        
    except Exception as e:
        logger.error("Failed to get bias analysis", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to retrieve bias analysis")


# Real-time Monitoring Endpoints

@router.get("/live/system-status", response_model=SystemHealthResponse)
async def get_system_status(
    performance_monitor: PerformanceMonitor = Depends(get_performance_monitor),
    current_user: User = Depends(get_current_admin_user)
):
    """
    Get real-time system health status.
    
    Provides current system status including:
    - Overall health assessment
    - Component status
    - Resource utilization
    - Active alerts
    - Performance score
    - Optimization recommendations
    """
    try:
        health = await performance_monitor.get_system_health()
        
        # Convert to response format
        response_data = {
            "overall_status": health.overall_status.value,
            "components": [
                {
                    "component_name": comp.component_name,
                    "response_time_avg": comp.response_time_avg,
                    "response_time_p95": comp.response_time_p95,
                    "response_time_p99": comp.response_time_p99,
                    "throughput": comp.throughput,
                    "error_rate": comp.error_rate,
                    "uptime_percent": comp.uptime_percent,
                    "status": comp.status.value,
                    "timestamp": comp.timestamp.isoformat()
                }
                for comp in health.components
            ],
            "resource_usage": health.resource_usage,
            "active_alerts": health.active_alerts,
            "performance_score": health.performance_score,
            "recommendations": health.recommendations,
            "timestamp": health.timestamp.isoformat()
        }
        
        logger.debug("System status requested", user_id=current_user.id)
        
        return SystemHealthResponse(**response_data)
        
    except Exception as e:
        logger.error("Failed to get system status", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to retrieve system status")


@router.get("/live/current-metrics")
async def get_current_metrics(
    metrics_collector: MetricsCollector = Depends(get_metrics_collector),
    current_user: User = Depends(get_current_admin_user)
):
    """
    Get current real-time metrics.
    
    Provides immediate metrics including:
    - Today's detection counts
    - Agent health status
    - Current processing rates
    - Real-time alerts
    """
    try:
        metrics = await metrics_collector.get_current_metrics()
        
        logger.debug("Current metrics requested", user_id=current_user.id)
        
        return JSONResponse(content=metrics)
        
    except Exception as e:
        logger.error("Failed to get current metrics", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to retrieve current metrics")


# Background Tasks and Management

@router.post("/generate-report")
async def generate_analytics_report(
    background_tasks: BackgroundTasks,
    date_range: DateRangeRequest,
    filters: Optional[AnalyticsFilters] = None,
    include_bias_analysis: bool = Query(True, description="Include bias analysis in report"),
    analytics_service: AnalyticsService = Depends(get_analytics_service),
    current_user: User = Depends(get_current_admin_user)
):
    """
    Generate comprehensive analytics report (background task).
    
    Creates a detailed report including:
    - Detection analytics
    - Performance metrics
    - Bias analysis
    - Compliance data
    - Executive summary
    """
    try:
        # Add background task for report generation
        background_tasks.add_task(
            _generate_analytics_report_task,
            analytics_service,
            date_range.start_date,
            date_range.end_date,
            filters,
            include_bias_analysis,
            current_user.id
        )
        
        logger.info(
            "Analytics report generation started",
            user_id=current_user.id,
            start_date=date_range.start_date,
            end_date=date_range.end_date
        )
        
        return {"message": "Report generation started", "status": "accepted"}
        
    except Exception as e:
        logger.error("Failed to start report generation", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to start report generation")


@router.get("/reports/{report_id}")
async def get_report_status(
    report_id: str,
    current_user: User = Depends(get_current_admin_user)
):
    """Get the status of a generated report."""
    # Implementation would check report generation status
    # This is a placeholder for the actual implementation
    return {"report_id": report_id, "status": "completed", "download_url": f"/analytics/reports/{report_id}/download"}


# Background Task Functions

async def _generate_analytics_report_task(
    analytics_service: AnalyticsService,
    start_date: datetime,
    end_date: datetime,
    filters: Optional[AnalyticsFilters],
    include_bias_analysis: bool,
    user_id: str
):
    """Background task to generate comprehensive analytics report."""
    try:
        # Generate detection analytics
        detection_analytics = await analytics_service.calculate_detection_analytics(
            start_date=start_date,
            end_date=end_date,
            category_filter=filters.category if filters else None,
            supplier_filter=filters.supplier_id if filters else None
        )
        
        # Generate performance metrics
        performance_metrics = await analytics_service.calculate_performance_metrics(
            start_date=start_date,
            end_date=end_date,
            include_agent_details=True
        )
        
        # Generate bias analysis if requested
        bias_analysis = None
        if include_bias_analysis:
            bias_analysis = await analytics_service.calculate_bias_metrics(
                start_date=start_date,
                end_date=end_date
            )
        
        # Compile report
        report = {
            "generated_at": datetime.utcnow().isoformat(),
            "generated_by": user_id,
            "period": {
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat()
            },
            "detection_analytics": detection_analytics,
            "performance_metrics": performance_metrics,
            "bias_analysis": bias_analysis,
            "filters": filters.dict() if filters else None
        }
        
        # Save report (implementation would save to database or file storage)
        logger.info("Analytics report generated successfully", user_id=user_id)
        
    except Exception as e:
        logger.error("Failed to generate analytics report", user_id=user_id, error=str(e))


# WebSocket endpoint for real-time updates (placeholder)
# In a full implementation, this would provide real-time metric updates
# @router.websocket("/live/updates")
# async def websocket_live_updates(websocket: WebSocket):
#     await websocket.accept()
#     # Implementation for real-time metric streaming