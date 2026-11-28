# 6S · CI test süreleri: Windows yavaşlamasının nedeni (2026-11-28)

**Kaynak:** GitHub Actions iş logları; batch süreleri `run-tests.js` çıktısından okundu.
- `8.0.21` TEST: run 45942216237, c=1, commit 51deb5d.
- `8.0.22` TEST: run 45971448785, c=1, commit 39384d7.
- `Buyer Log Tests`: run 46076754519, c=4, commit 5440fde.

Yerel ortam: Linux 6.18, Node 22.23.5, 4× Xeon 2,1 GHz, c=4, commit 825721c + PR #1252. Ham tablo: `ham/windows-batch-sureleri.csv`. Yerel tam koşu: `ham/linux-node22-c4-tam-npm-test.log`.

## Bulgular

1. **8.0.21 → 8.0.22 (34 → 48 dk, c=1):** Her batch %25–65 yavaşladı.
   - 7, 9, 11 ve 12. batch'ler tek dosyalık, yalıtılmış batch'ler. Bu dosyalar 51deb5d..39384d7 arasında değişmedi, yine de %31–76 yavaşladılar.
   - Bu aralıktaki test farkı: 5 yeni dosya ve 3 değişen dosya, hiçbiri bu batch'lerde değil.
   - **[Muhtemel]** Baskın neden runner performans farkı, kod değil. Eski loglarda CPU modeli yazılmadığı için kanıtlanamıyor. PR #1252'den sonra her koşu ortam satırını yazıyor; ilk Windows kapı koşusunda runner `4× INTEL XEON PLATINUM 8573C` idi.
2. **Buyer Log Tests 30 dk marjı (28,8 dk, c=4):**
   - Batch 2, c=4'te 718 sn sürdü; c=1 koşusunda (8.0.21) 715 sn. Yani paralellikten kazanmıyor; kritik yolu tek bir dosya.
   - **[Doğrulandı: yerel]** Linux'ta batch 2'nin en uzun iki dosyası `collection-sync-causal-cloud` (90,3 sn) ve `collection-sync-randomized-cloud` (82,8 sn). İkisi de 6 cihazlı gerçek dosya sistemi simülasyonu.
   - Windows'ta yalıtılmış simülasyon dosyaları Linux'tan ~4,6 kat yavaş (collection-sync-simulation 205,5 / 44,8; sync-simulation 72,9 / 15,9).
3. **[Doğrulandı: source + runtime]** `causal-cloud` dosyasındaki todo testi, 10 seed senaryosunu aynı argümanlarla **birebir yeniden** koşuyordu. Senaryo deterministik: 4 seed'de iki koşu aynı hata listesini ve aynı izi verdi.
   - PR #1252 seed başına tek koşuyu iki teste paylaştırır; varsayımı yeni bir determinizm testi sınar.
   - Tek dosya L1 (Linux): 55,6 sn → 29,7 sn.
4. **[Bilinmiyor]** Windows'ta dosya bazlı süre bilinmiyor; kazancın Windows kritik yoluna yansıması ölçülmedi. Bunun için PR #1252 dalında tek bir `Buyer Log Tests` koşusu istendi.

Süre sınırları (60 dk TEST, 30 dk Buyer Log Tests) değiştirilmedi.
