# Akış selection and full-row soft light

The chosen composition is selection option 01 plus full-row fade option 03. Idle selectors keep a transparent background and the existing subtle `--ui-group-divider` contour. A native checkbox's fill scales vertically from its center through the shared Motion+ owner. Only explicit user changes start it; identity is resolved after the table's own scheduled redraw, and ordinary refreshes do not replay it.

An orange 3 px overlay shows the existing CP dirty state above the blue selection fill. Reports read `state.cpDirty` through the table adapter; mark/discard schedule the active report. No new dirty tracker or record schema is introduced. Shared freeze ownership keeps the selector above the row light and fixed during horizontal scrolling.

The full-row light is a uniform, pointer-transparent layer. Delegated row entry/exit uses the existing Motion+ cancellation, duration and reduced-motion guards. A layer is created only on pointer entry and removed after the fade; no observers, mousemove listeners or idle pseudo-elements are allocated across a large table. Idle unchecked controls also keep their fill pseudo-element absent. This replaced an initial measured eager-layer version before integration.

Reproduce the actual isolated Buyer Log / Chromium acceptance:

```sh
REPORT_FLOW_ONLY=1 node resources/app/scripts/report-layout-ui-acceptance.js
```

It covers CP, Orders and Collection in normal/report modes, native selection, center-opening fill, full-row geometry and fade/release, shared disabled-motion behavior, CP dirty blue/orange coexistence, discard cleanup, and refresh without selection replay. Dark/light release-note PNGs show actual application state with synthetic data.

Performance tier L2, unchanged report refresh: baseline `421ba814`, same shell, baseline/candidate report JS and canonical CSS, 300 synthetic rows / 12 fields, three alternating pairs with ten measurements per sample. Means before → after: **63.89 → 67.36 ms**, **63.81 → 65.57 ms**, **64.60 → 62.14 ms**. Median pair means: **63.89 → 65.57 ms** (+2.6%); largest pair increase: 3.47 ms. These are scoped synchronous render/layout samples, not a GPU frame-rate or general startup/Windows/SMB claim. Raw samples are retained.

```sh
flock /tmp/buyerlog-performance-measurement.lock env REPORT_PERF_ONLY=1 REPORT_PERF_BASE=421ba814 node resources/app/scripts/report-layout-ui-acceptance.js
```
