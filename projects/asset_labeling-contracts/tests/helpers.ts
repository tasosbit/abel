import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account'
import { Address, Account, encodeUint64 } from 'algosdk'
import { AssetLabelingClient, LabelDescriptor } from '../smart_contracts/artifacts/asset_labeling/AssetLabelingClient'

export async function addLabel(
  client: AssetLabelingClient,
  account: Address & TransactionSignerAccount & Account,
  labelId: string,
  labelName: string,
  labelUrl: string,
): Promise<string> {
  const { txIds } = await client
    .newGroup()
    .addTransaction(
      await client.algorand.createTransaction.payment({
        sender: account,
        receiver: client.appAddress,
        amount: (0.2).algos(),
      }),
    )
    .addLabel({ args: { id: labelId, name: labelName, url: labelUrl }, boxReferences: [labelId] })
    .send()
  return txIds[0]
}

export async function changeLabel(
  client: AssetLabelingClient,
  labelId: string,
  labelName: string,
  labelUrl: string,
): Promise<string> {
  const { txIds } = await client.send.changeLabel({
    args: { id: labelId, name: labelName, url: labelUrl },
    boxReferences: [labelId],
  })
  return txIds[0]
}

export async function hasLabel(client: AssetLabelingClient, labelId: string): Promise<BigInt> {
  const {
    returns: [retVal],
  } = await client
    .newGroup()
    .hasLabel({ args: { id: labelId }, boxReferences: [labelId] })
    .send()
  return retVal!
}

export async function removeLabel(client: AssetLabelingClient, labelId: string): Promise<string> {
  const { txIds } = await client
    .newGroup()
    .removeLabel({ args: { id: labelId }, boxReferences: [labelId] })
    .send()
  return txIds[0]
}

export async function getLabelDescriptor(client: AssetLabelingClient, labelId: string): Promise<LabelDescriptor> {
  const {
    returns: [labelDescriptor],
  } = await client
    .newGroup()
    .getLabel({ args: { id: labelId }, boxReferences: [labelId] })
    .simulate()

  return labelDescriptor!
}

export async function addOperatorToLabel(
  client: AssetLabelingClient,
  operator: Account,
  label: string,
): Promise<string> {
  const { txIds } = await client.send.addOperatorToLabel({
    args: { operator: operator.addr.toString(), label },
    boxReferences: [operator.addr.publicKey, label],
  })
  return txIds[0]
}

export async function hasOperatorLabel(client: AssetLabelingClient, operator: Account, label: string): Promise<BigInt> {
  const { return: retVal } = await client.send.hasOperatorLabel({
    args: { operator: operator.addr.toString(), label },
    boxReferences: [operator.addr.publicKey, label],
  })
  return retVal!
}

export async function removeOperatorFromLabel(
  client: AssetLabelingClient,
  operator: Account,
  label: string,
): Promise<string> {
  const { txIds } = await client.send.removeOperatorFromLabel({
    args: { operator: operator.addr.toString(), label },
    boxReferences: [operator.addr.publicKey, label /* TODO default sender */],
  })
  return txIds[0]
}

export async function getOperatorLabels(client: AssetLabelingClient, operator: Account): Promise<string[]> {
  const {
    returns: [operatorLabels],
  } = await client
    .newGroup()
    .getOperatorLabels({ args: { operator: operator.addr.toString() }, boxReferences: [operator.addr.publicKey] })
    .simulate()

  return operatorLabels!
}

export async function addLabelToAsset(client: AssetLabelingClient, asset: bigint, label: string): Promise<string> {
  const { txIds } = await client.send.addLabelToAsset({
    args: { asset, label },
    boxReferences: [label],
  })
  return txIds[0]
}

export async function hasAssetLabel(client: AssetLabelingClient, asset: bigint, label: string): Promise<BigInt> {
  const { return: retVal } = await client.send.hasAssetLabel({
    args: { assetId: asset, label },
    boxReferences: [encodeUint64(asset)],
  })
  return retVal!
}

export async function addLabelToAssets(client: AssetLabelingClient, assets: bigint[], label: string): Promise<string> {
  const { txIds } = await client.send.addLabelToAssets({
    args: { assets, label },
    boxReferences: [label],
  })
  return txIds[0]
}

export async function removeLabelFromAsset(client: AssetLabelingClient, asset: bigint, label: string): Promise<string> {
  const { txIds } = await client.send.removeLabelFromAsset({
    args: { asset, label },
    boxReferences: [
      encodeUint64(asset),
      /* TODO default sender */
    ],
  })
  return txIds[0]
}

export async function getAssetLabels(client: AssetLabelingClient, asset: bigint): Promise<string[]> {
  const {
    returns: [assetLabels],
  } = await client
    .newGroup()
    .getAssetLabels({ args: { asset }, boxReferences: [encodeUint64(asset)] })
    .simulate()

  return assetLabels!
}
