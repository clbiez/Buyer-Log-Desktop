# Validation record

## Candidate source

`97f6e9e67a47c1f3beecec525746b363bb38bcd9`; product hashes in
`candidate-source.sha256`. Measurements and full suite used those exact product
bytes. No candidate code changed after measurement or during the full suite.

- Initial three contracts RED on pinned Main: `red.log`, `red-direct.log`.
- Expanded candidate contracts: **5 PASS, 0 FAIL/SKIP/CANCEL**;
  `green-expanded3.log`. Earlier failed attempts remain in this directory.
- Real HTTP acceptance: **18/18 complete processes**, 36 cold/warm observations,
  all primary/business/event oracle comparisons and exact CP restart checks
  pass. See `pairs/`, `summary.json`; experiment performance still **FAIL**.
- `NODE_PATH=/workspace/Buyer-Log-Desktop/resources/app/node_modules:/workspace/.buyerlog-tools/node_modules flock /tmp/buyerlog-performance-measurement.lock npm test`
  from the candidate's `resources/app`: **1330 files, 10/10 batches,
  concurrency=4, uninterrupted runner PASS**, 244.4 s.
- Sum of actual Node batch counters: **9214 tests, 9149 PASS, 0 FAIL,
  65 SKIP, 0 CANCEL**. Per-batch counts: `full-suite-counts.json`;
  every skipped test name: `full-suite-skips.txt`. Skips are not counted as
  passed. Raw complete output: `npm-test-candidate.log`.
- Environment: Linux, Node 24.19.0, npm 11.9.0. Existing dependencies reused;
  no package, lock, runtime, worker count, timeout, retry or memory change.
  The original checkout remained clean and on its original `work` branch.

The existing local-db/WAL/replay/owner/ACK/sync tests, CP date-subfield tests,
and #916 row-cache tests remain in the unchanged full runner and PR workflow.
Their presence and results are not a substitute for unmeasured native/SMB or
candidate-specific crash/undo/retained-resource acceptance.

## Final product source

The candidate was removed after its failed byte gate. All experiment helpers
and candidate contracts moved out of product paths into `experiment/`; the
test source has a `.source.txt` suffix and is not registered in the standard
runner. The original locations and executable tests remain reproducible at
the candidate commit above.

Final changes are exclusively under
`docs/performance/phase6-followup-20261109/6c-batch/`.
`git diff --quiet origin/main -- resources/app` passes; the entire application
tree, not only the three experimental modules, equals pinned Main. The final
index tree equality and protected-file checks are saved in
`source-equality.txt`. No application, contract, release manifest or shared
program report remains modified. Final runtime performance: **N/A** because
the final delivery is evidence/archived experimental source only; this does
not change the candidate's FAIL or delivery BLOCKED decision.

Per #952's documentation-only source-equality rule, the full suite was not
needlessly repeated after removing the candidate. Its PASS is explicitly
reported against the tested candidate, not misattributed to another source SHA.

Final invariant checks (`final-static-checks.log`), serialized after the suite:

- `npm run i18n:check`: **PASS**, new omissions 0, baseline 0.
- `npm run release:notes:validate`: **PASS**, existing 15 changes.
- `node --test tests/agent-instructions.test.js`: **PASS**.
- TR/EN new UI text, new release entry and post-change PNG: **N/A**. No product
  change is retained; the proposed optimization is not advertised as shipped.
  Existing `next.json`, its top-level fields and other entries/assets are exact
  Main bytes. No release-note schema exception was introduced.
- Critical diff review: final changes are evidence only. On the archived
  candidate, reviewed dispatch-after-primary-save ordering, per-row actor and
  subfields, zero-append owner fallback, no blind retry after possible writes,
  rollback/inflight/flush ownership and untouched guard/ACK paths. No independent
  reviewer or native/platform certification is claimed.

Final freshness: a safe `git fetch origin main` and ancestry check again return
`d0fdb8889f188e2cc1387b0850f61a841aa7e6d5`; no local or remote merge occurred.
The automatically rejected normal-merge attempt did not run. Since current
Main was already the base, no merge was necessary.

The PR is an open draft for review, not merge authorization. Final-head CI is
checked only after the last pushed commit; its exact SHA, run URL and result
are reported in the sole final `[6C-BATCH]` comment on #952. No prior SHA's
green result is reused. No TEST/STABLE/pilot/migration/issue-close action.
