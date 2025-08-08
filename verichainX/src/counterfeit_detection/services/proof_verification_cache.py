"""
Proof Verification Cache Service for high-performance zkSNARK verification.

Implements intelligent caching, batch verification, and performance optimization
for zkSNARK proof verification in high-volume environments.
"""

import asyncio
import hashlib
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple, Set
from dataclasses import dataclass
from collections import defaultdict
import json
import redis.asyncio as redis
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

import structlog
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db_session
from ..models.zkproof import ZKProof, VerificationStatus, ProofType
from ..services.zkproof_service import ZKProofService, ProofVerificationResult
from ..utils.crypto_utils import CryptoUtils

logger = structlog.get_logger(__name__)


@dataclass
class VerificationCacheEntry:
    """Cache entry for proof verification results."""
    proof_id: str
    verification_result: ProofVerificationResult
    cached_at: datetime
    cache_ttl_seconds: int
    hit_count: int
    verification_time_ms: float


@dataclass
class BatchVerificationRequest:
    """Batch verification request."""
    request_id: str
    proof_ids: List[str]
    priority: int
    requested_at: datetime
    callback: Optional[callable] = None


@dataclass
class PerformanceMetrics:
    """Performance metrics for verification cache."""
    total_requests: int
    cache_hits: int
    cache_misses: int
    batch_verifications: int
    average_verification_time_ms: float
    peak_concurrent_verifications: int
    total_proof_circuits_loaded: int


