# Seven-gap compatibility evidence

The unchanged original gates were reproduced as 1 PASS / 7 FAIL at the starting
prototype on official Electron. Final separate gates command passes 8/8; the
scalar null/zero/false/empty pass is retained. No original assertion changed.
Added tests compare full receipts/envelopes, not only a business hash.

| Historical RED | Implemented SQLite behavior | Additional behavioral evidence |
|---|---|---|
| Full read envelope | Snapshot read reconstructs records, event receipts, journal, tombstones, revision/sequence/HLC, conflicts, applied events, checkpoints, ledger/assets/migration envelope from SQL | Empty/populated equality; each critical intermediate and reopen; fresh SQL-only process with integrity_check and local-db module absent |
| Delete/tombstone | Atomic delete event, tombstone, sequence/HLC and record removal | Delete, duplicate/repeated delete, reopen, resurrection, remote delete and conflict resolution |
| Remote conflict/owner | Pinned field/subfield/causal merge, owner policy, receipt-only checkpoints, persisted conflict IDs and resolution | Same/different owner; forbidden local batch and remote fields; same-owner ordering; subfields; current/incoming/custom/delete choices; out-of-order source gap and duplicate receipt; invalid checksum/HLC/cover/ID rejects |
| ACK versus upload | Separate uploaded/synced and acknowledged flags; per-event and through ACK, compacted exceptions | Both orders; partially uploaded boundary; foreign remote receipts excluded; counts, body and SQL columns before/after reopen/compaction |
| Explicit baseRevision | Global max(base/global)+1; record/field revision, independent localSequence and HLC | Explicit base 99 gives revision 100 / sequence 2; unchanged prior fields; remote revision and resolution base; CAS rejection |
| Receipts/idempotency | Real queuePatch/batch duplicate/conflicts/revision/sequence receipts | Every critical paired API receipt deep-compared without metadata removal; duplicate member/pruned event; rollback then retry exactly once |
| Persisted upload/sync | Journal JSON and SQL uploaded/synced/ACK columns written with envelope in same transaction | Actual SQL queries for every journal entry; upload/ACK ordering; close/reopen and fresh child; injected SQL ABORT during patch/conflict/upload/ACK/resolution preserves all prior state |

12 additional behavioral tests, unchanged 4 prototype tests and unchanged 8
gates are separate official-runtime invocations. `fixture-traces.json` contains
paired call inputs, frozen wall time and operation UUID seeds. Direct SQL fault,
handle and mutation fixtures are explicitly defined in compat-r2.test.cjs.
Source and fixture hashes identify both. Only generated time/UUIDs are controlled;
identity, owner/subfields, revision, sequence, HLC and ACK/conflict metadata are
not discarded. structuredClone preserves receipt/call shapes.

Five open/write/SQL-abort/retry/ACK/close/reopen cycles verify zero SQL file
descriptors, no open transaction or additional timer work, finalized statements,
idempotent close and retained state. Two handles observe each other's commits.
Caller/input/read/pending/record/conflict mutation cannot change persisted data.

Supported API boundary is documented in the prototype README. No all-LocalDb,
production backup/recovery or migration acceptance is claimed. Full row
replacement has O(state) cost and no performance PASS. Historical 31→1198 ms
repeat full-read, JSON SHARED_LEASE_LOST, backup/rollback/retention, cold storage,
Windows/native/shared-folder/power-loss gates remain open. Production WAIT.
