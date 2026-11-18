# Kaynak doğrulama ve yenileme hız günlüğü (ASAS / IAS / Excel)

Buyer Log'un **dışında** çalışan tanı aracı. Buyer Log paketine girmez
(paket kökü `resources/app`), BL dosyalarını ve ayarlarını değiştirmez.

## Kullanım

1. `dist/BuyerLog-Kaynak-Dogrulama.cmd` dosyasını Buyer Log klasörüne
   (BuyerLog.exe'nin yanına) kopyalayın ve çift tıklayın.
2. Menüden seçin: kumaş ölçümü, IAS aday sorgu, tekrar sayısı (3 önerilir),
   Excel karşılaştırması.
3. Rapor: `Kaynak-Dogrulama-Raporlari\<tarih>\`
   - `rapor.txt`: Excel ⇄ DB ⇄ aday veri doğruluğu
   - `performans.txt`: yenileme süresinin nerede harcandığı, kumaş etkisi, aday sorgu farkı
   - `olaylar.jsonl`: her sorgu ve aşamanın zaman damgalı ham günlüğü
   - `sorgular\*.dax`: DAX Studio için çalışan sorgular
   - `*.csv`: farklar (iş verisi içerir, paylaşmayın)

## Ne yapar

- BL'ın **etkin** çekirdeğini (`data\local\updater\current.json` →
  `.buyerlog-versions\...\app`, yoksa `resources\app`) bulur ve onun
  modülleriyle, BL'ın Database yenilemesinin veri katmanını
  (`loadFromModelConnections`) aynen çalıştırır.
- Excel: kaynak klasördeki en güncel `asas*.xlsx` / `antrepo*.xlsx`
  kopyalarının pivotunu BL'ın `RefreshExcel.ps1`'iyle yeniler, BL Excel
  ayrıştırıcısıyla okur. **Doğruluk referansıdır.** Yenileme başarısızsa Excel
  karşılaştırması GEÇERSİZ sayılır.
- IAS aday sorgu (RELATED) ve kumaşsız ASAS sorgusu yalnız bu sürecin
  belleğinde, BL fonksiyonları geçici sarmalanarak üretilir; her varyanttan
  sonra özgün fonksiyon geri konur.

## Geliştirme

```bash
node --test tools/source-parity/test/*.test.js
node tools/source-parity/build.js
```

Testler `resources/app/node_modules` gerektirir (`npm ci` — resources/app).
