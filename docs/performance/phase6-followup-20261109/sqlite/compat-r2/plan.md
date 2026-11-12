# SQLITE-COMPAT-R2 — pre-implementation acceptance

Base Main: 2cb965f74af807fcf94231644e01ca2c671ba656. Starting draft #958 head:
87effc5c16435e199005c367abfbd34eb3a1f498. Main merged normally into isolated
/workspace/sqlite-compat-r2 worktree; original checkout unchanged.

Scope: seven contract gates only: full envelope, tombstone/delete, remote
owner/conflict, ACK versus upload, explicit base revision, receipts, persisted
uploaded/synced metadata. Production sources, dependencies and CI read-only.
Historical logs and reports remain unchanged. Production recommendation WAIT.

Budgets fixed before implementation: zero state/metadata/receipt differences
for supported deterministic traces; zero lost or double-applied events; same
expected rejection; transaction failures leave durable and observable state
unchanged; five or more open/write-or-fail/ACK/close/reopen cycles leave zero
SQLite file descriptors, open transactions, active work or retained statements.
No PRAGMA/lease/timeout/cache/queue/memory limit increases. No new large matrix.
Product runtime cost N/A (source tree must equal Main). Research adapter is
not performance accepted; historical full-read, lease, backup/platform gates
remain BLOCKED. No speedup or production durability claim from these tests.

Runtime: official Electron 44.3.0 / Node 24.20.0 / SQLite 3.53.4, backend
ELECTRON_RUN_AS_NODE=1 per runtime.json and backend spawn(process.execPath).
ZIP SHA256 8b49b9efdd73c0f467edc3c1cd5678392c384ccf224f34ff54179f736e2f384b.
Host Node separately reported for standard npm runner. Test data only synthetic.
FS: worktree .scratch overlayfs; /tmp tmpfs. Global heavyweight lock:
/tmp/buyerlog-performance-measurement.lock. No shared/network database.

Oracle: unchanged real createLocalDb; full state and every critical receipt,
pending, ACK count, conflict and SQL body/column consistency compared. Controlled
Date and UUID sources only for otherwise unavoidable generated times/IDs; no
metadata removed from comparisons. Independent explicit expected-value asserts
and SQLite-only reopen subprocesses prove storage authority. Copied pure state
transitions carry pinned source provenance; no JSON engine invocation in SQLite.

Matrix: empty/populated read; patch/batch/delete/redelete/resurrection; duplicate
including pruned event; null/0/false/empty/missing; explicit global/record/field
revision; same/different owner and composite subfields; remote conflict→resolve;
upload→ACK, ACK→upload, partial through, remote sources/receipt-only; rollback
from SQL failure and later invalid batch input; caller mutation isolation;
five handle-clean reopen cycles and durable pending/conflict/ACK metadata.

Commands: official runtime --test --test-isolation=none for unchanged original
8 gates, original 4 prototype tests, added compatibility tests and original
local-db/sync/backup regression list. All use overlay TMPDIR and shared lock.
Then final Main integration, uninterrupted resources/app npm test (all batches,
default concurrency=4), i18n:check, release:notes:validate, product tree identity,
critical diff review, normal push to existing draft #958, final-head PR CI.
TR/EN note/PNG N/A: no user-visible or production source change.
