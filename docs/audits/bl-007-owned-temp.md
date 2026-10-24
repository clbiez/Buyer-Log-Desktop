# BL-007 — owned temporary inventory and backup safety

Status: Implemented; focused Linux verification passed. Actual Windows validation remains not executed. Based on main `6f8eb33e820c231cb4f7189c728224ad1b58dd57`. No merge or release.

## Reproductions and correction

Without BUYER_LOG_TEMP_ROOT, user-data.js used os.tmpdir() as recursive diagnostic inventory. A foreign unreadable directory therefore aborted legacy backup despite the entire diagnostic temp scope being excluded from backup. Excluded log/draft errors also aborted the same backup. These paths now report explicit structured bilingual warnings with available:false and unknown (null) counts/bytes; authoritative backup scopes still fail on read errors.

The default temp location is an owned subtree of OS temp (BuyerLog-<uid> on POSIX, BuyerLog in the user's Windows temp directory). It is created with private POSIX mode and validated against a root symlink/junction, non-directory, or wrong owner. Backup/restore allocation revalidates this default boundary. One independent reviewer found the initial root-symlink bypass; regression cases now prove no traversal or writes into foreign targets, including a pre-existing startup link and replacement after initialization.

Portable BUYER_LOG_TEMP_ROOT is preserved exactly, including intentional user-configured junction semantics. Defaults place drafts inside the owned subtree; portable draft location stays unchanged. Old default drafts are transient and their prior reopen registry does not survive server restart; old directories are not automatically traversed/deleted. Synthetic tool writes and recovery placement retain the previous temporary-write allowance separately, so changing inventory scope cannot redirect test recovery into a real user profile.

A related confirmed integrity defect was corrected in both full backup channels: sanitizedConfigBuffer and the ZIP service swallowed read/JSON errors and inserted {} into successful backups. Unreadable/corrupt authoritative config now fails the backup. The current ZIP service retains its previous optional fallback only for an absent config (ENOENT), with explicit coverage. No configuration/financial values are changed, and existing secret sanitization remains covered by legacy security tests.

## Verification

Environment: Linux x86_64, Node v24.19.0, uid1000, Chromium headless; disposable synthetic users/config/source/data only. No company databases, live sync folders or integrations.

- Passed: `node --test tests/user-data-owned-temp.test.js tests/user-data-temp-root-recovery.test.js` — 12 pass, zero failures/skips. Covers default isolation, foreign EACCES, excluded diagnostics, actual backup members, config read/corruption, disappearing files, portable root/junction compatibility, root-link bypass, cleanup containment and recovery placement.
- Passed: `TMPDIR=<isolated>/tmp BUYER_LOG_TEMP_ROOT=<same> APPDATA=<isolated>/appdata LOCALAPPDATA=<isolated>/localappdata npm test -- backup full-system-restore user-data durable-file-recovery data-cleanup` — 13 files, 79 pass, zero failures/skips.
- Passed: `node docs/audits/bl-007-http-probe.cjs` — normal server on loopback6297 with dedicated config, disabled IAM/updates/source refresh and synthetic moderator. A real chmod000 foreign temp directory leaves inventory/export HTTP200. Real EACCES on logs, owned temp (write+execute without read) and drafts leaves inventory HTTP200 with three warnings/unknown totals and streamed legacy export HTTP200 (1022-byte synthetic gzip). Four actual EACCES denials independently observed; no mocked permissions in this normal-server probe. See bl-007-http-results.json. Probe removes its own fixture and child process.
- Passed: actual Buyer Log restore UI on an isolated server. A synthetic full-system backup was generated, then uploaded through existing restore preflight. Actual upload file retained under the new owned TEMP_ROOT, preflight HTTP200, confirmation enabled; no restore applied. Genuine post-change PNG: public/release-notes/next-assets/owned-temp-restore-preflight.png.
- The screenshot proves compatibility of the changed temporary upload-allocation path. Current native UI has no consumer for legacy /api/user-data/inventory or /api/backup/export; it does not visualize their diagnostic warnings. Those outcomes are independently verified by the real HTTP/ACL probe above. No UI, result, screenshot or warning was fabricated.
- Passed: `npm run release:notes:validate` (22 entries) and `npm run i18n:check` (zero new/baseline misses).
- Full npm test not repeated for this focused package; the previous BL-006 all-file scheduling remains red on separately recorded design/TL signature cases. No green full-baseline claim.
- Not executed: actual Windows/NTFS junctions/ACLs, SMB/OneDrive and corporate integrations. Intentional portable-junction semantics have POSIX symlink coverage; this is not Windows certification.

## Cleanup and compatibility boundaries

Legacy backup/restore cleanup removes only the exact mkdtemp-created child, never TEMP_ROOT or the global temp directory. Tests retain a foreign sentinel and prove only that generated folder is removed. Existing data-cleanup's configured portable-temp scanning is unchanged; defaults no longer use system temp for this inventory/allocation path. Explicit environment overrides remain trusted configuration and must designate the intended application-owned root.

API additions (`warnings`, diagnostic `available`, null unknown counts) are backward-compatible manifest extensions. No backup schema, restore scope, business-rule, signature or dependency change. Backend restart required. Rollback is a normal revert and restart; there is no data migration. Owned temporary artifacts can remain safely and should not be swept automatically. Reverting restores the diagnostic-abort and empty-config-backup defects.
