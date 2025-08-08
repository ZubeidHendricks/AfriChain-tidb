"""
API endpoints for authenticity analysis operations.
"""

import json
from typing import List, Optional, Dict, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from fastapi import status
import structlog

from ..schemas.analysis import (
    AnalysisRequest,
    AnalysisResponse,
    BatchAnalysisRequest,
    BatchAnalysisResponse,
    AnalysisStatistics,
    AgentPerformanceStats
)
from ...agents.authenticity_analyzer import AuthenticityAnalyzer
from ...db.repositories.analysis_repository import AnalysisRepository
from ...db.repositories.product_repository import ProductRepository
from ...models.enums import AnalysisStatus
from ...core.database import get_db_session

router = APIRouter(prefix="/analysis", tags=["authenticity-analysis"])
logger = structlog.get_logger(module=__name__)


def get_analysis_repository(
    db_session=Depends(get_db_session)
) -> AnalysisRepository:
    """Dependency to get analysis repository."""
    return AnalysisRepository(db_session)


def get_product_repository(
    db_session=Depends(get_db_session)
) -> ProductRepository:
    """Dependency to get product repository."""
    return ProductRepository(db_session)


async def get_authenticity_analyzer() -> AuthenticityAnalyzer:
    """Dependency to get authenticity analyzer agent."""
    # In a full implementation, this would get the agent from a registry
    # For now, create a new instance
    analyzer = AuthenticityAnalyzer()
    await analyzer.start()
    return analyzer


@router.post("/analyze", response_model=AnalysisResponse)
async def analyze_product_authenticity(
    request: AnalysisRequest,
    background_tasks: BackgroundTasks,
    analysis_repo: AnalysisRepository = Depends(get_analysis_repository),
    product_repo: ProductRepository = Depends(get_product_repository)
):
    """
    Trigger authenticity analysis for a specific product.
    
    This endpoint starts an asynchronous analysis process and returns immediately.
    The analysis results can be retrieved using the get_analysis endpoint.
    """
    try:
        logger.info("Analysis requested", product_id=str(request.product_id))
        
        # Verify product exists
        product = await product_repo.get_product_by_id(request.product_id)
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Product with ID {request.product_id} not found"
            )
        
        # Check if recent analysis exists
        if not request.force_reanalysis:
            recent_analysis = await analysis_repo.get_latest_analysis(request.product_id)
            if recent_analysis and recent_analysis.status == AnalysisStatus.COMPLETED:
                # Return existing analysis if recent enough (within 24 hours)
                from datetime import datetime, timedelta
                if recent_analysis.created_at > datetime.utcnow() - timedelta(hours=24):
                    return AnalysisResponse(
                        analysis_id=str(recent_analysis.id),
                        product_id=str(recent_analysis.product_id),
                        status="completed",
                        authenticity_score=float(recent_analysis.authenticity_score) * 100,  # Convert to 0-100
                        confidence_score=float(recent_analysis.confidence_score),
                        message="Using existing recent analysis",
                        analysis_duration_ms=float(recent_analysis.processing_time_ms),
                        created_at=recent_analysis.created_at.isoformat()
                    )
        
        # Queue analysis task
        background_tasks.add_task(
            perform_analysis_task,
            str(request.product_id),
            request.analysis_options
        )
        
        return AnalysisResponse(
            analysis_id="pending",  # Will be generated when analysis starts
            product_id=str(request.product_id),
            status="queued",
            message="Analysis queued for processing",
            analysis_duration_ms=0.0
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to queue analysis", product_id=str(request.product_id), error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to queue analysis: {str(e)}"
        )


@router.post("/analyze/batch", response_model=BatchAnalysisResponse)
async def analyze_products_batch(
    request: BatchAnalysisRequest,
    background_tasks: BackgroundTasks,
    product_repo: ProductRepository = Depends(get_product_repository)
):
    """
    Trigger batch authenticity analysis for multiple products.
    
    This endpoint queues multiple products for analysis and returns immediately.
    Individual results can be retrieved using the get_analysis endpoint.
    """
    try:
        logger.info("Batch analysis requested", product_count=len(request.product_ids))
        
        # Verify all products exist
        valid_product_ids = []
        invalid_product_ids = []
        
        for product_id in request.product_ids:
            product = await product_repo.get_product_by_id(product_id)
            if product:
                valid_product_ids.append(product_id)
            else:
                invalid_product_ids.append(product_id)
        
        # Queue analysis tasks for valid products
        for product_id in valid_product_ids:
            background_tasks.add_task(
                perform_analysis_task,
                str(product_id),
                request.analysis_options
            )
        
        return BatchAnalysisResponse(
            batch_id="batch-" + str(UUID.uuid4()),
            total_requested=len(request.product_ids),
            queued_count=len(valid_product_ids),
            invalid_product_ids=[str(pid) for pid in invalid_product_ids],
            status="queued",
            message=f"Queued {len(valid_product_ids)} products for analysis"
        )
        
    except Exception as e:
        logger.error("Failed to queue batch analysis", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to queue batch analysis: {str(e)}"
        )


