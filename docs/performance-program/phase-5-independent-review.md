# Faz 5 · Bağımsız inceleme / Independent review

TR/EN: Güncel durum / Latest status: **B1 AÇIK / OPEN; merge yok / no merge**.
[İkinci inceleme sonuçları ve son 3+3+3 seri / Second-review results](phase-5-review2-report.md).

TR: Kullanıcının P1 kuralı kapsamında `gpt-6-astra`, temel
`ad198bfe245a93c5ccd90184082d209bb4c3dfb7` ile
`7012eb3f2d978a5f39aa12800e9c5ccb9635697e` arasındaki gerçek diff'i tek turda,
salt okunur olarak inceledi. İnceleme kod onayı vermedi; aşağıdaki üç bulguyu
üretti. Düzeltmeler ana agent tarafından yapıldı ve regresyonlarla doğrulandı;
kullanıcının tek çapraz tur sınırı nedeniyle ikinci bir inceleme yapılmadı.

EN: Under the user's P1 rule, `gpt-6-astra` performed one independent read-only
review of the actual diff from `ad198bfe245a93c5ccd90184082d209bb4c3dfb7` to
`7012eb3f2d978a5f39aa12800e9c5ccb9635697e`. The review did not approve the code;
it identified the three findings below. The primary agent implemented and
regression-tested the fixes. There was no second review pass, in accordance
with the user's one-pass limit.

| Risk | Bulgu / Finding | Düzeltme / Resolution |
| --- | --- | --- |
| P1 | Kuyruk girdileri işlerin büyüme payını tüketip birbirlerini sonsuza kadar bloke edebilir. / Queued inputs can consume each other's execution headroom indefinitely. | Admission, tüm kabul edilmiş girdilerin sırayla boşaltılabildiği bir yürütme sırası bulunmasını şart koşar. Bekleme ve yürütme aynı son tarihi paylaşır; kuyruk timeout'u komşu worker'ı emekli etmez. Küçük, sığan bir iş büyük işin önünü açabilir. / Admission requires an execution order that can drain every accepted input; one deadline covers queue wait and execution, and a queued timeout does not retire its neighbour. A smaller fitting job can unblock an older large job. |
| P2 | Snapshot olmayan Excel geri dönüşü MAIN'e yüklenir fakat worker'a yayımlanmadığında başarılı, boş Backlog dönebilir. / A snapshot-free Excel fallback can load MAIN without publishing a worker source, producing a successful empty Backlog. | Geri dönüş runtime'ı kaynak alanları zaten hazır olsa da snapshot ve tam tipli özel replica olarak kaydedilip yayımlanır. / The fallback runtime is saved and published as a snapshot and exact typed private replica even when source fields are already present. |
| P2 | Snapshot sonrası, projection yayını öncesi crash eski manifest zamanı ile yeni snapshot arasında kalıcı 409 oluşturabilir. / A crash between snapshot save and projection publication can permanently bind an old manifest timestamp to a new snapshot. | Sahip bazlı tek soğuk hazırlık, gerçek disk snapshot'ını worker'da doğrular ve descriptor'u doğrulanan loadedAt'ye bağlar. Eski kimliği yakalamış istek bir kez 409 alır; sonraki istek doğrulanan kimlikle ilerler. Bağlandıktan sonraki dosya değişikliği hâlâ 409 verir. / A per-owner single-flight verifies the actual disk snapshot in the worker before exposing its bound descriptor. Already captured stale callers reject once; later callers use the verified identity. A subsequent unpublished disk replacement still rejects with 409. |

