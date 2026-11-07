# Faz 7 sunucu ölçüm yöntemi / Server measurement method

TR: Ön koşul GitHub metadata ile doğrulandı: #885, `main` hedefine `76ddbaf4a2a85132d2ad9dff8d1465377e1f81aa` ile merge edilmiş. Baz, bunun sonraki entegrasyon düzeltmelerini de içeren `63159fb32ff3d5bdc5f142b4a8f16ca6a3983240` (#902). Eski Faz 5 sayıları yeni baz yerine kullanılmadı.

EN: GitHub metadata confirms #885 merged into main at `76ddbaf4`. The baseline is subsequent integration commit `63159fb3` (#902), including the follow-up fixes. Historical Phase 5 timings are not the baseline.

TR: Linux / Node 24.19.0 / dört CPU kotası (`cpu.max=400000 100000`). Her senaryo için altı taze süreç, A1/B1/A2/B2/A3/B3 sırasıyla çalışır. İki kol aynı sentetik girdiyi ve aynı overlayfs temp kökünü kullanır. Üretim iş verisi, gerçek SMB, Windows/Electron veya kurumsal upstream ölçümü değildir. OS cache soğukluğu ve force-GC iddiası yoktur. Başka benchmark, test veya tarayıcı yüküyle eşzamanlı nihai ölçüm yapılmaz.

EN: Linux, Node 24.19.0, four CPUs. Each scenario alternates three fresh-process pairs with identical synthetic input and overlayfs temp storage. No production data, real SMB, Windows/Electron or corporate upstream measurement is claimed. No cold-cache or forced-GC claim; final runs do not overlap tests or browser work.

TR: MAIN'de 10 ms timer yalnız `performance.now()` farklarını belleğe yazar. Başlangıç/bitişi kesen aralıklar tam tutulur; tick saati operasyon sınırında sıfırlanmaz. Operasyondan önce 30 ms, sonra 25 ms gözlem var; en büyük gap ve timer örneklerinin p95'i ham kayıttadır. Bu HTTP p95 veya 30k uygulama açılış kabulü değildir. CPU/RSS/disk anketi timer içinde yoktur. Süreye doğruluk için sonradan yapılan SHA/restore kontrolleri dahil edilmez. Pack'in I/O sayacı çağrıları ölçülen iş içinde sayar; lease ve metadata çağrıları da sayıya dahildir. Parser probe yalnız çocuk sonuç döndürürken bir RSS tepe sayacı okur; MAIN anketi yapmaz. RSS tepe değeri süreç içindir; parser çocuk RSS'i ayrıca verilir, eşzamanlı toplam tepe diye sunulmaz.

EN: A 10 ms MAIN timer records only clock differences. Full intervals crossing the operation boundaries are retained. Timer p95 is not HTTP p95 or whole-application acceptance. Correctness SHA/restore checks run outside the timed operation. Pack counters include leases and metadata. RSS is sampled once after work; parser child peak RSS is separate, not a simultaneous process-tree peak.

```bash
mkdir -p /workspace/phase7-bench-tmp
# Each invocation is a new process. Repeat before/after three times per scenario.
TMPDIR=/workspace/phase7-bench-tmp node resources/app/scripts/phase7-server-benchmark.cjs /workspace/phase7-baseline/resources/app snapshot
TMPDIR=/workspace/phase7-bench-tmp node resources/app/scripts/phase7-server-benchmark.cjs /workspace/Buyer-Log-Desktop/resources/app snapshot
# Scenarios: snapshot, local-images, pack, parser, parser-queue,
# upload-1, upload-5, upload-error, backup-0, backup-1, backup-20.
```

TR: RED logları ve eski/başarısız tanı örnekleri silinmez. İlk test ortamı preloader'ı TEMP_ROOT'u daraltarak altı mevcut testi bozdu; değişmemiş bazda da aynı altı hata çıktı. Sonraki preload'un zorunlu LOCAL_DATA override'ı da varsayılan politikayı sınayan bir testi bozdu; bazda doğrulandı. Son preloader yalnız SERVER_DATA/DATA/CONFIG ayarlar ve normal temp/LOCAL_DATA politikasını korur; üretim yazma güvenliği gevşetilmedi. Bir pilot yedek temp-peak sayacı restore yazılarını da topladığı için nihai sonuçta kullanılmaz. Erken timer sürümü ilk sınır aralığını kesiyordu; son sürüm tam gap tutar. Eşzamanlı testle başlayan seri ve önceki tmpfs serileri ayrı, kabul dışı tanı kaydıdır. Ham arşiv bunları adlarıyla ayırır.

EN: RED, failed setup and diagnostic samples remain retained. Initial TEMP_ROOT and LOCAL_DATA preload overrides broke six and one existing tests, reproduced unchanged on baseline; only the preload was corrected. A pilot backup peak counter included restore writes and is excluded. Earlier clipped-boundary, overlapped and tmpfs runs remain separate diagnostics. Final results use the full-gap observer and overlayfs.

```bash
cd resources/app
NODE_OPTIONS="--require $PWD/scripts/phase7-test-env.cjs" npm test
```

TR: Kullanıcı `public/**` değişikliğini yasakladığından sürüm notları ve gerçek post-change PNG'ler `docs/performance-program/` altında tutulur; uygulamanın pending release-note dosyası veya istemci kodu değiştirilmez. Bu tercih kullanıcı sınırından gelir. Görseller runtime smoke kanıtıdır; küçük gecikme farklarının görsel ispatı sayılmaz. Performans kanıtı ham ölçümlerdir.

EN: The explicit user prohibition on public/** takes precedence: bilingual notes and actual post-change PNGs live under docs/performance-program; the application's pending notes and client remain untouched. Screenshots prove runtime smoke behavior, not latency differences. Raw measurements establish performance.
