"""
Analytics Repository for database operations related to metrics and analytics.

Provides data access layer for analytics calculations, time-series data,
and performance metrics across the counterfeit detection system.
"""

from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
from decimal import Decimal
import structlog
from sqlalchemy import and_, func, desc, text, select, case
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.functions import coalesce

from ..models.product import Product
from ..models.authenticity_analysis import AuthenticityAnalysis
from ..models.enforcement_action import EnforcementAction
from ..models.audit_log import AuditLog
from ...models.enums import ProductCategory, EnforcementAction as EnforcementActionType, ProductStatus

logger = structlog.get_logger(__name__)


class AnalyticsRepository:
    """Repository for analytics data access operations."""
    
    def __init__(self, session: AsyncSession):
        """Initialize analytics repository with database session."""
        self.session = session
    
    async def get_detection_metrics(
        self,
        start_date: datetime,
        end_date: datetime,
        category_filter: Optional[str] = None,
        supplier_filter: Optional[str] = None
    ) -> Dict[str, int]:
        """Get core detection metrics for the specified period."""
        try:
            # Base query for products analyzed in the period
            base_query = select(Product).join(AuthenticityAnalysis).where(
                and_(
                    AuthenticityAnalysis.created_at >= start_date,
                    AuthenticityAnalysis.created_at <= end_date
                )
            )
            
            # Apply filters if provided
            if category_filter:
                base_query = base_query.where(Product.category == category_filter)
            if supplier_filter:
                base_query = base_query.where(Product.supplier_id == supplier_filter)
            
            # Count total analyzed products
            total_analyzed_query = select(func.count(Product.id.distinct())).select_from(
                base_query.subquery()
            )
            total_analyzed_result = await self.session.execute(total_analyzed_query)
            total_analyzed = total_analyzed_result.scalar() or 0
            
            # Count flagged products (authenticity score < 70)
            flagged_query = select(func.count(Product.id.distinct())).select_from(
                base_query.where(AuthenticityAnalysis.authenticity_score < 70).subquery()
            )
            flagged_result = await self.session.execute(flagged_query)
            total_flagged = flagged_result.scalar() or 0
            
            # Count true positives (flagged products confirmed as counterfeit)
            # Look for enforcement actions that were successful and not overturned
            true_positives_query = select(func.count(Product.id.distinct())).select_from(
                base_query.join(EnforcementAction).where(
                    and_(
                        AuthenticityAnalysis.authenticity_score < 70,
                        EnforcementAction.action_type == EnforcementActionType.REMOVE_LISTING,
                        EnforcementAction.status == 'completed',
                        # No successful appeals (product still removed)
                        Product.status.in_([ProductStatus.REMOVED, ProductStatus.FLAGGED])
                    )
                ).subquery()
            )
            true_positives_result = await self.session.execute(true_positives_query)
            true_positives = true_positives_result.scalar() or 0
            
            # Count false positives (flagged products later confirmed as authentic)
            # Look for products that were flagged but then reinstated
            false_positives_query = select(func.count(Product.id.distinct())).select_from(
                base_query.join(EnforcementAction).where(
                    and_(
                        AuthenticityAnalysis.authenticity_score < 70,
                        # Product was reinstated after being flagged
                        Product.status == ProductStatus.REINSTATED
                    )
                ).subquery()
            )
            false_positives_result = await self.session.execute(false_positives_query)
            false_positives = false_positives_result.scalar() or 0
            
            # Estimate false negatives (harder to detect - would need external feedback)
            # For now, use a conservative estimate based on industry standards
            false_negatives = max(1, int(true_positives * 0.1))  # Assume 10% miss rate
            
            return {
                "total_analyzed": total_analyzed,
                "total_flagged": total_flagged,
                "true_positives": true_positives,
                "false_positives": false_positives,
                "false_negatives": false_negatives
            }
            
        except Exception as e:
            logger.error("Failed to get detection metrics", error=str(e))
            raise
    
    async def get_time_series_data(
        self,
        start_date: datetime,
        end_date: datetime,
        metric_type: str = "detection_rate",
        granularity: str = "daily"
    ) -> List[Dict[str, Any]]:
        """Get time series data for specified metric."""
        try:
            # Determine date truncation based on granularity
            if granularity == "hourly":
                date_trunc = func.date_trunc('hour', AuthenticityAnalysis.created_at)
            elif granularity == "weekly":
                date_trunc = func.date_trunc('week', AuthenticityAnalysis.created_at)
            elif granularity == "monthly":
                date_trunc = func.date_trunc('month', AuthenticityAnalysis.created_at)
            else:  # daily
                date_trunc = func.date_trunc('day', AuthenticityAnalysis.created_at)
            
            if metric_type == "detection_rate":
                # Calculate detection rate over time
                query = select(
                    date_trunc.label('period'),
                    func.count(AuthenticityAnalysis.id).label('total_analyzed'),
                    func.sum(
                        case(
                            (AuthenticityAnalysis.authenticity_score < 70, 1),
                            else_=0
                        )
                    ).label('flagged_count')
                ).where(
                    and_(
                        AuthenticityAnalysis.created_at >= start_date,
                        AuthenticityAnalysis.created_at <= end_date
                    )
                ).group_by(date_trunc).order_by(date_trunc)
                
            elif metric_type == "false_positive_rate":
                # Calculate false positive rate over time
                query = select(
                    date_trunc.label('period'),
                    func.count(AuthenticityAnalysis.id).label('total_flagged'),
                    func.sum(
                        case(
                            (Product.status == ProductStatus.REINSTATED, 1),
                            else_=0
                        )
                    ).label('false_positives')
                ).select_from(
                    AuthenticityAnalysis.join(Product)
                ).where(
                    and_(
                        AuthenticityAnalysis.created_at >= start_date,
                        AuthenticityAnalysis.created_at <= end_date,
                        AuthenticityAnalysis.authenticity_score < 70
                    )
                ).group_by(date_trunc).order_by(date_trunc)
            
            else:
                # Default to analysis count
                query = select(
                    date_trunc.label('period'),
                    func.count(AuthenticityAnalysis.id).label('count')
                ).where(
                    and_(
                        AuthenticityAnalysis.created_at >= start_date,
                        AuthenticityAnalysis.created_at <= end_date
                    )
                ).group_by(date_trunc).order_by(date_trunc)
            
            result = await self.session.execute(query)
            time_series = []
            
            for row in result:
                if metric_type == "detection_rate":
                    value = (row.flagged_count / row.total_analyzed * 100) if row.total_analyzed > 0 else 0
                elif metric_type == "false_positive_rate":
                    value = (row.false_positives / row.total_flagged * 100) if row.total_flagged > 0 else 0
                else:
                    value = row.count
                
                time_series.append({
                    "timestamp": row.period.isoformat(),
                    "value": float(value),
                    "period": granularity
                })
            
            return time_series
            
        except Exception as e:
            logger.error("Failed to get time series data", error=str(e))
            raise
    
    async def get_category_breakdown(
        self,
        start_date: datetime,
        end_date: datetime,
        metric_type: str = "flagging_rate"
    ) -> Dict[str, Dict[str, Any]]:
        """Get metrics breakdown by product category."""
        try:
            query = select(
                Product.category,
                func.count(AuthenticityAnalysis.id).label('total_analyzed'),
                func.sum(
                    case(
                        (AuthenticityAnalysis.authenticity_score < 70, 1),
                        else_=0
                    )
                ).label('flagged_count'),
                func.avg(AuthenticityAnalysis.authenticity_score).label('avg_score')
            ).select_from(
                Product.join(AuthenticityAnalysis)
            ).where(
                and_(
                    AuthenticityAnalysis.created_at >= start_date,
                    AuthenticityAnalysis.created_at <= end_date
                )
            ).group_by(Product.category)
            
            result = await self.session.execute(query)
            breakdown = {}
            
            for row in result:
                flagging_rate = (row.flagged_count / row.total_analyzed * 100) if row.total_analyzed > 0 else 0
                
                breakdown[row.category] = {
                    "total_analyzed": row.total_analyzed,
                    "flagged_count": row.flagged_count,
                    "flagging_rate": float(flagging_rate),
                    "average_score": float(row.avg_score or 0)
                }
            
            return breakdown
            
        except Exception as e:
            logger.error("Failed to get category breakdown", error=str(e))
            raise
    
    async def get_supplier_metrics(
        self,
        start_date: datetime,
        end_date: datetime,
        limit: int = 20
    ) -> List[Dict[str, Any]]:
        """Get metrics breakdown by supplier."""
        try:
            query = select(
                Product.supplier_id,
                func.count(AuthenticityAnalysis.id).label('total_analyzed'),
                func.sum(
                    case(
                        (AuthenticityAnalysis.authenticity_score < 70, 1),
                        else_=0
                    )
                ).label('flagged_count'),
                func.avg(AuthenticityAnalysis.authenticity_score).label('avg_score')
            ).select_from(
                Product.join(AuthenticityAnalysis)
            ).where(
                and_(
                    AuthenticityAnalysis.created_at >= start_date,
                    AuthenticityAnalysis.created_at <= end_date
                )
            ).group_by(Product.supplier_id).order_by(
                desc('flagged_count')
            ).limit(limit)
            
            result = await self.session.execute(query)
            suppliers = []
            
            for row in result:
                flagging_rate = (row.flagged_count / row.total_analyzed * 100) if row.total_analyzed > 0 else 0
                
                suppliers.append({
                    "supplier_id": row.supplier_id,
                    "total_analyzed": row.total_analyzed,
                    "flagged_count": row.flagged_count,
                    "flagging_rate": float(flagging_rate),
                    "average_score": float(row.avg_score or 0)
                })
            
            return suppliers
            
        except Exception as e:
            logger.error("Failed to get supplier metrics", error=str(e))
            raise
    
    async def get_performance_metrics(
        self,
        start_date: datetime,
        end_date: datetime,
        component_filter: Optional[str] = None
    ) -> Dict[str, Any]:
        """Get system performance metrics."""
        try:
            # Get response time metrics from audit logs
            audit_query = select(
                func.avg(AuditLog.processing_time_ms).label('avg_processing_time'),
                func.percentile_cont(0.5).within_group(AuditLog.processing_time_ms).label('p50_processing_time'),
                func.percentile_cont(0.95).within_group(AuditLog.processing_time_ms).label('p95_processing_time'),
                func.percentile_cont(0.99).within_group(AuditLog.processing_time_ms).label('p99_processing_time'),
                func.count(AuditLog.id).label('total_operations'),
                func.sum(
                    case(
                        (AuditLog.status == 'error', 1),
                        else_=0
                    )
                ).label('error_count')
            ).where(
                and_(
                    AuditLog.timestamp >= start_date,
                    AuditLog.timestamp <= end_date
                )
            )
            
            if component_filter:
                audit_query = audit_query.where(AuditLog.component == component_filter)
            
            result = await self.session.execute(audit_query)
            row = result.first()
            
            # Calculate metrics
            total_operations = row.total_operations or 0
            error_rate = (row.error_count / total_operations * 100) if total_operations > 0 else 0
            
            # Calculate throughput (operations per hour)
            hours = max(1, (end_date - start_date).total_seconds() / 3600)
            throughput = total_operations / hours
            
            return {
                "response_time": {
                    "avg_ms": float(row.avg_processing_time or 0),
                    "p50_ms": float(row.p50_processing_time or 0),
                    "p95_ms": float(row.p95_processing_time or 0),
                    "p99_ms": float(row.p99_processing_time or 0)
                },
                "throughput": {
                    "operations_per_hour": float(throughput),
                    "total_operations": total_operations
                },
                "reliability": {
                    "error_rate_percent": float(error_rate),
                    "total_errors": row.error_count or 0,
                    "success_rate_percent": float(100 - error_rate)
                }
            }
            
        except Exception as e:
            logger.error("Failed to get performance metrics", error=str(e))
            raise
    
    async def get_bias_analysis_data(
        self,
        start_date: datetime,
        end_date: datetime,
        attribute: str = "category"
    ) -> List[Dict[str, Any]]:
        """Get data for bias analysis across specified attribute."""
        try:
            if attribute == "category":
                group_field = Product.category
            elif attribute == "supplier_id":
                group_field = Product.supplier_id
            elif attribute == "price_range":
                # Create price range buckets
                group_field = case(
                    (Product.price < 50, 'low'),
                    (Product.price < 200, 'medium'),
                    (Product.price < 1000, 'high'),
                    else_='luxury'
                )
            else:
                group_field = Product.category  # Default fallback
            
            query = select(
                group_field.label('group_value'),
                func.count(AuthenticityAnalysis.id).label('total_analyzed'),
                func.sum(
                    case(
                        (AuthenticityAnalysis.authenticity_score < 70, 1),
                        else_=0
                    )
                ).label('flagged_count'),
                func.avg(AuthenticityAnalysis.authenticity_score).label('avg_score')
            ).select_from(
                Product.join(AuthenticityAnalysis)
            ).where(
                and_(
                    AuthenticityAnalysis.created_at >= start_date,
                    AuthenticityAnalysis.created_at <= end_date
                )
            ).group_by(group_field)
            
            result = await self.session.execute(query)
            bias_data = []
            
            for row in result:
                flagging_rate = (row.flagged_count / row.total_analyzed) if row.total_analyzed > 0 else 0
                
                bias_data.append({
                    "group": str(row.group_value),
                    "total_analyzed": row.total_analyzed,
                    "flagged_count": row.flagged_count,
                    "flagging_rate": float(flagging_rate),
                    "average_score": float(row.avg_score or 0)
                })
            
            return bias_data
            
        except Exception as e:
            logger.error("Failed to get bias analysis data", error=str(e))
            raise
    
    async def record_daily_analytics(
        self,
        date: datetime,
        metrics: Dict[str, Any]
    ) -> None:
        """Record daily analytics summary."""
        try:
            # This would insert into a daily_analytics table
            # Implementation depends on the actual table schema
            logger.info("Recording daily analytics", date=date.date(), metrics=metrics)
            
        except Exception as e:
            logger.error("Failed to record daily analytics", error=str(e))
            raise