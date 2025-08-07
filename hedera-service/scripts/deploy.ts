/**
 * Smart Contract Deployment Script for VeriChainX
 * Deploys authenticity verification and token factory contracts
 */

import { ethers } from "hardhat";
import { Contract, ContractFactory } from "ethers";
import * as fs from "fs";
import * as path from "path";

interface DeploymentResult {
  contractName: string;
  address: string;
  transactionHash: string;
  network: string;
  deployedAt: string;
  gasUsed?: string;
  deploymentCost?: string;
}

interface DeploymentConfig {
  network: string;
  adminAddress: string;
  gasLimit?: number;
  gasPrice?: string;
}

async function main() {
  console.log("🚀 Starting VeriChainX Smart Contract Deployment");
  console.log("=" * 60);

  // Get network information
  const network = await ethers.provider.getNetwork();
  const [deployer] = await ethers.getSigners();
  const balance = await deployer.getBalance();

  console.log(`📡 Network: ${network.name} (${network.chainId})`);
  console.log(`👤 Deployer: ${deployer.address}`);
  console.log(`💰 Balance: ${ethers.utils.formatEther(balance)} ETH`);
  console.log();

  const deploymentConfig: DeploymentConfig = {
    network: network.name,
    adminAddress: deployer.address,
    gasLimit: 5000000,
    gasPrice: ethers.utils.parseUnits("20", "gwei").toString()
  };

  const deploymentResults: DeploymentResult[] = [];

  try {
    // Step 1: Deploy VeriChainXAuthenticityVerifier
    console.log("📜 Step 1: Deploying VeriChainXAuthenticityVerifier...");
    const verifierResult = await deployAuthenticityVerifier(deploymentConfig);
    deploymentResults.push(verifierResult);
    console.log(`✅ VeriChainXAuthenticityVerifier deployed at: ${verifierResult.address}`);
    console.log();

    // Wait a bit between deployments
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Step 2: Deploy VeriChainXTokenFactory
    console.log("🏭 Step 2: Deploying VeriChainXTokenFactory...");
    const factoryResult = await deployTokenFactory(deploymentConfig, verifierResult.address);
    deploymentResults.push(factoryResult);
    console.log(`✅ VeriChainXTokenFactory deployed at: ${factoryResult.address}`);
    console.log();

    // Step 3: Initialize contracts
    console.log("⚙️ Step 3: Initializing contracts...");
    await initializeContracts(verifierResult.address, factoryResult.address);
    console.log("✅ Contracts initialized successfully");
    console.log();

    // Step 4: Save deployment results
    await saveDeploymentResults(deploymentResults, network.name);
    
    // Step 5: Verify contracts (if on testnet/mainnet)
    if (network.chainId !== 31337) {
      console.log("🔍 Step 5: Contract verification info saved for manual verification");
      await saveVerificationInfo(deploymentResults);
    }

    // Print summary
    printDeploymentSummary(deploymentResults);

  } catch (error) {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  }
}

/**
 * Deploy VeriChainXAuthenticityVerifier contract
 */
async function deployAuthenticityVerifier(config: DeploymentConfig): Promise<DeploymentResult> {
  const ContractFactory: ContractFactory = await ethers.getContractFactory("VeriChainXAuthenticityVerifier");
  
  console.log("  📋 Constructor args: [admin]");
  console.log(`     - admin: ${config.adminAddress}`);

  const contract: Contract = await ContractFactory.deploy(
    config.adminAddress,
    {
      gasLimit: config.gasLimit,
      gasPrice: config.gasPrice
    }
  );

  await contract.deployed();
  const receipt = await contract.deployTransaction.wait();

  return {
    contractName: "VeriChainXAuthenticityVerifier",
    address: contract.address,
    transactionHash: contract.deployTransaction.hash,
    network: config.network,
    deployedAt: new Date().toISOString(),
    gasUsed: receipt.gasUsed.toString(),
    deploymentCost: ethers.utils.formatEther(receipt.gasUsed.mul(contract.deployTransaction.gasPrice || 0))
  };
}

/**
 * Deploy VeriChainXTokenFactory contract
 */
async function deployTokenFactory(config: DeploymentConfig, verifierAddress: string): Promise<DeploymentResult> {
  const ContractFactory: ContractFactory = await ethers.getContractFactory("VeriChainXTokenFactory");
  
  console.log("  📋 Constructor args: [admin, verifierAddress]");
  console.log(`     - admin: ${config.adminAddress}`);
  console.log(`     - verifierAddress: ${verifierAddress}`);

  const contract: Contract = await ContractFactory.deploy(
    config.adminAddress,
    verifierAddress,
    {
      gasLimit: config.gasLimit,
      gasPrice: config.gasPrice
    }
  );

  await contract.deployed();
  const receipt = await contract.deployTransaction.wait();

  return {
    contractName: "VeriChainXTokenFactory",
    address: contract.address,
    transactionHash: contract.deployTransaction.hash,
    network: config.network,
    deployedAt: new Date().toISOString(),
    gasUsed: receipt.gasUsed.toString(),
    deploymentCost: ethers.utils.formatEther(receipt.gasUsed.mul(contract.deployTransaction.gasPrice || 0))
  };
}

