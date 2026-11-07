# Parked License CARD-01 — rejected package, preserved source and evidence

The user rejected the reproducible +24.42% license-search p95 cohort and removed
License CARD-01 from the shipping #906 scope. The retained scope is manufacturers
and email CARD-01, LCW AI INT-09 and CPR-11. This archive does not mark License
CARD-01 accepted, skipped successfully, or optimized.

Frozen source head: `f3636ba3220686e9ad4ec2ae6de9fcc3726ba907`.
Restoration Main: `31004ea08982ffcce849640e5c5e3580448f0914`.
Create a named parked branch at the frozen head before appending the removal
commit. Preserve the original three implementation commits and all eight frozen
commits; no history rewrite, reset, rebase or force-push.

`original/` contains exact frozen source/test/acceptance files with `.source`
extensions so archived rejected-feature invariants are explicitly inactive rather
than silently deleted, skipped, or allowed to fail against the restored baseline.
`reapply-license-card01.patch` restores their exact frozen bytes, including the
optimization-only assertions. Reactivation requires a new user decision and new
evidence; this patch is archival, not an instruction to reactivate the feature.

The entirely new `card-list-model.test.js` belongs to License CARD-01 and is parked
in full. The pre-existing `license-cards-editor.test.js` returns to exact Main
bytes: all original functional assertions remain. Its added no-list-rebuild
assertion and incremental DOM fixture remain in the frozen original and patch.

All 14 Quick FOB native functional cases stay active. Their calculations, source
amounts, draft retention, selected-rule and fallback assertions are unchanged.
Only their fixture's rejected-feature invariant (`close must not rebuild the
list`) is replaced by a host that permits Main's existing full render and
captures its real Quick FOB section. The original invariant is preserved here.
The browser Quick FOB functional checks also stay active; only listRetained is
parked. No skip/only flags or relaxed functional result comparisons are introduced.

Mixed browser acceptance defaults to manufacturers/email. Their original output,
identity, scroll, draft/caret, save and lock/language assertions remain unchanged.
An explicit license `--assert-optimized` request is rejected with the parking
reason; license functional output checks remain available without that flag.
The screenshot tool keeps license draft/reopen/discard checks, parks only the
license identity assertion, and no longer overwrites its historical license PNG.

All frozen measurements, profiles, RED/GREEN captures, validation logs and five
release PNGs remain byte-identical. Their exact Git blobs are recorded in the
manifest; the old P2 closure and full-suite green results describe the frozen
feature, not this removal delta. Both license release records become historical;
their PNGs remain preserved but are no longer active release-note references.

This package preparation ran no application tests, benchmarks, npm/install,
browser sessions, or general independent review. Parent integration must verify
the narrow removal delta and updated whole-tree checks after its Main/914 merge.
