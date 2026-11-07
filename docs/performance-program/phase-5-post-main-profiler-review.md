# Tek bağımsız delta incelemesi — Codex

**Tamamlandı.** Bağımsız ikinci model `gpt-6-astra`, `1f1f155d273c872641c9dedc15ae262c2e1652a0` üzerinde tek salt okunur delta incelemesini tamamladı; raporlanabilir P1/P2 bulgu saptamadı. Aşağıdaki özgün inceleme kapsamı korunur. Merge / TEST / STABLE yetkisi verilmedi.

Baz Main: **63159fb32ff3d5bdc5f142b4a8f16ca6a3983240**. Normal yerel entegrasyon: **47fa7850**. Test edilen kaynak/test/CI head'i: **23519cedb9a0d601d6ee00a5d989a1179c56436d**. Bundan sonraki teslim commit'i yalnız belge/kanıttır; bu kaynak ağacıyla eşitliği doğrulanır. `git diff 63159fb3..23519ced -- resources/app .github/workflows/buyerlog-pr-fast-checks.yml` somut deltadır. Donmuş #885 inceleme SHA'sı 69950f28 değiştirilmedi.

İncelenecek dar sözleşmeler:

1. `app-main.js` içindeki yalnız iki Orders hydration invalidation çağrısının `['orders']` alması: #892 `_cpDecisionInputRevision` getter'ı, kişisel bağlam istisnası ve tablo revizyon/cache temizliği korunuyor mu? CP hydration ve transit kuralı invalidation'ı sürüyor mu? CP/Orders test/fixture teslimi 7bf0cfd4 ile byte eşit mi?
2. Üretim profiler dosyaları ve bütün sunucu ağacı Main ile byte eşit. Main'deki 0f106b2b 50 ms mitigation'ı tekrar uygulanmıyor. İlk yedi test verbatim, ek native regression 24 child × 4 oturum, en çok 4 eşzamanlı child ile gerçek clean-exit/signal/stderr/completion kontrolü yapıyor mu? Eski kodda aynı test byte'larının SIGABRT ile RED, Main'de GREEN kanıtı yeterli mi? Bu bir zaman mitigation'ıdır; formel teardown handshake'i olduğu iddia edilmiyor.
3. Recovery fixture'ı yalnız varsayılan kök vakasında kalıtılan `BUYER_LOG_LOCAL_DATA_ROOT`'u kaldırır. Açık override ve ilgisiz yazma reddi ayrıca doğrulanır; üretim güvenlik kodu değiştirilmemiştir. No-op guard, yutulmuş hata, skip veya gevşetilmiş timeout/assertion var mı?
4. Main'in bağımsız kaynak-test uyarlamaları yeniden taşınmadı. Yeni native katalog/Backlog/projection testleri gerçek kaynak/hedef/Horizon/Buyer/generation/yetki/byte eşdeğerliğini doğruluyor mu? Mevcut Main assertion'ları korunuyor mu?
5. Eski kırmızı 8829/14 ve 8857/1 toplamları korunuyor. Asıl eski olayın signal/stack'i bilinmiyor diye açıkça yazılmış; yeni native stack eski loga retroaktif atanmıyor. Aynı 300 dosya/concurrency4/env ile Main batch4 PASS ve filtresiz bütün 10 batch'in 8865 PASS / 0 FAIL / 65 SKIP / 0 CANCEL sonucu gerçek arşivlerle tutarlı mı?
6. i18n 0/0 ve 39 release note doğrulaması; Main'in 38 ve eski yerelin 39 kayıt nesnesi eşitliği; gerçek post-change PNG/app-main SHA eşitliği ve görsel inceleme. index.html/perf-runtime/CSS/canonical/runner değişmedi. Açık PR #901/#904/#906/#908 ile ortak next.json yalnız ekleme olarak korunmalı.

Kaynaklar: [rapor](phase-5-post-main-profiler.md), [main/yerel envanter](phase-5-post-main-profiler-artifacts/main-local-inventory.json), [ham batch sonuçları](phase-5-post-main-profiler-artifacts/full-batch-results.json), [SHA/üye manifesti](phase-5-post-main-profiler-artifacts/manifest.json). Native stack, her child stderr/signal, eski batch tekrarları ve yeni standart tam koşu ayrı arşivlerdedir.

