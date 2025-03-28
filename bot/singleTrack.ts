import { Address, bytesToHex, encodeFunctionData, Hex, maxUint256 } from "viem";
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
            gasLimit: (750e3).toString(),
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
            gasLimit: (250e3).toString(),
          },
          {
            target: targetFolio.address,
            callData: encodeFunctionData({
              abi: FolioArtifact.abi,
              functionName: "removeFromBasket", // (can revert) Second call to remove the token, if possible
              args: [auctionDetails.sellToken], // remove sell token
            }),
            gasLimit: (250e3).toString(),
          },
        ],
      },
    },
  });

  const { appDataHex, appDataContent } = await metadataApi.appDataToCid(appDataDoc);
  const { fullAppData } = await orderBookApi.uploadAppData(appDataHex, appDataContent);

  const auctionValidTo = Math.floor(Date.now() / 1000) + orderConfig.fullfilmentBuffer;

  console.log(
    `[AuctionLog]`,
    `[${targetFolio.address}-${auctionId}]`,
    `${bidData.sellAmount.toString()} ${auctionDetails.sellToken} -> ${bidData.buyAmount.toString()} ${auctionDetails.buyToken}.`,
  );

  const orderId = await orderBookApi.sendOrder({
    sellToken: auctionDetails.sellToken,
    buyToken: auctionDetails.buyToken,
    receiver: expectedFillContract.result,
    sellAmount: bidData.sellAmount.toString(),
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
      sellAmount: bidData.sellAmount,
      buyAmount: bidData.buyAmount,
      validTo: auctionValidTo,
      appData: appDataHex as Hex,
      receiver: expectedFillContract.result,
    }),
    signingScheme: SigningScheme.EIP1271,
    from: expectedFillContract.result,
  });

  console.log(
    `[AuctionOrder]`,
    `[${targetFolio.address}-${auctionId}]`,
    `>> Order ID: ${orderId}, Price: ${bidData.price} <<`,
  );
}
