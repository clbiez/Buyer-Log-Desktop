# Real shared-worker ready cost — preparation only

`run.py` and `measure.cjs` are **unrun preparation**. No import, syntax check, tests, server, benchmark, source fixture generation or production edits were performed. Root must freeze the actual current app after its tests and supply the exact HEAD/app-tree receipt. Existing native CLI/performance benchmark scripts are untouched. The incomplete `/tmp/bl6cp1` cohort is not reused or retried.

## Real source and scope

The read-only source is `/tmp/buyerlog-first-transition-Hxb1BB/local/model-snapshots/moderator.json.gz`: 9,977,311 compressed bytes, 129,377,850 decoded bytes, SHA-256 `e858d85fd76a1db2858098b820a0c5e20e8466d3c3895e12ad6c93c9ab9530dd`. Read-only inspection found a schema-v2 actual model snapshot with ASAS/Antrepo parser-origin payload. Its bytes match the genuine Phase 0 fixture's snapshot exactly. The coordinator also pins the genuine Phase 0 measurement SHA and marker metadata (synthetic, 30,000 rows, seed 7). It does not open, copy, change or regenerate the three source XLSX files.

Each fresh process calls the current application's `loadModelSnapshotAsync('moderator')`, which performs the real snapshot checksum/alias expansion/date revival. It adds exactly two declared synthetic model keys to the **true in-memory ASAS `_cpExtra` bags before projection generation**. Values are deterministic by original ASAS ordinal: zero, false, null, empty string and bounded ASCII payloads (192/256 characters). Existing fields, source arrays, target maps and Antrepo objects are preserved. This is an explicitly augmented synthetic producer workload, not the untouched historical 30k output.

The packet requires the restored CP/Orders rows to be the same references in the same order and their Antrepo source to be the same object. It never manufactures aliases or overwrites `asasOrdersByTarget`/`antrepoMapByTarget`. Distinct actual topology or unknown schema is a legitimate eligibility blocker; the packet records failure instead of inventing a known schema. If blocked, root's smallest setup is a separately authorized native refresh of the original synthetic Excel source with both CP and Orders targeting the same real ASAS/Antrepo source, plus actual server model definitions and schema exposure policy. Such a setup must produce a new owned snapshot and new pins; do not repair this measurement by altering maps or annotating cached JSON. No such setup has been executed here.

`codec.encode` measures the actual V8 source encoding; its real byte length is passed to `seedSource` without downcharging. The actual worker-produced replica checksum/file size is recorded separately, because structured clone can change V8 encoding representation. The descriptor and projection source keys come from `seedSource`, and module input keys from the actual `projection-plan` task. Fresh full gzip bytes come from the actual `projections` worker task. They are never taken from or appended to the old cached Orders JSON.

The local synthetic trusted policy is explicit in the saved parameters: moderator/all-source view, native `createAccessContext` hash, empty overrides/horizons, native unconfigured calendar, two model definitions, and explicitly true schema exposure/target/binding flags. These flags mean the local diagnostic caller has established the stated synthetic topology and definitions; they are not client inputs or a live session authorization claim. The local context hash binds these exact params, the actual replica checksum and native calendar day. Page/read pins bind the **newly generated** full gzip checksum/length, real descriptor generation/key, real plan input key and local policy. Cache generation and source-revision fields are explicitly local measurement identities, not copied production cache claims.

## Measured comparison

Six fresh Node processes alternate A/B, B/A, A/B. Both arms load/augment/encode/seed the real source and obtain the native projection plan. These setup costs and main heap observations are recorded separately and are not credited as thin-client savings.

- **A:** ordinary native `projections`, without `collectModuleSchemas`.
- **B:** native `projections` with `collectModuleSchemas: true`, followed by `projection-ready-orders` on that exact generated gzip and returned schema.

B's `pipelineWallMs` includes native projection generation, callback schema construction, real gzip/IPC, pin construction, ready guards, ready serialization/gzip and the second real IPC. The standalone ready stage is also reported, but is never compared directly with A's complete producer as if the prerequisite full graph were free. These costs differ from old f4a/builder/transport experiments; none of their timing results are carried forward.

The source and full wire graphs are never represented as thin-client gains. Before post-timing verification, the main thread receives compressed buffers and native schema metadata; it does not inflate a full graph to obtain the ready input or full JSON hash. The ready worker derives that hash from the exact gzip. The main source graph used to seed the worker was already materialized and is explicitly reported, then released before measured producer work.

