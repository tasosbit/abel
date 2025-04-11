import { algorandFixture } from '@algorandfoundation/algokit-utils/testing'
import {
  AssetLabelingClient,
  AssetLabelingFactory,
} from '../smart_contracts/artifacts/asset_labeling/AssetLabelingClient'
import { Account, Address, appendSignMultisigTransaction } from 'algosdk'
import { Config } from '@algorandfoundation/algokit-utils'
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account'
import {
  addLabelToAsset,
  addLabel,
  addOperatorToLabel,
  getAssetLabels,
  getLabelDescriptor,
  getOperatorLabels,
  removeLabel,
  removeOperatorFromLabel,
  removeLabelFromAsset,
  addLabelToAssets,
  hasAssetLabel,
  hasLabel,
  hasOperatorLabel,
  changeLabel,
} from './helpers'

describe('asset labeling contract', () => {
  const localnet = algorandFixture()

  beforeAll(() => {
    Config.configure({
      populateAppCallResources: true,
      debug: false,
      traceAll: false,
    })
  })
  beforeEach(localnet.newScope)

  const deploy = async (account: Account & TransactionSignerAccount) => {
    const factory = localnet.algorand.client.getTypedAppFactory(AssetLabelingFactory, {
      defaultSender: account.addr,
      defaultSigner: account.signer,
    })

    const { appClient } = await factory.deploy({ onUpdate: 'append', onSchemaBreak: 'append' })
    return { adminClient: appClient }
  }

  describe('change admin', () => {
    let adminClient: AssetLabelingClient
    let randoClient: AssetLabelingClient
    let adminAccount: Address & Account & TransactionSignerAccount
    let randoAccount: Address & Account & TransactionSignerAccount

    beforeAll(async () => {
      await localnet.newScope()

      adminAccount = localnet.context.testAccount
      adminClient = (await deploy(adminAccount)).adminClient

      randoAccount = await localnet.context.generateAccount({ initialFunds: (1).algos() })
      randoClient = adminClient.clone({
        defaultSender: randoAccount,
        defaultSigner: randoAccount.signer,
      })
    })

    test('should work', async () => {
      await adminClient.send.changeAdmin({ args: { newAdmin: randoAccount.addr.toString() } })
      const storedAdmin = await adminClient.state.global.admin()
      expect(storedAdmin.asByteArray()).toEqual(randoAccount.addr.publicKey)

      await randoClient.send.changeAdmin({ args: { newAdmin: adminAccount.addr.toString() } })
      const revertedAdmin = await adminClient.state.global.admin()
      expect(revertedAdmin.asByteArray()).toEqual(adminAccount.addr.publicKey)
    })

    test('change admin should fail when not called by admin', async () => {
      await expect(() =>
        randoClient.send.changeAdmin({ args: { newAdmin: randoAccount.addr.toString() } }),
      ).rejects.toThrow(/ERR:UNAUTH/)

      await adminClient.send.changeAdmin({ args: { newAdmin: randoAccount.addr.toString() } })

      await expect(() =>
        adminClient.send.changeAdmin({ args: { newAdmin: randoAccount.addr.toString() } }),
      ).rejects.toThrow(/ERR:UNAUTH/)
    })
  })

  test('add label', async () => {
    const { testAccount: adminAccount } = localnet.context
    const { adminClient } = await deploy(adminAccount)

    const id = 'wo'
    const name = 'world'
    const url = 'http://'

    await addLabel(adminClient, adminAccount, id, name, url)

    const labelDescriptor = await getLabelDescriptor(adminClient, id)

    expect(labelDescriptor?.name).toBe(name)
    expect(labelDescriptor?.url).toBe(url)
    expect(labelDescriptor?.numAssets).toBe(0n)
    expect(labelDescriptor?.numOperators).toBe(0n)
  })

  test('add label should fail by nonadmin', async () => {
    const { testAccount: adminAccount } = localnet.context
    const { adminClient } = await deploy(adminAccount)

    const id = 'wo'
    const name = 'world'
    const url = 'http://'

    const rando = await localnet.context.generateAccount({ initialFunds: (0.2).algos() })
    const randoClient = adminClient.clone({
      defaultSender: rando,
      defaultSigner: rando.signer,
    })

    await expect(() => addLabel(randoClient, adminAccount, id, name, url)).rejects.toThrow(/ERR:UNAUTH/)
  })

  test('re-add existing label should fail', async () => {
    const { testAccount: adminAccount } = localnet.context
    const { adminClient } = await deploy(adminAccount)

    const id = 'wo'
    const name = 'world'
    const url = 'http://'

    await addLabel(adminClient, adminAccount, id, name, url)
    await expect(() => addLabel(adminClient, adminAccount, id, name, url)).rejects.toThrow(/ERR:EXISTS/)
  })

  for (const id of ['w', 'www']) {
    test(`add label with invalid length (${id.length}) should fail`, async () => {
      const { testAccount: adminAccount } = localnet.context
      const { adminClient } = await deploy(adminAccount)

      const name = 'world'
      const url = 'http://'

      await expect(() => addLabel(adminClient, adminAccount, id, name, url)).rejects.toThrow(/ERR:LENGTH/)
    })
  }

  test('change label should work', async () => {
    const { testAccount: adminAccount } = localnet.context
    const { adminClient } = await deploy(adminAccount)

    const id = 'wo'
    const name = 'world'
    const url = 'http://'

    const name2 = 'new world'
    const url2 = 'https://'

    await addLabel(adminClient, adminAccount, id, name, url)
    await changeLabel(adminClient, id, name2, url2)

    const labelDescriptor = await getLabelDescriptor(adminClient, id)

    expect(labelDescriptor?.name).toBe(name2)
    expect(labelDescriptor?.url).toBe(url2)
    expect(labelDescriptor?.numAssets).toBe(0n)
    expect(labelDescriptor?.numOperators).toBe(0n)
  })

  test('change label should fail', async () => {
    const { testAccount: adminAccount } = localnet.context
    const { adminClient } = await deploy(adminAccount)

    const id = 'wo'
    const name = 'world'
    const url = 'http://'
    const notId = 'zz'

    const operator = await localnet.context.generateAccount({ initialFunds: (0.2).algos() })

    await addLabel(adminClient, adminAccount, id, name, url)
    await addOperatorToLabel(adminClient, operator, id)
    const operatorClient = adminClient.clone({
      defaultSender: operator,
      defaultSigner: operator.signer,
    })

    await expect(() => changeLabel(operatorClient, id, name, url)).rejects.toThrow(/ERR:UNAUTH/)
    await expect(() => changeLabel(adminClient, notId, name, url)).rejects.toThrow(/ERR:NOEXIST/)
  })

  test('has label should work', async () => {
    const { testAccount: adminAccount } = localnet.context
    const { adminClient } = await deploy(adminAccount)

    const id = 'wo'
    const name = 'world'
    const url = 'http://'
    const notId = 'zz'
    const invalidLengthId = 'xxx'

    await addLabel(adminClient, adminAccount, id, name, url)

    const has = await hasLabel(adminClient, id)
    expect(has).toBe(1n)

    const has2 = await hasLabel(adminClient, notId)
    expect(has2).toBe(0n)

    await expect(() => hasLabel(adminClient, invalidLengthId)).rejects.toThrow(/ERR:LENGTH/)
  })

  test('add label, remove label', async () => {
    const { testAccount: adminAccount } = localnet.context
    const { adminClient } = await deploy(adminAccount)

    const id = 'wo'
    const name = 'world'
    const url = 'http://'

    await addLabel(adminClient, adminAccount, id, name, url)

    await removeLabel(adminClient, id)

    await expect(() => getLabelDescriptor(adminClient, id)).rejects.toThrow(/ERR:NOEXIST/)
  })

  test('remove nonexist label should fail', async () => {
    const { testAccount: adminAccount } = localnet.context
    const { adminClient } = await deploy(adminAccount)

    const id = 'wo'

    await expect(removeLabel(adminClient, id)).rejects.toThrow(/ERR:NOEXIST/)
  })

  test('add operator to label', async () => {
    const { testAccount: adminAccount } = localnet.context
    const { adminClient } = await deploy(adminAccount)

    const id = 'wo'
    const name = 'world'
    const url = 'http://'

    await addLabel(adminClient, adminAccount, id, name, url)

    await addOperatorToLabel(adminClient, adminAccount, id)

    const labelDescriptor = await getLabelDescriptor(adminClient, id)

    expect(labelDescriptor?.numOperators).toBe(1n)

    const operatorLabels = await getOperatorLabels(adminClient, adminAccount)
    expect(operatorLabels).toStrictEqual([id])

    const { numOperators } = await getLabelDescriptor(adminClient, id)
    expect(numOperators).toBe(1n)
  })

  test('add operator to label by operator', async () => {
    const { testAccount: adminAccount } = localnet.context
    const { adminClient } = await deploy(adminAccount)

    const id = 'wo'
    const name = 'world'
    const url = 'http://'

    const operator = await localnet.context.generateAccount({ initialFunds: (0.2).algos() })

    await addLabel(adminClient, adminAccount, id, name, url)

    await addOperatorToLabel(adminClient, operator, id)

    const [operatorLabel] = await getOperatorLabels(adminClient, operator)
    expect(operatorLabel).toBe(id)

    const operatorClient = adminClient.clone({
      defaultSender: operator,
      defaultSigner: operator.signer,
    })

    const operator2 = await localnet.context.generateAccount({ initialFunds: (0).algos() })
    await addOperatorToLabel(operatorClient, operator2, id)
  })

  test('has operator label should work', async () => {
    const { testAccount: adminAccount } = localnet.context
    const { adminClient } = await deploy(adminAccount)

    const id = 'wo'
    const name = 'world'
    const url = 'http://'
    const notId = 'zz'
    const invalidLengthId = 'xxx'

    const operator = await localnet.context.generateAccount({ initialFunds: (0.2).algos() })
    await addLabel(adminClient, adminAccount, id, name, url)
    await addOperatorToLabel(adminClient, operator, id)

    const has = await hasOperatorLabel(adminClient, operator, id)
    expect(has).toBe(1n)

    const has2 = await hasOperatorLabel(adminClient, operator, notId)
    expect(has2).toBe(0n)

    const has3 = await hasOperatorLabel(adminClient, adminAccount, id)
    expect(has3).toBe(0n)

    await expect(() => hasOperatorLabel(adminClient, adminAccount, invalidLengthId)).rejects.toThrow(/ERR:LENGTH/)
  })

  test('add 2 labels to operator', async () => {
    const { testAccount: adminAccount } = localnet.context
    const { adminClient } = await deploy(adminAccount)

    const id = 'wo'
    const name = 'world'
    const url = 'http://'
    const id2 = 'w2'

    await Promise.all([
      addLabel(adminClient, adminAccount, id, name, url),
      addLabel(adminClient, adminAccount, id2, name, url),
    ])

    await addOperatorToLabel(adminClient, adminAccount, id)
    await addOperatorToLabel(adminClient, adminAccount, id2)

    const labelDescriptor = await getLabelDescriptor(adminClient, id)
    expect(labelDescriptor.numOperators).toBe(1n)

    const labelDescriptor2 = await getLabelDescriptor(adminClient, id2)
    expect(labelDescriptor2.numOperators).toBe(1n)

    const operatorLabels = await getOperatorLabels(adminClient, adminAccount)

    expect(operatorLabels).toStrictEqual([id, id2])
  })

  test('add operator to label twice should fail', async () => {
    const { testAccount: adminAccount } = localnet.context
    const { adminClient } = await deploy(adminAccount)

    const id = 'wo'
    const name = 'world'
    const url = 'http://'

    await addLabel(adminClient, adminAccount, id, name, url)
    await addOperatorToLabel(adminClient, adminAccount, id)

    await expect(() => addOperatorToLabel(adminClient, adminAccount, id)).rejects.toThrow(/ERR:EXISTS/)
  })

  test('1x add/remove operator label', async () => {
    const { testAccount: adminAccount } = localnet.context
    const { adminClient } = await deploy(adminAccount)

    const id = 'wo'
    const id2 = 'w2'
    const name = 'world'
    const url = 'http://'

    await addLabel(adminClient, adminAccount, id, name, url)

    await addOperatorToLabel(adminClient, adminAccount, id)
    await removeOperatorFromLabel(adminClient, adminAccount, id)

    const emptyLabels = await getOperatorLabels(adminClient, adminAccount)
    expect(emptyLabels).toEqual([])

    const { numOperators } = await getLabelDescriptor(adminClient, id)
    expect(numOperators).toBe(0n)
  })

  test('2x add/remove operator labels', async () => {
    const { testAccount: adminAccount } = localnet.context
    const { adminClient } = await deploy(adminAccount)

    const id = 'wo'
    const id2 = 'w2'
    const name = 'world'
    const url = 'http://'

    await addLabel(adminClient, adminAccount, id, name, url)
    await addLabel(adminClient, adminAccount, id2, name, url)

    await addOperatorToLabel(adminClient, adminAccount, id)
    await addOperatorToLabel(adminClient, adminAccount, id2)
    await removeOperatorFromLabel(adminClient, adminAccount, id)

    const [operatorLabel] = await getOperatorLabels(adminClient, adminAccount)
    expect(operatorLabel).toBe(id2)

    await removeOperatorFromLabel(adminClient, adminAccount, id2)

    const { numOperators } = await getLabelDescriptor(adminClient, id)
    expect(numOperators).toBe(0n)
  })

  test('2x reverse add/remove operator labels', async () => {
    const { testAccount: adminAccount } = localnet.context
    const { adminClient } = await deploy(adminAccount)

    const id = 'wo'
    const id2 = 'w2'
    const name = 'world'
    const url = 'http://'

    await addLabel(adminClient, adminAccount, id, name, url)
    await addLabel(adminClient, adminAccount, id2, name, url)

    await addOperatorToLabel(adminClient, adminAccount, id)
    await addOperatorToLabel(adminClient, adminAccount, id2)
    await removeOperatorFromLabel(adminClient, adminAccount, id2)

    const [operatorLabel] = await getOperatorLabels(adminClient, adminAccount)
    expect(operatorLabel).toBe(id)

    await removeOperatorFromLabel(adminClient, adminAccount, id)

    const { numOperators } = await getLabelDescriptor(adminClient, id)
    expect(numOperators).toBe(0n)
  })

  test('remove operator label from unauth should fail', async () => {
    const { testAccount: adminAccount } = localnet.context
    const { adminClient } = await deploy(adminAccount)

    const id = 'wo'
    const id2 = 'w2'
    const name = 'world'
    const url = 'http://'

    await addLabel(adminClient, adminAccount, id, name, url)

    await addOperatorToLabel(adminClient, adminAccount, id)

    const rando = await localnet.context.generateAccount({ initialFunds: (0.2).algos() })
    const randoClient = adminClient.clone({
      defaultSender: rando,
      defaultSigner: rando.signer,
    })

    await expect(() => removeOperatorFromLabel(randoClient, adminAccount, id)).rejects.toThrow(/ERR:UNAUTH/)
  })

  test('add label to asset', async () => {
    const { testAccount: adminAccount } = localnet.context
    const { adminClient } = await deploy(adminAccount)

    const label = 'wo'
    const labelName = 'world'
    const labelUrl = 'http://'
    const assetId = 13n

    const operator = await localnet.context.generateAccount({ initialFunds: (0.2).algos() })
    await addLabel(adminClient, adminAccount, label, labelName, labelUrl)
    await addOperatorToLabel(adminClient, operator, label)

    const operatorClient = adminClient.clone({
      defaultSender: operator,
      defaultSigner: operator.signer,
    })

    await addLabelToAsset(operatorClient, assetId, label)

    const labelDescriptor = await getLabelDescriptor(operatorClient, label)
    expect(labelDescriptor.numAssets).toBe(1n)

    const assetLabels = await getAssetLabels(operatorClient, assetId)
    expect(assetLabels).toStrictEqual([label])
  })

  test('add label to 6 assets', async () => {
    const { testAccount: adminAccount } = localnet.context
    const { adminClient } = await deploy(adminAccount)

    const label = 'wo'
    const labelName = 'world'
    const labelUrl = 'http://'
    const assetIds = [13n, 14n, 15n, 16n, 17n, 18n]

    const operator = await localnet.context.generateAccount({ initialFunds: (0.2).algos() })
    await addLabel(adminClient, adminAccount, label, labelName, labelUrl)
    await addOperatorToLabel(adminClient, operator, label)

    const operatorClient = adminClient.clone({
      defaultSender: operator,
      defaultSigner: operator.signer,
    })

    await addLabelToAssets(operatorClient, assetIds, label)

    const labelDescriptor = await getLabelDescriptor(operatorClient, label)
    expect(labelDescriptor.numAssets).toBe(6n)

    for (const assetId of assetIds) {
      const assetLabels = await getAssetLabels(operatorClient, assetId)
      expect(assetLabels).toStrictEqual([label])
    }
  })

  test('add label twice should fail', async () => {
    const { testAccount: adminAccount } = localnet.context
    const { adminClient } = await deploy(adminAccount)

    const label = 'wo'
    const labelName = 'world'
    const labelUrl = 'http://'
    const assetId = 13n

    const operator = await localnet.context.generateAccount({ initialFunds: (0.2).algos() })
    await addLabel(adminClient, adminAccount, label, labelName, labelUrl)
    await addOperatorToLabel(adminClient, operator, label)

    const operatorClient = adminClient.clone({
      defaultSender: operator,
      defaultSigner: operator.signer,
    })

    await addLabelToAsset(operatorClient, assetId, label)
    await expect(() => addLabelToAsset(operatorClient, assetId, label)).rejects.toThrow(/ERR:EXISTS/)
  })

  test('add non-existent label should fail', async () => {
    const { testAccount: adminAccount } = localnet.context
    const { adminClient } = await deploy(adminAccount)

    const label = 'wo'
    const labelName = 'world'
    const labelUrl = 'http://'
    const assetId = 13n

    const operator = await localnet.context.generateAccount({ initialFunds: (0.2).algos() })
    await addLabel(adminClient, adminAccount, label, labelName, labelUrl)
    await addOperatorToLabel(adminClient, operator, label)

    const operatorClient = adminClient.clone({
      defaultSender: operator,
      defaultSigner: operator.signer,
    })

    const nonLabel = 'oh'
    await expect(() => addLabelToAsset(adminClient, assetId, nonLabel)).rejects.toThrow(/ERR:UNAUTH/)
    await expect(() => addLabelToAsset(operatorClient, assetId, nonLabel)).rejects.toThrow(/ERR:UNAUTH/)
  })

  test('add label by non-operator should fail', async () => {
    const { testAccount: adminAccount } = localnet.context
    const { adminClient } = await deploy(adminAccount)

    const label = 'wo'
    const labelName = 'world'
    const labelUrl = 'http://'
    const assetId = 13n

    const operator = await localnet.context.generateAccount({ initialFunds: (0.2).algos() })
    await addLabel(adminClient, adminAccount, label, labelName, labelUrl)
    await addOperatorToLabel(adminClient, operator, label)

    await expect(() => addLabelToAsset(adminClient, assetId, label)).rejects.toThrow(/ERR:UNAUTH/)
  })

  test('has asset label should work', async () => {
    const { testAccount: adminAccount } = localnet.context
    const { adminClient } = await deploy(adminAccount)

    const label = 'wo'
    const labelName = 'world'
    const labelUrl = 'http://'
    const assetId = 13n
    const notAssetId = 14n

    const notLabel = 'ii'

    await addLabel(adminClient, adminAccount, label, labelName, labelUrl)
    await addOperatorToLabel(adminClient, adminAccount, label)
    await addLabelToAsset(adminClient, assetId, label)

    const hasLabelBigInt = await hasAssetLabel(adminClient, assetId, label)
    expect(hasLabelBigInt).toBe(1n)

    const noHasLabelBigInt = await hasAssetLabel(adminClient, assetId, notLabel)
    expect(noHasLabelBigInt).toBe(0n)

    const noHasLabelBigInt2 = await hasAssetLabel(adminClient, notAssetId, label)
    expect(noHasLabelBigInt2).toBe(0n)
  })

  test('remove label from asset', async () => {
    const { testAccount: adminAccount } = localnet.context
    const { adminClient } = await deploy(adminAccount)

    const label = 'wo'
    const labelName = 'world'
    const labelUrl = 'http://'
    const assetId = 13n

    const operator = await localnet.context.generateAccount({ initialFunds: (0.2).algos() })
    await addLabel(adminClient, adminAccount, label, labelName, labelUrl)
    await addOperatorToLabel(adminClient, operator, label)
    const operatorClient = adminClient.clone({
      defaultSender: operator,
      defaultSigner: operator.signer,
    })
    await addLabelToAsset(operatorClient, assetId, label)
    await removeLabelFromAsset(operatorClient, assetId, label)

    const labelDescriptor = await getLabelDescriptor(operatorClient, label)
    expect(labelDescriptor.numAssets).toBe(0n)

    const emptyLabels = await getAssetLabels(operatorClient, assetId)
    expect(emptyLabels).toEqual([])
  })

  test('remove non-existent label should fail', async () => {
    const { testAccount: adminAccount } = localnet.context
    const { adminClient } = await deploy(adminAccount)

    const label = 'wo'
    const labelName = 'world'
    const labelUrl = 'http://'
    const assetId = 13n

    const operator = await localnet.context.generateAccount({ initialFunds: (0.2).algos() })
    await addLabel(adminClient, adminAccount, label, labelName, labelUrl)
    await addOperatorToLabel(adminClient, operator, label)

    const operatorClient = adminClient.clone({
      defaultSender: operator,
      defaultSigner: operator.signer,
    })

    const nonLabel = 'oh'
    await expect(() => removeLabelFromAsset(adminClient, assetId, nonLabel)).rejects.toThrow(/ERR:NOEXIST/)
    await expect(() => removeLabelFromAsset(operatorClient, assetId, nonLabel)).rejects.toThrow(/ERR:NOEXIST/)
  })

  test('remove label with operator should fail', async () => {
    const { testAccount: adminAccount } = localnet.context
    const { adminClient } = await deploy(adminAccount)

    const label = 'wo'
    const labelName = 'world'
    const labelUrl = 'http://'
    const assetId = 13n

    const operator = await localnet.context.generateAccount({ initialFunds: (0.2).algos() })
    await addLabel(adminClient, adminAccount, label, labelName, labelUrl)
    await addOperatorToLabel(adminClient, operator, label)

    await expect(() => removeLabel(adminClient, label)).rejects.toThrow(/ERR:NOEMPTY/)
  })

  test('remove label by non-operator should fail', async () => {
    const { testAccount: adminAccount } = localnet.context
    const { adminClient } = await deploy(adminAccount)

    const label = 'wo'
    const labelName = 'world'
    const labelUrl = 'http://'
    const assetId = 13n

    const operator = await localnet.context.generateAccount({ initialFunds: (0.2).algos() })
    await addLabel(adminClient, adminAccount, label, labelName, labelUrl)
    await addOperatorToLabel(adminClient, operator, label)

    const operatorClient = adminClient.clone({
      defaultSender: operator,
      defaultSigner: operator.signer,
    })
    await addLabelToAsset(operatorClient, assetId, label)

    await expect(() => removeLabelFromAsset(adminClient, assetId, label)).rejects.toThrow(/ERR:UNAUTH/)
  })

  test('remove missing label from asset should fail', async () => {
    const { testAccount: adminAccount } = localnet.context
    const { adminClient } = await deploy(adminAccount)

    const label1 = 'wo'
    const label2 = 'wi'
    const labelName = 'world'
    const labelUrl = 'http://'
    const assetId = 13n

    const operator = await localnet.context.generateAccount({ initialFunds: (0.2).algos() })
    await addLabel(adminClient, adminAccount, label1, labelName, labelUrl)
    await addLabel(adminClient, adminAccount, label2, labelName, labelUrl)
    await addOperatorToLabel(adminClient, operator, label1)
    await addOperatorToLabel(adminClient, operator, label2)

    const operatorClient = adminClient.clone({
      defaultSender: operator,
      defaultSigner: operator.signer,
    })
    await addLabelToAsset(operatorClient, assetId, label1)

    await expect(() => removeLabelFromAsset(operatorClient, assetId, label2)).rejects.toThrow(/ERR:NOEXIST/)
  })

  test('add label to deleted asset should fail', async () => {
    const { testAccount: adminAccount, algorand } = localnet.context

    const {assetId} = await algorand.send.assetCreate({
      sender: adminAccount.addr,
      total: 1000000n, // Total units of the asset
      decimals: 0, // Number of decimals for the asset
      defaultFrozen: false, // Whether the asset is frozen by default
      manager: adminAccount.addr, // Address for the asset manager
      reserve: adminAccount.addr, // Address for storing reserve assets
      freeze: adminAccount.addr, // Address with freezing capabilities
      clawback: adminAccount.addr, // Address with clawback rights
      unitName: 'UNIT', // Unit name of the asset
      assetName: 'TestAsset', // Asset name
    })
    await algorand.send.assetDestroy({
      sender: adminAccount.addr,
      assetId
    })


    const { adminClient } = await deploy(adminAccount)
    const label = 'wo'
    const labelName = 'world'
    const labelUrl = 'http://'


    await addLabel(adminClient, adminAccount, label, labelName, labelUrl)
    const operator = await localnet.context.generateAccount({ initialFunds: (0.2).algos() })
    await addOperatorToLabel(adminClient, operator, label)
    const operatorClient = adminClient.clone({
      defaultSender: operator,
      defaultSigner: operator.signer,
    })
    // This should throw
    await expect(()=>addLabelToAsset(operatorClient, assetId, label)).rejects.toThrow(/ERR:NOEXIST/)
  })
})
