# INT-06 — checkpoint hazırlığı / checkpoint preparation (P1)

TR: Bu PR kaynak doğrulaması, sentetik fixture, ölçüm aracı ve mevcut davranışı
kilitleyen test hazırlığıdır. Ürün uygulaması ve kabul edilen nihai önce/sonra
serisi **#885 merge edildikten sonraki Main** üzerinde yapılacak. Bu dal merge
edilmez; P1 bağımsız inceleme ve kullanıcı değerlendirmesi öncesinde durur.
TEST/STABLE yayını yoktur.

EN: This PR prepares source verification, synthetic fixtures, measurement and
current-behavior regression tests. Production implementation and the accepted
final before/after series must use **Main after #885 merges**. Stop before merge
for independent P1 review and user assessment. No TEST/STABLE publication.

## Kaynak ve kapsam / source and scope

Başlangıç Main / starting Main: `1d8e8d39257b66443fad8e80739261b4f0a82227`.
Kanonik bulgu / canonical finding:
[`2026-11-05-codex-review-findings.md`, INT-06](../performance/2026-11-05-codex-review-findings.md#int-06--öncelik-b--efor-m--faz-7).

[Doğrulandı / Verified] `power-bi-import-dashboard.js` hâlâ her batch'te
`refreshManifestCounts` ile tüm durumları tarıyor. `saveCheckpoint` tüm durum,
remainingOrders ve rows kopyalarını callback'e veriyor; store JSON'u senkron
stringify → geçici dosya → rename ile yazıyor. Progress tam orderStates kopyası
taşıyor. Şema v1, SUCCESS/NOT_FOUND/FAILED ve çıktı satır sırası korunacak.

TR: Bu hazırlık ürün dosyalarını değiştirmez. Sonraki uygulama yalnız
`resources/app/server/lib/power-bi-import-dashboard.js` ve INT-06 test/benchmark
dosyalarında tutulacak. `server.js`, `app-main.js`, #885 compute dosyaları ve
Claude'a ayrılan dosyalar kapsam dışıdır. Yeni worker mekanizması yoktur;
test helper'ının kısa ömürlü süreçleri yalnız kill/resume doğrulaması içindir.

EN: Production files are unchanged in this preparation. Later implementation
stays within `power-bi-import-dashboard.js` and INT-06 tests/benchmarks.
`server.js`, `app-main.js`, #885 compute files and Claude-owned files are outside
scope. The test helper uses short-lived subprocesses solely for kill/resume
verification; it introduces no application worker mechanism.

## Ölçüm sözleşmesi / measurement contract

TR: Her örnek ayrı, taze Node sürecinde; sabit batch=250 ve aynı fixture SHA.
Gerçek checkpoint store geçici yerel diske yazar. Başarılı `writeFileSync` ve
`appendFileSync` UTF-8 payload baytları sayılır; append'in iç writeFile çağrısı
iki kez sayılmaz. Fiziksel disk/SMB baytları, fsync veya enerji kesintisi
dayanıklılığı ölçülmez. Yeni store başka I/O API'sine geçerse observer önce
uyarlanmalı ve birim testi genişletilmelidir.

EN: Each sample runs in a fresh Node process, batch=250, with the same fixture
SHA. The real store writes to temporary local disk. The observer counts successful
UTF-8 `writeFileSync`/`appendFileSync` payload bytes once. These are logical
payload bytes, not physical disk/SMB traffic, fsync or power-loss durability.
If the new store adopts another I/O API, adapt and test the observer first.

TR: CPU ve süre refresh'in sorgu fixture'ı, sayaç/kopyalar, gerçek kayıt ve hafif
progress callback'ini kapsar. Peak RSS, load/oracle/hash işlemlerinden önce
`process.resourceUsage().maxRSS` ile süreç ömrünün OS tepe değeridir; timer
örneklemesi kullanılmaz. Fixture, module ve harness SHA raporda tutulur. Çıktı ve
diskten okunan checkpoint bağımsız oracle ile tüm durum/satır/null/çokluk ve sıra
açısından karşılaştırılır. GC zorlanmaz; soğuk OS cache iddiası yoktur.
Store save CPU/süresi ayrıca ayrılır; bu sayı sayaç/kopyalama maliyetini kapsamaz.
Benchmark'ta query trace kapalıdır; retry fixture'ı ayrı bir attempts Map tutmaz.

EN: CPU and wall time cover the refresh, fixture transport, counting/copies,
real checkpoint writes and a lightweight progress callback. Peak RSS uses the
OS process-lifetime high water from `process.resourceUsage().maxRSS`, captured
before load/oracle/hash allocation. Reports retain fixture/module/harness SHAs.
Both returned output and reloaded checkpoint must match an independent oracle,
including terminal states, rows, nulls, multiplicity and order. No forced GC or
cold OS cache claim.
Store-save CPU/time is also reported separately and excludes counting/copies.
The benchmark disables query tracing and keeps no fixture retry-history Map.

```bash
cd resources/app
node scripts/benchmark-powerbi-checkpoint.js --app-root /path/to/before/resources/app --orders 30000 --batch-size 250 --scenario steady --output /tmp/int06-before-30k-1.json
node scripts/benchmark-powerbi-checkpoint.js --app-root /path/to/before/resources/app --orders 100000 --batch-size 250 --scenario steady --output /tmp/int06-before-100k-1.json
# Aynı komutlar / same commands: --scenario split-retry
# Sonraki uygulama / later implementation: --app-root /path/to/after/resources/app
```

TR: Hazırlık provası 30k/100k sonuçları bu PR'ın artifacts dizininde saklanır;
program baz çizgisi veya hızlanma kabulü değildir. #885 sonrası güncel Main'de
aynı harness ile her boyut/senaryoda üç eşlenmiş before ve üç after örneği
alınır: before/after, after/before, before/after. Tüm başarısız örnekler korunur;
medyan/aralık, byte toplamı ve çıktı SHA eşitliği birlikte raporlanır.

EN: The artifacts directory retains preparation rehearsals for 30k/100k. These
are not the program baseline or an accepted speedup. After #885, run three paired
before/after samples for each size/scenario, alternating before/after,
after/before, before/after. Retain failed samples and report medians/ranges,
total bytes and output SHA equivalence together.

TR: `initial-rehearsal-30000-steady.json`, bağımsız inceleme düzeltmelerinden
önceki araçla alınmış ilk provadır: fixture query geçmişi tutar ve store-save
CPU/süresini ayrı raporlamaz. Silinmedi; son araçla alınan 30k/100k çiftiyle
birleştirilmez. Hazırlık testleriyle kısa süre örtüşme olduğundan süre kabulü
olarak da kullanılmaz.

EN: `initial-rehearsal-30000-steady.json` retains the first run with the harness
before review fixes: it retained fixture query history and did not report
store-save CPU/time separately. Do not combine it with the final-harness
30k/100k pair. It also briefly overlapped preparation tests and is not timing
acceptance evidence.

## RED → GREEN ve kalan kabul / validation and remaining acceptance

```bash
cd resources/app
BUYER_LOG_DATA_ROOT=/tmp/int06-data BUYER_LOG_LOCAL_DATA_ROOT=/tmp/int06-local BUYER_LOG_SERVER_DATA_ROOT=/tmp/int06-server npm test -- powerbi-checkpoint power-bi-import-dashboard powerbi-dashboard
# Detaylı Node 24 çıktısı / detailed Node 24 output:
node --test --test-isolation=none tests/powerbi-checkpoint-preparation.test.js tests/powerbi-checkpoint-resume.test.js
```

TR: Hazırlık RED kanıtı eksik fixture/ölçüm yardımcıları ve eski-v1 fixture'ı
üzerinden alınır; GREEN hazırlığın çalıştığını gösterir, ürün optimizasyonunun
uygulandığını göstermez. Byte bütçesi CLI ile ayrı başarısız regression olarak
saklanabilir; **mevcut ürün performansını GREEN sayma**. Sayısal kabul bütçesi
post-#885 baz ölçümü ve maliyet kararıyla dondurulur; hızlandırma uğruna
doğruluk/bütünlük testi veya eşik gevşetilmez.

EN: Preparation RED evidence covers missing fixture/measurement helpers and the
frozen-v1 fixture. GREEN verifies the preparation, not a production optimization.
The CLI can retain a separate failing byte-budget regression; **do not report
current production performance as GREEN**. Freeze the numeric acceptance budget
from the post-#885 baseline and measured-cost decision; never weaken correctness
or integrity tests to obtain a speedup.

TR: İlk hedefli paket, mevcut testlerin kullanıcı ana dizinine varsayılan yazımı
bu sandbox'ta izinli olmadığından ENOENT verdi. Başarısız çıktılar korunur;
mevcut BUYER_LOG_* veri kökü seçenekleri `/tmp`'ye verilince dört dosya geçti.
Ürün veya mevcut test dosyaları değiştirilmedi. Tam suite çalıştırılmadı.

EN: The initial targeted run failed with ENOENT because existing tests defaulted
to a home-directory data path outside this sandbox's writable roots. Failed logs
are retained. All four files passed using existing BUYER_LOG_* data-root options
under `/tmp`, without changing production or existing tests. The full suite was
not run.

Mevcut davranış testleri / current-behavior tests:

- Her committed batch sınırında SIGKILL, yeni süreçte yalnız diskten resume;
  normal batch ve split yaprakları, son batch sonrası sıfır yeniden sorgu.
  / SIGKILL at every committed batch boundary, disk-only resume in a new process,
  normal/split leaf batches, zero requery after the final boundary.
- SUCCESS/NOT_FOUND/FAILED terminal durumları yeniden sorgulanmaz; nihai satırlar
  bağımsız oracle ve kesintisiz referansla eşit. / No terminal state is requeried;
  final rows match both the oracle and uninterrupted reference.
- Başlamadan, batch'ler arasında, query içinde ve retry beklemesinde iptal;
  işlenmeyen siparişler terminal olmaz. / Cancel before start, between batches,
  inside a query and during retry backoff; unfinished orders remain nonterminal.
- Sabit schema-v1 fixture, null/Unicode/çok satırlı sipariş kapsamı.
  / Frozen schema-v1 fixture, nulls, Unicode and multi-row orders.
- Aynı batch tekrarında ve SUCCESS → FAILED → NOT_FOUND → SUCCESS geçişinde
  çift sayım ve stale failedOrderCodes yok. / Repeated batches and state
  transitions never double count orders or retain stale failedOrderCodes.

TR: Sonraki uygulamada journal partial-tail/duplicate/replay sırası,
snapshot yazımı/rename ve journal compaction'ın her crash aşaması için önce RED
testi eklenir. Bu hazırlık yalnız başarılı kayıt sınırlarını keser; kayıt içi
crash/compaction dayanıklılığı henüz uygulanmadı veya doğrulanmadı. Yeni biçimin
eski uygulamayla açılması/rollback davranışı ayrıca kararlaştırılıp test edilir;
eski v1 okumayı korumak tek başına çift yönlü uyum kanıtı değildir.

EN: Before implementing the journal, add RED tests for partial tails, duplicate
records, replay order and crashes during snapshot write/rename and journal
compaction. Current tests interrupt successful save boundaries only; they do not
yet prove intra-write/compaction crash safety. Explicitly decide and test how the
old application opens or rolls back the new format; reading v1 alone does not
establish bidirectional compatibility.

## Entegrasyon sınırı ve teslim / integration boundary and delivery

TR: Mevcut `server.js` callback'i `checkpointStore.save(value)` çağırıyor;
store API'sini koruyan iç değişiklik olasıdır. Progress'i küçültmeden önce güncel
çağrı zincirindeki tüketici alanları hedefli doğrulanmalı. Zorunlu route/UI
entegrasyonu bulunursa kullanıcıya bildirilir; korunan dosyalar bu dalda
düzenlenmez. Bu aşamada zorunlu entegrasyon değişikliği kanıtlanmadı.

EN: The existing `server.js` callback calls `checkpointStore.save(value)`;
internal changes may preserve that API. Before reducing progress payloads,
verify the exact fields consumed by the current call chain. Report any required
route/UI integration and leave protected files untouched. No mandatory
integration change has been established in this preparation.

TR: Hazırlık kullanıcıya görünen davranışı değiştirmediğinden yeni release note
ve PNG eklenmez. Görünür ürün iyileştirmesi uygulandığında aynı PR serisinde TR/EN
release note ve sentetik/demo veriyle gerçek post-change Buyer Log PNG'si gerekir.
P1 bağımsız inceleme, güncel head'in gerçek PR checks sonuçları ve merge öncesi
durma şartı devam eder. Main branch protection etkin varsayılmaz.

EN: This preparation changes no user-visible behavior, so it adds no release note
or PNG. The later visible production improvement requires a TR/EN release note
and a real post-change Buyer Log PNG using synthetic/demo data in the same PR
series. Independent P1 review, actual PR checks on the current head and stopping
before merge remain required. Do not assume Main branch protection is enabled.

## Hazırlık provası sonuçları / preparation rehearsal results

TR: Aynı son araçla birer steady örnek, batch=250; tüm çıktı/checkpoint oracle karşılaştırmaları PASS. Aşağıdaki CPU/süre toplam refresh maliyetidir; store-save ayrı sütundadır.

EN: One steady sample per size with the same final harness, batch=250. All output/checkpoint oracle comparisons pass. CPU/wall below cover total refresh; store-save is separate.

| Sipariş / orders | Yazılan bayt / bytes written | Çoğalma / amplification | CPU user+sys (s) | Süre / wall (s) | Store-save CPU / wall (s) | Peak RSS (MiB) |
|---:|---:|---:|---:|---:|---:|---:|
| 30,000 | 612,127,225 | 68.91× | 146.816 | 146.624 | 3.658 / 3.654 | 281.96 |
| 100,000 | 6,777,576,427 | 228.73× | 621.357 | 620.658 | 47.834 / 47.762 | 603.72 |

TR: Yazma maliyeti anlamlı bir adaydır; bu veri tek başına toplam sürenin checkpoint kaynaklı olduğunu kanıtlamaz. Sayaç/kopya maliyeti toplam refresh içinde, fixture satır işleme maliyetiyle birlikte bulunur. Optimizasyon kararı ve nihai karşılaştırma post-#885 Main üzerinde yeniden doğrulanacak.

EN: Write cost is a meaningful optimization candidate; these results do not attribute total duration to checkpointing. Counting/copy costs share total refresh with fixture row processing. Revalidate the implementation decision and final comparison on post-#885 Main.

[Ham sonuçlar ve SHA manifesti / raw results and SHA manifest](int-06-preparation-artifacts/summary.json). Büyük split-retry ölçümü ertelendi / large split-retry measurement is deferred.
