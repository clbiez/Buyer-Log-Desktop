# AI layout request value isolation

Base Main: `c2ad0b99aa968582ede4e31ac2eb7f161dba8ed8` (PR #971). Scope: only the explicit Advanced AI layout request. Rendering, geometry, worker scheduling, source data and all other startup/network paths are unchanged byte-for-byte from that base.

Budget for this follow-up: request preparation below 50ms at the existing 30k record limit; omit every source-derived manual group title/token placement; preserve the original draft. No added request, timer, worker or startup work.

The candidate removes manual placements **before** cloning the layout, so large value-bearing arrays are neither traversed by the clone nor serialized into the AI request. The rest of the context remains as documented (layout settings and field names).

`benchmark.cjs` records three alternating before/after pairs for 24, 240 and 30k placements. `samples.json` contains per-operation serialization time and exact request bytes. This isolates the only changed computation; it is not a claim about remote AI response time or end-to-end inference latency. Every candidate sample must be below the 50ms budget, contain no private group value and preserve the input.

The actual shipped editor browser acceptance independently captures the request at the API boundary, verifies an empty placement array and no source group value, and verifies that the original draft still has its manual placements. Using `MATRIX_EDITOR_SOURCE` with the base editor makes this regression fail; the candidate passes. Capturing the request uses a local fixture API.

Reproduce with the app dependencies and Playwright available:

```
node docs/performance/presentation-ai-layout/benchmark.cjs
node resources/app/tests/helpers/lcwai-column-matrix.browser.cjs
```

Decision: PASS for this bounded request-preparation change. The earlier matrix UI/30k acceptance remains applicable because those executable paths are unchanged; Windows TEST regression still gates STABLE publication. There is no changed native/Electron boundary.
