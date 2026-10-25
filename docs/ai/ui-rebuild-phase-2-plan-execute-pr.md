# Yerel PR taslağı — açılmadı

**Başlık:** Manifest: Planla & Yürüt tabloları, analizler ve ortak detay pencereleri

**Head:** `ui-rebuild/phase-2-plan-execute`
**Taban:** `ui-rebuild/phase-1-manifest` / `2324ba7c` (henüz main'e merge edilmedi).

Siparişler, Backlog ve Nakliye'nin farklı görünüm kuralları ortak Manifest
kaynağına taşındı. CP kuralları/alanları, pivot, navlun ve ortak ayrıntı çekmecesi
aynı kontrolleri kullanır. Ana sütun grupları iki başlık satırında ince çizgiyle
ayrılır; veri satırlarında dikey çerçeve yoktur. Tamamlanma göstergeleri doğrusal,
grafik marker'ları karedir. Modül CSS'leri yerleşim/veri geometrisiyle sınırlıdır.

Klavye odağı modal içinde kalır. Nakliye'nin canlı CSS okuyan genel Excel yolu
eski çıktı paletine bağlandı; iş hesapları, canonical ID, senkronizasyon ve LCW AI
motoru değişmedi. Beş TR/EN release note ve gerçek PNG eklendi.

## Gerçek görüntüler

[Siparişler](ui-rebuild/phase-2-plan-execute/screens/orders-light.png) ·
[Backlog gri](ui-rebuild/phase-2-plan-execute/screens/backlog-grey.png) ·
[Nakliye koyu](ui-rebuild/phase-2-plan-execute/screens/shipping-dark.png) ·
[CP kuralları](ui-rebuild/phase-2-plan-execute/final/cp-rules-light.png) ·
[Ayrıntı ve alanlar](ui-rebuild/phase-2-plan-execute/final/cp-detail-columns-light.png) ·
[Kare grafik işaretçileri](ui-rebuild/phase-2-plan-execute/final/backlog-pivot-line-light.png).

## Yerel kontroller ve risk

Son değişen testler 155/155; drawer/keyboard, chart, component ve token guard
sonuçları [kontrol kaydında](ui-rebuild/phase-2-plan-execute/checks.json).
3 temada 27 export referansı eşdeğer; CP'nin 216 başlık renk örneği değişmedi.
3 tema ve 4 boyut temsilî görüntülerinde geometri/kontrast/taşma kontrolleri yapıldı.
BLPerf: açılış 901.9 ms, CP geçiş 1067.2 ms, 5000 kayıt 3044.0 ms; 50 DOM satırı,
gizli modüller lazy. CP geçişi başlangıçtan +91.8 ms; final konsolidasyonda izlenecek.

**Ara PR'da tam `npm test` çalıştırılmadı. Kapsamlı test, tüm modüller ve Faz 3
bittikten sonra proje sonunda yapılacaktır.** Bu yerel sonuçlar CI sonucu değildir.
P2; CSS kademesi geçici olarak eski modüllerle birlikte çalışır. Kalan envanter,
legacy alias kaldırma ve bütün görsel matris sonraki gruplardadır.

## İş akışı

PR/push yapılmadı: main hedefli PR otomatik `buyerlog-pr-fast-checks.yml` Actions
çalıştırır; Actions için kullanıcı onayı yoktur. Workflow bypass edilmedi.
CI: çalışmadı. Merge: yapılmadı. TEST: yayınlanmadı. STABLE: yayınlanmadı.
