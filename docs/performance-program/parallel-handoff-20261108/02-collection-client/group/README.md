# Collection group semantic unit — preparation, unrun

This packet contains a narrow pure group-command prototype and **22 unrun native
parity/behavior tests**. All writes are under this new `/tmp` directory. No repo
edit, checkout, source modification, test, syntax check, browser, benchmark or
trace was executed. The root acceptance pipeline owns execution/performance.
No production wiring before **6a**; this does not complete CPR-02/03 or Phase 6c.

After the root releases the lock, the exact unrun command is:

```sh
node --test /tmp/buyerlog-phase6c-group-command-preparation/collection-group-command.test.cjs
```

There is no package/dependency installation. `reference/` holds unmodified bytes
from pinned Main `9cac38237205e83b2806e492d580bfa601220690`: actual
`collection-model-groups.js`, its four CommonJS dependencies, and `app-main.js`.
`source-pins.json` records the Git blob IDs. At future test execution the harness
verifies those Git blob hashes before loading/extracting any reference code.
The older `5b8c1e6f` design packet remains a proposal; current source is the pin.

## What the new typed unit covers

The sole namespace is `collection-workspaces`; the command kind is explicitly
`collection.group-field-semantic-unit`. It is not a generic scalar/JSON-path
fallback and does not import the earlier independent-row helper. The engine is
created by `createGroupCommandApi(actualGroups)`, borrowing only the actual
read-only `effectiveValue` and `fieldMetadata` exports. New mutations do not call
the old setters. They are compared against those real setters in the harness.

The deliberately narrow field allowlist is an existing plain-text non-checklist
`cx_*` Collection custom field with model inheritance: absent/empty/`text`
data type and no special editor/period/derived flags. The caller's existing
semantic editor still owns parsing/value validation. Direct storage-level JSON
cases verify slot mechanics and do not add new UI input types. A typed unit supports:

- `cell-edit`: the existing ordinary editor's string/no-op and linked-variant
  guard, including the actual app's override-first routing. A parent with its
  own explicit override edits that override rather than the shared model value.
- `shared-value`: one parent `modelSharedValues[field]` plus the materialized
  raw field of every member without that explicit override. An overridden peer
  keeps both its exact override presence/value and its existing raw field,
  including a legacy stale raw field. It is not silently repaired.
- `set-override` / `make-override`: the selected variant's
  `variantOverrides[field]` and its materialized raw value are one unit. The
  make action captures the current actual effective inherited value.
- `clear-override`: removes the override's own property, then uses the actual
  inherited-value resolver for materialization. The current clear helper's
  `undefined` fallback is preserved: if no value can be resolved, it does not
  invent a raw property. A blank parent raw field can leave the variant's old
  raw value in place; the test explicitly preserves this current behavior.

Each unit records owner, client generation, explicit target/group/member IDs,
member metadata/order, all group row bases, custom-column schema, exact
before/after own-property slots and sparse per-row edits at the three approved
locations: raw field, shared-map field, override-map field. Missing, null, zero,
false and blank remain distinct. No derived/transient/server metadata is written.

`applyGroupUnit` validates the complete unit before returning a result. It copies
the row array and changed rows only, copies a shared/override map only when that
map changes, and owns every changed mutable value. Unchanged rows, unknown fields,
unrelated nested map values and raw-source references retain identity. No borrowed
input is mutated. Map edits operate on one field rather than replacing an entire
map, so a future inverse does not erase unrelated newly accepted map keys.

`prepareInverseUnit` first checks the current selected field/override/shared
after-state, schema and exact membership. It creates a distinct inverse operation
with explicit current row bases; original own-property absence and materialized
raw fields are restored exactly. Unrelated accepted remote fields/nested keys can
survive, while same-field, override or membership changes conflict. This is an
in-memory inverse **preparation** primitive. It does not advance a history stack
or assert a primary ACK. Future integration must keep the current atomic primary
Collection ACK gate before bulk undo/redo stack advancement.

## Conservative affected-closure argument

The real `setSharedValue`, `setVariantOverride`, `clearVariantOverride` and
`normalizeRows` currently clone all rows. Removing those whole-workspace clones
requires proving that normalization has no outside repair to perform. The
prototype therefore refuses an unproven source instead of normalizing partially.

`createState` reads/validates the complete source once at owner/source rebinding:

1. Every row/value is ordinary already-persistable JSON: no accessors, cycles,
   prototypes, symbols, sparse arrays, non-enumerable extras, undefined, NaN,
   infinity or negative zero whose JSON cloning would change the data.
2. All rows already have distinct persisted IDs, explicit nonempty string group
   IDs, trimmed nonempty string variant IDs, own object shared/override maps,
   known roles and required persisted identity metadata. Each multi-row group
   has exactly one parent and all other members are variants. These are stricter
   source gates, not an attempted implementation of legacy migration.
3. Because **every** row already has group membership, the real normalizer's
   candidate auto-grouping is inactive. Existing membership is authoritative,
   including deliberately detached/same-PLM rows. Existing maps, roles, variant
   IDs and identity metadata need no repair, including on unrelated groups.
