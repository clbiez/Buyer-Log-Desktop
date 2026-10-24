# Buyer Log engineering execution progress

Checkpoint: 2026-10-24. No merges or releases authorized or performed.

## Baseline and isolation

- Audit: `a9183b319dd4927642bf153defc653bf67b74ccd` (7.0.294). Full attached report read; all 41 ZIP entries inventoried (report + 40 evidence files). Diagnostic setup/environment/checklist scripts inspected before execution.
- Fetched authoritative `origin/main`: `6f8eb33e820c231cb4f7189c728224ad1b58dd57`, seven commits after the audit. Those commits touch 28 files and do not change BL-001–005 target security/persistence implementations. No item is marked Already Fixed without verification.
- Existing clean `/workspace/Buyer-Log-Desktop` branch `work` preserved. Dedicated `/workspace/buyer-log-bl001` worktree and `fix/bl-001-checklist-authority` branch.
- Linux x86_64, Node v24.19.0; Chromium headless for native frontend verification. All users, credentials, source folders and persistence roots are disposable synthetic fixtures. No corporate services contacted.
- Audit setup helper needed a diagnostic-only correction: auth root moved under local root so durable-write allowed-root validation accepts it. This is a harness issue, not a product authorization defect.

## Backlog

Pending means not independently verified in this execution. The audit remains evidence, not certification. For Pending rows, root cause, implementation, tests and PR are not yet established; next action is independent verification of the named package.

| ID | Priority | Status | Package / next action | Verification / dependencies / risk | PR |
|---|---|---|---|---|---|
| BL-001 | P0 | Verified | Enforce checklist order and attachment authority | Reproduced; implementation and focused regression verified; Windows blocked | — |
| BL-002 | P0 | Pending | Prevent active-lease takeover; add fencing | Not executed in this session; verify audit evidence before changing code | — |
| BL-003 | P0 | Pending | Make updater DB rollback recoverable as a set | Not executed in this session; verify audit evidence before changing code | — |
| BL-004 | P0 | Pending | Remove untrusted forwarding headers from throttle identity | Not executed in this session; verify audit evidence before changing code | — |
| BL-005 | P0 | Pending | Align manual patch authenticity with official trust | Not executed in this session; verify audit evidence before changing code | — |
| BL-006 | P1 | Pending | Repair the five reproducible regression-test failures | Full runner reproduced capacity + two locale failures in batch 1; later batches not executed | — |
| BL-007 | P1 | Pending | Restrict temp inventory to app-owned files | Not executed in this session; verify audit evidence before changing code | — |
| BL-008 | P1 | Pending | Remove synchronous lease waits from request paths | Not executed in this session; verify audit evidence before changing code | — |
| BL-009 | P1 | Pending | Correct shared dialog focusability and trapping | Not executed in this session; verify audit evidence before changing code | — |
| BL-010 | P1 | Pending | Separate License Cards loading, error and empty states | Not executed in this session; verify audit evidence before changing code | — |
| BL-011 | P1 | Pending | Define manual patch release/validation policy explicitly | Not executed in this session; verify audit evidence before changing code | — |
| BL-012 | P1 | Pending | Avoid full WAL parsing after every append | Not executed in this session; verify audit evidence before changing code | — |
| BL-013 | P1 | Pending | Index cross-screen order peers by canonical identity | Not executed in this session; verify audit evidence before changing code | — |
| BL-014 | P1 | Pending | Cache pricing context and remove avoidable repeated rule work | Not executed in this session; verify audit evidence before changing code | — |
| BL-015 | P1 | Pending | Extend existing token contracts and independent table density | Not executed in this session; verify audit evidence before changing code | — |
| BL-016 | P1 | Pending | Verify attachment and legacy-route authorization systematically | Not executed in this session; verify audit evidence before changing code | — |
| BL-017 | P1 | Pending | Specify pricing, FX and indexation provenance contracts | Not executed in this session; verify audit evidence before changing code | — |
| BL-018 | P1 | Pending | Inventory packaged and vendored runtime dependencies | Not executed in this session; verify audit evidence before changing code | — |
| BL-019 | P1 | Pending | Run populated Windows desktop/export/concurrency benchmark | Not executed in this session; verify audit evidence before changing code | — |
| BL-020 | P2 | Pending | Use common contextual feedback and purposeful motion | Not executed in this session; verify audit evidence before changing code | — |
| BL-021 | P2 | Pending | Replace first-run release-history flood with a relevant summary | Not executed in this session; verify audit evidence before changing code | — |
| BL-022 | P2 | Pending | Expose contextual shortcuts through the existing palette | Not executed in this session; verify audit evidence before changing code | — |
| BL-023 | P2 | Pending | Preview bulk edits with validation and durable receipts | Not executed in this session; verify audit evidence before changing code | — |
| BL-024 | P2 | Pending | Surface price/FX/source lineage next to decisions | Not executed in this session; verify audit evidence before changing code | — |
| BL-025 | P2 | Pending | Unify saved views and resume context using existing profiles | Not executed in this session; verify audit evidence before changing code | — |
| BL-026 | P2 | Pending | Add a scoped buyer exception inbox | Not executed in this session; verify audit evidence before changing code | — |

