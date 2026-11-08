# Import completion safety / İçe aktarma tamamlanma güvenliği

## Değişti / Changed

[Doğrulandı] Gerçek `runImport` kodunda satır ACK'sinden sonraki refresh hatası, oluşturulmuş sütunları rollback yoluna götürüyordu. Geç kalan işlem, global wizard `state` değiştiğinde yeni pencerenin alanlarını da temizleyebiliyordu. Bunlar kaynak/native hata senaryosudur; gerçek iş verisinde tarihsel kayıp kanıtı yoktur.

Sahiplik state+host+actor/access değişim epoch'una bağlıdır. Aynı kullanıcı profilinin normal refresh'te yeni nesne olması iptal sayılmaz. Gözlenen kullanıcı/yetki değişimi ve ABA eski işi geçersiz kılar. Bu epoch bir yetki cache'i değildir; gerçek plan/revision/canEdit kontrolleri korunur. İsteği iptal ettiği iddia edilmez.

Başarılı satır yanıtından sonra refresh hatası, bilinen created/updated/failed sayılarını korur. Kayıp yanıt `unknown` olarak ayrılır; sıfır yazım veya rollback güvenliği varsayılmaz. Oluşturulmuş sütunlar hata halinde otomatik silinmez. **Bilinçli ödünleşim:** satır yazımı başlamamış olsa dahi kullanılmayan yeni sütun kalabilir; kullanıcı yeniden denemeden önce sunucu verisini kontrol eder. Eşzamanlı yazılmış/ACK'si kayıp değer taşıyan alan silinmez.

Gerçek CP adapter'ı başlangıçtaki note-field witness'ını sabitler: kendi eklediği boş alan eski row witness'ını bozmaz; eski alanın değişmesi hâlâ reddedilir. Orijinal plan revision'ı mevcut mutation kuyruğuna taşınır. Gerçek `loadFromServer(false)` false dönerse başarı gösterilmez; true yolun eski undefined sonucu korunur. Yeni sonuç açıklamaları ve uygulamanın sahip olduğu refresh hata ayrıntısı dil değişiminde TR/EN yeniden oluşturulur.

EN: Keep acknowledged values and counts when a post-write screen refresh fails. Distinguish an unknown response from an unstarted write. Retain created columns even for pre-write failures rather than assume rollback is safe. Guard late completions by the owning wizard and an observed actor/access epoch, allowing normal same-actor profile replacement. Preserve the original plan revision in the existing CP queue and freeze the original note-field witness. Existing plan/access checks remain. This is a correctness fix, with no performance gain or server cancellation claim.

## Native RED → GREEN

- `red.log`: actual initial behavior, 2 PASS / 6 FAIL. `setup-*` failures are fixture/path setup failures, not behavior RED.
- `review-findings.red.log`: 0 PASS / 3 FAIL in real hydration/CP-schema/original-queue-revision paths.
- `revoked-after-create.red.log`, `cp-refresh-false.red.log`, `language.red.log`, `owned-detail-language.red.log`: separate retained RED evidence.
- `owned-detail-final-green.log`: 21 native tests PASS, no skips/cancels. Uses actual nested wizard, real Plan and extracted actual CP adapter/hydration functions. Network/DOM boundaries in these tests are synthetic, not a whole browser acceptance claim.
- `related-final.log`: initial 117 PASS / 2 FAIL source assertions. Production bridge literal shape was restored while retaining the new witness; old assertions were not changed. `related-green.log` records 119 PASS. Final current-tree package is recorded separately.

## Gerçek tarayıcı / Actual browser

Linux Chromium, fresh synthetic fixture of 30 source rows / 27 CP rows. Existing, unmodified `benchmark-startup-orders.js` starts the real demo server. A wrapper runs the functional probe after native measurements. Workbook setup uses the existing wizard `_state()` API and actual XLSX/Workbook/Plan code; file-picker/upload is not exercised. Actual Review/Import clicks issue real note-column PUT and override POST.

