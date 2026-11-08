# ANA-12 adapter sözleşmesi · henüz üretime bağlı değil

## İstemci API'si

```js
const requests = BLBacklogRequestLifecycle.createRequestLifecycle({
  keyForQuery,                // mevcut rowsQueryKey fonksiyonu; string döndürür
  isCurrent(identity),        // senkron boolean; canlı oturum/source epoch kontrolü
  prepare(params, context),   // isteğe bağlı async, transport ÖNCESİ hazırlık
  request(params, context),   // Response veya Promise<Response>
  beforePublish(body, context), // isteğe bağlı async, parse SONRASI yalnız hazırlık
  publish(body, context)      // isteğe bağlı SENKRON, mevcut cache/calendar sahibi
});
const subscription = requests.subscribe(params, {
  scope, user, session, generation, revision
});
const body = await subscription.promise;
subscription.release();       // idempotent; yalnız bu subscriber
requests.inFlight;           // yalnız pending key sayısı, satır cache'i yok
requests.dispose();          // tüm pending abonelikleri kapatır; yeni subscribe yasak
```

Bu bir imza gösterimidir, çalıştırılacak entegrasyon kodu değildir.
`context = Object.freeze({identity, signal})`; kimlik kopyalanıp dondurulur.
Kimlik alanları boş olmayan string veya finite number olmalı; tip farkı korunur.
Query üst seviyesi kopyalanır/dondurulur; iç içe query değerleri kullanılacaksa
adapter bunları immutable tutmalıdır. `includeSourceDetails` ayrıca key'e girer;
query key adapter'ı yanlışlıkla atlasa da bu varyantlar birleşmez.
`scope` ve `user` local partition etiketidir; credential taşınmaz.

`isCurrent`, generation/revision ve session değişimini canlı sahibinden okumalıdır.
Her subscriber admission'da ve her async sınırdan sonra kontrol edilir.
Callback'ler güvenilir adapter kodudur; `isCurrent` ve `publish` async olmamalı,
`publish` içinde sonradan çalışacak cache yazımı planlanmamalıdır. Await'ler yalnız
`prepare`, `request`, `beforePublish` içindedir. Bu hazırlık callback'leri cache'e,
takvime veya ekrana yazmaz. Son güncellik kontrolü ile senkron publish arasında
await yoktur. Publish dönüş değeri kullanılmaz; aynı body grafiği tüketicilere verilir.
Publish gerekirse mevcut revision cache'inden `body.rows` referansını seçebilir.

Her panel kendi `{promise, release}` tutamacını saklar. Sorgu değişince veya panel
kapanınca yalnız eski tutamacını bırakır; başka panelin tutamacını bırakmaz,
ortak manager'ı dispose etmez, global invalidate/generation çağırmaz.
Release edilmiş subscriber promise'i AbortError ile hemen reddedilir. Kalan
subscriber sonucu alır. Son pending subscriber ayrılınca flight Map'ten çıkar ve
controller abort olur. İptal edilmiş flight'a yeniden bağlanılmaz. Yeni aynı key
için yeni controller/flight oluşur; eski success/error cleanup yalnız kendi
flight kimliğiyle eşleşen girdiye dokunabilir. Normal completion abort üretmez.

## Mevcut BLBacklogRows'a bağlama ihtiyaçları · root uygulayacak

1. `rowsCache` ve `rowsRevisions` tek kalıcı satır sahibi olarak kalacak. Önce
   geçerli cache hit yolu, miss'te ortak lifecycle kullanımı tasarlanacak. Her
   panel ayrı subscriber tutacak; cache sahipliği canlı subscriber sayılmayacak.
   Mevcut `load`/`loadData` imzalarının tutamaç vermemesi nedeniyle adapter veya
   ek subscriber API'si ve panel close/query kabloları gerekir.
2. Gerçek `rowsQueryKey` kullanılacak; üç grouping istisnası korunacak.
   Scope, user/session epoch, source generation ve revision canlı sahibinden
   alınacak. Panel render generation'ı ortak source generation yerine geçmez.
   Local etiketlerin eşitliği sunucunun yetki doğrulaması değildir.
