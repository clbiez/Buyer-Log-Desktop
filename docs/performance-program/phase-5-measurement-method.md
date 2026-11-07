# Faz 5 · Ölçüm koşulları / Measurement conditions

TR/EN: Güncel ikinci-inceleme sonucu / Latest second-review result:
[phase-5-review2-report.md](phase-5-review2-report.md).
Son sabit 3+3+3 seri `fa580f89` üzerinde tamamlandı; doğruluk geçti,
performans kabulü başarısız. / The final fixed cohort passed correctness,
failed responsiveness. Aşağıdaki eski seriler tarihsel kanıttır. /
Earlier cohorts below remain historical evidence.

TR: Bu belge bir performans kabulü veya kök neden onayı değildir. Sonuçlar
yalnız tamamlanmış koşulara bağlanır. Linux, Node 24.19 ve headless Chromium
kullanılır; Windows/Electron doğrulanmış değildir. CPU kotası
`1600000 400000` (dört CPU), varsayılan izinli işlemci listesi `0–4`, Node'un
kota farkındalığı olan `availableParallelism` değeri dörttür.

EN: This document does not approve performance acceptance or a root cause.
Claims must refer to completed runs. The environment uses Linux, Node 24.19
and headless Chromium; Windows/Electron are unverified. The CPU quota is
`1600000 400000` (four CPUs), the default allowed CPU list is `0–4`, and Node's
quota-aware `availableParallelism` reports four.

TR: `cf53f2d2` kodunda üç tam Faz 0 koşusu doğru satır/generation/revizyonla
geçti. Koleksiyon sonrası Overview boşlukları 127,7 / 111,9 / 111,4 ms oldu.
Aynı kodun ayrı interaktif serisinde üçüncü Global Flow penceresinde tek
293,5 ms aşımı vardı; bu seri kabul edilmedi. Diğer iki koşu ve üç Backlog
penceresi 200 ms altında kaldı. Önceki başarısız seriler silinmedi veya
başarılı örneklerle değiştirilmedi.

EN: Three complete F0 runs at `cf53f2d2` passed row, generation and revision
checks. Overview gaps after Collection were 127.7 / 111.9 / 111.4 ms. A separate
interactive cohort at the same code had one 293.5 ms exceedance in its third
Global Flow window and was not accepted. The other two runs and all three
Backlog windows stayed below 200 ms. Earlier failures remain retained.

TR: Native CPU profilli tanısal seride iki koşu sınır altında kaldı; üçüncü
Backlog penceresinde aşım yeniden oluştu. Bazı profil aralıkları idle veya
küçük runtime çağrılarıyla eşleşti; küçük bir profile ait JSON parse süresi
tek başına hesaplama kök nedeni olarak kabul edilmedi. Bu yardımcıdaki CPU
zamanlayıcısı kancası, gözlemci modülü otomatik başladıktan sonra kurulduğu
için bağlanmamıştı; bu seriden per-thread CPU aralığı sonucu çıkarılmadı.
CPU profili, native çağrı zamanları ve GC kayıtları ise saklanır.

EN: Two native CPU-profile diagnostic runs stayed below the limit; the third
Backlog window reproduced exceedances. Some sampled ranges matched idle or
small runtime frames. A small profile's JSON parsing duration alone was not
treated as a computation root cause. This helper installed its timer hook
after the observer auto-started, so per-thread CPU interval data was absent
and is not claimed for that cohort. CPU profiles, native timings and GC
records remain retained.

TR: Sonraki kontrollü tanı serisinde dört ve beş izinli işlemciyle üçer koşu
dönüşümlü çalıştı. Beş işlemcili üç koşu sınır altında kaldı; dört işlemcili
iki koşuda aşım oldu. Bir aşımda ana thread yaklaşık 230,5 ms içinde yalnız
0,34 ms CPU kullandı; kontrol worker'ı da eşzamanlı bekledi. GC, cgroup kota
aşımı veya bellek reclaim kaydı bu aralıkla örtüşmedi. İşlemci sabitleme
çözüm olarak uygulanmadı. İlk denetleyicinin `availableParallelism` değerini
izinli liste uzunluğu sanan assertion'ı düzeltildi; asıl başarısız denetleyici
kaydı korundu ve uygulama kabul eşiği değiştirilmedi.

