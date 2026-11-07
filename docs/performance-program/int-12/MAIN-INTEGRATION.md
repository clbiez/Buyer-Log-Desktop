# INT-12 — Main #885 sonrası hazırlık entegrasyonu

TR: #903 yalnız hazırlık teslimidir. Main normal merge ile alındı; üretime özgün değişiklik eklenmedi. Güncel kaynakta 17 hazırlık + 111 native OAB + 12 taklit HTTP testi geçti; i18n temiz. Ölçülen yol değişmediğinden A/B tekrarlanmadı. INT-12 açık, kurumsal kapasite/üretim kabulü yok; merge ve TEST/STABLE yayını yok.

EN: #903 remains preparation only. Current Main was integrated by a normal merge without original production changes. Validation passed: 17 preparation, 111 native OAB and 12 mocked-HTTP tests, with clean i18n. The measured path is unchanged, so A/B was not repeated. INT-12 remains open without enterprise-capacity or production acceptance; no merge or publication.

## Sabit entegrasyon / Pinned integration

| Kimlik / identity | SHA |
|---|---|
| Önceki #903 head / previous head | `2e1506490d997247aaf37def69a739d9048b2f03` |
| Alınan güncel Main / integrated Main | `63159fb32ff3d5bdc5f142b4a8f16ca6a3983240` |
| Normal merge / two-parent merge | `24131b856d14b3a196058602c7f15f13dca28d39` |
| Main içindeki #885 merge / ancestor | `76ddbaf4a2a85132d2ad9dff8d1465377e1f81aa` |
| Main içindeki #892 / ancestor | `5a1656e98deeb573f6245f4b24a8135cc77a0d7b` |

TR: Merge'in iki ebeveyni önceki #903 head ve Main SHA'sıdır; #885 ve #892 ancestry kontrolü geçti. Main deltası 194 dosyadır; özgün üretim farkı Main'e karşı **0**. `server.js`, `app-main.js`, canonical, ortak compute ve Claude dosyaları Main'den geldiği haliyle korunur. Rebase/force-push yapılmadı. Açık diğer 14 PR'ın dosya listesinde hazırlık dosyalarıyla kilit çakışması yoktu.

EN: The merge parents are exactly the prior preparation head and pinned Main; ancestry checks confirm #885 and #892. The Main integration delta contains 194 files, with **zero original production delta against Main**. Protected files remain exactly as imported from Main. No rebase or force-push; the observed other 14 open PRs had no preparation-file overlap.

## Kaynak ve sözleşme kanıtı / Source and contract proof

[Tekrar üretilebilir kaynak kontrolü](main-integration/compare-source.cjs) ve [ham karşılaştırma](main-integration/source-comparison.json):

- Batch servisi tam dosya SHA-256'sı **değişmedi**: `e23ca7a6d70de4dcaad834fab833e8ff1cb1dfa5eb2d49caf1c3418e59e71f33`. Kuyruk/fetch dönüşüm ankorlarının her biri hâlâ tekil. Native plan, batching probe, cache, authority, cancellation, sonuç makbuzu, snapshot ve continuation sözleşmesi byte düzeyinde aynı / entire native service and both unique candidate anchors are unchanged.
- `server.js` tam dosyası değişti; kullanılan `assertOabCurrentAccess`→`oabDesktopSessionReady` başlangıcına kadar auth dilimi **aynı**: `d94b7d0845b46538b481145636caae6d58ec1733ec7e54cb93a59cc7ce2761dc`. Ankorlar 5419/5468 → 5433/5482, her biri bir adet; yalnız konum kayması var / full server file changed, but the extracted native auth slice is byte-identical and both anchors remain unique.
- Harness'ın literal yerel `require` kapanımındaki **11 dosya aynı**: harness, fixture, batch servisi, saf batch yardımcıları, job/session store, user-data ve dört kalıcılık/lease bağımlılığı. Eski ölçümün service/auth/harness/fixture kimlikleriyle birebir eşleşir / all 11 local closure files match, including persistence/lease dependencies and the recorded measured identities.
- Main'in `oab-static-metadata.js` ve `user-access.js` değişiklikleri açıkça kaydedildi; değişmemiş harness bunları fake dependency olarak enjekte ettiği için ölçülen yolda yüklenmezler. Bu, bütün üretim OAB yolunun değişmediği iddiası değildir / changed real metadata/access modules are explicitly excluded because the harness injects mocks; this is not a claim that the complete production OAB path is unchanged.
- Node sürümü eski provayla aynı: 24.19.0. `runCase`, seri referans, fixture, orijinal eşdeğerlik assertion'ları ve runner'ın ölçüm döngüsü değiştirilmedi. Kaynak hash'leri/ankorları yeniden sabitlemek gerekmedi / no measured-path, serial-reference, fixture or assertion repinning was needed.

