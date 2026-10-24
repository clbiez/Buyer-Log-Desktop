# BL-012 — validated WAL metadata

This change depends on ND-003 (#701). It does not change snapshot/WAL schemas,
checksum replay, event identity, sync semantics or the 1 MiB / 2,000-entry limits.
Per-instance entry count, byte size and newline state follow the WAL's inode,
size, modification time and change time. Counters advance only after append,
fsync and stat succeed. Failed writes, external identity changes and checkpoint
rotation invalidate metadata. Unknown/inaccessible files never count as empty.
ND-003 corruption rejection and evidence preservation remain enabled.

## Executed evidence

Windows, Node 24.18.0; synthetic data only. The focused local DB/WAL selection
passed 54 tests across 9 files before the final removal of one redundant stat;
the latest metadata and ND-003 recovery files then passed 18/18 in independent
review. Separate integration with BL-002 fencing passed 38/38, including real
process/worker contention. Neither result is a whole-application certification.

The new regression first observed 240 complete WAL reads / 5,078,202 bytes during
120 warm appends. The optimized path performs zero complete WAL reads in that
case. Tests also cover an external writer, same-size file replacement with mtime
restored, partial-append failure followed by recovery, and the 2,100-save case
crossing the 2,000-entry checkpoint boundary. Cold replay retains all 2,100 saves.

Paired quiet measurements using 30,000 seed records and 120 real durable patches:

| Metric | ND-003 baseline | BL-012 |
|---|---:|---:|
| WAL full-read calls | 240 | 0 |
| WAL bytes reread | 5,107,482 | 0 |
| Median patch duration | 5.738 ms | 4.136 ms |
| p95 patch duration | 6.866 ms | 4.631 ms |
| Cold-reopened final value | 120 | 120 |

Raw samples: `bl012-wal-before.json`, `bl012-wal-after.json`.
Reproduce with `node docs/audits/bl012-wal-benchmark.cjs <app-root> <output-json>`.
These are local component measurements on one machine, not representative
desktop navigation, network-share or production concurrency claims. An earlier
run overlapped test I/O and was slower despite fewer reads; it was not used to
claim latency improvement. Independent review reported no actionable findings.

A real restarted Buyer Log server + Edge shows synthetic `BL012-SAVED` after its
compatibility JSON was removed. The genuine pending-note PNG proves preserved
visible data; it does not measure performance. Private signing keys and live user
data were not accessed; public trust keys and release feeds were not changed. Backend restart
is required on deployment. Revert this performance-only commit to retain ND-003
protection and restore the old per-append parsing behavior. No release or merge
was performed.
