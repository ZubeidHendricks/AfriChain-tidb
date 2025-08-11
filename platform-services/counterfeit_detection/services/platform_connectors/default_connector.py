"""
Default platform connector implementation.

This connector provides a generic implementation that can be used
as a fallback or for testing purposes.
"""

import asyncio
from typing import Any, Dict, Optional
from uuid import uuid4

from .base import BasePlatformConnector, PlatformResponse


class DefaultPlatformConnector(BasePlatformConnector):
    """Default platform connector for generic platform operations."""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """Initialize default platform connector."""
        super().__init__("default", config)
        
        # Simulate operation delays for testing
        self.simulate_delays = config.get("simulate_delays", True) if config else True
        self.operation_delay = config.get("operation_delay", 0.1) if config else 0.1
        
        # Track operation history for testing
        self.operation_history = []
    
    async def pause_product(self, product_id: str, reason: Optional[str] = None) -> PlatformResponse:
        """Pause a product (simulated)."""
        try:
            if self.simulate_delays:
                await asyncio.sleep(self.operation_delay)
            
            operation_id = str(uuid4())
            
            # Simulate success response
            response = self._create_success_response(
                message=f"Product {product_id} paused successfully",
                platform_id=product_id,
                platform_data={
                    "status": "paused",
                    "reason": reason,
                    "platform": self.platform_name
                },
                operation_id=operation_id
            )
            
            # Log operation
            self.operation_history.append({
                "operation": "pause_product",
                "product_id": product_id,
                "reason": reason,
                "success": True,
                "operation_id": operation_id
            })
            
            await self._log_operation("pause_product", product_id, response, reason)
            return response
        
        except Exception as e:
            error_response = self._create_error_response(
                message=f"Failed to pause product {product_id}: {str(e)}",
                error_code="PAUSE_FAILED",
                platform_id=product_id
            )
            
            await self._log_operation("pause_product", product_id, error_response, reason)
            return error_response
    
    async def remove_product(self, product_id: str, reason: Optional[str] = None) -> PlatformResponse:
        """Remove/takedown a product (simulated)."""
        try:
            if self.simulate_delays:
                await asyncio.sleep(self.operation_delay)
            
            operation_id = str(uuid4())
            
            # Simulate success response
            response = self._create_success_response(
                message=f"Product {product_id} removed successfully",
                platform_id=product_id,
                platform_data={
                    "status": "removed",
                    "reason": reason,
                    "platform": self.platform_name
                },
                operation_id=operation_id
            )
            
            # Log operation
            self.operation_history.append({
                "operation": "remove_product",
                "product_id": product_id,
                "reason": reason,
                "success": True,
                "operation_id": operation_id
            })
            
            await self._log_operation("remove_product", product_id, response, reason)
            return response
        
        except Exception as e:
            error_response = self._create_error_response(
                message=f"Failed to remove product {product_id}: {str(e)}",
                error_code="REMOVE_FAILED",
                platform_id=product_id
            )
            
            await self._log_operation("remove_product", product_id, error_response, reason)
            return error_response
    
    async def reduce_visibility(self, product_id: str, visibility_factor: float, reason: Optional[str] = None) -> PlatformResponse:
        """Reduce product visibility (simulated)."""
        try:
            if self.simulate_delays:
                await asyncio.sleep(self.operation_delay)
            
            # Validate visibility factor
            if not 0.0 <= visibility_factor <= 1.0:
                return self._create_error_response(
                    message=f"Invalid visibility factor: {visibility_factor}. Must be between 0.0 and 1.0",
                    error_code="INVALID_VISIBILITY_FACTOR",
                    platform_id=product_id
                )
            
            operation_id = str(uuid4())
            
            # Simulate success response
            response = self._create_success_response(
                message=f"Product {product_id} visibility reduced to {visibility_factor*100:.1f}%",
                platform_id=product_id,
                platform_data={
                    "status": "visibility_reduced",
                    "visibility_factor": visibility_factor,
                    "reason": reason,
                    "platform": self.platform_name
                },
                operation_id=operation_id
            )
            
            # Log operation
            self.operation_history.append({
                "operation": "reduce_visibility",
                "product_id": product_id,
                "visibility_factor": visibility_factor,
                "reason": reason,
                "success": True,
                "operation_id": operation_id
            })
            
            await self._log_operation("reduce_visibility", product_id, response, reason)
            return response
        
        except Exception as e:
            error_response = self._create_error_response(
                message=f"Failed to reduce visibility for product {product_id}: {str(e)}",
                error_code="VISIBILITY_REDUCTION_FAILED",
                platform_id=product_id
            )
            
            await self._log_operation("reduce_visibility", product_id, error_response, reason)
            return error_response
    
    async def restore_product(self, product_id: str, reason: Optional[str] = None) -> PlatformResponse:
        """Restore a previously removed product (simulated)."""
        try:
            if self.simulate_delays:
                await asyncio.sleep(self.operation_delay)
            
            operation_id = str(uuid4())
            
            # Simulate success response
            response = self._create_success_response(
                message=f"Product {product_id} restored successfully",
                platform_id=product_id,
                platform_data={
                    "status": "active",
                    "reason": reason,
                    "platform": self.platform_name
                },
                operation_id=operation_id
            )
            
            # Log operation
            self.operation_history.append({
                "operation": "restore_product",
                "product_id": product_id,
                "reason": reason,
                "success": True,
                "operation_id": operation_id
            })
            
            await self._log_operation("restore_product", product_id, response, reason)
            return response
        
        except Exception as e:
            error_response = self._create_error_response(
                message=f"Failed to restore product {product_id}: {str(e)}",
                error_code="RESTORE_FAILED",
                platform_id=product_id
            )
            
            await self._log_operation("restore_product", product_id, error_response, reason)
            return error_response
    
    async def unpause_product(self, product_id: str, reason: Optional[str] = None) -> PlatformResponse:
        """Unpause a previously paused product (simulated)."""
        try:
            if self.simulate_delays:
                await asyncio.sleep(self.operation_delay)
            
            operation_id = str(uuid4())
            
            # Simulate success response
            response = self._create_success_response(
                message=f"Product {product_id} unpaused successfully",
                platform_id=product_id,
                platform_data={
                    "status": "active",
                    "reason": reason,
                    "platform": self.platform_name
                },
                operation_id=operation_id
            )
            
            # Log operation
            self.operation_history.append({
                "operation": "unpause_product",
                "product_id": product_id,
                "reason": reason,
                "success": True,
                "operation_id": operation_id
            })
            
            await self._log_operation("unpause_product", product_id, response, reason)
            return response
        
        except Exception as e:
            error_response = self._create_error_response(
                message=f"Failed to unpause product {product_id}: {str(e)}",
                error_code="UNPAUSE_FAILED",
                platform_id=product_id
            )
            
            await self._log_operation("unpause_product", product_id, error_response, reason)
            return error_response
    
    async def restore_visibility(self, product_id: str, reason: Optional[str] = None) -> PlatformResponse:
        """Restore full visibility for a product (simulated)."""
        try:
            if self.simulate_delays:
                await asyncio.sleep(self.operation_delay)
            
            operation_id = str(uuid4())
            
            # Simulate success response
            response = self._create_success_response(
                message=f"Product {product_id} visibility restored to 100%",
                platform_id=product_id,
                platform_data={
                    "status": "active",
                    "visibility_factor": 1.0,
                    "reason": reason,
                    "platform": self.platform_name
                },
                operation_id=operation_id
            )
            
            # Log operation
            self.operation_history.append({
                "operation": "restore_visibility",
                "product_id": product_id,
                "reason": reason,
                "success": True,
                "operation_id": operation_id
            })
            
            await self._log_operation("restore_visibility", product_id, response, reason)
            return response
        
        except Exception as e:
            error_response = self._create_error_response(
                message=f"Failed to restore visibility for product {product_id}: {str(e)}",
                error_code="VISIBILITY_RESTORE_FAILED",
                platform_id=product_id
            )
            
            await self._log_operation("restore_visibility", product_id, error_response, reason)
            return error_response
    
    async def notify_supplier(self, supplier_id: str, message: str, notification_type: str = "enforcement") -> PlatformResponse:
        """Send notification to supplier (simulated)."""
        try:
            if self.simulate_delays:
                await asyncio.sleep(self.operation_delay)
            
            operation_id = str(uuid4())
            
            # Simulate success response
            response = self._create_success_response(
                message=f"Notification sent to supplier {supplier_id}",
                platform_id=supplier_id,
                platform_data={
                    "notification_type": notification_type,
                    "message": message,
                    "platform": self.platform_name
                },
                operation_id=operation_id
            )
            
            # Log operation
            self.operation_history.append({
                "operation": "notify_supplier",
                "supplier_id": supplier_id,
                "notification_type": notification_type,
                "message": message,
                "success": True,
                "operation_id": operation_id
            })
            
            self.logger.info(
                "Supplier notification sent",
                supplier_id=supplier_id,
                notification_type=notification_type,
                message=message,
                operation_id=operation_id
            )
            
            return response
        
        except Exception as e:
            error_response = self._create_error_response(
                message=f"Failed to notify supplier {supplier_id}: {str(e)}",
                error_code="NOTIFICATION_FAILED",
                platform_id=supplier_id
            )
            
            self.logger.error(
                "Supplier notification failed",
                supplier_id=supplier_id,
                error=str(e)
            )
            
            return error_response
    
    async def get_product_status(self, product_id: str) -> PlatformResponse:
        """Get current status of a product (simulated)."""
        try:
            if self.simulate_delays:
                await asyncio.sleep(self.operation_delay)
            
            # Simulate product status lookup
            status_options = ["active", "paused", "removed", "visibility_reduced"]
            
            # For simulation, derive status from product_id hash
            status_index = hash(product_id) % len(status_options)
            status = status_options[status_index]
            
            response = self._create_success_response(
                message=f"Product status retrieved for {product_id}",
                platform_id=product_id,
                platform_data={
                    "status": status,
                    "platform": self.platform_name,
                    "last_updated": "2025-01-01T00:00:00Z"
                }
            )
            
            return response
        
        except Exception as e:
            return self._create_error_response(
                message=f"Failed to get product status for {product_id}: {str(e)}",
                error_code="STATUS_LOOKUP_FAILED",
                platform_id=product_id
            )
    
    async def validate_connection(self) -> PlatformResponse:
        """Validate connection to the platform (simulated)."""
        try:
            if self.simulate_delays:
                await asyncio.sleep(self.operation_delay)
            
            return self._create_success_response(
                message=f"Connection to {self.platform_name} platform validated successfully",
                platform_data={
                    "platform": self.platform_name,
                    "api_version": "1.0",
                    "connection_status": "healthy"
                }
            )
        
        except Exception as e:
            return self._create_error_response(
                message=f"Connection validation failed: {str(e)}",
                error_code="CONNECTION_FAILED"
            )
    
    def get_operation_history(self) -> list:
        """Get history of operations for testing purposes."""
        return self.operation_history.copy()
    
    def clear_operation_history(self) -> None:
        """Clear operation history for testing purposes."""
        self.operation_history.clear()