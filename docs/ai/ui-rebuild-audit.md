# Buyer Log UI yeniden inşası — Faz 0A

Kaynak: `0a5d9fbb` (7.0.294), yerel dal `ui-rebuild/phase-0-audit`.
Bu faz üretim dosyalarını değiştirmez. Kullanıcı görevi, eski mimari/katman
kısıtlarının ve ara faz tam test kuralının üstündedir. Konsept seçimi yapılmadan
Faz 1, pilot onayı verilmeden Faz 2 başlamaz.

## Kanıt ve tekrar üretim

- Gerçek `server/server.js`, ayrı geçici veri kökü ve gerçek Chromium; mockup yok.
- `generate-demo-data.build({rows:220,seed:7,today:new Date('2026-10-25T12:00:00Z')})`.
  Kaynak 220 sipariş; teslim edilmişler elendiğinde aktif CP 191 satır. ASAS,
  Antrepo ve LFL gerçek ayrıştırıcıdan geçer. Hiçbir şirket dosyası kullanılmaz.
- Chromium 154.0.8037.57, Node 24.19.0, Linux; 1440×900, standart ölçek, UTC/TR.
  Windows/Office/Electron sonucu olarak yorumlanmaz. Native Excel pivot yenilemesi
  bu ortamda yoktur; sentetik çalışma kitapları doğrudan ayrıştırılır.
- Araçlar: [session.cjs](ui-rebuild/tools/session.cjs),
  [capture-baseline.cjs](ui-rebuild/tools/capture-baseline.cjs),
  [evidence.cjs](ui-rebuild/tools/evidence.cjs),
  [performance.cjs](ui-rebuild/tools/performance.cjs),
  [inventory.py](ui-rebuild/tools/inventory.py).
- [Ana görüntü manifestosu](ui-rebuild/evidence/baseline/capture-manifest.json):
  üç temada ana modüller, Overview ticari sayfası ve açılış. Her PNG gerçek
  uygulamanın kayıpsız ekran görüntüsüdür. Contact görselleri yalnız inceleme
  dizinidir; tekil PNG'lerin yerine geçmez.
- [Pencere, export ve erişilebilirlik örneklemi](ui-rebuild/evidence/baseline/overlay-export-a11y.json).
  Aynı görünüm ailesini kullanan her modal için tekrar görüntü üretilmedi.
  Eski gizli `#navColsBtn` tıklama denemesi başarısızdır; görünür giriş
  `[data-table-fields="cp"]` ayrıca incelenir. Bu hata ürün arızası sayılmaz.

## Ekran ve durum envanteri

`index.html` içinde 16 görünüm vardır; 15'i sol menüden açılır.
`pricinghistory`, Fiyat Masası içinden erişilen eski bağımsız görünüm kancasıdır.
`license-atlas/index.html` ayrı gömülü yüzeydir. `design-preview.html` ürün dışı
tasarım örneğidir; son temizlikte taşınması veya kaldırılması ayrıca kararlaştırılır.