4. The allowlisted edits change none of those normalization inputs. Shared edits
   touch only the parent shared-map field and non-overridden materialized member
   fields. Override/clear edits touch only the selected variant's map/raw pair.
   No note, pricing, period, identity, schema or structural fanout is admitted.
5. Thus the existing normalizer has no additional value change to make for this
   certified subset. The reference tests compare the complete resulting rows,
   not just the displayed effective field. They also demonstrate that the old
   path copies unrelated objects while the new path preserves their identity.

An unrelated row still needing normalization rejects the **whole** source. A
typed group unit cannot be used as a shortcut around load/migration. The caller
must treat all borrowed source arrays, maps, rows and nested data as immutable;
every external owner/source reload goes through a fresh certificate/generation.
The certificate is private to this API instance. There is no claim that external
in-place mutation of borrowed references is supported.

The group dependency fence is intentionally conservative: all group member row
revisions and selected field dependencies must still match, including a preserved
override peer. Current row `_rev`/legacy zero semantics are retained; revisions
are never incremented by this local helper. A future server adapter must preserve
the existing per-touched-row CAS and separate structure CAS. This packet contains
no server adapter or concurrency-policy change.

## Actual reference call chain and test boundary

`reference-harness.cjs` uses the real pinned exported setters, followed by the
real normalizer, as the direct storage reference. It separately extracts the
actual pinned function bodies for `kolApplyCollectionCellChange`,
`commitKolEditor`, `kolWriteGroupedStorageValue`, linked/effective/override
helpers, `kolMakeFieldColorSpecific`, `kolRelinkField` and
`kolReplaceGroupedRows`. Exact source blob hashes and extraction boundaries guard
against silently testing another implementation.

The app harness uses a small input-element and custom-column context, disables
save/undo/render/quotation effects for cell edits, and stubs side-effect sinks.
Real grouped mutation and normalization functions run in that future harness;
the full app is never evaluated. This is custom-field mutation data parity, not
browser/editor/accessibility/domain-validator/persistence integration coverage.
The tests also assert concrete presence, materialized values, copy identities,
conflicts and unchanged inputs independently of the reference output.

Pinned anchors under `resources/app/`:

| Source | Actual behavior used |
| --- | --- |
| `public/collection-model-groups.js:54` | Whole-row JSON cloning, metadata/default/role repairs and authoritative existing groups. |
| `public/collection-model-groups.js:144` | Own-property override presence and effective value fallback. |
| `public/collection-model-groups.js:196` | Shared parent map plus linked materialization. |
| `public/collection-model-groups.js:215`, `233` | Override map/raw pair and clearing fallback. |
| `public/app-main.js:10126` | Actual editor string/no-op equality. |
| `public/app-main.js:25100`, `25196`, `25220` | Full normalization, linked-cell guard and override-first grouped write. |
| `public/app-main.js:28577`, `29456`, `29493` | True Collection ordinary/synthetic cell dispatch. |
| `public/app-main.js:29511`, `29512`, `29542` | Normalize/save wrapper and explicit override/relink context actions. |

## Explicitly unfinished

Same-model linked peers **inside** the group are covered. Same-identity/same-PLM
rows in separate persisted or detached groups remain untouched, as the actual
shared-field path requires. This is not note fanout coverage: rich notes plus
`notHtml` and same-PLM non-overridden peers remain an explicitly blocked separate
semantic unit. Pricing/confirmation/derived financials, periods/dependent dates,
checklist fields, color/native fields, images/quotations, identity changes,
merge/split/detach/relink membership, create/delete/reorder and schema changes
are also blocked. No catch converts one of these to generic scalar writes.

No durable pending journal, operation deduplication/ACK ledger, history byte cap,
snapshot fallback, server auth, row PATCH adapter, pending v1/v2 migration,
three-way owner replication/head ancestry, WAL/fsync/crash recovery, checklist
transaction or remote-publication proof is implemented. Original pending bases
and expectation sets must not be adopted from fresh rows during later migration.
No second worker/pool or new transport has been introduced.

There are still O(n) array/index copies per returned state and full source
validation/indexing on rebinding, plus selected group-field dependency copies.
No timing, memory gain or production hot-path reduction has been measured. The
separate earlier field packet and this packet are inactive preparations; neither
replaces the serial **6a → 6c → 6b** integration/acceptance work.

Root supplied an additional later boundary during this preparation: #916 is
merged on Main `0c85445f`. This packet intentionally retains `9cac3823` as its
historical reference and does not claim to represent newer Main. Any eventual
checklist companion work must preserve the existing `withRowCache` wrappers in
`cp-overview-assistant.applyPersonalLayer` and `checklist-supplier-sync.refreshColumns`.
All `isSet`/`count`/`partsFor` calls within a bulk pass must remain inside
`checklist-components-engine.withRowCache`, including every new bulk pass.
Preserve the fast check `CP checklist pass caches...` and
`checklist-components-row-cache.test.js` unchanged. A CP-touching performance PR
must measure the first CP intent before/after with both benchmark-first-transitions
arms based on #916, and must not merge a regression. This is a supplied integration
constraint; those newer CP files were neither changed nor executed here.