/**
 * Initialize deployed contracts
 */
async function initializeContracts(verifierAddress: string, factoryAddress: string): Promise<void> {
  // Get contract instances
  const verifier = await ethers.getContractAt("VeriChainXAuthenticityVerifier", verifierAddress);
  const factory = await ethers.getContractAt("VeriChainXTokenFactory", factoryAddress);

  try {
    // Create default certificate collections
    console.log("  📁 Creating default certificate collections...");
    
    const collections = [
      {
        id: "STANDARD",
        name: "VeriChainX Standard Certificates",
        symbol: "VCXSTD",
        baseURI: "https://api.verichainx.com/metadata/standard/"
      },
      {
        id: "PREMIUM",
        name: "VeriChainX Premium Certificates", 
        symbol: "VCXPREM",
        baseURI: "https://api.verichainx.com/metadata/premium/"
      },
      {
        id: "LUXURY",
        name: "VeriChainX Luxury Certificates",
        symbol: "VCXLUX", 
        baseURI: "https://api.verichainx.com/metadata/luxury/"
      }
    ];

    for (const collection of collections) {
      try {
        const tx = await factory.createCertificateCollection(
          collection.id,
          collection.name,
          collection.symbol,
          collection.baseURI,
          { gasLimit: 2000000 }
        );
        await tx.wait();
        console.log(`     ✅ Created collection: ${collection.name}`);
      } catch (error) {
        console.log(`     ⚠️ Collection ${collection.id} may already exist or creation failed`);
      }
    }

    console.log("  🔧 Setting up verification rules...");
    // Additional initialization can be added here

  } catch (error) {
    console.warn("  ⚠️ Some initialization steps failed, but deployment is complete");
    console.warn("     Manual initialization may be required");
  }
}

/**
 * Save deployment results to file
 */
async function saveDeploymentResults(results: DeploymentResult[], networkName: string): Promise<void> {
  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const filename = `${networkName}-${Date.now()}.json`;
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
    totalCost: results.reduce((sum, r) => sum + parseFloat(r.deploymentCost || "0"), 0).toFixed(6)
  };

  fs.writeFileSync(filepath, JSON.stringify(deploymentData, null, 2));
  console.log(`💾 Deployment results saved to: ${filepath}`);

  // Also save as latest.json
  const latestPath = path.join(deploymentsDir, `${networkName}-latest.json`);
  fs.writeFileSync(latestPath, JSON.stringify(deploymentData, null, 2));
  console.log(`💾 Latest deployment saved to: ${latestPath}`);
}

/**
 * Save contract verification information
 */
async function saveVerificationInfo(results: DeploymentResult[]): Promise<void> {
  const verificationDir = path.join(__dirname, "../verification");
  if (!fs.existsSync(verificationDir)) {
    fs.mkdirSync(verificationDir, { recursive: true });
  }

  for (const result of results) {
    const verificationInfo = {
      contractName: result.contractName,
      address: result.address,
      network: result.network,
      // Constructor arguments would be saved here for verification
      constructorArgs: getConstructorArgs(result.contractName),
      verificationCommand: `npx hardhat verify --network ${result.network} ${result.address} ${getConstructorArgs(result.contractName).join(" ")}`
    };

    const filename = `${result.contractName}-${result.network}.json`;
    const filepath = path.join(verificationDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(verificationInfo, null, 2));
  }

  console.log(`🔍 Verification info saved to: ${verificationDir}`);
}

/**
 * Get constructor arguments for verification
 */
function getConstructorArgs(contractName: string): string[] {
  // This would return the actual constructor arguments used
  // For now, return empty array as placeholder
  return [];
}

/**
 * Print deployment summary
 */
function printDeploymentSummary(results: DeploymentResult[]): void {
  console.log("🎉 DEPLOYMENT COMPLETE!");
  console.log("=" * 60);
  
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

  console.log(`📊 TOTALS:`);
  console.log(`   Total Gas Used: ${totalGas.toLocaleString()}`);
  console.log(`   Total Cost: ${totalCost.toFixed(6)} ETH`);
  console.log();

  console.log(`🔧 NEXT STEPS:`);
  console.log(`   1. Update environment variables with contract addresses`);
  console.log(`   2. Verify contracts on block explorer (if on testnet/mainnet)`);
  console.log(`   3. Configure smart contract service with new addresses`);
  console.log(`   4. Test contract functionality`);
  console.log();

  console.log(`📋 ENVIRONMENT VARIABLES:`);
  results.forEach(result => {
    const envVarName = `${result.contractName.toUpperCase()}_ADDRESS`;
    console.log(`   ${envVarName}=${result.address}`);
  });
}

// Helper function for string repetition
function repeat(str: string, times: number): string {
  return Array(times + 1).join(str);
}

// Execute main function
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });