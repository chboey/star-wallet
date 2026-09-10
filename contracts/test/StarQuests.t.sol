// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { StarQuests } from "../src/StarQuests.sol";
import { StarRegistry } from "../src/StarRegistry.sol";

interface QuestVm {
    function expectRevert(bytes4 selector) external;
    function prank(address caller) external;
}

contract StarQuestsTest {
    QuestVm private constant VM = QuestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant CHILD = address(0xCAFE);
    address private constant OTHER = address(0xBAD);

    StarRegistry private registry;
    StarQuests private quests;
    uint256 private familyId;
    uint256 private childId;

    function setUp() public {
        registry = new StarRegistry();
        familyId = registry.createFamily("family.starwallet.eth");
        bytes32 registration =
            registry.proposeChildRegistration(familyId, CHILD, "child.family.starwallet.eth");
        VM.prank(CHILD);
        childId = registry.acceptChildRegistration(registration);
        quests = new StarQuests(registry, familyId, address(this));
    }

    function testParentAssignsQuestAndChildSubmitsIt() public {
        uint256 questId = quests.createQuest(childId, 3, "Read a book");
        StarQuests.Quest memory quest = quests.getQuest(questId);
        require(quest.childId == childId && quest.stars == 3, "quest terms");
        require(quest.status == StarQuests.QuestStatus.Active, "active quest");

        VM.prank(CHILD);
        uint256 requestId = quests.submitQuest(questId, bytes32(uint256(1)));
        StarQuests.Request memory request = quests.getRequest(requestId);
        require(request.questId == questId && request.stars == 3, "request terms");
        require(request.status == StarQuests.RequestStatus.Pending, "pending request");
        require(quests.getQuest(questId).status == StarQuests.QuestStatus.Submitted, "submitted");
    }

    function testDirectStarRequestCanBeCancelledByChild() public {
        uint256 requestId = _request(5, bytes32(uint256(1)));
        require(quests.getRequest(requestId).questId == 0, "direct request");
        require(quests.pendingRequestsByChild(childId) == 1, "pending count");

        VM.prank(CHILD);
        quests.cancelRequest(requestId);
        require(
            quests.getRequest(requestId).status == StarQuests.RequestStatus.Cancelled, "cancelled"
        );
        require(quests.pendingRequestsByChild(childId) == 0, "count cleared");
    }

    function testVaultConsumesRequestAndCompletesQuest() public {
        uint256 questId = quests.createQuest(childId, 3, "Read a book");
        VM.prank(CHILD);
        uint256 requestId = quests.submitQuest(questId, bytes32(uint256(1)));

        (uint256 requestedChild, uint256 stars) = quests.consumeRequest(requestId, 1);
        require(requestedChild == childId && stars == 3, "consumed request");
        require(
            quests.getRequest(requestId).status == StarQuests.RequestStatus.Approved, "approved"
        );
        require(quests.getQuest(questId).status == StarQuests.QuestStatus.Completed, "completed");

        VM.expectRevert(StarQuests.InvalidState.selector);
        quests.consumeRequest(requestId, 2);
    }

    function testRejectionReopensQuestForNewSubmission() public {
        uint256 questId = quests.createQuest(childId, 3, "Read a book");
        VM.prank(CHILD);
        uint256 requestId = quests.submitQuest(questId, bytes32(uint256(1)));
        quests.rejectRequest(requestId);
        require(quests.getQuest(questId).status == StarQuests.QuestStatus.Active, "reopened");

        VM.prank(CHILD);
        VM.expectRevert(StarQuests.DuplicateSubmission.selector);
        quests.submitQuest(questId, bytes32(uint256(1)));
        VM.prank(CHILD);
        uint256 retryId = quests.submitQuest(questId, bytes32(uint256(2)));
        require(retryId != requestId, "new request");
    }

    function testEnforcesSubmissionReplayAndPendingCap() public {
        _request(1, bytes32(uint256(1)));
        VM.prank(CHILD);
        VM.expectRevert(StarQuests.DuplicateSubmission.selector);
        quests.requestStars(1, "Helped tidy up", bytes32(uint256(1)));
        for (uint256 i = 2; i <= 5; ++i) {
            _request(1, bytes32(i));
        }
        VM.prank(CHILD);
        VM.expectRevert(StarQuests.TooManyRequests.selector);
        quests.requestStars(1, "Helped tidy up", bytes32(uint256(6)));

        quests.rejectRequest(1);
        _request(1, bytes32(uint256(6)));
    }

    function testRejectsUnauthorizedInactiveAndInvalidActions() public {
        VM.prank(OTHER);
        VM.expectRevert(StarQuests.Unauthorized.selector);
        quests.createQuest(childId, 3, "Cheat");
        VM.prank(CHILD);
        VM.expectRevert(StarQuests.InvalidInput.selector);
        quests.requestStars(0, "Helped", bytes32(uint256(1)));
        VM.prank(CHILD);
        VM.expectRevert(StarQuests.InvalidInput.selector);
        quests.requestStars(1001, "Helped", bytes32(uint256(1)));
        VM.prank(CHILD);
        VM.expectRevert(StarQuests.InvalidInput.selector);
        quests.requestStars(1, "Helped", bytes32(0));

        uint256 requestId = _request(1, bytes32(uint256(1)));
        VM.prank(OTHER);
        VM.expectRevert(StarQuests.Unauthorized.selector);
        quests.consumeRequest(requestId, 1);

        registry.setFamilyStatus(familyId, false);
        VM.prank(CHILD);
        VM.expectRevert(StarQuests.Inactive.selector);
        quests.requestStars(1, "Helped", bytes32(uint256(2)));
    }

    function _request(uint256 stars, bytes32 submissionId) private returns (uint256) {
        VM.prank(CHILD);
        return quests.requestStars(stars, "Helped tidy up", submissionId);
    }
}
