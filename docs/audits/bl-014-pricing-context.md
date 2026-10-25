# BL-014 — measure and cache the actual Collection pricing path

Implementation and focused/native verification complete; final integrated full, main-target CI and merge remain deferred by user direction. Stacked on BL-017. No publication or workflow dispatch.

## Scope follows the active runtime

The original audit benchmark targeted server calculator construction/fingerprinting. Targeted Git source references found its only direct import in tests. The active Collection path is `license-royalty-commissions.js` → shared pricing engine, with `kolPricingRuleContext` repeatedly calling a full CP `.find`. Optimizing the unused server constructor would not establish a desktop improvement, so this change targets the measured client path. The server calculator remains a financial parity reference; its fingerprint is unchanged.

CP context now uses a weak array index, preserving the old numeric-equivalent order code and first-partial precedence. It stores live row references, so changed country/license/season values remain visible. Array/length, owner/authority and source revision changes invalidate the map; stale identity candidates are revalidated. Same-length in-place membership/identity replacement requires explicit revision/invalidation. Current production projection writers replace arrays and the identity columns are read-only.

Selected royalty rules and missing results use a bounded512-entry cache keyed by Collection's matching dimensions/country side. New rule array, length, explicit rule revision, owner/authority or merge configuration clears it. Existing exact selection, any-own-contract suppression of alias fallback, future-contract priority, season/commission filtering and tie ordering still execute through the original matcher. Inspected production rule writers create new arrays; local in-place drafts must advance revision or invalidate. Prices, manual rates, source/group values, FX and landed results are not cached.

One bounded independent P1 review found no concrete new P0/P1. Its explicit invalidation limit is recorded above. The reviewer did not execute tests/native acceptance.

## Controlled native Edge result

The same current installed calculator runs against300 synthetic Collection records,20 licenses,50 suppliers and30,000 CP fallback rows. Before functions come from source commit `1a2ba78f8e82607da5180ecc3a3093009df6bd40`; after uses the actual loaded client. Five warm samples follow one cold call. Rendering is disabled; these are calculator CPU times, not populated Electron interaction/frame/export times.

| Actual Edge calculator | Cold ms | Warm p50 ms | Warm p95 ms |
|---|---:|---:|---:|
| Before | 642.0 | 630.5 | 641.8 |
| After | 11.4 | 4.5 | 4.8 |

Full output SHA256 is identical: `224bafdd545840ae5c64c383f15cce4ca4e2a76ed554b3fe1aa2ec8bb47bc4f2`. The same run verifies changed manual FX, rule revision, removed TR commission, replaced CP projection and changed owner with a cleared source. It then restores all synthetic client replacements. Persisted demo rows still render their valid prices and the genuine TR/EN price drawer was inspected.

## Separate Node harness and memory evidence

The Node VM harness executes the same installed helper sources. Its VM lookup boundary magnifies repeated scans, so these figures are reported separately and must not be sold as desktop responsiveness:

| Phase | Before p50 ms | After p50 ms | Before p95 ms | After p95 ms |
|---|---:|---:|---:|---:|
|300 context lookups |3282.116 |0.299 |3298.007 |0.394 |
|300 TR rule lookups |3340.928 |0.769 |3347.474 |2.027 |
|300 full calculations |29862.629 |10.025 |30108.113 |11.857 |

Each distribution has seven measured runs after warmup. Node full output hashes also match. One V8 heap sampling pass per side, with32768-byte interval and collected objects included, estimates48,497,744 before versus5,030,064 after sampled allocation bytes for300 calculations. This is sampled allocation, not exact total allocation. Warm post-GC retained deltas (-728/+1720 bytes) do not include cold index construction; separate `bl014-cache-heap.json` records incremental retained CP-index memory with source rows already held. Instrumentation uses the standard [Node inspector API](https://nodejs.org/api/inspector.html).

Raw samples/source hashes: `work/bl014-pricing-baseline.json`, `work/bl014-pricing-after-final.json`, `work/bl014-cache-heap.json`, `work/bl014-pricing-native.json`. The final after harness ran after the long baseline completed. Earlier development measurements are not summed or presented as additional independent samples.

The separately measured30,000-row CP index retains approximately1.79MiB (mean1,879,963 bytes across five separately retained indexes). Source rows were already held. This is an explicit memory tradeoff, not a claim that the cache is free.

## Verification and limits

Final related group:21 files,158 pass,zero failures/skips. It covers cache invalidation and bounded retention, installed helper parity, merged/split licensor decisions, unchanged FX/supplier values, golden financial/date contracts and affected export/analytics projections. A new test initially assumed that doubling FX exactly halves TR Landed; fixed hologram and final rounding make that assumption false. Its expected result now uses the existing authoritative TR contract, without changing arithmetic.

No full test or main-target CI is claimed for this draft stack. Representative populated Electron/exports/concurrent sync and corporate storage/Office remain BL-019. Client files are excluded by fast graph indexing, so this review used direct source/production writer inspection and actual execution. No company records or external data services were used.
