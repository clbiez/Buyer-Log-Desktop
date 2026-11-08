#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.."
if [[ "${1:-}" != --locked ]]; then
  exec flock -n -E 75 /tmp/buyerlog-performance-measurement.lock bash scripts/prototypes/int03-pipeline-adapter-20261108/check.sh --locked
fi
export NODE_PATH="${NODE_PATH:-/workspace/.buyerlog-tools/node_modules}"
int03_scratch="$PWD/scripts/prototypes/int03-pipeline-adapter-20261108/.scratch/native"
int03_docs="$PWD/docs/performance-program/contrib-int03-pipeline-adapter-20261108"
mkdir -p "$int03_scratch"/{server,local,app,tmp}
export BUYER_LOG_SERVER_DATA_ROOT="$int03_scratch/server"
export BUYER_LOG_DATA_ROOT="$int03_scratch/app"
export BUYER_LOG_LOCAL_DATA_ROOT="$int03_scratch/local"
export BUYER_LOG_TEMP_ROOT="$int03_scratch/tmp"
export BUYER_LOG_CONFIG_PATH="$int03_scratch/config.json"
export BUYER_LOG_LOCAL_DB="$int03_scratch/local/BuyerLogLocal.db"
node --test scripts/prototypes/int03-pipeline-adapter-20261108/adapter.test.js scripts/prototypes/int03-pipeline-adapter-20261108/node-transport.test.js > "$int03_docs/green-final-2.txt" 2>&1
node scripts/prototypes/int03-pipeline-adapter-20261108/inherited-checks.js > "$int03_docs/inherited-runner.txt" 2>&1
cd resources/app
node tests/run-tests.js plm-image collection-image-canonical collection-plm-images-persistence-export plm-resume-checkpoint revision-v476 > "$int03_docs/native-tests.txt" 2>&1
npm run i18n:check > "$int03_docs/i18n.txt" 2>&1
node --test tests/i18n-coverage-guard.test.js > "$int03_docs/i18n-guard.txt" 2>&1
