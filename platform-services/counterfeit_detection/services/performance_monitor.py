"""
Performance Monitor for comprehensive system performance tracking and optimization.

Monitors response times, throughput, error rates, resource utilization,
and provides performance optimization recommendations and alerting.
"""

import asyncio
import psutil
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, asdict
from enum import Enum
import statistics
from collections import defaultdict, deque

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db_session
from ..db.repositories.analytics_repository import AnalyticsRepository
from ..services.metrics_collector import MetricsCollector, MetricType, MetricEvent
from ..services.notification_service import NotificationService

logger = structlog.get_logger(__name__)


class PerformanceStatus(str, Enum):
    """Performance status levels."""
    EXCELLENT = "excellent"
    GOOD = "good"
    DEGRADED = "degraded"
    CRITICAL = "critical"


class AlertType(str, Enum):
    """Performance alert types."""
    RESPONSE_TIME_HIGH = "response_time_high"
    THROUGHPUT_LOW = "throughput_low"
    ERROR_RATE_HIGH = "error_rate_high"
    RESOURCE_EXHAUSTION = "resource_exhaustion"
    AGENT_DOWNTIME = "agent_downtime"


@dataclass
class PerformanceThresholds:
    """Performance monitoring thresholds."""
    # Response time thresholds (seconds)
    response_time_good: float = 1.0
    response_time_degraded: float = 3.0
    response_time_critical: float = 5.0
    
    # Throughput thresholds (operations per minute)
    throughput_good: float = 100
    throughput_degraded: float = 50
    throughput_critical: float = 20
    
    # Error rate thresholds (percentage)
    error_rate_good: float = 1.0
    error_rate_degraded: float = 3.0
    error_rate_critical: float = 5.0
    
    # Resource utilization thresholds (percentage)
    cpu_good: float = 60
    cpu_degraded: float = 80
    cpu_critical: float = 90
    
    memory_good: float = 70
    memory_degraded: float = 85
    memory_critical: float = 95
    
    # Agent uptime thresholds (percentage)
    uptime_good: float = 99.0
    uptime_degraded: float = 95.0
    uptime_critical: float = 90.0


@dataclass
class ComponentMetrics:
    """Performance metrics for a system component."""
    component_name: str
    response_time_avg: float
    response_time_p95: float
    response_time_p99: float
    throughput: float
    error_rate: float
    uptime_percent: float
    last_error: Optional[str]
    status: PerformanceStatus
    timestamp: datetime


@dataclass
class SystemHealth:
    """Overall system health assessment."""
    overall_status: PerformanceStatus
    components: List[ComponentMetrics]
    resource_usage: Dict[str, float]
    active_alerts: List[Dict[str, Any]]
    performance_score: float
    recommendations: List[str]
    timestamp: datetime


@dataclass
class PerformanceOptimization:
    """Performance optimization recommendation."""
    component: str
    issue_type: str
    current_value: float
    target_value: float
    impact: str  # "high", "medium", "low"
    effort: str  # "high", "medium", "low"
    description: str
    implementation_steps: List[str]


