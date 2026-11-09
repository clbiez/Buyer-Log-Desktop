# SHELL-06-NATIVE acceptance

This directory closes the native acceptance gap of existing PR #939. It does
not claim Windows, SMB, corporate upstream capacity, global speed, or RSS gains.

## Source and runtime

- Previous PR head: `97a03e4e28a34ea8e9babad0fc1625f72aaf790e`.
- Initial current Main: `5740964180eba32a41316e2970b969f3d8359d99`, normally
  merged as `c03da67038ed3c4bcb5ccf5301ea3c3c2d113702`.
- Native fix: `b8a53973`; current Main `62f2153d` subsequently normally merged
  as `497464758a58e3636e67dddc45124fe067e57cf1`.
- The latter Main advance only adds agent instructions and the performance
  acceptance contract. Product and test sources are identical across that merge.
- Debian GNU/Linux 13, Linux x64; official Electron **44.3.0**, Chromium
  **152.0.7977.78**, Electron Node **24.20.0**; backend/tests Node **24.19.0**.
- Target version is independently specified by repository `version` and
  `.github/installer/runtime.json`. Official release ZIP SHA-256:
  `8b49b9efdd73c0f467edc3c1cd5678392c384ccf224f34ff54179f736e2f384b`,
  matched against Electron's official `SHASUMS256.txt`.
- Official Debian Xvfb package `21.1.16-1.3+deb13u4` was extracted under `/tmp`
  without a system install. Xvfb display `:96`, 1600×1000×24. Electron uses
  `--no-sandbox` in this development container; this is not an OS sandbox test.
  The production renderer still has nodeIntegration=false, contextIsolation=true,
  sandbox=true, and webSecurity=true preferences, recorded by the probe.

`source-proof.json` pins source hashes, proves equality with current Main outside
the two authorized app-main blocks, and verifies every other release-note entry
and metadata value is preserved. Only `initLiveSync` needed an additional product
change in this stage. Workspace manager, both preloads, warmup, server, transport,
worker/pool and PLM/BOM code were not edited by this stage.

## Reproduction

Install/extract the official Linux Electron 44.3.0 runtime and Xvfb outside the
repository. Use the app's existing dependencies; no dependency/version change is
part of this PR. With Xvfb running and from the repository root:

```bash
PROBE_NODE=$(command -v node) DISPLAY=:96 \
  flock --close /tmp/buyerlog-performance-measurement.lock \
  /tmp/buyerlog-native-runtime/electron/electron --no-sandbox \
  docs/performance/followup-20261109/shell06/native-final/acceptance.cjs
```

The probe imports the **unmodified production** `createWorkspaceManager`, which
constructs real WebContentsViews with the production content preload and shell
preload. It runs the actual Buyer Log application/server with temporary data
roots, local synthetic authentication, generated `--rows 20 --seed 7` workbooks,
and no production services. Outbound application requests are denied. A local
forwarding proxy only delays the real revision response in the slow scenario;
it does not replace the response JSON. The main-process harness registers the
narrow IPC handlers needed to host the workspace. It does not run the Windows
portable launcher/updater, and those paths are not claimed as accepted.

The probe instruments application revision/visibility/preload events, observes
Electron session requests with webContents IDs, and queries real Web Locks. It
does not replace the production lock/channel/poller/preload implementation.
Startup continues through the real Continue button; no readiness gate is forced.

## Native regression and acceptance

Electron's production native tab reparenting can leave DOM visibility `hidden`
while the preload correctly reports `active:true`. Previously only DOM
visibility and online events woke revision catch-up. The native test advanced a
real quotation revision, switched native tabs, and timed out at the preselected
2,500 ms gate (`native-red.json`, `native-red.log.gz`). The deterministic test
also failed with **1 !== 2 requests** (`native-unit-red.log.gz`).

The minimal fix subscribes to the existing preload `onTabActivity` inside
`initLiveSync`; activation calls the same `onWake` path and pagehide/access
cleanup removes the subscription. No additional leader, timer, or API is added.
The unit suite is **18 PASS / 0 FAIL / 0 SKIP / 0 CANCEL**. Combined actual native
acceptance is PASS (`acceptance.json`, `native.log.gz`):

