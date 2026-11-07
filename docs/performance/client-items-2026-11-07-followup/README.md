# #906 — bağımsız eşli ölçüm protokolü

Önceki teslimin üç commit'i ve kanıtları korunur. `original-evidence.json`
dosyası eski rapor, ham sonuç ve dört PNG'nin SHA-256 değerlerini kaydeder.
Güncel `main`, #885'i içeren `63159fb3` seviyesindedir ve teslimin atasıdır;
`git merge --no-ff --no-edit origin/main` sonucu `Already up to date` olmuştur.
Bu devam çalışmasında rebase, force-push, PR merge veya TEST/STABLE yapılmaz.

- A: güncel main'in optimizasyon öncesi dört istemci dosyası.
- B: teslim edilen `ed8a425f` commit'indeki dört istemci dosyası.
- Motorlar, Markdown, fixture, Node ve Chromium iki kolda aynıdır.
- CARD-01 için sırasıyla A/B, B/A, A/B; ardından INT-09 için aynı sıra.
- Her kol ayrı Node ve yeni Chromium süreci açar. Süreç kimlikleri ve başlangıç/
  bitiş saatleri manifestte tutulur. Çalıştırıcı aynı anda tek benchmark açar;
  ayrıca kilit dosyası kullanır. Ölçüm sırasında başka test/benchmark çalışmaz.
- CARD: her koşuda 500 ve 5.000 **kayıt** üzerinde **10 seçim ve 10 arama
  örneği**, düzenlenebilen modüllerde 5 kayıt örneği. 5.000 seçim yapılmaz.
- INT: her koşuda 100 geçmiş mesajı ve büyüyen yanıtta 40 çizim/frame örneği.
- İç örnekler bağımsız koşu sayılmaz. Bir modül/ölçek için kol başına üç
  bağımsız koşu, üç eşli fark vardır. p95 CARD'da 10 örneğin maksimumudur.
- Bunlar sentetik renderer ölçümleridir; uygulama geneli hızlanma değildir.

Eski CPR-11'in beşer örneği korunur. Main entegrasyonu teslimden sonra ölçülen
CPR yolunu değiştirmemiştir; gereksiz mikrobenchmark tekrarı yapılmaz. Hata
metni, false karar ve sürüm invalidation testleri son test turunda korunur.

İlk eşli ölçüm sonucu lisans aramasındaki gerilemeyi tekrarlarsa arama aralığına
odaklanan CPU/layout/GC trace'i alınır. Gerileme otomatik kabul edilmez. Küçük
bir düzeltme bulunursa önce regression güvencesi ve ayrı ölçüm gerekir; aksi
durumda ayırma veya ölçülmüş ödünleşim kullanıcı kararına sunulur.

Çalıştırıcı:

```sh
node resources/app/scripts/client-paired-benchmark.js \
  --baseline-dir /tmp/client-followup-sources/A \
  --candidate-dir /tmp/client-followup-sources/B \
  --output docs/performance/client-items-2026-11-07-followup/paired-initial
```

A/B dosyaları `git show origin/main:resources/app/public/<dosya>` ve
`git show ed8a425f:resources/app/public/<dosya>` ile hazırlanır. Dosya özetleri
çalıştırıcı manifestinde bulunur. Eski kanıt dosyaları değiştirilmez.
