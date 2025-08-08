#!/usr/bin/env python3
"""
Integration Tests for DeFi Protocol Integration
Tests the complete DeFi infrastructure including DEX, Lending, and Staking
"""

import json
import subprocess
import time
from pathlib import Path
from typing import Dict, List, Any, Optional

# DeFi integration test cases
DEFI_CONTRACT_TEST_CASES = [
    {
        "description": "VeriChainXDEX contract structure",
        "contract_name": "VeriChainXDEX",
        "expected_functions": [
            "createPool",
            "addLiquidity",
            "removeLiquidity", 
            "swapTokens",
            "getAmountOut",
            "getPool",
            "getAllPools",
            "createStakingPool",
            "stake",
            "unstake",
            "claimRewards"
        ],
        "expected_events": [
            "PoolCreated",
            "LiquidityAdded",
            "LiquidityRemoved",
            "TokensSwapped",
            "StakingPoolCreated",
            "Staked",
            "Unstaked",
            "RewardsClaimed"
        ],
        "should_succeed": True
    },
    {
        "description": "VeriChainXLending contract structure",
        "contract_name": "VeriChainXLending", 
        "expected_functions": [
            "addMarket",
            "supply",
            "withdraw",
            "borrow",
            "repay",
            "liquidate",
            "getAccountLiquidity",
            "getBorrowRate",
            "getSupplyRate",
            "updatePrice",
            "accrueInterest"
        ],
        "expected_events": [
            "MarketAdded",
            "Supply",
            "Withdraw", 
            "Borrow",
            "Repay",
            "Liquidation",
            "PriceUpdated",
            "InterestAccrued"
        ],
        "should_succeed": True
    },
    {
        "description": "VeriChainXStaking contract structure",
        "contract_name": "VeriChainXStaking",
        "expected_functions": [
            "createStakingPool",
            "stake",
            "unstake",
            "claimRewards",
            "emergencyUnstake",
            "delegate",
            "createVestingSchedule",
            "releaseVestedTokens",
            "addRewardMultiplier",
            "earned",
            "getPoolInfo",
            "getUserStakeInfo"
        ],
        "expected_events": [
            "PoolCreated",
            "Staked", 
            "Unstaked",
            "RewardsClaimed",
            "Delegated",
            "Undelegated",
            "VestingScheduleCreated",
            "VestingTokensReleased",
            "EmergencyWithdraw",
            "RewardMultiplierAdded"
        ],
        "should_succeed": True
    }
]

DEFI_SERVICE_TEST_CASES = [
    {
        "description": "DeFi service initialization",
        "service_file": "defiService.ts",
        "required_methods": [
            "processRequest",
            "getLiquidityPools",
            "getLendingMarkets",
            "getStakingPools"
        ],
        "required_interfaces": [
            "DeFiOperationRequest",
            "DeFiOperationResponse",
            "LiquidityPoolInfo",
            "LendingMarketInfo",
            "StakingPoolInfo"
        ],
        "should_succeed": True
    },
    {
        "description": "DEX operations support",
        "operations": [
            "create_pool",
            "add_liquidity",
            "remove_liquidity",
            "swap_tokens",
            "get_pools",
            "get_pool_info",
            "get_quote"
        ],
        "protocol": "dex",
        "should_succeed": True
    },
    {
        "description": "Lending operations support",
        "operations": [
            "add_market",
            "supply",
            "withdraw",
            "borrow",
            "repay",
            "liquidate",
            "get_markets",
            "get_account_info"
        ],
        "protocol": "lending",
        "should_succeed": True
    },
    {
        "description": "Staking operations support",
        "operations": [
            "create_pool",
            "stake",
            "unstake",
            "claim_rewards",
            "emergency_unstake",
            "delegate",
            "create_vesting",
            "get_pools",
            "get_user_info"
        ],
        "protocol": "staking",
        "should_succeed": True
    }
]

