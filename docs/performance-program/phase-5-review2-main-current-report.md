> **Son teslim / Latest handoff:** [e493546c son kod raporu / final-code report](phase-5-review2-final-report.md). Aşağıdaki revizyona ait tarihsel kanıt korunur / Historical evidence below remains at its recorded revision.

# Faz 5 · Main entegrasyonu sonrası sonuç / Result after Main integration

**B1 AÇIK / OPEN. B2 ve B3 düzeltildi / fixed. Merge yok / no merge.**

TR: Kullanıcının son talimatına göre #885 kapsamı donduruldu; yalnız inceleme
düzeltmeleri ve gerekli kapanış işleri yapıldı. `1ff5038e` delta SHA'sı
bildirildikten sonra gerçek Main ucunun `c93e2544` olduğu, #886/#887'nin
ilerlediği ve sürüm notu çakışmasının PR checks'i engellediği doğrulandı.
Rebase/force-push yapılmadı. Main `0ad9f159` merge commit'iyle alındı;
bu, `1ff5038e` sonrasında ayrıca incelenecek delta'dır.

EN: Scope remains frozen to review fixes and necessary closure. After the
`1ff5038e` handoff, actual Main was found at `c93e2544` with #886/#887, and
a release-note conflict prevented PR checks. Main was merged at `0ad9f159`,
without rebase/force-push. This is a separate post-1ff review delta.

## Değişti / Changes

TR: Main'in 29 sürüm notu ve kendi 5 notumuz korunur (**34**). Kullanıcıya
önceden bildirilerek index/perf/CSS dosyaları Main'den **birebir** alındı;
özel düzenleme yapılmadı. Tek içerik çakışması next.json'dı. Main'in yeni
Excel testinin senkron API varsayımı RED oldu; mevcut async createTable ve
renderDraft çağrılarına await eklendi, tüm dosya/biçim assertion'ları korundu
ve GREEN oldu. Gerçek ortak-worker eşdeğerlik matrisi biçimli XLSX'i de
kapsar: zebra, sabit sütun, toplam, veri çubuğu ve vurgu.

EN: All 29 Main notes and our five remain. Locked shell/CSS files were taken
verbatim after notifying the user. The only conflict was next.json. The new
Main format test failed RED on its synchronous API assumption; awaiting the
existing async calls preserves every assertion and passes GREEN. Real native
worker equality now also covers explicitly formatted XLSX.

TR: B2'nin ortak LFL sürüm yardımcısı ve B3'ün ölçüme dayalı OAB worker
geri alımı korunur. B1'in yerel async OAB dosya okuması, tek yükleme,
eski yayın reddi ve güncel oturum/alan/capability kapıları korunur.
Yeni özellik/optimizasyon eklenmedi. Kaynak kopyasını kaldırıp yalnız
gzip döndürülmedi; gerçek kaynak sahibi uygulaması Faz 6c'ye ait kalır.

EN: The shared LFL version helper, OAB worker rollback and bounded local
async-read fix remain, including single flight, stale-publication rejection
and live authorization. No further feature/optimization was added. Raw
source ownership remains the Phase 6c contract, not a gzip-only shortcut.

## Ölçüm / Measurements

TR: Baz **`c93e254454e22ee9d6f7f288f4217ef6991f790f`**, ölçülen uygulama
**`0ad9f159dea2f3cda2f8e9727e325c288a6a968b`**. Sabit üç baz + üç sonra
F0 + üç ayrı açılış tamamlandı. İki kol da Main'in checklist ve Excel
değişikliklerini içerir; #886 CP kazancı Faz 5'e yazılmaz. Aynı 30k kaynak
SHA'ları ve observer kullanıldı; Node 24.19, Linux, Chromium 154,
dört CPU kotası, 16 GiB. Windows/Electron ve soğuk OS cache iddiası yok.
Koleksiyon workspace'i boştur; kataloğu 30k kaynaktan türetilir.

EN: Both arms include the exact same Main checklist and XLSX changes.
Main's CP benefit is not attributed to Phase 5. The fixed 3+3+3 cohort uses
the same 30k source hashes and observer, Linux/Node/Chromium and four-CPU
quota. It is not Windows/Electron or cold OS-cache validation.

| Medyan / Median | Baz / Before | Sonra / After |
| --- | ---: | ---: |
| Refresh işi / Job | 63,045 sn | 66,922 sn (**+%6,15**) |
| Refresh duvar süresi / Wall time | 64,208 sn | 67,681 sn |
| Aynı-sekme CP / Same-tab CP | 8,857 sn | 8,452 sn |
| Aynı-sekme Orders / Same-tab Orders | 2,408 sn | 2,924 sn (**+%21,43**) |
| Aynı-sekme Koleksiyon / Same-tab Collection | 140 ms | 226 ms |
| Birincil Overview / Primary Overview | 7,043 sn | 5,059 sn |
| Birincil Koleksiyon / Primary Collection | 14,704 sn | 3,449 sn |
| Birincil CP / Primary CP | 24,647 sn | 25,729 sn |
| CP ölçüm dönüşü / Harness observation elapsed | 46,754 sn | 42,078 sn |
| Birincil Orders / Primary Orders | 8,758 sn | 7,519 sn |

