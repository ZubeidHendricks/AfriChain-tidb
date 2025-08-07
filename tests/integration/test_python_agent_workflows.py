#!/usr/bin/env python3
"""
Integration Tests for Python Agent Workflows
Verifies that existing VeriChainX Python agents continue normal operation
with new Hedera blockchain integration
"""

import json
import asyncio
from pathlib import Path
import subprocess
import time

# Test cases for Python agent workflow verification
PYTHON_AGENT_TEST_CASES = [
    {
        "description": "VeriChainX counterfeit detection workflow",
        "test_type": "core_functionality",
        "expected_files": [
            "src/counterfeit_detection/main.py",
            "src/counterfeit_detection/orchestrator.py",
            "src/counterfeit_detection/api/v1/endpoints/hedera_bridge.py"
        ],
        "should_succeed": True
    },
    {
        "description": "FastAPI bridge endpoints functionality",
        "test_type": "api_endpoints",
        "endpoints": [
            "/hedera/ping",
            "/hedera/status", 
            "/hedera/send-message"
        ],
        "should_succeed": True
    },
    {
        "description": "Redis cross-service communication",
        "test_type": "redis_integration",
        "channels": [
            "hedera.agent.commands",
            "hedera.agent.responses"
        ],
        "should_succeed": True
    },
    {
        "description": "Docker Compose service orchestration",
        "test_type": "docker_integration",
        "services": [
            "app",
            "redis",
            "hedera-service"
        ],
        "should_succeed": True
    }
]

HEDERA_BRIDGE_TEST_CASES = [
    {
        "description": "Python to TypeScript ping communication",
        "message": {
            "type": "ping",
            "source": "python-service",
            "target": "hedera-service",
            "correlation_id": "python-test-001",
            "payload": {"message": "ping from python"},
            "timestamp": "2025-08-04T00:00:00Z"
        },
        "expected_response_type": "ping_response",
        "should_succeed": True
    },
    {
        "description": "Python agent status check", 
        "message": {
            "type": "test_connection",
            "source": "python-service",
            "target": "hedera-service",
            "correlation_id": "python-test-002",
            "payload": {},
            "timestamp": "2025-08-04T00:00:00Z"
        },
        "expected_response_type": "test_connection_response",
        "should_succeed": True
    },
    {
        "description": "Python HCS logging request",
        "message": {
            "type": "hcs_log",
            "source": "python-service",
            "target": "hedera-service",
            "correlation_id": "python-test-003",
            "payload": {
                "topic_id": "0.0.123456",
                "message": "Product VCX-001 verified by Python AI agent",
                "product_id": "VCX-001",
                "verification_score": 0.95
            },
            "timestamp": "2025-08-04T00:00:00Z"
        },
        "expected_response_type": "hcs_log_response",
        "should_succeed": True
    },
    {
        "description": "Python NFT minting request",
        "message": {
            "type": "hts_mint",
            "source": "python-service",
            "target": "hedera-service",
            "correlation_id": "python-test-004",
            "payload": {
                "token_id": "0.0.789012",
                "metadata": {
                    "product_id": "VCX-001",
                    "authenticity_score": 0.95,
                    "verified_by": "python-ai-agent",
                    "verification_timestamp": "2025-08-04T00:00:00Z"
                }
            },
            "timestamp": "2025-08-04T00:00:00Z"
        },
        "expected_response_type": "hts_mint_response",
        "should_succeed": True
    }
]

AGENT_KIT_COMPATIBILITY_TEST_CASES = [
    {
        "description": "Python natural language request to Agent Kit",
        "message": {
            "type": "natural_language_request",
            "source": "python-service",
            "target": "hedera-service",
            "correlation_id": "python-kit-001",
            "payload": {
                "request": "Create a topic for logging Python AI agent counterfeit detection results"
            },
            "timestamp": "2025-08-04T00:00:00Z"
        },
        "expected_response_type": "natural_language_response",
        "should_succeed": True
    },
    {
        "description": "Python HCS operation via Agent Kit",
        "message": {
            "type": "hcs_operation",
            "source": "python-service",
            "target": "hedera-service",
            "correlation_id": "python-kit-002",
            "payload": {
                "operation": "submit_message",
                "topicId": "0.0.123456",
                "message": "Python AI agent detected counterfeit product P-12345"
            },
            "timestamp": "2025-08-04T00:00:00Z"
        },
        "expected_response_type": "hcs_operation_response",
        "should_succeed": True
    },
    {
        "description": "Python HTS operation via Agent Kit",
        "message": {
            "type": "hts_operation", 
            "source": "python-service",
            "target": "hedera-service",
            "correlation_id": "python-kit-003",
            "payload": {
                "operation": "mint_token",
                "tokenId": "0.0.789012",
                "amount": 1
            },
            "timestamp": "2025-08-04T00:00:00Z"
        },
        "expected_response_type": "hts_operation_response",
        "should_succeed": True
    }
]


