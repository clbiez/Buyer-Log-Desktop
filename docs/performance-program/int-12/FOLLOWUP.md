# INT-12 — harness düzeltmesi ve üç çiftlik taklit A/B provası

TR: **Hazırlık harness'ındaki hata düzeltildi: 17/17 test ve 45 seri–ikili eşdeğerlik karşılaştırması geçti.** Üretim uygulaması yapılmadı; INT-12 Faz 7 ve kurumsal kapasite kabulü hâlâ açık. Bu çalışma kurumsal kazanç veya üretim concurrency onayı değildir. Merge ve TEST/STABLE yayını yok.

EN: **The preparation harness bug is fixed: all 17 tests and 45 serial/paired equivalence comparisons passed.** No production implementation was made. INT-12 still awaits Phase 7 and enterprise-capacity acceptance; this is neither an enterprise speedup claim nor production concurrency approval. No merge, TEST or STABLE publication.

## 1. Ham RED karşılaştırması / Raw RED comparison

Önce değişmemiş `8bbbb2bb` harness'ı yeniden çalıştırıldı: [ham iki kol](followup-evidence/revoke-before-raw.json). Sonra yalnız senkron gözlem eklendi; aynı RED korundu: [stack ve olaylarla ham çıktı](followup-evidence/revoke-before-observed.json), [RED assertion](followup-evidence/revoke-red.txt.gz). Gözlenen eski harness'ın tam kayıpsız kaynağı [burada](followup-evidence/pre-fix-observed-harness.cjs.gz); açılmış SHA-256 `49400c5a9fbcc3b2260b42dde107a05de5510f083d42a9c871bfa9ec0d1941b6`, ham çıktının identity alanıyla aynı.

EN: The unchanged first-round harness was reproduced before adding synchronous observers. Both reproductions retain the mismatch. The links above contain both raw arms, call stacks, RED assertion and the exact observed pre-fix harness source; its uncompressed hash matches the recorded identity.

| Ham alan / raw field | Seri / serial | Eski ikili / old pair |
|---|---|---|
| `failures` | `[{"label":"S6 · M1 · A","code":"OAB_ACCESS_REVOKED","message":"OAB_ACCESS_REVOKED","combinations":[{"seasonRef":"S6","merchSubGroupRef":"M1","buyerGroupRef":"A","label":"S6 · M1 · A"}]}]` | `[]` |
| `errorCode` / `error` | `OAB_ACCESS_REVOKED` / `OAB_ACCESS_REVOKED` | aynı / same |
| `currentLabel` | `S6 · M1 · A` | `""` |
| `completed` / `rowCount` / `cancelled` | `0 / 0 / false` | `0 / 0 / false` |
| Kabul edilen rows / sources / accepted | `[] / []` | `[] / []` |
| Rapor istek başlangıç/bitiş / report starts/ends | `0 / 0` | `0 / 0` |
| Cache / snapshot yazımı / writes | `0 / 0`; snapshot `null` | `0 / 0`; snapshot `null` |
| Revoke sonrası checkpoint / after revoke | 1 kapanış makbuzu; `results=[]`, failure A | 1 kapanış makbuzu; `results=[]`, `failures=[]` |
| Kalıcı captured sonuçlar / durable captured results | `[]` | `[]` |
| Yetki yokken continuation / while revoked | `OAB_ACCESS_REVOKED` | `OAB_ACCESS_REVOKED` |
| Tanısal erişim geri verilince continuation / after diagnostic access restoration | 0 retained, 12 pending | 0 retained, 12 pending |

TR: `auth-check` aşağıdaki tabloda taklit dependency girişidir; ağ/rapor isteği değildir. Bu senaryoda rapor başlangıç/bitiş olayı iki kolda da yoktur. Stack'ler native çağrı yerini gösterir. ms her kolun kendi başlangıcına göredir; farklı kolların zamanları birbirinden çıkarılmaz. Sıra numaraları ham olay dizisindeki numaralardır.

EN: `auth-check` below means entering the mocked dependency, not a network/report request. Neither arm starts a report. Stacks identify native call sites. Times are relative to each arm's own start and must not be subtracted across arms. Event numbers refer to the raw arrays.

