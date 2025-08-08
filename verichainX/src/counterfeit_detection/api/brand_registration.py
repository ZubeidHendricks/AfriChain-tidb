"""
Brand Registration API endpoints for brand registration and management.

Provides REST API endpoints for brand registration, verification workflow,
product submission, and brand protection features.
"""

from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, validator
import structlog

from ..core.auth import get_current_user, get_current_admin_user
from ..core.database import get_db_session
from ..services.brand_registration_service import BrandRegistrationService, BrandRegistrationData
from ..services.brand_product_service import BrandProductService, ProductSubmissionData
from ..services.brand_protection_service import BrandProtectionService
from ..models.user import User
from ..models.enums import ProductCategory

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/brand", tags=["brand-registration"])


# Request/Response Models

class BrandRegistrationRequest(BaseModel):
    """Request model for brand registration."""
    brand_name: str = Field(..., min_length=2, max_length=200)
    legal_entity_name: str = Field(..., min_length=2, max_length=300)
    business_registration_number: Optional[str] = Field(None, max_length=100)
    trademark_numbers: List[str] = Field(default_factory=list)
    contact_email: str = Field(..., regex=r'^[^@]+@[^@]+\.[^@]+$')
    contact_phone: Optional[str] = Field(None, max_length=50)
    website_url: Optional[str] = Field(None, max_length=500)
    brand_metadata: Optional[Dict[str, Any]] = None


class ProductSubmissionRequest(BaseModel):
    """Request model for product submission."""
    official_product_name: str = Field(..., min_length=2, max_length=300)
    official_description: str = Field(..., min_length=10)
    category: ProductCategory
    official_price_min: Optional[float] = Field(None, gt=0)
    official_price_max: Optional[float] = Field(None, gt=0)
    currency: str = Field(default="USD", max_length=3)
    official_images: List[str] = Field(default_factory=list)
    product_specifications: Optional[Dict[str, Any]] = None
    authorized_distributors: List[str] = Field(default_factory=list)
    sku: Optional[str] = Field(None, max_length=100)
    barcode: Optional[str] = Field(None, max_length=50)
    similarity_threshold: float = Field(default=0.85, ge=0.1, le=1.0)
    priority_level: int = Field(default=1, ge=1, le=3)
    
    @validator('official_price_max')
    def price_max_greater_than_min(cls, v, values):
        if v is not None and 'official_price_min' in values and values['official_price_min'] is not None:
            if v < values['official_price_min']:
                raise ValueError('official_price_max must be greater than or equal to official_price_min')
        return v


class BrandVerificationRequest(BaseModel):
    """Request model for brand verification by admin."""
    action: str = Field(..., regex=r'^(approve|reject|request_info)$')
    notes: Optional[str] = None
    rejection_reason: Optional[str] = None


class ProductReviewRequest(BaseModel):
    """Request model for product review by admin."""
    action: str = Field(..., regex=r'^(approve|reject|request_revision)$')
    notes: Optional[str] = None
    rejection_reason: Optional[str] = None


class BrandUpdateRequest(BaseModel):
    """Request model for brand profile updates."""
    contact_email: Optional[str] = Field(None, regex=r'^[^@]+@[^@]+\.[^@]+$')
    contact_phone: Optional[str] = Field(None, max_length=50)
    website_url: Optional[str] = Field(None, max_length=500)
    brand_metadata: Optional[Dict[str, Any]] = None


# Dependency injection

async def get_brand_registration_service() -> BrandRegistrationService:
    """Get brand registration service instance."""
    return BrandRegistrationService()


async def get_brand_product_service() -> BrandProductService:
    """Get brand product service instance."""
    return BrandProductService()


async def get_brand_protection_service() -> BrandProtectionService:
    """Get brand protection service instance."""
    return BrandProtectionService()


# Brand Registration Endpoints

@router.post("/register")
async def register_brand(
    registration_request: BrandRegistrationRequest,
    current_user: User = Depends(get_current_user),
    brand_service: BrandRegistrationService = Depends(get_brand_registration_service)
):
    """
    Register a new brand for counterfeit detection.
    
    Submits brand registration application with required documentation
    for verification and approval by admin team.
    """
    try:
        registration_data = BrandRegistrationData(
            brand_name=registration_request.brand_name,
            legal_entity_name=registration_request.legal_entity_name,
            business_registration_number=registration_request.business_registration_number,
            trademark_numbers=registration_request.trademark_numbers,
            contact_email=registration_request.contact_email,
            contact_phone=registration_request.contact_phone,
            website_url=registration_request.website_url,
            submitted_by_user_id=current_user.id,
            verification_documents=[],  # Documents uploaded separately
            brand_metadata=registration_request.brand_metadata
        )
        
        brand_id, verification_id = await brand_service.submit_brand_registration(registration_data)
        
        logger.info(
            "Brand registration submitted",
            brand_id=brand_id,
            user_id=current_user.id,
            brand_name=registration_request.brand_name
        )
        
        return {
            "message": "Brand registration submitted successfully",
            "brand_id": brand_id,
            "verification_id": verification_id,
            "status": "pending_verification",
            "next_steps": [
                "Upload required verification documents",
                "Wait for admin review",
                "Check registration status regularly"
            ]
        }
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Failed to register brand", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to register brand")


