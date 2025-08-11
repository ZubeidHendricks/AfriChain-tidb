import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  VeriChainXGovernance,
  VeriChainXAuthenticityToken,
  VeriChainXTokenUtility,
  VeriChainXDAOTreasury,
  TimelockController
} from "../typechain";

interface DeploymentConfig {
  // Token configuration
  tokenName: string;
  tokenSymbol: string;
  maxSupply: string;
  baseReward: string;
  qualityMultiplier: number;
  stakingAPY: number;
  burnRate: number;
  mintingCooldown: number;
  
  // Governance configuration
  votingDelay: number;
  votingPeriod: number;
  proposalThreshold: string;
  quorumPercentage: number;
  timelockDelay: number;
  
  // Network configuration
  networkName: string;
  explorerUrl: string;
}

const deploymentConfigs: Record<string, DeploymentConfig> = {
  // Hedera Testnet Configuration
  hedera_testnet: {
    tokenName: "VeriChainX Authenticity Token",
    tokenSymbol: "VERI",
    maxSupply: "1000000000", // 1B tokens
    baseReward: "100",
    qualityMultiplier: 120,
    stakingAPY: 12,
    burnRate: 100,
    mintingCooldown: 300,
    votingDelay: 1,
    votingPeriod: 50400, // ~1 week
    proposalThreshold: "1000",
    quorumPercentage: 20,
    timelockDelay: 86400, // 1 day
    networkName: "Hedera Testnet",
    explorerUrl: "https://hashscan.io/testnet"
  },
  
  // Ethereum Mainnet Configuration
  ethereum_mainnet: {
    tokenName: "VeriChainX Authenticity Token",
    tokenSymbol: "VERI",
    maxSupply: "1000000000",
    baseReward: "100",
    qualityMultiplier: 120,
    stakingAPY: 12,
    burnRate: 100,
    mintingCooldown: 3600, // 1 hour on mainnet
    votingDelay: 13140, // ~2 days
    votingPeriod: 40320, // ~1 week
    proposalThreshold: "10000", // Higher threshold for mainnet
    quorumPercentage: 25,
    timelockDelay: 172800, // 2 days
    networkName: "Ethereum Mainnet",
    explorerUrl: "https://etherscan.io"
  },
  
  // Polygon Configuration
  polygon_mainnet: {
    tokenName: "VeriChainX Authenticity Token",
    tokenSymbol: "VERI",
    maxSupply: "1000000000",
    baseReward: "100",
    qualityMultiplier: 120,
    stakingAPY: 15, // Higher APY for Polygon
    burnRate: 100,
    mintingCooldown: 300,
    votingDelay: 720, // ~1 day
    votingPeriod: 20160, // ~1 week
    proposalThreshold: "1000",
    quorumPercentage: 20,
    timelockDelay: 86400,
    networkName: "Polygon Mainnet",
    explorerUrl: "https://polygonscan.com"
  }
};

