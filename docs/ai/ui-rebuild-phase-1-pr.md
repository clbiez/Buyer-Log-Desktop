# Yerel PR taslağı — henüz açılmadı

**Başlık:** Manifest Faz 1: ortak UI temeli, CP başlık ayırıcıları ve Overview pilotu

**Head:** `ui-rebuild/phase-1-manifest`

**Taban:** üretim kodunu değiştirmeyen `ui-rebuild/phase-0-audit` / `ad669e4d`.
Audit dokümanları henüz main'de olmadığından main diff'i bu doküman bağımlılığını
da içerir. Geçici Kartela/Manifest prototip branch'leri merge edilmedi.

## Değişiklik

Manifest, ana tablo gruplarını ince 1 px çizgilerle ayırırken eski başlık
renklerini korur. Açık/koyu nötr yüzeyler korunur, gri tema dengelenir.
Ortak token ve bileşenler Overview, CP ana görünümü, sipariş notu modalı,
grafik kartları, giriş ve boot guard'da kullanılır. Yerel Plex / Barlow
tipografi ve dört arayüz ölçeği bütün bu giriş noktalarında ortaktır.

Not penceresinde Tab/Shift+Tab odağı içeride kalır. Boot hazırlık kapıları,
canonical veri/kayıt yolu, filtre/sıralama/kopyalama ve Excel çıktısı korunur.
Dekoratif hareket pilot alanlardan kaldırılır. Henüz taşınmamış modüller için
belgeli token alias köprüsü vardır; yeni bileşenler bunu tüketemez.

## Gerçek görüntüler

[Çevrimdışı üç tema galerisi](ui-rebuild/manifest-pilot.html) ·
[CP gri](ui-rebuild/phase-1/final/cp-grey.png) ·
[Overview açık](ui-rebuild/phase-1/final/overview-light.png) ·
[Not modalı](ui-rebuild/phase-1/final/notes-light.png) ·
[Giriş](ui-rebuild/phase-1/final/login-light.png) ·
[Açılış](ui-rebuild/phase-1/final/startup-grey.png).

Hepsi değişiklik sonrası gerçek PNG ve anonim demo veri. Beş ayrı TR/EN
release note eklendi; mevcut pending kayıtları korunur.

## Yerel doğrulama

- 205/205 hedefli test; son dar boot/horizon değişiklikleri için 39/39 tekrar.
- Ortak token/component/color guard'ları; yeni Manifest geometri, font,
  hareket, variant ve legacy bağımlılık guard'ı. Baseline genişlemesi yok.
- Üç tema, dört ölçek temsilî görsel/kontrast/klavye kontrolleri; son XL
  Termin Ufku taşması giderildi ve 14 günlük klavye erişimi doğrulandı.
- Üç temanın 72'şer başlık rengi aynı; altı HTML/TSV dosyası ve üç XLSX'in
  tüm workbook parçaları başlangıçla eşdeğer.
- BLPerf, i18n ve release note sonuçları: [kontrol kaydı](ui-rebuild/phase-1/checks.json),
  [performans karşılaştırması](ui-rebuild/phase-1/final/performance-comparison.json).

**Ara fazda tam `npm test` çalıştırılmadı. Kullanıcı kararıyla kapsamlı test,
tüm modüller ve Faz 3 temizliği bittikten sonra proje sonunda yapılacaktır.**
Yerel sonuçlar CI çalışmış anlamına gelmez.

## Risk / sınır

P2; iş hesapları, senkronizasyon ve LCW AI motoru değişmedi. Sunucudaki auth
öncesi yeni yollar sabit UI dosyası allowlist'i ile sınırlı. Eski modüllerde
ortak token değişimi temsilî ekranlarla kontrol edildi; tüm görsel matris
Faz 3 sonundadır. Kayıtlı kişisel Overview yerleşimleri korunur.
Legacy stil temizliği, tüm çekmeceler/popover'lar ve z-index sadeleştirmesi
bu pilotun tamamlanmış kapsamı değildir. Ayrıntılar: [faz raporu](ui-rebuild-phase-1.md).

## İş akışı durumu

PR açılmadı, push yapılmadı. `main` hedefli PR, `buyerlog-pr-fast-checks.yml`
Actions workflow'unu otomatik tetikler; bunu tetiklemeyen depo uyumlu PR yolu
bulunmadı. Kullanıcının Actions onayı yoktur; workflow bypass edilmedi.
CI: çalışmadı. Merge: yapılmadı. TEST: yayınlanmadı. STABLE: yayınlanmadı.
Faz 2, Faz 1 pilotunun kullanıcı onayını bekler.
