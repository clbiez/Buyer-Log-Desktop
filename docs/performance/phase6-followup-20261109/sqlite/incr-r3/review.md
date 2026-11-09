# Critical review

Scope/risk: isolated persistence prototype; no production integration. Original checkout remains work/95b154d5. Current Main merged normally; only prototype and incr-r3 evidence differ from accepted R2+Main.

- All DML occurs between BEGIN IMMEDIATE and COMMIT; failure rolls back records/events/envelope and discards the state-local write set/index. No global state cache or retries.
- Patch/tombstone/remote operations nominate their record/event IDs. Conflict resolution uses the same operation path; resolving only a conflict flag writes only the envelope. Existing pure transitions are unchanged.
- Journal index is built during existing transaction read reconstruction, not by a new full traversal. Read-only calls build no index. Incremental save probes only nominated SQL IDs; compares full persisted columns/body before upsert/delete. No unrelated no-op UPDATE.
- Upload/per-ID ACK nominate explicit IDs; ACK-through selects unacknowledged SQL rows in its sequence range. Unuploaded journal flags still come from the unchanged transition. Compacted ledger event flags and envelope remain transactionally consistent.
- Compaction separately nominates the journals it prunes, preserves event identities/ACK flags and checkpoints/VACUUM. Maintenance remains O(state) and is measured separately.
- Candidate membership checks own properties. Inherited constructor/toString cannot become SQL rows. TEXT affinity is computed by SQLite itself for non-string metadata, preserving binding rejection and numeric representation; no blanket JS String conversion.
- Review correction before final measurements: numeric affinity preservation and avoiding read-only map allocation. Pre-review samples are retained, never combined with final samples.
- Fault injection extends the old event INSERT trigger to envelope INSERT, retaining every assertion. ACK-through on an unuploaded journal can change only envelope; requiring an unrelated event INSERT would contradict the incremental contract.
- Existing eight gates/four prototype assertions and all twelve compatibility assertions remain; tests are independent of timing. SQL TEMP audit rollback is transaction-local, and timing has no audit triggers.

Known cost remains: every supported mutation reads all state and serializes envelope. Journal flags and large ledgers can dominate CPU/heap/read I/O. No cache/read redesign is included. Native process I/O includes temporary query/sort files; write_bytes is not claimed as commit-only bytes. Instantaneous WAL/DB/SHM sizes are not cumulative I/O. total_changes counts DML without benchmark audit I/O. Worker CPU/event-loop measurements include harness/oracle overhead as documented; per-API samples exclude separate full-state canonical hashes.

Full envelope and every write/ACK receipt are hashed with sorted object keys, preserving every value/ID/revision/HLC/owner/conflict/ACK field. Business hash additionally matches the existing independent oracle. Only generated persistence metadata Date is fixed across paired trials; Date.now and unrelated Date (lease/recovery) remain real. Early invalid-clock-A used a global clock freeze and was stopped/excluded. Lease/UUID and product algorithms are unchanged. Fresh process is not OS-cache-cold. Connection-open and ensure/replay/full-read combined startup reported; read count/cpu/I/O excludes connection unless explicitly combined.

No equivalent production backup, Windows/native UI, SMB/OneDrive, retention/rollback or power-loss acceptance. Production WAIT. Final performance decisions must remain separate for R2 and Main; DML reduction alone is not end-to-end acceptance.

A/A-driven correction: pre-final source 2581c655 had repeatable 1k get regression (paired +0.4475/+0.8867/+1.0999 ms versus same-source A/A -0.066/-0.056/+0.019 ms). This was not waived. Read-only parsing now takes the exact R2 map callback, outside the transaction index branch. No cache/read architecture change; all tests and comparisons restarted, previous measurements archived under read-regression-2581c655. Any remaining final regression stays FAIL/BLOCKED rather than triggering a broader redesign.
