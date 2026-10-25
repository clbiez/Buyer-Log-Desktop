# Final integration test fixture repairs

The first integrated full run on `7005cdfe480fae734e5a33b95960ac13e51b766c` stopped in batch 1: 1,988 tests, 1,982 passed and six failed. It is not counted as a successful full regression.

The failures exposed stale extracted-function fixtures/contracts after the acknowledged bulk preparation path and compact header were integrated:

- Checklist and landed-price VM fixtures did not provide the real `kolBulkPreparing` lexical flag. The Checklist fixture also lacked the new presentation-only `kolSetSaveFeedback` dependency. They now supply the normal non-bulk context; journal recovery and all copied price-input assertions remain unchanged.
- The accessibility assertion required an exact historical HTML substring. It now checks the same explicit translated accessible name, plus translated tooltip and visible-label span independently. Native TR/EN screenshots already verify the actual compact header.
- The peer synchronization contract expected a direct `renderOrders()` call in the paste wrapper. That wrapper now awaits the durable mutation then delegates to `applyAcknowledgedCpDraft`. The test asserts that order, all three peer projections and the renderer in the acknowledged helper. Existing runtime synchronization assertions remain.
- A targeted follow-up found the same missing normal bulk flag in the later `revision-v476` persistence VM; its actual transfer/save/restart assertions remain unchanged.

Focused verification: **6 files / 54 passed / zero failures or skips**. No product code changed in this repair. The final standard full regression must run again; the earlier failed attempt is retained locally as `work/remaining-final-full-attempt1.log` and the final certification records both attempts.
