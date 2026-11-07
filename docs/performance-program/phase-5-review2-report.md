> **Son teslim / Latest handoff:** [e493546c son kod raporu / final-code report](phase-5-review2-final-report.md). Aşağıdaki revizyona ait tarihsel kanıt korunur / Historical evidence below remains at its recorded revision.

# Faz 5 · İkinci inceleme sonucu / Second-review result

TR/EN: Bu belge fa580f89/270228a4 serisinin tarihsel kaydıdır. /
This is the historical fa580f89/270228a4 cohort.
[Güncel Main entegrasyonu sonucu / Current Main integration result](phase-5-review2-main-current-report.md).

**B1 AÇIK / OPEN. Merge edilmedi / Not merged. TEST ve STABLE yayımlanmadı / Neither published.**

TR: Bu kapanış çalışması yeni özellik eklemez; Claude'un kullanıcı üzerinden
iletilen `7012eb3f..639372a4` incelemesini ele alır. B2 ve B3 düzeltildi.
Yenileme ödünleşimi kullanıcı kararı bekler ve 200 ms kabulü sağlanmadı.
Sonraki faza geçilmedi. İş bölümüne itiraz yok; kilitli `index.html`,
`perf-runtime.js` ve modül CSS dosyalarına bu düzeltmelerde dokunulmadı.

EN: This closure work addresses Claude's user-supplied review of
`7012eb3f..639372a4`, without adding features. B2 and B3 are fixed. The refresh
tradeoff needs the user's product decision, and the 200 ms criterion failed.
No later phase started. The agreed division remains; these fixes do not touch
the locked shell or module CSS files.

## Değişti / Changes

- **B2:** MAIN ve native worker aynı `collection-lfl-source-version.js`
  yardımcısını kullanır. `lflLoadedAt:null` ve snapshot mevcutken önceki
  `available:true/version=loadedAt` davranışı korunur; explicit LFL ve savedAt
  geri dönüşleri testlidir. / MAIN and the native worker share one helper,
  preserving all three source-version fallback cases.
- **B3:** Her metadata isteğini worker'a ve gzip'e taşıyan OAB özelliği,
  gecikme gerilemesi ölçüldükten sonra geri alındı. HTTP bağlantısı kopunca
  çıktı lease'ini bırakma düzeltmesi korundu. / The per-request OAB worker/gzip
  feature was withdrawn after measured regressions; HTTP disconnect release remains.
- **B1, sınırlı düzeltme / bounded fix:** Yeni native izdeki 309 ms aralık,
  aynı turdaki OAB `readFileSync` **158 ms** ve `JSON.parse` **70 ms** ile
  örtüştü. İlk dosya okuması artık yerel asenkron I/O kullanır. Parse ve
  kanonik indeks üretimi ayrı event-loop turlarındadır; sıcak indeksler
  korunur. Aynı sürüm tek yüklemeyi paylaşır; eski stat/okuma yeni cache'i
  ezemez. Yanıt, yakalanan tek snapshot'tan üretilir ve güncel cookie,
  kullanıcı, ACTIVE/alan/OAB.VIEW kapıları tekrar doğrulanır. / A traced
  blocking cold read now uses local async I/O, separate parse/index turns,
  one load per version, stale-publication rejection and live response guards.
  This is not a return to the withdrawn worker-per-request feature.

## Ölçüm / Measurements

TR: Son **üç baz + üç yeni-kod F0 + üç ayrı açılış** serisi
`fa580f89c1cdce75160d78b2c56c2876fb315f68` üzerinde tamamlandı. Baz
`270228a4d9f195e613ae670db8c30583d9c183fc`; tüm koşularda aynı 30k Excel
SHA'ları, observer, sabit pencereler ve temiz/pinlenmiş checkout kullanıldı.
Linux, Node 24.19.0, Chromium 154.0.8037.57, dört CPU kotası, 16 GiB limit;
Windows/Electron ve soğuk OS disk cache ölçülmedi. Koleksiyon workspace'i
boştur; katalog 30k kaynaktan türetilir. Test/doküman değişiklikleri uygulama
kodunu değiştirmez. Ham kayıtların SHA'ları ve tüm tekrarlar
[makine raporunda](phase-5-review2-results.json) bulunur.

EN: The final fixed cohort contains three baseline F0 runs, three candidate
F0 runs and three separate openings, at the revisions above. All use the
same 30k source bytes, observer and windows, with clean pinned checkouts.
These are Linux measurements, not Windows/Electron or cold OS-cache claims.
The Collection workspace is empty; its catalog derives from the 30k source.
Later test/document edits leave application code unchanged. Raw-report hashes
and every repetition are retained in the machine report.

