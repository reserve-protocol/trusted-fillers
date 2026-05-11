// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";

import { CowSwapFiller } from "@src/fillers/cowswap/CowSwapFiller.sol";

string constant junkSeedPhrase = "test test test test test test test test test test test junk";

struct FillerConfig {
    address settlement;
    address vaultRelayer;
}

function cowSwapFillerConfig() pure returns (FillerConfig memory config) {
    config = FillerConfig({
        settlement: 0x9008D19f58AAbD9eD0D60971565AA8510560ab41,
        vaultRelayer: 0xC92E8bdf79f0507f65a392b0ab4667716BFE0110
    });
}

function zapSwapFillerConfig() pure returns (FillerConfig memory config) {
    config = FillerConfig({
        settlement: 0x7b52bA749fB9b2aeb302c9AAD0CF304FFFD844a2,
        vaultRelayer: 0x8a9Ad533DfB1B66e299a454a5201B26a0FE77038
    });
}

function deployCowSwapFiller(FillerConfig memory config) returns (CowSwapFiller filler) {
    filler = new CowSwapFiller(config.settlement, config.vaultRelayer);
}

contract DeployCowSwapFiller is Script {
    string seedPhrase = block.chainid != 31337 ? vm.readFile(".seed") : junkSeedPhrase;
    uint256 privateKey = vm.deriveKey(seedPhrase, 0);

    function run() external {
        vm.startBroadcast(privateKey);
        CowSwapFiller cowSwapFiller = deployCowSwapFiller(cowSwapFillerConfig());
        CowSwapFiller zapSwapFiller = deployCowSwapFiller(zapSwapFillerConfig());
        vm.stopBroadcast();

        console2.log("CowSwapFiller (CowSwap):", address(cowSwapFiller));
        console2.log("CowSwapFiller (ZapSwap):", address(zapSwapFiller));
    }
}
