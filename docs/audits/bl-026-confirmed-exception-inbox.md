# BL026 — scoped confirmed exception inbox

The Overview widget consumes exactly two existing CP readiness reasons: overdue Ex-Factory and Buyer Log–ASAS date mismatch. It uses the existing server-scoped CP endpoint, current Overview filters and canonical order-line identity. It does not invent missing checklist evidence or a new priority engine. Full counts survive the bounded per-type 200-item list.

Snapshots come from confirmed server data, independently of optimistic grid rows. Existing single and bulk writers notify the visible inbox only after durable ACK. Held or failed writes cannot dismiss a signal. Opening an exception rechecks its current scoped record/reason, then opens the existing detail drawer. Hidden widgets cancel reads; no hidden grid is rendered.

Validation: **11 files / 72 passed / 0 failed or skipped**. Actual server/Edge: **11 phases**, covering native reasons, no hidden grid/script initialization, unsaved client mutation, held ACK, failed write, canonical detail drill, Overview filtering, TR/EN/three themes/keyboard focus, hidden widget, two Buyer sessions and live permission loss. Both screenshots inspected.

Integration checks also found and fixed four undefined BL023 preview tokens and an extracted date-Undo test fixture missing the real bulk-preparation flag. Existing assertions remain; all **15 real bulk scenarios** pass again and seven updated PNGs were inspected.

[Machine-readable evidence](bl026-exception-inbox-20261025.json). Populated Electron benchmark, final integrated full/CI/batch merge remain pending. No publication was dispatched.
