# Pending/journal sentetik ölçümleri

Ortam: v24.19.0, linux/x64, AMD EPYC 9V74 80-Core Processor; 5 logical CPU.
Zaman: 2026-11-08T11:14:42.295Z (UTC). 30.000 sentetik mevcut bağımsız satır, quantity editleri.

Her 10/100 edit vakasında üç dönüşümlü çift: legacy→candidate, candidate→legacy, legacy→candidate.
Her kol ayrı, yeni Node süreci ve ayrı native kalıcı Web Storage dosyası kullanır; aynı VM, seri ortak `flock -n -E 75`.
Her satır yalnız `{id,_rev,quantity}` taşır. Normalize grup metadata'sı, rich alan veya büyük nested veri grafiği bu performans fixture'ında yoktur.
Kaynak üretimi ve I/O fixture kurulumu edit zamanına dahil değildir. Edit döngüsü assertion ve her edit sonrası memory örnekleme masrafını içerir.
Orijinal `kolPersistPendingWorkspace` gerçek kaynaktan çıkarılıp çalıştırıldı; UI feedback stub, ağ/DOM/server yok.
Candidate gerçek delta command prepare/record + Storage yazımını içerir; tüm saveKolRows veya ürün akışı ölçülmedi.

## Üç kolun medyanı

| Edit | Kol | setItem değer baytı | Key baytı | Yazım sayısı | Edit ms | Retained heap Δ MiB | Gözlenen peak heap artışı MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | legacy | 25,470,860 | 400 | 10 | 226.063 | 0.018 | 32.279 |
| 10 | candidate | 12,671 | 1,391 | 20 | 36.549 | 0.360 | 8.957 |
| 100 | legacy | 254,708,810 | 4,000 | 100 | 2099.017 | 0.040 | 148.766 |
| 100 | candidate | 312,494 | 14,424 | 206 | 315.584 | 0.601 | 22.372 |

Değer/key baytları başarılı `setItem` çağrılarına verilen UTF-8 metinlerin toplamıdır. Browser quota UTF-16/engine kurallarına göre farklı hesaplanabilir.
Fiziksel disk baytı, fsync, elektrik kesintisi dayanıklılığı veya E2E UI/server latency iddiası yoktur.
Peak değerler her edit sonrası process.heapUsed/RSS örnekleridir; ara allocation peak garantisi değildir.
Retained heap forced-GC sonrası farktır; candidate ledger/source tutulduğu için ek retained heap maliyeti vardır.

## Binding ve restore — edit döngüsünün dışında

| Edit vakası | Kol | Binding ms | Binding değer baytı | Binding retained heap Δ MiB | Restore ms | Restore retained heap Δ MiB | Restore yazımı |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | legacy | 34.418 | 2,547,086 | 1.973 | 14.630 | 3.421 | 0 |
| 10 | candidate | 108.904 | 1,418,674 | 3.458 | 96.944 | 3.667 | 0 |
| 100 | legacy | 33.175 | 2,547,086 | 1.973 | 12.746 | 3.423 | 0 |
| 100 | candidate | 103.216 | 1,418,674 | 3.458 | 124.949 | 3.800 | 0 |

Binding: legacy baseline map + ilk full pending yazımı; candidate JSON certification, owned binding ve head yazımı.
Restore kıyası aynı iş değildir: legacy gerçek `kolReadPendingWorkspace` ile yalnız getItem+JSON.parse; candidate tam open/certification/checkpoint+tail replay.
Legacy merge/normalize/render bu restore ölçümüne dahil değildir. Candidate restore süresi ve ek binding maliyeti saklanmadı.
100 editte candidate üç bounded overlay checkpoint alır (32/64/96 event); edit sırasında full graph serialize etmez.

## Her dönüşümlü çift

| Edit | Çift/sıra | Legacy değer baytı | Candidate değer baytı | Legacy edit ms | Candidate edit ms | Legacy peak RSS MiB | Candidate peak RSS MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 1: legacy → candidate | 25,470,860 | 12,671 | 234.286 | 42.313 | 97.605 | 83.867 |
| 10 | 2: candidate → legacy | 25,470,860 | 12,671 | 222.260 | 36.313 | 97.051 | 82.562 |
| 10 | 3: legacy → candidate | 25,470,860 | 12,671 | 226.063 | 36.549 | 97.293 | 82.691 |
| 100 | 1: legacy → candidate | 254,708,810 | 312,494 | 2114.641 | 315.520 | 270.188 | 100.309 |
| 100 | 2: candidate → legacy | 254,708,810 | 312,494 | 2099.017 | 321.997 | 270.672 | 99.809 |
| 100 | 3: legacy → candidate | 254,708,810 | 312,494 | 2097.202 | 315.584 | 270.156 | 101.402 |

Ham makbuz: `evidence/measurements.json`; süreç çıktısı `evidence/benchmark.stdout.txt`.
`measurements.initial.json` eski kodla alınan ilk ölçümdür; final sonuç diye kullanılmaz.
Ölçüm admission: en az 512 MiB kullanılabilir disk/bellek; gerçek değerler JSON içinde.
Native Node Storage kota semantiği Chromium ile aynı olmak zorunda değildir; Chromium fault kabulü ayrıca `browser-storage.json` içindedir.
History/primary ACK ve grup closure doğruluğu testlerle doğrulandı; bu performans vakası yalnız bağımsız quantity editleridir.
Aynı datanın gerçek rich/financial/image/group editlerine genişletilmiş performansı ölçülmedi.
