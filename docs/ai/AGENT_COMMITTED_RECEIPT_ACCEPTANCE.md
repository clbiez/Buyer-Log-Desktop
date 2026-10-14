# Authorized native effect receipts and current-scope publication

An authorized native write can commit just before IAM changes. The previous Office receipt WAL repeated the current IAM check, discarded the completed Runtime result and marked the step interrupted. The real native Transit Delta/Delta-only tests reproduced this with retained business changes and no Office inverse.

Office now persists a private receipt only when the exact reserved running owner/job/step/device matches its completed native Runtime input, workflow, successful effect/verifier and identical output. It then independently checks current authority for publication and downstream work. It does not repeat the native write. Unknown, foreign or transplanted Runtime receipts still fail closed.

Intermediate and terminal task responses retain current publication checks. Failed responses use the same restricted metadata projection as the task list. Request text, arguments, previews, values and inverse artifact identifiers are excluded outside current user/agent authority. Associated task-derived memory is filtered in the same owner transaction, including old jobs outside the current state page; private history is retained. Confirmed inverses still use current native permission, profile and source guards, remain available after agent re-enable and publish restricted metadata when appropriate.

## Validation

- Independent focused review: 34 native/framework checks passed; the discovered failed-response disclosure was closed with the unchanged retained repro (`disclosed:false`, `nativeUnchanged:true`). The new off-page memory case independently passed. No open P0/P1 remained in that focused review.
- Current targeted framework group: 136 passed, zero skips. Additional CP/native Runtime group: 27 passed; analytic export/disk/native output group: 8 passed; OAB execution group: 12 passed.
- The first full attempt failed seven controls (five callers omitting the optional native Runtime-store dependency, one error-priority compatibility check and an OAB test expecting an old reply after access loss). The canonical native store fallback and error ordering were fixed. The OAB test now checks denied publication and the private verified start receipt while preserving zero-request/zero-snapshot and native access-revoked assertions. No arithmetic or security check was removed.
- Final current-source full sweep: all 989 files/nine batches passed. Platform/opt-in skips are reported separately and not counted as passed.
- Actual anonymous native HTTP/Chromium acceptance: approved Transit task completed; pausing the real agent hid request/preview/result/inverse details and the action button while retaining completed status; re-enabled native inverse completed; page errors zero. Two actual 1440×960 PNGs document those outcomes. TR/EN guard has zero gaps, the empty baseline is unchanged, and both future visual entries validate.
- These changes follow the already published immutable STABLE 7.0.273 and belong to a future release. Corporate PLM/LCW AI/SSO and physical packaged Windows acceptance are not claimed.
