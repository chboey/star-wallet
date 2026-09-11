// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IStarRegistry } from "./interfaces/IStarRegistry.sol";
import { IStarToken } from "./interfaces/IStarToken.sol";
import { StarFamilyVault } from "./StarFamilyVault.sol";
import { StarQuestsFactory } from "./StarQuestsFactory.sol";

contract StarFamilyVaultFactory {
    uint16 private constant MAX_PRICE_DEVIATION_BPS_LIMIT = 2_500;
    uint40 private constant MIN_STRATEGY_LIFETIME_SECONDS = 60;
    uint40 private constant MAX_STRATEGY_LIFETIME_LIMIT_SECONDS = 1 days;
    uint32 private constant MAX_ORACLE_AGE_LIMIT_SECONDS = 7 days;

    IStarRegistry public immutable registry;
    StarQuestsFactory public immutable questsFactory;
    IStarToken public immutable star;
    address public immutable usdc;
    address public immutable weth;
    address public immutable aqua;
    address public immutable swapVmApp;
    address public immutable emergencyAdmin;
    address public immutable ethUsdFeed;
    address public immutable usdcUsdFeed;
    uint32 public immutable ethUsdMaxAgeSeconds;
    uint32 public immutable usdcUsdMaxAgeSeconds;
    uint16 public immutable maxStrategyPriceDeviationBps;
    uint40 public immutable maxStrategyLifetimeSeconds;
    uint256 public immutable maxPositionUsdc;
    uint256 public immutable maxPositionWeth;

    mapping(uint256 familyId => address vault) public vaultByFamily;
    mapping(address vault => uint256 familyId) public familyIdByVault;

    error ZeroAddress();
    error InvalidSafetyConfiguration();
    error FamilyInactive(uint256 familyId);
    error NotFamilyParent(uint256 familyId, address account);
    error FamilyVaultAlreadyExists(uint256 familyId, address vault);

    event FamilyVaultCreated(
        uint256 indexed familyId,
        address indexed parent,
        address indexed vault,
        address emergencyAdmin
    );

    constructor(
        address registryAddress,
        address starAddress,
        address usdcAddress,
        address wethAddress,
        address aquaAddress,
        address swapVmAddress,
        address emergencyAdminAddress,
        StarFamilyVault.AquaSafetyConfig memory safety
    ) {
        if (
            registryAddress == address(0) || starAddress == address(0) || usdcAddress == address(0)
                || wethAddress == address(0) || aquaAddress == address(0)
                || swapVmAddress == address(0) || emergencyAdminAddress == address(0)
                || safety.ethUsdFeed == address(0) || safety.usdcUsdFeed == address(0)
        ) revert ZeroAddress();
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

        registry = IStarRegistry(registryAddress);
        questsFactory = new StarQuestsFactory();
        star = IStarToken(starAddress);
        usdc = usdcAddress;
        weth = wethAddress;
        aqua = aquaAddress;
        swapVmApp = swapVmAddress;
        emergencyAdmin = emergencyAdminAddress;
        ethUsdFeed = safety.ethUsdFeed;
        usdcUsdFeed = safety.usdcUsdFeed;
        ethUsdMaxAgeSeconds = safety.ethUsdMaxAgeSeconds;
        usdcUsdMaxAgeSeconds = safety.usdcUsdMaxAgeSeconds;
        maxStrategyPriceDeviationBps = safety.maxStrategyPriceDeviationBps;
        maxStrategyLifetimeSeconds = safety.maxStrategyLifetimeSeconds;
        maxPositionUsdc = safety.maxPositionUsdc;
        maxPositionWeth = safety.maxPositionWeth;
    }

    function createFamilyVault(uint256 familyId) external returns (address vaultAddress) {
        IStarRegistry.Family memory family = registry.getFamily(familyId);
        if (family.parent != msg.sender) revert NotFamilyParent(familyId, msg.sender);
        if (!family.active) revert FamilyInactive(familyId);
        address existingVault = vaultByFamily[familyId];
        if (existingVault != address(0)) {
            revert FamilyVaultAlreadyExists(familyId, existingVault);
        }

        StarFamilyVault vault = new StarFamilyVault(
            familyId,
            usdc,
            weth,
            address(registry),
            address(star),
            aqua,
            swapVmApp,
            emergencyAdmin,
            StarFamilyVault.AquaSafetyConfig({
                ethUsdFeed: ethUsdFeed,
                usdcUsdFeed: usdcUsdFeed,
                ethUsdMaxAgeSeconds: ethUsdMaxAgeSeconds,
                usdcUsdMaxAgeSeconds: usdcUsdMaxAgeSeconds,
                maxStrategyPriceDeviationBps: maxStrategyPriceDeviationBps,
                maxStrategyLifetimeSeconds: maxStrategyLifetimeSeconds,
                maxPositionUsdc: maxPositionUsdc,
                maxPositionWeth: maxPositionWeth
            }),
            questsFactory
        );
        vaultAddress = address(vault);
        vaultByFamily[familyId] = vaultAddress;
        familyIdByVault[vaultAddress] = familyId;
        star.grantRole(star.MINTER_ROLE(), vaultAddress);

        emit FamilyVaultCreated(familyId, msg.sender, vaultAddress, emergencyAdmin);
    }
}
