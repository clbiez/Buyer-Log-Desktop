# Final integration test fixture repairs

The first integrated full run on `7005cdfe480fae734e5a33b95960ac13e51b766c` stopped in batch 1: 1,988 tests, 1,982 passed and six failed. It is not counted as a successful full regression.

The failures exposed stale extracted-function fixtures/contracts after the acknowledged bulk preparation path and compact header were integrated:

- Checklist and landed-price VM fixtures did not provide the real `kolBulkPreparing` lexical flag. The Checklist fixture also lacked the new presentation-only `kolSetSaveFeedback` dependency. They now supply the normal non-bulk context; journal recovery and all copied price-input assertions remain unchanged.
- The accessibility assertion required an exact historical HTML substring. It now checks the same explicit translated accessible name, plus translated tooltip and visible-label span independently. Native TR/EN screenshots already verify the actual compact header.
- The peer synchronization contract expected a direct `renderOrders()` call in the paste wrapper. That wrapper now awaits the durable mutation then delegates to `applyAcknowledgedCpDraft`. The test asserts that order, all three peer projections and the renderer in the acknowledged helper. Existing runtime synchronization assertions remain.
- A targeted follow-up found the same missing normal bulk flag in the later `revision-v476` persistence VM; its actual transfer/save/restart assertions remain unchanged.

Focused verification: **6 files / 54 passed / zero failures or skips**. No product code changed in this repair. The final standard full regression must run again; the earlier failed attempt is retained locally as `work/remaining-final-full-attempt1.log` and the final certification records both attempts.

The next standard run passed batch 1, then exposed five further stale tests in batch 2. To avoid repeatedly executing already-passing groups, an explicitly labelled diagnostic executed the previously unreached batches 3–5 once, retaining every child exit status. That diagnostic found four more failures in batch 3; batches 4 and 5 passed. It is not reported as a full-suite PASS.

The remaining repairs also change tests only:

- Pending-write debounce fixtures now provide the browser `window` dependency introduced by real batch capture. Existing same-row coalescing and different-row retention assertions remain.
- Grid range preservation checks the real exported API instead of assuming it is the final object property.
- Imported-price and blank Non-DTR manufacturer checks now execute the actual row normalization and serialized PATCH, including positive manual-price persistence and negative DTR/imported-price cases. They no longer require an obsolete exact `if` spelling.
- The old auth-recovery test expected a protected active moderator hash to be overwritten by a richer historical copy. BL016 intentionally forbids that credential/account resurrection. The test now verifies current hash/revision and deleted-user decisions survive; historical evidence stays untouched. Existing absent/partial-store recovery tests remain.
- Both image aliases test the actual cache-header expression for private `no-store` and ordinary immutable images. The existing header-removal ordering checks remain.
- The real OAB lease/revocation test once failed before reaching the security assertion because Windows child startup exceeded its 500ms assumed readiness window under four-worker load. It now waits up to ten seconds for the actual lease-holder handshake. Revocation and no-side-effect assertions are unchanged.
- The section-display inventory explicitly includes the new scoped `.blBulkBody section` rule; the global hide rule and required visibility checks remain.

Follow-up focused verification: **8 files / 78 passed / zero failures or skips**. No business, permission, pricing or persistence source was reverted to satisfy historical test assumptions. All test groups have now been reached; the final standard `npm test` is still required on the repaired snapshot.