`ui-attempt03/result.json`: after real row ACK, only GET `/api/data` is fault-injected with 503. Exactly one note-column PUT and one row POST, no rollback PUT. The server's full `/api/page-projection/cp` returns the written synthetic value and retained field. Wizard retains updated=1, customFieldsCreated=1, acknowledged status and a refresh warning. TR/EN PNGs were inspected; no image editing.

`ui-success-attempt01/result.json`: no injected failure; real same-user refresh and new-note import complete successfully, updated=1, field=1, one row POST, retained value verified through full CP projection. TR/EN result is correct. No startup speed or 30k acceptance is claimed from these small functional probes.

Failed probes are retained: `ui/result.json` was blocked by an actual late release-notes dialog; the next harness closes that dialog before clicks. `ui-attempt02/result.json` failed a probe assertion that incorrectly searched lean startup metadata for note values. The actual persisted value existed in demo overrides/WAL; the corrected probe reads the full CP projection. These failed results are not relabeled PASS. No refresh POST was retried.

## Tek bağımsız P1 incelemesi / One independent P1 review

Read-only gpt-6-astra review covers Main `1796193f0a57c7785e7bf9fdb3557e33c550b25e` through initial candidate `244085ecfece32f1c47c1e1699475f52a3109ae5`. One review round; it does not cover all subsequent fixes automatically.

| Finding | Initial evidence | Closure in current tree |
| --- | --- | --- |
| R1 P1: profile object identity rejects ordinary CP hydration | Actual loader replaces BL_USER_CONTEXT even for the same actor; the wizard then fails ownership | Actor/access cancellation epoch; actual hydration, ABA and permission-change native tests; real successful CP import |
| R2 P1: own blank note-column creation changes the global row witness | cpImportRowRevision previously enumerates mutable CP_NOTE_COLUMN_DEFS after creation | Original note definitions frozen per CP adapter; native own-field and original-field-edit assertions; real new-column success/failure imports |

Additional root deltas after that review: original queued revision, explicit refresh-false propagation, dynamic outcome/owned-detail localization, extra negative tests and actual browser evidence. They are root-verified changes, not an independently re-reviewed second round. No new general review was started.

## Sınırlar / Limits

Production server, endpoints, timeout, pool, canonical bindings, #892 counter, and #916 checklist engines are unchanged. Existing test assertions/runner/validators/i18n baseline are not weakened. All 50 original Main release-note entries are preserved, with one own TR/EN entry and an inspected actual post-change PNG added.

This narrow fix does not activate Phase 6a thin rows or Phase 6c. Final whole-suite/check results, exact commit and GitHub status belong in `validation.json`. No merge, TEST or STABLE publication is authorized by a local PASS. Previous 6a 9702 PASS belongs to a different tree and is not this fix's full regression result.

## Tekrar çalıştırma / Reproduction

Repo app dizininden native kontroller: `node --test tests/excel-import-completion-safety.test.js`, `npm test -- excel-import import-profiles private-order-notes note-columns`. Tüm koşular ortak `/tmp/buyerlog-performance-measurement.lock` ile seri çalıştırılır. Native süreç/browser için ortamın izin verdiği gerçek host execution kullanılır; sandbox EPERM bir uygulama hatası diye gizlenmez.

Tarayıcı için `PLAYWRIGHT_MODULE` bu dizindeki `playwright-ui-wrapper.cjs` dosyasını; `BL_IMPORT_UI_OUT` yeni bir kanıt dizinini gösterir. `BL_IMPORT_UI_MODE=success` normal yolu, unset mod post-ACK refresh fault yolunu çalıştırır. Ortamdaki gerçek Playwright/Chromium yollarını doğrulayın; wrapper içindeki Playwright require yolu bu Cloud ortamına aittir. Değişmemiş betik: `node scripts/benchmark-startup-orders.js --rows 30 --module cp --skip-same-tab --sample-ms 1000 --renderer-timeout-ms 60000 --fixture-root <yeni-izole-demo-kökü> --out <yeni-json>`. Her koşu yeni kök/çıktı kullanır; eski başarısız kaydın üstüne yazmaz. Bu küçük işlev testi resmi Faz 0/30k üç çift ölçümünün yerine geçmez.