@router.post("/upload-documents/{brand_id}")
async def upload_verification_documents(
    brand_id: str,
    files: List[UploadFile] = File(...),
    document_types: List[str] = Form(...),
    current_user: User = Depends(get_current_user)
):
    """
    Upload verification documents for brand registration.
    
    Accepts multiple document files with corresponding document types
    for brand verification process.
    """
    try:
        if len(files) != len(document_types):
            raise HTTPException(
                status_code=400,
                detail="Number of files must match number of document types"
            )
        
        uploaded_documents = []
        
        for file, doc_type in zip(files, document_types):
            # Validate file
            if file.size > 10 * 1024 * 1024:  # 10MB limit
                raise HTTPException(
                    status_code=400,
                    detail=f"File {file.filename} exceeds 10MB limit"
                )
            
            # Read file content
            file_content = await file.read()
            
            document_data = {
                "document_type": doc_type,
                "file_name": file.filename,
                "file_content": file_content,
                "content_type": file.content_type,
                "file_size": file.size
            }
            
            uploaded_documents.append(document_data)
        
        # Store documents (implementation would use file storage service)
        # For now, return success response
        
        logger.info(
            "Verification documents uploaded",
            brand_id=brand_id,
            user_id=current_user.id,
            document_count=len(files)
        )
        
        return {
            "message": "Documents uploaded successfully",
            "brand_id": brand_id,
            "documents_uploaded": len(files),
            "document_types": document_types
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to upload documents", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to upload documents")


@router.get("/status/{brand_id}")
async def get_brand_registration_status(
    brand_id: str,
    current_user: User = Depends(get_current_user),
    brand_service: BrandRegistrationService = Depends(get_brand_registration_service)
):
    """
    Get brand registration status and verification progress.
    
    Returns current verification status, required documents,
    and next steps in the registration process.
    """
    try:
        status = await brand_service.get_brand_registration_status(brand_id, current_user.id)
        
        return JSONResponse(content=status)
        
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Failed to get brand status", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to retrieve brand status")


@router.put("/profile/{brand_id}")
async def update_brand_profile(
    brand_id: str,
    update_request: BrandUpdateRequest,
    current_user: User = Depends(get_current_user),
    brand_service: BrandRegistrationService = Depends(get_brand_registration_service)
):
    """
    Update brand profile information.
    
    Allows verified brands to update contact information and metadata.
    """
    try:
        updates = {k: v for k, v in update_request.dict().items() if v is not None}
        
        updated_brand = await brand_service.update_brand_profile(
            brand_id, current_user.id, updates
        )
        
        logger.info(
            "Brand profile updated",
            brand_id=brand_id,
            user_id=current_user.id,
            fields_updated=list(updates.keys())
        )
        
        return updated_brand
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Failed to update brand profile", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to update brand profile")


# Product Submission Endpoints

@router.post("/products/{brand_id}")
async def submit_product(
    brand_id: str,
    product_request: ProductSubmissionRequest,
    current_user: User = Depends(get_current_user),
    product_service: BrandProductService = Depends(get_brand_product_service)
):
    """
    Submit official product for brand protection.
    
    Adds official product to brand catalog for enhanced
    counterfeit detection and brand protection.
    """
    try:
        submission_data = ProductSubmissionData(
            brand_id=brand_id,
            official_product_name=product_request.official_product_name,
            official_description=product_request.official_description,
            category=product_request.category,
            official_price_min=product_request.official_price_min,
            official_price_max=product_request.official_price_max,
            currency=product_request.currency,
            official_images=product_request.official_images,
            product_specifications=product_request.product_specifications,
            authorized_distributors=product_request.authorized_distributors,
            sku=product_request.sku,
            barcode=product_request.barcode,
            similarity_threshold=product_request.similarity_threshold,
            priority_level=product_request.priority_level,
            submitted_by_user_id=current_user.id
        )
        
        product_id = await product_service.submit_product(submission_data)
        
        logger.info(
            "Product submitted",
            brand_id=brand_id,
            product_id=product_id,
            user_id=current_user.id,
            product_name=product_request.official_product_name
        )
        
        return {
            "message": "Product submitted successfully",
            "product_id": product_id,
            "brand_id": brand_id,
            "status": "pending_approval",
            "next_steps": [
                "Wait for admin review",
                "Check product status",
                "Product will be available for detection once approved"
            ]
        }
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Failed to submit product", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to submit product")


