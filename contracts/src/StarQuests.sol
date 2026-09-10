// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IStarRegistry } from "./interfaces/IStarRegistry.sol";

/// @notice A family's single-use quests and Star requests. Holds no funds or token permissions.
contract StarQuests {
    enum QuestStatus {
        Active,
        Submitted,
        Completed,
        Cancelled
    }
    enum RequestStatus {
        Pending,
        Approved,
        Rejected,
        Cancelled
    }

    struct Quest {
        uint256 childId;
        uint256 stars;
        QuestStatus status;
        string title;
    }

    struct Request {
        uint256 childId;
        uint256 questId;
        uint256 stars;
        RequestStatus status;
        string reason;
    }

    IStarRegistry public immutable registry;
    address public immutable vault;
    uint256 public immutable familyId;
    uint256 public nextQuestId = 1;
    uint256 public nextRequestId = 1;
    mapping(uint256 => Quest) private quests;
    mapping(uint256 => Request) private requests;
    mapping(uint256 => uint256) public pendingRequestsByChild;
    mapping(address => mapping(bytes32 => bool)) public usedSubmissionIds;

    error Unauthorized();
    error Inactive();
    error InvalidInput();
    error InvalidState();
    error NotFound();
    error DuplicateSubmission();
    error TooManyRequests();

    event QuestCreated(
        uint256 indexed questId, uint256 indexed childId, uint256 stars, string title
    );
    event QuestStatusUpdated(uint256 indexed questId, QuestStatus status);
    event StarRequestCreated(
        uint256 indexed requestId,
        uint256 indexed childId,
        uint256 indexed questId,
        uint256 stars,
        string reason,
        bytes32 submissionId
    );
    event StarRequestResolved(uint256 indexed requestId, RequestStatus status, uint256 rewardId);

    constructor(IStarRegistry registry_, uint256 familyId_, address vault_) {
        registry = registry_;
        familyId = familyId_;
        vault = vault_;
    }

    function createQuest(uint256 childId, uint256 stars, string calldata title)
        external
        returns (uint256 id)
    {
        _parent(true);
        _child(childId, true);
        if (stars == 0 || stars > 1000 || bytes(title).length == 0 || bytes(title).length > 64) {
            revert InvalidInput();
        }
        id = nextQuestId++;
        quests[id] = Quest(childId, stars, QuestStatus.Active, title);
        emit QuestCreated(id, childId, stars, title);
    }

    function cancelQuest(uint256 id) external {
        _parent(false);
        Quest storage quest = _quest(id);
        if (quest.status != QuestStatus.Active) revert InvalidState();
        quest.status = QuestStatus.Cancelled;
        emit QuestStatusUpdated(id, quest.status);
    }

    function submitQuest(uint256 id, bytes32 submissionId) external returns (uint256) {
        Quest storage quest = _quest(id);
        _childCaller(quest.childId, true);
        if (quest.status != QuestStatus.Active) revert InvalidState();
        quest.status = QuestStatus.Submitted;
        emit QuestStatusUpdated(id, quest.status);
        return _request(quest.childId, id, quest.stars, quest.title, submissionId);
    }

    function requestStars(uint256 stars, string calldata reason, bytes32 submissionId)
        external
        returns (uint256)
    {
        IStarRegistry.Child memory child = registry.getChildByWallet(msg.sender);
        _childCaller(child.id, true);
        if (stars == 0 || stars > 1000 || bytes(reason).length == 0 || bytes(reason).length > 128) {
            revert InvalidInput();
        }
        return _request(child.id, 0, stars, reason, submissionId);
    }

    function rejectRequest(uint256 id) external {
        _parent(false);
        _resolve(id, RequestStatus.Rejected, 0);
    }

    function cancelRequest(uint256 id) external {
        Request storage item = _getRequest(id);
        _childCaller(item.childId, false);
        _resolve(id, RequestStatus.Cancelled, 0);
    }

    /// @dev Only the bound vault can consume; its parent-authorized transfer/mint must succeed in this same transaction.
    function consumeRequest(uint256 id, uint256 rewardId)
        external
        returns (uint256 childId, uint256 stars)
    {
        if (msg.sender != vault) revert Unauthorized();
        Request storage item = _getRequest(id);
        _child(item.childId, true);
        if (!registry.getFamily(familyId).active || rewardId == 0) revert Inactive();
        _resolve(id, RequestStatus.Approved, rewardId);
        return (item.childId, item.stars);
    }

    function getQuest(uint256 id) external view returns (Quest memory) {
        return _quest(id);
    }

    function getRequest(uint256 id) external view returns (Request memory) {
        return _getRequest(id);
    }

    function _request(
        uint256 childId,
        uint256 questId,
        uint256 stars,
        string memory reason,
        bytes32 submissionId
    ) private returns (uint256 id) {
        if (submissionId == bytes32(0)) revert InvalidInput();
        if (usedSubmissionIds[msg.sender][submissionId]) revert DuplicateSubmission();
        if (pendingRequestsByChild[childId] >= 5) revert TooManyRequests();
        usedSubmissionIds[msg.sender][submissionId] = true;
        pendingRequestsByChild[childId]++;
        id = nextRequestId++;
        requests[id] = Request(childId, questId, stars, RequestStatus.Pending, reason);
        emit StarRequestCreated(id, childId, questId, stars, reason, submissionId);
    }

    function _resolve(uint256 id, RequestStatus status, uint256 rewardId) private {
        Request storage item = _getRequest(id);
        if (item.status != RequestStatus.Pending) revert InvalidState();
        item.status = status;
        pendingRequestsByChild[item.childId]--;
        if (item.questId != 0) {
            Quest storage quest = _quest(item.questId);
            quest.status =
                status == RequestStatus.Approved ? QuestStatus.Completed : QuestStatus.Active;
            emit QuestStatusUpdated(item.questId, quest.status);
        }
        emit StarRequestResolved(id, status, rewardId);
    }

    function _quest(uint256 id) private view returns (Quest storage item) {
        if (id == 0 || id >= nextQuestId) revert NotFound();
        return quests[id];
    }

    function _getRequest(uint256 id) private view returns (Request storage item) {
        if (id == 0 || id >= nextRequestId) revert NotFound();
        return requests[id];
    }

    function _parent(bool active) private view {
        IStarRegistry.Family memory family = registry.getFamily(familyId);
        if (msg.sender != family.parent) revert Unauthorized();
        if (active && !family.active) revert Inactive();
    }

    function _child(uint256 id, bool active)
        private
        view
        returns (IStarRegistry.Child memory child)
    {
        child = registry.getChild(id);
        if (child.familyId != familyId) revert Unauthorized();
        if (active && !child.active) revert Inactive();
    }

    function _childCaller(uint256 id, bool active) private view {
        IStarRegistry.Child memory child = _child(id, active);
        if (child.wallet != msg.sender) revert Unauthorized();
        if (active && !registry.getFamily(familyId).active) revert Inactive();
    }
}
