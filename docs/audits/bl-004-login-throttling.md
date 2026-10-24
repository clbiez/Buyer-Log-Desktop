# BL-004 — trusted login throttling

Status: PR Open — [#686](https://github.com/clbiez/Buyer-Log-Desktop/pull/686); behavior verified locally. Baseline: main `6f8eb33e820c231cb4f7189c728224ad1b58dd57`, Linux x86_64, Node v24.19.0, Chromium. No merge or release.

## Reproduction and root cause

The inspected diagnostic probe on isolated synthetic accounts returned `401,401,401,401,401,429,429` from one peer/account/header, followed by **401** when only `X-Forwarded-For` changed. The login key preferred an untrusted forwarding header to the socket. Unknown users did not accumulate failures. Three new HTTP regression tests initially failed; the expiry test passed; see the reproducible committed tests rather than production accounts.

The same synthetic probe independently confirmed BL-002 (`firstStillActive:true`, second entry 5.209 s after first at a 5 s threshold), BL-003 (`UPDATE_DB_ROLLBACK_MISSING`, DB old/WAL newer/pointer 1.1.0), and BL-008 (10 ms timer delayed to 305.36 ms under a 300 ms synchronous lock timeout). These are diagnostic observations, not application-scale performance certification. Those packages remain unresolved.

## Implementation and compatibility

- Canonical recognized profile ID unifies normalized usernames and legacy userId login. Unknown names retain the existing Turkish username normalization. No identity matching policy is changed.
- Peer identity comes only from `req.socket.remoteAddress`, with IPv4-mapped normalization. No proxy header or Express trust-proxy configuration grants identity. An account bucket also survives actual peer rotation.
- Five failures trigger the existing 60-second lock. Blocked checks do not extend it. Expiry resets history; successful login clears account and peer histories. Unlocked failure history expires after five minutes.
- Known and unknown identities have separate pools of at most 4,096 fixed-size hashed bucket keys each. Unknown-name floods cannot evict recognized users' active protection. No background timers or persisted credentials/state are introduced.
- Deliberate saturation policy: live buckets are never evicted. When the known pool is full, a previously untouched known account can receive 429 until the next expiry (at most the five-minute failure window). Default capacity holds at least 2,048 distinct single-peer accounts; this boundary is tested at a reduced capacity. This fail-closed bound prevents a capacity-based throttle bypass, but large directories may need a separately designed capacity policy. Unknown-pool saturation does not consume known-pool capacity.
- Existing cookie/session, password/PIN, offline IAM, setup and audit behavior is retained. Unknown-account failures now throttle. The lock message uses structured retryAfter in TR/EN and updates when language changes.

## Verification

| Classification | Command / environment | Outcome |
|---|---|---|
| Passed | `node --test tests/login-throttle.test.js tests/login-throttling.test.js` / Node 24 Linux | 10 tests: spoofed/comma-separated headers, Turkish case aliases, legacy ID, parallel failures, peer rotation, pool bounds, saturation recovery, timeout, successful reset and localized formatter. |
| Passed | `npm test -- login-thrott user-access central-iam auth.test i18n-coverage` / Node 24 Linux | 10 files, 63 passed, zero failures/skips. Includes real Express login, password/session and central/offline IAM regressions. |
| Passed | Real Chromium form on fresh isolated normal server | Five wrong submissions return 401, sixth 429; forged header remains 429. Lock is visible on actual sign-in page, switches to English without resubmitting. Genuine post-change PNG: `public/release-notes/next-assets/login-throttle-trusted-peer.png`. |
| Passed | `npm run release:notes:validate` | 22 pending release-note entries, including new screenshot. |
| Failed baseline / not rerun | Full standard suite at BL-001 checkpoint | Batch 1 stopped with capacity/locale harness failures (BL-006): 2,087 pass, 3 fail, 60 skip. No claim of complete regression success. |
| Not executed | Actual Windows Electron, corporate sign-in service | Environment unavailable; local synthetic IAM tests do not certify these integrations. |

One independent reviewer found no header/alias/concurrency bypass and identified the saturation tradeoff above, now covered explicitly. No measured performance improvement is claimed.

## Deployment and rollback

Restart the backend to activate new in-memory throttling; refresh the sign-in page for localized feedback. No database conversion, migrations, dependencies, credential resets, or release publication. Revert this PR and restart to roll back; that also restores the forwarding-header vulnerability. In-memory limits reset on process restart as before. A distributed cross-process or persistent limiter is outside the current direct-loopback architecture.

Combined local validation with BL-001 and BL-006 implementation diffs: 45 files, 310 passed, zero failed/skipped; 23-entry combined release notes validated. No PR merged or release published. This focused integration result does not certify the full baseline or Windows.