| Aile | Görünümler / alt durumlar | Başlangıç kanıtı ve göç grubu |
| --- | --- | --- |
| Kabuk | geniş/dar ray, üst çubuk, ortak eylem ve filtre çubuğu, kullanıcı menüsü, tema/boyut, kaydetme/yenileme/bağlantı durumları | Tüm ana PNG'ler; Faz 1 |
| Overview | Operasyon, Ticari; saatler, nabız, termin, kırılım, harita 2D/3D/Earth, not, kontrol/kurallar, kapsam, koleksiyon, OAB, INTAKE; düzenleme ve widget çekmecesi | `overview-*`, `overview-commercial-*`; Faz 1 + kalan durumlar Faz 2.4 |
| CP Tracker / Siparişler | tümü/odak/genişletilmiş, alanlar, parsiyel görünüm, satır aralığı, arama, sütun filtresi, çoklu seçim, düzenlenebilir hücre, PLM/araçlar/daha fazla, kopya/export | `cp-*`, `orders-*`; pilot + Faz 2.1 |
| Backlog | genel bakış, koleksiyon analizi, detay, pivot, plan/gerçek, teslimat analizi, tarih aralığı, sunum, export | `backlog-*`; Faz 2.1 |
| Nakliye | kaynak seçimi/yükleme, karşılaştırma tablosu, sütunlar, gizli satırlar, navlun düzenleme | `shipping-*` kaynak bekleyen durum; Faz 2.1 |
| Koleksiyon | çalışma alanı, modeller/renkler, spreadsheet, yeni model, filtre/alanlar, PLM aktarım, kumaş kartı, fiyat, dosyalar, geri dönüşüm, yönetim listeleri | `koleksiyon-*` boş çalışma alanı; Faz 2.2 |
| Fiyat Masası / Geçmiş | masa, teklifler, fiyat analizi; üretici/satır detayları; fiyat toplama/önizleme/sonuç, geçmiş ve not | `quotations-*` boş masa; Faz 2.2 |
| Fiyat & Üretici Analizi | filtreler, KPI, fırsat ve risk listesi, üretici/ülke grafikleri | `priceanalysis-*` dolu; Faz 2.2 |
| Üreticiler | liste, portföy, performans, iletişim ve sipariş detayları, ekle/düzenle | `manufacturers-*` dolu; Faz 2.2 |
| Lisans kartları | liste/kart, lisans detayı, üretici atlası, harita editörü, royalty | `licensecards-*` dolu liste; Faz 2.2 |
| LFL | filtre, KPI, fiyat/ülke/üretici kırılımı, portföy ve erişim pencereleri | `lfl-*` dolu; Faz 2.2 |
| Ön Maliyet | model/dosya listesi, yeni karşılaştırma, fiyat/kur, kıyas ve Excel şablonu | `opencosting-*` boş; Faz 2.2 |
| Veri Yönetimi | entegrasyonlar, kaynak dosya seçimi, horizon, FX, model eşleme, veri bakımı, paylaşımlı sync, izin ve hata/ilerleme | `source-*`; Faz 2.3 |
| Kullanıcılar | kullanıcı, rol, şablon, hiyerarşi, yetki, veri kapsamı ve davet diyalogları | `users-*`; Faz 2.3 |
| Otomasyonlar | liste, kural editörü, alan kataloğu, formül, önizleme ve AI yönergesi | `automations-*` boş; Faz 2.3 |
| LCW AI | giriş, oturum listesi, metin/çıktı alanı, bağlam, dosya/şablon ve çıktı editörü | `lcwai-*` oturum bekleyen durum; Faz 2.3 |
| Yardım / geçmiş | komut paleti, rehber, PLM rehberi, sürüm arşivi/detayı, bildirim geçmişi | `command-palette-*`, `guide-*`, `release-notes-*`, `notifications-*`; Faz 2.3 |
| Giriş / başlangıç | kullanıcı arama, seçili kullanıcı, parola kurma, hata, shared hub ayarı, güncelleme, boot hazır/yükleniyor/hata/tekrar | `sign-in-*`, `startup-*`; Faz 1 + Faz 2.4 |

Bütün kaynak konumları ve dinamik kancalar makinece aranabilir eklerdedir:
[surface-id.json](ui-rebuild/evidence/baseline/surface-id.json),
[view-id.json](ui-rebuild/evidence/baseline/view-id.json),
[js-hook.json](ui-rebuild/evidence/baseline/js-hook.json),
[data-hook.json](ui-rebuild/evidence/baseline/data-hook.json).
142 benzersiz **yüzey kimliği adayı** modal sayısı değildir: başlıklar, menü
tetikleyicileri ve template kimlikleri de dahildir. JS tarafından sınıfla
üretilen kullanıcı yönetimi/rehber/AI pencereleri yukarıdaki ailelere dahildir.

### Pencere ailelerinin kapsamı

