# INT-07-FINAL — active cancellation and total read deadline

Continuation of existing PR #940 / `fix/followup-plm-bom-budget-20261109`.
Prior PR head: `0b2edb6610e8cb90f44881c5e1a873b4b316713a`.
Current Main integrated by normal merge: `5740964180eba32a41316e2970b969f3d8359d99`.
Worktree: `/workspace/buyerlog-int07-final`; merge commit: `4078c0fc`.
The earlier parent directory documents the original partial delivery. This
subdirectory records the final transport follow-up and supersedes its two
open transport limitations. Final head and actual CI are pinned in the
`[INT-07-FINAL]` comment on #937.

## Behavior and ownership

Product changes are confined to `corenectum-api-client.js`,
`plm-bom-sync.js`, and `plm-bom-int07-budget.js`. The three BOM reads explicitly
set `bomReadControl: true` and supply a target AbortSignal. Only JSON reads
of the existing association, Style List and BOM endpoints honor that opt-in.
There is no new endpoint, transport, token store, worker, retry engine or
mutation retry. The report/binary path and all default consumers retain their
previous behavior. IAM, source authority assertion, auth generation, general
pipeline limits, image files, compute and server routes are unchanged.

Each target still gets at most 240 seconds, starting when it first enters the
target worker, and callers may only shorten this duration. The existing
`bomAdmissionMs` option and exported constant name remain compatible, but this
budget now covers queue admission, retries, shared auth waiting, fetch headers,
body reading and JSON decode. An expired or cancelled target cannot publish a
late read result or launch a replacement read. The opt-in client also checks the legacy job predicate at body completion,
including a cancellation between the 25 ms polls (a dedicated regression
asserts no result/write). A clock check after decode also
rejects a result that crosses the deadline during synchronous JSON processing.
As with JavaScript timers generally, synchronous work is not preempted mid-call;
a stale decoded result is rejected before BOM analysis/store admission.

The per-target controller receives immediate external AbortSignal cancellation;
legacy job `isCancelled` predicates are checked every 25 ms and at read/wait
boundaries. The API client's request controller remains attached while the
response body is consumed. Its existing per-attempt timeout remains capped at
60 seconds by the BOM caller; the independent target deadline can abort sooner.
Unread 401/403 response bodies are cancelled before auth recovery. A permit
is released once, in `finally`, after the actual fetch/body promise settles.
There is no Promise.race that frees a slot while a read continues in the
background. Successful targets clear timers/listeners without aborting their
successful signals. Reads completing after cancellation/deadline are excluded;
previously completed safe targets and prior successful stored data remain.

Shared auth refresh remains shared: an expired target detaches its waiter and
cannot resume old reads when refresh later completes. It does not cancel an
external shared refresh still needed by another target. The refresh provider's
own lifecycle is unchanged. This is a wait boundary, not a raced active read.

### Sharing and request count

Default pending reads still coalesce identical owner/token/request keys and
return separate structured clones. Opt-in BOM reads deliberately bypass that
map: two overlapping identical BOM consumers now make **two** network reads,
rather than one shared read. Cancelling either cannot cut the other's body or
a default consumer's read. They still share the owner limiter: **5** active
reads per owner, independent owners, at most **4** attempts per logical
method/URL/body across all upper rounds including auth recovery. The client is
called with `retries: 1`. No production concurrency, deadline or attempt limit
was increased. The existing client does not expose Retry-After information;
no new Retry-After support is claimed. Transient/permanent classifications and
auth token-generation recovery are preserved.

## Reproduction and evidence

Run from the repository root, Node v24.19.0 on Linux x86_64. Dependencies use the
existing checkout's unchanged installed app packages; no dependency/version
change is part of this PR. Heavy runs use the shared flock lock.

```
flock /tmp/buyerlog-performance-measurement.lock node --test \
  resources/app/tests/plm-bom-int07-*.test.js \
  resources/app/tests/plm-bom-sync.test.js \
  resources/app/tests/plm-set-style-sync.test.js \
  resources/app/tests/plm-sync-colours-retry.test.js \
  resources/app/tests/plm-sync-two-phase.test.js
flock /tmp/buyerlog-performance-measurement.lock node \
  docs/performance/followup-20261109/int07/final-transport/acceptance.cjs
flock /tmp/buyerlog-performance-measurement.lock env -u BUYER_LOG_TEMP_ROOT \
  BUYER_LOG_SERVER_DATA_ROOT=/tmp/int07-final-full/server \
  BUYER_LOG_DATA_ROOT=/tmp/int07-final-full/app \
  BUYER_LOG_LOCAL_DATA_ROOT=/tmp/int07-final-full/local npm test --prefix resources/app
npm run --prefix resources/app i18n:check
npm run --prefix resources/app release:notes:validate
```

