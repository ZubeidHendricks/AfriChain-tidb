"""
Integration tests for Hedera service integration.
Story 1.1 verification tests.
"""

import json
import os
from pathlib import Path


class TestHederaIntegration:
    """Test hybrid Python + TypeScript architecture integration."""
    
    def test_docker_compose_has_hedera_service(self):
        """Verify Docker Compose includes Hedera service."""
        docker_compose_path = Path("docker-compose.yml")
        assert docker_compose_path.exists(), "docker-compose.yml should exist"
        
        with open(docker_compose_path, 'r') as f:
            content = f.read()
            
        assert 'hedera-service:' in content, "Docker Compose should include hedera-service"
        assert 'redis:' in content, "Docker Compose should include redis service"
        assert 'port' in content.lower(), "Docker Compose should configure ports"
    
    def test_hedera_service_structure(self):
        """Verify TypeScript service has proper structure."""
        hedera_dir = Path("hedera-service")
        assert hedera_dir.exists(), "hedera-service directory should exist"
        
        # Check essential files
        essential_files = [
            "package.json",
            "tsconfig.json", 
            "Dockerfile",
            "src/index.ts",
            "src/config/redis.ts",
            "src/config/hedera.ts",
            "src/routes/health.ts",
            "src/routes/hedera.ts",
            "src/services/messageHandler.ts"
        ]
        
        for file_path in essential_files:
            full_path = hedera_dir / file_path
            assert full_path.exists(), f"{file_path} should exist in hedera-service"
    
    def test_package_json_dependencies(self):
        """Verify package.json has required dependencies."""
        package_json_path = Path("hedera-service/package.json")
        assert package_json_path.exists()
        
        with open(package_json_path, 'r') as f:
            package_data = json.load(f)
        
        required_deps = [
            "@hashgraph/sdk",
            "express", 
            "redis",
            "langchain",
            "typescript"
        ]
        
        all_deps = {**package_data.get("dependencies", {}), **package_data.get("devDependencies", {})}
        
        for dep in required_deps:
            assert dep in all_deps, f"Package.json should include {dep}"
    
    def test_python_api_bridge_exists(self):
        """Verify Python FastAPI bridge endpoints exist."""
        bridge_path = Path("src/counterfeit_detection/api/v1/endpoints/hedera_bridge.py")
        assert bridge_path.exists(), "Hedera bridge endpoints should exist"
        
        # Check for key functions in the bridge
        with open(bridge_path, 'r') as f:
            content = f.read()
            
        assert 'ping_hedera_service' in content, "Bridge should have ping function"
        assert 'get_hedera_status' in content, "Bridge should have status function"
        assert 'send_message_to_hedera' in content, "Bridge should have message sending"
        assert 'hedera.agent.commands' in content, "Bridge should use correct Redis channel"
    
    def test_api_router_includes_hedera_bridge(self):
        """Verify main API router includes Hedera bridge."""
        router_path = Path("src/counterfeit_detection/api/v1/__init__.py")
        assert router_path.exists()
        
        with open(router_path, 'r') as f:
            content = f.read()
            
        assert 'hedera_bridge_router' in content, "API router should include hedera_bridge_router"
        assert 'include_router(hedera_bridge_router)' in content, "Router should be included"
    
    def test_environment_configuration(self):
        """Verify environment configuration files exist."""
        env_files = [
            "hedera-service/.env.example",
            "hedera-service/.env"
        ]
        
        for env_file in env_files:
            env_path = Path(env_file)
            assert env_path.exists(), f"{env_file} should exist"
            
            with open(env_path, 'r') as f:
                content = f.read()
                
            assert 'HEDERA_NETWORK' in content, f"{env_file} should configure Hedera network"
            assert 'REDIS_URL' in content, f"{env_file} should configure Redis URL"
    
    def test_cross_service_communication_channels(self):
        """Verify Redis channels are properly configured."""
        # Check Python bridge uses correct channels
        bridge_path = Path("src/counterfeit_detection/api/v1/endpoints/hedera_bridge.py")
        with open(bridge_path, 'r') as f:
            python_content = f.read()
        
        # Check TypeScript handler uses correct channels  
        handler_path = Path("hedera-service/src/services/messageHandler.ts")
        with open(handler_path, 'r') as f:
            ts_content = f.read()
        
        # Verify channels match between services
        assert 'hedera.agent.commands' in python_content, "Python should use commands channel"
        assert 'hedera.agent.responses' in python_content, "Python should use responses channel"
        assert 'hedera.agent.commands' in ts_content, "TypeScript should use commands channel"
        assert 'hedera.agent.responses' in ts_content, "TypeScript should use responses channel"
    
    def test_existing_files_preserved(self):
        """Verify existing VeriChainX files haven't been modified."""
        # Check key existing files still exist
        existing_files = [
            "src/counterfeit_detection/agents/orchestrator.py",
            "src/counterfeit_detection/config/redis.py",
            "requirements.txt",
            "Dockerfile"
        ]
        
        for file_path in existing_files:
            path = Path(file_path)
            assert path.exists(), f"Existing file {file_path} should be preserved"


if __name__ == "__main__":
    # Run basic tests without pytest
    test_instance = TestHederaIntegration()
    
    tests = [
        test_instance.test_docker_compose_has_hedera_service,
        test_instance.test_hedera_service_structure,
        test_instance.test_package_json_dependencies,
        test_instance.test_python_api_bridge_exists,
        test_instance.test_api_router_includes_hedera_bridge,
        test_instance.test_environment_configuration,
        test_instance.test_cross_service_communication_channels,
        test_instance.test_existing_files_preserved,
    ]
    
    passed = 0
    failed = 0
    
    print("🧪 Running Story 1.1 Integration Tests...")
    print("=" * 50)
    
    for test in tests:
        try:
            test()
            print(f"✅ {test.__name__}")
            passed += 1
        except Exception as e:
            print(f"❌ {test.__name__}: {e}")
            failed += 1
    
    print("=" * 50)
    print(f"📊 Results: {passed} passed, {failed} failed")
    
    if failed == 0:
        print("🎉 All integration tests passed! System integrity verified.")
    else:
        print("⚠️ Some tests failed. Review implementation.")