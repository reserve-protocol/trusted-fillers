import { folioTargets } from "./config";
import { trackSingleFolio } from "./singleTrack";

async function main() {
  // TODO: Switch to threading/workers here.
  folioTargets.forEach(async (target) => {
    while (true) {
      await trackSingleFolio(target);
    }
  });
}

main();
