#!/usr/bin/env python3
"""
Fallback AI LLM System for VeriChainX
Supports multiple free AI providers when OpenAI credits run out
"""

import os
import requests
import json
import logging
from typing import Dict, Any, Optional, List
from enum import Enum

logger = logging.getLogger(__name__)

class LLMProvider(Enum):
    OPENAI = "openai"
    GEMINI = "gemini"
    HUGGINGFACE = "huggingface"
    GROQ = "groq"
    OLLAMA = "ollama"
    FALLBACK = "fallback"

class FallbackLLMManager:
    """
    Multi-provider LLM manager with automatic fallback
    """
    
    def __init__(self):
        self.providers = {
            LLMProvider.OPENAI: self._openai_request,
            LLMProvider.GEMINI: self._gemini_request,
            LLMProvider.HUGGINGFACE: self._huggingface_request,
            LLMProvider.GROQ: self._groq_request,
            LLMProvider.OLLAMA: self._ollama_request,
            LLMProvider.FALLBACK: self._fallback_analysis
        }
        
        # Priority order for fallback
        self.fallback_order = [
            LLMProvider.OPENAI,
            LLMProvider.GEMINI, 
            LLMProvider.GROQ,
            LLMProvider.HUGGINGFACE,
            LLMProvider.OLLAMA,
            LLMProvider.FALLBACK
        ]
        
    async def analyze_product(self, product_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Analyze product with automatic fallback between providers
        """
        
        for provider in self.fallback_order:
            try:
                logger.info(f"Trying {provider.value} for product analysis")
                result = await self.providers[provider](product_data)
                if result and result.get("authenticity_score") is not None:
                    result["provider_used"] = provider.value
                    logger.info(f"Successfully used {provider.value}")
                    return result
                    
            except Exception as e:
                logger.warning(f"{provider.value} failed: {str(e)}")
                continue
        
        # If all providers fail, use fallback logic
        logger.error("All LLM providers failed, using fallback analysis")
        return await self._fallback_analysis(product_data)
    
    async def _openai_request(self, product_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """OpenAI API request (original implementation)"""
        import openai
        
        if not openai.api_key or not openai.api_key.startswith("sk-"):
            raise Exception("OpenAI API key not available")
        
        # Your existing OpenAI logic from main_tidb.py
        prompt = self._build_analysis_prompt(product_data)
        
        response = openai.ChatCompletion.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=800,
            temperature=0.3
        )
        
        return self._parse_ai_response(response.choices[0].message.content)
    
    async def _gemini_request(self, product_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Google Gemini API request (FREE TIER)"""
        gemini_key = os.getenv("GEMINI_API_KEY")
        if not gemini_key:
            raise Exception("Gemini API key not available")
            
        prompt = self._build_analysis_prompt(product_data)
        
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={gemini_key}"
        
        payload = {
            "contents": [{
                "parts": [{"text": prompt}]
            }],
            "generationConfig": {
                "temperature": 0.3,
                "maxOutputTokens": 800
            }
        }
        
        response = requests.post(url, json=payload)
        response.raise_for_status()
        
        result = response.json()
        content = result["candidates"][0]["content"]["parts"][0]["text"]
        
        return self._parse_ai_response(content)
    
    async def _groq_request(self, product_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Groq API request (FREE + FAST)"""
        groq_key = os.getenv("GROQ_API_KEY")
        if not groq_key:
            raise Exception("Groq API key not available")
            
        prompt = self._build_analysis_prompt(product_data)
        
        url = "https://api.groq.com/openai/v1/chat/completions"
        
        headers = {
            "Authorization": f"Bearer {groq_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": "llama-3.1-8b-instant",
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 800,
            "temperature": 0.3
        }
        
        response = requests.post(url, json=payload, headers=headers)
        response.raise_for_status()
        
        result = response.json()
        content = result["choices"][0]["message"]["content"]
        
        return self._parse_ai_response(content)
    
    async def _huggingface_request(self, product_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Hugging Face Inference API (FREE TIER)"""
        hf_token = os.getenv("HUGGINGFACE_TOKEN") 
        if not hf_token:
            raise Exception("Hugging Face token not available")
            
        prompt = self._build_analysis_prompt(product_data)
        
        # Use a good free model for text generation
        url = "https://api-inference.huggingface.co/models/microsoft/DialoGPT-large"
        
        headers = {"Authorization": f"Bearer {hf_token}"}
        
        payload = {
            "inputs": prompt,
            "parameters": {
                "max_length": 800,
                "temperature": 0.3,
                "do_sample": True
            }
        }
        
        response = requests.post(url, json=payload, headers=headers)
        response.raise_for_status()
        
        result = response.json()
        if isinstance(result, list) and len(result) > 0:
            content = result[0].get("generated_text", "")
            return self._parse_ai_response(content)
        
        raise Exception("Invalid Hugging Face response")
    
    async def _ollama_request(self, product_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Local Ollama request (COMPLETELY FREE)"""
        prompt = self._build_analysis_prompt(product_data)
        
        # Try to connect to local Ollama instance
        url = "http://localhost:11434/api/generate"
        
        payload = {
            "model": "llama3.1:8b",  # or "mistral", "phi3"
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": 0.3,
                "num_predict": 800
            }
        }
        
        response = requests.post(url, json=payload, timeout=30)
        response.raise_for_status()
        
        result = response.json()
        content = result.get("response", "")
        
        return self._parse_ai_response(content)
    
    async def _fallback_analysis(self, product_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Rule-based fallback analysis when all AI providers fail
        """
        logger.info("Using rule-based fallback analysis")
        
        price = float(product_data.get("price", 0))
        product_name = product_data.get("product_name", "").lower()
        seller_info = product_data.get("seller_info", {})
        seller_verified = seller_info.get("verified", False) if seller_info else False
        
        # Simple rule-based scoring
        authenticity_score = 0.5  # Start neutral
        
        # Price analysis
        if "iphone" in product_name and price < 200:
            authenticity_score -= 0.4  # Very suspicious
        elif "luxury" in product_name and price < 50:
            authenticity_score -= 0.3
        elif price > 1000:
            authenticity_score += 0.2  # Higher price = potentially more authentic
            
        # Seller verification
        if seller_verified:
            authenticity_score += 0.2
        else:
            authenticity_score -= 0.1
            
        # Brand analysis
        high_risk_brands = ["apple", "rolex", "gucci", "louis vuitton", "nike"]
        if any(brand in product_name for brand in high_risk_brands):
            authenticity_score -= 0.1  # Higher scrutiny for luxury brands
            
        # Clamp score between 0 and 1
        authenticity_score = max(0.0, min(1.0, authenticity_score))
        is_counterfeit = authenticity_score < 0.5
        
        evidence = [
            f"Price analysis: ${price}",
            f"Seller verified: {seller_verified}",
            "Rule-based analysis applied"
        ]
        
        recommendations = [
            "Verify with authorized dealer",
            "Check product authenticity certificates",
            "Compare with official product specifications"
        ]
        
        if is_counterfeit:
            recommendations.insert(0, "HIGH RISK - Recommend avoiding this product")
            
        return {
            "authenticity_score": authenticity_score,
            "is_counterfeit": is_counterfeit,
            "evidence": evidence,
            "reasoning": f"Rule-based analysis. Score: {authenticity_score:.2f}",
            "recommendations": recommendations,
            "provider_used": "fallback_rules"
        }
    
    def _build_analysis_prompt(self, product_data: Dict[str, Any]) -> str:
        """Build analysis prompt for any AI provider"""
        seller_info = product_data.get("seller_info", {})
        seller_name = seller_info.get('name', 'Unknown') if seller_info else 'Unknown'
        seller_verified = seller_info.get('verified', False) if seller_info else False
        
        return f"""
        Analyze this product for potential counterfeiting:
        
        Product: {product_data.get('product_name', 'Unknown')}
        Category: {product_data.get('category', 'Unknown')}
        Description: {product_data.get('description', 'No description')}
        Price: ${product_data.get('price', 0)}
        Seller: {seller_name} (Verified: {seller_verified})
        
        Provide analysis in JSON format with:
        - authenticity_score (0.0 to 1.0)
        - is_counterfeit (true/false)
        - evidence (array of key findings)
        - reasoning (brief explanation)
        - recommendations (array of suggestions)
        
        Consider factors like price vs market value, seller reputation, description quality, and category risk.
        """
    
    def _parse_ai_response(self, ai_text: str) -> Dict[str, Any]:
        """Parse AI response and extract JSON"""
        try:
            import re
            # Try to find JSON in the response
            json_match = re.search(r'\{.*\}', ai_text, re.DOTALL)
            if json_match:
                return json.loads(json_match.group())
            else:
                raise ValueError("No JSON found in AI response")
                
        except Exception:
            # Fallback parsing from text
            authenticity_score = 0.7
            is_counterfeit = "counterfeit" in ai_text.lower() or "fake" in ai_text.lower()
            
            if not is_counterfeit:
                authenticity_score = 0.8
            else:
                authenticity_score = 0.3
                
            return {
                "authenticity_score": authenticity_score,
                "is_counterfeit": is_counterfeit,
                "evidence": ["AI analysis completed"],
                "reasoning": ai_text[:300] if ai_text else "Analysis completed",
                "recommendations": ["Verify through official channels"]
            }

# Global instance
llm_manager = FallbackLLMManager()