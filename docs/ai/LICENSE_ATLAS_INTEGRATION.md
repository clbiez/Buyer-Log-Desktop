# Original License Atlas integration

The License Cards module uses the uploaded Atlas presentation, including its complete CSS cascade, three-lane tree, animations, covers and Process Studio. `public/license-atlas/PROVENANCE.md` records the reference hash. The reference script and CSS bodies have a pinned fidelity check; additive adapters integrate Buyer Log without rewriting the tree.

The presentation runs in an opaque sandbox. Buyer Log fetches its component files into `srcdoc` because the server forbids framing HTTP pages. The child has no cookie, local-storage or API access. The parent validates message source identity and owns authorization, API calls, commercial forms and conflict handling. TR/EN and reduced-motion behavior remain available.

Atlas edits are staged until **Save atlas**. Manual-editor changes first use **Apply changes**; Process Studio changes are saved after closing its window. Commercial edits retain the existing card save, contract validation, scoped edit token and rate-cache updates. Atlas batches validate every card before one durable write and publish through the existing outbox. A failed save retains the draft; discard reloads current server data.

Legacy card-scoped asset/address/option libraries are merged with collision remapping. Ownership and references determine each saved card's metadata so independent image libraries do not consume every other card's existing 2 MB budget. Original-library presets remain available in Process Studio without being copied into each saved profile. Internal notes and translations survive normalization.

Supplier export projects each card through the existing explicit-sharing allowlist, merges only those public projections, then uses the uploaded interactive supplier template. Source-note opt-out overrides legacy flags. Route instructions are adapted to the original supplier renderer. Financial rules, access fields and unshared notes never enter its payload.

## Verification

- All 1,042 test files were covered locally across the canonical batches. Eight files affected by the restricted local-network environment passed their targeted reruns with networking enabled. The design-token guard passed after the parent drawer was adjusted to Buyer Log tokens.
- Final focused run: nine test files, 68 assertions passed.
- The bilingual coverage check has zero new or baseline omissions.
- Real-app Chromium acceptance verifies original tree DOM, save failure and retry, unchanged contracts on atlas save, immediate export after saving, contract editing, visible supplier instructions, export privacy, complete-tree copying, TR/EN, mobile resize and read-only expansion.
- Release-note PNGs use only demo fixtures and the real Buyer Log UI. The existing Overview pending entry is retained.

To reproduce the browser checks, install Playwright in the development environment and run `node scripts/license-atlas-ui-acceptance.js` from `resources/app`. Use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` if Chromium is not in Playwright's default installation, `BUYER_LOG_ATLAS_ARTIFACT_ROOT` to retain screenshots, and `BUYER_LOG_ATLAS_TEST_PORT` to choose an unused local port (default 6452). The script starts its own server and uses isolated demo data.

The server must restart to load the batch endpoint; the desktop release workflow packages these changes normally.
