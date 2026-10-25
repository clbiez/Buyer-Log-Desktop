# BL-016 — legacy routes and private assets

Implementation and focused validation complete on the PR stack based on BL-008.
Final integrated regression, PR checks and merge remain pending. This is a bounded
review of the legacy resource families below, not a claim that every application
route or external service has been penetration tested.

## Policy inventory

| Resource / route family | Read capability and object scope | Write capability / fresh authority | Asset policy |
|---|---|---|---|
| `/api/overrides/:orderCode`, batch and supplier FOB | Current selected user, canonical authoritative order ownership | Current edit capability and ownership for every batch item; revision/CAS and commit guard | User-controlled source labels cannot grant ownership; mixed batches reject as a whole |
| Checklist answers / attachments / definitions | CP, Orders or Overview; current authorized canonical order set | Live order edit set under the lease; global definitions need `manageBusinessRules` | Order-linked evidence or owner staging; unknown, foreign and ambiguous legacy assets fail closed |
| Test reports / staging / linked evidence | Live scoped order resolver; staged files belong to the creating session owner | Service rechecks current authoritative order set before commit and inside the lease | Shared references retain durably referenced files on uncertain commit; staging is private |
| Pricing draft create / reopen | Pricing area and selected user; retry registry now binds creator ID | Reopen validates creator before file access, expiry extension or OS opening | Random token is only a locator; foreign and expired references both return 410; legacy filename GET stays retired |
| Ordinary automation preview / run / schedule / output | Automations area; source-specific capabilities, owner and live effective scope | Request session credentials, active profile, recipe existence/enabled state and canonical order-authority identity rechecked across preparation and effects | Normal drafts use `owners/<owner-hash>`; Agent CP uses a separate `agent-cp/<owner-hash>` namespace; ownerless historical outputs are preserved but unavailable through generic download |
| Model / Collection / CP image aliases | Shared model images remain module resources; explicit `collection-shared:<owner>:...` replicas additionally require Collection access | Both deletion aliases require edit access for the private Collection owner | All aliases use one private-image policy; private replicas use no-store, ordinary immutable models retain cache policy |
| License-card images and atlas | Shared dictionary, Orders/CP/Source view capability | Business-rule permission for mutations; session and permission rechecked by service guards, including after asynchronous image loading | Content-addressed names, verified transport; no invented order ownership for shared library images |
| Fabric cards | Intentionally shared Collection dictionary | Collection edit capability, fresh session check under its async write lease | Shared dictionary is not private order evidence |
| Collection workspaces / preferences / user restore | Signed-in owner or explicit Collection permission; personal preferences use the signed-in user | Existing scoped async guards, revision and restore contracts from BL-008 and merged work | Personal backup does not restore shared FX or overwrite other users' workspaces |
| Local IAM / offline recovery | Current structurally protected primary; validated central cache retains existing priority | Disabled/deleted decisions in established local authority cannot be overwritten by a higher-active-count historical copy | Partial local stores missing moderator credentials recover only from a protected valid candidate or return 503; no fabricated blank administrator |

## Confirmed failures and fixes

- Another selected buyer or moderator could reopen a known temporary pricing
  draft and receive its content. The registry now binds the creator before any
  file or OS action. Actual UI testing also found its reopen handler attached to
  a different modal; it now executes from the pricing result modal itself.
- The local cold-read migration could choose an older backup with more active
  credentials and undo a real disable/delete decision. Established authority is
  retained. A separate review caught partial moderator-less stores; these still
  require protected recovery. Credential-free placeholder recovery is preserved.
- Generic automation draft downloads accepted another authorized user's known
  filename. Per-owner normal output storage and separate Agent CP namespace close
  that path without assigning guessed ownership to historical files.
- Normal work continued after a permission change. Request and scheduler guards
  now reach source preparation, INTAKE publication, app actions, draft creation
  and browser connection/navigation/step boundaries. A browser action already
  submitted to an external site cannot be undone; subsequent boundaries stop.
- Cached preview data survived canonical order reassignment while the profile
  stayed unchanged. An opaque in-process order-authority identity invalidates
  the cache and active work without repeatedly hashing all orders. The actual
  HTTP transfer case rebuilds to no match and writes no output.
- Private recipient-local Collection images were accessible through the CP
  alias, and deletion paths did not share the private policy. Both aliases now
  enforce the same read/edit policy. License image reads also check the session
  again after asynchronous loading and before returning bytes.

## Validation and review

`bl016-legacy-resource-authority-20261025.json` records source hashes, route
inventory, raw log hashes, focused results and native acceptance phases.

- Final focused run: **58 files, 366 tests, 365 pass, 0 fail, 1 skip**, 4.6s.
  The existing OneDrive reparse-point capability test remains skipped; no skip
  was treated as a pass. No full suite ran for this package.
- Full production HTTP server with isolated synthetic admin and two disjoint
  buyers: private draft references, output namespaces, canonical ownership
  transfer, disabled/deleted users, mixed/stale writes, attachment and image
  aliases, global dictionary positive controls. Denials compare protected file
  hashes and OS-opening counters; audit/lease bookkeeping is intentionally excluded.
- Real Windows Edge UI: owner pricing reopen button, owner automation download
  and run history in TR/EN, disabled account old-cookie 401 and fresh-login 403
  `USER_INACTIVE`. No email was sent and the OS-open boundary was replaced.
- Targeted RED/GREEN evidence covers local migration, cross-owner outputs,
  authority revocation, preview ownership, CP image alias, browser step authority
  and asynchronous license asset revocation. Native screenshots were inspected.
- One bounded independent review of the local migration/draft boundary and one
  of the distinct normal automation boundary; the latter found scheduler
  preparation and order-reassignment gaps. Both were fixed with regressions.
  The reviewer did not run the tests or re-review the final revision.

Codebase Memory transport was unavailable for the touched server files; direct
source and runtime verification were used. Office integrations, real SMB and
populated Electron performance remain BL-019 work; they are not certified here.
