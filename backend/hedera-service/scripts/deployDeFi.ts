/**
 * DeFi Contracts Deployment Script for VeriChainX
 * Deploys DEX, Lending, and Staking contracts with proper initialization
 */

import { ethers } from "hardhat";
import { Contract, ContractFactory } from "ethers";
import * as fs from "fs";
import * as path from "path";

interface DeFiDeploymentResult {
    contractName: string;
    address: string;
    transactionHash: string;
    network: string;
    deployedAt: string;
    gasUsed?: string;
    deploymentCost?: string;
    initializationTxs?: string[];
}

interface DeFiDeploymentConfig {
    network: string;
    adminAddress: string;
    feeRecipients: {
        dex: string;
        lending: string;
        staking: string;
    };
    gasSettings: {
        gasLimit: number;
        gasPrice: string;
    };
}

async function main() {
    console.log("🚀 Starting VeriChainX DeFi Contracts Deployment");
    console.log("=" * 70);

    // Get network information
    const network = await ethers.provider.getNetwork();
    const [deployer] = await ethers.getSigners();
    const balance = await deployer.getBalance();

    console.log(`📡 Network: ${network.name} (${network.chainId})`);
    console.log(`👤 Deployer: ${deployer.address}`);
    console.log(`💰 Balance: ${ethers.utils.formatEther(balance)} ETH`);
    console.log();

    const deploymentConfig: DeFiDeploymentConfig = {
        network: network.name,
        adminAddress: deployer.address,
        feeRecipients: {
            dex: deployer.address, // In production, use dedicated fee recipient addresses
            lending: deployer.address,
            staking: deployer.address
        },
        gasSettings: {
            gasLimit: 8000000, // Higher limit for complex DeFi contracts
            gasPrice: ethers.utils.parseUnits("25", "gwei").toString()
        }
    };

    const deploymentResults: DeFiDeploymentResult[] = [];

    try {
        // Step 1: Deploy VeriChainXDEX
        console.log("📈 Step 1: Deploying VeriChainXDEX...");
        const dexResult = await deployDEXContract(deploymentConfig);
        deploymentResults.push(dexResult);
        console.log(`✅ VeriChainXDEX deployed at: ${dexResult.address}`);
        console.log();

        // Wait between deployments
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Step 2: Deploy VeriChainXLending
        console.log("🏦 Step 2: Deploying VeriChainXLending...");
        const lendingResult = await deployLendingContract(deploymentConfig);
        deploymentResults.push(lendingResult);
        console.log(`✅ VeriChainXLending deployed at: ${lendingResult.address}`);
        console.log();

        // Wait between deployments
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Step 3: Deploy VeriChainXStaking
        console.log("🥩 Step 3: Deploying VeriChainXStaking...");
        const stakingResult = await deployStakingContract(deploymentConfig);
        deploymentResults.push(stakingResult);
        console.log(`✅ VeriChainXStaking deployed at: ${stakingResult.address}`);
        console.log();

        // Step 4: Initialize DeFi ecosystem
        console.log("⚙️ Step 4: Initializing DeFi ecosystem...");
        await initializeDeFiEcosystem(deploymentResults, deploymentConfig);
        console.log("✅ DeFi ecosystem initialized successfully");
        console.log();

        // Step 5: Save deployment results
        await saveDeFiDeploymentResults(deploymentResults, network.name);
        
        // Step 6: Generate integration examples
        await generateIntegrationExamples(deploymentResults);

        // Print comprehensive summary
        printDeFiDeploymentSummary(deploymentResults);

    } catch (error) {
        console.error("❌ DeFi Deployment failed:", error);
        process.exit(1);
    }
}

/**
 * Deploy VeriChainXDEX contract
 */
