# 6Q · Electron bellek dayanıklılığı (soak) — main `53176623`

**Ortam:** main `53176623b3b7673d4a03ee0a9c422a6c6e1f8146` (yalıtılmış worktree, ölçüm sırasında kod değişmedi) ·
Electron 44.3.0 (Node 24.20.0) · `ELECTRON_RUN_AS_NODE=1` ·
`NODE_OPTIONS="--use-openssl-ca --max-old-space-size=3686"` (+ ölçüm kancası `--require kit/hook-soak.js`) ·
`BUYER_LOG_COMPUTE_GC_RECHECK` ayarsız (GC düzeltmesi yok, #1249'a bağımlılık yok) ·
`BUYER_LOG_CP_ROWPATCH_LEGACY` ayarsız (#1236 pilotu kapalı) · Linux container, 4 vCPU · 30k fixture seed 7 (CP 24.982 satır).

**İş yükü:** tek sunucu, 110 dk. Sırayla Supp. FOB `PATCH` (gövdede `delType` yok) ve not `/batch`.
Her kayıttan sonra `cp/computed?since`, ardından `orders/query`, sonra 15 sn ara.
Her 10 dakikada bir:
- artımlı özet ile tam kurulum özeti karşılaştırılır;
- yazılan değerler cp/query üzerinden geri okunur.

Sonda sunucu durdurulur, page-cache silinir, sıfırdan kurulup taban özet alınır.

## Sonuç

| Ölçüt | Değer |
|---|---|
| Kayıt / 200 | 349 / 349 |
| 503 | 0 |
| Eşitlik denetimi (11 + final) | 12/12 eşit (`5ac8eef8fa41`), değer geri okuma 349/349 |
| Yeniden başlatma tabanı | özet = final, 349/349 değer |
| Worker spawn / exit / terminate (ölçüm penceresi) | 0 / 0 / 0 (yalnız açılıştaki 3 spawn) |
| RSS medyan dilimleri (0-30/30-60/60-90/90-110 dk) | 1581 / 1805 / 1807 / 1848 MB |
| Ana heap medyan dilimleri | 76 / 103 / 120 / 124 MB |
| VmHWM | 2326 → 3138 MB (~48. dk), sonra 110. dk'ya kadar sabit |
| RSS eğimi (ilk 30 / son 30 dk) | +626 / −106 MB/sa |
| Heap eğimi (ilk 30 / son 30 dk) | +101 / +10 MB/sa |
| CP bekleme medyanı / hazır medyanı | 3262 / 3915 ms (dilimler 4003 → 3916 → 3882 → 3886) |

Değerlendirme:
- **Plato [Muhtemel]:** RSS ve VmHWM yaklaşık 30–50. dakikadan sonra yükselmiyor. Ana heap'in son 30 dakikadaki eğimi +10 MB/sa; 110 dakikanın ötesi ölçülmedi.
- **Bekleme süreleri:** zamanla kötüleşmiyor.
- **Veri:** tam eşit.

Bu doküman yeni bellek yönetimi önerisi içermez.

## Yeniden üretim

```sh
K=docs/design-proposals/adr-0003-kanit/kit
E=<electron 44.3.0 dist>/electron
cd <main@53176623 worktree>/resources/app
env -u BUYER_LOG_CP_ROWPATCH_LEGACY -u BUYER_LOG_COMPUTE_GC_RECHECK \
  ELECTRON_RUN_AS_NODE=1 HOOK_LOG=/tmp/soak.hook \
  NODE_OPTIONS="--use-openssl-ca --max-old-space-size=3686 --require=$K/hook-soak.js" \
  SOAK_MIN=110 SOAK_GAP_MS=15000 SOAK_CHECK_MIN=10 \
  $E $K/soak.js $PWD <30k fixture dir> /tmp/soak.json
node $K/analyze-soak.js /tmp/soak.json /tmp/soak.hook <outdir>
```

Dosyalar:
- `ham/`: soak.json, soak.log, commit.txt, soak.hook.gz.
- `analiz/`:
  - `ozet.json`;
  - `seri-dakika.csv` (dakika serisi);
  - `emeklilik.json`: boş, çünkü pencerede emeklilik yok.
