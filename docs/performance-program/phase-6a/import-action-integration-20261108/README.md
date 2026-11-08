# CP import action closure / CP aktarım işleminin devamlılığı

Bu katman `#918` temelini normal merge `a08356da` ile alır; Main'in 50 kaydı, 6a'nın kendi kaydı ve import temelinin kaydı birlikte korunur (52). #918 dalı/inceleme SHA'sı değiştirilmedi ve Main'e merge yapılmadı.

## Gerçek bağ / Actual wiring

- Wizard `open` artık CP için mevcut `ordersUiChange` tam-veri kapısından önce adapter/şema okumaz, eski pencereyi kapatmaz veya yeni pencere oluşturmaz. Full yolun synchronous sonucu korunur.
- CP adapter tek özgün note/source bağlamını alır. Oluşturma, aynı mevcut `saveCpNoteColumnDefs` yoluna özgün note intent ve wizard/run owner kontrolünü taşır. HTTP ve JSON beklemelerinden sonra kontrol yenilenmeden global revision/şema uygulanmaz.
- `override-sync` kuyruğuna yalnız opt-in synchronous `assertCurrent` kontrolü eklendi: gerçek dispatch öncesi, yanıt uygulanmadan önce ve stale conflict recovery öncesi. Hook HTTP options'a taşınmaz. CP hook'u özgün plan/field map, satır witness/revision ve wizard sahibiyle bağlıdır. Hook'suz legacy success/conflict trace'i frozen gerçek kuyrukla JSON-eşittir.
- Satır yazımı başlayınca aynı action'ın sütun rollback'i engellenir. Wizard'ın otomatik rollback yapmaması #918'den korunur; kayıp ACK sıfır yazım sayılmaz.
- Meşru reload için `loadFromServer(force, targets)` public iki-parametreli sözleşmesi ve eski test anchor'ı korunur. İç üçüncü argüman yalnız private WeakMap request'ini tüketir. Receipt caller'ın await sonrası taze yakaladığı epoch'tan değil, gerçek loader'ın son doğrulanmış transaction noktasından çıkar. Sonradan generation/session/modül/actor/note şeması değişmişse completion reddedilir. Unarmed legacy yolun dönüşü undefined ve tek loader çağrısı korunur.
- Aynı wizard'a yeni plan verilirse eski callback yeni taslağı kapatmaz. Yeni veritabanı, worker, authority cache'i veya endpoint yoktur.

EN: Gate CP import before adapter/schema capture, retain one original source/note/wizard/run context, and recheck the real queue at dispatch/response/recovery. Use a private receipt from the actual loader's validated transaction to distinguish the import's own reload from a stale completion. Preserve unguarded legacy queue traces, public loader shape, and existing full-path synchronous behavior. Unknown or acknowledged writes never justify automatic column deletion.

## RED / GREEN ve fixture ayrımı

`6a-import-action-initial-red.log.gz`: gerçek thin-open ve uncaptured-note-save yolları 0 PASS / 2 FAIL. `6a-import-queue-red.log.gz`: önceki iki kontrol PASS, dört gerçek kuyruk sınırı FAIL. `6a-import-refresh-red.log.gz`: 8 PASS / 2 FAIL; gerçek reload meşru completion'ı bozuyordu ve fabricated true sonucu reddedilmiyordu. Plan-replacement RED ayrıca korunur.

`6a-import-all-native-final.log.gz`: **47 PASS / 0 FAIL / 0 SKIP**, actual wizard open/run, actual native full promotion, actual note save/Plan/queue ve bütün gerçek loader gövdesi kullanılır. DOM/HTTP test sınırları sentetiktir. Eski completion-safety 21 test gövdesi byte-identical; yalnız CP fixture factory'si yeni gerçek dependency'leri yükleyen ortak native fixture'a taşındı. Yeni plan testine ek olarak, note PUT sırasında owner kaybı, thin niyet iptali, geç response, geç conflict, missing receipt ve legacy trace eşdeğerliği korunur.