TR: Tek tek refresh değerleri bazda **63,045 / 225,725 / 49,330 sn**,
sonrada **65,249 / 66,922 / 69,565 sn**. Büyük baz örneği atılmadı.
Oynaklık ve yalnız üç tekrar nedeniyle medyan bir belirsizlik garantisi
değildir. İnsan beklemesi sıfır; primary/gate/complete, Continue dispatch
ve gözlem dönüşü ayrı tutulur. Önceki fa580f89/270228a4 serisi ile bu
serinin sonuçları karıştırılmaz; [eski rapor](phase-5-review2-report.md)
ve tüm başarısız örnekler korunur.

EN: All refresh samples, including the 225.725 s baseline outlier, remain.
Three-run medians do not eliminate variability. Human wait is zero; early
ready events, dispatch and observation completion remain separate. Earlier
cohorts are retained and are not pooled with this Main baseline.

### Aşamalar / Stages

| Normal medyan / Normal median | Baz / Before | Sonra / After |
| --- | ---: | ---: |
| ASAS file-parse | 18,266 sn | 17,609 sn |
| Snapshot'ın kendi metriği / Own metric | 12,586 sn | 10,166 sn |
| snapshot-save operasyonu / Whole operation | 12,946 sn | 18,066 sn |
| Koşu bazlı fark / Per-run difference | 360 ms | 8.126 ms |
| page-cache-write | 25,666 sn | 26,472 sn |

TR: Eski c799fe41 stage tanısı aynı kaynak yaşam döngüsünde seed'in
6.708 ms, MAIN native post'un 994 ms, worker encode/yazma/decode'un
1.027 / 728 / 1.240 ms ve iki worker hash'inin toplam 3.941 ms olduğunu
ölçtü. Kuyruk <0,3 ms; beş gzip çağrısı 2.020 → 2.340 ms. Bunlar farklı
tanısal serinin **iç içe duvar süreleridir**, toplanmaz veya yeni seri
sonucu diye yazılmaz. Eski build aynı kancayla ölçülmedi; paralellik
farkına sayısal pay verilmedi. Yeni normal snapshot operasyon farkı da
ek kaynak hazırlığını doğrular. Refresh ödünleşimi kabul edilmiş değildir.

EN: Retained stage diagnostics quantify the extra replica lifecycle,
hashing and decode; queue wait is negligible and gzip alone is not the
root cause. These are nested diagnostic wall spans, not additive CPU time
or new-cohort timings. The new normal snapshot-operation gap also confirms
additional source preparation. The user has not accepted the refresh tradeoff.

### 200 ms ve health / Responsiveness and health

| Son kod / Candidate | Koşu 1 / Run 1 | Koşu 2 / Run 2 | Koşu 3 / Run 3 |
| --- | ---: | ---: | ---: |
| F0 Overview max gap | 176,429 ms | 107,959 ms | 135,437 ms |
| Ayrı Global Flow / Separate opening | 143,645 ms | **605,744 ms** | **446,375 ms** |
| Ayrı Backlog / Separate opening | 167,512 ms | **1.248,511 ms** | 179,623 ms |

TR: Tüm doğruluk/generation/revizyon/Delivery parity kontrolleri geçti;
üç ayrı açılışın yalnız biri 200 ms kabulünü geçti. İkinci GF'de dokuz,
Backlog'da yedi aşım vardı. Eşik veya validator değişmedi. Sonraki
tanısal başarılı koşu bu başarısızlıkların yerine geçirilmez.

EN: All correctness checks pass; only one separate opening passes the
200 ms criterion. The second GF/Backlog windows have nine/seven exceedances.
No threshold/validator change, no replacement by a passing diagnostic run.

TR: Yeni refresh health p50/p95 koşu medyanları **10,373 / 692,031 ms**.
Tüm-deneme quantile'ları, hatalar ve zaman aşımları korunur. Baz health
404 döndürür; onun başarısız RTT p95'i 1.212,741 ms'dir, başarılı health
baz çizgisi veya kazanç kıyaslaması değildir.

EN: Candidate refresh health medians are 10.373 ms p50 / 692.031 ms p95.
All attempts remain. Baseline health is 404; its failed-round-trip p95 is
not a successful health benchmark and is not compared as a speedup.

## Son CPU tanıları / Final CPU diagnostics