## Son sabit kod doğrulaması / Final local validation

Standart tam `npm test`: **1302 dosya; 10/10 batch tek invocation, concurrency=4; 8952 PASS / 0 FAIL / 65 mevcut SKIP / 0 CANCEL**, 210,0 sn. Yeni native 21/21; ilgili import paketi 123 PASS; #916 hızlı paket 23/23. i18n yeni/baseline 0/0; 51 release-note kaydı geçerli, Main'in 50 kaydı korunur. Son testten sonra runtime/test kodu değiştirilmedi. Ayrı resmi 30k üç çift kampanya çalıştırılmadı; yerel GREEN, genel program/performans kabulü değildir. GitHub/merge/yayın durumu PR'da gerçek head ile ayrıca takip edilir.

## Önceki Main entegrasyonu / Earlier Main integration — 2026-11-09

Kullanıcı #918'in güvenli biçimde Main'e alınmasını ve kapatılmasını istedi. Main `3d464cc0dc3db9eef7824e1deeaf559f26d175ea`, normal merge commit'i `b04a49248458d5feba2736b252a7f04dec424246` ile alındı; çakışma, rebase veya force-push yok. İçe aktarma düzeltmesine yeni runtime/test değişikliği eklenmedi. Önceki incelemede son delta ve güncel Main ile deneme birleşimi incelendi; 21 yeni testin dahil olduğu 123 ilgili test geçti. Önceki bağımsız incelemenin kapsamı yukarıda korunur; yeni bir bağımsız model turu iddia edilmez.

- Standart, filtresiz tek `npm test`: **1.311 dosya, 10/10 batch, concurrency=4; 9.010 PASS / 0 FAIL / 65 mevcut SKIP / 0 CANCEL**, 104,6 sn. Test, assertion, süre sınırı veya runner değiştirilmedi; BUYER_LOG/HOME/TMPDIR override'ı yok. Eksik varsayılan `/home/agent/.buyer-log` dizini oluşturuldu ve yalnız test profilinin yazma erişimi sağlandı.
- i18n: **0 yeni / 0 baseline**. Mevcut dört Main notu ve bu PR'ın tek kaydıyla **5 görsel sürüm notu PASS**; orijinal gerçek sentetik demo PNG yeniden gözle incelendi. Eski 7.0.342 arşivi değiştirilmedi.
- Üretim sunucusu/PLM Sync, korunan checklist motorları/testi ve CI workflow'ları Main ile aynı. Tam testten sonra yalnız doküman/kanıt değişti. Main dal koruması etkin değildir; son head'in gerçek CI sonucu merge öncesinde ayrıca kontrol edilir.
- Eski test ve tarayıcı kanıtları kendi kaynaklarında korunur. Yeni tarayıcı/30k performans kampanyası veya Windows/Electron kabulü çalıştırılmadı. Kullanılmayan yeni sütunların hata halinde korunması bilinçli veri güvenliği ödünleşimidir.