- Ortak `modalCard` / `warnOverlay`: metin girişi, kaynak filtresi gereksinimi,
  sütun adı/CP model sütunu, Supp.FOB, royalty/landed/transit kuralları,
  uyarı ve yenileme özeti, bildirim, yenileme hatası, browser/sync/model görsel
  ayarları, Backlog pivot/export/detay, navlun, Endeksmatik/set,
  koleksiyon hızlı filtre/import/PLM/kumaş/liste/dosya/geri dönüşüm/fiyat,
  e-posta konu editörü, sütun senkronu ve senkron önizlemesi.
- Sütun/filtre popover ailesi: `navColPanel`, CP/Sipariş beş boyut filtresi,
  header value filter, `gridClipboardMenu`, `_tableFieldsMenu`, PLM/araçlar/
  daha fazla menüleri; LFL ay/ülke/MAG/MMYG/lisans/üretici/buyer/kumaş
  filtreleri; INTAKE ve koleksiyon kapsam seçimi; Nakliye sütun/gizli satırlar.
- Çekmece ailesi: `blSharedDetailDrawer`, `blvDrawer`, `bpaDrawer`,
  `globalFlowDrawer`, koleksiyon kapsam sütunu, Overview widget çekmecesi,
  CP kontrol/kurallar ve sağ bağlam panelleri.
- Ayrı kabuklar: native `dialog` rehberi ve sürüm notları; kullanıcı yönetimi
  `umOverlay`; fiyat masası erişim/not/teklif ve geçmiş penceresi; LFL portföy/
  deneme/erişim; Ön Maliyet kıyas/kur; LCW AI login/output/layout; boot ve
  engelleyici yenileme perdesi. Bunları tek modal CSS kuralına körlemesine
  bağlamak scroll, focus trap ve katman sırasını bozabilir.

## Stil ve bileşen bulguları

[inventory-summary.json](ui-rebuild/evidence/baseline/inventory-summary.json)
CSS, HTML ve JS template/inline stillerini tarar; vendor ve arşiv sürüm notları
kapsam dışıdır. Leksik tarama ölü kod/yorum/export stillerini ayırt etmez;
sayılar hata sayısı değil göç arama kümesidir.

| Tür | Geçiş | Benzersiz değer/ad |
| --- | ---: | ---: |
| Ham renk literal'i | 1.732 | 840 |
| font-size | 3.055 | 90 |
| font kısayolu | 575 | 201 |
| radius | 1.381 | 67 |
| border | 2.798 | 308 |
| z-index | 313 | 110 |
| animation/transition | 486 | 315 |
| keyframes | 100 | 97 |
| Düğme/rozet/sekme/KPI/kart sınıfı adayı | 2.705 | 639 |

Her geçişin dosya ve satırı aynı klasördeki ayrı JSON'dadır. `app.css` 6.035
satırdır; `design.css`, `experience.css`, `design-butunluk.css` ve modül
stilleri aynı öğeyi art arda tekrar tanımlar. Yeni sistemi bu zincirin sonuna
kalıcı bir override olarak eklemek borcu artırır; prototip dışında yapılmaz.

**[Doğrulandı]** eşdeğer eylemler `.tbtn`, `.navActionBtn`, `.cpaBtn`, `.mfpBtn`,
`.psaGhostBtn`, `.lcBtn` ve modül sınıflarıyla; segmentler `.cpaSeg`, `.gfSegment`,
`.dmViewToggle`, `.lcSeg`, `.ovPremiumSegment` ile çoğalır. Mevcut component
guard belirli selector metinlerini arar; tüm runtime varyantlarının aynı
göründüğünü ispatlamaz. Overview 12 sütun widget mekanizması işlevseldir;
eşit çerçeveli kartlar görsel hiyerarşiyi zayıflatır.

**[Doğrulandı]** `--r-pill:999px`, `--r-round:50%` toggle/handle/düğme istisnaları,
harita canvas daireleri, ring/donut KPI'lar, datepicker ve bildirimler yeni
geometri kuralıyla uyumlu değildir. Dairesel avatar/durum noktası dışındaki
istisnalar kaldırılmalıdır. SVG ikon çizgisinin içindeki daire ile dairesel
kontrolün hit box/geometrisi birbirinden ayrılmalıdır.

