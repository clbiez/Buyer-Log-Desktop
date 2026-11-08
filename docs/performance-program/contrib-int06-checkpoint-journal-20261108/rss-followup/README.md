# INT-06 RSS takip tanısı — 100k steady

TR: Üretime bağlanmamış yardımcının dar RSS tanısıdır. Snapshot'ın gereksiz tam
manifest kopyası kaldırıldı; kalan serialize/yazma tamponları ve GC etkisi
kanıtlarla ayrıldı. Üretim kabulü ve tam regresyon root'tadır. INT-06 açık.

EN: Narrow RSS diagnosis of the unintegrated helper. Removes the redundant
snapshot manifest clone; separates retained graphs, temporary serialization
buffers and GC effects. Production acceptance and full regression remain with
root. INT-06 remains open; no memory regression is implicitly accepted.

- Korunan teslim: `9e966b1fcbe6974b60def70503aae13ff56c7319` (ancestor).
- Düzeltme/ölçüm kaynağı: `cea34c01c8b8eb55e952a76543df107e29aa5a30`.
- Önceki yardımcı SHA-256: `ff2ed4b246650a27c7b1a5e59f7efa3de821820df2a2c60e6e5dc43d79f0f4bf`.
- Yeni yardımcı SHA-256: `02ef57c024a19d33f4f3b52ceff09ce03d7f513e639bc344461a48b8b5a60886`.
- `measure.cjs` değişmedi: `523265979266ee9625ca4478a13afd9f99d53a0eb1e51664b2773fdf21a544df`.

## Tanı / diagnosis

**[Doğrulandı] Artışın ana mekanizması periyodik/final snapshot sırasında
eşzamanlı yaşayan tam graph kopyası, JSON payload/zarf string'leri ve yazma
tamponlarıdır; GC bunların ömrünü ve RSS tepesini belirgin etkiler.** Önceki
471,69 → 657,78 MiB medyan farkını byte byte bileşenlere toplamsal dağıtmak
mümkün değildir: o örneklerde aşama profili yoktur ve RSS, yaşayan heap toplamı
değildir. Yeni profiller mekanizmayı ve ortadan kaldırılan tahsisi kanıtlar;
tarihsel tepenin tam zamanını sonradan kanıtlamaz.

Kanıt [diagnostic-summary.json](diagnostic-summary.json), ham aşama JSON'ları,
GC logları ve `diagnostics/*.heap-sampling.json` içindedir. Aşağıdaki değerler
**yalnız tanıdır**: `before-gc-sampling` / `after-gc-sampling`, tam GC sonrası
yaşayan heap ve son snapshot çevresindeki gözlemler. Bunlar kabul RSS/süre
sonuçları değildir. Heap sampling 16 KiB istatistiksel örneklemedir; tam census
veya dominator/retainer analizi değildir. Tanılar uygulama commitinden önce
çalıştı: JSON'lardaki `revision=9e966b1f` tek başına o dirty çalışma ağacının
kimliği değildir; before/after kaynaklarını yukarıdaki ayrı helper SHA-256'ları
sabitler. Profilsiz kabul örnekleri ise commit edilmiş `cea34c01` kaynağındadır.

