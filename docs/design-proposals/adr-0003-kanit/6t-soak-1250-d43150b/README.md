# 6T · #1250 sonrası Electron bellek dayanıklılığı (soak): main `d43150b` ↔ 6Q (`5317662`) — **ÖN SONUÇ**

> **ÖN SONUÇ (ürün sahibi kuralı, 2026-11-28).** Bu soak, ölçüm slotu kuralından önce koşuldu. Aynı pencerede başka oturumlar CPU/disk yoğun iş yaptı (aşağıda).
> Oturumların aynı fiziksel makineyi paylaşıp paylaşmadığı bilinmiyor. Çekişme göstergesi (PSI/steal) bu koşuda kaydedilmedi; kit'e sonradan eklendi (`kit/contention.js`).
> **Yetkili bellek ve L2 sonucu:** birleşik main üzerinde, özel slotla ve çekişme kaydıyla koşulacak nihai doğrulamadır (`kit/final-validation.sh`).

**Ortam:**
- Commit: main `d43150bcbe…` (yalıtılmış worktree). Kodu, 2026-11-28 05:07Z'deki main `825721c` ile aynı; aradaki fark yalnız doküman.
- Çalışma ortamı: Electron 44.3.0 (Node 24.20.0), `ELECTRON_RUN_AS_NODE=1`.
- `NODE_OPTIONS="--use-openssl-ca --max-old-space-size=3686 --require=kit/hook-soak.js"`.
- `BUYER_LOG_COMPUTE_GC_RECHECK` ve `BUYER_LOG_CP_ROWPATCH_LEGACY` ayarsız; mevcut üretim davranışı.
- Linux 6.18 container, 4 vCPU. Ölçüm sırasında başka ölçüm yok; yalnız uzak CI koşuları vardı.
- Fixture: 30k, seed 7 (CP 24.982 satır).

**Yöntem:** 6Q ile birebir aynı: kit `soak.js`, 110 dk, 15 sn ara, 10 dk'da bir eşitlik denetimi. Sonda önbellek silinir ve sıfırdan tam kurulum yapılır.

## Sonuç (6T ↔ 6Q)

