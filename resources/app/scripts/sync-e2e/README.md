# Real-browser SYNC acceptance

Manual Linux acceptance driver; **not** part of `npm test`. Uses production Express,
IAM, file leases, workspace storage, replication and SSE, with synthetic accounts
and separate roots. Playwright controls a separate BrowserContext per user. There
are no mocked success responses or calculation engines. The fault proxy either
forwards a real response, delays it or cuts the connection.

The existing BL019 fixture is Windows/Electron-specific, has ten HTTP identities,
and no operation ledger or 30-minute multi-context driver. This extension reuses
its isolated-root and explicit source-seeding approach. `transit-entry.cjs` uses
the existing `BL_TEST_SEED`/`__blSeedAsas` hook, with one order, rather than rerunning
the historical 30,000-order benchmark. Financial expectations retain the BL017
contracts and golden vectors. Existing mirrored-filesystem protocol simulations
remain separate historical evidence; this runner does not pretend to be SMB or
OneDrive.

Install the app's existing dependencies first. Supply an installed Playwright
module and Chromium; do not install them into the application release bundle.
In the recorded cloud environment:

```bash
npm install --prefix /workspace/scratch/bl-playwright-aligned --no-audit --no-fund playwright@1.62.0
export BUYER_LOG_PLAYWRIGHT_MODULE=/workspace/scratch/bl-playwright-aligned/node_modules/playwright
export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
# From resources/app. Each --root must be NEW; existing evidence is never reset.
node scripts/sync-e2e/run.cjs --users=3 --backends=3 --seconds=65 --seed=20261025 --root=/tmp/bl-short-new
node scripts/sync-e2e/controlled.cjs /tmp/bl-controlled-new
node scripts/sync-e2e/transit.cjs /tmp/bl-transit-new
```

`BL_E2E_SCENARIOS` selects controlled scenarios by regular expression, allowing a
new targeted check without repeating unrelated scenarios. `BL_E2E_PORT` selects
the first controlled backend port (default 6530). Daily-load ports start at 6520;
transit acceptance uses 6550. Do not overlap tests on the same ports. Readiness
requires the **new process's** SERVER_READY log, rather than accepting an existing
listener as the test backend.

Final validation, after all development and focused checks:

```bash
npm test > /tmp/bl-full.log 2>&1
# Only after the full suite exits; never run both loads on the same machine.
node scripts/sync-e2e/run.cjs --users=50 --backends=50 --seconds=1800 --seed=20261025 --root=/tmp/bl-final-new
```

Backends start gradually with the users. `--backends=50 --users=50` models fifty
independent local installations; the extra moderator has a separate authenticated
browser context on device zero. `--backends=3 --users=50` would mean three replicas
and fifty browser identities and must not be described as fifty desktop devices.
The measured interval starts only after every user has completed a real UI edit.
Warm-up and draining are separate. A 7.5 GiB resource guard in the recorded 8 GiB
container stops a capacity-limited attempt; that guard is a **test environment
limit**, not a product SLO or a successful 50-user run. A smaller explicitly named
run can be made after the limit is measured; it cannot certify fifty users.

Artifacts in each root:

- `manifest.json`: synthetic identities, requested topology, source commit, seed.
- `operations.jsonl`: independent intent, actual requests/acceptance, UI state,
  local draft, conflicts, failures, explicitly invoked application retries, peer
  visibility, moderator changes, and per-minute active counts.
- `resources.jsonl`: separate driver, Chromium renderer, browser and backend CPU
  ticks/RSS/disk I/O, plus container memory and CPU throttling observations.
- `result.json` or `failure.json`: measured result or explicit failed/capacity
  outcome. HTTP byte counts exclude still-open SSE streams and setup traffic.
- `reconciliation.json`: latest legitimate accepted field values, fixture fields,
  unique IDs, owner relation, all durable replicas, UI convergence, cold reopen.
- `durable-device-*.json`, screenshots, Playwright traces and each backend's log.

An HTTP 200 with `conflicts` is a partial result, not universal acceptance.
`replication` is recorded independently of local acceptance. A lost response is
investigated against real durable data. Normal retries of the test framework are
zero; deliberately invoked application retries and explicit manual SYNC rounds
are separately logged. The native Collection contracts use row CAS on one backend
and a three-way field merge between replicas. A focused two-moderator HTTP CAS
check uses two authenticated BrowserContext request clients; it is labelled as a
focused HTTP check, rather than UI-click coverage.

An active editor defers visual refreshes while incoming unrelated data and its baseline still advance. Unsubmitted typing, secured browser drafts and server acceptance have distinct states.
At final quiescence users focus the non-editing table (not the search input), then actual rendered DOM convergence is checked without
forcing a data reload. Automatic stale-read rejection schedules a fresh read.
Failed runs and driver corrections are retained in the audit; no automatic test
rerun hides them. Real twelve-hour signed-session expiry is not accelerated;
short browser-cookie expiration/removal and ordinary session guards are separate
from that unexecuted long-expiry boundary.

Business policy remains unchanged. Existing license-card peer records have an
explicit precedence contract over a stale Master profile/contract. The audit
records a transient older-peer replay after a newer Master checkpoint and bounded
manual SYNC convergence; changing that priority requires a product decision.
No global calculation transaction, tenant model, SQL pool or WebSocket service
is introduced. No TEST/STABLE publisher, production user data, COM repair or
external corporate source is used.

Collection has its own five-second remote-file poll for recently active users, even when the bulk SYNC schedule is manual. The load driver additionally invokes real manual SYNC rounds after moderator changes. GET imports notify SSE at the actual application boundary. Both pull CAS and the normal workspace lease are used so an intervening local write cannot be overwritten by a higher remote revision. No global calculation snapshot policy is added.

Final driver checks the Chromium major/minor/build branch against Playwright metadata before use. The cloud browser is 151.0.7922.173; Playwright 1.62.0 targets 151.0.7922.34 (same branch, different security patch). Earlier 1.57/151 runs are retained as failed or scoped evidence, not silently reclassified. Matching 143 browser download was denied by enforced network policy; no bypass was used. The final driver was installed from the permitted NPM registry.

Rejected shared drafts can be explicitly discarded using the real bilingual recovery button and native confirmation. The driver logs these simulated user choices separately; it does not replace server acceptance or reset internal state to manufacture convergence.

Long-load tracing defaults to `events`: action/network events remain, continuous DOM snapshots/screenshots are disabled to avoid charging tracing traversal/rendering to application CPU. Explicit screenshots on failure, independent operation/UI-state journal and diagnostics remain. `--trace-mode=snapshots` restores the earlier heavy mode for a focused diagnosis; original failed heavy-trace attempts are retained. This does not increase operation timeouts or retry the test framework. A trace-overhead hypothesis is not a proven root cause of previous timeouts.

Native suppressed ACK records retain the original request UUID/session, so final reconciliation includes accepted writes whose response never reached the UI. Before any final UI recovery/GET imports, raw durable workspace snapshots are retained and each latest accepted intent is checked on its origin backend. Final per-minute counts derive from actual completed UI timestamps; periodic timer callbacks are separate telemetry. UI evaluation is bounded by 30 seconds and each complete action has a 60-second forensic watchdog; neither is an invented product SLO.
