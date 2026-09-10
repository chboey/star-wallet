// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { StarQuests } from "./StarQuests.sol";
import { IStarRegistry } from "./interfaces/IStarRegistry.sol";

/// @dev Separates workflow creation bytecode from the vault factory's runtime (EIP-170).
contract StarQuestsFactory {
    function create(IStarRegistry registry, uint256 familyId) external returns (StarQuests) {
        return new StarQuests(registry, familyId, msg.sender);
    }
}
