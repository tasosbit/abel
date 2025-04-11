from algopy import (
    Account,
    ARC4Contract,
    Asset,
    BoxMap,
    Bytes,
    Global,
    String,
    Txn,
    UInt64,
    arc4,
    log,
    op,
    subroutine,
    uenumerate,
)
from algopy.arc4 import abimethod

from .types import (
    AssetFull,
    AssetMicro,
    AssetMicroLabels,
    AssetSmall,
    AssetText,
    AssetTextLabels,
    AssetTiny,
    AssetTinyLabels,
    LabelDescriptor,
    LabelList,
    S,
)

# constants used to return from index-finding functions. zero is a truthy return, so:
NOT_FOUND_KEY = (
    2**32
)  # magic constant for "list not found" (e.g. box key missing entirely)
NOT_FOUND_VALUE = 2**32 - 1  # magic constant for "value not found in list"


@subroutine
def ensure(cond: bool, msg: String) -> None:  # noqa: FBT001
    if not cond:
        log(msg)
        op.err()


@subroutine
def empty_list() -> LabelList:
    return arc4.DynamicArray[arc4.String]()


@subroutine
def b2str(b: Bytes) -> arc4.String:
    return arc4.String(String.from_bytes(b))


@subroutine
def asset_is_deleted(asset_id: UInt64) -> bool:
    _v, exists = op.AssetParamsGet.asset_creator(asset_id)
    return not exists


