#!/bin/sh
set -eu
# Caller: env -u NODE_OPTIONS -u NODE_PATH flock -n -E 75 <shared lock> sh <this>
cd "$(dirname "$0")/../../.."
evidence=docs/performance-program/contrib-int06-bounded-snapshot-20261108
test ! -e "$evidence/native.tap"
test ! -e "$evidence/i18n.log"
data_root=$(mktemp -d /tmp/buyerlog-int06-bounded-data-XXXXXX)
trap 'rm -rf "$data_root"' EXIT
mkdir "$data_root/server"
export BUYER_LOG_DATA_ROOT="$data_root"
export BUYER_LOG_SERVER_DATA_ROOT="$data_root/server"
node --test --test-concurrency=1 --test-reporter=tap \
  resources/app/tests/int06-checkpoint-journal-*.test.js \
  resources/app/tests/power-bi-import-dashboard.test.js \
  resources/app/tests/powerbi-dashboard-schema-wait-v912.test.js \
  resources/app/tests/durable-async-prior-intent.test.js \
  resources/app/tests/i18n-coverage-guard.test.js \
  > "$evidence/native.tap" 2>&1
(cd resources/app && npm run i18n:check) > "$evidence/i18n.log" 2>&1
