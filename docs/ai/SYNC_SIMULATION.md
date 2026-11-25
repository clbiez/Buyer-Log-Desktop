# Reproducible shared-folder simulation (P3)

`tests/helpers/sync-sim.js` runs actual local DB and sync-settings engines on ten isolated installations, each with its own shared-folder mirror. Seeded replication delays and reorders files, duplicates deliveries, exposes partial temporary files and injects OneDrive conflict copies and corrupt final JSON. No real user data or network provider is accessed.

After all files are delivered, exactly two sync rounds must converge. Assertions cover shared digests, final causal writes, ID-based email merge/tombstones, private fields remaining local, contiguous source checkpoints and a further round downloading/scanning zero packages while skipping all settled peer directories.

Run from `resources/app`:

```sh
node --test tests/sync-simulation-v20261009.test.js
BUYERLOG_SYNC_SOAK=1 node --test tests/sync-simulation-v20261009.test.js
```

The main test covers 10 devices / 300 operations for three seeds, with a 15-second timeout on non-Windows platforms and a 90-second timeout on Windows. The Windows hosted runner exceeded the aggregate 15-second limit while doing real mirrored file I/O; this is a bounded completion guard, not an application latency benchmark. Every seed, operation count and convergence/privacy/checkpoint assertion remains required. The optional soak executes 20,000 operations. A failed random scenario writes the seed and synthetic operation log for replay.

P3 records three executed RED/TODO counterexamples for a separate production fix: a partial foreign capability head takes sync offline (4403); scoped legacy payload retains its old journal checksum (4404); legacy transport lacks coverage for preceding local-only sequence gaps (4405). These TODOs are not proof of convergence under those conditions. Concurrent same-field writes currently intentionally produce conflicts; separate fields and causally ordered writes must not.

Validation on Node 22: targeted file 4 pass / 1 skip / 3 TODO, ~6.1 seconds; soak 5 pass / 3 TODO, ~26.7 seconds; full suite 6,271 pass / 66 skip / 3 TODO, zero ordinary failures. The reviewer-requested no-scan assertions also pass.

## Separate transport fix after P3

The three counterexamples are now ordinary passing regressions. Foreign malformed heads fall back to actual package scanning without taking the device offline. Legacy events get a checksum of the filtered transport and additive gap coverage; first/last event sequence meanings remain unchanged. A retry validates/replaces an invalid or outdated own legacy file before closing its journal entry. Coverage is validated before any cached DB mutation, including batches/packages, and a duplicate event can durably supply new receipt coverage without reapplying its fields.

The fix does not rewrite historically uploaded events automatically. Final validation: 6,278 passed / 66 skipped / zero failures or TODOs; targeted simulation 11 passed / 1 soak skip. Existing WAL, checkpoint and idempotency tests pass.

A restored old pending retry cannot reduce the existing publication frontier; a delayed genuine published event still blocks the checkpoint until delivered (seed 4409).

## Pricing Desk multi-user simulation (2026-11-25)

Seeded tests for quotations with 20 users / installations; failures write the seed and synthetic operation log (`PRICING_SYNC_REPRO=...`, override the folder with `BUYERLOG_PRICING_SIM_FAILURE_ROOT`). Run from `resources/app`:

```sh
npm test -- pricing-multiuser-concurrency pricing-delta-merge-convergence pricing-collection-projection
BUYERLOG_PRICING_SOAK=1 npm test -- pricing-multiuser-concurrency pricing-delta-merge-convergence pricing-collection-projection
```

- `pricing-multiuser-concurrency`: one server, 20 users with stale views (line PATCH / batch / approval exclusivity / structural PUT); 20 child-process installations sharing one data root under the non-blocking HTTP lease policy.
- `pricing-delta-merge-convergence`: `mergeRequestCopies` commutativity, idempotency, absorption and (content) associativity across 20 gossiping replicas; 20 real local DBs with reordered, delayed and duplicated deltas plus a retention tombstone.
- `pricing-collection-projection`: owner-side Collection projection with delayed visibility; a cell never moves back to an older value.

The peer channel (`shared-sync-policy`) does not carry `store:quotations.json` in this version; the merge path is exercised through the local DB remote-delta engine. Line and manufacturer display order may differ between devices after three-way concurrent additions; content converges.
