// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { StarFamilyVault } from "../src/StarFamilyVault.sol";
import { StarRegistry } from "../src/StarRegistry.sol";
import { StarToken } from "../src/StarToken.sol";
import { IAqua } from "../src/interfaces/IAqua.sol";

interface VaultVm {
    function expectRevert(bytes4 selector) external;
    function expectPartialRevert(bytes4 selector) external;
    function prank(address caller) external;
}

contract MockVaultAsset is ERC20 {
    uint8 private immutable assetDecimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        assetDecimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return assetDecimals;
    }

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}

contract MockVaultAqua is IAqua {
    mapping(
        address maker
            => mapping(address app => mapping(bytes32 hash => mapping(address token => uint256)))
    ) public balance;

    function ship(
        address app,
        bytes calldata strategy,
        address[] calldata tokens,
        uint256[] calldata amounts
    ) external returns (bytes32 strategyHash) {
        require(tokens.length == amounts.length, "length");
        strategyHash = keccak256(strategy);
        for (uint256 i; i < tokens.length; ++i) {
            balance[msg.sender][app][strategyHash][tokens[i]] = amounts[i];
        }
    }

    function dock(address app, bytes32 strategyHash, address[] calldata tokens) external {
        for (uint256 i; i < tokens.length; ++i) {
            balance[msg.sender][app][strategyHash][tokens[i]] = 0;
        }
    }

    function push(address maker, address app, bytes32 strategyHash, address token, uint256 amount)
        external
    {
        balance[maker][app][strategyHash][token] += amount;
    }

    function safeBalances(
        address maker,
        address app,
        bytes32 strategyHash,
        address token0,
        address token1
    ) external view returns (uint256 balance0, uint256 balance1) {
        return (
            balance[maker][app][strategyHash][token0], balance[maker][app][strategyHash][token1]
        );
    }
}

