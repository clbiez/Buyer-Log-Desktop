# Final validation — CARD-01, INT-09, CPR-11

Final code rebased onto main `63159fb3` (PR #902), which includes PR #894. Main supplied the existing
v714 source-contract test correction; this work does not change that test or
any prohibited source file. The original base stopped at the known v714 failure.
The final full run passes, including v714.

| Check | Result |
| --- | --- |
| Related tests (62 files) | 522 passed, 0 failed |
| Full `npm test` (1,292 files / 10 batches) | 8,851 passed, 0 failed, 65 existing skips; 119.7 s |
| Pending release notes | 42 entries valid |
| i18n | 0 missing translations; baseline remains empty |
| CPR-11 RED → GREEN | Failed compile count → one compile; exact errors/results/serialization preserved |
| INT-09 RED → GREEN | History reparsed/replaced → active answer only; safe HTML and selection checks pass |
| CARD-01 RED → GREEN | Replaced list/draft nodes → retained nodes; row/detail HTML and save hashes match |
| Actual-app acceptance | License draft reopen/discard and directory save verified with isolated synthetic data |
| Visual evidence | Four actual post-change PNGs inspected; TR/EN notes included |
| Scope | No PR diff in app-main.js, checklist-supplier-sync.js, cp-checklist-engine.js, cp-overview-assistant.js, index.html, perf-runtime.js or server/** |

Commands were run from `resources/app`. In this Linux cloud environment, the
full run uses `APPDATA=/tmp/buyerlog-client-tests/roaming`,
`LOCALAPPDATA=/tmp/buyerlog-client-tests/localapp`, and
`BUYER_LOG_SERVER_DATA_ROOT=/tmp/buyerlog-client-tests/server` to isolate data.
The 65 existing skips cover Windows/browser/portable checks and the optional
20,000-operation soak; none were introduced or changed here. Batch summaries
and the v714 pass are retained in `full-npm-test.txt`.

Related filter command:
`npm test -- cp-rule cp-checklist business-rules lcwai markdown license-card manufacturer email-group card-list-model`.
Also run: `npm run release:notes:validate`, `npm run i18n:check` and
`git diff --check origin/main`.

See the individual reports and raw before/after data in this directory. CARD-01
improves selection and saves, but does **not** establish a general search gain:
5,000-license search p95 increases from 1,911.0 to 2,507.6 ms in the fixture
(median 1,874.1 → 1,828.0 ms). This limitation is retained explicitly; no
virtualization or additional search scheme is claimed or shipped.

Three independent implementation commits. No merge, TEST or STABLE publication.
