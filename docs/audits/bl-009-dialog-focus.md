# BL-009 — rendered dialog focus and top-layer ownership

The audit is independently reproduced in actual Chromium using the shipped
helper: a CSS-hidden autofocus input leaves initial focus outside; a hidden last
button makes Tab leave the dialog. The same pre-change browser harness also
exposes late focus restoration stealing a newer dialog's focus and missing
support for native dialog elements without role=dialog.

The shared availability predicate now checks rendered geometry, computed
display/visibility/content-visibility, hidden/aria-hidden/inert ancestry and
native disabled-fieldset semantics. Initial focus and trapping use that
predicate. Positive tabindex ordering is respected; hidden/unavailable middle
controls are skipped without replacing ordinary browser radio/control behavior.
Only the top connected rendered registered dialog handles Escape/Tab. A native
modal child outside the helper retains native behavior. Deferred initial and
return focus cannot overtake a newer dialog; removed, hidden or disabled
triggers are not restored. Existing elevation and onClose business callbacks
are preserved. No observer, dependency, motion timer, styling layer or business
action is introduced.

Verification: Linux Node24.19.0, Chromium headless, synthetic markup/data.

- Passed: `PLAYWRIGHT_MODULE=<playwright-core module> CHROMIUM_PATH=<chromium executable> node --test resources/app/tests/helpers/dialog-focus.browser.cjs` — 10 tests including parent, zero failures/skips. Real keyboard coverage: CSS-hidden edges/ancestors, disabled fieldset, inert, aria-hidden/aria-disabled middle controls, hidden requested input, nested Escape/return, no controls, missing/hidden/disabled trigger, late open/close and native registered/unregistered modal children. Missing browser tooling fails explicitly rather than skipping.
- Actual normal Buyer Log UI: Image Size Limit opens PLM Image Package. Shift+Tab wraps from folder input to Cancel, Tab wraps back while disabled Import is skipped, Escape closes only the child and restores focus to its parent trigger. Nothing imported/deleted/saved. The genuine screenshot shows keyboard focus on that native child input, with synthetic empty business data. It demonstrates native integration; the edge-case synthetic browser tests independently reproduce the audit defect.
- Related Node regression files: `node --test resources/app/tests/layer-system-v1037.test.js resources/app/tests/collection-columns-dialog-v784.test.js resources/app/tests/profile-save-dialogs.test.js` — 14 passed, 1 failed. Failure is the pre-existing Endeksmatik raw-colour addition in design.css already tracked by BL-006/015; the guard is retained, not loosened. No green complete-suite claim.
- i18n check: no new/baseline misses. TR/EN pending note and genuine PNG included.
- Not executed: actual Windows screen-reader/Electron accessibility and full theme/zoom matrix. Shipped light-DOM controls are covered; custom closed-shadow internal tab sequences are not traversed by this helper and are not certified here. Existing browser navigation remains in charge inside such controls. No project-wide accessibility certification.

Client refresh required. Rollback is a normal revert/refresh, without a data
migration; reverting reopens the focus escape. A full supported-runtime green
baseline remains required before release.
