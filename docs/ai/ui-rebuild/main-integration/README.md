# Manifest kapanışı: kullanıcı simgesi ve güncel main ile birleşim

Kullanıcı isteği: sağ üst kullanıcı simgesini kontrol et; sonra bütün projeyi
main ile birleştir. Bu istek merge ve normal PR Actions kontrollerine onaydır;
TEST/STABLE yayını istenmedi.

Eski simge `icons/avatar-patch.png` saten plakasıydı. Yeni düz baş harf yüzeyi
bu resmi kapatıyordu. Plaka hem üst düğmede hem kullanıcı menüsünde geri geldi;
koyu baş harfler temadan bağımsız `--ui-avatar-ink` ile okunur. Kimlik, yetki,
ad/baş harf üretimi ve TR/EN davranışı değişmedi.

Birleşim kontrol tabanı: `origin/main` / `4a70aa15` (#714). Ana dalın yeni kayıt,
kanonik kimlik, fiyat kaynağı, sıklık, toplu işlem, iptal ve worker davranışları
korundu. 14 dosyadaki çatışmalar iki tarafın sözleşmesini birlikte tutarak çözüldü.
Veri kaydı, kaynak filtre bildirimi ve fiyat e-posta sonuçlarının olayları doğru
modalda kaldı; klavye temizliği mevcut kapatma/AbortController yoluna bağlandı.
Yeni ekran görünümü ortak token/bileşen sahibine taşındı; eski stil katmanı açılmadı.
Bağımlılıklar güncel main kilidiyle `npm ci --ignore-scripts` kullanılarak kuruldu.

`visual-summary.json`: avatar üst düğmesi/menüsü için 24 kombinasyon, 48 PNG;
yeni iş akışı aileleri için 6 × 24 = 144 güncel PNG; 0 geometri, ölçülen metin
kontrastı veya belge taşması bulgusu. Önceki animasyonlu 48 modal görüntüsü
geçmiş olarak saklıdır; `workflow-reduced-motion` bunların yerini alır. SVG/PNG
çizimleri ve gerçek kullanıcı bağlantıları bu görsel otomasyonun dış sınırlarıdır.
Toplu işlem önizlemesi sentetik girişle gerçek uygulama bileşenini açar; Uygula
çağrılmaz. İş kayıt/doğrulama davranışını ilgili üretim testleri sınar.

`shipping-export-comparison.json`: güncel main ile 18/18 HTML, TSV ve XLSX xl/
üyesi eşittir. Önceki fazların diğer export referansları kapanış raporunda saklıdır.
`performance/comparison.json`: beş eşli ölçümde aynı veri ve paketler; eşzamanlı
test/çekim yok. Açılış −%11,2; CP ilk geçişi +98,5 ms / +%11,3; 5.000 satır
+83,8 ms / +%2,9. Her koşuda 50 DOM satırı; gizli modüller lazy kalır. Bu farklar
saklanır; sürelerin eşitliği veya Windows/Electron performansı iddia edilmez.
Son modal hareket düzeltmesi ölçülen açılış/CP/tablo yollarını değiştirmez.

SBOM kontrolü eklenen Plex dosyalarını görünce güncellik hatası verdi. Envanter
üreticisi değiştirilmedi; Plex kendi OFL/IBM kaynak grubuna ayrıldı ve gerçek
SHA'lar yeniden üretildi. Yeni fiyat taslağı modal testi de gerçek DOM `dataset`
ve klavye API'sini taklit eder; eşleşen taslağı yeniden açma doğrulaması korundu,
klavye bağının modal/escape sahibi olduğu ayrıca sınandı. Baseline/skip listesi
büyütülmedi. Son tam test ve PR durumları `checks.json`/kapanış PR'sinde verilir.

Main branch API'si `protected:false`, required checks enforcement `off` döndürdü;
aktif koruma varsayılmadı. Buna rağmen kapanış PR'sinin normal kontrolü başarılı
olmadan merge yapılmaz. Faz commitleri korunur, konsept dalları birleştirilmez.

Son kodda tam test: **7761 geçen / 0 başarısız / 65 mevcut atlama**, 1.103 dosya, 102,5 saniye. Başarılı test sonrasında yalnız rapor/kanıt değişti; kaynak SHA kaydı checks.json içindedir. Faz 1–2.4 PR’leri #715–#719 açıldı; creation-time durumları phase-prs.json’da. Kapanış PR’sinin merge commit’i hepsinin commitlerini korur.
