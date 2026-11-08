# Collection canonical source feasibility — Main1796193f

**Read-only feasibility, no new implementation or tests.** This follows root's
latest narrower instruction. No syntax check, module load, test, browser or
benchmark was executed. Earlier field19/group22/native27 packets and receipts
were left unchanged. Product reads used only `git show 1796193f:<path>`, not
working-tree 6a/f076 changes. Exact blobs are in `source-pins.json`.

## Direct answer: synchronous DB read

**[Confirmed] `createLocalDb` exports no synchronous `read`/`peek` API.**
`local-db.js:869` exposes `async read() { return ensure(); }`; its complete
returned API is at line1590. `cachedState` is private at643. `loadState` verifies
DB/current-WAL/previous-WAL filesystem tags asynchronously at660 before reusing it.

The existing synchronous API is **`deltaStore.readAllSync(collection)`** at
`delta-store.js:281`, backed by its own hydrated memory map. It returns null
before hydration or for an empty collection. `createDocumentApi.read` at448
only uses it in authoritative delta modes; `collection-workspaces.loadWorkspace`
at509 then silently falls back to JSON when that read is null. This is not the
requested fail-closed readiness/active-source contract.

There is another important distinction: `deltaStore.mirror` calls `stage` at188
before its queued durable operation completes; `stage` at214 publishes optimistic
memory and installs a conditional rollback. `readAllSync` therefore is not a
guaranteed confirmed-commit view. Generic hydration also rebuilds all collections.

**[Confirmed] Merely exporting `localDb.cachedState` as `peek` is unsafe.**
`appendOperations` applies operations to that state at796, then awaits WAL write
and `sync` at807. Its raw cache can hold uncommitted effects while an append is
in flight. An authoritative synchronous getter needs a separate **committed
Collection view** published only after native completion, not a raw cache alias.

**[Confirmed] `await localDbReadyPromise` alone is insufficient.**
`server.js:209–233` ensures/configures the DB, schedules maintenance, and logs
and catches failure. It does not establish a validated Collection cache, and the
promise can resolve after setup failure. The generic hydration at184 is in the
maintenance/seed path and likewise catches errors. `/api/data` awaits the DB
promise at8505, but that is not a Collection-specific source readiness gate.

## Smallest five integration seams

These are five logical seams, not a claim that five lines or exactly five
functions suffice. A source/API change is expected Phase6c implementation work;
it is not an automatic approval blocker and needs no new SQLite/DB/worker.

| Seam | Actual current entry points | Minimum necessary change |
| --- | --- | --- |
| 1. Canonical source facade and committed read view | `collection-workspaces.js:450,509,939` (`attachDeltaStore`, `loadWorkspace`, `listOwnerIds`) | Attach one Collection source facade initialized asynchronously from existing `localDb.read()`. Preserve synchronous `loadWorkspace` by reading its committed owner view. Publish a view only after verified initial load/native durable completion. Before initialization, on failed refresh, missing active rows or retired namespace, throw a source-unavailable/integrity error; never silently fall back to JSON. Enumerate native owner heads through this facade too. |
| 2. All local full/row writers | `collection-workspaces.js:520,643,888` (`saveWorkspace`, `saveWorkspaceAsync`, `applyRowChangesAsync`) | Plan against current native owner state under existing owner-file then DB lease ordering; reuse actual `applyRowChanges` for row-CAS/atomic/partial semantics. Commit changed row records plus header/order/tombstones/receipt in one existing `privateRecordTransaction`. Full PUT keeps whole-workspace expectedRevision CAS when supplied, including its existing absent/null behavior. The old synchronous durable `saveWorkspace` must become awaitable; do not return success from optimistic staging. |
| 3. Existing persistent save worker | `collection-save-worker.js:62–97`; `collection-save-worker-client.js` | Both ordinary row mode and authorized row mode, plus full mode, must use the same facade contract. Source selection cannot depend on optional `task.authorization`. Initialize/refresh its isolate's facade before each admitted write; after durable result, main refreshes/publishes the confirmed owner view before HTTP ACK or owner publication. Reuse this worker and current per-owner queue; introduce no new worker. |
| 4. Replica replace and compatibility mirror | `collection-workspaces.js:425,904`; `collection-replication.js:419–429,468,529,578` | Keep the existing full-envelope three-way merge and owner ancestry protocol. Under owner lease, translate its complete incoming/merged workspace into changed rows/meta/order and explicit row tombstones; enforce exact current checksum CAS inside the native preparation. `mirrorWorkspace` must stop reading old JSON as its source after native activation. Any optional compatibility JSON is an export/checkpoint, never a second authoritative write and never a fallback. |
| 5. Startup/admission, cache coherence and legacy sync callers | `server.js:184,209,661,3804`; `user-restore-service.js:263,283`; internal `collection-workspaces.js:56,418,974` | Add a checked Collection-ready promise/state distinct from the currently swallowed DB initialization promise. Async GET/publish/sync/backup/restore admission refreshes or verifies the committed owner generation before the synchronous getter is used. Update the existing synchronous save/recovery/image-clear/restore callers to await the async durable facade. Gate worker tasks by the same source/store version. |

`local-db.privateRecordTransaction` at837 already provides the required awaited
prepare callback under the native DB lease, one checksummed private frame and
fsync-before-return. No new native append API is needed for this proposed seam.
`queuePatches` is not the replacement for an atomic owner header/row/receipt
frame, and generic `documents.mirror` is not the canonical private write path.

## Cache coherence: what the synchronous getter can promise

