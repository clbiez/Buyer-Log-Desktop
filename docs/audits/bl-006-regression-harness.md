# BL-006 — regression harness repairs and remaining baseline failures

Status: PR Open — [#687](https://github.com/clbiez/Buyer-Log-Desktop/pull/687); focused harness repairs implemented and verified; complete regression baseline remains red. Current PR links are maintained in `buyer-log-execution-progress.md` on the BL-001 branch. Baseline main: `6f8eb33e820c231cb4f7189c728224ad1b58dd57`; Linux x86_64, Node v24.19.0. No application code, release notes, merges, or releases changed by this package.

## Independently reproduced repairs

Before changes, `node --test tests/capacity-request-workbook.test.js tests/collection-mb-month-locale-filter.test.js tests/notes-editor-persistence.test.js tests/revision-v476.test.js` reported 23 tests: 18 pass, five fail, zero skip. After the corrections, the identical command reported 23 pass, zero fail/skip.

| Failure | Root cause | Preserved or strengthened invariant |
|---|---|---|
| Capacity workbook missing-date cache | Actual XLSX roundtrip represents formula blank as empty string | Accept only null/undefined/empty string; numeric zero and false remain rejected. Exact formula guards and populated numeric day differences remain asserted. No arithmetic changed. |
| Two MB-month filter cases | Extracted production function now requires lexical filter constants absent from VM | Load actual constants alongside the actual helper. Mixed TR/EN historical names still collapse into one canonical period facet, preserving selected filters and sorting. No duplicate test constants. |
| Note editor closes after server-authoritative preview | Harness omitted the production `renderOrders` dependency; real save handler caught that ReferenceError | Provide a render spy and assert exactly one render and a closed editor after success; zero render and preserved draft on failure. Ownership, acknowledgements, projection identity and competing edits still checked. |
| Special Code / Line | Source regex required an obsolete assignment spelling | Execute production transfer, migration, local save and serialized-data restoration using the existing source extractor. Assert both imported values and both edited/restored values; original CP source remains untouched. This is local serialization coverage, not a claimed browser restart or remote persistence test. |

The wider run exposed a sixth harness defect in a post-audit Endeksmatik test: regex literals double-escaped punctuation and searched for backslashes instead of the actual function calls/selectors. Correct escaping preserves every original source assertion. The scoped UI test passes. The complete Endeksmatik file still reports three pass and one fail: the TL import signature case below was not suppressed.

One independent reviewer found no blocking issue and confirmed that these corrections preserve their business invariants. No tests removed, broadly skipped, or converted into superficial success assertions. No financial formula/signature guard, design baseline or application code changed.

## Complete scheduling and truthful outcome accounting

The standard `npm test` command used isolated, matching TMPDIR/BUYER_LOG_TEMP_ROOT and separate APPDATA/LOCALAPPDATA roots. It scheduled 1,026 test files with default concurrency four. Batch 1 passed (2,086 pass, 60 skip); batch 2 stopped the runner (2,146 pass, six fail, three skip). The remaining files were scheduled once in the runner's original batches using `node --test --test-concurrency=4`; the ten-device simulation was isolated as required.

Across all five observed batches: **7,374 tests, 7,301 passed, eight failed, 65 skipped**. This is an aggregation of separately scheduled batches, not a successful standard-run result. One of those eight failures (double-escaped regex) was then repaired and its changed file narrowly rerun (three pass, one TL-signature failure). There was no later complete green run. Machine-readable commands/counts are in `bl-006-test-results.json`.

Remaining seven failure cases are not seven proven product defects:

- **Confirmed design inconsistency:** six contract failures in `design-token-guard.test.js` (two cases), `file-ready-notification.test.js`, `layer-system-v1037.test.js`, `status-feedback-v1038.test.js` and `tab-system-v1036.test.js`. The new Endeksmatik import CSS section adds fixed-pixel typography and raw colours. Several global suffix checks report the same additions. Fix the styles with existing tokens in an independent small UI change with genuine screenshots; do not raise baselines or loosen guards.
- **Suspected risk / unclassified fixture:** the synthetic TL workbook in `endeksmatik-import-independent-sets.test.js` reaches the strict USD model-signature path and is rejected for missing C15–C19 formulas. The fixture has no formulas in those cells. This observation does not justify weakening financial-model signature validation. Compare a safe structurally valid TL fixture with actual model-discrimination rules before deciding product versus fixture correction.
- **Skipped:** 65 existing skips remain skips, including the 20k sync soak and platform/runtime coverage. The isolated ten-device simulation reported 12 pass, one skipped soak, zero failures.
- **Not executed:** real Windows Electron/NTFS, Excel recalculation, Outlook, SMB/OneDrive and corporate integrations. Tests on synthetic Linux data do not certify those environments.

## Next action and rollback

Open this focused test PR independently of BL-001/004. Keep BL-006 in progress until the current seven residual failures are resolved and one complete supported-runtime run is genuinely green. Continue critical BL-002/003 engineering; do not let token cleanup distract from data integrity. Revert this test-only PR to restore the old harness; no data migration, runtime restart, screenshots, or release publication is required for these test changes.

Combined local validation with BL-001 and BL-004 implementation diffs passed 310 focused tests across 45 files (zero failures/skips); combined pending release notes validated 23 entries. This is additional integration evidence, not a full green baseline. No PR merged or release published.
