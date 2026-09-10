// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IStarRegistry {
    struct Family {
        uint256 id;
        address parent;
        bytes32 ensNode;
        string ensName;
        bool active;
    }

    struct Child {
        uint256 id;
        uint256 familyId;
        address wallet;
        bytes32 ensNode;
        string ensName;
        bool active;
    }

    function getFamily(uint256 familyId) external view returns (Family memory);
    function getFamilyIdsByParent(address parent) external view returns (uint256[] memory);
    function getChild(uint256 childId) external view returns (Child memory);
    function getChildByWallet(address wallet) external view returns (Child memory);
    function isParentOf(address parent, address childWallet) external view returns (bool);
}
