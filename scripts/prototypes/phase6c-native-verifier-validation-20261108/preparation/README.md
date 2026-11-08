# Native private-record durability verifier — preparation only

No candidate import, syntax check, test, server or benchmark was run. No production worktree was edited. Phase order remains 6a then 6c; no 6c service/route/source activation is included. This is not the final P1 review.

## Evidence and source pins

The exact handoff is preserved as `native-adapter-request.md`, read through git show from contribution `7652f3d294f3a530a28938eff81cbe477c5a0884`, path `docs/performance-program/contrib-committed-source-20261108/native-adapter-request.md`. Its existing native fixture and committed-source callers were also inspected read-only.

The real app was at HEAD `ca2d455e5dce97c7b1740ca3f4ba19d9bac89046` when copied. File bytes, rather than a claim that root's worktree remains fixed, identify the input:

| File | SHA-256 |
|---|---|
| local-db.js, preserved in base/ | 0809943a3c4c46a62a80fc5f42d2f85709775c33863b99087ef1ebf4472d8141 |
| shared-file-transaction.js | c97b75950ddd726ce58d73a256c0953a98987451d6165bb99112a0e93faa1881 |
| durable-file-recovery.js | ae283d148821f117e43c206f54cb1d9f8deb6d071d298b6f45a5ecbf42fd0c62 |

`native-verifier.patch` is the proposed narrow local-db delta; `local-db.js` is its adapted source copy. `MANIFEST.sha256` identifies packet artifacts. Root must reconcile source drift, review and execute later. No unrelated DB refactor, persistence format, source ownership implementation, worker or new store is proposed.

## Exact API and scope

```js
// Called only inside this same instance's active native prepare callback.
const proof = await db.verifyPrivateRecordDurability(state);
// Successful shape: { verified: true, nativeRevision: state.revision }
```

The native lease object is already passed by withFileLeaseAsync to its callback. The delta forwards that object through the existing appendOperations functional preparation argument, then binds it with the exact state/file/generation tags in an instance-private AsyncLocalStorage scope around `prepare(state)`. Scope closes in finally, including sentinel/error exits. No nested lease is acquired, no extra private-record frame is produced, and no revision is advanced by verification. Normal append preparation still creates its existing single frame only when the prepare returns its original write result.

The verifier rejects outside prepare, another DB instance, a copied state, escaped/closed async scope, moved DB file, changed native revision or lost lease. It does not expose cachedState as a new API. Parallel verification of one prepare scope rejects rather than becoming an implicit reentrant read transaction. The exact active native lease is checked through its real assertOwnedAsync method; a vacuously successful assertHeldFileLeasesAsync with no lease is insufficient.

For contribution integration later, the requested injection remains:

```js
verifyDurability: ({ db, state }) => db.verifyPrivateRecordDurability(state)
```

No caller-provided path, namespace, checksum or expected revision is accepted by the verifier. Owner/actor/IAM checks remain in the committed-source caller. This helper is a disk durability/state-equality boundary, not authorization.

## Verification sequence

1. Confirm instance/private prepare scope, original revision, current DB path and actual owned lease. Check native snapshot/current/previous-WAL generation tags against those captured before the prepare began.
2. Require no unresolved `.intent.json` in the native `.buyerlog-db-recovery` folder. Do not run a new replacement/recovery transaction inside verification. This conservative folder-wide gate may block on another native recovery intent in that folder; it never guesses an old state instead.
3. Open only the internally derived primary snapshot, previous `.wal.bak`, and current `.wal`. The primary snapshot is required. Current/previous WAL may legitimately be absent after native creation/rotation; absence is covered by the captured/final native tags. Reject non-regular/symlink members. Match opened descriptor tags to current path tags.
4. Read/parse with actual native parseJsonBuffer and parseWal. Require the current native snapshot envelope, valid native WAL checksum/version, complete members, recognized operation and required operation envelope. Replay the actual native operations in their original order. Unknown ops or a corrupt previous WAL are never accepted as an ignorable no-op/prefix. No backup snapshot fallback is performed by this verifier.
5. Strictly sync each opened file and close it; any sync/close failure rejects. Compare fresh native replay device/revision and complete serialized-state SHA-256 with the passed prepare state. `jsonSha256` uses the native incremental serializer; this is exact serialized state equality, not an ID/count-only check. Snapshot has no independently stored authenticity digest in the current format: this adapter does not invent one or claim to detect every syntactically valid alteration of authoritative disk bytes.
6. Strictly sync the recovery directory (to persist cleared intent names) and database directory (to persist member names). Repeat the no-pending-intent and generation checks, then the real lease check. After that final async lease await, synchronously recheck scope/revision and complete prepare-state hash before returning proof.

File metadata tags fence native file generations; they do not substitute for sync. Reads, successful replay, stat equality, the receipt already being visible inside prepare, or a prior optimistic in-memory update do not produce proof. In particular, an append whose handle.sync failed can leave a valid visible WAL frame: it remains unknown until this explicit path successfully validates and syncs it. Retry must keep the same transaction ID.

