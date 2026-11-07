# #914 — post-#912/#901 acceptance / güncel Main kapanışı

## TR

Kullanıcı #912 → #901 → #914 sırasını, her PR son Main üzerinde gerekli
kontrolleri geçerse merge etmek üzere onayladı. Bu kayıt #914'ün güncel
entegrasyon kanıtıdır. Önceki 955,5→841,9 ms DCL ve +%3,5 uzun-görev sayıları
`d61d9434` kaynaklarının tarihsel serisidir; aşağıdaki yeni sonuçların yerine
kullanılmaz.

- Baz: Main **31004ea08982ffcce849640e5c5e3580448f0914**, #912 ve #901 dahil.
- Aday: normal Main merge **e1d342939a8aee49b237e5e1ef9e725b66f83021**.
- Test edilen uygulama tree'si: **cd7c3afb986d9200060d0e3271a1e29e0cf2bb42**.
- Tek çatışma next.json: Main'in 41 ve önceki #914'ün 39 kayıt nesnesi
  korunarak **42** benzersiz kayıt. İki tarafın CI adımları birlikte korundu.
- `index.html`, `perf-runtime.js`, startup entrypoints ve app.css,
  incelenmiş `1c8ebe4c` ile byte düzeyinde aynı. Main'in #892/#912 sözleşmesi,
  fiyatlama değişiklikleri ve önceki PNG/ölçüm kanıtları korunur.
- Rebase/force-push, benchmark veya scripts/lib değişikliği yok.

### Son gerçek doğrulama

14 ilgili dosyada **171 PASS / 0 FAIL-SKIP-CANCEL**. Değişmemiş standart
`npm test`, varsayılan concurrency=4, **tek çağrıdaki bütün 10 batch**:
**1.294 dosya / 8.879 PASS / 0 FAIL / 65 mevcut SKIP / 0 CANCEL**, 229,7 sn.
Ardından i18n **0 yeni / 0 baseline**, release-note validator **42 PASS**.
Her komut ayrı özel TMPDIR kullandı; NODE_OPTIONS veya global data-root
override yok. [Komut/kaynak/batch ve kayıpsız log manifesti](startup-feature-assets-20261107/post-901/test-manifest.json).

Tek bağımsız ikinci model incelemesindeki Manufacturers drawer CSS P2'si,
`1c8ebe4c` üzerinde aynı turdaki dar kontrolde kapandı. Backlog'a önceden
uğramadan ilk drawer stili hazırdır; ortak promise/anchor tekilleştirmesi ve
geciktirilmiş CSS testleri korunur. Yeni genel inceleme turu iddia edilmez.

### Yeni 30k kampanyası

A/B–B/A–A/B: üç bağımsız çift, altı taze source/data/cache/server/browser kökü.
Aynı seed7 arşivi ve üç XLSX SHA'sı doğrulandı. Özgün Faz 0 benchmark'ı tüm
modülleri ve aynı-sekme akışını değiştirilmeden çalıştırdı; ardından aynı eski
module-probe gerçek 14 işlev kontrolünü ve 16 ilk-açılış ölçümünü yaptı.
Başka ağır test veya benchmark çalıştırılmadı. Her koşuda tek refresh POST;
tekrar yok. Tarihsel veya başarısız kanıtların üzerine yazılmadı.

**Altı benchmark + altı module-probe PASS**, tarayıcı hatası 0. 30 navigasyonda
Resource Timing buffer=20.000 ve taşma 0. CP=24.982, Orders=30.000,
Overview=30.000; her koşunun generation/revision/checksum kontrolleri geçti.
Üç çiftin tamamında üç modülün **sıralı tam row JSON SHA-256'ları birebir eşit**.
Ham fixture kökleri korundu; JSON/logların kayıpsız arşivleri ve hash'leri
[measurement-manifest.json](startup-feature-assets-20261107/post-901/measurement-manifest.json) içindedir.

Ortam: Linux, Node v24.19.0, Chromium 154.0.8037.57, Xeon Platinum 8573C;
cgroup CPU kotası **4 CPU**, bellek sınırı **16 GiB**. Windows/Electron,
antivirüs ve soğuk OS disk cache ölçülmedi.

| Median | Before | After |
| --- | ---: | ---: |
| DOMContentLoaded (ms) | 2120.9 | 1766.7 |
| Primary screen ready (ms) | 3657.9 | 3177.8 |
| Gate ready (ms) | 3679.7 | 3196.0 |
| System startup complete (user wait excluded) (ms) | 3792.8 | 3277.5 |
| Primary → gate (ms) | 21.8 | 18.2 |
| First 10 s long-task total (ms) | 5572.0 | 6053.9 |
| Prepared same-tab CP (ms) | 9986.6 | 9408.3 |
| Prepared same-tab Orders (ms) | 2668.0 | 2113.1 |
| Prepared same-tab Collection (ms) | 234.1 | 176.6 |
| Refresh wall time (ms) | 53516.2 | 51587.6 |
| Refresh health roundtrip p95 (ms) | 445.7 | 877.9 |

