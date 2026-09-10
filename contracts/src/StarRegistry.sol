// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IStarRegistry } from "./interfaces/IStarRegistry.sol";

contract StarRegistry {
    uint256 public nextFamilyId = 1;

    mapping(uint256 familyId => IStarRegistry.Family family) private families;
    mapping(address parent => uint256[] familyIds) private familyIdsByParent;

    error FamilyNotFound(uint256 familyId);
    error InvalidEnsName();
    error NotFamilyParent(uint256 familyId, address account);

    event FamilyCreated(
        uint256 indexed familyId, address indexed parent, bytes32 indexed ensNode, string ensName
    );
    event FamilyStatusUpdated(uint256 indexed familyId, address indexed parent, bool active);

    function createFamily(string calldata ensName) external returns (uint256 familyId) {
        bytes32 ensNode = bytes(ensName).length == 0 ? bytes32(0) : _namehash(ensName);
        familyId = nextFamilyId++;
        families[familyId] = IStarRegistry.Family({
            id: familyId, parent: msg.sender, ensNode: ensNode, ensName: ensName, active: true
        });
        familyIdsByParent[msg.sender].push(familyId);
        emit FamilyCreated(familyId, msg.sender, ensNode, ensName);
    }

    function setFamilyStatus(uint256 familyId, bool active) external {
        IStarRegistry.Family storage family = _family(familyId);
        if (family.parent != msg.sender) revert NotFamilyParent(familyId, msg.sender);
        family.active = active;
        emit FamilyStatusUpdated(familyId, msg.sender, active);
    }

    function getFamily(uint256 familyId) external view returns (IStarRegistry.Family memory) {
        return _family(familyId);
    }

    function getFamilyIdsByParent(address parent) external view returns (uint256[] memory) {
        return familyIdsByParent[parent];
    }

    function _family(uint256 familyId) private view returns (IStarRegistry.Family storage family) {
        family = families[familyId];
        if (family.id == 0) revert FamilyNotFound(familyId);
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
