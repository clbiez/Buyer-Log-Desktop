# Performance result

**L2 · PASS** for the measured Linux/Chromium table path. Runtime source is unchanged from `f256f702d97c4c4e99ba2ca530d9a566a3463feb`; the later commit adds evidence only. Main is `15b364dd6cac88778174b565d5199ae60fa23222`.

Three independent alternating pairs per scenario; each arm uses a fresh browser and five render/close cycles. The table below uses the median of each arm's cycle median, then the median of the three arms. No p95 claim is made. Forced GC is outside the timed visible-response interval. Raw browser long-task observations include browser/background activity and are not a render-only CPU measurement.

| Scenario | Rows | Main sync / visible ms | Candidate sync / visible ms | Table elements A / B |
| --- | ---: | ---: | ---: | ---: |
| Existing manual comparisons | 200 | 14.6 / 71.4 | 15.2 / 80.9 | 1595 / 1595 |
| Existing manual comparisons | 30,000 | 14.2 / 76.4 | 14.1 / 76.3 | 1595 / 1595 |
| New automatic comparisons | 200 | 12.0 / 63.6 | 13.4 / 73.9 | 1420 / 1570 |
| New automatic comparisons | 30,000 | 14.3 / 73.5 | 14.8 / 78.7 | 1420 / 1570 |

- Existing-flow normal-size visible timing differs by 9.5 ms; the controlled same-source manual A/A arm medians range from 68.5 to 90.6 ms (22.1 ms variation). Its synchronous render difference is 0.6 ms against A/A arm variation of 1.8 ms. The large existing-flow medians do not increase. The data does not establish a repeatable regression outside measured same-source variation; no speedup is claimed.
- The new automatic old/new display costs visible time versus Main's previous current-value-only display: approximately +10.3 ms at 200 rows and +5.2 ms at 30,000 rows. Both are below the pre-recorded 200 ms new-work budget. This different output is not described as equivalent work.
- New automatic comparisons add 150 table elements, within the +300 budget. Existing manual comparisons have identical DOM counts. Both use a 50-row page for 30,000 source rows; the entire dataset is not mounted.
- Measured request counts remain in the same existing background-request range (7–9); no new request or polling code is introduced. Effective date/derived-value checksums match between render variants. The intentionally changed earlier/equal approval precedence is covered separately by regression tests.
- Post-GC heap samples across five cycles show small warm-up changes in both variants, with no additional sustained growth distinguishable from same-source A/A variation. Raw samples are retained rather than claiming a broader leak proof.
- Existing browser long tasks above 50 ms remain visible in the raw evidence. Across the existing-flow scenarios the maximum observed is 87 ms for Main and 75 ms for candidate; the new-comparison scenario maxima are 69 ms and 66 ms. This change does not claim to remove existing long tasks.

## Reproduction

From the repository root, serve `resources/app/public` on `127.0.0.1:8765` using `python3 -m http.server 8765 --bind 127.0.0.1 --directory resources/app/public`. Then, with Playwright installed and `/usr/bin/chromium` available:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright node docs/performance/revision-origin-separators/measure.cjs
PLAYWRIGHT_MODULE=/path/to/playwright node docs/performance/revision-origin-separators/measure.cjs --manual
PLAYWRIGHT_MODULE=/path/to/playwright node docs/performance/revision-origin-separators/measure.cjs --aa
PLAYWRIGHT_MODULE=/path/to/playwright node docs/performance/revision-origin-separators/measure.cjs --manual --aa
```

The driver serializes measurements using `/tmp/buyerlog-performance-measurement.lock`. It records source hashes, runtime/browser, all samples, table DOM counts, heap observations and request counts. `budget.md` discloses when the plan was recorded. Electron-native paths, Windows, SMB, upstream services and synchronization throughput were not measured and are not changed by this PR.
