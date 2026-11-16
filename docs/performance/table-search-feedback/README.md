# Missing search values — P2 / L2 PASS

Base Main: `dacd2ddb`. Product source is the PR's `app-main.js`,
`table-search-feedback.js`, `index.html`, `table-search-help.css` and
`ui-components.css`. Only evidence/tests/release notes were added after measurement.

Budget declared before implementation: three alternating Main/candidate pairs,
30,000 synthetic Collection rows, same Node/Chromium/machine and warm search.
Existing search/render must not regress; new feedback <200 ms, no new >50 ms
blocking task. No added network calls, observers, polling, row cache or listeners.

Reproduce with Playwright and `/usr/bin/chromium` installed:

```sh
flock /tmp/buyerlog-performance-measurement.lock node resources/app/scripts/table-search-feedback-acceptance.js
```

The script starts a local isolated Buyer Log server and account. Main's actual
`app-main.js` is served in baseline contexts; other assets remain identical.
Five of eight requested IDs exist among 30,000 rows. The same result rows and
order are retained. Missing values are an additional presentation, not a filter.
Fixtures and logs stay in `work/`; no real business data is used. Dataset hash,
runtime/browser and every measured sample are in [samples.json](samples.json).

| Metric (ms) | Main samples | Candidate samples | Main median | Candidate median |
| --- | --- | --- | --- | --- |
| renderKol | 1082.9, 1023.8, 1027.0 | 1158.7, 976.2, 1013.5 | 1027.0 | 1013.5 |
| render → next frame | 1133.3, 1078.0, 1089.2 | 1237.4, 1034.3, 1078.2 | 1089.2 | 1078.2 |
| Added feedback | 0, 0, 0 | 0.5, 0.3, 0.4 | 0 | 0.4 |

PASS: no median regression and new feedback stays within its own budget.
No general speedup or p95 claim: three samples are noisy. The pre-existing
30k Collection filter/render blocks for about one second in both versions;
this change does not resolve that existing limitation. Added feedback itself
creates no >50 ms task in this scenario. Heap snapshots are recorded for
context, not presented as peak/retained-memory measurements. Each pair uses
fresh contexts and closes them; product code creates no persistent listeners,
observers or caches. Empty queries skip row traversal.

Actual UI acceptance also passed for CP, Orders and Collection, eight IDs with
three missing, clearing input, Excel row groups, TR/EN, light/dark themes and no
page errors. A unit regression checks safe text insertion, accessible status,
translations and stale-warning removal. The release PNG was inspected and
shows five result rows plus the three missing values in red.

Scope limits: Linux Chromium web mode, synthetic data; Windows/Electron,
corporate upstream and real-user data were not measured. Native/sync/server
paths are unchanged. No TEST or STABLE publication is part of this task.
