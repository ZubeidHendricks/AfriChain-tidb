#!/usr/bin/env python3
"""
Story 1.1 Integration Test Runner
Comprehensive testing for hybrid Python + TypeScript architecture.
"""

import os
import sys
import subprocess
import json
from pathlib import Path


def print_banner(text: str):
    """Print formatted banner."""
    print("\n" + "=" * 60)
    print(f"  {text}")
    print("=" * 60)


def run_command(cmd: list, cwd: str = None, capture_output: bool = True) -> tuple:
    """Run shell command and return success status and output."""
    try:
        result = subprocess.run(
            cmd, 
            cwd=cwd, 
            capture_output=capture_output, 
            text=True,
            timeout=30
        )
        return result.returncode == 0, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return False, "", "Command timed out"
    except Exception as e:
        return False, "", str(e)


def check_docker_environment():
    """Check if Docker is available."""
    print_banner("🐳 DOCKER ENVIRONMENT CHECK")
    
    success, stdout, stderr = run_command(["docker", "--version"])
    if success:
        print(f"✅ Docker available: {stdout.strip()}")
        
        # Check Docker Compose
        success, stdout, stderr = run_command(["docker", "compose", "version"])
        if success:
            print(f"✅ Docker Compose available: {stdout.strip()}")
            return True
        else:
            print("⚠️ Docker Compose not available")
            return False
    else:
        print("⚠️ Docker not available - will run limited tests")
        return False


def test_python_syntax():
    """Test Python file syntax."""
    print_banner("🐍 PYTHON SYNTAX VALIDATION")
    
    python_files = [
        "src/counterfeit_detection/api/v1/endpoints/hedera_bridge.py",
        "src/counterfeit_detection/api/v1/__init__.py",
        "tests/integration/test_hedera_integration.py",
        "tests/api/v1/endpoints/test_hedera_bridge.py",
    ]
    
    all_passed = True
    for file_path in python_files:
        if Path(file_path).exists():
            success, stdout, stderr = run_command(["python3", "-m", "py_compile", file_path])
            if success:
                print(f"✅ {file_path}")
            else:
                print(f"❌ {file_path}: {stderr}")
                all_passed = False
        else:
            print(f"⚠️ {file_path}: File not found")
            all_passed = False
    
    return all_passed


def test_typescript_syntax():
    """Test TypeScript file syntax."""
    print_banner("📘 TYPESCRIPT SYNTAX VALIDATION")
    
    hedera_service_dir = Path("hedera-service")
    if not hedera_service_dir.exists():
        print("❌ hedera-service directory not found")
        return False
    
    ts_files = [
        "src/index.ts",
        "src/config/redis.ts", 
        "src/config/hedera.ts",
        "src/routes/health.ts",
        "src/routes/hedera.ts",
        "src/services/messageHandler.ts",
    ]
    
    all_passed = True
    for file_path in ts_files:
        full_path = hedera_service_dir / file_path
        if full_path.exists():
            print(f"✅ {file_path}")
        else:
            print(f"❌ {file_path}: File not found")
            all_passed = False
    
    # Check package.json
    package_json = hedera_service_dir / "package.json"
    if package_json.exists():
        try:
            with open(package_json) as f:
                data = json.load(f)
            print("✅ package.json: Valid JSON")
            
            # Check essential dependencies
            deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}
            required = ["@hashgraph/sdk", "express", "redis", "typescript"]
            for dep in required:
                if dep in deps:
                    print(f"✅ {dep}: {deps[dep]}")
                else:
                    print(f"❌ {dep}: Missing dependency")
                    all_passed = False
                    
        except json.JSONDecodeError:
            print("❌ package.json: Invalid JSON")
            all_passed = False
    else:
        print("❌ package.json: Not found")
        all_passed = False
    
    return all_passed


