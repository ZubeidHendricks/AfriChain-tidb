"""
Agent monitoring and metrics collection utilities.
"""

import asyncio
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Union
from collections import defaultdict, deque
from dataclasses import dataclass, asdict
from enum import Enum

import structlog
from redis.asyncio import Redis

from ..base import AgentMetadata, AgentStatus
from ...config.redis import get_redis_client

logger = structlog.get_logger(module=__name__)


class MetricType(Enum):
    """Types of metrics collected."""
    COUNTER = "counter"
    GAUGE = "gauge"
    HISTOGRAM = "histogram"
    TIMER = "timer"


@dataclass
class MetricPoint:
    """Single metric data point."""
    timestamp: datetime
    value: Union[int, float]
    labels: Dict[str, str]


@dataclass
class AgentMetrics:
    """Comprehensive agent metrics."""
    agent_id: str
    agent_type: str
    
    # Performance metrics
    messages_processed: int = 0
    messages_failed: int = 0
    average_response_time_ms: float = 0.0
    peak_response_time_ms: float = 0.0
    
    # Resource usage
    cpu_usage_percent: float = 0.0
    memory_usage_mb: float = 0.0
    
    # Health metrics
    uptime_seconds: int = 0
    last_heartbeat: Optional[datetime] = None
    consecutive_failures: int = 0
    error_rate: float = 0.0
    
    # Workflow metrics
    workflows_completed: int = 0
    workflows_failed: int = 0
    
    # Custom metrics
    custom_metrics: Dict[str, Any] = None
    
    def __post_init__(self):
        if self.custom_metrics is None:
            self.custom_metrics = {}


