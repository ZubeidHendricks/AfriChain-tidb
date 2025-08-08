"""
Notification Agent for multi-channel alert delivery.

This agent handles sending notifications through various channels (Slack, email, webhooks)
when counterfeit products are detected, providing immediate alerts to administrators.
"""

import asyncio
import json
from datetime import datetime, time, timedelta
from typing import Any, Dict, List, Optional, Set
from uuid import uuid4

import structlog
from pydantic import BaseModel, Field

from ..agents.base import BaseAgent, AgentCapability, AgentMessage, AgentResponse, AgentStatus
from ..core.database import get_db_session
from ..db.repositories.notification_repository import NotificationRepository
from ..services.notification_service import NotificationService
from ..services.webhook_service import WebhookService
from ..models.enums import NotificationChannel, NotificationStatus, AlertSeverity
from ..models.database import NotificationEndpoint, UserNotificationPreferences

logger = structlog.get_logger(__name__)


class AlertPayload(BaseModel):
    """Standard alert payload structure."""
    alert_id: str = Field(default_factory=lambda: str(uuid4()))
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    severity: AlertSeverity
    product: Dict[str, Any] = Field(..., description="Product information")
    analysis: Dict[str, Any] = Field(..., description="Analysis results")
    actions: Dict[str, Any] = Field(..., description="Available actions")


class NotificationRequest(BaseModel):
    """Request to send notification."""
    alert_payload: AlertPayload
    user_ids: Optional[List[str]] = Field(None, description="Specific users to notify (None = all eligible)")
    channel_override: Optional[NotificationChannel] = Field(None, description="Force specific channel")
    priority_override: bool = Field(False, description="Bypass user preferences and rate limits")


class NotificationResult(BaseModel):
    """Result of notification delivery."""
    notification_id: str = Field(default_factory=lambda: str(uuid4()))
    alert_id: str
    user_id: str
    channel: NotificationChannel
    status: NotificationStatus
    delivery_duration_ms: float
    error_message: Optional[str] = None
    sent_at: datetime = Field(default_factory=datetime.utcnow)


class BatchNotificationResult(BaseModel):
    """Result of batch notification delivery."""
    batch_id: str = Field(default_factory=lambda: str(uuid4()))
    alert_id: str
    total_notifications: int
    successful_deliveries: int
    failed_deliveries: int
    skipped_notifications: int
    results: List[NotificationResult] = Field(default_factory=list)
    processing_duration_ms: float


