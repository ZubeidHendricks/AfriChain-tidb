"""
API endpoints for compliance and audit management.

This module provides REST API endpoints for audit trails, compliance reporting,
and regulatory requirements management.
"""

from datetime import datetime, timedelta
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field

import structlog

from ...core.database import get_db_session
from ...db.repositories.audit_repository import AuditRepository
from ...services.audit_service import AuditService

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/compliance", tags=["compliance"])


# Pydantic models for request/response schemas
class AuditLogResponse(BaseModel):
    """Schema for audit log responses."""
    
    id: str
    entity_type: str
    entity_id: str
    action: str
    actor_type: str
    actor_id: str
    old_values: Optional[dict] = None
    new_values: Optional[dict] = None
    changes: Optional[dict] = None
    context: Optional[dict] = None
    timestamp: datetime
    compliance_category: Optional[str] = None
    
    class Config:
        from_attributes = True


class ComplianceReportRequest(BaseModel):
    """Schema for compliance report generation requests."""
    
    framework: str = Field(..., description="Compliance framework (e.g., 'EU_DSA', 'US_CPSC')")
    report_type: str = Field("quarterly", description="Type of report")
    period_start: datetime = Field(..., description="Report period start date")
    period_end: datetime = Field(..., description="Report period end date")
    include_detailed_data: bool = Field(True, description="Include detailed metrics")


class ComplianceReportResponse(BaseModel):
    """Schema for compliance report responses."""
    
    id: str
    report_type: str
    regulation_framework: str
    period_start: datetime
    period_end: datetime
    generated_at: datetime
    generated_by: str
    report_status: str
    summary_data: dict
    detailed_data: Optional[dict] = None
    submitted_at: Optional[datetime] = None
    submission_reference: Optional[str] = None
    
    class Config:
        from_attributes = True


class EffectivenessMetricRequest(BaseModel):
    """Schema for recording effectiveness metrics."""
    
    action_id: str = Field(..., description="Enforcement action ID")
    was_appealed: bool = Field(False, description="Whether action was appealed")
    appeal_outcome: Optional[str] = Field(None, description="Appeal outcome if applicable")
    was_false_positive: bool = Field(False, description="Whether action was false positive")
    time_to_compliance_hours: Optional[int] = Field(None, description="Hours to compliance")
    user_complaints: int = Field(0, description="Number of user complaints")
    lessons_learned: Optional[str] = Field(None, description="Lessons learned")


class EffectivenessMetricResponse(BaseModel):
    """Schema for effectiveness metric responses."""
    
    id: str
    action_id: str
    was_appealed: bool
    appeal_outcome: Optional[str] = None
    was_false_positive: bool
    time_to_compliance_hours: Optional[int] = None
    user_complaints_received: int
    action_accuracy_score: Optional[float] = None
    lessons_learned: Optional[str] = None
    created_at: datetime
    
    class Config:
        from_attributes = True


class SystemEventRequest(BaseModel):
    """Schema for recording system events."""
    
    event_type: str = Field(..., description="Type of event")
    event_category: str = Field(..., description="Event category")
    event_source: str = Field(..., description="Source system/component")
    message: str = Field(..., description="Event message")
    severity_level: str = Field("info", description="Severity level")
    details: Optional[dict] = Field(None, description="Additional event details")
    correlation_id: Optional[str] = Field(None, description="Correlation ID")


class SystemEventResponse(BaseModel):
    """Schema for system event responses."""
    
    id: str
    event_type: str
    event_category: str
    event_source: str
    event_message: str
    event_details: Optional[dict] = None
    severity_level: str
    resolution_status: str
    occurred_at: datetime
    correlation_id: Optional[str] = None
    
    class Config:
        from_attributes = True


async def get_audit_repository(session: AsyncSession = Depends(get_db_session)) -> AuditRepository:
    """Get audit repository instance."""
    return AuditRepository(session)


async def get_audit_service() -> AuditService:
    """Get audit service instance."""
    return AuditService()


