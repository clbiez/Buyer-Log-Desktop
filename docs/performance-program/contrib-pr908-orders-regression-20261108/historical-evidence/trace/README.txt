#908 Orders regression trace — PREPARATION ONLY

State: NONFORMAL derived SINGLE-ORDERS diagnostic, one serial A/B pair.
Nothing in this packet has been syntax-checked or run. No app, server, browser,
test, benchmark, container or profiler was launched during preparation. Only
source/log/metadata reads and these new /tmp preparation files were written.
No production/test/repo files, existing formal artifacts, INT08 or DS11 packets
were modified. Root must review this packet before its exclusive serial run.

Evidence and question
---------------------
Formal source series: /tmp/buyerlog-908-firstcp-final-after917/series.json.
The three paired Orders results are +4.595%, +52.761%, +8.209%; median elapsed
10.5416 -> 11.4070 seconds. The formal result remains a merge blocker.
CP median 44.7208 -> 23.2241 seconds does not erase the pair-3 +30.278% case.

CONFIRMED source behavior: the native Main917 benchmark launches one server and
one browser, then measures CP and Orders with separate new contexts in that
order. Its later Orders sample therefore observes a different server age and
server state after the CP context. The possibility that this interacts with CP
length/background warmup is a HYPOTHESIS, not an established cause. A context
refresh does not make the underlying server or browser process fresh.

This packet removes only the preceding CP measurement. Each A/B arm invokes a
new native benchmark, which privately copies the SAME genuine Phase0 input,
starts its own server, launches its own browser, opens one fresh Orders context,
uses the actual overview startup/boot guard/first Orders intent, asserts genuine
rows/permissions/generation/revisions/unobscured first row, and closes normally.
Natural CP background loading/warmup stays enabled. No fake CP result is made.
CP is unmeasured in this protocol. No refresh POST or new product worker exists.

Frozen sources and exact derivation
-----------------------------------
A checkout: /workspace/buyerlog-analytics904
A HEAD/Main917: 1796193f0a57c7785e7bf9fdb3557e33c550b25e
B checkout: /tmp/buyerlog-shared-ui908
B HEAD: b954526199ed066feff77b438466cd48b78e03f5
All selected live source files matched those commits during preparation.
prepared-manifest.json records both app trees and eight selected Git blobs/SHA256.
The immutable benchmark/helper files are identical in both pinned revisions.

Original benchmark SHA256:
bd746f1a38b692223b8f62b88aa4e3355932714e01fde4ca8fbd4f41d0025cd1
Derived benchmark SHA256:
79cf2546d797a425dbd9da86b93a2dd4b07071242ced3231643bb61bed272bdd

