# #908 — #916/#917 sonrası kabul / Acceptance after #916/#917

**BLOKLU / BLOCKED. Merge yapılmadı. / Not merged.**

Son runtime head `b9545261`; baz Main `1796193f` (#916 ve #917 iki kolda da var).
Standart `npm test`, tek çalıştırmada bütün 10 batch: **8.935 PASS / 0 FAIL /
65 mevcut SKIP / 0 CANCEL**, 1.302 dosya. İlgili 137 test, korunan CP hızlı paketinin
23 testi, i18n 0/0 ve 51 sürüm notu geçti. Bu yerel kabul yeni GitHub head CI'ı
veya performans kabulü yerine geçmez; mevcut uzak PR head'i henüz güncellenmedi.

## Üç bağımsız çift / Three independent pairs

Unmodified `benchmark-first-transitions.js`, common V2 helper, fresh server/browser
per arm, A/B–B/A–A/B. Linux 4-vCPU quota, Node 24.19, Chromium154,
Europe/Istanbul. Synthetic seed7 30k, CP24,982 / Orders30,000.
Only the post-timing observer records schema/full-row hashes; no refresh POST.

| Ölçüm / Metric | A median, sec | B median, sec | Per-pair change |
| --- | ---: | ---: | --- |
| CP usable first intent | 44.721 | 23.224 | −48.07% / −58.19% / **+30.28%** |
| Orders usable first intent | 10.542 | 11.407 | **+4.60% / +52.76% / +8.21%** |
| CP first unobscured rows | 38.630 | 20.532 | raw values retained |
| Orders first unobscured rows | 7.662 | 8.677 | raw values retained |

[Doğrulandı / Confirmed] CP median improves, but its third pair worsens. Orders
median increases8.21%, with all three pairs worse. Do not accept that regression
through the CP improvement or call every run faster. No new product tradeoff is
automatically approved. Narrow trace diagnosis remains open; no new optimization
has been added to this frozen scope.

[Bilinmiyor / Unknown] Root cause. The CLI opens CP then a fresh Orders context
on one server per arm; different preceding CP duration may alter server age or
background work. This is a hypothesis, not grounds to discard the Orders data.
A derived fresh-server, single-Orders trace is being prepared separately and
will not replace the official first-CP cohort or be presented as a gain.

All complete normalized CP/Orders JSON row hashes match in all six runs;
serialized own-key order and first visible50-row full text snapshots are retained.
Same-code controls had already shown two Orders schemas (53/60 cells). Before
this cohort both complete baseline variants were explicitly declared; no actual
output was sorted or truncated. Every observed variant matches its complete
baseline text/hash. Exact headers identify the seven extra columns as copied
`__checklist__*` CP columns, each with dash values. Full initial DOM equality
between the different variants is **not claimed**. This preexisting timing issue
is recorded for the own-module lifecycle work; it was not silently fixed here.

The main CLI and all #916 protected code/tests/fast-step remain unchanged.
There is no TEST or STABLE publication. Historical failed cohorts and V1 helper
results stay under their original revisions and are not relabeled as acceptance.


## Güncel dar tanı / Latest narrow diagnostic

Yeni sunuculu tek Orders profilli A/B 11,621→6,869 sn çıktı; bu tek tanı resmî üç çiftlik Orders gerilemesini kapatmaz. / Fresh-server profiled first-Orders A/B was 11.621→6.869 s; one diagnostic does not close the formal three-pair regression. See orders-trace/assessment-tr-en.md.
