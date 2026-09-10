// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { StarGoals } from "../src/StarGoals.sol";
import { StarRegistry } from "../src/StarRegistry.sol";
import { StarToken } from "../src/StarToken.sol";

interface GoalRequestVm {
    function expectRevert(bytes4 selector) external;
    function expectPartialRevert(bytes4 selector) external;
    function prank(address caller) external;
}

contract StarGoalRequestsTest {
    GoalRequestVm private constant VM =
        GoalRequestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant CHILD = address(0xCAFE);
    address private constant OTHER = address(0xBAD);

    StarRegistry private registry;
    StarToken private token;
    StarGoals private goals;
    uint256 private familyId;
    uint256 private childId;

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
        VM.prank(CHILD);
        childId = registry.acceptChildRegistration(registration);
    }

    function testRequestPreservesMetadataWithoutCreatingGoalOrSpendingStars() public {
        bytes32 submissionId = bytes32(uint256(1));
        uint256 requestId = _request(submissionId);
        StarGoals.GoalRequest memory request = goals.getGoalRequest(requestId);

        require(request.childId == childId && request.icon == 6 && request.goalId == 0, "metadata");
        require(keccak256(bytes(request.title)) == keccak256("Rocket Toy"), "title");
        require(keccak256(bytes(request.reason)) == keccak256("Space adventures"), "reason");
        require(request.status == StarGoals.RedemptionStatus.Pending, "pending");
        require(goals.nextGoalId() == 1 && token.balanceOf(CHILD) == 0, "no goal or spend");
        require(goals.usedGoalSubmissionIds(CHILD, submissionId), "submission recorded");

        VM.prank(CHILD);
        VM.expectRevert(StarGoals.GoalSubmissionAlreadyUsed.selector);
        goals.requestGoal(childId, "Rocket Toy", "Space adventures", 6, submissionId);
    }

    function testOnlyChildRequestsAndOnlyParentApproves() public {
        VM.expectPartialRevert(StarGoals.NotChildWallet.selector);
        goals.requestGoal(childId, "Toy", "", 1, bytes32(uint256(1)));
        VM.prank(OTHER);
        VM.expectPartialRevert(StarGoals.NotChildWallet.selector);
        goals.requestGoal(childId, "Toy", "", 1, bytes32(uint256(1)));

        uint256 requestId = _request(bytes32(uint256(1)));
        VM.prank(CHILD);
        VM.expectPartialRevert(StarGoals.NotFamilyParent.selector);
        goals.approveGoalRequest(requestId, 20);
        VM.prank(OTHER);
        VM.expectPartialRevert(StarGoals.NotFamilyParent.selector);
        goals.approveGoalRequest(requestId, 20);

        uint256 goalId = goals.approveGoalRequest(requestId, 20);
        require(goals.getGoal(goalId).starCost == 20, "goal cost");
        require(goals.getGoalRequest(requestId).goalId == goalId, "linked goal");
        require(
            goals.getGoalRequest(requestId).status == StarGoals.RedemptionStatus.Approved,
            "approved"
        );
    }

    function testInvalidApprovalRollsBackAndApprovedGoalUsesRedemptionFlow() public {
        uint256 requestId = _request(bytes32(uint256(1)));
        VM.expectRevert(StarGoals.InvalidStarCost.selector);
        goals.approveGoalRequest(requestId, 0);
        require(
            goals.getGoalRequest(requestId).status == StarGoals.RedemptionStatus.Pending,
            "request remains pending"
        );

        uint256 goalId = goals.approveGoalRequest(requestId, 20);
        token.mint(CHILD, 20);
        VM.prank(CHILD);
        goals.addStarsToGoal(goalId, 20);
        VM.prank(CHILD);
        uint256 redemptionId = goals.requestRedemption(goalId);
        goals.approveRedemption(redemptionId);
        require(goals.getGoal(goalId).status == StarGoals.GoalStatus.Completed, "completed");
        require(token.balanceOf(CHILD) == 0, "Stars burned");
    }

    function testRejectAndCancelRespectOwnershipAndPendingState() public {
        uint256 requestId = _request(bytes32(uint256(1)));
        VM.prank(OTHER);
        VM.expectPartialRevert(StarGoals.NotFamilyParent.selector);
        goals.rejectGoalRequest(requestId);
        VM.expectPartialRevert(StarGoals.NotChildWallet.selector);
        goals.cancelGoalRequest(requestId);

        goals.rejectGoalRequest(requestId);
        require(
            goals.getGoalRequest(requestId).status == StarGoals.RedemptionStatus.Rejected,
            "rejected"
        );
        VM.expectPartialRevert(StarGoals.GoalRequestNotPending.selector);
        goals.approveGoalRequest(requestId, 10);

        requestId = _request(bytes32(uint256(2)));
        VM.prank(CHILD);
        goals.cancelGoalRequest(requestId);
        require(
            goals.getGoalRequest(requestId).status == StarGoals.RedemptionStatus.Cancelled,
            "cancelled"
        );
    }

    function testInactiveAccountsCannotRequestOrApprove() public {
        uint256 requestId = _request(bytes32(uint256(1)));
        registry.setFamilyStatus(familyId, false);
        VM.prank(CHILD);
        VM.expectPartialRevert(StarGoals.FamilyInactive.selector);
        goals.requestGoal(childId, "Toy", "", 1, bytes32(uint256(2)));
        VM.expectPartialRevert(StarGoals.FamilyInactive.selector);
        goals.approveGoalRequest(requestId, 10);
        goals.rejectGoalRequest(requestId);

        registry.setFamilyStatus(familyId, true);
        requestId = _request(bytes32(uint256(3)));
        registry.setChildStatus(childId, false);
        VM.expectPartialRevert(StarGoals.ChildInactive.selector);
        goals.approveGoalRequest(requestId, 10);
        VM.prank(CHILD);
        goals.cancelGoalRequest(requestId);
    }

    function testValidatesMetadataAndSubmissionBounds() public {
        VM.prank(CHILD);
        VM.expectRevert(StarGoals.InvalidGoalRequest.selector);
        goals.requestGoal(childId, "", "", 0, bytes32(uint256(1)));
        VM.prank(CHILD);
        VM.expectRevert(StarGoals.InvalidGoalRequest.selector);
        goals.requestGoal(childId, string(new bytes(65)), "", 0, bytes32(uint256(1)));
        VM.prank(CHILD);
        VM.expectRevert(StarGoals.InvalidGoalRequest.selector);
        goals.requestGoal(childId, "Toy", string(new bytes(481)), 0, bytes32(uint256(1)));
        VM.prank(CHILD);
        VM.expectRevert(StarGoals.InvalidGoalRequest.selector);
        goals.requestGoal(childId, "Toy", "", 7, bytes32(uint256(1)));
        VM.prank(CHILD);
        VM.expectRevert(StarGoals.InvalidGoalRequest.selector);
        goals.requestGoal(childId, "Toy", "", 1, bytes32(0));
    }

    function _request(bytes32 submissionId) private returns (uint256) {
        VM.prank(CHILD);
        return goals.requestGoal(childId, "Rocket Toy", "Space adventures", 6, submissionId);
    }
}
