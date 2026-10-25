# Manifest — Faz 3 temizlik ve son doğrulama

Durum: yerel uygulama, temizlik ve proje sonu doğrulama tamamlandı. Yayın
yapılmadı; platform sınırları ve performans farkı aşağıda açıkça kayıtlı. Dal:
`ui-rebuild/phase-3-consolidation`, bağımlı taban `05951638`
(`ui-rebuild/phase-2-remaining`). Gerçek PR açılmadı; CI/merge/TEST/STABLE yok.

## Değişiklik

- `design-butunluk.css` ve `ui-legacy-bridge.css` kaldırıldı. `app.css`,
  `design.css`, `experience.css` ve modül dosyaları yalnız yerleşim/veri ölçüsü
  taşıyor. Bütün görünüm ortak token ve bileşen sahiplerine taşındı.
- Eski root palet/font/ölçü takma adları kaldırıldı. Dört ölçeğin eski çalışma
  anı geometrisi [önceki ölçümde](ui-rebuild/phase-3/root-values-before.json)
  saklandı; kanonik UI isimleriyle aynı boyutlar korunuyor.
- İlk güvenli tam-seçici temizliği 390, sonraki ortak reset ve eşit özgüllüklü
  seçici temizliği 4.035 tekrarlı deklarasyon ile 708 boş kuralı kaldırdı. Seçici özgüllüğü,
  at-rule koşulu ve `!important` önceliği korunuyor. Ölü tema dalgası ve orb
  betikleri artık üretimden yüklenmiyor/servis edilmiyor.
- Üretimde çağrılmayan eski lisans iframe’i ve yardımcıları test fixture’ına
  taşındı. Orijinal HTML script/style SHA testleri aynen korunuyor. Aktif native
  lisans kartı ve harita editörü değişmedi; data recovery testleri sürüyor.
- Katmanlar base/data/raised, sticky/column, chrome, popover, modal, modal-menu,
  tooltip ve boot seviyelerine indirildi. Modal stack 201–299 aralığında.
  Sabitlenen hücrelerin normal düzenleme hücrelerinin üzerinde, başlıklarının
  diğer başlıkların üzerinde kalması düzeltildi. Bildirimler modalın üzerindedir.
- Native tarih/sütun önerileri iç içe modalın üzerinde ortak menü bandını kullanır.
  Aktif spreadsheet hücresi klavye imlecini görünür tutar. Diğer seçim/drag/hata
  yüzeyleri outline çerçevesi yerine yüzey tonu kullanır.
- PLM sürükleme durumu ortak CSS’e taşındı; mevcut `blKolPlmDragStyle` readiness
  kimliği korunuyor. Etiketin TR ve EN karşılıkları var.
- Üreticisi bulunmayan kişisel Horizon editörünün 74 CSS kuralı public/server
  JS+HTML referans taramasıyla doğrulanıp kaldırıldı; aktif ortak dmf filtreleri
  korunur. [Kanıt](ui-rebuild/phase-3/retired-horizon-css.json).
- `DESIGN_SYSTEM.md` gerçek Manifest sahipliği, geometri, 4 ölçek, 3 tema,
  katman, erişilebilirlik ve export istisnalarıyla yeniden yazıldı.

## Çıktının ayrılması

LCW AI `output-theme.js`, eski `design.css`/`app.css` paletini okuyordu. Renkler
`export-document-palette.json` içine birebir donduruldu. Değişiklik öncesi
`theme().colors` ve `reportCss()` referansı saklandı; palette ve üretilen CSS’in
eşitlik kontrolü geçti. Son karşılaştırmada 46 çıktının tamamı eşit; CSS
optimizasyonu sonrası DOM duyarlı 18 nakliye çıktısı ayrıca yeniden eşleşti.

Tedarikçi HTML fontları da CSS font-face taramasına bağlıydı. Şimdi aynı 10 yerel
Barlow/Condensed dosyası ve Unicode aralıkları açık belge font listesinde.
Bağımsız fixture SHA’ları, data URI gömme ve cache davranışı testi başarılı.
Önceki stylesheet zinciri Condensed font-face’lerini tekrarlayabiliyordu; yeni
liste aynı dosyayı tek kez gömer. Belge içerik/font metrikleri korunur; duplicate
font-face metninin byte dizisi eşitliği iddia edilmez.

