# Performans değerlendirmesi / Performance review — 2026-10-06

TR: Buyer Log'un açılış, sipariş, analiz, tekrar ziyaret, görsel ve dışa aktarma yolları 33.000 siparişli sentetik veriyle incelendi. Görünür iş miktarı sınırlandı; değişmemiş analizler ve tekrarlanan kural/görsel hazırlığı yeniden kullanılıyor. Bütün masaüstü işlemlerinin belirli bir sürede tamamlanacağı iddia edilmiyor.

EN: Buyer Log's startup, order, analysis, revisit, image and export paths were reviewed with a synthetic 33,000-order dataset. Visible work is bounded; unchanged analyses and repeated rule/image preparation are reused. This does not establish a fixed completion time for every desktop operation.

## Ortam / Environment

Linux, Node 22.23.3, Chromium, 1440×1000 viewport. Demo Excel generator: 33,000 ASAS, 13,982 Antrepo and 59,379 LFL rows. All browser/API operations used an isolated loopback demo runtime. Enterprise credentials and company data were not used. Baseline: `2dae144` for the expanded changes; the earlier Price & Supplier engine comparison used `49abe1d`.

TR: CPU profilleri gerçek üretim motorlarını çalıştırdı. Bileşen benchmark'ları dönüşümlü önce/sonra dokuz örneğin medyanını ve tam çıktı eşitliğini denetler. Tarayıcı süreleri tek oturum gözlemidir; ağ, disk önbelleği ve makine yükünden etkilenir. Dört kat CPU yavaşlatma fiziksel ThinkPad ölçümü değildir.

EN: CPU profiles ran the actual production engines. Component benchmarks alternate old/new implementations for nine samples, report medians and verify complete output equality. Browser timings are single-session observations affected by network, disk caching and host load. Fourfold CPU throttling is not a measurement on a physical ThinkPad.

## Ölçülen darboğazlar ve uygulama / Measured bottlenecks and implementation

| Path | Evidence | Change |
| --- | --- | --- |
| Price & Supplier preparation, 20k records | 138.7 → 56.4 ms median; identical prepared data | Preparation-local, bounded label normalization cache |
| Price & Supplier, five active filters | 186.7 → 54.9 ms median; identical complete analysis | Prepare selected-value sets once per analysis |
| Orders priorities, 33k rows | 3,046.8 → 1,439.5 ms observed synchronous calculation | Bounded Turkish text cache; prepare condition normalization and rule indexes once per synchronous batch |
| Numeric order statistics | 33k distinct order codes previously displaced the shared label cache | Keep numeric identifiers on the direct path; preserve leading zeros |
| Model/colour image registry, 3k keys, 600 lookups | 224.1 → 17.3 ms median; identical resolution | Index named keys once on explicit registry publication; preserve ambiguity and deletion markers |
| CP / Orders / LFL table rendering | Visible ranges 50 / 100 / 200 / all; source data stays complete | Default 50, persisted size, page navigation and filter reset; retain existing scroll virtualization |
| Manufacturer revisits | Same result object and zero directory requests across three immediate returns | Cache by source version, directory revision and local day; background directory recheck after 30 seconds |
| Email directory | Unchanged poll used to broadcast and redraw; an in-flight response could interrupt a new draft | Display the current snapshot immediately; deduplicate reads; suppress unchanged redraws and preserve active drafts |
| Transit analysis | Repeated scope/window reads and summary rebuilding | Up to four successful snapshots / 40k records, five-minute TTL; bounded summaries, coalesced requests and late-response guards |
| Image scroll/page turnover | Removed, offscreen image elements could remain observed | Explicitly release old row observers; detached callbacks cannot load images |
| Native CP/Orders Excel | DOM export could include only the rendered window | Record-based lazy row generation, full filtered/checked scope, periodic yields; canonical images independent of visibility |
| Excel embedded images | One-cell anchors moved images but did not resize with cells | Fitted two-cell anchors plus OOXML aspect locks; reuse media for identical sources |

Reproduce the component benchmarks:

```bash
cd resources/app
node scripts/benchmark-price-supplier.js 49abe1d 20000
node scripts/benchmark-model-images.js 2dae144
```

## Davranış sözleşmesi / Behavior contract

TR: Aralık, kaynak veriyi kesmez. Filtreler, sıralama, miktar toplamları ve üst başlıktaki “tüm eşleşenleri seç” bütün filtrelenmiş veri üzerinde çalışır. Satır işaretleri sayfalar arasında korunur; hücre aralığı seçimi sayfa değişince temizlenir. Yerel hücre aralığı kopyası görünür hücreleri, kayıt kopyası ve Excel ise tüm filtrelenmiş/işaretli kayıtları kullanır. Bir sayfa değişikliği kural motorunu yeniden çalıştırmaz. Sütun tipleri yalnız ilk sayfadan çıkarılmaz.

EN: The range does not truncate source data. Filters, sorting, quantity totals and header “select all matching” use the complete filtered dataset. Checked rows survive page changes; cell-range selection clears when changing page. Grid-range copying uses visible cells; record copying and Excel use all matching/checked records. Changing page does not rerun the rule engine. Column types are not inferred from the first page alone.

TR: Hazır analizler aynı oturum içindir; kalıcı disk snapshot formatı değiştirilmedi. Yenile, kaynak/revision değişimi ve günlük eşikler eski sonuçları düşürür. Rehber düzenleme kilitleri açılışta sunucudan tekrar doğrulanır. Görsellerin ham kaynakları, doğal oranları ve önizleme davranışı korunur; yeni küçük görsel üretimi eklenmez.

EN: Analysis snapshots are session-local; the persistent disk snapshot format is unchanged. Refresh, source/revision changes and daily thresholds invalidate older results. Directory edit locks are rechecked with the server on open. Original image sources, natural proportions and preview behavior are preserved; no new thumbnail conversion is introduced.

## Kapsam ve sınırlar / Coverage and limits

TR: Gerçek tarayıcıda giriş, CP/Orders aralığı ve filtreleri, sayfa dışı seçimin native XLSX/pano aktarımı, Üreticiler ve rehbere dönüş, Yol Süreleri, LFL, Backlog, Koleksiyon, Nakliye, Fiyat & Üretici Analizi ve Genel Bakış kontrol edildi. Sürüm notu PNG'leri değişiklik sonrası gerçek Buyer Log demo ekranıdır. Kısa tekrar/geçiş kontrolü uzun süreli memory leak testi değildir.

EN: Actual browser checks cover login, CP/Orders range and filters, off-page selections in native XLSX/clipboard output, Manufacturer and directory revisits, Transit Times, LFL, Backlog, Collection, Shipping, Price & Supplier Analysis and Overview. Release-note PNGs are actual post-change Buyer Log demo screens. Short repetition/navigation checks are not long-running memory-leak tests.

TR: 33k veride başlangıç referans Yenile yaklaşık 52.8 saniyeydi: snapshot kaydı 4.6 s, sayfa cache üretimi/yazımı 16.4 s ve Backlog plan snapshot hazırlığı 9.0 s. Bu sunucu aşamalarında bağımsız hızlanma iddiası yoktur. Worker/projection katmanı, atomik generation geçişi, checksum, rollback ve kullanıcı yetki kapsamları korunur. Büyük native XLSX kitapları hâlâ kayıt/sütun/görsel sayısıyla orantılı bellek kullanır. Sonraki öncelik, gerçek Windows cihazında bu sunucu aşamalarını ve büyük kitap belleğini ölçmektir.

EN: The baseline 33k-data Refresh took about 52.8 seconds: snapshot save 4.6 s, page-cache generation/write 16.4 s and Backlog plan-snapshot preparation 9.0 s. No independent improvement is claimed for those server stages. Workers/projections, atomic generation switches, checksums, rollback and user authorization scopes are preserved. Large native XLSX workbooks still consume memory proportional to their records, columns and images. The next priority is measuring these server stages and large-workbook memory on real Windows devices.

TR: Windows Electron, Excel COM, Outlook, kurumsal IAS/PLM/Shared Hub/LCW AI ve gerçek ThinkPad donanımı bu Linux ortamında doğrulanmadı. XLSX ankrajı ve oran kilidi üretilen dosyanın XML'inde doğrulandı; HTML panosunda gömülü PNG ve doğal oran korundu. Excel/Outlook'un HTML yapıştırmayı nasıl ankrajladığı ve bağımsız satır/sütun boyut değişiklikleri gerçek Office'te ayrıca sınanmalıdır.

EN: Windows Electron, Excel COM, Outlook, enterprise IAS/PLM/Shared Hub/LCW AI and physical ThinkPads were not validated in this Linux environment. XLSX anchors and aspect locks were verified in generated-file XML; clipboard HTML retains embedded PNGs and natural proportions. Office's HTML-paste anchoring and independent row/column resizing still require testing in actual Excel/Outlook.

## Son doğrulama gözlemleri / Final verification observations

TR: Sabit Siparişler ekranında 80 sayfa geçişi sonrası GC belleği 259,6 → 266,6 MB (+%2,7), DOM elemanı 9.086 → 9.081 idi; hata yoktu. İç çizim toplamı yaklaşık 12 s / 80 geçiştir (ortalama 150 ms); bu, tüm kullanıcı etkileşiminin süresi değildir. Bütün modülleri açan ilk kontrol sırasında bellek 350 → 540 MB'a çıktı; geç gelen LFL/analiz yüklemeleri nedeniyle bu örnek sabit veri üzerinde leak ölçümü olarak kullanılmadı.

EN: With Orders stationary, 80 page changes left post-GC heap at 259.6 → 266.6 MB (+2.7%) and DOM count at 9,086 → 9,081, with no page errors. Inner rendering totaled about 12 s / 80 changes (150 ms average); this is not the whole interaction time. An initial check that opened every module grew from 350 → 540 MB while deferred LFL/analysis loads completed, so it was not used as a stationary leak measurement.

TR: Dört kat yavaşlatılmış CPU'da 33k Siparişler ilk açılışı 19,5 s idi; öncelik hesabı 7,2 s ve sütun şeması 2,2 s sürdü. Hata oluşmadı. Bu, düşük özellikli cihazlarda ilk veri açılışının hâlâ ağır olabileceğini gösterir; sayfalama CPU üzerinde bütün sipariş kararlarını hesaplama gereğini ortadan kaldırmaz. Gerçek ThinkPad/Windows ölçümü ve sunucu Yenile aşamaları sonraki iyileştirme hedefleridir.

EN: At fourfold CPU throttling, first opening 33k Orders took 19.5 s, including 7.2 s for priorities and 2.2 s for column schemas, without page errors. This shows that initial data opening can remain expensive on low-spec devices; pagination does not remove the need to calculate all order decisions. Actual ThinkPad/Windows measurements and server Refresh stages remain the next improvement targets.

TR: Son gerçek tarayıcı kabulünde 33.000 kayıt için 50/100/200/tümü kapsamları ve MARVEL filtresinin 3.704 eşleşmesi doğrulandı. Farklı sayfalardan işaretlenen iki kaydın native XLSX çıktısı iki görsel ankrajı, iki oran kilidi ve aynı kaynak için tek gömülü medya içeriyordu; HTML panosunda iki PNG vardı. Üreticiler'e üç dönüşte ek rehber isteği, Yol Süreleri'nin aynı kapsamına dönüşte ek analiz isteği oluşmadı. CP, LFL, Backlog, Koleksiyon, Nakliye ve Genel Bakış geçişleri tarayıcı hatası üretmedi.

EN: Final actual-browser acceptance verified 50/100/200/all scopes over 33,000 records and 3,704 matches for the MARVEL filter. Native XLSX output for two checked records on different pages contained two image anchors, two aspect locks and one embedded media item for their shared source; clipboard HTML contained two PNGs. Three Manufacturer returns made no additional directory reads; returning to the same Transit Times scope made no additional analysis request. CP, LFL, Backlog, Collection, Shipping and Overview navigation produced no page errors.

TR: Yerel Node 22 doğrulaması 840 test dosyasının bütün batch'lerini ve gerekli hedefli yeniden testleri kapsadı: 6.056 başarılı, platform/entegrasyon koşulları nedeniyle 64 atlanan test; çözülmemiş başarısızlık yok. LFL'nin ilgili 107 testi ayrıca geçti. TR/EN bekçisinde yeni eksik sıfır, sürüm kontrolü 7.0.247 ve görsel sürüm notu doğrulaması 17 kayıt için başarılıdır. Görünür aralık tercihi her kullanıcının kendi yerel alanında tutulur.

EN: Local Node 22 validation covered every batch across 840 test files plus necessary targeted reruns: 6,056 passed, 64 skipped for platform/integration conditions, with no unresolved failures. The relevant 107 LFL tests also passed. The TR/EN guard reports zero new omissions; version assertions pass for 7.0.247 and visual release-note validation passes for 17 entries. Each user's visible-range preference is stored in their own local scope.

## 7.0.248 · Orders priority ve değişmeyen sonuçlar / Orders priority and unchanged results

TR: Kullanıcının onayladığı kapsamla Orders priority hesabı, sütunu, hızlı filtresi ve kayıtlı eski priority filtre/sıralaması kaldırıldı. CP priority motoru ve kuralları korunur. Önceki signed stable 7.0.247 ZIP'indeki gerçek parse motoruyla aynı demo kaynakları karşılaştırıldı: 27.464 CP kaydının bütün alanları ve 33.000 Orders kaydının priority dışındaki bütün alanları birebir eşleşti. Artımlı tarih/taşıma düzenlemeleri de Orders'a priority geri eklemez.

EN: As explicitly approved, Orders no longer calculates priority or displays its column/quick filter; legacy saved priority filters and sorting are removed. CP priority rules remain available. Actual parse engines from the previous signed stable 7.0.247 ZIP and this source were compared on identical demo sources: every field in 27,464 CP records and every non-priority field in 33,000 Orders records matched exactly. Incremental date/delivery edits cannot reintroduce Orders priority.

TR: Sütun tipleri tam kaynak üzerinden ilk kez çözülür; filtrelenmiş ilk 50 satır tip kanıtını belirlemez. WeakMap cache kaynak dizi kimliği, ilgili veri revizyonu ve sütun/metadata tanımını denetler. Oturum içi filtre, sıralama, sayfa ve export işlemleri bu sonucu tekrar kullanır. Bu kalıcı disk şeması değildir; yeni uygulama oturumu ilk çözümlemeyi yine yapar. Son satırdaki başında sıfır olan kod, 30 tekrar çözümlemede yeniden satır taraması olmaması ve değişen custom metadata/fonksiyonlar canlı testlerle doğrulandı.

EN: Column types are initially resolved from the complete source; the first 50 filtered records do not determine type evidence. A WeakMap cache checks source-array identity, relevant revision and column/metadata definitions. Session-local filtering, sorting, paging and exports reuse the result. This is not a persistent disk schema; a new app session still performs initial inference. Live tests cover leading-zero codes at the last source row, 30 repeated resolutions without row reads and changes to custom metadata/functions.

TR: Sayfa projection anahtarları veri içeriği, hedefe özel ASAS/Antrepo, uygulanan ufuk, etkili kurallar, kullanıcı yetki/kapsamı, yerel gün ve uygulama sürümünden üretilir. Kaynak aynıysa mevcut gzip bytes checksum ile doğrulanır ve generation korunur; yalnız yeni kaynak zamanı/metadatası atomik yayınlanır. Kısmi değişimde etkilenmeyen modül bytes'ları yeni atomik generation'a taşınır. Eksik/bozuk bytes, yetki veya hedef değişimi gerçek kaynak motorlarına geri döner. Excel işlem telemetrisi yayınlandıktan sonra süreler eklenebildiği için kaynak kimliğinden çıkarıldı; bu metadata artık aynı refresh'in cache'ini tekrar bozamaz.

EN: Projection input keys include content, target-specific ASAS/warehouse data, applied horizons, effective rules, user authorization/scope, local day and app version. Identical inputs verify existing gzip checksums and retain the generation while atomically publishing updated source metadata. Partial changes copy unaffected compressed modules into a new atomic generation. Missing/corrupt bytes, authorization or target changes use the actual source builders. Excel operation telemetry can acquire timings after publication, so it no longer participates in source identity or invalidates the same refresh's cache.

TR: Backlog plan arşivi girdi anahtarını saklar; değişmeyen kayıtlarda satır hazırlığı/diff yapılmadan boş fark ve yeni zaman işareti yazılır. Eski arşivler ilk seferde normal şekilde güncellenir. Yalnız Backlog hedef verisi değiştiğinde rapor varyantları düşürülür; farklı girdi anahtarına sahip backup eski rapor döndüremez. LRU touch yazıları kullanıcı mutasyon kuyruğunda güncel generation/girdi kontrolüyle yapılır. Gerçek sunucu orchestration/capture fonksiyonları ve gerçek disk cache/arşiviyle regresyon testleri bu zinciri doğrular.

EN: The Backlog plan archive retains its input key. Unchanged records append an empty delta and a new time marker without preparing rows or calculating a diff; older archives take the normal path on first use. Backlog-only target changes invalidate report variants, and a backup with a different input key cannot return an older report. LRU touches use the user mutation queue with current-generation/input checks. Regression tests exercise actual server orchestration/capture functions and actual disk cache/archive storage.

TR: Gerçek demo Refresh kontrolünde ilk cache hazırlığı 55,9 s, hemen sonraki değişmeyen Refresh 29,7 s sürdü. Son istekte CP, Overview, Orders, Order Summary ve Collection Catalog tekrar kullanıldı ve aynı generation kaldı. Sayfa-cache aşaması 630 ms, Backlog snapshot aşaması 1.407 ms idi; arşivde yeni zaman işaretleri ve boş farklar doğrulandı. Önceki fazın referansındaki sayfa-cache 16,4 s ve Backlog hazırlığı 9,0 s gözlemleri tarihsel karşılaştırmadır; çoklu örnek medyanı veya fiziksel ThinkPad ölçümü değildir.

EN: Actual demo Refresh took 55.9 s for initial cache preparation and 29.7 s for the immediately following unchanged refresh. The latter reused CP, Overview, Orders, Order Summary and Collection Catalog and retained the generation. Page-cache work took 630 ms and Backlog snapshot work 1,407 ms; archive markers and empty deltas were verified. The prior phase's 16.4 s page-cache and 9.0 s Backlog preparation observations are historical comparisons, not multi-sample medians or physical ThinkPad measurements.

TR: Kaynak sorgusu/Excel okuması, refresh karşılaştırması, ana model snapshot'ının tam gzip kaydı ve büyük cevap serileştirmesi devam eder. Gerçekten değişen veri cache motorlarından geçer. CP priority ve Genel Bakış başlangıcındaki iş ayrıca maliyetlidir; bütün uygulamanın soğuk açılışının hızlandığı iddia edilmez. Windows/Office/kurumsal servis ve fiziksel ThinkPad sınırlamaları önceki bölümde geçerlidir.

EN: Source queries/Excel reading, refresh comparison, full model-snapshot gzip saving and large-response serialization remain. Changed inputs still run the builders. CP priority and Overview startup work also remain expensive; no claim is made that the whole app's cold startup became faster. Earlier limitations for Windows/Office, enterprise services and physical ThinkPads still apply.

### Tarayıcı karşılaştırması / Browser comparison

| 33k Orders, actual browser | Stable 7.0.247 | Candidate 7.0.248 |
| --- | ---: | ---: |
| First Orders opening, normal CPU | 22,069 ms | 2,577 ms |
| First Orders opening, CPU ×4 | 18,664 ms | 12,856 ms |
| MARVEL search interaction, CPU ×4 | 2,304 ms | 601 ms |
| MARVEL matching records | 3,704 | 3,704 |
| Schema resolution over four renders, normal CPU | 762.8 ms | 279.8 ms |
| Browser page errors, each of four runs | 0 | 0 |