| Olay / event | Seri seq @ ms | Eski ikili seq @ ms |
|---|---|---|
| Native dış döngü yetki kontrolü / outer loop authority | #31–34 @ 9.184–10.213, izinli / allowed | henüz yok / not yet |
| Native fetch giriş yetki kontrolü / fetch entry authority | #35–38 @ 11.008–11.900, izinli / allowed | #31–38 @ 4.005–5.451, iki fetch / two fetches |
| A auth dependency girişi / entry | #40 @ 11.963 | #40 @ 5.544 |
| Gerçek izin geçişi / actual allowed→revoked | #41 @ 11.968, `wasAllowed=true` | #41 @ 5.546, `wasAllowed=true` |
| Native auth helper reddi / rejection | #42 @ 12.089 | #42 @ 5.647 |
| B auth girişi ve aynı idempotent revoke predicate'i / entry and repeated predicate | yok / none | #44–46 @ 5.670–5.686; `wasAllowed=false` |
| Native dış döngü yetki kontrolü / outer loop authority | revoke öncesinde geçti / already passed | #47 @ 5.711, reddedildi / denied |
| Kapanış checkpoint'i / terminal checkpoint | #43 @ 13.579, failure A | #48 @ 7.003, boş failures / empty |
| Executor durdu, aktif rapor=0 / executor drained | #44 @ 13.714 | #49 @ 7.031 |
| Yalnız tanısal erişim geri verildi / diagnostic access restored | #47 @ 14.058 | #52 @ 7.360 |

### Sınıflandırma / Classification

TR: **[Doğrulandı] Yalnız çıktı sırası değil:** bir failure tamamen eksik; `currentLabel` da atanmamış. **Fixture kola özel farklı olay seçmiyor:** iki kolda da aynı koşulsuz `scenario==='revoke-auth'` predicate'i her auth dependency girişinde çalışıyor. Her kolda tek gerçek `true→false` geçişi var. İkilinin B girişi aynı `false→false` atamasını tekrar kaydediyor; bu ikinci bir yetki iptali değildir. Predicate, kombinasyon, timeout ve olay tetikleme kuralı değiştirilmedi.

EN: **Confirmed: not just output ordering.** One failure is missing and the label was never assigned. The fixture uses the same unconditional revoke-on-auth predicate in both arms, with one actual allowed→revoked transition per arm. The paired B entry repeats an idempotent false→false assignment; the fixture did not choose a different arm-specific event. The predicate, combinations, timeout and event trigger rule are unchanged.

TR: **[Doğrulandı] Hata adayın başlatma sınırında:** eski iterator `.next()` iki native fetch'i hemen başlatıyor. Native döngünün `await assertAsyncJobAuthority(job)` satırına gelmeden auth/revoke ilerliyor. Döngü authority kontrolü dış `try` içinde, kombinasyon `try`'ından önce olduğu için hata outer catch'e düşüyor; named failure yazılmıyor. Bu, adayın hata/makbuz davranışı farkıdır. Bu senaryoda partial-success veya iptal farkı gözlenmedi (`rows=[]`, `cancelled=false`). **Failures farkı yetki sızıntısı diye sınıflandırılmadı:** revoke sonrası sonuç kabulü, cache veya snapshot yazımı gözlenmedi. Revoke sonrası boş sonuçlu hata makbuzu checkpoint'i iki kolda da var; rapor verisi yayını değildir.

EN: **Confirmed: the candidate starts too early.** Old iterator `.next()` starts both native fetches before the loop's authority await. The resulting revoke fails the outer guard before entering the combination `try`, so the outer catch omits the named failure. This is a candidate error/receipt behavior mismatch, not observed partial-success or cancellation loss in this scenario. **The failure-list difference is not classified as an authorization leak:** there was no post-revoke result acceptance, cache or snapshot write. Both arms write a terminal error receipt containing no captured report data.

## 2. En küçük düzeltme / Minimal fix

TR: Yalnız test helper'ındaki `orderedPairs` değişti: iki fetch'i kuran `map`, lazy `start()` içine alındı ve ilk `take()` içinde çağrıldı. Böylece native cancel/yetki kontrolü ve `currentLabel` ataması tamamlandıktan sonra, mevcut kombinasyon `try`'ının içinde başlıyor. İkili sınır, sıralı tüketim, native auth kontrolleri, cache commit kapısı ve bütün başlayan işleri drain etme korundu. Sonuç/failure dizilerinde sıralama, filtreleme veya hata ekleyerek normalizasyon yapılmadı. `stableReport` / `equivalent` değişmedi; seri kol native modülü doğrudan kullanmaya devam ediyor.

