# Yerel PR taslağı — açılmadı

**Başlık:** Manifest: operasyonlar, kullanıcı yetkileri ve ortak durum pencereleri

**Head:** `ui-rebuild/phase-2-operations`
**Taban:** `ui-rebuild/phase-2-commercial` / `b42b410c` (main'e merge edilmedi).

Veri Yönetimi, Kullanıcılar, Otomasyonlar, LCW AI, rehberler, sürüm notları ve
bildirimler ortak token/bileşen sistemini kullanır. Sekiz modül CSS'i yerleşime
indirildi. LCW AI kayıtları aynı hizada; otomasyonlar numaralı katalog düzeninde.
Küre animasyonları ortak kare durum işaretine dönüştü. İlgili pencerelerin
Tab/Escape/kapanış temizliği ortak katman sistemine bağlandı.

## Gerçek görüntüler

[Veri Yönetimi](ui-rebuild/phase-2-operations/final/source-light.png) ·
[Yetkiler](ui-rebuild/phase-2-operations/states/users-roles-light.png) ·
[Otomasyon kataloğu](ui-rebuild/phase-2-operations/last/automation-create-light.png) ·
[LCW AI](ui-rebuild/phase-2-operations/final/lcwai-records-light.png) ·
[Rehber koyu](ui-rebuild/phase-2-operations/final/guide-dark.png) ·
[Arşiv gri](ui-rebuild/phase-2-operations/final/release-notes-grey.png) ·
[Bildirim](ui-rebuild/phase-2-operations/last/notifications-light.png).

## Yerel doğrulama ve risk

[Hedefli koşular](ui-rebuild/phase-2-operations/checks.json) ve
[faz raporu](ui-rebuild-phase-2-operations.md). Son 43 hedefli test/guard,
38 katman/bileşen testi, 15 gerçek modal klavye denemesi başarılı.
Üç tema ve temsilî dört boyut; sekiz TR/EN release note ve anonim gerçek PNG.
BLPerf: 968.8 / 1046.9 / 3022.4 ms; CP ilk geçişi başlangıçtan 71.5 ms yavaş,
son konsolidasyonda tekrar değerlendirilecek. İş mantığı, yetki, senkronizasyon,
LCW AI motoru, export paleti ve hesaplamalar değişmedi.

P2: görünüm ve yerel pencere erişilebilirliği. Ürün çapındaki son matris ve tam
test henüz yapılmadı; kalan ekranlar ve geçici stil katmanı temizliği devam ediyor.

**Ara PR'da tam `npm test` çalıştırılmadı. Tüm uygulama ve Faz 3 tamamlandıktan
sonra proje sonunda çalıştırılacaktır.**

PR/push: yapılmadı; main PR'ı onaysız Actions tetikler. CI: çalışmadı.
Merge: yapılmadı. TEST: yayınlanmadı. STABLE: yayınlanmadı.
