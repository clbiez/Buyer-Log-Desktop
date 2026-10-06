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
