# Trusted server module-schema opt-in — inactive preparation

**TR:** Yalnız bu yeni `/tmp` paketi yazıldı. Kod/syntax/test/server/browser/benchmark çalıştırılmadı; hiçbir worktree değişmedi. Root'un seri maliyet cohort'una dokunulmadı. Kaynak `7f8adc97e1b26276cd849cdd34a6dada142779e9`, app tree `b6d4a17129c2e9ef6e4c67ce86f02a3b43319929`. Bu metadata hazırlığı default thin, performans/yetki kazanımı veya final P1 review değildir.

**EN:** Small server-only flags adapter, using the real current target resolvers. No independent field/target registry, DB, worker or source ownership mechanism. Current #891 inventory and canonical bindings remain unchanged. Unknown metadata produces false grants/null schemas and the existing full fallback.

## Exact current source observations

Paths below are under `resources/app/`; hashes/anchors are pinned in `source-pins.json`.

| Current source | Observation and consequence |
| --- | --- |
| `server/server.js:8470–8488` computeParamsFor | `data={...parts,...}` computes access/horizons, broad cpAllowed and all-connections flattened cpModelColumns. It does not opt in to collectModuleSchemas or derive the six flags. Client/parts values must not become the future authority. |
| `server/server.js:8478` broad cpAllowed | True for any Overview/CP/Orders/Collection/Shipping/Source area (or no profile). It is a compute-data switch, not CP-schema permission. The adapter never reads it. |
| `server/lib/user-access.js:445` hasArea | Uses actual effective/IAM area resolution. Production adapter must call it on the guard's live **caller** profile for exact `cp` and `orders`; publicProfile/accessAreas or the source owner's profile is not a substitute. No-profile/internal string calls stay unknown. Existing guard still owns active/session/access/generation authorization. |
| `server/db.js:1307–1331,1347–1484` | loadModelConnections returns normalized items/revision/config versions; CP definitions have stable header/id/table/name/kind metadata. It normalizes scopes/parked bindings. No new raw-definition normalization is added here. |
| `server/server.js:7998–8027,8059–8103` | Context includes connection revision/effective connections and current access; effectiveHorizonForTarget may use already-applied source/persisted horizon before current settings. Metadata flags cannot infer actual row equality from a current horizon label/hash. |
| `server/lib/user-preferences.js:656–743` | Real applyHorizonOverrides resolves caller/role preferences and splits per-target horizons while preserving current bindings. Reuse it on the same captured connections/role entries; do not recreate this resolution in an adapter. |
| `server/lib/model-refresh.js:46–65,1039–1071` | selectRefreshConnections and resolveRoleTargets implement actual active selection/order and first-claim scope resolution; effectiveScopes has legacy recovery. New policy calls those real helpers and rejects conflicts/empty-scope inference. |
| `server/lib/model-refresh.js:805–817` | cpColumns enter query mapping only if `_scopeTargets` is empty or contains cp. Orders is not automatically the same model-column producer. |
| `server/lib/model-scopes.js:154–183,427` | CP and other-module horizon groups are explicitly separate; scopeByTarget is the existing target resolver. Shared names/equal horizon text do not prove equal data. |
| `server/lib/compute-tasks.js:20–27,28–47` | scopedOrders prefers immutable source-applied horizons. buildProjections checks actual CP/Orders row reference/order and Antrepo object identity. Orders-only output does not need CP output; metadata hook is internal options.onSchemas only. |
| `server/lib/compute-module-schemas.js:28–55` | Requires CP exposure+target+bindings true before either schema; Orders additionally requires independent three flags and actual sameRows/sameAntrepo. Missing raw definitions stay unknown; [] is known empty only under the full grant. Adapter does not weaken these checks. |
| `server/workers/compute-worker.js:160–164` | Only strict `params.collectModuleSchemas===true` installs the callback/sidecar; ordinary output remains unchanged. Current default server caller never enables it. |
| `server/server.js:8174–8175,8548`; `server/lib/compute-read-service.js:23` | Existing direct projection publisher can receive a separate private fifth argument. Existing shared computeReads passes four paramsFor args and stays OFF; do not smuggle schema mode through its public keyParts/payload or create unkeyed sharing. |

## Proposed API and first supported slice

