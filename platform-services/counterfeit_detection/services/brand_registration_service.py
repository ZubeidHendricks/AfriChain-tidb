"""
Brand Registration Service for managing brand registration workflows.

Handles brand registration processes including application submission,
document verification, brand approval, and integration with the counterfeit detection system.
"""

import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
import uuid
import hashlib

import structlog
from sqlalchemy import and_, func, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db_session
from ..models.brand import Brand, VerificationStatus
from ..models.brand_product import BrandProduct
from ..models.verification import Verification, VerificationType, VerificationResult, DocumentType
from ..models.user import User
from ..services.notification_service import NotificationService
from ..services.file_storage_service import FileStorageService

logger = structlog.get_logger(__name__)


@dataclass
class BrandRegistrationData:
    """Data structure for brand registration submission."""
    brand_name: str
    legal_entity_name: str
    business_registration_number: Optional[str]
    trademark_numbers: List[str]
    contact_email: str
    contact_phone: Optional[str]
    website_url: Optional[str]
    submitted_by_user_id: str
    verification_documents: List[Dict[str, Any]]
    brand_metadata: Optional[Dict[str, Any]] = None


@dataclass
class BrandVerificationResult:
    """Result of brand verification process."""
    verification_id: str
    brand_id: str
    status: VerificationResult
    processing_time_hours: Optional[int]
    issues_found: List[str]
    recommendations: List[str]


