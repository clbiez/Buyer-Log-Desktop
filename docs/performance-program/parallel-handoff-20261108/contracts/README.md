# Phase 6c corrected scope: Collection persistence, inverse undo and owner deltas

**Design/scope verification only; no implementation or measured gain.** No code,
test, benchmark, CPU trace, repository change or new worker was made. Current
#908 browser/full-suite work was not interrupted. Order remains **6a → 6c → 6b**;
this packet does not start 6c or production Phase 7. PR #891 remains authoritative.

## Correction record

The first packet incorrectly led with CP Tracker `withCpBulkDraft` as the first
implementation target. The original user scope instead leads with **KOLEKSIYON
single-cell persistence, row/field patches, inverse-patch undo and owner-sharing
deltas** (CPR-02/03, DS-09), with WAL/checklist batching (DS-07/CPR-10) and raw
source ownership. Replacing CP bulk preparation is not a substitute for that work.

The original six files are preserved unchanged in
`prior-cp-auxiliary-20261107/`. Their true CP authority, detached-mirror ACK,
checklist-store and immutable-source notes remain auxiliary boundary evidence.
Root `patch-contract.json` is explicitly reclassified as CP-only auxiliary;
`collection-patch-contract.json` is the corrected primary proposal. Old
`source-provenance.json` covers the auxiliary reads; the correction has its own
`source-provenance-collection-correction.json`.

Authoritative sections CPR-02/03, DS-09, DS-07 and CPR-10 were fetched from the
user's `claude/wonderful-archimedes-a7dzwr` findings URL; blob
`95b0fed2b815f56a3345f325de062449ea784e01`. Only those sections were output and
are preserved in `authoritative-collection-scope.md`. Verified source baseline:
`/tmp/buyerlog-post901-baseline`, Main
`5b8c1e6fde347df12f211b06af4dd27e5c5fb125`; targeted files clean.

## What changes materially

| Requirement | Existing Main5b8 behavior / corrected target |
| --- | --- |
| CPR-02 single-cell persistence | `kolApplyCollectionCellChange`/editor/group writes lead to `saveKolRows`. Full normalization/JSON clones, row JSON, workspace JSON and full pending recovery snapshots remain. Replace hot whole-workspace preparation with touched row/group commands, an owner-bound durable pending journal and sparse checkpoints. |
| CPR-03 undo | `kolSnapshot` clones all `kolRows`; undo/redo retain up to 50 snapshots. `withKolBulkDraft` also clones rows/manufacturers/custom schema plus before/after. Replace with bounded command/inverse entries; preserve group/paste atomicity and remote-aware undo. |
| Existing local-server transport | Already PATCHes changed **whole rows**, with per-row `_rev`, explicit new/existing expectations, separate structure CAS, partial applied/conflicts and `atomic:true`. Do not describe this as a missing row-delta API or substitute CP orders/SuppFOB revision fences. An additive field-patch adapter can retain these row-CAS semantics first. |
| DS-09 owner sharing | `publishOwnerCas` and `recordBase` still read/hash/write full owner workspace envelopes/base snapshots. Client patching alone does not solve this. Needs an owner-scoped delta/head/checkpoint protocol preserving ancestry, conflict recovery and peer compatibility. |
| DS-07 WAL | `queuePatches` already batches patches under one append/fsync; `removeMirrored` still tombstones IDs one by one. Reuse the existing transaction foundation, add a true bounded native deletion/bulk interface where needed, and define success after shared fsync. |
| CPR-10 checklist | Main already has notification-only `batchChecklistAnswers`; each answer still calls full `saveAnswers`. Evidence inputs still run answer→journal/sync/render on input and change. Target a durable batch transaction, not another notification wrapper. |
| Raw source ownership | Keep existing worker/source generation immutable and owner-bound. Collection edits own changed values/overlays, not CP raw source snapshots. No new pool/worker mechanism. |

## Naming and owners — do not conflate CP with Collection

- `kolRows`, `kol*`, `collection-workspaces/<owner>.json` and
  `collection-replication` are Collection workspace data and owner transport.
- `collection-pricing-engine`/`collection-pricing-service` calculate Collection
  financial projections. Their `cpRows` argument/index is authorized **CP Tracker
  source context**, not a second Collection persistence store.
- `cp-shared-store` explicitly stores entity `cp-order`; `override-sync`,
  `/api/overrides`, CP field ownership and `withCpBulkDraft` are CP Tracker
  override/history paths. They are auxiliary, not Collection's primary write API.
