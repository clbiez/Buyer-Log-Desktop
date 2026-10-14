# Claude Code handoff — Buyer Log Agent Capability Platform 2.0

Snapshot: 2026-10-14. This document preserves a handoff, not release acceptance. Re-query GitHub before acting. User is taking work over from Codex; do not assume Codex will continue or promote a release.

## TASK 1 — urgent login recovery and corrective release

The user cannot work: after username/password, Buyer Log stays at Preparing your workspace. Initial data, Screen and User information never complete; Retry does not help. This is higher priority than remaining feature work. Their supplied logs show a 7.0.269 -> 7.0.273 upgrade. Do not upload raw logs, private paths, usernames or corporate data to GitHub.

Repository: clbiez/Buyer-Log-Desktop. Public distribution repository: clbiez/Buyer-Log-Releases. Read AGENTS.md / CLAUDE.md once. GitHub writes, scoped merges and Stable publication have already been explicitly authorized; do not ask again merely because older notes say write approval was missing.

At handoff, published Stable is 7.0.273:
https://github.com/clbiez/Buyer-Log-Releases/releases/tag/stable-v7.0.273
Source 012c2e1366e987c8f5815686fdc0d1672c2f0104. Its Windows full gate and nine browser acceptance scenarios passed at publication. The field login failure is still real; a passing release gate is not affected-device acceptance.

### Findings and merged fixes

Logs show SERVER_READY, LOCAL_DB_READY and DELTA_STORE_HYDRATED, but no UI-ready report during four affected 7.0.273 starts. Earlier-version OOMs exist; no 7.0.273 OOM is established. The exact blocked renderer request is not proven.

A separate concrete native regression was reproduced: parser-eager notifications on DOMContentLoaded awaited default-enabled checkAssistant, which requested CP, Orders, Collection, LFL and Backlog operational data. A deferred/unavailable source prevented notification GET from returning. This is a real startup-critical-path defect, not proof it is the sole cause on the user's machine.

PR #565 merged: https://github.com/clbiez/Buyer-Log-Desktop/pull/565
- public/agent-office-notifications.js: start a single polling timer only after bl:startup-complete; no pre-startup manual/timer GETs.
- server/lib/agent-office-service.js: notification GET reads persisted alerts/preferences without scanning sources; background worker respects trusted canRunBackground readiness.
- server/server.js: readiness callback uses actual uiReadySignaled from /api/startup/ready.
- Existing login, initial data/core/profile gates, IAM and explicit Office analysis remain.
- tests/login-agent-notifications-critical-path.test.js: live service/client/scheduler regressions.
- docs/ai/LOGIN_NOTIFICATION_STARTUP_ACCEPTANCE.md contains evidence and limits.
- Actual anonymous HTTP/Chromium uses the real password form: three ready gates, zero notification GETs before Continue, one afterward, TR/EN, zero page errors. Physical affected device remains unverified.

7.0.274 was reserved but its TEST gate failed; no TEST or Stable 7.0.274 artifact was published. Its immutable source branch must not be reused.

PR #566 merged: https://github.com/clbiez/Buyer-Log-Desktop/pull/566
- Native email-groups-store newId now uses already-imported crypto.randomUUID. Existing IDs, locks, CAS, journal and exact inverse are unchanged. A real 20,000-card import with coarse clock and valid seeded entropy was RED OFFICE_TOOL_SCHEMA under old short-random IDs and GREEN with the fix; all imported cards can be inversed. CI's old import error code was not recorded, so that independent defect is not claimed as its sole cause.
- OAB test-only nativeDone helper uses a monotonic bounded 60-second deadline instead of 200 x 5ms polls, preserving real terminal receipt assertions and adding diagnostics. A real delayed-provider/reconstructed-Office regression verifies two dispatches, snapshot persistence and downstream identity. Production OAB behavior was not changed.
- Version 7.0.275. Bilingual visual notes and real anonymous post-change PNGs are included.

Current main / TEST source:
4d9a1023a44e4e8211524d1f3f46c9a4cc38952d
Immutable updates/v7.0.275 points exactly to this source. Immutable workflow 38532064963 succeeded.

### Latest release result — Windows passed, publication failed