`server-lib/compute-module-schema-policy.js` exports one pure `moduleSchemaParams(context, {hasArea,modelRefresh,modelScopes})` function. `context.collect:true` is exclusively the proposed server-owned fifth-argument decision in `server-caller-snippet.txt`. The returned seven flags must be spread **last** over data, overriding forged parts values. Default/non-projection/unsupported target calls return frozen OFF without metadata/permission work. No real server patch is applied.

Context schema targets are the CP/Orders subset of actual requested modules; actual worker `data.modules` is not modified. Connections are one authoritative normalized `loadModelConnections()` capture, also used by the unchanged legacy cpModelColumns flatten expression. EffectiveConnections comes from the existing user preference resolver on that same capture. Permissions use current live hasArea callbacks, not raw booleans on the request/profile.

The bounded first slice is **database ASAS + database Antrepo**, explicit normalized scopes and current matching configuration IDs/versions/column bindings. Missing, malformed, accessor/proxy, stale effective capture, Excel/dashboard or legacy empty-scope recovery remains unknown. CP-denied Orders schema is always denied even when Orders full rows are otherwise allowed. No inactive/null-profile exception grants metadata.

The adapter permits authoritative [] definitions only when the store, target and binding are known. It resolves CP/Orders through actual target helpers, rejects target conflicts and demands all globally flattened definitions belong to active CP producer connections. It never silently filters out disabled/out-of-target/custom/intake definitions to manufacture known metadata. Duplicate model headers reject bindings. Orders requires its own known target plus the same current ASAS/Antrepo connection IDs as CP; a missing optional Antrepo producer is known only when consistently absent in the current complete metadata.

Different valid personal horizon scopes can still have known metadata. The worker's actual row/Antrepo identity checks remain mandatory and may keep Orders schema null. Current CP/Orders grouping often does not share source row objects; this packet makes no claim that a measured source qualifies. Source modelRefresh connection labels/scopes/appliedHorizons are not a full durable definition/config fingerprint. Outer current source/generation/input/checksum binding and full raw-key universe still belong to root's worker/cache publication, not these booleans.

Excel/dashboard producer metadata, broad all-connections definitions that do not match current CP binding, or conflicting target ownership are explicit unsupported cases. They use exact full fallback. Extending those cases needs their actual producer metadata contract, not a guessed `true`.

## Native drafts and remaining root work

`module-schema-policy.test.cjs` contains16 unrun cases. They use actual pinned model-refresh/model-scopes target functions and actual compute-tasks/module-schema/parser implementation for the narrow synthetic integration. The injected permission predicate is a controlled live-grant fixture, **not an IAM/P1 proof**; it checks the exact caller/profile/area requests. Existing user-access/compute-guard tests remain the real authority tests.

Cases cover default OFF/no getter reads; explicit DB grants; forged public flags; CP-denied Orders with broad cpAllowed; independent Orders permission; unknown profile/nonboolean grants; unsupported source modes; known-empty vs missing metadata; disabled/parked targets; distinct connection IDs; global inactive/foreign/out-of-target definitions; conflicts/duplicate headers; config/effective drift; real horizon/Antrepo mismatch rejection; actual full-output equality and raw-definition preservation; getters fail closed.

All existing compute-module-schemas tests/assertions and their frozen fixtures remain untouched and pinned. No loader/ModuleNotFound failure is a behavioral RED. Runtime helper hashes must remain exact; observed server/db/user-access hashes are archived source observations, not moving-HEAD runtime assertions. If root changes a runtime helper during adoption, preserve this packet and review its semantic pin delta instead of blindly refreshing hashes.

After the current cohort, root can run serially (UNRUN here):

```sh
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock node --test /tmp/buyerlog-phase6a-module-schema-policy-preparation/module-schema-policy.test.cjs
```

Root owns exact caller placement/imports, current capture/role-profile semantics, reading lease.value.moduleSchemas, same-generation/cache-manifest publication and initial response metadata, standard tests and actual shadow acceptance. Keep default public full rows. Preserve #892 Orders-only/input-counter behavior and #916 checklist row caches; any CP-touching performance integration still requires firstCPintent before/after on #916 in both arms with no regression. No measurement is performed or inferred here.