P1/P2 bulgu varsa dosya/sembol, bozulan sözleşme, tekrarlanabilir RED ve en küçük öneriyi bildir. İncelenmeyen geçmiş deltayı veya tarihsel B1/FX ölçümlerini bu dar incelemeyle yeni performans kabulü sayma. Üretim/test değişikliği gerekirse ilgili ve tam kontroller yenilenmeden merge yok.

## Bağımsız inceleme sonucu — 07.11.2026

- **Reviewer:** ayrı `gpt-6-astra` modeli; tek genel tur, salt okunur.
- **Donmuş head:** `1f1f155d273c872641c9dedc15ae262c2e1652a0`; baz `63159fb32ff3d5bdc5f142b4a8f16ca6a3983240`.
- **Sonuç:** raporlanabilir P1/P2 bulgu yok. Üretim deltası yalnız iki Orders hydration invalidation çağrısının `['orders']` kapsamını almasıdır; sunucu üretim dosyaları Main ile aynıdır.
- Tam `loadFromServer`, `ensureOrdersLoaded`, revizyon getter'ı ve invalidation gövdesi incelendi. Orders-only yol CP input revision/cache'ini korurken Orders revision/cache ve Global Flow bildirimi sürer. Gerçek CP hydration ve transit kuralı değişiklikleri bağımsız CP invalidation'ını sürdürür. Loader'ın hiçbir koşulda CP revizyonunu değiştirmediği iddia edilmez.
- CP test/fixture teslimi `7bf0cfd4` ile byte eşit. Profiler'ın ilk yedi testi korunur; ek native regresyon gerçek child close/exit code/signal/stderr/tamamlanma işaretini denetler. Varsayılan recovery fixture'ı, açık override ve izin dışı yazma reddi ayrımını korur. Kaynak incelemesinde assertion/timeout/skip veya güvenlik gevşetmesi görülmedi.
- Reviewer, GitHub CI `42402537693` için **32/32 başarılı adımı** ve `23519ced` → inceleme head'i karşılaştırmasında yalnız belge/kanıt eklendiğini doğruladı.

**Kanıt sınırları:** Reviewer test/benchmark yeniden çalıştırmadı; sıkıştırılmış ham log üyelerini yeniden açıp hash doğrulamadı ve PNG'yi bağımsız görsel incelemedi. Raporlanan 452 ve 8.865 PASS, eski kodda 4/24 SIGABRT, Main'de 24/24 PASS, i18n 0/0 ve 39 sürüm notu sonuçları erişilen rapor/manifest/sonuç kayıtlarıyla tutarlıdır. Orijinal tam-suite olayının kesin sinyali bilinmiyor olarak kalır; sonraki native stack o olaya geriye dönük atanmaz. Main'in 50 ms beklemesi mitigation'dır; formal teardown handshake'i değildir.

**IAM koordinasyonu:** Aynı üretim SHA'sında özel `TMPDIR` ile sentetik sibling-recovery adaylarının 2→0 ve IAM paketinin 7/7 PASS olması, bu çevresel test hatası için yeni üretim IAM düzeltme SHA'sı gerektirmez. Ayrı ADMIN-03 stale `req.currentUser` güvenlik bulguları bu sonuçla kapanmaz.

EN: One independent read-only review by `gpt-6-astra` completed on the frozen head above, with no reportable P1/P2 findings. Source scope, complete loader/invalidation flow, preserved regressions, fixture isolation and all 32 CI steps were checked. Tests/benchmarks, compressed raw-log hashes and screenshots were not independently rerun or revalidated. This is neither new performance acceptance nor merge/publication authorization.

Bu kapanış kaydı yalnız dokümantasyon değişikliğidir; incelenen kaynak/test/CI ağacı değişmez. Merge kararı kullanıcıda bekler. TEST ve STABLE yayımlanmadı.