async function deployDEXContract(config: DeFiDeploymentConfig): Promise<DeFiDeploymentResult> {
    const ContractFactory: ContractFactory = await ethers.getContractFactory("VeriChainXDEX");
    
    console.log("  📋 Constructor args: [admin, feeRecipient]");
    console.log(`     - admin: ${config.adminAddress}`);
    console.log(`     - feeRecipient: ${config.feeRecipients.dex}`);

    const contract: Contract = await ContractFactory.deploy(
        config.adminAddress,
        config.feeRecipients.dex,
        {
            gasLimit: config.gasSettings.gasLimit,
            gasPrice: config.gasSettings.gasPrice
        }
    );

    await contract.deployed();
    const receipt = await contract.deployTransaction.wait();

    return {
        contractName: "VeriChainXDEX",
        address: contract.address,
        transactionHash: contract.deployTransaction.hash,
        network: config.network,
        deployedAt: new Date().toISOString(),
        gasUsed: receipt.gasUsed.toString(),
        deploymentCost: ethers.utils.formatEther(receipt.gasUsed.mul(contract.deployTransaction.gasPrice || 0))
    };
}

/**
 * Deploy VeriChainXLending contract
 */
async function deployLendingContract(config: DeFiDeploymentConfig): Promise<DeFiDeploymentResult> {
    const ContractFactory: ContractFactory = await ethers.getContractFactory("VeriChainXLending");
    
    console.log("  📋 Constructor args: [admin, protocolFeeRecipient]");
    console.log(`     - admin: ${config.adminAddress}`);
    console.log(`     - protocolFeeRecipient: ${config.feeRecipients.lending}`);

    const contract: Contract = await ContractFactory.deploy(
        config.adminAddress,
        config.feeRecipients.lending,
        {
            gasLimit: config.gasSettings.gasLimit,
            gasPrice: config.gasSettings.gasPrice
        }
    );

    await contract.deployed();
    const receipt = await contract.deployTransaction.wait();

    return {
        contractName: "VeriChainXLending",
        address: contract.address,
        transactionHash: contract.deployTransaction.hash,
        network: config.network,
        deployedAt: new Date().toISOString(),
        gasUsed: receipt.gasUsed.toString(),
        deploymentCost: ethers.utils.formatEther(receipt.gasUsed.mul(contract.deployTransaction.gasPrice || 0))
    };
}

/**
 * Deploy VeriChainXStaking contract
 */
async function deployStakingContract(config: DeFiDeploymentConfig): Promise<DeFiDeploymentResult> {
    const ContractFactory: ContractFactory = await ethers.getContractFactory("VeriChainXStaking");
    
    console.log("  📋 Constructor args: [admin, emergencyWithdrawFeeRecipient]");
    console.log(`     - admin: ${config.adminAddress}`);
    console.log(`     - emergencyWithdrawFeeRecipient: ${config.feeRecipients.staking}`);

    const contract: Contract = await ContractFactory.deploy(
        config.adminAddress,
        config.feeRecipients.staking,
        {
            gasLimit: config.gasSettings.gasLimit,
            gasPrice: config.gasSettings.gasPrice
        }
    );

    await contract.deployed();
    const receipt = await contract.deployTransaction.wait();

    return {
        contractName: "VeriChainXStaking",
        address: contract.address,
        transactionHash: contract.deployTransaction.hash,
        network: config.network,
        deployedAt: new Date().toISOString(),
        gasUsed: receipt.gasUsed.toString(),
        deploymentCost: ethers.utils.formatEther(receipt.gasUsed.mul(contract.deployTransaction.gasPrice || 0))
    };
}

/**
 * Initialize DeFi ecosystem with default configurations
 */
