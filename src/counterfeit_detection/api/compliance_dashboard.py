"""
Enterprise Compliance Dashboard API for zkSNARK proof verification and audit monitoring.

Provides comprehensive REST API endpoints for compliance officers to monitor
cryptographic verification status, audit trails, and regulatory compliance metrics.
"""

import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Path, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import structlog
from sqlalchemy import select, and_, func, desc, asc
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db_session
from ..core.auth import get_current_user, require_roles
from ..models.zkproof import ZKProof, ZKProofCircuit, ProofType, VerificationStatus
from ..models.audit_proof import AuditProof, AuditEntry, ComplianceReport, TimestampStatus
from ..models.brand import Brand, VerificationStatus as BrandVerificationStatus
from ..models.product import Product
from ..services.audit_trail_service import AuditTrailService
from ..services.zkproof_service import ZKProofService
from ..services.proof_verification_cache import ProofVerificationCache

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/api/v1/compliance", tags=["Enterprise Compliance"])


# Request/Response Models

class ComplianceOverviewResponse(BaseModel):
    """Overall compliance status overview."""
    period_start: datetime
    period_end: datetime
    total_products_monitored: int
    verified_products: int
    zkproof_coverage_percentage: float
    audit_trail_coverage_percentage: float
    blockchain_anchored_percentage: float
    compliance_score: float
    risk_indicators: List[str]
    last_updated: datetime


class ZKProofVerificationStatus(BaseModel):
    """zkSNARK proof verification status."""
    proof_id: str
    entity_id: str
    entity_type: str
    proof_type: str
    verification_status: str
    is_valid: bool
    generated_at: datetime
    verified_at: Optional[datetime]
    circuit_name: str
    verification_details: Dict[str, Any]
    blockchain_anchored: bool
    timestamp_verified: bool


class AuditTrailStatus(BaseModel):
    """Audit trail status for entities."""
    entity_id: str
    entity_type: str
    total_audit_entries: int
    verified_entries: int
    latest_audit_timestamp: datetime
    merkle_root_hash: str
    blockchain_anchor_tx: Optional[str]
    integrity_score: float


class ComplianceReportSummary(BaseModel):
    """Summary of compliance reports."""
    report_id: str
    report_type: str
    period_start: datetime
    period_end: datetime
    compliance_score: float
    risk_score: float
    generated_at: datetime
    generated_by: str
    total_products: int
    verified_products: int


class RealTimeMetrics(BaseModel):
    """Real-time compliance metrics."""
    timestamp: datetime
    active_verifications: int
    verification_queue_size: int
    cache_hit_rate: float
    average_verification_time_ms: float
    proof_generation_rate_per_hour: int
    audit_entries_per_hour: int
    compliance_violations_count: int


# API Endpoints