The facade can retain a synchronous getter after an async readiness barrier,
with immutable/COW owner views whose revisions were confirmed durable. It must
not retain references into the native cache that a subsequent append mutates.
Changed rows/header are published after the promise resolves; untouched owned
rows may be shared read-only. Failed/unknown writes do not publish an optimistic
view; retry the same transaction ID and refresh from native durable state.

Main and the existing save worker have separate module graphs and memory maps.
A worker completion cannot by itself update main's map. Refresh after its ACK,
or accept an exact owner-bound committed revision/patch only after verifying the
current native generation; a late older worker receipt must not replace a newer
view. Native writes still serialize under the real DB lease.

There is **no existing cross-isolate/process committed-cache invalidation API**
in the inspected files. Therefore a sync getter alone cannot guarantee it has
observed another process's latest native commit. Async admission/refresh at the
already async route/replication/backup boundaries is the smallest honest initial
contract. Every write must re-read/validate current owner state under its native
lease regardless of cache. If strict fresh reads are required at arbitrary
synchronous internal call sites, those callers also need an async refresh or a
new explicit freshness protocol. Startup hydration alone does not solve it.

## Full APIs, group values and byte identity

Capture the **current canonical `loadWorkspace` output**, including its current
normalization, not arbitrary raw disk JSON. Preserve ordered rows, all actual
row IDs and their types, exact `_rev` presence, unknown row/header keys,
`modelSharedValues`, `variantOverrides` presence and materialized values. No
scalar helper substitutes for group semantics. A touched-row store needs a
separate ordered membership/header representation; missing/duplicate IDs need
an explicit legacy identity migration or a blocked/fallback full checkpoint
path, not guessed IDs.

`collection-replication` uses SHA256 of **`JSON.stringify(workspace)`**, including
top-level property insertion order (`publishOwnerCas:468–491`, replace checksum
guard `collection-workspaces:909`). A split reader that appends `rows` and
`_revision` at different positions can change same-revision identity. Persist
the captured top-level key order (or an equivalent exact full header skeleton)
and materialize values at those slots. Do not normalize/reorder a second time.
Existing full save builders at530/654 enumerate known keys; preserving unknown
metadata during adoption and ordinary row edits must not accidentally inherit
that full-replacement loss. Full-save transformation policy remains explicit.

The full incoming owner envelope should still be interpreted by the **actual
existing merge implementation**. Only after it produces a workspace does the
facade compute persistence deltas under owner lease/native CAS. Preserve the
existing no-base, delete/edit, ID collision, blank-text and displaced-intent
semantics and the envelope/base ancestry receipts. Small local WAL commits do
not make DS09 owner publication incremental or remove its current full hashing.

## Minimum safe cutover, retirement and rollback

1. Establish one owner source/store-version gate across the five seams above;
   drain/fence old worker/full-save/replica writers first. This is a code/version
   rollout prerequisite. Old code ignores a newly invented native marker, so
   a marker alone cannot fence it. Old HTTP clients can remain on the same full
   API through the new facade; old local server binaries are a separate issue.
2. With the current owner lease held, refresh the actual selected legacy source,
   validate its exact canonical checksum/revision/identity, then atomically
   install row/header/order plus a native active-source marker in one existing
   private frame. Lock ordering stays owner-file -> native DB, matching existing
   row commitSaved. Recheck fresh authority before append and after durability.
3. Publish the committed cache only after fsync. From that active marker onward,
   missing/corrupt native state fails closed. Old JSON is historical recovery
   evidence; stop authoritative JSON writes. A failed pre-commit adoption leaves
   legacy selected; an unknown append result is resolved by the same operation
   ID/native marker, not by guessing which source won.
4. For deletion, keep private row tombstone records in the **same private frame**
   as new membership/head. `privateRecordTransaction` only assigns records; it
   has no atomic private deletion list. A generic `localDb.tombstone` is a
   different event/frame and must not split owner membership from deletion.
   Readers must obey current membership plus tombstone/epoch; a referenced
   tombstone or missing member is an integrity failure, not an empty row.
5. Retire a namespace with a durable control/epoch tombstone; do not physically
   `delete state.records[...]` in a snapshot mutator. Existing `.wal.bak` replay
   reassigns private records (`local-db:598,832`), so mere snapshot deletion can
   resurrect them. Preserve explicit retirement through checkpoint/replay.
   A post-cutover rollback cannot flip back to stale historical JSON. Roll back
   code only to a version that understands the native source, or perform an
   explicit current-state export/reverse migration with its own durable switch
   protocol. That latter cross-file transition is not supplied by the existing
   one-frame native API and is not implemented here.

## Remaining scope and evidence

This establishes feasibility of a synchronous **committed Collection view** on
the existing JSON/WAL backend, with async durable writers and explicit readiness.
It does not establish a transparent drop-in source switch with zero caller/API
changes. Those changes are expected Phase6c work, not a reason to ask the user
for an unrelated DB migration. No SQLite, new WAL or new worker is needed.

No code, adapter or test was produced after the narrowing instruction. Future
native validation should cover exact JSON-order checksum identity, cold replay,
row/group/meta presence, full PUT CAS vs row CAS, native private tombstones,
namespace retirement through WAL rotation, late worker ACK cache fencing,
read-before-ready failure and lost cutover ACK. Earlier native27 PASS belongs
only to its immutable prototype and root receipt; it is not adoption validation.
Windows/Electron lifecycle, mapped drives and shared SMB source/version fencing
remain unverified. No timing gain or Phase6c completion is claimed.
