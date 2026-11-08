# Root / kanonik adapter sözleşmesi

Prototip üretime bağlı değildir. Üretim dosyaları salt okunur kullanıldı.
Bu sözleşme uygulanmadan INT-03 üretim kabulü verilemez.

## 1. Root bağlantıları

Sunucu ömründe tek `createRuntime`/`createByteBudget` instance'ı oluştur ve
bütün sync işlerine aynı instance'ı enjekte et. Job başına bütçe oluşturma.
`server.js` route'unda mevcut 8 indirme / 5 metadata concurrency tavanını,
yetki kontrolünü, upstream lease'i ve yenileme POST retry yasağını koru.
Mevcut boolean iptal kaynağından gerçek AbortController üret; waiter, request
ve response'a aynı sinyali geçir. Başlamış kanonik yazma kesilemez; sonuçlanır,
sonra reservation bırakılır. Bütçe iptal kodu `PLM_JOB_CANCELLED`'a eşlenir.

`node-transport.js` gerçek `https.get` için somut adapter içerir. Testlerde
`get` enjekte edilir. GET bütçe admission'ından sonra başlar, identity encoding
zorunludur, stream highWaterMark 64 KiB'dir. Header öncesi abort/error/timeout
request `close` bekler; header sonrası request **ve** response `close` bekler.
Destroy çağrısı tek başına settle sayılmaz. Varsayılan 25 s timeout, en az
1 s ayarı, mevcut retry sınıfları/4 attempt ve MIME doğrulaması korunur.
Synthetic PassThrough transport'u da gerçek writable backpressure uygular;
sonsuz producer kuyruğu veya worker kullanılmaz.

[Hipotez] TLS, native stream ve küçük scratch alanına ayrılan 1 MiB/admission
payı gerçek platformda ayrıca doğrulanmalı. Reservation RSS garantisi değildir;
keep-alive socket havuzu, metadata, heap, allocator/GC ve disk page cache bunun
dışında ayrıca ölçülür. Node adapter testi gerçek internet/TLS ölçümü değildir.

## 2. Bellek ve disk planı

GET öncesinde Content-Length bilinmez: her admission `B = 20 MiB` kullanır.
Yanıt başlığı reservation'ı küçültmez; ayrı guard her chunk tutulmadan önce ve
EOF'ta beyanı doğrular. Bilinmeyen/chunked gövde için de aynı tavan geçerlidir.
Yanlış, bozuk, eksik/fazla, sıfır uzunluk ve encoding değişimi fail-closed'dur.

```text
C = 4 * ceil(B / 3)
reservation = 2B chunks/concat
            + 0 validation (mevcut sniff/hash raster decode yapmaz)
            + 2C konservatif base64 string
            + B saveCollectionImage decode
            + 50 MiB eski collection dosyası
            + 1 MiB I/O/scratch
            = 172315992 bytes/admission
iki admission = 344631984 bytes
```

İleride raster decode eklenirse piksel/decode tavanı ayrıca bütçelenmeli.
Mevcut görsel kabul tavanları küçültülmez. Retry aynı tam envelope içinde,
önceki transport tamamen settle olduktan sonra yapılır; ikinci permit alınmaz.

Staging scope başına özel 0700 dizin/0600 dosya, UUID handle ve fsync kullanır.
İki işin ortak toplam staging kotası 512 MiB'dir. Kota dolarsa yeni staging
`INT03_STAGE_QUOTA` ile partial failure olur; iş kendi finalize'ını bekleyerek
kilitlenmez. Mevcut staged başarılar tek kanonik işlemde tamamlanabilir.
Bu kota sınırsız büyüklükte işe eşdeğerlik iddiası değildir: root disk kapasitesi,
job boyutu ve kullanıcıya hata bildirimi politikasını kararlaştırmalı.
İptal/normal sonuçta scope temizlenir. Sadece bu işin dosyaları silinir.

Crash sonrası staging cleanup/recovery ve diskte hassas veri yaşam süresi
üretim tasarımı olarak açıktır. Bu prototipte yalnız sentetik veri kullanılır.

