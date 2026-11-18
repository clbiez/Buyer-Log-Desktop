# Always-visible row selection

Positioning belongs to the existing `table-freeze.js` owner. One static stylesheet pins only explicit row-selection controls in the first cell, including report rows and nested import-preview labels. It remains enabled when the user freezes zero data columns. Its layer is above frozen body cells and below headers; selection headings remain above other sticky headings. The rail is not clipped by the independently scrolling frozen pane. The Collection scrolling optimization still applies to other cells while this small selection area remains pointer-addressable.

No polling, observers, per-cell style writes, scroll handlers or new animation engine are added. Boolean permission/data controls and selection-looking controls outside the first column are excluded. The experimental hover HTMLs are proposals and do not change production hover behavior.

Reproduce actual isolated Buyer Log / Chromium checks:

```sh
flock /tmp/buyerlog-performance-measurement.lock env REPORT_STICKY_ONLY=1 node resources/app/scripts/report-layout-ui-acceptance.js
```

The browser tests CP, Orders and Collection: normal/report body and header, zero frozen columns, and a narrow frozen pane with inner scrolling. It checks actual scroll movement, invariant rail position, hit testing and real report selection. The generic selector matrix also covers all shared rail families and excludes boolean controls/non-first cells. `ui-acceptance.json` records the geometry; release notes contain a real post-change PNG with synthetic records.

Performance tier L2: same actual report with 300 rows, three alternating pairs and 30 synchronous scroll-plus-rail-geometry samples per pair. Baseline disables only the new pin stylesheet. Mean milliseconds before → after: 0.0067 → 0.0367; 0.0067 → 0.0500; 0.0067 → 0.0500. Added synchronous cost stays below the 0.1 ms/sample budget in all pairs. These are geometry costs, not GPU paint/frame rate, startup or Windows/SMB measurements. Raw samples are in `performance.json`.
