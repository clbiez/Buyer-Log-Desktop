# R2 reproduction

Repository root: /workspace/sqlite-compat-r2. Runtime binary outside repository:
/tmp/buyerlog-electron-44.3.0/electron, official ZIP SHA256 recorded in plan.md.
All prototype/related commands below use ELECTRON_RUN_AS_NODE=1 and local overlay
TMPDIR=$PWD/scripts/prototypes/sqlite-decision-20261109/.scratch. Create it first.
Each command is wrapped by flock /tmp/buyerlog-performance-measurement.lock.

```
$electron --test --test-reporter=tap --test-isolation=none scripts/prototypes/sqlite-decision-20261109/contract-gates.test.cjs
$electron --test --test-reporter=tap --test-isolation=none scripts/prototypes/sqlite-decision-20261109/prototype.test.cjs
SQLITE_COMPAT_TRACE_OUT=$PWD/docs/performance/phase6-followup-20261109/sqlite/compat-r2/fixture-traces.json \
 $electron --expose-gc --test --test-reporter=tap --test-isolation=none scripts/prototypes/sqlite-decision-20261109/compat-r2.test.cjs
$electron --test --test-reporter=tap --test-concurrency=4 --test-isolation=none \
 resources/app/tests/local-db*.test.js \
 resources/app/tests/sync-ack-writers-v20261009.test.js \
 resources/app/tests/sync-owner-lww-v20261009.test.js \
 resources/app/tests/sync-bundle-idempotency.test.js \
 resources/app/tests/sync-checkpoint-ack.test.js \
 resources/app/tests/backup-v757.test.js \
 resources/app/tests/backup-restore-worker-v20260922.test.js \
 resources/app/tests/shared-personal-backup-v7088.test.js \
 resources/app/tests/selective-backup-restore-v7148.test.js
cd resources/app
flock /tmp/buyerlog-performance-measurement.lock npm test
npm run i18n:check
npm run release:notes:validate
```

$electron denotes /tmp/buyerlog-electron-44.3.0/electron. Host Node for the
unmodified standard npm runner is 24.19.0, separate from Electron Node 24.20.0.
node_modules is an ignored symlink to the preinstalled original checkout's
matching dependency tree; manifests/locks are unchanged. No dependency install.
No filters/concurrency overrides on npm test. Retain complete failed/success
logs; do not combine batch fragments. Exact source SHA/hashes, exit codes,
runtime/FS and results recorded in validation.json and source-identity.json.
No new large benchmark, migration, production pilot, PR merge or publication.
