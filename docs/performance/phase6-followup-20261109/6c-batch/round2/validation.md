# Final validation and reproduction

The final product/test sources are current Main
`2cb965f74af807fcf94231644e01ca2c671ba656`, brought in by normal local merge
`a09786753da1e0476f656ea9b967957ac81c946e`. Temporary candidate product files were
restored **before** final regression. Subsequent changes are evidence only.
Final PR head and its actual CI run are recorded in the single R2 comment on #952.

## Executed checks

| Check | Actual result |
| --- | --- |
| Current-source HTTP WAL pairs | 12 complete processes / 24 samples / 12 comparisons; fixture/logical oracle/reopen equality; strict bytes **FAIL 11/12**, one equality |
| Offline raw WAL/journal analyzer | PASS all assertions, checksums, event IDs/HLC, ordered patch/owner/actor/subfields and exact field accounting; this does not make the byte gate PASS |
| Original meaningful adapter contracts, direct invocation on Main | **RED: 5 tests, 0 PASS / 5 FAIL / 0 SKIP / 0 CANCEL** |
| Same contracts on temporary candidate | **GREEN: 5 tests, 5 PASS / 0 FAIL / 0 SKIP / 0 CANCEL** |
| Final-source standard uninterrupted `npm test` | **1331 files / 10 of 10 batches / concurrency=4 / 225.8s / exit 0**; **9152 PASS / 0 FAIL / 65 SKIP / 0 CANCEL**, 9217 tests |
| `npm run i18n:check` | PASS: 0 new missing / 0 baseline missing |
| `npm run release:notes:validate` | PASS: existing 17 entries |
| `node --test tests/agent-instructions.test.js` | PASS, exit 0 |
| Critical diff/source review | PASS for evidence-only final scope; candidate remains rejected |

Full regression log: [npm-test-final.log.gz](npm-test-final.log.gz).
All ten batch counters: [full-suite-counts.json](full-suite-counts.json).
All 65 skip names: [full-suite-skips.txt](full-suite-skips.txt). Skips are not PASS.
No interrupted run or leftover batches were combined. This final-source full
suite validates Main-equivalent runtime, **not** the rejected adapter's missing
native/crash/resource/performance gates. Round one's candidate suite is not
substituted for this run. There was no full-suite failure or rerun in R2.

The summary parser initially expected a different completion word and failed
after the successful run. It was corrected to the runner's actual PASS line;
see `failures/suite-summary-parser-note.txt`. Raw ten-batch results are unchanged.
The sandbox HTTP EPERM failure and first analyzer assumption failure are retained
under `failures/`; the complete HTTP series was then run with permitted local
listen access. The actual successful data is not relabeled from a failed run.

## Source equality and scope review

[source-equality.json](source-equality.json) records:

- Final/current Main `resources/app` Git tree:
  `0826dc06f9cba1c095f212985b3ae8fdd465821f`.
- Final/current Main `.github` Git tree:
  `334cb553e9dd22bfb66634d6b9e46ad1ae4d8e08`.
- Actual working-tree diff against Main for product, CI, AGENTS.md, CLAUDE.md and
  PERFORMANCE_ACCEPTANCE.md is empty. No changes to primary save, routes,
  renderer/read/projection/cache, local-db/WAL/HLC/event/ACK, lease/timeout,
  sync/backup, DEFAULT_MODE, dependencies, compute or #916 motors/tests/CI.
- All **53** original first-round evidence files compared byte-for-byte against
  starting PR head and remained unchanged. No other chat's branch/commit was
  consumed. Main integration is the normal merge authorized by #952.
- Original checkout remains clean at
  `9e667430e3ac7ca30b321f06893d53f24d6ed5a3` on its original branch.

The evaluated three product files exactly match the archived candidate hashes;
`measured-source.json` and `candidate.patch.gz` reconstruct the experiment on pinned
Main. Only the allowed dispatch, CP adapter and opt-in delta adapter were changed
temporarily. The final R2 additions are solely under this `round2/` directory.
No blanket formatter or unrelated fix was introduced.

Critical self-review checked source ownership, no accidental product integration,
no clock/threshold/guard changes, full raw byte accounting, proper separation of
ACK vs flush and failed vs passing gates, synthetic-only fixtures, log integrity,
lossless compression, and no reuse of historical CI as final evidence. No
independent second-reviewer claim is made for this evidence-only delivery.

TR/EN release entry `phase6c-cp-batch-journal-20261109` and post-change product PNG
are **N/A**: the experiment is reverted and no visible behavior/text is retained.
Existing release manifest/assets are exactly Main's, including its 17 entries.

Dedicated SIGKILL/crash boundaries, five-cycle retained-resource certification,
A/A/ACK/memory no-regression matrix, one-row redo measurements and real target
Electron 44.3.0/native undo/redo/reopen are **not run**, as R2 §2 explicitly permits
after the exact WAL gate fails. They remain open and cannot be inferred from
the passing unit/regression/reopen results. Windows/SMB/OneDrive/power-loss and
enterprise multi-user capacity remain unmeasured. No release/PR merge/branch
deletion/pilot/migration or issue closure.

## Reproduce without changing production protocols

Use fresh separate worktrees at the pinned Main and apply `candidate.patch.gz` only
to the candidate worktree. Provide the repository's usual dependencies (no package
or lock changes). All harnesses live in this evidence directory. With `R2` set to
its absolute path and application roots supplied explicitly:

```sh
flock /tmp/buyerlog-performance-measurement.lock node "$R2/run-wal-pairs.cjs" /tmp/6c-r2-pairs /tmp/main/resources/app /tmp/candidate/resources/app
node "$R2/analyze-wal.cjs" /tmp/6c-r2-pairs
PHASE6C_APP=/tmp/main/resources/app flock /tmp/buyerlog-performance-measurement.lock node "$R2/adapter-contract.test.cjs"
PHASE6C_APP=/tmp/candidate/resources/app flock /tmp/buyerlog-performance-measurement.lock node "$R2/adapter-contract.test.cjs"
```

Main contract command is expected RED; candidate GREEN. Actual commands used the
application roots in `measured-source.json`/README and existing dependency reuse
via `NODE_PATH=/workspace/Buyer-Log-Desktop/resources/app/node_modules`. This adds
no product dependency. Raw captures can remain plain or losslessly gzip-compressed;
the analyzer supports both. It writes `wal-analysis.json` beside its script.

Final-source regression/static commands ran from `resources/app`:

```sh
flock /tmp/buyerlog-performance-measurement.lock npm test
npm run i18n:check
npm run release:notes:validate
node --test tests/agent-instructions.test.js
```

Source review/freshness commands from the separate worktree:

```sh
git fetch origin main
git merge --no-edit origin/main
git diff --check
git diff origin/main -- resources/app .github AGENTS.md CLAUDE.md docs/PERFORMANCE_ACCEPTANCE.md
```

Final fetch confirmed the same Main; normal merge reported already up to date.
No source changes after final regression. The final evidence commit is pushed
normally to the existing PR branch, never force-pushed. Actual final-SHA PR CI
must complete before the issue comment is posted; fast checks are not a
substitute for the uninterrupted full suite above.
