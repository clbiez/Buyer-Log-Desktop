# Korunan ön koşular

- `cost-A-*`, `cost.log`: helper yazılmadan önce mevcut blokların ilk 1/3/5
  sayfa maliyeti. Başlangıçlar sayfa navigation'ına bağlıydı; ortak bariyerli
  final kıyaslarından ayrı tutuldu.
- `lifecycle.red.tap`: helper yokken yeni sözleşme testleri RED (MODULE_NOT_FOUND).
- `adapter.red.tap`: aynı assertion'lar gerçek değiştirilmemiş Main bloklarında
  1 PASS / 7 RED. Per-page overlap ve iptal/devir eksikliği gözlendi.
- `targeted-attempt1.tap`, `lifecycle.green-attempt1.tap`: ilk 19 test GREEN.
- `cost-aligned-*`: ortak arm bariyeri ve sayfa başına ikinci GET'te 8sn gecikme.
- `pair-1-*`, `pairs-attempt1.log`: ilk üç başarılı örnek korundu; 3 sayfalı B
  final revizyonunu takipçinin kendi GET'inden okuyan harness ReferenceError'ı
  ile durdu. Takipçinin GET açmaması beklenen davranış. Sonraki harness event'te
  kabul edilen revizyonu ve GET sonucunu ayrı tutar. Bu hata için JSON dosyası
  oluşmadan evaluate exception geldi; mevcut log aynen saklandı.
- `chromium-lifecycle-failed.json`, `chromium-lifecycle-attempt1.log`: follower
  context reset'inden sonra baseline snapshot isteğinin eksik olduğu bulundu.
  `follower-context.red.tap` aynı davranışı sabitledi; recipe mevcut `status?`
  üzerinden share isteğiyle düzeltildi. `targeted-green2.tap` 21 PASS.
- `chromium-lifecycle-attempt2-failed.json/.log`: revision ve consumer eşdeğerliği
  geçti; teardown sırasında önce lideri kapatmak doğal devir GET'i oluşturdu.
  Harness önce takipçileri, sonra lideri kapatacak şekilde düzeltildi. Aynı
  no-new-GET assertion'ı korunur; gerçek lider devri ayrıca sınanır.
- `targeted-final.tap`, `chromium-lifecycle-attempt3-green.json/.log`: 26 PASS
  ve Chromium lifecycle GREEN. Bu aşamanın helper'ı daha sonra context'in
  share/receive sırasında keşfedilmesiyle timer'ın yeniden kurulması için
  revize edildi; bu kayıtlar final helper doğrulaması değildir.
- `final-cost-*`, `final-pair-*`, `final-pairs.log`: adındaki final eski bir
  attempt etiketidir. Son self-check'te bulunan share/receive context timer
  boşluğu düzeltilmeden önceki ölçümler, nihai kıyasa dahil edilmez. Kendi
  ölçüm sürecine TERM gönderilerek durduruldu; kilit silinmedi/aşılmadı.
  Playwright kapanışından gelen hata/partial kayıt varsa aynen korunur.

Son kabul verisi raporda açıkça seçilen yeni etiketli tam üç çifttir.
Hiçbir başarısız assertion, timeout veya mevcut validator gevşetilmedi.

- `context-observation.red.tap`: source değişimini yalnız share/receive
  fark ettiğinde timer'ın sönmesi için iki gerçek helper regresyonu RED.
  Final helper bu gözlemde catch-up timer'ını yeniden kurar.
- Nihai seri **`verified-*`**: 28 yeni test, yeniden Chromium lifecycle ve
  ortak saatli 1/3/5 maliyet + A/B–B/A–A/B. Son helper/recipe/measurement
  SHA-256 değerleri bütün örneklerde kontrol edilir. Snapshot toplama sırasında
  pencere sonrası başlayan GET raw JSON'da tutulur; `r.at <= 31500ms` ile sabit
  pencere hesabından ayrılır. Fonksiyonel assertion'lar aynen korunur.
