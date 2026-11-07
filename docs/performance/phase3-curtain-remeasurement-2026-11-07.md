# Faz 3 açılış perdesi: #892 sonrası yeniden ölçüm / Phase 3 startup curtain: remeasurement after #892

**Tarih / Date:** 7 Kasım / November 2026 (Europe/Istanbul). Ham zaman damgaları UTC / raw timestamps UTC: 2026-11-07T17:29:46Z – 2026-11-07T17:55:22Z.
**Kapsam / Scope:** yalnız ölçüm, rapor ve ölçüm kanıtı / measurement, report and evidence only. Ürün kodu ve mevcut `scripts/*` değişmedi / product code and existing scripts unchanged. Risk: P3, davranış değişikliği yok / no behavior change.

## TR — Karar

**[Doğrulandı] Güncel main’de ödünleşim küçüldü; anında CP'ye geçiş için hâlâ kabul öneremiyorum.** Güncel main'de CP ilk niyeti **20.437 sn**; Faz 3'ten %50.9 kısa, Faz 3 öncesinin **12.2 katı**. Buna karşılık sayfa başlangıcından görünür CP satırına toplam sistem süresi **75.646 → 22.178 sn**. İlk tıklama sorunu sürerken genel açılış kazanımı da korunuyor. Resmî bir saniye eşiği verilmedi; kabul önerisi bu iki gözlemin mühendislik değerlendirmesidir.

Hazırlık bitmiş aynı sekmede ilk CP **3.251 → 4.857 sn**; Faz 3 öncesi düzeye de dönmedi. Sonraki CP/Orders dönüşleri aşağıdaki tabloda. İlk giriş ile hazırlanmış geçiş aynı olay değildir. Eski dokümandaki 4,8 → 76,7 ve 15,9 → 46,2 sn sayıları tarihsel bağlamdır; yeni makine/tarayıcıyla doğrudan oranlanmaz. Karşılaştırmalar bu rapordaki eş ortamlı A/B/C ölçümlerinden hesaplanmıştır.

## Yöntem / Method

| Kol / Variant | Sabit commit / Pinned commit | Anlam / Meaning |
| --- | --- | --- |
| A · before | `873c1f4497535252db12c52f7d7a25155433fa5d` | Faz 3 öncesi / before Phase 3 |
| B · phase3 | `873a14f42f6cb0feef18cc76d3fb3dc1cb0e4f1c` | #879, Faz 3 / Phase 3 |
| C · main | `5a1656e98deeb573f6245f4b24a8135cc77a0d7b` | #886, #888, #889, #892 dahil / including these PRs |

- **Önkoşul doğrulandı / Prerequisite verified:** GitHub #892 `merged=true`; merge commit `5a1656e98deeb573f6245f4b24a8135cc77a0d7b` main'in atası / ancestor of main. Ölçülen main aynı commit / measured main is that commit.
- **Main ilerlemesi / Main advancement:** ölçüm sırasında main `2083ffd73ba026067d92ccf257c4551afa2e5f00` oldu. Tek fark `resources/app/tests/v714-performance-hardening.test.js`; ürün, bağımlılık ve ölçüm betikleri ölçülen `5a1656e9` ile aynı Git içeriklerine sahip. Bu nedenle yeni performans kazanımı atfedilmedi ve aynı runtime tekrar ölçülmedi. [Kimlik kanıtı](phase3-curtain-2026-11-07/main-head-equivalence.json). / During measurement, main advanced to this test-only commit. All runtime, dependency and harness contents are identical to the measured revision; no new timing or gain is claimed for the newer hash. The report PR is based on that newer main.
- Fixture: [`source-30000-seed7-20261105.tar.gz`](../performance-program/fixtures/source-30000-seed7-20261105.tar.gz), SHA-256 `5913414603984b02b1c30b87f1f9231da3718ab797a007f4bd14067ec6cd5c70`. Arşiv ve üç Excel SHA'sı doğrulandı / archive and three workbook hashes verified. 30.000 Orders, **24.982 CP**; yalnız sentetik veri / synthetic data only.
- Her kol için her senaryoda **n=3**. Bloklar **A→B→C, B→C→A, C→A→B**. Her kolda önce ilk niyet, sonra ayrı sunucu/tarayıcıyla aynı sekme / first intent then a separate same-tab server/browser. Ölçümler seri, tek etkin tarayıcı / serial measurements, one active browser.
- Linux, AMD EPYC 9V74; 4 vCPU kotası (`400000 100000`), 16 GiB cgroup bellek sınırı; Node v24.19.0, Chromium 154.0.8037.57, Playwright 1.62.1. Disk/OS cache temizlenmedi / OS page cache not flushed.
- Bir tam, başarılı Faz 0 kurulumu güncel main ile üretildi; dört modülün doğrulanmış çıktısı `seed-measurement.json.gz` içindedir. Aynı seed'in kaynak, auth, kullanıcı durumu ve projection cache'i her senaryo için temiz geçici köke kopyalandı. Tüm kollar aynı generation/source revision ile başladı; ölçülen koşul cache bulunan tekrar açılıştır, Excel import veya ilk kurulum değildir.
- A complete, passing Phase 0 setup on main supplied four validated module measurements. Every scenario cloned that same source/auth/user-state/projection-cache snapshot into an isolated temporary root. The condition is a cached application launch, not an Excel import or first installation.

