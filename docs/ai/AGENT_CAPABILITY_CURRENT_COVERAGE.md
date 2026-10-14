# Buyer Log: current registered Office capability coverage

Generated from the current unified access-matrix fixture on 2026-10-14 (Europe/Istanbul). This table counts registered contract-v2 tools, not all native user actions. It does not prove module completion, UI acceptance, a merged PR or a release. Local package checkpoints and the original native route inventory remain in AGENT_CAPABILITY_PLATFORM_2.md.

| Module | Tools | READ | CREATE | UPDATE | DELETE | IMPORT | EXPORT | EXECUTE | SCHEDULE | SEND | APPROVE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| overview | 11 | 8 | — | — | — | — | — | 3 | — | — | — |
| cp | 30 | 10 | 4 | 10 | 3 | 1 | 3 | — | — | — | — |
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
| source | 29 | 11 | 2 | 10 | 4 | 2 | — | — | — | — | — |
| agents | 0 | — | — | — | — | — | — | — | — | — | — |

Total: 188 registered contract-v2 capabilities. CP Rule save is one native upsert tool covering both CREATE and UPDATE, so those operation columns overlap. READ calculations use the native deterministic engines. EXPORT is an approved file effect; it does not imply SEND. Business APPROVE tools belong to native quotation/status workflows. The generic Office read-only scheduler and native approved automation schedule services are separately represented by their actual APIs and existing automation tools. SEND remains unavailable because no authorized corporate sending channel has been verified.

Output-contract audit: 188 strict top-level output objects and 0 generic/open output envelopes remain. See `AGENT_CAPABILITY_OUTPUT_GAPS.md` for exact tool IDs; contractVersion 2 alone does not prove complete field-level output typing.

## Remaining native workflow decisions

- Source connection create/delete, approved configured query targets, mapping/schema discovery, refresh-group execution and native exports: reuse model/source services; reject arbitrary hosts, queries, credentials and code.
- OAB/INTAKE: owner-local saved snapshots, bounded source-bound paging, native INTAKE field labels/aggregates/weight identity, actual native OAB metadata and public existing-session status and the shared native combination/worst-case plan are delivered as five foundational READ tools under current overview + OAB.VIEW. The original native batch worker now lives in one shared HTTP/Office service with live authority checks and native owner snapshot CAS/readback; owner job progress/cancel/executor-loss receipts are now durable, with native command idempotency. Native row results are now stored as verified owner/job/index chunks and can be read after service reconstruction without replay. Explicit approved native restart continuation is now delivered through the same worker and HTTP/UI: exact unverified triples, immutable captured results, owner receipt revision and native snapshot CAS, original refresh/merge policy and command idempotency. An uncertain snapshot commit that changed the baseline fails closed; cancelled, active or legacy jobs without verified manifests/results cannot continue. Three additional Office READ tools now discover actual native receipts, read verified job-specific rows in bounded pages and inspect continuation scope without starting or approving it. Native receipt metadata and chunk refs/bytes are read under one actual owner lease. Agent revision/scope is rechecked through short native profile WAL guards around reads. The existing Office queue now supports a durable awaiting-operation state and trusted receipt polling with current IAM/agent/revision checks and exact native identity. Production OAB start/continue/cancel adapters now reuse this worker, durable waiting and current asynchronous IAM/agent guards; cache/capability/snapshot writes execute under short actual Office profile WAL guards. Approved partial-result continuation fetches only missing triples. Snapshot inverses preserve the full native before-state and refuse newer revisions. Real corporate/Windows acceptance remains pending.
- PLM samples/BOM/images/attachments: reuse current corporate session, native job/store services and exact model/order/color identities; corporate/Windows acceptance remains pending.
- Orders/checklist: native shared definition READ/create/revise/delete now use actual CP operation permissions, bounded metadata-only public projections, existing Rule validation/dependency engines, shared native revision lease and Office profile WAL, explicit approval and complete native inverses. Legacy normalization is declared in preview; original legacy metadata is restored exactly. Personal rules and stored answers are preserved. Explicit scoped order-answer READ and approved UPDATE/Pending/Rejected/NotRequired now use the same native store, preserve evidence, report partial skipped updates and archive full revision-bound inverses. Reusable option writes, supplier workbook import/export and attachment lifecycle remain separate gaps beyond the Quality adapter.
- Personal presets: Focus/Extended and cross-user preset sharing remain outside the delivered saved view/filter lifecycle. Applying saved profiles to an already open renderer is explicitly not claimed.
- Manufacturer directory: card/e-mail record CRUD is delivered; country/group heading management is now delivered; native import/merge is now delivered with verified partial receipts and selective native inverses; exact authorized ASAS name discovery/linking and native missing-card/country creation are now delivered with approval, source binding and atomic inverse.
- Native shared Landed defaults now have READ and approved UPDATE adapters using the same HTTP/Office service, native journal/source guards, full task-bound inverse and safe revision headroom. Their preview explicitly reports default-factor changes without claiming a scan of other owners’ prices. Supported larger exports and remaining module functions still require operation-by-operation inventory.
- Earlier native multi-document adapters still require a final live-IAM/profile/journal and partial-effect audit. Directory, Endeksmatik and Transit/Royalty/FX boundary gaps found during this continuation are fixed and covered by actual durable-reader regressions.

## Delivery status — 2026-10-14 (Europe/Istanbul)

STABLE 7.0.273 is published at https://github.com/clbiez/Buyer-Log-Releases/releases/tag/stable-v7.0.273. The implemented capability packets and concurrent native main updates were delivered through scoped PRs #511–#559, including the oversized-release transport fix and Windows regression fixes. GitHub push/merge/release access was actually exercised; the older statements about unavailable write approval and missing captures are historical.

TEST source 012c2e1366e987c8f5815686fdc0d1672c2f0104 passed the complete Windows gate in run 38467281188: 988 files, 7,583 cases, 7,581 passed, zero failures and two existing platform/opt-in skips. The skipped OneDrive reparse test and opt-in 20,000-operation soak are not counted as passed. Nine actual release Chromium model-image scenarios passed. STABLE run 38477382069 copied the same signed TEST bytes without rebuilding; manifest size, SHA-256 and Ed25519 signature match and the native trusted-key verifier accepted the signature. New-user installer run 38477474636 also succeeded and uploaded its archive/checksum.

The 172 bilingual visual entries and all referenced real anonymous PNGs are now immutable under public/release-notes/7.0.273. Pending notes were reset by archive commit caf4bbefbb27416dd0d2eb5fac6e81d39147c7b7. Publication evidence and unresolved corporate/physical Windows limits remain in STABLE_7_0_273_ACCEPTANCE.md; release CI is not corporate PLM/LCW AI/SSO acceptance.

The latest user instruction authorizes continuing remaining native-action gaps after this STABLE without waiting. Registered-tool totals and the outstanding inventory above do not imply completion. The next independent packets address committed native receipt retention/current-scope publication and shared Landed defaults; they are not included in the already published 7.0.273 bytes.
