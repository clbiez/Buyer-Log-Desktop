# Buyer Log — açılış varlıklarını özellik bazında yükleme

**Güncel Main kapanışı:** #912 ve #901 sonrasındaki yeni üç çift,
8.879 geçen test ve bütün ilk-kullanım ödünleşimleri
[post-901 kabul ekindedir](2026-11-07-startup-post-901-acceptance.md).
Aşağıdaki ilk seri kendi `63159fb3` / `d61d9434` kaynaklarının tarihsel
kanıtıdır; yeni Main sonucu diye kullanılmaz.

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
| `manufacturers` | `manufacturers.css`, `backlog-plan-actual.css` (ortak sipariş drawer yerleşimi) |
| `licensecards` | `license-cards.css` |
| `collectionTools` | `collection-analytics.css`, `price-supplier-analysis.css`, `pricing-workspace.css`, `pricing-desk.css`, `collection-spreadsheet.css` |
| `backlogAnalysis` | `backlog-delivery-analysis.css`, `backlog-plan-actual.css`, `backlog-presentation.css` |
| `excelImport` | `excel-import.css` |
| `dataManagement` | `data-maintenance.css`, `data-management.css` |
| `userManagement` | `user-management.css` |
| `exceptionInbox` | `exception-inbox.css` |

İndirilen scriptler preload ile paralel hazırlanır; yürütme bağımlılık sırasını izler ve CSS bitmeden başlamaz. İlgili sekmeler CSS ve script kayıtları tamamlanana kadar `visibility:hidden` ile bekler. Başarısız link kaldırılır; promise ve görünmezlik kilidi temizlenir, sonraki `ensureFeature` tekrar deneyebilir. Mevcut bir global, henüz yüklenmemiş CSS'in atlanmasına yol açmaz. Globali hazır olan özellikler de başarılı yükleme kaydını alır.

`collectionTools` mevcut ortak bir gruptur: Pricing Desk veya Koleksiyon açıldığında aynı script/CSS grubu yüklenir. Veri yenilemesinin mevcut LFL / priceanalysis prewarm çağrıları da `ensureFeature` kullanmayı sürdürür; bu çağrıları değiştirmek `app-main` kilidini aşardı. Genel Bakış'ta görünür İstisna Kutusu varsa kendi CSS'i ilk açılışta gerçekten gereklidir. Rehber/trivia açılış perdesinde kullanıldığı için yine ilk açılışta istenir; kazanım parser'ın bu veriyi senkron beklememesidir.

Üreticiler sipariş alt detayı `BLBacklogOverview.openItems()` üzerinden `.bpaDrawerRoot` / `.bpaDrawer` kullanır. Bu ortak yerleşim `backlog-plan-actual.css` içindedir. P2 düzeltmesiyle stil hem `manufacturers` hem `backlogAnalysis` bağımlılığıdır; ortak `styleStates` promise'i ve özgün anchor tekilleştirmeyi korur. Backlog'un önce açılması gerekmez. Ayrıntı ve yeni kabul kanıtları aşağıdaki P2 kapanış bölümündedir.

## Ölçüm yöntemi

Nihai ölçüm tabanı, görev sırasında ana dala alınan Faz 5 entegrasyonu `63159fb3` üzerine rebase edildikten sonra sabitlendi. Sıra **önce-1 → sonra-1 → önce-2 → sonra-2 → önce-3 → sonra-3**. Her koşu kendi yeni `/tmp/buyerlog-startup-final-<before|after>-<n>/source/` dizinine aynı `source-30000-seed7-20261105.tar.gz` arşivini açar. Metadata ve üç XLSX SHA-256 kontrolü fixture eşitliğini doğrular. Veri/cache dizinleri koşular arasında kopyalanmaz. Ölçüm sırasında test paketi veya başka benchmark çalıştırılmaz.

Her ağaçta güncel özgün komut, benchmark ve yardımcıları değiştirilmeden çalıştırıldı:

