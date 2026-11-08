# Faz 6c Koleksiyon istemci katkısı

Başlangıç: `d66c1f803097af5991616f0420392e1027888f2e`, dal:
`contrib/phase6c-client-delta-20261108`. Ürün entegrasyonu/etkinleştirmesi yoktur.
Faz 6a kapanışı ve root'un tek Faz 6c entegrasyon PR'ı beklenir.

EN: Portable, disconnected Collection command libraries derived from field19 and
group22. No UI, storage, HTTP execution, server authority switch, CP Tracker or
`/api/overrides` integration. Measurements concern module work only.

## Teslim ve semantik kapsam

`resources/app/public/collection-delta-commands.js` bağımsız alan komutlarını,
ortak legacy istek/ACK reducer'ını ve ACK ile ilerleyen inverse geçmişini sağlar.
`collection-group-delta.js`, gerçek `BLCollectionModelGroups.effectiveValue` ve
`fieldMetadata` okuyucularıyla kurulan tipli grup API'sidir. İki modül de
CommonJS ve bağımsız browser script olarak yüklenir; script yüklemek uygulamayı
etkinleştirmez. Browser sırası: önce delta, sonra group.

| Birim | Destek |
| --- | --- |
| `independent-row-fields` | Mevcut, bağımsız satırda `quantity` ve tanımlı düz metin `cx_*` alanları; bir komutta birden çok bağımsız alan |
| `collection.group-field-semantic-unit` | Normalize edilmiş çok üyeli grupta model kalıtımlı düz metin, checklist olmayan `cx_*`; `cell-edit`, `shared-value`, `set-override`, `make-override`, `clear-override` |
| Grup shared/override | Parent shared-map + bağlı materialized raw hücreler tek birim; explicit override'ın varlığı ve eski raw değeri aynen korunur |
| Inverse | Exact before/after own-property slotları; absent/null/false/0/blank ayrımı; unrelated raw/map alanları korunur; aynı alan/üyelik/şema uyuşmazlığı açık çatışma |
| Ortak oturum | Grup API'sinde `prepareFieldCommand` + `applyCommand`, alan ve grup komutlarını aynı ledger/geçmiş/istekte taşır |
| Legacy request | Yalnız seçilen komutların dokunduğu tam satırlar; accepted baseline üzerinden sıralı composition; row `_rev`, explicit existing/new beklentileri, `nextId`; structure/global revision eklenmez |
| ACK/history | Partial 200 yalnız applied satırları kabul eder; group içeren istek `atomic:true` ister; atomic eksik applied listesi de reddedilir; undo/redo yalnız primary ACK ile ilerler |
| Pending 1/2 | `capturePendingIntent`: owned/frozen kayıt; eski baseRows/baseStructure/baseRevision ve varlık niyeti korunur; yeni current source alınmaz |

Rich note/HTML ve aynı-PLM not yayılımı, finansal/fiyat/royalty/onay/türetilmiş
alanlar, dönem/bağımlı tarih, checklist, görsel, quotation yan etkileri,
satır create/delete/reorder, şema/yapı değişikliği, merge/split/detach ve gruplu
`quantity` desteklenmez. Bu birimler açık hata verir; scalar fallback yoktur.
JSON slot testleri, mevcut semantik editörün parsing/business validation
sorumluluğunu değiştirmez veya düz metin alanına yeni UI veri tipleri eklemez.

Owner/editable single-view/client-generation, row CAS, ilgili custom schema ve
grup closure/order/metadata kapıları korunur. Client guard bir yetki token'ı
değildir. Bütün kaynak referansları caller tarafından immutable kabul edilmelidir.
Initial JSON/normalization doğrulaması owner/source binding sırasında bir kez
yapılır; legacy normalizasyon gerektiren herhangi bir satır grup kaynağını reddeder.

Yeni değerler owned kopyadır. Yalnız değişen row/map nesneleri kopyalanır;
dokunulmayan satırlar, nested değerler ve bilinmeyen persisted anahtarlar korunur.
Row-array ve ID Map kopyaları hâlâ O(N) referans işi, ledger kopyası O(history)
işidir. Toplam işlemin O(değişen satır) olduğu iddia edilmez.

## Kullanım ve yaşam döngüsü

