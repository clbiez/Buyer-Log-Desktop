# BL-003 — checkpoint set recovery (draft; deployment prerequisites unresolved)

Status: **Implemented and component-tested; not verified for deployment. Draft PR only.** Base: `6f8eb33e820c231cb4f7189c728224ad1b58dd57`. Linux x86_64, Node v24.19.0. No live user data, merge, publication or key material used.

## Confirmed defect and correction

The audit's missing `.bak` scenario was independently reproduced in regression tests. The prior implementation copied members sequentially: it replaced the main DB, discovered the missing second member and threw, leaving an older DB alongside the newer WAL and app pointer. Fifteen of the initial sixteen new cases failed before the correction.

New snapshots record the exact three-member set with explicit existence, byte size and SHA-256. All members, manifest metadata, regular-file type and checkpoint root are validated before any live mutation. A complete restoration is staged and verified. A durable rollback intent binds the DB, `.bak`, WAL, `current.json` and updater `state.json` to their before/after byte identities. Recovery verifies every staged member and live generation before resuming; unrelated changes stop recovery rather than being overwritten. The intent and checkpoint remain until the five targets agree. A restart replays the intent before backend loading.

Updater JSON writes now fsync temporary bytes, atomically rename with bounded transient-lock retries, and sync directories where supported. They never unlink an existing valid pointer/state merely to bypass an antivirus/rename lock. Trial state/checkpoint is durable before its pointer changes, so interrupted activation has a recoverable trial.

Live health-timeout/load failure now requests rollback and uses graceful `app.quit()`. It never restores DB files beneath the running trial backend. The next primary launcher performs recovery before requiring main.js. Late health acknowledgments cannot erase a requested rollback checkpoint.

## Independent review finding and writer-start protocol

One independent reviewer found that `watchdog.json` is diagnostic metadata: watchdog shutdown removes it before the server child exits. Its absence alone therefore cannot prove quiescence. The correction adds a small, token-bound durable trial-backend ledger. The watchdog registers its PID before spawning and the exact child PID before that child can open persistence. The very first server entry-point statement waits for its exact token/parent/child registration. Missing or invalid registration fails before importing persistence. The ledger survives diagnostic runtime deletion and is removed only after recovery or health completion.

Tests include an actual live orphan child after runtime-file deletion: rollback is BUSY while that PID exists and succeeds after it exits. Abrupt process termination after WAL replacement is also exercised. PID reuse can conservatively block recovery; this code never kills an unrelated process to resolve that ambiguity. The local portable DB must have exclusive launcher/backend ownership during activation/recovery; arbitrary external filesystem writers are outside this protocol. This is separate from BL-002 file-lease enforcement.

## Compatibility and deployment blockers — do not merge/publish as complete

