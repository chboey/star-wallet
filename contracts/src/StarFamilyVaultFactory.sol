// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IStarRegistry } from "./interfaces/IStarRegistry.sol";
import { IStarToken } from "./interfaces/IStarToken.sol";
import { StarFamilyVault } from "./StarFamilyVault.sol";

contract StarFamilyVaultFactory {
    IStarRegistry public immutable registry;
    IStarToken public immutable star;
    address public immutable usdc;
    address public immutable weth;
    address public immutable aqua;
    address public immutable swapVmApp;

    mapping(uint256 familyId => address vault) public vaultByFamily;
    mapping(address vault => uint256 familyId) public familyIdByVault;

    error ZeroAddress();
    error FamilyInactive(uint256 familyId);
    error NotFamilyParent(uint256 familyId, address account);
    error FamilyVaultAlreadyExists(uint256 familyId, address vault);

    event FamilyVaultCreated(
        uint256 indexed familyId, address indexed parent, address indexed vault
    );

    constructor(
        address registryAddress,
        address starAddress,
        address usdcAddress,
        address wethAddress,
        address aquaAddress,
        address swapVmAddress
    ) {
        if (
            registryAddress == address(0) || starAddress == address(0) || usdcAddress == address(0)
                || wethAddress == address(0) || aquaAddress == address(0)
                || swapVmAddress == address(0)
        ) revert ZeroAddress();

        registry = IStarRegistry(registryAddress);
        star = IStarToken(starAddress);
        usdc = usdcAddress;
        weth = wethAddress;
        aqua = aquaAddress;
        swapVmApp = swapVmAddress;
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
            familyId, usdc, weth, address(registry), address(star), aqua, swapVmApp
        );
        vaultAddress = address(vault);
        vaultByFamily[familyId] = vaultAddress;
        familyIdByVault[vaultAddress] = familyId;
        star.grantRole(star.MINTER_ROLE(), vaultAddress);

        emit FamilyVaultCreated(familyId, msg.sender, vaultAddress);
    }
}
