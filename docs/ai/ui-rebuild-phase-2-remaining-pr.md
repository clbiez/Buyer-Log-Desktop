# Yerel PR taslağı — açılmadı

**Başlık:** Manifest: yardımcı ekranlar, içe aktarma ve çıktı pencereleri

**Head:** `ui-rebuild/phase-2-remaining`
**Taban:** `ui-rebuild/phase-2-operations` / `555a1b48` (merge edilmedi).

Kalan sekiz modülün görünümü ortak token/bileşen kaynağına taşınır. Komut ve
arama yardımı, tarih seçimi, Excel araçları, Layout Kontrolü, çıktı editörü ve
Overview düzenlemesi aynı dili kullanır. Dosya seçimi klavyeyle erişilir;
nested çıktı şablonunda Tab/Escape yalnız etkin formu yönetir. Native aralık
kontrolleri kare tutamaçlıdır. Veri/iş mantığı ve tüm DOM kancaları korunur.

## Gerçek görüntüler

[Arama](ui-rebuild/phase-2-remaining/screens/search-help-light.png) ·
[Excel şablonu](ui-rebuild/phase-2-remaining/states/excel-templates-grey.png) ·
[Çıktı yerleşimi](ui-rebuild/phase-2-remaining/final/output-layout-light.png) ·
[Widget kataloğu](ui-rebuild/phase-2-remaining/screens/overview-widgets-grey.png) ·
[Royalty](ui-rebuild/phase-2-remaining/final/royalty-light.png) ·
[1280 XL](ui-rebuild/phase-2-remaining/final/import-dark-xl.png).

## Doğrulama ve risk

[Faz raporu](ui-rebuild-phase-2-remaining.md) ve
[hedefli kontroller](ui-rebuild/phase-2-remaining/checks.json). Son ilgili
47 ve 49 test, 6 ortak guard, 24 gerçek pencere klavye senaryosu başarılı.
46 export referansla eşit. Üç tema ve dört boyutun temsilî kapsamı, 5 TR/EN
release note+gerçek PNG. İlk başarısızlıklar raporda korunur.

P2: geniş görünüm kapsamı ve yerel modal odak davranışı. Geçici stil katmanları
ve son ürün çapındaki matris Faz 3'te tamamlanacak. **Ara PR'da tam npm test
çalıştırılmadı; proje sonunda çalıştırılacaktır.**

PR/push yok: main PR'ı onaysız Actions tetikler. CI: çalışmadı.
Merge: yapılmadı. TEST: yayınlanmadı. STABLE: yayınlanmadı.
