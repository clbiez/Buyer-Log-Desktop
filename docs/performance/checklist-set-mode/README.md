# Checklist set tracking acceptance

Base Main: `390bff627d38cf4c8a57cf43b04e5974a2490b3d`.
Primary measured product source: `1c55d8404c5c47fcaeb30c995490a5a3b2dc8b19`.
Final product source: `a047282c251f70ed12be86e9431b4d9a425f060a`.
The final addition preserves explicit `separateSetParts: false` in shared definition writes. Default definitions and the measured part-answer writer, decision, render and roster paths are identical to the primary measured source. Supplementary controls and real UI acceptance run on the final source.

Risk: P2 (normal feature; existing authorization, LWW, transaction, and answer identities unchanged). Performance decision: **PASS** for the changed paths and the measured Chromium scope. Performance tier: L2 because the shared status/render path changes. Budgets were recorded before implementation in `budgets.json`; Main moved once during development, so the final primary comparison uses the updated base above.

## Method and results

Real Chromium 154.0.8037.57 / Node v24.19.0, Linux cloud, deterministic demo seed 7, 40 and 400 rows. Three alternating Main/candidate pairs at each size. Each run performs five real part status/evidence saves and five CP/Orders revisits. Tests and measurements serialize through `/tmp/buyerlog-performance-measurement.lock`. Values are medians of the three per-run medians (startup and final post-GC heap have one observation per run). No p95 or general speedup claim.

| Rows | Source | Startup ms | Synchronous feedback ms | Save ms | CP/Orders revisit ms | Final post-GC heap MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 40 | main | 3675.40 | 6.80 | 519.40 | 214.90 | 13.60 |
| 40 | candidate | 3449.94 | 6.30 | 486.80 | 195.10 | 13.59 |
| 400 | main | 4401.49 | 13.00 | 779.50 | 249.10 | 16.17 |
| 400 | candidate | 4511.59 | 13.40 | 774.00 | 237.70 | 16.14 |

Every primary run sends exactly five POSTs / 1,576 request-body bytes, peak concurrency 1, active requests 0 at completion. There is no new poller, request stream, worker, retained row cache or listener. The cache used for existing canonical-field reads still ends at the existing synchronous pass boundary.

Existing long main-thread tasks remain: the primary Main peaks are 262–572 ms, candidate 293–462 ms. This feature does not fix those legacy render/recompute tasks. Existing answer/history/cache warmup also retains heap across the first five edits in both sources; the table reports actual post-GC endpoints, not peak RSS and not a claim of zero retention. Candidate endpoints do not increase relative to Main. New synchronous status feedback stays below the recorded 200 ms budget.

A slower early 40-row comparison exposed redundant canonical field reads on ordinary rows. The added reads were removed before acceptance. All those samples are retained under `diagnostics/pre-fix/` (source `409fc394`); they are not substituted for final results. `raw/` also retains supplementary A/A and reverse-order runs, including slow observations. These examine startup/scheduling variation rather than applying a percentage tolerance. In the primary 400-row comparison the startup median difference is +110.1 ms against Main run variation of 4292.1–4564.1 ms. Supplementary working-directory runs returned slower startup observations (5281.7 and 5448.6 ms); a fresh clean checkout of the identical final source returned 4412.2 ms, against the primary Main median of 4401.5 ms. Those slower observations remain in the evidence and are not presented as source improvements. The source regression did not reproduce in the clean final checkout; no generic startup speedup is claimed. Primary save and revisit medians decrease at both sizes; final clean-source peak long task is 501 ms, below the existing Main peak of 572 ms. Final clean-source feedback remains below 22 ms. The sparse sample supports this scoped acceptance, not a tail-latency guarantee.

Fixture hashes (canonical order/PLM/model/colour/quantity tuples):

- 40 rows: `e8aaf3e3b72c39b82a2a1faa92e31c6b3d86ca5de99d7ede9bd493bedef2f962`.
- 400 rows: `3e3e146af5f3ed2ce25ee52c52dab5cbb8713511fabbf9b80588c8d0814da213`.

## Correctness and reproduction

228 targeted tests pass, covering per-checklist policy, saved/default behavior, count 1, restart, restored part evidence, native writes, shared definition persistence, mixed supplier workbook round trips, and unchanged authorization/roster validation. The real Buyer Log UI verifies the TR setting, count dialog, authenticated server persistence, restored B evidence and no page errors. The shared-definition false preference is written/read back in 16.3 ms, within the new-action 200 ms budget. Both language strings pass the i18n guard with an empty missing-string baseline. Real post-change PNGs are in `public/release-notes/next-assets/`.

```bash
BENCH_APP_ROOT=/path/to/resources/app BENCH_ROWS=40 BENCH_LABEL=main-40-1 BENCH_RESULT=/path/to/result.json flock /tmp/buyerlog-performance-measurement.lock node docs/performance/checklist-set-roster-sync/run.cjs
BUYER_LOG_STUDIO_CAPTURE_ROOT=/path/to/captures node resources/app/scripts/checklist-set-mode-ui-acceptance.js
```

Repeat the benchmark with 400 rows, alternating Main and candidate three times. Native/Electron/Windows/SMB and corporate upstream are unchanged and not measured; Chromium acceptance is not presented as native acceptance. Full regression: PASS, 1358 test files / 9347 passing tests / 65 skipped / 0 failures, 208.4 s. The 65 skips remain explicit; they are not counted as executed passes. Final i18n and release-note guards pass. CI status is recorded separately in the PR. TEST/STABLE are separate and are not requested.

Final Main integration: `0ee78404` was merged after the full regression. It adds an LCW AI file-upload response fix and its tests, plus a separate release note. Checklist sources and measured paths are unchanged. The new LCW AI tests and final i18n/release-note guards are run after conflict resolution; PR CI checks the resulting merge head.
