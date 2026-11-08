# Faz 6c committed source katkısı / Phase 6c committed source contribution

Başlangıç: `d66c1f803097af5991616f0420392e1027888f2e`; dal:
`contrib/phase6c-committed-source-20261108`. Bu teslim yalnız ayrık kütüphanedir.
Cutover, migrasyon, route/worker bağlantısı veya ürün aktivasyonu içermez.
Faz 6a kapanışı, tek Faz 6c entegrasyon PR'ı, tam regresyon ve bağımsız P1
incelemesi root sorumluluğundadır. PR, merge, TEST ve STABLE yapılmadı.

EN: Disconnected library contribution only. No production source is selected,
imported, mirrored or activated. Root owns integration after Phase 6a, the single
Phase 6c PR, full regression and final independent P1 review.

## Değişiklik ve API

`resources/app/server/lib/collection-committed-source.js` mevcut native cache'e
referans vermeyen, derin dondurulmuş owner görünümünü tutar. Bilinen aynı native
tabandaki scalar commit'te yalnız değişen satırlar kopyalanır; diğer satırlar ve
metadata önceki owned snapshot ile paylaşılır. Refresh/dış native revision yeni
owned kopya üretir. Array/header hazırlığı ve tam checksum hâlâ O(workspace)'tir;
performans kazancı ölçülmedi.

`resources/app/server/lib/collection-delta-commit.js`, devirdeki native27 scalar
planlayıcısını mevcut `privateRecordTransaction` üzerine taşır. Satır, head,
receipt ve inverse slot'ları tek `private-records` frame'inde kalır. Genel
transport event'i, yeni WAL/DB/worker veya checklist yan etkisi üretmez.

```js
const source = createCollectionCommittedSource({
  db, actorId, assertAuthority, verifyDurability,
});
const service = createCollectionDeltaService({ source });
await source.refresh({ ownerId, sourceGeneration, clientGeneration });
const view = await source.read({ ownerId, sourceGeneration, clientGeneration });
const result = await service.commit(command);
```

| API | Kesin sözleşme |
| --- | --- |
| `source.refresh(binding)` | Mevcut private transaction prepare lease'i altında verifier + tam owner validation; frame/revision eklemeden çıkar. Verifier yoksa `COMMITTED_READ_ADAPTER_REQUIRED`. Başarısız refresh readiness'i kaldırır. |
| `source.read(binding)` | Her çağrıda güncel async authority callback'i; yalnız son doğrulanmış/ACK edilmiş immutable görünüm. Disk freshness bariyeri değildir. |
| `source.readSync(binding)` | Aynı callback'in o anda senkron cevap vermesini gerektirir. Promise cevabında `ASYNC_AUTHORITY_REQUIRES_READ`; cache edilmiş yetki kabul etmez. |
| View | `{ownerId, sourceGeneration, structureRevision, nativeRevision, workspace, workspaceSha256}`; client tarafından değiştirilemez. |
| `service.commit(command)` | Yeni frame'de native durable ACK; duplicate'ta lease altında verifier. Başarı `{durable, duplicate, visibility, publication:'not-attempted', receipt}`. |
| `source.transaction(binding, prepare)` | Güvenilir server planner için iç sınır; HTTP/client API'si değildir. Prepare mevcut state'i değiştirmeden `{records,result}` veya `{duplicate:true,result}` üretir. |
| `decodeWorkspace(state, ownerId)` | Native27 için saf codec; authority/readiness/durability API'si değildir. `db.read()` sonucu buraya verilerek committed görünüm yayımlanamaz. |
| `adaptLegacyFullState(base,incoming,binding)` | Yalnız captured tam state'in existing-row scalar alan değişimi. Whole-workspace expected revision + row CAS korunur. Metadata, row order/identity, `_rev` ve JSON key-order değişimi reddedilir. |

Scalar kapsam yalnız bildirilen `cx_*`, `custom:true`, `type:'text'`, checklist
olmayan kolonların primitive JSON slot'larıdır. Absence/null/false/0/blank
ayrıdır. `row-cas-v1` default uyum politikasıdır; `field-merge-v1` açık opt-in
ve farklı bir eşzamanlılık politikasıdır. Inverse alan token'ı + after-state
kontrol eder; aynı alan ABA'sı reddedilir. Conflict tüm batch satır etkilerini
iptal eder ve intent'i receipt'te tutar. Tx kimlikleri/durable receipt'ler
budanmaz; retention/admission root entegrasyon işidir.

