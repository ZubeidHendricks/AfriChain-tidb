"""
FastAPI bridge endpoints for Python-TypeScript Hedera agent communication.
"""

import asyncio
import json
from typing import Dict, Any, Optional
from datetime import datetime

import httpx
import structlog
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field

from ...config.redis import get_redis_client
from ...config.settings import get_settings

logger = structlog.get_logger(module=__name__)
router = APIRouter(prefix="/hedera", tags=["hedera-bridge"])
settings = get_settings()


class HederaAgentMessage(BaseModel):
    """Message format for Hedera agent communication."""
    type: str = Field(..., description="Message type")
    payload: Dict[str, Any] = Field(default_factory=dict, description="Message payload")
    source: str = Field(default="python-orchestrator", description="Message source")
    target: str = Field(default="hedera-service", description="Message target")
    correlation_id: Optional[str] = Field(None, description="Correlation ID for tracking")
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class HederaResponse(BaseModel):
    """Standard response format from Hedera service."""
    success: bool
    data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)


@router.post("/ping", response_model=HederaResponse)
async def ping_hedera_service():
    """
    Test basic connectivity with TypeScript Hedera service.
    """
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "http://hedera-service:3001/api/v1/hedera/ping",
                json={
                    "message": "ping from python",
                    "source": "fastapi-bridge"
                },
                timeout=5.0
            )
            
            if response.status_code == 200:
                data = response.json()
                logger.info("Hedera service ping successful", response=data)
                return HederaResponse(success=True, data=data)
            else:
                logger.error("Hedera service ping failed", status=response.status_code)
                return HederaResponse(
                    success=False, 
                    error=f"HTTP {response.status_code}"
                )
    
    except httpx.TimeoutException:
        logger.error("Hedera service ping timeout")
        return HederaResponse(success=False, error="Service timeout")
    
    except Exception as e:
        logger.error("Hedera service ping error", error=str(e))
        return HederaResponse(success=False, error=str(e))


@router.get("/status", response_model=HederaResponse)
async def get_hedera_status():
    """
    Get status from TypeScript Hedera service.
    """
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "http://hedera-service:3001/api/v1/hedera/status",
                timeout=5.0
            )
            
            if response.status_code == 200:
                data = response.json()
                logger.info("Hedera status retrieved", status=data)
                return HederaResponse(success=True, data=data)
            else:
                return HederaResponse(
                    success=False, 
                    error=f"HTTP {response.status_code}"
                )
    
    except Exception as e:
        logger.error("Hedera status error", error=str(e))
        return HederaResponse(success=False, error=str(e))


@router.post("/send-message", response_model=HederaResponse)
async def send_message_to_hedera(message: HederaAgentMessage):
    """
    Send message to Hedera service via Redis channel.
    """
    try:
        redis_client = await get_redis_client()
        
        # Publish message to Hedera agent command channel
        channel = "hedera.agent.commands"
        message_data = message.model_dump()
        
        await redis_client.publish(channel, json.dumps(message_data))
        
        logger.info(
            "Message sent to Hedera service", 
            channel=channel, 
            message_type=message.type
        )
        
        return HederaResponse(
            success=True, 
            data={"channel": channel, "message_id": message.correlation_id}
        )
    
    except Exception as e:
        logger.error("Failed to send message to Hedera service", error=str(e))
        return HederaResponse(success=False, error=str(e))


async def subscribe_to_hedera_responses():
    """
    Background task to listen for Hedera service responses.
    """
    try:
        redis_client = await get_redis_client()
        pubsub = redis_client.pubsub()
        
        # Subscribe to Hedera response channel
        await pubsub.subscribe("hedera.agent.responses")
        
        logger.info("Subscribed to Hedera response channel")
        
        async for message in pubsub.listen():
            if message["type"] == "message":
                try:
                    data = json.loads(message["data"])
                    logger.info("Received Hedera response", data=data)
                    
                    # Process the response (store in cache, notify waiting clients, etc.)
                    # This is where you'd implement response handling logic
                    
                except json.JSONDecodeError:
                    logger.error("Invalid JSON in Hedera response", raw_data=message["data"])
                except Exception as e:
                    logger.error("Error processing Hedera response", error=str(e))
    
    except Exception as e:
        logger.error("Hedera response subscription error", error=str(e))


# Start background subscription on module import
@router.on_event("startup")
async def startup_event():
    """Start background tasks on router startup."""
    # Start background subscription to Hedera responses
    asyncio.create_task(subscribe_to_hedera_responses())
    logger.info("Hedera bridge endpoints initialized")