3. `loadRows`'un pivot `whenRowsReady()` kapısı korunacak; query/identity bu
   hazırlığın son güncel sonucuna dayanmalı. Hazırlık sırasında stale olup yeniden
   yakalama gerekiyorsa panel adapter'ı bunu yönetecek. `prepare` üzerinden beklenen
   uçuşta son subscriber ayrıldıysa fetch başlamaz. `loadData` doğrudan yoluna
   kendiliğinden readiness eklenmiş sayılmaz; güncel native testler korunacak.
4. `request`, `/api/backlog-export` için mevcut query ve
   `credentials:'same-origin'` ile **context.signal**'ı gerçek fetch'e geçirecek.
   İçinde sinyalsiz transport başlatılmayacak, retry/refresh POST eklenmeyecek.
5. `beforePublish` mevcut `BLMerchCalendarReady` beklemesini karşılayabilir.
   Sonrasında yalnız güncel, aboneliği olan uçuşun `publish` callback'i
   `BLMerchCalendarRuntime.apply`, revizyonla rows referansı reuse ve cache
   yayını yapacak. Eski `loadData` completion callback'i paralelde yayına devam
   etmemeli. Helper bu mevcut cache/calendar işlemlerini henüz yapmaz.
6. Normal hata/AbortError UI ayrımı ve senkron JSON.parse sınırı doğrulanacak.
   Helper'ın strict JSON reddi ile mevcut `{}` fallback farkı kararlaştırılacak.
   Çıkışta tüm yanıt alanları/row kimliği ve gerçek iş projeksiyonları bağımsız
   oracle ile karşılaştırılacak. Sentetik loopback oracle bu kabulün yerine geçmez.

## HTTP → queued/running job sözleşmesi · root sunucu sahibinde

- İstemci son ref → gerçek fetch abort → **erken/incomplete** HTTP kapanışı →
  ilgili server shared flight'ın o HTTP subscriber'ını idempotent bırakma.
  İlk HTTP tüketicisi shared controller sahibi olamaz. Normal response `finish`
  veya tamamlanmış `close`, abort değildir; koşulsuz `req.close` abort bağlanmaz.
- Server flight canlı HTTP subscriber sayısını, cache'in lease/ref sahipliğinden
  ayrı tutacak. Son canlı subscriber ayrıldığında yalnız o shared flight'ın
  ortak controller sinyali mevcut `computeOptions.signal` üzerinden pool'a gider.
  Cache ref'i son subscriber iptalini önlemez; diğer query/user/preparation
  işleri korunur. Tek istek için global `setGeneration` çağrılmaz.
- Kuyrukta sinyal, pending işi dispatch/worker receive/start görmeden çıkarmalı.
  Running iptal mevcut pool retire/terminate yoluna bağlanmalı; kapasite gerçek
  native exit/termination acknowledgment gelene kadar serbest sayılmamalı.
  Promise rejection/AbortError/lease release, CPU durması veya cooperative
  cancellation diye raporlanamaz.
- Request/HTTP subscriber/shared-flight/job ID ilişkisi kaydedilecek.
  sent/admitted/started/completed/cancelRequested/cancelAcknowledged/nativeExit,
  sebep ve zaman, aktif/pending sayaçları ve iptal sonrası CPU örnek penceresi
  gerçek olaylardan çıkarılacak. Mevcut toplu `failed` alanından cancelled
  sayısı türetilmeyecek. Bu katkıda bu sayaçlar/CPU sonucu bilinmiyor.
- Mevcut server `assertBuild`/`assertResponse`, access/source token ve
  scope/query/generation/includeSourceDetails ayrımı korunacak. İstemci kimliği
  yetki kanıtı değildir. Eski job completion'ın cache'e yayınlaması ve yeni
  flight'ı silmesi ayrıca server seviyesinde engellenecek.
- Plan/gerçekleşen archive/analysis route'u ayrı yürütme zinciridir; export
  adapter'ı onu veya backend CPU iptalini kendiliğinden kapsamaz.

Root kabulü: tek/iki HTTP subscriber, ilk/son ayrılma, normal completion,
queued/running iptal, on hızlı filtre, aynı key'e dönüş, geç completion,
scope/session/revision/details ve gerçek iş/yanıt eşitliği. Son sabit entegrasyon
SHA'sında filtresiz native regresyon ve gerekli üretim incelemesi ayrıca yapılır.
ANA-12 bu katkıyla kapanmaz.
