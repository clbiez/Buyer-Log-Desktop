# Local JSON/WAL versus SQLite: prototype decision report

Date: 7 November 2026. [Türkçe](local-db-sqlite-2026-11-07.tr.md).

## Decision and scope

**User decision: keep #900 as an unmerged draft on hold. Do not start a new
pilot, migration, product change or TEST/STABLE publication.** Preserve the
existing evidence and both reports.

Decision-summary limits:

- Startup is not UI startup; SQLite does not load all records.
- At 200k, full-record reading takes JSON→SQLite **24.7→1188.1 ms**: the existing
  whole-state API does not automatically benefit.
- Backup guarantees differ; total disk differences are not direct savings.
- SIGKILL results do not establish power-loss durability.
- Measured **Electron 39.0.0** differs from the current **Electron 44.3.0**
  target; these results do not validate the 44/Windows target.

**Merging the prototype PR, authorizing a compatibility pilot and authorizing
live migration are three separate decisions; none automatically permits the
others.** Phase 6's full `npm test` requirement remains in force. Complete the
required full regression and review on the current integration before merge
evaluation; targeted tests and PR fast checks do not replace that requirement.
This handoff update does not start that work.

[Muhtemel / Likely] SQLite's synthetic startup, indexed-query and compaction
advantages support considering a separate future compatibility pilot; that
technical recommendation is not authorization. The separate
[SHARED_LEASE_LOST follow-up finding](local-db-sqlite-2026-11-07/shared-lease-lost-follow-up.md)
hands off the observation only; root cause and impact remain unknown.

Evidence labels: **[Doğrulandı / Verified]** direct source/test/runtime evidence;
**[Muhtemel / Likely]** strong indirect evidence; **[Hipotez / Hypothesis]**
untested explanation; **[Bilinmiyor / Unknown]** insufficient evidence.

[Doğrulandı] Changes are limited to `scripts/prototypes/` and `docs/`. Product
code, dependency manifests/locks and release notes are unchanged. All data is
synthetic and device-local; no live installation, SMB or shared folder was used.

[Doğrulandı] The **295 MB** comment in `local-db.js` describes a historical
installation, not a current customer measurement. `large-json.js` really selects
a chunked parser above 256 MiB. All measured sizes below belong to this synthetic
experiment. MB and MiB are distinct: 1 MiB = 1,048,576 bytes.

## Runtime, dependencies and signing

[Doğrulandı] The main run used official **Electron 39.0.0 / Node 22.20.0 / V8
14.2.231.14-electron.0 / SQLite 3.50.4 / Linux x64**, with
`ELECTRON_RUN_AS_NODE=1`. `node:sqlite.DatabaseSync` actually loaded in Electron;
availability was not inferred from standalone Node with the same version.
[raw.json](local-db-sqlite-2026-11-07/raw.json) records runtime versions, CPU,
cgroup limits, source commit/hashes and individual measurements.

[Doğrulandı] The checkout's `.github/installer/runtime.json` now declares
**Electron 44.3.0**. The requested 39 target was downloaded separately without
changing that manifest. [Bilinmiyor] These results do not establish performance
or packaged compatibility on the current Windows product or Electron 44.

| Option | Dependency / distribution | Signing / packaging impact | Evidence |
| --- | --- | --- | --- |
| `node:sqlite` (selected) | No extra npm package or `.node` file; SQLite is in the runtime. Node 22.20.0 emits an experimental API warning. | No new native module if the existing runtime suffices. Future product/package changes still require normal manifests, hashes, signing and versioning. Changing the runtime needs full-installation assessment. | [Doğrulandı] Runs in Electron 39.0.0 Linux. |
| `better-sqlite3` | Additional locked dependency, licensing/SBOM/advisory tracking, and native binaries/rebuilds for each OS/architecture/Electron ABI. Standalone Node ABI 127 differs from Electron 39 ABI 140. | Include the `.node` binary in the package inventory, integrity manifest and signed archive. Existing manual-patch `mutablePath` permits only `server/` and `public/` changes, so adding `node_modules/` is not directly distributable through that path. Full packaging and architecture tests are needed. | [Muhtemel] Native packaging risk; performance and packaged loading were not measured. |

[Doğrulandı] The existing backend also uses `ELECTRON_RUN_AS_NODE`
(`resources/app/electron/backend.js`). This supports the experiment's runtime
mode, not acceptance of a signed Windows build. [Muhtemel] Long `DatabaseSync`
operations can block the backend event loop; worker/process design and HTTP/UI
latency need separate validation. No such product architecture change is made.

