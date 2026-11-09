# Critical diff review / kapsam kanıtı

- `adapters.cjs` ve `workload.cjs` arşiv SHA'sıyla birebir aynıdır; yeni üretim
  şeması/adaptörü oluşturulmadı. Mevcut SQLite patch alt kümesinin eksikleri
  acceptance testlerinde açık RED olarak sınanır; missing metotlar stub'lanmaz.
- `worker.cjs`: open/ensure/replay ardından ilk full-record hydrate + enumerate
  gerçek süreye dahil; tekrar hydrate ayrı. Mevcut 300 operasyon değişmez.
  CPU ve RSS/heap sınamaları son bağımsız hash ve backup doğrulamasından önce
  alınır; backup/restore maliyeti ayrıca kaydedilir. Sampled heap tüm senkron
  transient tepeyi garanti etmez. Event-loop turn interval I/O ve GC'yi içerir.
- `benchmark.cjs`: aynı olaylar için bağımsız JS oracle; dönüşümlü sıra ve
  private process/copy korunur. Çocuk stdout/stderr ve başarısız/yarım koşular
  saklanır. `subset-passed` tam API veya ürün kabulü anlamına gelmez.
- `backup.cjs`: yazar yokken primary + data backup/WAL ailesi kopyalanır,
  fsync/hash manifest ve bağımsız restore business/event/pending/count oracle
  sınanır. Runtime lease/write-fence ve SQLite SHM taşınmaz. Üretimin concurrent
  backup/recovery/retention protokolüne eşitlik iddiası yok; raporlanan disk
  toplamları farklı otomatik yedek güvenceleri altında tasarruf kanıtı değildir.
- `boundary-probes.cjs`: yalnız test sürecinde fs wrapper'ları; ürün kaynağına
  hook eklenmez. JSON primary rename sonrası, SQLite checkpoint sonrası ve iki
  motorun manifest öncesi yarım backup sınırlarında gerçek SIGKILL. Kaynak DB'nin
  ACK yazıları, bağımsız business oracle ve SQLite integrity kontrolü sınanır.
  Bunlar checkpoint'in içi, tüm rotation/fsync aralıkları veya power loss değildir.
- Full-state metadata, owner/conflict/ACK/delete ve explicit baseRevision
  eşitliği eksik olduğundan yalnız business hash'inden API uyumu çıkarılmaz.
  P95, sınıf başına 30/60/150 gözlemden; üç run medyanından p95 üretilmez.
  A/A yapılmadı ve farklar gürültü denilerek kabul edilmedi.
- `git diff`/source-identity: ürün, package/lock, launcher, protokol, release notes,
  .github, AGENTS/CLAUDE değişmez. Önceki checkout `work` dalında 9e667430'da
  kalır. Başka adayın branch/commit'i kullanılmaz. Review tek agent ile yapıldı;
  üretim sınırını değiştiren P1 implementasyonu yok.
