# Model görseli canlı tazeleme — L2 performans kabulü (2026-11-25)

Konu: `collection-image-replace-stale-canonical-registry` düzeltmesi
(`claude/mu-b-collection-sync`). Kademe **L2** (canlı/sync yolu, 30k büyük veri).
Karar: **PASS**.

## Ortam ve veri

- Taban Main: `b2ee211` · son ölçülen aday kaynağı: `afaf076` (sonraki commitler
  yalnız bu doküman ve benchmark betiği; çalışma zamanı kaynağı aynı).
- Ortam: Linux cloud konteyneri, 4 vCPU Intel Xeon 2.10 GHz, 15 GB RAM, Node
  v22.23.5. Windows/SMB/Electron ölçülmedi (sınır).
- Sentetik fixture (deterministik, sha256/16 `ccbc0201c1fedd96`): 30.000 Koleksiyon
  satırı (`PLM-B-i`, `C{i%7}`), aynı 30.000 anahtar için kanonik imagemap
  (`ci_seed_i`), sahip `own` + edit izinli `edi`. Her koşu yeni sunucu ve geçici
  veri kökü kullanır (sıcak süreç, soğuk disk önbelleği ayrımı yok).
- Komut (dönüşümlü 3 çift, `/tmp/buyerlog-performance-measurement.lock` altında seri):
  `BENCH_SIDE=main BENCH_APP_ROOT=<b2ee211 çalışma ağacı>/resources/app node scripts/benchmark-model-image-live-refresh.js`
  ve `BENCH_SIDE=cand node scripts/benchmark-model-image-live-refresh.js`.

## Bütçeler

Bütçeler ölçümden önce, ancak ilk uygulamadan **sonra** yazıldı (dürüst kayıt).

| Etki | Metrik | Bütçe |
|---|---|---|
| Mevcut akış | `POST /api/plm-image-links` (edit izinli, tek görsel) | Main'e göre tekrarlanabilir gerileme yok (A/A gürültüsü içinde) |
| Mevcut akış (referans, kod değişmedi) | Aynı sahibin workspace GET'i | Gerileme yok |
| Yeni ağ trafiği | Sinyal başına açık sahip başına kayıt GET'i | ≤ aynı sahibin workspace GET'i (süre ve bayt); sinyal başına sahip başına 1 istek |
| Yeni ana iş parçacığı işi | İstemci kayıt uygulama (değişen / değişmeyen) | Tek görev < 50 ms |
| Sinyal hacmi | 15 ardışık bağlama sırasında SSE / shared-revision | Burst başına ≥1 (son durum kaybolmaz), shared-revision ≤ 1/sn |

## Sonuç (Tur 2, son kaynak)