class PerformanceMonitor:
    """Service for monitoring and optimizing system performance."""
    
    def __init__(self, metrics_collector: Optional[MetricsCollector] = None):
        """Initialize performance monitor."""
        self.metrics_collector = metrics_collector
        self.analytics_repository: Optional[AnalyticsRepository] = None
        self.notification_service: Optional[NotificationService] = None
        
        # Thresholds
        self.thresholds = PerformanceThresholds()
        
        # Monitoring state
        self.component_metrics = {}
        self.active_alerts = {}
        self.performance_history = defaultdict(lambda: deque(maxlen=1440))  # 24h of minute data
        
        # Background tasks
        self._background_tasks: List[asyncio.Task] = []
        self._monitoring = False
    
    async def start_monitoring(self, interval_seconds: int = 60) -> None:
        """Start continuous performance monitoring."""
        try:
            self._monitoring = True
            
            # Start monitoring tasks
            self._background_tasks = [
                asyncio.create_task(self._monitor_components_loop(interval_seconds)),
                asyncio.create_task(self._monitor_system_resources_loop(interval_seconds)),
                asyncio.create_task(self._analyze_performance_trends_loop(300)),  # Every 5 minutes
                asyncio.create_task(self._check_alerts_loop(30))  # Every 30 seconds
            ]
            
            logger.info("Performance monitoring started", interval=interval_seconds)
            
        except Exception as e:
            logger.error("Failed to start performance monitoring", error=str(e))
            raise
    
    async def stop_monitoring(self) -> None:
        """Stop performance monitoring."""
        self._monitoring = False
        
        # Cancel background tasks
        for task in self._background_tasks:
            task.cancel()
        
        # Wait for tasks to complete
        if self._background_tasks:
            await asyncio.gather(*self._background_tasks, return_exceptions=True)
        
        logger.info("Performance monitoring stopped")
    
    async def get_system_health(self) -> SystemHealth:
        """Get comprehensive system health assessment."""
        try:
            current_time = datetime.utcnow()
            
            # Get component metrics
            components = []
            component_statuses = []
            
            for component_name in ["authenticity_analyzer", "enforcement_agent", "api_server", "vector_search"]:
                metrics = await self._get_component_metrics(component_name)
                if metrics:
                    components.append(metrics)
                    component_statuses.append(metrics.status)
            
            # Get resource usage
            resource_usage = await self._get_system_resources()
            
            # Determine overall status
            if not component_statuses:
                overall_status = PerformanceStatus.CRITICAL
            elif all(status == PerformanceStatus.EXCELLENT for status in component_statuses):
                overall_status = PerformanceStatus.EXCELLENT
            elif all(status in [PerformanceStatus.EXCELLENT, PerformanceStatus.GOOD] for status in component_statuses):
                overall_status = PerformanceStatus.GOOD
            elif any(status == PerformanceStatus.CRITICAL for status in component_statuses):
                overall_status = PerformanceStatus.CRITICAL
            else:
                overall_status = PerformanceStatus.DEGRADED
            
            # Calculate performance score (0-100)
            performance_score = self._calculate_performance_score(components, resource_usage)
            
            # Get active alerts
            active_alerts = list(self.active_alerts.values())
            
            # Generate recommendations
            recommendations = await self._generate_performance_recommendations(components, resource_usage)
            
            return SystemHealth(
                overall_status=overall_status,
                components=components,
                resource_usage=resource_usage,
                active_alerts=active_alerts,
                performance_score=performance_score,
                recommendations=recommendations,
                timestamp=current_time
            )
            
        except Exception as e:
            logger.error("Failed to get system health", error=str(e))
            raise
    
    async def _get_component_metrics(self, component_name: str) -> Optional[ComponentMetrics]:
        """Get performance metrics for a specific component."""
        try:
            current_time = datetime.utcnow()
            lookback_time = current_time - timedelta(minutes=5)
            
            # Get metrics from collector or repository
            if self.metrics_collector:
                # Get recent metrics from metrics collector
                snapshot = await self.metrics_collector.get_performance_snapshot()
                
                response_time_avg = snapshot.response_times.get(component_name, 0)
                throughput = snapshot.throughput.get(component_name, 0)
                agent_status = snapshot.agent_status.get(component_name, "unknown")
                
                # Simulate other metrics (in real implementation, get from actual data)
                response_time_p95 = response_time_avg * 1.5
                response_time_p99 = response_time_avg * 2.0
                error_rate = 0.5  # Default low error rate
                uptime_percent = 99.0 if agent_status == "healthy" else 85.0
                
            else:
                # Fallback to repository data
                async with get_db_session() as session:
                    if not self.analytics_repository:
                        self.analytics_repository = AnalyticsRepository(session)
                    
                    perf_metrics = await self.analytics_repository.get_performance_metrics(
                        lookback_time, current_time, component_name
                    )
                    
                    response_time_avg = perf_metrics["response_time"]["avg_ms"] / 1000
                    response_time_p95 = perf_metrics["response_time"]["p95_ms"] / 1000
                    response_time_p99 = perf_metrics["response_time"]["p99_ms"] / 1000
                    throughput = perf_metrics["throughput"]["operations_per_hour"] / 60
                    error_rate = perf_metrics["reliability"]["error_rate_percent"]
                    uptime_percent = 99.0  # Default
            
            # Determine status based on thresholds
            status = self._determine_component_status(
                response_time_avg, throughput, error_rate, uptime_percent
            )
            
            return ComponentMetrics(
                component_name=component_name,
                response_time_avg=response_time_avg,
                response_time_p95=response_time_p95,
                response_time_p99=response_time_p99,
                throughput=throughput,
                error_rate=error_rate,
                uptime_percent=uptime_percent,
                last_error=None,
                status=status,
                timestamp=current_time
            )
            
        except Exception as e:
            logger.error("Failed to get component metrics", component=component_name, error=str(e))
            return None
    
    def _determine_component_status(
        self,
        response_time: float,
        throughput: float,
        error_rate: float,
        uptime: float
    ) -> PerformanceStatus:
        """Determine component status based on metrics."""
        # Critical conditions
        if (response_time > self.thresholds.response_time_critical or
            throughput < self.thresholds.throughput_critical or
            error_rate > self.thresholds.error_rate_critical or
            uptime < self.thresholds.uptime_critical):
            return PerformanceStatus.CRITICAL
        
        # Degraded conditions
        if (response_time > self.thresholds.response_time_degraded or
            throughput < self.thresholds.throughput_degraded or
            error_rate > self.thresholds.error_rate_degraded or
            uptime < self.thresholds.uptime_degraded):
            return PerformanceStatus.DEGRADED
        
        # Good conditions
        if (response_time > self.thresholds.response_time_good or
            throughput < self.thresholds.throughput_good or
            error_rate > self.thresholds.error_rate_good or
            uptime < self.thresholds.uptime_good):
            return PerformanceStatus.GOOD
        
        return PerformanceStatus.EXCELLENT
    
    async def _get_system_resources(self) -> Dict[str, float]:
        """Get system resource utilization."""
        try:
            # CPU usage
            cpu_percent = psutil.cpu_percent(interval=1)
            
            # Memory usage
            memory = psutil.virtual_memory()
            memory_percent = memory.percent
            
            # Disk usage
            disk = psutil.disk_usage('/')
            disk_percent = disk.percent
            
            # Network I/O (bytes per second)
            net_io = psutil.net_io_counters()
            
            return {
                "cpu_percent": cpu_percent,
                "memory_percent": memory_percent,
                "disk_percent": disk_percent,
                "network_bytes_sent": float(net_io.bytes_sent),
                "network_bytes_recv": float(net_io.bytes_recv)
            }
            
        except Exception as e:
            logger.error("Failed to get system resources", error=str(e))
            return {}
    
    def _calculate_performance_score(
        self,
        components: List[ComponentMetrics],
        resource_usage: Dict[str, float]
    ) -> float:
        """Calculate overall performance score (0-100)."""
        if not components:
            return 0.0
        
        # Component scores
        component_scores = []
        for component in components:
            score = 100.0
            
            # Response time penalty
            if component.response_time_avg > self.thresholds.response_time_critical:
                score -= 40
            elif component.response_time_avg > self.thresholds.response_time_degraded:
                score -= 20
            elif component.response_time_avg > self.thresholds.response_time_good:
                score -= 10
            
            # Error rate penalty
            if component.error_rate > self.thresholds.error_rate_critical:
                score -= 30
            elif component.error_rate > self.thresholds.error_rate_degraded:
                score -= 15
            elif component.error_rate > self.thresholds.error_rate_good:
                score -= 5
            
            # Uptime penalty
            uptime_penalty = max(0, (100 - component.uptime_percent) * 2)
            score -= uptime_penalty
            
            component_scores.append(max(0, score))
        
        # Average component score
        avg_component_score = statistics.mean(component_scores)
        
        # Resource penalty
        resource_penalty = 0
        cpu_usage = resource_usage.get("cpu_percent", 0)
        memory_usage = resource_usage.get("memory_percent", 0)
        
        if cpu_usage > self.thresholds.cpu_critical or memory_usage > self.thresholds.memory_critical:
            resource_penalty = 20
        elif cpu_usage > self.thresholds.cpu_degraded or memory_usage > self.thresholds.memory_degraded:
            resource_penalty = 10
        elif cpu_usage > self.thresholds.cpu_good or memory_usage > self.thresholds.memory_good:
            resource_penalty = 5
        
        final_score = max(0, avg_component_score - resource_penalty)
        return round(final_score, 1)
    
    async def _generate_performance_recommendations(
        self,
        components: List[ComponentMetrics],
        resource_usage: Dict[str, float]
    ) -> List[str]:
        """Generate performance optimization recommendations."""
        recommendations = []
        
        # Component-specific recommendations
        for component in components:
            if component.status == PerformanceStatus.CRITICAL:
                recommendations.append(
                    f"CRITICAL: {component.component_name} performance severely degraded "
                    f"(response time: {component.response_time_avg:.2f}s, error rate: {component.error_rate:.1f}%)"
                )
            elif component.status == PerformanceStatus.DEGRADED:
                recommendations.append(
                    f"Optimize {component.component_name} performance "
                    f"(current response time: {component.response_time_avg:.2f}s)"
                )
            
            # Specific recommendations based on metrics
            if component.response_time_avg > self.thresholds.response_time_degraded:
                recommendations.append(
                    f"Consider scaling {component.component_name} horizontally or optimizing algorithms"
                )
            
            if component.error_rate > self.thresholds.error_rate_degraded:
                recommendations.append(
                    f"Investigate and fix error sources in {component.component_name} "
                    f"(current error rate: {component.error_rate:.1f}%)"
                )
        
        # Resource-based recommendations
        cpu_usage = resource_usage.get("cpu_percent", 0)
        memory_usage = resource_usage.get("memory_percent", 0)
        
        if cpu_usage > self.thresholds.cpu_critical:
            recommendations.append(
                f"URGENT: CPU usage critically high ({cpu_usage:.1f}%) - scale infrastructure immediately"
            )
        elif cpu_usage > self.thresholds.cpu_degraded:
            recommendations.append(
                f"Consider adding CPU resources (current usage: {cpu_usage:.1f}%)"
            )
        
        if memory_usage > self.thresholds.memory_critical:
            recommendations.append(
                f"URGENT: Memory usage critically high ({memory_usage:.1f}%) - scale infrastructure immediately"
            )
        elif memory_usage > self.thresholds.memory_degraded:
            recommendations.append(
                f"Consider adding memory resources (current usage: {memory_usage:.1f}%)"
            )
        
        # General optimization recommendations
        if not recommendations:
            recommendations.extend([
                "System performance is within acceptable parameters",
                "Continue monitoring for performance trends",
                "Consider proactive capacity planning based on usage patterns"
            ])
        
        return recommendations[:10]  # Limit to top 10 recommendations
    
    async def _monitor_components_loop(self, interval_seconds: int) -> None:
        """Background task to monitor component performance."""
        while self._monitoring:
            try:
                for component in ["authenticity_analyzer", "enforcement_agent", "api_server"]:
                    metrics = await self._get_component_metrics(component)
                    if metrics:
                        self.component_metrics[component] = metrics
                        
                        # Store in history
                        self.performance_history[component].append({
                            "timestamp": metrics.timestamp,
                            "response_time": metrics.response_time_avg,
                            "throughput": metrics.throughput,
                            "error_rate": metrics.error_rate,
                            "status": metrics.status.value
                        })
                
                await asyncio.sleep(interval_seconds)
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Error in component monitoring loop", error=str(e))
                await asyncio.sleep(interval_seconds)
    
    async def _monitor_system_resources_loop(self, interval_seconds: int) -> None:
        """Background task to monitor system resources."""
        while self._monitoring:
            try:
                resources = await self._get_system_resources()
                
                # Record metrics
                if self.metrics_collector:
                    for resource, value in resources.items():
                        await self.metrics_collector.record_metric(
                            MetricEvent(
                                metric_type=MetricType.SYSTEM_RESOURCE,
                                timestamp=datetime.utcnow(),
                                component="system",
                                value=value,
                                metadata={"resource_type": resource},
                                tags={"resource": resource}
                            )
                        )
                
                await asyncio.sleep(interval_seconds)
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Error in resource monitoring loop", error=str(e))
                await asyncio.sleep(interval_seconds)
    
    async def _analyze_performance_trends_loop(self, interval_seconds: int) -> None:
        """Background task to analyze performance trends."""
        while self._monitoring:
            try:
                await self._analyze_performance_trends()
                await asyncio.sleep(interval_seconds)
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Error in trend analysis loop", error=str(e))
                await asyncio.sleep(interval_seconds)
    
    async def _analyze_performance_trends(self) -> None:
        """Analyze performance trends and generate insights."""
        try:
            for component, history in self.performance_history.items():
                if len(history) < 10:  # Need at least 10 data points
                    continue
                
                # Analyze response time trend
                recent_response_times = [h["response_time"] for h in list(history)[-10:]]
                older_response_times = [h["response_time"] for h in list(history)[-20:-10]]
                
                if older_response_times:
                    recent_avg = statistics.mean(recent_response_times)
                    older_avg = statistics.mean(older_response_times)
                    
                    # Check for degradation
                    if recent_avg > older_avg * 1.5:  # 50% increase
                        logger.warning(
                            "Performance degradation detected",
                            component=component,
                            recent_avg=recent_avg,
                            older_avg=older_avg
                        )
            
        except Exception as e:
            logger.error("Failed to analyze performance trends", error=str(e))
    
    async def _check_alerts_loop(self, interval_seconds: int) -> None:
        """Background task to check and trigger performance alerts."""
        while self._monitoring:
            try:
                await self._check_performance_alerts()
                await asyncio.sleep(interval_seconds)
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Error in alert checking loop", error=str(e))
                await asyncio.sleep(interval_seconds)
    
    async def _check_performance_alerts(self) -> None:
        """Check performance metrics and trigger alerts if needed."""
        try:
            current_time = datetime.utcnow()
            
            # Check component metrics
            for component, metrics in self.component_metrics.items():
                alert_key = f"{component}_performance"
                
                # Response time alert
                if metrics.response_time_avg > self.thresholds.response_time_critical:
                    if alert_key not in self.active_alerts:
                        await self._trigger_alert(
                            AlertType.RESPONSE_TIME_HIGH,
                            component,
                            f"{component} response time critically high: {metrics.response_time_avg:.2f}s",
                            {"response_time": metrics.response_time_avg, "threshold": self.thresholds.response_time_critical}
                        )
                        self.active_alerts[alert_key] = {
                            "type": AlertType.RESPONSE_TIME_HIGH.value,
                            "component": component,
                            "triggered_at": current_time,
                            "value": metrics.response_time_avg
                        }
                elif alert_key in self.active_alerts:
                    # Clear alert if condition resolved
                    del self.active_alerts[alert_key]
                    logger.info("Performance alert resolved", component=component, alert_type="response_time")
            
            # Check system resources
            resources = await self._get_system_resources()
            cpu_usage = resources.get("cpu_percent", 0)
            memory_usage = resources.get("memory_percent", 0)
            
            # CPU alert
            if cpu_usage > self.thresholds.cpu_critical:
                alert_key = "system_cpu"
                if alert_key not in self.active_alerts:
                    await self._trigger_alert(
                        AlertType.RESOURCE_EXHAUSTION,
                        "system",
                        f"CPU usage critically high: {cpu_usage:.1f}%",
                        {"cpu_usage": cpu_usage, "threshold": self.thresholds.cpu_critical}
                    )
                    self.active_alerts[alert_key] = {
                        "type": AlertType.RESOURCE_EXHAUSTION.value,
                        "component": "system",
                        "triggered_at": current_time,
                        "value": cpu_usage
                    }
            
            # Memory alert
            if memory_usage > self.thresholds.memory_critical:
                alert_key = "system_memory"
                if alert_key not in self.active_alerts:
                    await self._trigger_alert(
                        AlertType.RESOURCE_EXHAUSTION,
                        "system",
                        f"Memory usage critically high: {memory_usage:.1f}%",
                        {"memory_usage": memory_usage, "threshold": self.thresholds.memory_critical}
                    )
                    self.active_alerts[alert_key] = {
                        "type": AlertType.RESOURCE_EXHAUSTION.value,
                        "component": "system",
                        "triggered_at": current_time,
                        "value": memory_usage
                    }
            
        except Exception as e:
            logger.error("Failed to check performance alerts", error=str(e))
    
    async def _trigger_alert(
        self,
        alert_type: AlertType,
        component: str,
        message: str,
        metadata: Dict[str, Any]
    ) -> None:
        """Trigger a performance alert."""
        try:
            if self.notification_service:
                severity = "critical" if "critical" in message.lower() else "high"
                
                await self.notification_service.send_alert(
                    alert_type=alert_type.value,
                    message=message,
                    severity=severity,
                    recipients=["admin", "engineering_team"],
                    metadata={"component": component, **metadata}
                )
            
            logger.warning("Performance alert triggered", alert_type=alert_type.value, component=component, message=message)
            
        except Exception as e:
            logger.error("Failed to trigger performance alert", error=str(e))