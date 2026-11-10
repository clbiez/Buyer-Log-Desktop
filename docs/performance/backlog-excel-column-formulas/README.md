# Backlog Excel columns: performance acceptance

Decision: **PASS** for the changed browser paths. Base Main `0f0b986770a721c52f68755e5c7befe12662ee26`, measured executable source `9fa01120605636b351dd236c287296aed5236454`. Later release-note, screenshot and evidence commits do not change these executable files. Runtime digest: `8cefa7011901cb167e56d961ae4a32d24dcf73b5b22f7d64e90b70bdcf980667`.

The feature adds aliases, source lineage, a shared formula editor and live Excel formulas. The helper loads on first use. Budgets were recorded during current-Main integration, before the measured performance revisions; they are not claimed to predate the initial implementation against the environment's older checkout. See [budget.json](budget.json).

## Method and raw results

Three alternating Main/candidate pairs run serially under `/tmp/buyerlog-performance-measurement.lock`, with three Main A/A controls. Both variants use clean detached worktrees, the same dependency directory, Chromium 151.0.7922.173, 1280×800 viewport, reduced motion and isolated local demo accounts. No real business data or credentials are captured. The fixture has 100 anonymous source columns, the standard report selection, and 30,000 deterministic export rows. Its descriptor hash is `b152c7cde413300cc6496b08618e64b8bca396b5bf2e45f6c80c826fefc79468`. Every sample is preserved in the nine adjacent JSON files; no p95 or general speedup is claimed.

Each export phase starts after an explicit garbage collection so phases are comparable independently. Heap figures are actual end-of-build snapshots, not process RSS or a continuously sampled process peak. XLSX buffer byte counts are also recorded. Five additional open/close cycles record retained heap after GC. The initial and repeated modal paths record painted feedback, completed opening and browser long tasks separately. Waiting for a lazy script is not labelled synchronous CPU blocking.

| Metric (median of 3) | Main | Candidate |
| --- | ---: | ---: |
| Usable startup (ms) | 1955.3 | 2078.4 |
| First settings ready (ms) | 71.9 | 92.4 |
| Worksheet + complete XLSX buffer (ms) | 2534.4 | 2625.7 |

Warm settings-ready medians over the twelve repeated observations are 42.2 → 48.2 ms. First use now includes the new helper download and source controls; its feedback has its own ≤200 ms budget. Maximum measured feedback is 65.4 ms. The UI acceptance also deliberately delays that helper by 300 ms and verifies immediate busy feedback.

Main A/A startup range: 1896.9–2074.4 ms; complete file range: 2457.7–2731.0 ms. The paired samples have mixed signs and vary with startup/background work, JIT and GC. Differences are interpreted against these observed controls, not a percentage tolerance. The candidate also writes source lineage, adding 1976 bytes to the anonymous normal workbook. The raw results support the scoped budgets; they do not establish a universal improvement.

## New work, correctness and lifecycle

- Numeric calculated-column workbook: maximum 2339.7 ms; date calculated-column workbook: maximum 3115.0 ms. Both are below the separately recorded 15,000 ms active-work budget.
- Numeric/date heap snapshots are at most 344.5/394.3 MiB, below 512 MiB for an independently measured export phase. This is not a claim about the peak of arbitrary successive exports without GC.
- Maximum observed UI long task: Main 60 ms; candidate 50 ms. Existing synchronous bulk worksheet/SheetJS assembly remains; this change does not claim to eliminate its long tasks. Its complete output path is measured above and the new calculation cases separately.
- One source-catalog request per page, zero remaining modal nodes after closing, and five retained-heap observations per run. The common LCW AI subscription is explicitly destroyed on close. The UI acceptance verifies disposal and preserves unsaved expressions on language changes.
- Preview uses the existing `previewLimit=5` contract, one shared request per settings session, and an AbortController on close. It does not download all report rows for a preview or install a poller.
- All three paired normal outputs retain identical worksheet cell counts, range, first and last typed cells. The additional Settings metadata is intentional. XLSX round-trip tests cover aliases, source lineage, hidden dependencies, reorder, blank numbers, dates and cached calculated results. The date case checks blank dates stay blank and valid dates yield nine days.

## Reproduce

From the repository root, with the same installed application dependencies and Playwright/Chromium:

```sh
mkdir -p work
git worktree add --detach work/perf-main 0f0b986770a721c52f68755e5c7befe12662ee26
git worktree add --detach work/perf-candidate 9fa01120605636b351dd236c287296aed5236454
# Link or install the same resources/app/node_modules in both worktrees.
flock /tmp/buyerlog-performance-measurement.lock node docs/performance/backlog-excel-column-formulas/measure.cjs work/perf-main main 1
flock /tmp/buyerlog-performance-measurement.lock node docs/performance/backlog-excel-column-formulas/measure.cjs work/perf-candidate candidate 1
# Repeat alternating pairs 2 and 3, then Main controls aa1, aa2 and aa3.
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium node resources/app/scripts/backlog-excel-columns-ui-acceptance.js
```

The measurement script writes raw JSON under `work/`. Chromium's executable path in that script is the Linux cloud path used for these measurements.

## Scope and limits

825 targeted tests and eight real application layouts (two themes × four sizes) pass. TR/EN, reduced motion, parent/child Escape, native references, nested formulas, exported caches, source isolation and real post-change release PNGs are checked. Corporate LCW AI inference latency, corporate upstream access, Windows/SMB, Electron's native save dialog and physical disk writes are not measured. No server, Electron, preload, updater, worker scheduling or shared-data mutation boundary changes. The measured file path ends at a complete XLSX buffer, which is the changed renderer output stage; existing native save/guard transport remains unchanged. Branch protection on Main is actually disabled, so local acceptance and the PR's final-SHA CI are checked explicitly before merge. TEST/STABLE are not published.
