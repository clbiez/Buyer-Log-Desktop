# Yerel PR taslağı — açılmadı

**Başlık:** Manifest: ortak sistemi tamamla, eski stil katmanlarını kaldır

**Head:** `ui-rebuild/phase-3-consolidation`
**Taban:** `ui-rebuild/phase-2-remaining` / `05951638` (merge edilmedi).

Arayüzün bütün görünüm kuralları ortak token/bileşen kaynağına taşınır;
`design-butunluk.css`, geçici uyumluluk katmanı ve kullanılmayan tema efektleri
kaldırılır. Üç tema, dört boyut ve eski tablo başlık renkleri korunur. Ana sütun
grupları iki başlık satırında ince çizgiyle ayrılır. Dialog klavyesi, dar menü,
yoğun alan yerleşimi ve hata/onay/sürükleme durumları ortak sözleşmeye bağlanır.

LCW belge paleti ekrandan ayrılır. Export renkleri ve paketli belge fontları
korunur; veri, hesaplama, filtre/sıralama, kanonik ID ve LCW AI yolu değişmez.

## Gerçek görüntüler

[Çevrimdışı HTML galerisi](ui-rebuild/manifest-final.html) ·
[CP / gri](ui-rebuild/phase-3/matrix/main/cp-grey-standard-1440.png) ·
[Dar menü / XL](ui-rebuild/phase-3/matrix/rail-final/rail-collapsed-grey-xl-1280.png) ·
[Kural hatası](ui-rebuild/phase-3/matrix/state-final/cp-rule-invalid-light-standard-1440.png) ·
[Onaylı fiyat](ui-rebuild/phase-3/matrix/state-final/price-history-approved-grey-xl-1280.png) ·
[Earth](ui-rebuild/phase-3/matrix/earth-marker-revision/earth-offline-dark-standard-1440.png).

## Doğrulama ve risk

[Kapanış raporu](ui-rebuild-phase-3-consolidation.md),
[matris](ui-rebuild/phase-3/matrix-summary.json),
[test sözleşmesi gerekçeleri](ui-rebuild/phase-3/test-contract-migration.md),
[export](ui-rebuild/phase-3/export-equivalence.json) ve
[son nakliye karşılaştırması](ui-rebuild/phase-3/export-shipping-final-comparison.json).

Ara PR'larda tam test çalıştırılmadı; kullanıcı kararı gereği tam paket yalnız
bu proje sonu kod durumunda çalıştırıldı. Son `npm test`: 1.060 dosya, 7.529 geçen,
0 başarısız, 65 mevcut platform/isteğe bağlı atlama. i18n, release notes, version
ve tasarım guard'ları başarılı. 3.936 güncel görsel durum; 46/46 genel ve 18/18
son nakliye export eşleşmesi. 75 PNG'li offline galeri doğrulandı.
Yerel sonuçlar CI değildir. Açılış medyanı %7,3 azaldı; 5.000 satır medyanı
%5,3 arttı (50 DOM satırı/lazy davranış korundu). Ayrıntılar kapanış raporunda.

P2: geniş görünüm kapsamı ve yerel klavye yönetimi. Windows/Electron işletim
sistemi pencereleri ve harici PLM/LCW AI erişimi bu Linux çevrimdışı görsel
koşunun dışındadır. Eski veri/yetki testleri korunur. Performans medyanları ve
ölçüm sınırları ayrı raporlanır; sürelerin birebir eşitliği iddia edilmez.

PR/push yok: `main` hedefli PR, onaylanmamış Actions tetikler. Güvenlik kurallarını
atlatmak için workflow veya hedef dal değiştirilmedi. CI: çalışmadı.
Merge: yapılmadı. TEST: yayınlanmadı. STABLE: yayınlanmadı.

Son kullanıcı incelemesinde bulunan logo/trivia gizlenmesi düzeltildi;
[güncel gerçek PNG galerisi ve son test kaydı](ui-rebuild/logo-trivia-fix/README.md).
Yeni son tam koşu: 7.529 geçen / 0 başarısız / 65 mevcut atlama; release notes 78.
