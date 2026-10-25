# Manifest — Faz 2.2 / Ticari

Yerel branch: `ui-rebuild/phase-2-commercial`. Bağımlılık: Faz 2.1
`ui-rebuild/phase-2-plan-execute` / `cc36116f`. Bu faz için push, PR, Actions,
merge veya yayın yapılmadı.

## Değişiklik

Koleksiyon, Fiyat Masası (matris, liste, turlar, geçmiş, analiz), Fiyat & Üretici
Analizi, Üreticiler, Lisans kartları, LFL ve Ön Maliyet ortak Manifest görünümüne
taşındı. Eski Pricing History rotası aynı masanın Geçmiş sekmesini açmayı sürdürür.
Dokuz modül CSS'i yerleşim/veri geometrisiyle sınırlı; app/design/experience ve
design-butunluk içindeki sahipli kurallar da fiziksel olarak ayrıldı. 2015 kural,
4910 görünüm deklarasyonu ortak bileşen kaynağına taşındı. Faz 3'te bu adaptörlerin
yinelenen deklarasyonları konsolide edilecektir.

Koleksiyon ana grup ayraçları iki başlık satırını kapsar; gövdeye dikey çizgi
eklenmez. Ülke dağılımı etiketli doğrusal ölçü, fiyat grafiği işaretçileri karedir.
Trophy emojisi TR/EN “en iyi / best” metnine, stok manzara placeholder'ı teknik
föy işaretine dönüştü. Üreticilerde yinelenen başlık kaldırıldı. Uyarı metni ve
grafik karşılaştırma serilerinin kontrastı iyileştirildi.

Lisans haritasında Tab/Shift+Tab odağı içeride kalır ve kapanınca geri döner;
kaydedilmemiş değişiklik onayı korunur. Fiyat çekmecesi mevcut BLLayerSystem yolunu
kullanır. LFL senaryo penceresine aynı klavye sözleşmesi eklendi. Genel
`section{display:none}` kuralının gizlediği iki iç form bölümü yalnız LFL içinde
görünür kılındı. Eski görünüm animasyonunun fixed pencereyi sayfaya bağlayan
transform'u LFL'de kaldırıldı. Checkbox ve formun dönem/portföy alanları gerçek
tarayıcıda, Space ve Escape ile doğrulandı. İş hesapları ve veri şeması değişmedi.

## Korunan sözleşmeler

Canonical ID, sıralama/filtre, kayıt, fiyat/onay/drop, aktarım ve LCW AI yolları
korundu. Yeni API veya eager modül yükleme eklenmedi. Fontlar yerel ve ölçekli.
Üç tema sürer; dördüncü üretim teması eklenmedi. Kullanıcının eski nötr/table
başlık paleti tercihi sürer. Kullanıcı tarafından tanımlanan Koleksiyon durum
renkleri veri niteliğindedir; yalnız ilgili select/td ve renk seçici swatch'larında
dar guard istisnası vardır. `--kol-text-lh` ve `--pd-rate` yalnız veri geometrisidir.

Excel/kopyalama kaynakları tema DOM'undan bağımsızdı; yeni export adaptörü gerekmedi.
[Karşılaştırma](ui-rebuild/phase-2-commercial/export-comparison.json): üç temada
6 HTML/TSV byte düzeyinde, 3 Koleksiyon XLSX ve Ön Maliyet XLSX'in bütün `xl/*`
parçaları aynıdır. ZIP belge metadata zamanları karşılaştırmaya dahil değildir.
Fixture, gerçek CP→Koleksiyon canonical eşlemesini ve yalnız izole anonim sunucuyu
kullanır; üretim kullanıcı verisine erişmez.

## Kanıt ve hedefli kontroller

[Kontrol kayıtları](ui-rebuild/phase-2-commercial/checks.json).
24 ana ekran PNG'si, 14 ek durum/ölçek PNG'si ve değişen kapsam için son tekrarlar
saklandı. `final/` aynı isimli eski görüntülerin yerine geçer; eski `states/`
LFL senaryo görüntüsü ara hatayı gösterir, final kanıtı değildir. Son ana ekran ve
son pencere taramalarında geometri/kontrast/taşma ihlali yoktur. Otomatik kontrast
örneklemesi tüm WCAG kontrolünün yerine geçmez; tam envanter matrisi proje sonunda.

Hedefli wiring, export, spreadsheet, lisans editörü, LFL senaryosu ve tasarım
guard'ları çalıştırıldı. Eski stil dosyası/token arayan testler aynı davranış
beklentileriyle ortak kaynağa taşındı. Baseline yalnız daraltıldı:
collection-spreadsheet (9) ve pricing-workspace (7) çıkarıldı; app.css 48→32.
Yeni baseline/kaçış kaydı yok. i18n: 0 yeni/0 eski eksik. Release validator: 55 kayıt
(7 yeni TR/EN grup, gerçek son durum PNG). Version değişmedi; version:assert bu
ara grupta gerekmiyor. Tam `npm test` özellikle çalıştırılmadı.

## Performans ve kalan kapsam

Karşılaştırılabilir BLPerf sonucu `performance.json` ve `performance-comparison.json`
dosyalarındadır. Aynı 220 kaynak/191 CP seed'iyle temiz izole sunucu, 5 yeni browser
context ve aynı Chromium/Node kullanıldı. `performance-noncomparable.json`, görsel
fixture'ın kaydettiği 12 Koleksiyon/1 quotation sonrası ölçümdür; başlangıç
karşılaştırmasına alınmadı. Gizli modüller ve normal 5000 kayıt/50 DOM sayfalaması
ayrıca kaydedilir. CSS konsolidasyonundan sonra final performans kontrolü gerekir.

Kalan uzun kuyruk: lisans atlası bağımsız HTML/çıktı yüzeyi, ticari import/e-posta
alt pencereleri ve envanterdeki nadir durumlar Faz 2.4'te doğrulanacaktır. Geçici
bridge ve design-butunluk henüz kaldırılmadı. Faz 2.3 operasyon/ayarlar ve Faz 3
temizliği ile proje sonu tam doğrulama hâlâ gereklidir; tüm proje bitmiş değildir.

CI çalışmadı; yerel sonuçlar CI olarak raporlanmaz. main hedefli PR otomatik
Actions tetiklediği için PR açılmadı, workflow bypass edilmedi. Merge yapılmadı.
TEST yayınlanmadı. STABLE yayınlanmadı.

Temiz BLPerf: açılış **931.9 ms**, CP ilk geçiş **1063.9 ms**, 5000 kayıt **3022.8 ms**.
Başlangıca göre sırasıyla −8.6%, +9.1% (+88.5 ms), +0.9% (+26.9 ms). CP geçişindeki artış
Faz 3 konsolidasyonunda yeniden değerlendirilecektir; bütün ölçüler iyileşti denmemektedir.
