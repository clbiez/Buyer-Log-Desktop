# Buyer Log — açılış varlıklarını özellik bazında yükleme

Tarih: 2026-11-07. SHELL-03 / SHELL-04. Kapsam: `app-main.js` çağrılarını değiştirmeden senkron JS ve blocking CSS azaltımı. Risk: açılış ve global kayıt sırası; iş verisi, hesaplama, yetki ve sunucu protokolü değişmiyor.

## Uygulama ve bağımlılık denetimi

| Taşınan dosyalar | Global / bağımlılık | Giriş ve sıra |
| --- | --- | --- |
| `buyerlog-guide-data.js`, `buyerlog-trivia-data.js`, `buyerlog-trivia.js`, `buyerlog-guide.js` | `BLGuideData`, `BLTriviaData`, `BLTrivia`, `BLGuide`; iki görünüm veriyi dosya değerlendirmesinde yakalıyor | `startupGuide`: rehber verisi → trivia verisi → trivia → rehber. Açılış perdesi aynı promise'i bekler; geç gelen rehber güncel kapıları, dili ve Devam düğmesini alır. Erken F1 aynı yüklemeyi bekler. Hazırlık kapıları rehber hatasına bağlanmaz. |
| `collection-spreadsheet-engine.js`, `collection-spreadsheet.js` | `BLCollectionSpreadsheetEngine` görünüm değerlendirilirken yakalanır; `BLCollectionSpreadsheetBridge` işlem anında okunur | Mevcut `collectionTools` grubunun başında motor → görünüm. `app-main`, Artwork Detail, pricing/LFL motorları parser tarafından daha önce yüklenmiştir. Sonradan yüklenen görünümün mevcut `readyState` yolu `init()` / `afterRender()` çalıştırır. Mevcut tablo da dekore edilir. |
| `excel-import-workbook.js`, `excel-import-match.js`, `excel-import-plan.js`, `excel-import-profiles.js`, `excel-import-ai.js`, `excel-import-wizard.js` | `BLExcelImportWorkbook`, `BLExcelImportMatch`, `BLExcelImportPlan`, `BLExcelImportProfiles`, `BLExcelImportAI`, `BLExcelImportWizard`; kanonik alanlar / tarih / şema / parser / bridge eager kalır | `excelImport` grubu; deterministik motorlar ve AI yapılandırma yardımcısı sihirbazdan önce gelir. Küçük delegated capture listener ilk `[data-excel-import]` tıklamasını yükleme sonrasında bir kez teslim eder. Sonraki tıklamalar sihirbazın mevcut listener'ına gider. `app-main` değişmedi. |
| `backlog-plan-actual-report.js`, `backlog-plan-actual.js` | `BLPlanActualReport` → `BLBacklogPlanActual`; `BLBacklogOverview.queryFilters()` işlem anında okunur | Mevcut `backlogAnalysis`: teslimat motorları / görünümü → rapor motoru → Planlanan/Gerçekleşen paneli. Panelin mevcut geç yükleme `init()` yolu ve saklı açılma tercihi korunur. |
| `backlog-presentation-report.js`, `backlog-presentation.js` | `BLBacklogPresentationReport` → `BLBacklogPresentation`; `BLBacklogRows` ortak cache'i eager kalır | Aynı grubun sonunda rapor motoru → sunum görünümü. `open()` içindeki `ensureFeature('backlogAnalysis')` kullanıcı daha sonra açtığında tamamlanmış gruba döner; yükleme sırasında `open()` çağrılmadığı için döngü oluşmaz. |

Dosya varlığına dayalı eski testler, aynı sıra ve tek ortak motor koşullarını lazy manifest üzerinde doğrulayacak şekilde güncellendi. Testler eager etiketlerin bulunmadığını da denetler. Yeni runtime testleri CSS bekleme, kod kayıt süresi boyunca görünmezlik, eşzamanlı istek tekilleştirme, hata sonrası yeniden deneme, mevcut globalin eksik CSS'i atlamaması ve ilk Excel tıklamasının bir kez teslimini doğrular. Bu testler PR fast checks'e eklendi.

### Eager bırakılan bağımlılıklar

