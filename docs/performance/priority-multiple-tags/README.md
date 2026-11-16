# Priority multiple labels — acceptance

Risk: P2. Performance tier: L2, PASS. Base main: `08fefc06e6ac025c013fc2f89d69446b0dc395f5`.

Synthetic data only; Chromium 151 on Linux, actual application UI and production Orders worker. `budget.json` records the budget set before implementation. `performance.json` contains all three alternating A/B samples, baseline A/A noise measurements and a separate three-label case. Primary decision digest and row count agree in every paired sample. The legacy single-label medians were 2221.8 ms (main) and 1981.0 ms (candidate); this is acceptance evidence, not a general speed claim. The new three-label workload completes in 1694.8 ms, below its 10000 ms budget. Resolving 80 visible cells takes 0.8 ms, below 200 ms. No main-thread long task was observed in these worker runs.

Actual UI acceptance verifies three matching labels before configuration, A+B after B hides C, the hidden-C tooltip, CP/Orders agreement, worker transport of all three labels, default-column badge visibility, persisted configuration after reload, English labels and cyclic-edit rejection. See `ui-result.json`, the editor screenshot and the pending release screenshot. Manual column widths and virtual row heights are preserved. Clipboard uses the same visible label resolver; regression tests cover filters, deduplication, chains, imported cycles, managed catalogs and preview impact.

Reproduce from `resources/app` with Playwright and Chromium installed:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright node scripts/priority-tags-ui-acceptance.js
PLAYWRIGHT_MODULE=/path/to/playwright flock /tmp/buyerlog-performance-measurement.lock node scripts/priority-tags-performance.js
npm test -- priority checklist-studio cp-rule cp-personal i18n-coverage
```

`BUYER_LOG_PRIORITY_CAPTURE_ROOT`, `BUYER_LOG_PRIORITY_TEST_PORT` and `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` configure isolated UI acceptance. `BUYER_LOG_PRIORITY_PERF_JSON` selects the performance report destination. All runtime fixtures are generated in temporary directories. No application data or credentials are read from an existing installation.

Final local full regression: 1397 test files PASS (231.7 seconds); platform-gated skips are reported by the runner. Official TEST still runs the mandatory Windows full suite. Windows/Electron rendering was not measured locally. Branch protection on main is disabled; merge is gated by observed local regression and actual PR checks, not assumed protection.
