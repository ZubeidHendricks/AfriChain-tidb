"""
Main FastAPI application entry point.
"""

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.v1 import v1_router
from .config.settings import get_settings

settings = get_settings()

# Configure structured logging
structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.add_log_level,
        structlog.processors.CallsiteParameterAdder(
            parameters=[structlog.processors.CallsiteParameter.FUNC_NAME]
        ),
        structlog.processors.JSONRenderer()
    ],
    wrapper_class=structlog.make_filtering_bound_logger(
        getattr(logging, settings.log_level.upper())
    ),
    logger_factory=structlog.PrintLoggerFactory(),
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Application lifespan handler.
    
    Args:
        app: FastAPI application instance
    """
    # Startup
    logger.info(
        "Starting Counterfeit Detection System",
        version="1.0.0",
        environment=settings.app_env,
        debug_mode=settings.app_debug
    )
    
    yield
    
    # Shutdown
    logger.info("Shutting down Counterfeit Detection System")


# Create FastAPI application
app = FastAPI(
    title="Counterfeit Product Detection API",
    description="AI-powered system for detecting counterfeit products using multi-agent architecture",
    version="1.0.0",
    lifespan=lifespan
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(v1_router, prefix="/api")

# Root endpoint
@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "message": "Counterfeit Product Detection API",
        "version": "1.0.0",
        "status": "operational",
        "docs": "/docs"
    }