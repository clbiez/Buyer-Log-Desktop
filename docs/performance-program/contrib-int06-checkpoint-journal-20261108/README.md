# INT-06 — bağımsız checkpoint journal teslimi

TR: Üretime bağlanmamış yardımcı/prototip. INT-06 kapanışı veya üretim kazanımı
kabulü değildir. Bağımsız incelemeyi root koordine eder.

EN: Standalone helper/prototype, not integrated into production. This delivery
does not close INT-06 or accept a production performance gain. Root coordinates
independent review.

- Başlangıç: `1796193f0a57c7785e7bf9fdb3557e33c550b25e`.
- Dal: `contrib/int06-checkpoint-journal-20261108`.
- Uygulama/ölçüm kaynağı: `4130caeaecf5115583f46ed8d375cdc73390b9ee`.
- #890 hazırlığı: `65074a21d7ae8fcadd6dc1628550b3ae4ed8eacf` kaynağındaki
  dokuz dosya byte-identical olarak yeni fixture dizinine devralındı. V1 fixture
  SHA-256 `8cb6fc65977e761d6ba75c3f7958dfa22d59ef8bab2fe16690e5c1b58a2c4840`.
  [Dosya provenansı](../../../resources/app/tests/fixtures/int06-checkpoint-journal/provenance.json).

## Değişiklik / implementation

`power-bi-checkpoint-journal.js` artımlı terminal sayaçları, batch deltasını
append eden checksum'lu journal, varsayılan her 64 committe atomik snapshot,
compaction, replay denetimi ve açık v1 export sağlar. Sıcak yolda tüm rows/state
grafiği kopyalanmaz. Periodic snapshot tam kopyadır ve maliyeti ölçüme dahildir.

Dosya fsync + gerekli directory fsync başarılı olmadan durable ACK verilmez.
Persistence hatasında instance kapanır ve yeniden açılması gerekir; yazılmış
ama ACK almamış kayıt diskten geri gelebilir. Newline'sız tail truncate edilir;
tam bozuk kayıt, checksum/format/refresh uyuşmazlığı ve sequence gap atlanmaz.
Yeni v2 bozukken stale v1'e otomatik fallback yoktur.

Root'un uygulayacağı API, sahiplik, persistence hatası/transport retry ayrımı,
progress/final materialization ve rollback sırası:
[adapter-contract.md](adapter-contract.md).

Üretim connector/server/compute/app-main dosyaları değişmedi. Uygulama yeni
yardımcıyı require etmez; yalnız yeni testler bunu kullanır. Worker/DB, gerçek
Power BI bağlantısı veya credential eklenmedi.

## Doğrulama / validation

- RED: [red.tap](red.tap), yardımcı yokken `MODULE_NOT_FOUND` ve 1 failure.
- Son native paket: [native.tap](native.tap), **101/101 PASS**, fail/skip/cancel=0.
  İçindeki değişmemiş #890 alt süreç paketi ayrıca **17/17 PASS**; toplam 118
  assertion-bearing test. Mevcut 83 Power BI ve 4 durable-async-prior-intent
  testi, 14 yeni üst seviye test ve 17 devralınan test içerir.
- [i18n.log](i18n.log): **0 yeni / 0 baseline eksik**.
- [validate.sh](validate.sh) tam komutu korur. Her test ve ölçüm
  `flock -n -E 75 /tmp/buyerlog-performance-measurement.lock` altında çalıştı.
  Kilit kaldırılmadı; farklı test/ölçüm kampanyaları paralel koşturulmadı.
- SIGKILL: normal 3 ve split/retry 7 ACK sınırının her biri; aynı refresh'te art
  arda crash; append, snapshot write/fsync/rename/dir-fsync ve retirement'ın
  aynı aşamalarında **11 ayrı iç sınır**. Yeni yardımcı için toplam 31 gerçek
  SIGKILL; değişmemiş hazırlıkta ayrıca 20. Her devam final bağımsız oracle'ı
  (SUCCESS/NOT_FOUND/FAILED, satır sırası/çokluğu/null) sağlar.
- Test adapter'ı her checkpoint'te **bütün kalıcı manifest alanlarını** mevcut
  connector'ın checkpoint nesnesiyle deep-equal karşılaştırır. Cancellation
  before query, split arası, query içi ve retry beklerken; frozen v1 devamı ve
  eski native store ile geri okunan atomik v1 export da doğrulandı.
