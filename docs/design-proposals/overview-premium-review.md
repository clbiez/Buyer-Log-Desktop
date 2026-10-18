# Overview · Premium tasarım incelemesi / Premium design review

18 Ekim / October 2026 · Buyer Log 7.0.282

## Uygulama durumu / Implementation status

Premium yerleşim, KPI şeridi, termin ufku, koleksiyon vitrini, görsel aksiyonlar,
veri kapsamı ve OAB/INTAKE grafikleri gerçek uygulamaya aktarıldı. Aşağıdaki
tasarım demosu ilk öneriyi gösterir. Uygulamada haritanın eski renkleri ve
projeksiyonu korundu; rotalar gerçek referans liman/havalimanlarına bağlandı.
Temsili trendler ve doğrulanmamış bütçe oranları üretim arayüzüne aktarılmadı.

**EN:** The compact layout, KPI strip, delivery horizon, collection showcase,
visual actions, data coverage and OAB/INTAKE charts are implemented in the actual
application. The design demo below records the initial proposal. The application
retains the original map colours and projection and connects routes to real
reference ports/airports. Illustrative trends and unverified budget ratios were
not carried into the application.

Gerçek uygulama, anonim demo veri / Actual application with anonymous demo data:

- [Operasyon / Operations](../../resources/app/public/release-notes/next-assets/overview-premium-operations.png)
- [Ticari / Commercial](../../resources/app/public/release-notes/next-assets/overview-premium-commercial.png)
- [Referans rotalar / Reference routes](../../resources/app/public/release-notes/next-assets/overview-reference-routes.png)
- [Gerçek uygulamada rota hareketi / Route motion in the actual application](overview-premium-implementation-motion.gif)

Doğrulama: gerçek tarayıcıda TR/EN, üç tema, 390 px yerleşim, detaylar,
gizli grafik yenilemesi, hareket/durdurma ve azaltılmış hareket kontrol edildi.
1.033 test dosyasının tamamı çalıştırıldı. Tam koşu Horizon'ın aralıklı kişisel
kayıt testinde durdu; bu dosya tekil tekrarda 12/12 geçti, kalan dosyalar ayrıca
çalıştırıldı. OAB'nin değişen önbellek revizyonuna ilişkin beklentisi güncellenip
26/26 geçti. Paketin mevcut 66 koşullu atlaması korunur; TEST/STABLE yayımlanmadı.

**EN:** Real-browser checks covered TR/EN, three themes, 390 px reflow, details,
hidden chart refresh, motion/pause and reduced motion. All 1,033 test files ran.
The full run stopped on an intermittent Horizon personal-save test; that file
passed 12/12 in isolation, and the remaining files ran separately. OAB's cache
revision expectation was updated and passed 26/26. The suite retains its 66
conditional skips; no TEST/STABLE release was published.

## Önerilen yön / Recommended direction

**Görsel Komuta Masası / Visual Control Desk.** Kompakt bir üst bant, dört KPI,
ilk ekranda hareketli akış haritası ve kritik aksiyonlar; altta termin ufku,
sipariş dağılımı ve ürün vitrini. Operasyon ve Ticari görünümleri korunur.
Çelik mavisi, Barlow, köşeli kartlar ve mevcut tema tokenları kullanılır.

**EN:** A compact header and four KPIs lead into an animated flow map and critical
actions. Delivery horizon, order mix and a collection showcase sit below.
Operations and Commercial remain separate views, sharing Buyer Log's canonical
steel blue palette, Barlow typography, square geometry and theme tokens.

- [Etkileşimli demo / Interactive demo](overview-premium-study.html)
- [Karanlık / Dark](overview-premium-dark.png)
- [Açık / Light](overview-premium-light.png)
- [Ticari / Commercial](overview-premium-commercial.png)
- [Hareketli önizleme / Animated preview](overview-premium-motion.gif)

Demo tek HTML dosyasıdır; ağ, sunucu, kurulum veya uygulama oturumu gerektirmez.
Tema, dil, hareket/durdurma, açılışı tekrarlama, Operasyon/Ticari, Ülke/Sezon,
hafta seçimi ve detay açılışları çalışır. Bütün iş sayıları, trendler, ürün
silüetleri ve rotalar temsilidir. Saatler gerçek yerel saati gösterir.
Uygulamadaki iş akışlarına bağlı değildir.

