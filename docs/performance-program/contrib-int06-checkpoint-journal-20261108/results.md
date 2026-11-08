# Gerçek ölçüm sonuçları / observed measurements

Her hücre üç örneğin medyanıdır. Sıra eski/yeni, yeni/eski, eski/yeni; tüm örnekler taze Node sürecinde, ortak `flock -n -E 75` altında seri çalıştı. İşlem başına batch=250. MB ondalık, RSS MiB (2²⁰ bayt). Min/max ham summary JSON dosyalarındadır.

**Yalnız checkpoint trace replay prototipidir. Üretim entegrasyonu ve toplam refresh ölçümü değildir. `/tmp` tmpfs: fiziksel disk/SMB/power-loss sonucu değildir.**

| Yük | Kol | Payload bayt | Checkpoint CPU ms | Checkpoint süre ms | Peak RSS MiB |
| --- | --- | ---: | ---: | ---: | ---: |
| 3000 steady | legacy-store | 6,485,102 | 48.43 | 49.18 | 50.73 |
| 3000 steady | journal | 2,087,568 | 108.13 | 97.58 | 55.86 |
| 3000 split-retry | legacy-store | 487,831,642 | 3357.31 | 3326.45 | 89.83 |
| 3000 split-retry | journal | 11,303,368 | 460.67 | 420.06 | 71.08 |
| 30000 steady | legacy-store | 612,126,625 | 4276.10 | 4240.20 | 242.64 |
| 30000 steady | journal | 26,873,686 | 1181.10 | 1130.93 | 234.99 |
| 100000 steady | legacy-store | 6,777,574,427 | 57159.85 | 56591.28 | 471.69 |
| 100000 steady | journal | 193,920,022 | 7883.86 | 7326.14 | 657.78 |

3k steady örneğinde journal CPU/süre/RSS daha yüksek. 100k steady örneğinde journal medyan peak RSS **%39,5 daha yüksek**; süreç tepe belleği kabul edilmiş bir iyileşme değildir. Tam snapshot materialization/checksum zarfı aday maliyettir; peak'in hangi aşamada oluştuğu profillenmedi. RSS tüm ölçüm sürecinin high-water değeridir; yalnız helper heap tahsisi olarak yorumlanmaz.

30k/100k steady payload ve CPU/süre azalması bu store replay aracında gözlendi; üretimde refresh/progress/transport entegrasyonu henüz yapılmadı. Bugünkü production full-state rescan maliyeti eski kol zamanlamasına dahil değil. Eski store fsync yapmaz; journal her durable sınırda fsync yapar.

| İstenen matris | Checkpoint-only 3 çift | Değişmemiş tam connector benchmark 3 çift |
| --- | --- | --- |
| 30k steady | Çalıştı, oracle eşdeğer | Çalıştırılmadı |
| 100k steady | Çalıştı, oracle eşdeğer | Çalıştırılmadı |
| 30k split/retry | Çalıştırılmadı | Çalıştırılmadı |
| 100k split/retry | Çalıştırılmadı | Çalıştırılmadı |

3k split/retry pilotu yalnız 3k sonucudur: 1.194 terminal batch, eski kolda her örnekte 487.831.642 mantıksal payload baytı. Büyük split kampanyası yazma hacmi nedeniyle bu oturumda genişletilmedi; büyük yüklere sayısal tahmin sonuç olarak verilmedi.

Ölçülen 24 örneğin tümünde fixture, trace ve final orderStates/rows SHA eşdeğerliği assert edildi. 12 pilot örnek source committen önce aynı journal SHA ile; 12 büyük steady örnek `4130caeaecf5115583f46ed8d375cdc73390b9ee` üzerinde çalıştı. Eski tarihsel #890 ölçümleri bu sonuçlara karıştırılmadı.

- [3000-steady min/medyan/max](pilot/3000-steady-summary.json).
- [3000-split-retry min/medyan/max](pilot/3000-split-retry-summary.json).
- [30000-steady min/medyan/max](measurements/30000-steady-summary.json).
- [100000-steady min/medyan/max](measurements/100000-steady-summary.json).

Tam filtresiz npm test, CI, üretim entegrasyon ölçümü, Windows/Electron/SMB ve gerçek enerji kesintisi sınaması çalıştırılmadı. INT-06 açık.