```sh
PLAYWRIGHT_MODULE=/tmp/buyerlog-playwright-complete-probe.cjs \
CHROMIUM_PATH=/usr/bin/chromium SHELL_GUIDE_PROBE=0 \
SHELL_METRICS_FILE=/tmp/buyerlog-startup-final-<variant>-<n>/shell-metrics.json \
node scripts/benchmark-startup-orders.js --rows 30000 \
  --fixture-root /tmp/buyerlog-startup-final-<variant>-<n>
```

Playwright gözlemcisi navigasyondan önce Resource Timing tamponunu **20.000** kayda yükseltir ve `resourcetimingbufferfull` olayını sayar. İlk denemede Chromium'un varsayılan 250 kayıt sınırının dolduğu görüldüğü için, eksik adet/bayt verileri atıldı; nihai altı koşunun tamamı büyütülmüş tamponla tekrarlandı. Gözlemci kapanan sayfadan Navigation/Resource Timing okur; `SHELL_GUIDE_PROBE=0` ile benchmark akışına ek UI işlemi eklemez. Kaynak yolu, başlangıç/bitiş zamanı, initiator türü, decoded/encoded/transfer bayt saklanır. Farklı URL ile tekrarlanan aynı dosya isteği korunur; istek ve unique dosya sayısı ayrıdır. Özetler hem birincil ekran olayına kadar hem 10.000 ms'ye kadar başlatılan `.js` / `.css` kaynaklarını gösterir.

`/opt/node22/lib/node_modules/playwright` bu ortamda yoktur; kurulu `/opt/codex/cua_node/lib/node_modules/playwright`, sistem Chromium'u ve Node 24.19.0 iki varyantta aynıdır. İlk `sameTab.overview` navigasyonu yeni tarayıcı/context ve soğuk HTTP cache'tir. Sonraki Overview, Koleksiyon, CP ve Orders navigasyonlarında context cache'i ısınmıştır; bu senaryolar ayrı saklanır. DOMContentLoaded Navigation Timing'den, birincil ekran `bl:primary-screen-ready` olayından alınır. Uzun görevler özgün probe'un navigasyondan başlayan, 10.000 ms sonunda kırpılan penceresidir. Backend açılışı, Continue kapısı ve gerçek perde kapanışı ayrı özgün metriklerdir; birincil ekranla aynı şey değildir.

Her tam benchmark sonrasında aynı sentetik kök yeniden başlatılarak modüller ilk kez açılır. Core-data arka plan hazırlığı tamamlandıktan sonra `switchTab` / mevcut `ensureFeature` akışı kullanılır. Pricing Desk ortak grubu ilk kez yükler; sonraki Koleksiyon geçişinde grup sıcaktır. **Ayrı yeni HTTP context** açılıp aynı sentetik session cookie'si aktarılır; burada F1 rehberi ve `collectionTools` henüz yüklenmemişken Koleksiyonun gerçek ilk grup indirmesi ayrıca ölçülür. Excel için gerçek menü tıklanır; örnek dosya okunup eşlemeye ilerlenir. Spreadsheet'te Escape'in seçimi/ızgara odağını koruduğu ve ArrowRight'ın aktif sütunu değiştirdiği doğrulanır. İstisna Kutusu veri ve tür kontrolleri hazır olana kadar beklenir. Diğer hazır olma ölçütleri sonuç tablosunda belirtilir.

Sentetik Koleksiyon boştur; işlev smoke'unda geçici, kaydedilmeyen bir demo satırı kullanılır. Modülün isteğe bağlı okuma/Devam bekleyişi kullanıcı düşünme süresi olarak dışarıda tutulur. Kaynak fixture, cache generation, source revision ve satır doğrulamaları özgün benchmark'a aittir. Benchmark'ın SHA-256 değeri de her sonuçta saklanır.

Linux headless Chromium ölçümüdür; Windows/Electron, antivirüs ve soğuk OS disk cache'i ölçülmez. Üç tekrar dağılımı görmek içindir; küçük süre farkları genel hızlanma garantisi değildir.

## Ölçüm sonuçları

