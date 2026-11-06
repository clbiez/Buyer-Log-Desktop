# Faz 0 — ölçüm altyapısı (P3)

Durum: **üç 30k baz koşusu geçti.** Faz 1 macro karşılaştırması ayrıca yürütülür; programın tamamı bitmedi.

## Değişti

Üç açılış olayı ayrı kaydedilir. Modül ve aynı sekme sayfaları sonraki ölçümden önce `finally` içinde kapanır. Long-task penceresi navigasyondan itibaren sabit 0–10.000 ms'dir; görevler pencere sınırına kırpılır. Bekleme bütçesi 900 sn'dir; örnekleme penceresi bu bütçeye göre genişlemez.

Fixture SHA-256, satırlar, cache checksum, generation, kaynak revizyonu ve istemci Orders/Supp. FOB revizyonları doğrulanır. GET health/status transient hatalarında en fazla üç deneme; refresh/login POST'u tek deneme. Başarısız koşunun server.log, kısmi/tam JSON ve stall profilleri korunur. Ham refresh karşılaştırma satırları raporda sayaçtır.

Yalnız insanın seçerek beklemesi sistem süresinden çıkarılır. Bu otomatik koşuda Continue niyeti gate-ready anıdır; renderer'ın bu çağrıyı geç işlemesi `continueDispatchDelayMs` ile **sistem süresinde kalır**. Heap salt okunur, GC zorlanmadan alınır: `jsHeapUsedBytes`, `heapSampling=uncollected`; retained-heap iddiası yoktur. Probe oluşmamışken `undefined !== null` ile yanlış hazır sayma ayrıca RED→GREEN sabitlendi.

## Doğrulama

[Doğrulandı] `npm test -- startup-benchmark` ve 12 doğrudan davranış testi GREEN. i18n:check yeni 0 / baseline 0; release:notes:validate mevcut 15 kayıt GREEN. Son hedefli paket ve kontrol çıktıları artifacts altında. Tam suite bu fazda çalıştırılmadı. Ürün UI/runtime kodu değişmedi; yeni sürüm notu gerekmiyor.

Üç taze fixture kökü, aynı kaynak baytları ve aynı harness ile **3/3 tam benchmark GREEN**: her koşuda Overview 30.000, CP 24.982, Orders 30.000, Koleksiyon 0. Her modülde generation/revizyon ve aynı sekme sayımları geçti; pageerror yok.

## Ölçüm — medyan, üç koşu

Linux, cgroup 4 vCPU / 16 GiB, Node 24.19, headless sistem Chromium; Windows/Electron ölçülmedi. Kaynak runtime `099776c5` + yalnız benchmark değişiklikleri; harness `8e5a66fc`. Kaynak Excel baytları 05.11 üretilmiş seed=7 fixture'ından kopyalandı, 06.11'de yeniden üretilmedi. OS disk cache temizlenmedi.

Refresh medyanı **53,23 sn**; aralık 42,46–57,39 sn. Bu faz uygulama hızlanması iddia etmez, sonraki fazlar için baz kurar.

| Modül | Primary hazır (sn) | Gate hazır (sn) | Sistem complete (sn) | Continue işleme gecikmesi (sn) |
| --- | ---: | ---: | ---: | ---: |
| overview | 4,26 | 38,72 | 152,69 | 113,96 |
| koleksiyon | 12,84 | 31,23 | 31,29 | 0,04 |
| cp | 5,93 | 54,94 | 190,16 | 137,40 |
| orders | 6,43 | 22,68 | 22,76 | 0,05 |

Aynı sekme medyanları: CP **14,00 sn**, Orders **2,15 sn**, Koleksiyon **0,10 sn**. İlk ekran ve gate/complete aynı metrik değildir; hazır olayından sonra da uzun istemci işi gözlendi.

/api/status refresh p95'lerinin medyanı 25.25 ms. /api/health handler'ı mevcut runtime'da yoktur; 404 refresh p95'lerinin medyanı 646.00 ms **başarısız HTTP round-trip** ölçümüdür, çalışan health endpoint'i gibi sunulmaz. Ham endpoint/durum/başarısız denemeler saklıdır; iki endpoint her 500 ms sonrası döngüde sırayla örneklenir. Varsayılan runtime stall eşiği 3 sn; 200 ms altı kabulü bu rapordan çıkarılmaz.

## İlk başarısızlıkların nedeni ve kontrollü fixture

[Doğrulandı] Dosya-sistem çağrı izi, yeni kurulumun ilk haftalık `data-cleanup.weeklyCheck` işinin ölçüm ortasında cache manifest/projeksiyonlarını sildiğini gösterdi. Yeni sentetik fixture, haftalık kontrolü yakın zamanda tamamlanmış geçerli `data-cleanup-state.json` ile başlatılır; bakım kodu değiştirilmez. Mevcut state üzerine yazılmaz. Bu başlangıç koşulu tüm before/after koşularında aynıdır; bakımın kendisinin performansı bu bazın kapsamı değildir. Generation kontrolü gevşetilmedi.

[Doğrulandı] Ayrı 44,94 sn browser profili ve durdurulmuş stack, `adoptSharedChecklistDefinitions → savePrefs → Overview recompute → karar motoru` zincirinde ana thread'de hesap gösterdi; canonical rowLookup/token fonksiyonları profilde görüldü. 60 sn'lik eski rAF beklemesi bu maliyeti yanlışlıkla kayıp startup olayı gibi gösterebiliyordu. GC'nin bu timeout'un kök nedeni olduğu ispatlanmadı; zorunlu GC ölçüm müdahalesini azaltmak için kaldırıldı. Kullanıcı 06.11'de faz sırasını korumayı seçti; erken checklist prototipi **uygulanmadı**.

## Kanıt

[v3 özet](phase-0-artifacts/v3/summary.json), [manifest/SHA](phase-0-artifacts/v3/manifest.json) ve aynı dizindeki üç ham JSON.gz dosyası yeniden hesaplamaya yeterlidir. İlk başarısız 30k koşu ve orijinal profili silinmedi. [06.11 tanılaması](phase-0-artifacts/resume-20261106/) browser CPU profili, stack, cache silme çağrı izi ve ek RED kanıtlarını içerir. Orijinal JSON/server.log/PNG dosyaları sentetik /tmp köklerinde de korunur.

## GitHub / Yayın / Karar-risk

[Faz 0 PR #872](https://github.com/clbiez/Buyer-Log-Desktop/pull/872). Gerçek CI ve merge durumu PR açıklamasında ve final teslimde belirtilir; yerel GREEN uzak check yerine sayılmaz. TEST: yapılmadı. STABLE: yapılmadı. Dal koruması doğrulanmadı; etkin varsayılmadı. Faz 2+ başlatılmadı; P1 merge öncesi durma sınırı korunur.
