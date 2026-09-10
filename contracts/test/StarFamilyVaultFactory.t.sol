// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { StarFamilyVault } from "../src/StarFamilyVault.sol";
import { StarFamilyVaultFactory } from "../src/StarFamilyVaultFactory.sol";
import { StarRegistry } from "../src/StarRegistry.sol";
import { StarToken } from "../src/StarToken.sol";

interface VaultFactoryVm {
    function expectRevert(bytes4 selector) external;
    function expectPartialRevert(bytes4 selector) external;
    function prank(address caller) external;
}

contract MockFactoryAsset is ERC20 {
    uint8 private immutable assetDecimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        assetDecimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return assetDecimals;
    }
}

contract StarFamilyVaultFactoryTest {
    VaultFactoryVm private constant VM =
        VaultFactoryVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant OTHER = address(0xBAD);

    StarRegistry private registry;
    StarToken private star;
    MockFactoryAsset private usdc;
    MockFactoryAsset private weth;
    StarFamilyVaultFactory private factory;
    uint256 private familyId;

    function setUp() public {
        registry = new StarRegistry();
        star = new StarToken(address(this));
        usdc = new MockFactoryAsset("USD Coin", "USDC", 6);
        weth = new MockFactoryAsset("Wrapped Ether", "WETH", 18);
        factory = new StarFamilyVaultFactory(
            address(registry), address(star), address(usdc), address(weth)
        );
        star.grantRole(star.VAULT_FACTORY_ROLE(), address(factory));
        familyId = registry.createFamily("family.starwallet.eth");
    }

    function testCreatesConfiguredVaultAndAssignsMinterRole() public {
        address vaultAddress = factory.createFamilyVault(familyId);
        StarFamilyVault vault = StarFamilyVault(vaultAddress);

        require(vault.familyId() == familyId, "family id");
        require(address(vault.registry()) == address(registry), "registry");
        require(address(vault.star()) == address(star), "Star token");
        require(address(vault.usdc()) == address(usdc), "USDC");
        require(address(vault.weth()) == address(weth), "WETH");
        require(star.hasRole(star.MINTER_ROLE(), vaultAddress), "minter role");
        require(factory.vaultByFamily(familyId) == vaultAddress, "family lookup");
        require(factory.familyIdByVault(vaultAddress) == familyId, "vault lookup");
    }

    function testDeploysOneDistinctVaultPerFamily() public {
        uint256 secondFamilyId = registry.createFamily("second.starwallet.eth");
        address firstVault = factory.createFamilyVault(familyId);
        address secondVault = factory.createFamilyVault(secondFamilyId);

        require(firstVault != secondVault, "distinct vaults");
        require(factory.vaultByFamily(familyId) == firstVault, "first vault");
        require(factory.vaultByFamily(secondFamilyId) == secondVault, "second vault");
        require(address(factory).code.length <= 24_576, "EIP-170 factory size");
    }

    function testRejectsDuplicateVault() public {
        factory.createFamilyVault(familyId);
        VM.expectPartialRevert(StarFamilyVaultFactory.FamilyVaultAlreadyExists.selector);
        factory.createFamilyVault(familyId);
    }

    function testRequiresActiveFamilyParent() public {
        VM.prank(OTHER);
        VM.expectPartialRevert(StarFamilyVaultFactory.NotFamilyParent.selector);
        factory.createFamilyVault(familyId);

        registry.setFamilyStatus(familyId, false);
        VM.expectPartialRevert(StarFamilyVaultFactory.FamilyInactive.selector);
        factory.createFamilyVault(familyId);
    }

    function testRejectsZeroConfiguration() public {
        VM.expectRevert(StarFamilyVaultFactory.ZeroAddress.selector);
        new StarFamilyVaultFactory(address(0), address(star), address(usdc), address(weth));
    }
}
