# Rapor ve tablo görünümü performans kabulü

**L2 — PASS.** Ortak kaynak `ea201142`, Debian 13 x86_64, Chromium 151 ve Node 22.23.3. Aynı izole Buyer Log sunucusu ve aynı 4 ile 300 satırlık sentetik CP verisi kullanıldı. Her boyutta üç dönüşümlü çift koşuldu. Her koşuda 12 yenileme ve 30 yatay kaydırma örneği alındı. Ölçülen kaynaklar `assets.sha256` dosyasında kayıtlıdır.

| Senaryo | Başlangıç | Aday |
| --- | ---: | ---: |
| 4 satır, sıcak rapor yenileme medyanı | 3,1 ms | 2,9 ms |
| 300 satır, sıcak rapor yenileme medyanı | 12,6 ms | 12,0 ms |
| 300 satır, eşzamanlı kaydırma ve konum okuma | 0,0067 ms | 0,0500 ms |

300 satırda sabit seçim sütununun ek maliyeti 0,0433 ms/örnek. Bütçe 0,1 ms/örnekti. Seçim ve görsel boyutu işlemleri için 200 ms sınırıyla ölçülen bir sonraki çizim fırsatı sırasıyla en çok 28,5 ve 27,2 ms sürdü. Bu ölçümler Chromium’da betik, yerleşim ve sonraki animasyon karesiyle sınırlıdır. Windows/Electron çizimi için ayrı ölçüm gerekir.

Rapor satırları seçim sırasında yerinde kalır. Görsel boyutu değişirken yalnız tablo geometrisi güncellenir. İki işlem mevcut istemci tarafı seçim ve boyutlandırma yollarından geçer. [Yenileme ve kaydırma](performance.json) · [Seçim](selection-feedback.json) · [Görsel boyutu](image-results.json)

`resources/app` içinden, Playwright ve Chromium bulunan bir ortamda aynı ölçümler şu komutlarla tekrarlanabilir.

```sh
for mode in PERF SELECTION IMAGES; do
  run_dir=$(mktemp -d)
  flock /tmp/buyerlog-performance-measurement.lock env \
    REPORT_ACCEPTANCE_ROOT="$run_dir" REPORT_CAPTURE_DIR="$run_dir/captures" \
    "REPORT_${mode}_ONLY=1" node scripts/report-layout-ui-acceptance.js
done
```