**İlk niyet / First intent:** mevcut [`benchmark-first-transitions.js`](../../resources/app/scripts/benchmark-first-transitions.js) ve probe değiştirilmeden kullanıldı; `--app-root` ile hedef revizyon seçildi. Her CP ve Orders denemesi yeni tarayıcı bağlamında Overview açtı. Gerçek startup-complete olayı sonrası sıfır gecikmeli `switchTab` niyeti; görünür içerik, beklenen satır sayısı, satır DOM'u, iki animation frame ve görünür modül perdesinin kalkması zorunlu. Bir saniyelik kararlılık gözlemi gecikmeye eklenmez. Otomatik Continue insan beklemesi eklemez; ana iş parçacığı kuyruğu ve animasyon gecikmeleri sürede kalır. Viewport 1440×900; dış HTTPS engelli, release-note popup'ı betiğin mevcut yöntemiyle bastırıldı.

The existing first-transition script and probe were used unchanged against each app root. Each target starts from Overview in a fresh browser context. A zero-delay intent follows the actual startup-complete event; visible content, expected rows, row DOM, two animation frames and absence of a module curtain are required. The one-second stability observation is excluded from latency. Continue is automatic; input queue and animation delay remain included. Viewport 1440×900; external HTTPS is blocked and the stock script suppresses release-note popups.

