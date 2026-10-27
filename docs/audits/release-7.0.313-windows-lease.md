# 7.0.313 release gate: Windows lease-marker access

The requested STABLE publication first prepared 7.0.312 from the merged SYNC fixes. [PR #770](https://github.com/clbiez/Buyer-Log-Desktop/pull/770) merged source `a6afc5e0f518819a09500a3ba5d74b33f2def3f9`. [TEST run 40450340339](https://github.com/clbiez/Buyer-Log-Desktop/actions/runs/40450340339) failed full Windows regression; publishing was skipped and STABLE remained 7.0.311. The immutable `updates/v7.0.312` source is preserved. The corrected candidate uses a new version, 7.0.313.

## Confirmed failure and correction

`file-lease-integrity.test.js`, the existing eight-process sync/async dead-owner recovery test, failed because `fs.promises.access()` on `.retired-owner-<token>` threw `EPERM`. `existsAsync()` propagated it immediately, unlike owner reads and other metadata operations that use the existing bounded `retryAsync` policy. A transient Windows directory-retirement race is a plausible operating-system explanation; the annotation does not itself prove the precise NTFS/antivirus cause.

`8e8acda1` wraps that access in the existing retry policy. Only `EPERM`, `EACCES`, and `EBUSY` are retried. `ENOENT` still means absent; a denied read never means absent or authorizes takeover. Persistent permission failures and unclassified I/O errors still fail closed. The token, generation, live-owner proof, write fencing, and original stress assertions/timeouts are unchanged.

Six deterministic public-API regression cases reproduced the missing retry and then passed. They cover each transient code, live-owner protection, persistent denial, and unclassified I/O failure. The complete relevant lease/context/async-I/O/request-policy/corrupt-owner/responsiveness/concurrency selection passed **51/51**, including the original 64-write/eight-process integrity check. This is local Linux validation with explicit filesystem-error injection; it is not represented as native Windows evidence. The corrected TEST workflow must supply that Windows validation before STABLE promotion.

`bl-windows-lease-native` opened one genuine BrowserContext and three authenticated raw SSE subscriptions against one isolated native backend/data root. Real native writes and authorized delivery, unrelated-owner exclusion, live revocation, and revoked reconnect passed. Its source was clean `8e8acda1` before metadata-only preparation of 7.0.313. The post-change PNG illustrates the real authorized workspace; filesystem recovery is proved by the regression evidence, not by the screenshot alone.

## Retained evidence and scope

Local evidence is `/workspace/deliverables/release-evidence/`: `7.0.312-windows-regression-annotations.json`, `windows-lease-access-red.log`, `windows-lease-access-green.log`, `windows-lease-related.log`, `windows-lease-native.log`. Native original results/PNG remain under `/workspace/scratch/bl-windows-lease-native/`.

The later TEST/STABLE result and exact public artifact identity are recorded separately in `/workspace/deliverables/buyer-log-7.0.313-release-verification.json` only after successful publication. This preparation record does not claim publication has already occurred. The earlier six-user/30-minute load source remains explicitly historical; it did not contain this later retry fix. Its unverified 50-user goal, real SMB/OneDrive limit, and older intermittent drawer-opening finding are unchanged. No new global lock or business rule was introduced.
