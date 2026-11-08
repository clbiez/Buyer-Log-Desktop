#!/usr/bin/env bash
# Run AFTER the plain/observational trials, under the outer shared flock.
set -euo pipefail
cd "$(dirname "$0")/../../.."
diag_node22="${DIAG_NODE22:-/workspace/.buyerlog-tools/node_modules/node/bin/node}"
diag_node24="${DIAG_NODE24:-node}"
diag_scripts=scripts/prototypes/shared-lease-lost-20261108
diag_docs=docs/performance-program/shared-lease-lost-20261108
for diag_scenario in completion-race contention active-before-write active-after-fsync; do
  "$diag_node22" "$diag_scripts/scenarios.cjs" "node22-$diag_scenario" "$diag_scenario" \
    > "$diag_docs/node22-$diag_scenario.driver.stdout.log" \
    2> "$diag_docs/node22-$diag_scenario.driver.stderr.log"
done
"$diag_node24" "$diag_scripts/run.cjs" node24-plain-200k 200000 plain \
  > "$diag_docs/node24-plain-200k.driver.stdout.log" 2> "$diag_docs/node24-plain-200k.driver.stderr.log"
"$diag_node24" "$diag_scripts/scenarios.cjs" node24-completion-race completion-race \
  > "$diag_docs/node24-completion-race.driver.stdout.log" 2> "$diag_docs/node24-completion-race.driver.stderr.log"

# Existing assertions/validators are used without edits. All fixture paths are
# synthetic, with an extra outer data root for modules that read env defaults.
diag_tests_root="$(mktemp -d /tmp/buyerlog-shared-lease-tests-XXXXXX)"
mkdir -p "$diag_tests_root/tmp"
export TMPDIR="$diag_tests_root/tmp"
export BUYER_LOG_SERVER_DATA_ROOT="$diag_tests_root/server"
export BUYER_LOG_LOCAL_DATA_ROOT="$diag_tests_root/local"
export BUYER_LOG_DATA_ROOT="$diag_tests_root/app"
export BUYER_LOG_CONFIG_PATH="$diag_tests_root/config.json"
"$diag_node22" --test --test-concurrency=1 \
  resources/app/tests/file-lease-async-io.test.js \
  resources/app/tests/file-lease-context-lifetime.test.js \
  resources/app/tests/file-lease-integrity.test.js \
  resources/app/tests/file-lease-request-policy.test.js \
  resources/app/tests/shared-lease-corrupt-owner-v20261009.test.js \
  resources/app/tests/single-instance-lease-concurrency.test.js \
  resources/app/tests/local-db-business-integrity.test.js \
  resources/app/tests/local-db-compaction.test.js \
  resources/app/tests/local-db-crash-recovery.test.js \
  resources/app/tests/local-db-hlc-v20261009.test.js \
  resources/app/tests/local-db-wal-metadata.test.js \
  resources/app/tests/local-db-wal-tail-recovery.test.js \
  resources/app/tests/local-db-wal-v807.test.js \
  resources/app/tests/agent-instructions.test.js \
  resources/app/tests/i18n-coverage-guard.test.js \
  > "$diag_docs/targeted-tests.tap" 2> "$diag_docs/targeted-tests.stderr.log"
(
  cd resources/app
  PATH="$(dirname "$diag_node22"):$PATH" npm run i18n:check
) > "$diag_docs/i18n.stdout.log" 2> "$diag_docs/i18n.stderr.log"
for diag_file in "$diag_scripts"/*.cjs; do "$diag_node22" --check "$diag_file"; done
"$diag_node22" "$diag_scripts/check-timelines.cjs" > "$diag_docs/timeline-checks.stdout.log" 2> "$diag_docs/timeline-checks.stderr.log"
