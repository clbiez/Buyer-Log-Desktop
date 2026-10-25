# BL-008 legacy request lease inventory

Implementation status: request lease waits are removed; final integrated full
regression is pending under the user's explicit instruction. This inventory
does not claim all synchronous data I/O has been converted or that a populated
desktop/corporate filesystem benchmark has passed.

`server.js` installs `runWithNonblockingFileLeases` immediately after creating
Express, before authentication and routes. Its separate AsyncLocalStorage scope
survives awaits and covers the legacy callbacks below. `withFileLeaseSync`
returns SHARED_WRITE_BUSY409 on contention; synchronous lease metadata retries
also fail before Atomics.wait. Async leases still serialize and await. Existing
startup and independently scheduled background work retain their prior policy.

| Source | Native synchronous boundary retained | Request behavior |
|---|---|---|
| `server/db.js` | `saveRevisioned` compatibility write | Existing guarded document mutations already own the async lease; fallback fails busy |
| `collection-workspaces.js` | Legacy owner workspace save/restore | Synchronous commit retained; contention fails busy |
| `checklist-supplier-store.js` | Attachment deletion/native attachment import | Core answers/definitions are async; attachment transaction contention fails busy |
| `user-preferences.js` | Exported sync writers used by IAM copy/restore and old integrations | Async core/workspace APIs added; legacy signatures retained with fast busy |
| `automation-recipe-store.js` | CAS save and effect guard | HTTP scope fails busy; independently scheduled background work is not silently redefined |
| `email-groups-store.js` | Compatibility save fallback | Guarded document path retains its native contract; fallback fails busy |
| `merch-calendar-store.js` | Snapshot read and restore/remove | Real Windows Edge DELETE verified409 without mutation, then retry200 |
| `lcwai-output/output-store.js` | Index append and pending effect guard | Effect/persistence ordering retained; request contention fails busy |
| `oab-job-store.js` | Receipt/pointer transaction | Existing executor, cancellation and durable receipt contract retained; request contention fails busy |
| `oab-session-store.js` | Snapshot update/read/clear | Existing CAS/compression/native mutation contract retained; request contention fails busy |
| `quotations-store.js` | Save fallback without HELD_DOCUMENT_LEASE | Existing async document guard or fast busy fallback |
| `test-reports/store.js` | Report batch/evidence transaction | Atomic batch and attachment callback remain synchronous; request contention fails busy |
| `test-reports/staging.js` | Durable import session effect guard | Owner/session transaction remains synchronous; request contention fails busy |

All listed writers import the same shared-file-transaction primitive. This is
a deliberate bounded alternative to changing every IAM/native callback into a
Promise simultaneously. It preserves all-or-nothing and response-after-commit
semantics while allowing the existing busy/retry flow to handle legacy
contention. No route acknowledges a queued Promise as a completed sync write.

The async durable writer now recovers an unfinished prior target intent through
awaited I/O and ownership fencing. An earlier broad ENOENT catch could treat a
missing payload as an absent intent and overwrite its evidence. The catch is
now restricted to probing intent existence: missing/corrupt payloads reject the
new write, preserving the original intent and target. Conflict evidence is
quarantined with the same fingerprint rules as synchronous recovery.

Four new cases cover async prior recovery without any synchronous filesystem
API, missing payload, corrupt payload and an externally diverged target. The
focused durability/lease/store group has 74 passing cases across10files, no
failure or skip. It overlaps earlier groups and is not a full suite.

Remaining measured limitations belong to broader performance acceptance:
synchronous legacy data reads/writes and compression/serialization can still
consume event-loop time, and independent background/startup recovery keeps its
existing retry policy. No real SMB/OneDrive, antivirus contention, power-loss or
populated-desktop percentile certification is asserted.