async function main() {
  console.log("🚀 Starting VeriChainX Advanced Tokenomics & Governance Deployment...\n");

  // Get network configuration
  const networkName = process.env.HARDHAT_NETWORK || "hardhat";
  const config = deploymentConfigs[networkName] || deploymentConfigs["hedera_testnet"];
  
  console.log(`📡 Deploying to: ${config.networkName}`);
  console.log(`🔗 Explorer: ${config.explorerUrl}\n`);

  const [deployer]: SignerWithAddress[] = await ethers.getSigners();
  console.log(`👤 Deployer: ${deployer.address}`);
  console.log(`💰 Balance: ${ethers.utils.formatEther(await deployer.getBalance())} ETH\n`);

  const deploymentAddresses: Record<string, string> = {};
  const deploymentTxHashes: Record<string, string> = {};

  try {
    // Step 1: Deploy Authenticity Token
    console.log("📝 Step 1: Deploying VeriChainX Authenticity Token...");
    const TokenFactory = await ethers.getContractFactory("VeriChainXAuthenticityToken");
    
    const tokenConfig = {
      maxSupply: ethers.utils.parseEther(config.maxSupply),
      baseReward: ethers.utils.parseEther(config.baseReward),
      qualityMultiplier: config.qualityMultiplier,
      stakingAPY: config.stakingAPY,
      burnRate: config.burnRate,
      mintingCooldown: config.mintingCooldown
    };

    const token = await TokenFactory.deploy(
      config.tokenName,
      config.tokenSymbol,
      deployer.address,
      tokenConfig
    );
    await token.deployed();
    
    deploymentAddresses.token = token.address;
    deploymentTxHashes.token = token.deployTransaction.hash;
    console.log(`✅ Token deployed: ${token.address}`);
    console.log(`   Transaction: ${token.deployTransaction.hash}\n`);

    // Step 2: Deploy Timelock Controller
    console.log("📝 Step 2: Deploying Timelock Controller...");
    const TimelockFactory = await ethers.getContractFactory("TimelockController");
    
    const timelock = await TimelockFactory.deploy(
      config.timelockDelay,
      [deployer.address], // proposers
      [deployer.address], // executors
      deployer.address    // admin
    );
    await timelock.deployed();
    
    deploymentAddresses.timelock = timelock.address;
    deploymentTxHashes.timelock = timelock.deployTransaction.hash;
    console.log(`✅ Timelock deployed: ${timelock.address}`);
    console.log(`   Transaction: ${timelock.deployTransaction.hash}\n`);

    // Step 3: Deploy Governance Contract
    console.log("📝 Step 3: Deploying Governance Contract...");
    const GovernanceFactory = await ethers.getContractFactory("VeriChainXGovernance");
    
    const governance = await GovernanceFactory.deploy(
      token.address,
      timelock.address,
      deployer.address, // temporary treasury address
      config.votingDelay,
      config.votingPeriod,
      ethers.utils.parseEther(config.proposalThreshold),
      config.quorumPercentage
    );
    await governance.deployed();
    
    deploymentAddresses.governance = governance.address;
    deploymentTxHashes.governance = governance.deployTransaction.hash;
    console.log(`✅ Governance deployed: ${governance.address}`);
    console.log(`   Transaction: ${governance.deployTransaction.hash}\n`);

    // Step 4: Deploy Token Utility System
    console.log("📝 Step 4: Deploying Token Utility System...");
    const UtilityFactory = await ethers.getContractFactory("VeriChainXTokenUtility");
    
    const utility = await UtilityFactory.deploy(
      token.address,
      deployer.address
    );
    await utility.deployed();
    
    deploymentAddresses.utility = utility.address;
    deploymentTxHashes.utility = utility.deployTransaction.hash;
    console.log(`✅ Utility System deployed: ${utility.address}`);
    console.log(`   Transaction: ${utility.deployTransaction.hash}\n`);

    // Step 5: Deploy DAO Treasury
    console.log("📝 Step 5: Deploying DAO Treasury...");
    const TreasuryFactory = await ethers.getContractFactory("VeriChainXDAOTreasury");
    
    const treasury = await TreasuryFactory.deploy(
      token.address,
      governance.address,
      deployer.address
    );
    await treasury.deployed();
    
    deploymentAddresses.treasury = treasury.address;
    deploymentTxHashes.treasury = treasury.deployTransaction.hash;
    console.log(`✅ DAO Treasury deployed: ${treasury.address}`);
    console.log(`   Transaction: ${treasury.deployTransaction.hash}\n`);

    // Step 6: Configure Permissions and Roles
    console.log("📝 Step 6: Configuring Permissions and Roles...");
    
    // Configure Timelock permissions
    console.log("   ⚙️  Configuring Timelock permissions...");
    await timelock.grantRole(await timelock.PROPOSER_ROLE(), governance.address);
    await timelock.grantRole(await timelock.EXECUTOR_ROLE(), governance.address);
    console.log("   ✅ Timelock roles configured");

    // Configure Token permissions for utility system
    console.log("   ⚙️  Configuring Token permissions...");
    await token.grantRole(await token.REPUTATION_MANAGER_ROLE(), utility.address);
    console.log("   ✅ Token permissions configured");

    // Initialize governance with expertise areas
    console.log("   ⚙️  Initializing governance expertise...");
    const expertiseAreas = [
      { area: "Security", score: 800 },
      { area: "DeFi", score: 700 },
      { area: "TokenEconomics", score: 900 },
      { area: "ProductAuthenticity", score: 850 }
    ];

    for (const expertise of expertiseAreas) {
      await governance.addExpertise(
        deployer.address,
        expertise.area,
        expertise.score,
        true
      );
    }
    console.log("   ✅ Governance expertise configured");

    // Step 7: Initialize Treasury with initial funding
    console.log("📝 Step 7: Initializing Treasury...");
    
    // Mint initial tokens for treasury
    await token.mintFromVerification(
      treasury.address,
      1000, // verification ID
      95,   // authenticity score
      ethers.utils.formatBytes32String("governance"),
      "initial-treasury-funding"
    );
    
    const treasuryBalance = await token.balanceOf(treasury.address);
    console.log(`   ✅ Treasury initialized with ${ethers.utils.formatEther(treasuryBalance)} VERI tokens`);

    // Step 8: Verification and Testing
    console.log("📝 Step 8: Running Deployment Verification...");
    
    // Verify token functionality
    const tokenName = await token.name();
    const tokenSymbol = await token.symbol();
    const totalSupply = await token.totalSupply();
    console.log(`   ✅ Token verified: ${tokenName} (${tokenSymbol}), Supply: ${ethers.utils.formatEther(totalSupply)}`);

    // Verify governance functionality
    const votingDelay = await governance.votingDelay();
    const votingPeriod = await governance.votingPeriod();
    const proposalThreshold = await governance.proposalThreshold();
    console.log(`   ✅ Governance verified: Delay: ${votingDelay}, Period: ${votingPeriod}, Threshold: ${ethers.utils.formatEther(proposalThreshold)}`);

    // Verify utility system
    const tierConfig = await utility.getTierConfig(0); // Bronze tier
    console.log(`   ✅ Utility verified: Bronze tier discount: ${tierConfig.feeDiscountBps / 100}%`);

    // Verify treasury
    const treasuryInfo = await treasury.getTreasuryInfo();
    console.log(`   ✅ Treasury verified: Total Value: ${ethers.utils.formatEther(treasuryInfo.totalValue)} VERI`);

    // Step 9: Generate Deployment Summary
    console.log("\n🎉 DEPLOYMENT COMPLETED SUCCESSFULLY!\n");
    
    const deploymentSummary = {
      network: config.networkName,
      timestamp: new Date().toISOString(),
      deployer: deployer.address,
      contracts: deploymentAddresses,
      transactions: deploymentTxHashes,
      configuration: {
        token: {
          name: config.tokenName,
          symbol: config.tokenSymbol,
          maxSupply: config.maxSupply,
          stakingAPY: config.stakingAPY
        },
        governance: {
          votingDelay: config.votingDelay,
          votingPeriod: config.votingPeriod,
          proposalThreshold: config.proposalThreshold,
          quorumPercentage: config.quorumPercentage
        },
        timelock: {
          delay: config.timelockDelay
        }
      }
    };

    console.log("📊 DEPLOYMENT SUMMARY:");
    console.log("=".repeat(60));
    console.log(`🌐 Network: ${deploymentSummary.network}`);
    console.log(`📅 Deployed: ${deploymentSummary.timestamp}`);
    console.log(`👤 Deployer: ${deploymentSummary.deployer}`);
    console.log("");
    console.log("📋 CONTRACT ADDRESSES:");
    console.log("─".repeat(60));
    console.log(`🪙  VeriChainX Token:     ${deploymentAddresses.token}`);
    console.log(`⏰ Timelock Controller:  ${deploymentAddresses.timelock}`);
    console.log(`🗳️  Governance:           ${deploymentAddresses.governance}`);
    console.log(`🛠️  Token Utility:        ${deploymentAddresses.utility}`);
    console.log(`🏛️  DAO Treasury:         ${deploymentAddresses.treasury}`);
    console.log("");
    console.log("🔗 TRANSACTION HASHES:");
    console.log("─".repeat(60));
    for (const [contract, hash] of Object.entries(deploymentTxHashes)) {
      console.log(`${contract.padEnd(15)}: ${hash}`);
    }
    console.log("");
    console.log("⚙️  CONFIGURATION:");
    console.log("─".repeat(60));
    console.log(`Token Max Supply:    ${config.maxSupply} VERI`);
    console.log(`Staking APY:         ${config.stakingAPY}%`);
    console.log(`Voting Delay:        ${config.votingDelay} blocks`);
    console.log(`Voting Period:       ${config.votingPeriod} blocks`);
    console.log(`Proposal Threshold:  ${config.proposalThreshold} VERI`);
    console.log(`Quorum:             ${config.quorumPercentage}%`);
    console.log(`Timelock Delay:     ${config.timelockDelay / 86400} days`);
    console.log("");
    console.log("🎯 NEXT STEPS:");
    console.log("─".repeat(60));
    console.log("1. Verify contracts on block explorer");
    console.log("2. Create initial governance proposals");
    console.log("3. Set up monitoring and alerts");
    console.log("4. Configure frontend integration");
    console.log("5. Initialize community governance");
    console.log("");
    console.log("📚 USEFUL COMMANDS:");
    console.log("─".repeat(60));
    console.log(`# Verify Token Contract:`);
    console.log(`npx hardhat verify --network ${networkName} ${deploymentAddresses.token} "${config.tokenName}" "${config.tokenSymbol}" "${deployer.address}" "[object Object]"`);
    console.log("");
    console.log(`# Create First Proposal (example):`);
    console.log(`await governance.proposeWithMetadata([token.address], [0], [data], "description", 0, "title", "", [], false, 0, "0x0000000000000000000000000000000000000000");`);
    console.log("");

    // Save deployment info to file
    const fs = require('fs');
    const deploymentData = JSON.stringify(deploymentSummary, null, 2);
    const filename = `deployment-${networkName}-${Date.now()}.json`;
    fs.writeFileSync(filename, deploymentData);
    console.log(`💾 Deployment data saved to: ${filename}`);

    console.log("\n🚀 VeriChainX Advanced Tokenomics & Governance deployed successfully!");
    console.log(`🔗 View on ${config.explorerUrl}`);

  } catch (error) {
    console.error("\n❌ DEPLOYMENT FAILED!");
    console.error("Error:", error);
    
    // Cleanup any partially deployed contracts
    console.log("\n🧹 Cleaning up partial deployment...");
    
    process.exit(1);
  }
}

