# Orders yapılandırma yazıcıları / Configuration writers

8 Kasım 2026. P1 entegrasyon adımı; Faz 6a veya performans kabulü değildir.
Public thin yolu kapalıdır. CP yükleyicisi ve #916 dosyaları değişmedi.

[Doğrulandı] Gerçek `modelConnLoad`, `modelConnSave`,
`refreshPricingRulesFromServer` ve `persistPricingRules` gövdeleri source/session,
profile ve user-context sahipliğini async beklemelerin sonunda yeniden doğrular.
Finite yaşam döngüsü hiç başlamamış ordinary-full istekleri mevcut başlangıç
davranışını korur; istek beklerken finite etkinleşirse eski yanıt kabul edilmez.
Değişen yapılandırma thin veriyi eski parent üzerinden terfi ettirmez: seçim
gerçekten boşsa yeni ordinary-full yüklenir, sonra setter ve hesap uygulanır.
Seçimin bilinmediği veya dolu olduğu durumda uygulama reddedilir.

İyimser pricing yazımı ordinary-full üzerinde ağ isteğinden önce uygulanmaya
devam eder. 409 taslak/hata davranışı, sürüm koruması ve yeni canonical yanıtı eski
başarısız PUT ile geri almama davranışı korunur. Yeni `deferPricing` yalnız
yapılandırma değişimi için beklenen taze tam yüklemede eski kuralları uygulamayı
önler; normal yüklemenin kural uygulamasını kaldırmaz.

Native RED→GREEN: dört eski writer gövdesiyle **11 PASS / 18 FAIL**, adayla
**29 PASS**; actual product + UI + retirement/IAM testleri **114 PASS**.
Genişletilmiş ilk paket **654 PASS / 3 FAIL**: eski royalty VM fixture'larında
yeni bağımlılık yoktu. Üç fixture'a gerçek üretim lifecycle'ı yüklendi; bütün
eski assertion gövdeleri byte olarak aynı. Son ilgili paket **657 PASS**, #916
hızlı adımı **23 PASS**, syntax PASS, i18n yeni/baseline **0/0**, release-note
validator **50 PASS**. Başarısız ilk çıktı ve ham SHA'lar korundu.

Kaynak pinleri körlemesine yenilenmedi. `source-pin-review.json`, yalnız dört
writer + yeni helper bloğu + tek `deferPricing` koşulu geri alınınca önceki dosyanın
birebir oluştuğunu doğrular. Önceki pinler ayrı dosyalarda korunur. Mevcut UI
assertion'ları aynı recipe'nin exact config katmanına uygulanmasıyla çalışır;
historical d088 kaynağı ve UI helper/recipe/önceki assertion dosyaları korunur.
CI'da Git objesi veya yeni bütün-app snapshot'ı gerekmez.

İlk salt kaynak kanıt komutu sandbox'ta Node `spawnSync git EPERM` nedeniyle
durdu; pinler değişmeden kaldı. Aynı kaynak karşılaştırması native ortamda geçti.
Bu ortam hatası ürün/test hatası olarak raporlanmadı.

Tam regresyon, gerçek UI capture/full-parent bağlantısı, kalan mutation/QFG/SSE
kapıları, son 30k karşılaştırmalar ve bağımsız P1 incelemesi bekliyor. Bu adımda
ölçülmüş hızlanma yok. PR/push/merge ve TEST/STABLE yayını yapılmadı.

EN: Actual model/pricing writers now reject stale finite-lifecycle responses,
obtain fresh ordinary full rows before changed configuration is applied, and
preserve the legacy inactive full startup and optimistic save paths. Native
behavioral baseline: 11 pass/18 fail; candidate: 29 pass. Product integration:
114 pass. The first broader run retained 3 missing-dependency fixture failures;
after installing the actual lifecycle, all 657 related tests and 23 protected
#916 tests pass. Existing royalty assertions are unchanged. i18n is 0/0 and
50 release notes validate. Exact reverse-source and UI composition proofs
justify the explicit pin delta. Thin is still disabled; final full regression,
UI/measurement acceptance and independent P1 review remain pending. No speed
claim, merge, TEST or STABLE release.
