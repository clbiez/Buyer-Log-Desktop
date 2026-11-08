# v2 — app-main-only bounded patch/test draft, unrun

This new subdirectory preserves all four v1 files, the 11 v1 test drafts and
their pins byte-for-byte. It changes no worktree/product/test/CI file. No syntax
check, test, app, server or benchmark has been run by the preparer. Source pin is
the v1 `pins.json`, revision `b6c8504ae418ebe731af7000f33e0eb1aa2f9f17`.

`app-main-draft.cjs` is a bounded exact-string patch recipe for root's review and
later in-memory RED→GREEN tests. It rejects missing/ambiguous seams. It exports a
pure `patch(originalSource)`; it neither reads nor writes the worktree. No
user-storage change is included. The optional `beforeApply` storage patch in v1
must be reviewed/adopted/tested separately.

Concrete changed seams, all in actual `public/app-main.js`:

- `viewSelect` and `filterSelect` change listeners (`17483`, `17613`): when a
  loaded Orders snapshot is thin, await `ensureOrdersFullForAction` before
  `profileItem`, apply or use/cache mutation. Only the minimal UI target/id/page
  is captured before waiting. Recheck same page, DOM node, connected target,
  selected id and non-thin state before looking up the current profile item.
  Stale/rejected waits use existing localized `ordersFullActionError` and toast;
  no replay, partial apply, substitute empty data or silent retry.
- `viewDeleteBtn` and `filterDeleteBtn` async listeners (`17501`, `17631`): gate
  before profile-store membership/favorite capture, confirmation or request;
  recheck page/node/id. A queued operation has its own thin-only gate before it
  reads the current store revision/builds the DELETE request. After the response,
  another thin-only gate precedes the first local cache/favorite mutation and
  fallback/reset. This covers a replacement arriving while queued or in flight.
  A post-response failure cannot undo an already completed server deletion;
  existing catch reports failure and local fallback is not applied. This is an
  explicit transactional limitation, not a claim of rollback.
- `viewResetBtn` and `filterResetBtn` registrations (`17581`, `17653`): only the
  DOM listener becomes async; it awaits only for thin Orders and validates its
  current page/button before calling the original synchronous reset function.
  Both reset function bodies and their other callers remain unchanged.
- `applyProfilesForCurrentPage` (`17657`): gate before the real cached apply and
  recheck after remote waits before the stored apply. Existing generation/page
  cancellation is repeated after the inserted awaits; no config action is
  replayed. Non-thin full-data cached application still executes immediately.
- `loadFromServer` direct `applyCachedProfilesForCurrentPage(initialScreenLoad)`
  call (`15264`): thin-only gate immediately before that direct invocation,
  followed by current profile-page and non-thin checks. Its existing catch handles
  rejection. This particular cached-call guard does not retroactively guard the
  earlier bootstrap/schema/filter mutations in the large function; those remain
  separate admission/full-fallback concerns identified in v1.

Normal full-data paths execute their existing UI bodies without any additional
await. Async DOM callbacks may return a Promise to DOM event dispatch, which
does not consume it; all full-data body work preceding their original awaits
still executes synchronously. `applyViewState`, `applyFilterState`, reset
functions, `BLFormulaRows`, `BLAIScreenData`, native clipboard, CP loader and
formula API return types/bodies are not converted or changed. Gates apply to a
loaded thin Orders snapshot even while CP is active, because a legacy unscoped
profile can still affect Orders. No field inventory/predicate is invented.

`app-main-barriers.test.cjs` prepares behavioral cases against real pinned
functions/listeners. It loads actual listener registrations, extracts actual
reset/profile/loadFromServer functions with the existing unchanged repository
extractor, and injects only their dependencies. The direct-bootstrap cases
execute the **whole actual `loadFromServer` function**, not a copied suffix or
guard-string assertion. Assertions cover withheld profile capture/mutations,
unchanged full-data synchronous execution, failure before effects, current
target changes, CP-active legacy application, queued/in-flight replacement,
original reset behavior, actual cached/remote seams and exact preservation of
the synchronous API/CP/clipboard function bodies. Source hashes reject drift.

The new async select/reset listeners also catch a synchronous apply/reset body
exception and report it with the existing localized hook/toast; their returned
event promises must not reject unhandled. Tests include these body failures and
both reset gate-reject paths. `applyProfilesForCurrentPage` continues rejecting
on failed promotion; it is not converted to false success. Direct cached-load
failure uses `loadFromServer`'s existing catch/false result, as that API already
does for load errors.

### Actual profile rejection callers root must account for

Only two production callers invoke `applyProfilesForCurrentPage`:

1. `switchTab`, `app-main.js:2355`, assigns `profileReady`. Its derived
   `void profileReady.then(...)` at `2358`, CP `Promise.all(...).then(...)` at
   `2361`, Orders counterpart at `2369`, and Collection counterpart at `2376`
   have no catches. Each derived promise needs its own explicit outer rejection
   handling if public thin mode is adopted; catching only the original promise
   does not handle an uncaught rejected child. The same promise is assigned to
   `startupPageProfileReady` at `2357`, so its startup consumer also retains the
   existing failure contract. This packet maps these edges and leaves switchTab
   unchanged, rather than swallowing a gate failure into successful rendering.
2. `applyFavoritesOnStartup`, `17670`, awaits it. Its actual idle caller at
   `17065` already uses `void applyFavoritesOnStartup().catch(console.warn)`.
   That prevents an unhandled rejection but currently produces only a console
   message; root can choose its existing visible localized hook at this outer
   boundary. This packet does not silently mark the operation successful.

Root can later run sequentially under the existing common lock:

```sh
node --test app-main-barriers.test.cjs
BL6A_CONFIG_DRAFT=1 node --test app-main-barriers.test.cjs
```

These are prepared commands, not test results. The default run uses untouched
production and should expose missing barriers; candidate mode applies only the
app-main recipe in memory. Existing v1 storage tests and existing repository
assertions remain unchanged. Root owns actual run/adoption/checks.

This bounded packet closes only the listed candidate seams if later proven by
execution. Unknown synchronous formula/config readers/writers, already-open
popups, native storage paths and uncovered schema changes remain explicit full
fallback conditions. No public thin activation, measured gain or phase-complete
claim is made.
