# #885 · Main #892 entegrasyonu — kırmızı regresyon kapısı

TR: **B1 ve FX açık. Faz ilerlemesi durduruldu.** Bu kayıt yeni performans
kabulü veya bağımsız inceleme onayı değildir. Merge ve TEST/STABLE yayını yok.

EN: **B1 and FX remain open. Phase progression is stopped.** This is neither
new performance acceptance nor independent review approval. No PR merge or
TEST/STABLE publication occurred.

## Sabit kaynaklar / Frozen sources

- İnceleme / review: `69950f289a012f0bb7c61290bec9890f340f6c64`.
- Main (#889 + #892): `5a1656e98deeb573f6245f4b24a8135cc77a0d7b`.
- Yerel merge / local merge: `1d8572056887558e4dbaa2ca57dca48e4d68f80e`.
  Birinci ebeveyn inceleme SHA'sı; ikinci ebeveyn Main'dir. Rebase veya
  force-push yok. / First parent is the review SHA; second parent is Main.
  No rebase or force-push.
- Yerel dal / local branch: `perf/phase-5-server-integration`.
  Kırmızı kontrolden sonra uzak #885 dalına push yapılmadı. / Not pushed to
  the remote #885 branch after the failed check.

## Korunan sözleşme / Preserved contract

TR: Main'in revizyon bloğu byte-eşdeğer alındı:
`BL_CP_DECISION_DATA_REVISION` ayrı `_cpDecisionInputRevision` sayacını döndürür.
`personal-decision-context` bu sayacı artırmaz; birleşik öncelik tablo
revizyonunu ve cache temizliğini sürdürür, Global Flow olayını gönderir.
CP veri değişikliği sayacı artırır; yalnız Orders değişikliği artırmaz.
Bu davranış entegre kodda mevcut VM regresyonlarıyla geçti.

EN: The revision block is identical to Main. Personal-context invalidation
preserves the CP input revision while advancing table revisions, clearing
priority caches and notifying Global Flow. CP data changes advance the input
revision; Orders-only changes do not. Existing VM regressions passed on the
integrated source.

TR: #885'in sonraki Backlog query/readiness değişiklikleri korunur. İstemci,
checklist ve karar motorlarında özgün yeni değişiklik yok; yalnız Main
entegrasyonu var. `index.html` ve `perf-runtime.js` Main ile birebir. Sürüm
notu çakışması, her iki tarafın kaydını nesne olarak birebir koruyarak çözüldü:
32 Main kaydı ve #885'in altı kaydı, toplam 38. İki tarafın TR/EN özet ekleri
de korunur. Yeni görünür davranış eklenmedi; Main'in PNG'leri olduğu gibi alındı.

EN: The later #885 Backlog changes remain intact. There are no original new
client/checklist/decision-engine edits, only the Main integration. All 32 Main
release-note entries and six #885 entries remain unchanged, together with both
summary additions and Main's existing PNGs.

## Doğrulama / Validation

| Kontrol / Check | Gerçek sonuç / Observed result |
| --- | --- |
| İlgili paket / targeted suite | 51 files, 232 PASS, 0 fail/skip/cancel |
| Tam `npm test` / full suite attempt | **FAIL**, first of 10 batches: 1,803 tests; 1,738 pass, 5 fail, 60 skip, 0 cancel; remaining nine batches not run |
| i18n | 0 new missing / 0 baseline missing |
| Release-note validator | 38 entries PASS |
| Merge / source preservation | Both parents retained; #892 revision block and release-note entries checked exactly |

TR: İlk ilgili koşu izole veri kökleri verilmediği için varsayılan
`/home/agent/.buyer-log` yolunda ENOENT ile başarısız oldu. Bu bir üretim
düzeltmesiyle giderilmedi: sonraki koşuda `BUYER_LOG_DATA_ROOT`,
`BUYER_LOG_LOCAL_DATA_ROOT` ve `BUYER_LOG_SERVER_DATA_ROOT` açıkça `/tmp`
altındaki demo köklerine yönlendirildi. İlk başarısız log da saklanır.
Tam koşuda auth/config/temp kökleri de izoledir. Gerçek veri veya credential
kullanılmadı. Hiçbir test/assertion/validator değiştirilmedi.

EN: The first targeted attempt failed because default data paths were not
redirected into the writable demo root. It is retained alongside the successful
isolated rerun. The full-suite attempt used isolated data/auth/config/temp
paths. No real data or credentials were used. Tests, assertions and validators
were not edited.

Tekrarlama / reproduction (from `resources/app`):

```sh
demo_root=$(mktemp -d /tmp/buyerlog-main892-validation-XXXXXX)
mkdir -p "$demo_root/app" "$demo_root/local" "$demo_root/server" "$demo_root/auth" "$demo_root/temp"
export BUYER_LOG_CENTRAL_IAM_ENABLED=0
export BUYER_LOG_DATA_ROOT="$demo_root/app"
export BUYER_LOG_LOCAL_DATA_ROOT="$demo_root/local"
export BUYER_LOG_SERVER_DATA_ROOT="$demo_root/server"
export BUYER_LOG_AUTH_DATA_ROOT="$demo_root/auth"
export BUYER_LOG_CONFIG_PATH="$demo_root/config.json"
export BUYER_LOG_TEMP_ROOT="$demo_root/temp"
npm test -- cp-decision-input-revision cp-personal-layer-delta checklist-columns-delta checklist-summary-contribution-cache checklist-assistant-view-reuse compute global-flow
npm run i18n:check
npm run release:notes:validate
npm test
```

## Kırmızı kapı / Failed gate

TR: Beş hata üç dosyadadır:

- `tests/client-computation-performance.test.js`: native projection-worker /
  server katalog eşdeğerliği.
- `tests/collection-asas-excel-grid-v489.test.js`: ASAS-backed katalog sözleşmesi.
- `tests/collection-product-main-definition-suggestions-v829.test.js`: distinct
  canonical öneri, raw ASAS → Overview → katalog zinciri ve eski/eksik şema reddi.

TR: Hepsi assertion'a ulaşmadan `ReferenceError: createComputeReadGuard is not
defined` ile durur. Testler `const COLLECTION_CATALOG_FIELDS` ile
`async function buildResponse` arasını `new Function` içine alıyor. #885'te bu
aralığa giren `computeReadGuard` başlangıcı, test factory'sinin sağlamadığı
`createComputeReadGuard` sembolünü çağırıyor. Sunucu dosyası ve bu üç test,
`69950f28` ile birebir aynıdır; bu beş hata Main #892 entegrasyonunda yeni
eklenen bir dosya değişikliğinden kaynaklanmaz. Bu gözlem runtime katalog
eşdeğerliğinin başarısı sayılmaz; ilgili kontroller tamamlanmadı.

EN: All five failures occur before their assertions because a source-sliced
factory now includes the compute-read-guard initialization without supplying
its dependency. The server and these tests are identical to the frozen #885
review source. This explains the harness failure, but does not establish
catalog equivalence: the checks did not complete.

TR: Kullanıcının "kırmızı kontrolde dur ve raporla" şartıyla üretim düzeltmesi,
B1/FX entegrasyonu, yeni benchmark ve 6a/6c uygulaması durduruldu. Test sınırı
ve dependency kurulumu, bütün mevcut assertion'lar korunarak ele alınmalı;
sonra tam regresyon yeniden çalışmalıdır. Atlanan kontroller geçer sayılmaz.
Bu duruş, kırmızı testleri gevşetme izni talebi değildir.

EN: The user's explicit stop-on-red gate stops production edits, FX integration,
new benchmarking and 6a/6c progression. Correcting the test boundary/dependency
setup must retain every assertion, followed by a fresh full regression. Skips
are not reported as passes.

## Ölçüm, koordinasyon, sonraki kapılar / Measurement and remaining gates

TR: Yeni önce/sonra koşusu yapılmadı; yeni medyan/kazanç iddiası yok. Önceki
JSON/log/profiller ve SHA'ları değiştirilmedi. Yeni resmî karşılaştırmanın
before kolu Main `5a1656e9` (veya aynı #892 kodu taşıyan sabit sonraki Main),
after kolu aynı Main'i içeren onarılmış #885 olmalıdır. Her kolda aynı fixture
ile en az üç koşu, medyan ve satır/generation/revizyon kontrolleri gerekir.
Bu taban önerisidir, çalıştırılmış ölçüm değildir. Refresh POST gönderilmedi.
Benchmark ile test eşzamanlı çalıştırılmadı.

EN: No new before/after cohort, medians or speedup claims. Historical evidence
is unchanged. Both future arms must contain the same #892 code and use the
same fixture with at least three runs and identity checks. No refresh POST
was sent and no benchmark overlapped tests.

TR: FX tanısı ve istemci katkısı için diğer sohbetlerin mevcut çıktıları
okundu; gözlenen durumda sonuç/commit henüz yoktu. FX düzeltmesi varsayımla
uygulanmadı. #891 envanteri yeniden üretilmedi. 6a/6c üretim uygulaması ve
Faz 7 DS-01/02/03/04/10 hâlâ bekliyor. Yeni bağımsız Claude incelemesi
istenmedi; kapanış deltası hazır olduğunda kullanıcı üzerinden en fazla bir
tur hazırlanacak. #885 taslak, B1/FX ve bağımsız delta incelemesi açık kalır.

EN: No diagnosis/client contribution commit was available in the observed
peer-chat snapshots. No speculative FX fix or duplicate field inventory was
created. Later phases remain pending; no additional Claude review was invoked.

[Saklanan loglar ve SHA manifesti / retained evidence](phase-5-main892-artifacts/manifest.json).
