# #908 Orders — dar tanı / Narrow diagnosis, 2026-11-08

## TR — karar

**#908 performans kabulü BLOKLU kalır.** Eski üç çiftteki Orders gerilemesinin
kök nedeni bu iki üretim dosyasında kanıtlanmadı. Mevcut üretim/test dosyaları
değiştirilmedi; ek betikler yalnız bu kanıt dizinindedir. Ürün düzeltmesi için
RED→GREEN iddiası yoktur. Katkı yeniden üretilebilir tanı ve kanıttır.
Temiz yeni kohortta Orders gerilemesi tekrarlanmadı; buna karşılık **CP ilk niyet
medyanı %7,99 geriledi**. Yeni sonuç eski başarısız kabulün yerine geçmez.

Korunan #908: `96b7d12712259fac9680dd852778bfd73daa292c`.
Main: `1796193f0a57c7785e7bf9fdb3557e33c550b25e`.
Main zaten korunan SHA'nın atasıdır; yeni Main merge'ü gerekmemiştir.
Katkı dalı `contrib/pr908-orders-regression-20261108`; orijinal dal değişmedi.
Uygulama ağacı iki ölçüm kolunda ortak Main/#916/#917 üzerine kuruludur; katkı
adayın `resources/app` ağacını (`47dee74749ff7efb15ce361bc371a884670207c3`)
değiştirmez. [Koruma manifesti](preservation.json).

## Kohortlar ayrı kalır

A = belirtilen Main; B = korunan #908, yeni ürün düzeltmesi olmadan.
Tüm değerler native `benchmark-first-transitions` V2 `elapsedMs` medyanıdır.

| Kohort | CP A→B, ms | Orders A→B, ms | Sınır |
| --- | ---: | ---: | --- |
| Önceki resmî üç çift | 44.721→23.224 | 10.542→11.407 | Orders üç çiftte geriler; CP üçüncü çift +%30,28 |
| İlk yeni tanı, üç çift | 11.221→11.926 | 6.124→5.859 | Seri sırasında yaklaşık 1,4 s arşiv analizi; kabul sayılmaz |
| Tek iş yüküyle temiz tekrar, üç çift | 11.324→12.229 | 6.062→5.865 | CP çiftleri −%1,90 / +%1,47 / +%20,48; Orders −%3,25 / −%4,10 / −%33,22 |
| Yeni native profilli tek A/B | 12.488→11.476 | 6.714→6.279 | 1 ms Profiler + timeline ek yükü; hızlanma/kabul kanıtı değildir |

İlk tanı silinmedi veya temiz tekrar ile birleştirilmedi. Yeni temiz seri sırasında
başka test, tarayıcı veya arşiv analizi çalıştırılmadı; yalnız hafif durum okumaları
yapıldı. Seriler ve ham koşular [kanıt paketindedir](evidence-manifest.json).
Buradaki `passed`, native veri/görünürlük kontrollerinin ve koşu tamamlanmasının
sonucudur; **performans kabulü anlamına gelmez**.

Verilen `/tmp/buyerlog-908-firstcp-final-after917/series.json` bu yeni ortamda yoktu.
Repo içindeki [aynı seri](../shared-ui-post-main-20261107/post-917-20261108/first-intent/series.json)
ile eski trace kaynak paketindeki `source-snapshots/formal-series.json` baytları
eşittir: SHA-256 `96406ca2d0d591219ec989acee749d05ccb1c5001211d1200bcb2bbfea94b092`.
Eski JSON, PNG, trace, RED ve başarısız koşulara dokunulmadı.

## Maliyetin ayrılması

[Doğrulandı] Eski resmî üç çiftte Orders B−A farkı:

| Çift | Veri + satır DOM hazır gözlemi (`dataReadyMs`) | İlk açık satır | Son perde sonrası kullanılabilir satır |
| --- | ---: | ---: | ---: |
| 1 | +423,6 ms | +452,7 ms | +468,4 ms |
| 2 | +9.360,2 ms | +9.422,6 ms | +7.088,5 ms |
| 3 | +1.004,9 ms | +1.015,3 ms | +865,4 ms |