Güncel entegrasyon tabanı `63159fb3`, ölçülen uygulama revizyonu `d61d9434`. Node v24.19.0, Chromium 154.0.8037.57, 4 vCPU kota / 16 GiB. Her sütun medyanı, değişken değerlerde parantez içi min–max aralığını gösterir; her varyantta n=3. [Ham JSON (gzip)](startup-feature-assets-20261107/measurements.json.gz), [CSV](startup-feature-assets-20261107/cold-overview.csv), [statik envanter](startup-feature-assets-20261107/inventory.json).

Statik HTML'de senkron script sayısı **127 → 112**, yerel dosya toplamı **6.254.780 → 5.643.405 bayt**; blocking stylesheet sayısı **45 → 27**, toplamı **1.887.478 → 1.642.046 bayt**. Net parser/blocking yük azalımı **856.807 bayt**. Dinamik `/user-context.js` yanıtı statik yerel dosya toplamına dahil değildir; gerçek navigasyon ölçümünde sayılır.

### Soğuk Overview / tam komutun ilk navigasyonu

Süre ve baytlar aynı altı koşudan gelir. Kaynak tamponu navigasyondan önce 20.000 kayda yükseltildi; 30 sayfa navigasyonunun tamamında taşma 0. İstek sınırı kaynak başlangıç zamanıdır. Decoded/encoded gövde ve header dahil transfer boyutu ayrı saklanır.

| Metrik | Önce | Sonra | Medyan farkı |
| --- | ---: | ---: | ---: |
| DOMContentLoaded (ms) | 955.5 (948.2–1126.4) | 841.9 (833.0–1118.1) | -11.9% |
| Birincil ekran hazır (ms) | 1585.1 (1546.6–1783.5) | 1483.0 (1393.1–1805.6) | -6.4% |
| Continue kapısı hazır (ms) | 1594.7 (1555.3–1796.0) | 1501.6 (1398.5–1817.0) | -5.8% |
| Perde kapandı (ms) | 1680.4 (1648.5–1891.0) | 1586.8 (1454.9–1909.7) | -5.6% |
| İlk 10 sn uzun görev toplamı (ms) | 6783.5 (6605.2–7283.8) | 7021.8 (6744.2–7025.1) | +3.5% |
| Birincil ekrana kadar JS istek | 153 | 142 | -7.2% |
| Birincil ekrana kadar JS unique dosya | 152 | 141 | -7.2% |
| Birincil ekrana kadar JS decoded bayt | 6.934.403 | 6.549.473 | -5.6% |
| Birincil ekrana kadar JS encoded bayt | 2.748.136 | 2.632.953 | -4.2% |
| Birincil ekrana kadar JS transfer bayt | 2.794.036 | 2.675.553 | -4.2% |
| Birincil ekrana kadar CSS istek | 45 | 27 | -40.0% |
| Birincil ekrana kadar CSS unique dosya | 45 | 27 | -40.0% |
| Birincil ekrana kadar CSS decoded bayt | 1.887.478 | 1.642.046 | -13.0% |
| Birincil ekrana kadar CSS encoded bayt | 1.308.875 | 1.246.579 | -4.8% |
| Birincil ekrana kadar CSS transfer bayt | 1.322.375 | 1.254.679 | -5.1% |
| İlk 10 sn JS istek | 183 | 172 | -6.0% |
| İlk 10 sn JS unique dosya | 181 | 170 | -6.1% |
| İlk 10 sn JS decoded bayt | 8.644.520 | 8.259.590 | -4.5% |
| İlk 10 sn JS encoded bayt | 3.259.886 | 3.144.703 | -3.5% |
| İlk 10 sn JS transfer bayt | 3.314.786 | 3.196.303 | -3.6% |
| İlk 10 sn CSS istek | 45 | 28 | -37.8% |
| İlk 10 sn CSS unique dosya | 45 | 28 | -37.8% |
| İlk 10 sn CSS decoded bayt | 1.887.478 | 1.642.835 | -13.0% |
| İlk 10 sn CSS encoded bayt | 1.308.875 | 1.247.368 | -4.7% |
| İlk 10 sn CSS transfer bayt | 1.322.375 | 1.255.768 | -5.0% |

### Tam komutun sonraki açılış senaryoları

Bu navigasyonlarda context cache’i ilk Overview ve aynı-sekme geçişleriyle ısınmıştır.

