# Başarısızlık ayrımı / failure classification

## Fixture ve giriş eksikliği

`preflight` exit 2: başlangıçtaki `/tmp` dizini iki execution yüzeyinde de yoktu.
API/davranış testi çalıştırılmadı. Git paketiyle çözüldü; ilk envanter korundu.

`boundaries-original` sync/close başarısızlığı fixture eksikliğidir: commit
sonrasındaki `db.transaction()` WAL'ı previous generation'a döndürmüş, current
WAL yokken current-WAL sync hatası beklenmişti. Fixture transaction'ı gerçek
commit öncesine alındı; snapshot/previous/current artık gerçekte var. `fs.access`
önkoşulu eklendi. Assertion/timeout gevşetilmedi; aynı özgün adayda test geçti
(`boundaries-fixture-corrected-red`). Boş frame veya gereksiz revision eklenmedi.

İlk iki boundary koşusunda directory-close enjektörü native lease admission
metadata sync'ini de görebiliyordu. Bunlar tek başına son-await yarışı kanıtı
sayılmaz. Enjektör `inVerifier` ile yalnız gerçek API çalışmasına sınırlandırıldı.
Eski çıktılar saklandı. Aday sonucu aşağıdaki kontrollü koşuya dayanır.

## Aday hatası — son async lease kontrolü sonrası proof aralığı

**[Doğrulandı]** Özgün adayda son generation ve pending-intent kontrolünden
sonra `await scope.lease.assertOwnedAsync()` var. Bu await sırasında:

1. Snapshot aynı baytlarla yeni inode'a rename edilirse;
2. Current WAL aynı baytlarla yeni inode'a rename edilirse;
3. Gerçek `createDurableFileRecovery.prepare()` yeni native intent kurarsa;

gerçek lease hâlâ sahipli, state aynı ve revision değişmemişken aday
`verified:true` döndürebiliyor. `boundaries-scoped-red` koşusunda üç
`assert.rejects` başarısız: ilk iki case `PRIVATE_DURABILITY_STATE_CHANGED`,
üçüncü `PRIVATE_DURABILITY_RECOVERY_PENDING` bekliyor. Bazda eksik metot
çağrılmadı; özgün gerçek aday API çalıştı.

**Prototip düzeltmesi:** Son async lease kontrolünden sonra aynı gerçek lease'in
senkron `assertOwned()` kontrolü, native `statTag` biçimiyle üç üyenin senkron
`lstatSync` kontrolü ve intent için `readdirSync` kontrolü eklendi. Son state hash
kontrolü korundu; proof'a kadar başka await yok. Sync/close hataları bastırılmadı.
Yeni lease, frame, revision veya recovery yazısı yok. Üretime/hazır pakete
uygulanmadı. Aynı kontrollü testler GREEN, özgün 22 ve katkı 48 tekrar GREEN
(`candidate-final`, 80/80).

Enjeksiyonlar generation/proof sınırını denetler. İşbirlikçi native lease
protokolü dışındaki bütün filesystem yazıcılarına karşı atomiklik veya fiziksel
güç kaybı garantisi iddia edilmez.

## Mevcut üretim davranışı — değiştirilmedi

**[Doğrulandı] Native private-conflict replay:** Hem baz hem adayda tek sentetik
native private conflict ekle, snapshot/rotation yap, warm ve cold oku. Warm
conflict sayısı 1, cold 2. Snapshot'a dahil nonempty private-conflicts payload'ı
`.wal.bak` üzerinden tekrar `push` ediliyor. Strict verifier farklı warm state'i
reddediyor. Baz karşılaştırması verifier gerektirmez; gerçek üretim davranışı
kanıtıdır. Katkı conflict receipt'lerini document records içinde tutar, native
conflicts dizisi boş kalır; bu kullanımda 48 katkı testi geçti. Bütün olası native
workloads uyumu iddia edilmez.

**[Doğrulandı] Partial tail / previous WAL:** Current WAL'a yarım JSON eklenince
mevcut native append hazırlığı valid prefix'i snapshot'a alıp hasarlı WAL'ı
`.wal.bak` olarak korur. Verifier `DATA_INTEGRITY_ERROR` ile kapanır. Hasarlı
bytes korunur, source unavailable ve revision aynı kalır. Aday düzeltmesi bu
davranışı temizlemez veya gizlemez.

**[Doğrulandı] Recovery memoization:** Warm instance sonradan hazırlanan gerçek
intent varken `db.read()` ile cache döndürebilir; refresh proof'u reddedilir.
Cold native recovery tamamlandıktan sonra gerçek API refresh ve aynı ID ile
duplicate retry başarılıdır. `db.read()` durability proof kabul edilmedi.

## Sınırlar

Bazda metodun yokluğu yalnız API eksikliğidir. Windows/Electron file/directory
sync desteği bilinmiyor ve activation blocker olarak ana sohbete bırakıldı.
Mevcut native optional-sync politikaları farklıdır; aday unsupported sync/close/
lease hatasını başarıya çevirmez. Linux, SIGKILL/process-exit elektrik kesintisi
kanıtı değildir.

EN: Input/fixture failures are separated from the controlled candidate RED.
Three final-await races were reproduced with the actual original API and fixed
only in the prototype. Private-conflict double replay and retained torn previous
WAL are existing native behaviors, demonstrated without relying on a missing
base API. None of these findings authorizes production activation.
