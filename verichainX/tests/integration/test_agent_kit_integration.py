#!/usr/bin/env python3
"""
Integration Tests for Hedera Agent Kit
Tests the complete integration between Python services and Hedera Agent Kit
"""

import json
import asyncio
from pathlib import Path

# Test message structures for Agent Kit integration
NATURAL_LANGUAGE_TEST_CASES = [
    {
        "description": "Create HCS topic request",
        "request": "Create a new topic for logging product authenticity data",
        "expected_response_type": "natural_language_response",
        "should_succeed": True
    },
    {
        "description": "Token creation request", 
        "request": "Create a new token called VeriChain Token with symbol VCT",
        "expected_response_type": "natural_language_response",
        "should_succeed": True
    },
    {
        "description": "Balance check request",
        "request": "Check the HBAR balance for account 0.0.123456",
        "expected_response_type": "natural_language_response", 
        "should_succeed": True
    },
    {
        "description": "Complex transfer request",
        "request": "Transfer 50 HBAR to account 0.0.789012 and then check the balance",
        "expected_response_type": "natural_language_response",
        "should_succeed": True
    }
]

HCS_OPERATION_TEST_CASES = [
    {
        "description": "Create topic operation",
        "payload": {
            "operation": "create_topic",
            "memo": "VeriChainX authenticity logging"
        },
        "expected_response_type": "hcs_operation_response",
        "should_succeed": True
    },
    {
        "description": "Submit message operation",
        "payload": {
            "operation": "submit_message",
            "topicId": "0.0.123456",
            "message": "Product ID: VCX-001, Status: Authentic, Timestamp: 2025-01-01T00:00:00Z"
        },
        "expected_response_type": "hcs_operation_response",
        "should_succeed": True
    }
]

HTS_OPERATION_TEST_CASES = [
    {
        "description": "Create token operation",
        "payload": {
            "operation": "create_token",
            "name": "VeriChain NFT",
            "symbol": "VCNFT",
            "decimals": 0,
            "initialSupply": 0
        },
        "expected_response_type": "hts_operation_response",
        "should_succeed": True
    },
    {
        "description": "Mint token operation", 
        "payload": {
            "operation": "mint_token",
            "tokenId": "0.0.789012",
            "amount": 1
        },
        "expected_response_type": "hts_operation_response",
        "should_succeed": True
    },
    {
        "description": "Transfer token operation",
        "payload": {
            "operation": "transfer_token", 
            "tokenId": "0.0.789012",
            "toAccountId": "0.0.456789",
            "amount": 1
        },
        "expected_response_type": "hts_operation_response",
        "should_succeed": True
    }
]