```js
const api = BLCollectionGroupDelta.createGroupCommandApi(BLCollectionModelGroups);
let state = api.createState({
  ownerId, clientGeneration, rows, baselineRows, customColumns, nextId,
  workspaceRevision, view: 'single', canEdit: true,
});
const unit = api.prepareGroupUnit(state, {
  kind: BLCollectionGroupDelta.KIND, operationId, action: 'cell-edit',
  rowId, key: 'cx_design', value: validatedEditorString,
});
state = api.applyCommand(state, unit); // pending; history.undo henüz değişmez
const capture = api.materializeLegacyRequest(state, [operationId], {
  requestId, atomic: true,
});
// Mevcut root transport'un primary response'u, aynı capture nesnesiyle:
state = api.acknowledgeLegacyResponse(state, capture, primaryResponse);
const inverse = api.prepareUndo(state, newOperationId);
state = api.applyCommand(state, inverse); // undo stack hâlâ önceki konumda
// Yeni request + primary ACK sonrası stack hareketi gerçekleşir.
```

`prepareInverseUnit` group22'nin saf applicability/inverse hazırlama primitive'i
olarak korunmuştur; ACK kanıtı veya history hareketi değildir. Ürün history yolu
`prepareUndo`/`prepareRedo` kullanmalıdır. Field `prepareInverseCommand` ayrıca
forward primary ACK ister. Her inverse yeni operation ID ve açık güncel CAS
taşır; eski pending komutun tabanını yenilemez.

Geçmiş intent sırasındadır; bağımsız satır ACK'leri ters sırada gelse de sırayı
bozmaz. Yeni yerel intent eski ACK ile temizlenmez; orijinal row base'i korunur,
stale ise yeniden materialize edilemez. Duplicate operation ve ACK aynı state'i
döndürür; farklı içerikle ID kullanımı/uyuşmayan receipt reddedilir. Lost ACK
durumunda success üretilmez. Sunucu retry'sinde CAS conflict alınması, primary
ACK yerine geçmez. `replication.ok` da primary ACK değildir.

History varsayılanı 50 entry / 1 MiB UTF-8 serialized command bütçesidir;
`historyLimits` ile ayarlanır. Bu, reachable undo/redo entry bütçesidir; JS heap
veya bütün ledger bütçesi değildir. Ledger ACK/replay kanıtını oturum sonuna
kadar korur; durable compaction burada yapılmaz. Request capture immutable ve
API instance'ına bağlıdır; serialize/rehydrate edilmiş kopya ACK için kabul
edilmez. Restart/durable request correlation bu katkının kapsamında değildir.

## Pending 1/2 güvenli devir

`capturePendingIntent(pending,{ownerId,clientGeneration})` fresh rows almaz.
Schema2 base satırları (silinmiş local row dahil), baseStructure string'i,
baseRevision, schema tanımları ve bilinmeyen alanlar owned capture'da kalır.
Schema1'de kanıtlanmamış creation existing sayılır; açık expected-new niyeti
korunur; çelişkili existing/new reddedilir. Absent `_rev` absent kalır.

Bu capture bir migration/replay veya persist edilmiş komut değildir.
`createState({pendingIntent: ...})`, `LEGACY_PENDING_REQUIRES_ADAPTER` ile
reddedilir. Pending bulunan workspace root'un mevcut pending restore yolunda
kalmalıdır; current fetched rows'u eski draft'ın yeni baseline'ı yaparak bu
API'ye sokmak yasaktır. Yeni field/group state yalnız yeni veya doğrulanmış
accepted kaynak içindir.

## Kanıt ve tekrar çalıştırma

Orijinal field19/group22 dosyaları, source-pin'ler ve native makbuzları değişmedi.
Yeni test kopyalarındaki bütün 41 assertion gövdesi korunur; yalnız import
locator'ları taşındı. Dedicated harness, frozen reference blob hash'lerini
doğrular. Ayrıca yeni actual fixture, başlangıç SHA'sındaki gerçek editor,
group setters/normalizer ve `kolPushUndo`/`kolSnapshot` fonksiyonlarını source
hash ve extraction sınırlarıyla çalıştırır. Ortak source-pin dosyaları değişmez.