| Medyan / Median | Baz / Before | Sonra / After |
| --- | ---: | ---: |
| Yenileme işi / Refresh job | 52,962 sn | 64,102 sn (**+%21,0**) |
| Yenileme duvar süresi / Refresh wall time | 54,208 sn | 65,997 sn |
| Aynı-sekme CP / Same-tab CP | 59,342 sn | 53,067 sn |
| Aynı-sekme Orders / Same-tab Orders | 3,659 sn | 3,689 sn |
| Aynı-sekme Koleksiyon / Same-tab Collection | 222 ms | 150 ms |
| Birincil Overview / Primary Overview | 7,015 sn | 7,573 sn |
| Birincil Koleksiyon / Primary Collection | 18,748 sn | 3,934 sn |
| Birincil CP / Primary CP | 81,989 sn | 70,648 sn |
| Birincil Orders / Primary Orders | 9,933 sn | 8,393 sn |
| CP ölçüm dönüşü / CP harness observation elapsed | 253,361 sn | 224,686 sn |

TR: CP'nin erken hazır işareti tam etkileşim veya ölçüm dönüşü değildir.
Continue öncesi insan beklemesi sıfırdır; dispatch gecikmesi ve sonraki
renderer beklemesi ayrıca tutulur. Son seri, eski `764079b3` serisindeki
CP +%23 / Orders +%21 sonucunu yeniden üretmedi. Bu eski farkların kök
nedeni **[Bilinmiyor]**; düzeltildiği iddia edilmez. Ara `639372a4` serisi
de korunur: refresh 45,861 → 61,196 sn, CP 51,064 → 51,088 sn,
Orders 3,313 → 2,386 sn. Seri ve ortam oynaklığı nedeniyle tablolar
birbirine karıştırılmaz; yalnız kendi eşlenmiş bazlarıyla kıyaslanır.

EN: CP's early ready marker does not mean all interaction or observation has
finished. Human wait is zero; Continue dispatch and later renderer waiting
remain separate. The final matched cohort does not reproduce the earlier
+23% CP / +21% Orders regressions. Their original cause is **unknown**, not
claimed fixed. The intermediate `639372a4` cohort remains separately retained;
measurements from different cohorts are not pooled.

### Yenileme aşamaları / Refresh stages

| Normal seri / Normal cohort | Baz / Before | Sonra / After |
| --- | ---: | ---: |
| ASAS file-parse | 16,963 sn | 16,262 sn |
| Snapshot'ın kendi metriği / Snapshot's own metric | 10,541 sn | 9,313 sn |
| snapshot-save operasyonu / Whole operation | 11,145 sn | 17,729 sn |
| Operasyon − snapshot metriği / Difference | 455 ms | 7.829 ms |
| page-cache-write | 17,923 sn | 25,403 sn |

TR/EN: Fark her koşuda alınır, ardından medyan hesaplanır; iki ayrı medyanın
farkı değildir. / Differences are calculated per run before taking their median.

TR: Ayrı üçlü, taze süreçli, dönüşümlü clock tanısı kaynak hazırlığının
medyanını **6.708 ms** ölçtü: native MAIN gönderimi **994 ms**, worker V8
kodlama **1.027 ms**, özel replica yazma **728 ms**; sonraki projection işi
replica'yı **1.240 ms**'de açtı. Worker'da iki içerik hash çağrısının toplamı
**3.941 ms**; MAIN'de bir hash hâlâ var (**2.174 → 1.900 ms**).
Yenileme işlerinin kuyruk beklemeleri **0,3 ms altında**: kuyruk kök neden
değil. Beş projection gzip çağrısının toplam duvar süresi
**2.020 → 2.340 ms**; ana fark gzip değil. Bu süreler iç içedir,
**toplanamaz**. Tanısal refresh medyanları 52,552 → 61,284 sn'dir;
normal seri sonuçlarının yerine geçirilmez.

TR: Eski Excel/projection worker kurucularının toplamı **973 ms**, yeni
Excel kurucuları **2 ms** ve ayrı seed gönderimi **994 ms** ölçüldü.
Eski workerData ve yeni postMessage aynı API değildir; bu değerler transfer
maliyetinin mertebesini gösterir, eş koşullu IPC kazancı sayılmaz.

EN: Legacy Excel/projection constructors totalled 973 ms; new Excel
constructors totalled 2 ms, plus a separate 994 ms seed post. Different
APIs/input shapes prevent treating this as an isolated IPC speedup.

EN: Separate alternating, fresh-process stage diagnostics measured an extra
source replica, native transfer, encoding/write, later decode and repeated
hashing. Refresh-job queue waits stayed below 0.3 ms. Gzip alone does not
explain the regression. These are nested wall spans, not additive CPU costs
or replacements for normal-cohort medians.

