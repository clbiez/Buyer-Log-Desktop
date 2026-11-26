# ADR-0002 · Değer–kanıt sözleşmesi ("yok" ≠ "bilinmiyor" ≠ "değer")

- **Durum:** Önerildi · pilot uygulandı (yükleme onayı → Ex-Factory revizyonu, Backlog bakiyesi)
- **Tarih:** 2026-11-26
- **Risk sınıfı:** P1 (Ex-Factory revizyon hesabını değiştirir)

## 1 · Sorun

Kaynaklı/türetilmiş bir alan bugün çoğunlukla `null` ile üç farklı durumu taşır:
kaynakta karşılığı yok, kaynak hiç okunmadı ya da sütun yok, veya değer başka bir
kapsamdan (renk, sevkiyat) yanlışlıkla devralındı. Bu üç durumun karışması
geçmişte iki hata sınıfı üretti: bir rengin onayının diğer renge aktarılması ve
IAS kaydı yokken onay varsayılması.

## 2 · Karar: sözleşme

Kaynaklı veya türetilmiş her değer bir **kapsama** (ör. sipariş + model + renk,
IAS parsiyeli) bağlıdır ve şu üç durumdan birindedir:

| Durum | Anlamı | Kural |
|---|---|---|
| `value` | Yetkili kaynak bu kapsam için değeri kanıtlıyor | Kaynak ve kapsam bellidir; açıklama kural + girdiden yeniden üretilir |
| `absent` | Yetkili kaynak okundu, bu kapsam için karşılık yok | Değer varsayılmaz; **o değerden türeyen hiçbir şey de** uygulanmaz |
| `unknown` | Kaynak okunmadı, sütun yok veya veri eski | Güncel sayılmaz; `absent` gibi sessizce davranmak yerine görünür olmalı |

Uygulama kuralları:

1. **Ham alan korunur, hücre başına nesne saklanmaz.** Durum, kapsamı belirleyen
   bilgiden (segment türü, IAS eşleşmesi, sütun varlığı) okuma anında türetilir.
   "Bu değer neden böyle?" açıklaması saklanmaz; kural + girdiden yeniden üretilir.
2. **Türetilen değer, girdisinin durumunu devralır.** Bir girdi bir kapsamda
   `absent` ise, ondan türeyen değer (ör. onaydan türeyen Ex-Factory revizyonu)
   de o kapsamda uygulanmaz. Yalnız girdiyi `null`'lamak yetmez.
3. **`unknown` durum işareti veri kümesi düzeyindedir**, satır düzeyinde değil
   (ör. "ASAS dosyasında Buying Son Onay Tarihi sütunu yok").
