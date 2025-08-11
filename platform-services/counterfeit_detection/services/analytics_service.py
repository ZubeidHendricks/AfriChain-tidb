"""
Analytics Service for measuring detection effectiveness and system performance.

This service provides comprehensive analytics calculations including detection rates,
false positive tracking, performance metrics, and bias detection across the entire
counterfeit detection system.
"""

import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
from decimal import Decimal
from enum import Enum
import statistics
from collections import defaultdict

import structlog
from sqlalchemy import and_, func, desc, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db_session
from ..db.repositories.analytics_repository import AnalyticsRepository
from ..db.repositories.audit_repository import AuditRepository
from ..db.repositories.enforcement_repository import EnforcementRepository
from ..models.enums import ProductCategory, EnforcementAction, ProductStatus
from ..services.notification_service import NotificationService

logger = structlog.get_logger(__name__)


class MetricPeriod(str, Enum):
    """Time periods for analytics aggregation."""
    HOURLY = "hourly"
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    YEARLY = "yearly"


class AnalyticsTargets:
    """System performance targets and thresholds."""
    DETECTION_RATE_TARGET = 0.85  # 85% detection rate target
    FALSE_POSITIVE_TARGET = 0.05  # 5% false positive rate target
    RESPONSE_TIME_TARGET = 3.0    # 3 seconds response time target
    BIAS_THRESHOLD = 0.01         # 1% bias threshold
    UPTIME_TARGET = 0.99          # 99% uptime target