| Scenario | Observed result |
| --- | --- |
| Three original native views | Production manager, separate renderer PIDs, real preload version 44.3.0 |
| One context | One SSE and one revision-querying webContents; all three connected |
| Revision and normal SSE | Same quotation revision on all views; real pricing-rule PUT reaches all three actual application states |
| Native activation while DOM stays hidden | Revision catches up in **539 ms**, below 2,500 ms |
| Active/hidden switch | Same webContents IDs retained, production activity callbacks recorded |
| Slow request | Real response delayed 12,000 ms; no new request for 8,500 ms; max active=1 |
| Offline/online | Real Chromium network emulation emits offline/online; zero revision requests in 8,000 ms offline, revision/SSE recover |
| Leader close | Closed webContents 2; webContents 3 takes revision/SSE leadership and catches up |
| Reopen | Fresh native view receives current baseline and next revision |
| Dirty state | Real 17-row CP state with synthetic dirty marker survives native switching and production gap resync, retaining object identity; no draft server write |
| User/access separation | Two distinct real native Web Locks; wrong-context BroadcastChannel marker rejected after user-ID and iamRevision changes |
| Startup/module gates | Each opening screen ready before Continue; startup incomplete until Continue; native module preparation stays specific to requested module |

The context separation cases intentionally vary the renderer's synthetic
`BL_USER_CONTEXT` and dispatch the normal access-applied event. They test the
native sharing boundary, not a second authenticated HTTP login or an IAM server
authorization bypass. Dirty-state acceptance tests the real CP guard/state
retention, not a claim of automated keyboard editing of every cell type.

`native-post-change.png` is the actual post-fix CP screen with generated data,
1440×900, visually inspected. It also replaces the existing note's PNG, keeping
the same unique note ID `shell06-shared-revisions-20261109`; its TR/EN alt text
and body now include native activation. Network correctness is proven by logs,
not inferred from the screenshot.

## Comparative performance and cleanup

The docs-only Main merge introduced `PERFORMANCE_ACCEPTANCE.md`. Its narrow
applicable network/lifecycle comparison uses `comparison-budget.json` and three
alternating Main/candidate pairs. Set `PROBE_COMPARE=main` or `candidate` and a
unique `PROBE_OUT` when invoking the same probe. In Main mode **only** the exact
current Main app-main.js is served; all other code, data seed, runtime, origin
policy and readiness steps are identical. Cold launches are separate from the
21-second steady window; no startup latency or p95 improvement is asserted.

Results: **PASS** (`comparison-results.json`). All three Main samples are
**9 requests / 1,998 response-body bytes**, and all three candidate samples are
**1 request / 222 bytes**. Medians are identical to those samples. Each run has
one SSE; candidate revision concurrency is one. All **30** extra-view open/close
cycles pass, and every final close leaves zero views. This measures the native
21-second window with the leader hidden, not a global speedup. All six workbook
semantic hashes match (`fixture-hashes.json`):
`0661bcf9070df6fdf99ae7a88b4fab1942ab30febf2245a07a71ae9131c7068a`.

Five native open/close cycles per run must return to three original tabs and one
held live-sync leader lock; every added view must be destroyed. Final close must
destroy all views. Request count, actual response-body bytes and maximum active
revision requests are recorded, with all raw samples retained. No CPU/RSS change
is claimed: the fix adds an O(1) activation callback to an existing IPC source,
with explicit unsubscribe, and touches no bulk allocation/compute path.

## Regression, i18n and review

- Standard complete `npm test`, default concurrency=4 under the shared lock:
  **1,322 files, 10 batches, 9,141 tests; 9,076 PASS, 0 FAIL, 65 SKIP, 0 CANCEL**,
  102.6 seconds. Full runner/log and counts are in `test-results.json` and
  `full-test.log.gz`. Final product/test source hashes are pinned there.
- Five targeted files: **50 PASS / 0 FAIL / 0 SKIP / 0 CANCEL** (`targeted.log.gz`).
- i18n: zero missing, empty baseline; release notes: six valid entries, one own
  ID; other five entries and top-level metadata preserved.
- An earlier full run was interrupted when the native bug was established. It
  is retained as `full-test-interrupted-before-native-fix.log.gz`, is not PASS,
  and contributes no counts to the successful complete run.
- Early probe development failures are retained: missing Continue on subsequent
  tabs, late observer initialization, old Main lock-name matching and asynchronous
  destruction checks. Those failures were in the measurement harness, not product
  regressions. The later native activation RED is a real product regression and
  has its own paired GREEN evidence. No assertion/budget was weakened to hide it.
- Critical diff review: activation reuses scoped leader wake, does not apply data
  itself, respects single flight/offline/context validation, and unsubscribes on
  cleanup. Browser API fallback remains optional and is covered by existing tests.
  No second-agent review is claimed. The coordinator retains final review.

No Main merge of this PR, branch deletion, TEST/STABLE, issue close, or publication
was performed. Last-head CI is reported in the final #937 comment and PR body.
