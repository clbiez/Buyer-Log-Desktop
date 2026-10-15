# Agent supplier checklist workbook import

`cp.checklist.supplier.import` (IMPORT, approval, CP.VIEW + CP.EDIT) reads a Buyer Log supplier checklist workbook that the owner uploaded to the Office artifact store (`POST /api/agent-office/artifacts/workbook`, kind `workbook`, owner-isolated, 48 h TTL).

One engine, no second implementation:

- **Parser:** `parseSupplierWorkbook` in `public/checklist-supplier-sync.js`, which the CP › Checklist › Excel import button now calls too. It covers meta/schema checks, hidden identity columns, the load-date stale gate, formula cells, the state aliases and the owner's custom statuses.
- **Applicability:** the same CP decision engines (`cp-readiness-engine.analyzeOrder` + `cp-rules-engine.evaluateOrder`) with the owner's merged rules, as `cp-agent-tools` rule preview uses. Custom statuses come from the synced `lcw.cp.checklist.custom-statuses.v1` preference.
- **Write:** native `checklist-supplier-store.applyEntries` with source `supplier_excel`, so the export-time `baseAt` gate keeps every answer that Buyer Log changed after the export (`conflicts`).

Scope and safety:

- **Edit scope:** rows for orders the owner may not edit (`authorizedOrders({write:true})`) are skipped and counted as `forbidden`.
- **Preview:** shows every skip reason (blank, invalid, not applicable, formula, stale row, forbidden), predicted conflicts, the artifact hash and the first 50 changes. The approval is bound to that preview and to the CP source revision.
- **Inverse:** the exact prior answer/tombstone of every touched key, archived owner/job/step-bound. Undo uses `restoreEntries`, CAS-bound to the effect revision.

## Export (`cp.checklist.supplier.export`)

`cp.checklist.supplier.export` (EXPORT, approval, CP.VIEW) builds the supplier workbook with the same builder as CP › Checklist › Excel. `buildSupplierWorkbook` was extracted from `exportWorkbook` in `public/checklist-supplier-sync.js`, and the CP button now calls it too.

- **What goes in:** sheets, protection, data validation, the summary and instructions sheets, and the meta sheet are identical. The rows are the requested order keys the owner may read. Decisions and answers come from the same engines and the same answer lookup: order answer, approved reusable option answer, approved PLM milestone. Custom status names and the language come from the owner.
- **Images:** model images are read from the local image store with the screen's key order (colour, then model; an empty colour entry hides the image).
- **Output:** the file is saved as an Office output (same download as report exports).
- **Concurrency:** the builder's language/status context is module-level, so server builds are serialized.

The `agent-checklist-supplier-export.test.js` round trip (3 cases) covers:
- an export for scoped orders only, with current answers and custom status names, protected;
- a supplier-filled copy importing back through `cp.checklist.supplier.import`;
- refusal when no order is readable.

Real Chromium on an isolated demo server, TR and EN:
- 409 without approval;
- the approved export completed, and the file downloaded from the task with TR/EN sheet names, 12 data rows and protection;
- no page errors.

Data rows follow the hidden status-choice rows (rows 2…n of the validation list), exactly as in the existing CP export; the import skips those rows.

Validation: `tests/agent-checklist-supplier-import.test.js` has 4 cases:

- every skip reason, the supplier_excel write and the exact inverse;
- a newer Buyer Log answer predicted and kept;
- source change after preview, foreign/corrupt/empty workbooks refused before writing;
- the shared parser contract.

The existing checklist and supplier sync tests, the unified access matrix and the i18n guard also pass.

# Agent PLM technical sheet download

`collection.plm.techsheet.download` (EXECUTE, approval, Collection) runs the same technical sheet download as Collection › PLM Sync. The route body is now a shared service in `server/routes/plm-sync-routes.js` (`prepareTechnicalSheetItems` + `downloadTechnicalSheets`), which the HTTP route still calls; behaviour is unchanged.

How it runs:

- **Session and job:** the owner's own PLM session (`agentBrowserConnector.downloadCoreNectumTechnicalSheets`) and one PLM job in the operations centre, so cancel works.
- **Store write:** the same model-files write. An earlier PLM sheet of the model is replaced and user uploads are kept.
- **Preview:** reads only local data (style links, current sheet status, a running download) and never contacts PLM. A second download while one is running is refused (`OFFICE_OPERATION_IN_PROGRESS`).
- **Receipt and polling:** the start returns the PLM job id as a `native-operation` receipt, and the Office poller awaits the result (saved, failed items with codes).
- **Restart and rollback:** after a server restart the receipt is unknown and the poll fails closed. Sheets that were already saved stay visible through `collection.plm.techsheet.status`. Replacing a PLM sheet deletes the earlier file, so the step declares no rollback.

BOM/link refresh is `collection.plm.fetch` (existing, AI off).

## Model images and sample requests

`collection.plm.images.import` and `collection.plm.samples.sync` (EXECUTE, approval) run the existing route handlers in-process with the owner's profile, through `agent-native-route-runs`. These are `runPlmImageImport` (`/api/model-images/import-plm`) and `runSampleRequestSync` (`/api/plm-requests/sync`); the routes call the same functions.

- **Job id:** each handler creates its PLM job synchronously and reports the id (`req.onPlmJob`), which becomes the native-operation receipt.
- **Authority:** it is rechecked after the local plan, right before PLM is contacted (`req.assertAuthority`).
- **Images:** run with `overwriteManual:false`, so manual images are never replaced.
- **Result:** a failed, missing or not-found model makes the step partial. A missing PLM session maps to `OFFICE_PLM_SESSION_REQUIRED` (TR/EN text).
- **Rollback:** neither step declares one (it is a PLM refresh).

`tests/agent-plm-route-runs.test.js` has 3 cases. The sample module is real, with a stand-in PLM client.

Real Chromium, TR and EN:
- 409 without approval;
- the approved start was awaited, then stopped with the PLM-session message (no corporate session here);
- no page errors.

**Unverified:** no corporate CoreNectum session was available. The connector is a stand-in in `tests/agent-plm-techsheet-download.test.js`, which has 2 cases:

- preview without a PLM call, approval-bound start, concurrent refusal, pending then verified poll, store and status read;
- owner isolation, unknown receipt, and the user route contract.

The existing PLM technical sheet source contracts (re-anchored to the shared service, all assertions kept) also pass.
