# CPR-11 — failed formula compilation cache

Measured before changing production code on Linux / Node v24.19.0. One warm-up,
five measured runs; 30,000 calls to `matchesRule`, including normalization.
Run `node resources/app/scripts/cp-rule-compile-cache-benchmark.js [source.js]`.
This is a conditional microbenchmark, not whole-app or Windows/Electron speed.

| Formula | Before median | After median | Compile calls before → after | Result |
| --- | ---: | ---: | ---: | --- |
| `=AND(` | 242.52 ms | 1.52 ms | 30,001 → 1 | 30,000 false |
| `=1=1` | 69.68 ms | 68.92 ms | 1 → 1 | 30,000 true |

RED: both regression tests failed before the change (see `cpr-11-red.txt`).
GREEN: both pass. Four invalid formulas retain the exact `validateExpression`
error text, false decisions, and serialized rule output. Tests cover valid →
invalid → valid edits and invalidation by `EXPRESSION_VERSION` for both outcomes.
Cache metadata remains non-enumerable and local to the rule object. No rule
evaluation, grammar, validation or CP decision logic changed.

`npm test -- cp-rule cp-checklist business-rules`: all 13 files passed with
isolated `/tmp/buyerlog-client-tests/{app,local,server}` data roots. The initial
run without those environment variables could not create the default home data
directory; no test assertion failed in that run. No UI content or layout changed.
