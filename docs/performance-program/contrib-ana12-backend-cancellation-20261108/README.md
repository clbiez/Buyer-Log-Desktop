# ANA-12 · HTTP → ortak compute iptal adapter’ı

Durum: bağımsız katkı; üretime bağlı değil. ANA-12 kapanmadı. Dal:
`contrib/ana12-backend-cancellation-20261108`. Main pini:
`1796193f0a57c7785e7bf9fdb3557e33c550b25e`.
İstemci referansı `contrib/ana12-request-lifecycle-20261108`,
`6060c6b0e66a65ef0b8f5c2c4ee4e44f193f8f7b`; merge/cherry-pick edilmedi.
İstemci API’si ve 33 testi referanstan değişmeden `/tmp`’ye getirilip çalıştırıldı.

Yeni `resources/app/server/lib/backlog-compute-lifecycle.js` yalnız pending
flight’ları ve HTTP subscriber’larını yönetir. Tamamlanan satır cache’i kurmaz.
Bir subscriber ayrılınca yalnız kendi promise/response lease’i kapanır.
Son pending subscriber ayrılınca ortak controller abort olur. `build` adapter’ı
sinyali mevcut `compute.run(...,{signal})` yoluna geçirir; pool kuyruktaki işi
kaldırır veya native worker’ı terminate eder. Adapter worker üretmez, havuzun
admission/byte/retire/exit sözleşmesini değiştirmez ve `setGeneration` çağırmaz.

Çalışan senkron Backlog builder’ında native terminate doğrulandığından yeni
cooperative mekanizma gerekmiyor. Promise reddi veya sonucun yok sayılması CPU
iptali kanıtı olarak kullanılmadı.

- [API ve sahiplik](adapter-contract.md)
- [Route recipe ve kaynak pinleri](route-recipe.md)
- [Native iptal ve CPU ölçümü](measurements.md)
- [Kesin dosya listesi ve SHA-256 manifesti](manifest.json)

## Doğrulama ve sınırlar

İlgili hedefli regresyon, yeni native/HTTP/cache recipe testleri, istemcinin
değişmeyen assertion’ları ve i18n sonuçları `evidence/` altında tutulur.
Son hedefli koşu: **22 dosya, 160/160 assertion**. Değişmeyen istemci referansı:
**33/33**. Sabit istemci → fetch → kontrollü HTTP → native worker zinciri:
**1/1**. i18n check yeni/baseline eksik sayıları **0/0**.
Negatif kontrol, sinyal iletimini yalnız bellekte kaldırır: Promise reddi devam
ederken queued/running/dispatch-race/authority native exit testleri RED olur.
İlk eksik-modül RED’i de ayrı tutulur; davranışsal RED yerine sunulmaz.

İlk geniş hedefli koşu, mevcut testlerin varsayılan `/home/agent/.buyer-log`
yoluna yazamamasıyla dört ortam hatası verdi. Log silinmedi. Aynı assertion,
timeout ve validator’larla yalnız `BUYER_LOG_DATA_ROOT`,
`BUYER_LOG_LOCAL_DATA_ROOT`, `BUYER_LOG_SERVER_DATA_ROOT` sentetik `/tmp`
dizinlerine yönlendirilerek tekrarlandı. Yetki/eşdeğerlik assertion hatası olarak
gizlenmedi; ilk koşudaki hatalar dosya sistemi hazırlığında oluştu.

Gerçek `server.js` route’u bağlanmadı. Loopback testleri kontrollü HTTP route’u
üzerinden gerçek fetch, gerçek pool ve gerçek Backlog worker’ını sınar;
ürünün uçtan uca kabulü değildir. Tam entegre regresyon ve tek P1 bağımsız
inceleme ana sohbete aittir. Bu katkıda bağımsız reviewer, PR, merge, rebase,
force-push, TEST veya STABLE yapılmadı.

Görünür ürün davranışı değişmediğinden release-note/screenshot eklenmedi.
i18n baseline boş kaldı; CP #916, canonical, perf-runtime, istemci üretim
dosyaları ve mevcut tüm üretim dosyaları değişmedi.

## Yeniden üretme

Repo kökünde, aynı VM’de her test/ölçüm şu ön ekle seri çalıştırılır:

```sh
env -u NODE_OPTIONS -u NODE_PATH flock -n -E 75 /tmp/buyerlog-performance-measurement.lock COMMAND
```

Kilit doluysa exit 75 başarı değildir; lock silinmez veya aşılmaz. Komutlar
`scripts/prototypes/ana12-backend-cancellation-20261108/` altındadır:

```sh
# Önce referansı getir ve SHA’yı doğrula; merge etme.
git fetch origin contrib/ana12-request-lifecycle-20261108
git rev-parse FETCH_HEAD

env -u NODE_OPTIONS -u NODE_PATH flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  node --test --test-concurrency=1 resources/app/tests/backlog-compute-lifecycle-*.test.js
env -u NODE_OPTIONS -u NODE_PATH flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  node scripts/prototypes/ana12-backend-cancellation-20261108/client-reference.cjs
env -u NODE_OPTIONS -u NODE_PATH flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  node --test scripts/prototypes/ana12-backend-cancellation-20261108/client-native-chain.cjs
env -u NODE_OPTIONS -u NODE_PATH flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  node scripts/prototypes/ana12-backend-cancellation-20261108/native-stop.cjs /tmp/ana12-native-stop-new.json
env -u NODE_OPTIONS -u NODE_PATH flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  node scripts/prototypes/ana12-backend-cancellation-20261108/measure.cjs /tmp/ana12-paired-new.json
env -u NODE_OPTIONS -u NODE_PATH flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  node --test scripts/prototypes/ana12-backend-cancellation-20261108/red-without-signal.cjs
```

Son komutun başarısız olması beklenir. Mevcut ölçüm dosyalarının üstüne yazma.
Native gözlem fixture’ı Linux `/proc/thread-self/stat` kullanır; Windows native
gözlem/ölçümü bu katkıda doğrulanmadı. Adaptörün kendisi Linux API’si kullanmaz.
Gerçek servis, credential, refresh POST veya retry kullanılmadı.

Hedefli regresyonda kullanılan aynı filtreler, mevcut test runner ve sentetik
data-root seçenekleri (repo kökünden):

```sh
validationRoot=$(mktemp -d /tmp/ana12-validation.XXXXXX)
env -u NODE_OPTIONS -u NODE_PATH flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  env BUYER_LOG_TEST_CONCURRENCY=1 BUYER_LOG_DATA_ROOT="$validationRoot/app" \
  BUYER_LOG_LOCAL_DATA_ROOT="$validationRoot/local" BUYER_LOG_SERVER_DATA_ROOT="$validationRoot/server" \
  node resources/app/tests/run-tests.js backlog-compute-lifecycle compute-read-service \
  compute-read-guard compute-response server-compute-pool compute-worker-integration \
  compute-task-access compute-access-equivalence compute-backlog-route-wiring \
  compute-backlog-cold-publication compute-source-token compute-source-codec compute-source-cache \
  backlog-query-cache backlog-chart-shared-preparation backlog-dynamic-chart \
  backlog-shared-analysis-filters backlog-analysis-performance backlog-plan-actual-wiring
env -u NODE_OPTIONS -u NODE_PATH flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  node --test resources/app/tests/i18n-coverage-guard.test.js
```

`npm run i18n:check` de `resources/app` içinden aynı env/flock ön ekiyle çalıştırılır.
