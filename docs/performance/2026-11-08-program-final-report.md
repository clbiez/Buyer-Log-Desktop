# Buyer Log — performans programı kapanışı / performance program closure

**Tarih / Date: 2026-11-08.** Kullanıcı kapsamı dondurarak programın kapatılmasını istedi.
Bu kapanış, başlangıçtaki bütün mimari hedeflerin uygulandığı anlamına gelmez.
**EN:** User-authorized scope freeze and closure; unfinished architecture is explicitly deferred.
TEST ve STABLE yayımlanmadı / Neither TEST nor STABLE was published.

## Kanıtın sınırı / Evidence boundary

[Doğrulandı / Verified] Aşağıdaki süreler mevcut raporlardaki medyanlardır;
kapanışta yeni benchmark, tanı veya performans ölçümü yapılmadı.
Farklı fazların SHA, ortam ve senaryoları değişir; rakamlar toplanarak genel hızlanma çıkarılamaz.
**EN:** Historical medians retain their original revisions and workloads; no new performance campaign or cumulative speedup claim.
Ana iş yükü Linux, 4 vCPU, 16 GiB, headless Chromium ve 30k sentetik sipariştir.
**Windows/Electron ürün performansı ve native sekme kabulü ölçülmedi.**
6d'nin ayrı Linux/Electron 39 DB prototipi, Windows/Electron UI kabulü değildir.
**EN:** No Windows/Electron product-performance or native-tab acceptance; the isolated Linux/Electron 39 database prototype is separate.

## Faz 0–7 / Phases 0–7

| Faz / Phase | Durum / Status | PR | Önce → sonra medyan / Before → after median |
| --- | --- | --- | --- |
| 0 Ölçüm / Instrumentation | Main'de / Merged | #872 | 3 koşu refresh bazı / three-run refresh baseline: 53,231 s; hızlanma iddiası yok / no speedup claim. |
| 1 Audit | Main'de / Merged | #873 | Gerçek demo LOGIN satırı / actual demo LOGIN line: 2.485.108 → 360 B; ayrı mikro çağrı / separate micro-call: 186,557 → 0,995 ms. |
| 2 Dense kaynak okuma / Source reads | Main'de / Merged | #874 | ASAS read+parse worker task: 15,603 → 8,383 s; refresh: 48,088 → 40,679 s; çıktı SHA'ları eşit / equal output SHAs. |
| 3 Perde / Startup curtain | Main'de; ödünleşim korundu / Merged with tradeoff | #879 | Overview gate: 40,472 → 4,683 s; özgün ilk CP niyeti / original first CP intent: 4,769 → 76,695 s. |
| 4 İstemci hesapları / Client computation | Main'de / Merged | #881 | Katalog pipeline / catalog: 5525,734 → 1961,454 ms; sort: 5562,102 → 358,282 ms; alan okuma / field reads: 1571,498 → 17,979 ms. |
| 5 Ortak worker havuzu / Shared pool | Main'de; performans kabul açığı var / Merged with acceptance gap | #885, #902 | Refresh: 52,760 → 64,684 s (+%22,60); aynı sekme CP / same-tab CP: 14,335 → 10,251 s; Orders: 3,768 → 2,904 s. |
| 6a İnce projeksiyon / Thin projection | Üretimde etkin değil; ertelendi / Not activated, deferred | #891 kapatıldı / closed | Envanter ve yerel aday var; geçerli entegre üretim önce/sonrası yok / inventory and local candidate only; no accepted production A/B. |
| 6b Kabuk / Shell | Kısmi / Partial | #914 | Son seri / final cohort: DCL 2120,9 → 1766,7 ms; primary 3657,9 → 3177,8 ms; ilk 10 s JS 183 → 172, CSS 45 → 28 istek / requests. |
| 6c Delta kalıcılık / Delta persistence | Hazırlıklar var; üretime bağlanmadı / Prepared, not integrated | Katkı dalları / contribution branches | Modül/prototip sayıları üretim kazancı değildir / module and prototype figures are not production gains. |
| 6d SQLite | Prototip raporu; karar **bekle** / Prototype report; decision **wait** | #900 kapatıldı / closed | 200k prototype: açılış / open 2543 → 3,6 ms; compaction 20,98 → 1,39 s; tüm kayıt okuma / full materialization 24,7 → 1188,1 ms. |
| 7 İstemci / Client | Seçili maddeler Main'de / Selected items merged | #901, #904, #906 | CPR-05 61.348 → 134 ms; CPR-06 edit 548 → 284 ms; CPR-07 search 4472 → 356 ms; CPR-12 15,22 → 1,48 ms; ANA-07 180 → 17 ms; ANA-11 249 → 52 ms. |
| 7 DS-08 | Main'de / Merged (37cc293d) | #909 | Sentetik sıcak-havuz checkpoint / synthetic warm-pool checkpoint: gap 319,655 → 47,562 ms; toplam / total 374,920 → 404,012 ms; RSS 273,508 → 289,195 MiB. |
| 7 INT-04/05 | Main'de / Merged (f127b83f) | #910 | Linux yerel / local: 300 image planning 21,809 → 3,548 ms; 200 image pack publish 2851,865 → 257,209 ms. |
| 7 INT-11 | Main'de / Merged (6db40d29) | #911 | Beş küçük rapor / five small reports: 681,646 → 273,170 ms; throughput veya kurumsal p95 iddiası yok / no throughput or enterprise p95 claim. |

