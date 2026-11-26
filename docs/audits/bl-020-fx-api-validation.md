# BL-020 · FX kur değerlerinin API'de doğrulanmaması (düşük öncelik)

- **Durum:** Açık bulgu, düzeltilmedi (ürün sahibi kararı: kapsamlı FX değişikliği yok).
- **Risk:** P3–P2 sınırı. Üretimde tetiklendiği bir yol bulunamadı.

## Bulgu

- `public/fx-calculation-engine.js` içindeki `num()` metin girdisini `parseFloat(String(v).replace(',', '.'))` ile okur. `"1.234,56"` → **1,234** olur (binlik ayıracı düşer). `"12abc"` → 12 olur. **[Doğrulandı: çalıştırıldı]**
- `num()` yalnız saklanmış kur tablosundaki değerlere (`rates[cur]`) uygulanır.

## Üretim veri yolu

Uygulamanın kur yazma yollarının hepsi değerleri **sayı** olarak saklar **[Muhtemel: source]**:
- Elle/Excel içe aktarma: `public/fx-import-engine.js` · `numberValue()`, `"1.234,56"`'yı doğru okur.
- Klasörden KUR: `server/lib/fxWorkbook.js` aynı `numberValue`'yu kullanır.
- LCW AI yerleşimi: çıkarım yine deterministik içe aktarma motorundadır.

Bu nedenle hatalı biçimli bir metnin FX motoruna ulaştığı bir üretim yolu bulunamadı.

## Kalan açık

- `PUT /api/fx` (`server/routes/costing-fx-shipping-routes.js`) gövdeyi şema doğrulaması olmadan `saveFx()` ile kaydeder (`server/db.js`). Değerlerin sayı olduğu denetlenmez.
- Dışarıdan bir API istemcisi, eski bir sürüm ya da elle düzenlenmiş bir dosya kuru metin olarak yazarsa, değer sessizce yanlış ayrıştırılabilir.

## Önerilen küçük önlem (yapılmadı)

`saveFx()` içinde her kurun sonlu ve pozitif bir sayı olduğunu doğrulamak, aksi hâlde kaydı reddetmek. Bu tetiklenen bir hatanın düzeltmesi değil, savunma amaçlı bir sertleştirmedir; ayrı ve küçük bir P2 olarak, regresyon testiyle yapılmalı.
