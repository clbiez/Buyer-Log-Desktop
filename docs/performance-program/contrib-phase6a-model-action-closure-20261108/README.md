# Faz 6a — model action closure candidate

8 Kasım 2026. **Yalnız aday/patch recipe ve native test hazırlığıdır. Üretim entegrasyonu ve uygulama kabulü değildir.** Thin yolu kapalı kalır. Yeni store/cache/worker/endpoint yoktur; import akışına dokunulmadı.

Sabit baz dalı `prep/phase6a-wiring-handoff-20261108`, commit `ea49389836dba23f0970a974b4c0185f1b36ec0e`; bu baz Main değildir. Ayrı worktree ve teslim dalı: `contrib/phase6a-model-action-closure-20261108`. Normal push sonrası kesin commit SHA teslim mesajındadır. Teslim dosyalarının tam listesi [files.txt](files.txt).

## Adayın davranışı

[Doğrulandı / native] `removeCpModelColumn` ve `openCpModelColumnModal`, thin durumda bütün eylemi gerçek `window.BLOrdersUiChange` → `ensureOrdersFullForAction` → native full promotion zincirinden geçirir. Tanım okuma, confirm, eski modalı kaldırma ve ilk config/schema isteği bu kapıdan sonradır. Başarısız promotion eski modalı yerinde bırakır.

Modal açılışı ve save özgün profile nesnesini, actor değerini, user-context nesnesini/actor değerini, session/source epoch'unu, lifecycle durumunu, görsel sekmeyi ve tanım dizisinin hem kimliğini hem içeriğini taşır. Config snapshot'ı per-action transient karşılaştırmadır; yeni veri deposu/cache değildir. Modal kökü, liste/status/control düğümleri ve güncel ID eşleşmeleri korunur. Schema yanıtında HTTP ve JSON beklemeleri ayrı doğrulanır; bağlantı ID'si ve artan istek sırası A→B→A dahil eski yanıtı düşürür.

Save; EN/TR başlık, grup, bağlantı, alan, control kimliği/değeri ve kullanıcı input/change sürümünü başlangıçta yakalar. Girdi başka değere gidip geri gelse de eski komut sürmez. Direct writer komut gövdesini ve actor'u full promotion'dan önce yakalar. Preflight, PATCH HTTP, PATCH JSON, reload ve varsa fresh-full await sonrasında özgün eylem doğrulanır. Taşıma **add-first/remove-second** kalır; ikinci PATCH ve yerel layout/schema yazımından önce aynı eylem yeniden doğrulanır. Lost response otomatik retry, rollback veya silme başlatmaz; uzak yazım tamamlanmış olabilir ve durum açık tazeleme gerektirir.

`modelConnLoad(privateRequest=null)` mevcut no-argument çağrı yerlerini, `.length===0` değerini ve aynı `modelConnState` dönüş nesnesini korur. Eski çağıranların config uygulama/full davranışı değişmez. Yeni optional private devamlılık yalnız model eylemi yolunda kullanılır; window export'u değildir.

## Epoch devamlılığı ve private receipt

`modelConnLoad` kendi config uygulamasında `beginOrdersConfigurationApply` ile epoch'u ilerletebilir. Writer yeni epoch'u körlemesine yakalamaz. Gerçek callee private WeakMap'teki tek kullanımlık request'i tüketir; özgün eylemi HTTP/JSON sonrası, config apply öncesi ve olası gerçek fresh-full beklemesi sonrası kontrol eder. Receipt yalnız başarılı PATCH'ten bilinen sayısal revision ile ve dönen config revision'u tam eşitse üretilir.

Receipt özgün action/request nesnesine, başlangıç/bitiş epoch'una, session'a, önceki/sonraki config'e ve bilinen PATCH revision'una bağlıdır. Bitiş epoch'u callee'nin doğrulanmış `intent.epoch` değeridir; yeni global epoch yakalanıp eski eyleme atanmaz. Receipt setter'dan sonra aynı senkron bölümde üretilir; caller onu bir defa tüketip canlı profile/actor/session/tab/definition/DOM/input/config'i yeniden doğrular. Replay, başka action'a aktarım, daha yeni yabancı revision, yabancı callee uygulaması ve kaynak retirement'ı reddedilir.

