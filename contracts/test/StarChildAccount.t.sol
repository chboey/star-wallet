// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import { StarRegistry } from "../src/StarRegistry.sol";
import { StarToken } from "../src/StarToken.sol";
import { StarGoals } from "../src/StarGoals.sol";
import { StarFamilyVault } from "../src/StarFamilyVault.sol";
import { StarChildAccount } from "../src/StarChildAccount.sol";
import { StarChildAccountFactory } from "../src/StarChildAccountFactory.sol";
import { IQuestVaultFactory } from "../src/StarChildAccount.sol";
import { StarQuests } from "../src/StarQuests.sol";
import { IStarRegistry } from "../src/interfaces/IStarRegistry.sol";
import { PackedUserOperation } from "@openzeppelin/contracts/interfaces/draft-IERC4337.sol";
import { Base64 } from "@openzeppelin/contracts/utils/Base64.sol";

interface ChildAccountVm {
    function warp(uint256 timestamp) external;
    function chainId(uint256 id) external;
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
    ChildAccountVm private constant vm =
        ChildAccountVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant EP = 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108;
    uint256 private constant KEY = 12345; // Public test fixture, never a deployment key.
    StarRegistry private registry;
    StarToken private token;
    StarGoals private goals;
    StarChildAccountFactory private factory;
    StarChildAccount private account;
    QuestVaultHarness private questVault;
    bytes32 private x;
    bytes32 private y;
    bytes32 private node;
    uint256 private familyId;
    string private constant NAME = "maya.lee.starwallet.eth";

    function setUp() public {
        registry = new StarRegistry();
        token = new StarToken(address(this));
        goals = new StarGoals(address(registry), address(token));
        factory = new StarChildAccountFactory(
            registry, goals, "localhost", IQuestVaultFactory(address(this))
        );
        familyId = registry.createFamily("lee.starwallet.eth");
        node = keccak256(abi.encodePacked(bytes32(0), keccak256("eth")));
        node = keccak256(abi.encodePacked(node, keccak256("starwallet")));
        node = keccak256(abi.encodePacked(node, keccak256("lee")));
        node = keccak256(abi.encodePacked(node, keccak256("maya")));
        (uint256 qx, uint256 qy) = vm.publicKeyP256(KEY);
        x = bytes32(qx);
        y = bytes32(qy);
        account = factory.createChildAccount(familyId, node, x, y, "test-credential");
        questVault = new QuestVaultHarness(registry, familyId);
    }

    function vaultByFamily(uint256 id) external view returns (address) {
        require(id == familyId);
        return address(questVault);
    }

    function testQuestMethodsRequireChildSignatureAndEntryPoint() public {
        bytes32 registration = registry.proposeChildRegistration(familyId, address(account), NAME);
        vm.prank(EP);
        uint256 childId = account.acceptRegistration(registration);
        StarQuests quests = questVault.quests();
        uint256 questId = quests.createQuest(childId, 3, "Read a book");
        bytes[] memory calls = new bytes[](3);
        calls[0] = abi.encodeCall(account.submitQuest, (questId, bytes32(uint256(1))));
        calls[1] = abi.encodeCall(account.requestStars, (5, "Tidied up", bytes32(uint256(2))));
        calls[2] = abi.encodeCall(account.cancelStarRequest, (1));
        for (uint256 i; i < calls.length; i++) {
            PackedUserOperation memory op;
            op.sender = address(account);
            op.callData = calls[i];
            bytes32 hash = keccak256(abi.encode(i, "quest-operation"));
            op.signature = signature(hash, KEY, sha256("localhost"), 0x05);
            require(validate(op, hash) == 0);
            require(validate(op, keccak256("replay")) == 1);
            (bool direct,) = address(account).call(calls[i]);
            require(!direct);
            vm.prank(EP);
            (bool executed,) = address(account).call(calls[i]);
            require(executed);
        }
        require(quests.getRequest(1).status == StarQuests.RequestStatus.Cancelled);
        require(quests.getRequest(2).stars == 5 && token.balanceOf(address(account)) == 0);
    }

