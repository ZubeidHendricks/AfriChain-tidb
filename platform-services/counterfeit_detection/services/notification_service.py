"""
Notification Service for multi-channel message delivery.

This service handles the actual sending of notifications through Slack, email,
and other channels with proper formatting and error handling.
"""

import asyncio
import json
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formatdate
from typing import Any, Dict, Optional

import aiohttp
import structlog
from jinja2 import Environment, FileSystemLoader, Template

from ..core.config import get_settings
from ..agents.notification_agent import AlertPayload
from ..models.enums import AlertSeverity

logger = structlog.get_logger(__name__)


class SlackFormatter:
    """Formats alerts for Slack using Block Kit."""
    
    @staticmethod
    def format_alert(alert: AlertPayload, config: Dict[str, Any]) -> Dict[str, Any]:
        """Format alert as Slack Block Kit message."""
        
        # Determine emoji based on severity
        severity_emojis = {
            AlertSeverity.CRITICAL: "🚨",
            AlertSeverity.HIGH: "⚠️",
            AlertSeverity.MEDIUM: "⚡",
            AlertSeverity.LOW: "ℹ️"
        }
        
        emoji = severity_emojis.get(alert.severity, "⚠️")
        severity_text = alert.severity.value.upper()
        
        # Extract key information
        product = alert.product
        analysis = alert.analysis
        actions = alert.actions
        
        score = analysis.get("authenticity_score", 0)
        confidence = analysis.get("confidence", 0)
        
        # Build Slack message blocks
        blocks = [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": f"{emoji} {severity_text} Counterfeit Alert"
                }
            },
            {
                "type": "section",
                "fields": [
                    {
                        "type": "mrkdwn",
                        "text": f"*Product:* {product.get('description', 'N/A')[:100]}..."
                    },
                    {
                        "type": "mrkdwn",
                        "text": f"*Brand:* {product.get('brand', 'Unknown')}"
                    },
                    {
                        "type": "mrkdwn",
                        "text": f"*Authenticity Score:* {score}/100"
                    },
                    {
                        "type": "mrkdwn",
                        "text": f"*Confidence:* {confidence*100:.1f}%"
                    },
                    {
                        "type": "mrkdwn",
                        "text": f"*Category:* {product.get('category', 'Unknown')}"
                    },
                    {
                        "type": "mrkdwn",
                        "text": f"*Price:* ${product.get('price', 0):.2f}"
                    }
                ]
            }
        ]
        
        # Add reasoning section
        reasoning = analysis.get("reasoning", "")
        if reasoning:
            blocks.append({
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*Analysis:*\n{reasoning[:200]}..."
                }
            })
        
        # Add red flags if present
        red_flags = analysis.get("red_flags", [])
        if red_flags:
            flags_text = "\n".join([f"• {flag}" for flag in red_flags[:5]])
            blocks.append({
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*Red Flags:*\n{flags_text}"
                }
            })
        
        # Add action buttons
        dashboard_url = actions.get("admin_dashboard_url")
        if dashboard_url:
            blocks.append({
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {
                            "type": "plain_text",
                            "text": "View Product"
                        },
                        "url": dashboard_url,
                        "style": "primary"
                    },
                    {
                        "type": "button",
                        "text": {
                            "type": "plain_text",
                            "text": "Take Action"
                        },
                        "url": f"{dashboard_url}/actions",
                        "style": "danger"
                    }
                ]
            })
        
        # Add footer with timestamp
        blocks.append({
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": f"Alert ID: {alert.alert_id} | {alert.timestamp.strftime('%Y-%m-%d %H:%M:%S UTC')}"
                }
            ]
        })
        
        return {
            "channel": config.get("channel", "#alerts"),
            "username": config.get("username", "Counterfeit Detection Bot"),
            "icon_emoji": config.get("icon_emoji", ":warning:"),
            "blocks": blocks
        }