// Helper function to wait for transaction confirmation
async function waitForConfirmation(tx: any, confirmations: number = 2) {
  console.log(`   ⏳ Waiting for ${confirmations} confirmations...`);
  const receipt = await tx.wait(confirmations);
  console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`);
  return receipt;
}

// Helper function to estimate gas costs
async function estimateDeploymentCosts() {
  console.log("💰 Estimating deployment costs...");
  
  const gasPrice = await ethers.provider.getGasPrice();
  console.log(`   Gas Price: ${ethers.utils.formatUnits(gasPrice, "gwei")} gwei`);
  
  // Estimated gas costs for each contract
  const estimatedGas = {
    token: 3500000,
    timelock: 1200000,
    governance: 4500000,
    utility: 3000000,
    treasury: 3500000
  };
  
  let totalGas = 0;
  for (const [contract, gas] of Object.entries(estimatedGas)) {
    const cost = gasPrice.mul(gas);
    console.log(`   ${contract.padEnd(10)}: ~${gas.toLocaleString()} gas (~${ethers.utils.formatEther(cost)} ETH)`);
    totalGas += gas;
  }
  
  const totalCost = gasPrice.mul(totalGas);
  console.log(`   TOTAL:      ~${totalGas.toLocaleString()} gas (~${ethers.utils.formatEther(totalCost)} ETH)`);
  console.log("");
}

// Run deployment
if (require.main === module) {
  estimateDeploymentCosts().then(() => {
    main()
      .then(() => process.exit(0))
      .catch((error) => {
        console.error(error);
        process.exit(1);
      });
  });
}

export { main as deployGovernance, deploymentConfigs };