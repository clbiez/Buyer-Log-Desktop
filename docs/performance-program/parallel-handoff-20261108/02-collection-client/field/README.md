# Collection field-command preparation — unrun

Preparation only, outside the repository. No checkout, production edit, wiring,
test, syntax execution, browser action, CPU trace or benchmark was performed.
The root agent owns the performance lock. Do not wire this helper before 6a.
This packet is neither a 6c completion claim nor a measured performance gain.

`collection-field-command.cjs` is a pure CommonJS prototype; its only namespace
is the actual Collection namespace `collection-workspaces`, whose current owner
documents are `collection-workspaces/<owner>.json`. It has no CP Tracker entity,
`withCpBulkDraft`, `/api/overrides`, filesystem, network, worker or DOM dependency.
`collection-field-command.test.cjs` contains native `node:test` behavior cases.
The commands below have intentionally **not** been run:

```sh
node --test /tmp/buyerlog-phase6c-field-command-preparation/collection-field-command.test.cjs
```

Run only after the root agent releases its lock. These are isolated prototype
cases, not production regression, RED/GREEN evidence or UI validation. A future
product integration needs its own targeted Collection/server tests and review.

## Declared helper behavior

The 19 unrun native cases cover presence/inverse semantics, owned changed values,
untouched references, applicability/schema/group guards, row/legacy CAS, selected
request composition, partial/atomic outcomes, duplicate operation/ACK handling,
newer in-flight intent retention and malformed JSON rejection. Assertions inspect
observable values, identities and receipts; they do not compare source text or
generate expected output by calling the implementation under test.

- `createState` borrows read-only local rows, accepted baseline rows and Collection
  custom-column definitions. It indexes baseline IDs, rejects duplicate/missing
  IDs, and creates a separate in-memory operation ledger. It does not clone the
  entire workspace. Callers own the state lifecycle and must not mutate borrowed
  nested data. Client generation is a nonnegative integer; advance it on every
  owner, session, source or view rebinding. It is a client applicability fence,
  not an authorization token.
- `prepareFieldCommand` requires the explicit `independent-row-fields` unit and
  one existing row. The intentionally narrow allowlist is `quantity` plus
  currently declared, non-checklist `cx_*` custom columns. It records exact own
  property presence/value, row revision, owner, generation, custom schema and
  group metadata. Persistable JSON is required; absent, null, zero, false and
  blank remain distinct. Value formatting/business validation stays with the
  existing semantic editor; the JSON tests prove slot mechanics, not new product
  permission to enter arbitrary JSON into a text/quantity editor.
- `applyFieldCommand` verifies all applicability guards before any result, then
  copies the row array and only the touched row. Changed mutable values are owned
  copies; unrelated row/nested identities and existing unknown persisted keys
  survive. It never invents row existence, changes `_rev` or rewrites structure.
  Exact duplicate operation replay returns the same state; reusing an ID for a
  different command rejects. Duplicate replay still requires the original owner
  and generation. The ledger is in memory and is not a durable idempotency store.
- `prepareInverseCommand` requires a primary-acknowledged forward operation,
  matching current owned after-fields, group and schema. It creates a new command
  with a new ID, exact reversed presence/value and the current row CAS. Thus an
  unrelated accepted remote field can survive undo; same-field divergence fails.
  This explicit new undo intent does not adopt new bases for an old pending draft.
  No history stack, byte budget or local-only undo policy is implemented.
- `materializeLegacyRequest` composes a caller-selected ordered operation list
  over accepted baseline rows, not the entire current dirty row array. This keeps
  unsubmitted newer local fields out of the captured request. It emits only
  touched full-row `upserts`, empty `deletes`, explicit `expectedExistingIds`,
  empty `expectedNewIds` and existing `nextId`; `atomic:true` is optional. Existing
  legacy `_rev` absence normalizes to explicit zero with existence intent, so a
  remotely deleted old row cannot become a creation. Both current transient image
  projection keys are stripped. The request is an owned immutable capture.
- `acknowledgeLegacyResponse` maps the existing server's per-row `applied` receipt
  back to captured operation IDs. It acknowledges only requested applied rows;
  conflicts/omissions and later local operations remain pending. It updates the
  accepted baseline from the submitted row and updates local `_rev` without
  replacing newer local field values. Duplicate receipts return the same state;
  incompatible receipts, changed owner/generation/row base and partial atomic
  success reject. HTTP 200 or `replication.ok` alone never acknowledges anything.

