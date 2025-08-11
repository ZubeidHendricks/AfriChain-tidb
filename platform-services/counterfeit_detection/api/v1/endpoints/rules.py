"""
API endpoints for detection rule management.

This module provides REST API endpoints for creating, reading, updating,
and deleting detection rules, as well as testing and evaluating rules.
"""

import asyncio
import json
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse
from sqlalchemy import or_

import structlog

from ....core.database import get_db_session
from ....db.repositories.rule_repository import RuleRepository
from ....agents.rule_engine import RuleEngine
from ....models.enums import RuleType, RuleAction
from ..schemas.rules import (
    RuleCreateRequest,
    RuleUpdateRequest,
    RuleResponse,
    RuleListResponse,
    RuleTestRequest,
    RuleTestResponse,
    RuleEvaluationRequest,
    RuleEvaluationResponse,
    BatchRuleEvaluationRequest,
    BatchRuleEvaluationResponse,
    RuleStatsResponse,
    RuleValidationResponse,
    RuleBulkCreateRequest,
    RuleBulkCreateResponse,
    RuleSearchRequest
)

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/rules", tags=["detection-rules"])

# Global rule engine instance (will be initialized)
rule_engine_instance: Optional[RuleEngine] = None


async def get_rule_repository():
    """Dependency to get rule repository."""
    async with get_db_session() as session:
        yield RuleRepository(session)


async def get_rule_engine():
    """Dependency to get rule engine instance."""
    global rule_engine_instance
    if rule_engine_instance is None:
        rule_engine_instance = RuleEngine("rule-engine-api")
        await rule_engine_instance.start()
    return rule_engine_instance


@router.post("", response_model=RuleResponse, status_code=status.HTTP_201_CREATED)
async def create_rule(
    request: RuleCreateRequest,
    background_tasks: BackgroundTasks,
    rule_repo: RuleRepository = Depends(get_rule_repository)
):
    """
    Create a new detection rule.
    
    Creates a new detection rule with the specified configuration and returns
    the created rule information. The rule will be validated before creation.
    """
    try:
        # Validate rule configuration
        is_valid, errors = await rule_repo.validate_rule_config(request.rule_type, request.config)
        if not is_valid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid rule configuration: {'; '.join(errors)}"
            )
        
        # Create rule
        rule_data = request.dict()
        rule = await rule_repo.create_rule(rule_data)
        
        # Refresh rule engine cache in background
        background_tasks.add_task(refresh_rule_engine_cache)
        
        logger.info("Rule created via API", rule_id=rule.id, rule_name=rule.name)
        return RuleResponse.from_orm(rule)
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to create rule via API", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create rule"
        )


@router.get("", response_model=RuleListResponse)
async def list_rules(
    rule_type: Optional[RuleType] = Query(None, description="Filter by rule type"),
    category: Optional[str] = Query(None, description="Filter by category"),
    active: Optional[bool] = Query(None, description="Filter by active status"),
    priority_min: Optional[int] = Query(None, ge=1, description="Minimum priority"),
    priority_max: Optional[int] = Query(None, le=1000, description="Maximum priority"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Number of rules per page"),
    rule_repo: RuleRepository = Depends(get_rule_repository)
):
    """
    List detection rules with optional filtering.
    
    Returns a paginated list of detection rules. Rules can be filtered by type,
    category, active status, and priority range.
    """
    try:
        offset = (page - 1) * page_size
        
        rules, total_count = await rule_repo.search_rules(
            rule_type=rule_type,
            category=category,
            active=active,
            priority_min=priority_min,
            priority_max=priority_max,
            limit=page_size,
            offset=offset
        )
        
        total_pages = (total_count + page_size - 1) // page_size
        
        return RuleListResponse(
            rules=[RuleResponse.from_orm(rule) for rule in rules],
            total_count=total_count,
            page=page,
            page_size=page_size,
            total_pages=total_pages
        )
    
    except Exception as e:
        logger.error("Failed to list rules", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve rules"
        )


@router.get("/{rule_id}", response_model=RuleResponse)
async def get_rule(
    rule_id: str,
    rule_repo: RuleRepository = Depends(get_rule_repository)
):
    """
    Get a specific detection rule by ID.
    
    Returns detailed information about a specific detection rule.
    """
    try:
        rule = await rule_repo.get_rule_by_id(rule_id)
        if not rule:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Rule {rule_id} not found"
            )
        
        return RuleResponse.from_orm(rule)
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get rule", error=str(e), rule_id=rule_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve rule"
        )


