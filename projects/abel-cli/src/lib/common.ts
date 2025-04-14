import { AbelSDK } from "abel-sdk";
import { abel } from "./config.js";
import { die } from "./util.js";

export async function getAssetsWithLabelPV(abel: AbelSDK, labelId: string) {
  const assetIds = await abel.getAllAssetIDs();
  const assetLabels = await abel.getAssetsLabels(assetIds);
  for (const [aid, labels] of assetLabels) {
    if (!labels.includes(labelId)) {
      assetLabels.delete(aid);
    }
  }
  return Array.from(assetLabels.keys());
}

export async function wrapAction<T extends Array<any>>(name: string, args: T, actionFn: (...args: any[]) => Promise<any>) {
  if (args.some(a => a === undefined)) {
    die(`${name}\nError: provide ${args.length} arguments`)
  }
  try {
    console.warn(name, "with", args);
    await actionFn.apply(abel, args);
  } catch (e) {
    console.log(`    ----\nError message: ${(e as Error).message}`);
  }
}
