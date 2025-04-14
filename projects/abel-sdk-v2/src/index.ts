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
  AbelSDKOptions,
  AnyFn,
  AssetFull,
  AssetMicro,
  AssetMicroLabels,
  AssetSmall,
  AssetText,
  AssetTextLabels,
  AssetTiny,
  AssetTinyLabels,
  ClientResponse,
  LabelDescriptor,
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

/**
 * The `AbelSDK` class is an SDK for interacting with an asset labeling system, allowing querying, management, and
 * association of labels, assets, and operators within a given application.
 * The class supports read and write operations and relies on Algorand blockchain infrastructure.
 *
 * @example
 * import { AlgorandClient } from "@algorandfoundation/algokit-utils";
 * import { AbelSDK } from "abel-sdk";
 *
 * const abel = new AbelSDK({
 *   appId: 2914159523n, // Abel Mainnet PoC App ID
 *   algorand: AlgorandClient.fromConfig({
 *     algodConfig: { server: "https://mainnet-api.4160.nodely.dev", port: 443 },
 *   }),
 * });
 */
export class AbelSDK {
  /**
   * Represents an instance of AssetLabelingClient used to read data from the Asset Labeling contract.
   * Provides functionality to manage and retrieve asset labeling data.
   */
  readClient: AssetLabelingClient;
  /**
   * Represents an instance of AssetLabelingClient or undefined.
   *
   * The variable is used to write data to the Asset Labeling contract.
   * Ensure to properly check for undefined before attempting to invoke any methods or properties
   * associated with the AssetLabelingClient.
   */
  writeClient: AssetLabelingClient | undefined;
  /**
   * An optional variable representing an account that can authorize and sign transactions.
   *
   * The `writeAccount` variable is either an instance of `TransactionSignerAccount` or is undefined.
   * It is used to execute and authenticate transaction operations.
   */
  writeAccount?: TransactionSignerAccount | undefined;
  /**
   * Specifies the maximum number of concurrent operations allowed.
   * This variable defines the degree of parallelism that is permissible
   * for processes or tasks. Adjust this value to control the level of
   * concurrency in the application.
   */
  readonly #concurrency: number = 4;

