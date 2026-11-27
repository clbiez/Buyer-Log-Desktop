# #1236 merge hazırlığı — Electron doğrulaması (2026-11-27)

- **Ölçülen commit:** `6492c2ae` (= `claude/cp-karar-pilot`, `origin/main 5317662` ile merge; rebase yok). Yalıtılmış worktree.
- **Çalışma ortamı:** Electron 44.3.0 (Node 24.20.0), `ELECTRON_RUN_AS_NODE=1`,
  `NODE_OPTIONS="--use-openssl-ca --max-old-space-size=3686"`, Linux container (4 vCPU), 30k fixture seed 7 (CP 24.982 satır).
- `BUYER_LOG_COMPUTE_GC_RECHECK` ayarsız (#1249 kodu yok).

| Klasör | İçerik |
|---|---|
| `test/` | Tam `npm test` (Node 22.23.5 test koşucusu) bayrak kapalı / açık: ikisi PASS, 1558 dosya, 0 başarısız |
| `golge/` | `kit/shadow4.js` off / on: V1↔V3, T1↔T3, V2↔V3, T2↔T3 farkı 0; Del. Type tam yol; U2 Del. Type korunur |
| `l2/` | `kit/run-t0-electron.sh` (off / on / offAA, 3 dönüşümlü blok) ham + `t0-ozet.txt` |

Yeniden üretme:

```bash
KIT=<repo>/docs/design-proposals/adr-0003-kanit/kit; EL=<electron 44.3.0 ikilisi>
cd <worktree>/resources/app && node scripts/generate-demo-data.js /path/src30k --rows 30000 --seed 7
for A in off on; do ELECTRON_RUN_AS_NODE=1 NODE_OPTIONS="--use-openssl-ca --max-old-space-size=3686" "$EL" $KIT/shadow4.js $PWD /path/src30k shadow-$A.json $A; done
KIT=$KIT SRC=/path/src30k OUT=/path/l2 APP=$PWD EL=$EL $KIT/run-t0-electron.sh
```

Ex-factory: 30k fixture'da 24.982 satırın tamamı yükleme onayından otomatik Ex-factory taşır; sunucu yazımdan önce
`409 AUTOMATIC_DATE_READ_ONLY` döner. Ex-factory yamasının tam kuruluma yönlendirilmesi gerçek sunucuda bu fixture ile
sınanamadı; kanıt birim testi (`logistic-segment-incremental-safety-v20261127`) + kaynak (`rowPatchIncrementalSafe` →
`patchTouchesLogisticSegments` tek merkez).