- `excel-import-mapping.js`: `kolPlmListReadFile()` onu doğrudan, `ensureFeature` çağırmadan `kol-plm-list-import.detectSheet()` işlemine veriyor. Diğer import dosyalarını taşıyıp mapping'i eager bırakmak PLM listesinin alan önerilerini korur. CP import satır revizyonundaki `BLExcelImportPlan.hash` erişimi korumalıdır; sihirbaz plan motoru yüklendikten sonra kullanılır.
- `backlog-chart.js`: kayıtlı grafik durumunu ve seçili kaynak sütunlarını ilk Backlog sorgusu kurulurken `app-main` doğrudan okuyor. Yalnız sonradan `init()` çağırmak ilk sorgunun kapsamını değiştirebilir.
- `backlog-v3-report.js`, `backlog-overview.js`: `BLBacklogRows` / `BLBacklogOverview` ortak cache, filtre ve export sözleşmesini sağlar. Üreticiler sipariş alt detayını `BLBacklogOverview.openItems()` ile doğrudan açar. Bunların çağrılarını değiştirmek bu görevin dışındadır.
- `ui-components.css` ortak Manifest override katmanıdır; bu PR dosyayı bölmez. `app.css`, tokenlar, Motion+, açılış perdesi ve açılışta görünen ortak bileşen stilleri eager kalır.
- Kilitli istemci dosyaları, `scripts/benchmark-startup-orders.js`, `scripts/lib/*` ve `server/**` bu PR diff'inde değişmedi.

## CSS sözleşmesi

18 stylesheet `index.html` içinde eski konumunda inert `<template data-bl-style ...>` işaretiyle temsil edilir. `ensureFeature` gerçek `<link>` öğesini bu işaretin önüne koyar. Böylece ortak `design.css`, `experience.css`, `ui-components.css`, Motion+ ve tablo override'larının cascade sırası korunur. Sürüm/rev/içerik özeti içeren özgün URL kullanılır.

| Özellik | İlk yüklemede beklenen CSS |
| --- | --- |
| `openCosting` | `open-costing.css` |
| `automations` | `automations-fields.css` |
| `lfl` | `lfl.css` |
| `manufacturers` | `manufacturers.css` |
| `licensecards` | `license-cards.css` |
| `collectionTools` | `collection-analytics.css`, `price-supplier-analysis.css`, `pricing-workspace.css`, `pricing-desk.css`, `collection-spreadsheet.css` |
| `backlogAnalysis` | `backlog-delivery-analysis.css`, `backlog-plan-actual.css`, `backlog-presentation.css` |
| `excelImport` | `excel-import.css` |
| `dataManagement` | `data-maintenance.css`, `data-management.css` |
| `userManagement` | `user-management.css` |
| `exceptionInbox` | `exception-inbox.css` |

İndirilen scriptler preload ile paralel hazırlanır; yürütme bağımlılık sırasını izler ve CSS bitmeden başlamaz. İlgili sekmeler CSS ve script kayıtları tamamlanana kadar `visibility:hidden` ile bekler. Başarısız link kaldırılır; promise ve görünmezlik kilidi temizlenir, sonraki `ensureFeature` tekrar deneyebilir. Mevcut bir global, henüz yüklenmemiş CSS'in atlanmasına yol açmaz. Globali hazır olan özellikler de başarılı yükleme kaydını alır.

`collectionTools` mevcut ortak bir gruptur: Pricing Desk veya Koleksiyon açıldığında aynı script/CSS grubu yüklenir. Veri yenilemesinin mevcut LFL / priceanalysis prewarm çağrıları da `ensureFeature` kullanmayı sürdürür; bu çağrıları değiştirmek `app-main` kilidini aşardı. Genel Bakış'ta görünür İstisna Kutusu varsa kendi CSS'i ilk açılışta gerçekten gereklidir. Rehber/trivia açılış perdesinde kullanıldığı için yine ilk açılışta istenir; kazanım parser'ın bu veriyi senkron beklememesidir.

## Ölçüm yöntemi

Tam açılış serisi: önce-1 → sonra-1 → önce-2 → sonra-2 → önce-3 → sonra-3. Her koşu yeni `/tmp/buyerlog-startup-shell-<before|after>-<n>/source/` dizinine aynı `source-30000-seed7-20261105.tar.gz` arşivini açar. Benchmark metadata ve XLSX SHA-256 kontrolleri fixture eşitliğini doğrular. Veri/cache dizinleri koşular arasında kopyalanmaz. Ölçümler sırasında test paketi veya başka benchmark çalıştırılmadı.