async function initializeDeFiEcosystem(
    deploymentResults: DeFiDeploymentResult[],
    config: DeFiDeploymentConfig
): Promise<void> {
    const dexAddress = deploymentResults.find(r => r.contractName === "VeriChainXDEX")?.address;
    const lendingAddress = deploymentResults.find(r => r.contractName === "VeriChainXLending")?.address;
    const stakingAddress = deploymentResults.find(r => r.contractName === "VeriChainXStaking")?.address;

    try {
        // Initialize DEX with default pools
        if (dexAddress) {
            console.log("  🔄 Setting up default liquidity pools...");
            const dex = await ethers.getContractAt("VeriChainXDEX", dexAddress);
            
            // Create sample pools (would use real token addresses in production)
            const samplePools = [
                {
                    name: "HBAR/USDC",
                    tokenA: "0x0000000000000000000000000000000000000001", // Placeholder
                    tokenB: "0x0000000000000000000000000000000000000002"  // Placeholder
                },
                {
                    name: "VCX/HBAR",
                    tokenA: "0x0000000000000000000000000000000000000003", // VCX token
                    tokenB: "0x0000000000000000000000000000000000000001"  // HBAR
                }
            ];

            for (const pool of samplePools) {
                try {
                    const tx = await dex.createPool(pool.tokenA, pool.tokenB, {
                        gasLimit: 2000000
                    });
                    await tx.wait();
                    console.log(`     ✅ Created pool: ${pool.name}`);
                } catch (error) {
                    console.log(`     ⚠️ Pool ${pool.name} creation failed or already exists`);
                }
            }
        }

        // Initialize Lending with default markets
        if (lendingAddress) {
            console.log("  🏦 Setting up default lending markets...");
            const lending = await ethers.getContractAt("VeriChainXLending", lendingAddress);
            
            const defaultMarkets = [
                {
                    name: "HBAR Market",
                    token: "0x0000000000000000000000000000000000000001",
                    collateralFactor: ethers.utils.parseEther("0.75"), // 75%
                    liquidationThreshold: ethers.utils.parseEther("0.8"), // 80%
                    reserveFactor: ethers.utils.parseEther("0.1"), // 10%
                    canBorrow: true,
                    canUseAsCollateral: true
                },
                {
                    name: "USDC Market",
                    token: "0x0000000000000000000000000000000000000002",
                    collateralFactor: ethers.utils.parseEther("0.85"), // 85%
                    liquidationThreshold: ethers.utils.parseEther("0.9"), // 90%
                    reserveFactor: ethers.utils.parseEther("0.05"), // 5%
                    canBorrow: true,
                    canUseAsCollateral: true
                }
            ];

            for (const market of defaultMarkets) {
                try {
                    const tx = await lending.addMarket(
                        market.token,
                        market.collateralFactor,
                        market.liquidationThreshold,
                        market.reserveFactor,
                        market.canBorrow,
                        market.canUseAsCollateral,
                        { gasLimit: 3000000 }
                    );
                    await tx.wait();
                    console.log(`     ✅ Added market: ${market.name}`);
                } catch (error) {
                    console.log(`     ⚠️ Market ${market.name} addition failed or already exists`);
                }
            }
        }

        // Initialize Staking with default pools
        if (stakingAddress) {
            console.log("  🥩 Setting up default staking pools...");
            const staking = await ethers.getContractAt("VeriChainXStaking", stakingAddress);
            
            const defaultStakingPools = [
                {
                    name: "VCX Staking Pool",
                    description: "Stake VCX tokens to earn rewards",
                    stakingToken: "0x0000000000000000000000000000000000000003", // VCX token
                    rewardToken: "0x0000000000000000000000000000000000000003", // VCX rewards
                    rewardRate: ethers.utils.parseEther("0.1"), // 0.1 tokens per second
                    lockupPeriod: 7 * 24 * 60 * 60, // 7 days
                    minStakeAmount: ethers.utils.parseEther("100"), // 100 tokens minimum
                    maxStakeAmount: 0 // No maximum
                },
                {
                    name: "LP Token Staking",
                    description: "Stake LP tokens from DEX pools",
                    stakingToken: "0x0000000000000000000000000000000000000004", // LP token
                    rewardToken: "0x0000000000000000000000000000000000000003", // VCX rewards
                    rewardRate: ethers.utils.parseEther("0.2"), // 0.2 tokens per second
                    lockupPeriod: 14 * 24 * 60 * 60, // 14 days
                    minStakeAmount: ethers.utils.parseEther("1"), // 1 LP token minimum
                    maxStakeAmount: 0 // No maximum
                }
            ];

            for (const pool of defaultStakingPools) {
                try {
                    const tx = await staking.createStakingPool(
                        pool.name,
                        pool.description,
                        pool.stakingToken,
                        pool.rewardToken,
                        pool.rewardRate,
                        pool.lockupPeriod,
                        pool.minStakeAmount,
                        pool.maxStakeAmount,
                        { gasLimit: 3000000 }
                    );
                    await tx.wait();
                    console.log(`     ✅ Created staking pool: ${pool.name}`);
                } catch (error) {
                    console.log(`     ⚠️ Staking pool ${pool.name} creation failed`);
                }
            }
        }

    } catch (error) {
        console.warn("  ⚠️ Some initialization steps failed, but deployment is complete");
        console.warn("     Manual initialization may be required");
    }
}

