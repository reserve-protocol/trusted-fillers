import { getRandomValues } from "node:crypto";

import { BuyTokenDestination, OrderKind, SellTokenSource, SigningScheme } from "@cowprotocol/cow-sdk";
import { bytesToHex, encodeFunctionData, erc20Abi, formatUnits, Hex, zeroAddress } from "viem";
import { getBlock, readContract, simulateContract } from "viem/actions";

import { encodeCowswapOrder } from "@/abi/CowSwap";
import { FolioArtifact } from "@/abi/Folio";
import { FolioLensArtifact } from "@/abi/FolioLens";
import { orderConfig, folioTargets, CONSTANTS, viemClients, cowswapClients } from "@/config";
import { getPricesForTokens } from "@/pricing";
import { sleep } from "@/utils";

export async function trackSingleFolio(folioData: (typeof folioTargets)[number]) {
  console.log(`[FolioParsing]`, `${folioData.folioAddress} on ${folioData.chainId}`);

  const viemClient = viemClients[folioData.chainId];
  const metadataApi = cowswapClients.metadataApi;
  const orderBookApi = cowswapClients.orderBookApi[folioData.chainId];

  const blockData = await getBlock(viemClient, {
    includeTransactions: false,
  });

  console.log(`[Block]`, `${blockData.number}, ${new Date(Number(blockData.timestamp) * 1000).toLocaleString()}`);

  const nextAuctionId = await readContract(viemClient, {
    abi: FolioArtifact.abi,
    address: folioData.folioAddress,
    functionName: "nextAuctionId",
  });

  const targetAuctionId = nextAuctionId - 1n;
  const auctionsData = await readContract(viemClient, {
    abi: FolioLensArtifact.abi,
    address: CONSTANTS.FolioR400.FolioLens,
    functionName: "getAllBids",
    args: [folioData.folioAddress, targetAuctionId, 0n],
  });

  console.log("[FolioParsing]", "Target Auction:", targetAuctionId.toString());

  if (auctionsData.length > 0) {
    console.log(`[FolioParsing]`, `Auction Active ✅`);

    // Surplus tokens and deficit tokens are always exclusive.
    const allTokens = [
      ...new Set(auctionsData.map((auction) => auction.sellToken)),
      ...new Set(auctionsData.map((auction) => auction.buyToken)),
    ];

    const tokenPrices = await getPricesForTokens({
      chainId: folioData.chainId,
      tokens: allTokens,
    });

    // TODO: Optimize this so decimals and names are only fetched once.
    const tokenDecimals = await Promise.all(
      allTokens.map((token) =>
        readContract(viemClient, {
          abi: erc20Abi,
          address: token,
          functionName: "decimals",
        }),
      ),
    );

    // console.log({ tokenPrices, tokenDecimals });
    // console.log({ auctionsData, targetAuctionId });

    const activeBiddableAuctions = auctionsData.filter((auction) => auction.buyToken !== zeroAddress);
    const activeBiddableAuctionsWithPrices = activeBiddableAuctions.map((auction) => ({
      ...auction,
      sellTokenPrice: tokenPrices[auction.sellToken.toLowerCase()],
      buyTokenPrice: tokenPrices[auction.buyToken.toLowerCase()],
      sellAuctionSize:
        Number(formatUnits(auction.sellAmount, tokenDecimals[allTokens.indexOf(auction.sellToken)])) *
        tokenPrices[auction.sellToken.toLowerCase()],
      buyAuctionSize:
        Number(formatUnits(auction.bidAmount, tokenDecimals[allTokens.indexOf(auction.buyToken)])) *
        tokenPrices[auction.buyToken.toLowerCase()],
    }));

    console.log("[Tracking]", "Active Biddable Auctions:", activeBiddableAuctionsWithPrices.length);

    // TODO: Prune auctions here.

    const fillerAddressToUse = CONSTANTS.CowSwap.fillerMap[folioData.chainId];

    for await (const auction of activeBiddableAuctionsWithPrices) {
      console.log(
        "[Tracking]",
        "Auction:",
        auction.sellToken,
        auction.buyToken,
        `Selling $${auction.sellAuctionSize.toFixed(2)} -> $${auction.buyAuctionSize.toFixed(2)}`,
      );

      const randomDeploymentSalt = bytesToHex(getRandomValues(new Uint8Array(32)));

      // TODO: Think it's worth replacing the simulate call with calculating the contract manually?
      const expectedFillContract = await simulateContract(viemClient, {
        abi: FolioArtifact.abi,
        address: folioData.folioAddress,
        functionName: "createTrustedFill",
        args: [targetAuctionId, auction.sellToken, auction.buyToken, fillerAddressToUse, randomDeploymentSalt],
        account: CONSTANTS.CowSwap.TRAMPOLINE,
      }).catch(() => false as const);

      if (!expectedFillContract) {
        console.log("[Tracking]", "Auction:", auction.sellToken, auction.buyToken, "Failed to simulate");
        continue;
      }

      const appDataDoc = await metadataApi.generateAppDataDoc({
        appCode: "Reserve Protocol",
        environment: "prod",
        metadata: {
          orderClass: {
            orderClass: "limit",
          },
          hooks: {
            version: "1.3.0",
            pre: [
              {
                target: folioData.folioAddress,
                callData: encodeFunctionData({
                  abi: FolioArtifact.abi,
                  functionName: "createTrustedFill",
                  args: [
                    targetAuctionId,
                    auction.sellToken,
                    auction.buyToken,
                    fillerAddressToUse,
                    randomDeploymentSalt,
                  ],
                }),
                gasLimit: (1e6).toString(),
              },
            ],
            post: [
              {
                target: folioData.folioAddress,
                callData: encodeFunctionData({
                  abi: FolioArtifact.abi,
                  functionName: "poke", // (can not revert) Close the Trusted Fill
                  args: [],
                }),
                gasLimit: (1e6).toString(),
              },
              {
                target: folioData.folioAddress,
                callData: encodeFunctionData({
                  abi: FolioArtifact.abi,
                  functionName: "removeFromBasket", // (can revert) Second call to remove the token, if possible
                  args: [auction.sellToken], // remove sell token
                }),
                gasLimit: (1e6).toString(),
              },
            ],
          },
        },
      });

      const { appDataContent, appDataHex } = await metadataApi.getAppDataInfo(appDataDoc);
      // console.log("[CowSwap]", { appDataContent, appDataHex });
      const auctionValidTo = Math.floor(Date.now() / 1000) + orderConfig.fulfilmentBuffer;

      const orderId = await orderBookApi
        .sendOrder({
          sellToken: auction.sellToken,
          buyToken: auction.buyToken,
          receiver: expectedFillContract.result,
          sellAmount: auction.sellAmount.toString(),
          buyAmount: auction.bidAmount.toString(),
          validTo: auctionValidTo,
          appData: appDataContent,
          feeAmount: "0",
          kind: OrderKind.SELL,
          partiallyFillable: true,
          sellTokenBalance: SellTokenSource.ERC20,
          buyTokenBalance: BuyTokenDestination.ERC20,
          signature: encodeCowswapOrder({
            sellToken: auction.sellToken,
            buyToken: auction.buyToken,
            sellAmount: auction.sellAmount,
            buyAmount: auction.bidAmount,
            validTo: auctionValidTo,
            appData: appDataHex as Hex,
            receiver: expectedFillContract.result,
          }),
          signingScheme: SigningScheme.EIP1271,
          from: expectedFillContract.result,
        })
        .catch((error) => {
          console.error("[CowSwap][Error]", error);

          return "!!! FAILED !!!";
        });

      // TODO: Add order submission data like tokens, prices, etc.
      console.log(
        `[AuctionOrder]`,
        `[${folioData.folioAddress}-${targetAuctionId}]`,
        // `Price: ${formatUnits(auction.sellAuctionSize, 18)}`,
        `Order ID: ${orderId}`,
      );
    }
  } else {
    console.log(`[FolioParsing]`, `Auction Inactive ❌`);
  }

  console.log(`[Sleeping]`, `[${orderConfig.waitingDuration}s]`, `${folioData.folioAddress} on ${folioData.chainId}`);
  await sleep(orderConfig.waitingDuration * 1000);
}