Her ağaçta özgün komut, benchmark ve yardımcıları değiştirilmeden çalıştırıldı:

```sh
PLAYWRIGHT_MODULE=/tmp/buyerlog-playwright-probe.cjs \
CHROMIUM_PATH=/usr/bin/chromium \
SHELL_METRICS_FILE=/tmp/buyerlog-startup-shell-<variant>-<n>/shell-metrics.json \
node scripts/benchmark-startup-orders.js --rows 30000 \
  --fixture-root /tmp/buyerlog-startup-shell-<variant>-<n>
```

Küçük Playwright gözlemcisi kapanan sayfadan DOMContentLoaded okur. İlk Resource Timing denemesinde Chromium'un varsayılan **250 kayıt** tamponunun dolduğu görüldü: bir örnekte 23.276 ms'de listede yalnız 250 kayıt vardı ve son kaydın başlangıcı 1.673 ms idi. Bu ilk denemenin kaynak adet/bayt verileri rapora alınmadı. Navigation Timing ve özgün `PerformanceObserver` long-task ölçümü bu ayrı tampon sınırından etkilenmez.

Adet/bayt için tamponu navigasyondan önce **20.000** kayda yükselten ek, dönüşümlü altı soğuk Overview koşusu yapıldı:

```sh
PLAYWRIGHT_MODULE=/tmp/buyerlog-playwright-complete-probe.cjs \
CHROMIUM_PATH=/usr/bin/chromium SHELL_GUIDE_PROBE=1 \
SHELL_METRICS_FILE=/tmp/buyerlog-startup-shell-<variant>-<n>/resources-complete.json \
node scripts/benchmark-startup-orders.js --rows 30000 \
  --fixture-root /tmp/buyerlog-startup-shell-<variant>-<n> \
  --skip-refresh --skip-same-tab --module overview \
  --out /tmp/buyerlog-startup-shell-<variant>-<n>/resource-benchmark.json
```

Bu ek seri her koşuda yeni tarayıcı/context açar. Aynı kökün hazırlanmış cache'i kullanılır; fixture, satır sayıları, cache generation ve source revision'ın özgün koşuyla **birebir aynı** olduğu doğrulanır. Yalnız yenileme ve diğer sayfalara geçiş tekrarlanmaz. Her koşuda kaynak tamponu taşma sayısı sıfır olmak zorundadır. `.js` / `.css` kayıtlarının yolu, başlangıç/bitiş zamanı, initiator türü ve decoded/encoded/transfer baytları saklanır. Aynı dosyanın farklı URL ile tekrar istenmesi korunur; istek ve unique dosya sayısı ayrıdır. Özetler hem birincil-ekran olayına kadar başlatılan kaynakları hem 10.000 ms'ye kadar başlatılan kaynakları gösterir.

Tamponu büyüten gözlemci, başlangıç ölçümleri tamamlandıktan sonra F1 rehberinin ilk açılışını ölçer. Ardından core-data arka plan hazırlığı bitince, `collectionTools` henüz yüklenmemişken aynı taze context'te Koleksiyon açılır; bu grubun ilk indirme/çalıştırma maliyeti ayrıca ölçülür. Böylece ortak Pricing Desk grubunun önceden açılması Koleksiyonun ilk açılış maliyetini saklamaz. Gözlemci fixture'ı veya benchmark kabul koşullarını değiştirmez.

`/opt/node22/lib/node_modules/playwright` bu ortamda yoktur; kurulu `/opt/codex/cua_node/lib/node_modules/playwright`, sistem Chromium'u ve Node 24.19.0 iki varyantta aynıdır. Tam açılış serisinin `sameTab.overview` ilk navigasyonu da soğuk HTTP cache'tir; sonraki Overview, Koleksiyon, CP ve Orders navigasyonlarının context cache'i ısınmıştır. Bu senaryolar ayrı saklanır. DOMContentLoaded Navigation Timing'den, birincil ekran `bl:primary-screen-ready` olayından alınır. Uzun görevler özgün probe'un navigasyondan başlayan, 10.000 ms sonunda kırpılan penceresidir. Backend açılışı, Continue kapısı ve gerçek perde kapanışı özgün ayrı metriklerdir; birincil ekranla aynı şey değildir.

