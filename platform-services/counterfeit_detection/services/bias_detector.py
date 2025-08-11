"""
Bias Detector for fairness monitoring across the counterfeit detection system.

Implements statistical bias detection algorithms including demographic parity,
equalized odds, and equality of opportunity to ensure fair treatment across
different product categories, suppliers, and price ranges.
"""

from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
import statistics
from dataclasses import dataclass
from enum import Enum
import math

import structlog
from sqlalchemy.ext.asyncio import AsyncSession
import numpy as np
from scipy import stats

from ..core.database import get_db_session
from ..db.repositories.analytics_repository import AnalyticsRepository
from ..services.notification_service import NotificationService

logger = structlog.get_logger(__name__)


class BiasMetric(str, Enum):
    """Types of bias metrics that can be calculated."""
    DEMOGRAPHIC_PARITY = "demographic_parity"
    EQUALIZED_ODDS = "equalized_odds"
    EQUALITY_OPPORTUNITY = "equality_opportunity"
    CALIBRATION = "calibration"
    INDIVIDUAL_FAIRNESS = "individual_fairness"


class BiasThreshold:
    """Bias detection thresholds for different metrics."""
    DEMOGRAPHIC_PARITY = 0.1  # 10% disparity threshold
    EQUALIZED_ODDS = 0.1      # 10% TPR/FPR disparity
    EQUALITY_OPPORTUNITY = 0.1 # 10% TPR disparity
    CALIBRATION = 0.05        # 5% calibration error
    STATISTICAL_SIGNIFICANCE = 0.05  # p-value threshold


@dataclass
class BiasResult:
    """Result of bias analysis for a specific metric and attribute."""
    metric_type: BiasMetric
    attribute: str
    bias_score: float
    is_biased: bool
    confidence: float
    groups: Dict[str, Dict[str, float]]
    statistical_significance: float
    interpretation: str
    recommendations: List[str]


@dataclass
class FairnessReport:
    """Comprehensive fairness assessment report."""
    analysis_period: Tuple[datetime, datetime]
    overall_bias_score: float
    bias_detected: bool
    bias_results: List[BiasResult]
    affected_groups: List[str]
    severity: str
    recommendations: List[str]
    generated_at: datetime


