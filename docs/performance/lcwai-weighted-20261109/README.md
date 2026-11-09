# LCW AI weighted metrics acceptance

> Latest Main integration: `2cb965f74af807fcf94231644e01ca2c671ba656` was merged
> into this branch as `0993fc2fc4e73c9680c80940897b63a62f7ead02`. The only merge
> conflict was the pending release-note JSON; all 17 Main entries and all 4 LCW AI
> entries were preserved. Final source revalidation: 492 tests / 68 files PASS,
> i18n 0 missing, 21 release-note entries PASS. `acceptance-integrated.json`
> replays the real-app integration cases on that source and records matching runtime
> hashes; no browser errors, raw uploads or model-chat fallback occurred.
> Previous A/B numbers below describe the original base, **not** acceptance against
> the newly integrated Main. Performance remains **BLOCKED** and the PR remains draft.


Baseline: main checkout `9e667430e3ac7ca30b321f06893d53f24d6ed5a3`.
Risk: P1 reporting accuracy; read-only query arithmetic, no stored prices or business records change.

Before implementation: the planner contract and deterministic engine only support sum,
count, distinct count, average, min and max. A valid plan can omit a requested metric.

Affected flow: LCW AI request → schema → plan validation/one repair → deterministic
aggregation → visible Markdown and numeric Excel. No new startup modules, background
work, network services, caches or polling. Native/preload untouched.

Pre-change budgets:
- Existing total-quantity query: no repeatable regression in request-to-visible-result
  median, first use and repeats, in alternating baseline/candidate runs (minimum 3 pairs).
- New quantity + weighted FOB query over 37,183 synthetic orders: visible feedback <=200 ms;
  local plan-to-visible-result <=1,000 ms, no new >50 ms main-thread task introduced by
  request validation or weighted aggregation. Corporate AI latency excluded and disclosed.
- One planner request normally, at most one extra request for repair; zero raw CSV uploads.
- Export uses numeric computed values without rounding intermediate arithmetic.
- Five repeated queries: no accumulating active requests or retained result tables beyond
  the existing conversation/history behavior. Existing query results retained by design.
- Real Buyer Log TR/EN screenshot using synthetic data, Excel round trip and targeted tests.

Results and reproducible command will be appended after validation.


## Final source and validation

Runtime commit: `05f8dbfcad1b00bd9b5e95e97f4dc04ac46b79c6`. `acceptance-functional.json` records SHA-256 hashes
of every query-path runtime source; all hashes were checked against this commit.
The last source adjustment inserts a yield only before cooperative/new calculations;
the ordinary quantity-query path measured in `acceptance-raw.json` is unchanged.

Correctness: **PASS** — 492 tests in 68 files, TR/EN guard (0 missing), pending
release notes (16 changes including 4 new screenshot-backed entries), syntax and diff
checks. The targeted tests cover the exact CU4E/S7/country/product/month exclusions,
multiple metrics, precision, subtotal/grand-total recomputation, missing prices and
weights, nonpositive FOB parity with CP/Orders, currency isolation, missing sources,
LFL defaults and historical CP comparison, multi-source supplier rankings, repair,
permission denial, cancellation, replay/export and the existing LFL/price engines.
The new Node-only query tests are also in PR fast checks.

Real-app integration: **PASS** — isolated production server, generated ASAS source,
37,183 in-memory synthetic Orders records, 37,184 authorized LFL upload records,
22 Backlog export rows and a persisted Collection quotation workspace. LFL/Backlog/
quotations work without opening their module pages. Actual numeric XLSX is read back:
quantity = 7,436,500; weighted FOB = 37,182,200 / 7,436,500 (unrounded).
The supplier example returns DEMO BETA's USD 3 lowest quote and DEMO BETA's 300,000
order units from different sources. No model chat or raw CSV upload occurs.
Screenshot pixels were inspected; only generated demo data is present.

## Performance decision: BLOCKED for full acceptance

The calculation and feedback subgates pass, but pre-planning renderer tasks remain
above 50 ms in the large LFL scenario. Their source has not been isolated sufficiently
to classify them as pre-existing work or close the whole UI gate. **Do not merge or
publish this as performance-accepted.** Keep the PR in draft; tests/CI are not a
substitute for this gate. No performance threshold was relaxed.

