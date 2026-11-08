# Orders source retirement / Orders kaynak yaşam döngüsü

**P1, local integration checkpoint. Public thin admission remains OFF.**

**[Doğrulandı]** Orders kaynak/oturum epoch'ları eski yükleme ve promotion
işlerini iptal ediyor; geç kalan sonuç yeni görünümü veya yeni promise'i
temizleyemiyor. Kimlik profili uygulanmadan önce senkron retirement çalışıyor.
Gerekli tam veriye geçiş başarısızsa manuel refresh, linked/editor/write
işlemlerine ve tek refresh POST'una başlamıyor. Ayrıntılı veri yeni config
uygulanınca eski parent'tan uydurulmuyor; açıkça yeni fullOnly yükleniyor.

The same private source/session epochs retire app-owned abort controllers,
invalidate client receipts and prevent obsolete load flights from publishing
or clearing a newer flight. Ordinary loaded full state retains its exact
reference and performs no extra fetch. Nonempty, unproved thin selection is
never cleared or remapped by guessing business IDs. CP dirty/selection/history
and original partial-refresh predicates remain intact.

IAM polling calls a synchronous pre-profile hook before its signature/profile
setters. The hook is a local lifecycle capability, never authority. It does not
invent a cookie/session ID from profile JSON. Actual login/switch navigates to a
new document; server authorization remains unchanged.

## Actual evidence / Gerçek doğrulama

- Initial preparation had a **fixture setup error**: the generic top-level
  extractor could not locate indented IAM functions inside their actual IIFE.
  Baseline 0/2 and candidate 21/9 outputs are retained; these are not behavioral
  RED evidence. The corrected fixture extracts the exact real function from
  its actual indentation without rewriting its body.
- Corrected native baseline: **10 PASS / 20 FAIL**, no skips/cancellations;
  same candidate assertions: **30 PASS**. Actual adopted product: **30 PASS**.
- First related runs: **273/51**, then **379/1**. Failures identified missing
  real lifecycle dependencies and stale whole-file pins. Fixtures now execute
  the real lifecycle declarations and native AbortController, not no-op guards.
  Every previous assertion remains. The fresh-loader unit double uses the
  original gated synthetic full response and asserts force/fullOnly/deferRender;
  actual loader/HTTP/ownership behavior has separate native cases.
- Once that missing dependency was supplied, an **actual pending-profile page
  race** was exposed: old and new assertions **67 PASS / 2 FAIL**. Capturing the
  profile target before the fresh-full wait and checking it afterward fixes it.
- A subsequent **397 PASS / 1 FAIL** was the old outside-switch whole-source
  hash. The current switchTab function is byte-exact; the pin was updated only
  after the complete restoration proof below.
- Final related package: **398 PASS / 0 FAIL / 0 SKIP / 0 CANCEL**.
- Exact unchanged #916 fast step: **23 PASS**; app/IAM syntax PASS;
  i18n **0 new / 0 baseline**; **50** existing release notes validate.

`source-pin-review.json` proves the entire app returns byte-exact to the old
`ad985…` source by replacing only the five named functions and new lifecycle
declarations. IAM likewise returns byte-exact after removing only its new hook
and one pre-setter call. Normalizers, canonical consumers, CP loader, switchTab,
clipboard and #916 implementation/test/fast workflow are unchanged. Old pin
files and every failed native output remain with raw SHA-256 indexes.

**[Doğrulandı]** Son app SHA:
`d0885781d9b9a5e88135a1fd7a7c9c309603d4f4484191219079408ad1237810`.
Tam kaynak geri kurma kanıtı olmadan pin güncellemesi yapılmadı; validator veya
assertion gevşetilmedi.

## Remaining / Kalan

The client negotiation/controller, UI initiators and remaining configuration/SSE
writers still block public thin activation. See the separately labelled
preparation notes. Actual `syncLinkedRefreshMembers` reads `/api/refresh-targets`;
it does not call modelConnLoad. Source freshness guards do not prove backend
CPU cancellation or atomicity across independent endpoints.

This checkpoint has no claimed latency/heap gain, current full-suite success,
final first-CP cohort, browser acceptance, independent P1 review, PR, merge or
TEST/STABLE publication. Final Phase 6a still requires those checks on the
integrated code; the historical passing full suite is not transferred here.