## Method and equivalence boundary

- Sizes are **10,000 / 50,000 / 200,000 events**, not record counts. Every ten
  events contain three order patches, six checklist-answer patches and one
  settings patch. Orders are updated repeatedly. Answers include notes, status,
  report numbers and attachment metadata, without attachment bytes/base64.
- Each fixture is created once through the real API in batches of 10,000, with
  80% of events marked uploaded and **none ACKed**. Fixture creation time is
  recorded separately and excluded from trial latency and peak memory.
- Three fresh processes/private copies per engine and size, alternating
  **JSON→SQLite, SQLite→JSON, JSON→SQLite**. The identical deterministic trace
  has 300 operations: 150 point reads, 60 filters, 30 `pending(100)`, 30 single
  writes and 30 batches of 20. Each trial adds 630 events. Engines run serially,
  with no other test/build running during the measured trials.
- JSON uses the actual `createLocalDb` API, default **1 MiB / 2,000 WAL-entry**
  thresholds, leases, fsync, backups and recovery. SQLite uses WAL,
  `synchronous=FULL`, an 8 MiB page cache, 256-page automatic checkpoints,
  prepared statements and separate record/event tables. Both have a durability
  boundary per single write/batch; SQLite is not accelerated using OFF/NORMAL.
  Production JSON snapshot costs on threshold crossings remain included.
- SQLite implements **only the local authoritative patch subset**. Small
  conformance tests compare records, field revisions/writers, HLC, journal
  checksums, duplicate handling, filters and pending results. Large trials
  compare business digests, event identities, counts and read-result checksums,
  then reopen after compaction. This does not establish equivalence of the full
  `read()` envelope or uploaded journal metadata. Tombstones, remote merges,
  owner authorization, ACKs, packages and checkpoints are outside the prototype.
- Checklist-shaped values are local-db records in this experiment. Existing
  `checklist-supplier-store.js` has a separate file-storage path; this is not
  evidence of end-to-end acceleration of checklist HTTP operations.

[Doğrulandı] Startup means adapter open + `ensure` + first record and pending
count queries, not Electron UI startup. SQLite can become usable without
materializing the whole DB. Full-record reads are measured separately: JSON
returns its cached live object; SQLite parses all record bodies. For indexed
filters SQLite fetches 50 results, whereas the existing API scans/sorts
`read().records`. This tests a different access model; product query adaptation
is necessary to realize the index benefit.

[Doğrulandı] OS page cache is warm and is not dropped. Runs use one container's
local filesystem with a 16 GiB memory limit and 4-CPU quota. Three trials are a
minimum repeatability check, not a confidence interval or customer-device SLA.
[Bilinmiyor] Cold storage, Windows/antivirus, concurrent processes, target SSDs
and actual customer data distributions remain unmeasured.

## Measurements

Tables show medians across three trials; p95 columns are medians of each trial's
p95, using zero-based `floor((n−1)×0.95)` in the sorted samples. Longest writes
are also shown. Individual values and file inventories are in the raw JSON. Time is ms;
memory/disk are MiB. RSS includes native SQLite memory. Steady memory is what
remains after the mixed trace and forced GC; heap and RSS are distinct. Peak RSS
comes from Linux `ru_maxrss`, which catches synchronous peaks that timer sampling
can miss. It includes startup, the mixed trace, full-record reading and
compaction; it excludes fixture generation and the expensive final verification
digest. Forced GC time is outside the latency measurements. OS page-cache memory
is outside the process RSS table.

Median wall time (ms)

| Events | Engine | Open + first queries | Mixed trace | Full records read | Compaction |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | local | 355.1 | 378.4 | 1.773 | 1047.1 |
| 10,000 | sqlite | 2.179 | 65.3 | 71.2 | 61.1 |
| 50,000 | local | 1068.2 | 3437.1 | 9.015 | 5029.6 |
| 50,000 | sqlite | 2.331 | 67.1 | 297.2 | 326.2 |
| 200,000 | local | 2542.7 | 3431.9 | 24.7 | 20977.7 |
| 200,000 | sqlite | 3.603 | 70.0 | 1188.1 | 1385.1 |

Median of per-run p95 latency (ms; batch = 20 events)

