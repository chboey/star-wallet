// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Aqua } from "../vendor/1inch-aqua/src/Aqua.sol";
import { StarFamilyVault } from "../src/StarFamilyVault.sol";
import { StarQuestsFactory } from "../src/StarQuestsFactory.sol";
import { ConnectorReference } from "./AquaConnectorHarness.sol";
import { Vm, MockERC20, MockFeed, MockRegistry, MockStar, MockAqua } from "./StarFamilyVault.t.sol";

interface SavingsLogVm {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
}

contract SavingsTopUpsTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant APP = address(0x1111);
    MockERC20 private usdc;
    MockERC20 private weth;
    MockFeed private ethFeed;
    MockFeed private usdcFeed;
    MockRegistry private registry;
    MockStar private star;
    Aqua private aqua;
    StarFamilyVault private vault;
    bytes32 private hash;

    function setUp() public {
        vm.warp(1_000_000);
        MockERC20 a = new MockERC20();
        MockERC20 b = new MockERC20();
        (weth, usdc) = address(a) < address(b) ? (a, b) : (b, a);
        usdc.setDecimals(6);
        weth.setDecimals(18);
        ethFeed = new MockFeed(8, 2_000e8, block.timestamp);
        usdcFeed = new MockFeed(8, 1e8, block.timestamp);
        registry = new MockRegistry(address(this));
        star = new MockStar();
        aqua = new Aqua();
        vault = createVault(address(aqua));
        hash = open(vault, 1);
    }

    function createVault(address aquaAddress) private returns (StarFamilyVault target) {
        target = new StarFamilyVault(
            1,
            address(usdc),
            address(weth),
            address(registry),
            address(star),
            aquaAddress,
            APP,
            address(this),
            StarFamilyVault.AquaSafetyConfig({
                ethUsdFeed: address(ethFeed),
                usdcUsdFeed: address(usdcFeed),
                ethUsdMaxAgeSeconds: 3600,
                usdcUsdMaxAgeSeconds: 90000,
                maxStrategyPriceDeviationBps: 1000,
                maxStrategyLifetimeSeconds: 1800,
                maxPositionUsdc: 1000e6,
                maxPositionWeth: 0.5e18
            }),
            new StarQuestsFactory()
        );
        usdc.mint(address(this), 1000e6);
        weth.mint(address(this), 0.5e18);
        usdc.approve(address(target), type(uint256).max);
        weth.approve(address(target), type(uint256).max);
        target.rewardStars(1, 1000, "fund savings");
        target.fundStrategyWeth(0.5e18);
    }

    function open(StarFamilyVault target, uint64 salt) private returns (bytes32) {
        return target.shipSavingsPosition(
            ConnectorReference.buildOrder(
                address(target),
                address(weth),
                address(usdc),
                1_900_000_000,
                2_100_000_000,
                30,
                salt,
                uint40(block.timestamp + 900)
            ),
            100e6,
            0.05e18
        );
    }

    function testFuzzRealAquaSelfPushAndClosePreserveInventory(uint64 u, uint64 w) public {
        uint256 addUsdc = uint256(u) % 900e6;
        uint256 addWeth = uint256(w) % 0.45e18;
        if (addUsdc == 0 && addWeth == 0) addUsdc = 1;
        StarFamilyVault.FamilyAccount memory beforeAdd = vault.getFamilyAccount();
        vault.addToSavingsPosition(hash, addUsdc, addWeth);
        StarFamilyVault.FamilyAccount memory afterAdd = vault.getFamilyAccount();
        (uint256 currentUsdc, uint256 currentWeth) = vault.currentPositionBalances();
        require(vault.savingsTopUpsVersion() == 1, "capability");
        require(afterAdd.strategyHash == hash && afterAdd.positionActive, "same position");
        require(currentUsdc == 100e6 + addUsdc && currentWeth == 0.05e18 + addWeth, "push once");
        require(afterAdd.availableUsdc + currentUsdc == 1000e6, "USDC accounting");
        require(afterAdd.availableWeth + currentWeth == 0.5e18, "WETH accounting");
        require(
            afterAdd.positionOpeningUsdc == beforeAdd.positionOpeningUsdc, "opening USDC unchanged"
        );
        require(
            afterAdd.positionOpeningWeth == beforeAdd.positionOpeningWeth, "opening WETH unchanged"
        );
        require(afterAdd.positionDeadline == beforeAdd.positionDeadline, "no deadline extension");
        require(
            afterAdd.positionOracleRawPrice == beforeAdd.positionOracleRawPrice,
            "opening oracle unchanged"
        );
        require(afterAdd.totalPrincipalContributed == 1000e6, "no new principal");
        require(star.balanceOf(address(0xCAFE)) == 1000, "no Stars minted");
        require(
            usdc.balanceOf(address(vault)) == 1000e6 && weth.balanceOf(address(vault)) == 0.5e18,
            "physical balance unchanged"
        );
        require(
            usdc.balanceOf(address(this)) == 0 && weth.balanceOf(address(this)) == 0,
            "no wallet charge"
        );
        vault.dockSavingsPosition();
        require(vault.getFamilyAccount().availableUsdc == 1000e6, "close returns topped-up USDC");
        require(vault.getFamilyAccount().availableWeth == 0.5e18, "close returns topped-up WETH");
        require(!vault.getFamilyAccount().positionActive, "closed");
        vm.expectPartialRevert(StarFamilyVault.PositionNotActive.selector);
        vault.dockSavingsPosition();
    }

    function testSingleTokenAndRepeatedTopUps() public {
        vault.addToSavingsPosition(hash, 1e6, 0);
        vault.addToSavingsPosition(hash, 0, 0.01e18);
        vault.addToSavingsPosition(hash, 1e6, 0);
        (uint256 u, uint256 w) = vault.currentPositionBalances();
        require(u == 102e6 && w == 0.06e18, "incremental same-position top-ups");
    }

    function testTopUpEventFollowsAquaPushesWithExactInventoryDeltas() public {
        SavingsLogVm logVm = SavingsLogVm(address(vm));
        logVm.recordLogs();
        vault.addToSavingsPosition(hash, 1e6, 0.01e18);
        SavingsLogVm.Log[] memory logs = logVm.getRecordedLogs();
        require(logs.length >= 3, "Aqua and vault events");
        SavingsLogVm.Log memory last = logs[logs.length - 1];
        require(last.emitter == address(vault), "vault top-up follows pushes");
        require(last.topics.length == 3, "indexed family and hash");
        require(
            last.topics[0] == keccak256("SavingsPositionToppedUp(uint256,bytes32,uint256,uint256)"),
            "event signature"
        );
        require(last.topics[1] == bytes32(uint256(1)) && last.topics[2] == hash, "exact target");
        (uint256 u, uint256 w) = abi.decode(last.data, (uint256, uint256));
        require(u == 1e6 && w == 0.01e18, "exact deltas");
    }

    function testRejectsNonParentInactiveAndPaused() public {
        vm.startPrank(address(0xCAFE));
        vm.expectPartialRevert(StarFamilyVault.NotFamilyParent.selector);
        vault.addToSavingsPosition(hash, 1, 0);
        vm.stopPrank();
        registry.setActive(false);
        vm.expectPartialRevert(StarFamilyVault.FamilyInactive.selector);
        vault.addToSavingsPosition(hash, 1, 0);
        registry.setActive(true);
        vault.setAquaPaused(true);
        vm.expectPartialRevert(StarFamilyVault.AquaOperationsPaused.selector);
        vault.addToSavingsPosition(hash, 1, 0);
        registry.setActive(false);
        vault.dockSavingsPosition(); // Exit stays available even in both restricted states.
    }

    function testRejectsWrongHashClosedAndReplacedPosition() public {
        vm.expectPartialRevert(StarFamilyVault.StrategyHashMismatch.selector);
        vault.addToSavingsPosition(bytes32(0), 1, 0);
        vault.dockSavingsPosition();
        vm.expectPartialRevert(StarFamilyVault.PositionNotActive.selector);
        vault.addToSavingsPosition(hash, 1, 0);
        open(vault, 2);
        vm.expectPartialRevert(StarFamilyVault.StrategyHashMismatch.selector);
        vault.addToSavingsPosition(hash, 1, 0);
    }

    function testRejectsZeroAndInsufficientAvailableFunds() public {
        vm.expectPartialRevert(StarFamilyVault.ZeroAmount.selector);
        vault.addToSavingsPosition(hash, 0, 0);
        vm.expectPartialRevert(StarFamilyVault.InsufficientAvailableUsdc.selector);
        vault.addToSavingsPosition(hash, 900e6 + 1, 0);
        vm.expectPartialRevert(StarFamilyVault.InsufficientAvailableWeth.selector);
        vault.addToSavingsPosition(hash, 0, 0.45e18 + 1);
    }

    function testUsesCurrentHoldingsForExposureLimits() public {
        usdc.mint(address(this), 900e6);
        weth.mint(address(this), 0.45e18);
        usdc.approve(address(aqua), 900e6);
        weth.approve(address(aqua), 0.45e18);
        aqua.push(address(vault), APP, hash, address(usdc), 900e6);
        aqua.push(address(vault), APP, hash, address(weth), 0.45e18);
        vm.expectPartialRevert(StarFamilyVault.PositionUsdcLimitExceeded.selector);
        vault.addToSavingsPosition(hash, 1, 0);
        vm.expectPartialRevert(StarFamilyVault.PositionWethLimitExceeded.selector);
        vault.addToSavingsPosition(hash, 0, 1);
    }

    function testRejectsExpiredButStillAllowsClose() public {
        vm.warp(vault.getFamilyAccount().positionDeadline);
        vm.expectPartialRevert(StarFamilyVault.InvalidStrategyDeadline.selector);
        vault.addToSavingsPosition(hash, 1, 0);
        vault.dockSavingsPosition();
    }

    function testRevalidatesPriceRangeAndOracleFreshness() public {
        ethFeed.setRound(3_000e8, block.timestamp, 2);
        vm.expectPartialRevert(StarFamilyVault.StrategyPriceOutsideOracleBounds.selector);
        vault.addToSavingsPosition(hash, 1, 0);
        ethFeed.setRound(2_000e8, block.timestamp - 3601, 3);
        vm.expectPartialRevert(StarFamilyVault.StaleOraclePrice.selector);
        vault.addToSavingsPosition(hash, 1, 0);
    }

    function testSecondPushFailureRollsBackBothAllocations() public {
        MockAqua failingAqua = new MockAqua();
        StarFamilyVault target = createVault(address(failingAqua));
        bytes32 targetHash = open(target, 1);
        bytes32 beforeAccount = keccak256(abi.encode(target.getFamilyAccount()));
        failingAqua.setFailingPushToken(address(weth));
        vm.expectRevert();
        target.addToSavingsPosition(targetHash, 1e6, 0.01e18);
        require(
            keccak256(abi.encode(target.getFamilyAccount())) == beforeAccount, "account rollback"
        );
        (uint256 u, uint256 w) = target.currentPositionBalances();
        require(u == 100e6 && w == 0.05e18, "first push rolled back");
    }
}
