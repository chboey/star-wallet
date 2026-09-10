// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { StarChildAccount } from "../src/StarChildAccount.sol";
import { PackedUserOperation } from "@openzeppelin/contracts/interfaces/draft-IERC4337.sol";
import { Base64 } from "@openzeppelin/contracts/utils/Base64.sol";

interface ChildAccountVm {
    function prank(address sender) external;
    function expectRevert() external;
    function signP256(uint256 key, bytes32 digest) external pure returns (bytes32 r, bytes32 s);
    function publicKeyP256(uint256 key) external pure returns (uint256 x, uint256 y);
}

contract StarChildAccountTest {
    ChildAccountVm private constant VM =
        ChildAccountVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant ENTRY_POINT = 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108;
    uint256 private constant CHILD_KEY = 12345;
    StarChildAccount private account;
    bytes32 private publicKeyX;
    bytes32 private publicKeyY;

    function setUp() public {
        (uint256 qx, uint256 qy) = VM.publicKeyP256(CHILD_KEY);
        publicKeyX = bytes32(qx);
        publicKeyY = bytes32(qy);
        account =
            new StarChildAccount(publicKeyX, publicKeyY, sha256("localhost"), "child-credential");
    }

    function testBindsCredentialAndValidatesWebAuthnUserOperation() public {
        require(account.publicKeyX() == publicKeyX, "x coordinate");
        require(account.publicKeyY() == publicKeyY, "y coordinate");
        require(account.rpIdHash() == sha256("localhost"), "RP ID");
        require(keccak256(bytes(account.credentialId())) == keccak256("child-credential"));

        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData = hex"12345678";
        bytes32 hash = keccak256("bound child operation");
        op.signature = _signature(hash, CHILD_KEY, sha256("localhost"), 0x05);
        require(_validate(op, hash) == 0, "valid passkey rejected");
    }

    function testRejectsWrongKeyReplayRpAndMissingUserVerification() public {
        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData = hex"12345678";
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
        op.signature = _signature(bytes32(0), CHILD_KEY, sha256("localhost"), 0x05);
        VM.expectRevert();
        account.validateUserOp(op, bytes32(0), 0);
    }

    function testRejectsInvalidCredentialConfiguration() public {
        string memory oversizedCredential = new string(1025);
        require(!_canDeploy(bytes32(0), bytes32(0), "invalid"), "invalid key");
        require(!_canDeploy(publicKeyX, publicKeyY, ""), "empty credential");
        require(!_canDeploy(publicKeyX, publicKeyY, oversizedCredential), "oversized credential");
    }

    function _canDeploy(bytes32 qx, bytes32 qy, string memory credential) private returns (bool) {
        try new StarChildAccount(qx, qy, sha256("localhost"), credential) {
            return true;
        } catch {
            return false;
        }
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
