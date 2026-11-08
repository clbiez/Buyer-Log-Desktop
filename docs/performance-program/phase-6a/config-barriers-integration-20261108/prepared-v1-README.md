# Orders configuration barriers — concrete preparation, unrun

Read-only source revision: `b6c8504ae418ebe731af7000f33e0eb1aa2f9f17`.
Exact file hashes are in `pins.json`. No product/API/test/CI file was changed.
No syntax check, test, benchmark, browser or server was run by this preparer.
This is an addendum about configuration entrypoints, not a field inventory or
another codec. Existing 6a inventory and all existing assertions remain intact.

**[Doğrulandı, source] Public thin activation is not safe merely because local
field-editor callbacks now await full data.** Late account hydration, saved
profiles, synchronous formula APIs and CP-to-Orders schema synchronization can
change dependencies outside those callbacks. The finite async seams below are
real; remaining synchronous callers require full fallback until their actual
preconditions are closed. No runtime or performance conclusion is asserted.

## Exact chains and earliest useful await seams

Paths below are relative to `resources/app`. These are call chains, not a second
field/dependency registry. No assumption that a visible/hidden field is safe to
omit follows from these locations.

| Trigger and actual caller | Actual synchronous read/mutation reached | Earliest practical await / fallback |
| --- | --- | --- |
| `schedulePostUiStartupTasks` (`public/app-main.js:16904`) → `hydrateUserPreferencesAfterUi` (`16834`) → `BLStorage.hydrate` | `public/user-storage.js:226` response callback changes `roleDefaults`, native localStorage, deletion state, sync metadata and outgoing merge state; formula definitions and view/filter keys are among its real SYNCED prefixes (`114–124`) | Await in `hydrate` response callback **before `roleDefaults=...`** (`227`), not only in app-main `.then(sync)` (`16838`), which is too late. Hydrate already returns a Promise; its sync get/set APIs need not change. Draft below. |
| Successful hydration (`app-main:16843`) → `refreshPersonalOrderNoteColumns` → `syncCpNoteColumns` (`4039`) → `syncOrdersColumnsFromCp` (`4179`) | `BLFormulaColumns.syncColumns('orders')` (`4192`) → migration, schema reads, formula definition persistence; then `applyCoreAutoFilterState` (`139`) replaces Orders arbitrary raw-key column filters and render reads them | The hydration response-apply gate above precedes this chain. Existing `sync.applied>0` behavior stays unchanged. Do not add an await only after these functions have already modified state. |
| `loadFromServer` (`app-main:15114–15119`) awaits `authHydrationPromise`, then `reloadPersistedTableColumnStateAfterHydration` (`4373`) | `loadAutoTableColumnState` resets `order`, `hidden`, widths from newly hydrated data (`4360`); subsequent `syncCpModelColumns` (`15144`) reconstructs Orders schema and synchronously migrates its formulas | Async `loadFromServer` is awaitable, but its existing hydration await does not cover a null/not-started promise. A candidate thin loader must certify hydration is settled and current before publishing; unknown/in-flight configuration means the exact full envelope. No publication code is changed here. |
| `applyProfilesForCurrentPage` (`app-main:17657`) → `applyCachedProfilesForCurrentPage` (`17393`) → `applyStoredProfilesForCurrentPage` (`17401`) | Cached favorites and startup resume call `applyViewState` (`17196`) and `applyFilterState` (`17305`) **before the first await** at `17661`; these write visible keys, arbitrary column filters and `ordersSort` and synchronously render | Add conditional full barrier before cached application; recheck after remote GET waits and before stored application because another thin snapshot can arrive while waiting. Keep existing generation/page cancellation. Exact in-memory draft below. |
| `loadFromServer` directly calls `applyCachedProfilesForCurrentPage(initialScreenLoad)` (`app-main:15264`) | Bypasses `applyProfilesForCurrentPage`; reaches the same cached view/filter/resume mutations | `loadFromServer` is already async: it needs its own await immediately before this direct call when a loaded Orders snapshot is thin. The draft in `applyProfilesForCurrentPage` alone does **not** cover it. |
| `viewSelect` change (`app-main:17483`) → `applyViewState` → `applyFilterState` for packed `__filters` → `renderOrders` | `applyViewState` changes hidden/order/widths/sort/freeze, persists and renders; a legacy payload without `__page` can also modify Orders while CP is active (`17227`) | The actual DOM change callback can become async without changing `applyViewState`'s synchronous API. Await existing full barrier before `profileItem`/apply/use; reacquire selected id/page and explicitly reject a stale selection. A predicate of only `activeProfilePage()==='orders'` misses legacy cross-page data. Conservative gate whenever a loaded Orders snapshot is thin. This handler is **not** covered by the local Focus/All button gate. |
| `filterSelect` change (`app-main:17613`) → `applyFilterState` | Restores arbitrary `colFilters` keys and quick/dimension filters, then synchronously renders (`17330–17354`) | Same awaitable DOM callback seam as viewSelect; no Promise return from `applyFilterState`. The exact incoming payload/plan must be evaluated, otherwise promote to full. |
| `viewDeleteBtn` async callback (`app-main:17498`) and `filterDeleteBtn` (`17630`) → fallback favorite apply or system reset | A fallback can expose/refer to an omitted model key even though the clicked action was “delete”; server mutation, favorite storage and profile cache changes precede fallback (`17508–17518`, `17638–17648`) | Already async. For a conservative all-configuration barrier, await before the destructive request and any stored selection change; validate the same current page/id after the wait, then preserve confirmation and existing error path. Gating only the fallback apply is too late for “no side effect on gate failure.” |
| `viewResetBtn` listener (`app-main:17587`) → `resetViewToSystemDefault` (`17540`) | Clears all hidden keys via fresh `initColState`, resets sort, writes persisted view/freeze and renders | Replace only this listener with an async wrapper that awaits before calling the unchanged sync reset function. Delete-fallback caller is separately awaitable. Direct unknown sync reset calls still require full fallback. |
| `filterResetBtn` listener (`app-main:17653`) → `resetFiltersToSystemDefault` (`17567`) | Mutates DOM filters/state, saves and renders | Same concrete async listener seam; an already certified plan might prove removing a filter safe, but this packet does not invent that proof. Conservative promotion is valid. |
| Header-filter button callback inside `renderFullTable` (`app-main:7865`) → `openHeaderFilter` (`7012`) | Immediately reads `rowsForFilterUniverse`, date schema and unique values; nested apply/range/sort callbacks later write `colFilters` or `ordersSort` (`7097–7105`, `7130`, `7176`) | An async button wrapper can await before the synchronous popup opens. It must reacquire a still-connected current header after hydration/render; using a detached old `fbtn` is unsafe. Existing header-filter `open` API and nested callbacks stay sync. A popup already open when a thin replacement arrives is an admission/fallback blocker; no event replay or silent empty-values substitute. |
| Orders header sort callback in `renderOrdersNow` (`app-main:9842`) | Immediately writes arbitrary `state.ordersSort={key,dir}` then `renderOrders` | Callback can become async, but must preserve the user's toggle direction and validate current schema/selection after await. If its key is explicitly retained by the current certified plan the mutation may be proven safe; hiddenness alone is not proof. Unknown key/config → full. |
| Native load/CP/model live changes → `ensureCpLoaded` (`2158`), `loadFromServer` (`15144`), model edit handlers (`5770`, `5828`) → `syncCpModelColumns` (`4004`) → `syncOrdersColumnsFromCp` | Rebuilds Orders schema, deletes no-longer-valid filters, restores saved hidden/order then `BLFormulaColumns.syncColumns('orders')` | Outer network handlers are already async; await **before `syncCpModelColumns` and its first mutation**, not inside `syncOrdersColumnsFromCp` after CP columns have changed. Do not equate CP/Orders source/access/horizon or expose a CP-only schema. Any uncovered sync schema-change call means full fallback. |
| Live master event `initLiveSync` (`38986`) → `refreshSharedMasterClient` (`38930`) → `loadFromServer(false)` | Reaches the same synchronous model/note/formula schema chain; `modelConnections` first calls `modelConnLoad`, whose own method does not sync formula columns (`12630`) | Actual `loadFromServer` await seam above. There is **no literal `formula-cols` event/storage listener** in the inspected public/server/tests source. Formula definitions currently read through storage on every definitions call; do not invent an event replay mechanism. |
| `BLPresetShare` → `adoptAndReload` (`public/preset-share.js:39`) → `BLStorage.adoptRemote` (`user-storage.js:204`) | Immediately writes/locks adopted keys, waits 400 ms before reload | Adopt/update callback is async, but `adoptRemote` itself is a sync API. Unless the outer callback promotes first, its pre-reload interval is an uncovered config state. No assumption that a scheduled reload prevents reads. |