- `evidence/red.tap`: yeni modüller yokken ilk RED.
- `prototype.red.txt.gz`: yeni lifecycle testlerinin değiştirilmemiş prototipler karşısındaki RED'i.
- `history-validation.red.txt`, `history-order.red.txt.gz`, `mixed-session.red.txt`, `source-json.red.txt`, `baseline-membership.red.txt`: davranışa özel RED makbuzları.
- `inherited-native.tap`: orijinal hazırlıkların 41/41 native PASS'i.
- `green.tap`: yeni dosyalardaki tam davranış sonuçları; legacy gerçek reducer, partial/atomic/lost ACK, browser UMD ve actual editor parity dahil.
- `collection-regression.initial.txt`: ilk hedefli koşunun çevresel `/home/agent/.buyer-log/write-recovery` hataları saklıdır. Veri kökleri açık sentetik `/tmp` alanına yönlendirilerek yeniden koşulur.
- `collection-regression.txt`, `i18n.txt`: son hedefli regresyon ve i18n sonuçları; i18n baseline `files:{}` kalır.

Nihai sonuç: 66/66 özel davranış testi, mevcut runner'da Koleksiyon + i18n
kapsamında 142/142 dosya PASS; i18n yeni/eski eksik 0/0. Ölçümler her kol için
ayrı Node sürecinde, aynı VM'de sırayla yapılır. `micro.shared-process.json`,
önceki kolun geç temizlenen VM context'i nedeniyle bir negatif heap farkı
gösteren eski denemedir; heap sonucu için kabul edilmez ve kanıt olarak saklanır.

Repo kökünden, aynı VM kilidiyle:

```sh
flock -n /tmp/buyerlog-performance-measurement.lock \
  node --test --test-isolation=none --test-reporter=tap resources/app/tests/collection-client-delta-*.test.js
flock -n /tmp/buyerlog-performance-measurement.lock \
  node --expose-gc docs/performance-program/contrib-client-delta-20261108/benchmark.cjs
```

Mevcut `npm test -- collection i18n-coverage-guard` için
`BUYER_LOG_SERVER_DATA_ROOT`, `BUYER_LOG_DATA_ROOT`, `BUYER_LOG_LOCAL_DATA_ROOT`,
`BUYER_LOG_CONFIG_PATH` ayrı, boş, sentetik `/tmp` köklerine atanır. `HOME`
değiştirilmez. `npm run i18n:check` de aynı kilitle çalıştırılır. Final tam
varsayılan `npm test`, root'un entegre Faz 6 kodunda zorunludur; burada faz
kapanışı veya uygulama genel regresyon kabulü iddia edilmez.

## Root entegrasyon kapıları

1. Faz 6a kapanışı; tek Faz 6c entegrasyon PR'ı ve son bağımsız P1 incelemesi.
   Bu katkıda PR/merge/TEST/STABLE/publish/etkinleştirme yapılmaz.
2. Gerçek editör dispatch ve parsing/validation; desteklenmeyen birimlerin eski
   doğrulanmış akışta kalması. Public loader, UI ve storage caller'ları root'undur.
3. Owner/source generation yaşam döngüsü, accepted baseline ve immutable raw
   source sahipliği. Grup source yeniden kurulması yeni certificate gerektirir;
   pending ledger base'leri hiçbir zaman otomatik yenilenmez.
4. **Commit anında şema/üyelik yarışı:** mevcut row PATCH, dokunulmayan grup
   üyelerinin revision/üyelik veya server custom-schema witness'ını taşımaz.
   Client closure kapıları server commit-time authority kanıtı değildir. Root
   server katkısıyla bu sınırı doğrulamalı; wire contract genişletmesi gerekirse
   root kararıyla yapılmalıdır. Burada protokol değişikliği yapılmadı.
5. Dayanıklı owner-bound journal/checkpoint, schema1/2 restore adapter'ı,
   restart/request correlation, byte bütçesi ve ledger compaction; local secured
   feedback ve primary ACK/publication ayrımı. Bu modüller bellek içindedir.
6. Gerçek HTTP/worker authority, owner replication/ancestry/old peer, crash,
   remote merge ve live UI kanıtları; görünür değişiklikte release-note/gerçek
   PNG ve entegre tüm batch'lerde full regression. Yeni actual fixture pin'leri
   root-owned source değişirse gerçek diff incelenmeden güncellenmemelidir.

Detaylı dönüşümlü ölçüm `evidence/micro.json` ve `MEASUREMENTS.md` içindedir.