Rich-note, pricing, checklist, row create/delete/reorder, grup/shared/override,
bilinmeyen alan yazımı ve typed structure komutları desteklenmez. Bilinmeyen
workspace/row verisi aynen korunur; bu, o alanın edit semantiğinin desteklendiği
anlamına gelmez. Full PUT'un absent/null expectedRevision ve kısmi PATCH
semantiğinin bütünü bu dar adapter tarafından uygulanmış sayılmaz.

## Kaynak, checksum ve tombstone

Önerilen private namespace/layout native27 ile aynıdır:
`collection-workspaces:<owner>:head`, `structure`, `row:<encoded-id>`, `tx:<id>`.
Yeni gerekli `structure.workspaceKeys = Object.keys(capturedCanonicalWorkspace)`
alanı metadata/rows/_revision slot'larının tam sırasını korur. Eski descriptor
otomatik upgrade edilmez; `SOURCE_HANDOFF_REQUIRED` verir. Başlangıç/adoption
API'si yoktur. İlk doğrulanmış kurulum ve writer fencing root'a aittir.

`workspaceSha256 = sha256(JSON.stringify(workspace))` mevcut replication/full
replace checksum'uyla aynı insertion-order bytes'ı kullanır. İşlem `digest`'i
ise trusted actor + komutun sorted-key canonical JSON hash'idir. Bunlar farklı
kimliklerdir; biri diğerinin yerine CAS/ancestry kanıtı olamaz. Sayısal/string
row ID türleri ve `_rev` own-property presence korunur.

Üyelikte referans verilen missing/tombstoned/yanlış owner/schema satır kaynak
hatasıdır. Üyelikten çıkarılmış satırın private tombstone'u yeniden canlanmaz;
ona gelen scalar komut durable row-missing conflict olur. Fiziksel kayıt silme
API'si yoktur. Retirement için head `retired:true` veya ayrı kalıcı
`collection-workspaces:<owner>:retirement` control kaydının varlığı okuma/yazmayı
engeller. Ayrı control kaydı eski head replay'ine karşı korunur; corrupt control
da erişime izin vermez. Yeni generation ile otomatik reactivation yoktur.

Aktif kaynak eksik/bozuk/retired olursa eski JSON veya generic native mirror
okunmaz. Kaynak seçimi/değişimi veya iki authoritative kaynağa yazım yoktur.
JSON fixture'da yalnız eski kaynağın değişmediğinin negatif kanıtıdır.

## Authority ve görünüm yayınlama sınırları

Root'un callback'i her çağrıda gerçek current session/owner/share view+edit
yetkisini çözmelidir. `actorId` client payload'ından seçilmez. Callback'e owner,
source generation, varsa client generation, transaction ID, actor ve phase
gider. Dönen owner/generation, varsa client generation tam eşleşmeli; canView
ve yazmada canEdit `true` olmalıdır. Revision-only permission cache veya client
flag kabul edilmez. Browser delta admission'ında captured session/view generation
zorunluluğunu root koymalı; legacy native komutta clientGeneration opsiyoneldir.

Commit phase'leri `prepare`, `pre-append`, `post-durable`; duplicate da bu
sınırlardan geçer. Refresh `refresh`, `pre-publish`, `post-refresh`; her read
ayrıca `read` çağırır. Pre-append denial append yapmaz. Post-durable denial
receipt/field içeriklerini saklar ve view readiness'i kaldırır; rollback iddia
etmez. İki farklı authority store ile native DB arasındaki revoke/write
linearizability root'un locking/epoch politikasıyla bağlanmalıdır.

View publish yalnız native dönüşten veya verified refresh/duplicate'tan sonra
olur. Native revision high-water ve lokal invalidation epoch'u gecikmiş eski
ACK'in yeni görünümü veya retirement/hata sınırını aşmasını engeller. Bu epoch
worker/process arasında ortak değildir. Senkron getter başka isolate'ın yeni
yazısını kendiliğinden görmez; root async admission/refresh yapmalıdır. Bir
ACK'in mevcut local view'ı güncellememesi, o transaction'ın diskte olmadığı
anlamına gelmez; `publication:'not-attempted'` hiçbir owner-share ACK'i değildir.

## Gerçek native kanıt

[validation.json](validation.json) final kaynak hash'lerini, komutları, ortamı,
zamanları ve exit code'ları içerir. Node v24.19.0 / Linux x64, ortak
`/tmp/buyerlog-performance-measurement.lock` altında, yalnız sentetik `/tmp`
köklerinde **85 PASS / 0 FAIL / 0 SKIP / 0 CANCEL**:

- 21 yeni test (11 source + 10 commit).
- Native27'nin 27 testinin bütün assertion'ları güncel gerçek `local-db.js`/shared policy üzerinde.
  Özgün paket ve source-pin'ler değişmedi. Yeni portable loader yalnız üç require
  locator'ını ve test adoption fixture'ındaki `workspaceKeys` alanını bağlar.
  Yeni modül codec'i eski test adı `readWorkspace` olarak yalnız fixture'da alias edilir.
