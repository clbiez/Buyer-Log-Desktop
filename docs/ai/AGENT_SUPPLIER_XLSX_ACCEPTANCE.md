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

Building the supplier workbook stays in CP (it embeds product images and sheet protection from the open page); the agent path is the import.

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

BOM/link refresh is `collection.plm.fetch` (existing, AI off). Model image import from PLM and sample request refresh remain user flows.

**Unverified:** no corporate CoreNectum session was available. The connector is a stand-in in `tests/agent-plm-techsheet-download.test.js`, which has 2 cases:

- preview without a PLM call, approval-bound start, concurrent refusal, pending then verified poll, store and status read;
- owner isolation, unknown receipt, and the user route contract.

The existing PLM technical sheet source contracts (re-anchored to the shared service, all assertions kept) also pass.