| Bileşen | Ayrıştıran kanıt | Sonuç |
| --- | --- | --- |
| Fixture / trace | Helper açılmadan, trace hazırken tam GC sonrası 46,72 MiB heap. Sampling'de fixture rows üretimi ~21,00 MiB, trace `fromEntries` state nesneleri ~13,99 MiB. | İki kolda ortak başlangıç grafiği; helper'a ait bellek diye sayılmaz. Trace hash serialize'ı da süreç high-water değerine dahildir. |
| Oracle | `oracleCreatedAtPeakBoundary=false`; `oracle:first-access`, ölçümdeki `maxRSS` alımından sonraki `load()` / `assertEquivalent()` sırasında. Fixture kaynağındaki `expected` getter'ı lazy. | Oracle graph'ı bu ölçülen artışa girmez. Profilin load/oracle sonrası tepesi kabul RSS'sine taşınmaz. |
| Journal belleği | GC sonrası init 59,89 MiB, 400 commit sonunda 91,49 MiB heap; final compact sonrası 91,52 MiB. Sampling'de commit delta `clone` parse tahsisleri ~28,51 MiB, `apply` state nesnesi ~6,00 MiB; ek code/known/base yapıları var. | Journal owned rows/state grafiğini trace'ten ayrı tutar; O(n) yaşayan bellek gerçektir. Compaction bu API'nin final/export için sakladığı graph'ı boşaltmaz. 400 digest receipt ve delta başına geçici encoding, tüm journal dosyasının heap'te saklanmasıyla karıştırılmaz. |
| Snapshot hazırlığı | Son snapshot öncesi heap 91,49 → ilk full-graph stringify öncesi 127,95 MiB; kaynakta rows referans dizisi, `remainingOrders` identity filtresi, `Object.entries(states)` / failed listesi. Eski `materialize` roundtrip'inde 28.817.529 karakter manifest string'i ve parse adımında ayrıca +41,22 MiB heap. | Compatibility listeleri/taramalar ve referans dizisi hâlâ var. Gereksiz stringify/parse roundtrip'i, ikinci rows/state grafiğiyle birlikte kaldırıldı. |
| Serialize / yazma | Yeni yolda da payload 28.846.686 karakter, checksum zarfı 32.391.000 karakter (+ newline). Son snapshot'ta zarf stringify adımı ~61,81 MiB heap; `writeFileSync` sırasında ~61,81 MiB ek heap ve ~31,67 MiB external/UTF-8 tampon artışı. | Parse'ın kaldırılması tüm O(n) snapshot tamponlarını kaldırmaz. Büyük iki-byte V8 string'leri, newline/flatten ve UTF-8 encoding eşzamanlı maliyet üretir. Gözlemler Node 24'e aittir; karakter sayısı byte veya fiziksel I/O değildir. |
| GC / RSS | Eski son snapshot: heap 319,19 → 91,52 MiB, RSS 535,00 → 314,92 MiB (tanı GC'si). Yeni yaşayan heap de ~91 MiB. `--trace-gc` ve aşama GC olayları raw log/JSON'da. | Büyük transient tahsisler toplanabiliyor; RSS, heapTotal/allocator sayfalarını ve eski high-water değerini koruyabilir. Bu izler tek başına leak kanıtı değildir; uzun süreli refresh leak testi de yapılmadı. |

**[Doğrulandı]** Sampling'in `getSamplingProfile` çağrısı da GC tetikleyebilir
(GC logunda `sampling profiler`). Bu yüzden forced-GC/sampling koşularının
düşük tepeleri kazanç olarak kullanılmaz. Sampling'siz `before-phase` ve
`after-phase` tanıları da JSON/FS probu ve `--trace-gc` içerir; onlar da profilsiz
kabul kohortuyla birleştirilmez. GC araya girdiğinde komşu heap/RSS farkları
saf allocation boyutu değildir; tablodaki farklar gözlenen aşama değişimleridir.

## Küçük düzeltme ve RED → GREEN

Yalnız `power-bi-checkpoint-journal.js` içinde özel `manifestView()` senkron
snapshot serialization'a owned state referanslarını verir. `materialize()`
dış çağrı için aynı view'ı deep clone eder. Commit girdisinin ownership clone'u,
counter/delta ve sequence/replay denetimi, checksum zarfı, fsync/ACK sırası,
poison/reopen davranışı ve v1 export aynı kalır. Hiçbir üretim çağrısı eklenmedi.

- [red-snapshot-copy.tap](red-snapshot-copy.tap): yeni test eski yardımcıda
  periodic + explicit snapshot sırasında iki full-graph parse yakalar: **2 ≠ 0**.
- [green-unit.tap](green-unit.tap): **9/9 PASS**. Aynı test parse sayısını sıfır
  doğrular; dış materialize sonucunun nested rows, state, order code ve lastBatch
  alanlarını mutasyona uğratıp iç/disk state'inin değişmediğini de doğrular.
- [native.tap](native.tap): eski **101 native + 17 devralınan test** değişmeden
  korundu; yeni regression ile **102 native + 17 devralınan PASS**, fail/skip/
  cancel=0. Mevcut SIGKILL, I/O error/reopen, replay/sequence ve v1 export
  assertion'ları gevşetilmedi.
- [i18n.log](i18n.log): **0 yeni / 0 baseline eksik**.

## Profilsiz 100k steady karşılaştırması

**[Doğrulandı] RSS gerilemesi tamamen kapanmadı: güncel medyan fark +%13,02
(+63,13 MiB). Bu gerileme kabul edilmedi.** Snapshot clone'unun kaldırılması
kanıtlanmış bir tahsis azaltımıdır; kalan tamponları ortadan kaldıran streaming /
format değişimi bu küçük düzeltmenin kapsamına alınmadı. Yardımcıyı entegrasyona
hazır veya üretim RSS kabulünden geçmiş sayma.

| Kol | Peak RSS medyan [min–max] MiB | Checkpoint CPU medyan ms | Checkpoint süre medyan ms | Mantıksal payload byte |
| --- | ---: | ---: | ---: | ---: |
| legacy-store | 485,07 [484,29–550,80] | 57.361,14 | 56.869,16 | 6.777.574.427 |
| journal (düzeltme sonrası) | 548,20 [546,55–641,25] | 6.295,04 | 6.044,05 | 193.920.022 |

[Ham altı örnek ve min/medyan/max özeti](acceptance/100000-steady-summary.json),
[kohort logu](cohort.log) ve [ayar/hash doğrulaması](acceptance-verification.json)
korunur. Sıra `legacy/journal`, `journal/legacy`, `legacy/journal`;
her örnek taze Node v24.19.0 süreci. Aynı sentetik 100.000 sipariş, steady,
batch=250, snapshotEvery=64, 400 terminal batch; init + altı periodic snapshot +
son explicit compact ölçüme dahildir. Node/CPU, fixture/trace/output hash'leri,
değişmemiş production ve ölçüm harness SHA'ları önceki 100k örneklerle doğrulandı.
GC zorlanmadı; profiler, `--expose-gc`, `--trace-gc`, heap limiti/GC bayrağı veya
`NODE_OPTIONS` kullanılmadı. Başarısız/kayıp kabul örneği yoktur.

Önceki **657,78 MiB** journal medyanı önceki kohortun tarihsel sonucudur; yeni
**548,20 MiB** ile birleştirilip altı journal örneği gibi kullanılmaz. Güncel
karşılaştırma yalnız aynı yeni kohortun 485,07 / 548,20 MiB medyanlarıdır. Eski
ve yeni journal toplam mantıksal payload'ı aynıdır; düzeltme yazma baytını veya
durability sözleşmesini değiştirmedi. Eski store fsync yapmaz; kollar durability
açısından eşdeğer değildir. Toplam refresh süresi ölçülmedi. Ölçümdeki peak,
load/oracle öncesi süreç high-water'ıdır; bu dar kapsamda v1 export / reopen
tepe belleğinin de iyileştiği iddia edilmez.

## Yeniden üretim ve kanıt koruma

Her test/tanı/ölçüm ortak `flock -n -E 75
/tmp/buyerlog-performance-measurement.lock` altında seri çalıştı. Lock silinmedi;
kilit doluyken ikinci kampanya başlatılmadı. Yalnız sentetik #890 fixture'ı
kullanıldı. İlk sandbox tanısında mevcut `execFileSync('git')` EPERM verdi;
`before-natural-measure.json` / `.log` başarısız kaydı korur. Aynı tanı sandbox
dışında `before-natural-unsandboxed*` adıyla tamamlandı. Bu ilk iki deneme
[profile-v1.cjs](diagnostics/profile-v1.cjs) kullanır: explicit GC yok, sampler
varsayılan açık, GC olay dökümü boş. Ana tanı v2 `profile.cjs` ile phase-only ve
explicit-GC/sampling koşularını ayırır; v1 başarısızlığı kabul örneği değildir.

Repo kökünden, yeni çıktı dizini/adları kullanarak:

```sh
# İlgili testler + i18n (mevcut çıktıyı ezmeyi reddeder)
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  sh docs/performance-program/contrib-int06-checkpoint-journal-20261108/rss-followup/validate.sh

# Profilsiz kabul karşılaştırması: taze alt süreçler, yalnız 100k steady
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  node resources/app/tests/fixtures/int06-checkpoint-journal/cohort.cjs \
  /tmp/int06-rss-new-acceptance 100000 steady

# Tanı; acceptance çıktı dizinine yazılmaz. Bu örnek explicit-GC + sampler.
# Phase-only için iki *_GC/*_SAMPLE env'sini ve --expose-gc'yi çıkar.
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  env INT06_PROFILE_OUTPUT=/tmp/int06-new-diagnostic.json \
  INT06_PROFILE_GC=1 INT06_PROFILE_SAMPLE=1 \
  node --expose-gc --trace-gc \
  --require ./resources/app/tests/fixtures/int06-checkpoint-journal/profile.cjs \
  resources/app/tests/fixtures/int06-checkpoint-journal/measure.cjs \
  '{"arm":"journal","orders":100000,"scenario":"steady","batchSize":250,"output":"/tmp/int06-new-diagnostic-measure.json"}'
```

`summarize.py` yalnız saklı tanıları okur; `audit.py` eski artifact, protected
production ve devralınan fixture hash'lerini doğrular. Çıktılar `diagnostic-summary.json`
ve `preservation-audit.json` içindedir: **67 eski artifact, 62 protected production
dosyası ve 9 devralınan preparation dosyasının hash'i doğrulandı**. Önceki teslimin README/results, RED'leri,
ham ölçümleri ve manifest'i değiştirilmedi; yeni kanıtlar bu alt dizindedir.

Büyük split/retry ve connector kampanyası eklenmedi. Tam filtresiz regresyon,
üretim entegrasyonu/kabulü, Windows/Electron/SMB veya power-loss sınaması yapılmadı.
`/tmp` tmpfs; fsync syscall/process-crash sözleşmesi gerçek donanım flush gecikmesi
değildir. PR, merge, rebase/force-push, bağımsız review ve TEST/STABLE yayını yok.