LCW belge iframe’indeki `--acc`/`--line` değişkenleri bilinçli belge kapsamıdır;
UI takma adı temizliğinden muaf tutuldu. Backlog workbook seri paleti de ekrandan
bağımsız sabitlendi. Shipping print’in pt ölçüleri ve renkleri yalnız isimli print
seçicilerinde, `--ui-print-*` paletiyle korunur.

## Guard değişikliklerinin gerekçesi

Ham renk baseline’ı 20/12/9’dan **boş** hale indi; artık büyümesi ayrıca yasak.
Manifest guard dört sahip dosyadan bütün aktif üst düzey CSS’e genişledi. Yeni
inline guard JS/HTML’de köşe/çerçeve, sabit px font ve sayısal katmanı yakalar.
Kanonik token referansları yalnız `ui-tokens.css`’te tanımlı olabilir. Modül
geometrisi ayrı, tanımlı ölçü değişkenleri kullanabilir; renk/typografi tanımlayamaz.

Önceki regresyon testlerinin kaldırılan CSS dosyası/yorum başlığına bağlı kaynak
okumaları yeni gerçek sahiplerine geçirildi. `helpers/manifest-css.js` sadece
root kapsamını ve formatı normalize eder, hiçbir değer/deklarasyon uydurmaz.
Eski paletteki token adlarının beklenenleri yeni kanonik isimlere güncellendi.
Veri/iş kuralı, hash, güvenlik ve davranış doğrulamaları tutuldu. Dekoratif dalga,
çelik avatar/gradient ve eski çerçeve gerektiren testler seçilmiş ürün dilinin
anlık tema, okunur baş harf ve çerçevesiz yüzey sözleşmelerine dönüştürüldü.

## Son görsel ve davranış doğrulaması

- [Envanter eşlemesi](ui-rebuild/phase-3/coverage.json): 145 kayıt / 142 benzersiz
  ID; eşlenmemiş veya bekleyen yüzey yok. Birebir ortak bileşenlerin temsilî
  eşleşmeleri gerekçeli olarak kayıtlı.
- [Matris özeti](ui-rebuild/phase-3/matrix-summary.json): **164 aile × 24 = 3.936
  güncel görünüm**; 3 tema × 4 boyut × 1440×900 / 1280×720. Geçmiş revizyonlarla
  birlikte 4.464 gerçek PNG saklıdır. Güncel geometri/kontrast/yatay belge taşması
  bulgusu yok; 508.983 görünür metin örneği denetlendi. Metin için 4,5:1;
  [gerekli göstergelerde](ui-rebuild/phase-3/indicator-contrast.json) 156 kontrol,
  minimum 3,033:1. Bu otomatik ölçümler resmî WCAG sertifikası değildir.
- Gri/XL/1280 temas sayfaları, ardından ilgili tam boyutlu açık/koyu görüntüler
  incelendi. CPA başlık çakışması, dar e-posta seçenekleri, kesilen INTAKE filtresi,
  durum penceresi boşlukları ve iki metin kontrastı sorunu düzeltildi; yalnız
  etkilenen aileler yeniden çekildi.
- [Klavye](ui-rebuild/phase-3/keyboard-final.json): 36/36 Tab, Shift+Tab, Escape,
  odak dönüşü ve 2px görünür odak kontrolü başarılı. Reduced-motion açıkken etkin
  animasyon yok. Nonmodal filtre ve hover önizlemesi modal gibi odağı hapsetmez.
- Earth offline haritası, ayar/katman/görünüm panelleri üç tema/dört boyutta
  kontrol edildi. Kare işaretçi zeminleri son 24 görüntüde yenilendi. Yerel doku,
  rota hesabı ve seçim davranışı korundu; dekoratif atmosfer/ışık/hareket yok.
- Son durum revizyonları: kural hatası, sürükleme hedefi, fiyat onayı ve üretici
  matrisi dahil 120 görüntüde 0 runtime hata ve 0 bulgu. Dar menü 24 görünümde
  içerik offset'ini dört boyuta göre korur. Onay metni ve aria-invalid iki
  durumun yalnız renge bağlı kalmasını engeller.
- [Offline HTML galerisi](ui-rebuild/manifest-final.html) 75 gerçek PNG içerir.
  Kaynak dosyalar ve SHA değerleri [manifestte](ui-rebuild/phase-3/gallery-manifest.json).
  [Offline tarayıcı kontrolünde](ui-rebuild/phase-3/gallery-validation.json) 75/75
  PNG çözüldü; fontlar yüklendi; klavye aç/kapat ve iki viewport taşma kontrolü
  başarılı, dış istek/runtime hata yok. Yönetilen Chromium `file:` gezinmesini
  engellediğinden aynı yerel HTML baytları offline `setContent` ile incelendi;
  tarayıcı politikası değiştirilmedi.
