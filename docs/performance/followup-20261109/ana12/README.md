# ANA-12 — Backlog consumer cancellation (narrow follow-up)

Base Main: `511cb2fae629cd6e0c1ad31eb773775e5c95841d` (fresh `origin/main`).
Branch: `fix/followup-backlog-cancel-20261109`, separate worktree.
Contract: https://github.com/clbiez/Buyer-Log-Desktop/issues/937

## Verified chain and scope

- Overview: `refresh` → `loadRows` → shared `BLBacklogRows.loadData` → fetch `/api/backlog-export?format=json`.
- Chart: `loadDetail` uses the same shared rows API (with a direct-fetch fallback); `openSettings` can request all source columns. The current main HTML contains no separate `backlogChartPanel`. The real-app acceptance exercises its settings API; the chart render supersession/disable race is covered by an executable VM test.
- Filter drawer: `ensureFilterValues` → fetch `/api/backlog-filter-values`.
- Both HTTP routes retain area/source readiness checks and `prepareComputeBacklog`. Their new adjacent `backlogReadConsumer` listens for request `aborted` and unfinished response `close`, never normal request `close`.
- The routes pass an opt-in consumer signal to `computeReads.run`. Each consumer owns one reference. The last pending departure removes the flight immediately and aborts its controller. That signal reaches the existing `compute-service.run` → `compute-pool.run` path; the pool's existing queued cancellation / worker retirement contract is unchanged.
- `sendComputedResponse` still performs the live response guard and releases the response lease on finish/close. Its implementation is unchanged.

Shared browser fetches also count consumers. An old Overview or chart view detaches its own consumer; another live panel can retain the same request. Closing the filter drawer aborts unfinished facets; cached/completed facets and rows remain reusable. Generation checks and abort checks prevent late responses from mutating the new view or repopulating an abandoned cache entry.

The preparatory source-info/cache warming path is unchanged. It can be shared with other routes; a disconnect during preparation prevents admission of the subsequent export/facet job. Consumer cancellation is explicitly opt-in; other compute readers and legacy browser consumers keep their existing behavior. This is **not all of ANA-12**: no Plan/Actual engine move, worker/pool creation, compute-service/pool contract change, FX/SHELL work, permission policy change or performance campaign.

## Evidence

- [RED](red.log): the five new compute cancellation tests against the unmodified base module: PASS 0, FAIL 1, CANCEL 4 (bounded test deadlines expose absent cancellation). The first failure is a missing compute signal; the others cannot settle after abort.
- [GREEN](green.log): 82 targeted tests, PASS 82, FAIL/SKIP/CANCEL 0. Covers single/shared/last consumer, fresh repeat query, pre-dispatch cancellation, late success/error, cache/lease release, source/access changes, independent sessions, normal completion and existing pool limits.
- [HTTP integration](../../../../resources/app/tests/backlog-http-cancel.test.js): evaluates the actual route/helper source, uses real Node HTTP connections, the actual compute-read service, the existing pool and existing test worker fixture. Disconnecting one of two consumers retains the job; the last disconnect retires the worker. A normal GET finishes without abort. Output leases and pool bytes return to zero after cache clear.
- [Real-app acceptance](acceptance.cjs) / [raw log](acceptance.log): isolated real Buyer Log server, 20 generated demo orders, actual Chromium. Closing/collapsing, leaving Backlog, closing chart settings, reopening facets, a rapid change to an empty query and repeating the original query pass. Response gates deliberately delay real HTTP results to test stale completion; these are not claimed as a worker cancellation measurement. Browser errors: 0.
- [Fixture regression](fixture-check.log): 17 tests pass after updating the existing route harness to include the new real helper and HTTP event emitters. Existing query/date/preview/export assertions remain intact; the harness additionally verifies the opt-in signal.
- [Navigation contract](navigation-contract.log): all 7 tests pass; its exact source assertion now requires both the existing `cache:json` option and the new consumer signal. The preceding full run stopped at batch 3 on that stale assertion ([raw log](full-test-route-contract-failure.log)); the final run starts again from batch 1.
- [Initial environment failure](full-test-initial-environment-failure.log): the first standard full run stopped at batch 1 because this sandbox cannot write the default `/home/agent/.buyer-log/write-recovery`. Subsequent standard runs use the supported `BUYER_LOG_DATA_ROOT` override under `/tmp`; no HOME override or test/threshold/skip relaxation.

Heavy acceptance and regression runs serialize with `flock /tmp/buyerlog-performance-measurement.lock`. Dependencies installed with the existing lockfile (`npm ci --ignore-scripts --no-audit --no-fund --cache /tmp/ana12-npm-cache`); no dependency/version files changed. Runtime: Linux x86_64, Node v24.19.0, runner `tests/run-tests.js`, default concurrency 4.

## Release and review

One new TR/EN release-note ID: `ana12-backlog-consumer-cancel-20261109`. The existing `next.json` metadata and all prior changes are preserved. Its unique 1440×900 lossless PNG is an inspected screenshot of the actual post-change demo Backlog after returning to the original query. It shows recovered current data; HTTP/unit evidence proves the invisible cancellation details. `npm run i18n:check`: new missing 0, baseline 0. `npm run release:notes:validate`: 7 changes OK.

Critical diff review: only the specified client request lifecycles, the two server routes with their adjacent lifecycle helper, and opt-in compute-read cancellation changed in production. Authorization/build/response/generation guards, cache budgets/TTL, lease idempotence, worker limits, PLM/BOM, checklist row caches/CI steps, Motion+ and the i18n baseline are preserved. No independent reviewer was used: this is a bounded resource-lifecycle fix and does not change multi-user write or permission policy.

Standard final-source full regression: **1318 files, 10/10 batches PASS, 9098 tests, PASS 9033, FAIL 0, SKIP 65, CANCEL 0**, 130.6 seconds. Existing platform/optional skips are retained; none were introduced. [Raw log](full-test.log) / [per-batch counts](full-test-summary.json).

Exact final-head PR CI results are recorded in the single `[ANA-12]` final comment on #937. No merge, branch deletion, TEST or STABLE publication.
