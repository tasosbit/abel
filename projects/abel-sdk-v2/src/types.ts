import { ABIReturn } from "@algorandfoundation/algokit-utils/types/app";
import { Transaction } from "algosdk";
import { PendingTransactionResponse } from "algosdk/dist/types/client/v2/algod/models/types.js";
import {
  LabelDescriptor as LabelDescriptorBoxValue,
  AssetMicro as AssetMicroValue,
  AssetMicroLabels as AssetMicroLabelsValue,
  AssetTiny as AssetTinyValue,
  AssetTinyLabels as AssetTinyLabelsValue,
  AssetText as AssetTextValue,
  AssetTextLabels as AssetTextLabelsValue,
  AssetSmall as AssetSmallValue,
  AssetFull as AssetFullValue,
} from "./generated/abel-contract-client.js";
import {AlgorandClient} from "@algorandfoundation/algokit-utils";
import {TransactionSignerAccount} from "@algorandfoundation/algokit-utils/types/account";

/**
 * Represents the configuration options for initializing the Abel SDK.
 */
export interface AbelSDKOptions {
  /**
   * Represents an instance of the Algorand client used for interacting with the Algorand blockchain.
   * The client provides functionalities to connect to the network, submit transactions,
   * retrieve account information, and manage blockchain-related operations.
   *
   * This variable is initialized with the required configuration and network details
   * to establish communication with the desired Algorand network.
   */
  algorand: AlgorandClient;
  /**
   * Represents the unique identifier of an application.
   * This identifier is a BigInt value and is typically used for referencing
   * and distinguishing one application instance from another within the AVM.
   */
  appId: bigint;
  /**
   * An optional property representing a signer account used for
   * writing or authorizing transactions.
   */
  writeAccount?: TransactionSignerAccount;
  /**
   * The Algorand address for reading
   */
  readAccount?: string;
  /**
   * The maximum number of concurrent operations allowed.
   * This optional parameter defines the upper limit for tasks or processes
   * that can run simultaneously.
   */
  concurrency?: number;
}

/**
 * A label description/configuration
 *
 */
export interface LabelDescriptor extends LabelDescriptorBoxValue {
  id: string;
}

/**
 * @protected
 */
export type AnyFn = (...args: any[]) => any;

export type ClientResponse = QueryReturn | SendReturn | BoxReturn;

/**
 * @protected
 */
export interface QueryReturn {
  groupId: string;
  txIds: string[];
  returns: ABIReturn[] & [];
  confirmations: PendingTransactionResponse[];
  transactions: Transaction[];
}

/**
 * @protected
 */
export interface SendReturn {
  confirmations: PendingTransactionResponse[];
  groupId: string;
  returns: ABIReturn[] & [undefined | void];
  transactions: Transaction[];
  txIds: string[];
}

/**
 * @protected
 */
export interface BoxReturn {
  return: void | undefined;
  groupId: string;
  txIds: string[];
  returns?: ABIReturn[] | undefined;
  confirmations: PendingTransactionResponse[];
  transactions: Transaction[];
  confirmation: PendingTransactionResponse;
  transaction: Transaction;
}
export interface AssetMicro extends AssetMicroValue { id: bigint; }
export interface AssetMicroLabels extends AssetMicroLabelsValue { id: bigint; }
export interface AssetTiny extends AssetTinyValue { id: bigint; }
export interface AssetTinyLabels extends AssetTinyLabelsValue { id: bigint; }
export interface AssetText extends AssetTextValue { id: bigint; }
export interface AssetTextLabels extends AssetTextLabelsValue { id: bigint; }
export interface AssetSmall extends AssetSmallValue { id: bigint; }
export interface AssetFull extends AssetFullValue { id: bigint; }

/**
 * @protected
 */
export type FirstArgument<T extends (...args: any[]) => any> = T extends (arg1: infer U, ...args: any[]) => any ? U : never;
