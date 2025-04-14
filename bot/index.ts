import { Address, createPublicClient, getContract, http, zeroAddress } from "viem";
import { base } from "viem/chains";

import { FolioArtifact } from "./abi/Folio";
import { orderConfig, folioTargets } from "./config";
import { checkSingleAuction } from "./singleTrack";

const mainnetClient = createPublicClient({
  chain: base,
  transport: http("https://eth.merkle.io", {
    onFetchRequest(request, init) {
      // console.log(init);
    },
  }),
  batch: {
    multicall: {
      batchSize: 8,
    },
  },
});
const baseClient = createPublicClient({
  chain: base,
  transport: http("https://base.merkle.io", {
    onFetchRequest(request, init) {
      // console.log(init);
    },
  }),
  batch: {
    multicall: {
      batchSize: 8,
    },
  },
});

const typeFolio1 = getContract({
  address: zeroAddress as Address,
  abi: FolioArtifact.abi,
  client: baseClient,
});
const typeFolio2 = getContract({
  address: zeroAddress as Address,
  abi: FolioArtifact.abi,
  client: mainnetClient,
});

export interface ActiveTrack {
  targetFolio: typeof typeFolio1 | typeof typeFolio2;
  activeAuctions: bigint[];
  chainId: number;
}

async function main() {
  const activeTracks: ActiveTrack[] = [];

  for (const target of folioTargets) {
    if (target.chainId !== base.id) {
      throw new Error("Unsupported chain");
    }

    console.log(`[Tracking]`, `${target.folioAddress} on ${target.chainId}`);

    const newTrack: ActiveTrack = {
      targetFolio: getContract({
        address: target.folioAddress,
        abi: FolioArtifact.abi,
        client: target.chainId === base.id ? baseClient : mainnetClient,
      }),
      activeAuctions: [],
      chainId: target.chainId,
    };

    newTrack.targetFolio.watchEvent.AuctionOpened(
      {},
      {
        onLogs: (logs) => {
          logs.map((e) => {
            if (e.args.auctionId) {
              console.log(`[AuctionOpened]`, `>> Auction ${e.args.auctionId} opened on ${target.folioAddress} <<`);

              newTrack.activeAuctions = [...new Set([...newTrack.activeAuctions, e.args.auctionId])];
            }
          });
        },
      },
    );

    activeTracks.push(newTrack);
  }

  setInterval(async () => {
    // console.log(activeTracks);
    const mainnetBlock = await mainnetClient.getBlock();
    const baseBlock = await baseClient.getBlock();

    console.log(
      `[IntervalTrack]`,
      `Mainnet: ${mainnetBlock.number}, ${new Date(Number(mainnetBlock.timestamp) * 1000).toLocaleString()}`,
      `Base: ${baseBlock.number}, ${new Date(Number(baseBlock.timestamp) * 1000).toLocaleString()}`,
    );

    for (const track of activeTracks) {
      if (track.activeAuctions.length > 0) {
        // Consider p-limit later.
        track.activeAuctions.forEach((auctionId) => {
          checkSingleAuction(track, auctionId, track.chainId === base.id ? baseBlock.number : mainnetBlock.number);
        });
      }
    }
  }, orderConfig.trackingInterval * 1000);
}

main();