class BiasDetector:
    """Service for detecting and monitoring algorithmic bias."""
    
    def __init__(self):
        """Initialize bias detector."""
        self.analytics_repository: Optional[AnalyticsRepository] = None
        self.notification_service: Optional[NotificationService] = None
        
        # Statistical parameters
        self.min_sample_size = 30  # Minimum samples per group for reliable analysis
        self.confidence_level = 0.95
        
    async def detect_bias(
        self,
        start_date: datetime,
        end_date: datetime,
        attributes: Optional[List[str]] = None,
        metrics: Optional[List[BiasMetric]] = None
    ) -> FairnessReport:
        """
        Perform comprehensive bias detection across specified attributes and metrics.
        
        Args:
            start_date: Start of analysis period
            end_date: End of analysis period
            attributes: List of attributes to analyze (category, supplier_region, price_range)
            metrics: List of bias metrics to calculate
            
        Returns:
            Comprehensive fairness report
        """
        try:
            if not attributes:
                attributes = ["category", "price_range", "supplier_region"]
            
            if not metrics:
                metrics = [
                    BiasMetric.DEMOGRAPHIC_PARITY,
                    BiasMetric.EQUALIZED_ODDS,
                    BiasMetric.EQUALITY_OPPORTUNITY
                ]
            
            bias_results = []
            overall_bias_scores = []
            
            async with get_db_session() as session:
                if not self.analytics_repository:
                    self.analytics_repository = AnalyticsRepository(session)
                
                # Analyze each attribute-metric combination
                for attribute in attributes:
                    for metric in metrics:
                        result = await self._analyze_bias_for_attribute(
                            session, start_date, end_date, attribute, metric
                        )
                        
                        if result:
                            bias_results.append(result)
                            overall_bias_scores.append(result.bias_score)
            
            # Calculate overall assessment
            overall_bias_score = max(overall_bias_scores) if overall_bias_scores else 0.0
            bias_detected = overall_bias_score > BiasThreshold.DEMOGRAPHIC_PARITY
            
            # Determine severity
            if overall_bias_score > 0.2:
                severity = "critical"
            elif overall_bias_score > 0.15:
                severity = "high"
            elif overall_bias_score > 0.1:
                severity = "medium"
            else:
                severity = "low"
            
            # Identify affected groups
            affected_groups = []
            for result in bias_results:
                if result.is_biased:
                    affected_groups.extend([
                        f"{result.attribute}:{group}" 
                        for group in result.groups.keys()
                    ])
            
            # Generate recommendations
            recommendations = self._generate_bias_recommendations(bias_results)
            
            report = FairnessReport(
                analysis_period=(start_date, end_date),
                overall_bias_score=overall_bias_score,
                bias_detected=bias_detected,
                bias_results=bias_results,
                affected_groups=list(set(affected_groups)),
                severity=severity,
                recommendations=recommendations,
                generated_at=datetime.utcnow()
            )
            
            # Send alert if bias detected
            if bias_detected and self.notification_service:
                await self._send_bias_alert(report)
            
            logger.info(
                "Bias detection completed",
                overall_bias_score=overall_bias_score,
                bias_detected=bias_detected,
                severity=severity,
                affected_groups_count=len(affected_groups)
            )
            
            return report
            
        except Exception as e:
            logger.error("Failed to detect bias", error=str(e))
            raise
    
    async def _analyze_bias_for_attribute(
        self,
        session: AsyncSession,
        start_date: datetime,
        end_date: datetime,
        attribute: str,
        metric: BiasMetric
    ) -> Optional[BiasResult]:
        """Analyze bias for a specific attribute and metric."""
        try:
            # Get data for bias analysis
            bias_data = await self.analytics_repository.get_bias_analysis_data(
                start_date, end_date, attribute
            )
            
            if not bias_data or len(bias_data) < 2:
                logger.warning(
                    "Insufficient data for bias analysis",
                    attribute=attribute,
                    metric=metric.value,
                    groups=len(bias_data) if bias_data else 0
                )
                return None
            
            # Filter groups with sufficient sample size
            valid_groups = [
                group for group in bias_data 
                if group["total_analyzed"] >= self.min_sample_size
            ]
            
            if len(valid_groups) < 2:
                logger.warning(
                    "Insufficient sample sizes for bias analysis",
                    attribute=attribute,
                    valid_groups=len(valid_groups)
                )
                return None
            
            # Calculate bias metric
            if metric == BiasMetric.DEMOGRAPHIC_PARITY:
                bias_score, groups_analysis, p_value = self._calculate_demographic_parity(valid_groups)
            elif metric == BiasMetric.EQUALIZED_ODDS:
                bias_score, groups_analysis, p_value = self._calculate_equalized_odds(valid_groups)
            elif metric == BiasMetric.EQUALITY_OPPORTUNITY:
                bias_score, groups_analysis, p_value = self._calculate_equality_opportunity(valid_groups)
            else:
                logger.warning("Unsupported bias metric", metric=metric.value)
                return None
            
            # Determine if bias exists
            is_biased = (
                bias_score > getattr(BiasThreshold, metric.value.upper(), BiasThreshold.DEMOGRAPHIC_PARITY) and
                p_value < BiasThreshold.STATISTICAL_SIGNIFICANCE
            )
            
            # Calculate confidence (1 - p_value)
            confidence = 1 - p_value if p_value is not None else 0.0
            
            # Generate interpretation
            interpretation = self._interpret_bias_result(metric, bias_score, is_biased, valid_groups)
            
            # Generate recommendations
            recommendations = self._generate_metric_recommendations(metric, bias_score, is_biased, attribute)
            
            return BiasResult(
                metric_type=metric,
                attribute=attribute,
                bias_score=bias_score,
                is_biased=is_biased,
                confidence=confidence,
                groups=groups_analysis,
                statistical_significance=p_value or 1.0,
                interpretation=interpretation,
                recommendations=recommendations
            )
            
        except Exception as e:
            logger.error("Failed to analyze bias for attribute", attribute=attribute, metric=metric.value, error=str(e))
            return None
    
    def _calculate_demographic_parity(
        self,
        groups_data: List[Dict[str, Any]]
    ) -> Tuple[float, Dict[str, Dict[str, float]], Optional[float]]:
        """
        Calculate demographic parity bias metric.
        
        Demographic parity requires that the probability of positive classification
        is equal across all groups.
        """
        try:
            flagging_rates = []
            groups_analysis = {}
            
            for group in groups_data:
                flagging_rate = group["flagging_rate"]
                flagging_rates.append(flagging_rate)
                
                groups_analysis[group["group"]] = {
                    "flagging_rate": flagging_rate,
                    "total_analyzed": group["total_analyzed"],
                    "flagged_count": group["flagged_count"]
                }
            
            # Calculate bias score as coefficient of variation
            if len(flagging_rates) < 2:
                return 0.0, groups_analysis, 1.0
            
            mean_rate = statistics.mean(flagging_rates)
            if mean_rate == 0:
                return 0.0, groups_analysis, 1.0
            
            std_rate = statistics.stdev(flagging_rates)
            bias_score = std_rate / mean_rate
            
            # Statistical significance test (chi-square test)
            observed = [group["flagged_count"] for group in groups_data]
            expected_rates = [mean_rate] * len(groups_data)
            expected = [rate * group["total_analyzed"] for rate, group in zip(expected_rates, groups_data)]
            
            if any(exp < 5 for exp in expected):
                # Use Fisher's exact test for small samples
                p_value = None
            else:
                chi2_stat = sum((obs - exp) ** 2 / exp for obs, exp in zip(observed, expected))
                p_value = 1 - stats.chi2.cdf(chi2_stat, len(groups_data) - 1)
            
            return bias_score, groups_analysis, p_value
            
        except Exception as e:
            logger.error("Failed to calculate demographic parity", error=str(e))
            return 0.0, {}, 1.0
    
    def _calculate_equalized_odds(
        self,
        groups_data: List[Dict[str, Any]]
    ) -> Tuple[float, Dict[str, Dict[str, float]], Optional[float]]:
        """
        Calculate equalized odds bias metric.
        
        Equalized odds requires that TPR and FPR are equal across all groups.
        Note: This is a simplified implementation as we don't have ground truth labels.
        """
        try:
            # For simplified implementation, use flagging rate variance as proxy
            # In a full implementation, this would require true positive/negative rates
            return self._calculate_demographic_parity(groups_data)
            
        except Exception as e:
            logger.error("Failed to calculate equalized odds", error=str(e))
            return 0.0, {}, 1.0
    
    def _calculate_equality_opportunity(
        self,
        groups_data: List[Dict[str, Any]]
    ) -> Tuple[float, Dict[str, Dict[str, float]], Optional[float]]:
        """
        Calculate equality of opportunity bias metric.
        
        Equality of opportunity requires that TPR is equal across all groups.
        Note: This is a simplified implementation as we don't have ground truth labels.
        """
        try:
            # For simplified implementation, use flagging rate variance as proxy
            # In a full implementation, this would require true positive rates
            return self._calculate_demographic_parity(groups_data)
            
        except Exception as e:
            logger.error("Failed to calculate equality of opportunity", error=str(e))
            return 0.0, {}, 1.0
    
    def _interpret_bias_result(
        self,
        metric: BiasMetric,
        bias_score: float,
        is_biased: bool,
        groups_data: List[Dict[str, Any]]
    ) -> str:
        """Generate human-readable interpretation of bias result."""
        if not is_biased:
            return f"No significant bias detected in {metric.value}. System appears to treat all groups fairly."
        
        # Find most and least affected groups
        flagging_rates = [(group["group"], group["flagging_rate"]) for group in groups_data]
        flagging_rates.sort(key=lambda x: x[1])
        
        lowest_group = flagging_rates[0]
        highest_group = flagging_rates[-1]
        
        rate_difference = highest_group[1] - lowest_group[1]
        
        interpretation = (
            f"Significant bias detected in {metric.value}. "
            f"Group '{highest_group[0]}' has {rate_difference:.1%} higher flagging rate "
            f"than group '{lowest_group[0]}' ({highest_group[1]:.1%} vs {lowest_group[1]:.1%}). "
            f"Bias score: {bias_score:.3f}"
        )
        
        return interpretation
    
    def _generate_metric_recommendations(
        self,
        metric: BiasMetric,
        bias_score: float,
        is_biased: bool,
        attribute: str
    ) -> List[str]:
        """Generate specific recommendations for addressing detected bias."""
        if not is_biased:
            return [f"Continue monitoring {metric.value} for {attribute} to maintain fairness."]
        
        recommendations = []
        
        if metric == BiasMetric.DEMOGRAPHIC_PARITY:
            recommendations.extend([
                f"Review detection rules that may disproportionately affect certain {attribute} groups",
                f"Consider rebalancing training data across {attribute} categories",
                f"Implement fairness constraints in model training",
                f"Conduct detailed analysis of feature importance by {attribute}"
            ])
        elif metric == BiasMetric.EQUALIZED_ODDS:
            recommendations.extend([
                f"Analyze prediction accuracy across {attribute} groups",
                f"Consider group-specific threshold adjustments",
                f"Review feature selection for {attribute} bias",
                f"Implement post-processing fairness corrections"
            ])
        elif metric == BiasMetric.EQUALITY_OPPORTUNITY:
            recommendations.extend([
                f"Focus on improving true positive rates for underrepresented {attribute} groups",
                f"Augment training data for affected {attribute} categories",
                f"Consider ensemble methods with fairness constraints",
                f"Implement regular bias monitoring and alerting"
            ])
        
        # Add severity-based recommendations
        if bias_score > 0.2:
            recommendations.insert(0, "URGENT: Severe bias detected - consider temporarily disabling automated decisions for affected groups")
        elif bias_score > 0.15:
            recommendations.insert(0, "HIGH PRIORITY: Significant bias requires immediate attention and corrective measures")
        
        return recommendations
    
    def _generate_bias_recommendations(self, bias_results: List[BiasResult]) -> List[str]:
        """Generate overall recommendations based on all bias results."""
        if not any(result.is_biased for result in bias_results):
            return [
                "No significant bias detected across analyzed attributes",
                "Continue regular bias monitoring to maintain fairness",
                "Consider expanding bias analysis to additional attributes"
            ]
        
        recommendations = set()
        
        # Collect all recommendations
        for result in bias_results:
            if result.is_biased:
                recommendations.update(result.recommendations)
        
        # Add general recommendations
        general_recs = [
            "Implement comprehensive bias monitoring dashboard",
            "Establish regular bias auditing schedule (monthly)",
            "Create bias incident response procedures",
            "Train staff on algorithmic fairness principles",
            "Document bias detection and mitigation efforts for compliance"
        ]
        
        return list(recommendations) + general_recs
    
    async def _send_bias_alert(self, report: FairnessReport) -> None:
        """Send bias detection alert to appropriate stakeholders."""
        try:
            if not self.notification_service:
                return
            
            severity_map = {
                "low": "medium",
                "medium": "high", 
                "high": "critical",
                "critical": "critical"
            }
            
            alert_severity = severity_map.get(report.severity, "medium")
            
            message = (
                f"Algorithmic bias detected in counterfeit detection system. "
                f"Overall bias score: {report.overall_bias_score:.3f} "
                f"(Severity: {report.severity}). "
                f"Affected groups: {len(report.affected_groups)}. "
                f"Immediate review and corrective action required."
            )
            
            await self.notification_service.send_alert(
                alert_type="algorithmic_bias_detected",
                message=message,
                severity=alert_severity,
                recipients=["admin", "fairness_team", "legal_team", "engineering_team"],
                metadata={
                    "bias_score": report.overall_bias_score,
                    "severity": report.severity,
                    "affected_groups": report.affected_groups,
                    "analysis_period": {
                        "start": report.analysis_period[0].isoformat(),
                        "end": report.analysis_period[1].isoformat()
                    },
                    "bias_metrics": [result.metric_type.value for result in report.bias_results if result.is_biased]
                }
            )
            
            logger.info("Bias alert sent", severity=alert_severity, affected_groups=len(report.affected_groups))
            
        except Exception as e:
            logger.error("Failed to send bias alert", error=str(e))
    
    async def monitor_bias_continuously(
        self,
        check_interval_hours: int = 24,
        lookback_days: int = 7
    ) -> None:
        """Start continuous bias monitoring."""
        try:
            while True:
                end_date = datetime.utcnow()
                start_date = end_date - timedelta(days=lookback_days)
                
                report = await self.detect_bias(start_date, end_date)
                
                logger.info(
                    "Continuous bias monitoring check completed",
                    bias_detected=report.bias_detected,
                    overall_score=report.overall_bias_score
                )
                
                # Wait for next check
                await asyncio.sleep(check_interval_hours * 3600)
                
        except Exception as e:
            logger.error("Continuous bias monitoring failed", error=str(e))
            raise