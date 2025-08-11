"""
API endpoints for notification management.

This module provides REST API endpoints for managing notification endpoints,
user preferences, sending alerts, and monitoring notification delivery.
"""

import asyncio
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse

import structlog

from ....core.database import get_db_session
from ....db.repositories.notification_repository import NotificationRepository
from ....agents.notification_agent import NotificationAgent, AlertPayload, NotificationRequest
from ....services.notification_service import NotificationService
from ....services.webhook_service import WebhookService
from ....models.enums import NotificationChannel, NotificationStatus, AlertSeverity
from ..schemas.notifications import (
    NotificationEndpointCreateRequest,
    NotificationEndpointUpdateRequest,
    NotificationEndpointResponse,
    UserNotificationPreferencesRequest,
    UserNotificationPreferencesResponse,
    NotificationTestRequest,
    NotificationTestResponse,
    AlertNotificationRequest,
    AlertNotificationResponse,
    NotificationLogResponse,
    NotificationLogListResponse,
    NotificationStatsResponse,
    WebhookTestRequest,
    WebhookTestResponse,
    NotificationChannelConfigResponse,
    BulkNotificationRequest,
    BulkNotificationResponse
)

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/notifications", tags=["notifications"])

# Global notification agent instance
notification_agent_instance: Optional[NotificationAgent] = None


async def get_notification_repository():
    """Dependency to get notification repository."""
    async with get_db_session() as session:
        yield NotificationRepository(session)


async def get_notification_agent():
    """Dependency to get notification agent instance."""
    global notification_agent_instance
    if notification_agent_instance is None:
        notification_agent_instance = NotificationAgent("notification-agent-api")
        await notification_agent_instance.start()
    return notification_agent_instance


@router.post("/endpoints", response_model=NotificationEndpointResponse, status_code=status.HTTP_201_CREATED)
async def create_notification_endpoint(
    user_id: str,
    request: NotificationEndpointCreateRequest,
    notification_repo: NotificationRepository = Depends(get_notification_repository)
):
    """
    Create a new notification endpoint for a user.
    
    Creates a notification endpoint (Slack, email, webhook, etc.) for the specified user.
    The endpoint will be used to deliver alerts based on user preferences.
    """
    try:
        endpoint_data = request.dict()
        endpoint_data["user_id"] = user_id
        
        endpoint = await notification_repo.create_notification_endpoint(endpoint_data)
        
        logger.info("Notification endpoint created via API", endpoint_id=endpoint.id, user_id=user_id)
        return NotificationEndpointResponse.from_orm(endpoint)
    
    except Exception as e:
        logger.error("Failed to create notification endpoint", error=str(e), user_id=user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create notification endpoint"
        )


@router.get("/endpoints", response_model=List[NotificationEndpointResponse])
async def list_user_notification_endpoints(
    user_id: str,
    notification_repo: NotificationRepository = Depends(get_notification_repository)
):
    """
    List all notification endpoints for a user.
    
    Returns all active notification endpoints configured for the specified user.
    """
    try:
        endpoints = await notification_repo.get_user_notification_endpoints(user_id)
        return [NotificationEndpointResponse.from_orm(endpoint) for endpoint in endpoints]
    
    except Exception as e:
        logger.error("Failed to list notification endpoints", error=str(e), user_id=user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve notification endpoints"
        )


@router.get("/endpoints/{endpoint_id}", response_model=NotificationEndpointResponse)
async def get_notification_endpoint(
    endpoint_id: str,
    notification_repo: NotificationRepository = Depends(get_notification_repository)
):
    """
    Get a specific notification endpoint by ID.
    
    Returns detailed information about a specific notification endpoint.
    """
    try:
        endpoint = await notification_repo.get_notification_endpoint_by_id(endpoint_id)
        if not endpoint:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Notification endpoint {endpoint_id} not found"
            )
        
        return NotificationEndpointResponse.from_orm(endpoint)
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get notification endpoint", error=str(e), endpoint_id=endpoint_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve notification endpoint"
        )


