"""
Webhook Service for external system integrations.

This service handles webhook delivery with signature verification,
retry logic, and comprehensive error handling for reliable integration
with external systems.
"""

import asyncio
import hashlib
import hmac
import json
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
from uuid import uuid4

import aiohttp
import structlog

from ..agents.notification_agent import AlertPayload
from ..core.config import get_settings
from ..models.enums import WebhookEventType, WebhookStatus

logger = structlog.get_logger(__name__)


class WebhookAttempt:
    """Represents a webhook delivery attempt."""
    
    def __init__(
        self,
        attempt_number: int,
        url: str,
        payload: Dict[str, Any],
        headers: Dict[str, str]
    ):
        self.attempt_number = attempt_number
        self.url = url
        self.payload = payload
        self.headers = headers
        self.started_at: Optional[datetime] = None
        self.completed_at: Optional[datetime] = None
        self.status_code: Optional[int] = None
        self.response_body: Optional[str] = None
        self.error_message: Optional[str] = None
        self.duration_ms: Optional[float] = None


class WebhookDeliveryResult:
    """Result of webhook delivery including all attempts."""
    
    def __init__(self, webhook_id: str, endpoint_url: str):
        self.webhook_id = webhook_id
        self.endpoint_url = endpoint_url
        self.attempts: List[WebhookAttempt] = []
        self.final_status: WebhookStatus = WebhookStatus.PENDING
        self.total_duration_ms: float = 0.0
        self.created_at = datetime.utcnow()
        self.completed_at: Optional[datetime] = None
    
    def add_attempt(self, attempt: WebhookAttempt):
        """Add an attempt to the delivery result."""
        self.attempts.append(attempt)
        
        # Update final status based on last attempt
        if attempt.status_code and 200 <= attempt.status_code < 300:
            self.final_status = WebhookStatus.DELIVERED
        elif len(self.attempts) >= 3:  # Max attempts reached
            self.final_status = WebhookStatus.FAILED
        else:
            self.final_status = WebhookStatus.RETRY
    
    def is_successful(self) -> bool:
        """Check if delivery was successful."""
        return self.final_status == WebhookStatus.DELIVERED
    
    def get_last_attempt(self) -> Optional[WebhookAttempt]:
        """Get the last delivery attempt."""
        return self.attempts[-1] if self.attempts else None


class WebhookFormatter:
    """Formats alerts for webhook delivery."""
    
    @staticmethod
    def format_alert(alert: AlertPayload, event_type: WebhookEventType = WebhookEventType.PRODUCT_FLAGGED) -> Dict[str, Any]:
        """Format alert as webhook payload."""
        
        return {
            "event_type": event_type.value,
            "event_id": str(uuid4()),
            "timestamp": alert.timestamp.isoformat(),
            "webhook_version": "1.0",
            "data": {
                "alert": {
                    "id": alert.alert_id,
                    "severity": alert.severity.value,
                    "created_at": alert.timestamp.isoformat()
                },
                "product": {
                    "id": alert.product.get("id"),
                    "description": alert.product.get("description"),
                    "category": alert.product.get("category"),
                    "brand": alert.product.get("brand"),
                    "price": alert.product.get("price"),
                    "supplier_id": alert.product.get("supplier_id"),
                    "image_urls": alert.product.get("image_urls", [])
                },
                "analysis": {
                    "authenticity_score": alert.analysis.get("authenticity_score"),
                    "confidence": alert.analysis.get("confidence"),
                    "reasoning": alert.analysis.get("reasoning"),
                    "red_flags": alert.analysis.get("red_flags", []),
                    "positive_indicators": alert.analysis.get("positive_indicators", []),
                    "rule_matches": alert.analysis.get("rule_matches", [])
                },
                "actions": {
                    "recommended_action": alert.actions.get("recommended_action"),
                    "admin_dashboard_url": alert.actions.get("admin_dashboard_url"),
                    "enforcement_options": alert.actions.get("enforcement_options", [])
                }
            }
        }


