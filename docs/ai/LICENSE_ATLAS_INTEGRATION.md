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

Supplier file: each license is a native `<details class="lic">` drawer (map opens in place, no
jump links; animated with `::details-content`, printed open). Route rows use fixed columns
(method 180px · recipient · tags 200px right-aligned) so every step lines up.

## Licensor and stage templates

- `PUT /api/license-cards/:id/licensor` `{editToken, licensor, mode, copy}` — default mode fills an
  **empty** licensor in place (same card id); `mode:"add"` creates a separate license × licensor
  row (optionally copying profile, image and map). A set licensor is never renamed: peers identify
  a card by its pair and reject a changed one (`license-card-sync`).
- `POST /api/license-cards/stage-templates` `{template, expectedUpdatedAt}` and
  `DELETE /api/license-cards/stage-templates/:templateId` `{expectedUpdatedAt}` — templates live in
  `overrides.licenseStageTemplates`; a stage links via `templateId`. Saving re-applies the template
  to every linked stage (id and on/off stay; used addresses and the `tpl-<id>` guide image travel);
  deleting unlinks and keeps the step. Linked steps are read-only in the map editor.
- Peers receive templates as the single record `license-card:stage-templates` (allowed in
  `shared-sync-policy.js`, newest `updatedAt` wins); linked stage content arrives as card profiles.
- `POST /api/license-cards/refresh` returns `added`, `resolved`, `discovered`; the page reports them.

## Card images (asset store)

Covers, visual guides, symbols and template guides are **not** stored in `overrides.json`.
`server/lib/license-card-assets.js` writes them content-addressed to
`<server data>/license-card-assets/<sha256>.<ext>` and copies them to
`<shared sync root>/BUYER_LOG_SYNC/license-card-assets/` for other users; records keep only
`/api/license-cards/assets/<sha256>.<ext>` (served by `GET /api/license-cards/assets/:name`,
immutable cache, fetched once from the shared folder when missing locally and hash-verified).
`normalizeProfile`/`normalizeTemplate` externalize incoming data URLs (own uploads and peer
records); `migrateAssets()` moves existing inline images once after startup and re-publishes
the changed cards. The supplier export inlines asset bytes (`inlineAssets`) because the file
allows only `img-src data:`. Inline base64 inside the shared store made every read deep-copy
and every write rewrite tens of MB (120 cards: GET ~10 s, one rate save ~51 s → 0.1 s / 0.3 s).

## Verification

Run `node scripts/license-cards-ui-acceptance.js` from `resources/app` (Playwright + Chromium;
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, `BUYER_LOG_ATLAS_ARTIFACT_ROOT`, `BUYER_LOG_ATLAS_TEST_PORT`).
It starts its own server on isolated demo data and checks: one row per licensor, inline save and
validation, new period without gap, map save preserving existing fields, supplier file privacy,
manual licensor (assign + another row), ASAS refresh feedback, stage template propagation to
two licenses, supplier drawer toggling and route alignment, licensor filter, TR/EN, dark theme
and mobile.
