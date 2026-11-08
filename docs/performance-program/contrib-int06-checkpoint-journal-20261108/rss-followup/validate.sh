#!/bin/sh
set -eu
# Invoke from anywhere, enclosed by the common flock -n -E 75.
cd "$(dirname "$0")/../../../.."
evidence=docs/performance-program/contrib-int06-checkpoint-journal-20261108/rss-followup
test ! -e "$evidence/native.tap"
test ! -e "$evidence/i18n.log"
node --test --test-concurrency=1 --test-reporter=tap \
  resources/app/tests/int06-checkpoint-journal-*.test.js \
  resources/app/tests/power-bi-import-dashboard.test.js \
  resources/app/tests/powerbi-dashboard-schema-wait-v912.test.js \
  resources/app/tests/durable-async-prior-intent.test.js \
  > "$evidence/native.tap" 2>&1
(cd resources/app && npm run i18n:check) > "$evidence/i18n.log" 2>&1