Tablo PR numaraları `https://github.com/clbiez/Buyer-Log-Desktop/pull/<numara>` adresindedir.
**EN:** Each PR number identifies the corresponding GitHub pull request; merged and deferred work remain distinct.

## Kabul edilen ödünleşimler / Accepted closure tradeoffs

- **Faz 3:** Daha erken Overview perdesi, CP'nin ilk tıklamasındaki beklemeyi artırdı;
  ilk karşılaştırma 4,769 → 76,695 s idi; #905'in farklı, daha sonraki kohortunda
  1,681 → 12,860 s, sayfa → CP toplamında 75,646 → 14,391 s ölçüldü.
  #916'nın kendi kohortunda ilk CP 17,1 → 13,2 s oldu; bu farklı seriler birbirinin yerine geçmez.
  **EN:** Earlier curtain release trades against first CP intent; subsequent cohorts improve it without proving the original wait eliminated.
- **Faz 5:** Kullanıcının kapanış kararıyla yaklaşık **+%22 refresh** artışı
  (kayıtlı son kohort +%22,60) ve **sağlanmayan 200 ms eşiği** açıkça kabul kaydıdır;
  eşik değiştirilmedi ve PASS sayılmadı.
  Global Flow maksimumları 215,376 / 254,510 / 248,552 ms; Backlog 197,275 / 390,196 / 126,369 ms idi.
  **EN:** Closure accepts the recorded refresh cost and unresolved responsiveness gap; this is not a passed 200 ms acceptance gate.
- **#914:** Başlangıç yükü azalırken ilk modül kullanımı pahalılaşabilir;
  son kohortta Manufacturers 487,1 → 627,6 ms, taze Collection 611,5 → 793,8 ms.
  İlk tarihsel uzun-görev toplamı +%3,5; sonraki kabul kohortunda 5572,0 → 6053,9 ms (+%8,65).
  **EN:** Deferred assets shift work to first use; long-task totals did not improve and cohort differences remain visible.
- **#904:** Yeni dataset timer aralığı 673 → 209 ms iken toplam 679 → 1583 ms;
  mevcut dataset cache miss'inde 973 → 474 ms iken toplam 981 → 1362 ms.
  **EN:** Worker execution improves the observed renderer timer gap at a higher total completion cost, not measured input latency.
