# Orders read/projection evidence — 2026-11-09

Issue: [#952](https://github.com/clbiez/Buyer-Log-Desktop/issues/952), 6A-ORDERS only.
**SKIPPED:** the screened constant-field omission has no demonstrated net benefit
above A/A noise. No thin DTO, hydrate protocol, capability, cache identity or
product change is retained. This does not complete broader phase 6a or 6c.

Base and measured product source: `d0fdb8889f188e2cc1387b0850f61a841aa7e6d5`.
Worktree: `/workspace/Buyer-Log-6a-orders`; branch:
`perf/phase6a-orders-thin-20261109`. The original `work` checkout remains clean at
`9e667430e3ac7ca30b321f06893d53f24d6ed5a3`.
[Pre-implementation scope/budgets](plan.md), [source equality](source-proof.json).

## Current source findings

These locations refer to the pinned current Main, not the #891 archive. The
archive commit `5736f3370fb55bbd62414585956ca8c53d37ce82` was fetched/read without
merging it. Its CP 32 required / 10 uncertain / 0 lazy classification was not
transferred to Orders; no repository-wide inventory was generated.

| Current path/symbol | Relevant finding |
| --- | --- |
| `public/app-main.js:2083` fetchOrdersProjection | Full `/api/page-projection/orders`, existing 404 legacy fallback. No thin capability. |
| `public/app-main.js:2236` ensureOrdersLoaded | Revives dates, copies rows with `_canEdit:false`, immediately applies pricing and filters. |
| `server/server.js:8544` ensureComputedProjection and `:8594` route | Existing user/area/source guards, compressed cache, runtime/source revision checks; full module cache. |
| `server/lib/compute-tasks.js:28` buildProjections | Real Orders producer, permission filtering before projection. |
| `server/lib/parse.js:2089,2255` order row builders | Includes active/inactive, dates/baselines, pricing metadata, logistics, notes and dynamic `_cpExtra`/note keys. Read only in this work. |
| `public/app-main.js:11897` applyPricingRulesToLoadedRows | Immediate licensor and Supp. FOB consumers; hidden manual/import/source metadata is semantically relevant. |
| `public/app-main.js:9584,9648` filtering/sorting | Identity/selection, arbitrary column filters, dimensions/search and dynamic sort keys. |
| `public/app-main.js:5876,5917` partialViewRows/status groups | `_logisticSegments` affects the initially visible status cell and partial quantities, not only an optional drawer. |
| `public/app-main.js:6297,8037` cellPlainText/exportMatrix | Clipboard/Excel share row values and logistic summaries; hiding a column does not remove its contract. |
| `public/formula-columns.js:339` and `public/app-main.js:4186` | Orders inherits dynamic model/note columns; formula source and strict evaluation need their real values. |
| `public/app-main.js:1470,24285` atlas handler/selection | Visible selected Orders are read through canonical license/licensor; latest atlas consumer is included. |
| `public/app-main.js:30455` manufacturer mapping | Hidden `_initialInspection` and baseline are consumed outside visible columns. |

Only `_canEdit` can be omitted by the screened candidate and then reconstructed
by the existing loader before consumers. `Priority` was also considered because
buildOrdersFilters deletes it, but the current producer already omits it on all
30k rows. This is not proof that every other field is indispensable forever;
it is a bounded rejection of this candidate and of broad visibility-based deletion.

## Reproduction and measurement

```sh
# Repository root; dependencies are the existing installed product dependencies.
# Pick a fresh root on every run. No real sources/configuration are used.
flock /tmp/buyerlog-performance-measurement.lock node \
  docs/performance/phase6-followup-20261109/6a-orders/screen.cjs \
  /tmp/6a-orders-reproduce-20261109
node --test --test-reporter=tap \
  docs/performance/phase6-followup-20261109/6a-orders/consumer-screen.cjs
```

Linux x64, Node 24.19.0 / V8 13.6; concurrency 1. The pinned product targets
Electron **44.3.0** (`.github/installer/runtime.json`); Node screening is not
Electron acceptance. Same 30k archive SHA256:
`5913414603984b02b1c30b87f1f9231da3718ab797a007f4bd14067ec6cd5c70`.
All three workbook hashes match the checked-in fixture manifest and are retained
in [raw results](screen-results.json). No new users, companies or business data.

Real parseASASWorkbook/parseAntrepoWorkbook → compute-tasks.buildProjections
(`modules:['orders']`) → date-safe projection serialization generated the input.
Candidate omission is isolated in screen.cjs; it is never imported by the app.
The common projection build took 2132.83 ms; one observed omission pass added
9.11 ms, rather than reducing producer work. These single preparation samples
are descriptive, not comparative CPU acceptance.

| Payload | Main | Candidate | Reduction |
| --- | ---: | ---: | ---: |
| Uncompressed bytes | 73,145,820 | 72,635,820 | 510,000 (0.697%) |
| gzip bytes | 4,877,412 | 4,865,585 | 11,827 (0.242%) |

Three alternating A/B pairs, preceded by three A/A pairs, ran serially under the
shared lock. Each fresh child has one process-cold sample and five warm cycles.
“Cold” is **process-cold with filesystem cache uncontrolled**, not an OS-cache
eviction or actual native first-use/network measurement. Timing includes file
read, JSON.parse, the loader's row-copy/filter-delete expressions and first full
JSON serialization. It excludes real UI/pricing/filter/export execution and
network. No request-count or native time improvement is inferred from it.

| A/B pair | Process-cold Main → candidate (ms) | Warm per-process medians Main → candidate (ms) |
| --- | ---: | ---: |
| 1 (Main first) | 1199.44 → 1160.17 | 1133.33 → 1135.43 |
| 2 (candidate first) | 1245.56 → 1195.54 | 1110.04 → 1021.03 |
| 3 (Main first) | 1052.56 → 1067.79 | 1025.94 → 1012.24 |

| Pooled median metric | Process-cold Main → candidate | Warm Main → candidate |
| --- | ---: | ---: |
| Parse (ms) | 303.90 → 295.14 | 267.30 → 261.32 |
| Row copy + cleanup (ms) | 18.12 → 20.81 | 13.36 → 12.19 |
| First full JSON (ms) | 476.41 → 504.18 | 484.80 → 458.18 |
| Total screen (ms) | 1199.44 → 1160.17 | 1105.61 → 1045.86 |
| CPU (ms; includes output-hash work) | 1524.79 → 1488.24 | 1529.65 → 1441.22 |
| Heap at materialization (bytes) | 256,621,360 → 256,349,072 | 256,571,144 → 256,259,784 |
| RSS at materialization (bytes) | 325,681,152 → 325,595,136 | 459,853,824 → 459,472,896 |

A/A cold total range **1115.91–1878.54 ms**, warm total range
**1025.14–1345.97 ms**. A/A paired warm-median differences were -158.22, +42.01,
-31.13 ms; A/B were +2.10, -89.02, -13.70 ms. Candidate timing advantage does
not exceed observed control variability and is not consistent across pairs.
Neither the slower candidate cold full-JSON median nor the lower warm median is
promoted to a causal performance claim. No p95 claim.

Process peak RSS over six cycles is in every raw run (one Main A/B sample peaks
at 851.5 MiB, other Main samples about 718.5 MiB, candidates about 716.2–716.7
MiB). Forced-GC heap-after-release is also retained: even A/A varies from about
82.8 to 220.8 MiB. This harness includes input strings and V8 temporaries and
does **not** establish native retained-row/permit/listener cleanup. No memory
win or lifecycle PASS is claimed. Unresolved acceptance cannot justify shipping
an otherwise unproven optimization.

Every one of the 72 measured normalized complete-row outputs hashes to the
original full payload:
`b437e567a676344fc9b0eca9dadc07267e9eae14bc536bef24a05d6319baebe1`.
The candidate raw input hash is
`458d997c87e0de31f3784b7aa720842a85fbf4514fbeec490735fc9cdafbd567`.
This covers all serialized fixture values, not native export/atlas acceptance.

## Rejection and validation limits

[Unsafe deletion RED](consumer-unsafe-red-outer.tap.gz): **2 PASS / 4 FAIL**.
[Constant-only GREEN](consumer-constant-green-outer.tap): **6 PASS / 0 FAIL**,
no skip/cancel. The same assertions execute the real loader/filter cleanup,
initial logistic status text, formula engine, visible selection/atlas engine,
canonical precedence, denied/stale/malformed response parsing and falsy values.
The RED deliberately removes required fields; it is not an existing Main bug.
Pricing/DOM in the loader test are explicitly stubbed. Non-enumerable source
binding loss is demonstrated, not assumed equivalent to JSON copying.

[Existing targeted runner](targeted.log.gz): **44 files / 1 complete batch /
280 PASS / 0 FAIL / 0 SKIP / 0 CANCEL**, default concurrency **4**, fresh five-root
environment under `/tmp/6a-orders-targeted-20261109`. The exact npm test command
is in the log. Includes Orders/projection, formula/canonical/atlas/output,
compute guards, #916 row-cache/delta checks and native-warmup source contracts.
These are targeted tests, not the unfiltered full suite or real native startup.

[i18n](i18n.log.gz): 0 new / 0 baseline missing.
[Release notes](release-notes.log.gz): existing 15 entries valid. New TR/EN note and
PNG are **N/A**, because there is no user-visible product change; no other
task's manifest entry was edited.

The first screen attempt failed at sandbox spawnSync(tar) EPERM; the next failed
because the harness initially treated the ASAS return object as its orders array.
Both [sandbox](screen-sandbox-failed.log.gz) and [harness](screen-harness-failed.log.gz)
logs remain. Fixing the harness's `.orders` selection did not change the fixture
or product parser. Sandbox test output reported only file-level counts; those
initial logs are retained but not used as subtest proof. The outer-executor TAP
logs above contain all six tests. Successful measurements are in [screen.log](screen.log.gz).

No production candidate was connected, so real first usable native Orders,
cold/warm intent→result, actual clipboard/XLSX/atlas equivalence, owner switch,
refresh/late hydrate, native CP/#916/startup and five native cleanup cycles have
**not** been accepted. Existing runtime is preserved instead. Unfiltered full
`npm test` is N/A for the delivered evidence-only diff: all resources/app,
dependency, launcher, CI and protected store bytes equal pinned Main, proved in
source-proof.json. A surviving product candidate would have required every
gate; targeted tests do not waive them.

Final PR head and its actual CI outcome are reported only in the tagged final
comment on #952. No merge, branch deletion, TEST/STABLE, pilot, migration or
issue closure is performed. The experiment remains under this evidence path
solely to reproduce the rejection, with no effect on any production read.
