"""
Brand Product Service for managing official product submissions and approvals.

Handles product metadata submission from verified brands, bulk uploads,
product verification workflows, and integration with the detection system.
"""

import asyncio
import csv
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
from io import StringIO
import uuid

import structlog
from sqlalchemy import and_, func, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db_session
from ..models.brand import Brand, VerificationStatus
from ..models.brand_product import BrandProduct, ApprovalStatus
from ..models.verification import Verification, VerificationType, VerificationResult
from ..models.enums import ProductCategory
from ..services.embedding_service import EmbeddingService
from ..services.notification_service import NotificationService
from ..services.file_storage_service import FileStorageService

logger = structlog.get_logger(__name__)


@dataclass
class ProductSubmissionData:
    """Data structure for product submission."""
    brand_id: str
    official_product_name: str
    official_description: str
    category: ProductCategory
    official_price_min: Optional[float]
    official_price_max: Optional[float]
    currency: str = "USD"
    official_images: List[str] = None
    product_specifications: Dict[str, Any] = None
    authorized_distributors: List[str] = None
    sku: Optional[str] = None
    barcode: Optional[str] = None
    similarity_threshold: float = 0.85
    priority_level: int = 1
    submitted_by_user_id: str = None


@dataclass
class BulkUploadResult:
    """Result of bulk product upload operation."""
    total_products: int
    successful_uploads: int
    failed_uploads: int
    errors: List[Dict[str, Any]]
    uploaded_product_ids: List[str]


