# Backlog boş sonuç ve tarih paneli kabulü

**Karar: PASS — P2.** Veri hesaplama, sunucu, native köprü veya paylaşılan yazma sınırı değişmez. Özel/Regular kapsamı boşken, yüklemede ve hatada kapsam seçimi erişilebilir kalır. Analiz filtreleri açıkça düzenlenebilir/temizlenebilir. Tarih paneli daraltılır ve taşınır; taslaklar korunur, açık/kapalı durum ve konum kullanıcı ayarına kaydedilir.

## Kaynak ve yöntem

- Ölçülen Main: `fad8578308c527274ab762b9ed8f371e8e033d99`.
- Son ölçülen uygulama kaynağı: `e1388b3d04063a839cef0231c97f24c6a465d20f`. Backlog uygulama dosyaları bu ölçümden sonra değişmez; sonraki Main entegrasyonu aşağıda ayrılır.
- Son entegrasyon Main: `ffd8b297b85d11d58101930c2f68eb16a4e80e74` (#954). Bu entegrasyon yalnız Koleksiyon Artwork/BOM yolunu değiştirir; Backlog JS/CSS/HTML dosyaları ölçülen kaynakla aynıdır. `app-main.js` farkı yalnız `kolSpreadsheetMakeEditor` içindedir; bu senaryoda Koleksiyon ve BOM etkinleştirilmez. İlgili entegrasyon testleri ayrıca çalıştırılır.
- Linux, Chromium `154.0.8037.57`, aynı makine/runtime, izole demo hesap ve kaynak klasörü. Gerçek iş verisi yoktur.
- Normal veri: üretilmiş 220 sipariş / 273 operasyon satırı. Büyük UI verisi: aynı rapor şemasında 30.000 sentetik rapor satırı, mevcut JSON rapor uç noktasına tarayıcı route fixture'ı üzerinden verilir. Her serinin JSON hash'i ham sonuçta bulunur; her çift aynı veriyi kullanır.
- Her veri için 3 dönüşümlü Main/aday çifti; her tarafta 5 × 4 etkileşim. Yalnız en hızlı koşu seçilmez. p95 iddiası yoktur.
- Main'de yeni tarih kontrolleri bulunmadığından sıfır iş yapan bir pencere referans değildir: mevcut Overview aç/kapat ve Plan & Actual taşıma akışları aynı Backlog belgesindeki ortak Motion+ / yerleşim referansıdır. Adayda tarih aç/kapat ve yukarı/aşağı taşıma ölçülür. Yeni iş için bağımsız bütçe değişmez: ilk görünür yanıt ≤200 ms, ek Backlog isteği 0, yeni poller/iş kuyruğu 0, beş döngüde DOM/dinleyici birikimi 0.
- Odak gerçek düğme etkinleştirmesindeki gibi click öncesinde verilir. Görünür geometri okunur. Overview senaryosunun zaman ekseni rAF işleri önce tamamlanır. Uzun görev penceresi **zorunlu son-GC'den önce** biter; testin GC'si kullanıcı gecikmesine yazılmaz. Bu düzeltmeler bütçe yükseltmez.

## Son ölçüm

Süreler ms. Başlangıç ve ilk kullanılabilir Overview üç koşunun medyanıdır. Etkileşim sütunu 60 gözlemin medyanı / maksimumudur. Uzun görev sütunu sayısı / maksimum ms'dir; bütün ham örnekler korunur.

| Satır/veri | Sürüm | Başlangıç | İlk kullanılabilir Overview | Etkileşim medyan / maks. | >50 ms görev sayı / maks. |
| --- | --- | ---: | ---: | ---: | ---: |
| 220 | Main referansı | 3472.2 | 433.9 | 12.1 / 113.9 | 17 / 120 |
| 220 | Aday | 3567.1 | 315.9 | 12.6 / 125.8 | 1 / 127 |
| 30000 | Main referansı | 10400.6 | 7686.7 | 13.3 / 431.8 | 16 / 440 |
| 30000 | Aday | 8633.7 | 5530.9 | 15.1 / 36.3 | 0 / 0 |

- Yeni tarih etkileşimlerinin **120/120** örneği ≤200 ms'dir; en yüksek değer 125,8 ms.
- Adayın her koşusunda ek Backlog isteği **0**; beş döngü öncesi/sonrası belge, DOM düğümü ve JS dinleyici sayıları **birebir aynı**.
- Başlangıçta 220 satırlı serinin medyan farkı 95 ms'dir. Tekrarlanabilir artış yoktur; daha önce alınan A/A Main kontrollerinde aynı kaynağın başlangıç medyanları 3669/3290 ms, ilk kullanım 355/327 ms olmuştur. Büyük veri A/A kapsam değiştirme örnekleri 379–2102 ms aralığındadır. Genel bir yüzde toleransı uygulanmamıştır; sonuçlar bu ortamın gürültüsü ve ilgili kaynak yollarıyla değerlendirilir.
- Mevcut ortak belge yerleşiminde >50 ms görevler vardır. Bunlar gizlenmez: Main referansında 17/16, adayda 1/0 görev. Adayın normal verideki tek 127 ms ortak yerleşim örneği ham sonuçta tutulur. Yeni sürekli iş veya tekrarlanabilir büyüme görülmez; bu rapor bütün uygulama için “hiç uzun görev yok” iddiası değildir.
- GC sonrası heap farkı adayda yaklaşık 526–542 KB, Main referansında 566–598 KB'dir. Bunlar retained snapshot ölçümleridir, tepe RSS değildir; CDP CPU/heap teşhis alanları test GC'sini de içerir ve etkileşim bütçesi yerine kullanılmaz.
- Her çiftte Overview sipariş/adet/aşama toplam metinleri birebir aynıdır. Yeni aç/kapat/taşıma işlemleri tarih filtresini uygulamaz veya veri isteği başlatmaz. Mevcut kapsam değiştirme performansının ayrı kayıtları `browser-results.json` içindedir; son odak düzeltmesi bu Overview dosyasını değiştirmez.

## İşlev ve regresyon

- Kaydedilmiş boş Special kapsamından reload sonrası All'a dönüş.
- Boş, yükleniyor, hata ve henüz yüklenmemiş durumlarda kapsam ve analiz filtresi kontrolleri; kapsam dönüşü mevcut satırları yeniden filtreler.
- Tarih taslağı aç/kapat ve taşımada korunur; kapalı başlıkta yalnız uygulanmış aralık vardır.
- Tüm panel konumları, içerik gizlenince tarih panelinin erişilebilir üst konuma dönmesi, yeniden açılışta konum ve açık/kapalı tercihi.
- TR/EN × light/dark × compact/standard/large/xl; klavye Enter; normal ve reduced motion.
- Native `moveBefore` ile odak korunur; API bulunmayan tarayıcı için `insertBefore` + odak geri verme yolu ayrıca aynı gerçek uygulama senaryosuyla doğrulanır.
- Son entegrasyonda **79 test dosyası / 515 kontrol PASS**; sürüm notu doğrulayıcısı 16 kaydı kabul eder. Test sonuçları `final-tests.log.gz`, `release-validation.log.gz`, `red.log.gz`; tarayıcı işlev kanıtları `functional-results.json` ve `functional-fallback-results.json` içindedir. RED kontrolünde eski kaynakta dört kurtarma testi başarısız, mevcut yeniden filtreleme testi başarılıdır.
- Her görünür değişiklik için TR/EN sürüm notu ve gerçek, değişiklik sonrası demo PNG vardır; önceki Main kayıtları korunur.

## Tanılama kayıtları ve sınırlar

Önceki ölçümler silinmemiştir. `initial-*`, `pre-*`, `before-focus-*`, `unfocused-click-*` dosyaları kabul serisine katılmaz: eski kaynaklar, rAF/GC penceresi ve programatik click odak farkları bu kayıtlarda açıkça ayrılır. Profilde tekrar odak verme maliyeti görüldükten sonra bağlı DOM taşıma ve odak korunması uygulanmıştır. Bu kaynak değişikliğinden sonra ilgili tarih akışı yeniden ölçülmüştür.

30 bin siparişin **tam sunucu modeli importu**, demo sunucusunun bağlantıyı kapatmasıyla tamamlanamamıştır (`initial-import-failure.log.gz`). Bunun kök nedeni bu frontend PR'ında teşhis edilmiş veya düzeltilmiş sayılmaz. Büyük UI kabulü 30 bin rapor satırını kapsar; sunucu importu için PASS iddiası yoktur. Sunucu/import kodu değişmez. Windows/Excel/SMB ve native Electron köprü performansı ölçülmemiştir; bu PR bu sınırları değiştirmez. TEST/STABLE yayını tetiklenmez.

## Yeniden çalıştırma

Repository kökünden, aynı makinede ağır ölçüm/testleri lock ile sıraya alarak:

```sh
NODE_PATH=/workspace/.buyerlog-tools/node_modules flock /tmp/buyerlog-performance-measurement.lock node docs/performance/backlog-recovery-date-panel/browser.cjs --date-only
NODE_PATH=/workspace/.buyerlog-tools/node_modules flock /tmp/buyerlog-performance-measurement.lock node docs/performance/backlog-recovery-date-panel/browser.cjs --functional
NODE_PATH=/workspace/.buyerlog-tools/node_modules flock /tmp/buyerlog-performance-measurement.lock node docs/performance/backlog-recovery-date-panel/browser.cjs --functional --fallback
```

Tam Overview karşılaştırması için flag'siz çağrı; aynı Main kaynaklarını karşılaştırmak için `--control` ve büyük rapor için `--control --large` kullanılabilir. Probe yalnız izole demo klasörüne yazar.