Preflight/read için receipt verilmez. Gerçek loader değişmiş config'i kendi sözleşmesiyle tazeleyebilir; eski UI komutu epoch/config kontrolünde durur. Böylece yeni, açık kullanıcı eylemi güncel config ile başlayabilir. Bilinmeyen PATCH revision'u da eski eylemi yeniden bağlamaz. Receipt **yetki token'ı değildir**: mevcut sunucu `requireArea('source')`, `manageModelConnections` ve `expectedSourceRevision` CAS yolu aynen kalır.

## Gerçek sonuçlar

Son kabul edilen kaynak SHA-256: `253c6471d5952206e5118b60edb6b0d38fc99e2e314fd243449fef1a88963327`.

| Kontrol | Sonuç | Kanıt |
| --- | --- | --- |
| Aynı 146 assertion ile gerçek baz gövdeleri | 36 PASS / 110 FAIL; 0 skip/cancel | [RED](evidence/ownership-red-accepted.log.gz), [receipt](evidence/ownership-red-accepted.json) |
| Gerçek aday gövdeleri + korunan 19 consumer assertion'ı | **165 PASS / 0 FAIL / 0 skip/cancel** (146 + 19) | [GREEN](evidence/ownership-green-accepted.log.gz), [receipt](evidence/ownership-green-accepted.json) |
| Mevcut config-writer assertion'ları, aday gerçek `modelConnLoad` | **29 PASS**, assertion'lar korunur | [native](evidence/native-accepted.log.gz) |
| Standart runner, ilgili 12 dosya, readonly baz üretim ağacı | **266 PASS / 0 FAIL / 0 skip/cancel** | [native](evidence/native-accepted.log.gz) |
| #916'nın mevcut 9 dosyalı hızlı komutu | **23 PASS / 0 FAIL**, komut ve korunan baytlar aynı | [native](evidence/native-accepted.log.gz) |
| Native i18n; ayrıca aday dosyaya aynı native scanner | Yeni/baseline **0/0**, aday **0** | [native](evidence/native-accepted.log.gz) |
| Syntax, exact forward/reverse, dört fonksiyon dışı bayt eşitliği, `git apply --check` | PASS | [native](evidence/native-accepted.log.gz) |
| Mevcut bağımsız move/schema hatası | Baz **0/1**, aday **0/1**; bilinçli ayrı diagnostic, düzeltilmedi | [baz](evidence/move-schema-baseline-diagnostic.log.gz), [aday](evidence/move-schema-candidate-diagnostic.log.gz) |

Kategoriler örtüşür; toplamları benzersiz test sayısı değildir. Standart 266 sonuç adayın entegre uygulama testi olarak sunulmaz: üretim ağacı readonly kaldı. Aday için extracted gerçek fonksiyonlar, actual lifecycle/full-promotion/UI-command modülleri ve aşağıdaki fixture kullanıldı. Native transport demo isteklerini bellek içinde karşılar; mevcut gerçek `planCpColumn` ve `configRevision` çalışır, CAS koşulu mevcut sunucu yolunu taklit eder. Gerçek Express route/browser çalıştırması iddia edilmez.

İlk eski kaynak koşusu 25 PASS / 92 FAIL idi. İlk aday koşusunda 116 PASS / 1 FAIL: ikinci silmenin JSON bariyeri yanlışlıkla ilk add'in JSON'unu yakalıyordu. Yalnız bariyer gerçek `cpColumn.op==='remove'` isteğine bağlandı; beklenen assertion değişmedi. Sonraki gereksinim testleri eklendikçe ara RED/GREEN'ler ayrı isimle korundu. [evidence](evidence/) eski başarısız çıktıları içerir; hiçbiri yeni başarıyla değiştirilmedi.

