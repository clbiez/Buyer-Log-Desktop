# BL-028 · Del. Type override'ını kaynak önceliğine döndürme (tasarım; kod yok)

Durum: **Uygulandı** (`claude/bl-028-revert-source`, 2026-11-28). İlk tasarım: 2026-11-27.
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

## Uygulama (2026-11-28)

**Ürün kararları (ebeveyn oturum):**
- "—" bugünkü anlamını korur.
- "Kaynağa dön / Revert to source" ayrı bir menü eylemidir.
- Geçmiş kayıtlara toplu temizlik ya da migrasyon uygulanmaz.

**İstemci (`public/app-main.js`, `public/index.html`):**
- `revertCpDelTypeToSource`:
  - Niyet `_delTypeWrite={clear:true}`; gövde `delType:null` taşır (iki yolda).
  - Yerel `delmap` anahtarı silinir.
  - Üretim bakiyesi, tam kurulum gelene kadar sistem varsayılanına eşitlenir.
  - Geri al önceki değeri açık niyetle yazar; yinele yeniden temizler.
- Eylem yalnız satırın kayıtlı override'ı varken sunulur (`cpDelTypeHasOverride`). Bu bilgi `_cpStored` ya da onaylanmamış kendi düzenlemesinden gelir.
  - Kontrol **menü açılışında** yapılır, hücre çiziminde değil; büyük tablo render yolu değişmedi.
- Satır kaydı planı temizlemeyi `null` olarak taşır (`cpRowUnitAssign`); `''` yazılmaz.

**Sunucu (`server/db.js`):**
- `applyOrderPatch`: `delType === null` ise yalnız satır anahtarı silinir.
  - Satır kimliği yoksa `400 VALIDATION_ERROR` döner; sipariş anahtarı korunur.
- `cpRowUnits` null'ı kapsar. Alan bazlı CAS: bayat base çakışma alır, başkasının değeri korunur.
- Paylaşılan depoya mevcut `patchFromOrderPatch` ile `{delivery:null}` yansır.

**Artımlı kural (`projection-row-patch.js`, ayrı commit):** `Object.hasOwn(patch,'delType')`. Null temizleme de tam kurulum yoluna gider.

### Sipariş anahtarlı eski override ve veri yenilemesi

- **Yenileme temizliği:** `server.js` `clearDeliveryOverridesForOrders`, her başarılı veri yenilemesinden sonra etkin siparişlerin yalnız **sipariş kodu** anahtarlarını siler.
  - Kod ilk aktarım commit'inden (`f15966d`, 2026-09-20) geliyor. Git'te ya da belgelerde niyet kaydı yok [Bilinmiyor].
  - Davranış [Doğrulandı: kaynak + gerçek tarayıcı].
- **Sipariş anahtarının bugünkü kaynağı:** Güncel istemci her zaman satır kimliği gönderir. Sipariş anahtarı yalnız kimliksiz bir PATCH'ten (eski sürüm/API) ya da eski sürümlü bir eşten gelebilir [Muhtemel].
  - Etkin siparişte bu kayıt bir sonraki başarılı yenilemeye kadar yaşar.
- **Seçilen çözüm (güvenli sınırlama; yeni iş kuralı yok):**
  - Satır temizlenir ve kaynak önceliği (satır → sipariş → Gemi) aynen uygulanır.
  - Sipariş anahtarlı değer geçerliyse kullanıcıya bildirim gösterilir: "satır, bir sonraki veri yenilemesi onu kaldırana kadar o değeri izler".
  - Sipariş anahtarı silinmez; diğer renklere dokunulmaz.
  - Gerçek tarayıcıda: temizleme → "Gemi+Uçak" (sipariş anahtarı) + bildirim. Veri yenilemesinden sonra → "Gemi". Diğer rengin satır override'ı korundu.
- **Uygulanmayan alternatif:** Satıra açık "kaynak" işareti (tombstone).
  - Yeni bir iş kuralı ve veri temsili getirir.
  - Etkisi yalnız bir yenileme aralığıyla sınırlı nadir bir durum içindir.
  - Gerekirse ürün sahibi kararıyla ayrı iş olarak ele alınır.

### Doğrulama

- **Birim testleri:**
  - `tests/cp-deltype-revert-source-v20261128.test.js`: sunucu, tam kurulum tabanlı.
  - `tests/cp-deltype-revert-source-client-v20261128.test.js`: istemci.
  - `logistic-segment-incremental-safety` (null kapsamı).
- **Gerçek Buyer Log (demo veri, iki kayıt yolu, 3/3):**
  - Gövde `delType:null`.
  - Yeniden yüklemede üretim Gemi, Ant. Arrival 10.03.27 (Ex-factory 30.12.26 + 70).
  - IAS parsiyeli (Gemi, 24.12.26) ve diğer rengin `Gemi+Tır` değeri değişmedi.
- **Geri al / yinele:** gövdeler `Gemi+Uçak` / `null`.
- **İki istemci (canlı olay engelli, bayat sayfa):**
  - POST /rows: çakışma; eski PATCH: revizyon çakışması.
  - İki durumda da A'nın değeri korundu.
- "—" hâlâ `"Gemi"` gönderiyor.
- Kimliksiz `delType:null` PATCH → 400.
