# Buyer Log — Faz 0B konsept kararı

**Güncel renk yönü:** Kullanıcı önceki nötrleri ve tablo başlık renklerini
tercih etti. [Renk revizyonu](ui-rebuild-palette-revision.md) ve mevcut galeri
yeni durumu gösterir; aşağıdaki ilk paletler tarihçedir. Yerleşim seçimi henüz yok.

**Karar kapısı:** İki geçici dal hazır. Kullanıcı konsept seçmeden Faz 1 başlamaz.
Prototipler üretime merge edilmez. [Üç temalı karşılaştırma galerisi](ui-rebuild/concepts.html).

## Tasarım karşılaştırması

| | A — Kartela | B — Manifest |
| --- | --- | --- |
| Kaynak | Kumaş kartelası, matbaa, editoryal sayfa | Teknik föy, ürün etiketi, sevkiyat manifestosu |
| Açık palet | Ekru `#f5f2e9`, zeytin `#435c42` | Soğuk kâğıt `#f1f3f1`, petrol `#225e62` |
| Grey / dark | Sıcak taş / yeşil kömür | Gri petrol / koyu petrol |
| Yerel font | Barlow gövde, Source Serif 4 başlık, Plex Mono kod | Plex Sans gövde, Barlow Condensed başlık, Plex Mono kod |
| Tipografik ölçek | 24 tabanlı başlık, 44 tabanlı açık metrik | 30 tabanlı dar başlık, 36 tabanlı metrik |
| Yüzey | Çerçevesiz, açık metrik satırı; az sayıda kâğıt tonu | Kesintisiz bilgi bantları; daha sıkı yüzey ve başlık hiyerarşisi |
| Grafik | Geniş dikey termin grafiği; sağda sipariş dağılımı | Yatay termin grafiği; aynı sırada geniş lojistik haritası |
| Tablo | Sütun grubu etiketleri; satırları ayıran hafif ton değişimi | Koyu teknik grup başlığı; yalnız tek düşük kontrastlı yatay satır çizgisi |
| İşlevsel imza | Kartela gibi ayrılan veri grupları, matbaa metrikleri | Manifesto gibi okunabilen alan kodları ve durum etiketleri |
| Hareket | Popover girişinde 150 ms opacity / 4 px düşey transform | Popover girişinde 100 ms opacity / 4 px yatay transform |
| Ödünleşim | Daha ferah; harita sayfanın aşağısında | Lojistik ilk ekranda; tipografik hiyerarşi daha teknik |

Ölçekteki sayılar sabit kullanıcı fontu değildir: mevcut `--ui-font-add` eklenir.
Standart, büyük, XL ve kompakt seçimleri korunur. Türkçe `ÇĞİÖŞÜçğıöşü`
karakter kapsamı yeni font dosyalarında doğrulandı; OFL lisansları paketlendi.
Fontlar yerel WOFF2, dış font isteği yok. İki yönde de dekoratif sayaç ve
harita hareketi kapalı; reduced-motion desteği var.

**Öneri: Kartela.** Tekstil bağlamına daha özgün bir kimlik getiriyor.
Operasyon ve lojistiğin aynı ekranda yoğun görünmesi öncelikliyse Manifest
daha uygun. Seçim, sonraki fazın ortak token ve bileşen sisteminin yönünü belirler.

## Gerçek PNG'ler

| Ekran / tema | Kartela | Manifest |
| --- | --- | --- |
| Overview / açık | [PNG](ui-rebuild/evidence/kartela/overview-light.png) | [PNG](ui-rebuild/evidence/manifest/overview-light.png) |
| Overview / grey | [PNG](ui-rebuild/evidence/kartela/overview-grey.png) | [PNG](ui-rebuild/evidence/manifest/overview-grey.png) |
| Overview / dark | [PNG](ui-rebuild/evidence/kartela/overview-dark.png) | [PNG](ui-rebuild/evidence/manifest/overview-dark.png) |
| CP / açık | [PNG](ui-rebuild/evidence/kartela/cp-light.png) | [PNG](ui-rebuild/evidence/manifest/cp-light.png) |
| CP / grey | [PNG](ui-rebuild/evidence/kartela/cp-grey.png) | [PNG](ui-rebuild/evidence/manifest/cp-grey.png) |
| CP / dark | [PNG](ui-rebuild/evidence/kartela/cp-dark.png) | [PNG](ui-rebuild/evidence/manifest/cp-dark.png) |

Her dal için ayrıca dört boyutu temsil eden 1440×900 görüntüler, üç temada
XL 1280×720, İngilizce Overview/CP, alanlar popover'ı ve klavye odağı PNG'leri
aynı kanıt dizinindedir. Görüntüler gerçek uygulamadan; şirket verisi yok.
Son galeri çekiminde geçici import bildirimi kendi kapatma düğmesiyle
kapatıldı; DOM gizleme veya görüntü düzenleme uygulanmadı. Bildirimlerin
kendi görsel göçü Faz 2 kapsamındadır. Son çekim listesi: her dizindeki
`final-captures.json`.