class WebhookSignatureGenerator:
    """Generates and verifies webhook signatures."""
    
    @staticmethod
    def generate_signature(payload: str, secret: str, algorithm: str = "sha256") -> str:
        """
        Generate HMAC signature for webhook payload.
        
        Args:
            payload: JSON payload as string
            secret: Webhook secret key
            algorithm: Hash algorithm (sha256, sha1, etc.)
            
        Returns:
            Hex-encoded signature
        """
        if algorithm == "sha256":
            hash_func = hashlib.sha256
        elif algorithm == "sha1":
            hash_func = hashlib.sha1
        else:
            raise ValueError(f"Unsupported algorithm: {algorithm}")
        
        return hmac.new(
            secret.encode('utf-8'),
            payload.encode('utf-8'),
            hash_func
        ).hexdigest()
    
    @staticmethod
    def verify_signature(payload: str, signature: str, secret: str, algorithm: str = "sha256") -> bool:
        """
        Verify webhook signature.
        
        Args:
            payload: JSON payload as string
            signature: Provided signature to verify
            secret: Webhook secret key
            algorithm: Hash algorithm used
            
        Returns:
            True if signature is valid
        """
        try:
            expected_signature = WebhookSignatureGenerator.generate_signature(payload, secret, algorithm)
            return hmac.compare_digest(signature, expected_signature)
        except Exception as e:
            logger.error("Signature verification failed", error=str(e))
            return False


