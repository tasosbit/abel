import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import { TransactionSignerAccount } from "@algorandfoundation/algokit-utils/types/account";
import { BoxName } from "@algorandfoundation/algokit-utils/types/app";
import { decodeAddress, decodeUint64, encodeAddress, encodeUint64, makeEmptyTransactionSigner } from "algosdk";
import pMap from "p-map";
import {
  AssetFullFromTuple,
  AssetLabelingClient,
  AssetLabelingFactory,
  AssetMicroFromTuple,
  AssetMicroLabelsFromTuple,
  AssetSmallFromTuple,
  AssetTextFromTuple,
  AssetTextLabelsFromTuple,
  AssetTinyFromTuple,
  AssetTinyLabelsFromTuple,
  LabelDescriptorFromTuple as LabelDescriptorBoxValueFromTuple,
} from "./generated/abel-contract-client.js";
import {
  AnyFn,
  AssetFull,
  AssetMicro,
  AssetMicroLabels,
  AssetSmall,
  AssetText,
  AssetTextLabels,
  AssetTiny,
  AssetTinyLabels,
  LabelDescriptor,
  QueryReturn,
} from "./types.js";
import { chunk, encodeUint64Arr, isNullish, mergeMapsArr, wrapErrors } from "./util.js";

export * from "./types.js";
export { AssetLabelingClient, AssetLabelingFactory };

const DEFAULT_READ_ACCOUNT = "A7NMWS3NT3IUDMLVO26ULGXGIIOUQ3ND2TXSER6EBGRZNOBOUIQXHIBGDE";
const SIMULATE_PARAMS = {
  allowMoreLogging: true,
  allowUnnamedResources: true,
  extraOpcodeBudget: 179200,
  fixSigners: true,
  allowEmptySignatures: true,
};

export class AbelSDK {
  readClient: AssetLabelingClient;
  writeClient: AssetLabelingClient | undefined;
  writeAccount?: TransactionSignerAccount | undefined;
  private concurrency: number = 2;

  constructor({
    algorand,
    appId,
    readAccount = DEFAULT_READ_ACCOUNT,
    writeAccount,
    concurrency,
  }: {
    algorand: AlgorandClient;
    appId: bigint;
    writeAccount?: TransactionSignerAccount;
    readAccount?: string;
    concurrency?: number;
  }) {
    // Client used for read queries. Sender can be any funded address.
    // Default read is the A7N.. fee sink which is funded on all public ALGO networks
    // (localnet may be zero or at min balance though)
    this.readClient = algorand.client.getTypedAppClientById(AssetLabelingClient, {
      appId,
      defaultSender: readAccount,
      defaultSigner: makeEmptyTransactionSigner(),
    });

    // tranascting requires a writeAccount
    if (writeAccount) {
      this.writeClient = algorand.client.getTypedAppClientById(AssetLabelingClient, {
        appId,
        defaultSender: writeAccount.addr,
        defaultSigner: writeAccount.signer,
      });
      this.writeAccount = writeAccount;
    }

    if (concurrency !== undefined) {
      this.concurrency = concurrency;
    }
  }

  get appId() {
    return this.readClient.appId;
  }

  //  Box bead wrappers

  async getAllLabels(): Promise<string[]> {
    return (await this.getBoxesByLength(2)).map((boxName) => boxName.name);
  }

  async getAllOperators(): Promise<string[]> {
    return (await this.getBoxesByLength(32)).map((boxName) => encodeAddress(boxName.nameRaw));
  }

  async getAllAssetIDs(): Promise<bigint[]> {
    return (await this.getBoxesByLength(8)).map((boxName) => decodeUint64(boxName.nameRaw, "bigint"));
  }

  /*
   * Registry Readers
   *
   * We simulate from a client configured with a (theoretically) known-good account on all networks, default dev fee sink
   */

  async hasLabel(labelId: string): Promise<boolean> {
    const {
      returns: [hasLabel],
    } = await wrapErrors(
      this.readClient
        .newGroup()
        .hasLabel({ args: { id: labelId } })
        .simulate(SIMULATE_PARAMS)
    );
    return Boolean(hasLabel);
  }

