# Faz 5 · Son inceleme teslimi / Final review handoff

**B1 AÇIK / OPEN. B2 ve B3 düzeltildi / fixed. Merge, TEST, STABLE yok / none.**

TR: #885 kapsamı donduruldu. Son üretim kodu **`e493546c583773f1239d30b22a8e56deaa5f5d49`**;
kullanıcının sabitlediği Main #888 baz kodu **`1d8e8d39257b66443fad8e80739261b4f0a82227`**.
Bu raporu ekleyen sonraki commit yalnız kanıt/dokümandır; uygulama kodu hash'i
kontrol edilir. Son SHA ve gerçek GitHub checks PR'da belirtilir. Eski yeşil
checks veya yerel test, son SHA'nın GitHub başarısı sayılmaz.

EN: Scope is frozen. The measured production source is e493546c and the user-
selected baseline is Main #888. A subsequent evidence-only commit is not a
new performance measurement. Final head/checks are recorded in the PR.

## Değişti / Changes

TR: B2'de MAIN ve worker ortak LFL sürüm yardımcısı kullanır; snapshot var ve
lflLoadedAt null fallback'i korunur. B3'te her OAB isteğine worker/gzip ekleme
ölçülen gecikme nedeniyle geri alındı; HTTP disconnect lease düzeltmesi kalır.
B1 tanısında ölçülen soğuk OAB dosya okuması yerel async I/O ile düzeltildi.

EN: The LFL version rule is shared, OAB per-request offload is reverted on
measured latency evidence, and the response lease fix remains. Local async
OAB file reading removes one reproduced synchronous cold-read path.

TR: Son ek B1 düzeltmesi, normalize edilmiş kırpılmış refresh geçmişini her
okumada yeni nesne sayıp revision artıran ve fsync'li yazan tek koşulu düzeltir.
Yeni üç RED → GREEN test; ilk legacy kırpma/string dönüşümü ve gerçek güncelleme
korunur. Beş okuma mikro medyanı **198.904 → 32.612 ms**, fsync **30 → 0**,
gereksiz revision **5 → 0**; items SHA aynı. Gerçek 30k API/UI oturumunda
revision, dosya baytları ve mtime korunur; TR/açık ve EN/koyu PNG'ler incelendi.
Bu mikro sonuç genel açılış veya HTTP p95 kazancı değildir.

EN: One history normalization condition preserves identity for an already-
normalized item, preventing repeated durable writes. All retained contents,
limits, first normalization and actual writes remain. Five-read micro timings
and real UI/file assertions establish this narrow fix, not overall latency.

[Ayrıntılı RED/GREEN, profil ve UI kanıtı / Evidence](phase-5-review2-history-read.md).

## Son ölçüm / Final measurement

TR: Linux, Node 24.19.0, Chromium 154, 4 CPU kotası / 16 GiB; aynı 05.11 seed-7
30k kaynak SHA'ları, aynı numeric-ring observer ve F0 harness. Force GC, CPU
profiler veya affinity değişimi yok. Before profilini Main varsayılan olarak
açar, after açık opt-in ister; iki kolda da BL_STALL_PROFILE unset. Bu üretim
farkı gizlenmez. Windows/Electron, SMB veya soğuk OS cache iddiası yok.

EN: Same source bytes/harness/observer and four-CPU Linux environment; no forced
GC, diagnostic preload or affinity change in the normal cohort. Main's default
profiler versus the candidate's opt-in is a disclosed production difference.

TR: Main #886/#887/#888 her iki kolda da vardır; bunların kazanımları Faz 5'e
yazılmaz. Değişmeyen #888'in üç tamamlanmış baz örneği **tamamı korunarak**,
history düzeltmesinden sonra üç taze aday + üç ayrı açılış alındı. Son kollar
zamanda dönüşümlü değildir; çevresel varyans izole edilmiş sayılmaz. Önceki
b2c9bdac sabit 3+3+3 serisi ve c93/0ad9 ile FA/270 serileri ayrı tutulur.

EN: All three unchanged Main #888 samples are retained, followed by three new
candidate F0 samples and three separate openings. Final arms are not interleaved
in time. No outlier was discarded. Earlier complete cohorts remain separate.

| Medyan / Median, sn / s | Before | After |
| --- | ---: | ---: |
| Refresh / yenileme | 52.760 | 64.684 |
| Refresh wall / duvar | 53.782 | 66.128 |
| Same-tab CP / aynı sekme | 14.335 | 10.251 |
| Same-tab Orders / aynı sekme | 3.768 | 2.904 |
| Same-tab Collection / Koleksiyon | 0.197 | 0.148 |
| Primary Overview / birincil | 6.974 | 4.119 |
| Primary Collection / birincil | 19.154 | 5.636 |
| Primary CP / birincil | 30.544 | 25.922 |
| CP system complete / sistem | 43.652 | 26.464 |
| CP observation elapsed / ölçüm dönüşü | 47.396 | 44.873 |
| Primary Orders / birincil | 7.853 | 7.505 |

