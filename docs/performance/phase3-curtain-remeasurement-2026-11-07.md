# Faz 3 açılış perdesi: güncel main yeniden ölçümü / Phase 3 startup curtain: current-main remeasurement

**Tarih / Date:** 7 Kasım / November 2026 (Europe/Istanbul). Ham zaman damgaları UTC / raw timestamps UTC: 2026-11-07T17:29:46Z – 2026-11-07T18:11:35Z.
**Kapsam / Scope:** yalnız ölçüm, rapor ve ölçüm kanıtı / measurement, report and evidence only. Bu PR ürün kodunu veya mevcut `scripts/*` dosyalarını değiştirmez / this PR changes no product code or existing scripts. Risk: P3, davranış değişikliği yok / no behavior change.

## TR — Karar

**[Doğrulandı] Güncel main’de ödünleşim küçüldü; anında CP'ye geçiş için hâlâ kabul öneremiyorum.** Güncel main'de CP ilk niyeti **12.860 sn**; Faz 3'ten %69.1 kısa, Faz 3 öncesinin **7.7 katı**. Buna karşılık sayfa başlangıcından görünür CP satırına toplam sistem süresi **75.646 → 14.391 sn**. İlk tıklama sorunu sürerken genel açılış kazanımı da korunuyor. Resmî bir saniye eşiği verilmedi; kabul önerisi bu iki gözlemin mühendislik değerlendirmesidir.

Hazırlık bitmiş aynı sekmede ilk CP **3.251 → 4.687 sn**; Faz 3 öncesi düzeye de dönmedi. Sonraki CP/Orders dönüşleri aşağıdaki tabloda. İlk giriş ile hazırlanmış geçiş aynı olay değildir. Eski dokümandaki 4,8 → 76,7 ve 15,9 → 46,2 sn sayıları tarihsel bağlamdır; yeni makine/tarayıcıyla doğrudan oranlanmaz. Karşılaştırmalar aynı fixture ile aşağıda açıklanan iki seriden hesaplanmıştır.

## Yöntem / Method

| Kol / Variant | Sabit commit / Pinned commit | Anlam / Meaning |
| --- | --- | --- |
| A · before | `873c1f4497535252db12c52f7d7a25155433fa5d` | Faz 3 öncesi / before Phase 3 |
| B · phase3 | `873a14f42f6cb0feef18cc76d3fb3dc1cb0e4f1c` | #879, Faz 3 / Phase 3 |
| X · CP delta snapshot | `5a1656e98deeb573f6245f4b24a8135cc77a0d7b` | #886, #888, #889, #892 sonrası sabit kontrol / frozen post-#892 control |
| C · main | `63159fb32ff3d5bdc5f142b4a8f16ca6a3983240` | Güncel main, Faz 5 #902 dahil / latest main including Phase 5 #902 |