class AnalyticsService:
    """Service for comprehensive system analytics and performance monitoring."""
    
    def __init__(self):
        """Initialize analytics service."""
        self.analytics_repository: Optional[AnalyticsRepository] = None
        self.audit_repository: Optional[AuditRepository] = None
        self.enforcement_repository: Optional[EnforcementRepository] = None
        self.notification_service: Optional[NotificationService] = None
        
        # Cache for expensive calculations
        self._cache = {}
        self._cache_ttl = {}
        self._cache_timeout = 300  # 5 minutes default cache
    
    async def calculate_detection_analytics(
        self,
        start_date: datetime,
        end_date: datetime,
        category_filter: Optional[str] = None,
        supplier_filter: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Calculate comprehensive detection analytics for the specified period.
        
        Args:
            start_date: Start of analysis period
            end_date: End of analysis period  
            category_filter: Optional product category filter
            supplier_filter: Optional supplier filter
            
        Returns:
            Dictionary containing detection analytics
        """
        try:
            async with get_db_session() as session:
                if not self.analytics_repository:
                    self.analytics_repository = AnalyticsRepository(session)
                
                # Get core detection metrics
                total_analyzed = await self._count_analyzed_products(
                    session, start_date, end_date, category_filter, supplier_filter
                )
                
                total_flagged = await self._count_flagged_products(
                    session, start_date, end_date, category_filter, supplier_filter
                )
                
                true_positives = await self._count_true_positives(
                    session, start_date, end_date, category_filter, supplier_filter
                )
                
                false_positives = await self._count_false_positives(
                    session, start_date, end_date, category_filter, supplier_filter
                )
                
                false_negatives = await self._count_false_negatives(
                    session, start_date, end_date, category_filter, supplier_filter
                )
                
                # Calculate derived metrics
                detection_rate = self._calculate_detection_rate(
                    true_positives, false_negatives
                )
                
                false_positive_rate = self._calculate_false_positive_rate(
                    false_positives, total_analyzed
                )
                
                precision = self._calculate_precision(true_positives, false_positives)
                recall = self._calculate_recall(true_positives, false_negatives)
                f1_score = self._calculate_f1_score(precision, recall)
                
                # Get time series data
                time_series = await self._get_detection_time_series(
                    session, start_date, end_date, category_filter, supplier_filter
                )
                
                # Get category breakdown
                category_breakdown = await self._get_category_breakdown(
                    session, start_date, end_date, supplier_filter
                )
                
                # Calculate target achievement
                target_achievement = {
                    "detection_rate": {
                        "actual": detection_rate,
                        "target": AnalyticsTargets.DETECTION_RATE_TARGET,
                        "achievement": detection_rate / AnalyticsTargets.DETECTION_RATE_TARGET * 100,
                        "status": "pass" if detection_rate >= AnalyticsTargets.DETECTION_RATE_TARGET else "fail"
                    },
                    "false_positive_rate": {
                        "actual": false_positive_rate,
                        "target": AnalyticsTargets.FALSE_POSITIVE_TARGET,
                        "achievement": (1 - false_positive_rate / AnalyticsTargets.FALSE_POSITIVE_TARGET) * 100,
                        "status": "pass" if false_positive_rate <= AnalyticsTargets.FALSE_POSITIVE_TARGET else "fail"
                    }
                }
                
                analytics_result = {
                    "period": {
                        "start_date": start_date.isoformat(),
                        "end_date": end_date.isoformat(),
                        "days": (end_date - start_date).days
                    },
                    "filters": {
                        "category": category_filter,
                        "supplier": supplier_filter
                    },
                    "core_metrics": {
                        "total_analyzed": total_analyzed,
                        "total_flagged": total_flagged,
                        "true_positives": true_positives,
                        "false_positives": false_positives,
                        "false_negatives": false_negatives,
                        "detection_rate": detection_rate,
                        "false_positive_rate": false_positive_rate,
                        "precision": precision,
                        "recall": recall,
                        "f1_score": f1_score
                    },
                    "target_achievement": target_achievement,
                    "time_series": time_series,
                    "category_breakdown": category_breakdown,
                    "generated_at": datetime.utcnow().isoformat()
                }
                
                logger.info(
                    "Detection analytics calculated",
                    period_days=(end_date - start_date).days,
                    detection_rate=detection_rate,
                    false_positive_rate=false_positive_rate,
                    total_analyzed=total_analyzed
                )
                
                return analytics_result
        
        except Exception as e:
            logger.error("Failed to calculate detection analytics", error=str(e))
            raise
    
    async def calculate_false_positive_analytics(
        self,
        start_date: datetime,
        end_date: datetime,
        include_root_cause: bool = True
    ) -> Dict[str, Any]:
        """
        Calculate detailed false positive analytics and trends.
        
        Args:
            start_date: Start of analysis period
            end_date: End of analysis period
            include_root_cause: Whether to include root cause analysis
            
        Returns:
            Dictionary containing false positive analytics
        """
        try:
            async with get_db_session() as session:
                if not self.analytics_repository:
                    self.analytics_repository = AnalyticsRepository(session)
                
                # Get false positive trends
                fp_trend = await self._get_false_positive_trend(
                    session, start_date, end_date
                )
                
                # Get false positives by category
                fp_by_category = await self._get_false_positives_by_category(
                    session, start_date, end_date
                )
                
                # Get false positives by supplier
                fp_by_supplier = await self._get_false_positives_by_supplier(
                    session, start_date, end_date
                )
                
                # Get false positives by rule
                fp_by_rule = await self._get_false_positives_by_rule(
                    session, start_date, end_date
                )
                
                # Calculate current false positive rate
                current_fp_rate = await self._calculate_current_false_positive_rate(
                    session, start_date, end_date
                )
                
                # Check if alert threshold exceeded
                alert_triggered = current_fp_rate > AnalyticsTargets.FALSE_POSITIVE_TARGET
                
                result = {
                    "period": {
                        "start_date": start_date.isoformat(),
                        "end_date": end_date.isoformat()
                    },
                    "summary": {
                        "current_fp_rate": current_fp_rate,
                        "target_fp_rate": AnalyticsTargets.FALSE_POSITIVE_TARGET,
                        "alert_triggered": alert_triggered,
                        "trend_direction": self._calculate_trend_direction(fp_trend)
                    },
                    "trends": {
                        "daily_fp_rate": fp_trend,
                        "by_category": fp_by_category,
                        "by_supplier": fp_by_supplier,
                        "by_rule": fp_by_rule
                    },
                    "generated_at": datetime.utcnow().isoformat()
                }
                
                # Add root cause analysis if requested
                if include_root_cause:
                    root_causes = await self._analyze_false_positive_root_causes(
                        session, start_date, end_date
                    )
                    result["root_cause_analysis"] = root_causes
                
                # Trigger alert if threshold exceeded
                if alert_triggered and self.notification_service:
                    await self._trigger_false_positive_alert(current_fp_rate)
                
                logger.info(
                    "False positive analytics calculated",
                    fp_rate=current_fp_rate,
                    alert_triggered=alert_triggered
                )
                
                return result
        
        except Exception as e:
            logger.error("Failed to calculate false positive analytics", error=str(e))
            raise
    
    async def calculate_performance_metrics(
        self,
        start_date: datetime,
        end_date: datetime,
        include_agent_details: bool = True
    ) -> Dict[str, Any]:
        """
        Calculate comprehensive system performance metrics.
        
        Args:
            start_date: Start of analysis period
            end_date: End of analysis period
            include_agent_details: Whether to include detailed agent metrics
            
        Returns:
            Dictionary containing performance metrics
        """
        try:
            async with get_db_session() as session:
                if not self.audit_repository:
                    self.audit_repository = AuditRepository(session)
                
                # Get response time metrics
                response_times = await self._get_response_time_metrics(
                    session, start_date, end_date
                )
                
                # Get throughput metrics
                throughput = await self._get_throughput_metrics(
                    session, start_date, end_date
                )
                
                # Get error rate metrics
                error_rates = await self._get_error_rate_metrics(
                    session, start_date, end_date
                )
                
                # Get uptime metrics
                uptime = await self._get_uptime_metrics(
                    session, start_date, end_date
                )
                
                # Calculate performance targets achievement
                target_achievement = {
                    "response_time": {
                        "actual": response_times.get("avg_response_time", 0),
                        "target": AnalyticsTargets.RESPONSE_TIME_TARGET,
                        "achievement": (AnalyticsTargets.RESPONSE_TIME_TARGET / max(response_times.get("avg_response_time", 1), 0.1)) * 100,
                        "status": "pass" if response_times.get("avg_response_time", 999) <= AnalyticsTargets.RESPONSE_TIME_TARGET else "fail"
                    },
                    "uptime": {
                        "actual": uptime.get("overall_uptime", 0),
                        "target": AnalyticsTargets.UPTIME_TARGET,
                        "achievement": uptime.get("overall_uptime", 0) / AnalyticsTargets.UPTIME_TARGET * 100,
                        "status": "pass" if uptime.get("overall_uptime", 0) >= AnalyticsTargets.UPTIME_TARGET else "fail"
                    }
                }
                
                result = {
                    "period": {
                        "start_date": start_date.isoformat(),
                        "end_date": end_date.isoformat()
                    },
                    "response_time": response_times,
                    "throughput": throughput,
                    "error_rates": error_rates,
                    "uptime": uptime,
                    "target_achievement": target_achievement,
                    "generated_at": datetime.utcnow().isoformat()
                }
                
                # Add detailed agent metrics if requested
                if include_agent_details:
                    agent_metrics = await self._get_agent_performance_metrics(
                        session, start_date, end_date
                    )
                    result["agent_metrics"] = agent_metrics
                
                logger.info(
                    "Performance metrics calculated",
                    avg_response_time=response_times.get("avg_response_time"),
                    overall_uptime=uptime.get("overall_uptime")
                )
                
                return result
        
        except Exception as e:
            logger.error("Failed to calculate performance metrics", error=str(e))
            raise
    
    async def calculate_bias_metrics(
        self,
        start_date: datetime,
        end_date: datetime,
        protected_attributes: List[str] = None
    ) -> Dict[str, Any]:
        """
        Calculate bias and fairness metrics across different dimensions.
        
        Args:
            start_date: Start of analysis period
            end_date: End of analysis period
            protected_attributes: List of attributes to check for bias
            
        Returns:
            Dictionary containing bias metrics
        """
        try:
            async with get_db_session() as session:
                if not self.analytics_repository:
                    self.analytics_repository = AnalyticsRepository(session)
                
                if not protected_attributes:
                    protected_attributes = ["category", "price_range", "supplier_region"]
                
                bias_results = {}
                
                for attribute in protected_attributes:
                    # Calculate demographic parity
                    demographic_parity = await self._calculate_demographic_parity(
                        session, start_date, end_date, attribute
                    )
                    
                    # Calculate equalized odds
                    equalized_odds = await self._calculate_equalized_odds(
                        session, start_date, end_date, attribute
                    )
                    
                    # Calculate equality of opportunity
                    equality_opportunity = await self._calculate_equality_opportunity(
                        session, start_date, end_date, attribute
                    )
                    
                    bias_results[attribute] = {
                        "demographic_parity": demographic_parity,
                        "equalized_odds": equalized_odds,
                        "equality_opportunity": equality_opportunity,
                        "bias_detected": any([
                            demographic_parity.get("bias_score", 0) > AnalyticsTargets.BIAS_THRESHOLD,
                            equalized_odds.get("bias_score", 0) > AnalyticsTargets.BIAS_THRESHOLD,
                            equality_opportunity.get("bias_score", 0) > AnalyticsTargets.BIAS_THRESHOLD
                        ])
                    }
                
                # Calculate overall bias score
                overall_bias_score = statistics.mean([
                    max(
                        metrics["demographic_parity"].get("bias_score", 0),
                        metrics["equalized_odds"].get("bias_score", 0),
                        metrics["equality_opportunity"].get("bias_score", 0)
                    )
                    for metrics in bias_results.values()
                ])
                
                # Check if bias alert should be triggered
                bias_alert_triggered = overall_bias_score > AnalyticsTargets.BIAS_THRESHOLD
                
                result = {
                    "period": {
                        "start_date": start_date.isoformat(),
                        "end_date": end_date.isoformat()
                    },
                    "overall_bias_score": overall_bias_score,
                    "bias_threshold": AnalyticsTargets.BIAS_THRESHOLD,
                    "bias_alert_triggered": bias_alert_triggered,
                    "bias_by_attribute": bias_results,
                    "generated_at": datetime.utcnow().isoformat()
                }
                
                # Trigger bias alert if threshold exceeded
                if bias_alert_triggered and self.notification_service:
                    await self._trigger_bias_alert(overall_bias_score, bias_results)
                
                logger.info(
                    "Bias metrics calculated",
                    overall_bias_score=overall_bias_score,
                    bias_alert_triggered=bias_alert_triggered
                )
                
                return result
        
        except Exception as e:
            logger.error("Failed to calculate bias metrics", error=str(e))
            raise
    
    # Helper methods for metric calculations
    
    async def _count_analyzed_products(
        self,
        session: AsyncSession,
        start_date: datetime,
        end_date: datetime,
        category_filter: Optional[str] = None,
        supplier_filter: Optional[str] = None
    ) -> int:
        """Count total products analyzed in the period."""
        # Implementation would query audit logs for analysis activities
        # Placeholder return
        return 1000
    
    async def _count_flagged_products(
        self,
        session: AsyncSession,
        start_date: datetime,
        end_date: datetime,
        category_filter: Optional[str] = None,
        supplier_filter: Optional[str] = None
    ) -> int:
        """Count products flagged as potential counterfeits."""
        # Implementation would query enforcement actions for flagged products
        # Placeholder return
        return 150
    
    async def _count_true_positives(
        self,
        session: AsyncSession,
        start_date: datetime,
        end_date: datetime,
        category_filter: Optional[str] = None,
        supplier_filter: Optional[str] = None
    ) -> int:
        """Count confirmed true positive detections."""
        # Implementation would query appeals and overrides to identify confirmed counterfeits
        # Placeholder return
        return 140
    
    async def _count_false_positives(
        self,
        session: AsyncSession,
        start_date: datetime,
        end_date: datetime,
        category_filter: Optional[str] = None,
        supplier_filter: Optional[str] = None
    ) -> int:
        """Count confirmed false positive detections."""
        # Implementation would query successful appeals and admin overrides
        # Placeholder return
        return 10
    
    async def _count_false_negatives(
        self,
        session: AsyncSession,
        start_date: datetime,
        end_date: datetime,
        category_filter: Optional[str] = None,
        supplier_filter: Optional[str] = None
    ) -> int:
        """Count missed counterfeit products (false negatives)."""
        # Implementation would require manual validation or external feedback
        # Placeholder return
        return 5
    
    def _calculate_detection_rate(self, true_positives: int, false_negatives: int) -> float:
        """Calculate detection rate (recall)."""
        total_actual_counterfeits = true_positives + false_negatives
        if total_actual_counterfeits == 0:
            return 1.0
        return true_positives / total_actual_counterfeits
    
    def _calculate_false_positive_rate(self, false_positives: int, total_analyzed: int) -> float:
        """Calculate false positive rate."""
        if total_analyzed == 0:
            return 0.0
        return false_positives / total_analyzed
    
    def _calculate_precision(self, true_positives: int, false_positives: int) -> float:
        """Calculate precision."""
        total_flagged = true_positives + false_positives
        if total_flagged == 0:
            return 1.0
        return true_positives / total_flagged
    
    def _calculate_recall(self, true_positives: int, false_negatives: int) -> float:
        """Calculate recall (same as detection rate)."""
        return self._calculate_detection_rate(true_positives, false_negatives)
    
    def _calculate_f1_score(self, precision: float, recall: float) -> float:
        """Calculate F1 score."""
        if precision + recall == 0:
            return 0.0
        return 2 * (precision * recall) / (precision + recall)
    
    async def _trigger_false_positive_alert(self, fp_rate: float) -> None:
        """Trigger alert when false positive rate exceeds threshold."""
        if self.notification_service:
            await self.notification_service.send_alert(
                alert_type="false_positive_threshold_exceeded",
                message=f"False positive rate ({fp_rate:.1%}) exceeds target ({AnalyticsTargets.FALSE_POSITIVE_TARGET:.1%})",
                severity="high",
                recipients=["admin", "quality_team"],
                metadata={
                    "current_fp_rate": fp_rate,
                    "target_fp_rate": AnalyticsTargets.FALSE_POSITIVE_TARGET,
                    "threshold_exceeded_by": fp_rate - AnalyticsTargets.FALSE_POSITIVE_TARGET
                }
            )
    
    async def _trigger_bias_alert(self, bias_score: float, bias_details: Dict) -> None:
        """Trigger alert when bias exceeds threshold."""
        if self.notification_service:
            await self.notification_service.send_alert(
                alert_type="bias_threshold_exceeded",
                message=f"System bias score ({bias_score:.3f}) exceeds threshold ({AnalyticsTargets.BIAS_THRESHOLD:.3f})",
                severity="critical",
                recipients=["admin", "fairness_team", "legal_team"],
                metadata={
                    "bias_score": bias_score,
                    "bias_threshold": AnalyticsTargets.BIAS_THRESHOLD,
                    "affected_attributes": list(bias_details.keys())
                }
            )
    
    # Placeholder implementations for other helper methods
    async def _get_detection_time_series(self, session, start_date, end_date, category_filter, supplier_filter):
        """Get time series data for detection metrics."""
        return []
    
    async def _get_category_breakdown(self, session, start_date, end_date, supplier_filter):
        """Get detection metrics broken down by category."""
        return {}
    
    async def _get_false_positive_trend(self, session, start_date, end_date):
        """Get false positive trend over time."""
        return []
    
    async def _get_false_positives_by_category(self, session, start_date, end_date):
        """Get false positives breakdown by category."""
        return {}
    
    async def _get_false_positives_by_supplier(self, session, start_date, end_date):
        """Get false positives breakdown by supplier."""
        return {}
    
    async def _get_false_positives_by_rule(self, session, start_date, end_date):
        """Get false positives breakdown by detection rule."""
        return {}
    
    async def _calculate_current_false_positive_rate(self, session, start_date, end_date):
        """Calculate current false positive rate."""
        return 0.03  # 3% placeholder
    
    def _calculate_trend_direction(self, trend_data):
        """Calculate whether trend is increasing, decreasing, or stable."""
        if len(trend_data) < 2:
            return "stable"
        
        recent_avg = statistics.mean([x["value"] for x in trend_data[-3:]])
        older_avg = statistics.mean([x["value"] for x in trend_data[:3]])
        
        if recent_avg > older_avg * 1.1:
            return "increasing"
        elif recent_avg < older_avg * 0.9:
            return "decreasing"
        else:
            return "stable"
    
    async def _analyze_false_positive_root_causes(self, session, start_date, end_date):
        """Analyze root causes of false positives."""
        return {
            "top_causes": [
                {"cause": "image_quality_issues", "percentage": 35},
                {"cause": "product_description_ambiguity", "percentage": 25},
                {"cause": "brand_similarity", "percentage": 20},
                {"cause": "price_anomalies", "percentage": 20}
            ]
        }
    
    async def _get_response_time_metrics(self, session, start_date, end_date):
        """Get response time performance metrics."""
        return {
            "avg_response_time": 2.1,
            "p50_response_time": 1.8,
            "p95_response_time": 4.2,
            "p99_response_time": 6.5
        }
    
    async def _get_throughput_metrics(self, session, start_date, end_date):
        """Get system throughput metrics."""
        return {
            "products_per_hour": 1200,
            "peak_hourly_throughput": 1800,
            "avg_daily_throughput": 25000
        }
    
    async def _get_error_rate_metrics(self, session, start_date, end_date):
        """Get system error rate metrics."""
        return {
            "overall_error_rate": 0.002,
            "analysis_error_rate": 0.001,
            "enforcement_error_rate": 0.001
        }
    
    async def _get_uptime_metrics(self, session, start_date, end_date):
        """Get system uptime metrics."""
        return {
            "overall_uptime": 0.998,
            "api_uptime": 0.999,
            "database_uptime": 0.997,
            "agent_uptime": 0.995
        }
    
    async def _get_agent_performance_metrics(self, session, start_date, end_date):
        """Get detailed agent performance metrics."""
        return {
            "authenticity_agent": {
                "uptime": 0.995,
                "avg_processing_time": 1.2,
                "error_rate": 0.001,
                "throughput": 500
            },
            "enforcement_agent": {
                "uptime": 0.998,
                "avg_processing_time": 0.8,
                "error_rate": 0.002,
                "throughput": 200
            }
        }
    
    async def _calculate_demographic_parity(self, session, start_date, end_date, attribute):
        """Calculate demographic parity bias metric."""
        return {
            "bias_score": 0.005,
            "groups": {},
            "interpretation": "Low bias detected"
        }
    
    async def _calculate_equalized_odds(self, session, start_date, end_date, attribute):
        """Calculate equalized odds bias metric."""
        return {
            "bias_score": 0.003,
            "groups": {},
            "interpretation": "Low bias detected"
        }
    
    async def _calculate_equality_opportunity(self, session, start_date, end_date, attribute):
        """Calculate equality of opportunity bias metric."""
        return {
            "bias_score": 0.004,
            "groups": {},
            "interpretation": "Low bias detected"
        }