**EN:** The offline HTML demonstrates theme/language selection, motion/pause,
entrance replay, two views, breakdown dimensions, week selection and detail
dialogs. Business metrics, trends, silhouettes and routes are illustrative;
clocks show actual local time. It is not connected to production workflows.

## İnceleme bulguları / Findings

Kaynak kodda 10 widget, 12 sütunlu düzen, en fazla 5 sayfa, sürükleme,
boyutlandırma, klavye kontrolleri, widget çekmecesi ve kullanıcıya özel kalıcılık
var. Mevcut haritada hareketli çizgiler, araç kümeleri, detay açılışları,
2D/3D ve Earth seçeneği bulunuyor. Koleksiyonda ürün görselleri, statü dilimleri
ve tekerlek/sürükleme ile çalışan üç satırlı ay revolveri zaten mevcut.

**EN:** Existing foundations include ten widgets, a 12-column layout, up to five
pages, drag/resize, keyboard controls, a widget drawer, per-user persistence,
animated map routes, vehicle clusters, detail views and a visual month selector.

Gerçek uygulama, ayrı veri kökünde 320 sentetik ASAS siparişiyle açıldı.
1440×1000 masaüstünde varsayılan Operasyon düzeninin ölçümü:

| Alan / Area | Yükseklik / Height | Ekranda başlangıç / Screen Y |
| --- | ---: | ---: |
| Dünya Saatleri / World clocks | 208 px | 112 px |
| Üretim Odağı + Notlar / Production + Notes | 430 px | 334 px |
| Kırılım + Aksiyonlar / Breakdown + Actions | 504 px | 778 px |
| Harita + Veri Kapsamı / Map + Coverage | 652 px | 1296 px |

Bu ölçüler varsayılan düzene aittir; kullanıcının kaydettiği düzen farklı olabilir.
En güçlü görsel öğe ikinci ekranın aşağısında kalıyor. Boş not kartı bile 430 px
yer ayırıyor. Kontrol listesi açıklamaları, tablo sütunları ve ayarlar ana özeti
kalabalıklaştırıyor. Kartlar küçük boyuta geçtiğinde içerik anlamını yeterince
değiştirmiyor; yalnız aynı içeriği dar bir kaba sıkıştırmak kompaktlık sağlamıyor.

**EN:** The strongest visual starts below the first viewport, an empty notes
widget still reserves substantial space, and explanatory text/settings/tables
compete with the summary. Small widget sizes need different content compositions.

Canlı demo açılışında JavaScript hatası görülmedi. Koleksiyon demo veri kümesi
boştu; OAB kurumsal oturumuna girilmedi ve INTAKE harici verisi çekilmedi.
Bu üç alanın dolu durumları kaynak kod üzerinden incelendi; kurum bağlantılarının
uçtan uca çalıştığı iddia edilmiyor.

**EN:** No JavaScript errors occurred in the demo session. Collection was empty;
corporate OAB login and external INTAKE retrieval were not exercised. Their
populated-state designs were reviewed in source, without claiming live validation.

## On widget için revizyon / Revisions to all ten widgets

