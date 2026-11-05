# Faz 0 — ölçüm altyapısı (P3)

Durum: **uygulama hazır, 30k kabulü blokeli; merge edilmedi.** Bu belge 05.11.2026 programının tamamlandığı anlamına gelmez. Faz 2–7 başlatılmadı.

## Değişti

- Üç olay ayrı ölçülür: `bl:primary-screen-ready`, `bl:startup-ready`, `bl:startup-complete`. Continue öncesindeki bekleme ayrıca çıkarılır.
- Modüller tek tek açılıp `finally` içinde kapatılır. Aynı sekme senaryosu da sonraki ölçümden önce kapanır. RSS eski açık sayfaları toplamaz.
- Long-task penceresi navigasyondan itibaren sabit 0–10.000 ms'dir; sınırı geçen görev pencereye kırpılır. Bu pencere dışındaki açılış maliyeti olay sürelerinde ayrıca görünür.
- Fixture SHA-256, Orders satır sayısı, CP/Overview satırları, projection checksum, generation, kaynak revizyonu ve istemci Orders/Supp. FOB revizyonları doğrulanır.
- GET health/status için en fazla üç geçici-hata denemesi; login ve refresh POST'u bir kez gönderilir. Yetki hataları tekrarlanmaz.
- Başarısız koşu tam/kısmi JSON, server.log ve mevcut stall profillerini korur. Yaşam döngüsü olayları hemen kaydedilir; başarısız sayfa durumu en fazla 5 saniyelik tanılamayla alınır.
- Refresh özeti ham karşılaştırma satırları yerine sayaç içerir. İlk tanılama koşusunda raporun 27 MB olması üzerine bu ek yük RED → GREEN testle kaldırıldı.
- `--source-fixture` aynı kaynak baytlarını ayrı temiz veri köklerinde kullanır; `--app-root` aynı harness ile ayrı worktree'leri ölçer.

## Doğrulama

[Doğrulandı] `npm test -- startup-benchmark`, doğrudan yedi davranış testi ve `npm run i18n:check` geçti; baseline boş. Başlangıç RED ve özet boyutu RED kayıtları artifacts altında. Son düzenlemeden sonra 100 satırlık dört modüllü gerçek Chromium smoke koşusu geçti: Orders 100, CP 87, Overview 100, Koleksiyon 0; sayfa hatası yok. Üç olay, kaynak generation/revizyonu ve kapatılan sayfalar doğrulandı.

`npm run release:notes:validate` mevcut 15 kayıtla geçti. Faz 0 ürün davranışı veya görünür metin değiştirmediğinden pending sürüm notuna yeni kayıt eklemez. Tam regresyon bu fazda çalıştırılmadı.

## Ölçüm ve ortam

Linux, cgroup 4 vCPU / 16 GiB, Node 24.19, headless sistem Chromium. Windows/Electron ve soğuk disk ölçülmedi. Kaynak uygulama `099776c5` (güncel main); bu revizyon inceleme paketinden sonra Backlog/Motion değişiklikleri içerir. Bu nedenle eski 53 saniye ile doğrudan hızlanma/yavaşlama sonucu çıkarılmaz.

[Doğrulandı] Aynı seed=7, 30.000 sipariş fixture'ında ilk deneme:

| Alan | Tek koşu |
| --- | ---: |
| Refresh sunucu süresi | 98.311 ms |
| ASAS file-parse telemetrisi | 36.858 ms |
| Antrepo file-parse telemetrisi | 7.842 ms |
| page-cache-write | 22.361 ms |
| CP / Orders / Overview | 24.982 / 30.000 / 30.000 |
| /api/health refresh p50 / p95 | 11,18 / 545,30 ms (**başarısız HTTP çağrıları**) |

**Üç koşuluk başarılı baz çizgisi alınamadı. Medyan veya önce→sonra açılış kazancı yok.** İlk koşu Continue sonrası `startup-complete` beklerken 60 saniyelik zaman aşımıyla bitti. Seri durdu, sonraki iki koşu ve Faz 1 macro karşılaştırması başlamadı. Bu başarısız koşu yeni final harness'in başarılı baz koşusu sayılmadı.

[Doğrulandı] Güncel sunucuda `/api/health` handler'ı yok; 404 döndürüyor. Readiness mevcut `/api/status` ile yapılır. Rapor health HTTP durumlarını ve hataları saklar; bu sayılar çalışan bir health endpoint'inin p95'i değildir. Sunucu endpoint'i bu P3 fazında eklenmedi. Varsayılan runtime stall eşiği 3 saniyedir; bu rapor 200 ms altı stall kabulünü ispatlamaz.

[Bilinmiyor] İlk koşunun Continue sonrası neden tamamlanmadığı henüz trace ile kesinleştirilmedi. Sonraki, refresh'i atlayan cache kurtarma tanılamasında manifest bulunamadı; bu da başarılı veya karşılaştırılabilir koşu sayılmadı. Uygulama kapılarını gevşetmek, Motion'u kapatmak, satır sayısını azaltıp 30k başarısı gibi sunmak veya sonucu ölçmeden varsaymak uygulanmadı.

## Kanıt

- [Başarısız 30k koşu](phase-0-artifacts/baseline-attempt-1.json): ham özet yerine sayaç; orijinal tam JSON'un yolu, boyutu ve SHA'sı içeride.
- [Son kodla 100 satırlık smoke](phase-0-artifacts/smoke-100.json).
- [Cache kurtarma tanılaması](phase-0-artifacts/cache-recovery-diagnostic.json).
- [Sunucu günlüğü](phase-0-artifacts/server.txt): ilk koşu ve sonraki cache tanılaması; stall satırları korunmuştur. Aynı klasörde gerçek `.cpuprofile` bulunur.
- Orijinal ham/kısmi JSON ve sentetik veri `/tmp/buyerlog-startup-baseline-1` ile `/tmp/phase-0-baseline-1.json[.partial]` altında korunur.

## GitHub / Yayın / Karar-risk

Ayrı taslak PR; gerçek bağlantı ve CI sonucu PR açıklamasında/final teslimde verilir. Merge yok. TEST: yapılmadı. STABLE: yapılmadı.

30k açılış blokajı ve eksik health endpoint'i çözülmeden Faz 0 kabulü veya sonraki fazların macro kazancı onaylanamaz. P1 merge öncesi durma kuralı geçerlidir. Dal koruması bu çalışmada doğrulanmadı; etkin varsayılmadı.
