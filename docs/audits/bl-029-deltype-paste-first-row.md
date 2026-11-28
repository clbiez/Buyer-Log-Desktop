# BL-029 · Del. Type çoklu yapıştırmada ilk satıra farklı değer → IAS parsiyelli satırda Del. Type yazımı

Durum: **Kapandı — kök neden doğrulandı, düzeltildi** (`claude/bl-029-paste`). İlk kayıt: 2026-11-27; kapanış: 2026-11-28.
Kaynak: ADR-0003 §6I madde 5.

## İlk gözlem (2026-11-27)

"Uçak" iki satıra yapıştırıldığında kayıt gövdesi `["Gemi","Uçak"]` taşıyordu; #1243 öncesi ve sonrası aynı. Kök neden o gün doğrulanmamıştı.

## Yeniden üretim (2026-11-28) [Doğrulandı: gerçek sunucu + gerçek Chromium, 3/3 tekrar]

Sentetik ASAS/IAS: 820001 (yalnız üretim, 100), 820002 (IAS parsiyeli 40 adet Gemi/yolda + 60 üretim bakiyesi), 820003 (yalnız üretim).
Pano yolu: tabloda hücre seçimi (tık + Shift-tık), `paste` olayı (`DataTransfer`), toplu önizleme → "Uygula ve kaydet".

| Senaryo | Gövde (önce) | Sonuç |
|---|---|---|
| Del. Type yapıştırma "Uçak×2" (hücre odaklı, editör kapalı) | `[820001:"Uçak", 820002:"Gemi"]` | Sapma sırayla değil **parsiyelli satırla** ilgili. Önizleme "Gemi → Uçak" gösterip "Gemi" gönderiyordu |
| Del. Type menüsü açıkken yapıştırma | istek yok | Odak menüde (tablo dışında); yapıştırma yok sayılıyor, veri yazılmıyor (3/3) |
| Tek hücre menüsünden "Uçak" (`POST /rows`) | `820002:"Gemi"` | Aynı hata yapıştırmaya özgü değil |
| Supp. FOB yapıştırma 2 satır | `[7.5, 7.5]` | Sapma yok |
| Notes yapıştırma 2 satır | `[not, not]` | Sapma yok |

Denetimdeki `["Gemi","Uçak"]` sırası, seçimin ilk satırının parsiyelli olmasıyla açıklanır [Muhtemel].

## Kök neden [Doğrulandı: kaynak + tarayıcı]

- `commitCpEditor` (deltype) → `syncCpProductionLogisticSegment(row, değer)` üretim segmentini doğru günceller.
- Ardından `rebuildCpLogisticCaches` satırın görünen `Del. Type`'ını **birincil segmentten** (`partials[0]`, IAS vasıtası) yeniden yazar.
- Gövde (`syncOverrideToServer`), yerel `delmap` (`syncOverridesFromRow`), geri al `prev` değeri ve yapıştırma önizlemesi bu türetilmiş değeri okuyordu.
- Sunucu `delmap`'i yalnız üretim/kıtlık bakiyesine uygular (`parse.js backlogProductionDelType`). Kullanıcının seçimi sunucuya parsiyelin vasıtası olarak gidiyor, yeniden yüklemede kayboluyordu. Parsiyel "Gemi", üretim "Uçak" iken "Gemi" seçimi de no-op sayılıyordu.

## Düzeltme

- `cpEditableDelType(row)`: üretim/kıtlık segmentinin vasıtası (hücrenin gösterdiği değer); segmentsiz satırda satır değeri.
- Gövde, yerel `delmap`, `commitCpEditor` eşitlik/geri al `prev` değeri ve yapıştırma önizlemesi bu değeri okur.
- `_delTypeWrite` niyet kuralı, "—" anlamı (üretim varsayılanı Gemi), IAS parsiyelleri ve parsiyelsiz satır davranışı değişmedi.

## Doğrulama

- Test: `tests/cp-deltype-partial-row-write-v20261128.test.js` (iki kayıt yolu, no-op, parsiyelsiz satır, "—", kaynak sözleşmesi). Düzeltmeden önce RED, sonra GREEN.
- Tarayıcı (düzeltme sonrası, 3/3):
  - Yapıştırma gövdesi `["Uçak","Uçak"]` oldu. Sunucudan yeniden yüklenen sayfada 820002 değerleri: üretim "Uçak", parsiyel "Gemi".
  - Menü `POST /rows` gövdeleri: "Gemi+Tır" ve "Gemi" (parsiyel Gemi iken artık no-op değil).
  - Geri al / yinele [Doğrulandı: 1 koşu]: "Gemi" / "Gemi+Uçak" gönderildi.

## Kapsam dışı / kalan

- Menü açıkken yapıştırmanın yok sayılması veri kaybı değil. Ayrı bir UX konusu [Bilinmiyor: ürün beklentisi].