Her tam benchmark sonrasında aynı sentetik kök yeniden başlatılarak modüller ilk kez açılır. Core-data hazırlığı tamamlandıktan sonra `switchTab` ve mevcut `ensureFeature` akışı kullanılır; stil/kod hazır süresi ile veri/ana kontrol hazır süresi ayrıdır. İlk Pricing Desk açılışı ortak grubu da yükler. Bu ana senaryodaki sonraki Koleksiyon geçişi sıcak gruptur. Ek yeni-belge Koleksiyon örneğinin HTTP cache'i de aynı context'te ısınmıştır; ham kayıttaki `koleksiyonCold` adı yalnız yeni belgedeki global/feature durumunu ifade eder. Gerçek ilk grup indirmesi yukarıdaki kaynak serisinde ayrıca verilir. Excel için gerçek menü tıklanır. Planlanan/Gerçekleşen ve sunum önizlemesinin açılması grup yükleme süresinden ayrıdır. Modülün isteğe bağlı okuma/Devam bekleyişi kullanıcı düşünme süresi olarak dışarıda tutulur. Sentetik Koleksiyon boştur; işlev smoke'unda geçici, kaydedilmeyen bir demo satırı kullanıldı.

Linux headless Chromium ölçümüdür; Windows/Electron, antivirüs ve soğuk OS disk cache'i ölçülmez. Üç tekrar dağılımı görmek içindir; küçük süre farkları genel hızlanma garantisi değildir.

## Ölçüm sonuçları

Taban `2083ffd7`, uygulama değişikliği `0a57512f`. Node v24.19.0, Chromium 154.0.8037.57, 4 vCPU kota / 16 GiB. Her sütun medyanı, değişken değerlerde parantez içi min–max aralığını gösterir; her varyantta n=3. Ham gözlemler [measurements.json](startup-feature-assets-20261107/measurements.json), statik envanter [inventory.json](startup-feature-assets-20261107/inventory.json).

### Kaynak tamponu tamamlanmış soğuk Overview

Bu tablonun süreleri ve baytları aynı ek altı koşudan gelir. İstek sınırı kaynak başlangıç zamanıdır; decoded/encoded gövde boyutları ve header dahil transfer boyutu ayrı saklanır. Tampon taşması altı koşuda da 0.

| Metrik | Önce | Sonra | Medyan farkı |
| --- | ---: | ---: | ---: |
| DOMContentLoaded (ms) | 1007.9 (992.0–1249.5) | 869.2 (859.6–993.3) | -13.8% |
| Birincil ekran hazır (ms) | 1463.2 (1420.4–1802.4) | 1390.7 (1356.8–1510.6) | -5.0% |
| Continue kapısı hazır (ms) | 1469.1 (1428.2–1812.4) | 1400.3 (1366.5–1521.1) | -4.7% |
| Perde kapandı (ms) | 1615.3 (1547.5–1908.5) | 1523.8 (1453.1–1600.1) | -5.7% |
| İlk 10 sn uzun görev toplamı (ms) | 1445.0 (1281.0–1627.0) | 1312.0 (1172.0–1530.0) | -9.2% |
| Birincil ekrana kadar JS istek | 153 | 142 | -7.2% |
| Birincil ekrana kadar JS unique dosya | 152 | 141 | -7.2% |
| Birincil ekrana kadar JS decoded bayt | 6.928.636 | 6.543.706 | -5.6% |
| Birincil ekrana kadar JS encoded bayt | 2.746.188 | 2.631.005 | -4.2% |
| Birincil ekrana kadar JS transfer bayt | 2.792.088 | 2.673.605 | -4.2% |
| Birincil ekrana kadar CSS istek | 45 | 27 | -40.0% |
| Birincil ekrana kadar CSS unique dosya | 45 | 27 | -40.0% |
| Birincil ekrana kadar CSS decoded bayt | 1.887.478 | 1.642.046 | -13.0% |
| Birincil ekrana kadar CSS encoded bayt | 1.308.875 | 1.246.579 | -4.8% |
| Birincil ekrana kadar CSS transfer bayt | 1.322.375 | 1.254.679 | -5.1% |
| İlk 10 sn JS istek | 182 (182–183) | 171 | -6.0% |
| İlk 10 sn JS unique dosya | 180 (180–181) | 169 | -6.1% |
| İlk 10 sn JS decoded bayt | 8.213.733 (8.213.733–8.638.753) | 7.828.803 | -4.7% |
| İlk 10 sn JS encoded bayt | 3.114.492 (3.114.492–3.257.938) | 2.999.309 | -3.7% |
| İlk 10 sn JS transfer bayt | 3.169.092 (3.169.092–3.312.838) | 3.050.609 | -3.7% |
| İlk 10 sn CSS istek | 45 | 28 | -37.8% |
| İlk 10 sn CSS unique dosya | 45 | 28 | -37.8% |
| İlk 10 sn CSS decoded bayt | 1.887.478 | 1.642.835 | -13.0% |
| İlk 10 sn CSS encoded bayt | 1.308.875 | 1.247.368 | -4.7% |
| İlk 10 sn CSS transfer bayt | 1.322.375 | 1.255.768 | -5.0% |