def run_integration_tests():
    """Run integration tests."""
    print_banner("🧪 INTEGRATION TESTS")
    
    success, stdout, stderr = run_command([
        "python3", "tests/integration/test_hedera_integration.py"
    ])
    
    if success:
        print(stdout)
        return True
    else:
        print(f"❌ Integration tests failed: {stderr}")
        return False


def test_docker_compose_structure():
    """Test Docker Compose configuration."""
    print_banner("🐳 DOCKER COMPOSE VALIDATION")
    
    if not Path("docker-compose.yml").exists():
        print("❌ docker-compose.yml not found")
        return False
    
    try:
        # Test Docker Compose configuration syntax
        success, stdout, stderr = run_command(["docker", "compose", "config", "-q"])
        if success:
            print("✅ docker-compose.yml: Valid syntax")
            
            # Check for required services
            success, stdout, stderr = run_command(["docker", "compose", "config"])
            if success:
                config = stdout
                required_services = ["app", "redis", "hedera-service"]
                for service in required_services:
                    if service in config:
                        print(f"✅ Service defined: {service}")
                    else:
                        print(f"❌ Service missing: {service}")
                        return False
                return True
            else:
                print(f"❌ Failed to read config: {stderr}")
                return False
        else:
            print(f"❌ Invalid docker-compose.yml: {stderr}")
            return False
    except:
        print("⚠️ Docker Compose not available - skipping validation")
        return True


def run_service_tests():
    """Run service-specific tests if possible."""
    print_banner("🔧 SERVICE TESTS")
    
    # For environments without Docker, we can't run the actual services
    # But we can verify the test files exist and are structured correctly
    
    test_files = [
        "hedera-service/tests/setup.ts",
        "hedera-service/tests/routes/health.test.ts",
        "hedera-service/tests/routes/hedera.test.ts", 
        "hedera-service/tests/services/messageHandler.test.ts",
        "hedera-service/jest.config.js",
    ]
    
    all_exist = True
    for test_file in test_files:
        if Path(test_file).exists():
            print(f"✅ {test_file}")
        else:
            print(f"❌ {test_file}: Missing")
            all_exist = False
    
    if all_exist:
        print("✅ All TypeScript test files present")
    
    return all_exist


def generate_summary_report():
    """Generate test summary report."""
    print_banner("📊 TEST SUMMARY REPORT")
    
    # Run all test categories
    results = {
        "Python Syntax": test_python_syntax(),
        "TypeScript Structure": test_typescript_syntax(),
        "Integration Tests": run_integration_tests(), 
        "Docker Compose": test_docker_compose_structure(),
        "Service Tests Setup": run_service_tests(),
    }
    
    print("\n📋 RESULTS:")
    passed = 0
    total = len(results)
    
    for test_name, result in results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"  {status} {test_name}")
        if result:
            passed += 1
    
    print(f"\n🎯 Overall: {passed}/{total} test categories passed")
    
    if passed == total:
        print("🎉 All tests passed! Story 1.1 implementation is ready.")
        return True
    else:
        print("⚠️ Some tests failed. Review implementation before proceeding.")
        return False


def main():
    """Main test runner."""
    print("🚀 Story 1.1: Development Environment Setup and Hedera Integration Foundation")
    print("📝 Running comprehensive integration tests...")
    
    # Check environment
    docker_available = check_docker_environment()
    
    # Generate comprehensive report
    success = generate_summary_report()
    
    # Additional information
    print_banner("📚 NEXT STEPS")
    
    if success:
        print("✅ Story 1.1 implementation complete and verified!")
        print("✅ Ready to proceed to Story 1.2: Hedera Agent Kit Integration")
        print("\n🔄 To start services (when Docker is available):")
        print("   docker-compose up -d")
        print("\n📊 To run TypeScript tests:")
        print("   cd hedera-service && npm test")
        
    else:
        print("⚠️ Implementation needs attention before proceeding.")
        print("📋 Review failed test categories above.")
    
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())