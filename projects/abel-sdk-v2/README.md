# Abel SDK for js-algorand-sdk v2

**Abel is an Asset Labeling registry, as well as a provider of batch asset data.**

## Install

> [!WARNING]
> This version of abel-SDK only supports js-algorand-sdk v2 and its corresponding algokit-utils v7

```
npm i abel-sdk
```

## Usage

> [!NOTE]
> Want to explore with a CLI? Check out [abel-cil](https://github.com/tasosbit/abel/tree/main/projects/abel-cli) which uses this SDK under the hood.


The default use case is with a read-only client. This will allow you to fetch asset and label data, but not operate on the registry.

Create an SDK instance by passing in the abel app ID and an an `algokit.AlgorandClient`.

For Mainnet:

```typescript
import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import { AbelSDK } from "abel-sdk";

const abel = new AbelSDK({
  appId: 2914159523n, // Abel Mainnet PoC App ID
  algorand: AlgorandClient.fromConfig({
    algodConfig: { server: "https://mainnet-api.4160.nodely.dev", port: 443 },
  }),
});
```

## Querying assets

You can query assets with multiple size views.

To get the "Asset Micro Labels" view for multiple assets:

```typescript
const microData = await abel.getAssetsMicro([312769n, 6547014n, 6587142n, 27165954n]);
// returns
// Map(4) {
//   312769n => { id: 312769n, unitName: 'USDt', decimals: 6n, labels: [ 'pv' ] },
//   6547014n => { id: 6547014n, unitName: 'MCAU', decimals: 5n, labels: [ 'pv' ] },
//   6587142n => { id: 6587142n, unitName: 'MCAG', decimals: 5n, labels: [ 'pv' ] },
//   27165954n => { id: 27165954n, unitName: 'Planets', decimals: 6n, labels: [ 'pv' ] }
// }
```

The available asset views are:

- [AssetMicro](interfaces/AssetMicro.html) (no labels)
- [AssetMicroLabels](interfaces/AssetMicroLabels.html)
- [AssetTiny](interfaces/AssetTiny.html)  (no labels)
- [AssetTinyLabels](interfaces/AssetTinyLabels.html)
- [AssetText](interfaces/AssetText.html)  (no labels)
- [AssetTextLabels](interfaces/AssetTextLabels.html)
- [AssetSmall](interfaces/AssetSmall.html)
- [AssetFull](interfaces/AssetFull.html)

To fetch asset data in these views, use the corresponding `getXYZ` method of the SDK, e.g. [getAssetMicroLabels](classes/AbelSDK#getassetsmicrolabels).

You can pass in as many asset IDs as you want.

## Performance

Under the hood, Abel uses simulate to fetch multiple assets' data from a single simulate call.

The number of assets per simulate request depends on how many AVM resources are required to compose it.

You will get the best performance and efficiency if you use the smallest possible view for your needs.

### 128 assets per simulate call

- [AssetMicro](interfaces/AssetMicro.html)
- [AssetTiny](interfaces/AssetTiny.html)
- [AssetText](interfaces/AssetText.html)

### 64 assets per simulate call

- [AssetMicroLabels](interfaces/AssetMicroLabels.html)
- [AssetTinyLabels](interfaces/AssetTinyLabels.html)
- [AssetTextLabels](interfaces/AssetTextLabels.html)
- [AssetSmall](interfaces/AssetSmall.html)

### 42 assets per simulate call

- [AssetFull](interfaces/AssetFull.html)

### Concurrency

The Abel SDK supports arbitrarily large asset lookups.

If you request more assets than a single simulate call can provide for that view, parallel simulate requests will be made in order to fetch your data.

By default, Abel will use up to 4 simulate "threads", i.e. it will keep up to 4 simulate requests in parallel in order to fetch asset data.

You can control this level of concurrency by passing in a `concurrency` property in the [Abel SDK constructor](classes/AbelSDK#constructor).

> [!NOTE]
> The concurrency limit is per-method call, not global. For example, if you have `concurrency: 2` and you await two separate `getAssetsTiny()` methods of more than 128 assets each, there will be 4 simulate requests in flight.


## Admin or Operator Usage

To instantiate the SDK with write capabilities, pass in your privileged account as `writeAccount`:

```typescript
import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import { AbelSDK } from "abel-sdk";

const mnemonic = "apple apple ...";
const writeAccount = await algorand.account.fromMnemonic(mnemonic);

const abel = new AbelSDK({
  appId: 2914159523n, // Abel Mainnet PoC App ID
  algorand: AlgorandClient.fromConfig({
    algodConfig: { server: "https://mainnet-api.4160.nodely.dev", port: 443 },
  }),
  writeAccount,
});
```

You can then operate on your label group, as well as any asset:

```typescript
const someAddress = "DTHIRTEENNLSYGLSEXTXC6X4SVDWMFRCPAOAUCXWIXJRCVBWIIGLYARNQE";
const labelId = "13"
// add another operator to your label
await abel.addOperatorToLabel(someAddress, labelId);

// remove operator from your label
await abel.removeOperatorFromLabel(someAddress, labelId);

// add label to asset with ID 1013
await abel.addLabelToAsset(1013n, labelId);

// remove label from asset with ID 1013
await abel.removeLabelFromAsset(1013n, labelId);
```

