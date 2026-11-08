# Root entegrasyon sözleşmesi

Bu belge önerilen bağlantı noktalarını tanımlar; bu dalda uygulamaya
bağlanmadı. [#899 handoff](https://github.com/clbiez/Buyer-Log-Desktop/blob/b2a4a579c5369f59e5cfb9181140a00176d944ef/docs/performance-program/int-03-memory/claude-handoff.md)
ve hazırlık testleri geçerli kalır. Manual ownership, revision, dedup, rollback
ve dropOldFiles kararları yardımcıya taşınmadı.

1. **Süreç genelinde tek instance.** `createByteBudget({ limitBytes })`
   server yaşam döngüsünde bir kez oluşturulup bütün sync işlerine enjekte
   edilmeli; job başına yeni bütçe üretmek toplamı sınırlamaz. Başka process veya
   worker aynı instance'ı paylaşmaz. Bu yardımcı process'ler arası koordinasyon
   veya yeni worker gerektirmez/sağlamaz. Mevcut indirme concurrency tavanı korunsun.

2. **Transport'tan önce admission.** `acquireImage` tamamlanmadan gövde
   allocation/retention başlamasın. Content-Length yalnız yanıt başlığıyla
   öğreniliyorsa GET'ten önce bilinmeyen uzunluk envelope'u ayırmak güvenli
   seçenektir. Yanıtta gelen uzunluk ayrıca mevcut transport katmanında
   doğrulansın; başlangıç reservation'ı küçültülmesin. Bilinen uzunluk admission
   öncesinde gerçekten mevcutsa yardımcıya verilsin. Header beklerken veya
   admission kuyruğunda kontrolsüz socket buffering oluşturmayın. `pause()`
   öncesi/sonrası TLS ve stream highWaterMark alanını ayrıca sınırlayıp headroom'a
   ekleyin. Sadece `on('data')` içinde, chunk geldikten sonra permit beklemek
   backpressure sağlamaz. Her chunk tutulmadan önce kümülatif byte kontrolü,
   EOF'ta tam uzunluk kontrolü yapılsın; taşmada stream/request durdurulsun.
   Mevcut `Accept-Encoding: identity` korunsun; Content-Length ile kontrol
   edilen gövde aynı byte akışına ait olsun, arada sessiz decompress yapılmasın.

3. **Kopyaları açık bütçeleyin.** Yardımcı body+concat için `2B` ayırır;
   validation ve commit ek alanı root belirler. Mevcut ingest base64 üretip
   `saveCollectionImage` içinde tekrar decode eder, mevcut eski görseli de
   okuyabilir. `C = 4 * ceil(B / 3)` için base64 string'e konservatif `2C`,
   decode Buffer'ına `B`, mevcut eski dosya okumasına onun ayrı boyut tavanı
   ve diğer geçici scratch için ek pay düşünülmelidir. `commitCopyBytes=0`
   mevcut ingest'e doğrudan bağlamak için yeterli değildir. Validation ileride
   raster decode yaparsa piksel/decode tavanı da ayrıca gerekir. Bu rakamlar
   RSS garantisi değildir; gerçek allocation yolu üzerinde doğrulanmalı.

4. **Permit ömrü ve commit ilerlemesi.** Permit indirme → doğrulama → commit
   kuyruğu → kanonik commit boyunca tutulmalı. `runBounded.results`, `ready`,
   URL cache'i, retry closure'ı ve yanıt nesnesinde Buffer bırakılmasın. URL'yi
   paylaşan bütün tüketiciler aynı Buffer'ı kullanıyorsa tek reservation sahibi
   yaşam döngüsünü yönetmeli, son tüketici bitmeden bırakmamalı. Küçük commit
   kuyruğu byte olarak sınırlandırılmalı; admission durduğunda eldeki hazır
   batch hemen flush edilebilmeli. Bütün indirmelerin bitmesini veya sabit
   batch adedinin dolmasını beklemek, dolu bütçede deadlock yaratabilir. Permit
   eldeyken ek permit acquire beklemeyin. Retry'da eski chunks/kopyaları
   bırakın; mevcut envelope içinde yeniden deneyin veya bütünü bırakıp tekrar
   admission alın. Aynı anda eski ve yeni reservation beklemeyin.

5. **İptal ve kısmi hata.** Job iptalini ortak `AbortSignal` ile waiter'a ve
   aktif transport'a taşıyın. `PLM_IMAGE_BUDGET_CANCELLED` uygulamanın mevcut
   iptal/raporlama koduna root'ta eşlensin; otomatik transient retry yapmayın.
   Aktif callback abort'ta önce alt işleri durdurup bütün Buffer kullanıcılarını
   settle etmeli, sonra referansları bırakıp dönmeli. Başlamış kesilemeyen
   commit'in bitmesini bekleyin. Yalnız `Promise.race` timeout'u ile callback'i
   bitirip arka işi canlı bırakmayın. Bir görselin hatası diğer işin permit'ini
   veya başarılı önceki commit'leri etkilemesin. `withImage` içindeki `finally`
   bu sözleşme sağlandığında reservation'ı başarı/hata/iptalde bırakır.

6. **İş kuralları kanonik katmanda.** Her küçük commit'te güncel map/store ile
   manual ownership yeniden doğrulansın. İş ömürlü Attachment URL dedup ve
   batch'ler arası content-hash dedup küçük metadata/ref tablosuyla korunsun;
   dedup için Buffer cache'i tutulmasın. `patchPlmImageLinks` revision/optimistic
   concurrency ve no-op davranışı açık karara bağlansın; batch başına revision
   artışını sessizce eşdeğer saymayın. Checkpoint yalnız kalıcı linkten sonra
   ilerlesin. Başarısız batch'in yeni dosyaları rollback olsun; önceki başarılı
   batch'ler kalsın. dropOldFiles yalnız izinli kipte, başarılı linkten sonra,
   başka mevcut/gelecek batch referansı kullanmıyorsa çalışsın. Yardımcı bu
   kararların hiçbirini vermez; #899 kanonik regression oracle'ları gevşetilmesin.

7. **Görünürlük ve kabul root'ta.** Küçük commit sonrası route/progress,
   publish, cache invalidation ve istemci görünürlüğü mevcut sisteme bağlansın.
   Mock tamamlanması veya yerel ilk link UI görünürlüğü sayılmasın. Entegre
   davranış için gerçek üretim RED→GREEN, iki sync/manual race/partial/rollback/
   dropOldFiles/revision/dedup testleri ve gerekli tam regresyon çalışsın.
   Sabit güncel before/after kaynaklarda eşdeğer harness/fixture/ortamla en az
   üçer koşu ve bağımsız inceleme gereksinimi sürer. Reservation, sampled
   external/arrayBuffers, OS peak RSS, ilk görünür görsel ve toplam süre ayrı
   raporlansın. Bu dalın izole ölçümünü before/after veya INT-03 kabulü saymayın.

EN: Root must inject one process-lifetime budget, reserve before transport body
allocation, explicitly cover all copies, keep permits until consumers and commits
settle, and flush ready commits while admission is blocked. Existing canonical
ownership, revision, dedup, rollback and cleanup semantics remain outside this
helper. Runtime integration and acceptance remain open.
