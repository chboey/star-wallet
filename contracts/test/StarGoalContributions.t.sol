// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { StarGoalRequestsTest } from "./StarGoalRequests.t.sol";
import { StarGoals } from "../src/StarGoals.sol";

contract StarGoalContributionsTest is StarGoalRequestsTest {
    function add(uint256 id, uint256 amount) private {
        vm.prank(CHILD);
        goals.addStarsToGoal(id, amount);
    }

    function testGoalsStartEmptyEvenWhenChildAlreadyHasStars() public {
        token.mint(CHILD, 100);
        uint256 id = goals.createGoal(childId, "Game", 10);
        require(goals.allocatedStars(id) == 0 && goals.availableStars(childId) == 100);
        vm.expectRevert();
        vm.prank(CHILD);
        goals.requestRedemption(id);
    }

    function testPartialContributionsReserveOnlyTheChosenAmountAndCannotBeDoubleSpent() public {
        token.mint(CHILD, 15);
        uint256 game = goals.createGoal(childId, "Game", 10);
        uint256 book = goals.createGoal(childId, "Book", 10);
        add(game, 4);
        add(book, 6);
        require(goals.allocatedStars(game) == 4 && goals.allocatedStars(book) == 6);
        require(goals.reservedStars(childId) == 10 && goals.availableStars(childId) == 5);
        require(token.balanceOf(CHILD) == 15 && token.totalStarsBurned() == 0);
        vm.expectRevert();
        add(game, 6);
        vm.expectRevert();
        vm.prank(CHILD);
        goals.requestRedemption(game);
        add(book, 4);
        vm.prank(CHILD);
        uint256 claim = goals.requestRedemption(book);
        require(goals.reservedStars(childId) == 14, "Claim must not reserve twice");
        goals.approveRedemption(claim);
        require(goals.allocatedStars(book) == 0 && goals.allocatedStars(game) == 4);
        require(goals.reservedStars(childId) == 4 && goals.availableStars(childId) == 1);
        require(token.balanceOf(CHILD) == 5 && token.totalStarsBurned() == 10);
    }

    function testContributionBoundsOwnershipAndStatus() public {
        token.mint(CHILD, 100);
        uint256 id = goals.createGoal(childId, "Game", 10);
        vm.expectRevert();
        goals.addStarsToGoal(id, 1);
        vm.expectRevert();
        vm.prank(OTHER);
        goals.addStarsToGoal(id, 1);
        vm.expectRevert();
        add(id, 0);
        vm.expectRevert();
        add(id, 11);
        vm.expectRevert();
        add(999, 1);
        registry.setChildStatus(childId, false);
        vm.expectRevert();
        add(id, 1);
        registry.setChildStatus(childId, true);
        registry.setFamilyStatus(familyId, false);
        vm.expectRevert();
        add(id, 1);
        registry.setFamilyStatus(familyId, true);
        add(id, 10);
        vm.prank(CHILD);
        uint256 claim = goals.requestRedemption(id);
        vm.expectRevert();
        add(id, 1);
        vm.expectRevert();
        goals.cancelGoal(id);
        goals.approveRedemption(claim);
        vm.expectRevert();
        add(id, 1);
        vm.expectRevert();
        goals.approveRedemption(claim);
    }

    function testCancellingPartiallyFundedGoalReturnsStarsWithoutBurning() public {
        token.mint(CHILD, 15);
        uint256 id = goals.createGoal(childId, "Game", 10);
        add(id, 4);
        registry.setFamilyStatus(familyId, false);
        goals.cancelGoal(id);
        require(goals.allocatedStars(id) == 0 && goals.reservedStars(childId) == 0);
        require(goals.availableStars(childId) == 15 && token.balanceOf(CHILD) == 15);
        vm.expectRevert();
        add(id, 1);
    }

    function testCancelledAndRejectedClaimsReleaseContributionsAndRequireFundingAgain() public {
        token.mint(CHILD, 15);
        uint256 id = goals.createGoal(childId, "Game", 10);
        add(id, 10);
        vm.prank(CHILD);
        uint256 claim = goals.requestRedemption(id);
        goals.rejectRedemption(claim);
        require(goals.allocatedStars(id) == 0 && goals.availableStars(childId) == 15);
        vm.expectRevert();
        vm.prank(CHILD);
        goals.requestRedemption(id);
        add(id, 10);
        vm.prank(CHILD);
        claim = goals.requestRedemption(id);
        vm.prank(CHILD);
        goals.cancelRedemption(claim);
        require(goals.allocatedStars(id) == 0 && goals.reservedStars(childId) == 0);
        require(token.balanceOf(CHILD) == 15 && token.totalStarsBurned() == 0);
    }

    function testFuzzReservationsEqualOutstandingGoalAllocations(uint64 first, uint64 second)
        public
    {
        uint256 a = uint256(first) + 1;
        uint256 b = uint256(second) + 1;
        token.mint(CHILD, a + b);
        uint256 one = goals.createGoal(childId, "Game", a);
        uint256 two = goals.createGoal(childId, "Book", b);
        add(one, a);
        add(two, b);
        require(goals.reservedStars(childId) == a + b && goals.availableStars(childId) == 0);
        vm.prank(CHILD);
        uint256 claim = goals.requestRedemption(one);
        goals.approveRedemption(claim);
        require(goals.reservedStars(childId) == goals.allocatedStars(two));
        require(token.balanceOf(CHILD) == b && goals.availableStars(childId) == 0);
        goals.cancelGoal(two);
        require(goals.reservedStars(childId) == 0 && goals.availableStars(childId) == b);
    }
}
