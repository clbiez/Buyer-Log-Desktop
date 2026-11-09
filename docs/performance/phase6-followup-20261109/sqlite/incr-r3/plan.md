# SQLITE-INCR-R3 resumed plan (before implementation)

Remote R2: 4ac2ed4847ce4c3af32bc82d13681b101d749d20. Main: 2b7762ef (resolved full SHA in source identity). Separate worktree, normal Main merge. The copied conversation's eec7896e commit is absent locally and GitHub returns 422; no old R3 measurements or test claims are adopted.

Only prototype and this evidence directory may change. Pure transitions, product, dependencies, CI, durability, lease and guards stay unchanged. Supported patch/batch/tombstone/remote/conflict/upload/ACK/ACK-through and maintenance retain full state/receipt equality, zero lost/duplicate events, atomic rollback and five cleanup/reopen cycles.

Write set comes from operation IDs, existing journal reconstruction index and SQL bounded ACK ranges. SQL compares candidate persisted values before DML; no unrelated row writes, including duplicate/no-op. Envelope remains one row; serialization and full-state reconstruction remain explicit costs. Compaction is separate maintenance.

A: pinned compatible R2 vs R3 at 1k/10k, three alternating pairs. B: pinned current Main JSON/WAL vs R3 at 10k/200k, three alternating pairs, existing 300-operation trace, same fixture/full-state and receipt oracle. Fresh process/warm reads separate; raw samples, CPU, I/O, event loop, heap/RSS, DB/WAL/SHM disk and envelope size retained. Three A/A pairs for small uncertain differences. No p95 from three rounds. Runtime official Electron 44.3.0; overlay disk; shared flock. Existing 20 minute worker guard unchanged. Failed runs retained.

Budgets: zero full-state/receipt differences and rollback leaks; DML bounded by affected rows independent of store size; no repeatable latency/CPU/memory regression, net resource benefit over R2 beyond A/A noise. Main comparison judged independently; no threshold/durability/production engine changes. Unsupported backup/platform/power-loss remains BLOCKED; production WAIT; PR draft.

Separate old 8 gates, 4 prototype, 12 compatibility and new real SQL audit tests; related 84 tests; final integrated full npm suite/concurrency=4, i18n/release notes; last SHA real PR CI. Final report only #952 [SQLITE-INCR-R3].
