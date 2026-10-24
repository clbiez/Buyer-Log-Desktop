# BL-002 — active writer integrity

Status: Implemented; Linux focused verification passed. No merge or release.

The audited age-only eviction is still present on main's runtime: a valid local
writer older than staleMs can lose its directory while its callback is running.
The correction never treats elapsed time as proof that a valid writer stopped.
Local PID liveness and registered worker-thread retirement establish recovery;
unknown remote liveness fails closed. Missing/corrupt legacy metadata keeps its
existing initialization grace period.

Reclamation and release use unique directory pins and nonrecursive rmdir. They
reread exact owner metadata before removal and cannot recursively delete a
successor's directory. Exclusive owner publication prevents a suspended
initializer from overwriting a later owner. Monotonic generation metadata,
operation-local ownership checks before durable replacement/WAL append, and
checks after callback completion fence stale upgraded writers. Failed database
mutators invalidate their dirty in-memory cache. Heartbeats advertise activity;
an expired heartbeat alone never grants takeover.

Collection/backup/projection/Excel worker clients register actual threads. A
bounded 4096-slot shared registry and atomic local retirement ledger distinguish
a terminated thread from its still-running parent process. Initialization pins
include thread identity as well, so a live sibling's pin is never mistaken for a
same-thread orphan. Worker startup/ledger failure fails visibly; unregistered
file-writing workers fail closed. Synthetic worker fakes without threadId keep
their existing test behavior.

## Verification

Environment: Linux, Node v24.19.0, Chromium; synthetic local files/accounts only.

- Passed: `TMPDIR=<isolated>/tmp BUYER_LOG_TEMP_ROOT=<same> APPDATA=<isolated>/appdata LOCALAPPDATA=<isolated>/localappdata npm --prefix resources/app test -- file-lease local-db durable-file shared-lease single-instance-lease shared-revision worker collection-workspace` — 14 files, 92 pass, zero failures/skips.
- New integrity cases cover real two-process threshold expiry with SIGSTOP,
  concurrent mixed sync/async recovery (64 writes preserved and 64 distinct
  generations), crash during metadata publication, transient/persistent unlink
  failures, successor-token replacement, dirty DB cache fencing, terminated
  worker recovery by a different process, and live/terminated worker initializer
  pins. The real expiry case waits 5.2 seconds; no age-only mock is used there.
- The combined wave integration exposed one outdated Central IAM test: it
  expected a child to evict the live paused writer by elapsed age. The invariant
  is now stronger: the child fails, the original token and committed directory
  survive, and a later stale revision is still rejected. No IAM authority or
  financial assertion was removed. `npm --prefix resources/app test -- central-iam`
  passed 29 tests across four files, zero failures/skips. The initial combined
  result was 603 pass/1 fail; that failed expectation is explicitly recorded,
  not represented as a green integration run.
- Passed: actual Buyer Log Collection Add Model through normal HTTP. A distinct
  process held the actual workspace lease and was suspended with SIGSTOP; its
  timestamp was explicitly aged 120 seconds for the server's default threshold.
  The native save returned HTTP409/SHARED_WRITE_BUSY, original owner token
  remained, browser pending edits remained, and retry after writer release
  returned durable success. Screenshot shows the real native error toast with
  synthetic data. The timestamp manipulation is not a 120-second elapsed-time
  performance measurement.
- One independent review identified metadata-crash debris, maintenance-pin
  cleanup failure, and terminated-worker recovery gaps. All received focused
  regression tests and corrections; no second reviewer chain.
- Baseline microbenchmark: 120 identical async acquire + tiny JSON writes,
  Linux local filesystem, median 0.503316ms / p95 1.029304ms before; final code
  median 0.271011ms / p95 0.976765ms. This small harness measures overhead only;
  it is neither representative desktop performance nor a throughput guarantee.
  Raw samples are in the accompanying benchmark JSON files.
- Not executed: actual Windows/NTFS, SMB/disconnected remote writer recovery,
  mirrored shared folders, Windows process suspension and corporate integration.
  Full supported-runtime regression is still required before release; BL-006's
  separately documented baseline failures have not been declared fixed here.

## Compatibility and operational boundaries

No JSON snapshot/WAL schema, financial logic or dependency changes. Existing
callback signatures remain compatible; a synchronous callback returning a
Promise is now rejected explicitly. Backend restart is required.

All processes writing the same files must upgrade together. Old clients can
still recursively remove locks and do not honor generation checks. This does
not create distributed consensus over asynchronous file mirroring. A valid
remote-machine lease is intentionally not reclaimed by timeout: coordinate
shutdown of every writer, verify remote termination and preserve/review the
exact owner metadata before any operator recovery. There is no automatic
remote administrative deletion endpoint in this change.

Generation sidecars must be preserved alongside their files. Corrupt generation
metadata fails closed rather than silently resetting the fence. Local worker
ledgers are app-owned temp metadata, bounded in size, and removed on clean main
process exit. Crashed-process leftovers contain liveness IDs only; PID death
allows lock recovery without that ledger. Arbitrary direct filesystem writes
and legacy unguarded writers are outside this cooperative protocol.

Rollback: stop every writer, preserve snapshot/WAL/sidecars, revert the code and
restart a coordinated same-version set. Do not delete a live lock or restore an
old generation sidecar while writers are running. Reverting reintroduces the
audited age-only takeover vulnerability. Windows and shared-folder acceptance
remain required before claiming complete desktop compatibility.