- **Önkoşul doğrulandı / Prerequisite verified:** GitHub #892 `merged=true`; merge commit `5a1656e98deeb573f6245f4b24a8135cc77a0d7b` main'in atası / ancestor of main. İlk tamamlanan X kolu bu commit'tir / this is the initial X control revision.
- **Main ilerlemesi / Main advancement:** ilk seri tamamlanınca main önce test düzeltmesi `2083ffd7`, sonra gerçek runtime değişikliği olan **Faz 5 #902 (`63159fb3`)** ile ilerledi. Bu nedenle son C sonuçları yeniden ölçüldü; X'in yeni tekrarları iki zaman dilimi arasındaki kontrolü sağlıyor / C was remeasured after the runtime change; repeated X controls connect the two time windows. C seed'inin checkout'u `2f7269caacf7cb27639da84a936498efdc5d15de`: bu commit `63159fb3` üzerine yalnız ilk raporu ekler; çalışma kodu aynıdır / this checkout adds only the initial report over the measured runtime. [Runtime kimliği](phase3-curtain-2026-11-07/main-runtime-equivalence.json).
- Fixture: [`source-30000-seed7-20261105.tar.gz`](../performance-program/fixtures/source-30000-seed7-20261105.tar.gz), SHA-256 `5913414603984b02b1c30b87f1f9231da3718ab797a007f4bd14067ec6cd5c70`. Arşiv ve üç Excel SHA'sı doğrulandı / archive and three workbook hashes verified. 30.000 Orders, **24.982 CP**; yalnız sentetik veri / synthetic data only.
- Her tabloda her senaryo için **n=3**. İlk seri: **A→B→X, B→X→A, X→A→B**. Güncel main ek serisi: **C→X, X→C, C→X**. Her kolda ilk niyet ve ayrı sunucu/tarayıcıyla aynı sekme ölçüldü; tek etkin tarayıcı / first-intent and separate same-tab contexts, one active browser. A/B ilk seriden, C ek seriden gelir; X her iki seride üçer kez tekrarlandı / A/B come from the initial cohort, C from the follow-up cohort, X bridges both. Bu tam bir tek-zamanlı A/B/C randomizasyonu değildir / this is not one simultaneous randomized A/B/C cohort.
- Linux, AMD EPYC 9V74; 4 vCPU kotası (`400000 100000`), 16 GiB cgroup bellek sınırı; Node v24.19.0, Chromium 154.0.8037.57, Playwright 1.62.1. Disk/OS cache temizlenmedi / OS page cache not flushed.
- İlk seri/X için `5a1656e9`, C için `63159fb3` runtime'ında ayrı, tam başarılı Faz 0 seed kurulumları kullanıldı; **Excel baytları ve SHA'lar aynı**. Faz 5 eski cache'i yeniden ürettiği için eski cache'i C'ye taşımak generation kontrolünü bozdu. C'nin kendi cache'iyle geçerli protokol yeniden başlatıldı; iki başarısız pilot ham kanıtta tutuldu ve medyanlara alınmadı. Her geçerli koşu kendi seed'inin temiz kopyasıdır; generation/source revision kimliği **kol içinde** doğrulanır, sürümler arasında aynı generation iddiası yoktur.
- Separate passing native-cache seeds were built for X and C from **identical workbook bytes/hashes**. Phase 5 rebuilt the older cache, so two old-cache pilots failed generation validation and remain in the evidence, excluded from accepted latency medians. Each valid run clones its own seed; generation/source-revision identity is enforced **within** its seed, not equated across runtime versions. The condition is a cached launch, not import or first installation.

**İlk niyet / First intent:** mevcut [`benchmark-first-transitions.js`](../../resources/app/scripts/benchmark-first-transitions.js) ve probe değiştirilmeden kullanıldı; `--app-root` ile hedef revizyon seçildi. Her CP ve Orders denemesi yeni tarayıcı bağlamında Overview açtı. Gerçek startup-complete olayı sonrası sıfır gecikmeli `switchTab` niyeti; görünür içerik, beklenen satır sayısı, satır DOM'u, iki animation frame ve görünür modül perdesinin kalkması zorunlu. Bir saniyelik kararlılık gözlemi gecikmeye eklenmez. Otomatik Continue insan beklemesi eklemez; ana iş parçacığı kuyruğu ve animasyon gecikmeleri sürede kalır. Viewport 1440×900; dış HTTPS engelli, release-note popup'ı betiğin mevcut yöntemiyle bastırıldı.

The existing first-transition script and probe were used unchanged against each app root. Each target starts from Overview in a fresh browser context. A zero-delay intent follows the actual startup-complete event; visible content, expected rows, row DOM, two animation frames and absence of a module curtain are required. The one-second stability observation is excluded from latency. Continue is automatic; input queue and animation delay remain included. Viewport 1440×900; external HTTPS is blocked and the stock script suppresses release-note popups.

