"""
Base platform connector abstract class.

This module defines the interface that all platform connectors must implement
for enforcement actions like product takedown, pausing, and supplier notifications.
"""

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any, Dict, Optional
from pydantic import BaseModel, Field

import structlog

logger = structlog.get_logger(__name__)


class PlatformResponse(BaseModel):
    """Standard response from platform operations."""
    
    success: bool
    message: str
    platform_id: Optional[str] = None
    platform_data: Optional[Dict[str, Any]] = None
    error_code: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    operation_id: Optional[str] = None


class BasePlatformConnector(ABC):
    """Abstract base class for platform connectors."""
    
    def __init__(self, platform_name: str, config: Optional[Dict[str, Any]] = None):
        """
        Initialize platform connector.
        
        Args:
            platform_name: Name of the platform (e.g., "shopify", "woocommerce")
            config: Platform-specific configuration
        """
        self.platform_name = platform_name
        self.config = config or {}
        self.logger = structlog.get_logger(__name__, platform=platform_name)
    
    @abstractmethod
    async def pause_product(self, product_id: str, reason: Optional[str] = None) -> PlatformResponse:
        """
        Pause a product on the platform.
        
        Args:
            product_id: Product identifier
            reason: Optional reason for pausing
            
        Returns:
            PlatformResponse with operation result
        """
        pass
    
    @abstractmethod
    async def remove_product(self, product_id: str, reason: Optional[str] = None) -> PlatformResponse:
        """
        Remove/takedown a product from the platform.
        
        Args:
            product_id: Product identifier
            reason: Optional reason for removal
            
        Returns:
            PlatformResponse with operation result
        """
        pass
    
    @abstractmethod
    async def reduce_visibility(self, product_id: str, visibility_factor: float, reason: Optional[str] = None) -> PlatformResponse:
        """
        Reduce product visibility on the platform.
        
        Args:
            product_id: Product identifier
            visibility_factor: Visibility factor (0.0 to 1.0)
            reason: Optional reason for visibility reduction
            
        Returns:
            PlatformResponse with operation result
        """
        pass
    
    @abstractmethod
    async def restore_product(self, product_id: str, reason: Optional[str] = None) -> PlatformResponse:
        """
        Restore a previously removed product.
        
        Args:
            product_id: Product identifier
            reason: Optional reason for restoration
            
        Returns:
            PlatformResponse with operation result
        """
        pass
    
    @abstractmethod
    async def unpause_product(self, product_id: str, reason: Optional[str] = None) -> PlatformResponse:
        """
        Unpause a previously paused product.
        
        Args:
            product_id: Product identifier
            reason: Optional reason for unpausing
            
        Returns:
            PlatformResponse with operation result
        """
        pass
    
    @abstractmethod
    async def restore_visibility(self, product_id: str, reason: Optional[str] = None) -> PlatformResponse:
        """
        Restore full visibility for a product.
        
        Args:
            product_id: Product identifier
            reason: Optional reason for visibility restoration
            
        Returns:
            PlatformResponse with operation result
        """
        pass
    
    @abstractmethod
    async def notify_supplier(self, supplier_id: str, message: str, notification_type: str = "enforcement") -> PlatformResponse:
        """
        Send notification to supplier about enforcement action.
        
        Args:
            supplier_id: Supplier identifier
            message: Notification message
            notification_type: Type of notification
            
        Returns:
            PlatformResponse with operation result
        """
        pass
    
    async def get_product_status(self, product_id: str) -> PlatformResponse:
        """
        Get current status of a product on the platform.
        
        Args:
            product_id: Product identifier
            
        Returns:
            PlatformResponse with product status information
        """
        # Default implementation - can be overridden by specific connectors
        return PlatformResponse(
            success=False,
            message="get_product_status not implemented for this platform",
            platform_id=product_id
        )
    
    async def validate_connection(self) -> PlatformResponse:
        """
        Validate connection to the platform.
        
        Returns:
            PlatformResponse indicating connection status
        """
        # Default implementation - can be overridden by specific connectors
        return PlatformResponse(
            success=True,
            message=f"Connection validation not implemented for {self.platform_name}"
        )
    
    def _create_success_response(
        self,
        message: str,
        platform_id: Optional[str] = None,
        platform_data: Optional[Dict[str, Any]] = None,
        operation_id: Optional[str] = None
    ) -> PlatformResponse:
        """Helper method to create success response."""
        return PlatformResponse(
            success=True,
            message=message,
            platform_id=platform_id,
            platform_data=platform_data,
            operation_id=operation_id
        )
    
    def _create_error_response(
        self,
        message: str,
        error_code: Optional[str] = None,
        platform_id: Optional[str] = None,
        platform_data: Optional[Dict[str, Any]] = None
    ) -> PlatformResponse:
        """Helper method to create error response."""
        return PlatformResponse(
            success=False,
            message=message,
            platform_id=platform_id,
            platform_data=platform_data,
            error_code=error_code
        )
    
    async def _log_operation(
        self,
        operation: str,
        product_id: str,
        result: PlatformResponse,
        reason: Optional[str] = None
    ) -> None:
        """Log platform operation for audit trail."""
        try:
            self.logger.info(
                "Platform operation executed",
                operation=operation,
                product_id=product_id,
                success=result.success,
                message=result.message,
                reason=reason,
                platform=self.platform_name,
                operation_id=result.operation_id
            )
        except Exception as e:
            self.logger.error("Failed to log platform operation", error=str(e))