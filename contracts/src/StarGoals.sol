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

    // Icon IDs are stable UI metadata: bicycle, toy, books, art, game, other, rocket.
    struct GoalRequest {
        uint256 id;
        uint256 childId;
        string title;
        string reason;
        uint8 icon;
        RedemptionStatus status;
        uint256 goalId;
        uint64 requestedAt;
        uint64 resolvedAt;
    }

    IStarRegistry public immutable registry;
    IStarToken public immutable star;
    uint256 public nextGoalId = 1;
    uint256 public nextRedemptionId = 1;
    uint256 public nextGoalRequestId = 1;
    uint256 public constant goalRequestsVersion = 1;
    uint256 public constant goalContributionsVersion = 1;

    mapping(uint256 goalId => Goal goal) private goals;
    mapping(uint256 redemptionId => Redemption redemption) private redemptions;
    mapping(uint256 childId => uint256 amount) public reservedStars;
    // Stars remain in the child's non-transferable balance, reserved per goal.
    mapping(uint256 goalId => uint256 amount) public allocatedStars;
    mapping(uint256 goalId => uint256 redemptionId) public pendingRedemptionForGoal;
    mapping(uint256 requestId => GoalRequest request) private goalRequests;
    mapping(address child => mapping(bytes32 submissionId => bool used)) public
        usedGoalSubmissionIds;

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
    error InvalidContribution();
    error GoalNotFunded(uint256 allocated, uint256 required);
    error InvalidGoalRequest();
    error GoalRequestNotPending(uint256 requestId);
    error GoalSubmissionAlreadyUsed();

    event GoalCreated(
        uint256 indexed goalId, uint256 indexed childId, uint256 starCost, string title
    );
    event GoalCancelled(uint256 indexed goalId, uint256 indexed childId);
    event GoalCompleted(uint256 indexed goalId, uint256 indexed childId);
    event GoalStarsAdded(
        uint256 indexed goalId, uint256 indexed childId, uint256 amount, uint256 totalAllocated
    );
    event RedemptionRequested(
        uint256 indexed redemptionId,
        uint256 indexed goalId,
        uint256 indexed childId,
        uint256 reservedStars
    );
    event RedemptionApproved(uint256 indexed redemptionId, uint256 indexed goalId);
    event RedemptionRejected(uint256 indexed redemptionId, uint256 indexed goalId);
    event RedemptionCancelled(uint256 indexed redemptionId, uint256 indexed goalId);
    event GoalRequested(
        uint256 indexed requestId,
        uint256 indexed childId,
        string title,
        string reason,
        uint8 icon,
        bytes32 submissionId
    );
    event GoalRequestApproved(uint256 indexed requestId, uint256 indexed goalId);
    event GoalRequestRejected(uint256 indexed requestId);
    event GoalRequestCancelled(uint256 indexed requestId);

    constructor(address registryAddress, address starAddress) {
        if (registryAddress == address(0) || starAddress == address(0)) revert ZeroAddress();
        registry = IStarRegistry(registryAddress);
        star = IStarToken(starAddress);
    }

    function createGoal(uint256 childId, string calldata title, uint256 starCost)
        external
        returns (uint256 goalId)
    {
        return _createGoal(childId, title, starCost);
    }

    function requestGoal(
        uint256 childId,
        string calldata title,
        string calldata reason,
        uint8 icon,
        bytes32 submissionId
    ) external returns (uint256 requestId) {
        IStarRegistry.Child memory child = registry.getChild(childId);
        if (msg.sender != child.wallet) revert NotChildWallet(childId, msg.sender);
        _requireFamilyActive(child.familyId);
        if (!child.active) revert ChildInactive(childId);
        if (
            bytes(title).length == 0 || bytes(title).length > 64 || bytes(reason).length > 480
                || icon > 6 || submissionId == bytes32(0)
        ) {
            revert InvalidGoalRequest();
        }
        if (usedGoalSubmissionIds[msg.sender][submissionId]) revert GoalSubmissionAlreadyUsed();
        usedGoalSubmissionIds[msg.sender][submissionId] = true;
        requestId = nextGoalRequestId++;
        goalRequests[requestId] = GoalRequest({
            id: requestId,
            childId: childId,
            title: title,
            reason: reason,
            icon: icon,
            status: RedemptionStatus.Pending,
            goalId: 0,
            requestedAt: uint64(block.timestamp),
            resolvedAt: 0
        });
        emit GoalRequested(requestId, childId, title, reason, icon, submissionId);
    }

    function approveGoalRequest(uint256 requestId, uint256 starCost)
        external
        returns (uint256 goalId)
    {
        GoalRequest storage request = _pendingGoalRequest(requestId);
        // _createGoal authenticates the registered parent and checks family/child activity.
        goalId = _createGoal(request.childId, request.title, starCost);
        request.status = RedemptionStatus.Approved;
        request.goalId = goalId;
        request.resolvedAt = uint64(block.timestamp);
        emit GoalRequestApproved(requestId, goalId);
    }

    function rejectGoalRequest(uint256 requestId) external {
        GoalRequest storage request = _pendingGoalRequest(requestId);
        _requireParent(registry.getChild(request.childId).familyId, msg.sender);
        request.status = RedemptionStatus.Rejected;
        request.resolvedAt = uint64(block.timestamp);
        emit GoalRequestRejected(requestId);
    }

    function cancelGoalRequest(uint256 requestId) external {
        GoalRequest storage request = _pendingGoalRequest(requestId);
        if (msg.sender != registry.getChild(request.childId).wallet) {
            revert NotChildWallet(request.childId, msg.sender);
        }
        request.status = RedemptionStatus.Cancelled;
        request.resolvedAt = uint64(block.timestamp);
        emit GoalRequestCancelled(requestId);
    }

    function getGoalRequest(uint256 requestId) external view returns (GoalRequest memory) {
        if (goalRequests[requestId].id == 0) revert InvalidGoalRequest();
        return goalRequests[requestId];
    }

    function _pendingGoalRequest(uint256 requestId)
        private
        view
        returns (GoalRequest storage request)
    {
        request = goalRequests[requestId];
        if (request.id == 0 || request.status != RedemptionStatus.Pending) {
            revert GoalRequestNotPending(requestId);
        }
    }

    function _createGoal(uint256 childId, string memory title, uint256 starCost)
        private
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
        reservedStars[child.id] -= allocatedStars[goalId];
        allocatedStars[goalId] = 0;
        emit GoalCancelled(goalId, goal.childId);
    }

    function addStarsToGoal(uint256 goalId, uint256 amount) external {
        Goal storage goal = _goal(goalId);
        if (goal.status != GoalStatus.Active) revert InvalidGoalStatus(goalId, goal.status);
        IStarRegistry.Child memory child = registry.getChild(goal.childId);
        if (msg.sender != child.wallet) revert NotChildWallet(child.id, msg.sender);
        _requireFamilyActive(child.familyId);
        if (!child.active) revert ChildInactive(child.id);
        uint256 pendingId = pendingRedemptionForGoal[goalId];
        if (pendingId != 0) revert PendingRedemptionExists(goalId, pendingId);
        uint256 allocated = allocatedStars[goalId];
        if (amount == 0 || amount > goal.starCost - allocated) revert InvalidContribution();
        uint256 balance = star.balanceOf(child.wallet);
        uint256 reserved = reservedStars[child.id];
        uint256 available = balance >= reserved ? balance - reserved : 0;
        if (amount > available) revert InsufficientAvailableStars(available, amount);
        allocatedStars[goalId] = allocated + amount;
        reservedStars[child.id] = reserved + amount;
        emit GoalStarsAdded(goalId, child.id, amount, allocated + amount);
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

        if (allocatedStars[goalId] != goal.starCost) {
            revert GoalNotFunded(allocatedStars[goalId], goal.starCost);
        }

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
        allocatedStars[goal.id] = 0;
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
        allocatedStars[goal.id] = 0;
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
        allocatedStars[goal.id] = 0;
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
