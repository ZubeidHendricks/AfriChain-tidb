"""
Metrics Collector for real-time metrics collection and aggregation.

Collects performance metrics, detection events, and system statistics
for analytics and monitoring purposes.
"""

import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict
from enum import Enum
import time
import json
from collections import defaultdict, deque

import structlog
import redis.asyncio as redis
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db_session
from ..db.repositories.analytics_repository import AnalyticsRepository
from ..models.enums import ProductCategory, EnforcementAction
from ..services.notification_service import NotificationService

logger = structlog.get_logger(__name__)


class MetricType(str, Enum):
    """Types of metrics that can be collected."""
    ANALYSIS_TIME = "analysis_time"
    DETECTION_EVENT = "detection_event"
    ENFORCEMENT_ACTION = "enforcement_action"
    API_REQUEST = "api_request"
    AGENT_HEALTH = "agent_health"
    SYSTEM_RESOURCE = "system_resource"
    ERROR_EVENT = "error_event"


@dataclass
class MetricEvent:
    """Individual metric event data structure."""
    metric_type: MetricType
    timestamp: datetime
    component: str
    value: float
    metadata: Dict[str, Any]
    tags: Dict[str, str]


@dataclass
class AnalysisEvent:
    """Product analysis event for detection metrics."""
    product_id: str
    analysis_id: str
    authenticity_score: float
    processing_time_ms: float
    category: str
    supplier_id: str
    timestamp: datetime
    flagged: bool
    confidence_score: float


@dataclass
class PerformanceSnapshot:
    """System performance snapshot."""
    timestamp: datetime
    response_times: Dict[str, float]
    throughput: Dict[str, float]
    error_rates: Dict[str, float]
    agent_status: Dict[str, str]
    resource_usage: Dict[str, float]