/**
 * Save DeFi deployment results
 */
async function saveDeFiDeploymentResults(
    results: DeFiDeploymentResult[],
    networkName: string
): Promise<void> {
    const deploymentsDir = path.join(__dirname, "../deployments/defi");
    if (!fs.existsSync(deploymentsDir)) {
        fs.mkdirSync(deploymentsDir, { recursive: true });
    }

    const filename = `defi-${networkName}-${Date.now()}.json`;
    const filepath = path.join(deploymentsDir, filename);

    const deploymentData = {
        network: networkName,
        deployedAt: new Date().toISOString(),
        contracts: results.reduce((acc, result) => {
            acc[result.contractName] = {
                address: result.address,
                transactionHash: result.transactionHash,
                gasUsed: result.gasUsed,
                deploymentCost: result.deploymentCost
            };
            return acc;
        }, {} as Record<string, any>),
        totalGasUsed: results.reduce((sum, r) => sum + parseInt(r.gasUsed || "0"), 0),
        totalCost: results.reduce((sum, r) => sum + parseFloat(r.deploymentCost || "0"), 0).toFixed(6),
        addresses: {
            dex: results.find(r => r.contractName === "VeriChainXDEX")?.address,
            lending: results.find(r => r.contractName === "VeriChainXLending")?.address,
            staking: results.find(r => r.contractName === "VeriChainXStaking")?.address
        }
    };

    fs.writeFileSync(filepath, JSON.stringify(deploymentData, null, 2));
    console.log(`💾 DeFi deployment results saved to: ${filepath}`);

    // Also save as latest.json
    const latestPath = path.join(deploymentsDir, `defi-${networkName}-latest.json`);
    fs.writeFileSync(latestPath, JSON.stringify(deploymentData, null, 2));
    console.log(`💾 Latest DeFi deployment saved to: ${latestPath}`);
}

/**
 * Generate integration examples
 */
