# #885 — katalog fixture düzeltmesi ve tam regresyon denetimi

**Beş `createComputeReadGuard` hatası kapandı. Tam regresyon hâlâ kırmızı;
push, PR merge, yeni benchmark ve TEST/STABLE yayını yapılmadı.**

EN: All five catalog-fixture ReferenceErrors are fixed. Full regression remains
red; no push, PR merge, new benchmark or TEST/STABLE publication occurred.

## Kaynak ve dar kapsam

- Sabit inceleme: `69950f289a012f0bb7c61290bec9890f340f6c64`.
- Önceki yerel head: `d876f26a`; Main #892 entegrasyonu ayrı
  `1d8572056887558e4dbaa2ca57dca48e4d68f80e` commit'indedir.
- Test/CI düzeltmesi: `bcc072542b0dd57bb14c5c330f3a44347ed63c45`.
- Dal: `perf/phase-5-server-integration`. Rebase/force-push yok.

Bu delta yalnız üç mevcut test fixture'ını, ortak test yardımcısını, iki native
worker testini ve PR fast-check kapsamını değiştirir. Üretim dosyaları,
`app-main.js`, Claude dosyaları, test runner, i18n baseline ve 38 sürüm notu
önceki head ile byte-eşdeğerdir. Korunan dosyaların SHA'ları manifesttedir.
Görünür üretim değişikliği olmadığı için yeni release note/PNG eklenmedi.

## İlk beş RED: ad, gerçek hata ve çağrı zinciri

Her hata aynı mesajı verdi: **`ReferenceError: createComputeReadGuard is not defined`**.
Tablodaki konumlar RED kaynağına aittir.

| Dosya / başlangıç | Başarısız test adı |
| --- | --- |
| `client-computation-performance.test.js:19` | real projection worker and server share complete v3 catalog semantics across canonical fields |
| `collection-asas-excel-grid-v489.test.js:23` | v4.89 Collection option catalogs are produced once from ASAS-backed Orders rows |
| `collection-product-main-definition-suggestions-v829.test.js:23` | Collection Product Main Definition önerileri gerçek ASAS canonical kaynağından distinct üretilir |
| `collection-product-main-definition-suggestions-v829.test.js:78` | raw ASAS normalized row -> lightweight Overview -> Collection catalog zinciri Product Main Definition değerini düşürmez |
| `collection-product-main-definition-suggestions-v829.test.js:115` | server eski/partial collection-catalog projection cache şemasını reddeder |

İlk zincir: test → `serverCatalog` → `new Function` (`:11:10`) → eval
`<anonymous>:202:24` → araya giren `computeReadGuard` başlangıcı.
Diğer dört zincir: test → `extractBetween` ile oluşturulan factory →
`new Function` (`:25:19`, `:80:19` veya `:117:19`) → aynı eval konumu.
Tam hata metni ve Node stack'leri
[original-five-failures.json](phase-5-catalog-fixture-artifacts/original-five-failures.json)
ile RED logunda korunur; önceki teslimin RED arşivi de değiştirilmedi.

**[Doğrulandı]** Sunucu `createComputeReadGuard`'ı gerçek modülünden içe alır;
başlangıçta `userAccess.sessionProfile`, `profileById`, `hasArea`,
`computeReadContext`, `computeAccessContext` ve `computeSourceToken` ile bağlar.
Katalog fonksiyonlarının tek bağımlılığı gerçek `collectionCatalog` modülüdür.
Eski fixture, `const COLLECTION_CATALOG_FIELDS` ile `async function buildResponse`
arasındaki bütün metni çalıştırdığı için araya eklenmiş compute servislerini
de bu bağımlılıkları sağlamadan başlatıyordu. Hata katalog assertion'larından
önce oluşuyordu; üretimde eksik guard bağlantısı değildi.

## Düzeltme ve korunmuş kontroller

Ortak `tests/helpers/server-collection-catalog.js`, gerçek sunucudan katalog
binding/completeness tanımlarını ve `buildCollectionCatalogs` yönlendirme
fonksiyonunu seçer; gerçek ortak modülle çalıştırır. Katalog oracle'ı testte
yeniden yazılmaz; guard taklidi, koşulsuz izin, hata yutma veya skip eklenmez.
Guard/servis/route testleri gerçek guard modülünü sınamayı sürdürür.

Fixture düzeltmesi beş ReferenceError'ı kaldırdı; ara koşuda 32 testin 30'u
geçti, iki testte daha önce erişilemeyen eski kaynak eşleşmeleri ortaya çıktı.
Kullanıcı **“Eşdeğer veya daha güçlü assertion'larla güncelle”** yanıtıyla
bu iki testin kaynak assertion'larını uyarlamayı onayladı. Yalnız dört eski
kaynak eşleşmesi bugünkü sunucu/worker sahipliğine uyarlandı. Diğer bütün eski
veri, canonical alan, distinct, sıralama ve şema assertion'ları aynen korunur.

