# Corrected primary call chains — Collection, Main 5b8c1e6f

Source is `/tmp/buyerlog-post901-baseline`, Main
`5b8c1e6fde347df12f211b06af4dd27e5c5fb125`. This replaces the primary CP-led map;
its unchanged original remains in `prior-cp-auxiliary-20261107/call-chains.md`.
No code/test/benchmark/trace executed. Source offsets below are under resources/app/.

## 1. Collection single-cell/group mutation and whole-workspace local cost

`public/app-main.js:29493–29507` `kolApplyCollectionCellChange` dispatches ordinary
cells to `commitKolEditor:28577` and `pricing:<manufacturer>` to
`commitKolPriceEditor`. Editor ownership/linked-variant guards precede mutation;
`28643–28677` compares the effective value, captures `kolPushUndo`, writes through
`kolWriteGroupedStorageValue`, clears coupled note HTML, propagates model notes
to same-PLM peers except overridden variants and optionally synchronizes quotation
model fields. These are semantic edit units, not independent generic scalar paths.

`kolWriteGroupedStorageValue:25220–25235` routes explicit variant overrides,
parent shared values and ordinary row fields differently. `collection-model-groups.js`
`setSharedValue:196–212` defaults to cloning all rows, updates parent shared state
and linked materialized values without clobbering variants. `setVariantOverride:215`
also defaults to all-row cloning and writes both variantOverrides and row value.
`normalizeRows:54–60` JSON-clones every row; `kolNormalizeModelGroups:25100–25103`
invalidates value-reader caches then invokes that normalizer.

`saveKolRows:26004–26027` normalizes all rows, serializes all rows into BLStorage,
serializes the full owner workspace into localStorage, writes full pending state,
queues a workspace save and schedules summary refresh. Read-only/Multi-Buyer view
projections must remain unwritable. `kolPersistPendingWorkspace:22736–22750`
currently stores full rows plus full baseline rows/structure/expectation sets,
owner and revision; its failure is surfaced. These local copies are CPR-02's
primary cost even though the later HTTP body already contains only changed rows.

## 2. Existing row PATCH, row CAS, ACK and recovery (reuse before new transport)

`kolCaptureBaseline:22833` stores owner-scoped persisted rows and structure.
`kolPersistableRow:22803–22809` excludes transient shared/server image URLs.
`kolCollectChanges:22900–22924` scans all rows, emits whole-row upserts and explicit
deletes, carries existing/new ID expectations, and attaches structure + its own
baseRevision only when changed. Rows use their captured `_rev`; workspace revision
is not substituted for every row's CAS. `kolMergeLocalRowDelta:22882` replays only
the local difference over a remote row and preserves remote `_rev`.

`kolSaveWorkspaceNow:23081–23176` serializes a captured payload; PATCH for row mode,
PUT for full fallback, explicit `atomic:true` when requested. It updates baseline
only for returned applied rows, retains conflicts/new local dirty state, guards
late ACK against owner switch, and can bounded-rebase non-atomic own-workspace
conflicts. `kolQueueWorkspaceSave:23176` waits 350ms, but that debounce does not
remove the earlier full normalization/local serialization.

`server/routes/oab-batch-routes.js:86–125` is the actual Collection PATCH route.
It refreshes permissions, resolves owner/edit access, submits the existing
`collectionSaveWorker` in rows mode, emits owner-bound live patches after local
save, then reports owner replication separately. HTTP 200 may contain applied rows
and conflicts. `server/server.js:3797–3827` is full PUT fallback, not the row route.

`server/lib/collection-save-worker-client.js:24–31` uses an existing persistent
Collection save worker and queue-by-owner. `server/collection-save-worker.js:67–88`
parses rows mode, passes existing authority/source guards into
`collection-workspaces.applyRowChangesAsync`, and returns compact receipts.
Reuse this mechanism; create no new worker/pool. Its generic-document/native
commit path is conditional on existing authorization/store mode, so not every
ordinary Collection save can be described as a WAL ACK.

`collection-workspaces.js:735–780` preserves row creation/existence expectations
and row `_rev` CAS; `789–805` protects explicit delete including legacy revision 0;
`806–820` rejects an entire `atomic:true` batch on conflict. `841–857` separately
checks structure revision and retains unlisted rows during reorder.
`888–897` holds the owner-workspace lease, checks authority, and commits only when
changed via the supplied native hook or atomic legacy file write. Unchanged/all-
conflict requests do not write or bump revision. `879–883` uses row patches unless
structure requires full reload. Client `kolApplyRemotePatches:38508` maintains
baseline/dirty/editor behavior; do not replace it with unguarded generic assignment.

