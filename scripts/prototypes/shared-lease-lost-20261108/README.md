# SHARED_LEASE_LOST diagnostic

TR: Yalnız sentetik JSON/WAL teşhisi; üretim kaynağı, #900 prototipi ve kanıtları
salt okunurdur. SQLite, servis, gerçek veri ve credential kullanılmaz. Yeni
dosyalar yalnız bu dizine ve karşılık gelen belge dizinine yazılır; büyük
sentetik DB'ler ayrı `/tmp/buyerlog-shared-lease-diag-*` köklerinde korunur.

EN: Synthetic JSON/WAL diagnostics only. Production and #900 sources/evidence
remain read-only. No SQLite work, service, real data or credential is used.
Large synthetic databases remain in isolated `/tmp` roots, outside Git.

`run.sh` acquires `flock -n -E 75 /tmp/buyerlog-performance-measurement.lock`.
It does not wait for or delete the lock. `run.cjs`, `scenarios.cjs`,
`validate.sh`, the timeline checker and evidence sealer require the outer lock.
Never run these simultaneously with another measurement/test/build.

From the repository root, with an unused label for every attempt:

```sh
DIAG_NODE=/path/to/node22 bash scripts/prototypes/shared-lease-lost-20261108/run.sh \
  retry-node22-plain-200k 200000 plain
DIAG_NODE=/path/to/node22 bash scripts/prototypes/shared-lease-lost-20261108/run.sh \
  retry-node22-trace-200k 200000 trace
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  /path/to/node22 scripts/prototypes/shared-lease-lost-20261108/scenarios.cjs \
  retry-completion-race completion-race
```

Scenario arguments: `completion-race`, `contention`, `active-before-write`,
`active-after-fsync`. Use a fresh label and data root every time. A successful
process exit means the scenario's strict assertions passed, not that no warning
or expected rejection occurred.

`validate.sh` records the exact additional cases, selected unmodified repository
tests and `npm run i18n:check` used for this delivery. Its fixed labels deliberately
refuse reuse. In an evidence-free worktree, run:

```sh
DIAG_NODE22=/path/to/node22 DIAG_NODE24=/path/to/node24 \
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  bash scripts/prototypes/shared-lease-lost-20261108/validate.sh
```

To repeat validation in this populated worktree, execute the listed commands
individually with new case labels and new log destinations. Never delete or
overwrite previous evidence. Exact Electron 39.0.0 was unavailable here;
Node 22.23.4 and Node 24.19.0 results do not establish Electron equivalence.

The independent workload writes 200,000 events in batches of 10,000 to 50,000
synthetic records (four updates per ID), marks 80% synced, then compacts. It uses
the production WAL/lease defaults and a fixed business clock. Every returned
event ID, duplicate flag and sequence is asserted. The fixed clock does not
replace lease `Date.now()` or its real timer. A fresh child process reopens the
snapshot/WAL and strictly checks event IDs, every business field and sequence.
This workload neither imports nor reproduces #900's SQLite prototype or exact
historical event distribution, mixed reads/writes or crash benchmark.

Instrumentation levels:

- `plain`: API boundaries and progress only; no production function/IO wrappers.
- `trace`: observational wrappers around exported lease methods and filesystem
  promises, with in-memory events. Returned promises/throws are preserved.
  Added observers, metadata/JSON parsing and allocation affect scheduling/RSS.
  `trace.cjs` also attempts JSON parsing of `writeFile` payloads to identify
  metadata, including synthetic snapshot buffers; this is measurable overhead.
- Controlled scenarios add explicit callback gates, a delayed renewal-read
  completion, a post-fsync gate or adversarial displacement of a live owner
  directory. These are perturbations, not production traffic or natural lease
  takeovers. No TTL, heartbeat interval, timeout, guard or warning is changed.

Every case stores runtime/source/harness pins, child exit status, complete
stdout/stderr bytes, base64 stream receipt records, and monotonic/wall timelines.
`process.hrtime.bigint()` uses the same Linux host monotonic clock across
processes; pipe receipt timestamps bound observation, not the exact emit time.
In-memory traces can be lost on a crash: natural worker trials completed here;
parent stream files survive independently. fsync completion is an OS API
observation, not a power-loss durability experiment.

`check-timelines.cjs` asserts lifecycle/ownership/ACK ordering and produces
`summary.json` and `timeline-excerpts.json`. `seal-evidence-v2.cjs` validates source
and harness pins, reconstructs exact stream bytes, asserts ACK/reopen equality,
hashes retained synthetic disk files and produces `SHA256SUMS`.

```sh
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  /path/to/node22 scripts/prototypes/shared-lease-lost-20261108/check-timelines.cjs
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  /path/to/node22 scripts/prototypes/shared-lease-lost-20261108/seal-evidence-v2.cjs
sha256sum -c docs/performance-program/shared-lease-lost-20261108/SHA256SUMS
```

Raw schema caveat: `verify.result.json.acceptedEvents` is the oracle's expected
durable-set size. For `active-after-fsync` that set intentionally includes one
unacknowledged event. Authoritative ACKs are `manifest.json.accepted` and
`ack-reopen.json.acknowledgedCount`; the latter separates permitted
unacknowledged IDs. Raw evidence is retained without renaming its fields.

The original `seal-evidence.cjs` is a retained failed packaging attempt; see
[seal-v1-failure.md](../../../docs/performance-program/shared-lease-lost-20261108/seal-v1-failure.md).
Its bytes stay unchanged to preserve a recorded harness hash. Use v2.

Findings, limits, source pins and the handoff are in
[the diagnostic report](../../../docs/performance-program/shared-lease-lost-20261108/README.md).
