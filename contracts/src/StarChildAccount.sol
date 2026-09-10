// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { StarRegistry } from "./StarRegistry.sol";
import { StarGoals } from "./StarGoals.sol";
import { StarQuests } from "./StarQuests.sol";
import { Account } from "@openzeppelin/contracts/account/Account.sol";
import { PackedUserOperation } from "@openzeppelin/contracts/interfaces/draft-IERC4337.sol";
import { WebAuthn } from "@openzeppelin/contracts-passkeys/utils/cryptography/WebAuthn.sol";
import { P256 } from "@openzeppelin/contracts-passkeys/utils/cryptography/P256.sol";

interface IQuestVaultFactory {
    function vaultByFamily(uint256 familyId) external view returns (address);
}

interface IQuestVault {
    function quests() external view returns (StarQuests);
}

/// @notice ERC-4337 child identity restricted to explicit protocol actions.
contract StarChildAccount is Account {
    StarRegistry public immutable registry;
    StarGoals public immutable goals;
    IQuestVaultFactory public immutable vaultFactory;
    uint256 public immutable familyId;
    bytes32 public immutable ensNode;
    bytes32 public immutable publicKeyX;
    bytes32 public immutable publicKeyY;
    bytes32 public immutable rpIdHash;
    string public credentialId;

    error InvalidCredential();
    error WrongRegistration();

    constructor(
        StarRegistry registry_,
        StarGoals goals_,
        uint256 familyId_,
        bytes32 ensNode_,
        bytes32 qx,
        bytes32 qy,
        bytes32 rpIdHash_,
        string memory credentialId_,
        IQuestVaultFactory vaultFactory_
    ) {
        if (
            !P256.isValidPublicKey(qx, qy) || bytes(credentialId_).length == 0
                || bytes(credentialId_).length > 1024
        ) revert InvalidCredential();
        registry = registry_;
        goals = goals_;
        familyId = familyId_;
        ensNode = ensNode_;
        publicKeyX = qx;
        publicKeyY = qy;
        rpIdHash = rpIdHash_;
        credentialId = credentialId_;
        vaultFactory = vaultFactory_;
    }

    function acceptRegistration(bytes32 registrationId) external onlyEntryPoint returns (uint256) {
        StarRegistry.ChildRegistration memory registration =
            registry.getChildRegistration(registrationId);
        if (
            registration.familyId != familyId || registration.childWallet != address(this)
                || registration.ensNode != ensNode
        ) revert WrongRegistration();
        return registry.acceptChildRegistration(registrationId);
    }

    function requestRedemption(uint256 goalId) external onlyEntryPoint returns (uint256) {
        return goals.requestRedemption(goalId);
    }

    function goalContributionsVersion() external pure returns (uint256) {
        return 1;
    }

    function addStarsToGoal(uint256 goalId, uint256 amount) external onlyEntryPoint {
        goals.addStarsToGoal(goalId, amount);
    }

    function cancelRedemption(uint256 redemptionId) external onlyEntryPoint {
        goals.cancelRedemption(redemptionId);
    }

    function requestGoal(
        string calldata title,
        string calldata reason,
        uint8 icon,
        bytes32 submissionId
    ) external onlyEntryPoint returns (uint256) {
        return goals.requestGoal(
            registry.childIdByWallet(address(this)), title, reason, icon, submissionId
        );
    }

    function cancelGoalRequest(uint256 requestId) external onlyEntryPoint {
        goals.cancelGoalRequest(requestId);
    }

    function submitQuest(uint256 questId, bytes32 submissionId)
        external
        onlyEntryPoint
        returns (uint256)
    {
        return _quests().submitQuest(questId, submissionId);
    }

    function requestStars(uint256 stars, string calldata reason, bytes32 submissionId)
        external
        onlyEntryPoint
        returns (uint256)
    {
        return _quests().requestStars(stars, reason, submissionId);
    }

    function cancelStarRequest(uint256 requestId) external onlyEntryPoint {
        _quests().cancelRequest(requestId);
    }

    function _quests() private view returns (StarQuests) {
        return IQuestVault(vaultFactory.vaultByFamily(familyId)).quests();
    }

    function _validateUserOp(PackedUserOperation calldata op, bytes32 hash)
        internal
        override
        returns (uint256)
    {
        if (op.sender != address(this) || op.initCode.length != 0 || op.callData.length < 4) return 1;
        bytes4 selector = bytes4(op.callData[:4]);
        // Four heads, two dynamic string lengths, title <=64 bytes, reason <=480 bytes.
        if (
            selector == this.requestGoal.selector && op.callData.length >= 228
                && op.callData.length <= 740
        ) return super._validateUserOp(op, hash);
        if (selector == this.submitQuest.selector && op.callData.length == 68) {
            return super._validateUserOp(op, hash);
        }
        if (selector == this.addStarsToGoal.selector && op.callData.length == 68) {
            return super._validateUserOp(op, hash);
        }
        if (
            selector == this.requestStars.selector && op.callData.length >= 164
                && op.callData.length <= 260
        ) return super._validateUserOp(op, hash);
        if (selector == this.cancelStarRequest.selector && op.callData.length == 36) {
            return super._validateUserOp(op, hash);
        }
        if (op.callData.length != 36) return 1;
        if (
            selector != this.acceptRegistration.selector
                && selector != this.requestRedemption.selector
                && selector != this.cancelRedemption.selector
                && selector != this.cancelGoalRequest.selector
        ) return 1;
        return super._validateUserOp(op, hash);
    }

    function _rawSignatureValidation(bytes32 hash, bytes calldata signature)
        internal
        view
        override
        returns (bool)
    {
        if (signature.length > 4096) return false;
        (bool decoded, WebAuthn.WebAuthnAuth calldata auth) = WebAuthn.tryDecodeAuth(signature);
        if (
            !decoded || auth.authenticatorData.length < 37
                || bytes32(auth.authenticatorData[:32]) != rpIdHash
        ) return false;
        return WebAuthn.verify(abi.encodePacked(hash), auth, publicKeyX, publicKeyY, true);
    }
}
