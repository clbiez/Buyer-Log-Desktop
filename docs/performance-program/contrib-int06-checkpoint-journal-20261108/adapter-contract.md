# Root adapter sözleşmesi / adapter contract

TR: Bağımsız yardımcıdır; üretim entegrasyonu değildir. INT-06 açık kalır.
EN: Independent helper only; no production integration. INT-06 remains open.

## Sahiplik ve giriş / ownership and input

- `openCheckpointJournal({ root, initial, legacyFile?, snapshotEvery: 64 })`.
  `root` yalnız bir kullanıcı/refresh'e ait yeni format dizini olmalı; üst dizin
  önceden var olmalı. Çağıran mevcut sahiplik/lease yolu ile **tek yazarı** ve
  seri çağrıları sağlar; ikinci writer/worker/DB eklenmez. Aynı root'a ait eski
  instance yeniden açıldıktan sonra kullanılmaz. Yeni refresh yeni root kullanır.
- `initial`, mevcut `createDashboardRefreshManifest` çıktısıdır. Bir v1 checkpoint
  varsa ilk açılışta `legacyFile` ile alınır. Kimlikler ve terminal sayımlar/liste
  tutarlılığı doğrulanır; eski dosya değiştirilmez. Mevcut v2 snapshot otoritedir.
- Kaynak modülde normalize edilen satırlar ve kanonik sipariş kimlikleri korunur.
  Yardımcı satırları normalize etmez, transport çalıştırmaz, retry/split kararı vermez.
  Satır sırası, çokluk ve null değerleri JSON sınırında korunur.

## Batch ve ACK / batch and ACK

```js
const ack = journal.commit({
  seq: journal.sequence + 1,
  orderStates: { 'SYN-0000001': 'SUCCESS', 'SYN-0000002': 'NOT_FOUND' },
  rows: normalizedBatchRows,
  lastBatch: { orderCodes: batchCodes, error: null },
  updatedAt: new Date().toISOString(),
  retryPending: 0
});
// Only now publish progress or acknowledge this batch.
```

- Commit yalnız batch deltasını kopyalar/serileştirir. SUCCESS/NOT_FOUND/FAILED
  geçişleri önceki sayaç katkısını çıkarıp yenisini ekler. Yeni bir sequence ile
  açıkça yeniden işlenen batch'in satırları mevcut connector gibi append edilir;
  dedup sipariş koduna göre yapılmaz, çok satırlı siparişler korunur.
- Aynı sequence + aynı normalize JSON payload, snapshot/compaction sonrasında da
  replay ACK alır; satır/sayaç iki kez uygulanmaz. Aynı sequence farklı payload
  `CHECKPOINT_REPLAY_CONFLICT`; gelecekteki/sırasız yeni sequence
  `CHECKPOINT_SEQUENCE` verir. Sadece `seq <= current` olmak dedup için yeterli değildir.
- ACK `{seq, durable:true, replayed}` ancak append dosyası **fsync** olduktan sonra
  döner. İlk dosya/snapshot/rename girdileri de directory fsync gerektirir.
  Periyodik snapshot gerekiyorsa ACK onun tamamlanmasını da bekler. Bellek
  görünürlüğü/`commit:applied`/write/rename tek başına durable ACK değildir.
- **Her persistence hatasında refresh'i durdur.** Instance `CHECKPOINT_REOPEN_REQUIRED`
  durumuna geçer; son işlem diskte kalmış olabilir. Diskten yeniden aç, terminal
  durumları oku ve aynı sequence/payload ile replay et. Kaydı diskten okumadan
  remote batch'i yeniden çalıştırma veya yeni sequence tahmin etme.
- Mevcut connector checkpoint callback hatasını transport retry catch'i içinde
  yakalıyor. Root entegrasyonunda persistence hatası bu catch'ten ayrılmalı;
  yoksa başarılı remote yanıt tekrar istenebilir. Buradaki test adapter'ı yalnız
  doğruluk sınaması içindir ve production bağlama noktası olarak kopyalanmamalı.
