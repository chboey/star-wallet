// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ConnectorReference } from "./AquaConnectorHarness.sol";
import { Aqua } from "../vendor/1inch-aqua/src/Aqua.sol";
import { AquaSwapVMRouter } from "../vendor/1inch-swap-vm/src/routers/AquaSwapVMRouter.sol";
import { ISwapVM } from "../vendor/1inch-swap-vm/src/interfaces/ISwapVM.sol";
import { StarFamilyVault } from "../src/StarFamilyVault.sol";
import { StarQuestsFactory } from "../src/StarQuestsFactory.sol";
import { IAqua } from "../src/interfaces/IAqua.sol";
import { IChainlinkAggregatorV3 } from "../src/interfaces/IChainlinkAggregatorV3.sol";
import { IStarRegistry } from "../src/interfaces/IStarRegistry.sol";
import { IStarToken } from "../src/interfaces/IStarToken.sol";

interface IForkUsdc {
    function masterMinter() external view returns (address);
    function configureMinter(address minter, uint256 amount) external returns (bool);
    function mint(address to, uint256 amount) external returns (bool);
}

interface Vm {
    function skip(bool skipTest) external;
    function warp(uint256 timestamp) external;
    function expectPartialRevert(bytes4 selector) external;
    function expectRevert() external;
    function envOr(string calldata name, string calldata defaultValue)
        external
        view
        returns (string memory value);
    function createSelectFork(string calldata rpcUrl) external returns (uint256 forkId);
    function deal(address account, uint256 newBalance) external;
    function startPrank(address account) external;
    function stopPrank() external;
}

interface IWeth {
    function deposit() external payable;
}

contract MockERC20 is ERC20 {
    uint8 private tokenDecimals;

    constructor() ERC20("Mock", "MOCK") { }

    function setDecimals(uint8 value) external {
        tokenDecimals = value;
    }

    function decimals() public view override returns (uint8) {
        return tokenDecimals;
    }

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}