### Özgün tam komutun diğer açılış senaryoları

Context cache’i bu senaryolarda ilk Overview ve aynı-sekme geçişleriyle ısınmıştır. Süreler yeni sayfa navigasyonlarıdır.

| Senaryo / metrik (ms) | Önce | Sonra | Medyan farkı |
| --- | ---: | ---: | ---: |
| overview / DCL | 1934.0 (1902.8–2110.7) | 1990.8 (1971.6–2087.1) | +2.9% |
| overview / Birincil ekran | 2351.1 (2309.4–2537.0) | 2443.0 (2389.7–2550.8) | +3.9% |
| overview / İlk 10 sn uzun görev | 6020.8 (5820.0–6080.3) | 5949.1 (5586.6–6156.7) | -1.2% |
| koleksiyon / DCL | 946.8 (910.0–1095.5) | 837.0 (808.7–1077.1) | -11.6% |
| koleksiyon / Birincil ekran | 1318.9 (1272.2–1404.1) | 1315.2 (1292.3–1445.5) | -0.3% |
| koleksiyon / İlk 10 sn uzun görev | 4324.7 (4221.6–4400.3) | 4149.5 (4038.3–4502.5) | -4.1% |
| cp / DCL | 794.0 (780.7–844.1) | 763.1 (726.5–965.8) | -3.9% |
| cp / Birincil ekran | 12675.1 (12434.4–12936.1) | 12713.6 (12693.0–12838.7) | +0.3% |
| cp / İlk 10 sn uzun görev | 8465.9 (8331.8–8510.7) | 8392.5 (8386.6–8417.9) | -0.9% |
| orders / DCL | 747.0 (736.9–750.3) | 702.0 (660.4–708.6) | -6.0% |
| orders / Birincil ekran | 3312.6 (3240.0–3358.6) | 3326.7 (3166.3–3434.2) | +0.4% |
| orders / İlk 10 sn uzun görev | 6505.6 (6313.0–6683.8) | 6364.8 (6298.0–6511.1) | -2.2% |

### İlk açılış süreleri

Ana kontrol/veri hazır (ms); özellik promise’i ve alt ayrıntılar ham JSON’dadır. Ortak `collectionTools` grubu ilk Pricing Desk girişinde indirilir. Planlanan/Gerçekleşen ve sunum satırları Backlog grubunun yüklenmesinden sonraki ilk işlem süresidir. Son iki satır tamponu tamamlanmış kaynak serisindeki taze context’ten gelir.

