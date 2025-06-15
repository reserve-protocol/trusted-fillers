import ky from "ky";
import { Address } from "viem";

interface PriceRequest {
  chainId: number;
  tokens: Address[];
}

export async function getPricesForTokens({ chainId, tokens }: PriceRequest) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response: any = await ky
    .get("https://api.reserve.org/current/prices", {
      searchParams: {
        chainId,
        tokens: tokens.join(","),
        ["_t"]: Date.now(),
      },
    })
    .json();

  const responseRecord: Record<string, number> = {};

  for (const single of response) {
    responseRecord[single.address.toLowerCase()] = single.price;
  }

  return responseRecord;
}
