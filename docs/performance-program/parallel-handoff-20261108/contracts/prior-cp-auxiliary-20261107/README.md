# Phase 6c source ownership / field-delta integration packet

Status: **design preparation only**. No implementation, test, benchmark, worker,
endpoint, schema migration or durable-owner transition is delivered here.
Phase order remains **6a -> 6c**. The temporary nine-cache wire candidate is
preparation, not completed 6a; its exact-key-order and borrowed-nested-value limits
remain. PR #891 remains authoritative apart from the targeted Layout addendum.

Source baseline: Main `5b8c1e6fde347df12f211b06af4dd27e5c5fb125`.
GitHub confirmed this is an ancestor of local HEAD `df8ca377...`; the nineteen
targeted source files in source-provenance.json have no Main-to-working-HEAD diff.
The current auth-module work was not read or reviewed.

## Minimal next implementation boundary

Start with additive **client-owned field patches**, replacing the full-clone
preparation in `withCpBulkDraft` only for a closed set of proven edit units.
Do not introduce a new transport, storage owner, worker or merge policy in that
first change. Reuse `/api/overrides/batch`, existing orders/SuppFOB revision fences,
the mutation queue and existing post-ack row/peer invalidation. Unsupported edits
fall back to the existing full-draft path explicitly, with no partial execution.

The current code already stages edits and applies acknowledged row fields only
when current still equals captured-before. The useful 6c delta is to capture only
touched row/map slots and clone only their mutable values, while retaining the
old behavior and root-owned row identities. This is a proposal, not measured gain.

1. Pure `public/row-field-delta.js` helper: own-property-aware tagged slots,
   ordered forward/inverse operations, all-before validation, no mutation during
   preparation, explicit unsupported result. All unknown fields remain untouched.
2. Pure `public/cp-edit-units.js` adapter: map existing semantic edit units into
   the helper using canonical/module bindings and current column definitions.
   Couple price+metadata, note text+rich HTML, and date baseline/revision effects.
   Do not send arbitrary row paths to the server.
3. Root integrates opt-in preparation/ack/undo in app-main.js and existing
   override-sync.js. First target confirmed bulk operations, whose guarded ack
   path already exists. Keep original code as an explicit fallback until every
   involved edit unit is closed. Single-cell undo conversion follows in the same
   reviewed 6c series only after its ack/error behavior is specified and tested.
4. Network field receipts, durable-mirror acknowledgements and checklist sharing
   are later opt-in boundaries. Their prerequisites below cannot be hidden behind
   a generic patch function or claimed by the client-helper change.

## Four different owners

- **Session/display owner:** current user plus module/source/view generation owns
  client rows, pending drafts, undo entries and peer indexes. A switch invalidates
  their applicability; another session must not inherit a pending operation.
- **Business shared-field owner:** existing authoritative ASAS/IAM resolver gates
  dates, subManufacturer, suppFob and suppFobMeta. MAG/manager scope and UI hints
  do not substitute for that decision. Existing unknown-owner behavior is retained.
- **Compute source owner:** existing immutable source descriptor/capability and
  generation lease govern worker snapshots. UI edits are overrides/derived display
  deltas, not permission to mutate those raw snapshots in place.
- **Durable store owner:** overrides compatibility projection, CP delta/local DB
  WAL and checklist leased JSON are separate persistence boundaries today.

## Existing facilities to reuse

See call-chains.md and source-provenance.json for exact anchors:

- owner+canonical-line-bound peer/history indexing; staged bulk edits and ack merge;
- revisioned override queue; order and SuppFOB CAS, note-definition fences;
- native exact map receipts, including absent-entry restoration and legacy receipts;
- CP flat business-record delta mirror, date subfield merge, HLC/writer/seen guards;
- local DB append batch under one lease, fsync before return, replay/idempotency;
- checklist user-local pending journal, accepted-key draining, live route/store guard,
  answer/tombstone receipts and evidence-preserving leased writes.

## Data-loss / ambiguity gates

1. **HTTP override ACK is not a WAL ACK.** db.js saves compatibility overrides,
   then calls mirrorPatchDetached. Do not clear a new durable journal or promise
   cross-device durability solely because that HTTP request succeeded.
2. **Checklist is not in local-db WAL.** It writes recovery then primary JSON
   under its own lease. A CP+checklist inverse cannot be advertised atomic without
   an explicit cross-store commit/recovery design; that migration is out of the
   minimal 6c patch.
3. **Missing and null differ.** Null dates remove an override; explicit blank note
   tombstones suppress legacy order-level fallback. Inverse restoration must
   preserve override presence and provenance, not merely restore displayed text.
4. **No fabricated row ownership.** Business line keys can fall back to an order
   key and duplicate source rows can share a triple. Current authoritative owner
   data has no model/colour resolution for mixed owners. Preserve that ambiguity;
   mutation fanout is not the same identity contract as a thin-detail row ordinal.
5. **Server-generated metadata stays server-owned.** Note authors/times, price
   intent, field revisions, clocks and tombstones are not generic client-settable
   fields. Unknown/read-only columns, formulas, automatic Ex-factory and image
   families fall back or reject before effects.
6. **No shallow mutable sharing.** Existing peer writes share some metadata
   references. A new delta may borrow read-only untouched values, but each mutable
   changed value belongs to its destination owner. Freeze/test source graphs and
   never normalize/undo a borrowed worker/source object.
7. **Ordinary inverse writes cannot always express absence.** A saved delivery
   override cannot be removed by delType:null in applyOrderPatch. A generic
   before/after swap is not a safe network inverse for every existing field.
   Keep those units on the legacy path until an authorized native receipt adapter
   can restore the exact state. Never expose native receipt maps as trusted browser
   input without an actor-bound server-issued receipt reference and commit fences.
8. **Do not silently relax CAS.** Initial 6c retains existing global revisions.
   Fine-grained concurrent server acceptance is a separate contract, not an
   automatic consequence of local field patches or local-db fieldMerge.

## File / PR sequence and locks

Use the ordered commits/PR boundaries in file-sequence.json. Helpers may be drafted
in isolation; root owns app-main.js, server.js, bootstrap/loading and common compute.
Open #909 DS-08 owns local-db.js, compute-service.js, compute-worker.js and server.js.
Do not start parallel edits there; integrate/revalidate #909 or freeze a serial
handoff before any 6c durable/source-generation work. The first client-helper
boundary can avoid all four files. Common compute is reused if later needed;
there is no new pool or worker mechanism.

validation-matrix.json lists required meaningful cases and existing regression
sources. None ran in this design task. Future actual ownership/durable-boundary
changes are P1 and require a frozen implementation diff plus its applicable
verification; this preparation supplies no independent review or green claim.
