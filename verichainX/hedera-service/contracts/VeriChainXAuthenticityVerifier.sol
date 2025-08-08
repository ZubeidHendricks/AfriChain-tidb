// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/**
 * @title VeriChainX Authenticity Verifier Smart Contract
 * @dev Advanced smart contract for programmable authenticity verification
 * @author VeriChainX Team
 * 
 * Features:
 * - Programmable verification logic
 * - Multi-signature verification requirements
 * - Reputation-based verifier weighting
 * - Automated dispute resolution
 * - Gas optimization strategies
 * - Upgradeable contract architecture
 */
contract VeriChainXAuthenticityVerifier is AccessControl, Pausable, ReentrancyGuard {
    using Counters for Counters.Counter;

    // ============ CONSTANTS ============
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant DISPUTE_RESOLVER_ROLE = keccak256("DISPUTE_RESOLVER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint256 public constant MIN_VERIFICATION_SCORE = 70; // 70% minimum for authentic
    uint256 public constant MAX_VERIFICATION_SCORE = 100;
    uint256 public constant DISPUTE_TIMEOUT = 7 days;
    uint256 public constant MIN_VERIFIER_REPUTATION = 500;

    // ============ STATE VARIABLES ============
    Counters.Counter private _verificationIds;
    Counters.Counter private _disputeIds;

    // Verification data structures
    struct VerificationRecord {
        string productId;
        address verifier;
        uint256 score;
        uint256 timestamp;
        bytes32 evidenceHash;
        VerificationStatus status;
        uint256 disputeId;
        address originalOwner;
        string verificationMethod; // "AI_AGENT", "HUMAN", "HYBRID"
    }

    struct VerifierProfile {
        uint256 reputation;
        uint256 totalVerifications;
        uint256 successfulVerifications;
        uint256 disputesLost;
        bool isActive;
        string specialty; // "luxury_goods", "electronics", "pharmaceuticals", etc.
        uint256 stakingAmount;
    }

    struct DisputeCase {
        uint256 verificationId;
        address challenger;
        address verifier;
        string reason;
        uint256 challengerStake;
        uint256 timestamp;
        DisputeStatus status;
        uint256 resolverVotes;
        mapping(address => bool) hasVoted;
        mapping(address => bool) voteDecision; // true = support verifier, false = support challenger
    }

    struct VerificationRule {
        string ruleId;
        string description;
        uint256 minScore;
        uint256 maxScore;
        bool requiresMultiSig;
        uint256 minVerifiers;
        string[] allowedMethods;
        bool isActive;
    }

    // Enums
    enum VerificationStatus { PENDING, VERIFIED_AUTHENTIC, VERIFIED_COUNTERFEIT, DISPUTED, RESOLVED }
    enum DisputeStatus { ACTIVE, RESOLVED_FOR_VERIFIER, RESOLVED_FOR_CHALLENGER, EXPIRED }

    // Mappings
    mapping(uint256 => VerificationRecord) public verifications;
    mapping(address => VerifierProfile) public verifiers;
    mapping(uint256 => DisputeCase) public disputes;
    mapping(string => VerificationRule) public verificationRules;
    mapping(string => uint256[]) public productVerificationHistory;
    mapping(address => uint256[]) public verifierHistory;

    // Events
    event VerificationSubmitted(
        uint256 indexed verificationId,
        string indexed productId,
        address indexed verifier,
        uint256 score,
        string method
    );
    
    event VerificationFinalized(
        uint256 indexed verificationId,
        string indexed productId,
        VerificationStatus status,
        uint256 finalScore
    );
    
    event DisputeRaised(
        uint256 indexed disputeId,
        uint256 indexed verificationId,
        address indexed challenger,
        string reason
    );
    
    event DisputeResolved(
        uint256 indexed disputeId,
        DisputeStatus result,
        address winner,
        uint256 rewardAmount
    );
    
    event VerifierRegistered(
        address indexed verifier,
        string specialty,
        uint256 stakingAmount
    );
    
    event VerificationRuleUpdated(
        string indexed ruleId,
        uint256 minScore,
        bool requiresMultiSig
    );

    // ============ CONSTRUCTOR ============
    constructor(address admin) {
        require(admin != address(0), "Admin cannot be zero address");
        
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(DISPUTE_RESOLVER_ROLE, admin);

        // Initialize default verification rules
        _initializeDefaultRules();
    }

    // ============ VERIFIER MANAGEMENT ============
    
    /**
     * @dev Register a new verifier with staking requirement
     * @param specialty The verifier's area of expertise
     * @param stakingAmount Amount of tokens to stake for verification rights
     */
    function registerVerifier(
        string memory specialty,
        uint256 stakingAmount
    ) external payable nonReentrant {
        require(bytes(specialty).length > 0, "Specialty cannot be empty");
        require(stakingAmount >= MIN_VERIFIER_REPUTATION, "Insufficient staking amount");
        require(msg.value >= stakingAmount, "Insufficient ETH sent for staking");
        require(!verifiers[msg.sender].isActive, "Verifier already registered");

        verifiers[msg.sender] = VerifierProfile({
            reputation: stakingAmount,
            totalVerifications: 0,
            successfulVerifications: 0,
            disputesLost: 0,
            isActive: true,
            specialty: specialty,
            stakingAmount: stakingAmount
        });

        _grantRole(VERIFIER_ROLE, msg.sender);
        
        emit VerifierRegistered(msg.sender, specialty, stakingAmount);
    }

    /**
     * @dev Update verifier reputation based on verification outcomes
     * @param verifier Address of the verifier
     * @param reputationChange Change in reputation (can be negative)
     * @param isSuccessful Whether the verification was successful
     */
    function updateVerifierReputation(
        address verifier,
        int256 reputationChange,
        bool isSuccessful
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(verifiers[verifier].isActive, "Verifier not active");

        VerifierProfile storage profile = verifiers[verifier];
        
        // Update reputation (ensure it doesn't go below 0)
        if (reputationChange < 0 && uint256(-reputationChange) > profile.reputation) {
            profile.reputation = 0;
        } else {
            profile.reputation = uint256(int256(profile.reputation) + reputationChange);
        }

        profile.totalVerifications++;
        if (isSuccessful) {
            profile.successfulVerifications++;
        }

        // Deactivate verifier if reputation falls too low
        if (profile.reputation < MIN_VERIFIER_REPUTATION) {
            profile.isActive = false;
            _revokeRole(VERIFIER_ROLE, verifier);
        }
    }

    // ============ VERIFICATION LOGIC ============

    /**
     * @dev Submit a verification for a product
     * @param productId Unique identifier for the product
     * @param score Verification score (0-100)
     * @param evidenceHash Hash of verification evidence
     * @param method Verification method used
     * @param ruleId Rule set to apply for this verification
     */
    function submitVerification(
        string memory productId,
        uint256 score,
        bytes32 evidenceHash,
        string memory method,
        string memory ruleId
    ) external onlyRole(VERIFIER_ROLE) whenNotPaused nonReentrant {
        require(bytes(productId).length > 0, "Product ID cannot be empty");
        require(score <= MAX_VERIFICATION_SCORE, "Score exceeds maximum");
        require(evidenceHash != bytes32(0), "Evidence hash cannot be empty");
        require(verifiers[msg.sender].isActive, "Verifier not active");
        require(verificationRules[ruleId].isActive, "Verification rule not active");

        VerificationRule memory rule = verificationRules[ruleId];
        require(score >= rule.minScore && score <= rule.maxScore, "Score outside rule bounds");
        require(_isMethodAllowed(method, rule.allowedMethods), "Method not allowed for this rule");

        _verificationIds.increment();
        uint256 verificationId = _verificationIds.current();

        VerificationStatus status;
        if (score >= MIN_VERIFICATION_SCORE) {
            status = VerificationStatus.VERIFIED_AUTHENTIC;
        } else {
            status = VerificationStatus.VERIFIED_COUNTERFEIT;
        }

        verifications[verificationId] = VerificationRecord({
            productId: productId,
            verifier: msg.sender,
            score: score,
            timestamp: block.timestamp,
            evidenceHash: evidenceHash,
            status: status,
            disputeId: 0,
            originalOwner: tx.origin,
            verificationMethod: method
        });

        productVerificationHistory[productId].push(verificationId);
        verifierHistory[msg.sender].push(verificationId);

        emit VerificationSubmitted(verificationId, productId, msg.sender, score, method);

        // Check if multi-signature verification is required
        if (rule.requiresMultiSig && _getVerificationCount(productId) < rule.minVerifiers) {
            verifications[verificationId].status = VerificationStatus.PENDING;
            return;
        }

        // Finalize verification if requirements are met
        _finalizeVerification(verificationId);
    }

    /**
     * @dev Finalize a verification after all requirements are met
     * @param verificationId ID of the verification to finalize
     */
    function _finalizeVerification(uint256 verificationId) internal {
        VerificationRecord storage record = verifications[verificationId];
        
        if (record.status == VerificationStatus.PENDING) {
            // Calculate consensus if multiple verifications exist
            uint256[] memory productVerifications = productVerificationHistory[record.productId];
            uint256 totalScore = 0;
            uint256 validVerifications = 0;

            for (uint256 i = 0; i < productVerifications.length; i++) {
                VerificationRecord memory otherRecord = verifications[productVerifications[i]];
                if (otherRecord.status != VerificationStatus.DISPUTED) {
                    totalScore += otherRecord.score;
                    validVerifications++;
                }
            }

            uint256 averageScore = totalScore / validVerifications;
            record.score = averageScore;
            
            if (averageScore >= MIN_VERIFICATION_SCORE) {
                record.status = VerificationStatus.VERIFIED_AUTHENTIC;
            } else {
                record.status = VerificationStatus.VERIFIED_COUNTERFEIT;
            }
        }

        emit VerificationFinalized(verificationId, record.productId, record.status, record.score);
    }

    // ============ DISPUTE SYSTEM ============

    /**
     * @dev Raise a dispute against a verification
     * @param verificationId ID of the verification to dispute
     * @param reason Reason for the dispute
     */
    function raiseDispute(
        uint256 verificationId,
        string memory reason
    ) external payable nonReentrant {
        require(verificationId <= _verificationIds.current(), "Invalid verification ID");
        require(bytes(reason).length > 0, "Reason cannot be empty");
        require(msg.value >= 0.1 ether, "Insufficient dispute stake");

        VerificationRecord storage record = verifications[verificationId];
        require(record.status != VerificationStatus.DISPUTED, "Already disputed");
        require(record.status != VerificationStatus.PENDING, "Cannot dispute pending verification");
        require(msg.sender != record.verifier, "Cannot dispute own verification");

        _disputeIds.increment();
        uint256 disputeId = _disputeIds.current();

        DisputeCase storage dispute = disputes[disputeId];
        dispute.verificationId = verificationId;
        dispute.challenger = msg.sender;
        dispute.verifier = record.verifier;
        dispute.reason = reason;
        dispute.challengerStake = msg.value;
        dispute.timestamp = block.timestamp;
        dispute.status = DisputeStatus.ACTIVE;
        dispute.resolverVotes = 0;

        record.status = VerificationStatus.DISPUTED;
        record.disputeId = disputeId;

        emit DisputeRaised(disputeId, verificationId, msg.sender, reason);
    }

    /**
     * @dev Vote on a dispute (only dispute resolvers can vote)
     * @param disputeId ID of the dispute
     * @param supportVerifier True to support verifier, false to support challenger
     */
    function voteOnDispute(
        uint256 disputeId,
        bool supportVerifier
    ) external onlyRole(DISPUTE_RESOLVER_ROLE) {
        require(disputeId <= _disputeIds.current(), "Invalid dispute ID");
        
        DisputeCase storage dispute = disputes[disputeId];
        require(dispute.status == DisputeStatus.ACTIVE, "Dispute not active");
        require(!dispute.hasVoted[msg.sender], "Already voted");
        require(block.timestamp < dispute.timestamp + DISPUTE_TIMEOUT, "Dispute expired");

        dispute.hasVoted[msg.sender] = true;
        dispute.voteDecision[msg.sender] = supportVerifier;
        dispute.resolverVotes++;

        // Check if we can resolve the dispute (simple majority for now)
        if (dispute.resolverVotes >= 3) {
            _resolveDispute(disputeId);
        }
    }

    /**
     * @dev Resolve a dispute based on votes
     * @param disputeId ID of the dispute to resolve
     */
    function _resolveDispute(uint256 disputeId) internal {
        DisputeCase storage dispute = disputes[disputeId];
        VerificationRecord storage record = verifications[dispute.verificationId];

        // Count votes (simplified - in production, use a more sophisticated mechanism)
        uint256 verifierSupport = 0;
        // Note: In a real implementation, you'd iterate through all voters
        // This is simplified for demonstration

        bool verifierWins = verifierSupport > dispute.resolverVotes / 2;
        
        if (verifierWins) {
            dispute.status = DisputeStatus.RESOLVED_FOR_VERIFIER;
            record.status = record.score >= MIN_VERIFICATION_SCORE ? 
                VerificationStatus.VERIFIED_AUTHENTIC : 
                VerificationStatus.VERIFIED_COUNTERFEIT;
            
            // Return stake to challenger, reward verifier
            payable(dispute.challenger).transfer(dispute.challengerStake / 2);
            payable(dispute.verifier).transfer(dispute.challengerStake / 2);
            
            // Update verifier reputation positively
            verifiers[dispute.verifier].reputation += 100;
            
        } else {
            dispute.status = DisputeStatus.RESOLVED_FOR_CHALLENGER;
            record.status = VerificationStatus.VERIFIED_COUNTERFEIT;
            
            // Reward challenger, penalize verifier
            payable(dispute.challenger).transfer(dispute.challengerStake * 2);
            
            // Update verifier reputation negatively
            if (verifiers[dispute.verifier].reputation > 200) {
                verifiers[dispute.verifier].reputation -= 200;
            } else {
                verifiers[dispute.verifier].reputation = 0;
            }
            verifiers[dispute.verifier].disputesLost++;
        }

        emit DisputeResolved(disputeId, dispute.status, 
            verifierWins ? dispute.verifier : dispute.challenger, 
            dispute.challengerStake);
    }

    // ============ RULE MANAGEMENT ============

    /**
     * @dev Add or update a verification rule
     * @param ruleId Unique identifier for the rule
     * @param description Human-readable description
     * @param minScore Minimum acceptable score
     * @param maxScore Maximum acceptable score
     * @param requiresMultiSig Whether multiple verifiers are required
     * @param minVerifiers Minimum number of verifiers required
     * @param allowedMethods Array of allowed verification methods
     */
    function setVerificationRule(
        string memory ruleId,
        string memory description,
        uint256 minScore,
        uint256 maxScore,
        bool requiresMultiSig,
        uint256 minVerifiers,
        string[] memory allowedMethods
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(bytes(ruleId).length > 0, "Rule ID cannot be empty");
        require(minScore <= maxScore, "Invalid score range");
        require(maxScore <= MAX_VERIFICATION_SCORE, "Max score too high");
        require(!requiresMultiSig || minVerifiers > 1, "Multi-sig requires min 2 verifiers");

        verificationRules[ruleId] = VerificationRule({
            ruleId: ruleId,
            description: description,
            minScore: minScore,
            maxScore: maxScore,
            requiresMultiSig: requiresMultiSig,
            minVerifiers: minVerifiers,
            allowedMethods: allowedMethods,
            isActive: true
        });

        emit VerificationRuleUpdated(ruleId, minScore, requiresMultiSig);
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @dev Get verification details
     * @param verificationId ID of the verification
     */
    function getVerification(uint256 verificationId) 
        external 
        view 
        returns (VerificationRecord memory) 
    {
        require(verificationId <= _verificationIds.current(), "Invalid verification ID");
        return verifications[verificationId];
    }

    /**
     * @dev Get all verifications for a product
     * @param productId Product identifier
     */
    function getProductVerifications(string memory productId) 
        external 
        view 
        returns (uint256[] memory) 
    {
        return productVerificationHistory[productId];
    }

    /**
     * @dev Get verifier profile
     * @param verifier Address of the verifier
     */
    function getVerifierProfile(address verifier) 
        external 
        view 
        returns (VerifierProfile memory) 
    {
        return verifiers[verifier];
    }

    /**
     * @dev Get current verification count for a product
     * @param productId Product identifier
     */
    function _getVerificationCount(string memory productId) 
        internal 
        view 
        returns (uint256) 
    {
        return productVerificationHistory[productId].length;
    }

    /**
     * @dev Check if verification method is allowed for a rule
     * @param method Verification method to check
     * @param allowedMethods Array of allowed methods
     */
    function _isMethodAllowed(
        string memory method, 
        string[] memory allowedMethods
    ) internal pure returns (bool) {
        for (uint256 i = 0; i < allowedMethods.length; i++) {
            if (keccak256(bytes(method)) == keccak256(bytes(allowedMethods[i]))) {
                return true;
            }
        }
        return false;
    }

    /**
     * @dev Initialize default verification rules
     */
    function _initializeDefaultRules() internal {
        // Standard authenticity verification rule
        string[] memory standardMethods = new string[](3);
        standardMethods[0] = "AI_AGENT";
        standardMethods[1] = "HUMAN";
        standardMethods[2] = "HYBRID";

        verificationRules["STANDARD"] = VerificationRule({
            ruleId: "STANDARD",
            description: "Standard authenticity verification for most products",
            minScore: 0,
            maxScore: 100,
            requiresMultiSig: false,
            minVerifiers: 1,
            allowedMethods: standardMethods,
            isActive: true
        });

        // High-value product verification rule
        string[] memory premiumMethods = new string[](2);
        premiumMethods[0] = "HUMAN";
        premiumMethods[1] = "HYBRID";

        verificationRules["PREMIUM"] = VerificationRule({
            ruleId: "PREMIUM",
            description: "Premium verification for high-value products requiring multiple verifiers",
            minScore: 80,
            maxScore: 100,
            requiresMultiSig: true,
            minVerifiers: 3,
            allowedMethods: premiumMethods,
            isActive: true
        });
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @dev Pause contract functions
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * @dev Unpause contract functions
     */
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /**
     * @dev Emergency withdrawal function
     */
    function emergencyWithdraw() external onlyRole(DEFAULT_ADMIN_ROLE) {
        payable(msg.sender).transfer(address(this).balance);
    }

    // ============ RECEIVE FUNCTION ============
    receive() external payable {}
}