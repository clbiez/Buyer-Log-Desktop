# #952 · 6C-BATCH evidence

Delivery: **BLOCKED**. Candidate performance acceptance: **FAIL** against the
budget recorded in [plan.md](plan.md) before implementation. The candidate is
archived and removed from the final product tree. This is not completion of
6c, removal of dual persistence, or a delta-only migration.

## Source and scope

- Base Main: `d0fdb8889f188e2cc1387b0850f61a841aa7e6d5`.
- Measured candidate source commit: `97f6e9e67a47c1f3beecec525746b363bb38bcd9`.
  The commit was made after measurement without changing measured files;
  [candidate-source.sha256](candidate-source.sha256) pins their exact bytes.
- Branch/worktree: `perf/phase6c-cp-batch-journal-20261109`,
  `/workspace/Buyer-Log-Desktop-6c`; control in `/tmp/buyerlog-6c-main`.
- Experimental changes: only `db.patchOrderOverrides` CP dispatch,
  `cp-shared-store.mirrorPatches[Detached]`, and opt-in `delta-store.mirrorBatch`.
  [candidate.patch](candidate.patch) is the complete product diff.
- No 6a thin DTO, read/projection/cache, server route, renderer, canonical ID,
  compute pool/guard, #916 engine, local-db, lease/sync/backup, mode, dependency,
  package, launcher, feature flag or contract changes. Other branches were not
  consumed. Primary legacy JSON save and network JSON work remain.

The proposed adapter retained each row's synchronous stage/no-op/rollback and
inflight entry; it combined only ordered queue transport. Repeated IDs were not
collapsed, and actor/subfields were not shared across heterogeneous events.
An `ORDER_SHARED_OWNER_ONLY` error is thrown by local-db's synchronous
`resolvePatch` mapping before `appendOperations`. Only that known zero-append
case used the previous individual dispatch, preserving unrelated valid rows.
Disk/merge/lease failures did not trigger a blind fallback/reapplication.
All this experimental product code is removed in the final delivery.

## Measurement and decision

Linux local temporary disk, Node **24.19.0**, the same machine and existing
compute configuration; one HTTP writer. Independent process/data roots for each
arm; deterministic 1000-row ASAS/Antrepo synthetic source, seed 952, date
2026-11-09. The scripts explicitly set all server/auth/app/local/temp/config
roots. No real PLM data, corporate account, credential or shared sync folder.
Full synthetic fixture hash:
`62c11497340bca91621c02cdfafb1eb8ccd12ddc162376eaa759d820de552ce6`;
each operation payload hash is also retained per sample.

There are **18 complete HTTP processes**: Main/candidate, three alternating
pairs for each of 1/100/1000 rows. Each process measures first batch (`cold`)
and a subsequent batch (`warm`) separately after login, source refresh and
unchanged startup maintenance. Cold means first write in a fresh process/data
root, not an OS page-cache purge or native startup. Every batch uses the actual
production HTTP route, IAM checks, DB save, CP adapter, delta-store and WAL.
Heavy runs and the uninterrupted full test share
`/tmp/buyerlog-performance-measurement.lock`.

All raw results are in [pairs/](pairs/); [summary.json](summary.json) is generated
by `python summarize.py`. No failed/incomplete sample was combined into this
series. Early failed harness runs remain as `http-initial*.json` and
`http-main-diagnostic.json`.

Median values below are Main → candidate; milliseconds except bytes/counts:

| Rows/state | API→ACK | Start marker→ACK+durable mirror flush | CPU | WAL append/lease/fsync turns | Total appended WAL bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 cold | 24.87 → 23.59 | 43.41 → 48.05 | 43.94 → 45.24 | 2 → 2 | 4,884 → 4,884 |
| 1 warm | 18.45 → 14.26 | 30.20 → 25.23 | 31.66 → 26.06 | 2 → 2 | 1,751 → 1,751 |
| 100 cold | 33.72 → 32.64 | 683.86 → 90.58 | 630.80 → 96.99 | 101 → 2 | 98,645 → 98,660 |
| 100 warm | 50.85 → 33.69 | 783.94 → 56.95 | 667.26 → 64.93 | 101 → 2 | 88,669 → 88,697 |
| 1000 cold | 159.59 → 137.98 | 12,724.51 → 342.28 | 9,084.02 → 466.83 | 1001 → 2 | 953,645 → 953,852 |
| 1000 warm | 151.13 → 154.58 | 10,422.08 → 537.99 | 7,400.53 → 746.05 | 1001 → 2 | 881,569 → 881,989 |

Counts refer to the instrumented local WAL, including the existing document
mirror: the CP part changes N → 1. Primary synchronous JSON recovery writes and
their fsyncs were not independently counted or removed. Serialize-call counts,
maximum 1ms timer gaps, peak process RSS/heap and all samples are in the raw
files and summary. RSS is process RSS, not retained heap or a native renderer
measurement. The start marker is an IPC marker just before the HTTP request;
flush is explicitly awaited after the primary HTTP response. Neither deferred
work nor response latency was omitted.

The prewritten budget requires **no increase in total WAL bytes**. Byte deltas:

- 100 cold: **+15, +5, +19**; warm: **+28, +40, +25**.
- 1000 cold: **+325, +7, +207**; warm: **+433, +375, +420**.