## 3. Gerekli kanonik API genişletmesi

`ingest.commitStaged(entries, options, runtime)` aday kopyada uygulanmıştır.
entries Buffer yerine sahipli stage handle, byte sayısı ve MIME metadata'sı
 taşır. `runtime.withEntry` admission alır, tek dosyayı okur, doğrulama ve
senkron base64/decode/save bitene kadar permit tutar. Callback bütün kullanıcılar
settle olmadan dönemez; sonrasında yalnız metadata kalır.

İş boyunca aynı hash→ref tablosu, created listesi ve outcomes birikir. Sonunda
**tek** `patchLinks(links, expectedOrdersRevision)` çalışır. Çok sayıda küçük
patch yerine bu sınır korunur. Staging indirme aşamasını Buffer tutmadan
bitirebildiği için bütün indirmeleri bekleme kuralı admission deadlock'u yaratmaz.
Diğer iş indirme yaparken bütçe dolsa da mevcut kanonik tüketici permit'iyle
ilerler. Serializer kuyruğunda Buffer/permit tutulmaz.

Kanonik serializer güncel map ve ownership snapshot'ını okur. Async beklemeler
sırasında dış/manual writer revision veya yetkiyi değiştirdiyse final kontrolde
`INT03_CANONICAL_CONFLICT` oluşur; tek patch yapılmadan tüm yeni dosyalar geri
alınır. Patch aynı revision'ı CAS parametresi olarak db'ye de verir. Bu güvenli
conflict davranışı sessiz overwrite veya otomatik job retry değildir. Root tüm
ilgili writer'ların revision/authority sözleşmesini doğrulamalı; process-local
serializer başka process/device için kilit değildir.

Sadece final CAS yeterli bir genel transaction iddiası değildir: mevcut ingest'in
save→patch→ownership kalıcılığı crash-atomic değildir; bu prototip o sözleşmeyi
güçlendirdiğini iddia etmez. Ownership persistence hatası ve process kill/restart
ana sohbette P1 kapsamında ayrıca değerlendirilmelidir.

Dosya read/consumer hatası final patch'ten önce oluşursa da created dosyaları
geri alınır. Tekil save hatası mevcut kanonik davranışla failed outcome olur;
diğer girişler bir patch'te kalıcılaşır. dropOldFiles yalnız başarılı patch ve
güncel nihai active-ref kümesi üzerinden çalışır. İş içindeki ileride kullanılacak
ref de tek patch'in final map'inde olduğundan erken silinmez.

Checkpoint başarıları yalnız patch/ownership tamamlandıktan sonra yazılır.
URL dedup mevcut sync işinin byUrl planında kalır; farklı URL'lerin aynı içeriği
aynı kanonik commit'in hash tablosunu paylaşır. İkinci çalıştırmanın source cache
isabetinde indirme ve revision artışı olmaz. Buffer cache kurulmaz.

## 4. Görünürlük ve kabul

İlk kalıcı kanonik link yalnız yerel dosya ve imagemap'in okunabilir olduğunun
kanıtıdır; UI görünürlüğü değildir. Route payload, progress, publish ve cache
invalidation mevcut root zincirine ayrıca bağlanmalı. Bu staged seçenek ilk
linki erkene çekmez. Erken link ürün hedefi zorunluysa yeni açık revision / kısmi
transaction sözleşmesi gerekir; küçük commit'leri mevcut davranışa eşdeğer
sayarak korumalar kaldırılmamalı.

Ana sohbet: üretim wiring RED/GREEN, tam regresyon, gerçek transport/TLS ve
Windows/Electron ölçümü, çoklu writer/manual race ve tek bağımsız P1 incelemesi.
Bu katkı PR/merge/release veya bağımsız inceleme başlatmaz.

EN: Root must own a shared budget, an AbortSignal bridge and a bounded spool.
Canonical ingestion needs a staged, asynchronous entry API preserving one
hash-dedup/rollback/CAS patch boundary. Cancellation waits for transport and
Buffer users; no early canonical visibility or production acceptance is claimed.
