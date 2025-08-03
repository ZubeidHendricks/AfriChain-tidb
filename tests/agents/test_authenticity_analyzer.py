"""
Tests for AuthenticityAnalyzer agent functionality.
"""

import asyncio
import json
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from src.counterfeit_detection.agents.authenticity_analyzer import (
    AuthenticityAnalyzer,
    AuthenticityScore,
    ProductAnalysisResult
)
from src.counterfeit_detection.agents.base import AgentMessage, AgentResponse
from src.counterfeit_detection.models.enums import ProductCategory, ProductStatus


class TestAuthenticityAnalyzer:
    """Test AuthenticityAnalyzer agent functionality."""
    
    @pytest.fixture
    def mock_openai_client(self):
        """Mock OpenAI client."""
        with patch('openai.AsyncOpenAI') as mock_client:
            # Mock successful chat completion response
            mock_response = MagicMock()
            mock_response.choices = [MagicMock()]
            mock_response.choices[0].message.content = json.dumps({
                "authenticity_score": 75.5,
                "confidence": 0.89,
                "reasoning": "Product shows consistent branding and pricing patterns.",
                "red_flags": ["Generic supplier information"],
                "positive_indicators": ["Detailed specifications", "Reasonable pricing"],
                "component_scores": {
                    "description_quality": 82.0,
                    "price_reasonableness": 78.0,
                    "supplier_trustworthiness": 65.0,
                    "overall_consistency": 81.0
                }
            })
            mock_response.usage.total_tokens = 150
            
            mock_client.return_value.chat.completions.create.return_value = mock_response
            yield mock_client.return_value
    
    @pytest.fixture
    def mock_db_session(self):
        """Mock database session."""
        with patch('src.counterfeit_detection.core.database.get_db_session') as mock_session:
            session_context = AsyncMock()
            session_context.__aenter__ = AsyncMock(return_value=session_context)
            session_context.__aexit__ = AsyncMock(return_value=None)
            mock_session.return_value = session_context
            yield session_context
    
    @pytest.fixture
    def mock_product(self):
        """Mock product for testing."""
        product = MagicMock()
        product.id = uuid4()
        product.description = "High-quality leather handbag with gold hardware"
        product.category = ProductCategory.BAGS
        product.price = Decimal("299.99")
        product.brand = "LuxuryBrand"
        product.supplier_id = uuid4()
        product.description_embedding = [0.1] * 1536  # Mock embedding
        product.status = ProductStatus.ACTIVE
        return product
    
    @pytest.fixture
    def mock_similar_products(self):
        """Mock similar products for comparison."""
        return [
            {
                "product_id": str(uuid4()),
                "description": "Authentic leather handbag with premium materials",
                "price": 320.0,
                "brand": "LuxuryBrand",
                "similarity_score": 0.94
            },
            {
                "product_id": str(uuid4()),
                "description": "Designer handbag with gold accents",
                "price": 285.0,
                "brand": "DesignerBrand",
                "similarity_score": 0.87
            }
        ]
    
    @pytest.fixture
    async def authenticity_analyzer(self, mock_openai_client):
        """Create authenticity analyzer for testing."""
        with patch('src.counterfeit_detection.core.config.get_settings') as mock_settings:
            settings = MagicMock()
            settings.openai_api_key = "test-key"
            settings.anthropic_api_key = None
            mock_settings.return_value = settings
            
            analyzer = AuthenticityAnalyzer("test-analyzer")
            # Don't actually start the agent to avoid Redis dependencies
            analyzer.status = analyzer.status.RUNNING
            yield analyzer
    
    @pytest.mark.asyncio
    async def test_agent_initialization(self):
        """Test agent initialization and capabilities."""
        analyzer = AuthenticityAnalyzer("test-analyzer")
        
        assert analyzer.agent_id == "test-analyzer"
        assert analyzer.agent_type == "authenticity_analyzer"
        assert len(analyzer.capabilities) == 2
        
        capability_names = [cap.name for cap in analyzer.capabilities]
        assert "authenticity_analysis" in capability_names
        assert "batch_analysis" in capability_names
    
    @pytest.mark.asyncio
    async def test_process_message_product_analysis(self, authenticity_analyzer):
        """Test processing product analysis message."""
        product_id = str(uuid4())
        
        with patch.object(authenticity_analyzer, 'analyze_product_authenticity') as mock_analyze:
            mock_result = ProductAnalysisResult(
                product_id=product_id,
                agent_id=authenticity_analyzer.agent_id,
                authenticity_score=75.5,
                confidence_score=0.89,
                reasoning="Test analysis",
                analysis_duration_ms=1500.0,
                llm_model="gpt-4",
                comparison_products=[]
            )
            mock_analyze.return_value = mock_result
            
            message = AgentMessage(
                sender_id="test-sender",
                message_type="product_analysis_request",
                payload={"product_id": product_id}
            )
            
            response = await authenticity_analyzer.process_message(message)
            
            assert response.success is True
            assert response.result["product_id"] == product_id
            assert response.result["authenticity_score"] == 75.5
            mock_analyze.assert_called_once_with(product_id)
    
    @pytest.mark.asyncio
    async def test_process_message_batch_analysis(self, authenticity_analyzer):
        """Test processing batch analysis message."""
        product_ids = [str(uuid4()), str(uuid4())]
        
        with patch.object(authenticity_analyzer, 'analyze_product_authenticity') as mock_analyze:
            mock_results = [
                ProductAnalysisResult(
                    product_id=pid,
                    agent_id=authenticity_analyzer.agent_id,
                    authenticity_score=75.0 + i * 5,
                    confidence_score=0.8 + i * 0.05,
                    reasoning=f"Test analysis {i}",
                    analysis_duration_ms=1500.0,
                    llm_model="gpt-4",
                    comparison_products=[]
                )
                for i, pid in enumerate(product_ids)
            ]
            mock_analyze.side_effect = mock_results
            
            message = AgentMessage(
                sender_id="test-sender",
                message_type="batch_analysis_request",
                payload={"product_ids": product_ids}
            )
            
            response = await authenticity_analyzer.process_message(message)
            
            assert response.success is True
            assert response.result["total_requested"] == 2
            assert response.result["successful_count"] == 2
            assert response.result["error_count"] == 0
            assert len(response.result["successful_analyses"]) == 2
    
    @pytest.mark.asyncio
    async def test_analyze_product_authenticity_success(
        self, 
        authenticity_analyzer, 
        mock_db_session,
        mock_product,
        mock_similar_products
    ):
        """Test successful product authenticity analysis."""
        # Mock repository methods
        mock_product_repo = AsyncMock()
        mock_vector_repo = AsyncMock()
        mock_analysis_repo = AsyncMock()
        
        mock_product_repo.get_product_by_id.return_value = mock_product
        mock_vector_repo.find_similar_products_by_text.return_value = mock_similar_products
        mock_analysis_repo.create_analysis_result.return_value = MagicMock()
        
        with patch('src.counterfeit_detection.db.repositories.product_repository.ProductRepository', return_value=mock_product_repo), \
             patch('src.counterfeit_detection.db.repositories.vector_repository.VectorRepository', return_value=mock_vector_repo), \
             patch('src.counterfeit_detection.db.repositories.analysis_repository.AnalysisRepository', return_value=mock_analysis_repo), \
             patch.object(authenticity_analyzer, '_perform_llm_analysis') as mock_llm:
            
            # Mock LLM analysis result
            mock_llm.return_value = AuthenticityScore(
                authenticity_score=75.5,
                confidence=0.89,
                reasoning="Product shows consistent branding and pricing patterns.",
                red_flags=["Generic supplier information"],
                positive_indicators=["Detailed specifications", "Reasonable pricing"],
                component_scores={
                    "description_quality": 82.0,
                    "price_reasonableness": 78.0,
                    "supplier_trustworthiness": 65.0,
                    "overall_consistency": 81.0
                }
            )
            
            result = await authenticity_analyzer.analyze_product_authenticity(str(mock_product.id))
            
            assert result.product_id == str(mock_product.id)
            assert result.agent_id == authenticity_analyzer.agent_id
            assert result.authenticity_score == 75.5
            assert result.confidence_score == 0.89
            assert len(result.red_flags) == 1
            assert len(result.positive_indicators) == 2
            
            # Verify repositories were called
            mock_product_repo.get_product_by_id.assert_called_once()
            mock_vector_repo.find_similar_products_by_text.assert_called_once()
            mock_analysis_repo.create_analysis_result.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_analyze_product_not_found(self, authenticity_analyzer, mock_db_session):
        """Test analysis of non-existent product."""
        mock_product_repo = AsyncMock()
        mock_product_repo.get_product_by_id.return_value = None
        
        with patch('src.counterfeit_detection.db.repositories.product_repository.ProductRepository', return_value=mock_product_repo):
            with pytest.raises(ValueError, match="Product .+ not found"):
                await authenticity_analyzer.analyze_product_authenticity(str(uuid4()))
    
    @pytest.mark.asyncio
    async def test_get_similar_products_with_embedding(
        self, 
        authenticity_analyzer, 
        mock_product,
        mock_similar_products
    ):
        """Test getting similar products using vector search."""
        mock_vector_repo = AsyncMock()
        mock_vector_repo.find_similar_products_by_text.return_value = mock_similar_products
        authenticity_analyzer.vector_repository = mock_vector_repo
        
        similar_products = await authenticity_analyzer._get_similar_products(mock_product)
        
        assert len(similar_products) == 2
        assert similar_products[0]["similarity_score"] == 0.94
        mock_vector_repo.find_similar_products_by_text.assert_called_once_with(
            query_embedding=mock_product.description_embedding,
            category=mock_product.category,
            limit=10,
            similarity_threshold=0.6
        )
    
    @pytest.mark.asyncio
    async def test_get_similar_products_no_embedding(self, authenticity_analyzer, mock_product):
        """Test fallback when product has no embedding."""
        mock_product.description_embedding = None
        
        mock_products = [MagicMock() for _ in range(3)]
        for i, p in enumerate(mock_products):
            p.id = uuid4()
            p.description = f"Product {i}"
            p.price = Decimal("100.00")
            p.brand = f"Brand{i}"
        
        mock_product_repo = AsyncMock()
        mock_product_repo.search_products.return_value = (mock_products, 3)
        authenticity_analyzer.product_repository = mock_product_repo
        
        similar_products = await authenticity_analyzer._get_similar_products(mock_product)
        
        assert len(similar_products) == 3
        assert all(p["similarity_score"] == 0.5 for p in similar_products)  # Default similarity
        mock_product_repo.search_products.assert_called_once()
    
    def test_calculate_final_score(self, authenticity_analyzer):
        """Test final score calculation with weighted components."""
        llm_result = AuthenticityScore(
            authenticity_score=80.0,
            confidence=0.9,
            reasoning="Test reasoning",
            red_flags=[],
            positive_indicators=[],
            component_scores={
                "description_quality": 85.0,
                "price_reasonableness": 75.0,
                "supplier_trustworthiness": 70.0,
                "overall_consistency": 80.0
            }
        )
        
        product = MagicMock()
        supplier_reputation = 70.0
        
        final_score, component_scores = authenticity_analyzer._calculate_final_score(
            llm_result, product, supplier_reputation
        )
        
        # Should be weighted average adjusted by confidence
        expected_weighted = (
            85.0 * 0.4 +  # description
            75.0 * 0.2 +  # price  
            70.0 * 0.1 +  # supplier
            80.0 * 0.3    # image/consistency
        )
        expected_final = expected_weighted * 0.9 + (1 - 0.9) * 50.0
        
        assert abs(final_score - expected_final) < 0.1
        assert "supplier_trustworthiness" in component_scores
    
    def test_analyze_price_reasonableness(self, authenticity_analyzer):
        """Test price reasonableness analysis."""
        # Test normal price
        product = MagicMock()
        product.price = Decimal("150.00")
        product.category = ProductCategory.ELECTRONICS
        product.brand = "NormalBrand"
        
        score = authenticity_analyzer._analyze_price_reasonableness(product, 70.0)
        assert score == 85.0  # Should be in reasonable range
        
        # Test suspiciously low price
        product.price = Decimal("5.00")
        score = authenticity_analyzer._analyze_price_reasonableness(product, 70.0)
        assert score == 20.0  # Should be flagged as suspicious
        
        # Test luxury brand with normal price
        product.price = Decimal("500.00")
        product.brand = "Rolex"
        score = authenticity_analyzer._analyze_price_reasonableness(product, 70.0)
        assert score == 85.0  # Should be reasonable for luxury
        
        # Test luxury brand with suspiciously low price
        product.price = Decimal("50.00")
        score = authenticity_analyzer._analyze_price_reasonableness(product, 70.0)
        assert score == 20.0  # Should be flagged as very suspicious
    
    @pytest.mark.asyncio
    async def test_llm_analysis_openai_success(self, authenticity_analyzer, mock_openai_client):
        """Test successful LLM analysis with OpenAI."""
        product = MagicMock()
        product.description = "Test product"
        product.category = ProductCategory.ELECTRONICS
        product.price = Decimal("100.00")
        product.brand = "TestBrand"
        
        similar_products = [
            {"description": "Similar product", "price": 95.0, "brand": "TestBrand", "similarity_score": 0.9}
        ]
        
        result = await authenticity_analyzer._perform_llm_analysis(
            product, similar_products, 75.0
        )
        
        assert isinstance(result, AuthenticityScore)
        assert result.authenticity_score == 75.5
        assert result.confidence == 0.89
        assert "consistent branding" in result.reasoning
        assert len(result.red_flags) == 1
        assert len(result.positive_indicators) == 2
    
    @pytest.mark.asyncio
    async def test_llm_analysis_fallback_to_anthropic(self, authenticity_analyzer):
        """Test fallback to Anthropic when OpenAI fails."""
        with patch.object(authenticity_analyzer, '_analyze_with_openai') as mock_openai, \
             patch.object(authenticity_analyzer, '_analyze_with_anthropic') as mock_anthropic:
            
            # Make OpenAI fail
            mock_openai.side_effect = Exception("OpenAI API error")
            
            # Mock Anthropic success
            mock_anthropic.return_value = AuthenticityScore(
                authenticity_score=70.0,
                confidence=0.8,
                reasoning="Anthropic analysis",
                red_flags=[],
                positive_indicators=[],
                component_scores={}
            )
            
            product = MagicMock()
            similar_products = []
            
            result = await authenticity_analyzer._perform_llm_analysis(
                product, similar_products, 75.0
            )
            
            assert result.authenticity_score == 70.0
            assert "Anthropic analysis" in result.reasoning
            mock_openai.assert_called_once()
            mock_anthropic.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_llm_analysis_complete_failure(self, authenticity_analyzer):
        """Test handling when both LLM providers fail."""
        with patch.object(authenticity_analyzer, '_analyze_with_openai') as mock_openai, \
             patch.object(authenticity_analyzer, '_analyze_with_anthropic') as mock_anthropic:
            
            # Make both fail
            mock_openai.side_effect = Exception("OpenAI API error")
            mock_anthropic.side_effect = Exception("Anthropic API error")
            
            product = MagicMock()
            similar_products = []
            
            result = await authenticity_analyzer._perform_llm_analysis(
                product, similar_products, 75.0
            )
            
            # Should return conservative default
            assert result.authenticity_score == 50.0
            assert result.confidence == 0.3
            assert "Manual review recommended" in result.reasoning
            assert "LLM analysis unavailable" in result.red_flags
    
    @pytest.mark.asyncio
    async def test_get_stats_message(self, authenticity_analyzer):
        """Test getting agent statistics."""
        # Set some test metrics
        authenticity_analyzer.total_analyses = 100
        authenticity_analyzer.total_analysis_time = 150000.0  # 150 seconds total
        authenticity_analyzer.llm_token_usage = 50000
        authenticity_analyzer.processed_messages = 150
        authenticity_analyzer.error_count = 5
        
        message = AgentMessage(
            sender_id="test-sender",
            message_type="get_analysis_stats",
            payload={}
        )
        
        response = await authenticity_analyzer.process_message(message)
        
        assert response.success is True
        assert response.result["total_analyses"] == 100
        assert response.result["average_analysis_time_ms"] == 1500.0  # 150000/100
        assert response.result["total_llm_tokens_used"] == 50000
        assert response.result["processed_messages"] == 150
        assert response.result["error_count"] == 5
    
    @pytest.mark.asyncio
    async def test_unknown_message_type(self, authenticity_analyzer):
        """Test handling of unknown message types."""
        message = AgentMessage(
            sender_id="test-sender",
            message_type="unknown_message_type",
            payload={}
        )
        
        response = await authenticity_analyzer.process_message(message)
        
        assert response.success is False
        assert "Unknown message type" in response.error