| Senaryo / metrik (ms) | Önce | Sonra | Medyan farkı |
| --- | ---: | ---: | ---: |
| overview / DCL | 1018.6 (904.6–1037.4) | 999.6 (928.2–1089.8) | -1.9% |
| overview / Birincil ekran | 1503.2 (1388.0–1523.0) | 1495.3 (1442.6–1614.6) | -0.5% |
| overview / İlk 10 sn uzun görev | 8139.0 (8127.8–8199.9) | 8053.0 (8035.6–8253.5) | -1.1% |
| koleksiyon / DCL | 922.8 (831.2–1047.2) | 793.4 (763.2–802.7) | -14.0% |
| koleksiyon / Birincil ekran | 1310.5 (1149.7–1409.6) | 1214.6 (1208.4–1225.8) | -7.3% |
| koleksiyon / İlk 10 sn uzun görev | 4735.3 (4679.9–4847.2) | 4626.2 (4602.3–4705.9) | -2.3% |
| cp / DCL | 720.8 (697.8–877.7) | 692.5 (680.3–724.7) | -3.9% |
| cp / Birincil ekran | 12493.4 (12048.2–15254.3) | 12248.9 (11747.6–12991.3) | -2.0% |
| cp / İlk 10 sn uzun görev | 9155.1 (8803.9–9211.7) | 8900.1 (8896.9–9119.3) | -2.8% |
| orders / DCL | 747.8 (737.8–845.4) | 728.4 (725.4–748.7) | -2.6% |
| orders / Birincil ekran | 3603.3 (3485.0–3633.2) | 3407.0 (3377.1–3509.9) | -5.4% |
| orders / İlk 10 sn uzun görev | 6660.7 (6459.8–6677.8) | 6447.1 (6241.8–6455.0) | -3.2% |

### İlk açılış süreleri

Bu tablo `d61d9434` tam serisinin tarihsel sonucudur. Üreticiler ortak drawer CSS bağımlılığına ilişkin sonraki P2 düzeltmesinin ilgili ölçümü aşağıda ayrıca verilir.

Ölçütler: Veri Yönetimi ilk kontroller; Üreticiler hesaplanmış sonuç; Lisans Kartları busy durumu bitişi; LFL görünür KPI ve yükleyici bitişi; Backlog dolu pivot; Planlanan/Gerçekleşen dönem kontrolü; sunum `open()` tamamlanması ve iframe; Excel sihirbaz DOM’u; Kullanıcı Yönetimi dialog’u; İstisna Kutusu veri ve tür düğmeleri. Promise/kod hazır süreleri ayrıca ham JSON’dadır. İsteğe bağlı okuma/Devam bekleyişi kullanıcı düşünme süresi olarak dışarıda tutulur.

Pricing Desk ortak grubu ilk kez yükler; ana senaryodaki sonraki Koleksiyon geçişinde bu grup sıcaktır. Son iki satır ayrı, yeni HTTP context’te ve arka plan core hazırlığı bittikten sonra ölçülür. Planlanan/Gerçekleşen ve sunum satırları Backlog grubu yükleme süresine ek ilk işlem maliyetidir.