- Intermediate sandbox kayıtları korunur: `green-unit.tap` yalnız dosya seviyesi
  raporladığı için yeterli kanıt sayılmaz; `green-initial.tap.gz` wrapper başarısızlığı
  içerir. Node spawnSync sandbox içinde `EPERM` ile stdout'u kaybetti. Aynı testler
  sandbox dışında, aynı ortak kilitle `green-unsandboxed.tap`, `green-expanded.tap`
  ve nihai `native.tap` içinde gerçek test sayılarıyla doğrulandı. Assertion veya
  timeout değişmedi; başarısız kayıtlar silinmedi.

## Ölçüm / measurement

Bu bir **izole checkpoint trace replay** ölçümüdür. İki kol aynı devralınan
fixture/mock transport izini tüketir; üç dönüşümlü çift sırası eski/yeni,
yeni/eski, eski/yeni. Her örnek taze Node süreci ve gerçek yerel dosya yazımı
kullanır. Aynı-kampanya fixture/trace/output hash'leri birebirdir. Ham JSON/log
ve medyan/min/max özetleri korunur.

Eski kol gerçek `createDashboardCheckpointStore` ile tam snapshot kopyası ve
yazımı yapar. Input sayaçları ve compatibility set'leri zamanlama dışında
artımlı hazırlanır; bugünkü production full state rescan/normalization maliyeti
bu sonuçlara dahil değildir. Yeni kol init, sayaç/delta commit, periyodik ve
son explicit compaction maliyetini içerir. Eski store fsync yapmaz; iki kolun
dayanıklılık garantileri eşit değildir. Baytlar değişmemiş #890 observer'ının
mantıksal payload sayımıdır; fiziksel I/O veya metadata baytı değildir. Peak
RSS load/oracle öncesi süreç ömrünün OS high-water değeridir, trace üretimi
dahildir. GC zorlanmadı, cold-cache iddiası yoktur.

Bu VM'de örneklerin `/tmp` kökü **tmpfs** üzerindedir; fsync syscall sırası ve
process-crash recovery sınanır, kalıcı donanım flush gecikmesi/enerji kesintisi
dayanıklılığı ölçülmez. [environment.json](environment.json) filesystem bilgisini
korur. Bu sayıları SSD veya ağ diski performansı olarak kullanma.

**Toplam refresh süresi ölçülmedi ve checkpoint'e atfedilmedi.** Değişmemiş
hazırlığın bütün connector'ı çalıştıran 30k/100k before/after kampanyası bu
teslimde **çalıştırılmadı**. Yerine geçen bir üretim kabulü iddiası yoktur.

30k ve 100k **steady** için checkpoint-only üçer çift
`measurements/` dizinindedir. 3k steady ve split/retry pilotlarında üçer çift
`pilot/` dizinindedir. Pilot sabit yardımcı SHA'sını kaydeder fakat source
committen önce çalıştığı için revision alanı başlangıç bazıdır; büyük steady
serileri sabitlenmiş uygulama commit'ini kaydeder.

30k/100k **split/retry üçer çift çalıştırılmadı**. 3k pilotu 1.194 terminal batch
ve eski kolda örnek başına 487.831.642 payload baytı üretti. Daha büyük split
eski-store kampanyasının yazma maliyeti nedeniyle bu VM oturumunda genişletilmedi.
Bu bir başarısız örnek veya ölçülmüş büyük split sonucu olarak sunulmaz.

Sayısal sonuçlar ve çalıştırılmayan matris hücreleri [results.md](results.md)
dosyasında; ham kanıtların hash'leri `evidence-manifest.json` dosyasındadır.

## Açık sınırlar / remaining gates

Tam filtresiz `npm test`, Windows/Electron/SMB, gerçek power-loss, gerçek Power BI
ve üretim entegrasyon ölçümü **çalıştırılmadı**. File/directory fsync'i desteklemeyen
bir dosya sistemi ACK alamaz. Tek writer ve rollback sırasında writer'ın
durdurulması adapter'ın sorumluluğundadır; helper genel lease mekanizması kurmaz.

PR açılmadı. Merge/rebase/force-push yapılmadı. TEST yayımlanmadı. STABLE
yayımlanmadı. Bağımsız review yapılmış sayılmadı; root inceleme ve adapter
entegrasyonunu ayrıca koordine edecek. INT-06 açık.
