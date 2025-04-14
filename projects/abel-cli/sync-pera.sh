#!/usr/bin/env bash

set -eo pipefail

cd $(dirname $(realpath $0))

echo $(date) Started

rm data/verified.json

npx tsx scripts/download-pera-verified.ts

echo $(date) "Syncing to chain"

ENV=op npx tsx src/scripts/sync-json-to-pv.ts data/verified.json

echo $(date) Finished