class EmailFormatter:
    """Formats alerts for email delivery."""
    
    def __init__(self):
        self.templates_loaded = False
        self.html_template: Optional[Template] = None
        self.text_template: Optional[Template] = None
        self._load_templates()
    
    def _load_templates(self):
        """Load email templates."""
        try:
            # Initialize Jinja2 environment
            template_dir = "src/counterfeit_detection/templates/notifications"
            env = Environment(loader=FileSystemLoader(template_dir))
            
            # Load templates
            self.html_template = env.get_template("alert_email.html")
            self.text_template = env.get_template("alert_email.txt")
            self.templates_loaded = True
            
        except Exception as e:
            logger.warning("Failed to load email templates, using fallback", error=str(e))
            self.templates_loaded = False
    
    def format_alert(self, alert: AlertPayload, config: Dict[str, Any]) -> Dict[str, Any]:
        """Format alert as email message."""
        
        # Generate subject line
        severity_prefixes = {
            AlertSeverity.CRITICAL: "🚨 CRITICAL",
            AlertSeverity.HIGH: "⚠️ HIGH PRIORITY",
            AlertSeverity.MEDIUM: "⚡ MEDIUM",
            AlertSeverity.LOW: "ℹ️ LOW PRIORITY"
        }
        
        severity_prefix = severity_prefixes.get(alert.severity, "⚠️")
        product_brand = alert.product.get("brand", "Unknown Brand")
        subject = f"{severity_prefix} Alert: Potential Counterfeit - {product_brand}"
        
        # Prepare template context
        context = {
            "alert": alert,
            "product": alert.product,
            "analysis": alert.analysis,
            "actions": alert.actions,
            "severity_color": self._get_severity_color(alert.severity),
            "severity_text": alert.severity.value.upper(),
            "formatted_timestamp": alert.timestamp.strftime('%B %d, %Y at %I:%M %p UTC'),
            "recipient_name": config.get("recipient_name", "Administrator")
        }
        
        # Generate email content
        if self.templates_loaded:
            try:
                html_content = self.html_template.render(**context)
                text_content = self.text_template.render(**context)
            except Exception as e:
                logger.error("Template rendering failed, using fallback", error=str(e))
                html_content, text_content = self._generate_fallback_content(alert)
        else:
            html_content, text_content = self._generate_fallback_content(alert)
        
        return {
            "to_email": config.get("email"),
            "subject": subject,
            "html_content": html_content,
            "text_content": text_content,
            "from_name": config.get("from_name", "Counterfeit Detection System"),
            "from_email": config.get("from_email", "alerts@example.com")
        }
    
    def _get_severity_color(self, severity: AlertSeverity) -> str:
        """Get color code for severity level."""
        colors = {
            AlertSeverity.CRITICAL: "#dc3545",  # Red
            AlertSeverity.HIGH: "#fd7e14",      # Orange
            AlertSeverity.MEDIUM: "#ffc107",    # Yellow
            AlertSeverity.LOW: "#17a2b8"        # Blue
        }
        return colors.get(severity, "#6c757d")
    
    def _generate_fallback_content(self, alert: AlertPayload) -> tuple[str, str]:
        """Generate fallback email content when templates are not available."""
        
        # Simple HTML content
        html_content = f"""
        <html>
        <body>
            <h2>🚨 Counterfeit Product Alert</h2>
            <p><strong>Severity:</strong> {alert.severity.value.upper()}</p>
            <p><strong>Product:</strong> {alert.product.get('description', 'N/A')}</p>
            <p><strong>Brand:</strong> {alert.product.get('brand', 'Unknown')}</p>
            <p><strong>Price:</strong> ${alert.product.get('price', 0):.2f}</p>
            <p><strong>Authenticity Score:</strong> {alert.analysis.get('authenticity_score', 0)}/100</p>
            <p><strong>Confidence:</strong> {alert.analysis.get('confidence', 0)*100:.1f}%</p>
            <p><strong>Analysis:</strong> {alert.analysis.get('reasoning', 'N/A')}</p>
            <p><strong>Red Flags:</strong></p>
            <ul>
                {"".join(f"<li>{flag}</li>" for flag in alert.analysis.get('red_flags', []))}
            </ul>
            <p><strong>Alert Time:</strong> {alert.timestamp.strftime('%Y-%m-%d %H:%M:%S UTC')}</p>
            <p><strong>Alert ID:</strong> {alert.alert_id}</p>
        </body>
        </html>
        """
        
        # Simple text content
        text_content = f"""
        COUNTERFEIT PRODUCT ALERT
        
        Severity: {alert.severity.value.upper()}
        Product: {alert.product.get('description', 'N/A')}
        Brand: {alert.product.get('brand', 'Unknown')}
        Price: ${alert.product.get('price', 0):.2f}
        Authenticity Score: {alert.analysis.get('authenticity_score', 0)}/100
        Confidence: {alert.analysis.get('confidence', 0)*100:.1f}%
        
        Analysis: {alert.analysis.get('reasoning', 'N/A')}
        
        Red Flags:
        {chr(10).join(f"- {flag}" for flag in alert.analysis.get('red_flags', []))}
        
        Alert Time: {alert.timestamp.strftime('%Y-%m-%d %H:%M:%S UTC')}
        Alert ID: {alert.alert_id}
        """
        
        return html_content, text_content


