#!/usr/bin/env python3
"""
Debug endpoint for VeriChainX Vercel deployment
"""

from fastapi import FastAPI
import os

app = FastAPI(title="VeriChainX Debug")

@app.get("/")
async def debug_root():
    return {
        "message": "VeriChainX Debug Endpoint",
        "status": "working",
        "environment": os.getenv("ENVIRONMENT", "unknown"),
        "has_openai_key": bool(os.getenv("OPENAI_API_KEY")),
        "has_tidb_host": bool(os.getenv("TIDB_HOST")),
        "has_gemini_key": bool(os.getenv("GEMINI_API_KEY")),
        "has_groq_key": bool(os.getenv("GROQ_API_KEY"))
    }

@app.get("/health")
async def debug_health():
    return {"status": "healthy", "debug": True}