| Local scenario | Before | Candidate / final | Evidence |
| --- | ---: | ---: | --- |
| First ordinary quantity query, median of 3 fresh pages | 565.40 ms | 565.60 ms | 3 alternating pairs |
| Repeat ordinary query, 20 per page / 60 per variant | 210.40 ms | 235.65 ms | all samples retained |
| New weighted query feedback | N/A | 36.80 ms | budget <=200 ms |
| New weighted plan-to-visible result | N/A | 146.60 ms | budget <=1,000 ms |
| New LFL feedback | N/A | 47.40 ms | budget <=200 ms |
| New LFL plan-to-visible result | N/A | 567.40 ms | budget <=1,000 ms |
| LFL request-to-visible including source read/schema | N/A | 2438.00 ms | corporate AI generation simulated |

The repeat median difference is +25.25 ms. Controlled baseline A/A paired warm-median
differences were +30.6, +11.6 and +26.0 ms; the three A/B pairs have mixed signs.
This is evidence of local measurement noise, not a claimed speedup or proof of universal
performance parity. Raw cold outliers remain in the JSON; no p95 claim is made.

Final weighted normalization/execution stages were 2.2 / 99.3 ms elapsed; final LFL
stages were 35.1 / 495.3 ms elapsed. Execution is cooperative; no >50 ms long-task entry
overlaps those final calculation stages. However, final LFL pre-planning tasks of
99, 328 and 239 ms remain, and the weighted flow records 73 and 114 ms pre-planning
tasks. These observations are intentionally **not** hidden by the passing calculation
slice measurements. Attribution/removal of these tasks is the remaining performance work.

Retained renderer JS heap after 15 warm-up queries and five repeated query/GC cycles:
baseline 35,874,608 -> 35,947,524 bytes (+72,916); new weighted flow
36,031,732 -> 36,055,244 bytes (+23,512, with the last sample decreasing).
No raw-source-sized retained growth was observed. This measures retained JS heap,
not peak RSS; peak process memory and Windows/Electron behavior were not measured.
One planner request per valid query, at most one repair, zero CSV uploads, no new
poller/cache/startup fetch. Only the LCW AI feature loads its small analysis adapter;
source pages are not rendered for these queries. Native/preload code is untouched.

## Reproduce

From `resources/app`, with the existing Playwright/Chromium development environment:

```sh
npm test -- lcwai lfl canonical-fields price-supplier cp-orders-averages startup-feature-assets perf-runtime-existing-static-script agent-instructions i18n-coverage-guard visual-release-notes
npm run i18n:check
npm run release:notes:validate
flock /tmp/buyerlog-performance-measurement.lock node scripts/lcwai-analysis-acceptance.js --repeats 20
flock /tmp/buyerlog-performance-measurement.lock node scripts/lcwai-analysis-acceptance.js --sum-only --aa
flock /tmp/buyerlog-performance-measurement.lock node scripts/lcwai-analysis-acceptance.js --functional-only
flock /tmp/buyerlog-performance-measurement.lock node scripts/lcwai-analysis-acceptance.js --memory-only
```

- `acceptance-raw.json`: alternating A/B, 3 pairs, 20 repeats each; real app/export cases.
- `baseline-aa.json`: controlled baseline A/A noise observations.
- `acceptance-functional.json`: final runtime hashes, final new-calculation timings,
  numeric XLSX round trip, real TR/EN UI and source integration.
- `memory-cycles.json`: controlled retained-heap comparison (CDP forced GC).
- Fixture recipe hash is a generator-recipe identifier, **not** a source-file byte hash.
  Exact row counts, deterministic quantities/prices and output parity are checked.

Corporate LCW AI generation is simulated at `BuyerLogAI.ask`; no corporate session
is available here. Prompt contracts and deterministic routing/repair are tested, but
live model understanding, upstream latency, real business data, native Windows and
SMB are not claimed as verified. No TEST or STABLE release was requested or triggered.
