# Reproduction / komutlar

All commands from repository root unless stated. Official Electron binary is
outside the repository. `ELECTRON_RUN_AS_NODE=1` matches the product backend
launcher (`resources/app/electron/backend.js`, spawn(process.execPath)).
Official download: electron/electron v44.3.0, electron-v44.3.0-linux-x64.zip;
SHA256 checked against that release's SHASUMS256.txt. See source-identity.json.

```sh
flock /tmp/buyerlog-performance-measurement.lock env ELECTRON_RUN_AS_NODE=1 \
 /tmp/buyerlog-electron-44.3.0/electron --expose-gc \
 scripts/prototypes/sqlite-decision-20261109/benchmark.cjs \
 --out docs/performance/phase6-followup-20261109/sqlite/run-2 \
 --sizes 10000,200000 --rounds 3 --operations 300
```

The output directory must not already exist; use a new suffix for reproduction.
`benchmark-1.log` is a retained sandbox startup failure, not a valid trial.
Fresh-process/cached-process timings use the same warm OS page-cache condition.
No cache-drop or cold-disk claim. No A/A noise exemption and no performance PASS
for the incomplete adapter. p95 uses each run's actual 30+ observations per kind;
three run medians are not treated as p95 samples.

```sh
# Under the same global lock, sequentially after benchmarking:
cd resources/app
npm ci --ignore-scripts --no-audit --no-fund  # lock unchanged
npm test  # unfiltered tests/run-tests.js, default concurrency=4, host Node 24.19.0
cd ../..
ELECTRON_RUN_AS_NODE=1 /tmp/buyerlog-electron-44.3.0/electron \
 --test --test-isolation=none scripts/prototypes/sqlite-decision-20261109/prototype.test.cjs
ELECTRON_RUN_AS_NODE=1 /tmp/buyerlog-electron-44.3.0/electron \
 --test --test-isolation=none scripts/prototypes/sqlite-decision-20261109/contract-gates.test.cjs
ELECTRON_RUN_AS_NODE=1 /tmp/buyerlog-electron-44.3.0/electron \
 scripts/prototypes/sqlite-decision-20261109/boundary-probes.cjs \
 docs/performance/phase6-followup-20261109/sqlite/boundaries.json
```

Related official-runtime tests use `--test --test-concurrency=4 --test-isolation=none`
and these files (actual TAP/exit code retained):

- resources/app/tests/local-db*.test.js
- sync-ack-writers-v20261009, sync-owner-lww-v20261009,
  sync-bundle-idempotency, sync-checkpoint-ack
- backup-v757, backup-restore-worker-v20260922, shared-personal-backup-v7088,
  selective-backup-restore-v7148 (all under resources/app/tests/, .test.js suffix)

`--test-isolation=none` exposes individual tests in Electron's embedded Node
runner; the standard npm runner is unchanged. Also run from resources/app:
`npm run i18n:check`, `npm run release:notes:validate`.

```sh
node scripts/prototypes/sqlite-decision-20261109/validate-evidence.cjs \
 docs/performance/phase6-followup-20261109/sqlite/run-2/raw.json
node scripts/prototypes/sqlite-decision-20261109/fixture-hashes.cjs \
 docs/performance/phase6-followup-20261109/sqlite/fixture-hashes.json
node scripts/prototypes/sqlite-decision-20261109/summarize.cjs \
 docs/performance/phase6-followup-20261109/sqlite/run-2/raw.json
```

No product/UI behavior changes: release note, bilingual UI additions and real
post-change PNG are N/A. Existing i18n/notes checks still apply. The final tagged
report belongs only in #952; files here retain reproducible evidence.
