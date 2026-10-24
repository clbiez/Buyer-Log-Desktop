# ND-002 — failed USD signature can downgrade into TL parsing

Confirmed on authoritative main and independently reproduced before correction:
a synthetic USD workbook with the intentionally wrong depot-month formula plus
a second V:W legacy FX table is accepted as legacy-tl. Adding fake legacy C1/C2
metadata also allows acceptance. The fallback previously treated successful
legacy table parsing as sufficient proof of model identity. No actual company
workbook compromise or incorrect production price is asserted.

The generic shared-sheet fallback now requires positive legacy metadata
(nonempty string season C1 and numeric Excel date C2) and no formula in the
known USD component/total output cells C15:C19. A failed USD signature or an
ambiguous layout retains MODEL_SIGNATURE_MISMATCH; no formula or rate is altered
to make the workbook fit. Existing raw legacy parsing/recovery APIs are unchanged.

This is a deliberately fail-closed classification guard, not cryptographic
authenticity. The accepted legacy data format still has its own calculation
rules. A completely reauthored valid TL workbook is a TL workbook; neither this
guard nor existing formula validation authenticates who authored its data.

Verification, Linux Node24.19.0:

- New mixed-model negative case failed before correction. Broken USD + legacy FX
  and the same file with fake legacy metadata are now both rejected. A positively
  identified TL layout, strict USD signature/reconciliation and rejected-upload
  invariants pass: `node --test --test-name-pattern='broken USD signature|positively identified|USD files still|rejected upload' resources/app/tests/endeksmatik-import-independent-sets.test.js` — 4 pass, zero failures/skips.
- `npm --prefix resources/app test -- endeksmatik` — 80 tests, 78 pass, two known
  failures: V:W-origin TL import (separate ND-001) and UI regex (PR687). Zero
  skips. These failures are not hidden or declared green; combined validation
  must include both independent corrections.
- Actual normal-server native upload of the mixed-model fixture returned422 /
  MODEL_SIGNATURE_MISMATCH. No set was created, original legacy version stayed
  unchanged, and the genuine error toast screenshot was captured. No mocked HTTP
  or company data. Only synthetic files in disposable persistence roots.

Draft / compatibility gate: actual supported TL workbook variants and Windows
validation remain unexecuted. Legacy files missing season/date metadata or
containing formulas in C15:C19 are now ambiguous and rejected through generic
upload. Do not claim such variants work or that none are deployed. A safe
masked real-structure fixture review and independent financial-boundary review
are required before merge/deployment; neither has been performed in this
environment. Do not weaken the USD guard or guess a new financial formula to
accept an unknown file. Existing sets and calculations are unaffected.

Backend restart required. No schema migration. Revert/restart restores old
classification and its confirmed downgrade, so keep imports restricted during
any rollback. No merge or release is authorized by this draft.
