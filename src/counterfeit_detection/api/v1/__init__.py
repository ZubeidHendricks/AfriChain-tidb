"""
API v1 package.
"""

from fastapi import APIRouter
from .endpoints import health_router, products_router
from .endpoints.search import router as search_router
from .endpoints.analysis import router as analysis_router
from .endpoints.rules import router as rules_router
from .endpoints.notifications import router as notifications_router
from .endpoints.enforcement import router as enforcement_router
from .endpoints.compliance import router as compliance_router

# Create main v1 router
v1_router = APIRouter(prefix="/v1")

# Include endpoint routers
v1_router.include_router(health_router)
v1_router.include_router(products_router)
v1_router.include_router(search_router)
v1_router.include_router(analysis_router)
v1_router.include_router(rules_router)
v1_router.include_router(notifications_router)
v1_router.include_router(enforcement_router)
v1_router.include_router(compliance_router)

__all__ = ["v1_router"]