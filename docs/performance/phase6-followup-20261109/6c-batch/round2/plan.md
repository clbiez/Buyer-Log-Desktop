# 6C-BATCH-R2 — pre-measurement plan

PR #957 remote head verified: `9c1ce5e32497d379ff29b43ec3d146c3bf1d71b9`.
Current Main: `2cb965f74af807fcf94231644e01ca2c671ba656`.
Separate worktree `/workspace/Buyer-Log-6c-r2`; normal local merge of Main
completed before this plan. Original checkout/branch and round-one files stay
untouched. Local branch is pushed only to the existing PR branch, without force.

Read #952 common/R2 instructions, first [6C-BATCH] report, AGENTS.md, CLAUDE.md,
PERFORMANCE_ACCEPTANCE.md, original plan/summary/WAL diagnosis/patch/hashes.
Source reconciliation: the three allowed product files match original Main;
local-db.js and hlc.js are unchanged between archived candidate and current Main.
Only the archived three-file adapter patch will be temporarily evaluated, after
checking its current context and exact hashes. No protocol/clock change.

First gate: **total raw appended WAL bytes must not increase for the same
logical events**, with unchanged event count/order/actor/owner/subfields and
receipt/replay semantics. No tolerance, byte subtraction, metadata suppression,
sleep/throttle, HLC manipulation, threshold or lease change is authorized.

Reuse the original synthetic HTTP fixture (seed 952, 1000 rows, 2026-11-09),
operation/oracle, real route→IAM→primary JSON→CP→delta→local WAL. Three alternating
Main/candidate pairs at 100 and 1000 rows; cold/warm remain separate. Each arm
has its own fresh process/data root, Node 24.19.0/Linux/local disk/concurrency=1.
All heavy work serialized with `/tmp/buyerlog-performance-measurement.lock`.
Store actual appended UTF-8 WAL chunks (including all document events), physical
append/fsync/lease counts, ACK and durable-flush timings, full CP journal,
fixture and source hashes. Verify raw lengths/checksums and decompose field
widths offline: HLC counter, wall/node, event ID/time, patch/owner/subfields and
remaining JSON structure. Diagnostic accounting never replaces raw totals.
Preserve failures and every sample. Do not derive p95.

If the zero-increase gate cannot be guaranteed inside the adapter boundary,
stop the expensive downstream acceptance matrix as #952 R2 §2 explicitly
allows. Explain the unchanged stampOperation/queuePatches mechanism and measured
byte/% cost separately from CPU/flush benefit. Return BLOCKED, restore all
product files, archive the evaluated patch/hashes. Memory/ACK A/A, SIGKILL,
five-cycle resource and real native undo/redo stay explicitly unpassed; no
accepted tradeoff is inferred. No new product feature/release note/PNG then.

If WAL passes, the original budgets remain: no repeatable ACK/flush/CPU/loop/
peak/retained-resource regression, exact independent oracle, 1/100/1000 three
alternating pairs plus controlled A/A for suspicious differences, crash boundaries,
five resource cycles, actual target Electron/native undo/redo/reopen and stale
owner/revision safety. No implementation scope expansion.

Final delivery: current Main normal merge; targeted checks and standard
uninterrupted npm test (all batches/default concurrency=4), i18n/release notes,
critical diff/source equality and final-head real PR CI. Preserve round-one
evidence byte-for-byte. Only one final [6C-BATCH-R2] comment on #952; #957 stays
draft unless all gates pass. No PR merge/release/branch deletion/pilot/migration/
issue closure. Risk P1 for rejected experiment; evidence-only final runtime N/A.
