# Shared UI — Main integration acceptance / Main entegrasyon kabulü

Güncel ek / current addendum: 8 Kasım 2026 (Europe/Istanbul). Ham koşu zamanları
UTC olarak kendi dosyalarında korunur.

## TR

#908, Main `5b8c1e6f` ile normal merge `7aeda80d` üzerinden bütünleştirildi.
İncelenen `7c842910` ile iki üretim dosyası birebir aynı. Yeni optimizasyon ve
i18n/model-image/motion değişikliği yok. Main'in 42 not nesnesi + kendi tek TR/EN
kaydı korunur: **43**. Eski farklı concurrency/ayrı batch koşuları tarihsel kalır.

Standart filtresiz `npm test`, tek çağrıda bütün **10 batch**, varsayılan
concurrency4, private TMPDIR, NODE_OPTIONS/preload olmadan: **1.295 dosya /
8.883 PASS / 0 FAIL / 65 mevcut SKIP / 0 CANCEL**. İlgili paket **131 PASS**;
i18n **0/0**, release-note validator **43 PASS**. Test edilen uygulama ağacı
`de2bd601091a9f38663cd0ab49d6213e330470b2`. Tek bağımsız gpt-6-astra
incelemesinde raporlanabilir P1/P2 yok; yeni genel tur yapılmadı. Son SHA CI'ı
ayrı kapıdır; bu ek yalnız kanıttır.

Taze **30k seed7** fixture, değiştirilmemiş Faz0 aracıyla CP 24.982 / Orders
30.000 ve generation/revizyon doğrulaması sağladı. Bu tek fixture hazırlığı,
yeni A/B kazanç kıyası değildir. Mevcut gerçek tarayıcı `--checks-only` aracı:
TR/EN × CP/Orders × iki boyut × 0/3/9 freeze; hizalama, i18n bekçisi, modal,
tekrarlanan scroll'da gereksiz stil yazımı olmaması ve motion kontrolleri PASS.
Sekiz yeni PNG kaydedildi; temsilî TR CP ve EN Orders modalı incelendi.
Ek mevcut blur kabulü **15 ekran / 95 shadow kuralı / 209 render denetimi**
geçti: TR/EN, iki tema, dört boyut, GPU/software, hover/klavye, gerçek not
penceresi, nested native dialog, pinned rail, reduced/off/normal motion.
Kayıtlı sentetik 512×256 PNG'nin byte/clipboard kontrolü INT-08 performans
kanıtı değildir. Eski geçerli sürüm notu PNG'si korunur.

- SHELL-07: ölçülen düşük maliyet nedeniyle atlandı.
- SHELL-08 / workspace-blur: uygulandı; yeni Main ve son merge kabulü beklenir.
- **INT-08: orijinal görsel maliyeti ölçülemedi, açık.**

Tarihsel inclusive fonksiyon süreleri: header **938,5→20,9 ms**, blur
**924,3→11,5 ms**. İki değişiklik aynı adayda; katkılar bağımsız ayrıştırılmadı.
Yaklaşık 50 ms p95 genel akıcılık garantisi değildir. Kaynak aynı olduğundan
bu kıyas gereksiz tekrarlanmadı. Windows/Electron sonucu iddia edilmez.

[Gerçek komutlar, loglar ve source eşitliği](shared-ui-post-main-20261107/manifest.json).
**#915 sonrası Main entegrasyonu ve son CI ayrıca tamamlanır. Merge, TEST/STABLE yok.**

## EN

Current record dated 8 November 2026 (Europe/Istanbul); raw timestamps remain UTC.
Normal Main merge `7aeda80d` includes `5b8c1e6f`. Both reviewed production modules
are byte-identical to `7c842910`. The 42 Main notes plus one own entry remain.
No i18n/image-cache/motion production change or new optimization was added.