**[Doğrulandı]** açılış stili `index.html` içinde ham palet, `14px/11px/10px`
yazı ve 2147483647 katmanı taşır; CSS guard yalnız üst düzey `.css` dosyalarını
taradığı için bunları yakalamaz. `giris.css` ayrı ölçek/palettir, yalnız açık
görünümü tanımlar. `--mono` Cascadia/OS fallback'ine dayanır, font paketli değildir.
Yerel Barlow latin + latin-ext vardır; mevcut 400/500/700 ağırlıkları ve
Barlow Condensed 400/600 korunabilir veya lisansıyla paketli fontla değişebilir.

**[Doğrulandı]** tema dalgası 1150ms; arka plan, genişlik, gölge ve renk
animasyonları var. Boot `blBootBgIn` background-color, `ovHomePulse` box-shadow,
ray width/padding transition, `.ovHomeDot` width transition; yeni hareket
sözleşmesiyle uyuşmaz. Canvas harita ve sayan KPI da ayrıca ele alınmalı.

## Erişilebilirlik

Başlangıç ölçümü görünür metnin computed rengini ata yüzeyleriyle birleştirir;
opacity, arka plan resmi ve örtüşmeyi tam çözmez. Örnekler:

- Açık ray `--muted #627184` / `#f0f3f6`: **4,47:1** (hedefin altında).
- Moderatör etiketi `#3f7757` / `#e3ede6`: **4,39:1**.
- Grey harita mor değer `#7c5ce0`: **3,45:1**.
- Gradient-clipped avatar metni hesaplamada transparent görünür; otomatik
  1:1 bulgusu metnin görünmezliğini ispatlamaz. Yeni dilde gradient kaldırılır.

Odak örneklemi her temsilî diyalogda altı Tab adımını kaydeder. Bu tam klavye
sertifikası değildir. Bazı modallar focus'u diyalog içine almadan açılıyor;
`role=dialog` tek başına trap değildir. Sütun filtre/çekmece/menü açılışı,
Escape, focus geri dönüşü ve modal üstüne popover pilotun zorunlu kontrolüdür.
Mevcut yarı saydam `--focus-ring` yerine ≥3:1 opak belirgin outline gerekir.
Durum etiketleri, sayılar ve semboller tutulur; yalnız renk anlam taşımaz.

## Export sözleşmesi

**[Doğrulandı] tasarım belgesindeki “tüm export canlı --thead okur” ifadesi
güncel kod için fazla geniştir.** `app-main.js:7842` sabit
`EXPORT_LIGHT_*` paleti, `exportSemanticPalette`, `buildManagedTableStyledCopy`
ve `exportStyledDomTable` CP/Sipariş için kayıt tabanlı renk kullanır. Başlık
`#F2F4F7 / #54595F`, gövde `#101828`; öncelik/durum tarih ve alt üretici
renkleri bu palette kalmalıdır. CP/Sipariş XLSX fontu ayrıca sabittir.

`cp-copy-{light,grey,dark}.{html,tsv}` ve `cp-export-{light,grey,dark}.xlsx`
anonim referanslardır. XLSX ZIP zamanı/creator tarihini eşdeğerlik ölçütüne
katmadan sheet XML, styles XML, sharedStrings, birleştirmeler, numFmt ve
sütun ölçülerini karşılaştır. İlk üç tema için sheet ve styles XML birebirdir.

Kalan riskler:

1. `_copyVisualStyle` açık temada DOM renk/ağırlık okur; koyu/grey için dar
   sabit rozet eşlemesi vardır. Koleksiyon/diğer generic kopya bu yola girebilir.
2. `_xlsCellFromTd` palette verilmezse computedStyle okur. Nakliye gibi
   kayıt paleti olmayan generic tablolar etkilenir.
3. XLSX sütun genişliği header bounding box'tan; sadece tipografi/spacing
   değiştirmek bile biçim farkı yaratabilir. Pilot CP karşılaştırması bunu kapsar.
4. Backlog, koleksiyon fiyat/export ve LCW AI dosya tema üreticileri ayrıca
   incelenir; belge/sunum CSS'i uygulama CSS'inin istisnası olarak ayrı tutulur.

