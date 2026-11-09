# Artwork: replace a manual note with the saved BOM

Decision: **PASS** for the affected Chromium client flow. Risk: **P2**. No server,
sync protocol, IAM, migration, Electron/preload or release-channel change.

Base Main: `9e667430e3ac7ca30b321f06893d53f24d6ed5a3`.
Measured source: `f54d49c29db8827bdd96f931508435e208911bd5`.
The subsequent evidence commit changes only this evidence and the actual
post-change screenshot; runtime sources are identical to the measured source.

Budgets were recorded before implementation in [budgets.json](budgets.json).
The scenario uses the real Buyer Log server and UI with 20 isolated synthetic,
persisted Collection rows and BOM evidence, including a Set Style and linked /
overridden colour variants. Fixture SHA-256:
`ea03124728da40aecf5527f5c1184344d6a5d57d7a49f6cd9e4ed930e2661608`.
Node v24.19.0; Linux system Chromium via Playwright; 1500×900, reduced motion.
No production data, upstream CoreNectum, LCW AI or external credentials are used.

## Results

Three alternating Main / same-Main control / candidate contexts on one machine.
Each has five BOM open/close cycles. A common 1500 ms settling interval follows
workspace readiness and font loading. The first BOM open is reported separately
from four repeat opens. Browser-side MutationObserver + requestAnimationFrame
timing excludes tool round trips. These are medians, **not p95 estimates**.

| Metric | Main | Same-Main control | Candidate |
| --- | ---: | ---: | ---: |
| First BOM open, ms | 179.3 | 172.7 | 206.0 |
| Repeated BOM open, ms | 87.05 | 95.8 | 110.15 |
| Existing ordinary cell batch edit, ms | 154.0 | 140.1 | 147.6 |
| Largest collected JS heap, bytes | 17,613,604 | 17,647,508 | 17,688,100 |
| Local BOM GETs / five opens | 5 | 5 | 5 |
| Modal roots retained after each close | 0 | 0 | 0 |

The visible-latency medians are higher in this candidate sample; no speed-up is
claimed. This cloud UI measurement is noisy: paired same-source A/A first-open
medians differ by as much as 166.4 ms and repeat-open medians by 27.55 ms. The
candidate's pooled shifts (26.7 ms first / 23.1 ms repeated) remain within those
observed same-source variations. Candidate repeat-open medians by pair are
137.75 / 109.55 / 78.60 ms, versus Main 89.45 / 62.50 / 112.10 ms; the direction
reverses in the third pair. This establishes no repeatable regression outside
the observed A/A noise in this experiment, rather than a general tolerance or a
performance improvement. Raw samples and heap observations are retained in
[results.json](results.json) and [browser.txt](browser.txt).

The new apply action paints its disabled, applying state in **7.4 ms TR / 8.6 ms
EN**, within the 200 ms feedback budget; its synchronous initial handler costs
**0.4 ms** in both languages, below 50 ms. The established Collection batch
save/render remains synchronous and can exceed 50 ms (see the ordinary-edit
control above); this existing shared cost is not hidden or called fixed here.
The apply action yields a frame before invoking that existing path. No new
worker, poller, eager dependency, remote PLM/AI request or persistent listener is
introduced. Full component lists are excluded from the summary cache. Every
close removes its modal; dialog focus cleanup uses the existing layer helper.

Real UI assertions pass for replacing a manual note, exact multiline A/B data,
TR/EN feedback, acknowledged workspace persistence, Undo, reload, no-print BOM,
no BOM, CP read-only scope, changed row references, edit permission, linked
colour cells, parent propagation and colour-specific overrides. Generic DOM
translation may translate/flatten displayed BOM text; stored data is checked
against canonical BOM evidence rather than translated DOM text.

101 targeted Node tests pass; [targeted-tests.txt](targeted-tests.txt) retains
the output. The tests first exposed the missing explicit apply API; real browser
acceptance also caught input.value stripping A/B line breaks, now covered by a
regression test. i18n, layer/Motion+, shared Collection edits and PLM/BOM
regressions are included. Release-note validation passes with 13 pending entries.
The actual demo screenshot was inspected: current manual note, A/B BOM evidence
and the apply button are visible, without real business data.

## Reproduce

From the repository root, with Playwright available through normal Node module
resolution (or NODE_PATH), run:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  flock /tmp/buyerlog-performance-measurement.lock \
  node resources/app/scripts/artwork-bom-apply-acceptance.js
```

The script reads the specified Main sources through `git show`, uses isolated
data under `work/artwork-bom/`, writes raw results there and captures the actual
post-change release-note PNG. BL_ARTWORK_BASE_SHA, BL_ARTWORK_PORT and
BL_ARTWORK_ORDER can select a baseline, unused port or alternate ordering.
The same machine/runtime lock serializes the browser measurement.

Startup/native/upstream gates: no new startup request or module loading path;
the new functions are inactive until the BOM dialog/action is used. Native
Electron, Windows/SMB and real corporate PLM/AI performance are not measured and
are not changed or claimed by this client-only patch.

GitHub reported `main.protected=false`; branch protection is not claimed.
Merge requires evaluating actual PR CI, independently of that setting.
TEST and STABLE publication are outside this task.