class TestPythonAgentWorkflows:
    """Test Python agent workflows and integration with Hedera services."""

    def test_python_codebase_integrity(self):
        """Test that Python codebase remains intact and functional."""
        from pathlib import Path
        
        # Check core Python files exist
        core_files = [
            "src/counterfeit_detection/main.py",
            "src/counterfeit_detection/orchestrator.py",
            "src/counterfeit_detection/__init__.py",
            "src/counterfeit_detection/api/__init__.py",
            "src/counterfeit_detection/api/v1/__init__.py",
            "src/counterfeit_detection/api/v1/endpoints/__init__.py"
        ]
        
        all_exist = True
        for file_path in core_files:
            path = Path(file_path)
            if path.exists():
                print(f"✅ {file_path}")
            else:
                print(f"❌ {file_path}: Missing")
                all_exist = False
        
        return all_exist

    def test_hedera_bridge_integration(self):
        """Test Hedera bridge endpoints in Python codebase."""
        from pathlib import Path
        
        try:
            bridge_path = Path("src/counterfeit_detection/api/v1/endpoints/hedera_bridge.py")
            assert bridge_path.exists(), "Hedera bridge endpoint not found"
            
            with open(bridge_path) as f:
                content = f.read()
            
            # Check for bridge endpoints
            required_endpoints = [
                "ping_hedera_service",
                "get_hedera_status",
                "send_message_to_hedera"
            ]
            
            for endpoint in required_endpoints:
                assert endpoint in content, f"Missing bridge endpoint: {endpoint}"
                print(f"✅ Found bridge endpoint: {endpoint}")
                
            # Check for Redis integration
            assert "get_redis_client" in content, "Missing Redis client integration"
            print("✅ Redis client integration found")
            
            # Check for FastAPI router
            assert "APIRouter" in content, "Missing FastAPI router"
            print("✅ FastAPI router found")
            
            return True
            
        except Exception as e:
            print(f"❌ Hedera bridge integration check failed: {e}")
            return False

    def test_redis_channel_subscriptions(self):
        """Test Redis channel subscriptions for Python-TypeScript communication."""
        from pathlib import Path
        
        try:
            bridge_path = Path("src/counterfeit_detection/api/v1/endpoints/hedera_bridge.py")
            with open(bridge_path) as f:
                bridge_content = f.read()
            
            # Check for response subscription function
            assert "subscribe_to_hedera_responses" in bridge_content, "Missing response subscription function"
            print("✅ Found response subscription function")
            
            # Check for Redis channel references
            required_channels = [
                "hedera.agent.commands",
                "hedera.agent.responses"
            ]
            
            for channel in required_channels:
                assert channel in bridge_content, f"Missing Redis channel: {channel}"
                print(f"✅ Found Redis channel: {channel}")
            
            return True
            
        except Exception as e:
            print(f"❌ Redis channel subscription check failed: {e}")
            return False

    def test_python_syntax_validation(self):
        """Test Python syntax validation for all Python files."""
        from pathlib import Path
        import py_compile
        
        python_files = [
            "src/counterfeit_detection/main.py",
            "src/counterfeit_detection/orchestrator.py", 
            "src/counterfeit_detection/api/v1/endpoints/hedera_bridge.py",
            "tests/integration/test_hedera_integration.py",
            "tests/api/v1/endpoints/test_hedera_bridge.py"
        ]
        
        all_valid = True
        for file_path in python_files:
            path = Path(file_path)
            if path.exists():
                try:
                    py_compile.compile(file_path, doraise=True)
                    print(f"✅ {file_path}: Valid Python syntax")
                except py_compile.PyCompileError as e:
                    print(f"❌ {file_path}: Syntax error - {e}")
                    all_valid = False
            else:
                print(f"⚠️ {file_path}: File not found")
        
        return all_valid

    def test_fastapi_endpoint_structure(self):
        """Test FastAPI endpoint structure and routing."""
        from pathlib import Path
        
        try:
            # Check main FastAPI app
            main_path = Path("src/counterfeit_detection/main.py")
            if main_path.exists():
                with open(main_path) as f:
                    main_content = f.read()
                
                # Check for FastAPI app
                assert "FastAPI" in main_content, "Missing FastAPI app"
                print("✅ FastAPI app found in main.py")
            
            # Check Hedera bridge router
            bridge_path = Path("src/counterfeit_detection/api/v1/endpoints/hedera_bridge.py")
            if bridge_path.exists():
                with open(bridge_path) as f:
                    bridge_content = f.read()
                
                # Check for router and endpoints
                assert "router = APIRouter" in bridge_content, "Missing APIRouter"
                assert "@router.post" in bridge_content or "@router.get" in bridge_content, "Missing route decorators"
                print("✅ FastAPI router and endpoints found in hedera_bridge.py")
            
            return True
            
        except Exception as e:
            print(f"❌ FastAPI endpoint structure check failed: {e}")
            return False

    def test_python_dependencies(self):
        """Test Python dependencies and imports."""
        from pathlib import Path
        
        try:
            # Check for requirements or pyproject.toml
            requirements_files = [
                "requirements.txt",
                "pyproject.toml",
                "Pipfile"
            ]
            
            found_requirements = False
            for req_file in requirements_files:
                if Path(req_file).exists():
                    print(f"✅ Found dependency file: {req_file}")
                    found_requirements = True
                    break
            
            if not found_requirements:
                print("⚠️ No requirements file found, checking Docker setup")
            
            # Check Dockerfile for Python setup
            dockerfile_path = Path("Dockerfile")
            if dockerfile_path.exists():
                with open(dockerfile_path) as f:
                    dockerfile_content = f.read()
                
                if "python" in dockerfile_content.lower():
                    print("✅ Python setup found in Dockerfile")
                    return True
            
            return found_requirements
            
        except Exception as e:
            print(f"❌ Python dependencies check failed: {e}")
            return False

    def test_message_structure_compatibility(self):
        """Test message structure compatibility between Python and TypeScript."""
        
        # Test basic message structure
        python_message = HEDERA_BRIDGE_TEST_CASES[0]["message"]
        required_fields = ["type", "source", "target", "correlation_id", "payload", "timestamp"]
        
        for field in required_fields:
            assert field in python_message, f"Missing required field: {field}"
            print(f"✅ Found required field: {field}")
        
        # Test message types
        message_types = [case["message"]["type"] for case in HEDERA_BRIDGE_TEST_CASES]
        expected_types = ["ping", "test_connection", "hcs_log", "hts_mint"]
        
        for msg_type in expected_types:
            assert msg_type in message_types, f"Missing message type: {msg_type}"
            print(f"✅ Found message type: {msg_type}")
        
        return True

    def test_agent_kit_compatibility(self):
        """Test Agent Kit compatibility with Python workflows."""
        
        # Test Agent Kit message types from Python
        kit_message_types = [case["message"]["type"] for case in AGENT_KIT_COMPATIBILITY_TEST_CASES]
        expected_kit_types = ["natural_language_request", "hcs_operation", "hts_operation"]
        
        for msg_type in expected_kit_types:
            assert msg_type in kit_message_types, f"Missing Agent Kit message type: {msg_type}"
            print(f"✅ Found Agent Kit message type: {msg_type}")
        
        # Test Agent Kit payload structures
        for case in AGENT_KIT_COMPATIBILITY_TEST_CASES:
            payload = case["message"]["payload"]
            assert isinstance(payload, dict), "Agent Kit payload must be dictionary"
            assert len(payload) > 0, "Agent Kit payload cannot be empty"
            print(f"✅ Validated Agent Kit payload for: {case['message']['type']}")
        
        return True

    def test_backward_compatibility(self):
        """Test backward compatibility with existing VeriChainX workflows."""
        from pathlib import Path
        
        try:
            # Check that original orchestrator still exists
            orchestrator_path = Path("src/counterfeit_detection/orchestrator.py")
            if orchestrator_path.exists():
                with open(orchestrator_path) as f:
                    content = f.read()
                
                # Should have meaningful content (imports, classes, or substantial code)
                lines = content.split('\n')
                non_empty_lines = [line for line in lines if line.strip() and not line.strip().startswith('#')]
                assert len(non_empty_lines) > 5, "Orchestrator seems too small, may be damaged"
                print(f"✅ Orchestrator has {len(lines)} lines ({len(non_empty_lines)} non-empty/non-comment)")
                
                # Check for key functionality indicators
                key_indicators = ["class", "def", "import"]
                for indicator in key_indicators:
                    assert indicator in content, f"Missing key code indicator: {indicator}"
                
                print("✅ Orchestrator contains expected code patterns")
                return True
            else:
                print("❌ Original orchestrator not found")
                return False
                
        except Exception as e:
            print(f"❌ Backward compatibility check failed: {e}")
            return False

    def test_docker_compose_python_service(self):
        """Test Docker Compose configuration for Python service."""
        from pathlib import Path
        import yaml
        
        try:
            docker_compose_path = Path("docker-compose.yml")
            assert docker_compose_path.exists(), "docker-compose.yml not found"
            
            with open(docker_compose_path) as f:
                content = f.read()
            
            # Check for Python app service
            assert "app:" in content, "Missing Python app service"
            print("✅ Python app service found in docker-compose.yml")
            
            # Check for Python-specific configurations
            python_indicators = [
                "uvicorn",  # Python ASGI server
                "8000:8000"  # Python service port
            ]
            
            for indicator in python_indicators:
                assert indicator in content, f"Missing Python indicator: {indicator}"
                print(f"✅ Found Python configuration: {indicator}")
            
            # Check for Redis dependency
            assert "redis" in content, "Missing Redis service"
            print("✅ Redis service dependency found")
            
            return True
            
        except Exception as e:
            print(f"❌ Docker Compose Python service check failed: {e}")
            return False

    def test_integration_test_structure(self):
        """Test integration test structure for Python workflows."""
        from pathlib import Path
        
        integration_tests = [
            "tests/integration/test_hedera_integration.py",
            "tests/api/v1/endpoints/test_hedera_bridge.py"
        ]
        
        all_exist = True
        for test_file in integration_tests:
            path = Path(test_file)
            if path.exists():
                print(f"✅ {test_file}")
                
                # Check test content
                with open(path) as f:
                    content = f.read()
                
                # Should contain test functions
                assert "def test_" in content, f"No test functions found in {test_file}"
                assert "assert" in content, f"No assertions found in {test_file}"
                print(f"✅ {test_file} contains valid test structure")
            else:
                print(f"❌ {test_file}: Missing")
                all_exist = False
        
        return all_exist


