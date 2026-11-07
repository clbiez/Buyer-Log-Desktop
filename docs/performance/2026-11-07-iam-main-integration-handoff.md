# #901 — ortak IAM engeli / ana sunucu entegrasyonu teslimi

**Durum: BLOKE.** `local-iam-migration-authority.test.js:18` başarısızlığı main üzerinde de vardır. Bu bulgu tam regresyon şartını kaldırmaz. #901 taslak ve merge edilmemiş kalır; TEST/STABLE yayını yapılmaz. Bu teslimde IAM/kimlik doğrulama üretim kodu, test, assertion veya IAM davranışı değiştirilmez.

## Karşılaştırılan kaynaklar

- Main: `2083ffd73ba026067d92ccf257c4551afa2e5f00`.
- #901 ölçülen üretim kodu: `ba3e165a70af78416eebab8ed599df7f379e4f6b`.
- Her iki committe `resources/app/server` Git tree SHA: `7df589bc1168069d02fd5ee25d16d70abf13a3c6`.
- Her iki committe test Git blob SHA: `46bb902c46b58fabbe7a42f3bfe0368d281a4ed4`.
- Taze karşılaştırmanın commitleri, komutları, çalışma dizinleri, ortamı ve ilgili dosyaların Git/SHA-256 değerleri: [`comparison.json`](../performance-program/evidence/pricing-client-cost-20261107/iam-integration/comparison.json).

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
