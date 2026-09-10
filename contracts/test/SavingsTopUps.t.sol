// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Aqua } from "../vendor/1inch-aqua/src/Aqua.sol";
import { StarFamilyVault } from "../src/StarFamilyVault.sol";
import { StarRegistry } from "../src/StarRegistry.sol";
import { StarToken } from "../src/StarToken.sol";
import { ConnectorReference } from "./AquaConnectorHarness.sol";
import { MockVaultAsset, MockVaultFeed, MockVaultAqua } from "./StarFamilyVault.t.sol";

interface TopUpVm {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }

    function warp(uint256 timestamp) external;
    function prank(address caller) external;
    function expectRevert() external;
    function expectPartialRevert(bytes4 selector) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
}

contract SavingsTopUpsTest {
    TopUpVm private constant VM = TopUpVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant CHILD = address(0xCAFE);
    address private constant APP = address(0x1111);

    MockVaultAsset private usdc;
    MockVaultAsset private weth;
    MockVaultFeed private ethFeed;
    MockVaultFeed private usdcFeed;
    StarRegistry private registry;
    StarToken private star;
    Aqua private aqua;
    StarFamilyVault private vault;
    uint256 private familyId;
    uint256 private childId;
    bytes32 private strategyHash;

    function setUp() public {
        VM.warp(1_000_000);
        registry = new StarRegistry();
        star = new StarToken(address(this));
        usdc = new MockVaultAsset("USD Coin", "USDC", 6);
        weth = new MockVaultAsset("Wrapped Ether", "WETH", 18);
        ethFeed = new MockVaultFeed(8, 2_000e8, block.timestamp);
        usdcFeed = new MockVaultFeed(8, 1e8, block.timestamp);
        aqua = new Aqua();

        familyId = registry.createFamily("family.starwallet.eth");
        bytes32 registration =
            registry.proposeChildRegistration(familyId, CHILD, "child.family.starwallet.eth");
        VM.prank(CHILD);
        childId = registry.acceptChildRegistration(registration);
        star.grantRole(star.VAULT_FACTORY_ROLE(), address(this));

        vault = _createVault(address(aqua));
        strategyHash = _open(vault, 1);
    }

    function testFuzzRealAquaSelfPushAndClosePreserveInventory(uint64 usdcSeed, uint64 wethSeed)
        public
    {
        uint256 addUsdc = uint256(usdcSeed) % 900e6;
        uint256 addWeth = uint256(wethSeed) % 0.45e18;
        if (addUsdc == 0 && addWeth == 0) addUsdc = 1;
        StarFamilyVault.FamilyAccount memory beforeAdd = vault.getFamilyAccount();

        vault.addToSavingsPosition(strategyHash, addUsdc, addWeth);

        StarFamilyVault.FamilyAccount memory afterAdd = vault.getFamilyAccount();
        (uint256 currentUsdc, uint256 currentWeth) = vault.currentPositionBalances();
        require(vault.savingsTopUpsVersion() == 1, "capability");
        require(afterAdd.strategyHash == strategyHash && afterAdd.positionActive, "same position");
        require(currentUsdc == 100e6 + addUsdc && currentWeth == 0.05e18 + addWeth, "push once");
        require(afterAdd.availableUsdc + currentUsdc == 1000e6, "USDC accounting");
        require(afterAdd.availableWeth + currentWeth == 0.5e18, "WETH accounting");
        require(
            afterAdd.positionOpeningUsdc == beforeAdd.positionOpeningUsdc, "opening USDC changed"
        );
        require(
            afterAdd.positionOpeningWeth == beforeAdd.positionOpeningWeth, "opening WETH changed"
        );
        require(afterAdd.positionDeadline == beforeAdd.positionDeadline, "deadline changed");
        require(
            afterAdd.positionOracleRawPrice == beforeAdd.positionOracleRawPrice,
            "oracle snapshot changed"
        );
        require(afterAdd.totalPrincipalContributed == 1000e6, "principal changed");
        require(star.balanceOf(CHILD) == 1000, "Stars changed");
        require(
            usdc.balanceOf(address(vault)) == 1000e6 && weth.balanceOf(address(vault)) == 0.5e18,
            "physical inventory changed"
        );

        vault.dockSavingsPosition();
        require(vault.getFamilyAccount().availableUsdc == 1000e6, "USDC not restored");
        require(vault.getFamilyAccount().availableWeth == 0.5e18, "WETH not restored");
    }

    function testSingleTokenAndRepeatedTopUpsKeepPositionIdentity() public {
        vault.addToSavingsPosition(strategyHash, 1e6, 0);
        vault.addToSavingsPosition(strategyHash, 0, 0.01e18);
        vault.addToSavingsPosition(strategyHash, 1e6, 0);

        (uint256 currentUsdc, uint256 currentWeth) = vault.currentPositionBalances();
        require(currentUsdc == 102e6 && currentWeth == 0.06e18, "incremental top-ups");
        require(vault.getFamilyAccount().strategyHash == strategyHash, "strategy replaced");
    }

    function testTopUpEventFollowsAquaPushesWithExactDeltas() public {
        VM.recordLogs();
        vault.addToSavingsPosition(strategyHash, 1e6, 0.01e18);
        TopUpVm.Log[] memory logs = VM.getRecordedLogs();
        require(logs.length >= 3, "Aqua and vault events");
        TopUpVm.Log memory last = logs[logs.length - 1];
        require(last.emitter == address(vault), "vault event order");
        require(
            last.topics[0] == keccak256("SavingsPositionToppedUp(uint256,bytes32,uint256,uint256)"),
            "event signature"
        );
        require(last.topics[1] == bytes32(familyId), "family topic");
        require(last.topics[2] == strategyHash, "strategy topic");
        (uint256 usdcAmount, uint256 wethAmount) = abi.decode(last.data, (uint256, uint256));
        require(usdcAmount == 1e6 && wethAmount == 0.01e18, "event amounts");
    }

    function testRejectsWrongHashClosedAndReplacedPositions() public {
        VM.expectPartialRevert(StarFamilyVault.StrategyHashMismatch.selector);
        vault.addToSavingsPosition(bytes32(0), 1, 0);

        vault.dockSavingsPosition();
        VM.expectPartialRevert(StarFamilyVault.PositionNotActive.selector);
        vault.addToSavingsPosition(strategyHash, 1, 0);

        bytes32 replacementHash = _open(vault, 2);
        require(replacementHash != strategyHash, "new position identity");
        VM.expectPartialRevert(StarFamilyVault.StrategyHashMismatch.selector);
        vault.addToSavingsPosition(strategyHash, 1, 0);
    }

    function testRejectsZeroUnavailableAndOverCapAmounts() public {
        VM.expectPartialRevert(StarFamilyVault.ZeroAmount.selector);
        vault.addToSavingsPosition(strategyHash, 0, 0);
        VM.expectPartialRevert(StarFamilyVault.InsufficientAvailableUsdc.selector);
        vault.addToSavingsPosition(strategyHash, 900e6 + 1, 0);
        VM.expectPartialRevert(StarFamilyVault.InsufficientAvailableWeth.selector);
        vault.addToSavingsPosition(strategyHash, 0, 0.45e18 + 1);

        usdc.mint(address(this), 900e6);
        weth.mint(address(this), 0.45e18);
        usdc.approve(address(aqua), 900e6);
        weth.approve(address(aqua), 0.45e18);
        aqua.push(address(vault), APP, strategyHash, address(usdc), 900e6);
        aqua.push(address(vault), APP, strategyHash, address(weth), 0.45e18);
        VM.expectPartialRevert(StarFamilyVault.PositionUsdcLimitExceeded.selector);
        vault.addToSavingsPosition(strategyHash, 1, 0);
        VM.expectPartialRevert(StarFamilyVault.PositionWethLimitExceeded.selector);
        vault.addToSavingsPosition(strategyHash, 0, 1);
    }

    function testRejectsInactivePausedExpiredAndUnsafeOracleStates() public {
        registry.setFamilyStatus(familyId, false);
        VM.expectPartialRevert(StarFamilyVault.FamilyInactive.selector);
        vault.addToSavingsPosition(strategyHash, 1, 0);

        registry.setFamilyStatus(familyId, true);
        vault.setAquaPaused(true);
        VM.expectPartialRevert(StarFamilyVault.AquaOperationsPaused.selector);
        vault.addToSavingsPosition(strategyHash, 1, 0);
        vault.emergencyDockSavingsPosition();
        vault.setAquaPaused(false);

        strategyHash = _open(vault, 2);
        VM.warp(vault.getFamilyAccount().positionDeadline);
        VM.expectPartialRevert(StarFamilyVault.InvalidStrategyDeadline.selector);
        vault.addToSavingsPosition(strategyHash, 1, 0);
        vault.dockSavingsPosition();

        ethFeed.setRound(2_000e8, block.timestamp, 2);
        usdcFeed.setRound(1e8, block.timestamp, 2);
        strategyHash = _open(vault, 3);
        ethFeed.setRound(3_000e8, block.timestamp, 3);
        VM.expectPartialRevert(StarFamilyVault.StrategyPriceOutsideOracleBounds.selector);
        vault.addToSavingsPosition(strategyHash, 1, 0);
        ethFeed.setRound(2_000e8, block.timestamp - 3_601, 4);
        VM.expectPartialRevert(StarFamilyVault.StaleOraclePrice.selector);
        vault.addToSavingsPosition(strategyHash, 1, 0);
    }

    function testSecondPushFailureRollsBackBothAllocations() public {
        MockVaultAqua failingAqua = new MockVaultAqua();
        StarFamilyVault target = _createVault(address(failingAqua));
        bytes32 targetHash = _open(target, 1);
        bytes32 accountBefore = keccak256(abi.encode(target.getFamilyAccount()));
        failingAqua.setFailingPushToken(address(weth));

        VM.expectRevert();
        target.addToSavingsPosition(targetHash, 1e6, 0.01e18);

        require(
            keccak256(abi.encode(target.getFamilyAccount())) == accountBefore, "account rollback"
        );
        (uint256 currentUsdc, uint256 currentWeth) = target.currentPositionBalances();
        require(currentUsdc == 100e6 && currentWeth == 0.05e18, "push rollback");
    }

    function _createVault(address aquaAddress) private returns (StarFamilyVault target) {
        target = new StarFamilyVault(
            familyId,
            address(usdc),
            address(weth),
            address(registry),
            address(star),
            aquaAddress,
            APP,
            address(this),
            _safety()
        );
        star.grantRole(star.MINTER_ROLE(), address(target));
        usdc.mint(address(this), 1000e6);
        weth.mint(address(this), 0.5e18);
        usdc.approve(address(target), type(uint256).max);
        weth.approve(address(target), type(uint256).max);
        target.rewardStars(childId, 1000, "Fund savings");
        target.fundStrategyWeth(0.5e18);
    }

    function _open(StarFamilyVault target, uint64 salt) private returns (bytes32) {
        uint256 oracleRawPrice = target.currentOracleRawPrice();
        return target.shipSavingsPosition(
            ConnectorReference.buildOrder(
                address(target),
                address(weth),
                address(usdc),
                oracleRawPrice * 9_500 / 10_000,
                (oracleRawPrice * 10_500 + 9_999) / 10_000,
                30,
                salt,
                uint40(block.timestamp + 900)
            ),
            100e6,
            0.05e18
        );
    }

    function _safety() private view returns (StarFamilyVault.AquaSafetyConfig memory) {
        return StarFamilyVault.AquaSafetyConfig({
            ethUsdFeed: address(ethFeed),
            usdcUsdFeed: address(usdcFeed),
            ethUsdMaxAgeSeconds: 3_600,
            usdcUsdMaxAgeSeconds: 90_000,
            maxStrategyPriceDeviationBps: 1_000,
            maxStrategyLifetimeSeconds: 1_800,
            maxPositionUsdc: 1000e6,
            maxPositionWeth: 0.5e18
        });
    }
}