class TestAuthenticityScore:
    """Test AuthenticityScore model."""
    
    def test_authenticity_score_validation(self):
        """Test validation of authenticity score fields."""
        # Valid score
        score = AuthenticityScore(
            authenticity_score=75.5,
            confidence=0.89,
            reasoning="Test reasoning",
            red_flags=["flag1"],
            positive_indicators=["indicator1"],
            component_scores={"comp1": 80.0}
        )
        
        assert score.authenticity_score == 75.5
        assert score.confidence == 0.89
        assert len(score.red_flags) == 1
        assert len(score.positive_indicators) == 1
        
        # Test validation errors
        with pytest.raises(ValueError):
            AuthenticityScore(
                authenticity_score=150.0,  # > 100
                confidence=0.5,
                reasoning="Test"
            )
        
        with pytest.raises(ValueError):
            AuthenticityScore(
                authenticity_score=50.0,
                confidence=1.5,  # > 1.0
                reasoning="Test"
            )


class TestProductAnalysisResult:
    """Test ProductAnalysisResult model."""
    
    def test_product_analysis_result_creation(self):
        """Test creation of product analysis result."""
        result = ProductAnalysisResult(
            product_id="test-product-id",
            agent_id="test-agent-id",
            authenticity_score=75.5,
            confidence_score=0.89,
            reasoning="Test analysis result",
            analysis_duration_ms=2500.0,
            llm_model="gpt-4"
        )
        
        assert result.product_id == "test-product-id"
        assert result.agent_id == "test-agent-id"
        assert result.authenticity_score == 75.5
        assert result.confidence_score == 0.89
        assert result.analysis_duration_ms == 2500.0
        assert result.llm_model == "gpt-4"
        assert result.analysis_id is not None  # Should be auto-generated
        assert result.created_at is not None  # Should be auto-generated