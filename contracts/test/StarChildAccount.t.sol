// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { StarChildAccount, IQuestVaultFactory } from "../src/StarChildAccount.sol";
import { StarRegistry } from "../src/StarRegistry.sol";
import { StarToken } from "../src/StarToken.sol";
import { StarGoals } from "../src/StarGoals.sol";
import { StarQuests } from "../src/StarQuests.sol";
import { IStarRegistry } from "../src/interfaces/IStarRegistry.sol";
import { PackedUserOperation } from "@openzeppelin/contracts/interfaces/draft-IERC4337.sol";
import { Base64 } from "@openzeppelin/contracts/utils/Base64.sol";

interface ChildAccountVm {
    function prank(address sender) external;
    function expectRevert() external;
    function signP256(uint256 key, bytes32 digest) external pure returns (bytes32 r, bytes32 s);
    function publicKeyP256(uint256 key) external pure returns (uint256 x, uint256 y);
}

contract QuestVaultHarness {
    StarQuests public quests;

    constructor(StarRegistry registry, uint256 familyId) {
        quests = new StarQuests(IStarRegistry(address(registry)), familyId, address(this));
    }
}

contract StarChildAccountTest {
    ChildAccountVm private constant VM =
        ChildAccountVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant ENTRY_POINT = 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108;
    uint256 private constant CHILD_KEY = 12345;
    string private constant CHILD_NAME = "maya.lee.starwallet.eth";
    StarChildAccount private account;
    StarRegistry private registry;
    StarToken private token;
    StarGoals private goals;
    QuestVaultHarness private questVault;
    uint256 private familyId;
    bytes32 private ensNode;
    bytes32 private publicKeyX;
    bytes32 private publicKeyY;

    function setUp() public {
        registry = new StarRegistry();
        token = new StarToken(address(this));
        goals = new StarGoals(address(registry), address(token));
        familyId = registry.createFamily("lee.starwallet.eth");
        ensNode = keccak256(abi.encodePacked(bytes32(0), keccak256("eth")));
        ensNode = keccak256(abi.encodePacked(ensNode, keccak256("starwallet")));
        ensNode = keccak256(abi.encodePacked(ensNode, keccak256("lee")));
        ensNode = keccak256(abi.encodePacked(ensNode, keccak256("maya")));
        questVault = new QuestVaultHarness(registry, familyId);
        (uint256 qx, uint256 qy) = VM.publicKeyP256(CHILD_KEY);
        publicKeyX = bytes32(qx);
        publicKeyY = bytes32(qy);
        account = new StarChildAccount(
            registry,
            goals,
            familyId,
            ensNode,
            publicKeyX,
            publicKeyY,
            sha256("localhost"),
            "child-credential",
            IQuestVaultFactory(address(this))
        );
    }

    function vaultByFamily(uint256 id) external view returns (address) {
        require(id == familyId, "family");
        return address(questVault);
    }

    function testBindsCredentialAndValidatesWebAuthnUserOperation() public {
        require(account.publicKeyX() == publicKeyX, "x coordinate");
        require(account.publicKeyY() == publicKeyY, "y coordinate");
        require(account.rpIdHash() == sha256("localhost"), "RP ID");
        require(keccak256(bytes(account.credentialId())) == keccak256("child-credential"));

        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData = abi.encodeCall(account.requestRedemption, (1));
        bytes32 hash = keccak256("bound child operation");
        op.signature = _signature(hash, CHILD_KEY, sha256("localhost"), 0x05);
        require(_validate(op, hash) == 0, "valid passkey rejected");
    }

    function testRejectsWrongKeyReplayRpAndMissingUserVerification() public {
        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData = abi.encodeCall(account.requestRedemption, (1));
        bytes32 hash = keccak256("operation domain");

        op.signature = _signature(hash, CHILD_KEY, sha256("localhost"), 0x05);
        require(_validate(op, keccak256("different operation")) == 1, "replay accepted");
        op.signature = _signature(hash, CHILD_KEY + 1, sha256("localhost"), 0x05);
        require(_validate(op, hash) == 1, "wrong key accepted");
        op.signature = _signature(hash, CHILD_KEY, sha256("attacker.example"), 0x05);
        require(_validate(op, hash) == 1, "wrong RP accepted");
        op.signature = _signature(hash, CHILD_KEY, sha256("localhost"), 0x01);
        require(_validate(op, hash) == 1, "missing verification accepted");
        op.signature = hex"1234";
        require(_validate(op, hash) == 1, "malformed signature accepted");
    }

    function testOnlyCanonicalEntryPointCanValidate() public {
        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData = abi.encodeCall(account.requestRedemption, (1));
        op.signature = _signature(bytes32(0), CHILD_KEY, sha256("localhost"), 0x05);
        VM.expectRevert();
        account.validateUserOp(op, bytes32(0), 0);
    }

    function testAllowsOnlyRegistrationQuestGoalAndContributionSelectors() public {
        bytes[] memory calls = new bytes[](9);
        calls[0] = abi.encodeCall(account.acceptRegistration, (bytes32(uint256(1))));
        calls[1] = abi.encodeCall(account.submitQuest, (1, bytes32(uint256(2))));
        calls[2] = abi.encodeCall(account.requestStars, (5, "Tidied up", bytes32(uint256(3))));
        calls[3] = abi.encodeCall(account.cancelStarRequest, (1));
        calls[4] = abi.encodeCall(
            account.requestGoal, ("Rocket", "Space adventures", 6, bytes32(uint256(4)))
        );
        calls[5] = abi.encodeCall(account.cancelGoalRequest, (1));
        calls[6] = abi.encodeCall(account.addStarsToGoal, (1, 3));
        calls[7] = abi.encodeCall(account.requestRedemption, (1));
        calls[8] = abi.encodeCall(account.cancelRedemption, (1));

        for (uint256 i; i < calls.length; ++i) {
            bytes32 hash = keccak256(abi.encode("allowed", i));
            PackedUserOperation memory op = _signedOperation(calls[i], hash);
            require(_validate(op, hash) == 0, "allowed selector rejected");
            require(_validate(op, keccak256(abi.encode("replay", i))) == 1, "replay accepted");
        }
    }

    function testProtocolActionsExecuteOnlyThroughEntryPoint() public {
        uint256 childId = _register();
        StarQuests quests = questVault.quests();
        uint256 questId = quests.createQuest(childId, 3, "Read a book");

        VM.expectRevert();
        account.submitQuest(questId, bytes32(uint256(1)));
        VM.prank(ENTRY_POINT);
        account.submitQuest(questId, bytes32(uint256(1)));

        VM.prank(ENTRY_POINT);
        account.requestStars(5, "Tidied up", bytes32(uint256(2)));
        VM.prank(ENTRY_POINT);
        account.cancelStarRequest(2);

        VM.prank(ENTRY_POINT);
        account.requestGoal("Rocket", "Space adventures", 6, bytes32(uint256(3)));
        VM.prank(ENTRY_POINT);
        account.cancelGoalRequest(1);

        token.grantRole(token.VAULT_FACTORY_ROLE(), address(this));
        token.grantRole(token.MINTER_ROLE(), address(this));
        token.mint(address(account), 10);
        uint256 goalId = goals.createGoal(childId, "Book", 3);
        VM.prank(ENTRY_POINT);
        account.addStarsToGoal(goalId, 3);
        VM.prank(ENTRY_POINT);
        uint256 redemptionId = account.requestRedemption(goalId);
        VM.prank(ENTRY_POINT);
        account.cancelRedemption(redemptionId);

        require(quests.getRequest(1).questId == questId, "quest submission");
        require(quests.getRequest(2).status == StarQuests.RequestStatus.Cancelled, "request");
        require(goals.getGoalRequest(1).status == StarGoals.RedemptionStatus.Cancelled, "goal");
        require(
            goals.getRedemption(redemptionId).status == StarGoals.RedemptionStatus.Cancelled,
            "redemption"
        );
        require(goals.reservedStars(childId) == 0, "reservation released");
    }

    function testRejectsDisallowedSelectorsAndMalformedOperationEnvelope() public {
        bytes[] memory disallowed = new bytes[](5);
        disallowed[0] = abi.encodeCall(goals.createGoal, (1, "Unauthorized", 1));
        disallowed[1] = abi.encodeCall(token.mint, (address(account), 1));
        disallowed[2] = abi.encodeCall(token.approve, (address(this), 1));
        disallowed[3] = abi.encodeWithSignature(
            "execute(address,uint256,bytes)", address(token), 0, disallowed[1]
        );
        disallowed[4] = abi.encodeCall(account.goalContributionsVersion, ());
        for (uint256 i; i < disallowed.length; ++i) {
            bytes32 hash = keccak256(abi.encode("disallowed", i));
            require(_validate(_signedOperation(disallowed[i], hash), hash) == 1, "selector allowed");
        }

        bytes32 validHash = keccak256("valid envelope");
        PackedUserOperation memory op =
            _signedOperation(abi.encodeCall(account.requestRedemption, (1)), validHash);
        op.sender = address(0xBAD);
        require(_validate(op, validHash) == 1, "foreign sender");
        op.sender = address(account);
        op.initCode = hex"01";
        require(_validate(op, validHash) == 1, "unexpected init code");
        op.initCode = "";
        op.callData = bytes.concat(op.callData, bytes32(0));
        require(_validate(op, validHash) == 1, "trailing calldata");
        op.callData = hex"1234";
        require(_validate(op, validHash) == 1, "short calldata");
    }

    function testRegistrationIsBoundToFamilyAccountAndEnsName() public {
        uint256 otherFamily = registry.createFamily("other.starwallet.eth");
        bytes32 registration =
            registry.proposeChildRegistration(otherFamily, address(account), CHILD_NAME);
        VM.expectRevert();
        VM.prank(ENTRY_POINT);
        account.acceptRegistration(registration);

        registry.cancelChildRegistration(registration);
        registration = registry.proposeChildRegistration(
            familyId, address(account), "wrong.lee.starwallet.eth"
        );
        VM.expectRevert();
        VM.prank(ENTRY_POINT);
        account.acceptRegistration(registration);

        registry.cancelChildRegistration(registration);
        require(_register() != 0, "bound registration failed");
    }

    function testRejectsInvalidCredentialConfiguration() public {
        string memory oversizedCredential = new string(1025);
        require(!_canDeploy(bytes32(0), bytes32(0), "invalid"), "invalid key");
        require(!_canDeploy(publicKeyX, publicKeyY, ""), "empty credential");
        require(!_canDeploy(publicKeyX, publicKeyY, oversizedCredential), "oversized credential");
    }

    function _canDeploy(bytes32 qx, bytes32 qy, string memory credential) private returns (bool) {
        try new StarChildAccount(
            registry,
            goals,
            familyId,
            ensNode,
            qx,
            qy,
            sha256("localhost"),
            credential,
            IQuestVaultFactory(address(this))
        ) {
            return true;
        } catch {
            return false;
        }
    }

    function _register() private returns (uint256 childId) {
        bytes32 registration =
            registry.proposeChildRegistration(familyId, address(account), CHILD_NAME);
        VM.prank(ENTRY_POINT);
        childId = account.acceptRegistration(registration);
    }

    function _signedOperation(bytes memory callData, bytes32 hash)
        private
        view
        returns (PackedUserOperation memory op)
    {
        op.sender = address(account);
        op.callData = callData;
        op.signature = _signature(hash, CHILD_KEY, sha256("localhost"), 0x05);
    }

    function _validate(PackedUserOperation memory op, bytes32 hash) private returns (uint256) {
        VM.prank(ENTRY_POINT);
        return account.validateUserOp(op, hash, 0);
    }

    function _signature(bytes32 hash, uint256 key, bytes32 rpHash, bytes1 flags)
        private
        pure
        returns (bytes memory)
    {
        string memory json = string.concat(
            '{"type":"webauthn.get","challenge":"',
            Base64.encodeURL(abi.encodePacked(hash)),
            '","origin":"http://localhost:3001","crossOrigin":false}'
        );
        bytes memory auth = abi.encodePacked(rpHash, flags, bytes4(0));
        (bytes32 r, bytes32 s) =
            VM.signP256(key, sha256(abi.encodePacked(auth, sha256(bytes(json)))));
        return abi.encode(r, s, uint256(23), uint256(1), auth, json);
    }
}