TEST workflow 38532090289:
https://github.com/clbiez/Buyer-Log-Desktop/actions/runs/38532090289
Windows job 115746117377 completed SUCCESS on 2026-10-14 08:40:21 UTC. Actual logs: 994 files / 9 batches; 7,659 cases, 7,657 passed, 0 failed, 2 existing skips, 2346 seconds. Skips are the OneDrive reparse-point case and opt-in 10-device/20,000-operation soak; neither is a pass.
Local complete regression: 994 files / 9 batches; 7,659 cases, 7,593 passed, 0 failed, 66 existing Linux/platform/opt-in skips, 304.6 seconds.
Targeted import/OAB 38 cases plus native manufacturer/headings/journal/output 102 cases passed. One focused review has no open P0/P1 in these narrow diffs.

Final run result at handoff: FAILURE. Windows regression succeeded, but publish job 115761435879 failed at Publish, verify remote bytes, then advance TEST latest. Build and Ed25519 signing completed. Error: [RELEASE_FAILED] Command failed: git -C release-repo push origin HEAD:main; remote rejected HEAD -> main (failed). The job log does not establish a specific quota, large-file, protection or permissions cause; inspect actual Git/publication state and preserve detailed stderr before naming it.

Public test-v7.0.275 was created at 08:42:39 UTC and contains BuyerLog-7.0.275.json (711 bytes) and BuyerLog-7.0.275.zip (151,587,373 bytes). Asset existence is NOT completed publication or Stable acceptance. Stable remains 7.0.273; no Stable promotion or new installer was started. Check the actual canonical TEST latest pointer before promotion.

Next action: fix the CI-only delivery/publication boundary, reuse and verify the already-built same signed 7.0.275 artifact, and complete required remote checks/feed publication. Do not blindly rerun the unchanged failed workflow, rebuild/overwrite the existing version artifacts, or unnecessarily repeat the successful 40-minute Windows suite when app code is unchanged. .github/scripts/buyerlog-release-distribution.js already separates publish-test and promote-stable and uses existing native providers, signature and immutable-asset verification. A delivery-only repair must retain all those safeguards. The workflow checks out its CI publisher independently of pinned app source; an app-code change requires a new unused version, while a strictly CI-only transport repair can retain the exact accepted existing app bytes.

Commands:
```
gh run view 38532090289 -R clbiez/Buyer-Log-Desktop
gh run watch 38532090289 -R clbiez/Buyer-Log-Desktop --exit-status
gh release view test-v7.0.275 -R clbiez/Buyer-Log-Releases
```
Only after the failed publication boundary is repaired and all required release/browser/remote checks truly succeed, verify the signed TEST manifest with the existing native trusted-key verifier. Never promote merely because assets exist. Then, under the existing Stable authorization:
```
gh workflow run buyerlog-promote-stable.yml -R clbiez/Buyer-Log-Desktop --ref main -f version=7.0.275
```
Promote the exact same signed TEST bytes, no rebuild. Compare ZIP size, SHA-256 and signature between TEST/STABLE; download/verify public Stable artifact. Follow auto-triggered buyerlog-installer.yml; do not dispatch a duplicate installer. Stable promotion archives pending visual notes and resets them on main, so fetch main afterward.

Workflow files: buyerlog-test-release.yml, buyerlog-promote-stable.yml, buyerlog-version-branch.yml, buyerlog-installer.yml under .github/workflows. Native verifier: resources/app/electron/update/signature.js; loadTrustedKeys receives resources/app root. Artifact names BuyerLog-7.0.275.json and BuyerLog-7.0.275.zip.

If source needs changes after this immutable reservation, use 7.0.276 or a later unused SemVer. Do not overwrite updates/v7.0.274/v7.0.275, force-push main or rerun unchanged failed jobs. Do not treat successful build/signing as remote publication success. Do not publish a failed mandatory gate.

### Immediate recovery while publication finishes

The user needs to work immediately. On their actual Windows machine, first verify running backend and authenticated /api/user-login, /api/user-context, /api/data, /api/startup diagnostics individually; identify the pending/failing request instead of assuming the found notification defect explains everything.

A narrow reversible mitigation exists in the same installed 7.0.273 service:
PUT /api/agent-office/assistant with JSON {"enabled":false} in an authenticated session for the affected owner. This uses the existing personal setting, native revision/CAS and audit. Do not GET old notifications to obtain settings first because that starts the scan. Disable only this user's automatic assistant, then fully stop/reopen Buyer Log to cancel the prior stalled scan; verify the three login gates. Re-enable through native settings after verified recovery. Do not claim this workaround is proven on the user's device.