TR: Source, snapshot sonrasında seed edilip yayımlanır; projection bundan
sonra özel replica'yı açar. Eski iki projection worker'ının yerini tek
projection işi alır. **[Doğrulandı]** Ek kaynak yaşam döngüsü ve tekrar hash
maliyeti vardır. Eski build aşaması aynı kancayla ölçülmediğinden
paralellik farkına tek başına sayısal pay verilmez. Bu mimari ödünleşim
kullanıcı tarafından kabul edilmedi. Gerçek kaynak sahibi uygulaması
[Faz 6c sözleşmesinde](phase-5-source-ownership.md) kalır; yalnız gzip
döndürüp ham kayıtları kaldırmak çözüm olarak uygulanmadı.

EN: The extra source lifecycle and repeated hashing are verified costs.
Legacy build timing was not instrumented equivalently, so the isolated
parallelism contribution is unquantified. The user has not accepted this
architectural tradeoff. The actual source-owner implementation remains in
the Phase 6c contract; raw records were not discarded as a gzip-only shortcut.

### 200 ms kapısı ve health / Responsiveness and health

| Son kod / Candidate | Koşu 1 / Run 1 | Koşu 2 / Run 2 | Koşu 3 / Run 3 |
| --- | ---: | ---: | ---: |
| F0 Overview max gap | **284,401 ms** | **345,986 ms** | 178,309 ms |
| Ayrı Global Flow / Separate opening | 147,958 ms | **245,004 ms** | **290,674 ms** |
| Ayrı Backlog / Separate opening | 171,250 ms | **334,826 ms** | 143,662 ms |

TR: Üç ayrı açılışın yalnız biri kabulü geçti. Tüm doğruluk, kapsam,
generation ve Delivery parity kontrolleri geçti; performans başarısızlığı
başarı olarak yazılmadı. Refresh health p50 medyanı **8,200 ms**, p95 medyanı
**684,927 ms**. Bir refresh fetch hatası da tüm-deneme quantile'larında ve
ham kayıtta tutulur. Baz health 404'tür; başarılı health baz çizgisi yoktur.

EN: Only one of the three separate openings passed responsiveness. All
correctness/generation/parity checks passed. Refresh health medians are
8.200 ms p50 and 684.927 ms p95; one fetch failure remains in all-attempt
quantiles and raw evidence. Baseline health returns 404, so no successful
health speedup comparison is available.

TR: Son bir clock tanısı, GF'de 590 ms maksimumla dokuz aşımı yeniden
üretti. Ölçülen mevcut process bellek/CPU ve V8 heap istatistiği çağrılarında
20 ms üzeri kayıt yoktu; aşım aralıkları kayıtlı GC veya ölçülen uzun
senkron çağrıyla eşleşmedi. Uzun async pool/round-trip span'leri ana-thread
blokajı sayılmaz. CPU örnekleri aralığı çevreler, aralığın tam CPU süresi
değildir. **[Bilinmiyor]** Kalan boşlukların kök nedeni; unwrapped JS/native
iş veya scheduling dışlanmış değildir. Bu tanı normal kabulün yerine geçmez
ve kanıtsız yeni bir düzeltme yapılmadı.

EN: One final diagnostic reproduced nine GF exceedances, maximum 590 ms.
No intercepted existing native-statistics call exceeded 20 ms; recorded GC
and long measured synchronous calls did not explain those intervals. Async
job spans are not blocking evidence. Surrounding CPU samples are approximate.
The remaining cause is **unknown**; this diagnostic neither passes acceptance
nor justifies an unproven fix.

### OAB kararları / OAB decisions

TR: İki kontrollü HTTP A/B ayrı deneylerdir. Her birinde üç taze süreç
çifti, uç/kol başına 300 sıcak örnek ve **1.818 birebir aynı JSON yanıtı**
vardır. Eski route gövdeleri aynı runtime'a dış tanı preload'u ile kuruldu;
ölçüm sırasında repository değiştirilmedi. Bunlar soğuk OS-cache değildir.

EN: These are two separate controlled HTTP experiments, each with three
fresh-process pairs, 300 warm samples per endpoint/arm and 1,818 byte-equal
JSON responses. The exact legacy routes were installed diagnostically on
the same runtime; repository files stayed unchanged during measurement.

| Deney / Experiment | Soğuk medyan / Cold median | Sıcak p95: Seasons / MAG / Buyers |
| --- | --- | --- |
| Yerel → geri alınan worker / Local → withdrawn worker | 40,274 → 221,944 ms | 6,952 / 9,189 / 6,684 → 22,813 / 25,325 / 24,721 ms |
| Senkron → yerel async / Sync → local async I/O | 45,164 → 77,412 ms | 11,216 / 14,278 / 12,674 → 12,702 / 10,756 / 12,724 ms |