İlk ilgili koşudaki 5 hata ayrı tutulur: dördü public loader imzasını literal arayan değişmemiş testlerdi. İmza üretimde aynen korundu; CP/Orders testleri gevşetilmedi. Beşinci source assertion, canonical note writer'ın eski tek-argüman çağrısını arıyordu; aynı writer artık özgün action/owner alıyor. Kontrol, bu daha kesin çağrıya bağlandı; actual native create/write kanıtı vardır. Son ilgili paket: **58 dosya / 893 PASS / 0 FAIL / 0 SKIP**. İlk başarısız koşu GREEN diye yeniden adlandırılmaz.

## Kaynak geçişi ve kalan kapılar

`tests/fixtures/orders-import-action-closure/integration-edits.json` yeni katmanı ve #918 temelini bütünüyle tersine kurarak önceki model kaynağını `9d5e3fe8` SHA'sıyla doğrular. Önceki model katmanı ve daha eski bütün kaynak kanıtları korunur. Pinler yalnız yeni hash yazılarak güncellenmedi; original strict pin JSON snapshot'ları ve complete reverse testleri durur. #892 sayaç ve #916 motor/test/workflow dosyaları korunur.

Küçük gerçek tarayıcı kontrolleri 30 kaynak / 27 CP satırında demo-only'dir; programatik workbook kurulumu mevcut `_state()` üzerinden yapılır, dosya seçici/upload uçtan uca testi değildir. Armed-full marker guard'ları etkinleştirir; thin profile etkinleştirmez. Bu kontroller 30k hızlanma, gerçek Windows/Electron veya final shadow kabulü değildir.

Thin OFF. Faz 6c etkin değil. Son tüm-app regresyonu, gerçek thin/full shadow ve 30k Faz0/ilk-CP kıyası, final CI ve tek stabil-diff P1 incelemesi açık kalır. Eski 9702 full PASS yeni katmanın sonucu olarak kullanılmaz. TEST/STABLE yayımlanmadı.

## Gerçek SSE yarışı / Actual self-notification race

Armed-full gerçek tarayıcı denemesi native 47 PASS'in kaçırdığı bir entegrasyon farkını buldu. Satır ACK'sinden sonraki meşru reload sırasında `refreshSharedMasterClient(noteColumnDefs)` ikinci GET/reload'u başlatıyordu. Trace özgün epoch 3→5'ten, ikinci SSE reload'u ile 7'ye geçişi ve kalan depth=1'i gösterir. Aktör/session değişmedi; data/column ACK korundu, UI güvenli hata verdi. Native HTTP fixture'ı SSE yayınını modellemiyordu.

Kanonik `saveCpNoteColumnDefs` isteğine mevcut `X-Client-Id` başlığı eklendi. Sunucunun değişmemiş `publishSharedMasterChange` yolu bu kimliği origin olarak taşır; değişmemiş SSE handler yalnız kendi pencere olayını zaten atlıyordu. Yeni header RED'i, aynı/başka client handler kontrolleri ve gerçek tarayıcı tekrarında **tek reload, depth=0, başarı** doğrulandı. Yabancı not olayları hâlâ reload eder. Güvenlik veya source guard'ı gevşetilmedi; server/SSE handler değişmedi. Bu bir hızlanma oranı iddiası değildir.

Normal full ve armed-full post-ACK-fault gerçek browser testleri de geçti; sonuncuda tam CP projeksiyonundan değer ve field yeniden doğrulandı. Orijinal başarısız screenshot/log/trace'ler ayrı SHA/kökleriyle saklıdır.

