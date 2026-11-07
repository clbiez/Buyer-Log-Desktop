# #901 — ortak IAM engeli / ana sunucu entegrasyonu teslimi

> **Tarihsel devir kaydı; eski BLOKE kararı güncel değildir.** #912'nin [teşhis raporu](https://github.com/clbiez/Buyer-Log-Desktop/blob/1f1f155d273c872641c9dedc15ae262c2e1652a0/docs/performance-program/phase-5-regression-diagnosis.md) aynı üretim kodunda özel TMPDIR ile IAM'in 7/7 geçtiğini gösterir. #901'de de yalnız özel TMPDIR ve gerçek varsayılan veri köküyle IAM 7/7, standart tam paketin bütün 10 batch'i 8.851 PASS / 0 FAIL / 65 mevcut SKIP oldu. IAM/güvenlik kodu, fixture, assertion veya global veri-kökü override'ı değiştirilmedi. [Güncel kabul ve inceleme durumu](2026-11-07-pricing-main-acceptance.md) ayrı kayıttadır; aşağıdaki eski karşılaştırmalar ve ham kanıtlar tarihsel olarak aynen korunur.

**Durum: BLOKE.** `local-iam-migration-authority.test.js:18` başarısızlığı main üzerinde de vardır. Bu bulgu tam regresyon şartını kaldırmaz. #901 taslak ve merge edilmemiş kalır; TEST/STABLE yayını yapılmaz. Bu teslimde IAM/kimlik doğrulama üretim kodu, test, assertion veya IAM davranışı değiştirilmez.

## Karşılaştırılan kaynaklar

- İlk karşılaştırmanın main’i: `2083ffd73ba026067d92ccf257c4551afa2e5f00`.
- #901 ölçülen üretim kodu: `ba3e165a70af78416eebab8ed599df7f379e4f6b`.
- İlk main/PR çiftinin her iki commitinde `resources/app/server` Git tree SHA: `7df589bc1168069d02fd5ee25d16d70abf13a3c6`.
- İlk main/PR çiftinin her iki commitinde test Git blob SHA: `46bb902c46b58fabbe7a42f3bfe0368d281a4ed4`.
- Taze karşılaştırmanın commitleri, komutları, çalışma dizinleri, ortamı ve ilgili dosyaların Git/SHA-256 değerleri: [`comparison.json`](../performance-program/evidence/pricing-client-cost-20261107/iam-integration/comparison.json).

## Main ilerlediğinde yapılan ek doğrulama

Teslim sırasında main, Faz 5 entegrasyonu #902 ile `63159fb32ff3d5bdc5f142b4a8f16ca6a3983240` SHA'sına ilerledi. Ayrı `/tmp/buyerlog-startup-pricing-main-63159fb3` checkout'unda aynı tam IAM test dosyası yeniden çalıştırıldı: **6 pass, 1 fail, 0 skipped; exit 1**. Test blob SHA'sı aynı kalırken güncel sunucu tree SHA'sı `f1cde600d20ca2f6a4a4cd1e3c2213ea0d66e97e` oldu. Dolayısıyla ilk main/PR eşitliği tarihsel karşılaştırma olarak korunur; güncel main'in bütün sunucu ağacının PR ile aynı olduğu iddia edilmez. Ortak IAM engeli güncel main'de de devam eder ve bu dala alınabilecek bir yeşil IAM düzeltmesi doğrulanmış değildir.

Ek tam komut, ortam, dosya SHA'ları ve çıktı `comparison.json` içindeki `latestMainRun` kaydında; [güncel main ham TAP logu](../performance-program/evidence/pricing-client-cost-20261107/iam-integration/latest-main-63159fb3-iam-reproduction.tap.gz) aynı pakettedir. İlk ek komut repo kökünde çalıştırıldığı için test yolunu bulamadı; bu kurulum hatası ayrıca kayıpsız saklandı ve IAM sonucu sayılmadı. Yukarıdaki 7 testin sonucu doğru `resources/app` çalışma dizinindeki düzeltilmiş komuta aittir.

## Beklenen / gözlenen

Tetikleyici, testin mevcut sentetik fixture'ıdır: credential içeren yerleşik yerel kullanıcı dizininden moderator alanı kaldırılır; geçerli kurtarma kopyası verilmez. Beklenti `IAM_LOCAL_INVALID` ile fail-closed davranışıdır. Gözlenen, assertion'a gelen `result.value.error` alanının `undefined` olmasıdır. Kök neden bu teslimde belirlenmiş veya giderilmiş sayılmaz; ana sunucu entegrasyonu sahibi gerçek `readStore()` / kurtarma yolunu incelemelidir.

