# INT-06 dar patch / API devri

Bu katkı üretime bağlı değildir; INT-06 açık kalır. RSS kabul kararı için aynı
kohortun sonuçları `README.md` ve `cohort/100000-steady-summary.json` içindedir.
Bağımsız P1 incelemesi, entegre tam regresyon ve aktivasyon ana sohbete aittir.

## Uygulanabilir patch

- Sabit girdi: `392cc5574464690423e6e9cf6f9031549bae6188`.
- Kod/test/harness commit: `4e66c955e51e01ac84a0e799d5e1c491008f6393`.
- Ana dalın görev başlangıcı: `1796193f0a57c7785e7bf9fdb3557e33c550b25e`.
- Yalnız helper farkı: `scripts/prototypes/int06-bounded-snapshot-20261108/helper-only.patch`.
  Bu patch teslimdeki mevcut helper üzerine uygulanır; main'e helper kurulumu veya
  üretim bağlama patch'i değildir. Aday helper üzerinde reverse apply check geçti.
- Public API değişmedi: `openCheckpointJournal`, `sequence`, `progress`, `commit`,
  `compact`, `materialize`, `exportLegacy`, `readLegacyCheckpoint` ve FORMAT=2.
- Tek aday: `writeSnapshotEnvelope(file, payload)` tam payload string'ini hash'ler;
  64 Ki UTF-16 birimlik parçaları JSON string olarak escape edip UTF-8'e çevirir.
  Geçerli surrogate çifti parça sınırında ayrılmaz. Yazım kısa kalırsa devam eder;
  sıfır ilerleme EIO olur. Tek temp descriptor'ü wx/0600 açar ve kapatır.
- `atomicReplace` özel bir temp-writer callback kabul eder. Snapshot bu callback'i
  kullanır. Commit journal/retirement ve v1 export eski yoldadır.
- Tam gövde bitmeden snapshot:written yoktur. File fsync → rename → directory fsync
  ve bunlardan sonra retirement/ACK sırası değişmedi. Hata compact/commit instance'ını
  zehirler; çağıran diskten açıp aynı sequence/payload'ı replay etmelidir.

## Kanıt ve sınır

Byte eşitliği eski `JSON.stringify({payload,sha256}) + newline` referansıyla init,
periodic ve explicit snapshot için sınandı. Unicode, kontroller, lone surrogate,
parça sınırındaki emoji, SUCCESS/NOT_FOUND/FAILED ve çok satırlı order korunur.
Yeni testler ayrıca short write, EIO/zero-progress ve snapshot gövdesinde gerçek
SIGKILL sonrası disk-only recovery/receipt replay'i kapsar. Mevcut testler,
fsync/hook crash aşamaları, partial tail, duplicate replay, split/retry, iptal,
v1 migration/export ve corruption fail-closed kontrolleri değiştirilmedi.

64 Ki parçalama **tek encoding scratch tahsisini** sınırlar; toplam RSS'i veya
GC bekleyen tahsislerin toplamını sınırlamaz. Payload hâlâ O(n) ve tek string'dir.
Aynı format ve aynı byte toplamı korunur; yazım/parse azalması bellek kazanımı
olarak sayılmaz. Eski ölçüm observer'ı descriptor yazımlarını görmez; bu nedenle
`after-diagnostic-replay.json` içindeki checkpointBytes eksiktir ve ölçüm kabulü
olarak kullanılmaz. Yeni observer'ın nested/direct write sayımı ayrı testlidir.

## Kalan teknik engel ve sonraki işin kesin sınırı

`snapshot()` hâlâ `manifestView()` uyumluluk listelerini/referans rows dizisini
kurup tam payload JSON string'ini üretmeden yazıcıya geçemez. Son 100k snapshot'ta
payload 28.846.686 UTF-16 karakterdir; V8'in iki byte temsili tek başına yaklaşık
55 MiB eder. Bu string'in stringify/hash yaşam döngüsü ve GC bekleyen parçalar
RSS tepesini büyütebilir. Owned state, fixture/trace, known-order yapıları da
aynı süreçte kalır. Reopen/materialize/export tepe belleği bu adayın hedefi değildir.

Bu teslimde ikinci bir serializer/aday döngüsü denenmedi. Sonraki iş için somut
API sınırı, private yazıcının `payload: string` girdisidir. Tam payload tahsisini
kaldıracak ayrı bir aday bu sınırı deterministik payload-chunk üreticisine
çevirmeyi gerektirir: aynı UTF-8 byte akışı hash'e ve escaped zarf yazımına
beslenmeli; property/array sırası, JSON sayıları/escape/Unicode, hash, kısa yazım,
fsync ve hata/replay sözleşmesi aynı RED→GREEN kanıtlarıyla korunmalıdır. Bu bir
uygulanmış veya kazanımı kanıtlanmış öneri değildir. Mevcut patch RSS kabulünden
geçmeden entegrasyona hazır sayılmaz.

PR/merge/rebase/force-push/bağımsız review ve TEST/STABLE işlemi yapılmadı.
