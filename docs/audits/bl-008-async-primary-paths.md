# BL-008 — first wave of asynchronous primary request paths

Status: **request lease-wait implementation complete; final integrated full
regression is pending. The wider project remains open.**
The user explicitly requested saving the full suite for the end. This wave has
focused checks and native acceptance only; final integration will receive one
full regression before batch merge. It is not certified by the older main suite.

| Path | Change | Preserved contract |
|---|---|---|
| Fabric upsert/delete/inverse and GET | Awaited lease, async validated read and durable JSON | Revision check and current session/area/edit guard after waiting |
| Checklist answers/definitions/inverse and GET | Awaited lease, async primary/last-good I/O | Full-batch validation, clocks, evidence, receipts and live record scope |
| Primary preferences GET/PUT/delete | New async APIs reuse the same pure merge/delete plans | Session-bound owner, whitelist, tombstones and horizon generations |
| Same-thread sync contender | Immediate SHARED_WRITE_BUSY for its own active async owner | No takeover, token/generation change or blocked owner event loop |
| Async lease internals | Awaited metadata, pins, ownership checks, renewals, retry and release | Existing protocol v2, generation fencing and mixed sync/async recovery |

Readonly async backup reads do not repair outside a lease. A mutator may recover
the verified backup under its lease. Success waits for the real durable writer;
tests pause an actual target FileHandle.sync to prove no premature completion.
The synchronous preference APIs remain for callers not yet migrated. An old sync
caller cannot wait for an active async owner on its own event loop; it now returns
the existing busy/retry result immediately. Other-process timeout/recovery rules
and the lease format are unchanged.

The identical external-lock fabric fixture on unchanged main delayed an unrelated
health request by 2,959 ms and ended the write with409. Updated primary paths
respond while waiting. This is a controlled local measurement, not a populated
desktop percentile. The actual full server, real Windows Edge, synthetic IAM
accounts and UI save were also tested again after the metadata conversion: unrelated reads took roughly5–20 ms while
each of the three resources was held by another process; no write acknowledged
before release. Genuine TR/EN post-change PNGs show the saved/reopened fabric card.
An initial fixture expectation used English Cotton in the Turkish field; it was
corrected to the existing Pamuk localization without changing product behavior.

See `bl008-async-primary-20261024.json` for source hashes, focused run scopes and
limits. One bounded independent source review found no concrete new P0/P1 issue;
the reviewer did not run tests. The metadata protocol has its own bounded review
and evidence recorded in the JSON. No full run, merge or publication is asserted.

The metadata wave has 39 passing targeted lifecycle tests, including actual
worker termination, mixed reclaimers, persistent unlink denial and late writes.
Async protocol tests deny synchronous filesystem calls, inject a transient
Windows sharing violation, and verify that retries yield. Initializer and
release windows remain fenced; in-flight renewal drains before release. A
callback is marked completed before slow cleanup so an independently leased
mirror can run, while a detached write without a new lease remains rejected.

The wider DB/updater integration subset reported 182 pass, one skip and one
failed measurement. That test counted every async `.tmp` open as a DB snapshot;
the two additional files were lease metadata. Its measurement now counts only
temporary images of the actual DB, including its backup. The repaired file
passes all 27 cases and still requires one WAL open and zero DB snapshot writes
for a 200-record batch. These overlapping runs are not added into one total.

## Workspace and global request policy

The async family now also covers horizon/apply/reset, workspace copy/replacement,
entry CAS and snapshot restore using shared pure plans. Native personal/admin
Horizon and data-management layer routes await their writes and recheck the
current authenticated session. Assigned defaults migrate asynchronously and
retry against a changed assignment without removing newer personal decisions.

All HTTP handlers inherit a no-wait lease policy before authentication. Legacy
synchronous callbacks, including IAM transactions, keep their commit contract:
when a lease is contended or its synchronous metadata would retry, they return
SHARED_WRITE_BUSY409 immediately instead of calling Atomics.wait. Awaited writers
continue to queue normally; synchronous startup behavior is unchanged. This is
a deliberate compatibility choice, not a claim that all legacy file I/O has
become asynchronous. The real calendar DELETE returned409 in roughly5–11 ms
with an external holder, no mutation, then200 after release.

The bounded workspace review found one missing session check in the personal
layer guard. Both personal filter and layer RED regressions reproduced it; the
guard now resolves the current session and initial owner. Actual Edge testing
then exposed a separate existing local IAM credential-generation bug and an
independent review found its real backup-restore bypass. Both are fixed with
targeted tests; see `bl016-local-credential-revocation-20261024.json`. A real
password update while the layer request waits now yields403 and unchanged
preference bytes; the active account can sign in again. Existing logout only
clears its browser cookie and was not used as proof of server-side revocation.

The focused groups overlap and are recorded individually in the JSON. No full
regression, final merge or release has been performed for these changes.

## Completion and remaining acceptance

- Legacy callers and the compatibility tradeoff are recorded in
  `bl-008-legacy-request-policy.md`; these are not mislabelled startup-only.
- Prior-intent recovery now uses async I/O. Missing/corrupt payloads preserve
  the original intent and reject the new write; the targeted group has74pass.
- Final full regression will run on the integrated backlog as requested by the
  user. Representative populated/corporate performance remains under BL-019;
  legacy synchronous data I/O and independent background retries remain explicit
  limitations, not evidence of an unrun acceptance test.

## Türkçe kayıt

Kumaş kartı, temel checklist ve kişisel tercih HTTP yolları asenkronlaştırıldı.
Yetki, revizyon, kanıt ve kalıcı yazma garantileri hedefli testlerle doğrulandı.
HTTP isteklerindeki senkron kira beklemeleri kaldırıldı; eski işlem imzaları
çakışmada hemen yeniden deneme sonucu döndürür. Diğer paketler bitmedi.
Kullanıcının talimatıyla tam test sona bırakıldı; hedefli sonuçlar son tam test
sonucuymuş gibi gösterilmez.
