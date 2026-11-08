# switchTab profile rejection edges — prepared only

Scope: only the actual `switchTab` profile observer chains in
`/workspace/buyerlog-post-main-acceptance/resources/app/public/app-main.js`, base
SHA `148fa4d8670684067cedeae85c5f82daec28136c51946cf5a1beca5cbb4b9d8c`.
No worktree/product/API/test/CI file is changed. No syntax check, test, child,
server, app or benchmark was executed by the preparer. Earlier packets stay
untouched; root owns adoption and serialized execution.

`draft.cjs` is a pure, bounded exact-text patch recipe. It preserves the original
`profileReady` object and rejection, `startupPageProfileReady=profileReady`, all
success predicates and the synchronous `switchTab` return behavior. It adds a
per-invocation boolean plus a reporting closure using the existing localized
`ordersFullActionError` fallback and `showToast` hook. Five derived observer
promises get their own catches, reporting a given switch's failure once:

1. First-visit marker observer, near 2358.
2. CP `Promise.all([dataReady,profileReady]).then(...)`, near 2361.
3. Orders counterpart, near 2369.
4. Collection counterpart, near 2376.
5. Shipping `profileReady.then(...)`, near 2485.

The CP/Orders catches are on the profile-dependent aggregation branch. Their
direct `dataReady` fallback is left unchanged. Catching derived observers does
not turn the original startup promise into success; failed observers cannot run
their success-only apply/render callbacks. No favorite-marker cleanup, retry,
module lifecycle, permission or data-loading behavior is redesigned. Other
feature promises and non-data branches are untouched.

`switch-tab-probe.cjs` prepares an isolated native child fixture that compiles the
whole actual production `switchTab` and its actual localized error function,
using the unchanged repository extractor. It has explicit synthetic per-module
permissions. The real switch's authorization guard runs, and its data/render
dependencies independently reject disallowed areas; there is no unconditional
permit or no-op authorization guard. Tests include CP-only permission denying
Orders before navigation/load/profile work.

For cold first visits, an otherwise empty deferred-render fixture tests
CP/Orders/Collection/shipping rejection without apply/render. These are bounded
synthetic native fixtures, not an app performance or general lifecycle proof.
The fixture also verifies original startup promise identity/rejection, TR/EN
localized fallback, deduplicated toast, success gating, synchronous navigation,
the already-running-app case, unchanged immediate repeat-Collection rendering
and the unchanged Automations non-data branch. Actual synchronous public APIs
and all source outside switchTab remain untouched.

The disposable test child alone observes Node's native `unhandledRejection` and
`rejectionHandled` events and returns bounded JSON. It observes the original
promise as a synthetic startup owner would; baseline derived failures remain
observable. This hook never enters production and does not suppress production
errors. Parent native tests first save child JSON/stdout/stderr evidence, then
assert no unhandled rejection. Baseline RED therefore uses observable native
events rather than crashing or contaminating the parent test runner.

Future root-only serial commands, not results:

```sh
node --test profile-rejection.test.cjs
BL6A_PROFILE_REJECTION_DRAFT=1 node --test profile-rejection.test.cjs
```

Each fixture has a fresh child with a ten-second deadline and 64 KiB output
limit. Small evidence files use unique `wx` names under `artifacts/` or an
explicit `BL6A_PROFILE_REJECTION_ARTIFACTS` directory. Missing dependencies or
source drift fail the fixture rather than being reported as behavioral RED.
The production profile function retains its rejection contract. Public thin
activation and other unresolved sync-consumer fallback conditions are outside
this preparation.
