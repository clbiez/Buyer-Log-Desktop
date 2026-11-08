# Foundation regression a31f8360 / Temel regresyon teşhisi

8 Kasım 2026. Üretim kodu değiştirilmeden test fixture/source uyumu tamamlandı.

Standart `npm test`, default concurrency=4 ile ilk batch'te **1.753 PASS /
1 FAIL / 60 SKIP** verdi. Aynı değişmemiş kodda kalan 2–10 batch, gerçek runner'ın
aynı planı/komutlarıyla tanı amacıyla tamamlandı. Birleşik tanı toplamı **9.614
PASS / 24 FAIL / 65 SKIP / 0 CANCEL**; bu bir geçen standart tam koşu değildir.
Kod/testler tanı sırasında değişmedi. İlk kırmızı koşu ve kalan batch logları
ham SHA'larıyla korunur; `failures.json` 24 gerçek test konumunu sınıflandırır.

- 19 VM fixture hatası: gerçek `ensureOrdersFullForAction` yeni gerçek lifecycle
  değişkenlerini kullanıyor, ancak dört eski fixture bunları yüklemiyordu.
  Aynı actual `installLifecycle` bağlandı; gölgeleyen üç controller declaration'ı
  kaldırıldı. Manufacturers'ın gerçek supplied controller map'i korunur. Bütün
  eski test/production snippet/assertion gövdeleri aynı; exact reverse proof var.
- 4 kaynak testi: 1.400/1.350/900/500 karakterlik eski pencereler, eklenen source
  korumaları yüzünden mevcut refresh/hydration satırlarına ulaşmıyordu. Arbitrary
  pencere yerine aynı gerçek `loadFromServer` robust function extractor ile
  okunuyor. Regex, sıralama, kayıp-veri ve tercih assertion'ları aynı.
- 1 schema runtime app pin'i: eski ad985 app blob'u bekleniyordu. Gerçek model
  registration ifadesi ve üç ilgili model-column fonksiyonu byte olarak aynı;
  diğer runtime/schema lineage pinleri aynı. Önceki pin ve exact karşılaştırma
  `schema-app-source-proof.json` içinde; yalnız gözden geçirilmiş live app blob'u
  güncellendi.

İlgili 9 dosyada **111 PASS / 0 FAIL / 0 SKIP / 0 CANCEL**. i18n **0/0**,
50 release note geçerli. Bu adımda üretim davranışı/test timeout/validator
değişmedi. Sonraki standart tam koşu baştan yapılmalı; bu hedefli GREEN onu
başarılı saydırmaz. Thin activation, Phase 6a kabulü, gerçek UI/30k/CP ölçümleri
ve P1 incelemesi hâlâ bekliyor. Merge veya TEST/STABLE yayını yok.

EN: Default full regression stopped in batch1 on an outdated reviewed app pin.
Remaining unchanged runner batches were executed diagnostically: combined
9,614 pass/24 fail/65 skip. Nineteen failures were missing actual lifecycle
dependencies in four extracted VM fixtures; four were truncated source windows;
one was the live app pin. Production behavior, every existing assertion and
all timeouts remain unchanged. Exact reverse/source proofs and all red logs are
retained. Nine targeted files now pass all 111 tests; i18n0/0 and50 notes validate.
A fresh complete default invocation is still required. No acceptance or release
is inferred from the diagnostic combined run.
