# Faz 2 — dense kaynak okuması (P1)

## Uygulama ve kapsam

Yalnız `server/workers/excel-worker.js` kaynak `readWorkbook` yolu `dense:true` kullanır (ASAS, Antrepo, CPUpdate, LFL). FX, şablon, `parseLflBuffer` ve istemci okuma seçenekleri değiştirilmedi. `repairReadDateCells` dense `!data` satırlarını aralık sınırları içinde dolaşır; sparse davranışı, delikler, geçersiz tarihler ve gerçek saatler korunur. Parser guard → tarih kancası sırası korunur.

## Kanıt

- Eski kodda iki tarih testi RED; düzeltmeyle GREEN. Üç seed × dört parser = 12 tam çıktı karşılaştırması; Antrepo non-enumerable metadata ayrıca karşılaştırılır. Gerçek worker testi altı source read için dense/cellDates:false, buffer read için sparse/cellDates:true doğrular.
- `npm test -- excel-source-dense excel-date-timezone excel-worker-queue file-parser-isolation original-exf-asas-date lfl-period-date-fields antrepo-excel-source`: 7/7 dosya GREEN. Üç ayrı TZ sürecinde 15/15 test GREEN (UTC, Europe/Istanbul, America/New_York).
- Mevcut parser-isolation testinin ilk hatası erişilemeyen home recovery yoluydu; test gevşetilmedi, sentetik veri kökleriyle geçti. Yeni midnight fixture UTC seri numarasını yerel gece yarısı varsayıyordu ve sparse da hata veriyordu; fixture offset ile düzeltildi, assertler korunarak üç TZ geçti.
- Tek bağımsız inceleme: kritik runtime bulgusu yok. UI acceptance yanlış storage anahtarı bulgusu RED/GREEN düzeltildi; gerçek etkin dil ve tema assert edilir. TR/light ve EN/dark gerçek PNG incelendi; TR/EN release note var. i18n yeni 0/baseline 0; release notes 17 kayıt GREEN.
- 3/3 tam 30k after macro GREEN; row/generation/revizyon/cache ve aynı-sekme kontrolleri geçti; pageerror yok. Tam suite bu fazda çalıştırılmadı.

## Ölçüm

Linux 4 vCPU / 16 GiB, Node 24.19, sistem headless Chromium. Aynı 05.11 seed=7 fixture baytları. Runtime before audit düzeltmesi e14e9941 / PR branch 529b9d36, after 13a90a31. Üç macro before Faz 1 after koşularıdır; üç after taze fixture kökleri, aynı v3 harness, sabit 10 sn task penceresi. Haftalık bakım state yakın zamanda tamamlanmış olarak seed edilir; bakım/generation kontrolü gevşetilmez. GC zorlanmaz; heap uncollected. Windows/Electron ve soğuk OS disk cache ölçülmedi.

[Doğrulandı] Taze süreç ve gerçek Excel worker mikro ölçümü before/after → after/before → before/after: ASAS okuma + ASAS/LFL parse gerçek worker task execution medyanı (execute içindeki modül kurulumu dahil) **15.603 → 8.383 sn** (46.3% daha kısa). Altı sonuç SHA-256 birebir aynı. Bu süre yalnız bu task için geçerlidir; toplam refresh kazancı değildir. Parent round-trip worker açılışı, mesaj aktarımı ve alımını da içerir; saf deserialize süresi diye sunulmaz.

İlk mikro örneklemde bazı koşular yerel hedefli testlerle örtüştü; `preliminary-source` altında etiketli saklandı ve nihai performans karşılaştırmasına alınmadı. Nihai v2 mikro koşuları tüm macro süreçlerinden sonra, eşzamanlı yerel test/UI/benchmark başlatılmadan çalıştırıldı.

[Doğrulandı] Tam refresh medyanı Faz 1 **48.088 → 40.679 sn**. İlk Faz 0 baz medyanı 53.231 sn. Dağılımlar ham JSON ve özette saklı; toplam açılış veya tüm platformlar için sabit kazanç iddiası yok.

[Doğrulandı] CP gate/system-complete ve aynı-sekme medyanları bu macro serisinde kötüleşti; Orders medyanları da arttı. [Bilinmiyor] Bu farkların kaynağı bu sıralı macro koşularıyla izole edilmedi. Dense sonrası toplam istemci hızlanması iddia edilmiyor; kaynak task kazanımı ayrı, dönüşümlü ölçüm ve birebir çıktı SHA eşitliğiyle destekleniyor.

| Modül | Primary hazır sn | Gate hazır sn | Sistem complete sn |
| --- | ---: | ---: | ---: |
| overview | 4.54 → 4.75 | 37.01 → 57.14 | 124.50 → 57.26 |
| koleksiyon | 12.86 → 3.10 | 31.48 → 24.96 | 31.57 → 25.04 |
| cp | 6.66 → 6.12 | 60.58 → 72.07 | 193.53 → 224.60 |
| orders | 6.64 → 7.06 | 23.33 → 25.72 | 23.40 → 25.79 |

Aynı sekme medyanları: cp 11.012 → 12.942 sn, orders 1.841 → 1.998 sn, koleksiyon 0.112 → 0.158 sn.

/api/status refresh p95 medyanı 27.21 → 28.60 ms. /api/health handler yok; 404 RTT p95 medyanı 754.05 → 177.10 ms yalnız başarısız HTTP round-trip ölçümüdür. Ham durumlar ve event-loop-stall satırları raporlarda korunur; varsayılan 3 sn stall eşiği 200 ms kabulünü kanıtlamaz.

## Tekrar üretim ve risk

`node scripts/benchmark-source-dense.js --app-root <resources/app> --source-fixture <synthetic-30k-source>`; her örnek ayrı süreç. Macro: Faz 0 aynı komutu ve fixture, after app-root değiştirilir. [Özet ve ham SHA manifesti](phase-2-artifacts/summary.json); aynı dizinde sıkıştırılmış üç macro JSON, source v2 örnekleri, test ve reviewer kanıtı. Önceki macro kanıtı Faz 1 PR/artifacts içindedir.

P1 bağımsız inceleme tek tur tamamlandı. Yeni kullanıcı talimatı ara rapor ve merge beklemesini kaldırdı; yalnız yeşil PR checks ile merge edilebilir. Gerçek PR/CI/merge durumu PR açıklamasında ve program final raporunda tutulur. main protected=false önceki public API kontrolünden biliniyor, koruma etkin varsayılmadı. TEST: yapılmadı. STABLE: yapılmadı. Faz 3+ henüz uygulanmadı.

## Refresh telemetrisi — üçlü medyan

| İşlem | Önce sn | Sonra sn |
| --- | ---: | ---: |
| ASAS Excel/file-parse | 18.449 | 12.833 |
| ANTREPO Excel/file-parse | 1.667 | 1.458 |
| Local storage/snapshot-save | 7.673 | 8.203 |
| Local storage/page-cache-write | 17.140 | 16.060 |

Linux üzerinde Microsoft Excel pivot yenilemesi çalışmaz; fixture önceden üretilmiş sabit hücre değerleridir. Pivot-refresh unsupported kayıtları before ve after ham telemetride korunur; job error null ve veri eşdeğerlik kontrolleri başarılıdır. Windows Excel/Electron davranışı bu ölçümden çıkarılmaz.
