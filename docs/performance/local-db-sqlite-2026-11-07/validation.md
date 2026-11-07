# Doğrulama / Validation

7 Kasım / November 2026. Risk: **P2, izole prototip / isolated prototype**.
Ürün depolama davranışı değişmedi; gelecekteki migrasyon P1 olarak ayrı
değerlendirilmelidir. / Product storage behavior is unchanged; a future migration
needs a separate P1 assessment.

## Sonuçlar / Results

| Kontrol / Check | Sonuç / Result | Kanıt / Evidence |
| --- | --- | --- |
| Electron 39.0.0 `node:sqlite` runtime | [Doğrulandı] Node 22.20.0, SQLite 3.50.4, ABI 140 | `raw.json.environment.versions` |
| 10k/50k/200k, 3 dönüşümlü koşu / alternating trials | [Doğrulandı] 18/18 başarılı / passed | [raw.json](raw.json), `validation=passed` |
| Gerçek SIGKILL / actual SIGKILL | [Doğrulandı] 18/18; onaylı yazılar korundu / acknowledged writes retained | `raw.json.crashes` |
| İş verisi, event IDs, pending, sayaçlar / business data, counts | [Doğrulandı] Her koşu çifti ve compaction sonrası yeniden açılış eşleşti / each pair and reopen matched | Harness assertions, `finalDigest`, `eventIds`, `countsAfter`, `reopened` |
| Prototip semantiği ve hata sınırları / prototype semantics and failure boundaries | [Doğrulandı] 4/4 | [prototype-tests.tap](prototype-tests.tap) |
| Mevcut local-db compaction/crash/WAL/business/HLC | [Doğrulandı] 45/45 | [local-db-tests.tap](local-db-tests.tap) |
| Agent/i18n/release-note sözleşmeleri / contracts | [Doğrulandı] 19/19 | [contract-tests.tap](contract-tests.tap) |

TR: Yerel testler CI sonucu değildir. Tam `npm test` çalıştırılmadı; ürün
değişmediği için hedefli DB ve sözleşme kontrolleri seçildi. Son testlerden
sonra çalışma zamanını etkileyen prototip kodu değiştirilmedi. Rapor
üreticisinin başlık/medyan hesapları ayrı çalıştırıldı. Kaynak hash'leri gerçek
ölçümde yürütülen dört çekirdek prototip dosyasıyla ve iki ürün kaynağıyla eşleşti.

EN: Local tests do not establish CI status. The full `npm test` suite was not
run; targeted DB and contract checks were selected because product behavior is
unchanged. No runtime-affecting prototype change followed the final tests.
Report formatting/median generation was run separately. Recorded source hashes
match the four executed core prototype files and two product source files.

## Komutlar / Commands

Depo kökünden / From repository root; `electron` is an absolute path to the
official Linux x64 Electron 39.0.0 executable:

```sh
ELECTRON_RUN_AS_NODE=1 /absolute/path/to/electron --expose-gc \
  scripts/prototypes/local-db-sqlite/benchmark.cjs

ELECTRON_RUN_AS_NODE=1 /absolute/path/to/electron --test \
  scripts/prototypes/local-db-sqlite/prototype.test.cjs

ELECTRON_RUN_AS_NODE=1 /absolute/path/to/electron --test \
  resources/app/tests/local-db-compaction.test.js \
  resources/app/tests/local-db-crash-recovery.test.js \
  resources/app/tests/local-db-wal-v807.test.js \
  resources/app/tests/local-db-wal-tail-recovery.test.js \
  resources/app/tests/local-db-wal-metadata.test.js \
  resources/app/tests/local-db-business-integrity.test.js \
  resources/app/tests/local-db-hlc-v20261009.test.js

cd resources/app
node --test tests/agent-instructions.test.js \
  tests/i18n-coverage-guard.test.js \
  tests/visual-release-notes-v70211.test.js \
  tests/page-horizon-badges-removal-v20261025.test.js
```

TR: Resmi ölçüm 7 Kasım 2026 **20:31:40–20:38:06 Europe/Istanbul** aralığında
koştu. İlk smoke/keşif koşuları rapora alınmadı. DB regresyonları önce tamamlandı;
resmi ölçümde eşzamanlı test/build yoktu. Son prototip ve sözleşme kontrolleri
ölçüm bittikten sonra çalıştırıldı. Ham kayıttaki zaman damgaları UTC'dir.

EN: The official measurement ran on 7 November 2026 at **20:31:40–20:38:06
Europe/Istanbul**. Initial smoke/exploratory runs are excluded. DB regressions
finished before the official run; no test/build overlapped it. Final prototype
and contract checks ran after measurement. Raw timestamps use UTC.

## Açık bulgu / Open finding

TR: Üç 200k JSON performans koşusunun her biri aşağıdaki uyarıyı verdi. API
çağrıları başarılı döndü; iş verisi ve yeniden açılış doğrulamaları geçti.
Kaynakta değişiklik yapılmadı. Bu yalnızca bir log gözlemidir; veri kaybı veya
gerçek sahiplik devrinin kanıtı değildir. Logdaki değişken kimlikler/yollar
aşağıda yer tutucuyla gösterilmiştir.

EN: Each of the three 200k JSON performance trials emitted the following
warning. API calls returned successfully and business-data/reopen assertions
passed. No source fix was applied. This is a log observation, not evidence of
data loss or actual ownership transfer. Variable identities/paths are shown as
placeholders below.

```text
[LEASE] renew:failed instanceId=<trial-id> pid=<worker-pid> resource=<synthetic-trial>/BuyerLogLocal.db error=SHARED_LEASE_LOST
```

**[Hipotez / Hypothesis]** `shared-file-transaction.js` rejects renewal for a
completed scope, and drains any outstanding renewal during cleanup
(`acquireAsync`, `renew`, `drainRenewal`, `withFileLeaseAsync`). A completion/renewal
race could explain this warning, but no focused reproduction established the
root cause. **[Bilinmiyor / Unknown]** Concurrent-writer consequences.
TR: Ayrı takip gerekir; bu PR ürün koduna dokunmaz. / EN: Follow up separately;
this PR does not change product code.

TR: Native `better-sqlite3`, imzalı Windows paketleme, Electron 44, tam sync
eşitliği, cold-cache/disk-full/güç kesme ve bütün compaction kesinti aralıkları
sınanmadı. / EN: Native `better-sqlite3`, signed Windows packaging, Electron 44,
complete sync equivalence, cold cache/disk full/power loss and all compaction
interruption boundaries were not tested.

TR: PR ve GitHub checks'in canlı durumu PR sayfasındadır; bu dosya CI başarısı
iddia etmez. Merge için kullanıcı kararı gerekir. TEST/STABLE yayınlanmadı.

EN: The PR page holds live GitHub check status; this file makes no CI-success
claim. Merge requires the user's decision. No TEST/STABLE publication.
