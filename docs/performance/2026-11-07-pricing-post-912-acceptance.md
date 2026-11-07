# #901 — post-#912 integration acceptance / entegrasyon kabulü

User authorized sequential merge of #912, #901 and #914, each only after its
current Main integration passes required checks. This record is #901 only.

## Değişti / Changed

Main `6632624951bdbd2e76c5640138bf73f2979e60e8` was normally merged into the
preserved #901 head `b50a9d91bf9935ca89347ea6a1bc20fbb23ab5df`, producing
`ff37743feb3edd53acc6b6dc954056f53c433c7e`. No rebase or force-push.
The only conflict was pending notes: all **39 Main** and **40 prior-PR** objects
were retained, with **41 unique entries**. No original note was rewritten.
Both pricing post-change PNGs and historical measurements remain unchanged.

All six measured pricing source files are byte-identical to the independently
reviewed head. Imported Main preserves #892's CP input revision and #912's
Orders-only hydration, live guard and native profiler regression. No new
optimization, benchmark, test relaxation or production IAM change.

## Doğrulama / Validation

Frozen source/test/notes SHA: **ff37743feb3edd53acc6b6dc954056f53c433c7e**.
`resources/app` tree: **2c829c02148f4896089bdcbef8a824049a7dec1c**.

Linux, Node **v24.19.0**, unchanged standard runner, default **concurrency 4**.
Every command used a separate private TMPDIR. No NODE_OPTIONS, global app/local/
auth/server-root override or runner change. Filesystem sandbox was bypassed
only because the environment denies Node child-process stdio inside it.

- Related `npm test -- pricing quotation open-costing local-iam-migration-authority
  v714 cp-orders-hydration cp-decision-input-revision runtime-profiler`:
  **53 files / 333 PASS / 0 FAIL-SKIP-CANCEL**.
- Standard unfiltered `npm test`, **one invocation, all ten batches**:
  **1,293 files / 8,872 PASS / 0 FAIL / 65 existing SKIP / 0 CANCEL**, exit 0,
  233.2 seconds. No continuation or alternate concurrency.
- After full run: `npm run i18n:check` **0 new / 0 baseline**;
  `npm run release:notes:validate` **41 PASS**.
- [Exact commands, source/tree identity, batch times and lossless log hashes](../performance-program/evidence/pricing-client-cost-20261107/acceptance/post-912/manifest.json).

## İnceleme / Review

The single independent `gpt-6-astra` review of `b50a9d91` found no reportable
P1/P2. The six pricing files remain unchanged during this normal Main merge;
the imported #912 source has its own completed independent review. No new
general review round is claimed. Final-head GitHub checks must still be
verified before exercising the user's conditional merge authorization.

## Ölçüm ve kapsam / Measurements and scope

Existing clean CPR-05 and other client measurements retain their original SHAs;
no new Main-wide startup or performance gain is claimed. The measured pricing
paths and fixture hashes did not change, so their benchmark was not repeated.
**CPR-06 remains partial: large initial DOM row/column windowing is not done.**

**At record creation: not merged; final-head CI pending. TEST not published;
STABLE not published.** Actual merge/CI status is tracked on PR #901; earlier
green checks are not reused for the new head.