Test dosyasının tamamı çalıştırılır. Filtre, skip/todo, assertion gevşetme veya dışarıdan IAM kapatma bayrağı kullanılmaz. `cold()` yardımcı fonksiyonunun mevcut local/central fixture ortamı iki kolda da aynen korunur; test içindeki local mode seçimi yeni bir bypass değildir.

## Komut ve ortam

Linux, Node `v24.19.0`, x64, AMD EPYC 9V74, CPU kotası 4. İzole `/tmp` fixture'ları; gerçek kullanıcı credential veya iş verisi yok. Taze karşılaştırmanın dış `BUYER_LOG_*` / `BUYERLOG_PROBE_*` ortam override'ları `comparison.json` içinde kaydedilir.

Main ve PR checkout'larının **her birinde**, `resources/app` çalışma dizininden aynı komut:

```bash
node --test --test-reporter=tap tests/local-iam-migration-authority.test.js
```

Main checkout: `/tmp/buyerlog-startup-pricing-baseline`; PR checkout: `/workspace/Buyer-Log-Desktop`. Tam komutun çözülen Node yolu ve çalışma dizini makine okunabilir kayıttadır.

Ham taze hata logları kayıpsız gzip olarak saklanır; sıkıştırılmış ve açılmış bayt SHA-256 değerleri karşılaştırma kaydındadır:

- [Main TAP](../performance-program/evidence/pricing-client-cost-20261107/iam-integration/main-iam-reproduction.tap.gz)
- [PR TAP](../performance-program/evidence/pricing-client-cost-20261107/iam-integration/pricing-pr-iam-reproduction.tap.gz)
- [Güncel main #902 TAP](../performance-program/evidence/pricing-client-cost-20261107/iam-integration/latest-main-63159fb3-iam-reproduction.tap.gz)

Önceki tekil hata logları ve tam paket hata bölümü kayıpsız `.gz` olarak aynı dizinde korunur. Açmak için `gzip -dc <dosya.gz>` kullanılabilir. Eski tam paket komutu:

```bash
BUYER_LOG_DATA_ROOT=/tmp/buyerlog-startup-pricing/tests/full-app npm test
```

Önceki komut 3. batch'te exit 1 ile durmuştur. Sonraki 4–10. batch'lerin ayrı tanısal tamamlanması ve toplam 8.641 pass / 1 fail / 65 skipped, **başarılı tek tam regresyon yerine geçmez**. Orijinal tam logun SHA-256 değeri ve hata bölümünün kayıpsız kopyası `comparison.json` ile ilişkilidir. Önceki kanıtlar silinmez/değiştirilmez.

## Ortak düzeltme sonrası zorunlu kabul kapısı

Ortak IAM engeli ana sunucu entegrasyonunda giderilip onaylı düzeltme #901 dalına alındıktan sonra, bütün sonuçlar **aynı son commit SHA** için yenilenmelidir. Mevcut main'de düzeltme bulunmadığından bu aşama henüz çalıştırılmış/başarılı sayılmaz.

1. Entegre son SHA'yı ve alınan IAM düzeltme SHA'sını kaydet; main ile çakışmaları düzeltmenin sahibine götür. Bu PR içinde yeni IAM üretim değişikliği üretme.
2. `resources/app` içinden `npm test -- pricing quotation open-costing local-iam-migration-authority` çalıştır; başarısız testi aynen dahil et.
3. **Filtresiz `npm test`** komutunu çalıştır. Koşucunun bütün batch'leri aynı committe başarılı tamamlanmalıdır. Bir batch durursa kapı kapalı kalır; kalan batch'leri ayrı çalıştırmak bunu yeşile çevirmez.
4. `npm run i18n:check` ve `npm run release:notes:validate` çalıştır.
5. Aynı son SHA için #901 PR kontrollerini yeniden doğrula. Fast checks, tam paket veya ayrı bir başarısız güvenlik/test kapısının yerine geçmez.
6. Komut, ortam, exit code, log ve son inceleme SHA'sını kaydet. PR taslak ve merge edilmemiş kalır; merge öncesinde dur. TEST/STABLE yayımlama.

Sonucu etkileyen kod değişirse ilgili testler, bütün tam regresyon batch'leri, i18n, release-note validator ve PR kontrolleri yeniden çalışır. Diğer CPR maddelerinin halen geçerli performans ölçümleri, sonuçları etkileyen bir değişiklik olmadıkça tekrarlanmaz.

## İnceleme durumu

Ölçülen üretim kodunun son özinceleme SHA'sı `ba3e165a70af78416eebab8ed599df7f379e4f6b` olarak korunur; bu takip teslimi yalnız kanıt/doküman ekler. Mevcut bağımsız ikinci agent/model incelemesi yoktur. GitHub'da review submission listesi de boştur. Doküman güncellemesinin son PR SHA'sı teslim mesajında ve PR başında ayrıca bildirilir; bağımsız inceleme yapılmış gibi gösterilmez.