class MetricsCollector:
    """
    Centralized metrics collection and aggregation system.
    
    Features:
    - Real-time metrics collection
    - Time-series data storage
    - Aggregation and rollup
    - Alert thresholds
    """
    
    def __init__(self, retention_hours: int = 24):
        self.redis_client: Optional[Redis] = None
        self.retention_hours = retention_hours
        
        # In-memory metrics storage
        self.agent_metrics: Dict[str, AgentMetrics] = {}
        self.time_series: Dict[str, deque] = defaultdict(lambda: deque(maxlen=1440))  # 24h at 1min intervals
        
        # Aggregated metrics
        self.hourly_aggregates: Dict[str, Dict[str, Any]] = {}
        self.daily_aggregates: Dict[str, Dict[str, Any]] = {}
        
        # Alert thresholds
        self.alert_thresholds: Dict[str, Dict[str, Any]] = {
            "response_time_ms": {"warning": 1000, "critical": 5000},
            "error_rate": {"warning": 0.05, "critical": 0.10},
            "memory_usage_mb": {"warning": 500, "critical": 1000},
            "cpu_usage_percent": {"warning": 80, "critical": 95}
        }
        
        self.running_tasks: List[asyncio.Task] = []
        self.shutdown_event = asyncio.Event()
        
        self.logger = structlog.get_logger(component="metrics_collector")
    
    async def initialize(self) -> None:
        """Initialize metrics collector and start background tasks."""
        try:
            self.redis_client = await get_redis_client()
            
            # Load existing metrics from Redis
            await self._load_persisted_metrics()
            
            # Start background tasks
            self._start_background_tasks()
            
            self.logger.info("Metrics collector initialized")
            
        except Exception as e:
            self.logger.error("Failed to initialize metrics collector", error=str(e))
            raise
    
    async def shutdown(self) -> None:
        """Shutdown collector and persist final metrics."""
        try:
            self.shutdown_event.set()
            
            # Cancel background tasks
            for task in self.running_tasks:
                task.cancel()
            
            if self.running_tasks:
                await asyncio.gather(*self.running_tasks, return_exceptions=True)
            
            # Persist final metrics
            await self._persist_metrics()
            
            # Close Redis connection
            if self.redis_client:
                await self.redis_client.close()
            
            self.logger.info("Metrics collector shutdown")
            
        except Exception as e:
            self.logger.error("Error during metrics collector shutdown", error=str(e))
    
    async def record_agent_metric(
        self,
        agent_id: str,
        metric_name: str,
        value: Union[int, float],
        metric_type: MetricType = MetricType.GAUGE,
        labels: Optional[Dict[str, str]] = None
    ) -> None:
        """
        Record a metric for a specific agent.
        
        Args:
            agent_id: Agent identifier
            metric_name: Name of the metric
            value: Metric value
            metric_type: Type of metric
            labels: Optional labels for the metric
        """
        try:
            timestamp = datetime.utcnow()
            labels = labels or {}
            labels["agent_id"] = agent_id
            
            # Create metric point
            point = MetricPoint(
                timestamp=timestamp,
                value=value,
                labels=labels
            )
            
            # Store in time series
            series_key = f"{agent_id}.{metric_name}"
            self.time_series[series_key].append(point)
            
            # Update agent metrics
            if agent_id not in self.agent_metrics:
                await self._initialize_agent_metrics(agent_id)
            
            await self._update_agent_metric(agent_id, metric_name, value, metric_type)
            
            # Check for alerts
            await self._check_alert_thresholds(agent_id, metric_name, value)
            
            self.logger.debug(
                "Metric recorded",
                agent_id=agent_id,
                metric_name=metric_name,
                value=value,
                metric_type=metric_type.value
            )
            
        except Exception as e:
            self.logger.error(
                "Failed to record metric",
                agent_id=agent_id,
                metric_name=metric_name,
                error=str(e)
            )
    
    async def record_message_processed(
        self,
        agent_id: str,
        processing_time_ms: float,
        success: bool,
        message_type: str
    ) -> None:
        """Record message processing metrics."""
        await self.record_agent_metric(
            agent_id=agent_id,
            metric_name="messages_processed_total",
            value=1,
            metric_type=MetricType.COUNTER,
            labels={"message_type": message_type, "success": str(success)}
        )
        
        await self.record_agent_metric(
            agent_id=agent_id,
            metric_name="message_processing_time_ms",
            value=processing_time_ms,
            metric_type=MetricType.HISTOGRAM,
            labels={"message_type": message_type}
        )
        
        # Update agent metrics
        if agent_id in self.agent_metrics:
            metrics = self.agent_metrics[agent_id]
            if success:
                metrics.messages_processed += 1
            else:
                metrics.messages_failed += 1
            
            # Update response time averages
            if metrics.messages_processed > 0:
                total_messages = metrics.messages_processed + metrics.messages_failed
                metrics.average_response_time_ms = (
                    (metrics.average_response_time_ms * (total_messages - 1) + processing_time_ms) /
                    total_messages
                )
                metrics.peak_response_time_ms = max(metrics.peak_response_time_ms, processing_time_ms)
            
            # Update error rate
            if total_messages > 0:
                metrics.error_rate = metrics.messages_failed / total_messages
    
    async def record_workflow_completion(
        self,
        agent_id: str,
        workflow_id: str,
        success: bool,
        execution_time_ms: float
    ) -> None:
        """Record workflow completion metrics."""
        await self.record_agent_metric(
            agent_id=agent_id,
            metric_name="workflows_completed_total",
            value=1,
            metric_type=MetricType.COUNTER,
            labels={"workflow_id": workflow_id, "success": str(success)}
        )
        
        await self.record_agent_metric(
            agent_id=agent_id,
            metric_name="workflow_execution_time_ms",
            value=execution_time_ms,
            metric_type=MetricType.HISTOGRAM,
            labels={"workflow_id": workflow_id}
        )
        
        # Update agent metrics
        if agent_id in self.agent_metrics:
            metrics = self.agent_metrics[agent_id]
            if success:
                metrics.workflows_completed += 1
            else:
                metrics.workflows_failed += 1
    
    async def record_resource_usage(
        self,
        agent_id: str,
        cpu_percent: float,
        memory_mb: float
    ) -> None:
        """Record resource usage metrics."""
        await self.record_agent_metric(
            agent_id=agent_id,
            metric_name="cpu_usage_percent",
            value=cpu_percent,
            metric_type=MetricType.GAUGE
        )
        
        await self.record_agent_metric(
            agent_id=agent_id,
            metric_name="memory_usage_mb",
            value=memory_mb,
            metric_type=MetricType.GAUGE
        )
        
        # Update agent metrics
        if agent_id in self.agent_metrics:
            metrics = self.agent_metrics[agent_id]
            metrics.cpu_usage_percent = cpu_percent
            metrics.memory_usage_mb = memory_mb
    
    def get_agent_metrics(self, agent_id: str) -> Optional[AgentMetrics]:
        """Get current metrics for an agent."""
        return self.agent_metrics.get(agent_id)
    
    def get_all_agent_metrics(self) -> Dict[str, AgentMetrics]:
        """Get metrics for all agents."""
        return self.agent_metrics.copy()
    
    def get_time_series(
        self,
        agent_id: str,
        metric_name: str,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None
    ) -> List[MetricPoint]:
        """
        Get time series data for a specific metric.
        
        Args:
            agent_id: Agent identifier
            metric_name: Metric name
            start_time: Optional start time filter
            end_time: Optional end time filter
            
        Returns:
            List of metric points
        """
        series_key = f"{agent_id}.{metric_name}"
        points = list(self.time_series.get(series_key, []))
        
        if start_time or end_time:
            filtered_points = []
            for point in points:
                if start_time and point.timestamp < start_time:
                    continue
                if end_time and point.timestamp > end_time:
                    continue
                filtered_points.append(point)
            points = filtered_points
        
        return points
    
    def get_aggregated_metrics(
        self,
        time_window: str = "1h"
    ) -> Dict[str, Dict[str, Any]]:
        """
        Get aggregated metrics for specified time window.
        
        Args:
            time_window: Time window for aggregation ("1h", "1d")
            
        Returns:
            Aggregated metrics by agent
        """
        if time_window == "1h":
            return self.hourly_aggregates.copy()
        elif time_window == "1d":
            return self.daily_aggregates.copy()
        else:
            raise ValueError(f"Unsupported time window: {time_window}")
    
    def get_health_summary(self) -> Dict[str, Any]:
        """Get overall health summary of all agents."""
        total_agents = len(self.agent_metrics)
        healthy_agents = 0
        warning_agents = 0
        critical_agents = 0
        
        total_messages = 0
        total_errors = 0
        total_workflows = 0
        
        for metrics in self.agent_metrics.values():
            # Health categorization
            if (metrics.error_rate < 0.01 and 
                metrics.average_response_time_ms < 500 and
                metrics.consecutive_failures == 0):
                healthy_agents += 1
            elif (metrics.error_rate < 0.05 and 
                  metrics.average_response_time_ms < 2000 and
                  metrics.consecutive_failures < 3):
                warning_agents += 1
            else:
                critical_agents += 1
            
            # Aggregate totals
            total_messages += metrics.messages_processed
            total_errors += metrics.messages_failed
            total_workflows += metrics.workflows_completed
        
        return {
            "total_agents": total_agents,
            "healthy_agents": healthy_agents,
            "warning_agents": warning_agents,
            "critical_agents": critical_agents,
            "total_messages_processed": total_messages,
            "total_errors": total_errors,
            "total_workflows_completed": total_workflows,
            "overall_error_rate": total_errors / max(total_messages, 1),
            "timestamp": datetime.utcnow().isoformat()
        }
    
    async def _initialize_agent_metrics(self, agent_id: str) -> None:
        """Initialize metrics structure for new agent."""
        # Try to determine agent type from registry or metadata
        agent_type = "unknown"
        
        self.agent_metrics[agent_id] = AgentMetrics(
            agent_id=agent_id,
            agent_type=agent_type
        )
    
    async def _update_agent_metric(
        self,
        agent_id: str,
        metric_name: str,
        value: Union[int, float],
        metric_type: MetricType
    ) -> None:
        """Update agent-specific metric values."""
        if agent_id not in self.agent_metrics:
            return
        
        metrics = self.agent_metrics[agent_id]
        
        # Update specific metrics based on name
        if metric_name == "cpu_usage_percent":
            metrics.cpu_usage_percent = value
        elif metric_name == "memory_usage_mb":
            metrics.memory_usage_mb = value
        elif metric_name.startswith("response_time"):
            if metrics.messages_processed > 0:
                metrics.average_response_time_ms = (
                    (metrics.average_response_time_ms * (metrics.messages_processed - 1) + value) /
                    metrics.messages_processed
                )
            metrics.peak_response_time_ms = max(metrics.peak_response_time_ms, value)
    
    async def _check_alert_thresholds(
        self,
        agent_id: str,
        metric_name: str,
        value: Union[int, float]
    ) -> None:
        """Check if metric value exceeds alert thresholds."""
        if metric_name not in self.alert_thresholds:
            return
        
        thresholds = self.alert_thresholds[metric_name]
        
        alert_level = None
        if value >= thresholds.get("critical", float('inf')):
            alert_level = "critical"
        elif value >= thresholds.get("warning", float('inf')):
            alert_level = "warning"
        
        if alert_level:
            await self._emit_alert(agent_id, metric_name, value, alert_level)
    
    async def _emit_alert(
        self,
        agent_id: str,
        metric_name: str,
        value: Union[int, float],
        level: str
    ) -> None:
        """Emit alert for threshold violation."""
        alert = {
            "timestamp": datetime.utcnow().isoformat(),
            "agent_id": agent_id,
            "metric_name": metric_name,
            "value": value,
            "level": level,
            "threshold": self.alert_thresholds[metric_name][level]
        }
        
        # Log alert
        self.logger.warning(
            "Metric alert triggered",
            **alert
        )
        
        # Publish alert to Redis channel
        if self.redis_client:
            try:
                await self.redis_client.publish(
                    f"alerts.{level}",
                    json.dumps(alert)
                )
            except Exception as e:
                self.logger.error("Failed to publish alert", error=str(e))
    
    def _start_background_tasks(self) -> None:
        """Start background maintenance tasks."""
        # Metrics aggregation task
        aggregation_task = asyncio.create_task(self._aggregate_metrics())
        self.running_tasks.append(aggregation_task)
        
        # Persistence task
        persistence_task = asyncio.create_task(self._periodic_persistence())
        self.running_tasks.append(persistence_task)
        
        # Cleanup task
        cleanup_task = asyncio.create_task(self._cleanup_old_metrics())
        self.running_tasks.append(cleanup_task)
    
    async def _aggregate_metrics(self) -> None:
        """Periodically aggregate metrics into hourly and daily summaries."""
        while not self.shutdown_event.is_set():
            try:
                current_time = datetime.utcnow()
                
                # Aggregate hourly metrics
                hour_key = current_time.strftime("%Y-%m-%d-%H")
                if hour_key not in self.hourly_aggregates:
                    self.hourly_aggregates[hour_key] = self._calculate_hourly_aggregates(current_time)
                
                # Aggregate daily metrics (at midnight)
                if current_time.hour == 0 and current_time.minute < 5:
                    day_key = current_time.strftime("%Y-%m-%d")
                    if day_key not in self.daily_aggregates:
                        self.daily_aggregates[day_key] = self._calculate_daily_aggregates(current_time)
                
                await asyncio.sleep(300)  # Aggregate every 5 minutes
                
            except Exception as e:
                self.logger.error("Error in metrics aggregation", error=str(e))
                await asyncio.sleep(60)
    
    async def _periodic_persistence(self) -> None:
        """Periodically persist metrics to Redis."""
        while not self.shutdown_event.is_set():
            try:
                await self._persist_metrics()
                await asyncio.sleep(600)  # Persist every 10 minutes
                
            except Exception as e:
                self.logger.error("Error in metrics persistence", error=str(e))
                await asyncio.sleep(60)
    
    async def _cleanup_old_metrics(self) -> None:
        """Clean up old metrics data."""
        while not self.shutdown_event.is_set():
            try:
                cutoff_time = datetime.utcnow() - timedelta(hours=self.retention_hours)
                
                # Clean up time series data
                for series_key, points in self.time_series.items():
                    # Remove old points (deque should handle this automatically with maxlen)
                    while points and points[0].timestamp < cutoff_time:
                        points.popleft()
                
                # Clean up hourly aggregates
                hour_cutoff = datetime.utcnow() - timedelta(days=7)
                old_hours = [
                    key for key in self.hourly_aggregates.keys()
                    if datetime.strptime(key, "%Y-%m-%d-%H") < hour_cutoff
                ]
                for key in old_hours:
                    del self.hourly_aggregates[key]
                
                # Clean up daily aggregates
                day_cutoff = datetime.utcnow() - timedelta(days=30)
                old_days = [
                    key for key in self.daily_aggregates.keys()
                    if datetime.strptime(key, "%Y-%m-%d") < day_cutoff
                ]
                for key in old_days:
                    del self.daily_aggregates[key]
                
                await asyncio.sleep(3600)  # Cleanup every hour
                
            except Exception as e:
                self.logger.error("Error in metrics cleanup", error=str(e))
                await asyncio.sleep(300)
    
    def _calculate_hourly_aggregates(self, current_time: datetime) -> Dict[str, Any]:
        """Calculate hourly metric aggregates."""
        # Implementation would aggregate metrics over the past hour
        # For now, return current snapshot
        return {
            "timestamp": current_time.isoformat(),
            "agent_count": len(self.agent_metrics),
            "total_messages": sum(m.messages_processed for m in self.agent_metrics.values()),
            "total_errors": sum(m.messages_failed for m in self.agent_metrics.values()),
            "average_response_time": sum(m.average_response_time_ms for m in self.agent_metrics.values()) / max(len(self.agent_metrics), 1)
        }
    
    def _calculate_daily_aggregates(self, current_time: datetime) -> Dict[str, Any]:
        """Calculate daily metric aggregates."""
        # Similar to hourly but for the full day
        return self._calculate_hourly_aggregates(current_time)
    
    async def _persist_metrics(self) -> None:
        """Persist current metrics to Redis."""
        if not self.redis_client:
            return
        
        try:
            # Persist agent metrics
            for agent_id, metrics in self.agent_metrics.items():
                key = f"metrics:agent:{agent_id}"
                value = json.dumps(asdict(metrics), default=str)
                await self.redis_client.setex(key, 3600, value)  # 1 hour TTL
            
            # Persist aggregates
            for time_key, data in self.hourly_aggregates.items():
                key = f"metrics:hourly:{time_key}"
                value = json.dumps(data, default=str)
                await self.redis_client.setex(key, 86400, value)  # 24 hour TTL
            
        except Exception as e:
            self.logger.error("Failed to persist metrics", error=str(e))
    
    async def _load_persisted_metrics(self) -> None:
        """Load persisted metrics from Redis."""
        if not self.redis_client:
            return
        
        try:
            # Load agent metrics
            keys = await self.redis_client.keys("metrics:agent:*")
            for key in keys:
                value = await self.redis_client.get(key)
                if value:
                    data = json.loads(value)
                    agent_id = data["agent_id"]
                    # Convert back to AgentMetrics object
                    self.agent_metrics[agent_id] = AgentMetrics(**data)
            
            self.logger.info("Loaded persisted metrics", agent_count=len(self.agent_metrics))
            
        except Exception as e:
            self.logger.error("Failed to load persisted metrics", error=str(e))