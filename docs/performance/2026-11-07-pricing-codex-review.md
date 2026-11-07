# #901 — tek bağımsız Codex inceleme paketi

**Durum: paket hazır; bağımsız inceleme henüz yapılmadı.** Özinceleme bağımsız onay sayılmaz. Bu paket Claude'a veya başka bir üretim düzeltmesine bağımlı değildir. Yeni optimizasyon, ikinci PR, merge, TEST veya STABLE yetkisi vermez.

## Dondurulmuş kapsam

- PR: [clbiez/Buyer-Log-Desktop#901](https://github.com/clbiez/Buyer-Log-Desktop/pull/901), dal `perf/pricing-costing-cpr-05-06-07-12`.
- Korunan önceki head: `2f15610f840aadb3c90c1f866564eb7ac405987c`.
- Entegre Main: `63159fb32ff3d5bdc5f142b4a8f16ca6a3983240`.
- Yerel kontrollerde dondurulmuş kaynak/test/sürüm-notu commit'i: `30f5315474fc898bec99e2630a0cd4c378b39eb0`. İki ebeveyni sırasıyla korunan head ve Main'dir; normal merge, rebase/force-push yoktur.
- Bundan sonraki commit yalnız bu PR'ın belge/kanıtlarıdır. PR'ın güncel head'ini ve `resources/app` Git tree'sinin test edilen commit ile eşitliğini doğrula. Son head'in gerçek GitHub check sonucunu [PR üzerinden](https://github.com/clbiez/Buyer-Log-Desktop/pull/901/checks) ayrıca değerlendir; eski yeşil koşuyu kullanma.

Repo kökünden incelenecek nihai diff:

```bash
git diff 63159fb32ff3d5bdc5f142b4a8f16ca6a3983240...HEAD -- resources/app
git rev-parse HEAD:resources/app 30f5315474fc898bec99e2630a0cd4c378b39eb0:resources/app
git diff 2f15610f840aadb3c90c1f866564eb7ac405987c..HEAD -- resources/app/public/quotations.js resources/app/public/pricing-desk.js resources/app/public/pricing-desk-engine.js resources/app/public/pricing-workspace-engine.js resources/app/public/open-costing.js resources/app/public/open-costing-engine.js
```

Son komut boş olmalıdır. Dondurulmuş üretim/test/not diff'inin kayıpsız kopyası: [production-test-notes.patch.gz](../performance-program/evidence/pricing-client-cost-20261107/acceptance/production-test-notes.patch.gz). Bütün repo diff'ini GitHub'da da kontrol et; kanıt arşivlerinin eklenmesini üretim değişikliği sayma.

## İncelenecek sözleşmeler

1. **CPR-05 / owner sınırı (P1):** `quotations.js` içindeki `qWithCollectionRead`, `qResolveRowsForOwner`, `qFindCollectionRow`, `qCollectionEffectiveValue` ve Fiyat Masası çağrıları. Aynı rowId'li iki buyer, multi/single/shared/cached owner, ilk eşleşme, legacy orderCode ve grouped parent/override değerleri önceki davranışı koruyor mu? İndeks yalnız senkron işlem boyunca mı yaşar; exception ve sonraki owner/revision/yerel değişimde eski scope kalır mı? Canonical alan okuyucusu kullanılıyor mu?
2. **CPR-06 / hesap doğruluğu (P1):** `pricing-desk-engine.js::supplierScorecards` genel analizle aynı model kapsamı, tied wins, approved, modelIndex, sparse/duplicate/dropped/normalize edilmiş hücre sonuçlarını veriyor mu? 40 seed'li parity testi ve tarihsel çıktı hash'lerini kontrol et. `pricing-desk.js::refreshModelRowContent` yalnız değişen model matrisini hazırlarken best/approved/outlier/target/undo/negotiation davranışını koruyor mu? Üretici özeti hâlâ tüm talebi tarar; sabit maliyetli artımlı hesap iddiası yoktur.
3. **CPR-06 açık kapsam:** Büyük ilk DOM çiziminin satır/sütun pencerelemesi uygulanmadı. 1k × 20 ilk açılış sayısı yalnız motor hazırlığıdır. Tam DOM açılışı, yeni scroll/sticky/klavye kabulü veya tüm CPR-06'nın kapanması olarak sunulmamalı.
4. **CPR-07 / düzenleme güvenliği:** Arama yalnız nav'ı yenilerken aktif detay, fiyat input'u/değeri ve commit yolu korunuyor mu? Status istatistikleri bir nav çiziminde paylaşılır ve işlem sonunda bırakılır mı? `pricing-workspace-engine.js::requestMatchesFilter` tüm mevcut filtreleri koruyor mu? Debounce veya kalıcı search-cache uygulanmış gibi yazılmamalı. Tarihsel gerçek tarayıcı kanıtında üç sorgu sonrası mutation=0 ve editorRetained=true.
5. **CPR-12 / FX ve toplamlar (P1):** `open-costing.js` input/focusout değişen satırı taşır; aynı FX snapshot'ı saf motor, satır tutarı, alternatif döviz ve rozetle paylaşılır. Currency/month/rate değişimleri tam yenilemeye devam eder mi? Sayısal motor ve roundHalfUp değiştirilmedi mi? Değişen bölümün tüketimi ve bütün özet toplamları doğru mu? Finansal sonucu artımlı kayan nokta toplamayla değiştiren yol olmamalı.
6. **Test kapısı ve ortam:** [Güncel kabul raporu](2026-11-07-pricing-main-acceptance.md), [komut/ortam/batch sonuçları](../performance-program/evidence/pricing-client-cost-20261107/acceptance/results.json) ve ham stdout/stderr arşivlerini karşılaştır. Standart `npm test` bütün batch'leri tek çağrıda bitirmeli; ayrı devam başarılı tam paket sayılmaz. Assertion, validator, timeout, skip ve i18n baseline gevşetilmedi. Yalnız özel TMPDIR kullanılır; global app/local/server/auth/temp-root veya NODE_OPTIONS override'ı yoktur. İlk sandbox varsayılan-yol hatası ayrı kırmızı kanıttır; gizlenmez. Varsayılan recovery-root testini bozan LOCAL override eklenmedi.
7. **Kanıtların geçerliliği:** [Koruma manifesti](../performance-program/evidence/pricing-client-cost-20261107/acceptance/preservation.json) altı ölçülen kaynak hash'ini, aynı fixture'ı, iki gerçek demo PNG'yi ve önceki kanıtları bağlar. CPR-05'in temiz A/B–B/A–A/B turu korunur; eski örtüşen tur onunla karıştırılmaz. Kod yolu değişmediği için yeni benchmark yoktur; eski süreler yeni Main açılış ölçümü diye etiketlenmez.
8. **Sahiplik ve release notları:** Main'in 38 ve önceki head'in 34 not nesnesi korunur; birleşim 40'tır. İki kendi TR/EN notu ve gerçek post-change PNG'ler aynı kalır. Server ağacı, app-main.js, index.html, perf-runtime.js, CSS, model-image-cache.js, canonical alanlar, runner, i18n guard/baseline ve #906/#908 kodu Main ile eşittir. Ortak next.json dışında bu PR'larla dosya çakışması yoktur. Motion+ ve reduced-motion sözleşmeleri değiştirilmez.

P1/P2 bulgu varsa dosya/satır veya sembol, somut bozulan davranış, tekrarlanabilir girdi ve en küçük öneriyi bildir. Bilinen açık kapsamı yeni regresyon diye sınıflandırma; kanıtlanmamış runtime davranışını onaylama. Son inceleme SHA'sını ve kalan belirsizlikleri açıkça yaz. Gerekli doğrulama/bağımsız inceleme tamamlanmadan merge yoktur; TEST/STABLE yayımlanmaz.
