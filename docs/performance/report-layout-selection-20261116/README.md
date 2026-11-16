# Report layout, shared defaults and row-selection rails

Risk: P1 for the Moderator publication boundary; P2 for presentation and selection.

Actual Buyer Log on an isolated Express server and Chromium, using only synthetic accounts and records. `resources/app/scripts/report-layout-ui-acceptance.js` is the reproducible browser acceptance. It covers CP, Orders and Collection, drag/keyboard-compatible templates, save/reset/cancel, original-order TSV, identical selected-row clipboard and actual XLSX contents, canonical PLM/TROY links, the existing BOM dialog, all native row-selector CSS families, and a second buyer session. Forged buyer writes return 403; stale Moderator writes return 409; a new publication supersedes an older personal layout. Settings/boolean data checkboxes retain their native design.

The shared record uses the existing revisioned overrides store and Moderator Master checkpoint transport. Unit tests cover bounded identifiers, revision conflicts, durability, isolation of other tables, all report presets, and Master checkpoint serialization without personal overrides. No new poller or independent synchronization channel was added.

## Performance acceptance

Tier L2, report rendering and shared table CSS. The recorded A/B scenario is **unchanged report refresh**, with 300 synthetic rows and 12 fields, using the baseline/candidate report script and canonical CSS on the same final app shell. Three alternating pairs each contain ten synchronous render/layout measurements. The baseline is `e6794e78fc4ec8c841f664dde7b65ba60c3cf454`; raw samples are in `performance.json`. This is a scoped rendering measurement, not a general application/startup/Windows/SMB speed claim.

Baseline per-pair means: 121.83 / 113.75 / 113.42 ms; candidate: 12.15 / 14.94 / 11.26 ms. Medians: 113.75 → 12.15 ms. Unchanged markup now preserves DOM instead of rebuilding it; changed data still replaces the relevant markup. Row-selection registration is lazy and templates only add one control row. The existing 300-row report chunk remains bounded. Network activity for shared layouts begins on report activation and then uses existing live/revision events, with no background interval.

Reproduce browser behavior:

```sh
node resources/app/scripts/report-layout-ui-acceptance.js
```

Reproduce A/B (no simultaneous full suite/benchmark):

```sh
flock /tmp/buyerlog-performance-measurement.lock env REPORT_PERF_ONLY=1 node resources/app/scripts/report-layout-ui-acceptance.js
```

The browser script produces only synthetic screenshots and local scratch evidence. Release-note PNGs were visually inspected. Final full-suite and PR-check results are recorded on the PR.

## Integrated baseline test correction

The first full-suite batch exposed two test-harness regressions already present in `f8779d6b`: the Concept 2 projection VM omitted the real search-order helper, and the Add New Model source contract expected the pinning branch before its new empty-search guard. Both failures were reproduced against `origin/main`'s production source. The harness now installs the actual search helper, checks both unsearched pinning and search-order precedence, and retains collapse/export assertions. No production search behavior was changed to satisfy the tests.
