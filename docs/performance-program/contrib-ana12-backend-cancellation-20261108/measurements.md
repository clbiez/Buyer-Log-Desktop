# Native iptal ve üç eşli sentetik koşu

Node v24.19.0, Linux, aynı VM; tek worker, 1536 MiB pool bütçesi, 128 MiB pending
input bütçesi. Gerçek `compute-pool.js`, `compute-service.js`, source replica,
`compute-worker.js` ve `compute-tasks.buildBacklog('export', ...)` kullanıldı.
Fixture yalnız sentetik 10.000 sipariş içerir. Tarihler sabit; sorgular
`exFactoryFrom=2026-06-01..10`, 12 ms aralıkla değişir. Builder oracle’ı tüm
sonuç grafiğini gerçek serialize yolu ile karşılaştırır. Tüm test/ölçümler aynı
flock altında seri, NODE_OPTIONS/NODE_PATH kaldırılarak yapıldı.

Native gözlem fixture’ı gerçek worker’ı require eder ve gerçek Backlog builder’ını
başlangıç/bitiş event’leriyle sarar. İş mantığı değiştirilmez, spin/fake worker
kullanılmaz. Worker postMessage dispatch’i, builder başlangıcı, result mesajı,
terminate çağrısı ve native exit ayrı tutulur. Pool’un toplu failed sayacı iptal
sayısı olarak kullanılmaz. Sentetik hazırlık görevleri analitik job sayısına dahil
edilmez; poolAfter’da bu görevler de bulunduğundan aggregate toplamı 11 olabilir.

## Gerçek builder çalışırken durdurma

`evidence/native-stop.json`: gerçek builder start gözlendi; abort öncesi build-end
yoktu. Abort → native exit **3,583 ms**; exit code 1, Worker.threadId -1,
native Linux thread `/proc`’ta yok, result/build-end gelmedi. Exit sonrası pool’da
worker/active/pending/reserved/queuedInput/leasedOutput sıfır.

Abort→exit penceresinde **tüm süreç CPU’su 1,959 ms**. Native thread tick
ölçümü 100 Hz; son gözlenmiş örneğe kadar delta 0 tick. Bu, sıfır job CPU’su
iddiası değildir: 10 ms çözünürlük ve son örnek→exit aralığı nedeniyle yalnız
0 ms alt sınırdır. Exit sonrası 25 ms idle harness penceresinin tüm süreç CPU’su
0,115 ms. Native worker’ın yokluğu thread exit ile kanıtlanır; harness CPU’su ona
atfedilmez. Builder içinde doğrulanabilir bir ara ilerleme noktası bulunmadığı
için durdurmanın analitik CPU katkısı/tasarrufu **bilinmiyor**.

## On filtre · baseline / son subscriber abort

Baseline aynı adapter’da eski abonelikleri açık tutar; treatment her değişimde
bir önceki aboneliği bırakır. Bu karşılaştırma mevcut üretim route’unun A/B’si
değildir. Üç çift sırası baseline→abort, abort→baseline, baseline→abort.

| Çift/kol | Gönderilen | Dispatch | Builder başladı | Tamamlanan | Queued-cancelled | Running-stopped | Süre ms | Süreç CPU ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 baseline | 10 | 10 | 10 | 10 | 0 | 0 | 9409,308 | 11230,893 |
| 1 abort | 10 | 7 | 1 | 1 | 3 | 6 | 1306,263 | 1864,109 |
| 2 baseline | 10 | 10 | 10 | 10 | 0 | 0 | 9139,860 | 10910,621 |
| 2 abort | 10 | 6 | 1 | 1 | 4 | 5 | 1267,042 | 1794,739 |
| 3 baseline | 10 | 10 | 10 | 10 | 0 | 0 | 9548,431 | 11425,597 |
| 3 abort | 10 | 7 | 1 | 1 | 3 | 6 | 1295,132 | 1785,480 |

Tüm 60 iş admission aldı. Running-stopped, dispatch edilmiş native thread’in
terminate ve exit’inin ikisinin de gözlenmesidir. Treatment’daki bu 17 eski iş
builder başlangıcından **önce** durdu; yalnız son iş builder’a ulaştı. Bunlar
builder içinde iptal edilmiş gibi sunulmaz. Builder içinde native durdurma ayrı
yukarıdaki sınama ve native regresyon testleriyle doğrulandı.

Abort→exit medyanları 13,608 / 13,633 / 12,605 ms; tüm gözlenen exit’lerde
min 0,719 ms, max 18,472 ms. Queued-cancelled işlerde native exit yoktur çünkü
dispatch yoktur. Her job’ın cancellation zamanları ve abort sonrası tüm süreç
CPU penceresi `evidence/paired-native.json` içinde ayrı kaydedilmiştir; builder
öncesi duran worker’da native tid henüz bilinmiyorsa thread CPU alanı null’dır.
Her çift sonunda active/pending/queuedInput/leasedOutput sıfır; tek idle worker’ın
retained/base bütçesi ücretli kalır, kapasite sızıntısı olarak sayılmaz.

Son sonuç, altı koşuda ve altı bağımsız gerçek-builder oracle’ında aynı SHA-256:

```text
c0e31a712318d7cb3ac7dd2ba62017f5e8e8b4fa9e9e9d6d1785080c6a0b9865
```

CPU sütunu process.cpuUsage’ın user+system toplamıdır; main thread, worker,
compression, GC ve harness içerir, wall süresinden büyük olabilir. Gözlenen süreç
CPU farkı analitik iptalin tek başına katkısı olarak raporlanmaz. İç ilerleme
checkpoint’i olmadığı için bu katkı **bilinmiyor**. Native exit ve kuyrukta hiç
dispatch olmaması ise doğrudan gözlenmiş iptal kanıtıdır.

JSON, TAP ve başarısız negatif kontrol/ortam log’ları `evidence/` altında korunur.
Profiler kaydı alınmadı; olmayan CPU profili veya gerçek route uçtan uca kabulü
iddia edilmez.