TR: Mevcut üretim profiler worker'ı tek tanıda açıkça etkinleştirildi.
Source kodu değişmedi; capture senaryo sınırlarında aynı mekanizmanın IPC
kontrolüyle alındı. Yeni Main timer/CPU counter eklenmedi. Normal seriye
katılmaz. GF/Backlog maksimumları **89,989 / 123,331 ms** oldu; aşım
yeniden oluşmadı. Profiller çoğunlukla idle'dı. **[Bilinmiyor]** Normal
1.248 ms aralığın kök nedeni; bu iz onu açıklamaz veya geçersiz kılmaz.

EN: One explicit diagnostic uses the existing production profiler worker,
manual IPC captures and no extra measured-thread timer/counter. It does
not reproduce the normal failure; mostly idle profiles cannot establish
the cause of the earlier 1,248 ms gap.

TR: F0'nun değişmeyen aynı-sekme fonksiyonu çevresinde iki taze süreçte
Chrome CPU profili alındı; modül ölçümleri öncesi kasıtlı sentinel ile
çıkıldı, başarısız ham raporlar tanı diye etiketlendi. CP **13,113 → 9,688 sn**,
Orders **1,859 → 2,223 sn** oldu. Bunlar tek tanısal çift, medyan/kazanç
kanıtı değildir. Orders'ta offsetHeight örnek ağırlıkları iki kolda da
yaklaşık **297 ms**; tablo başlıkları, Motion+ ve ortak katalog hesapları
görülür. Sonra profilinde **223 ms idle** vardır; örnek sınırı/protokol ve
çizim işleri ölçüm fonksiyonunun dışına uzanır. Bekleme/paint ile tutarlı
kısmi kanıttır, ek 516 ms normal farkın tam kök nedeni kanıtlanmadı.
Workspace-blur querySelectorAll örnekleri yaklaşık 30 → 41 ms; tek çiftle
bu modüle optimizasyon uygulanmadı veya Faz 7 maddesi kapatılmadı.

EN: One fresh Chrome profile pair surrounds the unmodified F0 transition
function and deliberately aborts before other module measurements. It
is diagnostic, not a new median. Shared layout/column work appears in both
arms; the after profile includes 223 ms weighted idle. Protocol/render work
extends beyond transition.ms, and weighted samples are not exact CPU
attribution. This partly supports a waiting/paint component, but does not
prove the full Orders regression cause or justify a speculative fix.

[Profil özetleri ve ham SHA'lar / Profiles and hashes](phase-5-review2-current-profiles.json).

## Doğrulama ve karar / Validation and decision

TR: Main sonrası ilgili paket **203 dosya / 1.494 test PASS**;
failure/skip/cancel **0**. i18n yeni/baseline **0/0**, release notes **34 PASS**.
Yeni normal seride beş modül × üç çift = **15 tam JSON byte/SHA eşdeğerliği**.
Önceki 30k native LFL tam/eşleşen/yasak kapsam çıktıları 338/292/0
referansla eşdeğerdir; bu motor Main entegrasyonunda değişmedi.
Gerçek TR/açık ve EN/koyu OAB PNG'leri değişiklik sonrası çekilmiştir;
kendi revizyonları ve 20 satırlık görsel amaçları önceki manifestte açıktır.

EN: Relevant tests pass: 203 files / 1,494 tests, zero failures/skips.
i18n is 0/0; 34 release notes validate. All 15 full projection pairs are
byte-equal. Native LFL equality remains valid for the unchanged engine.
Actual OAB screenshots retain their explicit post-change revision and
20-row visual-only provenance.

TR: İlk inceleme `ad198bfe..7012eb3f`; ikinci Claude incelemesi
`7012eb3f..639372a4`. `639372a4..1ff5038e` düzeltmeleri ve sonraki
Main/test/doküman deltası ayrıca incelenmiş sayılmaz. Son SHA ve gerçek
GitHub checks PR'da bildirilir; yerel test veya eski checks yeni SHA için
GitHub başarısı değildir. **Merge öncesi durulur.** B1 açıkken sonraki
fazlara geçilmez. TEST **yapılmadı**, STABLE **yapılmadı**.

EN: The post-639 fix range and subsequent Main/test/document delta still
need independent review through the user. Actual final-SHA checks are
reported in the PR. Merge stays gated; no later phase, TEST or STABLE.

TR: Kullanıcı kararı gereken refresh ödünleşimi **+%6,15**; ayrıca Orders
**+%21,43** ve kalan 200 ms aşımı çözülmedi. Kanıt düzeyleri ayrıldı:
**[Doğrulandı]** ölçümler/eşdeğerlik/aşama maliyetleri; **[Bilinmiyor]**
kalan tam kök nedenler. Yeni özellik veya kanıtsız düzeltme eklenmedi.

EN: The +6.15% refresh tradeoff needs the user's product decision. Orders
and responsiveness remain open technical blockers. Measurements and
equivalence are verified; the remaining full causes are unknown.

[Makine raporu ve tüm tekrarlar / Machine-readable evidence](phase-5-review2-main-current-results.json).