- `local-db`/`delta-store` are generic native durability facilities. A Collection
  workspace may have a local document representation, but owner replication
  deliberately filters it out of generic shared sync. A new owner delta must not
  bypass that boundary by becoming an ordinary shared business delta.
- Checklist answers/journal and server leased JSON are another durable owner.
  Collection + checklist + CP override ACKs do not form one atomic transaction.

## Minimal additive contracts to prepare after 6a

1. **Collection command helper first.** Capture owner/session/view generation,
   row IDs and existing row/structure bases. Record exact present/value slots for
   touched persisted fields; create/delete/reorder/group changes are explicit
   typed operations. Preserve false/zero/blank versus inherited/missing override.
   Work against owned changed values; untouched nested data may be read-only.
2. **Group closure, not scalar substitution.** Parent writes must include
   modelSharedValues plus linked materialized cells; explicit variant overrides
   remain independent. Include coupled note text/HTML, same-PLM note fanout,
   pricing/confirmation/derived metadata and schema constraints as current paths
   require. Normalize on load/migration and affected proven groups; unproven
   structural commands use explicit checkpoint preparation, never partial effects.
3. **Durable local journal.** Persist a versioned owner-bound operation before
   reporting secured local intent; replay from a checkpoint on restart, coalesce
   earliest-before/latest-after without losing pending revisions, and compact
   only after the defined ACK/checkpoint boundary. Keep legacy pending formats
   readable. A new journal must not depend on a second non-atomic storage key
   being written successfully to recover the last edit.
4. **Inverse undo.** One command/inverse per semantic edit or atomic group/paste,
   with byte budget and sparse checkpoints. Inverse applies only to current
   matching owned after-state or through the existing conflict/rebase policy;
   remote unrelated fields survive. Newer same-field intent is not silently
   overwritten. Owner switch, deleted rows and changed group membership invalidate
   applicability explicitly. Bulk history advances only on confirmed primary ACK.
5. **Compatible server adapter.** First materialize only touched rows into the
   existing row PATCH contract. Later add an explicit field-patch version at the
   existing Collection route/worker boundary. Retain row `_rev` CAS and structure
   CAS, existence intent, partial/atomic outcomes and live owner authority. Finer
   field-level concurrent acceptance is a separate explicit contract decision.
6. **Owner sharing delta.** Versioned owner namespace with operation IDs, parent
   head/lineage, row/field operations, integrity checks and periodic checkpoints.
   Preserve view/edit/revoke decisions, deterministic three-way conflicts,
   ancestry CAS and local-save versus remote-publication status. Old full-envelope
   peers need an explicit compatibility/migration path before changing defaults.
7. **WAL/checklist batches.** Native group commit promises each caller success
   only after its included operations are fsynced. A one-write multi-event WAL is
   not by itself proof of crash-atomic replay: prove recovery framing/semantics.
   Checklist needs one durable local batch/journal commit, one notification and
   delta refresh/sync. Journal text changes immediately; debounce expensive work
   250–400ms and flush on blur/close/account switch. Preserve timestamps, scoped
   option/set answers and evidence. Do not migrate checklist into generic WAL
   merely to share a helper.

## Open facts / data-loss gates

- Final local journal storage/schema, byte budget, checkpoint/replay and legacy
  pending migration are unimplemented; current localStorage durability is not
  equivalent to native fsync or successful remote publication.
- Current Collection HTTP 200 can contain partial conflicts. Clear/move only
  acknowledged operations; retain edits made while ACK was in flight and bind
  late ACK to its captured owner. Existing own-workspace automatic rebase differs
  from foreign-owner conflict behavior and must remain explicit.
- Group normalization currently discovers groups and supplies defaults. Proving
  an affected-group closure must cover legacy rows, merge/split/detach, imports,
  row IDs/order/nextId and same-PLM propagation before removing whole normalization.
- Inverse must preserve explicit override presence, row existence and structural
  metadata; it cannot be an arbitrary JSON-path swap of derived/transient fields.
  Image registry and quotation side effects need separate receipts/status; a
  Collection primary save does not prove their atomic completion.
- DS-09 head publication, interrupted publish, checkpoint compaction, offline
  ancestry and old-peer capability negotiation need a concrete durability design.
  A new delta must not expose another owner or resurrect retired shared pools.
- DS-07 needs crash/partial-tail proof for multi-record batches; checklist needs
  a durable answers/journal commit design across its existing storage boundaries.
  Neither is established by Promise.all or the current notification batching.

See corrected call-chains.md, collection-patch-contract.json, validation-matrix.json
and file-sequence.json. All cases remain planned/unrun. The prior CP-only packet
is retained as auxiliary evidence rather than silently discarded.
