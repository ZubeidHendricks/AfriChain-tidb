"""
Brand Protection Service for enhanced counterfeit detection using verified brand data.

Implements brand-specific detection rules, priority flagging for verified brands,
and enhanced monitoring for official product catalog comparisons.
"""

import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
from decimal import Decimal

import structlog
from sqlalchemy import and_, func, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db_session
from ..models.brand import Brand, VerificationStatus
from ..models.brand_product import BrandProduct, ApprovalStatus
from ..models.product import Product
from ..models.authenticity_analysis import AuthenticityAnalysis
from ..models.enforcement_action import EnforcementAction
from ..models.enums import ProductCategory, EnforcementAction as EnforcementActionType
from ..services.vector_search_service import VectorSearchService
from ..services.notification_service import NotificationService

logger = structlog.get_logger(__name__)


@dataclass
class BrandDetectionRule:
    """Custom detection rule configuration for a brand."""
    brand_id: str
    rule_name: str
    rule_type: str  # 'similarity', 'price', 'seller', 'trademark'
    threshold: float
    priority_level: int
    enabled: bool
    rule_parameters: Dict[str, Any]


@dataclass
class BrandViolationAlert:
    """Alert for potential brand violation."""
    brand_id: str
    brand_name: str
    product_id: str
    violation_type: str
    severity: str  # 'low', 'medium', 'high', 'critical'
    confidence_score: float
    evidence: Dict[str, Any]
    recommended_action: str


@dataclass
class BrandMonitoringResult:
    """Result of brand monitoring scan."""
    brand_id: str
    scan_timestamp: datetime
    products_scanned: int
    violations_found: int
    new_violations: int
    alerts_sent: int
    processing_time_seconds: float