- **#906:** Lisans CARD-01 parçası, tekrarlanan +%24,42 search p95 gerilemesi nedeniyle
  kullanıcı kararıyla ayrıldı; diğer kazanımlar korundu.
  **EN:** The license-card portion was excluded, not silently accepted.

## Kapanış doğrulaması ve merge kuyruğu / Closing validation and merge queue

| PR | Test edilen head / Tested head | Standart tam test / Standard full test | i18n | Release notes | Gerçek CI / Actual CI | Merge commit |
| --- | --- | --- | --- | --- | --- | --- |
| #909 | `d2991df0` + Main `1796193f` | 10/10 batch; 1.303 files; 8.942 PASS, 0 FAIL, 65 SKIP, 0 CANCEL | 0/0 | PASS (51) | [SUCCESS](https://github.com/clbiez/Buyer-Log-Desktop/actions/runs/42435205055) | `37cc293d` |
| #910 | `588d7b80` + Main `37cc293d` | 10/10 batch; 1.305 files; 8.956 PASS, 0 FAIL, 65 SKIP, 0 CANCEL | 0/0 | PASS (53) | [SUCCESS](https://github.com/clbiez/Buyer-Log-Desktop/actions/runs/42496958358) | `f127b83f` |
| #911 | `00f438aa` + Main `f127b83f` | 10/10 batch; 1.306 files; 8.959 PASS, 0 FAIL, 65 SKIP, 0 CANCEL | 0/0 | PASS (54) | [SUCCESS](https://github.com/clbiez/Buyer-Log-Desktop/actions/runs/42497452889) | `6db40d29` |

Tam test, varsayılan concurrency=4 ile tek `npm test` çağrısındaki **10 batch** demektir;
ayrı batch toplamı veya eski head CI'ı son kapının yerine kullanılmadı.
**EN:** Final gates require the unchanged standard runner and actual checks for the final head.
İlk #909 koşusunda ortak auth/local-DB ortam override'ları testlerin özel köklerini gölgeledi;
üretim veya assertion değiştirilmeden bu override'lar kaldırılarak tek düzeltme denemesi yapıldı.
PLM Sync, #916 motorları/testi ve korunan CP checklist hızlı kontrol adımı değiştirilmedi.
**EN:** No PLM Sync or protected #916 code, tests, steps, thresholds or i18n baseline were relaxed.
#908 **atlandı ve kapatıldı**: son üç çiftte CP 11.324 → 12.229 ms (+%8);
kanıtlanmış tek düzeltme bulunmadığından yeni tanı açılmadı.
**EN:** #908 was skipped and closed for an unresolved CP regression; micro wins did not override the first-CP guard.

## Merge edilmeden kapatılan PR'lar / PRs closed without merging

Her dal arşiv olarak korundu / All branches remain available as archives.

| PR | Tek cümle sonuç / One-sentence outcome |
| --- | --- |
| #890 | INT-06 checkpoint hazırlığı korundu; üretim journal/snapshot entegrasyonu yapılmadı / Preparation archived; production integration deferred. |
| #891 | 6a alan envanteri ve shadow hazırlığı arşivlendi; thin üretimde açılmadı / Inventory archived; thin mode not activated. |
| #893 | Sabit tarihsel FX kaynağında kuyruk timeout'u doğrulandı; dört eski timeout'un tekil nedeni bilinmiyor / Controlled queue exhaustion verified, individual historical attribution unknown. |
| #895 | ANA-12 istemci iptal hazırlığı korundu; gerçek route/job entegrasyonu yok / Client cancellation preparation archived, production linkage absent. |
| #896 | ADMIN-01 hazırlığı arşivlendi; son demo sunucu tanısında health p95 13,73/20,02 ms, worker faydası kanıtlanmadı / Preparation archived; worker benefit unproven. |
| #897 | Yetki bulgusu arşivlendi; ayrı #915 güncel yetki kapısını düzeltti, ADMIN-03 hesap optimizasyonu uygulanmadı / Authority fix merged separately; hierarchy optimization deferred. |
| #898 | INT-01 tam kopyalama adayı reddedildi: 7,122 → 8,928 s ve RSS 1009 → 830 MiB / Full-copy candidate rejected despite lower RSS. |
| #899 | INT-03 fixture/bellek hazırlığı korundu; ortak byte budget üretim yoluna bağlanmadı / Preparation archived; production byte budgeting deferred. |
| #900 | JSON/WAL–SQLite prototipi korundu; karar **bekle**, pilot/migrasyon izni yok / Prototype retained; **wait**, no pilot or migration authorization. |
| #903 | INT-12 taklit transport hazırlığı korundu; 244/288 → 179/199 ms üretim kanıtı değil, spekülatif istek 1→2 riski açık / Mock result is not enterprise acceptance. |
| #905 | Faz 3 yeniden ölçümü arşivlendi; ilk CP ödünleşimi sonuçları yukarıda korunur / Remeasurement archived; first-CP tradeoff retained above. |
| #907 | Tarihsel/güncel FX tanısı arşivlendi; queue-BUSY/parse-failed ayrımı ve kaçırılan güncelleme üretimde düzeltilmedi / Diagnostics archived; remaining FX behavior deferred. |

#918 açık ve merge edilmemiştir; açıklamasında **performans programı dışı** yazar;
kullanıcı ayrıca karar verecektir / Remains open, unmerged and outside this program for a separate decision.

## ERTELENEN İŞ — sohbet 1–8 sonuçları / DEFERRED — chats 1–8 outcomes

A/B/C kaynak incelemesindeki öncelik düzeyleridir. Bu güncelleme mevcut sohbet kapanışlarını ve gerçek PR durumlarını kaydeder; yeni ölçüm veya kanıt dosyası üretmez.
**EN:** Priority A/B/C follows the review. This update records existing chat outcomes and actual PR states; it adds no new measurements or raw evidence.

**Kayıt kesimi / Cutoff: 2026-11-08 19:50 (Europe/Istanbul, UTC+03).** Sonuçlanmış sohbetlerdeki “atlandı” kararı aynen aktarılır. Kapanış mesajı veya uygulama PR’ı doğrulanamayan yedi madde bu raporda “atlandı — teslim doğrulanamadı” olarak kapatılır; sürmekte görünen sohbetlere tamamlandı veya başarısız ölçüm sonucu atfedilmez.
**EN:** Final skip decisions are copied from completed chats. Seven items without a verifiable final delivery are closed in this report as “skipped — delivery unverified”; ongoing chats are not claimed to have completed or failed measurement.

