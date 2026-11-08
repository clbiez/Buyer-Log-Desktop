# Root native adapter talebi / Native adapter request

**Production bağımlılığı açık.** `local-db.js` değiştirilmedi. Mevcut API ile
yeni commit gerçek `privateRecordTransaction(prepare)` dönüşünü bekleyerek durable
olur. Ancak `read()` veya receipt'in prepare içinde bulunması, önceki write'ın
fsync'i başarısız olmuşsa durability kanıtı vermez. Refresh/duplicate bu nedenle
verifier yokken `COMMITTED_READ_ADAPTER_REQUIRED` ile kapalı kalır.

## En küçük somut API

Root mevcut local-db instance'ına aşağıdaki scoped helper'ı ekleyebilir:

```js
// Yalnız bu DB'nin mevcut native lease/prepare bağlamında çağrılabilir.
// Yeni frame, revision, snapshot mutasyonu veya transport event'i üretmez.
async function verifyPrivateRecordDurability(state) {
  // DB identity + lease ownership + state/disk-generation eşleşmesi;
  // snapshot ve current/previous WAL doğrulaması;
  // mevcut native durability politikasıyla gerekli dosya/dizin sync'leri;
  // son lease/current-generation denetimi.
  return { verified: true, nativeRevision: state.revision };
}

const source = createCollectionCommittedSource({
  db, actorId, assertAuthority,
  verifyDurability: ({ db, state }) => db.verifyPrivateRecordDurability(state),
});
```

Bu isim **mevcut export değildir**; talep edilen native adapter sözleşmesidir.
Helper'ı yeni transaction/lease açarak uygulama: callback zaten native lease
altındadır ve nested admission deadlock/reentrancy yaratabilir. Mevcut recovery,
parse/checksum, fsync ve lease mekanizmalarını kullan. Dosya adları/module
namespace'i client'tan alınmaz. `db.getFile()` mevcut gerçek API'dir.

Gerekli garantiler:

- Aynı DB lease'i boyunca başka writer/rotation yok; yanlış DB/state nesnesi ve
  lease kaybı reddedilir. Raw `cachedState` değiştirilebilir bir public API olarak
  açılmaz. Verilen state aynı native dosya generation'ının replay sonucudur.
- Current WAL kadar önceki `.wal.bak` de checksum/schema açısından doğrulanır.
  Native torn-tail recovery varsa önce kendi protokolünde sonuçlandırılır;
  doğrulama başarısızlığı veya incomplete active member eski JSON'a dönmez.
- Snapshot + gerekli WAL generation'ları mevcut platform durability politikasına
  göre gerçekten sync edilmeden `verified:true` dönmez. Sync/close/tag/lease
  hataları proof üretmez; unknown tx aynı ID ile tekrar çözülür.
- Native revision proof verilen state ile tam eşleşir. Dosya/dizin durability
  ayrıntılarını helper sahibi yönetir; caller `await db.read()` veya file stat
  eşleşmesini sync yerine kabul etmez.
- Yalnız bu helper'a ulaşmak için boş private frame eklenmez. Exact duplicate
  mevcut receipt'i, WAL bytes'ını, row/global revision'ı değiştirmez.

Kütüphane şu an mevcut `privateRecordTransaction` prepare'ından özel sentinel
fırlatarak no-append read/duplicate boundary'si kurar. Gerçek API bu durumda
cache'ini invalidate eder; doğruluk korunur fakat sonraki load maliyeti vardır.
Gerekirse root aynı lease+verifier sözleşmesinde başarılı read-only native
callback API'si sağlayıp bu maliyeti kaldırabilir; bu ek optimizasyon zorunlu
değildir ve bu katkıda yapılmadı.

## Çalıştırılmış karşılık ve sınırı

`resources/app/tests/fixtures/collection-committed-native.cjs::verifyDurability`
yalnız sentetik Linux fixture adapter'ıdır. Mevcut gerçek prepare lease'i
`assertHeldFileLeasesAsync()` ile kontrol eder; DB/current-WAL/previous-WAL
dosyalarını okur, WAL checksum'larını doğrular, gerçek file `sync()` ve directory
`sync()` yapar; yeni frame eklemez. Testler fsync EIO, cold/lost-ACK retry,
generation, retirement ve old ACK sınırlarını bununla doğrular.

Bu fixture Windows/Electron/platform policy uygulaması değildir. Current API'nin
prepare/lease/single-frame ve getFile kullanımının gerçek uyum kanıtıdır;
production verifier'ın var olduğunu iddia etmez. Root'u mevcut local-db veya
save-worker dosyasını bu katkıya devretmeye zorlamaz; aynı tek Faz 6c entegrasyon
PR'ında bağlanması gereken açık adapter talebidir.

EN: New commits use the actual current native API. Verified startup/refresh and
unconfirmed duplicate recovery require the explicit lease-scoped durability
helper above. The Linux fixture performs real file/directory sync under the
actual native lease; it is evidence for the boundary, not a production adapter
or source activation.
