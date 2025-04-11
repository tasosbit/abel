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

export interface LabelDescriptor extends LabelDescriptorBoxValue {
  id: string;
}

export type AnyFn = (...args: any[]) => any;

export interface QueryReturn {
  groupId: string;
  txIds: string[];
  returns: ABIReturn[] & [];
  confirmations: PendingTransactionResponse[];
  transactions: Transaction[];
}

export type DeletedAsset = { id: bigint; deleted: true };

export type AssetMicro = (AssetMicroValue & { id: bigint }) | DeletedAsset;
export type AssetMicroLabels = (AssetMicroLabelsValue & { id: bigint }) | DeletedAsset;
export type AssetTiny = (AssetTinyValue & { id: bigint }) | DeletedAsset;
export type AssetTinyLabels = (AssetTinyLabelsValue & { id: bigint }) | DeletedAsset;
export type AssetText = (AssetTextValue & { id: bigint }) | DeletedAsset;
export type AssetTextLabels = (AssetTextLabelsValue & { id: bigint }) | DeletedAsset;
export type AssetSmall = (AssetSmallValue & { id: bigint }) | DeletedAsset;
export type AssetFull = (AssetFullValue & { id: bigint }) | DeletedAsset;

export type FirstArgument<T extends (...args: any[]) => any> = T extends (arg1: infer U, ...args: any[]) => any ? U : never;
