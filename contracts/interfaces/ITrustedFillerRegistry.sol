// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IBaseTrustedFiller } from "@interfaces/IBaseTrustedFiller.sol";

interface ITrustedFillerRegistry {
    error TrustedFillerRegistry__InvalidCaller();

    error TrustedFillerRegistry__InvalidRoleRegistry();
    error TrustedFillerRegistry__InvalidFiller();

    event TrustedFillerAdded(IBaseTrustedFiller swapper);
    event TrustedFillerDeprecated(IBaseTrustedFiller swapper);

    function addTrustedFiller(IBaseTrustedFiller _filler) external;

    function deprecateTrustedFiller(IBaseTrustedFiller _filler) external;

    function isAllowed(address _filler) external view returns (bool);
}
