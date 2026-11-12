# Reproduction

Final worktree: /workspace/work/sqlite-incr-r3. Measurement paths retain the previous /workspace/Buyer-Log-Desktop/work/sqlite-incr-r3 location. Existing checkout left unchanged. Current Main merged normally; no 6a/6c branch commits used.

Official runtime archive:
https://github.com/electron/electron/releases/download/v44.3.0/electron-v44.3.0-linux-x64.zip
SHA256: 8b49b9efdd73c0f467edc3c1cd5678392c384ccf224f34ff54179f736e2f384b
Unpack under work/runtime/electron; runtime is work/runtime/electron/electron. No manifest/lock changes. Target is pinned by .github/installer/runtime.json. Product Electron backend uses process.execPath with ELECTRON_RUN_AS_NODE=1; target remains Electron 44.3.0, Node 24.20.0, SQLite 3.53.4. Host standard npm runner Node 24.19.0 is reported separately.

From worktree root:
```sh
mkdir -p work/scratch
export TMPDIR="$PWD/work/scratch"
export ELECTRON_RUN_AS_NODE=1
export BUYER_LOG_DATA_ROOT="$PWD/work/scratch/data/app"
export BUYER_LOG_LOCAL_DATA_ROOT="$PWD/work/scratch/data/local"
export BUYER_LOG_SERVER_DATA_ROOT="$PWD/work/scratch/data/server"
export BUYER_LOG_CONFIG_PATH="$PWD/work/scratch/data/config.json"
unset BUYER_LOG_TEMP_ROOT BUYER_LOG_AUTH_DATA_ROOT
runtime="$PWD/work/runtime/electron/electron"
out="$PWD/docs/performance/phase6-followup-20261109/sqlite/incr-r3"
for suite in contract-gates prototype compat-r2 incremental-r3; do
 flock /tmp/buyerlog-performance-measurement.lock "$runtime" --expose-gc --test --test-reporter=tap --test-isolation=none "scripts/prototypes/sqlite-decision-20261109/$suite.test.cjs"
done
flock /tmp/buyerlog-performance-measurement.lock "$runtime" --test --test-reporter=tap --test-concurrency=4 --test-isolation=none resources/app/tests/local-db*.test.js resources/app/tests/sync-ack-writers-v20261009.test.js resources/app/tests/sync-owner-lww-v20261009.test.js resources/app/tests/sync-bundle-idempotency.test.js resources/app/tests/sync-checkpoint-ack.test.js resources/app/tests/backup-v757.test.js resources/app/tests/backup-restore-worker-v20260922.test.js resources/app/tests/shared-personal-backup-v7088.test.js resources/app/tests/selective-backup-restore-v7148.test.js
(cd resources/app && flock /tmp/buyerlog-performance-measurement.lock npm test)
(cd resources/app && npm run i18n:check && npm run release:notes:validate)
flock /tmp/buyerlog-performance-measurement.lock "$runtime" "$out/audit-dml.cjs"
SQLITE_R3_AUDIT_ADAPTER="$out/r2-loader.cjs" flock /tmp/buyerlog-performance-measurement.lock "$runtime" --test --test-isolation=none scripts/prototypes/sqlite-decision-20261109/incremental-r3.test.cjs
# Above pinned R2 audit must FAIL; retained RED is expected, not acceptance.
for mode in A AA B; do
 flock /tmp/buyerlog-performance-measurement.lock "$runtime" scripts/prototypes/sqlite-decision-20261109/incr-r3-benchmark.cjs "$out/repro-$mode" "$mode" "$out/r2-loader.cjs"
done
```

Benchmark refuses existing output directories. A=R2/R3 (1k/10k), AA=R3/R3 (10k), B=Main JSON/WAL/R3 (10k/200k); each has three alternating fresh-process pairs, 300 original mixed operations, 630 added events. R2 source compiled verbatim from pinned Git blob; unchanged transition/workload dependencies proven by source hashes. JSON uses current Main production code and defaults. Scoped metadata Date/CLOCK ensures equal metadata; unrelated Date and Date.now remain real for lease/recovery; no fields removed. Full canonical envelope, every mutation/ACK receipt, independent business oracle, close/fresh-process reopen hashes are checked. Cold means fresh process with warm OS page cache, not dropped caches. Connection open recorded separately and added to ensure/full-state startup; API samples include commit. SQL all() materialized row/time and envelope stringify time/size instrumented equally. total_changes counts real DML without audit triggers in benchmarks. /proc/self/io includes temporary query I/O, not commit-only bytes; DB/WAL/SHM disk sizes are snapshots, not cumulative write totals. CPU/memory/event-loop mixed worker totals include harness/oracle overhead; per-API samples exclude separate canonical oracle hashing. GC snapshots supplement sampled peak heap and kernel peak RSS; they are distinct metrics.

20-minute child guard, seed batches 10000, operation count 300, concurrency one and production limits/durability unchanged. Full failed/partial invocations and source hashes retained; no partial result combined into a PASS. A mistakenly omitted mode was stopped and retained under invalid-invocation; pre-review-A belongs to earlier SHA and is excluded from final acceptance. invalid-clock-A froze lease time and is explicitly excluded; final source preserves real lease clock. No historical R3 numbers from the copied conversation are reused.

Final read-callback correction and its full repeated validation are on e791fa2b; measurements use 4991cff2, differing only in first-read/ensure timing fields in the benchmark worker. Both code identities and file hashes are recorded. The earlier complete A/AA and test logs are retained under read-regression-2581c655 and excluded from final results. Three additional 1k A/A pairs use aa-small.cjs and the identical final worker (same 300-operation trace and guard), to assess the existing small fixture rather than introduce a new workload.

## Explicit harness adaptations from the archived research worker

The archived worker checked business projection and used ensure → get → pendingCount → records for startup. The R3 acceptance requires the complete supported read envelope, receipt and ACK metadata. The new worker therefore times the same ensure → full read sequence on both arms, separates ensure/replay and first full read, and hashes the full envelope. It retains the original seed batches, synthetic event/query definitions, 300 mixed operation slots and 630 new events; the existing independent business oracle is an additional check, not a substitute for metadata. Three repeated full reads plus upload, single ACK and ACK-through are added equally to both arms because R3 explicitly requires those supported operations. Full-state/receipt hashes, native I/O and bounded DML diagnostics are new evidence; no archived timing is relabelled.

The archived quiescent backup helper is not promoted to an equivalent production backup/retention guarantee. No unsupported backup API is added to the R2 slice. Disk-family snapshots are measured, while equivalent automated backup/restore/retention and platform durability acceptance remain BLOCKED. This limitation is explicit rather than claiming that a smaller SQLite file closes the backup gate.

Final delivery integrated Main 4dab3493 normally after measurement Main 2b7762ef. The complete resources/app/server tree, package/lock, runtime manifest and prototype/test bytes are identical. Only Horizon UI/acceptance and CI selection changed. Final targeted and complete npm/i18n/note validation were repeated on the integrated head; prior validation remains under pre-final-main-validation. No measurements were relabelled: measured Main and final Main are both recorded.
