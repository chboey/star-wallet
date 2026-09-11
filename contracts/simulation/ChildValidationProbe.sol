// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Read-only RPC probe. Never deployed or included in a UserOperation.
/// @dev Temporarily substitutes EntryPoint code in eth_call so the original account
///      sees its authorized caller. Measures execution, excluding transaction calldata gas.
contract ChildValidationProbe {
    error ValidationFailed(bytes reason);
    error InvalidResult();
    error NativeP256Unavailable();

    function measure(address account, bytes calldata validationCall)
        external
        returns (uint256 gasUsed, uint256 validationData)
    {
        // Same public Wycheproof vector used by OpenZeppelin P256 to detect RIP-7212.
        // Native verification makes an invalid signature's two checks an upper bound
        // for a valid signature's single check. Do not estimate variable-cost fallback code.
        (bool supported, bytes memory proof) = address(0x100)
            .staticcall(
                abi.encode(
                    bytes32(0xbb5a52f42f9c9261ed4361f59422a1e30036e7c32b270c8807a419feca605023),
                    uint256(5),
                    uint256(1),
                    bytes32(0xa71af64de5126a4a4e02b7922d66ce9415ce88a4c9d25514d91082c8725ac957),
                    bytes32(0x5d47723c8fbe580bb369fec9c2665d8e30a435b9932645482e7c9f11e872296b)
                )
            );
        if (!supported || proof.length != 32 || abi.decode(proof, (uint256)) != 1) {
            revert NativeP256Unavailable();
        }
        uint256 beforeGas = gasleft();
        (bool success, bytes memory result) = account.call(validationCall);
        gasUsed = beforeGas - gasleft();
        if (!success) revert ValidationFailed(result);
        if (result.length != 32) revert InvalidResult();
        validationData = abi.decode(result, (uint256));
    }
}
