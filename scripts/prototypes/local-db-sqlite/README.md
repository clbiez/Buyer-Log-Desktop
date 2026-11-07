# Yerel DB deneyi / Local DB experiment

TR: Bu araç yalnız sentetik, cihazdaki yerel dosyalara yazar. Ürün kodunu, gerçek
DB'yi veya SMB klasörünü açmaz; migrasyon aracı değildir. Depo kökünden çalıştırın.

EN: This tool writes only synthetic device-local files. It never opens a live
database or an SMB folder and is not a migration tool. Run from the repository root.

```sh
# Electron 39.0.0: Node 22.20.0, SQLite 3.50.4; no npm dependencies.
ELECTRON_RUN_AS_NODE=1 /absolute/path/to/electron --test \
  scripts/prototypes/local-db-sqlite/prototype.test.cjs

# Do not run other tests/builds concurrently with measurements.
ELECTRON_RUN_AS_NODE=1 /absolute/path/to/electron --expose-gc \
  scripts/prototypes/local-db-sqlite/benchmark.cjs \
  --out docs/performance/local-db-sqlite-new-run

# Quick smoke run; still three alternating rounds.
node --expose-gc scripts/prototypes/local-db-sqlite/benchmark.cjs \
  --sizes 1000 --rounds 3 --operations 30 --out /tmp/local-db-smoke-new

node scripts/prototypes/local-db-sqlite/summarize.cjs \
  docs/performance/local-db-sqlite-new-run/raw.json
```

TR: `node:sqlite` içeren Node 22.20.0+ ile de çalışır. Node ve Electron aynı Node
sürümünü taşısa bile V8/ABI aynı değildir; yayımlanan ölçüm Electron'un kendisinde
alındı. Benchmark Linux içindir (`stat -f`, cgroup v2, SIGKILL). Windows sonuçları
ayrı ölçülmelidir. Çıktı klasörü önceden bulunmamalı, üst klasörü bulunmalıdır.

EN: Standalone Node 22.20.0+ with `node:sqlite` also works. Matching Node versions
do not imply matching V8/ABI; the published run uses Electron itself. The harness
targets Linux (`stat -f`, cgroup v2, SIGKILL). Windows needs separate measurement.
The output directory must be new and its parent must already exist.

TR: Her boyut için fikstürler gerçek `queuePatches` ile 10.000'lik gruplarda
oluşturulur; olayların %80'i `markSynced` ile yüklenmiş işaretlenir. Her koşu özel
bir kopya ve yeni süreç kullanır. 300 işlem: 150 tek kayıt okuma, 60 filtre,
30 `pending(100)`, 30 tek yazma ve 30 adet 20'li yazma; toplam 630 yeni olay.
Sıra L/S, S/L, L/S. Bellek sayacı veri üretimini içermez. OS önbelleği sıcaktır;
bu bir soğuk disk veya Electron arayüz açılış ölçümü değildir.

EN: Fixtures are created through real `queuePatches` in batches of 10,000, with
80% marked uploaded using `markSynced`. Every trial uses a private copy and fresh
process. The 300-operation trace has 150 point reads, 60 filters, 30 `pending(100)`,
30 single writes and 30 batches of 20: 630 new events. Order is L/S, S/L, L/S.
Memory excludes fixture creation. OS cache is warm; this is neither cold-disk
latency nor Electron UI startup.

TR: JSON tarafı gerçek `createLocalDb` kullanır; varsayılan WAL, lease, yedek ve
fsync davranışını değiştirmez. SQLite yerel patch alt kümesini uygular, kayıt ve
olayları JSON gövdeleriyle ayrı tablolarda tutar, filtre ve pending indeksleri
kullanır. Tüm uzak merge/yetki/senkronizasyon davranışlarını sağlamaz.
Checklist biçimli veriler sentetik kayıtlardır; mevcut checklist HTTP/depolama
yolunun uçtan uca ölçümü değildir. API alt kümesi uyumu testle sınanır.

EN: JSON uses the actual `createLocalDb` with default WAL limits, leases, backups
and fsync. SQLite implements the local patch subset, stores record/event JSON
bodies in separate tables, and indexes filters and pending events. It does not
implement all remote merges, permissions or synchronization. Checklist-shaped
values are synthetic records, not an end-to-end benchmark of the checklist HTTP
and storage path. Tests check the implemented API subset.

TR: `raw.json` her tamamlanan adımda kaydedilir. Başarısız koşu `validation=passed`
alamaz. Süreçler sırayla çalışır; geçici DB'ler `os.tmpdir()` altında araç tarafından
oluşturulup normal bitişte temizlenir. Zorla kapatma geçici dosya bırakabilir;
araç mevcut kullanıcı klasörlerini silmez. Ürün DB yolu parametresi yoktur.

EN: `raw.json` is saved after completed steps; a failed run never receives
`validation=passed`. Processes run serially. Databases are created under
`os.tmpdir()` and removed on normal completion; forced termination can leave
temporary files. The tool never deletes existing user directories and accepts
no product database path.
