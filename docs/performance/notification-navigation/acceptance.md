# Notification navigation acceptance

Baseline: `9e667430` (current checkout of main). Risk P2: presentation and navigation; no write, IAM or persistence semantics changed.

Before implementation: history stores message/kind/time, but no record identity or action. A component validation failure rejects a checklist batch without exposing the failing entry to the client.

Budget: reuse existing toast/history/dialog, add no startup fetch/poller/listener per item. History remains <=250 entries; each target has bounded scalar fields. Compare startup, history first/repeat open, adjacent plain toast in three alternating baseline/candidate browser pairs with identical synthetic 250-entry history and 30k CP rows. Existing medians may not repeatedly regress; A/A control resolves noise. New target activation feedback <=200ms; resolve one canonical line and lazy-load the existing feature only on click. No new >50ms blocking task. Five open/close cycles retain no dialogs; no new navigation network call for loaded CP. Native/Electron is unaffected (no preload/workspace/native-tab code changes); web UI is verified in Chromium.

Evidence and final decision will be recorded after validation.


## Final result: PASS (web UI scope)

Baseline Main: `9e667430e3ac7ca30b321f06893d53f24d6ed5a3` (also verified against remote Main).
Final runtime source: `c448192799888f61cec2c87788397fbbf2fc21dc`. Subsequent commits contain evidence and screenshot bytes only.
Runtime: Node 24.19.0, Chromium 154.0.8037.57, Linux, 1440×900, reduced-motion. Each context uses the real Buyer Log server in isolated demo data/auth directories. No business data is used. Synthetic data is generated deterministically in `browser.cjs`: 250 history entries and a 30,000-row CP with the target at the end. Exactly three alternating baseline/candidate pairs and three A/A pairs; no p95 claim.

| Metric | Main median | Candidate median |
| --- | ---: | ---: |
| Startup to usable shell (ms) | 1184.36 | 1201.82 |
| History first open, 250 records (ms) | 80.3 | 66.3 |
| History reopen, 15 observations (ms) | 79 | 61.9 |
| Plain toast, median of 20 per context (ms) | 0.4 | 0.5 |

The refined repeat uses 20 separate plain-toast activations per context to resolve sub-millisecond single-activation noise. A/A startup medians were 1279.16/1358.93ms and plain-toast medians 0.6/0.5ms; the final +17.46ms startup and +0.1ms plain-toast differences are within this observed A/A noise. No reproducible regression was established. `browser-refined.log` and `browser-control-refined.log` retain every observation.

The first complete functional run on the final source (`browser-final.log`) opened the exact B part in **96.2ms**, with **zero >50ms tasks during activation** and no page errors. The preceding profile identified duplicate canonical scans (one scan ~36ms); the final source yields after 8ms slices and reuses the resolved row when the data identity has not changed. It re-resolves replaced records after lazy loading. No persistent index, worker or background preparation was added.

The existing 250-record history still has legacy >50ms render tasks; those were retained in the raw records, not hidden. Candidate history rendering is faster because a render shares one Intl date formatter. No new growing long task was added to target navigation. First feedback is the shared action button's immediate disabled state; no artificial progress is shown.

Every history cycle asserts that its dialog has been removed. Retained DOM/listener differences are within the baseline's asynchronous shell/tooltip range; baseline and candidate have the same request counts (two background shell requests in the measured five-cycle window). This change adds zero network requests for history and no new polling or per-item listeners. Target navigation reuses loaded CP and existing lazy feature gates. DOM counters are the measured retained-resource metric, not an RSS claim.

Functional coverage includes the exact canonical order/colour and part, updated row IDs, missing records, inaccessible areas, owner/session changes, replacement during lazy loading, read-only fallback, missing set roster, notification history, and TR/EN. The real HTTP/store tests verify error metadata and atomic rejection in multi-order batches; the browser fixture supplies that validated 400 response to control the failure deterministically. No extra retry/write behavior was introduced.

Validation: **318 tests / 53 files PASS** via `npm --prefix resources/app test -- checklist notification feedback file-ready motion-plus i18n release-notes`; i18n missing entries **0**; release notes **13 entries valid**; `git diff --check` clean. New navigation tests fail against baseline (`red.log`). Historical feedback/history source-contract tests were updated to assert the new target argument, preserving history coverage.

No Electron/preload/native-tab implementation, data mutation, permission rule, sync/merge rule or release pipeline changed. Native Electron, Windows/SMB and production workspaces were not exercised; the PASS applies to the changed browser UI and HTTP error presentation. No TEST/STABLE publication was requested.

## Shared API

`showToast(message, {target:{module:'cp',lineKey:lineKeyOfRow(row),itemId:'tests~part~B',fieldTr:'Testler · B',fieldEn:'Tests · B'}})`; `showCenterNotice` supports the same target. Module-only notices can use `{target:{module:'source'}}`. Targets are bounded scalar data, never URLs/functions/transient IDs. Old notices without targets stay readable; no record is guessed from their text.

## Reproduce

From repository root (Playwright + Chromium available):

```sh
mkdir -p work/notification-navigation
git show 9e667430:resources/app/public/app-main.js > work/notification-navigation/base-app-main.js
git show 9e667430:resources/app/public/checklist-supplier-sync.js > work/notification-navigation/base-checklist-supplier-sync.js
flock /tmp/buyerlog-performance-measurement.lock node docs/performance/notification-navigation/browser.cjs
flock /tmp/buyerlog-performance-measurement.lock node docs/performance/notification-navigation/browser.cjs --control --perf-only
```

Source SHA-256 (unchanged after measurements):

- `resources/app/public/app-main.js`: `d4121aeb10bc3915b002bccb6a99f0799860dac1496b73a1f3addd4ef76883e7`
- `resources/app/public/app.css`: `e3ddf9c54fc1614feaa158162f96465252d8e5985099ff01eed9b56246318aed`
- `resources/app/public/checklist-supplier-sync.js`: `07fbf394fee0322dff48c2a1ff9c8d0693f3ff015fad6ae8ae1596e807e636f8`
- `resources/app/server/lib/checklist-supplier-store.js`: `69eb4f91b458ae47fc08b4df2f3c591db5b2830758450b54bf6e80844eff7a49`
- `resources/app/server/routes/checklist-supplier-routes.js`: `05a1413d59fa7be9f5d1ce895ba2f19a24c1c0a4871c5a9d6e8e3d443631193e`