contract StarFamilyVaultTest {
    VaultVm private constant VM = VaultVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant CHILD = address(0xCAFE);
    address private constant RECIPIENT = address(0xBEEF);
    address private constant OTHER = address(0xBAD);

    StarRegistry private registry;
    StarToken private star;
    MockVaultAsset private usdc;
    MockVaultAsset private weth;
    MockVaultAqua private aqua;
    StarFamilyVault private vault;
    uint256 private familyId;
    uint256 private childId;
    address private constant SWAP_VM = address(0x1111);

    function setUp() public {
        registry = new StarRegistry();
        star = new StarToken(address(this));
        usdc = new MockVaultAsset("USD Coin", "USDC", 6);
        weth = new MockVaultAsset("Wrapped Ether", "WETH", 18);
        aqua = new MockVaultAqua();

        familyId = registry.createFamily("family.starwallet.eth");
        bytes32 registration =
            registry.proposeChildRegistration(familyId, CHILD, "child.family.starwallet.eth");
        VM.prank(CHILD);
        childId = registry.acceptChildRegistration(registration);

        vault = new StarFamilyVault(
            familyId,
            address(usdc),
            address(weth),
            address(registry),
            address(star),
            address(aqua),
            SWAP_VM
        );
        star.grantRole(star.VAULT_FACTORY_ROLE(), address(this));
        star.grantRole(star.MINTER_ROLE(), address(vault));

        usdc.mint(address(this), 100_000_000);
        weth.mint(address(this), 10 ether);
        usdc.approve(address(vault), type(uint256).max);
        weth.approve(address(vault), type(uint256).max);
    }

    function testRewardsStarsAndAccountsForMatchingUsdc() public {
        uint256 rewardId = vault.rewardStars(childId, 12, "Finished homework");
        StarFamilyVault.FamilyAccount memory account = vault.getFamilyAccount();

        require(rewardId == 1 && vault.nextRewardId() == 2, "reward id");
        require(star.balanceOf(CHILD) == 12, "stars minted");
        require(account.totalPrincipalContributed == 12_000_000, "principal");
        require(account.availableUsdc == 12_000_000, "idle USDC");
        require(vault.principalContributedByChild(childId) == 12_000_000, "child principal");
        require(usdc.balanceOf(address(vault)) == 12_000_000, "vault balance");
    }

    function testWithdrawsUsdcAndTracksPrincipal() public {
        vault.rewardStars(childId, 10, "Finished homework");
        vault.withdrawSavings(4_000_000, RECIPIENT);
        StarFamilyVault.FamilyAccount memory account = vault.getFamilyAccount();

        require(usdc.balanceOf(RECIPIENT) == 4_000_000, "recipient balance");
        require(account.availableUsdc == 6_000_000, "remaining USDC");
        require(account.totalPrincipalWithdrawn == 4_000_000, "withdrawn principal");
        require(account.totalUsdcWithdrawn == 4_000_000, "withdrawn USDC");
        require(vault.netPrincipal() == 6_000_000, "net principal");
    }

    function testFundsAndWithdrawsIdleWeth() public {
        vault.fundStrategyWeth(2 ether);
        require(vault.getFamilyAccount().availableWeth == 2 ether, "idle WETH");

        vault.withdrawStrategyWeth(0.75 ether, RECIPIENT);
        StarFamilyVault.FamilyAccount memory account = vault.getFamilyAccount();
        require(account.availableWeth == 1.25 ether, "remaining WETH");
        require(account.totalWethWithdrawn == 0.75 ether, "withdrawn WETH");
        require(weth.balanceOf(RECIPIENT) == 0.75 ether, "recipient WETH");
    }

    function testRestrictsFundingAndWithdrawalsToFamilyParent() public {
        VM.prank(OTHER);
        VM.expectPartialRevert(StarFamilyVault.NotFamilyParent.selector);
        vault.fundStrategyWeth(1 ether);

        vault.rewardStars(childId, 1, "Finished homework");
        VM.prank(OTHER);
        VM.expectPartialRevert(StarFamilyVault.NotFamilyParent.selector);
        vault.withdrawSavings(1_000_000, OTHER);
    }

    function testRejectsInactiveFundingAndUnavailableBalances() public {
        registry.setFamilyStatus(familyId, false);
        VM.expectPartialRevert(StarFamilyVault.FamilyInactive.selector);
        vault.rewardStars(childId, 1, "Finished homework");
        VM.expectPartialRevert(StarFamilyVault.FamilyInactive.selector);
        vault.fundStrategyWeth(1 ether);

        VM.expectPartialRevert(StarFamilyVault.InsufficientAvailableUsdc.selector);
        vault.withdrawSavings(1, RECIPIENT);
        VM.expectPartialRevert(StarFamilyVault.InsufficientAvailableWeth.selector);
        vault.withdrawStrategyWeth(1, RECIPIENT);
    }

    function testShipsInspectsAndDocksSavingsPosition() public {
        vault.rewardStars(childId, 10, "Finished homework");
        vault.fundStrategyWeth(2 ether);
        bytes memory strategy = bytes("strategy-one");
        bytes32 strategyHash = vault.shipSavingsPosition(strategy, 4_000_000, 0.75 ether);

        StarFamilyVault.FamilyAccount memory account = vault.getFamilyAccount();
        require(strategyHash == keccak256(strategy), "strategy hash");
        require(account.positionActive && account.strategyHash == strategyHash, "active position");
        require(account.positionOpeningUsdc == 4_000_000, "opening USDC");
        require(account.positionOpeningWeth == 0.75 ether, "opening WETH");
        require(account.availableUsdc == 6_000_000, "idle USDC");
        require(account.availableWeth == 1.25 ether, "idle WETH");

        (uint256 positionUsdc, uint256 positionWeth) = vault.currentPositionBalances();
        require(positionUsdc == 4_000_000 && positionWeth == 0.75 ether, "position balances");

        vault.dockSavingsPosition();
        account = vault.getFamilyAccount();
        require(!account.positionActive && account.strategyHash == bytes32(0), "docked");
        require(account.availableUsdc == 10_000_000, "restored USDC");
        require(account.availableWeth == 2 ether, "restored WETH");
    }

    function testReplacesExistingPositionAtomically() public {
        vault.rewardStars(childId, 10, "Finished homework");
        vault.fundStrategyWeth(2 ether);
        bytes memory first = bytes("strategy-one");
        bytes memory second = bytes("strategy-two");
        bytes32 firstHash = vault.shipSavingsPosition(first, 4_000_000, 0.75 ether);

        (bytes32 oldHash, bytes32 newHash) =
            vault.replaceSavingsPosition(second, 6_000_000, 1 ether);
        StarFamilyVault.FamilyAccount memory account = vault.getFamilyAccount();
        require(oldHash == firstHash && newHash == keccak256(second), "replacement hashes");
        require(account.positionActive && account.strategyHash == newHash, "replacement active");
        require(account.availableUsdc == 4_000_000, "replacement USDC");
        require(account.availableWeth == 1 ether, "replacement WETH");
    }

    function testRejectsInvalidPositionLifecycle() public {
        vault.rewardStars(childId, 2, "Finished homework");
        vault.fundStrategyWeth(1 ether);

        VM.expectRevert(StarFamilyVault.InvalidStrategy.selector);
        vault.shipSavingsPosition("", 1_000_000, 0.5 ether);
        vault.shipSavingsPosition(bytes("strategy-one"), 1_000_000, 0.5 ether);
        VM.expectPartialRevert(StarFamilyVault.PositionAlreadyActive.selector);
        vault.shipSavingsPosition(bytes("strategy-two"), 1_000_000, 0.5 ether);

        vault.dockSavingsPosition();
        VM.expectRevert(StarFamilyVault.PositionNotActive.selector);
        vault.currentPositionBalances();
    }
}
