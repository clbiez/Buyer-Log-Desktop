# Buyer Log — Manifest

Manifest, Buyer Log’un tüm arayüzünün ortak tasarım sistemidir. Ürün etiketi,
sevkiyat manifestosu ve teknik föyün okunaklı hiyerarşisini kullanır: numara,
tarih ve miktar önce gelir; başlıklar kısa, yüzeyler sakin ve kontroller köşelidir.
LCW AI aynı ürün dilini kullanır. Ayrı bir AI rengi, küresi veya sohbet balonu yoktur.

## 1. Kaynak ve sahiplik

- `resources/app/public/ui-tokens.css`: tek UI paleti, yerel fontlar, ölçek,
  boşluk, hareket, yüzey ve katman tanımları. Giriş ve boot da bu dosyayı okur.
- `ui-components.css`: ortak görünüm ve mevcut JS sınıflarına bağlanan bileşen
  sözleşmeleri. Eski sınıf adları davranış kancasıdır; ayrı tema sistemi değildir.
- `ui-motion.css` ve `motion-plus.js`: Manifest'e bağlı **Motion+** hareket
  katmanı. Yalnız hareket/zamanlama ve giriş koordinasyonu; yeni palet veya
  ayrı bileşen sistemi oluşturmaz.
- `ui-startup.css`, `giris.css`: aynı tokenlarla açılış/giriş bileşenleri.
- `app.css`, `design.css`, `experience.css` ve modül CSS’leri: yerleşim, ölçülen
  veri geometrisi, responsive düzen ve scroll davranışı. Görünüm tanımlamazlar.
- `ui-primitives.js`, `layer-system.js`, `tab-system.js`: klavye, odak ve katman
  yaşam döngüsü. İş kuralı veya kayıt değiştirmezler.

`design-butunluk.css` ve `ui-legacy-bridge.css` kaldırıldı. Eski `--acc`, `--ink`,
`--card`, `--fs-*`, `--sans`, `--r-*` UI takma adları kullanılmaz. Yeni bir modül
ortak bileşene bağlanır; ayrı palet veya görünüm override dosyası oluşturmaz.

## 2. Tema ve yüzey

İki tema vardır: `light`, `dark`. Açık ve karanlık temanın eski nötr
ailesi ile tablo başlığı renkleri korunur. Tema rengi yalnız `data-theme`
üzerinden değişir. Kurşun (`grey`) teması kaldırıldı; kayıtlı `grey` seçimi
aydınlık tarafta olduğu için `light` olarak açılır (`RETIRED_THEMES`).

| Token | Light | Dark | Kullanım |
| --- | --- | --- | --- |
| `--ui-canvas` | `#f5f7f9` | `#171c22` | çalışma zemini |
| `--ui-surface` | `#ffffff` | `#20262e` | veri yüzeyi |
| `--ui-surface-soft` | `#fafbfc` | `#252d36` | ikincil yüzey |
| `--ui-text` | `#16212d` | `#f0f3f6` | ana metin |
| `--ui-text-muted` | `#5f6f80` | `#a0adba` | açıklama |
| `--ui-accent` | `#356a96` | `#8fbfe8` | eylem ve odak |

Karanlık değerlerin ve durum renklerinin kanonik kaynağı `ui-tokens.css`’tir.
Renk literal’leri yalnız bu kaynakta tanımlanır; custom property ve var fallback değerleri de guard kapsamındadır. `design-color-baseline.json`
boştur; UI CSS dosyalarında ham renk borcu yoktur.

7.0.294'ün kullanıcı tarafından tercih edilen belirgin yüzey hiyerarşisi korunur:
ortak paneller, kartlar, modüller ve düğmeler `--ui-group-divider` ile ince 1px
sınıra sahiptir. Araç çubuğu ve tablo satırı ayraçları `--ui-row-divider`
kullanır. Gölge yalnız geçici, üstte duran yüzey için
`--ui-shadow-overlay` değeridir. Geçici genişleyen navigasyon `--ui-shadow-rail`
geometrisini kullanır; ikisi aynı `--ui-shadow-color` rengini paylaşır. Bu renk
karanlık temada aydınlık, açık temada koyudur. Her karta gölge yoktur.
Mor/indigo, neon, gradyan yazı, glassmorphism ve süs ışıması kullanılmaz.
Durumlar renk yanında metin, simge veya sayıyla açıklanır.

### 2.1 Arayüz stili: Klasik ve Çizgi

Kullanıcı Görünüm menüsündeki **Stil** düğmesiyle iki arayüz stili arasında geçer
(`#railUiStyleBtn`, TR/EN). **Klasik varsayılandır**; bu bölümdeki her şey yalnız
`html[data-ui-style="line"]` iken etkilidir. Seçim cihazda `lcw_ui_style` (BLStorage)
ve giriş kabuğu için `buyerlog.ui.appearance.style` olarak saklanır, açılış betiği onu
ilk karede uygular. Değişim tema geçişiyle aynı `BLMotionPlus.theme` yolunu kullanır.

- **Çizgi** ("Cetvel"): kâğıt zemin, mürekkep metin ve çizgi, tek kırmızı vurgu
  (kritik / kaydedilmemiş değişiklik). Birincil eylem ve seçim mürekkeple gösterilir.
  Palet `ui-tokens.css` içinde `:root[data-ui-style="line"]` ve
  `:root[data-ui-style="line"][data-theme="dark"]` bloklarındadır; panel, kontrol ve
  alan sınırları aynı ortak token'lardan (`--ui-group-divider`, `--ui-field-border`)
  mürekkep rengini alır. Yeni çerçeve, gölge veya köşe kuralı yoktur.