| İlk açılış (ms) | Önce | Sonra | Medyan farkı |
| --- | ---: | ---: | ---: |
| Veri Yönetimi | 170.8 (157.0–184.7) | 185.1 (149.8–188.4) | +8.4% |
| Üreticiler | 367.1 (341.4–405.2) | 402.0 (373.3–411.1) | +9.5% |
| Lisans Kartları | 2914.7 (2912.0–2927.9) | 2933.9 (2908.4–2947.9) | +0.7% |
| LFL | 3828.8 (3470.9–4479.0) | 3914.3 (3786.3–4158.2) | +2.2% |
| Ön Maliyet | 173.0 (151.3–214.8) | 186.9 (182.3–215.9) | +8.0% |
| Otomasyon | 145.5 (132.7–150.9) | 129.9 (127.7–149.5) | -10.7% |
| Pricing Desk / collectionTools ilk yükleme | 120.0 (114.5–131.3) | 144.8 (143.6–155.2) | +20.7% |
| Koleksiyon / grup zaten yüklü | 301.6 (266.1–309.1) | 298.9 (291.5–299.8) | -0.9% |
| Backlog / backlogAnalysis ilk yükleme | 2553.3 (2487.0–2583.5) | 2536.1 (2531.2–2565.5) | -0.7% |
| Planlanan/Gerçekleşen paneli | 48.7 (44.6–71.9) | 56.2 (48.0–71.7) | +15.4% |
| Sunum önizlemesi | 9592.6 (9318.8–9754.9) | 8931.9 (8669.6–9552.5) | -6.9% |
| Excel sihirbazı | 1653.2 (1554.6–2018.9) | 1526.5 (1450.2–1707.7) | -7.7% |
| Kullanıcı Yönetimi | 161.7 (142.5–216.5) | 195.1 (183.4–208.2) | +20.7% |
| İstisna Kutusu / veri hazır | 2243.2 (2212.7–2566.8) | 2449.5 (2397.1–2787.7) | +9.2% |
| F1 rehber / taze HTTP context | 159.5 (149.0–319.1) | 163.7 (156.0–175.1) | +2.6% |
| Koleksiyon / taze HTTP context, ilk grup indirmesi | 331.0 (308.2–425.2) | 415.4 (388.2–438.0) | +25.5% |

Altı benchmark cache generation, source revision ve satır doğrulamalarıyla geçti. Altı modül kontrolü de geçti; raporlanan browser page-error sayısı 0. Her taze Koleksiyon context’inde `collectionTools` ilk geçişten önce yüklü değildir; transfer boyutları ham JSON’da saklanır.

[Doğrulandı] Bu koşularda DCL ve birincil ekran medyanları azaldı; ilk 10 saniyedeki JS/CSS bayt ve istek sayısı düştü. Uzun görev toplamı **%3,5 arttı** ve aralıklar örtüşüyor; bu metrikte iyileşme iddiası yoktur. Yükleme maliyetinin bir bölümü ilk kullanıma taşındı: taze context'te Koleksiyon grubu medyanı 331 → 415 ms oldu. Üç tekrar, küçük süre farklarını genel hızlanma garantisine dönüştürmez.

## Tarayıcı ve görsel kanıt

Gerçek Buyer Log'da 30k sentetik fixture ile doğrulanan işlemler: Veri Yönetimi aç/kapa kontrolleri ve salt okunur bakım paneli; Üreticiler arama; Lisans Kartları yükleme; LFL veri/KPI ekranı; yeni Ön Maliyet formu; Otomasyon çalışma alanı; Pricing Desk Geçmiş sekmesi; spreadsheet hücre seçimi ve ok tuşu gezintisi; Planlanan/Gerçekleşen dönem kontrolleri; sunum raporu iframe önizlemesi; Excel menüsünden ilk açılış, örnek XLSX okuma ve sütun eşlemeye ilerleme; kullanıcı yönetimi dialog'u; İstisna Kutusu; F1 rehber arama.

15 ekranın TR/EN × açık/koyu tema kombinasyonlarında 60 gerçek PNG kaydı alındı ve contact sheet'ler incelendi. LFL'nin okuma sonrası Devam perdesi geçilerek dört kombinasyonda veri ekranı kaydedildi. Modül dosyalarının başlangıçta istenmediği Resource Timing ile denetlendi. Üreticiler CSS yanıtı tutularak yeni görünümün gizli kaldığı, CSS serbest bırakıldığında stilli kontrollerin görünür olduğu gerçek tarayıcıda doğrulandı. Yeni animasyon motoru veya hareket ayarı eklenmedi.

Contact sheet kayıtları: [TR açık](startup-feature-assets-20261107/visual-tr-light.png), [TR koyu](startup-feature-assets-20261107/visual-tr-dark.png), [EN açık](startup-feature-assets-20261107/visual-en-light.png), [EN koyu](startup-feature-assets-20261107/visual-en-dark.png). Bunlar gerçek PNG kayıtlarından inceleme için küçültülmüş derlemelerdir.

