# Manifest — Faz 1 pilotu

25 Ekim 2026 · P2 · Yerel branch: `ui-rebuild/phase-1-manifest`.

## Değişti

Kullanıcı Manifest'i seçti. Açık/koyu nötr yüzeyler ve üç temanın gerçek tablo
başlık renkleri başlangıç paletinden korunur. Gri yüzeyler yeniden dengelendi;
konseptteki dördüncü Graphite tema üretim pilotuna alınmadı. Kullanıcının son
kararı, ana sütun grupları arasındaki **1 px düşük kontrastlı dikey çizgiye**
izin verir. Çizgi iki başlık katını kapsar; hücre gövdelerinde dikey ızgara yoktur.

Yerel IBM Plex Sans gövde, Plex Mono kayıt/metaveri ve Barlow Condensed başlık
hiyerarşisi kullanılır. OFL lisansları paket içindedir. `--ui-font-add` ile
compact/standard/large/xl korunur. Light metin-muted ve success renkleri
4.5:1 kontrast için küçük ölçüde koyulaştırıldı; export renklerine dokunulmadı.

Pilot kapsamı: ortak kabuk ve kontroller, Overview ana görünümü, CP ana tablo
ve araçları, sipariş notu modalı, Termin Ufku ve küresel akış grafiği, giriş
ve boot guard. Hover/focus/active/selected/disabled/loading/empty/error
durumlarının ortak sözleşmesi vardır. Not modalında ileri/geri Tab odağı
içeride kalır; Escape ve önceki odağa dönüş korunur.

Notların canonical save yolu, filtre/sıralama/veri hesapları, klavye kısayolları,
LCW AI motoru ve auth kontrolleri değiştirilmedi. Sunucuda yalnız adları sabit
UI CSS/JS/font dosyaları auth öncesi erişime açıldı; wildcard veya veri rotası
eklenmedi. Giriş yalnız tema/ölçek tercihini saklar; kullanıcı/credential saklamaz.
Boot hazırlık kapıları değişmedi. Dekoratif orb, sayısal count-up ve tema dalgası
pilot alanlarda çalışmaz. Grafik doğrudan etkileşimle çizilir; boşta RAF döngüsü yoktur.

## Dosyalar

- `resources/app/public/ui-tokens.css`: tek palet, ölçek, font, hareket, yüzey ve z-index kaynağı.
- `ui-components.css`: taşınan ortak görünüm ve mevcut hook'lara uyarlama.
- `ui-startup.css`, `giris.css`, `ui-appearance.js`: ortak giriş/açılış görünümü.
- `ui-legacy-bridge.css`: eski adları yeni tokenlara eşleyen **geçici** köprü.
  Yeni bileşenler doğrudan `--ui-*` kullanır; `--thead-*` eşlenmez.
  [Köprü envanteri](ui-rebuild/phase-1/compatibility-scope.json). Faz 3'te silinecek.
- `index.html`, `select-user.html`, `app-main.js`: ownership işaretleri ve modal klavye desteği; eski id/class/data hook'ları korunur.
- `overview-layout.js`, `overview-global-flow.js`, `kpi-motion.js`, `theme-transition.js`, `buyerlog-trivia.js`: pilot yerleşimi, kare işaretçiler ve amaçlı hareket.
- `server/server.js`, `server/lib/auth.js`: sabit giriş varlık listesi ve ortak stil yükleme.
- `release-notes/next.json` + `next-assets/manifest-*.png`: beş ayrı TR/EN kayıt ve gerçek anonim PNG; önceki kayıtlar korunur.

[Çevrimdışı HTML](ui-rebuild/manifest-pilot.html),
[CP gri](ui-rebuild/phase-1/final/cp-grey.png),
[Overview açık](ui-rebuild/phase-1/final/overview-light.png),
[not modalı](ui-rebuild/phase-1/final/notes-light.png),
[giriş](ui-rebuild/phase-1/final/login-light.png),
[açılış gri](ui-rebuild/phase-1/final/startup-grey.png).
Görseller gerçek Chromium/Buyer Log, 220 üretilmiş kaynak kaydı → 191 aktif CP
satırı, seed 7, sabit 2026-10-25 tarihi; gerçek iş verisi kullanılmadı.

## Doğrulama

[Hedefli komut ve sonuç kaydı](ui-rebuild/phase-1/checks.json).
İlk bütünleşik pilot çalıştırmasında **205/205** ilgili test geçti. Sonraki
dar boot/horizon düzeltmelerinden sonra yalnız etkilenen **39/39** test geçti.
Border longhand denetimi sıkılaştırıldıktan sonra Manifest guard'ının **7/7**
testi; release note / agent sözleşmesinin **12/12** testi ayrıca geçti.
Tam `npm test` **çalıştırılmadı**; kullanıcı kararıyla proje sonuna bırakıldı.

