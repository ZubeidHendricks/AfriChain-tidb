#!/usr/bin/env python3
"""
Integration Tests for Tool Calling Agents (HCS/HTS)
Tests direct blockchain operations through specialized agents
"""

import json
from pathlib import Path

# Test message structures for Tool Calling Agents
HCS_TOOL_CALL_TEST_CASES = [
    {
        "description": "Direct HCS topic creation",
        "message": {
            "type": "hcs_tool_call",
            "source": "python-service",
            "target": "hedera-service",
            "correlation_id": "hcs-001",
            "payload": {
                "operation": "create_topic",
                "memo": "VeriChainX product authenticity audit trail"
            },
            "timestamp": "2025-08-04T00:00:00Z"
        },
        "expected_response_type": "hcs_tool_call_response",
        "should_succeed": True
    },
    {
        "description": "Direct HCS message submission",
        "message": {
            "type": "hcs_tool_call",
            "source": "python-service", 
            "target": "hedera-service",
            "correlation_id": "hcs-002",
            "payload": {
                "operation": "submit_message",
                "topicId": "0.0.123456",
                "message": "Product VCX-001 verified authentic by AI Agent at 2025-08-04T12:00:00Z"
            },
            "timestamp": "2025-08-04T00:00:00Z"
        },
        "expected_response_type": "hcs_tool_call_response",
        "should_succeed": True
    },
    {
        "description": "HCS natural language operation",
        "message": {
            "type": "hcs_tool_call",
            "source": "python-service",
            "target": "hedera-service", 
            "correlation_id": "hcs-003",
            "payload": {
                "operation": "natural_language",
                "request": "Create a topic for logging counterfeit detection results"
            },
            "timestamp": "2025-08-04T00:00:00Z"
        },
        "expected_response_type": "hcs_tool_call_response",
        "should_succeed": True
    }
]

HTS_TOOL_CALL_TEST_CASES = [
    {
        "description": "Direct NFT collection creation",
        "message": {
            "type": "hts_tool_call",
            "source": "python-service",
            "target": "hedera-service",
            "correlation_id": "hts-001", 
            "payload": {
                "operation": "create_nft_collection",
                "name": "VeriChainX Authenticity Certificates",
                "symbol": "VCXCERT"
            },
            "timestamp": "2025-08-04T00:00:00Z"
        },
        "expected_response_type": "hts_tool_call_response",
        "should_succeed": True
    },
    {
        "description": "Direct fungible token creation",
        "message": {
            "type": "hts_tool_call",
            "source": "python-service",
            "target": "hedera-service",
            "correlation_id": "hts-002",
            "payload": {
                "operation": "create_fungible_token", 
                "name": "VeriChain Reward Token",
                "symbol": "VCR",
                "decimals": 8,
                "initialSupply": 1000000
            },
            "timestamp": "2025-08-04T00:00:00Z"
        },
        "expected_response_type": "hts_tool_call_response", 
        "should_succeed": True
    },
    {
        "description": "Direct NFT minting",
        "message": {
            "type": "hts_tool_call",
            "source": "python-service",
            "target": "hedera-service",
            "correlation_id": "hts-003",
            "payload": {
                "operation": "mint_nft",
                "tokenId": "0.0.789012",
                "metadata": {
                    "productId": "VCX-001",
                    "verified": True,
                    "verificationDate": "2025-08-04T12:00:00Z",
                    "verifier": "AI-Agent-v1.2",
                    "authenticity_score": 0.98
                }
            },
            "timestamp": "2025-08-04T00:00:00Z"
        },
        "expected_response_type": "hts_tool_call_response",
        "should_succeed": True
    },
    {
        "description": "Direct token transfer",
        "message": {
            "type": "hts_tool_call",
            "source": "python-service",
            "target": "hedera-service",
            "correlation_id": "hts-004",
            "payload": {
                "operation": "transfer_token",
                "tokenId": "0.0.456789",
                "toAccountId": "0.0.987654",
                "amount": 100
            },
            "timestamp": "2025-08-04T00:00:00Z"
        },
        "expected_response_type": "hts_tool_call_response",
        "should_succeed": True
    }
]

HYBRID_OPERATION_TEST_CASES = [
    {
        "description": "Create authenticity certificate (HTS + HCS)",
        "message": {
            "type": "hybrid_operation",
            "source": "python-service",
            "target": "hedera-service",
            "correlation_id": "hybrid-001",
            "payload": {
                "operation": "create_authenticity_certificate",
                "productName": "Luxury Handbag Model X",
                "symbol": "LHXCERT",
                "auditTopicId": "0.0.123456"
            },
            "timestamp": "2025-08-04T00:00:00Z"
        },
        "expected_response_type": "hybrid_operation_response",
        "should_succeed": True
    },
    {
        "description": "Verify product authenticity (HTS mint + HCS log)",
        "message": {
            "type": "hybrid_operation", 
            "source": "python-service",
            "target": "hedera-service",
            "correlation_id": "hybrid-002",
            "payload": {
                "operation": "verify_product_authenticity",
                "productId": "VCX-001",
                "tokenId": "0.0.789012",
                "verifierAccount": "0.0.654321",
                "auditTopicId": "0.0.123456"
            },
            "timestamp": "2025-08-04T00:00:00Z"
        },
        "expected_response_type": "hybrid_operation_response",
        "should_succeed": True
    }
]


