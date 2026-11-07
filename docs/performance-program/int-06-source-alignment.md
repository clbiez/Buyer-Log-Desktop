# INT-06 — kaynak uyumu devri / source alignment handoff

TR: **Yalnız hazırlık.** #890 head `e31e4bb2699d4d89cf54a1f50ccb6ed6422f9e06`
devralındı; mevcut fixture, oracle, test ve kanıtlar korundu. Main
`5a1656e98deeb573f6245f4b24a8135cc77a0d7b` (#892) normal merge ile alındı.
İnceleme SHA'ları yeniden yazılmadı; rebase/force-push yok. Üretim uygulaması
programın Faz 7 sırasını ve güncel post-#885 Main'i bekler.

EN: **Preparation only.** Inherited #890 head
`e31e4bb2699d4d89cf54a1f50ccb6ed6422f9e06`, preserving its fixture, oracle,
tests and evidence. Merged Main `5a1656e98deeb573f6245f4b24a8135cc77a0d7b`
(#892) normally, without rebasing or force-pushing review SHAs. Production
implementation waits for the program's Phase 7 sequence and current post-#885 Main.

## Kaynak sınırı / source boundary

TR: Açık PR kapsamları kontrol edildi: #885 server/app-main/compute ve ilgili
testler; #891 yalnız phase-6a belgeleri; #893 yalnız FX tanısı; #890 INT-06
hazırlığı. #890'ın kendi dalı sürdürüldü; çakışan ikinci PR açılmadı.
`resources/app/server/` ve `resources/app/public/` güncel Main ile birebir;
#892'nin korunan dosyaları yalnız Main'den geldi. Kanonik alanlar, TR/EN,
Motion+, reduced-motion ve mevcut sürüm notları değiştirilmedi. Görünür ürün
değişikliği olmadığı için yeni release note/PNG yok.

EN: Checked open PR scopes: #885 owns server/app-main/compute and related tests;
#891 owns phase-6a documents; #893 owns FX diagnostics; #890 owns INT-06
preparation. Continued #890's branch without creating a conflicting second PR.
The server and public trees equal current Main; protected #892 changes came only
from Main. Canonical fields, TR/EN, Motion+, reduced-motion and existing release
notes are unchanged. No visible product change, so no new release note/PNG.

TR: Mevcut `server.js` callback'i checkpoint değerini `store.save(value)`'ya
iletir (7261); progress `refreshJobs.dashboard`'a atanıp job yanıtında taşınır
(9225–9227, 9162); telemetry `lastBatch` okur (7251). Son çıktı tüketicisi tam
`result.manifest.orderStates`'i önceki IAS verisini korumak için kullanır (7276).
Bu nedenle nihai manifest korunmalı; progress küçültme ayrı bir sözleşme olarak
sınanmalı. Bu tur zorunlu bir server/compute entegrasyon değişikliği kanıtlamadı.
Gerekirse ana sohbetten istenecek; bu dalda korunan dosya düzenlenmeyecek.

EN: The current server callback forwards checkpoint values to `store.save(value)`;
progress is assigned to `refreshJobs.dashboard` and returned by the job API;
telemetry reads `lastBatch`. The final consumer needs complete
`result.manifest.orderStates` to preserve previous IAS data. Preserve the final
manifest and test smaller progress separately. No mandatory server/compute
integration change was established here; request it from the main chat if needed.

## Maliyet kanıtı ve ölçüm sınırı / cost evidence and limits

TR: Değişiklikten önce mevcut harness ile alınan Node CPU profili:
`int-06-alignment-artifacts/cost-3000.cpuprofile`. Sabit sentetik 3.000 sipariş,
batch=250, steady: **6.485.162 bayt / 12 yazım**, son snapshot 888.524 bayt
(7,30×), toplam CPU 16,932 sn, süre 16,225 sn, peak RSS 70,18 MiB;
store-save CPU/süre 53,589/51,370 ms. Profil ağırlıkla `key`/alan adı
normalizasyonunu gösterir; toplam CPU'yu checkpoint'e atfetmez.

EN: Before changing the harness, retained a Node CPU profile of the existing
3,000-order synthetic fixture, batch=250, steady: **6,485,162 bytes / 12 writes**,
888,524-byte final snapshot (7.30×), total CPU 16.932 s, wall 16.225 s,
peak RSS 70.18 MiB; store-save CPU/wall 53.589/51.370 ms. Samples are dominated
by `key`/field-name normalization; total CPU cannot be attributed to checkpointing.

TR: Yeni araç her hedefin module/server/canonical ve dört #892 üretim dosyasının
SHA'sını başta kaydeder, sonda değişmezlik kontrolü yapar. İki kol aynı #892
kodunu, canonical ve entegrasyon dosyalarını içermeli. Her kol üç ayrı taze Node
süreci kullanır; sıra before/after, after/before, before/after. Global geçici
dosya kilidi ölçüm CLI'larının çakışmasını reddeder. Başka test/benchmark aynı
anda çalıştırılmaz. Kilit kalırsa PID incelenir; otomatik kırılmaz.

EN: The new harness records and rechecks target module/server/canonical and four
#892 production-file hashes. Both arms must contain merged #892 with identical
protected, canonical and integration code. Three fresh processes per arm run in
before/after, after/before, before/after order. A shared temporary-file lock rejects
overlapping measurement CLIs. Do not run other tests/benchmarks concurrently;
inspect the owner PID before removing a stale lock.

TR: Hatalı koşu JSON/stderr ve varsa sentetik checkpoint dizinini korur. Cohort
ilk başarısızlıkta durur, retry yapmaz ve eski çıktı dizinini ezmez. Medyanlar
eşit fixture/harness/çıktı SHA'ları ve ortam kimliği olmadan üretilmez.
Kaynak geçmişi sığ veya bilinmiyorsa #892 kabulü kapalıdır; tam geçmişi ölçümden
önce hazırla. Araç gerçek servis veya refresh POST çağrısı yapmaz.

EN: Failed runs retain JSON/stderr and any synthetic checkpoint directory.
Cohorts stop on first failure, never retry, and never overwrite an existing output
directory. Medians require matching fixture/harness/output hashes and environment.
Shallow/unknown history fails the #892 gate; prepare full history before measuring.
The tool makes no service or refresh POST requests.

```bash
cd resources/app
mkdir -p /tmp/int06-profile
node --cpu-prof --cpu-prof-dir=/tmp/int06-profile \
  scripts/benchmark-powerbi-checkpoint.js --orders 3000 --batch-size 250 \
  --scenario steady --output /tmp/int06-profile/cost.json
# Sonra, ölçümleri çakıştırmadan / Then, without overlapping measurements:
node scripts/benchmark-powerbi-checkpoint-cohort.js \
  --before-app-root /workspace/int06-main892/resources/app \
  --after-app-root /workspace/Buyer-Log-Desktop/resources/app \
  --orders 3000 --batch-size 250 --scenario steady \
  --output-dir /tmp/int06-new-control
```

TR: Bu devirde iki kolun **üretim modülü aynıdır**; üçlü çiftler yalnız kaynak
uyumu/harness kontrolüdür. `optimizationAccepted:false`; resmi önce/sonra veya
hızlanma iddiası yoktur. İlk hazırlığın 30k/100k tek örnekleri eski artifact
dizininde korunur, yeni seriyle birleştirilmez. Faz 7'de güncel iki kol aynı
#892 kodunu taşıyarak 30k/100k × steady/split-retry için en az 3+3 yeni koşu
ve medyan/aralık gerektirir. Bu araç daima hazırlık raporu üretir; kendiliğinden
ürün kabulü vermez. Fiziksel I/O, güç kesintisi, Windows/Electron veya SMB ölçülmedi.

EN: Both arms use the **same production module** in this handoff; paired triples
are only source/harness controls, always `optimizationAccepted:false`. There is
no official before/after or speedup claim. Retain the initial 30k/100k single
samples separately. Phase 7 requires fresh 3+3 runs and medians/ranges for
30k/100k × steady/split-retry, with both current arms including identical #892
code. This runner always reports preparation and cannot approve production.
No physical I/O, power-loss, Windows/Electron or SMB measurement.

TR: Ölçüm doğrudan connector + gerçek checkpoint store kapsamındadır. Server'daki
`canResume` sipariş kümesi karşılaştırması ve bütün refresh/HTTP akışı ölçülmez;
bu sonuçlardan uçtan uca refresh kazancı çıkarılmaz. İlk `cohort-3000-steady`
serisi, runner kimlik kontrolü ve eksik geçmiş testi tamamlanmadan alındı;
silinmedi, `final-*` serileriyle birleştirilmez.

EN: Measurements cover the connector and real checkpoint store directly. They
exclude server `canResume` order-set comparison and the complete refresh/HTTP
pipeline, so they establish no end-to-end refresh improvement. The initial
`cohort-3000-steady` predates the runner identity check and missing-history test;
it is retained separately from the `final-*` series.


## Son seri medyanları / final control medians

TR: Her satır üç taze süreç; aynı üretim modülü, hızlanma kabulü yok. EN: Three fresh processes per row, unchanged production module, no speedup acceptance.

| Senaryo / scenario | Kol / arm | Bayt / bytes | CPU (s) | Süre / wall (s) | Peak RSS (MiB) | Store CPU / wall (ms) |
|---|---|---:|---:|---:|---:|---:|
| steady | before | 6,485,162 | 14.637 | 14.535 | 67.48 | 46.332 / 45.902 |
| steady | after | 6,485,162 | 15.603 | 15.495 | 68.01 | 44.251 / 43.757 |
| split | before | 487,837,612 | 25.846 | 27.385 | 95.02 | 3346.647 / 3330.403 |
| split | after | 487,837,612 | 26.931 | 28.485 | 93.72 | 3524.071 / 3505.874 |

TR: Steady her koşuda 12, split-retry 1.194 checkpoint üretti; tüm 12 final koşuda oracle ve diskten yüklenen sonuç eşitliği PASS. Her senaryoda fixture/harness/çıktı SHA eşliği PASS. Önceki ve son seriler birlikte toplanmaz. EN: Each run produced 12 steady or 1,194 split-retry checkpoints. Oracle and disk-load parity passed in all 12 final runs, with matching fixture/harness/output hashes per scenario. Do not pool initial and final cohorts.

[Ham JSON/log, medyan ve aralık / raw JSON/log, medians and ranges](int-06-alignment-artifacts/final-3000-steady/summary.json) · [Split/retry](int-06-alignment-artifacts/final-3000-split/summary.json) · [SHA manifesti / SHA manifest](int-06-alignment-artifacts/manifest.json).

## Doğrulama ve sonraki kapılar / validation and next gates

TR: Yeni araç davranışları RED→GREEN: başarısız JSON saklama, üç çiftin
kaynak/eşdeğerlik reddi ve ölçüm kilidi. İlk GREEN denemesinde yeni negatif
testin paylaşılan nesnesi bütün örnekleri birlikte değiştiriyordu; her örnek
bağımsız klonlanarak düzeltildi. Başarısız log silinmedi. Mevcut assertion veya
validator gevşetilmedi; v1 fixture SHA'sı donduruldu. Normal üç ve split yedi
kayıt sınırında SIGKILL/diskten resume sürer; ayrıca aynı refresh art arda
öldürülüp kalan her batch'ten devam eder. SUCCESS/NOT_FOUND/FAILED, iptal,
retry, çok satırlı sipariş, Unicode/null ve sıralama korunur.

EN: RED→GREEN covers failure JSON retention, three-pair source/parity rejection
and the measurement lock. An initial negative-test fixture shared nested objects
across samples; independent clones corrected it, and the failed log is retained.
No existing assertion or validator was relaxed. The v1 fixture SHA is frozen.
SIGKILL/disk-only resume covers all three normal and seven split boundaries,
plus repeated crashes in the same refresh. Terminal states, cancellation,
retry, multi-row orders, Unicode/nulls and order are preserved.

TR: Son koddan sonra hedefli paket **4 dosya / 100 test PASS**, fail/skip/cancel 0; hazırlığın 17 testi dahil. Eksik geçmişli izole repo: 9 test PASS. i18n yeni/baseline **0/0**, mevcut release notes **32/32 PASS**. EN: After the final code change, targeted tests passed **4 files / 100 tests**, including 17 preparation tests, with zero failures/skips/cancellations. Isolated missing-history repository: 9 tests passed. i18n **0/0**, existing release notes **32/32 PASS**.

TR: **Faz 6 / son program PR'ı:** sabitlenmiş güncel baz + uygulama SHA'sında
`resources/app` içinden filtresiz `npm test` zorunlu. Hedefli testler veya hızlı
CI bunun yerine geçmez. Sonucu etkileyen kod değişirse kontroller ve gerekli tam
suite yenilenir. Bu hazırlıkta tam regresyon çalıştırılmadı.

EN: **Phase 6 / final program PR:** unfiltered `npm test` from `resources/app`
on pinned current base + implementation SHAs remains mandatory. Targeted tests
and fast CI do not replace it. Repeat checks and required full regression after
code changes affecting results. Full regression was not run in this preparation.

TR: Üretim uygulamasında önce journal partial-tail/duplicate/replay sırası,
snapshot write/rename ve compaction crash aşamalarına RED testi gerekir.
Eski v1 okuma, yeni formatın eski sürüme rollback uyumunu tek başına kanıtlamaz.
Artımlı sayaç/batch journal/periyodik atomik snapshot **uygulanmadı**.

EN: Production work first needs RED tests for journal partial tails, duplicate
replay/order, snapshot write/rename and compaction crashes. Reading v1 alone
does not establish old-version rollback compatibility. Incremental counters,
batch journal and periodic atomic snapshots are **not implemented**.

## Kullanıcı üzerinden tek Claude incelemesi / one Claude review via the user

TR: Bu devir için yeni bağımsız inceleme yapılmadı. Kullanıcı üzerinden **en fazla
bir** Claude turu için paket: #890'ın güncel diff'i, bu rapor, iki hazırlık test
dosyası, benchmark/cohort/provenance yardımcıları ve artifact manifesti. Yalnız
statik inceleme iste: kaynak/#892 eşliği, kilit ve hata saklama, oracle bağımsızlığı,
crash sınırları ve Faz 7 kapısı; korunan dosyalar salt okunur, eşzamanlı ölçüm yok.
P0/P1 veya eşdeğerlik/yetki/veri kaybı bulgusunda dur. İlk #890 incelemesi bu
yeni deltayı veya gelecekteki journal'ı kapsamaz.

İnceleme deltası / review delta:
[`3766f49e..aef416e5`](https://github.com/clbiez/Buyer-Log-Desktop/compare/3766f49e59180b1a4443bd40a7e3998d3d2e562a...aef416e5db3560990116da9661d7ef8b7eeb9a33).
TR: Bu aralık Main merge'inden sonraki yalnız INT-06 araç/test değişiklikleridir;
rapor ve ham kanıtlar ayrıca okunur. EN: This range contains only INT-06 tool/test
changes after the Main merge; also read the report and raw evidence.

EN: No new independent review was performed. Prepare at most **one** Claude round
via the user: current #890 diff, this report, both preparation test files,
benchmark/cohort/provenance helpers and artifact manifest. Request static review
of source/#892 parity, lock/failure retention, oracle independence, crash boundaries
and the Phase 7 gate. Protected files stay read-only; no concurrent measurements.
Stop on P0/P1, parity, authorization or data-loss findings. The original #890
review covers neither this delta nor the future journal.

TR/EN: **Merge yok / no merge. TEST yok / not published. STABLE yok / not published.**
