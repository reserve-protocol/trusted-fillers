// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";

import { ImmutableTokenJar } from "@src/extras/ImmutableTokenJar.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

string constant junkSeedPhrase = "test test test test test test test test test test test junk";

contract DeployImmutableTokenJar is Script {
    string seedPhrase = block.chainid != 31337 ? vm.readFile(".seed") : junkSeedPhrase;
    uint256 privateKey = vm.deriveKey(seedPhrase, 0);
    address walletAddress = vm.rememberKey(privateKey);

    function run() external returns (ImmutableTokenJar jar) {
        require(block.chainid == 8453);

        vm.startBroadcast(privateKey);
        jar = new ImmutableTokenJar(walletAddress, IERC20(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913), walletAddress);
        jar.renounceOwnership();
        vm.stopBroadcast();

        console2.log("ImmutableTokenJar:", address(jar));
    }
}