@router.put("/endpoints/{endpoint_id}", response_model=NotificationEndpointResponse)
async def update_notification_endpoint(
    endpoint_id: str,
    request: NotificationEndpointUpdateRequest,
    notification_repo: NotificationRepository = Depends(get_notification_repository)
):
    """
    Update an existing notification endpoint.
    
    Updates the configuration or active status of an existing notification endpoint.
    """
    try:
        update_data = request.dict(exclude_unset=True)
        updated_endpoint = await notification_repo.update_notification_endpoint(endpoint_id, update_data)
        
        if not updated_endpoint:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Notification endpoint {endpoint_id} not found"
            )
        
        logger.info("Notification endpoint updated via API", endpoint_id=endpoint_id)
        return NotificationEndpointResponse.from_orm(updated_endpoint)
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to update notification endpoint", error=str(e), endpoint_id=endpoint_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update notification endpoint"
        )


@router.delete("/endpoints/{endpoint_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_notification_endpoint(
    endpoint_id: str,
    notification_repo: NotificationRepository = Depends(get_notification_repository)
):
    """
    Delete a notification endpoint.
    
    Permanently deletes the specified notification endpoint. This action cannot be undone.
    """
    try:
        deleted = await notification_repo.delete_notification_endpoint(endpoint_id)
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Notification endpoint {endpoint_id} not found"
            )
        
        logger.info("Notification endpoint deleted via API", endpoint_id=endpoint_id)
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to delete notification endpoint", error=str(e), endpoint_id=endpoint_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete notification endpoint"
        )


@router.post("/preferences/{user_id}", response_model=UserNotificationPreferencesResponse, status_code=status.HTTP_201_CREATED)
async def create_user_notification_preferences(
    user_id: str,
    request: UserNotificationPreferencesRequest,
    notification_repo: NotificationRepository = Depends(get_notification_repository)
):
    """
    Create notification preferences for a user.
    
    Creates or updates notification preferences including alert thresholds,
    severity levels, quiet hours, and rate limiting.
    """
    try:
        preferences_data = request.dict()
        preferences_data["user_id"] = user_id
        
        # Check if preferences already exist
        existing_preferences = await notification_repo.get_user_preferences(user_id)
        
        if existing_preferences:
            # Update existing preferences
            updated_preferences = await notification_repo.update_user_preferences(user_id, preferences_data)
            logger.info("User notification preferences updated via API", user_id=user_id)
            return UserNotificationPreferencesResponse.from_orm(updated_preferences)
        else:
            # Create new preferences
            preferences = await notification_repo.create_user_preferences(preferences_data)
            logger.info("User notification preferences created via API", user_id=user_id)
            return UserNotificationPreferencesResponse.from_orm(preferences)
    
    except Exception as e:
        logger.error("Failed to create/update user notification preferences", error=str(e), user_id=user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create/update notification preferences"
        )


@router.get("/preferences/{user_id}", response_model=UserNotificationPreferencesResponse)
async def get_user_notification_preferences(
    user_id: str,
    notification_repo: NotificationRepository = Depends(get_notification_repository)
):
    """
    Get notification preferences for a user.
    
    Returns the current notification preferences for the specified user.
    """
    try:
        preferences = await notification_repo.get_user_preferences(user_id)
        if not preferences:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Notification preferences for user {user_id} not found"
            )
        
        return UserNotificationPreferencesResponse.from_orm(preferences)
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get user notification preferences", error=str(e), user_id=user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve notification preferences"
        )


