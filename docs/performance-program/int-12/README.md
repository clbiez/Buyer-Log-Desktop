> Güncel devam raporu / Current follow-up: [FOLLOWUP.md](FOLLOWUP.md). Aşağıdaki metin `8bbbb2bb` ilk turunun tarihsel RED kaydı ve değişmeden korunan inceleme paketidir / The text below is the historical first-round RED record and preserved review packet.

# INT-12 — tanı / fixture hazırlığı: RED, durduruldu

TR: **Eşdeğerlik kapısı başarısız; deney durduruldu.** Üretim kodu ve concurrency değişmedi. Test-only aday merge edilebilir değildir. Başarısız assertion korunur; gevşetilmedi. Ürün uygulaması Faz 7'yi bekler.

EN: **Equivalence gate failed; the experiment stopped.** Production code and concurrency are unchanged. The test-only candidate is not mergeable. The failing assertion is retained without weakening. Production implementation waits for Phase 7.

## Sabit kaynak / Frozen source

- Main + #892: `5a1656e98deeb573f6245f4b24a8135cc77a0d7b`; iki kol aynı checkout ve native kodu kullanır / both arms use this same checkout and native code.
- Dal / branch: `test/int12-oab-parallel-preparation`. Rebase / force-push yok / none.
- `server/lib/oab-batch-service.js` SHA-256: `e23ca7a6d70de4dcaad834fab833e8ff1cb1dfa5eb2d49caf1c3418e59e71f33`.
- Kaynak doğrulandı / verified: `oabBuildPlan`, `oabProbeBatchedBuyerGroups`, `oabFetchOneCombination`, `runOabBatchJob`, native continuation ve read-only `server.js` auth yardımcıları / and the read-only native auth helpers.
- Açık PR dosya kontrolü / open-PR file check: #885, #890, #891, #893. Eklenen üç test/fixture/helper dosyasıyla çakışma yok / no overlap with the three added test/fixture/helper files. #885 ve Claude dosyaları, `server.js`, `app-main.js`, ortak compute ve canonical dosyalar değiştirilmedi / are unchanged. #892 dosya istisnası genişletilmedi / its file exception was not extended.

## Önce maliyet kanıtı / Cost proof first

TR: Native servisle **6 senaryo × 3 tekrar** Node async trace alındı; sonra adayın ilk doğruluk paketi çalıştı. Aynı 12 sentetik kombinasyon (2 sezon × 2 MAG × 3 buyer), 8–24 ms taklit rapor gecikmesi, bir gerçek boş sonuç ve değişken alan kapsamı kullanıldı. Gerçek native disk receipt, snapshot ve continuation kodu çalışır. Cache ve transport taklittir; ağ/credential yoktur. Koşular ardışık, aynı ortamda başka ölçüm yoktur. Trace ek yükü dahildir; soğuk cache yalnız fixture cache'idir, OS cache değildir.

EN: **6 scenarios × 3 repetitions** ran through the native service under Node async tracing before the first candidate correctness suite. All use the same 12 synthetic combinations (2 seasons × 2 MAGs × 3 buyers), 8–24 ms mock report delays, one genuinely empty response and varying fields. Native disk receipts, snapshots and continuation execute; cache and transport are fake, with no network or credentials. Runs were sequential without another benchmark in the environment. Trace overhead is included; cold cache refers to the fixture cache, not the OS cache.

| Native fixture | n | p50 ms | p95 ms | Rapor isteği / reports | Cache hit |
|---|---:|---:|---:|---:|---:|
| cold | 3 | 253.183 | 283.282 | 12 | 0/12 |
| fresh-half | 3 | 133.568 | 137.988 | 6 | 6/12 |
| fresh-all | 3 | 32.002 | 32.623 | 0 | 12/12 |
| batch-supported | 3 | 85.788 | 85.861 | 4 | 0 |
| probe-verified | 3 | 85.065 | 88.207 | 4 | 0 |
| probe-fallback | 3 | 279.929 | 280.768 | 13 | 0 |

TR: p50/p95 nearest-rank; n=3 için p95 en büyük örnektir, kuyruk dağılımı tahmini değildir. Bu altı baseline senaryosunda rapor hatası/throttling 0. Mevcut batching ve cache yeniden uygulanmadı: doğrulanmış grup 12→4 rapor, fresh cache 12→0, doğrulanamayan prob 1+12 rapor üretir. Bu oranlar **yapılandırılmış fixture sonuçlarıdır; üretim capability/cache hit oranı değildir**.

EN: p50/p95 use nearest rank; at n=3, p95 is the largest sample, not a reliable tail estimate. These six baseline scenarios had zero report errors/throttles. Existing batching and cache were not reimplemented: verified grouping gives 12→4 reports, fresh cache 12→0, and an unverified probe 1+12. These are **configured fixture outcomes, not observed enterprise capability/cache-hit rates**.