EN: Only test helper `orderedPairs` changes behavior: construction of the two fetches is lazy and starts on the first `take()` inside the existing native combination `try`, after cancellation/authority checks and label assignment. The two-operation bound, ordered consumption, native authentication guards, cache gate and drain remain. No result/failure sorting, filtering or synthetic repair was added. `stableReport` / `equivalent` and the directly loaded native serial reference are unchanged.

TR: [Düzeltme sonrası ham çıktı](followup-evidence/revoke-after-observed.json): seri ham `failures` dizisi ile adayınki birebir aynı; yukarıdaki tam failure A kaydı ikisinde de var. Seri sonucu ayrıca değişmemiş eski harness'ın seri sonucuyla karşılaştırıldı ve eşit. Yeni ikili kolun native dış yetki kontrolleri #31–34 @ 4.212–5.064 ms; A auth #44 @ 7.172, gerçek revoke #45 @ 7.175; kapanış #51 @ 8.346. Aynı B idempotent predicate'i hâlâ çalışıyor (#48–49); olay atlanmadı. Sonuç kabulü/cache/snapshot 0; continuation yetki yokken reddediliyor, erişim geri verilince 12 pending.

EN: The post-fix raw output contains identical complete failure A arrays. The serial result also equals the unchanged old serial result. The fixed pair now passes native outer guards before auth/revoke, while preserving the B idempotent event. Both accept/write no report data; continuation is denied without access and has 12 pending after diagnostic restoration.

## 3. Üç çiftlik A/B provası / Three-pair rehearsal

TR: [Runner](../../../resources/app/tests/helpers/oab-int12-measure.cjs), 17/17 GREEN logu ile harness/test SHA'sını eşleştirmeden ölçüm yapmaz. Aktif başka Node/tarayıcı sürecinde veya mevcut lock'ta durur; eski çıktı klasörünü ezmez. Önce her ham örneği diske yazar, sonra eşdeğerlik assertion'ı yapar; hata olursa `stopped.json` ile durur. 15 senaryo × 3 çift × 2 kol = **90 ham koşu / 45 PASS karşılaştırma**, her senaryoda **AB / BA / AB**. Test ve ölçümler çakıştırılmadı. Aday/source/fixture bütün örneklerde aynı.

EN: The runner verifies the 17/17 GREEN gate and code hashes, refuses competing Node/browser processes or a lock, and never overwrites an existing cohort. Each raw sample is saved before assertions; errors stop the cohort with a retained record. Fifteen scenarios × three pairs × two arms produced **90 raw runs / 45 passing comparisons**, with **AB/BA/AB** order per scenario and no overlap with tests or other measurements.

- Main + #892 / both runtime arms: `5a1656e98deeb573f6245f4b24a8135cc77a0d7b`.
- Güncel gözlenen Main / observed current Main: `2083ffd73ba026067d92ccf257c4551afa2e5f00` (#894). Aradaki tek dosya `tests/v714-performance-hardening.test.js`; production/OAB ve #892 ağaçları aynı. İnceleme SHA'sına rebase/force-push veya korunan dosyada değişiklik yok / only that unrelated test changed; runtime/OAB/#892 code is identical, without rebasing or touching protected files.
- Ortam / environment: Linux, Node 24.19.0, 4 CPU kota, 16 GiB; aynı süreç, sıralı kollar, fresh sentetik store; 12 kombinasyon, sabit 8–24 ms mock gecikmeleri. Gerçek servis/credential yok / same process with sequential arms and fresh synthetic stores, no real service/credentials.
- Süre native `start`→kapanış checkpoint'i; disk receipt/cache/snapshot maliyeti dahil, sonradan yapılan tanısal okuma ve continuation süresi hariç / duration covers native start through terminal checkpoint including native disk work; later diagnostic reads/continuation time are excluded.
- Bu seri önceki traced baseline ile havuzlanmadı. A/B'nin iki kolunda da Node trace kapalı; n=3 nearest-rank p95=max. Gerçek ağ kuyruğu veya kurumsal tail/capacity ölçümü değildir / not pooled with the earlier traced baseline; tracing is off in both rehearsal arms, and n=3 p95 is merely the largest sample.

| Senaryo / scenario | Seri p50 / p95 ms | İkili p50 / p95 ms | Rapor / reports A→B | Transport hata / errors A→B | 429 A→B |
|---|---:|---:|---:|---:|---:|
| cold | 244.149 / 288.080 | 178.689 / 198.867 | 12→12 | 0→0 | 0→0 |
| fresh-half | 137.167 / 140.513 | 99.378 / 103.528 | 6→6 | 0→0 | 0→0 |
| fresh-all | 29.008 / 31.580 | 31.411 / 31.997 | 0→0 | 0→0 | 0→0 |
| force-refresh | 256.421 / 274.016 | 173.478 / 173.776 | 12→12 | 0→0 | 0→0 |
| batch-supported | 82.400 / 84.662 | 58.643 / 61.236 | 4→4 | 0→0 | 0→0 |
| probe-verified | 84.636 / 84.679 | 69.749 / 72.738 | 4→4 | 0→0 | 0→0 |
| probe-fallback | 265.398 / 281.189 | 202.275 / 206.940 | 13→13 | 0→0 | 0→0 |
| partial | 239.702 / 247.073 | 169.768 / 181.633 | 12→12 | 1→1 | 0→0 |
| throttle | 241.079 / 241.373 | 173.303 / 177.561 | 12→12 | 1→1 | 1→1 |
| auth-recovery | 284.490 / 288.849 | 203.404 / 206.649 | 14→14 | 2→2 | 0→0 |
| auth-fatal | 45.027 / 49.401 | 34.736 / 37.622 | 2→2 | 1→1 | 0→0 |
| revoke-auth | 3.342 / 4.924 | 4.139 / 4.679 | 0→0 | 0→0 | 0→0 |
| revoke-response | 29.148 / 30.543 | 30.728 / 33.208 | 1→2 | 0→0 | 0→0 |
| revoke-recovery | 31.602 / 31.986 | 32.318 / 33.578 | 1→2 | 1→1 | 0→0 |
| cancel | 36.353 / 40.003 | 36.477 / 41.256 | 1→2 | 0→0 | 0→0 |

TR: İstek/hata/429 sütunları her tekrarın aynı olan sayılarıdır; ham özet üç değeri ayrı saklar. Transport hatası recoverable expiry denemelerini de kapsar: auth-recovery'de iki expiry + iki recovery vardır, terminal combination failure yoktur. Native authority reddi transport hatası sayılmaz; `errorCodes` ve `combinationFailures` ayrı saklanır. 429 sabit enjekte edilir ve otomatik retry yapılmaz; iki paralelliğin kurumsal throttling kapasitesini kanıtlamaz. Mevcut browser helper'ın tek recovery rapor tekrarı korunur; refresh POST yolu çalışmaz ve retry eklenmedi. Eski sabit `refreshPostRetries`/`lateEffects` alanları bağımsız kanıt sayılmıyor; gerçek report-attempt kayıtları ve ham olaylar kullanılır.

EN: Count columns are the common per-repetition counts; the raw summary retains all three values. Transport errors include recoverable expiry attempts. Native authority failures have separate error-code and combination-failure metrics. Throttling is deterministically injected and never retried; this cannot establish corporate capacity. Only the existing native browser recovery report retry executes; no refresh POST route or retry was added. The old constant/limited metrics are not treated as independent evidence; actual attempt records and raw events are used.

TR: **Ödünleşim gizlenmedi:** cancel/revoke-response/revoke-recovery'de aday olay öncesi ikinci bir rapor başlatır; seri 1, aday 2. Fazladan cevabın sonucu cache/snapshot'a kabul edilmez; native sonuç/receipt eşdeğerliği geçer. Mevcut batching ve cache zaten büyük kısmı karşılar; fresh-all'da adayın küçük ek maliyeti vardır. Gerçek transport ortak login durumu, farklı adversarial response/commit sıraları ve kurumsal servis yükü henüz doğrulanmadı. Ürün sözleşmesi değiştirilmedi; üretim uygulaması için bunlar ayrı kapılardır.

EN: **The tradeoff is explicit:** cancel/revoke-response/revoke-recovery start a second speculative report before the event, versus one serial report. That extra response is not accepted into cache/snapshot, and native result/receipt equivalence passes. Existing batching/cache already avoid substantial work; all-fresh execution shows small paired overhead. Shared real login state, adversarial response/commit interleavings and enterprise load remain unverified production gates.

Ham örnekler / raw samples: [ab-3pairs](followup-evidence/ab-3pairs), [özet / summary](followup-evidence/ab-3pairs/summary.json), [manifest](followup-evidence/ab-3pairs/manifest.json), [koşu günlüğü / log](followup-evidence/ab-3pairs.txt). Manifest her ham JSON'un SHA-256'sını içerir / contains every raw JSON hash.

## 4. Doğrulama, inceleme ve kalan sınırlar / Validation and remaining gates

- [17 test GREEN](followup-evidence/preparation-green.txt), [GREEN kod/hash kapısı](followup-evidence/green-gate.json): 17 PASS, fail/skip/cancel 0. Orijinal eşdeğerlik assertion'ı korundu; revoke-auth için ayrıca gerçek failure içeriği, rapor=0 ve rows=[] assert edildi / original equivalence preserved and strengthened with explicit revoke expectations.
- [İlgili paket](followup-evidence/targeted-green.txt): yeni 17 test + mevcut altı native OAB test dosyası, toplam **120 PASS**, fail/skip/cancel 0. Batch service, continuation, async authority, receipts, results ve snapshot concurrency kapsandı / covered these native components.
- [i18n](followup-evidence/i18n.txt): yeni eksik 0, baseline 0. Validator/baseline/timeout değişmedi / unchanged.
- Görünür ürün değişikliği yok; release note/PNG gerekmedi, release-note validator bu hazırlık için çalıştırılmadı / no visible product change, no new release note/PNG; the release-note validator was not needed for this preparation.
- Tam `npm test` çalıştırılmadı. **Faz 6 / son program PR'ında, #885 sonrası Main + uygulama SHA'sında filtresiz tam test zorunluluğu devam eder; etkili kod değişikliğinde yenilenir.** Bu prova, hedefli testler ve hızlı PR checks yerine geçmez / full regression remains mandatory at that later gate, renewed after relevant changes.
- Korunan production, `server.js`, `app-main.js`, canonical, ortak compute ve Claude dosyaları değişmedi; worker eklenmedi. Açık PR #885/#890/#891/#893/#895/#896/#897 dosya listelerinde bu eklerin kilit çakışması yok / protected files unchanged, no worker added, no file overlap in the observed open PRs.
- Merge, TEST ve STABLE yok. INT-12 tamamlandı veya maliyetsiz olduğu için atlandı denmiyor / no merge/publication; INT-12 is neither completed nor skipped as cost-free.

TR: [Önceki tek Claude inceleme paketi](README.md#tek-bağımsız-inceleme-paketi--one-independent-review-packet) ve bütün RED kanıtları korunur. Henüz bağımsız inceleme yapılmadı veya Claude'a otomatik mesaj gönderilmedi. Kullanıcı üzerinden en fazla bir tur için bu rapor ek kanıttır: lazy başlangıç sınırı, failure/makbuz eşitliği, spekülatif cevapların yazım kapısı ve gerçek transport'ta ortak auth riskine odaklanılmalı. Main entegrasyonu bu hazırlıkta gerekmiyor; üretim entegrasyonu gerekirse ana sohbetten istenecek.

EN: The original single-review packet and all RED evidence are retained. No independent review has occurred and no message was sent automatically. This report is an addendum for at most one user-mediated Claude round, focusing on lazy start boundaries, receipt equivalence, speculative-write gating and shared real authentication risk. No Main integration was needed here; any production integration must be requested through the main chat.

## Tekrar üretme / Reproduction

`resources/app` içinden / from `resources/app`:

```sh
node --test tests/oab-int12-preparation.test.js
node --test --test-concurrency=1 tests/oab-int12-preparation.test.js tests/oab-batch-service.test.js tests/oab-job-continuation.test.js tests/oab-native-async-authority.test.js tests/oab-job-receipts.test.js tests/oab-job-results.test.js tests/oab-snapshot-concurrency.test.js
npm run i18n:check
# Recorded code/17-test GREEN gate must still match; use a NEW output folder.
node tests/helpers/oab-int12-measure.cjs /tmp/int12-new-rehearsal
```

TR: Mevcut ham kanıtları ezme. Kod değişirse önce 17 test ve ilgili kontrolleri yeniden çalıştırıp yeni GREEN gate/hash kaydını üret; eski kodun yeşil sonucunu taşıma. Önceki RED'i yeniden üretmek için `8bbbb2bb` commit'ini ayrı salt okunur checkout'ta kullan; mevcut dalı rebase/force-push yapma.

EN: Do not overwrite retained evidence. After code changes, rerun the 17 tests and relevant checks and record a new matching GREEN gate; never reuse a stale green result. Reproduce the original RED from commit `8bbbb2bb` in a separate read-only checkout without rebasing or force-pushing the current branch.
