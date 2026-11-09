# FX admission follow-up — 2026-11-09

Contract: [#937](https://github.com/clbiez/Buyer-Log-Desktop/issues/937).
Initial base: `511cb2fae629cd6e0c1ad31eb773775e5c95841d` from a fresh `origin/main` fetch.
Branch: `fix/followup-fx-admission-20261109`; separate worktree.
Delivery base: `3b38cab887d9a5590a234f6c6f73c8dec0b01c6b`. During
validation Main pinned/archived the 7.0.343 release notes. The branch was rebased
onto that Main metadata update; the FX implementation and test bytes did not
change. Main then restored the Excel-import note queued after the release freeze.
That existing record and package metadata were preserved byte for byte, with
only the FX record appended. The upstream archive is untouched.

## Behavior and ownership

- `server/server.js`: only `syncFxFromKurWorkbook` changed. The worker's actual
  `parse-failed` result remains the corrupt-file signal. Rejected admission yields
  `worker-busy`; other thrown processing failures yield `sync-failed`. Neither
  saves rates, records a source fingerprint, nor publishes a successful update.
  An unchanged normal read clears stale failure status without writing.
- `public/fx.js`: TR/EN status text, explicit-apply error refresh, and the guard
  against opening folder AI recovery outside `parse-failed`. A failed explicit
  BUSY request refreshes the status and removes the obsolete force-apply button.
- One FX-only regression test file; one pending release-note record and PNG.
  No other application modules changed. Documentation/evidence stays here.
- No new runtime retry, timer, worker or queue. Existing 5000 ms timeout,
  `shared-fx` serialization, queue limits, merge policy, revision conflict
  re-read, permissions and explicit fingerprint/revision checks are preserved.

## Reproduction and targeted validation

`red-main.log.gz` (lossless raw output; `gzip -dc` to read): the first five regression tests ran against unmodified Main
application sources: **1 PASS / 4 FAIL / 0 SKIP / 0 CANCEL**. BUSY was reported
as `parse-failed`; worker failures shared that state; stale status survived an
unchanged read; explicit BUSY failed to expose its status.

`green-targeted.log`: **34 PASS / 0 FAIL / 0 SKIP / 0 CANCEL**, including the
new regression, existing folder guards, import engine/upload tests, dedicated
Excel-worker wiring and worker queue tests. The new test uses an actual Excel
worker client, fills its admission queue, drains it, parses the unchanged valid
workbook and verifies exactly one save/publication and preserved uncovered cells.

```sh
cd resources/app
node --test tests/fx-folder-admission.test.js tests/fx-folder-kur-guard.test.js \
  tests/compute-fx-wiring.test.js tests/excel-worker-queue.test.js \
  tests/fx-import-engine.test.js tests/fx-kur-upload-lazy-xlsx.test.js
```

## Actual synthetic application acceptance

`acceptance.cjs` launches the actual Express server on loopback with temporary,
generated demo sources and opens its actual UI in Chromium/Playwright. The
acceptance-only child process captures existing FX route dependencies through
an IPC seam; no application endpoints, queue limits or parser outcomes are mocked.

`acceptance.json` pins the exact changed application files with SHA-256 hashes:
the recorded Git HEAD is the base because the implementation was still in the
worktree at capture time. It contains the raw actual-server outcomes and stats.

- Default singleton admission: **2 active workers + 64 queued jobs**, genuine
  `EXCEL_WORKER_BUSY`; revision and rates unchanged.
- Queue drains; the same valid workbook applies on the next normal attempt;
  duplicate attempt leaves the revision unchanged. Uncovered rates survive.
- Missing file has no parse-failure status. Corrupt workbook has `parse-failed`
  and the AI recovery action; valid workbook proceeds normally.
- TR and EN BUSY status, no AI/force-apply button and no browser writes during
  display. Both 1440×900 screenshots were visually inspected.
- Older report: declining confirmation sends no write. Confirming while the
  real singleton is saturated returns BUSY and preserves revision. After drain
  and a normal attempt, confirming writes exactly once. Stale revision and
  changed fingerprint return their existing 409 errors without writing.
- No renderer errors. No production service or real business data used.

```sh
flock /tmp/buyerlog-performance-measurement.lock \
  node docs/performance/followup-20261109/fx/acceptance.cjs
```

## Release notes, i18n and review

`i18n.log`: 0 new omissions, 0 baseline omissions. `release-notes.log`: two
valid pending entries, only one added by this branch: `fx-folder-admission-status-20261109`.
PNG: `resources/app/public/release-notes/next-assets/fx-admission-busy-tr-20261109.png`.
English capture: `fx-admission-busy-en-20261109.png` in this directory.
Before the upstream archive update, the six pre-existing entries and package
metadata were preserved byte for byte up to the append point (the seven-entry
validation is retained in `release-notes-pre-main-archive.log`). At the final
base, the existing pending Excel-import record and package metadata are preserved
byte for byte up to the append point. No existing archive or other release-note
entry is modified by this branch. The i18n baseline is untouched.

Critical diff review checked that BUSY cannot reach `saveFx`, update provenance,
publish a revision or enable AI repair; that the normal attempt has no failed-file
memoization; and that explicit consent, permissions, revision/fingerprint and
uncovered-cell merge protections remain intact. Review was by the implementing
agent; no independent agent review is claimed. This changes failure reporting
at the FX boundary, not the rate calculation or synchronization write policy.

## Full regression

The first standard run stopped in batch 1: **1600 tests, 1571 PASS / 29 FAIL /
0 SKIP / 0 CANCEL**. Failures came from this sandbox's inaccessible default
`/home/agent/.buyer-log/write-recovery`, before the affected tests could run.
The complete failed log is `full-test-environment-failure.log`. A formerly
failing file passes after using supported temporary `APPDATA`/`LOCALAPPDATA`
locations (`environment-probe.log`). No application code or test threshold was
changed for the environment repair.

The replacement standard run starts at batch 1, under the shared measurement
lock, with the original runner and its default concurrency of 4:

```sh
cd resources/app
APPDATA=/tmp/buyerlog-fx-full-regression/appdata \
LOCALAPPDATA=/tmp/buyerlog-fx-full-regression/localappdata \
flock /tmp/buyerlog-performance-measurement.lock npm test
```

Environment: Linux x86_64, Node v24.19.0, npm 11.9.0, installed repository
dependencies, 18 GiB RAM; Chromium `/usr/bin/chromium` for UI acceptance.
Replacement full run: **PASS — 1315 files, all 10 batches, concurrency 4,
9093 tests / 9028 PASS / 0 FAIL / 65 SKIP / 0 CANCEL, 131.7 seconds**.
This first complete PASS is retained as `full-test-pre-main-archive.log.gz` with
`verification-pre-main-archive.json`. A new complete standard run was then
performed after rebasing onto the initial upstream release-note archive:
**PASS — 1315 files / 10 batches / concurrency 4, 9093 tests /
9028 PASS / 0 FAIL / 65 SKIP / 0 CANCEL, 132.0 seconds**, retained losslessly in
`full-test-after-initial-archive.log.gz` and `verification-after-initial-archive.json`.
After Main restored its queued pending note, the complete standard run was
performed again on the final sources; `full-test.log` and `verification.json`
record that final result. Compressed raw logs can be read with `gzip -dc`.
Final-source run: **PASS — 1315 files / all 10 batches / concurrency 4;
9093 tests / 9028 PASS / 0 FAIL / 65 SKIP / 0 CANCEL; 131.6 seconds**.
The 65 skips are the runner's existing platform/optional-test skips (including
Windows browser integration and the opt-in soak); no skip condition was changed.
A partial run was never combined into a passing result.

## Delivery boundary

Only FX is delivered by this branch. SHELL-06, ANA-12, PLM Sync/BOM, #916 engines,
global admission/serialization/timeouts and other performance work are outside
this change. No automatic retry was added: recovery waits for an existing normal
sync trigger. Final PR head, actual CI URL/result and full-run totals are recorded
in the single [FX] comment on #937 after CI completes. No merge, branch deletion,
TEST/STABLE dispatch or issue closure is performed.
