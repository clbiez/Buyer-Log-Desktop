# Ölçüm kanıtları

Bu dizin uygulamanın çalışma paketine eklenmez. Ana rapor: [2026-11-07-startup-feature-assets.md](../2026-11-07-startup-feature-assets.md).

- `measurements.json`: üç dönüşümlü önce/sonra tam açılış çifti, her modülün ilk açılması ve üç ek kaynak sayım çifti. İlk denemenin 250 kayıtla kesilen kaynak listeleri dahil değildir.
- `cold-overview.csv`: tamponu büyütülmüş soğuk Overview ölçümlerinin kısa tablosu.
- `inventory.json`: eager script ve stylesheet dosya envanteri, sıkıştırılmamış yerel dosya boyutları.
- `validation.json` ve `*-summary.txt`: test sonucu; ana dalda da tekrarlanan IAM hatası dahil.
- `visual-*.png`: 15 gerçek ekranın her dil/tema durumundaki contact sheet'i. LFL veri ekranına Devam ile geçildi. Release note PNG'si ayrıca `resources/app/public/release-notes/next-assets/` altındaki ham Playwright kaydıdır.

Geçici alanda kullanılan yardımcıların denetlenebilir kaynak kopyaları:

- `navigation-probe.cjs` → `/tmp/buyerlog-playwright-probe.cjs`: tam komutta DCL gözlemi; varsayılan Resource Timing tamponundan gelen kaynak listeleri kullanılmadı.
- `resource-probe.cjs` → `/tmp/buyerlog-playwright-complete-probe.cjs`: navigasyondan önce 20.000 kayıt tamponu, taşma sayacı, JS/CSS kayıtları; pencere bittikten sonra F1 ve gerçek ilk Koleksiyon grubu açılışı.
- `module-probe.cjs` → `/tmp/buyerlog-module-probe.cjs`: gerçek UI işlemleri, ilk açılışlar, dil/tema görselleri ve geciktirilmiş CSS kontrolü.
- `grid-validation.cjs` → `/tmp/buyerlog-grid-validation.cjs`: ilk yüklenmiş spreadsheet'te gerçek Escape/ArrowRight davranışı.
- `full-series.py` ve `resource-series.py`: özgün benchmark komutunu çağıran sıralı orkestrasyon. Uygulama ve benchmark kaynakları değiştirilmez. Yerel depo, Playwright ve fixture dizinleri bu oturuma aittir; başka ortamda yollar uyarlanmalıdır. Aynı fixture kökünü yeniden kullanmamak için tam seri mevcut dizin üzerine yazmayı reddeder.

`npm test` üçüncü batch'te IAM assertion'ı nedeniyle durdu. Kalan batch 4–10, kaynak runner'ın yalnız kök/başlangıç indeksi/rapor etiketi değiştirilmiş geçici kopyasıyla yürütüldü; assertion, concurrency ve başarısız çıkış korunmuştur. Tam paket yeşil olarak raporlanmaz.