## Synchronous formula blockers and exact legacy semantics

`BLFormulaRows.orders` (`app-main:13640`) returns the current array synchronously;
`applyFormulaColumns` (`13645`) synchronously calls `fc.refresh`. Actual visible
Orders render calls it before filtering and sorting (`9776`). These APIs cannot
return a Promise, stale full rows, an empty array or missing full values.

`public/formula-columns.js` has these real synchronous exported APIs:

- `save` (`63`): persists immediately; `definitions` loads afresh (`70`).
- `syncColumns` (`159`): calls `migrateReferences`, then `BLFormulaRows`, column
  schema resolver, column manager restore, group placement and persistence.
- `migrateReferences` (`585`): reads the first 50 rows' **own presence** and
  preserves existing alias priority; may save a rewritten definition and clear
  compiled programs. The current first-50 behavior is preserved, not treated as
  a dependency certificate. References already in `index.byKey` are preserved;
  this packet does not claim dropping only certified CPX fields automatically
  changes every migration.
- `refresh` (`312`) → `applyToRows` (`237`): actually compiles definitions,
  resolves own field > calculated alias > model alias and mutates every target
  row with formula results/null errors. A newly hydrated formula reading an
  omitted model field therefore produces missing-column errors/nulls; changing
  hidden state does not repair that.