- `red.log`: on the original PR product source, all six selected new HTTP
  acceptance cases fail or time out. In particular active fetch and stalled
  body remain live, identical opt-in consumers still coalesce, and auth/retry
  waits outlive the target. Timed-out tests are reported as CANCEL, not PASS.
- `green-final.log`: all 81 targeted tests pass (including the unchanged
  two-phase suite). `green.log` retains the preceding 63-test pass. Real local Node HTTP / native fetch
  and streaming bodies verify server response close events, active/closed and
  attempt counters. Covers pre-header cancellation/deadline; post-header
  stalled success/error body; queued cancellation/deadline; retry/auth waits;
  shared/default/opt-in isolation; separate owners while five slots are held;
  reuse of all five permits; 429/503 (four attempts), 400 (one); refreshed auth
  generation and token; no late writes; successful signal disposal; partial
  results and equivalent Set Style content. Existing mock timeout/network
  errors also verify four attempts. No real enterprise PLM is contacted.
- `green-initial.log`: initial 19/19 green transport cases.
  `green-expanded-first.log`: expanded run had 62 PASS / 1 FAIL because the
  new test's refreshed synthetic token was shorter than the existing minimum
  length; only that fixture was corrected. Token validation was not changed.
- `application-acceptance.json`, `application-responses.json`,
  `application-batch.json`, `application.log`, `application-run.log`:
  actual server routes/job/store/client and Chromium BOM UI, with only the
  initial Style List collection and remote responses replaced by synthetic
  fixtures. Two same-owner concurrent jobs × five sets × six children:
  **80 attempts, peak 5, final 0 active**, six persisted parts and six prints.
  This successful-app acceptance is separate from the real local streamed
  transport tests; it does not itself exercise route-level cancellation.
- `acceptance.cjs`, `synthetic-preload.cjs`: repeatable application fixture.
  Playwright at `/opt/codex/cua_node/lib/node_modules/playwright`, Chromium at
  `/usr/bin/chromium`; these are development tools, not product dependencies.
- Existing single release-note ID `int07-bom-owner-read-budget-20261109` is
  updated in TR/EN; its PNG is recaptured from this final application and
  visually inspected (A–F parts, six print rows). A screenshot alone does not
  prove cancellation or deadlines. All five current Main entries and top-level
  release-note fields are preserved exactly by JSON value; no duplicate note.
- `i18n.log`: zero new and baseline gaps. `release-notes.log`: 6 entries PASS.
- `source-manifest.json`: hashes of all 3338 app/server/public/electron/test/
  script/package inputs, including the new HTTP test, before the full run;
  hashes are rechecked before commit. `full-test.log` records the one standard
  uninterrupted runner at default concurrency=4. Summary is recorded separately
  after completion. Test thresholds, skips, runner and CI are unchanged.

The first full invocation stopped in batch 2: four IAM restore tests rejected
writes to their own temporary sibling auth directories. This was caused by the
invocation's explicit `BUYER_LOG_TEMP_ROOT=/tmp/int07-final-full/tmp`, which
narrows `user-data.js`'s synthetic temporary-write allowance. It was not a BOM
failure. `full-test-first-environment.log` retains the failed run. With that
extra override absent, all four unchanged tests pass
(`full-environment-diagnosis.log`). The subsequent standard full invocation
starts again at batch 1, retains every assertion/batch/default concurrency,
and leaves the product's default temporary-root security policy intact.
It does not concatenate successful leftover batches into a PASS.

The second full invocation reached batch 4 and caught the unchanged two-phase
cancellation regression: a reader that synchronously completed a valid response
and changed the legacy cancellation predicate was being retroactively rejected
(9 skipped instead of 8; the second completed result was lost). The fix accepts
a completed result only if its target signal is still live and its deadline
has not elapsed; the next admission still checks the legacy stop predicate.
Actual aborted fetch/body results remain rejected. The existing test and all
its assertions are unchanged, and now pass in `green-final.log` alongside the
real HTTP cancellation/deadline cases. The failed run is retained in
`full-test-second-completed-result.log`. The final full run starts at batch 1
again after this fix; the old partial runs do not count as a full PASS.

Critical diff review covered default shared-read equivalence, read-only opt-in
scope, auth-generation classification, signal/timer disposal, FIFO admission,
once-only permit release, child-drain behavior, bounded attempts, no stale
result/store admission, prior safe results, and protected file/manifest parity.
No independent second model review was performed. The coordinator retains final
review and merge authority. No enterprise capacity, production speedup, Windows
or live corporate PLM acceptance is claimed. No merge, branch deletion,
TEST/STABLE publication or issue closure is performed by this task.

## Final standard full regression

Final unchanged product/test inputs: **1324 files, 10/10 batches, default
concurrency=4, 9089 PASS, 0 FAIL, 65 existing SKIP, 0 CANCEL**,
9154 total tests, 201.2 seconds. See `full-test.log` and
`full-test-summary.json`. All 3338 input hashes match after this uninterrupted
full run. Only evidence text/log/summary files are completed afterward.