## Test-only aday ve durma bulgusu / Candidate and stop finding

TR: Seri oracle native modülü doğrudan kullanır. Aday aynı kaynak SHA'sından yalnız bellekte iki anchor değiştirir: kuyruk iterasyonu ve fetch await. Sabit ikili pencereler, sıralı tüketim, native `withCommitGuard` ile spekülatif cache yazım kapısı ve kapanışta tüm başlayan işleri bekleme uygulanır. Planner, batching probu, native auth yardımcıları, snapshot ve continuation kodu aynıdır. Üretim için etkinleştirme yolu yoktur; native kaynak değişirse harness hash kontrolünde durur. Bu kapılar test modelidir; onaylanmış üretim tasarımı sayılmaz.

EN: The serial oracle loads the native module directly. The candidate changes just two anchors in memory from the same source SHA: queue iteration and fetch await. It uses fixed pairs, ordered consumption, speculative cache-write gating through native `withCommitGuard`, and drains all started work on close. Planner, capability probe, native auth helpers, snapshot and continuation remain native. There is no production activation path; source drift fails the harness hash check. These gates form a test model, not an approved production design.

TR: İlk paket **16 PASS / 1 FAIL / skip=0 / cancel=0**. `revoke-auth` senaryosunda:

- Seri: `errorCode=OAB_ACCESS_REVOKED`, ilk üçlü için bir failure kaydı.
- İkili: aynı errorCode, **boş failure listesi**.
- Her iki kol: sonuç satırı 0, cache yazımı 0, snapshot yok. Bu fixture'da yetkisiz yazım gözlenmedi; sonuç/receipt eşdeğerliği yine de başarısız.

EN: The first suite returned **16 PASS / 1 FAIL / skip=0 / cancel=0**. In `revoke-auth`, serial records one failure for the first triple, while the paired candidate returns an **empty failure list** with the same `OAB_ACCESS_REVOKED` error. Both have zero rows, zero cache writes and no snapshot. No unauthorized write was observed in this fixture; result/receipt equivalence still fails.

TR: Kaynak incelemesine göre muhtemel neden: prefetch auth kontrolünü native döngünün dış authority kontrolünden önce ilerletebilir; hata inner combination catch yerine outer job catch'e ulaşır. Bu tanı ayrıca doğrulanmadı ve aday düzeltilmedi. Başarısız testin çıktısı `evidence/preparation-first.txt.gz` içindedir. Test runner bu tek pakette diğer testlere de devam etti; kırmızı sonuç görüldükten sonra yeni aday koşusu yapılmadı.

EN: Source inspection suggests prefetch can advance authentication before the native loop's outer authority check, routing the error through the outer job catch instead of the inner combination catch. This cause was not separately verified or fixed. `evidence/preparation-first.txt.gz` retains the failure. The test runner continued other cases within that first suite; no candidate run followed inspection of the red result.

TR: Kısmi başarı, 429 (retry yok), iki auth expiry/recovery, fatal auth + diskten continuation, response/recovery sırasında revoke, iptal ve iptal sonrası continuation reddi ilk pakette geçti. Bunlar tek fixture gözlemidir. Farklı response/commit sıraları, ortak gerçek transport login durumu ve throttling kapasitesi için genel güvence vermez. Browser helper'ın mevcut tek login recovery rapor tekrarı kullanılır; refresh POST yolu çağrılmaz ve retry eklenmedi. Harness'taki `refreshPostRetries: 0` alanı sabit bir placeholder'dır, ölçüm kanıtı olarak kullanılamaz. `lateEffects` alanı da kapsamlı geç-yazım kanıtı değildir; ayrı adversarial doğrulama gerekir.

EN: Partial success, injected 429 without retry, two auth expiry/recovery events, fatal auth with disk continuation, revoke during response/recovery, cancellation and refusal to continue a cancelled job passed in that first suite. These are single-fixture observations, not a general guarantee for response/commit interleavings, shared real login state or throttling capacity. The existing browser helper's one login-recovery report retry remains; no refresh POST route runs and no retry was added. The harness's constant `refreshPostRetries: 0` is a placeholder, not measurement evidence. `lateEffects` is likewise not a comprehensive late-write proof; separate adversarial validation is required.

## Doğrulama ve kalan kapılar / Validation and remaining gates

