// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract StarToken is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant VAULT_FACTORY_ROLE = keccak256("VAULT_FACTORY_ROLE");

    uint256 public totalStarsIssued;
    uint256 public totalStarsBurned;
    mapping(address account => uint256 amount) public starsIssuedTo;
    mapping(address account => uint256 amount) public starsBurnedFrom;

    error ZeroAddress();
    error NonTransferable();

    constructor(address initialAdmin) ERC20("Star", "STAR") {
        if (initialAdmin == address(0)) revert ZeroAddress();
        _setRoleAdmin(MINTER_ROLE, VAULT_FACTORY_ROLE);
        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
    }

    function decimals() public pure override returns (uint8) {
        return 0;
    }

    function mint(address account, uint256 amount) external onlyRole(MINTER_ROLE) {
        totalStarsIssued += amount;
        starsIssuedTo[account] += amount;
        _mint(account, amount);
    }

    function burnFrom(address account, uint256 amount) external onlyRole(BURNER_ROLE) {
        totalStarsBurned += amount;
        starsBurnedFrom[account] += amount;
        _burn(account, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) revert NonTransferable();
        super._update(from, to, value);
    }
}
