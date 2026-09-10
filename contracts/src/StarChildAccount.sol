// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Account } from "@openzeppelin/contracts/account/Account.sol";
import { WebAuthn } from "@openzeppelin/contracts-passkeys/utils/cryptography/WebAuthn.sol";
import { P256 } from "@openzeppelin/contracts-passkeys/utils/cryptography/P256.sol";

/// @notice Minimal ERC-4337 child account authenticated by a bound WebAuthn credential.
contract StarChildAccount is Account {
    bytes32 public immutable publicKeyX;
    bytes32 public immutable publicKeyY;
    bytes32 public immutable rpIdHash;
    string public credentialId;

    error InvalidCredential();

    constructor(bytes32 qx, bytes32 qy, bytes32 rpIdHash_, string memory credentialId_) {
        if (
            !P256.isValidPublicKey(qx, qy) || bytes(credentialId_).length == 0
                || bytes(credentialId_).length > 1024
        ) revert InvalidCredential();
        publicKeyX = qx;
        publicKeyY = qy;
        rpIdHash = rpIdHash_;
        credentialId = credentialId_;
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