class WebhookService:
    """Service for delivering webhooks to external systems."""
    
    def __init__(self):
        self.settings = get_settings()
        self.formatter = WebhookFormatter()
        self.signature_generator = WebhookSignatureGenerator()
        
        # Retry configuration
        self.max_attempts = 3
        self.backoff_delays = [1, 2, 4]  # seconds
        self.timeout = 10  # seconds
        self.verify_ssl = True
        
        # HTTP session for webhook delivery
        self.session: Optional[aiohttp.ClientSession] = None
    
    async def __aenter__(self):
        """Async context manager entry."""
        connector = aiohttp.TCPConnector(
            verify_ssl=self.verify_ssl,
            limit=100,  # Connection pool limit
            limit_per_host=10
        )
        
        timeout = aiohttp.ClientTimeout(
            total=self.timeout,
            connect=5,
            sock_read=10
        )
        
        self.session = aiohttp.ClientSession(
            connector=connector,
            timeout=timeout,
            headers={
                "User-Agent": "CounterfeitDetection-Webhook/1.0",
                "Content-Type": "application/json"
            }
        )
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        if self.session:
            await self.session.close()
    
    async def send_webhook_notification(
        self, 
        alert: AlertPayload, 
        config: Dict[str, Any]
    ) -> bool:
        """
        Send webhook notification with retry logic.
        
        Args:
            alert: Alert payload to send
            config: Webhook endpoint configuration
            
        Returns:
            True if successful, False otherwise
        """
        webhook_url = config.get("url")
        if not webhook_url:
            logger.error("Webhook URL not configured")
            return False
        
        try:
            # Format payload
            event_type = WebhookEventType(config.get("event_type", "product_flagged"))
            webhook_payload = self.formatter.format_alert(alert, event_type)
            
            # Deliver webhook
            result = await self.deliver_webhook(
                webhook_url=webhook_url,
                payload=webhook_payload,
                secret=config.get("secret"),
                custom_headers=config.get("headers", {}),
                event_type=event_type
            )
            
            if result.is_successful():
                logger.info(
                    "Webhook delivered successfully",
                    alert_id=alert.alert_id,
                    webhook_url=webhook_url,
                    attempts=len(result.attempts)
                )
                return True
            else:
                logger.error(
                    "Webhook delivery failed",
                    alert_id=alert.alert_id,
                    webhook_url=webhook_url,
                    attempts=len(result.attempts),
                    final_status=result.final_status.value
                )
                return False
        
        except Exception as e:
            logger.error("Webhook notification error", error=str(e), alert_id=alert.alert_id)
            return False
    
    async def deliver_webhook(
        self,
        webhook_url: str,
        payload: Dict[str, Any],
        secret: Optional[str] = None,
        custom_headers: Optional[Dict[str, str]] = None,
        event_type: WebhookEventType = WebhookEventType.PRODUCT_FLAGGED
    ) -> WebhookDeliveryResult:
        """
        Deliver webhook with retry logic and exponential backoff.
        
        Args:
            webhook_url: Target webhook URL
            payload: JSON payload to send
            secret: Optional secret for signature generation
            custom_headers: Optional custom headers
            event_type: Type of webhook event
            
        Returns:
            WebhookDeliveryResult with delivery details
        """
        webhook_id = str(uuid4())
        result = WebhookDeliveryResult(webhook_id, webhook_url)
        start_time = datetime.utcnow()
        
        try:
            # Prepare payload
            payload_str = json.dumps(payload, separators=(',', ':'), sort_keys=True)
            
            # Prepare headers
            headers = {
                "X-Webhook-ID": webhook_id,
                "X-Webhook-Event": event_type.value,
                "X-Webhook-Timestamp": str(int(time.time())),
                "X-Webhook-Version": "1.0"
            }
            
            # Add signature if secret provided
            if secret:
                signature = self.signature_generator.generate_signature(payload_str, secret)
                headers["X-Webhook-Signature"] = f"sha256={signature}"
            
            # Add custom headers
            if custom_headers:
                headers.update(custom_headers)
            
            # Attempt delivery with retries
            for attempt_num in range(1, self.max_attempts + 1):
                attempt = WebhookAttempt(attempt_num, webhook_url, payload, headers.copy())
                
                try:
                    await self._execute_webhook_attempt(attempt, payload_str)
                    result.add_attempt(attempt)
                    
                    # Check if successful
                    if attempt.status_code and 200 <= attempt.status_code < 300:
                        break  # Success, exit retry loop
                    
                    # If this wasn't the last attempt, wait before retrying
                    if attempt_num < self.max_attempts:
                        delay = self.backoff_delays[min(attempt_num - 1, len(self.backoff_delays) - 1)]
                        logger.info(
                            "Webhook attempt failed, retrying",
                            webhook_id=webhook_id,
                            attempt=attempt_num,
                            status_code=attempt.status_code,
                            retry_in=delay
                        )
                        await asyncio.sleep(delay)
                
                except Exception as e:
                    attempt.error_message = str(e)
                    result.add_attempt(attempt)
                    
                    logger.error(
                        "Webhook attempt error",
                        webhook_id=webhook_id,
                        attempt=attempt_num,
                        error=str(e)
                    )
                    
                    # If this wasn't the last attempt, wait before retrying
                    if attempt_num < self.max_attempts:
                        delay = self.backoff_delays[min(attempt_num - 1, len(self.backoff_delays) - 1)]
                        await asyncio.sleep(delay)
            
            # Calculate total duration
            result.completed_at = datetime.utcnow()
            result.total_duration_ms = (result.completed_at - start_time).total_seconds() * 1000
            
            logger.info(
                "Webhook delivery completed",
                webhook_id=webhook_id,
                url=webhook_url,
                final_status=result.final_status.value,
                total_attempts=len(result.attempts),
                total_duration_ms=result.total_duration_ms
            )
            
            return result
        
        except Exception as e:
            logger.error("Webhook delivery failed", error=str(e), webhook_id=webhook_id)
            result.final_status = WebhookStatus.FAILED
            result.completed_at = datetime.utcnow()
            result.total_duration_ms = (result.completed_at - start_time).total_seconds() * 1000
            return result
    
    async def _execute_webhook_attempt(self, attempt: WebhookAttempt, payload_str: str) -> None:
        """Execute a single webhook delivery attempt."""
        attempt.started_at = datetime.utcnow()
        
        try:
            if not self.session:
                # Create temporary session if not in context manager
                async with aiohttp.ClientSession() as session:
                    async with session.post(
                        attempt.url,
                        data=payload_str,
                        headers=attempt.headers
                    ) as response:
                        attempt.status_code = response.status
                        attempt.response_body = await response.text()
            else:
                async with self.session.post(
                    attempt.url,
                    data=payload_str,
                    headers=attempt.headers
                ) as response:
                    attempt.status_code = response.status
                    attempt.response_body = await response.text()
            
            attempt.completed_at = datetime.utcnow()
            attempt.duration_ms = (attempt.completed_at - attempt.started_at).total_seconds() * 1000
            
        except asyncio.TimeoutError:
            attempt.completed_at = datetime.utcnow()
            attempt.duration_ms = (attempt.completed_at - attempt.started_at).total_seconds() * 1000
            attempt.error_message = "Request timeout"
            raise
        
        except aiohttp.ClientError as e:
            attempt.completed_at = datetime.utcnow()
            attempt.duration_ms = (attempt.completed_at - attempt.started_at).total_seconds() * 1000
            attempt.error_message = f"Client error: {str(e)}"
            raise
        
        except Exception as e:
            attempt.completed_at = datetime.utcnow()
            attempt.duration_ms = (attempt.completed_at - attempt.started_at).total_seconds() * 1000
            attempt.error_message = f"Unexpected error: {str(e)}"
            raise
    
    async def test_webhook_endpoint(
        self,
        webhook_url: str,
        secret: Optional[str] = None,
        custom_headers: Optional[Dict[str, str]] = None
    ) -> WebhookDeliveryResult:
        """
        Test webhook endpoint with a sample payload.
        
        Args:
            webhook_url: Webhook URL to test
            secret: Optional secret for signature
            custom_headers: Optional custom headers
            
        Returns:
            WebhookDeliveryResult with test results
        """
        # Create test payload
        test_payload = {
            "event_type": "test",
            "event_id": str(uuid4()),
            "timestamp": datetime.utcnow().isoformat(),
            "webhook_version": "1.0",
            "data": {
                "test": True,
                "message": "This is a test webhook to verify connectivity"
            }
        }
        
        return await self.deliver_webhook(
            webhook_url=webhook_url,
            payload=test_payload,
            secret=secret,
            custom_headers=custom_headers,
            event_type=WebhookEventType.TEST
        )
    
    async def batch_deliver_webhooks(
        self,
        deliveries: List[Dict[str, Any]]
    ) -> List[WebhookDeliveryResult]:
        """
        Deliver multiple webhooks concurrently.
        
        Args:
            deliveries: List of webhook delivery configurations
            
        Returns:
            List of WebhookDeliveryResult objects
        """
        # Create tasks for concurrent delivery
        tasks = []
        for delivery in deliveries:
            task = self.deliver_webhook(
                webhook_url=delivery["url"],
                payload=delivery["payload"],
                secret=delivery.get("secret"),
                custom_headers=delivery.get("headers"),
                event_type=WebhookEventType(delivery.get("event_type", "product_flagged"))
            )
            tasks.append(task)
        
        # Execute all deliveries concurrently
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Process results
        delivery_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                # Create failed result for exceptions
                webhook_id = str(uuid4())
                failed_result = WebhookDeliveryResult(webhook_id, deliveries[i]["url"])
                failed_result.final_status = WebhookStatus.FAILED
                failed_result.completed_at = datetime.utcnow()
                delivery_results.append(failed_result)
                
                logger.error(
                    "Batch webhook delivery failed",
                    webhook_url=deliveries[i]["url"],
                    error=str(result)
                )
            else:
                delivery_results.append(result)
        
        return delivery_results
    
    def get_webhook_statistics(self, results: List[WebhookDeliveryResult]) -> Dict[str, Any]:
        """
        Generate statistics from webhook delivery results.
        
        Args:
            results: List of delivery results
            
        Returns:
            Dictionary with delivery statistics
        """
        if not results:
            return {
                "total_deliveries": 0,
                "successful_deliveries": 0,
                "failed_deliveries": 0,
                "success_rate": 0.0,
                "average_duration_ms": 0.0,
                "total_attempts": 0
            }
        
        successful = sum(1 for r in results if r.is_successful())
        failed = len(results) - successful
        total_attempts = sum(len(r.attempts) for r in results)
        avg_duration = sum(r.total_duration_ms for r in results) / len(results)
        
        return {
            "total_deliveries": len(results),
            "successful_deliveries": successful,
            "failed_deliveries": failed,
            "success_rate": (successful / len(results)) * 100,
            "average_duration_ms": avg_duration,
            "total_attempts": total_attempts,
            "average_attempts_per_delivery": total_attempts / len(results) if results else 0
        }