# ANA-12 — tanı, fixture ve Faz 7 test hazırlığı

**Durum: yalnız hazırlık. Üretim iptali uygulanmadı. Merge, TEST ve STABLE yok.**

Güncel uyumluluk bazı **`63159fb32ff3d5bdc5f142b4a8f16ca6a3983240`** (#885 entegrasyonu #902 üzerinden Main'de). Normal merge **`4ae0730103d438c049dfe1419a41eed9489ba1ad`**; rebase/force-push yok. Çalışan harness bu yeni pine bağlıdır. [Güncel uyumluluk raporu](main-compatibility.md), [kaynak karşılaştırması](artifacts/main-63159fb3/source-comparison.json), [yenilenen 24 koşu](artifacts/main-63159fb3/cohort/summary.json) ve [ana sunucu sahibine devir](handoff.md) esas alınır. Aşağıdaki ilk teslim bölümü kendi eski SHA/kanıtlarıyla tarihsel kayıttır; güncel Main ölçümü diye kullanılmaz. ANA-12 açık kalır.

## İlk hazırlık teslimi — tarihsel kayıt

Kaynak sözleşmesi: `CLAUDE.md` ve `docs/performance/2026-11-05-codex-review-findings.md`, ANA-12. Sabit Main **`5a1656e98deeb573f6245f4b24a8135cc77a0d7b`**, #892 dahil. Ayrı dal: `diag/ana-12-cancellation-preparation`. Yalnız bu dizinde yeni dosyalar vardır; `resources/app` ağacı bazla aynıdır. #892'nin dar `app-main.js` istisnası genişletilmedi. #885 inceleme SHA'sı **`69950f289a012f0bb7c61290bec9890f340f6c64`** salt okunur incelendi; rebase/force-push yok.

## Kaynakla doğrulanan sınır

- Plan/gerçekleşen `refresh()` generation ile eski sonucu eler; `fetch` sinyali ve kapanışta abort yok.
- `BLBacklogRows.loadData` aynı sorgunun promise'ini paylaşır; grup değişimi paylaşılır. Scope/generation/query/includeSourceDetails anahtarda kalır. `invalidate()` yalnız Map'i temizler; çalışan fetch'i iptal etmez. Önbellekten düşen dört üzerindeki pending girişler de sürer.
- Overview ve chart generation kontrolleri eski ekran yayınını engeller. Chart `loadDetail()` içindeki cache ataması render generation kontrolünden **önce** gelir; Faz 7'de ekran yanında cache yayını da doğrulanmalı.
- Teslimat paneli `BLBacklogRows.load` tüketicisidir; kapatılan overview/chart diğer tüketiciyi iptal etmemeli. #885 `loadRows` ayrıca `whenRowsReady` kapısını içerir; güncel Main hazırlığı bu gelecekteki entegrasyonun yerine geçmez.
- #885 ortak read-service flight/lease refcount'una sahiptir; bu, henüz flight beklenirken HTTP abort'unun CPU işini durdurduğunu göstermez. Havuzda queued signal iptali vardır; active signal iptali worker'ı retire/terminate eder. Bu yol **cooperative cancellation uygulanmış** diye adlandırılmaz. Yanıt lease'inin `finish/close` sonrası bırakılması da hesap işi iptali değildir.

Dosya SHA-256 ve doğrulanmış satır çapaları: [source-evidence.json](source-evidence.json). Açık #885/#890/#891/#893 dosyaları: [open-pr-locks.json](open-pr-locks.json). Yeni dizinle çakışma yok; kilitli kaynaklar değiştirilmedi.

## Tekrarlanabilir maliyet: Node CPU trace

Gerçek üç istemci dosyasından benzersiz çapalarla alınan **değiştirilmemiş fonksiyon blokları** VM'de çalışır. Render, DOM, rapor modeli ve lazy hazırlık servisleri stub'dır. Node'un gerçek fetch'i yalnız loopback sentetik HTTP sunucusuna gider; `response.text()` + `JSON.parse` sarmalayıcısı bayt/parse süresini gözler. Bu, tarayıcının native `response.json()` maliyeti, gerçek Buyer Log oturumu, backend işi veya iş hesaplaması eşdeğerliği ölçümü değildir.

Fixture: 30.000 basit probe satırı, 10 farklı sorgu, 8 ms aralık, 350–458 ms yanıt gecikmesi. OS bant genişliği kısıtlaması kullanılmaz. Satırlar demo kimliklerinden oluşur; canonical veri modeli veya ham başlık eşleştirmesi eklenmez. Bağımsız beklenen son sorgu işareti `demo-9`; iş projeksiyonu oracle'ı Faz 7'de gereklidir.

Dört senaryo: plan; overview + chart ortak yükleme; chart fallback fetch; ortak yüklemede iki panelin kapanması. Kapanış VM'de gerçek overview `setOpen(false)` ve chart disabled render yoludur; gerçek UI click/Motion+ ölçümü değildir. İki tüketiciden yalnız birinin kapanması ayrıca ertelenmiş yanıtla test edildi: diğer tüketici doğru yanıtı alır.

**Resmî optimizasyon önce/sonra kıyası yapılmadı.** Aynı üretim koduyla `before-preparation`/`after-preparation` etiketli **A/A kontrolü** yapıldı: dört senaryonun her biri için 3+3, toplam 24 koşu; blok sırası AB/BA/AB. Her iki kol aynı #892 kodunu içerir. Koşular ve testler ölçümle çakıştırılmadı. Linux x64, Node 24.19.0, 4 CPU kotası, 16 GiB; tek süreç, GC zorlanmadı. Fixture gövdeleri ölçüm öncesi hazırlanır. CPU hem yerel sentetik sunucuyu hem istemciyi içerir; heap farkı retained heap değildir.

Son değişmeyen harness ile [final-cohort](artifacts/final-cohort/) esas alınır. Önceki [cohort](artifacts/cohort/) ve ilk RED logları korunur; yeni çıktıyla üzerlerine yazılmaz.

| Medyan (her hücre 3 koşu) | A parse / eski parse (ms) | B parse / eski parse (ms) | A/B toplam process CPU (ms) |
|---|---:|---:|---:|
| Plan | 92,08 / 82,70 | 100,47 / 92,00 | 305,67 / 237,65 |
| Overview + chart ortak | 91,83 / 83,04 | 103,60 / 95,83 | 283,31 / 297,37 |
| Chart fallback | 95,15 / 85,55 | 98,48 / 90,03 | 266,95 / 245,17 |
| İki panel kapanışı | 86,10 / 77,84 | 93,89 / 86,11 | 294,83 / 313,07 |

Her koşuda **10 gönderilen istek, tepe 10 aktif istek, 0 sinyal/abort**. İki ortak tüketici 20 yerine 10 istek kullanır. Her koşu 30.331.020 byte JSON ayrıştırır; dokuz eski yanıtın **27.297.918 byte**'ı son sorgu başlatıldıktan sonra ayrıştırılır. Kapanış senaryosunda 10/10 tamamlanma kapanıştan sonradır. Açık panellerin son sorgu işareti 24-koşu kampanyasının ilgili bütün koşularında doğrudur; kapalı chart eski sonucu yayımlamaz, overview'in kapanışı kendi devam eden yüklemesini durdurmaz.

Bu maliyet ANA-12 için tekrarlanabilir istemci kanıtıdır. A/A farkları hızlanma veya gerileme kabulü değildir. **Backend gönderilen/başlayan/tamamlanan/iptal edilen job sayıları ve iptal sonrası CPU bilinmiyor (`null`).** Bu koşularda hiç gerçek abort yapılmadı. `processCpuAfterSupersessionMs` aynı süreçte son sorgu başlatıldıktan sonraki CPU'dur; iptal sonrası CPU veya backend CPU değildir. Sonucu yok sayma gerçek kaynak iptali sayılmadı.

Ham event zamanları/ölçümler, koşu başına `.cpuprofile.gz`, [medyanlar](artifacts/final-cohort/summary.json), [ortam/harness SHA](artifacts/final-cohort/environment.json), [iz özeti](artifacts/trace-summary.json), [kanıt kontrolü](artifacts/evidence-check.txt) ve [manifest](artifacts/manifest.json) saklıdır.

## Test hazırlığı ve doğrulama

`contracts.cjs` gelecekteki üretim adapter'ına beş executable client sözleşmesi verir: refcount/idempotent release, ilk tüketici ayrılınca diğerinin tamamlanması, normal tamamlanmada abort olmaması, varyant izolasyonu ve 10 hızlı değişimde son sonuç. **Adapter uygulanmadı; bu sözleşmelerin üretimde GREEN olduğu iddia edilmez.** Negatif self-test mevcut abort'suz source adapter'ını reddettiğini doğrular. Tam plan, HTTP/backend ve late-cache yarışları [matrix.json](matrix.json) içindedir; pending satırlar tamamlanmış sayılmaz.

- Harness RED: modül henüz yokken test başarısız; GREEN: harness yazıldı. Ek kapanış erişimi RED→GREEN ayrıca saklı. Bunlar üretim düzeltmesinin RED→GREEN kanıtı değildir.
- Son harness: **7/7 PASS**, fail/skip/cancel 0.
- Mevcut Backlog/plan-actual/ortak filtre/canonical paketi: **10 dosya, 88/88 PASS**, fail/skip/cancel 0.
- Mevcut agent/Motion+/reduced-motion sözleşmeleri: **27/27 PASS**, fail/skip/cancel 0.
- i18n: yeni **0**, baseline **0**. Mevcut release notes: **32 PASS**. Görünür ürün değişikliği olmadığı için yeni release note/PNG yok; sonraki görünür entegrasyonda kendi TR/EN kayıt + incelenmiş gerçek post-change PNG zorunlu.
- Tam `npm test` çalıştırılmadı. **Faz 6 / son program PR'ında**, sabit #885 sonrası Main + uygulama SHA'sında `resources/app` içinden **filtresiz `npm test`** şartı korunur. Sonucu etkileyen kod değişince ilgili kontroller ve zorunlu tam test yenilenir. Hedefli test/fast checks yerine geçmez; zorunlu fail/skip/cancel başarı sayılamaz.

Tekrar üretme (repo kökünden):

```sh
node --test docs/performance-program/ana-12/diagnose.test.cjs
node docs/performance-program/ana-12/diagnose.cjs /tmp/ana12-new-empty-output
node docs/performance-program/ana-12/compatibility-check.cjs
```

Çıktı dizini boş olmalı; önceki kanıtın üzerine yazma engellenir. Üretim ağacı pin ile aynı değilse kampanya durur. Kaynak çapaları belirsizleşirse extraction durur. Yeni fixture/benchmark kodunda ölçümü yenile; mevcut sonuçları yeni kodun sonucu diye kullanma. Gerçek server/login/refresh başlatılmaz, refresh POST retry yok.

## Karar ve kalan risk

Ana sohbet entegrasyon talebini kullanıcı üzerinden kabul etti; **backend bağlantısı henüz uygulanmadı**. Kabul edilen sınır ve tek Claude incelemesi için kullanıcıya verilecek paket [handoff.md](handoff.md) içindedir. P1 doğruluk/yetki/cache sınırları gerçek üretim adapter'ı ve mevcut ortak havuzla doğrulanmadan kapanmaz. Yeni worker, timeout artışı, ortak source generation'ını tek istek için artırma yok.

Faz 7 resmî kıyasının iki kolu aynı #892 kodunu içeren, #885 sonrası sabit Main'den kurulmalı; aynı sentetik fixture/ortam, en az 3+3 koşu ve medyan kullanılmalı. Backend job/CPU iptal kanıtı, tam yanıt oracle'ı, TR/EN ve gerçek UI kapanış/reopen davranışı pending. Eşdeğerlik, yetki, veri kaybı veya beklenmedik kırmızı kontrolde durulur. Merge ve TEST/STABLE yayınlama yetkisi yok.

EN: Preparation only. Exact client lifecycle blocks demonstrate ten live requests and nine stale JSON parses under a deterministic delayed synthetic workload. This is an unchanged-code A/A control including #892, not an accepted optimization. No production cancellation or backend integration is implemented; backend job counts and post-cancellation CPU remain unknown. Full regression at Phase 6/final program closure, one user-mediated Claude review at most, and no merge/TEST/STABLE remain mandatory.