İlk tam test ilk batch'te iki kaynak kontrolüyle RED kaldı. `column-group-v742` seçilen bağlantının await öncesi sabitlenen `connectionId` kopyasını artık izler; aynı grup değerinin actual PATCH ve native canonical result'ta bulunması ek regresyonla sabittir. `compute-module-schema` pininin eski `9947d093` blob'u, tam model/import reverse ile aynı eski kaynaktan doğrulanır; bütün producer/schema/frozen-lineage pinleri korunur. Kaynak testleri silinmedi veya gevşetilmedi. İlgili kapanış **48 dosya / 809 PASS**. Yeni tek-invocation tüm-batch koşusu sonuçlanmadan önceki full sonuçlar başarılı kabul edilmez.

İkinci tam koşu batch2'de değişmemiş INTAKE kontrolünün `modelConnLoad()` public imza anchor'ında durdu. Model loader da eski sıfır-parametreli public şeklini korur; private continuation yalnız iç `arguments[0]` ile alınır. INTAKE testi değiştirilmedi. Değişen tüm sembolleri doğrudan kullanan **44 dosya / 513 PASS** ayrıca doğrulandı; bu paket tam suite yerine geçmez. Her iki başarısız tam koşu korunur; üçüncü tam koşu baştan, varsayılan ayarlarla çalışır.


Üçüncü tam koşu batch4'te tek eski `outsideSwitchSha256` kontrolünde durdu. Önceki `b6659e5c` kaynağı model/import exact reverse ile yeniden kuruldu: eski maskelenmiş hash `bca1e905` aynıdır; `switchTab` gövdesi eski/yeni SHA `4a8623a2` ile byte-identical kalır. Yeni maskelenmiş hash `d989dbec`, yalnız gözden geçirilen model/import eklemelerini içerir. Yeni lineage testi eski snapshot/hash'i ve unchanged switchTab'ı ayrıca doğrular; mevcut profile-rejection testi aynen korunur. RED ve 70 PASS hedefli GREEN ayrı arşivlendi. Önceki üç başarısız tam koşu korunur; dördüncü tam koşu varsayılan ayarlarla baştan çalışır.

EN: The third full run stopped in batch four at the prior outside-switch source hash. Full reverse reconstruction proves the original source/hash and byte-identical switchTab body. The current pin now describes the reviewed model/import additions, with an extra strict lineage test retaining the original proof. The existing profile rejection assertions are unchanged. The 70-test targeted pass is separate from the still-running fourth standard full invocation.


## Son doğrulama checkpoint / Validated integration increment

Dördüncü standart tam koşu aynı runtime SHA üzerinde **1.352 dosya / 10 batch / tek çağrı / 240,4 sn / 9.905 PASS / 0 FAIL / 65 mevcut SKIP / 0 CANCEL** ile geçti. Ardından i18n **0 yeni/0 baseline**, sürüm notları **52/52**, orijinal #916 hızlı komutu **23/23** geçti. Runtime/test dosyalarında bu koşulardan sonra değişiklik yoktur. İlk üç RED koşu ve ayrı GREEN/RED kayıtlar saklanır.

EN: The fourth standard invocation passes all ten batches with 9,905 tests passed, zero failed/cancelled and 65 existing skips. i18n is 0/0, 52 release notes validate, and the unchanged #916 fast command passes 23 tests. No runtime or test changes follow this pass. Earlier failing runs remain evidence.

Komut: repo kökünde `env -u NODE_OPTIONS -u NODE_PATH TMPDIR=/tmp/buyerlog-phase6a-model-import-standard-tmp flock -n -E75 /tmp/buyerlog-performance-measurement.lock npm --prefix resources/app test`. Guard komutları `final-guards.json` içindedir.

Bu sonuç yerel entegre kodun regresyonudur; Faz6a kapanışı değildir. İnce veri OFF; etkin thin/full gerçek tarayıcı shadow, 30k ilk-CP/Faz0 önce-sonra, stabil P1 inceleme ve final CI açık. #918 ayrı taslak kaldığından aynı dosyada ikinci açık PR yaratılmadı. Merge/TEST/STABLE yok.