All 12 affected observations exceed that budget. The increase is small in
absolute terms; this report does not hide the substantial CPU/flush benefit.
However, it does not change the budget after seeing the results or silently
accept a resource tradeoff. Existing `local-db.stampOperation` calls
`hlc.tick()` within the transaction: denser writes produce multi-digit logical
counters. The existing decimal JSON representation adds bytes. The Main WAL
has zero counters in the inspected control; the candidate has counters through
19. [wal-clock-diagnosis.json](wal-clock-diagnosis.json) preserves histograms
from the whole 100-row acceptance WAL, including its later correctness cases.
It is a diagnosis, not a replacement for per-sample byte totals.

No HLC, WAL format, timing, queue size, retry, memory or acceptance threshold was
changed to bypass the gate. No scope expansion into the read-only local-db or
protocol was made. The candidate therefore stays an experiment, not READY.

Other median differences (including 1-row cold flush, 1000-row warm ACK and peak
memory) are **not certified noise or accepted regressions**. No A/A control was
run and no p95 is claimed. Since the repeatable byte failure already rejects
this candidate, additional noise/lifecycle/native campaigns were not used to
try to rescue it. Its complete no-regression acceptance remains unproven.

## Correctness and tests

All paired fixtures, normalized primary ACKs, persisted CP business records and
ordered logical event/receipt oracles match Main/candidate. The comparison
normalizes only independently generated, validated server timestamp fields
(`NotesAt`, `EkNotAt`, `markedAt`, `updatedAt`, `_updatedAt`); it preserves
zero/false/empty/null/missing, record identities, actors, patches, subfields,
operation order, revisions/sequences and receipt flags. Actual event UUIDs and
HLCs are not expected to be identical across independent executions. Within
each process, reopened CP records/journals match exactly, including UUID/HLC.

The first replay harness omitted the server's outgoing transport filter. Main
reproduced the same receipt-flag difference. The corrected reopen uses the
same production filter and owner resolver, and compares the CP state using
deep equality rather than unrelated startup metadata or JSON property order.
Earlier failures are retained, not declared successful.

HTTP acceptance also exercises repeated IDs, mixed dates/notes, zero/false/
empty/null, revision/CAS 409, successful and partial ACK (invalid row), and empty
batch ACK. [red-direct.log](red-direct.log) shows the three initial contracts
failing on pinned Main with missing `mirrorBatch`; [green-expanded3.log](green-expanded3.log)
shows all **5** expanded contracts passing on the candidate. They cover real
`patchOrderOverrides` at 1/100/1000 rows, no CP dispatch after a failed primary
save, shadow mirror error isolation, per-event metadata, no-op suppression,
owner denial with valid-row preservation, delayed/error flush, later-stage
rollback safety, concurrent local writers and duplicate remote delivery.
Earlier expanded-test failures are preserved as well: the first harness used
negative revision `-1` (the existing API treats it as unspecified), and another
attempt reused the primary root after deliberately creating a durable recovery
conflict. The tests now request an actual mismatched nonnegative revision and
leave the injected primary disk failure last; production guards were unchanged.

Candidate full-suite result and final source-equality/check commands are
recorded in [validation.md](validation.md). Standard full-suite output is
preserved, including any failures. A unit/helper success is not substituted
for the HTTP series or full regression.

Candidate-specific SIGKILL boundary injection, complete undo/redo UI acceptance,
five-cycle retained-resource certification, actual Electron 44.3.0 native UI,
Windows, SMB/OneDrive and enterprise multi-user capacity are **not certified**.
Local reopen and two synthetic local writers do not prove power-loss or SMB
durability. The rejected candidate must not be merged based on these results.

## Reproduction

The measured candidate commit contains the helpers and tests at their original
locations. Create a separate worktree at the candidate SHA above and a control
at the pinned Main SHA; use their normal dependency installation. No production
dependency/lock changes are needed. Set `NODE_PATH` only when reusing an existing
local dependency installation, as in this environment.

```sh
flock /tmp/buyerlog-performance-measurement.lock node resources/app/scripts/phase6c-run-pairs.cjs /tmp/6c-pairs /tmp/control/resources/app /tmp/candidate/resources/app
node resources/app/tests/phase6c-cp-batch.test.js
cd resources/app
flock /tmp/buyerlog-performance-measurement.lock npm test
```

`summarize.py` expects the completed `ab-<rows>-<pair>-<arm>.json` files in its
sibling `pairs` directory. Final-tree helpers are archived under `experiment/`
so they cannot be mistaken for a retained product integration. Replay them at
the candidate commit; the candidate contract deliberately fails on Main.

Final product behavior is unchanged, so TR/EN product text, release-note entry
`phase6c-cp-batch-journal-20261109` and a post-change product PNG are **N/A**.
There is no shipped optimization to illustrate or announce. Existing manifest
entries/top-level fields and all other work areas remain untouched.

No PR merge, branch deletion, TEST/STABLE release, global mode switch, pilot,
migration or issue closure. A normal local merge attempt was rejected by
automatic approval review because the user prohibited merging. A safe fetch
and ancestry check confirmed HEAD/base already equalled current Main, so no
merge was needed or performed. Subsequent final freshness is checked again.
