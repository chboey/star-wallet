// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { StarGoals } from "../src/StarGoals.sol";
import { StarRegistry } from "../src/StarRegistry.sol";
import { StarToken } from "../src/StarToken.sol";

interface GoalsVm {
    function expectRevert(bytes4 selector) external;
    function expectPartialRevert(bytes4 selector) external;
    function prank(address caller) external;
}

contract StarGoalsTest {
    GoalsVm private constant VM = GoalsVm(address(uint160(uint256(keccak256("hevm cheat code")))));
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

    function testParentCreatesAndCancelsGoal() public {
        uint256 goalId = goals.createGoal(childId, "Bicycle", 20);
        StarGoals.Goal memory goal = goals.getGoal(goalId);

        require(goal.childId == childId, "child");
        require(keccak256(bytes(goal.title)) == keccak256("Bicycle"), "title");
        require(goal.starCost == 20, "cost");
        require(goal.status == StarGoals.GoalStatus.Active, "active");

        goals.cancelGoal(goalId);
        require(goals.getGoal(goalId).status == StarGoals.GoalStatus.Cancelled, "cancelled");
    }

    function testOnlyActiveParentCreatesValidGoals() public {
        VM.prank(OTHER);
        VM.expectPartialRevert(StarGoals.NotFamilyParent.selector);
        goals.createGoal(childId, "Bicycle", 20);

        VM.expectRevert(StarGoals.InvalidTitle.selector);
        goals.createGoal(childId, "", 20);
        VM.expectRevert(StarGoals.InvalidStarCost.selector);
        goals.createGoal(childId, "Bicycle", 0);

        registry.setFamilyStatus(familyId, false);
        VM.expectPartialRevert(StarGoals.FamilyInactive.selector);
        goals.createGoal(childId, "Bicycle", 20);
    }

    function testChildRequestReservesAvailableStars() public {
        token.mint(CHILD, 30);
        uint256 firstGoal = goals.createGoal(childId, "Bicycle", 20);
        uint256 secondGoal = goals.createGoal(childId, "Books", 20);

        VM.prank(CHILD);
        uint256 redemptionId = goals.requestRedemption(firstGoal);
        StarGoals.Redemption memory redemption = goals.getRedemption(redemptionId);
        require(redemption.goalId == firstGoal && redemption.reservedStars == 20, "redemption");
        require(redemption.status == StarGoals.RedemptionStatus.Pending, "pending");
        require(goals.reservedStars(childId) == 20, "reserved");
        require(goals.availableStars(childId) == 10, "available");

        VM.prank(CHILD);
        VM.expectPartialRevert(StarGoals.InsufficientAvailableStars.selector);
        goals.requestRedemption(secondGoal);
    }

    function testApprovalBurnsStarsAndCompletesGoal() public {
        token.mint(CHILD, 20);
        uint256 goalId = goals.createGoal(childId, "Bicycle", 20);
        VM.prank(CHILD);
        uint256 redemptionId = goals.requestRedemption(goalId);

        goals.approveRedemption(redemptionId);
        require(goals.getGoal(goalId).status == StarGoals.GoalStatus.Completed, "completed");
        require(
            goals.getRedemption(redemptionId).status == StarGoals.RedemptionStatus.Approved,
            "approved"
        );
        require(token.balanceOf(CHILD) == 0 && token.totalStarsBurned() == 20, "burned");
        require(goals.reservedStars(childId) == 0, "reservation cleared");
    }

    function testRejectAndCancelReleaseReservations() public {
        token.mint(CHILD, 20);
        uint256 goalId = goals.createGoal(childId, "Bicycle", 20);
        VM.prank(CHILD);
        uint256 redemptionId = goals.requestRedemption(goalId);
        goals.rejectRedemption(redemptionId);
        require(goals.reservedStars(childId) == 0, "rejection releases");
        require(goals.getGoal(goalId).status == StarGoals.GoalStatus.Active, "goal remains active");

        VM.prank(CHILD);
        redemptionId = goals.requestRedemption(goalId);
        VM.prank(CHILD);
        goals.cancelRedemption(redemptionId);
        require(goals.reservedStars(childId) == 0, "cancellation releases");
        require(token.balanceOf(CHILD) == 20, "Stars unchanged");
    }

    function testPendingRedemptionCannotBeDuplicatedOrBypassOwnership() public {
        token.mint(CHILD, 20);
        uint256 goalId = goals.createGoal(childId, "Bicycle", 20);

        VM.prank(OTHER);
        VM.expectPartialRevert(StarGoals.NotChildWallet.selector);
        goals.requestRedemption(goalId);

        VM.prank(CHILD);
        uint256 redemptionId = goals.requestRedemption(goalId);
        VM.prank(CHILD);
        VM.expectPartialRevert(StarGoals.PendingRedemptionExists.selector);
        goals.requestRedemption(goalId);
        VM.expectPartialRevert(StarGoals.PendingRedemptionExists.selector);
        goals.cancelGoal(goalId);

        VM.prank(OTHER);
        VM.expectPartialRevert(StarGoals.NotFamilyParent.selector);
        goals.approveRedemption(redemptionId);
    }
}