- [Export](ui-rebuild/phase-3/export-equivalence.json): 46/46; HTML/TSV baytları ve
  XLSX'in bütün xl/ üyeleri eşit. [Son nakliye](ui-rebuild/phase-3/export-shipping-final-comparison.json):
  18/18. [LCW belge CSS/paleti](ui-rebuild/phase-3/lcwai-export-equivalence.json)
  birebir eşit. Belge fontları ayrı bağımsız SHA fixture'ıyla doğrulandı.

Orders export fixture'ında mevcut asenkron checklist sütun kaydı 51 yerine 58
sütun üretebiliyordu. İlk 9 fark saklandı; orijinal referanstaki aynı 51 görünür
kanonik sütun açıkça seçilince tüm çıktılar eşleşti. Ürün sütun iş kuralı veya
çıktı baytları karşılaştırmayı geçirecek şekilde değiştirilmedi. Ek 58 sütunlu
çıktılar ayrıca saklanır; referans eşitliği iddia edilmez.

Çekim geçmişindeki eksik DataTransfer/erken kapanma denemeleri ve eski CSS
kaynak sözleşmesi başarısızlıkları [gerekçeleriyle](ui-rebuild/phase-3/test-contract-migration.md)
saklanır. Son durumda başarısız görüntü geçmişi güncel sonuç diye gösterilmez.

## BLPerf

[Beş eşli son ölçüm](ui-rebuild/phase-3/performance/paired-final/comparison.json)
ayrı yeni sunucular, aynı 220 demo kayıt / 191 aktif CP, Chromium 154 ve Node 24
ile yapıldı. Başlangıç sırası dönüşümlüdür; eşzamanlı test, çekim ve profiler yoktur.

| Ölçüm | Başlangıç kodu | Manifest | Fark |
| --- | ---: | ---: | ---: |
| Açılış / first usable | 1087,8 ms | 1008,0 ms | −79,8 ms / −%7,3 |
| İlk CP geçişi | 907,6 ms | 923,0 ms | +15,4 ms / +%1,7 |
| 5.000 satır işleme/çizim | 2809,7 ms | 2957,6 ms | +147,9 ms / +%5,3 |

Büyük tablo örnekleri başlangıçta 2772,6–2990,8 ms, Manifest'te
2843,3–3039,6 ms aralığındadır. Sürelerin eşitliği iddia edilmez; büyük tabloda
küçük bir medyan artışı kalmıştır. Her koşuda DOM 50 satırdır, görünmeyen LFL,
Ön Maliyet, Üreticiler, Lisans ve Otomasyon modülleri eager yüklenmez.

Faz 0A tarihsel medyanları 1020,1 / 975,4 / 2995,9 ms idi; son karşılaştırma
aynı ortamda yeniden ölçülen kontrolü esas alır. Bunlar Linux/Chromium ve sıcak
sunucu ölçümleridir; Windows/Electron veya soğuk disk açılışı değildir.
CSS sadeleştirmesi öncesi/yeni [21 görünüm karşılaştırmasında](ui-rebuild/phase-3/performance/style-equivalence.json)
hesaplanan renk/font/ölçü/odak değerleri birebir aynıydı. Son eklenen anlamlı
hata/onay/drag durumları kendi yeni PNG matrisleriyle doğrulandı.

## Son kontroller ve yerel teslim

[Son kontrol kaydı](ui-rebuild/phase-3/checks.json) ve
[tam test logu](ui-rebuild/phase-3/checks/bl-p3-npm-test-full-5.log):
`npm test` **başarılı**, 1.060 dosya / 7.594 test / **7.529 geçen, 0 başarısız,
65 atlanan**, 5 batch, 89,1 saniye. Atlananların 64'ü mevcut Windows koşulları,
biri isteğe bağlı 20.000 işlemli sync soak testidir. Varsayılan izole sync
simülasyonları geçti; bu platform testleri çalıştırılmış sayılmaz.