TR: Beş gerçek RED assertion'ı
`/tmp/phase-5-review-findings-red-2.txt` içinde korunur. Üretim fonksiyonlarını
çalıştıran testlere ek olarak, `compute-cold-source-recovery.test.js` gerçek
snapshot dosyaları ve native ortak worker ile iki yolu sınar. Backlog baytları
kanonik üreticiyle birebir eşleşir; yabancı Buyer satırı çıkmaz, snapshot-free
yol gerçek replica oluşturur, bağlanmış disk kimliği sonradan değiştirilirse
reddedilir. Test, çağıranın descriptor kopyasını değiştirmesinin servisin
kanonik descriptor'unu değiştirmediğini de doğrular.

EN: Five actual RED assertions are retained in
`/tmp/phase-5-review-findings-red-2.txt`. In addition to exercising the production
functions, `compute-cold-source-recovery.test.js` uses real snapshot files and
the native common worker for both recovery paths. Backlog bytes exactly match
the canonical builder, foreign Buyer rows are absent, the snapshot-free path
creates a real replica, and a subsequent change to bound disk identity rejects.
The test also verifies that mutating a caller's descriptor copy cannot alter
the service's canonical descriptor.

TR: İnceleme, CPU profiler'ın açıkça etkinleştirilmesini belgelenmiş bir
tanı/gecikme ödünleşimi olarak değerlendirdi; normal kullanımda geçmişe dönük
fonksiyon profilinin bulunmayacağı sınırı korunur. Windows/Electron davranışı
bu Linux incelemesiyle doğrulanmış değildir. Üç koşuluk performans kabulü ve
GitHub check/merge durumu ayrı kanıt gerektirir.

EN: The review treated opt-in CPU profiling as a documented diagnostic/latency
tradeoff: normal operation will not retain retrospective function profiles.
Windows/Electron behaviour is not verified by this Linux review. Three-run
performance acceptance and GitHub check/merge status require separate evidence.

TR: İncelemeden sonraki normal üçlü açılış serisi iki koşuda 200 ms sınırını
aştı; bu örnekler korunur ve kabul edilmiş sayılmaz. Sonraki tanısal izler
sınır aşımını yeniden üretmedi. İzlerde doğrulanan tek parça yetki V8 kodlama
maliyeti için ana agent ek bir düzeltme yaptı: aynı V8 akışı en fazla 256
satırlık parçalarda kodlanır, gerçek event-loop turları arasında güncel yetki
sürümü denetlenir. Worker tam kanonik JSON digest'ini üretir; yetki kapısı
gevşetilmez. İki yeni native regresyon önce RED oldu: aralarda tur verme ve
eski hazırlığın admission öncesinde kesilmesi. Özel anahtar, bölünmüş satır,
Date ve paylaşılan satır kimliği eşdeğerliği ayrıca sınanır. Bu ek düzeltme
ikinci model tarafından yeniden incelenmedi; tek inceleme turu sınırı korunur.
Önceki sınır aşımlarının kesin kök nedeni bu düzeltmeyle kanıtlanmış değildir.

EN: The subsequent normal three-run opening cohort exceeded 200 ms in two
runs; those samples are retained and are not accepted. Later diagnostic traces
did not reproduce the exceedances. The primary agent made an additional fix
for the measured monolithic authority V8 encoding cost: one V8 stream is
written in batches of at most 256 rows, with live authority-generation checks
between real event-loop turns. The worker produces the exact canonical JSON
digest; authorization gates remain intact. Two new native regressions first
failed RED: cooperative handoffs and stopping obsolete preparation before
admission. Special keys, split rows, Date values and shared row identity have
additional equivalence coverage. This additional fix was not reviewed again by
a second model, preserving the single review-pass limit. It does not establish
the exact root cause of the earlier exceedances.

TR: Daha sonraki native profil, aynı turdaki canlı kapı denetimleri ile
4,6 MB CP gzip girdisinin V8 kodlanmasının biriktiğini ve bazı aralıklarda GC
duraklamasını doğruladı. Encoder'a ait, tam ve transfer edilebilir tampon artık
ikinci kez kopyalanmaz. Node sürümü transfer durumunu sorgulayamıyorsa veya
tampon havuzlu/paylaşılmış/kesilmişse önceki kopyalama yolu korunur. Native test
önce RED oldu; byte admission, gerçek transferde detach, çağıranın girdisinin
korunması ve sonuç eşdeğerliği doğrulanır. Bu da ana agent'ın inceleme sonrası
düzeltmesidir; tüm gecikmelerin kök nedeni veya üçlü normal kabul sonucu
olarak sunulmaz.

