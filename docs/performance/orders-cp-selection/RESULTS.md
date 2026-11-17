# Final measurements

Measured source: `c2f6420ebc282426bd1526ba014e670d1c4e1c67`; Main: `fbbce9f99d3fae78cf9484dfdcac13c485e568f9`.

Linux Chromium 151.0.7922.173; 2 CPU core quota; 8 GiB memory limit.
Fixture SHA-256: `e0b959cb8eeade4572f1e9bbf218928460b8b598727ebcbf3a7711e87cea0d06`.

Each variant uses the same isolated 30,000-order fixture, fresh browser contexts,
Priority sorting and a 200-row page. Orders has 30,000 rows; CP has 24,982 active
rows. Measurement waits for `BACKGROUND_WARMUP_DONE`, closes the release-notes dialog,
and asserts that hit-testing reaches the row checkbox. The order is candidate/Main,
Main/candidate, candidate/Main. Both ordinary and unchecked-only selection run
in each context. Chrome trace markers and the first main-renderer Paint event
provide the paint metric; two-rAF settle time is also retained separately.

| Module | Metric (median of 3) | Main | Candidate |
|---|---|---:|---:|
| orders | Single: first recorded paint (ms) | 100.0 | 60.8 |
| orders | 200-row range: first recorded paint (ms) | 6,260.9 | 338.3 |
| orders | Single: two-frame settle (ms) | 234.6 | 102.6 |
| orders | 200-row range: two-frame settle (ms) | 6,440.3 | 389.0 |
| orders | 10 s idle: main-thread TaskDuration (ms) | 873.4 | 674.5 |
| orders | 10 s idle: total long-task duration (ms) | 456.0 | 0.0 |
| orders | Retained JS heap after ordinary scenario (MiB) | 204.2 | 210.3 |
| orders | Unchecked-only range: settle (ms) | 6,443.8 | 386.2 |
| orders | Unchecked-only 10 s idle: TaskDuration (ms) | 861.6 | 746.6 |
| orders | Max sampled heap before GC over 5 replacement cycles (MiB) | 214.9 | 233.2 |
| orders | Final retained heap after 5 replacements + explicit snapshot (MiB) | 203.6 | 210.9 |
| cp | Single: first recorded paint (ms) | 363.2 | 75.0 |
| cp | 200-row range: first recorded paint (ms) | 8,345.1 | 449.6 |
| cp | Single: two-frame settle (ms) | 568.6 | 132.8 |
| cp | 200-row range: two-frame settle (ms) | 8,558.0 | 518.7 |
| cp | 10 s idle: main-thread TaskDuration (ms) | 1,510.2 | 1,276.6 |
| cp | 10 s idle: total long-task duration (ms) | 1,434.0 | 0.0 |
| cp | Retained JS heap after ordinary scenario (MiB) | 252.6 | 194.3 |
| cp | Unchecked-only range: settle (ms) | 9,741.7 | 538.2 |
| cp | Unchecked-only 10 s idle: TaskDuration (ms) | 1,100.7 | 1,057.8 |
| cp | Max sampled heap before GC over 5 replacement cycles (MiB) | 260.6 | 274.5 |
| cp | Final retained heap after 5 replacements + explicit snapshot (MiB) | 253.7 | 260.3 |

## Acceptance

Decision: **FAIL**. The original latency and memory budgets are not waived.

- orders/range: median first paint 338.3 ms exceeds the 200 ms target
- cp/range: median first paint 449.6 ms exceeds the 200 ms target
- After explicit snapshots and five replacements, retained heap increases by
  about 7.3 MiB in Orders and 6.6 MiB in CP. Sampled pre-GC maxima increase by
  about 18.3 MiB and 13.9 MiB. These are reported tradeoffs, not accepted budgets.

The required algorithmic gates pass on the measured source: no full filter/sort
on single/range selection or during idle, one footer/action flush for a 200-row
range, and exact unchecked-filter hidden-count parity. The 200 ms range feedback
target is not waived. The trace range timeline retains UpdateLayoutTree, Layout,
Paint and callback durations so the remaining renderer work is visible.

Heap numbers are JS heap, not RSS or unique physical memory. The before-GC
values are sampled maxima at cycle checkpoints, not continuous peak sampling.
The five cycles replace the render-owned indexes. An explicit parity snapshot
runs before these cycles, so its canonical/priority caches are included. No
claim of Windows/Electron or SMB acceptance is made; native/server/transport
code is unchanged. An unresolved latency or memory budget cannot be converted
to PASS using the green unit tests.

## All raw run metrics

Every sample, long-task duration, operation count, heap checkpoint, source hash
and trace marker used here is in [measurements.json](measurements.json).
The first Paint event and count are kept; other repeated Paint events were
trimmed. The original untrimmed local capture is an intermediate workspace file.

Reproduce from the repository root with Playwright available:

```sh
flock /tmp/buyerlog-performance-measurement.lock node docs/performance/orders-cp-selection/benchmark-selection.cjs \
  --baseline fbbce9f99d3fae78cf9484dfdcac13c485e568f9 --settled --rows 30000 --out /tmp/selection-measurements.json
```

The first invocation generates synthetic Excel and refreshes an isolated temp
root; reuse the reported `root` with `--fixture-root … --skip-refresh`. The script
defaults to `/usr/bin/chromium` (`CHROMIUM_PATH` overrides it); Playwright can be selected with
`PLAYWRIGHT_MODULE`. Heavy tests and measurements share the performance lock.

## Subsequent Main integration

Main advanced to `2f66161b` during this work. It was merged after the measurements;
its upstream startup/image changes alter app-main.js. The numbers above describe
the pinned measured source, not a fresh measurement of the final merged tree.
The original L2 decision remains FAIL. Selection regressions passed 67 tests
after integration; the release-note-only conflict preserved both additions.
