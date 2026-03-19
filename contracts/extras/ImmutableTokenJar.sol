// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC1271 } from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import { IERC20, SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import { GPV2_SETTLEMENT, GPV2_VAULT_RELAYER } from "@src/fillers/cowswap/Constants.sol";
import { GPv2OrderLib } from "@src/fillers/cowswap/GPv2OrderLib.sol";

/**
 * @title Immutable Token Jar
 * @notice Simple jar contract that can receive any ERC20 token, convert it to the
 *         destination token and send it to the destination address, using CowSwap.
 *
 * Integration Notes:
 * 1. Tokens with low liquidity or solver integration might fail to fulfil or
 *    have poor competition and hence effectiveness. This is designed to work with
 *    tokens with sufficient liquidity and CowSwap compatibility.
 * 2. Solvers typically optimize for `score`, see CowSwap Documentation to
 *    understand how this might impact your order and solver competition.
 * 3. When run in permissionless mode (ie: no signer), the order submitter can
 *    claim up to 1% in additional fees as partner fee. You can avoid this
 *    by using a signer.
 */
contract ImmutableTokenJar is Ownable, IERC1271 {
    using GPv2OrderLib for GPv2OrderLib.Data;
    using SafeERC20 for IERC20;

    address public immutable destination;
    IERC20 public immutable token;

    struct OrderData {
        GPv2OrderLib.Data order;
        bytes userSignature;
    }

    error ImmutableTokenJar__InvalidInitialization(uint256 errorCode);
    error ImmutableTokenJar__OrderCheckFailed(uint256 errorCode);

    constructor(address _destination, IERC20 _token, address _signer) Ownable(_signer) {
        require(_destination != address(0), ImmutableTokenJar__InvalidInitialization(1));
        require(address(_token) != address(0), ImmutableTokenJar__InvalidInitialization(2));

        destination = _destination;
        token = _token;
    }

    /// @dev preHook for CowSwap Order
    function approveTokensToRelayer(IERC20[] memory _tokens) external {
        for (uint256 i = 0; i < _tokens.length; i++) {
            _tokens[i].forceApprove(GPV2_VAULT_RELAYER, type(uint256).max);
        }
    }

    /// @dev Transfers all held `token` to `destination`, can be used as postHook
    function pushTokens() external {
        token.safeTransfer(destination, token.balanceOf(address(this)));
    }

    /// @dev Helper function for offchain orderHash calculation & validation
    function getOrderHash(bytes calldata signature) external view returns (bytes32) {
        OrderData memory orderData = abi.decode(signature, (OrderData));

        return orderData.order.hash(GPV2_SETTLEMENT.domainSeparator());
    }

    function invalidateOrder(bytes calldata orderUid) external onlyOwner {
        GPV2_SETTLEMENT.invalidateOrder(orderUid);
    }

    /// @dev Validates CowSwap order for a fill via EIP-1271
    function isValidSignature(bytes32 orderHash, bytes calldata signature) external view returns (bytes4) {
        OrderData memory orderData = abi.decode(signature, (OrderData));
        GPv2OrderLib.Data memory order = orderData.order;

        // Verify Order Hash
        require(orderHash == order.hash(GPV2_SETTLEMENT.domainSeparator()), ImmutableTokenJar__OrderCheckFailed(0)); // Invalid Order Hash

        require(order.sellToken != token, ImmutableTokenJar__OrderCheckFailed(1)); // Invalid Sell Token
        require(order.buyToken == token, ImmutableTokenJar__OrderCheckFailed(2)); // Invalid Buy Token
        require(order.feeAmount == 0, ImmutableTokenJar__OrderCheckFailed(3)); // Must be a Limit Order
        require(order.receiver == address(this), ImmutableTokenJar__OrderCheckFailed(4)); // Receiver must be self
        require(order.sellTokenBalance == GPv2OrderLib.BALANCE_ERC20, ImmutableTokenJar__OrderCheckFailed(5)); // Must use ERC20 Balance
        require(order.buyTokenBalance == GPv2OrderLib.BALANCE_ERC20, ImmutableTokenJar__OrderCheckFailed(6)); // Must use ERC20 Balance
        require(order.sellAmount != 0, ImmutableTokenJar__OrderCheckFailed(7));
        require(order.buyAmount != 0, ImmutableTokenJar__OrderCheckFailed(8));

        if (owner() != address(0)) {
            bytes32 messageHash = MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encodePacked(orderHash)));
            address signer = ECDSA.recover(messageHash, orderData.userSignature);

            if (signer != owner()) {
                revert ImmutableTokenJar__OrderCheckFailed(100); // Unauthorized Signer
            }
        }

        // If all checks pass, return the magic value
        return this.isValidSignature.selector;
    }
}