EN: A later native profile verified the accumulation of live-gate checks and
V8 encoding of a 4.6 MB CP gzip input in one turn, and GC pauses in some gaps.
A complete, transferable buffer owned by the encoder is no longer copied a
second time. The prior copying path remains when the Node version cannot query
transferability or the buffer is pooled, shared or sliced. The native test first
failed RED; byte admission, detachment through real transfer, intact caller
input and equivalent output are covered. This is another primary-agent fix
after the independent review, not a claim to explain every delay or to have
passed the normal three-run acceptance criterion.

TR: Daha sonra aynı-sekme geçişlerini izleyen Faz 0 ölçümleri, önceki üçlü
interaktif açılış kabulünün kapsamadığı bir gecikmeyi ortaya çıkardı. Native
profil, Koleksiyon LFL referansının ilk okumasında tüm model snapshot'ının
MAIN'de açıldığını ve referans motorunun MAIN'de çalıştığını doğruladı.
Salt okunur özet isteği aynı ortak havuza taşındı. ASAS yayınına karışmayan
ayrı kaynak sürümü, gzip ve metadata/yedek dosyalarının kimliğini izler;
eski istek yeni havuz sürümünü geriye alamaz. Aynı scope filtresi ve referans
motoru worker'da çalışır; MAIN yalnız sınırlı özeti açar. Kalıcı schema 5/4
kuralları, manuel yenileme, eski başarılı özetin korunması ve detay isteği
korunur. İki alanın canlı yetkisi, oturum, scope kimliği ve disk sürümü
hesaplama/yayın/yanıt sınırlarında denetlenir. Yeni regresyonlar önce RED
oldu; native worker, metadata-only yenileme ve bozuk ana dosyada yedek okuma
ayrıca sınanır. Bu ilave ana-agent düzeltmesi yeniden ikinci modele verilmedi;
nihai performans kabulü yeni kodda ölçülmelidir.

EN: Subsequent F0 measurements after same-tab navigation exposed a delay not
covered by the earlier three-run interactive opening acceptance. A native
profile verified full model-snapshot decoding and LFL reference calculation
on MAIN during the first Collection reference read. This readonly summary now
runs in the same common pool. A separate source generation follows gzip,
metadata and backup identities without advancing published ASAS state; an old
request cannot roll the pool generation back. The same scope filter and
reference engine run in the worker; MAIN decodes only a bounded summary.
Durable schema 5/4 rules, explicit refresh, preservation of successful saved
summaries and detail requests remain intact. Live access to both areas,
session, scope identity and disk generation are checked around computation,
publication and response. New regressions first failed RED; native workers,
metadata-only refresh and corrupt-primary backup recovery also have coverage.
This additional primary-agent fix was not sent for another independent pass;
final performance acceptance requires measurements at the new code revision.

TR: Sonraki native trace'te ölçülen OAB sabit metadata okuma/parse/indeksleme
maliyeti de `8c575ecd` ile ortak havuza taşındı. Dosya kimliği ve generation
kabulü, source yüklemeden bayt bütçesi, canlı cookie/alan/OAB.VIEW kapıları,
mtime korunmuş replacement ve birebir JSON byte çıktısı testlidir. Gerçek
HTTP testiyle bulunan, sonuç hazır olmadan bağlantısı kopan istemcinin
çıktı lease'ini tutması da RED → GREEN düzeltildi. Bu ek değişiklikler ana
agent tarafından incelendi; son kapsam 168 dosyada 1.278 test geçirdi.
Kullanıcının faz başına en fazla bir bağımsız tur sınırı nedeniyle ikinci
inceleme tekrarlanmadı; önceki bağımsız inceleme bu son ekleri kapsamaz.
Yeni sürüm için 30k performans kabulü ayrıca gereklidir.