Proje sonundaki ilk dört tam deneme sırasıyla 3, 2, 1 ve 4 eski kaynak/fixture
sözleşmesi beklentisinde durdu. Kaldırılan CSS sahipleri, yıldızsız AI etiketleri,
kanonik katmanlar, DOM dataset stub'ı ve giriş görünümünün yalnız `{theme,step}`
önbelleği gerçek sözleşmeye geçirildi. Her düzeltmede önce ilgili testler,
ardından son kodda tam paket çalıştırıldı. Başarısız loglar ve gerekçeler saklıdır;
tasarım/i18n baseline'ı veya test atlama listesi büyütülmedi. Başarılı tam test,
rapor ya da commit hazırlamak için yeniden çalıştırılmadı. Testten sonra üretim
ve test kodu değişmedi; [SHA kaydı](ui-rebuild/phase-3/tested-source-sha256.json)
test edilen değişiklikleri tanımlar.

TR/EN: 0 yeni eksik, 0 baseline. Release notes: 76 kayıt başarılı. Version:
7.0.294 başarılı. Tasarım token, bileşen, renk, inline ve Manifest guard'ları tam
koşuya dahildir. `git diff --check` başarılı; export referansı TSV'lerin gerekli
CRLF/son hücre sekmeleri metin boşluk denetiminden ayrı tutulur.

[Yerel PR taslağı](ui-rebuild-phase-3-pr.md) bağımlı G4 dalını hedefler.
Gerçek PR/CI/merge/TEST/STABLE yoktur. Main PR'ının Actions tetiklemesi kullanıcı
onayı gerektirir; workflow güvenliği veya test eşikleri değiştirilmedi.
Windows işletim sistemi pencereleri, gerçek dış PLM/LCW AI erişimi ve yayın
bu yerel çevrimdışı doğrulamanın kapsamında çalıştırılmış sayılmaz.

## Fazların teslim durumu

Dallar birbirine bağımlıdır; konsept dalları üretime alınmaz. Her fazın gerçek
PR bağlantısı yoktur; aşağıdaki bağlantılar açıkça **yerel PR açıklamasıdır**.

| Faz | Yerel durum / dal son eki | PR | CI | Merge | TEST | STABLE |
| --- | --- | --- | --- | --- | --- | --- |
| 0A | `phase-0-audit` / `ad669e4d` | Açılmadı | Çalışmadı | Yapılmadı | Yok | Yok |
| 0B | `concept-kartela`, `concept-manifest`; Manifest seçildi | Prototip, açılmadı | Çalışmadı | Birleştirilmez | Yok | Yok |
| 1 | `phase-1-manifest` / `2324ba7c`; pilot onaylandı | [Yerel taslak](ui-rebuild-phase-1-pr.md) | Çalışmadı | Yapılmadı | Yok | Yok |
| 2.1 | `phase-2-plan-execute` / `cc36116f` | [Yerel taslak](ui-rebuild-phase-2-plan-execute-pr.md) | Çalışmadı | Yapılmadı | Yok | Yok |
| 2.2 | `phase-2-commercial` / `b42b410c` | [Yerel taslak](ui-rebuild-phase-2-commercial-pr.md) | Çalışmadı | Yapılmadı | Yok | Yok |
| 2.3 | `phase-2-operations` / `555a1b48` | [Yerel taslak](ui-rebuild-phase-2-operations-pr.md) | Çalışmadı | Yapılmadı | Yok | Yok |
| 2.4 | `phase-2-remaining` / `05951638` | [Yerel taslak](ui-rebuild-phase-2-remaining-pr.md) | Çalışmadı | Yapılmadı | Yok | Yok |
| 3 | `phase-3-consolidation`; son kod ve kanıtlar hazır | [Yerel taslak](ui-rebuild-phase-3-pr.md) | Çalışmadı | Yapılmadı | Yok | Yok |

Dal adlarının ortak ön eki `ui-rebuild/`'dir. Faz 1 tabanı denetim dalıdır;
sonraki her dal bir önceki uygulama fazına dayanır. Main PR'ı otomatik Actions
çalıştırdığı için kullanıcı onayı olmadan açılmadı; yerel sonuçlar CI değildir.

## Sonraki kullanıcı kontrolü: logo ve genel kültür çizimleri

Kullanıcının HTML incelemesi iki görünür regresyonu ortaya çıkardı; eski görsel
kontrol bu eksikleri yakalamamıştı. [Düzeltme, güncel galeri ve yeni kontrol kaydı](ui-rebuild/logo-trivia-fix/README.md)
ayrı saklandı. Yukarıdaki 75 PNG galeri önceki sürümün tarihsel kanıtıdır;
logo ve açılışın güncel görüntüleri yeni galeridedir.
