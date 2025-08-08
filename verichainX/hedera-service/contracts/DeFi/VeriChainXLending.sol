// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title VeriChainXLending
 * @dev Decentralized lending protocol for VeriChainX ecosystem
 * Supports collateralized lending, interest accrual, and liquidations
 */
contract VeriChainXLending is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using Math for uint256;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant LIQUIDATOR_ROLE = keccak256("LIQUIDATOR_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    // Interest rate model parameters
    uint256 public constant UTILIZATION_RATE_OPTIMAL = 80e16; // 80%
    uint256 public constant INTEREST_RATE_BASE = 2e16; // 2%
    uint256 public constant INTEREST_RATE_SLOPE1 = 4e16; // 4%
    uint256 public constant INTEREST_RATE_SLOPE2 = 100e16; // 100%
    uint256 public constant LIQUIDATION_THRESHOLD = 75e16; // 75%
    uint256 public constant LIQUIDATION_BONUS = 5e16; // 5%

    struct Market {
        IERC20 token;
        uint256 totalSupply;
        uint256 totalBorrow;
        uint256 reserveFactor;
        uint256 collateralFactor;
        uint256 liquidationThreshold;
        uint256 lastUpdateTimestamp;
        uint256 borrowIndex;
        uint256 supplyIndex;
        bool isActive;
        bool canBorrow;
        bool canUseAsCollateral;
    }

    struct UserInfo {
        uint256 suppliedAmount;
        uint256 borrowedAmount;
        uint256 supplyIndex;
        uint256 borrowIndex;
        uint256 lastUpdateTimestamp;
    }

    struct LiquidationInfo {
        address liquidator;
        address borrower;
        address collateralAsset;
        address borrowAsset;
        uint256 repayAmount;
        uint256 collateralAmount;
        uint256 timestamp;
    }

    // Markets
    mapping(address => Market) public markets;
    mapping(address => mapping(address => UserInfo)) public userInfo;
    mapping(address => address[]) public userMarkets;
    address[] public allMarkets;

    // Price oracle
    mapping(address => uint256) public assetPrices;
    mapping(address => address) public priceOracles;

    // Liquidation tracking
    LiquidationInfo[] public liquidations;
    mapping(address => uint256) public liquidationCount;

    // Protocol parameters
    uint256 public protocolFeeShare = 10e16; // 10%
    address public protocolFeeRecipient;
    mapping(address => uint256) public reserves;

    // Events
    event MarketAdded(address indexed token, uint256 collateralFactor, uint256 liquidationThreshold);
    event Supply(address indexed user, address indexed token, uint256 amount);
    event Withdraw(address indexed user, address indexed token, uint256 amount);
    event Borrow(address indexed user, address indexed token, uint256 amount);
    event Repay(address indexed user, address indexed token, uint256 amount);
    event Liquidation(
        address indexed liquidator,
        address indexed borrower,
        address indexed collateralAsset,
        address borrowAsset,
        uint256 repayAmount,
        uint256 collateralAmount
    );
    event PriceUpdated(address indexed token, uint256 price);
    event InterestAccrued(address indexed token, uint256 borrowIndex, uint256 supplyIndex);

    modifier marketExists(address token) {
        require(markets[token].isActive, "Market does not exist");
        _;
    }

    modifier updateInterest(address token) {
        accrueInterest(token);
        _;
    }

    constructor(address admin, address _protocolFeeRecipient) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(LIQUIDATOR_ROLE, admin);
        _grantRole(ORACLE_ROLE, admin);
        
        protocolFeeRecipient = _protocolFeeRecipient;
    }

    /**
     * @dev Add a new lending market
     */
    function addMarket(
        address token,
        uint256 collateralFactor,
        uint256 liquidationThreshold,
        uint256 reserveFactor,
        bool canBorrow,
        bool canUseAsCollateral
    ) external onlyRole(ADMIN_ROLE) {
        require(!markets[token].isActive, "Market already exists");
        require(collateralFactor <= 1e18, "Invalid collateral factor");
        require(liquidationThreshold <= 1e18, "Invalid liquidation threshold");
        require(reserveFactor <= 1e18, "Invalid reserve factor");

        markets[token] = Market({
            token: IERC20(token),
            totalSupply: 0,
            totalBorrow: 0,
            reserveFactor: reserveFactor,
            collateralFactor: collateralFactor,
            liquidationThreshold: liquidationThreshold,
            lastUpdateTimestamp: block.timestamp,
            borrowIndex: 1e18,
            supplyIndex: 1e18,
            isActive: true,
            canBorrow: canBorrow,
            canUseAsCollateral: canUseAsCollateral
        });

        allMarkets.push(token);

        emit MarketAdded(token, collateralFactor, liquidationThreshold);
    }

    /**
     * @dev Supply tokens to earn interest
     */
    function supply(address token, uint256 amount) 
        external 
        nonReentrant 
        whenNotPaused 
        marketExists(token) 
        updateInterest(token) 
    {
        require(amount > 0, "Amount must be greater than 0");

        Market storage market = markets[token];
        UserInfo storage user = userInfo[token][msg.sender];

        // Update user's supply position
        if (user.suppliedAmount > 0) {
            uint256 accruedInterest = (user.suppliedAmount * (market.supplyIndex - user.supplyIndex)) / 1e18;
            user.suppliedAmount += accruedInterest;
        }

        user.suppliedAmount += amount;
        user.supplyIndex = market.supplyIndex;
        user.lastUpdateTimestamp = block.timestamp;

        // Update market state
        market.totalSupply += amount;

        // Add to user markets if first time
        if (user.suppliedAmount == amount) {
            userMarkets[msg.sender].push(token);
        }

        // Transfer tokens
        market.token.safeTransferFrom(msg.sender, address(this), amount);

        emit Supply(msg.sender, token, amount);
    }

    /**
     * @dev Withdraw supplied tokens
     */
    function withdraw(address token, uint256 amount) 
        external 
        nonReentrant 
        marketExists(token) 
        updateInterest(token) 
    {
        require(amount > 0, "Amount must be greater than 0");

        Market storage market = markets[token];
        UserInfo storage user = userInfo[token][msg.sender];

        // Update user's supply position with accrued interest
        if (user.suppliedAmount > 0) {
            uint256 accruedInterest = (user.suppliedAmount * (market.supplyIndex - user.supplyIndex)) / 1e18;
            user.suppliedAmount += accruedInterest;
        }

        require(user.suppliedAmount >= amount, "Insufficient balance");

        // Check if withdrawal would make user undercollateralized
        require(getAccountLiquidity(msg.sender, token, amount, 0) >= 0, "Insufficient collateral");

        user.suppliedAmount -= amount;
        user.supplyIndex = market.supplyIndex;
        user.lastUpdateTimestamp = block.timestamp;

        market.totalSupply -= amount;

        // Transfer tokens
        market.token.safeTransfer(msg.sender, amount);

        emit Withdraw(msg.sender, token, amount);
    }

    /**
     * @dev Borrow tokens against collateral
     */
    function borrow(address token, uint256 amount) 
        external 
        nonReentrant 
        whenNotPaused 
        marketExists(token) 
        updateInterest(token) 
    {
        require(amount > 0, "Amount must be greater than 0");
        require(markets[token].canBorrow, "Borrowing not enabled");

        Market storage market = markets[token];
        UserInfo storage user = userInfo[token][msg.sender];

        // Check liquidity
        require(getAccountLiquidity(msg.sender, address(0), 0, amount) >= 0, "Insufficient collateral");

        // Update user's borrow position
        if (user.borrowedAmount > 0) {
            uint256 accruedInterest = (user.borrowedAmount * (market.borrowIndex - user.borrowIndex)) / 1e18;
            user.borrowedAmount += accruedInterest;
        }

        user.borrowedAmount += amount;
        user.borrowIndex = market.borrowIndex;
        user.lastUpdateTimestamp = block.timestamp;

        market.totalBorrow += amount;

        // Add to user markets if first time
        if (user.borrowedAmount == amount && user.suppliedAmount == 0) {
            userMarkets[msg.sender].push(token);
        }

        // Transfer tokens
        market.token.safeTransfer(msg.sender, amount);

        emit Borrow(msg.sender, token, amount);
    }

    /**
     * @dev Repay borrowed tokens
     */
    function repay(address token, uint256 amount) 
        external 
        nonReentrant 
        marketExists(token) 
        updateInterest(token) 
    {
        require(amount > 0, "Amount must be greater than 0");

        Market storage market = markets[token];
        UserInfo storage user = userInfo[token][msg.sender];

        // Update user's borrow position with accrued interest
        if (user.borrowedAmount > 0) {
            uint256 accruedInterest = (user.borrowedAmount * (market.borrowIndex - user.borrowIndex)) / 1e18;
            user.borrowedAmount += accruedInterest;
        }

        uint256 repayAmount = Math.min(amount, user.borrowedAmount);
        
        user.borrowedAmount -= repayAmount;
        user.borrowIndex = market.borrowIndex;
        user.lastUpdateTimestamp = block.timestamp;

        market.totalBorrow -= repayAmount;

        // Transfer tokens
        market.token.safeTransferFrom(msg.sender, address(this), repayAmount);

        emit Repay(msg.sender, token, repayAmount);
    }

    /**
     * @dev Liquidate undercollateralized position
     */
    function liquidate(
        address borrower,
        address borrowAsset,
        uint256 repayAmount,
        address collateralAsset
    ) external nonReentrant onlyRole(LIQUIDATOR_ROLE) {
        require(borrower != msg.sender, "Cannot liquidate self");
        require(getAccountLiquidity(borrower, address(0), 0, 0) < 0, "Account not liquidatable");

        Market storage borrowMarket = markets[borrowAsset];
        Market storage collateralMarket = markets[collateralAsset];
        UserInfo storage borrowerBorrowInfo = userInfo[borrowAsset][borrower];
        UserInfo storage borrowerCollateralInfo = userInfo[collateralAsset][borrower];

        // Accrue interest for both markets
        accrueInterest(borrowAsset);
        accrueInterest(collateralAsset);

        // Update borrower's positions
        if (borrowerBorrowInfo.borrowedAmount > 0) {
            uint256 accruedInterest = (borrowerBorrowInfo.borrowedAmount * 
                (borrowMarket.borrowIndex - borrowerBorrowInfo.borrowIndex)) / 1e18;
            borrowerBorrowInfo.borrowedAmount += accruedInterest;
        }

        if (borrowerCollateralInfo.suppliedAmount > 0) {
            uint256 accruedInterest = (borrowerCollateralInfo.suppliedAmount * 
                (collateralMarket.supplyIndex - borrowerCollateralInfo.supplyIndex)) / 1e18;
            borrowerCollateralInfo.suppliedAmount += accruedInterest;
        }

        require(borrowerBorrowInfo.borrowedAmount >= repayAmount, "Repay amount too high");

        // Calculate collateral to seize
        uint256 collateralPrice = getAssetPrice(collateralAsset);
        uint256 borrowPrice = getAssetPrice(borrowAsset);
        uint256 collateralAmount = (repayAmount * borrowPrice * (1e18 + LIQUIDATION_BONUS)) / 
            (collateralPrice * 1e18);

        require(borrowerCollateralInfo.suppliedAmount >= collateralAmount, "Insufficient collateral");

        // Update positions
        borrowerBorrowInfo.borrowedAmount -= repayAmount;
        borrowerBorrowInfo.borrowIndex = borrowMarket.borrowIndex;
        
        borrowerCollateralInfo.suppliedAmount -= collateralAmount;
        borrowerCollateralInfo.supplyIndex = collateralMarket.supplyIndex;

        // Update market totals
        borrowMarket.totalBorrow -= repayAmount;
        collateralMarket.totalSupply -= collateralAmount;

        // Transfer tokens
        IERC20(borrowAsset).safeTransferFrom(msg.sender, address(this), repayAmount);
        IERC20(collateralAsset).safeTransfer(msg.sender, collateralAmount);

        // Record liquidation
        liquidations.push(LiquidationInfo({
            liquidator: msg.sender,
            borrower: borrower,
            collateralAsset: collateralAsset,
            borrowAsset: borrowAsset,
            repayAmount: repayAmount,
            collateralAmount: collateralAmount,
            timestamp: block.timestamp
        }));

        liquidationCount[borrower]++;

        emit Liquidation(msg.sender, borrower, collateralAsset, borrowAsset, repayAmount, collateralAmount);
    }

    /**
     * @dev Accrue interest for a market
     */
    function accrueInterest(address token) public marketExists(token) {
        Market storage market = markets[token];
        uint256 currentTimestamp = block.timestamp;
        uint256 deltaTime = currentTimestamp - market.lastUpdateTimestamp;

        if (deltaTime == 0) return;

        uint256 borrowRate = getBorrowRate(token);
        uint256 supplyRate = getSupplyRate(token, borrowRate);

        // Update indices
        market.borrowIndex = market.borrowIndex + (market.borrowIndex * borrowRate * deltaTime) / (365 days * 1e18);
        market.supplyIndex = market.supplyIndex + (market.supplyIndex * supplyRate * deltaTime) / (365 days * 1e18);
        market.lastUpdateTimestamp = currentTimestamp;

        // Accrue reserves
        uint256 reserveIncrease = (market.totalBorrow * borrowRate * deltaTime * market.reserveFactor) / 
            (365 days * 1e18 * 1e18);
        reserves[token] += reserveIncrease;

        emit InterestAccrued(token, market.borrowIndex, market.supplyIndex);
    }

    /**
     * @dev Calculate borrow interest rate
     */
    function getBorrowRate(address token) public view returns (uint256) {
        Market storage market = markets[token];
        
        if (market.totalSupply == 0) return INTEREST_RATE_BASE;
        
        uint256 utilizationRate = (market.totalBorrow * 1e18) / market.totalSupply;
        
        if (utilizationRate <= UTILIZATION_RATE_OPTIMAL) {
            return INTEREST_RATE_BASE + (utilizationRate * INTEREST_RATE_SLOPE1) / 1e18;
        } else {
            uint256 excessUtilization = utilizationRate - UTILIZATION_RATE_OPTIMAL;
            return INTEREST_RATE_BASE + INTEREST_RATE_SLOPE1 + 
                (excessUtilization * INTEREST_RATE_SLOPE2) / 1e18;
        }
    }

    /**
     * @dev Calculate supply interest rate
     */
    function getSupplyRate(address token, uint256 borrowRate) public view returns (uint256) {
        Market storage market = markets[token];
        
        if (market.totalSupply == 0) return 0;
        
        uint256 utilizationRate = (market.totalBorrow * 1e18) / market.totalSupply;
        return (utilizationRate * borrowRate * (1e18 - market.reserveFactor)) / (1e18 * 1e18);
    }

    /**
     * @dev Get account liquidity
     */
    function getAccountLiquidity(
        address account,
        address excludeToken,
        uint256 redeemTokens,
        uint256 borrowAmount
    ) public view returns (int256) {
        uint256 collateralValue = 0;
        uint256 borrowValue = 0;

        address[] memory userMarketList = userMarkets[account];
        
        for (uint256 i = 0; i < userMarketList.length; i++) {
            address token = userMarketList[i];
            Market storage market = markets[token];
            UserInfo storage user = userInfo[token][account];
            
            uint256 assetPrice = getAssetPrice(token);
            
            // Calculate collateral value
            if (market.canUseAsCollateral && user.suppliedAmount > 0) {
                uint256 suppliedAmount = user.suppliedAmount;
                if (token == excludeToken) {
                    suppliedAmount = suppliedAmount > redeemTokens ? suppliedAmount - redeemTokens : 0;
                }
                collateralValue += (suppliedAmount * assetPrice * market.collateralFactor) / (1e18 * 1e18);
            }
            
            // Calculate borrow value
            if (user.borrowedAmount > 0) {
                uint256 borrowedAmount = user.borrowedAmount;
                if (token == excludeToken) {
                    borrowedAmount += borrowAmount;
                }
                borrowValue += (borrowedAmount * assetPrice) / 1e18;
            }
        }

        return int256(collateralValue) - int256(borrowValue);
    }

    /**
     * @dev Update asset price
     */
    function updatePrice(address token, uint256 price) external onlyRole(ORACLE_ROLE) {
        require(price > 0, "Invalid price");
        assetPrices[token] = price;
        emit PriceUpdated(token, price);
    }

    /**
     * @dev Get asset price
     */
    function getAssetPrice(address token) public view returns (uint256) {
        uint256 price = assetPrices[token];
        require(price > 0, "Price not available");
        return price;
    }

    /**
     * @dev Get user account information
     */
    function getAccountSnapshot(address account, address token) 
        external 
        view 
        returns (uint256 supplied, uint256 borrowed, uint256 borrowIndex, uint256 supplyIndex) 
    {
        UserInfo storage user = userInfo[token][account];
        Market storage market = markets[token];
        
        supplied = user.suppliedAmount;
        borrowed = user.borrowedAmount;
        borrowIndex = market.borrowIndex;
        supplyIndex = market.supplyIndex;
    }

    /**
     * @dev Get all markets
     */
    function getAllMarkets() external view returns (address[] memory) {
        return allMarkets;
    }

    /**
     * @dev Get user markets
     */
    function getUserMarkets(address user) external view returns (address[] memory) {
        return userMarkets[user];
    }

    /**
     * @dev Get market utilization rate
     */
    function getUtilizationRate(address token) external view returns (uint256) {
        Market storage market = markets[token];
        if (market.totalSupply == 0) return 0;
        return (market.totalBorrow * 1e18) / market.totalSupply;
    }

    /**
     * @dev Withdraw reserves
     */
    function withdrawReserves(address token, uint256 amount) external onlyRole(ADMIN_ROLE) {
        require(reserves[token] >= amount, "Insufficient reserves");
        reserves[token] -= amount;
        IERC20(token).safeTransfer(protocolFeeRecipient, amount);
    }

    /**
     * @dev Set protocol fee recipient
     */
    function setProtocolFeeRecipient(address _protocolFeeRecipient) external onlyRole(ADMIN_ROLE) {
        require(_protocolFeeRecipient != address(0), "Zero address");
        protocolFeeRecipient = _protocolFeeRecipient;
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
     * @dev Emergency withdraw
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        IERC20(token).safeTransfer(msg.sender, amount);
    }
}