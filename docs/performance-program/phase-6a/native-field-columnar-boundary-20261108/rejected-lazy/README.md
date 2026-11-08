# Lazy Proxy row candidate — rejected at existing CP boundaries

Preparation only. No script, test, syntax check, native probe, browser or benchmark
was executed by the preparer; no worktree/canonical/protected #916 file changed.
All earlier eager-columnar codecs and rejection results remain untouched. Root
explicitly stopped the proposed long 30k/first-CP measurement after the concrete
clone incompatibility was found, so this package contains only tiny native
boundary evidence preparation and a limited functional toy harness.

`lazy-row.cjs` is an isolated, non-production row experiment over key/cell arrays
and mutable slots, with no eager ordinary object-row materialization. It derives
keys from the record itself and has no field registry or omissions. It supports
basic synchronous property/own-key/order/presence/assignment/delete/spread/JSON
operations, native Dates, numeric-key ordering and duplicate business IDs by
separate ordinal. Source Node-native `util.types.isProxy` rejects Proxy input
before its traps. Descriptor inspection rejects getters, custom toJSON and
unsupported prototypes/graphs before values are packed. Browser JavaScript has
no equivalent reliable arbitrary-Proxy detector; this source packer is therefore
Node-only, and no browser transport/admission claim is made.

**Hard rejection:** Proxy objects cannot enter the existing native structured
clone boundaries, regardless of their transparent-looking getter behavior:

- Actual `public/cp-decision-runtime.js:57` calls worker.postMessage; its batch at
  71–75 includes `{reference,row:value}` for uncached rows. Lazy Proxy rows throw
  native `DataCloneError`. The existing actual runtime catches that failure and
  changes to its cooperative fallback (`run:101–108`). A correct final decision
  after this fallback does not make the candidate compatible with the current
  worker path or preserve first-CP performance behavior.
- Actual `public/app-main.js:9952 withCpBulkDraft` calls structuredClone(row) for
  selected row snapshots. It fails before the callback can apply a bulk draft.
  Materializing plain rows, changing worker messages, weakening snapshot guards
  or accepting the fallback would be a different design and is not done here.

`boundaries.cjs` executes the **actual pinned** CP runtime with a disposable
MessageChannel adapter that uses native postMessage cloning. It acknowledges
the actual begin message, then records/rethrows the native DataCloneError for
the actual batch. It does not fake that error or alter production fallback.
Actual Readiness Engine hooks compute the existing cooperative fallback result;
the evidence explicitly records failed=1, fallbackJobs=1, workerJobs=0 and
termination. It also extracts and executes the actual whole withCpBulkDraft,
verifies its failure/no callback/source preservation, and runs ordinary-record
controls including two duplicate business IDs. No worker protocol is rewritten.

`lazy-row.test.cjs` prepares basic property-semantics tests and a tiny functional
harness using the actual current normalizer, canonical reader, formula engine,
CP Readiness/decision/rule and checklist component engines. Every new bulk
component loop is inside `Components.withRowCache`. Pins include the protected
assistant/sync/component source and current row-cache regression test. Small
functional equality is explicitly insufficient to override clone rejection.
The adapter also explicitly rejects unsupported defineProperty/seal operations;
it is not a claim of full ordinary-object semantic equivalence.

No native/source encode/get/parse/heap numbers are collected: there is no reason
to launch a long cost campaign or a first-CP application probe for this
inadmissible candidate. The official 30k source attribution (CP90/Orders89 keys,
no CPX keys) remains separate evidence and is not modified or relabeled.

Future root-only commands, serialized with the existing lock, not results:

```sh
node --test /tmp/bl6lazy-rejection/lazy-row.test.cjs
READY_MODEL_COST_LOCK=held node /tmp/bl6lazy-rejection/probe.cjs --label r1
```

Root holds `/tmp/buyerlog-performance-measurement.lock` externally or uses its
existing flock wrapper. The probe requires a unique short label, writes bounded
JSON under its own `r/LABEL`, preserves failures and prints only the result path.
There is no production integration, deployment, gain claim or recommendation to
accept this Proxy design. A future columnar evaluation would need a different
representation compatible with existing clone/snapshot semantics and would
retain all earlier rejection evidence.
