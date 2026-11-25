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

## Collection: 20 installations (v20261125)

`tests/helpers/collection-sync-sim.js` runs 20 isolated installations (two installs of the owner, ten editors, five viewers, three users without access). Each installation loads its own copy of the real `collection-workspaces`/`collection-recycle-bin` modules (own `SERVER_DATA_ROOT`), its own real permission cache and its own real replication state. Installations only meet in one shared hub directory (SMB model: the file lease really serialises). The thin server glue (refresh permissions → edit check → local row write → publish; 5 s live poll that does not refresh permissions) mirrors `server.js` and `routes/oab-batch-routes.js`.

Seeded faults: shuffled/partial/duplicated polls, offline installations accumulating edits, a corrupt final envelope window, half-written `.tmp` files and OneDrive `<owner>-PCn.json` side files. Within an epoch each (row, field) — for `pricing`/`pricingSent` each (row, manufacturer) — has one writer, so every deviation is a lost or wrong merge. After each epoch all authorised installations must reach the hub copy within three full poll rounds, keep every accepted value, never resurrect a deleted row, keep added rows, report no false conflicts and give users without access nothing. A final quiet round must do no workspace read, replace, merge or publish.

```sh
node --test tests/collection-sync-simulation-v20261125.test.js        # 3 seeds × 120 operations
node --test tests/collection-sync-multi-device-v20261125.test.js      # targeted scenarios
BUYERLOG_COLLECTION_SIM_SOAK=1 node --test tests/collection-sync-simulation-v20261125.test.js
BUYERLOG_COLLECTION_SIM_SERIAL=1 …                                     # exact sequential replay of a seed
```

A failing seed writes its synthetic operation log and prints `COLLECTION_SYNC_SIM_REPRO`. The seed fixes the operation plan; without `SERIAL` the I/O interleaving inside one tick is real concurrency. `BUYERLOG_COLLECTION_SIM_APP_ROOT` points the same simulator at another checkout for A/B measurement.

Findings fixed in the same change (RED first, then one independent review round whose findings were also fixed RED→GREEN: base/conflicts are recorded right after the under-lease local write; price-map conflict resolution applies only the losing manufacturer keys to the current row; a view-downgraded installation keeps its unpublished local copy in `collection-replication-state.json.readonly-preserved/` before adopting; the merge-under-lease fallback is limited to envelopes ≤ 2 MB because at 30k rows / 6.7 MB it extends the hub lease by ~1.08 s against the 3 s cross-machine lease wait): concurrent publishers lost the CAS race outside the lease and waited for later polls (12 writers → 10 rounds, false "same revision, different copies" toast for 9 of 12 users); a revoked or view-downgraded editor's offline write was published by the live poll from the stale permission cache; `pricing`/`pricingSent` maps were merged as one value, dropping another manufacturer's price on every installation (server merge and client rebase).

Executed RED/TODO, not a convergence proof: with separate OneDrive mirrors a concurrently displaced publication is lost without a merge conflict (the loser's merge base is its own displaced envelope). Fixing it needs envelope ancestry (protocol work). Limits: cross-machine lock contention timing (`SHARED_WRITE_BUSY` after 3 s) is not modelled because one process serialises leases in memory; the recycle bin is per installation and is not replicated.