async function generateIntegrationExamples(results: DeFiDeploymentResult[]): Promise<void> {
    const examplesDir = path.join(__dirname, "../examples/defi");
    if (!fs.existsSync(examplesDir)) {
        fs.mkdirSync(examplesDir, { recursive: true });
    }

    const addresses = {
        dex: results.find(r => r.contractName === "VeriChainXDEX")?.address,
        lending: results.find(r => r.contractName === "VeriChainXLending")?.address,
        staking: results.find(r => r.contractName === "VeriChainXStaking")?.address
    };

    const integrationExample = `
// VeriChainX DeFi Integration Example
import { DeFiService } from '../src/services/defiService';
import { DeFiAgent } from '../src/agents/DeFiAgent';

// Contract addresses (update after deployment)
const DEFI_ADDRESSES = {
    dex: '${addresses.dex}',
    lending: '${addresses.lending}',
    staking: '${addresses.staking}'
};

// Example: Execute yield farming strategy
async function executeYieldFarmingExample() {
    const defiAgent = new DeFiAgent(defiService, smartContractService, redisService);
    
    const result = await defiAgent.executeStrategy({
        strategy: 'yield_farming',
        parameters: {
            tokenA: '0x...',
            tokenB: '0x...',
            amount: '1000000000000000000', // 1 token
            userAddress: '0x...'
        },
        networkName: 'hedera-testnet',
        riskLevel: 'medium'
    });
    
    console.log('Yield farming result:', result);
}

// Example: Add liquidity to DEX
async function addLiquidityExample() {
    const defiService = new DeFiService(smartContractService, redisService);
    
    const result = await defiService.processRequest({
        protocol: 'dex',
        operation: 'add_liquidity',
        networkName: 'hedera-testnet',
        parameters: {
            poolId: '0x...',
            amountADesired: '1000000000000000000',
            amountBDesired: '1000000000000000000',
            amountAMin: '950000000000000000',
            amountBMin: '950000000000000000',
            to: '0x...'
        },
        options: {
            slippage: 500, // 5%
            deadline: 1800  // 30 minutes
        }
    });
    
    console.log('Add liquidity result:', result);
}

// Example: Supply to lending market
async function supplyToLendingExample() {
    const defiService = new DeFiService(smartContractService, redisService);
    
    const result = await defiService.processRequest({
        protocol: 'lending',
        operation: 'supply',
        networkName: 'hedera-testnet',
        parameters: {
            token: '0x...',
            amount: '1000000000000000000' // 1 token
        }
    });
    
    console.log('Supply result:', result);
}

// Example: Stake tokens
async function stakeTokensExample() {
    const defiService = new DeFiService(smartContractService, redisService);
    
    const result = await defiService.processRequest({
        protocol: 'staking',
        operation: 'stake',
        networkName: 'hedera-testnet',
        parameters: {
            poolId: '0x...',
            amount: '1000000000000000000' // 1 token
        }
    });
    
    console.log('Stake result:', result);
}
`;

    fs.writeFileSync(path.join(examplesDir, 'integration-examples.ts'), integrationExample);
    console.log(`📄 Integration examples saved to: ${examplesDir}/integration-examples.ts`);
}

/**
 * Print comprehensive deployment summary
 */
function printDeFiDeploymentSummary(results: DeFiDeploymentResult[]): void {
    console.log("🎉 DEFI DEPLOYMENT COMPLETE!");
    console.log("=" * 70);
    
    results.forEach(result => {
        console.log(`📜 ${result.contractName}`);
        console.log(`   Address: ${result.address}`);
        console.log(`   TX Hash: ${result.transactionHash}`);
        console.log(`   Gas Used: ${result.gasUsed}`);
        console.log(`   Cost: ${result.deploymentCost} ETH`);
        console.log();
    });

    const totalGas = results.reduce((sum, r) => sum + parseInt(r.gasUsed || "0"), 0);
    const totalCost = results.reduce((sum, r) => sum + parseFloat(r.deploymentCost || "0"), 0);

    console.log(`📊 DEFI TOTALS:`);
    console.log(`   Total Gas Used: ${totalGas.toLocaleString()}`);
    console.log(`   Total Cost: ${totalCost.toFixed(6)} ETH`);
    console.log();

    console.log(`🔧 NEXT STEPS:`);
    console.log(`   1. Update DeFiService with contract addresses`);
    console.log(`   2. Test DeFi functionality with example scripts`);
    console.log(`   3. Configure token addresses for production`);
    console.log(`   4. Set up monitoring and analytics`);
    console.log(`   5. Deploy frontend DeFi interface`);
    console.log();

    console.log(`📋 ENVIRONMENT VARIABLES:`);
    results.forEach(result => {
        const envVarName = `${result.contractName.toUpperCase()}_ADDRESS`;
        console.log(`   ${envVarName}=${result.address}`);
    });
    
    console.log();
    console.log(`🌟 DeFi Protocol Features:`);
    console.log(`   ✅ Decentralized Exchange (DEX) with AMM`);
    console.log(`   ✅ Lending & Borrowing Protocol`);
    console.log(`   ✅ Multi-Pool Staking with Rewards`);
    console.log(`   ✅ Yield Farming Strategies`);
    console.log(`   ✅ Portfolio Management`);    
    console.log(`   ✅ Risk Assessment & Optimization`);
    console.log();
    
    console.log(`🚀 Ready for Task 3: Create Automated Market Maker (AMM)!`);
}

// Execute main function
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });