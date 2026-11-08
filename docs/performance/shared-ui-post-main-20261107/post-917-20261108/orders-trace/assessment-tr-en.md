# Orders trace — tanı / diagnostic only

TR: İki yeni sunucu/tarayıcıda, yalnız Orders ilk niyeti ve 1 ms CPU + timeline
profili alındı. Kaynakta yalnız modül döngüsü CP/Orders yerine Orders'tır; mevcut
betik veya timeout değiştirilmedi. Tek profilli A/B: 11,621→6,869 sn. Bu sonuç
önceki üç çiftteki Orders gerilemesini kapatmaz, yeni hızlanma kabulü veya kesin
kök neden değildir. Profil ek yükü, sıra ve tek örnek belirsizliği korunur.

İki kolda da Orders açıkken CP background warmup ve sonradan CP priority-ready
olayı görüldü. Örneklenen renderOrders kapsayıcı süresi A4.870 / B1.839 sn;
Layout trace toplamı A1.892 / B0.790 sn. Bunlar aynı sürenin farklı/nested
atfıdır; birbirine eklenmez, tam CPU süresi veya kullanıcı input latency'si
sayılmaz. Profil durduktan sonraki supplementary snapshot daha geç olayları da
kapsayabilir; event zamanlarıyla profil sınırını karşılaştırın. Arka plan işinin
resmî Orders gerilemesinin nedeni olduğu **kanıtlanmadı**.

NODE_PATH varlığı ilk preflight'ta, uygulama açılmadan reddedildi. Aynı guard
korunarak yalnız bu tanı sürecinin NODE_PATH'i iki kol için kaldırıldı; yeni
etiketle gerçek A/B çalıştı. Başarısız preflight kanıtı silinmedi. İki kolun da
satır/generation/revizyon, görünürlük ve tam satır/hücre kontrolleri geçti;
server/browser çıkışı doğrulandıktan sonra kayıpsız sıkıştırma yapıldı. Ham SHA
ve gzip roundtrip manifestleri arşivdedir. #908 taslak ve merge engelli kalır.

EN: One instrumented first-Orders A/B used fresh servers and browsers. Only the
in-memory module loop differs; existing scripts/timeouts are unchanged. The
11.621→6.869 s sample does not close the three-pair sequential Orders regression,
prove a new gain or establish cause. Sampling overhead, order and single-sample
uncertainty remain.

Both arms show off-screen CP warmup while Orders is active. Sampled inclusive
renderOrders time is A4.870/B1.839 s; named Layout trace duration A1.892/B0.790 s.
These are nested/nonadditive attributions, not exact CPU or user input latency.
Supplemental snapshots may contain events after profile stop; align timestamps
before attributing them. Background work is **not proven** to cause the formal
regression. The initial NODE_PATH preflight rejection, identical subsequent
environment sanitation, genuine row/generation/revision/cell gates, process-exit
proofs and lossless compression hashes are retained. #908 stays draft/blocked.


Tam yeniden çalıştırma girdileri (source-snapshots ve preparation-readonly-facts dahil) diagnostic-source-package.tar.gz içindedir. B kolunu yeniden kurmak için doküman commitleriyle karıştırmadan ölçülen b9545261 runtime commitini kullanın; tüm kaynak pinleri korunur. / Complete launcher inputs, including source snapshots and read-only facts, are in diagnostic-source-package.tar.gz. Recreate the measured b9545261 runtime rather than treating later evidence-only commits as source changes. Frozen live-clock hashes are historical to the recorded date; a new control cohort is required before changing any expected hash.
