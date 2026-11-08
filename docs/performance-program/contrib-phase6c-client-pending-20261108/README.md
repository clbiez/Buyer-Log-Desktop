# Faz 6c — owner-bound pending/journal adayı

Başlangıç: `prep/phase6a-wiring-handoff-20261108`,
`ea49389836dba23f0970a974b4c0185f1b36ec0e`.
Dal: `contrib/phase6c-client-pending-20261108`.
Özgün delta katkısı `2d95db6d4a1e51ad28cb791aeaf4e6d67649176a`, normal
cherry-pick karşılığı `83e93fd2`. Özgün author/message, modüller ve bütün kanıt
dosyaları korunur. Delta/group yeniden üretilmedi veya değiştirilmedi.

EN: Inactive owner-bound Storage journal candidate. No application wiring,
database migration, production format activation, server authority claim,
release, PR or independent review. Storage API success is not physical fsync.

## Davranış ve kapsam

`resources/app/public/collection-delta-pending-journal.js` CommonJS ve bağımsız
browser script olarak çalışır. Script yüklenirken storage/DOM/network okunmaz.
Tarayıcıda önce delta modülü yüklenir; grup API'si kullanılacaksa mevcut grup
modülü ve gerçek model-group resolver ayrıca enjekte edilir.

- Synchronous `getItem`/`setItem` Storage ve `getCurrent` dışarıdan gelir.
  `getCurrent` owner, canlı client generation, source ID, editability ve single
  view döndürür. Async storage enjekte etmek `SYNCHRONOUS_STORAGE_REQUIRED`
  hatasıdır; Promise tamamlanmadan başarı bildirilmez.
- `record` hem event hem head yazımı başarıyla döndükten sonra
  `localRecorded:true, storageGuarantee:'storage-api-success'` döndürür.
  Hata halinde edit güvenceye alınmış sayılmaz. Başarısız event/head yazımı
  önceki committed head/state/history'yi değiştirmez.
- Kabul edilmiş başlangıç grafiği bir kez owned binding'e yazılır. Edit kaydı
  yalnız komut, dokunulan eski taban satırları ve zincir bilgisi taşır.
  Checkpoint yalnız değişen current/baseline satırlarını, sınırlı operations,
  history ve request capture'larını içerir. Edit/compaction 30k grafiği yeniden
  serialize etmez. Mevcut delta API'sinin O(N) row-array/lookup işi devam eder.
- `prepareRequest` istek kimliğini ve dokunulan closure'ın özgün kaynaklarını
  yerelde kaydeder; bundan sonra runtime delivery capture döndürür.
  `retry` aynı request/operation ID ve aynı payload'ı yeniden kullanır.
  Request ID farklı komut/atomic seçeneğiyle kullanılamaz.
- `acknowledgePrimary` önce mevcut delta/group reducer'ıyla receipt'i doğrular;
  sonraki state/history'yi yalnız ACK journal kaydı ve head yazımı sonrasında
  yayınlar. Yerel yazım hatasında exception `primaryAcknowledged:true` ve
  `localRecorded:false` taşır; history ilerlemez. Head gerçekten yazıldıktan
  hemen sonra kaynak değişirse exception `localRecorded:true` bilgisini korur,
  yeni görünüme başarılı dönüş vermez.
- `noteReplication` advisory sonuçtur; primary ACK veya history hareketi
  üretmez. Replication başarısı ve başarısızlığı primary receipt yerine geçmez.
- Reopen, immutable binding + bounded checkpoint/tail ile özgün source'u kurar.
  Yeni remote veri parametresi yoktur. Eski komutun revision, presence slotları,
  grup closure, operation/request kimlikleri ve inverse bilgisi korunur.
  `open().route` açıkça `candidate-original-source` döner; bu, taze remote ile
  birleştirilmiş ürün görünümü değildir.
- Canlı generation/source yeni olabilir; `status().origin` ile `current` ayrı
  tutulur. Saklanan komutun generation'ı değiştirilmez. Yeni runtime yalnız
  kendi `retry`/`prepareRequest` delivery nesnelerini kabul eder; eski runtime,
  owner, generation veya source'un ACK capture'ı reddedilir.

Destek sınırı mevcut field/group API'sidir: bağımsız mevcut satırda quantity ve
onaylı düz metin custom alan; tipli grupta mevcut API'nin onayladığı düz metin
shared/override birimleri. Rich HTML/not, finansal/türetilmiş alan, checklist,
görsel, gruplu quantity, create/delete ve yapı değişimi için scalar fallback
yoktur. Legacy arşivinde bu verilerin bulunması, yeni edit desteği vermez.
İstemci doğrulaması sunucu commit-time şema/üyelik/authority kanıtı değildir.

