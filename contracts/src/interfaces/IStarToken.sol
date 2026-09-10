// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IStarToken {
    function MINTER_ROLE() external view returns (bytes32);
    function balanceOf(address account) external view returns (uint256);
    function grantRole(bytes32 role, address account) external;
    function mint(address account, uint256 amount) external;
    function burnFrom(address account, uint256 amount) external;
}