| Widget | Tasarım / Design | Hareket ve davranış / Motion and behaviour |
| --- | --- | --- |
| **Dünya Saatleri / World clocks** | Büyük selamlama kartını 32–40 px zaman şeridine indir. TR/BD/IN/CN ve yerel saat; isteğe bağlı mini analog kadran. / Replace the greeting card with a 32–40 px time strip and optional tiny analog dials. | Yelkovan geçişi, gündüz/gece simgesi; tatiller tıkla açılan panelde. Mevcut ülke, saat dilimi ve tatil ayarları korunur. / Smooth hands and day/night indicators; holidays open on demand, preserving clock settings. |
| **Üretim Odağı / Production focus** | Altı önceliği etiketli, tıklanabilir dağılım bandı ve kısa sayaçlarla göster; üç ana risk nedeni ve kontrol özeti. / Six labelled priority segments, concise counts, top three reasons and a checklist summary. | Öncelik değişince segment ve sayı geçişi; seçim aksiyon listesini süzer. Retail/In Store hedefi görünür; kurallar ve uzun açıklamalar detayda. Hesaplanamıyor ayrı kalır. / Animate segments/counts; selection filters actions. Preserve target selection and a distinct Unknown state. |
| **Aksiyon Gerekenler / Attention** | İlk 3–5 kayıt: model görseli, tek satır neden, sipariş kimliği ve gecikme/tampon. / Show the top 3–5 records with image, reason, order key and delay/buffer. | Yeni kritik kayıt kısa kenar vurgusuyla belirir. Tıkla sipariş detayı; tamamı, sütun ayarı ve hariç tutmalar detayda. Hariç tutmak riski değiştirmez. / Briefly highlight new critical items. Open order details; retain full table, columns and exclusions without changing risk. |
| **Veri Kapsamı / Coverage** | Büyük açıklama kartını iki kısa ölçüye indir: tarih kapsamı ve hesaplanamayan kayıtlar. / Compact date coverage and uncalculable-record indicators. | Eksikler tıklanınca alan bazlı matris. Tarih eksiği, yol kuralı eksiği ve sistemde tutulmayan veri farklı gösterilir. / Open a field matrix, distinguishing missing dates/rules from unsupported data. |
| **Aktif Sipariş Kırılımı / Breakdown** | Sıralı yatay çubukları koru; ilk 4–5 kategori + Diğer. Sezonda yığılmış öncelik çubukları. / Keep ranked bars; show top categories plus Other, with stacked priority bars for seasons. | Boyut değişiminde çubuklar sıralanarak geçiş yapar; etiket ve sayı sabit okunur. Country/Sub-Manufacturer/Season drill korunur; Buying Group drill ayrıca bağlanmalıdır. / Animate dimension changes; preserve existing drills and add the currently missing Buying Group drill. |
| **Not Hatırlatıcısı / Notes** | Doluysa en fazla 2 kısa not; boşsa yalnız küçük not sayacı. / Up to two compact notes, collapsing to a small indicator when empty. | Not genişleme animasyonu; siparişler detayda. Yalnız kullanıcının kendi notları, mevcut düzenleme/silme ve sıralama davranışı korunur. / Animate expansion while preserving ownership, editing, deletion and sorting. |
| **Global Flow Map** | İlk ekranın ana görseli; sade başlık, kaynak/ölçü ve en fazla 2–4 mini KPI. / Main visual in the first viewport, with compact source/unit controls and a few KPIs. | Rota boyunca parçacıklar, yumuşak düğüm halkaları, seçimde rotanın öne çıkması. 2D/3D/filtre/yenile/tam ekran korunur; Earth tercihi isteğe bağlıdır. / Moving particles, soft node pulses and route selection; preserve map controls and optional Earth. |
| **Koleksiyon / Collection** | Mevcut ay revolverini koru; seçili ayın ürün görsellerini büyüt, miktar/model/statüleri tek bantta göster. / Retain the month revolver and enlarge selected-month product images, with compact counts and status mix. | Ay değişiminde görsel ve statü geçişi; hover/odakta ürün büyütme, tıkla ay/statü/model detayı. Otomatik kayan ürün vitrini yalnız sunum kipinde. / Animate month changes and product focus; retain month/status drills, with autoplay only in presentation mode. |
| **OAB** | Pivotun önüne bütçe kullanım halkası, kullanılabilir pay ve birkaç kategori karşılaştırması. / Budget utilisation ring, available balance and category comparisons ahead of the pivot. | Halka ilk girişte dolar; kategori seçimi detay pivotuna taşınır. Veri çekme ilerlemesi aşamalı kalır. Sezon/MAG/Buyer Group çoklu seçimi, ham veri ve Excel korunur. / Animate ring entry and progress stages; retain multi-select scope, raw data and Excel. |
| **INTAKE** | Plan/gerçekleşen için bullet chart: gerçekleşen yatay dolgu, plan dikey işaret. / Bullet charts compare actual orders against plan. | Dönem değişince dolgu geçişi; seçim pivot detayını açar. Dinamik pivot, ölçü/alan ayarları, Horizon ve kapsam kaybolmaz. / Animate period changes; preserve dynamic pivot configuration, Horizon and scope. |