## Sınırlı retention ve checkpoint

Varsayılanlar: 256 operation, 256 request, 1024 overlay satırı, 1024 event,
32 checkpoint; event 256 KiB, checkpoint 2 MiB, toplam committed event/checkpoint
değeri 4 MiB, binding 16 MiB, tek legacy arşivi 16 MiB. UTF-8 serialized value
bütçeleridir; storage'ın origin quota'sı daha önce dolabilir. Key/head overhead'i
ve engine heap'i bu byte admission bütçesinin dışında, ölçümde ayrıca yer alır.
Sınır aşılınca yeni edit/istek reddedilir; eski pending/history silinmez.

Her 32 event sonrasında sonraki append öncesinde otomatik checkpoint alınır;
`compact()` ayrıca çağrılabilir. Bu adayın compaction'ı bounded overlay snapshot
ile restore tail'ini kısaltır. **Disk alanı geri kazanmaz.** Base, eski event,
checkpoint, legacy pending ve arşivler silinmez; başarılı veya yarım compaction
eski recovery kanıtını korur. Yeni checkpoint/head hatasında eski head açılır.
Manifest/cp/base checksum ve event zinciri rastlantısal bozulmayı saptar;
kriptografik authenticity veya authority sağlamaz.

Quota, eksik committed kayıt, bozuk JSON/checksum/chain veya bilinmeyen sürüm
hatası otomatik legacy fallback yapmaz. Hatalı head'in yerine daha eski bir
checkpoint'i sessizce açarak son güvenceye alınmış edit kaybedilmez. Recovery
kararı ve alan geri kazanma politikası root'a aittir. Bound aşınca otomatik
pruning/rebind yapmamak bilinçli veri koruma tercihidir; sınırsız oturum desteği
iddia edilmez. Başarısız bind'in orphan binding'i de otomatik silinmez.

## Schema 1/2 ve açık uyumluluk blocker'ı

`archiveLegacy(raw,{archiveId})`, gerçek `capturePendingIntent` ile schema1/2'yi
doğrular ve **raw metni aynen** ayrı aday arşivinde tutar. Özgün pending key'e
yazılmaz/silinmez; arşiv owner başına tektir. Owner mismatch, bozuk JSON, yeni
schemaVersion veya bilinmeyen gömülü candidate sürümü reddedilir. BaseRows,
baseStructure, baseRevision, beklenen existing/new niyeti, absent `_rev`, deletion
tabanları ve bilinmeyen uzantılar korunur. `exportArchivedLegacy` birebir raw
metni verir. Bu yol `legacy-only` döner; delta state'i oluşturmaz.

**BLOCKER:** Legacy tam-satır draft'ından bütün semantik edit birimlerini,
operation/request kimliklerini, inverse sırasını ve onay geçmişini çıkarmak
kanıtlanamaz. Schema1 ayrıca özgün baseRows/baseStructure'ı kanıtlayamaz.
Bu nedenle otomatik legacy→delta import uygulanmaz. Legacy pending bulunan
slotta `bindAccepted` reddedilir. Root mevcut legacy restore yolunu korumalı ve
kimlik/geçmiş kaybını engelleyen ayrı geçiş kararı vermelidir.

Native oturumda `exportLegacy({schemaVersion:1|2})` yalnız owned JSON döndürür;
production key'e yazmaz. Aktif pending satırın eski `_rev`'i ve schema2 baseRows'u
korunur; önceki ACK, daha yeni pending editin CAS tabanını yenileyemez. Özgün
baseStructure/baseRevision korunur. `candidateJournal` uzantısı operation,
request, history ve inverse verisini taşır. Mevcut legacy reader bu uzantıyı
işlemez: legacy görünüm/CAS köprüsü gösterilmiştir, eksiksiz delta/history
migration veya şeffaf rollback aktivasyonu iddia edilmez. Bilinmeyen yeni
journal sürümünü legacy'ye çevirmek yasaktır.

## Kullanım örneği — yalnız host adapter sözleşmesi

