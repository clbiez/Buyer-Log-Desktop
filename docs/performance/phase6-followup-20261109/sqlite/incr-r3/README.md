# SQLITE-INCR-R3 — BLOCKED

Production decision: **WAIT**. Existing PR #958 remains draft. This report separates bounded SQL correctness, R2 performance and Main performance. No production adapter, merge, release, shadow/dual write, pilot or migration.

Sources: Main `2b7762ef60e7b17a0e581e0eca57078783080f7f`; compatible R2 `4ac2ed4847ce4c3af32bc82d13681b101d749d20`; measured code `4991cff2d669d776566f8506670ad0b2d72f47eb`; validation adapter/tests `b29941e484e3ac2d2d2ec29e94dac386dfb01106`. Final integrated Main is recorded separately in source-identity.json: its entire server/runtime/dependency source is byte-identical to measurement Main; only Horizon UI/acceptance and fast-check selection changed. Final integrated tests are repeated. Final evidence-only delivery head and its real CI are linked in the sole final #952 comment.

| Decision | Result |
| --- | --- |
| Incremental SQL + preserved supported compatibility | PASS |
| R2 → R3 performance | BLOCKED |
| Main → R3 performance, 10k | FAIL |
| Main → R3 performance, 200k | FAIL |
| Production adoption | WAIT |

Strong repeatable single/batch/ACK/mixed CPU and process-I/O improvement; however the 1k filter trial-median paired shifts remain +0.0078/+0.0018/+0.0053 ms. Same-source 1k A/A shifts -0.005/-0.015/-0.000 ms do not establish that this candidate-positive pattern is solely noise. No automatic percentage or broad min/max waiver. The earlier get regression was corrected and no longer repeats. Narrow read/filter gate remains open; no broader redesign.

## A — compatible pinned R2 SQLite → R3 SQLite

Three alternating pairs per completed size. Complete: **True**. Values below are medians of three trial values; within-trial API timings use medians of the retained raw observations. No three-point p95 claim.

| Metric | 1k | 10k |
| --- | ---: | ---: |
| Cold open → full ready, ms | 45.696 → 38.846 | 299.829 → 288.946 |
| Ensure / replay, ms | 18.579 → 22.293 | 154.968 → 151.392 |
| First full read, ms | 14.164 → 12.508 | 132.023 → 134.273 |
| Repeated full read, ms | 11.686 → 10.375 | 128.855 → 124.510 |
| Single write, ms | 27.749 → 10.687 | 312.148 → 120.474 |
| Batch 20, ms | 30.092 → 12.826 | 321.694 → 131.080 |
| Upload, ms | 36.098 → 20.436 | 311.779 → 154.151 |
| Single ACK, ms | 33.446 → 13.366 | 322.330 → 132.087 |
| ACK-through, ms | 36.566 → 34.188 | 334.452 → 307.878 |
| Compaction, ms | 47.956 → 35.438 | 336.731 → 310.774 |
| Mixed 300 operations, s | 3.663 → 2.626 | 42.107 → 31.473 |
| Worker user CPU, s | 3.313 → 2.626 | 36.577 → 29.582 |
| Worker system CPU, s | 0.584 → 0.306 | 11.808 → 8.499 |
| Peak RSS, MiB | 219.266 → 209.410 | 307.520 → 304.797 |
| Sampled peak heap, MiB | 76.725 → 68.425 | 142.422 → 134.708 |
| Process write_bytes, GiB | 0.374 → 0.023 | 5.702 → 2.616 |
| Closed disk family, MiB | 2.863 → 2.859 | 14.098 → 14.098 |

[All raw observations](A/raw.json), [trial medians, paired deltas and all metrics](summary.json). Full state, every mutation/upload/ACK receipt and fresh-process reopen hashes match in every completed pair; business output also matches the existing independent oracle.

## B — current pinned Main JSON/WAL → R3 SQLite

Three alternating pairs per completed size. Complete: **True**. Values below are medians of three trial values; within-trial API timings use medians of the retained raw observations. No three-point p95 claim.

| Metric | 10k | 200k |
| --- | ---: | ---: |
| Cold open → full ready, ms | 395.076 → 312.298 | 2414.616 → 6869.323 |
| Ensure / replay, ms | 383.205 → 165.471 | 2400.478 → 3305.078 |
| First full read, ms | 0.394 → 159.602 | 0.434 → 3560.342 |
| Repeated full read, ms | 0.144 → 127.364 | 0.163 → 3289.048 |
| Single write, ms | 5.493 → 122.849 | 6.152 → 3472.454 |
| Batch 20, ms | 6.235 → 122.383 | 6.174 → 3495.033 |
| Upload, ms | 5.961 → 158.140 | 17.319 → 3869.851 |
| Single ACK, ms | 5.324 → 126.070 | 16.049 → 3278.867 |
| ACK-through, ms | 4.991 → 304.035 | 11.137 → 6705.137 |
| Compaction, ms | 1120.141 → 287.324 | 24501.416 → 6758.435 |
| Mixed 300 operations, s | 0.592 → 31.317 | 3.673 → 825.905 |
| Worker user CPU, s | 1.986 → 29.937 | 31.695 → 874.185 |
| Worker system CPU, s | 0.538 → 8.395 | 8.668 → 205.508 |
| Peak RSS, MiB | 371.957 → 307.539 | 2552.398 → 2797.934 |
| Sampled peak heap, MiB | 114.947 → 142.136 | 927.657 → 2317.216 |
| Process write_bytes, GiB | 0.100 → 2.616 | 1.878 → 53.119 |
| Closed disk family, MiB | 23.920 → 14.098 | 444.571 → 315.438 |

