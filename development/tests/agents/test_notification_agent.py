"""
Tests for NotificationAgent functionality.

This module tests the notification agent's ability to send alerts through
various channels (Slack, email, webhooks) and manage user preferences.
"""

import asyncio
import json
from datetime import datetime, time
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from src.counterfeit_detection.agents.notification_agent import (
    NotificationAgent,
    AlertPayload,
    NotificationRequest,
    NotificationResult,
    BatchNotificationResult
)
from src.counterfeit_detection.agents.base import AgentMessage, AgentResponse
from src.counterfeit_detection.models.enums import NotificationChannel, NotificationStatus, AlertSeverity


class TestNotificationAgent:
    """Test NotificationAgent functionality."""
    
    @pytest.fixture
    def mock_db_session(self):
        """Mock database session."""
        with patch('src.counterfeit_detection.core.database.get_db_session') as mock_session:
            session_context = AsyncMock()
            session_context.__aenter__ = AsyncMock(return_value=session_context)
            session_context.__aexit__ = AsyncMock(return_value=None)
            mock_session.return_value = session_context
            yield session_context
    
    @pytest.fixture
    def mock_notification_services(self):
        """Mock notification services."""
        with patch('src.counterfeit_detection.services.notification_service.NotificationService') as mock_notification_service, \
             patch('src.counterfeit_detection.services.webhook_service.WebhookService') as mock_webhook_service:
            
            # Mock notification service
            notification_service_instance = AsyncMock()
            notification_service_instance.send_slack_notification.return_value = True
            notification_service_instance.send_email_notification.return_value = True
            mock_notification_service.return_value = notification_service_instance
            
            # Mock webhook service
            webhook_service_instance = AsyncMock()
            webhook_service_instance.send_webhook_notification.return_value = True
            mock_webhook_service.return_value = webhook_service_instance
            
            yield {
                "notification_service": notification_service_instance,
                "webhook_service": webhook_service_instance
            }
    
    @pytest.fixture
    def sample_alert_payload(self):
        """Sample alert payload for testing."""
        return AlertPayload(
            severity=AlertSeverity.HIGH,
            product={
                "id": str(uuid4()),
                "description": "Suspicious luxury handbag",
                "category": "bags",
                "brand": "LuxuryBrand",
                "price": 99.99
            },
            analysis={
                "authenticity_score": 15,
                "confidence": 0.87,
                "reasoning": "Multiple red flags detected",
                "red_flags": ["Price too low", "Suspicious description"],
                "rule_matches": ["threshold_luxury_goods", "keyword_replica"]
            },
            actions={
                "admin_dashboard_url": "https://admin.example.com/products/123",
                "recommended_action": "immediate_removal"
            }
        )
    
    @pytest.fixture
    async def notification_agent(self, mock_db_session, mock_notification_services):
        """Create notification agent for testing."""
        agent = NotificationAgent("test-notification-agent")
        
        # Don't actually start to avoid Redis dependencies
        agent.status = agent.status.RUNNING
        
        # Mock services
        agent.notification_service = mock_notification_services["notification_service"]
        agent.webhook_service = mock_notification_services["webhook_service"]
        agent.notification_repository = AsyncMock()
        
        yield agent
    
    @pytest.mark.asyncio
    async def test_agent_initialization(self):
        """Test notification agent initialization."""
        agent = NotificationAgent("test-agent")
        
        assert agent.agent_id == "test-agent"
        assert agent.agent_type == "notification_agent"
        assert len(agent.capabilities) == 2
        
        capability_names = [cap.name for cap in agent.capabilities]
        assert "send_alert" in capability_names
        assert "batch_notify" in capability_names
    
    @pytest.mark.asyncio
    async def test_process_message_send_alert(self, notification_agent, sample_alert_payload):
        """Test processing send alert message."""
        with patch.object(notification_agent, 'send_alert_notification') as mock_send:
            mock_result = BatchNotificationResult(
                alert_id=sample_alert_payload.alert_id,
                total_notifications=2,
                successful_deliveries=2,
                failed_deliveries=0,
                skipped_notifications=0,
                processing_duration_ms=150.0
            )
            mock_send.return_value = mock_result
            
            message = AgentMessage(
                sender_id="test-sender",
                message_type="send_alert",
                payload={
                    "alert_payload": sample_alert_payload.dict(),
                    "user_ids": ["user1", "user2"],
                    "priority_override": False
                }
            )
            
            response = await notification_agent.process_message(message)
            
            assert response.success is True
            assert response.result["total_notifications"] == 2
            assert response.result["successful_deliveries"] == 2
            mock_send.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_process_message_test_notification(self, notification_agent):
        """Test processing test notification message."""
        message = AgentMessage(
            sender_id="test-sender",
            message_type="test_notification",
            payload={
                "channel": "slack",
                "user_id": "test-user"
            }
        )
        
        with patch.object(notification_agent, 'send_alert_notification') as mock_send:
            mock_result = BatchNotificationResult(
                alert_id="test-alert",
                total_notifications=1,
                successful_deliveries=1,
                failed_deliveries=0,
                skipped_notifications=0,
                processing_duration_ms=100.0
            )
            mock_send.return_value = mock_result
            
            response = await notification_agent.process_message(message)
            
            assert response.success is True
            assert response.result["test_completed"] is True
            assert response.result["notifications_sent"] == 1
    
    @pytest.mark.asyncio
    async def test_send_alert_notification_success(
        self, 
        notification_agent, 
        sample_alert_payload
    ):
        """Test successful alert notification sending."""
        # Mock eligible users
        with patch.object(notification_agent, '_get_eligible_users') as mock_get_users, \
             patch.object(notification_agent, '_send_single_notification') as mock_send_single, \
             patch.object(notification_agent, '_log_notification_batch') as mock_log:
            
            # Mock eligible users with channels
            mock_get_users.return_value = {
                "user1": [NotificationChannel.SLACK],
                "user2": [NotificationChannel.EMAIL]
            }
            
            # Mock successful single notifications
            mock_send_single.side_effect = [
                NotificationResult(
                    alert_id=sample_alert_payload.alert_id,
                    user_id="user1",
                    channel=NotificationChannel.SLACK,
                    status=NotificationStatus.SENT,
                    delivery_duration_ms=100.0
                ),
                NotificationResult(
                    alert_id=sample_alert_payload.alert_id,
                    user_id="user2", 
                    channel=NotificationChannel.EMAIL,
                    status=NotificationStatus.SENT,
                    delivery_duration_ms=150.0
                )
            ]
            
            request = NotificationRequest(
                alert_payload=sample_alert_payload,
                priority_override=False
            )
            
            result = await notification_agent.send_alert_notification(request)
            
            assert result.total_notifications == 2
            assert result.successful_deliveries == 2
            assert result.failed_deliveries == 0
            assert len(result.results) == 2
            mock_log.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_send_single_notification_slack(self, notification_agent, sample_alert_payload):
        """Test sending single Slack notification."""
        # Mock notification repository
        mock_endpoint = MagicMock()
        mock_endpoint.endpoint_config = {
            "channel": "#alerts",
            "bot_token": "test-token"
        }
        
        notification_agent.notification_repository.get_user_channel_endpoint.return_value = mock_endpoint
        
        result = await notification_agent._send_single_notification(
            sample_alert_payload,
            "user1",
            NotificationChannel.SLACK
        )
        
        assert result.status == NotificationStatus.SENT
        assert result.user_id == "user1"
        assert result.channel == NotificationChannel.SLACK
        notification_agent.notification_service.send_slack_notification.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_send_single_notification_email(self, notification_agent, sample_alert_payload):
        """Test sending single email notification."""
        # Mock notification repository
        mock_endpoint = MagicMock()
        mock_endpoint.endpoint_config = {
            "email": "admin@example.com",
            "recipient_name": "Admin User"
        }
        
        notification_agent.notification_repository.get_user_channel_endpoint.return_value = mock_endpoint
        
        result = await notification_agent._send_single_notification(
            sample_alert_payload,
            "user1",
            NotificationChannel.EMAIL
        )
        
        assert result.status == NotificationStatus.SENT
        assert result.user_id == "user1"
        assert result.channel == NotificationChannel.EMAIL
        notification_agent.notification_service.send_email_notification.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_send_single_notification_webhook(self, notification_agent, sample_alert_payload):
        """Test sending single webhook notification."""
        # Mock notification repository
        mock_endpoint = MagicMock()
        mock_endpoint.endpoint_config = {
            "url": "https://example.com/webhook",
            "secret": "webhook-secret"
        }
        
        notification_agent.notification_repository.get_user_channel_endpoint.return_value = mock_endpoint
        
        result = await notification_agent._send_single_notification(
            sample_alert_payload,
            "user1",
            NotificationChannel.WEBHOOK
        )
        
        assert result.status == NotificationStatus.SENT
        assert result.user_id == "user1"
        assert result.channel == NotificationChannel.WEBHOOK
        notification_agent.webhook_service.send_webhook_notification.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_send_single_notification_no_endpoint(self, notification_agent, sample_alert_payload):
        """Test sending notification when no endpoint is configured."""
        # Mock no endpoint found
        notification_agent.notification_repository.get_user_channel_endpoint.return_value = None
        
        result = await notification_agent._send_single_notification(
            sample_alert_payload,
            "user1",
            NotificationChannel.SLACK
        )
        
        assert result.status == NotificationStatus.SKIPPED
        assert "No endpoint configured" in result.error_message
    
    @pytest.mark.asyncio
    async def test_get_eligible_users_with_preferences(self, notification_agent):
        """Test getting eligible users based on preferences."""
        # Mock notification repository
        mock_preferences = MagicMock()
        mock_preferences.alert_threshold_score = 30
        mock_preferences.severity_levels = ["high", "critical"]
        mock_preferences.rate_limit_per_hour = 10
        
        notification_agent.notification_repository.get_all_notification_users.return_value = ["user1", "user2"]
        notification_agent.notification_repository.get_user_preferences.return_value = mock_preferences
        notification_agent.notification_repository.get_user_channels.return_value = [NotificationChannel.SLACK]
        
        # Mock quiet hours and rate limiting checks
        with patch.object(notification_agent, '_is_quiet_hours', return_value=False), \
             patch.object(notification_agent, '_is_rate_limited', return_value=False):
            
            request = NotificationRequest(
                alert_payload=AlertPayload(
                    severity=AlertSeverity.HIGH,
                    product={"id": "test"},
                    analysis={"authenticity_score": 15},  # Below threshold
                    actions={}
                )
            )
            
            eligible_users = await notification_agent._get_eligible_users(request)
            
            assert "user1" in eligible_users
            assert "user2" in eligible_users
            assert NotificationChannel.SLACK in eligible_users["user1"]
    
    @pytest.mark.asyncio
    async def test_get_eligible_users_threshold_filter(self, notification_agent):
        """Test user filtering based on alert threshold."""
        # Mock high threshold preferences
        mock_preferences = MagicMock()
        mock_preferences.alert_threshold_score = 10  # Very low threshold
        mock_preferences.severity_levels = ["high", "critical"]
        
        notification_agent.notification_repository.get_all_notification_users.return_value = ["user1"]
        notification_agent.notification_repository.get_user_preferences.return_value = mock_preferences
        
        request = NotificationRequest(
            alert_payload=AlertPayload(
                severity=AlertSeverity.HIGH,
                product={"id": "test"},
                analysis={"authenticity_score": 50},  # Above threshold
                actions={}
            )
        )
        
        eligible_users = await notification_agent._get_eligible_users(request)
        
        assert len(eligible_users) == 0  # Should be filtered out
    
    @pytest.mark.asyncio
    async def test_is_quiet_hours(self, notification_agent):
        """Test quiet hours checking."""
        # Mock preferences with quiet hours
        mock_preferences = MagicMock()
        mock_preferences.quiet_hours_start = time(22, 0)  # 10 PM
        mock_preferences.quiet_hours_end = time(8, 0)     # 8 AM
        
        # Test during quiet hours (e.g., 2 AM)
        with patch('src.counterfeit_detection.agents.notification_agent.datetime') as mock_datetime:
            mock_datetime.now.return_value.time.return_value = time(2, 0)
            
            is_quiet = await notification_agent._is_quiet_hours(mock_preferences)
            assert is_quiet is True
        
        # Test outside quiet hours (e.g., 2 PM)
        with patch('src.counterfeit_detection.agents.notification_agent.datetime') as mock_datetime:
            mock_datetime.now.return_value.time.return_value = time(14, 0)
            
            is_quiet = await notification_agent._is_quiet_hours(mock_preferences)
            assert is_quiet is False
    
    @pytest.mark.asyncio
    async def test_is_rate_limited(self, notification_agent):
        """Test rate limiting functionality."""
        mock_preferences = MagicMock()
        mock_preferences.rate_limit_per_hour = 5
        
        user_id = "test-user"
        
        # First few notifications should not be rate limited
        for i in range(5):
            is_limited = await notification_agent._is_rate_limited(user_id, mock_preferences)
            assert is_limited is False
        
        # 6th notification should be rate limited
        is_limited = await notification_agent._is_rate_limited(user_id, mock_preferences)
        assert is_limited is True
    
    @pytest.mark.asyncio
    async def test_consolidate_similar_alerts(self, notification_agent):
        """Test alert consolidation functionality."""
        alerts = [
            {
                "severity": "high",
                "product": {"category": "bags", "description": "Alert 1"},
                "analysis": {},
                "actions": {}
            },
            {
                "severity": "high", 
                "product": {"category": "bags", "description": "Alert 2"},
                "analysis": {},
                "actions": {}
            },
            {
                "severity": "medium",
                "product": {"category": "electronics", "description": "Alert 3"},
                "analysis": {},
                "actions": {}
            }
        ]
        
        consolidated = await notification_agent._consolidate_similar_alerts(alerts)
        
        # Should consolidate the two high/bags alerts
        assert len(consolidated) == 2
        
        # Find the consolidated bags alert
        bags_alert = next(a for a in consolidated if a["product"]["category"] == "bags")
        assert bags_alert["consolidated_count"] == 2
        assert "Consolidated alert" in bags_alert["product"]["description"]
    
    @pytest.mark.asyncio
    async def test_process_message_get_stats(self, notification_agent):
        """Test getting notification agent statistics."""
        # Set some test metrics
        notification_agent.total_notifications_sent = 100
        notification_agent.total_delivery_time = 15000.0  # 15 seconds total
        notification_agent.channel_stats = {"slack": 60, "email": 40}
        notification_agent.processed_messages = 50
        notification_agent.error_count = 5
        
        message = AgentMessage(
            sender_id="test-sender",
            message_type="get_notification_stats",
            payload={}
        )
        
        response = await notification_agent.process_message(message)
        
        assert response.success is True
        assert response.result["total_notifications_sent"] == 100
        assert response.result["average_delivery_time_ms"] == 150.0  # 15000/100
        assert response.result["channel_distribution"] == {"slack": 60, "email": 40}
        assert response.result["processed_messages"] == 50
        assert response.result["error_count"] == 5