## BL-001 — checklist record authorization

Root cause: normal HTTP routes checked module visibility only and omitted the store authority guard. Global payloads and arbitrary order keys bypassed object scope; file IDs had no durable staging owner. The server also accepted client-authored actor/source fields.

Before on current main: synthetic SELF buyer login 200, foreign answer GET 200 with `readForeign:true`, foreign write 200 with `updated:1`. After: GET 200 with `readForeign:false`, foreign write 403 `CHECKLIST_ORDER_FORBIDDEN`; even the Moderator cannot seed a nonexistent order through HTTP. Seven initial negative regression tests failed before the correction.

Implemented: scoped answers/tombstones; complete-batch authority and attachment validation before mutation; current profile/order checks inside the lease before commit; business-rule capability for global definitions; server-derived actor/source and validated event times; owner/order-bound attachment staging metadata; authorized historical answer/event/test-report references; fail-closed orphan files retained. Read scope intersects the Moderator ownership snapshot so user-managed source rows cannot grant visibility. Endpoint area access is rechecked after preparation.

Compatibility: JSON checklist schema and conflict timestamp/baseAt ordering remain unchanged. Internal native services retain their existing explicit authority guards and trusted snapshots. Reusable `@option:` approvals remain authorized through an actual matching visible/editable PO, preserving existing cross-PO business scope. Sidecar metadata is additive; ambiguous historical files stay on disk and are not served until an authorized reference exists. Attachment deletion preserves answer, tombstone, historical event and report references. No migrations or financial rules changed.

Review: one independent reviewer identified authoritative-read scope, area revocation and repeated attachment scans; all addressed with regression coverage. Attachment references are indexed once per authority check. No performance gain is claimed.

| Result | Command / environment | Outcome |
|---|---|---|
| Passed | `npm test -- checklist test-report cp-checklist` / Linux Node 24: 31 files, 224 pass, 0 fail, 0 skip | Disjoint HTTP users, real IAM ownership, mixed-owner view-only order, options, revoked scope/area, mixed batch, files, global capability, imports, invalid timestamps. |
| Passed | Isolated normal server + inspected `checklist-scope.cjs` / Linux Node 24 | Baseline exposure and write reproduced; post-change unauthorized read filtered and write rejected. |
| Passed | Real Chromium + `BLChecklistSupplierSync.loadShared/syncAnswerChanges` | Foreign save rejected, pending edit retained, no foreign answer; genuine post-change PNG in pending notes. |
| Failed | `TMPDIR=<isolated> BUYER_LOG_TEMP_ROOT=<same> APPDATA=<isolated> LOCALAPPDATA=<isolated> npm test` | Standard runner stopped at batch 1/5: 2,150 tests, 2,087 pass, 3 fail, 60 skip. Failures: capacity workbook blank cache; two MB-month VM constants. BL-006; not a green full-suite claim. |
| Passed | `npm run release:notes:validate` | 22 pending entries validated, including genuine post-change PNG. |
| Blocked | Actual Windows Electron/NTFS and corporate/shared-storage integration | No Windows environment or corporate sandbox available; not executed or claimed passed. |

Rollback: revert this PR and restart backend; no data conversion to reverse. New metadata may remain safely. Reverting reopens the vulnerability and should only be used with restricted access. Deploy requires backend restart.

## Discovery and continuation

- Suspected risk (BL-016): test-report authorized-order resolver also consumes user-managed scoped source rows; independently test its authoritative-read intersection before declaring a vulnerability.
- Next: open BL-001 PR, then independently verify BL-002 lease takeover; use a fresh feature branch from current main for each independent fix. BL-003 requires deterministic recovery/fault tests; BL-005/011 require an explicit compatible trust/bootstrap proposal and real Windows validation.
- BL-006: repair confirmed harness failures in a separate branch, retain business assertions, then complete the supported-runtime baseline. Full-suite initial failures do not establish later tests passed.
- BL-017/023–026 business-policy changes and major new workflows remain proposals pending user approval; no unrelated redesign while P0 work remains.
- Never merge, publish, force-push, touch live data or claim background continuation without a persistent mechanism.
