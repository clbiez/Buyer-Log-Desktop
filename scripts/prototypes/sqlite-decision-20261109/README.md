# #952 isolated SQLite research prototype

R2 closes seven compatibility gaps in the explicitly tested LocalDb slice.
Production decision remains **WAIT**. No production adapter, dependency,
launcher, feature flag, sync protocol, release note, SMB or live-data change.
Original source archive: abc683e4bcc247a7e8e412c07532bc8059fe3adb; historical
provenance and all failed/overlay/tmpfs measurements remain under
`docs/performance/phase6-followup-20261109/sqlite/` unchanged.

`adapters.cjs` retains the unchanged real createLocalDb control wrapper.
`sqlite-compat.cjs` independently owns SQLite records, journal bodies, event
receipts/flags and envelope metadata. Each operation reads a consistent SQL
snapshot; its record/event/envelope writes commit in one transaction. There is
no JSON/WAL write authority, hidden companion JSON DB, shared in-memory state
or reuse of control results. Returned data is detached. A separate process
imports only the SQL adapter and reconstructs the complete tested envelope.

`compat-transitions.cjs` contains copied pure algorithms with source SHA,
block hashes and unchanged helper provenance in `sqlite/compat-r2/`.
Support: read, local patch/batch, tombstone, single remote delta and receipt-only,
owner policy, conflict list/resolution, upload, event/through ACK and counts;
existing record/filter/count/event-id and fixed-tail compaction helpers remain.
This is **not all LocalDb APIs**: packages/applyDeltas, general transactions,
private documents, assets, transport policy, device rotation/binding, production
backup/recovery/sync, migration and schema upgrade are not implemented.
Historical direct underscore-field input rejection is retained for the original
rollback regression; arbitrary internal metadata writes are outside this slice.

New scratch files only. Archived prototype SQL schemas are rejected explicitly,
without migrating data. The default PRAGMAs remain WAL/FULL, timeout 5000,
cache -8192 and autocheckpoint 256. For a simple correctness implementation,
saves replace record/event rows inside the SQL transaction. This creates O(state)
work and has **no performance acceptance**. Historical 10k/200k numbers belong
to the original pinned code, not this implementation; do not rerun a new large
matrix as part of R2 or infer speed/disk wins from these small tests.

Use the official backend runtime from runtime.json and backend spawn path:
Electron 44.3.0 / Node 24.20.0 / SQLite 3.53.4, ELECTRON_RUN_AS_NODE=1.
From repository root, with a local overlay/disk TMPDIR (not tmpfs):

```sh
flock /tmp/buyerlog-performance-measurement.lock env \
 TMPDIR="$PWD/scripts/prototypes/sqlite-decision-20261109/.scratch" \
 ELECTRON_RUN_AS_NODE=1 /tmp/buyerlog-electron-44.3.0/electron \
 --test --test-reporter=tap --test-isolation=none \
 scripts/prototypes/sqlite-decision-20261109/compat-r2.test.cjs
```

Run unchanged `contract-gates.test.cjs` and `prototype.test.cjs` separately with
the same runtime/FS/lock; they are not included by the product npm test runner.
See `sqlite/compat-r2/commands.md` for final targeted and full regression commands.
Tests control generated Date/UUID values only, restore them afterwards, and
compare full state/receipts without dropping IDs, clocks, owners or metadata.
SQL fault injection tests rollback, repeated delivery and five close/reopen
cycles; these are not complete crash/backup/power-loss certification.

Historical full-read regression, JSON SHARED_LEASE_LOST, automatic backup and
retention/rollback parity, cold storage, signed Windows/native UI, multi-process
and shared-folder/power-loss gates remain open. Existing quiescent backup and
SIGKILL evidence is not promoted to a production durability guarantee.
Only the tagged final report in #952 records this delivery; #958 stays draft.
