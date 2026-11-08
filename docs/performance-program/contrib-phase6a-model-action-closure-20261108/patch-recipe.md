# Uygulanabilir patch recipe / Application recipe

Bu sohbet patch'i üretime uygulamadı. Buradaki komutlar ana sohbetin entegrasyon işi içindir. Başlangıç Main değildir; başka bir kaynak ağacına aday app-main.js kopyasını bütünüyle koymayın.

## Sabit kaynak ve kontrol

- Baz commit: `ea49389836dba23f0970a974b4c0185f1b36ec0e`.
- Baz `resources/app/public/app-main.js` SHA-256: `b6659e5c522d8584cceaf5414e4f70e0e30b7ffc24d3d2de9c0bf5b6469bf666`.
- Aday SHA-256: `253c6471d5952206e5118b60edb6b0d38fc99e2e314fd243449fef1a88963327`.
- Prototype dizini: `scripts/prototypes/phase6a-model-action-closure-20261108/`.

Bu sabit bazda aşağıdaki check kaynak pinini, 15 exact edit'in forward/reverse'ünü, dört gerçek fonksiyon ve yeni lexical helper bloğu dışındaki bütün baytların eşitliğini ve uygulanabilir patch'i doğrular. Üretim dosyasını yazmaz.

```sh
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  node scripts/prototypes/phase6a-model-action-closure-20261108/check-recipe.cjs
```

Source drift varsa check durur; hash'i yalnız check geçsin diye güncellemeyin. Ana sohbetin import değişiklikleriyle çakışan gövdeleri hedefli birleştirin ve iki katmanın exact reverse kanıtını ayrı koruyun.

## Kaynak edit'leri

Hazır diff: [app-main.patch](../../../scripts/prototypes/phase6a-model-action-closure-20261108/app-main.patch). Makine exact-edit recipe: [patch-recipe.json](../../../scripts/prototypes/phase6a-model-action-closure-20261108/patch-recipe.json). İkisi aynı aday dosyayı üretir.

1. `action-ownership.js` lexical helper bloğunu `writeCpModelColumn` önüne ekleyin. Bu blok yalnız request/receipt kimliği ve per-action transient snapshot tutar; window'a export edilmez.
2. `writeCpModelColumn` gövdesini `write-candidate.js` ile eşleyin. Mevcut endpoint ve `expectedSourceRevision` alanı korunur; üçüncü optional action yalnız iki-aşamalı modal/remove devamlılığı içindir.
3. `removeCpModelColumn` thin giriş kapısı, confirm sonrası action kontrolü, aynı action ile write ve son yerel mutation kontrolünü alın.
4. `openCpModelColumnModal` thin giriş kapısı ve pending-open DOM kimliği kontrolünü; modal/schema request sırası/DOM guard'larını; save draft sürümü/input/field snapshot'ını; add/remove sonrası original-action kontrollerini alın. Eski `saved` snapshot hatasını bu recipe'de düzeltmeyin; ayrı kanıt raporda.
5. Gerçek `modelConnLoad`'a yalnız optional private continuation lookup/consume, HTTP/JSON ön-son kontrolü, `beforeApply`, `beforeCommit` ve `applied` seam'lerini alın. No-arg çağrı yerlerini ve aynı state dönüşünü değiştirmeyin. Receipt callee'nin doğrulanmış `intent.epoch` değeriyle oluşturulur.

Tam baz hash eşleşiyorsa ana sohbet standart `git apply --check` ardından `git apply` kullanabilir. Public thin flag'i değiştirmeyin. Bu hazırlıktaki scope production apply yetkisini içermez; uygulama ana sohbetin işidir.

## Native test hazırlığı

`native-fixture.cjs` dört gerçek gövdeyi değişmeden extract eder; gerçek lifecycle, full promotion, UI command, config apply ve fresh-full loader çalışır. Transport/DOM yalnız demo harness'tir. `BL_MODEL_ACTION_BASELINE=1` aynı fixture/timeout/assertion'larla sabit gerçek baz gövdelerini seçer; candidate helper tanımları iki kolda da yüklenir, RED missing-helper hatasına dayanmaz.

```sh
# Unique labels: runner var olan kanıtı ezmez; lock alınamazsa exit 75 verir.
BL_MODEL_ACTION_BASELINE=1 node scripts/prototypes/phase6a-model-action-closure-20261108/run-evidence.cjs \
  repeat-red node --test scripts/prototypes/phase6a-model-action-closure-20261108/model-action.test.cjs
node scripts/prototypes/phase6a-model-action-closure-20261108/run-evidence.cjs \
  repeat-green node --test scripts/prototypes/phase6a-model-action-closure-20261108/model-action.test.cjs \
  scripts/prototypes/phase6a-model-action-closure-20261108/remaining-consumer-gates.test.cjs
node scripts/prototypes/phase6a-model-action-closure-20261108/run-evidence.cjs \
  repeat-native node scripts/prototypes/phase6a-model-action-closure-20261108/validate-native.cjs
```

RED exit 1 beklenir. GREEN ve native exit 0 beklenir. Mevcut move/schema probe'u ayrı çalıştırılır ve **iki kolda da exit 1** beklenir; yeşil ownership paketine skip/todo olarak eklenmez. Son gerçek kanıtlar `ownership-*-accepted`, `native-accepted` ve `move-schema-*-diagnostic` etiketlerindedir. `final-validation.cjs` bunları bir kez oluşturur; tekrar için yeni label kullanın.

`prepare-consumers.cjs`, mevcut 19 consumer testinin yalnız fixture path ve lexical dependency kurulumunu uyarlar. İlk gerçek testten dosya sonuna kadar bütün assertion gövdelerinin SHA'sı aynıdır; [consumer-proof.json](../../../scripts/prototypes/phase6a-model-action-closure-20261108/consumer-proof.json). `prepare-config-regression.cjs` mevcut 29 config-writer assertion'ını, sadece dependency/path kompozisyonuyla aday callee'ye bağlar. Mevcut üretim fixture'ları değişmedi.

Entegrasyon sırasında bu `.cjs` fixture/test hazırlığını `resources/app/tests/fixtures/` altına ve native runner'ın bulduğu küçük `.test.js` girişine taşıyın; assertion ve 5000 ms timeout'larını koruyun. `orders-ready-integration/source.cjs` ve diğer source-pin tüketicilerine yeni katmanı **complete exact reverse** ile bağlayın; sabit eski fixture/pinleri silmeyin veya güncel app hash'ine körlemesine taşımayın. Prototype `consumer-source.cjs` bunun mevcut baz üzerindeki örneğidir. Ana sohbetin import katmanı da varsa her iki katmanın sıralı reverse'ü eski kaynağı birebir üretmelidir. Buradaki harness/pinler yalnız bu sabit baz ve aday için geçerlidir; yeni entegre app için kanıtlar yeniden çalıştırılır.

Entegre uygulama için tam `npm test`, tarayıcı thin/full eşdeğerliği ve CP/Faz0 kıyasları, görsel/release-note kaydı ve bağımsız P1 incelemesi ayrıca gerekir. Bu prototype sonuçları bunların yerine geçmez.
