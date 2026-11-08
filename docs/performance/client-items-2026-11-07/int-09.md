# INT-09 — active LCW AI streaming message

Baseline measured before production changes with the actual chat renderer and
unchanged `lcwai-markdown.js` in Chromium 154 / Linux. Synthetic history: 100
messages, 50 Markdown answers (~1 KB each), 40 growing fenced-Markdown updates
on separate frames. Timings include HTML assignment; long tasks include browser
layout. These are fixture measurements, not production or Electron estimates.

| Metric | Before | After |
| --- | ---: | ---: |
| Markdown parses during 40 paints | 2,040 | 40 |
| Draw p95 | 76.1 ms | 3.5 ms |
| Following frame p95 | 98.2 ms | 18.5 ms |
| Long tasks during streaming | 40 | 0 |
| History node / text selection retained | no / no | yes / yes |
| Reading scrollTop | jumped to bottom | 120 → 120 |

See exact samples in `int-09-before.txt` / `int-09-after.txt` (the baseline file
is the RED run). Reproduce with
`node resources/app/scripts/lcwai-stream-render-acceptance.js --assert-optimized`
and `--source path/to/baseline.js` for the baseline. The render instrumentation
only exposes private functions to the harness. It does not bypass Markdown.

GREEN verifies normalized HTML equivalence with full rendering during streaming,
at final completion, after language changes and conversation switches. Unclosed
code fences, raw HTML and javascript links pass the unchanged sanitizer.
Full renders remain for structural changes and final completion; only rAF stream
paints use the guarded fast path. Final/error rendering cancels pending rAF.
No AI request, content, validation, sanitization or provider code changed.

`npm test -- lcwai markdown`: all 25 files / 230 tests passed, using isolated
`/tmp/buyerlog-client-tests/{app,local,server}` roots. Three new Node regressions
cover fast-path invalidation, safe Markdown, errors, language and scroll behavior.

`node resources/app/scripts/lcwai-stream-screenshot.js` launched the real Buyer
Log server with isolated 20-order demo data, stubbed only the AI answer stream,
and verified retained DOM identity and selected text before capturing the actual
1440×900 post-change screen. The PNG was visually inspected: selected history
and the active stream are both visible. TR/EN release notes accompany it.
