# INT-07 — kısmi uygulama; aktif iptal / kesin deadline BLOCKED

Base Main: `511cb2fae629cd6e0c1ad31eb773775e5c95841d`.
Branch: `fix/followup-plm-bom-budget-20261109`.
Ayrı worktree: `/workspace/buyerlog-int07`.

## Sorun ve tamamlanan dar davranış

Önceki iç içe beş target / beş child scheduler'ı iş başına 25 aktif okuma
başlatabiliyordu. RED senaryosunda aynı owner'ın iki işinde 50 aktif çağrı
ölçüldü. Üst katmanda ilk tur + üç tekrar, genel client'ta çağrı başına üç
attempt ile tek mantıksal okumada 12 HTTP denemesi oluşturabiliyordu;
`retryRounds` parametresi bu sınırı daha da büyütebiliyordu.

`plm-bom-sync.js` artık yalnız BOM'a ait üç okuma ucunu
`plm-bom-int07-budget.js` üzerinden geçirir. Aynı normalize owner, eşzamanlı
BOM işleri ve target/child seviyeleri arasında toplam beş slot paylaşır.
Farklı owner'ların slotları bağımsızdır. Genel API client'ının başka
tüketicileri değişmez. Child hatasında aktif kardeşler tamamlanmadan yeni
retry turu başlamaz. Permit, gerçek client promise'i body decode dahil
sonuçlanınca bırakılır; sahte timeout ile arka planda devam eden çağrı için
slot erken bırakılmaz.

Client'a `retries: 1` verilir (bu client'ta `0` üç denemeye geri düşer).
En fazla ilk + üç üst tur ve mantıksal okuma başına dört attempt vardır;
auth recovery de bu dört tur içindedir. Bir Set Style'ın tur başına en fazla N child'ı için
üst sınır `4 × (2 + N)` client attempt'tir; bu bir bütün iş için sabit dört
istek sınırı değildir. GET association, read-only POST metadata ve read-only
POST BOM dışında mutation/report endpoint'i sarılmaz. Açık kalıcı HTTP
hataları ve BOM doğrulama hataları retry edilmez; 408/429/5xx, timeout ve ağ
hataları retry edilebilir. Hata sınıfı olmayan enjekte okuyucular için eski
retry uyumu korunur. Genel client Retry-After bilgisi taşımadığından yeni
Retry-After desteği iddia edilmez.

Her target ilk işlenmeye başladığında 240 saniyelik **yeni okuma başlatma
süresi** başlar; kuyruk, retry ve auth beklemesinden sonra da kontrol edilir.
İptal edilen kuyruk bileti yeni HTTP başlatmaz; retry beklemesi de iptali
kontrol eder. Tamamlanan sonuçların kaydı, eski başarılı BOM'un fetch hatasında
korunması, parent/child içerik ve fingerprint semantiği devam eder.

## Kapsam engeli: INT-07 bütünü tamamlanmadı

Değiştirilmesi yasaklanan `server/lib/corenectum-api-client.js`:

- Dış `AbortSignal`'ı okumaz; her istekte kendi controller'ını oluşturur.
  Dolayısıyla iş iptali aktif fetch'e ulaşmaz. Aktif okumanın kendi timeout'u
  veya normal sonucu beklenir. Yeni `options.signal` yalnız BOM tarafında
  yeni okuma başlatmayı engeller.
- Timeout timer'ını response header'ları geldiğinde temizler; `response.text()`
  daha sonra okunur. Bu nedenle body decode ve auth beklemesi dahil kesin bir
  toplam wall-clock deadline bu kapsamda garanti edilemez. Aktif okumalar
  admission deadline sonrasında da sonuçlanabilir.

`plm-bom-int07-transport.test.js` bu iki engeli gerçek client ve kontrollü
fetch/body promise'leriyle gözler. Bu testlerin PASS olması talep edilen
aktif iptalin / kesin deadline'ın PASS olması anlamına **gelmez**: mevcut
engeli ve permit'in erken bırakılmadığını doğrular. Genel client'ı kopyalayan
BOM transport'u, global fetch patch'i veya kaynak dışı client değişikliği
ürüne eklenmedi. Kabul script'indeki fetch fixture'ı yalnız sentetik test
sınırıdır. İşin bütününü READY/kapandı olarak işaretlemeyin.

## Doğrulama ve ham kanıt

- [red.log](red.log): eski kaynakta 4/4 RED; aynı owner tepe 50, ayrı owner
  başına 25, client attempt çarpanı ve kalıcı hata retry'ı.
