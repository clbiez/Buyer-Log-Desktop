# Sessiz eksik görsel tamamlama — L2 bütçe (ölçümden ÖNCE yazıldı)

Kademe: **L2** (ağ/polling + sıcak yol: açılış, modül açılışı, 30k Orders kaydırma).
Ortam: cloud Linux konteyneri, Node 22, Playwright Chromium (web kipi). Electron
native yolu bu ortamda çalıştırılamaz → Electron kapısı **BLOCKED** yazılır.

Taban: Main `390bff6` (worktree), aday: bu dal. Aynı sentetik veri
(`generate-demo-data.js --rows 30000 --seed 7`), her kol yeni sunucu + yeni
Chromium süreci, A/B · B/A · A/B dönüşümlü en az 3 çift.

| Metrik | Bütçe |
| --- | --- |
| Açılış: gezinme → açılış perdesi hazır (`[data-boot-continue]`) | aday medyanı ≤ Main medyanı (A/A gürültü aralığı içinde) |
| Orders hazır: Devam → ilk satır | aday medyanı ≤ Main medyanı (gürültü içinde) |
| Modül açılışı CP: `switchTab('cp')` → ilk satır | aday medyanı ≤ Main medyanı (gürültü içinde) |
| 30k Orders kaydırma (40 × 400 px): >50 ms görev sayısı ve en uzun görev | aday ≤ Main (gürültü içinde); yeni >50 ms görev yok |
| Sessiz pencere (kaydırma sonrası 20 sn boşta): >50 ms görev | aday Main'den fazla değil; yeni >50 ms görev yok |
| Sessiz istek | eşzamanlı ≤ 1, paket ≤ 12 kimlik, hepsi `X-BuyerLog-Auth-Mode: silent`; etkileşim sırasında 0 |
| Kullanıcıya görünürlük | toast 0, Operasyon Merkezi açılışı 0, tablo gövdesi yeniden çizimi 0 (satır `childList` mutasyonu yok) |
| Sunucu yerel plan (129 model / 20k görsellik indeks) | Main'den hızlı; olay döngüsü ≥1 sn kilitlenmez |