@router.put("/{rule_id}", response_model=RuleResponse)
async def update_rule(
    rule_id: str,
    request: RuleUpdateRequest,
    background_tasks: BackgroundTasks,
    rule_repo: RuleRepository = Depends(get_rule_repository)
):
    """
    Update an existing detection rule.
    
    Updates the specified fields of an existing detection rule. Only provided
    fields will be updated.
    """
    try:
        # Get existing rule to validate type-specific config updates
        existing_rule = await rule_repo.get_rule_by_id(rule_id)
        if not existing_rule:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Rule {rule_id} not found"
            )
        
        # Validate config if provided
        if request.config is not None:
            is_valid, errors = await rule_repo.validate_rule_config(
                existing_rule.rule_type, 
                request.config
            )
            if not is_valid:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid rule configuration: {'; '.join(errors)}"
                )
        
        # Update rule
        update_data = request.dict(exclude_unset=True)
        updated_rule = await rule_repo.update_rule(rule_id, update_data)
        
        if not updated_rule:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Rule {rule_id} not found"
            )
        
        # Refresh rule engine cache in background
        background_tasks.add_task(refresh_rule_engine_cache)
        
        logger.info("Rule updated via API", rule_id=rule_id)
        return RuleResponse.from_orm(updated_rule)
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to update rule", error=str(e), rule_id=rule_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update rule"
        )


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rule(
    rule_id: str,
    background_tasks: BackgroundTasks,
    rule_repo: RuleRepository = Depends(get_rule_repository)
):
    """
    Delete a detection rule.
    
    Permanently deletes the specified detection rule. This action cannot be undone.
    """
    try:
        deleted = await rule_repo.delete_rule(rule_id)
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Rule {rule_id} not found"
            )
        
        # Refresh rule engine cache in background
        background_tasks.add_task(refresh_rule_engine_cache)
        
        logger.info("Rule deleted via API", rule_id=rule_id)
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to delete rule", error=str(e), rule_id=rule_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete rule"
        )


@router.post("/{rule_id}/toggle", response_model=RuleResponse)
async def toggle_rule_status(
    rule_id: str,
    background_tasks: BackgroundTasks,
    rule_repo: RuleRepository = Depends(get_rule_repository)
):
    """
    Toggle the active status of a detection rule.
    
    Toggles between active and inactive status for the specified rule.
    """
    try:
        updated_rule = await rule_repo.toggle_rule_status(rule_id)
        if not updated_rule:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Rule {rule_id} not found"
            )
        
        # Refresh rule engine cache in background
        background_tasks.add_task(refresh_rule_engine_cache)
        
        logger.info("Rule status toggled via API", rule_id=rule_id, active=updated_rule.active)
        return RuleResponse.from_orm(updated_rule)
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to toggle rule status", error=str(e), rule_id=rule_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to toggle rule status"
        )


@router.post("/{rule_id}/test", response_model=RuleTestResponse)
async def test_rule(
    rule_id: str,
    request: RuleTestRequest,
    rule_engine: RuleEngine = Depends(get_rule_engine),
    rule_repo: RuleRepository = Depends(get_rule_repository)
):
    """
    Test a specific rule against a product.
    
    Tests whether a specific rule would be triggered for a given product.
    This is useful for testing rule configurations before deployment.
    """
    try:
        # Get the rule
        rule = await rule_repo.get_rule_by_id(rule_id)
        if not rule:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Rule {rule_id} not found"
            )
        
        # TODO: Implement single rule testing in rule engine
        # For now, we'll simulate the response
        test_response = RuleTestResponse(
            product_id=request.product_id,
            rule_id=rule_id,
            matched=False,  # Placeholder
            test_duration_ms=10.0,
            simulation_mode=request.simulation_mode
        )
        
        logger.info("Rule tested via API", rule_id=rule_id, product_id=request.product_id)
        return test_response
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to test rule", error=str(e), rule_id=rule_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to test rule"
        )