class NotificationAgent(BaseAgent):
    """
    Notification Agent for multi-channel alert delivery.
    
    This agent manages the delivery of alerts through various channels including
    Slack, email, and webhooks. It handles user preferences, rate limiting,
    and ensures reliable delivery with retry mechanisms.
    """
    
    def __init__(self, agent_id: str):
        # Define agent capabilities
        capabilities = [
            AgentCapability(
                name="send_alert",
                description="Send alert notification through configured channels",
                input_schema={
                    "alert_payload": "object",
                    "user_ids": "array (optional)",
                    "channel_override": "string (optional)",
                    "priority_override": "boolean (optional)"
                },
                output_schema={
                    "batch_id": "string",
                    "total_notifications": "number",
                    "successful_deliveries": "number",
                    "failed_deliveries": "number"
                }
            ),
            AgentCapability(
                name="batch_notify",
                description="Send multiple alerts in batch",
                input_schema={
                    "alerts": "array of alert_payload objects",
                    "consolidate_similar": "boolean (optional)"
                },
                output_schema={
                    "batch_results": "array",
                    "summary_stats": "object"
                }
            )
        ]
        
        super().__init__(
            agent_id=agent_id,
            agent_type="notification_agent",
            capabilities=capabilities
        )
        
        # Services (initialized in start method)
        self.notification_service: Optional[NotificationService] = None
        self.webhook_service: Optional[WebhookService] = None
        self.notification_repository: Optional[NotificationRepository] = None
        
        # Performance metrics
        self.total_notifications_sent = 0
        self.total_delivery_time = 0.0
        self.channel_stats: Dict[str, int] = {}
        self.recent_alerts: Set[str] = set()  # For deduplication
        self.rate_limit_cache: Dict[str, List[datetime]] = {}  # Per-user rate limiting
        
        # Configuration
        self.deduplication_window_minutes = 5
        self.max_rate_limit_per_hour = 50
        self.quiet_hours_enabled = True
        
    async def start(self) -> None:
        """Start the notification agent."""
        try:
            # Initialize services
            self.notification_service = NotificationService()
            self.webhook_service = WebhookService()
            
            async with get_db_session() as session:
                self.notification_repository = NotificationRepository(session)
            
            await super().start()
            logger.info("Notification agent started", agent_id=self.agent_id)
            
        except Exception as e:
            logger.error("Failed to start notification agent", error=str(e))
            self.status = AgentStatus.ERROR
            raise
    
    async def process_message(self, message: AgentMessage) -> AgentResponse:
        """Process incoming notification requests."""
        try:
            if message.message_type == "send_alert":
                return await self._handle_send_alert(message)
            
            elif message.message_type == "batch_notify":
                return await self._handle_batch_notify(message)
            
            elif message.message_type == "get_notification_stats":
                return await self._handle_get_stats(message)
            
            elif message.message_type == "test_notification":
                return await self._handle_test_notification(message)
            
            else:
                return AgentResponse(
                    success=False,
                    error=f"Unknown message type: {message.message_type}"
                )
        
        except Exception as e:
            logger.error("Error processing notification message", error=str(e), message_type=message.message_type)
            return AgentResponse(
                success=False,
                error=f"Error processing message: {str(e)}"
            )
    
    async def _handle_send_alert(self, message: AgentMessage) -> AgentResponse:
        """Handle single alert notification request."""
        payload = message.payload
        
        try:
            # Parse notification request
            request = NotificationRequest(**payload)
            
            # Send notifications
            result = await self.send_alert_notification(request)
            
            return AgentResponse(
                success=True,
                result={
                    "batch_id": result.batch_id,
                    "alert_id": result.alert_id,
                    "total_notifications": result.total_notifications,
                    "successful_deliveries": result.successful_deliveries,
                    "failed_deliveries": result.failed_deliveries,
                    "skipped_notifications": result.skipped_notifications,
                    "processing_duration_ms": result.processing_duration_ms
                }
            )
        
        except Exception as e:
            logger.error("Failed to send alert notification", error=str(e))
            return AgentResponse(
                success=False,
                error=f"Failed to send notification: {str(e)}"
            )
    
    async def _handle_batch_notify(self, message: AgentMessage) -> AgentResponse:
        """Handle batch notification request."""
        payload = message.payload
        alerts = payload.get("alerts", [])
        consolidate_similar = payload.get("consolidate_similar", True)
        
        try:
            # Process alerts in batch
            batch_results = []
            total_successful = 0
            total_failed = 0
            
            # Consolidate similar alerts if requested
            if consolidate_similar:
                alerts = await self._consolidate_similar_alerts(alerts)
            
            # Process each alert
            for alert_data in alerts:
                request = NotificationRequest(
                    alert_payload=AlertPayload(**alert_data)
                )
                
                result = await self.send_alert_notification(request)
                batch_results.append({
                    "batch_id": result.batch_id,
                    "alert_id": result.alert_id,
                    "successful_deliveries": result.successful_deliveries,
                    "failed_deliveries": result.failed_deliveries
                })
                
                total_successful += result.successful_deliveries
                total_failed += result.failed_deliveries
            
            return AgentResponse(
                success=True,
                result={
                    "batch_results": batch_results,
                    "summary_stats": {
                        "total_alerts_processed": len(alerts),
                        "total_successful_deliveries": total_successful,
                        "total_failed_deliveries": total_failed,
                        "consolidation_applied": consolidate_similar
                    }
                }
            )
        
        except Exception as e:
            logger.error("Failed to process batch notifications", error=str(e))
            return AgentResponse(
                success=False,
                error=f"Failed to process batch notifications: {str(e)}"
            )
    
    async def _handle_get_stats(self, message: AgentMessage) -> AgentResponse:
        """Handle request for notification statistics."""
        return AgentResponse(
            success=True,
            result={
                "agent_id": self.agent_id,
                "status": self.status.value,
                "total_notifications_sent": self.total_notifications_sent,
                "average_delivery_time_ms": (
                    self.total_delivery_time / self.total_notifications_sent 
                    if self.total_notifications_sent > 0 else 0
                ),
                "channel_distribution": self.channel_stats,
                "processed_messages": self.processed_messages,
                "error_count": self.error_count
            }
        )
    
    async def _handle_test_notification(self, message: AgentMessage) -> AgentResponse:
        """Handle test notification request."""
        payload = message.payload
        channel = payload.get("channel", "slack")
        user_id = payload.get("user_id")
        
        try:
            # Create test alert payload
            test_alert = AlertPayload(
                severity=AlertSeverity.MEDIUM,
                product={
                    "id": "test-product-id",
                    "description": "Test Product for Notification System",
                    "category": "test",
                    "brand": "TestBrand",
                    "price": 99.99
                },
                analysis={
                    "authenticity_score": 25,
                    "confidence": 0.85,
                    "reasoning": "This is a test notification",
                    "red_flags": ["Test flag"]
                },
                actions={
                    "admin_dashboard_url": "https://admin.example.com/test",
                    "recommended_action": "review"
                }
            )
            
            # Send test notification
            request = NotificationRequest(
                alert_payload=test_alert,
                user_ids=[user_id] if user_id else None,
                channel_override=NotificationChannel(channel),
                priority_override=True
            )
            
            result = await self.send_alert_notification(request)
            
            return AgentResponse(
                success=True,
                result={
                    "test_completed": True,
                    "notifications_sent": result.successful_deliveries,
                    "test_alert_id": test_alert.alert_id
                }
            )
        
        except Exception as e:
            logger.error("Failed to send test notification", error=str(e))
            return AgentResponse(
                success=False,
                error=f"Failed to send test notification: {str(e)}"
            )
    
    async def send_alert_notification(self, request: NotificationRequest) -> BatchNotificationResult:
        """
        Send alert notification to appropriate users and channels.
        
        Args:
            request: Notification request with alert payload and options
            
        Returns:
            BatchNotificationResult with delivery results
        """
        start_time = datetime.utcnow()
        alert_id = request.alert_payload.alert_id
        
        try:
            # Check for duplicate alerts
            if not request.priority_override and await self._is_duplicate_alert(alert_id):
                logger.info("Skipping duplicate alert", alert_id=alert_id)
                return BatchNotificationResult(
                    alert_id=alert_id,
                    total_notifications=0,
                    successful_deliveries=0,
                    failed_deliveries=0,
                    skipped_notifications=1,
                    processing_duration_ms=0
                )
            
            # Get eligible users
            eligible_users = await self._get_eligible_users(request)
            
            if not eligible_users:
                logger.info("No eligible users for alert", alert_id=alert_id)
                return BatchNotificationResult(
                    alert_id=alert_id,
                    total_notifications=0,
                    successful_deliveries=0,
                    failed_deliveries=0,
                    skipped_notifications=0,
                    processing_duration_ms=0
                )
            
            # Send notifications to each eligible user
            notification_tasks = []
            for user_id, channels in eligible_users.items():
                for channel in channels:
                    task = self._send_single_notification(
                        request.alert_payload,
                        user_id,
                        channel,
                        request.priority_override
                    )
                    notification_tasks.append(task)
            
            # Execute notifications concurrently
            results = await asyncio.gather(*notification_tasks, return_exceptions=True)
            
            # Process results
            successful_deliveries = 0
            failed_deliveries = 0
            skipped_notifications = 0
            valid_results = []
            
            for result in results:
                if isinstance(result, Exception):
                    logger.error("Notification task failed", error=str(result))
                    failed_deliveries += 1
                elif isinstance(result, NotificationResult):
                    valid_results.append(result)
                    if result.status == NotificationStatus.SENT:
                        successful_deliveries += 1
                    elif result.status == NotificationStatus.FAILED:
                        failed_deliveries += 1
                    else:
                        skipped_notifications += 1
            
            # Log notification for analytics
            await self._log_notification_batch(alert_id, valid_results)
            
            # Update metrics
            self.total_notifications_sent += successful_deliveries
            duration_ms = (datetime.utcnow() - start_time).total_seconds() * 1000
            self.total_delivery_time += duration_ms
            
            # Add to recent alerts for deduplication
            self.recent_alerts.add(alert_id)
            
            result = BatchNotificationResult(
                alert_id=alert_id,
                total_notifications=len(notification_tasks),
                successful_deliveries=successful_deliveries,
                failed_deliveries=failed_deliveries,
                skipped_notifications=skipped_notifications,
                results=valid_results,
                processing_duration_ms=duration_ms
            )
            
            logger.info(
                "Alert notification batch completed",
                alert_id=alert_id,
                total_notifications=result.total_notifications,
                successful=successful_deliveries,
                failed=failed_deliveries,
                skipped=skipped_notifications,
                duration_ms=duration_ms
            )
            
            return result
        
        except Exception as e:
            logger.error("Alert notification batch failed", error=str(e), alert_id=alert_id)
            raise
    
    async def _get_eligible_users(self, request: NotificationRequest) -> Dict[str, List[NotificationChannel]]:
        """Get users eligible to receive the alert and their preferred channels."""
        eligible_users = {}
        
        try:
            async with get_db_session() as session:
                notification_repo = NotificationRepository(session)
                
                # Get target users
                if request.user_ids:
                    # Specific users requested
                    target_users = request.user_ids
                else:
                    # Get all users with notification preferences
                    target_users = await notification_repo.get_all_notification_users()
                
                # Check each user's eligibility and preferences
                for user_id in target_users:
                    # Get user preferences
                    preferences = await notification_repo.get_user_preferences(user_id)
                    
                    # Check if alert meets user's threshold
                    if not request.priority_override and preferences:
                        alert_score = request.alert_payload.analysis.get("authenticity_score", 100)
                        if alert_score > preferences.alert_threshold_score:
                            continue  # Score too high (less suspicious) for user's threshold
                        
                        # Check severity level preference
                        if request.alert_payload.severity.value not in preferences.severity_levels:
                            continue
                        
                        # Check quiet hours
                        if await self._is_quiet_hours(preferences):
                            continue
                        
                        # Check rate limits
                        if await self._is_rate_limited(user_id, preferences):
                            continue
                    
                    # Get user's notification channels
                    if request.channel_override:
                        channels = [request.channel_override]
                    else:
                        channels = await notification_repo.get_user_channels(user_id)
                    
                    if channels:
                        eligible_users[user_id] = channels
            
            return eligible_users
        
        except Exception as e:
            logger.error("Failed to get eligible users", error=str(e))
            return {}
    
    async def _send_single_notification(
        self,
        alert_payload: AlertPayload,
        user_id: str,
        channel: NotificationChannel,
        priority_override: bool = False
    ) -> NotificationResult:
        """Send a single notification to a user via specified channel."""
        start_time = datetime.utcnow()
        
        try:
            # Get channel-specific endpoint configuration
            async with get_db_session() as session:
                notification_repo = NotificationRepository(session)
                endpoint = await notification_repo.get_user_channel_endpoint(user_id, channel)
                
                if not endpoint:
                    return NotificationResult(
                        alert_id=alert_payload.alert_id,
                        user_id=user_id,
                        channel=channel,
                        status=NotificationStatus.SKIPPED,
                        delivery_duration_ms=0,
                        error_message="No endpoint configured for channel"
                    )
            
            # Send via appropriate service
            if channel == NotificationChannel.SLACK:
                success = await self.notification_service.send_slack_notification(
                    alert_payload, endpoint.endpoint_config
                )
            elif channel == NotificationChannel.EMAIL:
                success = await self.notification_service.send_email_notification(
                    alert_payload, endpoint.endpoint_config
                )
            elif channel == NotificationChannel.WEBHOOK:
                success = await self.webhook_service.send_webhook_notification(
                    alert_payload, endpoint.endpoint_config
                )
            else:
                success = False
            
            # Calculate duration
            duration_ms = (datetime.utcnow() - start_time).total_seconds() * 1000
            
            # Update channel stats
            channel_key = channel.value
            self.channel_stats[channel_key] = self.channel_stats.get(channel_key, 0) + 1
            
            return NotificationResult(
                alert_id=alert_payload.alert_id,
                user_id=user_id,
                channel=channel,
                status=NotificationStatus.SENT if success else NotificationStatus.FAILED,
                delivery_duration_ms=duration_ms,
                error_message=None if success else "Delivery failed"
            )
        
        except Exception as e:
            duration_ms = (datetime.utcnow() - start_time).total_seconds() * 1000
            logger.error(
                "Single notification failed",
                error=str(e),
                user_id=user_id,
                channel=channel.value,
                alert_id=alert_payload.alert_id
            )
            
            return NotificationResult(
                alert_id=alert_payload.alert_id,
                user_id=user_id,
                channel=channel,
                status=NotificationStatus.FAILED,
                delivery_duration_ms=duration_ms,
                error_message=str(e)
            )
    
    async def _is_duplicate_alert(self, alert_id: str) -> bool:
        """Check if alert is a duplicate within the deduplication window."""
        # Simple in-memory deduplication - in production, use Redis
        return alert_id in self.recent_alerts
    
    async def _is_quiet_hours(self, preferences: UserNotificationPreferences) -> bool:
        """Check if current time is within user's quiet hours."""
        if not self.quiet_hours_enabled or not preferences:
            return False
        
        current_time = datetime.now().time()
        quiet_start = preferences.quiet_hours_start
        quiet_end = preferences.quiet_hours_end
        
        # Handle overnight quiet hours (e.g., 22:00 to 08:00)
        if quiet_start > quiet_end:
            return current_time >= quiet_start or current_time <= quiet_end
        else:
            return quiet_start <= current_time <= quiet_end
    
    async def _is_rate_limited(self, user_id: str, preferences: UserNotificationPreferences) -> bool:
        """Check if user has exceeded their rate limit."""
        if not preferences:
            return False
        
        current_time = datetime.utcnow()
        hour_ago = current_time - timedelta(hours=1)
        
        # Get user's recent notifications from cache
        if user_id not in self.rate_limit_cache:
            self.rate_limit_cache[user_id] = []
        
        user_notifications = self.rate_limit_cache[user_id]
        
        # Remove notifications older than 1 hour
        user_notifications[:] = [ts for ts in user_notifications if ts > hour_ago]
        
        # Check if user has exceeded rate limit
        if len(user_notifications) >= preferences.rate_limit_per_hour:
            return True
        
        # Add current notification to cache
        user_notifications.append(current_time)
        return False
    
    async def _consolidate_similar_alerts(self, alerts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Consolidate similar alerts to reduce notification fatigue."""
        # Simple consolidation by product category and severity
        consolidated = {}
        
        for alert in alerts:
            category = alert.get("product", {}).get("category", "unknown")
            severity = alert.get("severity", "medium")
            key = f"{category}_{severity}"
            
            if key not in consolidated:
                consolidated[key] = alert
                consolidated[key]["consolidated_count"] = 1
            else:
                consolidated[key]["consolidated_count"] += 1
                # Update description to indicate consolidation
                current_count = consolidated[key]["consolidated_count"]
                consolidated[key]["product"]["description"] = f"Consolidated alert: {current_count} similar products"
        
        return list(consolidated.values())
    
    async def _log_notification_batch(self, alert_id: str, results: List[NotificationResult]) -> None:
        """Log notification batch results for analytics."""
        try:
            async with get_db_session() as session:
                notification_repo = NotificationRepository(session)
                
                for result in results:
                    await notification_repo.log_notification(
                        product_id=None,  # Will be derived from alert_payload
                        user_id=result.user_id,
                        notification_type=result.channel.value,
                        delivery_status=result.status,
                        payload={"alert_id": alert_id},
                        error_message=result.error_message
                    )
        
        except Exception as e:
            logger.error("Failed to log notification batch", error=str(e))