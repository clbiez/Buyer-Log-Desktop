# Internal projection-ready-orders worker seam — prepared, unrun

No test, syntax check, module load, server or benchmark was run. No product file
or previous fixture/result was changed. Root's live CP A/B campaign and common
lock were left alone. Source pin is full
`b6c8504ae418ebe731af7000f33e0eb1aa2f9f17`; exact blobs/SHA256 are recorded in
`source-pins.json`.

`reference/` contains the actual current worker/service. `candidate/` contains
only their adapted copies. The worker calls root's already-adopted actual
`server/lib/projection-ready-json.js`; that file uses actual canonical fields,
public schema8fe and `server/lib/projection-native-json.js` (unchanged f4a).
Neither the adopted helper/cache nor the earlier builder packet is overwritten.

* `worker-service.patch`: one additive internal task branch, one metadata charge
  extension, one `projectionOnly` admission inclusion. Existing private-view /
  details paths are untouched.
* There is no helper-adoption patch: those product dependencies already exist.
  Stale candidate helper/native copies were removed. Root's current descriptor
  cache SHA `ed88794d…` remains untouched; no second schema/codec/source cache/
  worker/HTTP route is introduced.
* `projection-ready-worker.test.cjs`:13 new actual native tests, deliberately
  targeting the real app. The same assertions support root's unknown-task RED
  before adoption and GREEN after adoption.

## Actual baseline and generation correction

`compute-worker.js:46–66` already has projection-private-view/details. It checks
token owner, raw-size admission, compressed SHA, gunzip output cap and actual raw
length, then uses the existing common transfer path. It does not acquire the raw
source cache on that branch. `compute-service.js:75–99` checks descriptor capability
and current compute generation, charges encoded params, returns the existing
output lease, and rechecks generation after native completion.

**Page generation and compute generation are distinct.** Actual
`projection-shadow-http.js:23` sets `token.sourceGeneration` from
`manifest.activeGeneration`; the existing native fixture already uses page-g1
with a different service generation. The candidate never forces equality.

`projection-view-core.bindProjectionPin` is an **existing exported method**, at75
in blob `e678fc64…`; it validates existing TOKEN_KEYS/PIN_KEYS and module/input/
context linkage. The candidate uses it only for those validations and discards
its rebound token. It does not claim the HTTP router calls that method.
The router's actual `bind` at13–26 computes `sourceRevision` as
SHA256(JSON.stringify([manifest.sourceRevisionKey, compressedChecksum])); the new
task uses exactly that formula. No new token helper was invented.

## One private job contract

Call existing `service.run('projection-ready-orders', descriptor, params)`.
The captured job params contain:

```js
{
  projectionBuffer, projectionCompressedBytes, projectionBytes,
  projectionChecksum, projectionPin, computeGeneration,
  token, viewInfo, schema, omittedKeys
}
```

`projectionPin` uses the **existing core PIN_KEYS shape**, populated internally
from the checked full projection manifest/module entry:
`schemaVersion`, `cacheGeneration`, `sourceLoadedAt`, `sourceRevisionKey`,
`module`, `moduleInputKey`, `sourceProjectionKey`, `contextHash`, `checksum`,
`uncompressedBytes`. Actual page-cache schemaVersion at this pin is2; the core
validator's existing supported shape/positive-version rules are reused. This DTO
is not the separate seven-key page-cache view-artifact pin (which has planHash).
No cache pin format or existing manifest is changed by this packet.

Identity/integrity checks before builder entry:

* token + view owner equal actual service/source owner; token module is Orders;
* **computeGeneration** equals current descriptor.generation, independently of
  page token.sourceGeneration;
* page token.sourceGeneration equals projectionPin.cacheGeneration and stable
  viewInfo.sourceGeneration;
* exact sourceLoadedAt and descriptor.projectionKeys.orders proof match the
  pin/token source projection identity; unknown source-key proof fails closed;
* existing core token/pin contextHash, moduleInputKey and sourceProjectionKey
  checks pass; token sourceRevision matches the actual router checksum formula;
* stable viewInfo actor/access/source/plan epoch match token, and `String(planEpoch)`
  equals this internal ready task's token.planRevision;
* exact compressed byte length and SHA match; declared full raw size is positive
  and at most128MiB; input gzip is at most64MiB, matching the existing private path;