EN: A controlled diagnostic alternated three runs with four and five allowed
CPUs. All five-CPU runs stayed below the limit; two four-CPU runs exceeded it.
In one exceedance MAIN used only 0.34 ms CPU during roughly 230.5 ms wall time,
while the control worker waited concurrently. No GC, cgroup throttling or
memory reclaim overlapped that range. CPU affinity was not adopted as a fix.
The controller's assertion incorrectly equating `availableParallelism` with
affinity cardinality was corrected; its failed ledger remains retained and
the application acceptance threshold was unchanged.

TR: Ayrı, iş yapmayan bir Node süreciyle alınan üçlü tanıda eşzamanlı gecikme
örnekleri görüldü; ortak worker GC'si bu aşım aralıklarıyla örtüşmedi. Bu,
ortam/zamanlama bileşeni için kanıttır; ilk normal 293,5 ms örneğinin kesin
kök nedenini kanıtlamaz. Özel tanı yardımcıları kabul ölçümü sayılmaz.

EN: A further three-run diagnostic observed simultaneous delay samples in an
independent idle Node process; common-worker GC did not overlap the exceedance
ranges. This supports an environment/scheduling component, but does not prove
the exact cause of the original normal 293.5 ms sample. Diagnostic helpers are
not acceptance measurements.

TR: İlk genişletilmiş normal gözlemci CPU sayacını MAIN'de her 10 ms'de
okuyordu. Küçük yük kalibrasyonu bunu aklamadı: dokuz taze süreçte dört demo
hesap worker'ı altında thread sayacının en büyük çağrısı 3,419 ms olsa da
sonraki tam 30k native izinde aynı gözlemci çağrısı 212,223 ms sürdü.
Bu tanısal örnek sayacın ölçülen thread'de duraklama ekleyebileceğini gösterir;
önceki tüm aşımların nedeninin sayaç olduğunu kanıtlamaz. O sürümle alınmış
normal/tanısal sonuçlar ham hâliyle korunur, yeni gözlemciyle karıştırılmaz.

EN: The first extended observer queried CPU on MAIN every 10 ms. A small load
calibration did not establish its safety: across nine fresh processes with
four generated-data compute workers, the largest thread-counter call was
3.419 ms, but a later complete 30k native trace recorded a 212.223 ms call
from that same observer. This diagnostic sample shows that querying CPU on
the measured thread can add a pause; it does not prove that it caused every
earlier exceedance. Those normal and diagnostic results remain retained and
are not pooled with the corrected observer.

TR: Güncel gözlemcinin MAIN yolu yalnız aynı 10 ms zamanlayıcıdaki saat
farkını ve GC aralıklarını sayısal halkaya yazar. CPU, RSS, stack, JSON/UTF-8
ve dosya işlemi MAIN'de yapılmaz. Gözlemci worker'ı Linux'ta
`/proc/PID/task/PID/stat` üzerinden ana thread CPU'sunu yaklaşık 100 ms
aralıkla okur. `getconf CLK_TCK` yalnız worker başlangıcında kullanılır.
Her boşluğun CPU değerine onu çevreleyen örnekleme penceresi, saat çözünürlüğü
ve `cpuApproximate` işareti eklenir; bu değer boşluğun tam CPU süresi gibi
sunulmaz. Desteklenmeyen platformda CPU açıkça unavailable'dır. GC ayrı kayıt
tipidir ve timer stall sayısına eklenmez. Bozuk CPU/GC/pencere kaydı reddedilir.
200 ms eşiği ve tam sınır boşluğu kuralı değişmez. İki CPU API'si MAIN'de
hata verecek şekilde kapatılmış gerçek süreçte gözlemci çalışmaya devam eder;
yeni test önce RED olmuştur.

EN: The corrected observer's MAIN path writes only clock differences from
the same 10 ms timer and numeric GC ranges to its ring. MAIN performs no CPU,
RSS, stack, JSON/UTF-8 or observer file operations. On Linux the observer
worker samples MAIN CPU through `/proc/PID/task/PID/stat` approximately every
100 ms; `getconf CLK_TCK` runs only during worker startup. Each gap's CPU
estimate includes its surrounding sample window, clock resolution and
`cpuApproximate` label. It is not presented as exact CPU during the gap.
Unsupported platforms explicitly mark CPU unavailable. GC remains separate
from timer stalls; malformed CPU, GC and sample-window records reject.
The 200 ms threshold and full-gap boundary rule remain unchanged. A real
process continues recording when both CPU APIs are replaced with throwing
functions on MAIN; that new regression first failed RED.

