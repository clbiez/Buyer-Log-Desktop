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

Üç tema vardır: `light`, `grey`, `dark`. Açık ve karanlık temanın eski nötr
ailesi ile tablo başlığı renkleri korunur. Grey, serin mat gri bir çalışma
zeminidir. Tema rengi yalnız `data-theme` üzerinden değişir.

| Token | Light | Grey | Kullanım |
| --- | --- | --- | --- |
| `--ui-canvas` | `#f5f7f9` | `#d4d5d7` | çalışma zemini |
| `--ui-surface` | `#ffffff` | `#e9eaec` | veri yüzeyi |
| `--ui-surface-soft` | `#fafbfc` | `#dfe1e4` | ikincil yüzey |
| `--ui-text` | `#16212d` | `#19222c` | ana metin |
| `--ui-text-muted` | `#5f6f80` | `#414e5a` | açıklama |
| `--ui-accent` | `#356a96` | `#315e83` | eylem ve odak |

Karanlık değerlerin ve durum renklerinin kanonik kaynağı `ui-tokens.css`’tir.
Renk literal’leri yalnız bu kaynakta tanımlanır; custom property ve var fallback değerleri de guard kapsamındadır. `design-color-baseline.json`
boştur; UI CSS dosyalarında ham renk borcu yoktur.

7.0.294'ün kullanıcı tarafından tercih edilen belirgin yüzey hiyerarşisi korunur:
ortak paneller, kartlar, modüller ve düğmeler `--ui-group-divider` ile ince 1px
sınıra sahiptir. Araç çubuğu ve tablo satırı ayraçları `--ui-row-divider`
kullanır. Gölge yalnız geçici, üstte duran yüzey için
`--ui-shadow-overlay` değeridir. Her karta gölge yoktur.
Mor/indigo, neon, gradyan yazı, glassmorphism ve süs ışıması kullanılmaz.
Durumlar renk yanında metin, simge veya sayıyla açıklanır.

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
   üzerinde `--ui-group-divider` ile 1px sınır. Checkbox'ta durum
   okunabilirliği, kullanıcı avatarında logo ile eşit kare köşe uygulanır.
7. Basılı/dışa aktarılan belge kendi sabit çıktı sözleşmesini korur (§8).

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
  kancaları korunur, ortak bileşen görünümüne bağlanır.
- Segment ve sekme: köşeli, seçili yüzey ve `aria-selected`/`aria-pressed`.
  Ortak Tab/ok tuşu davranışı korunur. Filtre etiketi durum metnini taşır.
- Alan: yüzeyle ayrılır; görünür label, placeholder, disabled ve hata durumu.
  `aria-invalid` yalnız renk dışında hata açıklamasıyla birlikte kullanılır.
- KPI: küçük açıklama, tabular sayısal değer ve alt bağlam. Her KPI ayrı
  çerçeveli/gölgeli kart değildir.
- Boş/hata/bekleme: kısa başlık, neyin eksik olduğunu anlatan metin, uygun
  eylem. Yükleme için sabit kare durum işareti; emoji ve dekoratif spinner yok.
- Modal/çekmece: adlandırılmış dialog, ilk odak, Tab/Shift+Tab sınırı, Escape
  ve tetikleyiciye odak dönüşü. İç içe pencerede yalnız üst katman kapanır.
- Popover/menü: ortak yüzey; ok/Home/End, disabled öğe atlama ve Escape.

Hover, focus, active, selected, disabled, loading, empty ve error durumları
aynı tokenları kullanır. Modül CSS’i bu durumlara ayrı renk/çerçeve icat etmez.

## 6. Katmanlar ve hareket

| Token | Seviye | Amaç |
| --- | ---: | --- |
| `--ui-z-below/base/data/raised` | -1 / 0 / 1 / 2 | yerel veri geometrisi |
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
240 ms overlay, 340 ms sayfa, 360 ms kart, 390 ms tablo, 440 ms grafik.
Easing ortak cubic-bezier ile izlenir. Hareket içerik, geometri ve iş verisi
üzerinde kalıcı değişiklik yapmaz. Tema değişimi anlıktır; otomatik parıltı,
snapshot dalgası veya clip-path geçişi yoktur. **Thinking Orbs istisnası:**
7.0.294'ten gelen Breathing (açılış/bekleme) ve Working (harita yüklemesi)
canvas bileşenleri yalnız gerçekten çalışan `thinking`/loading durumu boyunca
semantik işlem göstergesi olarak kullanılabilir. Her orb görünmez sekme, ekran
dışı kalma, işlem sonu ve reduced-motion için duraklama/durdurma ya da tek kare
uygulamalıdır. Sürekli dekoratif canvas hareketi hâlâ yasaktır.

**Sol üstten dalga:** Aktif tablodaki sadece ilk iki görünür gridin en fazla
9 satır × 12 sütununda tek giriş efekti uygulanır. Hücreler diagonal gecikmeyle
`--ui-selected` renginden özgün görünümüne döner; yatay/dikey kaydırma, seçim,
hücre düzenleme, veri değişimi ve export tetiklemez. Aktif/seçilmiş/düzenlenen
hücreler atlanır. Yeni sayfa aktivasyonunda tekrar çalışabilir; scroll,
filtre seçimi veya her veri yaması bir dalga başlatmaz.

**Erişilebilirlik/performans:** `prefers-reduced-motion`, görünmeyen sekme ve
`data-bl-motion='off'` tüm hareketi devre dışı bırakır. Hareketler sayfa
geçişinde iptal edilir; `opacity/transform` tercih edilir. Yalnız tablo girişinde
kısa süreli token tabanlı `backgroundColor` WAAPI istisnası vardır. Grafik ve
kartlar görünürlükle sınırlı, en çok 14/16 öğe üzerinden animasyon alır.
Aynı yeni görünür işlevin TR/EN karşılığı, 3 tema × 4 boyut, reduced-motion,
klavye/scroll ve veri doğruluğu regresyonları teslim koşuludur.

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

Kullanıcı avatarı `icons/avatar-patch.png` paketli saten plakayı, uygulama logosu
`icons/icon-mark.png` dosyasını kullanır. Plaka bütün temalarda açık olduğu için
baş harfler `--ui-avatar-ink`, yedek zemin `--ui-avatar-paper` ile sabittir.
Baş harf üstüne ayrı bir yüzey kapatılmaz; ad/baş harf üretimi değişmez.
Metin gradyanı, ışıma veya yeni avatar çerçevesi eklenmez.

Satır sıklığı, istisna kutusu, fiyat kaynağı, toplu işlem ve kayıt/ilerleme
yüzeyleri de `ui-components.css` sahibidir; modül CSS dosyaları yalnız ölçü ve
yerleşim taşır. Kullanıcıya bağlı sıklık ayarı yazı ölçeğinden bağımsızdır.
