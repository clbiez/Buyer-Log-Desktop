# DS-08 — Main #916/#917 kabulü / acceptance

TR: Main `1796193f` normal merge ile alındı. Dört üretim ve iki test blob'u
önceki inceleme/kapanış kaydındaki `84c4535d` ile birebir aynı. Yeni worker yok.
Standart `npm test`, varsayılan concurrency=4 ve izole TMPDIR ile tek çalıştırmada
bütün 10 batch: **8942 PASS / 0 FAIL / 65 mevcut SKIP / 0 CANCEL**.
İlgili paket **226 PASS**, i18n **0/0**, sürüm notları **51 PASS**. Main'in 50 kaydı
ve bu dalın bir TR/EN görsel kaydı korunur. NODE_OPTIONS/runner override yok.
Sonraki commit yalnız kanıtları arşivler; üretim/test kodu değişmez. Son SHA'nın
CI'ı ayrıca beklenir. P1 merge öncesinde durulur; TEST/STABLE yapılmadı.

Tarihsel üç çift: gap319,655→47,562 ms; checkpoint374,920→404,012 ms (**+%7,76**);
RSS273,508→289,195 MiB. Özgün kaynak SHA'sıyla korunur; yeni Main, gerçek sunucu
health p95 veya bütün iş yüklerinde200ms sınırı sağlandı denmez. Pool/budget
reddinde eski kapasiteyi koruyan fallback eski stall'ı da koruyabilir. Veri
formatı, lease, revision, WAL doğrulama ve dayanıklılık koşulları değişmedi.

EN: Main `1796193f` was normally merged. All four production and two test blobs
exactly match prior review/acceptance at `84c4535d`. No new worker mechanism.
The unchanged standard runner completed all ten batches in one invocation at
default concurrency=4 with private TMPDIR: **8942 PASS / 0 FAIL / 65
existing SKIP / 0 CANCEL**. Related **226 PASS**, i18n **0/0**, visual notes
**51 PASS**, preserving 50 Main entries and only this branch's bilingual note.
The next commit archives evidence only. Actual final-head CI is separate. Stop
before P1 merge; no TEST/STABLE publication.

Historical three-pair event-loop gap319.655→47.562 ms trades checkpoint
374.920→404.012 ms (**+7.76%**) and RSS273.508→289.195 MiB. These retain their
original SHA and warm-pool synthetic local scope. They do not prove current-Main
health p95 or a universal200ms bound. Capacity-preserving fallback can retain
old stalls. Data format, lease/revision/WAL validation and durability remain.
