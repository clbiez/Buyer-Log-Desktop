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
| BL-001 | P0 | PR Open | Review PR #685; retain record/option contracts and backend restart requirement | Verified negative HTTP + real IAM + Chromium; 224 focused pass; no Windows certification | [#685](https://github.com/clbiez/Buyer-Log-Desktop/pull/685) |
| BL-002 | P0 | Confirmed | Next: compatible lease ownership, race-safe reclamation and commit fencing; add two-process/suspend/crash matrix | Live owner evicted solely by age: second writer entered after 5.209 s while first active. No correction delivered; mixed-version and shared-filesystem semantics unresolved | — |
| BL-003 | P0 | Confirmed | Next: validate full checkpoint; implement durable restore intent and deterministic restart recovery | Rollback missing .bak reproduced old DB + newer WAL + pointer 1.1.0. No correction delivered; Windows rename/disk-full and trial-write policy remain | — |
| BL-004 | P0 | PR Open | Review PR #686; restart backend and refresh sign-in page after approved deployment | Canonical-account/trusted-peer limiter verified: 63 pass, real Chromium TR/EN. Bounded known-pool saturation tradeoff documented; Windows corporate IAM not certified | [#686](https://github.com/clbiez/Buyer-Log-Desktop/pull/686) |
| BL-005 | P0 | Investigating | Prepare compatible signed-manifest plus trusted-bootstrap migration proposal before changing channel | Code confirms unsigned/self-hash manual channel; local installer is used rather than downloaded script execution. Windows/tamper runtime not executed. Depends BL-011 and explicit channel/migration decision | — |
| BL-006 | P1 | PR Open | Review focused repairs in #687; then resolve residual failures before claiming green baseline | Five audit-listed failures + one later-main UI-regex harness failure repaired. 23 core tests pass; TL file still 3 pass/1 fail. All-file scheduling observed 8 failures, one subsequently repaired; seven remain | [#687](https://github.com/clbiez/Buyer-Log-Desktop/pull/687) |
| BL-007 | P1 | Pending | Restrict temp inventory to app-owned files | Not executed in this session; verify audit evidence before changing code | — |
| BL-008 | P1 | Confirmed | After BL-002, convert one request-facing writer to awaited leases and benchmark identically | Synchronous held lease reproduced: 10 ms timer delayed to 305.36 ms with 300 ms timeout. No optimization or improvement claimed | — |
| BL-009 | P1 | Pending | Correct shared dialog focusability and trapping | Not executed in this session; verify audit evidence before changing code | — |
| BL-010 | P1 | Pending | Separate License Cards loading, error and empty states | Not executed in this session; verify audit evidence before changing code | — |
| BL-011 | P1 | Pending | Define manual patch release/validation policy explicitly | Not executed in this session; verify audit evidence before changing code | — |
| BL-012 | P1 | Pending | Avoid full WAL parsing after every append | Not executed in this session; verify audit evidence before changing code | — |
| BL-013 | P1 | Pending | Index cross-screen order peers by canonical identity | Not executed in this session; verify audit evidence before changing code | — |
| BL-014 | P1 | Pending | Cache pricing context and remove avoidable repeated rule work | Not executed in this session; verify audit evidence before changing code | — |
| BL-015 | P1 | Confirmed | Replace added Endeksmatik hardcoded styles with existing tokens in separate small UI PR and capture actual three-theme evidence | Six design-contract failures share fixed font sizes/raw colours added after audit. Do not raise frozen baselines. Broad design/readability work remains pending; BL-009 precedes dialog extensions | — |
| BL-016 | P1 | Pending | Verify attachment and legacy-route authorization systematically | Not executed in this session; verify audit evidence before changing code | — |
| BL-017 | P1 | Pending | Specify pricing, FX and indexation provenance contracts | Not executed in this session; verify audit evidence before changing code | — |
| BL-018 | P1 | Pending | Inventory packaged and vendored runtime dependencies | Not executed in this session; verify audit evidence before changing code | — |
| BL-019 | P1 | Blocked | Provide actual Windows reference desktop environment after P0 corrections; use synthetic representative fixtures | No actual Windows/Electron/NTFS/Excel/Outlook/SMB environment available; component/empty-screen checks do not satisfy desktop performance validation | — |
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

## Discovery and continuation (superseded by the delivery checkpoint below)

- Suspected risk (BL-016): test-report authorized-order resolver also consumes user-managed scoped source rows; independently test its authoritative-read intersection before declaring a vulnerability.
- Next: open BL-001 PR, then independently verify BL-002 lease takeover; use a fresh feature branch from current main for each independent fix. BL-003 requires deterministic recovery/fault tests; BL-005/011 require an explicit compatible trust/bootstrap proposal and real Windows validation.
- BL-006: repair confirmed harness failures in a separate branch, retain business assertions, then complete the supported-runtime baseline. Full-suite initial failures do not establish later tests passed.
- BL-017/023–026 business-policy changes and major new workflows remain proposals pending user approval; no unrelated redesign while P0 work remains.
- Never merge, publish, force-push, touch live data or claim background continuation without a persistent mechanism.

## Delivery checkpoint — 24 October 2026