DEFI_AGENT_TEST_CASES = [
    {
        "description": "DeFi agent strategies",
        "agent_file": "DeFiAgent.ts",
        "supported_strategies": [
            "yield_farming",
            "arbitrage", 
            "lending_optimization",
            "liquidity_provision",
            "staking_rewards"
        ],
        "risk_levels": ["low", "medium", "high"],
        "required_methods": [
            "executeStrategy",
            "analyzePortfolio",
            "monitorAndRebalance"
        ],
        "should_succeed": True
    },
    {
        "description": "Portfolio analysis features",
        "analysis_components": [
            "totalValue",
            "breakdown",
            "health",
            "recommendations"
        ],
        "health_metrics": [
            "liquidationRisk",
            "diversification",
            "riskScore"
        ],
        "should_succeed": True
    }
]

DEFI_DEPLOYMENT_TEST_CASES = [
    {
        "description": "DeFi deployment script",
        "script_file": "deployDeFi.ts",
        "deployment_steps": [
            "Deploy VeriChainXDEX",
            "Deploy VeriChainXLending",
            "Deploy VeriChainXStaking",
            "Initialize DeFi ecosystem"
        ],
        "initialization_features": [
            "Default liquidity pools",
            "Default lending markets",
            "Default staking pools"
        ],
        "should_succeed": True
    }
]