@router.get("/overview", response_model=ComplianceOverviewResponse)
async def get_compliance_overview(
    period_days: int = Query(30, description="Period in days to analyze"),
    session: AsyncSession = Depends(get_db_session),
    current_user = Depends(require_roles(["compliance_officer", "admin"]))
):
    """
    Get comprehensive compliance overview for the specified period.
    
    Provides high-level metrics including zkSNARK verification coverage,
    audit trail completeness, and overall compliance scoring.
    """
    try:
        period_end = datetime.utcnow()
        period_start = period_end - timedelta(days=period_days)
        
        # Get total products monitored
        products_query = select(func.count(Product.id)).where(
            and_(
                Product.created_at >= period_start,
                Product.created_at <= period_end
            )
        )
        products_result = await session.execute(products_query)
        total_products = products_result.scalar() or 0
        
        # Get verified products (those with valid zkSNARK proofs)
        verified_query = select(func.count(func.distinct(ZKProof.entity_id))).where(
            and_(
                ZKProof.generated_at >= period_start,
                ZKProof.generated_at <= period_end,
                ZKProof.verification_status == VerificationStatus.VALID,
                ZKProof.proof_type == ProofType.PRODUCT_AUTHENTICITY
            )
        )
        verified_result = await session.execute(verified_query)
        verified_products = verified_result.scalar() or 0
        
        # Calculate zkSNARK coverage
        zkproof_coverage = (verified_products / max(1, total_products)) * 100
        
        # Get audit trail statistics
        audit_entries_query = select(func.count(AuditEntry.id)).where(
            and_(
                AuditEntry.event_timestamp >= period_start,
                AuditEntry.event_timestamp <= period_end
            )
        )
        audit_entries_result = await session.execute(audit_entries_query)
        total_audit_entries = audit_entries_result.scalar() or 0
        
        # Get blockchain anchored audit entries
        anchored_query = select(func.count(AuditEntry.id)).join(AuditProof).where(
            and_(
                AuditEntry.event_timestamp >= period_start,
                AuditEntry.event_timestamp <= period_end,
                AuditProof.blockchain_anchor_tx.isnot(None)
            )
        )
        anchored_result = await session.execute(anchored_query)
        anchored_entries = anchored_result.scalar() or 0
        
        # Calculate coverage percentages
        audit_coverage = min(100.0, (total_audit_entries / max(1, total_products * 10)) * 100)
        blockchain_coverage = (anchored_entries / max(1, total_audit_entries)) * 100
        
        # Calculate overall compliance score
        compliance_score = (
            zkproof_coverage * 0.4 +
            audit_coverage * 0.3 +
            blockchain_coverage * 0.3
        )
        
        # Identify risk indicators
        risk_indicators = []
        if zkproof_coverage < 80:
            risk_indicators.append("Low zkSNARK proof coverage")
        if audit_coverage < 90:
            risk_indicators.append("Insufficient audit trail coverage")
        if blockchain_coverage < 85:
            risk_indicators.append("Limited blockchain anchoring")
        if verified_products < total_products * 0.75:
            risk_indicators.append("High number of unverified products")
        
        return ComplianceOverviewResponse(
            period_start=period_start,
            period_end=period_end,
            total_products_monitored=total_products,
            verified_products=verified_products,
            zkproof_coverage_percentage=zkproof_coverage,
            audit_trail_coverage_percentage=audit_coverage,
            blockchain_anchored_percentage=blockchain_coverage,
            compliance_score=compliance_score,
            risk_indicators=risk_indicators,
            last_updated=datetime.utcnow()
        )
        
    except Exception as e:
        logger.error("Failed to get compliance overview", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get compliance overview: {str(e)}")


@router.get("/zkproof-status", response_model=List[ZKProofVerificationStatus])
async def get_zkproof_verification_status(
    entity_type: Optional[str] = Query(None, description="Filter by entity type"),
    verification_status: Optional[str] = Query(None, description="Filter by verification status"),
    limit: int = Query(100, description="Maximum number of results"),
    offset: int = Query(0, description="Offset for pagination"),
    session: AsyncSession = Depends(get_db_session),
    current_user = Depends(require_roles(["compliance_officer", "admin"]))
):
    """
    Get zkSNARK proof verification status for all monitored entities.
    
    Provides detailed verification status including proof validity,
    blockchain anchoring, and timestamp verification.
    """
    try:
        # Build query
        query = select(ZKProof).join(ZKProofCircuit, ZKProof.circuit_id == ZKProofCircuit.id)
        
        if entity_type:
            # In a real implementation, you'd have entity_type in the ZKProof table
            pass  # Filter would be applied here
        
        if verification_status:
            query = query.where(ZKProof.verification_status == verification_status)
        
        query = query.order_by(desc(ZKProof.generated_at)).limit(limit).offset(offset)
        
        result = await session.execute(query)
        proofs = result.scalars().all()
        
        # Get audit proofs for blockchain/timestamp status
        proof_ids = [proof.id for proof in proofs]
        audit_proofs_query = select(AuditProof).where(
            AuditProof.audit_data_hash.in_([p.proof_hash for p in proofs])
        )
        audit_result = await session.execute(audit_proofs_query)
        audit_proofs = {ap.audit_data_hash: ap for ap in audit_result.scalars().all()}
        
        verification_statuses = []
        for proof in proofs:
            audit_proof = audit_proofs.get(proof.proof_hash)
            
            verification_statuses.append(ZKProofVerificationStatus(
                proof_id=proof.id,
                entity_id=proof.entity_id,
                entity_type="product",  # Inferred from proof type
                proof_type=proof.proof_type.value,
                verification_status=proof.verification_status.value,
                is_valid=proof.verification_status == VerificationStatus.VALID,
                generated_at=proof.generated_at,
                verified_at=proof.verified_at,
                circuit_name=proof.circuit_id,  # Would be joined from circuit table
                verification_details=proof.verification_details,
                blockchain_anchored=bool(audit_proof and audit_proof.blockchain_anchor_tx),
                timestamp_verified=bool(audit_proof and audit_proof.timestamp_status == TimestampStatus.CONFIRMED)
            ))
        
        return verification_statuses
        
    except Exception as e:
        logger.error("Failed to get zkSNARK verification status", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get verification status: {str(e)}")


@router.get("/audit-trail-status", response_model=List[AuditTrailStatus])
async def get_audit_trail_status(
    entity_id: Optional[str] = Query(None, description="Filter by entity ID"),
    entity_type: Optional[str] = Query(None, description="Filter by entity type"),
    limit: int = Query(100, description="Maximum number of results"),
    session: AsyncSession = Depends(get_db_session),
    current_user = Depends(require_roles(["compliance_officer", "admin"]))
):
    """
    Get audit trail status for monitored entities.
    
    Shows audit coverage, Merkle tree verification status,
    and blockchain anchoring information.
    """
    try:
        # Get audit entries grouped by entity
        query = select(
            AuditEntry.entity_id,
            AuditEntry.entity_type,
            func.count(AuditEntry.id).label("total_entries"),
            func.max(AuditEntry.event_timestamp).label("latest_timestamp")
        ).group_by(AuditEntry.entity_id, AuditEntry.entity_type)
        
        if entity_id:
            query = query.where(AuditEntry.entity_id == entity_id)
        if entity_type:
            query = query.where(AuditEntry.entity_type == entity_type)
        
        query = query.limit(limit)
        
        result = await session.execute(query)
        audit_summaries = result.all()
        
        audit_statuses = []
        for summary in audit_summaries:
            # Get latest audit proof for this entity
            latest_proof_query = select(AuditProof).join(AuditEntry).where(
                and_(
                    AuditEntry.entity_id == summary.entity_id,
                    AuditEntry.entity_type == summary.entity_type
                )
            ).order_by(desc(AuditProof.proof_generation_time)).limit(1)
            
            proof_result = await session.execute(latest_proof_query)
            latest_proof = proof_result.scalar_one_or_none()
            
            # Count verified entries (those in audit proofs)
            verified_query = select(func.count(AuditEntry.id)).join(AuditProof).where(
                and_(
                    AuditEntry.entity_id == summary.entity_id,
                    AuditEntry.entity_type == summary.entity_type,
                    AuditProof.verification_count > 0
                )
            )
            verified_result = await session.execute(verified_query)
            verified_entries = verified_result.scalar() or 0
            
            # Calculate integrity score
            integrity_score = (verified_entries / max(1, summary.total_entries)) * 100
            
            audit_statuses.append(AuditTrailStatus(
                entity_id=summary.entity_id,
                entity_type=summary.entity_type,
                total_audit_entries=summary.total_entries,
                verified_entries=verified_entries,
                latest_audit_timestamp=summary.latest_timestamp,
                merkle_root_hash=latest_proof.merkle_root if latest_proof else "",
                blockchain_anchor_tx=latest_proof.blockchain_anchor_tx if latest_proof else None,
                integrity_score=integrity_score
            ))
        
        return audit_statuses
        
    except Exception as e:
        logger.error("Failed to get audit trail status", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get audit trail status: {str(e)}")


@router.get("/reports", response_model=List[ComplianceReportSummary])
async def get_compliance_reports(
    report_type: Optional[str] = Query(None, description="Filter by report type"),
    limit: int = Query(50, description="Maximum number of results"),
    session: AsyncSession = Depends(get_db_session),
    current_user = Depends(require_roles(["compliance_officer", "admin"]))
):
    """
    Get list of generated compliance reports.
    
    Returns summary information about all compliance reports
    with filtering and pagination support.
    """
    try:
        query = select(ComplianceReport)
        
        if report_type:
            query = query.where(ComplianceReport.report_type == report_type)
        
        query = query.order_by(desc(ComplianceReport.generated_at)).limit(limit)
        
        result = await session.execute(query)
        reports = result.scalars().all()
        
        report_summaries = []
        for report in reports:
            report_summaries.append(ComplianceReportSummary(
                report_id=report.id,
                report_type=report.report_type,
                period_start=report.report_period_start,
                period_end=report.report_period_end,
                compliance_score=report.compliance_score,
                risk_score=report.risk_score,
                generated_at=report.generated_at,
                generated_by=report.generated_by,
                total_products=report.total_products_verified + report.zkproof_verified_count,  # Approximation
                verified_products=report.zkproof_verified_count
            ))
        
        return report_summaries
        
    except Exception as e:
        logger.error("Failed to get compliance reports", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get compliance reports: {str(e)}")


@router.get("/real-time-metrics", response_model=RealTimeMetrics)
async def get_real_time_metrics(
    current_user = Depends(require_roles(["compliance_officer", "admin"]))
):
    """
    Get real-time compliance and verification metrics.
    
    Provides live metrics including verification queue status,
    cache performance, and compliance violation tracking.
    """
    try:
        # Get metrics from proof verification cache
        cache = ProofVerificationCache()
        cache_stats = await cache.get_cache_statistics()
        
        # Get audit trail service
        audit_service = AuditTrailService()
        
        # Calculate recent activity rates
        current_time = datetime.utcnow()
        one_hour_ago = current_time - timedelta(hours=1)
        
        async with get_db_session() as session:
            # Get proof generation rate
            recent_proofs_query = select(func.count(ZKProof.id)).where(
                ZKProof.generated_at >= one_hour_ago
            )
            recent_proofs_result = await session.execute(recent_proofs_query)
            proofs_per_hour = recent_proofs_result.scalar() or 0
            
            # Get audit entries rate
            recent_audits_query = select(func.count(AuditEntry.id)).where(
                AuditEntry.event_timestamp >= one_hour_ago
            )
            recent_audits_result = await session.execute(recent_audits_query)
            audits_per_hour = recent_audits_result.scalar() or 0
            
            # Get compliance violations (failed verifications)
            violations_query = select(func.count(ZKProof.id)).where(
                and_(
                    ZKProof.generated_at >= one_hour_ago,
                    ZKProof.verification_status == VerificationStatus.INVALID
                )
            )
            violations_result = await session.execute(violations_query)
            violations_count = violations_result.scalar() or 0
        
        performance_metrics = cache_stats.get("performance_metrics", {})
        
        return RealTimeMetrics(
            timestamp=current_time,
            active_verifications=0,  # Would track from cache service
            verification_queue_size=cache_stats.get("batch_processing", {}).get("queue_size", 0),
            cache_hit_rate=performance_metrics.get("cache_hit_rate", 0.0),
            average_verification_time_ms=performance_metrics.get("average_verification_time_ms", 0.0),
            proof_generation_rate_per_hour=proofs_per_hour,
            audit_entries_per_hour=audits_per_hour,
            compliance_violations_count=violations_count
        )
        
    except Exception as e:
        logger.error("Failed to get real-time metrics", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get real-time metrics: {str(e)}")


@router.post("/reports/generate")
async def generate_compliance_report(
    period_start: datetime,
    period_end: datetime,
    report_type: str = "regulatory",
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_db_session),
    current_user = Depends(require_roles(["compliance_officer", "admin"]))
):
    """
    Generate a new compliance report for the specified period.
    
    Initiates background report generation and returns report ID
    for tracking progress.
    """
    try:
        audit_service = AuditTrailService()
        
        # Start background report generation
        def generate_report_background():
            asyncio.create_task(
                audit_service.generate_compliance_report(
                    period_start=period_start,
                    period_end=period_end,
                    report_type=report_type
                )
            )
        
        background_tasks.add_task(generate_report_background)
        
        # Return immediate response
        return {
            "message": "Compliance report generation started",
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
            "report_type": report_type,
            "initiated_by": current_user.get("user_id", "unknown"),
            "initiated_at": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error("Failed to generate compliance report", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to generate compliance report: {str(e)}")


@router.get("/verification-cache/stats")
async def get_verification_cache_stats(
    current_user = Depends(require_roles(["compliance_officer", "admin"]))
):
    """
    Get detailed statistics about the proof verification cache performance.
    
    Provides insights into cache hit rates, performance metrics,
    and optimization opportunities.
    """
    try:
        cache = ProofVerificationCache()
        stats = await cache.get_cache_statistics()
        
        return {
            "cache_statistics": stats,
            "recommendations": _generate_cache_recommendations(stats),
            "retrieved_at": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error("Failed to get verification cache stats", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get cache stats: {str(e)}")


@router.post("/verification-cache/clear")
async def clear_verification_cache(
    cache_type: str = Query("memory", description="Type of cache to clear: memory, redis, circuits, all"),
    current_user = Depends(require_roles(["admin"]))
):
    """
    Clear verification cache (admin only).
    
    Allows administrators to clear various cache types
    for maintenance or troubleshooting purposes.
    """
    try:
        cache = ProofVerificationCache()
        success = await cache.clear_cache(cache_type)
        
        if success:
            return {
                "message": f"Cache {cache_type} cleared successfully",
                "cleared_by": current_user.get("user_id", "unknown"),
                "cleared_at": datetime.utcnow().isoformat()
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to clear cache")
        
    except Exception as e:
        logger.error("Failed to clear verification cache", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to clear cache: {str(e)}")


# Helper functions

def _generate_cache_recommendations(stats: Dict[str, Any]) -> List[str]:
    """Generate cache optimization recommendations based on statistics."""
    recommendations = []
    
    performance_metrics = stats.get("performance_metrics", {})
    cache_status = stats.get("cache_status", {})
    
    hit_rate = performance_metrics.get("cache_hit_rate", 0)
    if hit_rate < 70:
        recommendations.append("Consider increasing cache TTL or cache size to improve hit rate")
    
    avg_time = performance_metrics.get("average_verification_time_ms", 0)
    if avg_time > 1000:
        recommendations.append("Average verification time is high - consider circuit optimization")
    
    memory_usage = cache_status.get("memory_cache_size", 0)
    max_memory = cache_status.get("memory_cache_max_size", 1)
    if memory_usage / max_memory > 0.8:
        recommendations.append("Memory cache is near capacity - consider increasing cache size")
    
    if performance_metrics.get("total_requests", 0) > 1000 and hit_rate > 90:
        recommendations.append("Cache is performing well - current configuration is optimal")
    
    return recommendations