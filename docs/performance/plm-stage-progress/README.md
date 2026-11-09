# PLM image job progress acceptance

Decision: PASS for the affected Linux web/runtime paths. This is a P2 progress
reporting correction; the canonical writer, image payloads, permissions, lease
policy, byte limits, download concurrency, retry and cancellation policy are unchanged.

Base Main: `4a0cc7b4a67c6c6bcd98e7b1c88db8f1cbef841d`.
Final application source: `fb8e5268` (later commits only add evidence and CI).
Pipeline and browser measurements use the final application source. Later
commits only add evidence and CI, without changing the measured product files.

The problem was a missing progress event after downloading, mixed counting units,
and a download counter that counted only successful attachments. The reported
last model could remain visible during canonical writes and asynchronous lease
release. This change reports actual stages; it makes no throughput claim.

## Budgets and environment

`budget.json` was recorded before implementation. New timers, duplicate polls,
and extra image downloads: zero. First feedback <=200 ms; no new >50 ms task
attributable to the changed progress rendering. Five panel open/close cycles
must not retain listeners or keep polling after the last job and panel close.
Existing timing/resource changes must fall within controlled baseline A/A
variation, without a repeatable regression.

Measurements ran serially under `/tmp/buyerlog-performance-measurement.lock`,
using Node and headless `/usr/bin/chromium` with Playwright on this Linux cloud
executor. The browser runs the actual Express app with isolated demo login/data.
Only `/api/plm-jobs` is replaced by synthetic job status; baseline JavaScript is
served from the recorded Main source. The browser checks TR/EN, 473/474=99%,
uncounted saving/releasing stages, completed history and a generic PLM data job.
No real business data or corporate endpoint is used.

## Pipeline comparison

Six alternating Main/candidate pairs each at 474 and 952 generated model
requests, plus three Main/Main control pairs at each size. Each process uses
real temporary image staging and the canonical ingest implementation with an
in-memory backing store. Images have a PNG signature plus a 2 KiB payload and
source identity. Fixture hashes and exact raw timings are in
`pipeline-results.json`. Hashes cover counts, outcome identities, content hashes
and the image map; all Main/control/candidate outputs match for each fixture.

| Records | Main median elapsed | Candidate median elapsed | Main CPU | Candidate CPU | Main sampled peak RSS | Candidate sampled peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 474 | 105.74 ms | 102.91 ms | 160.23 ms | 159.19 ms | 58.05 MiB | 58.43 MiB |
| 952 | 168.77 ms | 157.24 ms | 261.80 ms | 241.10 ms | 73.67 MiB | 73.79 MiB |

Main A/A elapsed ranges are 85.36–105.16 ms (474) and 134.72–172.38 ms (952).
Sampled RSS A/A variation is 57.86–61.76 MiB (474) and 72.53–73.68 MiB (952).
The median RSS differences are smaller than these baseline fluctuations.
There is no repeatable throughput, CPU or memory regression, and no statistically
reliable speedup is claimed. The initial shorter run is retained in
`pipeline-initial-results.json`: its 952-record timing was inconclusive within
baseline variance, so sampling was broadened to six pairs; the initial run was
not used as an accepted final performance result.

Each sample makes exactly ceil(N/100) style-list calls, N metadata calls and N
attachment downloads. Every sample returns N output records and leaves zero
staging entries. API/network work is unchanged. The reporter adds only stage
metadata to the existing status response, without starting a new timer/request.
The successful-download count stays independent from attempted-task progress.

## Browser comparison

See `browser-results.json` for three alternating Main/candidate pairs and
`browser-control.json` for three Main/Main pairs. Heap snapshots are taken after
forced collection, before the separate functional/screenshot checks, so those
checks do not contaminate the retained-resource comparison. Browser observations
include startup long tasks from the existing application; these are retained in
the raw evidence rather than presented as solved by this change.

| Metric | Main median | Candidate median |
| --- | ---: | ---: |
| Startup | 1984.00 ms | 1927.62 ms |
| First panel open | 12.30 ms | 4.20 ms |
| Collected heap after five cycles | 23.63 MiB | 23.63 MiB |
| Repeated panel open | 3.00 ms | 3.00 ms |
| Status refresh and layout | 7.70 ms | 8.90 ms |

All panel opens stay under 200 ms. Refresh differences (7.7 → 8.9 ms) are smaller
than the Main/Main control difference (7.3 → 9.6 ms). Collected heap differs by
about 4 KiB, below the Main/Main variation. The candidate has no post-open long
tasks in the final samples. Main has a 53 ms task in one sample; the A/A runs
contain 56–76 ms tasks. The baseline startup tasks are unchanged by this scope.

All five open/close cycles retain no additional event listeners for the candidate.
Status requests stop after closing the panel once the demo job is terminal;
post-close requests are zero in every run. The comparable measured scenario
makes 12 status requests per sample (initial load, panel opens and explicit
refreshes), with no extra poller. The short fixture exercises the same card and
status path for 474/952 records; the UI renders job cards rather than model rows.
The genuine post-change PNG is in
`resources/app/public/release-notes/next-assets/plm-accurate-progress.png` and was
visually inspected. TR and EN phase text, absent stale active model, absent
numeric ETA during saving, indeterminate progress accessibility and normal
completed/generic-job rendering are asserted by the browser script.

## Reproduce

Run from the repository root with existing app dependencies, Chromium and
Playwright. Use an isolated working directory; the scripts only use demo data.

```sh
mkdir -p work/plm-progress
cp docs/performance/plm-stage-progress/pipeline-perf.cjs work/plm-progress/
base=4a0cc7b4a67c6c6bcd98e7b1c88db8f1cbef841d
git show "$base":resources/app/public/app-main.js > work/plm-progress/base-app-main.js
git show "$base":resources/app/public/plm-operations.js > work/plm-progress/base-plm-operations.js
git show "$base":resources/app/server/server.js > work/plm-progress/base-server.js
git show "$base":resources/app/server/lib/plm-image-sync-service.js > work/plm-progress/base-image-service.js
git show "$base":resources/app/server/lib/job-registry.js > work/plm-progress/base-job-registry.js
flock /tmp/buyerlog-performance-measurement.lock python docs/performance/plm-stage-progress/run-perf.py
flock /tmp/buyerlog-performance-measurement.lock node docs/performance/plm-stage-progress/browser.cjs
flock /tmp/buyerlog-performance-measurement.lock node docs/performance/plm-stage-progress/browser.cjs --control
```

Full raw results are emitted to
`work/plm-progress/`. The browser also regenerates the demo release-note PNG.

## Validation and platform limits

`node resources/app/tests/run-tests.js plm job-registry`: 72 files, 535 tests
passed. The final panel source also passed its 24 focused UI/stage tests.
Related image-byte-budget, package-path, route and i18n checks: 30 passed.
Pending release-note validation: 11 entries passed.

Native/Electron code is unchanged; this acceptance covers the shared web UI and
Node image orchestration. It does not establish timings for a real corporate PLM
connection, Windows disk/SMB or OneDrive. No TEST or STABLE release is triggered.
Main was observed with `protected=false` and no repository rulesets; CI is checked
explicitly before merge, rather than relying on assumed branch protection.
