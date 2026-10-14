# Agent order editor (cp.order.update)

Office could not edit orders before this packet: the only order tool, `app.order.update`, was contract v1 and Office executes contract v2 capabilities only. `cp.order.update` is a contract v2 adapter over the same native order override service the CP editor uses (`db.patchOrderOverride`), through the shared `agentOrderAdapter` that the legacy Runtime tool also keeps using. No second business rule exists.

Editable on one CP order line (order code, optionally model + colour code): note fields, date revisions, sub-manufacturer, licensor, delivery type, user-defined note-column values and the Shortage mark.

- **Authority**: `cp` area for the user and the agent; IAM edit right on the order; shared-owner fields (dates, sub-manufacturer) follow the HTTP editor's owner rule; identity must resolve to exactly one visible line.
- **Approval / preview**: the fingerprint covers the normalized patch, the orders revision and the complete prior override entry; any concurrent edit returns `OFFICE_PREVIEW_CHANGED`. Unknown note-column ids are refused at preview (`OFFICE_NOTE_COLUMN_UNKNOWN`, TR/EN text) instead of being skipped silently.
- **Write / verification**: CAS on the orders revision, then read-back of every requested field. The screen cache is rewritten incrementally like the HTTP editor (previously every agent edit invalidated the whole page cache).
- **Inverse**: the prior entry of all seven override maps (notes, sub-manufacturer, licensor, delivery, dates, note-column values, shortage) is archived as an owner/job/step-bound artifact; undo restores it at the effect revision and mirrors every restored field to peers. Undo is refused if the note-column definitions changed meanwhile, so values pruned by a definition change are not resurrected. Legacy five-map receipts of `app.order.update` keep restoring.

Validation: `tests/agent-order-note-columns-shortage.test.js` (6 cases, real override store), agent capability/workflow/live-sync tests and the unified access matrix (new explicit decision). Real anonymous HTTP/Chromium acceptance on an isolated demo server, TR and EN: unknown column 422, execution without approval 409 `OFFICE_APPROVAL_REQUIRED`, approved execution completed and verified, the CP row immediately showed the new note-column value and shortage quantity, Office "Undo" restored the previous values, zero page errors.

Review follow-ups:
- A line needs model AND colour code (or neither); one alone is refused (`OFFICE_ORDER_IDENTITY`) because it would write the order-level override every line falls back to. The shared-owner record id now uses the same key rule (also for the HTTP editor).
- Native `ORDER_FORBIDDEN` / `ORDER_SHARED_OWNER_ONLY` surface as `OFFICE_TOOL_FORBIDDEN` / `OFFICE_ORDER_SHARED_OWNER` with TR/EN text. Undo checks shared ownership only if it actually changes dates or sub-manufacturer, so a non-owner can undo their own note/note-column/shortage edit.
- Note-column values are CAS-bound to the definitions revision the preview saw (no partial write if a column is deleted meanwhile).
- The inverse token carries a digest of the post-effect line maps; undo is refused if the line changed afterwards (also covering peer edits that reach the Shared Hub overlay without a local revision). Restoring an absent line entry no longer mirrors an empty note that would shadow the order-level fallback on peers.

## Multi-line edits (`cp.orders.update.batch`)

Up to 50 lines, each with the same fields and checks as `cp.order.update`: identity, IAM edit right, shared owner and unknown note columns. One invalid line refuses the whole batch at preview, and a duplicate line identity is refused too.

- **Write:** the native batch writer of the HTTP batch editor (`db.patchOrderOverrides`) writes all lines in one orders revision. Note columns are CAS-bound to the definitions revision. Every line is read back and the screen cache is rewritten incrementally.
- **Inverse:** the prior entries of all lines are archived owner/job/step-bound. Undo restores them in one write (`db.restoreOrderOverrideReceipts`, one revision), so a batch is undone completely or not at all. The single-line restore now shares this code path.
- **Undo refusal:** the token carries a digest of all post-effect line maps, so undo is refused if any line changed afterwards. It is also refused after a note-column definition change, the same rule as single edits.

## Note-column definitions (`cp.notecolumns.update`)

The full shared definition list, as CP › Add Column saves it, using the same `replaceNoteColumnDefs` service. A new column without an id gets a deterministic id; a column whose label matches an existing one keeps that column's id.

- **Duplicates and no-ops:** duplicate ids or labels (which the native normalizer would drop silently) and a request that changes nothing are refused.
- **Preview:** added, changed and removed ids, the resulting list and the number of order lines whose values the removal prunes.
- **Apply:** refused if a value was written to a removed column after the preview. The write is CAS-bound to the definitions revision and verified.
- **Inverse:** restores the exact prior list and the pruned values (`db.restoreNoteColumnDefs`). It is refused once a value was entered in a column that the inverse would remove.

Validation: `tests/agent-order-batch-notecolumns.test.js` has 4 cases on the real override store. The single-edit and overview source contracts were updated to the new adapter and call site with all assertions kept.

Real Chromium acceptance on an isolated demo server, TR and EN:
- **Batch:** a 3-line note batch returned 409 without approval. The approved run completed in one revision and the notes were visible in the CP rows. Undo removed them.
- **Note columns:** adding a column completed, and undo removed it.
- No page errors.

An undo is refused once the definitions changed after a batch that touches note columns (`REVISION_CONFLICT`), as for single edits. This is deliberate.