TR: **Ölçüm kararı: tekrar yok.** Kaynak kontrolü `measurementPathChanged=false` verir; yeniden benchmark başlatılmadı. Önceki 90 koşu / 45 karşılaştırma ve 244/288 → 179/199 ms değerleri eski SHA ve hash'leriyle tarihsel taklit sonuçlardır; yeni Main için ölçülmüş üretim performansı veya kurumsal kazanç diye yeniden etiketlenmedi.

EN: **Decision: no repeated benchmark.** The source proof reports `measurementPathChanged=false`. The previous 90 runs/45 comparisons and 244/288→179/199 ms retain their original source identities as historical mock results, not newly measured Main or enterprise performance.

## Hazırlık dosyası uyarlaması / Preparation adaptation

TR: Eski benchmark preflight'ı bütün production ağacını ilk #892 Main'ine göre koruyordu; #885'in meşru entegrasyonunu reddetti. [RED çıktı](main-integration/preflight-red.txt.gz) korunur; bu hata ölçüm başlamadan ve çıktı klasörü oluşmadan geldi. Üretim semantiği uyuşmazlığı değildir.

EN: The old benchmark preflight rejected legitimate Main integration because its protected production-tree baseline still pointed to the original #892 Main. The RED is retained; it occurred before measurement or output-folder creation, not from a native semantic mismatch.

TR: Yalnız hazırlık runner'ında korunan dosya guard'ının referansı, kaynak karşılaştırmasıyla doğrulanmış Main `63159fb3` ve yeni, ayrı [17-test GREEN kaydı](main-integration/green-gate.json) oldu. Korunan dosya kapsamı daraltılmadı. Native auth hash'i de GREEN kaydına karşı kontrol edilir. Yeni `--preflight-only` kipinin [GREEN çıktısı](main-integration/preflight-green.txt) `measurementRun=false` verir; ölçüm döngüsüne girmez. [İlk kaynak tarama aracı hatası](main-integration/source-probe-first-failure.json) da saklandı: hazırlık harness'ı Main'de aranmıştı; karşılaştırma normal merge head'ine düzeltilince kaynak eşitliği doğrulandı.

EN: Only preparation preflight metadata/logic was adapted: the same protected-tree scope is checked against reviewed Main and a separate fresh GREEN gate, with an additional native-auth hash check. The new preflight-only mode validates this without entering the measurement loop. An initial tooling lookup failure is retained separately; it searched Main for a preparation-only harness and was corrected to compare the merged preparation tree.

## Doğrulama ve kanıt koruması / Validation and evidence preservation

| Kontrol / check | Sonuç / result | Kayıt / record |
|---|---|---|
| Hazırlık / preparation | 17 PASS; fail/skip/cancel 0 | [TAP](main-integration/preparation-green.txt) |
| Native OAB: batch, continuation, authority, receipts, results, snapshot, async/local metadata | 111 PASS; fail/skip/cancel 0 | [TAP](main-integration/native-oab-green.txt) |
| Yerel HTTP + fake PASS / local HTTP, mocked PASS | 12 PASS; fail/skip/cancel 0 | [TAP](main-integration/http-oab-green.txt) |
| i18n | yeni / new 0; baseline 0 | [log](main-integration/i18n.txt) |
| Kaynak / source | 11 dosya + auth aynı / same; measured path unchanged | [JSON](main-integration/source-comparison.json) |
| Güncel preflight / current preflight | PASS; measurementRun=false | [log](main-integration/preflight-green.txt) |

