"""
Repository for audit and compliance data operations.

This repository handles CRUD operations for audit logs, compliance reports,
effectiveness metrics, and performance tracking.
"""

import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
from uuid import uuid4

from sqlalchemy import and_, desc, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

import structlog

from ..models.audit import (
    AuditLog, ComplianceReport, ActionEffectivenessMetric,
    PerformanceMetric, DataRetentionPolicy, SystemEvent
)

logger = structlog.get_logger(__name__)


class AuditRepository:
    """Repository for audit and compliance data access."""
    
    def __init__(self, session: AsyncSession):
        self.session = session
    
    # Audit Log operations
    async def create_audit_log(self, audit_data: Dict) -> AuditLog:
        """
        Create a new audit log entry.
        
        Args:
            audit_data: Dictionary containing audit log information
            
        Returns:
            Created AuditLog instance
        """
        try:
            audit_log = AuditLog(
                id=audit_data.get("id", str(uuid4())),
                entity_type=audit_data["entity_type"],
                entity_id=audit_data["entity_id"],
                action=audit_data["action"],
                actor_type=audit_data["actor_type"],
                actor_id=audit_data["actor_id"],
                old_values=audit_data.get("old_values"),
                new_values=audit_data.get("new_values"),
                changes=audit_data.get("changes"),
                context=audit_data.get("context"),
                session_id=audit_data.get("session_id"),
                request_id=audit_data.get("request_id"),
                source_system=audit_data.get("source_system", "counterfeit_detection"),
                compliance_category=audit_data.get("compliance_category")
            )
            
            self.session.add(audit_log)
            await self.session.commit()
            await self.session.refresh(audit_log)
            
            logger.debug("Audit log created", 
                        audit_id=audit_log.id, 
                        entity=f"{audit_log.entity_type}:{audit_log.entity_id}")
            return audit_log
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to create audit log", error=str(e))
            raise
    
    async def get_audit_logs(
        self,
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
        actor_id: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        compliance_category: Optional[str] = None,
        limit: int = 100,
        offset: int = 0
    ) -> Tuple[List[AuditLog], int]:
        """
        Get audit logs with filtering.
        
        Args:
            entity_type: Filter by entity type
            entity_id: Filter by specific entity ID
            actor_id: Filter by actor (user/agent)
            start_date: Filter by start date
            end_date: Filter by end date
            compliance_category: Filter by compliance category
            limit: Maximum number of results
            offset: Number of results to skip
            
        Returns:
            Tuple of (audit logs list, total count)
        """
        try:
            conditions = []
            
            if entity_type:
                conditions.append(AuditLog.entity_type == entity_type)
            
            if entity_id:
                conditions.append(AuditLog.entity_id == entity_id)
            
            if actor_id:
                conditions.append(AuditLog.actor_id == actor_id)
            
            if start_date:
                conditions.append(AuditLog.timestamp >= start_date)
            
            if end_date:
                conditions.append(AuditLog.timestamp <= end_date)
            
            if compliance_category:
                conditions.append(AuditLog.compliance_category == compliance_category)
            
            # Base query
            base_query = select(AuditLog)
            if conditions:
                base_query = base_query.where(and_(*conditions))
            
            # Get total count
            count_query = select(func.count(AuditLog.id))
            if conditions:
                count_query = count_query.where(and_(*conditions))
            
            count_result = await self.session.execute(count_query)
            total_count = count_result.scalar()
            
            # Get paginated results
            query = base_query.order_by(
                desc(AuditLog.timestamp)
            ).limit(limit).offset(offset)
            
            result = await self.session.execute(query)
            logs = result.scalars().all()
            
            return logs, total_count
        
        except Exception as e:
            logger.error("Failed to get audit logs", error=str(e))
            raise
    
    async def get_audit_log_by_id(self, audit_id: str) -> Optional[AuditLog]:
        """Get audit log by ID."""
        try:
            result = await self.session.execute(
                select(AuditLog).where(AuditLog.id == audit_id)
            )
            return result.scalar_one_or_none()
        
        except Exception as e:
            logger.error("Failed to get audit log by ID", error=str(e), audit_id=audit_id)
            raise
    
    # Compliance Report operations
    async def create_compliance_report(self, report_data: Dict) -> ComplianceReport:
        """
        Create a new compliance report.
        
        Args:
            report_data: Dictionary containing report information
            
        Returns:
            Created ComplianceReport instance
        """
        try:
            report = ComplianceReport(
                id=report_data.get("id", str(uuid4())),
                report_type=report_data["report_type"],
                regulation_framework=report_data["regulation_framework"],
                period_start=report_data["period_start"],
                period_end=report_data["period_end"],
                generated_by=report_data["generated_by"],
                report_status=report_data.get("report_status", "draft"),
                summary_data=report_data["summary_data"],
                detailed_data=report_data["detailed_data"],
                attachments=report_data.get("attachments"),
                submitted_to=report_data.get("submitted_to"),
                submission_reference=report_data.get("submission_reference")
            )
            
            self.session.add(report)
            await self.session.commit()
            await self.session.refresh(report)
            
            logger.info("Compliance report created", 
                       report_id=report.id, 
                       framework=report.regulation_framework)
            return report
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to create compliance report", error=str(e))
            raise
    
    async def get_compliance_reports(
        self,
        framework: Optional[str] = None,
        report_type: Optional[str] = None,
        status: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        limit: int = 50,
        offset: int = 0
    ) -> Tuple[List[ComplianceReport], int]:
        """Get compliance reports with filtering."""
        try:
            conditions = []
            
            if framework:
                conditions.append(ComplianceReport.regulation_framework == framework)
            
            if report_type:
                conditions.append(ComplianceReport.report_type == report_type)
            
            if status:
                conditions.append(ComplianceReport.report_status == status)
            
            if start_date:
                conditions.append(ComplianceReport.period_start >= start_date)
            
            if end_date:
                conditions.append(ComplianceReport.period_end <= end_date)
            
            # Base query
            base_query = select(ComplianceReport)
            if conditions:
                base_query = base_query.where(and_(*conditions))
            
            # Get total count
            count_query = select(func.count(ComplianceReport.id))
            if conditions:
                count_query = count_query.where(and_(*conditions))
            
            count_result = await self.session.execute(count_query)
            total_count = count_result.scalar()
            
            # Get paginated results
            query = base_query.order_by(
                desc(ComplianceReport.generated_at)
            ).limit(limit).offset(offset)
            
            result = await self.session.execute(query)
            reports = result.scalars().all()
            
            return reports, total_count
        
        except Exception as e:
            logger.error("Failed to get compliance reports", error=str(e))
            raise
    
    async def update_compliance_report(self, report_id: str, update_data: Dict) -> Optional[ComplianceReport]:
        """Update compliance report."""
        try:
            result = await self.session.execute(
                select(ComplianceReport).where(ComplianceReport.id == report_id)
            )
            report = result.scalar_one_or_none()
            
            if not report:
                return None
            
            # Update allowed fields
            allowed_fields = {
                "report_status", "summary_data", "detailed_data", "attachments",
                "submitted_at", "submitted_to", "submission_reference",
                "validated_at", "validated_by", "validation_notes"
            }
            
            for field, value in update_data.items():
                if field in allowed_fields and hasattr(report, field):
                    setattr(report, field, value)
            
            await self.session.commit()
            await self.session.refresh(report)
            
            logger.info("Compliance report updated", report_id=report_id)
            return report
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to update compliance report", error=str(e), report_id=report_id)
            raise
    
    # Action Effectiveness Metrics operations
    async def create_effectiveness_metric(self, metric_data: Dict) -> ActionEffectivenessMetric:
        """
        Create action effectiveness metric.
        
        Args:
            metric_data: Dictionary containing metric information
            
        Returns:
            Created ActionEffectivenessMetric instance
        """
        try:
            metric = ActionEffectivenessMetric(
                id=metric_data.get("id", str(uuid4())),
                action_id=metric_data["action_id"],
                was_appealed=metric_data.get("was_appealed", False),
                appeal_outcome=metric_data.get("appeal_outcome"),
                was_false_positive=metric_data.get("was_false_positive", False),
                supplier_compliance_improved=metric_data.get("supplier_compliance_improved"),
                repeat_violations_prevented=metric_data.get("repeat_violations_prevented", 0),
                user_complaints_received=metric_data.get("user_complaints_received", 0),
                time_to_compliance_hours=metric_data.get("time_to_compliance_hours"),
                time_to_resolution_hours=metric_data.get("time_to_resolution_hours"),
                action_accuracy_score=metric_data.get("action_accuracy_score"),
                user_satisfaction_score=metric_data.get("user_satisfaction_score"),
                regulatory_compliance_score=metric_data.get("regulatory_compliance_score"),
                follow_up_actions_needed=metric_data.get("follow_up_actions_needed", False),
                follow_up_actions_taken=metric_data.get("follow_up_actions_taken"),
                lessons_learned=metric_data.get("lessons_learned"),
                model_feedback_provided=metric_data.get("model_feedback_provided", False),
                rule_adjustments_made=metric_data.get("rule_adjustments_made")
            )
            
            self.session.add(metric)
            await self.session.commit()
            await self.session.refresh(metric)
            
            logger.debug("Effectiveness metric created", 
                        metric_id=metric.id, 
                        action_id=metric.action_id)
            return metric
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to create effectiveness metric", error=str(e))
            raise
    
    async def get_effectiveness_metrics(
        self,
        action_id: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        limit: int = 100,
        offset: int = 0
    ) -> Tuple[List[ActionEffectivenessMetric], int]:
        """Get effectiveness metrics with filtering."""
        try:
            conditions = []
            
            if action_id:
                conditions.append(ActionEffectivenessMetric.action_id == action_id)
            
            if start_date:
                conditions.append(ActionEffectivenessMetric.created_at >= start_date)
            
            if end_date:
                conditions.append(ActionEffectivenessMetric.created_at <= end_date)
            
            # Base query
            base_query = select(ActionEffectivenessMetric)
            if conditions:
                base_query = base_query.where(and_(*conditions))
            
            # Get total count
            count_query = select(func.count(ActionEffectivenessMetric.id))
            if conditions:
                count_query = count_query.where(and_(*conditions))
            
            count_result = await self.session.execute(count_query)
            total_count = count_result.scalar()
            
            # Get paginated results
            query = base_query.order_by(
                desc(ActionEffectivenessMetric.created_at)
            ).limit(limit).offset(offset)
            
            result = await self.session.execute(query)
            metrics = result.scalars().all()
            
            return metrics, total_count
        
        except Exception as e:
            logger.error("Failed to get effectiveness metrics", error=str(e))
            raise
    
    # Performance Metrics operations
    async def create_performance_metric(self, metric_data: Dict) -> PerformanceMetric:
        """
        Create performance metric.
        
        Args:
            metric_data: Dictionary containing metric information
            
        Returns:
            Created PerformanceMetric instance
        """
        try:
            metric = PerformanceMetric(
                id=metric_data.get("id", str(uuid4())),
                metric_type=metric_data["metric_type"],
                metric_category=metric_data["metric_category"],
                metric_value=metric_data["metric_value"],
                metric_unit=metric_data["metric_unit"],
                measurement_context=metric_data.get("measurement_context"),
                sample_size=metric_data.get("sample_size"),
                measurement_period_start=metric_data.get("measurement_period_start"),
                measurement_period_end=metric_data.get("measurement_period_end"),
                aggregation_level=metric_data.get("aggregation_level", "instance"),
                confidence_interval=metric_data.get("confidence_interval"),
                data_quality_score=metric_data.get("data_quality_score")
            )
            
            self.session.add(metric)
            await self.session.commit()
            await self.session.refresh(metric)
            
            logger.debug("Performance metric created", 
                        metric_id=metric.id, 
                        metric_type=metric.metric_type)
            return metric
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to create performance metric", error=str(e))
            raise
    
    async def get_performance_metrics(
        self,
        metric_type: Optional[str] = None,
        category: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        aggregation_level: Optional[str] = None,
        limit: int = 1000,
        offset: int = 0
    ) -> List[PerformanceMetric]:
        """Get performance metrics with filtering."""
        try:
            conditions = []
            
            if metric_type:
                conditions.append(PerformanceMetric.metric_type == metric_type)
            
            if category:
                conditions.append(PerformanceMetric.metric_category == category)
            
            if start_date:
                conditions.append(PerformanceMetric.measurement_timestamp >= start_date)
            
            if end_date:
                conditions.append(PerformanceMetric.measurement_timestamp <= end_date)
            
            if aggregation_level:
                conditions.append(PerformanceMetric.aggregation_level == aggregation_level)
            
            # Build query
            query = select(PerformanceMetric)
            if conditions:
                query = query.where(and_(*conditions))
            
            query = query.order_by(
                desc(PerformanceMetric.measurement_timestamp)
            ).limit(limit).offset(offset)
            
            result = await self.session.execute(query)
            metrics = result.scalars().all()
            
            return metrics
        
        except Exception as e:
            logger.error("Failed to get performance metrics", error=str(e))
            raise
    
    # System Event operations
    async def create_system_event(self, event_data: Dict) -> SystemEvent:
        """
        Create system event.
        
        Args:
            event_data: Dictionary containing event information
            
        Returns:
            Created SystemEvent instance
        """
        try:
            event = SystemEvent(
                id=event_data.get("id", str(uuid4())),
                event_type=event_data["event_type"],
                event_category=event_data["event_category"],
                event_source=event_data["event_source"],
                event_message=event_data["event_message"],
                event_details=event_data.get("event_details"),
                severity_level=event_data.get("severity_level", "info"),
                impact_assessment=event_data.get("impact_assessment"),
                resolution_status=event_data.get("resolution_status", "open"),
                assigned_to=event_data.get("assigned_to"),
                correlation_id=event_data.get("correlation_id"),
                parent_event_id=event_data.get("parent_event_id"),
                occurred_at=event_data.get("occurred_at", datetime.utcnow())
            )
            
            self.session.add(event)
            await self.session.commit()
            await self.session.refresh(event)
            
            logger.debug("System event created", 
                        event_id=event.id, 
                        event_type=event.event_type)
            return event
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to create system event", error=str(e))
            raise
    
    async def get_system_events(
        self,
        event_type: Optional[str] = None,
        severity_level: Optional[str] = None,
        resolution_status: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        limit: int = 100,
        offset: int = 0
    ) -> Tuple[List[SystemEvent], int]:
        """Get system events with filtering."""
        try:
            conditions = []
            
            if event_type:
                conditions.append(SystemEvent.event_type == event_type)
            
            if severity_level:
                conditions.append(SystemEvent.severity_level == severity_level)
            
            if resolution_status:
                conditions.append(SystemEvent.resolution_status == resolution_status)
            
            if start_date:
                conditions.append(SystemEvent.occurred_at >= start_date)
            
            if end_date:
                conditions.append(SystemEvent.occurred_at <= end_date)
            
            # Base query
            base_query = select(SystemEvent)
            if conditions:
                base_query = base_query.where(and_(*conditions))
            
            # Get total count
            count_query = select(func.count(SystemEvent.id))
            if conditions:
                count_query = count_query.where(and_(*conditions))
            
            count_result = await self.session.execute(count_query)
            total_count = count_result.scalar()
            
            # Get paginated results
            query = base_query.order_by(
                desc(SystemEvent.occurred_at)
            ).limit(limit).offset(offset)
            
            result = await self.session.execute(query)
            events = result.scalars().all()
            
            return events, total_count
        
        except Exception as e:
            logger.error("Failed to get system events", error=str(e))
            raise
    
    # Data cleanup operations
    async def cleanup_old_audit_logs(self, retention_days: int = 365) -> int:
        """
        Clean up old audit logs based on retention policy.
        
        Args:
            retention_days: Number of days to retain logs
            
        Returns:
            Number of deleted audit log entries
        """
        try:
            cutoff_date = datetime.utcnow() - timedelta(days=retention_days)
            
            # Get old logs
            result = await self.session.execute(
                select(AuditLog).where(AuditLog.timestamp < cutoff_date)
            )
            old_logs = result.scalars().all()
            
            # Delete old logs
            for log in old_logs:
                await self.session.delete(log)
            
            await self.session.commit()
            
            logger.info("Audit logs cleaned up", 
                       deleted_count=len(old_logs), 
                       cutoff_date=cutoff_date)
            return len(old_logs)
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to cleanup old audit logs", error=str(e))
            raise