```js
const adapter = BLCollectionDeltaPendingJournal.createPendingJournal({
  storage: BLCollectionDeltaPendingJournal.createWebStorage(localStorage),
  api: certifiedFieldOrGroupApi,
  legacyKey: rootLegacyPendingKey(ownerId),
  getCurrent: () => ({ ownerId, clientGeneration, sourceId,
    canEdit, view: workspaceMode }),
});
adapter.bindAccepted({ bindingId, rows, customColumns, workspaceRevision,
  nextId, baseStructure, metadata });
// Var olan bir aday slotunda bunun yerine adapter.open().
const command = certifiedFieldOrGroupApi.prepareFieldCommand(
  adapter.getState(), validatedSpec);
const local = adapter.record(command); // UI ancak bundan sonra secured olabilir.
const delivery = adapter.prepareRequest([command.operationId], { requestId });
// Root HTTP çağrısı + gerçek primary receipt; advisory replication ayrı.
adapter.acknowledgePrimary(delivery, primaryResponse);
```

`getState` borrowed immutable source/command sözleşmesini devralır. Caller bu
nesneleri, Map'leri ve satırları yerinde değiştiremez. Adapter ağ çağrısı yapmaz.
Yerel başarıyı fsync, elektrik kesintisi dayanıklılığı veya server commit'i diye
sunacak UI/metin eklenmedi; görünür ürün değişikliği/release note yoktur.

## Gerçek kaynak karşılaştırması

`source-comparison.json` ve `source-audit.cjs` sabit başlangıç source'unu ve
`kolPersistPendingWorkspace`, `kolReadPendingWorkspace`,
`kolMergePendingWorkspace`, `kolRestorePendingWorkspace`, `saveKolRows`
gövdelerini hash/konum ile kaydeder. `collection-delta-pending-source.test.js`
gerçek fonksiyonları sentetik fixture'da çalıştırır.

| Gerçek kaynak | Gözlenen sınır / adayın farkı |
| --- | --- |
| `kolPersistPendingWorkspace` | Her seferinde rows + schema2 baseRows tam JSON; quota sonrası false, feedback başarısız. Aday per-edit bounded event yazar. |
| `kolReadPendingWorkspace` | JSON/storage hatasını null yapar; yeni version kontrolü yok. Aday hatayı ve bilinmeyen sürümü açık bırakır. |
| `kolMergePendingWorkspace` | Schema2 eski edited row base'ini korur; schema1 creation kanıtı yoksa existing niyeti. Aday legacy export testinde taze `_rev:90` ile eski `_rev:4`'ün kaldığını doğrular. |
| `kolRestorePendingWorkspace` | Owner/rows/editable guard'ı ve ürün restore/normalize/render/clear yan etkileri var. Aday bu akışa bağlanmaz, hiçbir legacy kaydı temizlemez. |
| `saveKolRows` | Global rows ve workspace cache'i serialize eder; pending false dönüşünü yok sayıp true dönebilir. Root entegrasyonunda sonuç kapısı gerekir; bu dosya değiştirilmedi. |
| `capturePendingIntent` | Schema1/2 owned capture, özgün base ve conservative existence; archive gerçek API'yi kullanır. |
| Primary ACK/history | Mevcut reducer receipt/atomic/partial/order kapıları korunur; aday bunlara yerel ACK kaydı kapısı ekler. |

## Doğrulama ve teslim sınırı

- `evidence/red.tap`: modül yokken ilk RED; `edge-cases.red.tap.gz`: davranışa özel
  28 PASS / 2 FAIL; GREEN'de aynı assertion'lar korunur.
  `source-audit.red.txt.gz`, audit script'indeki VM Array prototype kıyas
  hatasını korur; owned JSON kıyasıyla düzeltildi, kaynak/hash koşulları değişmedi.
- `green.tap`: 30/30 aday testi; gerçek kalıcı Node Web Storage ayrı süreçte
  ACK, quota, missing, corrupt ve half-compaction testleri dahil.
- `browser-storage.json`: gerçek Chromium localStorage; beş failure/reload
  vakası. Eski legacy key ve base korunur; fsync/power-loss testi değildir.
- `native-41.tap`: orijinal native 41/41 PASS; kaynak/assertion değişmedi.
- `inherited.tap`: devralınan pakette 63 PASS / 1 dosya FAIL. Eski
  `actual-editor` whole-file app-main pin'i sabit başlangıçtan farklıdır.
  `source-comparison.json` ilgili 13 fonksiyonun ve diğer beş pinned dosyanın
  değişmediğini kanıtlar; mevcut pin güncellenmedi. Üç actual test yüklenemedi.
- `collection-regression.txt`: collection + i18n guard runner sonucu ve aynı
  pin blocker'ı korunur: 147 dosyada 869 PASS / 1 FAIL; tamamına yeşil denmez. Ayrı `i18n.txt` yeni/eski eksik
  0/0, baseline `files:{}` kalır.
