# Artwork: replace a manual note with the saved BOM

Decision: **PASS** for the affected Chromium client flow. Risk: **P2**.
No server, sync protocol, IAM, migration, Electron/preload or release-channel change.

Initial Main/budgets: `9e667430e3ac7ca30b321f06893d53f24d6ed5a3`.
Integrated Main: `fad8578308c527274ab762b9ed8f371e8e033d99`.
Final measured runtime source: `400842c84c701a40ceda9b29c921a255e99ff2d8`.
The subsequent evidence commit changes only documentation and the actual PNG;
runtime sources are identical to the measured source.

Budgets were recorded before implementation in [budgets.json](budgets.json).
The real Buyer Log server/UI uses 20 isolated, persisted synthetic Collection
rows and BOM evidence, including Set Style and linked/overridden colour variants.
Fixture SHA-256: `ea03124728da40aecf5527f5c1184344d6a5d57d7a49f6cd9e4ed930e2661608`.
Linux, Node v24.19.0, system Chromium via Playwright, 1500×900, reduced motion.
No production data or external PLM/AI service is used.

## Final results

Three alternating Main/candidate pairs, five modal opens per segment, in one
settled real workspace; the second pair reverses order. Only the modal script is
swapped; other changed code is inactive during ordinary BOM viewing. This removes
the context/startup variation observed in the earlier control sweep. Browser-side
MutationObserver + requestAnimationFrame timing excludes tool round trips. These
are medians from the raw observations, not p95 estimates.

| Metric | Main | Final candidate |
| --- | ---: | ---: |
| All 15 modal opens, median ms | 105.7 | 98.5 |
| Repeated opens, median ms | 101.95 | 97.65 |
| First open after script swap, median ms | 139.1 | 216.8 |
| Medians by pair, ms | 60.1 / 162.5 / 105.7 | 112.0 / 96.8 / 98.5 |

No broad speed-up is claimed. The first-after-swap observations are noisy and
are not application startup measurements; all raw values remain visible in
[results.json](results.json) and [browser.txt](browser.txt). The earlier same-Main
A/A control on this integrated base differed by up to 163.6 ms for the first
open. Final repeated viewing is below the baseline median; pair directions also
reverse. No repeatable regression outside the observed control noise is isolated.

The earlier full-context control is retained in
[context-diagnostic.json](context-diagnostic.json), on source `890f09f1` before
the final modal simplification. It is diagnostic, not final modal sign-off. It
records Main / same-Main control / candidate contexts, five open/close cycles,
one local BOM GET per open, zero remaining modal roots per close, and collected
heap peaks of 17,654,856 / 17,645,656 / 17,634,448 bytes. Its ordinary shared cell
edit medians are 149.6 / 135.4 / 171.7 ms. One candidate sample is 1278.5 ms; it
is retained, not discarded or called fixed. The established synchronous
Collection save/render can exceed 50 ms; this patch does not claim to repair
that shared path or establish its tail distribution.

The new apply action paints its actual applying state in **11.1 ms TR / 16.2 ms
EN**, below the 200 ms budget; its initial synchronous handler costs **0.5 /
0.3 ms**, below 50 ms. It yields a frame before the existing batch save/render.
The local BOM read starts before dialog layout. Motion+ is called only when
enabled, avoiding unnecessary style preparation with reduced motion. Shared
BLUI keyboard/focus behavior preserves the existing modal presentation; no new
whole-workspace dialog scan or body-scroll layout change is needed. The extra
current-value card was removed from the final scope; the existing BOM summary
and a single explicit footer action are sufficient.

Real UI assertions pass for manual replacement, exact multiline A/B data,
TR/EN feedback, acknowledged persistence, Undo, reload, no-print/no-BOM cases,
CP read-only scope, changed row references, edit permission, linked colour
cells, parent propagation and colour-specific overrides. Apply adds no PLM/AI
request. No new eager dependency, poller, persistent listener or cache type is
introduced; full component lists stay out of the summary cache. Modal callbacks
and keyboard bindings are released on close. Generic DOM translation may
translate/flatten displayed text; stored data is checked against canonical BOM
evidence rather than translated DOM text.

**120 targeted Node tests pass**, including the integrated notification path;
[targeted-tests.txt](targeted-tests.txt) retains the output. The tests first
exposed the absent apply API; browser acceptance then caught input.value
stripping A/B newlines, now covered by a regression test. i18n, shared edits,
PLM/BOM and Motion+/UI contracts are included. Release-note validation passes
with 14 pending entries. The actual post-change demo PNG was inspected; it shows
the A/B BOM and the apply button without real business data.

## Reproduce

With Playwright available through normal Node module resolution or NODE_PATH:

```sh
BL_ARTWORK_BASE_SHA=fad8578308c527274ab762b9ed8f371e8e033d99 \
BL_ARTWORK_STEADY_ONLY=1 \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  flock /tmp/buyerlog-performance-measurement.lock \
  node resources/app/scripts/artwork-bom-apply-acceptance.js
```

Omit BL_ARTWORK_STEADY_ONLY to also run the full fresh-context/A/A sweep. The
script reads Main sources with git show, isolates data/results under
work/artwork-bom and captures the real release-note PNG. BL_ARTWORK_PORT and
BL_ARTWORK_ORDER select an unused port or alternate sweep ordering.

Startup/native limits: new functions are inactive until the dialog/action is
used; no startup request or dependency-loading path is added. Native Electron,
Windows/SMB and corporate upstream performance are not measured or claimed.
GitHub reported main.protected=false; branch protection is not claimed. Actual
PR CI must be evaluated before merge. TEST/STABLE publication is outside scope.