The prototype keeps the existing server conflict granularity: a changed `_rev`
rejects the old row command even when only an unrelated field changed. It does
not enable field-level concurrent server acceptance. Workspace revision is not
substituted for row `_rev`. Row-only output contains neither `structure` nor
global `baseRevision`/`expectedRevision`; structural changes are unsupported and
fail closed. The existing structure route requires its separately captured
workspace `baseRevision` when structure changes. That contract must remain in a
future typed structure adapter, including retain-unlisted-row order behavior.

## Fail-closed boundaries and remaining work

All grouped rows, nonempty `modelSharedValues`/`variantOverrides`, group metadata
changes and coupled fields are blocked. A future group edit needs an explicit
typed semantic unit with a proved membership closure, parent shared state,
materialized peers and exact override presence. There is no unsafe scalar
fallback. Notes plus rich HTML/same-PLM fanout, pricing/confirmation/rule-derived
financials, period/dependent dates, images, quotation effects, checklist fields,
row creation/deletion/reorder, schema changes and group merge/split/detach are
not implemented. Custom-schema changes also invalidate captured commands.

An ACK for an older request preserves a newer pending command's **original** base.
The prototype then refuses to resend that stale command until an explicit,
verified compatibility/rebase policy supplies a valid successor intent. It does
not silently recapture bases, automatically resolve pending conflicts, rebase
own workspaces, drain a queue or settle server-authoritative same-field conflicts.
Late ACKs must be routed to their captured owner's state; this helper refuses to
apply them to the currently selected different owner/generation.

No pending schema migration or durable journal is implemented. Current pending
schema 1/2 readers remain authoritative: schema 2 has captured baseRows/baseStructure
and expectation sets; legacy schema 1 cannot prove new-row creation and requires
prior existence/old row CAS. Never turn a restored draft into a new operation by
adopting freshly fetched rows as its original baseline. The adapter only handles
newly prepared, proved-existing row commands. Existing PUT, row PATCH, partial
HTTP 200, atomic conflict and structure CAS contracts remain untouched.

The server currently returns row receipts, not operation IDs. Request correlation
and this in-memory ledger provide local duplicate replay/ACK handling only.
They do not establish server-side retry idempotence, restart recovery, durable
operation retention/compaction, crash-atomic WAL/fsync, local secured feedback,
owner publication, three-way replica/ancestry conflicts, old-peer negotiation,
live server authority or any Collection+checklist+CP atomic transaction. Group
normalization/load migration and all current source/owner guards remain required.

## Source pin and actual adaptation anchors

Runtime reads used pinned Main
`9cac38237205e83b2806e492d580bfa601220690` from
`/workspace/buyerlog-authority-fix` (`origin/main` at the start of this task).
The design packet's older Main `5b8c1e6f` was read as a proposal, not substituted
for current source. Blob IDs are recorded in `source-pins.json`.

| Pinned source under resources/app | Verified behavior |
| --- | --- |
| `public/app-main.js:22736` | Actual owner-bound pending schema 1/2 and failure feedback. |
| `public/app-main.js:22757` | Pending delta merge preserves old row/existence/structure bases. |
| `public/app-main.js:22803` | Both transient image projections excluded from persisted row. |
| `public/app-main.js:22833`, `22900` | Accepted baseline; whole-row PATCH with row CAS and separate structure base. |
| `public/app-main.js:23081` | Captured request, partial ACK, owner-switch guard, own-workspace conflict rebase. |
| `public/app-main.js:23612`, `23618` | Actual `cx_*` custom keys and normalized/checklist schema. |
| `public/app-main.js:25220`, `26004` | Actual grouped write routing and full local normalization/persistence. |
| `public/app-main.js:26804` | Snapshot undo and atomic bulk history; stack advances after primary ACK. |
| `public/app-main.js:28577`, `28727`, `29493` | Collection semantic editors and true single-cell dispatch. |
| `public/collection-model-groups.js:196` | Parent shared values, linked materialization and authoritative explicit override presence. |
| `server/lib/collection-workspaces.js:735` | Row CAS/existence expectations, explicit deletion, atomic rejection, separate structure CAS. |
| `server/routes/oab-batch-routes.js:86` | Actual Collection row PATCH and separate owner replication status. |
| `server/collection-save-worker.js:67` | Existing save worker; current authority checks and compact row receipts. |

No source owner, compute pool, worker, HTTP contract, WAL, release, PR, merge,
TEST or STABLE operation is part of this preparation.
