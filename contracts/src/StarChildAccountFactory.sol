// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { StarChildAccount, IQuestVaultFactory } from "./StarChildAccount.sol";
import { StarRegistry } from "./StarRegistry.sol";
import { StarGoals } from "./StarGoals.sol";
import { IStarRegistry } from "./interfaces/IStarRegistry.sol";

/// @notice Parent deploys; accounts support child onboarding and parent-approved device access.
contract StarChildAccountFactory {
    StarRegistry public immutable registry;
    StarGoals public immutable goals;
    IQuestVaultFactory public immutable vaultFactory;
    string public rpId;
    mapping(uint256 familyId => mapping(bytes32 ensNode => address)) public accountByName;
    mapping(address account => bool) public isChildAccount;

    error InvalidConfiguration();
    error NotActiveParent();
    error InvalidEnsNode();
    error CredentialMismatch();

    event ChildAccountCreated(
        uint256 indexed familyId, bytes32 indexed ensNode, address indexed account
    );

    constructor(
        StarRegistry registry_,
        StarGoals goals_,
        string memory rpId_,
        IQuestVaultFactory vaultFactory_
    ) {
        if (
            address(registry_) == address(0) || address(goals_) == address(0)
                || address(vaultFactory_) == address(0) || bytes(rpId_).length == 0
                || bytes(rpId_).length > 253
        ) {
            revert InvalidConfiguration();
        }
        registry = registry_;
        goals = goals_;
        rpId = rpId_;
        vaultFactory = vaultFactory_;
    }

    function createChildAccount(
        uint256 familyId,
        bytes32 ensNode,
        bytes32 qx,
        bytes32 qy,
        string calldata credentialId
    ) external returns (StarChildAccount account) {
        if (address(goals.registry()) != address(registry)) {
            revert InvalidConfiguration();
        }
        IStarRegistry.Family memory family = registry.getFamily(familyId);
        if (family.parent != msg.sender || !family.active) revert NotActiveParent();
        if (ensNode == bytes32(0)) revert InvalidEnsNode();
        address predicted = predictChildAccount(familyId, ensNode, qx, qy, credentialId);
        // Retries after a confirmed deployment do not create another account.
        if (isChildAccount[predicted]) return StarChildAccount(payable(predicted));
        if (accountByName[familyId][ensNode] != address(0)) revert CredentialMismatch();
        account = new StarChildAccount{ salt: _salt(familyId, ensNode) }(
            registry,
            goals,
            familyId,
            ensNode,
            qx,
            qy,
            sha256(bytes(rpId)),
            credentialId,
            vaultFactory
        );
        isChildAccount[address(account)] = true;
        accountByName[familyId][ensNode] = address(account);
        emit ChildAccountCreated(familyId, ensNode, address(account));
    }

    function predictChildAccount(
        uint256 familyId,
        bytes32 ensNode,
        bytes32 qx,
        bytes32 qy,
        string memory credentialId
    ) public view returns (address) {
        bytes32 initHash = keccak256(
            abi.encodePacked(
                type(StarChildAccount).creationCode,
                abi.encode(
                    registry,
                    goals,
                    familyId,
                    ensNode,
                    qx,
                    qy,
                    sha256(bytes(rpId)),
                    credentialId,
                    vaultFactory
                )
            )
        );
        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            bytes1(0xff), address(this), _salt(familyId, ensNode), initHash
                        )
                    )
                )
            )
        );
    }

    function _salt(uint256 familyId, bytes32 ensNode) private pure returns (bytes32) {
        return keccak256(abi.encode(familyId, ensNode));
    }
}
