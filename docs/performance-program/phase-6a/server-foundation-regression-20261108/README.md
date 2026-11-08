# Server foundation regression checkpoint / Sunucu temel regresyon kontrolü

**[Doğrulandı]** `0d57b7b9493e447ff20accbe45a54dd4243c4cbe` üzerinde
standart `npm test`, ilk batch'te **1752 PASS / 1 FAIL / 60 SKIP** ile durdu.
Kalan dokuz batch çalışmadı. Eski tam başarı bu kodun sonucu değildir.

`compute-bulk-projection-wiring.test.js` içindeki katalog test double'ı,
gerçek `buildAndWriteComputedPageProjectionCache` çağrısının kullandığı
`prepareModuleSchemas` bağımlılığını vermiyordu. Üretim factory'si bu metodu
gerçek cache modülünden alıyor. Fixture aynı gerçek export'u kullanacak şekilde
tamamlandı; assertion, guard veya üretim davranışı değiştirilmedi.
Önceki 341 testlik filtre bu test dosyasını kapsamıyordu.

**[Verified]** The default full run stopped in batch 1 with the counts above;
the remaining nine batches did not run. The fixture now injects the real
`prepareModuleSchemas` export instead of omitting that production dependency.
Existing assertions and production code are unchanged. The previous targeted
filter omitted this bulk-refresh wiring test.

Targeted command / Hedefli komut:

```text
npm test -- compute-bulk-projection-wiring module-schema projection-schema-output
```

**58 PASS / 0 FAIL / 0 SKIP / 0 CANCEL** on the corrected fixture. This targeted
result does not replace the required new default full run. Original failing
output and the passing targeted output are retained with SHA-256 hashes in
`evidence-index.json`. Public thin loading remains disabled. No PR, merge,
TEST or STABLE publication is claimed by this checkpoint.

## Subsequent provider fixture failures / Sonraki sağlayıcı fixture hataları

The next default run at `7cb50613` passed batches 1–2, then stopped in batch 3:
**6365 PASS / 2 FAIL / 63 SKIP** across the three executed batches. Batches
4–10 did not run. Both failures are preserved separately:

- `lcwai-dynamic-columns`: the extracted real Orders table wrapper could not
  find `_ordersRequireFullSynchronousRead`. The fixture now executes the real
  private guard and its actual dependencies. A new case verifies that this
  context throws `ORDERS_FULL_REQUIRED` for thin Orders and preserves CP.
- `orders-profile-barriers`: the protected original object predates the reviewed
  counts-only `tableSummary` addition. Its frozen original is unchanged. The
  equality assertion now requires the exact existing summary patch applied to
  that original, plus exact reverse-removal equality; all old methods remain
  byte-exact. No arbitrary source drift is accepted.

**[Doğrulandı]** İki test uyarlaması üretim kodunu veya önceki assertion'ların
koruduğu davranışı değiştirmiyor. Kaynak eşitliği yalnız ayrı testlerde doğrulanmış
sayım adaptörünün tam metnine izin veriyor. Hedefli dört dosya **94 PASS**, sıfır
hata/atlama/iptal. Tam paket sonucu hâlâ yukarıdaki başarısız koşudur; yeni tam
koşu tamamlanmadan başarı iddia edilmiyor.
