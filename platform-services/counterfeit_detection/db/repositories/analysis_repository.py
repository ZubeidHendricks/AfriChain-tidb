"""
Repository for managing authenticity analysis results.
"""

import json
from typing import List, Optional, Dict, Any
from uuid import UUID
from decimal import Decimal
from datetime import datetime

from sqlalchemy import select, and_, or_, desc, func
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from ...models.database import AnalysisResult, Product
from ...models.enums import AnalysisStatus


class AnalysisRepository:
    """Repository for authenticity analysis operations."""
    
    def __init__(self, session: AsyncSession):
        self.session = session
        self.logger = structlog.get_logger(component="analysis_repository")
    
    async def create_analysis_result(self, analysis_data: Dict[str, Any]) -> AnalysisResult:
        """
        Create a new analysis result record.
        
        Args:
            analysis_data: Dictionary containing analysis result data
            
        Returns:
            Created AnalysisResult instance
        """
        try:
            # Convert ProductAnalysisResult to database format
            analysis_record = AnalysisResult(
                id=analysis_data.get("analysis_id"),
                product_id=analysis_data["product_id"],
                supplier_id=analysis_data.get("supplier_id"),  # Would be retrieved from product
                analysis_type="llm",
                status=AnalysisStatus.COMPLETED,
                authenticity_score=Decimal(str(analysis_data["authenticity_score"])) / 100,  # Convert 0-100 to 0-1
                confidence_score=Decimal(str(analysis_data["confidence_score"])),
                risk_factors=json.dumps(analysis_data.get("red_flags", [])),
                evidence=json.dumps({
                    "reasoning": analysis_data["reasoning"],
                    "positive_indicators": analysis_data.get("positive_indicators", []),
                    "component_scores": analysis_data.get("component_scores", {}),
                    "comparison_products": analysis_data.get("comparison_products", [])
                }),
                processing_time_ms=int(analysis_data["analysis_duration_ms"]),
                model_version=analysis_data.get("llm_model", "gpt-4"),
                agent_id=analysis_data["agent_id"],
                requires_manual_review=analysis_data["authenticity_score"] < 60.0  # Low scores need review
            )
            
            self.session.add(analysis_record)
            await self.session.flush()
            
            self.logger.info(
                "Analysis result created",
                analysis_id=str(analysis_record.id),
                product_id=str(analysis_record.product_id),
                authenticity_score=float(analysis_record.authenticity_score)
            )
            
            return analysis_record
            
        except Exception as e:
            self.logger.error(
                "Failed to create analysis result",
                error=str(e),
                product_id=analysis_data.get("product_id")
            )
            raise
    
    async def get_analysis_by_id(self, analysis_id: UUID) -> Optional[AnalysisResult]:
        """Get analysis result by ID."""
        try:
            query = select(AnalysisResult).where(AnalysisResult.id == analysis_id)
            result = await self.session.execute(query)
            return result.scalar_one_or_none()
            
        except Exception as e:
            self.logger.error("Failed to get analysis by ID", analysis_id=str(analysis_id), error=str(e))
            raise
    
    async def get_analyses_by_product(
        self, 
        product_id: UUID,
        limit: int = 10,
        analysis_type: Optional[str] = None
    ) -> List[AnalysisResult]:
        """Get analysis results for a specific product."""
        try:
            query = select(AnalysisResult).where(AnalysisResult.product_id == product_id)
            
            if analysis_type:
                query = query.where(AnalysisResult.analysis_type == analysis_type)
            
            query = query.order_by(desc(AnalysisResult.created_at)).limit(limit)
            
            result = await self.session.execute(query)
            return result.scalars().all()
            
        except Exception as e:
            self.logger.error(
                "Failed to get analyses by product",
                product_id=str(product_id),
                error=str(e)
            )
            raise
    
    async def get_latest_analysis(self, product_id: UUID) -> Optional[AnalysisResult]:
        """Get the most recent analysis result for a product."""
        try:
            query = (
                select(AnalysisResult)
                .where(AnalysisResult.product_id == product_id)
                .order_by(desc(AnalysisResult.created_at))
                .limit(1)
            )
            
            result = await self.session.execute(query)
            return result.scalar_one_or_none()
            
        except Exception as e:
            self.logger.error(
                "Failed to get latest analysis",
                product_id=str(product_id),
                error=str(e)
            )
            raise
    
    async def get_analyses_requiring_review(
        self,
        limit: int = 50,
        offset: int = 0
    ) -> List[AnalysisResult]:
        """Get analysis results that require manual review."""
        try:
            query = (
                select(AnalysisResult)
                .where(
                    and_(
                        AnalysisResult.requires_manual_review == True,
                        AnalysisResult.reviewed_at.is_(None)
                    )
                )
                .order_by(desc(AnalysisResult.created_at))
                .offset(offset)
                .limit(limit)
            )
            
            result = await self.session.execute(query)
            return result.scalars().all()
            
        except Exception as e:
            self.logger.error("Failed to get analyses requiring review", error=str(e))
            raise
    
    async def get_low_confidence_analyses(
        self,
        confidence_threshold: float = 0.7,
        limit: int = 50
    ) -> List[AnalysisResult]:
        """Get analysis results with low confidence scores."""
        try:
            query = (
                select(AnalysisResult)
                .where(AnalysisResult.confidence_score < confidence_threshold)
                .order_by(AnalysisResult.confidence_score)
                .limit(limit)
            )
            
            result = await self.session.execute(query)
            return result.scalars().all()
            
        except Exception as e:
            self.logger.error("Failed to get low confidence analyses", error=str(e))
            raise
    
    async def get_suspicious_products(
        self,
        authenticity_threshold: float = 0.6,
        limit: int = 100
    ) -> List[AnalysisResult]:
        """Get products with low authenticity scores."""
        try:
            query = (
                select(AnalysisResult)
                .where(AnalysisResult.authenticity_score < authenticity_threshold)
                .order_by(AnalysisResult.authenticity_score)
                .limit(limit)
            )
            
            result = await self.session.execute(query)
            return result.scalars().all()
            
        except Exception as e:
            self.logger.error("Failed to get suspicious products", error=str(e))
            raise
    
    async def update_analysis_review(
        self,
        analysis_id: UUID,
        reviewer: str,
        notes: str,
        requires_further_review: bool = False
    ) -> bool:
        """Update analysis with manual review information."""
        try:
            query = select(AnalysisResult).where(AnalysisResult.id == analysis_id)
            result = await self.session.execute(query)
            analysis = result.scalar_one_or_none()
            
            if not analysis:
                return False
            
            analysis.manual_review_notes = notes
            analysis.reviewed_by = reviewer
            analysis.reviewed_at = datetime.utcnow()
            analysis.requires_manual_review = requires_further_review
            
            await self.session.flush()
            
            self.logger.info(
                "Analysis review updated",
                analysis_id=str(analysis_id),
                reviewer=reviewer,
                requires_further_review=requires_further_review
            )
            
            return True
            
        except Exception as e:
            self.logger.error(
                "Failed to update analysis review",
                analysis_id=str(analysis_id),
                error=str(e)
            )
            raise
    
    async def get_analysis_statistics(self) -> Dict[str, Any]:
        """Get comprehensive analysis statistics."""
        try:
            # Total analyses
            total_query = select(func.count(AnalysisResult.id))
            total_result = await self.session.execute(total_query)
            total_analyses = total_result.scalar()
            
            # Analyses by status
            status_query = (
                select(
                    AnalysisResult.status,
                    func.count(AnalysisResult.id).label('count')
                )
                .group_by(AnalysisResult.status)
            )
            status_result = await self.session.execute(status_query)
            status_counts = {row.status.value: row.count for row in status_result}
            
            # Average scores
            avg_query = select(
                func.avg(AnalysisResult.authenticity_score).label('avg_authenticity'),
                func.avg(AnalysisResult.confidence_score).label('avg_confidence'),
                func.avg(AnalysisResult.processing_time_ms).label('avg_processing_time')
            )
            avg_result = await self.session.execute(avg_query)
            avg_row = avg_result.first()
            
            # Analyses requiring review
            review_query = select(func.count(AnalysisResult.id)).where(
                AnalysisResult.requires_manual_review == True
            )
            review_result = await self.session.execute(review_query)
            requiring_review = review_result.scalar()
            
            # Suspicious products (low authenticity)
            suspicious_query = select(func.count(AnalysisResult.id)).where(
                AnalysisResult.authenticity_score < 0.6
            )
            suspicious_result = await self.session.execute(suspicious_query)
            suspicious_count = suspicious_result.scalar()
            
            # Recent analyses (last 24 hours)
            recent_query = select(func.count(AnalysisResult.id)).where(
                AnalysisResult.created_at >= func.date_sub(func.now(), func.literal("INTERVAL 1 DAY"))
            )
            recent_result = await self.session.execute(recent_query)
            recent_count = recent_result.scalar()
            
            stats = {
                "total_analyses": total_analyses,
                "status_breakdown": status_counts,
                "average_authenticity_score": float(avg_row.avg_authenticity) if avg_row.avg_authenticity else 0.0,
                "average_confidence_score": float(avg_row.avg_confidence) if avg_row.avg_confidence else 0.0,
                "average_processing_time_ms": float(avg_row.avg_processing_time) if avg_row.avg_processing_time else 0.0,
                "requiring_manual_review": requiring_review,
                "suspicious_products": suspicious_count,
                "recent_analyses_24h": recent_count,
                "suspicious_percentage": (suspicious_count / total_analyses * 100) if total_analyses > 0 else 0.0,
                "review_required_percentage": (requiring_review / total_analyses * 100) if total_analyses > 0 else 0.0
            }
            
            self.logger.info("Analysis statistics retrieved", **stats)
            return stats
            
        except Exception as e:
            self.logger.error("Failed to get analysis statistics", error=str(e))
            raise
    
    async def get_agent_performance_stats(self) -> Dict[str, Any]:
        """Get performance statistics by agent."""
        try:
            agent_stats_query = (
                select(
                    AnalysisResult.agent_id,
                    func.count(AnalysisResult.id).label('total_analyses'),
                    func.avg(AnalysisResult.authenticity_score).label('avg_authenticity'),
                    func.avg(AnalysisResult.confidence_score).label('avg_confidence'),
                    func.avg(AnalysisResult.processing_time_ms).label('avg_processing_time'),
                    func.sum(
                        func.case(
                            (AnalysisResult.requires_manual_review == True, 1),
                            else_=0
                        )
                    ).label('manual_review_count')
                )
                .group_by(AnalysisResult.agent_id)
            )
            
            result = await self.session.execute(agent_stats_query)
            
            agent_stats = {}
            for row in result:
                agent_stats[row.agent_id] = {
                    "total_analyses": row.total_analyses,
                    "average_authenticity_score": float(row.avg_authenticity) if row.avg_authenticity else 0.0,
                    "average_confidence_score": float(row.avg_confidence) if row.avg_confidence else 0.0,
                    "average_processing_time_ms": float(row.avg_processing_time) if row.avg_processing_time else 0.0,
                    "manual_review_count": row.manual_review_count,
                    "manual_review_rate": (row.manual_review_count / row.total_analyses * 100) if row.total_analyses > 0 else 0.0
                }
            
            return agent_stats
            
        except Exception as e:
            self.logger.error("Failed to get agent performance stats", error=str(e))
            raise
    
    async def delete_analysis(self, analysis_id: UUID) -> bool:
        """Delete an analysis result."""
        try:
            query = select(AnalysisResult).where(AnalysisResult.id == analysis_id)
            result = await self.session.execute(query)
            analysis = result.scalar_one_or_none()
            
            if not analysis:
                return False
            
            await self.session.delete(analysis)
            await self.session.flush()
            
            self.logger.info("Analysis deleted", analysis_id=str(analysis_id))
            return True
            
        except Exception as e:
            self.logger.error("Failed to delete analysis", analysis_id=str(analysis_id), error=str(e))
            raise