class AssetLabeling(ARC4Contract):
    def __init__(self) -> None:
        self.admin = Txn.sender
        self.labels = BoxMap(String, LabelDescriptor, key_prefix=b"")
        # TODO does this need to be an asset? Uint64 could be better
        self.assets = BoxMap(Asset, LabelList, key_prefix=b"")
        self.operators = BoxMap(Account, LabelList, key_prefix=b"")

    @arc4.baremethod(allow_actions=("UpdateApplication",))
    def update(self) -> None:
        self.admin_only()

    @arc4.baremethod(allow_actions=("DeleteApplication",))
    def delete(self) -> None:
        self.admin_only()

    @subroutine
    def admin_only(self) -> None:
        ensure(Txn.sender == self.admin, S("ERR:UNAUTH"))

    @abimethod()
    def change_admin(self, new_admin: Account) -> None:
        self.admin_only()
        self.admin = new_admin

    @abimethod()
    def add_label(self, id: String, name: String, url: String) -> None:  # noqa A002
        self.admin_only()
        ensure(id not in self.labels, S("ERR:EXISTS"))
        ensure(id.bytes.length == 2, S("ERR:LENGTH"))
        self.labels[id] = LabelDescriptor(
            arc4.String(name),
            arc4.String(url),
            arc4.UInt64(0),
            arc4.UInt64(0),
        )

    @abimethod(readonly=True)
    def has_label(self, id: String) -> UInt64:  # noqa A002
        ensure(id.bytes.length == 2, S("ERR:LENGTH"))
        return UInt64(id in self.labels)

    @abimethod()
    def change_label(self, id: String, name: String, url: String) -> None:  # noqa A002
        self.admin_only()
        ensure(id in self.labels, S("ERR:NOEXIST"))
        label_descriptor = self.labels[id].copy()
        label_descriptor.name = arc4.String(name)
        label_descriptor.url = arc4.String(url)
        self.labels[id] = label_descriptor.copy()

    @abimethod()
    def remove_label(self, id: String) -> None:  # noqa A002
        self.admin_only()
        ensure(id in self.labels, S("ERR:NOEXIST"))
        ensure(self.labels[id].num_operators == 0, S("ERR:NOEMPTY"))
        ensure(self.labels[id].num_assets == 0, S("ERR:NOEMPTY"))
        del self.labels[id]

    @abimethod(readonly=True)
    def get_label(self, id: String) -> LabelDescriptor:  # noqa A002
        ensure(id in self.labels, S("ERR:NOEXIST"))
        return self.labels[id]

    @abimethod(readonly=True)
    def log_labels(self, ids: arc4.DynamicArray[arc4.String]) -> None:
        for _idx, label_id in uenumerate(ids):
            log(self.labels[label_id.native])

    # TODO change label names?

    # operator<>label access ops. admin and operators

    @subroutine
    def admin_or_operator_only(self, label: String) -> None:
        if Txn.sender == self.admin:
            return
        self.operator_only(label)

    @subroutine
    def operator_only(self, label: String) -> None:
        operator_index = self.get_operator_label_index(Txn.sender, label)
        ensure(
            operator_index != UInt64(NOT_FOUND_KEY)
            and operator_index != UInt64(NOT_FOUND_VALUE),
            S("ERR:UNAUTH"),
        )

    @subroutine
    def get_operator_label_index(self, operator: Account, label: String) -> UInt64:
        if operator not in self.operators:
            return UInt64(NOT_FOUND_KEY)
        for idx, stored_label in uenumerate(self.operators[operator]):
            if stored_label == label:
                return idx
        return UInt64(NOT_FOUND_VALUE)

    @abimethod()
    def add_operator_to_label(self, operator: Account, label: String) -> None:
        self.admin_or_operator_only(label)
        ensure(label in self.labels, S("ERR:NOEXIST"))
        # check if operator exists already
        if operator in self.operators:
            # existing operator, check for duplicate
            ensure(
                self.get_operator_label_index(operator, label)
                == UInt64(NOT_FOUND_VALUE),
                S("ERR:EXISTS"),
            )

            # add label to operator
            existing = self.operators[operator].copy()
            existing.append(arc4.String(label))
            self.operators[operator] = existing.copy()
        else:
            # new operator, create new box
            self.operators[operator] = arc4.DynamicArray(arc4.String(label))

        # increment label operators
        label_descriptor = self.labels[label].copy()
        label_descriptor.num_operators = arc4.UInt64(
            label_descriptor.num_operators.native + UInt64(1)
        )
        self.labels[label] = label_descriptor.copy()

    @abimethod(readonly=True)
    def has_operator_label(self, operator: Account, label: String) -> UInt64:
        ensure(label.bytes.length == 2, S("ERR:LENGTH"))
        idx = self.get_operator_label_index(operator, label)
        return UInt64(idx != NOT_FOUND_KEY and idx != NOT_FOUND_VALUE)

    @abimethod()
    def remove_operator_from_label(self, operator: Account, label: String) -> None:
        self.admin_or_operator_only(label)

        ensure(label in self.labels, S("ERR:NOEXIST"))
        ensure(operator in self.operators, S("ERR:NOEXIST"))

        # ensure label exists in operator
        label_idx = self.get_operator_label_index(operator, label)
        ensure(
            label_idx != UInt64(NOT_FOUND_VALUE)
            and label_idx
            != UInt64(NOT_FOUND_KEY),  # key check redundant, checked above
            S("ERR:NOEXIST"),
        )

        # ensure only empty labels can be left operator-less
        label_descriptor = self.labels[label].copy()
        ensure(
            label_descriptor.num_operators > 1 or label_descriptor.num_assets == 0,
            S("ERR:NOEMPTY"),
        )
        # decr operator count
        label_descriptor.num_operators = arc4.UInt64(
            label_descriptor.num_operators.native - UInt64(1)
        )
        self.labels[label] = label_descriptor.copy()

        if self.operators[operator].length == 1:
            del self.operators[operator]
        else:
            next_list = arc4.DynamicArray[arc4.String]()
            # walk, push everything except index
            # this implementation walks twice (once in get_operator_label_index)
            # could be more efficient
            for idx, stored_label in uenumerate(self.operators[operator]):
                if label_idx != idx:
                    next_list.append(stored_label)

            self.operators[operator] = next_list.copy()

    @abimethod(readonly=True)
    def get_operator_labels(self, operator: Account) -> LabelList:
        if operator in self.operators:
            return self.operators[operator]
        # return empty list
        return empty_list()

    @subroutine
    def get_asset_label_index(self, asset: Asset, label: String) -> UInt64:
        ensure(label.bytes.length == 2, S("ERR:LENGTH"))
        if asset not in self.assets:
            return UInt64(NOT_FOUND_KEY)
        for idx, stored_label in uenumerate(self.assets[asset]):
            if stored_label == label:
                return idx
        return UInt64(NOT_FOUND_VALUE)

    @subroutine
    def _add_label_to_asset(self, label: String, asset: Asset) -> None:
        ensure(not asset_is_deleted(asset.id), S("ERR:NOEXIST"))
        ensure(label in self.labels, S("ERR:NOEXIST"))
        if asset in self.assets:
            # existing operator, check for duplicate
            ensure(
                self.get_asset_label_index(asset, label) == UInt64(NOT_FOUND_VALUE),
                S("ERR:EXISTS"),
            )
            # add label to asset
            existing = self.assets[asset].copy()
            existing.append(arc4.String(label))
            self.assets[asset] = existing.copy()
        else:
            # new asset, create new box
            self.assets[asset] = arc4.DynamicArray(arc4.String(label))

        # incr asset count
        label_descriptor = self.labels[label].copy()
        label_descriptor.num_assets = arc4.UInt64(
            label_descriptor.num_assets.native + UInt64(1)
        )
        self.labels[label] = label_descriptor.copy()

    @abimethod()
    def add_label_to_asset(self, label: String, asset: Asset) -> None:
        self.operator_only(label)
        self._add_label_to_asset(label, asset)

    @abimethod()
    def add_label_to_assets(
        self, label: String, assets: arc4.DynamicArray[arc4.UInt64]
    ) -> None:
        self.operator_only(label)
        for _i, asset in uenumerate(assets):
            self._add_label_to_asset(label, Asset(asset.native))

    @abimethod()
    def remove_label_from_asset(self, label: String, asset: Asset) -> None:
        ensure(label in self.labels, S("ERR:NOEXIST"))

        self.operator_only(label)

        found = False
        if self.assets[asset].length == 1:
            if self.assets[asset][0] == label:
                del self.assets[asset]
                found = True
            else:
                found = False
        else:
            next_list = arc4.DynamicArray[arc4.String]()
            # walk, push everything to new box except label
            # save $found to throw if not found
            for _idx, stored_label in uenumerate(self.assets[asset]):
                if stored_label != label:
                    next_list.append(stored_label)
                else:
                    found = True

            self.assets[asset] = next_list.copy()

        ensure(found, S("ERR:NOEXIST"))

        # decr asset count
        label_descriptor = self.labels[label].copy()
        label_descriptor.num_assets = arc4.UInt64(
            label_descriptor.num_assets.native - UInt64(1)
        )
        self.labels[label] = label_descriptor.copy()

    @abimethod(readonly=True)
    def has_asset_label(self, asset_id: UInt64, label: String) -> UInt64:
        asset = Asset(asset_id)
        idx = self.get_asset_label_index(asset, label)
        if idx != NOT_FOUND_KEY and idx != NOT_FOUND_VALUE:
            return UInt64(1)
        return UInt64(0)

    @abimethod(readonly=True)
    def get_asset_labels(self, asset: Asset) -> LabelList:
        if asset in self.assets:
            return self.assets[asset]
        # return empty
        return empty_list()

    @abimethod(readonly=True)
    def get_assets_labels(
        self, assets: arc4.DynamicArray[arc4.UInt64]
    ) -> arc4.DynamicArray[LabelList]:
        out = arc4.DynamicArray[LabelList]()
        for _i, asset_id in uenumerate(assets):
            asset = Asset(asset_id.native)
            if asset in self.assets:
                out.append(self.assets[asset].copy())
            else:
                out.append(empty_list())
        return out

    @abimethod(readonly=True)
    def log_assets_labels(self, assets: arc4.DynamicArray[arc4.UInt64]) -> None:
        for _i, asset_id in uenumerate(assets):
            asset = Asset(asset_id.native)
            if asset in self.assets:
                log(self.assets[asset])
            else:
                log(empty_list())

    #
    # Batch asset data fetch methods
    #

    # Micro: Unit Name, Decimals (1 ref, max 128)

    @subroutine
    def _get_asset_micro(self, asset_id: UInt64) -> AssetMicro:
        if asset_is_deleted(asset_id):
            return AssetMicro.from_bytes(b"")
        asset = Asset(asset_id)
        return AssetMicro(
            unit_name=b2str(asset.unit_name),
            decimals=arc4.UInt8(asset.decimals),
        )

    @abimethod(readonly=True)
    def get_asset_micro(self, asset: UInt64) -> AssetMicro:
        return self._get_asset_micro(asset)

    @abimethod(readonly=True)
    def get_assets_micro(self, assets: arc4.DynamicArray[arc4.UInt64]) -> None:
        for _i, asset_id in uenumerate(assets):
            log(self._get_asset_micro(asset_id.native))

    # Micro+Label: Unit Name, Decimals, Labels (2 refs, max 64)

    @subroutine
    def _get_asset_micro_labels(self, asset_id: UInt64) -> AssetMicroLabels:
        if asset_is_deleted(asset_id):
            return AssetMicroLabels.from_bytes(b"")
        asset = Asset(asset_id)
        return AssetMicroLabels(
            unit_name=b2str(asset.unit_name),
            decimals=arc4.UInt8(asset.decimals),
            labels=self.assets[asset].copy() if asset in self.assets else empty_list(),
        )

    @abimethod(readonly=True)
    def get_asset_micro_labels(self, asset: UInt64) -> AssetMicroLabels:
        return self._get_asset_micro_labels(asset)

    @abimethod(readonly=True)
    def get_assets_micro_labels(self, assets: arc4.DynamicArray[arc4.UInt64]) -> None:
        for _i, asset_id in uenumerate(assets):
            log(self._get_asset_micro_labels(asset_id.native))

    # Tiny: name+unit+decimals (1 ref, 128 max)

    @subroutine
    def _get_asset_tiny(self, asset_id: UInt64) -> AssetTiny:
        if asset_is_deleted(asset_id):
            return AssetTiny.from_bytes(b"")
        asset = Asset(asset_id)
        return AssetTiny(
            name=b2str(asset.name),
            unit_name=b2str(asset.unit_name),
            decimals=arc4.UInt8(asset.decimals),
        )

    @abimethod(readonly=True)
    def get_asset_tiny(self, asset: UInt64) -> AssetTiny:
        return self._get_asset_tiny(asset)

    @abimethod(readonly=True)
    def get_assets_tiny(self, assets: arc4.DynamicArray[arc4.UInt64]) -> None:
        for _i, asset_id in uenumerate(assets):
            log(self._get_asset_tiny(asset_id.native))

    # Tiny+Label: Name, Unit Name, Decimals, Labels (2 refs, max 64)

    @subroutine
    def _get_asset_tiny_labels(self, asset_id: UInt64) -> AssetTinyLabels:
        if asset_is_deleted(asset_id):
            return AssetTinyLabels.from_bytes(b"")
        asset = Asset(asset_id)
        return AssetTinyLabels(
            name=b2str(asset.name),
            unit_name=b2str(asset.unit_name),
            decimals=arc4.UInt8(asset.decimals),
            labels=self.assets[asset].copy() if asset in self.assets else empty_list(),
        )

    @abimethod(readonly=True)
    def get_asset_tiny_labels(self, asset: UInt64) -> AssetTinyLabels:
        return self._get_asset_tiny_labels(asset)

    @abimethod(readonly=True)
    def get_assets_tiny_labels(self, assets: arc4.DynamicArray[arc4.UInt64]) -> None:
        for _i, asset_id in uenumerate(assets):
            log(self._get_asset_tiny_labels(asset_id.native))

    # Text: Searchable - Asset name, Unit Name, URL (1 ref, max 128)

    @subroutine
    def _get_asset_text(self, asset_id: UInt64) -> AssetText:
        if asset_is_deleted(asset_id):
            return AssetText.from_bytes(b"")
        asset = Asset(asset_id)
        return AssetText(
            name=b2str(asset.name),
            unit_name=b2str(asset.unit_name),
            url=b2str(asset.url),
        )

    @abimethod(readonly=True)
    def get_asset_text(self, asset: UInt64) -> AssetText:
        return self._get_asset_text(asset)

    @abimethod(readonly=True)
    def get_assets_text(self, assets: arc4.DynamicArray[arc4.UInt64]) -> None:
        for _i, asset_id in uenumerate(assets):
            log(self._get_asset_text(asset_id.native))

    # TextLabels: Searchable - Asset name, Unit Name, URL, Labels (2 refs, max 64)

    @subroutine
    def _get_asset_text_labels(self, asset_id: UInt64) -> AssetTextLabels:
        if asset_is_deleted(asset_id):
            return AssetTextLabels.from_bytes(b"")
        asset = Asset(asset_id)
        return AssetTextLabels(
            name=b2str(asset.name),
            unit_name=b2str(asset.unit_name),
            url=b2str(asset.url),
            labels=self.assets[asset].copy() if asset in self.assets else empty_list(),
        )

    @abimethod(readonly=True)
    def get_asset_text_labels(self, asset: UInt64) -> AssetTextLabels:
        return self._get_asset_text_labels(asset)

    @abimethod(readonly=True)
    def get_assets_text_labels(self, assets: arc4.DynamicArray[arc4.UInt64]) -> None:
        for _i, asset_id in uenumerate(assets):
            log(self._get_asset_text_labels(asset_id.native))

    # small (2 refs, max 64)

    @subroutine
    def _get_asset_small(self, asset_id: UInt64) -> AssetSmall:
        if asset_is_deleted(asset_id):
            return AssetSmall.from_bytes(b"")
        asset = Asset(asset_id)
        return AssetSmall(
            name=b2str(asset.name),
            unit_name=b2str(asset.unit_name),
            decimals=arc4.UInt8(asset.decimals),
            total=arc4.UInt64(asset.total),
            has_freeze=arc4.Bool(asset.freeze != Global.zero_address),
            has_clawback=arc4.Bool(asset.clawback != Global.zero_address),
            labels=self.assets[asset].copy() if asset in self.assets else empty_list(),
        )

    @abimethod(readonly=True)
    def get_asset_small(self, asset: UInt64) -> AssetSmall:
        return self._get_asset_small(asset)

    @abimethod(readonly=True)
    def get_assets_small(self, assets: arc4.DynamicArray[arc4.UInt64]) -> None:
        for _i, asset_id in uenumerate(assets):
            log(self._get_asset_small(asset_id.native))

    # full (3 refs, max 42)

    @subroutine
    def _get_asset_full(self, asset_id: UInt64) -> AssetFull:
        if asset_is_deleted(asset_id):
            return AssetFull.from_bytes(b"")
        asset = Asset(asset_id)
        reserve_acct = Account(asset.reserve.bytes)
        reserve_balance = (
            asset.balance(reserve_acct)
            if reserve_acct.is_opted_in(asset)
            else UInt64(0)
        )
        return AssetFull(
            name=b2str(asset.name),
            unit_name=b2str(asset.unit_name),
            url=b2str(asset.url),
            total=arc4.UInt64(asset.total),
            decimals=arc4.UInt8(asset.decimals),
            creator=arc4.Address(asset.creator),
            manager=arc4.Address(asset.manager),
            freeze=arc4.Address(asset.freeze),
            clawback=arc4.Address(asset.clawback),
            reserve=arc4.Address(asset.reserve),
            default_frozen=arc4.Bool(asset.default_frozen),
            reserve_balance=arc4.UInt64(reserve_balance),
            metadata_hash=arc4.DynamicBytes(asset.metadata_hash),
            labels=self.assets[asset].copy() if asset in self.assets else empty_list(),
        )

    @abimethod(readonly=True)
    def get_asset_full(self, asset: UInt64) -> AssetFull:
        return self._get_asset_full(asset)

    @abimethod(readonly=True)
    def get_assets_full(self, assets: arc4.DynamicArray[arc4.UInt64]) -> None:
        for _i, asset_id in uenumerate(assets):
            log(self._get_asset_full(asset_id.native))
