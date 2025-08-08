"""
Pydantic schemas for notification API endpoints.

This module defines the request and response schemas for notification
management, user preferences, and webhook configurations.
"""

from datetime import datetime, time
from typing import Any, Dict, List, Optional
from uuid import uuid4

from pydantic import BaseModel, Field, validator

from ...models.enums import NotificationChannel, NotificationStatus, AlertSeverity


class NotificationEndpointConfig(BaseModel):
    """Base configuration for notification endpoints."""
    pass


class SlackEndpointConfig(NotificationEndpointConfig):
    """Configuration for Slack notification endpoints."""
    channel: str = Field(..., description="Slack channel (e.g., #alerts)")
    bot_token: Optional[str] = Field(None, description="Bot token (if not using global)")
    username: str = Field(default="Counterfeit Detection Bot", description="Bot username")
    icon_emoji: str = Field(default=":warning:", description="Bot icon emoji")


class EmailEndpointConfig(NotificationEndpointConfig):
    """Configuration for email notification endpoints."""
    email: str = Field(..., description="Email address")
    recipient_name: Optional[str] = Field(None, description="Recipient display name")
    from_name: str = Field(default="Counterfeit Detection System", description="Sender name")
    from_email: str = Field(default="alerts@example.com", description="Sender email")


class WebhookEndpointConfig(NotificationEndpointConfig):
    """Configuration for webhook notification endpoints."""
    url: str = Field(..., description="Webhook URL")
    secret: Optional[str] = Field(None, description="Webhook secret for signatures")
    event_type: str = Field(default="product_flagged", description="Event type to send")
    headers: Optional[Dict[str, str]] = Field(default_factory=dict, description="Custom headers")


class NotificationEndpointCreateRequest(BaseModel):
    """Request schema for creating notification endpoints."""
    endpoint_type: NotificationChannel = Field(..., description="Type of notification channel")
    endpoint_config: Dict[str, Any] = Field(..., description="Channel-specific configuration")
    is_active: bool = Field(default=True, description="Whether endpoint is active")
    
    @validator('endpoint_config')
    def validate_config_for_type(cls, v, values):
        """Validate configuration matches endpoint type."""
        endpoint_type = values.get('endpoint_type')
        if not endpoint_type:
            return v
        
        # Basic validation - more detailed validation can be added
        required_fields = {
            NotificationChannel.SLACK: ['channel'],
            NotificationChannel.EMAIL: ['email'],
            NotificationChannel.WEBHOOK: ['url'],
            NotificationChannel.SMS: ['phone_number']
        }
        
        for field in required_fields.get(endpoint_type, []):
            if field not in v:
                raise ValueError(f"Field '{field}' is required for {endpoint_type.value} endpoints")
        
        return v


class NotificationEndpointUpdateRequest(BaseModel):
    """Request schema for updating notification endpoints."""
    endpoint_config: Optional[Dict[str, Any]] = Field(None, description="Updated configuration")
    is_active: Optional[bool] = Field(None, description="Whether endpoint is active")


class NotificationEndpointResponse(BaseModel):
    """Response schema for notification endpoints."""
    id: str = Field(..., description="Endpoint unique identifier")
    user_id: str = Field(..., description="User ID")
    endpoint_type: NotificationChannel = Field(..., description="Type of notification channel")
    endpoint_config: Dict[str, Any] = Field(..., description="Channel-specific configuration")
    is_active: bool = Field(..., description="Whether endpoint is active")
    created_at: datetime = Field(..., description="Endpoint creation timestamp")
    
    class Config:
        from_attributes = True


