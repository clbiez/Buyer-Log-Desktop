# Optional projection schema output — prepared, unrun

Source pin: `2ce7eda88807f377865270f409fc54ed9a7a80fb`, worker blob
`4bd0c660aa9365567e3b59c4326792da1dab0caf`. `source-pins.json` records exact
candidate/test/patch SHA256. No execution, syntax check, module load, benchmark
or product write occurred. Existing14 ready assertions and prior evidence remain
unchanged. This packet does not touch ready task, cache, server or app.

`worker-optin.patch` changes only the existing worker:

1. Literal trusted `params.collectModuleSchemas === true` passes the **existing**
   third `buildProjections` argument and captures its existing `onSchemas` result.
   Every other value calls the same old two-argument builder.
2. Only the opt-in native reply has `moduleSchemas` next to `compressed`, not
   inside any compressed full module or legacy envelope.
3. For that reply the current V8 metadata/output lease charge includes
   `{sourceMeta,moduleSchemas}` with the existing×4 multiplier. The ordinary
   transfer list, source lease and output lease/release mechanisms are unchanged.

There is no new schema, registry or serializer. Actual
`compute-module-schemas.js` and public frozen schema8fe perform validation and
copy only bounded metadata. Each known schema is at most64KiB; the pair is at
most128KiB plus its small `{cp,orders}` wrapper. Metadata exceptions propagate
through the ordinary worker failure path; no fabricated known/empty schema is
published. Default output has no `moduleSchemas` own property and performs no
callback/schema serialization. Full compressed byte content stays unchanged.

The collection switch is an internal opt-in, **not** permission. Existing literal
exposure/target/binding flags still gate the actual helper. CP/schema denied,
unknown binding/definitions or separate row/Antrepo target topology remain null.
Broad `cpAllowed:true` grants no schema exposure. Actual Orders-only projection
rows are reused; this bridge does not ask for CP rows. Source/context/actor
authorization must still be captured by the trusted caller; no HTTP producer is
enabled and this metadata is not consumer dependency closure.

## Seven native cases, not a second inventory

`projection-schema-output.test.cjs` targets the actual application service,
common pool, worker, parser and serializers. Its expected schema comes from the
already-adopted actual `buildProjections` callback. Existing
`tests/compute-module-schemas.test.js` retains the detailed raw-definition,
canonical and schema-boundary coverage; this packet does not duplicate it or
change those assertions.

New native cases cover known own Orders metadata and unchanged full gzip bytes;
all nontrue switches; denied/unknown schema policy; distinct source topology;
Orders-only without CP/shared parser calls; metadata lease charging; and callback
source failure propagation. `native-worker-preload.cjs` is **test-only fault
instrumentation** on the existing worker option: CP/shared parser exports throw
if unexpectedly called, or the schema-source export deliberately throws for one
error test. It supplies no substitute parser/schema algorithm, creates no
production worker/pool and changes no product source. All positive parsing and
metadata paths otherwise use actual code.

## Exact root commands — NOT RUN

The test defaults to
`/workspace/buyerlog-post-main-acceptance/resources/app` (optional checkout override
`BUYERLOG_READY_APP`). Baseline already recognizes projections, so the first RED
should show **missing moduleSchemas** while full projection computation succeeds:

```sh
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock env TZ=UTC node --test --test-concurrency=1 --test-name-pattern='explicit schema collection returns own Orders' /tmp/buyerlog-phase6a-projection-schema-output/projection-schema-output.test.cjs
```

Root-only patch review/adoption, also unrun:

```sh
git -C /workspace/buyerlog-post-main-acceptance apply --check /tmp/buyerlog-phase6a-projection-schema-output/worker-optin.patch
git -C /workspace/buyerlog-post-main-acceptance apply /tmp/buyerlog-phase6a-projection-schema-output/worker-optin.patch
```

Same new assertions plus existing actual schema coverage for GREEN:

```sh
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock env TZ=UTC node --test --test-concurrency=1 /tmp/buyerlog-phase6a-projection-schema-output/projection-schema-output.test.cjs /workspace/buyerlog-post-main-acceptance/resources/app/tests/compute-module-schemas.test.js
```

The existing14 ready-worker assertions remain a separate unchanged regression
gate owned by root. No timing gain, default performance improvement, cache/HTTP
enablement or Phase6a completion is claimed.
