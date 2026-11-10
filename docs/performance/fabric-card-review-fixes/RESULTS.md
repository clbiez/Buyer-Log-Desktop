# PR #967 review repairs

## Fixed behavior

1. Repeated unsent saves (including a subsequent deletion) retain the original shared revision. A newer save made while publication is in flight is advanced to the published revision only after `mirror` confirms its durable write. If the mirror fails and rolls back its optimistic memory, the newer save retains the original base and can retry. Actual peer revisions still produce a conflict.
2. Changing source language cancels timers and invalidates late replies without declaring an unresolved translation valid. Failed/invalid/manual-stale state survives switches. A cancelled translation requires review or explicit manual correction; a valid completed pair stays saveable.
3. The application passes the string UI language expected by the editor. Only fixed language identifiers, the source-language options, legacy source text and bilingual previews are protected from generic page translation. Other UI labels remain eligible for the existing language-change mechanism.

The original fixed separators, technical-number validation, permission checks, lease/CAS checks, and manual overrides are retained. No extra background synchronization or AI path was introduced.

## Verification

- RED: on the original PR source, 5 of 12 targeted regression tests failed, reproducing the three review findings. Further controlled tests exposed the optimistic-mirror acknowledgment case before its final repair.
- Focused suite: 94 tests passed, including actual route registration/dependency checks, asynchronous authentication/lease/CAS tests, dictionary/legacy regressions and editor event-handler tests.
- The CP/Orders regression now requires the observed per-card revision in the delete call instead of its obsolete pre-shared signature; repaint and save revision assertions remain. Route declaration formatting was restored to the repository's existing registration/dependency convention; its test was not weakened.
- Actual application acceptance: `resources/app/scripts/fabric-review-repairs-acceptance.js` boots the real server on isolated synthetic data, opens the real card dialog, checks English labels and fixed TR/EN headers, cancels an automatic translation by changing source language, verifies save is blocked, manually corrects the translation and reads the saved result back through the API.
- The browser test uses a synthetic failing AI stand-in; it does not call a corporate or third-party AI endpoint. The cancelled debounce sends zero AI requests.
- Five actual dialog reopen/close cycles record time to visible feedback and require <=200 ms per cycle, zero extra library requests and no AI calls. Each dialog is disposed after close.
- `npm run i18n:check`: zero new or baseline missing translations.
- `npm run release:notes:validate`: passes, including the inspected post-change PNG captured from the actual synthetic Buyer Log session.
- Full regression and final browser metrics: see `validation.json` generated from the final run. Runtime file SHA-256 fingerprints bind the browser result to the repaired files; source is asserted unchanged during that run.

Commands (from `resources/app`):

```sh
node --test tests/server-route-modules.test.js tests/fabric-shared-segments.test.js tests/cp-orders-fabric-cards.test.js tests/fabric-cards.test.js tests/fabric-async-requests.test.js
flock /tmp/buyerlog-performance-measurement.lock npm test
flock /tmp/buyerlog-performance-measurement.lock node scripts/fabric-review-repairs-acceptance.js
npm run i18n:check
npm run release:notes:validate
```

`flock` serializes heavy local runs on Linux; it is not a Windows app requirement. Playwright and Chromium are environment capabilities used by the acceptance script, not new production dependencies.

## Performance decision: BLOCKED for merge

The repair adds constant per-code ancestry bookkeeping and no new per-edit disk write, full-library copy, startup dependency, timer, poller or SSE stream. A successful mirror performs at most its existing one cleanup write; if a newer local save replaced the entry, that write advances its confirmed base rather than deleting it.

Candidate feedback/network/cleanup measurements are in `validation.json`; they are supporting evidence, not a Main-versus-final product performance certificate. The parent PR's full Main comparison, native Electron/Windows/SMB and real Shared Hub device acceptance remain unverified. External LCW AI availability is also not established by a stubbed failure scenario. No independent second-model review was performed.

Keep PR #967 draft. Do not merge, mark all P1/product gates passed, or publish TEST/STABLE based solely on these repairs and automated checks. No release publication was requested or triggered.
