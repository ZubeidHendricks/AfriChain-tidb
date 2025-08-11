"""
Platform connector factory for creating platform-specific connectors.

This factory manages the creation and configuration of different platform
connectors based on the platform type and configuration.
"""

from typing import Any, Dict, Optional

import structlog

from .base import BasePlatformConnector
from .default_connector import DefaultPlatformConnector

logger = structlog.get_logger(__name__)


class PlatformConnectorFactory:
    """Factory for creating platform connectors."""
    
    def __init__(self):
        """Initialize platform connector factory."""
        self._connectors: Dict[str, BasePlatformConnector] = {}
        self._connector_configs: Dict[str, Dict[str, Any]] = {}
        
        # Register default connector configurations
        self._register_default_configs()
    
    def _register_default_configs(self):
        """Register default connector configurations."""
        self._connector_configs = {
            "default": {
                "class": DefaultPlatformConnector,
                "config": {
                    "simulate_delays": True,
                    "operation_delay": 0.1
                }
            },
            "shopify": {
                "class": DefaultPlatformConnector,  # Would be ShopifyConnector when implemented
                "config": {
                    "api_version": "2023-01",
                    "simulate_delays": False
                }
            },
            "woocommerce": {
                "class": DefaultPlatformConnector,  # Would be WooCommerceConnector when implemented
                "config": {
                    "api_version": "v3",
                    "simulate_delays": False
                }
            },
            "magento": {
                "class": DefaultPlatformConnector,  # Would be MagentoConnector when implemented
                "config": {
                    "api_version": "v1",
                    "simulate_delays": False
                }
            }
        }
    
    async def get_connector(self, platform_name: str, config: Optional[Dict[str, Any]] = None) -> BasePlatformConnector:
        """
        Get a platform connector instance.
        
        Args:
            platform_name: Name of the platform (e.g., "shopify", "woocommerce", "default")
            config: Optional platform-specific configuration to override defaults
            
        Returns:
            BasePlatformConnector instance for the specified platform
        """
        try:
            # Check if connector is already instantiated
            connector_key = f"{platform_name}_{hash(str(config))}"
            
            if connector_key in self._connectors:
                return self._connectors[connector_key]
            
            # Get platform configuration
            platform_config = self._connector_configs.get(platform_name)
            
            if not platform_config:
                logger.warning(
                    "Unknown platform, falling back to default connector",
                    platform=platform_name
                )
                platform_config = self._connector_configs["default"]
                platform_name = "default"
            
            # Merge provided config with default config
            merged_config = platform_config["config"].copy()
            if config:
                merged_config.update(config)
            
            # Create connector instance
            connector_class = platform_config["class"]
            connector = connector_class(merged_config)
            
            # Validate connection
            validation_result = await connector.validate_connection()
            if not validation_result.success:
                logger.warning(
                    "Platform connector validation failed",
                    platform=platform_name,
                    error=validation_result.message
                )
            
            # Cache the connector
            self._connectors[connector_key] = connector
            
            logger.info(
                "Platform connector created",
                platform=platform_name,
                connector_class=connector_class.__name__,
                validation_success=validation_result.success
            )
            
            return connector
        
        except Exception as e:
            logger.error(
                "Failed to create platform connector",
                platform=platform_name,
                error=str(e)
            )
            
            # Fall back to default connector
            if platform_name != "default":
                logger.info("Falling back to default connector")
                return await self.get_connector("default", config)
            
            raise
    
    def register_connector_config(
        self,
        platform_name: str,
        connector_class: type,
        config: Optional[Dict[str, Any]] = None
    ) -> None:
        """
        Register a new platform connector configuration.
        
        Args:
            platform_name: Name of the platform
            connector_class: Class that implements BasePlatformConnector
            config: Default configuration for the connector
        """
        try:
            if not issubclass(connector_class, BasePlatformConnector):
                raise ValueError(f"Connector class must inherit from BasePlatformConnector")
            
            self._connector_configs[platform_name] = {
                "class": connector_class,
                "config": config or {}
            }
            
            logger.info(
                "Platform connector registered",
                platform=platform_name,
                connector_class=connector_class.__name__
            )
        
        except Exception as e:
            logger.error(
                "Failed to register platform connector",
                platform=platform_name,
                error=str(e)
            )
            raise
    
    def get_registered_platforms(self) -> list:
        """
        Get list of registered platform names.
        
        Returns:
            List of registered platform names
        """
        return list(self._connector_configs.keys())
    
    def clear_connector_cache(self, platform_name: Optional[str] = None) -> None:
        """
        Clear connector cache.
        
        Args:
            platform_name: Optional platform name to clear specific connector.
                          If None, clears all cached connectors.
        """
        try:
            if platform_name:
                # Clear specific platform connectors
                keys_to_remove = [key for key in self._connectors.keys() if key.startswith(f"{platform_name}_")]
                for key in keys_to_remove:
                    del self._connectors[key]
                
                logger.info("Platform connector cache cleared", platform=platform_name)
            else:
                # Clear all connectors
                self._connectors.clear()
                logger.info("All platform connector caches cleared")
        
        except Exception as e:
            logger.error("Failed to clear connector cache", error=str(e))
    
    async def test_all_connectors(self) -> Dict[str, bool]:
        """
        Test connections for all registered platforms.
        
        Returns:
            Dictionary mapping platform names to connection test results
        """
        results = {}
        
        for platform_name in self._connector_configs.keys():
            try:
                connector = await self.get_connector(platform_name)
                validation_result = await connector.validate_connection()
                results[platform_name] = validation_result.success
            
            except Exception as e:
                logger.error(
                    "Failed to test platform connector",
                    platform=platform_name,
                    error=str(e)
                )
                results[platform_name] = False
        
        return results
    
    def get_connector_info(self, platform_name: str) -> Optional[Dict[str, Any]]:
        """
        Get information about a registered connector.
        
        Args:
            platform_name: Name of the platform
            
        Returns:
            Dictionary with connector information or None if not found
        """
        platform_config = self._connector_configs.get(platform_name)
        
        if not platform_config:
            return None
        
        return {
            "platform_name": platform_name,
            "connector_class": platform_config["class"].__name__,
            "config": platform_config["config"],
            "is_cached": any(key.startswith(f"{platform_name}_") for key in self._connectors.keys())
        }