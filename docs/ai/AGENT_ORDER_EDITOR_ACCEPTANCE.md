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

Not included: editing note-column definitions and multi-line batch edits (the HTTP batch editor remains user-only).
