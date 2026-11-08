# Collection delta commit preparation — inactive, unrun

This is a small native-service prototype and 27 prepared native test cases, not
production wiring or Phase 6c completion. No test, syntax check, module load,
browser, benchmark or worker was executed for this packet. All writes are inside
this new `/tmp` directory. The earlier field19/group22 packets and product files
were not changed. Root owns the shared performance lock and integration.

## Exact sources

All product reads used `git show 1796193f:<path>` in
`/workspace/buyerlog-post-main-acceptance`, full Main commit
`1796193f0a57c7785e7bf9fdb3557e33c550b25e`.
The working tree's local 6a/f076 source changes were **not** read or copied.
`reference/` contains nine byte-for-byte existing native DB/dependency blobs plus
the actual shared-sync policy for a transport boundary fixture, not
reimplementations. Blob IDs and read-only call-chain sources are recorded in
`source-pins.json`. The earlier contract remains
`/tmp/buyerlog-phase6c-contract-design/collection-patch-contract.json` and its
README/call-chains; earlier helper/group prototypes retain their historical
`9cac38237205e83b2806e492d580bfa601220690` pin.

Relevant actual API and call-chain facts:

| Pinned source | Consequence for this prototype |
| --- | --- |
| `server/lib/local-db.js:778` `appendOperations` | Uses existing DB lease, checksum framing, append, `handle.sync()`, then return. Cache invalidates on failure. A thrown error after write/fsync may mean the operation already committed. |
| `local-db.js:830–847` `privateRecordTransaction` | Existing exported API runs an awaited prepare callback under that same lease and appends **one** `private-records` frame containing all prepared records. It creates no generic transport events. This is the injected durability adapter here. |
| `local-db.js:850` `transaction` | Full snapshot path; used only to force a native checkpoint in a fixture, never the prototype hot edit path. |
| `local-db.js:1083` `queuePatches` | Existing batched generic events are multiple independently replayable WAL lines. Its `assertCurrent` callback is synchronous. Neither its `baseRevision` nor one shared fsync establishes this service's CAS or batch replay atomicity. |
| `server/lib/collection-workspaces.js:520,643,709–815,888` | Full saves with `expectedRevision` use whole-workspace CAS. Row `_rev` CAS normalizes legacy missing revisions to zero; row update increments that row by one. Existing structure and expected-existing/new rules, partial responses and `atomic:true` remain current route behavior. This packet does not replace them. |
| `server/lib/delta-store.js` | Legacy native mirror is `store:collection-workspaces/<owner>.json`; attaching a new `.doc` field to it could change old full-state data. New private keys are deliberately separate pending an explicit single-source handoff. |
| `server/lib/collection-replication.js:186,464` | Existing owner-envelope three-way merge, ancestry CAS and owner namespace are separate. Collection owner documents are excluded from generic shared transport. A private local ACK is not owner publication. |
| `server/lib/shared-sync-policy.js:100,162,177,192` | Peer allowlist and master/business checkpoint scoping exclude the prototype's private owner keys. A prepared test calls these actual functions, including a key with `asset` in its owner ID. No broad-classifier assumption replaces the actual boundary functions. |
| `server/lib/checklist-supplier-store.js:209,320` | Checklist answers/events are leased JSON plus last-good JSON, with scoped answer/evidence validation and accepted keys. They are not currently local-db WAL records. |
| `public/cp-overview-assistant.js:377,400,417` | Full answer serialization still occurs per answer; `batchChecklistAnswers` coalesces notifications. |
| `public/checklist-supplier-sync.js:209,319` | Browser/native-storage pending map is separate. Batches retain denied/conflicted/newer entries and clear only matching accepted entries. A Collection receipt cannot clear that journal. |

## Concrete service

`collection-delta-service.cjs` accepts the existing
`db.privateRecordTransaction(prepare)` and a **trusted** async
`assertAuthority` callback. It opens no DB, starts no worker, accesses no remote
owner file, and invents no append/log/lease mechanism. Native fixture tests use
the actual copied `createLocalDb` and temporary synthetic files.

The inactive schema uses `collection-workspaces:<owner>:` private records in the
existing DB:

