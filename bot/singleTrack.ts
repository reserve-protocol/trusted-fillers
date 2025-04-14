import { Address, bytesToHex, encodeFunctionData, formatUnits, Hex, maxUint256, parseUnits } from "viem";
import { getRandomValues } from "node:crypto";

import { FolioArtifact } from "./abi/Folio";
import { encodeCowswapOrder } from "./abi/CowSwap";
import { orderConfig, fillerMap } from "./config";
import type { ActiveTrack } from ".";

import { BuyTokenDestination, OrderBookApi, OrderKind, SellTokenSource, SigningScheme } from "@cowprotocol/cow-sdk";
import { MetadataApi } from "@cowprotocol/app-data";

const metadataApi = new MetadataApi();

export async function checkSingleAuction(activeTrack: ActiveTrack, auctionId: bigint, blockNumber: bigint) {
  const targetFolio = activeTrack.targetFolio;
  const orderBookApi = new OrderBookApi({ chainId: activeTrack.chainId });

  const bidData = await targetFolio.read
    .getBid([auctionId, 0n, maxUint256], {
      blockNumber,
    })
    .then(
      (e) =>
        ({
          success: true,
          sellAmount: e[0],
          buyAmount: e[1],
          price: e[2],
        }) as const,
    )
    .catch(() => {
      return {
        success: false,
      } as const;
    });

  if (!bidData.success) {
    activeTrack.activeAuctions = activeTrack.activeAuctions.filter((e) => e !== auctionId);
    console.log(`>>>>>>>>> Auction ${auctionId} is closed.`);

    return;
  }

  const auctionDetails = await targetFolio.read
    .auctions([auctionId], {
      blockNumber,
    })
    .then(
      (e) =>
        ({
          id: e[0],
          sellToken: e[1],
          buyToken: e[2],
        }) as const,
    );

  const randomDeploymentSalt = bytesToHex(getRandomValues(new Uint8Array(32)));
  const fillerAddressToUse = fillerMap[activeTrack.chainId] as Address; // CowSwap Filler

  const expectedFillContract = await targetFolio.simulate.createTrustedFill(
    [auctionId, fillerAddressToUse, randomDeploymentSalt],
    {
      account: "0x01DcB88678aedD0C4cC9552B20F4718550250574", // This is the CowSwap Hooks Trampoline
    },
  );

  const appDataDoc = await metadataApi.generateAppDataDoc({
    appCode: "Reserve Trusted Fillers",
    environment: "prod",
    metadata: {
      quote: {
        slippageBips: 0,
      },
      orderClass: {
        orderClass: "limit",
      },
      hooks: {
        version: "1.3.0",
        pre: [
          {
            target: targetFolio.address,
            callData: encodeFunctionData({
              abi: FolioArtifact.abi,
              functionName: "createTrustedFill",
              args: [auctionId, fillerAddressToUse, randomDeploymentSalt],
            }),
            gasLimit: (1e6).toString(),
          },
        ],
        post: [
          {
            target: targetFolio.address,
            callData: encodeFunctionData({
              abi: FolioArtifact.abi,
              functionName: "poke", // (can not revert) Close the Trusted Fill
              args: [],
            }),
            gasLimit: (1e6).toString(),
          },
          {
            target: targetFolio.address,
            callData: encodeFunctionData({
              abi: FolioArtifact.abi,
              functionName: "removeFromBasket", // (can revert) Second call to remove the token, if possible
              args: [auctionDetails.sellToken], // remove sell token
            }),
            gasLimit: (1e6).toString(),
          },
        ],
      },
    },
  });

  const { appDataHex, appDataContent } = await metadataApi.appDataToCid(appDataDoc);
  const { fullAppData } = await orderBookApi.uploadAppData(appDataHex, appDataContent);

  const auctionValidTo = Math.floor(Date.now() / 1000) + orderConfig.fulfilmentBuffer;

  // Reduce sellAmount by 1 min (fulfilmentBuffer) per year depreciation.
  const targetSellAmount = (bidData.sellAmount * parseUnits("0.99999", 18)) / parseUnits("1", 18);

  console.log(
    `[AuctionLog]`,
    `[${targetFolio.address}-${auctionId}]`,
    `${targetSellAmount.toString()} ${auctionDetails.sellToken} -> ${bidData.buyAmount.toString()} ${auctionDetails.buyToken}.`,
  );

  const orderId = await orderBookApi
    .sendOrder({
      sellToken: auctionDetails.sellToken,
      buyToken: auctionDetails.buyToken,
      receiver: expectedFillContract.result,
      sellAmount: targetSellAmount.toString(),
      buyAmount: bidData.buyAmount.toString(),
      validTo: auctionValidTo,
      appData: appDataContent,
      feeAmount: "0",
      kind: OrderKind.SELL,
      partiallyFillable: true,
      sellTokenBalance: SellTokenSource.ERC20,
      buyTokenBalance: BuyTokenDestination.ERC20,
      signature: encodeCowswapOrder({
        sellToken: auctionDetails.sellToken,
        buyToken: auctionDetails.buyToken,
        sellAmount: targetSellAmount,
        buyAmount: bidData.buyAmount,
        validTo: auctionValidTo,
        appData: appDataHex as Hex,
        receiver: expectedFillContract.result,
      }),
      signingScheme: SigningScheme.EIP1271,
      from: expectedFillContract.result,
    })
    .catch(() => "!!! FAILED !!!");

  console.log(
    `[AuctionOrder]`,
    `[${targetFolio.address}-${auctionId}]`,
    `Price: ${formatUnits(bidData.price, 27)}`,
    `Order ID: ${orderId}`,
  );
}
