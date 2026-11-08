# INT-11 — güncel Main kabulü / Current Main acceptance

TR: Main `1796193f` (#916 ve #917 dahil) normal merge ile alındı. Üç üretim
dosyası ve native batch testi önceki bağımsız incelemedeki `5a2166cf` bloblarıyla
birebir aynı. Mevcut tek izole parser process'i korunur; yeni worker mekanizması
veya kullanıcılar arasında sıcak parser eklenmedi.

Standart `npm test`, varsayılan concurrency=4 ve izole TMPDIR ile, tek çalıştırmada
bütün 10 batch: **8.934 PASS / 0 FAIL / 65 mevcut SKIP / 0 CANCEL**, 1.302 dosya.
İlgili paket **10 PASS**; i18n **0/0**; sürüm notları **51 PASS**. Main'in 50 kaydı
ve bu dalın tek TR/EN görsel notu korundu. NODE_OPTIONS veya runner değişikliği yok.

Önceki üç çiftlik 5 küçük rapor ölçümü (681,646→273,170 ms) özgün kaynak SHA'sıyla
saklanır; yeni Main ölçümü veya uygulama geneli kazanç olarak yeniden etiketlenmez.
Bu aşamada yalnız Main entegrasyonu, değişmeyen kaynak ve son testler doğrulandı.
Kod sabit; bundan sonraki commit yalnız kanıt dosyalarıdır. Son push SHA'sının
gerçek GitHub kontrolleri ayrıca beklenir. P1 merge kapısı açık; merge yapılmadı.
TEST yapılmadı. STABLE yapılmadı.

EN: Main `1796193f`, including #916/#917, was imported through a normal merge.
All three production blobs and the native batch test exactly match the prior
independent review at `5a2166cf`. The existing isolated parser process remains;
no new worker mechanism or cross-user hot parser was introduced.

The unchanged standard runner completed all 10 batches in one invocation with
default concurrency=4 and private TMPDIR: **8,934 PASS / 0 FAIL / 65 existing SKIP /
0 CANCEL**, 1,302 files. Related tests **10 PASS**; i18n **0/0**; visual notes
**51 PASS**, preserving all 50 Main entries and this branch's own bilingual note.
No NODE_OPTIONS preload or runner override was used.

Historical three-pair timings for five small reports (681.646→273.170 ms) retain
their original source SHA and scope. They are not relabeled as a current-Main
measurement or an application-wide gain. Only integration, exact unchanged
source and final tests were revalidated here. The next commit archives evidence
only. Actual CI for the final pushed SHA remains a separate gate. P1 merge
approval is still separate; no merge, TEST or STABLE publication occurred.