Unchanged standard full `npm test`, all ten batches in one invocation, default
concurrency4, private TMPDIR and no NODE_OPTIONS/preload: **1,295 files / 8,883
PASS / 0 FAIL / 65 existing SKIP / 0 CANCEL**. Related 131 PASS, i18n0/0,
43 notes valid. Tested app tree `de2bd601091a9f38663cd0ab49d6213e330470b2`.
The one independent gpt-6-astra review found no reportableP1/P2. Earlier partial
or concurrency-modified runs remain historical, not final standard acceptance.

A fresh 30k fixture passed unchanged Phase0 row/generation/revision checks. One
candidate-only real-browser acceptance covered language, sizes, freeze geometry,
dynamic i18n/modal handling, unchanged-scroll writes and motion. A separate real
blur suite passed 15 screens,95 shadow rules and209 rendered audits across both
languages/themes, four sizes, GPU/software, keyboard, nested dialogs and motion
modes. This is functional acceptance, not a new A/B timing comparison. The tiny
synthetic PNG byte test does not close INT-08, which remains open/unmeasured.
Historical inclusive timings remain scoped to the two changes measured together;
there is no independent ablation or general responsiveness guarantee.
**Post-#915 Main integration/final CI remain separate; no merge or TEST/STABLE.**


## #915 sonrası son kabul / Final acceptance after #915

8 Kasım 2026: Main `d77f83e5` (#915, kullanıcı onayıyla merge edildi)
normal merge `81b94d23` ile alındı. Test edilen uygulama ağacı
`b3a88ec323f20a0fa22e871425e7971153617b8e`. Standart `npm test`, tek çağrıda bütün
10 batch, varsayılan concurrency=4, izole TMPDIR ve NODE_OPTIONS/preload
olmadan: **1296 dosya / 8900 PASS / 0 FAIL / 65 mevcut SKIP /
0 CANCEL**. İlgili paket **131 PASS**, i18n **0/0**, sürüm notları
**44 PASS**. Tarihsel sonuçlar korunur; bu kayıt yeni performans
kazancı iddiası değildir. Son commit'in gerçek GitHub kontrolleri ayrı kapıdır.

Main `d77f83e5` was imported by normal merge without rewriting the frozen review
history. The unchanged standard runner passed all ten batches in one invocation:
**1296 files / 8900 PASS / 0 FAIL / 65 existing SKIP / 0 CANCEL**,
default concurrency4, private TMPDIR, no NODE_OPTIONS/preload. Related package
131 PASS; i18n0/0; 44 visual notes valid. Own production changes
and their reviewed behavior were preserved; the new runtime delta imports the
separately reviewed and merged current-authority fix. Evidence-only additions
after these checks do not change source, tests, validators or CI. Historical
benchmark limitations remain. Actual final-head CI and merge approval are still
separate. **No TEST/STABLE publication.**


## #904 sonrası son kabul / Final acceptance after #904

Main `0dc9f094` normal merge `e0502653` ile alındı; iki üretim
modülü inceleme `7c842910` ile birebir. Diğer49 Main kayıt + bir kendi
kayıt korunur. Standart tam npm test bütün10 batch tek çağrıda:
**1.301 dosya / 8.930 PASS / 0 FAIL / 65 mevcut SKIP / 0 CANCEL**; varsayılan
concurrency4, izole TMPDIR, NODE_OPTIONS/preload yok. İlgili131PASS, i18n0/0,
50not PASS. Test edilen uygulama ağacı `dca525e71f1f4cb9bbee855428efa2a5f66ab592`.
Ölçülen kendi kaynakları değişmedi; kıyas gereksiz tekrarlanmadı.

Main `0dc9f094` was merged normally. The two reviewed runtime blobs are
byte-exact `7c842910`. Standard full runner again passed all ten batches in one
invocation:1301 files,8930PASS,0FAIL,65existingSKIP,0CANCEL; defaultconcurrency4,
privateTMPDIR,noNODE_OPTIONS. Related131PASS,i18n0/0,50visualnotes valid.
Evidence-only final changes preserve source/test/CI. Actual final-head CI remains
a separate gate under explicit conditional merge permission. Historical combined
timings and browser acceptance retain their original sources/limits. INT-08
remains open/unmeasured in this PR. No TEST/STABLE.