- [green.log](green.log): 61/61 hedefli test PASS; sıfır FAIL/SKIP/CANCEL.
  Yeni bütçe ve gerçek client testleriyle mevcut BOM, Set Style, auth/retry
  ve two-phase regresyonları birlikte çalıştırıldı.
- [application-acceptance.json](application-acceptance.json): gerçek sunucu,
  gerçek `/api/plm-sync/fetch` işi, genel client, kalıcılık, BOM okuma API'si
  ve Chromium arayüzü. Yalnız ilk Style List toplama ve uzak HTTP cevapları
  sentetiktir. Aynı owner için iki eşzamanlı iş, iş başına beş Set Style,
  takım başına altı child: toplam 80 HTTP attempt; tepe **5**, sonda **0** aktif.
  Uçlar: association 10, metadata 10, BOM 60. Kalıcı parent'ta altı parça ve
  altı baskı korunur.
- [application-responses.json](application-responses.json),
  [application-batch.json](application-batch.json),
  [application.log](application.log): gerçek uygulama cevapları ve sunucu log'u.
- [acceptance.cjs](acceptance.cjs), [synthetic-preload.cjs](synthetic-preload.cjs):
  tekrar üretilebilir kabul. `flock /tmp/buyerlog-performance-measurement.lock
  node docs/performance/followup-20261109/int07/acceptance.cjs`.
  Playwright/Chromium bu ortamdan kullanılır; ürün bağımlılığı eklenmez.
- [source-manifest.json](source-manifest.json): test girdilerinin SHA-256'ları,
  ortam ve korunan dosya doğrulaması. Son teslim SHA/PR/CI, #937'deki tek
  `[INT-07]` final yorumunda sabitlenir.

Gerçek post-change PNG,
`resources/app/public/release-notes/next-assets/int07-bom-owner-read-budget-20261109.png`.
Görsel incelemede gerçek BOM penceresinin önde olduğu, altı A–F parçası ve
baskı kanıtı görüldü. Görsel, concurrency veya aktif iptal ölçümü yerine geçmez.
TR/EN yeni release-note ID: `int07-bom-owner-read-budget-20261109`.
Önceki altı kaydın metni/alanları ve üst manifest alanları byte/alan içeriği
bakımından korundu. i18n yeni eksik 0, baseline eksik 0; release-note validator
7 kayıtla PASS.

## Eleştirel diff kontrolü / sınırlar

Ürün diff'i yalnız `server/lib/plm-bom-sync.js` ve BOM'a özel yeni helper'dır.
İki yeni test yalnız INT-07 içindir. Görsel indirme kuyruğu/sync dosyaları,
genel client, `server/server.js` ve i18n baseline Base Main ile birebir aynı.
PLM ingest/auth/transport, IAM, diğer compute ve cache motorları, timeout
korumaları, sürüm ve bağımlılıklar değiştirilmedi. Paylaşılan `next.json`'a
yalnız benzersiz yeni kayıt eklendi; kanıt/doküman bu dizindedir.

Tek agent eleştirel diff kontrolü: owner izolasyonu, FIFO kuyruk temizliği,
permit'in finally ile gerçek sonuçta bırakılması, child drain, auth kuşağı,
kalıcı hata ayrımı, eski kaydın korunması, BOM output eşdeğerliği ve sahiplik
sınırları incelendi. Bağımsız ikinci model incelemesi yapılmadı. Kurumsal PLM
kabulü ve gerçek servis kapasitesi ölçülmedi; üretim hızlanması iddia edilmez.

Merge yapılmadı. TEST/STABLE ve yayın workflow'u tetiklenmedi; dal silinmedi.

## Standart tam regresyon

`npm test` → `tests/run-tests.js`, tek kesintisiz koşu, varsayılan
concurrency=4, ortak `flock` altında. **1316 dosya, 10/10 batch PASS**,
134.4 saniye; Node v24.19.0, Linux x86_64.

Toplam: tests=9097, PASS=9032, FAIL=0, SKIP=65, CANCEL=0, TODO=0.
Mevcut platform/opt-in skip'leri korunur; yeni skip eklenmedi, test/eşik
gevşetilmedi. Hedefli koşular tam koşunun yerine kullanılmadı.
[full-test.log](full-test.log) ham çıktı,
[full-test-summary.json](full-test-summary.json) toplu sayımlardır.
Testten sonra ürün/test girdilerinin SHA-256 manifesti tekrar doğrulandı;
yalnız bu kanıt metni ve test sonuç dosyaları tamamlandı.
