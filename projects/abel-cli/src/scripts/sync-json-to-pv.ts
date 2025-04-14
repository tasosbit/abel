import { readFileSync } from "fs";
import pMap from "p-map";
import { config, abel, LABEL_ID } from "../lib/config.js";
import { AbelSDK } from "abel-sdk";
import { die } from "../lib/util.js";

async function getAssetsWithLabelPV(abel: AbelSDK, labelId: string) {
  const assetIds = await abel.getAllAssetIDs();
  const assetLabels = await abel.getAssetsLabels(assetIds);
  for (const [aid, labels] of assetLabels) {
    if (!labels.includes(labelId)) {
      assetLabels.delete(aid);
    }
  }
  return Array.from(assetLabels.keys());
}

// Read assets from JSON file structured like Pera Verified response
const data = JSON.parse(readFileSync(process.argv[2]).toString());

const latestAssetIds = data.map(({ asset_id: aid }: { asset_id: number }) => BigInt(aid));
const existingAssetIds = await getAssetsWithLabelPV(abel, LABEL_ID);

if (!latestAssetIds.length) {
  die(`Refusing to proceed without input assets.`);
}

const toAdd = [];
for (const maybeNew of latestAssetIds) {
  if (!existingAssetIds.includes(maybeNew)) {
    toAdd.push(maybeNew);
  }
}

const toRemove = [];
for (const maybeExpired of existingAssetIds) {
  if (!latestAssetIds.includes(maybeExpired)) {
    toRemove.push(maybeExpired);
  }
}

console.log({
  latestAssets: latestAssetIds.length,
  existingAssets: existingAssetIds.length,
  toAdd: toAdd.length,
  toRemove: toRemove.length,
});

if (toAdd.length) {
  console.log(`Adding (${toAdd.length})`, ...toAdd);
  await abel.addLabelToAssets(toAdd, LABEL_ID);
}

if (toRemove.length) {
  console.log(`Removing (${toRemove.length})`, ...toRemove);
  await pMap(toRemove, (id) => abel.removeLabelFromAsset(id, LABEL_ID), { concurrency: config.CONCURRENCY });
}

console.log("Done");
