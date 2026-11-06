# Faz 1 — denetim günlüğü (P1)

Durum: **düzeltme, bağımsız inceleme ve üç before/üç after macro koşusu tamamlandı; merge öncesinde duruldu.** Faz 2+ başlatılmadı; programın tamamı bitmedi.

## Değişti

Runtime değişikliği tek satır: `appendAudit` içinde `backupSafeStore(details ?? null)`. Ayrıntısız LOGIN, LOGOUT ve PASSWORD_SETUP kayıtları tüm kullanıcı-erişim deposunu kopyalamaz. `backupSafeStore(value = loadStore())` varsayılanı, redaksiyon ve normal rotasyon korunur. Mevcut/geçmiş audit dosyalarını taşıyan veya yeniden yazan migration yoktur.

30.000 sentetik erişim girdisiyle kalıcı test, taze süreç mikro benchmark'ı ve gerçek uygulama acceptance/PNG aracı eklendi. TR/EN release note ve incelenmiş gerçek post-change PNG aynı PR'dadır. PNG gerçek yetkili oturumu gösterir; satır boyutu ve null sonucu aynı oturumun dosyasından doğrulanır.

## Doğrulama

- RED: eski kodda `LOGIN details must be null`; diğer üç test geçti.
- GREEN: `npm test -- audit-details-null user-access security-hardening iam-store-fast-path`, **5/5 dosya**. Ayrıntısız üç action, explicit null, nested redaksiyon, varsayılan backup/store temizliği, rotasyon/retention, owner erişimi ve eski dosya baytlarının değişmemesi testlidir.
- İlk iki mevcut test gerçek home'a recovery dizini açma denemesinde ENOENT verdi. Test gevşetilmedi; yalnız sentetik DATA_ROOT/LOCAL_DATA_ROOT verilerek tekrarlandı ve geçti.
- Bağımsız ikinci agent incelemesi **tek tur**: kritik runtime bulgusu yok. Inherited merkezi IAM ayarından etkilenme testte `BUYER_LOG_CENTRAL_IAM_ENABLED=0` ile giderildi; dışarıdan =1 verilen senaryo da geçti. İkinci tur yapılmadı.
- Gerçek demo acceptance geçti: PASSWORD_SETUP 376, LOGIN 360 bayt; details:null, orderAccess yok. 1440×900 PNG incelendi. İlk örtülü görsel, release-note diyaloğunun yokluğunu doğrulayan acceptance ile yeniden çekildi.
- i18n yeni 0 / baseline 0; release:notes:validate 16 kayıt GREEN. Tam suite çalıştırılmadı; Faz 6/son program PR'ı henüz gelmedi.
- **3/3 before + 3/3 after tam macro GREEN**: aynı fixture SHA, 30.000 Orders/Overview, 24.982 CP, boş Koleksiyon; generation/revizyon ve aynı sekme kontrolleri geçti, pageerror yok. Üç after kökünün gerçek session audit dosyaları ayrıca kontrol edildi: ayrıntılar null, satırlar <1 KiB ve orderAccess yok.

## Ölçüm — audit mikro medyanları

[Doğrulandı] Linux 4 vCPU / 16 GiB, Node 24.19. Her taraf için üç taze süreç; before/after → after/before → before/after. Her süreç aynı 30.000 sentetik `{ownerId,canEdit}` orderAccess girdisiyle başlar. Süre yalnız appendAudit çağrısına, boyut satır sonuna dahildir.

| İşlem | Süre (ms) | Satır (bayt) |
| --- | ---: | ---: |
| LOGIN | 186,557 → 0,995 | 1.602.766 → 375 |
| LOGOUT | 213,145 → 0,079 | 1.602.768 → 377 |
| PASSWORD_SETUP | 204,348 → 0,057 | 1.602.778 → 387 |

## Ölçüm — 30k macro, üçlü medyanlar