Ek native kontroller, mevcut ortak worker havuzunda şunları doğrular:

- Yeni katalog, yetkili Buyer'ın ASAS Orders hedefinden üretilir; farklı CP
  hedefi ve yabancı Buyer katalog değerlerine sızmaz.
- Doğrulanmış Orders gzip'i yeniden kullanıldığında tam katalog gerçek sunucu
  üreticisiyle eşittir; ikinci Orders projection'ı üretilmez.
- `cpAllowed:false`, dolu yeniden kullanım girdisiyle bile boş katalog döndürür.
- Sürümü eksik, v1/v2, eksik manufacturer'lı v3 ve desteklenmeyen v4 katalog
  yanıtları `needsRebuild:true` ister. Tam v3 yanıtı birebir döner.
- Cached envelope yolu okunamayan ham replica dosyasına başvurmaz.

## Hedefli doğrulama ve önceki kapsam açığı

**9 dosya / 39 test PASS; fail/skip/cancel 0.** Aynı paket üçüncü taraf paket
yüklemeleri reddedilen ayrı bir Node koşusunda da 39/39 geçti; yeni CI adımı
`npm ci` gerektirmeyen mevcut hızlı kontrol modeliyle uyumludur. Bu yerel kanıt
GitHub CI başarısı değildir.

Önceki 51 dosyalık paketin filtreleri `cp-decision-input-revision`, kişisel
CP/checklist testleri, `compute` ve `global-flow` idi. Runner dosya adında OR
eşlemesi yapar: üç katalog dosyasının adı bu filtrelere uymadığı için seçilmedi.
Örneğin `client-computation-performance`, `compute` alt dizgesini içermez.
Tam test ilk batch'te bu yüzden hedefli paketin kaçırdığı hatalara ulaştı.
Yeni 9 dosyalık katalog/guard/CP paketi hem açıkça çalıştırıldı hem
`buyerlog-pr-fast-checks.yml` içine ayrı bir adım olarak eklendi.

```sh
npm test -- client-computation-performance collection-catalog collection-asas-excel-grid-v489 collection-product-main-definition-suggestions-v829 compute-read-guard compute-read-service compute-projection-route-wiring compute-bulk-projection-wiring cp-decision-input-revision
npm run i18n:check
npm run release:notes:validate
npm test
```

i18n **0 yeni / 0 baseline**; release-note validator **38 PASS**.
#892'nin ayrı `_cpDecisionInputRevision` sayacı ve kişisel bağlam/Orders-only
istisnaları mevcut VM testinde geçti. Bu üretim bloğu değiştirilmedi.

## Bütün 10 batch'in gerçek sonucu

Standart `npm test` 3. batch sonunda **exit 1** ile durdu. Kalan 7 batch,
değiştirilmemiş runner'ın planlama kısmından alınan aynı dosya listeleri,
`--test-concurrency=4`, `BUYER_LOG_TEST_SUITE=1` ve native Node komutlarıyla
sırayla tamamlandı. Runner/test/exit-code kapısı değiştirilmedi. Bu devam
koşuları başarısız `npm test`'i başarılı yapmaz.

| Batch | Dosya | Geçti | Başarısız | Atlandı | Sonuç / kaynak |
| --- | ---: | ---: | ---: | ---: | --- |
| 1 | 300 | 1.738 | 0 | 60 | PASS — npm test |
| 2 | 300 | 2.329 | 0 | 3 | PASS — npm test |
| 3 | 300 | 2.046 | 6 | 0 | FAIL — npm test |
| 4 | 300 | 2.002 | 2 | 1 | FAIL — native devam |
| 5 | 84 | 668 | 6 | 0 | FAIL — native devam |
| 6 | 1 | 4 | 0 | 0 | PASS — native devam |
| 7 | 1 | 12 | 0 | 0 | PASS — native devam |
| 8 | 1 | 8 | 0 | 0 | PASS — native devam |
| 9 | 1 | 8 | 0 | 0 | PASS — native devam |
| 10 | 1 | 14 | 0 | 1 | PASS — native devam |
| **Toplam** | **1.289** | **8.829** | **14** | **65** | **FAIL; iptal 0** |

Atlanan testler geçer sayılmadı. Tam dosya listeleri, gerçek argümanlar,
exit kodları ve runner SHA'sı
[full-batch-results.json](phase-5-catalog-fixture-artifacts/full-batch-results.json)
içindedir; devam script'i de arşivlenmiştir.

## Yeni hataların ayrımı — kapsam genişletilmedi

