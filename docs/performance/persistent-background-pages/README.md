# Persistent priority pages — native acceptance

**Decision: PASS for the measured native renderer scenarios. Risk: P2.**
This implements requested preparation/residency, with a measured memory cost.
It does not make every first large table draw instant or reduce RAM consumption.

## Source, protocol and budgets

- Comparison Main `9e667430`, candidate `d6864eaa`; final Main `fad85783`, final
  candidate `b64fbd45`. `integration-source-proof.json` proves all 13 measured
  loader, warmup, hydration and navigation function bodies unchanged by Main's
  notification integration. Final complete Collection comparisons use the final
  Main/candidate sources. Evidence/caption/PNG commits do not change those bodies.
- Official Electron **44.3.0**, Chromium **152.0.7977.78**, backend Node **22.23.4**,
  Linux x64, Xvfb 1600×1000; actual production workspace manager, WebContentsView
  and both preloads. Official Electron ZIP SHA-256, verified against official
  checksums: `8b49b9efdd73c0f467edc3c1cd5678392c384ccf224f34ff54179f736e2f384b`.
- Three alternating Main/candidate pairs at **2,000 and 30,000 synthetic orders**,
  seed 7, 40 Collection models, fresh renderer/profile per arm. Normal cases use
  freshly prepared warm servers; large cases share a prepared synthetic backend
  and reset synthetic user preferences per arm. Workbook preparation is excluded
  from renderer timings. No real data/account or corporate service is used.
- Semantic fixture hashes match every arm: normal
  `20eed946cc48d125aa1d60b43ae7001147a9198ee37a088c7dd81515c89ee00a`;
  large `661c61bcbdd55a63c39561bceb0b76a8b4517659d22179df6be97a2b7b6e4ffa`.
- `budgets.json` was recorded at continuation before native measurement, without
  pretending to reconstruct the earlier implementation's budget. Preparation
  deadline 120 seconds; prepared JS heap <1 GiB; zero repeat data/profile requests;
  retained rows/edits; one application view, destroyed on close. Existing large
  first-render/layout tasks >50 ms remain recorded and are not declared fixed.

The queue is Collection → CP → Orders → Backlog after Continue and initial painted
frames. Already prepared steps can be skipped (Overview may already prepare CP).
There are no extra hidden native workspaces. Access/source gates and dirty edits
remain protected; source changes invalidate Backlog, elapsed time does not.

## Results

All **12 full native runs pass**. All candidates have zero repeated page-data or
profile requests over five rounds, the same CP/Orders objects and first row nodes
in CP/Orders/Collection, retained dirty CP state, and zero views after final close.
Main repeats 2–6 requests and redraws Collection. Raw samples are in `normal/`,
`large/` and `summary.json`; no p95 is inferred from three pairs.

Median repeated data-cell readiness (median of three per-run medians, ms):

| Rows | Page | Main | Candidate |
| ---: | --- | ---: | ---: |
| 2,000 | Collection | 206.4 | 10.5 |
| 2,000 | CP | 21.3 | 13.3 |
| 2,000 | Orders | 12.8 | 12.4 |
| 2,000 | Backlog | 15.1 | 12.8 |
| 30,000 | Collection | 242.5 | 18.0 |
| 30,000 | CP | 23.5 | 18.5 |
| 30,000 | Orders | 12.3 | 13.7 |
| 30,000 | Backlog | 14.4 | 13.1 |

Orders timing varies both ways between pairs; raw outliers remain visible.
This table is not full-frame latency or a general speedup claim. Candidate
background completion is 8.7–9.9 seconds / 29.1–34.9 seconds respectively.
Main's shorter queue leaves the other native modules unprepared.

First Collection cells can exist before profiles/catalogs/tools are ready.
`final-collection/` therefore waits for the actual profile promise, both catalogs,
Collection tools and deferred UI, then two animation frames. Three final-source
pairs at 30,000 rows give **4,191.4 → 1,716.6 ms** median complete first-use frame
time. Earlier first-cell timings are diagnostics, not complete Collection TTI.
First CP/Orders construction remains material: in the first large pair data-cell
times were **24,662 → 5,838 ms** and **13,464 → 1,717 ms**. Never-rendered large
tables still defer their first DOM construction; revisits preserve those rows.

## Memory, platform limits and regression

Prepared post-GC heap is ~33 MiB / ~253 MiB, below the prepared-heap budget.
After all pages open, normal residency is ~45 MiB; large Main/candidate residency
is ~386 / ~388 MiB. Both show initial cache fill; raw samples are retained rather
than claiming zero V8 growth. Candidate row/listener counts stay fixed and DOM
counts return to their settled values over five rounds; no page datasets or
subscriptions accumulate. All native closes destroy the views.

`native-process-samples.jsonl.gz` contains 500 ms OS RSS observations and Linux
VmHWM. Large renderer high-water RSS medians are ~**1,152 MiB Main / 1,259 MiB
candidate**. RSS is distinct from retained JS heap. Earlier preparation and the
requested persistent data have an additional memory cost; no RAM-saving claim is
made. User-created native workspaces multiply residency, but this queue creates
none. Windows portable startup, Excel pivot refresh, SMB, corporate upstream and
physical GPU performance are outside this Linux native-host measurement.

- Local standard full suite on `d6864eaa`: **1,328 files; 9,197 tests; 9,132 PASS,
  0 FAIL, 65 SKIP, 0 CANCEL**, 288.2 seconds (`test-results.json`, full log gzip).
- Seven targeted files: **53 PASS / 0 FAIL**. i18n has zero missing strings.
  Pending notes validate; the inspected actual native PNG and caption are TR/EN.
- Integrated `b64fbd45` Windows full suite is tracked separately at
  https://github.com/clbiez/Buyer-Log-Desktop/actions/runs/42581492670 . Its actual
  result and the last-head PR check are required before merge and recorded in the
  PR. An earlier source's local run does not substitute for that result.
- `probe-development/` preserves missing-instrumentation/queue-assumption probe
  failures, the failing Main request reproduction, and a large fixture setup
  timeout before candidate UI loading. These are not counted as passing runs.
  Shared prepared data changes setup, not any product acceptance limit.

Reproduce with `acceptance.cjs`, official Electron and Xvfb: set `PROBE_NODE`,
`PROBE_ROWS`, `PROBE_COMPARE`, fresh `PROBE_OUT`; optionally use a prepared
synthetic `PROBE_BACKEND_PORT`. `PROBE_COLLECTION_ONLY=1` and `PROBE_MAIN_SHA`
select complete Collection first-use comparison. Hold the shared
`/tmp/buyerlog-performance-measurement.lock` for probes and full local tests.
App dependencies are the existing lockfile install. Main client files are the
only product-source overrides used by the comparison arm.

No TEST/STABLE release is triggered. Main is unprotected; successful checks are
verified explicitly before merge. Raw evidence and limits are retained.