    function testDeterministicCredentialBindingAndRetry() public {
        require(
            address(account) == factory.predictChildAccount(familyId, node, x, y, "test-credential")
        );
        require(
            address(account)
                == address(factory.createChildAccount(familyId, node, x, y, "test-credential"))
        );
        require(factory.accountByName(familyId, node) == address(account));
        vm.expectRevert();
        factory.createChildAccount(familyId, node, x, y, "replacement");
        vm.expectRevert();
        factory.createChildAccount(familyId, keccak256("bad"), bytes32(0), bytes32(0), "bad");
    }

    function testGoalRequestsRequirePasskeyAndEntryPoint() public {
        bytes32 registration = registry.proposeChildRegistration(familyId, address(account), NAME);
        vm.prank(EP);
        uint256 childId = account.acceptRegistration(registration);
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(
            account.requestGoal, ("Rocket Toy", "Space adventures", 6, bytes32(uint256(1)))
        );
        calls[1] = abi.encodeCall(account.cancelGoalRequest, (1));
        for (uint256 i; i < calls.length; i++) {
            PackedUserOperation memory op;
            op.sender = address(account);
            op.callData = calls[i];
            bytes32 hash = keccak256(abi.encode(i, "goal-request"));
            op.signature = signature(hash, KEY, sha256("localhost"), 0x05);
            require(validate(op, hash) == 0);
            require(validate(op, keccak256("replay")) == 1);
            (bool direct,) = address(account).call(calls[i]);
            require(!direct);
            vm.prank(EP);
            (bool executed,) = address(account).call(calls[i]);
            require(executed);
        }
        require(goals.getGoalRequest(1).childId == childId);
        require(goals.getGoalRequest(1).status == StarGoals.RedemptionStatus.Cancelled);
        require(token.balanceOf(address(account)) == 0);
    }

    function testFuzzParentAndStrangersCannotExecute(address caller) public {
        if (caller == EP) return;
        bytes32 id = registry.proposeChildRegistration(familyId, address(account), NAME);
        vm.expectRevert();
        vm.prank(caller);
        account.acceptRegistration(id);
        vm.expectRevert();
        vm.prank(caller);
        account.requestRedemption(1);
        vm.expectRevert();
        vm.prank(caller);
        account.cancelRedemption(1);
    }

    function testOnlyActiveParentDeploys() public {
        vm.expectRevert();
        vm.prank(address(0xBAD));
        factory.createChildAccount(familyId, node, x, y, "test-credential");
        registry.setFamilyStatus(familyId, false);
        vm.expectRevert();
        factory.createChildAccount(familyId, node, x, y, "test-credential");
    }

    function testPasskeyRejectsWrongKeyReplayRpAndMissingVerification() public {
        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData = abi.encodeCall(account.requestRedemption, (1));
        bytes32 hash = keccak256("operation-chain-nonce-domain");
        op.signature = signature(hash, KEY, sha256("localhost"), 0x05);
        require(validate(op, hash) == 0);
        require(validate(op, keccak256("different-domain-or-nonce")) == 1);
        op.signature = signature(hash, KEY + 1, sha256("localhost"), 0x05);
        require(validate(op, hash) == 1);
        op.signature = signature(hash, KEY, sha256("attacker.example"), 0x05);
        require(validate(op, hash) == 1);
        op.signature = signature(hash, KEY, sha256("localhost"), 0x01);
        require(validate(op, hash) == 1);
        op.signature = hex"1234";
        require(validate(op, hash) == 1);
        vm.expectRevert();
        account.validateUserOp(op, hash, 0);
    }

    function testDisallowedSelectorsFailEvenWithChildSignature() public {
        bytes[] memory calls = new bytes[](14);
        calls[0] = abi.encodeCall(goals.createGoal, (1, "Unauthorized", 1));
        calls[1] = abi.encodeCall(StarFamilyVault.rewardStars, (1, 1, "Unauthorized"));
        calls[2] = abi.encodeCall(goals.approveRedemption, (1));
        calls[3] = abi.encodeCall(goals.rejectRedemption, (1));
        calls[4] = abi.encodeCall(StarFamilyVault.withdrawSavings, (1, address(this)));
        calls[5] = abi.encodeCall(StarFamilyVault.shipSavingsPosition, (hex"01", 1, 1));
        calls[6] =
            abi.encodeCall(registry.proposeChildRegistration, (familyId, address(0xBAD), NAME));
        calls[7] = abi.encodeCall(token.mint, (address(account), 1));
        calls[8] = abi.encodeCall(token.approve, (address(this), 1));
        calls[9] =
            abi.encodeWithSignature("execute(address,uint256,bytes)", address(token), 0, calls[7]);
        calls[10] = abi.encodeCall(StarFamilyVault.withdrawStrategyWeth, (1, address(this)));
        calls[11] = abi.encodeCall(StarFamilyVault.approveStarRequest, (1));
        calls[12] = abi.encodeCall(StarFamilyVault.addToSavingsPosition, (bytes32(uint256(1)), 1, 0));
        calls[13] = abi.encodeCall(StarFamilyVault.dockSavingsPosition, ());
        bytes32 hash = keccak256("operation");
        for (uint256 i; i < calls.length; ++i) {
            PackedUserOperation memory op;
            op.sender = address(account);
            op.callData = calls[i];
            op.signature = signature(hash, KEY, sha256("localhost"), 0x05);
            require(validate(op, hash) == 1);
            vm.prank(EP);
            (bool success,) = address(account).call(op.callData);
            require(!success);
        }
    }

    function testRedemptionKeepsParentFinancialAuthority() public {
        bytes32 id = registry.proposeChildRegistration(familyId, address(account), NAME);
        vm.prank(EP);
        uint256 childId = account.acceptRegistration(id);
        require(registry.getChild(childId).wallet == address(account));
        token.grantRole(token.VAULT_FACTORY_ROLE(), address(this));
        token.grantRole(token.MINTER_ROLE(), address(this)); // Test funding; production minting stays on the vault.
        token.grantRole(token.BURNER_ROLE(), address(goals));
        token.mint(address(account), 10);
        uint256 goalId = goals.createGoal(childId, "Book", 5);
        vm.expectRevert();
        vm.prank(address(account));
        goals.createGoal(childId, "Unauthorized", 1);
        vm.expectRevert();
        vm.prank(address(account));
        registry.proposeChildRegistration(familyId, address(0xBAD), NAME);
        vm.expectRevert();
        vm.prank(address(account));
        token.mint(address(account), 100);
        vm.prank(EP);
        account.addStarsToGoal(goalId, 5);
        vm.prank(EP);
        uint256 requestId = account.requestRedemption(goalId);
        require(goals.reservedStars(childId) == 5);
        vm.expectRevert();
        vm.prank(address(account));
        goals.approveRedemption(requestId);
        vm.expectRevert();
        vm.prank(address(account));
        goals.rejectRedemption(requestId);
        registry.setFamilyStatus(familyId, false);
        vm.prank(EP);
        account.cancelRedemption(requestId);
        require(goals.reservedStars(childId) == 0);
        vm.expectRevert();
        vm.prank(EP);
        account.requestRedemption(goalId);
        registry.setFamilyStatus(familyId, true);
        vm.prank(EP);
        account.addStarsToGoal(goalId, 5);
        vm.prank(EP);
        requestId = account.requestRedemption(goalId);
        goals.approveRedemption(requestId);
        require(token.balanceOf(address(account)) == 5);
    }

    function testGoalContributionRequiresPasskeyAndEntryPoint() public {
        bytes32 registration = registry.proposeChildRegistration(familyId, address(account), NAME);
        vm.prank(EP);
        uint256 childId = account.acceptRegistration(registration);
        token.grantRole(token.VAULT_FACTORY_ROLE(), address(this));
        token.grantRole(token.MINTER_ROLE(), address(this));
        token.mint(address(account), 10);
        uint256 goalId = goals.createGoal(childId, "Game", 10);
        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData = abi.encodeCall(account.addStarsToGoal, (goalId, 3));
        bytes32 hash = keccak256("contribution-operation");
        op.signature = signature(hash, KEY, sha256("localhost"), 0x05);
        require(validate(op, hash) == 0);
        require(validate(op, keccak256("replay")) == 1);
        op.callData = bytes.concat(op.callData, bytes32(0));
        require(validate(op, hash) == 1, "Trailing calldata must not be allowed");
        vm.expectRevert();
        account.addStarsToGoal(goalId, 3);
        vm.prank(EP);
        account.addStarsToGoal(goalId, 3);
        require(goals.allocatedStars(goalId) == 3 && goals.availableStars(childId) == 7);
    }

    function testCannotAcceptAnotherFamilyOrName() public {
        uint256 other = registry.createFamily("other.starwallet.eth");
        bytes32 id = registry.proposeChildRegistration(other, address(account), NAME);
        vm.expectRevert();
        vm.prank(EP);
        account.acceptRegistration(id);
        registry.cancelChildRegistration(id);
        id = registry.proposeChildRegistration(
            familyId, address(account), "wrong.lee.starwallet.eth"
        );
        vm.expectRevert();
        vm.prank(EP);
        account.acceptRegistration(id);
    }

    function testParentGrantPersistsAndRevocationRequiresNewApproval() public {
        enrollParent();
        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData = abi.encodeCall(account.requestStars, (10, "Please", bytes32(uint256(1))));
        bytes32 hash = keccak256("session-op");
        op.signature = sessionSignature(hash, KEY + 1, KEY + 2, 1);
        require(validate(op, hash) == 0);
        vm.warp(block.timestamp + 3650 days);
        require(validate(op, hash) == 0, "No daily or hidden time limit");
        require(validate(op, keccak256("another operation")) == 1, "No operation replay");
        account.revokeParentAuthorizations();
        require(validate(op, hash) == 1, "Revoked device rejected");
        op.signature = sessionSignature(hash, KEY + 1, KEY + 2, 2);
        require(validate(op, hash) == 0, "New parent proof required");
        op.signature = signature(hash, KEY, sha256("localhost"), 0x05);
        require(validate(op, hash) == 1, "Child passkey cannot bypass Papa");
    }

    function testParentAuthorizedDeviceSubmitsAnActualChildRequestWithoutMovingFunds() public {
        bytes32 registration = registry.proposeChildRegistration(familyId, address(account), NAME);
        vm.prank(EP);
        uint256 childId = account.acceptRegistration(registration);
        enrollParent();
        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData =
            abi.encodeCall(account.requestStars, (10, "Please add Stars", bytes32(uint256(7))));
        bytes32 hash = keccak256("real-child-request");
        op.signature = sessionSignature(hash, KEY + 1, KEY + 2, 1);
        require(validate(op, hash) == 0);
        vm.prank(EP);
        (bool success,) = address(account).call(op.callData);
        require(success);
        require(questVault.quests().getRequest(1).childId == childId);
        require(questVault.quests().getRequest(1).stars == 10);
        require(token.balanceOf(address(account)) == 0, "A request cannot award Stars");
    }

    function testFuzzMalformedParentGrantsCannotAuthorize(bytes calldata malformed) public {
        enrollParent();
        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData = abi.encodeCall(account.cancelStarRequest, (1));
        op.signature = abi.encodePacked(bytes4(0x53575031), malformed);
        require(validate(op, keccak256("fuzz-operation")) == 1);
    }