@router.put("/preferences/{user_id}", response_model=UserNotificationPreferencesResponse)
async def update_user_notification_preferences(
    user_id: str,
    request: UserNotificationPreferencesRequest,
    notification_repo: NotificationRepository = Depends(get_notification_repository)
):
    """
    Update notification preferences for a user.
    
    Updates the notification preferences for the specified user.
    """
    try:
        update_data = request.dict(exclude_unset=True)
        updated_preferences = await notification_repo.update_user_preferences(user_id, update_data)
        
        if not updated_preferences:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Notification preferences for user {user_id} not found"
            )
        
        logger.info("User notification preferences updated via API", user_id=user_id)
        return UserNotificationPreferencesResponse.from_orm(updated_preferences)
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to update user notification preferences", error=str(e), user_id=user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update notification preferences"
        )


@router.post("/test", response_model=NotificationTestResponse)
async def test_notification(
    user_id: str,
    request: NotificationTestRequest,
    notification_agent: NotificationAgent = Depends(get_notification_agent)
):
    """
    Test a notification channel for a user.
    
    Sends a test notification through the specified channel to verify configuration.
    """
    try:
        # Send test notification
        from ....agents.base import AgentMessage
        
        message = AgentMessage(
            sender_id="api",
            message_type="test_notification",
            payload={
                "channel": request.channel.value,
                "user_id": user_id,
                "test_message": request.test_message
            }
        )
        
        start_time = datetime.utcnow()
        response = await notification_agent.process_message(message)
        duration_ms = (datetime.utcnow() - start_time).total_seconds() * 1000
        
        return NotificationTestResponse(
            channel=request.channel,
            success=response.success,
            duration_ms=duration_ms,
            error_message=response.error if not response.success else None
        )
    
    except Exception as e:
        logger.error("Failed to test notification", error=str(e), user_id=user_id, channel=request.channel.value)
        return NotificationTestResponse(
            channel=request.channel,
            success=False,
            duration_ms=0,
            error_message=str(e)
        )


@router.post("/alerts", response_model=AlertNotificationResponse)
async def send_alert_notification(
    request: AlertNotificationRequest,
    background_tasks: BackgroundTasks,
    notification_agent: NotificationAgent = Depends(get_notification_agent)
):
    """
    Send an alert notification.
    
    Triggers the notification system to send alerts for a detected counterfeit product.
    Notifications will be sent to all eligible users based on their preferences.
    """
    try:
        # Create alert payload
        alert_payload = AlertPayload(
            severity=request.severity,
            product={
                "id": request.product_id,
                **request.analysis_data.get("product", {})
            },
            analysis=request.analysis_data.get("analysis", {}),
            actions=request.analysis_data.get("actions", {})
        )
        
        # Create notification request
        notification_request = NotificationRequest(
            alert_payload=alert_payload,
            user_ids=request.target_users,
            channel_override=request.channel_override,
            priority_override=request.priority_override
        )
        
        # Send notification through agent
        from ....agents.base import AgentMessage
        
        message = AgentMessage(
            sender_id="api",
            message_type="send_alert",
            payload=notification_request.dict()
        )
        
        response = await notification_agent.process_message(message)
        
        if not response.success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to send alert notification: {response.error}"
            )
        
        logger.info("Alert notification sent via API", product_id=request.product_id, alert_id=alert_payload.alert_id)
        
        return AlertNotificationResponse(
            alert_id=alert_payload.alert_id,
            total_notifications=response.result["total_notifications"],
            successful_deliveries=response.result["successful_deliveries"],
            failed_deliveries=response.result["failed_deliveries"],
            skipped_notifications=response.result["skipped_notifications"],
            processing_duration_ms=response.result["processing_duration_ms"]
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to send alert notification", error=str(e), product_id=request.product_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to send alert notification"
        )