* `structure`: original ordered row IDs and unknown workspace metadata, installed
  once by a future trusted source handoff; the hot path does not copy it.
* `head`: small source generation, structure revision and workspace revision.
* `row:<encoded-id>`: one actual row, its per-field revision tokens, and a
  membership/structure stamp. Only touched rows are copied/written. Unrelated
  row records and unchanged nested values retain their in-memory identities.
* `tx:<transaction-id>`: digest, durable outcome and changed-field inverse slots
  or conflict evidence. Rows, head and this receipt share one native frame.

There is **no production bootstrap/migration API**. Only the test fixture seeds
this schema. The trusted adoption owner must validate all row IDs/order,
membership stamps, schema and unknown keys under the real source's leases.
These private keys require exclusive ownership: arbitrary native `transaction`
deletion/mutation of private records is not a supported edit path, because
existing previous-WAL replay assigns private records again. Namespace retirement,
deletion and compaction need explicit replay-safe semantics before integration.

Commands are versioned, owner-bound, existing-row-only, atomic batches. Allowed
fields are **only** declared `cx_*` custom text columns with primitive JSON
values, not checklist columns. A row carrying group metadata is blocked. Rich
notes, group shared/override state, pricing, periods, row create/delete/order,
schema edits and mixed checklist companions explicitly fail closed. Unknown
command members are rejected, not silently acknowledged. Existing unknown row
and workspace keys are preserved as data.

`row-cas-v1` retains the actual current row revision check, including zero for
legacy `_rev` absence. `adaptLegacyFullState(base,incoming,binding)` accepts a
captured old-style full-state edit only when metadata, row order/existence and
incoming revision slots are unchanged; it emits this strict row-CAS form **and**
the captured full PUT's whole-workspace expected revision. An old full PUT is
not weakened to accepting a concurrent change on another row. An old full save
without a captured workspace revision is blocked by this narrow adapter; the
existing production compatibility route remains responsible for that legacy case.
`readWorkspace` reconstructs the legacy full-state shape for a future trusted
compatibility reader. It is a projection codec, not an authorized or leased read
API. Native `db.read()` returns a live cache; do not expose a read during an
in-flight append as confirmed state. Its future caller must use the established
source-owned read boundary and current authority. Existing production full
PUT/PATCH and mirror files remain
unchanged. The fixture proves the old mirror is not rewritten, **not** that two
sources are automatically synchronized.

The additive `field-merge-v1` mode is an explicit proposed concurrency policy,
never silently substituted for row-CAS. For each exact own-property slot:

| Relationship | Result |
| --- | --- |
| current equals base | Apply incoming, if different. |
| current equals incoming | Converged; retain current row revision. |
| incoming equals base | No local delta; retain current. |
| otherwise | Keep current; persist base/current/incoming conflict evidence. |

Absence, null, zero, false and blank stay distinct. Any conflict cancels the
whole batch's row effects; its intent evidence remains in its transaction
receipt. This intentionally narrow policy does not claim equivalence with the
existing full owner-envelope merge's empty-text/delete/ID-collision behavior.

Transaction IDs are stable across retry. Canonical payload digest includes the
trusted actor. Under the actual DB lease, an exact duplicate returns the original
receipt without a new WAL line or global revision; changed intent under the same
ID is rejected. Receipts are not evicted here. Bounded retention/checkpoints,
pending-budget admission and owner-publication ACK rules are unfinished.

`inverse-fields-v1` loads a durable forward receipt. It restores only fields
whose current value **and field revision token** still match the recorded
after-state. Same-field ABA is rejected; changes to unrelated fields survive.
Source generation and structure/membership fences still apply. This is native
inverse applicability, not a wired browser undo/redo stack or remote ACK policy.

## Authority and source handoff

The callback receives trusted `actorId`, requested owner, source generation,
transaction ID and phase. It must freshly resolve actual current-session
owner/share view+edit authority for `prepare`, `pre-append` and `post-durable`.
Client-supplied flags never authorize anything. Pre-append denial leaves no
service row/receipt effects. Post-durable denial returns only transaction status,
without field/receipt contents; it does not falsely claim rollback or publication.

