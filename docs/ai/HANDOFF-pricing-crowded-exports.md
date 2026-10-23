# Devir talimatı — Fiyatlama: TR Landed düzeltmesi, ayrıntılı dışa aktarım, kalabalık fiyatlama düzeni

> Codex için yürütme paketi. Önce `CLAUDE.md` / `AGENTS.md`'yi oku. Bu dosya görev
> sözleşmesidir. İş bitince bu dosyayı sil (PR'a girmesin).

## Bağlam
- Önceki iş: PR #657 (`main`'e birleşti). Fiyat Masası, Fiyat Defteri, Koleksiyon Kompakt/Detay/Maliyet
  fiyat görünümü, Fiyat Çekmecesi ve Veri Sağlığı eklendi.
- Dal: `claude/blissful-hopper-d0x696`. Güncel `main`'den yeniden başlatıldı. Üzerinde tek bir WIP
  commit'i var (bu dosya + aşağıdaki yarım değişiklikler).
- Kullanıcının bu turdaki isteği (özet):
  1. Dışa aktarımlarda (Excel, satır kopyası) her modelin landed fiyatları, avantaj oranı ve
     Endeksmatik hesabı **ayrı sütunlar** olarak bulunmalı. Kullanıcı isterse uygulamada da
     sütun olarak görebilmeli.
  2. 30 model × 20 üreticili bir fiyatlama yormamalı; açık ve anlaşılır olmalı. Üreticiler görünmeli
     ama "fiyat vermedi" bilgisi önemli değil. Kritik soru şu: 20 modelin 5'ine fiyat verip 15'ine
     vermeyen bir üretici nasıl konumlandırılacak? Çözüm bizden bekleniyor.
  3. TR Landed kopyala/yapıştır veri bozma hatası düzeltilmeli (aşağıda).

## Ölçülen hatalar (gerçek uygulamada Playwright ile doğrulandı)
- **P0 — TR Landed:** Izgarada TR Landed hücreleri kopyalanıp başka satırların TR Landed hücrelerine
  yapıştırılınca, landed USD değeri **TR fiyatı (TL)** alanına yazılıyordu. Örnek: 400 TL →
  `10.106250000000001`. Landed hesaplanamıyorsa boş kopya TL fiyatlarını siliyordu. Aşağı doldurma
  da aynı yoldan geçiyor.
  - v7.81 kullanıcı kararı korunmalı: dışarıdan yapıştırılan **tek değer** `trPrice`'a yazılır
    (`tests/collection-derived-cell-clipboard-v781.test.js`).
- Düz metin kopyada hesaplanan para değerleri ham geliyordu: `8.19`, `9.801300000000001`.
  Hedef Fiyat ise `9,20` biçiminde geliyor.

## Bu WIP commit'inde YAPILANLAR (doğrula, tamamla)
`resources/app/public/app-main.js` ve `resources/app/public/collection-spreadsheet.js`:

1. **TR Landed ham kopya işareti**
   - `collection-spreadsheet.js` → `selectedMatrix()` içindeki `rawLine`, `trLanded` hücresi için
     `bridge().landedCopyToken(rowId)` yazıyor. Değer `BL-TR-LANDED:<rowId>` biçiminde.
   - Izgara içi kopyala/yapıştır ve aşağı doldurma (`fillDown` rawMatrix kullanır) bu işareti taşır.
   - `app-main.js`:
     - `KOL_TR_LANDED_COPY_PREFIX` sabiti eklendi.
     - `kolSpreadsheetValidateValue` içinde işaret dalı var; dönüş `{__trLandedSourceId}`.
     - `kolSpreadsheetBatchEdit` içinde kaynak satırın `trPrice`/`trFx`/`trLandedMult` değerleri
       hedefe `kolApplyCollectionCellChange` ile yazılıyor.
     - Bridge'e `landedCopyToken` eklendi.
   - **Test edilmedi; gerçek uygulamada doğrula.**
2. **Kopya biçimi**
   - `kolCopyMoney()` eklendi.
   - `kolSpreadsheetRawValue` içinde Best, onaylı fiyat, YD Landed ve TR Landed artık `9,80`
     biçiminde dönüyor.
3. **Fiyat ayrıntı alanları (tek kaynak)**
   - Eklenenler: `KOL_PRICE_DETAIL_FIELDS`, `KOL_PRICE_DETAIL_BY_KEY`, `kolPriceDetailValues()`
     (render başına `WeakMap` önbellek, `kolPriceDetailCache`), `kolPriceDetailRaw/Text`,
     `KOL_PRICE_DETAIL_NUMFMT`, `kolExpandPriceDetails()`, `kolExportDescriptors()`.
   - Alanlar çapa sütunun sağına eklenir:
     - En iyi üretici, teklif sayısı, hedefe fark %
     - Supp. FOB kaynağı, Supp. FOB, FOB + royalty/hologram
     - YD çarpanı
     - TR fiyatı (TL), kur, TR fiyatı (USD), TR çarpanı, avantaj %
     - Endeksmatik: eski/yeni fiyat USD/TL, endeks ve hedef endeks YD/TR, düzeltme %, dönem
   - `input:true` olanlar (`trPrice`, `trFx`, `trLandedMult`, `ydLandedMult`) mevcut
     `KOL_LANDED_INPUT_COLS` alanlarıdır ve düzenlenebilir.
4. **Maliyet görünümü**
   - `kolDisplayDescriptors` Maliyet modunda `kolExpandPriceDetails` uygular.
   - Hücre çizimi: `kolPriceDetailCellHtml` (girdi alanları `editCell kolLandedInput` input).
   - `kolPlainLandedCellHtml`: Maliyet modunda TR/YD Landed hücresi sade sonuç gösterir, girdiler ayrı
     sütunlardadır.
   - Başlık: `kolPriceDetailHeader`.
   - Bunların da kalıcı sütun sırasına girmemesi, sürüklenmemesi gerekir (`viewColumn`).
   - `kolDescriptorByKey`, `kolColumnGroupFor`, genişlik, `kolCollectionRawCellText`,
     `kolSpreadsheetRawValue` ve `kolSpreadsheetColumnMeta` bu türü tanıyor.
   - `kolSpreadsheetRawValue` girdi anahtarları için saklanan değeri döner.

## YAPILACAKLAR (sırayla)
### A. Bitir ve doğrula
1. **Excel'e aktarma (`kolExportWithImages`)**
   - `descriptors=kolDisplayDescriptors({detail:true})` yerine `kolExportDescriptors()` kullan.
   - Döngüye `d.kind==='priceDetail'` dalı ekle:
     - Metin değil ise `kolPriceDetailRaw` ile sayı yaz.
     - `numFmt = KOL_PRICE_DETAIL_NUMFMT[type]`, sağa hizala.
     - Metinde `kolExportSingleLineText`.
   - Bu dal mevcut `const c=d.col` erişiminden **önce** olmalı.
2. **Excel'e ikinci sayfa "Teklifler" / "Quotations"**
   - Model × üretici teklif matrisi. Sütunlar:
     - Model, PLM ID, renk
     - Hedef, Best, Best üretici, onaylı üretici, onaylı fiyat
     - Her üretici bir sütun: kapsama göre azalan, eşitlikte kazanma sayısı
   - En iyi hücre yeşil, onaylı hücre kalın. TR/EN sayfa adı.
3. **Satır kopyası**
   - `buildCollectionStyledCopy` şu an `meta.colsFn()` (görünüm) kullanıyor; `kolExportDescriptors()`
     kullansın.
   - `clipboardStyleFor` priceDetail sayı alanlarını sağa hizalasın.
   - **DİKKAT:** `TABLE_META.kolTable.colsFn` görünüm tanımlayıcısı kalmalı; çünkü Ctrl+C hücre
     aralığı kopyası DOM indeksleriyle eşleşir (`app-main.js` ~13550).
4. **LCW AI bağlamı**
   - `kolDisplayDescriptors({ all, detail: true })` kalabilir.
   - Ayrıntı alanlarını AI bağlamına da eklemek istenirse `kolExpandPriceDetails` uygula; ama
     `lcwai-dynamic-columns` testi sütun listesini birebir doğrular, gerekirse güncelle.
5. **Kırık iki test (WIP kaynaklı, beklenen)**
   - `tests/collection-derived-cell-clipboard-v781.test.js:49` (regresyon kilidi): test
     `kolSpreadsheetRawValue` gövdesinde
     `c.endeksmatik.*endeksmatikExcelText(kolEffectiveEndeksmatikRow(row))` arıyor. Gövde kesitini
     ve Best/Conf/landed eşleşmelerini oku; dallar duruyor, yalnız biçim değişti. Testin koruduğu
     gerekçeyi bozmadan yeni `kolCopyMoney(...)` biçimine hizala.
   - `tests/collection-price-view-v20261022.test.js:61`: `kolDisplayDescriptors` artık
     `if(opts.all||opts.detail)return list;` ve Maliyet'te `kolExpandPriceDetails` uyguluyor.
     İddiayı yeni biçime güncelle.
   - Excel iddiasını `kolExportDescriptors()` olarak değiştir.
6. **Yeni testler**
   - `KOL_PRICE_DETAIL_FIELDS` / `kolExpandPriceDetails` canlı birim testi (vm ile kesit):
     çapa sırası, Kompakt şeridin `folds` çapaları, görünmeyen çapa ayrıntı doğurmaz.
   - TR Landed işareti: validate dalı ve batch yazımı (kaynak satırın girdileri), dışarıdan tek değer hâlâ
     `trPrice`.
   - `kolCopyMoney` biçimi.

### B. Kalabalık fiyatlama düzeni (30 model × 20 üretici) — çözüm tasarımı
Ölçüm: Masa'da 1600 px ekranda yalnız 5 üretici görünüyor; tablo ~3.300 px kayıyor; en iyi /
onaylı / Δhedef sütunları en sağda kalıyor. Koleksiyon şeridinde 17 nokta üst üste biniyor.
Turlar listesi 120 satıra uzuyor. Çekmece 20 teklifi iyi gösteriyor.

**Konumlandırma ilkesi:** üretici, "kaç modele fiyat verdi"ye göre değil, "fiyat verdiği modellerde
ne kadar rekabetçi" olduğuna göre yer alır. Kapsam ikincil bilgidir.

1. **Üretici karnesi başlığı (Masa, `pricing-desk.js` matris başlığı)**
   - Her üretici başlığında şunlar yer alır:
     - kapsam `5/20`
     - kazandığı model sayısı (en iyi teklif)
     - aynı-model fiyat endeksi: verdiği modellerde o modelin teklif ortalamasına göre %
       (`pricing-desk-engine.js`'e saf fonksiyon olarak ekle ve test et; `analyze().suppliers`
       içinde `modelIndex` zaten var, yeniden kullan)
   - Böylece 5 modele fiyat verip 3'ünde en ucuz olan üretici öne çıkar.
2. **Sütun sırası:** kazanma sayısı ↓, sonra endeks ↑ (daha ucuz önce), sonra kapsam ↓. Onaylı
   satırı olan üretici her zaman görünür grupta kalır.
3. **"Diğer üreticiler" katlama**
   - Üretici sayısı > 8 ise görünür grup: ilk 8 + kazananı olan veya onay taşıyan her üretici.
   - Kalanlar tek bir "Diğer (n)" sütununda toplanır. Hücre o modeldeki en iyi "diğer" teklifi ve
     üreticisinin adını gösterir; tıklayınca sütunlar açılır.
   - Tercih model başına değil, talep başına hatırlanır (`lcw.pricingDesk.` öneki zaten kullanıcıya
     ayrılmış).
4. **Sabit özet sütunları:** Model, Hedef, En iyi / Onaylı, Δ hedef solda yapışkan
   (`position:sticky`); üreticiler sağda kayar. `pdModelCell` zaten sticky; diğerlerine sol ofset
   ekle.
5. **Kompakt hücre:** üretici hücresi ~96 px. ✓ / × düğmeleri hover/focus'ta görünür; boş hücre
   soluk tek çizgi. 30 satır için görsel 36 px.
6. **Koleksiyon şeridi (`kolPriceStripCellHtml`):** noktalar yerine en düşük–en yüksek bandı +
   ortanca çizgisi + hedef işareti + en iyi/onaylı işareti. Metin aynı kalır.
7. **Turlar:** tur zaman çizelgesini modele göre grupla. Model başlığı (görsel + en iyi); altında
   üreticiler satır içi çipler halinde.
8. **Analiz ısı matrisi:** üretici sütunlarını aynı sıralamayla diz; >12 üretici varsa "İlk 12 /
   Tümü" anahtarı.
- Tasarım kuralları: `DESIGN_SYSTEM.md` token'ları, ham renk yok, `prefers-reduced-motion`, TR/EN
  (`L(tr,en)`), i18n baseline boş kalır.

### C. Teslim (CLAUDE.md §3.1, §4.2)
- Gerçek uygulamada doğrula. Demo veri: 20 üretici × 6 model talebi.
  - Kontrol et: TR Landed kopyala/yapıştır, aşağı doldur, Maliyet görünümü, Excel dosyası (iki
    sayfa), satır kopyası, 20 üretici Masa.
- `resources/app/public/release-notes/next.json` içine TR+EN kayıtlar ekle. Her biri gerçek, değişiklik
  sonrası PNG ekran görüntüsü taşımalı (≥900×360, oran 1.2–3.2, demo veri).
  - fix: TR Landed yapıştırma
  - improvement: ayrıntılı dışa aktarım + Teklifler sayfası
  - feature: Maliyet ayrıntı sütunları
  - improvement: kalabalık fiyatlama düzeni
- Komutlar:
  - `npm run release:notes:validate`
  - `npm run i18n:check`
  - tam `npm test` (son koşu: 7181 geçti / 0 hata / 65 atlandı)
- PR aç, CI otomatik koşmaz; yerel test çıktısını PR'a yaz. Birleştir. TEST/STABLE tetikleme.
- `server/*.js` değişirse yeniden başlatma notu ekle. Bu dosyayı PR'dan önce sil.

## Notlar / tuzaklar
- Çekmece ve paneller içinde `<section>` kullanma; global kural gizliyor.
- `user-storage.js` + `server/lib/user-preferences.js`: yeni BLStorage anahtarı eklersen
  kişisel/eşitlenen listeye ekle (`tests/user-storage-isolation.test.js`).
- i18n bekçisi: JSON/dizi metinlerinde `;` dizi algısını bozuyor; virgül kullan.
- Kopya kısayol testleri için Playwright bağlamına `permissions:['clipboard-read','clipboard-write']`
  ver.