- `finish` (`1976`), `remove` (`1988`) and `init` (`2023`) call those APIs
  synchronously. Init is invoked from DOMContentLoaded or immediately at module
  load. These entrypoints have no internal await-compatible seam preserving
  their current return contracts.

The local formula editor gates already installed by root cover only their own
callers. Direct exposed `save/syncColumns/refresh/migrateReferences/remove`, a
late init, native storage writes, already-open popup, or an unknown rule/config
writer is an **explicit full-envelope fallback condition** until an actual
caller adapter or certified retained dependency closure covers it. A guard name
or this document is not proof of closure. Current public default stays full.

Two existing behaviors need to remain visible during adoption: (1) hydration
increments `applied` only for changed remote entry values; deletions/role defaults
alone do not increment it, while app-main re-applies state only for `applied>0`;
(2) legacy unscoped `applyViewState`/`applyFilterState` payloads can modify several
tables even when active tab is CP. This packet does not silently change either.

## Small executable drafts, still unrun

`draft-transforms.cjs` supplies only two concrete seam changes in memory:

1. An optional `BLStorage.hydrate({beforeApply})` callback, awaited after a valid
   response and before its first role/native/meta mutation. A callback rejection
   propagates rather than becoming false `{applied:0,pushed:0}` success; ordinary
   existing fetch errors retain their current fallback. App-main provides the
   callback using its existing full barrier and reads the **live** thin state at
   response time. No synchronous storage API is changed.
2. Await the existing full barrier at both actual cached/remote profile apply
   seams. Full data keeps the existing immediate cached-body behavior. Existing
   profile page/generation cancellation is repeated after the newly inserted
   awaits. No `applyViewState`, `applyFilterState`, `BLFormulaRows`, synchronous
   screen getter, native copy path, CP loader or formula engine is changed.

These drafts do **not** cover every table row above and cannot enable public
thin mode. The remaining DOM/deletion/reset/header/adopt callers need explicit
adoption plus production-function tests; their await seams are identified, not
implemented or counted as verified. No fields are selected for omission here.

`config-barriers.test.cjs` executes actual pinned source in VM: extracted app
functions use the repository's unchanged extractor; real user-storage and real
formula modules/engine are loaded. It prepares baseline RED expectations for
both hydrate and profile waits, rejection with no mutations, and a replacement
thin snapshot arriving during an HTTP wait. Additional assertions preserve the
existing no-hook/offline storage result, synchronous full cached-body behavior,
own-field-over-model-alias formula result and synchronous row-array API. The
diagnostic late-formula test demonstrates the blocker; it is not admission
proof. No existing assertion/test is edited or relaxed.

Root may later run serially under its common lock, from this directory:

```sh
node --test config-barriers.test.cjs
BL6A_CONFIG_DRAFT=1 node --test config-barriers.test.cjs
```

Those are future commands, not results. A source hash mismatch stops instead of
testing another revision. Root owns adoption, actual RED→GREEN, existing suites,
TR/EN/release obligations if visible behavior changes, P1 review and measurement.