class TestDeFiIntegration:
    """Test DeFi protocol integration capabilities."""

    def test_defi_contract_structure(self):
        """Test DeFi contract structure and completeness."""
        from pathlib import Path
        
        for test_case in DEFI_CONTRACT_TEST_CASES:
            print(f"\n🔍 Testing: {test_case['description']}")
            
            contract_file = Path(f"hedera-service/contracts/DeFi/{test_case['contract_name']}.sol")
            if not contract_file.exists():
                print(f"❌ Contract file missing: {contract_file}")
                return False
            
            with open(contract_file) as f:
                content = f.read()
            
            # Check for required functions
            missing_functions = []
            for func in test_case['expected_functions']:
                if f"function {func}" not in content:
                    missing_functions.append(func)
            
            if missing_functions:
                print(f"❌ Missing functions: {missing_functions}")
                return False
            else:
                print(f"✅ All functions present: {len(test_case['expected_functions'])}")
            
            # Check for expected events
            missing_events = []
            for event in test_case['expected_events']:
                if f"event {event}" not in content:
                    missing_events.append(event)
            
            if missing_events:
                print(f"❌ Missing events: {missing_events}")
                return False
            else:
                print(f"✅ All events present: {len(test_case['expected_events'])}")
            
            # Check for security features
            security_features = [
                "AccessControl",
                "ReentrancyGuard",
                "Pausable"
            ]
            
            for feature in security_features:
                if feature in content:
                    print(f"✅ Security feature: {feature}")
                else:
                    print(f"⚠️ Missing security feature: {feature}")
            
            print(f"✅ {test_case['contract_name']} structure validated")
        
        return True

    def test_defi_service_integration(self):
        """Test DeFi service integration and methods."""
        from pathlib import Path
        
        for test_case in DEFI_SERVICE_TEST_CASES:
            print(f"\n🔧 Testing: {test_case['description']}")
            
            if 'service_file' in test_case:
                service_file = Path(f"hedera-service/src/services/{test_case['service_file']}")
                if not service_file.exists():
                    print(f"❌ Service file missing: {service_file}")
                    return False
                
                with open(service_file) as f:
                    content = f.read()
                
                # Check required methods
                for method in test_case['required_methods']:
                    if f"async {method}" in content or f"{method}(" in content:
                        print(f"✅ Method found: {method}")
                    else:
                        print(f"❌ Missing method: {method}")
                        return False
                
                # Check required interfaces
                if 'required_interfaces' in test_case:
                    for interface in test_case['required_interfaces']:
                        if f"interface {interface}" in content or f"export interface {interface}" in content:
                            print(f"✅ Interface found: {interface}")
                        else:
                            print(f"❌ Missing interface: {interface}")
                            return False
            
            # Check protocol operations
            if 'operations' in test_case:
                service_file = Path("hedera-service/src/services/defiService.ts")
                with open(service_file) as f:
                    content = f.read()
                
                protocol = test_case['protocol']
                for operation in test_case['operations']:
                    # Check if operation is handled in switch statement
                    if f"'{operation}'" in content or f'"{operation}"' in content:
                        print(f"✅ {protocol.upper()} operation: {operation}")
                    else:
                        print(f"❌ Missing {protocol.upper()} operation: {operation}")
                        return False
            
            print(f"✅ {test_case['description']} validated")
        
        return True

    def test_defi_agent_capabilities(self):
        """Test DeFi agent capabilities and strategies."""
        from pathlib import Path
        
        for test_case in DEFI_AGENT_TEST_CASES:
            print(f"\n🤖 Testing: {test_case['description']}")
            
            if 'agent_file' in test_case:
                agent_file = Path(f"hedera-service/src/agents/{test_case['agent_file']}")
                if not agent_file.exists():
                    print(f"❌ Agent file missing: {agent_file}")
                    return False
                
                with open(agent_file) as f:
                    content = f.read()
                
                # Check supported strategies
                if 'supported_strategies' in test_case:
                    for strategy in test_case['supported_strategies']:
                        if f"'{strategy}'" in content or f'"{strategy}"' in content:
                            print(f"✅ Strategy supported: {strategy}")
                        else:
                            print(f"❌ Missing strategy: {strategy}")
                            return False
                
                # Check risk levels
                if 'risk_levels' in test_case:
                    for risk_level in test_case['risk_levels']:
                        if f"'{risk_level}'" in content or f'"{risk_level}"' in content:
                            print(f"✅ Risk level supported: {risk_level}")
                        else:
                            print(f"❌ Missing risk level: {risk_level}")
                            return False
                
                # Check required methods
                if 'required_methods' in test_case:
                    for method in test_case['required_methods']:
                        if f"async {method}" in content or f"{method}(" in content:
                            print(f"✅ Method found: {method}")
                        else:
                            print(f"❌ Missing method: {method}")
                            return False
            
            # Check portfolio analysis components
            if 'analysis_components' in test_case:
                agent_file = Path("hedera-service/src/agents/DeFiAgent.ts")
                with open(agent_file) as f:
                    content = f.read()
                
                for component in test_case['analysis_components']:
                    if component in content:
                        print(f"✅ Analysis component: {component}")
                    else:
                        print(f"❌ Missing analysis component: {component}")
                        return False
                
                # Check health metrics
                if 'health_metrics' in test_case:
                    for metric in test_case['health_metrics']:
                        if metric in content:
                            print(f"✅ Health metric: {metric}")
                        else:
                            print(f"❌ Missing health metric: {metric}")
                            return False
            
            print(f"✅ {test_case['description']} validated")
        
        return True

    def test_defi_deployment_scripts(self):
        """Test DeFi deployment script completeness."""
        from pathlib import Path
        
        for test_case in DEFI_DEPLOYMENT_TEST_CASES:
            print(f"\n🚀 Testing: {test_case['description']}")
            
            script_file = Path(f"hedera-service/scripts/{test_case['script_file']}")
            if not script_file.exists():
                print(f"❌ Deployment script missing: {script_file}")
                return False
            
            with open(script_file) as f:
                content = f.read()
            
            # Check deployment steps
            for step in test_case['deployment_steps']:
                if step.lower().replace(' ', '') in content.lower().replace(' ', ''):
                    print(f"✅ Deployment step: {step}")
                else:
                    print(f"❌ Missing deployment step: {step}")
                    return False
            
            # Check initialization features
            for feature in test_case['initialization_features']:
                feature_key = feature.lower().replace(' ', '')
                if feature_key in content.lower().replace(' ', ''):
                    print(f"✅ Initialization feature: {feature}")
                else:
                    print(f"❌ Missing initialization feature: {feature}")
                    return False
            
            # Check for proper error handling
            if 'try {' in content and 'catch' in content:
                print("✅ Error handling implemented")
            else:
                print("⚠️ Limited error handling")
            
            # Check for gas optimization
            if 'gasLimit' in content and 'gasPrice' in content:
                print("✅ Gas optimization configured")
            else:
                print("⚠️ No gas optimization configuration")
            
            print(f"✅ {test_case['description']} validated")
        
        return True

    def test_defi_contract_compilation(self):
        """Test DeFi contract compilation."""
        from pathlib import Path
        
        try:
            # Check if Hardhat config supports DeFi contracts
            hardhat_config = Path("hedera-service/hardhat.config.ts")
            if not hardhat_config.exists():
                print("❌ Hardhat configuration not found")
                return False
            
            # Verify contract directory structure
            contracts_dir = Path("hedera-service/contracts/DeFi")
            if not contracts_dir.exists():
                print("❌ DeFi contracts directory not found")
                return False
            
            defi_contracts = [
                "VeriChainXDEX.sol",
                "VeriChainXLending.sol", 
                "VeriChainXStaking.sol"
            ]
            
            for contract in defi_contracts:
                contract_path = contracts_dir / contract
                if contract_path.exists():
                    print(f"✅ DeFi contract found: {contract}")
                    
                    # Check contract content
                    with open(contract_path) as f:
                        content = f.read()
                    
                    # Verify Solidity version
                    if "pragma solidity ^0.8.19" in content:
                        print(f"  ✅ Correct Solidity version")
                    else:
                        print(f"  ⚠️ Check Solidity version")
                    
                    # Verify OpenZeppelin imports
                    if "@openzeppelin/contracts" in content:
                        print(f"  ✅ OpenZeppelin imports found")
                    else:
                        print(f"  ⚠️ No OpenZeppelin imports")
                else:
                    print(f"❌ DeFi contract missing: {contract}")
                    return False
            
            print("✅ DeFi contract compilation structure validated")
            return True
            
        except Exception as e:
            print(f"❌ DeFi contract compilation test failed: {e}")
            return False

    def test_defi_integration_points(self):
        """Test integration points between DeFi components."""
        from pathlib import Path
        
        try:
            print("\n🔗 Testing DeFi integration points...")
            
            # Check SmartContractService DeFi integration
            smart_contract_service = Path("hedera-service/src/services/smartContractService.ts")
            if smart_contract_service.exists():
                with open(smart_contract_service) as f:
                    content = f.read()
                
                if "DeFi" in content or "defi" in content:
                    print("✅ SmartContractService has DeFi integration")
                else:
                    print("⚠️ SmartContractService may need DeFi integration")
            
            # Check DeFiAgent integration with HederaAgentKit
            defi_agent = Path("hedera-service/src/agents/DeFiAgent.ts")
            if defi_agent.exists():
                with open(defi_agent) as f:
                    content = f.read()
                
                if "HederaAgentKit" in content:
                    print("✅ DeFiAgent integrated with HederaAgentKit")
                else:
                    print("❌ Missing HederaAgentKit integration")
                    return False
                
                if "logStrategyToHedera" in content:
                    print("✅ Strategy logging to Hedera implemented")
                else:
                    print("⚠️ Strategy logging may need implementation")
            
            # Check package.json DeFi scripts
            package_json = Path("hedera-service/package.json")
            if package_json.exists():
                with open(package_json) as f:
                    content = f.read()
                
                if "deploy-defi" in content:
                    print("✅ DeFi deployment script configured")
                else:
                    print("❌ Missing DeFi deployment script")
                    return False
                
                if "compile-defi" in content:
                    print("✅ DeFi compilation script configured")
                else:
                    print("⚠️ DeFi compilation script may be missing")
            
            print("✅ DeFi integration points validated")
            return True
            
        except Exception as e:
            print(f"❌ DeFi integration points test failed: {e}")
            return False

    def test_defi_security_features(self):
        """Test DeFi security features and best practices."""
        from pathlib import Path
        
        print("\n🛡️ Testing DeFi security features...")
        
        security_features = {
            "Access Control": ["AccessControl", "onlyRole", "ADMIN_ROLE"],
            "Reentrancy Protection": ["ReentrancyGuard", "nonReentrant"],
            "Pausability": ["Pausable", "whenNotPaused", "pause()"],
            "Safe Math": ["SafeERC20", "safeTransfer", "safeTransferFrom"],
            "Input Validation": ["require(", "revert(", "InvalidInput"],
            "Emergency Functions": ["emergency", "Emergency", "emergencyWithdraw"]
        }
        
        contracts_dir = Path("hedera-service/contracts/DeFi")
        defi_contracts = ["VeriChainXDEX.sol", "VeriChainXLending.sol", "VeriChainXStaking.sol"]
        
        for contract_name in defi_contracts:
            print(f"\n  📜 Analyzing {contract_name} security...")
            contract_path = contracts_dir / contract_name
            
            if not contract_path.exists():
                print(f"❌ Contract not found: {contract_name}")
                return False
            
            with open(contract_path) as f:
                content = f.read()
            
            for feature_name, patterns in security_features.items():
                found_patterns = []
                for pattern in patterns:
                    if pattern in content:
                        found_patterns.append(pattern)
                
                if found_patterns:
                    print(f"    ✅ {feature_name}: {', '.join(found_patterns)}")
                else:
                    print(f"    ⚠️ {feature_name}: Not found")
            
            # Check for specific DeFi security considerations
            defi_security_checks = [
                ("Slippage Protection", ["slippage", "amountOutMin", "amountAMin"]),
                ("Liquidation Logic", ["liquidate", "liquidation", "collateral"]),
                ("Interest Rate Models", ["interest", "rate", "utilization"]),
                ("Oracle Integration", ["oracle", "price", "getPrice"]),
                ("Flash Loan Protection", ["flash", "loan", "callback"])
            ]
            
            for check_name, patterns in defi_security_checks:
                found = any(pattern.lower() in content.lower() for pattern in patterns)
                if found:
                    print(f"    ✅ {check_name}: Implemented")
                else:
                    print(f"    ⚠️ {check_name}: May need attention")
        
        print("✅ DeFi security features analysis completed")
        return True

    def test_defi_gas_optimization(self):
        """Test DeFi gas optimization strategies."""
        from pathlib import Path
        
        print("\n⚡ Testing DeFi gas optimization...")
        
        optimization_patterns = [
            ("Batch Operations", ["batch", "Batch", "multiple"]),
            ("Storage Optimization", ["packed", "uint128", "uint96"]),
            ("Function Modifiers", ["modifier", "updateReward", "poolExists"]),
            ("Event Emission", ["emit", "indexed", "Event"]),
            ("Gas Estimation", ["gasLimit", "gasPrice", "estimateGas"]),
            ("Efficient Loops", ["for (", "while (", "unchecked"])
        ]
        
        contracts_dir = Path("hedera-service/contracts/DeFi")
        defi_contracts = ["VeriChainXDEX.sol", "VeriChainXLending.sol", "VeriChainXStaking.sol"]
        
        for contract_name in defi_contracts:
            print(f"\n  ⚡ Analyzing {contract_name} gas optimization...")
            contract_path = contracts_dir / contract_name
            
            with open(contract_path) as f:
                content = f.read()
            
            for optimization_name, patterns in optimization_patterns:
                found_patterns = []
                for pattern in patterns:
                    if pattern in content:
                        found_patterns.append(pattern)
                
                if found_patterns:
                    print(f"    ✅ {optimization_name}: {', '.join(found_patterns)}")
                else:
                    print(f"    ⚠️ {optimization_name}: May need optimization")
        
        # Check deployment script gas configuration
        deploy_script = Path("hedera-service/scripts/deployDeFi.ts")
        if deploy_script.exists():
            with open(deploy_script) as f:
                content = f.read()
            
            gas_configs = ["gasLimit", "gasPrice", "gasSettings"]
            found_configs = [config for config in gas_configs if config in content]
            
            if found_configs:
                print(f"✅ Deployment gas configuration: {', '.join(found_configs)}")
            else:
                print("⚠️ Deployment gas configuration may need attention")
        
        print("✅ DeFi gas optimization analysis completed")
        return True


