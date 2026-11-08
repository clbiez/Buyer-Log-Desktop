# Bounded ready-cache info — inactive preparation / hazırlık

**TR:** Yalnız bu yeni `/tmp` dizini yazıldı. Hiçbir kod/syntax/test/server/browser/benchmark çalıştırılmadı; üretim veya worktree dosyası değişmedi. Root'un gerçek CP ölçümüne dokunulmadı. Kaynak commit `b6c8504ae418ebe731af7000f33e0eb1aa2f9f17`, app tree `feeddb6c9d7e470fe4a1ad5e047cbcfd3ae58b8c`, cache blob `95361cce870e8c94403cac2f91726e493a5520d0` / SHA256 `cb0123c09194cf7c48c39f1c1bab0756f2bebec8060f2bedea3aa45a196f7222` olarak sabit.

**EN:** Narrow extension of the existing `readViewCompressed`/`writeViewCompressed` APIs. No registry overload, store, persistent map, worker, route, default-thin or admission change. No performance, authorization or phase-completion claim. Added descriptor validation/copy/hash costs are unmeasured.

## Minimal API extension

```js
// Existing five-field entry is still valid, with unchanged legacy behavior.
await cache.writeViewCompressed(ownerId, 'orders', pin, {
  buffer, bytes: buffer.length, uncompressedBytes, checksum, registryKeys,
  info: readyResult.info // optional NEW field, independent of registryKeys
});
const hit = await cache.readViewCompressed(ownerId, 'orders', pin, {
  requireInfo: true,              // required for any new descriptor consumer
  infoChecksum: expectedIdentity  // optional exact identity fence
});
// hit === null or { ...existingFields, info: detachedJSON, infoChecksum }
```

The new caller must use `requireInfo:true` (an expected checksum implies it). Missing legacy info then returns null; it is never reconstructed, inferred from `registryKeys` or substituted from another plan/generation. Existing three-argument reads remain compatible with old entries. Invalid read option shape/checksum fails closed.

`entry.info` is a plain JSON data record. The validator rejects getters, proxies, Date/nonplain objects, functions/symbols/undefined/nonfinite numbers, sparse arrays, cycles and JSON hooks without invoking them. It copies only bounded metadata before the operation enters the existing queue; rows/body graphs are not copied. Acyclic aliases are copied as JSON values. `-0` becomes JSON's `0`; arbitrary object descriptors/alias identity are not the contract. Unicode/escapes are charged by actual UTF8 JSON byte count. Validation is bounded to64 KiB,16384 nodes and depth24; conservative failure is a cache miss.

The separate optional manifest fields are `info` and `infoChecksum` (both or neither). Existing legacy metadata stays10 fields; descriptor metadata has12. Ordered `JSON.stringify(info)` is the stable representation. Its checksum binds the domain tag, exact owner/module/all seven existing cache pins, compressed view checksum and ordered info JSON. Identical inputs yield the same identity; any pin/body/descriptor change has a different identity. Missing/corrupt/swapped descriptor/checksum rejects. This is an unkeyed integrity binding, **not authentication**.

Write input is detached before await. Every read's returned top-level `info` is a fresh detached copy, separate from returned `meta.info`/manifest references; mutating any returned graph cannot alter persisted metadata or a later read. Metadata remains published in the same primary manifest patch as its view checksum/pins, after verified gzip bytes. Current generation/full source/queue/strict derived rename/no-previous-fallback policies remain unchanged.

All metadata, including info/checksum and registry keys, consumes the **existing aggregate catalogue64 KiB cap**; info alone also cannot exceed it. Existing2-entry/32 MiB compressed/128 MiB raw limits remain unchanged. Large info can reduce cache admission or evict another optional view; no improvement is claimed. No fsync/cross-process-lock/RSS bound was added.

## Actual producer shape and caller boundary

The unmodified `/tmp/buyerlog-phase6a-ready-json-builder/ready-json-builder.cjs` (SHA256 `02664e78892b8d3399edde6ad2e76e32a2e705282d8d6adb3992ff60fce95719`) creates:

```js
{
  schemaVersion: 1, module: 'orders',
  schema: knownOwnOrdersSchema, omittedKeys: [...keys],
  viewInfo: { ownerId, actorId, sourceKey, sourceGeneration,
    accessHash, planEpoch, fullJsonSha256, fullJsonBytes }
}
```

Its requestNonce is deliberately absent. Raw schema definitions/header/id/role/group/dataType/sourceMetadata/percentageScale and own-key order are preserved as data. The exact producer/schema/native/canonical sources are copied under `producer-reference/` and hash-pinned for native fixtures; no alternative registry or schema engine is created.

The cache keeps this descriptor opaque. Root must validate actual ready-info schema/version/module, current source/full JSON SHA/bytes, plan/access/actor/epoch and coherent `{buffer,info}` pairing from the trusted worker. The cache does not inflate gzip to prove that `info` equals `body.projection`, does not grant authorization and does not certify hidden-field closure. Required-info read mode plus existing outer current-primary/source/access guards are mandatory for the new ready path. The builder's maximum raw allowance includes metadata, while the existing cache remains128 MiB total; oversize bodies still miss, not truncate.

## Native preparation and preserved evidence

`legacy-ready-view-cache.test.cjs` is a **byte-exact copy of the existing v2 twenty-case test file**, including the original expected-true legacy index1 assertion. Old package source/tests, `v1-frozen/`, root RED/GREEN evidence and current production tests/assertions are not modified.

`descriptor-cache.test.cjs` adds12 cases using actual pinned ready-json-builder/schema/native/canonical code: descriptor/body/registry coherence, required legacy miss, input/read mutation isolation, stable bound identity, raw definition key/value preservation, unsupported JSON input,64 KiB caps, missing/corrupt/swapped metadata, stale context/full bytes, publication failure and queued option snapshots. A producer fixture/load failure is a prerequisite/setup failure, not behavioral RED; root must identify it separately. No loader failure is fabricated.

Root owns the only execution under the shared lock after CP measurements. Suggested serial commands (all UNRUN here):

```sh
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock env BUYERLOG_VIEW_CACHE_MODULE=/tmp/buyerlog-phase6a-ready-cache-descriptor-preparation/baseline/page-projection-cache.js node --test /tmp/buyerlog-phase6a-ready-cache-descriptor-preparation/descriptor-cache.test.cjs
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock node --test /tmp/buyerlog-phase6a-ready-cache-descriptor-preparation/descriptor-cache.test.cjs
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock node --test /tmp/buyerlog-phase6a-ready-cache-descriptor-preparation/legacy-ready-view-cache.test.cjs
```

The real current baseline supports old cache APIs but rejects the new sixth `info` field and ignores new read predicates: these meaningful behavior assertions establish RED. Preserve stdout/stderr/exit/source stamps. Candidate GREEN is not claimed.

If root adopts the patch, current official `tests/fixtures/projection-view-cache-pins.json` still pins cache candidate `cb0123c0…`; its source expectation must be updated to the exact reviewed new helper for the existing fixture/source assertions to run, while historical pin/evidence stays archived. Do not loosen or delete those assertions. No official file/pin change is included here. Root still owns production source adoption, actual worker/HTTP consumption and standard serial checks.
