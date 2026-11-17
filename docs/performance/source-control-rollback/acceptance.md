# Remove the 7.0.360 Source Control PR

Baseline: a514af94 (current main at investigation). The revert removes PR #1050 / feature commit 5ab485072673a63c962adfa0d4d61b0a157d250e. All three query-engine files must be byte-identical to 5ab48507^; unrelated subsequent changes are retained.

L2 narrow acceptance: query construction is the only normal runtime path touched; the standalone CLI is removed. Before measurement, require exact normal ASAS/IAS query output equality, ASAS fabric fields retained, IAS fact-context SELECTEDVALUE preserved, and no experimental RELATED query from stale flags. Run three alternating baseline/candidate pairs of 500 synthetic ASAS+IAS query builds after warmup. Median budget: no increase above 10% or 10 ms (whichever is larger). No DB, Excel, network, parser, row-grain, Electron or startup algorithm is changed by this revert; populated 30k/native-startup speed claims are N/A. User's reported startup cause is unconfirmed; this is the requested feature rollback, not proof of a root cause.

Results: PASS. Exact normal ASAS/IAS query equality holds. Baseline/candidate medians are 141.06 / 135.93 ms per 1,000 builds. Raw alternating samples are in samples.json. Three production query regression tests and 121 related existing assertions pass. The removed utility tests covered only the deliberately removed feature; normal query contracts are retained in model-source-control-rollback.test.js.

Reproduce with a worktree pinned to a514af944ed6b89fd4f639c21ffd699e628a082d and run `node docs/performance/source-control-rollback/bench.cjs <baseline>/resources/app resources/app`. Use isolated writable BUYER_LOG_DATA_ROOT, BUYER_LOG_LOCAL_DATA_ROOT and BUYER_LOG_SERVER_DATA_ROOT when needed. No customer source connections are contacted by this synthetic query construction check.

Full local regression completed on Node 22.23.3: all 1,402 test files executed, no failures; 65 platform/optional skips. Release publication separately requires the full Windows regression workflow. The desktop startup issue on the user's actual computer is not asserted resolved by these tests.