The login + personal-settings API path was exercised against anonymous local actual HTTP: 200 login, 200 settings mutation, enabled:false confirmed, native revision increased, original setting restored. No mitigation has been applied on the affected device. A proposed support .cmd was only a scratch draft; it was not delivered or Windows-tested. Do not present it as a shipped recovery utility.

Do not delete data, restore an old database checkpoint, disable IAM, hardcode startup readiness or replace full installations over business data. Do not blindly downgrade to 7.0.269: 7.0.273 added private-records WAL handling that the older reader does not implement; compatibility must be assessed before any version rollback. The updater already marked 7.0.273 healthy before successful workspace preparation, so its automatic health rollback did not catch this field stall; keep that boundary explicit.

DONE WHEN: the affected user can log in and work with intact records, current IAM, normal preparation gates and verified corrective release. If 7.0.275 still hangs, capture actual renderer request/console evidence and continue the P1 investigation before unrelated features.

## TASK 2 — finish Agent Capability Platform 2.0

Run after urgent access recovery. Prior work is substantial but not complete. Approximately 70% was a rough effort estimate, not a measured completion rate. Current catalog has 198 contract-v2 capabilities (199 total including legacy); 198 strict top-level output contracts and zero known open/generic top-level envelopes. Tool counts do not prove every native function is covered or every result field fully typed.

Read current code and these documents first, preserving existing work:
- docs/ai/AGENT_CAPABILITY_PLATFORM_2.md: original architecture/module/action inventory, plan and historical checkpoints; early findings are historical, not all current gaps.
- docs/ai/AGENT_CAPABILITY_API_INVENTORY.csv
- docs/ai/AGENT_CAPABILITY_CURRENT_COVERAGE.md
- docs/ai/AGENT_CAPABILITY_OUTPUT_GAPS.md
- docs/ai/AGENT_OFFICE_FINAL_ACCEPTANCE.md
- docs/ai/AGENT_*_ACCEPTANCE.md for recent native packets.
- resources/app/tests/fixtures/agent-unified-access-matrix.json and its executable test.
- docs/ai/AGENT_REMAINING_PACKETS_HANDOFF.json in this WIP branch.

### Already delivered — do not rebuild

The unified registry, Office/Runtime execution bridge, schema-validated preview/approval, native task receipts/partial effects, idempotency, durable waiting/continuation, current IAM/profile/record guards, private inverse artifacts, bounded memory/provenance and existing CP/Quality/Collection/Backlog/Moderator adapters were implemented across scoped PRs. Their actual reach and remaining limits must be checked in the current inventory.

Stable 7.0.273 delivered PRs through #559 and accumulated native main updates. Post-273 merged packets included in 7.0.275 source:
- #560: native committed receipts survive later access changes, public results obey current scope.
- #561: shared Landed defaults READ/approved UPDATE/native journal/exact inverse.
- #562: native source profile options, approved rename and refresh enable/disable; guarded inverse rejects peer role conflicts.
- #563: configured source table/column/schema discovery, native canonical mapping proposal/approved update; bounded pages and full framed inverse.
- #564: reusable checklist option READ/approved UPDATE using authorized anchor orders, actual effective native option scope, evidence-preserving full inverse. Native order-scope defaults cannot grant reuse.
- #565/#566: urgent startup and release reliability fixes described above.

### Remaining development packets

1. Source connection lifecycle: CREATE/DELETE, saved configured query/target discovery/execution/export, actual refresh-group execution. Keep approved configured targets; no arbitrary SQL, hosts, JS or credentials. Reuse existing model/source services and native asynchronous jobs.
2. PLM assets: native sample/BOM/image/attachment jobs and lifecycle. Reuse existing corporate session/worker/store; exact canonical order/model/color matching, durable completion and current IAM. Corporate/Windows evidence remains unverified until genuinely run.
3. Order editor: supported overrides, notes and custom note columns. Extract/reuse the existing native service rather than duplicate business logic. Primary CP store and overview projection require one correct native journal/multi-store boundary, full order-line scope, CAS/lease and inverse including deleted values. No tracked implementation remains in the old order-editor worktree.
4. Checklist: supplier XLSX import/export and attachment lifecycle. Reusable options are already done. Reuse existing supplier/checklist/export engines; CP operation grants, ambiguity approval, evidence/revision/ownership and exact inverse.
5. Presets: Focus/Extended and owner/category-scoped cross-user sharing/apply/undo. Use native multi-store CAS; source visibility and exact revision-bound inverse. Do not claim applying a saved profile to an already-open renderer without implementing/verifying it.
6. Remaining module audit: Pricing History, Price & Supplier Analysis, holidays, INTAKE and all other actual UI/native functions missing from registry. Extend operation-by-operation READ/CREATE/UPDATE/DELETE/IMPORT/EXPORT/EXECUTE/SCHEDULE/SEND/APPROVE matrix; deterministic motors perform exact calculations. Landed multipliers are already done.
7. Workflow Studio/Office: remaining native lifecycle, real cross-module task handoff and scheduling/restart/approval coverage. Extend existing runtime/stores; no parallel AI or automation engine.
8. Final acceptance: live IAM revocation before/after awaits, agent revision changes, record/source CAS, multi-user races/locks, partial durable receipt reconciliation, approved inverse with newer peers, safe retry/restart, performance and full regression. Separate simulated/native fixture results from actual corporate/physical Windows acceptance. Complete memory conflict/expiry/correction/bounded-context acceptance and closed/open application scheduling limits.