class TestAlertPayload:
    """Test AlertPayload model."""
    
    def test_alert_payload_creation(self):
        """Test creating alert payload."""
        payload = AlertPayload(
            severity=AlertSeverity.CRITICAL,
            product={"id": "test-product"},
            analysis={"authenticity_score": 5},
            actions={"recommended_action": "remove"}
        )
        
        assert payload.severity == AlertSeverity.CRITICAL
        assert payload.product["id"] == "test-product"
        assert payload.analysis["authenticity_score"] == 5
        assert payload.alert_id is not None
        assert payload.timestamp is not None
    
    def test_alert_payload_auto_fields(self):
        """Test auto-generated fields in alert payload."""
        payload1 = AlertPayload(
            severity=AlertSeverity.LOW,
            product={},
            analysis={},
            actions={}
        )
        
        payload2 = AlertPayload(
            severity=AlertSeverity.LOW,
            product={},
            analysis={},
            actions={}
        )
        
        # Should have different IDs and timestamps
        assert payload1.alert_id != payload2.alert_id
        assert payload1.timestamp <= payload2.timestamp


class TestNotificationResult:
    """Test NotificationResult model."""
    
    def test_notification_result_creation(self):
        """Test creating notification result."""
        result = NotificationResult(
            alert_id="test-alert",
            user_id="test-user",
            channel=NotificationChannel.EMAIL,
            status=NotificationStatus.SENT,
            delivery_duration_ms=250.5
        )
        
        assert result.alert_id == "test-alert"
        assert result.user_id == "test-user"
        assert result.channel == NotificationChannel.EMAIL
        assert result.status == NotificationStatus.SENT
        assert result.delivery_duration_ms == 250.5
        assert result.notification_id is not None
        assert result.sent_at is not None


class TestBatchNotificationResult:
    """Test BatchNotificationResult model."""
    
    def test_batch_result_creation(self):
        """Test creating batch notification result."""
        result = BatchNotificationResult(
            alert_id="test-alert",
            total_notifications=5,
            successful_deliveries=4,
            failed_deliveries=1,
            skipped_notifications=0,
            processing_duration_ms=1500.0
        )
        
        assert result.alert_id == "test-alert"
        assert result.total_notifications == 5
        assert result.successful_deliveries == 4
        assert result.failed_deliveries == 1
        assert result.skipped_notifications == 0
        assert result.processing_duration_ms == 1500.0
        assert result.batch_id is not None