| İlk açılış | Önce | Sonra | Medyan farkı |
| --- | ---: | ---: | ---: |
| Veri Yönetimi | 170.3 (154.0–170.8) | 175.4 (175.0–179.0) | +3.0% |
| Üreticiler | 337.4 (325.6–352.1) | 349.3 (329.4–383.7) | +3.5% |
| Lisans Kartları | 892.9 (883.6–911.8) | 894.3 (889.2–1387.7) | +0.2% |
| LFL | 3845.9 (3446.9–4025.9) | 3483.6 (3416.0–3690.0) | -9.4% |
| Ön Maliyet | 170.4 (135.5–183.4) | 172.4 (165.8–174.3) | +1.2% |
| Otomasyon | 79.5 (78.8–92.5) | 88.1 (73.2–94.2) | +10.8% |
| Pricing Desk / collectionTools ilk yükleme | 107.5 (103.7–109.0) | 142.1 (133.3–148.4) | +32.2% |
| Koleksiyon / grup zaten yüklü | 283.5 (274.9–293.7) | 274.6 (258.7–314.6) | -3.1% |
| Backlog / backlogAnalysis ilk yükleme | 2053.4 (1997.1–2182.7) | 2010.3 (2002.5–2133.1) | -2.1% |
| Planlanan/Gerçekleşen paneli | 41.1 (39.6–47.7) | 38.9 (37.6–42.5) | -5.4% |
| Sunum önizlemesi | 12720.0 (12306.9–13656.3) | 12523.8 (12338.7–13369.3) | -1.5% |
| Excel sihirbazı | 1484.7 (1351.2–1589.5) | 1556.7 (1520.9–1820.0) | +4.8% |
| Kullanıcı Yönetimi | 164.5 (161.6–177.8) | 205.5 (184.7–219.8) | +24.9% |
| İstisna Kutusu | 187.0 (182.5–190.4) | 188.0 (154.7–208.3) | +0.5% |
| Koleksiyon / yeni belge, sıcak HTTP cache | 450.4 (372.2–459.7) | 389.1 (330.6–540.3) | -13.6% |
| F1 rehber / taze context | 167.6 (160.2–6846.5) | 151.1 (126.2–931.4) | -9.8% |
| Koleksiyon / ortak grubun gerçek ilk indirmesi | 348.6 (331.1–416.9) | 432.4 (416.0–444.6) | +24.0% |

Veri/cache generation ve fixture kontrolleri 12 benchmark koşusunda geçti. Modül kontrolleri altı tam koşunun tamamında geçti; raporlanan browser page-error sayısı 0. Yeni özellik indirme maliyeti ilk açılışta ödenir; bu tabloda küçük artışlar ve makineye bağlı geniş aralıklar gizlenmez.


### Sonucun sınırı ve ilk kullanım bedeli

Statik HTML'de senkron script etiketi **127 → 112** (16 büyük dosya çıkarıldı, 756 baytlık giriş betiği eklendi), blocking stylesheet **45 → 27**. Yerel eager JS dosyaları **6.249.013 → 5.637.638 bayt** (−611.375); CSS **1.887.478 → 1.642.046 bayt** (−245.432). `ui-components.css` hâlâ 1.130.693 bayttır; ortak Manifest katmanı bu PR'ın dışında kalır.

Tamponu tamamlanmış Overview'da birincil ekrana kadar JS **6.928.636 → 6.543.706 bayt**, CSS **1.887.478 → 1.642.046 bayt**. İlk 10 saniyede de medyan JS ve CSS gövdeleri azalır. Rehber/trivia açılışta kullanıldığı için dosyaları bu aralıkta hâlâ yüklenir; parser'ı bloklamaları kalkar. İstisna Kutusu ilk Overview'da görünür olduğundan CSS sayısı 10 saniyelik toplamda 27 değil **28** olur.

Soğuk Overview'da DCL medyanı **1007,9 → 869,2 ms**, birincil ekran **1463,2 → 1390,7 ms**, uzun görev toplamı **1445 → 1312 ms**. Buna karşılık cache'i ısınmış Overview, CP ve Orders birincil ekranlarında belirgin kazanç yoktur; warm Overview medyanı yaklaşık 92 ms daha yüksektir ve dağılımlar örtüşür. Bu PR genel 30k render/hesaplama darboğazını çözmüş sayılmaz.

İlk Pricing Desk açılışı yaklaşık **35 ms**, gerçek ilk Koleksiyon grubu indirmesi **84 ms**, Excel sihirbazı **72 ms**, Kullanıcı Yönetimi **41 ms** ek medyan maliyet gösterir. Sunumun mevcut 12–13 sn ilk önizleme maliyeti korunur; lisans kartında tek koşuluk 1,39 sn ve F1 açılışında kuyruk beklemesine bağlı geniş aralık ham tabloda görünür. Tek makinede üç örnekten küçük farklar için nedensellik veya kesin hız garantisi çıkarılmaz.

