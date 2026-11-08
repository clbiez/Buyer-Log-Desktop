# Sentetik modül mikro karşılaştırması

Son ölçüm: `2026-11-08T07:59:28.241Z`, aynı Linux x64 VM, Node `v24.19.0`,
AMD EPYC 9V74, görünen 5 CPU. Tam örnekler, GC sonrası heap farkları, çıktı
SHA256'ları ve ortam bilgisi: [micro.json](evidence/micro.json).

30.000 Koleksiyon satırı, 13.103.403 byte JSON; her arm'da 10 edit. Bir adet
5 üyeli grup, bir explicit `false` override ve kalan bağımsız satırlar kullanılır.
Satırlarda bilinmeyen nested JSON, `null`, `false`, `0` ve persisted grup metadata
bulunur. Bunlar yalnız sentetik veridir.

Her senaryoda üç eşleşme sırası **eski/yeni → yeni/eski → eski/yeni**.
Her arm ayrı, yeni Node sürecinde aynı sentetik başlangıç verisinden kurulur.
Süreçler aynı VM üzerinde sırayla başlatılır; spawn ve warmup edit süresinin dışındadır. Küçük kaynakla iki
motor da ısıtılır; GC ölçülen edit bölgesinin dışındadır. Her eşleşmede bütün
30.000 satırın JSON SHA256'sı eşittir. Her yeni arm'da ayrıca touched-row request,
primary ACK sonrası inverse hazırlama ve son edit'i geri alma sonucu doğrulanır.

| Senaryo, 10 edit toplamı (ms) | Eski örnek 1/2/3 | Yeni örnek 1/2/3 | Eski medyan | Yeni medyan |
| --- | --- | --- | --- | --- |
| Bağımsız custom hücre + history kaydı | 795,356 / 813,879 / 813,321 | 42,507 / 40,000 / 42,576 | 813,321 | 42,507 |
| Parent custom hücre + grup + history kaydı | 3446,791 / 3334,150 / 3384,162 | 47,707 / 50,509 / 49,068 | 3384,162 | 49,068 |

Eski arm gerçek başlangıç source'undan çıkarılmış
`kolApplyCollectionCellChange → commitKolEditor → kolPushUndo → kolSnapshot`
akışını çalıştırır. Grup durumunda gerçek exported setter ve gerçek normalizer
da çalışır. Yeni arm command prepare/apply ve before/after inverse slotlarını
tutar. Mevcut eski snapshot yolunun history'yi edit anında eklemesiyle yeni
modülün yalnız ACK sonrası history'yi ilerletmesi bilinçli semantik farktır;
ölçümde yeni komutlar pending kalır, ACK ve inverse kontrolü zamanlama dışındadır.

İki arm'da da `save:false`, `rerender:false`, `syncQuotations:false` kullanılır.
Input/DOM stub, VM kurulumu, fixture clone, source certification, çıktı doğrulama,
history JSON byte hesabı, network, storage, sunucu ve replication edit zamanına
dahil değildir. `benchmark.cjs` tam uygulamayı evaluate etmez; gerçek fonksiyon
gövdelerini ve actual dependency modüllerini kullanır.

| Ayrı maliyet/retention | Bağımsız hücre | Grup hücresi |
| --- | --- | --- |
| Yeni initial binding/certification medyanı | 127,125 ms | 121,465 ms |
| Eski harness setup medyanı | 0,551 ms | 0,561 ms |
| Yeni 10 komutun touched-row materialization medyanı | 21,614 ms | 2,088 ms |
| Yeni legacy request JSON byte | 530 (1 satır) | 1786 (4 satır) |
| Eski 10 snapshot'ın serialized history byte | 131.034.023 | 131.033.951 |
| Yeni 10 forward/inverse-slot komutunun serialized byte | 9073 | 59.981 |
| Eski GC sonrası retained heap delta medyanı (byte) | 179.225.056 | 197.149.752 |
| Yeni GC sonrası retained heap delta medyanı (byte) | 331.064 | 577.536 |

Initial certification bütün kaynağı okur ve ilk binding maliyetidir; tek soğuk
edit ücretsiz değildir. Yeni field materialization hâlâ per-command row-array
aramaları/grup kapıları yaptığı için bu kaynakta group materialization'dan daha
pahalıdır. Yeni modüllerin array/Map referans kopyaları tümüyle ortadan kalkmaz.

`micro.json` içindeki `touchedRows`, **güncel rows dizisinde değişen nesne
referansı sayısıdır**: bağımsız eski edit in-place olduğu için 0, yeni 1;
eski grup 30.000, yeni 4. Eski snapshot'ların clone sayısı bu sayıya dahil değildir;
snapshot retention yukarıdaki ayrı ölçüdür. GC/heap sonuçları bu tek Node/VM
ölçümüdür; serialized byte JS heap boyutu değildir. Üç eşleşme istatistiksel
uygulama veya fiziksel Windows/ThinkPad performans kabulü sağlamaz.

Bu sonuçlardan uygulama geneli hızlanma, kalıcılık kazancı, network kazancı,
UI gecikmesi veya Faz 6c kapanışı iddia edilmez. Root entegrasyonunda gerçek
UI/storage/worker/authority yolları ve tüm regresyon ayrıca zorunludur.

Önceki aynı-process denemesindeki negatif heap örneği `evidence/micro.shared-process.json` içinde saklanır ve heap kabulü için kullanılmaz. Ayrı-process sürümünün ilk stdout-flush hatası da `evidence/micro.process-output-failure.txt` içinde saklıdır; son script sonucu senkron stdout ile aktarır.
