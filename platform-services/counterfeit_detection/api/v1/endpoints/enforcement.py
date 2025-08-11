"""
API endpoints for enforcement management.

This module provides REST API endpoints for managing enforcement rules,
executing enforcement actions, and handling appeals.
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession

import structlog

from ...core.database import get_db_session
from ...db.repositories.enforcement_repository import EnforcementRepository
from ...agents.enforcement_agent import EnforcementAgent, EnforcementRequest
from ...services.enforcement_service import EnforcementService
from ..schemas.enforcement import (
    EnforcementRuleCreate,
    EnforcementRuleUpdate,
    EnforcementRuleResponse,
    EnforcementActionCreate,
    EnforcementActionResponse,
    ManualEnforcementRequest,
    BatchEnforcementRequest,
    BatchEnforcementResponse,
    AppealSubmission,
    AppealReview,
    AppealResponse,
    SupplierReputationResponse,
    EnforcementStatistics,
    EnforcementTrendsResponse,
    ActionEvaluationRequest,
    ActionEvaluationResponse,
    RollbackRequest,
    RollbackResponse
)

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/enforcement", tags=["enforcement"])

# Global enforcement agent instance
_enforcement_agent: Optional[EnforcementAgent] = None


async def get_enforcement_agent() -> EnforcementAgent:
    """Get or create enforcement agent instance."""
    global _enforcement_agent
    if _enforcement_agent is None:
        _enforcement_agent = EnforcementAgent("api-enforcement-agent")
        await _enforcement_agent.start()
    return _enforcement_agent


async def get_enforcement_repository(session: AsyncSession = Depends(get_db_session)) -> EnforcementRepository:
    """Get enforcement repository instance."""
    return EnforcementRepository(session)


# Enforcement Rules endpoints
@router.post("/rules", response_model=EnforcementRuleResponse, status_code=201)
async def create_enforcement_rule(
    rule_data: EnforcementRuleCreate,
    repository: EnforcementRepository = Depends(get_enforcement_repository)
):
    """
    Create a new enforcement rule.
    
    This endpoint allows administrators to create new rules that define
    when and what enforcement actions should be taken based on authenticity scores.
    """
    try:
        rule = await repository.create_enforcement_rule(rule_data.dict())
        logger.info("Enforcement rule created via API", rule_id=rule.id, rule_name=rule.rule_name)
        return rule
    
    except Exception as e:
        logger.error("Failed to create enforcement rule", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to create enforcement rule: {str(e)}")


@router.get("/rules", response_model=List[EnforcementRuleResponse])
async def get_enforcement_rules(
    category: Optional[str] = Query(None, description="Filter by product category"),
    active_only: bool = Query(True, description="Return only active rules"),
    limit: int = Query(100, ge=1, le=1000, description="Maximum number of results"),
    offset: int = Query(0, ge=0, description="Number of results to skip"),
    repository: EnforcementRepository = Depends(get_enforcement_repository)
):
    """
    Get enforcement rules with optional filtering.
    
    Returns a list of enforcement rules that can be filtered by category
    and active status. Results are paginated and ordered by priority.
    """
    try:
        rules = await repository.get_enforcement_rules(
            category=category,
            active_only=active_only,
            limit=limit,
            offset=offset
        )
        return rules
    
    except Exception as e:
        logger.error("Failed to get enforcement rules", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get enforcement rules: {str(e)}")


@router.get("/rules/{rule_id}", response_model=EnforcementRuleResponse)
async def get_enforcement_rule(
    rule_id: str,
    repository: EnforcementRepository = Depends(get_enforcement_repository)
):
    """Get a specific enforcement rule by ID."""
    try:
        rule = await repository.get_enforcement_rule_by_id(rule_id)
        if not rule:
            raise HTTPException(status_code=404, detail="Enforcement rule not found")
        return rule
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get enforcement rule", error=str(e), rule_id=rule_id)
        raise HTTPException(status_code=500, detail=f"Failed to get enforcement rule: {str(e)}")


@router.put("/rules/{rule_id}", response_model=EnforcementRuleResponse)
async def update_enforcement_rule(
    rule_id: str,
    rule_data: EnforcementRuleUpdate,
    repository: EnforcementRepository = Depends(get_enforcement_repository)
):
    """Update an existing enforcement rule."""
    try:
        # Only include non-None values in update
        update_data = {k: v for k, v in rule_data.dict().items() if v is not None}
        
        rule = await repository.update_enforcement_rule(rule_id, update_data)
        if not rule:
            raise HTTPException(status_code=404, detail="Enforcement rule not found")
        
        logger.info("Enforcement rule updated via API", rule_id=rule_id, updated_fields=list(update_data.keys()))
        return rule
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to update enforcement rule", error=str(e), rule_id=rule_id)
        raise HTTPException(status_code=500, detail=f"Failed to update enforcement rule: {str(e)}")


@router.delete("/rules/{rule_id}", status_code=204)
async def delete_enforcement_rule(
    rule_id: str,
    repository: EnforcementRepository = Depends(get_enforcement_repository)
):
    """Delete an enforcement rule."""
    try:
        success = await repository.delete_enforcement_rule(rule_id)
        if not success:
            raise HTTPException(status_code=404, detail="Enforcement rule not found")
        
        logger.info("Enforcement rule deleted via API", rule_id=rule_id)
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to delete enforcement rule", error=str(e), rule_id=rule_id)
        raise HTTPException(status_code=500, detail=f"Failed to delete enforcement rule: {str(e)}")


# Enforcement Actions endpoints
@router.post("/actions", response_model=EnforcementActionResponse, status_code=201)
async def execute_enforcement_action(
    action_data: EnforcementActionCreate,
    background_tasks: BackgroundTasks,
    enforcement_agent: EnforcementAgent = Depends(get_enforcement_agent)
):
    """
    Execute an enforcement action.
    
    This endpoint triggers an enforcement action against a product based on
    analysis results. The action is executed asynchronously in the background.
    """
    try:
        # Create enforcement request
        request = EnforcementRequest(
            product_id=action_data.product_id,
            action_type=action_data.action_type,
            authenticity_score=action_data.authenticity_score,
            confidence_score=action_data.confidence_score,
            reasoning=action_data.reasoning,
            priority_override=action_data.priority_override,
            supplier_id=action_data.supplier_id
        )
        
        # Execute action via enforcement agent
        result = await enforcement_agent.execute_enforcement_action(request)
        
        logger.info("Enforcement action executed via API", 
                   action_id=result.action_id, 
                   product_id=action_data.product_id,
                   action_type=action_data.action_type.value)
        
        # Convert result to response format
        response = EnforcementActionResponse(
            id=result.action_id,
            product_id=result.product_id,
            action_type=result.action_type,
            authenticity_score=result.authenticity_score,
            confidence_score=result.confidence_score,
            reasoning=result.reasoning,
            executed_by=result.executed_by,
            execution_status=result.status,
            platform_response=result.platform_response,
            appeal_status="none",  # Default for new actions
            created_at=result.created_at,
            completed_at=result.created_at if result.status.value == "completed" else None
        )
        
        return response
    
    except Exception as e:
        logger.error("Failed to execute enforcement action", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to execute enforcement action: {str(e)}")


@router.post("/actions/manual", response_model=EnforcementActionResponse, status_code=201)
async def execute_manual_enforcement_action(
    action_data: ManualEnforcementRequest,
    enforcement_agent: EnforcementAgent = Depends(get_enforcement_agent)
):
    """
    Execute a manual enforcement action.
    
    This endpoint allows administrators to manually trigger enforcement actions
    with the ability to override automatic rules.
    """
    try:
        # Create enforcement request for manual action
        request = EnforcementRequest(
            product_id=action_data.product_id,
            action_type=action_data.action_type,
            authenticity_score=0,  # Manual actions don't require score
            confidence_score=1.0,  # Full confidence for manual actions
            reasoning=f"Manual action: {action_data.reason}",
            priority_override=action_data.override_rules
        )
        
        # Execute action
        result = await enforcement_agent.execute_enforcement_action(request)
        
        logger.info("Manual enforcement action executed via API",
                   action_id=result.action_id,
                   product_id=action_data.product_id,
                   executed_by=action_data.executed_by)
        
        # Convert result to response format
        response = EnforcementActionResponse(
            id=result.action_id,
            product_id=result.product_id,
            action_type=result.action_type,
            authenticity_score=result.authenticity_score,
            confidence_score=result.confidence_score,
            reasoning=result.reasoning,
            executed_by=action_data.executed_by,  # Use the provided user ID
            execution_status=result.status,
            platform_response=result.platform_response,
            appeal_status="none",
            created_at=result.created_at,
            completed_at=result.created_at if result.status.value == "completed" else None
        )
        
        return response
    
    except Exception as e:
        logger.error("Failed to execute manual enforcement action", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to execute manual enforcement action: {str(e)}")


@router.post("/actions/batch", response_model=BatchEnforcementResponse, status_code=201)
async def execute_batch_enforcement_actions(
    batch_data: BatchEnforcementRequest,
    enforcement_agent: EnforcementAgent = Depends(get_enforcement_agent)
):
    """
    Execute multiple enforcement actions in batch.
    
    This endpoint allows for efficient execution of multiple enforcement actions
    with a single API call. Actions are processed concurrently.
    """
    try:
        # Convert to enforcement requests
        requests = []
        for action_data in batch_data.actions:
            request = EnforcementRequest(
                product_id=action_data.product_id,
                action_type=action_data.action_type,
                authenticity_score=action_data.authenticity_score,
                confidence_score=action_data.confidence_score,
                reasoning=action_data.reasoning,
                priority_override=action_data.priority_override,
                supplier_id=action_data.supplier_id
            )
            requests.append(request)
        
        # Execute batch
        batch_result = await enforcement_agent.execute_batch_enforcement(requests)
        
        logger.info("Batch enforcement actions executed via API",
                   batch_id=batch_result.batch_id,
                   total_actions=batch_result.total_actions,
                   successful_actions=batch_result.successful_actions)
        
        # Convert results to response format
        action_responses = []
        for result in batch_result.results:
            response = EnforcementActionResponse(
                id=result.action_id,
                product_id=result.product_id,
                action_type=result.action_type,
                authenticity_score=result.authenticity_score,
                confidence_score=result.confidence_score,
                reasoning=result.reasoning,
                executed_by=result.executed_by,
                execution_status=result.status,
                platform_response=result.platform_response,
                appeal_status="none",
                created_at=result.created_at,
                completed_at=result.created_at if result.status.value == "completed" else None
            )
            action_responses.append(response)
        
        return BatchEnforcementResponse(
            batch_id=batch_result.batch_id,
            total_actions=batch_result.total_actions,
            successful_actions=batch_result.successful_actions,
            failed_actions=batch_result.failed_actions,
            pending_approval=batch_result.pending_approval,
            results=action_responses,
            processing_duration_ms=batch_result.processing_duration_ms,
            created_at=batch_result.created_at
        )
    
    except Exception as e:
        logger.error("Failed to execute batch enforcement actions", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to execute batch enforcement actions: {str(e)}")


@router.get("/actions", response_model=List[EnforcementActionResponse])
async def get_enforcement_actions(
    execution_status: Optional[str] = Query(None, description="Filter by execution status"),
    action_type: Optional[str] = Query(None, description="Filter by action type"),
    days_back: Optional[int] = Query(None, ge=1, le=365, description="Number of days to look back"),
    limit: int = Query(100, ge=1, le=1000, description="Maximum number of results"),
    offset: int = Query(0, ge=0, description="Number of results to skip"),
    repository: EnforcementRepository = Depends(get_enforcement_repository)
):
    """Get enforcement actions with optional filtering."""
    try:
        actions, total_count = await repository.get_enforcement_actions(
            execution_status=execution_status,
            action_type=action_type,
            days_back=days_back,
            limit=limit,
            offset=offset
        )
        
        # Convert to response format
        responses = []
        for action in actions:
            response = EnforcementActionResponse(
                id=action.id,
                product_id=action.product_id,
                rule_id=action.rule_id,
                action_type=action.action_type,
                authenticity_score=action.authenticity_score,
                confidence_score=float(action.confidence_score),
                reasoning=action.reasoning or "",
                executed_by=action.executed_by,
                execution_status=action.execution_status,
                platform_response=action.platform_response,
                appeal_status=action.appeal_status,
                created_at=action.created_at,
                completed_at=action.completed_at
            )
            responses.append(response)
        
        return responses
    
    except Exception as e:
        logger.error("Failed to get enforcement actions", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get enforcement actions: {str(e)}")


@router.get("/actions/{action_id}", response_model=EnforcementActionResponse)
async def get_enforcement_action(
    action_id: str,
    repository: EnforcementRepository = Depends(get_enforcement_repository)
):
    """Get a specific enforcement action by ID."""
    try:
        action = await repository.get_enforcement_action_by_id(action_id)
        if not action:
            raise HTTPException(status_code=404, detail="Enforcement action not found")
        
        response = EnforcementActionResponse(
            id=action.id,
            product_id=action.product_id,
            rule_id=action.rule_id,
            action_type=action.action_type,
            authenticity_score=action.authenticity_score,
            confidence_score=float(action.confidence_score),
            reasoning=action.reasoning or "",
            executed_by=action.executed_by,
            execution_status=action.execution_status,
            platform_response=action.platform_response,
            appeal_status=action.appeal_status,
            created_at=action.created_at,
            completed_at=action.completed_at
        )
        
        return response
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get enforcement action", error=str(e), action_id=action_id)
        raise HTTPException(status_code=500, detail=f"Failed to get enforcement action: {str(e)}")


@router.post("/actions/{action_id}/rollback", response_model=RollbackResponse)
async def rollback_enforcement_action(
    action_id: str,
    rollback_data: RollbackRequest,
    enforcement_agent: EnforcementAgent = Depends(get_enforcement_agent)
):
    """
    Rollback an enforcement action.
    
    This endpoint allows administrators to reverse a previously executed
    enforcement action when it was determined to be incorrect or unjustified.
    """
    try:
        success = await enforcement_agent.rollback_enforcement_action(
            action_id, rollback_data.reason
        )
        
        logger.info("Enforcement action rollback via API",
                   action_id=action_id,
                   success=success,
                   executed_by=rollback_data.executed_by)
        
        return RollbackResponse(
            action_id=action_id,
            rollback_successful=success,
            rollback_reason=rollback_data.reason
        )
    
    except Exception as e:
        logger.error("Failed to rollback enforcement action", error=str(e), action_id=action_id)
        raise HTTPException(status_code=500, detail=f"Failed to rollback enforcement action: {str(e)}")


# Action evaluation endpoint
@router.post("/evaluate", response_model=ActionEvaluationResponse)
async def evaluate_enforcement_action(
    evaluation_data: ActionEvaluationRequest,
    enforcement_agent: EnforcementAgent = Depends(get_enforcement_agent)
):
    """
    Evaluate what enforcement action should be taken for a product.
    
    This endpoint analyzes a product's authenticity score and other factors
    to recommend an appropriate enforcement action without executing it.
    """
    try:
        recommended_action = await enforcement_agent.evaluate_enforcement_action(
            product_id=evaluation_data.product_id,
            authenticity_score=evaluation_data.authenticity_score,
            confidence_score=evaluation_data.confidence_score,
            category=evaluation_data.category,
            supplier_id=evaluation_data.supplier_id
        )
        
        # Check if action requires approval
        enforcement_service = EnforcementService()
        requires_approval = await enforcement_service.requires_human_approval(
            action=recommended_action,
            authenticity_score=evaluation_data.authenticity_score,
            confidence_score=evaluation_data.confidence_score,
            category=evaluation_data.category
        )
        
        # Generate reasoning
        reasoning = f"Recommended {recommended_action.value} based on authenticity score {evaluation_data.authenticity_score}"
        if evaluation_data.category:
            reasoning += f" for {evaluation_data.category} category"
        
        response = ActionEvaluationResponse(
            product_id=evaluation_data.product_id,
            recommended_action=recommended_action,
            requires_approval=requires_approval,
            matching_rules=[],  # Would need rule matching logic
            reasoning=reasoning
        )
        
        return response
    
    except Exception as e:
        logger.error("Failed to evaluate enforcement action", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to evaluate enforcement action: {str(e)}")


# Statistics endpoints
@router.get("/statistics", response_model=EnforcementStatistics)
async def get_enforcement_statistics(
    days_back: int = Query(30, ge=1, le=365, description="Number of days to analyze"),
    category: Optional[str] = Query(None, description="Filter by product category"),
    action_type: Optional[str] = Query(None, description="Filter by action type"),
    repository: EnforcementRepository = Depends(get_enforcement_repository)
):
    """Get comprehensive enforcement statistics."""
    try:
        stats = await repository.get_enforcement_statistics(
            days_back=days_back,
            category=category,
            action_type=action_type
        )
        
        return EnforcementStatistics(**stats)
    
    except Exception as e:
        logger.error("Failed to get enforcement statistics", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get enforcement statistics: {str(e)}")


@router.get("/trends", response_model=EnforcementTrendsResponse)
async def get_enforcement_trends(
    days_back: int = Query(30, ge=1, le=365, description="Number of days to analyze"),
    repository: EnforcementRepository = Depends(get_enforcement_repository)
):
    """Get daily enforcement action trends."""
    try:
        trends = await repository.get_daily_enforcement_trends(days_back=days_back)
        
        return EnforcementTrendsResponse(
            trends=trends,
            period_days=days_back
        )
    
    except Exception as e:
        logger.error("Failed to get enforcement trends", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get enforcement trends: {str(e)}")


# Supplier reputation endpoint
@router.get("/suppliers/{supplier_id}/reputation", response_model=SupplierReputationResponse)
async def get_supplier_reputation(
    supplier_id: str,
    repository: EnforcementRepository = Depends(get_enforcement_repository)
):
    """Get supplier reputation information."""
    try:
        reputation = await repository.get_supplier_reputation(supplier_id)
        if not reputation:
            raise HTTPException(status_code=404, detail="Supplier reputation not found")
        
        response = SupplierReputationResponse(
            supplier_id=reputation.supplier_id,
            total_products=reputation.total_products,
            flagged_products=reputation.flagged_products,
            takedown_count=reputation.takedown_count,
            appeal_success_rate=float(reputation.appeal_success_rate),
            reputation_score=float(reputation.reputation_score),
            last_violation_date=reputation.last_violation_date,
            updated_at=reputation.updated_at
        )
        
        return response
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get supplier reputation", error=str(e), supplier_id=supplier_id)
        raise HTTPException(status_code=500, detail=f"Failed to get supplier reputation: {str(e)}")


# Health check endpoint
@router.get("/health")
async def enforcement_health_check(
    enforcement_agent: EnforcementAgent = Depends(get_enforcement_agent)
):
    """Check enforcement system health."""
    try:
        # Get agent statistics
        stats_message = await enforcement_agent.process_message(
            type("MockMessage", (), {
                "message_type": "get_enforcement_stats",
                "payload": {},
                "sender_id": "health-check"
            })()
        )
        
        return {
            "status": "healthy",
            "agent_status": enforcement_agent.status.value,
            "total_actions_executed": stats_message.result.get("total_actions_executed", 0),
            "uptime_seconds": stats_message.result.get("uptime_seconds", 0)
        }
    
    except Exception as e:
        logger.error("Enforcement health check failed", error=str(e))
        return {
            "status": "unhealthy",
            "error": str(e)
        }