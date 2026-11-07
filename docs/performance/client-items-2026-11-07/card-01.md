# CARD-01 — separate card list and detail rendering

## Measurement

The first baseline was measured before changing production code. The RED
browser run (`card-01-red.txt`) lost list/row identity, and the Node model tests
failed (`card-01-model-red.txt`). Final before/after runs use the same harness,
baseline source files from `1d8e8d39`, and separate fresh Chromium processes, with no
concurrent suite or browser workloads. See `card-01-before.txt` and
`card-01-after.txt` for all results, sample counts and request hashes.

Linux / Chromium 154, 1440×900, reduced motion. Each renderer runs with 500 and
5,000 synthetic records, 10 selections, 10 alternating searches and 5 saves
(where editing exists). Timings include synchronous drawing and forced layout.
The fixture uses the real renderers/engines and fixed layout constraints, not
the entire app shell. Saves use deterministic mocked HTTP responses and include
the UI work around the request, not network latency. These are synthetic fixture
results, not production or Windows/Electron speed estimates. With 10 samples,
the reported p95 is the largest sample; the JSON also includes the median.


| Renderer | Cards | Selection p95 ms | Search p95 ms | Save p95 ms |
| --- | ---: | ---: | ---: | ---: |
| license-cards | 500 | 461.9 → 140.9 | 253.8 → 262.7 | 712.6 → 382.2 |
| manufacturers | 500 | 43.2 → 3.0 | 35.2 → 43.9 | — |
| email-groups | 500 | 42.6 → 3.6 | 22.7 → 26.3 | 39.0 → 36.4 |
| license-cards | 5,000 | 4686.2 → 1414.9 | 1911.0 → 2507.6 | 7181.4 → 4137.9 |
| manufacturers | 5,000 | 431.5 → 7.2 | 447.8 → 354.7 | — |
| email-groups | 5,000 | 235.2 → 2.9 | 222.7 → 261.0 | 363.4 → 261.3 |

Selection improves for every renderer at both sizes. Search does not show a
consistent improvement: license search p95 increases in this fixture, while
manufacturer and directory results vary. Save gains are also conditional. The
change is accepted for the measured selection gains and retained draft/list
state; no whole-app or general search speedup is claimed.

## Implementation and equivalence

- License cards cache the base rows by data identity/revision, date and merge
  configuration. A query/licensor/sort view supplies both rows and counts;
  status/favorites/drafts derive from it. The default view reuses the base rows.
  Opening/closing details and toggling optional sections update only the dialog
  and the affected row state. Both expand controls keep their exact ARIA state.
  Saving updates the active row/dialog before the request; the new server
  snapshot refreshes the list. Discarding a draft outside the current filter
  removes its forced row through the full list path.
- Manufacturers reuse the filtered list and key map until result/directory,
  filters, language, permission or host changes. Selection updates the old/new
  row classes and selected detail. Filtering retains an unchanged detail.
- The directory keeps the list model separately from its detail. The complete
  snapshot signature includes locks and user identity, so lock-only changes
  invalidate the view even when the data revision is unchanged. Polling,
  heartbeat, revision checks and server authority are unchanged. An active
  draft field retains its node, focus and caret; list scroll survives selection.

The browser checks normalized list and detail HTML against the existing markup
functions on both source versions. All cases match. Save request SHA-256 values
also match before/after for both record counts. The checks cover scrollTop
120 → 120, retained list/row nodes, draft focus/caret, lock refresh and TR/EN
refresh. The Node regressions additionally compare filtered rows/counters with
the pure engine across all statuses, date/revision/sort/favorite changes and
drafts whose cards were removed or filtered out.

## Verification and screenshots

`npm test -- license-card manufacturer email-group card-list-model`: 24 files /
194 tests passed. The existing editor fixture gained the dialog DOM methods
needed by partial rendering; none of its assertions were removed. It now also
asserts that opening/history/licensor controls do not rebuild the list.

`node resources/app/scripts/card-render-acceptance.js --assert-optimized`
reproduces the current measurements and assertions. To compare an older source,
extract the three public JS files and pass `--source-dir /path/to/files`.
`--verify-only` shortens selection/search sequences for correctness checks.

`node resources/app/scripts/card-render-screenshots.js` launches the actual app
with isolated 20-order synthetic data, creates demo cards through the real API,
checks list identity during selection, reopens a retained license draft,
discards it outside its filter, and verifies a directory save by reading the
server snapshot. It captures three real 1440×900 post-change PNGs in
`public/release-notes/next-assets/`. Each was visually inspected; the selected
card/draft and list are visible. TR/EN notes cover all three screens.

No virtualization or additional search mechanism was added. Search still
rebuilds the filtered list, so its DOM cost remains and no general search speedup
is claimed. Manufacturer editing uses the existing shared directory editor;
there is no separate manufacturer save operation to benchmark. Risk: P2;
calculation, persistence and lock decisions are unchanged.