@router.post("/products/{brand_id}/bulk-upload")
async def bulk_upload_products(
    brand_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    product_service: BrandProductService = Depends(get_brand_product_service)
):
    """
    Bulk upload products from CSV file.
    
    Accepts CSV file with product data for bulk product submission.
    Processing is done in background for large files.
    """
    try:
        # Validate file type
        if not file.filename.endswith('.csv'):
            raise HTTPException(status_code=400, detail="Only CSV files are supported")
        
        # Read and validate file size
        if file.size > 50 * 1024 * 1024:  # 50MB limit
            raise HTTPException(status_code=400, detail="File size exceeds 50MB limit")
        
        # Read CSV content
        csv_content = (await file.read()).decode('utf-8')
        
        # Parse CSV products
        products_data = await product_service.parse_csv_products(csv_content)
        
        if not products_data:
            raise HTTPException(status_code=400, detail="No valid products found in CSV file")
        
        if len(products_data) > 1000:  # Limit bulk uploads
            raise HTTPException(status_code=400, detail="Maximum 1000 products per bulk upload")
        
        # Process bulk upload in background
        background_tasks.add_task(
            _process_bulk_upload,
            product_service,
            brand_id,
            products_data,
            current_user.id
        )
        
        logger.info(
            "Bulk product upload started",
            brand_id=brand_id,
            user_id=current_user.id,
            product_count=len(products_data)
        )
        
        return {
            "message": "Bulk upload started",
            "brand_id": brand_id,
            "products_count": len(products_data),
            "status": "processing",
            "estimated_completion": "Products will be processed in the background"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to start bulk upload", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to start bulk upload")


@router.get("/products/{brand_id}")
async def get_brand_products(
    brand_id: str,
    status: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    product_service: BrandProductService = Depends(get_brand_product_service)
):
    """
    Get products for a specific brand.
    
    Returns list of products with optional status filtering
    and pagination support.
    """
    try:
        products = await product_service.get_brand_products(
            brand_id, status, limit, offset
        )
        
        return {
            "brand_id": brand_id,
            "products": products,
            "pagination": {
                "limit": limit,
                "offset": offset,
                "total": len(products)
            }
        }
        
    except Exception as e:
        logger.error("Failed to get brand products", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to retrieve brand products")


@router.put("/products/{product_id}")
async def update_product(
    product_id: str,
    update_request: ProductSubmissionRequest,
    current_user: User = Depends(get_current_user),
    product_service: BrandProductService = Depends(get_brand_product_service)
):
    """
    Update product information.
    
    Allows updates to pending or revision-required products only.
    """
    try:
        updates = update_request.dict(exclude_unset=True)
        
        updated_product = await product_service.update_product(
            product_id, current_user.id, updates
        )
        
        logger.info(
            "Product updated",
            product_id=product_id,
            user_id=current_user.id
        )
        
        return updated_product
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Failed to update product", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to update product")


# Admin Endpoints

@router.get("/admin/pending-registrations")
async def get_pending_registrations(
    limit: int = 50,
    offset: int = 0,
    current_admin: User = Depends(get_current_admin_user),
    brand_service: BrandRegistrationService = Depends(get_brand_registration_service)
):
    """
    Get pending brand registrations for admin review.
    
    Returns list of brands awaiting verification with
    document status and review priorities.
    """
    try:
        pending_registrations = await brand_service.get_pending_registrations(limit, offset)
        
        return {
            "pending_registrations": pending_registrations,
            "pagination": {
                "limit": limit,
                "offset": offset,
                "total": len(pending_registrations)
            }
        }
        
    except Exception as e:
        logger.error("Failed to get pending registrations", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to retrieve pending registrations")


@router.post("/admin/verify/{verification_id}")
async def verify_brand_registration(
    verification_id: str,
    verification_request: BrandVerificationRequest,
    current_admin: User = Depends(get_current_admin_user),
    brand_service: BrandRegistrationService = Depends(get_brand_registration_service)
):
    """
    Admin verification of brand registration.
    
    Allows admin to approve, reject, or request additional
    information for brand registration applications.
    """
    try:
        result = await brand_service.review_brand_registration(
            verification_id=verification_id,
            admin_user_id=current_admin.id,
            action=verification_request.action,
            notes=verification_request.notes,
            rejection_reason=verification_request.rejection_reason
        )
        
        logger.info(
            "Brand registration reviewed",
            verification_id=verification_id,
            action=verification_request.action,
            admin_id=current_admin.id
        )
        
        return {
            "message": f"Brand registration {verification_request.action}d successfully",
            "verification_result": result.__dict__
        }
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Failed to verify brand registration", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to verify brand registration")


