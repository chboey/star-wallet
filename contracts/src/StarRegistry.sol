// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IStarRegistry } from "./interfaces/IStarRegistry.sol";

contract StarRegistry is IStarRegistry {
    struct ChildRegistration {
        uint256 familyId;
        address parent;
        address childWallet;
        bytes32 ensNode;
        string ensName;
    }

    uint256 public nextFamilyId = 1;
    uint256 public nextChildId = 1;

    mapping(uint256 familyId => Family family) private families;
    mapping(uint256 childId => Child child) private children;
    mapping(address parent => uint256[] familyIds) private familyIdsByParent;
    mapping(address wallet => uint256 childId) public childIdByWallet;
    mapping(bytes32 registrationId => ChildRegistration registration) private childRegistrations;
    mapping(address childWallet => bytes32 registrationId) public pendingRegistrationIdByWallet;

    error ZeroAddress();
    error FamilyNotFound(uint256 familyId);
    error ChildNotFound(uint256 childId);
    error ChildWalletAlreadyRegistered(address wallet);
    error InvalidEnsName();
    error ChildRegistrationAlreadyPending(bytes32 registrationId);
    error ChildWalletRegistrationAlreadyPending(address childWallet, bytes32 registrationId);
    error ChildRegistrationNotFound(bytes32 registrationId);
    error NotProposedChildWallet(bytes32 registrationId, address expected, address account);
    error NotChildRegistrationParticipant(bytes32 registrationId, address account);
    error FamilyInactive(uint256 familyId);
    error NotFamilyParent(uint256 familyId, address account);
    error ChildWalletCannotBeParent(address wallet, uint256 childId);
    error ParentWalletCannotBeChild(address wallet);

    event FamilyCreated(
        uint256 indexed familyId, address indexed parent, bytes32 indexed ensNode, string ensName
    );
    event FamilyStatusUpdated(uint256 indexed familyId, address indexed parent, bool active);
    event ChildRegistrationProposed(
        bytes32 indexed registrationId,
        uint256 indexed familyId,
        address indexed childWallet,
        bytes32 ensNode,
        string ensName
    );
    event ChildRegistrationCancelled(
        bytes32 indexed registrationId,
        uint256 indexed familyId,
        address indexed childWallet,
        address cancelledBy
    );
    event ChildRegistrationAccepted(
        bytes32 indexed registrationId,
        uint256 indexed childId,
        uint256 indexed familyId,
        address childWallet
    );
    event ChildRegistered(
        uint256 indexed childId,
        uint256 indexed familyId,
        address indexed wallet,
        bytes32 ensNode,
        string ensName
    );
    event ChildStatusUpdated(uint256 indexed childId, uint256 indexed familyId, bool active);

    function createFamily(string calldata ensName) external returns (uint256 familyId) {
        uint256 childId = childIdByWallet[msg.sender];
        if (childId != 0) revert ChildWalletCannotBeParent(msg.sender, childId);
        bytes32 pendingRegistrationId = pendingRegistrationIdByWallet[msg.sender];
        if (pendingRegistrationId != bytes32(0)) {
            ChildRegistration memory registration = childRegistrations[pendingRegistrationId];
            _deleteChildRegistration(pendingRegistrationId, registration.childWallet);
            emit ChildRegistrationCancelled(
                pendingRegistrationId, registration.familyId, registration.childWallet, msg.sender
            );
        }
        bytes32 ensNode = bytes(ensName).length == 0 ? bytes32(0) : _namehash(ensName);
        familyId = nextFamilyId++;
        families[familyId] = Family({
            id: familyId, parent: msg.sender, ensNode: ensNode, ensName: ensName, active: true
        });
        familyIdsByParent[msg.sender].push(familyId);
        emit FamilyCreated(familyId, msg.sender, ensNode, ensName);
    }

    function setFamilyStatus(uint256 familyId, bool active) external {
        Family storage family = _family(familyId);
        if (family.parent != msg.sender) revert NotFamilyParent(familyId, msg.sender);
        family.active = active;
        emit FamilyStatusUpdated(familyId, msg.sender, active);
    }

    function proposeChildRegistration(
        uint256 familyId,
        address childWallet,
        string calldata ensName
    ) external returns (bytes32 registrationId) {
        Family storage family = _family(familyId);
        if (family.parent != msg.sender) revert NotFamilyParent(familyId, msg.sender);
        if (!family.active) revert FamilyInactive(familyId);
        _requireAvailableChildWallet(childWallet);
        bytes32 ensNode = _namehash(ensName);

        bytes32 existingRegistrationId = pendingRegistrationIdByWallet[childWallet];
        if (existingRegistrationId != bytes32(0)) {
            revert ChildWalletRegistrationAlreadyPending(childWallet, existingRegistrationId);
        }

        registrationId = childRegistrationId(familyId, childWallet, ensNode);
        if (childRegistrations[registrationId].childWallet != address(0)) {
            revert ChildRegistrationAlreadyPending(registrationId);
        }
        childRegistrations[registrationId] = ChildRegistration({
            familyId: familyId,
            parent: msg.sender,
            childWallet: childWallet,
            ensNode: ensNode,
            ensName: ensName
        });
        pendingRegistrationIdByWallet[childWallet] = registrationId;
        emit ChildRegistrationProposed(registrationId, familyId, childWallet, ensNode, ensName);
    }

    function acceptChildRegistration(bytes32 registrationId) external returns (uint256 childId) {
        ChildRegistration memory registration = childRegistrations[registrationId];
        if (registration.childWallet == address(0)) {
            revert ChildRegistrationNotFound(registrationId);
        }
        if (msg.sender != registration.childWallet) {
            revert NotProposedChildWallet(registrationId, registration.childWallet, msg.sender);
        }

        Family storage family = _family(registration.familyId);
        if (family.parent != registration.parent) {
            revert NotFamilyParent(registration.familyId, registration.parent);
        }
        if (!family.active) revert FamilyInactive(registration.familyId);
        _requireAvailableChildWallet(registration.childWallet);

        childId = nextChildId++;
        children[childId] = Child({
            id: childId,
            familyId: registration.familyId,
            wallet: registration.childWallet,
            ensNode: registration.ensNode,
            ensName: registration.ensName,
            active: true
        });
        childIdByWallet[registration.childWallet] = childId;
        _deleteChildRegistration(registrationId, registration.childWallet);
        emit ChildRegistered(
            childId,
            registration.familyId,
            registration.childWallet,
            registration.ensNode,
            registration.ensName
        );
        emit ChildRegistrationAccepted(
            registrationId, childId, registration.familyId, registration.childWallet
        );
    }

    function cancelChildRegistration(bytes32 registrationId) external {
        ChildRegistration memory registration = childRegistrations[registrationId];
        if (registration.childWallet == address(0)) {
            revert ChildRegistrationNotFound(registrationId);
        }
        if (registration.parent != msg.sender && registration.childWallet != msg.sender) {
            revert NotChildRegistrationParticipant(registrationId, msg.sender);
        }
        _deleteChildRegistration(registrationId, registration.childWallet);
        emit ChildRegistrationCancelled(
            registrationId, registration.familyId, registration.childWallet, msg.sender
        );
    }

    function setChildStatus(uint256 childId, bool active) external {
        Child storage child = _child(childId);
        Family storage family = _family(child.familyId);
        if (family.parent != msg.sender) revert NotFamilyParent(child.familyId, msg.sender);
        child.active = active;
        emit ChildStatusUpdated(childId, child.familyId, active);
    }

    function getFamily(uint256 familyId) external view returns (Family memory) {
        return _family(familyId);
    }

    function getFamilyIdsByParent(address parent) external view returns (uint256[] memory) {
        return familyIdsByParent[parent];
    }

    function getChild(uint256 childId) external view returns (Child memory) {
        return _child(childId);
    }

    function getChildByWallet(address wallet) external view returns (Child memory) {
        uint256 childId = childIdByWallet[wallet];
        if (childId == 0) revert ChildNotFound(0);
        return _child(childId);
    }

    function getChildRegistration(bytes32 registrationId)
        external
        view
        returns (ChildRegistration memory)
    {
        ChildRegistration memory registration = childRegistrations[registrationId];
        if (registration.childWallet == address(0)) {
            revert ChildRegistrationNotFound(registrationId);
        }
        return registration;
    }

    function childRegistrationId(uint256 familyId, address childWallet, bytes32 ensNode)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(address(this), familyId, childWallet, ensNode));
    }

    function isParentOf(address parent, address childWallet) external view returns (bool) {
        uint256 childId = childIdByWallet[childWallet];
        if (childId == 0) return false;
        Child storage child = children[childId];
        Family storage family = families[child.familyId];
        return child.active && family.active && family.parent == parent;
    }

    function _family(uint256 familyId) private view returns (Family storage family) {
        family = families[familyId];
        if (family.id == 0) revert FamilyNotFound(familyId);
    }

    function _child(uint256 childId) private view returns (Child storage child) {
        child = children[childId];
        if (child.id == 0) revert ChildNotFound(childId);
    }

    function _requireAvailableChildWallet(address childWallet) private view {
        if (childWallet == address(0)) revert ZeroAddress();
        if (childIdByWallet[childWallet] != 0) {
            revert ChildWalletAlreadyRegistered(childWallet);
        }
        if (familyIdsByParent[childWallet].length != 0) {
            revert ParentWalletCannotBeChild(childWallet);
        }
    }

    function _deleteChildRegistration(bytes32 registrationId, address childWallet) private {
        delete childRegistrations[registrationId];
        delete pendingRegistrationIdByWallet[childWallet];
    }

    function _namehash(string calldata ensName) private pure returns (bytes32 node) {
        bytes memory name = bytes(ensName);
        uint256 nameLength = name.length;
        if (nameLength == 0 || nameLength > 255) revert InvalidEnsName();

        bytes32[] memory labelHashes = new bytes32[](128);
        uint256 labelCount;
        uint256 labelStart;
        for (uint256 i; i <= nameLength; ++i) {
            if (i != nameLength && name[i] != 0x2e) continue;
            uint256 labelLength = i - labelStart;
            if (labelLength == 0 || labelLength > 63) revert InvalidEnsName();
            labelHashes[labelCount++] = _labelHash(name, labelStart, labelLength);
            labelStart = i + 1;
        }
        while (labelCount != 0) {
            node = keccak256(abi.encodePacked(node, labelHashes[--labelCount]));
        }
    }

    function _labelHash(bytes memory name, uint256 start, uint256 length)
        private
        pure
        returns (bytes32 hash)
    {
        assembly ("memory-safe") {
            hash := keccak256(add(add(name, 0x20), start), length)
        }
    }
}
