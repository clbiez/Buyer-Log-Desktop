# Gerçek Excel worker mesaj alımı / Actual Excel worker message receive

2026-11-08. Linux / Node 24.19, gerçek üretim Excel client ve worker, 30k seed7 sentetik ASAS; üç taze süreç, ortak exclusive ölçüm kilidi. Ürün kaynak dosyaları değişmedi.

[Doğrulandı] Gerçek `receiveMessageOnPort` çağrısı çevresinde gözlenen main alım süresi medyanı **619,906 ms** (553,298 / 619,906 / 1135,007 ms). Aynı pencerede main thread CPU medyanı **599,870 ms**. Gönderen gerçek `postMessage` çağrısı medyanı **1314,571 ms**. Kaynak hash’i, 30k satır ve nedensel olay sırası üçünde de doğrulandı. Altı observables unit testi geçti; ham kayıtlar saklıdır.

Bu süre saf V8 deserialize değildir: native dequeue/materialization/GC/call etkileri ayrılmamıştır. Gönderen ve alıcı pencereleri basitçe toplanamaz. İlk görevdeki ayrı `v8.deserialize` 2,1 sn hipoteziyle doğrudan hızlanma kıyası yapılamaz. Bu üç koşu before/after değil; tam refresh, yük altındaki sunucu veya Windows/Electron kabulü değildir. **200 ms stall kabulü kapanmadı.**

Kod `scripts/prototypes/excel-real-receive-20261108/` altında aynı baytlarla arşivlidir. `run-prepared.sh` tarihsel /tmp konumunu korur; depo kopyasında doğrudan probe komutunu kullanın. Kaynak ve worker bağımlılık pinlerini önce doğrulayın; fixture yeniden kurulursa aynı sentetik bytes/marker ve beklenen path sağlanmalı, hash sessizce güncellenmemeli.

```sh
env -u NODE_OPTIONS -u NODE_PATH EXCEL_RECEIVE_COMMON_LOCK=held \
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
timeout --signal=TERM --kill-after=15s 300s node \
scripts/prototypes/excel-real-receive-20261108/probe.cjs \
--app-root /absolute/repo/resources/app --label unique-fresh-run
```

Fresh source-owner tasarım girdisi: ham ASAS/IAS/LFL grafiğini main’e alıp tekrar ortak worker’a göndermek maliyeti kaldırmaz. Kalıcı logical owner/generation servisi, mevcut havuzun affinity garantisi olmamasını hesaba katmalı; parse/match/compare/snapshot aynı admitted işte kalmalı, committed artifact ve bounded index/control sözleşmeleri senkron main tüketicileriyle birlikte uygulanmalı. Bu gözlem gzip-only veya opaque-handle-only uyarlamasını eşdeğerlik kanıtı yapmaz.

EN: Three fresh runs measure the real production worker/client native receive call, not standalone v8.deserialize: median combined receive 619.906 ms, receiver thread CPU 599.870 ms, sender postMessage 1314.571 ms. Exact source hashes, 30,000 rows and causal order passed. Six observable unit tests passed. The receive window combines materialization/dequeue/GC/call work and is not pure deserialization; sender/receiver windows are not additive. No before/after improvement, full-refresh/server-throughput or Windows/Electron claim is made. The >200 ms acceptance gap remains open. Production ownership migration and final independent review remain pending. No merge or TEST/STABLE release.