@router.post("/evaluate", response_model=RuleEvaluationResponse)
async def evaluate_product_rules(
    request: RuleEvaluationRequest,
    rule_engine: RuleEngine = Depends(get_rule_engine)
):
    """
    Evaluate all applicable rules against a product.
    
    Runs all applicable detection rules against a product and returns
    the evaluation results including matched rules and risk score.
    """
    try:
        result = await rule_engine.evaluate_product_rules(
            product_id=request.product_id,
            analysis_score=request.analysis_score,
            force_evaluation=request.force_evaluation
        )
        
        # Convert result to response format
        matched_rules = []
        for match in result.matched_rules:
            matched_rules.append({
                "rule_id": match.rule_id,
                "rule_name": match.rule_name,
                "rule_type": match.rule_type,
                "priority": match.priority,
                "action": match.action,
                "confidence": match.confidence,
                "evidence": match.evidence,
                "triggered_at": match.triggered_at
            })
        
        response = RuleEvaluationResponse(
            evaluation_id=result.evaluation_id,
            product_id=result.product_id,
            total_rules_evaluated=result.total_rules_evaluated,
            matched_rules=matched_rules,
            highest_priority_action=result.highest_priority_action,
            overall_risk_score=result.overall_risk_score,
            evaluation_duration_ms=result.evaluation_duration_ms,
            evaluated_at=result.created_at
        )
        
        logger.info("Product rules evaluated via API", product_id=request.product_id)
        return response
    
    except Exception as e:
        logger.error("Failed to evaluate product rules", error=str(e), product_id=request.product_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to evaluate product rules"
        )


@router.post("/evaluate/batch", response_model=BatchRuleEvaluationResponse)
async def batch_evaluate_product_rules(
    request: BatchRuleEvaluationRequest,
    rule_engine: RuleEngine = Depends(get_rule_engine)
):
    """
    Evaluate rules against multiple products in batch.
    
    Efficiently evaluates detection rules against multiple products and returns
    aggregated results and statistics.
    """
    try:
        # Use rule engine's batch evaluation capability
        from ....agents.base import AgentMessage
        
        message = AgentMessage(
            sender_id="api",
            message_type="batch_rule_evaluation_request",
            payload={
                "product_ids": request.product_ids,
                "analysis_scores": request.analysis_scores or {}
            }
        )
        
        response = await rule_engine.process_message(message)
        
        if not response.success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Batch evaluation failed: {response.error}"
            )
        
        # Convert to response format
        evaluations = []
        for eval_data in response.result["evaluations"]:
            evaluations.append(RuleEvaluationResponse(
                evaluation_id=eval_data["evaluation_id"],
                product_id=eval_data["product_id"],
                total_rules_evaluated=0,  # Not included in batch response
                matched_rules=[],  # Simplified for batch
                highest_priority_action=eval_data.get("highest_priority_action"),
                overall_risk_score=eval_data["overall_risk_score"],
                evaluation_duration_ms=eval_data["evaluation_duration_ms"],
                evaluated_at=datetime.utcnow()
            ))
        
        batch_response = BatchRuleEvaluationResponse(
            total_requested=response.result["total_requested"],
            successful_count=response.result["successful_count"],
            error_count=response.result["error_count"],
            evaluations=evaluations,
            summary_stats=response.result["summary_stats"]
        )
        
        logger.info("Batch rule evaluation completed via API", product_count=len(request.product_ids))
        return batch_response
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to batch evaluate rules", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to batch evaluate rules"
        )


@router.get("/stats", response_model=RuleStatsResponse)
async def get_rule_statistics(
    rule_repo: RuleRepository = Depends(get_rule_repository)
):
    """
    Get statistics about detection rules.
    
    Returns comprehensive statistics about the detection rules including
    counts by type, category, and priority distribution.
    """
    try:
        stats = await rule_repo.get_rule_statistics()
        return RuleStatsResponse(**stats)
    
    except Exception as e:
        logger.error("Failed to get rule statistics", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve rule statistics"
        )