TR: Refresh **+22.60%** geriledi;
ürün sahibi bu ödünleşimi kabul etmedi. İnsan Continue beklemesi sıfırdır;
primary, gate, sistem complete, dispatch ve ölçüm dönüşü ayrı kalır. CP'nin
25.922 sn birincil işareti tek başına kesintisiz etkileşim kanıtı değildir;
44.873 sn gözlem dönüşü de saklanır. Koleksiyon workspace'i boştur; 30k kaynak
kataloglu açılış, dolu bir Koleksiyon düzenleme benchmark'ı sayılmaz.

EN: Refresh regresses 22.60%, without product acceptance. Human
wait is zero; early ready events are not equivalent to continuous interactivity.
Collection has an empty workspace and a catalog derived from 30k source rows.

Ham örnekler / Raw samples (ms):

```json
{
  "before": {
    "refreshMs": [
      84897,
      52760,
      48886
    ],
    "sameTab.cp.ms": [
      32355.100000023842,
      10749.300000011921,
      14334.699999988079
    ],
    "sameTab.orders.ms": [
      58788.20000001788,
      3247.699999988079,
      3767.9000000059605
    ]
  },
  "after": {
    "refreshMs": [
      63428,
      65657,
      64684
    ],
    "sameTab.cp.ms": [
      10251,
      10662.5,
      9317.199999988079
    ],
    "sameTab.orders.ms": [
      3327.2999999821186,
      2904,
      2610.4000000059605
    ]
  }
}
```

### Aşamalar / Stages

| Medyan / Median, sn / s | Before | After |
| --- | ---: | ---: |
| ASAS parse | 15.999 | 16.717 |
| Snapshot own metric / kendi metriği | 11.683 | 10.391 |
| Whole snapshot operation / operasyon | 12.082 | 17.922 |
| Per-run outside metric / koşu bazlı fark | 0.399 | 7.531 |
| Page-cache write | 16.933 | 25.857 |

TR: Eski c799 stage tanısında seed 6.708 ms; MAIN post 994 ms;
worker encode/yazma/decode 1.027 / 728 / 1.240 ms, iki worker hash'i toplam
3.941 ms idi. Refresh-job kuyruğu <0,3 ms; beş gzip çağrısı 2.020 → 2.340 ms.
Bunlar iç içe duvar süreleri, toplanmaz ve yeni kod ölçümü diye sunulmaz.
Yeni normal snapshot operasyonu farkı ek kaynak hazırlığını doğrular.
Eski iki projection worker ile yeni ortak görev arasındaki build/paralellik
payı aynı kancayla izole edilmedi. MAIN'de bir kaynak hash'i kalır (DS-02 açık).
Gerçek Excel IPC alımı ve kaynak sahipliği sözleşmesi
[ayrı nottadır](phase-5-source-ownership.md); ham kayıtlar atılmadı.

EN: Retained stage diagnostics quantify extra replica preparation/hashing;
queue wait was negligible for those refresh jobs and gzip alone was not the
cause. Nested diagnostic spans are not additive CPU or new-code timings.
Projection parallelism's share remains unquantified. Startup FX queues are
not covered by that old refresh-queue statement.

### 200 ms ve health / Responsiveness and health

| Aday / Candidate, maksimum ms (aşım sayısı / exceedances) | Run 1 | Run 2 | Run 3 |
| --- | ---: | ---: | ---: |
| F0 Overview | 67.901 (0) | 213.787 (1) | 154.111 (0) |
| Global Flow | 215.376 (1) | 254.510 (1) | 248.552 (2) |
| Backlog | 197.275 (0) | 390.196 (2) | 126.369 (0) |

TR: **Üç ayrı açılışın hiçbiri 200 ms kabulünü geçmedi.** Bütün altı F0 ve üç
açılışın veri/satır/generation/revizyon/parity kontrolleri geçti; beş projection
× üç çift = **15 tam JSON byte/SHA eşdeğerliği**. Doğruluk başarısı performans
başarısı sayılmaz. Eşik/validator değiştirilmedi; önceki başarısız örneklerin
yerine başarılı tanı konulmadı. Kalan aralıkların tam kök nedeni bilinmiyor.

EN: All correctness checks and 15 exact full-projection pairs pass. All three
separate openings fail the strict responsiveness gate. No threshold waiver or
replacement by passing diagnostics; full remaining-gap cause is unknown.

TR: Refresh all-attempt health p50/p95 koşu medyanları
**9.824 / 444.956 ms**.
Başarısız denemeler ham raporda korunur. Baz /api/health 404 döndürür; onun
RTT'si başarılı health baz çizgisi değildir. Heap GC zorlanmadan ölçüldü;
Overview heap medyanı 32,9 → 119,9 MB, Orders 121,8 → 181,8 MB. Genel bellek
kazancı iddiası yok; bütün heap/RSS ve örnekleme verileri JSON'da tutulur.