[Doğrulandı] Aynı Linux/Chromium ortamı, aynı 05.11 seed=7 kaynak baytları, taze veri kökleri, backend restart ve aynı `8e5a66fc` harness kodu. Runtime before `099776c5` + benchmark değişiklikleri; after audit runtime `e14e9941` / PR kaynağı `ef6610d7`. Sonraki değişiklikler yalnız acceptance/not/kanıttır.

Refresh: **53,23 → 48,09 sn**. Aralıklar 42,46–57,39 → 46,34–49,62 sn.

| Modül | Primary hazır (sn) | Gate hazır (sn) | Sistem complete (sn) |
| --- | ---: | ---: | ---: |
| overview | 4,26 → 4,54 | 38,72 → 37,01 | 152,69 → 124,50 |
| koleksiyon | 12,84 → 12,86 | 31,23 → 31,48 | 31,29 → 31,57 |
| cp | 5,93 → 6,66 | 54,94 → 60,58 | 190,16 → 193,53 |
| orders | 6,43 → 6,64 | 22,68 → 23,33 | 22,76 → 23,40 |

Aynı sekme CP 14,00 → 11,01 sn; Orders 2,15 → 1,84 sn; Koleksiyon 0,10 → 0,11 sn.

/api/status refresh p95 medyanı 25.25 → 27.21 ms. /api/health bu runtime'da 404 döner; başarısız HTTP round-trip refresh p95 medyanı 646.00 → 754.05 ms; çalışan health endpoint'i gibi sunulmaz.

[Doğrulandı] Audit'in kendisindeki süre/boyut kazanımı mikro ölçümde ve gerçek session dosyalarında görüldü. Macro sürelerdeki değişkenlik ve trace'teki uzun senkron karar hesabı nedeniyle toplam açılış/refresh kazancı audit düzeltmesine atfedilmedi. Force-GC yok; heap uncollected. Fixed long-task penceresi 10 sn, renderer bekleme bütçesi 900 sn; Continue işleme gecikmesi sistem süresinde kalır. Tüm kökler aynı yakın-zamanlı haftalık kontrol state'iyle başladı; cache silme kontrolü gevşetilmedi. Windows/Electron ve soğuk OS disk cache ölçülmedi.

Gerçek 30k macro oturumlarında en büyük LOGIN satırının üçlü medyanı **2.485.108 → 360 bayt** oldu; üç before dosyasında ve üç after dosyasında bu boyutlar aynıydı. Bu ölçüm mikro fixture satır boyutundan ayrıdır.

## Kanıt / Tekrar üretim

[v3 karşılaştırma özeti](phase-1-artifacts/v3/summary.json), [SHA manifest'i](phase-1-artifacts/v3/manifest.json), [gerçek session ölçümleri](phase-1-artifacts/v3/session-audits.json) ve aynı klasördeki üç after JSON.gz. [Before ham ölçümler ve Faz 0](https://github.com/clbiez/Buyer-Log-Desktop/pull/872) merge edildi. İlk micro/RED/hedefli GREEN/UI acceptance kanıtları önceki artifacts altında korunur.

Mikro: `node scripts/benchmark-audit-details.js --app-root <before-or-after-resources/app> --rows 30000`. Macro: Faz 0 harness'i, aynı kaynak fixture'ıyla `--app-root` hedefi değiştirilerek çalıştırılır. UI: `CHROMIUM_PATH=/usr/bin/chromium node scripts/audit-details-ui-acceptance.js`.

## GitHub / Yayın / Karar-risk

[Faz 1 PR #873](https://github.com/clbiez/Buyer-Log-Desktop/pull/873), merge **yapılmadı**. Final head CI sonucu PR açıklamasında/final teslimde verilir; eski head'in yeşil sonucu kullanılmaz. Kullanıcının P1 merge öncesinde durma talimatı korunur. Faz 0 #872 `b266980d` ile merge edildi. Public branch API kontrolünde main protected=false; koruma etkin varsayılmadı.

TEST: yapılmadı. STABLE: yapılmadı. Faz 2–7 başlatılmadı. Erken checklist prototipi uygulanmadı; kullanıcı faz sırasını korumayı seçti.
