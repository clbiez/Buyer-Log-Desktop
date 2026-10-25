# Manifest — Faz 2.1 / Planla & Yürüt

Yerel branch: `ui-rebuild/phase-2-plan-execute`. Taban: Faz 1 `2324ba7c`.
Kullanıcının “Devam” mesajıyla pilot onayı alındı; modül göçüne geçildi.

## Değişiklik ve sınırlar

Siparişler, Backlog ve Nakliye ana yüzeyleri; CP alanlar/kurallar/kontrol listesi,
ortak ayrıntı çekmecesi, pivot ve navlun pencereleri Manifest bileşenlerini kullanır.
Yedi modül CSS'i yerleşim ve veri geometrisine indirildi. Bu modüllerin app.css,
design.css ve experience.css içindeki görünüm kuralları da ortak kaynağa taşındı.
1156 kuraldaki 2855 görünüm deklarasyonu incelenebilir göç aracıyla ayrıldı;
Faz 3'te ortak kaynak içindeki yinelenen adaptörler konsolide edilecektir.

Ana grup başlıklarında kullanıcı tarafından onaylanan ince 1 px ayraçlar iki
başlık satırını kapsar. Gövde ve toplam satırlarının dikey çizgileri kaldırıldı.
Kontroller kare; tamamlanma oranları doğrusal; çizgi/radar veri işaretçileri kare.
Grafiğin veri alanı kırpması korunur; dekoratif kenar gradyanı kaldırılır.

CP kuralları, pivot ve ortak ayrıntıda Tab/Shift+Tab odağı içeride tutar.
Escape mevcut kapatma/doğrulama yolunu kullanır. İç değer menüsü Escape'i önce
karşılar; yeni kural ve formül doğrulaması atlanmaz. Kaydetme/hesap/izin/LCW AI
motoru değiştirilmedi. Genel `.warnOverlay` sahipliği ortak kontrolleri kapsar;
geri kalan modül içi gövdeler kendi göç gruplarında ele alınacaktır.

## Export ve renk koruması

Nakliye özel Excel şablonu ve kopyaları zaten sabit paletteydi. Genel araç çubuğu
aktarımı canlı CSS'ten metin rengi ve satır yüksekliği okuyordu. Yalnız `#shipTable`
için eski üç tema rengi ve dört ölçek satır yüksekliği ayrı export adaptörüne alındı.
Ekrandaki Nakliye başlıkları ortak nötr başlık dilini kullanır; şablon Excel'in
sarı/kırmızı/mavi hücreleri aynen korunur. Basılı A4 çıktısının `@media print`
palet ve punto kuralları göç aracının dar kapsamlı istisnasıdır. Backlog native
Excel grafiklerinin dairesel marker'ı yalnız çıktı tarafında korunur.

[Doğrulandı] temiz oturumlarda aynı seed=7 / 220 kaynak / 191 CP veriyle 18
HTML/TSV dosyası byte düzeyinde; 9 XLSX'in bütün `xl/*` parçaları birebir aynı.
ZIP metadata zamanları karşılaştırmaya dahil değildir. Uzun yaşayan deneme
oturumunda farklılaşan kontrol listesi sütunları nedeniyle referans yakalama
aracı iki kod sürümünde de temiz, eş koşullu tarayıcı context'i kullanacak
şekilde düzeltildi; çıktı farkları normalize edilerek gizlenmedi.
Üç temada CP'nin 72'şer canlı başlık rengi Faz 0 referansıyla aynı.

## Hedefli doğrulama

[Kontrol kayıtları](ui-rebuild/phase-2-plan-execute/checks.json) ·
[Export karşılaştırması](ui-rebuild/phase-2-plan-execute/export-comparison.json) ·
[BLPerf karşılaştırması](ui-rebuild/phase-2-plan-execute/performance-comparison.json).

- Ana ekranlarda 3 tema; Orders üzerinde dört boyut ve 1280×720 XL temsilî kontrol.
- Ana ekran/filtre/alanlar için 12 PNG; ilave pencere/ölçek durumları için 11 PNG;
  son klavye ve grafik kontrolü için 3 PNG. Birebir tekrarlar yeniden kapsanmadı.
- Son değişen sözleşme testleri 155/155; son drawer/keyboard 29/29, chart 33/33,
  component 8/8 ve Manifest guard 8/8. İlk kaynak testlerindeki eski görünüm
  beklentileri gerçek yeni konuma ve daha dar geometri kurallarına taşındı;
  işlevsel assertions korunur. İlk 558 testlik hedefli tarama ve takip kayıtları JSON'dadır.
- i18n: yeni eksik 0; release validator 48 kayıt (5 yeni), gerçek PNG'ler incelendi.
- design-color baseline büyütülmedi; `detail-drawer.css` eski 1 renk kaydı kaldırıldı.
- Son örneklemlerde görünür metin kontrastı <4.5, yasak radius/çizgi veya sayfa
  taşması bulunmadı. Örnekleyici opacity/örtüşme hesabı yapmaz; tüm uygulama
  erişilebilirlik matrisi yerine geçmez. Final kapsamlı tarama Faz 3 sonundadır.

BLPerf (5 temiz context, sıcak sunucu, aynı Chromium/Node ve veri): açılış
901.9 ms; CP geçişi 1067.2 ms; 5000 kayıt çizimi 3044.0 ms. İlk başlangıca göre
sırasıyla −11.6%, +9.4% (+91.8 ms), +1.6% (+48.1 ms). CP geçişi Faz 1'e göre
49.4 ms arttı; bu küçük artış Faz 3 stil konsolidasyonu sonrası yeniden ölçülecek.
5000 kayıtta DOM 50 satır; açılışta gizli modüller yüklenmedi ve gizli tablolar boş.
Bu ölçüm Windows/Electron veya soğuk disk performansı kanıtı değildir.

Tam `npm test` çalıştırılmadı; kullanıcı kararı gereği tüm uygulama ve Faz 3
bittikten sonra çalıştırılacaktır. Sürüm değişmediğinden `version:assert` tekrarlanmadı.

## Kalan iş ve yayın durumu

Faz 2.2–2.4 ve Faz 3 devam eder. CP'nin PLM/ek/formül pencereleri, Backlog sunum
ve dışa aktarım alt durumları ile envanterde kalan ortak popover'lar Faz 2.4'te
tek tek kapanacaktır. Legacy alias köprüsü ve design-butunluk.css henüz kaldırılmadı.
Tüm uygulama 3×4×2 matrisi ve kapsamlı test yapılmadan proje tamamlanmış sayılmaz.

PR: [yerel taslak](ui-rebuild-phase-2-plan-execute-pr.md); açılmadı / push yok.
CI: çalışmadı. Merge: yapılmadı. TEST: yayınlanmadı. STABLE: yayınlanmadı.
