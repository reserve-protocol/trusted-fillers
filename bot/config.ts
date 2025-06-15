import { MetadataApi } from "@cowprotocol/app-data";
import { OrderBookApi } from "@cowprotocol/cow-sdk";
import { Chain, createPublicClient, http } from "viem";
import { base, bsc, mainnet } from "viem/chains";

export const orderConfig = {
  fulfilmentBuffer: 120, // {s}
  waitingDuration: 15, // {s}
} as const;

export const folioTargets = [
  {
    folioAddress: "0xd577936364733a0f03ef92adf572eb4265ccc4cc",
    chainId: base.id,
  },
] as const;

export const CONSTANTS = {
  CowSwap: {
    SETTLEMENT: "0x9008D19f58AAbD9eD0D60971565AA8510560ab41",
    VAULT: "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110",
    TRAMPOLINE: "0x01DcB88678aedD0C4cC9552B20F4718550250574",
    fillerMap: {
      [mainnet.id]: "",
      [base.id]: "0xe7E0aee64561075aF48a3E4bEE1EA95F0842158E",
      [bsc.id]: "",
    },
  },
  FolioR400: {
    FolioLens: "0x7498c6aB0669A09DE7B9185ba72A98fa3Ca39cC9",
  },
} as const;

function createClient<T extends Chain>(chain: T, rpcUrl: string) {
  return createPublicClient({
    chain,
    transport: http(rpcUrl),
    batch: {
      multicall: {
        batchSize: 8,
        wait: 2,
      },
    },
  });
}

// TODO: Make it more robust with more RPCs?
export const viemClients = {
  [mainnet.id]: createClient(mainnet, "https://ethereum-rpc.publicnode.com"),
  [base.id]: createClient(base, "https://base-rpc.publicnode.com"),
  [bsc.id]: createClient(bsc, "https://bsc-rpc.publicnode.com"),
} as const;

export const cowswapClients = {
  metadataApi: new MetadataApi(),
  orderBookApi: {
    [mainnet.id]: new OrderBookApi({ chainId: mainnet.id }),
    [base.id]: new OrderBookApi({ chainId: base.id }),
    [bsc.id]: new OrderBookApi({ chainId: bsc.id }),
  },
} as const;