    function testOnlyRegisteredParentCanEnrollRotateOrRevoke() public {
        (uint256 qx, uint256 qy) = vm.publicKeyP256(KEY + 1);
        vm.prank(address(0xBAD));
        vm.expectRevert();
        account.configureParentPasskey(bytes32(qx), bytes32(qy), "parent");
        enrollParent();
        vm.prank(address(0xBAD));
        vm.expectRevert();
        account.revokeParentAuthorizations();
        vm.expectRevert();
        account.configureParentPasskey(bytes32(0), bytes32(0), "bad");
        require(account.parentAuthorizationEpoch() == 1);
    }

    function testParentGrantRejectsWrongParentDeviceNetworkAndFinancialCalls() public {
        enrollParent();
        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData = abi.encodeCall(account.requestStars, (10, "Please", bytes32(uint256(1))));
        bytes32 hash = keccak256("scoped operation");
        op.signature = sessionSignature(hash, KEY, KEY + 2, 1);
        require(validate(op, hash) == 1, "Child is not the parent key");
        op.signature = sessionSignature(hash, KEY + 1, KEY + 2, 1);
        bytes memory valid = op.signature;
        op.signature[120] = bytes1(uint8(op.signature[120]) ^ 1);
        require(validate(op, hash) == 1, "Device signature required");
        op.signature = sessionSignature(hash, KEY + 1, KEY + 2, 1);
        vm.chainId(1);
        require(validate(op, hash) == 1, "No cross-chain grant replay");
        vm.chainId(11155111);
        op.signature = valid;
        op.callData = abi.encodeCall(account.revokeParentAuthorizations, ());
        require(validate(op, hash) == 1, "Device cannot revoke or enroll");
        op.callData = abi.encodeCall(StarFamilyVault.withdrawSavings, (1, address(this)));
        require(validate(op, hash) == 1, "No financial permissions");
    }

    function testParentGrantCannotBeReusedForAnotherAccountOrAfterKeyRotation() public {
        enrollParent();
        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData = abi.encodeCall(account.cancelStarRequest, (1));
        bytes32 hash = keccak256("scoped");
        op.signature = sessionSignature(hash, KEY + 1, KEY + 2, 1);
        StarChildAccount other =
            factory.createChildAccount(familyId, keccak256("other"), x, y, "other");
        (uint256 px, uint256 py) = vm.publicKeyP256(KEY + 1);
        other.configureParentPasskey(bytes32(px), bytes32(py), "parent");
        op.sender = address(other);
        vm.prank(EP);
        require(other.validateUserOp(op, hash, 0) == 1);
        op.sender = address(account);
        enrollParent();
        require(validate(op, hash) == 1, "Even same-key re-enrollment revokes old grants");
    }

    function enrollParent() private {
        (uint256 px, uint256 py) = vm.publicKeyP256(KEY + 1);
        account.configureParentPasskey(bytes32(px), bytes32(py), "parent-credential");
    }

    function sessionSignature(bytes32 hash, uint256 parentKey, uint256 deviceKey, uint256 epoch)
        private
        view
        returns (bytes memory)
    {
        (uint256 dx, uint256 dy) = vm.publicKeyP256(deviceKey);
        bytes memory proof = signature(
            account.parentAuthorizationDigest(bytes32(dx), bytes32(dy), epoch),
            parentKey,
            sha256("localhost"),
            0x05
        );
        (bytes32 r, bytes32 s) = vm.signP256(deviceKey, sha256(abi.encodePacked(hash)));
        return abi.encodePacked(bytes4(0x53575031), epoch, bytes32(dx), bytes32(dy), r, s, proof);
    }

    function validate(PackedUserOperation memory op, bytes32 hash) private returns (uint256) {
        vm.prank(EP);
        return account.validateUserOp(op, hash, 0);
    }

    function signature(bytes32 hash, uint256 key, bytes32 rpHash, bytes1 flags)
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
            vm.signP256(key, sha256(abi.encodePacked(auth, sha256(bytes(json)))));
        return abi.encode(r, s, uint256(23), uint256(1), auth, json);
    }
}
