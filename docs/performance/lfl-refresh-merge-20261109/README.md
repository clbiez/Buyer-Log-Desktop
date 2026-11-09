# PR 944 — current-Main merge validation

Baseline Main `a83da490c9689b8fee2a15eec1e41aeb5789f663`.
Measured LFL runtime `21da755c3053e7b42f5974089191dbecb5c4e07b`.
Final UI runtime `08d56fd8b4cdcf5c03482941d8c62c193281f3d9`; only shared CSS ownership changes afterward.
The measured LFL/browser-JS/server files remain byte-identical, verified in source-identity.json.
Subsequent `3187b777` changes only the obsolete #959 asset-list assertion.
Runtime file hashes: source-identity.json. All comparison arms use Node 24.19.0,
Linux x64, one request at a time, the same 30,000-row synthetic XLSX recipe/hash.
HTTP includes the real login/upload/source snapshot/reference route/cache/compute
chain. Fixture creation and upload are outside the measured read/rebuild interval.
Measurements/full suites use the common flock serially.

## Measured admission failure and correction

Clean Main at a 160 MiB worker budget returns HTTP 413 / COMPUTE_JOB_TOO_LARGE.
The original #944 integrated code completes but blocks the server for 1.37–1.45 s
(`recovery-1.json`): functional success was insufficient. Splitting only the
aggregation left snapshot parsing blocks and excessive completion time; those
intermediate diagnostic runs remain (`recovery-green-1/2.json`). The first of
those diagnostic runs also overlaps a small functional UI check and is NOT a
final performance acceptance result.

Final recovery splits JSON decode and the same reference calculation into small
slices. The unchanged Turkish identifier fold uses a proven ASCII shortcut to
avoid locale setup on every ordinary code. No guard, memory/queue limit, HLC,
writer, lease, backup or test assertion is relaxed. Original 2,000 ms / 50 ms /
256 MiB incremental sampled-RSS budgets from plan.md remain.

## Final comparison

Three alternating process-cold/warm Main/candidate pairs; all raw observations
are in main-1/2/3.json and candidate-1/2/3.json. Warm values below are per-process
medians of five explicit rebuilds, then the median of those three values.

| Metric | Main | Candidate |
| --- | ---: | ---: |
| Cold reference read median | 2174.9 ms | 1159.2 ms |
| Explicit warm rebuild median | 2246.3 ms | 1197.4 ms |
| Warm CPU median | 2476.0 ms | 1439.5 ms |
| Peak RSS per process | 685.9 / 680.2 / 777.3 MiB | 699.3 / 716.2 / 685.7 MiB |

Every complete reference hash matches (season/month/cumulative/country/order
counts and weighted results), including the constrained recovery arm. Raw values
are preserved in summary.json; no p95 or universal speedup is claimed.

Peak RSS is allocator/GC-sensitive, not the worker reservation metric. The A/B
paired changes have mixed signs (+13.4 / +36.0 / -91.6 MiB), so the median alone
was not accepted as proof of parity. Three additional alternating identical-Main
A/A controls reproduce 697.2→687.5, 708.0→716.7 and 706.2→685.4 MiB. This identifies
substantial same-source process/allocator variation. No consistent peak increase
is observed, no source-sized state is retained by recovery, and no tolerance
percentage is introduced. These finite observations are local acceptance, not a
guarantee for all hardware, data sizes, native platforms or allocators.

## Final recovery gates

Three independent candidate runs at the unchanged 160 MiB worker budget,
`recovery-final-1/2/3.json`, include a cold read, saved read and five rebuilds each:

- Maximum non-saved HTTP completion **1915.64 ms**, budget <=2000 ms.
- Maximum event-loop gap **40.76 ms**, budget <=50 ms.
- Maximum incremental sampled process RSS **59.97 MiB**, budget <=256 MiB.
- Saved reads complete in about 7 ms and retain the saved reference values.
- Output hash is identical in all arms. Five rebuilds leave no active worker,
  pending job, queued input or output lease. Existing idle workers from source
  setup are not counted as newly allocated LFL workers.
- Post-cycle GC heap in the three fresh processes: **72.06 / 72.06 / 72.05 MiB**.
  Full per-cycle samples remain in JSON; no source-sized accumulating retention
  was observed. This is server heap, not renderer heap or Electron process RSS.

## Actual UI and correctness

Actual isolated application with the constrained worker budget: stale detail
rejects, saved references survive ordinary reads, explicit refresh updates FOB
10→20 and the current detail opens in TR and EN. Visible disabled-button feedback
is **84.54 ms**, budget <=200 ms. Final actual PNG pixels were inspected. Shipping
uses a synthetic row in both themes; its screenshot records the narrow Main #960
canonical-token fix. No actual company data or corporate connection was used.

69 targeted tests / 13 files pass, including large nested JSON equivalence,
Unicode/prototype keys, malformed JSON, Turkish folds, complete cooperative
reference equivalence, stale-source/owner/execution-failure checks and snapshot
compatibility. Existing Main layout assertion repair passes 15/15 separately.
i18n has zero missing strings; 23 pending notes validate. Full-regression status
and final PR CI are recorded in validation.json after completion.

No native/preload/launcher path is changed. Windows/Electron/SMB enterprise
capacity and unlimited single-scalar JSON responsiveness are not certified by this
30k local/browser acceptance. TEST and STABLE are separate and are not triggered.

## Reproduction

The benchmark takes app root, worker budget MiB and result file:

```
node http-benchmark.cjs /path/to/resources/app 160 recovery.json
node http-benchmark.cjs /path/to/resources/app 512 normal.json
```

Run the two source roots serially in the order in run-pairs.cjs. The six same-Main
memory control arms are in run-memory-controls.cjs. Those coordinators preserve
the original absolute checkout paths for this environment; change only checkout
paths when reproducing elsewhere. Use the same Node/runtime, fixture/hash and
worker options in both arms. `preload.cjs` is local synthetic-test instrumentation
only, not installed in product runtime. UI replay:

```
NODE_PATH=/path/to/playwright/node_modules:/path/to/app/node_modules \
LFL_ACCEPTANCE_APP=/path/to/resources/app node ui-acceptance.cjs
```

From resources/app: `npm test`, `npm run i18n:check`,
`npm run release:notes:validate`. Failed full suites and their clean-Main
reproductions are retained separately; batches are never stitched into a PASS.

## Completed full regression

Standard uninterrupted npm test: 1335 files, 10/10 batches, concurrency 4; 9243 tests = 9178 PASS / 0 FAIL / 65 SKIP / 0 CANCEL, 204.5 s. SKIPs are not counted as PASS. Test/code source: 08d56fd8b4cdcf5c03482941d8c62c193281f3d9; later commits only add this evidence. No failed-run batches are reused. Final-head GitHub PR CI is checked separately before merge.