**Aynı sekme / Same tab:** rapora ait [ölçüm harness'i](phase3-curtain-2026-11-07/same-tab-harness.txt) geçici dizinden çalıştı; mevcut betiklere ekleme yapılmadı. Faz 0'daki gibi `BACKGROUND_WARMUP_DONE` beklendi, sonra **Overview→CP→Orders→CP→Orders** izlendi. Hem eski DOM + iki kare ölçütü (`legacyRowsMs`), hem görünür/etkileşilebilir satır ölçütü (`elapsedMs`) kaydedildi. İkinci ölçüt bir saniye gözlemlenir; bu süre raporlanan gecikmeye dahil değildir, fakat sonraki geçişten önce geçer. İlk iki geçiş ve tekrar dönüşler ayrıdır. Viewport 1600×1000; aynı fixture, auth, HTTPS engeli ve popup bastırması kullanıldı. Bu harness eski tam Faz 0 harness'inin sağlık polling'ini ve her geçiş ekran görüntüsünü çalıştırmaz; tarihsel sayılarla birebir harness eşitliği iddia edilmez.

The report-only harness ran outside existing scripts. It waits for `BACKGROUND_WARMUP_DONE`, then follows Overview→CP→Orders→CP→Orders. It records the legacy DOM/two-frame predicate and the stricter visible/usable-row predicate. A one-second observation follows each usable transition, excluded from its latency but occurring before the next transition. Viewport 1600×1000. Fixture, authentication, HTTPS blocking and popup suppression are shared. It does not run the full Phase 0 health polling or per-transition screenshots; it is not claimed to reproduce every historical harness condition.

## Sonuçlar / Results

Bütün hücreler **medyan [min–maks] saniye / median [min–max] seconds**, her hücre n=3. Sistem süresi sayfa navigasyonundan başlar ve yalnız insan beklemesini çıkarır; tıklama sonrası süreden farklıdır / system time starts at navigation and excludes only human waiting.

### Perde kalkar kalkmaz ilk niyet / Immediate first intent after curtain removal

| Ölçüt / Metric | A · öncesi / before | B · Faz / Phase 3 | C · main |
| --- | ---: | ---: | ---: |
| CP: niyet → görünür/etkileşilebilir satır / intent → usable row | 1.681 [1.387–1.748] | 41.631 [40.441–42.188] | 12.860 [12.858–17.165] |
| CP: sayfa → satır, sistem / navigation → row, system | 75.646 [74.676–76.535] | 43.090 [42.026–43.712] | 14.391 [14.383–18.873] |
| CP denemesinde Overview perdesinin kalkması / Overview curtain removal in CP trial | 74.259 [72.995–74.787] | 1.523 [1.459–1.584] | 1.532 [1.523–1.707] |
| Orders: niyet → satır / intent → row | 9.495 [7.317–10.278] | 3.900 [3.627–8.014] | 6.720 [2.892–7.211] |
| Orders: sayfa → satır, sistem / navigation → row, system | 83.107 [81.869–83.181] | 5.176 [4.925–9.677] | 8.178 [4.319–8.631] |
| Orders denemesinde Overview perdesinin kalkması / Overview curtain removal in Orders trial | 73.685 [72.829–74.551] | 1.297 [1.275–1.663] | 1.427 [1.419–1.458] |

### Arka plan hazırlığı sonrası aynı sekme / Same tab after background preparation

| Ölçüt / Metric | A · öncesi / before | B · Faz / Phase 3 | C · main |
| --- | ---: | ---: | ---: |
| Hazırlık sonrası Overview → CP / after warmup | 3.251 [2.738–3.428] | 24.517 [23.477–26.857] | 4.687 [4.562–4.784] |
| CP → Orders | 1.197 [1.148–1.203] | 1.409 [1.250–1.691] | 1.265 [1.137–1.308] |
| Orders → CP (dönüş / return) | 0.790 [0.774–0.882] | 0.275 [0.263–0.300] | 0.313 [0.292–0.329] |
| CP → Orders (dönüş / return) | 0.214 [0.198–0.225] | 0.242 [0.233–0.246] | 0.243 [0.227–0.269] |
| BACKGROUND_WARMUP_DONE işareti: sayfadan / marker: from navigation | 12.117 [11.214–12.807] | 34.275 [33.394–36.298] | 18.373 [18.329–18.864] |
| Hazırlık beklenmiş senaryoda sayfa → CP / navigation → CP after waiting for warmup | 76.949 [75.268–79.231] | 57.926 [57.766–63.174] | 23.169 [23.033–23.526] |

Eski predicate ile kaydedilen kontrol / legacy-predicate cross-check:

| Ölçüt / Metric | A · öncesi / before | B · Faz / Phase 3 | C · main |
| --- | ---: | ---: | ---: |
| Overview → CP, eski DOM + iki kare ölçütü / legacy DOM + two frames | 3.250 [2.738–3.428] | 24.517 [23.476–26.857] | 4.687 [4.562–4.784] |
| CP → Orders, eski ölçüt / legacy predicate | 1.197 [1.147–1.202] | 1.409 [1.249–1.691] | 1.265 [1.137–1.308] |

Orders ilk-niyet medyanları / first-intent medians: **A 9.495 / B 3.900 / C 6.720 sn / s**. Main'in Orders ilk-niyet medyanı Faz 3'e göre daha yüksek; n=3 ile neden izole edilmedi / main's Orders first-intent median is higher than Phase 3; n=3 does not isolate the cause. CP kazancı Orders'a genellenmez / CP gains must not be generalized to Orders.

CP ilk niyetinde `startedWithRows`: A'nın üç koşusunda **24.982**, B ve C'nin üçer koşusunda **null** / CP first intent started with 24,982 rows in all A runs and no loaded rows in any B/C run. Hazırlık sonrası senaryo her revizyonun kendi `BACKGROUND_WARMUP_DONE` işaretini kullanır; A'da bu işaret perde kalkmadan önce gelebilir / the prepared scenario uses each revision's own marker, which can precede curtain removal in A.

CP'nin tüm tekrarları / all CP repetitions:

| Revizyon / Revision | CP ilk niyet, blok 1 / 2 / 3 sn / first intent s | Hazırlık sonrası CP, blok 1 / 2 / 3 sn / after warmup s |
| --- | --- | --- |
| before | 1.748 / 1.387 / 1.681 | 2.738 / 3.251 / 3.428 |
| phase3 | 41.631 / 42.188 / 40.441 | 26.857 / 23.477 / 24.517 |
| main | 12.858 / 12.860 / 17.165 | 4.562 / 4.784 / 4.687 |

Ham Orders tekrarları, bütün saatler ve kesin milisaniyeler [summary.json](phase3-curtain-2026-11-07/summary.json) ve tekil JSON'lardadır / all Orders repetitions, clocks and exact milliseconds are in the summary and raw JSON files. Ayrı medyanların toplamı alınmadı; toplam satır süreleri her örneğin kendi saatinden hesaplandı / total row times are computed per observation, not by adding separate medians.

## İki seri arasındaki sabit kontrol / Fixed control across cohorts

X CP ilk-niyet medyanı **20.437 → 22.857 sn** değişti; zaman pencereleri arasında varyans vardır / X first-intent CP median changed across the two time windows. Aynı ek seride C ile X karşılaştırması **12.860 / 22.857 sn** / matched follow-up C/X medians. X (`5a1656e9`) aynı eski seed ile yeniden ölçüldü; C yeni native seed kullanır. Üçer örnek: **medyan [min–maks] sn / median [min–max] s**. X kontrolü zaman farkını görünür kılar; farklı cache şemaları ve main'in diğer değişiklikleri nedensel olarak ayrıştırılmadı / repeated X controls show temporal drift; cache schema and other main changes remain combined.

| Ölçüt / Metric | X ilk seri / initial | X ek seri / bridge | C güncel main / current |
| --- | ---: | ---: | ---: |
| CP ilk niyet / first intent | 20.437 [18.562–22.550] | 22.857 [20.444–23.541] | 12.860 [12.858–17.165] |
| CP sayfadan / navigation to row | 22.178 [20.160–23.947] | 24.287 [22.309–24.964] | 14.391 [14.383–18.873] |
| Hazırlık sonrası CP / prepared CP | 4.857 [4.774–5.516] | 4.699 [4.649–4.733] | 4.687 [4.562–4.784] |

Eski cache ile C'nin başarısız ilk-niyet pilotunda CP'nin görünen UI süresi **20.672 sn**, sayfa→satır **26.454 sn** idi. Generation kimliği geçmediği için bu değer karşılaştırılabilir performans başarısı veya veri eşdeğerliği sayılmaz; cache geçişi koşulu native-cache sonuçlarıyla karıştırılmaz / the failed old-cache pilot showed these UI times, but generation validation failed, so they are not accepted performance/equivalence results and must not be mixed with native-cache medians.

## TR — Ölçüme dayanan seçenekler

1. **Hızlı birincil ekran kapısını koru; CP ilk niyetini ayrı kabul ölçütü yap.** Sayfadan CP'ye 75.646 → 14.391 sn kazanım, tüm hazırlığı tekrar perdenin koşulu yapmayı desteklemiyor. Buna rağmen 12.860 sn ilk tıklama beklemesi devam eden performans işi olarak izlenmeli. Orders sonuçları da yukarıda açıkça verildi; CP kazancı bütün geçişlere genellenmez.
2. **“CP'yi arka planda hazırla” zaten mevcut. [Doğrulandı]** Güncel [`app-main.js`](../../resources/app/public/app-main.js) içinde `backgroundWarmupSteps()` CP verisini, `cpAssistant` özelliğini ve ortak öncelikleri hazırlıyor; `scheduleBackgroundModuleWarmup()` perde kalktıktan sonra çalışıyor, Overview da `ensureOverviewCpDependency()` çağırıyor. Ölçülen mevcut hazırlık sonrası CP 4.687 sn; anında niyet 12.860 sn. Kullanıcının Overview'da doğal beklemesi varsa bu hazırlık yararlı olabilir. Ancak hazırlık bitişi sayfadan **18.373 sn**, o senaryoda CP satırı **23.169 sn**: sırf tıklama metriği düşsün diye kullanıcıyı bekletmek toplamı iyileştirmedi. Bu iki ayrı senaryo ek bir prewarm uygulamasının A/B testi değildir.
3. **İlk görünür CP hesabı/çizimini ve hazırlanmış sonucun yeniden kullanımını hedefle. [Hipotez]** Hazırlık tamamlanmışken bile 4.687 sn kalması, yalnız ağ/veri ön yüklemesinin yeterli olmadığını gösteriyor. Hızlı tekrar dönüşleri de ilk gösterime özgü işin araştırılmasını destekliyor. Hazırlanan karar/sütun sonucunun geçerli revizyonda ilk çizimde yeniden kullanılması, ardından kalan senkron işin bölünmesi veya uygun saf hesabın worker'a taşınması ayrı ölçümlü adaylardır. Bu rapor belirli bir fonksiyonun kök neden olduğunu veya bu adayların kaç saniye kazandıracağını kanıtlamaz.

Yeni eager-init, görünmeyen tablo çizimi, farklı warmup sırası veya worker uygulaması yapılmadı. Yeni hazırlık seçeneği ölçülecekse aynı anında-niyet/sistem-süresi çiftiyle, görünmeyen modül lazy kuralı, yetki, kaynak, bellek ve revizyon sınırları korunarak sınanmalı.

## EN — Decision and measured options

**[Verified] The tradeoff is substantially smaller on current main, but I still do not recommend accepting immediate CP navigation as resolved.** Main's first-intent CP latency is **12.860 s**, 69.1% below Phase 3 but **7.7×** the pre-Phase-3 value. Navigation-to-CP system time improves from **75.646 to 14.391 s**. The post-click problem remains while the overall launch benefit is preserved. No formal time SLO was supplied; this acceptance recommendation is an engineering judgment based on both clocks.

The historical 4.8→76.7 s and 15.9→46.2 s values are context, not denominators for this machine/browser. The tables use same-fixture runs across the two documented cohorts. Prepared same-tab CP changes from **3.251 to 4.687 s**, remaining above the pre-Phase-3 level; first display and repeat CP/Orders returns are separate. CP gains do not establish an improvement in every Orders transition.

1. **Keep the fast primary-screen gate and track immediate CP latency separately.** The measured navigation-to-row improvement does not support restoring all background preparation as a startup gate.
2. **CP background preparation already exists [Verified].** `backgroundWarmupSteps()` loads CP, the assistant and unified priorities after reveal; Overview also requests its CP dependency. Existing warmup reduces the observed post-click wait from 12.860 to 4.687 s across these separate scenarios. It can help during natural Overview dwell. However, warmup finishes at **18.373 s** from navigation and CP appears at **23.169 s** in that scenario. Artificially waiting for warmup does not improve the observed total time. This is not an A/B test of an additional prewarm implementation.
3. **Investigate first-display computation/rendering and reuse of prepared results [Hypothesis].** The residual 4.687 s after preparation and fast repeat returns motivate this investigation. Reusing valid decision/column results, splitting remaining synchronous work, or moving suitable pure computation to a worker are candidates for separate measured experiments. These observations neither identify a specific function as the cause nor quantify the benefit of those unimplemented candidates.

No eager initialization, hidden-table rendering, changed warmup order or worker was implemented. Any follow-up experiment should preserve lazy-module, access, source, memory and revision boundaries and measure both click latency and navigation-to-row system time.

## Kanıt, doğrulama ve sınırlar / Evidence, validation and limits

- **Toplam 32 deneme: 30 başarılı, 2 pilot generation nedeniyle başarısız. Başarılı serilerde 90/90 geçiş doğrulandı / 32 attempts: 30 passed, two pilots failed generation validation; 90 validated transitions in accepted cohorts.** Eski cache'i C'ye taşıyan bu iki pilot [pilot-failures.json](phase3-curtain-2026-11-07/pilot-failures.json) ve tekil ham dosyalarda saklandı / two old-cache pilots failed generation validation and are retained separately. İlk niyet ve aynı sekmede CP 24.982, Orders 30.000; erişim, satır DOM'u, source Excel SHA'ları, projection generation'ları, store revizyonları ve disk manifest kimliği doğrulandı. Geçerli serilerde renderer pageerror: 0; timeout: 0 / zero renderer errors and timeouts in accepted cohorts. Bunlar veri kimliği kontrolleridir; ayrı iş kuralı eşdeğerlik testi değildir / these validate data identity, not separate business-rule equivalence.
- Her senaryo için JSON, stdout, sunucu log'u ve varsa stall CPU profilleri [kanıt klasöründe](phase3-curtain-2026-11-07/). [schedule.json](phase3-curtain-2026-11-07/schedule.json) sıra ve komutları, [manifest.json](phase3-curtain-2026-11-07/manifest.json) SHA-256 ve boyutları içerir. Harness/driver/özetleyici kaynakları metin kanıtıdır; mevcut `scripts/*` değişmedi / harness, driver and collector source are text evidence; existing scripts are unchanged.
- n=3, tek makine, Linux headless Chromium. Windows/Electron, antivirüs, soğuk OS cache, uzun oturum, çok kullanıcı ve farklı kullanıcı profili ölçülmedi / not measured. Aynı sentetik moderatör kurulumu kullanıldı; iki native seed'in sunucu üretimi kimlikleri farklıdır / same synthetic moderator setup, with independently generated server identities in the two native seeds. Bu çalışma #886/#888/#889/#892 ve #902 katkılarını ayrı izole etmez / does not isolate each merged PR's contribution, including Phase 5 #902.
- Sunucunun profiler varsayılanı sürüme bağlıdır: A/B/X'te eski varsayılan açık; C'de `BL_STALL_PROFILE=1` olmadıkça kapalı. Varsayılanları değiştirmedik; profiler katkısı ayrı A/B ile izole edilmedi. Süreler saf CPU süresi değildir. Seed'in `/api/health` 404 kayıtları başarılı sağlık ölçümü sayılmaz; bu rapor endpoint performansı iddia etmez / production profiler defaults were preserved (older revisions enabled; C opt-in, disabled here); overhead was not isolated, timings are not pure CPU, and seed health 404 RTTs are not successful health measurements.
- Mevcut first-transition/startup benchmark testleri **16/16 başarılı**; [test çıktısı](phase3-curtain-2026-11-07/probe-tests.txt) ve [bütünlük kontrolleri](phase3-curtain-2026-11-07/validation.txt) saklandı. Ürün kodu değişmediği için tam regresyon çalıştırılmadı / all 16 existing probe/benchmark tests passed and integrity evidence is retained; the full product regression was not run for this documentation-only change. PR checks ayrı değerlendirilir / PR checks are assessed separately.
- PR ayrı rapor değişikliğidir; merge, TEST veya STABLE yayını yapılmadı / separate report PR; no merge, TEST or STABLE publication.

## Yeniden çalıştırma / Reproduction

Temiz A/B/C worktree'leri ve aynı uygulama bağımlılıklarını hazırla. Playwright modülünün yolunu `PLAYWRIGHT_MODULE`, Chromium yolunu `CHROMIUM_PATH` ile ver. Kanıt klasöründeki sürücü, bu oturumun `/tmp/phase3-remeasure/` yerleşimini ve komutlarını aynen kaydeder; başka yerde kök yolları uyarlanır. Her bağımsız yeniden seride gerekli cache şeması için native seed oluştur; eski generation değerlerini yeni cache'e elle atama. Ek seri komutları `run-main-bridge.py.txt` içindedir.

Prepare clean pinned worktrees and the same app dependencies. Set `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH`. The saved driver records the exact layout and commands from this session; adapt root paths when relocating. Build native seeds for the relevant cache schemas from the same source bytes; do not assign old generation IDs to new caches. The saved run-main-bridge.py.txt records each seed choice.

```sh
mkdir -p /tmp/phase3-remeasure /tmp/buyerlog-startup-phase3-seed/source
tar -xzf docs/performance-program/fixtures/source-30000-seed7-20261105.tar.gz \
  -C /tmp/buyerlog-startup-phase3-seed/source
node /path/to/X/resources/app/scripts/benchmark-startup-orders.js --rows 30000 \
  --app-root /path/to/X/resources/app \
  --fixture-root /tmp/buyerlog-startup-phase3-seed --skip-same-tab \
  --out /tmp/phase3-remeasure/seed-measurement.json
node resources/app/scripts/benchmark-startup-orders.js --rows 30000 \
  --fixture-root /tmp/buyerlog-startup-phase3-current-seed \
  --source-fixture /tmp/buyerlog-startup-phase3-seed/source --skip-same-tab \
  --out /tmp/phase3-remeasure/current-seed-measurement.json
node resources/app/scripts/benchmark-first-transitions.js \
  --app-root /path/to/pinned/resources/app \
  --measurement /path/to/appropriate-native-seed.json --out /tmp/first.json
node - --harness-app "$PWD/resources/app" --app-root /path/to/pinned/resources/app \
  --measurement /path/to/appropriate-native-seed.json --out /tmp/same.json \
  < docs/performance/phase3-curtain-2026-11-07/same-tab-harness.txt
```
