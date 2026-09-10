// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { StarFamilyVault } from "../src/StarFamilyVault.sol";
import { StarRegistry } from "../src/StarRegistry.sol";
import { StarToken } from "../src/StarToken.sol";
import { IAqua } from "../src/interfaces/IAqua.sol";
import { IChainlinkAggregatorV3 } from "../src/interfaces/IChainlinkAggregatorV3.sol";

interface VaultVm {
    function warp(uint256 timestamp) external;
    function expectRevert(bytes4 selector) external;
    function expectPartialRevert(bytes4 selector) external;
    function prank(address caller) external;
}

contract MockVaultFeed is IChainlinkAggregatorV3 {
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

    contract MockVaultAsset is ERC20 {
        uint8 private immutable assetDecimals;

        constructor(string memory name_, string memory symbol_, uint8 decimals_)
            ERC20(name_, symbol_)
        {
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
                => mapping(
                address app => mapping(bytes32 hash => mapping(address token => uint256))
            )
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

        function push(
            address maker,
            address app,
            bytes32 strategyHash,
            address token,
            uint256 amount
        ) external {
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
        VaultVm private constant VM = VaultVm(
            address(uint160(uint256(keccak256("hevm cheat code"))))
        );
        address private constant CHILD = address(0xCAFE);
        address private constant RECIPIENT = address(0xBEEF);
        address private constant OTHER = address(0xBAD);
        uint256 private constant DEFAULT_MAKER_TRAITS =
            (uint256(1) << 254) | (uint256(0x0028002800280028) << 160);

        StarRegistry private registry;
        StarToken private star;
        MockVaultAsset private usdc;
        MockVaultAsset private weth;
        MockVaultAqua private aqua;
        MockVaultFeed private ethFeed;
        MockVaultFeed private usdcFeed;
        StarFamilyVault private vault;
        uint256 private familyId;
        uint256 private childId;
        address private constant SWAP_VM = address(0x1111);

        function setUp() public {
            VM.warp(1_000_000);
            registry = new StarRegistry();
            star = new StarToken(address(this));
            usdc = new MockVaultAsset("USD Coin", "USDC", 6);
            weth = new MockVaultAsset("Wrapped Ether", "WETH", 18);
            aqua = new MockVaultAqua();
            ethFeed = new MockVaultFeed(8, 2_000e8, block.timestamp);
            usdcFeed = new MockVaultFeed(8, 1e8, block.timestamp);

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
                SWAP_VM,
                _safety()
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
            bytes memory strategy = _strategy(30, 1, uint40(block.timestamp + 900));
            bytes32 strategyHash = vault.shipSavingsPosition(strategy, 4_000_000, 0.75 ether);

            StarFamilyVault.FamilyAccount memory account = vault.getFamilyAccount();
            require(strategyHash == keccak256(strategy), "strategy hash");
            require(
                account.positionActive && account.strategyHash == strategyHash, "active position"
            );
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
            bytes memory first = _strategy(30, 1, uint40(block.timestamp + 900));
            bytes memory second = _strategy(30, 2, uint40(block.timestamp + 900));
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
            bytes memory first = _strategy(30, 1, uint40(block.timestamp + 900));
            bytes memory second = _strategy(30, 2, uint40(block.timestamp + 900));

            VM.expectRevert(StarFamilyVault.InvalidStrategy.selector);
            vault.shipSavingsPosition("", 1_000_000, 0.5 ether);
            vault.shipSavingsPosition(first, 1_000_000, 0.5 ether);
            VM.expectPartialRevert(StarFamilyVault.PositionAlreadyActive.selector);
            vault.shipSavingsPosition(second, 1_000_000, 0.5 ether);

            vault.dockSavingsPosition();
            VM.expectRevert(StarFamilyVault.PositionNotActive.selector);
            vault.currentPositionBalances();
        }

        function testInspectsCanonicalStrategyParameters() public view {
            uint40 deadline = uint40(block.timestamp + 900);
            StarFamilyVault.StrategyParameters memory parameters =
                vault.inspectSavingsStrategy(_strategy(30, 77, deadline));

            require(parameters.sqrtPriceMin < parameters.sqrtPriceMax, "price range");
            require(parameters.oracleRawPrice == vault.currentOracleRawPrice(), "oracle price");
            require(parameters.feeBps == 30, "fee");
            require(parameters.salt == 77, "salt");
            require(parameters.deadline == deadline, "deadline");
        }

        function testRejectsWrongMakerTraitsTokensAndProgram() public {
            StarFamilyVault.SwapVmOrder memory order = abi.decode(
                _strategy(30, 1, uint40(block.timestamp + 900)), (StarFamilyVault.SwapVmOrder)
            );

            order.maker = OTHER;
            VM.expectPartialRevert(StarFamilyVault.InvalidStrategyMaker.selector);
            vault.inspectSavingsStrategy(abi.encode(order));

            order.maker = address(vault);
            order.traits = 0;
            VM.expectPartialRevert(StarFamilyVault.InvalidStrategyTraits.selector);
            vault.inspectSavingsStrategy(abi.encode(order));

            order.traits = vault.DEFAULT_AQUA_MAKER_TRAITS();
            order.data[0] = order.data[0] ^ bytes1(0x01);
            VM.expectRevert(StarFamilyVault.InvalidStrategyTokens.selector);
            vault.inspectSavingsStrategy(abi.encode(order));

            order = abi.decode(
                _strategy(30, 1, uint40(block.timestamp + 900)), (StarFamilyVault.SwapVmOrder)
            );
            order.data[40] = 0x11;
            VM.expectRevert(StarFamilyVault.InvalidStrategyProgram.selector);
            vault.inspectSavingsStrategy(abi.encode(order));
        }

        function testRejectsInvalidFeeSaltPriceRangeAndDeadline() public {
            bytes memory invalidFee = _strategy(1_001, 1, uint40(block.timestamp + 900));
            bytes memory invalidSalt = _strategy(30, 0, uint40(block.timestamp + 900));
            bytes memory invalidRange = _strategyWithRange(
                30, 1, uint40(block.timestamp + 900), 2, 1
            );
            bytes memory tooShort = _strategy(30, 1, uint40(block.timestamp + 59));
            bytes memory tooLong = _strategy(30, 1, uint40(block.timestamp + 1_801));

            VM.expectPartialRevert(StarFamilyVault.InvalidStrategyFee.selector);
            vault.inspectSavingsStrategy(invalidFee);

            VM.expectRevert(StarFamilyVault.InvalidStrategySalt.selector);
            vault.inspectSavingsStrategy(invalidSalt);

            VM.expectPartialRevert(StarFamilyVault.InvalidStrategyPriceRange.selector);
            vault.inspectSavingsStrategy(invalidRange);

            VM.expectPartialRevert(StarFamilyVault.InvalidStrategyDeadline.selector);
            vault.inspectSavingsStrategy(tooShort);

            VM.expectPartialRevert(StarFamilyVault.StrategyDeadlineTooFar.selector);
            vault.inspectSavingsStrategy(tooLong);
        }

        function testRejectsUnsafeOracleRoundsAndPriceRanges() public {
            bytes memory strategy = _strategy(30, 1, uint40(block.timestamp + 900));
            uint256 rawPrice = vault.currentOracleRawPrice();
            uint256 sqrtMin = Math.sqrt(rawPrice * 8_000 / 10_000 * 1e18, Math.Rounding.Ceil);
            uint256 sqrtMax = Math.sqrt(rawPrice * 12_000 / 10_000 * 1e18);
            bytes memory unsafeRange =
                _strategyWithRange(30, 1, uint40(block.timestamp + 900), sqrtMin, sqrtMax);

            ethFeed.setRound(2_000e8, block.timestamp - 3_601, 2);
            VM.expectPartialRevert(StarFamilyVault.StaleOraclePrice.selector);
            vault.inspectSavingsStrategy(strategy);

            ethFeed.setRound(2_000e8, block.timestamp, 3);
            VM.expectPartialRevert(StarFamilyVault.StrategyPriceOutsideOracleBounds.selector);
            vault.inspectSavingsStrategy(unsafeRange);
        }

        function testEnforcesPositionExposureLimits() public {
            vault.rewardStars(childId, 100, "Fund maximum position");
            vault.fundStrategyWeth(10 ether);
            bytes memory strategy = _strategy(30, 1, uint40(block.timestamp + 900));

            VM.expectPartialRevert(StarFamilyVault.PositionUsdcLimitExceeded.selector);
            vault.shipSavingsPosition(strategy, 100_000_001, 1);
            VM.expectPartialRevert(StarFamilyVault.PositionWethLimitExceeded.selector);
            vault.shipSavingsPosition(strategy, 1, 10 ether + 1);
        }

        function testCannotReuseDockedStrategyHash() public {
            vault.rewardStars(childId, 2, "Finished homework");
            vault.fundStrategyWeth(1 ether);
            bytes memory strategy = _strategy(30, 1, uint40(block.timestamp + 900));
            bytes32 strategyHash = vault.shipSavingsPosition(strategy, 1_000_000, 0.5 ether);
            vault.dockSavingsPosition();

            require(vault.strategyHashUsed(strategyHash), "strategy not recorded");
            VM.expectPartialRevert(StarFamilyVault.StrategyHashAlreadyUsed.selector);
            vault.shipSavingsPosition(strategy, 1_000_000, 0.5 ether);
        }

        function _strategy(uint16 feeBps, uint64 salt, uint40 deadline)
            private
            view
            returns (bytes memory)
        {
            uint256 rawPrice = vault.currentOracleRawPrice();
            return _strategyWithRange(
                feeBps,
                salt,
                deadline,
                Math.sqrt(rawPrice * 9_500 / 10_000 * 1e18, Math.Rounding.Ceil),
                Math.sqrt((rawPrice * 10_500 + 9_999) / 10_000 * 1e18)
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
                maxPositionUsdc: 100_000_000,
                maxPositionWeth: 10 ether
            });
        }

        function _strategyWithRange(
            uint16 feeBps,
            uint64 salt,
            uint40 deadline,
            uint256 sqrtPriceMin,
            uint256 sqrtPriceMax
        ) private view returns (bytes memory) {
            bytes memory program = abi.encodePacked(bytes1(0x20), bytes1(uint8(5)), deadline);
            if (feeBps != 0) {
                program = bytes.concat(
                    program,
                    abi.encodePacked(bytes1(0x70), bytes1(uint8(3)), uint24(feeBps) * 1_000)
                );
            }
            program = bytes.concat(
                program,
                abi.encodePacked(
                    bytes1(0x51),
                    bytes1(uint8(64)),
                    sqrtPriceMin,
                    sqrtPriceMax,
                    bytes1(0x02),
                    bytes1(uint8(8)),
                    salt
                )
            );
            (address tokenLt, address tokenGt) = address(usdc) < address(weth)
                ? (address(usdc), address(weth))
                : (address(weth), address(usdc));
            return abi.encode(
                StarFamilyVault.SwapVmOrder({
                    maker: address(vault),
                    traits: DEFAULT_MAKER_TRAITS,
                    data: bytes.concat(bytes20(tokenLt), bytes20(tokenGt), program)
                })
            );
        }
    }