1. **Persistent bootstrap migration is required.** A managed app-core/server mini-patch does not replace the already installed persistent launcher. Old bootstrap code would still execute unsafe rollback. Ship a complete signed bootstrap/installer migration first, with an explicit compatible bridge plan. A future release can then advertise a higher `minimumUpdaterVersion` (for example 1.1.0). This PR deliberately does not change publication, key policy, updater versions, or manifests blindly.
2. **Old in-flight trials fail closed.** Trials created before the writer-start protocol have no durable identity proof. They return `UPDATE_DB_ROLLBACK_LEGACY_UNVERIFIED`, preserving all live files/checkpoints. Existing real staged app cores whose server entry lacks the startup gate are rejected before activation with actionable TR/EN `UPDATE_RECOVERY_PROTOCOL_REQUIRED`. Synthetic lifecycle-only cores with no backend remain valid. This is an explicit compatibility boundary requiring an approved recovery/bootstrap migration before deployment, not a silently compatible upgrade claim.
3. **Legacy checksum provenance is limited.** Old schema-1 checkpoint member lists can be structurally read under a known new writer-start protocol, but their original digests cannot be reconstructed retrospectively. A successful such recovery records `rollbackLegacyCheckpoint:true`. An actual old activation without writer fencing is still blocked as above.
4. **Actual Windows/NTFS validation is outstanding.** Synthetic EBUSY and ENOSPC tests do not certify Windows antivirus locks, directory durability, process-tree shutdown, suspended processes or real power loss. Test the full signed installer, failed trial, restart and copied portable installation on Windows before asserting compatibility.
5. **Real native visual evidence is outstanding.** [CLAUDE.md §4.2](../../CLAUDE.md) requires: “Dosya ... değişiklik uygulandıktan sonra çekilmiş gerçek Buyer Log ekran görüntüsü olmalıdır.” A Linux component test cannot provide a genuine native launcher rollback screenshot. No unrelated shell image, fabricated dialog or component mockup is substituted. Pending TR/EN release notes and the genuine post-change native screenshot must be added in this PR before release readiness.
6. **Trial-edit policy is unchanged.** Rollback restores the activation checkpoint, as before. This does not certify preservation of acknowledged business edits or sync arriving during a failed health trial. Actual trial-write/quiescence behavior and its approved policy must be validated; no new financial/domain semantics were introduced.

Proposed release note, to be paired with genuine native evidence after those prerequisites:

- TR title: **Güncelleme geri alma işlemi veri ve uygulama sürümünü birlikte kurtarır**
- EN title: **Update rollback recovers data and application version together**
- TR body: **Veritabanı, yedek ve WAL dosyaları değiştirilmeden önce bütünüyle doğrulanır. Kesilen geri alma işlemi, yerel sunucu açılmadan önce aynı checkpoint ve uygulama sürümüne tamamlanır.**
- EN body: **The database, backup and WAL are fully validated before replacement. Interrupted rollback resumes to the same checkpoint and app version before the local server starts.**

## Verification

- **Passed:** `node --test tests/updater-rollback-integrity.test.js tests/update-trial-backend.test.js tests/update-json-store.test.js` — 36 tests, zero failures/skips.
- **Passed:** `npm test -- updater launcher portable-copied update-trial update-json watchdog desktop-update-restart-shutdown` — 91 tests across 11 files, zero failures/skips. Includes existing updater success/failure/retry, copied portable core rebinding, single-instance ordering and watchdog-parent death tests. Synthetic fixture cores now include the actual trial helper instead of bypassing the new compatibility gate.
- Covered: missing second/third member; same-size corruption/truncation; directories/symlinks; explicit absence; every file/pointer/state interruption; real abrupt child exit; concurrent external generation conflict; disk-full staging/fsync; exhausted rename lock retries preserving old state; corrupt manifest/intent; deferred live rollback; late health acknowledgment; live orphan PID after diagnostic metadata deletion; mandatory startup token/parent/child identity; old-protocol fail-closed behavior.
- **Not executed:** full app regression on this independent branch, actual Windows/Electron/NTFS, real installer/bridge migration, Excel/Outlook/corporate/shared-storage integration and production trials. The existing root execution record retains the known unrelated full-suite failures; no green full-suite claim is made.
- Raw synthetic logs: `/workspace/buyer-log-execution-evidence/bl003-red.log`, `bl003-green.log`, `bl003-final-focused.log`.

## Rollback and operator safety

No local JSON/WAL database format or business formulas change. Schema-2 checkpoint metadata and writer ledger are additive. When no recovery intent or trial exists, code can be reverted with the complete bootstrap/server bundle under the normal approval process.

**Do not run an older launcher or delete the intent/checkpoint while rollback is interrupted.** The old launcher ignores the journal and could open a mixed generation. Keep the matching new recovery code, stop the recorded writers, finish/verify recovery to a coherent file set and app identity, and only then consider reverting. Conflicting/corrupt intent or payload fails closed and needs operator investigation against trusted backups; no automatic destructive repair is attempted.
