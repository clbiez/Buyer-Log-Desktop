# ND-001 / BL-006 — absolute legacy Endeksmatik columns

Confirmed product defect, not a weakened financial fixture. A direct call to
the original legacy parser rejects the existing synthetic TL workbook with
FX_TABLE_MISSING: Değişimler has used range V1:W2, and SheetJS starts its row
arrays at V while the parser reads absolute indices21/22. The generic upload
then hides that fallback failure behind the original USD signature error.
Summary/pivot variants beginning at B expose the same fixed-column assumption.

The legacy row reader now normalizes only the used range's starting column to A;
it preserves the existing used-row bounds and fixed B:F/G:J/V:W identities. No
financial formula, rate, missing-value policy or USD signature rule changes.

Regression verifies exact dimensions, weights, four component series and both FX
rates with B/V used-range starts and with an explicitly populated A column; both
layouts produce identical domain values. The pre-change direct parser failed.
Actual normal-server UI imported the synthetic V:W workbook with HTTP200,
legacy-tl model, one class and a new independent set; the original legacy set's
version stayed unchanged. Genuine native success screenshot included. No mocked
HTTP or corporate workbook was used; all persistence was in a disposable root.

Linux Node24.19.0: `npm --prefix resources/app test -- endeksmatik` — 79 tests,
78 pass, one known UI-regex harness failure already corrected separately in
PR687; zero skips. Strict USD signature/reconciliation/rejected-upload cases
passed. Combined validation must include PR687 to remove that unrelated failure.
Actual Windows/corporate workbook validation is not executed.

Separate discovery ND-002 confirms the generic upload's pre-existing USD-to-TL
fallback can accept a broken USD formula workbook when it also has a legacy FX
table. That behavior exists before this column fix. It has its own branch/tests
and draft PR; this change does not claim to fix it. Audit BL-017 provenance work
remains separate and pending. Backend restart required. Rollback is revert and
restart, no migration; accepted independent sets remain unchanged.
