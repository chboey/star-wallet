// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { StarToken } from "../src/StarToken.sol";

interface Vm {
    function expectRevert(bytes4 selector) external;
    function prank(address caller) external;
}

contract StarTokenTest {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);

    StarToken private token;

    function setUp() public {
        token = new StarToken(address(this));
        token.grantRole(token.VAULT_FACTORY_ROLE(), address(this));
        token.grantRole(token.MINTER_ROLE(), address(this));
        token.grantRole(token.BURNER_ROLE(), address(this));
    }

    function testUsesWholeNonTransferableStars() public view {
        require(keccak256(bytes(token.name())) == keccak256("Star"), "name");
        require(keccak256(bytes(token.symbol())) == keccak256("STAR"), "symbol");
        require(token.decimals() == 0, "whole Stars");
    }

    function testMintAndBurnTrackLifetimeAccounting() public {
        token.mint(ALICE, 12);
        token.burnFrom(ALICE, 5);

        require(token.balanceOf(ALICE) == 7, "balance");
        require(token.totalSupply() == 7, "supply");
        require(token.totalStarsIssued() == 12, "issued");
        require(token.totalStarsBurned() == 5, "burned");
        require(token.starsIssuedTo(ALICE) == 12, "account issued");
        require(token.starsBurnedFrom(ALICE) == 5, "account burned");
    }

    function testTransfersRemainDisabled() public {
        token.mint(ALICE, 1);

        VM.prank(ALICE);
        VM.expectRevert(StarToken.NonTransferable.selector);
        // forge-lint: disable-next-line(erc20-unchecked-transfer)
        token.transfer(BOB, 1);
    }

    function testRejectsZeroAdministrator() public {
        VM.expectRevert(StarToken.ZeroAddress.selector);
        new StarToken(address(0));
    }
}