| Ölçüt | 6T `d43150b` (#1250 sonrası) | 6Q `5317662` |
|---|---:|---:|
| Kayıt / 200 | 365 / 365 | 349 / 349 |
| 503 | 0 | 0 |
| Eşitlik denetimi (11 + final) | 12/12 eşit (`5ac8eef8fa41`); değer geri okuma 365/365 | 12/12 eşit; 349/349 |
| Sıfırdan tam kurulum tabanı | özet = final; 365/365 değer | aynı |
| CP bekleme medyanı (p90) | **204 ms (248)** | 3262 ms (3423) |
| Hazır medyanı (p90 / maks) | 3023 ms (3406 / 4556) | 3915 ms (4142 / 4753) |
| RSS medyan dilimleri 0-30 / 30-60 / 60-90 / 90-110 dk | 1409 / 1501 / 1454 / 1549 MB | 1581 / 1805 / 1807 / 1848 MB |
| RSS tepe / VmHWM son | 2826 / 3066 MB | 3130 / 3138 MB |
| RSS medyan eğimi ilk 30 / son 30 dk | +474 / −241 MB/sa | +626 / −106 MB/sa |
| Ana heap medyan dilimleri | 78 / 103 / 121 / 124 MB | 76 / 103 / 120 / 124 MB |
| Ana heap eğimi ilk 30 / son 30 dk | +102 / +8,6 MB/sa | +101 / +10 MB/sa |
| İşçi emekliliği (ölçüm penceresi) | 2: sorgu şeridi işçisi, `after-result (budget/generation)`, retained 482 MB; 68,6 ve 102,5. dk | 0 |
| Şerit retained tepe | 482 MB | 444 MB |

Değerlendirme:
- **Veri [Doğrulandı]:** Tam eşitlik. 503 yok. Sıfırdan tam kurulum oturumun son durumuyla aynı.
- **Bellek [Muhtemel]:** Plato.
  - RSS son 30 dakikada düşüyor; ana heap eğimi +8,6 MB/sa, 6Q ile aynı.
  - VmHWM 6Q'dan düşük.
  - 110 dakikanın ötesi ölçülmedi.
- **İşçi emeklilikleri:** Bütçe mekanizmasının beklenen davranışı. Şerit işçisinin retained değeri sınırı aşınca iş bittikten sonra emekliye ayrıldı.
  - Sonraki isteklerde 503 ya da bekleme sıçraması yok; dilim medyanları 199–215 ms.
  - 6Q'da emeklilik yoktu. Fark, #1250 ile değişen okuma yolunun şerit işçisinde biraz daha fazla bellek tutmasıyla uyumlu [Hipotez].
- **Bekleme:** CP bekleme medyanı 3262 → 204 ms (16×). Bu, #1250 ile varsayılan olan satır yaması yolunun beklenen etkisidir. Zamanla kötüleşmiyor: dilimler 205 → 199 → 201 → 215 ms.
- **Kapsam dışı:** Windows (gerçek `BuyerLog.exe`) uzun soak bu kanıtta yok. Windows kapısı 15 dk soak içerir (6U).

## Eşzamanlı yük pencerelerinde sapma (ebeveynin bildirdiği pencereler, UTC)

Pencereler:
- **Del. Type oturumu, tam npm test:** 04:59–05:05, 05:25–05:37, 05:44–05:50, 06:04–06:10, 06:39–06:45, 06:56–07:02.
- **Del. Type oturumu, sunucu + Chromium:** 04:46–04:59, 05:15–05:25, 05:41–05:43, 05:52–06:03, 06:13–06:37 (yoğun), 06:54–07:00.
- **Lojistik oturumu, tam npm test:** 05:15–05:22 ve 06:10:30–06:16:50.
- **Lojistik oturumu, Electron L2:** ~05:25–05:35.

Pencereler soak kayıtlarının **%76**'sını kapsıyor.

| Pencere | Kayıt | CP bekleme medyan / p90 (ms) | Hazır medyan / p90 (ms) | Sunucu CPU ms/döngü medyan |
|---|---:|---:|---:|---:|
| Del. Type tam npm test | 108 | 207 / 252 | 2990 / 3297 | 7520 |
| Del. Type sunucu + Chromium | 170 | 202 / 243 | 3110 / 3434 | 9050 |
| — yoğun 06:13–06:37 | 79 | 201 / 243 | 3107 / 3375 | 9150 |
| Lojistik tam npm test | 44 | 195 / 234 | 3007 / 3497 | 8390 |
| Lojistik Electron L2 | 33 | 207 / 233 | 2938 / 3292 | 7460 |
| Herhangi bir pencere | 278 | 203 / 248 | 3036 / 3406 | 7900 |
| **Hiçbir pencere (sakin)** | 86 | 209 / 248 | 2993 / 3393 | 7710 |

- RSS ve heap dakika medyanları: pencere içi (84 dk) 1444 / 110 MB; sakin (27 dk) 1483 / 103 MB.
- **Bekleme süreleri ve bellek [Muhtemel]:** Pencerelerde ölçülebilir sapma yok; fark gürültü düzeyinde.
- **Sunucu CPU süresi [Hipotez]:** Del. Type sunucu + Chromium pencerelerinde döngü başına sunucu CPU süresi %17–19 yüksek (9050–9150 ↔ 7710 ms). Aynı iş için daha çok CPU zamanı harcanması, fiziksel çekirdek ya da önbellek paylaşımıyla uyumlu. Duvar saati bekleme süreleri etkilenmedi, çünkü döngü 15 sn boşluklu ve sunucu boşta kalıyor. Kanıt değil: PSI ve steal bu koşuda kaydedilmedi.
- **Sonuç:** Bu soak'un veri bütünlüğü sonucu (eşitlik, 503 = 0, değer geri okuma) çekişmeden bağımsızdır. Bellek ve süre değerleri **ÖN SONUÇ**'tur; yetkili değer, nihai doğrulamanın çekişme kayıtlı özel slot koşusudur.
- **Bu oturumun kendi müdahalesi:** soak sırasında bu container'da kısa filtreli testler koştu: ~05:52Z iş akışı testleri 0,5 sn; ~05:54Z `compact-test-reporter` + `collection-sync-causal-cloud` 32 sn. Etkilenmiş olabilecek kayıt ~2.

## Yeniden üretim

6Q README'deki komutun aynısı. Commit `d43150b`, `SOAK_MIN=110`. Analiz: `node kit/analyze-soak.js ham/soak.json <soak.hook> analiz/`.

Dosyalar:
- `ham/`: `soak.json`, `soak.log`, `commit.txt`, `ortam.txt`, `soak.hook.gz`.
- `analiz/`: `ozet.json`, `seri-dakika.csv`, `emeklilik.json`.
