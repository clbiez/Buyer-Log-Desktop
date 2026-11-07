# #901 — Main entegrasyonu ve son kabul kanıtı

**Yerel kabul geçti; bağımsız Codex incelemesi bekliyor.** Son kanıt head'inin gerçek GitHub check sonucu PR tesliminde ayrıca bildirilir. PR taslak ve açık kalır; merge, TEST ve STABLE yayını yapılmaz. Yeni optimizasyon yoktur. **CPR-06 büyük ilk DOM çiziminin pencerelemesi hâlâ açık kapsamdır.**

## Kaynak ve sahiplik

Mevcut `perf/pricing-costing-cpr-05-06-07-12` dalı ve [#901](https://github.com/clbiez/Buyer-Log-Desktop/pull/901) kullanıldı; ikinci PR açılmadı. Önceki fiyatlama sohbeti `OK - Optimize pricing and costing performance` idle ve işi açıkça devretmiş durumdaydı. Diğer aktif sohbetler ayrı kapsamlardaydı; aynı işi sürdüren ikinci aktif sohbet bulunmadı.

Korunan head **2f15610f840aadb3c90c1f866564eb7ac405987c**, güncel Main **63159fb32ff3d5bdc5f142b4a8f16ca6a3983240**. Normal merge **30f5315474fc898bec99e2630a0cd4c378b39eb0** tam bu iki ebeveyni taşır. Rebase veya force-push yapılmadı. Tek çatışma `resources/app/public/release-notes/next.json` idi; üretim/test dosyalarında çatışma olmadı.

Main'in 38 sürüm notu Main sırasıyla, önceki PR'ın 34 kayıt nesnesi de aynı içerikle korundu. Yalnız bu PR'ın iki mevcut kaydı eklenince toplam **40** oldu; Main'in güncel summary alanı korundu. Yeni not veya yapay görsel eklenmedi. Kayıtlar `pricing-client-calculation-cost` ve `open-costing-line-calculation-cost`; her ikisinin TR/EN metni ve gerçek demo PNG'si aynıdır.

Üretim kodu korunan head ile birebir; Main'e göre yalnız beş mevcut fiyatlama dosyası değişiktir. Sunucu ağacı, `app-main.js`, `index.html`, `perf-runtime.js`, bütün CSS, `model-image-cache.js`, canonical alanlar, test runner, assertion/validator/timeout/skip davranışı ve i18n guard/baseline Main ile aynıdır. #906 ve #908'in gerçek dosya listeleriyle tek çakışma ortak `next.json` dosyasıdır. Kapsam dışı kaynak değişikliği yapılmadı. [Koruma manifesti](../performance-program/evidence/pricing-client-cost-20261107/acceptance/preservation.json) ve [PR dosya kilitleri](../performance-program/evidence/pricing-client-cost-20261107/acceptance/pr-file-locks.json) ayrıntıları kaydeder.

## IAM ve varsayılan test kökleri

#912'nin [teşhisi](https://github.com/clbiez/Buyer-Log-Desktop/blob/1f1f155d273c872641c9dedc15ae262c2e1652a0/docs/performance-program/phase-5-regression-diagnosis.md), ortak `/tmp` altındaki başka geçerli sentetik kurtarma dosyalarının “geçerli recovery yok” varsayımını bozduğunu, üretim hash'i aynıyken özel TMPDIR ile IAM'in 7/7 geçtiğini belgeler. Bu nedenle yeni üretim IAM düzeltmesi beklenmedi ve bu dala başka PR kodu alınmadı.

Bu görevde IAM dosyası temiz özel TMPDIR ile **7/7 PASS**, fail/skip/cancel 0, exit 0, stderr boş verdi. İlgili ve tam paketlerde de aynı değişmemiş dosya çalıştı. Her komut için ayrı yeni TMPDIR kullanıldı; `BUYER_LOG_DATA_ROOT`, `BUYER_LOG_LOCAL_DATA_ROOT`, `BUYER_LOG_SERVER_DATA_ROOT`, auth/config/temp-root veya `NODE_OPTIONS` global override'ı eklenmedi. Central IAM kapatılmadı; testlerin kendi mevcut fixture/env seçimleri aynen çalıştı.

İlk ilgili paket sandbox içinde **298 PASS / 3 dosya düzeyi FAIL** verdi: üç dosya varsayılan `/home/agent/.buyer-log/write-recovery` dizinini oluşturamadı (`ENOENT`, salt okunur sandbox). İlk IAM sonucu yine 7/7 idi. Dar ek filesystem izni de salt okunur mount'u değiştirmedi. Yönetilen demo ortamında daha önce bulunmayan boş varsayılan `.buyer-log` dizini oluşturuldu ve testler filesystem sandbox dışında çalıştırıldı. Varsayılan kökü başka yere yönlendiren env/fixture/üretim düzeltmesi yapılmadı. Aynı kaynakta ilgili paket ardından geçti. İlk kırmızı stdout/stderr ve komut/ortam kaydı [initial-default-root-red](../performance-program/evidence/pricing-client-cost-20261107/acceptance/initial-default-root-red/results.json) altında korunur; başarısız koşu başarılı diye yeniden etiketlenmez.

## Gerçek yerel sonuçlar

Linux, Node **v24.19.0**, 4 CPU kotası, 16 GiB bellek. Bağımlılıklar ortamda hazırdı; kurulum veya sürüm değişikliği yapılmadı. Kaynak/test/notlar **30f5315474fc898bec99e2630a0cd4c378b39eb0** üzerinde donduruldu. Sonraki değişiklikler yalnız bu PR'ın belge ve kanıtlarıdır; `resources/app` tree'si aynı kalır. Komut, çalışma dizini, env, UTC ham zamanları, exit code, stdout/stderr byte/hash değerleri ve batch sayımları [results.json](../performance-program/evidence/pricing-client-cost-20261107/acceptance/results.json) içinde; kayıpsız loglar aynı dizindedir.

`resources/app` çalışma dizininden, yalnız her komuta ait özel `TMPDIR` ile:

| Kontrol | Gerçek sonuç |
| --- | --- |
| `node --test --test-reporter=tap tests/local-iam-migration-authority.test.js` | 7 PASS / 0 FAIL-SKIP-CANCEL; ilk ortam kaydında |
| `npm test -- pricing quotation open-costing local-iam-migration-authority v714` | 50 dosya / 312 PASS / 0 FAIL-SKIP-CANCEL, exit 0 |
| Standart filtresiz `npm test` | 1.290 dosya / bütün 10 batch / 8.851 PASS / 0 FAIL / 65 mevcut SKIP / 0 CANCEL, exit 0; 143,5 sn; stderr boş |
| `npm run i18n:check` | 0 yeni / 0 baseline, exit 0; baseline boş |
| `npm run release:notes:validate` | 40 kayıt PASS, exit 0 |

Tam paketin tek çağrısı başarıyla sonlandı; ayrı native devam, batch atlama, filtre veya concurrency değişikliği yoktur. Runner varsayılan concurrency **4** kaldı.

| Batch | Dosya | PASS | FAIL | SKIP | CANCEL |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 300 | 1743 | 0 | 60 | 0 |
| 2 | 300 | 2327 | 0 | 3 | 0 |
| 3 | 300 | 2050 | 0 | 0 | 0 |
| 4 | 300 | 2008 | 0 | 1 | 0 |
| 5 | 85 | 677 | 0 | 0 | 0 |
| 6 | 1 | 4 | 0 | 0 | 0 |
| 7 | 1 | 12 | 0 | 0 | 0 |
| 8 | 1 | 8 | 0 | 0 | 0 |
| 9 | 1 | 8 | 0 | 0 | 0 |
| 10 | 1 | 14 | 0 | 1 | 0 |
| **Toplam** | **1290** | **8851** | **0** | **65** | **0** |

## Ölçüm ve görsel kanıtların korunması

Altı ölçülen kaynak dosyasının SHA-256'sı önceki `environment.json` içindeki **after** değerleriyle aynıdır. 30k fixture arşiv hash'i de aynıdır. Ölçülen kod yolu değişmediği için CPR-05 veya diğer benchmark'lar tekrarlanmadı. Temiz CPR-05 A/B–B/A–A/B turunun **61.348,452 → 134,471 ms** medyanı ve altı eşit çıktı SHA'sı tarihsel ölçüm olarak korunur. Örtüşen eski CPR-05 turu, IAM kırmızı logları ve diğer ham sonuçlar silinmedi/değiştirilmedi; yeni Main açılış ölçümü gibi sunulmaz.

İki mevcut 1440×1000 gerçek post-change PNG yeniden görsel olarak incelendi: Fiyat Masası arama/detay fiyat editörü ve demo Ön Maliyet satır düzenlemesi görünür, yalnız demo veri vardır. Görseller ve ilgili istemci kaynakları değişmedi; görsel davranış eklenmediği için yeniden capture yapılmadı. Motion+ / reduced-motion yolları değişmedi; tam paket ve son GitHub fast check bu sözleşmeleri ayrıca denetler. Bu görev yeni bir canlı tarayıcı kabulü iddia etmez; mevcut ölçülen tarayıcı/editor parity kanıtını korur.

## İnceleme, GitHub ve kalan kapsam

Beş üretim dosyasının, yedi regression testinin ve not birleşiminin eleştirel özincelemesi tamamlandı; yeni somut P1/P2 regresyon saptanmadı. Bu, bağımsız inceleme yerine geçmez. GitHub review submission listesi bu teslim hazırlanırken boştur. Tek gerekli bağımsız **Codex** turu için [inceleme paketi](2026-11-07-pricing-codex-review.md) hazırdır; inceleme **bekliyor**, yapılmış sayılmaz. Claude'a bağımlılık oluşturulmadı.

Son belge/kanıt commit'i mevcut dala normal push edilir ve **tam o head'in** gerçek GitHub check-run/workflow sonucu beklenir; önceki head'in yeşil kontrolü kullanılmaz. Nihai SHA ve CI run bağlantısı güncel PR açıklamasında ve teslim mesajında tutulur; bu metin kendi commit hash'ini tahmin etmez. Fast checks yerel tam 10-batch paketin yerine geçmez.

Kalan kapsam: CPR-06'nın büyük ilk DOM çiziminin pencerelemesi, tam DOM ilk açılış kabulü ve bağımsız Codex incelemesi. Üretici karne özeti hâlâ talep büyüklüğüyle doğrusal; bu PR tam artımlı motor, kalıcı revision cache'i veya yeni debounce uygulaması sunmaz. Yeni optimizasyon bu entegrasyona eklenmedi. **Merge öncesinde durulur; TEST yayımlanmadı, STABLE yayımlanmadı.**