`dataReadyMs` yalnız ağ/JSON süresi değildir: aktif modül, 30k veri, görünür
içerik ve satır DOM'u gözlenir. Event-loop blokları gözlemi de geciktirir.
Başlığın son görsel yerleşimini tek başına kök neden saymak desteklenmiyor;
ikinci ve üçüncü çiftte dataReady→kullanılabilir satır bölümü B'de kısalıyor.

[Doğrulandı] Eski tek-Orders trace'in tam profilinde başlık/blur toplam örneklenen
alt çağrı süresi A 572,393 / B 48,547 ms'dir. Eski tek tanı farklı modül sırası,
profil ek yükü ve bir örnek nedeniyle resmî kohortun gerilemesini kapatmaz.

Yeni profil, **değişmeyen native CP→yeni Orders context'i** yolunu izler.
Profiler/timeline navigation öncesinde açılır, native tamamlanmada tam satır JSON'u
alınmadan durur. CDP `NavigationStart` ile örnekler niyet/veri/paint/gözlem
pencerelerine ayrılır. Orders niyeti→kullanılabilir paint aralığı:

| Doğrudan atıf | Main A | #908 B |
| --- | ---: | ---: |
| `table-header-tracking.js`, inclusive örnek | 72,809 ms | 20,312 ms |
| `workspace-blur.js`, inclusive örnek | 53,817 ms | 5,643 ms |
| Başlık callback timeline süresi | 74,466 ms | 22,686 ms |
| Blur callback timeline süresi | 64,939 ms | 9,504 ms |

Inclusive örnekler/native layout/callback süreleri iç içedir; toplanıp CPU veya
input latency olarak sunulmaz. İmzalı `timeDeltas` mutlak zamana çevrilip sıralanır;
aynı örnekte dosya/fonksiyon tek kez sayılır. Native süreler thread/etiket başına
aralık birleşimiyle hesaplanır. [Analiz](profile-analysis.json.gz),
[yeniden üretim betiği](analyze.py).

[Doğrulandı] Orders context'inde CP hazırlığı iki kolda da sürer. Yeni profilde
kullanılabilir paint→native gözlem sonu aralığında `cp-overview-assistant.js`
alt çağrıları A 1.922,871 / B 1.958,979 ms örneklenmiştir. İç içe checklist
atıfları buna eklenmez. Bu bölüm `elapsedMs` ile aynı pencere değildir; stabilite
gözlemi ve geç perde davranışı ayrıca hesaba katılır. Snapshot'ta sonradan görülen
`CP_PRIORITY_READY` işaretleri profil sınırından sonraysa ölçülen gecikmeye
mal edilmez. Tam olay zamanları ve profil sınırları saklanır.

[Muhtemel] Hazırlık/şema/ön plan işinin zamanlaması ve kaynak rekabeti gerilemenin
incelenmesi gereken karıştırıcılarıdır. [Bilinmiyor] Eski resmî Orders farkının
nedensel açıklaması. Başlık/blur'un doğrudan atfının azalması, eski gerilemenin
başka dosyada olduğunu tek başına ispatlamaz. Görünmeyen CP'yi devre dışı bırakma,
bekletme, yeni render/search sistemi veya semantik optimizasyon yapılmadı.

## Veri ve çıktı eşdeğerliği

Kaynak, aynı seed7/30k XLSX arşividir; üç kaynak dosyanın SHA-256'ları eski
kohortla aynıdır. Yeni ortamda mevcut cache olmadığından native startup betiğiyle
tek başarılı refresh POST ve dört modüllü tam Phase 0 hazırlığı yapıldı; POST
retry yoktur. İlk sandbox denemesi localhost `EPERM` nedeniyle refresh öncesinde
durdu; başarısız log ve kök korundu.

Her A/B kolu aynı Phase 0 kökünün kopyasından bağımsız sunucu ve Chromium süreci
açar; native betik CP ve Orders için ayrı context kullanır. Yeni generation
`mw7on4ax-309477400e82`; source revision
`6403dbf2f6b68dd2c091fbdc87fc8a6e060ddc1ffc99bed9c96e2e156e8739aa`.
Her projection generation'ı, disk manifesti, 24.982 CP/30.000 Orders satırı ve
`orders=0 / suppFob=0` revision'ları native assertion'lardan geçer.

İki yeni üç çiftlik serinin ve profilli A/B'nin tamamında:

- Bütün normalize satır JSON'u SHA'ları eski kohortla da eşittir:
  CP `6ae360b5cc7f2c9b2f125c3814653393438ecc7e175e671d830e0bbc6a50db4b`;
  Orders `3611e608734e9d1db9400fd85fd3be566e55f0ba871ac780a36a381eb514c59b`.
- Bütün satırların own-key sırası eşittir; görünür 50 satırın hücre anahtarı/metni
  ve tam başlık sırası hash'leri iki kolda aynıdır. Yeni serilerde CP 61, Orders
  60 hücredir. Çıktı kesilmedi veya sıralanmadı; örnek satırla yetinilmedi.
- Satır gerçek viewport hit-test'inde açıktır; native V2 görünürlük/stabilite ve
  yetki assertion'ları korunur. Eski 53/60 Orders varyantları birbirine eşit DOM
  ilan edilmez; yeni serilerde görülmeyen 53 varyantının çözüldüğü iddia edilmez.

Ortam: Linux, EPYC 9V74, 4 vCPU kotası, 16 GiB limit, Node 24.19.0,
Chromium 154.0.8037.57, browser/server Europe/Istanbul, 1440×900.
Windows/Electron veya soğuk OS cache ölçümü değildir. Yeni observer'ın
zamanlama-sonrası tam veri yakalama işi eski observer ile aynı bayt programı
değildir; ortak sunucuda CP→Orders aralığını etkileyebilir. Bu yüzden yeni seri
eski resmî kabulün birebir yeniden üretimi veya ürün düzeltmesi sayılmaz.

Ölçüm/testler `flock -n -E 75 /tmp/buyerlog-performance-measurement.lock` altında
seridir. Önce disk/bellek kontrol edildi; yeni ölçüm her kol için en az 1 GiB
boş disk ister. Başkalarının dosyası veya kilit silinmedi. Araçlar/timeout,
assertion, runner concurrency, validator ve i18n baseline değiştirilmedi.

## Ana sohbete entegrasyon devri

Bu kanıt katkısını #908'e entegre etmek, performans kabulünü kapatmaz. Yeni ürün
yaması için bu kapsamda kanıtlanmış gerekçe yoktur. Bir sonraki dar inceleme için
somut sahiplik noktaları (bu katkıda yalnız okundu):

- `app-main.js:2210` — `ensureOrdersLoaded`: projection/JSON, tarih canlandırma,
  fiyat uygulaması, filtreler ve render'a kadar olan ön plan zincirini ayır.
- `app-main.js:9674` — `renderOrdersNow`: native `dataReady` öncesindeki render
  işini ve aynı aralıktaki CP hazırlık olaylarını ortak zaman ekseninde incele.
- `app-main.js:16831` — `backgroundWarmupSteps`/`scheduleBackgroundModuleWarmup`:
  ölçülen CP hazırlığı ile foreground açma niyetinin çakışmasını incele.
  Bu, warmup'ı erteleme/iptal etme önerisinin kanıtlandığı anlamına gelmez.
- Önceden bildirilen 53/60 şema yarışı, bu dosyaların sahibinde ayrıca ele alınmalı;
  #916 checklist kodu/testi veya hızlı kontrolü gevşetilmemeli.

Ek Motion+ kontrolünün ilk Main denemesi, doğru animasyon bütçelerini geçtikten
sonra tam veri assertion'ında durdu: warmup sonrası ancak ilk görünür Orders
render'ından önce alınmış snapshot'ta 30.000 satırın hiçbirinde `Artwork Detail`
ve `Fabric (PLM)` own-key'leri yoktu; ilk render sonrası hepsinde boş string
olarak vardı. Diğer alanlarda fark yoktur. Kaynak zinciri
`app-main.js:9676` → `cpPlmDetailsSync` (`3852`) →
`cp-plm-details.js:26` `project()` ile doğrulanır. Bu ortak Main davranışıdır;
başlık/blur veya tarihsel Orders gerilemesinin kök nedeni olduğu iddia edilmez.
`BACKGROUND_WARMUP_DONE`, bu ilk görünür PLM projection işleminin de tamamlandığı
anlamına gelmez. [Tam başarısız snapshot, fark ve çalıştırılan kaynak](browser/motion-first-attempt.tar.gz)
korunur. Ek kontrolün fixture başlangıcı iki modülün gerçek ilk render'ından
sonraya taşındı; tam satır eşitliği assertion'ı korunup alanların oluşması da
ayrıca beklendi. Alan atma, baseline değiştirme veya assertion gevşetme yoktur.