- Mevcut WAL/tail/metadata/compaction/crash/business-integrity 32 test.
- i18n guard 5 test, ayrıca i18n check 0 yeni / 0 eski eksik; sekiz syntax check.

Gerçek crash testi iki ayrı child'ı `SIGKILL` ile durdurur: WAL write öncesinde
ne satır ne receipt replay olur; gerçek `handle.sync()` sonrası caller ACK'inden
önce ikisi birlikte replay olur. Soğuk servis aynı tx ID ile retry eder:
ilk durumda bir kez yazar, ikinci durumda verifier ile byte-identical duplicate
döner. Gerçek native lease dead-PID recovery kullanılır. Ek altı sentetik WAL
cut-point'i torn frame atomikliğini ve newline'sız tam frame'i kanıtlar.

Fsync gate sırasında `db.read()` optimistic yeni satırı görürken facade eski
immutable snapshot'ı verir. Gerçek dosya write sonrası injected sync EIO,
durability unknown bırakır ve view'ı kapatır; aynı tx retry'ı gerçek dosyaları
sync eden verifier olmadan durable başarı dönmez. Native27 lost-ACK, inverse
ABA, row/full CAS, authority, checksum corruption ve rotation assertion'ları
da korunur.

İlk missing-module RED logları ve [receipt/order RED](evidence/receipt-order-red.tap.gz)
ve [bozuk flag/receipt RED](evidence/corrupt-flags-receipt-red.tap.gz) korunur. İlk pipe tabanlı validator process exit'lerini gördü fakat child TAP
çıktısını toplayamadı; `evidence/validator-pipe-no-output.json.gz` **kabul kanıtı
değildir**. Final runner doğrudan dosya descriptor'ına yazar ve sıfır test/
skip/cancel durumunu başarı kabul etmez. Önceki ara GREEN logları final source
hash kanıtı yerine kullanılmaz.

Tekrar çalıştırma (repo kökünden):

```sh
flock /tmp/buyerlog-performance-measurement.lock node docs/performance-program/contrib-committed-source-20261108/validate.cjs
```

Power-loss/hardware, her syscall'da kill, snapshot rename/rotation kesintisi,
Windows/Electron lifecycle, SMB/mapped drive, old binary source fencing ve
cross-isolate ürün entegrasyonu doğrulanmadı. Tam regresyon/P1 review bu teslimde
koşulmadı. Gerçek DB/credential, benchmark veya uygulama hızlanma iddiası yoktur.

## Root'un bağlayacağı kesin noktalar

1. [Native adapter talebi](native-adapter-request.md): startup/refresh ve unknown
   receipt retry için production verifier. Fixture verifier ürün adapter'ı değildir.
2. `collection-workspaces.attachDeltaStore/loadWorkspace/listOwnerIds`: tek aktif
   kaynak registry'si; owner enumeration JSON union/fallback yapmamalı. Startup
   ayrı checked readiness + explicit canonical adoption/order descriptor; read
   admission `refresh`, sonra async `read` veya senkron current-authority callback
   ile `readSync(...).workspace`. Library otomatik owner discovery yapmaz.
3. `saveWorkspace/saveWorkspaceAsync/applyRowChangesAsync`: owner-file → DB lease
   sırası; uygunsa dar scalar komuta çeviri, mevcut row/full expectedRevision,
   existence/atomic/partial semantics korunmalı. Unsupported typed işlemler için
   ayrı tam planlayıcı gerekir; bu kütüphane aktivasyon gerekçesi değildir.
4. Mevcut `collection-save-worker`/client: aynı source/store-version gate,
   current authority ve source generation; worker ACK sonrası main kendi facade'ını
   verified refresh etmeden HTTP/owner publish yapmamalı. Yeni worker yok.
5. `replaceWorkspaceReplica`/`collection-replication`: mevcut full-envelope merge,
   full JSON checksum, ancestry ve owner access korunur. Root typed full replace
   planner'ı aynı frame'de changed rows + head/structure + explicit tombstone/receipt
   üretmeli. Bu katkı owner delta transport'u veya checkpoint protokolü değildir.
6. `server.js` startup/GET/publish/backup/restore ve sync recovery/image-clear
   yazarları: async durable facade/readiness; source switch öncesi eski yazarları
   drain/fence. Scalar receipt checklist/image/quotation/replication pending'ini
   temizleyemez. Ürün aktivasyonu yalnız Faz 6a kapanışı sonrası root'ta.