### Preserved WIP — not accepted or merged

Remote branch feat/agent-refresh-groups contains the existing incomplete refresh-group definition packet and this handoff. Its base is a6690864; rebase onto actual current main carefully, preserving startup fixes. Do not merge wholesale.

Existing modifications: native refresh-group-service; agent-refresh-group-tools (READ, CREATE, UPDATE, DELETE definitions), shared db mutation option forwarding and server wiring; matrix fixture/test updates; capability regression file. Tools explicitly report executesRefresh:false. This is definition management, not actual refresh execution.

Last targeted check: 39 cases, 38 pass, 1 fail, no skips. Failing case: strict native identity, module, duplicate name and capacity checks precede all effects, tests/agent-refresh-group-capability.test.js:31. Missing expected OFFICE_TOOL_SCHEMA rejection in bad-input loop (whitespace ID, module intake, duplicate cp, blank name or unknown sql field). Determine which case and compare actual Rules.refreshableModules/native validation before changing code or assertions. Do not loosen a valid safety contract merely to pass.

No focused review, release-note PNGs or full regression acceptance for this WIP packet. Preserve native legacy-normalization refusal, profile WAL, current IAM, source CAS and full inverse. Finish, test and deliver it as a small scoped PR; execute-refresh remains a separate packet.

### Non-negotiable architecture and delivery

Keep LCW AI as the only AI engine, existing Office/coordinator/memory/Agent Runtime and actual native business services. No direct DB writes, unlimited admin, arbitrary JS/SQL or security bypass. Agent execution rights derive from current user's IAM and actual record/data scope at every critical await/effect.

Every migrated capability declares validated input/output, permission/scope, risk, preview, validation, approval binding, audit, idempotency/retry and applicable guarded rollback. Discovery/access matrix updates accompany new modules/tools. A persisted real effect must not become a fake failure because a new result schema invented unsupported fields; preserve durable facts and partial receipts.

Exact calculations use native deterministic engines, including same-currency MB-month/classification quantity-weighted LFL. No invented mappings or ambiguous automatic order/model/color decisions. Unsupported routes/providers must declare a real boundary.

No Outlook integration. Manually uploaded MSG/EML are supported documents; mail is a draft. SEND stays unavailable unless an existing authorized corporate sending channel is actually verified. Voice and functions absent from LCW AI remain out of scope. AI-off deterministic functions must still work.

Memory must separate source facts, preferences, approved procedures, task history and unverified inference; model suggestions never self-approve. Bring prior user corrections/rejections into bounded relevant context; detect stale/conflicting information.

Keep theme tokens, square design language, TR/EN in the same commit, canonical fields, lazy startup and GitHub quota rules. Real visible changes require actual anonymous post-change lossless PNGs and bilingual release notes. Read CLAUDE.md for exact requirements.

For each independent packet: targeted meaningful RED/GREEN native tests, one focused review, actual relevant UI where applicable, required regression, scoped PR and separate release decision. No giant high-risk PR. No automatic CI per PR, no empty commits to trigger CI, no repeated unchanged failed jobs. Merge and TEST/STABLE are separate actions; user has authorized completing and releasing, so exercise that authorization only with concrete accepted results.

DONE WHEN: every supported target user action is executed by agents via the same native services with equivalent data correctness, current IAM, approval, audit, durable completion and persistence. Audit inventory gaps explicitly; unsupported corporate boundaries and unrun acceptance remain unfinished, not passed.
