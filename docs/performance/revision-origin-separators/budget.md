# Revision separator acceptance

Tier: L2 (shared table renderer and date resolution). Main: 15b364dd6cac88778174b565d5199ae60fa23222. Candidate runtime source: f256f702. This acceptance plan was recorded after implementing the behavior, before performance measurement; no earlier measurement or pre-implementation budget is claimed.

Measure the actual CP table renderer in headless Chromium on the same machine with synthetic 200-row and 30,000-row inputs, a 50-row visible page and the same columns. Run three independent alternating A/B, B/A, A/B pairs. Each arm uses a fresh browser, identical rows, reduced motion and five render/close cycles. Main and candidate app-main.js/business-rules.js are served from their exact commits; other files are identical. Main/candidate rendering outputs intentionally differ in separators and visible automatic comparisons, while effective data is held equal during the render comparison. Date-rule correctness is verified separately with earlier/equal/later/missing planned dates.

Budgets before measurement:
- Existing visible-response median and longest/main-thread work: no repeatable regression; compare controlled A/A variation if noise obscures a difference. Visible-response target: 200 ms. Existing baseline violations remain explicit.
- Visible table DOM growth for the new automatic old/new comparison: at most 300 additional nodes per 50-row page; no full 30,000-row DOM.
- No new network requests or retained growth across the five close/reopen cycles. Record post-GC heap, DOM count and request count; retain raw samples.
- No new worker, cache, listener or polling subsystem. Cache policy version only invalidates previously computed dates once.

Platform scope: Chromium/Linux table rendering, not a claim about Electron native paths, Windows, SMB, upstream servers or sync; those implementations are unchanged. Backend date selection is a constant-time validity check, covered by the targeted regression tests; no backend throughput claim is made.

Comparable existing-flow control (recorded before that measurement): `--manual` uses the same row/date values with all revisions entered manually, so both variants render the same old/new pairs and DOM. Apply the existing-flow no-regression budget to that control. The mixed approval scenario adds old/new automatic comparisons that Main did not display; evaluate that added capability against the pre-recorded 200 ms response and +300-element new-work budgets, report its incremental cost rather than calling its different output equivalent. `--aa` provides six independent Main arms to quantify timing variation; it does not enlarge any budget.
