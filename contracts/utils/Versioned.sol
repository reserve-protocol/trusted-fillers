// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title Versioned
 * @notice Defines spec version, not filler revision.
 */
abstract contract Versioned {
    function version() external pure returns (uint256) {
        return 2;
    }
}
