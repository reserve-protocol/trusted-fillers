// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Test.sol";

import { MockERC20 } from "@mock/MockERC20.sol";
import { MockEIP712 } from "@mock/MockEIP712.sol";

import { ImmutableTokenJar } from "@src/extras/ImmutableTokenJar.sol";
import { GPV2_SETTLEMENT } from "@src/fillers/cowswap/Constants.sol";
import { GPv2OrderLib } from "@src/fillers/cowswap/GPv2OrderLib.sol";

contract ImmutableTokenJarTest is Test {
    using GPv2OrderLib for GPv2OrderLib.Data;

    ImmutableTokenJar jar;

    MockERC20 sellToken;
    MockERC20 buyToken;

    address destination = address(0xBEEF);

    uint256 ownerPk;
    address owner;

    function setUp() public {
        // deploy a MockEIP712 to the GPV2_SETTLEMENT address
        address mockEIP712 = address(
            new MockEIP712(0xc078f884a2676e1345748b1feace7b0abee5d00ecadb6e574dcdd109a63e8943)
        );
        vm.etch(address(GPV2_SETTLEMENT), mockEIP712.code);

        sellToken = new MockERC20("Sell Token", "SELL", 18);
        buyToken = new MockERC20("Buy Token", "BUY", 18);

        ownerPk = 0xA11CE;
        owner = vm.addr(ownerPk);

        jar = new ImmutableTokenJar(destination, buyToken, owner);
    }

    function _defaultOrder() internal view returns (GPv2OrderLib.Data memory order) {
        order = GPv2OrderLib.Data({
            sellToken: sellToken,
            buyToken: buyToken,
            receiver: address(jar),
            sellAmount: 1e18,
            buyAmount: 2e18,
            validTo: uint32(block.timestamp + 1 days),
            appData: bytes32(0),
            feeAmount: 0,
            kind: GPv2OrderLib.KIND_SELL,
            partiallyFillable: false,
            sellTokenBalance: GPv2OrderLib.BALANCE_ERC20,
            buyTokenBalance: GPv2OrderLib.BALANCE_ERC20
        });
    }

    function _encode1271Signature(
        GPv2OrderLib.Data memory order,
        bytes memory userSignature
    ) internal pure returns (bytes memory signature) {
        ImmutableTokenJar.OrderData memory orderData = ImmutableTokenJar.OrderData({
            order: order,
            userSignature: userSignature
        });
        signature = abi.encode(orderData);
    }

    function test_ImmutableTokenJar_isValidSignature_ownerSignatureRequired() public {
        GPv2OrderLib.Data memory order = _defaultOrder();
        bytes32 orderHash = order.hash(GPV2_SETTLEMENT.domainSeparator());

        // Sign the *typed data digest* directly (no personal_sign prefix),
        // matching how GPv2 order hashes are signed.
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPk, orderHash);
        bytes memory userSig = abi.encodePacked(r, s, v);

        bytes memory signature = _encode1271Signature(order, userSig);

        bytes4 magic = jar.isValidSignature(orderHash, signature);
        assertEq(magic, jar.isValidSignature.selector);
    }

    function test_ImmutableTokenJar_isValidSignature_revertsOnWrongSigner() public {
        GPv2OrderLib.Data memory order = _defaultOrder();
        bytes32 orderHash = order.hash(GPV2_SETTLEMENT.domainSeparator());

        uint256 attackerPk = 0xB0B;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attackerPk, orderHash);
        bytes memory userSig = abi.encodePacked(r, s, v);

        bytes memory signature = _encode1271Signature(order, userSig);

        vm.expectRevert(abi.encodeWithSelector(ImmutableTokenJar.ImmutableTokenJar__OrderCheckFailed.selector, 100));
        jar.isValidSignature(orderHash, signature);
    }

    function test_ImmutableTokenJar_isValidSignature_skipsSignatureCheckAfterRenounce() public {
        GPv2OrderLib.Data memory order = _defaultOrder();
        bytes32 orderHash = order.hash(GPV2_SETTLEMENT.domainSeparator());

        // Renounce ownership -> owner() becomes address(0), so signature check is bypassed.
        vm.prank(owner);
        jar.renounceOwnership();

        bytes memory signature = _encode1271Signature(order, "");
        bytes4 magic = jar.isValidSignature(orderHash, signature);
        assertEq(magic, jar.isValidSignature.selector);
    }
}