TR: Aynı demo fixture ve ayrı runtime kökleriyle sırayla normal CPU ve dört kat CPU yavaşlatmalı Chromium oturumları açıldı. Her sayı tek oturum gözlemidir; medyan değildir. Normal CPU referansında ilk Orders isteği backend cache yeniden hazırlığı içerdi; dört kat CPU referansında aynı modül önceki normal kontrolden hazırdı. Bu yüzden normal/dört kat sayılarını birbirine oranlamak veya priority kaldırmaya tek başına bu kazancı atfetmek doğru değildir. Priority çağrısı yeni Orders ölçümlerinde sıfırdı. Dört kat CPU'da Orders açılışındaki gözlenen kazanç yaklaşık %31, MARVEL arama etkileşiminde %74'tür. Genel uygulama giriş süresi normal CPU'da 65,3 → 68,8 s, dört kat CPU'da 103,0 → 103,2 s idi; bu faz bütün uygulama girişini hızlandırmış sayılmaz.

EN: Chromium sessions ran sequentially with the same demo fixture and separate runtime roots, first at normal CPU and then fourfold throttling. Each number is one session observation, not a median. Normal-CPU baseline Orders included backend cache rebuilding; its fourfold run already had that module prepared by the preceding normal check. Ratios between normal/fourfold numbers or attributing the whole improvement to priority removal alone would therefore be misleading. New Orders runs made zero priority calls. Observed fourfold-CPU improvement was about 31% for opening Orders and 74% for the MARVEL search interaction. Whole-app entry took 65.3 → 68.8 s at normal CPU and 103.0 → 103.2 s under fourfold throttling; this phase did not improve whole-app entry.

TR: Son gerçek UI kabulünde priority bulunmayan Orders, korunan CP priority, 50/100/200/tümü, 3.704 MARVEL eşleşmesi, sayfa sıfırlaması, farklı sayfalardan işaretlenen kayıtların native XLSX/HTML aktarımı ve Backlog snapshot dönem analizi doğrulandı. İki XLSX görseli iki hücre ankrajı/oran kilidi ve aynı kaynaktan tek medya taşıdı; HTML panosunda iki gömülü PNG vardı. Yüzde filtre paneli tam kaynaktan 625 eşleşmeyle gerçek UI üzerinde doğrulandı. Dört ayrı TR/EN sürüm notu ve değişiklik sonrası gerçek 1440×1000 PNG eklendi.

EN: Final actual UI acceptance covered Orders without priority, retained CP priority, 50/100/200/all ranges, 3,704 MARVEL matches, page reset, native XLSX/HTML exports of checked records on different pages and Backlog snapshot period analysis. Two XLSX images retained two cell anchors/aspect locks with one shared media item; clipboard HTML contained two embedded PNGs. The percentage filter panel was verified in the actual UI with 625 matches across the source. Four separate TR/EN release notes include actual post-change 1440×1000 PNGs.

TR: Node 22 tam paketinin sekiz batch'i 846 test dosyası üzerinden tamamlandı: 6.072 başarılı, 64 platform/entegrasyon nedeniyle atlanan test. Beş eski beklenti yeni Orders/priority ve cache yolu sözleşmesine uyarlandı, ilgili dosyalar tekrar geçti; çözülmemiş başarısızlık yok. Tam paket yeniden koşturulmadı; kesilen runner'dan yalnız henüz çalışmamış batch'ler devam ettirildi. TR/EN bekçisinde eksik sıfır, sürüm 7.0.248 ve dört görsel not doğrulaması başarılıdır.

EN: All eight Node 22 suite batches completed across 846 test files: 6,072 passed and 64 skipped for platform/integration conditions. Five legacy expectations were updated for the new Orders/priority and cache contracts; their targeted files passed, leaving no unresolved failures. The full suite was not rerun; only unexecuted batches resumed after a failure. The TR/EN guard reports zero omissions; version assertions pass for 7.0.248 and four visual release notes validate.