| Package | Branch | Implementation commit | Open PR |
|---|---|---|---|
| BL-001 | `fix/bl-001-checklist-authority` | `7c32ec542eefab3e3747dba3a1361b0b811c9c4f` | [#685](https://github.com/clbiez/Buyer-Log-Desktop/pull/685) |
| BL-004 | `fix/bl-004-login-throttling` | `d5b0b04ffdfcc3aaa499b9b9459e668f79105ce9` | [#686](https://github.com/clbiez/Buyer-Log-Desktop/pull/686) |
| BL-006 focused repairs; baseline incomplete | `test/bl-006-regression-baseline` | `73a890fe3bb1dd2caf399a5ea4e8fde43a321e5e` | [#687](https://github.com/clbiez/Buyer-Log-Desktop/pull/687) |

All three target unchanged authoritative main `6f8eb33e820c231cb4f7189c728224ad1b58dd57`. Documentation follow-up commits record PR status without altering tested application bytes. No Actions run requested; repository PR policy uses local validation. No PR merged and no TEST/STABLE/production release published. The original checkout remains clean on its original `work` branch. No live user data was used. This is a partial execution checkpoint, not completion of all 26 packages.

### Combined verification

A separate detached validation checkout at `/workspace/buyer-log-combined-validation` applies all three implementation diffs. It is local only: no branch push, PR merge or release. The two pending JSON release-note additions were combined by unique change ID, preserving all 21 baseline entries and both real screenshots.

Passed on Linux Node v24.19.0:

```
npm test -- checklist test-report cp-checklist login-thrott user-access central-iam auth.test i18n-coverage capacity-request-workbook collection-mb-month-locale-filter notes-editor-persistence revision-v476
```

**45 files, 310 tests passed, zero failed/skipped**, with isolated matching TMPDIR/BUYER_LOG_TEMP_ROOT and synthetic APPDATA/LOCALAPPDATA. `npm run release:notes:validate` passed with 23 entries. This focused integration run does not replace a full green regression or actual Windows validation.

### Full scheduled regression accounting

On the independent BL-006 branch, standard `npm test` passed batch 1 and stopped after batch 2 failures. Batches 3/4/5 were scheduled separately once with the same file ordering and concurrency; sync simulation remained isolated. All 1,026 files were scheduled. Aggregate observed result: **7,374 tests: 7,301 pass, eight fail, 65 skip**. One UI regex failure was subsequently repaired and its file narrowly rerun: three pass, one TL-signature fail. No later full green run is claimed.

Six residual failures are design contracts detecting the same new Endeksmatik raw colours/fixed typography; one residual TL import case needs product-versus-invalid-fixture classification. Those are not seven independently proven product defects. See [BL-006 evidence](https://github.com/clbiez/Buyer-Log-Desktop/blob/test/bl-006-regression-baseline/docs/audits/bl-006-test-results.json) and [classification](https://github.com/clbiez/Buyer-Log-Desktop/blob/test/bl-006-regression-baseline/docs/audits/bl-006-regression-harness.md). The ten-device simulation reported 12 pass, one skipped soak, zero fail. Actual Windows/Excel/Outlook/shared-storage/corporate integrations remain Not executed or Blocked.

### Additional discoveries

- Confirmed regression-harness defect: later-main Endeksmatik regex literals double-escaped punctuation. Corrected in #687 without changing application/signature logic.
- Confirmed design inconsistency (BL-015): added Endeksmatik import styles bypass existing typography/colour tokens. Six contract tests expose the same additions. No guard weakened.
- Suspected risk (BL-017): TL fixture classified through USD model signature and missing C15–C19 formulas rejected. Validate a safe real-structure fixture and discrimination before touching financial validation.
- Suspected risk (BL-016): test-report authorized-order read resolver also consumes user-managed scoped source rows; independently reproduce its authoritative scope before declaring another exposure.

### Exact continuation

1. Read this checkpoint and repository instructions once. Fetch current main, inspect changes since `6f8eb33e`, and preserve all current worktrees/branches. Review open PRs; do not merge/publish without explicit user approval.
2. Resume BL-002 in a fresh branch from latest main. Reproduce async/sync two-process overlap, suspend/resume and competing stale reclaimers. Design a compatible ownership/reclamation/fencing contract; a higher TTL or heartbeat alone is insufficient. Preserve dead/corrupt-owner recovery. Add red tests before production changes and require actual Windows/shared-storage validation for compatibility claims.
3. Then BL-003: validate every snapshot member before mutation; stage file-set restoration, journal intent and recover before backend opens the DB. Fault each replacement and pointer/state transition; preserve trial-write/sync policy and checkpoint until success. No live DB testing.
4. BL-005/011: investigate the local manual installer's trust chain, construct a temp tamper fixture, and prepare a compatible signed-manifest/trusted-bootstrap migration proposal. Publication/channel retirement requires an explicit product decision; do not silently disable or publish the workflow.
5. Finish residual BL-006 classification and small BL-015 token correction independently, preserving strict model and design guards. Run the standard full supported-runtime suite once the residuals are addressed; report skips and unavailable Windows tests separately.
6. Continue the remaining backlog in dependency order. BL-017 business-policy and BL-023–026 major workflow changes need concrete proposals and user approval before implementation. No measured performance improvement or broad UI completion has been delivered yet.

Local diagnostic artifacts (synthetic only): `/workspace/buyer-log-execution-evidence/`; original read-only extracted package: `/workspace/buyer-log-master-input/`. The audit setup helper was copied and corrected only in the diagnostic folder (auth path under local root). Worktree dependency links can be recreated from the original checkout or dependencies installed with `npm ci` before continuation. No scheduled background continuation exists.