TR: İlk deney net gecikme gerilemesini doğruladığı için worker taşıması
geri alındı. İkinci yol hızlanma diye sunulmaz: soğuk isteğe yaklaşık
32 ms ekler; senkron koldaki 262 ms boşluk yeni üç soğuk örnekte görülmedi
(yeni maksimumlar 0 / 26,194 / 0; 20 ms altı kaydedilmez). Sıcak sonuçlar
karışıktır. Kanonik seçenekler ve cache korunur; genel 200 ms kabulü
yukarıda ayrıca başarısızdır.

EN: The first experiment justified rollback. Local async I/O is not a
request-latency speedup: cold median adds about 32 ms. The sync arm's
262 ms cold gap did not appear in the three async cold samples; warm
latencies are mixed. Options/cache remain equal, and overall responsiveness
still fails independently.

## Doğrulama / Validation

TR: İlgili `npm test -- backlog compute … user-access page-projection`
paketi: **177 dosya / 1.328 test PASS**, failure/skip/cancel **0**.
B2 ortak yardımcı ve B1 async kaynak/live-revocation testleri RED → GREEN.
Mevcut PASS-bağlantısı-yok, kapı ve 400 kontrolleri korunur; snapshot kullanan
source assertion'ları await/getInfo ile güçlendirildi. Hata facade testi,
üretimde gerçekten dönen bilingual `error` metnini doğrular. i18n yeni/baseline
eksik **0/0**, release notes **32 PASS**; validator/baseline gevşetilmedi.

EN: Relevant tests pass: 177 files, 1,328 tests, zero failures/skips/cancellations.
New helper, async source and live-revocation regressions followed RED → GREEN.
Existing no-PASS, authority and required-reference checks remain; snapshot
source assertions were strengthened. The error facade checks the bilingual
message actually returned by production. i18n is 0/0; 32 release notes validate.

TR: Yeni son seri ve ara 639 serisinde **15'er tam projection JSON çifti**
(CP, Orders, Overview, order-summary, collection-catalog) byte/SHA eşdeğer.
30k LFL testi: tam kapsam **338 referans**, eşleşen Buyer kapsamı
**292 referans**, yasak kapsam **0**; eski motor/filtre ve gerçek native
ortak havuz çıktıları birebir aynı, takvim/gün sabit. TR/açık ve EN/koyu
post-change PNG'leri gerçek uygulamadan alınıp incelendi;
[görsel kanıt](phase-5-review2-oab-visual-evidence.json) yalnız 20 satırlık
demo içindir, 30k kabul koşusu değildir.

EN: Both the final and intermediate cohorts have 15 exact projection JSON
pairs. Real native LFL output equals the legacy engine/filter for all,
matching and denied scopes: 338 / 292 / 0 references, same day/calendar.
Actual TR/light and EN/dark post-change PNGs were inspected; their 20-row
demo is visual evidence, not 30k performance acceptance.

## GitHub, inceleme ve karar / GitHub, review and decision

TR: [#885](https://github.com/clbiez/Buyer-Log-Desktop/pull/885) açık taslaktır;
merge edilmedi. İlk inceleme ve ikinci Claude incelemesinin kapsamları
[ayrı kayıtta](phase-5-independent-review.md) tutulur. `639372a4` sonrası
delta yeniden incelenmiş sayılmaz; kullanıcı üzerinden Claude'a gider.
Son SHA ve onun gerçek GitHub checks sonucu PR açıklamasında bildirilir;
eski 639 checks sonucu yeni SHA'ya taşınmaz. TEST **yapılmadı**;
STABLE **yapılmadı**. B1 açıkken yeşil unit/PR checks merge izni değildir.

EN: PR #885 remains an open draft, unmerged. Review scopes are recorded
separately. The post-639 delta still needs Claude via the user. Its final
SHA and actual checks are reported in the PR; old green checks do not apply
to a new SHA. Neither TEST nor STABLE was published. Green code checks do
not close B1 or authorize merge.

TR: Kapsamın dondurulması korunur. Kullanıcının refresh **+%21** ürün
ödünleşimi kararı ve kalan 200 ms kabul açığının kapanması gerekir.
Veri kaybı/yetki açığı gözlenmedi; ölçülmeyen performans kazancı yazılmadı.

EN: Scope stays frozen. The +21% refresh product tradeoff needs the user's
decision, and the remaining 200 ms gap must close. No observed data loss or
scope leak, and no unmeasured speedup claim.