class UserNotificationPreferencesRequest(BaseModel):
    """Request schema for user notification preferences."""
    alert_threshold_score: int = Field(
        default=30, 
        ge=0, 
        le=100, 
        description="Minimum authenticity score to trigger alerts (0-100)"
    )
    severity_levels: List[str] = Field(
        default=["high", "critical"], 
        description="Alert severity levels to receive"
    )
    quiet_hours_start: Optional[time] = Field(
        None, 
        description="Start of quiet hours (no notifications)"
    )
    quiet_hours_end: Optional[time] = Field(
        None, 
        description="End of quiet hours"
    )
    business_days_only: bool = Field(
        default=False, 
        description="Only send notifications on business days"
    )
    rate_limit_per_hour: int = Field(
        default=10, 
        ge=1, 
        le=100, 
        description="Maximum notifications per hour"
    )
    
    @validator('severity_levels')
    def validate_severity_levels(cls, v):
        """Validate severity levels."""
        valid_levels = {level.value for level in AlertSeverity}
        for level in v:
            if level not in valid_levels:
                raise ValueError(f"Invalid severity level: {level}. Valid levels: {', '.join(valid_levels)}")
        return v
    
    @validator('quiet_hours_end')
    def validate_quiet_hours(cls, v, values):
        """Validate quiet hours configuration."""
        start = values.get('quiet_hours_start')
        if start is not None and v is None:
            raise ValueError("quiet_hours_end is required when quiet_hours_start is specified")
        if start is None and v is not None:
            raise ValueError("quiet_hours_start is required when quiet_hours_end is specified")
        return v


class UserNotificationPreferencesResponse(BaseModel):
    """Response schema for user notification preferences."""
    id: str = Field(..., description="Preferences unique identifier")
    user_id: str = Field(..., description="User ID")
    alert_threshold_score: int = Field(..., description="Alert threshold score")
    severity_levels: List[str] = Field(..., description="Enabled severity levels")
    quiet_hours_start: Optional[time] = Field(None, description="Quiet hours start time")
    quiet_hours_end: Optional[time] = Field(None, description="Quiet hours end time")
    business_days_only: bool = Field(..., description="Business days only setting")
    rate_limit_per_hour: int = Field(..., description="Rate limit per hour")
    created_at: datetime = Field(..., description="Preferences creation timestamp")
    
    class Config:
        from_attributes = True


class NotificationTestRequest(BaseModel):
    """Request schema for testing notifications."""
    channel: NotificationChannel = Field(..., description="Channel to test")
    test_message: str = Field(
        default="This is a test notification", 
        description="Custom test message"
    )


class NotificationTestResponse(BaseModel):
    """Response schema for notification tests."""
    test_id: str = Field(default_factory=lambda: str(uuid4()), description="Test identifier")
    channel: NotificationChannel = Field(..., description="Tested channel")
    success: bool = Field(..., description="Whether test was successful")
    duration_ms: float = Field(..., description="Test duration in milliseconds")
    error_message: Optional[str] = Field(None, description="Error message if failed")
    sent_at: datetime = Field(default_factory=datetime.utcnow, description="Test timestamp")


class AlertNotificationRequest(BaseModel):
    """Request schema for sending alert notifications."""
    product_id: str = Field(..., description="Product ID")
    severity: AlertSeverity = Field(..., description="Alert severity")
    analysis_data: Dict[str, Any] = Field(..., description="Analysis results")
    target_users: Optional[List[str]] = Field(None, description="Specific users to notify")
    channel_override: Optional[NotificationChannel] = Field(None, description="Force specific channel")
    priority_override: bool = Field(False, description="Bypass user preferences")


class AlertNotificationResponse(BaseModel):
    """Response schema for alert notifications."""
    notification_id: str = Field(default_factory=lambda: str(uuid4()), description="Notification identifier")
    alert_id: str = Field(..., description="Alert identifier")
    total_notifications: int = Field(..., description="Total notifications sent")
    successful_deliveries: int = Field(..., description="Successful deliveries")
    failed_deliveries: int = Field(..., description="Failed deliveries")
    skipped_notifications: int = Field(..., description="Skipped notifications")
    processing_duration_ms: float = Field(..., description="Processing time")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Notification timestamp")