| Öncelik / Priority | Madde / Item | Sonuç / Outcome | Gerekçe ve PR / Reason and PR |
| --- | --- | --- | --- |
| A | ANA-02 | Atlandı / Skipped | 681,9 → 612,1 ms; kazanç 69,8 ms < 100 ms; çıktı hash’leri eşit; PR yok / Gain below 100 ms; equal output hashes; no PR. |
| A | ANA-03 | Atlandı — teslim doğrulanamadı / Skipped — delivery unverified | Sohbet kaydında yalnız görev var; ölçüm, kapanış mesajı veya uygulama PR’ı yok; teslim doğrulanamadı / Only the assignment is recorded; no measurement, final outcome or implementation PR to verify. |
| A | ANA-04 | Atlandı — teslim doğrulanamadı / Skipped — delivery unverified | Sohbet kaydında yalnız görev var; Backlog/Intake uygulaması ve eşdeğerlik sonucu doğrulanamadı; PR yok / Only the assignment is recorded; no verifiable implementation or parity outcome; no PR. |
| A | CPR-04 | Atlandı / Skipped | Açılış 2355,3 → 2277,4 ms (%3,3), filtre 1151,4 → 1040,7 ms (%9,6), sıralama 1165,7 → 1088,7 ms (%6,6): %10 kapısı geçmedi; veri/hücre hash’leri eşit; senkronize veride kayıt 0 → 0, yüklü kural 0; PR yok / All gains below 10%; equal data/cell hashes; zero saves on synchronized data with no loaded rules; no PR. |
| A | CPR-08 | Atlandı / Skipped | 30k kaynak → 24.982 CP satırı; 220,7 → 228,4 ms (%3,5 yavaşlama); 14/14 senaryoda hücre hash’leri ve hata özetleri eşit; PR yok / Slower candidate; 14/14 cell-hash and error-summary checks equal; no PR. |
| B | ANA-08 | Atlandı — teslim doğrulanamadı / Skipped — delivery unverified | Sohbet kaydında yalnız görev var; aktif kırılım için ölçüm veya kapanış sonucu doğrulanamadı; PR yok / Only the assignment is recorded; no verifiable measurement or final outcome; no PR. |
| C | ANA-09 | Atlandı — teslim doğrulanamadı / Skipped — delivery unverified | Sohbet kaydında yalnız görev var; freeze/sanallaştırma kabul sonucu doğrulanamadı; PR yok / Only the assignment is recorded; no verifiable freeze/virtualization acceptance; no PR. |
| B | ANA-10 | Atlandı / Skipped | İlk çift 237,1 → 8,8 ms, fakat çıktı hash’i farklı; eşdeğerlik kapısı geçmedi; PR yok / First pair only; output hashes differ, parity failed; no PR. |
| A | DS-02 | Atlandı — teslim doğrulanamadı / Skipped — delivery unverified | Son kayıt ölçümün sürdüğünü söylüyor; üç çift hedef-metrik kapanışı ve uygulama PR’ı yok; teslim doğrulanamadı / Last update says measurement is ongoing; no final three-pair target-metric outcome or implementation PR to verify. |
| A | DS-03 | Atlandı — teslim doğrulanamadı / Skipped — delivery unverified | İlgisiz override değişimi gerektiren ayrı tetikleyici ölçülmediği son ara kayıtta belirtilmiş; kapanış sonucu ve uygulama PR’ı yok / Last update identifies a missing unrelated-override trigger; no final outcome or implementation PR. |
| A | DS-04 | Atlandı — teslim doğrulanamadı / Skipped — delivery unverified | Son kayıt ölçümün sürdüğünü söylüyor; hedef API süresi/eşdeğerlik için kesin kapanış sonucu ve uygulama PR’ı yok / Last update says measurement is ongoing; no final API-time/parity outcome or implementation PR. |
| B | INT-08 | Atlandı / Skipped | Yalnız model-image-cache.js izni, app-main.js içindeki cache’i atlayan warmup ve prior/loaded yollarını kapsamıyor; kapsam engeli nedeniyle yeni A/B veya hash karşılaştırması yok; 22/22 mevcut test PASS; PR yok / Cache-bypassing callers require changes outside the allowed file; no new A/B or parity claim; existing tests pass; no PR. |
| B | CPR-06 kalan / remainder | Atlandı / Skipped | İlk çizim 8.342 → 843 ms, DOM 435.111 → 4.606, düzenleme 402 → 307 ms; yerel kopyalama main’deki 120 yerine 31 satır verdi, eşdeğerlik geçmedi; değişiklik geri alındı, PR yok / Faster first paint failed clipboard parity (31 vs 120 rows); candidate reverted; no PR. |

### Yapılmayacaklar — bu kapanış turunda kapsam dışı / Outside this closure round

Bu işler sohbet 1–8’e verilen dar uygulama kapsamına alınmadı; kapsam dışı kaydı, tamamlandı veya kazancı yok anlamına gelmez.
**EN:** These items were not assigned to chats 1–8; out of scope means neither completed nor proven to have no benefit.

