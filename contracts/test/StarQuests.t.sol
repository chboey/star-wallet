// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import { StarRegistry } from "../src/StarRegistry.sol";
import { StarToken } from "../src/StarToken.sol";
import { StarFamilyVault } from "../src/StarFamilyVault.sol";
import { StarFamilyVaultFactory } from "../src/StarFamilyVaultFactory.sol";
import { StarQuests } from "../src/StarQuests.sol";
import { MockERC20, MockFeed, MockAqua } from "./StarFamilyVault.t.sol";

interface QuestVm {
    function prank(address) external;
    function expectRevert() external;
    function warp(uint256) external;
}

contract StarQuestsTest {
    QuestVm constant vm = QuestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    StarRegistry registry;
    StarToken token;
    MockERC20 usdc;
    StarFamilyVault vault;
    StarQuests quests;
    uint256 familyId;
    uint256 childId;
    address constant CHILD = address(0xCAFE);
    address constant OTHER = address(0xBAD);

    function setUp() public {
        vm.warp(1_000_000);
        registry = new StarRegistry();
        token = new StarToken(address(this));
        usdc = new MockERC20();
        usdc.setDecimals(6);
        MockERC20 weth = new MockERC20();
        weth.setDecimals(18);
        StarFamilyVaultFactory factory = new StarFamilyVaultFactory(
            address(registry),
            address(token),
            address(usdc),
            address(weth),
            address(new MockAqua()),
            address(0x1234),
            address(this),
            StarFamilyVault.AquaSafetyConfig({
                ethUsdFeed: address(new MockFeed(8, 2000e8, block.timestamp)),
                usdcUsdFeed: address(new MockFeed(8, 1e8, block.timestamp)),
                ethUsdMaxAgeSeconds: 3600,
                usdcUsdMaxAgeSeconds: 90000,
                maxStrategyPriceDeviationBps: 1000,
                maxStrategyLifetimeSeconds: 1800,
                maxPositionUsdc: 1_000_000e6,
                maxPositionWeth: 1e18
            })
        );
        token.grantRole(token.VAULT_FACTORY_ROLE(), address(factory));
        familyId = registry.createFamily("family.starwallet.eth");
        bytes32 registration =
            registry.proposeChildRegistration(familyId, CHILD, "child.family.starwallet.eth");
        vm.prank(CHILD);
        childId = registry.acceptChildRegistration(registration);
        vault = StarFamilyVault(factory.createFamilyVault(familyId));
        quests = vault.quests();
        usdc.mint(address(this), 100e6);
        usdc.approve(address(vault), 100e6);
        require(address(quests.vault()) == address(vault));
        require(address(factory).code.length <= 24576);
    }

    function request(uint256 amount, bytes32 nonce) private returns (uint256 id) {
        vm.prank(CHILD);
        return quests.requestStars(amount, "Helped tidy up", nonce);
    }

    function testQuestApprovalIsAtomicAndSingleUse() public {
        uint256 questId = quests.createQuest(childId, 3, "Read a book");
        vm.prank(CHILD);
        uint256 id = quests.submitQuest(questId, bytes32(uint256(1)));
        require(token.balanceOf(CHILD) == 0 && usdc.balanceOf(address(vault)) == 0);
        vault.approveStarRequest(id);
        require(token.balanceOf(CHILD) == 3 && usdc.balanceOf(address(vault)) == 3e6);
        require(quests.getQuest(questId).status == StarQuests.QuestStatus.Completed);
        vm.expectRevert();
        vault.approveStarRequest(id);
        vm.expectRevert();
        vm.prank(CHILD);
        quests.submitQuest(questId, bytes32(uint256(2)));
        require(token.balanceOf(CHILD) == 3);
    }

    function testInsufficientAllowanceRollsBackConsumptionAndAccounting() public {
        uint256 id = request(5, bytes32(uint256(1)));
        usdc.approve(address(vault), 0);
        vm.expectRevert();
        vault.approveStarRequest(id);
        require(quests.getRequest(id).status == StarQuests.RequestStatus.Pending);
        require(quests.pendingRequestsByChild(childId) == 1 && token.balanceOf(CHILD) == 0);
        require(vault.getFamilyAccount().totalPrincipalContributed == 0);
        usdc.approve(address(vault), 5e6);
        vault.approveStarRequest(id);
        require(token.balanceOf(CHILD) == 5);
    }

    function testMintFailureAlsoRollsBackUsdcAndRequest() public {
        uint256 id = request(5, bytes32(uint256(1)));
        token.grantRole(token.VAULT_FACTORY_ROLE(), address(this));
        token.revokeRole(token.MINTER_ROLE(), address(vault));
        vm.expectRevert();
        vault.approveStarRequest(id);
        require(quests.getRequest(id).status == StarQuests.RequestStatus.Pending);
        require(usdc.balanceOf(address(this)) == 100e6 && usdc.balanceOf(address(vault)) == 0);
    }

    function testOnlyParentCanRewardOrRejectAndOnlyVaultCanConsume() public {
        uint256 id = request(5, bytes32(uint256(1)));
        vm.expectRevert();
        vm.prank(CHILD);
        vault.approveStarRequest(id);
        vm.expectRevert();
        vm.prank(CHILD);
        quests.rejectRequest(id);
        vm.expectRevert();
        quests.consumeRequest(id, 1);
        vm.expectRevert();
        vm.prank(OTHER);
        vault.approveStarRequest(id);
        vm.expectRevert();
        vm.prank(CHILD);
        quests.createQuest(childId, 100, "Cheat");
    }

    function testRejectionAllowsQuestRetryButNotOldRequestApproval() public {
        uint256 questId = quests.createQuest(childId, 3, "Read");
        vm.prank(CHILD);
        uint256 id = quests.submitQuest(questId, bytes32(uint256(1)));
        vm.expectRevert();
        quests.cancelQuest(questId);
        quests.rejectRequest(id);
        vm.expectRevert();
        vault.approveStarRequest(id);
        vm.expectRevert();
        vm.prank(CHILD);
        quests.submitQuest(questId, bytes32(uint256(1)));
        vm.prank(CHILD);
        uint256 next = quests.submitQuest(questId, bytes32(uint256(2)));
        vault.approveStarRequest(next);
        require(token.balanceOf(CHILD) == 3);
    }

    function testCancellationWinsRaceAndRemainsPossibleWhenInactive() public {
        uint256 id = request(5, bytes32(uint256(1)));
        registry.setChildStatus(childId, false);
        vm.expectRevert();
        vault.approveStarRequest(id);
        vm.expectRevert();
        vm.prank(OTHER);
        quests.cancelRequest(id);
        vm.prank(CHILD);
        quests.cancelRequest(id);
        vm.expectRevert();
        vault.approveStarRequest(id);
        require(quests.pendingRequestsByChild(childId) == 0);
    }

    function testSubmissionReplayAndPendingCap() public {
        request(1, bytes32(uint256(1)));
        vm.expectRevert();
        request(1, bytes32(uint256(1)));
        for (uint256 i = 2; i <= 5; i++) {
            request(1, bytes32(i));
        }
        vm.expectRevert();
        request(1, bytes32(uint256(6)));
        quests.rejectRequest(1);
        request(1, bytes32(uint256(6)));
    }

    function testWrongFamilyAndInvalidTerms() public {
        vm.prank(OTHER);
        uint256 otherFamily = registry.createFamily("other.starwallet.eth");
        vm.prank(OTHER);
        bytes32 registration = registry.proposeChildRegistration(
            otherFamily, address(0xBEEF), "child.other.starwallet.eth"
        );
        vm.prank(address(0xBEEF));
        uint256 otherChild = registry.acceptChildRegistration(registration);
        vm.expectRevert();
        quests.createQuest(otherChild, 5, "Wrong family");
        vm.expectRevert();
        vm.prank(address(0xBEEF));
        quests.requestStars(5, "Wrong family", bytes32(uint256(1)));
        vm.expectRevert();
        request(1001, bytes32(uint256(1)));
        vm.expectRevert();
        request(0, bytes32(uint256(1)));
        vm.expectRevert();
        request(1, bytes32(0));
        registry.setFamilyStatus(familyId, false);
        vm.expectRevert();
        request(1, bytes32(uint256(1)));
    }
}