- Split/retry sırasında yalnız nihai yaprak batch kaydedilir. İptalde bitmemiş
  batch terminal yapılmaz; boş `orderStates`/`rows`, son `lastBatch`, `retryPending:0`
  ile bir kontrol deltası yazılabilir. Continuation üç terminal durumu da atlar.

## Görünüm ve snapshot / views and snapshots

- `progress()` yalnız sequence, toplam/terminal sayaçları ve retryPending taşır.
  Üretimde progress'e tüm manifest/orderStates/rows kopyası eklenmemeli.
- `materialize()` tam v1 manifest + rows kopyasıdır; yalnız başlangıç continuation,
  final çıktı, explicit export ve periyodik snapshot sınırlarında kullanılmalı.
  Sıcak batch yolunda bugünkü `allRows.slice()` / `refreshManifestCounts()` /
  tüm `orderStates` kopyaları adapter tarafından kaldırılmalı; bu teslim bunlara dokunmaz.
- Varsayılan her 64 yeni committe ve explicit `compact()` çağrısında checksum'lu
  snapshot temp write → file fsync → rename → directory fsync sırasıyla yazılır.
  Sonra journal atomik boş dosyayla emekli edilir. Kesintide eski journal ile yeni
  snapshot birlikte bulunabilir; sequence+payload digest tekrar uygulamayı önler.
  Her periyodik snapshot tam kopyadır; toplam maliyetin tamamen doğrusal olduğu iddia edilmez.
- Newline'sız son journal parçası unacknowledged tail sayılır, fsync ile truncate
  edilir. Tam bozuk kayıt/checksum, bilinmeyen format/refresh veya sequence gap
  **fail closed** olur; tam bozuk kayıt atlanmaz ve kanıt dosyası korunur.
- Eski `durable-file-recovery.js` ve `user-data.js` incelendi. Genel yardımcının
  bazı fsync hatalarını best-effort sayması bu ACK sözleşmesine uymaz; burada
  yalnız checkpoint'e özel dar atomik değiştirme kullanılır. Sync hataları
  yutulmaz. Yeni genel WAL/DB/worker veya bağımsız lease mekanizması kurulmadı.

## Geri dönüş / rollback

1. Root koordinatörü yeni writer/refresh'i durdurur ve aynı sahiplik kilidini tutar.
2. Sağlam v2'yi diskten açar; `exportLegacy(oldStore.file)` çağırır. Tam güncel v1
   JSON temp write/fsync/rename/directory fsync ile yayımlanır. Başarılı dönüş
   `{seq,durable:true,file}` verir. Eski native store bu dosyayı doğrudan okuyabilir.
3. Writer kapalı tutulur ve eski sürüm yalnız bu export üzerinden devam eder.
   Export helper'ı bir uygulama sürümü kilidi değildir; bu koordinasyon adapter'a aittir.
4. Hasarlı/bilinmeyen v2'de otomatik eski/stale v1'e dönülmez. Hata ve dosyalar
   korunur; doğrulanmış recovery veya açık yeni refresh kararı gerekir. İlk v2
   committen önce capability/fsync uygun değilse eski yol seçilebilir. Daha yeni
   v2 commitlerden sonra eski dosyaya sessiz fallback veri kaybı olur.

EN: The caller owns a single serialized writer and refresh-specific directory.
Only normalized terminal deltas enter commit; publish progress after durable ACK.
Persistence failures stop the refresh and require disk recovery before retry.
Use full materialization only for continuation/final/snapshots. Rollback requires
stopping the v2 writer under the existing ownership lock and exporting a current,
durable v1 file. Never silently fall back to a stale legacy file on v2 corruption.

Linux/local-fs SIGKILL recovery is tested. Windows/Electron/SMB and actual power
loss are untested. Durability assumes the filesystem/device honors file and
directory fsync; unsupported sync errors do not receive ACK.
