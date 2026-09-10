// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IStarRegistry } from "./interfaces/IStarRegistry.sol";
import { IStarToken } from "./interfaces/IStarToken.sol";

contract StarGoals {
    enum GoalStatus {
        Active,
        Completed,
        Cancelled
    }

    enum RedemptionStatus {
        Pending,
        Approved,
        Rejected,
        Cancelled
    }

    struct Goal {
        uint256 id;
        uint256 childId;
        string title;
        uint256 starCost;
        GoalStatus status;
        uint64 createdAt;
    }

    struct Redemption {
        uint256 id;
        uint256 goalId;
        uint256 childId;
        uint256 reservedStars;
        RedemptionStatus status;
        uint64 requestedAt;
        uint64 resolvedAt;
    }

    IStarRegistry public immutable registry;
    IStarToken public immutable star;
    uint256 public nextGoalId = 1;
    uint256 public nextRedemptionId = 1;

    mapping(uint256 goalId => Goal goal) private goals;
    mapping(uint256 redemptionId => Redemption redemption) private redemptions;
    mapping(uint256 childId => uint256 amount) public reservedStars;
    mapping(uint256 goalId => uint256 redemptionId) public pendingRedemptionForGoal;

    error ZeroAddress();
    error InvalidTitle();
    error InvalidStarCost();
    error GoalNotFound(uint256 goalId);
    error RedemptionNotFound(uint256 redemptionId);
    error NotChildWallet(uint256 childId, address account);
    error NotFamilyParent(uint256 familyId, address account);
    error FamilyInactive(uint256 familyId);
    error ChildInactive(uint256 childId);
    error InvalidGoalStatus(uint256 goalId, GoalStatus status);
    error InvalidRedemptionStatus(uint256 redemptionId, RedemptionStatus status);
    error PendingRedemptionExists(uint256 goalId, uint256 redemptionId);
    error InsufficientAvailableStars(uint256 available, uint256 required);

    event GoalCreated(
        uint256 indexed goalId, uint256 indexed childId, uint256 starCost, string title
    );
    event GoalCancelled(uint256 indexed goalId, uint256 indexed childId);
    event GoalCompleted(uint256 indexed goalId, uint256 indexed childId);
    event RedemptionRequested(
        uint256 indexed redemptionId,
        uint256 indexed goalId,
        uint256 indexed childId,
        uint256 reservedStars
    );
    event RedemptionApproved(uint256 indexed redemptionId, uint256 indexed goalId);
    event RedemptionRejected(uint256 indexed redemptionId, uint256 indexed goalId);
    event RedemptionCancelled(uint256 indexed redemptionId, uint256 indexed goalId);

    constructor(address registryAddress, address starAddress) {
        if (registryAddress == address(0) || starAddress == address(0)) revert ZeroAddress();
        registry = IStarRegistry(registryAddress);
        star = IStarToken(starAddress);
    }

    function createGoal(uint256 childId, string calldata title, uint256 starCost)
        external
        returns (uint256 goalId)
    {
        IStarRegistry.Child memory child = registry.getChild(childId);
        _requireActiveParent(child.familyId, msg.sender);
        if (!child.active) revert ChildInactive(childId);
        uint256 titleLength = bytes(title).length;
        if (titleLength == 0 || titleLength > 64) revert InvalidTitle();
        if (starCost == 0) revert InvalidStarCost();

        goalId = nextGoalId++;
        goals[goalId] = Goal({
            id: goalId,
            childId: childId,
            title: title,
            starCost: starCost,
            status: GoalStatus.Active,
            createdAt: uint64(block.timestamp)
        });
        emit GoalCreated(goalId, childId, starCost, title);
    }

    function cancelGoal(uint256 goalId) external {
        Goal storage goal = _goal(goalId);
        IStarRegistry.Child memory child = registry.getChild(goal.childId);
        _requireParent(child.familyId, msg.sender);
        if (goal.status != GoalStatus.Active) revert InvalidGoalStatus(goalId, goal.status);
        uint256 pendingId = pendingRedemptionForGoal[goalId];
        if (pendingId != 0) revert PendingRedemptionExists(goalId, pendingId);
        goal.status = GoalStatus.Cancelled;
        emit GoalCancelled(goalId, goal.childId);
    }

    function requestRedemption(uint256 goalId) external returns (uint256 redemptionId) {
        Goal storage goal = _goal(goalId);
        if (goal.status != GoalStatus.Active) revert InvalidGoalStatus(goalId, goal.status);
        IStarRegistry.Child memory child = registry.getChild(goal.childId);
        _requireFamilyActive(child.familyId);
        if (!child.active) revert ChildInactive(child.id);
        if (msg.sender != child.wallet) revert NotChildWallet(child.id, msg.sender);
        uint256 pendingId = pendingRedemptionForGoal[goalId];
        if (pendingId != 0) revert PendingRedemptionExists(goalId, pendingId);

        uint256 balance = star.balanceOf(child.wallet);
        uint256 reserved = reservedStars[child.id];
        uint256 available = balance >= reserved ? balance - reserved : 0;
        if (goal.starCost > available) {
            revert InsufficientAvailableStars(available, goal.starCost);
        }

        reservedStars[child.id] = reserved + goal.starCost;
        redemptionId = nextRedemptionId++;
        redemptions[redemptionId] = Redemption({
            id: redemptionId,
            goalId: goalId,
            childId: child.id,
            reservedStars: goal.starCost,
            status: RedemptionStatus.Pending,
            requestedAt: uint64(block.timestamp),
            resolvedAt: 0
        });
        pendingRedemptionForGoal[goalId] = redemptionId;
        emit RedemptionRequested(redemptionId, goalId, child.id, goal.starCost);
    }

    function approveRedemption(uint256 redemptionId) external {
        Redemption storage redemption = _redemption(redemptionId);
        Goal storage goal = _goal(redemption.goalId);
        IStarRegistry.Child memory child = registry.getChild(redemption.childId);
        _requireParent(child.familyId, msg.sender);
        _requirePending(redemption);

        redemption.status = RedemptionStatus.Approved;
        redemption.resolvedAt = uint64(block.timestamp);
        reservedStars[child.id] -= redemption.reservedStars;
        pendingRedemptionForGoal[goal.id] = 0;
        goal.status = GoalStatus.Completed;
        star.burnFrom(child.wallet, redemption.reservedStars);

        emit RedemptionApproved(redemptionId, goal.id);
        emit GoalCompleted(goal.id, child.id);
    }

    function rejectRedemption(uint256 redemptionId) external {
        Redemption storage redemption = _redemption(redemptionId);
        Goal storage goal = _goal(redemption.goalId);
        IStarRegistry.Child memory child = registry.getChild(redemption.childId);
        _requireParent(child.familyId, msg.sender);
        _requirePending(redemption);

        redemption.status = RedemptionStatus.Rejected;
        redemption.resolvedAt = uint64(block.timestamp);
        reservedStars[child.id] -= redemption.reservedStars;
        pendingRedemptionForGoal[goal.id] = 0;
        emit RedemptionRejected(redemptionId, goal.id);
    }

    function cancelRedemption(uint256 redemptionId) external {
        Redemption storage redemption = _redemption(redemptionId);
        Goal storage goal = _goal(redemption.goalId);
        IStarRegistry.Child memory child = registry.getChild(redemption.childId);
        if (msg.sender != child.wallet) revert NotChildWallet(child.id, msg.sender);
        _requirePending(redemption);

        redemption.status = RedemptionStatus.Cancelled;
        redemption.resolvedAt = uint64(block.timestamp);
        reservedStars[child.id] -= redemption.reservedStars;
        pendingRedemptionForGoal[goal.id] = 0;
        emit RedemptionCancelled(redemptionId, goal.id);
    }

    function availableStars(uint256 childId) external view returns (uint256) {
        IStarRegistry.Child memory child = registry.getChild(childId);
        uint256 balance = star.balanceOf(child.wallet);
        uint256 reserved = reservedStars[childId];
        return balance >= reserved ? balance - reserved : 0;
    }

    function getGoal(uint256 goalId) external view returns (Goal memory) {
        return _goal(goalId);
    }

    function getRedemption(uint256 redemptionId) external view returns (Redemption memory) {
        return _redemption(redemptionId);
    }

    function _requireParent(uint256 familyId, address account) private view {
        IStarRegistry.Family memory family = registry.getFamily(familyId);
        if (family.parent != account) {
            revert NotFamilyParent(familyId, account);
        }
    }

    function _requireActiveParent(uint256 familyId, address account) private view {
        _requireParent(familyId, account);
        _requireFamilyActive(familyId);
    }

    function _requireFamilyActive(uint256 familyId) private view {
        IStarRegistry.Family memory family = registry.getFamily(familyId);
        if (!family.active) revert FamilyInactive(familyId);
    }

    function _requirePending(Redemption storage redemption) private view {
        if (redemption.status != RedemptionStatus.Pending) {
            revert InvalidRedemptionStatus(redemption.id, redemption.status);
        }
    }

    function _goal(uint256 goalId) private view returns (Goal storage goal) {
        goal = goals[goalId];
        if (goal.id == 0) revert GoalNotFound(goalId);
    }

    function _redemption(uint256 redemptionId)
        private
        view
        returns (Redemption storage redemption)
    {
        redemption = redemptions[redemptionId];
        if (redemption.id == 0) revert RedemptionNotFound(redemptionId);
    }
}