@router.get("/result/{analysis_id}", response_model=AnalysisResponse)
async def get_analysis_result(
    analysis_id: UUID,
    analysis_repo: AnalysisRepository = Depends(get_analysis_repository)
):
    """Get the results of a specific analysis by ID."""
    try:
        analysis = await analysis_repo.get_analysis_by_id(analysis_id)
        if not analysis:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Analysis with ID {analysis_id} not found"
            )
        
        # Parse evidence JSON to extract detailed information
        evidence = {}
        if analysis.evidence:
            import json
            try:
                evidence = json.loads(analysis.evidence)
            except json.JSONDecodeError:
                logger.warning("Failed to parse analysis evidence JSON", analysis_id=str(analysis_id))
        
        risk_factors = []
        if analysis.risk_factors:
            try:
                risk_factors = json.loads(analysis.risk_factors)
            except json.JSONDecodeError:
                logger.warning("Failed to parse risk factors JSON", analysis_id=str(analysis_id))
        
        return AnalysisResponse(
            analysis_id=str(analysis.id),
            product_id=str(analysis.product_id),
            status=analysis.status.value,
            authenticity_score=float(analysis.authenticity_score) * 100 if analysis.authenticity_score else None,
            confidence_score=float(analysis.confidence_score) if analysis.confidence_score else None,
            reasoning=evidence.get("reasoning", ""),
            red_flags=risk_factors,
            positive_indicators=evidence.get("positive_indicators", []),
            component_scores=evidence.get("component_scores", {}),
            comparison_products=evidence.get("comparison_products", []),
            analysis_duration_ms=float(analysis.processing_time_ms) if analysis.processing_time_ms else 0.0,
            llm_model=analysis.model_version,
            agent_id=analysis.agent_id,
            requires_manual_review=analysis.requires_manual_review,
            created_at=analysis.created_at.isoformat() if analysis.created_at else None,
            message="Analysis completed successfully"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get analysis result", analysis_id=str(analysis_id), error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve analysis result: {str(e)}"
        )


@router.get("/product/{product_id}/analyses")
async def get_product_analyses(
    product_id: UUID,
    limit: int = Query(10, ge=1, le=50),
    analysis_type: Optional[str] = Query(None),
    analysis_repo: AnalysisRepository = Depends(get_analysis_repository)
):
    """Get all analysis results for a specific product."""
    try:
        analyses = await analysis_repo.get_analyses_by_product(
            product_id, limit=limit, analysis_type=analysis_type
        )
        
        results = []
        for analysis in analyses:
            evidence = {}
            if analysis.evidence:
                try:
                    evidence = json.loads(analysis.evidence)
                except json.JSONDecodeError:
                    pass
            
            risk_factors = []
            if analysis.risk_factors:
                try:
                    risk_factors = json.loads(analysis.risk_factors)
                except json.JSONDecodeError:
                    pass
            
            results.append({
                "analysis_id": str(analysis.id),
                "analysis_type": analysis.analysis_type,
                "status": analysis.status.value,
                "authenticity_score": float(analysis.authenticity_score) * 100 if analysis.authenticity_score else None,
                "confidence_score": float(analysis.confidence_score) if analysis.confidence_score else None,
                "reasoning": evidence.get("reasoning", ""),
                "red_flags": risk_factors,
                "analysis_duration_ms": float(analysis.processing_time_ms) if analysis.processing_time_ms else 0.0,
                "agent_id": analysis.agent_id,
                "requires_manual_review": analysis.requires_manual_review,
                "created_at": analysis.created_at.isoformat() if analysis.created_at else None
            })
        
        return {
            "product_id": str(product_id),
            "analyses": results,
            "total_count": len(results)
        }
        
    except Exception as e:
        logger.error("Failed to get product analyses", product_id=str(product_id), error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve product analyses: {str(e)}"
        )