| Metrik | Main (çift medyanları → medyan) | Aday | Karar |
|---|---|---|---|
| POST plm-image-links | 305.3 / 302.7 / 311.2 → **305.3 ms** | 288.3 / 289.8 / 333.5 → **289.8 ms** | PASS (A/B çift farkı −5.6…+7.2 %, A/A −4.2…+7.0 %) |
| Workspace GET (referans) | 503.8 / 509.0 / 512.2 → **509.0 ms**, 2.19 MB | 488.4 / 526.7 / 550.1 → **526.7 ms**, 2.19 MB | PASS — rota değişmedi; A/B çift farkı −3.1…+7.4 %, A/A −2.5…+7.9 % (havuz: A/B +1.5 %, A/A +3.9 %) |
| Kayıt GET (yeni) | — (uç yok, 404) | 191.2 / 236.8 / 202.8 → **202.8 ms**, 1.83 MB, 30k anahtar | PASS (workspace GET'in 0.40× süresi, 0.83× baytı) |
| İstemci uygulama, değişen | — | 24.6 / 25.9 / 27.3 → **25.9 ms**, en kötü 45.2 ms | PASS (< 50 ms) |
| İstemci uygulama, değişmeyen | — | 22.6 / 21.2 / 22.2 → **22.2 ms**, en kötü 28.9 ms | PASS |
| Tarayıcı JSON ayrıştırma (1.83 MB, Node JSON.parse ile yaklaşık) | — | ~7.8 ms medyan | bilgi: değişen yol toplamı ~34 ms medyan |
| SSE (sahip akışı, 15 POST) | 0 olay (hata: sinyal yok) | 1 `model-images` reload olayı (3/3 koşu) | PASS (sondan 300 ms debounce; değer taşımaz) |
| shared-revision `modelImages` | 0 | 4 yazım / 15 POST (~4.5 sn) | PASS (≤ 1/sn birleşik) |

Veri eşdeğerliği: her istemci koşusunda uygulamadan sonra imagemap 30.000 anahtar,
değişen 15 anahtar yeni ref'te ve yayımlanmış kayıt (`resolveRegistrySource`)
çözümlüyor; değişmeyen tekrar 0 değişiklik döndürüyor (betik aksi hâlde hata verir).

## Tur 1 (reddedildi → düzeltildi)

İlk aday (`17d82ff`) iki yeni bütçeyi aştı: istemci değişen uygulama medyanı
**62.4 ms** (49.3–70.5; ayrıca yayımlanmış kaydın tam yeniden indekslenmesi ölçüme
dahil değildi) ve kayıt yanıtı **2.66 MB** (> workspace 2.19 MB; `scopeKeys` her
satır için renk + eski PLM anahtarı = 60k giriş). Düzeltme (`afaf076`):
fark saf yama olarak hesaplanır ve mevcut `silentImageApplyPatch` /
`patchRegistryMap` ile yerinde, artımlı uygulanır; CP için fark yoksa mevcut tam
CP uygulaması atlanır; Koleksiyon ucu dolu kapsamı yinelemez (`emptyScopeKeys`).

## Kalan sınırlar

- Electron/Windows/SMB ve gerçek LAN çok kullanıcılı sunucu ölçülmedi.
- Sinyal başına sunucu maliyeti açık ekran sayısıyla doğrusal artar (30k satırlık
  sahipte istemci başına ~200 ms sunucu yanıt süresi; CPU ayrıca ölçülmedi).
  Değişikliği olmayan istemciler yine kaydı
  indirir; koşullu (ETag/revizyon) yanıt protokol değişikliği olduğu için yapılmadı.
- p95 iddiası yoktur (3 çift).

## Ham örnekler

**Tur 2 — son kaynak afaf076 vs Main b2ee211 (medyan ms; parantez içinde ham örnekler)**

| Çift | Taraf | POST /api/plm-image-links ×15 | GET workspace ×9 | GET registry/collection ×9 |
|---|---|---|---|---|
| 1 | main | 305.3 (390.8, 301.1, 299.3, 272.0, 340.7, 420.5, 275.8, 327.5, 315.3, 294.2, 284.8, 450.1, 305.3, 307.3, 298.4) | 503.8 (522.7, 503.7, 472.5, 491.9, 461.4, 486.0, 572.1, 577.9, 625.7) | yok (HTTP 404) |
| 1 | cand | 288.3 (324.2, 304.0, 288.3, 290.3, 286.0, 390.6, 266.0, 282.3, 287.7, 267.9, 247.3, 435.1, 289.8, 261.8, 312.9) | 488.4 (494.6, 474.4, 516.8, 516.5, 540.8, 488.4, 478.6, 471.7, 463.7) | 191.2 (191.2, 162.2, 210.3, 377.5, 191.3, 188.5, 250.7, 182.6, 183.6) |
| 2 | main | 302.7 (319.2, 311.7, 293.6, 418.3, 291.5, 302.7, 302.4, 286.6, 296.7, 445.1, 324.5, 357.0, 268.5, 294.0, 321.8) | 509.0 (593.7, 499.7, 527.0, 480.9, 468.7, 564.7, 509.0, 535.4, 498.0) | yok (HTTP 404) |
| 2 | cand | 289.8 (342.6, 310.0, 284.6, 289.8, 278.3, 499.4, 266.4, 303.1, 287.5, 280.5, 290.9, 451.1, 311.4, 281.3, 267.3) | 526.7 (526.7, 478.8, 472.9, 558.1, 529.3, 560.0, 523.4, 551.0, 483.5) | 236.8 (249.0, 200.4, 236.8, 176.0, 268.9, 375.6, 191.6, 175.2, 257.4) |
| 3 | main | 311.2 (433.7, 282.7, 626.0, 773.1, 418.4, 276.6, 301.1, 294.4, 309.5, 277.1, 430.8, 296.8, 325.2, 332.2, 311.2) | 512.2 (503.2, 517.5, 586.8, 481.9, 512.2, 522.9, 488.7, 451.2, 531.5) | yok (HTTP 404) |
| 3 | cand | 333.5 (402.5, 392.4, 368.2, 296.0, 293.8, 440.7, 292.5, 330.7, 304.9, 344.1, 299.3, 333.5, 516.9, 302.0, 374.2) | 550.1 (632.6, 550.1, 479.4, 493.3, 507.6, 546.5, 650.4, 636.6, 614.7) | 202.8 (227.3, 260.9, 214.6, 178.0, 168.6, 202.8, 472.9, 185.1, 188.2) |

**Tur 2 — istemci uygulama (yalnız aday; gerçek BLModelImageCache + silentImageApplyPatch; koşu başına 7 bağımsız bağlam)**

| Koşu | Değişen (15 anahtar) | Değişmeyen |
|---|---|---|
| 1 | 24.6 (26.7, 24.7, 24.5, 32.6, 24.2, 24.3, 24.6) | 22.6 (28.5, 22.6, 22.3, 22.6, 22.7, 22.9, 22.1) |
| 2 | 25.9 (23.0, 22.3, 25.9, 31.1, 45.2, 28.4, 21.6) | 21.2 (20.5, 20.5, 20.1, 22.6, 28.9, 26.0, 21.2) |
| 3 | 27.3 (29.6, 24.4, 27.3, 44.4, 28.3, 23.3, 24.9) | 22.2 (21.9, 22.5, 22.2, 21.7, 22.1, 24.2, 23.7) |

**A/A gürültü — Main b2ee211 vs Main b2ee211**

| Çift | Taraf | POST /api/plm-image-links ×15 | GET workspace ×9 |
|---|---|---|---|
| 1 | mainA | 310.4 (304.8, 291.9, 288.0, 304.3, 477.3, 310.4, 292.8, 332.9, 343.7, 515.3, 290.2, 387.7, 313.6, 310.0, 323.3) | 517.1 (516.3, 501.4, 529.2, 543.4, 466.8, 555.1, 517.1, 506.2, 598.7) |
| 1 | mainB | 319.2 (346.8, 353.6, 300.1, 295.3, 423.6, 292.1, 336.8, 273.9, 314.3, 316.6, 442.7, 326.7, 319.2, 351.1, 286.9) | 504.3 (570.1, 504.3, 452.1, 407.4, 486.0, 497.1, 594.6, 552.6, 561.1) |
| 2 | mainA | 325.7 (325.6, 310.3, 280.4, 303.5, 446.7, 301.9, 360.8, 348.2, 341.0, 325.7, 496.1, 341.5, 385.9, 299.6, 325.7) | 528.9 (528.9, 531.6, 497.3, 487.6, 559.7, 485.3, 502.1, 605.5, 570.4) |
| 2 | mainB | 312.1 (396.3, 312.0, 289.7, 289.7, 298.7, 302.4, 398.2, 315.0, 282.9, 292.8, 304.5, 466.4, 347.6, 324.5, 337.1) | 541.6 (542.9, 541.6, 538.2, 549.7, 617.5, 519.7, 559.2, 515.4, 496.2) |
| 3 | mainA | 327.8 (351.9, 330.1, 301.5, 376.4, 439.0, 296.8, 319.7, 289.9, 301.0, 321.4, 482.4, 308.4, 356.4, 327.8, 336.6) | 557.0 (523.5, 479.0, 574.8, 489.1, 512.9, 557.0, 625.9, 642.8, 560.1) |
| 3 | mainB | 350.6 (348.0, 417.2, 372.3, 350.6, 524.9, 306.2, 324.1, 368.7, 331.6, 355.0, 477.7, 338.1, 338.3, 308.0, 388.8) | 600.9 (600.9, 620.3, 668.7, 750.1, 512.6, 541.1, 592.8, 621.6, 557.4) |

**Tur 1 — önceki aday 17d82ff (bütçeyi aştı, düzeltildi) vs Main b2ee211**

| Çift | Taraf | POST ×15 | GET registry/collection ×9 | istemci değişen (kayıt indeksi stub) |
|---|---|---|---|---|
| 1 | main | 341.8 (410.8, 305.3, 379.2, 466.1, 315.3, 333.1, 367.8, 341.8, 358.8, 328.7, 471.4, 311.8, 299.4, 359.6, 334.5) | yok (HTTP 404) | — |
| 1 | cand | 359.1 (361.3, 312.9, 321.6, 309.5, 483.8, 358.4, 387.9, 352.8, 334.2, 359.1, 603.4, 374.8, 375.5, 343.2, 374.8) | 246.5 (268.7, 184.4, 271.4, 268.7, 380.9, 184.7, 204.2, 214.9, 246.5) | 70.5 (69.0, 80.5, 73.1, 79.7, 47.3, 54.2, 70.5) |
| 2 | main | 326.8 (458.2, 319.2, 401.2, 326.1, 347.7, 493.0, 295.5, 322.4, 326.8, 293.5, 305.6, 466.8, 324.8, 397.5, 364.4) | yok (HTTP 404) | — |
| 2 | cand | 334.0 (334.0, 315.7, 338.0, 392.1, 454.0, 311.1, 302.3, 298.4, 317.7, 355.4, 482.9, 386.7, 319.2, 290.7, 366.3) | 211.2 (186.1, 203.7, 244.5, 443.0, 185.2, 211.2, 274.6, 226.8, 188.5) | 62.4 (67.2, 54.7, 45.7, 45.2, 68.5, 62.4, 71.8) |
| 3 | main | 387.9 (401.3, 386.5, 405.3, 508.9, 365.4, 344.2, 336.8, 395.1, 387.9, 473.2, 420.4, 326.3, 315.8, 363.9, 538.6) | yok (HTTP 404) | — |
| 3 | cand | 325.3 (422.6, 292.9, 304.7, 325.3, 300.6, 286.1, 449.5, 326.4, 344.0, 292.7, 290.4, 318.5, 522.4, 346.7, 414.5) | 235.4 (205.6, 245.5, 231.2, 202.2, 513.3, 258.2, 196.6, 235.4, 235.6) | 49.3 (53.2, 47.4, 45.3, 57.4, 49.3, 54.4, 42.7) |