4. **Kapsam dışına taşıma yok.** Değer yalnız kanıtlandığı kapsamda kullanılır;
   sipariş düzeyindeki bir kanıt, kanıtı başka bir sevkiyata ait olan alt
   kapsama (IAS'siz bakiye) taşınmaz.

## 3 · Pilot: yükleme onayı (`shipConf`) ve Ex-Factory revizyon engeli

### Zincir [Doğrulandı · source]

1. Üretim: `server/lib/parse.js` ASAS satırından `shipConf` (`Buying Son Onay
   Tarihi`; sütun yoksa `null`). Kapsam ASAS satırıdır (sipariş + model + renk).
2. Türetme: `applyDateOverrides` → `BLBusinessRules.resolveExFactoryDate`;
   geçerli onay varsa `order.ex = onay`, `_exFactoryRevision =
   {source:'loading-approval', previousDate: planlanan}`.
3. CP/Orders: `buildCPRowsFromASAS` / `buildOrdersRowsFromASAS`, istemcide
   `normalizeCPDates → applyCpApprovalDate` (`public/app-main.js`), sunucu
   aynası `server/lib/read-model/overview-row-prep.js` ve
   `server/lib/projection-row-patch.js`. Parite
   `tests/read-model-overview-parity.test.js` ile kilitli.
4. Backlog: `buildBacklogOperationalRows → backlogSegment` (sentetik bakiyede
   `shipConf: null`), `backlogTemplateRowsFromSegments` (Revize Ex-Factory,
   risk, transit, Excel meta).

### Bulunan gerçek karışma [Doğrulandı · test + gerçek HTTP]

IAS parsiyeli olan bir siparişte kalan bakiye (Üretimde / Eksik Yükleme /
Depoda) onayı **devralmıyordu** (`shipConf: null`), ama onaydan **türeyen**
Ex-Factory revizyonunu devralıyordu: `order.ex` zaten onay tarihine çekilmişti.
Sonuç:

- Bakiyenin "REVİZE YÜKLEME TARİHİ (EX-FACTORY)" değeri önceki sevkiyatın onay
  tarihiydi (demo: planlanan 2026-12-20 yerine 2026-11-02).
- Tahmini antrepo tarihi ve Retail gecikmesi riski bu geçmiş tarihten
  hesaplanıyordu; gerçek gecikme **gizleniyordu** (risk `VAR` yerine `YOK`).
- Ex-Factory filtresi bakiyeyi yanlış pencereye koyuyordu.

`tests/backlog-synthetic-approval.test.js` içindeki "removing synthetic approval
does not hide a genuine Retail delay" testi bu niyeti zaten kilitliyordu, ama
siparişleri `applyDateOverrides`'tan geçirmediği için gerçek akışı ölçmüyordu.

### Düzeltme (en küçük)

- `plannedExFactoryWithoutApproval(order)`: revizyon kaynağı yükleme onayıysa
  `previousDate`'i (ASAS ya da kullanıcı revizyonu) döner.
- `backlogSegment`: siparişin IAS parsiyeli varsa (`approvalConsumed`) sentetik
  bakiye `ex = planlanan`, `_exFactoryRevision = null` taşır. Kaynak sipariş
  nesnesi değişmez.
- Bakiyenin antrepo tahmini, şablon satırı (Revize Ex-Factory, risk, transit) ve
  sipariş ön-filtresi aynı değeri kullanır. Ön-filtre üst kümedir; kesin süzme
  segment düzeyinde kalır.

### Bilinçli olarak değişmeyenler

- **Hiç IAS kaydı olmayan sipariş:** onay siparişin tamamına aittir; Backlog dahil
  her yerde onay tarihi Ex-Factory olarak kalır
  (`tests/loading-approval-exfactory.test.js` bu ürün kuralını kilitler).
  [Muhtemel] ASAS onayı sipariş düzeyindedir, parsiyel ayrımı yapmaz.
- **CP/Orders ve app-main paritesi:** sipariş düzeyi Ex-Factory değişmedi;
  `normalizeCPDates`/`overview-row-prep` dokunulmadı, parite korunur.
  CP lojistik detayı (`_logisticSegments`) aynı Backlog segmentlerinden
  kurulduğu için bakiyenin tahmini varışı CP'de de planlanan tarihe döner
  (demo: 2020-03-11 → 2090-05-10) [Doğrulandı · Main/aday karşılaştırması].
  İstemci ve read-model bu tarihi yeniden hesaplamaz, sunucudan okur; parite
  etkilenmez.
- **IAS parsiyelleri:** onay ve onaydan türeyen Ex-Factory korunur.

### `unknown` durumu [Doğrulandı · source] — pilotta kod değişikliği yok

ASAS dosyasında onay sütunu yoksa (`shipConfHeader` bulunamazsa) tüm siparişlerde
`shipConf = null` olur; yani `unknown`, `absent` gibi davranır. Etkisi: değer
uydurulmaz (güvenli), ama otomatik revizyonlar **sessizce** planlanan tarihe
döner. Kullanıcıya sütun eksikliği uyarısı gösterilip gösterilmediği
[Bilinmiyor]. Öneri: satır başına değil, veri kümesi başına tek bir
"sütun mevcut" işareti ve kaynak sağlığı uyarısı (ayrı iş).

### Renk/kapsam taşıma [Doğrulandı · pilot zinciri]

`shipConf` her ASAS satırının kendi hücresinden okunur; tarih override'ları satır
anahtarıyla (sipariş + model + renk) eşlenir; yinelenen satır birleştirme imzası
`shipConf`'u içerir. Pilot zincirinde renkler arası taşıma bulunmadı. Diğer
modüllerdeki onay tüketicileri (ör. `public/manufacturer-cards-engine.js`
başlık takma adları) taranmadı [Bilinmiyor].

## 4 · Diğer alanlara yayma ölçütü

Bir alana sözleşme uygulanmadan önce şu üç soru sorulur; biri "evet" ise aday:

1. Alan bir **alt kapsama** (parsiyel, bakiye, renk, varyant) kopyalanıyor ve
   kanıtı yalnız bir alt kapsama mı ait?
2. Alandan **başka bir değer türetiliyor** (tarih revizyonu, risk, fiyat, statü)
   ve girdi `null`'landığında türetilmiş değer yerinde mi kalıyor?
3. Kaynak **sütun yokluğu / eski veri** ile "değer boş" aynı `null`'a mı düşüyor
   ve bu karar sonucunu değiştiriyor mu?

Öncelik: veri doğruluğunu ve risk kararını etkileyen alanlar (HANDOVER, Antrepo
giriş tarihi, Supp. FOB kaynak/kural meta'sı, statü). Her yayma ayrı PR,
önce gerçek akışı (override + segment) kullanan RED test.

## 5 · Bellek ve performans etkisi

- Yeni alan saklanmaz; sentetik bakiye segmentinde zaten var olan `ex` ve
  `_exFactoryRevision` anahtarları planlanan değerle yazılır. Satır başına ek
  bellek yok [Doğrulandı · kod].
- 30k demo fixture (`generate-demo-data`, 30.000 sipariş → 37.708 Backlog
  satırı), `applyDateOverrides` + `buildBacklogTemplateRows`, taban `d772bab`
  ile aday dönüşümlü 5 çift × 5 ölçüm: taban medyan **1919 ms**, aday medyan
  **1891 ms** (ham örnekler commit mesajında). İlk 3 çiftlik turda genel medyan
  aday aleyhine ~%8 çıktı ama çift medyanları −%1 / −%2 / +%2 idi; genişletilmiş
  turda fark kayboldu → gürültü. Değişen dal fixture'da 7.696 bakiye satırında
  çalıştı. L2 **PASS** [Doğrulandı · yerel ölçüm].

## 6 · Açık kararlar

- IAS parsiyeli siparişte ASAS onayının kalan bakiyeyi de kapsadığı bir iş akışı
  varsa (ör. onay tüm sipariş için verilip parsiyeller onu tüketmiyorsa) bu
  düzeltme yanlış olur. Bugünkü kod yorumu ("önceki yükleme onayı") ve mevcut
  test niyeti bunun tersini söylüyor [Muhtemel]; ürün sahibinin teyidi gerekir.
- Sözleşmenin `unknown` ayağı (sütun yokluğu uyarısı) bu pilotta uygulanmadı;
  ayrı iş olarak değerlendirilmeli.