| Öncelik / Priority | Madde / Item | Sonuç / Outcome | Gerekçe / Reason |
| --- | --- | --- | --- |
| B | DS-01 | Kapsam dışı / Out of scope | Delta/legacy çift yazımı kaldırmak korunan senkron/delta-store sahipliğini değiştirir; bu turun kapsamı dışında / Removing duplicate persistence changes protected sync/delta-store ownership. |
| B | DS-10 | Kapsam dışı / Out of scope | No-change sync sonrası hydrate, bu turda izin verilmeyen senkron akışına bağlı / Post-sync hydration belongs to the sync path excluded from this round. |
| B | 6b: SHELL-05 | Kapsam dışı / Out of scope | Native sekmede modüle özel hazırlık Windows/Electron kabulü gerektirir; bu turda native kabuk kapsamı yok / Native module-only startup needs Windows/Electron acceptance outside this round. |
| B | 6b: SHELL-06 | Kapsam dışı / Out of scope | 73 test ve Chromium helper doğrulaması üretim bağlantısı değildir; context/asset/caller entegrasyonu ve Electron kabulü ayrı iş / Helper verification does not cover production wiring or Electron acceptance. |
| B | 6b: app-main yaşam döngüsü / lifecycle | Kapsam dışı / Out of scope | load/mount/activate/deactivate/dispose entegrasyonu, izin verilen dar fonksiyon değişikliklerinden geniş bir kabuk dönüşümüdür / Lifecycle integration exceeds the assigned function-level changes. |
| A | 6a ince projeksiyon / thin projection | Kapsam dışı / Out of scope | Kapalı adayın full-data tüketicileri ve üretim kabulü tamamlanmadı; projeksiyon mimarisi bu turda yeniden açılmıyor / Incomplete consumer and production acceptance; projection redesign excluded. |
| A | 6c delta kalıcılık / persistence | Kapsam dışı / Out of scope | CPR-02/03, DS-07/09, WAL/undo/owner adaptörleri üretimde etkin değil; veri sahipliği ve delta-store entegrasyonu bu turda yasak / Ownership and delta-store integration excluded; adapters remain inactive. |
| B | 6d SQLite | Kapsam dışı / Out of scope | Karar bekle; prototip üretim/pilot/migrasyon izni değildir ve SMB üzerinde kurulum yapılmayacak / Decision remains wait; prototype does not authorize a production pilot, migration or SQLite-on-SMB. |
| A | INT-01 | Kapsam dışı / Out of scope | Tam grafik kopyası 7,122 → 8,928 s ile geriledi; immutable kaynak sahipliği tasarımı ayrı mimari iş / Full copying regressed; immutable ownership is a separate architectural change. |
| A | INT-03 | Kapsam dışı / Out of scope | Byte-budget helper üretime bağlı değil; gerekli PLM Sync pipeline değişikliği açıkça yasak / Helper is unwired; required PLM Sync changes are prohibited. |
| B | INT-06 | Kapsam dışı / Out of scope | Son prototip RSS +%5,85 ile kabul edilmedi; checkpoint kalıcılığı sohbet 1–8’e atanmadı / Prototype RSS failed acceptance; checkpoint persistence was not assigned. |
| B | ANA-12 | Kapsam dışı / Out of scope | HTTP→job iptali helper düzeyinde kaldı; gerçek route/CPU kabulü ve backend iptal entegrasyonu bu tura atanmadı / Route cancellation integration and production CPU acceptance were not assigned. |
| C | DS-11 | Kapsam dışı / Out of scope | Gerçek SMB/peer RTT kabul ortamı yok; bu tur ortam veya protokol değişikliği içermez / No real SMB/peer RTT acceptance environment; environment/protocol changes excluded. |
| B | INT-07 | Kapsam dışı / Out of scope | Gerçek PLM kapasite/retry kabul ortamı yok ve PLM Sync/BOM akışı koruma altında / Real PLM capacity/retry environment unavailable; PLM Sync/BOM protected. |
| C | INT-10 | Kapsam dışı / Out of scope | Upstream upload kapasitesi ve kazancı doğrulanmadı; dış sistem kapasite deneyi bu turun dışında / Upload capacity and benefit unverified; upstream load experiments excluded. |
| C | ADMIN-02 | Kapsam dışı / Out of scope | Güvenli disk geçişi azaltımı kanıtlanmadı; yedekleme doğruluğunu değiştiren çalışma atanmadı / Safe reduction of disk passes unproven; backup changes not assigned. |
| C | ADMIN-01 | Kapsam dışı / Out of scope | Gerçek demo sunucu tanısı worker faydasını kanıtlamadı; yeni worker/tanı turu kapsam dışı / Diagnostic did not prove offload benefit; another worker/diagnostic round excluded. |
| B | ADMIN-03 | Kapsam dışı / Out of scope | #915 yetki düzeltmesi mevcut; ayrı hiyerarşi/public-profile performans çalışması bu tura atanmadı / Authority fix retained; hierarchy/public-profile optimization not assigned. |
| C | INT-12 | Kapsam dışı / Out of scope | Kurumsal kapasite ve 1 → 2 spekülatif istek riski çözülmedi; dış transport paralelliği atanmadı / Enterprise capacity and speculative-load risks remain; transport parallelism not assigned. |
| B | CPR-09 / CP ilk açılış worker'ı | Kapsam dışı / Out of scope | #916 satır cache’i korunacak; kişisel katman/ilk hesap worker dönüşümü ayrı mimari iş olarak bu tura atanmadı / Row cache retained; initial/personal worker offload is a separate unassigned architectural task. |
| A | CPR-10 kalan / remainder | Kapsam dışı / Out of scope | Önceki batch kazanımları korunur; kalan delta/WAL entegrasyonu yasaklanan kalıcılık mimarisi kapsamına girer / Earlier batching retained; remaining delta/WAL work crosses excluded persistence scope. |
| C | CARD-01 lisans / license | Kapsam dışı / Out of scope | Parça +%24,42 arama p95 gerilemesi nedeniyle ayrıldı; lisans kartları bu turda yeniden açılmadı / Portion excluded for search regression; license cards not reopened. |

