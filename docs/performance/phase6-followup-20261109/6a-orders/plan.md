# 6A-ORDERS: pre-implementation screen

Recorded before candidate code or measurements, 2026-11-09.
Base Main: `d0fdb8889f188e2cc1387b0850f61a841aa7e6d5`.
Branch: `perf/phase6a-orders-thin-20261109`; isolated worktree and temporary data.

Only Orders read/projection is eligible. No CP/Overview/Collection conversion,
write/patch/store/lease changes, new pools, cache engines, dependencies or flags.
Archived #891 / `5736f3370fb55bbd62414585956ca8c53d37ce82` was read as preparation,
not as a current Orders allowlist. Its CP 32/10/0 classification is not reused.

Source screening finds `_logisticSegments` in initial status cells, partial view,
and rich/plain output. Dynamic `__CPX_` and note columns reach formula and export
readers. These are not safely removable based on visibility. A narrow isolated
candidate omits only `Priority` (deleted by buildOrdersFilters) and `_canEdit`
(unconditionally assigned false by ensureOrdersLoaded before consumers). This is
a screening experiment, not a production capability or a deployed thin DTO.
If it does not clear the benefit gate, retain no product change. Also exercise
negative controls showing why broad hidden-field deletion is unsafe.

Budgets, before implementation:

- All normalized row JSON, identity, order, values and dynamic keys equal exactly.
- First usable Orders and first full-data operation: no repeatable regression;
  positive end-to-end benefit must exceed controlled A/A noise. Parse-only or
  wire-only improvement cannot establish production acceptance.
- Compressed and uncompressed bytes must decrease; requests remain one, no
  speculative hydrate. Candidate projection work must be counted, not hidden.
- Parse/materialization/full-data CPU, heap and peak RSS: no repeatable increase.
  Five release/reload cycles must not retain growing live rows.
- Same pinned representative 30k archive/hash, machine, Node runtime, one request
  at a time; at least three alternating Main/candidate pairs. Fresh-process cold
  and repeated warm samples separate; raw results and medians preserved. A/A
  control on the same Main, no p95 from three pairs.
- An isolated rejected screen is not Electron/native or real route acceptance.
  A surviving product candidate would additionally require actual Electron
  44.3.0 workspace/preload/native Orders, CP/#916/startup, scope/revision/stale
  response, full consumers, complete standard npm test and final PR-head CI.

Use `/tmp/buyerlog-performance-measurement.lock` for heavy runs. The screen uses
the checked-in 30k fixture (archive SHA256
`5913414603984b02b1c30b87f1f9231da3718ab797a007f4bd14067ec6cd5c70`), real
parse/buildProjections/serialize functions, and no business data or credentials.
If rejected, deliver evidence-only PR; prove all product/runtime bytes unchanged,
run relevant existing regression/validators and final-head PR CI. Do not claim
full regression or production acceptance for an experiment that was rejected.
