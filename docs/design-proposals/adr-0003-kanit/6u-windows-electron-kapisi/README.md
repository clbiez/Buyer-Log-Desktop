# 6U · Windows'ta gerçek paketlenmiş BuyerLog.exe kapısı + Windows CI geçici disk teşhisi

## Kapı (PR #1256, `buyerlog-electron-gate.yml`)

- **Koşu:** run 46110833638.
- **Commit:** 57fc699, yani main 825721c + kapı dosyaları; uygulama kodu main ile aynı.
- **Ortam:** kurulum klasöründeki `BuyerLog.exe`, Electron 44.3.0 / Node 24.20.0, win32 10.0.26100, 4× AMD EPYC 7763, RAM 16 GB. NODE_OPTIONS boş; heap bütçesi `BUYER_LOG_MAX_HEAP_MB=3686`.
- **Kurulum yolu:** `release:build` (yalnız derleme) → `build-installer.js` (SHA-sabitli `BuyerLog.exe`) → `extractZipSafe` → `BackendProcess` (watchdog → server).
- **Veri:** sentetik 30k fixture; 7.500 satırda yükleme onayı boşaltıldı.

**Sonuç:**
- 14 kapı PASS; G08b KNOWN. G08b bulgusu Windows'ta da üretildi: bayat istemcinin Supp. FOB kaydı başka oturumun notunu siler.
- Ham rapor: `ham/run46110833638-gate-report.json`.
- Öne çıkan değerler:
  - açılış: soğuk 778 ms, sıcak 721 ms; 30k yenileme 26,7 sn;
  - 503 = 0 / 420 istek;
  - heap sınırı 3782 MB (3686 + genç nesil); ana heap tepe 279 MB; RSS tepe 2519 MB; işçi retained tepe 408 MB;
  - 15 dk soak 64/64 kayıt; artımlı birikim = tam okuma;
  - öksüz süreç yok (4/4 durdurma 7–28 ms).

## Windows CI geçici disk teşhisi (run 46112553159, dal `claude/ci-fs-probe`, merge edilmez)

Aynı runner (4× AMD EPYC 9V74), aynı kod. Defender gerçek zamanlı koruma kapalı.

| Ölçüm | C: varsayılan TEMP | D: `runner.temp` |
|---|---:|---:|
| 4000 küçük dosya yaz + rename (2 tur) | 7579 / 2430 ms | 771 / 751 ms |
| collection-sync-randomized-cloud | 597,3 sn | 83,2 sn |
| collection-sync-causal-cloud | 449,7 sn | 67,5 sn |
| collection-sync-multi-device | 398,3 sn | 63,0 sn |
| Üç dosya, tek batch (c=4) duvar saati | 597,4 sn | 83,3 sn |

**Düzeltme:** PR #1252, Windows tam regresyonda `TEMP`/`TMP` = `runner.temp`.

**Doğrulama:** Buyer Log Tests run 46114356738 (cff0186, 4× AMD EPYC 9V45). Step env'de `TEMP: D:\a\_temp` görünüyor.
- PASS, 1560 dosya, **440,2 sn**. Önceki c=4 koşusu 1729 sn idi.
- Batch 2: 718 → 119,8 sn; kritik yol randomized-cloud 95,4 sn.

## Kapı run 3 — #1257 sonrası (run 46120037740, head 0487102 = main 8a29116 + kapı)

- **Ortam:** 4× AMD EPYC 9V74.
- **Tüm kapılar PASS.** **G08b ve G08d normal kapı olarak geçti:**
  - bayat oturumun Supp. FOB kaydı 409 `REVISION_CONFLICT` aldı, B'nin notu korundu;
  - bayat oturumun not kaydı B'nin daha yeni Supp. FOB'unu korudu.
- G08c N/A: 24.982 satırın tümü DTR. `G08b-eski` / `G08d-eski` INFO: #1257 öncesi istemci gövdesi; sunucu bayat tam gövdeyi kabul eder, koruma istemci sözleşmesindedir.
- G12: heap sınırı 3782 MB, ana heap tepe 283 MB, RSS tepe 2795 MB, peak RSS 3026 MB.
- G13: 71/71 kayıt.
- Ham: `ham/run46120037740-gate-report.json`.
