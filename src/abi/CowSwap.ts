import { Address, encodeAbiParameters, Hex, zeroHash } from "viem";

const orderTypes = {
  GPv2OrderData: [
    { name: "sellToken", type: "address" },
    { name: "buyToken", type: "address" },
    { name: "receiver", type: "address" },
    { name: "sellAmount", type: "uint256" },
    { name: "buyAmount", type: "uint256" },
    { name: "validTo", type: "uint32" },
    { name: "appData", type: "bytes32" },
    { name: "feeAmount", type: "uint256" },
    { name: "kind", type: "bytes32" },
    { name: "partiallyFillable", type: "bool" },
    { name: "sellTokenBalance", type: "bytes32" },
    { name: "buyTokenBalance", type: "bytes32" },
  ],
} as const;

interface EncodeCowswapOrderParams {
  sellToken: Address;
  buyToken: Address;
  receiver: Address;
  sellAmount: bigint;
  buyAmount: bigint;
  validTo: number;
  appData?: Hex;
}

export function encodeCowswapOrder({
  sellToken,
  buyToken,
  receiver,
  sellAmount,
  buyAmount,
  validTo,
  appData = zeroHash,
}: EncodeCowswapOrderParams) {
  return encodeAbiParameters(orderTypes.GPv2OrderData, [
    sellToken,
    buyToken,
    receiver,
    sellAmount,
    buyAmount,
    validTo,
    appData,
    0n, // Limit Order only
    "0xf3b277728b3fee749481eb3e0b3b48980dbbab78658fc419025cb16eee346775", // Sell
    true,
    "0x5a28e9363bb942b639270062aa6bb295f434bcdfc42c97267bf003f272060dc9", // erc20
    "0x5a28e9363bb942b639270062aa6bb295f434bcdfc42c97267bf003f272060dc9",
  ]);
}