TR: İlk genişletilmiş gözlemcinin mikro ölçümü altı taze süreçte, dönüşümlü üç önce/sonra koşusu ve
açılış sonrası iki saniyelik pencerelerle yapıldı. Ana thread CPU medyanı
9,295 → 10,273 ms/s oldu (ek yaklaşık 0,979 ms/s). Bu bir uygulama hızlanması
değildir; gözlemci maliyetidir. Ham dosyalar ve özet kanıtla birlikte tutulur.

EN: The first extended observer's micro used six fresh processes, three alternating
before/after runs and two-second windows after startup. Median MAIN CPU was
9.295 → 10.273 ms/s, an additional approximately 0.979 ms/s. This measures
observer overhead, not an application speedup. Raw files and the summary are
retained with the evidence.

TR: CPU okuması worker'a taşınan sürüm için aynı iki saniyelik idle mikro
ölçümü, üç dönüşümlü taze süreç çiftiyle tekrarlandı. MAIN CPU medyanı
10,174 → 7,823 ms/s oldu. Bu yalnız küçük idle penceresinin gözlemci
maliyetidir; 30k uygulama kazancı veya yük altındaki kuyruk gecikmesinin
çözüldüğü sonucu çıkarılmaz.

EN: The worker-sampled version repeated the same two-second idle micro with
three alternating fresh-process pairs. Median MAIN CPU was
10.174 → 7.823 ms/s. This measures observer cost in a small idle window;
it is not a 30k application speedup or proof that loaded tail latency is fixed.

TR: `/tmp` bir tmpfs'tir; geçmiş kanıtları korurken neredeyse doldu. Yeni
koşular yalnız komutun `TMPDIR` değeriyle özel overlayfs dizinini kullanır.
Fixture'ın doğrudan sistem temp dizininde olması, symlink reddi, sentetik
marker ve SHA kontrolleri değiştirilmez. Kaynak anchor dosyaları yeni temp
dizinine birebir SHA doğrulamasıyla kopyalanmıştır; eski anchor değişmez.
Önce ve sonra aynı yeni depolama/gözlemci koşulunda alınır. Eski sayılarla
doğrudan depolama kazancı veya soğuk OS cache iddiası yapılmaz. Geçmiş
dosyaların arşivlenmesi yalnız koşular arasında, byte/SHA ve mtime korunarak,
eski yolları symlink ile erişilebilir tutarak yapıldı; audit veya kimlik
dosyaları taşınmadı.

EN: `/tmp` is tmpfs and became nearly full while retaining historical evidence.
New runs use a private overlayfs directory through the command's `TMPDIR`.
Direct-child temp-root, symlink rejection, synthetic marker and SHA guards
remain unchanged. Source anchor files were copied to the new temp root with
exact SHA verification; the old anchor is unchanged. Both arms use the same
new storage and observer conditions. No storage speedup versus historical
numbers or cold OS-cache claim is made. Historical files were archived only
between runs, with byte/SHA and mtime preservation and symlinks retaining
their original paths. No audit or identity files were moved.

## 2026-11-07 — complete worker-observer cohort and the OAB follow-up

TR: [Doğrulandı] `764079b3` için sabit dokuz koşuluk seri tamamlandı:
üç baz, üç yeni-kod F0 ve üç ayrı açılış. Altı F0 koşusunun satır,
revizyon ve generation kontrolleri geçti. Yeni kodda Overview maksimumları
190,432 / 108,901 / 198,294 ms idi; ayrı açılışların üçü de kabulü geçemedi.
Global Flow maksimumları 1841,462 / 107,716 / 203,630 ms, Backlog
82,695 / 255,292 / 112,158 ms oldu. Başarısız örnekler korunur.
`phase-5-worker-observer-cohort-summary.json` tüm tekrarları ve medyanları
saklar. Yenileme iş medyanı 48,775 → 63,760 sn ile kötüleşti; aynı-sekme
CP 43,890 → 53,790 sn, Orders 2,348 → 2,844 sn oldu. Bunlar OAB ek
çalışmasından önceki sürümün sonuçlarıdır. Sonraki kod için kazanç iddiası
çıkarılmaz. Yeni kodda refresh health p95 medyanı 277,012 ms idi. Baz
sürümde `/api/health` 404 döndüğü için başarılı health baz çizgisi yoktur;
başarısız isteklerin duvar süreleri ayrı tutulur.