## 3. Collection inverse undo and bulk atomicity — CPR-03 primary target

`kolSnapshot:26804` JSON-clones all `kolRows`; `kolPushUndo:26805–26810` retains
up to 50 snapshots. `withKolBulkDraft:26814–26819` clones rows, manufacturers,
custom schema, captured change and before/after while isolating/restoring globals.
`kolBulkHistory:26839–26859` fences owner/revision/dirty state, prepares a draft,
sends `atomic:true` and moves bulk history only after primary ACK.
`kolUndoLocal/kolRedoLocal:26863–26884` swap full row arrays and persist; this local
path is not identical to acknowledged bulk history.

`kolRebaseBulkHistoryTail:26821` and `kolSyncAcknowledgedModelFields:26825–26837`
already preserve later local changes and report image/quotation projections
separately. A patch history needs equivalent group closure, owner, ACK and rebase
behavior plus a byte limit; simply exchanging before/after fields is insufficient.
New Collection command records must address row IDs within an owner, not CP line
triples or current array ordinals.

## 4. Owner sharing is a distinct full-envelope cost — DS-09

`collection-workspaces.js:444–450` identifies local documents as
`collection-workspaces/<owner>.json`, optionally backed by createDocumentApi.
`collection-replication.js:7–19` excludes these owner workspaces from generic
shared-delta transport, including retired shared-collection evidence.
`remoteWorkspaceFile:34` has a separate owner namespace.

`recordBase:337–351` writes/retains the full base workspace plus envelope/workspace
hashes. `publishOwnerCas:464–516` loads/hashes the full workspace, leases/reads the
remote full envelope, checks revision AND observed parent-envelope ancestry,
writes a full integrity-protected envelope, then records the full base.
`syncForUser:520–564` checks owner permissions/read-only mode and preserves equal-
revision divergence, interrupted local-newer publication and unproven ancestry.
Existing reconcile/three-way conflict recovery remains authoritative.

A future row/field delta needs owner-scoped head ancestry, idempotent operation IDs,
checkpoint/replay/partial-publish recovery and peer versioning. It must preserve
the separate transport boundary and view/edit/revoke semantics; ordinary local
row PATCH or generic store mirroring is not DS-09 completion.

## 5. WAL batches and checklist are required companion contracts, distinct stores

`local-db.js:778–807` validates/stages operations under one DB lease and writes
checksummed WAL lines with fsync before return. `queuePatch:1074` is single;
`queuePatches:1083–1088` batches patch operations. `tombstone:1091` remains single;
`delta-store.removeMirrored:290–300` loops one tombstone transaction per ID.
Use a real native multi-operation interface for deletions/bulk semantics; patch
payloads must not pretend to be tombstone records. One lease/write/fsync is not
yet proof of all-or-nothing crash replay across multiple WAL lines.

`public/cp-overview-assistant.js:377–398` `saveAnswers` serializes the full answer
store. Existing `batchChecklistAnswers:400–415` coalesces only notifications and
explicitly saves answers individually. `setChecklistAnswer:417–460` validates
scoped components, option reuse, evidence preservation and monotonic local/remote
timestamps, then calls saveAnswers. Bulk UI `4187–4213` uses that wrapper but still
loops per answer and finishes with recompute/render/sync/column refresh.

`checklist-supplier-sync.js:209–230` separately persists pending answers;
`319–369` drains up to 200 and accepts only acknowledged keys, retaining newer,
denied/conflicting changes. Evidence `2593–2619` calls answer save, sync and render;
`2639–2641` binds both input/change to it. A new durable batch must reduce actual
storage/journal commits, not just notifications. Small text dirty intent must be
durable before delaying expensive work, with blur/close/account flush.

Server checklist routes/store remain a separate leased JSON/recovery boundary
(old packet has exact route/store anchors). They do not currently append through
localDb WAL. Preserve live scope, accepted keys, evidence and inverse receipts;
do not promise one Collection+checklist+CP transaction.

## 6. CP and raw-source notes retained only where applicable

`cp-shared-store.js:15` entity `cp-order` is CP Tracker overrides. Its field-owner
resolver, `/api/overrides`, SuppFOB fences and `withCpBulkDraft` are not Collection
single-cell persistence. `collection-pricing-service.cpRows` is authorized CP
context used to price Collection rows; it is not the Collection owner store.

The prior packet's immutable compute-source owner/generation lease, borrowed
nested read-only values, native WAL ACK versus detached HTTP mirror, and separate
checklist store notes remain true constraints. Retain unknown custom persisted
fields and canonical bindings; root-owned source/compute changes stay serial with
#909 DS08 and existing common pool contracts. No source-owner transition or 6c
completion is implemented by this corrected design.