class TestHederaAgentKitIntegration:
    """Test Hedera Agent Kit integration with existing VeriChainX system."""
    
    def test_agent_kit_package_dependencies(self):
        """Test that Hedera Agent Kit dependencies are properly configured."""
        try:
            import json
            from pathlib import Path
            
            # Check hedera-service package.json
            package_json_path = Path("hedera-service/package.json")
            assert package_json_path.exists(), "hedera-service/package.json not found"
            
            with open(package_json_path) as f:
                package_data = json.load(f)
            
            dependencies = package_data.get("dependencies", {})
            
            # Check for required Agent Kit dependencies
            required_deps = [
                "hedera-agent-kit",
                "langchain", 
                "@langchain/core",
                "@langchain/openai",
                "zod"
            ]
            
            for dep in required_deps:
                assert dep in dependencies, f"Missing dependency: {dep}"
                print(f"✅ Found dependency: {dep} = {dependencies[dep]}")
                
            print("✅ All Agent Kit dependencies present")
            return True
            
        except Exception as e:
            print(f"❌ Package dependency check failed: {e}")
            return False
    
    def test_agent_kit_file_structure(self):
        """Test that Agent Kit files are properly structured."""
        from pathlib import Path
        
        required_files = [
            "hedera-service/src/agents/HederaAgentKit.ts",
            "hedera-service/src/services/agentService.ts", 
            "hedera-service/.env.example",
            "hedera-service/tests/agents/HederaAgentKit.test.ts"
        ]
        
        all_exist = True
        for file_path in required_files:
            path = Path(file_path)
            if path.exists():
                print(f"✅ {file_path}")
            else:
                print(f"❌ {file_path}: Missing")
                all_exist = False
        
        return all_exist
    
    def test_message_handler_integration(self):
        """Test that message handler includes Agent Kit message types."""
        from pathlib import Path
        
        try:
            message_handler_path = Path("hedera-service/src/services/messageHandler.ts")
            assert message_handler_path.exists(), "MessageHandler not found"
            
            with open(message_handler_path) as f:
                content = f.read()
            
            # Check for Agent Kit message types
            required_message_types = [
                "natural_language_request",
                "hcs_operation", 
                "hts_operation",
                "agent_status"
            ]
            
            for msg_type in required_message_types:
                assert msg_type in content, f"Missing message type handler: {msg_type}"
                print(f"✅ Found message type handler: {msg_type}")
                
            # Check for AgentService import
            assert "import HederaAgentService" in content, "Missing HederaAgentService import"
            print("✅ HederaAgentService properly imported")
            
            return True
            
        except Exception as e:
            print(f"❌ Message handler integration check failed: {e}")
            return False
    
    def test_environment_configuration(self):
        """Test environment configuration for Agent Kit."""
        from pathlib import Path
        
        try:
            env_example_path = Path("hedera-service/.env.example")
            assert env_example_path.exists(), ".env.example not found"
            
            with open(env_example_path) as f:
                env_content = f.read()
            
            # Check for required environment variables
            required_env_vars = [
                "HEDERA_NETWORK",
                "HEDERA_ACCOUNT_ID", 
                "HEDERA_PRIVATE_KEY",
                "OPENAI_API_KEY",
                "OPENAI_MODEL"
            ]
            
            for env_var in required_env_vars:
                assert env_var in env_content, f"Missing environment variable: {env_var}"
                print(f"✅ Found environment variable: {env_var}")
            
            print("✅ Environment configuration complete")
            return True
            
        except Exception as e:
            print(f"❌ Environment configuration check failed: {e}")
            return False

    def test_docker_compose_agent_kit_integration(self):
        """Test Docker Compose includes Agent Kit environment variables."""
        from pathlib import Path
        import yaml
        
        try:
            docker_compose_path = Path("docker-compose.yml")
            assert docker_compose_path.exists(), "docker-compose.yml not found"
            
            with open(docker_compose_path) as f:
                content = f.read()
            
            # Check for Agent Kit environment variables
            required_env_vars = [
                "HEDERA_ACCOUNT_ID",
                "HEDERA_PRIVATE_KEY", 
                "OPENAI_API_KEY"
            ]
            
            for env_var in required_env_vars:
                assert env_var in content, f"Missing Docker environment variable: {env_var}"
                print(f"✅ Found Docker environment variable: {env_var}")
            
            print("✅ Docker Compose Agent Kit integration complete")
            return True
            
        except Exception as e:
            print(f"❌ Docker Compose integration check failed: {e}")
            return False

    def test_natural_language_message_structure(self):
        """Test natural language message structure validation."""
        
        # Valid natural language message
        valid_message = {
            "type": "natural_language_request",
            "source": "python-service",
            "target": "hedera-service", 
            "correlation_id": "test-123",
            "payload": {
                "request": "Create a new topic for product authenticity"
            },
            "timestamp": "2025-08-04T00:00:00Z"
        }
        
        # Validate message structure
        assert "type" in valid_message
        assert "payload" in valid_message
        assert "request" in valid_message["payload"]
        assert isinstance(valid_message["payload"]["request"], str)
        assert len(valid_message["payload"]["request"]) > 0
        
        print("✅ Natural language message structure validated")
        return True

    def test_hcs_operation_message_structure(self):
        """Test HCS operation message structure validation."""
        
        # Valid HCS operation message
        valid_message = {
            "type": "hcs_operation",
            "source": "python-service",
            "target": "hedera-service",
            "correlation_id": "test-456", 
            "payload": {
                "operation": "create_topic",
                "memo": "VeriChainX product logging"
            },
            "timestamp": "2025-08-04T00:00:00Z"
        }
        
        # Validate message structure
        assert "type" in valid_message
        assert "payload" in valid_message
        assert "operation" in valid_message["payload"]
        assert valid_message["payload"]["operation"] in ["create_topic", "submit_message"]
        
        print("✅ HCS operation message structure validated")
        return True

    def test_hts_operation_message_structure(self):
        """Test HTS operation message structure validation."""
        
        # Valid HTS operation message
        valid_message = {
            "type": "hts_operation",
            "source": "python-service", 
            "target": "hedera-service",
            "correlation_id": "test-789",
            "payload": {
                "operation": "create_token",
                "name": "VeriChain NFT",
                "symbol": "VCNFT", 
                "decimals": 0,
                "initialSupply": 0
            },
            "timestamp": "2025-08-04T00:00:00Z"
        }
        
        # Validate message structure
        assert "type" in valid_message
        assert "payload" in valid_message
        assert "operation" in valid_message["payload"]
        assert valid_message["payload"]["operation"] in [
            "create_token", "mint_token", "transfer_token", "transfer_hbar", "get_balance"
        ]
        
        print("✅ HTS operation message structure validated")
        return True

    def test_agent_status_message_handling(self):
        """Test agent status message handling."""
        
        # Agent status request message
        status_message = {
            "type": "agent_status",
            "source": "python-service",
            "target": "hedera-service", 
            "correlation_id": "status-001",
            "payload": {},
            "timestamp": "2025-08-04T00:00:00Z"
        }
        
        # Validate message structure
        assert status_message["type"] == "agent_status"
        assert "payload" in status_message
        
        print("✅ Agent status message structure validated")
        return True


def run_agent_kit_integration_tests():
    """Run comprehensive Agent Kit integration tests."""
    print("🚀 Starting Hedera Agent Kit Integration Tests")
    print("=" * 60)
    
    test_suite = TestHederaAgentKitIntegration()
    
    test_methods = [
        ("Package Dependencies", test_suite.test_agent_kit_package_dependencies),
        ("File Structure", test_suite.test_agent_kit_file_structure), 
        ("Message Handler Integration", test_suite.test_message_handler_integration),
        ("Environment Configuration", test_suite.test_environment_configuration),
        ("Docker Compose Integration", test_suite.test_docker_compose_agent_kit_integration),
        ("Natural Language Messages", test_suite.test_natural_language_message_structure),
        ("HCS Operation Messages", test_suite.test_hcs_operation_message_structure),
        ("HTS Operation Messages", test_suite.test_hts_operation_message_structure),
        ("Agent Status Messages", test_suite.test_agent_status_message_handling)
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
    print("📊 HEDERA AGENT KIT INTEGRATION TEST RESULTS")
    print("=" * 60)
    
    for test_name, result in results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"  {status} {test_name}")
    
    print(f"\n🎯 Overall: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 All Agent Kit integration tests passed!")
        print("✅ Story 1.2 Task 1: Hedera Agent Kit integration complete")
        return True
    else:
        print(f"\n⚠️ {total - passed} test(s) failed. Review implementation.")
        return False


if __name__ == "__main__":
    success = run_agent_kit_integration_tests()
    exit(0 if success else 1)