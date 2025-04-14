import { base, mainnet } from "viem/chains";

export const orderConfig = {
  fulfilmentBuffer: 120, // {s}
  trackingInterval: 15, // {s}
} as const;

export const folioTargets = [
  {
    folioAddress: "0xfC1D8E98bF4D8942Cf7616c0B94FecFC7d44D21B",
    chainId: base.id,
  },
] as const;

export const fillerMap = {
  [base.id]: "0xB3Ee1aA03505893757490c785350D3a2e33a134C",
  [mainnet.id]: "",
};
