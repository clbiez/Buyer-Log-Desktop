# #952 isolated decision refresh

Only synthetic local files under `os.tmpdir()`. No product adapter, dependency,
launcher, release note, sync protocol, feature flag, SMB or live-data change.
Source archive: `abc683e4bcc247a7e8e412c07532bc8059fe3adb`; see provenance.json.
The archived patch subset is intentionally retained. Missing full read envelope,
owner/conflict/delete/ACK/revision behavior remains an acceptance BLOCKER.
`contract-gates.test.cjs` is expected to fail those real acceptance gates;
failures must be reported, never presented as a passing production adapter.

Official runtime: manifest `.github/installer/runtime.json`, Electron 44.3.0.
Run from repo root with `ELECTRON_RUN_AS_NODE=1` and the official Electron binary.
Use a new output directory. Never run heavy tests/benchmarks concurrently.

```sh
flock /tmp/buyerlog-performance-measurement.lock env ELECTRON_RUN_AS_NODE=1 \
 /tmp/buyerlog-electron-44.3.0/electron --expose-gc \
 scripts/prototypes/sqlite-decision-20261109/benchmark.cjs \
 --sizes 10000,200000 --rounds 3 --operations 300 --out /tmp/sqlite952-new

ELECTRON_RUN_AS_NODE=1 /tmp/buyerlog-electron-44.3.0/electron \
 --test --test-isolation=none scripts/prototypes/sqlite-decision-20261109/prototype.test.cjs
ELECTRON_RUN_AS_NODE=1 /tmp/buyerlog-electron-44.3.0/electron \
 --test --test-isolation=none scripts/prototypes/sqlite-decision-20261109/contract-gates.test.cjs
```

10k/200k are event counts; 80% upload, no peer ACK. Same deterministic workload,
independent plain JS business oracle. Three alternating fresh process pairs;
OS page cache remains warm, so process-cold is not cold-storage acceptance.
`readyMs` includes open/replay, first queries, first full-record materialization
and enumeration, but not the missing full production state envelope. Repeated
full-record reads are separate. Peak RSS comes from ru_maxrss; sampled heap
cannot capture every synchronous transient. Event-loop metric is maximum turn
interval including awaited I/O and GC, not pure synchronous blocking time.
CPU/peak exclude final verification/backup; backup costs are separate.

Backup is a quiescent, fsynced full-file-family copy plus manifest and verified
restore (business oracle, event identities, counts and pending). This lower
bound does not establish concurrent production backup/rollback equivalence.
Existing automatic JSON backups and SQLite primary/sidecars are all counted;
SQLite has no automatic independent backup in the archived adapter.
SIGKILL is process death, never power loss. Inherited crash scenarios do not
cover every checkpoint/backup boundary; any additions are separate probes.

Raw output stores stdout/stderr, incomplete runs and oracle failures. The
`subset-passed` status means only measured subset checks passed. No whole-product
performance PASS or backend adoption follows from it. Full npm test remains
mandatory after prototype changes.
