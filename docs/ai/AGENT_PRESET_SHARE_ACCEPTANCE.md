# Agent preset sharing (presets.share.read / presets.share.apply)

Office adapter for the native Preset Share flow (user menu › Preset Sharing). The service was split without behaviour change into `plan()` (pure) and `commit()` (writes); the user menu calls `apply = commit(plan())` exactly as before, and Office previews the same plan and commits it CAS-bound. No second merge rule exists.

- **Authority**: the owner only writes to their own workspace (`ctx.ownerId === profile.id`); the source must be another active user; the source record is read only. Same scope as the native route (personal presentation preferences; no permissions, data scope or applied Horizon snapshot).
- **Approval**: the fingerprint binds the source, mode, items, exact planned key values, removed keys, the target's current entries and profile stores (profile copy timestamps excluded).
- **Write / verification**: `commit` with `expectedEntries` (the target's state at preview) via `userPreferences.applyEntryChanges`; every set/removed key is read back. The native menu undo slot is written as usual.
- **Inverse**: prior entries and profile stores are archived as an owner/job/step-bound artifact. Undo is CAS-bound to the post-effect entries and profile hashes (refused with `OFFICE_PREVIEW_CHANGED` if the owner changed anything afterwards), restores exactly and discards the now-stale menu undo slot of that application.

Validation: `tests/agent-preset-share-tools.test.js` (4 cases incl. menu behaviour after the split), `tests/preset-share.test.js` (8), unified access matrix and i18n guard. Real anonymous HTTP/Chromium acceptance on an isolated demo server with a second demo user, TR and EN: read listed the source presets, execution without approval returned 409, approved apply completed and verified, undo restored the owner's absent keys and removed the menu undo slot, zero page errors.
