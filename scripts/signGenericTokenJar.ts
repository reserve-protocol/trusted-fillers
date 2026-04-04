import { hashTypedData, parseUnits } from "viem";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// Known Key: 0x04824AE7B6681c38108A668EEB983b691f62bc6b
const account = privateKeyToAccount("0xb93542f3d387519a84549b74c3f1948cff1b08ec464ee031e4068901648fa726");

// Replace with your deployed GenericTokenJar address.
const verifyingContract = "0x5991A2dF15A8F6A256D3Ec51E99254Cd3fb576A9" as const;

const domain = {
  name: "GenericTokenJar",
  version: "1",
  chainId: mainnet.id,
  verifyingContract,
} as const;

const types = {
  FillRequest: [
    { name: "targetFiller", type: "address" },
    { name: "relayer", type: "address" },
    { name: "sellToken", type: "address" },
    { name: "sellAmount", type: "uint256" },
    { name: "minBuyAmount", type: "uint256" },
    { name: "deploymentSalt", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

const request = {
  targetFiller: "0xF62849F9A0B5Bf2913b396098F7c7019b51A820a",
  relayer: "0x0000000000000000000000000000000000000000",
  sellToken: "0x2e234DAe75C793f67A35089C9d99245E1C58470b",
  sellAmount: parseUnits("1", 18),
  minBuyAmount: parseUnits("2", 18),
  deploymentSalt: "0x0000000000000000000000000000000000000000000000000000000000000001",
  deadline: 1730000000n,
} as const;

const digest = hashTypedData({
  domain,
  types,
  primaryType: "FillRequest",
  message: request,
});

const signature = await account.signTypedData({
  domain,
  types,
  primaryType: "FillRequest",
  message: request,
});

console.log({
  account: account.address,
  domain,
  request,
  digest,
  signature,
});