  async getLabelDescriptor(labelId: string): Promise<LabelDescriptor | null> {
    try {
      const {
        returns: [labelDescriptorValue],
      } = await wrapErrors(
        this.readClient
          .newGroup()
          .getLabel({ args: { id: labelId } })
          .simulate(SIMULATE_PARAMS)
      );
      return { id: labelId, ...labelDescriptorValue! };
    } catch (e) {
      if ((e as Error).message === "ERR:NOEXIST") {
        return null;
      } else {
        throw e;
      }
    }
  }

  async getLabelDescriptors(labelIds: string[]): Promise<Map<string, LabelDescriptor>> {
    const { confirmations } = await wrapErrors(
      this.readClient
        .newGroup()
        .logLabels({ args: { ids: labelIds } })
        .simulate(SIMULATE_PARAMS)
    );
    const logs = confirmations[0]!.logs ?? [];
    const descriptorValues = this.parseLogsAs(logs, LabelDescriptorBoxValueFromTuple, "get_label");

    const labelDescriptors: Map<string, LabelDescriptor> = new Map();
    descriptorValues.forEach((descriptorValue, idx) => {
      const id = labelIds[idx];
      labelDescriptors.set(id, { id, ...descriptorValue });
    });

    return labelDescriptors;
  }

  async hasOperatorLabel(operator: string, label: string): Promise<boolean> {
    const {
      returns: [hasLabel],
    } = await wrapErrors(this.readClient.newGroup().hasOperatorLabel({ args: { operator, label } }).simulate(SIMULATE_PARAMS));
    return Boolean(hasLabel);
  }

  async getOperatorLabels(operator: string): Promise<string[]> {
    const {
      returns: [operatorLabels],
    } = await wrapErrors(this.readClient.newGroup().getOperatorLabels({ args: { operator } }).simulate(SIMULATE_PARAMS));

    return operatorLabels!;
  }

  async hasAssetLabel(assetId: bigint, label: string): Promise<boolean> {
    const {
      returns: [hasLabel],
    } = await wrapErrors(this.readClient.newGroup().hasAssetLabel({ args: { assetId, label } }).simulate(SIMULATE_PARAMS));
    return Boolean(hasLabel);
  }

  async getAssetLabels(assetId: bigint): Promise<string[]> {
    const {
      returns: [assetLabels],
    } = await wrapErrors(
      this.readClient
        .newGroup()
        .getAssetLabels({ args: { asset: assetId } })
        .simulate(SIMULATE_PARAMS)
    );
    return assetLabels!;
  }

  getAssetsLabels = async (assetIds: bigint[]): Promise<Map<bigint, string[]>> => {
    const METHOD_MAX = 128;
    if (assetIds.length > METHOD_MAX) return this.batchCall(this.getAssetsLabels, [assetIds], METHOD_MAX);

    const { confirmations } = await wrapErrors(
      this.readClient
        .newGroup()
        .logAssetsLabels({ args: { assets: assetIds } })
        .simulate(SIMULATE_PARAMS)
    );

    const map: Map<bigint, string[]> = new Map();

    const labelValues = this.parseLogsAs(
      confirmations[0]!.logs ?? [],
      (arrs: Uint8Array[]) => arrs.map((arr) => Buffer.from(arr).toString()),
      "get_asset_labels"
    );

    assetIds.forEach((assetId, idx) => {
      map.set(assetId, labelValues[idx]);
    });

    return map;
  };

  /*
   * Write methods = transactions
   */

  async addLabel(labelId: string, name: string, url: string) {
    this.requireWriteClient();

    const query = this.writeClient
      .newGroup()
      .addTransaction(
        await this.writeClient.algorand.createTransaction.payment({
          sender: this.writeAccount.addr,
          receiver: this.writeClient.appAddress,
          amount: (0.2).algos(),
        }),
        this.writeAccount.signer
      )
      .addLabel({ args: { id: labelId, name, url }, boxReferences: [labelId] })
      .send();

    return wrapErrors(query);
  }

