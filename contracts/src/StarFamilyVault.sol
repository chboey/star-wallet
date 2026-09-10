// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IAqua } from "./interfaces/IAqua.sol";
import { IChainlinkAggregatorV3 } from "./interfaces/IChainlinkAggregatorV3.sol";
import { IStarRegistry } from "./interfaces/IStarRegistry.sol";
import { IStarToken } from "./interfaces/IStarToken.sol";

contract StarFamilyVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant USDC_PER_STAR = 1_000_000;
    // Hook-free Aqua order: four hook end offsets follow the 40-byte token pair.
    uint256 public constant DEFAULT_AQUA_MAKER_TRAITS =
        (uint256(1) << 254) | (uint256(0x0028002800280028) << 160);
    uint256 public constant MAX_STRATEGY_BYTES = 4_096;
    uint16 public constant MAX_STRATEGY_FEE_BPS = 1_000;
    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint16 public constant MAX_PRICE_DEVIATION_BPS_LIMIT = 2_500;
    uint40 public constant MIN_STRATEGY_LIFETIME_SECONDS = 60;
    uint40 public constant MAX_STRATEGY_LIFETIME_LIMIT_SECONDS = 1 days;
    uint32 public constant MAX_ORACLE_AGE_LIMIT_SECONDS = 7 days;

    uint256 private constant CONCENTRATED_PROGRAM_LENGTH = 83;
    uint256 private constant CONCENTRATED_PROGRAM_WITH_FEE_LENGTH = 88;
    uint32 private constant FLAT_FEE_UNITS_PER_BPS = 1_000;
    bytes1 private constant DEADLINE_OPCODE = 0x20;
    bytes1 private constant CONCENTRATE_OPCODE = 0x51;
    bytes1 private constant FLAT_FEE_OPCODE = 0x70;
    bytes1 private constant SALT_OPCODE = 0x02;

    struct SwapVmOrder {
        address maker;
        uint256 traits;
        bytes data;
    }

    struct AquaSafetyConfig {
        address ethUsdFeed;
        address usdcUsdFeed;
        uint32 ethUsdMaxAgeSeconds;
        uint32 usdcUsdMaxAgeSeconds;
        uint16 maxStrategyPriceDeviationBps;
        uint40 maxStrategyLifetimeSeconds;
        uint256 maxPositionUsdc;
        uint256 maxPositionWeth;
    }

    struct StrategyParameters {
        uint256 sqrtPriceMin;
        uint256 sqrtPriceMax;
        uint16 feeBps;
        uint64 salt;
        uint40 deadline;
        uint256 oracleRawPrice;
    }

    struct FamilyAccount {
        uint256 totalPrincipalContributed;
        uint256 totalPrincipalWithdrawn;
        uint256 availableUsdc;
        uint256 availableWeth;
        uint256 positionOpeningUsdc;
        uint256 positionOpeningWeth;
        bytes32 strategyHash;
        bool positionActive;
        uint256 totalUsdcWithdrawn;
        uint256 totalWethWithdrawn;
        uint256 positionSqrtPriceMin;
        uint256 positionSqrtPriceMax;
        uint16 positionFeeBps;
        uint64 positionSalt;
        uint40 positionDeadline;
        uint256 positionOracleRawPrice;
    }

    uint256 public immutable familyId;
    IERC20 public immutable usdc;
    IERC20 public immutable weth;
    IStarRegistry public immutable registry;
    IStarToken public immutable star;
    IAqua public immutable aqua;
    address public immutable swapVmApp;
    address public immutable emergencyAdmin;
    IChainlinkAggregatorV3 public immutable ethUsdFeed;
    IChainlinkAggregatorV3 public immutable usdcUsdFeed;
    uint8 public immutable ethUsdFeedDecimals;
    uint8 public immutable usdcUsdFeedDecimals;
    uint32 public immutable ethUsdMaxAgeSeconds;
    uint32 public immutable usdcUsdMaxAgeSeconds;
    uint16 public immutable maxStrategyPriceDeviationBps;
    uint40 public immutable maxStrategyLifetimeSeconds;
    uint256 public immutable maxPositionUsdc;
    uint256 public immutable maxPositionWeth;
    bool public aquaPaused;
    uint256 public nextRewardId = 1;

    FamilyAccount private familyAccount;
    mapping(uint256 childId => uint256 amount) public principalContributedByChild;
    mapping(bytes32 strategyHash => bool used) public strategyHashUsed;

    error ZeroAddress();
    error InvalidFamilyId();
    error InvalidUsdcDecimals(uint8 decimals);
    error InvalidWethDecimals(uint8 decimals);
    error ZeroAmount();
    error InvalidReason();
    error NotFamilyParent(uint256 familyId, address account);
    error FamilyInactive(uint256 familyId);
    error ChildInactive(uint256 childId);
    error ChildNotInFamily(uint256 childId, uint256 expectedFamilyId, uint256 actualFamilyId);
    error InvalidRecipient();
    error InsufficientAvailableUsdc(uint256 available, uint256 requested);
    error InsufficientAvailableWeth(uint256 available, uint256 requested);
    error PositionAlreadyActive(bytes32 strategyHash);
    error PositionNotActive();
    error InvalidStrategy();
    error InvalidStrategyProgram();
    error InvalidStrategyTokens();
    error InvalidStrategyPriceRange(uint256 sqrtPriceMin, uint256 sqrtPriceMax);
    error InvalidStrategyFee(uint256 feeBps);
    error InvalidStrategySalt();
    error InvalidStrategyDeadline(uint256 deadline, uint256 currentTimestamp);
    error StrategyDeadlineTooFar(uint256 deadline, uint256 maximumDeadline);
    error StrategyPriceOutsideOracleBounds(
        uint256 rawPriceMin,
        uint256 oracleRawPrice,
        uint256 rawPriceMax,
        uint256 minimumAllowed,
        uint256 maximumAllowed
    );
    error InvalidStrategyMaker(address expected, address actual);
    error InvalidStrategyTraits(uint256 expected, uint256 actual);
    error StrategyHashAlreadyUsed(bytes32 strategyHash);
    error StrategyHashMismatch(bytes32 expected, bytes32 actual);
    error NotEmergencyAdmin(address account);
    error AquaOperationsPaused();
    error AquaOperationsNotPaused();
    error AquaPauseStateUnchanged(bool paused);
    error PositionMustBeDockedBeforeUnpause(bytes32 strategyHash);
    error InvalidSafetyConfiguration();
    error InvalidTokenOrder(address tokenLt, address tokenGt);
    error InvalidOracleDecimals(address feed, uint8 decimals);
    error InvalidOracleRound(address feed, uint80 roundId, uint80 answeredInRound);
    error InvalidOracleAnswer(address feed, int256 answer);
    error InvalidOracleTimestamp(address feed, uint256 updatedAt, uint256 currentTimestamp);
    error StaleOraclePrice(address feed, uint256 updatedAt, uint256 maximumAge);
    error PositionUsdcLimitExceeded(uint256 requested, uint256 maximum);
    error PositionWethLimitExceeded(uint256 requested, uint256 maximum);

    event StarsRewarded(
        uint256 indexed rewardId,
        uint256 indexed childId,
        uint256 stars,
        uint256 principalUsdc,
        string reason
    );
    event PrincipalContributed(uint256 indexed familyId, uint256 indexed childId, uint256 amount);
    event SavingsUsdcWithdrawn(
        uint256 indexed familyId, uint256 amount, uint256 principalAmount, address indexed recipient
    );
    event StrategyWethFunded(uint256 indexed familyId, uint256 amount);
    event StrategyWethWithdrawn(
        uint256 indexed familyId, uint256 amount, address indexed recipient
    );
    event SavingsPositionUpdated(
        uint256 indexed familyId,
        bytes32 indexed strategyHash,
        uint256 usdcAmount,
        uint256 wethAmount,
        bool active
    );
    event SavingsStrategyConfigured(
        uint256 indexed familyId,
        bytes32 indexed strategyHash,
        uint256 sqrtPriceMin,
        uint256 sqrtPriceMax,
        uint16 feeBps,
        uint64 salt,
        uint40 deadline,
        uint256 oracleRawPrice
    );
    event SavingsPositionToppedUp(
        uint256 indexed familyId,
        bytes32 indexed strategyHash,
        uint256 usdcAmount,
        uint256 wethAmount
    );
    event AquaPauseUpdated(address indexed emergencyAdmin, bool paused);

    constructor(
        uint256 familyId_,
        address usdcAddress,
        address wethAddress,
        address registryAddress,
        address starAddress,
        address aquaAddress,
        address swapVmAddress,
        address emergencyAdminAddress,
        AquaSafetyConfig memory safety
    ) {
        if (familyId_ == 0) revert InvalidFamilyId();
        if (
            usdcAddress == address(0) || wethAddress == address(0) || registryAddress == address(0)
                || starAddress == address(0) || aquaAddress == address(0)
                || swapVmAddress == address(0) || emergencyAdminAddress == address(0)
                || safety.ethUsdFeed == address(0) || safety.usdcUsdFeed == address(0)
        ) revert ZeroAddress();
        IStarRegistry(registryAddress).getFamily(familyId_);
        uint8 usdcDecimals = IERC20Metadata(usdcAddress).decimals();
        if (usdcDecimals != 6) revert InvalidUsdcDecimals(usdcDecimals);
        uint8 wethDecimals = IERC20Metadata(wethAddress).decimals();
        if (wethDecimals != 18) revert InvalidWethDecimals(wethDecimals);
        if (wethAddress == usdcAddress) revert InvalidTokenOrder(wethAddress, usdcAddress);
        if (
            safety.ethUsdMaxAgeSeconds == 0 || safety.usdcUsdMaxAgeSeconds == 0
                || safety.ethUsdMaxAgeSeconds > MAX_ORACLE_AGE_LIMIT_SECONDS
                || safety.usdcUsdMaxAgeSeconds > MAX_ORACLE_AGE_LIMIT_SECONDS
                || safety.maxStrategyPriceDeviationBps == 0
                || safety.maxStrategyPriceDeviationBps > MAX_PRICE_DEVIATION_BPS_LIMIT
                || safety.maxStrategyLifetimeSeconds < MIN_STRATEGY_LIFETIME_SECONDS
                || safety.maxStrategyLifetimeSeconds > MAX_STRATEGY_LIFETIME_LIMIT_SECONDS
                || safety.maxPositionUsdc == 0 || safety.maxPositionWeth == 0
        ) revert InvalidSafetyConfiguration();

        uint8 ethFeedDecimals = IChainlinkAggregatorV3(safety.ethUsdFeed).decimals();
        uint8 usdcFeedDecimals = IChainlinkAggregatorV3(safety.usdcUsdFeed).decimals();
        if (ethFeedDecimals > 18) {
            revert InvalidOracleDecimals(safety.ethUsdFeed, ethFeedDecimals);
        }
        if (usdcFeedDecimals > 18) {
            revert InvalidOracleDecimals(safety.usdcUsdFeed, usdcFeedDecimals);
        }

        familyId = familyId_;
        usdc = IERC20(usdcAddress);
        weth = IERC20(wethAddress);
        registry = IStarRegistry(registryAddress);
        star = IStarToken(starAddress);
        aqua = IAqua(aquaAddress);
        swapVmApp = swapVmAddress;
        emergencyAdmin = emergencyAdminAddress;
        ethUsdFeed = IChainlinkAggregatorV3(safety.ethUsdFeed);
        usdcUsdFeed = IChainlinkAggregatorV3(safety.usdcUsdFeed);
        ethUsdFeedDecimals = ethFeedDecimals;
        usdcUsdFeedDecimals = usdcFeedDecimals;
        ethUsdMaxAgeSeconds = safety.ethUsdMaxAgeSeconds;
        usdcUsdMaxAgeSeconds = safety.usdcUsdMaxAgeSeconds;
        maxStrategyPriceDeviationBps = safety.maxStrategyPriceDeviationBps;
        maxStrategyLifetimeSeconds = safety.maxStrategyLifetimeSeconds;
        maxPositionUsdc = safety.maxPositionUsdc;
        maxPositionWeth = safety.maxPositionWeth;

        IERC20(usdcAddress).forceApprove(aquaAddress, type(uint256).max);
        IERC20(wethAddress).forceApprove(aquaAddress, type(uint256).max);
        emit AquaPauseUpdated(emergencyAdminAddress, false);
    }

    function rewardStars(uint256 childId, uint256 amount, string calldata reason)
        external
        nonReentrant
        returns (uint256 rewardId)
    {
        _requireActiveParent(msg.sender);
        IStarRegistry.Child memory child = registry.getChild(childId);
        if (child.familyId != familyId) {
            revert ChildNotInFamily(childId, familyId, child.familyId);
        }
        if (!child.active) revert ChildInactive(childId);
        if (amount == 0) revert ZeroAmount();
        uint256 reasonLength = bytes(reason).length;
        if (reasonLength == 0 || reasonLength > 128) revert InvalidReason();

        uint256 principalUsdc = amount * USDC_PER_STAR;
        usdc.safeTransferFrom(msg.sender, address(this), principalUsdc);

        familyAccount.totalPrincipalContributed += principalUsdc;
        familyAccount.availableUsdc += principalUsdc;
        principalContributedByChild[childId] += principalUsdc;
        star.mint(child.wallet, amount);

        rewardId = nextRewardId++;
        emit PrincipalContributed(familyId, childId, principalUsdc);
        emit StarsRewarded(rewardId, childId, amount, principalUsdc, reason);
    }

    function withdrawSavings(uint256 amount, address recipient) external nonReentrant {
        _requireParent(msg.sender);
        if (amount == 0) revert ZeroAmount();
        if (recipient == address(0)) revert InvalidRecipient();
        if (familyAccount.availableUsdc < amount) {
            revert InsufficientAvailableUsdc(familyAccount.availableUsdc, amount);
        }
        uint256 remainingPrincipal =
            familyAccount.totalPrincipalContributed - familyAccount.totalPrincipalWithdrawn;
        uint256 principalAmount = amount < remainingPrincipal ? amount : remainingPrincipal;
        familyAccount.availableUsdc -= amount;
        familyAccount.totalPrincipalWithdrawn += principalAmount;
        familyAccount.totalUsdcWithdrawn += amount;
        usdc.safeTransfer(recipient, amount);
        emit SavingsUsdcWithdrawn(familyId, amount, principalAmount, recipient);
    }

    function fundStrategyWeth(uint256 amount) external nonReentrant {
        _requireActiveParent(msg.sender);
        if (amount == 0) revert ZeroAmount();
        weth.safeTransferFrom(msg.sender, address(this), amount);
        familyAccount.availableWeth += amount;
        emit StrategyWethFunded(familyId, amount);
    }

    function withdrawStrategyWeth(uint256 amount, address recipient) external nonReentrant {
        _requireParent(msg.sender);
        if (amount == 0) revert ZeroAmount();
        if (recipient == address(0)) revert InvalidRecipient();
        if (familyAccount.availableWeth < amount) {
            revert InsufficientAvailableWeth(familyAccount.availableWeth, amount);
        }
        familyAccount.availableWeth -= amount;
        familyAccount.totalWethWithdrawn += amount;
        weth.safeTransfer(recipient, amount);
        emit StrategyWethWithdrawn(familyId, amount, recipient);
    }

    function shipSavingsPosition(bytes calldata strategy, uint256 usdcAmount, uint256 wethAmount)
        external
        nonReentrant
        returns (bytes32 strategyHash)
    {
        _requireActiveParent(msg.sender);
        _requireAquaActive();
        return _shipSavingsPosition(strategy, usdcAmount, wethAmount);
    }

    function replaceSavingsPosition(bytes calldata strategy, uint256 usdcAmount, uint256 wethAmount)
        external
        nonReentrant
        returns (bytes32 oldStrategyHash, bytes32 newStrategyHash)
    {
        _requireActiveParent(msg.sender);
        _requireAquaActive();
        oldStrategyHash = _dockSavingsPosition();
        newStrategyHash = _shipSavingsPosition(strategy, usdcAmount, wethAmount);
    }

    /// @notice Capability marker; older, immutable vaults do not support this flow.
    function savingsTopUpsVersion() external pure returns (uint256) {
        return 1;
    }

    /// @notice Allocate idle vault funds to the same Aqua strategy. No new Stars or principal.
    /// @dev A single token may be added. The immutable price range and deadline do not change.
    function addToSavingsPosition(
        bytes32 expectedStrategyHash,
        uint256 usdcAmount,
        uint256 wethAmount
    ) external nonReentrant {
        _requireActiveParent(msg.sender);
        _requireAquaActive();
        if (!familyAccount.positionActive) revert PositionNotActive();
        if (expectedStrategyHash != familyAccount.strategyHash) {
            revert StrategyHashMismatch(expectedStrategyHash, familyAccount.strategyHash);
        }
        if (familyAccount.positionDeadline <= block.timestamp) {
            revert InvalidStrategyDeadline(familyAccount.positionDeadline, block.timestamp);
        }
        if (usdcAmount == 0 && wethAmount == 0) revert ZeroAmount();
        _validateStrategyPrices(
            familyAccount.positionSqrtPriceMin, familyAccount.positionSqrtPriceMax
        );
        if (usdcAmount > familyAccount.availableUsdc) {
            revert InsufficientAvailableUsdc(familyAccount.availableUsdc, usdcAmount);
        }
        if (wethAmount > familyAccount.availableWeth) {
            revert InsufficientAvailableWeth(familyAccount.availableWeth, wethAmount);
        }
        (uint256 currentUsdc, uint256 currentWeth) = aqua.safeBalances(
            address(this), swapVmApp, expectedStrategyHash, address(usdc), address(weth)
        );
        // Exposure is based on current Aqua holdings, including swaps and external pushes.
        if (currentUsdc + usdcAmount > maxPositionUsdc) {
            revert PositionUsdcLimitExceeded(currentUsdc + usdcAmount, maxPositionUsdc);
        }
        if (currentWeth + wethAmount > maxPositionWeth) {
            revert PositionWethLimitExceeded(currentWeth + wethAmount, maxPositionWeth);
        }
        familyAccount.availableUsdc -= usdcAmount;
        familyAccount.availableWeth -= wethAmount;
        // Aqua is non-custodial: transferFrom(vault, vault, amount) leaves physical holdings
        // unchanged while increasing its virtual allocation. All pushes revert atomically.
        if (usdcAmount != 0) {
            aqua.push(address(this), swapVmApp, expectedStrategyHash, address(usdc), usdcAmount);
        }
        if (wethAmount != 0) {
            aqua.push(address(this), swapVmApp, expectedStrategyHash, address(weth), wethAmount);
        }
        // Indexers debit available inventory here; Aqua's Pushed logs credit the position.
        emit SavingsPositionToppedUp(familyId, expectedStrategyHash, usdcAmount, wethAmount);
    }

    function dockSavingsPosition() external nonReentrant {
        _requireParent(msg.sender);
        _dockSavingsPosition();
    }

    function setAquaPaused(bool paused) external nonReentrant {
        if (msg.sender != emergencyAdmin) revert NotEmergencyAdmin(msg.sender);
        if (aquaPaused == paused) revert AquaPauseStateUnchanged(paused);
        if (!paused && familyAccount.positionActive) {
            revert PositionMustBeDockedBeforeUnpause(familyAccount.strategyHash);
        }

        aquaPaused = paused;
        uint256 allowance = paused ? 0 : type(uint256).max;
        usdc.forceApprove(address(aqua), allowance);
        weth.forceApprove(address(aqua), allowance);
        emit AquaPauseUpdated(msg.sender, paused);
    }

    function emergencyDockSavingsPosition() external nonReentrant {
        if (msg.sender != emergencyAdmin) revert NotEmergencyAdmin(msg.sender);
        if (!aquaPaused) revert AquaOperationsNotPaused();
        _dockSavingsPosition();
    }

    function getFamilyAccount() external view returns (FamilyAccount memory) {
        return familyAccount;
    }

    function netPrincipal() external view returns (uint256) {
        return familyAccount.totalPrincipalContributed - familyAccount.totalPrincipalWithdrawn;
    }

    function currentPositionBalances()
        external
        view
        returns (uint256 currentUsdc, uint256 currentWeth)
    {
        if (!familyAccount.positionActive) revert PositionNotActive();
        return aqua.safeBalances(
            address(this), swapVmApp, familyAccount.strategyHash, address(usdc), address(weth)
        );
    }

    function inspectSavingsStrategy(bytes calldata strategy)
        external
        view
        returns (StrategyParameters memory)
    {
        return _validateStrategy(strategy);
    }

    function currentOracleRawPrice() public view returns (uint256 rawPrice) {
        uint256 ethUsd18 = _freshUsdPrice18(ethUsdFeed, ethUsdFeedDecimals, ethUsdMaxAgeSeconds);
        uint256 usdcUsd18 = _freshUsdPrice18(usdcUsdFeed, usdcUsdFeedDecimals, usdcUsdMaxAgeSeconds);
        // SwapVM prices are tokenGt units / tokenLt units, scaled by 1e18.
        // Sepolia USDC sorts before WETH: invert the USD ratio and account for
        // 6/18 token decimals directly, without inverting a rounded price.
        rawPrice = address(usdc) < address(weth)
            ? Math.mulDiv(usdcUsd18, 1e30, ethUsd18)
            : Math.mulDiv(ethUsd18, 1e6, usdcUsd18);
        if (rawPrice == 0) revert InvalidSafetyConfiguration();
    }

    function _shipSavingsPosition(bytes calldata strategy, uint256 usdcAmount, uint256 wethAmount)
        private
        returns (bytes32 strategyHash)
    {
        StrategyParameters memory parameters = _validateStrategy(strategy);
        if (familyAccount.positionActive) {
            revert PositionAlreadyActive(familyAccount.strategyHash);
        }
        if (usdcAmount == 0 || wethAmount == 0) revert ZeroAmount();
        if (usdcAmount > maxPositionUsdc) {
            revert PositionUsdcLimitExceeded(usdcAmount, maxPositionUsdc);
        }
        if (wethAmount > maxPositionWeth) {
            revert PositionWethLimitExceeded(wethAmount, maxPositionWeth);
        }
        if (familyAccount.availableUsdc < usdcAmount) {
            revert InsufficientAvailableUsdc(familyAccount.availableUsdc, usdcAmount);
        }
        if (familyAccount.availableWeth < wethAmount) {
            revert InsufficientAvailableWeth(familyAccount.availableWeth, wethAmount);
        }

        address[] memory tokens = _positionTokens();
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = usdcAmount;
        amounts[1] = wethAmount;
        bytes32 expectedHash = keccak256(strategy);
        if (strategyHashUsed[expectedHash]) revert StrategyHashAlreadyUsed(expectedHash);
        strategyHash = aqua.ship(swapVmApp, strategy, tokens, amounts);
        if (strategyHash != expectedHash) {
            revert StrategyHashMismatch(expectedHash, strategyHash);
        }

        familyAccount.availableUsdc -= usdcAmount;
        familyAccount.availableWeth -= wethAmount;
        familyAccount.positionOpeningUsdc = usdcAmount;
        familyAccount.positionOpeningWeth = wethAmount;
        familyAccount.strategyHash = strategyHash;
        familyAccount.positionActive = true;
        familyAccount.positionSqrtPriceMin = parameters.sqrtPriceMin;
        familyAccount.positionSqrtPriceMax = parameters.sqrtPriceMax;
        familyAccount.positionFeeBps = parameters.feeBps;
        familyAccount.positionSalt = parameters.salt;
        familyAccount.positionDeadline = parameters.deadline;
        familyAccount.positionOracleRawPrice = parameters.oracleRawPrice;
        strategyHashUsed[strategyHash] = true;
        emit SavingsPositionUpdated(familyId, strategyHash, usdcAmount, wethAmount, true);
        emit SavingsStrategyConfigured(
            familyId,
            strategyHash,
            parameters.sqrtPriceMin,
            parameters.sqrtPriceMax,
            parameters.feeBps,
            parameters.salt,
            parameters.deadline,
            parameters.oracleRawPrice
        );
    }

    function _dockSavingsPosition() private returns (bytes32 strategyHash) {
        if (!familyAccount.positionActive) revert PositionNotActive();

        strategyHash = familyAccount.strategyHash;
        (uint256 currentUsdc, uint256 currentWeth) = aqua.safeBalances(
            address(this), swapVmApp, strategyHash, address(usdc), address(weth)
        );
        aqua.dock(swapVmApp, strategyHash, _positionTokens());

        familyAccount.availableUsdc += currentUsdc;
        familyAccount.availableWeth += currentWeth;
        familyAccount.positionOpeningUsdc = 0;
        familyAccount.positionOpeningWeth = 0;
        familyAccount.strategyHash = bytes32(0);
        familyAccount.positionActive = false;
        familyAccount.positionSqrtPriceMin = 0;
        familyAccount.positionSqrtPriceMax = 0;
        familyAccount.positionFeeBps = 0;
        familyAccount.positionSalt = 0;
        familyAccount.positionDeadline = 0;
        familyAccount.positionOracleRawPrice = 0;
        emit SavingsPositionUpdated(familyId, strategyHash, currentUsdc, currentWeth, false);
    }

    function _validateStrategy(bytes calldata strategy)
        private
        view
        returns (StrategyParameters memory parameters)
    {
        if (strategy.length < 192 || strategy.length > MAX_STRATEGY_BYTES) {
            revert InvalidStrategy();
        }
        SwapVmOrder memory order = abi.decode(strategy, (SwapVmOrder));
        if (keccak256(strategy) != keccak256(abi.encode(order))) revert InvalidStrategy();
        if (order.maker != address(this)) {
            revert InvalidStrategyMaker(address(this), order.maker);
        }
        if (order.traits != DEFAULT_AQUA_MAKER_TRAITS) {
            revert InvalidStrategyTraits(DEFAULT_AQUA_MAKER_TRAITS, order.traits);
        }
        if (order.data.length < 40) revert InvalidStrategyTokens();
        bytes memory data = order.data;
        address tokenA;
        address tokenB;
        assembly ("memory-safe") {
            tokenA := shr(96, mload(add(data, 32)))
            tokenB := shr(96, mload(add(data, 52)))
        }
        (address tokenLt, address tokenGt) = address(usdc) < address(weth)
            ? (address(usdc), address(weth))
            : (address(weth), address(usdc));
        if (tokenA != tokenLt || tokenB != tokenGt) revert InvalidStrategyTokens();
        bytes memory program = new bytes(data.length - 40);
        for (uint256 i; i < program.length; ++i) {
            program[i] = data[i + 40];
        }
        return _validateConcentratedProgram(program);
    }

    function _validateConcentratedProgram(bytes memory program)
        private
        view
        returns (StrategyParameters memory parameters)
    {
        bool hasFee = program.length == CONCENTRATED_PROGRAM_WITH_FEE_LENGTH;
        if (!hasFee && program.length != CONCENTRATED_PROGRAM_LENGTH) {
            revert InvalidStrategyProgram();
        }
        if (program[0] != DEADLINE_OPCODE || program[1] != bytes1(uint8(5))) {
            revert InvalidStrategyProgram();
        }
        parameters.deadline = _readUint40(program, 2);
        uint256 maximumDeadline = block.timestamp + maxStrategyLifetimeSeconds;
        if (parameters.deadline < block.timestamp + MIN_STRATEGY_LIFETIME_SECONDS) {
            revert InvalidStrategyDeadline(parameters.deadline, block.timestamp);
        }
        if (parameters.deadline > maximumDeadline) {
            revert StrategyDeadlineTooFar(parameters.deadline, maximumDeadline);
        }

        uint256 concentrateOffset = 7;
        if (hasFee) {
            if (program[7] != FLAT_FEE_OPCODE || program[8] != bytes1(uint8(3))) {
                revert InvalidStrategyProgram();
            }
            uint32 encodedFee = uint32(uint8(program[9])) << 16 | uint32(uint8(program[10])) << 8
                | uint32(uint8(program[11]));
            if (
                encodedFee == 0 || encodedFee % FLAT_FEE_UNITS_PER_BPS != 0
                    || encodedFee / FLAT_FEE_UNITS_PER_BPS > MAX_STRATEGY_FEE_BPS
            ) {
                revert InvalidStrategyFee(encodedFee / FLAT_FEE_UNITS_PER_BPS);
            }
            parameters.feeBps = uint16(encodedFee / FLAT_FEE_UNITS_PER_BPS);
            concentrateOffset = 12;
        }
        if (
            program[concentrateOffset] != CONCENTRATE_OPCODE
                || program[concentrateOffset + 1] != bytes1(uint8(64))
        ) {
            revert InvalidStrategyProgram();
        }

        parameters.sqrtPriceMin = _readUint256(program, concentrateOffset + 2);
        parameters.sqrtPriceMax = _readUint256(program, concentrateOffset + 34);
        if (parameters.sqrtPriceMin == 0 || parameters.sqrtPriceMax <= parameters.sqrtPriceMin) {
            revert InvalidStrategyPriceRange(parameters.sqrtPriceMin, parameters.sqrtPriceMax);
        }
        parameters.oracleRawPrice =
            _validateStrategyPrices(parameters.sqrtPriceMin, parameters.sqrtPriceMax);

        uint256 saltOffset = concentrateOffset + 66;
        if (program[saltOffset] != SALT_OPCODE || program[saltOffset + 1] != bytes1(uint8(8))) {
            revert InvalidStrategyProgram();
        }
        parameters.salt = _readUint64(program, saltOffset + 2);
        if (parameters.salt == 0) revert InvalidStrategySalt();
    }

    function _validateStrategyPrices(uint256 sqrtPriceMin, uint256 sqrtPriceMax)
        private
        view
        returns (uint256 oracleRawPrice)
    {
        uint256 rawPriceMin = Math.mulDiv(sqrtPriceMin, sqrtPriceMin, 1e18);
        uint256 rawPriceMax = Math.mulDiv(sqrtPriceMax, sqrtPriceMax, 1e18);
        oracleRawPrice = currentOracleRawPrice();
        uint256 minimumAllowed = Math.mulDiv(
            oracleRawPrice, BPS_DENOMINATOR - maxStrategyPriceDeviationBps, BPS_DENOMINATOR
        );
        uint256 maximumAllowed = Math.mulDiv(
            oracleRawPrice, BPS_DENOMINATOR + maxStrategyPriceDeviationBps, BPS_DENOMINATOR
        );

        if (
            rawPriceMin > oracleRawPrice || rawPriceMax < oracleRawPrice
                || (rawPriceMin < minimumAllowed && minimumAllowed - rawPriceMin > 1)
                || rawPriceMax > maximumAllowed
        ) {
            revert StrategyPriceOutsideOracleBounds(
                rawPriceMin, oracleRawPrice, rawPriceMax, minimumAllowed, maximumAllowed
            );
        }
    }

    function _freshUsdPrice18(IChainlinkAggregatorV3 feed, uint8 feedDecimals, uint32 maximumAge)
        private
        view
        returns (uint256)
    {
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) =
            feed.latestRoundData();
        if (answer <= 0) revert InvalidOracleAnswer(address(feed), answer);
        if (roundId == 0 || answeredInRound < roundId) {
            revert InvalidOracleRound(address(feed), roundId, answeredInRound);
        }
        if (updatedAt == 0 || updatedAt > block.timestamp) {
            revert InvalidOracleTimestamp(address(feed), updatedAt, block.timestamp);
        }
        if (block.timestamp - updatedAt > maximumAge) {
            revert StaleOraclePrice(address(feed), updatedAt, maximumAge);
        }
        return uint256(answer) * 10 ** (18 - feedDecimals);
    }

    function _readUint256(bytes memory data, uint256 offset) private pure returns (uint256 value) {
        assembly ("memory-safe") {
            value := mload(add(add(data, 0x20), offset))
        }
    }

    function _readUint64(bytes memory data, uint256 offset) private pure returns (uint64 value) {
        assembly ("memory-safe") {
            value := shr(192, mload(add(add(data, 0x20), offset)))
        }
    }

    function _readUint40(bytes memory data, uint256 offset) private pure returns (uint40 value) {
        assembly ("memory-safe") {
            value := shr(216, mload(add(add(data, 0x20), offset)))
        }
    }

    function _requireParent(address account) private view {
        IStarRegistry.Family memory family = registry.getFamily(familyId);
        if (family.parent != account) revert NotFamilyParent(familyId, account);
    }

    function _requireActiveParent(address account) private view {
        _requireParent(account);
        IStarRegistry.Family memory family = registry.getFamily(familyId);
        if (!family.active) revert FamilyInactive(familyId);
    }

    function _requireAquaActive() private view {
        if (aquaPaused) revert AquaOperationsPaused();
    }

    function _positionTokens() private view returns (address[] memory tokens) {
        tokens = new address[](2);
        tokens[0] = address(usdc);
        tokens[1] = address(weth);
    }
}
