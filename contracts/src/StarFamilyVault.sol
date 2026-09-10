// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IAqua } from "./interfaces/IAqua.sol";
import { IStarRegistry } from "./interfaces/IStarRegistry.sol";
import { IStarToken } from "./interfaces/IStarToken.sol";

contract StarFamilyVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant USDC_PER_STAR = 1_000_000;

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
    }

    uint256 public immutable familyId;
    IERC20 public immutable usdc;
    IERC20 public immutable weth;
    IStarRegistry public immutable registry;
    IStarToken public immutable star;
    IAqua public immutable aqua;
    address public immutable swapVmApp;
    uint256 public nextRewardId = 1;

    FamilyAccount private familyAccount;
    mapping(uint256 childId => uint256 amount) public principalContributedByChild;

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

    constructor(
        uint256 familyId_,
        address usdcAddress,
        address wethAddress,
        address registryAddress,
        address starAddress,
        address aquaAddress,
        address swapVmAddress
    ) {
        if (familyId_ == 0) revert InvalidFamilyId();
        if (
            usdcAddress == address(0) || wethAddress == address(0) || registryAddress == address(0)
                || starAddress == address(0) || aquaAddress == address(0)
                || swapVmAddress == address(0)
        ) revert ZeroAddress();
        IStarRegistry(registryAddress).getFamily(familyId_);
        uint8 usdcDecimals = IERC20Metadata(usdcAddress).decimals();
        if (usdcDecimals != 6) revert InvalidUsdcDecimals(usdcDecimals);
        uint8 wethDecimals = IERC20Metadata(wethAddress).decimals();
        if (wethDecimals != 18) revert InvalidWethDecimals(wethDecimals);

        familyId = familyId_;
        usdc = IERC20(usdcAddress);
        weth = IERC20(wethAddress);
        registry = IStarRegistry(registryAddress);
        star = IStarToken(starAddress);
        aqua = IAqua(aquaAddress);
        swapVmApp = swapVmAddress;

        IERC20(usdcAddress).forceApprove(aquaAddress, type(uint256).max);
        IERC20(wethAddress).forceApprove(aquaAddress, type(uint256).max);
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
        return _shipSavingsPosition(strategy, usdcAmount, wethAmount);
    }

    function replaceSavingsPosition(bytes calldata strategy, uint256 usdcAmount, uint256 wethAmount)
        external
        nonReentrant
        returns (bytes32 oldStrategyHash, bytes32 newStrategyHash)
    {
        _requireActiveParent(msg.sender);
        oldStrategyHash = _dockSavingsPosition();
        newStrategyHash = _shipSavingsPosition(strategy, usdcAmount, wethAmount);
    }

    function dockSavingsPosition() external nonReentrant {
        _requireParent(msg.sender);
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

    function _shipSavingsPosition(bytes calldata strategy, uint256 usdcAmount, uint256 wethAmount)
        private
        returns (bytes32 strategyHash)
    {
        if (strategy.length == 0) revert InvalidStrategy();
        if (familyAccount.positionActive) {
            revert PositionAlreadyActive(familyAccount.strategyHash);
        }
        if (usdcAmount == 0 || wethAmount == 0) revert ZeroAmount();
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
        strategyHash = aqua.ship(swapVmApp, strategy, tokens, amounts);

        familyAccount.availableUsdc -= usdcAmount;
        familyAccount.availableWeth -= wethAmount;
        familyAccount.positionOpeningUsdc = usdcAmount;
        familyAccount.positionOpeningWeth = wethAmount;
        familyAccount.strategyHash = strategyHash;
        familyAccount.positionActive = true;
        emit SavingsPositionUpdated(familyId, strategyHash, usdcAmount, wethAmount, true);
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
        emit SavingsPositionUpdated(familyId, strategyHash, currentUsdc, currentWeth, false);
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

    function _positionTokens() private view returns (address[] memory tokens) {
        tokens = new address[](2);
        tokens[0] = address(usdc);
        tokens[1] = address(weth);
    }
}
