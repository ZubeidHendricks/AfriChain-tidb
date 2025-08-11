"""
LLM-powered authenticity analysis agent for counterfeit detection.
"""

import asyncio
import json
import uuid
from decimal import Decimal
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime

import openai
import anthropic
from pydantic import BaseModel, Field
import structlog

from .base import BaseAgent, AgentMessage, AgentResponse, AgentCapability
from ..services.embedding_service import EmbeddingService
from ..services.zkproof_service import ZKProofService
from ..services.brand_protection_service import BrandProtectionService
from ..services.audit_trail_service import AuditTrailService, AuditEventData, AuditEventType
from ..services.proof_verification_cache import ProofVerificationCache
from ..db.repositories.vector_repository import VectorRepository
from ..db.repositories.product_repository import ProductRepository
from ..db.repositories.analysis_repository import AnalysisRepository
from ..models.enums import ProductCategory, ProductStatus
from ..models.zkproof import ProofType, VerificationStatus
from ..core.config import get_settings
from ..core.database import get_db_session


class AuthenticityScore(BaseModel):
    """Structured authenticity analysis result."""
    
    authenticity_score: float = Field(
        ..., 
        ge=0.0, 
        le=100.0,
        description="Overall authenticity score (0-100)"
    )
    confidence: float = Field(
        ..., 
        ge=0.0, 
        le=1.0,
        description="Confidence in the assessment (0.0-1.0)"
    )
    reasoning: str = Field(
        ...,
        description="Detailed explanation of the scoring decision"
    )
    red_flags: List[str] = Field(
        default_factory=list,
        description="List of concerning authenticity indicators"
    )
    positive_indicators: List[str] = Field(
        default_factory=list,
        description="List of positive authenticity signals"
    )
    component_scores: Dict[str, float] = Field(
        default_factory=dict,
        description="Individual component scores"
    )