EN: A later native trace measured bundled OAB metadata read/parse/index cost;
`8c575ecd` moves it into the common pool. File identity and ordered generation
admission, source-free byte accounting, live cookie/area/OAB.VIEW gates,
mtime-preserving replacement and exact JSON bytes have coverage. A real HTTP
test also found and fixed RED → GREEN an output lease retained after a client
disconnected before completion. The primary agent reviewed these additions;
the final scope passed 1,278 tests in 168 files. The user's one-independent-pass
limit was respected: no second pass was requested, and the earlier independent
review does not cover these final additions. New-version 30k performance
acceptance remains required.

## İkinci inceleme: Claude / Second review: Claude

TR: Kullanıcının 07.11.2026 koordinasyon talimatı, ilk turun kapsamı dışında
kalan diff için ayrı bir salt okunur Claude incelemesini açıkça istedi.
Kullanıcı üzerinden alınan sonuç `7012eb3f..639372a4` aralığını kapsar
(first-parent 10 commit ve `723d7c62` main merge). Claude kod değiştirmedi;
şüpheli yolları ayrı worktree'de gerçek worker ile probladı. Bu bölüm,
yukarıdaki tarihsel tek-tur açıklamalarının ardından verilen yeni yetkiyi
kaydeder. Yeni özellik/optimizasyon kapsamı donduruldu; yalnız Faz 5 kapanışı
ve inceleme bulguları üzerinde çalışılır. İnceleme sırasında rebase veya
force-push yapılmadı. `639372a4` sonrası değişiklikler ayrıca delta'dır.

EN: The user's 7 November 2026 coordination instruction explicitly requested
a separate read-only Claude review of the diff beyond the first review.
The findings supplied through the user cover `7012eb3f..639372a4`
(10 first-parent commits and the `723d7c62` main merge). Claude changed no
code and probed suspect paths with the actual worker in a separate worktree.
This records the new authorization after the historical one-pass statements
above. Feature/optimization scope is frozen; only Phase 5 closure and review
findings remain. No rebase or force-push occurred during review. Changes after
`639372a4` are a separate delta.

