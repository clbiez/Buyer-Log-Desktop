# Orders / CP selection hot path

Risk P1; performance tier L2. Base Main: `fbbce9f99d3fae78cf9484dfdcac13c485e568f9`.

The inherited budgets are the task's zero filter/sort calls for checkbox changes
and idle selection, one footer/action update per range, and the acceptance
contract's 200 ms interaction feedback target. No percentage regression allowance
is introduced. The old checkout was rebased onto current Main before measurement.

The full filtered/sorted render input is saved before pagination. The visible
index and source multiplicities preserve partial projections and raw ID aliases;
selected-source sorting/search remains deferred to explicit copy/export/details.
The source array identity guards replaced data. Row-only edits mark both table views dirty. The next selection-view read
revalidates the current filters once, as allowed by the task’s stale-data safety
exception; subsequent reads use the new index. This may occur on the first tick
after an edit when the selection bar was closed. The footer retains its original
render scope. The old per-row CP checkbox listener is removed so an edited row
still uses the single delegated handler. Context-menu selection remains synchronous and requests its usual render.
Endeksmatik uses exactly one **visible** order even when other selections are
hidden. A total-Set-size early exit would change the existing behavior and was
therefore rejected. The licensing atlas retains its separate full calculation for multi-row actions.

Checkbox changes update the Set and clear a prior cell selection synchronously.
Only footer/action effects are coalesced. The existing range module still emits
individual changes so its other table consumers keep their selection behavior.
The bar's existing 700 ms timer now reads only tab and selection size; render
completion explicitly refreshes filter/search badges. Full snapshots are taken
only for the open details panel and explicit actions, never an idle timer.

## Validation

RED source-contract tests were run before implementation; they failed as expected.
Regression coverage includes 4,096 mixed-ID combinations, duplicate partial rows,
sort equivalence in both directions (including stable ties and blank values),
200 real `applyRange` changes with synchronous state and one effect flush,
stale source replacement, and visible-single Endeksmatik gating.

## Measurement

Decision: **FAIL** against the original L2 budgets. See [RESULTS.md](RESULTS.md)
for all 12 final samples and medians: range paint is 338/450 ms, above 200 ms;
retained heap after explicit actions is approximately 7 MiB higher per table.
The PR remains a draft. No budget waiver, merge, TEST or STABLE is implied.

The real application is served from an isolated temporary demo data root. Source
Excel has 30,000 synthetic orders. Three alternating Main/candidate pairs use
fresh browser contexts, the same backend/fixture/runtime, Priority sorting and 200-row pages.
Main serves its original selection scripts through local Playwright routes;
candidate serves the working-tree files. No production data or upstream calls
are used. Chromium web results do not establish Windows/Electron cold-start or
SMB performance. Native shell/server/worker protocols are unchanged.

## Final verification status

- 26 relevant test files / 190 tests passed after the runtime changes; the
  corrected selection-bar mock then passed its 11 tests.
- One full `npm test` invocation planned 1,399 files in 10 batches. It stopped
  at batch 2 on eight outdated DOM mocks/source expressions. The unrun batches
  were continued using the unchanged runner plan, without repeating successful
  batches. Two further fixed-length/source-expression failures in batch 4 and
  one missing mock method in batch 5 were corrected and rerun with focused tests.
  All 1,399 files were executed; corrected-file reruns and batches 6–10 passed.
  **The original npm command exited FAIL; it is not presented as a green exit.**
  Raw logs are in [test-logs](test-logs).
- `release:notes:validate`: PASS (7 pending changes). `i18n:check`: zero new
  missing strings, zero baseline entries. The i18n baseline is unchanged.
- Real Buyer Log with synthetic data passed 23 Orders and 24 CP UI checkpoints,
  including trusted Chromium click/Shift-click, filters, details, clear/undo,
  both languages, programmatic clear, row-only CP refresh and the single-visible
  Endeksmatik rule. See [ui-validation.json](ui-validation.json). Screenshots
  show the actual post-change demo UI; no product visual change is claimed.

## Measurement validity

The final series waits for background preparation, closes the automatic release
notes dialog, and verifies that hit-testing reaches the actual row checkbox.
An earlier series was obscured by that dialog and was excluded from visible
latency acceptance. Other exploratory attempts were also excluded. All final
raw sample values, trace timestamps, operation counts and source/fixture hashes
are in [measurements.json](measurements.json).

The five memory checkpoints replace the render-owned caches after an explicit
snapshot, so canonical/priority caches are present on both variants. Hidden
checkbox-filter eligibility retains counts, with record references reused from
the actual render; it does not retain an additional hidden projection dataset.
The remaining memory increase comes from the indexes. Sampled pre-GC heap
maxima are not continuous RSS/physical-memory peaks.

The runtime source hashes are unchanged by the later test, CI and evidence-only
commits. The new hot-path regression test is included in the ordinary PR checks.
Neither this document nor a green unit-test result waives the failed L2 gate.
