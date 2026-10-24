# ND-003 — acknowledged WAL saves survive reopening

Risk: P0, confirmed with synthetic data on Windows. Base main:
`5a5c3bcafd4de929019b3bba522ef5771670b171`.

An incomplete final WAL record previously swallowed later appended operations.
The write returned success and the warm cache exposed the change, but a new DB
instance stopped replay at the old fragment and lost the acknowledged change.
A valid checksummed last record missing only its newline had the same problem.

The writer now distinguishes an unterminated JSON fragment from checksum,
schema or middle-of-file corruption. Before snapshot/rotation of a torn tail,
the durable recovery layer preserves every original WAL byte in a unique
`.wal.corrupt-<uuid>` file. Only the verified prefix is checkpointed, and the new
operation is fsynced into a fresh replayable WAL before acknowledgement. A valid
record without a newline receives a separator. Other corruption blocks writes
with `DATA_INTEGRITY_ERROR`; it is not silently repaired or deleted.

Snapshot transactions, explicit compaction and device rotation cannot bypass
the corruption guard. Quarantined bytes survive later compactions. The on-disk
snapshot and WAL schemas, event identities and sync merge rules do not change.
Recovery does not infer or reapply possible historical writes behind an already
corrupt middle line. Those bytes remain available for explicit investigation.

## Validation

- Original seven regressions: 0 pass, 7 fail before implementation.
- Expanded recovery/failure suite: 13 pass, 0 fail, 0 skip on Windows.
  Includes warm/cold writers, missing newline, checksum/middle/schema rejection,
  quarantine fsync failure, transaction/compaction/rotation rejection, an existing
  backup WAL, corrupt-primary fallback, snapshot and WAL-rotation failure/retry.
- `node resources/app/tests/run-tests.js local-db local-wal sync-simulation`:
  9 files, 61 pass, 0 fail, 1 skipped soak. The ten-device simulation actually ran;
  the larger soak was not run and is not certified.
- Separate combined checkpoint tree with prior PR changes and BL-002 fencing:
  21 files, 186 pass, 0 fail, 1 skipped Windows symlink test before the later
  updater fixture-only addition. This is focused integration, not full green.
- Independent review identified the snapshot/compaction bypass and missing fault
  coverage; both were addressed with the expanded tests. No merge authorization
  or complete platform certification follows from that review.
- Real restarted server + Edge, synthetic Pricing Desk request `ND003-SAVED`:
  the request saved after the torn tail is visible after native DB cold reopen.
  Its legacy `quotations.json` and backup were removed before starting the server,
  so this observation cannot come from the compatibility mirror. The genuine
  post-change PNG is included in pending release notes.
- Full combined Windows run: batch 1 passed (2,133 tests), batch 2 stopped with
  one unrelated local-date/UTC expectation in
  `detail-source-values-v20261021.test.js`. Remaining batches were not yet run at
  this checkpoint; no full-suite pass is claimed.

Backend restart is required after an approved deployment. Rollback must preserve
the `.corrupt-*` evidence; reverting restores the acknowledged-write-loss bug.
No live data, corporate services, merge, release or signing keys were used.