## Tarayıcı ve görsel kanıt

Gerçek Buyer Log'da 30k sentetik fixture ile doğrulanan işlemler: Veri Yönetimi aç/kapa kontrolleri ve salt okunur bakım paneli; Üreticiler arama; Lisans Kartları yükleme; LFL veri/KPI ekranı; yeni Ön Maliyet formu; Otomasyon çalışma alanı; Pricing Desk Geçmiş sekmesi; spreadsheet hücre seçimi ve ok tuşu gezintisi; Planlanan/Gerçekleşen dönem kontrolleri; sunum raporu iframe önizlemesi; Excel menüsünden ilk açılış, örnek XLSX okuma ve sütun eşlemeye ilerleme; kullanıcı yönetimi dialog'u; İstisna Kutusu; F1 rehber arama.

15 ekranın TR/EN × açık/koyu tema kombinasyonlarında 60 gerçek PNG kaydı alındı ve contact sheet'ler incelendi. LFL'nin okuma sonrası Devam perdesi geçilerek veri ekranı ayrıca dört kombinasyonda kaydedildi. Modül dosyalarının başlangıçta istenmediği Resource Timing ile denetlendi. Üreticiler CSS yanıtı tutularak yeni görünümün gizli kaldığı, CSS serbest bırakıldığında stilli kontrollerin görünür olduğu gerçek tarayıcıda doğrulandı. Yeni animasyon motoru veya hareket ayarı eklenmedi.

Contact sheet kayıtları: [TR açık](startup-feature-assets-20261107/visual-tr-light.png), [TR koyu](startup-feature-assets-20261107/visual-tr-dark.png), [EN açık](startup-feature-assets-20261107/visual-en-light.png), [EN koyu](startup-feature-assets-20261107/visual-en-dark.png). Bunlar gerçek PNG kayıtlarından inceleme için küçültülmüş derlemelerdir.

Release note görseli `resources/app/public/release-notes/next-assets/startup-feature-assets.png`: gerçek uygulama, sentetik demo satırı, 1600×1000 PNG. `next.json` içinde yalnız bu PR'ın TR/EN kaydı eklendi.

## Test sonucu ve PR durumu

- İlgili yükleme, import, spreadsheet, Backlog, LFL, lisans ve Veri Yönetimi sözleşmeleri geçti; yeni runtime yükleme testleri PR fast checks'e dahil.
- `npm test`: ilk üç batch çalıştı, `local-iam-migration-authority.test.js` içindeki “a partial established local directory without a valid recovery copy fails closed” assertion'ında başarısız. Beklenen `IAM_LOCAL_INVALID`, gözlenen `undefined`. Aynı test **değiştirilmemiş `2083ffd7` ana dalında da 6 pass / 1 fail** ile tekrarlandı. Kilitli `server/**` alanına müdahale edilmedi.
- Runner hata sonrası durduğu için, kaynak runner'ın yalnız `TEST_ROOT`, başlangıç batch indeksi ve rapor etiketi değiştirilen geçici kopyasıyla batch 4–10 da çalıştırıldı. Assertion'lar, concurrency, isolated test listesi ve hata çıkışı değiştirilmedi. Bu yedi batch geçti. Toplam 1240 dosya çalıştırıldı: 8706 test/subtest, 8640 pass, 1 fail, 65 mevcut skip. Test silinmedi, gevşetilmedi veya yeni skip eklenmedi.
- Ana daldaki v714 düzeltmesi dahil; v714 geçti. `npm run i18n:check`: yeni eksik 0, baseline eksik 0. `npm run release:notes:validate` geçti.
- Tam test paketi yeşil değildir. PR mevcut IAM hatası nedeniyle taslak tutulur; merge, TEST ve STABLE yapılmadı.

[Test özetleri ve browser kontrol listesi](startup-feature-assets-20261107/validation.json). [npm özeti](startup-feature-assets-20261107/npm-summary.txt), [kalan batch özeti](startup-feature-assets-20261107/remaining-summary.txt), [ana dal IAM tekrarı](startup-feature-assets-20261107/baseline-IAM-summary.txt).

