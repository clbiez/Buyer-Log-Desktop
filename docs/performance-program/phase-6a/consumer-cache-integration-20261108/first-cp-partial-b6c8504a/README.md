# First CP: three fixed A/B pairs — preparation only

`run.py` is a new private orchestration wrapper. **It has not been executed, imported, syntax-checked, or tested during preparation.** Neither production checkout, native benchmark, observer, contract, old raw evidence, nor profile was modified. Root must review this preparation and finish the real full-suite failure diagnosis first. The current `9a294b09` suite failure is not green evidence.

The wrapper launches the **unchanged** native `resources/app/scripts/benchmark-first-transitions.js` once per arm, including native CP then Orders. Fixed order: pair 1 A/B, pair 2 B/A, pair 3 A/B. A is Main `1796193f0a57c7785e7bf9fdb3557e33c550b25e`; prepared B is `9a294b09f40c542b869e5996296393b6978e9f16`. A later candidate is admitted only with an explicit full `--candidate-head` and the exact same root receipt pin. Both app trees must be clean, including untracked app files.

The exact original observer is loaded directly from `/tmp/buyerlog-908-firstcp-final-after917/observer.cjs` through the native `PLAYWRIGHT_MODULE`. Its SHA is `1b0301d765ae8970917430c95dabe113749b76815bc2d115a5e59a273f2fe451`. The exact original `predeclared-equivalence.json` SHA is `0b67cf8b9f0fa02c7a1f5ab7b379803899e1cf8795fa5958124f31f955c9f3f9`. No wrapper module intercepts Playwright and no post-timing extra navigation is enabled. Native CLI SHA is `bd746f1a38b692223b8f62b88aa4e3355932714e01fde4ca8fbd4f41d0025cd1`; helper SHA is `403fd707ded5af40409e64baeae4f6b10d4fbd9c1f35dad82e9a76beb6b607cb`.

The genuine Phase 0 measurement is `/tmp/buyerlog-startup-shellpost901-20261107T201347-after-3/measurement.json` (SHA `932e3e2e2c75d1b780f654ce4d13d7725a51ed35a78c949357a9e7e3a5a540b3`). Its source metadata, seed 7, 30,000 requested rows, exact three source file names/hashes, expected normalized row counts, generation and revisions are checked. Runtime and browser selection comes from `/tmp/buyerlog-908-orders-regression-trace/prepared-manifest.json`: native Node, `/opt/codex/cua_node/lib/node_modules/playwright`, `/usr/bin/chromium`, timezone `Europe/Istanbul`. Root must separately confirm machine/runtime drift and actual source identity. User profiles are untouched; the native CLI creates fresh private fixture/browser contexts.

## Required root green receipt

Root must create a new factual JSON receipt outside this two-file preparation. It must bind its completed real suite and current sources, not copy the example as claimed evidence. The wrapper refuses missing/red/incomplete receipt fields and hashes the referenced raw suite evidence. The wrapper does not infer all-suite success from a targeted test count.

```json
{
  "status": "passed",
  "exclusiveExecutionConfirmed": true,
  "sourcePins": {
    "A": {"head": "1796193f0a57c7785e7bf9fdb3557e33c550b25e", "appTree": "ROOT_ACTUAL_GIT_APP_TREE"},
    "B": {"head": "ROOT_ACTUAL_FULL_CANDIDATE_HEAD", "appTree": "ROOT_ACTUAL_GIT_APP_TREE"}
  },
  "fullSuite": {
    "status": "passed",
    "candidateHead": "ROOT_ACTUAL_FULL_CANDIDATE_HEAD",
    "evidencePath": "/absolute/root/full-suite-raw-evidence.log",
    "evidenceSha256": "ROOT_ACTUAL_SHA256",
    "batches": [
      {"batch": 1, "status": "passed"},
      {"batch": 2, "status": "passed"},
      {"batch": 3, "status": "passed"},
      {"batch": 4, "status": "passed"},
      {"batch": 5, "status": "passed"},
      {"batch": 6, "status": "passed"},
      {"batch": 7, "status": "passed"},
      {"batch": 8, "status": "passed"},
      {"batch": 9, "status": "passed"},
      {"batch": 10, "status": "passed"}
    ]
  },
  "completedAnchor": {
    "path": "/tmp/buyerlog-first-transition-Hxb1BB",
    "receiptPath": "/tmp/buyerlog-phase6a-shadow-live-smoke/first/receipt.json",
    "receiptSha256": "ROOT_ACTUAL_SHA256",
    "childrenExited": true,
    "liveAfterExit": []
  }
}
```

After independently completing these prerequisites, root alone may execute:

```sh
python3 /tmp/bl6cp1/run.py --root-green-receipt /absolute/root/green-receipt.json --candidate-head ROOT_ACTUAL_FULL_CANDIDATE_HEAD
```

