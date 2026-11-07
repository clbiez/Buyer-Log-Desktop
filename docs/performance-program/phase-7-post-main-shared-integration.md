# Phase 7 shared evidence — current Main integration

## TR

Ortak kanıt/araç PR'ı #913, Main `5b8c1e6f` (#912/#901/#914 dahil) ile
**normal merge** `7a3c15c9` üzerinden güncellendi. Rebase/force-push yapılmadı.
Main'e karşı üretim `public/**` ve `server/**` farkı sıfır; yalnız ortak
rapor/kanıt, üç tanı/benchmark/preload script'i ve mevcut fast workflow'un
`perf/phase7-shared-evidence` hedefi vardır. Main'in yeni lazy-style,
CP/Orders/katalog/native profiler CI adımları korunur. Bu paket runtime worker
önkoşulu değildir; #909/#910/#911'in ortak kanıtlarını tek yerde tutar.

Özgün gpt-6-astra inceleme kaydı ve P1 capacity/fallback kapanışı korunur.
Önceki kaynak ile final yaprak head'leri arasındaki dokuz üretim ve altı test/
yardımcı blob eşitliği ayrı devirde doğrulandı. Yeni genel inceleme yapılmadı.
Eski tam koşular `NODE_OPTIONS` ile sentetik test-env preload'u kullanmıştır;
bu kayıtlar değiştirilmez ve preloadsuz güncel standart tam kabul sayılmaz.

Durumlar: DS-08, INT-04/05 ve INT-11 **uygulandı; son entegrasyon/kabul
bekliyor**. DS-11 gerçek SMB/RTT ve INT-07 gerçek PLM ortamı olmadığından
**ölçülemedi, açık**. INT-10 upstream kapasite ve ADMIN-02 güvenli I/O kazancı
kanıtlanmadığından **açık**; tamamlandı veya maliyetsiz olduğu için atlandı
sayılmaz. DS-08 kabulünde gap 320→48 ms ile checkpoint +%7,76 ve RSS artışı
birlikte değerlendirilir; fallback eski ana-thread maliyetini korur.

Üç yaprak PR ortak base merge edilene kadar mevcut hedeflerini korur. Sonrasında
Main hedefi ve son kaynak/CI kontrolleri tek tek doğrulanır. Aynı kaynaklara yeni
paralel PR veya worker mekanizması eklenmez. Gerekli son standart tam regresyon,
i18n, release-note ve gerçek final-head CI sonuçları bu dosyanın kabul ekine
kaydedilir. Önceki yeşil sonuç yeni SHA'ya taşınmaz.
**Merge onayı beklenir; TEST ve STABLE yayımlanmaz.**

## EN

Shared evidence PR #913 now includes Main `5b8c1e6f` via normal merge `7a3c15c9`.
No production client/server delta exists against Main. This package contains
shared records/tools and the additional existing workflow target, preserving all
new Main CI steps. It is not a runtime-worker prerequisite. Historical reviewed
runtime/test blobs remain exact; no new general review was performed.

Historical full runs used the synthetic `NODE_OPTIONS` test-env preload. They
remain evidence for their original environment, not current unpreloaded standard
acceptance. DS-08, INT-04/05 and INT-11 are implemented but await integration and
acceptance. DS-11 (real SMB/RTT), INT-07 (real PLM), INT-10 (capacity) and ADMIN-02
(safe I/O benefit) remain open, not measured-zero-cost skips. DS-08's lower loop
gap must be considered alongside +7.76% checkpoint time, increased RSS, and the
old main-thread cost on fallback. Final checks and merge approval remain separate.
**No TEST/STABLE publication.**


## Son standart kabul / final standard acceptance

Kaynak `7a3c15c9`, uygulama ağacı `ebd48562a62b11b5ad6d807a1c3bd3dc7bf444da`.
Üç yeni script `node --check` PASS. İlgili `npm test -- compute local-db
startup-benchmark` **227 PASS**. Standart filtresiz `npm test`, bütün 10 batch
tek çağrıda, varsayılan concurrency4 ve private TMPDIR, **NODE_OPTIONS/preload
olmadan: 1.294 dosya / 8.879 PASS / 0 FAIL / 65 mevcut SKIP / 0 CANCEL**.
i18n **0/0**, release notes **42 PASS**. Bu son ek yalnız dokümandır; kaynak,
testler, validator ve CI ağacı değişmedi. Gerçek final-head GitHub checks
ayrıca beklenir; önceki head'in CI'ı yeni SHA'ya taşınmaz.

Three scripts passed syntax validation; related package 227 PASS. The unchanged
standard full runner passed **all ten batches in one invocation**, default
concurrency4, private TMPDIR and no NODE_OPTIONS/test-env preload:
**1,294 files / 8,879 PASS / 0 FAIL / 65 existing SKIP / 0 CANCEL**.
i18n 0/0; 42 notes passed. Production/test/CI sources remain unchanged after
this evidence-only addition. Final-head actual GitHub checks remain required.
This accepts the common records/tools package only, not the runtime leaf PRs.
**No merge, TEST or STABLE.**


## #915 sonrası son kabul / Final acceptance after #915

8 Kasım 2026: Main `d77f83e5` (#915, kullanıcı onayıyla merge edildi)
normal merge `ff047b73` ile alındı. Test edilen uygulama ağacı
`01a6437e12dccd15bb0df365e9d7a279f8aa49a5`. Standart `npm test`, tek çağrıda bütün
10 batch, varsayılan concurrency=4, izole TMPDIR ve NODE_OPTIONS/preload
olmadan: **1295 dosya / 8896 PASS / 0 FAIL / 65 mevcut SKIP /
0 CANCEL**. İlgili paket **227 PASS**, i18n **0/0**, sürüm notları
**43 PASS**. Tarihsel sonuçlar korunur; bu kayıt yeni performans
kazancı iddiası değildir. Son commit'in gerçek GitHub kontrolleri ayrı kapıdır.

Main `d77f83e5` was imported by normal merge without rewriting the frozen review
history. The unchanged standard runner passed all ten batches in one invocation:
**1295 files / 8896 PASS / 0 FAIL / 65 existing SKIP / 0 CANCEL**,
default concurrency4, private TMPDIR, no NODE_OPTIONS/preload. Related package
227 PASS; i18n0/0; 43 visual notes valid. Own production changes
and their reviewed behavior were preserved; the new runtime delta imports the
separately reviewed and merged current-authority fix. Evidence-only additions
after these checks do not change source, tests, validators or CI. Historical
benchmark limitations remain. Actual final-head CI and merge approval are still
separate. **No TEST/STABLE publication.**