The entire source diff is in exact-source.diff, one replacement only:
  for(const module of ['cp','orders']){
  for(const module of ['orders']){

launch-single-orders.cjs verifies exact source SHA and replacement count, then
uses Module._compile with the ORIGINAL Main917 filename. Original relative
helpers/input validation/assertions/timeouts/result extraction/server cleanup
remain intact. No edited source file is installed in either checkout. The raw
native measurement still calls itself first-intent-after-startup; the enclosing
derived-probe.json/diagnostic-series.json explicitly label this NONFORMAL source
derivation. Never feed this result into the formal three-pair acceptance series.

Input: /tmp/buyerlog-startup-shellpost901-20261107T201347-after-3/measurement.json
SHA256: 932e3e2e2c75d1b780f654ce4d13d7725a51ed35a78c949357a9e7e3a5a540b3
Original synthetic schema3, complete four-module Phase0, 30k rows, seed7.
Expected generation: mw6vhoks-9100b15fc128
Expected sourceRevision: 592ae0fbdb996d1ba2fca3189d225187c3e3e2690bb61098ad7ccba5ffc4f3f8
Input SHA, original marker and all three workbook SHAs are checked again before
each arm; the native original input checks also run unchanged. No surrogate is
accepted. Full source root and its mutable caches are copied by native fs.cpSync;
there is no hardlink during measurement.

Instrumentation boundary and artifacts
---------------------------------------
playwright-profile-wrapper.cjs calls the actual unchanged schema observer:
  /tmp/buyerlog-908-final-schema-observer.cjs
It verifies that file's frozen SHA before require. That observer performs the
real complete normalized-row JSON/gzip + SHA, both schemas, actual visible cell
texts, key order, unobscured-row and timezone captures at context.close.
FIRST_TRANSITION_EXTRA_NAV is removed, so no extra CP navigation is requested.

The wrapper installs only a private read-only diagnostic observation of actual
long tasks, module-preparation events and lifecycle events. It does not assign
rows, columns, schemas, renderers, BLPerf functions or module preparation states.

Before the real page.goto(overview):
- Open actual CDP session on that page.
- Profiler.enable / setSamplingInterval(interval:1000 microseconds) / start.
- Tracing.start with devtools.timeline, v8.execute, toplevel only; ReportEvents;
  recordUntilFull and 500ms buffer status. No Network.enable, HAR, network bodies,
  request headers, cookies, screenshots-in-trace or credential capture.
- The native benchmark then runs its own goto and all original waits/actions.

The wrapper recognizes exactly the native first-transition completion wait.
After that real wait resolves it sends Profiler.stop and Tracing.end before any
native post-timing result evaluate or complete normalized-row/schema JSON.
Only after CDP stop completion does it capture a supplementary marks summary
and return to the native benchmark. Native result object/timings remain genuine.
A context-close fallback stops instrumentation on failure. Extra 30s deadlines
are diagnostic start/stop cleanup bounds, never loosened benchmark timeouts.

Outputs per arm include:
- measurement.json: unmodified native assertions/results, ONLY Orders transition.
- renderer.cpuprofile: actual CDP CPU profile at 1ms requested sampling interval.
- timeline.trace.json: incremental Chrome trace-event envelope, max 64 MiB.
- instrumentation.json: sampling/category/boundary, loss/completeness status.
- profile-boundary-actual-marks-and-preparation.json: ALL browser Performance
  Timeline marks and measures still present, full observed long tasks, actual
  module-preparation summary/event history, BLPerf metrics and native probes.
- context-close-actual-marks-and-preparation.json: later actual marks/status,
  captured after the native screenshot but BEFORE the full-row schema observer.
- BLPerf.timeline is the product's existing last-80 detailed ring, explicitly
  labelled as such. ALL Performance Timeline mark names/timestamps are also
  preserved; earlier BLPerf detail payloads beyond that ring are not invented.
- post-timing-data.json + initial-orders-schema-cells.json and complete normalized
  rows gzip from the actual unchanged observer, not a substitute hash.
- source/app/input pins, actual Node execPath/version, server/child PID/start-tick
  identities and exit records. No environment values or cookie/body dump.

Trace safety: streaming event writes reserve footer space inside 64 MiB. At the
byte limit, an 80%-full browser trace buffer, Chrome dataLossOccurred, I/O error,
missing completion interception or CDP failure, the diagnostic FAILS. Already
written .partial files are kept. Any omitted events and incomplete flags are
explicit. There is no truncation followed by a success claim. A partial event
envelope may need forensic recovery if the process dies before its footer.

The unchanged native assertions still check permissions, rows, actual projected
generation, revisions, renderer errors and visible/unobscured first-row results.
The runner additionally reuses the original predeclared row/cell/header gates:
Orders complete normalized SHA must be
  3611e608734e9d1db9400fd85fd3be566e55f0ba871ac780a36a381eb514c59b
Only the already observed 60/53-column variants from the pinned formal contract
are accepted, with their EXACT full header and cell SHA. Both actual full schemas
are retained. A variant difference is reported, never labelled identical DOM.
Any new variant, row/content/header mismatch, coverage, error or trace loss stops
the one pair; no retries, skipped assertion, early ready or timeout relaxation.

Serial lock, resources and lifecycle
-------------------------------------
Runner acquires the EXISTING common /tmp/buyerlog-performance-measurement.lock
nonblockingly for the entire A -> post-exit artifact work -> B protocol. Missing
or held lock fails. No concurrent performance work is allowed.
Before EACH arm it checks both HEAD/app-tree/clean app sources, immutable helper
and observer/input provenance, synthetic workbook hashes, and actual free /tmp.
It rejects ambient nonempty BUYER_LOG_*, NODE_OPTIONS/NODE_PATH/BL_STALL_PROFILE
(name-only error) rather than allowing hidden app/profiler configuration.
TZ and Playwright timezone both remain Europe/Istanbul; TMPDIR=/tmp preserves
the immutable native synthetic-root validation. Chromium is /usr/bin/chromium.

Admission is a SERIAL active-arm peak, not two concurrent browser estimates:
actual rounded native copy estimate + trace64MiB + CPUprofile32MiB + captures16MiB
+ logs/screenshots8MiB + mutable growth16MiB + browser transient64MiB + post-exit
compression temporary64MiB + reserve64MiB. Other than trace64MiB these are honest
planning allowances, not sample/output caps or a universal bound on all storage.
The launcher independently rechecks the post-copy allowance immediately BEFORE
server spawn. Admission refusal starts no app. No unrelated evidence is deleted.
B uses actual free disk after A cleanup/retention; completion of both arms is
conditional on each arm's admission, and A remains intact if B cannot start.
preparation-readonly-facts.json records the preparation-time copy/free estimate;
future admission always reads fresh real disk state.

The launcher observes actual spawned process PIDs/start ticks and exit events.
Only after the native process has returned AND server/browser child exits are
proved does the runner:
1. Replace each completed private XLSX copy with a hardlink to the corresponding
   SHA-verified unchanged synthetic input workbook. Before/after SHA/device/inode
   and source link count are recorded. No chmod/chown/content mutation. Link
   count/ctime necessarily change AFTER completion; no linked input during run.
2. Losslessly gzip large raw trace/profile/schema/log outputs (including completed
   failures) using streaming I/O. Independently decompress and verify raw SHA and
   byte count, record gzip SHA/bytes, fsync manifest BEFORE raw unlink. Already-gz
   complete normalized rows and all app/private mutable data remain intact.
Unknown child exit, packing failure or interruption preserves raw/partial data
and stops further arms. Failure cleanup may signal ONLY the recorded matching
child PID/start tick. No broad kill, host action or fixture deletion.

Exact future command — ROOT REVIEW REQUIRED, NOT EXECUTED
---------------------------------------------------------
Use the same authorized execution environment as the formal cohort, with no
other benchmark holding the common lock. One unique label only:

/usr/bin/python3 /tmp/buyerlog-908-orders-regression-trace/run-diagnostic.py --label orders-only-A-B-01

Do not invoke the Node launcher alone. Do not add timeout/concurrency overrides.
A label directory is never reused or overwritten. No automatic rerun exists.
Prepared source/pin hashes are in preparation-files-sha.json (self excluded).
Do not run node --check, py_compile, browser, tests or benchmark during review
unless root separately chooses to execute the packet serially.

Assessment after samples
-------------------------
Inspect the real CPU profile by source URL/function/line: table-header-tracking.js
(update/computeTrack/schedule), workspace-blur.js (sync/affectsSurface/observer),
and app-main.js/loading/CP/checklist stacks. Do not classify all app-main.js CPU
as CP. CDP samples/timeDeltas are sampled attribution, not exact per-call CPU
cost; idle/GC/system frames and unsampled short work must remain visible.
Use the full marks/preparation snapshots to align actual CP_LOAD, background
warmup, module preparation, intent/data-ready/paint/observation intervals. Trace
FunctionCall/Layout/UpdateLayoutTree work helps distinguish UI observers from
background data work; absence from a small sampled profile is not zero cost.

Compare this one instrumented fresh-server Orders arm with its paired counterpart
and contextualize against the preserved formal sequential cohort. It is NOT a
clean causal intervention on background CP (which stays active), and profiling
adds overhead. One A/B result cannot establish variance, effect size or root
cause, and cannot dismiss a three-of-three formal Orders regression. A remaining
regression is evidence to localize, not proof of header/blur causality. A missing
regression is compatible with sequence/state or noise, not proof of exoneration.
#908 stays Draft/merge-blocked until root completes the required acceptance work.