@router.get("/review/required")
async def get_analyses_requiring_review(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    analysis_repo: AnalysisRepository = Depends(get_analysis_repository)
):
    """Get analysis results that require manual review."""
    try:
        analyses = await analysis_repo.get_analyses_requiring_review(
            limit=limit, offset=offset
        )
        
        results = []
        for analysis in analyses:
            evidence = {}
            if analysis.evidence:
                try:
                    evidence = json.loads(analysis.evidence)
                except json.JSONDecodeError:
                    pass
            
            results.append({
                "analysis_id": str(analysis.id),
                "product_id": str(analysis.product_id),
                "authenticity_score": float(analysis.authenticity_score) * 100 if analysis.authenticity_score else None,
                "confidence_score": float(analysis.confidence_score) if analysis.confidence_score else None,
                "reasoning": evidence.get("reasoning", ""),
                "created_at": analysis.created_at.isoformat() if analysis.created_at else None,
                "priority": "high" if analysis.authenticity_score and analysis.authenticity_score < 0.4 else "medium"
            })
        
        return {
            "analyses_requiring_review": results,
            "total_count": len(results),
            "has_more": len(results) == limit
        }
        
    except Exception as e:
        logger.error("Failed to get analyses requiring review", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve analyses requiring review: {str(e)}"
        )


@router.get("/stats", response_model=AnalysisStatistics)
async def get_analysis_statistics(
    analysis_repo: AnalysisRepository = Depends(get_analysis_repository)
):
    """Get comprehensive analysis statistics."""
    try:
        stats = await analysis_repo.get_analysis_statistics()
        
        return AnalysisStatistics(
            total_analyses=stats["total_analyses"],
            status_breakdown=stats["status_breakdown"],
            average_authenticity_score=stats["average_authenticity_score"],
            average_confidence_score=stats["average_confidence_score"],
            average_processing_time_ms=stats["average_processing_time_ms"],
            requiring_manual_review=stats["requiring_manual_review"],
            suspicious_products=stats["suspicious_products"],
            recent_analyses_24h=stats["recent_analyses_24h"],
            suspicious_percentage=stats["suspicious_percentage"],
            review_required_percentage=stats["review_required_percentage"]
        )
        
    except Exception as e:
        logger.error("Failed to get analysis statistics", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve analysis statistics: {str(e)}"
        )


@router.get("/agents/performance", response_model=AgentPerformanceStats)
async def get_agent_performance_stats(
    analysis_repo: AnalysisRepository = Depends(get_analysis_repository)
):
    """Get performance statistics for authenticity analysis agents."""
    try:
        agent_stats = await analysis_repo.get_agent_performance_stats()
        
        return AgentPerformanceStats(
            agent_statistics=agent_stats,
            total_agents=len(agent_stats)
        )
        
    except Exception as e:
        logger.error("Failed to get agent performance stats", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve agent performance statistics: {str(e)}"
        )


@router.put("/result/{analysis_id}/review")
async def update_analysis_review(
    analysis_id: UUID,
    reviewer: str = Query(..., description="Name/ID of the reviewer"),
    notes: str = Query(..., description="Review notes"),
    requires_further_review: bool = Query(False, description="Whether further review is needed"),
    analysis_repo: AnalysisRepository = Depends(get_analysis_repository)
):
    """Update an analysis with manual review information."""
    try:
        success = await analysis_repo.update_analysis_review(
            analysis_id, reviewer, notes, requires_further_review
        )
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Analysis with ID {analysis_id} not found"
            )
        
        return {
            "message": "Analysis review updated successfully",
            "analysis_id": str(analysis_id),
            "reviewer": reviewer,
            "requires_further_review": requires_further_review
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to update analysis review", analysis_id=str(analysis_id), error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update analysis review: {str(e)}"
        )


async def perform_analysis_task(product_id: str, analysis_options: Optional[Dict[str, Any]] = None):
    """Background task to perform authenticity analysis."""
    try:
        logger.info("Starting background analysis task", product_id=product_id)
        
        # Create and start analyzer agent
        analyzer = AuthenticityAnalyzer()
        await analyzer.start()
        
        try:
            # Perform analysis
            result = await analyzer.analyze_product_authenticity(product_id)
            
            logger.info(
                "Background analysis completed",
                product_id=product_id,
                analysis_id=result.analysis_id,
                authenticity_score=result.authenticity_score
            )
            
        finally:
            # Clean up agent
            await analyzer.stop()
            
    except Exception as e:
        logger.error("Background analysis task failed", product_id=product_id, error=str(e))
        # In a production system, this would update the analysis status to failed