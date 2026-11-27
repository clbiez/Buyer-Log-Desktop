# 6R · CP satır yaması varsayılan (bayrak kaldırıldı): aday `355d14f` ↔ main `5440fde`

**Ortam:** Electron 44.3.0 (Node 24.20.0) · `ELECTRON_RUN_AS_NODE=1` · `NODE_OPTIONS="--use-openssl-ca --max-old-space-size=3686"` (L2'de + `kit/hook-t0.js`)
· `BUYER_LOG_COMPUTE_GC_RECHECK` ve `BUYER_LOG_CP_ROWPATCH_LEGACY` ayarsız · Linux container 4 vCPU · ayrı worktree'ler, ölçüm sırasında kod sabit.

## Gölge eşitlik (`golge/`, `kit/shadow4.js`, aday)
Fixture `src30k` seed 7'nin türevi: ASAS 'Buying Son Onay Tarihi' her 4. satırda boş (7.500/30.000) → elle düzenlenebilir Ex-factory satırları.
Sonuç:
- V1↔V3, V2↔V3, T1↔T3, T2↔T3: 0 fark (24.982 satır).
- Pilot okuması: 8 adım, kira 0.
- U2 Del. Type sonrası ve U1 Ex-factory PATCH (200) sonrası okuma: `miss=no-chain`, yani kira + tam kurulum.
- U2'nin Del. Type değeri (`Uçak`) U1'in kayıtlarından sonra, depoda ve V3'te korunuyor.

## L2 (`l2-tur1/`, `l2-tur2/`, `kit/run-t0-electron-2app.sh`, `kit/ab8.js`)
Kollar: off/offAA = main `5440fde`, on = aday `355d14f`. Düzen: her turda `off on offAA | offAA on off | off on offAA`. 2 tur = 6 blok; her koşu taze sunucuyla 6 kayıt.

Birleşik medyan (ms), off → on (A/A):

| Mod / kayıt | CP hazır | Siparişler hazır | İkisi hazır | Sunucu CPU |
|---|---|---|---|---|
| seq / Supp. FOB | 3879 → 205 (3903) | 4603 → 2307 (4657) | 4603 → 2307 | 8260 → 5230 |
| seq / not | 3185 → 213 (3192) | 3899 → 2380 (3854) | 3899 → 2380 | 8980 → 7205 |
| par / Supp. FOB | 3676 → 200 (3501) | 2630 → 2408 (2624) | 3676 → 2408 | 10120 → 7405 |
| par / not | 3529 → 159 (3649) | 2631 → 2405 (2714) | 3529 → 2405 | 9920 → 7870 |
| ordersOnly / Supp. FOB | 3945 → 2519 (3808) | 2373 → 2395 (2274) | 3945 → 2519 | 10295 → 7745 |
| ordersOnly / not | 4021 → 2503 (4004) | 2448 → 2390 (2417) | 4021 → 2503 | 10445 → 7980 |

- **503:** 0 (18 koşu).
- **Son okuma özeti:** 18/18 aynı (`5ac8eef8fa41`).
- **Tur 1 ordersOnly / Siparişler:** adayda 5/6 örnek yukarıdaydı (medyan ~+110 ms). Tur 2'de 6/6 aşağıda; 12 çiftin on−off medyanı ≈ −35 ms. Tekrarlanmayan gürültü sayıldı, gerileme değil.

## Test
`test/fulltest-355d14f.log`: Node 22.23.5 ile tam `npm test` PASS, 1559 dosya.

Windows: `Buyer Log Tests` run 46076754519 (windows-latest, Node 22, ref = `355d14f`) → success. Windows'ta Electron runtime ölçülmedi.
