"""
Redis configuration for multi-agent communication.
"""

import redis.asyncio as redis
from redis.asyncio import Redis

from .settings import get_settings

settings = get_settings()


async def get_redis_client() -> Redis:
    """
    Get Redis client for agent communication.
    
    Returns:
        Redis: Async Redis client
    """
    return redis.from_url(
        settings.redis_url,
        encoding="utf-8",
        decode_responses=True
    )


async def check_redis_connection() -> bool:
    """
    Check if Redis connection is working.
    
    Returns:
        bool: True if connection is successful, False otherwise
    """
    try:
        client = await get_redis_client()
        await client.ping()
        await client.close()
        return True
    except Exception:
        return False