- Fontlar: **Schibsted Grotesk** gövde/başlık, **JetBrains Mono** kod ve sayısal tablo
  hücresi. OFL, yerel WOFF2, Latin + Latin-ext; yalnız bu stil seçildiğinde yüklenir.
  Schibsted'in tablo rakamı noktayı genişlettiği için bu stilde `tnum` kapalıdır;
  hiza gereken sayısal hücreler (`td.num`, `td.money`) mono yazıyla hizalanır.
- Bileşen farkları `ui-components.css` sonundaki "Çizgi arayüz stili" bölümündedir:
  başlıklar büyük harf yerine cümle düzeninde, ray seçimi zeminsiz kalın yazı +
  metnin sağından rayın kenarına uzanan 2px `--ui-line-ink` çizgisi.
- Ölçü, satır yüksekliği, dört arayüz boyutu, katmanlar, davranış kancaları ve
  çıktı paletleri (§8) iki stilde aynıdır. Yeni modül iki stilde de token üzerinden
  doğru görünür; stile özel modül CSS'i yazılmaz.
- **Motion+ çizgi çerçevesi:** Çizgi stilinde `entrance()` üzerinden açılan her
  pencere, çekmece ve menü (`play('overlay'|'drawer')` ve otomatik overlay algılama)
  önce dört mürekkep çizgisiyle çizilir (`.blLineFrame`, köşelerde kısa taşma,
  kenar başına `--ui-motion-overlay` × 0,25 gecikme); içerik çizgiden sonra belirir,
  çizgi söner ve yüzeyin kendi sınırı kalır. İptal, sekme değişimi ve hareketin
  kapatılması çerçeveyi hemen kaldırır; reduced-motion'da çizilmez.
- **Yüzey dili:** çalışma alanındaki kap yüzeyler (`.panel`, Overview widget'ı, Backlog
  bölümü, `.tablewrap`) çerçevesizdir; yalnız o kapsamda `--ui-group-divider` saydam
  yapılır, içindeki her öğede yeniden `--ui-line-ink` olur (kontroller, alanlar, iç
  kartlar çerçeveli kalır). Pencere, çekmece ve menüler çerçeveli kalır. Overview ve
  Backlog başlıkları "başlık — çizgi — araçlar" düzenindedir (`::after` 1px çizgi).
- **Veri işaretleri:** oran izleri (`.ovBdTrack`, `.ovHorizonTrack`, `.cpaCoverageTrack`)
  1px taban çizgisi + 3px dolgu; Backlog karoları zeminsiz, ince dikey ayırıcı ve aşama
  renginde 2px üst işaret. Aşama renkleri ve hesaplar Klasik'le aynıdır.
