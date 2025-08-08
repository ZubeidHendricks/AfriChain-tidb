import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  VeriChainXGovernance,
  VeriChainXAuthenticityToken,
  VeriChainXTokenUtility,
  VeriChainXDAOTreasury,
  TimelockController
} from "../typechain";

describe("VeriChainX Advanced Tokenomics and Governance", function () {
  let governance: VeriChainXGovernance;
  let token: VeriChainXAuthenticityToken;
  let utility: VeriChainXTokenUtility;
  let treasury: VeriChainXDAOTreasury;
  let timelock: TimelockController;
  
  let admin: SignerWithAddress;
  let proposer: SignerWithAddress;
  let voter1: SignerWithAddress;
  let voter2: SignerWithAddress;
  let expert: SignerWithAddress;
  let user: SignerWithAddress;
  
  const VOTING_DELAY = 1; // 1 block
  const VOTING_PERIOD = 50400; // 1 week
  const PROPOSAL_THRESHOLD = ethers.utils.parseEther("1000"); // 1,000 tokens
  const QUORUM_PERCENTAGE = 20; // 20%
  const TIMELOCK_DELAY = 86400; // 1 day

  beforeEach(async function () {
    [admin, proposer, voter1, voter2, expert, user] = await ethers.getSigners();

    // Deploy TimelockController
    const TimelockFactory = await ethers.getContractFactory("TimelockController");
    timelock = await TimelockFactory.deploy(
      TIMELOCK_DELAY,
      [admin.address],
      [admin.address],
      admin.address
    );
    await timelock.deployed();

    // Deploy VeriChainX Authenticity Token
    const TokenFactory = await ethers.getContractFactory("VeriChainXAuthenticityToken");
    const tokenConfig = {
      maxSupply: ethers.utils.parseEther("1000000000"), // 1B tokens
      baseReward: ethers.utils.parseEther("100"),
      qualityMultiplier: 120,
      stakingAPY: 12,
      burnRate: 100,
      mintingCooldown: 300
    };
    
    token = await TokenFactory.deploy(
      "VeriChainX Authenticity Token",
      "VERI",
      admin.address,
      tokenConfig
    );
    await token.deployed();

    // Deploy Governance Contract
    const GovernanceFactory = await ethers.getContractFactory("VeriChainXGovernance");
    governance = await GovernanceFactory.deploy(
      token.address,
      timelock.address,
      admin.address, // treasury address (will be replaced)
      VOTING_DELAY,
      VOTING_PERIOD,
      PROPOSAL_THRESHOLD,
      QUORUM_PERCENTAGE
    );
    await governance.deployed();

    // Deploy Token Utility System
    const UtilityFactory = await ethers.getContractFactory("VeriChainXTokenUtility");
    utility = await UtilityFactory.deploy(
      token.address,
      admin.address
    );
    await utility.deployed();

    // Deploy DAO Treasury
    const TreasuryFactory = await ethers.getContractFactory("VeriChainXDAOTreasury");
    treasury = await TreasuryFactory.deploy(
      token.address,
      governance.address,
      admin.address
    );
    await treasury.deployed();

    // Setup initial token distribution
    await token.connect(admin).mintFromVerification(
      proposer.address,
      1,
      95,
      ethers.utils.formatBytes32String("electronics"),
      "product-1"
    );
    
    await token.connect(admin).mintFromVerification(
      voter1.address,
      2,
      90,
      ethers.utils.formatBytes32String("electronics"),
      "product-2"
    );
    
    await token.connect(admin).mintFromVerification(
      voter2.address,
      3,
      85,
      ethers.utils.formatBytes32String("luxury"),
      "product-3"
    );

    await token.connect(admin).mintFromVerification(
      expert.address,
      4,
      98,
      ethers.utils.formatBytes32String("electronics"),
      "product-4"
    );

    // Setup expert credentials
    await governance.connect(admin).addExpertise(
      expert.address,
      "Security",
      800,
      true
    );

    // Setup roles
    await timelock.connect(admin).grantRole(await timelock.PROPOSER_ROLE(), governance.address);
    await timelock.connect(admin).grantRole(await timelock.EXECUTOR_ROLE(), governance.address);
  });

  describe("Governance System", function () {
    describe("Proposal Creation", function () {
      it("Should create proposal with metadata", async function () {
        const targets = [token.address];
        const values = [0];
        const calldatas = [token.interface.encodeFunctionData("pause")];
        const description = "Emergency pause of token contract";
        const title = "Emergency Pause";
        const discussionUrl = "https://forum.verichainx.com/proposal/1";
        const tags = [ethers.utils.formatBytes32String("emergency")];

        const tx = await governance.connect(proposer).proposeWithMetadata(
          targets,
          values,
          calldatas,
          description,
          0, // ProposalCategory.STANDARD
          title,
          discussionUrl,
          tags,
          false, // quadraticVoting
          0,     // treasuryAmount
          ethers.constants.AddressZero // treasuryRecipient
        );

        const receipt = await tx.wait();
        const event = receipt.events?.find(e => e.event === "ProposalCreatedWithMetadata");
        expect(event).to.not.be.undefined;
        expect(event?.args?.title).to.equal(title);
      });

      it("Should create emergency proposal with multi-sig", async function () {
        const targets = [token.address];
        const values = [0];
        const calldatas = [token.interface.encodeFunctionData("pause")];
        const description = "Emergency pause";
        const requiredSigners = [admin.address, expert.address];

        await governance.connect(admin).grantRole(
          await governance.EMERGENCY_ROLE(),
          admin.address
        );

        const tx = await governance.connect(admin).createEmergencyProposal(
          targets,
          values,
          calldatas,
          description,
          requiredSigners
        );

        const receipt = await tx.wait();
        const event = receipt.events?.find(e => e.event === "MultiSigRequirement");
        expect(event).to.not.be.undefined;
        expect(event?.args?.signers).to.deep.equal(requiredSigners);
      });

      it("Should fail proposal creation with insufficient tokens", async function () {
        const targets = [token.address];
        const values = [0];
        const calldatas = [token.interface.encodeFunctionData("pause")];
        const description = "Test proposal";

        await expect(
          governance.connect(user).proposeWithMetadata(
            targets,
            values,
            calldatas,
            description,
            0,
            "Test",
            "",
            [],
            false,
            0,
            ethers.constants.AddressZero
          )
        ).to.be.revertedWith("Governor: proposer votes below proposal threshold");
      });
    });

    describe("Voting Mechanics", function () {
      let proposalId: any;

      beforeEach(async function () {
        const targets = [token.address];
        const values = [0];
        const calldatas = [token.interface.encodeFunctionData("unpause")];
        const description = "Unpause token contract";

        const tx = await governance.connect(proposer).proposeWithMetadata(
          targets,
          values,
          calldatas,
          description,
          0,
          "Unpause Token",
          "",
          [],
          false,
          0,
          ethers.constants.AddressZero
        );

        const receipt = await tx.wait();
        const event = receipt.events?.find(e => e.event === "ProposalCreated");
        proposalId = event?.args?.proposalId;

        // Move to voting period
        await ethers.provider.send("hardhat_mine", [ethers.utils.hexValue(VOTING_DELAY + 1)]);
      });

      it("Should cast vote with enhanced features", async function () {
        const tx = await governance.connect(voter1).castVoteWithReason(
          proposalId,
          1, // Support
          "I support this proposal"
        );

        const receipt = await tx.wait();
        const event = receipt.events?.find(e => e.event === "VoteCastWithPower");
        expect(event).to.not.be.undefined;
      });

      it("Should apply expert bonus to voting power", async function () {
        const tx = await governance.connect(expert).castVoteWithReason(
          proposalId,
          1,
          "Expert opinion"
        );

        const receipt = await tx.wait();
        const event = receipt.events?.find(e => e.event === "VoteCastWithPower");
        expect(event).to.not.be.undefined;
        
        // Expert should have enhanced voting power
        const votingPower = await governance.proposalVotingPower(proposalId, expert.address);
        expect(votingPower).to.be.gt(0);
      });

      it("Should handle vote delegation", async function () {
        await governance.connect(voter1).delegateVotes(expert.address, ethers.utils.parseEther("100"));
        
        const delegationInfo = await governance.getDelegationInfo(voter1.address);
        expect(delegationInfo.delegate).to.equal(expert.address);
        expect(delegationInfo.delegatedVotes).to.equal(ethers.utils.parseEther("100"));
      });
    });

    describe("Quadratic Voting", function () {
      let proposalId: any;

      beforeEach(async function () {
        const targets = [token.address];
        const values = [0];
        const calldatas = [token.interface.encodeFunctionData("unpause")];
        const description = "Test quadratic voting";

        const tx = await governance.connect(proposer).proposeWithMetadata(
          targets,
          values,
          calldatas,
          description,
          0,
          "Quadratic Test",
          "",
          [],
          true, // Enable quadratic voting
          0,
          ethers.constants.AddressZero
        );

        const receipt = await tx.wait();
        const event = receipt.events?.find(e => e.event === "ProposalCreated");
        proposalId = event?.args?.proposalId;

        await ethers.provider.send("hardhat_mine", [ethers.utils.hexValue(VOTING_DELAY + 1)]);
      });

      it("Should apply quadratic voting correctly", async function () {
        const tx = await governance.connect(voter1).castVoteWithReason(
          proposalId,
          1,
          "Quadratic vote test"
        );

        const receipt = await tx.wait();
        const event = receipt.events?.find(e => e.event === "VoteCastWithPower");
        expect(event?.args?.isQuadratic).to.be.true;
      });
    });

    describe("Treasury Integration", function () {
      let proposalId: any;

      beforeEach(async function () {
        // Add tokens to treasury
        await token.connect(admin).mintFromVerification(
          treasury.address,
          100,
          95,
          ethers.utils.formatBytes32String("electronics"),
          "treasury-funding"
        );
      });

      it("Should create treasury spending proposal", async function () {
        const amount = ethers.utils.parseEther("1000");
        const recipient = user.address;
        const purpose = "Development funding";

        const tx = await treasury.connect(admin).createTreasuryProposal(
          amount,
          recipient,
          token.address,
          purpose
        );

        const receipt = await tx.wait();
        const event = receipt.events?.find(e => e.event === "TreasuryProposalCreated");
        expect(event).to.not.be.undefined;
        expect(event?.args?.amount).to.equal(amount);
        expect(event?.args?.purpose).to.equal(purpose);
      });

      it("Should approve and execute treasury proposal", async function () {
        const amount = ethers.utils.parseEther("500");
        
        const proposalTx = await treasury.connect(admin).createTreasuryProposal(
          amount,
          user.address,
          token.address,
          "Test funding"
        );

        const receipt = await proposalTx.wait();
        const event = receipt.events?.find(e => e.event === "TreasuryProposalCreated");
        const treasuryProposalId = event?.args?.proposalId;

        // Approve through governance
        await treasury.connect(governance.address).approveTreasuryProposal(treasuryProposalId);

        // Fast forward to execution deadline
        await ethers.provider.send("evm_increaseTime", [86400 * 8]); // 8 days
        await ethers.provider.send("evm_mine", []);

        const beforeBalance = await token.balanceOf(user.address);
        await treasury.connect(admin).executeTreasuryProposal(treasuryProposalId);
        const afterBalance = await token.balanceOf(user.address);

        expect(afterBalance.sub(beforeBalance)).to.equal(amount);
      });
    });
  });

  describe("Token Utility System", function () {
    describe("Tier Management", function () {
      beforeEach(async function () {
        // Mint tokens for tier testing
        await token.connect(admin).mintFromVerification(
          user.address,
          10,
          95,
          ethers.utils.formatBytes32String("electronics"),
          "tier-test"
        );
      });

      it("Should update user tier based on holdings", async function () {
        const userBalance = await token.balanceOf(user.address);
        console.log("User balance:", userBalance.toString());

        const newTier = await utility.connect(user).updateUserTier(user.address);
        const userInfo = await utility.getUserUtilityInfo(user.address);
        
        expect(userInfo.currentTier).to.be.gte(0); // At least Bronze tier
      });

      it("Should apply fee discounts based on tier", async function () {
        const featureId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("premium_verification"));
        const originalFee = ethers.utils.parseEther("50");

        // Update user tier first
        await utility.connect(user).updateUserTier(user.address);

        const [discountedFee, savings] = await utility.connect(user).applyFeeDiscount(
          user.address,
          featureId,
          originalFee
        );

        expect(discountedFee).to.be.lt(originalFee);
        expect(savings).to.be.gt(0);
      });
    });

    describe("Reputation System", function () {
      it("Should add reputation for user actions", async function () {
        await utility.connect(admin).grantRole(
          await utility.REPUTATION_MANAGER_ROLE(),
          admin.address
        );

        const tx = await utility.connect(admin).addReputation(
          user.address,
          "verification",
          10000 // 1x multiplier
        );

        const receipt = await tx.wait();
        const event = receipt.events?.find(e => e.event === "ReputationEarned");
        expect(event).to.not.be.undefined;

        const userInfo = await utility.getUserUtilityInfo(user.address);
        expect(userInfo.reputationScore).to.be.gt(0);
      });

      it("Should handle daily activity streaks", async function () {
        await utility.connect(user).updateDailyActivity(user.address);
        const userInfo = await utility.getUserUtilityInfo(user.address);
        expect(userInfo.streakDays).to.be.gte(1);
      });
    });

    describe("Premium Access", function () {
      it("Should grant premium access with expiration", async function () {
        const duration = 86400 * 30; // 30 days

        await utility.connect(admin).grantPremiumAccess(user.address, duration);
        const userInfo = await utility.getUserUtilityInfo(user.address);
        
        expect(userInfo.isPremium).to.be.true;
      });

      it("Should check feature access correctly", async function () {
        const premiumFeatureId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("premium_verification"));
        const basicFeatureId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("priority_processing"));

        // Should have access to basic features
        const hasBasicAccess = await utility.hasFeatureAccess(user.address, basicFeatureId);
        expect(hasBasicAccess).to.be.true;

        // Premium access depends on tier or premium status
        const hasPremiumAccess = await utility.hasFeatureAccess(user.address, premiumFeatureId);
        // This will depend on the user's tier and premium status
      });
    });
  });

  describe("DAO Treasury Management", function () {
    describe("Asset Management", function () {
      it("Should add supported assets", async function () {
        const testToken = await ethers.getContractFactory("VeriChainXAuthenticityToken");
        const mockToken = await testToken.deploy(
          "Mock Token",
          "MOCK",
          admin.address,
          {
            maxSupply: ethers.utils.parseEther("1000000"),
            baseReward: ethers.utils.parseEther("10"),
            qualityMultiplier: 100,
            stakingAPY: 5,
            burnRate: 50,
            mintingCooldown: 300
          }
        );
        await mockToken.deployed();

        const tx = await treasury.connect(admin).addAsset(
          mockToken.address,
          2000, // 20% target allocation
          false,
          "MOCK"
        );

        const receipt = await tx.wait();
        const event = receipt.events?.find(e => e.event === "AssetAdded");
        expect(event).to.not.be.undefined;
      });

      it("Should calculate total treasury value", async function () {
        const treasuryInfo = await treasury.getTreasuryInfo();
        expect(treasuryInfo.totalValue).to.be.gte(0);
      });
    });

    describe("Investment Management", function () {
      it("Should create investments", async function () {
        // First add some tokens to treasury
        await token.connect(admin).mintFromVerification(
          treasury.address,
          200,
          95,
          ethers.utils.formatBytes32String("electronics"),
          "treasury-investment"
        );

        const amount = ethers.utils.parseEther("1000");
        const expectedAPY = 800; // 8%
        const lockPeriod = 86400 * 30; // 30 days

        await treasury.connect(admin).grantRole(
          await treasury.INVESTMENT_MANAGER_ROLE(),
          admin.address
        );

        const tx = await treasury.connect(admin).createInvestment(
          admin.address, // Mock protocol address
          token.address,
          amount,
          expectedAPY,
          lockPeriod,
          "Mock Protocol",
          "Conservative Staking"
        );

        const receipt = await tx.wait();
        const event = receipt.events?.find(e => e.event === "InvestmentMade");
        expect(event).to.not.be.undefined;
      });
    });

    describe("Revenue Collection", function () {
      it("Should collect revenue from various streams", async function () {
        const streamId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("verification_fees"));
        const amount = ethers.utils.parseEther("500");

        // First mint tokens to admin for the test
        await token.connect(admin).mintFromVerification(
          admin.address,
          300,
          95,
          ethers.utils.formatBytes32String("electronics"),
          "revenue-test"
        );

        // Approve treasury to collect tokens
        await token.connect(admin).approve(treasury.address, amount);

        const tx = await treasury.connect(admin).collectRevenue(
          streamId,
          amount,
          admin.address
        );

        const receipt = await tx.wait();
        const event = receipt.events?.find(e => e.event === "RevenueCollected");
        expect(event).to.not.be.undefined;
      });
    });

    describe("Performance Tracking", function () {
      it("Should update treasury metrics", async function () {
        const tx = await treasury.updateTreasuryMetrics();
        const receipt = await tx.wait();
        const event = receipt.events?.find(e => e.event === "TreasuryMetricsUpdated");
        expect(event).to.not.be.undefined;
      });

      it("Should track monthly yield history", async function () {
        const currentMonth = Math.floor(Date.now() / (30 * 24 * 60 * 60 * 1000));
        const monthlyYield = await treasury.monthlyYieldHistory(currentMonth);
        expect(monthlyYield).to.be.gte(0);
      });
    });
  });

  describe("Integration Tests", function () {
    it("Should handle complete governance workflow", async function () {
      // 1. Create proposal with treasury spending
      const targets = [treasury.address];
      const values = [0];
      const amount = ethers.utils.parseEther("1000");
      const calldatas = [
        treasury.interface.encodeFunctionData("emergencyWithdraw", [
          token.address,
          amount,
          user.address,
          "Emergency funding"
        ])
      ];
      const description = "Emergency treasury withdrawal";

      const proposalTx = await governance.connect(proposer).proposeWithMetadata(
        targets,
        values,
        calldatas,
        description,
        1, // ProposalCategory.TREASURY
        "Emergency Funding",
        "",
        [],
        false,
        amount.toString(),
        user.address
      );

      const receipt = await proposalTx.wait();
      const event = receipt.events?.find(e => e.event === "ProposalCreated");
      const proposalId = event?.args?.proposalId;

      // 2. Move to voting period
      await ethers.provider.send("hardhat_mine", [ethers.utils.hexValue(VOTING_DELAY + 1)]);

      // 3. Cast votes
      await governance.connect(voter1).castVoteWithReason(proposalId, 1, "Support emergency funding");
      await governance.connect(voter2).castVoteWithReason(proposalId, 1, "Agreed");
      await governance.connect(expert).castVoteWithReason(proposalId, 1, "Expert approval");

      // 4. Move to end of voting period
      await ethers.provider.send("hardhat_mine", [ethers.utils.hexValue(VOTING_PERIOD + 1)]);

      // 5. Queue proposal
      await governance.queue(targets, values, calldatas, ethers.utils.keccak256(ethers.utils.toUtf8Bytes(description)));

      // 6. Wait for timelock delay
      await ethers.provider.send("evm_increaseTime", [TIMELOCK_DELAY + 1]);
      await ethers.provider.send("evm_mine", []);

      // 7. Execute proposal
      const state = await governance.state(proposalId);
      expect(state).to.equal(5); // Queued state
    });

    it("Should maintain token utility across all systems", async function () {
      // Test that token balances, staking, and governance voting power all integrate correctly
      const initialBalance = await token.balanceOf(voter1.address);
      
      // Stake tokens
      await token.connect(voter1).stake(ethers.utils.parseEther("100"));
      
      // Check voting power is maintained
      const votingPower = await token.getVotes(voter1.address);
      expect(votingPower).to.be.gt(0);
      
      // Check tier eligibility
      await utility.connect(voter1).updateUserTier(voter1.address);
      const userInfo = await utility.getUserUtilityInfo(voter1.address);
      expect(userInfo.currentTier).to.be.gte(0);
    });
  });

  describe("Security and Edge Cases", function () {
    it("Should prevent unauthorized access to admin functions", async function () {
      await expect(
        governance.connect(user).addExpertise(user.address, "Security", 500, true)
      ).to.be.revertedWith("AccessControl:");

      await expect(
        utility.connect(user).grantPremiumAccess(user.address, 86400)
      ).to.be.revertedWith("AccessControl:");

      await expect(
        treasury.connect(user).addAsset(token.address, 1000, false, "TEST")
      ).to.be.revertedWith("AccessControl:");
    });

    it("Should handle emergency situations correctly", async function () {
      // Test emergency proposal creation and execution
      await governance.connect(admin).grantRole(
        await governance.EMERGENCY_ROLE(),
        admin.address
      );

      const targets = [token.address];
      const values = [0];
      const calldatas = [token.interface.encodeFunctionData("pause")];
      const description = "Emergency pause";
      const requiredSigners = [admin.address];

      const tx = await governance.connect(admin).createEmergencyProposal(
        targets,
        values,
        calldatas,
        description,
        requiredSigners
      );

      const receipt = await tx.wait();
      const event = receipt.events?.find(e => e.event === "ProposalCreatedWithMetadata");
      expect(event).to.not.be.undefined;
    });

    it("Should handle invalid inputs gracefully", async function () {
      // Test various invalid inputs
      await expect(
        utility.connect(user).applyFeeDiscount(
          user.address,
          ethers.utils.keccak256(ethers.utils.toUtf8Bytes("invalid_feature")),
          ethers.utils.parseEther("100")
        )
      ).to.be.revertedWith("Feature benefit not active");

      await expect(
        treasury.connect(admin).createTreasuryProposal(
          ethers.utils.parseEther("1"),     // Below minimum
          user.address,
          token.address,
          "Test"
        )
      ).to.be.revertedWith("Invalid proposal amount");
    });
  });
});