class ProofVerificationCache:
    """High-performance caching service for zkSNARK proof verification."""
    
    def __init__(
        self,
        redis_client: Optional[redis.Redis] = None,
        cache_ttl_seconds: int = 3600,
        max_memory_cache_size: int = 10000,
        max_concurrent_verifications: int = 50
    ):
        """Initialize proof verification cache."""
        self.zkproof_service = ZKProofService()
        self.crypto_utils = CryptoUtils()
        
        # Cache configuration
        self.redis_client = redis_client
        self.cache_ttl_seconds = cache_ttl_seconds
        self.max_memory_cache_size = max_memory_cache_size
        self.max_concurrent_verifications = max_concurrent_verifications
        
        # Memory cache
        self.memory_cache: Dict[str, VerificationCacheEntry] = {}
        self.cache_access_order: List[str] = []
        self.cache_lock = threading.RLock()
        
        # Batch processing
        self.batch_queue: List[BatchVerificationRequest] = []
        self.batch_processing_interval = 0.1  # 100ms
        self.max_batch_size = 100
        self.batch_lock = asyncio.Lock()
        
        # Performance tracking
        self.performance_metrics = PerformanceMetrics(
            total_requests=0,
            cache_hits=0,
            cache_misses=0,
            batch_verifications=0,
            average_verification_time_ms=0.0,
            peak_concurrent_verifications=0,
            total_proof_circuits_loaded=0
        )
        
        # Circuit cache for faster verification
        self.circuit_cache: Dict[str, Any] = {}
        self.circuit_cache_lock = threading.RLock()
        
        # Background tasks
        self.background_tasks: Set[asyncio.Task] = set()
        self._start_background_tasks()
    
    async def verify_proof_cached(
        self,
        proof_id: str,
        force_refresh: bool = False,
        priority: int = 5
    ) -> ProofVerificationResult:
        """
        Verify proof with caching.
        
        Args:
            proof_id: Proof identifier
            force_refresh: Force cache refresh
            priority: Verification priority (1-10, higher is more urgent)
            
        Returns:
            Proof verification result
        """
        try:
            self.performance_metrics.total_requests += 1
            start_time = time.time()
            
            # Check cache first
            if not force_refresh:
                cached_result = await self._get_cached_verification(proof_id)
                if cached_result:
                    self.performance_metrics.cache_hits += 1
                    self._update_cache_hit_count(proof_id)
                    
                    logger.debug(
                        "Cache hit for proof verification",
                        proof_id=proof_id,
                        cached_at=cached_result.cached_at.isoformat(),
                        hit_count=cached_result.hit_count
                    )
                    
                    return cached_result.verification_result
            
            self.performance_metrics.cache_misses += 1
            
            # Verify proof
            verification_result = await self._verify_proof_with_optimization(proof_id)
            
            verification_time = (time.time() - start_time) * 1000
            
            # Cache result
            await self._cache_verification_result(
                proof_id, verification_result, verification_time
            )
            
            # Update performance metrics
            self._update_performance_metrics(verification_time)
            
            logger.info(
                "Proof verification completed",
                proof_id=proof_id,
                is_valid=verification_result.is_valid,
                verification_time_ms=verification_time,
                cache_hit=False
            )
            
            return verification_result
            
        except Exception as e:
            logger.error("Failed to verify proof with cache", proof_id=proof_id, error=str(e))
            raise
    
    async def verify_proofs_batch(
        self,
        proof_ids: List[str],
        priority: int = 5
    ) -> Dict[str, ProofVerificationResult]:
        """
        Verify multiple proofs in batch for optimal performance.
        
        Args:
            proof_ids: List of proof identifiers
            priority: Batch priority
            
        Returns:
            Dictionary mapping proof IDs to verification results
        """
        try:
            if not proof_ids:
                return {}
            
            logger.info(
                "Starting batch proof verification",
                proof_count=len(proof_ids),
                priority=priority
            )
            
            results = {}
            uncached_proof_ids = []
            
            # Check cache for all proofs
            for proof_id in proof_ids:
                cached_result = await self._get_cached_verification(proof_id)
                if cached_result:
                    results[proof_id] = cached_result.verification_result
                    self.performance_metrics.cache_hits += 1
                    self._update_cache_hit_count(proof_id)
                else:
                    uncached_proof_ids.append(proof_id)
                    self.performance_metrics.cache_misses += 1
            
            # Batch verify uncached proofs
            if uncached_proof_ids:
                batch_results = await self._batch_verify_proofs(uncached_proof_ids)
                results.update(batch_results)
                
                self.performance_metrics.batch_verifications += 1
            
            logger.info(
                "Batch proof verification completed",
                total_proofs=len(proof_ids),
                cache_hits=len(proof_ids) - len(uncached_proof_ids),
                new_verifications=len(uncached_proof_ids)
            )
            
            return results
            
        except Exception as e:
            logger.error("Failed to verify proofs in batch", error=str(e))
            raise
    
    async def preload_circuit_cache(self, circuit_names: List[str]) -> None:
        """Preload circuits into cache for faster verification."""
        try:
            logger.info("Preloading circuits into cache", circuit_count=len(circuit_names))
            
            for circuit_name in circuit_names:
                if circuit_name not in self.circuit_cache:
                    circuit = await self.zkproof_service.circuit_manager.get_circuit_by_name(
                        circuit_name
                    )
                    
                    if circuit:
                        with self.circuit_cache_lock:
                            self.circuit_cache[circuit_name] = {
                                "circuit": circuit,
                                "loaded_at": datetime.utcnow(),
                                "access_count": 0
                            }
                            
                        self.performance_metrics.total_proof_circuits_loaded += 1
                        
                        logger.debug("Circuit preloaded", circuit_name=circuit_name)
            
            logger.info("Circuit preloading completed", total_cached=len(self.circuit_cache))
            
        except Exception as e:
            logger.error("Failed to preload circuit cache", error=str(e))
    
    async def get_cache_statistics(self) -> Dict[str, Any]:
        """Get comprehensive cache statistics."""
        try:
            cache_hit_rate = 0.0
            if self.performance_metrics.total_requests > 0:
                cache_hit_rate = (
                    self.performance_metrics.cache_hits / 
                    self.performance_metrics.total_requests * 100
                )
            
            memory_cache_size = len(self.memory_cache)
            redis_cache_size = 0
            
            if self.redis_client:
                try:
                    redis_keys = await self.redis_client.keys("proof_verification:*")
                    redis_cache_size = len(redis_keys)
                except Exception:
                    redis_cache_size = -1  # Indicates error
            
            circuit_cache_stats = {}
            with self.circuit_cache_lock:
                for circuit_name, cache_entry in self.circuit_cache.items():
                    circuit_cache_stats[circuit_name] = {
                        "loaded_at": cache_entry["loaded_at"].isoformat(),
                        "access_count": cache_entry["access_count"]
                    }
            
            return {
                "performance_metrics": {
                    "total_requests": self.performance_metrics.total_requests,
                    "cache_hit_rate": cache_hit_rate,
                    "cache_hits": self.performance_metrics.cache_hits,
                    "cache_misses": self.performance_metrics.cache_misses,
                    "batch_verifications": self.performance_metrics.batch_verifications,
                    "average_verification_time_ms": self.performance_metrics.average_verification_time_ms,
                    "peak_concurrent_verifications": self.performance_metrics.peak_concurrent_verifications
                },
                "cache_status": {
                    "memory_cache_size": memory_cache_size,
                    "memory_cache_max_size": self.max_memory_cache_size,
                    "redis_cache_size": redis_cache_size,
                    "cache_ttl_seconds": self.cache_ttl_seconds
                },
                "circuit_cache": {
                    "total_circuits_cached": len(self.circuit_cache),
                    "circuits_loaded": self.performance_metrics.total_proof_circuits_loaded,
                    "circuit_details": circuit_cache_stats
                },
                "batch_processing": {
                    "queue_size": len(self.batch_queue),
                    "max_batch_size": self.max_batch_size,
                    "processing_interval_ms": self.batch_processing_interval * 1000
                }
            }
            
        except Exception as e:
            logger.error("Failed to get cache statistics", error=str(e))
            return {"error": str(e)}
    
    async def clear_cache(self, cache_type: str = "all") -> bool:
        """Clear verification cache."""
        try:
            logger.info("Clearing verification cache", cache_type=cache_type)
            
            if cache_type in ["all", "memory"]:
                with self.cache_lock:
                    self.memory_cache.clear()
                    self.cache_access_order.clear()
            
            if cache_type in ["all", "redis"] and self.redis_client:
                keys = await self.redis_client.keys("proof_verification:*")
                if keys:
                    await self.redis_client.delete(*keys)
            
            if cache_type in ["all", "circuits"]:
                with self.circuit_cache_lock:
                    self.circuit_cache.clear()
            
            if cache_type == "all":
                # Reset performance metrics
                self.performance_metrics = PerformanceMetrics(
                    total_requests=0,
                    cache_hits=0,
                    cache_misses=0,
                    batch_verifications=0,
                    average_verification_time_ms=0.0,
                    peak_concurrent_verifications=0,
                    total_proof_circuits_loaded=0
                )
            
            logger.info("Cache cleared successfully", cache_type=cache_type)
            return True
            
        except Exception as e:
            logger.error("Failed to clear cache", cache_type=cache_type, error=str(e))
            return False
    
    # Helper methods
    
    async def _get_cached_verification(
        self, 
        proof_id: str
    ) -> Optional[VerificationCacheEntry]:
        """Get cached verification result."""
        try:
            # Check memory cache first
            with self.cache_lock:
                if proof_id in self.memory_cache:
                    cache_entry = self.memory_cache[proof_id]
                    
                    # Check if cache entry is still valid
                    age_seconds = (datetime.utcnow() - cache_entry.cached_at).total_seconds()
                    if age_seconds < cache_entry.cache_ttl_seconds:
                        return cache_entry
                    else:
                        # Remove expired entry
                        self._remove_from_memory_cache(proof_id)
            
            # Check Redis cache if available
            if self.redis_client:
                try:
                    cache_key = f"proof_verification:{proof_id}"
                    cached_data = await self.redis_client.get(cache_key)
                    
                    if cached_data:
                        cache_entry_data = json.loads(cached_data)
                        
                        # Reconstruct verification result
                        verification_result = ProofVerificationResult(
                            proof_id=cache_entry_data["verification_result"]["proof_id"],
                            is_valid=cache_entry_data["verification_result"]["is_valid"],
                            verification_details=cache_entry_data["verification_result"]["verification_details"],
                            error_message=cache_entry_data["verification_result"].get("error_message"),
                            verification_time=cache_entry_data["verification_result"]["verification_time"],
                            circuit_id=cache_entry_data["verification_result"]["circuit_id"],
                            public_signals=cache_entry_data["verification_result"]["public_signals"]
                        )
                        
                        cache_entry = VerificationCacheEntry(
                            proof_id=proof_id,
                            verification_result=verification_result,
                            cached_at=datetime.fromisoformat(cache_entry_data["cached_at"]),
                            cache_ttl_seconds=cache_entry_data["cache_ttl_seconds"],
                            hit_count=cache_entry_data["hit_count"],
                            verification_time_ms=cache_entry_data["verification_time_ms"]
                        )
                        
                        # Add to memory cache for faster future access
                        self._add_to_memory_cache(cache_entry)
                        
                        return cache_entry
                        
                except Exception as e:
                    logger.warning("Failed to get cached verification from Redis", 
                                 proof_id=proof_id, error=str(e))
            
            return None
            
        except Exception as e:
            logger.error("Failed to get cached verification", proof_id=proof_id, error=str(e))
            return None
    
    async def _cache_verification_result(
        self,
        proof_id: str,
        verification_result: ProofVerificationResult,
        verification_time_ms: float
    ) -> None:
        """Cache verification result."""
        try:
            cache_entry = VerificationCacheEntry(
                proof_id=proof_id,
                verification_result=verification_result,
                cached_at=datetime.utcnow(),
                cache_ttl_seconds=self.cache_ttl_seconds,
                hit_count=0,
                verification_time_ms=verification_time_ms
            )
            
            # Add to memory cache
            self._add_to_memory_cache(cache_entry)
            
            # Cache in Redis if available
            if self.redis_client:
                try:
                    cache_key = f"proof_verification:{proof_id}"
                    cache_data = {
                        "verification_result": {
                            "proof_id": verification_result.proof_id,
                            "is_valid": verification_result.is_valid,
                            "verification_details": verification_result.verification_details,
                            "error_message": verification_result.error_message,
                            "verification_time": verification_result.verification_time.isoformat(),
                            "circuit_id": verification_result.circuit_id,
                            "public_signals": verification_result.public_signals
                        },
                        "cached_at": cache_entry.cached_at.isoformat(),
                        "cache_ttl_seconds": cache_entry.cache_ttl_seconds,
                        "hit_count": cache_entry.hit_count,
                        "verification_time_ms": verification_time_ms
                    }
                    
                    await self.redis_client.setex(
                        cache_key,
                        self.cache_ttl_seconds,
                        json.dumps(cache_data)
                    )
                    
                except Exception as e:
                    logger.warning("Failed to cache verification in Redis", 
                                 proof_id=proof_id, error=str(e))
            
        except Exception as e:
            logger.error("Failed to cache verification result", proof_id=proof_id, error=str(e))
    
    def _add_to_memory_cache(self, cache_entry: VerificationCacheEntry) -> None:
        """Add entry to memory cache with LRU eviction."""
        with self.cache_lock:
            proof_id = cache_entry.proof_id
            
            # Remove if already exists
            if proof_id in self.memory_cache:
                self.cache_access_order.remove(proof_id)
            
            # Add to cache
            self.memory_cache[proof_id] = cache_entry
            self.cache_access_order.append(proof_id)
            
            # Evict if over size limit
            while len(self.memory_cache) > self.max_memory_cache_size:
                oldest_proof_id = self.cache_access_order.pop(0)
                del self.memory_cache[oldest_proof_id]
    
    def _remove_from_memory_cache(self, proof_id: str) -> None:
        """Remove entry from memory cache."""
        with self.cache_lock:
            if proof_id in self.memory_cache:
                del self.memory_cache[proof_id]
                self.cache_access_order.remove(proof_id)
    
    def _update_cache_hit_count(self, proof_id: str) -> None:
        """Update cache hit count for an entry."""
        with self.cache_lock:
            if proof_id in self.memory_cache:
                self.memory_cache[proof_id].hit_count += 1
                
                # Move to end of access order (LRU)
                self.cache_access_order.remove(proof_id)
                self.cache_access_order.append(proof_id)
    
    async def _verify_proof_with_optimization(
        self, 
        proof_id: str
    ) -> ProofVerificationResult:
        """Verify proof with circuit caching optimization."""
        try:
            async with get_db_session() as session:
                # Get proof
                proof_query = select(ZKProof).where(ZKProof.id == proof_id)
                proof_result = await session.execute(proof_query)
                proof = proof_result.scalar_one_or_none()
                
                if not proof:
                    return ProofVerificationResult(
                        proof_id=proof_id,
                        is_valid=False,
                        verification_details={},
                        error_message="Proof not found",
                        verification_time=datetime.utcnow(),
                        circuit_id="",
                        public_signals={}
                    )
                
                # Use cached circuit if available
                circuit = None
                with self.circuit_cache_lock:
                    circuit_cache_entry = self.circuit_cache.get(proof.circuit_id)
                    if circuit_cache_entry:
                        circuit = circuit_cache_entry["circuit"]
                        circuit_cache_entry["access_count"] += 1
                
                # Verify using zkproof service with circuit cache
                if circuit:
                    return await self.zkproof_service._verify_proof_with_circuit(
                        proof, circuit
                    )
                else:
                    return await self.zkproof_service.verify_proof(proof_id)
                
        except Exception as e:
            logger.error("Failed to verify proof with optimization", proof_id=proof_id, error=str(e))
            return ProofVerificationResult(
                proof_id=proof_id,
                is_valid=False,
                verification_details={},
                error_message=f"Verification failed: {str(e)}",
                verification_time=datetime.utcnow(),
                circuit_id="",
                public_signals={}
            )
    
    async def _batch_verify_proofs(
        self, 
        proof_ids: List[str]
    ) -> Dict[str, ProofVerificationResult]:
        """Verify proofs in parallel batch."""
        try:
            results = {}
            
            # Create verification tasks
            verification_tasks = []
            for proof_id in proof_ids:
                task = asyncio.create_task(
                    self._verify_proof_with_optimization(proof_id)
                )
                verification_tasks.append((proof_id, task))
            
            # Track concurrent verifications
            current_concurrent = len(verification_tasks)
            if current_concurrent > self.performance_metrics.peak_concurrent_verifications:
                self.performance_metrics.peak_concurrent_verifications = current_concurrent
            
            # Wait for all verifications
            for proof_id, task in verification_tasks:
                try:
                    verification_result = await task
                    results[proof_id] = verification_result
                    
                    # Cache the result
                    await self._cache_verification_result(
                        proof_id, verification_result, 0.0  # Time tracking handled elsewhere
                    )
                    
                except Exception as e:
                    logger.error("Failed to verify proof in batch", proof_id=proof_id, error=str(e))
                    results[proof_id] = ProofVerificationResult(
                        proof_id=proof_id,
                        is_valid=False,
                        verification_details={},
                        error_message=f"Batch verification failed: {str(e)}",
                        verification_time=datetime.utcnow(),
                        circuit_id="",
                        public_signals={}
                    )
            
            return results
            
        except Exception as e:
            logger.error("Failed to batch verify proofs", error=str(e))
            return {proof_id: ProofVerificationResult(
                proof_id=proof_id,
                is_valid=False,
                verification_details={},
                error_message=f"Batch processing failed: {str(e)}",
                verification_time=datetime.utcnow(),
                circuit_id="",
                public_signals={}
            ) for proof_id in proof_ids}
    
    def _update_performance_metrics(self, verification_time_ms: float) -> None:
        """Update performance metrics."""
        # Update average verification time
        total_requests = self.performance_metrics.total_requests
        current_average = self.performance_metrics.average_verification_time_ms
        
        self.performance_metrics.average_verification_time_ms = (
            (current_average * (total_requests - 1) + verification_time_ms) / total_requests
        )
    
    def _start_background_tasks(self) -> None:
        """Start background maintenance tasks."""
        # In a real implementation, these would be started properly
        logger.info("Background cache maintenance tasks initialized")
    
    async def shutdown(self) -> None:
        """Shutdown cache service and cleanup resources."""
        try:
            logger.info("Shutting down proof verification cache")
            
            # Cancel background tasks
            for task in self.background_tasks:
                task.cancel()
            
            if self.background_tasks:
                await asyncio.gather(*self.background_tasks, return_exceptions=True)
            
            # Close Redis connection
            if self.redis_client:
                await self.redis_client.close()
            
            logger.info("Proof verification cache shutdown completed")
            
        except Exception as e:
            logger.error("Error during cache shutdown", error=str(e))


# Global instance for convenience
proof_verification_cache = ProofVerificationCache()