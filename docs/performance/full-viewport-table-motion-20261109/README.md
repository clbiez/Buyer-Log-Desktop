# Full viewport table entrance — renderer acceptance

**Decision: PASS (shared Chromium renderer). Risk: P2.**

- Base Main: `4a0cc7b4a67c6c6bcd98e7b1c88db8f1cbef841d`. Measured source: `732cb7b8`.
- `public/motion-plus.js` blob: `e3df37f42d0a9dde17d740e36b3661276fb8cdeb`; evidence-only commits do not change the measured runtime.
- Isolated synthetic 180-row ASAS/warehouse fixture, seed 7, fixed date 2026-11-09. Workbook SHA-256 values are in `results.json` and match the A/A control.
- Linux, Node v24.19.0, Chromium 151.0.7922.173, 1920×1150. Fresh browser contexts; shared warm demo server. Three alternating Main/candidate pairs, followed by three Main/Main control pairs.
- The route replaces only `motion-plus.js`; every other app/server byte is identical. In the A/A file both `kind` labels load Main.
- Budgets were saved before the source change in `budgets.json`: new activation setup <50 ms, all eligible visible rows covered, entrance finishes ≤391 ms, no retained effects after cancel, no data changes or additional requests. Existing navigation must show no repeatable regression; use Main/Main sampling to resolve noise.

## Behavior and new work budget

At standard size CP and Orders each have 22 eligible visible rows: Main animates 6; the candidate animates all 22. All four visits in all three candidate runs pass coverage and exact cell text/row identity parity. All row entrances finish at 390 ms. The candidate activation setup median/max is 5.7/6.7 ms (Main: 4.45/6.5 ms). This explicitly budgets the extra visible row work, rather than claiming it costs nothing.

In all six runs, five immediate activate/wheel-cancel cycles retain zero row animations. Unit tests also cover disabled/reduced/hidden/software paths, cancellation, selected/edited rows, scroll-container clipping, a 1,000-row viewport fixture and bounded probes over 10,000 rows. Actual UI appearance coverage is TR/EN × light/dark × four sizes.

## Existing navigation and rendering

The browser records time inside the page, avoiding Playwright polling/transport time. `domReadyMs` is intent→first existing data cell; `nextFrameMs` waits for two animation frames. Long tasks are observed for the navigation plus 1 second. Old >50 ms render tasks remain visible in the evidence; this change does not claim to fix them. Three observations per variant do not support a p95 claim.

| Scenario / metric (ms) | Main median | Candidate median | Main/Main observed range |
| --- | ---: | ---: | ---: |
| First CP / domReadyMs | 751.4 | 745.6 | 710.1–1210.9 |
| First CP / nextFrameMs | 830.7 | 840.4 | 800.9–1289.6 |
| First CP / longestTask | 366.0 | 356.0 | 352.0–447.0 |
| First CP / totalLongTasks | 1073.0 | 1165.0 | 1027.0–1270.0 |
| First Orders / domReadyMs | 487.4 | 454.7 | 436.5–502.2 |
| First Orders / nextFrameMs | 581.0 | 848.9 | 511.0–788.7 |
| First Orders / longestTask | 289.0 | 263.0 | 260.0–353.0 |
| First Orders / totalLongTasks | 933.0 | 837.0 | 789.0–963.0 |
| Repeat CP / domReadyMs | 67.1 | 75.7 | 66.1–75.4 |
| Repeat CP / nextFrameMs | 411.6 | 412.6 | 387.9–455.9 |
| Repeat CP / longestTask | 281.0 | 275.0 | 259.0–296.0 |
| Repeat CP / totalLongTasks | 407.0 | 407.0 | 379.0–449.0 |
| Repeat Orders / domReadyMs | 5.6 | 6.1 | 4.7–8.3 |
| Repeat Orders / nextFrameMs | 229.3 | 274.4 | 225.2–302.5 |
| Repeat Orders / longestTask | 163.0 | 171.0 | 159.0–204.0 |
| Repeat Orders / totalLongTasks | 227.0 | 269.0 | 222.0–275.0 |

Navigation differences fall within the measured Main/Main variability span. In particular, first Orders frame timing is noisy while first data readiness and total long-task time improve in the candidate median. Repeat Orders frame timing and CPU totals overlap the Main/Main control range. There is no general speedup claim; acceptance concerns complete animation coverage within its fixed duration and setup budget. Startup medians are shown below; the updated function runs only on visible page activation, with no new startup loader, native/preload path, network request, poller or dependency.

Startup UI-ready median: Main 1906 ms → candidate 1926 ms. Main/Main range: 1867–2338 ms.

Network/data/export logic is untouched; source review confirms no added request path. Resource acceptance is the bounded ≤128-row probe in at most two tables plus zero retained row effects after cancellation, not an unmeasured process-RSS claim. Native tab/preload behavior is unchanged; Windows, VDI and physical GPU behavior were not measured. Software compositing keeps its existing no-table-animation path.

## Verification and reproduction

- 62 Motion+/disclosure/agent tests passed; 40 Manifest/selection/render-profile tests passed; 23 release/i18n/asset contract tests passed.
- `npm run i18n:check`: zero missing strings. `npm run release:notes:validate`: 11 changes accepted.
- The post-change screenshot was visually inspected: all visible lower rows are paused mid-entrance. It uses synthetic data and is stored with the bilingual pending release note.
- Full regression was not required for this renderer-only P2 fix. PR fast checks are tracked separately in the PR.

From repository root, with existing app dependencies, Playwright and `/usr/bin/chromium`:

```bash
flock /tmp/buyerlog-performance-measurement.lock node docs/performance/full-viewport-table-motion-20261109/acceptance.cjs
MOTION_AA=1 flock /tmp/buyerlog-performance-measurement.lock node docs/performance/full-viewport-table-motion-20261109/acceptance.cjs
cd resources/app
node --test tests/motion-plus*.test.js tests/staggered-disclosures.test.js tests/agent-instructions.test.js
npm run release:notes:validate
npm run i18n:check
```

The script creates isolated synthetic data and raw results under `work/full-viewport-motion/`, shuts down its browser/server, and captures the release-note PNG. Preserved raw observations: `results.json`, `aa-results.json`. No real business data is used.
