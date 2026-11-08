# Actual Orders loading and full-parent connection / Gerçek Orders bağlantısı

2026-11-08. This is an integration increment, not Phase 6a completion. Public finite activation remains OFF (`ORDERS_FINITE_READY_ENABLED=false`). No speed claim or current P1 acceptance is made.

## TR

Gerçek `fetchOrdersProjection` ve `ensureOrdersLoaded` artık private owned schema/ready yanıtını native controller’a bağlayacak akışa sahiptir. Hazır projeksiyon cache miss’i gelen ordinary-full gövdesini yeniden GET/parse etmeden kullanır. Olağan full/CPX0/fullOnly yolu lazy özellik veya schema isteği açmaz. Lazy bootstrap, bekleyen gerçek flight/profile/source değişmişse istemciyi ya da finite lifecycle işaretini kuramaz.

Yayın öncesi hazırlık private kalır. Controller görünümden önce kaydedilir; tam veriye terfi tek atomik view değişimiyle yapılır. Eşzamanlı işlemler aynı gerçek parent isteğini paylaşır. Tam satır fiyat hesabı ve invalidation tamamlanmadan synchronous wide-read kapısı açılmaz. Kurulum/sonradan hesap hatası yarım view’ı ready bırakmaz. Private normalizer hazırlığı reddederse sonraki açık yeniden deneme güncel ordinary-full yolunu kullanır.

QFG, Global Flow, CP yükleyicisi, üç senkron şema setter’ı ve altı note/personal eyleminde tam veri/sahiplik kapıları eklendi. Eski prompt/HTTP sonucunun farklı kullanıcı/kaynakta yerel revision/storage/schema yazması reddedilir. Kullanıcı CP sekmesine geçebilir; published Orders parent için yalnız görsel sekme kaynak kimliği sayılmaz. Bekleyen UI eyleminin görsel sekme kontrolü ayrıca korunur.

Native RED/GREEN: consumer V3 **2 PASS / 17 FAIL → 19 PASS**; note action **0/1 → 11 PASS**; cross-tab **0/1 → 2 PASS**; gerçek yükleyici **0/1 → 7 PASS**. Retry kapanışı eski gerçek gövdede ayrıca **0/1 RED**; güncel testte ordinary-full tekrarını doğrular. İlk eski consumer paketinin tek microtask varsayımı VM Promise sınırında her iki kolda da başarısızdı; assertion’lar korunup gerçek registry giriş sinyali beklendi.

İlk adopt edilmiş hedefli koşu **51 PASS / 1 FAIL**: taşınan fixture’ın relative require yolu eksikti. Yalnız o yol düzeltildi; 10 wiring testi geçti. İlk geniş paket **894 PASS / 7 FAIL**: dört eski hydration VM fixture’ında gerçek root guard tanımı eksikti; üç kaynak testi önceki katmanın CP gövdesini değişmez sayıyordu. Dört fixture’a gerçek lexical guard yüklendi. Kaynak kontrolleri ayrı yeni katmanın tam byte reversal kanıtıyla önceki katmana uygulandı; eski equality/predicate assertion’ları korundu.

Son ilgili standart runner: **74 dosya / 904 PASS, 0 FAIL, 0 SKIP/CANCEL**. #916’nın korunan hızlı adımı **23 PASS**. i18n yeni/baseline **0/0**. İlk bootstrap örneğinin Content-Type’sız Response’u gerçek strict reader tarafından doğru reddedildi; fixture gerçek JSON Content-Type’ıyla düzeltildi. İlk iki komutun yanlış çalışma dizini hataları da başarısız kanıt olarak korunur.

Kaynak pinleri yalnız complete reverse ve aynı kalan on korunan fonksiyon kanıtından sonra güncellendi. Önceki pinler ve ilk candidate manifest’i saklıdır. Eski UI bileşen testleri frozen katmanın assertion’larını exact reverse üzerinden korur; yeni consumer, bootstrap ve actual loader testleri güncel fonksiyonları çalıştırır. #916 kaynak/test/workflow dosyaları değiştirilmedi.

Kalan aktivasyon kapıları: model modalının uzun ömürlü/two-write move sahipliği; import create/rollback’in original action devamlılığı; desteklenen producer/izin kapsamı üzerinde gerçek tarayıcı thin/full shadow ve veri/JSON/heap ölçümü; CP ilk niyet ve Faz0 üç çift; entegre tam regresyon/CI ve tek bağımsız P1 incelemesi. Bu adım Faz6c veya Faz7 üretim izni değildir.

## EN

The actual Orders fetch/load functions now contain the owned schema/ready-to-native-publication connection. Full fallback remains lazy-free; ready cache misses reuse their full response. Bootstrap rechecks the original flight before arming. Publication installs its controller before exposing rows, shares the real full-parent request, and keeps synchronous full-read gates closed until pricing/invalidation settle. Failed private preparation closes subsequent finite attempts so an explicit retry uses fresh ordinary full.

Real QFG, Global Flow, CP/schema and note actions gained full-data/current-source barriers. Published Orders source continuity survives a visual tab change while UI commands retain their independent visual-target checks. The public path remains disabled until the remaining model/import action closure and final acceptance are proven.

Native related validation: 904 pass; protected #916 check: 23 pass; i18n 0/0. Historical RED and fixture/setup failures are retained and distinguished from product regressions. Complete reverse-source proofs justify explicit pin changes. Full regression, browser acceptance, measurements, CI and independent review must be recorded separately; this increment does not claim phase completion, a performance gain, merge or TEST/STABLE publication.

Actual Chromium visual smoke: 30 synthetic Orders / 27 CP, validated generation/revision, no renderer errors. Real 1600×1000 post-change PNG inspected. This small fixture is functional/visual evidence, not the official 30k before/after or first-CP acceptance. TR/EN release note appended; prior 50 entries preserved.

First full npm test: batch 1 PASS (1754 pass/60 skip); batch 2 RED (2327 pass/1 fail/3 skip), later eight batches unrun. The failure was the existing CP registry source assertion expecting rows without assertCurrent. Its original parallel/order/no-PLM checks are retained, now requiring the actual currentness callback and JSON-before-guard-before-apply order. All 177 affected-caller tests pass after this test-only adaptation. The original failed full log is preserved; it is not a passing full regression.

Final standard full regression: **1347 files, all 10 batches in one default-concurrency invocation, 9702 PASS / 0 FAIL / 65 existing SKIP / 0 CANCEL, 243.9 s**. App SHA is in validation.json. Protected #916 files and full fast-check workflow are byte-identical to Main 1796193f. No code changed after this pass. Final PR/CI/measurements/P1 review and activation are still pending.