## Yeni widget seçenekleri / New widgets

1. **Termin Ufku / Delivery Horizon — ilk öncelik.** Önümüzdeki 7/14 günün
   planlı yükleme adetleri; riskli pay ayrı renkte, gün seçimi siparişleri açar.
   Tarihi olmayan kayıtlar ayrı sayaçtır. Mevcut tarih/öncelik verisinden
   hesaplanabilir; tahmin gibi sunulmaz.
   **EN:** Planned loading by day, with an at-risk share and explicit missing-date
   counts. Uses current dates/priorities; it is not a predictive forecast.
2. **Onay Darboğazları / Approval Bottlenecks.** PPS, Artwork, S/Off, kumaş ve
   diğer açık kontroller için küçük karşılaştırmalı çubuklar. Tıklanan kontrol
   ilgili siparişleri açar. Bunlar örtüşebilen kontrol kümeleridir; tekil sipariş
   sayısı gibi toplanmaz ve zorunlu sıralı bir funnel oluşturmaz.
   **EN:** Compare open checks using independent bars. Checks can overlap and
   must not be summed as distinct orders or misrepresented as a sequential funnel.
3. **Son Yenilemede / Since Last Refresh.** Yeni kritikleşen, yüklemesi değişen
   ve riski azalan kayıtların üç küçük sayacı; tıklayınca değişiklik listesi.
   İki karşılaştırılabilir anlık görüntü ve aynı filtre/kimlik sözleşmesi gerekir.
   **EN:** Newly critical, rescheduled and improved orders, requiring comparable
   snapshots with consistent keys and scope.
4. **Yükleme Yoğunluğu / Loading Concentration.** Üretici × hafta ısı haritası.
   Gerçek kapasite verisi olmadan yalnız planlı adet/sipariş yoğunluğu gösterilir;
   “kapasite kullanımı” veya “kapasite aşıldı” denmez.
   **EN:** Supplier-by-week planned loading heatmap. Without actual capacity data,
   describe concentration rather than utilisation or overload.
5. **LCW AI Kısa Brifing / LCW AI Briefing — ikinci aşama.** En fazla iki kısa
   operasyon bulgusu ve dayandıkları kayıtlara bağlantı. Kullanıcı istediğinde
   mevcut LCW AI motoru üzerinden çalışır. Sayaçlar deterministik hesaplanır;
   AI ekran açılışını veya grafik çizimini bekletmez.
   **EN:** An on-demand, evidence-linked briefing through the existing LCW AI
   engine, with deterministic metrics and no blocking of dashboard rendering.

## Hareket tasarımı / Motion specification

| Tetik / Trigger | Görsel davranış / Treatment | Hedef süre / Target duration |
| --- | --- | --- |
| İlk açılış / Entrance | Önce KPI, sonra harita/aksiyonlar, ardından alt grafikler; küçük yükselme ve opaklık. / Staggered KPIs, hero, then supporting charts. | Bileşen 190 ms; tüm koreografi 600–900 ms. / 190 ms per panel, 600–900 ms total. |
| Sayaç / Counters | İlk yüklemede kısa sayım; sonunda kesin ve yerel biçimli değer. / Count to the exact localised value on first load. | 500–850 ms |
| Sürekli sahne / Ambient | Haritada hareketli rota parçacıkları; 3–5 saniyelik seyrek düğüm halkaları. / Route particles and occasional node pulses. | Rotalar 5–12 sn; harita 20–30 fps hedefi. / 5–12 s routes, 20–30 fps map target. |
| Filtre ve grafik / Filters | Sayılar ve çubuklar yeni değerlere geçer; odak ve etiketler sabit kalır. / Transition values and bars while preserving labels/focus. | 170–300 ms |
| Yeni kritik olay / New critical item | Kısa kenar ışığı ve yeni kayıt geçişi; sürekli yanıp sönmez. / Brief edge highlight and row entrance. | 700–1000 ms |
| Ürün / Product | Hover veya klavye odağında küçük büyüme; tıklanınca görsel detay. / Subtle scale on hover/focus with image detail on click. | 170–250 ms |
| Sürükleme / Layout | Mevcut FLIP yer değiştirme, hücre önizlemesi ve komşu yer açma. / Preserve FLIP motion, grid preview and collision handling. | Mevcut 190 ms / Existing 190 ms |