class NotificationService:
    """Service for sending notifications through various channels."""
    
    def __init__(self):
        self.settings = get_settings()
        self.slack_formatter = SlackFormatter()
        self.email_formatter = EmailFormatter()
        
        # HTTP session for API calls
        self.session: Optional[aiohttp.ClientSession] = None
    
    async def __aenter__(self):
        """Async context manager entry."""
        self.session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=30)
        )
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        if self.session:
            await self.session.close()
    
    async def send_slack_notification(
        self, 
        alert: AlertPayload, 
        config: Dict[str, Any]
    ) -> bool:
        """
        Send notification to Slack using Bot API.
        
        Args:
            alert: Alert payload to send
            config: Slack-specific configuration
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # Format message for Slack
            slack_message = self.slack_formatter.format_alert(alert, config)
            
            # Get bot token from config or settings
            bot_token = config.get("bot_token") or getattr(self.settings, "slack_bot_token", None)
            
            if not bot_token:
                logger.error("Slack bot token not configured")
                return False
            
            # Prepare API request
            url = "https://slack.com/api/chat.postMessage"
            headers = {
                "Authorization": f"Bearer {bot_token}",
                "Content-Type": "application/json"
            }
            
            # Send via Slack API
            if not self.session:
                async with aiohttp.ClientSession() as session:
                    async with session.post(url, headers=headers, json=slack_message) as response:
                        result = await response.json()
            else:
                async with self.session.post(url, headers=headers, json=slack_message) as response:
                    result = await response.json()
            
            if result.get("ok"):
                logger.info("Slack notification sent successfully", alert_id=alert.alert_id)
                return True
            else:
                error = result.get("error", "Unknown error")
                logger.error("Slack notification failed", error=error, alert_id=alert.alert_id)
                return False
        
        except Exception as e:
            logger.error("Slack notification error", error=str(e), alert_id=alert.alert_id)
            return False
    
    async def send_email_notification(
        self, 
        alert: AlertPayload, 
        config: Dict[str, Any]
    ) -> bool:
        """
        Send notification via email using SMTP.
        
        Args:
            alert: Alert payload to send
            config: Email-specific configuration
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # Format message for email
            email_data = self.email_formatter.format_alert(alert, config)
            
            # Get SMTP configuration
            smtp_host = getattr(self.settings, "smtp_host", "localhost")
            smtp_port = getattr(self.settings, "smtp_port", 587)
            smtp_username = getattr(self.settings, "smtp_username", None)
            smtp_password = getattr(self.settings, "smtp_password", None)
            
            # Create message
            msg = MIMEMultipart("alternative")
            msg["Subject"] = email_data["subject"]
            msg["From"] = f"{email_data['from_name']} <{email_data['from_email']}>"
            msg["To"] = email_data["to_email"]
            msg["Date"] = formatdate(localtime=True)
            
            # Add text and HTML parts
            text_part = MIMEText(email_data["text_content"], "plain", "utf-8")
            html_part = MIMEText(email_data["html_content"], "html", "utf-8")
            
            msg.attach(text_part)
            msg.attach(html_part)
            
            # Send email
            await self._send_smtp_email(
                smtp_host, smtp_port, smtp_username, smtp_password,
                email_data["from_email"], email_data["to_email"], msg.as_string()
            )
            
            logger.info("Email notification sent successfully", alert_id=alert.alert_id, to=email_data["to_email"])
            return True
        
        except Exception as e:
            logger.error("Email notification error", error=str(e), alert_id=alert.alert_id)
            return False
    
    async def _send_smtp_email(
        self,
        smtp_host: str,
        smtp_port: int,
        username: Optional[str],
        password: Optional[str],
        from_email: str,
        to_email: str,
        message: str
    ) -> None:
        """Send email via SMTP (runs in thread pool to avoid blocking)."""
        
        def _send_email():
            """Synchronous email sending function."""
            with smtplib.SMTP(smtp_host, smtp_port) as server:
                server.starttls()
                if username and password:
                    server.login(username, password)
                server.sendmail(from_email, [to_email], message)
        
        # Run in thread pool to avoid blocking
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _send_email)
    
    async def test_slack_connection(self, bot_token: str) -> bool:
        """Test Slack bot token and connection."""
        try:
            url = "https://slack.com/api/auth.test"
            headers = {
                "Authorization": f"Bearer {bot_token}",
                "Content-Type": "application/json"
            }
            
            if not self.session:
                async with aiohttp.ClientSession() as session:
                    async with session.post(url, headers=headers) as response:
                        result = await response.json()
            else:
                async with self.session.post(url, headers=headers) as response:
                    result = await response.json()
            
            return result.get("ok", False)
        
        except Exception as e:
            logger.error("Slack connection test failed", error=str(e))
            return False
    
    async def test_email_connection(self, smtp_config: Dict[str, Any]) -> bool:
        """Test SMTP email connection."""
        try:
            smtp_host = smtp_config.get("host", "localhost")
            smtp_port = smtp_config.get("port", 587)
            username = smtp_config.get("username")
            password = smtp_config.get("password")
            
            def _test_connection():
                """Synchronous connection test."""
                with smtplib.SMTP(smtp_host, smtp_port) as server:
                    server.starttls()
                    if username and password:
                        server.login(username, password)
                    return True
            
            # Run in thread pool
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, _test_connection)
            return True
        
        except Exception as e:
            logger.error("Email connection test failed", error=str(e))
            return False