## Native recovery limits found in source

- `recoverPendingWrites` memoizes recoveredFolder. A later failed replacement can leave a new native intent even though an ordinary same-instance read appears to work. The verifier rejects pending intent; a fresh native recovery scope must finish it first.
- `inspectWalForWrite` repairs a current torn tail by preserving original bytes and snapshot/rotation **before** the private prepare callback. That can leave the malformed prior member in `.wal.bak`. The verifier rejects a still-incomplete previous member. It does not erase/truncate it to force success. Root must separately decide any native torn-backup repair behavior; this packet does not silently change recovery semantics.
- Native readState can restore a backup and native append can create/rotate/recover files before reaching prepare. Therefore “verifier appends nothing” means its own method is read+sync-only; it does not promise that entering the existing native transaction around a damaged database has no recovery effects. Healthy exact-duplicate tests assert unchanged member bytes/revisions.
- `applyPrivateRecords` pushes conflicts without an event-ID deduplication check, while previous WAL is replayed after snapshot. A nonempty private-conflicts payload already included in a snapshot can therefore produce a different replay state. The strict verifier will reject a warm state that differs from actual fresh native replay. This draft does not fix or hide that pre-existing native replay behavior. Contribution's document receipts and source rules need to establish which payloads it actually uses; no all-workloads equivalence claim is made.
- Current schema validators are conservative. Unknown/legacy snapshot/WAL shapes decline proof rather than being normalized silently into a certified state. Root must run existing native history/migration/WAL fixtures before deciding platform/legacy support. Actual replay, append, rollback, recovery, transport-filter and compaction bodies remain unchanged.

## Durability policy: explicit unresolved platform boundary

Current durable-file-recovery suppresses EPERM/EINVAL/ENOSYS/ENOTSUP/EOPNOTSUPP file-sync errors and **all** directory-sync errors. Shared lease metadata has its own optional-sync policy. Native WAL append strictly awaits handle.sync, but it does not itself explicitly sync the database directory for every new WAL name/rotation. Neither a successful recovery.replace nor a successful read is independently the strict proof requested by this contribution.

The proposed method uses the same native Node FileHandle.sync primitive but deliberately does **not** inherit best-effort suppression. If a file or directory cannot be synced/closed, it throws and supplies no verified result. This is narrower than changing every native writer's historical policy. It does not make a retrospective blanket claim that all existing native writes are physically power-loss durable.

Linux test preparation is not Windows/Electron evidence. Whether the supported Windows filesystem/Node/Electron build can provide the required directory/file flush guarantees is **unknown and an activation blocker**. No “Windows succeeded” branch is invented, no unsupported error is converted to true, and no new native platform bridge is added. Root must validate or explicitly design a platform-native policy before activating the dependent 6c path on that platform. A process-exit test cannot simulate storage-controller/power loss.

## Cost and proof lifetime

Verification adds no full graph clone to ordinary append commits. Private prepare gains a constant number of native tag stats and a private context. The explicit verification path does reread/parse native members, replay a transient second state and traverse serialized state hashes. Its heap/CPU/latency cost is unmeasured and is not a startup/performance acceptance claim. It reuses native parsing/replay rather than adding a second DB implementation. An optional successful read-only transaction API could later remove sentinel-driven cache invalidation, but is outside this minimal adapter.

Proof is for the exact state/lease at this point. It is not an indefinite authorization token or an atomic transaction with external IAM. The contribution still captures its immutable view and repeats authority/epoch checks before publication. Callers must await the verifier; detached verification cannot extend a completed prepare scope.

## Native tests proposed, not executed

`tests/local-db-private-durability.test.js` contains 22 bounded native cases, including healthy no-frame duplicates, scope/DB/state rejection, unbumped mutation, generation replacement, append fsync EIO with still-visible receipt, cold/lost ACK, all required sync/close errors, previous WAL validation/sync, unknown opcode/schema, pending real recovery, lease loss, a missing final newline, mutation during the final lease await and process exit before append-sync ACK. `native-verifier-crash-child.cjs` is a synthetic child process probe, not a power-loss model.

The test loader compiles an explicitly selected candidate source with real app dependency resolution only when ROOT runs it. It never changes the repository. After adoption, no source override is needed. Baseline lacks the API: missing-method failures demonstrate absence only and must not be mislabeled behavioral fault proof.

ROOT-only later command (not run):

```sh
BL_NATIVE_VERIFIER_APP_ROOT=/workspace/buyerlog-post-main-acceptance/resources/app \
BL_NATIVE_VERIFIER_SOURCE=/tmp/buyerlog-phase6c-native-verifier-preparation/local-db.js \
node --test /tmp/buyerlog-phase6c-native-verifier-preparation/tests/local-db-private-durability.test.js
```

Root should also run existing native WAL torn-tail/backup/compaction/recovery/lease tests and the contribution's native committed-source suite with this actual adapter substituted for its Linux fixture. That integration and Windows/Electron validation remain outstanding; no test result, readiness, merge or activation is claimed here.