Ham log'lar kayıpsız `.log.gz` olarak teslim edilir; receipt'teki `logSha256`, açılmış ham baytlara aittir. İlk staged whitespace kontrolü, unified diff'in üç boş context satırındaki standart boşluk öneki nedeniyle exit 2 verdi; [çıktı](evidence/patch-format-initial.log.gz) korundu. Diff üretiminde yalnız boş context öneki bastırıldı; aday app baytları değişmedi. Son staged whitespace kontrolü ve [exact recipe / patch apply kontrolü](evidence/patch-final-proof.log.gz) geçti. Validator veya kaynak assertion'ı gevşetilmedi.

## Ayrılmış mevcut hata

[Doğrulandı] Başarılı iki aşamalı taşımada baz modalın `saved` değişkeni ilk add'in döndürdüğü items dizisidir. İkinci remove yeni bir items dizisi uygular ama dönüşü `saved`'e alınmaz. Son `syncCpModelColumns(...saved)` uzak store'da silinmiş eski sütunu kısa süreli yerel şemada tutar. Bu hata finite lifecycle hiç etkinleşmemiş ordinary-full bazla da çoğaltıldı: uzak kaynak A boş, B'de eklenmiş sütun var; çizilen şemada ayrıca eski `column-one` kalır. Aynı probe adayda aynı assertion'da başarısızdır. Sahiplik düzeltmesinden bağımsızdır ve kullanıcı kapsam kuralı gereği düzeltilmedi. Diagnostic test skip/todo değildir; exit 1 ve ham farklar saklıdır.

## Sınırlar ve ana sohbetin işi

Bu paket `CLAUDE.md`, `AGENTS.md`, performans incelemesi, Faz 6a actual-ready-wiring/config-writer kanıtları ve gerçek dört fonksiyon/callee üzerinde hedefli hazırlandı. Başlangıç kapasitesi yaklaşık 30 GiB boş disk / 16 GiB available RAM idi; bellek/disk baskısı gözlenmedi. Test/ölçüm subprocess'leri `flock -n -E 75 /tmp/buyerlog-performance-measurement.lock` kullandı. Lock dosyası veya başkasının dosyası silinmedi. Yalnız sentetik/demo veri; gerçek servis/credential kullanılmadı.

Üretim dosyaları, mevcut fixture/pin/assertion/timeout/validator/i18n baseline ve #916 kaynak/test/workflow dosyaları değiştirilmedi. Import entegrasyonu, entegre tam `npm test`, gerçek tarayıcı thin/full shadow ve CP/Faz0 kıyasları, görsel/release-note kabulü ve bağımsız P1 incelemesi ana sohbete aittir. Prototype GREEN uygulama/Faz 6a kabulü veya hızlanma kanıtı değildir. PR, merge, rebase/force-push, bağımsız inceleme ve TEST/STABLE başlatılmadı.

Uygulama ve native test taşıma adımları: [patch-recipe.md](patch-recipe.md). Makine sonuçları: [validation.json](validation.json). Tam dosya/hash manifest'i: [artifact-sha256.json](artifact-sha256.json).

EN: This is a pinned, isolated model-action ownership candidate, not production adoption. Actual modal/remove functions gate the whole thin action; schema requests preserve modal/connection/request identity; saves carry their original controls and command through every await and add-before-remove boundary. Only the real model loader can mint a single-use continuation receipt tied to a known successful PATCH revision and validated start/end epochs. Server authorization and per-source CAS remain unchanged. Native ownership tests: 36 pass/110 fail → 146 pass, plus all 19 unchanged consumer assertions. Candidate config writers: 29 pass; readonly native related suite: 266 pass; protected #916: 23 pass; i18n 0/0. A pre-existing successful-move schema snapshot bug remains separately reproduced on both baseline and candidate. Full integration/browser/CP measurements/P1 acceptance remain with the main chat. No PR, merge or TEST/STABLE release.
