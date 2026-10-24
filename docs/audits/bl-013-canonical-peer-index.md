# BL-013 canonical peer propagation

Status: implementation and focused/native acceptance complete; final integrated full regression and merge are pending under the user's instruction.

The existing canonical order/model/colour key now selects peer rows through lazy per-array indexes. Authoritative replacement naturally creates a new cache entry; weak keys avoid retaining obsolete arrays. Identity updates have an explicit update API, and same-length in-place membership replacement must invalidate. The current identity columns are readonly and the scoped source replaces authoritative projection arrays. Only candidate keys are revalidated on lookup; stale candidates cannot mutate a different canonical line.

Editors and date inputs carry canonical and owner identity. History captures that identity before paste aggregation and resolves it against the current projection, so reused display IDs cannot retarget Undo/Redo. Batch history, paste and note saves refresh CP/Orders once per command. Notes retain their draft on changed owner or failed acknowledgement; late responses cannot populate another user's projection. Existing hidden-tab deferral is preserved.

One bounded independent source review found that special delivery/checklist menus bypassed the common editor guard. Delivery now uses the same commit function, including peer sync and Undo; checklist status, component and evidence paths carry/recheck identity across assistant readiness and deferred dialog actions. Readonly legacy evidence remains readable. Real menu-handler RED cases, component-dialog cases and the native scenario verify this correction; the reviewer did not execute tests.

## Controlled performance result

Two projections each contain N rows, with matching partials and model/colour decoys. Both actual before/after functions use the full existing canonical normalization and note metadata, with rendering disabled. Full output hashes match for every size. This is a controlled Node CPU measurement, not desktop frame timing, and differs from the original audit's simplified exact-identity fixture.

| Rows per projection | Scan p50 / p95 ms | Index cold ms | Index warm p50 / p95 ms | Retained heap delta MiB |
|---|---|---|---|---|
| 1,000 | 6.565 / 6.900 | 5.266 | 0.022 / 0.057 | 0.72 |
| 10,000 | 64.225 / 64.859 | 46.762 | 0.019 / 0.029 | 7.05 |
| 30,000 | 191.410 / 194.878 | 133.561 | 0.019 / 0.025 | 20.68 |

Each warm distribution has15samples after2warmups. Cold construction remains O(N) and consumes memory; it is reported separately rather than hidden in warm averages. The retained-heap measurement is a post-GC delta, not total allocation or peak memory. Representative browser/export/corporate benchmarks remain BL-019.

## Verification

The final related group has29files,229pass,0fail,0skip. Earlier focused groups overlap and are not summed. Actual full Buyer Log in Windows Edge uses two isolated synthetic orders and real HTTP/storage: UI note and manual price edits, date edit, Undo/Redo, two-row native paste planner, delivery and checklist dropdown writes, server echo, and no persistence after stale client identity/owner. Hidden Orders stays uninitialized until opened. Screenshots are genuine TR/EN saved-note UI and were inspected.

An initial popup click ran immediately after automatic table scroll; the existing scroll-close policy closed the menu. The fixture now scrolls and settles two frames before opening it. Source tests also needed their function extractor to skip default-parameter braces, without dropping existing assertions.

See bl013-canonical-peer-index-20261025.json for exact source hashes and limits. No full regression, final merge or TEST/STABLE/manual publication is asserted. The wider project remains open.
