# BL-028 · Del. Type override'ını kaynak önceliğine döndürme (tasarım; kod yok)

Durum: **Tasarım — ürün sahibinin uygulama kararı bekleniyor.** Tarih: 2026-11-27.
İlgili: #1241 (artımlı yama kuralı), #1243 (yazma niyeti), ADR-0003 §6H–§6I.

## Mevcut davranış [Doğrulandı: kaynak + gerçek tarayıcı]

- **"—" seçimi temizleme yapmıyor.** Hücre boş değerle kaydedilir. `syncCpProductionLogisticSegment(row, '')` üretim segmentini `normalizeTransitDelType('') || norm('') || 'Gemi'` → **Gemi** yapar ve satırın Del. Type'ı segmentten yeniden yazılır. Kayıt gövdesi `delType: 'Gemi'` gönderir; sunucuda `delmap` "Gemi" olur. Yani "—" varsayılanı manuel override olarak sabitler (ADR-0003 §6I madde 4).
- **Sunucu `null` ile silemiyor.**
  - `db.js` `patchOrderOverride` yalnız `patch.delType != null` ise yazar (`ov.delmap[oc] = patch.delType`).
  - `patchOrderOverrideRows` (`POST /rows`) yalnız `delType != null` ise yazar.
- **Kaynak önceliği** (`parse.js`):
  - **Üretim/kıtlık segmenti:** `backlogProductionDelType` = satır anahtarlı override (`order|model|renk`) → sipariş anahtarlı override → sistem varsayılanı **Gemi**. ASAS'ta bu alan için kaynak değer yok.
  - **IAS parsiyel segmentleri:** Kaynaktaki `Vasita Tanim` kullanılır. Override bu segmentlere hiçbir zaman uygulanmaz.
- **Toplu silme yardımcıları var:** `clearDeliveryOverrides` (hepsi) ve `clearDeliveryOverridesForOrders`.
  - Silme biçimi: `delete ov.delmap[key]` ve paylaşılan depoya `{ delivery: null }`.
  - **Gözlem [Doğrulandı: kaynak]:** Her başarılı veri yenilemesinden sonra `server.js` (~9891), etkin siparişler için `clearDeliveryOverridesForOrders` çağırıyor. Bu yalnız **sipariş kodu** anahtarlı override'ları siler; satır anahtarlı override'lar kalır. Bu ayrımın kasıtlı olup olmadığı belgelenmemiş [Bilinmiyor].

## Önerilen güvenli temizleme (uygulanmadı)

**Anlam:** Temizleme boş değer ya da "Gemi" kaydetmek **değildir**. Satırın manuel override'ı kaldırılır ve değer kaynak önceliği kurallarıyla yeniden hesaplanır. Bugünkü kurallarda bu, üretim bakiyesi için sistem varsayılanıdır. İleride varsayılan ya da kaynak kuralı değişirse satır onu izler; sabitlenmiş kalmaz.

1. **İstemci**
   - Ayrı ve açık bir eylem: "Kaynak değerine dön / Revert to source". "—" bu eyleme bağlanır.
   - Eylem `_delTypeWrite` niyetiyle `delType: null` gönderir.
   - Yerelde `delete state.overrides.delmap[lineKey]` uygulanır; segment, sunucu tam kurulumu gelene kadar varsayılanla eşitlenir.
   - Undo, önceki override değerini açık niyetle geri yazar.
2. **Sunucu, iki kayıt yolu**
   - `Object.hasOwn(patch, 'delType') && patch.delType === null` ise **yalnız o satırın anahtarı** silinir (`delete ov.delmap[lineKey]`). Paylaşılan depoya `{ delivery: null }` yansıtılır.
   - Diğer renklerin satır anahtarlarına dokunulmaz.
3. **Sipariş anahtarlı eski override varsa**
   - Satır anahtarını silmek, sipariş anahtarlı değerin yeniden görünmesine yol açar.
   - Sipariş anahtarını silmek diğer renkleri etkiler; bu yüzden **yapılmaz**.
   - Seçenek: satıra "kaynak" anlamında açık bir işaret (tombstone) yazmak. Gerekip gerekmediği ürün kararıdır. Bu tür eski anahtarlar her veri yenilemesinde zaten silindiği için durum nadir.
4. **Artımlı yama kuralı**
   - `patchTouchesLogisticSegments` bugün `patch.delType != null` kontrol ediyor; temizleme yamasını (`null`) **kapsamaz**.
   - Temizleme uygulanırken kural `Object.hasOwn(patch, 'delType')` olmalı. Aksi halde temizleme artımlı yola girer ve #1241 hatası geri gelir.
5. **IAS ve otomatik onay**
   - Parsiyel segmentler kaynaktan gelir, temizlemeden etkilenmez.
   - Ex-factory'nin otomatik yükleme onayı kuralları ayrı alandır, etkilenmez.
6. **Doğrulama planı**
   - Tam kurulum tabanlı açık beklenen değerler: override 'Uçak' → temizle → üretim 'Gemi' (varsayılan), Ant. Arrival = Ex-factory + Gemi transit günü.
   - Parsiyel segmentler değişmez; diğer rengin override'ı korunur.
   - Eski ve yeni kayıt yolları, iki kullanıcı ve undo/redo kapsanır.

## Açık sorular (ürün sahibi)

- "—" seçeneği "kaynağa dön" mü olsun, yoksa ayrı bir menü öğesi mi?
- Sipariş anahtarlı eski override durumunda satıra açık "kaynak" işareti yazılsın mı?
- Veri yenilemesinin yalnız sipariş anahtarlı override'ları silmesi kasıtlı mı?
