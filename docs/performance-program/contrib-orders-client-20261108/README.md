# Orders istemci transport katkısı / Orders client transport contribution

Başlangıç: `d66c1f803097af5991616f0420392e1027888f2e` (`prep/parallel-performance-handoff-20261108`). Katkı dalı: `contrib/phase6a-orders-client-20261108`. Hazırlık yeniden üretilmedi; `../parallel-handoff-20261108/01-orders-client` devralındı. Uygulamada etkinleştirme, PR, merge, TEST veya STABLE yok.

EN: The prepared helper is adopted as an inactive browser/CommonJS library, with its original 31 test bodies preserved in the normal regression runner. This is a library delivery, not Phase 6a or application acceptance. No application speed improvement is claimed.

## Değişiklik ve çağrı sözleşmesi

- `resources/app/public/orders-projection-client.js`: hazırlanan UMD/CJS helper. Gerçek finite compiler, schema reader, formula runtime ve full promotion helper enjekte edilir; yeni inventory, parser, cache, worker veya formula/promotion motoru yoktur. Hazırlıktan davranış farkı: full-parent fetch/decoded stream/hash await noktalarından sonra abort tekrar denetlenir. Hash sırasında iptal RED testiyle sabitlendi.
- `resources/app/tests/orders-projection-client.test.js`: eski 31 testin gövdesi byte olarak aynı. Yeni `fixtures/orders-projection-client/runtime.cjs` yalnız gerçek repo dosyalarını `__dirname` üzerinden bulur; `/tmp` veya başka checkout/env override zorunluluğu yoktur. Orijinal snippets/guard recipe ve mevcut ortak fixture/source-pin dosyaları okunur, değiştirilmez. Fixture factory enjeksiyonu ve mevcut cold fixture'ın aynı 30k yükte kullanılabilmesi yalnız bu yeni fixture'dadır.
- `resources/app/tests/orders-projection-client-transport.test.js`: 10 ek test; tarihsel makbuz hash'leri/31 gövde eşitliği, tarayıcı export'u, retained presence/value/key order, unowned request, eksik/omitted/getter alanı, root'un bildirdiği extra demand, bağımsız header kontrolleri, 409, bounded/truncated/oversized stream, abort, bağımsız raw hash ve gerçek promotion/ordinal seçimi.

`create()` → `initializeFull()` / `prepare()` / `accept()` / `invalidate()` ve `createFetchFull()` aynı API olarak korunur. `identity()` yalnız header biçimini okur; tek başına yetki kanıtı değildir. Beklenen identity yanıt kanıtı olarak kopyalanmaz: full-parent sonucu gerçek header'lardan, güncel özel UI epoch/plan'ından ve okunan raw byte hash'inden türetilir. Promotion kendi byte kopyasını tekrar hash'ler ve beklenen kimlikle karşılaştırır. Gzip checksum ayrı parent pin'idir; raw JSON SHA değildir.

Metadata/schema/owner/actor/access/page+broader context/generation/nonce/plan doğrulamaları ve her satırın descriptor/anahtar denetimleri korunur. `plan.fields` satırların retained **union**'ıdır; her satırda zorunlu anahtar listesi değildir. Modül satırları yeniden kurmaz; sparse presence, duplicate business ID, `null/false/0`, own `__proto__` ve mevcut anahtar sırası korunur. Promotion'a sparse satırlarda kanıtlanmamış union `requiredKeys` diye verilmez; testler `requiredKeys: []` kullanır.

`readCurrent`, `captureCold`, `waitCold`, settlement ve publication root'a ait güvenilir adaptörlerdir. GUARDS/BARRIERS sabitleri veya callback'in varlığı gerçek UI kapanışını kanıtlamaz. Eksik/belirsiz capture `initializeFull`/`prepare` için ordinary full döndürür; `accept`/promotion doğrulama hatasında root thin sonucu yayımlamamalı, uygun full/retirement yoluna gitmelidir. Settlement callback hataları saklanmaz.

İlk ordinary full ve ready gövdesinin bounded decoded-byte okuması, raw byte'ların **tek** JSON.parse sonucu ve hydration öncesi sahipliği root'un parser sınırıdır. Bu modül `initializeFull` için kendisine verilen başka bir row graph'ının aynı raw text'ten geldiğini ispatlayamaz. `createFetchFull`, mevcut `orders-full-promotion.readDecodedBytes` ile en fazla 128 MiB / 50k satır kimliği ve tam decoded length sınırını uygular; unbounded `response.text()` önerilmez.

## Doğrulama ve korunmuş başarısız kanıtlar

Tüm test/ölçüm koşuları aynı VM'de `/tmp/buyerlog-performance-measurement.lock` altında seri çalıştırıldı. Yalnız sentetik demo veri ve yerel mock HTTP/Chromium kullanıldı; gerçek servis/credential yoktur.