| Events | Engine | Point | Filter | Pending 100 | Single write | Batch 20 | Max write (median) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | local | 0.310 | 2.771 | 1.047 | 4.103 | 6.289 | 9.894 |
| 10,000 | sqlite | 0.026 | 0.525 | 0.426 | 0.179 | 1.469 | 1.724 |
| 50,000 | local | 0.335 | 12.8 | 1.760 | 4.704 | 6.359 | 2489.9 |
| 50,000 | sqlite | 0.043 | 0.578 | 0.404 | 0.171 | 1.478 | 1.806 |
| 200,000 | local | 0.385 | 67.3 | 6.865 | 6.249 | 7.243 | 11.0 |
| 200,000 | sqlite | 0.029 | 0.500 | 0.388 | 0.200 | 1.748 | 2.302 |

Median process memory (MiB; RSS includes native memory)

| Events | Engine | Open RSS | Steady RSS | Steady heap | Post-compact RSS | Peak RSS |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | local | 188.7 | 190.2 | 21.8 | 208.3 | 301.9 |
| 10,000 | sqlite | 77.8 | 87.0 | 3.206 | 117.2 | 126.5 |
| 50,000 | local | 252.8 | 528.0 | 94.3 | 410.2 | 675.4 |
| 50,000 | sqlite | 78.1 | 89.0 | 3.206 | 237.5 | 246.9 |
| 200,000 | local | 908.8 | 536.4 | 372.3 | 1145.8 | 2002.3 |
| 200,000 | sqlite | 78.7 | 90.7 | 3.206 | 519.9 | 529.2 |

Median disk footprint (MiB; primary + WAL + all backups/recovery files)

| Events | Engine | Before compact | After compact | After close | Primary after compact |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | local | 28.4 | 25.2 | 25.2 | 12.6 |
| 10,000 | sqlite | 23.7 | 14.4 | 14.4 | 14.4 |
| 50,000 | local | 200.6 | 112.9 | 112.9 | 56.5 |
| 50,000 | sqlite | 117.9 | 71.4 | 71.3 | 71.3 |
| 200,000 | local | 804.8 | 445.9 | 445.9 | 222.9 |
| 200,000 | sqlite | 485.2 | 299.5 | 298.9 | 298.9 |

18 trials; 18 SIGKILL probes; validation=passed.

[Doğrulandı] At 200k, median startup was 2542.7→3.6 ms, compaction
20977.7→1385.1 ms, and steady RSS 536.4→90.7 MiB (JSON→SQLite).
Conversely, materializing all records took 24.7→1188.1 ms. Wrapping SQLite
behind the existing whole-state access pattern carries this substantial cost.

[Doğrulandı] The longest JSON write at 50k took 2386.5–2526.9 ms per trial;
default WAL-threshold snapshot behavior remains intact. p95 can hide this rare
pause, so the table also reports the median of each trial's longest single/batch
write. This makes the 50k mixed trace similar to 200k; three sizes do not
establish a smooth scaling curve or constant speed multiplier.

Disk totals include **primary + current/previous WAL + all backups/recovery
files**, rather than comparing only `.db` files. JSON retains two complete
snapshots for recovery; the SQLite prototype creates no independent backup.
Therefore total disk savings are not proven under equivalent backup guarantees.
At least one independent SQLite backup, free space and retention cost must be
measured in the pilot. SQLite checkpoint/VACUUM and JSON journal pruning plus
snapshot/backup verification serve the same user goal but are different work.
[Doğrulandı] After 200k compaction the SQLite primary is **298.9 MiB**, versus
**222.9 MiB** for JSON. The SQL file itself is not smaller in this experiment.

## Crash/replay and durability

[Doğrulandı] Every size/engine has three **real SIGKILL** probes: after five
acknowledged writes, during an in-flight write, and during compaction. JSON's
in-flight boundary is after WAL bytes are written but **before fsync**; SQLite's
is inside an uncommitted transaction. Compaction is interrupted after JSON's
temporary snapshot is written but before fsync, or before SQLite's payload
pruning transaction commits. Killing inside SQLite VACUUM or after JSON's
primary rename is not separately injected here.

All five acknowledged writes must survive reopening or the run fails.
Compaction interruptions must preserve the fixture business digest. SQLite must
return `integrity_check=ok` after recovery. Raw results include replay time and
visibility of the unacknowledged operation. A complete, un-fsynced JSON WAL line
can remain visible after process death; absence of an unacknowledged operation
is not guaranteed. SQLite rolls back the open transaction.
[Doğrulandı] All 18 probes passed. The three recovery opens at 200k took
2548.3–2674.6 ms for JSON and 2.0–51.8 ms for SQLite. The subsequent business
digest is outside this opening time; SQLite again does not load all records.

