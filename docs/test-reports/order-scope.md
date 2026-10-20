# Test report order scope

A request number identifies one report, not one purchase order. The printed Order No is the primary identifier; free-text Description / Explanation can contain additional orders. The original description and all merged description variants remain part of the report evidence.

## Intake and matching

`test-report-engine.js` is the shared browser/server source of truth. Mail table/colon fields and bounded PDF description cells feed the same scope derivation. `orderScopes` recognizes order labels and delimited lists; unknown standalone numbers remain unverified candidates. Numbers embedded in product IDs and labelled standards/measurements are excluded. Ranges are never expanded, digits are never guessed, and duplicate order codes are normalized before matching.

`matchReportScopes` matches each scope independently against CP order, model and colour. A primary match cannot hide a missing or ambiguous secondary order. Every scope is shown in preview, including orders absent from CP. A description that refers to orders requires explicit selection; extra or uncertain orders are never preselected, even after applying a type/AI suggestion. Users can expand the preserved source text. Arbitrary prose/OCR cannot guarantee perfect extraction: unclear annotations remain a review task rather than implying complete automatic coverage.

## LCW AI

The existing LCW AI extraction contract copies the full description; review receives all description variants and deterministic order scopes once per report. AI cannot create a PO by returning a separate guessed array. AI-read fields remain subject to manual confirmation. The Quality Agent also matches each scope independently and exposes its supporting evidence; additional scopes require `confirmMatch`. Neither AI path bypasses canonical validation or introduces another provider.

## Persistence and authority

Reports remain keyed by request number. A link keeps its legacy primary fields and an additive `targets` array. `reportLinks` reads both historical single links and new multiple targets. Reimport updates a target in place and preserves siblings and the stable primary alias. No destructive migration is needed.

Each target owns its own attachment metadata. The same PDF can be attached independently to multiple authorized orders without borrowing another order's attachment ID. Reimport of the same target/file is idempotent. Checklist outcomes and Buying tasks are grouped by order + checklist step across all linked reports; each target gets its own status and manual-answer protection.

Native commit validates the selected PO against server-parsed scope, explicit extra-order confirmation and current writable order identities. Updating a shared report additionally requires write access to every existing target; this is checked again under the report file lease before any attachment/report effects. Reads filter target links and attachment IDs by authorized order scope. Agent rollback checks all targets and their checklist dependencies.

## Verification

Regression coverage includes flexible TR/EN labels, unicode separators, multiline mail/PDF cells, unlabelled candidates, ranges, unrelated numbers, merged evidence, independent matching, rejected AI guesses, multi-target persistence, stable primary identity, per-target attachment idempotency, forbidden/unmentioned orders, scoped reads and shared-report write authority. The supplied request 363443 was also parsed locally from its original MSG and both embedded PDF language variants; all three orders were recovered. The original business document is not committed.