Görsel şovun ağırlığı haritada olur; diğer kartlar etkileşim ve veri değişimiyle
hareket eder. Sunum kipinde daha belirgin rota ışığı ve otomatik vitrin açılabilir.
Azaltılmış hareket tercihi, görünmeyen widget/sayfa/sekmede durdurma ve kullanıcı
kontrollü hareket düğmesi gerekir. Görünen hareket veri yenilendiği anlamına gelmez;
her kaynak kendi veri zamanını ve yükleme/hata durumunu gösterir.

**EN:** Concentrate continuous visual motion in the map, and trigger other motion
through interaction/data changes. Offer a stronger presentation mode while
respecting reduced motion, visibility and pause controls. Animation never implies
freshness; each source retains its own timestamp and loading/error state.

## Veri ve uygulama sınırları / Data and implementation boundaries

- **Kapsam / Scope:** CP sipariş satırı, tekil sipariş, Backlog parsiyeli ve adet
  farklı ölçülerdir; ortak KPI gibi toplanmaz. Kaynak/ölçü etiketleri görünür kalır.
  / CP rows, distinct orders, Backlog partials and units have different grains.
- **Geçmiş / History:** KPI sparkline ve “düne göre” için saklanmış karşılaştırılabilir
  günlük özet gerekir. Mevcut tek görüntüden çizgi uydurulmaz. / Historical trends
  require stored comparable aggregates, not an invented line from one snapshot.
- **Bütçe / Budget:** OAB/INTAKE alan eşlemesi ve ölçü birimi uygulamadan önce
  doğrulanır. Oranlar toplam pay/toplam paydadan hesaplanır; yüzde ortalaması
  alınmaz. Kalan bütçe negatifse aşım olarak gösterilir. / Verify field/unit mapping,
  use ratio-of-sums, and represent negative availability as overrun.
- **Hesaplanamıyor / Unknown:** Eksik kural/tarih yeşil “yolunda”ya dönüşmez.
  Örtüşen neden/kontrol sayıları tekil sipariş toplamını şişirmez. / Missing data is
  never presented as On Track, and overlapping reasons do not inflate order counts.
- **Görseller / Images:** Üretimde mevcut kanonik görsel çözümleyici kullanılır;
  silüet yalnız görsel eksikliğinde fallback olur. / Use canonical product images;
  silhouettes are a missing-image fallback.
- **Düzen / Layout:** Mevcut minH/minW değerleri bu kompakt kurguyu sınırlıyor.
  Küçük/orta/büyük içerik sözleşmeleri ve boyut sınırları birlikte güncellenmeli.
  Kullanıcının mevcut düzeni korunmalı; yeni düzen seçilebilir hazır şablon olmalı.
  / Add meaningful size variants and retain saved user layouts as an opt-in preset.
- **Çift vitrin / Two showcases:** Mevcut motor aynı widget anahtarını yalnız bir
  sayfaya koyar. Operasyon'da küçük koleksiyon özeti ile Ticari'de tam koleksiyon
  istenirse ortak veri modelinden beslenen ayrı widget anahtarı gerekir.
  / A compact Operations summary needs a separate key from the full Commercial
  collection widget because widget instances are currently unique across pages.
- **Tasarım sistemi / Design system:** Üretim CSS'i mevcut token ve primitive'leri
  tüketir; ayrı renk/bileşen sistemi eklenmez. / Production uses existing tokens
  and primitives, without creating a second palette/component system.

## Uygulama sırası ve kabul / Sequence and acceptance

