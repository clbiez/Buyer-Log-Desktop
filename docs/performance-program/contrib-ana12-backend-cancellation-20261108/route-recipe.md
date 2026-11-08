# Sabit kaynaklara bağlı exact-edit recipe

`scripts/prototypes/ana12-backend-cancellation-20261108/source-pins.json`
Main/istemci SHA’larını ve sekiz gerçek kaynak dosyasının SHA-256 değerlerini
içerir. `route-recipe.cjs` her pini ve her edit anchor’ının tekilliğini doğrular;
drift varsa fail-closed olur. Kaynakları yalnız bellekte değiştirir. Root’a
tam `server.js`/read-service kopyası yazılmaz.

```sh
env -u NODE_OPTIONS -u NODE_PATH flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  python scripts/prototypes/ana12-backend-cancellation-20261108/render-recipe.py > /tmp/ana12-route.patch
```

Teslimdeki `route.patch` aynı generator çıktısıdır ve henüz uygulanmadı.
Patch sıfır context ile üretilir; `git apply --unidiff-zero --check route.patch`
ile yalnız uygulanabilirliği denetlenir. Kaynak pinleri ve exact anchor kontrolü
generator’da zorunludur. Entegrasyon sahibi ancak sabit kaynakta uygulamalıdır.
Read service’in mevcut `run(req,area,task,parts,options)` API’sine yalnız Backlog için
`options.response = res` girer. Diğer çağrılar mevcut akıştan geçer. Mevcut
`flights` ve byte/TTL/LRU cache’i korunur; response’lu Backlog pending işini yeni
lifecycle koordine eder. Cache hit de HTTP/authority kapısından geçer. Bir cache
ref’i canlı HTTP subscriber sayılmaz. Clear epoch’undan önce başlayan iş sonradan
cache’i dolduramaz. Cache sınırına sığmayan output lease’i bırakılır.

Recipe beş route’u kapsar: `/api/backlog`, `/api/backlog-source-columns`,
`/api/backlog-export` (JSON ve workbook), `/api/backlog-filter-values`,
`/api/backlog-map-details`. Mevcut `prepareComputeBacklog(req)` ve source-info
tek-uçuş hazırlığı yerinde kalır. Bu paylaşılan hazırlık tek HTTP adına abort
edilmez. Hazırlık bitene kadar HTTP kapandıysa sonraki subscribe analitik işi
başlatmaz. Hazırlık işi için yeni ayrı cache veya worker mekanizması yoktur.

Read-service recipe’si orijinal yedi assertion testi değiştirilmeden bellekte
çalıştırıldı; ayrıca gerçek pool ile ortak HTTP subscriber/cache hit, TTL/clear,
cache admission reddi ve native completion sonrası authority değişimi sınandı.
Server recipe’sinin tamamı parse edildi; beş route’un doğru response context’i
ve mevcut preparation çağrısı kontrol edildi. Gerçek server route’ları çalıştırılmadı.

## Authority/source invalidation ve kalan entegrasyon

Exact recipe mevcut `onIamApplied` callback’i ve `rememberComputeSource` kaynak
yayını sonrasına `revalidateBacklogCompute()` ekler. Başlangıçta no-op olan hook,
computeReads kurulduğunda `revalidateBacklog`’a bağlanır; initialization TDZ’si
oluşmaz. Shutdown pending lifecycle’ı dispose eder, sonra mevcut cache’i temizler.

Bu iki hook bütün authority/context değişim yollarını kapsadığı iddiası değildir.
Özellikle `user-access.js` içindeki yerel admin yazımları ve periyodik
`refreshOrderAuthority`, oturum/credential değişimi, horizon/override/calendar
güncellemeleri için gerçek sahiplerin invalidation olaylarını root entegrasyonda
aynı revalidate kapısına bağlamak gerekir. Bu katkıda o üretim dosyaları salt
okunurdur. Son guard kontrolü stale cache yayınına izin vermez; hook ulaşmazsa
CPU ancak sonraki async sınırında/normal tamamlanmada fark edilebilir.

Mevcut guard’ın accessHash’i global authorityHash ve ownershipProfiles içerir
(`compute-access.js:66`). Dolayısıyla bazı global directory değişiklikleri birden
fazla scope’un stamp’ini stale yapabilir. Adapter bu mevcut authority sözleşmesini
daraltmaz veya bypass etmez. Değişmeyen capture’ları iptal etmediği native testle
kanıtlıdır; gerçek IAM olaylarının hangi scope’ları değiştirdiği ve daha dar
invalidation gereksinimi son entegrasyonda doğrulanmalıdır. Global hash’in etkisi
bağımsız per-scope IAM iptal kabulü gibi sunulmaz.

Tek request abort’unda `clear`, global generation bump veya pool `setGeneration`
çağrısı eklenmez. `revalidate` capture’ları ayrı ayrı doğruladığından ilgisiz
scope/generation işi korunur; native testte farklı owner’ın gerçek descriptor ve
access context’iyle sıradaki işi, iptal edilen owner’dan sonra başarıyla çalıştı.

Plan/Actual archive/analysis route’ları ayrı yürütme zinciridir; bu patch onları
kendiliğinden kapsamaz. Son entegrasyon ayrıca istemcinin publish/cache/calendar
sahipliğini, API hata sunumunu, i18n/release kabulünü, gerçek route korelasyonunu,
filtresiz regresyonu ve tek P1 incelemesini tamamlamalıdır. ANA-12 açık kalır.