  constructor(options: AbelSDKOptions) {
    const {
      algorand,
      appId,
      readAccount = DEFAULT_READ_ACCOUNT,
      writeAccount,
      concurrency,
    } = options;
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
      this.#concurrency = concurrency;
    }
  }

  /**
   * Retrieves the application ID associated with the current client instance.
   */
  get appId() {
    return this.readClient.appId;
  }

  /**
   * Return all label IDs available on the contract
   *
   * @returns Label IDs
   */
  async getAllLabels(): Promise<string[]> {
    return (await this.getBoxesByLength(2)).map((boxName) => boxName.name);
  }

  /**
   * Return all operator addresses on the contract
   *
   * @returns Operator addresses
   */
  async getAllOperators(): Promise<string[]> {
    return (await this.getBoxesByLength(32)).map((boxName) => encodeAddress(boxName.nameRaw));
  }

  /**
   * Return all asset IDs available on the contract
   *
   * @returns Asset IDs
   */
  async getAllAssetIDs(): Promise<bigint[]> {
    return (await this.getBoxesByLength(8)).map((boxName) => decodeUint64(boxName.nameRaw, "bigint"));
  }

  /*
   * Registry Readers
   *
   * We simulate from a client configured with a (theoretically) known-good account on all networks, default dev fee sink
   */

  /**
   * Returns whether a specific label ID exists or not
   *
   * @param labelId label ID
   * @returns Whether the label exists or not
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

  /**
   * Get a label descriptor for a label by its ID.
   *
   * @param labelId The label to look up by label ID
   * @returns A label descriptor
   */
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

  /**
   * Get multiple label descriptors for labels, by their IDs.
   *
   * @param {string} labelIds The label IDs to look up
   * @return Result wap with label IDs as keys and LabelDescriptors as values.
   */
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

  /**
   * Returns whether or not an operator has access to a label
   *
   * @param operator The operator address to query
   * @param {string} label The label ID to look up
   * @returns
   */
  async hasOperatorLabel(operator: string, label: string): Promise<boolean> {
    const {
      returns: [hasLabel],
    } = await wrapErrors(this.readClient.newGroup().hasOperatorLabel({ args: { operator, label } }).simulate(SIMULATE_PARAMS));
    return Boolean(hasLabel);
  }

  /**
   * Get all labels for an operator
   *
   * @param operator The operator address to query
   * @returns Labels that this account can operate on
   */
  async getOperatorLabels(operator: string): Promise<string[]> {
    const {
      returns: [operatorLabels],
    } = await wrapErrors(this.readClient.newGroup().getOperatorLabels({ args: { operator } }).simulate(SIMULATE_PARAMS));

    return operatorLabels!;
  }

  /**
   * Return whether an asset has a specific label
   *
   * @param assetId Asset to look up, by asset ID
   * @param label label to query for, by label ID
   * @return True if an asset exists and has a label
   */
  async hasAssetLabel(assetId: bigint, label: string): Promise<boolean> {
    const {
      returns: [hasLabel],
    } = await wrapErrors(this.readClient.newGroup().hasAssetLabel({ args: { assetId, label } }).simulate(SIMULATE_PARAMS));
    return Boolean(hasLabel);
  }


  /**
   * Fetches the labels associated with a specific asset.
   *
   * @param assetId - The unique identifier of the asset for which labels need to be retrieved.
   * @return A promise that resolves to an array of asset labels.
   */
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

  /**
   * Retrieves asset labels for a given list of asset IDs asynchronously.
   *
   * This method performs a simulation of fetching labels for the specified assets by calling
   * the `logAssetsLabels` function through the `readClient` instance. If the input list of
   * asset IDs exceeds the predefined maximum (METHOD_MAX), it automatically splits the call
   * into batches for processing.
   *
   * @param assetIds - An array of asset IDs for which labels are to be fetched.
   * @returns A promise that resolves to a map where each asset ID
   * corresponds to its associated array of labels.
   * @throws {Error} If an error occurs during the simulation or log parsing process.
   */
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


  /**
   * Adds a label to the specified entity with the given details.
   *
   * @param labelId - The unique identifier for the label.
   * @param name - The name of the label.
   * @param url - The URL associated with the label.
   * @return Returns a promise that resolves to the result of the operation, potentially wrapped with error handling.
   */
  async addLabel(labelId: string, name: string, url: string): Promise<ClientResponse> {
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

  /**
   * Updates the label with the specified ID, changing its name and URL.
   *
   * @param labelId - The unique identifier of the label to be changed.
   * @param name - The new name to assign to the label.
   * @param url - The new URL to associate with the label.
   * @return A promise that resolves with the response from the client after attempting to update the label.
   * @throws {Error} If the `name` or `url` parameters are nullish (undefined or null).
   */
  async changeLabel(labelId: string, name: string, url: string): Promise<ClientResponse> {
    this.requireWriteClient();

    if (isNullish(name)) throw new Error("name must be defined");
    if (isNullish(url)) throw new Error("url must be defined");

    const query = this.writeClient
      .newGroup()
      .changeLabel({ args: { id: labelId, name, url }, boxReferences: [labelId] })
      .send();

    return wrapErrors(query);
  }

  /**
   * Removes a label specified by the labelId.
   *
   * @param labelId - The unique identifier of the label to be removed.
   * @return A promise that resolves with the result of the removal operation
   * or rejects with an error if the operation fails.
   */
  async removeLabel(labelId: string): Promise<ClientResponse> {
    this.requireWriteClient();

    const query = this.writeClient.send.removeLabel({
      args: {
        id: labelId,
      },
      boxReferences: [labelId],
    });
    return wrapErrors(query);
  }

  /**
   * Add a label to an operator.
   * This allows the operator address to add/remove operators to the label, as well as label assets with this label.
   *
   * @param operator Operator address
   * @param labelId Label to add to operator
   * @returns
   */
  async addOperatorToLabel(operator: string, labelId: string): Promise<ClientResponse> {
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

  /**
   * Removes an operator from a specified label.
   *
   * @param operator - The address of the operator to be removed.
   * @param labelId - The ID of the label from which the operator is to be removed.
   * @return A promise that resolves to the client response indicating the result of the operation.
   */
  async removeOperatorFromLabel(operator: string, labelId: string): Promise<ClientResponse> {
    this.requireWriteClient();

    const query = await this.writeClient.send.removeOperatorFromLabel({
      args: { operator, label: labelId },
      boxReferences: [decodeAddress(operator).publicKey, labelId],
    });

    return wrapErrors(query);
  }

  /**
   * Adds a label to a specified asset by associating the label ID with the asset ID.
   *
   * @param assetId - The unique identifier of the asset to which the label will be added.
   * @param labelId - The unique identifier of the label to be associated with the asset.
   * @return A promise that resolves to the client response indicating the result of the operation.
   */
  async addLabelToAsset(assetId: bigint, labelId: string): Promise<ClientResponse> {
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

  /**
   * Adds a specified label to a set of asset IDs.
   *
   * This function permits assigning a label to assets in batches to optimize performance.
   * If the list of asset IDs exceeds the maximum limit for a single method invocation,
   * the function segments the asset IDs into chunks and processes them asynchronously
   * with controlled concurrency.
   *
   * @param assetIds - An array of asset IDs to be labeled.
   * @param labelId - The identifier of the label to be added to the assets.
   * @returns A promise that resolves to the response(s) from the operation.
   * If the operation involves chunked requests, the responses are returned as an array.
   *
   * @throws Error Throws an error if the write client is not available.
   */
  addLabelToAssets = async (assetIds: bigint[], labelId: string): Promise<ClientResponse | ClientResponse[]> => {
    this.requireWriteClient();

    const METHOD_MAX = 6 + 8 * 15;
    if (assetIds.length > METHOD_MAX) {
      const chunked = chunk(assetIds, METHOD_MAX);
      return pMap(chunked, (assetIds) => this.addLabelToAssets(assetIds, labelId) as Promise<ClientResponse>, {
        concurrency: this.#concurrency,
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

  /**
   * Removes a label from a specified asset.
   *
   * @param assetId - The unique identifier of the asset from which the label should be removed.
   * @param labelId - The unique identifier of the label to be removed from the asset.
   * @return A promise that resolves to a ClientResponse indicating the result of the label removal operation.
   */
  async removeLabelFromAsset(assetId: bigint, labelId: string): Promise<ClientResponse> {
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

  /**
   * Retrieves a map of asset micro details for the provided asset IDs.
   *
   * This function handles querying for the details of multiple assets using their respective IDs.
   * It ensures batched processing if the number of asset IDs exceeds the maximum method capacity.
   *
   * @param assetIds - An array of asset IDs for which the micro details are requested.
   * @returns A promise that resolves to a map where each key is the asset ID,
   *                                             and the value is the corresponding AssetMicro data.
   * @throws {Error} Throws an error if the query or data parsing encounters an issue.
   */
  getAssetsMicro = async (assetIds: bigint[]): Promise<Map<bigint, AssetMicro>> => {
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

  /**
   * Fetches the micro labels for a given list of asset IDs.
   *
   * This method retrieves metadata for the specified assets by making
   * a request to the underlying data source. It supports batching
   * for optimizing requests, ensuring that if the asset list exceeds
   * a predefined maximum limit (`METHOD_MAX`), it splits the calls
   * into batches for processing.
   *
   * @param assetIds - An array of asset IDs for which micro labels are to be fetched.
   * @returns A promise resolving to a Map where each key is an asset ID and the value is its corresponding micro label information.
   *
   * @throws Error Throws an error if the underlying client encounters issues processing the request.
   */
  getAssetsMicroLabels = async (assetIds: bigint[]): Promise<Map<bigint, AssetMicroLabels>> => {
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

  /**
   * Retrieves a mapping of asset IDs to their corresponding "AssetTiny" details.
   * This asynchronous function fetches details for the provided asset IDs in an optimized manner,
   * using batching if the number of asset IDs exceeds the allowed limit.
   *
   * @param assetIds - An array of asset identifiers for which the details are requested.
   * @returns  A promise that resolves to a Map where each asset ID is mapped
   *   to its corresponding "AssetTiny" details.
   * @throws Error Will throw an error if there is an issue during the retrieval or processing of the asset details.
   */
  getAssetsTiny = async (assetIds: bigint[]): Promise<Map<bigint, AssetTiny>> => {
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

  /**
   * Fetches tiny label details for the given list of asset IDs.
   *
   * This method queries asset data in batches if the number of asset IDs exceeds a pre-defined limit.
   * It uses simulated calls to the read client for retrieving asset label information and parses
   * the logs to extract the results. The returned data is mapped to each asset ID.
   *
   * @param assetIds - Array of asset IDs for which tiny labels are to be retrieved.
   * @returns  A promise that resolves to a map,
   * where each key is an asset ID (bigint) and the value is an object containing the tiny label details for the asset.
   *
   * @throws Error Will throw an error if any issue occurs while simulating or parsing logs.
   */
  getAssetsTinyLabels = async (assetIds: bigint[]): Promise<Map<bigint, AssetTinyLabels>> => {
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

  /**
   * Retrieves asset text details for a given list of asset IDs.
   *
   * This function fetches the text descriptors for the specified asset IDs asynchronously.
   * If the number of asset IDs exceeds the defined method limit (`METHOD_MAX`),
   * the function breaks the request into smaller batches and calls itself recursively.
   *
   * @param assetIds - An array of bigint values representing the asset IDs.
   * @returns A promise that resolves to a Map,
   * where each key is an asset ID and the value is an `AssetText` object containing
   * the text descriptor for the respective asset.
   *
   * @throws Error Will throw errors if the internal simulation or parsing of logs fails.
   */
  getAssetsText = async (assetIds: bigint[]): Promise<Map<bigint, AssetText>> => {
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

  /**
   * Fetches text labels for a given list of asset IDs.
   *
   * The function retrieves the text labels associated with the provided asset IDs
   * by calling the backend services and simulating the results. If the number of
   * asset IDs exceeds the maximum allowed limit (METHOD_MAX), the function divides
   * the request into smaller batch calls.
   *
   * @param assetIds - An array of asset IDs for which text labels are to be fetched.
   * @returns A promise that resolves to a map where the keys
   * are the asset IDs and the values are their associated text label objects.
   * @throws Error Will throw errors if the simulation or parsing of logs fails during the process.
   */
  getAssetsTextLabels = async (assetIds: bigint[]): Promise<Map<bigint, AssetTextLabels>> => {
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

  /**
   * Retrieves a map of small asset details for the given list of asset IDs.
   *
   * If the number of asset IDs exceeds the maximum allowable batch size (`METHOD_MAX`), the method splits
   * the request into batches by recursively calling itself with the appropriate subdivisions of the `assetIds` array.
   *
   * The method interacts with a read client to simulate a data retrieval process and parses the resulting logs
   * to map each asset ID to its corresponding asset data.
   *
   * @param assetIds - An array of asset IDs for which the small asset details should be retrieved.
   * @returns A promise resolving to a map where the keys are asset IDs (bigint)
   * and the values are `AssetSmall` objects containing the corresponding small asset details.
   *
   * @throws Error Will propagate any errors encountered during the read client interaction or log parsing.
   */
  getAssetsSmall = async (assetIds: bigint[]): Promise<Map<bigint, AssetSmall>> => {
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

  /**
   * Retrieves detailed information for a list of asset IDs as a map of asset ID to asset details.
   *
   * If the number of asset IDs exceeds the maximum allowed per method call, the request is automatically divided
   * into smaller batches to handle the data in chunks.
   *
   * @param assetIds - An array of asset IDs for which the detailed information is requested.
   * @returns A promise resolving to a map where each key is an asset ID and
   * the value is the corresponding detailed asset information.
   *
   * @throws {Error} Throws an error if the underlying request fails or an unexpected response format is encountered.
   */
  getAssetsFull = async (assetIds: bigint[]): Promise<Map<bigint, AssetFull>> => {
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

  /**
   * Retrieves a list of box names where the name has a specified length.
   *
   * @param {number} length - The length of the box names to filter by.
   * @return {Promise<BoxName[]>} A promise that resolves to an array of box names matching the specified length.
   */
  private async getBoxesByLength(length: number): Promise<BoxName[]> {
    const boxNames = await this.readClient.algorand.app.getBoxNames(this.appId);
    return boxNames.filter((boxName) => boxName.nameRaw.length === length);
  }

  /**
   * parse typed arc4 structs from logs
   *
   * tupleParser is like generated clients' xyzArcStructFromTuple
   * abiDecodingMethod is a method name that returns the same avi return type as we are logging
   *    e.g. if we are parsing log_label_descriptors() logs that logs LabelDescriptor, abiDecodingMethod can be get_label_descriptor that has ABI return LabelDescriptor
   */
  parseLogsAs<T extends AnyFn>(logs: Uint8Array[], tupleParser: T, abiDecodingMethodName: string): ReturnType<T>[] {
    const decodingMethod = this.readClient.appClient.getABIMethod(abiDecodingMethodName);
    const parsed = logs.map((logValue) =>
      tupleParser(
        // @ts-ignore TODO fixable?
        decodingMethod.returns.type.decode(logValue)
      )
    );
    return parsed;
  }

  /**
   * Asserts that the current instance has both a `writeAccount` and `writeClient` defined.
   * Throws an error if either is undefined, indicating the operation cannot be performed
   * on a read-only client.
   *
   * @return Asserts that the instance includes `writeAccount` of type `TransactionSignerAccount`
   *         and `writeClient` of type `AssetLabelingClient`.
   */
  private requireWriteClient(): asserts this is this & { writeAccount: TransactionSignerAccount } & { writeClient: AssetLabelingClient } {
    if (this.writeAccount === undefined || this.writeClient === undefined) {
      throw new Error(`A transaction operation was issued on a read-only client`);
    }
  }

  /**
   * Executes a batch call on a given method with a specific maximum number of assets processed per batch.
   *
   * pMap batcher, merge maps after
   * decorator pattern instead would be nice but ... eh
   *
   * @param method The function to be called for each batch.
   * @param param1 The parameters for the method, where `param1[0]` refers to an array of asset IDs to be processed.
   * @param methodMax The maximum number of asset IDs to process in a single batch.
   * @return A promise that resolves to the combined result of the batch executions.
   * If the results are Maps, they are merged.
   */
  private async batchCall<T extends AnyFn>(method: T, [assetIDs, ...rest]: Parameters<T>, methodMax: number): Promise<ReturnType<T>> {
    const chunkedAssetIds = chunk(assetIDs, methodMax);
    const res = await pMap(chunkedAssetIds, (assetIDs) => method(assetIDs, ...rest), { concurrency: this.#concurrency });
    // @ts-ignore
    return res[0] instanceof Map ? mergeMapsArr(res) : undefined;
  }
}