**1 — Görsel temel / Visual foundation:** kompakt saatler, KPI bandı, haritayı
yukarı alma, küçük/orta/büyük kart varyantları, kısa aksiyon listesi, boş not ve
veri kapsamını daraltma. Mevcut veriyle yapılabilir. / Compact clocks, KPIs, a
first-viewport map, size variants and concise action/notes/coverage summaries.

**2 — Grafik ve görseller / Charts and visuals:** Termin Ufku, büyütülmüş ürün
vitrini, bütçe grafikleri ve grafik→detay bağlantıları. Bütçe ölçülerinin doğrulaması
bu aşamanın parçasıdır. / Delivery horizon, product imagery, verified budget charts
and chart-to-record navigation.

**3 — Zengin hareket ve geçmiş / Rich motion and history:** daha belirgin harita
parçacıkları, yeni olay vurguları, günlük KPI geçmişi, değişiklik sinyalleri ve
isteğe bağlı sunum kipi. / Richer map effects, event highlights, stored KPI history,
change signals and optional presentation mode.

Kabul hedefleri: 1440×900'de temel özetin kaydırmadan görünmesi; 1366×768'de harita,
kritik aksiyonlar ve KPI'ların ilk ekranda kalması; daha dar görünümde kart sayısını
azaltıp yeniden akıtma. Metinleri aşırı küçülterek sığdırma yapılmaz. Her grafiğin
tek tık/klavye ile ilgili kayda geçmesi; düşük hareket kipinde aynı bilginin
korunması; kesin sayım ve kaynak kapsamının aynı kalması gerekir.

**EN:** Aim for the main summary within 1440×900, with KPIs/map/critical actions
above the fold at 1366×768. Reflow rather than shrinking text. Charts must link to
records by pointer/keyboard, preserve information with reduced motion and retain
the same exact counts and source scopes.

Prototip doğrulaması: 1440×900'de ana beş panel 223–789 px aralığında, yatay taşma
yok. 390 px genişlikte yatay taşma yok. Üç tema, TR/EN, rota detayı, kırılım/hafta
değişimi, Ticari görünümü, hareket/durdurma ve azaltılmış hareket kontrol edildi.
JavaScript hatası ve dış ağ isteği yok. Bu doğrulama tasarım demosuna aittir;
uygulama performans veya regresyon testi yerine geçmez.

**EN:** The prototype fits its five main panels between Y=223 and Y=789 at
1440×900, without horizontal overflow at desktop or 390 px width. Themes,
languages, interactions and reduced motion were checked, with zero JS errors
and external requests. These are prototype checks, not production regression or
performance measurements.

## Kaynak dayanakları / Source references

- `resources/app/public/index.html:619` — widget kabuğu / widget shell.
- `resources/app/public/overview-layout.js:20` — katalog, boyutlar, varsayılan
  sayfalar / registry, size constraints, defaults.
- `resources/app/public/overview-home.js:62` — FLIP ve düzen uygulama / layout motion.
- `resources/app/public/overview-launchpad.js:310` — saat güncelleme ve görünürlük / clocks.
- `resources/app/public/cp-overview-assistant.js:484` — üretim, kontrol, aksiyon,
  kapsam / production, checklist, attention and coverage.
- `resources/app/public/overview-breakdown.js:76` — grafik ve drill / charts and drills.
- `resources/app/public/overview-global-flow.js:1437` — hareketli rotalar / route animation.
- `resources/app/public/overview-collection-dashboard.js:150` — vitrin, ay revolveri / collection.
- `resources/app/public/overview-collection-summary.js:186` — aylık özet hesabı / month model.
- `resources/app/public/app-main.js:10571` — kullanıcıya ait notlar / owned notes.
- `resources/app/public/oab.js` / `intake.js` — bağımsız kaynak ve pivotlar / sources and pivots.
- `DESIGN_SYSTEM.md` — kanonik tasarım sözleşmesi / canonical design contracts.

Bu teslim tasarım önerisi ve demo dosyalarıdır; üretim uygulamasına değişiklik,
PR, merge veya TEST/STABLE yayını yapılmadı.

**EN:** This delivery contains a proposal and demo artifacts only. Production was
not modified; no PR, merge or TEST/STABLE release was performed.
