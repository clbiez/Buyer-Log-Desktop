# BL-015 — scoped Endeksmatik token adoption

Six existing design regression failures share the recently appended Endeksmatik
upload CSS: fixed typography and raw colour/shadow fallbacks bypassed the
existing system. This correction uses the established scrim, surface, text,
border, shadow, accent/on-accent and status tokens, and fs-xl/fs-md/fs-sm scales.
The current-phase number now uses the theme's on-accent text, including dark
theme. No palette, theme identity, exported table style, formula, progress phase
or upload behavior changes. No design guard/baseline is weakened.

Passed on Linux Node24.19.0: `node --test resources/app/tests/design-token-guard.test.js resources/app/tests/ui-design-system-v1030.test.js resources/app/tests/experience-layer-v20260920.test.js resources/app/tests/layer-system-v1037.test.js resources/app/tests/tab-system-v1036.test.js resources/app/tests/status-feedback-v1038.test.js` — 42 pass, zero failures/skips. `node --test resources/app/tests/file-ready-notification.test.js` — 11 pass, zero failures/skips. These include all six previously red design cases.

Actual normal Buyer Log upload progress was captured in Chromium for all three
themes and TR/EN. The real existing file input/FileReader/progress path ran on a
harmless synthetic workbook. Only the upload HTTP response was explicitly held
by a Playwright fixture and then rejected; no successful import or saved
financial result is claimed. Captures are genuine native UI, not fabricated DOM.
The canonical language button and existing UI-size setter were used. The title
grew from20px at Standard to23px at XL; computed colour values track each theme;
no clipped text at the captured1440x1000 viewport. Reduced motion was enabled.
All six PNGs and exact measured values accompany the change.

Not executed: actual Windows/200% desktop zoom/screen-reader and whole-app
1024–1920 matrix. This is a scoped correction, not completion of broad BL-015
typography/table density or all-module design adoption. Client refresh required;
rollback is normal CSS revert/refresh with no migration.
