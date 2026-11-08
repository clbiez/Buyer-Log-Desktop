# Minimal wiring proposal — not applied, not executed

Source pin: `7f8adc97e1b26276cd849cdd34a6dada142779e9` in `/workspace/buyerlog-post-main-acceptance`.

Read-only SHA-256 receipts:

- `server/server.js`: `3f1b7280b878ed69e6b1fc5727ac9f1b510455acd24953cfaffe8d445068cdb6`
- `server/lib/page-projection-cache.js`: `ed88794d32fdcb5f7666a45428bfc668f87627e9ed2c30a23a21daadc2cf5c2d`
- `public/module-projection-schema.js`: `8fe23ec826137676fd4053c08c54d9aa3fe145ef976ab1bf6ce17eb93451ee9a`

Only new preparation files in this directory were written. No production edits, script execution, syntax check, tests, server or benchmark. This is implementation preparation, not the final independent P1 review. The completed V2 cost result remains separate; none of these files claim a public thin path or reverse the cold-full decision.

## Helper contract

Adopt `page-projection-schema-binding.js` as `server/lib/page-projection-schema-binding.js`. It owns no disk path, cache, store, worker, session or durable authority. It uses the existing strict schema API through one explicit injection:

```js
const schemaBindings = require('./page-projection-schema-binding').create({
  schemaApi: require('../../public/module-projection-schema'),
});
```

This line belongs in `page-projection-cache.js` beside the existing imports. Metadata is stored as `manifest.moduleSchemas`, populated through existing manifest `extra` plumbing. Each own entry is at most **64 KiB including schema, checksum and binding**, so CP+Orders together are bounded by 128 KiB. The existing schema reader performs the strict bounded clone. Zero/false/null/unknown definition properties are preserved verbatim; malformed, inherited, accessor/proxy, unsupported, legacy, unknown or oversized schemas are omitted. No row graph is copied or inflated.

`prepare` snapshots newly returned native worker schemas and hashes the **same exact compressed full buffers** destined for the native cache writer. It binds owner, module, contextHash, sourceProjectionKey, moduleInputKey, full gzip checksum, compressed byte count and raw byte count. Its entry shape deliberately has no generation. `bindCommitted` can only turn that prepared shape into a new-generation record when all fields match the writer's actual module metadata. Bound old-generation records are not accepted as fresh producer input. `schemaChecksum` detects accidental in-place schema mutation independently of body identity; it is not an authentication signature.

There is no policy derivation here. The separate trusted policy adapter supplies exposure/binding/target flags and context invalidation. This helper cannot infer authorization or source topology from schema strings, and does not grant it. Changing trusted model definitions while preserving all source/input/context identities is outside this helper's authority; policy/context code must provide its correct invalidation inputs.

## Cache writer changes

1. Add the import above. Export `prepareModuleSchemas: schemaBindings.prepare` and the new synchronous primary reader described below.

2. At the **synchronous entry** of `writeCompressedGeneration`, before `singleFlight`/mutation enqueue/any await, capture:

```js
const schemaCandidates = schemaBindings.snapshotPrepared(extra.moduleSchemas);
```

Append `schemaBindings.preparedKey(schemaCandidates)` to the existing `inputKey` JSON tuple. This prevents a schema-collecting producer from joining an otherwise equal no-schema or different-schema publication. Do not change the full projection buffer, compression, copy loop, module set or existing admission/guards.

Immediately after the existing final manifest object is constructed, before publication:

```js
manifest.moduleSchemas = schemaBindings.bindCommitted(manifest, schemaCandidates, String(userId));
```

Publish this one trusted fresh-metadata path with `saveManifest(userId, manifest, true)`. All other existing calls retain the default `false` below. This is internal publication of already checked optional metadata, not a new durable source of authorization.

3. Give existing `saveManifest` a third internal argument `publishNewModuleSchemas = false`. After creating its directory, read the **primary file** once with `loadManifestFile(file)`, use it for the existing backup decision, and insert only this optional-metadata sanitation before its unchanged atomic write:

```js
const current = loadManifestFile(file); // primary only; never loadManifest()
const ownSchemas = schemaBindings.retainCurrent(
  publishNewModuleSchemas ? manifest : current,
  manifest,
  String(userId)
);
if (Object.keys(ownSchemas).length) manifest.moduleSchemas = ownSchemas;
else delete manifest.moduleSchemas;
```

The current source already reads `current` inside the backup `try`; move that declaration out and reuse it, rather than adding a second fallback-capable read. Keep the generation-change backup logic and existing full-cache fallback behavior unchanged. **Only** `writeCompressedGeneration` passes `true`, after binding captured fresh candidates against its computed metadata. A raw `writeGeneration`, `rewriteGeneration`, backlog touch or reuse cannot add metadata. They may preserve only identical valid entries already present in both the actual primary and their next manifest. This centralized boundary matters because legacy `loadManifest()` can return `.bak`; a later backlog/reuse write must not promote that backup's optional schema when the primary is absent.

4. In `writeProjection`, after replacing `manifest.modules[module]` and before calling `saveManifest`:

```js
manifest.moduleSchemas = schemaBindings.drop(manifest.moduleSchemas, module);
```

The original module mutation/full bytes semantics remain unchanged. Explicitly revoking metadata also covers same-generation A→B→A and even a same-byte rewrite; the old record cannot reappear simply because its old checksum becomes true again. `saveManifest` intersects the requested remaining entries with the actual primary, so it does not undo this deletion.

