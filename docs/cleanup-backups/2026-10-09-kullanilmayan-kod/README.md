# Kullanılmayan kod temizliği — yedek ve geri dönüş

**Tarih:** 2026-10-09 · **Temel:** `main` `f6b96edae75e2aecc85f4c66c5d0f47e1e249993` (v7.0.264)
· **Git etiketi:** `backup/pre-dead-code-cleanup-2026-10-09` (etiket push edilebildiyse)

Bu klasör, 8 Ekim 2026 mimari/performans raporundaki kullanılmayan kod
listesinin **1. adımında** silinen her şeyin birebir yedeğidir. Silinenler:

- Üretimde hiçbir yerden çağrılmayan ve hiçbir testte adı geçmeyen **61 üst düzey fonksiyon**
  (~27,7 bin karakter)
- Hiçbir yerden yüklenmeyen eski Excel COM pivot sarmalayıcısı:
  `server/lib/createBacklogPivot.js` + `server/lib/CreateBacklogPivot.ps1`

Kullanıcıya görünen davranış değişmez; bu yüzden release-note kaydı yoktur.

*English: backup of the 2026-10-09 dead-code cleanup (61 unreferenced top-level
functions and the unused Excel COM pivot wrapper). Roll back with `git revert`
of the removal commit or with `node restore.js` below.*

## Geri dönüş yolları

### 1. En kolay ve birebir: silme commit'ini geri al

```bash
# Silme commit'ini bul (bu klasörü ekleyen commit'ten hemen sonraki commit)
git log --oneline -- resources/app/server/lib/createBacklogPivot.js
git revert <silme-commit-sha>
```

`git revert` sonradan yapılan değişiklikleri korur ve yalnız bu temizliği geri alır.

### 2. Git gerektirmeyen / seçmeli geri yükleme

```bash
# Önce ne yapacağını gör (dosya yazmaz)
node docs/cleanup-backups/2026-10-09-kullanilmayan-kod/restore.js --dry-run
# Hepsini geri yükle
node docs/cleanup-backups/2026-10-09-kullanilmayan-kod/restore.js
# Yalnız belirli fonksiyon(lar)
node docs/cleanup-backups/2026-10-09-kullanilmayan-kod/restore.js --only=exportCsv,cpRowsScoped
# Yalnız silinen iki dosya
node docs/cleanup-backups/2026-10-09-kullanilmayan-kod/restore.js --files-only
```

- Her fonksiyon, `removed-functions.json` içindeki birebir metniyle, orijinal
  komşu metin bulunursa **tam eski yerine** eklenir. Dosya o bölgede sonradan
  değiştiyse fonksiyon dosyanın sonuna eklenir. Bunlar üst düzey fonksiyon
  bildirimleri olduğu için (hoisting) davranış aynıdır.
- Aynı adlı fonksiyon zaten varsa ona dokunulmaz; script tekrar çalıştırılabilir.
- Değişen her JS dosyası yazılmadan önce `node --check` ile doğrulanır.
- Silinen dosyalar `files/` altında `.bak` uzantısıyla birebir durur.
- `server/*.js` geri yüklendiyse Buyer Log yeniden başlatılmalıdır. İstemci
  dosyalarında sayfayı yenilemek yeter.

Doğrulama (2026-10-09): Temizlenmiş ağaçta script çalıştırıldı. 61 fonksiyonun
hepsi eski yerine döndü ve 10 dosyanın 8'i temel commit ile bayt bayt aynı
çıktı. Kalan iki dosyadaki tek fark, silinen fonksiyon adlarını anan 3 yorum
satırının güncellenmiş halidir.

### 3. Temel durum

Temizlik öncesi kodun tamamı `main` geçmişinde `f6b96ed` commit'inde durur
(etiket: `backup/pre-dead-code-cleanup-2026-10-09`).

## Doğrulama özeti

- Üretim referans taraması: 61 fonksiyonun hiçbiri `public`, `server`,
  `electron`, HTML, PS1 veya workflow dosyalarında adıyla geçmiyor. Dinamik
  `window[...]` çağrıları yalnız sabit ve farklı adlar kullanıyor.
- Silme sonrası: tüm değişen dosyalar sözdizimi kontrolünden geçiyor, sunucu
  modülleri yükleniyor, eslint `no-undef` ile yeni tanımsız referans yok.
- `npm test`: tam paket temizlik öncesi ve sonrası geçiyor.

## Bilerek SİLİNMEYENLER (raporun kalan 28 adayı)

Bu adaylar üretimde çağrılmıyor ama kaynak metnini okuyan testlerde ankraj ya
da sözleşme olarak geçiyor. Silinirlerse 22 test dosyası kırılır. Ancak testler
canlı davranışı sınayacak biçimde güncellenerek, ayrı bir değişiklikte
silinmelidir. Ayrıca:

- `ensureLegacyCollectionOwnerRecovery`, `sharedCollectionModeEnabled`:
  elle/forensic Koleksiyon sahiplik kurtarması ve eski tanılama uyumluluğu.
  **Korunmalı.**