class BrandRegistrationService:
    """Service for managing brand registration and verification workflows."""
    
    def __init__(self):
        """Initialize brand registration service."""
        self.notification_service: Optional[NotificationService] = None
        self.file_storage_service: Optional[FileStorageService] = None
        
        # Verification requirements configuration
        self.required_documents = {
            VerificationType.BRAND_REGISTRATION: [
                DocumentType.BUSINESS_REGISTRATION,
                DocumentType.TRADEMARK_CERTIFICATE,
                DocumentType.AUTHORIZED_REPRESENTATIVE
            ]
        }
    
    async def submit_brand_registration(
        self,
        registration_data: BrandRegistrationData
    ) -> Tuple[str, str]:
        """
        Submit a new brand registration application.
        
        Args:
            registration_data: Brand registration information
            
        Returns:
            Tuple of (brand_id, verification_id)
        """
        try:
            async with get_db_session() as session:
                # Check if brand name already exists
                existing_brand = await self._check_brand_exists(session, registration_data.brand_name)
                if existing_brand:
                    raise ValueError(f"Brand name '{registration_data.brand_name}' is already registered")
                
                # Create brand entity
                brand = Brand(
                    brand_name=registration_data.brand_name,
                    legal_entity_name=registration_data.legal_entity_name,
                    business_registration_number=registration_data.business_registration_number,
                    trademark_numbers=registration_data.trademark_numbers,
                    contact_email=registration_data.contact_email,
                    contact_phone=registration_data.contact_phone,
                    website_url=registration_data.website_url,
                    verification_status=VerificationStatus.PENDING,
                    brand_metadata=registration_data.brand_metadata or {}
                )
                
                session.add(brand)
                await session.flush()  # Get brand ID
                
                # Create verification workflow
                verification = Verification(
                    verification_type=VerificationType.BRAND_REGISTRATION,
                    verification_result=VerificationResult.PENDING,
                    brand_id=brand.id,
                    submitted_by=registration_data.submitted_by_user_id,
                    verification_data={
                        "brand_name": registration_data.brand_name,
                        "legal_entity_name": registration_data.legal_entity_name,
                        "business_registration_number": registration_data.business_registration_number,
                        "trademark_numbers": registration_data.trademark_numbers,
                        "contact_email": registration_data.contact_email,
                        "contact_phone": registration_data.contact_phone,
                        "website_url": registration_data.website_url
                    }
                )
                
                # Add required documents
                for doc_type in self.required_documents[VerificationType.BRAND_REGISTRATION]:
                    verification.add_required_document(doc_type, f"Required for brand verification")
                
                session.add(verification)
                await session.flush()
                
                # Process submitted documents
                for doc_data in registration_data.verification_documents:
                    await self._process_verification_document(
                        session, verification, doc_data
                    )
                
                await session.commit()
                
                # Send notification to brand owner
                if self.notification_service:
                    await self._send_registration_confirmation(brand, verification)
                
                # Notify admin team for review
                await self._notify_admin_for_review(brand, verification)
                
                logger.info(
                    "Brand registration submitted",
                    brand_id=brand.id,
                    brand_name=brand.brand_name,
                    verification_id=verification.id,
                    submitted_by=registration_data.submitted_by_user_id
                )
                
                return brand.id, verification.id
                
        except Exception as e:
            logger.error("Failed to submit brand registration", error=str(e))
            raise
    
    async def get_brand_registration_status(
        self,
        brand_id: str,
        user_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Get the status of a brand registration."""
        try:
            async with get_db_session() as session:
                # Get brand and verification info
                brand_query = select(Brand).where(Brand.id == brand_id)
                brand_result = await session.execute(brand_query)
                brand = brand_result.scalar_one_or_none()
                
                if not brand:
                    raise ValueError(f"Brand {brand_id} not found")
                
                # Get verification records
                verification_query = select(Verification).where(
                    and_(
                        Verification.brand_id == brand_id,
                        Verification.verification_type == VerificationType.BRAND_REGISTRATION
                    )
                ).order_by(desc(Verification.created_at))
                
                verification_result = await session.execute(verification_query)
                verifications = verification_result.scalars().all()
                
                current_verification = verifications[0] if verifications else None
                
                # Build status response
                status = {
                    "brand_id": brand.id,
                    "brand_name": brand.brand_name,
                    "verification_status": brand.verification_status.value,
                    "submitted_at": brand.created_at.isoformat(),
                    "verified_at": brand.verified_at.isoformat() if brand.verified_at else None,
                    "current_verification": None,
                    "verification_history": [],
                    "can_submit_products": brand.is_verified
                }
                
                if current_verification:
                    status["current_verification"] = current_verification.get_verification_summary()
                
                # Add verification history
                for verification in verifications:
                    status["verification_history"].append(verification.get_verification_summary())
                
                return status
                
        except Exception as e:
            logger.error("Failed to get brand registration status", brand_id=brand_id, error=str(e))
            raise
    
    async def review_brand_registration(
        self,
        verification_id: str,
        admin_user_id: str,
        action: str,
        notes: Optional[str] = None,
        rejection_reason: Optional[str] = None
    ) -> BrandVerificationResult:
        """
        Admin review of brand registration.
        
        Args:
            verification_id: Verification process ID
            admin_user_id: Admin user performing review
            action: 'approve', 'reject', or 'request_info'
            notes: Admin notes
            rejection_reason: Reason for rejection if applicable
            
        Returns:
            Verification result
        """
        try:
            async with get_db_session() as session:
                # Get verification and brand
                verification_query = select(Verification).where(Verification.id == verification_id)
                verification_result = await session.execute(verification_query)
                verification = verification_result.scalar_one_or_none()
                
                if not verification:
                    raise ValueError(f"Verification {verification_id} not found")
                
                brand_query = select(Brand).where(Brand.id == verification.brand_id)
                brand_result = await session.execute(brand_query)
                brand = brand_result.scalar_one_or_none()
                
                if not brand:
                    raise ValueError(f"Brand {verification.brand_id} not found")
                
                # Assign reviewer
                verification.assign_reviewer(admin_user_id)
                
                # Process review action
                issues_found = []
                recommendations = []
                
                if action == "approve":
                    # Verify document completeness
                    completeness = verification.check_document_completeness()
                    if not completeness["is_complete"]:
                        issues_found.extend([
                            f"Missing documents: {', '.join(completeness['missing_documents'])}",
                            f"Unverified documents: {', '.join(completeness['unverified_documents'])}"
                        ])
                        
                        verification.request_additional_info(
                            admin_user_id,
                            f"Please provide missing/verify documents: {', '.join(completeness['missing_documents'] + completeness['unverified_documents'])}"
                        )
                    else:
                        # Approve brand
                        verification.approve_verification(admin_user_id, notes or "")
                        brand.set_verified(admin_user_id, notes)
                        
                        # Generate zkProof if applicable
                        await self._generate_brand_zkproof(brand)
                        
                        recommendations.append("Brand verified successfully - can now submit products")
                
                elif action == "reject":
                    verification.reject_verification(admin_user_id, rejection_reason or "")
                    brand.set_rejected(admin_user_id, rejection_reason or "")
                    issues_found.append(rejection_reason or "Registration rejected by admin")
                
                elif action == "request_info":
                    verification.request_additional_info(admin_user_id, notes or "Additional information required")
                    recommendations.append("Provide requested information to continue verification")
                
                else:
                    raise ValueError(f"Invalid review action: {action}")
                
                await session.commit()
                
                # Send notifications
                await self._send_review_notification(brand, verification, action)
                
                # Calculate processing time
                processing_time = verification.calculate_processing_time()
                
                result = BrandVerificationResult(
                    verification_id=verification.id,
                    brand_id=brand.id,
                    status=verification.verification_result,
                    processing_time_hours=processing_time,
                    issues_found=issues_found,
                    recommendations=recommendations
                )
                
                logger.info(
                    "Brand registration reviewed",
                    verification_id=verification_id,
                    brand_id=brand.id,
                    action=action,
                    admin_user_id=admin_user_id,
                    result_status=verification.verification_result.value
                )
                
                return result
                
        except Exception as e:
            logger.error("Failed to review brand registration", verification_id=verification_id, error=str(e))
            raise
    
    async def get_pending_registrations(
        self,
        limit: int = 50,
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """Get list of pending brand registrations for admin review."""
        try:
            async with get_db_session() as session:
                # Query pending verifications
                query = select(Verification).join(Brand).where(
                    and_(
                        Verification.verification_type == VerificationType.BRAND_REGISTRATION,
                        Verification.verification_result.in_([
                            VerificationResult.PENDING,
                            VerificationResult.IN_PROGRESS,
                            VerificationResult.REQUIRES_ADDITIONAL_INFO
                        ])
                    )
                ).order_by(Verification.created_at).limit(limit).offset(offset)
                
                result = await session.execute(query)
                verifications = result.scalars().all()
                
                pending_registrations = []
                for verification in verifications:
                    # Get brand info
                    brand_query = select(Brand).where(Brand.id == verification.brand_id)
                    brand_result = await session.execute(brand_query)
                    brand = brand_result.scalar_one()
                    
                    # Get submitter info
                    user_query = select(User).where(User.id == verification.submitted_by)
                    user_result = await session.execute(user_query)
                    submitter = user_result.scalar_one_or_none()
                    
                    registration_info = {
                        "verification_id": verification.id,
                        "brand": brand.get_brand_summary(),
                        "verification": verification.get_verification_summary(),
                        "submitter": {
                            "id": submitter.id if submitter else verification.submitted_by,
                            "email": submitter.email if submitter else "Unknown",
                            "name": f"{submitter.first_name} {submitter.last_name}" if submitter else "Unknown"
                        },
                        "days_pending": (datetime.utcnow() - verification.created_at).days,
                        "document_completeness": verification.check_document_completeness()
                    }
                    
                    pending_registrations.append(registration_info)
                
                return pending_registrations
                
        except Exception as e:
            logger.error("Failed to get pending registrations", error=str(e))
            raise
    
    async def update_brand_profile(
        self,
        brand_id: str,
        user_id: str,
        updates: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update brand profile information."""
        try:
            async with get_db_session() as session:
                # Get brand
                brand_query = select(Brand).where(Brand.id == brand_id)
                brand_result = await session.execute(brand_query)
                brand = brand_result.scalar_one_or_none()
                
                if not brand:
                    raise ValueError(f"Brand {brand_id} not found")
                
                # Update allowed fields
                allowed_updates = [
                    "contact_email", "contact_phone", "website_url", "brand_metadata"
                ]
                
                updated_fields = []
                for field, value in updates.items():
                    if field in allowed_updates and hasattr(brand, field):
                        setattr(brand, field, value)
                        updated_fields.append(field)
                
                if updated_fields:
                    await session.commit()
                    
                    logger.info(
                        "Brand profile updated",
                        brand_id=brand_id,
                        user_id=user_id,
                        updated_fields=updated_fields
                    )
                
                return brand.get_brand_summary()
                
        except Exception as e:
            logger.error("Failed to update brand profile", brand_id=brand_id, error=str(e))
            raise
    
    async def get_brand_statistics(self) -> Dict[str, Any]:
        """Get brand registration statistics."""
        try:
            async with get_db_session() as session:
                # Total brands by status
                status_query = select(
                    Brand.verification_status,
                    func.count(Brand.id).label('count')
                ).group_by(Brand.verification_status)
                
                status_result = await session.execute(status_query)
                status_counts = {row.verification_status.value: row.count for row in status_result}
                
                # Recent registrations (last 30 days)
                thirty_days_ago = datetime.utcnow() - timedelta(days=30)
                recent_query = select(func.count(Brand.id)).where(
                    Brand.created_at >= thirty_days_ago
                )
                recent_result = await session.execute(recent_query)
                recent_registrations = recent_result.scalar() or 0
                
                # Average processing time
                processing_time_query = select(
                    func.avg(
                        func.timestampdiff(
                            'HOUR',
                            Verification.created_at,
                            Verification.completed_at
                        )
                    )
                ).where(
                    and_(
                        Verification.verification_type == VerificationType.BRAND_REGISTRATION,
                        Verification.completed_at.isnot(None)
                    )
                )
                
                processing_result = await session.execute(processing_time_query)
                avg_processing_hours = processing_result.scalar() or 0
                
                return {
                    "total_brands": sum(status_counts.values()),
                    "by_status": status_counts,
                    "recent_registrations_30d": recent_registrations,
                    "average_processing_time_hours": float(avg_processing_hours),
                    "pending_review": status_counts.get("pending", 0) + status_counts.get("under_review", 0)
                }
                
        except Exception as e:
            logger.error("Failed to get brand statistics", error=str(e))
            raise
    
    # Helper methods
    
    async def _check_brand_exists(self, session: AsyncSession, brand_name: str) -> Optional[Brand]:
        """Check if brand name already exists."""
        query = select(Brand).where(Brand.brand_name == brand_name)
        result = await session.execute(query)
        return result.scalar_one_or_none()
    
    async def _process_verification_document(
        self,
        session: AsyncSession,
        verification: Verification,
        doc_data: Dict[str, Any]
    ) -> None:
        """Process a submitted verification document."""
        try:
            # Store document using file storage service
            if self.file_storage_service:
                file_path = await self.file_storage_service.store_verification_document(
                    verification.id,
                    doc_data.get("file_name", ""),
                    doc_data.get("file_content", b""),
                    doc_data.get("content_type", "application/octet-stream")
                )
            else:
                file_path = doc_data.get("file_path", "")
            
            # Add document to verification
            verification.submit_document(
                DocumentType(doc_data["document_type"]),
                file_path,
                doc_data.get("file_name", ""),
                doc_data.get("file_size", 0),
                doc_data.get("content_type", "application/octet-stream")
            )
            
        except Exception as e:
            logger.error("Failed to process verification document", error=str(e))
            raise
    
    async def _generate_brand_zkproof(self, brand: Brand) -> None:
        """Generate zkSNARK proof for brand authenticity."""
        try:
            # Generate a hash-based proof (simplified implementation)
            # In a real implementation, this would use actual zkSNARK circuits
            
            proof_data = f"{brand.brand_name}:{brand.business_registration_number}:{brand.verified_at}"
            proof_hash = hashlib.sha256(proof_data.encode()).hexdigest()
            
            brand.zkproof_hash = proof_hash
            
            logger.info("Generated zkProof for brand", brand_id=brand.id, proof_hash=proof_hash[:16])
            
        except Exception as e:
            logger.error("Failed to generate zkProof", brand_id=brand.id, error=str(e))
    
    async def _send_registration_confirmation(self, brand: Brand, verification: Verification) -> None:
        """Send registration confirmation to brand owner."""
        if not self.notification_service:
            return
        
        try:
            await self.notification_service.send_email(
                to_email=brand.contact_email,
                subject=f"Brand Registration Received - {brand.brand_name}",
                template="brand_registration_confirmation",
                template_data={
                    "brand_name": brand.brand_name,
                    "verification_id": verification.id,
                    "tracking_url": f"/brand/registration/status/{brand.id}"
                }
            )
            
        except Exception as e:
            logger.error("Failed to send registration confirmation", error=str(e))
    
    async def _notify_admin_for_review(self, brand: Brand, verification: Verification) -> None:
        """Notify admin team about new registration for review."""
        if not self.notification_service:
            return
        
        try:
            await self.notification_service.send_alert(
                alert_type="brand_registration_pending",
                message=f"New brand registration: {brand.brand_name} requires review",
                severity="medium",
                recipients=["admin", "brand_review_team"],
                metadata={
                    "brand_id": brand.id,
                    "brand_name": brand.brand_name,
                    "verification_id": verification.id,
                    "contact_email": brand.contact_email
                }
            )
            
        except Exception as e:
            logger.error("Failed to notify admin for review", error=str(e))
    
    async def _send_review_notification(
        self,
        brand: Brand,
        verification: Verification,
        action: str
    ) -> None:
        """Send notification about review decision to brand owner."""
        if not self.notification_service:
            return
        
        try:
            if action == "approve":
                template = "brand_registration_approved"
                subject = f"Brand Registration Approved - {brand.brand_name}"
            elif action == "reject":
                template = "brand_registration_rejected"
                subject = f"Brand Registration Rejected - {brand.brand_name}"
            else:
                template = "brand_registration_info_requested"
                subject = f"Additional Information Required - {brand.brand_name}"
            
            await self.notification_service.send_email(
                to_email=brand.contact_email,
                subject=subject,
                template=template,
                template_data={
                    "brand_name": brand.brand_name,
                    "verification_id": verification.id,
                    "admin_comments": verification.admin_comments or "",
                    "rejection_reason": verification.rejection_reason or "",
                    "portal_url": f"/brand/dashboard/{brand.id}"
                }
            )
            
        except Exception as e:
            logger.error("Failed to send review notification", error=str(e))