| Bulgu / Finding | Durum / Status |
| --- | --- |
| B1 — Gerileme, aşama maliyetleri ve 200 ms kabul açığı / Regressions, stage costs and 200 ms acceptance | **Açık.** `639372a4` serisinin ardından son `fa580f89` kodunda tekrar 3+3 F0 ve üç ayrı açılış tamamlandı. Altı F0 ve üç açılış doğruluk kontrolleri geçti; iki F0 Overview ve iki ayrı açılış performans kabulünü geçemedi. Refresh 52,962 → 64,102 sn (+%21); CP aynı-sekme 59,342 → 53,067 sn, Orders 3,659 → 3,689 sn. Eski CP/Orders gerilemesinin kök nedeni kanıtlanmadı; son seride aynı oranlar yeniden üretilmedi. Aşama tanısı replica/kodlama/yazma/tekrar hash/decode maliyetlerini doğruladı; kuyruk <0,3 ms. OAB soğuk senkron I/O köküne sınırlı düzeltme yapıldı; kalan boşlukların nedeni bilinmiyor. Refresh ödünleşimi kullanıcı kararı bekler. / **Open.** Final matched 3+3+3 completed at `fa580f89`; correctness passes, responsiveness fails. Refresh regresses 21%; the former CP/Orders ratios are not reproduced or claimed fixed. Source lifecycle costs are measured, queue wait is not the cause. The traced OAB cold I/O is fixed, remaining gaps are unresolved, and the refresh tradeoff needs the user. |
| B2 — LFL sürüm kuralının kopyalanması / Duplicate LFL source-version rule | Düzeltildi. MAIN hydration ve native worker aynı `collection-lfl-source-version.js` yardımcısını kullanır. `lflLoadedAt:null` ve model snapshot'ı mevcutken eski `available:true/version=loadedAt` davranışı korunur; explicit-LFL ve savedAt geri dönüşleri de gerçek worker ile eşdeğerdir. Eski kodda native eşdeğerlik testi geçti, ortak yardımcı sözleşmesi RED oldu; çıkarımdan sonra ikisi de GREEN. / Fixed. MAIN hydration and the native worker share one helper. The pre-existing available/version semantics, including an empty LFL with a model snapshot, explicit LFL time and savedAt fallback, remain equal. Native equality passed before extraction; the shared-helper contract failed RED, then both passed GREEN. |
| B3 — Paket dışı OAB metadata taşımasının sıcak/soğuk maliyeti / Hot/cold cost of out-of-package OAB metadata offload | Düzeltildi: taşıma geri alındı. Aynı runtime'da eski üç route gövdesiyle yapılan kontrollü HTTP A/B'de soğuk medyan 40,274 → 221,944 ms, sıcak p95'ler Seasons 6,952 → 22,813; MAG 9,189 → 25,325; Buyer Group 6,684 → 24,721 ms oldu. Üç taze süreç çifti ve uç/kol başına 300 sıcak örnek alındı; 1.818 yanıtın baytları eşdeğerdi. Net kazanç doğrulanmadı. Yerel OAB yolu ve alan/capability kapıları geri geldi; daha sonraki B1 yerel async I/O düzeltmesi aşağıda ayrılır. INT-12 açık. HTTP bağlantı-kopması lease düzeltmesi korunur. / Fixed by rollback. A controlled HTTP A/B on the same runtime used the exact pre-offload route bodies. Cold median was 40.274 → 221.944 ms; warm p95 values regressed for all three endpoints. Three fresh-process pairs and 300 warm samples per endpoint/arm produced 1,818 byte-equivalent responses. No net gain was established. The local route and area/capability gates were restored; the later B1 local async I/O fix is recorded separately below. INT-12 stays open. The HTTP disconnect lease fix remains. |

TR/EN: B2 kanıtı / B2 evidence: `/tmp/phase-5-review2-b2-red.txt`,
`/tmp/phase-5-review2-b2-green.txt`; yeni native test /
new native test: `compute-collection-lfl-source-version.test.js`.
Merge beklemede; TEST ve STABLE yayımlanmadı. /
Merge remains blocked; neither TEST nor STABLE was published.

TR: B3 ölçümünde iki kolda da aynı 30k demo seed, paket metadata SHA'sı,
yetki kodu, ortak havuzun normal açılış ısınması ve gözlemci kullanıldı. Eski
kol yalnız üç route'un üretimdeki pre-offload gövdesini dış tanı preload'u
ile derleme sırasında kurdu; repository dosyaları ölçüm sırasında değişmedi.
Bu, 30k Chromium açılış kabulünün yerine geçmez ve soğuk OS cache değildir.
Ham kayıt /tmp/phase-5-review2-b3-http.json içindedir. Geri alma regresyonu
önce RED oldu; önceki ana dal testleri silinmedi veya gevşetilmedi. Yalnız
bu PR'da eklenen ve artık çıkarılan worker özelliğine ait iki test dosyası,
geri alınan kaynakla birlikte PR'dan çıktı; kanonik yanıt/kapı/400
doğrulamaları mevcut testler ve yeni oab-metadata-local-route.test.js ile
korunur. Önceki commit'ler ve ölçüm kanıtları saklanır. Yayınlanmamış, yalnız
bu özelliğe ait sürüm notu kaldırıldı; ana dalın kayıtları korunur.