- `refreshEtaPanelHtml`: yenileme ETA kartı hiç çizilmiyor. Ölü koddan çok
  bağlanmamış bir özellik olabilir; ürün kararı gerekiyor.
- `server/lib/oab-metadata-store.js`: üretimde yerini `oab-static-metadata`
  almış. Yalnız `tests/oab-module.test.js` kullanıyor; testle birlikte ele
  alınmalı.

## Silinen 61 fonksiyon (orijinal konum, temel commit'e göre)

| Fonksiyon | Konum |
|---|---|
| `transitDaysForPriority` | `public/app-main.js:872` |
| `cpImagePayload` | `public/app-main.js:3231` |
| `cpLogisticArrivalCellHtml` | `public/app-main.js:5455` |
| `singleHeaderFilterValue` | `public/app-main.js:6006` |
| `withExcludedColumnFilters` | `public/app-main.js:6075` |
| `cpOrdersRecordImageCopyCell` | `public/app-main.js:8215` |
| `passesCpDimFilters` | `public/app-main.js:8423` |
| `seasonSortParts` | `public/app-main.js:8890` |
| `cpRowsScoped` | `public/app-main.js:8945` |
| `saveWorkbookBufferWithValidations` | `public/app-main.js:10024` |
| `exportCsv` | `public/app-main.js:10035` |
| `overviewCollectionSummaryPivotColumns` | `public/app-main.js:10275` |
| `matchFieldLabel` | `public/app-main.js:11652` |
| `modelAllowedTargets` | `public/app-main.js:11713` |
| `modelScopeLabel` | `public/app-main.js:11714` |
| `modelConnSchemaEntries` | `public/app-main.js:11778` |
| `modelConnEntryId` | `public/app-main.js:11782` |
| `modelConnDistinct` | `public/app-main.js:11786` |
| `modelConnKnownSeasons` | `public/app-main.js:11796` |
| `transitRuleListLabel` | `public/app-main.js:11871` |
| `isReadOnlyMode` | `public/app-main.js:13674` |
| `clearActiveProfileSelection` | `public/app-main.js:16079` |
| `backlogSelectionFor` | `public/app-main.js:16512` |
| `backlogPruneSelection` | `public/app-main.js:16527` |
| `buildBacklogPivotSheet` | `public/app-main.js:17915` |
| `buildBacklogPivotDataSheet` | `public/app-main.js:17954` |
| `kolScopeDimRows` | `public/app-main.js:21865` |
| `updateKolScopePresetButtons` | `public/app-main.js:21868` |
| `kolIsoWeekYear` | `public/app-main.js:22363` |
| `genericCaptureRowTarget` | `public/app-main.js:25020` |
| `kolEditorAtHorizontalBoundary` | `public/app-main.js:25236` |
| `kolMoneyDisplay` | `public/app-main.js:25411` |
| `plmSyncPageLabel` | `public/app-main.js:31114` |
| `kolExportRows` | `public/app-main.js:31944` |
| `kolColHeaders` | `public/app-main.js:31945` |
| `kolPlainTextTable` | `public/app-main.js:32065` |
| `pricingCompressToTarget` | `public/app-main.js:32767` |
| `pricingMakeBlobFile` | `public/app-main.js:32873` |
| `pricingChunkBlob` | `public/app-main.js:32877` |
| `pricingAttachmentWeight` | `public/app-main.js:32892` |
| `prepareEmailTopicTableHtml` | `public/app-main.js:33442` |
| `prepareEmailGenericPlain` | `public/app-main.js:33497` |
| `deltaReadsStore` | `server/db.js:98` |
| `scopedFxFile` | `server/db.js:176` |
| `waitForCdp` | `server/lib/agent-browser-connector.js:315` |
| `connectManagedEdge` | `server/lib/agent-browser-connector.js:593` |
| `publicStep` | `server/lib/agent-browser-connector.js:624` |
| `daxNumber` | `server/lib/modelHorizon.js:112` |
| `antrepoLooseColourKey` | `server/lib/parse.js:267` |
| `uniqueDateFromEntries` | `server/lib/parse.js:334` |
| `uniqueTextFromEntries` | `server/lib/parse.js:343` |
| `normalizeMatchSide` | `server/lib/parse.js:400` |
| `enrichOrder` | `server/lib/parse.js:2493` |
| `monthSortKey` | `server/lib/parse.js:2824` |
| `weekSortKey` | `server/lib/parse.js:2826` |
| `backlogCustomDimensionInfo` | `server/lib/parse.js:2858` |
| `atomicBuffer` | `server/lib/shared-image-store.js:167` |
| `validAccessStoreFile` | `server/lib/user-access.js:98` |
| `plmImageRefreshCounts` | `server/server.js:3941` |
| `alignSnapshotWithExcelAntrepo` | `server/server.js:6423` |
| `loadLflFromDisk` | `server/server.js:6531` |
