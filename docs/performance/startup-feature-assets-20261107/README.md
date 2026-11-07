# Ölçüm kanıtları

Bu dizin uygulamanın çalışma paketine eklenmez. Ana rapor: [2026-11-07-startup-feature-assets.md](../2026-11-07-startup-feature-assets.md).

- `measurements.json.gz`: güncel `63159fb3` tabanına karşı üç dönüşümlü önce/sonra tam açılış çifti ve her modülün ilk açılması. Altı koşunun 30 navigasyonunda kaynak tamponu taşması sıfırdır. İlk denemenin 250 kayıtla kesilen kaynak listeleri dahil değildir.
- `cold-overview.csv`: tamponu büyütülmüş soğuk Overview ölçümlerinin kısa tablosu.
- `inventory.json`: eager script ve stylesheet dosya envanteri, sıkıştırılmamış yerel dosya boyutları.
- `validation.json` ve `npm-summary.txt`: 1290 dosyalık tam test paketinin ve tarayıcı kontrollerinin başarılı sonuçları. IAM ve v714 güncel tabanda geçti.
- `visual-*.png`: 15 gerçek ekranın her dil/tema durumundaki contact sheet'i. LFL veri ekranına Devam ile geçildi. Release note PNG'si ayrıca `resources/app/public/release-notes/next-assets/` altındaki ham Playwright kaydıdır.

Geçici alanda kullanılan yardımcıların denetlenebilir kaynak kopyaları:

- `resource-probe.cjs` → `/tmp/buyerlog-playwright-complete-probe.cjs`: navigasyondan önce 20.000 kayıt tamponu, taşma sayacı ve JS/CSS kayıtları. Tam seride `SHELL_GUIDE_PROBE=0`; benchmark akışına UI işlemi eklenmez.
- `module-probe.cjs` → `/tmp/buyerlog-current-module-probe.cjs`: gerçek UI işlemleri, ilk açılışlar, Escape/ArrowRight ve ayrı yeni HTTP context'te rehber/Koleksiyon grubu kontrolleri.
- `visual-probe.cjs` → `/tmp/buyerlog-current-visual-probe.cjs`: dil/tema görselleri ve geciktirilmiş CSS kontrolü. Performans medyanlarına bu ek görsel koşunun süreleri katılmaz.
- `full-series.py` → `/tmp/buyerlog-current-series.py`: özgün benchmark komutunu çağıran sıralı orkestrasyon. Uygulama ve benchmark kaynakları değiştirilmez. Yerel depo, Playwright ve fixture dizinleri bu oturuma aittir; başka ortamda yollar uyarlanmalıdır. Aynı fixture kökünü yeniden kullanmamak için seri mevcut dizin üzerine yazmayı reddeder.

Uygulama kaynakları `d61d9434` revizyonunda ölçüldü; bu revizyondan sonraki değişiklikler kanıt, dokümantasyon ve release-note görsel/metniyle sınırlıdır. Özgün benchmark ve `scripts/lib/*` bu PR'da değiştirilmedi.