- `MEASUREMENTS.md`: 30k satır, 10/100 edit, üç dönüşümlü çift; initial ve son
  ölçümler saklıdır. Yalnız modül/Storage API işi ölçülür.

PR, merge, rebase/force-push, bağımsız reviewer, final tüm-app regresyonu ve
TEST/STABLE bu katkıda yapılmaz. Root'un tek Faz 6c entegrasyon turuna bırakılır.

## Root'tan somut adapter talepleri / aktivasyon kapıları

1. `saveKolRows` ve gerçek editör dispatch'i için yerel sonuç kapısı: command
   record + request record başarısını bekle; başarısızlıkta secured toast verme.
   Desteklenmeyen semantik birimi scalar'a indirme. Mevcut full serializer'ları
   kaldırmadan bu ölçümü ürünün toplam kazancı diye kullanma.
2. Gerçek owner/source/generation lifecycle ve immutable certified source
   sahipliği. Restore edilmiş özgün source'u taze remote görünümü sanma;
   ayrı reconciliation ve UI kabulü gerekir. Pending base'i güncel remote'a
   sessizce taşımak yasaktır.
3. Aynı owner slotunda **tek writer** garantisi. Head karşılaştırması stale
   writer'ı yakalar; localStorage read-compare-write cross-tab atomic CAS
   değildir. Root Web Lock/host serialization/lifecycle düzenini sağlamalıdır.
4. HTTP correlation: delivery capture canlı binding'e bağlı kalmalı. Restart'ta
   `retry(requestId)` kullanılmalı; serialized request nesnesi doğrudan ACK
   reducer'ına verilmemeli. Legacy server payload operation/request dedup veya
   receipt lookup sağlamaz: lost-ACK retry CAS conflict'i ACK sayılamaz.
   Root server katkısı özgün primary receipt'i nasıl geri alacağını çözmelidir.
5. Yerel ACK kaydı hatasını primary commit başarısızlığı diye yeniden adlandırma.
   Pending/history korunur; aynı request ve **özgün** doğrulanmış receipt yerel
   kayda tekrar alınabilir. Replication feedback/history bağımsız tutulmalı.
6. Schema1/2 legacy-only blocker'ı, candidateJournal uzantısının reader desteği,
   bounded retention dolduğunda kullanıcı işi kaybetmeyen recovery/export ve
   garbage collection politikası çözülmeden production format aktivasyonu yok.
   Yeni IndexedDB/DB migration bu katkıda yoktur.
7. Commit-time server şema/üyelik/authority kanıtı ve atomic group sözleşmesi;
   client guard bunun yerine geçmez. Ağ/çok cihaz/replication crash kabulü root'ta.
8. `resources/app/tests/fixtures/collection-client-delta/actual-source-pins.json`
   için eski app-main blob `26bda8b7…` → başlangıç blob `9947d093…`
   değişimini root kapsamı içinde incele. İlgili 13 fonksiyon birebir aynı;
   test/pin burada değiştirilmedi. Ardından actual üç regresyonu yeniden çalıştır.
9. Faz 6a kapanışı, tek Faz 6c entegrasyonu, final tam regresyon ve tek P1
   incelemesi; görünür ürün değişikliğinde gerçek TR/EN UI/release kabulü.

## Tekrar çalıştırma

Repo kökünden, aynı VM üzerinde; kilit dosyası silinmez:

```sh
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  node --test --test-concurrency=1 --test-reporter=tap resources/app/tests/collection-delta-pending-*.test.js
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  node docs/performance-program/contrib-phase6c-client-pending-20261108/source-audit.cjs --check
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  node docs/performance-program/contrib-phase6c-client-pending-20261108/browser-storage.cjs
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  node docs/performance-program/contrib-phase6c-client-pending-20261108/benchmark.cjs
```

Node Web Storage kabul/ölçümü bu ortamda Node 24.19.0 ile yapıldı. Browser script'i
kurulu Playwright için `BUYER_LOG_PLAYWRIGHT_MODULE`, Chromium için
`BUYER_LOG_CHROMIUM` override'ını kabul eder; bu ortamda
`/workspace/.buyerlog-tools/node_modules/playwright` ve `/usr/bin/chromium`
kullanıldı. Product dependency/lockfile değiştirilmedi. Worktree testleri mevcut
checkout dependency'lerini read-only `NODE_PATH` ile kullandı. Collection runner
için dört `BUYER_LOG_*_DATA_ROOT/CONFIG_PATH` sentetik, ayrı `/tmp` köklerine
atandı; `HOME` değişmedi. İlgili testler/ölçümler aynı flock altında seri koştu.
