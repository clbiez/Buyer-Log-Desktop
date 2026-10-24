# ND-004: checklist first rendering

While verifying BL-016 in real Edge, the report tasks endpoint and runtime state contained the authorized task, but the first CP display still showed empty checklist cells. Calling the existing explicit refresh function populated them. The decision result was already cached and the source array matched; the applied checklist rows did not.

The bridge wrapped `renderCP`, while deferred flushes and earlier captured references could reach `renderCPNow` without that wrapper. The hook now wraps the actual renderer; an older host without that entry point retains the direct-render fallback. Cached decisions and column reuse remain in use. No authority, financial, persistence or record identity rules change.

Three regressions failed before the fix. Four pass after it, covering captured first rendering, hidden/deferred flushing, receiver/argument preservation, idempotent hook installation and the older-host fallback. The related 17-file selection passed 121 tests before the final fallback fixture was added; the final four-case test also passes independently. An initial version of that extra fixture incorrectly replaced an already-installed renderer hook; its setup was corrected to represent a host without the native entry point before hook installation.

The genuine post-change 1440×1000 Edge PNG was captured after the first CP navigation **without** manually calling the refresh function. Checklist statuses, the authorized Buying task and the foreign row's locked controls appear. Browser assertions require exactly one authorized task and no task from the foreign report. This is a two-row synthetic functional check, not a populated-desktop performance benchmark.

`nd004-checklist-first-render.json` records exact combined regression counts, current main identity and the runtime file hash. The integration includes merged #702 and all preceding continuation fixes; isolated PR branches are not each certified full-green. The current PR fast workflow targets only `main`; stacked PRs have no Actions checks. The equivalent 17 core contract/i18n/visual-note checks and visual-note validation pass locally.

The broader audit backlog, installed migration and actual corporate deployment acceptance remain open. No merge, TEST, STABLE or manual patch was published.