EN: Both B3 arms used the same 30k demo seed, bundled metadata SHA, authority
code, normal common-pool startup warmup and observer. The before arm installed
only the exact three pre-offload production route bodies through an external
diagnostic compilation preload; repository files stayed unchanged during
measurement. This is not a substitute for Chromium opening acceptance or a
cold OS-cache result. Raw samples are retained in
/tmp/phase-5-review2-b3-http.json. The rollback regression first failed RED.
No pre-existing main-branch test was deleted or weakened. The two test files
added solely for the removed worker feature left this PR with that feature;
canonical payloads, guards and 400 validation remain covered by the original
tests and oab-metadata-local-route.test.js. Original commits/evidence remain
available. Only the unreleased note for this removed feature was withdrawn;
main's entries are intact.


### 639372a4 sonrası delta / Post-639372a4 delta

- `285d8fe5d57fb987a3b480046983e680ed9f4a8f`: B2 ortak LFL helper ve native eşdeğerlik / shared helper and native equality.
- `c799fe4143b192db45bac2e5e77b4b44f43707de`: B3 worker OAB geri alımı; HTTP abort lease düzeltmesi korunur / worker OAB rollback, HTTP abort release retained.
- `06399a53ca504d313b8df66b50756d29d278c773`: B1 ölçülmüş soğuk OAB okumasına yerel async I/O, single-flight, eski yayın reddi ve canlı yetki kapısı / measured cold-read fix with local async I/O, single flight, stale rejection and live authority.
- `fa580f89c1cdce75160d78b2c56c2876fb315f68`: gerçek TR/EN PNG ve doğru yerel I/O sürüm notu / actual TR/EN captures and accurate local-I/O release note.
- Son test/doküman deltası / final test/document delta: üretim automationError facade'ı ile birebir hata-metin testi; son 3+3+3, 15 tam JSON eşdeğerliği ve aşama ölçümlerinin raporu. / Exact production error-facade test and the final cohort/equality/stage evidence.

TR: Bu delta Claude tarafından yeniden incelenmiş değildir. Düzeltmeleri
ana agent uyguladı; son ilgili paket 177 dosya / 1.328 test PASS, atlama ve
başarısızlık sıfır. i18n 0/0, release notes 32 PASS. Eski inceleme onayı
yeni SHA'ya taşınmaz. Son SHA, PR açıklaması ve kullanıcıya verilen raporla
sabitlenir; salt okunur delta incelemesi kullanıcı üzerinden Claude'a gider.
Rebase/force-push yapılmadı; merge öncesi durulur.

EN: Claude has not reviewed this delta. The primary agent implemented the
fixes; the final relevant 177-file / 1,328-test package passes with zero
failures/skips. i18n is 0/0; 32 release notes validate. Earlier review/checks
do not approve a new SHA. The final SHA is pinned in the PR and user handoff
for read-only delta review through the user. No rebase/force-push occurred;
merge remains gated.

TR: B3'ten sonraki yerel async düzeltme her isteğe worker/gzip eklemez.
Soğuk istek medyanı 45,164 → 77,412 ms; sıcak sonuçlar karışıktır, hızlanma
diye sunulmaz. Üç soğuk örnekte eski 262 ms boşluk görülmedi fakat genel
200 ms kabulü sağlanmadı. Son bir tanısal izde kalan boşluklar tekrarlandı;
process bellek/CPU istatistiği çağrıları hipotezi doğrulanmadı. Kalan kök
neden bilinmiyor; kanıtsız yeni optimizasyon veya eşik değişikliği yok.

EN: The later async fix does not reintroduce worker/gzip per request. Cold
median is 45.164 → 77.412 ms, warm results are mixed, and no request speedup
is claimed. Three async cold samples lack the earlier 262 ms gap, but the
overall 200 ms criterion still fails. A final diagnostic reproduced gaps
without establishing the native-statistics hypothesis. The remaining cause
is unknown; no speculative optimization or threshold change was made.