  async changeLabel(labelId: string, name: string, url: string) {
    this.requireWriteClient();

    if (isNullish(name)) throw new Error("name must be defined");
    if (isNullish(url)) throw new Error("url must be defined");

    const query = this.writeClient
      .newGroup()
      .changeLabel({ args: { id: labelId, name, url }, boxReferences: [labelId] })
      .send();

    return wrapErrors(query);
  }

  async removeLabel(labelId: string) {
    this.requireWriteClient();

    const query = this.writeClient.send.removeLabel({
      args: {
        id: labelId,
      },
      boxReferences: [labelId],
    });
    return wrapErrors(query);
  }

  async addOperatorToLabel(operator: string, labelId: string) {
    this.requireWriteClient();

    const query = this.writeClient.send.addOperatorToLabel({
      args: {
        operator,
        label: labelId,
      },
      boxReferences: [decodeAddress(operator).publicKey, labelId],
    });

    return wrapErrors(query);
  }

  async removeOperatorFromLabel(operator: string, labelId: string) {
    this.requireWriteClient();

    const query = await this.writeClient.send.removeOperatorFromLabel({
      args: { operator, label: labelId },
      boxReferences: [decodeAddress(operator).publicKey, labelId],
    });

    return wrapErrors(query);
  }

  async addLabelToAsset(assetId: bigint, labelId: string) {
    this.requireWriteClient();

    const query = this.writeClient.send.addLabelToAsset({
      args: {
        asset: assetId,
        label: labelId,
      },
      boxReferences: [labelId, encodeUint64(assetId), decodeAddress(this.writeAccount.addr).publicKey],
    });
    return wrapErrors(query);
  }

  addLabelToAssets = async (assetIds: bigint[], labelId: string): Promise<QueryReturn | QueryReturn[]> => {
    this.requireWriteClient();

    const METHOD_MAX = 6 + 8 * 15;
    if (assetIds.length > METHOD_MAX) {
      const chunked = chunk(assetIds, METHOD_MAX);
      return pMap(chunked, (assetIds) => this.addLabelToAssets(assetIds, labelId) as Promise<QueryReturn>, {
        concurrency: this.concurrency,
      });
    }

    let query = this.writeClient.newGroup();

    const operatorBox = decodeAddress(this.writeAccount.addr).publicKey;
    // we need 2 refs for the first call only
    // we push two zero and adapt boxRefs in first call
    const AssetChunks = chunk([0n, 0n, ...assetIds], 8);

    for (let i = 0; i < AssetChunks.length; i++) {
      // first box ref has label and acct. rest are all asset IDs
      const assetIds = i === 0 ? AssetChunks[i].slice(2) : AssetChunks[i];
      const boxReferences = i === 0 ? [labelId, operatorBox, ...encodeUint64Arr(assetIds)] : encodeUint64Arr(assetIds);

      query.addLabelToAssets({
        args: {
          assets: assetIds,
          label: labelId,
        },
        boxReferences,
      });
    }

    return await wrapErrors(query.send());
  };

  async removeLabelFromAsset(assetId: bigint, labelId: string) {
    this.requireWriteClient();

    const query = this.writeClient.send.removeLabelFromAsset({
      args: {
        asset: assetId,
        label: labelId,
      },
      boxReferences: [labelId, encodeUint64(assetId), decodeAddress(this.writeAccount.addr).publicKey],
    });

    return wrapErrors(query);
  }

  /* Batch fetch asset views */

  getAssetsMicro = async (assetIds: bigint[]): Promise<Map<bigint, AssetMicro & { id: bigint }>> => {
    const METHOD_MAX = 128;
    if (assetIds.length > METHOD_MAX) return this.batchCall(this.getAssetsMicro, [assetIds], METHOD_MAX);

    const { confirmations } = await wrapErrors(
      this.readClient
        .newGroup()
        .getAssetsMicro({ args: { assets: assetIds } })
        .simulate(SIMULATE_PARAMS)
    );

    const assetValues = this.parseLogsAs(confirmations[0]!.logs ?? [], AssetMicroFromTuple, "get_asset_micro");
    return new Map(assetValues.map((descriptorValue, idx) => [assetIds[idx], { id: assetIds[idx], ...descriptorValue }]));
  };

