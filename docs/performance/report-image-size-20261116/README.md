# Report image size

CP, Orders and Collection report headings open the existing image-size popover. Both presentations use the same per-table preference and density-aware dimensions. Report columns and image bounds resize in the existing scheduled report render; unchanged cell markup is retained. No new network service, poller or eager initializer is introduced. The selection prototypes in `docs/design/row-selection-options/` are standalone proposals and do not change production selection controls.

Actual isolated Buyer Log and Chromium acceptance:

```sh
REPORT_IMAGES_ONLY=1 node resources/app/scripts/report-layout-ui-acceptance.js
```

The browser uses synthetic records and a synthetic PNG served through the real image cache/thumbnail pipeline. It checks all three modules at minimum and maximum size, actual image/column/row geometry, persistence, resizing in normal view followed by return to report, and the CP heading in TR/EN. `ui-acceptance.json` contains the measured dimensions. The release-note PNG is a real post-change application capture.

Performance tier L2, existing report render hot path: three alternating baseline/candidate pairs, 300 synthetic rows, 12 fields, ten synchronous unchanged render/layout measurements per sample. Same integrated shell; baseline report JS and canonical CSS are from `ea201142`. `REPORT_PERF_ONLY=1 REPORT_PERF_BASE=ea201142` runs this comparison under the shared performance lock.

Before → after pair means: 89.73 → 65.97 ms, 76.90 → 93.11 ms, 80.15 → 69.59 ms. Median pair means: 80.15 → 69.59 ms. One pair was slower; the scenario showed no consistent regression across pairs. These values measure unchanged report refresh only, not general app startup or Windows/SMB behavior. Raw samples are retained in `performance.json`.