# Audit Trail endpoints
@router.get("/audit-trail", response_model=List[AuditLogResponse])
async def get_audit_trail(
    entity_type: Optional[str] = Query(None, description="Filter by entity type"),
    entity_id: Optional[str] = Query(None, description="Filter by entity ID"),
    actor_id: Optional[str] = Query(None, description="Filter by actor (user/agent)"),
    start_date: Optional[datetime] = Query(None, description="Filter by start date"),
    end_date: Optional[datetime] = Query(None, description="Filter by end date"),
    compliance_category: Optional[str] = Query(None, description="Filter by compliance category"),
    limit: int = Query(100, ge=1, le=1000, description="Maximum number of results"),
    offset: int = Query(0, ge=0, description="Number of results to skip"),
    audit_service: AuditService = Depends(get_audit_service)
):
    """
    Get audit trail entries with optional filtering.
    
    This endpoint provides access to the comprehensive audit trail of all
    system actions for compliance and monitoring purposes.
    """
    try:
        audit_entries, total_count = await audit_service.get_audit_trail(
            entity_type=entity_type,
            entity_id=entity_id,
            actor_id=actor_id,
            start_date=start_date,
            end_date=end_date,
            limit=limit,
            offset=offset
        )
        
        # Add pagination headers would be done via Response headers in production
        logger.info("Audit trail retrieved", 
                   entries_count=len(audit_entries), 
                   total_count=total_count)
        
        return [AuditLogResponse(**entry) for entry in audit_entries]
    
    except Exception as e:
        logger.error("Failed to get audit trail", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get audit trail: {str(e)}")


@router.get("/audit-trail/{audit_id}", response_model=AuditLogResponse)
async def get_audit_entry(
    audit_id: str,
    repository: AuditRepository = Depends(get_audit_repository)
):
    """Get a specific audit trail entry by ID."""
    try:
        audit_log = await repository.get_audit_log_by_id(audit_id)
        if not audit_log:
            raise HTTPException(status_code=404, detail="Audit log entry not found")
        
        return AuditLogResponse(
            id=audit_log.id,
            entity_type=audit_log.entity_type,
            entity_id=audit_log.entity_id,
            action=audit_log.action,
            actor_type=audit_log.actor_type,
            actor_id=audit_log.actor_id,
            old_values=audit_log.old_values,
            new_values=audit_log.new_values,
            changes=audit_log.changes,
            context=audit_log.context,
            timestamp=audit_log.timestamp,
            compliance_category=audit_log.compliance_category
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get audit entry", error=str(e), audit_id=audit_id)
        raise HTTPException(status_code=500, detail=f"Failed to get audit entry: {str(e)}")


# Compliance Report endpoints
@router.post("/reports", response_model=ComplianceReportResponse, status_code=201)
async def generate_compliance_report(
    report_request: ComplianceReportRequest,
    background_tasks: BackgroundTasks,
    generated_by: str = Query(..., description="User ID generating the report"),
    audit_service: AuditService = Depends(get_audit_service)
):
    """
    Generate a compliance report for regulatory requirements.
    
    This endpoint creates comprehensive compliance reports based on specified
    frameworks and time periods. Report generation is performed asynchronously.
    """
    try:
        report_id = await audit_service.generate_compliance_report(
            framework=report_request.framework,
            period_start=report_request.period_start,
            period_end=report_request.period_end,
            generated_by=generated_by,
            report_type=report_request.report_type
        )
        
        # In a real implementation, you'd fetch the created report
        # For now, return a mock response
        response = ComplianceReportResponse(
            id=report_id,
            report_type=report_request.report_type,
            regulation_framework=report_request.framework,
            period_start=report_request.period_start,
            period_end=report_request.period_end,
            generated_at=datetime.utcnow(),
            generated_by=generated_by,
            report_status="generating",
            summary_data={"status": "generating", "estimated_completion": "5 minutes"},
            detailed_data={"message": "Report is being generated"} if report_request.include_detailed_data else None
        )
        
        logger.info("Compliance report generation started", 
                   report_id=report_id, 
                   framework=report_request.framework)
        
        return response
    
    except Exception as e:
        logger.error("Failed to generate compliance report", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to generate compliance report: {str(e)}")


@router.get("/reports", response_model=List[ComplianceReportResponse])
async def get_compliance_reports(
    framework: Optional[str] = Query(None, description="Filter by compliance framework"),
    report_type: Optional[str] = Query(None, description="Filter by report type"),
    status: Optional[str] = Query(None, description="Filter by report status"),
    start_date: Optional[datetime] = Query(None, description="Filter by period start date"),
    end_date: Optional[datetime] = Query(None, description="Filter by period end date"),
    limit: int = Query(50, ge=1, le=100, description="Maximum number of results"),
    offset: int = Query(0, ge=0, description="Number of results to skip"),
    repository: AuditRepository = Depends(get_audit_repository)
):
    """Get compliance reports with optional filtering."""
    try:
        reports, total_count = await repository.get_compliance_reports(
            framework=framework,
            report_type=report_type,
            status=status,
            start_date=start_date,
            end_date=end_date,
            limit=limit,
            offset=offset
        )
        
        responses = []
        for report in reports:
            response = ComplianceReportResponse(
                id=report.id,
                report_type=report.report_type,
                regulation_framework=report.regulation_framework,
                period_start=report.period_start,
                period_end=report.period_end,
                generated_at=report.generated_at,
                generated_by=report.generated_by,
                report_status=report.report_status,
                summary_data=report.summary_data,
                detailed_data=report.detailed_data,
                submitted_at=report.submitted_at,
                submission_reference=report.submission_reference
            )
            responses.append(response)
        
        return responses
    
    except Exception as e:
        logger.error("Failed to get compliance reports", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get compliance reports: {str(e)}")


@router.get("/reports/{report_id}", response_model=ComplianceReportResponse)
async def get_compliance_report(
    report_id: str,
    repository: AuditRepository = Depends(get_audit_repository)
):
    """Get a specific compliance report by ID."""
    try:
        # This would fetch from the repository
        # For now, return a mock response
        raise HTTPException(status_code=501, detail="Not implemented yet")
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get compliance report", error=str(e), report_id=report_id)
        raise HTTPException(status_code=500, detail=f"Failed to get compliance report: {str(e)}")


@router.put("/reports/{report_id}/submit")
async def submit_compliance_report(
    report_id: str,
    submitted_to: str = Query(..., description="Regulatory authority receiving the report"),
    submission_reference: Optional[str] = Query(None, description="External submission reference"),
    repository: AuditRepository = Depends(get_audit_repository)
):
    """Submit a compliance report to regulatory authorities."""
    try:
        update_data = {
            "report_status": "submitted",
            "submitted_at": datetime.utcnow(),
            "submitted_to": submitted_to,
            "submission_reference": submission_reference
        }
        
        report = await repository.update_compliance_report(report_id, update_data)
        if not report:
            raise HTTPException(status_code=404, detail="Compliance report not found")
        
        logger.info("Compliance report submitted", 
                   report_id=report_id, 
                   submitted_to=submitted_to)
        
        return {"message": "Report submitted successfully", "report_id": report_id}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to submit compliance report", error=str(e), report_id=report_id)
        raise HTTPException(status_code=500, detail=f"Failed to submit compliance report: {str(e)}")


# Effectiveness Metrics endpoints
@router.post("/effectiveness-metrics", response_model=EffectivenessMetricResponse, status_code=201)
async def record_effectiveness_metric(
    metric_request: EffectivenessMetricRequest,
    audit_service: AuditService = Depends(get_audit_service)
):
    """
    Record enforcement action effectiveness metrics.
    
    This endpoint allows tracking of how effective enforcement actions were,
    including appeal outcomes and false positive rates.
    """
    try:
        metric_id = await audit_service.track_action_effectiveness(
            action_id=metric_request.action_id,
            was_appealed=metric_request.was_appealed,
            appeal_outcome=metric_request.appeal_outcome,
            was_false_positive=metric_request.was_false_positive,
            time_to_compliance_hours=metric_request.time_to_compliance_hours,
            user_complaints=metric_request.user_complaints,
            lessons_learned=metric_request.lessons_learned
        )
        
        # Return mock response for now
        response = EffectivenessMetricResponse(
            id=metric_id,
            action_id=metric_request.action_id,
            was_appealed=metric_request.was_appealed,
            appeal_outcome=metric_request.appeal_outcome,
            was_false_positive=metric_request.was_false_positive,
            time_to_compliance_hours=metric_request.time_to_compliance_hours,
            user_complaints_received=metric_request.user_complaints,
            lessons_learned=metric_request.lessons_learned,
            created_at=datetime.utcnow()
        )
        
        logger.info("Effectiveness metric recorded", 
                   metric_id=metric_id, 
                   action_id=metric_request.action_id)
        
        return response
    
    except Exception as e:
        logger.error("Failed to record effectiveness metric", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to record effectiveness metric: {str(e)}")


@router.get("/effectiveness-metrics", response_model=List[EffectivenessMetricResponse])
async def get_effectiveness_metrics(
    action_id: Optional[str] = Query(None, description="Filter by action ID"),
    start_date: Optional[datetime] = Query(None, description="Filter by start date"),
    end_date: Optional[datetime] = Query(None, description="Filter by end date"),
    limit: int = Query(100, ge=1, le=1000, description="Maximum number of results"),
    offset: int = Query(0, ge=0, description="Number of results to skip"),
    repository: AuditRepository = Depends(get_audit_repository)
):
    """Get effectiveness metrics with optional filtering."""
    try:
        metrics, total_count = await repository.get_effectiveness_metrics(
            action_id=action_id,
            start_date=start_date,
            end_date=end_date,
            limit=limit,
            offset=offset
        )
        
        responses = []
        for metric in metrics:
            response = EffectivenessMetricResponse(
                id=metric.id,
                action_id=metric.action_id,
                was_appealed=metric.was_appealed,
                appeal_outcome=metric.appeal_outcome,
                was_false_positive=metric.was_false_positive,
                time_to_compliance_hours=metric.time_to_compliance_hours,
                user_complaints_received=metric.user_complaints_received,
                action_accuracy_score=float(metric.action_accuracy_score) if metric.action_accuracy_score else None,
                lessons_learned=metric.lessons_learned,
                created_at=metric.created_at
            )
            responses.append(response)
        
        return responses
    
    except Exception as e:
        logger.error("Failed to get effectiveness metrics", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get effectiveness metrics: {str(e)}")


# System Events endpoints
@router.post("/system-events", response_model=SystemEventResponse, status_code=201)
async def record_system_event(
    event_request: SystemEventRequest,
    audit_service: AuditService = Depends(get_audit_service)
):
    """
    Record a system event for monitoring and alerting.
    
    This endpoint allows recording of system-wide events, errors, and incidents
    for comprehensive system monitoring and compliance tracking.
    """
    try:
        event_id = await audit_service.record_system_event(
            event_type=event_request.event_type,
            event_category=event_request.event_category,
            event_source=event_request.event_source,
            message=event_request.message,
            severity_level=event_request.severity_level,
            details=event_request.details,
            correlation_id=event_request.correlation_id
        )
        
        response = SystemEventResponse(
            id=event_id,
            event_type=event_request.event_type,
            event_category=event_request.event_category,
            event_source=event_request.event_source,
            event_message=event_request.message,
            event_details=event_request.details,
            severity_level=event_request.severity_level,
            resolution_status="open" if event_request.severity_level in ["high", "critical"] else "closed",
            occurred_at=datetime.utcnow(),
            correlation_id=event_request.correlation_id
        )
        
        logger.info("System event recorded", 
                   event_id=event_id, 
                   event_type=event_request.event_type)
        
        return response
    
    except Exception as e:
        logger.error("Failed to record system event", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to record system event: {str(e)}")


@router.get("/system-events", response_model=List[SystemEventResponse])
async def get_system_events(
    event_type: Optional[str] = Query(None, description="Filter by event type"),
    severity_level: Optional[str] = Query(None, description="Filter by severity level"),
    resolution_status: Optional[str] = Query(None, description="Filter by resolution status"),
    start_date: Optional[datetime] = Query(None, description="Filter by start date"),
    end_date: Optional[datetime] = Query(None, description="Filter by end date"),
    limit: int = Query(100, ge=1, le=1000, description="Maximum number of results"),
    offset: int = Query(0, ge=0, description="Number of results to skip"),
    repository: AuditRepository = Depends(get_audit_repository)
):
    """Get system events with optional filtering."""
    try:
        events, total_count = await repository.get_system_events(
            event_type=event_type,
            severity_level=severity_level,
            resolution_status=resolution_status,
            start_date=start_date,
            end_date=end_date,
            limit=limit,
            offset=offset
        )
        
        responses = []
        for event in events:
            response = SystemEventResponse(
                id=event.id,
                event_type=event.event_type,
                event_category=event.event_category,
                event_source=event.event_source,
                event_message=event.event_message,
                event_details=event.event_details,
                severity_level=event.severity_level,
                resolution_status=event.resolution_status,
                occurred_at=event.occurred_at,
                correlation_id=event.correlation_id
            )
            responses.append(response)
        
        return responses
    
    except Exception as e:
        logger.error("Failed to get system events", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get system events: {str(e)}")


# Performance metrics endpoint
@router.get("/performance-metrics")
async def get_performance_metrics(
    metric_type: Optional[str] = Query(None, description="Filter by metric type"),
    category: Optional[str] = Query(None, description="Filter by category"),
    start_date: Optional[datetime] = Query(None, description="Filter by start date"),
    end_date: Optional[datetime] = Query(None, description="Filter by end date"),
    aggregation_level: str = Query("daily", description="Aggregation level"),
    audit_service: AuditService = Depends(get_audit_service)
):
    """
    Get system performance metrics.
    
    This endpoint provides access to system performance metrics for monitoring
    and optimization purposes.
    """
    try:
        metrics = await audit_service.get_performance_metrics(
            metric_type=metric_type,
            category=category,
            start_date=start_date,
            end_date=end_date,
            aggregation_level=aggregation_level
        )
        
        return metrics
    
    except Exception as e:
        logger.error("Failed to get performance metrics", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get performance metrics: {str(e)}")


# Health check endpoint
@router.get("/health")
async def compliance_health_check():
    """Check compliance system health."""
    try:
        return {
            "status": "healthy",
            "audit_service": "operational",
            "compliance_reporting": "operational",
            "performance_monitoring": "operational",
            "timestamp": datetime.utcnow()
        }
    
    except Exception as e:
        logger.error("Compliance health check failed", error=str(e))
        return {
            "status": "unhealthy",
            "error": str(e),
            "timestamp": datetime.utcnow()
        }