EN: [Verified] The fixed nine-run cohort at `764079b3` completed: three
baseline F0, three after F0 and three separate openings. All six F0 row,
revision and generation checks passed. After-version Overview maxima were
190.432 / 108.901 / 198.294 ms; all three separate openings failed acceptance.
Global Flow maxima were 1841.462 / 107.716 / 203.630 ms and Backlog maxima
82.695 / 255.292 / 112.158 ms. Failed samples are retained. The adjacent
cohort JSON contains all repeats and medians. Median refresh job time regressed
48.775 → 63.760 s; same-tab CP was 43.890 → 53.790 s and Orders
2.348 → 2.844 s. These results precede the OAB follow-up and establish no gain
for later code. Median after-version refresh health p95 was 277.012 ms.
The baseline `/api/health` returned 404, so no successful health baseline
exists; failed-request wall times are kept separately.

TR: Seri bittikten sonra 180 tamamlanmış sentetik XLSX kopyası
(4.430.298.480 bayt) overlayfs arşivine taşındı; SHA, boyut ve mtime doğrulandı,
eski dosya yolları atomik symlink ile korundu. Ana fixture, marker, audit ve
kimlik dosyaları değiştirilmedi. `/tmp` doluluğu yaklaşık 8,5 → 4,4 GB oldu.
Bu bakım bir hızlanma veya kök neden kanıtı değildir. Sonrasında alınan üç
native tanılama koşusu ayrı tutulur; CPU profiler ve çağrı sarmalayıcıları
normal kabul ölçümüne dahil değildir. Son tanılamada çok saniyeli timer/HTTP
beklemeleri de görüldü. Profil örnek ağırlıkları duvar süresidir; CPU süresi
olarak yorumlanmaz. Bu yardımcıda koşu başına monotonic/epoch offset'i
kaydedilmediğinden profile-window hizalaması sonradan ölçülen offset ile
**yaklaşıktır**; native çağrı, GC ve timer epoch kayıtları doğrudandır.

EN: After the cohort, 180 completed synthetic XLSX copies (4,430,298,480 bytes)
were archived to overlayfs with verified SHA, size and mtime; atomic symlinks
preserve their former paths. The anchor, markers, audit and identity files
were untouched. Tmpfs usage fell from about 8.5 to 4.4 GB. This maintenance
establishes neither a speedup nor a root cause. Three subsequent native
diagnostic runs remain separate: CPU profiling and call wrappers are not
normal acceptance measurements. The final diagnostic also saw multi-second
timer/HTTP delays. Profile sample weights are wall time, not CPU time.
That helper omitted a per-run monotonic/epoch offset, so profile-window
alignment uses a later offset and is **approximate**. Native-call, GC and
timer epoch records are direct.

TR: [Doğrulandı] Bir native trace'te OAB'nin 1.892.622 karakterlik sabit
filtre kaynağının senkron okuması 176,976 ms, JSON parse'ı 98,595 ms sürdü;
ikisi 389 ms'lik aynı MAIN aralığındaydı. `8c575ecd` üç filtre ucunun
okuma/parse/indeksleme ve serileştirmesini ortak havuza taşır. Sabit dosya
kimliği, gerçek bayt bütçesi, sıralı generation kabulü, canlı oturum + alan +
OAB.VIEW kapıları ve hazır gzip kullanılır. Mtime korunarak dosya değiştiğinde
worker indeksleri de yenilenir. Ayrıca gerçek HTTP RED testi, istemci iş
bitmeden koparsa tamamlanan çıktı lease'inin bırakılmadığını gösterdi;
ortak yanıt yolu artık bu durumda baytları bırakır. Son doğrulama:
168 dosyada 1.278 test geçti, i18n yeni/baseline eksik 0/0. Bu değişikliklerin
büyük tanılama beklemelerinin tamamını açıkladığı veya yeni 30k kabulünü
geçtiği henüz doğrulanmış değildir.

EN: [Verified] One native trace recorded a 176.976 ms synchronous read and
98.595 ms JSON parse for the 1,892,622-character bundled OAB filter source,
inside the same 389 ms MAIN gap. `8c575ecd` moves reading, parsing, indexing
and serialization for all three filter endpoints into the common pool.
It uses a fixed file identity, actual byte admission, ordered generation
admission, live session/area/OAB.VIEW gates and ready gzip. Worker indexes
also refresh when a replacement preserves mtime. A real HTTP RED test
additionally proved that a client disconnect before completion leaked the
completed output lease; the common response path now releases those bytes.
Validation passed 1,278 tests in 168 files, with i18n new/baseline gaps 0/0.
These fixes do not yet establish the cause of every long diagnostic delay
or a passing new 30k acceptance cohort.

