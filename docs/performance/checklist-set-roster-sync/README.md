# Checklist set roster sync acceptance

Decision: PASS for the changed client writer/journal paths. No general speedup is claimed.

Base: `76cf2029c55950a5442a1fd0e0bf7887bbf25ef4`. Measured product source: `b1f22f581076da0f7941c5e777a15bb565670fd5`. Subsequent changes affect only the acceptance script, screenshot and this evidence; the two product JavaScript files are identical to that measured commit.

Budgets were recorded in `budgets.json` before the comparison. Chromium 151.0.7922.173 / Node v24.19.0, Linux cloud, one server/browser at a time under `/tmp/buyerlog-performance-measurement.lock`. Three alternating Main/candidate pairs at each size; five real CP status/evidence saves and five CP/Orders revisits per run. The generated source uses seed 7. No p95 claim.

| Rows | Source | Startup median ms | First save median ms | Per-run save median ms | Feedback median ms | Revisit median ms | Post-GC final heap median MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 40 | main | 3865.90 | 504.50 | 528.90 | 6.10 | 189.30 | 13.58 |
| 40 | candidate | 3809.40 | 498.00 | 561.80 | 6.20 | 185.30 | 13.68 |
| 400 | main | 4573.08 | 775.50 | 711.00 | 10.70 | 234.20 | 16.04 |
| 400 | candidate | 4658.22 | 873.80 | 791.40 | 11.70 | 236.70 | 16.10 |

Timing noise was investigated rather than adding a percentage tolerance. The 40-row save median difference (+33.0 ms) is smaller than the controlled same-source A/A median spread (530.0 to 491.0 ms); a reverse-order pair produced 515 ms candidate / 488 ms Main. The 400-row same-source Main run medians span 688–794 ms; the candidate medians span 700–848 ms. Individual samples and all runs are retained, including slower candidate runs. These ranges do not establish a general speedup or a resolved legacy render bottleneck. The changed synchronous feedback remains 5–14 ms, below the 200 ms budget; the journal/roster branch adds no new background worker, polling source or render pass.

Existing main-thread tasks over 50 ms remain present in Main and candidate during the shared CP render/revisit paths (Main run peaks 255–516 ms, candidate 326–532 ms). This change does not claim to fix those existing violations. Peak variation is within the observed same-source range; no new work proportional to all CP rows is added to the ordinary save path. The missing-roster recovery path reads the existing decision layer only when an unmatched pending option part exists.

Every measured save uses exactly one POST; five POSTs / 1,576 request-body bytes per run, peak concurrency 1, active requests 0 after completion. Post-GC heap retains the app’s existing answer/history/cache warming in both sources; candidate endpoint medians differ by approximately 0.1 MiB, within the same-source run variation. No extra request stream, listener registration or persistent worker is introduced. Browser/servers are closed after each run. Native/Electron, Windows/SMB and remote upstream gates are N/A for these unchanged paths and are not claimed as measured.

Fixture hashes (canonical order/PLM/model/colour/quantity tuples):

- 40 rows: `e8aaf3e3b72c39b82a2a1faa92e31c6b3d86ca5de99d7ede9bd493bedef2f962`.
- 400 rows: `3e3e146af5f3ed2ce25ee52c52dab5cbb8713511fabbf9b80588c8d0814da213`.

Correctness: 206 checklist/notification/i18n tests on the rebased source pass. The actual CP status menu also returns HTTP 200 and the order and reusable option approvals are read back from the isolated server. Regression cases cover the 200-entry boundary, restart, permanent rejection, recovery, attachments/evidence and durable notification targets. The server authorization and atomic roster validation were not changed.

Reproduce each run from a checkout with runtime dependencies installed:

```bash
BENCH_APP_ROOT=/path/to/resources/app BENCH_ROWS=40 BENCH_LABEL=main-40-1 BENCH_RESULT=/tmp/main-40-1.json flock /tmp/buyerlog-performance-measurement.lock node docs/performance/checklist-set-roster-sync/run.cjs
```

Repeat with 400 rows and with the candidate checkout, alternating three pairs. `raw/` contains every paired sample and the A/A/reverse-order diagnostics. `diagnostic-main-source-candidate-server.json` is explicitly a diagnostic with Main JavaScript served in the candidate server, not an unmodified candidate acceptance sample.
