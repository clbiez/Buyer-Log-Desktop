# BL022: contextual shortcuts in the existing palette

CP/Orders/Collection expose their existing actions through Ctrl+Shift+K and a table Actions button. Context metadata explains a missing/hidden selection, read-only record, missing pricing rule or permission. It prepares no modules while listing. Invocation rechecks the canonical record/session token and permission both before and after any lazy load. The palette is a native-action adapter, not a new mutation API.

Canonical order links use the BL013 peer index. Collection links use the existing PLM ID/model key and show every matching model in the authorized current workspace scope. Blank model identities cannot match unrelated blank records. Pricing-rule inspection selects the matching rule in the existing editor only with business-rule permission. Costing and existing reports use their native buttons/guards. Ctrl+K remains CP search.

Module/recent lists use current access; navigation rechecks access rather than clicking an old hidden button. The existing user-scoped workspace preference stores at most five module IDs. No unrelated modules are loaded by opening the palette.

Validation: 16 targeted files, 85 pass, no failure/skip. Actual production server + Edge verifies keyboard discovery, zero added script loads on opening, canonical linked order, both ambiguous Collection matches, empty-selection explanations, a live client permission change refusing the old command, native costing with one persisted record, recent destination and preserved Ctrl+K. Three post-change PNGs inspected. The permission-change native exercise is client presentation; BL016 remains the HTTP server-authority matrix. Details: `bl022-contextual-commands-20261025.json`.

P2 adapter changes only; existing business writers and server authorization are unchanged. Final integrated full/CI/merge are pending; no TEST/STABLE publication. Rollback is the BL022 commit revert, with no business schema migration.