## 7.0.249 · Hazır açılış, CP arka planı ve ana snapshot / Prepared startup, background CP and main snapshots

TR: Kullanıcının seçtiği 1, 2 ve 4 uygulandı. İlk ekranın projection isteği ve ilk frame'i tamamlanmadan ikincil modüller/CP dependency başlatılmaz. Dünya saati tatil sorguları ilk ekran hazır olayını bekler ve aynı anda en fazla iki tatil isteği kullanır. Önceki açılışta altı uzun HTTP isteği yerel başlangıç isteğini 27–55 saniye bekletiyordu. Son okunma metni tarih+saat içerir; genel `section{display:none}` kuralının gizlediği mevcut son yenileme kartı artık görünürdür.

EN: Implements the selected items 1, 2 and 4. Secondary modules and the CP dependency wait for the primary projection and first frame. World-clock holiday requests start after the primary-ready event and use at most two concurrent holiday requests. Previously six slow HTTP requests delayed the local bootstrap by 27–55 seconds. Last-loaded text includes date and time; the existing refresh-result card is now visible despite the global `section{display:none}` rule.

TR: CP'nin kanonik tek-sipariş motoru korunur. Oturum içi WeakMap, kullanıcı/veri/kural/hedef/gün bağlamına göre kararları paylaşır; Genel Bakış filtreleri aynı satırın kararını yeniden hesaplamaz. Büyük hesaplar 8 ms bütçeli parçalarda tarayıcıya kontrol bırakır. Eski bağlam veya eski view generation sonucu commit edilmez. Tablo yüklenirken hazırlık durumu gösterilir; copy/export/filter eşzamanlı doğruluk yolunu korur. Yeni async ve eski signed stable 7.0.248 motorları aynı 27.464 CP kaydında tüm enumerable karar alanları ve priority sayımları için birebir eşleşti.

EN: Preserves the canonical per-order engine. Session WeakMaps share decisions within user/data/rule/target/day context; Overview subsets reuse those row decisions. Large passes yield to the browser with an 8 ms budget. Stale contexts/view generations cannot commit. Tables show preparation state until ready, while copy/export/filter retain their synchronous correctness path. New async and signed stable 7.0.248 engines matched all enumerable decision fields and priority counts across the same 27,464 CP records.

TR: Ana ham veri içeriği (ASAS, tüm hedef yönlendirmeleri, IAS ve LFL) SHA-256 ile karşılaştırılır. Aynıysa doğrulanmış gzip primary tekrar okunup hash'i kontrol edilir; büyük dosya yeniden sıkıştırılmaz, parse/doğrulama ve yazım tekrarlanmaz. Yeni metadata, primary payload checksum'ına bağlı checksum'lı atomik `.meta.json` kaydıdır. Cold load ve sync/async okuyucular yalnız doğru base'e bağlı metadata'yı uygular; bozuk metadata/base için mevcut `.bak` güvenli dönüşü korunur. Cache, ham satırları veya metadata nesnelerini bellekte tutmaz. Ayrıntılı refresh karşılaştırması yalnız iki tarafın ham sipariş/IAS içeriği tamamen aynıysa atlanır; herhangi bir alan farkı eski tam algoritmaya döner.

EN: SHA-256 compares raw ASAS, target routing, warehouse and LFL content. On equality the verified compressed primary is reread and hashed; large compression, parse/validation and writes are skipped. New metadata uses an atomic checksummed `.meta.json` record bound to the primary payload checksum. Cold, synchronous and asynchronous readers only apply matching-base metadata; existing `.bak` recovery remains available for corrupt metadata/base files. The cache retains no raw rows or metadata objects. Detailed refresh comparison is skipped only for exact raw order/warehouse equality; any field change falls back to the complete algorithm.

| Actual Chromium / demo, one session per observation | Stable 7.0.248 | Candidate 7.0.249 |
| --- | ---: | ---: |
| UI_READY, normal CPU | 54,016 ms | 1,591 ms |
| UI_READY, CPU ×4 | 61,332 ms | 15,408 ms |
| Continue interaction completed, normal CPU | 60,387 ms | 6,090 ms |
| Continue interaction completed, CPU ×4 | 153,727 ms | 44,923 ms |
| Browser page errors | 0 | 0 |

