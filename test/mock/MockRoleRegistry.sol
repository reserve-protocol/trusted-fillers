// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

import { AccessControlEnumerable } from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";

import { IRoleRegistry } from "../../contracts/interfaces/IRoleRegistry.sol";

/**
 * @title MockRoleRegistry
 * @notice Contract to manage roles for RToken <> DAO interactions
 */
contract MockRoleRegistry is AccessControlEnumerable, IRoleRegistry {
    bytes32 public constant EMERGENCY_COUNCIL = keccak256("EMERGENCY_COUNCIL");

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function isOwner(address account) public view returns (bool) {
        return hasRole(DEFAULT_ADMIN_ROLE, account);
    }

    function isEmergencyCouncil(address account) public view returns (bool) {
        return hasRole(EMERGENCY_COUNCIL, account);
    }

    function isOwnerOrEmergencyCouncil(address account) public view returns (bool) {
        return hasRole(DEFAULT_ADMIN_ROLE, account) || hasRole(EMERGENCY_COUNCIL, account);
    }
}
