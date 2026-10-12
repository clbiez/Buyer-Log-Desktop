# Buyer Log: current registered Office capability coverage

Generated from the current unified access-matrix fixture on 2026-10-12. This table counts registered contract-v2 tools, not all native user actions. It does not prove module completion, UI acceptance, a merged PR or a release. Local package checkpoints and the original native route inventory remain in AGENT_CAPABILITY_PLATFORM_2.md.

| Module | Tools | READ | CREATE | UPDATE | DELETE | IMPORT | EXPORT | EXECUTE | SCHEDULE | SEND | APPROVE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| overview | 0 | — | — | — | — | — | — | — | — | — | — |
| cp | 20 | 6 | 2 | 7 | 2 | 1 | 2 | — | — | — | — |
| orders | 16 | 5 | 2 | 6 | 2 | — | 1 | — | — | — | — |
| koleksiyon | 28 | 8 | 3 | 8 | 4 | 1 | 3 | 1 | — | — | — |
| quotations | 6 | 1 | 1 | 3 | — | — | — | — | — | — | 1 |
| pricinghistory | 0 | — | — | — | — | — | — | — | — | — | — |
| priceanalysis | 0 | — | — | — | — | — | — | — | — | — | — |
| lcwai | 0 | — | — | — | — | — | — | — | — | — | — |
| agentoffice | 0 | — | — | — | — | — | — | — | — | — | — |
| manufacturers | 10 | 3 | 2 | 3 | 1 | 1 | — | — | — | — | — |
| licensecards | 3 | 1 | — | 1 | — | 1 | — | — | — | — | — |
| lfl | 6 | 4 | — | — | — | — | 2 | — | — | — | — |
| opencosting | 6 | 2 | 1 | 1 | 1 | — | 1 | — | — | — | — |
| backlog | 6 | 4 | — | — | — | — | 2 | — | — | — | — |
| shipping | 27 | 7 | 2 | 11 | 3 | 2 | 2 | — | — | — | — |
| automations | 10 | 4 | 1 | 2 | 1 | — | — | 1 | 1 | — | — |
| source | 27 | 10 | 2 | 9 | 4 | 2 | — | — | — | — | — |
| agents | 0 | — | — | — | — | — | — | — | — | — | — |

Total: 165 registered contract-v2 capabilities. READ calculations use the native deterministic engines. EXPORT is an approved file effect; it does not imply SEND. Business APPROVE tools belong to native quotation/status workflows. The generic Office read-only scheduler and native approved automation schedule services are separately represented by their actual APIs and existing automation tools. SEND remains unavailable because no authorized corporate sending channel has been verified.

Output-contract audit: 106 strict top-level output objects and 59 generic/open output envelopes remain. See `AGENT_CAPABILITY_OUTPUT_GAPS.md` for exact tool IDs; contractVersion 2 alone does not prove complete field-level output typing.

## Remaining native workflow decisions

- Source connection create/delete, approved configured query targets, mapping/schema discovery, refresh-group execution and native exports: reuse model/source services; reject arbitrary hosts, queries, credentials and code.
- OAB/INTAKE: reuse native metadata/query/session/batch workers, current overview + OAB.VIEW, owner job/result receipts and native cancellation; do not invent another fetch worker.
- PLM samples/BOM/images/attachments: reuse current corporate session, native job/store services and exact model/order/color identities; corporate/Windows acceptance remains pending.
- Orders/checklist: native shared definitions, notes/answers and attachment mutations need current order scope, evidence revisions and native locks beyond existing CP personal Rules/Quality adapters.
- Personal presets: Focus/Extended and cross-user preset sharing remain outside the delivered saved view/filter lifecycle. Applying saved profiles to an already open renderer is explicitly not claimed.
- Manufacturer directory: card/e-mail record CRUD is delivered; country/group heading management is now delivered; native import/merge is now delivered with verified partial receipts and selective native inverses; exact authorized ASAS name discovery/linking and native missing-card/country creation are now delivered with approval, source binding and atomic inverse.
- Native landed multipliers, supported larger exports and remaining module functions must be assessed against the initial route inventory, not inferred from a broad module capability flag.
- Earlier native multi-document adapters still require a final live-IAM/profile/journal and partial-effect audit. Directory, Endeksmatik and Transit/Royalty/FX boundary gaps found during this continuation are fixed and covered by actual durable-reader regressions.

## Delivery status

Expanded full regression has not yet run. Actual HTTP/browser/PDF and corporate acceptance are unfinished or environment-blocked. Forty-eight real post-change release-note captures are pending in the current development branch, including task pause, partial undo, updater retry and native manufacturer import/sync deletion and ASAS link/create. GitHub write operations require approval unavailable under this environment policy. No new PR beyond the earlier drafts #498–#500, merge, TEST or STABLE release is claimed. The user cancelled the renewed partial TEST request after its failed preflight (b915183258a1c8de9b22e7bde19ea2eceb6f803e, 7.0.271; 42 missing post-change PNGs and HTTP listen EPERM). No full regression, build, signing or publication was triggered. Development continues. The already published TEST 7.0.271 is an earlier package, not this local development stack; different bytes require a new SemVer. Final STABLE must promote the same signed bytes of a fully verified TEST package.
