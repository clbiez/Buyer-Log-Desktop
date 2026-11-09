## Değişen davranış / Result

Somut sorun, sonuç ve dar kapsam / Concrete problem, resulting behavior and scope.

## Doğrulama / Validation

Hedefli testler; gerekiyorsa standart tam regresyon; i18n/not/PNG; son SHA CI.
Gerçek PASS/FAIL/SKIP/CANCEL ve ölçülmeyen sınırlar / Actual results and limits.

## Performans kabulü / Performance acceptance

<!-- CLAUDE.md §3.2 and docs/PERFORMANCE_ACCEPTANCE.md apply to every change.
     Record budgets before implementation; do not invent results or loosen gates.
     For runtime changes fill the fields below. For runtime-neutral changes use
     N/A and list the changed files and why product runtime cost is unaffected. -->

- Karar / Decision: PASS | FAIL | BLOCKED | N/A
- Taban Main SHA / final kaynak SHA / Base Main and final source:
- Kullanıcı senaryosu, veri/hash, ortam/runtime / Scenario, fixture, environment:
- Önceden belirlenen bütçeler / Budgets set before implementation:
- Önce → sonra; tekrar/medyan/tail/gürültü / Before → after and sampling:
- Başlangıç/ilk kullanım/komşu akış, CPU/bellek/ağ ve cleanup / Affected gates:
- Veri/çıktı eşdeğerliği / Data and output parity:
- Komut ve ham kanıt bağlantısı / Commands and raw evidence:
- N/A gerekçesi veya kalan kapı/platform sınırı / N/A reason or open limits:

## Yayın / Release

Main merge, TEST ve STABLE ayrı durumlar / Report each separately.
