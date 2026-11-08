# İlk geçiş ölçümünde gerçekten görünür satır / Actually visible first-transition measurement

## TR

[Doğrulandı] Önceki `benchmark-first-transitions` yardımcısı, satır DOM'da olsa da
sonradan açılan trivia perdesinin arkasındaki tabloyu hazır sayabiliyordu.
Bir saniyelik duvar saati penceresi, bloke olmuş event loop üzerinde bir saniyelik
gözlem anlamına gelmiyordu. Gecikmiş trivia kontrolü ayrıca 400 ms sonra perdeyi
açabildiğinden, eski ölçüm bittikten sonraki gerçek Orders PNG'sinde perde var.

Bu değişiklik yalnız ölçüm yardımcısını ve test/CI kapsamını düzeltir. Ürün,
sunucu, canonical alanlar, veri kapıları veya Continue davranışı değiştirilmedi.
Ana benchmark CLI betiği değişmedi. Yardımcı şimdi satırın viewport içindeki
noktasını `elementFromPoint` ile doğrular; hazır satırı izleyen bir saniyelik
pencerede 100 ms üstü gözlem boşluğu olursa gözlemi yeniden başlatır. Bu pencere
gecikme değerine eklenmez. Veri hazır, ilk görünür satır ve son perde sonrası
kullanılabilir satır zamanları ayrı kalır. V2 doğrulaması eski sonucu yeni
ölçümmüş gibi kabul etmez.

İki yeni native regresyon eski yardımcıda RED, düzeltmede GREEN oldu. Önceki
dört testin davranış assertion'ları korunuyor. Yeni sanal geç-perde senaryosunun
açık fixture bütçesi 4.000 ms; mevcut timeout testi ve gerçek benchmark'ın
900.000 ms bütçesi değişmedi. İlk ara GREEN denemesinin fixture timeout'u da
silinmeden `native/` altında tutuldu.

Gerçek Chromium tanısında aynı kodla iki kontrol ve #908 adayı bir kez çalıştı.
Her üç koşuda CP ve Orders'ın bütün normalleştirilmiş satırlarının SHA'sı ve
own-key sırası eşit; zamanlama sonrası ilk satırlar gerçekten açıktı. Bu seri
resmî üç çiftlik kabul veya hızlanma kanıtı değildir. Orders'ın görünür sütun
sayısı aynı kodun iki kontrolünde bile 60/53 oldu; bu şema zamanlaması ayrıca
inceleniyor. Tam DOM eşdeğerliği iddiası yok; farklar veya önceki başarısız
koşular filtrelenmedi. #908 bu tanı nedeniyle merge edilmiş sayılmaz.

Ortam: Linux, 4 vCPU kotası, Node 24.19, Chromium 154; Windows/Electron değil.
Sentetik seed7 30k fixture, CP 24.982 / Orders 30.000 satır. Her iki kolda #916
bulunuyor; browser ve sunucu saat dilimi Europe/Istanbul. Sonuçları eski UTC
koşularıyla tek kohort gibi birleştirmeyin. Kaynak Main:
`0c85445f1989cafbae4f104c13ddf5d8f0b84c6c`; ölçüm düzeltmesi `e42f24b6`.

İlk tam paket batch 3'te fixture'ın 25 saniyelik ready IPC bekleyişi dolduğu için
altı bağımlı güvenlik testiyle RED oldu. Aynı 300 dosya, concurrency=4 ve aynı
izole TMPDIR ile kontrollü tekrar: 2.074 PASS / 0 FAIL. İlk timeout'un kesin
nedeni [Bilinmiyor]; ayrı PASS ilk FAIL'i silmez. Son standart tam koşu ve CI
kabulü `validation/` altında ayrıca kaydedilir. Güvenlik assertion'ı, timeout,
runner concurrency veya validator gevşetilmedi.

#916'nın üç üretim dosyası, row-cache testi ve mevcut “CP checklist pass caches,
single refresh and delta recalculation” hızlı kontrol adımı aynen korunur.
Yeni toplu checklist geçişi yok. Ürün değişmediğinden sürüm notu eklenmedi.
Merge, TEST ve STABLE durumları PR'ın gerçek durumundan takip edilmelidir.

## EN

[Confirmed] The previous `benchmark-first-transitions` helper could declare a
table ready while a delayed trivia curtain subsequently covered its rows. A
one-second wall-clock gap was not one second of observed stability when the
renderer event loop was blocked. The overdue trivia check can schedule its
curtain 400 ms later; the retained baseline Orders screenshot shows that curtain
after the old measurement had already passed.

Only measurement support and test/CI coverage change. Product/server behavior,
canonical fields, access gates and Continue behavior are unchanged. The benchmark
CLI script is unchanged. V2 verifies a viewport point against the row using
`elementFromPoint` and restarts its one-second observation window after polling
gaps above 100 ms. Observation duration is excluded from the reported latency.
Data ready, first unobscured row and usable post-curtain row stay separate. V2
validation refuses to relabel an older result as a current measurement.

Two new native regressions fail against the old helper and pass with the fix.
Existing behavioral assertions remain. Only the new virtual delayed-curtain
scenario uses an explicit 4,000 ms fixture budget; the existing timeout case and
real 900,000 ms benchmark budget are unchanged. The intermediate fixture timeout
is retained alongside RED/GREEN evidence in `native/`.

Real Chromium diagnostics ran two same-code controls and one #908 candidate.
Complete normalized CP/Orders row hashes and own-key order matched in all three;
post-timing rows were unobscured. This is not formal three-pair acceptance or a
performance gain. Orders displayed 60 versus 53 columns even between same-code
controls; that separate schema-timing difference remains under investigation.
Full DOM equality is not claimed, and neither differences nor failed runs were
filtered away. These diagnostics do not accept or merge #908.

Environment: Linux, 4-vCPU quota, Node 24.19, Chromium 154, not Windows/Electron.
Synthetic seed7 30k fixture, 24,982 CP / 30,000 Orders rows. Both arms contain
#916; browser/server timezone is Europe/Istanbul. Do not combine these runs with
historical UTC runs as one cohort. Base Main is
`0c85445f1989cafbae4f104c13ddf5d8f0b84c6c`; measurement fix is `e42f24b6`.

The first full suite failed in batch 3 when the fixture's 25-second ready-IPC
deadline expired, affecting six dependent authority cases. A controlled repeat
of the exact 300 files, concurrency=4 and private TMPDIR passed 2,074/2,074.
The first timeout's cause is [Unknown]; a separate PASS does not erase that FAIL.
Final standard-suite and CI acceptance are recorded separately in `validation/`.
Security assertions, timeouts, runner concurrency and validators are unchanged.

The three #916 production files, row-cache test and existing “CP checklist pass
caches, single refresh and delta recalculation” fast-check step are preserved
exactly. No new checklist bulk pass is introduced. There is no product release
note because product behavior does not change. Refer to the PR for actual merge,
TEST and STABLE states.

## Final local acceptance / Son yerel kabul

`e42f24b6` app tree: standard `npm test`, all 10 batches in one invocation, default concurrency=4, no NODE_OPTIONS or test-concurrency override: **8931 PASS / 0 FAIL / 65 existing SKIP / 0 CANCEL**, 1,301 files. Related package: **22 PASS**. i18n **0/0**; release-note validator **50 PASS**. Actual GitHub checks remain a separate gate for the final pushed SHA. Earlier failed suite and exact-batch repeat stay in validation; their results are not relabeled.