- Son normal runner: `npm test -- orders-projection-client`, **41 PASS, 0 FAIL**, 2 dosya; `client-final.txt` ve `final-validation.json`.
- İlgili normal runner: `orders-projection-client orders-finite-closure orders-finite-schema orders-full-promotion orders-ready-http i18n-coverage-guard`, **150 PASS, 0 FAIL**, 7 dosya; `related-green.log.gz`. Son ek extra-demand testi ayrıca yukarıdaki son 41 testtedir.
- `npm run i18n:check`: **0 eksik**, baseline `files: {}` ve değiştirilmedi; `i18n.txt`.
- Gerçek Chromium **154.0.8037.57**: native browser compiler/plan hash, full initialization, ready accept, sparse/duplicate ID ve gerçek adapter+promotion ile tam row JSON/ordinal seçimi geçti; `browser-result.json`. Script'ler Node globals olmadan yüklendi. Bu bağımsız modül smoke'udur; Buyer Log UI entegrasyonu değildir.
- `projection-ready-json.test.js`: mevcut ilk source-pin assertion'ı başarısız. Beklenen schema SHA `8fe23ec8…`, gerçek `1693e6a0…`. Her iki dosyanın da başlangıç commit'iyle aynı olduğu `inherited-pin.json` ile doğrulandı. Kalan 21 builder testi geçti. Ortak test/pin gevşetilmedi veya güncellenmedi; root incelemesi gerekiyor.
- İlk ilgili koşunun HTTP `listen EPERM 127.0.0.1` hatası sandbox kısıtıydı. Aynı HTTP testleri sandbox dışında geçti. Sandbox ayrıca Node test IPC detaylarını engelliyordu; `adoption-green.tap` dosya düzeyindeki ilk sonucu, `native-green.tap` 40 testlik ara koşuyu, son `client-final.txt` 41 gerçek assertion sonucunu saklar. Başarısız ilk koşu ve ayrıntılı tanı: `related.log.gz`, `related-diagnostic.tap.gz`.
- Yeni abort testinin başarısız olduğu `transport-red.tap.gz`, henüz modül yokken alınan `adoption-red.tap`, ölçüm fixture'ında yanlış client instance'ının initialize edilmesinden doğan `measurement-first-failed.log.gz` korundu. `measurement-initial/` ilk maliyet serisidir; son seride full text encode/hash ayrı raporlanır ve gerçek cold storage capture kullanılır. Güncel sonuç yalnız `measurement.json`'dır.
- Browser ilk denemelerinin sandbox socket ve file URL policy hataları korunur. Playwright nesne köprüsü own `__proto__` alanını kaybettiği için ilk closure kontrolü full kaldı; fixture, raw JSON'u tarayıcıda parse ederek düzeltildi. Üretim validator'ı gevşetilmedi. İlgili `browser-*-failed.log.gz` dosyaları korundu.

Tarihsel **30 PASS / 1 FAIL** ve düzeltilmiş **31 PASS** makbuzları orijinal handoff altında aynen durur:

- `../parallel-handoff-20261108/root-native-evidence/buyerlog-phase6a-orders-client-native-first/{native.tap,receipt.json}`: frozen gerçek header map'inden testte property silinmesi (`Cannot delete property 'X-Orders-Owner-B64'`). Helper/gerçek header producer hatası değildir.
- `../parallel-handoff-20261108/root-native-evidence/buyerlog-phase6a-orders-client-native-green/{native.tap,receipt.json}`: yalnız fixture header map'i mutable kopyaya alındıktan sonraki 31 PASS.

Yeni test bu makbuzların hash'lerini ve taşınan 31 gövdenin birebir eşitliğini kontrol eder. Bu 31 test gerçek renderer/quick-filter sınırının kapanışı sayılmaz. Tam regression bu katkıda çalıştırılmadı; son entegre kodda root çalıştıracak.

## 30k maliyet sonucu

`measurement.json` bütün örnekleri, min/max/medyanları, gerçek module/harness SHA'larını, demo/body SHA'larını, ortamı ve bellek gözlemlerini içerir. Linux x64, Node 24.19.0/WebCrypto, UTC; CPU kotası 4 çekirdek, bellek limiti 16 GiB, Node heap üst sınırı 4 GiB. Explicit GC/profiler yoktur. İlk iki prepare/accept ısınması dışarıda bırakılır; ölçümler tek süreçte seridir, bağımsız süreç A/B veya uygulama makrobench'i değildir.

Gerçek `generate-demo-data.build`, seed 7, `2026-11-07`; gerçek ASAS/Antrepo parser ve Orders builder. Gerçek parser ASAS satırlarına projection **öncesi** yedi açık sentetik model alanı eklendi (192–288 karakter / `0/false/null/''`; bir sparse kaynak alanı). 30.000 satır, 95 raw key union, 89 retained union, 2.670.000 retained own-key kontrolü. Bütün retained satırların anahtar sırası/değerleri tam karşılaştırıldı; kaynaklar değişmedi. Üretici, gzip, full graph ve doğruluk oracle maliyetleri thin kazancı sayılmaz. Setup 11,70 s; süreç full oracle graph'larını tutar, retained-heap kazancı iddiası yoktur.