class NotificationLogResponse(BaseModel):
    """Response schema for notification logs."""
    id: str = Field(..., description="Log entry identifier")
    product_id: Optional[str] = Field(None, description="Product ID")
    user_id: str = Field(..., description="User ID")
    notification_type: str = Field(..., description="Notification type")
    delivery_status: NotificationStatus = Field(..., description="Delivery status")
    payload: Optional[Dict[str, Any]] = Field(None, description="Notification payload")
    error_message: Optional[str] = Field(None, description="Error message if failed")
    sent_at: datetime = Field(..., description="Notification timestamp")
    
    class Config:
        from_attributes = True


class NotificationLogListResponse(BaseModel):
    """Response schema for notification log list."""
    logs: List[NotificationLogResponse] = Field(..., description="List of notification logs")
    total_count: int = Field(..., description="Total number of logs")
    page: int = Field(..., description="Current page number")
    page_size: int = Field(..., description="Number of logs per page")
    total_pages: int = Field(..., description="Total number of pages")


class NotificationStatsResponse(BaseModel):
    """Response schema for notification statistics."""
    total_notifications: int = Field(..., description="Total notifications sent")
    successful_deliveries: int = Field(..., description="Successful deliveries")
    failed_deliveries: int = Field(..., description="Failed deliveries")
    retry_deliveries: int = Field(..., description="Retried deliveries")
    skipped_deliveries: int = Field(..., description="Skipped deliveries")
    success_rate: float = Field(..., description="Success rate percentage")
    notifications_by_type: Dict[str, int] = Field(..., description="Notifications by type")
    notifications_by_status: Dict[str, int] = Field(..., description="Notifications by status")


class WebhookTestRequest(BaseModel):
    """Request schema for testing webhook endpoints."""
    url: str = Field(..., description="Webhook URL to test")
    secret: Optional[str] = Field(None, description="Webhook secret")
    custom_headers: Optional[Dict[str, str]] = Field(default_factory=dict, description="Custom headers")


class WebhookTestResponse(BaseModel):
    """Response schema for webhook tests."""
    test_id: str = Field(default_factory=lambda: str(uuid4()), description="Test identifier")
    url: str = Field(..., description="Tested webhook URL")
    success: bool = Field(..., description="Whether test was successful")
    attempts: int = Field(..., description="Number of delivery attempts")
    final_status_code: Optional[int] = Field(None, description="Final HTTP status code")
    total_duration_ms: float = Field(..., description="Total test duration")
    error_message: Optional[str] = Field(None, description="Error message if failed")
    tested_at: datetime = Field(default_factory=datetime.utcnow, description="Test timestamp")


class NotificationChannelConfigResponse(BaseModel):
    """Response schema for notification channel configuration."""
    channel: NotificationChannel = Field(..., description="Notification channel")
    enabled: bool = Field(..., description="Whether channel is enabled")
    configuration_schema: Dict[str, Any] = Field(..., description="Configuration schema for channel")
    test_available: bool = Field(..., description="Whether test functionality is available")


class BulkNotificationRequest(BaseModel):
    """Request schema for bulk notifications."""
    notifications: List[AlertNotificationRequest] = Field(
        ..., 
        min_items=1, 
        max_items=100, 
        description="List of notifications to send"
    )
    consolidate_similar: bool = Field(
        default=True, 
        description="Whether to consolidate similar notifications"
    )


class BulkNotificationResponse(BaseModel):
    """Response schema for bulk notifications."""
    batch_id: str = Field(default_factory=lambda: str(uuid4()), description="Batch identifier")
    total_requested: int = Field(..., description="Total notifications requested")
    successful_batches: int = Field(..., description="Successful notification batches")
    failed_batches: int = Field(..., description="Failed notification batches")
    total_deliveries: int = Field(..., description="Total individual deliveries")
    processing_duration_ms: float = Field(..., description="Total processing time")
    batch_results: List[AlertNotificationResponse] = Field(..., description="Individual batch results")