Release note görseli `resources/app/public/release-notes/next-assets/startup-feature-assets.png`: gerçek uygulamada 30k sentetik fixture ile Backlog'a girilmeden açılan Üreticiler sipariş alt detayı, 1600×1000 PNG. `next.json` içinde yalnız bu PR'ın TR/EN kaydı eklendi ve P2 kapanışıyla güncellendi.

## Test sonucu ve PR durumu

- Güncel `63159fb3` tabanına rebase sonrası `npm test` **1290 test dosyası, 10 batch ile geçti**. IAM ve v714 kontrolleri de geçti. Test silinmedi, gevşetilmedi veya yeni skip eklenmedi.
- İlgili yükleme, import, spreadsheet, Backlog, LFL, lisans ve Veri Yönetimi sözleşmeleri geçti; yeni runtime yükleme testleri PR fast checks'e dahil.
- `npm run i18n:check`: yeni eksik 0, baseline eksik 0. `npm run release:notes:validate`: son gerçek PNG ile 39 kayıt geçti.
- Merge, TEST ve STABLE yapılmadı.

[Test ve tarayıcı kontrol listesi](startup-feature-assets-20261107/validation.json), [npm test özeti](startup-feature-assets-20261107/npm-summary.txt).


## P2 kapanışı — Üreticilerden ilk sipariş alt detayı

Bağımsız inceleme `54174143` üzerinde ortak drawer yerleşiminin yalnız `backlogAnalysis` grubuna bağlandığını buldu. [Doğrulandı] Bu revizyonda gerçek Chromium'da Overview → Üreticiler → **Siparişleri aç** yolu izlendi; Backlog'a girilmedi ve `BLPerf.isFeatureLoaded('backlogAnalysis') === false` kaldı. `backlog-plan-actual.css` için istek/link yoktu. 500 satırlık drawer'ın kökü ve `aside` öğesi `position: static`, display `block`, yüksekliği 21.819 px oldu. [RED JSON](startup-feature-assets-20261107/manufacturers-drill-red.json), [gerçek RED ekranı](startup-feature-assets-20261107/manufacturers-drill-red.png).

Önceki kabul smoke'u Üreticiler aramasını doğruluyor, sipariş alt detayı düğmesine ilerlemiyordu. Bu nedenle global `openItems()` bağımlılığı denetlenmiş olsa da ortak CSS bağımlılığı kaçtı. En küçük düzeltme `featureStyles.manufacturers` listesine `backlog-plan-actual.css` eklemektir. Loader, anchor, promise ve modül kodu değişmedi; kilitli dosyalara dokunulmadı.

Yeni runtime regression, ilk Üreticiler açılışının ortak CSS bitmeden tamamlanmadığını, sonraki Backlog yüklemesinin aynı öğeyi tekrar kullandığını ve iki grubun eşzamanlı isteğinde de tek ortak link oluştuğunu doğrular. Mevcut gerçek çağrı ve drawer sınıfı/CSS konumu da sözleşmeye bağlandı. Son testin aynısı `54174143` üzerinde yalnız bu eksik bağımlılıktan RED oldu; düzeltmeyle ilgili 37 test GREEN oldu. [RED test çıktısı](startup-feature-assets-20261107/manufacturers-unit-red.txt).

### Yalnız etkilenen ilk açılışın yeniden ölçümü

Sıra önce-1 → sonra-1 → önce-2 → sonra-2 → önce-3 → sonra-3. Önce: `54174143`; sonra: tek CSS manifest düzeltmesi (runtime SHA-256 ham kayıtta). Her koşu aynı arşivi yeni `/tmp/buyerlog-startup-p2-<variant>-<n>/source/` altına açtı; fixture metadata/hash eşitliği doğrulandı. Aynı backend veri/cache snapshot'ının ayrı kopyaları ve yeni HTTP browser context'leri kullanıldı. Core hazırlığı bittikten sonra özgün modül probe'undaki önceki Veri Yönetimi açılışı takip edildi. Bu seri, soğuk backend açılış serisi değildir; yalnız P2 düzeltmesinin ek yükünü ölçer. Ölçümle eşzamanlı test veya başka browser koşusu çalıştırılmadı.

