# L2 — 30,000-row shared table search

Baseline: `844dcb27`; Node v24.19.0; Chromium 151.0.7922.173. Three fresh-context pairs: Main→candidate, candidate→Main, Main→candidate. No full-suite process ran during the final measurement.

Each warm-filter sample has five runs. Typing samples measure every prefix of the query. The table reports the median of the three per-pair medians (milliseconds); cold samples are the first complete-query filter. Raw samples and main equivalent-period reference samples are in [raw.json](raw.json).

| Module | Query | Cold Main / candidate | Warm Main / candidate | Typing Main / candidate |
| --- | --- | ---: | ---: | ---: |
| orders | `MINEC` | 147.9 / 125.3 | 121.6 / 42.2 | 119.9 / 38.3 |
| orders | `MB=M5; MINEC` | 125.2 / 87.9 | 119.8 / 67.1 | 117.3 / 63.6 |
| collection | `MINEC` | 288.2 / 143.8 | 170.7 / 69.7 | 168.8 / 67.7 |
| collection | `MB=M5; MINEC` | 164.2 / 149.4 | 165.2 / 97.0 | 165.7 / 98.2 |

Native main returns 0 for the new period query, while candidate returns 30; no equal-behavior claim is made for native main. The explicit main reference uses its MINEC filter followed by a canonical LCW / stored Collection month predicate and also returns 30. Reference warm medians:
- orders: raw pair medians 114.7, 133.0, 116.9; combined median 116.9 ms.
- collection: raw pair medians 171.6, 163.3, 160.7; combined median 163.3 ms.

L2 PASS: all reported medians, including cold-filter samples, are below native main.

The first implementation showed cold-cache regressions. The final version shares folded display values, distinct-date descriptions and Collection month/week code parsing, while retaining per-row value signatures and calendar-generation invalidation. Functional tests cover the new semantics independently.
