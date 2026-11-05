# Faz 1 — denetim günlüğü (P1)

Durum: **düzeltme ve hedefli doğrulama hazır; 30k macro karşılaştırması eksik; merge edilmedi.**

## Değişti

Runtime değişikliği tek satır: `appendAudit` içinde `backupSafeStore(details ?? null)`. Ayrıntısız LOGIN, LOGOUT ve PASSWORD_SETUP kayıtları tüm kullanıcı-erişim deposunu kopyalamaz. `backupSafeStore(value = loadStore())` varsayılanı, redaksiyon ve normal rotasyon korunur. Mevcut/geçmiş audit dosyalarını taşıyan veya yeniden yazan migration yoktur.

30.000 sentetik erişim girdisiyle kalıcı test, taze süreç mikro benchmark'ı ve gerçek uygulama acceptance/PNG aracı eklendi. TR/EN release note ve incelenmiş gerçek post-change PNG aynı PR'dadır. Görsel oturum/yetki ekranını gösterir; satır boyutunu görselden çıkarmıyoruz, aynı oturumun dosyasından doğruluyoruz.

## Doğrulama

- RED: eski kodda `LOGIN details must be null` hatası; diğer üç test geçti.
- GREEN: `npm test -- audit-details-null user-access security-hardening iam-store-fast-path`, **5/5 dosya**. Mevcut rotasyon, backup, owner erişimi ve store testleri korunmuştur. Ayrıntısız üç action, explicit null, nested redaksiyon, varsayılan backup/store temizliği, eski dosya baytlarının değişmemesi testlidir.
- İlk geniş hedefli komut varsayılan gerçek home'a recovery dizini yazma denemesi nedeniyle iki dosyada ENOENT verdi. Test gevşetilmedi: yalnız `BUYER_LOG_DATA_ROOT` / `BUYER_LOG_LOCAL_DATA_ROOT` sentetik temp köklerine yönlendirilerek tekrar çalıştırıldı ve geçti.
- Bağımsız ikinci agent incelemesi **tek tur**: runtime için kritik güvenlik/veri kaybı/uyumluluk bulgusu yok. Testin inherited merkezi IAM ayarından etkilenmesi saptandı; test `BUYER_LOG_CENTRAL_IAM_ENABLED=0` ile izole edildi. Dışarıdan `=1` verilmiş test komutu da sonra geçti. İkinci inceleme turu yapılmadı.
- Gerçek demo uygulama acceptance geçti: PASSWORD_SETUP 376 bayt, LOGIN 360 bayt; `details:null`; `orderAccess` yok. 1440×900 PNG agent tarafından incelendi. İlk görseldeki release-note örtüsü yakalandı, test aracı örtüyü kapatıp yokluğunu doğrulayacak şekilde düzeltildi ve gerçek PNG yeniden çekildi.
- i18n baseline boş; son i18n/release validator sonuçları artifacts altında. Tam regresyon çalıştırılmadı; Faz 6/son program PR'ı henüz gelmedi.

## Ölçüm — önce→sonra medyan

[Doğrulandı] Linux 4 vCPU / 16 GiB, Node 24.19. Her taraf için üç taze süreç; sıra before/after, after/before, before/after. Her süreç aynı 30.000 `{ownerId,canEdit}` sentetik `orderAccess` girdisiyle başlar. Bunlar **audit mikro ölçümleridir**, Excel fixture'ının veya toplam açılış/refresh'in kazancı değildir. Boyuta satır sonu dahildir.

| İşlem | Süre (ms) | Satır (bayt) |
| --- | ---: | ---: |
| LOGIN | 186,557 → 0,995 | 1.602.766 → 375 |
| LOGOUT | 213,145 → 0,079 | 1.602.768 → 377 |
| PASSWORD_SETUP | 204,348 → 0,057 | 1.602.778 → 387 |

[Bilinmiyor] Faz 0'ın 30k açılış koşusu Continue sonrası zaman aşımına uğradığından üç başarılı macro baz/sonra koşusu yok. Açılış, same-tab ve refresh için performans kazancı iddia edilmez. Bu eksik validation nedeniyle PR taslak ve merge blokelidir.

## Kanıt / Tekrar üretim

[Artifacts](phase-1-artifacts/) üçer before/after ham ölçümü, RED, hedefli GREEN ve gerçek oturum acceptance JSON'unu içerir. Mikro araç: `node scripts/benchmark-audit-details.js --app-root <before-or-after-resources/app> --rows 30000`. Her koşu yeni süreçtir. UI: `CHROMIUM_PATH=/usr/bin/chromium node scripts/audit-details-ui-acceptance.js`.

Before uygulama `099776c5` runtime'ı, after runtime commit'i `e14e9941`; final acceptance aracı ayrıca release-note örtüsünü kontrol eder. Benchmark ham ölçümleri kod commit'inden sonraki aynı runtime ile alındı; daha sonraki değişiklikler yalnız test/acceptance, not ve kanıttır.

## GitHub / Yayın / Karar-risk

Faz 0'dan farklı dosyalarda ayrı taslak PR. Gerçek PR bağlantısı ve uzak checks sonucu PR/final teslimde verilir. Merge **yapılmadı**; kullanıcının P1 merge öncesinde durma talimatı uygulanır.

TEST: yapılmadı. STABLE: yapılmadı. Dal koruması doğrulanmadı; etkin olduğu iddia edilmedi. Faz 2–7 başlatılmadı. Programa devam kabulü için önce 30k benchmark blokajının çözülmesi ve istenen üçlü karşılaştırmanın tamamlanması gerekir.