@router.post("/alerts/bulk", response_model=BulkNotificationResponse)
async def send_bulk_alert_notifications(
    request: BulkNotificationRequest,
    notification_agent: NotificationAgent = Depends(get_notification_agent)
):
    """
    Send multiple alert notifications in bulk.
    
    Efficiently sends multiple alerts with optional consolidation of similar notifications.
    """
    try:
        # Convert requests to alert payloads
        alerts = []
        for alert_request in request.notifications:
            alert_payload = {
                "severity": alert_request.severity.value,
                "product": {
                    "id": alert_request.product_id,
                    **alert_request.analysis_data.get("product", {})
                },
                "analysis": alert_request.analysis_data.get("analysis", {}),
                "actions": alert_request.analysis_data.get("actions", {})
            }
            alerts.append(alert_payload)
        
        # Send batch notification
        from ....agents.base import AgentMessage
        
        message = AgentMessage(
            sender_id="api",
            message_type="batch_notify",
            payload={
                "alerts": alerts,
                "consolidate_similar": request.consolidate_similar
            }
        )
        
        start_time = datetime.utcnow()
        response = await notification_agent.process_message(message)
        duration_ms = (datetime.utcnow() - start_time).total_seconds() * 1000
        
        if not response.success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to send bulk alert notifications: {response.error}"
            )
        
        # Convert batch results to response format
        batch_results = []
        for result in response.result["batch_results"]:
            batch_results.append(AlertNotificationResponse(
                alert_id=result["alert_id"],
                total_notifications=result.get("total_notifications", 0),
                successful_deliveries=result["successful_deliveries"],
                failed_deliveries=result["failed_deliveries"],
                skipped_notifications=result.get("skipped_notifications", 0),
                processing_duration_ms=0  # Individual timing not tracked in batch
            ))
        
        summary = response.result["summary_stats"]
        
        logger.info("Bulk alert notifications sent via API", alerts_count=len(alerts))
        
        return BulkNotificationResponse(
            total_requested=len(request.notifications),
            successful_batches=summary["total_alerts_processed"],
            failed_batches=0,  # TODO: Track failed batches
            total_deliveries=summary["total_successful_deliveries"],
            processing_duration_ms=duration_ms,
            batch_results=batch_results
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to send bulk alert notifications", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to send bulk alert notifications"
        )


