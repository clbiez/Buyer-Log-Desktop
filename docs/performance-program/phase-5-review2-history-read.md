# B1 · Gereksiz geçmiş yazımı / Redundant history writes

TR: #888 sabit bazındaki b2c9bdac normal 3+3+3 serisi bütün doğruluk
kontrollerini geçti, ancak 200 ms kabulünü geçmedi. Ham sonuçlar
[ayrı JSON'da](phase-5-review2-main888-results.json) korunur. Sonraki tek
CPU tanısı 204,281 ms Global Flow aralığını yeniden üretti; mevcut üretim
profiler worker'ının saatleriyle eşlenen izde buildResponse →
loadRefreshHistory → atomicWriteJson/fsync ve yaklaşık 80 ms GC vardır.
Bu, normal Backlog 475/559 ms aralıklarının tam nedenini kanıtlamaz.

EN: All correctness checks pass in the retained #888/b2c9 normal cohort,
but responsiveness fails. One subsequent diagnostic reproduces a 204 ms
GF gap containing synchronous history writes plus about 80 ms GC. It does
not establish the entire cause of the separate normal Backlog gaps.

TR: Kırpılmış bir kaydın detailsTotal değeri doğru olsa da normalizasyon
her okumada yeni nesne oluşturuyordu. Kimlik farkı değişiklik sayılıp
revision artırılıyor, aynı içerik senkron ve dayanıklı olarak yazılıyordu.
Tek koşul değişikliği, zaten normalize edilmiş kaydın kimliğini korur.
Gerçek güncelleme, ilk legacy kırpma, string toplamı normalizasyonu,
10 kayıt / 1000 detay sınırları ve içerik aynı kalır.

EN: Normalization returned a new object for an already-capped item with a
correct total, falsely triggering a revision and durable write on every
read. Preserving identity in that case removes only redundant writes.
Real changes, one-time legacy normalization and all retention limits remain.

TR: Yeni üç test eski kodda revision assertion'ında RED; düzeltmeyle mevcut
history paketinde 4 dosya / 11 test GREEN. Son geniş ilgili paket 208 dosya /
1508 test PASS, fail/skip/cancel 0; i18n 0/0, 36 sürüm notu PASS.

EN: Three new tests fail RED on the original revision increment and pass
GREEN with all existing history tests. Relevant regression: 208 files /
1,508 tests, no failures/skips/cancellations. i18n 0/0; 36 notes validate.

TR: Altı taze süreç, dönüşümlü üç çift, gerçek sentetik 30k geçmişinin beş
okuması: medyan 198,904 → 32,612 ms; fsync 30 → 0; gereksiz revision artışı
5 → 0. Bütün items SHA'ları eşit. Bu mikro sonuç toplam açılış veya endpoint
p95 kazancı değildir. Gerçek 30k demo API/UI acceptance'ında dosya baytları,
mtime ve revision korundu. TR/açık ve EN/koyu PNG'ler agent tarafından incelendi.

EN: Alternating three fresh-process pairs for five reads measure 198.904 →
32.612 ms, 30 → 0 fsyncs and 5 → 0 redundant revisions; all items hashes match.
This is not a whole-startup or HTTP-p95 claim. Actual demo API/UI checks
preserve file bytes, mtime and revision; both post-change PNGs were viewed.

[RED/GREEN, mikro, eşlenmiş CPU örnekleri, profiller ve UI kanıtı / Evidence](phase-5-review2-artifacts/history-read/manifest.json).

TR: Son adayın üç F0 + üç ayrı açılışı yeni kodla alınır. Değişmeyen Main
#888'in üç baz örneği tutulur; kollar zaman bakımından dönüşümlü değildir.
Bu sınırlama ve önceki bütün başarısız örnekler final raporda kalır. B1 henüz
kapanmadı; post-1ff delta Claude'a kullanıcı üzerinden iletilir. Merge,
TEST ve STABLE yapılmadı. INT-06 kullanıcı tarafından ayrı sohbete ayrıldı.

EN: Final candidate F0/opening samples follow this fix. All three unchanged
Main #888 baseline samples remain; arms are not alternating in time. Earlier
failures remain. B1 stays open pending final measurements and the separate
post-1ff review. No merge, TEST or STABLE. INT-06 belongs to the new user chat.
