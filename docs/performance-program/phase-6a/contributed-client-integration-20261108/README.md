# Orders client contribution integration / İstemci katkısının entegrasyonu

Contribution `89a23a3b` was normally cherry-picked as `0d5ebb81` after the root's
source/profile and UI command gates. The inactive public module was not changed
and is not loaded/activated by the application yet.

First actual integrated package: **268 PASS / 1 FAIL**. The failure was a literal
whole-router SHA captured before root's ordinary-GET binding hook (`0d57b7b9`).
Both versions were checked against their real immutable Git source commits.
`fullParentHeaders`, `responseIdentityHeaders` and `planHashFor` are byte-exact;
the native current HTTP suite also exercises the new ordinary binding.

The live test now pins the exact current router SHA. The historical original
31 bodies remain frozen in the handoff. Their live algorithms/assertions are
byte-exact after replacing **one reviewed provenance SHA literal** back to its
original value; a test enforces exactly one occurrence and all other bytes.
This is an explicit integration delta, not a claim that the live file remains
unconditionally byte-exact to the old source pin. No behavioral assertion was
removed, skipped or weakened. A new assertion independently checks the old
router checksum and exact current full-parent producer functions.

**[Doğrulandı]** Son entegre paket: **270 PASS / 0 FAIL / 0 SKIP / 0 CANCEL**,
11 dosya. Kullanıcının bildirdiği eski schema pin uyuşmazlığı root'ta daha önce
native JSON presence modu incelenerek düzeltilmişti; bu pakette ilgili şema ve
ready-builder testleri de geçti. Başarısız ilk sonuç ve eski router deltası
kayıpsız/hash'li kanıt olarak korunuyor.

Contributor timings remain module-only evidence: accept ~349 ms includes
~250 ms separately sampled row validation; raw SHA ~81 ms; promotion ~1321 ms.
These are extra costs, not application gains. Root's parser ownership, actual
capture/QFG closure, configuration/SSE writers, loader/controller/lazy binding,
macro measurements, final full regression and one independent P1 review remain
open. Phase 6a is not complete. No PR/merge/TEST/STABLE here.
