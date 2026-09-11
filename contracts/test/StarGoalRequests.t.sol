// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { StarRegistry } from "../src/StarRegistry.sol";
import { StarToken } from "../src/StarToken.sol";
import { StarGoals } from "../src/StarGoals.sol";

interface GoalRequestVm {
    function prank(address) external;
    function expectRevert() external;
}

contract StarGoalRequestsTest {
    GoalRequestVm constant vm =
        GoalRequestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    StarRegistry registry;
    StarToken token;
    StarGoals goals;
    uint256 familyId;
    uint256 childId;
    address constant CHILD = address(0xCAFE);
    address constant OTHER = address(0xBAD);

    function setUp() public {
        registry = new StarRegistry();
        token = new StarToken(address(this));
        goals = new StarGoals(address(registry), address(token));
        token.grantRole(token.BURNER_ROLE(), address(goals));
        token.grantRole(token.VAULT_FACTORY_ROLE(), address(this));
        token.grantRole(token.MINTER_ROLE(), address(this));
        familyId = registry.createFamily("family.starwallet.eth");
        bytes32 registration =
            registry.proposeChildRegistration(familyId, CHILD, "kid.family.starwallet.eth");
        vm.prank(CHILD);
        childId = registry.acceptChildRegistration(registration);
    }

    function request(bytes32 submission) private returns (uint256) {
        vm.prank(CHILD);
        return goals.requestGoal(childId, "Rocket Toy", "To play space adventures", 6, submission);
    }

    function testRequestPreservesMetadataWithoutCreatingGoalOrSpendingStars() public {
        uint256 id = request(bytes32(uint256(1)));
        StarGoals.GoalRequest memory item = goals.getGoalRequest(id);
        require(item.childId == childId && item.icon == 6 && item.goalId == 0);
        require(keccak256(bytes(item.title)) == keccak256("Rocket Toy"));
        require(keccak256(bytes(item.reason)) == keccak256("To play space adventures"));
        require(item.status == StarGoals.RedemptionStatus.Pending);
        require(goals.nextGoalId() == 1 && token.balanceOf(CHILD) == 0);
        require(goals.usedGoalSubmissionIds(CHILD, bytes32(uint256(1))));
        vm.expectRevert();
        request(bytes32(uint256(1)));
    }

    function testOnlyRegisteredChildCanRequestAndOnlyTheirParentCanApprove() public {
        vm.expectRevert();
        goals.requestGoal(childId, "Toy", "", 1, bytes32(uint256(1)));
        vm.expectRevert();
        vm.prank(OTHER);
        goals.requestGoal(childId, "Toy", "", 1, bytes32(uint256(1)));
        uint256 id = request(bytes32(uint256(1)));
        vm.expectRevert();
        vm.prank(CHILD);
        goals.approveGoalRequest(id, 20);
        vm.expectRevert();
        vm.prank(OTHER);
        goals.approveGoalRequest(id, 20);
        uint256 goalId = goals.approveGoalRequest(id, 20);
        require(goals.getGoal(goalId).starCost == 20);
        require(goals.getGoalRequest(id).goalId == goalId);
        require(goals.getGoalRequest(id).status == StarGoals.RedemptionStatus.Approved);
        require(token.balanceOf(CHILD) == 0 && goals.reservedStars(childId) == 0);
        vm.expectRevert();
        goals.approveGoalRequest(id, 30);
    }

    function testInvalidTargetRollsBackAndApprovedGoalUsesExistingRedemptionFlow() public {
        uint256 id = request(bytes32(uint256(1)));
        vm.expectRevert();
        goals.approveGoalRequest(id, 0);
        require(goals.getGoalRequest(id).status == StarGoals.RedemptionStatus.Pending);
        uint256 goalId = goals.approveGoalRequest(id, 20);
        token.mint(CHILD, 20);
        vm.prank(CHILD);
        goals.addStarsToGoal(goalId, 20);
        vm.prank(CHILD);
        uint256 redemptionId = goals.requestRedemption(goalId);
        require(goals.reservedStars(childId) == 20);
        goals.approveRedemption(redemptionId);
        require(goals.getGoal(goalId).status == StarGoals.GoalStatus.Completed);
        require(token.balanceOf(CHILD) == 0 && goals.reservedStars(childId) == 0);
    }

    function testRejectAndCancelOnlyPendingRequestsAndRespectOwnership() public {
        uint256 id = request(bytes32(uint256(1)));
        vm.expectRevert();
        vm.prank(OTHER);
        goals.rejectGoalRequest(id);
        vm.expectRevert();
        goals.cancelGoalRequest(id);
        goals.rejectGoalRequest(id);
        require(goals.getGoalRequest(id).status == StarGoals.RedemptionStatus.Rejected);
        vm.expectRevert();
        goals.approveGoalRequest(id, 10);
        id = request(bytes32(uint256(2)));
        vm.prank(CHILD);
        goals.cancelGoalRequest(id);
        require(goals.getGoalRequest(id).status == StarGoals.RedemptionStatus.Cancelled);
        vm.expectRevert();
        goals.rejectGoalRequest(id);
    }

    function testInactiveFamiliesCannotRequestOrApproveButCanResolvePendingRequests() public {
        uint256 id = request(bytes32(uint256(1)));
        registry.setFamilyStatus(familyId, false);
        vm.expectRevert();
        request(bytes32(uint256(2)));
        vm.expectRevert();
        goals.approveGoalRequest(id, 10);
        goals.rejectGoalRequest(id);
        registry.setFamilyStatus(familyId, true);
        id = request(bytes32(uint256(3)));
        registry.setChildStatus(childId, false);
        vm.expectRevert();
        goals.approveGoalRequest(id, 10);
        vm.prank(CHILD);
        goals.cancelGoalRequest(id);
    }

    function testMetadataAndSubmissionBounds() public {
        vm.expectRevert();
        vm.prank(CHILD);
        goals.requestGoal(childId, "", "", 0, bytes32(uint256(1)));
        vm.expectRevert();
        vm.prank(CHILD);
        goals.requestGoal(childId, string(new bytes(65)), "", 0, bytes32(uint256(1)));
        vm.expectRevert();
        vm.prank(CHILD);
        goals.requestGoal(childId, "Toy", string(new bytes(481)), 0, bytes32(uint256(1)));
        vm.expectRevert();
        vm.prank(CHILD);
        goals.requestGoal(childId, "Toy", "", 7, bytes32(uint256(1)));
        vm.expectRevert();
        request(bytes32(0));
    }
}