TR: Önceki `evidence/` ve `followup-evidence/` altındaki **112 dosyanın tamamı**, eski head `2e150649` ile byte düzeyinde karşılaştırıldı ve korunuyor. İlk RED, revoke ham failures/olay karşılaştırmaları, tüm A/B örnekleri ve eski GREEN kaydı ezilmedi. İnceleme paketi [tarihsel README'de](README.md#tek-bağımsız-inceleme-paketi--one-independent-review-packet) duruyor. Bu entegrasyonda bağımsız inceleme başlatılmadı; incelemeye hazır olmak, incelenmiş/onaylanmış olmak anlamına gelmez.

EN: All **112 historical evidence files** were compared byte-for-byte with the prior head and preserved. Original RED, raw revoke comparisons, all A/B samples and old GREEN gate were not overwritten. The original review packet remains. No independent review was started; readiness for review does not mean approval or completed independent review.

TR: Tam `npm test` bu hazırlık entegrasyonunda çalıştırılmadı. **Faz 6 / son program PR'ının filtresiz tam regresyon şartı ve son üretim uygulamasının gerekli inceleme şartı devam eder; etkili kod değişirse kontroller yenilenir.** Görünür ürün değişikliği yok; bu PR kendi release-note/PNG kaydı eklemez. Son head'in GitHub checks sonucu PR'da ayrıca kaydedilir; yeşil olmadan ready yapılmaz. #903 merge edilmeyecek, TEST/STABLE yayımlanmayacak.

EN: Full `npm test` was not run for this preparation integration. The Phase 6/final-program full-regression gate and final production implementation's required review remain mandatory, renewed after relevant changes. This PR adds no visible product behavior or release-note/PNG. Actual GitHub checks for the final head are recorded separately; readiness requires green checks. No PR merge or TEST/STABLE publication.

TR: **Açık risk:** iptal/revoke sırasında olaydan önce başlatılmış spekülatif istek sayısı 1→2 olabilir. Üretim concurrency artışı, gerçek servis/credential veya kapasite kabulü yok. INT-12 açık kalır; bu PR yalnız hazırlıktır.

EN: **Open risk:** cancellation/revocation may leave two reports started before the event rather than one. No production concurrency increase, real service/credentials or capacity acceptance; INT-12 remains open.

## Tekrar üretme / Reproduction

Repo kökünden / from repository root:

```sh
node resources/app/tests/helpers/oab-int12-measure.cjs --preflight-only
node docs/performance-program/int-12/main-integration/compare-source.cjs /tmp/int12-new-source-comparison.json
```

`resources/app` içinden / from `resources/app`:

```sh
node --test --test-reporter=tap tests/oab-int12-preparation.test.js
node --test --test-reporter=tap --test-concurrency=1 tests/oab-batch-service.test.js tests/oab-job-continuation.test.js tests/oab-native-async-authority.test.js tests/oab-job-receipts.test.js tests/oab-job-results.test.js tests/oab-snapshot-concurrency.test.js tests/oab-metadata-async-read.test.js tests/oab-metadata-local-route.test.js
node --test --test-reporter=tap --test-concurrency=1 tests/oab-batch-integration-v720.test.js
npm run i18n:check
```

TR: Source karşılaştırma script'i ölçüm başlatmaz; mevcut kanıtı ezmemek için çıktı dosyası varsa reddeder. Yeniden source kontrolünde ayrı checkout/çıktı konumu kullan. Eski ölçümleri veya inceleme SHA'larını rebase/force-push ile yeniden yazma.

EN: The source-comparison script never measures and refuses to overwrite its existing evidence output. Use a separate checkout/output location for another capture; do not rewrite old measurements or review SHAs by rebase/force-push.