* gunzip is bounded to the declared raw length, actual length equals it, and
  SHA256 of the actual raw bytes equals viewInfo.fullJsonSha256 before JSON.parse.

Byte-offset ArrayBuffer views are normalized using their exact offset/length;
no pooled backing bytes outside the selected gzip range enter the hash.
`schema`, `omittedKeys` and the plan epoch must come from the **trusted server's
captured schema/dependency plan**. None of these comparisons grants IAM access
or proves consumer closure. A matching client payload is not authorization.
The actual caller must capture and recheck owner/actor/access/current manifest
and context before publishing a response. No new HTTP forwarding is supplied.

## Output and bounds

The branch parses only the pinned cached projection, invokes the existing
prepared ready builder and transfers a newly owned ArrayBuffer using the current
worker's transfer list. It never loads/re-clones the raw model source snapshot.
Ready output uses the single ordinary JSON/gzip format from that helper:
`{kind:'ready',buffer,uncompressedBytes,checksum,registryKeys,info}`.
Ready gzip stays at most32MiB and raw at most128MiB+64KiB metadata.

If schema/registration/canonical/builder bounds require full fallback, the task
transfers the **exact original verified compressed bytes**, with
`kind:'full'`, reason, original raw byte count and original checksum. It does not
re-serialize/re-gzip, ship the parsed full graph back, or invent an authoritative
empty registry. Original full input gzip may be up to64MiB;32MiB is the ready
helper's output cap. Request nonce/generation do not enter cached ready JSON;
per-request HTTP echo remains later caller work.

Service admission now includes this task in the existing projectionOnly formula:
96MiB + declared raw bytes×6 + actual serialized parameter bytes×3. Encoded input
is charged and transferred as before. The worker's existing metadata/output
accounting additionally includes ready info+registryKeys with the same×4 metadata
charge. The normal pool output lease and idempotent release remain unchanged.
Existing current-generation post-check still rejects late outputs and releases
the lease. No new pool or retention mechanism is added.

## Exact root RED / adoption / GREEN commands — all UNRUN

The test defaults to
`/workspace/buyerlog-post-main-acceptance/resources/app`; override only with
`BUYERLOG_READY_APP` for another actual checkout. It uses real common service,
pool, worker, actual parser/serializer and public schema helper. It does not load
the candidate worker through a test stub or change assertions between arms.

After the live campaign releases the common lock, root can record the first
unknown-task RED against the unchanged worker:

```sh
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock env TZ=UTC node --test --test-concurrency=1 --test-name-pattern='new task ready roundtrip' /tmp/buyerlog-phase6a-ready-worker-preparation/projection-ready-worker.test.cjs
```

Expected baseline failure is the current unknown compute task surfaced through
the pool as `COMPUTE_WORKER_FAILED`. The first fixture keeps a valid source
replica so this does not instead fail a deliberately corrupted raw source read.
No RED receipt or fabricated execution evidence has been created here.

Root-only review/adoption commands, not run by this agent:

```sh
git -C /workspace/buyerlog-post-main-acceptance apply --check /tmp/buyerlog-phase6a-ready-worker-preparation/worker-service.patch
git -C /workspace/buyerlog-post-main-acceptance apply /tmp/buyerlog-phase6a-ready-worker-preparation/worker-service.patch
```

Then run the same assertions plus the unchanged current private task regression:

```sh
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock env TZ=UTC node --test --test-concurrency=1 /tmp/buyerlog-phase6a-ready-worker-preparation/projection-ready-worker.test.cjs /workspace/buyerlog-post-main-acceptance/resources/app/tests/projection-private-worker.test.js
```

The13 prepared cases cover ready/full native roundtrip and leases, a damaged
raw source on a new worker proving no source hydration, canonical/unknown full
fallback, separate page/compute generations, each stable identity binding,
descriptor proof against mutually forged pin/token, exact compressed hash/size,
gunzip cap/actual length/raw SHA, early service bounds, byte admission, metadata
lease charging, offset views/nonce stability and post-completion generation change.
Old assertions are preserved, not copied and weakened.
The13 assertions/fixture remain unchanged after root's inspection; their SHA256
is `f44ac59f…`. No extra cache test was added. Root's existing descriptor-cache
tests remain the separate coverage for the already-adopted cache.

The combined guard/helper traversal cost is **not** measured by the old f4a
campaign. No performance gain, default thin change, producer/cache/HTTP adoption,
details authorization completion or Phase6a completion is claimed.
