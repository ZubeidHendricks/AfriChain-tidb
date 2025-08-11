// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title VeriChainXDEX
 * @dev Decentralized Exchange for VeriChainX ecosystem tokens
 * Provides liquidity pools, token swaps, and yield farming capabilities
 */
contract VeriChainXDEX is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using Math for uint256;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant LIQUIDITY_MANAGER_ROLE = keccak256("LIQUIDITY_MANAGER_ROLE");
    bytes32 public constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");

    // Trading fee in basis points (1 = 0.01%)
    uint256 public tradingFee = 30; // 0.3%
    uint256 public constant MAX_FEE = 1000; // 10%
    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    struct Pool {
        address tokenA;
        address tokenB;
        uint256 reserveA;
        uint256 reserveB;
        uint256 totalSupply;
        uint256 kLast; // For protocol fee calculation
        bool exists;
        uint256 createdAt;
    }

    struct LiquidityPosition {
        address owner;
        bytes32 poolId;
        uint256 liquidity;
        uint256 timestamp;
        uint256 rewardDebt;
    }

    struct StakingPool {
        IERC20 stakingToken;
        IERC20 rewardToken;
        uint256 rewardRate;
        uint256 lastUpdateTime;
        uint256 rewardPerTokenStored;
        uint256 totalStaked;
        bool active;
    }

    // Pool management
    mapping(bytes32 => Pool) public pools;
    mapping(bytes32 => mapping(address => uint256)) public liquidityBalances;
    mapping(address => bytes32[]) public userPools;
    bytes32[] public allPools;

    // Staking management
    mapping(bytes32 => StakingPool) public stakingPools;
    mapping(bytes32 => mapping(address => uint256)) public stakedBalances;
    mapping(bytes32 => mapping(address => uint256)) public userRewardPerTokenPaid;
    mapping(bytes32 => mapping(address => uint256)) public rewards;

    // Fee collection
    mapping(address => uint256) public protocolFees;
    address public feeRecipient;

    // Events
    event PoolCreated(bytes32 indexed poolId, address indexed tokenA, address indexed tokenB);
    event LiquidityAdded(bytes32 indexed poolId, address indexed provider, uint256 amountA, uint256 amountB, uint256 liquidity);
    event LiquidityRemoved(bytes32 indexed poolId, address indexed provider, uint256 amountA, uint256 amountB, uint256 liquidity);
    event TokensSwapped(bytes32 indexed poolId, address indexed trader, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);
    event StakingPoolCreated(bytes32 indexed poolId, address indexed stakingToken, address indexed rewardToken, uint256 rewardRate);
    event Staked(bytes32 indexed poolId, address indexed user, uint256 amount);
    event Unstaked(bytes32 indexed poolId, address indexed user, uint256 amount);
    event RewardsClaimed(bytes32 indexed poolId, address indexed user, uint256 amount);
    event FeesCollected(address indexed recipient, address indexed token, uint256 amount);

    modifier poolExists(bytes32 poolId) {
        require(pools[poolId].exists, "Pool does not exist");
        _;
    }

    modifier validTokens(address tokenA, address tokenB) {
        require(tokenA != tokenB, "Identical tokens");
        require(tokenA != address(0) && tokenB != address(0), "Zero address");
        _;
    }

    constructor(address admin, address _feeRecipient) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(LIQUIDITY_MANAGER_ROLE, admin);
        _grantRole(FEE_MANAGER_ROLE, admin);
        
        feeRecipient = _feeRecipient;
    }

    /**
     * @dev Create a new liquidity pool
     */
    function createPool(
        address tokenA,
        address tokenB
    ) external onlyRole(LIQUIDITY_MANAGER_ROLE) validTokens(tokenA, tokenB) returns (bytes32 poolId) {
        // Ensure consistent token ordering
        if (tokenA > tokenB) {
            (tokenA, tokenB) = (tokenB, tokenA);
        }

        poolId = keccak256(abi.encodePacked(tokenA, tokenB));
        require(!pools[poolId].exists, "Pool already exists");

        pools[poolId] = Pool({
            tokenA: tokenA,
            tokenB: tokenB,
            reserveA: 0,
            reserveB: 0,
            totalSupply: 0,
            kLast: 0,
            exists: true,
            createdAt: block.timestamp
        });

        allPools.push(poolId);

        emit PoolCreated(poolId, tokenA, tokenB);
    }

    /**
     * @dev Add liquidity to a pool
     */
    function addLiquidity(
        bytes32 poolId,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external nonReentrant whenNotPaused poolExists(poolId) returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        require(deadline >= block.timestamp, "Expired");
        
        Pool storage pool = pools[poolId];
        
        if (pool.reserveA == 0 && pool.reserveB == 0) {
            // First liquidity provision
            (amountA, amountB) = (amountADesired, amountBDesired);
            liquidity = Math.sqrt(amountA * amountB) - MINIMUM_LIQUIDITY;
        } else {
            // Calculate optimal amounts
            uint256 amountBOptimal = quote(amountADesired, pool.reserveA, pool.reserveB);
            if (amountBOptimal <= amountBDesired) {
                require(amountBOptimal >= amountBMin, "Insufficient B amount");
                (amountA, amountB) = (amountADesired, amountBOptimal);
            } else {
                uint256 amountAOptimal = quote(amountBDesired, pool.reserveB, pool.reserveA);
                require(amountAOptimal <= amountADesired && amountAOptimal >= amountAMin, "Insufficient A amount");
                (amountA, amountB) = (amountAOptimal, amountBDesired);
            }
            
            liquidity = Math.min(
                (amountA * pool.totalSupply) / pool.reserveA,
                (amountB * pool.totalSupply) / pool.reserveB
            );
        }

        require(liquidity > 0, "Insufficient liquidity minted");

        // Transfer tokens
        IERC20(pool.tokenA).safeTransferFrom(msg.sender, address(this), amountA);
        IERC20(pool.tokenB).safeTransferFrom(msg.sender, address(this), amountB);

        // Update pool state
        pool.reserveA += amountA;
        pool.reserveB += amountB;
        pool.totalSupply += liquidity;

        // Update user liquidity balance
        liquidityBalances[poolId][to] += liquidity;
        if (liquidityBalances[poolId][to] == liquidity) {
            userPools[to].push(poolId);
        }

        emit LiquidityAdded(poolId, to, amountA, amountB, liquidity);
    }

    /**
     * @dev Remove liquidity from a pool
     */
    function removeLiquidity(
        bytes32 poolId,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external nonReentrant poolExists(poolId) returns (uint256 amountA, uint256 amountB) {
        require(deadline >= block.timestamp, "Expired");
        require(liquidity > 0, "Insufficient liquidity");
        require(liquidityBalances[poolId][msg.sender] >= liquidity, "Insufficient balance");

        Pool storage pool = pools[poolId];
        uint256 totalSupply = pool.totalSupply;

        amountA = (liquidity * pool.reserveA) / totalSupply;
        amountB = (liquidity * pool.reserveB) / totalSupply;

        require(amountA >= amountAMin && amountB >= amountBMin, "Insufficient output amount");

        // Update user liquidity balance
        liquidityBalances[poolId][msg.sender] -= liquidity;

        // Update pool state
        pool.reserveA -= amountA;
        pool.reserveB -= amountB;
        pool.totalSupply -= liquidity;

        // Transfer tokens
        IERC20(pool.tokenA).safeTransfer(to, amountA);
        IERC20(pool.tokenB).safeTransfer(to, amountB);

        emit LiquidityRemoved(poolId, msg.sender, amountA, amountB, liquidity);
    }

    /**
     * @dev Swap tokens in a pool
     */
    function swapTokens(
        bytes32 poolId,
        address tokenIn,
        uint256 amountIn,
        uint256 amountOutMin,
        address to,
        uint256 deadline
    ) external nonReentrant whenNotPaused poolExists(poolId) returns (uint256 amountOut) {
        require(deadline >= block.timestamp, "Expired");
        require(amountIn > 0, "Insufficient input amount");

        Pool storage pool = pools[poolId];
        require(tokenIn == pool.tokenA || tokenIn == pool.tokenB, "Invalid token");

        bool isTokenA = tokenIn == pool.tokenA;
        address tokenOut = isTokenA ? pool.tokenB : pool.tokenA;
        
        uint256 reserveIn = isTokenA ? pool.reserveA : pool.reserveB;
        uint256 reserveOut = isTokenA ? pool.reserveB : pool.reserveA;

        // Calculate output amount with fee
        amountOut = getAmountOut(amountIn, reserveIn, reserveOut);
        require(amountOut >= amountOutMin, "Insufficient output amount");

        // Transfer input token
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        // Calculate fee
        uint256 fee = (amountIn * tradingFee) / 10000;
        protocolFees[tokenIn] += fee;

        // Update reserves
        if (isTokenA) {
            pool.reserveA += amountIn;
            pool.reserveB -= amountOut;
        } else {
            pool.reserveB += amountIn;
            pool.reserveA -= amountOut;
        }

        // Transfer output token
        IERC20(tokenOut).safeTransfer(to, amountOut);

        emit TokensSwapped(poolId, msg.sender, tokenIn, tokenOut, amountIn, amountOut);
    }

    /**
     * @dev Create a staking pool
     */
    function createStakingPool(
        address stakingToken,
        address rewardToken,
        uint256 rewardRate
    ) external onlyRole(ADMIN_ROLE) returns (bytes32 stakingPoolId) {
        stakingPoolId = keccak256(abi.encodePacked(stakingToken, rewardToken, block.timestamp));
        
        stakingPools[stakingPoolId] = StakingPool({
            stakingToken: IERC20(stakingToken),
            rewardToken: IERC20(rewardToken),
            rewardRate: rewardRate,
            lastUpdateTime: block.timestamp,
            rewardPerTokenStored: 0,
            totalStaked: 0,
            active: true
        });

        emit StakingPoolCreated(stakingPoolId, stakingToken, rewardToken, rewardRate);
    }

    /**
     * @dev Stake tokens in a staking pool
     */
    function stake(bytes32 stakingPoolId, uint256 amount) external nonReentrant updateReward(stakingPoolId, msg.sender) {
        require(amount > 0, "Cannot stake 0");
        require(stakingPools[stakingPoolId].active, "Staking pool not active");

        StakingPool storage stakingPool = stakingPools[stakingPoolId];
        
        stakedBalances[stakingPoolId][msg.sender] += amount;
        stakingPool.totalStaked += amount;

        stakingPool.stakingToken.safeTransferFrom(msg.sender, address(this), amount);

        emit Staked(stakingPoolId, msg.sender, amount);
    }

    /**
     * @dev Unstake tokens from a staking pool
     */
    function unstake(bytes32 stakingPoolId, uint256 amount) external nonReentrant updateReward(stakingPoolId, msg.sender) {
        require(amount > 0, "Cannot unstake 0");
        require(stakedBalances[stakingPoolId][msg.sender] >= amount, "Insufficient staked balance");

        StakingPool storage stakingPool = stakingPools[stakingPoolId];
        
        stakedBalances[stakingPoolId][msg.sender] -= amount;
        stakingPool.totalStaked -= amount;

        stakingPool.stakingToken.safeTransfer(msg.sender, amount);

        emit Unstaked(stakingPoolId, msg.sender, amount);
    }

    /**
     * @dev Claim staking rewards
     */
    function claimRewards(bytes32 stakingPoolId) external nonReentrant updateReward(stakingPoolId, msg.sender) {
        uint256 reward = rewards[stakingPoolId][msg.sender];
        require(reward > 0, "No rewards available");

        rewards[stakingPoolId][msg.sender] = 0;
        stakingPools[stakingPoolId].rewardToken.safeTransfer(msg.sender, reward);

        emit RewardsClaimed(stakingPoolId, msg.sender, reward);
    }

    /**
     * @dev Calculate output amount for a given input
     */
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) public view returns (uint256 amountOut) {
        require(amountIn > 0, "Insufficient input amount");
        require(reserveIn > 0 && reserveOut > 0, "Insufficient liquidity");
        
        uint256 amountInWithFee = amountIn * (10000 - tradingFee);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * 10000) + amountInWithFee;
        amountOut = numerator / denominator;
    }

    /**
     * @dev Quote function for liquidity provision
     */
    function quote(uint256 amountA, uint256 reserveA, uint256 reserveB) public pure returns (uint256 amountB) {
        require(amountA > 0, "Insufficient amount");
        require(reserveA > 0 && reserveB > 0, "Insufficient liquidity");
        amountB = (amountA * reserveB) / reserveA;
    }

    /**
     * @dev Get reward per token for staking pool
     */
    function rewardPerToken(bytes32 stakingPoolId) public view returns (uint256) {
        StakingPool storage stakingPool = stakingPools[stakingPoolId];
        
        if (stakingPool.totalStaked == 0) {
            return stakingPool.rewardPerTokenStored;
        }
        
        return stakingPool.rewardPerTokenStored + 
            (((block.timestamp - stakingPool.lastUpdateTime) * stakingPool.rewardRate * 1e18) / stakingPool.totalStaked);
    }

    /**
     * @dev Calculate earned rewards for a user
     */
    function earned(bytes32 stakingPoolId, address account) public view returns (uint256) {
        return (stakedBalances[stakingPoolId][account] * 
            (rewardPerToken(stakingPoolId) - userRewardPerTokenPaid[stakingPoolId][account])) / 1e18 + 
            rewards[stakingPoolId][account];
    }

    /**
     * @dev Update reward calculations
     */
    modifier updateReward(bytes32 stakingPoolId, address account) {
        StakingPool storage stakingPool = stakingPools[stakingPoolId];
        stakingPool.rewardPerTokenStored = rewardPerToken(stakingPoolId);
        stakingPool.lastUpdateTime = block.timestamp;

        if (account != address(0)) {
            rewards[stakingPoolId][account] = earned(stakingPoolId, account);
            userRewardPerTokenPaid[stakingPoolId][account] = stakingPool.rewardPerTokenStored;
        }
        _;
    }

    /**
     * @dev Collect protocol fees
     */
    function collectFees(address token) external onlyRole(FEE_MANAGER_ROLE) {
        uint256 amount = protocolFees[token];
        require(amount > 0, "No fees to collect");
        
        protocolFees[token] = 0;
        IERC20(token).safeTransfer(feeRecipient, amount);
        
        emit FeesCollected(feeRecipient, token, amount);
    }

    /**
     * @dev Set trading fee
     */
    function setTradingFee(uint256 _tradingFee) external onlyRole(FEE_MANAGER_ROLE) {
        require(_tradingFee <= MAX_FEE, "Fee too high");
        tradingFee = _tradingFee;
    }

    /**
     * @dev Set fee recipient
     */
    function setFeeRecipient(address _feeRecipient) external onlyRole(ADMIN_ROLE) {
        require(_feeRecipient != address(0), "Zero address");
        feeRecipient = _feeRecipient;
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
     * @dev Get pool information
     */
    function getPool(bytes32 poolId) external view returns (Pool memory) {
        return pools[poolId];
    }

    /**
     * @dev Get all pools
     */
    function getAllPools() external view returns (bytes32[] memory) {
        return allPools;
    }

    /**
     * @dev Get user's liquidity positions
     */
    function getUserPools(address user) external view returns (bytes32[] memory) {
        return userPools[user];
    }

    /**
     * @dev Get user's liquidity balance in a pool
     */
    function getUserLiquidity(bytes32 poolId, address user) external view returns (uint256) {
        return liquidityBalances[poolId][user];
    }

    /**
     * @dev Get staking pool information
     */
    function getStakingPool(bytes32 stakingPoolId) external view returns (StakingPool memory) {
        return stakingPools[stakingPoolId];
    }

    /**
     * @dev Get user's staked balance
     */
    function getStakedBalance(bytes32 stakingPoolId, address user) external view returns (uint256) {
        return stakedBalances[stakingPoolId][user];
    }

    /**
     * @dev Emergency withdraw function
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        IERC20(token).safeTransfer(msg.sender, amount);
    }
}