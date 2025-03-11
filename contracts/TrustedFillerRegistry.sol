// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IRoleRegistry } from "@interfaces/IRoleRegistry.sol";

import { ITrustedFillerRegistry } from "@interfaces/ITrustedFillerRegistry.sol";
import { IBaseTrustedFiller } from "@interfaces/IBaseTrustedFiller.sol";

/**
 * @title TrustedFillerRegistry
 * @author akshatmittal, julianmrodri, pmckelvy1, tbrent
 * @notice Registry for Trusted Fillers
 */
contract TrustedFillerRegistry is ITrustedFillerRegistry {
    IRoleRegistry public immutable roleRegistry;

    mapping(address filler => bool allowed) private trustedFillers;

    constructor(IRoleRegistry _roleRegistry) {
        require(address(_roleRegistry) != address(0), TrustedFillerRegistry__InvalidRoleRegistry());

        roleRegistry = _roleRegistry;
    }

    function addTrustedFiller(IBaseTrustedFiller _filler) external {
        require(roleRegistry.isOwner(msg.sender), TrustedFillerRegistry__InvalidCaller());
        require(address(_filler) != address(0), TrustedFillerRegistry__InvalidFiller());

        trustedFillers[address(_filler)] = true;

        emit TrustedFillerAdded(_filler);
    }

    function deprecateTrustedFiller(IBaseTrustedFiller _filler) external {
        require(roleRegistry.isOwnerOrEmergencyCouncil(msg.sender), TrustedFillerRegistry__InvalidCaller());
        require(address(_filler) != address(0), TrustedFillerRegistry__InvalidFiller());

        trustedFillers[address(_filler)] = false;

        emit TrustedFillerDeprecated(_filler);
    }

    function isAllowed(address _filler) external view returns (bool) {
        return trustedFillers[_filler];
    }
}