class BrandProtectionService:
    """Service for brand-specific counterfeit detection and protection."""
    
    def __init__(self):
        """Initialize brand protection service."""
        self.vector_search_service: Optional[VectorSearchService] = None
        self.notification_service: Optional[NotificationService] = None
        
        # Default detection rules for verified brands
        self.default_brand_rules = {
            "high_similarity_threshold": {
                "threshold": 0.95,
                "priority_level": 3,
                "description": "High similarity to official products"
            },
            "unauthorized_seller": {
                "threshold": 1.0,
                "priority_level": 2,
                "description": "Seller not in authorized distributor list"
            },
            "price_deviation": {
                "threshold": 0.3,  # 30% price deviation
                "priority_level": 2,
                "description": "Significant price deviation from official pricing"
            },
            "trademark_violation": {
                "threshold": 0.8,
                "priority_level": 3,
                "description": "Potential trademark violation"
            }
        }
    
    async def enhance_product_analysis(
        self,
        product: Product,
        base_authenticity_score: float
    ) -> Tuple[float, Dict[str, Any]]:
        """
        Enhance product analysis using verified brand data.
        
        Args:
            product: Product being analyzed
            base_authenticity_score: Base authenticity score from general analysis
            
        Returns:
            Tuple of (enhanced_score, brand_analysis_details)
        """
        try:
            async with get_db_session() as session:
                # Find matching verified brand products
                brand_matches = await self._find_brand_product_matches(session, product)
                
                if not brand_matches:
                    # No brand matches found, return base score
                    return base_authenticity_score, {"brand_matches": None}
                
                brand_analysis = {
                    "brand_matches": [],
                    "violations_detected": [],
                    "confidence_adjustments": [],
                    "recommendations": []
                }
                
                enhanced_score = base_authenticity_score
                total_adjustment = 0.0
                
                for brand_product, similarity_score in brand_matches:
                    # Get brand info
                    brand_query = select(Brand).where(Brand.id == brand_product.brand_id)
                    brand_result = await session.execute(brand_query)
                    brand = brand_result.scalar_one()
                    
                    match_analysis = {
                        "brand_id": brand.id,
                        "brand_name": brand.brand_name,
                        "official_product_id": brand_product.id,
                        "official_product_name": brand_product.official_product_name,
                        "similarity_score": similarity_score,
                        "violations": []
                    }
                    
                    # Check for various violations
                    violations = await self._detect_brand_violations(
                        product, brand_product, brand, similarity_score
                    )
                    
                    match_analysis["violations"] = violations
                    brand_analysis["violations_detected"].extend(violations)
                    
                    # Calculate confidence adjustment based on violations
                    violation_adjustment = self._calculate_violation_score_adjustment(violations)
                    total_adjustment += violation_adjustment
                    
                    brand_analysis["confidence_adjustments"].append({
                        "brand": brand.brand_name,
                        "adjustment": violation_adjustment,
                        "reason": f"Violations: {len(violations)}"
                    })
                    
                    brand_analysis["brand_matches"].append(match_analysis)
                
                # Apply total adjustment to score
                enhanced_score = max(0, min(100, base_authenticity_score + total_adjustment))
                
                # Generate recommendations
                brand_analysis["recommendations"] = self._generate_brand_recommendations(
                    brand_analysis["violations_detected"], enhanced_score
                )
                
                logger.info(
                    "Enhanced product analysis with brand data",
                    product_id=product.id,
                    base_score=base_authenticity_score,
                    enhanced_score=enhanced_score,
                    brand_matches=len(brand_matches),
                    violations=len(brand_analysis["violations_detected"])
                )
                
                return enhanced_score, brand_analysis
                
        except Exception as e:
            logger.error("Failed to enhance product analysis", product_id=product.id, error=str(e))
            # Return base score if enhancement fails
            return base_authenticity_score, {"error": str(e)}
    
    async def monitor_brand_violations(
        self,
        brand_id: Optional[str] = None,
        hours_lookback: int = 24
    ) -> List[BrandMonitoringResult]:
        """
        Monitor for brand violations across marketplace listings.
        
        Args:
            brand_id: Specific brand to monitor (None for all brands)
            hours_lookback: Hours to look back for new products
            
        Returns:
            List of monitoring results
        """
        try:
            async with get_db_session() as session:
                # Get brands to monitor
                if brand_id:
                    brand_query = select(Brand).where(
                        and_(Brand.id == brand_id, Brand.verification_status == VerificationStatus.VERIFIED)
                    )
                else:
                    brand_query = select(Brand).where(Brand.verification_status == VerificationStatus.VERIFIED)
                
                brand_result = await session.execute(brand_query)
                brands = brand_result.scalars().all()
                
                monitoring_results = []
                
                for brand in brands:
                    result = await self._monitor_single_brand(session, brand, hours_lookback)
                    monitoring_results.append(result)
                
                logger.info(
                    "Brand violation monitoring completed",
                    brands_monitored=len(brands),
                    total_violations=sum(r.violations_found for r in monitoring_results)
                )
                
                return monitoring_results
                
        except Exception as e:
            logger.error("Failed to monitor brand violations", error=str(e))
            raise
    
    async def create_brand_detection_rule(
        self,
        brand_id: str,
        rule_name: str,
        rule_type: str,
        threshold: float,
        priority_level: int,
        rule_parameters: Dict[str, Any]
    ) -> str:
        """Create custom detection rule for a brand."""
        try:
            # Validate rule parameters
            if rule_type not in ["similarity", "price", "seller", "trademark", "category"]:
                raise ValueError(f"Invalid rule type: {rule_type}")
            
            if not 0 <= threshold <= 1:
                raise ValueError("Threshold must be between 0 and 1")
            
            if not 1 <= priority_level <= 3:
                raise ValueError("Priority level must be 1 (low), 2 (medium), or 3 (high)")
            
            rule = BrandDetectionRule(
                brand_id=brand_id,
                rule_name=rule_name,
                rule_type=rule_type,
                threshold=threshold,
                priority_level=priority_level,
                enabled=True,
                rule_parameters=rule_parameters
            )
            
            # Store rule (in a real implementation, this would be stored in database)
            rule_id = f"{brand_id}_{rule_name}_{rule_type}"
            
            logger.info(
                "Created brand detection rule",
                brand_id=brand_id,
                rule_name=rule_name,
                rule_type=rule_type,
                rule_id=rule_id
            )
            
            return rule_id
            
        except Exception as e:
            logger.error("Failed to create brand detection rule", error=str(e))
            raise
    
    async def get_brand_violation_alerts(
        self,
        brand_id: str,
        days_lookback: int = 7,
        severity_filter: Optional[str] = None
    ) -> List[BrandViolationAlert]:
        """Get recent violation alerts for a brand."""
        try:
            async with get_db_session() as session:
                # Get brand
                brand_query = select(Brand).where(Brand.id == brand_id)
                brand_result = await session.execute(brand_query)
                brand = brand_result.scalar_one_or_none()
                
                if not brand:
                    raise ValueError(f"Brand {brand_id} not found")
                
                # Get recent products that might violate brand rights
                cutoff_date = datetime.utcnow() - timedelta(days=days_lookback)
                
                # Query products analyzed recently
                analysis_query = select(AuthenticityAnalysis).join(Product).where(
                    and_(
                        AuthenticityAnalysis.created_at >= cutoff_date,
                        AuthenticityAnalysis.authenticity_score < 70  # Flagged products
                    )
                ).order_by(desc(AuthenticityAnalysis.created_at))
                
                analysis_result = await session.execute(analysis_query)
                analyses = analysis_result.scalars().all()
                
                alerts = []
                
                for analysis in analyses:
                    # Get product
                    product_query = select(Product).where(Product.id == analysis.product_id)
                    product_result = await session.execute(product_query)
                    product = product_result.scalar_one_or_none()
                    
                    if not product:
                        continue
                    
                    # Check if this product potentially violates this brand
                    violations = await self._check_product_violations_against_brand(
                        session, product, brand
                    )
                    
                    if violations:
                        for violation in violations:
                            if not severity_filter or violation["severity"] == severity_filter:
                                alert = BrandViolationAlert(
                                    brand_id=brand.id,
                                    brand_name=brand.brand_name,
                                    product_id=product.id,
                                    violation_type=violation["type"],
                                    severity=violation["severity"],
                                    confidence_score=violation["confidence"],
                                    evidence=violation["evidence"],
                                    recommended_action=violation["recommended_action"]
                                )
                                alerts.append(alert)
                
                # Sort by severity and confidence
                severity_order = {"critical": 4, "high": 3, "medium": 2, "low": 1}
                alerts.sort(key=lambda x: (severity_order.get(x.severity, 0), x.confidence_score), reverse=True)
                
                return alerts
                
        except Exception as e:
            logger.error("Failed to get brand violation alerts", brand_id=brand_id, error=str(e))
            raise
    
    async def generate_brand_protection_report(
        self,
        brand_id: str,
        days_period: int = 30
    ) -> Dict[str, Any]:
        """Generate comprehensive brand protection report."""
        try:
            async with get_db_session() as session:
                # Get brand
                brand_query = select(Brand).where(Brand.id == brand_id)
                brand_result = await session.execute(brand_query)
                brand = brand_result.scalar_one_or_none()
                
                if not brand:
                    raise ValueError(f"Brand {brand_id} not found")
                
                cutoff_date = datetime.utcnow() - timedelta(days=days_period)
                
                # Get brand products count
                product_count_query = select(func.count(BrandProduct.id)).where(
                    and_(
                        BrandProduct.brand_id == brand_id,
                        BrandProduct.approval_status == ApprovalStatus.APPROVED
                    )
                )
                product_count_result = await session.execute(product_count_query)
                official_products_count = product_count_result.scalar() or 0
                
                # Get violation alerts
                alerts = await self.get_brand_violation_alerts(brand_id, days_period)
                
                # Count alerts by severity
                alert_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
                for alert in alerts:
                    alert_counts[alert.severity] += 1
                
                # Get enforcement actions taken
                enforcement_query = select(func.count(EnforcementAction.id)).where(
                    and_(
                        EnforcementAction.created_at >= cutoff_date,
                        EnforcementAction.metadata.like(f'%"brand_id": "{brand_id}"%')
                    )
                )
                enforcement_result = await session.execute(enforcement_query)
                enforcement_actions = enforcement_result.scalar() or 0
                
                report = {
                    "brand_id": brand.id,
                    "brand_name": brand.brand_name,
                    "report_period": {
                        "start_date": cutoff_date.isoformat(),
                        "end_date": datetime.utcnow().isoformat(),
                        "days": days_period
                    },
                    "brand_status": {
                        "verification_status": brand.verification_status.value,
                        "official_products_count": official_products_count,
                        "has_zkproof": bool(brand.zkproof_hash)
                    },
                    "violation_summary": {
                        "total_alerts": len(alerts),
                        "alerts_by_severity": alert_counts,
                        "enforcement_actions_taken": enforcement_actions
                    },
                    "top_violations": [
                        {
                            "type": alert.violation_type,
                            "severity": alert.severity,
                            "confidence": alert.confidence_score,
                            "product_id": alert.product_id
                        }
                        for alert in alerts[:10]
                    ],
                    "protection_effectiveness": {
                        "detection_rate": min(100, (len(alerts) / max(1, official_products_count)) * 100),
                        "response_rate": min(100, (enforcement_actions / max(1, len(alerts))) * 100) if alerts else 100
                    },
                    "recommendations": self._generate_protection_recommendations(
                        brand, alerts, enforcement_actions, official_products_count
                    ),
                    "generated_at": datetime.utcnow().isoformat()
                }
                
                return report
                
        except Exception as e:
            logger.error("Failed to generate brand protection report", brand_id=brand_id, error=str(e))
            raise
    
    # Helper methods
    
    async def _find_brand_product_matches(
        self,
        session: AsyncSession,
        product: Product
    ) -> List[Tuple[BrandProduct, float]]:
        """Find matching verified brand products."""
        try:
            if not self.vector_search_service:
                return []
            
            # Use vector search to find similar official products
            search_results = await self.vector_search_service.search_similar_products(
                product.description,
                limit=10,
                threshold=0.75,
                filters={"category": product.category.value if product.category else None}
            )
            
            matches = []
            for result in search_results:
                # Get brand product
                brand_product_query = select(BrandProduct).where(
                    and_(
                        BrandProduct.id == result["product_id"],
                        BrandProduct.approval_status == ApprovalStatus.APPROVED
                    )
                )
                brand_product_result = await session.execute(brand_product_query)
                brand_product = brand_product_result.scalar_one_or_none()
                
                if brand_product:
                    matches.append((brand_product, result["similarity_score"]))
            
            return matches
            
        except Exception as e:
            logger.error("Failed to find brand product matches", error=str(e))
            return []
    
    async def _detect_brand_violations(
        self,
        product: Product,
        brand_product: BrandProduct,
        brand: Brand,
        similarity_score: float
    ) -> List[Dict[str, Any]]:
        """Detect specific violations against brand product."""
        violations = []
        
        try:
            # High similarity violation (potential counterfeit)
            if similarity_score >= brand_product.similarity_threshold:
                severity = "critical" if similarity_score >= 0.95 else "high"
                violations.append({
                    "type": "high_similarity",
                    "severity": severity,
                    "confidence": similarity_score,
                    "description": f"High similarity ({similarity_score:.2%}) to official product",
                    "evidence": {
                        "similarity_score": similarity_score,
                        "threshold": brand_product.similarity_threshold,
                        "official_product": brand_product.official_product_name
                    },
                    "recommended_action": "immediate_review"
                })
            
            # Unauthorized seller violation
            if product.supplier_id and not brand_product.is_authorized_seller(product.supplier_id):
                violations.append({
                    "type": "unauthorized_seller",
                    "severity": "medium",
                    "confidence": 0.9,
                    "description": "Seller not in authorized distributor list",
                    "evidence": {
                        "seller_id": product.supplier_id,
                        "authorized_distributors": brand_product.get_authorized_distributors()
                    },
                    "recommended_action": "verify_seller"
                })
            
            # Price deviation violation
            if product.price and (brand_product.official_price_min or brand_product.official_price_max):
                price_deviation = brand_product.calculate_price_deviation(float(product.price))
                if price_deviation > 0.3:  # 30% deviation threshold
                    severity = "high" if price_deviation > 0.5 else "medium"
                    violations.append({
                        "type": "price_deviation",
                        "severity": severity,
                        "confidence": min(0.9, price_deviation),
                        "description": f"Price deviation of {price_deviation:.1%} from official pricing",
                        "evidence": {
                            "marketplace_price": float(product.price),
                            "official_price_range": brand_product.get_price_range(),
                            "deviation_percentage": price_deviation
                        },
                        "recommended_action": "price_investigation"
                    })
            
            # Trademark violation (simplified check)
            if any(trademark.lower() in product.title.lower() for trademark in brand.get_trademark_list()):
                violations.append({
                    "type": "trademark_violation",
                    "severity": "critical",
                    "confidence": 0.8,
                    "description": "Potential trademark violation in product title",
                    "evidence": {
                        "product_title": product.title,
                        "trademarks": brand.get_trademark_list()
                    },
                    "recommended_action": "legal_review"
                })
            
            return violations
            
        except Exception as e:
            logger.error("Failed to detect brand violations", error=str(e))
            return violations
    
    def _calculate_violation_score_adjustment(self, violations: List[Dict[str, Any]]) -> float:
        """Calculate score adjustment based on violations."""
        if not violations:
            return 0.0
        
        total_adjustment = 0.0
        severity_weights = {"critical": -30, "high": -20, "medium": -10, "low": -5}
        
        for violation in violations:
            severity = violation.get("severity", "low")
            confidence = violation.get("confidence", 0.5)
            adjustment = severity_weights.get(severity, -5) * confidence
            total_adjustment += adjustment
        
        # Cap the adjustment to prevent extreme scores
        return max(-50, min(0, total_adjustment))
    
    def _generate_brand_recommendations(
        self,
        violations: List[Dict[str, Any]],
        enhanced_score: float
    ) -> List[str]:
        """Generate recommendations based on violations."""
        recommendations = []
        
        if enhanced_score < 30:
            recommendations.append("IMMEDIATE ACTION: Product likely counterfeit - recommend removal")
        elif enhanced_score < 50:
            recommendations.append("HIGH PRIORITY: Detailed investigation required")
        elif enhanced_score < 70:
            recommendations.append("MEDIUM PRIORITY: Monitor for additional violations")
        
        violation_types = {v["type"] for v in violations}
        
        if "trademark_violation" in violation_types:
            recommendations.append("Contact legal team for trademark infringement review")
        
        if "unauthorized_seller" in violation_types:
            recommendations.append("Verify seller authorization and update distributor list if needed")
        
        if "price_deviation" in violation_types:
            recommendations.append("Investigate pricing discrepancies and market manipulation")
        
        if "high_similarity" in violation_types:
            recommendations.append("Compare product images and specifications for counterfeiting evidence")
        
        return recommendations
    
    async def _monitor_single_brand(
        self,
        session: AsyncSession,
        brand: Brand,
        hours_lookback: int
    ) -> BrandMonitoringResult:
        """Monitor violations for a single brand."""
        start_time = datetime.utcnow()
        
        try:
            cutoff_date = datetime.utcnow() - timedelta(hours=hours_lookback)
            
            # Get recently analyzed products
            analysis_query = select(AuthenticityAnalysis).join(Product).where(
                AuthenticityAnalysis.created_at >= cutoff_date
            )
            analysis_result = await session.execute(analysis_query)
            analyses = analysis_result.scalars().all()
            
            products_scanned = len(analyses)
            violations_found = 0
            new_violations = 0
            alerts_sent = 0
            
            for analysis in analyses:
                product_query = select(Product).where(Product.id == analysis.product_id)
                product_result = await session.execute(product_query)
                product = product_result.scalar_one_or_none()
                
                if product:
                    violations = await self._check_product_violations_against_brand(
                        session, product, brand
                    )
                    
                    if violations:
                        violations_found += len(violations)
                        new_violations += len(violations)  # Simplified - assume all are new
                        
                        # Send alerts for critical violations
                        critical_violations = [v for v in violations if v["severity"] == "critical"]
                        if critical_violations and self.notification_service:
                            await self._send_brand_violation_alert(brand, product, critical_violations)
                            alerts_sent += 1
            
            processing_time = (datetime.utcnow() - start_time).total_seconds()
            
            return BrandMonitoringResult(
                brand_id=brand.id,
                scan_timestamp=start_time,
                products_scanned=products_scanned,
                violations_found=violations_found,
                new_violations=new_violations,
                alerts_sent=alerts_sent,
                processing_time_seconds=processing_time
            )
            
        except Exception as e:
            logger.error("Failed to monitor single brand", brand_id=brand.id, error=str(e))
            return BrandMonitoringResult(
                brand_id=brand.id,
                scan_timestamp=start_time,
                products_scanned=0,
                violations_found=0,
                new_violations=0,
                alerts_sent=0,
                processing_time_seconds=(datetime.utcnow() - start_time).total_seconds()
            )
    
    async def _check_product_violations_against_brand(
        self,
        session: AsyncSession,
        product: Product,
        brand: Brand
    ) -> List[Dict[str, Any]]:
        """Check if product violates specific brand rights."""
        try:
            # Get approved brand products for comparison
            brand_products_query = select(BrandProduct).where(
                and_(
                    BrandProduct.brand_id == brand.id,
                    BrandProduct.approval_status == ApprovalStatus.APPROVED
                )
            )
            brand_products_result = await session.execute(brand_products_query)
            brand_products = brand_products_result.scalars().all()
            
            all_violations = []
            
            for brand_product in brand_products:
                # Simple similarity check (in real implementation, use vector similarity)
                title_similarity = self._calculate_text_similarity(
                    product.title.lower(), 
                    brand_product.official_product_name.lower()
                )
                
                if title_similarity > 0.7:  # High similarity threshold
                    violations = await self._detect_brand_violations(
                        product, brand_product, brand, title_similarity
                    )
                    all_violations.extend(violations)
            
            return all_violations
            
        except Exception as e:
            logger.error("Failed to check product violations", error=str(e))
            return []
    
    def _calculate_text_similarity(self, text1: str, text2: str) -> float:
        """Simple text similarity calculation."""
        # Simplified implementation - in production, use proper similarity algorithms
        words1 = set(text1.split())
        words2 = set(text2.split())
        
        if not words1 or not words2:
            return 0.0
        
        intersection = words1.intersection(words2)
        union = words1.union(words2)
        
        return len(intersection) / len(union) if union else 0.0
    
    def _generate_protection_recommendations(
        self,
        brand: Brand,
        alerts: List[BrandViolationAlert],
        enforcement_actions: int,
        official_products_count: int
    ) -> List[str]:
        """Generate brand protection recommendations."""
        recommendations = []
        
        if len(alerts) > official_products_count * 0.5:
            recommendations.append("HIGH ALERT: Violation rate exceeds 50% - consider enhanced monitoring")
        
        critical_alerts = [a for a in alerts if a.severity == "critical"]
        if len(critical_alerts) > 5:
            recommendations.append("Multiple critical violations detected - prioritize immediate action")
        
        if enforcement_actions < len(alerts) * 0.3:
            recommendations.append("Low enforcement rate - consider automating more actions")
        
        if official_products_count < 10:
            recommendations.append("Consider adding more official products to improve detection accuracy")
        
        if not brand.zkproof_hash:
            recommendations.append("Generate zkSNARK proof for enhanced brand verification")
        
        return recommendations
    
    async def _send_brand_violation_alert(
        self,
        brand: Brand,
        product: Product,
        violations: List[Dict[str, Any]]
    ) -> None:
        """Send brand violation alert to brand owner."""
        if not self.notification_service:
            return
        
        try:
            severity = max(violations, key=lambda x: {"critical": 4, "high": 3, "medium": 2, "low": 1}.get(x["severity"], 0))["severity"]
            
            await self.notification_service.send_alert(
                alert_type="brand_violation_detected",
                message=f"Potential violation of {brand.brand_name} detected",
                severity=severity,
                recipients=[brand.contact_email, "brand_protection_team"],
                metadata={
                    "brand_id": brand.id,
                    "brand_name": brand.brand_name,
                    "product_id": product.id,
                    "product_title": product.title,
                    "violations": [v["type"] for v in violations],
                    "highest_severity": severity
                }
            )
            
        except Exception as e:
            logger.error("Failed to send brand violation alert", error=str(e))