- **Kabuk:** üst çubuk eylemleri çerçevesiz; bağlantı durumu 14px çizgi (bağlı mürekkep,
  kuruluyor uyarı, bağlı değil `--ui-line-mark`); seçim çubuğu mürekkep zeminli (çubuk
  içinde token'lar `--ui-line-paper` / `--ui-line-ink-hover` ile tersine çevrilir);
  saat çiplerinde mini kare kadran (`.ovClockChipFace`, Klasik'te gizli).
- **Bileşen aileleri (Çizgi Tasarım Sistemi, kararlar K1–K7):** her aile tek görünümdür ve
  modüllerin kendi sınıfları `ui-components.css` sonundaki "Çizgi Tasarım Sistemi — bileşen
  aileleri" bölümünde aynı kurala bağlanır.
  - **Eylem düğmesi:** `.tbtn`, `.navActionBtn`, `.lflButton`, `.ocButton`, `.mfpBtn`, `.lcBtn`, `.lcwaiBtn`, `.psaGhostBtn` ve `.cpaBtn` için 1px mürekkep çerçeve, zeminsiz, 500 ağırlık. Birincil mürekkep dolgu; tehlike `--ui-line-mark`; devre dışı `--ui-row-divider`.
  - **Segment:** bitişik çerçeveli kutular, seçili mürekkep dolgu.
  - **Sayfa sekmesi:** zeminsiz, seçili 2px alt çizgi.
  - **Alan:** zemin saydam. Arama kutuları yalnız alt çizgili. Anlamlı uyarı zemini (atanmamış lisansör) korunur.
  - **Filtre çipi:** mono 12px, 1px çerçeve, aktifken dolgu.
  - **Başlık:** bölüm başlıkları 18/500, alt başlık 14/600, mono etiket.
  - **Menü:** 1px mürekkep çerçeve + gölge; menü içindeki düğmeler çerçevesiz satırdır.
  - **Çekmece:** tek kabuk (sol 1px mürekkep çizgi, başlık altı çizgi, ortak başlık ölçeği, çerçevesiz kapat düğmesi).
  - **Kalıcı kart:** gölge yok.
- **K1 · Çizgi stiline özel kenarlık istisnası:** `ui-manifest-contract` yalnız
  `ui-components.css` içinde, seçicinin her parçası `html[data-ui-system="manifest"][data-ui-style="line"]`
  ile başlıyorsa ve değer yalnız `0/none/transparent/solid/1px/2px` ile `--ui-line-ink`,
  `--ui-line-mark`, `--ui-row-divider`, `--ui-field-border`, `--ui-group-divider` token'larından
  oluşuyorsa kenarlığa izin verir. Klasik kurallar ve modül CSS'i bu istisnanın dışındadır.
- **Özgüllük katmanı:** aile kuralları `:not(#bl-line):not(#bl-line-x)` taşır. Bu her öğeyle eşleşir;
  kimlik ve çok sınıflı `:is()` kullanan modül kurallarına karşı aile kuralının kazanmasını sağlar.
  Yeni bir modül sınıfı aileye eklenirken bu katmanın içine yazılır.
- **Bütünlük kabulü:** `scripts/ui-line-consistency-acceptance.js` gerçek uygulamada demo veriyle
  bütün modülleri ve dört paylaşılan çekmeceyi açık ve koyu temada gezer. Her ailenin her örneğinin
  sözleşmeye uyduğunu doğrular; bir modül ayrı görünüm üretirse başarısız olur.
- **Çizgi hareketi (Motion+, yalnız Çizgi stili):** açılan her menü, seçim penceresi, sütun
  filtresi, açılır panel, pencere ve çekmece (`LINE_SURFACES`) çevresi dört çizgiyle çizilerek
  açılır; kapanınca aynı çerçeve ters sırayla silinir. Tarama yalnız etkileşimden sonra ve
  sınırlı gecikmelerle (`0/140/420/900 ms`) yapılır; gövde gözlemcisi yoktur. Tam ekran perdeler
  çerçevelenmez, iç içe yüzeyde dıştaki çizilir, aynı yerde yeniden kurulan yüzey kapanış sayılmaz.
  Yeni ekranda ana bloklar soldan sağa bir çizgiyle belirir. Hareket azaltma veya kapalı hareket
  tercihi her çizimi kapatır; Klasik stilde hiçbir şey eklenmez. Modüller kendi çizim motorunu
  eklemez: yeni bir yüzey `LINE_SURFACES` listesine eklenir, özel bir alan `BLMotionPlus.play('frame', el)` çağırır.
- **Etiket ve grafik dili (sunum A, yalnız Çizgi):** öncelik/durum rozetleri zeminsiz düz metindir;
  Kritik `--ui-line-mark` ve kalın, acil aksiyonlar kalın mürekkep, İzlemede ikincil, Yolunda soluk.
  Kritik satır (`tr.rowCritical`, Klasik'te stilsiz) solda 2px kırmızı çizgi alır. `--ui-success` ve
  `--ui-warning` mürekkebe döner; kırmızı yalnız tehlike/kritik (`--ui-danger`, `--ui-chart-7`).
  Seriler nötr basamaklardır (`--ui-chart-2…6,8`) ve `--ui-line-hatch(-soft)` tarama deseni;
  Backlog: Üretimde mürekkep, Yüklemede gri, Yolda/Gümrük taralı, Depoda açık gri, Eksik kırmızı.
  Çubuklar 1px taban + 3px dolgu, aylık sütunlar 2px gövdedir. Kategori paletleri `var(--ui-chart-N)`
  kullanır (Klasik'te chart-1/2/6/7 vurgu/uyarı/başarı/tehlikenin aynısıdır); JS'te çizim anında
  çözümlenmiş renk yerine canlı token tercih edilir. Kabul betiği etiket ve grafik işaretlerinin
  nötr ya da tek kırmızı olduğunu açık/koyu temada denetler.
- **Çizgi kimliği:** logo tek çizgi BL monogramı, cetvel çentikleri ve `--ui-line-mark` işaretinden
  oluşan satır içi SVG'dir (`.blLineLogo`, `hidden`). Kenar çubuğu, açılış (boot) kartı ve giriş
  ekranında bulunur; yalnız Çizgi stili gösterir ve Motion+ açılışta ve stile geçişte bir kez çizer.
  Klasik stil görsel logoyu korur. Açılış kartı ve giriş ekranı mürekkep çerçeve, alt çizgili alan ve
  aşamalarla görünür; boot küresi Çizgi stilinde gizlenir.
- Kaynak tasarım belgesi: "Buyer Log Çizgi Tasarım Sistemi" (token'lar, bileşen önizlemeleri,
  denetim ve kararlar).
- Bilinçli olarak yapılmayanlar: kritik satıra sol şerit (satır düzeyinde işaret yok;
  `:has()` ve yeni gölge gerekir), araç çubuğunun metinli menülere yeniden gruplanması
  (davranış kancası olan düğümler taşınmaz).
- Sözleşme testi: `tests/ui-line-style.test.js`.

### 2.2 Rapor görünümü

CP, Siparişler ve Koleksiyon görünüm seçicisinin sonunda (Alanlar ve Kısmi görünümden sonra)
**Rapor görünümü** (`[data-table-report]`, `aria-pressed`, TR/EN) bulunur. Tablo kendi kaydırma
alanında rapor düzenine döner; sağ çekmece açılmaz (`public/table-report-inline.js`). Görünen
alanlar paylaşılan rol projeksiyonunda (`BLDetailReportLayout.project`) iki satırlı hücrelerde
durur; hücre en çok iki satırdır, tam metin ipucundadır. Satırlar tablonun o anki filtre, sıralama
ve sayfa aralığıdır (`renderTableRangeControls` aynı sayfayı paylaşır); başlıktaki alan filtreleri
tablonun kendi sütun filtrelerini açar. Salt okunurdur: tablo DOM'da gizli kalır, ön ayar, filtre,
seçim, düzenleme ve kayıt değişmez. Tercih tablo başına saklanır; görünmeyen sekmede çizim
yapılmaz. İki arayüz stilinde de vardır; gerçek tarayıcı kabulü
`scripts/ui-line-consistency-acceptance.js` içindedir.
Test: `tests/table-report-view.test.js`.

## 3. Tipografi ve dört boyut

Yerel/paketli OFL fontlar: **IBM Plex Sans** gövde, **Barlow Condensed** başlık,
**IBM Plex Mono** referans/kod. Latin-ext ve Türkçe karakterler paketlidir.
Ağ fontu veya varsayılan Inter/system-ui görünümü kullanılmaz.

`--ui-font-{2xs,xs,sm,base,md,lg,xl,2xl,3xl,4xl}` sırasıyla
11/12/13/14/15/18/24/30/36/44 px tabana `--ui-font-add` ekler. Bileşenler
bu tokenı kullanır; doğrudan `font-size:14px` yazılmaz. Sayısal verilerde
`font-variant-numeric:tabular-nums` kullanılır.

| API indeksi | `data-ui-scale` | `--ui-font-add` | kontrol | üst çubuk |
| --- | --- | --- | --- | --- |
| 0 | standard | 0px | 34px | 52px |
| 1 | large | 1.5px | 38px | 58px |
| 2 | xl | 3px | 42px | 64px |
| 3 | compact | -1px | 30px | 48px |

`applyUiFontStep` **indeks** alır; font ekleme değeri almaz. Giriş ölçeği de
`buyerlog.ui.appearance` üzerinden aynı dört değeri kullanır. Küçük kontrol
`--ui-control-height-small` = ana kontrol −4px. Veri satırının kullanıcı
ölçüsü, görsel sütunu ve otomatik metin yüksekliği ayrı veri geometrisidir.

## 4. Geometri, tablolar ve grafikler

Köşeler `--ui-radius:0`; hiçbir kontrol/kart/çip/sekme 2px’i aşmaz. Daire yalnız
avatar veya durum noktası içindir. Radyo, slider tutamağı, yükleme işareti ve
grafik noktaları köşelidir. İkonun içindeki mercek ya da coğrafi kürenin dünya
izdüşümü bir kontrolün hitbox’ı veya veri işaretçisi değildir.
Kullanıcı tercihiyle Backlog Genel Bakış’ın sol üst yüklenen yüzde göstergesi
dairesel grafik kullanır; merkezindeki yüzde ve metin korunur. Bu dar istisna
diğer grafik işaretçilerine veya kart/kontrol köşelerine uygulanmaz.

İzin verilen çizgiler ortak bileşen sözleşmesiyle sınırlıdır:

1. Klavye odağı: 2px opak `--ui-accent` outline; ≥3:1 gösterge kontrastı.
   Spreadsheet’in aktif hücresi klavye imlecidir ve aynı outline kullanır;
   seçilen aralığın geri kalanı yüzey tonuyla gösterilir. Drag hedefi, hata
   ve kılavuz vurguları çerçeve oluşturmaz.
2. Yoğun tablonun gövdesi: hücre altında tek düşük kontrastlı yatay
   `--ui-row-divider`. Dikey gövde ızgarası yoktur. Satırda yerel
   değişiklik (`rowDirty`) varsa, ilk hücrede `--ui-warning` renkli ince
   sol gösterge; seçim varsa `--ui-accent` gösterge ve `--ui-selected` yüzeyi
   bulunur. Seçim, düzenleme ve klavye davranışı JS'de değiştirilmez.
3. Kullanıcının açık seçimi: CP, Siparişler ve Koleksiyon’da ana sütun grupları
   arasında **1px `--ui-group-divider`**, hem `.groupRow th.groupDivider` hem
   `.colRow th.groupBoundary` üzerinde. Satır gövdesine taşınmaz.
4. CP, Siparişler ve Koleksiyon'da alt sütun başlıkları arasında 1px
   `--ui-row-divider` bulunur. Grup adı yatay kaydırmada kendi sütunlarının
   **görünür bölümünde ortalanır**; frozen sütunları kapatmaz, veri hücrelerine
   dokunmaz.
5. Grafik eksen/kılavuzları veri okumak içindir; `--ui-chart-grid` kullanır.
6. Panel, modül ve kontrol sınırları: yalnız ortak `ui-components.css`
   üzerinde `--ui-group-divider` ile 1px sınır; giriş alanları `--ui-field-border` (§5). Checkbox'ta durum
   okunabilirliği, kullanıcı avatarında logo ile eşit `--ui-mark-radius` köşe uygulanır.
7. Basılı/dışa aktarılan belge kendi sabit çıktı sözleşmesini korur (§8).
8. Sütun dondurmanın tek sahibi `public/table-freeze.js` (`BLTableFreeze`):
   konum, ofset ve katman sırası (kayan gövde < `--ui-z-frozen-cell` < kayan
   başlık `--ui-z-sticky` < donmuş başlık `--ui-z-sticky-column`) yalnız orada
   üretilir. Donmuş sol bölme ile sağ tablo bağımsız yatay kayar: bölme sınırı
   sürüklenebilir 2px `--ui-field-border` ayırıcıdır (sürüklerken `--ui-accent`),
   donmuş bölmenin kendi kaydırma çubuğu yalnız sol bölmenin altındadır. Modül
   CSS'i `frzL` hücrelerine konum, `z-index` veya zemin yaması eklemez.

Tablo başlıkları `--ui-header-*`, ana grup bandı `--ui-group-header-*` kullanır.
OAB ve INTAKE ilk açılışta grafik yerine pivot/tablo gösterir; grafik
isteğe bağlı seçimle açılabilir.
Seçili satır `--ui-selected` / `--ui-selected-ink`; hover `--ui-row-hover`.
Filtre, sıralama, sticky başlık, kopyala/yapıştır ve canonical alan bağları
CSS tasarımı için yeniden uygulanmaz.

Grafikler `--ui-chart-1…8` kategorilerini, kare işaretleri, doğrusal ilerleme
şeritlerini ve okunaklı eksenleri kullanır. Seriler etiket/legend taşır. Grafik
SVG/canvas metin ölçüsü ekrandaki ortak fonttan okunur. Grafikler ve görünmeyen
modüller `perf-runtime` lazy sözleşmesine uyar.

## 5. Bileşen sözleşmeleri

- Eylem: ortak yükseklik, font ve odak. Açık varyantlar `primary` ve `quiet`.
  Mevcut `.tbtn`, `.navActionBtn`, `.cpaBtn`, `.mfpBtn`, `.lcBtn` gibi davranış
  kancaları korunur, ortak bileşen görünümüne bağlanır. **Vurgu dolgusu
  (`--ui-accent` zemin) yalnız sayfanın birincil eylemindedir** (Yenile, Yeni
  talep…); seçim durumu dolgu kullanmaz.
- Kontrol ve Kurallar Merkezi aynı ortak çerçeveleri kullanır: `.cpaFrame` yüzeyleri ve `.cpaBtn` / `.cpaIconBtn` eylemleri `--ui-group-divider` sınırına bağlanır. Tablo içindeki `.cpaQueueStatusSelect` düzenlenebilir bir seçim alanıdır; ortak `--ui-field-border` sınırını taşır.
- Segment (mod/filtre seçimi): köşeli; seçili öğe `--ui-selected` zemin +
  `--ui-selected-ink` metin, `aria-pressed`. Sayfa içi sekme (görünüm/alt sayfa):
  zeminsiz; seçili öğe `--ui-selected-ink` metin + 2px `--ui-accent` alt çizgi,
  `aria-selected`. Seçim değişince Motion+ çizgiyi eski öğeden yenisine kaydırır.
  Yeni grup kapsayıcısı `ui-components.css` v7.0.319 bölümündeki listeye ve
  `motion-plus.js` `SEGMENTS` listesine eklenir. Ortak Tab/ok tuşu davranışı
  korunur. Filtre etiketi durum metnini taşır.
- Bölüm başlığı: `.cardTitle` kalıbı — Barlow Condensed 600, `--ui-font-xl`,
  büyük harf, `.6px` aralık, `--ui-text-secondary`. Alt başlık Barlow 18px,
  cümle düzeni. Sayfa adı üst çubuktadır; sayfa içinde tekrarlanmaz.
- Alan: 1px `--ui-field-border` sınırıyla tanınır (açık/koyu temada zemine ≥3:1;
  yüzey tonu tek başına yetmez). Kural yalnız `ui-components.css` sonundaki ortak
  alan bloğundadır; modül CSS'i alan kenarlığını `border:0` ile silmez. Disabled/
  readonly alan `--ui-group-divider`; ızgara hücresi editörü (`td`) tablo
  sözleşmesinde kalır. Değer gösteren native olmayan seçici (çoklu seçim,
  dönem/boyut seçici) aynı sınırı ortak listeden alır; yeni seçici o listeye
  eklenir. Gerçek uygulama kabulü: `scripts/form-field-border-ui-acceptance.js`. Görünür label, placeholder, disabled ve hata durumu.
  `aria-invalid` yalnız renk dışında hata açıklamasıyla birlikte kullanılır.
- KPI: küçük açıklama, tabular sayısal değer ve alt bağlam. Her KPI ayrı
  çerçeveli/gölgeli kart değildir.
- Boş/hata/bekleme: kısa başlık, neyin eksik olduğunu anlatan metin, uygun
  eylem. Yükleme için sabit kare durum işareti; emoji ve dekoratif spinner yok.
- Modal/çekmece: adlandırılmış dialog, ilk odak, Tab/Shift+Tab sınırı, Escape
  ve tetikleyiciye odak dönüşü. İç içe pencerede yalnız üst katman kapanır.
- Yenileme kapsam menüsü: kullanıcı tercihiyle üst çubuktan aşağı ince hatlarla dallanan, kısa kodlu ayrı karelerdir. Kareler ve odak ipucu ortak yüzey, sınır ve gölge tokenlarını kullanır; arka planda kapsayıcı panel yoktur. Hat Motion+ `branch`, kareler `overlay` ile açılır.
- Popover/menü: ortak yüzey; ok/Home/End, disabled öğe atlama ve Escape.
  Çerçeve ve gölge yalnız menü kabındadır; öğeler çerçevesiz satırdır, hover
  `--ui-surface-strong`. Aynı işi yapan eylemler tek çekmecede toplanır (ör.
  CP/Koleksiyon **Excel** çekmecesi: "Excel oluştur" / "İçe aktar ve şablonlar").
- Seçim çubuğu (`selection-action-bar.js`): CP/Siparişler/Koleksiyon'da satır
  işaretlenince altta görünür; sayı + Kopyala/Excel/Araçlar. Kendi iş mantığı
  yoktur, yalnız sayfadaki gerçek düğmeye tıklar ve onların pasif durumunu yansıtır.
- Üst çubuk: bildirim, yerel işlemler, tek **Bağlantılar** düğmesi (LCW AI/PLM/OAB
  durum noktaları) ve kullanıcı. Rol kullanıcı menüsündedir. Sol ray altı tek
  **Görünüm** menüsüdür (dil, tema, arayüz boyutu): düğmenin üstünde alttan
  yukarı açılan çekmece (`BLMotionPlus.play('drawer')`); Tema geçişi bölümü kapalı
  başlar, başlığına basınca yukarı doğru genişler (`play('expand')`).

Hover, focus, active, selected, disabled, loading, empty ve error durumları
aynı tokenları kullanır. Modül CSS’i bu durumlara ayrı renk/çerçeve icat etmez.

## 6. Katmanlar ve hareket

| Token | Seviye | Amaç |
| --- | ---: | --- |
| `--ui-z-below/base/data/raised` | -1 / 0 / 1 / 2 | yerel veri geometrisi |
| `--ui-z-frozen-cell` | 20 | dondurulmuş gövde/alt bilgi hücresi (yalnız `table-freeze.js`) |
| `--ui-z-sticky` | 30 | sabit tablo başlığı |
| `--ui-z-sticky-column` | 31 | dondurulmuş başlık sütunu |
| `--ui-z-chrome` | 40 | uygulama rayı/üst çubuk |
| `--ui-z-popover` | 100 | normal menü |
| `--ui-z-modal` | 200 | pencere/çekmece |
| `--ui-z-modal-menu` | 300 | pencere üzerindeki menü |
| `--ui-z-tooltip` | 400 | ipucu/bildirim |
| `--ui-z-boot` | 500 | açılış/engelleyici perde |

`BLLayerSystem` çocuk dialog için 201–299 aralığında tek adım yükseltebilir;
300 tavanının altında kalır. Modüller sayısal z-index tanımlamaz.

**Motion+ zorunlu hareket sözleşmesidir.** Yeni veya revize edilen her kullanıcı
arayüzü önce `motion-plus.js` içindeki ortak `BLMotionPlus.play('card'|'overlay', element)`
API'sini veya `blMotionEnter` / `blMotionOverlay` sınıfını kullanır; modül başına
ayrı keyframe, tema rengi, animasyon motoru veya sonsuz döngü eklenmez.
Hareket paleti yalnız `ui-tokens.css` üzerinden gelir: 100/140 ms temel kontrol,
240 ms overlay, 340 ms sayfa, 360 ms kart, 390 ms tablo, 440 ms grafik,
560 ms tema (`--ui-motion-theme`).
Easing ortak cubic-bezier ile izlenir. Hareket içerik, geometri ve iş verisi
üzerinde kalıcı değişiklik yapmaz.

**Modüller arası kademeli akış:** Başlık, özetler ve görünür ana içerik en çok
beş ayrı blok halinde sırayla girer. Ortak `--ui-motion-flow:440ms`,
`--ui-motion-stagger:40ms` ve `--ui-motion-distance:14px` tokenları kullanılır.
Tablo başlığı, kaydırma alanı ve tabloyu içeren üst bloklar sabit kalır;
tablo gövdesi aşağıdaki sıralı satır girişiyle açılır. Aynı girişte üst blok,
hücre dalgası veya iç içe kart animasyonu eklenmez. Lazy çizim için sınırlı
tekrarlar yalnız henüz girmemiş blokları ve tabloları alır.
Gezinme, hareketi kapatma ve görünmez sekme önceki akışı iptal eder; içerikle
etkileşim, odak veya kaydırma sırasında akış durur. Seçili/düzenlenen veri
blokları atlanır; aynı modüle tıklama, filtre ve veri yenilemesi akışı tekrarlamaz.

**Tema geçişi:** Kullanıcı temayı değiştirdiğinde `BLMotionPlus.theme(update, origin)`
Görünüm menüsünde seçilen efekti çalıştırır (`motion-plus-theme.js`,
`BLMotionPlusTheme`; ayar kullanıcıya ayrılmış `lcw.themeTransition.v1` (BLStorage)): sırayla
katlanan üçgenler (varsayılan; dalga ekranın sol alt köşesinden yayılır), kenardan katlanan / yerinde dönen üçgenler,
düğmeden üflenen / rüzgârda savrulan toz, taneli çözülme veya daire. Hız 1–5
(varsayılan 5 = en hızlı, 500 ms temel süre), üçgen boyutu 40–100 px (varsayılan
70). Üçgen ve toz efektleri masaüstü köprüsünün tek karelik
`captureView` yakalamasını tek `.blThemeFxLayer` canvas'ında çözer; yeni tema
altta gerçek DOM'dur, kare yalnız bellekte ve geçiş boyunca yaşar. Yakalama
yoksa (tarayıcı kipi) veya başarısızsa daire / anlık yol kullanılır. Taneli
çözülme ve daire View Transitions ile çalışır (eski ve yeni kare kompozitörde
birleşir, tablo hücreleri tek tek boyanmaz). Tema ilk uygulanırken,
sistem teması değişiminde, reduced-motion / `data-bl-motion='off'` / görünmez sekmede,
yazılım çiziminde (`data-bl-render='software'`) veya API yoksa geçiş anlıktır.
Ard arda istekte son seçim kazanır. Başka modül kendi tema animasyonunu,
otomatik parıltıyı veya sürekli efekti eklemez.

Giriş → genel kültür → uygulama geçişleri de `BLMotionPlus.startup` ile aynı
`chain` üçgen motorunu, kayıtlı hız ve boyutu kullanır; tema tercihi değişmez.
Giriş karesi parola temizlendikten sonra yalnız kendi masaüstü penceresinde,
15 saniyelik tek kullanımlık bellekte taşınır. Tarayıcıda/yakalama hatasında
bekletmeden devam edilir; reduced-motion, kapalı hareket ve yazılım çiziminde
üçgenler çalışmaz. Hazır olma kapıları ve kullanıcının Devam kararı korunur.
**Thinking Orbs istisnası:**
7.0.294'ten gelen Breathing (açılış/bekleme) ve Working (harita yüklemesi)
canvas bileşenleri yalnız gerçekten çalışan `thinking`/loading durumu boyunca
semantik işlem göstergesi olarak kullanılabilir. Her orb görünmez sekme, ekran
dışı kalma, işlem sonu ve reduced-motion için duraklama/durdurma ya da tek kare
uygulamalıdır. Sürekli dekoratif canvas hareketi hâlâ yasaktır.
**Global Flow istisnası (7.0.319):** Kritik (priority CRITICAL) sipariş taşıyan
araç, küme ve düğümlerde sabit boyutlu küçük kırmızı köşe noktası anlamsal durum göstergesidir;
yalnız harita canlıyken (`isLive`), hareket izinliyken ve yazılım çiziminde
değilken ~12 fps ile çalışır, aksi hâlde durağan kırmızı nokta ve çerçeve kalır.
Noktanın yalnız opaklığı hafifçe değişir; büyüyen halka çizilmez. Araçlar
veri değişiminde bir kez ölçeklenerek girer; rota akışı yalnız fare hattın
üzerindeyken çizilir. Genel rota akışı (`wantsAnimation`) manifestte kapalı kalır.
Taşıma simgeleri (gemi/uçak/tır) `MODE_GLYPH_PATHS` tek kaynağından gelir;
1 araç tek rozet, birden fazla araç aynı boyutta üç küçük gemi içeren tek filo
rozetidir; gerçek taşıma tipleri ve araç sayısı hover/detay özetinde korunur.

**Sıralı satırlar:** Modül girişinde ilk iki görünür tablonun kaydırma alanında
görünen tüm uygun veri satırları, `--ui-motion-table:390ms` toplam süre ve
`--ui-motion-table-distance:10px` ile sırayla belirir. Satır başına süre
toplamın %52'si, ilk gecikme %18'i ve satırlar arası aralık %6'sıdır;
altıncı ve sonraki satırlar aynı son gecikmeyi paylaşarak toplam süreyi korur.
Yalnız `opacity/transform` değişir; hücre renkleri, metin, başlıklar ve seçim
korunur. Aktif/seçili/düzenlenen hücre içeren satırın tamamı atlanır.
Tablo başına en çok 128 satır ölçülür; derin kayıtlı kaydırma konumunda bu
sınırda görünür satır yoksa hareket atlanır. Ölçümler animasyonlardan önce
toplanır. Kaydırma, filtre, veri yaması ve export yeni giriş başlatmaz;
etkileşim devam eden satır hareketini iptal eder. Yazılım çiziminde tablo
hareket etmez; yeni modül aktivasyonunda uygun satırlar yeniden girebilir.

**Erişilebilirlik/performans:** `prefers-reduced-motion`, görünmeyen sekme ve
`data-bl-motion='off'` tüm hareketi devre dışı bırakır. Hareketler sayfa
geçişinde iptal edilir; tablo girişinde yalnız `opacity/transform` kullanılır. Grafik ve
kartlar görünürlükle sınırlı, en çok 14/16 öğe üzerinden animasyon alır.
Aynı yeni görünür işlevin TR/EN karşılığı, 2 tema × 4 boyut, reduced-motion,
klavye/scroll ve veri doğruluğu regresyonları teslim koşuludur.

**Kademeli açılma/kapanma:** Bölüm gövdeleri ortak `BLMotionPlus.disclosure(body, open, {trigger, initial})` API’sini kullanır. Yükseklik değişimi ortak bölüm hareketinin sınırlı istisnasıdır: `--ui-motion-disclosure` 390 ms, satır aralığı `--ui-motion-disclosure-step` 32 ms; en çok altı görünür içerik grubu hareket eder. Kapanış hedefi `hidden`/ARIA ile hemen kaydedilir; geçici çizim stilleri bitiş, ters tıklama, sekme değişimi ve hareket iptalinde temizlenir. Gövde/alan değerleri korunur; aktif editörler ve seçili tablo hücreleri kademeye katılmaz. Yerel `details/summary`, ortak `::details-content` kuralını ve aynı kademeyi kullanır; yüzen seçiciler bölüm yüksekliğiyle kırpılmaz. / Section bodies use the shared disclosure API; bounded intrinsic height motion, 390 ms duration and 32 ms staggering for at most six visible groups. Hidden/ARIA target state is immediate, temporary styles are cleaned up on completion/reversal/cancellation, editor values are retained and active editors/selected cells are skipped. Native details use the same profile while floating pickers retain their geometry.

## 7. Guard ve erişilebilirlik

- `design-token-guard.test.js`: ortak ölçek/font, tanımsız değişken, sıfır ham
  renk baseline’ı. Bir başarısızlığı gizlemek için baseline büyütülmez.
- `ui-component-contract-v20261015.test.js`: ortak eylem, segment, sekme, KPI
  ve hidden durumları; artık geçici köprüye bağımlı değildir.
- `ui-manifest-contract.test.js`: bütün aktif üst düzey CSS, köşe/çizgi,
  animasyon/katman ve modülün yalnız yerleşime sahip olması.
- `ui-inline-contract.test.js`: UI JS/HTML’de sabit px font, çerçeve, köşe,
  ham z-index, tanımsız UI tokenı ve kaldırılmış dosyalara dönüş.

Veriye bağlı değişkenler yalnız ölçü/yerleşim özelliğinde kullanılabilir.
Kullanıcının yazdığı durum rengi yalnız ilgili durum swatch/hücresine aittir;
bu veri çıktıda da korunur. Belge üretici istisnaları testte isimli, dar
fonksiyon aralıklarıdır; bütün app-main.js muaf değildir.

Metin ≥4.5:1; gerekli kontrol/odak göstergesi ≥3:1. Güçlü açık yüzeylerde açıklama için `--ui-text-secondary` kullanılır. Gerçek PNG, computed
kontrast, klavye ve reduced-motion kontrolleri birlikte değerlendirilir.
Otomatik piksel/DOM örneklemi tek başına WCAG sertifikası sayılmaz.
TR/EN çiftleri aynı değişiklikte yazılır; canonical ID ve tek LCW AI yolu korunur.

## 8. Ekrandan bağımsız çıktılar

UI yeniden tasarımı Excel/clipboard hücre renklerini veya belge fontlarını
 değiştirmez. Çıktı stilinin ekran ölçeğine bağlanması yasaktır.

- CP/Sipariş/Koleksiyon: `EXPORT_LIGHT_*`, `exportSemanticPalette` ve
  `table-export.js` kayıt tabanlı sabit palet/ölçüler.
- Nakliye DOM export: sabit export paleti; UI computed renkleri yerine açık
  belge değerleri. Dört boyut için çıktı satır yüksekliği korunur.
- Backlog: `CHART_FALLBACK` sabit workbook serileri; ekran `--ui-chart-*` okur.
- LCW AI: `export-document-palette.json`; server `output-theme.js` artık UI
  CSS’ini ayrıştırmaz. HTML/PDF/PPTX/XLSX font ve renkleri referansla korunur.
- Tedarikçi atlas HTML: `license-supplier-atlas.js` içindeki yerel belge font
  listesi; UI stylesheet’indeki font-face kurallarına bağımlı değildir.
- Shipping print: yalnız `@media print` içindeki isimli tablo/ürün seçicileri,
  `--ui-print-*` sabit paleti ve pt ölçüleri.
- LCW çıktı editörünün iframe’i ve belge önizlemesi: belge koordinatlarını
  temsil eder, ana arayüzün font/palet alanından ayrıdır. CSP temizleme ve
  ağ engeli korunur; belge betiği ana DOM’a eklenmez.

HTML/TSV byte eşitliği ve XLSX `xl/` parçaları karşılaştırılır; ZIP zaman damgası
stil/veri eşdeğerliğinin parçası değildir. Üretilen belge CSS’i ayrıca dondurulmuş
referansla karşılaştırılır. Paketli Barlow dosyaları çıktı kullanımı sürdüğü için
silinmez.

## 9. Ortak CSS maliyeti

Sıfır kenarlık/köşe/gölge tanımları her bileşende yinelenmez; tek `:where(body,body *)`
sıfırlamasından gelir. Tabloya özel sıfır çizgi tanımları, yoğun tablo ayırıcılarını
bilinçli olarak bastırdığı yerlerde korunur. Bu, export iframe’inin içine uygulanmaz.

Eşit özgüllüğe sahip basit `:is()` listeleri aynı seçicilerin virgüllü listesine
açılabilir. Karma özgüllük korunur. Kompleks seçicilerde özgün `:is()` koşulu
yerinde kalır; sağ uç sınıf/etiket için sıfır özgüllüklü `:where()` ön filtresi
eklenebilir. Bu dalların birleşimi aynı öğeleri seçmelidir. Kural
sırası, değer, `!important` ve tema koşulu değişmez. Geçişte 21 gerçek ekran/tema
bağlamında görünür öğelerin computed renk, ölçü, font ve odak değerleri eşleşti.

Earth 3D, yerel doku ve aynı UI paletini kullanır; işaretçiler/badge/kümeler
köşelidir. Canvas etiketleri yerel Mono fontu ve `--ui-font-add` ile ölçülür.
Yıldız fonu, atmosfer ışıması ve sürekli shader rota hareketi yoktur. Coğrafi
kürenin şekli, veri geometrisidir. Kamera ve rota hesapları değiştirilmez.

Eski modal çağrıları da ortak `trapDialogTab` davranışını kullanır. Escape
pencerenin kendi kapatma yoluna bağlanır; kaydetme/iptal iş kuralını değiştirmez.
Nonmodal filtreler Tab sırasını hapsetmez.

## Kullanıcı işareti ve güncel iş akışları

Kullanıcı avatarı çerçevesiz `--ui-mark-paper` zemini ve `--ui-mark-radius` köşesini, uygulama logosu
`icons/icon-mark.png` dosyasını kullanır. Plaka bütün temalarda açık olduğu için
baş harfler `--ui-avatar-ink`, yedek zemin `--ui-avatar-paper` ile sabittir.
Baş harfler logoyla aynı düz zeminde görünür; ad/baş harf üretimi değişmez.
Metin gradyanı, ışıma veya yeni avatar çerçevesi eklenmez.

Satır sıklığı, istisna kutusu, fiyat kaynağı, toplu işlem ve kayıt/ilerleme
yüzeyleri de `ui-components.css` sahibidir; modül CSS dosyaları yalnız ölçü ve
yerleşim taşır. Kullanıcıya bağlı sıklık ayarı yazı ölçeğinden bağımsızdır.

**Paylaşılan bulanık arka plan:** Sidebar hover/klavye ve dialog açılışlarında `--ui-backdrop-blur` ile hafif siyah `--ui-backdrop-tint` birlikte kullanılır. Karartma tek kalıcı `.blWorkspaceBlur` katmanındadır; dialog scrimleri şeffaf kalır, iç içe açılışlar karartmayı katlamaz. Katman açılış/kapanışta `backdrop-filter` ve `opacity` geçişini Motion+ süresiyle yapar. Geçici genişleyen sidebar `--ui-shadow-rail` ile çalışma alanına hafif kenar gölgesi düşürür. Yazılım çiziminde blur kapalıdır; aynı karartma açılıp kapanır. Sidebar genişliği aynı ortak süre/easing ile değişir; reduced-motion her ikisini durdurur. Bu iki ortak kontrol, transform/opacity kuralının sınırlı istisnalarıdır.

Kimlik işaretlerinin dış kutusu 34px, görünen simge alanı 30px olur. Logo görselinin yalnız dış çerçevesi kırpılır; baş harfler korunur. Kullanıcı baş harfleri aynı kavis ve düz zeminde görünür. Açılış genel kültür ekranındaki Breathing Orb, 7.0.294 gibi durum metninin solunda 64px ve 12px sağ boşlukla gösterilir.