contract MockFeed is IChainlinkAggregatorV3 {
    uint8 public immutable override decimals;
    uint80 public roundId = 1;
    int256 public answer;
    uint256 public startedAt;
    uint256 public updatedAt;
    uint80 public answeredInRound = 1;

    constructor(uint8 decimals_, int256 answer_, uint256 updatedAt_) {
        decimals = decimals_;
        answer = answer_;
        startedAt = updatedAt_;
        updatedAt = updatedAt_;
    }

    function setRound(int256 answer_, uint256 updatedAt_, uint80 answeredInRound_) external {
        roundId += 1;
        answer = answer_;
        startedAt = updatedAt_;
        updatedAt = updatedAt_;
        answeredInRound = answeredInRound_;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, startedAt, updatedAt, answeredInRound);
    }
}

    contract MockRegistry is IStarRegistry {
        Family private family;
        Child private child;

        constructor(address parent) {
            family = Family({
                id: 1, parent: parent, ensNode: bytes32(0), ensName: "family.eth", active: true
            });
            child = Child({
                id: 1,
                familyId: 1,
                wallet: address(0xCAFE),
                ensNode: bytes32(0),
                ensName: "child.family.eth",
                active: true
            });
        }

        function getFamily(uint256) external view returns (Family memory) {
            return family;
        }

        function setActive(bool active) external {
            family.active = active;
        }

        function getFamilyIdsByParent(address) external pure returns (uint256[] memory ids) {
            ids = new uint256[](1);
            ids[0] = 1;
        }

        function getChild(uint256) external view returns (Child memory) {
            return child;
        }

        function getChildByWallet(address) external view returns (Child memory) {
            return child;
        }

        function isParentOf(address parent, address childWallet) external view returns (bool) {
            return parent == family.parent && childWallet == child.wallet;
        }
    }

    contract MockStar is IStarToken {
        bytes32 public constant override MINTER_ROLE = keccak256("MINTER_ROLE");
        mapping(address => uint256) public override balanceOf;

        function grantRole(bytes32, address) external { }

        function mint(address account, uint256 amount) external {
            balanceOf[account] += amount;
        }

        function burnFrom(address account, uint256 amount) external {
            balanceOf[account] -= amount;
        }
    }

        contract MockAqua is IAqua {
            address public failingPushToken;

            function setFailingPushToken(address token) external {
                failingPushToken = token;
            }

            function push(address maker, address app, bytes32 hash, address token, uint256 amount) external {
                require(token != failingPushToken, "push failed");
                balance[maker][app][hash][token] += amount;
                require(MockERC20(token).transferFrom(msg.sender, maker, amount), "transfer failed");
            }
            mapping(
                address maker
                    => mapping(
                    address app => mapping(bytes32 hash => mapping(address token => uint256))
                )
            ) public balance;

            function setBalance(address maker, address app, bytes32 hash, address token, uint256 amount) external {
                balance[maker][app][hash][token] = amount;
            }

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

            function safeBalances(
                address maker,
                address app,
                bytes32 strategyHash,
                address token0,
                address token1
            ) external view returns (uint256 balance0, uint256 balance1) {
                return (
                    balance[maker][app][strategyHash][token0],
                    balance[maker][app][strategyHash][token1]
                );
            }
        }

        contract StarFamilyVaultTest {
            Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
            uint256 private constant ORACLE_RAW_PRICE = 2_000_000_000;
            uint256 private constant MAX_USDC = 1_000_000_000;
            uint256 private constant MAX_WETH = 500_000_000_000_000_000;

            MockERC20 private usdc;
            MockERC20 private weth;
            MockFeed private ethFeed;
            MockFeed private usdcFeed;
            MockAqua private aqua;
            MockRegistry private registry;
            MockStar private star;
            StarFamilyVault private vault;
            address private constant SWAP_VM = address(0x1111);

            function setUp() public {
                vm.warp(1_000_000);

                MockERC20 first = new MockERC20();
                MockERC20 second = new MockERC20();
                if (address(first) < address(second)) {
                    weth = first;
                    usdc = second;
                } else {
                    weth = second;
                    usdc = first;
                }
                weth.setDecimals(18);
                usdc.setDecimals(6);

                ethFeed = new MockFeed(8, 2_000e8, block.timestamp);
                usdcFeed = new MockFeed(8, 1e8, block.timestamp);
                aqua = new MockAqua();
                registry = new MockRegistry(address(this));
                star = new MockStar();
                vault = new StarFamilyVault(
                    1,
                    address(usdc),
                    address(weth),
                    address(registry),
                    address(star),
                    address(aqua),
                    SWAP_VM,
                    address(this),
                    _safety(),
                    new StarQuestsFactory()
                );

                usdc.mint(address(this), MAX_USDC);
                usdc.approve(address(vault), type(uint256).max);
                vault.rewardStars(1, 1_000, "test funding");
                weth.mint(address(this), MAX_WETH);
                weth.approve(address(vault), type(uint256).max);
                vault.fundStrategyWeth(MAX_WETH);
            }

            function testOracleRawPriceUsesTokenDecimals() public view {
                require(vault.currentOracleRawPrice() == ORACLE_RAW_PRICE, "wrong raw price");
            }

            function testValidStrategyParsesDeadlinePriceFeeAndSalt() public view {
                uint40 deadline = uint40(block.timestamp + 900);
                StarFamilyVault.StrategyParameters memory parameters = vault.inspectSavingsStrategy(
                    _strategy(1_900_000_000, 2_100_000_000, 30, 77, deadline)
                );
                require(parameters.deadline == deadline, "deadline");
                require(parameters.feeBps == 30, "fee");
                require(parameters.salt == 77, "salt");
                require(parameters.oracleRawPrice == ORACLE_RAW_PRICE, "oracle");
            }

            function testRejectsCatastrophicallyMisScaledPrice() public {
                vm.expectPartialRevert(StarFamilyVault.StrategyPriceOutsideOracleBounds.selector);
                vault.inspectSavingsStrategy(
                    _strategy(2_000e18, 2_100e18, 30, 1, uint40(block.timestamp + 900))
                );
            }

            function testRejectsWrongMakerTraitsAndProgram() public {
                bytes memory encoded =
                    _strategy(1_900_000_000, 2_100_000_000, 30, 1, uint40(block.timestamp + 900));
                StarFamilyVault.SwapVmOrder memory order =
                    abi.decode(encoded, (StarFamilyVault.SwapVmOrder));

                order.maker = address(0xBAD);
                vm.expectPartialRevert(StarFamilyVault.InvalidStrategyMaker.selector);
                vault.inspectSavingsStrategy(abi.encode(order));

                order.maker = address(vault);
                order.traits = 0;
                vm.expectPartialRevert(StarFamilyVault.InvalidStrategyTraits.selector);
                vault.inspectSavingsStrategy(abi.encode(order));

                order.traits = vault.DEFAULT_AQUA_MAKER_TRAITS();
                order.data[40] = bytes1(0x11);
                vm.expectPartialRevert(StarFamilyVault.InvalidStrategyProgram.selector);
                vault.inspectSavingsStrategy(abi.encode(order));
            }

            function testRejectsExpiredOrExcessivelyLongStrategy() public {
                vm.expectPartialRevert(StarFamilyVault.InvalidStrategyDeadline.selector);
                vault.inspectSavingsStrategy(
                    _strategy(1_900_000_000, 2_100_000_000, 30, 1, uint40(block.timestamp + 59))
                );

                vm.expectPartialRevert(StarFamilyVault.StrategyDeadlineTooFar.selector);
                vault.inspectSavingsStrategy(
                    _strategy(1_900_000_000, 2_100_000_000, 30, 2, uint40(block.timestamp + 1_801))
                );
            }

            function testRejectsLegacyTraitsAndForeignTokenPrefix() public {
                bytes memory encoded =
                    _strategy(1_900_000_000, 2_100_000_000, 30, 1, uint40(block.timestamp + 900));
                StarFamilyVault.SwapVmOrder memory order =
                    abi.decode(encoded, (StarFamilyVault.SwapVmOrder));
                order.traits = uint256(1) << 254;
                vm.expectPartialRevert(StarFamilyVault.InvalidStrategyTraits.selector);
                vault.inspectSavingsStrategy(abi.encode(order));
                order.traits = vault.DEFAULT_AQUA_MAKER_TRAITS();
                order.data[0] = order.data[0] ^ bytes1(0x01);
                vm.expectPartialRevert(StarFamilyVault.InvalidStrategyTokens.selector);
                vault.inspectSavingsStrategy(abi.encode(order));
                order.data = hex"01";
                vm.expectPartialRevert(StarFamilyVault.InvalidStrategyTokens.selector);
                vault.inspectSavingsStrategy(abi.encode(order));
            }

            function testRejectsNoncanonicalFeeUnitsAndZeroSalt() public {
                bytes memory encoded =
                    _strategy(1_900_000_000, 2_100_000_000, 30, 1, uint40(block.timestamp + 900));
                StarFamilyVault.SwapVmOrder memory order =
                    abi.decode(encoded, (StarFamilyVault.SwapVmOrder));
                order.data[51] = bytes1(uint8(order.data[51]) + 1);
                vm.expectPartialRevert(StarFamilyVault.InvalidStrategyFee.selector);
                vault.inspectSavingsStrategy(abi.encode(order));
                vm.expectPartialRevert(StarFamilyVault.InvalidStrategySalt.selector);
                vault.inspectSavingsStrategy(
                    _strategy(1_900_000_000, 2_100_000_000, 0, 0, uint40(block.timestamp + 900))
                );
            }

            function testFuzzUpstreamOrderBuilderMatchesVault(uint16 fee, uint64 salt) public view {
                fee = fee % 1_001;
                if (salt == 0) salt = 1;
                StarFamilyVault.StrategyParameters memory parameters = vault.inspectSavingsStrategy(
                    _strategy(
                        1_900_000_000, 2_100_000_000, fee, salt, uint40(block.timestamp + 900)
                    )
                );
                require(parameters.feeBps == fee && parameters.salt == salt, "parameters mismatch");
            }

            function testRejectsStaleFutureAndIncompleteOracleRounds() public {
                ethFeed.setRound(2_000e8, block.timestamp - 3_601, 2);
                vm.expectPartialRevert(StarFamilyVault.StaleOraclePrice.selector);
                vault.currentOracleRawPrice();

                ethFeed.setRound(2_000e8, block.timestamp + 1, 3);
                vm.expectPartialRevert(StarFamilyVault.InvalidOracleTimestamp.selector);
                vault.currentOracleRawPrice();

                ethFeed.setRound(2_000e8, block.timestamp, 0);
                vm.expectPartialRevert(StarFamilyVault.InvalidOracleRound.selector);
                vault.currentOracleRawPrice();

                ethFeed.setRound(0, block.timestamp, 4);
                vm.expectPartialRevert(StarFamilyVault.InvalidOracleAnswer.selector);
                vault.currentOracleRawPrice();
            }

            function testFuzzSepoliaTokenOrderAndMaximumBand(uint16 band) public {
                // Reassign mock decimals: the smaller address is USDC, as on Sepolia.
                weth.setDecimals(6);
                usdc.setDecimals(18);
                StarFamilyVault reciprocal = new StarFamilyVault(
                    1,
                    address(weth),
                    address(usdc),
                    address(registry),
                    address(star),
                    address(aqua),
                    SWAP_VM,
                    address(this),
                    _safety(),
                    new StarQuestsFactory()
                );
                uint256 price = 500_000_000_000_000_000_000_000_000;
                require(reciprocal.currentOracleRawPrice() == price, "reciprocal 6/18 price");
                uint256 bps = 25 + uint256(band) % 976;
                bytes memory strategy = ConnectorReference.buildOrder(
                    address(reciprocal),
                    address(weth),
                    address(usdc),
                    price * (10_000 - bps) / 10_000,
                    price * (10_000 + bps) / 10_000,
                    30,
                    1,
                    uint40(block.timestamp + 900)
                );
                require(
                    reciprocal.inspectSavingsStrategy(strategy).oracleRawPrice == price,
                    "reciprocal bounds"
                );
            }

            function testPositionExposureCapsAreEnforced() public {
                bytes memory strategy =
                    _strategy(1_900_000_000, 2_100_000_000, 30, 1, uint40(block.timestamp + 900));

                vm.expectPartialRevert(StarFamilyVault.PositionUsdcLimitExceeded.selector);
                vault.shipSavingsPosition(strategy, MAX_USDC + 1, 1);

                vm.expectPartialRevert(StarFamilyVault.PositionWethLimitExceeded.selector);
                vault.shipSavingsPosition(strategy, 1, MAX_WETH + 1);
            }

            function testShipAndDockPreserveAccountedInventory() public {
                bytes memory strategy =
                    _strategy(1_900_000_000, 2_100_000_000, 30, 1, uint40(block.timestamp + 900));
                vault.shipSavingsPosition(strategy, 100e6, 0.05e18);

                (uint256 positionUsdc, uint256 positionWeth) = vault.currentPositionBalances();
                require(positionUsdc == 100e6 && positionWeth == 0.05e18, "shipped balances");

                vault.dockSavingsPosition();
                StarFamilyVault.FamilyAccount memory account = vault.getFamilyAccount();
                require(!account.positionActive, "still active");
                require(account.availableUsdc == MAX_USDC, "USDC accounting");
                require(account.availableWeth == MAX_WETH, "WETH accounting");
            }

            function testEmergencyPauseRevokesBeforeSeparateDockAndBlocksUnsafeResume() public {
                bytes memory strategy =
                    _strategy(1_900_000_000, 2_100_000_000, 30, 1, uint40(block.timestamp + 900));
                vault.shipSavingsPosition(strategy, 100e6, 0.05e18);

                vault.setAquaPaused(true);
                StarFamilyVault.FamilyAccount memory account = vault.getFamilyAccount();
                require(vault.aquaPaused(), "not paused");
                require(account.positionActive, "pause unexpectedly docked");
                require(usdc.allowance(address(vault), address(aqua)) == 0, "USDC allowance");
                require(weth.allowance(address(vault), address(aqua)) == 0, "WETH allowance");

                vm.expectPartialRevert(StarFamilyVault.PositionMustBeDockedBeforeUnpause.selector);
                vault.setAquaPaused(false);

                vault.emergencyDockSavingsPosition();
                account = vault.getFamilyAccount();
                require(!account.positionActive, "position not docked");

                vault.setAquaPaused(false);
                require(!vault.aquaPaused(), "not resumed");
                require(
                    usdc.allowance(address(vault), address(aqua)) == type(uint256).max,
                    "USDC allowance not restored"
                );
                require(
                    weth.allowance(address(vault), address(aqua)) == type(uint256).max,
                    "WETH allowance not restored"
                );
            }

            function testCannotAddByShippingAgainAndReplacementCreatesANewPosition() public {
                bytes memory first = _strategy(1_900_000_000, 2_100_000_000, 30, 1, uint40(block.timestamp + 900));
                bytes memory second = _strategy(1_900_000_000, 2_100_000_000, 30, 2, uint40(block.timestamp + 900));
                bytes32 original = vault.shipSavingsPosition(first, 100e6, 0.05e18);
                vm.expectPartialRevert(StarFamilyVault.PositionAlreadyActive.selector);
                vault.shipSavingsPosition(second, 50e6, 0.01e18);
                (bytes32 oldHash, bytes32 newHash) = vault.replaceSavingsPosition(second, 150e6, 0.06e18);
                require(oldHash == original && newHash != oldHash, "replacement must be a new position");
                StarFamilyVault.FamilyAccount memory account = vault.getFamilyAccount();
                require(account.positionActive && account.strategyHash == newHash, "one replacement active");
                require(account.availableUsdc == MAX_USDC - 150e6, "replacement USDC accounting");
                require(account.availableWeth == MAX_WETH - 0.06e18, "replacement WETH accounting");
                require(aqua.balance(address(vault), SWAP_VM, oldHash, address(usdc)) == 0, "old position docked");
            }

            function testParentCanCloseWhilePausedAndInactiveButOtherWalletsCannot() public {
                vault.shipSavingsPosition(_strategy(1_900_000_000, 2_100_000_000, 30, 1, uint40(block.timestamp + 900)), 100e6, 0.05e18);
                vault.setAquaPaused(true);
                registry.setActive(false);
                vm.startPrank(address(0xCAFE));
                vm.expectPartialRevert(StarFamilyVault.NotFamilyParent.selector);
                vault.dockSavingsPosition();
                vm.stopPrank();
                vault.dockSavingsPosition();
                require(!vault.getFamilyAccount().positionActive, "parent must be able to close");
                vm.expectPartialRevert(StarFamilyVault.PositionNotActive.selector);
                vault.dockSavingsPosition();
            }

            function testAquaPushAddsParentWalletFundsWithoutUsingAvailableVaultInventory() public {
                Aqua actualAqua = new Aqua();
                StarFamilyVault actualVault = new StarFamilyVault(
                    1, address(usdc), address(weth), address(registry), address(star),
                    address(actualAqua), SWAP_VM, address(this), _safety(), new StarQuestsFactory()
                );
                usdc.mint(address(this), 100e6);
                weth.mint(address(this), 0.05e18);
                usdc.approve(address(actualVault), 100e6);
                weth.approve(address(actualVault), 0.05e18);
                actualVault.rewardStars(1, 100, "fund real Aqua test");
                actualVault.fundStrategyWeth(0.05e18);
                bytes memory strategy = ConnectorReference.buildOrder(
                    address(actualVault), address(weth), address(usdc),
                    1_900_000_000, 2_100_000_000, 30, 1, uint40(block.timestamp + 900)
                );
                bytes32 hash = actualVault.shipSavingsPosition(strategy, 20e6, 0.01e18);
                StarFamilyVault.FamilyAccount memory beforePush = actualVault.getFamilyAccount();
                uint256 childStars = star.balanceOf(address(0xCAFE));
                usdc.mint(address(this), 5e6);
                usdc.approve(address(actualAqua), 5e6);
                actualAqua.push(address(actualVault), SWAP_VM, hash, address(usdc), 5e6);
                (uint256 currentUsdc, uint256 currentWeth) = actualVault.currentPositionBalances();
                StarFamilyVault.FamilyAccount memory afterPush = actualVault.getFamilyAccount();
                require(currentUsdc == 25e6 && currentWeth == 0.01e18, "top up existing strategy");
                require(afterPush.strategyHash == hash && afterPush.positionActive, "same active position");
                require(afterPush.availableUsdc == beforePush.availableUsdc, "idle vault USDC not used");
                require(afterPush.availableWeth == beforePush.availableWeth, "idle vault WETH not used");
                require(afterPush.totalPrincipalContributed == beforePush.totalPrincipalContributed, "not a Star principal contribution");
                require(star.balanceOf(address(0xCAFE)) == childStars, "top up does not mint Stars");
                require(usdc.balanceOf(address(this)) == 0, "top up paid from parent wallet");
                actualVault.dockSavingsPosition();
                require(actualVault.getFamilyAccount().availableUsdc == 105e6, "close includes parent top up");
            }

            function testCloseReturnsCurrentBalancesWithoutWithdrawalOrChangingStars() public {
                bytes32 hash = vault.shipSavingsPosition(_strategy(1_900_000_000, 2_100_000_000, 30, 1, uint40(block.timestamp + 900)), 100e6, 0.05e18);
                StarFamilyVault.FamilyAccount memory beforeClose = vault.getFamilyAccount();
                uint256 childStars = star.balanceOf(address(0xCAFE));
                uint256 parentUsdc = usdc.balanceOf(address(this));
                uint256 parentWeth = weth.balanceOf(address(this));
                aqua.setBalance(address(vault), SWAP_VM, hash, address(usdc), 110e6);
                aqua.setBalance(address(vault), SWAP_VM, hash, address(weth), 0.045e18);
                vault.dockSavingsPosition();
                StarFamilyVault.FamilyAccount memory afterClose = vault.getFamilyAccount();
                require(afterClose.availableUsdc == beforeClose.availableUsdc + 110e6, "use current USDC");
                require(afterClose.availableWeth == beforeClose.availableWeth + 0.045e18, "use current WETH");
                require(!afterClose.positionActive && afterClose.strategyHash == bytes32(0), "clear position");
                require(afterClose.positionOpeningUsdc == 0 && afterClose.positionOpeningWeth == 0, "clear opening amounts");
                require(afterClose.totalPrincipalWithdrawn == beforeClose.totalPrincipalWithdrawn, "no principal withdrawal");
                require(afterClose.totalUsdcWithdrawn == beforeClose.totalUsdcWithdrawn, "no USDC withdrawal");
                require(afterClose.totalWethWithdrawn == beforeClose.totalWethWithdrawn, "no WETH withdrawal");
                require(star.balanceOf(address(0xCAFE)) == childStars, "Stars unchanged");
                require(usdc.balanceOf(address(this)) == parentUsdc, "no parent USDC transfer");
                require(weth.balanceOf(address(this)) == parentWeth, "no parent WETH transfer");
            }

            function _safety() private view returns (StarFamilyVault.AquaSafetyConfig memory) {
                return StarFamilyVault.AquaSafetyConfig({
                    ethUsdFeed: address(ethFeed),
                    usdcUsdFeed: address(usdcFeed),
                    ethUsdMaxAgeSeconds: 3_600,
                    usdcUsdMaxAgeSeconds: 90_000,
                    maxStrategyPriceDeviationBps: 1_000,
                    maxStrategyLifetimeSeconds: 1_800,
                    maxPositionUsdc: MAX_USDC,
                    maxPositionWeth: MAX_WETH
                });
            }

            function _strategy(
                uint256 rawPriceMin,
                uint256 rawPriceMax,
                uint16 feeBps,
                uint64 salt,
                uint40 deadline
            ) private view returns (bytes memory) {
                return ConnectorReference.buildOrder(
                    address(vault),
                    address(weth),
                    address(usdc),
                    rawPriceMin,
                    rawPriceMax,
                    feeBps,
                    salt,
                    deadline
                );
            }
        }

        contract StarFamilyVaultSepoliaForkTest {
            Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
            address private constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
            address private constant WETH = 0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9;
            address private AQUA;
            address private SWAP_VM;
            address private constant ETH_USD = 0x694AA1769357215DE4FAC081bf1f309aDC325306;
            address private constant USDC_USD = 0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E;
            address private constant TAKER = address(0xBEEF);
            string private rpcUrl;

            function setUp() public {
                rpcUrl = vm.envOr("SEPOLIA_FORK_RPC_URL", string(""));
            }

            function testForkVendoredSwapVmQuotesExpiringAquaStrategy() public {
                if (bytes(rpcUrl).length == 0) {
                    vm.skip(true);
                    return;
                }
                vm.createSelectFork(rpcUrl);
                require(block.chainid == 11155111, "Ethereum Sepolia required");
                AQUA = address(new Aqua());
                SWAP_VM = address(new AquaSwapVMRouter(AQUA, WETH, address(this), "SwapVM", "1"));

                MockRegistry registry = new MockRegistry(address(this));
                MockStar star = new MockStar();
                StarFamilyVault.AquaSafetyConfig memory safety = StarFamilyVault.AquaSafetyConfig({
                    ethUsdFeed: ETH_USD,
                    usdcUsdFeed: USDC_USD,
                    ethUsdMaxAgeSeconds: 3_600,
                    usdcUsdMaxAgeSeconds: 90_000,
                    maxStrategyPriceDeviationBps: 1_000,
                    maxStrategyLifetimeSeconds: 1_800,
                    maxPositionUsdc: 100e6,
                    maxPositionWeth: 0.05e18
                });
                StarFamilyVault vault = new StarFamilyVault(
                    1,
                    USDC,
                    WETH,
                    address(registry),
                    address(star),
                    AQUA,
                    SWAP_VM,
                    address(this),
                    safety,
                    new StarQuestsFactory()
                );

                // Impersonation changes the local fork only, not Sepolia.
                vm.startPrank(IForkUsdc(USDC).masterMinter());
                require(IForkUsdc(USDC).configureMinter(address(this), 101e6), "fork minter setup");
                vm.stopPrank();
                require(IForkUsdc(USDC).mint(address(this), 100e6), "fork USDC funding");
                require(IForkUsdc(USDC).mint(TAKER, 1e6), "fork taker funding");
                ERC20(USDC).approve(address(vault), type(uint256).max);
                vault.rewardStars(1, 100, "fork funding");
                vm.deal(address(this), 0.05e18);
                IWeth(WETH).deposit{ value: 0.05e18 }();
                ERC20(WETH).approve(address(vault), type(uint256).max);
                vault.fundStrategyWeth(0.05e18);

                uint256 oracleRawPrice = vault.currentOracleRawPrice();
                uint40 deadline = uint40(block.timestamp + 900);
                bytes memory strategy = _forkStrategy(
                    address(vault),
                    oracleRawPrice * 9_500 / 10_000,
                    (oracleRawPrice * 10_500 + 9_999) / 10_000,
                    deadline
                );
                bytes32 strategyHash = vault.shipSavingsPosition(strategy, 100e6, 0.05e18);
                require(strategyHash == keccak256(strategy), "fork strategy hash");

                _executeBidirectionalSwaps(strategy, strategyHash);

                vm.warp(deadline + 1);
                vm.expectRevert();
                ISwapVM(SWAP_VM)
                    .quote(
                        abi.decode(strategy, (ISwapVM.Order)),
                        1e6,
                        ConnectorReference.buildTaker(true, 0, 0)
                    );

                vault.setAquaPaused(true);
                require(ERC20(USDC).allowance(address(vault), AQUA) == 0, "fork USDC allowance");
                require(ERC20(WETH).allowance(address(vault), AQUA) == 0, "fork WETH allowance");
                vault.emergencyDockSavingsPosition();
                require(!vault.getFamilyAccount().positionActive, "fork emergency dock");
            }

            function _executeBidirectionalSwaps(bytes memory strategy, bytes32 strategyHash)
                private
            {
                ISwapVM.Order memory order = abi.decode(strategy, (ISwapVM.Order));
                (uint256 quotedIn, uint256 quotedOut, bytes32 quotedHash) =
                    ISwapVM(SWAP_VM).quote(order, 1e6, ConnectorReference.buildTaker(true, 0, 0));
                require(quotedIn == 1e6 && quotedOut > 0, "fork forward quote");
                require(quotedHash == strategyHash, "fork forward quote hash");

                uint256 takerWethBefore = ERC20(WETH).balanceOf(TAKER);
                vm.startPrank(TAKER);
                ERC20(USDC).approve(SWAP_VM, type(uint256).max);
                (uint256 amountIn, uint256 amountOut, bytes32 swapHash) =
                    ISwapVM(SWAP_VM).swap(order, 1e6, ConnectorReference.buildTaker(true, 0, 0));
                vm.stopPrank();
                require(amountIn == quotedIn && amountOut == quotedOut, "fork forward swap");
                require(swapHash == strategyHash, "fork forward swap hash");
                require(
                    ERC20(WETH).balanceOf(TAKER) - takerWethBefore == amountOut,
                    "fork taker WETH balance"
                );

                uint256 reverseAmountIn = amountOut / 2;
                (quotedIn, quotedOut, quotedHash) = ISwapVM(SWAP_VM)
                    .quote(order, reverseAmountIn, ConnectorReference.buildTaker(false, 0, 0));
                require(quotedIn == reverseAmountIn && quotedOut > 0, "fork reverse quote");
                require(quotedHash == strategyHash, "fork reverse quote hash");

                uint256 takerUsdcBefore = ERC20(USDC).balanceOf(TAKER);
                vm.startPrank(TAKER);
                ERC20(WETH).approve(SWAP_VM, type(uint256).max);
                (amountIn, amountOut, swapHash) = ISwapVM(SWAP_VM)
                    .swap(order, reverseAmountIn, ConnectorReference.buildTaker(false, 0, 0));
                vm.stopPrank();
                require(amountIn == quotedIn && amountOut == quotedOut, "fork reverse swap");
                require(swapHash == strategyHash, "fork reverse swap hash");
                require(
                    ERC20(USDC).balanceOf(TAKER) - takerUsdcBefore == amountOut,
                    "fork taker USDC balance"
                );
            }

            function _forkStrategy(
                address maker,
                uint256 rawPriceMin,
                uint256 rawPriceMax,
                uint40 deadline
            ) private pure returns (bytes memory) {
                return ConnectorReference.buildOrder(
                    maker, USDC, WETH, rawPriceMin, rawPriceMax, 30, 1, deadline
                );
            }
        }