- Üç temada Overview/CP/not/giriş/boot ve giriş hata durumu; ortak köprü için
  Siparişler/Koleksiyon/Veri Yönetimi temsilî ekranları: 19 gerçek PNG.
  [Ekran kontrolleri](ui-rebuild/phase-1/final/capture.json).
- Dört arayüz ölçeği ve 1440×900 / 1280×720 temsilî kontrolü:
  [ölçek, klavye, font ve davranış](ui-rebuild/phase-1/validation-final/validation.json).
  Son başlık/giriş/boot değişiklikleri için yalnız etkilenen 1280 XL ekranlar
  ayrıca [doğrulandı](ui-rebuild/phase-1/final/supplement.json).
- XL Termin Ufku taşması bulundu; grafik kendi alanında kaydırılabilir yapıldı.
  Alt açıklamayla çakışma yok; 14 günlük son güne klavye odağıyla erişim var.
  [Son grafik kontrolü](ui-rebuild/phase-1/final/horizon-layout.json).
- Görünen etkin metin örneklerinde 4.5:1 altı bulgu yok. Kare checkbox/odak
  göstergeleri ayrıca [3:1 eşiğiyle kontrol edildi](ui-rebuild/phase-1/final/indicator-contrast.json). Bu ölçüm resim/örtüşme/opaklığı
  tam modellemez; tam uygulama erişilebilirlik sertifikası değildir.
- Ctrl+K arama (BARBIE: 17/191), checkbox seçimi, gerçek clipboard, Alanlar
  popover, Ctrl+Shift+K, not modalı Tab/Shift+Tab/Escape ve giriş autocomplete /
  yanlış parola kontrolü geçti. Canonical not kayıt/undo/export davranışı ilgili
  mevcut testlerle korundu. Reduced-motion'da çalışan animasyon yok.
- Üç temada **72'şer canlı başlık rengi** eski referansla aynı.
  Altı HTML/TSV kopya dosyası byte olarak, üç XLSX'in bütün `xl/*` parçaları
  [referansla aynı](ui-rebuild/phase-1/final/export-equivalence.json).
  Bu nedenle ayrı export paletine geçmek gerekmedi; eski `--thead-*` korunur.
- Yerel üç fontun Türkçe glifleri yüklendi; paketli WOFF2 cmap kapsamı ayrıca
  [doğrulandı](ui-rebuild/phase-1/final/font-coverage.json). İnternet/font CDN bağımlılığı yok.
- HTML'nin içine gömülü 15 PNG, kaynak görüntülerle SHA-256 olarak aynı.
  Ağ kapalı / JavaScript kapalı Chromium'da 390, 1280 ve 1440 px genişliklerde
  taşma yok; native details klavye kontrolü çalışır.
  [HTML doğrulaması](ui-rebuild/phase-1/final/gallery-validation.json).
  Yönetilen Chromium `file://` gezinmesini engelledi; politika değiştirilmeden
  dosyanın aynı baytları boş offline sayfaya yüklenerek render edildi.
- i18n: yeni eksik 0; baseline 0. Release note validator sonucu kontrol kaydındadır.
  Sürüm dosyaları değişmedi; ara fazda `version:assert` tekrarlanmadı.

### Guard gerekçeleri

`ui-manifest-contract.test.js`, taşınan CSS için tanımsız/legacy token,
çerçeve, >2px köşe, gradient/blur, ham z-index, px font-size/font shorthand,
transform/opacity dışı hareket ve sözleşme dışı variant yakalar. İstisnalar
yalnız CP gövdesinin 1px yatay çizgisi, iki başlık katının ana grup çizgisi,
focus outline ve isimli overlay shadow'dur. Grafik eksenleri/veri işaretçileri
canvas veri çizimidir; kart çerçevesine izin vermez.

`design-token-guard` artık ortak `--ui-font-*` semantik tokenlarını tanır;
girişte aynı ölçeği tekrar tanımlamayı yasaklar. `ui-component-contract`
eski tüketicileri kontrol etmeyi sürdürür, yeni bileşenlerin köprüye bağımlı
olmamasını ekler. `design-color-baseline` içinden `giris.css`'in 68 eski
ham rengi **çıkarıldı**; hiçbir baseline/istisna listesi büyütülmedi.
Boot/login testlerinde eski görünüm beklentileri yeni sözleşmeye çevrildi;
hazırlık kapıları, auth davranışı, canonical save ve eski orb matematiği testleri
korundu. Notes test fixture'ına gerçek DOM'un `dataset` alanı eklendi.

