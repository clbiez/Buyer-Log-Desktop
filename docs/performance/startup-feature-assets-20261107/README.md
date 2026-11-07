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

İlk tam ölçüm serisinin uygulama kaynakları `d61d9434` revizyonudur. `54174143` incelemesinden sonra P2 için yalnız `manufacturers` stil listesine ortak `backlog-plan-actual.css` eklendi. Bu kapanışın RED/GREEN, dil/tema, geciktirilmiş CSS ve yalnız etkilenen ilk-açılış ölçümleri `manufacturers-*` kanıtlarındadır. Özgün benchmark ve `scripts/lib/*` bu PR'da değiştirilmedi.

P2 kapanış kanıtları:

- `manufacturers-drill-red.json` / `.png`: Backlog'a girmeden ilk drawer açılışının eksik stilini gerçek tarayıcıda doğrular.
- `manufacturers-unit-red.txt` / `manufacturers-targeted-green.txt`: aynı regression'ın eski kodda RED ve düzeltmeyle GREEN olması; ilgili 37 test.
- `manufacturers-measurements.json`: yalnız etkilenen Üreticiler ilk açılışının üç dönüşümlü çifti. Aynı backend snapshot'ı ve yeni HTTP context kullanılır; tam soğuk açılış serisiyle karıştırılmaz.
- `manufacturers-drill-probe.cjs`, `manufacturers-measure-series.py`, `manufacturers-visual-series.py`: geçici alanda kullanılan hedefli gerçek tarayıcı kontrolü ve sıralı çalıştırıcılar.
- `npm-summary.txt` ve `validation.json`: P2 sonrası son kodun yenilenmiş tam regresyon sonuçlarıdır.

- `manufacturers-browser.json`: sekiz yeni ilk açılışın assertion sonuçları; normal ve geciktirilmiş CSS matrisi.
- `manufacturers-drill-green-matrix.png` / `manufacturers-drill-delayed-matrix.png`: gerçek TR/EN açık/koyu ekran kayıtlarından normal ve bekleme/sonrası derlemeleri.