TR/EN: Gerçek görsel kanıt / actual visual evidence:
`phase-5-visual-evidence.json`, `assets/phase5-lfl-reference-en-dark.png`,
`assets/phase5-oab-filters-en-dark.png` ve pending release-note PNG'leri.
Yalnız görsel fixture S6/S7 sezonlarını kullanır; 30k anchor değişmez.
Görsel koşunun veri kontrolleri geçti, timing sonucu başarısız kaldı ve
kabul ölçümü sayılmadı. / Only the visual fixture uses S6/S7 seasons; the
30k anchor is unchanged. Visual correctness passed; its failed timing
result is retained and is not acceptance evidence.

## Matching the current main baseline

TR: Faz 5 taslağı açıldığında `main` ayrıca #882 (avatar), #884 (yenileme
sırasında sunucu yeniden başlaması) ve #883 (LCW AI Merch Calendar) değişikliklerini
almıştı. Birleştirmede yalnız pending sürüm notları çakıştı; 30 ve 27 kaydın
ortak kimlikleri korunarak 32 kayıt elde edildi. Yeni eşleşen serinin baz
kodu `270228a4` olacak; bu üç değişiklik önce/sonra iki tarafta da bulunur.
Eski `4fb38773` baz checkout'u ve ölçümleri tarihsel kanıt olarak korunur.
Ana dal ile birleşik ilgili kapsam 174 dosyada 1.321 test geçti; i18n 0/0,
sürüm notları validator'ı 32 kayıt geçti.

EN: When the Phase 5 draft opened, main had also received #882 (avatar),
#884 (refresh-server restart detection) and #883 (LCW AI Merch Calendar).
Only pending release notes conflicted; retaining the common IDs from the
30- and 27-entry versions produced 32 entries. The new matched cohort will
use `270228a4` as its baseline so both arms contain those three changes.
The old `4fb38773` checkout and measurements remain historical evidence.
The combined main integration passed 1,321 relevant tests in 174 files,
i18n 0/0 and validation of all 32 release-note entries.

## PR fast-check regression

TR: GitHub run `42363483382`, job `128376521934` başarısız oldu: navigation
testi, worker'a taşınan Backlog export'un eski MAIN çağrısını arıyordu. Yerel
1.321 test filtresi navigation dosyasını içermediği için bunu kaçırdı.
Korunan regresyon silinmedi: aynı test artık gerçek route'un worker ve cache
bağlantısını, tüm query girdilerinin cache anahtarına ulaşmasını, gerçek ortak
read-service üzerinde in-flight paylaşımını, kaynak/kapsam/yetki değişimlerini,
60 saniyelik TTL'yi ve bütün çıktı lease'lerinin bırakılmasını doğrular.
Test önce RED, sonra 7/7 GREEN oldu. Workflow'un 24 adımı Node 24.19'da
harici paket yüklemeleri engellenerek, özel demo veri/temp köklerinde
çalıştırıldı: 728 test, sıfır başarısızlık ve skip. İlk yerel yardımcıda
`TMPDIR` özel temp köküyle eşleşmediği için PLM testleri güvenli yazma sınırına
takıldı; yardımcı düzeltildi, üretim yazma sınırları değiştirilmedi ve ilk
başarısız kayıt korundu. Bu yerel sonuç GitHub CI sonucunun yerine geçmez.

EN: GitHub run `42363483382`, job `128376521934` failed because the navigation
test expected the old MAIN call for Backlog export, which now runs in a
worker. The local 1,321-test filter omitted that navigation file. The protected
regression remains: the same test now checks the live route's worker/cache
wiring, every query input reaching the cache key, in-flight sharing through
the actual read-service, source/context/authority invalidation, the 60-second
TTL and release of every output lease. It failed RED before passing 7/7.
All 24 workflow steps then ran locally on Node 24.19 with external package
loads blocked and isolated demo data/temp roots: 728 tests, zero failures or
skips. The first local helper did not align `TMPDIR` with its private temp
root, so PLM tests hit the safe-write boundary. Only the helper was corrected;
production write boundaries and the failed log remain unchanged. Local
success does not substitute for actual GitHub CI.