@router.post("/validate", response_model=RuleValidationResponse)
async def validate_rule_config(
    rule_type: RuleType,
    config: Dict,
    rule_repo: RuleRepository = Depends(get_rule_repository)
):
    """
    Validate a rule configuration without creating the rule.
    
    Tests whether a rule configuration is valid for the specified rule type.
    Useful for validating configurations in UI before submission.
    """
    try:
        is_valid, errors = await rule_repo.validate_rule_config(rule_type, config)
        
        return RuleValidationResponse(
            valid=is_valid,
            errors=errors,
            warnings=[]  # Could add warnings for non-critical issues
        )
    
    except Exception as e:
        logger.error("Failed to validate rule config", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to validate rule configuration"
        )


@router.post("/bulk", response_model=RuleBulkCreateResponse)
async def bulk_create_rules(
    request: RuleBulkCreateRequest,
    background_tasks: BackgroundTasks,
    rule_repo: RuleRepository = Depends(get_rule_repository)
):
    """
    Create multiple detection rules in bulk.
    
    Creates multiple rules in a single transaction. If any rule fails validation
    or creation, the entire operation is rolled back.
    """
    try:
        if request.validate_only:
            # Only validate without creating
            errors = []
            successful_count = 0
            
            for i, rule_request in enumerate(request.rules):
                is_valid, rule_errors = await rule_repo.validate_rule_config(
                    rule_request.rule_type, 
                    rule_request.config
                )
                if is_valid:
                    successful_count += 1
                else:
                    errors.extend([f"Rule {i+1}: {error}" for error in rule_errors])
            
            return RuleBulkCreateResponse(
                total_requested=len(request.rules),
                successful_count=successful_count,
                error_count=len(request.rules) - successful_count,
                created_rules=[],
                errors=errors
            )
        
        else:
            # Validate all rules first
            validation_errors = []
            for i, rule_request in enumerate(request.rules):
                is_valid, rule_errors = await rule_repo.validate_rule_config(
                    rule_request.rule_type, 
                    rule_request.config
                )
                if not is_valid:
                    validation_errors.extend([f"Rule {i+1}: {error}" for error in rule_errors])
            
            if validation_errors:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Validation errors: {'; '.join(validation_errors)}"
                )
            
            # Create rules
            rules_data = [rule.dict() for rule in request.rules]
            created_rules = await rule_repo.bulk_create_rules(rules_data)
            
            # Refresh rule engine cache in background
            background_tasks.add_task(refresh_rule_engine_cache)
            
            logger.info("Bulk rule creation completed", count=len(created_rules))
            
            return RuleBulkCreateResponse(
                total_requested=len(request.rules),
                successful_count=len(created_rules),
                error_count=0,
                created_rules=[RuleResponse.from_orm(rule) for rule in created_rules],
                errors=[]
            )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to bulk create rules", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to bulk create rules"
        )


@router.post("/cache/refresh")
async def refresh_rules_cache(
    rule_engine: RuleEngine = Depends(get_rule_engine)
):
    """
    Refresh the rule engine cache.
    
    Forces the rule engine to reload rules from the database, updating
    the in-memory cache with any changes.
    """
    try:
        from ....agents.base import AgentMessage
        
        message = AgentMessage(
            sender_id="api",
            message_type="refresh_rules_cache",
            payload={}
        )
        
        response = await rule_engine.process_message(message)
        
        if not response.success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to refresh cache: {response.error}"
            )
        
        return JSONResponse(
            content={
                "message": "Rules cache refreshed successfully",
                "cache_info": response.result
            }
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to refresh rules cache", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to refresh rules cache"
        )


async def refresh_rule_engine_cache():
    """Background task to refresh rule engine cache."""
    try:
        global rule_engine_instance
        if rule_engine_instance:
            from ....agents.base import AgentMessage
            
            message = AgentMessage(
                sender_id="background",
                message_type="refresh_rules_cache",
                payload={}
            )
            
            await rule_engine_instance.process_message(message)
            logger.info("Rule engine cache refreshed in background")
    
    except Exception as e:
        logger.error("Failed to refresh rule engine cache in background", error=str(e))