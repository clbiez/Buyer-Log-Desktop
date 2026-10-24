# BL-010 — License Cards load outcomes

Confirmed on the actual isolated normal server: absent ASAS input returns HTTP503
and the old no-data render retained six animated skeleton rows after loading had
settled. Four new behavioral regression cases failed before the correction.

Skeletons now render only during an in-flight first load and carry explicit busy
semantics. Terminal first-load failures use the existing shared BLUI error state,
source guidance and a real retry action. Successful empty responses retain the
existing empty-state/filter workflow. A failed load or source refresh retains
loaded cards/drafts and exposes a separate freshness notice/retry. Retry repeats
the failed source POST where appropriate; a cached GET cannot falsely clear that
source-refresh failure. Success clears the notice. Load error codes are retained
until render so TR/EN switching translates the current error without another
request. Existing draft-conflict verification and financial rules are unchanged.

Validation: Linux Node24.19.0, Chromium, disposable synthetic user/config.

- Passed: `npm --prefix resources/app test -- license-cards` — 7 files, 59 tests,
  zero failures/skips. Includes initial failure, pending skeleton, retry/empty,
  stale background data, explicit POST refresh failure/retry, language changes,
  existing drafts and royalty-engine regressions.
- Passed: native normal-server first load returned503; shared error/retry
  appeared with no remaining skeleton. Genuine post-change screenshot uses this
  unmocked outcome. Actual module language switch showed the English error.
- Passed: Chromium follow-up API routes deliberately supplied synthetic empty/
  loaded/error responses. Clicking Retry showed empty success; a later failed
  POST refresh retained the synthetic card and freshness notice; retry repeated
  POST and cleared the notice on success. These follow-up fixtures are labeled
  separately from the unmocked initial failure. Reduced motion was enabled; no
  terminal skeleton remained. No corporate source/financial data was used.
- Passed: current PR fast contracts, i18n and visual-note validation; exact
  result is recorded in the PR. No full green baseline or Windows certification.
- Not executed: actual Windows/Electron/screen reader and corporate ASAS access.
  Full supported-runtime regression remains required before release.

No CSS layer, dependency, financial formula or data schema changes. Shared UI
state uses the existing primitive with a minimal fallback for isolated hosts.
Client refresh required; rollback is a regular revert/refresh, no migration.
