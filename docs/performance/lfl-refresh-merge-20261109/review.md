# Critical diff review

The original PR's error recovery is still restricted to COMPUTE_JOB_TOO_LARGE.
Worker execution errors, access denial and stale generation are not converted to
success. Original owner checks, descriptor membership, before/after snapshot and
before/after calculation assertions remain. The existing local lane serializes
recovery, keeps its original 64-entry bound and refuses work after close. Neither
worker budgets nor queue, timeout, permission or test thresholds are raised.

## Large-data finding and correction

The original integrated source (a8f183bf) completed the 30k real HTTP scenario but
blocked the server for 1.37–1.45 s. Splitting only aggregation exposed the separate
snapshot JSON parsing block. Both failed/diagnostic result sets are preserved.
The final path yields while parsing and aggregating. Source checks bracket both
operations, so a concurrent source replacement cannot publish a mixed generation.
The yield callback also observes pool closure; no new worker, cache or timer is
created. Source parsing still verifies the checksum/schema, fallback backup and
sidecar metadata using the existing snapshot implementation.

The new cooperative parser is opt-in to the LFL recovery read. All existing
snapshot callers keep the original synchronous decode. It uses native JSON.parse
for complete bounded values and preserves own __proto__, duplicate keys, Unicode,
false/0/null and property order. Large nested/escaped input, malformed containers,
trailing data and cancellation are covered. Snapshot write/lease/sync/backup
formats and algorithms are unchanged. A single huge scalar is still parsed by
the native parser; this 30k source acceptance is not an unlimited-size certificate.

Both LFL drivers consume one generator, so country, distinct-order, seasonal,
monthly and cumulative arithmetic/insertion order remain identical. An ASCII
uppercase shortcut is equivalent to Turkish uppercase followed by the existing
İ→I fold; non-ASCII still follows the original Turkish locale path. Turkish folds
and the complete 30k output are checked. Native workers retain the synchronous
driver; only rejected admission uses cooperative execution.

## Existing Main integration failure

Main's #960 app.css introduced a 4px radius, six raw color fallbacks and two
undefined variables. Clean Main reproduces the same three design-token failures.
The seven declarations now reference existing canonical radius/divider/field
border tokens. No assertion/baseline was changed, and the existing savings/header
layout is retained. A dedicated TR/EN note and actual shipping screenshot record
this prerequisite correction. It does not alter order data or financial rules.

Single-agent critical review. No independent reviewer is claimed. This is a
readonly calculation/snapshot decode change, not a new writer, IAM policy,
protocol, migration or native/updater boundary. Full regression and final-head
GitHub checks are additional gates; local tests alone are not called CI.

## Second existing Main failure found by the full suite

After the CSS guards passed, batch 3 exposed an obsolete exact lcwaiChat asset-list
assertion in layout-control-v1101.test.js. Clean Main reproduces it. #959 added
lfl-calculation-engine.js and lcwai-lfl-query.js ahead of the query/chat scripts;
the test still expected the old four-file list. The assertion now requires all
six files in their real dependency order. All BuyerLogAI/security, lazy-loading
and layoutControl assertions remain. Targeted RED on clean Main, GREEN 15/15;
this is test-contract maintenance, with no further runtime change. The interrupted
full-suite log is retained and is not combined with later batches into a PASS.

The initial token-only CSS correction was insufficient: the later shared-style
contract also requires appearance ownership in ui-components.css. The final fix
removes redundant module border/radius declarations already overridden by the
Manifest table rules, retains the shared header dividers, and moves savings
emphasis/resizer layering into the shared owner. Numeric font sizes/layers use
canonical tokens. No style-test allowlist is added. All 36 design/Manifest/layout
contracts pass. The new actual UI replay has 64.47 ms feedback and its PNG was
inspected. Only CSS changed since the measured LFL runtime; byte identity of all
measured LFL/client/server files is explicitly verified. The third stopped suite
is retained; a new uninterrupted standard suite follows this final correction.

Final visual inspection also verifies that shipping column resize markers remain
visible. They use the existing shared ::after affordance, a canonical field-border
color and canonical layer, not a private table/body border. The actual UI replay
asserts a 1px nontransparent handle with col-resize behavior. Final feedback is
84.54 ms (<200 ms). A running pre-marker full suite was deliberately cancelled and
retained; it is not counted as a completed PASS. Full validation restarts on the
final runtime 08d56fd8. No measured LFL/server source changed in these CSS followups.
