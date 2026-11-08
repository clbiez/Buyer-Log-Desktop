# Analytics renderer — current Main acceptance / güncel Main kabulü

## TR

#904, Main `5b8c1e6f` (#912/#901/#914 dahil) ile **normal merge**
`e5e4a7ed` üzerinden güncellendi. Rebase/force-push yapılmadı. Yedi analitik
üretim modülü incelenen `8657e8ec` ile byte düzeyinde aynı; yeni optimizasyon yok.
Main'in 42 kayıt nesnesi ve kendi üç TR/EN kaydı korundu: **45 not**. V946
loader/worker assertion'ları iki taraftan korundu; query-cache'in Main native
worker guard testi alındı. Canonical alan, authority veya IAM üretim koduna özgün
müdahale yoktur. Eski 6/1 IAM koşuları kendi ortam ve SHA'larında tarihsel kalır;
bu yeni tam PASS genel IAM güvenlik bulgusunun çözümü değildir (#915 ayrı P1).

**Son standart koşu:** `npm test`, varsayılan concurrency4, private TMPDIR,
NODE_OPTIONS/preload olmadan tek çağrıda **bütün 10 batch**:
**1.295 dosya / 8.885 PASS / 0 FAIL / 65 mevcut SKIP / 0 CANCEL**, 220,5 sn.
İlgili paket **227 PASS**; i18n **0/0**, release-note validator **45 PASS**.
Test edilen uygulama ağacı `991608d7e43443fca8a6f042ab42305c76660a1b`.
Son kaynak/test/CI değişmedi; bu ek kanıttır. Son SHA'nın gerçek CI'ı ayrıca
beklenir. Yeni bağımsız genel tur yapılmadı: gpt-6-astra'nın `8657e8ec`
incelemesinde P1/P2 yok; kaynak eşitliği ayrıca doğrulandı.

### Gerçek 30k uygulama kontrolü

Seed7 arşiviyle taze izole server/cache/browser: LFL **30.000** kayıt,
Backlog **37.708** export satırı / **30.000** sipariş. Gerçek tarayıcı worker
cevabı, Backlog parity, LFL sort, yeni analysis revision, reload ve TR/EN değişimi,
sentetik Transit raporunun gerçek API'den kaydı/görünümü doğrulandı. Page error
listesi boş. İlk deneme `ECONNRESET` ile durdu; kesin URL/sinyal kaydedilmedi,
kök neden **[Bilinmiyor]**. Kanıt ve fixture silinmedi. Yeni izole denemede yalnız
GET status/health için Faz0'ın mevcut sınırlı retry'ı kullanıldı; refresh POST
tekrarlanmadı. Süreç normal kapandı, kaydedilen cgroup OOM sayacı artmadı.

Görüntü incelemesi, ilk yeni teslimat capture'ının modül perdesini gösterdiğini
saptadı; analiz görseli olarak kabul edilmedi. Aynı başarılı cache'ten **refresh
POST olmadan** ayrı doğrulama Continue'a bastı, gerçek analysis panelini
`elementFromPoint` ile görünür doğruladı ve yeni PNG aldı. LFL, Transit ve bu
analiz PNG'si incelendi. Mevcut aktif üç sürüm notu PNG'si geçerli ve korunur.
Bu çalışma performans kıyası veya kullanıcı input-latency testi değildir.

### Korunan tarihsel ölçümler

| Madde/senaryo | Renderer timer aralığı | Toplam tamamlanma |
| --- | --- | --- |
| ANA-05 yeni dataset | 673→209 ms | 679→1583 ms |
| ANA-05 mevcut dataset cache miss | 973→474 ms | 981→1362 ms |

ANA-07 LFL sort **180→17 ms**, ANA-11 Transit özeti **249→52 ms** ayrı işlemlerdir.
Bu rakamlar önceki ölçüm kaynağına aittir. Worker toplam süreyi uzatır; input
latency veya genel analiz hızlanması iddia edilmez. Structured-clone maliyeti,
parçalı aktarım sınırları ve kalan bekleme eski raporda korunur. Ölçülen yedi
modül değişmediği için bu operasyon kıyasları gereksiz yere tekrarlanmadı.

[Komutlar, gerçek loglar, source blob karşılığı, bağımsız inceleme ve ekran kanıtı](analytics-post-main-20261107/manifest.json).
**Son CI ve merge onayı beklenir. TEST/STABLE yayımlanmaz.**

## EN

Normal Main merge `e5e4a7ed` includes #912/#901/#914 (`5b8c1e6f`). All seven
reviewed analytics production modules remain byte-identical to `8657e8ec`;
no new optimization was added. The 42 Main notes plus three own entries remain
(45). Both Main lazy-loader expectations and worker regressions are preserved.
No original IAM/server/authority change was made; historical IAM failures remain
historical. This full pass does not resolve the separate #915 security finding.

The unchanged standard `npm test`, default concurrency4, private TMPDIR and no
NODE_OPTIONS/preload passed **all ten batches in one invocation: 1,295 files,
8,885 PASS / 0 FAIL / 65 existing SKIP / 0 CANCEL**, 220.5 seconds. Related package
227 PASS; i18n 0/0; 45 visual notes passed. Tested app tree:
`991608d7e43443fca8a6f042ab42305c76660a1b`. The one gpt-6-astra independent review
at `8657e8ec` found no reportable P1/P2; the unchanged source correspondence is
recorded, without a repeated general round. Final-head CI remains separate.

A fresh real 30k demo run confirmed the browser worker result, Backlog parity,
LFL sort/revision/reload/language handling and saved synthetic Transit UI. The
first probe failed with ECONNRESET; its precise request/signal cause is unknown
and evidence is retained. Only status/health GETs received existing Phase0 bounded
retry in the new fresh run; no refresh POST retry. The process exited normally
and recorded cgroup OOM counters did not increase. The first new delivery capture
showed the module curtain and was rejected as an analysis screenshot. A separate
no-refresh cache-resume check explicitly clicked Continue, verified unobscured
analysis with elementFromPoint, and produced an inspected correct screenshot.

Historical timings above retain their original source. ANA-05 reduces measured
renderer timer gaps while increasing total completion; it is not input latency or
general analysis speedup. Clone/transfer limits remain. ANA-07/11 are separate
operation gains. This current functional smoke is not a new A/B performance run.
**Final-head CI and merge approval pending; no TEST or STABLE.**


## #915 sonrası son kabul / Final acceptance after #915

8 Kasım 2026: Main `d77f83e5` (#915, kullanıcı onayıyla merge edildi)
normal merge `fe490f5e` ile alındı. Test edilen uygulama ağacı
`20cc30a171db9121f4809f6997312bc71d02e765`. Standart `npm test`, tek çağrıda bütün
10 batch, varsayılan concurrency=4, izole TMPDIR ve NODE_OPTIONS/preload
olmadan: **1296 dosya / 8902 PASS / 0 FAIL / 65 mevcut SKIP /
0 CANCEL**. İlgili paket **227 PASS**, i18n **0/0**, sürüm notları
**46 PASS**. Tarihsel sonuçlar korunur; bu kayıt yeni performans
kazancı iddiası değildir. Son commit'in gerçek GitHub kontrolleri ayrı kapıdır.

Main `d77f83e5` was imported by normal merge without rewriting the frozen review
history. The unchanged standard runner passed all ten batches in one invocation:
**1296 files / 8902 PASS / 0 FAIL / 65 existing SKIP / 0 CANCEL**,
default concurrency4, private TMPDIR, no NODE_OPTIONS/preload. Related package
227 PASS; i18n0/0; 46 visual notes valid. Own production changes
and their reviewed behavior were preserved; the new runtime delta imports the
separately reviewed and merged current-authority fix. Evidence-only additions
after these checks do not change source, tests, validators or CI. Historical
benchmark limitations remain. Actual final-head CI and merge approval are still
separate. **No TEST/STABLE publication.**


## #906 sonrası son kabul / Final acceptance after #906

Main `9cac3823` normal merge `2ffed133` ile alındı. Yedi
analitik üretim modülü inceleme `8657e8ec` ile birebir. Diğer 46 Main notu
ve üç kendi kayıt korunur. Standart tam npm test bütün 10 batch tek çağrıda:
**1.300 dosya / 8.926 PASS / 0 FAIL / 65 mevcut SKIP / 0 CANCEL**; varsayılan
concurrency4, izole TMPDIR, NODE_OPTIONS/preload yok. İlgili227PASS, i18n0/0,
49 not PASS. Test edilen uygulama ağacı `044c2d8d6c8fc4336675a8e0e45e2c566492bebe`.
Ölçülen kendi kaynakları değişmedi; aynı kampanya tekrarlanmadı. ANA-05'in
daha uzun toplam tamamlanma süresi ve eski ham kanıtlar korunur.

Main `9cac3823` was merged normally. The seven reviewed analytics source blobs
remain byte-exact `8657e8ec`. Standard full runner passed all ten batches in one
invocation:1300 files,8926PASS,0FAIL,65existingSKIP,0CANCEL; defaultconcurrency4,
privateTMPDIR,noNODE_OPTIONS. Related227PASS,i18n0/0,49visualnotes valid.
Final evidence-only changes keep source/test/CI identical. Actual final-head CI
is a separate gate under explicit conditional sequential merge permission.
ANA-05's longer completion remains disclosed; no general speedup or input-latency
claim. No TEST/STABLE.