TR: Bunlar medyan/ThinkPad ölçümü değildir. Normal referans ve aday aynı demo runtime kökünü sırayla kullandı; dört kat referans signed 7.0.248 uygulaması ve ayrı kopyalanmış runtime kökünü kullandı. Dört kat çalışmada diğer kabul işleri de sunucuyu kullandı; sayılar izole cihaz benchmark'ı olarak yorumlanmaz. İlk kullanılır frame (`UI_READY`) ile sonradan tamamlanan/yenilik penceresinden etkilenen Continue etkileşimi ayrıdır. CPU ×4 arka plan aşamalarında en uzun task 37,2 → 11,9 s oldu; büyük toplulaştırma/diğer yardımcı işler hâlâ tümüyle etkileşimsiz değildir. Bu faz bütün soğuk/şirket ağı beklemelerini kaldırdığı iddiasını taşımaz.

EN: These are single observations, not medians or physical ThinkPad measurements. Normal baseline/candidate used the same demo runtime sequentially; fourfold baseline used the signed 7.0.248 app and a separately copied runtime. Other acceptance work also used the server during fourfold runs, so they are not isolated device benchmarks. First usable frame (`UI_READY`) differs from the later Continue interaction, which can be affected by the release-notes overlay. The longest fourfold background task fell from 37.2 to 11.9 s; large aggregations/other auxiliary work still have responsiveness limits. This phase does not claim to remove all cold-start or enterprise-network waits.

TR: Yenileme telemetry'sinde aynı-veri karşılaştırması 5,2 → 1,1 s, ana kayıt 4,6–5,2 → 1,8 s ve page-cache 0,6 s oldu. 7.249'un ilk yeni generation hazırlığı 59,9 s, eş zamanlı tarayıcı kabulüyle izlenen sonraki refresh 35,6 s sürdü; önceki 29,7 s toplam refresh'e göre daha hızlı olduğu iddia edilmez. Excel okuma, büyük response açma/serialization ve ilk değişen generation oluşturma maliyetleri sürer.

EN: Telemetry observed unchanged-data comparison at 5.2 → 1.1 s, main snapshot save at 4.6–5.2 → 1.8 s and page-cache at 0.6 s. Initial 7.249 generation preparation took 59.9 s; the subsequent refresh, overlapping browser acceptance, took 35.6 s. No faster total-refresh claim is made against the prior 29.7 s observation. Excel reads, large response parsing/serialization and initial changed-generation creation remain.

TR: Gerçek UI kabulü: 33.000 Orders için 50/100/200/tümü, MARVEL=3.704, sayfa sıfırlaması, CP priority, Backlog snapshot ve iki farklı sayfadan seçilen kaydın XLSX/HTML aktarımı geçti. İki hücreyle taşınan/boyutlanan ankraj, iki oran kilidi, tek ortak PNG medya ve panoda iki PNG doğrulandı; tarayıcı hatası sıfır. Node 22 sekiz batch/851 dosya ve etkilenen test düzeltmelerinin hedefli tekrarlarıyla 6.084 başarılı, 64 platform/entegrasyon nedeniyle atlanan test tamamlandı. Tam paket tekrar edilmedi; yalnız çalışmamış batch'ler devam ettirildi. TR/EN, version assertion ve üç gerçek PNG sürüm notu doğrulanır.

EN: Actual UI acceptance passed 50/100/200/all over 33,000 Orders, MARVEL=3,704, page reset, CP priority, Backlog snapshots and XLSX/HTML exports of records selected on different pages. Two move/resize-with-cell anchors, two aspect locks, one shared PNG media entry and two clipboard PNGs were verified with zero browser errors. Node 22 covered all eight batches/851 files and targeted reruns after fixture/contract adjustments: 6,084 passed, 64 platform/integration skips. The entire suite was not repeated; only unexecuted batches resumed. TR/EN, version assertions and three actual PNG release notes validate.