@router.get("/admin/pending-products")
async def get_pending_product_reviews(
    limit: int = 50,
    offset: int = 0,
    current_admin: User = Depends(get_current_admin_user),
    product_service: BrandProductService = Depends(get_brand_product_service)
):
    """
    Get pending product reviews for admin.
    
    Returns list of products awaiting approval with
    brand information and submission details.
    """
    try:
        pending_products = await product_service.get_pending_product_reviews(limit, offset)
        
        return {
            "pending_products": pending_products,
            "pagination": {
                "limit": limit,
                "offset": offset,
                "total": len(pending_products)
            }
        }
        
    except Exception as e:
        logger.error("Failed to get pending product reviews", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to retrieve pending product reviews")


@router.post("/admin/review-product/{product_id}")
async def review_product_submission(
    product_id: str,
    review_request: ProductReviewRequest,
    current_admin: User = Depends(get_current_admin_user),
    product_service: BrandProductService = Depends(get_brand_product_service)
):
    """
    Admin review of product submission.
    
    Allows admin to approve, reject, or request revisions
    for submitted brand products.
    """
    try:
        result = await product_service.review_product_submission(
            product_id=product_id,
            admin_user_id=current_admin.id,
            action=review_request.action,
            notes=review_request.notes,
            rejection_reason=review_request.rejection_reason
        )
        
        logger.info(
            "Product submission reviewed",
            product_id=product_id,
            action=review_request.action,
            admin_id=current_admin.id
        )
        
        return {
            "message": f"Product {review_request.action}d successfully",
            "review_result": result
        }
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Failed to review product submission", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to review product submission")


# Statistics and Reporting Endpoints

@router.get("/admin/statistics")
async def get_brand_statistics(
    current_admin: User = Depends(get_current_admin_user),
    brand_service: BrandRegistrationService = Depends(get_brand_registration_service),
    product_service: BrandProductService = Depends(get_brand_product_service)
):
    """
    Get brand registration and product statistics for admin dashboard.
    """
    try:
        brand_stats = await brand_service.get_brand_statistics()
        product_stats = await product_service.get_product_statistics()
        
        return {
            "brand_statistics": brand_stats,
            "product_statistics": product_stats,
            "generated_at": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error("Failed to get brand statistics", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to retrieve statistics")


@router.get("/protection/violations/{brand_id}")
async def get_brand_violations(
    brand_id: str,
    days_lookback: int = 7,
    severity: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    protection_service: BrandProtectionService = Depends(get_brand_protection_service)
):
    """
    Get recent brand violation alerts.
    
    Returns potential counterfeiting violations detected
    for the specified brand.
    """
    try:
        violations = await protection_service.get_brand_violation_alerts(
            brand_id, days_lookback, severity
        )
        
        return {
            "brand_id": brand_id,
            "violations": [violation.__dict__ for violation in violations],
            "period_days": days_lookback,
            "severity_filter": severity,
            "total_violations": len(violations)
        }
        
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Failed to get brand violations", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to retrieve brand violations")


@router.get("/protection/report/{brand_id}")
async def get_brand_protection_report(
    brand_id: str,
    days_period: int = 30,
    current_user: User = Depends(get_current_user),
    protection_service: BrandProtectionService = Depends(get_brand_protection_service)
):
    """
    Generate comprehensive brand protection report.
    
    Provides detailed analysis of brand protection effectiveness,
    violation trends, and recommendations.
    """
    try:
        report = await protection_service.generate_brand_protection_report(
            brand_id, days_period
        )
        
        return JSONResponse(content=report)
        
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Failed to generate protection report", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to generate protection report")


# Background Task Functions

async def _process_bulk_upload(
    product_service: BrandProductService,
    brand_id: str,
    products_data: List[Dict[str, Any]],
    user_id: str
):
    """Background task to process bulk product upload."""
    try:
        result = await product_service.submit_products_bulk(
            brand_id, products_data, user_id
        )
        
        logger.info(
            "Bulk upload completed",
            brand_id=brand_id,
            user_id=user_id,
            total=result.total_products,
            successful=result.successful_uploads,
            failed=result.failed_uploads
        )
        
    except Exception as e:
        logger.error("Bulk upload failed", brand_id=brand_id, user_id=user_id, error=str(e))