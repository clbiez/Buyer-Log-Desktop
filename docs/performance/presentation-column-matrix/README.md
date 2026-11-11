# Presentation column matrix acceptance

Risk P2. Base Main `34a0e2cc12cd7f91a51e5e05b5a686cc93af09c1`.
Measured executable source: `84a62e55`.
Later screenshot/evidence-only commits do not change this executable source.

The old first screen was a field form without a preview. The new first screen includes a column role matrix and continuous, virtualized slide preview. Their first-screen costs are shown separately rather than claiming identical work. The additional full-text wrapping/continuation calculation is required new work and has its own active budget. Legacy non-matrix layout behavior remains covered by the existing layout/export suite.

## Budgets and method

See `budgets.md`, recorded before implementation and before the worker remediation. Three alternating Main/candidate pairs on the same Linux host, Node v24.19.0, system Chromium through Playwright; actual shipped editor, styles and canonical fields. Deterministic, synthetic model records with category, fabric, fit and price; 24, 240 and 30,000 records. No company data, credentials or upstream services.

Source/component fixture and commands are in `benchmark.cjs` and `resources/app/tests/helpers/lcwai-column-matrix.browser.cjs`. Run after installing the app dependencies, with Playwright available:

```
flock /tmp/buyerlog-performance-measurement.lock node docs/performance/presentation-column-matrix/benchmark.cjs
node resources/app/tests/helpers/lcwai-column-matrix.browser.cjs
```

`feedback` measures open intent through the next animation frame. `ready` includes the actual full slide plan and first visible previews. Main-thread long tasks are captured with PerformanceObserver; these are not inferred from CPU microbenchmarks. Medians are not p95 estimates. Raw samples are in `samples.json`.

| Models | Old form feedback, ms | New matrix feedback, ms | New full preview ready, ms | New DOM nodes |
| --- | ---: | ---: | ---: | ---: |
| 24 | 12.1 | 20.1 | 27.8 | 518 |
| 240 | 11.3 | 12.0 | 161.6 | 519 |
| 30,000 | 251.9 | 24.6 | 1881.9 | 519 |

All candidate samples had no main-thread task over 50 ms. The old 30k form had a approximately 250 ms task. An intermediate synchronous matrix took 2541 ms at 30k; it was rejected and replaced with on-demand planning in one cancellable worker and a bounded DOM window. This is not a claim that the new full-text calculation itself is faster than the old truncated-text calculation: the worker performs the additional work while the editor remains available.

## Lifecycle, correctness and limits

The browser acceptance checks actual checkboxes, cross-page card movement, group movement, undo, five small-editor close/reopen cycles and five worker-backed editor cycles, English labels and reduced-motion. Closing before the worker debounce expires starts no worker; completed/closed editors retain zero active workers. Preview listeners are aborted and pending animation frames are cancelled on replacement/close. Images remain under the existing source image limit; opening this editor does not add an upstream request or a background poller. Worker assets are requested only for an active large scope (the planner and its shared geometry module).

The new active work is bounded by the existing 30k record limit, one worker and a viewport-sized DOM. DOM and worker lifecycle counts are measured; they are not claims about peak RSS or native Electron memory. No Electron/preload/IPC path changed. Linux Chromium is the UI evidence; Windows/Electron and institutional network performance were not measured here.

Node regressions verify every record survives paging, fixed point sizes, complete wrapped text, extreme detail continuation, source immutability, manual order, cover order, normalization bounds and omission of record-specific data from reusable templates. Existing real PPTX/HTML/PDF/XLSX service tests also run unchanged. CSS and translation guards were repaired in production code rather than relaxed.

Decision for the measured web interaction and lifecycle gates: PASS. Native platform limits above remain explicit. The first form and full preview are different workloads; the approximately 11 ms added small-scope first-use cost remains inside the predeclared new-screen budget.
