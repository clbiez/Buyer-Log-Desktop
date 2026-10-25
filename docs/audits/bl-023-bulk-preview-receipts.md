# BL023 — bulk preview and acknowledged results

CP and Collection paste, supplier prices and checklist imports preview before/after values and skipped counts. The canonical native writers remain the mutation path. CP/Collection prepare on temporary copies; HTTP failure cannot put an unacknowledged bulk value into the next ordinary save. Supplier prices require both the ledger revision and unchanged model/row/manufacturer identity.

The client stores bounded per-user, per-device receipts before sending. Accepted/rejected/unknown outcomes are distinct; an unknown response is never automatically replayed. Checklist partial retry re-previews only rejected keys. Bulk Undo guards current ownership/revision and preserves concurrent newer history entries. Collection projections run only after its primary ACK and are reported separately.

Validation: **33 files, 222 tests, 222 passed, 0 failed/skipped**; actual production-server/Edge acceptance has **15 phases**, including controlled 409/500/no-write errors, durable Undo/Redo, real foreign-buyer 403, partial checklist retry and reload without replay. A 10,000-row actual Worker roundtrip preserves ID text, dates, formatting, formula zero cache and PNG bytes. The actual template manager upload/mapping works. All seven readonly Desktop Endeksmatik originals remain accepted with identical hashes.

An independent single-round review found three P1 consistency races; the root applied fixes and regression/native checks. There was no second review round. The reader merge-range observation is also regression covered before ExcelJS expansion.

Evidence and limits: [machine-readable report](bl023-bulk-acknowledgements-20261025.json). Full integrated certification and GitHub merge remain pending. No release was dispatched.