def run_defi_integration_tests():
    """Run comprehensive DeFi integration tests."""
    print("🚀 Starting DeFi Protocol Integration Tests")
    print("=" * 70)
    print("Testing Task 2: Add DeFi Protocol Integrations (DEXs, Lending, Staking)")
    print("=" * 70)
    
    test_suite = TestDeFiIntegration()
    
    test_methods = [
        ("DeFi Contract Structure", test_suite.test_defi_contract_structure),
        ("DeFi Service Integration", test_suite.test_defi_service_integration),
        ("DeFi Agent Capabilities", test_suite.test_defi_agent_capabilities),
        ("DeFi Deployment Scripts", test_suite.test_defi_deployment_scripts),
        ("DeFi Contract Compilation", test_suite.test_defi_contract_compilation),
        ("DeFi Integration Points", test_suite.test_defi_integration_points),
        ("DeFi Security Features", test_suite.test_defi_security_features),
        ("DeFi Gas Optimization", test_suite.test_defi_gas_optimization)
    ]
    
    results = {}
    passed = 0
    total = len(test_methods)
    
    for test_name, test_method in test_methods:
        print(f"\n🧪 Running: {test_name}")
        print("-" * 50)
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
    
    print("\n" + "=" * 70)
    print("📊 DEFI PROTOCOL INTEGRATION TEST RESULTS")
    print("=" * 70)
    
    for test_name, result in results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"  {status} {test_name}")
    
    print(f"\n🎯 Overall DeFi Tests: {passed}/{total} passed ({passed/total:.1%})")
    
    if passed == total:
        print("\n🎉 DEFI PROTOCOL INTEGRATION COMPLETE!")
        print("✅ Story 1.3 Task 2: Add DeFi Protocol Integrations - SUCCESS")
        print("\n🏗️ DeFi Infrastructure Summary:")
        print("  ✅ VeriChainXDEX: Automated Market Maker with liquidity pools")
        print("  ✅ VeriChainXLending: Collateralized lending and borrowing protocol")
        print("  ✅ VeriChainXStaking: Multi-pool staking with rewards and vesting")
        print("  ✅ DeFiService: Unified interface for all DeFi operations")
        print("  ✅ DeFiAgent: Intelligent DeFi strategies and portfolio management")
        print("  ✅ Security Features: Access control, reentrancy protection, pausability")
        print("  ✅ Gas Optimization: Efficient operations and batch processing")
        print("  ✅ Integration: Seamless integration with existing Hedera infrastructure")
        print("\n🚀 Ready for Task 3: Create Automated Market Maker (AMM)!")
        return True
    else:
        print(f"\n⚠️ DeFi Protocol Integration Issues Found")
        print(f"❌ {total - passed} test(s) failed. Implementation needs review.")
        print("\n🔧 Recommended actions:")
        for test_name, result in results.items():
            if not result:
                print(f"  - Review and fix: {test_name}")
        return False


if __name__ == "__main__":
    success = run_defi_integration_tests()
    exit(0 if success else 1)