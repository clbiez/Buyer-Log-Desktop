# Adapter API ve sahiplik

```js
const {createBacklogComputeLifecycle} = require('./backlog-compute-lifecycle');
const lifecycle = createBacklogComputeLifecycle({onEvent});
const captured = computeReadGuard.capture(req, 'backlog');
const subscription = lifecycle.subscribe({
  req, res, captured, task: 'backlog-export', parts,
  async build(context) {
    const source = await computeSourceFor(captured.profile);
    context.assertCurrent();
    const params = await computeParamsFor(captured.profile, source, 'backlog-export', context.parts);
    context.assertCurrent();
    await new Promise(setImmediate);
    context.assertCurrent();
    return serverCompute().run('backlog-export', source, params, {signal: context.signal});
  },
  publish(cacheLease) { /* senkron; mevcut cache bu lease’in sahibi olur */ }
});
const lease = await subscription.promise;
sendComputedResponse(req, res, lease);
// response finish/close lease'i bırakır; doğrudan kullanıcı lease.release() çağırır.
```

Bu gösterim bağımsız API’yi açıklar; uygulanacak read-service/cache kodu recipe’de.
`publish` kullanılmıyorsa verilmez. Veriliyorsa ya cache’e aldığı lease’i cache
eviction/clear’da bırakır ya da cache’e almadığı lease’i hemen bırakır. Async
publish yasaktır; callback sonraya cache yazımı planlamaz. Yeni cache yoktur.

`subscription` alanları `{requestId, jobId, promise, release}`. `release()`
idempotenttir. `promise`, `{value, metrics, assertBuild, assertResponse, release}`
lease’i verir. `assertResponse()` gönderimden önce subscriber’ın hâlâ canlı
olduğunu, güncel authority/source ve oturumunu denetler. Hata/abort öncesi output
gelmediyse yeni lease üretilmez. Geciken native success eldeki underlying lease’i
tam bir kez bırakır. Tek underlying lease, cache ve response alt lease’leri
bırakılana kadar ücretli kalır. Havuzun idempotent release’i ikinci çağrı için
güvence olarak kullanılmaz; adapter kendi refs/released durumunu tutar.

`context = {signal, jobId, parts, assertCurrent}`. Parts admission’da deep-copy
edilir. `build` yalnız ortak controller sinyalini mevcut compute service’e verir;
kaynak hazırlığının paylaşılan promise’ini veya seed-source işini bu sinyalle
iptal etmez. Her hazırlık await’inden sonra `assertCurrent()` gerekir. Dönen
lease’ten sonra adapter bir kez daha denetler; burada stale/abort varsa cache
yayını ve delivery yapılmaz. `build` elinde lease tutup daha fazla await yapacaksa
onu döndürmeden oluşan kendi hatalarında kendi lease’ini bırakmalıdır.

## Request/job ayrımı ve anahtar

`captured` yalnız sunucunun mevcut `computeReadGuard.capture` sonucudur; istemci
identity’si yetki kanıtı değildir. Captured key userId, contextHash, accessHash ve
sourceToken içerir. Kaynak token’ı ve descriptor generation’ı mevcut guard/service
tarafından doğrulanır. `task` + tüm query/projection parts + includeSourceDetails
tip/değeri flight key’e katılır. `mapProjection`, sourceColumns, previewLimit,
filtreler ve seçim/sourceRevision da parts’ın içinde kalmalıdır. Yeni hash veya
başlık/canonical çözümleyicisi eklenmez. Farklı anahtarlar iptalde birleştirilmez.

İlk subscriber’ın oturumu ortak işin sahibi değildir. Her subscriber’ın
`assertBuild`/`assertResponse` kapıları ayrı tutulur. İlk oturum geçersizleşince
yalnız o subscriber reddedilir; aynı current captured scope’taki peer devam eder.

`lifecycle.revalidate()` yalnız mevcut capture’ları denetler; stale olanları
ayırır ve yalnız kalan subscriber sayısı sıfır olan pending flight’ı abort eder.
Authority/source sahibi güncellemeden sonra bu metodu çağırmalıdır. Çağrı
olmasa bile her await sonrası ve response gönderiminde stale yayın engellenir;
çalışan CPU’nun erken durması için invalidation olayının bu metoda ulaşması gerekir.
`dispose()` pending uçuşları kapatır ve yeni subscribe’ı reddeder. Tamamlanmış
response/cache lease’leri kendi sahipleri tarafından bırakılır. `inFlight`
yalnız pending flight sayısıdır, cache veya retiring native thread sayısı değildir.

## HTTP ve native bitiş sınırı

- `req.aborted` ve `req`’in `aborted` olayı HTTP subscriber’ını bırakır.
- `res.close`, `writableFinished` false iken erken kapanıştır.
- Tamamlanmış `req.close` abort sayılmaz. Normal `res.finish` yalnız response
  lease’ini bırakır; tamamlanmış job’ın controller’ını abort etmez.
- Kaynak hazırlığı sırasında kapanmış socket subscribe girişinde de kontrol
  edilir. Bu istek analitik `compute.run` çağrısına ulaşmaz.
- Pool rejection’ı native exit değildir. Retiring slot/estimated bytes,
  mevcut pool native exit/terminate acknowledgment’ı görmeden boş sayılamaz.

`onEvent` yalnız `{type, jobId, requestId?, atMs}` alır. UUID’ler rastgele;
anahtar, kullanıcı, session, source descriptor/capability, sorgu veya yetki hash’i
event’e taşınmaz. Olay tipleri: request-join, request-release, job-build,
job-abort, job-complete, job-failed. Job-abort’un anlamı son canlı subscriber’ın
bitmesidir. Job-build callback’in başlangıcıdır; pool admission/dispatch/native
builder başlangıcı olarak raporlanmaz. Native fixture bunları ayrı gözlemler.
Observer hatası iş/lease davranışını değiştirmez; observer senkron ölçüm içindir.
