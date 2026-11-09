# PR 944 current-Main acceptance plan

Baseline: a83da490c9689b8fee2a15eec1e41aeb5789f663.
Candidate runtime: a8f183bf98a93ee9f6dbf6ad73ab589a0c92215f (use actual git HEAD in results; this prefix identifies the isolated Main merge).
No runtime changes are planned; first validate the existing admission-only recovery.

Synthetic 30,000-row XLSX is uploaded through the real application. Same fixture,
runtime, host, permissions and one request at a time in all arms. Capture fixture
SHA-256. Three alternating Main/candidate pairs in the normal 512 MiB worker
configuration. Cold reference read, saved read and explicit rebuild separately.
A 160 MiB worker budget reproduces admission rejection: Main must reject; candidate
must recover with identical reference summaries. This is a newly available path,
not a speedup comparison with a fast error. Existing 64-entry serial lane stays.

Pre-measurement budgets:
- Normal worker outputs identical; no repeatable time/CPU/peak-memory regression.
  Investigate ambiguous differences with three alternating Main/Main controls.
- Recovery on this 30k fixture: HTTP result <=2,000 ms, event-loop gap <=50 ms,
  incremental sampled RSS <=256 MiB above the immediately preceding idle sample;
  no additional worker is allocated. First UI feedback <=200 ms.
- Five repeated explicit rebuilds: no monotonically increasing post-GC heap,
  no remaining input/output permits or queued jobs, no extra worker/replica.
- Saved reference reads preserve values; source replacement and failed refresh
  retain saved references; final actual UI works in TR and EN.
- Standard uninterrupted npm test, i18n, release notes, final head PR CI.

No native/preload/launcher change: browser-client and local Node server paths are
in scope. Windows/native/SMB capacity is not claimed. No TEST/STABLE release.

## Finding after the original-source run

The no-runtime-change hypothesis was rejected by measurement: original recovery
blocked the server for about 1.4 seconds. The correction is confined to cooperative
snapshot reading and the same LFL aggregation, plus the reproduced Main CSS guard
failure. Original budgets remain unchanged. Final source identity and before/after
results are recorded separately; diagnostic runs are not acceptance passes.
