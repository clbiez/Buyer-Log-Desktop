# Importance shared synchronization — acceptance

Decision: **PASS**, scoped to this change on Linux/Node 24.19.0 and real Chromium.
Base Main: `0f0b986770a721c52f68755e5c7befe12662ee26`.
Final runtime source: `ea7965f9137736ddcc612427f4a44c0427edbe69`.
The following evidence-only commit does not change those runtime bytes.

P1: enable the existing Importance field in the peer allowlist, checkpoint field
clocks and existing owner merge/authorization rules. UI checks now treat the field
as shared, including paste and bulk history. No new worker, module, poller, SSE,
cache, schema, timing/concurrency limit or native/Electron path is introduced.

## Budgets and method

`budgets.md` was written before implementation. Actual transport was measured from
durable queue submission through folder package creation, peer import and peer
record verification. Three alternating Main/candidate pairs, 200 deterministic
synthetic order lines, the same Node process and machine, no full test suite during
measurement. Fixture SHA-256 and all samples are in `transport-results.json`.
First round, five repeated edits and a 200-row batch are measured separately.
Every result and package count is checked, including idle downloads and cold reads.

| Scenario | Main median ms | Candidate median ms |
| --- | ---: | ---: |
| First existing dates/Sub-Manufacturer transfer | 81.41 | 84.03 |
| Repeat existing date transfer (15 samples/arm) | 58.58 | 54.27 |
| Existing 200-line batch | 92.84 | 91.61 |

The first-round +2.62ms difference was investigated with three additional A/A
pairs (`transport-aa-results.json`). The two unchanged-Main positions had medians
94.85/86.94ms; the first-round range was 86.76–121.80ms. The candidate delta is below
this observed order/warmup variation; the other existing paths do not reproduce a
slowdown. No percentage tolerance or performance improvement claim is used.

New active work is budgeted separately: Importance assignments/Regular/clear took
53.35–75.85ms (nine samples), each produced exactly one upload and one download
package, 894–898 total network bytes written. The added field payload itself is at
most 24 uncompressed JSON bytes, under the 1KiB field budget. Idle rounds downloaded
zero packages. The transport uses the existing bounded queue/package/concurrency
limits; no duplicate network lifecycle is added. This is local filesystem evidence,
not a Windows/SMB/OneDrive latency claim or a p95 estimate.

Real application check: two independent Buyer Log servers with isolated auth,
source, local DB and browser profiles, the same Shared Hub, authoritative **delta**
mode, generated demo data (`generate-demo-data.js --rows 30 --seed 7`). A real CP
dropdown selection on A was durably transferred to B, read from B's actual CP
endpoint and displayed in B's real table in TR and EN. A subsequent Regular edit
on B was verified in A's CP endpoint. First visible feedback was 75ms (<200ms).
No browser page errors. `browser-results.json` records the outcome; the reviewed
post-change screenshot shows B's received BTS selection. There is no new rendering
algorithm or blocking loop; only constant shared-access checks on existing paths.
Startup/native gates outside these branches are N/A by source inspection; no
native/Electron behavior was modified or claimed as tested.

## Correctness and checks

- New regression suite was RED on Main (6/6 original tests failed); final suite is
  7/7 GREEN after an additional paste/history authorization regression.
- 95 targeted tests: PASS, zero skips/failures. Includes real folder peers, reverse
  edit, Regular, null, durable cold reload, concurrent same-owner convergence,
  foreign-owner local and incoming rejection, checkpoint field clocks/repair,
  existing dates, transport scope, paste/history and delta-store durability.
- 18 local contract/i18n/visual-note checks: PASS, zero skips/failures.
- `npm run release:notes:validate`: PASS; actual post-change 1440×900 PNG reviewed.
- Full regression is not claimed; the PR workflow also runs the new peer suite.
- Main reports `protected:false`; checks will be inspected explicitly before merge.

Reproduce the transport measurement from the repository root:

```sh
flock /tmp/buyerlog-performance-measurement.lock node docs/performance/importance-peer-sync-20261110/transport-benchmark.cjs
BENCH_VARIANTS=baseline,baseline BENCH_OUTPUT=transport-aa-results.json flock /tmp/buyerlog-performance-measurement.lock node docs/performance/importance-peer-sync-20261110/transport-benchmark.cjs
```

Fresh results and temporary databases are placed in `work/importance-sync-benchmark/`.
The benchmark loads the exact Main policy/local-db source through Node's module
compiler, preserving relative dependencies, and the candidate from the checkout.

## Rollout boundaries

All participating clients must receive the update and use the same Shared Hub in
authoritative delta mode. Existing order visibility/ownership remains in force;
private fields remain local. Catalog and Line rules remain moderator master data:
custom tag definitions must be published to peers through that existing path.
Previously filtered and already acknowledged local edits are not blindly replayed;
reselect such an old assignment after updating if it is absent on peers. New edits,
and assignments present in shared business checkpoints, use the added field scope.
TEST and STABLE publication are not requested or triggered by this PR.

## Integration with updated Main

PR #963 advanced Main to `3ffbf22043531705415d405b1c962f3fc4c06cc7`.
Integrated as `2cd13588` and preserved all three pending visual release notes.
All four affected backend/Importance UI files and the exact changed CP functions
(`cellHtml`, `cpPasteTarget`, `cpBulkHistoryCurrent`) are byte-identical to the
measured runtime source `ea7965f9`; upstream edits affect unrelated Backlog Excel
functions/styles. Policy/local-db baseline sources are also unchanged. The
recorded transport comparison therefore remains valid without repeating it.
On the merged tree, 83 relevant/regression/upstream-integration/contract tests
passed with zero skips/failures (`merged-validation.txt`); all three release notes
validated. Subsequent evidence-only commits retain those runtime bytes.