`reuseGeneration` needs no separate new authority logic: its existing `{...manifest, ...extra}` next object passes through the central sanitizer. Changed input/source/context/body fields drop the record. An `extra.moduleSchemas` entry cannot resurrect one absent from primary. `rewriteGeneration` creates a new generation via its existing raw writer and therefore has no valid prior-generation metadata to carry. The existing `writeViewCompressed` already starts from and checks the primary and preserves unrelated valid metadata through the user mutation queue; it is not made into a schema producer.

The conservative first implementation deliberately does not migrate schema entries for inherited/reused modules into a new generation. Their full bytes still follow the existing reuse/copy logic; their schema is unknown until a genuine opted-in producer supplies it. This avoids inventing a rebind and is compatible with ordinary full fallback.

## Exact-current reader

Add this synchronous function inside `page-projection-cache.js` and export it:

```js
function readCurrentModuleSchema(userId, module, contextHash, cached) {
  const primary = loadManifestFile(manifestPath(userId));
  if (!primary || primary.contextHash !== contextHash) return null;
  return schemaBindings.readCurrent({
    ownerId: String(userId), module, manifest: primary, cached,
  });
}
```

`cached` is the actual `readProjectionCompressed` result, never a client DTO. The helper requires `fallback === false`, the correct module, matching cached/current generation and binding fields, matching current module checksum and both byte counts, valid gzip boundary/footer, and a fresh SHA over that exact full buffer. It then returns an immutable own `{version,module,pin,schema,schemaChecksum}` copy or `null`. It never consults `.bak`, stored old caller metadata, derived views, another module, or a second file/cache path. In particular, `loadManifestCandidates` can label the only available backup as index 0 / `fallback:false`; the independent primary read still rejects it.

This synchronous read is a capture, not an async lifetime lease. If a consumer crosses an await before preparing/publishing a ready view, it must use the existing live guard and current primary/full-pin checks again. The future ready path keeps the already established cold behavior: **read valid ready hit, otherwise serve ordinary full; schedule any eligible preparation separately**. This packet adds no synchronous ready build to an HTTP miss.

## Server producer insertion points

`buildAndWriteComputedPageProjectionCache` at pinned `server.js:8171`:

- Include `collectModuleSchemas: true` in the trusted `computeParamsFor(..., 'projections', parts)` call only when the separate policy integration opts this producer into collection. Do not invent exposure flags here.
- After existing `compressed` assembly, compute `sourceProjectionKeys` exactly once from `lease.value.sourceProjectionKeys || descriptor.projectionKeys` and prepare metadata:

```js
const sourceProjectionKeys = lease.value.sourceProjectionKeys || descriptor.projectionKeys;
const moduleSchemas = pageProjectionCache.prepareModuleSchemas({
  ownerId: String(id), contextHash: ctx.contextHash,
  sourceProjectionKeys, moduleInputKeys: extra.moduleInputKeys,
  projections: compressed, moduleSchemas: lease.value.moduleSchemas,
});
```

Pass `{...extra, sourceProjectionKeys, moduleSchemas, performance: ...}` in the existing `writeCompressedGeneration` call. Preparation reads only schemas for modules returned by this worker; the presence of reused gzip bytes does not manufacture schema provenance.

`ensureComputedProjection` miss path at pinned `server.js:8549`:

- Put `collectModuleSchemas: true` in the trusted **key parts** of the opted-in `computeReads.run(..., 'projections', parts)` call, so the existing compute-read flight key separates schema/no-schema work. Policy flags still come from the separate server policy adapter. Legacy/API-envelope paths can leave the opt-in absent and retain full-only behavior.
- After existing `projections` and `moduleInputKeys` are available, prepare with owner `String(ctx.id)`, `ctx.contextHash`, `lease.value.sourceProjectionKeys`, those exact `moduleInputKeys`, those exact `projections`, and `lease.value.moduleSchemas`.
- Include the result as `extra.moduleSchemas` in the existing compressed generation call. Keep `mergePrevious`, `assertCurrent`, `lease.assertResponse`, release and native response buffers untouched. The schema stays in manifest metadata and is not injected into full gzip/legacy JSON.

No cache hit, legacy envelope, previous-generation fallback, row rewrite or saved old schema is treated as a new opted-in schema producer. The source pin and callback output, not a similar row/business ID, establish the metadata's full-body association.

## Unrun tests

- `page-projection-schema-binding.test.cjs`: actual application schema reader, bounded clone/read, false/zero/null, invalid/unknown/legacy/other-module, caller/gzip/schema mutation, all identity fields, explicit fallback rejection, old-generation masquerade, same-generation revocation and metadata single-flight fingerprint.
- `page-projection-schema-cache.test.cjs`: intended to run against the **actual adopted production cache**, not a fake or transformed implementation. Covers native exact gzip publication, missing-primary/backup behavior, same-generation A→B→A, same-byte rewrite, valid reuse versus stale source-key reuse, no old schema resurrection, native rewrite/full-only generation, corrupted primary, and native backlog touches/fallback mutations. Missing new APIs are real baseline failures. These tests have not run here.

Root should first adopt the helper plus minimal cache/server wiring with its separate policy work, then run these native cases and the existing cache/derived-view/regeneration/compute tests serially. No production readiness, test PASS, timing improvement or final review is claimed by this preparation.