| Ölçüt (ms), medyan (min–max), n=3 | P2 öncesi | P2 sonrası |
| --- | ---: | ---: |
| Üreticiler feature promise hazır | 29.5 (28.3–31.5) | 38.1 (31.0–42.1) |
| Üreticiler hesaplanmış ilk ekran hazır | 357.6 (354.4–367.9) | 385.3 (370.4–424.5) |

Üreticiler ilk ekrana kadar medyan ek maliyet 27.7 ms (+%7,7). Ortak CSS 8.404 decoded bayt, bu Chromium koşularında 2.610 transfer baytıdır. Düzeltilmiş 500 satırlık sipariş alt detayı tıklamadan iki frame sonrasına medyan 1.770,5 ms'de hazırdı. Öncesinde yerleşim bozuk olduğundan drawer sürelerinden hızlanma sonucu çıkarılmaz. Backlog kodu, bu ilk drawer açılışı sırasında yüklenmedi; daha sonraki Backlog feature çağrısında ortak CSS'in tekrar istenmediği denetlendi. [Altı ham ölçüm](startup-feature-assets-20261107/manufacturers-measurements.json).

Üreticiler açılmayan başlangıç yolu bu yeni stil bağımlılığına girmez. Özgün DCL/uzun görev serisi yeniden koşturulmadı; yukarıdaki rakamlar ölçülen eski revizyonun kanıtıdır. Runtime manifesti 26 bayt büyüdü: son statik senkron JS toplamı 5.643.431 bayt, script sayısı 112 ve blocking CSS sayısı 27'dir. Başlangıç CSS listesi/baytı değişmedi. Benchmark ve `scripts/lib/*` yine değiştirilmedi.

### Son tarayıcı ve test kabulü

TR/EN × açık/koyu tema için dört yeni normal ve dört geciktirilmiş ortak CSS koşusu **geçti**. Her biri yeni browser/context ile Overview → Üreticiler → Siparişleri aç yolunu izledi. İlk drill-down sırasında Backlog ziyaret edilmedi ve `backlogAnalysis` yüklenmedi. Her drawer sabit kök / absolute flex panel, 1280×1000 yerleşim ve 500 veri satırıyla açıldı; dildeki başlık/kapat kontrolü ve kapanma işlevi doğrulandı. CSS bekletildiğinde modül görünmez, feature tamamlanmamış ve drawer kapalı kaldı. Yanıt bırakıldığında stilli ekran açıldı. Sonraki Backlog yüklemesi aynı linki, tek isteği ve özgün anchor konumunu korudu. Browser page-error sayısı sekiz koşuda da 0. [Ham kabul JSON](startup-feature-assets-20261107/manufacturers-browser.json), [dört normal görünüm](startup-feature-assets-20261107/manufacturers-drill-green-matrix.png), [dört CSS bekleme/sonrası çifti](startup-feature-assets-20261107/manufacturers-drill-delayed-matrix.png). Matrisler gerçek kayıtlardan küçültülmüş inceleme derlemeleridir; incelendi. Bu görsel koşuların süreleri performans medyanlarına katılmadı.

Son runtime SHA-256 `b032111999aa6d63dcbec9ae2c163a963f82bada418a4a6432adaf8cfc4013e6` üzerinde ilgili **37 test** ve tam `npm test` **1290 dosya / 10 batch / 8916 test: 8851 pass, 0 fail, 65 mevcut skip** ile geçti (140.5 sn). Yeni skip yok. `i18n:check`: yeni/baseline eksik 0. `release:notes:validate`: 39 kayıt geçti; yalnız kendi TR/EN kaydı güncellendi ve gerçek değişiklik sonrası drawer PNG'si eklendi. Kod tam testten sonra değişmedi.

Yeni regression, PR fast checks'in mevcut lazy yükleme adımına dahildir. Gerçek CI sonucu [PR #914 kontrollerinde](https://github.com/clbiez/Buyer-Log-Desktop/pull/914/checks) dalın son commit'i için izlenir. Yeni genel inceleme turu açılmadı. Rebase, force-push, merge, TEST ve STABLE yapılmadı.