@router.get("/logs", response_model=NotificationLogListResponse)
async def list_notification_logs(
    user_id: Optional[str] = Query(None, description="Filter by user ID"),
    notification_type: Optional[str] = Query(None, description="Filter by notification type"),
    delivery_status: Optional[NotificationStatus] = Query(None, description="Filter by delivery status"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Number of logs per page"),
    notification_repo: NotificationRepository = Depends(get_notification_repository)
):
    """
    List notification logs with optional filtering.
    
    Returns a paginated list of notification logs with optional filters for user,
    notification type, and delivery status.
    """
    try:
        offset = (page - 1) * page_size
        
        logs, total_count = await notification_repo.get_notification_logs(
            user_id=user_id,
            notification_type=notification_type,
            delivery_status=delivery_status,
            limit=page_size,
            offset=offset
        )
        
        total_pages = (total_count + page_size - 1) // page_size
        
        return NotificationLogListResponse(
            logs=[NotificationLogResponse.from_orm(log) for log in logs],
            total_count=total_count,
            page=page,
            page_size=page_size,
            total_pages=total_pages
        )
    
    except Exception as e:
        logger.error("Failed to list notification logs", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve notification logs"
        )


@router.get("/stats", response_model=NotificationStatsResponse)
async def get_notification_statistics(
    user_id: Optional[str] = Query(None, description="Filter by user ID"),
    notification_repo: NotificationRepository = Depends(get_notification_repository)
):
    """
    Get notification delivery statistics.
    
    Returns comprehensive statistics about notification delivery including
    success rates, failure counts, and distribution by type and status.
    """
    try:
        stats = await notification_repo.get_notification_statistics(user_id=user_id)
        return NotificationStatsResponse(**stats)
    
    except Exception as e:
        logger.error("Failed to get notification statistics", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve notification statistics"
        )


@router.post("/webhooks/test", response_model=WebhookTestResponse)
async def test_webhook_endpoint(
    request: WebhookTestRequest
):
    """
    Test a webhook endpoint.
    
    Sends a test payload to the specified webhook URL to verify connectivity
    and configuration.
    """
    try:
        async with WebhookService() as webhook_service:
            result = await webhook_service.test_webhook_endpoint(
                webhook_url=request.url,
                secret=request.secret,
                custom_headers=request.custom_headers
            )
            
            last_attempt = result.get_last_attempt()
            
            return WebhookTestResponse(
                url=request.url,
                success=result.is_successful(),
                attempts=len(result.attempts),
                final_status_code=last_attempt.status_code if last_attempt else None,
                total_duration_ms=result.total_duration_ms,
                error_message=last_attempt.error_message if last_attempt and not result.is_successful() else None
            )
    
    except Exception as e:
        logger.error("Failed to test webhook endpoint", error=str(e), url=request.url)
        return WebhookTestResponse(
            url=request.url,
            success=False,
            attempts=0,
            total_duration_ms=0,
            error_message=str(e)
        )


@router.get("/channels", response_model=List[NotificationChannelConfigResponse])
async def list_notification_channels():
    """
    List available notification channels and their configurations.
    
    Returns information about all supported notification channels including
    their configuration schemas and capabilities.
    """
    try:
        channels = []
        
        for channel in NotificationChannel:
            # Define configuration schemas for each channel
            config_schemas = {
                NotificationChannel.SLACK: {
                    "type": "object",
                    "properties": {
                        "channel": {"type": "string", "description": "Slack channel"},
                        "bot_token": {"type": "string", "description": "Bot token (optional)"},
                        "username": {"type": "string", "description": "Bot username"},
                        "icon_emoji": {"type": "string", "description": "Bot icon emoji"}
                    },
                    "required": ["channel"]
                },
                NotificationChannel.EMAIL: {
                    "type": "object",
                    "properties": {
                        "email": {"type": "string", "format": "email", "description": "Email address"},
                        "recipient_name": {"type": "string", "description": "Recipient name"},
                        "from_name": {"type": "string", "description": "Sender name"},
                        "from_email": {"type": "string", "format": "email", "description": "Sender email"}
                    },
                    "required": ["email"]
                },
                NotificationChannel.WEBHOOK: {
                    "type": "object",
                    "properties": {
                        "url": {"type": "string", "format": "uri", "description": "Webhook URL"},
                        "secret": {"type": "string", "description": "Webhook secret"},
                        "event_type": {"type": "string", "description": "Event type"},
                        "headers": {"type": "object", "description": "Custom headers"}
                    },
                    "required": ["url"]
                },
                NotificationChannel.SMS: {
                    "type": "object",
                    "properties": {
                        "phone_number": {"type": "string", "description": "Phone number"},
                        "provider": {"type": "string", "description": "SMS provider"}
                    },
                    "required": ["phone_number"]
                }
            }
            
            channels.append(NotificationChannelConfigResponse(
                channel=channel,
                enabled=channel in {NotificationChannel.SLACK, NotificationChannel.EMAIL, NotificationChannel.WEBHOOK},
                configuration_schema=config_schemas.get(channel, {}),
                test_available=True
            ))
        
        return channels
    
    except Exception as e:
        logger.error("Failed to list notification channels", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve notification channels"
        )


@router.delete("/logs/cleanup")
async def cleanup_old_notification_logs(
    days_to_keep: int = Query(30, ge=1, le=365, description="Number of days to keep logs"),
    notification_repo: NotificationRepository = Depends(get_notification_repository)
):
    """
    Clean up old notification logs.
    
    Removes notification logs older than the specified number of days to manage
    database storage and improve performance.
    """
    try:
        deleted_count = await notification_repo.cleanup_old_logs(days_to_keep)
        
        logger.info("Notification logs cleanup completed", deleted_count=deleted_count, days_to_keep=days_to_keep)
        
        return JSONResponse(
            content={
                "message": "Notification logs cleanup completed",
                "deleted_count": deleted_count,
                "days_to_keep": days_to_keep
            }
        )
    
    except Exception as e:
        logger.error("Failed to cleanup notification logs", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to cleanup notification logs"
        )