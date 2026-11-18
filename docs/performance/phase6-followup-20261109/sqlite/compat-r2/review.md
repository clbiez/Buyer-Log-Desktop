# Critical diff review — R2

Risk: isolated correctness prototype, no production call-site or package changes.
Single-agent source review (no independent reviewer claimed).

- Real control wrapper is unchanged; original 8 and 4 test files byte-identical.
  Pure transition copy has pinned SHA/block provenance. SQLite module imports no
  createLocalDb, JSON file reader, oracle output or control result. Fresh child
  asserts local-db.js was never loaded and checks SQLite integrity/full state.
- BEGIN IMMEDIATE contains consistent reads and all record/event/envelope writes.
  No mutation cache exists; SQL abort rolls back state, HLC, sequence, flags and
  conflicts. Conflict resolution patch and resolved flag share that transaction.
  No blind retry after commit. Duplicate delivery returns the current control
  receipt; failure/retry and compaction idempotency are exercised separately.
- Uploaded/ACK/synced columns and body are derived from the same journal entry;
  ACK-through touches uploaded local journal entries only, excluding remote
  receipts, and preserves compacted identity/ACK exception/checkpoint metadata.
- Owner denial retains remote receipt/checkpoint behavior; same-owner ordering,
  different-author conflicts and composite subfields use pinned merge algorithms.
- Every read reconstructs detached SQL data under one read transaction. Two
  handles see each other's commits; returned/input mutation cannot persist.
  close is idempotent and finalizes prepared statements; five cycles check
  no file descriptors/transactions/timers remain.
- No PRAGMA/cache/timeout increase; no production lease/HLC/backup modification.
  Archived SQL schema is explicitly rejected and connection closed; no migration.
- Known tradeoff: full row replacement is O(state), unlike old optimized subset.
  No current performance PASS, benchmark reuse or adoption claim. General LocalDb
  transactions/packages/assets/device/transport and production backup remain out
  of scope. README names the supported boundary. Existing underscore-field
  rejection remains an explicit historical prototype input limitation.
- Harness fixes retained in iteration logs: unique per-operation deterministic
  UUIDs avoid artificial ID collisions; Electron child uses a real script plus
  synchronous output file (eval stdout in test context yielded empty output).
  No acceptance assertion was weakened. Historical fail logs are preserved.
- Sandbox process probe exposed spawnSync EPERM even with status=0; final
  fresh-child assertion also requires no spawn error. All final tests rerun
  outside that restriction with synthetic data roots. Receipt/call comparisons
  use structuredClone to preserve every property, including undefined keys.