The fixture callback is synthetic, **not implemented server authentication**.
The DB lease does not lock the authority store. Linearizable revoke/write races
across separate authority owners are not proven; production wiring must honor
the current authority owner's locking/epoch policy. A native source generation
is not a replacement for captured client session/view generation checks.

Root's 6a raw-owner/source changes and this proposed 6c service are distinct
handoffs. Before any production wiring, establish one canonical source, bind
its owner/generation and all reader/writer entry points, reject stale UI/view
bindings, and preserve old full-state routes. This packet does not double-write
JSON plus DB, import current user data or publish owner deltas. Order remains
**6a → 6c → 6b**.

## Batch journal and checklist boundary

The Collection batch's changed values and inverse/receipt intent are durable in
one existing private frame before service success. A row-only receipt does not
ACK image registry, quotation, owner-envelope transport or checklist side effects.
The tests stage separate synthetic checklist JSON/evidence and browser-pending
bytes and ensure a Collection batch does not consume/change them. A request
that combines checklist answers with a scalar Collection patch is rejected.
This is a compatibility guard, **not** a new durable checklist batch implementation.

A future typed checklist batch must call the actual checklist semantic validator
and leased store owner, keep timestamp/option/scope/evidence identity, and clear
only that owner's accepted matching pending entries. It must separately settle
answer/journal notification/sync outcomes; this native Collection receipt grants
no cross-store atomicity. Moving checklist into generic WAL merely to reuse the
service is not proposed.

Main #916 (`0c85445f`) remains a binding companion constraint: preserve unchanged
the fast-check “CP checklist pass caches...” and
`checklist-components-row-cache.test.js`; keep all bulk `isSet/count/partsFor`
calls within `withRowCache`, including new bulk passes. Any future CP-touching
performance PR needs first-CP-intent before/after `benchmark-first-transitions`
on both arms containing #916. This packet changes no CP files or bulk pass.

## Prepared recovery checks and remaining unknowns

The 27 native cases are **unrun**. They cover a real one-frame WAL batch and cold
replay, legacy/fullstate boundaries, exact slots, immutable command input,
unrelated identities, row-CAS vs explicit field merge, atomic conflict evidence,
inverse ABA rejection, stale fences, pre/post authority, concurrent ID replay,
lost ACK after real native completion, WAL fsync return gating, actual native
cache invalidation on a pre-write failure, torn-frame cut points, complete JSON
without its trailing newline, checksum-corrupt append rejection, native snapshot
rotation, membership guards and separately owned checklist pending data.

Cut points deliberately use only cloned synthetic fixture files. No old WAL or
benchmark evidence is overwritten. Native partial final JSON is replayed only
through the preceding valid frame; row and receipt share the one omitted frame.
A complete checksummed frame is replayable even without a newline. Checksum or
interior corruption blocks future append; history bytes stay unchanged.
After sync succeeded but before the caller received a result, retry the **same**
transaction ID; an I/O failure's outcome can be unknown.

These cases do not constitute power-loss/kill-at-each-syscall verification.
Snapshot-fsync/rename/WAL-rotation interruption, hardware and directory fsync
semantics, storage-full admission, retention, process competition, Windows AV and
rename behavior, actual Electron lifecycle/close flush, mapped drives and SMB
durability remain unverified. The existing local DB policy rejects UNC paths;
that does not prove all network or mapped paths safe. Owner-share SMB transport
remains the existing separately leased owner-envelope protocol.

## Exact commands, deliberately NOT RUN

Only root should run these after releasing its current acceptance/performance
lock. No package install or product environment is needed for the native fixture.
The fsync/write fault tests temporarily wrap `fs/promises.open`, so run this file
alone with concurrency one:

```sh
node --test --test-concurrency=1 /tmp/buyerlog-phase6c-delta-commit-preparation/collection-delta-service.test.cjs
```

Optional later syntax-only checks, also **not run**:

```sh
node --check /tmp/buyerlog-phase6c-delta-commit-preparation/collection-delta-service.cjs
node --check /tmp/buyerlog-phase6c-delta-commit-preparation/collection-delta-service.test.cjs
```

No timing gain, browser integration, server auth completion, owner delta
replication, full undo/storage migration or phase completion is claimed.