| Ölçü | Medyan ms | Örnek |
| --- | ---: | ---: |
| Actual capture callback | 0,35 | 9 |
| Warm prepare | 13,48 | 9 |
| Ready accept, tüm doğrulamalar dahil | 349,22 | 9 |
| Yalnız gerçek satır doğrulama döngüsü | 250,07 | 9 |
| Assert current | 0,65 | 9 |
| Full initialize, gerçek boş formula migration dahil | 724,68 | 9 |
| Cold prepare, gerçek user-storage/capture | 5,05 | 9 |
| Full text UTF-8 encode + raw SHA callback | 292,82 | 10 |
| Full raw byte SHA, hazır byte'lar üzerinde | 80,85 | 9 |
| Ready raw byte SHA | 64,49 | 9 |
| Full JSON parse | 253,42 | 9 |
| Ready JSON parse | 254,00 | 9 |
| Full'e geçiş, adapter + gerçek promotion | 1.320,97 | 5 |

Satır döngüsü tanısı sadece bellekte iki clock çağrısı eklenen **aynı** üretim döngüsüdür; 349,22 ms accept ölçümü değişmemiş modüldür. 250,07 ms, 30k satırda yaklaşık 8,34 µs/satırdır; kabul maliyetinden çıkarılmadı. Ayrı seri medyanları birbirinden çıkarılarak kesin stage maliyeti üretilmez.

Cold serisi gerçek `user-storage.js` ve eski packet capture'ını, sıfır sentetik native anahtar / üç gerçek audit read ile kullanır; hydration promise yerel olarak tamamlanmıştır. Tarayıcı storage maliyeti, bekleyen gerçek hydration ve remote sync başarısı burada ölçülmez. Full promotion 128 MiB sınırı, stream allocation, adapter raw hash, helper'ın byte kopyası ve **ikinci** raw hash'i, parse, her satırın shape/ordinal/selection doğrulamasını içerir. Normalizer bu maliyet serisinde identity'dir; gerçek hydration/render ek maliyettir.

Full/ready raw gövdeleri 85.897.848 / 74.865.254 byte; kontrol gzip level 4 gövdeleri 6.423.788 / 5.823.833 byte'dır. Bunlar gerçek HTTP transfer ölçümü değildir. Ready parse daha hızlı çıkmadı; accept ek bir maliyettir. **Uygulama hızlanması veya net kazanç iddiası yoktur.** Doğrulamalar performans uğruna azaltılmadı.

Tekrar üretim (repo kökünde, başka test/benchmark çalışmıyorken):

```sh
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock env TZ=UTC node --max-old-space-size=4096 docs/performance-program/contrib-orders-client-20261108/measure.cjs
# playwright kurulu ortamda; CHROMIUM_PATH isteğe bağlıdır:
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock node docs/performance-program/contrib-orders-client-20261108/browser-check.cjs
```

## Root'a kalan dış değişiklikler

1. Gerçek `readCurrent`/cold capture, renderer closure ve bütün mutation initiator/sink kapıları; pending await'lerde retirement/current kontrolü; lazy loader ve publication. Root'un gerçek UI capture/mutation kapıları **tamamlanmadı**.
2. `quick-filter-groups` gizli model alanlarından sayım yapabilir. Root gerçek extra config/alan bağımlılıklarını `filterKeys`/`operationKeys` gibi gerçek demand'a ve değişiklik capture'ına eklemeli veya ordinary full kalmalı. Packet'in eski capture snippet'i yeterlilik kanıtı değildir. Ek test yalnız root'un bildirdiği hidden extra demand'ın compiler tarafından tutulduğunu gösterir.
3. Cold sıfır-formula ilk uygun kapsamdır. İlk ordinary GET'in gerçek owner/actor/access/source binding seam'i bu base'de yoktur; yalnız page generation ile initialization yapılmaz. Initialized nonempty-formula etkinleştirmesi, gerçek full settlement/migration, ilk-full kimliği ve UI kapıları sağlanana kadar kapalıdır.
4. Root ilk full/ready için bounded raw parser sahipliğini, full-parent promotion'da özel UI epoch/plan ve parent receipt'i bağlamalı; kaynak/yetki/owner/session değişiminde emekliye ayırmalıdır. Eski pending action'a yeni full snapshot kopyalamamalıdır.
5. Mevcut `projection-ready-json` schema source-pin'i gerçek source farkı incelenerek root tarafından ele alınmalı. Bu katkı ortak pin/test/canonical/server dosyalarına dokunmaz.
6. Root entegre kodda bütün batch'lerle son regression, gerçek UI/eşdeğerlik/makrobench ve P1 incelemesini yapacak. Windows/Electron, gerçek servis, uygulamada thin etkinleştirme ve release kabulü bu teslimde yoktur. Görünür entegrasyonun release-note/gerçek PNG işi de root kapsamındadır.