[Doğrulandı] Separate prototype tests check repair of a torn JSON tail followed
by a new write and rejection of checksum corruption with
`DATA_INTEGRITY_ERROR`. Existing compaction/crash/WAL/business-integrity/HLC tests
were also run; see [validation.md](local-db-sqlite-2026-11-07/validation.md).

[Doğrulandı] The 200k JSON measurements emitted `renew:failed /
SHARED_LEASE_LOST` warnings; API calls returned and result assertions passed.
The warnings are disclosed and product code is unchanged. [Bilinmiyor] Root
cause, whether data loss occurred, and concurrent-writer consequences. Passing
tests do not establish a harmless race. The observation is handed off as a
separate finding; no production fix or new investigation starts in this PR.

[Bilinmiyor] SIGKILL is not power loss: host caches and the disk controller stay
alive. Hardware flush behavior, disk-full failures, bit rot, every
rename/rotation boundary and Windows power-loss recovery are not established.
Absolute durability language in source comments is not proof for every fault
model.

## Migration risks and rollback — design only

[Doğrulandı] This prototype is not migration-ready. A future change affects the
local file format and synchronization contract and requires separate P1 review.

1. **Semantic loss:** preserve revision, deviceId/localSequence, HLC,
   field/subfield/list writers, tombstones, open/resolved conflicts, event
   checksums/identities, pending versus uploaded versus ACK, compacted ledgers,
   checkpoint/package idempotency and causalKnowledge. [Bilinmiyor] SQL
   equivalence across this entire surface.
2. **Irreversible file switch:** old versions cannot read SQLite. Renaming JSON
   and overwriting it with SQLite, or silently falling back, is not a safe
   rollback. Restoring an old backup can lose writes acknowledged after the
   SQLite switch. [Doğrulandı] The formats differ.
3. **Future transition:** fence/stop all writers; retain a consistent JSON/WAL/
   backup/recovery family and hash manifest. Build a separate temporary SQLite
   DB, validate all metadata and business hashes, reopen, and pass integrity
   and sample sync tests. Activate through an atomic selection record without
   modifying the source files. Measure space first, including both formats,
   backups and compaction temporary files.
4. **Rollback after activation:** stop writes and identify the final
   acknowledged SQLite operation. Either use a previously tested SQLite→JSON
   exporter preserving event identities and all sync metadata to create a
   **new** JSON DB, or replay every post-switch event from a tested durable log
   onto the old snapshot. Validate business hash, tombstones/ledger, pending
   and ACK counts, sequence/HLC and reopening before activating the old version.
   Without that path, stop writes and preserve data instead of automatically
   restoring a stale backup. No exporter/replay mechanism is implemented here.
5. **Reverting this prototype:** close/revert the PR and remove only its generated
   synthetic temporary files. No product data rollback or migration is needed.

## Acceptance conditions for the next decision

[Hipotez] Indexed, paged access can provide better growth behavior for large
device-local databases. [Muhtemel] A SQL wrapper that materializes the existing
whole-state API can lose much of that benefit. The decision needs a signed
target Windows build, realistic anonymous data size/shape, cold/warm startup,
UI/HTTP latency, concurrent local processes, disk-full/power interruption,
backup/restore and complete synchronization regressions. No live migration
before a complete bidirectional exporter and rollback preserving post-switch
writes are accepted.

The current user decision is to wait. Future prototype merge, compatibility
pilot and live migration decisions need separate evaluation and authorization.
Before merge evaluation, complete Phase 6's full `npm test`, required regression
and review on the current integration. No TEST/STABLE publication.

## Sources and reproduction

- [Prototype commands and boundaries](../../scripts/prototypes/local-db-sqlite/README.md)
- [Raw measurements](local-db-sqlite-2026-11-07/raw.json),
  [validation](local-db-sqlite-2026-11-07/validation.md)
- Sources: `resources/app/server/lib/local-db.js` (`createLocalDb`, `compact`, WAL),
  `large-json.js`, `checklist-supplier-store.js`, `electron/backend.js`,
  `electron/manual-patch/signature.js`; raw data records source identity.
- [Official Electron releases](https://releases.electronjs.org/releases.json),
  [Node 22.20 SQLite API](https://nodejs.org/download/release/v22.20.0/docs/api/sqlite.html),
  [Electron native modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)