EN: Health quantiles include all attempts. Baseline health is 404, not a
successful-health comparison. Uncollected heap varies and does not establish
a general memory saving; full heap/RSS records are retained.

### Ek FX güvenilirlik bulgusu / Additional FX reliability finding

TR: Aynı kaynakta KUR.xlsx yok. Bazın üç F0 logunda **0**, adayda **1/2/1**
FX workbook compute timeout'u var. Mevcut ortak havuzda otomatik iş background
öncelikte ve **5000 ms kuyruk + yürütme** bütçesinde. Timeout'un hangi kısmının
kuyruk/yürütme olduğu bu normal seride ayrı ölçülmedi. Gerçek parser aynı
klasörlerde `found:false, updated:false, reason:"KUR Excel bulunamadı"` döner.
Timeout catch'i `reason:"parse-failed"` ile klasör durumunu işaretler; o catch
saveFx çağırmaz. Yanlış saklanmış kur kanıtı yok, ancak yük altındaki bu yolun
sağlıklı/eşdeğer olduğu iddia edilmez. Süre sınırı veya hata koruması
gevşetilmedi; kanıtsız ek üretim düzeltmesi uygulanmadı. Bulgu açık kalır.

EN: Missing-workbook source directories produce zero baseline FX timeouts but
1/2/1 candidate timeouts. The shared five-second admission/execution budget
and background priority are known; the queue/run split is not instrumented.
The timeout path marks a parse-failure status and does not save exchange rates.
No claim of corrupted stored rates, and no claim of healthy under-load status
equivalence. This remains an open reliability observation.

## Doğrulama / Validation

TR: Son uygulama değişikliğinden sonra ilgili `npm test --` paketi **208 dosya /
1.508 test PASS**, fail/skip/cancel **0** (57 sn). i18n **0 yeni / 0 baseline**;
release notes **36 PASS**: Main'in 30 kaydı birebir + kendi 6 kaydımız.
Native LFL tam/eşleşen/yasak scope byte eşdeğerliği önceki değişmeyen motor
kanıtıdır. Tam npm test bu fazda koşulmadı; ilgili test ve fast checks tam
regresyon yerine sunulmaz. Gerçek son-SHA CI durumu PR'dadır.

EN: 208 relevant files / 1,508 tests pass after the final production change;
no failures/skips/cancellations. i18n 0/0, 36 valid notes with all Main notes
preserved. Full regression is not claimed.

[Makinece okunabilir sonuç / Data](phase-5-review2-final-results.json) ·
[Dokuz ham rapor, server.log ve SHA manifesti / Raw reports/logs](phase-5-review2-artifacts/final-cohort/manifest.json) ·
[İnceleme kapsamları / Reviews](phase-5-independent-review.md).

## Koordinasyon, GitHub ve karar / Coordination and decision

TR: #890 INT-06 **hazırlık** teslimi kapsam/kanıt açısından kontrol edildi;
üretim kodu yok, #885 dosya çakışması yok. İki yeni test dosyası immutable Main
#888 modülüne karşı izole kopyada yeniden çalıştırıldı: **10/10 PASS**.
Gerçek CI run 42391192110 ve bütün adımları SUCCESS. Bu yeni bir bağımsız
model turu veya henüz olmayan ürün uygulamasının onayı değildir. Kullanıcıya
sonraki sohbet için 6a alan envanteri/shadow-plan salt okunur paketi verildi.
INT-06 uygulaması ve nihai kabul #885 sonrası Main'i bekler; Claude işleri
korunur. Bu sohbette 6a/6c üretim uygulaması başlatılmadı.

EN: INT-06 preparation PR #890 was scope-checked; ten preparation tests were
rerun successfully and actual CI was verified. Production optimization is
still deferred. The next-chat packet covers read-only Phase 6a inventory,
not conflicting source edits or an additional independent review round.

TR: İlk astra kapsamı ad198bfe..7012eb3f, ikinci Claude kapsamı
7012eb3f..639372a4. 639372a4..1ff5038e düzeltmeleri ve sonraki
**1ff5038e..son-SHA** Main/test/history/kanıt deltası ayrıca incelenmiş sayılmaz;
kullanıcı üzerinden Claude'a gider. Rebase/force-push yapılmadı.
**B1 ve ek FX gözlemi açık; refresh ürün kararı yok; merge öncesinde durulur.**
TEST **yapılmadı**, STABLE **yapılmadı**.

EN: Post-639 fixes and the additional post-1ff delta still need the user's
Claude review handoff. No rebase/force-push. Merge stays gated by B1, the
open FX observation, product decision and current checks. No TEST/STABLE.