Each job reports native `paramsSerializeMs`, `paramsBytes`, admitted input bytes, `queueWaitMs`, worker `executionMs`, pool `durationMs`/`postMessageMs`, `retainedBytes` and leased `outputBytes`. A minimal subclass observes the **same existing native Worker file** and actual transfer lists/message events. It records actual `postMessage` call duration, buffer detachment and message round trip. `roundTripMinusWorkerExecutionMs` is **combined scheduling/input decode/output delivery overhead**, not an isolated pure output-copy measurement. No worker source or protocol is replaced, and no new worker implementation is introduced.

Main heap/RSS snapshots and 100 ms sampled peaks are labeled; RSS covers the process including worker threads, while `heapUsed` is main-isolate heap. Native retained-byte metrics and optional native `Worker.getHeapStatistics()` after the timed pipeline describe the worker. Statistics queries and correctness parsing are outside the measured pipeline. `--expose-gc` enables explicit GC only at declared premeasurement source-release boundaries, identically for both arms; no GC occurs inside the timed pipeline. Native Date behavior stays enabled in `Europe/Istanbul`; crossing a calendar day stops the cohort.

Correctness verification then inflates the genuine generated full JSON, checks all 30,000 rows, restores the two omitted keys by **original full-row ordinals only**, preserves key order/presence and compares every remaining nested value. Zero, false and null are counted. The actual current `app-main.js` date normalizer is extracted by the application's existing function-extraction helper and applied after restoration. Full raw-row and normalized-row SHA-256 values must agree within B and across all six processes. No business-ID matching, sorting, slicing, sampling or normalized fake rows are used. Verification necessarily materializes full graphs; its time/heap are outside producer timing and explicitly not a client benefit.

## Production budgets and bounded artifacts

The pool uses the production service's actual choices: `maxPendingBytes: 512 MiB`, default automatic worker count and default machine/constrained-memory byte budget, default worker resource limits and default 2 GiB source-replica reservation policy. Only the Worker observation class differs. No pool/source estimate is overridden to force admission. Any admission rejection is retained and stops the cohort; no automatic retry or budget increase.

The wrapper imposes separate **probe safety limits**, not production tuning: actual encoded source at most 192 MiB, complete source decoded at most 160 MiB (the pinned source is 129,377,850 bytes), native full projection at most 128 MiB, 512 MiB total packet disk cap, 640 MiB free disk before each arm, and 128 MiB emergency free-disk floor. The real service creates its ordinary temporary typed replica under the new packet and removes only that private replica during native `service.close()`, after native worker exits. It never copies the old fixture/snapshot/XLSX or deletes old evidence. Failures preserve their JSON/logs and any incomplete native private files for root inspection. Per-arm output is bounded metadata/logs, not six retained full wire graphs. The process timeout is 20 minutes. No server/browser/external-data access is part of this packet.

## Root execution after freeze

Root creates a factual receipt outside this preparation:

```json
{
  "head": "ACTUAL_FULL_FROZEN_HEAD",
  "appTree": "ACTUAL_GIT_HEAD_RESOURCES_APP_TREE",
  "testsStatus": "passed",
  "testEvidencePath": "/absolute/path/to/root-test-evidence.log",
  "testEvidenceSha256": "ACTUAL_SHA256",
  "exclusiveMeasurement": true
}
```

Then root alone may run, with no concurrent test/performance/source mutation:

```sh
python3 /tmp/buyerlog-phase6a-ready-worker-cost-preparation/run.py --root-pin /absolute/path/to/root-pin.json
```

The coordinator itself acquires nonblocking exclusive `flock` on `/tmp/buyerlog-performance-measurement.lock`; do not hold a second independent flock around it. App HEAD/tree, clean app files, test evidence and synthetic snapshot pins are rechecked before every arm. A pre-existing `runs` directory refuses reuse. Native Node processes have separate sessions; timeout/disk failure triggers scoped TERM then KILL, preserving evidence. Successful process exit additionally requires the native pool's worker-exit proof and zero output leases. Native worker threads are tracked by thread ID/exit events inside that process; this packet does not claim kernel fork-event tracing.

The final `series.json` retains every arm, setup stage, source/descriptor/plan/parameter receipt, actual IPC metrics, heap observations, correctness SHA and pairwise producer/payload differences. `formalAcceptance` stays false. This packet supports a cost decision only; it cannot establish application latency, browser memory, Phase 6c source ownership, merge readiness or a renewed First CP acceptance result.