[All raw observations](B/raw.json), [trial medians, paired deltas and all metrics](summary.json). Full state, every mutation/upload/ACK receipt and fresh-process reopen hashes match in every completed pair; business output also matches the existing independent oracle.

## Real SQL, rollback and compatibility

TEMP SQL audit (outside benchmarks): a single patch at 20 rows changes **82 → 3 DML**, at 2000 rows **8002 → 3**. R3 touches one record, one event and envelope; zero unrelated record/event writes. Duplicate and repeated ACK no-op produce zero DML. Batch, delete, remote conflict/resolution, upload, ACK and ACK-through audit covered. [Final audit](audit-final.json), [tests](../../../../../scripts/prototypes/sqlite-decision-20261109/incremental-r3.test.cjs).

All operations persist their actual changed record/event/envelope values atomically; native SQL ABORT rolls back partial batch and metadata. Existing receipt/owner/CAS/HLC/ACK assertions remain. Five failure/write/ACK/close/reopen resource cycles, two-handle visibility, caller isolation and SQLite-only fresh process checks pass. The event-only failure trigger additionally covers envelope INSERT for the valid envelope-only ACK-through path; no assertion was removed. WAL/FULL, busy timeout 5000, cache -8192, autocheckpoint 256 unchanged.

## A/A and unclosed gates

Three controlled A/A pairs at each existing 1k/10k fixture use the identical final worker. Signed deltas and all samples: [1k](AA-small/raw.json), [10k](AA/raw.json), [summary](summary.json). No blanket percentage tolerance or mere broad min/max waiver. The earlier repeatable get regression was fixed before final acceptance; historical samples stay under read-regression-2581c655. The final small filter gate remains explicitly open as explained above.

Full-state SQL materialization and envelope serialization remain expensive; ordinary DML reduction is not an end-to-end production acceptance. Each API sample records SQL all() rows/time and envelope serialization size/time. Compaction is separate; its ledger/envelope growth is retained. Native /proc process write_bytes includes query/sort temporary files, not commit-only bytes. Instantaneous DB/WAL/SHM/recovery sizes are not cumulative writes. CPU/event-loop worker totals include harness/oracle overhead; per-API timing excludes separate full canonical hashes. Fresh process uses warm OS cache, not OS-cache-cold. Equivalent automatic backup/retention/rollback and platform/power-loss guarantees are not established; disk-family numbers do not close those gates.

## Validation and provenance

- contract-gates: 8 tests, 8 PASS / 0 FAIL / 0 SKIP / 0 CANCEL.
- prototype: 4 tests, 4 PASS / 0 FAIL / 0 SKIP / 0 CANCEL.
- compat-r2: 12 tests, 12 PASS / 0 FAIL / 0 SKIP / 0 CANCEL.
- incremental-r3: 4 tests, 4 PASS / 0 FAIL / 0 SKIP / 0 CANCEL.
- related: 84 tests, 84 PASS / 0 FAIL / 0 SKIP / 0 CANCEL.
- full: 9243 tests, 9178 PASS / 0 FAIL / 65 SKIP / 0 CANCEL.

Full standard npm runner: 1335 files, 10 uninterrupted batches, default concurrency=4; official targeted runtime Electron 44.3.0 / Node 24.20.0 / SQLite 3.53.4; standard npm host Node 24.19.0. i18n 0 new / 0 baseline missing; existing 23 release-note records valid. New note/PNG N/A: product/CI sources equal Main. No other candidate branch, package/lock, production engine or threshold changes.

Official archive checksum, cgroup/CPU/overlay environment, protected tree equality and file hashes: [source identity](source-identity.json). [Pre-implementation budgets](plan.md), [reproduction commands](commands.md), [critical review](review.md), [all prior failed/stopped attempts](attempts.json). The copied conversation’s unpushed eec7896e source was unavailable; no claimed prior R3 measurements were adopted. Final validation/measurement identities are explicit; later evidence commits do not change runtime sources.

Final single report: #952 [SQLITE-INCR-R3]. PR #958 stays draft; Main merge, TEST/STABLE, publication, shadow/dual-write, pilot, migration, branch deletion and issue closure are not performed.
