# BL-016: current test report authority

This bounded security fix is stacked on BL-001 (#685). It does not complete the broader BL-016 route/asset authorization inventory.

## Reproduced boundary

A real SELF-scoped Buyer account had two synthetic source rows. The Moderator's official ownership snapshot authorized only order 4100001; order 4100002 belonged to a different Buyer. Changing the second row's local `buyer` field to the account's display name exposed both saved reports through `GET /api/test-reports` before the fix. After the fix the endpoint returns only report 510001 for the first order; the positive own-report control remains visible. `/tasks` likewise returns only the authorized task.

Source rows now intersect the current official order ownership snapshot and effective Horizon. The snapshot contains order-level ownership, not line-level identities; this change does not invent a separate line ACL. Read-only owned orders remain available for review, while writes additionally require current order edit permission.

Async preparation can outlive a permission change. The production service now supplies a synchronous provider that reloads the active IAM profile and reconstructs current order authority inside attachment and report store leases. Both selected targets and every existing sibling link are rechecked at the final guard. An HTTP route fallback without this provider fails closed.

## Evidence and durability

- Original RED tests reproduced forged ownership, post-prepare revocation and in-lease revocation. The updated focused selection passes 235 tests across 33 files, with zero failures or skips.
- One independent review found two additional issues: sibling scope was not checked at the final guard, and cleanup after uncertain I/O could delete attachments referenced only by newly published last-good recovery. Both have dedicated passing fault regressions. There was no second independent review pass of the corrections.
- Only a proven pre-write authorization/preview rejection permits cleanup of new unlinked attachments. A generic I/O error or uncertain committed outcome preserves attachments for recovery. Successful native commit followed by an outer guard error also preserves them.
- The official Windows runner on the combined checkpoint + ND-003 + BL-012 + this code diff passes 7,497 tests across 1,042 files, with zero failures and six skips in 137.6 seconds. The skips are three unavailable Windows symlink scenarios, two POSIX hook tests and the opt-in soak. The 20,000-operation soak passed separately on the preceding integration checkpoint and was not rerun for this report-only change.
- Raw counts and sanitized real HTTP results are in `bl016-test-report-authority.json`. This is integration evidence, not an assertion that every isolated PR independently passes the full suite or that production/corporate deployments are accepted.

The genuine post-change Edge PNG shows the authorized Buying task after invoking the application's existing `refreshColumns({render:true})` function. It supports UI rendering; the HTTP and fault tests establish the security boundary. The initial page had loaded the task into runtime state but had not applied checklist fields to the displayed rows. **ND-004** tracks that separate UI lifecycle defect; this screenshot does not certify automatic initial rendering.

Fixtures use isolated disposable roots, disabled corporate services, a real created Buyer account and the unmodified production IAM implementation. The `BL_TEST_SEED=1` diagnostic hook accepts explicitly named target arrays and marks that fixture snapshot complete; its legacy two-argument behavior is unchanged. No live user database or corporate source was used.

No merge, TEST, STABLE or manual patch was published. Deployment requires a server restart. Reverting reopens the report access defect.
