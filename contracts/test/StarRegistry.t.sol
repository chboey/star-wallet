// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { StarRegistry } from "../src/StarRegistry.sol";
import { IStarRegistry } from "../src/interfaces/IStarRegistry.sol";

interface RegistryVm {
    function expectRevert(bytes4 selector) external;
    function expectPartialRevert(bytes4 selector) external;
    function prank(address caller) external;
    function startPrank(address caller) external;
    function stopPrank() external;
}

contract StarRegistryTest {
    RegistryVm private constant VM =
        RegistryVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant OTHER = address(0xB0B);
    address private constant CHILD = address(0xCAFE);

    StarRegistry private registry;

    function setUp() public {
        registry = new StarRegistry();
    }

    function testCreatesActiveFamilyWithEnsIdentity() public {
        uint256 familyId = registry.createFamily("tan.starwallet.eth");
        IStarRegistry.Family memory family = registry.getFamily(familyId);

        require(family.id == 1, "family id");
        require(family.parent == address(this), "parent");
        require(family.ensNode == _namehash("tan.starwallet.eth"), "ENS node");
        require(keccak256(bytes(family.ensName)) == keccak256("tan.starwallet.eth"), "ENS name");
        require(family.active, "active");
        require(registry.nextFamilyId() == 2, "next id");
    }

    function testIndexesEveryFamilyByParent() public {
        uint256 first = registry.createFamily("");
        uint256 second = registry.createFamily("tan.starwallet.eth");
        uint256[] memory familyIds = registry.getFamilyIdsByParent(address(this));

        require(familyIds.length == 2, "family count");
        require(familyIds[0] == first && familyIds[1] == second, "family order");
        require(registry.getFamily(first).ensNode == bytes32(0), "optional ENS");
        require(registry.getFamilyIdsByParent(OTHER).length == 0, "other parent");
    }

    function testOnlyParentControlsFamilyStatus() public {
        uint256 familyId = registry.createFamily("tan.starwallet.eth");

        VM.prank(OTHER);
        VM.expectPartialRevert(StarRegistry.NotFamilyParent.selector);
        registry.setFamilyStatus(familyId, false);

        registry.setFamilyStatus(familyId, false);
        require(!registry.getFamily(familyId).active, "inactive");
        registry.setFamilyStatus(familyId, true);
        require(registry.getFamily(familyId).active, "reactivated");
    }

    function testRejectsMissingFamiliesAndMalformedEnsNames() public {
        VM.expectPartialRevert(StarRegistry.FamilyNotFound.selector);
        registry.getFamily(1);

        VM.expectRevert(StarRegistry.InvalidEnsName.selector);
        registry.createFamily("tan..starwallet.eth");
    }

    function testChildAcceptsParentProposalBeforeRegistration() public {
        uint256 familyId = registry.createFamily("tan.starwallet.eth");
        bytes32 registrationId =
            registry.proposeChildRegistration(familyId, CHILD, "alice.tan.starwallet.eth");

        require(registry.pendingRegistrationIdByWallet(CHILD) == registrationId, "pending");
        StarRegistry.ChildRegistration memory proposal =
            registry.getChildRegistration(registrationId);
        require(proposal.familyId == familyId, "proposal family");
        require(proposal.parent == address(this), "proposal parent");
        require(proposal.childWallet == CHILD, "proposal child");

        VM.prank(CHILD);
        uint256 childId = registry.acceptChildRegistration(registrationId);
        IStarRegistry.Child memory child = registry.getChild(childId);
        require(child.familyId == familyId && child.wallet == CHILD, "registered child");
        require(child.active, "child active");
        require(registry.isParentOf(address(this), CHILD), "parent relationship");
        require(registry.pendingRegistrationIdByWallet(CHILD) == bytes32(0), "pending cleared");
    }

    function testEitherParticipantCanCancelPendingRegistration() public {
        uint256 familyId = registry.createFamily("tan.starwallet.eth");
        bytes32 registrationId =
            registry.proposeChildRegistration(familyId, CHILD, "alice.tan.starwallet.eth");

        VM.prank(CHILD);
        registry.cancelChildRegistration(registrationId);
        require(registry.pendingRegistrationIdByWallet(CHILD) == bytes32(0), "child cancelled");

        registrationId =
            registry.proposeChildRegistration(familyId, CHILD, "alice.tan.starwallet.eth");
        registry.cancelChildRegistration(registrationId);
        require(registry.pendingRegistrationIdByWallet(CHILD) == bytes32(0), "parent cancelled");
    }

    function testOnlyParentControlsChildLifecycle() public {
        uint256 familyId = registry.createFamily("tan.starwallet.eth");
        bytes32 registrationId =
            registry.proposeChildRegistration(familyId, CHILD, "alice.tan.starwallet.eth");
        VM.prank(CHILD);
        uint256 childId = registry.acceptChildRegistration(registrationId);

        VM.prank(OTHER);
        VM.expectPartialRevert(StarRegistry.NotFamilyParent.selector);
        registry.setChildStatus(childId, false);

        registry.setChildStatus(childId, false);
        require(!registry.isParentOf(address(this), CHILD), "inactive child");
        registry.setChildStatus(childId, true);
        require(registry.isParentOf(address(this), CHILD), "active child");
        registry.setFamilyStatus(familyId, false);
        require(!registry.isParentOf(address(this), CHILD), "inactive family");
    }

    function testWalletCannotBeBothParentAndChild() public {
        uint256 familyId = registry.createFamily("tan.starwallet.eth");

        VM.prank(OTHER);
        registry.createFamily("other.starwallet.eth");
        VM.expectPartialRevert(StarRegistry.ParentWalletCannotBeChild.selector);
        registry.proposeChildRegistration(familyId, OTHER, "bob.tan.starwallet.eth");

        bytes32 registrationId =
            registry.proposeChildRegistration(familyId, CHILD, "alice.tan.starwallet.eth");
        VM.startPrank(CHILD);
        registry.acceptChildRegistration(registrationId);
        VM.expectPartialRevert(StarRegistry.ChildWalletCannotBeParent.selector);
        registry.createFamily("alice.starwallet.eth");
        VM.stopPrank();
    }

    function _namehash(string memory name) private pure returns (bytes32 node) {
        bytes memory value = bytes(name);
        uint256 end = value.length;
        while (end != 0) {
            uint256 start = end;
            while (start != 0 && value[start - 1] != 0x2e) --start;
            bytes32 labelHash;
            assembly ("memory-safe") {
                labelHash := keccak256(add(add(value, 0x20), start), sub(end, start))
            }
            node = keccak256(abi.encodePacked(node, labelHash));
            if (start == 0) break;
            end = start - 1;
        }
    }
}