**Aynı sekme / Same tab:** rapora ait [ölçüm harness'i](phase3-curtain-2026-11-07/same-tab-harness.txt) geçici dizinden çalıştı; mevcut betiklere ekleme yapılmadı. Faz 0'daki gibi `BACKGROUND_WARMUP_DONE` beklendi, sonra **Overview→CP→Orders→CP→Orders** izlendi. Hem eski DOM + iki kare ölçütü (`legacyRowsMs`), hem görünür/etkileşilebilir satır ölçütü (`elapsedMs`) kaydedildi. İkinci ölçüt bir saniye gözlemlenir; bu süre raporlanan gecikmeye dahil değildir, fakat sonraki geçişten önce geçer. İlk iki geçiş ve tekrar dönüşler ayrıdır. Viewport 1600×1000; aynı fixture, auth, HTTPS engeli ve popup bastırması kullanıldı. Bu harness eski tam Faz 0 harness'inin sağlık polling'ini ve her geçiş ekran görüntüsünü çalıştırmaz; tarihsel sayılarla birebir harness eşitliği iddia edilmez.

The report-only harness ran outside existing scripts. It waits for `BACKGROUND_WARMUP_DONE`, then follows Overview→CP→Orders→CP→Orders. It records the legacy DOM/two-frame predicate and the stricter visible/usable-row predicate. A one-second observation follows each usable transition, excluded from its latency but occurring before the next transition. Viewport 1600×1000. Fixture, authentication, HTTPS blocking and popup suppression are shared. It does not run the full Phase 0 health polling or per-transition screenshots; it is not claimed to reproduce every historical harness condition.

## Sonuçlar / Results

Bütün hücreler **medyan [min–maks] saniye / median [min–max] seconds**, her hücre n=3. Sistem süresi sayfa navigasyonundan başlar ve yalnız insan beklemesini çıkarır; tıklama sonrası süreden farklıdır / system time starts at navigation and excludes only human waiting.

### Perde kalkar kalkmaz ilk niyet / Immediate first intent after curtain removal

| Ölçüt / Metric | A · öncesi / before | B · Faz / Phase 3 | C · main |
| --- | ---: | ---: | ---: |
| CP: niyet → görünür/etkileşilebilir satır / intent → usable row | 1.681 [1.387–1.748] | 41.631 [40.441–42.188] | 20.437 [18.562–22.550] |
| CP: sayfa → satır, sistem / navigation → row, system | 75.646 [74.676–76.535] | 43.090 [42.026–43.712] | 22.178 [20.160–23.947] |
| CP denemesinde Overview perdesinin kalkması / Overview curtain removal in CP trial | 74.259 [72.995–74.787] | 1.523 [1.459–1.584] | 1.597 [1.397–1.741] |
| Orders: niyet → satır / intent → row | 9.495 [7.317–10.278] | 3.900 [3.627–8.014] | 6.775 [5.332–7.090] |
| Orders: sayfa → satır, sistem / navigation → row, system | 83.107 [81.869–83.181] | 5.176 [4.925–9.677] | 8.298 [6.651–8.628] |
| Orders denemesinde Overview perdesinin kalkması / Overview curtain removal in Orders trial | 73.685 [72.829–74.551] | 1.297 [1.275–1.663] | 1.522 [1.319–1.538] |

### Arka plan hazırlığı sonrası aynı sekme / Same tab after background preparation

| Ölçüt / Metric | A · öncesi / before | B · Faz / Phase 3 | C · main |
| --- | ---: | ---: | ---: |
| Hazırlık sonrası Overview → CP / after warmup | 3.251 [2.738–3.428] | 24.517 [23.477–26.857] | 4.857 [4.774–5.516] |
| CP → Orders | 1.197 [1.148–1.203] | 1.409 [1.250–1.691] | 1.111 [1.108–1.208] |
| Orders → CP (dönüş / return) | 0.790 [0.774–0.882] | 0.275 [0.263–0.300] | 0.257 [0.253–0.270] |
| CP → Orders (dönüş / return) | 0.214 [0.198–0.225] | 0.242 [0.233–0.246] | 0.247 [0.224–0.251] |
| BACKGROUND_WARMUP_DONE işareti: sayfadan / marker: from navigation | 12.117 [11.214–12.807] | 34.275 [33.394–36.298] | 24.773 [24.704–26.536] |
| Hazırlık beklenmiş senaryoda sayfa → CP / navigation → CP after waiting for warmup | 76.949 [75.268–79.231] | 57.926 [57.766–63.174] | 30.237 [29.639–31.320] |

Eski predicate ile kaydedilen kontrol / legacy-predicate cross-check:

| Ölçüt / Metric | A · öncesi / before | B · Faz / Phase 3 | C · main |
| --- | ---: | ---: | ---: |
| Overview → CP, eski DOM + iki kare ölçütü / legacy DOM + two frames | 3.250 [2.738–3.428] | 24.517 [23.476–26.857] | 4.857 [4.773–5.516] |
| CP → Orders, eski ölçüt / legacy predicate | 1.197 [1.147–1.202] | 1.409 [1.249–1.691] | 1.111 [1.107–1.207] |

Orders ilk-niyet medyanları / first-intent medians: **A 9.495 / B 3.900 / C 6.775 sn / s**. Main'in Orders ilk-niyet medyanı Faz 3'ten daha yüksek; örnek aralıkları örtüşüyor ve n=3 ile neden izole edilmedi / main's Orders first-intent median is higher than Phase 3; sample ranges overlap and n=3 does not isolate the cause. CP kazancı Orders'a genellenmez / CP gains must not be generalized to Orders.

CP ilk niyetinde `startedWithRows`: A'nın üç koşusunda **24.982**, B ve C'nin üçer koşusunda **null** / CP first intent started with 24,982 rows in all A runs and no loaded rows in any B/C run. Hazırlık sonrası senaryo her revizyonun kendi `BACKGROUND_WARMUP_DONE` işaretini kullanır; A'da bu işaret perde kalkmadan önce gelebilir / the prepared scenario uses each revision's own marker, which can precede curtain removal in A.

CP'nin tüm tekrarları / all CP repetitions:

| Revizyon / Revision | CP ilk niyet, blok 1 / 2 / 3 sn / first intent s | Hazırlık sonrası CP, blok 1 / 2 / 3 sn / after warmup s |
| --- | --- | --- |
| before | 1.748 / 1.387 / 1.681 | 2.738 / 3.251 / 3.428 |
| phase3 | 41.631 / 42.188 / 40.441 | 26.857 / 23.477 / 24.517 |
| main | 18.562 / 20.437 / 22.550 | 4.857 / 4.774 / 5.516 |

Ham Orders tekrarları, bütün saatler ve kesin milisaniyeler [summary.json](phase3-curtain-2026-11-07/summary.json) ve tekil JSON'lardadır / all Orders repetitions, clocks and exact milliseconds are in the summary and raw JSON files. Ayrı medyanların toplamı alınmadı; toplam satır süreleri her örneğin kendi saatinden hesaplandı / total row times are computed per observation, not by adding separate medians.

## TR — Ölçüme dayanan seçenekler

1. **Hızlı birincil ekran kapısını koru; CP ilk niyetini ayrı kabul ölçütü yap.** Sayfadan CP'ye 75.646 → 22.178 sn kazanım, tüm hazırlığı tekrar perdenin koşulu yapmayı desteklemiyor. Buna rağmen 20.437 sn ilk tıklama beklemesi devam eden performans işi olarak izlenmeli. Orders sonuçları da yukarıda açıkça verildi; CP kazancı bütün geçişlere genellenmez.
2. **“CP'yi arka planda hazırla” zaten mevcut. [Doğrulandı]** Güncel [`app-main.js`](../../resources/app/public/app-main.js) içinde `backgroundWarmupSteps()` CP verisini, `cpAssistant` özelliğini ve ortak öncelikleri hazırlıyor; `scheduleBackgroundModuleWarmup()` perde kalktıktan sonra çalışıyor, Overview da `ensureOverviewCpDependency()` çağırıyor. Ölçülen mevcut hazırlık sonrası CP 4.857 sn; anında niyet 20.437 sn. Kullanıcının Overview'da doğal beklemesi varsa bu hazırlık yararlı olabilir. Ancak hazırlık bitişi sayfadan **24.773 sn**, o senaryoda CP satırı **30.237 sn**: sırf tıklama metriği düşsün diye kullanıcıyı bekletmek toplamı iyileştirmedi. Bu iki ayrı senaryo ek bir prewarm uygulamasının A/B testi değildir.
3. **İlk görünür CP hesabı/çizimini ve hazırlanmış sonucun yeniden kullanımını hedefle. [Hipotez]** Hazırlık tamamlanmışken bile 4.857 sn kalması, yalnız ağ/veri ön yüklemesinin yeterli olmadığını gösteriyor. Hızlı tekrar dönüşleri de ilk gösterime özgü işin araştırılmasını destekliyor. Hazırlanan karar/sütun sonucunun geçerli revizyonda ilk çizimde yeniden kullanılması, ardından kalan senkron işin bölünmesi veya uygun saf hesabın worker'a taşınması ayrı ölçümlü adaylardır. Bu rapor belirli bir fonksiyonun kök neden olduğunu veya bu adayların kaç saniye kazandıracağını kanıtlamaz.

Yeni eager-init, görünmeyen tablo çizimi, farklı warmup sırası veya worker uygulaması yapılmadı. Yeni hazırlık seçeneği ölçülecekse aynı anında-niyet/sistem-süresi çiftiyle, görünmeyen modül lazy kuralı, yetki, kaynak, bellek ve revizyon sınırları korunarak sınanmalı.

## EN — Decision and measured options

**[Verified] The tradeoff is substantially smaller on current main, but I still do not recommend accepting immediate CP navigation as resolved.** Main's first-intent CP latency is **20.437 s**, 50.9% below Phase 3 but **12.2×** the pre-Phase-3 value. Navigation-to-CP system time improves from **75.646 to 22.178 s**. The post-click problem remains while the overall launch benefit is preserved. No formal time SLO was supplied; this acceptance recommendation is an engineering judgment based on both clocks.

The historical 4.8→76.7 s and 15.9→46.2 s values are context, not denominators for this machine/browser. The tables use matched A/B/C reruns. Prepared same-tab CP changes from **3.251 to 4.857 s**, also remaining above the pre-Phase-3 level; first display and repeat CP/Orders returns are separate. CP gains do not establish an improvement in every Orders transition.

1. **Keep the fast primary-screen gate and track immediate CP latency separately.** The measured navigation-to-row improvement does not support restoring all background preparation as a startup gate.
2. **CP background preparation already exists [Verified].** `backgroundWarmupSteps()` loads CP, the assistant and unified priorities after reveal; Overview also requests its CP dependency. Existing warmup reduces the observed post-click wait from 20.437 to 4.857 s across these separate scenarios. It can help during natural Overview dwell. However, warmup finishes at **24.773 s** from navigation and CP appears at **30.237 s** in that scenario. Artificially waiting for warmup does not improve the observed total time. This is not an A/B test of an additional prewarm implementation.
3. **Investigate first-display computation/rendering and reuse of prepared results [Hypothesis].** The residual 4.857 s after preparation and fast repeat returns motivate this investigation. Reusing valid decision/column results, splitting remaining synchronous work, or moving suitable pure computation to a worker are candidates for separate measured experiments. These observations neither identify a specific function as the cause nor quantify the benefit of those unimplemented candidates.

No eager initialization, hidden-table rendering, changed warmup order or worker was implemented. Any follow-up experiment should preserve lazy-module, access, source, memory and revision boundaries and measure both click latency and navigation-to-row system time.

## Kanıt, doğrulama ve sınırlar / Evidence, validation and limits

- **18/18 senaryo, 54/54 geçiş başarılı / scenarios and transitions passed.** İlk niyet ve aynı sekmede CP 24.982, Orders 30.000; erişim, satır DOM'u, source Excel SHA'ları, projection generation'ları, store revizyonları ve disk manifest kimliği doğrulandı. Renderer pageerror: 0; timeout: 0. Bunlar veri kimliği kontrolleridir; ayrı iş kuralı eşdeğerlik testi değildir / these validate data identity, not separate business-rule equivalence.
- Her senaryo için JSON, stdout, sunucu log'u ve varsa stall CPU profilleri [kanıt klasöründe](phase3-curtain-2026-11-07/). [schedule.json](phase3-curtain-2026-11-07/schedule.json) sıra ve komutları, [manifest.json](phase3-curtain-2026-11-07/manifest.json) SHA-256 ve boyutları içerir. Harness/driver/özetleyici kaynakları metin kanıtıdır; mevcut `scripts/*` değişmedi / harness, driver and collector source are text evidence; existing scripts are unchanged.
- n=3, tek makine, Linux headless Chromium. Windows/Electron, antivirüs, soğuk OS cache, uzun oturum, çok kullanıcı ve farklı kullanıcı profili ölçülmedi / not measured. Aynı sentetik moderatör durumu kullanıldı / same synthetic moderator state. Bu çalışma her #886/#888/#889/#892 PR'ının katkısını ayrı izole etmez / does not isolate each merged PR's contribution.
- Sunucunun mevcut stall profiler'ı bütün kollarda açıktı; overhead kapalı A/B yapılmadı. Süreler saf CPU süresi değildir. Seed'in `/api/health` 404 kayıtları başarılı sağlık ölçümü sayılmaz; bu rapor endpoint performansı iddia etmez / the existing server stall profiler remained enabled; its overhead was not isolated, timings are not pure CPU, and seed health 404 RTTs are not successful health measurements.
- Mevcut first-transition/startup benchmark testleri **16/16 başarılı**; [test çıktısı](phase3-curtain-2026-11-07/probe-tests.txt) ve [bütünlük kontrolleri](phase3-curtain-2026-11-07/validation.txt) saklandı. Ürün kodu değişmediği için tam regresyon çalıştırılmadı / all 16 existing probe/benchmark tests passed and integrity evidence is retained; the full product regression was not run for this documentation-only change. PR checks ayrı değerlendirilir / PR checks are assessed separately.
- PR ayrı rapor değişikliğidir; merge, TEST veya STABLE yayını yapılmadı / separate report PR; no merge, TEST or STABLE publication.

## Yeniden çalıştırma / Reproduction

Temiz A/B/C worktree'leri ve aynı uygulama bağımlılıklarını hazırla. Playwright modülünün yolunu `PLAYWRIGHT_MODULE`, Chromium yolunu `CHROMIUM_PATH` ile ver. Kanıt klasöründeki sürücü, bu oturumun `/tmp/phase3-remeasure/` yerleşimini ve komutlarını aynen kaydeder; başka yerde kök yolları uyarlanır. Her bağımsız yeniden seride yeni bir ortak seed oluştur; eski generation değerlerini yeni cache'e elle atama.

Prepare clean pinned worktrees and the same app dependencies. Set `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH`. The saved driver records the exact layout and commands from this session; adapt root paths when relocating. Build one fresh shared seed for an independent rerun rather than assigning old generation IDs to new caches.

```sh
mkdir -p /tmp/buyerlog-startup-phase3-seed/source
tar -xzf docs/performance-program/fixtures/source-30000-seed7-20261105.tar.gz \
  -C /tmp/buyerlog-startup-phase3-seed/source
node resources/app/scripts/benchmark-startup-orders.js --rows 30000 \
  --fixture-root /tmp/buyerlog-startup-phase3-seed --skip-same-tab \
  --out /tmp/phase3-remeasure/seed-measurement.json
node resources/app/scripts/benchmark-first-transitions.js \
  --app-root /path/to/pinned/resources/app \
  --measurement /tmp/phase3-remeasure/seed-measurement.json --out /tmp/first.json
node - --harness-app "$PWD/resources/app" --app-root /path/to/pinned/resources/app \
  --measurement /tmp/phase3-remeasure/seed-measurement.json --out /tmp/same.json \
  < docs/performance/phase3-curtain-2026-11-07/same-tab-harness.txt
```
