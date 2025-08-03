"""
Platform connectors package for external platform integrations.

This package provides connectors for various e-commerce platforms
to execute enforcement actions like takedown, pause, and visibility changes.
"""

from .base import BasePlatformConnector, PlatformResponse
from .factory import PlatformConnectorFactory
from .default_connector import DefaultPlatformConnector

__all__ = [
    "BasePlatformConnector",
    "PlatformResponse", 
    "PlatformConnectorFactory",
    "DefaultPlatformConnector"
]