class BrandProductService:
    """Service for managing brand product submissions and approvals."""
    
    def __init__(self):
        """Initialize brand product service."""
        self.embedding_service: Optional[EmbeddingService] = None
        self.notification_service: Optional[NotificationService] = None
        self.file_storage_service: Optional[FileStorageService] = None
    
    async def submit_product(
        self,
        product_data: ProductSubmissionData
    ) -> str:
        """
        Submit a new product for verification and approval.
        
        Args:
            product_data: Product information
            
        Returns:
            Product ID
        """
        try:
            async with get_db_session() as session:
                # Verify brand is verified and can submit products
                brand = await self._get_verified_brand(session, product_data.brand_id)
                
                # Create product entity
                product = BrandProduct(
                    brand_id=product_data.brand_id,
                    official_product_name=product_data.official_product_name,
                    official_description=product_data.official_description,
                    category=product_data.category,
                    official_price_min=product_data.official_price_min,
                    official_price_max=product_data.official_price_max,
                    currency=product_data.currency,
                    official_images=product_data.official_images or [],
                    product_specifications=product_data.product_specifications or {},
                    authorized_distributors=product_data.authorized_distributors or [],
                    sku=product_data.sku,
                    barcode=product_data.barcode,
                    similarity_threshold=product_data.similarity_threshold,
                    priority_level=product_data.priority_level,
                    approval_status=ApprovalStatus.PENDING
                )
                
                session.add(product)
                await session.flush()  # Get product ID
                
                # Generate embeddings for the product
                await self._generate_product_embeddings(product)
                
                # Create verification workflow
                verification = Verification(
                    verification_type=VerificationType.PRODUCT_SUBMISSION,
                    verification_result=VerificationResult.PENDING,
                    brand_id=product_data.brand_id,
                    brand_product_id=product.id,
                    submitted_by=product_data.submitted_by_user_id or brand.id,
                    verification_data={
                        "product_name": product_data.official_product_name,
                        "category": product_data.category.value,
                        "price_range": {
                            "min": product_data.official_price_min,
                            "max": product_data.official_price_max,
                            "currency": product_data.currency
                        },
                        "specifications": product_data.product_specifications or {},
                        "images_count": len(product_data.official_images or [])
                    }
                )
                
                session.add(verification)
                await session.commit()
                
                # Notify admin team for review
                await self._notify_admin_for_product_review(brand, product)
                
                logger.info(
                    "Product submitted for approval",
                    product_id=product.id,
                    brand_id=product_data.brand_id,
                    product_name=product_data.official_product_name,
                    category=product_data.category.value
                )
                
                return product.id
                
        except Exception as e:
            logger.error("Failed to submit product", error=str(e))
            raise
    
    async def submit_products_bulk(
        self,
        brand_id: str,
        products_data: List[Dict[str, Any]],
        submitted_by_user_id: str
    ) -> BulkUploadResult:
        """
        Submit multiple products in bulk.
        
        Args:
            brand_id: Brand ID
            products_data: List of product data dictionaries
            submitted_by_user_id: User ID submitting products
            
        Returns:
            Bulk upload result
        """
        try:
            async with get_db_session() as session:
                # Verify brand is verified
                brand = await self._get_verified_brand(session, brand_id)
                
                total_products = len(products_data)
                successful_uploads = 0
                failed_uploads = 0
                errors = []
                uploaded_product_ids = []
                
                for idx, product_data in enumerate(products_data):
                    try:
                        # Convert dictionary to ProductSubmissionData
                        submission_data = ProductSubmissionData(
                            brand_id=brand_id,
                            official_product_name=product_data.get("official_product_name", ""),
                            official_description=product_data.get("official_description", ""),
                            category=ProductCategory(product_data.get("category", ProductCategory.OTHER.value)),
                            official_price_min=product_data.get("official_price_min"),
                            official_price_max=product_data.get("official_price_max"),
                            currency=product_data.get("currency", "USD"),
                            official_images=product_data.get("official_images", []),
                            product_specifications=product_data.get("product_specifications", {}),
                            authorized_distributors=product_data.get("authorized_distributors", []),
                            sku=product_data.get("sku"),
                            barcode=product_data.get("barcode"),
                            similarity_threshold=product_data.get("similarity_threshold", 0.85),
                            priority_level=product_data.get("priority_level", 1),
                            submitted_by_user_id=submitted_by_user_id
                        )
                        
                        # Submit individual product
                        product_id = await self.submit_product(submission_data)
                        uploaded_product_ids.append(product_id)
                        successful_uploads += 1
                        
                    except Exception as e:
                        failed_uploads += 1
                        errors.append({
                            "product_index": idx,
                            "product_name": product_data.get("official_product_name", f"Product {idx}"),
                            "error": str(e)
                        })
                        
                        logger.warning(
                            "Failed to upload product in bulk",
                            product_index=idx,
                            product_name=product_data.get("official_product_name", ""),
                            error=str(e)
                        )
                
                result = BulkUploadResult(
                    total_products=total_products,
                    successful_uploads=successful_uploads,
                    failed_uploads=failed_uploads,
                    errors=errors,
                    uploaded_product_ids=uploaded_product_ids
                )
                
                # Send bulk upload summary
                if self.notification_service:
                    await self._send_bulk_upload_summary(brand, result, submitted_by_user_id)
                
                logger.info(
                    "Bulk product upload completed",
                    brand_id=brand_id,
                    total=total_products,
                    successful=successful_uploads,
                    failed=failed_uploads
                )
                
                return result
                
        except Exception as e:
            logger.error("Failed to submit products in bulk", brand_id=brand_id, error=str(e))
            raise
    
    async def parse_csv_products(self, csv_content: str) -> List[Dict[str, Any]]:
        """
        Parse CSV content into product data list.
        
        Args:
            csv_content: CSV file content as string
            
        Returns:
            List of product data dictionaries
        """
        try:
            products = []
            csv_reader = csv.DictReader(StringIO(csv_content))
            
            # Expected CSV columns
            required_columns = ["official_product_name", "official_description", "category"]
            optional_columns = [
                "official_price_min", "official_price_max", "currency",
                "sku", "barcode", "similarity_threshold", "priority_level",
                "authorized_distributors", "specifications"
            ]
            
            for row_idx, row in enumerate(csv_reader):
                try:
                    # Validate required columns
                    for col in required_columns:
                        if not row.get(col):
                            raise ValueError(f"Missing required column: {col}")
                    
                    # Parse product data
                    product_data = {
                        "official_product_name": row["official_product_name"].strip(),
                        "official_description": row["official_description"].strip(),
                        "category": row["category"].strip()
                    }
                    
                    # Parse optional fields
                    if row.get("official_price_min"):
                        product_data["official_price_min"] = float(row["official_price_min"])
                    
                    if row.get("official_price_max"):
                        product_data["official_price_max"] = float(row["official_price_max"])
                    
                    product_data["currency"] = row.get("currency", "USD").strip()
                    product_data["sku"] = row.get("sku", "").strip() or None
                    product_data["barcode"] = row.get("barcode", "").strip() or None
                    
                    if row.get("similarity_threshold"):
                        product_data["similarity_threshold"] = float(row["similarity_threshold"])
                    
                    if row.get("priority_level"):
                        product_data["priority_level"] = int(row["priority_level"])
                    
                    # Parse JSON fields
                    if row.get("authorized_distributors"):
                        try:
                            product_data["authorized_distributors"] = json.loads(row["authorized_distributors"])
                        except json.JSONDecodeError:
                            # Treat as comma-separated list
                            product_data["authorized_distributors"] = [
                                dist.strip() for dist in row["authorized_distributors"].split(",")
                            ]
                    
                    if row.get("specifications"):
                        try:
                            product_data["product_specifications"] = json.loads(row["specifications"])
                        except json.JSONDecodeError:
                            product_data["product_specifications"] = {"notes": row["specifications"]}
                    
                    products.append(product_data)
                    
                except Exception as e:
                    logger.warning(f"Failed to parse CSV row {row_idx + 1}", error=str(e))
                    # Continue processing other rows
                    continue
            
            return products
            
        except Exception as e:
            logger.error("Failed to parse CSV products", error=str(e))
            raise
    
    async def review_product_submission(
        self,
        product_id: str,
        admin_user_id: str,
        action: str,
        notes: Optional[str] = None,
        rejection_reason: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Admin review of product submission.
        
        Args:
            product_id: Product ID
            admin_user_id: Admin user performing review
            action: 'approve', 'reject', or 'request_revision'
            notes: Admin notes
            rejection_reason: Reason for rejection if applicable
            
        Returns:
            Review result
        """
        try:
            async with get_db_session() as session:
                # Get product and brand
                product_query = select(BrandProduct).where(BrandProduct.id == product_id)
                product_result = await session.execute(product_query)
                product = product_result.scalar_one_or_none()
                
                if not product:
                    raise ValueError(f"Product {product_id} not found")
                
                brand_query = select(Brand).where(Brand.id == product.brand_id)
                brand_result = await session.execute(brand_query)
                brand = brand_result.scalar_one_or_none()
                
                # Process review action
                if action == "approve":
                    product.approve_product(admin_user_id)
                    # Product is now available for counterfeit detection
                    
                elif action == "reject":
                    product.reject_product(admin_user_id, rejection_reason or "")
                    
                elif action == "request_revision":
                    product.request_revision(admin_user_id, notes or "")
                    
                else:
                    raise ValueError(f"Invalid review action: {action}")
                
                # Update verification record
                verification_query = select(Verification).where(
                    and_(
                        Verification.brand_product_id == product_id,
                        Verification.verification_type == VerificationType.PRODUCT_SUBMISSION
                    )
                )
                verification_result = await session.execute(verification_query)
                verification = verification_result.scalar_one_or_none()
                
                if verification:
                    if action == "approve":
                        verification.approve_verification(admin_user_id, notes or "")
                    elif action == "reject":
                        verification.reject_verification(admin_user_id, rejection_reason or "")
                    else:
                        verification.request_additional_info(admin_user_id, notes or "")
                
                await session.commit()
                
                # Send notification to brand
                if brand and self.notification_service:
                    await self._send_product_review_notification(brand, product, action)
                
                result = {
                    "product_id": product_id,
                    "action": action,
                    "status": product.approval_status.value,
                    "reviewed_by": admin_user_id,
                    "reviewed_at": datetime.utcnow().isoformat(),
                    "notes": notes,
                    "rejection_reason": rejection_reason
                }
                
                logger.info(
                    "Product submission reviewed",
                    product_id=product_id,
                    action=action,
                    admin_user_id=admin_user_id,
                    brand_id=product.brand_id
                )
                
                return result
                
        except Exception as e:
            logger.error("Failed to review product submission", product_id=product_id, error=str(e))
            raise
    
    async def get_brand_products(
        self,
        brand_id: str,
        status_filter: Optional[str] = None,
        limit: int = 50,
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """Get products for a specific brand."""
        try:
            async with get_db_session() as session:
                # Build query
                query = select(BrandProduct).where(BrandProduct.brand_id == brand_id)
                
                if status_filter:
                    query = query.where(BrandProduct.approval_status == ApprovalStatus(status_filter))
                
                query = query.order_by(desc(BrandProduct.created_at)).limit(limit).offset(offset)
                
                result = await session.execute(query)
                products = result.scalars().all()
                
                return [product.get_product_summary() for product in products]
                
        except Exception as e:
            logger.error("Failed to get brand products", brand_id=brand_id, error=str(e))
            raise
    
    async def get_pending_product_reviews(
        self,
        limit: int = 50,
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """Get list of pending product reviews for admin."""
        try:
            async with get_db_session() as session:
                # Query pending products
                query = select(BrandProduct).join(Brand).where(
                    BrandProduct.approval_status.in_([
                        ApprovalStatus.PENDING,
                        ApprovalStatus.NEEDS_REVISION
                    ])
                ).order_by(BrandProduct.created_at).limit(limit).offset(offset)
                
                result = await session.execute(query)
                products = result.scalars().all()
                
                pending_reviews = []
                for product in products:
                    # Get brand info
                    brand_query = select(Brand).where(Brand.id == product.brand_id)
                    brand_result = await session.execute(brand_query)
                    brand = brand_result.scalar_one()
                    
                    review_info = {
                        "product": product.get_product_summary(),
                        "brand": brand.get_brand_summary(),
                        "days_pending": (datetime.utcnow() - product.created_at).days,
                        "has_images": len(product.get_official_images()) > 0,
                        "has_specifications": bool(product.product_specifications)
                    }
                    
                    pending_reviews.append(review_info)
                
                return pending_reviews
                
        except Exception as e:
            logger.error("Failed to get pending product reviews", error=str(e))
            raise
    
    async def update_product(
        self,
        product_id: str,
        user_id: str,
        updates: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update product information."""
        try:
            async with get_db_session() as session:
                # Get product
                product_query = select(BrandProduct).where(BrandProduct.id == product_id)
                product_result = await session.execute(product_query)
                product = product_result.scalar_one_or_none()
                
                if not product:
                    raise ValueError(f"Product {product_id} not found")
                
                # Only allow updates for pending or needs revision products
                if product.approval_status not in [ApprovalStatus.PENDING, ApprovalStatus.NEEDS_REVISION]:
                    raise ValueError("Can only update pending or revision-required products")
                
                # Update allowed fields
                allowed_updates = [
                    "official_product_name", "official_description", "official_price_min",
                    "official_price_max", "currency", "official_images", "product_specifications",
                    "authorized_distributors", "sku", "barcode", "similarity_threshold"
                ]
                
                updated_fields = []
                for field, value in updates.items():
                    if field in allowed_updates and hasattr(product, field):
                        setattr(product, field, value)
                        updated_fields.append(field)
                
                # Reset status to pending if it was needs revision
                if product.approval_status == ApprovalStatus.NEEDS_REVISION and updated_fields:
                    product.approval_status = ApprovalStatus.PENDING
                    product.rejection_reason = None
                
                # Regenerate embeddings if description or name changed
                if any(field in ["official_product_name", "official_description"] for field in updated_fields):
                    await self._generate_product_embeddings(product)
                
                if updated_fields:
                    await session.commit()
                    
                    logger.info(
                        "Product updated",
                        product_id=product_id,
                        user_id=user_id,
                        updated_fields=updated_fields
                    )
                
                return product.get_product_summary()
                
        except Exception as e:
            logger.error("Failed to update product", product_id=product_id, error=str(e))
            raise
    
    async def get_product_statistics(self, brand_id: Optional[str] = None) -> Dict[str, Any]:
        """Get product statistics."""
        try:
            async with get_db_session() as session:
                # Base query
                base_query = select(BrandProduct)
                if brand_id:
                    base_query = base_query.where(BrandProduct.brand_id == brand_id)
                
                # Products by status
                status_query = select(
                    BrandProduct.approval_status,
                    func.count(BrandProduct.id).label('count')
                ).select_from(base_query.subquery()).group_by(BrandProduct.approval_status)
                
                status_result = await session.execute(status_query)
                status_counts = {row.approval_status.value: row.count for row in status_result}
                
                # Products by category
                category_query = select(
                    BrandProduct.category,
                    func.count(BrandProduct.id).label('count')
                ).select_from(base_query.subquery()).group_by(BrandProduct.category)
                
                category_result = await session.execute(category_query)
                category_counts = {row.category.value: row.count for row in category_result}
                
                # Recent submissions (last 30 days)
                thirty_days_ago = datetime.utcnow() - timedelta(days=30)
                recent_query = select(func.count(BrandProduct.id)).select_from(
                    base_query.where(BrandProduct.created_at >= thirty_days_ago).subquery()
                )
                recent_result = await session.execute(recent_query)
                recent_submissions = recent_result.scalar() or 0
                
                return {
                    "total_products": sum(status_counts.values()),
                    "by_status": status_counts,
                    "by_category": category_counts,
                    "recent_submissions_30d": recent_submissions,
                    "pending_review": status_counts.get("pending", 0) + status_counts.get("needs_revision", 0)
                }
                
        except Exception as e:
            logger.error("Failed to get product statistics", error=str(e))
            raise
    
    # Helper methods
    
    async def _get_verified_brand(self, session: AsyncSession, brand_id: str) -> Brand:
        """Get verified brand or raise error."""
        brand_query = select(Brand).where(Brand.id == brand_id)
        brand_result = await session.execute(brand_query)
        brand = brand_result.scalar_one_or_none()
        
        if not brand:
            raise ValueError(f"Brand {brand_id} not found")
        
        if not brand.is_verified:
            raise ValueError(f"Brand {brand_id} is not verified - cannot submit products")
        
        return brand
    
    async def _generate_product_embeddings(self, product: BrandProduct) -> None:
        """Generate embeddings for product description and images."""
        try:
            if self.embedding_service:
                # Generate text embedding for description
                text_embedding = await self.embedding_service.generate_text_embedding(
                    f"{product.official_product_name} {product.official_description}"
                )
                product.official_description_embedding = text_embedding
                
                # Generate image embeddings if images are available
                if product.official_images:
                    # For now, use a placeholder - real implementation would process images
                    # image_embedding = await self.embedding_service.generate_image_embedding(product.official_images[0])
                    # product.official_image_embedding = image_embedding
                    pass
                
                logger.debug(
                    "Generated product embeddings",
                    product_id=product.id,
                    has_text_embedding=bool(product.official_description_embedding),
                    has_image_embedding=bool(product.official_image_embedding)
                )
                
        except Exception as e:
            logger.warning("Failed to generate product embeddings", product_id=product.id, error=str(e))
    
    async def _notify_admin_for_product_review(self, brand: Brand, product: BrandProduct) -> None:
        """Notify admin team about new product submission."""
        if not self.notification_service:
            return
        
        try:
            await self.notification_service.send_alert(
                alert_type="product_submission_pending",
                message=f"New product submission from {brand.brand_name}: {product.official_product_name}",
                severity="medium",
                recipients=["admin", "product_review_team"],
                metadata={
                    "brand_id": brand.id,
                    "brand_name": brand.brand_name,
                    "product_id": product.id,
                    "product_name": product.official_product_name,
                    "category": product.category.value
                }
            )
            
        except Exception as e:
            logger.error("Failed to notify admin for product review", error=str(e))
    
    async def _send_bulk_upload_summary(
        self,
        brand: Brand,
        result: BulkUploadResult,
        user_id: str
    ) -> None:
        """Send bulk upload summary notification."""
        if not self.notification_service:
            return
        
        try:
            await self.notification_service.send_email(
                to_email=brand.contact_email,
                subject=f"Bulk Product Upload Summary - {brand.brand_name}",
                template="bulk_product_upload_summary",
                template_data={
                    "brand_name": brand.brand_name,
                    "total_products": result.total_products,
                    "successful_uploads": result.successful_uploads,
                    "failed_uploads": result.failed_uploads,
                    "errors": result.errors[:10],  # Limit errors shown
                    "uploaded_product_ids": result.uploaded_product_ids
                }
            )
            
        except Exception as e:
            logger.error("Failed to send bulk upload summary", error=str(e))
    
    async def _send_product_review_notification(
        self,
        brand: Brand,
        product: BrandProduct,
        action: str
    ) -> None:
        """Send product review notification to brand."""
        if not self.notification_service:
            return
        
        try:
            if action == "approve":
                template = "product_submission_approved"
                subject = f"Product Approved - {product.official_product_name}"
            elif action == "reject":
                template = "product_submission_rejected"
                subject = f"Product Rejected - {product.official_product_name}"
            else:
                template = "product_submission_revision_requested"
                subject = f"Product Revision Required - {product.official_product_name}"
            
            await self.notification_service.send_email(
                to_email=brand.contact_email,
                subject=subject,
                template=template,
                template_data={
                    "brand_name": brand.brand_name,
                    "product_name": product.official_product_name,
                    "product_id": product.id,
                    "rejection_reason": product.rejection_reason or "",
                    "portal_url": f"/brand/dashboard/{brand.id}/products"
                }
            )
            
        except Exception as e:
            logger.error("Failed to send product review notification", error=str(e))