Göçte önce mevcut referans değeriyle sabit **export** paleti oluştur; ekran
tokenını export'a geri bağlama. Export CSS'ine yuvarlak/kenarlık yasağı uygulama:
Excel'in mevcut `thin` hücre çizgisi kullanıcı sözleşmesidir.

## Performans ve lazy yükleme

`BLPerf.begin/end/record`, `snapshot()` ve `timeline()` gerçek ölçüm kaynağıdır.
Başlangıç `firstUsableInteractionMs` insanın boot rehberini okuma süresinden
ayrıdır. `performance.json` beş aynı senaryo örneğini ve medyanları saklar.
5.000 satır denemesi gerçek CP render yolunda bellek içi anonim satırlarla,
normal sayfalama ile yapılır; “5.000 DOM satırı” iddiası değildir.

Geçerli medyanlar: açılış **1.020,1 ms**, ilk CP geçişi **975,4 ms**,
5.000 kaydın hesaplanıp yeni kimliklerle DOM'a ulaşması **2.995,9 ms**;
görünen satır sayısı her örnekte 50. İlk araç denemesinde CDP context cookie
okuması yanlış hedefe gittiği için girişe yönlenen örnekler atıldı. İki frame
bekleyen ilk büyük tablo ölçümü de lazy hesaplamanın bitişini beklemediği için
geçersizdi; yalnız bu ölçüm, yeni satır kimliği DOM koşuluyla düzeltildi.
Ham dosyada geçerli startup örnekleri korundu, büyük tablo örnekleri yenilendi.

`perf-runtime.js` feature registry korunur. LFL, maliyet, üreticiler, lisans,
otomasyon ve LCW AI açılmadan init/render edilmez. Overview'in CP verisi
istemesi CP tablosunun render edilmesi değildir. Audit araçlarının sırayla
sayfa açması üretim eager render değişikliği değildir.

## Guard planı ve hedefli kontroller

Başlangıçta altı ilgili test dosyası **28/28 geçti**:
design-token-guard, ui-component-contract, theme-copy-performance,
table-range-excel-export, perf-runtime-existing-static-script,
navigation-revisit-perf. [Ham log](ui-rebuild/evidence/baseline/targeted-tests.log).
Bu başarı yeni kullanıcının tüm tasarım koşullarının sağlandığı anlamına gelmez.
Tam `npm test` çalıştırılmadı. i18n/release/version sözleşmeleri değiştirilmedi.

Yeni guard'lar:

- CSS AST + HTML style + UI JS template stillerini kapsa; renk/token
  tanımını ortak token kaynağına sınırla. Tanımsız var() ve fallback ile
  gizlenen tanımsız tokenı yakala; font shorthand dahil px sızıntısını yakala.
- Radius computed değeri ≤2px; yalnız avatar/durum noktası için isimlendirilmiş
  dar istisna. Canvas/SVG chart marker'ları kaynak ve runtime kontrolüyle kapsa.
- Border/box-shadow inset ile sahte çerçeve yasak; yalnız focus outline,
  yoğun tablonun tek düşük kontrastlı yatay çizgisi ve chart veri çizgileri.
- Semantik bileşen sözleşmesi ve durum testleri: hover/focus/active/selected/
  disabled/loading/empty/error. Eski selector snapshot'larını birebir tutmak
  yerine yeni gerçek sözleşmeyi daha kapsamlı doğrula; test anlamını azaltma.
- Göç edilmiş modüller için eski appearance alias ve uyumluluk katmanı
  bağımlılığı yasağı. Kaynak kayıt listesi görünür göç kapsamını tanımlar;
  hata saklayan baseline/istisna genişletme değildir.
- `design-color-baseline.json` yalnız düşer. Yeni renkler token tanımlarıdır;
  export/print/mail literal istisnası dosya/fonksiyonla dar ve belgeli olur.
- z-index içerik/sticky/kabuk/popover/modal/toast/engelleyici olarak anlamlı
  tokenlara iner; sayıları küçültmeden önce overlay üst üste açılışı doğrulanır.