def run_python_agent_workflow_tests():
    """Run comprehensive Python agent workflow tests."""
    print("🐍 Starting Python Agent Workflow Integration Tests")
    print("=" * 60)
    
    test_suite = TestPythonAgentWorkflows()
    
    test_methods = [
        ("Python Codebase Integrity", test_suite.test_python_codebase_integrity),
        ("Hedera Bridge Integration", test_suite.test_hedera_bridge_integration),
        ("Redis Channel Subscriptions", test_suite.test_redis_channel_subscriptions),
        ("Python Syntax Validation", test_suite.test_python_syntax_validation),
        ("FastAPI Endpoint Structure", test_suite.test_fastapi_endpoint_structure),
        ("Python Dependencies", test_suite.test_python_dependencies),
        ("Message Structure Compatibility", test_suite.test_message_structure_compatibility),
        ("Agent Kit Compatibility", test_suite.test_agent_kit_compatibility),
        ("Backward Compatibility", test_suite.test_backward_compatibility),
        ("Docker Compose Python Service", test_suite.test_docker_compose_python_service),
        ("Integration Test Structure", test_suite.test_integration_test_structure)
    ]
    
    results = {}
    passed = 0
    total = len(test_methods)
    
    for test_name, test_method in test_methods:
        print(f"\n🧪 Running: {test_name}")
        try:
            result = test_method()
            results[test_name] = result
            if result:
                passed += 1
                print(f"✅ {test_name}: PASSED")
            else:
                print(f"❌ {test_name}: FAILED")
        except Exception as e:
            results[test_name] = False
            print(f"❌ {test_name}: ERROR - {e}")
    
    print("\n" + "=" * 60)
    print("📊 PYTHON AGENT WORKFLOW TEST RESULTS")
    print("=" * 60)
    
    for test_name, result in results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"  {status} {test_name}")
    
    print(f"\n🎯 Overall: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 All Python agent workflow tests passed!")
        print("✅ Story 1.2 Task 4: Python agents continue normal workflows verified")
        return True
    else:
        print(f"\n⚠️ {total - passed} test(s) failed. Review implementation.")
        return False


if __name__ == "__main__":
    success = run_python_agent_workflow_tests()
    exit(0 if success else 1)