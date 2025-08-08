// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./AMM/VeriChainXAuthenticityToken.sol";

/**
 * @title VeriChainXTokenUtility
 * @dev Advanced token utility system with tiered access, fee discounts, reputation, and benefits
 * Integrates with the authenticity token to provide enhanced platform features
 */
contract VeriChainXTokenUtility is AccessControl, ReentrancyGuard, Pausable {
    using Math for uint256;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant UTILITY_MANAGER_ROLE = keccak256("UTILITY_MANAGER_ROLE");
    bytes32 public constant REPUTATION_MANAGER_ROLE = keccak256("REPUTATION_MANAGER_ROLE");

    VeriChainXAuthenticityToken public immutable veriToken;

    // Tier system configuration
    enum TierLevel {
        BRONZE,     // 0
        SILVER,     // 1
        GOLD,       // 2
        PLATINUM,   // 3
        DIAMOND,    // 4
        ELITE       // 5
    }

    struct TierConfig {
        uint256 requiredTokens;        // Minimum tokens required
        uint256 requiredStaked;        // Minimum staked tokens
        uint256 requiredReputation;    // Minimum reputation score
        uint256 feeDiscountBps;        // Fee discount in basis points (10000 = 100%)
        uint256 rewardMultiplier;      // Reward multiplier (10000 = 1x)
        uint256 votingPowerBonus;      // Voting power bonus (10000 = 1x)
        uint256 maxVerificationsPerDay; // Daily verification limit
        uint256 priorityProcessing;     // Priority processing level
        bool premiumFeatures;          // Access to premium features
        bool earlyAccess;              // Early access to new features
        string tierName;
    }

    struct UserUtilityData {
        TierLevel currentTier;
        uint256 totalFeesReduced;
        uint256 reputationScore;
        uint256 verificationCount;
        uint256 lastVerificationTime;
        uint256 dailyVerificationCount;
        uint256 streakDays;
        uint256 lastActivityTime;
        mapping(bytes32 => uint256) featureBenefits;
        mapping(string => uint256) specialAccess;
        bool isPremiumUser;
        bool hasEarlyAccess;
    }

    struct ReputationAction {
        string actionType;          // "verification", "report", "stake", "vote"
        uint256 basePoints;         // Base reputation points
        uint256 multiplier;         // Tier-based multiplier
        uint256 cooldownPeriod;     // Minimum time between actions
        bool active;
    }

    struct FeeBenefit {
        bytes32 featureId;          // Feature identifier
        uint256 baseFee;            // Base fee in wei or tokens
        uint256 tierDiscountBps;    // Tier-based discount
        bool isPremiumFeature;      // Requires premium access
        bool isActive;
    }

    struct LoyaltyProgram {
        uint256 streakBonus;        // Bonus per consecutive day
        uint256 volumeBonus;        // Bonus based on volume
        uint256 referralBonus;      // Referral rewards
        mapping(address => address) referrals; // User referrals
        mapping(address => uint256) referralCounts; // Referral counts
        mapping(address => uint256) referralRewards; // Accumulated referral rewards
    }

    // Core mappings
    mapping(TierLevel => TierConfig) public tierConfigs;
    mapping(address => UserUtilityData) public userData;
    mapping(string => ReputationAction) public reputationActions;
    mapping(bytes32 => FeeBenefit) public feeBenefits;
    mapping(address => uint256) public lastTierUpdate;

    // Loyalty program
    LoyaltyProgram public loyaltyProgram;

    // Feature access controls
    mapping(bytes32 => mapping(TierLevel => bool)) public tierFeatureAccess;
    mapping(address => mapping(bytes32 => uint256)) public userFeatureUsage;
    mapping(bytes32 => uint256) public featureUsageLimits;

    // Special programs
    mapping(address => bool) public whitelistedUsers;
    mapping(address => uint256) public premiumExpirationTime;
    mapping(address => string[]) public userBadges;

    // Statistics
    uint256 public totalUtilityUsers;
    uint256 public totalFeesReduced;
    uint256 public totalReputationDistributed;
    mapping(TierLevel => uint256) public tierUserCounts;

    event TierUpdated(
        address indexed user,
        TierLevel oldTier,
        TierLevel newTier,
        uint256 timestamp
    );

    event ReputationEarned(
        address indexed user,
        string actionType,
        uint256 points,
        uint256 newTotal
    );

    event FeeBenefitUsed(
        address indexed user,
        bytes32 indexed featureId,
        uint256 originalFee,
        uint256 discountedFee,
        uint256 savings
    );

    event PremiumAccessGranted(
        address indexed user,
        uint256 duration,
        uint256 expiresAt
    );

    event StreakMilestone(
        address indexed user,
        uint256 streakDays,
        uint256 bonusReward
    );

    event ReferralReward(
        address indexed referrer,
        address indexed referee,
        uint256 reward
    );

    modifier onlyValidUser() {
        require(veriToken.balanceOf(msg.sender) > 0, "Must hold VeriChain tokens");
        _;
    }

    modifier onlyTier(TierLevel minTier) {
        require(userData[msg.sender].currentTier >= minTier, "Insufficient tier level");
        _;
    }

    modifier featureAccess(bytes32 featureId) {
        require(hasFeatureAccess(msg.sender, featureId), "Feature access denied");
        _;
    }

    constructor(
        address _veriToken,
        address _admin
    ) {
        veriToken = VeriChainXAuthenticityToken(_veriToken);
        
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
        _grantRole(UTILITY_MANAGER_ROLE, _admin);
        _grantRole(REPUTATION_MANAGER_ROLE, _admin);

        _initializeTierConfigs();
        _initializeReputationActions();
        _initializeFeeBenefits();
        _initializeLoyaltyProgram();
    }

    /**
     * @dev Initialize tier configurations
     */
    function _initializeTierConfigs() internal {
        // BRONZE - Entry level
        tierConfigs[TierLevel.BRONZE] = TierConfig({
            requiredTokens: 100 * 10**18,      // 100 tokens
            requiredStaked: 0,
            requiredReputation: 0,
            feeDiscountBps: 500,               // 5% discount
            rewardMultiplier: 10000,           // 1x multiplier
            votingPowerBonus: 10000,           // 1x voting power
            maxVerificationsPerDay: 10,
            priorityProcessing: 1,
            premiumFeatures: false,
            earlyAccess: false,
            tierName: "Bronze"
        });

        // SILVER - Active users
        tierConfigs[TierLevel.SILVER] = TierConfig({
            requiredTokens: 1000 * 10**18,     // 1,000 tokens
            requiredStaked: 500 * 10**18,      // 500 staked
            requiredReputation: 1000,
            feeDiscountBps: 1000,              // 10% discount
            rewardMultiplier: 11000,           // 1.1x multiplier
            votingPowerBonus: 10500,           // 1.05x voting power
            maxVerificationsPerDay: 25,
            priorityProcessing: 2,
            premiumFeatures: false,
            earlyAccess: false,
            tierName: "Silver"
        });

        // GOLD - Committed users
        tierConfigs[TierLevel.GOLD] = TierConfig({
            requiredTokens: 5000 * 10**18,     // 5,000 tokens
            requiredStaked: 2500 * 10**18,     // 2,500 staked
            requiredReputation: 5000,
            feeDiscountBps: 1500,              // 15% discount
            rewardMultiplier: 12500,           // 1.25x multiplier
            votingPowerBonus: 11000,           // 1.1x voting power
            maxVerificationsPerDay: 50,
            priorityProcessing: 3,
            premiumFeatures: true,
            earlyAccess: false,
            tierName: "Gold"
        });

        // PLATINUM - Premium users
        tierConfigs[TierLevel.PLATINUM] = TierConfig({
            requiredTokens: 20000 * 10**18,    // 20,000 tokens
            requiredStaked: 10000 * 10**18,    // 10,000 staked
            requiredReputation: 15000,
            feeDiscountBps: 2000,              // 20% discount
            rewardMultiplier: 15000,           // 1.5x multiplier
            votingPowerBonus: 12000,           // 1.2x voting power
            maxVerificationsPerDay: 100,
            priorityProcessing: 4,
            premiumFeatures: true,
            earlyAccess: true,
            tierName: "Platinum"
        });

        // DIAMOND - Elite users
        tierConfigs[TierLevel.DIAMOND] = TierConfig({
            requiredTokens: 50000 * 10**18,    // 50,000 tokens
            requiredStaked: 25000 * 10**18,    // 25,000 staked
            requiredReputation: 30000,
            feeDiscountBps: 2500,              // 25% discount
            rewardMultiplier: 18000,           // 1.8x multiplier
            votingPowerBonus: 15000,           // 1.5x voting power
            maxVerificationsPerDay: 200,
            priorityProcessing: 5,
            premiumFeatures: true,
            earlyAccess: true,
            tierName: "Diamond"
        });

        // ELITE - Highest tier
        tierConfigs[TierLevel.ELITE] = TierConfig({
            requiredTokens: 100000 * 10**18,   // 100,000 tokens
            requiredStaked: 50000 * 10**18,    // 50,000 staked
            requiredReputation: 50000,
            feeDiscountBps: 3000,              // 30% discount
            rewardMultiplier: 20000,           // 2x multiplier
            votingPowerBonus: 20000,           // 2x voting power
            maxVerificationsPerDay: 500,
            priorityProcessing: 10,
            premiumFeatures: true,
            earlyAccess: true,
            tierName: "Elite"
        });
    }

    /**
     * @dev Initialize reputation action configurations
     */
    function _initializeReputationActions() internal {
        reputationActions["verification"] = ReputationAction({
            actionType: "verification",
            basePoints: 10,
            multiplier: 10000,
            cooldownPeriod: 300, // 5 minutes
            active: true
        });

        reputationActions["quality_report"] = ReputationAction({
            actionType: "quality_report",
            basePoints: 50,
            multiplier: 10000,
            cooldownPeriod: 3600, // 1 hour
            active: true
        });

        reputationActions["staking"] = ReputationAction({
            actionType: "staking",
            basePoints: 25,
            multiplier: 10000,
            cooldownPeriod: 86400, // 1 day
            active: true
        });

        reputationActions["governance_vote"] = ReputationAction({
            actionType: "governance_vote",
            basePoints: 15,
            multiplier: 10000,
            cooldownPeriod: 7200, // 2 hours
            active: true
        });
    }

    /**
     * @dev Initialize fee benefits for different features
     */
    function _initializeFeeBenefits() internal {
        feeBenefits[keccak256("premium_verification")] = FeeBenefit({
            featureId: keccak256("premium_verification"),
            baseFee: 50 * 10**18, // 50 tokens
            tierDiscountBps: 2000, // 20% base discount
            isPremiumFeature: true,
            isActive: true
        });

        feeBenefits[keccak256("priority_processing")] = FeeBenefit({
            featureId: keccak256("priority_processing"),
            baseFee: 25 * 10**18, // 25 tokens
            tierDiscountBps: 1500, // 15% base discount
            isPremiumFeature: false,
            isActive: true
        });

        feeBenefits[keccak256("advanced_analytics")] = FeeBenefit({
            featureId: keccak256("advanced_analytics"),
            baseFee: 100 * 10**18, // 100 tokens
            tierDiscountBps: 2500, // 25% base discount
            isPremiumFeature: true,
            isActive: true
        });
    }

    /**
     * @dev Initialize loyalty program
     */
    function _initializeLoyaltyProgram() internal {
        loyaltyProgram.streakBonus = 5; // 5 reputation points per day
        loyaltyProgram.volumeBonus = 100; // 100 reputation per 1000 tokens in volume
        loyaltyProgram.referralBonus = 1000; // 1000 reputation for referral
    }

    /**
     * @dev Update user tier based on current holdings and reputation
     */
    function updateUserTier(address user) public returns (TierLevel newTier) {
        uint256 userBalance = veriToken.balanceOf(user);
        uint256 userStaked = veriToken.stakedBalances(user);
        uint256 userReputation = userData[user].reputationScore;

        TierLevel currentTier = userData[user].currentTier;
        newTier = currentTier;

        // Check tier upgrades from highest to lowest
        for (uint256 i = uint256(TierLevel.ELITE); i > uint256(currentTier); i--) {
            TierLevel tier = TierLevel(i);
            TierConfig memory config = tierConfigs[tier];
            
            if (userBalance >= config.requiredTokens && 
                userStaked >= config.requiredStaked && 
                userReputation >= config.requiredReputation) {
                newTier = tier;
                break;
            }
        }

        // Check for downgrades
        if (newTier == currentTier) {
            TierConfig memory currentConfig = tierConfigs[currentTier];
            if (userBalance < currentConfig.requiredTokens || 
                userStaked < currentConfig.requiredStaked || 
                userReputation < currentConfig.requiredReputation) {
                
                // Find appropriate lower tier
                for (uint256 i = uint256(currentTier); i >= 0; i--) {
                    TierLevel tier = TierLevel(i);
                    TierConfig memory config = tierConfigs[tier];
                    
                    if (userBalance >= config.requiredTokens && 
                        userStaked >= config.requiredStaked && 
                        userReputation >= config.requiredReputation) {
                        newTier = tier;
                        break;
                    }
                    
                    if (i == 0) break; // Prevent underflow
                }
            }
        }

        // Update tier if changed
        if (newTier != currentTier) {
            tierUserCounts[currentTier]--;
            tierUserCounts[newTier]++;
            
            userData[user].currentTier = newTier;
            lastTierUpdate[user] = block.timestamp;
            
            // Grant tier benefits
            _grantTierBenefits(user, newTier);
            
            emit TierUpdated(user, currentTier, newTier, block.timestamp);
        }

        return newTier;
    }

    /**
     * @dev Add reputation points for user actions
     */
    function addReputation(
        address user,
        string memory actionType,
        uint256 additionalMultiplier
    ) external onlyRole(REPUTATION_MANAGER_ROLE) {
        ReputationAction memory action = reputationActions[actionType];
        require(action.active, "Action type not active");
        
        // Check cooldown
        string memory cooldownKey = string(abi.encodePacked(actionType, "_last"));
        require(
            userData[user].specialAccess[cooldownKey] + action.cooldownPeriod <= block.timestamp,
            "Action cooldown not met"
        );

        // Calculate reputation points
        uint256 basePoints = action.basePoints;
        uint256 tierMultiplier = tierConfigs[userData[user].currentTier].rewardMultiplier;
        uint256 totalMultiplier = (tierMultiplier * additionalMultiplier) / 10000;
        uint256 points = (basePoints * totalMultiplier) / 10000;

        // Apply streak bonus
        if (userData[user].streakDays > 0) {
            points += (points * userData[user].streakDays * loyaltyProgram.streakBonus) / 1000;
        }

        // Update reputation
        userData[user].reputationScore += points;
        userData[user].specialAccess[cooldownKey] = block.timestamp;
        totalReputationDistributed += points;

        // Check for tier update
        updateUserTier(user);

        emit ReputationEarned(user, actionType, points, userData[user].reputationScore);
    }

    /**
     * @dev Apply fee discount for feature usage
     */
    function applyFeeDiscount(
        address user,
        bytes32 featureId,
        uint256 originalFee
    ) external featureAccess(featureId) returns (uint256 discountedFee, uint256 savings) {
        FeeBenefit memory benefit = feeBenefits[featureId];
        require(benefit.isActive, "Feature benefit not active");

        TierConfig memory tierConfig = tierConfigs[userData[user].currentTier];
        
        // Calculate discount
        uint256 tierDiscountBps = tierConfig.feeDiscountBps;
        uint256 totalDiscountBps = Math.min(tierDiscountBps + benefit.tierDiscountBps, 5000); // Max 50% discount
        
        savings = (originalFee * totalDiscountBps) / 10000;
        discountedFee = originalFee - savings;

        // Track savings
        userData[user].totalFeesReduced += savings;
        totalFeesReduced += savings;

        // Update feature usage
        userFeatureUsage[user][featureId]++;

        emit FeeBenefitUsed(user, featureId, originalFee, discountedFee, savings);
    }

    /**
     * @dev Grant premium access for duration
     */
    function grantPremiumAccess(
        address user,
        uint256 duration
    ) external onlyRole(UTILITY_MANAGER_ROLE) {
        userData[user].isPremiumUser = true;
        premiumExpirationTime[user] = block.timestamp + duration;
        
        emit PremiumAccessGranted(user, duration, premiumExpirationTime[user]);
    }

    /**
     * @dev Update daily activity and streak
     */
    function updateDailyActivity(address user) external onlyValidUser {
        UserUtilityData storage data = userData[user];
        
        uint256 today = block.timestamp / 86400; // Days since epoch
        uint256 lastActive = data.lastActivityTime / 86400;
        
        if (today > lastActive) {
            if (today == lastActive + 1) {
                // Consecutive day - increase streak
                data.streakDays++;
                
                // Streak milestone rewards
                if (data.streakDays % 7 == 0) { // Weekly milestone
                    uint256 bonus = data.streakDays * loyaltyProgram.streakBonus;
                    data.reputationScore += bonus;
                    emit StreakMilestone(user, data.streakDays, bonus);
                }
            } else {
                // Streak broken
                data.streakDays = 1;
            }
            
            data.lastActivityTime = block.timestamp;
            data.dailyVerificationCount = 0; // Reset daily count
        }
    }

    /**
     * @dev Process referral rewards
     */
    function processReferral(address referee) external onlyValidUser {
        address referrer = loyaltyProgram.referrals[referee];
        require(referrer != address(0), "No referrer found");
        
        // Reward referrer
        userData[referrer].reputationScore += loyaltyProgram.referralBonus;
        loyaltyProgram.referralRewards[referrer] += loyaltyProgram.referralBonus;
        loyaltyProgram.referralCounts[referrer]++;
        
        emit ReferralReward(referrer, referee, loyaltyProgram.referralBonus);
    }

    /**
     * @dev Set referral relationship
     */
    function setReferral(address referee, address referrer) external onlyRole(UTILITY_MANAGER_ROLE) {
        require(referee != referrer, "Cannot refer self");
        require(loyaltyProgram.referrals[referee] == address(0), "Already has referrer");
        
        loyaltyProgram.referrals[referee] = referrer;
    }

    /**
     * @dev Grant tier benefits to user
     */
    function _grantTierBenefits(address user, TierLevel tier) internal {
        TierConfig memory config = tierConfigs[tier];
        
        // Grant premium access if applicable
        if (config.premiumFeatures && !userData[user].isPremiumUser) {
            userData[user].isPremiumUser = true;
        }
        
        // Grant early access
        if (config.earlyAccess) {
            userData[user].hasEarlyAccess = true;
        }
    }

    /**
     * @dev Check if user has access to specific feature
     */
    function hasFeatureAccess(address user, bytes32 featureId) public view returns (bool) {
        FeeBenefit memory benefit = feeBenefits[featureId];
        
        if (!benefit.isActive) return false;
        if (whitelistedUsers[user]) return true;
        
        if (benefit.isPremiumFeature) {
            return userData[user].isPremiumUser || 
                   premiumExpirationTime[user] > block.timestamp ||
                   tierConfigs[userData[user].currentTier].premiumFeatures;
        }
        
        return true;
    }

    /**
     * @dev Get comprehensive user utility information
     */
    function getUserUtilityInfo(address user) external view returns (
        TierLevel currentTier,
        uint256 reputationScore,
        uint256 totalFeesReduced,
        uint256 streakDays,
        bool isPremium,
        bool hasEarlyAccess,
        uint256 dailyVerificationsUsed,
        uint256 maxDailyVerifications
    ) {
        UserUtilityData storage data = userData[user];
        TierConfig memory config = tierConfigs[data.currentTier];
        
        currentTier = data.currentTier;
        reputationScore = data.reputationScore;
        totalFeesReduced = data.totalFeesReduced;
        streakDays = data.streakDays;
        isPremium = data.isPremiumUser || premiumExpirationTime[user] > block.timestamp;
        hasEarlyAccess = data.hasEarlyAccess;
        dailyVerificationsUsed = data.dailyVerificationCount;
        maxDailyVerifications = config.maxVerificationsPerDay;
    }

    /**
     * @dev Get tier configuration
     */
    function getTierConfig(TierLevel tier) external view returns (TierConfig memory) {
        return tierConfigs[tier];
    }

    /**
     * @dev Get fee benefit information
     */
    function getFeeBenefit(bytes32 featureId) external view returns (FeeBenefit memory) {
        return feeBenefits[featureId];
    }

    /**
     * @dev Update tier configuration
     */
    function updateTierConfig(
        TierLevel tier,
        TierConfig memory newConfig
    ) external onlyRole(UTILITY_MANAGER_ROLE) {
        tierConfigs[tier] = newConfig;
    }

    /**
     * @dev Add new fee benefit
     */
    function addFeeBenefit(
        bytes32 featureId,
        FeeBenefit memory benefit
    ) external onlyRole(UTILITY_MANAGER_ROLE) {
        feeBenefits[featureId] = benefit;
    }

    /**
     * @dev Emergency pause
     */
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @dev Add user to whitelist
     */
    function addToWhitelist(address user) external onlyRole(ADMIN_ROLE) {
        whitelistedUsers[user] = true;
    }

    function removeFromWhitelist(address user) external onlyRole(ADMIN_ROLE) {
        whitelistedUsers[user] = false;
    }
}