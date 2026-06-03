// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { GenericTokenJar } from "@src/extras/GenericTokenJar.sol";
import { ITrustedFillerRegistry } from "@src/interfaces/ITrustedFillerRegistry.sol";

string constant junkSeedPhrase = "test test test test test test test test test test test junk";

contract DeployGenericTokenJar is Script {
    string seedPhrase = block.chainid != 31337 ? vm.readFile(".seed") : junkSeedPhrase;
    uint256 privateKey = vm.deriveKey(seedPhrase, 0);
    address walletAddress = vm.rememberKey(privateKey);

    function run() external returns (GenericTokenJar jar) {
        require(block.chainid == 8453);
        ITrustedFillerRegistry trustedFillerRegistry =
            ITrustedFillerRegistry(0x72DB5f49D0599C314E2f2FEDf6Fe33E1bA6C7A18);

        vm.startBroadcast(privateKey);
        jar = new GenericTokenJar(
            walletAddress,
            IERC20(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913), // USDC Base
            address(0x170D196640702B3CE182a3406428B68F3e7b7694), // signer (safe)
            trustedFillerRegistry
        );
        // jar.renounceOwnership();
        vm.stopBroadcast();

        console2.log("GenericTokenJar:", address(jar));
    }
}