Görünür yeni düzeltme olmadığından yeni release-note kaydı eklenmez; #908'in mevcut
TR/EN notu ve PNG'si korunur. Gerçek aday uygulamasından yeni yakalanan PNG'ler
ve tarayıcı kabulü bu pakettedir; görüntü yeni performans düzeltmesi iddiası değildir.
PR oluşturma, PR'a push, merge, bağımsız inceleme, TEST veya STABLE yapılmadı.

## Son doğrulama / Final verification

Ürün kodu sabitken, ortak kilit altında sıralı çalıştırılan son paket:

| Kontrol / Check | Sonuç / Result |
| --- | --- |
| İlgili paket / Related package | 23 dosya, 137 PASS / 0 FAIL |
| Değişmeyen #916 hızlı paket / Preserved fast package | 9 dosya, 23 PASS / 0 FAIL |
| Standart tam `npm test` / Standard full suite | 1.302 dosya, tek çağrı, 10/10 batch, concurrency=4; **8.935 PASS / 0 FAIL / 65 mevcut SKIP / 0 CANCEL** |
| `npm run i18n:check` | yeni eksik 0 / baseline 0 |
| `npm run release:notes:validate` | 51 geçerli kayıt / valid entries |

`NODE_OPTIONS`, preload veya test-concurrency override yoktur. Runner/assertion,
timeout, skip, validator, baseline veya CP cache kontrolü değiştirilmez.
[Tam kabul kaydı](validation/acceptance.json), [test toplamları](validation/summary.json)
ve kayıpsız loglar `validation/` altındadır. Bu yerel test sonucu GitHub CI veya
performans kabulü yerine geçmez.

Gerçek Chromium: Main ve adayda 24'er geometri durumu (TR/EN × CP/Orders ×
compact/large × 0/3/9 freeze), 320 px freeze pane, 700 px yatay kaydırma;
frozen header/body farkı en çok 1 px, aday sticky top gerçek grup yüksekliğine tam
eşittir. Modal/nested native dialog aç/kapat, tek blur katmanı, reduced-motion'da
0 s geçiş, normal motion rail hover/çıkış ve sentetik original/zoom/clipboard
byte eşdeğerliği geçti; iki kolda renderer hatası yoktur. Yeni Motion+ motoru
yoktur; `motion-plus.js` baytları Main/#908 ile eşittir. Ek gerçek tarayıcı
[Motion+ kontrolü](check-motion.cjs), iki kolda sekizer durumda (CP/Orders ×
GPU/software × normal/reduced-motion) mevcut public API'yi çalıştırdı.
Normal GPU'da tablo başına tam altı benzersiz satır animasyonu; software veya
reduced-motion'da sıfır animasyon vardır. 1.100 ms gözlem bütün gecikmiş tekrarları
da kapsar; iki tablo/altı satır sınırı ve başlık/tablo üst kapsayıcılarının sabitliği
assert edilir. Tam satır JSON hash'leri kontrol öncesi/sonrası ve A/B arasında
eşittir; renderer hatası yoktur. [Motion+ sonucu](browser/motion.json).

Adaydan gerçek 1600×1000 kayıpsız PNG'ler gözle incelendi:
[Orders EN](browser/after-1-orders-en.png),
[CP TR](browser/after-1-cp-tr.png),
[Orders modal/blur](browser/after-1-orders-en-modal.png).
[İnceleme kaydı](browser/visual-review.json) boyut ve SHA'ları içerir. Diğer
önce/sonra TR/EN PNG'ler de korunur. Görseller korunmuş #908 davranışını gösterir;
yeni bir performans düzeltmesinin görsel kanıtı sayılmaz.