  getAssetsMicroLabels = async (assetIds: bigint[]): Promise<Map<bigint, AssetMicroLabels & { id: bigint }>> => {
    const METHOD_MAX = 64;
    if (assetIds.length > METHOD_MAX) return this.batchCall(this.getAssetsMicroLabels, [assetIds], METHOD_MAX);

    const { confirmations } = await wrapErrors(
      this.readClient
        .newGroup()
        .getAssetsMicroLabels({ args: { assets: assetIds } })
        .simulate(SIMULATE_PARAMS)
    );

    const assetValues = this.parseLogsAs(confirmations[0]!.logs ?? [], AssetMicroLabelsFromTuple, "get_asset_micro_labels");
    return new Map(assetValues.map((descriptorValue, idx) => [assetIds[idx], { id: assetIds[idx], ...descriptorValue }]));
  };

  getAssetsTiny = async (assetIds: bigint[]): Promise<Map<bigint, AssetTiny & { id: bigint }>> => {
    const METHOD_MAX = 128;
    if (assetIds.length > METHOD_MAX) return this.batchCall(this.getAssetsTiny, [assetIds], METHOD_MAX);

    const { confirmations } = await wrapErrors(
      this.readClient
        .newGroup()
        .getAssetsTiny({ args: { assets: assetIds } })
        .simulate(SIMULATE_PARAMS)
    );

    const assetValues = this.parseLogsAs(confirmations[0]!.logs ?? [], AssetTinyFromTuple, "get_asset_tiny");
    return new Map(assetValues.map((descriptorValue, idx) => [assetIds[idx], { id: assetIds[idx], ...descriptorValue }]));
  };

  getAssetsTinyLabels = async (assetIds: bigint[]): Promise<Map<bigint, AssetTinyLabels & { id: bigint }>> => {
    const METHOD_MAX = 64;
    if (assetIds.length > METHOD_MAX) return this.batchCall(this.getAssetsTinyLabels, [assetIds], METHOD_MAX);

    const { confirmations } = await wrapErrors(
      this.readClient
        .newGroup()
        .getAssetsTinyLabels({ args: { assets: assetIds } })
        .simulate(SIMULATE_PARAMS)
    );

    const assetValues = this.parseLogsAs(confirmations[0]!.logs ?? [], AssetTinyLabelsFromTuple, "get_asset_tiny_labels");
    return new Map(assetValues.map((descriptorValue, idx) => [assetIds[idx], { id: assetIds[idx], ...descriptorValue }]));
  };

  getAssetsText = async (assetIds: bigint[]): Promise<Map<bigint, AssetText & { id: bigint }>> => {
    const METHOD_MAX = 128;
    if (assetIds.length > METHOD_MAX) return this.batchCall(this.getAssetsText, [assetIds], METHOD_MAX);

    const { confirmations } = await wrapErrors(
      this.readClient
        .newGroup()
        .getAssetsText({ args: { assets: assetIds } })
        .simulate(SIMULATE_PARAMS)
    );

    const assetValues = this.parseLogsAs(confirmations[0]!.logs ?? [], AssetTextFromTuple, "get_asset_text");
    return new Map(assetValues.map((descriptorValue, idx) => [assetIds[idx], { id: assetIds[idx], ...descriptorValue }]));
  };

  getAssetsTextLabels = async (assetIds: bigint[]): Promise<Map<bigint, AssetTextLabels & { id: bigint }>> => {
    const METHOD_MAX = 64;
    if (assetIds.length > METHOD_MAX) return this.batchCall(this.getAssetsTextLabels, [assetIds], METHOD_MAX);

    const { confirmations } = await wrapErrors(
      this.readClient
        .newGroup()
        .getAssetsTextLabels({ args: { assets: assetIds } })
        .simulate(SIMULATE_PARAMS)
    );

    const assetValues = this.parseLogsAs(confirmations[0]!.logs ?? [], AssetTextLabelsFromTuple, "get_asset_text_labels");
    return new Map(assetValues.map((descriptorValue, idx) => [assetIds[idx], { id: assetIds[idx], ...descriptorValue }]));
  };