**EN:** The user authorized merging this separate correctness fix. Current Main was merged normally without conflicts; the unchanged import delta passed the standard full regression on the integrated source. All 10 batches passed with 9,010 tests, zero failures, 65 existing skips and zero cancellations; bilingual coverage and all five visual notes passed. The missing default test-profile directory was created without changing runtime environment variables or test guards. Protected server/checklist/CI sources remain unchanged. Original evidence is retained; no new browser/performance or Windows acceptance is claimed. Actual final-head CI and merge status are recorded in [#918](https://github.com/clbiez/Buyer-Log-Desktop/pull/918). No TEST/STABLE publication is requested or triggered.

Güncel makine kaydı: `validation.json` içindeki `currentMainIntegration`; ham loglar `main-integration-20261109/*.log.gz` altında korunur. Eski üst düzey kayıt, orijinal yerel teslimin tarihsel sonucudur.

## Son Main entegrasyonu / Final Main integration — 2026-11-09

İlk tam test sırasında Main'e #935 (`75d2c5dfc33574f8fac57b8d7e16e11a3470f655`) geldi. Main, `bd947ff543aba41efd4c9ddfd94db340d5da98e0` ile normal merge edildi; tek çakışma pending sürüm notlarında iki PR'ın kayıtları da korunarak çözüldü. Main'in beş kaydı ve bu PR'ın bir kaydıyla toplam altı kayıt geçerlidir.

İlk post-#935 tam koşu batch 3'te yeni `model-snapshot-memory` testinde durdu. Aynı değişikliksiz test, ayrı temiz Main worktree'sinde de aynı assertion ile RED verdi. Node 24.19.0/V8, `--max-old-space-size=96` için toplam **288 MiB** heap sınırı ayırıyordu; veri bu gerçek sınırdan küçük kalıyordu. `3fd0a13fe186c0f6a4e556520d35f6d7585f5543` yalnız test alt sürecine `--max-semi-space-size=1` ekleyerek toplam sınırı **99 MiB** yaptı. 96 MiB old-space sınırı, gerçek heap'ten büyük veri assertion'ı, 120 MiB alt boyut kapısı, checksum, alias, timeout ve üretim kodu korundu. Hedefli test RED→GREEN geçti; bu bir test düzeneği düzeltmesidir, #935 üretim mantığı değişmedi.

Son kaynakta standart tek `npm test`: **1.314 dosya, 10/10 batch, concurrency=4; 9.021 PASS / 0 FAIL / 65 mevcut SKIP / 0 CANCEL**, 107,3 sn. i18n **0/0**; **6 görsel sürüm notu PASS**. Tam testten sonra yalnız doküman/kanıt değişti. Korunan sunucu/PLM/checklist/CI kaynakları son Main ile aynı. Önceki GREEN, başarısız post-#935 koşusu ve baseline RED logları ayrı ve kayıpsız korunur; eski sonuçlar yeni kaynağın sonucu sayılmaz.

**EN:** Main advanced with #935 during validation, so it was merged normally and the full regression was repeated. A new snapshot-memory test failed identically on unchanged Main because Node 24 gave the child 288 MiB total heap despite its 96 MiB old-space cap. Bounding only the child's young generation makes the actual total 99 MiB while retaining every size/checksum/alias assertion and timeout; production code is unchanged. The final source passed all 10 standard batches: 9,021 passed, zero failed, 65 existing skips, zero cancelled; bilingual coverage and six visual notes passed. All earlier successful and failed evidence is retained. No TEST/STABLE workflow was triggered.

Son kayıt `validation.json/currentMainIntegration`, önceki başarılı entegrasyon kaydı `earlierMainIntegrations` içindedir; son ve başarısız loglar `main-integration-20261109/final-*.log.gz` ve `post935-*.log.gz` dosyalarındadır. Gerçek son-head CI/merge durumu #918'de izlenir.

Sonrasında Main'e gelen `94eeeaca` yalnız 7.0.343 package/lock/SBOM metaverisidir; `0cbd5c7b` ile normal merge edildi. `public/**`, `server/**` ve `tests/**` tam testteki `3fd0a13f` ile birebir aynıdır; `version:assert` ve deterministik dependency inventory `--check` geçti. Tam regresyon bu metaveri değişimi için gereksiz yere yinelenmedi; yeni head'in gerçek CI'ı ayrıca beklenir. **EN:** The later 7.0.343 metadata-only Main update was merged normally; runtime and tests are byte-identical to the fully tested source, and version/inventory checks passed. This does not trigger publication.