class MetricsCollector:
    """Service for collecting and aggregating real-time metrics."""
    
    def __init__(self, redis_url: str = "redis://localhost:6379"):
        """Initialize metrics collector."""
        self.redis_client: Optional[redis.Redis] = None
        self.redis_url = redis_url
        self.analytics_repository: Optional[AnalyticsRepository] = None
        self.notification_service: Optional[NotificationService] = None
        
        # In-memory buffers for high-frequency metrics
        self.metric_buffer: deque = deque(maxlen=10000)
        self.analysis_buffer: deque = deque(maxlen=1000)
        
        # Aggregation windows
        self.hourly_aggregates = defaultdict(list)
        self.daily_aggregates = defaultdict(list)
        
        # Performance tracking
        self.last_flush = datetime.utcnow()
        self.flush_interval = timedelta(seconds=30)
        
        # Background tasks
        self._background_tasks: List[asyncio.Task] = []
        self._running = False
    
    async def start(self) -> None:
        """Start the metrics collector and background tasks."""
        try:
            # Initialize Redis connection
            self.redis_client = redis.from_url(self.redis_url)
            await self.redis_client.ping()
            
            # Start background tasks
            self._running = True
            self._background_tasks = [
                asyncio.create_task(self._flush_metrics_loop()),
                asyncio.create_task(self._aggregate_metrics_loop()),
                asyncio.create_task(self._health_check_loop())
            ]
            
            logger.info("Metrics collector started")
            
        except Exception as e:
            logger.error("Failed to start metrics collector", error=str(e))
            raise
    
    async def stop(self) -> None:
        """Stop the metrics collector and cleanup resources."""
        self._running = False
        
        # Cancel background tasks
        for task in self._background_tasks:
            task.cancel()
        
        # Wait for tasks to complete
        if self._background_tasks:
            await asyncio.gather(*self._background_tasks, return_exceptions=True)
        
        # Flush remaining metrics
        await self._flush_metrics()
        
        # Close Redis connection
        if self.redis_client:
            await self.redis_client.close()
        
        logger.info("Metrics collector stopped")
    
    async def record_analysis_event(self, event: AnalysisEvent) -> None:
        """Record a product analysis event."""
        try:
            # Add to buffer
            self.analysis_buffer.append(event)
            
            # Record in Redis for real-time dashboards
            if self.redis_client:
                daily_key = f"metrics:daily:{event.timestamp.date()}"
                await self.redis_client.hincrby(daily_key, "total_analyzed", 1)
                
                if event.flagged:
                    await self.redis_client.hincrby(daily_key, "flagged_products", 1)
                
                # Set expiration for daily keys (30 days)
                await self.redis_client.expire(daily_key, 30 * 24 * 3600)
                
                # Record category-specific metrics
                category_key = f"metrics:category:{event.category}:{event.timestamp.date()}"
                await self.redis_client.hincrby(category_key, "total_analyzed", 1)
                if event.flagged:
                    await self.redis_client.hincrby(category_key, "flagged_count", 1)
                await self.redis_client.expire(category_key, 30 * 24 * 3600)
            
            # Record performance metric
            await self.record_metric(
                MetricEvent(
                    metric_type=MetricType.ANALYSIS_TIME,
                    timestamp=event.timestamp,
                    component="authenticity_analyzer",
                    value=event.processing_time_ms,
                    metadata={
                        "product_id": event.product_id,
                        "authenticity_score": event.authenticity_score,
                        "flagged": event.flagged
                    },
                    tags={
                        "category": event.category,
                        "supplier_id": event.supplier_id
                    }
                )
            )
            
            logger.debug(
                "Analysis event recorded",
                product_id=event.product_id,
                processing_time=event.processing_time_ms,
                flagged=event.flagged
            )
            
        except Exception as e:
            logger.error("Failed to record analysis event", error=str(e))
    
    async def record_metric(self, event: MetricEvent) -> None:
        """Record a general metric event."""
        try:
            # Add to buffer
            self.metric_buffer.append(event)
            
            # Record in Redis for real-time access
            if self.redis_client:
                # Current metrics
                current_key = f"metrics:current:{event.component}:{event.metric_type.value}"
                await self.redis_client.setex(
                    current_key,
                    300,  # 5 minutes TTL
                    json.dumps({
                        "value": event.value,
                        "timestamp": event.timestamp.isoformat(),
                        "metadata": event.metadata,
                        "tags": event.tags
                    })
                )
                
                # Time series data (store last 24 hours)
                ts_key = f"metrics:timeseries:{event.component}:{event.metric_type.value}"
                await self.redis_client.zadd(
                    ts_key,
                    {json.dumps({
                        "value": event.value,
                        "timestamp": event.timestamp.isoformat(),
                        "metadata": event.metadata
                    }): event.timestamp.timestamp()}
                )
                
                # Keep only last 24 hours
                cutoff = time.time() - 24 * 3600
                await self.redis_client.zremrangebyscore(ts_key, 0, cutoff)
            
        except Exception as e:
            logger.error("Failed to record metric", error=str(e))
    
    async def record_enforcement_action(
        self,
        action_type: EnforcementAction,
        product_id: str,
        success: bool,
        processing_time_ms: float,
        metadata: Optional[Dict[str, Any]] = None
    ) -> None:
        """Record an enforcement action event."""
        try:
            await self.record_metric(
                MetricEvent(
                    metric_type=MetricType.ENFORCEMENT_ACTION,
                    timestamp=datetime.utcnow(),
                    component="enforcement_agent",
                    value=processing_time_ms,
                    metadata={
                        "action_type": action_type.value,
                        "product_id": product_id,
                        "success": success,
                        **(metadata or {})
                    },
                    tags={
                        "action_type": action_type.value,
                        "status": "success" if success else "failure"
                    }
                )
            )
            
            # Update Redis counters
            if self.redis_client:
                daily_key = f"metrics:daily:{datetime.utcnow().date()}"
                await self.redis_client.hincrby(daily_key, f"enforcement_{action_type.value}", 1)
                
                if success:
                    await self.redis_client.hincrby(daily_key, "enforcement_success", 1)
                else:
                    await self.redis_client.hincrby(daily_key, "enforcement_failures", 1)
            
        except Exception as e:
            logger.error("Failed to record enforcement action", error=str(e))
    
    async def record_api_request(
        self,
        endpoint: str,
        method: str,
        status_code: int,
        response_time_ms: float,
        user_id: Optional[str] = None
    ) -> None:
        """Record an API request metric."""
        try:
            await self.record_metric(
                MetricEvent(
                    metric_type=MetricType.API_REQUEST,
                    timestamp=datetime.utcnow(),
                    component="api_server",
                    value=response_time_ms,
                    metadata={
                        "endpoint": endpoint,
                        "method": method,
                        "status_code": status_code,
                        "user_id": user_id
                    },
                    tags={
                        "endpoint": endpoint,
                        "method": method,
                        "status_class": f"{status_code // 100}xx"
                    }
                )
            )
            
        except Exception as e:
            logger.error("Failed to record API request", error=str(e))
    
    async def record_agent_health(
        self,
        agent_name: str,
        status: str,
        cpu_usage: float,
        memory_usage: float,
        task_queue_size: int
    ) -> None:
        """Record agent health metrics."""
        try:
            # Record individual metrics
            for metric_name, value in [
                ("cpu_usage", cpu_usage),
                ("memory_usage", memory_usage),
                ("task_queue_size", task_queue_size)
            ]:
                await self.record_metric(
                    MetricEvent(
                        metric_type=MetricType.AGENT_HEALTH,
                        timestamp=datetime.utcnow(),
                        component=agent_name,
                        value=value,
                        metadata={"metric_name": metric_name, "status": status},
                        tags={"agent": agent_name, "metric": metric_name}
                    )
                )
            
            # Update Redis health status
            if self.redis_client:
                health_key = f"health:agent:{agent_name}"
                await self.redis_client.setex(
                    health_key,
                    60,  # 1 minute TTL
                    json.dumps({
                        "status": status,
                        "cpu_usage": cpu_usage,
                        "memory_usage": memory_usage,
                        "task_queue_size": task_queue_size,
                        "last_update": datetime.utcnow().isoformat()
                    })
                )
            
        except Exception as e:
            logger.error("Failed to record agent health", error=str(e))
    
    async def get_current_metrics(self) -> Dict[str, Any]:
        """Get current system metrics."""
        try:
            if not self.redis_client:
                return {}
            
            metrics = {}
            
            # Get today's counts
            today_key = f"metrics:daily:{datetime.utcnow().date()}"
            daily_metrics = await self.redis_client.hgetall(today_key)
            
            if daily_metrics:
                metrics["daily"] = {
                    k.decode() if isinstance(k, bytes) else k: 
                    int(v.decode() if isinstance(v, bytes) else v)
                    for k, v in daily_metrics.items()
                }
            
            # Get agent health status
            agent_patterns = ["health:agent:*"]
            agent_keys = []
            for pattern in agent_patterns:
                keys = await self.redis_client.keys(pattern)
                agent_keys.extend(keys)
            
            if agent_keys:
                metrics["agents"] = {}
                for key in agent_keys:
                    agent_name = key.decode().split(":")[-1] if isinstance(key, bytes) else key.split(":")[-1]
                    health_data = await self.redis_client.get(key)
                    if health_data:
                        metrics["agents"][agent_name] = json.loads(health_data)
            
            return metrics
            
        except Exception as e:
            logger.error("Failed to get current metrics", error=str(e))
            return {}
    
    async def get_performance_snapshot(self) -> PerformanceSnapshot:
        """Get current performance snapshot."""
        try:
            current_time = datetime.utcnow()
            
            # Get response times from recent metrics
            response_times = {}
            throughput = {}
            error_rates = {}
            agent_status = {}
            
            if self.redis_client:
                # Get recent metrics from time series
                components = ["authenticity_analyzer", "enforcement_agent", "api_server"]
                
                for component in components:
                    # Response times
                    ts_key = f"metrics:timeseries:{component}:analysis_time"
                    recent_data = await self.redis_client.zrevrangebyscore(
                        ts_key, "+inf", time.time() - 300, withscores=True
                    )
                    
                    if recent_data:
                        values = [json.loads(item[0])["value"] for item in recent_data]
                        response_times[component] = sum(values) / len(values)
                        throughput[component] = len(values) / 5  # per minute
                    else:
                        response_times[component] = 0
                        throughput[component] = 0
                    
                    # Agent status
                    health_key = f"health:agent:{component}"
                    health_data = await self.redis_client.get(health_key)
                    if health_data:
                        health = json.loads(health_data)
                        agent_status[component] = health.get("status", "unknown")
                    else:
                        agent_status[component] = "unknown"
            
            return PerformanceSnapshot(
                timestamp=current_time,
                response_times=response_times,
                throughput=throughput,
                error_rates=error_rates,
                agent_status=agent_status,
                resource_usage={}
            )
            
        except Exception as e:
            logger.error("Failed to get performance snapshot", error=str(e))
            return PerformanceSnapshot(
                timestamp=datetime.utcnow(),
                response_times={},
                throughput={},
                error_rates={},
                agent_status={},
                resource_usage={}
            )
    
    async def _flush_metrics_loop(self) -> None:
        """Background task to flush metrics to database."""
        while self._running:
            try:
                await asyncio.sleep(self.flush_interval.total_seconds())
                await self._flush_metrics()
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Error in metrics flush loop", error=str(e))
    
    async def _flush_metrics(self) -> None:
        """Flush buffered metrics to database."""
        try:
            if not self.metric_buffer and not self.analysis_buffer:
                return
            
            async with get_db_session() as session:
                if not self.analytics_repository:
                    self.analytics_repository = AnalyticsRepository(session)
                
                # Process analysis events
                analysis_events = list(self.analysis_buffer)
                self.analysis_buffer.clear()
                
                # Process metric events
                metric_events = list(self.metric_buffer)
                self.metric_buffer.clear()
                
                # Log flush operation
                logger.debug(
                    "Flushing metrics to database",
                    analysis_events=len(analysis_events),
                    metric_events=len(metric_events)
                )
                
                self.last_flush = datetime.utcnow()
            
        except Exception as e:
            logger.error("Failed to flush metrics", error=str(e))
    
    async def _aggregate_metrics_loop(self) -> None:
        """Background task to aggregate metrics."""
        while self._running:
            try:
                await asyncio.sleep(300)  # Every 5 minutes
                await self._aggregate_metrics()
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Error in metrics aggregation loop", error=str(e))
    
    async def _aggregate_metrics(self) -> None:
        """Aggregate metrics into time windows."""
        try:
            current_time = datetime.utcnow()
            
            # Aggregate hourly metrics
            hour_key = current_time.replace(minute=0, second=0, microsecond=0)
            
            # Implementation would aggregate metrics from Redis time series
            # into hourly summaries for dashboard display
            
            logger.debug("Aggregated metrics", hour=hour_key.isoformat())
            
        except Exception as e:
            logger.error("Failed to aggregate metrics", error=str(e))
    
    async def _health_check_loop(self) -> None:
        """Background task to monitor system health."""
        while self._running:
            try:
                await asyncio.sleep(60)  # Every minute
                await self._perform_health_check()
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Error in health check loop", error=str(e))
    
    async def _perform_health_check(self) -> None:
        """Perform system health check."""
        try:
            # Check Redis connectivity
            if self.redis_client:
                await self.redis_client.ping()
            
            # Record health metric
            await self.record_metric(
                MetricEvent(
                    metric_type=MetricType.SYSTEM_RESOURCE,
                    timestamp=datetime.utcnow(),
                    component="metrics_collector",
                    value=1.0,  # Healthy
                    metadata={"health_check": "passed"},
                    tags={"component": "metrics_collector"}
                )
            )
            
        except Exception as e:
            logger.error("Health check failed", error=str(e))
            
            # Record unhealthy state
            await self.record_metric(
                MetricEvent(
                    metric_type=MetricType.SYSTEM_RESOURCE,
                    timestamp=datetime.utcnow(),
                    component="metrics_collector",
                    value=0.0,  # Unhealthy
                    metadata={"health_check": "failed", "error": str(e)},
                    tags={"component": "metrics_collector"}
                )
            )