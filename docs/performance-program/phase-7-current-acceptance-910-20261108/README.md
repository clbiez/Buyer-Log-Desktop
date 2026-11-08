# INT-04/05 — Main #916/#917 kabulü / acceptance

TR: Main `1796193f` normal merge ile alındı. İki üretim ve üç test/helper blob'u
önceki bağımsız incelemedeki `845f10b0` ile birebir aynı. Yeni worker yok.
Standart `npm test`, varsayılan concurrency=4 ve izole TMPDIR ile tek çalıştırmada
bütün 10 batch: **8945 PASS / 0 FAIL / 65 mevcut SKIP / 0 CANCEL**.
İlgili paket **32 PASS**, i18n **0/0**, sürüm notları **52 PASS**; Main'in bütün
50 kaydı ve yalnız bu dalın iki görsel TR/EN kaydı korunur. NODE_OPTIONS veya
runner override yok. Sonraki commit yalnız kanıtları arşivler; kaynak değişmez.

Tarihsel üç çiftlik 21,809→3,548 ms yerel planlama ve 2851,865→257,209 ms pack
ölçümleri özgün kaynak SHA'sıyla kalır. Bunlar Linux yerel disk sonuçlarıdır;
SMB, Windows veya yeni Main ölçümü olarak sunulmaz. Gerçek son head CI'ı ayrıca
beklenir. P1 merge öncesinde durulur. Merge, TEST ve STABLE yapılmadı.

EN: Main `1796193f` was normally merged. All two production and three test/helper
blobs exactly match the prior independent review at `845f10b0`. No new worker.
The standard runner, default concurrency=4 and private TMPDIR, completed all ten
batches in one invocation: **8945 PASS / 0 FAIL / 65 existing SKIP /
0 CANCEL**. Related **32 PASS**, i18n **0/0**, visual notes **52 PASS**, retaining
all 50 Main entries and only this branch's two bilingual entries. No runner or
NODE_OPTIONS override. The next commit archives evidence only.

Historical three-pair local-planning 21.809→3.548 ms and pack 2851.865→257.209 ms
measurements retain their original source SHA. They are Linux local-disk results,
not SMB/Windows or a new-Main measurement. Actual final-head CI is a separate
gate. Stop before the P1 merge decision. No merge, TEST or STABLE publication.