13 hata aşağıdaki mevcut kaynak-kod assertion'larındadır. Bu testler ve
inceledikleri üretim kaynakları son test-only delta'da değiştirilmedi.
Mesajdaki kaynak eşleşmesinin eksikliği doğrulandı; bu açıklama ilgili ürün
davranışının eşdeğerliğini tek başına kanıtlamaz. Bu kontroller yeşil sayılmaz.

| Test dosyası | Hata / beklenen kaynak sözleşmesi |
| --- | --- |
| `matching-rule-v439` | Backlog Excel route'unda `const prepared=backlogQueryForRequest(req,filterOpts)` bulunamadı |
| `module-first-open-perf-v251` | Önceki SHA1 `rowsRevision` üretim ifadesi bulunamadı |
| `order-importance-v20261021` | Excel route'unda `BLOrderImportance.excelValues(overrides.importanceSettings)` bulunamadı |
| `orders-page-v471` | Önceki satırlarla inline orders/order-summary nesnesi bulunamadı |
| `orders-summary-split-v20260926` | Inline `'order-summary': { rows: orderSummaryRows }` bulunamadı |
| `page-cache-reuse` | İki eski `ensureBacklogRuntime` çağrısı beklenirken 0 bulundu (`0 !== 2`) |
| `startup-complete-local-first-v781` | Önceki `runExcelTask('loadFxWorkbookFromDirectories'` çağrısı bulunamadı; FX tanısı yeniden başlatılmadı |
| `startup-trivia-v20261001` | Loading-state ifadeleri eski `fetchBacklog` gövdesinde aranıyor |
| `unified-refresh-link-group-v20260929` | Aynı eski `fetchBacklog` gövde eşleşmesi |
| `v714-complete-performance` | Önceki `BL_PROJECTION_WORKER_MIN_ROWS` sembolü bulunamadı |
| `v714-performance-hardening` — startup | Önceki doğrudan `readProjectionCompressed(ctx.id, module, ctx.contextHash)` eşleşmesi bulunamadı |
| `v714-performance-hardening` — metrics | `firstUsableInteractionMs` yalnız app-main kaynağında bulunamadı |
| `v714-performance-hardening` — metadata | Geniş kaynak dilimi `imagemap/plmStyleLinks/modelImages` metinlerini içeriyor |

14. hata `user-data-temp-root-recovery` testinde global
`BUYER_LOG_LOCAL_DATA_ROOT` override'ı yüzünden beklenen recovery konumunun
seçilmemesidir (`false !== true`). Override olmadan kendi fixture'ıyla
**1/1 PASS** oldu. Bu ayrı sonuç, yukarıdaki tam koşudan hata düşürmek için
kullanılmadı; tam koşu 14 başarısız olarak korunur.

Önceki iki tam-test denemesi de arşivlidir: ilkinde global temp override,
testlerin kendi `/tmp` köklerine yazmasını engelledi; ikincisinde global auth
kökü bazı testlerin auth deposunu paylaşmasına yol açtı. Bunlar üretim veya
test değişikliğiyle giderilmedi. Override'lar kaldırıldı; ilgili
IAM/restore/Intake paketi **12/12 PASS** oldu. Başarısız loglar saklanır.

Reproduction için auth/temp/local override'larını bütün testlere zorlamak
yerine testlerin kendi izole köklerine izin verilir. Gerekli varsayılan
app/server/config yolları yine sentetik `/tmp` köklerine yönlendirilir;
gerçek veri/credential kullanılmaz. Guard ve durable-write kontrolleri
gevşetilmez.

Tam adlar, gerçek hata mesajları, çağrı zincirleri ve ilgili log bağlantıları:
[remaining-failures.json](phase-5-catalog-fixture-artifacts/remaining-failures.json).

## GitHub / yayın / ölçüm / karar

Yerel tüm kontrollerin geçmesi şartı sağlanmadığı için mevcut #885 dalına
push yapılmadı; bu delta için yeni GitHub checks sonucu yok. Yerel
Node-only CI doğrulaması uzaktaki checks yerine sunulmaz. #885 taslak kalır.
Test/CI düzeltmesi ayrı yerel commit'tir; sonraki belge commit'i yalnız kanıttır.

B1/FX açık. FX tanısı tekrarlanmadı, yeni resmî benchmark başlatılmadı,
refresh POST gönderilmedi. Önceki ölçüm JSON/log/profilleri ve SHA'ları korundu.
Sonraki resmî iki kol aynı #892 kodunu içermelidir; bu teslim ölçülmüş bir
kazanç iddiası taşımaz. 6a/6c/Faz 7 üretim uygulamasına geçilmedi.
PR merge, TEST ve STABLE yayını yok. Yeni bağımsız model turu yapılmadı.

[Tüm kanıtların SHA manifesti](phase-5-catalog-fixture-artifacts/manifest.json).