## Hedefli doğrulama

- Her dalda **51/51** test geçti: design-token-guard, ui-component-contract,
  Overview düzeni, harita/coğrafya, theme-copy-performance ve table-range-excel-export.
  Son not alanı yüksekliği düzeltmesinden sonra yalnız ilgili Overview
  düzen testleri **12/12** tekrar geçti. [Kartela log](ui-rebuild/evidence/kartela/targeted-tests.log),
  [Manifest log](ui-rebuild/evidence/manifest/targeted-tests.log).
- `npm run i18n:check`: her dalda yeni eksik 0, baseline 0.
  Yeni ürün metni eklenmedi. TR/EN görüntüleri ve yerel font yüklenmesi kontrol edildi.
- Ctrl+K araması, BARBIE filtresi (191 kaydın 17'si), tek satır seçimi,
  gerçek clipboard kopyası, görünür alanlar düğmesi ve Ctrl+Shift+K komut
  paletinde odak kontrol edildi. Kalıcı veri/iş mantığı değiştirilmedi.
- Görünen metin örneklemindeki bulunan kontrast hataları düzeltildi; son
  `targeted-recheck.json` kayıtlarında başarısız örnek yok. Geometri örnekleminde
  yalnız izinli çalışma saati durum noktası dairesel. Görünür odak 2 px;
  reduced-motion koşulunda aktif animasyon 0. Bu örneklem tam WCAG kabulü değildir.
- CP araç çubuğunun XL'da taşması sarma düzeniyle giderildi. Son hedefli
  boyut kontrollerinde sayfa/araç çubuğu taşması yok. Geniş veri tablosunun
  kendi yatay kaydırması korunuyor. Not alanının iç gövdesi aşırı kısa
  kalıyordu; varsayılan widget yüksekliği iki dalda artırıldı.
- CP XLSX dosyalarının tüm `xl/*` parçaları (veri, stil, hücre renkleri dahil)
  ve biçimli HTML / düz TSV kopyası üç temada başlangıç referansıyla eşleşti.
  [Kartela karşılaştırma](ui-rebuild/evidence/kartela/export-comparison.json),
  [Manifest karşılaştırma](ui-rebuild/evidence/manifest/export-comparison.json).
  Diğer modüllerin export eşdeğerliği bu sonucun kapsamı değildir.
- Tam `npm test` çalıştırılmadı; kullanıcı kararıyla proje sonuna bırakıldı.
  Release-note/version dosyaları değişmediği ve Faz 0 istisnası olduğu için
  release/version komutları çalıştırılmadı. Guard veya baseline gevşetilmedi.

İlk `validation.json` bulunan sorunları tarihçe olarak korur. Düzeltmelerin
sonucu `targeted-recheck.json` içindedir; ilk dosyayı başarı göstermek için
yeniden yazmadık. PNG'ler son görsel durumu gösterir.

## BLPerf karşılaştırması

Beş yeni browser context, aynı sentetik veri ve ortam, sıcak yerel sunucu;
medyan ms. CPU kısıtlaması yok. Windows/Electron veya soğuk disk ölçümü değildir.

| Ölçüm | Başlangıç | Kartela | Manifest |
| --- | ---: | ---: | ---: |
| İlk kullanılabilir açılış | 1.020,1 | 979,8 (−%4,0) | 1.014,6 (−%0,5) |
| İlk CP geçişi | 975,4 | 1.102,3 (+%13,0) | 954,8 (−%2,1) |
| 5.000 kaydın yeni DOM'a ulaşması | 2.995,9 | 3.021,7 (+%0,9) | 2.989,0 (−%0,2) |
| Oluşan tablo satırı | 50 | 50 | 50 |

Kartela'nın CP geçişindeki yaklaşık **127 ms artış açık performans riskidir**;
korundu diye kabul edilmez. Seçilirse Faz 1'de CSS/font/ilk render maliyeti
ayrıştırılmalıdır. Küçük örneklemdeki diğer farklar iyileşme garantisi değildir.
Görünmeyen modül yüklenmesi ve CP/Orders başlangıç satır sayıları ham BLPerf
kayıtlarında saklandı; eager-render değişikliği yapılmadı.

Manifest'in ilk otomasyon denemesinde geç açılan release-note diyaloğu
navigasyonu engelledi; geçersiz deneme rapora katılmadı. İki startup metriği
ilk snapshot'tan sonra kaydedildiği için aynı çalışmanın sonraki BLPerf
snapshot'ındaki gerçek değerler kullanıldı. Sıfır/fabrikasyon örnek yok;
`performance.json.measurementNotes` yöntemi açıklar. Sonradan yapılan not
widget yüksekliği düzeltmesi için yalnız düzen testi ve ilgili Overview
görüntüleri yenilendi; tablo/font/veri yolu değişmediği için BLPerf tekrarlanmadı.

## Yerel inceleme açıklamaları ve durum

**A — `ui-rebuild/concept-kartela`:** Overview ve CP'nin görünümünü sıcak
kartela paletine ve editoryal tipografiye taşır. `ui-concept.css`, yerel fontlar,
`index.html`, Overview varsayılan yerleşimi ve harita/sayaç sunumu değişir.
Kanıtlar yukarıdaki PNG ve hedefli testlerdir. Risk: geçici override katmanı,
eski görünüm bağımlılıkları ve CP ilk geçiş maliyeti. Üretim merge adayı değildir.

**B — `ui-rebuild/concept-manifest`:** Aynı kapsamı teknik föy dili, yatay
termin grafiği ve haritaya öncelik veren düzene taşır. Aynı dosya aileleri
değişir; Plex Sans yerel paketi eklenir. Kanıtlar yukarıdadır. Risk: geçici
override katmanı, eski görünüm bağımlılıkları ve dolu not/koleksiyon senaryolarının
henüz kapsamda olmaması. Üretim merge adayı değildir.

Her iki dalın tabanı Faz 0A audit commit'i `8941425f`; dallar birbirine bağımlı
değildir. `ui-concept.css` seçimin üretim mimarisi değildir. Faz 1 ayrı dalda
tek token/bileşen kaynağını kuracak; giriş/boot ve eski modül uyumluluğunu
belgeleyecek. Mevcut guard'ların geçmesi yeni tasarım sözleşmesinin tümünü
denetledikleri anlamına gelmez; yeni guard'lar Faz 1–3 planındadır.

Yerel konsept commit'leri: **Kartela `2119e8a1`**, **Manifest `7f3b5c19`**.
Çalışma dizinleri sırasıyla `/workspace/buyerlog-concept-kartela` ve
`/workspace/buyerlog-concept-manifest`; denetim/karşılaştırma paketi
`/workspace/Buyer-Log-Desktop` içindedir. Kaynak, lisans ve araç diff kontrolleri
temiz. Ham TSV referanslarında son boş hücreleri taşıyan tab ve CRLF baytları
bilerek aynen korunur; tüm kanıt dizinine uygulanan whitespace kontrolü bunları
işaretler. Export eşdeğerliğini bozacak metin normalizasyonu yapılmadı ve bu
durum için repo guard/baseline istisnası eklenmedi.

| Faz / dal | PR | CI | Merge | TEST | STABLE |
| --- | --- | --- | --- | --- | --- |
| 0A — phase-0-audit | Yerel commit; PR yok | Çalışmadı | Yapılmadı | Yayınlanmadı | Yayınlanmadı |
| 0B — concept-kartela | Yerel dal ve inceleme açıklaması | Çalışmadı | Yapılmadı; prototip | Yayınlanmadı | Yayınlanmadı |
| 0B — concept-manifest | Yerel dal ve inceleme açıklaması | Çalışmadı | Yapılmadı; prototip | Yayınlanmadı | Yayınlanmadı |
| 1–3 | Başlamadı; karar kapıları bekleniyor | Başlamadı | Yapılmadı | Yayınlanmadı | Yayınlanmadı |

`main` hedefli PR otomatik Actions tetikler. Kullanıcı onayı olmadan PR/Actions
açılmadı; workflow kuralları aşılmadı. Bu paket tüm yeniden inşanın tamamlandığı
iddiasını taşımaz. Üretim release note'u Faz 0 için kullanıcı isteğiyle gerekli değil.

## Galerinin tek dosya olarak yeniden gönderilmesi

İlk HTML, PNG ve fontları göreli dosya yollarından okuyordu; depodan ayrı
açıldığında bu bağımlılıklar taşınmıyordu. `ui-rebuild/concepts.html` artık
12 gerçek PNG'yi, fontları ve OFL lisansını kendi içinde taşır. Tema/ekran
başlıkları ve tam boy görüntü seçimi JavaScript gerektirmez. Yeniden üretim:
`python docs/ai/ui-rebuild/tools/build-standalone-gallery.py`.

Hedefli tarayıcı kontrolü internet ve sayfa JavaScript'i kapalıyken yapıldı:
12 görüntünün özgün baytları eşleşti, altı ekran/tema çifti açıldı, fontlar
yüklendi, klavye ve tam boy görüntü kontrolleri çalıştı, 390 px genişlikte
sayfa taşmadı. Kanıt: `gallery-standalone-check.json` ve
`gallery-standalone-preview.png`. Üretim/prototip kodu değişmedi;
uygulama testleri tekrar çalıştırılmadı. PR/CI/merge/TEST/STABLE durumu değişmedi.