INT-08 için Linux tanı ortamı vardı; eksik olan preview/native üretim kabulüdür.
**EN:** INT-08 is not “unmeasured for lack of any environment”; the missing part is implementation and product acceptance.
SHELL-07 ölçülen düşük pay nedeniyle atlandı; SHELL-08/workspace-blur #908 ile merge edilmeden kapatıldı.
**EN:** SHELL-07 was skipped for low measured cost; SHELL-08/blur were not shipped.
6d SQLite kararı **bekle**; SMB ortak klasöre SQLite kurulmadı, veri migrasyonu yapılmadı.
**EN:** SQLite remains **wait**; no migration, pilot or SQLite-on-SMB deployment.
SQLite açılışı tüm state'i yüklemez; yedekleme güvenceleri eşit değildir ve SIGKILL güç kesintisi dayanıklılığını kanıtlamaz.
**EN:** SQLite open excludes full materialization; backup guarantees differ and SIGKILL does not prove power-loss durability.

## Kaynaklar / Sources

- Mevcut [Faz 0](../performance-program/phase-0.md), [1](../performance-program/phase-1.md), [2](../performance-program/phase-2.md), [3](../performance-program/phase-3.md), [4](../performance-program/phase-4.md), [5 son rapor](../performance-program/phase-5-review2-final-report.md).
- [#914 son kabul](2026-11-07-startup-post-901-acceptance.md), [#901](2026-11-07-pricing-post-912-acceptance.md), [#904](2026-11-07-analytics-post-main-acceptance.md), [Faz 7 sunucu](../performance-program/phase-7-server-report.md).
- Kapatılan PR'lardaki özgün dallar ve katkı commit'leri arşivdir; ham kanıtlar yeniden eklenmedi / Original branches retain historical evidence; no new raw evidence was added.
