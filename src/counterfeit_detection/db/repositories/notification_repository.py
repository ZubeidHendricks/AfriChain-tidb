"""
Repository for managing notification data and user preferences.

This repository handles CRUD operations for notification endpoints,
user preferences, and notification logging.
"""

import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from uuid import uuid4

from sqlalchemy import and_, desc, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

import structlog

from ..models.database import NotificationEndpoint, UserNotificationPreferences, NotificationLog
from ..models.enums import NotificationChannel, NotificationStatus

logger = structlog.get_logger(__name__)


class NotificationRepository:
    """Repository for notification data access."""
    
    def __init__(self, session: AsyncSession):
        self.session = session
    
    async def create_notification_endpoint(self, endpoint_data: Dict) -> NotificationEndpoint:
        """
        Create a new notification endpoint.
        
        Args:
            endpoint_data: Dictionary containing endpoint information
            
        Returns:
            Created NotificationEndpoint instance
        """
        try:
            endpoint = NotificationEndpoint(
                id=endpoint_data.get("id", str(uuid4())),
                user_id=endpoint_data["user_id"],
                endpoint_type=NotificationChannel(endpoint_data["endpoint_type"]),
                endpoint_config=endpoint_data["endpoint_config"],
                is_active=endpoint_data.get("is_active", True)
            )
            
            self.session.add(endpoint)
            await self.session.commit()
            await self.session.refresh(endpoint)
            
            logger.info("Notification endpoint created", endpoint_id=endpoint.id, user_id=endpoint.user_id)
            return endpoint
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to create notification endpoint", error=str(e))
            raise
    
    async def get_notification_endpoint_by_id(self, endpoint_id: str) -> Optional[NotificationEndpoint]:
        """
        Get a notification endpoint by ID.
        
        Args:
            endpoint_id: Endpoint identifier
            
        Returns:
            NotificationEndpoint instance or None if not found
        """
        try:
            result = await self.session.execute(
                select(NotificationEndpoint).where(NotificationEndpoint.id == endpoint_id)
            )
            return result.scalar_one_or_none()
        
        except Exception as e:
            logger.error("Failed to get notification endpoint by ID", error=str(e), endpoint_id=endpoint_id)
            raise
    
    async def get_user_notification_endpoints(self, user_id: str) -> List[NotificationEndpoint]:
        """
        Get all notification endpoints for a user.
        
        Args:
            user_id: User identifier
            
        Returns:
            List of NotificationEndpoint instances
        """
        try:
            result = await self.session.execute(
                select(NotificationEndpoint)
                .where(
                    and_(
                        NotificationEndpoint.user_id == user_id,
                        NotificationEndpoint.is_active == True
                    )
                )
                .order_by(NotificationEndpoint.created_at)
            )
            return result.scalars().all()
        
        except Exception as e:
            logger.error("Failed to get user notification endpoints", error=str(e), user_id=user_id)
            raise
    
    async def get_user_channel_endpoint(self, user_id: str, channel: NotificationChannel) -> Optional[NotificationEndpoint]:
        """
        Get user's endpoint for a specific channel.
        
        Args:
            user_id: User identifier
            channel: Notification channel
            
        Returns:
            NotificationEndpoint instance or None if not found
        """
        try:
            result = await self.session.execute(
                select(NotificationEndpoint)
                .where(
                    and_(
                        NotificationEndpoint.user_id == user_id,
                        NotificationEndpoint.endpoint_type == channel,
                        NotificationEndpoint.is_active == True
                    )
                )
                .limit(1)
            )
            return result.scalar_one_or_none()
        
        except Exception as e:
            logger.error("Failed to get user channel endpoint", error=str(e), user_id=user_id, channel=channel.value)
            raise
    
    async def update_notification_endpoint(self, endpoint_id: str, update_data: Dict) -> Optional[NotificationEndpoint]:
        """
        Update an existing notification endpoint.
        
        Args:
            endpoint_id: Endpoint identifier
            update_data: Dictionary containing fields to update
            
        Returns:
            Updated NotificationEndpoint instance or None if not found
        """
        try:
            endpoint = await self.get_notification_endpoint_by_id(endpoint_id)
            if not endpoint:
                return None
            
            # Update allowed fields
            allowed_fields = {"endpoint_config", "is_active"}
            for field, value in update_data.items():
                if field in allowed_fields and hasattr(endpoint, field):
                    setattr(endpoint, field, value)
            
            await self.session.commit()
            await self.session.refresh(endpoint)
            
            logger.info("Notification endpoint updated", endpoint_id=endpoint_id, updated_fields=list(update_data.keys()))
            return endpoint
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to update notification endpoint", error=str(e), endpoint_id=endpoint_id)
            raise
    
    async def delete_notification_endpoint(self, endpoint_id: str) -> bool:
        """
        Delete a notification endpoint.
        
        Args:
            endpoint_id: Endpoint identifier
            
        Returns:
            True if endpoint was deleted, False if not found
        """
        try:
            endpoint = await self.get_notification_endpoint_by_id(endpoint_id)
            if not endpoint:
                return False
            
            await self.session.delete(endpoint)
            await self.session.commit()
            
            logger.info("Notification endpoint deleted", endpoint_id=endpoint_id)
            return True
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to delete notification endpoint", error=str(e), endpoint_id=endpoint_id)
            raise
    
    async def create_user_preferences(self, preferences_data: Dict) -> UserNotificationPreferences:
        """
        Create user notification preferences.
        
        Args:
            preferences_data: Dictionary containing preference information
            
        Returns:
            Created UserNotificationPreferences instance
        """
        try:
            preferences = UserNotificationPreferences(
                id=preferences_data.get("id", str(uuid4())),
                user_id=preferences_data["user_id"],
                alert_threshold_score=preferences_data.get("alert_threshold_score", 30),
                severity_levels=preferences_data.get("severity_levels", ["high", "critical"]),
                quiet_hours_start=preferences_data.get("quiet_hours_start"),
                quiet_hours_end=preferences_data.get("quiet_hours_end"),
                business_days_only=preferences_data.get("business_days_only", False),
                rate_limit_per_hour=preferences_data.get("rate_limit_per_hour", 10)
            )
            
            self.session.add(preferences)
            await self.session.commit()
            await self.session.refresh(preferences)
            
            logger.info("User notification preferences created", user_id=preferences.user_id)
            return preferences
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to create user notification preferences", error=str(e))
            raise
    
    async def get_user_preferences(self, user_id: str) -> Optional[UserNotificationPreferences]:
        """
        Get user notification preferences.
        
        Args:
            user_id: User identifier
            
        Returns:
            UserNotificationPreferences instance or None if not found
        """
        try:
            result = await self.session.execute(
                select(UserNotificationPreferences).where(UserNotificationPreferences.user_id == user_id)
            )
            return result.scalar_one_or_none()
        
        except Exception as e:
            logger.error("Failed to get user notification preferences", error=str(e), user_id=user_id)
            raise
    
    async def update_user_preferences(self, user_id: str, update_data: Dict) -> Optional[UserNotificationPreferences]:
        """
        Update user notification preferences.
        
        Args:
            user_id: User identifier
            update_data: Dictionary containing fields to update
            
        Returns:
            Updated UserNotificationPreferences instance or None if not found
        """
        try:
            preferences = await self.get_user_preferences(user_id)
            if not preferences:
                return None
            
            # Update allowed fields
            allowed_fields = {
                "alert_threshold_score", "severity_levels", "quiet_hours_start", 
                "quiet_hours_end", "business_days_only", "rate_limit_per_hour"
            }
            for field, value in update_data.items():
                if field in allowed_fields and hasattr(preferences, field):
                    setattr(preferences, field, value)
            
            await self.session.commit()
            await self.session.refresh(preferences)
            
            logger.info("User notification preferences updated", user_id=user_id, updated_fields=list(update_data.keys()))
            return preferences
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to update user notification preferences", error=str(e), user_id=user_id)
            raise
    
    async def get_all_notification_users(self) -> List[str]:
        """
        Get all user IDs that have notification endpoints or preferences.
        
        Returns:
            List of user IDs
        """
        try:
            # Get users with endpoints
            endpoint_users_result = await self.session.execute(
                select(NotificationEndpoint.user_id)
                .where(NotificationEndpoint.is_active == True)
                .distinct()
            )
            endpoint_users = set(endpoint_users_result.scalars().all())
            
            # Get users with preferences
            preference_users_result = await self.session.execute(
                select(UserNotificationPreferences.user_id).distinct()
            )
            preference_users = set(preference_users_result.scalars().all())
            
            # Return union of both sets
            return list(endpoint_users.union(preference_users))
        
        except Exception as e:
            logger.error("Failed to get all notification users", error=str(e))
            raise
    
    async def get_user_channels(self, user_id: str) -> List[NotificationChannel]:
        """
        Get notification channels configured for a user.
        
        Args:
            user_id: User identifier
            
        Returns:
            List of NotificationChannel enums
        """
        try:
            result = await self.session.execute(
                select(NotificationEndpoint.endpoint_type)
                .where(
                    and_(
                        NotificationEndpoint.user_id == user_id,
                        NotificationEndpoint.is_active == True
                    )
                )
                .distinct()
            )
            return result.scalars().all()
        
        except Exception as e:
            logger.error("Failed to get user channels", error=str(e), user_id=user_id)
            raise
    
    async def log_notification(
        self,
        product_id: Optional[str],
        user_id: str,
        notification_type: str,
        delivery_status: NotificationStatus,
        payload: Optional[Dict] = None,
        error_message: Optional[str] = None
    ) -> NotificationLog:
        """
        Log a notification delivery attempt.
        
        Args:
            product_id: Product identifier (optional)
            user_id: User identifier
            notification_type: Type of notification
            delivery_status: Delivery status
            payload: Notification payload (optional)
            error_message: Error message if failed (optional)
            
        Returns:
            Created NotificationLog instance
        """
        try:
            log_entry = NotificationLog(
                id=str(uuid4()),
                product_id=product_id,
                user_id=user_id,
                notification_type=notification_type,
                delivery_status=delivery_status,
                payload=payload,
                error_message=error_message
            )
            
            self.session.add(log_entry)
            await self.session.commit()
            await self.session.refresh(log_entry)
            
            return log_entry
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to log notification", error=str(e))
            raise
    
    async def get_notification_logs(
        self,
        user_id: Optional[str] = None,
        notification_type: Optional[str] = None,
        delivery_status: Optional[NotificationStatus] = None,
        limit: int = 100,
        offset: int = 0
    ) -> Tuple[List[NotificationLog], int]:
        """
        Get notification logs with filtering.
        
        Args:
            user_id: Optional user filter
            notification_type: Optional notification type filter
            delivery_status: Optional delivery status filter
            limit: Maximum number of results
            offset: Number of results to skip
            
        Returns:
            Tuple of (logs list, total count)
        """
        try:
            # Build query conditions
            conditions = []
            
            if user_id:
                conditions.append(NotificationLog.user_id == user_id)
            
            if notification_type:
                conditions.append(NotificationLog.notification_type == notification_type)
            
            if delivery_status:
                conditions.append(NotificationLog.delivery_status == delivery_status)
            
            base_query = select(NotificationLog)
            if conditions:
                base_query = base_query.where(and_(*conditions))
            
            # Get total count
            count_query = select(func.count(NotificationLog.id))
            if conditions:
                count_query = count_query.where(and_(*conditions))
            
            count_result = await self.session.execute(count_query)
            total_count = count_result.scalar()
            
            # Get paginated results
            query = base_query.order_by(
                desc(NotificationLog.sent_at)
            ).limit(limit).offset(offset)
            
            result = await self.session.execute(query)
            logs = result.scalars().all()
            
            return logs, total_count
        
        except Exception as e:
            logger.error("Failed to get notification logs", error=str(e))
            raise
    
    async def get_notification_statistics(self, user_id: Optional[str] = None) -> Dict:
        """
        Get notification delivery statistics.
        
        Args:
            user_id: Optional user filter
            
        Returns:
            Dictionary containing notification statistics
        """
        try:
            conditions = []
            if user_id:
                conditions.append(NotificationLog.user_id == user_id)
            
            # Total notifications
            total_query = select(func.count(NotificationLog.id))
            if conditions:
                total_query = total_query.where(and_(*conditions))
            
            total_result = await self.session.execute(total_query)
            total_notifications = total_result.scalar()
            
            # Notifications by status
            status_query = select(
                NotificationLog.delivery_status,
                func.count(NotificationLog.id)
            ).group_by(NotificationLog.delivery_status)
            
            if conditions:
                status_query = status_query.where(and_(*conditions))
            
            status_result = await self.session.execute(status_query)
            status_counts = {status.value: count for status, count in status_result.all()}
            
            # Notifications by type
            type_query = select(
                NotificationLog.notification_type,
                func.count(NotificationLog.id)
            ).group_by(NotificationLog.notification_type)
            
            if conditions:
                type_query = type_query.where(and_(*conditions))
            
            type_result = await self.session.execute(type_query)
            type_counts = {notification_type: count for notification_type, count in type_result.all()}
            
            # Success rate
            successful = status_counts.get("sent", 0)
            success_rate = (successful / total_notifications * 100) if total_notifications > 0 else 0
            
            return {
                "total_notifications": total_notifications,
                "successful_deliveries": successful,
                "failed_deliveries": status_counts.get("failed", 0),
                "retry_deliveries": status_counts.get("retry", 0),
                "skipped_deliveries": status_counts.get("skipped", 0),
                "success_rate": success_rate,
                "notifications_by_type": type_counts,
                "notifications_by_status": status_counts
            }
        
        except Exception as e:
            logger.error("Failed to get notification statistics", error=str(e))
            raise
    
    async def cleanup_old_logs(self, days_to_keep: int = 30) -> int:
        """
        Clean up old notification logs.
        
        Args:
            days_to_keep: Number of days to keep logs
            
        Returns:
            Number of deleted log entries
        """
        try:
            cutoff_date = datetime.utcnow() - timedelta(days=days_to_keep)
            
            # Delete old logs
            result = await self.session.execute(
                select(NotificationLog).where(NotificationLog.sent_at < cutoff_date)
            )
            old_logs = result.scalars().all()
            
            for log in old_logs:
                await self.session.delete(log)
            
            await self.session.commit()
            
            logger.info("Notification logs cleaned up", deleted_count=len(old_logs), cutoff_date=cutoff_date)
            return len(old_logs)
        
        except Exception as e:
            await self.session.rollback()
            logger.error("Failed to cleanup old notification logs", error=str(e))
            raise