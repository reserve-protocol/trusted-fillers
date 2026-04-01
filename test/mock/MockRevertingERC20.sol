// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { MockERC20 } from "@mock/MockERC20.sol";

contract MockRevertingERC20 is MockERC20 {
    address public revertingReceiver;

    constructor(string memory name_, string memory symbol_, uint256 decimals_) MockERC20(name_, symbol_, decimals_) { }

    function setRevertingReceiver(address account) external {
        revertingReceiver = account;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(from == address(0) || to != revertingReceiver, "MockRevertingERC20: transfer reverted");
        super._update(from, to, value);
    }
}
