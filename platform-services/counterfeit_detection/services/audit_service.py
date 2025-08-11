"""
Audit Service for comprehensive logging and compliance reporting.

This service handles audit trail creation, compliance report generation,
and action effectiveness tracking for regulatory requirements.
"""

import asyncio
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from uuid import uuid4
from decimal import Decimal

import structlog

from ..core.database import get_db_session
from ..db.repositories.audit_repository import AuditRepository
from ..models.enums import EnforcementAction, EnforcementStatus

logger = structlog.get_logger(__name__)


class AuditService:
    """Service for audit and compliance operations."""
    
    def __init__(self):
        """Initialize audit service."""
        self.audit_repository: Optional[AuditRepository] = None
        
        # Compliance frameworks configuration
        self.compliance_frameworks = {
            "EU_DSA": {
                "name": "EU Digital Services Act",
                "reporting_frequency": "quarterly",
                "required_metrics": [
                    "total_enforcement_actions",
                    "takedown_rate",
                    "appeal_rate",
                    "appeal_success_rate",
                    "response_time_metrics"
                ]
            },
            "US_CPSC": {
                "name": "US Consumer Product Safety Commission",
                "reporting_frequency": "monthly",
                "required_metrics": [
                    "product_safety_violations",
                    "enforcement_actions",
                    "supplier_notifications",
                    "compliance_rates"
                ]
            },
            "ISO_27001": {
                "name": "ISO 27001 Information Security",
                "reporting_frequency": "annual",
                "required_metrics": [
                    "security_incidents",
                    "access_control_events",
                    "data_protection_measures"
                ]
            }
        }
    
    async def log_enforcement_action(
        self,
        action_id: str,
        product_id: str,
        action_type: EnforcementAction,
        authenticity_score: int,
        confidence_score: float,
        reasoning: str,
        executed_by: str,
        rule_matches: List[str] = None,
        context: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Log enforcement action with comprehensive audit trail.
        
        Args:
            action_id: Enforcement action identifier
            product_id: Product identifier
            action_type: Type of enforcement action
            authenticity_score: Product authenticity score
            confidence_score: Analysis confidence
            reasoning: Decision reasoning
            executed_by: Agent or user that executed the action
            rule_matches: List of matched rule IDs
            context: Additional context information
            
        Returns:
            Audit log entry ID
        """
        try:
            async with get_db_session() as session:
                if not self.audit_repository:
                    self.audit_repository = AuditRepository(session)
                
                # Create detailed audit log entry
                audit_data = {
                    "id": str(uuid4()),
                    "entity_type": "enforcement_action",
                    "entity_id": action_id,
                    "action": "execute",
                    "actor_type": "agent" if "agent" in executed_by.lower() else "user",
                    "actor_id": executed_by,
                    "new_values": {
                        "product_id": product_id,
                        "action_type": action_type.value,
                        "authenticity_score": authenticity_score,
                        "confidence_score": confidence_score,
                        "reasoning": reasoning,
                        "rule_matches": rule_matches or [],
                        "execution_timestamp": datetime.utcnow().isoformat()
                    },
                    "context": {
                        **(context or {}),
                        "decision_factors": {
                            "authenticity_score": authenticity_score,
                            "confidence_score": confidence_score,
                            "rules_triggered": rule_matches or [],
                            "decision_reasoning": reasoning
                        }
                    },
                    "compliance_category": self._determine_compliance_category(action_type)
                }
                
                audit_log = await self.audit_repository.create_audit_log(audit_data)
                
                logger.info(
                    "Enforcement action logged in audit trail",
                    audit_id=audit_log.id,
                    action_id=action_id,
                    action_type=action_type.value,
                    executed_by=executed_by
                )
                
                return audit_log.id
        
        except Exception as e:
            logger.error("Failed to log enforcement action", error=str(e), action_id=action_id)
            raise
    
    async def log_rule_change(
        self,
        rule_id: str,
        action: str,  # 'create', 'update', 'delete'
        actor_id: str,
        old_values: Optional[Dict[str, Any]] = None,
        new_values: Optional[Dict[str, Any]] = None,
        context: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Log enforcement rule changes.
        
        Args:
            rule_id: Rule identifier
            action: Type of action performed
            actor_id: User that made the change
            old_values: Previous rule values
            new_values: New rule values
            context: Additional context
            
        Returns:
            Audit log entry ID
        """
        try:
            async with get_db_session() as session:
                if not self.audit_repository:
                    self.audit_repository = AuditRepository(session)
                
                # Calculate changes
                changes = {}
                if old_values and new_values:
                    changes = {
                        key: {"old": old_values.get(key), "new": new_values.get(key)}
                        for key in set(old_values.keys()) | set(new_values.keys())
                        if old_values.get(key) != new_values.get(key)
                    }
                
                audit_data = {
                    "id": str(uuid4()),
                    "entity_type": "enforcement_rule",
                    "entity_id": rule_id,
                    "action": action,
                    "actor_type": "user",
                    "actor_id": actor_id,
                    "old_values": old_values,
                    "new_values": new_values,
                    "changes": changes,
                    "context": context,
                    "compliance_category": "rule_management"
                }
                
                audit_log = await self.audit_repository.create_audit_log(audit_data)
                
                logger.info(
                    "Rule change logged in audit trail",
                    audit_id=audit_log.id,
                    rule_id=rule_id,
                    action=action,
                    actor_id=actor_id
                )
                
                return audit_log.id
        
        except Exception as e:
            logger.error("Failed to log rule change", error=str(e), rule_id=rule_id)
            raise
    
    async def track_action_effectiveness(
        self,
        action_id: str,
        was_appealed: bool = False,
        appeal_outcome: Optional[str] = None,
        was_false_positive: bool = False,
        time_to_compliance_hours: Optional[int] = None,
        user_complaints: int = 0,
        lessons_learned: Optional[str] = None
    ) -> str:
        """
        Track enforcement action effectiveness metrics.
        
        Args:
            action_id: Enforcement action identifier
            was_appealed: Whether action was appealed
            appeal_outcome: Outcome of appeal if applicable
            was_false_positive: Whether action was a false positive
            time_to_compliance_hours: Hours to achieve compliance
            user_complaints: Number of user complaints received
            lessons_learned: Lessons learned from this action
            
        Returns:
            Effectiveness metric entry ID
        """
        try:
            async with get_db_session() as session:
                if not self.audit_repository:
                    self.audit_repository = AuditRepository(session)
                
                # Calculate effectiveness scores
                action_accuracy_score = self._calculate_accuracy_score(
                    was_false_positive, was_appealed, appeal_outcome
                )
                
                effectiveness_data = {
                    "id": str(uuid4()),
                    "action_id": action_id,
                    "was_appealed": was_appealed,
                    "appeal_outcome": appeal_outcome,
                    "was_false_positive": was_false_positive,
                    "time_to_compliance_hours": time_to_compliance_hours,
                    "user_complaints_received": user_complaints,
                    "action_accuracy_score": action_accuracy_score,
                    "lessons_learned": lessons_learned,
                    "model_feedback_provided": False  # Will be updated when feedback is processed
                }
                
                metric = await self.audit_repository.create_effectiveness_metric(effectiveness_data)
                
                logger.info(
                    "Action effectiveness tracked",
                    metric_id=metric.id,
                    action_id=action_id,
                    accuracy_score=action_accuracy_score
                )
                
                return metric.id
        
        except Exception as e:
            logger.error("Failed to track action effectiveness", error=str(e), action_id=action_id)
            raise
    
    async def generate_compliance_report(
        self,
        framework: str,
        period_start: datetime,
        period_end: datetime,
        generated_by: str,
        report_type: str = "quarterly"
    ) -> str:
        """
        Generate comprehensive compliance report.
        
        Args:
            framework: Compliance framework (e.g., 'EU_DSA', 'US_CPSC')
            period_start: Report period start date
            period_end: Report period end date
            generated_by: User generating the report
            report_type: Type of report
            
        Returns:
            Compliance report ID
        """
        try:
            async with get_db_session() as session:
                if not self.audit_repository:
                    self.audit_repository = AuditRepository(session)
                
                # Get framework configuration
                framework_config = self.compliance_frameworks.get(framework)
                if not framework_config:
                    raise ValueError(f"Unknown compliance framework: {framework}")
                
                # Gather required metrics
                summary_data = await self._gather_summary_metrics(
                    period_start, period_end, framework_config["required_metrics"]
                )
                
                detailed_data = await self._gather_detailed_metrics(
                    period_start, period_end, framework
                )
                
                report_data = {
                    "id": str(uuid4()),
                    "report_type": report_type,
                    "regulation_framework": framework,
                    "period_start": period_start,
                    "period_end": period_end,
                    "generated_by": generated_by,
                    "summary_data": summary_data,
                    "detailed_data": detailed_data,
                    "report_status": "draft"
                }
                
                report = await self.audit_repository.create_compliance_report(report_data)
                
                logger.info(
                    "Compliance report generated",
                    report_id=report.id,
                    framework=framework,
                    period=f"{period_start.date()} to {period_end.date()}"
                )
                
                return report.id
        
        except Exception as e:
            logger.error("Failed to generate compliance report", error=str(e), framework=framework)
            raise
    
    async def get_audit_trail(
        self,
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
        actor_id: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        limit: int = 100,
        offset: int = 0
    ) -> Tuple[List[Dict], int]:
        """
        Get audit trail entries with filtering.
        
        Args:
            entity_type: Filter by entity type
            entity_id: Filter by specific entity ID
            actor_id: Filter by actor (user/agent)
            start_date: Filter by start date
            end_date: Filter by end date
            limit: Maximum results
            offset: Results offset
            
        Returns:
            Tuple of (audit entries, total count)
        """
        try:
            async with get_db_session() as session:
                if not self.audit_repository:
                    self.audit_repository = AuditRepository(session)
                
                entries, total_count = await self.audit_repository.get_audit_logs(
                    entity_type=entity_type,
                    entity_id=entity_id,
                    actor_id=actor_id,
                    start_date=start_date,
                    end_date=end_date,
                    limit=limit,
                    offset=offset
                )
                
                # Convert to dictionaries for API response
                audit_trail = []
                for entry in entries:
                    audit_trail.append({
                        "id": entry.id,
                        "entity_type": entry.entity_type,
                        "entity_id": entry.entity_id,
                        "action": entry.action,
                        "actor_type": entry.actor_type,
                        "actor_id": entry.actor_id,
                        "old_values": entry.old_values,
                        "new_values": entry.new_values,
                        "changes": entry.changes,
                        "context": entry.context,
                        "timestamp": entry.timestamp,
                        "compliance_category": entry.compliance_category
                    })
                
                return audit_trail, total_count
        
        except Exception as e:
            logger.error("Failed to get audit trail", error=str(e))
            raise
    
    async def get_performance_metrics(
        self,
        metric_type: Optional[str] = None,
        category: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        aggregation_level: str = "daily"
    ) -> List[Dict]:
        """
        Get system performance metrics.
        
        Args:
            metric_type: Type of metric to retrieve
            category: Metric category filter
            start_date: Start date for metrics
            end_date: End date for metrics
            aggregation_level: Level of aggregation
            
        Returns:
            List of performance metrics
        """
        try:
            async with get_db_session() as session:
                if not self.audit_repository:
                    self.audit_repository = AuditRepository(session)
                
                metrics = await self.audit_repository.get_performance_metrics(
                    metric_type=metric_type,
                    category=category,
                    start_date=start_date,
                    end_date=end_date,
                    aggregation_level=aggregation_level
                )
                
                return [
                    {
                        "id": metric.id,
                        "metric_type": metric.metric_type,
                        "metric_category": metric.metric_category,
                        "metric_value": float(metric.metric_value),
                        "metric_unit": metric.metric_unit,
                        "measurement_timestamp": metric.measurement_timestamp,
                        "aggregation_level": metric.aggregation_level,
                        "confidence_interval": float(metric.confidence_interval) if metric.confidence_interval else None
                    }
                    for metric in metrics
                ]
        
        except Exception as e:
            logger.error("Failed to get performance metrics", error=str(e))
            raise
    
    async def record_system_event(
        self,
        event_type: str,
        event_category: str,
        event_source: str,
        message: str,
        severity_level: str = "info",
        details: Optional[Dict[str, Any]] = None,
        correlation_id: Optional[str] = None
    ) -> str:
        """
        Record system event for monitoring and alerting.
        
        Args:
            event_type: Type of event
            event_category: Category of event
            event_source: Source system/component
            message: Event message
            severity_level: Severity level
            details: Additional event details
            correlation_id: Correlation ID for related events
            
        Returns:
            System event ID
        """
        try:
            async with get_db_session() as session:
                if not self.audit_repository:
                    self.audit_repository = AuditRepository(session)
                
                event_data = {
                    "id": str(uuid4()),
                    "event_type": event_type,
                    "event_category": event_category,
                    "event_source": event_source,
                    "event_message": message,
                    "event_details": details,
                    "severity_level": severity_level,
                    "correlation_id": correlation_id,
                    "resolution_status": "open" if severity_level in ["high", "critical"] else "closed"
                }
                
                event = await self.audit_repository.create_system_event(event_data)
                
                logger.info(
                    "System event recorded",
                    event_id=event.id,
                    event_type=event_type,
                    severity=severity_level,
                    source=event_source
                )
                
                return event.id
        
        except Exception as e:
            logger.error("Failed to record system event", error=str(e))
            raise
    
    def _determine_compliance_category(self, action_type: EnforcementAction) -> str:
        """Determine compliance category based on action type."""
        if action_type in [EnforcementAction.TAKEDOWN, EnforcementAction.PAUSE]:
            return "content_moderation"
        elif action_type == EnforcementAction.SUPPLIER_SUSPENSION:
            return "account_enforcement"
        elif action_type == EnforcementAction.WARNING:
            return "user_notification"
        else:
            return "general_enforcement"
    
    def _calculate_accuracy_score(
        self,
        was_false_positive: bool,
        was_appealed: bool,
        appeal_outcome: Optional[str]
    ) -> Decimal:
        """Calculate action accuracy score based on outcomes."""
        if was_false_positive:
            return Decimal("0.0")
        
        if not was_appealed:
            return Decimal("1.0")
        
        if appeal_outcome == "overturned":
            return Decimal("0.2")
        elif appeal_outcome == "partial":
            return Decimal("0.6")
        elif appeal_outcome == "upheld":
            return Decimal("1.0")
        else:
            return Decimal("0.8")  # Default for pending appeals
    
    async def _gather_summary_metrics(
        self,
        period_start: datetime,
        period_end: datetime,
        required_metrics: List[str]
    ) -> Dict[str, Any]:
        """Gather summary metrics for compliance reporting."""
        # This would gather actual metrics from the database
        # For now, providing a structure
        return {
            "total_enforcement_actions": 0,
            "actions_by_type": {},
            "takedown_rate": 0.0,
            "appeal_rate": 0.0,
            "appeal_success_rate": 0.0,
            "average_response_time_hours": 0.0,
            "false_positive_rate": 0.0,
            "compliance_rate": 0.0,
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat()
        }
    
    async def _gather_detailed_metrics(
        self,
        period_start: datetime,
        period_end: datetime,
        framework: str
    ) -> Dict[str, Any]:
        """Gather detailed metrics for compliance reporting."""
        # This would gather detailed metrics from the database
        # For now, providing a structure
        return {
            "enforcement_actions_detail": [],
            "appeals_detail": [],
            "performance_metrics": [],
            "system_events": [],
            "data_sources": [],
            "methodology": f"Automated reporting for {framework} compliance",
            "data_quality_assessment": "high"
        }