### Performans ve yöntem

Başlangıç: açılış **1020.1 ms**, ilk CP geçişi **975.4 ms**, 5000 kayıt
projeksiyonu **2995.9 ms**. Son medyanlar sırasıyla **1014.3 / 1017.8 / 2989.4 ms**.
İlk CP geçişi **+42.4 ms (%4.35)**; açılış ve büyük tablo yaklaşık aynı düzeyde.
Bu küçük CP artışı raporlanır; istatistiksel olarak gürültü olduğu iddia edilmez.
Son ölçüm ve farklar
[BLPerf kaydında](ui-rebuild/phase-1/final/performance-comparison.json).
Beş yeni tarayıcı context'inin medyanı; aynı warm server, Chromium 154,
Node 24.19, 1440×900/açık/standard/reduced-motion ve anonim veri. Büyük
tabloda 5000 veri satırına karşı normal sayfalama ile 50 DOM satırı.
Windows/Electron veya cold disk ölçümü değildir; tek ortam farklarını ürün
geneline performans garantisi olarak yorumlamıyoruz. Gizli modüllerin lazy
yüklenmesi ve başlangıçta görünmeyen tabloların boş DOM'u ayrıca kaydedildi.

Geniş `@scope`, negatif selector ve universal reset deneyleri CP geçişini
yavaşlattı; geri alındı. Mevcut eski CSS dosyaları topluca değiştirilmedi.
Deney ölçümleri `phase-1/performance.json`, `perf-fast`, `perf-components`,
`perf-layers`, `perf-compatible` altında tutulur; son ürün sonucu değildir.
`perf-during-release-notes` koşusu sürerken pending not paketi güncellendiği
için final karşılaştırmaya alınmadı; notlar sabitlendikten sonra ölçüm tekrarlandı.
İlk hedefli koşularda eski görünüm/fixture beklentileri hata verdi; nedenleri
yukarıda yazılıdır, son ilgili koşular yeşildir. HTML template sunucuda cache
edildiği için son boot yükleme sırası değişiminden sonra gerçek server yeniden
başlatıldı; sadece tarayıcı reload'una dayanılmadı.

## Notlar

Pilot tüm uygulama göçü değildir. CP'nin kalan pencereleri, Overview ayrıntı
çekmeceleri, bildirimler, rehber/sürüm notları, LCW AI ve diğer modüller Faz 2
envanterindedir. Eski CSS, `design-butunluk.css` ve geçici token köprüsü halen
vardır; Faz 3'te kaldırılacaktır. Yeni z-index adları eski overlay sırasıyla
uyumludur; uygulama genelindeki sadeleştirme Faz 3'e aittir. Kayıtlı kişisel
Overview yerleşimleri korunur; yeni yerleşim yalnız varsayılan düzen içindir.

| Faz | PR / yerel durum | CI | Merge | TEST | STABLE |
| --- | --- | --- | --- | --- | --- |
| 0A | `ui-rebuild/phase-0-audit`, yerel rapor | Tetiklenmedi | Yok | Yok | Yok |
| 0B | Kartela / Manifest ayrı geçici yerel branch; Manifest seçildi | Tetiklenmedi | Prototipler merge edilmedi | Yok | Yok |
| 1 | `ui-rebuild/phase-1-manifest`, yerel pilot + [PR taslağı](ui-rebuild-phase-1-pr.md) | Tetiklenmedi | Yok | Yayınlanmadı | Yayınlanmadı |
| 2–3 | Başlamadı; Faz 1 pilot onayı bekleniyor | Yok | Yok | Yok | Yok |

Branch, üretim kodu değişmemiş audit tabanı `ad669e4d` üzerinden kuruldu;
geçici konsept branch'leri merge edilmedi. `main` hedefli PR otomatik
`buyerlog-pr-fast-checks.yml` çalıştırır. Kullanıcının Actions onayı olmadığı
için PR açılmadı/push yapılmadı; workflow kuralları değiştirilmedi. Yerel test
sonuçları CI sonucu değildir. Faz 2'ye **pilot onayı olmadan geçilmeyecek**.
Proje sonu tam görsel matris, tam erişilebilirlik/işlev doğrulaması ve tam
`npm test` henüz yapılmadığından bütün yeniden inşa tamamlandı denemez.