class ProductAnalysisResult(BaseModel):
    """Complete analysis result for storage and API responses."""
    
    analysis_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    product_id: str = Field(..., description="Product being analyzed")
    agent_id: str = Field(..., description="Agent that performed analysis")
    authenticity_score: float = Field(..., ge=0.0, le=100.0)
    confidence_score: float = Field(..., ge=0.0, le=1.0)
    reasoning: str = Field(..., description="Analysis reasoning")
    comparison_products: List[Dict[str, Any]] = Field(default_factory=list)
    analysis_duration_ms: float = Field(..., description="Analysis time in milliseconds")
    llm_model: str = Field(..., description="LLM model used")
    llm_tokens_used: int = Field(default=0, description="Number of tokens consumed")
    component_scores: Dict[str, float] = Field(default_factory=dict)
    red_flags: List[str] = Field(default_factory=list)
    positive_indicators: List[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class AuthenticityAnalyzer(BaseAgent):
    """
    LLM-powered agent for analyzing product authenticity.
    
    This agent combines multiple data sources and AI analysis to generate
    authenticity scores with detailed reasoning and explanations.
    """
    
    # Scoring weights for different components
    SCORING_WEIGHTS = {
        "description_analysis": 0.25,
        "image_analysis": 0.20,
        "price_analysis": 0.15,
        "supplier_reputation": 0.10,
        "zkproof_verification": 0.20,
        "brand_protection": 0.10
    }
    
    # LLM prompt template
    ANALYSIS_PROMPT = """
Analyze this product for authenticity indicators based on the provided data and comparison with similar authentic products.

Product Details:
- Description: {description}
- Category: {category}
- Price: ${price}
- Brand: {brand}
- Supplier: {supplier_name} (reputation score: {supplier_reputation}/100)

Similar Authentic Products for Comparison:
{comparison_products}

Red Flag Keywords to Watch For:
- "replica", "copy", "fake", "knockoff", "inspired by", "AAA quality"
- Unrealistic pricing for luxury brands
- Suspicious supplier patterns
- Generic or vague descriptions

Provide your analysis in this exact JSON format (no additional text):
{{
  "authenticity_score": <float 0-100>,
  "confidence": <float 0.0-1.0>,
  "reasoning": "<detailed explanation of your assessment>",
  "red_flags": ["<list of concerning indicators found>"],
  "positive_indicators": ["<list of authentic signals found>"],
  "component_scores": {{
    "description_quality": <float 0-100>,
    "price_reasonableness": <float 0-100>,
    "supplier_trustworthiness": <float 0-100>,
    "overall_consistency": <float 0-100>
  }}
}}
"""
    
    def __init__(self, agent_id: str = None):
        """Initialize the authenticity analyzer agent."""
        if not agent_id:
            agent_id = f"authenticity-analyzer-{uuid.uuid4().hex[:8]}"
        
        capabilities = [
            AgentCapability(
                name="authenticity_analysis",
                description="Analyze products for authenticity using LLM and comparison data",
                input_types=["product_analysis_request"],
                output_types=["authenticity_analysis_result"]
            ),
            AgentCapability(
                name="batch_analysis",
                description="Process multiple products for authenticity analysis",
                input_types=["batch_analysis_request"],
                output_types=["batch_analysis_result"]
            )
        ]
        
        super().__init__(
            agent_id=agent_id,
            agent_type="authenticity_analyzer",
            version="1.0.0",
            capabilities=capabilities
        )
        
        # Configuration
        self.settings = get_settings()
        
        # LLM clients
        self.openai_client = openai.AsyncOpenAI(api_key=self.settings.openai_api_key)
        self.anthropic_client = anthropic.AsyncAnthropic(api_key=getattr(self.settings, 'anthropic_api_key', None))
        
        # Service dependencies
        self.embedding_service = EmbeddingService()
        self.zkproof_service = ZKProofService()
        self.brand_protection_service = BrandProtectionService()
        self.audit_trail_service = AuditTrailService()
        self.proof_verification_cache = ProofVerificationCache(
            cache_ttl_seconds=3600,  # 1 hour cache
            max_memory_cache_size=5000,  # Cache up to 5000 verifications
            max_concurrent_verifications=20  # Allow 20 concurrent verifications
        )
        self.vector_repository: Optional[VectorRepository] = None
        self.product_repository: Optional[ProductRepository] = None
        self.analysis_repository: Optional[AnalysisRepository] = None
        
        # Performance tracking
        self.total_analyses = 0
        self.total_analysis_time = 0.0
        self.llm_token_usage = 0
        
        self.logger = structlog.get_logger(
            agent_id=self.agent_id,
            agent_type=self.agent_type
        )
    
    async def start(self) -> None:
        """Start the agent and initialize database connections."""
        await super().start()
        
        # Initialize database repositories
        async with get_db_session() as session:
            self.vector_repository = VectorRepository(session)
            self.product_repository = ProductRepository(session)
            self.analysis_repository = AnalysisRepository(session)
        
        self.logger.info("AuthenticityAnalyzer started with LLM integration")
    
    async def process_message(self, message: AgentMessage) -> AgentResponse:
        """Process incoming messages for authenticity analysis."""
        try:
            if message.message_type == "product_analysis_request":
                return await self._handle_product_analysis(message)
            elif message.message_type == "batch_analysis_request":
                return await self._handle_batch_analysis(message)
            elif message.message_type == "get_analysis_stats":
                return await self._handle_get_stats(message)
            else:
                return AgentResponse(
                    success=False,
                    error=f"Unknown message type: {message.message_type}",
                    processing_time_ms=0.0
                )
                
        except Exception as e:
            self.logger.error(
                "Error processing message",
                message_type=message.message_type,
                error=str(e)
            )
            return AgentResponse(
                success=False,
                error=str(e),
                processing_time_ms=0.0
            )
    
    async def _handle_product_analysis(self, message: AgentMessage) -> AgentResponse:
        """Handle single product analysis request."""
        start_time = asyncio.get_event_loop().time()
        
        try:
            product_id = message.payload.get("product_id")
            if not product_id:
                raise ValueError("product_id is required")
            
            # Perform authenticity analysis
            analysis_result = await self.analyze_product_authenticity(product_id)
            
            processing_time = (asyncio.get_event_loop().time() - start_time) * 1000
            
            return AgentResponse(
                success=True,
                result=analysis_result.dict(),
                processing_time_ms=processing_time
            )
            
        except Exception as e:
            processing_time = (asyncio.get_event_loop().time() - start_time) * 1000
            return AgentResponse(
                success=False,
                error=str(e),
                processing_time_ms=processing_time
            )
    
    async def _handle_batch_analysis(self, message: AgentMessage) -> AgentResponse:
        """Handle batch analysis request for multiple products."""
        start_time = asyncio.get_event_loop().time()
        
        try:
            product_ids = message.payload.get("product_ids", [])
            if not product_ids:
                raise ValueError("product_ids list is required")
            
            # Process products concurrently
            analysis_tasks = [
                self.analyze_product_authenticity(product_id)
                for product_id in product_ids
            ]
            
            results = await asyncio.gather(*analysis_tasks, return_exceptions=True)
            
            # Separate successful results from errors
            successful_results = []
            errors = []
            
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    errors.append({
                        "product_id": product_ids[i],
                        "error": str(result)
                    })
                else:
                    successful_results.append(result.dict())
            
            processing_time = (asyncio.get_event_loop().time() - start_time) * 1000
            
            return AgentResponse(
                success=True,
                result={
                    "successful_analyses": successful_results,
                    "errors": errors,
                    "total_requested": len(product_ids),
                    "successful_count": len(successful_results),
                    "error_count": len(errors)
                },
                processing_time_ms=processing_time
            )
            
        except Exception as e:
            processing_time = (asyncio.get_event_loop().time() - start_time) * 1000
            return AgentResponse(
                success=False,
                error=str(e),
                processing_time_ms=processing_time
            )
    
    async def _handle_get_stats(self, message: AgentMessage) -> AgentResponse:
        """Handle request for agent statistics."""
        stats = {
            "agent_id": self.agent_id,
            "total_analyses": self.total_analyses,
            "average_analysis_time_ms": (
                self.total_analysis_time / self.total_analyses 
                if self.total_analyses > 0 else 0
            ),
            "total_llm_tokens_used": self.llm_token_usage,
            "processed_messages": self.processed_messages,
            "error_count": self.error_count,
            "status": self.status.value,
            "uptime_seconds": (
                (datetime.utcnow() - self.started_at).total_seconds()
                if self.started_at else 0
            )
        }
        
        return AgentResponse(
            success=True,
            result=stats,
            processing_time_ms=1.0
        )
    
    async def analyze_product_authenticity(self, product_id: str) -> ProductAnalysisResult:
        """
        Perform comprehensive authenticity analysis on a product.
        
        Args:
            product_id: UUID of the product to analyze
            
        Returns:
            Complete analysis result with scoring and explanations
        """
        analysis_start = asyncio.get_event_loop().time()
        
        try:
            self.logger.info("Starting authenticity analysis", product_id=product_id)
            
            # 1. Retrieve product data
            async with get_db_session() as session:
                self.product_repository = ProductRepository(session)
                self.vector_repository = VectorRepository(session)
                self.analysis_repository = AnalysisRepository(session)
                
                product = await self.product_repository.get_product_by_id(product_id)
                if not product:
                    raise ValueError(f"Product {product_id} not found")
                
                # 2. Find similar products for comparison
                similar_products = await self._get_similar_products(product)
                
                # 3. Get supplier reputation
                supplier_reputation = await self._get_supplier_reputation(product.supplier_id)
            
            # 4. Check for zkSNARK proofs
            zkproof_verification = await self._verify_zksnark_proofs(product)
            
            # 5. Check brand protection data
            brand_protection_data = await self._analyze_brand_protection(product)
            
            # 6. Perform LLM analysis with enhanced context
            llm_result = await self._perform_llm_analysis(
                product, similar_products, supplier_reputation, 
                zkproof_verification, brand_protection_data
            )
            
            # 7. Calculate final scores with cryptographic verification
            final_score, component_scores = self._calculate_enhanced_score(
                llm_result, product, supplier_reputation,
                zkproof_verification, brand_protection_data
            )
            
            # 6. Create analysis result
            analysis_duration = (asyncio.get_event_loop().time() - analysis_start) * 1000
            
            result = ProductAnalysisResult(
                product_id=str(product_id),
                agent_id=self.agent_id,
                authenticity_score=final_score,
                confidence_score=llm_result.confidence,
                reasoning=llm_result.reasoning,
                comparison_products=[
                    {
                        "product_id": str(p["product_id"]),
                        "similarity_score": p["similarity_score"],
                        "price": p["price"],
                        "brand": p["brand"]
                    }
                    for p in similar_products[:5]  # Top 5 for storage
                ],
                analysis_duration_ms=analysis_duration,
                llm_model="gpt-4",  # Would be dynamic based on actual model used
                llm_tokens_used=getattr(llm_result, 'tokens_used', 0),
                component_scores=component_scores,
                red_flags=llm_result.red_flags,
                positive_indicators=llm_result.positive_indicators
            )
            
            # 7. Store analysis result
            result_with_supplier = result.dict()
            result_with_supplier["supplier_id"] = str(product.supplier_id)
            await self.analysis_repository.create_analysis_result(result_with_supplier)
            
            # 8. Create audit trail entry
            await self._create_analysis_audit_entry(product, result, zkproof_verification)
            
            # 9. Update metrics
            self.total_analyses += 1
            self.total_analysis_time += analysis_duration
            
            self.logger.info(
                "Authenticity analysis completed",
                product_id=product_id,
                authenticity_score=final_score,
                confidence=llm_result.confidence,
                zkproof_verified=zkproof_verification.get("has_valid_proof", False),
                brand_protection_score=brand_protection_data.get("protection_score", 0),
                analysis_time_ms=analysis_duration
            )
            
            return result
            
        except Exception as e:
            self.logger.error(
                "Authenticity analysis failed",
                product_id=product_id,
                error=str(e)
            )
            raise
    
    async def _get_similar_products(self, product) -> List[Dict[str, Any]]:
        """Get similar products for comparison using vector search."""
        try:
            if not product.description_embedding:
                self.logger.warning(
                    "Product has no text embedding, using basic search",
                    product_id=str(product.id)
                )
                # Fallback to basic search by category
                return await self._get_products_by_category(product.category)
            
            # Use vector similarity search
            similar_products = await self.vector_repository.find_similar_products_by_text(
                query_embedding=product.description_embedding,
                category=product.category,
                limit=10,
                similarity_threshold=0.6
            )
            
            # Filter out the product itself
            similar_products = [
                p for p in similar_products 
                if str(p["product_id"]) != str(product.id)
            ]
            
            return similar_products
            
        except Exception as e:
            self.logger.warning(
                "Vector search failed, using fallback",
                product_id=str(product.id),
                error=str(e)
            )
            return await self._get_products_by_category(product.category)
    
    async def _get_products_by_category(self, category: ProductCategory) -> List[Dict[str, Any]]:
        """Fallback method to get products by category."""
        try:
            search_params = {
                "category": category,
                "status": ProductStatus.ACTIVE
            }
            
            products, _ = await self.product_repository.search_products(
                search_params, limit=10, offset=0
            )
            
            # Convert to similar format
            return [
                {
                    "product_id": str(p.id),
                    "description": p.description,
                    "price": float(p.price) if p.price else None,
                    "brand": p.brand,
                    "similarity_score": 0.5  # Default similarity for category match
                }
                for p in products
            ]
            
        except Exception as e:
            self.logger.error("Category search failed", category=category.value, error=str(e))
            return []
    
    async def _get_supplier_reputation(self, supplier_id: str) -> float:
        """Get supplier reputation score."""
        try:
            # This would query the suppliers table for reputation score
            # For now, return a default moderate score
            # In full implementation, this would calculate based on:
            # - Historical analysis results
            # - Return rates
            # - Customer feedback
            # - Verification status
            return 70.0  # Default moderate reputation
            
        except Exception as e:
            self.logger.warning(
                "Failed to get supplier reputation",
                supplier_id=supplier_id,
                error=str(e)
            )
            return 50.0  # Conservative default
    
    async def _perform_llm_analysis(
        self, 
        product, 
        similar_products: List[Dict[str, Any]], 
        supplier_reputation: float
    ) -> AuthenticityScore:
        """Perform LLM-based authenticity analysis."""
        try:
            # Format comparison products for prompt
            comparison_text = "\n".join([
                f"- {p['description'][:100]}... (${p['price']}, Brand: {p['brand']}, Similarity: {p['similarity_score']:.2f})"
                for p in similar_products[:5]
            ])
            
            if not comparison_text:
                comparison_text = "No similar products found for comparison."
            
            # Format the prompt
            prompt = self.ANALYSIS_PROMPT.format(
                description=product.description,
                category=product.category.value,
                price=product.price,
                brand=product.brand or "Unknown",
                supplier_name="Supplier",  # Would get actual supplier name
                supplier_reputation=supplier_reputation,
                comparison_products=comparison_text
            )
            
            # Try OpenAI GPT-4 first
            try:
                return await self._analyze_with_openai(prompt)
            except Exception as openai_error:
                self.logger.warning(
                    "OpenAI analysis failed, trying Anthropic",
                    error=str(openai_error)
                )
                # Fallback to Anthropic Claude
                return await self._analyze_with_anthropic(prompt)
                
        except Exception as e:
            self.logger.error("LLM analysis failed", error=str(e))
            # Return conservative default analysis
            return AuthenticityScore(
                authenticity_score=50.0,
                confidence=0.3,
                reasoning="Analysis failed due to LLM error. Manual review recommended.",
                red_flags=["LLM analysis unavailable"],
                positive_indicators=[],
                component_scores={
                    "description_quality": 50.0,
                    "price_reasonableness": 50.0,
                    "supplier_trustworthiness": supplier_reputation,
                    "overall_consistency": 50.0
                }
            )
    
    async def _analyze_with_openai(self, prompt: str) -> AuthenticityScore:
        """Perform analysis using OpenAI GPT-4."""
        try:
            response = await self.openai_client.chat.completions.create(
                model="gpt-4",
                messages=[
                    {
                        "role": "system",
                        "content": "You are an expert product authenticity analyzer. Provide accurate, detailed analysis in the exact JSON format requested."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                temperature=0.1,  # Low temperature for consistency
                max_tokens=1000
            )
            
            # Extract and parse JSON response
            content = response.choices[0].message.content.strip()
            
            # Remove any markdown formatting
            if content.startswith("```json"):
                content = content[7:]
            if content.endswith("```"):
                content = content[:-3]
            
            analysis_data = json.loads(content)
            
            # Track token usage
            self.llm_token_usage += response.usage.total_tokens
            
            return AuthenticityScore(**analysis_data)
            
        except json.JSONDecodeError as e:
            self.logger.error("Failed to parse OpenAI response JSON", error=str(e))
            raise
        except Exception as e:
            self.logger.error("OpenAI API error", error=str(e))
            raise
    
    async def _analyze_with_anthropic(self, prompt: str) -> AuthenticityScore:
        """Perform analysis using Anthropic Claude (fallback)."""
        try:
            if not self.anthropic_client:
                raise ValueError("Anthropic client not configured")
            
            response = await self.anthropic_client.messages.create(
                model="claude-3-opus-20240229",
                max_tokens=1000,
                temperature=0.1,
                messages=[
                    {
                        "role": "user",
                        "content": f"You are an expert product authenticity analyzer. {prompt}"
                    }
                ]
            )
            
            content = response.content[0].text.strip()
            
            # Remove any markdown formatting
            if content.startswith("```json"):
                content = content[7:]
            if content.endswith("```"):
                content = content[:-3]
            
            analysis_data = json.loads(content)
            
            return AuthenticityScore(**analysis_data)
            
        except json.JSONDecodeError as e:
            self.logger.error("Failed to parse Anthropic response JSON", error=str(e))
            raise
        except Exception as e:
            self.logger.error("Anthropic API error", error=str(e))
            raise
    
    def _calculate_final_score(
        self, 
        llm_result: AuthenticityScore, 
        product, 
        supplier_reputation: float
    ) -> Tuple[float, Dict[str, float]]:
        """Calculate final weighted authenticity score."""
        try:
            # Extract component scores from LLM result
            component_scores = llm_result.component_scores.copy()
            
            # Ensure all required components are present
            if "supplier_trustworthiness" not in component_scores:
                component_scores["supplier_trustworthiness"] = supplier_reputation
            
            # Calculate price analysis score
            price_score = self._analyze_price_reasonableness(product, supplier_reputation)
            if "price_reasonableness" not in component_scores:
                component_scores["price_reasonableness"] = price_score
            
            # Apply weighted scoring
            weighted_score = (
                component_scores.get("description_quality", llm_result.authenticity_score) * self.SCORING_WEIGHTS["description_analysis"] +
                component_scores.get("price_reasonableness", price_score) * self.SCORING_WEIGHTS["price_analysis"] +
                component_scores.get("supplier_trustworthiness", supplier_reputation) * self.SCORING_WEIGHTS["supplier_reputation"] +
                component_scores.get("overall_consistency", llm_result.authenticity_score) * self.SCORING_WEIGHTS["image_analysis"]
            )
            
            # Apply confidence adjustment
            final_score = weighted_score * llm_result.confidence + (1 - llm_result.confidence) * 50.0
            
            # Ensure score is within bounds
            final_score = max(0.0, min(100.0, final_score))
            
            return final_score, component_scores
            
        except Exception as e:
            self.logger.error("Score calculation failed", error=str(e))
            return llm_result.authenticity_score, llm_result.component_scores
    
    def _analyze_price_reasonableness(self, product, supplier_reputation: float) -> float:
        """Analyze if price is reasonable for the product category and brand."""
        try:
            # This is a simplified price analysis
            # In full implementation, this would use market data
            
            price = float(product.price) if product.price else 0.0
            category = product.category
            brand = product.brand or ""
            
            # Define rough price ranges by category (in USD)
            category_ranges = {
                ProductCategory.ELECTRONICS: (50, 2000),
                ProductCategory.CLOTHING: (20, 500),
                ProductCategory.BAGS: (30, 1500),
                ProductCategory.SHOES: (40, 800),
                ProductCategory.WATCHES: (100, 5000),
                ProductCategory.JEWELRY: (50, 10000),
                ProductCategory.ACCESSORIES: (10, 300)
            }
            
            min_price, max_price = category_ranges.get(category, (10, 1000))
            
            # Check for luxury brands (simplified)
            luxury_brands = ["rolex", "louis", "gucci", "prada", "chanel", "hermes"]
            is_luxury = any(lux in brand.lower() for lux in luxury_brands)
            
            if is_luxury:
                min_price *= 5  # Luxury items should be significantly more expensive
            
            # Score based on price reasonableness
            if price < min_price * 0.1:  # Suspiciously low
                return 20.0
            elif price < min_price * 0.3:  # Very low
                return 40.0
            elif min_price <= price <= max_price:  # Reasonable range
                return 85.0
            elif price <= max_price * 2:  # Slightly high but acceptable
                return 75.0
            else:  # Suspiciously high
                return 60.0
                
        except Exception as e:
            self.logger.warning("Price analysis failed", error=str(e))
            return 70.0  # Default moderate score
    
    async def _verify_zksnark_proofs(self, product) -> Dict[str, Any]:
        """
        Verify zkSNARK proofs for the product and related entities.
        
        Args:
            product: Product to verify proofs for
            
        Returns:
            Dictionary with verification results
        """
        try:
            verification_result = {
                "has_valid_proof": False,
                "proof_verification_score": 0.0,
                "proof_types_verified": [],
                "proof_details": {},
                "error_messages": []
            }
            
            # Check for product authenticity proof
            product_proof = await self.zkproof_service.get_proof_by_entity(
                str(product.id), ProofType.PRODUCT_AUTHENTICITY
            )
            
            if product_proof:
                # Verify the proof using cache for better performance
                verification = await self.proof_verification_cache.verify_proof_cached(
                    product_proof.id, priority=8  # High priority for real-time analysis
                )
                
                if verification.is_valid:
                    verification_result["has_valid_proof"] = True
                    verification_result["proof_verification_score"] = 95.0
                    verification_result["proof_types_verified"].append("product_authenticity")
                    verification_result["proof_details"]["product_authenticity"] = {
                        "proof_id": product_proof.id,
                        "generated_at": product_proof.generated_at.isoformat(),
                        "verified_at": verification.verification_time.isoformat(),
                        "proof_hash": product_proof.proof_hash
                    }
                    
                    self.logger.info(
                        "Valid zkSNARK proof found for product",
                        product_id=str(product.id),
                        proof_id=product_proof.id
                    )
                else:
                    verification_result["error_messages"].append(
                        f"Product proof verification failed: {verification.error_message}"
                    )
                    verification_result["proof_verification_score"] = 10.0
            
            # Check for brand verification proof if product has brand
            if hasattr(product, 'brand_id') and product.brand_id:
                brand_proof = await self.zkproof_service.get_proof_by_entity(
                    str(product.brand_id), ProofType.BRAND_VERIFICATION
                )
                
                if brand_proof:
                    brand_verification = await self.proof_verification_cache.verify_proof_cached(
                        brand_proof.id, priority=7  # High priority for brand verification
                    )
                    
                    if brand_verification.is_valid:
                        verification_result["proof_types_verified"].append("brand_verification")
                        verification_result["proof_details"]["brand_verification"] = {
                            "proof_id": brand_proof.id,
                            "generated_at": brand_proof.generated_at.isoformat(),
                            "verified_at": brand_verification.verification_time.isoformat(),
                            "proof_hash": brand_proof.proof_hash
                        }
                        
                        # Boost score for brand verification
                        if verification_result["proof_verification_score"] > 0:
                            verification_result["proof_verification_score"] = min(100.0,
                                verification_result["proof_verification_score"] + 10.0
                            )
                        else:
                            verification_result["proof_verification_score"] = 80.0
                            verification_result["has_valid_proof"] = True
                    else:
                        verification_result["error_messages"].append(
                            f"Brand proof verification failed: {brand_verification.error_message}"
                        )
            
            # If no proofs found, this is not necessarily bad (graceful degradation)
            if not verification_result["proof_types_verified"]:
                verification_result["proof_verification_score"] = 50.0  # Neutral score
                verification_result["error_messages"].append("No zkSNARK proofs available for verification")
            
            return verification_result
            
        except Exception as e:
            self.logger.error("zkSNARK proof verification failed", product_id=str(product.id), error=str(e))
            return {
                "has_valid_proof": False,
                "proof_verification_score": 50.0,  # Neutral on failure
                "proof_types_verified": [],
                "proof_details": {},
                "error_messages": [f"Proof verification error: {str(e)}"]
            }
    
    async def _analyze_brand_protection(self, product) -> Dict[str, Any]:
        """
        Analyze product using brand protection data.
        
        Args:
            product: Product to analyze
            
        Returns:
            Brand protection analysis results
        """
        try:
            protection_result = {
                "protection_score": 50.0,
                "brand_match_found": False,
                "violation_indicators": [],
                "brand_enhancement_applied": False,
                "brand_analysis_details": {}
            }
            
            # Get base authenticity score for brand enhancement
            base_score = 50.0  # Placeholder - would be calculated from basic analysis
            
            # Apply brand protection analysis
            enhanced_score, brand_analysis = await self.brand_protection_service.enhance_product_analysis(
                product, base_score
            )
            
            if brand_analysis.get("brand_matches"):
                protection_result["brand_match_found"] = True
                protection_result["brand_enhancement_applied"] = True
                protection_result["protection_score"] = min(enhanced_score, 100.0)
                protection_result["brand_analysis_details"] = brand_analysis
                
                # Extract violation indicators
                violations = brand_analysis.get("violations_detected", [])
                for violation in violations:
                    protection_result["violation_indicators"].append({
                        "type": violation.get("type", "unknown"),
                        "severity": violation.get("severity", "unknown"),
                        "description": violation.get("description", "")
                    })
                
                self.logger.info(
                    "Brand protection analysis completed",
                    product_id=str(product.id),
                    brand_matches=len(brand_analysis.get("brand_matches", [])),
                    violations=len(violations),
                    enhanced_score=enhanced_score
                )
            else:
                # No brand matches - neutral score
                protection_result["protection_score"] = 50.0
                protection_result["brand_analysis_details"] = brand_analysis
            
            return protection_result
            
        except Exception as e:
            self.logger.error("Brand protection analysis failed", product_id=str(product.id), error=str(e))
            return {
                "protection_score": 50.0,
                "brand_match_found": False,
                "violation_indicators": [],
                "brand_enhancement_applied": False,
                "brand_analysis_details": {"error": str(e)}
            }
    
    async def _perform_llm_analysis(
        self, 
        product, 
        similar_products: List[Dict[str, Any]], 
        supplier_reputation: float,
        zkproof_verification: Dict[str, Any],
        brand_protection_data: Dict[str, Any]
    ) -> AuthenticityScore:
        """Enhanced LLM analysis with zkSNARK and brand protection context."""
        try:
            # Enhanced prompt with cryptographic verification context
            enhanced_prompt = self.ANALYSIS_PROMPT + f"""

Cryptographic Verification Context:
- zkSNARK Proof Status: {"VERIFIED" if zkproof_verification.get("has_valid_proof") else "NOT AVAILABLE"}
- Proof Types Verified: {", ".join(zkproof_verification.get("proof_types_verified", []))}
- Proof Verification Score: {zkproof_verification.get("proof_verification_score", 0)}/100

Brand Protection Analysis:
- Brand Match Found: {"YES" if brand_protection_data.get("brand_match_found") else "NO"}
- Protection Score: {brand_protection_data.get("protection_score", 0)}/100
- Violation Indicators: {len(brand_protection_data.get("violation_indicators", []))}

IMPORTANT: Factor in cryptographic verification status when scoring:
- Products with valid zkSNARK proofs should receive significant authenticity boost
- Products with brand protection violations should be penalized
- Consider the technical security measures in place
            """
            
            # Format comparison products
            comparison_text = ""
            for i, comp in enumerate(similar_products[:3], 1):
                comparison_text += f"{i}. {comp['description'][:100]}... (${comp['price']}, similarity: {comp['similarity_score']:.2f})\n"
            
            if not comparison_text:
                comparison_text = "No similar products found for comparison."
            
            # Create the full prompt
            full_prompt = enhanced_prompt.format(
                description=product.description or "No description available",
                category=product.category.value if product.category else "Unknown",
                price=product.price or 0.0,
                brand=product.brand or "Unknown",
                supplier_name=getattr(product, 'supplier_name', 'Unknown'),
                supplier_reputation=supplier_reputation,
                comparison_products=comparison_text
            )
            
            # Call LLM with enhanced context
            response = await self.openai_client.chat.completions.create(
                model="gpt-4",
                messages=[
                    {
                        "role": "system",
                        "content": "You are an expert product authenticity analyzer with knowledge of cryptographic verification systems and brand protection. Analyze products carefully considering all available technical verification data."
                    },
                    {
                        "role": "user",
                        "content": full_prompt
                    }
                ],
                temperature=0.1,
                max_tokens=1000
            )
            
            # Parse LLM response
            llm_text = response.choices[0].message.content.strip()
            
            # Try to parse as JSON
            try:
                llm_json = json.loads(llm_text)
                
                result = AuthenticityScore(
                    authenticity_score=float(llm_json.get("authenticity_score", 50.0)),
                    confidence=float(llm_json.get("confidence", 0.5)),
                    reasoning=llm_json.get("reasoning", "Analysis completed"),
                    red_flags=llm_json.get("red_flags", []),
                    positive_indicators=llm_json.get("positive_indicators", []),
                    component_scores=llm_json.get("component_scores", {})
                )
                
                # Add cryptographic verification indicators
                if zkproof_verification.get("has_valid_proof"):
                    result.positive_indicators.append("Valid zkSNARK cryptographic proof verified")
                
                if brand_protection_data.get("brand_match_found"):
                    if brand_protection_data.get("violation_indicators"):
                        result.red_flags.extend([
                            f"Brand violation: {v['description']}" 
                            for v in brand_protection_data.get("violation_indicators", [])
                        ])
                    else:
                        result.positive_indicators.append("Verified against official brand catalog")
                
                # Store token usage
                result.tokens_used = response.usage.total_tokens
                
                return result
                
            except json.JSONDecodeError:
                self.logger.warning("Failed to parse LLM JSON response", response=llm_text)
                # Return default result
                return AuthenticityScore(
                    authenticity_score=50.0,
                    confidence=0.3,
                    reasoning="Failed to parse LLM analysis",
                    red_flags=["Analysis parsing error"],
                    positive_indicators=[],
                    component_scores={}
                )
                
        except Exception as e:
            self.logger.error("LLM analysis failed", error=str(e))
            return AuthenticityScore(
                authenticity_score=50.0,
                confidence=0.1,
                reasoning=f"Analysis failed: {str(e)}",
                red_flags=["System error during analysis"],
                positive_indicators=[],
                component_scores={}
            )
    
    def _calculate_enhanced_score(
        self,
        llm_result: AuthenticityScore,
        product,
        supplier_reputation: float,
        zkproof_verification: Dict[str, Any],
        brand_protection_data: Dict[str, Any]
    ) -> Tuple[float, Dict[str, float]]:
        """Calculate final score with enhanced cryptographic verification weighting."""
        try:
            component_scores = {
                "description_analysis": llm_result.component_scores.get("description_quality", 50.0),
                "price_analysis": llm_result.component_scores.get("price_reasonableness", 50.0),
                "supplier_reputation": supplier_reputation,
                "zkproof_verification": zkproof_verification.get("proof_verification_score", 50.0),
                "brand_protection": brand_protection_data.get("protection_score", 50.0),
                "llm_overall": llm_result.authenticity_score
            }
            
            # Apply enhanced scoring weights
            weighted_score = (
                component_scores["description_analysis"] * self.SCORING_WEIGHTS["description_analysis"] +
                component_scores["price_analysis"] * self.SCORING_WEIGHTS["price_analysis"] +
                component_scores["supplier_reputation"] * self.SCORING_WEIGHTS["supplier_reputation"] +
                component_scores["zkproof_verification"] * self.SCORING_WEIGHTS["zkproof_verification"] +
                component_scores["brand_protection"] * self.SCORING_WEIGHTS["brand_protection"] +
                component_scores["llm_overall"] * 0.20  # Base LLM analysis
            )
            
            # Apply cryptographic verification boost
            if zkproof_verification.get("has_valid_proof"):
                # Significant boost for cryptographically verified products
                crypto_boost = 15.0 * (zkproof_verification.get("proof_verification_score", 0) / 100.0)
                weighted_score = min(100.0, weighted_score + crypto_boost)
                component_scores["crypto_boost"] = crypto_boost
            
            # Apply brand protection penalty/boost
            if brand_protection_data.get("brand_match_found"):
                violation_count = len(brand_protection_data.get("violation_indicators", []))
                if violation_count > 0:
                    # Penalty for brand violations
                    violation_penalty = min(20.0, violation_count * 5.0)
                    weighted_score = max(0.0, weighted_score - violation_penalty)
                    component_scores["brand_violation_penalty"] = -violation_penalty
                else:
                    # Boost for verified brand match without violations
                    brand_boost = 10.0
                    weighted_score = min(100.0, weighted_score + brand_boost)
                    component_scores["brand_verification_boost"] = brand_boost
            
            # Ensure score is within bounds
            final_score = max(0.0, min(100.0, weighted_score))
            
            return final_score, component_scores
            
        except Exception as e:
            self.logger.error("Score calculation failed", error=str(e))
            return 50.0, {"error": "Score calculation failed"}
    
    async def _create_analysis_audit_entry(
        self, 
        product, 
        analysis_result: ProductAnalysisResult,
        zkproof_verification: Dict[str, Any]
    ) -> None:
        """Create audit trail entry for the analysis."""
        try:
            audit_data = AuditEventData(
                event_type=AuditEventType.PRODUCT_ANALYSIS,
                event_id=analysis_result.analysis_id,
                entity_id=str(product.id),
                entity_type="product",
                actor_id=self.agent_id,
                actor_type="agent",
                event_data={
                    "analysis_result": {
                        "authenticity_score": analysis_result.authenticity_score,
                        "confidence_score": analysis_result.confidence_score,
                        "reasoning": analysis_result.reasoning[:500],  # Truncate for storage
                        "component_scores": analysis_result.component_scores,
                        "red_flags_count": len(analysis_result.red_flags),
                        "positive_indicators_count": len(analysis_result.positive_indicators)
                    },
                    "verification_details": {
                        "zkproof_verified": zkproof_verification.get("has_valid_proof", False),
                        "proof_types": zkproof_verification.get("proof_types_verified", []),
                        "proof_score": zkproof_verification.get("proof_verification_score", 0)
                    },
                    "product_metadata": {
                        "category": product.category.value if product.category else None,
                        "brand": product.brand,
                        "price": float(product.price) if product.price else None
                    }
                },
                event_timestamp=datetime.utcnow()
            )
            
            await self.audit_trail_service.create_audit_entry(audit_data)
            
        except Exception as e:
            self.logger.error("Failed to create audit entry", analysis_id=analysis_result.analysis_id, error=str(e))
    