- Yeni harness önce eksik modül nedeniyle RED; çıktı saklandı. Sonraki paket 16/1: **GREEN değildir** / initial missing-helper RED retained; subsequent suite 16/1 is **not GREEN**.
- `npm run i18n:check`: yeni eksik 0, baseline 0 / new omissions 0, baseline 0. Baseline ve validator değişmedi / unchanged.
- Görünür ürün değişikliği yok; release note / PNG eklenmedi; release-note validator çalıştırılmadı / no visible product change, no release note or PNG, validator not run.
- Mevcut ilgili OAB paketleri ve tam suite çalıştırılmadı; eşdeğerlik kırmızı kapısında duruldu / existing OAB regression suites and full regression were not run after the equivalence stop gate.
- **Resmî önce/sonra A/B tamamlanmadı.** Her kolda en az üç tekrar, AB/BA/AB sırası, aynı #892 kodu, p50/p95, rapor hata/429 sayıları ve request zaman çizelgeleri hâlâ zorunludur / **official A/B is incomplete**; at least three repetitions per arm with AB/BA/AB order, identical #892 code, p50/p95, report errors/429 counts and request timelines remain mandatory.
- Faz 6 / son program PR'ı: #885 sonrası Main + uygulama SHA'sında filtresiz `npm test`; sonuç etkileyen değişiklikte tekrar. Hedefli/fast checks bunu karşılamaz / Phase 6/final program PR still requires unfiltered `npm test` on pinned post-#885 Main plus implementation, renewed after relevant changes; targeted/fast checks cannot replace it.
- Main entegrasyonu gerekirse ana sohbetten istenecek; bu hazırlıkta entegrasyon yapılmadı / any needed Main integration must be requested through the main chat; none was performed here.
- GitHub PR açılmadı; CI tetiklenmedi; merge yok. TEST ve STABLE yayınlanmadı / no PR, CI, merge, TEST or STABLE publication.

## Tek bağımsız inceleme paketi / One independent review packet

TR: Kullanıcı üzerinden Claude'a **en fazla bir tur**, bu dondurulmuş yerel dal ve manifest ile iletilebilir. İnceleme yapılmış sayılmaz. İstenen inceleme: iki anchor değişiminin await/yetki sınırı, `revoke-auth` failure-list farkı, spekülatif cache kapısının iptal/lease davranışı, gerçek helper'ın eşzamanlı recovery riski ve fixture/oracle eksikleri. Üretim concurrency önerisi veya merge onayı istenmez. Mevcut kırmızı test veya baseline gevşetilemez. Ürün uygulaması için Faz 7 sırası ve kurumsal kapasite kanıtı şarttır.

EN: The user may relay **at most one independent round** to Claude with this frozen local branch and manifest; no review has been performed. Review the two-anchor await/authority boundary, the `revoke-auth` failure-list mismatch, speculative cache gating under cancellation/leases, concurrent recovery in the actual helper, and fixture/oracle gaps. Do not request production concurrency or merge approval. The red assertion and baseline must not be weakened. Production work still requires Phase 7 sequencing and enterprise-capacity evidence.

## Tekrar üretme / Reproduction

TR/EN: `resources/app` içinden / from `resources/app`:

```sh
# Known RED; do not treat this as a release/merge acceptance suite.
node --test tests/oab-int12-preparation.test.js
npm run i18n:check
```

TR: Baseline yeniden üretmek için aşağıdaki komutu ayrı, ölçümsüz oturumda çalıştır; mevcut kanıt dosyalarını ezme. Kaynak/fixture/hash aynı olmalı. Bu komut aday çalıştırmaz.

EN: Run this baseline-only command in a separate idle session; do not overwrite retained evidence. Keep source/fixture hashes identical. This command does not run the candidate.

```sh
node --trace-events-enabled --trace-event-categories node.async_hooks,node.perf \
  --trace-event-file-pattern=/tmp/int12-native-new-trace.json - <<'NODE'
const fs = require('node:fs');
const {runCase} = require('./tests/helpers/oab-int12-harness.cjs');
(async () => {
  const results = [];
  for (let repeat = 1; repeat <= 3; repeat++)
    for (const scenario of ['cold','fresh-half','fresh-all','batch-supported','probe-verified','probe-fallback'])
      results.push({repeat, ...await runCase({scenario, width:1})});
  fs.writeFileSync('/tmp/int12-native-new-baseline.json', JSON.stringify({results}, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
NODE
```

TR: Node trace kayıpsız gzip saklanır; açılmış trace SHA'sı `summary.json` içinde. Her baseline koşusu için native/request/cache/checkpoint zamanları ve ölçüm kimlikleri `native-baseline.json` içindedir. Ortam ve dosya hash'leri manifesttedir.

EN: The Node trace is stored as lossless gzip; `summary.json` records its uncompressed SHA. `native-baseline.json` retains per-run native/request/cache/checkpoint timelines and identities. The manifest records environment metadata and file hashes.