Statik senkron JS **127 / 6.254.802 → 112 / 5.643.453 yerel bayt**;
blocking CSS **45 / 1.887.478 → 27 / 1.642.046 bayt**. Dinamik user-context.js
sayılır fakat statik dosya boyutuna eklenmez. İlk 10 sn JS **183 / 8.644.542 →
172 / 8.259.638 decoded bayt**; CSS **45 / 1.887.478 → 28 / 1.642.835 bayt**.
İstek ve benzersiz dosya sayıları ayrı tutulur.

**Ödünleşim:** uzun-görev toplamı medyanı +%8,65; eşli farklar
+%2,21 / -%3,54 / +%8,82. Bu metrikte iyileşme veya her koşuda kötüleşme
iddiası yok. İlk kullanımda yüklenen varlıklar ek bekleme getirir: Manufacturers
487,1→627,6 ms, taze Collection 611,5→793,8 ms. Seçilen tembel yükleme kapsamının
bu ilk-kullanım maliyeti açık tutulur; genel uygulama/analiz hızlanması sayılmaz.

Refresh ve health sayıları ayrıca raporlanır. Refresh eşli farkları karışık;
UI değişikliğine backend hızlanması atfedilmez. Health p95 445,7→877,9 ms
**harness HTTP roundtrip** medyanıdır: harness scheduling/JSON işi de ölçüme
girebilir. Bu kampanya bağımsız sunucu event-loop sınaması değildir. Runtime
stall log eşiği 3.000 ms, örnekleme aralığı 5.000 ms; sıfır log **200 ms üstü
stall yok** anlamına gelmez. Eski Faz 5 kabul açığı bu sonuçla kapatılmaz.
Heap ölçümü GC uygulanmamış anlık değerdir; retained heap veya peak değildir.

### Modül ilk açılışı (ms; üç koşu medyanı)

Sıralama ve script/CSS durumu iki kolda aynıdır. `koleksiyon` Pricing Desk'ten
sonra ortak grubu kullanır; gerçek yeni HTTP context `koleksiyonFresh`tir.
`overview` satırı exception inbox panelidir. Collection başlangıçta boştur;
spreadsheet işlev kontrolü tek sentetik satır ekler.

| Module | Before | After |
| --- | ---: | ---: |
| automations | 282.0 | 206.2 |
| backlog | 5839.8 | 4493.3 |
| backlogPlanActual | 67.2 | 89.1 |
| backlogPresentation | 18067.9 | 17098.7 |
| excelImport | 2819.8 | 2759.0 |
| guideFresh | 439.4 | 325.8 |
| koleksiyon | 360.9 | 478.4 |
| koleksiyonFresh | 611.5 | 793.8 |
| lfl | 7274.4 | 7336.9 |
| licensecards | 7309.0 | 7108.3 |
| manufacturers | 487.1 | 627.6 |
| opencosting | 223.6 | 263.2 |
| overview | 4848.6 | 4494.5 |
| quotations | 213.9 | 267.5 |
| source | 313.5 | 359.5 |
| userManagement | 314.3 | 410.2 |

### Karar ve sınır

Senkron/ilk-10-sn varlık azalması ve DCL/birincil ekran medyanı iyileşmesi
**[Doğrulandı]**; her koşul/Windows için garanti değildir. Uzun-görev ve ilk
kullanım maliyetleri saklanmaz. 6b'nin app-main load/mount/activate/deactivate/
dispose, native-tab ve SSE/polling işleri bu PR ile tamamlanmış değildir.

Bu belge yazılırken final-head CI bekliyor; önceki SHA'nın yeşili taşınmaz.
Kullanıcının koşullu merge onayı ancak son head CI yeşilken uygulanacak.
**TEST yayımlanmadı; STABLE yayımlanmadı.**

## EN

This record supersedes the older startup timings for current integration;
previous evidence remains tied to its original SHAs. Main31004ea0 (including
#912/#901) was normally merged into the reviewed shell change at e1d34293.
All 42 note objects, both CI scopes and previous images/evidence are retained.
The four shell production files remain byte-identical to reviewed1c8ebe4c.

Related tests:171 PASS. The unchanged standard full runner completed all ten
batches in one invocation:1,294 files,8,879 PASS,0FAIL,65 existingSKIP,0CANCEL.
Then i18n0/0 and42 note entries passed. No assertion/validator/runner relaxation.

Three fresh alternating pairs use the same30k seed7 fixture and unmodified
Phase0 harness, followed by real module controls. All six runs and module probes
passed;30 resource observations had no buffer overflow. Row counts, generation,
revision and checksum validation passed. Ordered complete CP/Orders/Overview
row output hashes match in every pair. Commands, raw-root locations, compressed
logs, source and fixture hashes are preserved alongside the numeric tables.

Current medians: DCL2120.9→1766.7ms; primary3657.9→3177.8ms. Long-task total
5572.0→6053.9ms(+8.65%) has mixed paired changes, not a long-task improvement.
Lazy first use costs more in several modules, including Manufacturers+140.5ms
and fresh Collection+182.3ms. Tables show every measured module; these are not
general application or input-latency speedups. Refresh differences are mixed,
and health values include client/harness scheduling; no200ms server-stall bound
or retained-heap improvement is established.

Linux/headless Chromium,4CPU cgroup quota,16GiB; no Windows/Electron claim.
The earlier P2 was narrowly verified closed within the one review round.
Remaining6b lifecycle/native-tab/SSE work is separate. Final-head actual CI is
still required before the already conditionally authorized merge.
**No TEST or STABLE publication.**