Standard tests passed all ten batches in one invocation with default concurrency4:
**8,935 PASS, 0 FAIL, 65 existing SKIP, 0 CANCEL**. Related tests:137 PASS; unchanged
CP guards:23 PASS. i18n:0/0; release notes:51 valid. Real-browser checks passed both
24-state matrices, sticky/freeze geometry, reduced-motion blur, nested dialogs,
normal-motion rail behavior and original image byte checks. Three current PNGs
were visually inspected. An additional real-browser check passed all sixteen
CP/Orders × GPU/software × normal/reduced-motion states across both arms: exactly
six unique row animations per table in normal GPU mode, zero in software/reduced
motion, static headers/ancestors and unchanged complete-row hashes. The first
attempt's full failure is retained: its baseline was taken before the first
visible PLM projection added two empty own-keys to all Orders rows. The fixture
now renders both modules before taking that baseline; full equality assertions
remain intact. No CI, performance acceptance or independent review is implied.

## EN — decision and interpretation

**#908 remains blocked for performance acceptance.** No cause for the historical
Orders regression was proven in the two assigned production files, so no product
patch or RED→GREEN claim was added. The contribution preserves the exact #908 app
tree. Specified Main is already an ancestor; #916/#917 and all protected code,
row-cache test, fast-check step, validators and baseline remain unchanged.

The clean native A/B–B/A–A/B follow-up produced CP **11,324→12,229 ms (+7.99%)**
and Orders **6,062→5,865 ms (−3.25%)**. CP pairs changed −1.90/+1.47/+20.48%;
Orders pairs −3.25/−4.10/−33.22%. Neither this nor the opposite single-profile
result erases the historical three-pair Orders regression. The first new series
also stays archived: approximately 1.4 seconds of archive analysis overlapped it,
so a separate clean repeat ran without competing analysis/tests/browser jobs.

The new profile keeps the native CP-then-fresh-Orders-context sequence. During
Orders intent-to-usable-paint, sampled inclusive header/blur attribution falls
from **126.626 to 25.955 ms**. Native callback and layout durations are nested,
not additional CPU. Both arms also perform CP preparation; about 1.9 seconds of
inclusive CP-assistant work falls in the separate paint-to-observation-end window.
This establishes overlap, **not causation** for the old regression. Snapshot events
after profile/native completion are never treated as measured latency.

All complete normalized CP/Orders JSON and own-key hashes match, including the
historical hashes. Every projection/disk generation, source revision, row count,
store revision and unobscured-row gate passes. Full visible cell keys/text and
header order match across current arms (CP61/Orders60); the old 53/60 schema
race is not declared fixed. Synthetic source bytes are identical; the new cache
generation, environment, observer and timing cohort are explicitly separate.
All runs, failures and original evidence remain available.

The next narrow ownership request is the common `app-main.js` load/render/warmup
chain at lines 2210, 9674 and 16831. Those files were only read. There is no basis
here to silently defer warmup, change checklist behavior or expand the render
system. Existing #908 bilingual release notes are preserved; no new visible fix
was made. Final integration/review stays in the main conversation. No PR creation,
original-branch push, merge, review or TEST/STABLE publication was performed.

## Yeniden çalıştırma / Reproduction

Create a detached Main worktree at `/workspace/pr908-main`, with existing app
dependencies available. Keep this contribution at its protected app tree. Extract
`docs/performance-program/fixtures/source-30000-seed7-20261105.tar.gz` into a new
`/tmp/buyerlog-startup-*/source`. Run the unchanged startup CLI with `--rows 30000`,
`--source-fixture`, `--skip-same-tab` and all four default modules, retaining its
complete measurement and fixture root. The exact successful Phase 0 command is
in the evidence manifest. Then:

```sh
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock python3 run-series.py /tmp/new-pr908-series /tmp/phase0-measurement.json
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock python3 run-series.py /tmp/new-pr908-profile /tmp/phase0-measurement.json --profile
python3 analyze.py /tmp/new-pr908-profile > /tmp/new-pr908-analysis.json
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock python3 validate.py /tmp/new-pr908-validation
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock node check-motion.cjs /tmp/phase0-measurement.json /tmp/new-pr908-motion
```

Use an environment permitting localhost/Chromium. Run from this directory, keep
all prior output roots, and do not run archive analysis alongside timing series.
`run-series.py` pins both original heads; later evidence-only commits require
verifying the unchanged app tree and adjusting only that documentary head pin.
No source/function/clock replacement or refresh retry is used.
