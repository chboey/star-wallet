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

/// @notice ERC-4337 v0.8 child identity authenticated by a device passkey.
/// @dev Parent-approved device keys only access the same narrow child methods. No executor or upgrades.
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
    bytes32 public parentPublicKeyX;
    bytes32 public parentPublicKeyY;
    string public parentCredentialId;
    uint256 public parentAuthorizationEpoch;
    bytes4 private constant PARENT_SESSION = 0x53575031;
    bytes32 private constant AUTHORIZATION_TYPEHASH = keccak256(
        "StarParentAuthorization(uint256 chainId,address account,uint256 familyId,uint256 epoch,bytes32 deviceKeyX,bytes32 deviceKeyY)"
    );

    error WrongRegistration();
    error InvalidCredential();
    error NotParent();
    event ParentPasskeyConfigured(uint256 indexed epoch);
    event ParentAuthorizationsRevoked(uint256 indexed epoch);

    function parentAuthorizationVersion() external pure returns (uint256) {
        return 1;
    }

    /// @notice Wallet-authenticated enrollment. A device PIN is never signing authority.
    function configureParentPasskey(bytes32 qx, bytes32 qy, string calldata id) external {
        _checkParent();
        if (!P256.isValidPublicKey(qx, qy) || bytes(id).length == 0 || bytes(id).length > 1024) {
            revert InvalidCredential();
        }
        parentPublicKeyX = qx;
        parentPublicKeyY = qy;
        parentCredentialId = id;
        emit ParentPasskeyConfigured(++parentAuthorizationEpoch);
    }

    /// @notice Invalidates all existing device grants, without moving any funds or Stars.
    function revokeParentAuthorizations() external {
        _checkParent();
        emit ParentAuthorizationsRevoked(++parentAuthorizationEpoch);
    }

    function _checkParent() private view {
        if (registry.getFamily(familyId).parent != msg.sender) revert NotParent();
    }

    function parentAuthorizationDigest(bytes32 deviceX, bytes32 deviceY, uint256 epoch)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                AUTHORIZATION_TYPEHASH,
                block.chainid,
                address(this),
                familyId,
                epoch,
                deviceX,
                deviceY
            )
        );
    }

    function isParentAuthorizationValid(
        bytes32 deviceX,
        bytes32 deviceY,
        uint256 epoch,
        bytes calldata proof
    ) public view returns (bool) {
        if (bytes(parentCredentialId).length == 0 || epoch != parentAuthorizationEpoch) return false;
        return _verifyPasskey(
            parentAuthorizationDigest(deviceX, deviceY, epoch),
            proof,
            parentPublicKeyX,
            parentPublicKeyY
        );
    }

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
        ) {
            return _validateChildAuthorization(op, hash);
        }
        if (selector == this.submitQuest.selector && op.callData.length == 68) {
            return _validateChildAuthorization(op, hash);
        }
        if (selector == this.addStarsToGoal.selector && op.callData.length == 68) {
            return _validateChildAuthorization(op, hash);
        }
        if (
            selector == this.requestStars.selector && op.callData.length >= 164
                && op.callData.length <= 260
        ) return _validateChildAuthorization(op, hash);
        if (selector == this.cancelStarRequest.selector && op.callData.length == 36) {
            return _validateChildAuthorization(op, hash);
        }
        if (op.callData.length != 36) return 1;
        if (
            selector != this.acceptRegistration.selector
                && selector != this.requestRedemption.selector
                && selector != this.cancelRedemption.selector
                && selector != this.cancelGoalRequest.selector
        ) return 1;
        return _validateChildAuthorization(op, hash);
    }

    function _validateChildAuthorization(PackedUserOperation calldata op, bytes32 hash)
        private
        returns (uint256)
    {
        bytes calldata sig = op.signature;
        if (sig.length >= 356 && sig.length <= 4096 && bytes4(sig[:4]) == PARENT_SESSION) {
            // Fixed-width header avoids decoding attacker-controlled dynamic offsets.
            uint256 epoch = uint256(bytes32(sig[4:36]));
            bytes32 deviceX = bytes32(sig[36:68]);
            bytes32 deviceY = bytes32(sig[68:100]);
            if (!isParentAuthorizationValid(deviceX, deviceY, epoch, sig[164:])) return 1;
            return P256.verify(
                sha256(abi.encodePacked(hash)),
                bytes32(sig[100:132]),
                bytes32(sig[132:164]),
                deviceX,
                deviceY
            )
                ? 0
                : 1;
        }
        // Once Papa controls this account, the original child's passkey cannot
        // bypass revocation. Registration remains available for onboarding only.
        if (
            parentAuthorizationEpoch != 0
                && bytes4(op.callData[:4]) != this.acceptRegistration.selector
        ) return 1;
        return super._validateUserOp(op, hash);
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

    function _rawSignatureValidation(bytes32 hash, bytes calldata signature)
        internal
        view
        override
        returns (bool)
    {
        return _verifyPasskey(hash, signature, publicKeyX, publicKeyY);
    }

    function _verifyPasskey(bytes32 hash, bytes calldata signature, bytes32 qx, bytes32 qy)
        private
        view
        returns (bool)
    {
        if (signature.length > 4096) return false;
        (bool decoded, WebAuthn.WebAuthnAuth calldata auth) = WebAuthn.tryDecodeAuth(signature);
        if (
            !decoded || auth.authenticatorData.length < 37
                || bytes32(auth.authenticatorData[:32]) != rpIdHash
        ) return false;
        return WebAuthn.verify(abi.encodePacked(hash), auth, qx, qy, true);
    }
}
