# 6C-BATCH — scope and budgets before implementation

Base origin/main: `d0fdb8889f188e2cc1387b0850f61a841aa7e6d5`.
Branch: `perf/phase6c-cp-batch-journal-20261109`; independent worktree and temporary data roots.
Risk: P1 (journal dispatch); no merge or release authorization.

Only `db.patchOrderOverrides` CP dispatch, a CP batch adapter and, if necessary,
an opt-in delta-store batch entry point may change. All read/projection code,
local-db, leases, sync, DEFAULT_MODE, primary JSON and route/ACK remain unchanged.
No 6a DTO or branch dependency. Full JSON save still occurs.

Measure the existing path before implementation. Synthetic batches of 1, 100,
1000 records, identical deterministic operation bytes/hash, concurrency=1.
Separate fresh-process cold and same-process warm, at least three alternating
Main/candidate pairs. Serialize heavy measurement/full suite using
`/tmp/buyerlog-performance-measurement.lock`. Retain failed runs.

Budgets: exact primary JSON/business replay/event/receipt parity; no new request,
worker, retry policy, resource limit or retained ownership. One CP WAL append,
lease and fsync per successful nonempty batch (rather than per effective row),
with event count/order/user/subfields unchanged. Total WAL bytes must not increase
for the same logical events. API-to-ACK, total flush, CPU, event-loop gap and peak
RSS/heap budgets are the measured Main values, with no repeatable regression.
If apparent noise matters, use A/A controls; no percentage tolerance or p95 from
three observations. Batch=1 and adjacent single writes must not regress.

Acceptance includes repeated IDs, heterogeneous dates/notes and tombstones,
zero/false/empty/null/missing, no-op, owner and revision denial, concurrent writers,
partial/error ACK, delayed flush, restart/replay and event-ID duplicate application.
Use the real HTTP application route/store/WAL chain, in addition to targeted
RED/GREEN tests. Primary ACK and eventual durable mirror completion are distinct.
Local synthetic results do not establish Windows/SMB multi-user capacity.

Before delivery: fetch and normally merge current main, revalidate affected source,
uninterrupted standard npm test (all batches; concurrency=4), i18n/release-note
checks, critical diff review, PR and final-head CI. Any required missing gate is
BLOCKED; unproven optimization is reverted and SKIPPED. Release note/real synthetic
PNG required if a visible product change is retained; otherwise state N/A reason.
