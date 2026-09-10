// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAqua {
    function ship(
        address app,
        bytes calldata strategy,
        address[] calldata tokens,
        uint256[] calldata amounts
    ) external returns (bytes32 strategyHash);

    function dock(address app, bytes32 strategyHash, address[] calldata tokens) external;

    function push(address maker, address app, bytes32 strategyHash, address token, uint256 amount)
        external;

    function safeBalances(
        address maker,
        address app,
        bytes32 strategyHash,
        address token0,
        address token1
    ) external view returns (uint256 balance0, uint256 balance1);
}
