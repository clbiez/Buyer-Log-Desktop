# Decision: BLOCKED under unchanged acceptance rules

The exact zero-increase WAL budget fails on current Main plus the reconciled
three-file candidate: **11 of 12 paired observations increase**, one is equal.
No scope-compliant adapter fix can guarantee zero growth while retaining this
single-CP-transaction batching strategy. The product experiment is reverted.
Final runtime classification is N/A (evidence only), not a PASS for the candidate.

## Mechanism verified from source and raw bytes

`db.patchOrderOverrides` still saves primary JSON first. Its CP mirror transport
is the only dispatch replaced by the candidate. `delta-store.mirrorBatch` retains
per-row stage/no-op/rollback and actor/subfields, then passes the effective events
to existing `localDb.queuePatches` together. `local-db.resolvePatch` resolves owner,
UUID and timestamp; `appendOperations` calls `stampOperation`/`hlc.tick` followed
by `applyLocalPatch` for every operation within the held lease. The apply step
advances the persisted clock. `hlc.tick` increments its counter if physical time
has not advanced; `walLine` serializes that number in ordinary decimal JSON.

Main's inspected counters are all 0; the candidate reaches 31. One-digit 0–9
have the same width, counters 10–31 cost one extra UTF-8 byte per occurrence.
For **all 12 pairs**, the full raw WAL delta equals the summed counter-width
delta exactly; non-counter delta is **0**. Field accounting includes *all*
appended events, private document mirror, keys, separators and checksums. UUIDs,
hashes, timestamp strings, wall/node, patches, actor/owner/subfields and structural
widths were accounted for separately. No byte was deducted from acceptance totals.
Every raw WAL/journal checksum and actual WAL→journal UUID/HLC mapping is checked;
within-process reopen is exactly equal, including actual event IDs and receipts.

The equal 1000-row cold pair naturally stayed below the two-digit boundary.
It is retained and proves that an increase is timing dependent, **not that every
batch must grow**. A no-increase guarantee cannot depend on favorable scheduling.
No controlled/frozen clock, fake timestamp, sleep, throttle or byte normalization
was used for these real HTTP measurements.

## Allowed-boundary review

| Possible lever | Why it cannot close this gate within #952 |
| --- | --- |
| Supply an HLC from the adapter | `stampOperation` overwrites the local patch stamp with its own `hlc.tick`; bypassing it changes the read-only protocol. |
| Shrink counter/omit zero/fix width/compress WAL | Changes `local-db`/WAL/HLC representation and replay protocol, explicitly read-only. |
| Drop/merge metadata or logical events | Violates event identity/order, owner/subfields and explicit no-metadata-drop rule. No-op suppression already matches Main. |
| Reorder events/change device or event IDs/reuse known events | Changes logical identity/order or suppresses real writes; violates equivalence. |
| Wait between stamps | Stamps occur inside unchanged synchronous `operations.map`; clock/throttle changes are forbidden. |
| Split into smaller WAL transactions | Loses the prewritten one-CP-append/lease/fsync target and still cannot guarantee physical clock progression. Returning to the original path abandons the candidate; final product does use that original path. |
| Use a percentage allowance or normalize away counters | Changes the exact zero-byte budget and would hide measured growth. Not authorized. |

This is a source-boundary proof for the evaluated adapter, not a claim that no
different future storage design could ever save bytes. No wider redesign was opened.

## Actual tradeoff, for a separate future decision only

| Rows/state | Raw byte deltas across three pairs | Actual relative deltas | Median total ACK+flush Main→candidate (ms) | Median CPU Main→candidate (ms) |
| --- | --- | --- | ---: | ---: |
| 100 cold | +23 / +18 / +31 | +0.02332% / +0.01825% / +0.03143% | 547.56→76.34 | 525.67→91.41 |
| 100 warm | +50 / +53 / +34 | +0.05639% / +0.05977% / +0.03834% | 390.11→59.83 | 403.50→49.12 |
| 1000 cold | +240 / **0** / +440 | +0.02517% / **0%** / +0.04614% | 3380.24→309.81 | 3639.70→425.49 |
| 1000 warm | +536 / +541 / +541 | +0.06080% / +0.06137% / +0.06137% | 3412.49→408.17 | 3664.17→550.31 |

Total local WAL append/lease/fsync turns: 101→2 at 100 rows and 1001→2 at
1000 rows; the CP component is N→1, the existing document mirror remains.
Synchronous primary JSON/recovery writes and fsyncs are not independently counted
or claimed eliminated. Raw WAL medians: 98,645→98,668; 88,669→88,719;
953,645→953,885; 881,569→882,110 bytes in table order.

The condition that would need reconsideration is specifically “total WAL bytes
must not increase for the same logical events.” This note requests no waiver,
creates no tolerance and grants no permission. Even a separately authorized
future byte tradeoff would **not** clear the remaining gates: e.g. current
1000-row warm ACK median is 105.31→174.79 ms and cold event-loop gap is
83.48→163.82 ms. These are unpassed observations, not certified noise.
No A/A, p95, memory/retained-resource or native acceptance claim is made.

As #952 R2 §2 permits, stop after the definitive WAL failure rather than run
the expensive remaining matrix. No new 1-row series, controlled A/A/ACK/memory
certification, SIGKILL boundary injection, five-cycle retained-resource test or
real native batch/paste→ACK→undo→redo→reopen acceptance was performed. Existing
unit/reopen tests do not substitute for those gates. Electron target 44.3.0 is
verified from `version`; Windows/SMB/OneDrive/power-loss/enterprise capacity remain
unmeasured. The historical 1-row, warm ACK and RSS concerns remain open.