  getAssetsSmall = async (assetIds: bigint[]): Promise<Map<bigint, AssetSmall & { id: bigint }>> => {
    const METHOD_MAX = 64;
    if (assetIds.length > METHOD_MAX) return this.batchCall(this.getAssetsSmall, [assetIds], METHOD_MAX);

    const { confirmations } = await wrapErrors(
      this.readClient
        .newGroup()
        .getAssetsSmall({ args: { assets: assetIds } })
        .simulate(SIMULATE_PARAMS)
    );

    const assetValues = this.parseLogsAs(confirmations[0]!.logs ?? [], AssetSmallFromTuple, "get_asset_small");
    return new Map(assetValues.map((descriptorValue, idx) => [assetIds[idx], { id: assetIds[idx], ...descriptorValue }]));
  };

  getAssetsFull = async (assetIds: bigint[]): Promise<Map<bigint, AssetFull & { id: bigint }>> => {
    const METHOD_MAX = 42;
    if (assetIds.length > METHOD_MAX) return this.batchCall(this.getAssetsFull, [assetIds], METHOD_MAX);

    const { confirmations } = await wrapErrors(
      this.readClient
        .newGroup()
        .getAssetsFull({ args: { assets: assetIds } })
        .simulate(SIMULATE_PARAMS)
    );

    const assetValues = this.parseLogsAs(confirmations[0]!.logs ?? [], AssetFullFromTuple, "get_asset_full");
    return new Map(assetValues.map((descriptorValue, idx) => [assetIds[idx], { id: assetIds[idx], ...descriptorValue }]));
  };

  /* Utils */

  private async getBoxesByLength(length: number): Promise<BoxName[]> {
    const boxNames = await this.readClient.algorand.app.getBoxNames(this.appId);
    return boxNames.filter((boxName) => boxName.nameRaw.length === length);
  }

  /*
   * parse typed arc4 structs from logs
   *
   * tupleParser is like generated clients' xyzArcStructFromTuple
   * abiDecodingMethod is a method name that returns the same avi return type as we are logging
   *    e.g. if we are parsing log_label_descriptors() logs that logs LabelDescriptor, abiDecodingMethod can be get_label_descriptor that has ABI return LabelDescriptor
   */
  parseLogsAs<T extends AnyFn>(logs: Uint8Array[], tupleParser: T, abiDecodingMethodName: string): ReturnType<T>[] {
    const decodingMethod = this.readClient.appClient.getABIMethod(abiDecodingMethodName);
    const parsed = logs.map((logValue) =>
      logValue.length
        ? tupleParser(
            // @ts-ignore TODO fixable?
            decodingMethod.returns.type.decode(logValue)
          )
        : { deleted: true }
    );
    return parsed;
  }

  /*
   * ts guard for write clients only
   */
  requireWriteClient(): asserts this is this & { writeAccount: TransactionSignerAccount } & { writeClient: AssetLabelingClient } {
    if (this.writeAccount === undefined || this.writeClient === undefined) {
      throw new Error(`A transaction operation was issued on a read-only client`);
    }
  }

  /*
   * pMap batcher, merge maps after
   *
   * decorator pattern instead would be nice but ... eh
   */
  async batchCall<T extends AnyFn>(method: T, [assetIDs, ...rest]: Parameters<T>, methodMax: number): Promise<ReturnType<T>> {
    const chunkedAssetIds = chunk(assetIDs, methodMax);
    const res = await pMap(chunkedAssetIds, (assetIDs) => method(assetIDs, ...rest), { concurrency: this.concurrency });
    // @ts-ignore
    return res[0] instanceof Map ? mergeMapsArr(res) : undefined;
  }
}
