# License cards and approval maps (native list, 2026-10-22)

The License cards page is a native Buyer Log module; the uploaded iframe Atlas
(`public/license-atlas/`, `license-atlas-shell.js`, `license-atlas.js`,
`license-atlas-workspace.js`) is **no longer loaded** (`perf-runtime.js` › `licensecards`).
Those files remain only until a separate cleanup removes them with their tests.

| File | Role |
| --- | --- |
| `public/license-cards-engine.js` | Pure: rows (one per license × licensor), primary contract, rate parsing/validation (server limits), compact map summary, licensor options, new-period helper |
| `public/license-cards.js` | List view: inline Royalty / TR / YD / Hologram edits (Enter saves, Esc reverts), expanded row (all contracts, contact/portal, image), selection → supplier atlas |
| `public/license-map-editor.js` | Compact approval map drawer: ordered steps, approver, test, routes, sharing, guides, addresses, portal; copy steps from another license |
| `public/license-supplier-atlas.js` | Pure supplier file builder: `BLLicenseAtlasEngine.project()` privacy allowlist, Buyer Log palette, inline Barlow, strict CSP, no script |
| `public/license-cards.css` | Layout only; components join the `experience.css` contracts (`.lcBtn`, `.lcIconBtn`, `.lcSeg`, `.lcChip`) |

Saving uses the existing `PUT /api/license-cards/:id` with the card's `editToken`: only
changed contracts are sent (the server merges by rule id), profile fields are partial, and the
map is sent as `profile.processAtlas`. Drafts are per card; background refreshes never discard
them and never rebuild the list under the cursor; only a verified token change marks a conflict.
A new period copies the latest rates and closes the previous open period of the same scope; if
its start date is edited, the closed period's end follows so no OPD range is left without royalty.

Supplier export contains only the selected rows. Cards without a map export as a plain entry;
licenses switched off in the map (“Include in supplier atlas”) are skipped and reported.

## Verification

Run `node scripts/license-cards-ui-acceptance.js` from `resources/app` (Playwright + Chromium;
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, `BUYER_LOG_ATLAS_ARTIFACT_ROOT`, `BUYER_LOG_ATLAS_TEST_PORT`).
It starts its own server on isolated demo data and checks: one row per licensor, inline save and
validation, new period without gap, map save preserving existing fields, supplier file privacy,
licensor filter, TR/EN, dark theme and mobile.
