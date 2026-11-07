# #885 sonrası Main — yerel delta ve native profiler kapanışı

Bu kayıt yeni Main durumunu tarihsel #885/B1/FX kanıtından ayırır. Eski kırmızı sonuçlar, loglar, JSON ve profiller değiştirilmedi. Yeni optimizasyon veya sonraki faz üretim uygulaması yoktur.

## Main ile yerel geçmişin karşılaştırılması

Karşılaştırılan Main **63159fb32ff3d5bdc5f142b4a8f16ca6a3983240** (#902). #885'in donmuş **69950f28** head'i Main'in atasıdır; #885, **76ddbaf4** merge'i üzerinden #902 ile Main'e alınmıştır. #892 (**5a1656e9**) ve #894 (**2083ffd7**) de Main'dedir.

| Commit / içerik | Main'deki durum | Yeni daldaki karar |
| --- | --- | --- |
| #885, 69950f28 ve önceki 37 commit | Main'de; geçmiş korunmuş | Yeniden uygulanmadı |
| #892, 5a1656e9; #894, 2083ffd7 | Main'de | Sayaç sözleşmesi ve metrik testi aynen korunur |
| d876f26a, f7b2ff53 | Yalnız yerel tarihsel Main/test kanıtı | Dosyalar değiştirilmeden korundu |
| 9d53bb9b, 7bf0cfd4 | CP/Orders test/fixture teslimi Main'de yok | Üretim fazı başlatılmadan, aynı testler korundu |
| bcc07254 | Commit Main'de yok. Main 9244230f factory bloğunu taşıyarak bağımlılık sorununu bağımsız çözmüş | Main'in mevcut kaynak testleri aynen korundu; yereldeki gerçek native katalog testi/helper'ı eklendi |
| 84add5f4 | **Main'de yok. İki Orders invalidation çağrısı Main'de hâlâ kapsam vermiyor.** Kaynak assertion taşımalarının çoğu Main 0590f8fb'de bağımsız yapılmış | Yalnız eksik davranış/test/kanıt deltası taşındı: iki `['orders']` çağrısı, native davranış testleri, recovery fixture izolasyonu ve kendi sürüm notu/PNG. Main'in assertion uyarlamaları tekrar uygulanmadı |
| 006ed65a, af248f46, e5b1900d | Yalnız yerel 14-hata teşhisi/kanıt düzeltmeleri | Tarihsel içerik ve kırmızı toplamlar aynen korundu |
| 0f106b2b | Profiler kapanış düzeltmesi zaten Main'de | Üretim dosyası Main ile byte eşit; tekrar düzeltme eklenmedi |

Yeni dal **fix/post-885-profiler-regressions**, Main'den açıldı. Eski yerel **e5b1900d** head'i **47fa7850** normal merge'iyle alındı. Eski dal ve bütün commit'ler durur; rebase/force-push yoktur. Çakışan kaynak testlerinde Main seçildi; bu assertion'lar Main ile byte eşittir. Yeni test/CI commit'i **23519cedb9a0d601d6ee00a5d989a1179c56436d**; kod bu SHA üzerinde sabitlendi.

`app-main.js`, 84add5f4'teki dosyayla byte eşittir. Main'e göre yalnız `server-orders-hydrated` ve `server-orders-deferred` çağrılarına `['orders']` eklenir. `_cpDecisionInputRevision`, getter, personal-decision-context istisnası, birleşik tablo revizyonları/cache temizliği ve gerçek CP invalidation'ları korunur. Transit kuralı hydration'ının CP'yi ayrıca geçersiz kılabilmesi gerekli davranıştır.

Bütün `resources/app/server` ağacı, index.html, perf-runtime.js, CSS, canonical dosyalar ve test runner Main ile birebirdir. Main'in 38 sürüm notu nesnesi Main sırasıyla korunur; daha önceki yerel 39 nesnenin tamamı da aynı içerikle bulunur. Yalnız kendi `cp-orders-only-hydration` kaydı eklenir. Önceden incelenmiş gerçek post-change PNG korunur; bu görselin app-main kaynağı yeni dal ile byte eşittir.

## Açık PR dosya kilitleri

Açık 19 PR'ın gerçek changed-files listeleri denetlendi. Profiler, CP/Orders çağrıları, recovery fixture'ı, katalog/native testler ve CI dosyasında çakışma yok. Ortak `release-notes/next.json` #901/#904/#906/#908'de de değişir: yalnız kendi kayıt eklenir, Main kayıtları veya diğer PR'ların dosyaları yeniden yazılmaz. Bu ortak dosya merge sırasında tekrar denetlenmelidir. Kayıt: `pr-file-locks.json`.

## Eski tam koşu gerçekten ne söylüyor?

**84add5f4** üzerindeki eski 10-batch denetim **8.857 PASS / 1 FAIL / 65 SKIP / 0 CANCEL** olarak aynen kalır. Asıl npm koşusu 4. batch'te exit 1 ile durmuştu; 5–10 native devamdı. `runtime-profiler-worker.test.js` ilk üç alt testten sonra dosya düzeyinde `test failed` verdi.

Arşivde stack, child exit code/signal veya worker kapanış kaydı yoktur; stdout/stderr birlikte tutulmuştu. `test failed` kök neden değildir. Eski dosyanın hangi native signal ile sonlandığı geriye dönük **bilinmiyor**. Bu eksik alanlar yeni deneyden alınarak eski loga doldurulmadı.

## Hedefli yeniden üretme ve neden ayrımı

Aynı Node **24.19.0**, özgün runner planından alınan aynı **300 dosya**, concurrency **4**, aynı özel TMPDIR ve dört izole app/local/server/config yolu kullanıldı. Eski kodda üç batch-4 tekrarı geçti: biri aynı native komutu strace ile izler, ikisi yalnız TAP reporter ekler. Aralıklı dosya hatası bu üç batch'te yeniden görülmedi. Tek dosyanın 7/7 sonucu kapatma kanıtı olarak kullanılmadı.

Eski üretim profiler'ıyla, veri dosyası veya fixture kullanmayan gerçek native start → rotate → capture → close deneyinde dört eşzamanlı süreç ve süreç başına dört oturum çalıştırıldı:

| Deney | Gerçek sonuç | Kapanış kanıtı |
| --- | --- | --- |
| Eski kod, 24 süreç; worker olay gözlemcisi | 20 normal exit / **4 SIGABRT** | close gönderimi sonrasında kesiliyor; JS stack veya uygulama stderr hatası yok |
| Eski kod, aynı deney + yalnız abort anında native stack gözlemcisi | 20 normal exit / **4 SIGABRT** | Aşağıdaki gerçek native stack; bütün child status/signal/stderr dosyaları saklandı |
| Main'deki mevcut 0f106b2b düzeltmesi, aynı 24 süreç | **24 normal exit**, 0 signal | Aynı native yaşam döngüsü ve worker kapanış kayıtları |

Native stack, `MainThreadInterface::Post [cold] → ThreadSafeDelegate::~ThreadSafeDelegate → ChannelImpl / SameThreadInspectorSession yıkımı → MainThreadInterface::RemoveObject → RunAndClearInterrupts` zincirini gösterir. Node inspector temizliği worker'ın ömrünü aşıyor; `session.disconnect()` ardından hemen sona eren worker ile main-thread temizliği yarışıyor. Main'deki mevcut düzeltme close yanıtından önce 50 ms bekler. Bu PR aynı beklemeyi yeniden eklemez veya süreyi yükseltmez.

**Doğrulandı:** Native kapanış yarışı, ortak test verisi olmadan eski üretim kodunda gerçek SIGABRT ve inspector native stack'iyle yeniden üretildi; aynı deney Main'de geçti. **Muhtemel:** Eski tam paketin dosya düzeyindeki başarısızlığı aynı yarıştır. O eski koşunun kesin sinyali/stack'i kaydedilmediğinden birebir olay eşlemesi kanıtlanamaz.

Bütün batch tekrarlarının cgroup `memory.events` değerlerinde OOM/kill/max **0 → 0**; SIGKILL gözlenmedi. CPU rekabeti native yarışı görünür kılabilir, fakat bir veri-kökü/fixture istisnası değildir. Ortam güvenlik davranışı kapatılmadı. Test izolasyonu için native deney hiç ortak model veya recovery dosyası kullanmaz. Host kaynaklarının bütün olası etkilerinin elendiği iddia edilmez.

## RED → GREEN ve aynı batch'in Main sonucu

İlk yedi profiler testi Main'deki halleriyle verbatim korundu. Eklenen sekizinci test, aynı gerçek profiler ile **24 süreç × 4 oturum**, en çok dört eşzamanlı child kullanır. Her child için signal=null, exit=0, boş stderr ve dört oturumun tamamlandığı marker gerekir. Skip, no-op, catch ile GREEN, timeout veya assertion gevşetmesi yoktur.

Aynı test/helper byte'ları, eski üretim modüllerine symlink veren ayrı bir demo ağaçta **RED** oldu: attempt 20, code=null, signal=SIGABRT; assertion/stack logda korunur. Main modülleriyle **GREEN**. İlk yedi test ve CP/revizyon paketiyle **21 PASS**, fail/skip/cancel 0. Main'deki mitigation bir zaman beklemesidir; formel inspector teardown handshake'i değildir. Daha geniş lifecycle tasarımı bu dar deltaya eklenmedi.

Ardından eski batch-4'ün **birebir aynı argv listesi ve env**'si Main tabanında çalıştırıldı: exit **0**, signal **null**, stderr **0 byte**. Yeni native test de bu batch'e dahildir; eski davranış assertion'ları korunur. Bütün ilgili kaynak/katalog/guard/CP/native paket: **83 dosya / 452 PASS**, fail/skip/cancel 0.

## Son doğrulama ve GitHub

Tam `npm test`, **23519ced** kodunda temiz özel TMPDIR ve aynı izole demo ayarlarıyla baştan çalıştırıldı. **Standart runner bütün 10 batch’i tek koşuda geçti: npm exit 0, signal null, 114,8 sn. Native devam/atlanmış batch yoktur.** Eski kırmızı sonuçlar aynen korunur.

| Batch | Dosya | PASS | FAIL | SKIP | CANCEL |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 300 | 1738 | 0 | 60 | 0 |
| 2 | 300 | 2338 | 0 | 3 | 0 |
| 3 | 300 | 2051 | 0 | 0 | 0 |
| 4 | 300 | 2000 | 0 | 1 | 0 |
| 5 | 87 | 692 | 0 | 0 | 0 |
| 6 | 1 | 4 | 0 | 0 | 0 |
| 7 | 1 | 12 | 0 | 0 | 0 |
| 8 | 1 | 8 | 0 | 0 | 0 |
| 9 | 1 | 8 | 0 | 0 | 0 |
| 10 | 1 | 14 | 0 | 1 | 0 |
| **Toplam** | **1292** | **8865** | **0** | **65** | **0** |

Tam koşudan sonra i18n **0 yeni / 0 baseline**, release-note validator **39 PASS** olarak yenilendi. Testten sonra sonuçları etkileyen kaynak/test/CI değişmedi; yalnız bu belge ve kanıt arşivleri eklendi. [Ham sonuç ve SHA manifesti](phase-5-post-main-profiler-artifacts/manifest.json), her archive üyesinin byte/SHA kaydını içerir. Her başarısız deneyin stderr/signal ve profiler kanıtı saklanır.

## B1 / FX tarihsel kayıt ve güncel durum

Eski #885 69950f28 ve e493546c ölçümleri kendi SHA'larına aittir: 200 ms kabulü başarısız, refresh medyanı +%22,60 ve FX timeout kanıtı tarihsel olarak korunur. Yeni Main sonucu diye yeniden etiketlenmez.

Güncel Main #902, ayrı Excel worker yolunu geri getiren **d0bab2ac** FX düzeltmesini ve profiler düzeltmesini içerir. #902 PR kaydı B1 yenileme ödünleşiminin kabul edildiğini bildirir. Bu görev FX tanısını veya yeni resmî benchmark'ı tekrarlamaz; yeni 200 ms kabulü/hızlanma kanıtı ileri sürmez. Bu kayıt eski başarısız örnekleri silerek bir performans kapısını GREEN yapmaz.

Merge öncesinde durulur. TEST/STABLE yayını yoktur. Gerekli tek bağımsız delta incelemesi için SHA/karşılaştırma ve riskler teslim edilir; yapılmayan inceleme yapılmış sayılmaz.
