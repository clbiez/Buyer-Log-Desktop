# Verified current call chains (Main 5b8c1e6f)

## CP field edit and transport

app-main.js `resolveCpEditorRow` (9902) checks ordinal + canonical line + session
owner. Edits update display row/override maps, derived formulas and peer rows.
`lineKeyOfRow` (11553) normalizes order/model/colour; `lineIdentity` (11561) only
sends model+ccode when both exist. Server db.js `overrideWriteKey` (709) otherwise
falls back to order code. Do not invent a unique source-row identity here.

`syncOverridesFromRow` (13062) builds existing override intent;
`saveDateOverrides` (13165) coalesces only touched date keys and preserves automatic
Ex-factory read-only rules; `syncOverrideToServer` (13219) debounces notes and
includes related manual-price/metadata/custom-note intent. `_pendingOverrideWrites`
(13134), flush (13149) and settle (13160) drain before refresh.

override-sync.js `enqueueOverrideMutation` (19) serializes requests, captures bulk
PATCHes by order/model/ccode, merges composite fields (24), adds current revision
and SuppFOB headers (31-36), updates revision stamps on ACK (38-41), and reloads on
409 (44-49). It does not auto-rebase a rejected write against newer data.

server.js POST `/api/overrides/batch` (9974) / PATCH `/api/overrides/:orderCode`
(9997) run order scope, shared-owner and automatic-date checks, call db helpers,
then rewrite derived projection cache and emit live row patches. A derived-cache
failure does not make the saved source write disappear; stale caches must rebuild.

db.js `patchOrderOverride` (907) / `patchOrderOverrides` (987) validate orders,
SuppFOB and optional note-definition revisions; `applyOrderPatch` (739) preserves
legacy fallback and server-generated note metadata; saveOverrides persists the
compatibility projection. CP mirror calls are detached at 924/1013.

## Bulk ownership, three-way ACK and undo

app-main.js `withCpBulkDraft` (9836) currently structured-clones the entire override
root and each targeted row before running isolated edit code. It restores global
state in finally. `applyAcknowledgedCpDraft` (9843) compares before/after/current,
updates only unchanged-since-capture row fields, then derived state and ACK events.
Its JSON equality conflates missing with own undefined and map-ACK application
does not carry the same per-slot three-way condition; proposed helpers need
presence-aware units without silently changing source/writer semantics.

`pushUndo` (9864) binds history identity; `orderLinePeerRows` (9877) uses the
owner-partitioned peer index; `bindCpHistoryIdentity` (9887) records owner/line.
`syncOrderLinePeersFromCpRow` (9909) fans allowed display fields into Orders and
summary; some price metadata objects are assigned by reference at 9926-9930.

`captureCpPricingHistory` (9956) already records present/value and manual/automatic
intent; `restoreCpPricingHistory` (9969) restores intent and recalculates current
automatic prices. `applyHistoryAction` (9993) gates owner/edit/shared authority and
automatic dates. Bulk history (10049-10069) settles writes, validates owner and
orders/SuppFOB revisions, stages changes, sends one batch and moves history only
after confirmed ACK. Single undo/redo (10072-10089) has a different, immediate
stack path; do not assume it has the bulk ACK transaction behavior.

db.js `snapshotOrderOverride` (932), `receiptKind` (957), and
`restoreOrderOverrideReceipts` (968) retain exact map absence and note-definition
fences, restoring several lines with one orders revision. Legacy five-map receipts
remain supported. These are native trusted receipts, not a ready browser endpoint.
Pricing absence is separately encoded by existing pricingRestore (716-737/804-810).

## Shared owner / local DB delta

cp-field-ownership.js `createOwnershipResolver` (10) matches stable ASAS buyer IDs
then unambiguous legacy names. `forRows` (44) distinguishes verified owner,
moderator, foreign owner and unknown authority. Mixed-owner canonical lines remain
unknown because orderAccess lacks model/colour (57-64). Existing tests lock this
legacy behavior; scope to see a row is not shared-field ownership.

server.js `rejectSharedOwnerWrites` (6004) applies the protected field set dates,
subManufacturer, suppFob, suppFobMeta. `_canEditShared` is an interface hint.
The bootstrap registers the existing owner resolver into localDb at 771.
No auth-module implementation was inspected for this packet.

cp-shared-store.js holds flat `cp-order` records (15-26), mirrors only touched
business fields (96), and declares date subfields (118). Its overlay (155) treats
null as a tombstone and absent as no opinion. Blank notes retain a line-level
tombstone so legacy order fallback does not resurrect deleted notes (79-90).

delta-store.js `mirror` (134) removes no-op fields, stages memory with rollback
(188), serializes mirrors (193), and calls localDb.queuePatches (118).
Existing optional guardSource/assertAuthority callbacks run through assertCurrent
under the actual journal transaction (143-159). Ordinary cp mirror calls do not
currently supply that future receipt/authority-bearing callback.

local-db.js `resolvePatch` (1044) captures owner/event/time; queuePatches (1083)
supports assertCurrent. appendOperations (778) holds the DB lease, reads current
state and checks a callback before applying, writes checksummed WAL and fsyncs
before return (806-807), invalidating uncommitted cache on failure (821-825).
applyLocalPatch (905) persists the visible base revision, writer and seen vector.
fieldMerge (306) preserves unrelated fields, uses writer/seen conflict rules and
date subfield clocks; same-owner ordering is only for the protected field set.
Remote denial is receipt-only for known foreign shared fields (995).
transaction (850) writes a full snapshot; it is not the hot field-patch path.

## Checklist is a separate durable owner

checklist-supplier-sync.js uses an account-local pending journal (188-230).
drainAnswerChanges (319) sends at most 200 entries, advances baselines only for
accepted keys, retains newer local changes, and preserves denied/conflicting
entries rather than retrying forever (335-369).

routes/checklist-supplier-routes.js `context` (17) resolves current authorized
orders and supplies a live callback. POST answers (55-69) validates entries,
timestamps and attachment ownership and passes assertAuthority plus optional
expectedRevision into store.applyEntries.

checklist-supplier-store.js applyEntries (320) holds its own file lease, validates
revision, roster/evidence and at/baseAt ordering, preserves omitted evidence,
writes open-state tombstones and per-key outcomes, then rechecks authority (420).
write (209) writes last-good recovery then primary JSON. It does not call
localDb.queuePatch or CP delta-store.mirror. restoreEntries (426) restores captured
answer/tombstone pairs under exact expectedRevision and live authority callbacks.

## Live projection patches

server.js liveRowPatchesFor (9867) requires every item to be incrementally safe;
otherwise the whole notification falls back to reload. Incremental cache patch
(9883) reads saved note author/time metadata and preserves formula boundaries.
Client applyRemoteRowPatch (38714) updates supported fields and derived formulas;
applyRemoteRowPatches (38778) defers currently edited rows. Generic raw field
patches must not bypass this supported-field/reload decision.
