"""
Tests for application settings.
"""

import os
import pytest

from src.counterfeit_detection.config.settings import Settings


def test_settings_from_env():
    """Test settings loading from environment variables."""
    # Set required environment variables
    os.environ.update({
        "TIDB_HOST": "test-host",
        "TIDB_USER": "test-user", 
        "TIDB_PASSWORD": "test-password",
        "TIDB_DATABASE": "test-db",
        "SECRET_KEY": "test-secret",
        "OPENAI_API_KEY": "test-openai-key"
    })
    
    settings = Settings()
    
    assert settings.tidb_host == "test-host"
    assert settings.tidb_user == "test-user"
    assert settings.tidb_password == "test-password"
    assert settings.tidb_database == "test-db"
    assert settings.secret_key == "test-secret"
    assert settings.openai_api_key == "test-openai-key"


def test_database_url_construction():
    """Test database URL construction."""
    settings = Settings(
        tidb_host="test-host",
        tidb_port=4000,
        tidb_user="user",
        tidb_password="pass",
        tidb_database="db",
        tidb_ssl_verify=True,
        secret_key="test-key",
        openai_api_key="test-key"
    )
    
    expected_url = "mysql+aiomysql://user:pass@test-host:4000/db?ssl_verify_cert=true"
    assert settings.database_url == expected_url


def test_database_url_no_ssl():
    """Test database URL construction without SSL."""
    settings = Settings(
        tidb_host="test-host",
        tidb_port=4000,
        tidb_user="user",
        tidb_password="pass",
        tidb_database="db",
        tidb_ssl_verify=False,
        secret_key="test-key",
        openai_api_key="test-key"
    )
    
    expected_url = "mysql+aiomysql://user:pass@test-host:4000/db"
    assert settings.database_url == expected_url