# Faz 5 · Bağımsız inceleme / Independent review

TR: Kullanıcının P1 kuralı kapsamında `gpt-6-astra`, temel
`ad198bfe245a93c5ccd90184082d209bb4c3dfb7` ile
`7012eb3f2d978a5f39aa12800e9c5ccb9635697e` arasındaki gerçek diff'i tek turda,
salt okunur olarak inceledi. İnceleme kod onayı vermedi; aşağıdaki üç bulguyu
üretti. Düzeltmeler ana agent tarafından yapıldı ve regresyonlarla doğrulandı;
kullanıcının tek çapraz tur sınırı nedeniyle ikinci bir inceleme yapılmadı.

EN: Under the user's P1 rule, `gpt-6-astra` performed one independent read-only
review of the actual diff from `ad198bfe245a93c5ccd90184082d209bb4c3dfb7` to
`7012eb3f2d978a5f39aa12800e9c5ccb9635697e`. The review did not approve the code;
it identified the three findings below. The primary agent implemented and
regression-tested the fixes. There was no second review pass, in accordance
with the user's one-pass limit.

| Risk | Bulgu / Finding | Düzeltme / Resolution |
| --- | --- | --- |
| P1 | Kuyruk girdileri işlerin büyüme payını tüketip birbirlerini sonsuza kadar bloke edebilir. / Queued inputs can consume each other's execution headroom indefinitely. | Admission, tüm kabul edilmiş girdilerin sırayla boşaltılabildiği bir yürütme sırası bulunmasını şart koşar. Bekleme ve yürütme aynı son tarihi paylaşır; kuyruk timeout'u komşu worker'ı emekli etmez. Küçük, sığan bir iş büyük işin önünü açabilir. / Admission requires an execution order that can drain every accepted input; one deadline covers queue wait and execution, and a queued timeout does not retire its neighbour. A smaller fitting job can unblock an older large job. |
| P2 | Snapshot olmayan Excel geri dönüşü MAIN'e yüklenir fakat worker'a yayımlanmadığında başarılı, boş Backlog dönebilir. / A snapshot-free Excel fallback can load MAIN without publishing a worker source, producing a successful empty Backlog. | Geri dönüş runtime'ı kaynak alanları zaten hazır olsa da snapshot ve tam tipli özel replica olarak kaydedilip yayımlanır. / The fallback runtime is saved and published as a snapshot and exact typed private replica even when source fields are already present. |
| P2 | Snapshot sonrası, projection yayını öncesi crash eski manifest zamanı ile yeni snapshot arasında kalıcı 409 oluşturabilir. / A crash between snapshot save and projection publication can permanently bind an old manifest timestamp to a new snapshot. | Sahip bazlı tek soğuk hazırlık, gerçek disk snapshot'ını worker'da doğrular ve descriptor'u doğrulanan loadedAt'ye bağlar. Eski kimliği yakalamış istek bir kez 409 alır; sonraki istek doğrulanan kimlikle ilerler. Bağlandıktan sonraki dosya değişikliği hâlâ 409 verir. / A per-owner single-flight verifies the actual disk snapshot in the worker before exposing its bound descriptor. Already captured stale callers reject once; later callers use the verified identity. A subsequent unpublished disk replacement still rejects with 409. |

TR: Beş gerçek RED assertion'ı
`/tmp/phase-5-review-findings-red-2.txt` içinde korunur. Üretim fonksiyonlarını
çalıştıran testlere ek olarak, `compute-cold-source-recovery.test.js` gerçek
snapshot dosyaları ve native ortak worker ile iki yolu sınar. Backlog baytları
kanonik üreticiyle birebir eşleşir; yabancı Buyer satırı çıkmaz, snapshot-free
yol gerçek replica oluşturur, bağlanmış disk kimliği sonradan değiştirilirse
reddedilir. Test, çağıranın descriptor kopyasını değiştirmesinin servisin
kanonik descriptor'unu değiştirmediğini de doğrular.

EN: Five actual RED assertions are retained in
`/tmp/phase-5-review-findings-red-2.txt`. In addition to exercising the production
functions, `compute-cold-source-recovery.test.js` uses real snapshot files and
the native common worker for both recovery paths. Backlog bytes exactly match
the canonical builder, foreign Buyer rows are absent, the snapshot-free path
creates a real replica, and a subsequent change to bound disk identity rejects.
The test also verifies that mutating a caller's descriptor copy cannot alter
the service's canonical descriptor.

TR: İnceleme, CPU profiler'ın açıkça etkinleştirilmesini belgelenmiş bir
tanı/gecikme ödünleşimi olarak değerlendirdi; normal kullanımda geçmişe dönük
fonksiyon profilinin bulunmayacağı sınırı korunur. Windows/Electron davranışı
bu Linux incelemesiyle doğrulanmış değildir. Üç koşuluk performans kabulü ve
GitHub check/merge durumu ayrı kanıt gerektirir.

EN: The review treated opt-in CPU profiling as a documented diagnostic/latency
tradeoff: normal operation will not retain retrospective function profiles.
Windows/Electron behaviour is not verified by this Linux review. Three-run
performance acceptance and GitHub check/merge status require separate evidence.

TR: İncelemeden sonraki normal üçlü açılış serisi iki koşuda 200 ms sınırını
aştı; bu örnekler korunur ve kabul edilmiş sayılmaz. Sonraki tanısal izler
sınır aşımını yeniden üretmedi. İzlerde doğrulanan tek parça yetki V8 kodlama
maliyeti için ana agent ek bir düzeltme yaptı: aynı V8 akışı en fazla 256
satırlık parçalarda kodlanır, gerçek event-loop turları arasında güncel yetki
sürümü denetlenir. Worker tam kanonik JSON digest'ini üretir; yetki kapısı
gevşetilmez. İki yeni native regresyon önce RED oldu: aralarda tur verme ve
eski hazırlığın admission öncesinde kesilmesi. Özel anahtar, bölünmüş satır,
Date ve paylaşılan satır kimliği eşdeğerliği ayrıca sınanır. Bu ek düzeltme
ikinci model tarafından yeniden incelenmedi; tek inceleme turu sınırı korunur.
Önceki sınır aşımlarının kesin kök nedeni bu düzeltmeyle kanıtlanmış değildir.

EN: The subsequent normal three-run opening cohort exceeded 200 ms in two
runs; those samples are retained and are not accepted. Later diagnostic traces
did not reproduce the exceedances. The primary agent made an additional fix
for the measured monolithic authority V8 encoding cost: one V8 stream is
written in batches of at most 256 rows, with live authority-generation checks
between real event-loop turns. The worker produces the exact canonical JSON
digest; authorization gates remain intact. Two new native regressions first
failed RED: cooperative handoffs and stopping obsolete preparation before
admission. Special keys, split rows, Date values and shared row identity have
additional equivalence coverage. This additional fix was not reviewed again by
a second model, preserving the single review-pass limit. It does not establish
the exact root cause of the earlier exceedances.

TR: Daha sonraki native profil, aynı turdaki canlı kapı denetimleri ile
4,6 MB CP gzip girdisinin V8 kodlanmasının biriktiğini ve bazı aralıklarda GC
duraklamasını doğruladı. Encoder'a ait, tam ve transfer edilebilir tampon artık
ikinci kez kopyalanmaz. Node sürümü transfer durumunu sorgulayamıyorsa veya
tampon havuzlu/paylaşılmış/kesilmişse önceki kopyalama yolu korunur. Native test
önce RED oldu; byte admission, gerçek transferde detach, çağıranın girdisinin
korunması ve sonuç eşdeğerliği doğrulanır. Bu da ana agent'ın inceleme sonrası
düzeltmesidir; tüm gecikmelerin kök nedeni veya üçlü normal kabul sonucu
olarak sunulmaz.

EN: A later native profile verified the accumulation of live-gate checks and
V8 encoding of a 4.6 MB CP gzip input in one turn, and GC pauses in some gaps.
A complete, transferable buffer owned by the encoder is no longer copied a
second time. The prior copying path remains when the Node version cannot query
transferability or the buffer is pooled, shared or sliced. The native test first
failed RED; byte admission, detachment through real transfer, intact caller
input and equivalent output are covered. This is another primary-agent fix
after the independent review, not a claim to explain every delay or to have
passed the normal three-run acceptance criterion.
