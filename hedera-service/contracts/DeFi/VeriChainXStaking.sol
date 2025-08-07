// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title VeriChainXStaking
 * @dev Advanced staking protocol with multiple pools, rewards, and governance
 * Supports flexible reward distribution, vesting, and delegation
 */
contract VeriChainXStaking is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using Math for uint256;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant POOL_MANAGER_ROLE = keccak256("POOL_MANAGER_ROLE");
    bytes32 public constant REWARD_MANAGER_ROLE = keccak256("REWARD_MANAGER_ROLE");

    struct StakingPool {
        IERC20 stakingToken;
        IERC20 rewardToken;
        uint256 rewardRate;
        uint256 rewardPerTokenStored;
        uint256 lastUpdateTime;
        uint256 totalStaked;
        uint256 lockupPeriod;
        uint256 minStakeAmount;
        uint256 maxStakeAmount;
        bool active;
        bool emergencyWithdrawEnabled;
        string name;
        string description;
    }

    struct UserStake {
        uint256 amount;
        uint256 rewardPerTokenPaid;
        uint256 rewards;
        uint256 lockupEnd;
        uint256 stakedAt;
        bool delegated;
        address delegate;
    }

    struct VestingSchedule {
        uint256 totalAmount;
        uint256 releasedAmount;
        uint256 startTime;
        uint256 duration;
        uint256 cliffDuration;
        bool revocable;
        bool revoked;
    }

    struct RewardMultiplier {
        uint256 stakeDuration;
        uint256 multiplier; // in basis points (10000 = 1x)
        bool active;
    }

    // Pool management
    mapping(bytes32 => StakingPool) public stakingPools;
    mapping(bytes32 => mapping(address => UserStake)) public userStakes;
    mapping(address => bytes32[]) public userPoolIds;
    bytes32[] public allPoolIds;

    // Delegation
    mapping(address => mapping(address => uint256)) public delegatedAmounts;
    mapping(address => address[]) public delegators;
    mapping(address => uint256) public totalDelegated;

    // Vesting
    mapping(address => mapping(bytes32 => VestingSchedule)) public vestingSchedules;
    mapping(address => bytes32[]) public userVestingSchedules;

    // Reward multipliers
    mapping(bytes32 => RewardMultiplier[]) public rewardMultipliers;

    // Pool statistics
    mapping(bytes32 => uint256) public totalRewardsDistributed;
    mapping(bytes32 => uint256) public poolCreationTime;
    mapping(bytes32 => uint256) public averageStakingDuration;

    // Global settings
    uint256 public globalRewardMultiplier = 10000; // 1x
    uint256 public maxPoolsPerUser = 10;
    uint256 public emergencyWithdrawFee = 500; // 5%
    address public emergencyWithdrawFeeRecipient;

    // Events
    event PoolCreated(
        bytes32 indexed poolId,
        address indexed stakingToken,
        address indexed rewardToken,
        uint256 rewardRate,
        uint256 lockupPeriod
    );
    event Staked(bytes32 indexed poolId, address indexed user, uint256 amount, uint256 lockupEnd);
    event Unstaked(bytes32 indexed poolId, address indexed user, uint256 amount);
    event RewardsClaimed(bytes32 indexed poolId, address indexed user, uint256 reward);
    event Delegated(address indexed delegator, address indexed delegate, uint256 amount);
    event Undelegated(address indexed delegator, address indexed delegate, uint256 amount);
    event VestingScheduleCreated(address indexed beneficiary, bytes32 indexed scheduleId, uint256 amount, uint256 duration);
    event VestingTokensReleased(address indexed beneficiary, bytes32 indexed scheduleId, uint256 amount);
    event EmergencyWithdraw(bytes32 indexed poolId, address indexed user, uint256 amount, uint256 fee);
    event RewardMultiplierAdded(bytes32 indexed poolId, uint256 stakeDuration, uint256 multiplier);

    modifier poolExists(bytes32 poolId) {
        require(stakingPools[poolId].active, "Pool does not exist or is inactive");
        _;
    }

    modifier updateReward(bytes32 poolId, address account) {
        StakingPool storage pool = stakingPools[poolId];
        pool.rewardPerTokenStored = rewardPerToken(poolId);
        pool.lastUpdateTime = lastTimeRewardApplicable(poolId);

        if (account != address(0)) {
            UserStake storage userStake = userStakes[poolId][account];
            userStake.rewards = earned(poolId, account);
            userStake.rewardPerTokenPaid = pool.rewardPerTokenStored;
        }
        _;
    }

    constructor(address admin, address _emergencyWithdrawFeeRecipient) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(POOL_MANAGER_ROLE, admin);
        _grantRole(REWARD_MANAGER_ROLE, admin);
        
        emergencyWithdrawFeeRecipient = _emergencyWithdrawFeeRecipient;
    }

    /**
     * @dev Create a new staking pool
     */
    function createStakingPool(
        string memory name,
        string memory description,
        address stakingToken,
        address rewardToken,
        uint256 rewardRate,
        uint256 lockupPeriod,
        uint256 minStakeAmount,
        uint256 maxStakeAmount
    ) external onlyRole(POOL_MANAGER_ROLE) returns (bytes32 poolId) {
        require(stakingToken != address(0) && rewardToken != address(0), "Invalid token addresses");
        require(rewardRate > 0, "Reward rate must be greater than 0");
        require(maxStakeAmount == 0 || maxStakeAmount >= minStakeAmount, "Invalid stake amounts");

        poolId = keccak256(abi.encodePacked(stakingToken, rewardToken, block.timestamp, name));
        require(!stakingPools[poolId].active, "Pool already exists");

        stakingPools[poolId] = StakingPool({
            stakingToken: IERC20(stakingToken),
            rewardToken: IERC20(rewardToken),
            rewardRate: rewardRate,
            rewardPerTokenStored: 0,
            lastUpdateTime: block.timestamp,
            totalStaked: 0,
            lockupPeriod: lockupPeriod,
            minStakeAmount: minStakeAmount,
            maxStakeAmount: maxStakeAmount,
            active: true,
            emergencyWithdrawEnabled: true,
            name: name,
            description: description
        });

        allPoolIds.push(poolId);
        poolCreationTime[poolId] = block.timestamp;

        emit PoolCreated(poolId, stakingToken, rewardToken, rewardRate, lockupPeriod);
    }

    /**
     * @dev Stake tokens in a pool
     */
    function stake(bytes32 poolId, uint256 amount) 
        external 
        nonReentrant 
        whenNotPaused 
        poolExists(poolId) 
        updateReward(poolId, msg.sender) 
    {
        require(amount > 0, "Cannot stake 0");
        
        StakingPool storage pool = stakingPools[poolId];
        UserStake storage userStake = userStakes[poolId][msg.sender];
        
        require(amount >= pool.minStakeAmount, "Amount below minimum");
        if (pool.maxStakeAmount > 0) {
            require(userStake.amount + amount <= pool.maxStakeAmount, "Amount exceeds maximum");
        }

        // Check user pool limit
        if (userStake.amount == 0) {
            require(userPoolIds[msg.sender].length < maxPoolsPerUser, "Max pools per user exceeded");
            userPoolIds[msg.sender].push(poolId);
        }

        uint256 lockupEnd = block.timestamp + pool.lockupPeriod;
        
        userStake.amount += amount;
        userStake.lockupEnd = Math.max(userStake.lockupEnd, lockupEnd);
        userStake.stakedAt = block.timestamp;
        
        pool.totalStaked += amount;

        pool.stakingToken.safeTransferFrom(msg.sender, address(this), amount);

        emit Staked(poolId, msg.sender, amount, lockupEnd);
    }

    /**
     * @dev Unstake tokens from a pool
     */
    function unstake(bytes32 poolId, uint256 amount) 
        external 
        nonReentrant 
        poolExists(poolId) 
        updateReward(poolId, msg.sender) 
    {
        require(amount > 0, "Cannot unstake 0");
        
        UserStake storage userStake = userStakes[poolId][msg.sender];
        require(userStake.amount >= amount, "Insufficient staked amount");
        require(block.timestamp >= userStake.lockupEnd, "Tokens are locked");

        userStake.amount -= amount;
        stakingPools[poolId].totalStaked -= amount;

        stakingPools[poolId].stakingToken.safeTransfer(msg.sender, amount);

        emit Unstaked(poolId, msg.sender, amount);
    }

    /**
     * @dev Emergency withdraw with penalty
     */
    function emergencyUnstake(bytes32 poolId, uint256 amount) 
        external 
        nonReentrant 
        poolExists(poolId) 
        updateReward(poolId, msg.sender) 
    {
        require(amount > 0, "Cannot unstake 0");
        require(stakingPools[poolId].emergencyWithdrawEnabled, "Emergency withdraw disabled");
        
        UserStake storage userStake = userStakes[poolId][msg.sender];
        require(userStake.amount >= amount, "Insufficient staked amount");

        uint256 fee = (amount * emergencyWithdrawFee) / 10000;
        uint256 amountAfterFee = amount - fee;

        userStake.amount -= amount;
        stakingPools[poolId].totalStaked -= amount;

        // Transfer fee to recipient
        if (fee > 0) {
            stakingPools[poolId].stakingToken.safeTransfer(emergencyWithdrawFeeRecipient, fee);
        }

        // Transfer remaining amount to user
        stakingPools[poolId].stakingToken.safeTransfer(msg.sender, amountAfterFee);

        emit EmergencyWithdraw(poolId, msg.sender, amount, fee);
    }

    /**
     * @dev Claim rewards from a pool
     */
    function claimRewards(bytes32 poolId) 
        external 
        nonReentrant 
        poolExists(poolId) 
        updateReward(poolId, msg.sender) 
    {
        UserStake storage userStake = userStakes[poolId][msg.sender];
        uint256 reward = userStake.rewards;
        require(reward > 0, "No rewards available");

        // Apply reward multiplier based on staking duration
        uint256 multiplier = getRewardMultiplier(poolId, msg.sender);
        reward = (reward * multiplier) / 10000;

        userStake.rewards = 0;
        totalRewardsDistributed[poolId] += reward;

        stakingPools[poolId].rewardToken.safeTransfer(msg.sender, reward);

        emit RewardsClaimed(poolId, msg.sender, reward);
    }

    /**
     * @dev Delegate staking power to another address
     */
    function delegate(address delegate, uint256 amount) external nonReentrant {
        require(delegate != address(0) && delegate != msg.sender, "Invalid delegate");
        require(amount > 0, "Cannot delegate 0");

        // For simplicity, using total staked amount across all pools
        uint256 totalStaked = getTotalUserStaked(msg.sender);
        require(totalStaked >= amount, "Insufficient staked amount");

        delegatedAmounts[msg.sender][delegate] += amount;
        totalDelegated[delegate] += amount;

        // Add to delegators list if first time
        if (delegatedAmounts[msg.sender][delegate] == amount) {
            delegators[delegate].push(msg.sender);
        }

        emit Delegated(msg.sender, delegate, amount);
    }

    /**
     * @dev Undelegate staking power
     */
    function undelegate(address delegate, uint256 amount) external nonReentrant {
        require(amount > 0, "Cannot undelegate 0");
        require(delegatedAmounts[msg.sender][delegate] >= amount, "Insufficient delegated amount");

        delegatedAmounts[msg.sender][delegate] -= amount;
        totalDelegated[delegate] -= amount;

        emit Undelegated(msg.sender, delegate, amount);
    }

    /**
     * @dev Create vesting schedule for rewards
     */
    function createVestingSchedule(
        address beneficiary,
        uint256 amount,
        uint256 duration,
        uint256 cliffDuration,
        bool revocable
    ) external onlyRole(REWARD_MANAGER_ROLE) returns (bytes32 scheduleId) {
        require(beneficiary != address(0), "Invalid beneficiary");
        require(amount > 0, "Amount must be greater than 0");
        require(duration > 0, "Duration must be greater than 0");
        require(cliffDuration <= duration, "Cliff duration exceeds total duration");

        scheduleId = keccak256(abi.encodePacked(beneficiary, amount, duration, block.timestamp));

        vestingSchedules[beneficiary][scheduleId] = VestingSchedule({
            totalAmount: amount,
            releasedAmount: 0,
            startTime: block.timestamp,
            duration: duration,
            cliffDuration: cliffDuration,
            revocable: revocable,
            revoked: false
        });

        userVestingSchedules[beneficiary].push(scheduleId);

        emit VestingScheduleCreated(beneficiary, scheduleId, amount, duration);
    }

    /**
     * @dev Release vested tokens
     */
    function releaseVestedTokens(bytes32 scheduleId) external nonReentrant {
        VestingSchedule storage schedule = vestingSchedules[msg.sender][scheduleId];
        require(schedule.totalAmount > 0, "Vesting schedule does not exist");
        require(!schedule.revoked, "Vesting schedule revoked");

        uint256 releasableAmount = getReleasableAmount(msg.sender, scheduleId);
        require(releasableAmount > 0, "No tokens to release");

        schedule.releasedAmount += releasableAmount;

        // Transfer tokens (assuming a reward token, can be parameterized)
        // For now, we'll emit event and manual transfer is required
        emit VestingTokensReleased(msg.sender, scheduleId, releasableAmount);
    }

    /**
     * @dev Add reward multiplier for staking duration
     */
    function addRewardMultiplier(
        bytes32 poolId,
        uint256 stakeDuration,
        uint256 multiplier
    ) external onlyRole(POOL_MANAGER_ROLE) poolExists(poolId) {
        require(multiplier >= 10000, "Multiplier must be at least 1x");
        require(stakeDuration > 0, "Duration must be greater than 0");

        rewardMultipliers[poolId].push(RewardMultiplier({
            stakeDuration: stakeDuration,
            multiplier: multiplier,
            active: true
        }));

        emit RewardMultiplierAdded(poolId, stakeDuration, multiplier);
    }

    /**
     * @dev Calculate reward per token
     */
    function rewardPerToken(bytes32 poolId) public view returns (uint256) {
        StakingPool storage pool = stakingPools[poolId];
        if (pool.totalStaked == 0) {
            return pool.rewardPerTokenStored;
        }
        
        return pool.rewardPerTokenStored + 
            (((lastTimeRewardApplicable(poolId) - pool.lastUpdateTime) * pool.rewardRate * 1e18) / pool.totalStaked);
    }

    /**
     * @dev Calculate earned rewards for a user
     */
    function earned(bytes32 poolId, address account) public view returns (uint256) {
        UserStake storage userStake = userStakes[poolId][account];
        return (userStake.amount * (rewardPerToken(poolId) - userStake.rewardPerTokenPaid)) / 1e18 + userStake.rewards;
    }

    /**
     * @dev Get last time reward applicable
     */
    function lastTimeRewardApplicable(bytes32 poolId) public view returns (uint256) {
        return block.timestamp;
    }

    /**
     * @dev Get reward multiplier for user based on staking duration
     */
    function getRewardMultiplier(bytes32 poolId, address account) public view returns (uint256) {
        UserStake storage userStake = userStakes[poolId][account];
        uint256 stakingDuration = block.timestamp - userStake.stakedAt;
        
        RewardMultiplier[] storage multipliers = rewardMultipliers[poolId];
        uint256 maxMultiplier = globalRewardMultiplier;
        
        for (uint256 i = 0; i < multipliers.length; i++) {
            if (multipliers[i].active && stakingDuration >= multipliers[i].stakeDuration) {
                if (multipliers[i].multiplier > maxMultiplier) {
                    maxMultiplier = multipliers[i].multiplier;
                }
            }
        }
        
        return maxMultiplier;
    }

    /**
     * @dev Get total staked amount for a user across all pools
     */
    function getTotalUserStaked(address user) public view returns (uint256) {
        uint256 total = 0;
        bytes32[] memory userPools = userPoolIds[user];
        
        for (uint256 i = 0; i < userPools.length; i++) {
            total += userStakes[userPools[i]][user].amount;
        }
        
        return total;
    }

    /**
     * @dev Get releasable amount from vesting schedule
     */
    function getReleasableAmount(address beneficiary, bytes32 scheduleId) public view returns (uint256) {
        VestingSchedule storage schedule = vestingSchedules[beneficiary][scheduleId];
        
        if (schedule.revoked) {
            return 0;
        }
        
        uint256 currentTime = block.timestamp;
        if (currentTime < schedule.startTime + schedule.cliffDuration) {
            return 0;
        }
        
        uint256 timeFromStart = currentTime - schedule.startTime;
        uint256 vestedAmount;
        
        if (timeFromStart >= schedule.duration) {
            vestedAmount = schedule.totalAmount;
        } else {
            vestedAmount = (schedule.totalAmount * timeFromStart) / schedule.duration;
        }
        
        return vestedAmount - schedule.releasedAmount;
    }

    /**
     * @dev Get pool information
     */
    function getPoolInfo(bytes32 poolId) external view returns (StakingPool memory) {
        return stakingPools[poolId];
    }

    /**
     * @dev Get user stake information
     */
    function getUserStakeInfo(bytes32 poolId, address user) external view returns (UserStake memory) {
        return userStakes[poolId][user];
    }

    /**
     * @dev Get all pool IDs
     */
    function getAllPoolIds() external view returns (bytes32[] memory) {
        return allPoolIds;
    }

    /**
     * @dev Get user pool IDs
     */
    function getUserPoolIds(address user) external view returns (bytes32[] memory) {
        return userPoolIds[user];
    }

    /**
     * @dev Get user vesting schedules
     */
    function getUserVestingSchedules(address user) external view returns (bytes32[] memory) {
        return userVestingSchedules[user];
    }

    /**
     * @dev Set global reward multiplier
     */
    function setGlobalRewardMultiplier(uint256 multiplier) external onlyRole(ADMIN_ROLE) {
        require(multiplier >= 10000, "Multiplier must be at least 1x");
        globalRewardMultiplier = multiplier;
    }

    /**
     * @dev Set emergency withdraw fee
     */
    function setEmergencyWithdrawFee(uint256 fee) external onlyRole(ADMIN_ROLE) {
        require(fee <= 2000, "Fee too high"); // Max 20%
        emergencyWithdrawFee = fee;
    }

    /**
     * @dev Toggle emergency withdraw for a pool
     */
    function toggleEmergencyWithdraw(bytes32 poolId, bool enabled) external onlyRole(POOL_MANAGER_ROLE) poolExists(poolId) {
        stakingPools[poolId].emergencyWithdrawEnabled = enabled;
    }

    /**
     * @dev Update pool reward rate
     */
    function updateRewardRate(bytes32 poolId, uint256 newRate) 
        external 
        onlyRole(REWARD_MANAGER_ROLE) 
        poolExists(poolId) 
        updateReward(poolId, address(0)) 
    {
        require(newRate > 0, "Reward rate must be greater than 0");
        stakingPools[poolId].rewardRate = newRate;
    }

    /**
     * @dev Pause/unpause contract
     */
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @dev Emergency withdraw for admin
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        IERC20(token).safeTransfer(msg.sender, amount);
    }
}