## Göç ve risk sırası

1. Faz 0B: ayrı geçici dallar; Overview + CP, iki özgün dil, üç tema, yerel
   fontlar. Prototip üretime merge edilmez. Kullanıcı seçimi zorunlu kapıdır.
2. Faz 1: tek token kaynağı (giriş ve boot dahil), primitive/component sistemi,
   export ayrımı, pilot Overview/CP/modal/grafik. Uyumluluk katmanı yalnız
   henüz taşınmamış modüller içindir; kullanım listesi ve kaldırma tarihi yazılır.
3. Faz 2.1–2.4: kullanıcı gruplama sırasıyla ayrı bağımlı branch/PR. Görünüm
   ortak sistemden; modül CSS'i yalnız yerleşim ve veri düzeni. JS id/class/data
   kancaları korunur; canonical ID ve LCW AI tek motoru değiştirilmez.
4. Faz 3: kullanım kalmadığı kanıtlanan stiller ve `design-butunluk.css` kaldırılır;
   gerçek tasarım belgesi yazılır, final 3×4×2 matris ve tüm envanter tamamlanır.
   Son kodda bir kapsamlı test; başarısızlık sonrası yalnız ilgili testlerle
   düzeltme ve en sonda tam testi tekrar.

En yüksek risk davranıştan görünümü ayırmaktır: sticky/freeze sütunları,
konum hesaplayan drawer/popover'lar, sanallaştırma/sayfalama, kişisel Overview
düzeni, tabloda çoklu seçim/clipboard ve export ölçüleri. Başlangıç katmanı
ayrılırken CSP, offline font ve ilk boyama flaşı birlikte kontrol edilir.
Risk sınıfı Faz 0 doküman P3; geçici görsel prototip P2. Veri/yetki/hesap motoru
değişikliği yapılmadığından ikinci agent gerektiren sınır aşılmamıştır.

## Actions / PR / yayın

**[Doğrulandı]** `.github/workflows/buyerlog-pr-fast-checks.yml`, `main` hedefli
`pull_request` olayında otomatik çalışır. Draft PR bunu kapatmaz. Güvenlik
kurallarını bypass edecek branch hedefi/skip yönergesi/workflow değişikliği
yapılmayacak. PR için somut yerel diff ve açıklama hazırlanır; kullanıcı
Actions'a izin verene kadar PR açılmaz.

Feature branch push mevcut workflow tanımlarında tetikleyici değildir;
Faz 0 prototipleri yine yerel kalır. `main` package sürüm değişimi immutable
branch workflow'unu; test/stable request dosyaları yayın workflow'unu tetikler.
Tam regresyon workflow'u manual dispatch'tir. Installer `workflow_run` ile
yayın zincirine bağlıdır. Remote koruma ayarı bu denetimde sorgulanmadı;
koruma etkin varsayılmıyor.

| Faz | PR | CI | Merge | TEST | STABLE |
| --- | --- | --- | --- | --- | --- |
| 0A | Yerel audit dalı; PR yok | Çalıştırılmadı | Yok | Yok | Yok |
| 0B | Geçici konsept dalları; PR yok | Çalıştırılmadı | Yasak / yapılmadı | Yok | Yok |
| 1–3 | Konsept/pilot kararları sonrası hazırlanacak | Başlamadı | Yapılmadı | Yayınlanmadı | Yayınlanmadı |

## Doğrulama sınırları

Bu faz audit ve konsept karar hazırlığıdır; yeniden inşa tamamlanmış değildir.
Boş koleksiyon/fiyat/maliyet, bağlantısız LCW AI ve kaynak bekleyen Nakliye
görüntüleri dolu senaryoların kanıtı sayılmaz. Native Office, şirket LCW AI
oturumu ve paylaşımlı çok kullanıcılı altyapı kullanılmadı. Kaynak envanteri
dinamik durumları listeler; hepsinin tüm varyantları henüz çalıştırılmadı.
Final görsel matris, tam klavye/kontrast taraması, diğer modüllerin export
referansları ve bütün uygulama tam testi Faz 3 kapanışında zorunludur.
