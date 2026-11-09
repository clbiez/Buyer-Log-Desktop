# #952 · 6C-BATCH-R2

Delivery **BLOCKED**; evaluated candidate WAL gate **FAIL**; final product runtime
**N/A**, identical to current Main. Existing draft PR **#957** is reused. The
first report, budgets and evidence remain byte-for-byte unchanged. This round
does not complete broad 6c or remove primary JSON/dual persistence.

## Sources and method

Remote starting PR head: `9c1ce5e32497d379ff29b43ec3d146c3bf1d71b9`.
Base Main: `2cb965f74af807fcf94231644e01ca2c671ba656`.
Separate worktree `/workspace/Buyer-Log-6c-r2`, local branch
`perf/phase6c-cp-batch-r2-local`, pushed to the existing remote
`perf/phase6c-cp-batch-journal-20261109`. Normal local merge brought in current
Main before measurement; no rebase/force-push, PR merge or other chat's branch.
Control worktree: `/tmp/buyerlog-6c-r2-main`, detached at the pinned Main.

[plan.md](plan.md) was written before the experiment. Current source was checked
against the archive before applying its three-file patch; all three evaluated
source SHA-256 values exactly match round one's candidate. Read-only local-db,
HLC, routes, renderer, package and test runner were unchanged.
[measured-source.json](measured-source.json) pins the merged source commit, base,
exact file hashes and target runtime; [candidate.patch](candidate.patch) is the
reconciled complete product patch. The patch was applied only temporarily and
all three product files were restored after rejection.

Linux/local temporary filesystem, Node 24.19.0, HTTP concurrency=1; environment
details in [environment.json](environment.json). One machine per series. The
current series and historical timing samples are **not pooled**. Same original
synthetic fixture hash:
`62c11497340bca91621c02cdfafb1eb8ccd12ddc162376eaa759d820de552ce6`.
No real accounts, PLM data, shared-folder data or credentials were used.

Three alternating Main/candidate pairs at each of 100/1000 rows: **12 complete
fresh-process HTTP runs, 24 cold/warm samples, 12 comparisons**. Execution order
is recorded in [pairs/execution-order.json](pairs/execution-order.json): M/C,
C/M, M/C for each size. Cold means the first write after login/refresh/startup
maintenance in a fresh process/root; not OS-cache-cold or native startup.
The original equal startup-maintenance settling wait is preserved in both arms;
no artificial delay/clock adjustment is inserted into the measured event path.

The real route→IAM→primary JSON save→CP adapter→delta store→WAL runs with process
instrumentation only in this evidence harness. Primary API→ACK and explicit
durable mirror flush completion are measured separately. WAL capture happens
after successful physical writeFile. Full UTF-8 chunks and complete CP journals
are retained losslessly as `.wal.gz` / `-journal.json.gz`; decompressed hashes
and original byte totals are checked by the analyzer. Compressed file sizes are
**not** acceptance metrics. No failed arm is spliced into the completed series.
The initial sandbox `listen EPERM` failure is preserved in [failures/](failures/).

## Result and equivalence

See [decision.md](decision.md) for the narrow-boundary proof, actual byte/% cost,
CPU/flush benefit and rejected alternatives. [wal-analysis.json](wal-analysis.json)
contains all pair deltas, per-field accounting, counter histograms, medians and
raw sample references. [wal-analysis.log](wal-analysis.log) is its concise output.

**11/12 raw byte deltas are positive; one is zero. Every delta is exactly the
HLC counter-width delta; every non-counter delta is zero.** Main counters are 0;
candidate counters reach 31. This timing-dependent representation cost cannot
be guaranteed away at the allowed adapter boundary. Budgets remain unchanged.

All comparisons match the original fixture/operation, primary ACK, persisted CP
business-record and ordered logical event/receipt hashes. Within every process,
reopen/replay is deeply equal, including actual UUID/HLC and receipt flags. The
analyzer also validates raw WAL checksums, journal checksums, uniqueness and
WAL→journal event identity, actor/patch/subfields/clock mapping. Cross-process
logical comparison validates generated UUID/time/clock shape and compares ordered
patch/owner/actor/subfields, normalizing only independently generated timestamp
content as in the original oracle. This logical comparison never alters raw WAL
totals. [compression-proof.txt](compression-proof.txt) proves identical analysis
before/after lossless compression.

The first analyzer falsely assumed raw subfields always equal journal subfields.
Unchanged `local-db.normalizeSubfields` omits a mask if its dates field was removed
as a no-op from the effective patch. The analyzer was corrected to validate this
existing rule on **both** arms; no product change or weakened equality. The failed
assertion log is retained. The physical raw bytes, including such masks, remain
fully accounted for.

Original meaningful adapter tests were relocated here with only application-root
resolution adapted. Direct invocation reproduces **Main RED: 0 PASS / 5 FAIL**,
**candidate GREEN: 5 PASS / 0 FAIL / 0 SKIP / 0 CANCEL**; see
`contracts-direct-*.log` and `contracts-direct-status.json`. They cover metadata,
no-op, owner-denied valid-row preservation, delay/error/rollback, two local writers,
duplicate delivery and real patchOrderOverrides 1/100/1000, primary-save failure
and shadow-error isolation. An earlier `node --test` invocation reported only a
file-level aggregate; those logs remain but are not used as five-test evidence.
HTTP also retains repeated IDs, mixed fields, false/0/null/empty, CAS/partial/empty
ACK and normal reopen checks. SIGKILL/crash-native/retained-resource claims do not
follow from these successes.

## Acceptance status

| Gate | Round one | Round two |
| --- | --- | --- |
| Strict raw WAL nonincrease | FAIL 12/12 affected observations | **FAIL 11/12**, one equality; exact counter-only accounting |
| CPU/flush and CP transaction reduction | Observed large benefit on old source | Current-source benefit measured separately; see decision table |
| 1-row cold total, warm ACK, peak/retained memory no-regression | Open; no A/A | **Unpassed**, stopped under R2 §2; all measured ACK/loop/heap/RSS remain in raw files |
| Logical event/receipt/primary parity and normal replay | PASS for measured cases | PASS for measured cases; raw checksums/actual identity verified |
| Dedicated crash/SIGKILL boundaries | Open | **Not run**, downstream gate after failed WAL |
| Five-cycle cleanup/retained resources | Open | **Not run**, downstream gate after failed WAL |
| Real native undo/redo/reopen, stale owner/revision, selection/#916 | Open | **Not run**, downstream gate after failed WAL; unit tests are not native acceptance |
| Windows/SMB/power-loss/enterprise capacity | Unmeasured | Unmeasured |
| Product integration | Reverted | Reconciled/temporarily evaluated, then reverted |
| TR/EN release entry/real PNG | N/A after revert | **N/A**: no retained product behavior/text; existing entries unchanged |

See [validation.md](validation.md) for final-source regression/static checks,
source equality, critical diff review and reproduction commands. Final-head CI
is linked in the single [6C-BATCH-R2] issue comment after the push. Historical
CI or the round-one suite is not reused as final-head evidence.

Only `round2/` is newly owned. Original checkout, round-one files, other two work
areas, agent/program contracts and protected production/test/CI sources remain
unchanged relative to Main. No release, TEST/STABLE, PR merge, branch deletion,
pilot/migration, mode/feature/threshold change or issue closure.
