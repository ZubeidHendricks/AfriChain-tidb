"""
Agent registry for discovery, registration, and capability management.
"""

import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Set, Any
from collections import defaultdict
from dataclasses import dataclass

import structlog
from redis.asyncio import Redis

from ..base import AgentMetadata, AgentStatus, AgentCapability
from ...config.redis import get_redis_client

logger = structlog.get_logger(module=__name__)


@dataclass
class AgentHealth:
    """Agent health status information."""
    agent_id: str
    last_heartbeat: datetime
    response_time_ms: float
    error_count: int
    consecutive_failures: int
    health_score: float  # 0.0 - 1.0


class AgentRegistry:
    """
    Centralized registry for agent discovery and capability management.
    
    Features:
    - Agent registration and deregistration
    - Capability-based agent discovery
    - Health monitoring and scoring
    - Load balancing support
    """
    
    def __init__(self):
        self.redis_client: Optional[Redis] = None
        self.agents: Dict[str, AgentMetadata] = {}
        self.agent_health: Dict[str, AgentHealth] = {}
        self.capabilities_index: Dict[str, Set[str]] = defaultdict(set)  # capability -> agent_ids
        self.type_index: Dict[str, Set[str]] = defaultdict(set)  # agent_type -> agent_ids
        
        self.running_tasks: List[asyncio.Task] = []
        self.shutdown_event = asyncio.Event()
        
        self.logger = structlog.get_logger(component="agent_registry")
    
    async def initialize(self) -> None:
        """Initialize registry and start background tasks."""
        try:
            self.redis_client = await get_redis_client()
            
            # Start background tasks
            self._start_background_tasks()
            
            self.logger.info("Agent registry initialized")
            
        except Exception as e:
            self.logger.error("Failed to initialize agent registry", error=str(e))
            raise
    
    async def shutdown(self) -> None:
        """Shutdown registry and clean up resources."""
        try:
            self.shutdown_event.set()
            
            # Cancel background tasks
            for task in self.running_tasks:
                task.cancel()
            
            if self.running_tasks:
                await asyncio.gather(*self.running_tasks, return_exceptions=True)
            
            # Close Redis connection
            if self.redis_client:
                await self.redis_client.close()
            
            self.logger.info("Agent registry shutdown")
            
        except Exception as e:
            self.logger.error("Error during registry shutdown", error=str(e))
    
    async def register_agent(self, metadata: AgentMetadata) -> bool:
        """
        Register a new agent in the registry.
        
        Args:
            metadata: Agent metadata including capabilities
            
        Returns:
            True if registration successful
        """
        try:
            agent_id = metadata.agent_id
            
            # Store agent metadata
            self.agents[agent_id] = metadata
            
            # Update indexes
            self.type_index[metadata.agent_type].add(agent_id)
            
            for capability in metadata.capabilities:
                self.capabilities_index[capability.name].add(agent_id)
            
            # Initialize health tracking
            self.agent_health[agent_id] = AgentHealth(
                agent_id=agent_id,
                last_heartbeat=datetime.utcnow(),
                response_time_ms=0.0,
                error_count=0,
                consecutive_failures=0,
                health_score=1.0
            )
            
            # Store in Redis for persistence
            await self._store_agent_metadata(metadata)
            
            self.logger.info(
                "Agent registered",
                agent_id=agent_id,
                agent_type=metadata.agent_type,
                capabilities=[cap.name for cap in metadata.capabilities]
            )
            
            return True
            
        except Exception as e:
            self.logger.error(
                "Failed to register agent",
                agent_id=metadata.agent_id,
                error=str(e)
            )
            return False
    
    async def deregister_agent(self, agent_id: str) -> bool:
        """
        Remove agent from registry.
        
        Args:
            agent_id: ID of agent to deregister
            
        Returns:
            True if deregistration successful
        """
        try:
            if agent_id not in self.agents:
                self.logger.warning("Agent not found for deregistration", agent_id=agent_id)
                return False
            
            metadata = self.agents[agent_id]
            
            # Remove from indexes
            self.type_index[metadata.agent_type].discard(agent_id)
            
            for capability in metadata.capabilities:
                self.capabilities_index[capability.name].discard(agent_id)
            
            # Clean up empty capability entries
            self.capabilities_index = {
                cap: agents for cap, agents in self.capabilities_index.items()
                if agents
            }
            
            # Remove from storage
            del self.agents[agent_id]
            self.agent_health.pop(agent_id, None)
            
            # Remove from Redis
            await self._remove_agent_metadata(agent_id)
            
            self.logger.info(
                "Agent deregistered",
                agent_id=agent_id,
                agent_type=metadata.agent_type
            )
            
            return True
            
        except Exception as e:
            self.logger.error(
                "Failed to deregister agent",
                agent_id=agent_id,
                error=str(e)
            )
            return False
    
    def get_agent(self, agent_id: str) -> Optional[AgentMetadata]:
        """Get agent metadata by ID."""
        return self.agents.get(agent_id)
    
    def get_agents_by_type(self, agent_type: str) -> List[AgentMetadata]:
        """Get all agents of specified type."""
        agent_ids = self.type_index.get(agent_type, set())
        return [self.agents[aid] for aid in agent_ids if aid in self.agents]
    
    def get_agents_by_capability(self, capability_name: str) -> List[AgentMetadata]:
        """Get all agents with specified capability."""
        agent_ids = self.capabilities_index.get(capability_name, set())
        return [self.agents[aid] for aid in agent_ids if aid in self.agents]
    
    def get_healthy_agents(
        self, 
        agent_type: Optional[str] = None,
        min_health_score: float = 0.7
    ) -> List[AgentMetadata]:
        """
        Get healthy agents, optionally filtered by type.
        
        Args:
            agent_type: Optional agent type filter
            min_health_score: Minimum health score required
            
        Returns:
            List of healthy agent metadata
        """
        candidates = (
            self.get_agents_by_type(agent_type) if agent_type 
            else list(self.agents.values())
        )
        
        healthy_agents = []
        for agent in candidates:
            if agent.status == AgentStatus.RUNNING:
                health = self.agent_health.get(agent.agent_id)
                if health and health.health_score >= min_health_score:
                    healthy_agents.append(agent)
        
        # Sort by health score (descending)
        healthy_agents.sort(
            key=lambda a: self.agent_health[a.agent_id].health_score,
            reverse=True
        )
        
        return healthy_agents
    
    def find_best_agent(
        self,
        capability_name: str,
        exclude_agents: Optional[Set[str]] = None
    ) -> Optional[AgentMetadata]:
        """
        Find the best agent for a specific capability.
        
        Args:
            capability_name: Required capability
            exclude_agents: Agent IDs to exclude from selection
            
        Returns:
            Best available agent or None
        """
        candidates = self.get_agents_by_capability(capability_name)
        
        if exclude_agents:
            candidates = [a for a in candidates if a.agent_id not in exclude_agents]
        
        # Filter for healthy, running agents
        healthy_candidates = [
            agent for agent in candidates
            if (agent.status == AgentStatus.RUNNING and
                self.agent_health.get(agent.agent_id, AgentHealth(
                    agent.agent_id, datetime.utcnow(), 0, 0, 0, 0
                )).health_score > 0.5)
        ]
        
        if not healthy_candidates:
            return None
        
        # Select based on health score and load
        best_agent = max(
            healthy_candidates,
            key=lambda a: self._calculate_selection_score(a)
        )
        
        return best_agent
    
    def get_load_balanced_agents(
        self,
        agent_type: str,
        count: int = 1
    ) -> List[AgentMetadata]:
        """
        Get load-balanced list of agents for distribution.
        
        Args:
            agent_type: Type of agents to select
            count: Number of agents to return
            
        Returns:
            List of selected agents for load balancing
        """
        candidates = self.get_healthy_agents(agent_type)
        
        if len(candidates) <= count:
            return candidates
        
        # Sort by load (processed messages / health score)
        candidates.sort(key=lambda a: self._calculate_load_score(a))
        
        return candidates[:count]
    
    async def update_agent_heartbeat(
        self,
        agent_id: str,
        response_time_ms: Optional[float] = None
    ) -> None:
        """
        Update agent heartbeat and health metrics.
        
        Args:
            agent_id: Agent ID
            response_time_ms: Optional response time for health calculation
        """
        if agent_id not in self.agent_health:
            return
        
        health = self.agent_health[agent_id]
        health.last_heartbeat = datetime.utcnow()
        
        if response_time_ms is not None:
            # Update response time with exponential moving average
            if health.response_time_ms == 0:
                health.response_time_ms = response_time_ms
            else:
                health.response_time_ms = (
                    0.7 * health.response_time_ms + 0.3 * response_time_ms
                )
        
        # Reset consecutive failures on successful heartbeat
        health.consecutive_failures = 0
        
        # Recalculate health score
        health.health_score = self._calculate_health_score(health)
        
        # Update agent status if it was previously errored
        if agent_id in self.agents:
            if self.agents[agent_id].status == AgentStatus.ERROR:
                self.agents[agent_id].status = AgentStatus.RUNNING
    
    async def report_agent_error(self, agent_id: str, error_message: str) -> None:
        """
        Report agent error and update health metrics.
        
        Args:
            agent_id: Agent ID
            error_message: Error description
        """
        if agent_id not in self.agent_health:
            return
        
        health = self.agent_health[agent_id]
        health.error_count += 1
        health.consecutive_failures += 1
        
        # Recalculate health score
        health.health_score = self._calculate_health_score(health)
        
        # Mark agent as errored if too many consecutive failures
        if health.consecutive_failures >= 3 and agent_id in self.agents:
            self.agents[agent_id].status = AgentStatus.ERROR
        
        self.logger.warning(
            "Agent error reported",
            agent_id=agent_id,
            error=error_message,
            consecutive_failures=health.consecutive_failures,
            health_score=health.health_score
        )
    
    def get_registry_statistics(self) -> Dict[str, Any]:
        """Get registry statistics and health overview."""
        stats = {
            "total_agents": len(self.agents),
            "agents_by_type": {
                agent_type: len(agent_ids)
                for agent_type, agent_ids in self.type_index.items()
            },
            "agents_by_status": defaultdict(int),
            "capabilities": list(self.capabilities_index.keys()),
            "average_health_score": 0.0,
            "unhealthy_agents": []
        }
        
        total_health = 0.0
        for agent in self.agents.values():
            stats["agents_by_status"][agent.status.value] += 1
            
            health = self.agent_health.get(agent.agent_id)
            if health:
                total_health += health.health_score
                if health.health_score < 0.5:
                    stats["unhealthy_agents"].append({
                        "agent_id": agent.agent_id,
                        "health_score": health.health_score,
                        "last_heartbeat": health.last_heartbeat.isoformat()
                    })
        
        if self.agents:
            stats["average_health_score"] = total_health / len(self.agents)
        
        return stats
    
    def _calculate_health_score(self, health: AgentHealth) -> float:
        """Calculate health score based on various metrics."""
        score = 1.0
        
        # Penalty for consecutive failures
        if health.consecutive_failures > 0:
            score *= max(0.1, 1.0 - (health.consecutive_failures * 0.2))
        
        # Penalty for high error count
        if health.error_count > 10:
            score *= max(0.3, 1.0 - ((health.error_count - 10) * 0.01))
        
        # Penalty for slow response times
        if health.response_time_ms > 1000:  # 1 second
            score *= max(0.5, 1.0 - ((health.response_time_ms - 1000) / 10000))
        
        # Penalty for old heartbeat
        time_since_heartbeat = datetime.utcnow() - health.last_heartbeat
        if time_since_heartbeat > timedelta(minutes=2):
            score *= max(0.1, 1.0 - (time_since_heartbeat.total_seconds() / 3600))
        
        return max(0.0, min(1.0, score))
    
    def _calculate_selection_score(self, agent: AgentMetadata) -> float:
        """Calculate selection score for load balancing."""
        health = self.agent_health.get(agent.agent_id)
        if not health:
            return 0.0
        
        # Base score from health
        score = health.health_score
        
        # Adjust for current load (inverse of processed messages)
        if agent.processed_messages > 0:
            load_factor = 1.0 / (1.0 + agent.processed_messages / 1000.0)
            score *= load_factor
        
        return score
    
    def _calculate_load_score(self, agent: AgentMetadata) -> float:
        """Calculate load score (lower = less loaded)."""
        health = self.agent_health.get(agent.agent_id)
        if not health:
            return float('inf')
        
        # Load based on processed messages and health
        base_load = agent.processed_messages
        health_factor = max(0.1, health.health_score)  # Avoid division by zero
        
        return base_load / health_factor
    
    def _start_background_tasks(self) -> None:
        """Start background maintenance tasks."""
        # Health monitoring task
        health_task = asyncio.create_task(self._health_monitor())
        self.running_tasks.append(health_task)
        
        # Cleanup task
        cleanup_task = asyncio.create_task(self._periodic_cleanup())
        self.running_tasks.append(cleanup_task)
    
    async def _health_monitor(self) -> None:
        """Monitor agent health and update status."""
        while not self.shutdown_event.is_set():
            try:
                current_time = datetime.utcnow()
                stale_threshold = current_time - timedelta(minutes=3)
                
                stale_agents = []
                for agent_id, health in self.agent_health.items():
                    if health.last_heartbeat < stale_threshold:
                        stale_agents.append(agent_id)
                
                # Mark stale agents as errored
                for agent_id in stale_agents:
                    if agent_id in self.agents:
                        self.agents[agent_id].status = AgentStatus.ERROR
                        self.logger.warning("Agent marked as stale", agent_id=agent_id)
                
                # Update health scores
                for health in self.agent_health.values():
                    health.health_score = self._calculate_health_score(health)
                
                await asyncio.sleep(30)  # Check every 30 seconds
                
            except Exception as e:
                self.logger.error("Error in health monitor", error=str(e))
                await asyncio.sleep(5)
    
    async def _periodic_cleanup(self) -> None:
        """Periodic cleanup of stale data."""
        while not self.shutdown_event.is_set():
            try:
                # Clean up agents that have been stale for too long
                current_time = datetime.utcnow()
                cleanup_threshold = current_time - timedelta(hours=1)
                
                agents_to_remove = []
                for agent_id, health in self.agent_health.items():
                    if (health.last_heartbeat < cleanup_threshold and
                        agent_id in self.agents and
                        self.agents[agent_id].status == AgentStatus.ERROR):
                        agents_to_remove.append(agent_id)
                
                # Remove stale agents
                for agent_id in agents_to_remove:
                    await self.deregister_agent(agent_id)
                    self.logger.info("Removed stale agent", agent_id=agent_id)
                
                await asyncio.sleep(3600)  # Cleanup every hour
                
            except Exception as e:
                self.logger.error("Error in periodic cleanup", error=str(e))
                await asyncio.sleep(300)  # 5 minute retry delay
    
    async def _store_agent_metadata(self, metadata: AgentMetadata) -> None:
        """Store agent metadata in Redis for persistence."""
        if not self.redis_client:
            return
        
        try:
            key = f"agent_registry:{metadata.agent_id}"
            value = metadata.json()
            await self.redis_client.setex(key, 3600, value)  # 1 hour TTL
            
        except Exception as e:
            self.logger.error(
                "Failed to store agent metadata",
                agent_id=metadata.agent_id,
                error=str(e)
            )
    
    async def _remove_agent_metadata(self, agent_id: str) -> None:
        """Remove agent metadata from Redis."""
        if not self.redis_client:
            return
        
        try:
            key = f"agent_registry:{agent_id}"
            await self.redis_client.delete(key)
            
        except Exception as e:
            self.logger.error(
                "Failed to remove agent metadata",
                agent_id=agent_id,
                error=str(e)
            )