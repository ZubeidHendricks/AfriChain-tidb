#!/usr/bin/env python3
"""
Vercel serverless function entry point for VeriChainX FastAPI app
"""

import sys
import os
from pathlib import Path

# Add the parent directory to Python path for imports
current_dir = Path(__file__).parent
parent_dir = current_dir.parent
sys.path.insert(0, str(parent_dir))

# Set environment variables for Vercel
os.environ.setdefault('ENVIRONMENT', 'production')
os.environ.setdefault('DEBUG', 'false')
os.environ.setdefault('HACKATHON_MODE', 'true')

try:
    # Import the FastAPI app from main_tidb.py
    from main_tidb import app
    
    # Export the app for Vercel
    # Vercel expects the ASGI app to be available as 'app'
    __all__ = ['app']
    
except ImportError as e:
    # Fallback for debugging
    from fastapi import FastAPI
    
    app = FastAPI(title="VeriChainX API - Import Error")
    
    @app.get("/")
    async def root():
        return {
            "error": f"Import error: {str(e)}",
            "message": "FastAPI app could not be imported",
            "status": "error"
        }