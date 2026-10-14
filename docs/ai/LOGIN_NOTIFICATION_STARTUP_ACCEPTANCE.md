# Notification startup critical path

User-provided logs show four affected STABLE 7.0.273 starts: the backend and local database become ready, but no UI-ready client report arrives. Earlier-version out-of-memory crashes are separate evidence; no 7.0.273 OOM is established. Logs alone do not identify the exact failed renderer request, so physical-device resolution is not claimed.

A concrete native regression was reproduced independently: the parser-eager global notification client starts a GET on DOMContentLoaded. Its service awaited default-enabled checkAssistant and requested CP, Orders, Collection, LFL and Backlog operational data. With an unavailable/deferred native source, a notification read never returned. This competes with initial data/core requests and violates the existing startup separation.

Notification GET now reads stored alerts/preferences, retaining native owner checks and metadata-only projections. The global client starts its single polling timer only after bl:startup-complete. The existing deterministic assistant/watch/sync interval remains responsible for scans, with the real application UI-ready guard. Explicit Office analyses still use existing native sources. Startup core/data/profile gates and authentication are retained.

The unchanged focused reproduction now returns providerCalls:0 and notificationsReturned:true. Three new live native/client/scheduler regression tests pass; the targeted startup/Office/coordination group passes 39 cases with zero failures/skips. Actual anonymous HTTP/Chromium uses the real username/password form, verifies all three preparation stages, zero notification GETs before Continue, a successful notification GET afterward, TR/EN and zero page errors. A real 1440×960 PNG is included. Corporate source and physical affected-device acceptance remain pending; this is not a claim that this regression is the sole cause of the field stall.

The update must be delivered through a new signed version, not by changing immutable 7.0.273 bytes. Full regression and verified TEST bytes remain prerequisites for STABLE promotion. Unmerged refresh-group development remains paused and excluded.

Complete local regression: 994 files / 9 batches in 292.5 seconds; 7657 cases, 7591 passed, 0 failed, 66 existing Linux/platform/opt-in skips. Skips are not passes. Windows release gate remains a separate required verification.