The wrapper acquires the existing `/tmp/buyerlog-performance-measurement.lock` using nonblocking exclusive OS `flock`. An empty lock file does not mean unlocked. Do not hold a separate flock handle around this command: the wrapper itself obtains and passes its descriptor to the native launcher. No test, server, other benchmark, screenshot run or source mutation may overlap. The receipt records root's explicit exclusive-execution confirmation; it cannot police a different actor that ignores the common lock. Do not run this under a short outer tool timeout; wrapper timeout is 2,400 seconds **per arm**. An existing `/tmp/bl6cp1/runs` refuses reuse, preventing automatic retries or replacement of failed evidence.

## Resource and child-process policy

The new wrapper's per-arm admission is at least **192 MiB free on `/tmp`**, raised if the actual native source-copy estimate exceeds 103 MiB. This does not change an official benchmark script or validator. Every arm rechecks source pins and actual free disk. During the run a 100 ms monitor stops its process group and tracked descendant identities when free disk falls below **96 MiB** or timeout is reached. No automatic retry follows failure. Disk headroom is not guaranteed: six arms estimated at 29 MiB retained each plus one 103 MiB active fixture can still be stopped by actual growth. Earlier JSON/log/PNG/profile evidence is never deleted or compressed to create space.

The launcher starts its own session. `/proc` stat records PID plus start ticks; session/group scanning, recursive task-child enumeration and Linux subreaper adoption track observable descendants until their actual process identities disappear. Unreadable `/proc` data fails closed, rather than treating an empty child list as proof. Root should use the same process visibility/privilege context it used to verify the previous fixture. Each native exit gets up to 15 seconds for descendant disappearance; remaining descendants cause CHILD failure and targeted TERM/KILL cleanup. PID reuse is checked before individual signals. The common lock descriptor remains inherited by the launcher if the wrapper disappears. SIGTERM to the wrapper raises through cleanup; SIGKILL cannot run cleanup, so root must inspect surviving children and the common lock in that exceptional case.

**Accounting limit:** this is sampled process accounting, not kernel fork/exit tracing. A grandchild created and reaped entirely between scans can be absent from the event history. All observed identities, task-visible descendants, process-group/session members and adopted orphans are checked for live exit; this wrapper cannot honestly certify a complete history of every transient child. If a literal lossless record of every fork/start tick is required, root must stop here and select kernel process-event tracing before timing, rather than reinterpret the sampled record as complete. No benchmark has been run under this policy yet.

Only after successful native result, strict data equivalence and **zero remaining tracked/group/session descendants** does the wrapper hardlink the exact three `source/*.xlsx` files to `/tmp/buyerlog-first-transition-Hxb1BB/source/`. SHA, regular-file status, same filesystem and exact mode must match. Each replace has a durable before/after receipt with inode, device, mode, owner, bytes, mtime, ctime and link count. File paths and bytes stay identical; hardlinking necessarily changes inode/ctime/link counts and can give the completed target the anchor's mtime/owner. It does not chmod/chown, modify XLSX bytes, deduplicate mutable files or remove raw evidence. Original Hxb completion and no-live-child evidence must be affirmed in root's pinned receipt. Only successful new arms are deduplicated; failed artifacts remain intact even if that prevents the next arm.

## Evidence and decision

Each `/tmp/bl6cp1/runs/p{1,2,3}{A,B}` retains native measurement, benchmark log, observer's original gzip normalized-row files and full schema/cell snapshots, child lifecycle logs and hardlink receipt. The native fixture path remains in `series.json`; its original server logs, private browser/profile artifacts if generated, PNGs, JSONs and other files stay there. No new CPU profiler is injected: the native CLI and exact observer do not collect a CDP CPU profile, so this cohort must not claim one. Existing native diagnostics, if emitted, are retained unchanged. Adding profiling would require a different explicitly declared cohort.

Equivalence recomputes SHA over **all decoded normalized rows**, checks every visible row's complete cell sequence against the predeclared CP SHA or exact Orders 53/60 SHA, compares complete headers, and checks source/generation/store revisions. No DOM slicing, sorting, fabricated data or post-run normalization. A mixed 53/60 pair is recorded as different observed initial schema variants even when both match their predeclared contract; it is not called identical initial DOM.

Reported latency is native `elapsedMs` (stable interactive paint), `firstRowsPaintedMs`, and `dataReadyMs`. `observationEndMs` and `maxPollGapMs` remain diagnostic. `startupReadyMs`, `startupUserWaitMs`, and system-to-stable-paint are separate. The 10-second startup sample window is never used as whole-transition latency. All three pairs and medians are retained. **Any positive CP pair or median delta in the three latency metrics is failed-regression**, regardless of a favorable median elsewhere. Orders uses the same conservative regression label. Six correct runs with no observed regression are only `completed-no-observed-regression`; `formalAcceptance` stays false, and root must separately decide acceptance/drift/remaining-phase obligations. No benchmark result, merge readiness, Phase 6c source ownership, Windows or Electron conclusion is claimed by this preparation.
