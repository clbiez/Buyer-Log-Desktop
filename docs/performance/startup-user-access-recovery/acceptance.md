# Startup user access recovery — 7.0.360

Baseline: 5d2a16c51ad18560299e2598ba474a30899e392e. Risk P2: retrying a failed UI script; server authentication and authorization remain unchanged.

L2 scope: authenticated startup, one synthetic local moderator and empty source data. Three alternating baseline/candidate pairs in the same headless Chromium and isolated server. The baseline serves the three original public assets from this exact commit. No production or business data.

Budgets before measurement: normal opening-screen gate and actual Continue-to-visible-shell medians must not regress by more than 10% or 50 ms (whichever is greater); normal access script count stays one. A temporary 503 triggers exactly one existing shared-loader retry; a second failure exposes Retry without releasing the profile gate. A pending opening-screen projection remains gated even after profile recovery. Retry timers and limits are inherited from the shared loader, not raised. No change to server, data parsing, table rendering, polling or retained caches; their large-data gates are N/A for this bounded script-load fix.

Run: `NODE_PATH=<playwright package directory> node scripts/startup-user-access-acceptance.cjs`. The script prints raw samples and a path to retained JSON. `BUYER_LOG_STARTUP_RED=1` reproduces the profile stall in the baseline and exits nonzero.

Results: PASS. Baseline/candidate gate medians: 2273.5 / 1789.9 ms. Actual visible-shell medians: 3394.8 / 2812.6 ms. Each normal startup loads exactly one access script. All three failure/recovery scenarios passed, including TR/EN live switching. The baseline transient-failure scenario failed at the profile gate as expected. Raw samples are in samples.json. No general large-data or native Windows performance claim is made.

Regression: the 1,402-file suite was executed on Node 22.23.3, concurrency 4. Batches 1/2 ran first; four restore-user tests in batch 2 rejected their temporary auth fixture because the invocation accidentally set a global BUYER_LOG_TEMP_ROOT. No product/test code was changed for that environment issue. Removing that override made all four pass. The unchanged original runner was resumed in memory at batch 3, preserving the exact remaining file list, grouping, concurrency and fail-fast logic. Batches 3–10 passed. Total original suite: 9,685 tests, 9,620 pass and 65 platform/optional skips after that correction. Native Windows UI acceptance is not claimed.

The signed-patch publication workflow will independently run the full suite before releasing signing credentials. Main branch protection is currently disabled; PR checks and publication gates must be evaluated explicitly.