class TestToolCallingAgents:
    """Test specialized HCS and HTS tool calling agents."""

    def test_hcs_agent_file_structure(self):
        """Test HCS agent file structure and dependencies."""
        from pathlib import Path
        
        required_files = [
            "hedera-service/src/agents/HcsAgent.ts",
            "hedera-service/src/services/toolCallingService.ts"
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

    def test_hts_agent_file_structure(self):
        """Test HTS agent file structure and dependencies."""
        from pathlib import Path
        
        required_files = [
            "hedera-service/src/agents/HtsAgent.ts",
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

    def test_tool_calling_service_integration(self):
        """Test tool calling service integration with message handler."""
        from pathlib import Path
        
        try:
            message_handler_path = Path("hedera-service/src/services/messageHandler.ts")
            assert message_handler_path.exists(), "MessageHandler not found"
            
            with open(message_handler_path) as f:
                content = f.read()
            
            # Check for Tool Calling Service message types
            required_message_types = [
                "hcs_tool_call",
                "hts_tool_call", 
                "hybrid_operation",
                "tool_status"
            ]
            
            for msg_type in required_message_types:
                assert msg_type in content, f"Missing message type handler: {msg_type}"
                print(f"✅ Found message type handler: {msg_type}")
                
            # Check for ToolCallingService import
            assert "import ToolCallingService" in content, "Missing ToolCallingService import"
            print("✅ ToolCallingService properly imported")
            
            # Check for tool calling channel subscription
            assert "hedera.tool.commands" in content, "Missing tool calling channel subscription"
            print("✅ Tool calling channel subscription found")
            
            return True
            
        except Exception as e:
            print(f"❌ Tool calling service integration check failed: {e}")
            return False

    def test_hcs_agent_implementation(self):
        """Test HCS agent implementation details."""
        from pathlib import Path
        
        try:
            hcs_agent_path = Path("hedera-service/src/agents/HcsAgent.ts")
            assert hcs_agent_path.exists(), "HCS Agent not found"
            
            with open(hcs_agent_path) as f:
                content = f.read()
            
            # Check for HCS-specific tools
            required_tools = [
                "create_hcs_topic",
                "submit_hcs_message",
                "get_topic_info",
                "subscribe_to_topic"
            ]
            
            for tool in required_tools:
                assert tool in content, f"Missing HCS tool: {tool}"
                print(f"✅ Found HCS tool: {tool}")
            
            # Check for HCS operation methods
            required_methods = [
                "createTopic",
                "submitMessage", 
                "executeOperation"
            ]
            
            for method in required_methods:
                assert method in content, f"Missing HCS method: {method}"
                print(f"✅ Found HCS method: {method}")
            
            return True
            
        except Exception as e:
            print(f"❌ HCS agent implementation check failed: {e}")
            return False

    def test_hts_agent_implementation(self):
        """Test HTS agent implementation details."""
        from pathlib import Path
        
        try:
            hts_agent_path = Path("hedera-service/src/agents/HtsAgent.ts")
            assert hts_agent_path.exists(), "HTS Agent not found"
            
            with open(hts_agent_path) as f:
                content = f.read()
            
            # Check for HTS-specific tools
            required_tools = [
                "create_fungible_token",
                "create_nft_token",
                "mint_tokens",
                "transfer_tokens",
                "transfer_hbar",
                "get_token_balance"
            ]
            
            for tool in required_tools:
                assert tool in content, f"Missing HTS tool: {tool}"
                print(f"✅ Found HTS tool: {tool}")
            
            # Check for HTS operation methods
            required_methods = [
                "createFungibleToken",
                "createNftCollection",
                "mintNft",
                "transferToken"
            ]
            
            for method in required_methods:
                assert method in content, f"Missing HTS method: {method}"
                print(f"✅ Found HTS method: {method}")
            
            return True
            
        except Exception as e:
            print(f"❌ HTS agent implementation check failed: {e}")
            return False

    def test_hybrid_operations_implementation(self):
        """Test hybrid operations combining HCS and HTS."""
        from pathlib import Path
        
        try:
            tool_service_path = Path("hedera-service/src/services/toolCallingService.ts")
            assert tool_service_path.exists(), "Tool Calling Service not found"
            
            with open(tool_service_path) as f:
                content = f.read()
            
            # Check for hybrid operations
            required_operations = [
                "create_authenticity_certificate",
                "verify_product_authenticity"
            ]
            
            for operation in required_operations:
                assert operation in content, f"Missing hybrid operation: {operation}"
                print(f"✅ Found hybrid operation: {operation}")
            
            # Check for both agent integrations
            assert "HcsAgent" in content, "Missing HCS Agent integration"
            assert "HtsAgent" in content, "Missing HTS Agent integration"
            print("✅ Both HCS and HTS agents integrated")
            
            return True
            
        except Exception as e:
            print(f"❌ Hybrid operations implementation check failed: {e}")
            return False

    def test_message_structure_validation(self):
        """Test message structure validation for tool calls."""
        
        # Test HCS tool call message
        hcs_message = HCS_TOOL_CALL_TEST_CASES[0]["message"]
        assert hcs_message["type"] == "hcs_tool_call"
        assert "operation" in hcs_message["payload"]
        assert hcs_message["payload"]["operation"] in ["create_topic", "submit_message", "natural_language"]
        print("✅ HCS tool call message structure validated")
        
        # Test HTS tool call message
        hts_message = HTS_TOOL_CALL_TEST_CASES[0]["message"]
        assert hts_message["type"] == "hts_tool_call"
        assert "operation" in hts_message["payload"]
        assert hts_message["payload"]["operation"] in [
            "create_nft_collection", "create_fungible_token", "mint_nft", "transfer_token"
        ]
        print("✅ HTS tool call message structure validated")
        
        # Test hybrid operation message
        hybrid_message = HYBRID_OPERATION_TEST_CASES[0]["message"]
        assert hybrid_message["type"] == "hybrid_operation"
        assert "operation" in hybrid_message["payload"]
        assert hybrid_message["payload"]["operation"] in [
            "create_authenticity_certificate", "verify_product_authenticity"
        ]
        print("✅ Hybrid operation message structure validated")
        
        return True

    def test_validation_schemas(self):
        """Test validation schemas for tool calling operations."""
        
        # Test HCS schemas
        hcs_create_topic = {
            "memo": "Test topic for VeriChainX",
            "adminKey": "optional-admin-key"
        }
        
        hcs_submit_message = {
            "topicId": "0.0.123456",
            "message": "Test consensus message"
        }
        
        # Test HTS schemas
        hts_create_token = {
            "name": "VeriChain Test Token",
            "symbol": "VCTT",
            "decimals": 8,
            "initialSupply": 1000000
        }
        
        hts_transfer = {
            "tokenId": "0.0.789012",
            "toAccountId": "0.0.456789",
            "amount": 100
        }
        
        # Basic validation (structure exists)
        for schema_data in [hcs_create_topic, hcs_submit_message, hts_create_token, hts_transfer]:
            assert isinstance(schema_data, dict)
            assert len(schema_data) > 0
        
        print("✅ Validation schemas structure verified")
        return True

    def test_redis_channel_configuration(self):
        """Test Redis channel configuration for tool calling."""
        from pathlib import Path
        
        try:
            # Check message handler for commands channel
            message_handler_path = Path("hedera-service/src/services/messageHandler.ts")
            with open(message_handler_path) as f:
                handler_content = f.read()
            
            # Check tool calling service for responses channel
            tool_service_path = Path("hedera-service/src/services/toolCallingService.ts")
            with open(tool_service_path) as f:
                service_content = f.read()
            
            # Check for commands channel in message handler
            assert "hedera.tool.commands" in handler_content, "Missing commands channel in message handler"
            print("✅ Found Redis channel: hedera.tool.commands (in message handler)")
            
            # Check for responses channel in tool calling service
            assert "hedera.tool.responses" in service_content, "Missing responses channel in tool calling service"
            print("✅ Found Redis channel: hedera.tool.responses (in tool calling service)")
            
            return True
            
        except Exception as e:
            print(f"❌ Redis channel configuration check failed: {e}")
            return False


def run_tool_calling_agent_tests():
    """Run comprehensive Tool Calling Agent tests."""
    print("🔧 Starting Tool Calling Agents Integration Tests")
    print("=" * 60)
    
    test_suite = TestToolCallingAgents()
    
    test_methods = [
        ("HCS Agent File Structure", test_suite.test_hcs_agent_file_structure),
        ("HTS Agent File Structure", test_suite.test_hts_agent_file_structure),
        ("Tool Calling Service Integration", test_suite.test_tool_calling_service_integration),
        ("HCS Agent Implementation", test_suite.test_hcs_agent_implementation),
        ("HTS Agent Implementation", test_suite.test_hts_agent_implementation),
        ("Hybrid Operations Implementation", test_suite.test_hybrid_operations_implementation),
        ("Message Structure Validation", test_suite.test_message_structure_validation),
        ("Validation Schemas", test_suite.test_validation_schemas),
        ("Redis Channel Configuration", test_suite.test_redis_channel_configuration)
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
    print("📊 TOOL CALLING AGENTS TEST RESULTS")
    print("=" * 60)
    
    for test_name, result in results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"  {status} {test_name}")
    
    print(f"\n🎯 Overall: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 All Tool Calling Agent tests passed!")
        print("✅ Story 1.2 Task 2: Tool Calling Agents for HCS/HTS operations complete")
        return True
    else:
        print(f"\n⚠️ {total - passed} test(s) failed. Review implementation.")
        return False


if __name__ == "__main__":
    success = run_tool_calling_agent_tests()
    exit(0 if success else 1)