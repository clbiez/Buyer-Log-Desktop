# Yerel PR taslağı — açılmadı

**Başlık:** Manifest: ticari tablolar, teklif masası ve maliyet föyleri

**Head:** `ui-rebuild/phase-2-commercial`
**Taban:** `ui-rebuild/phase-2-plan-execute` / `cc36116f` (henüz main'e merge edilmedi).

Koleksiyon, Fiyat Masası, Fiyat & Üretici Analizi, Üreticiler, Lisans kartları,
LFL ve Ön Maliyet aynı token/bileşen kaynağını kullanır. Dokuz modül CSS'i
yerleşime indirildi. Grup başlıklarında ince ayraçlar korunur; veri satırlarında
dikey çerçeve yoktur. Grafik işaretçileri kare, dağılım ve ilerleme ölçüleri düz.

Lisans haritası ve LFL senaryo penceresinde klavye odağı içeride tutulur. LFL'de
eski genel section kuralının gizlediği form alanları görünür; hesaplama/kaydetme
yolları değişmedi. Yedi TR/EN release note ve gerçek PNG eklendi.

## Gerçek görüntüler

[Koleksiyon](ui-rebuild/phase-2-commercial/screens/koleksiyon-light.png) ·
[Fiyat Masası](ui-rebuild/phase-2-commercial/screens/quotations-light.png) ·
[Fiyat analizi](ui-rebuild/phase-2-commercial/final/priceanalysis-light.png) ·
[Üreticiler](ui-rebuild/phase-2-commercial/final/manufacturers-light.png) ·
[Lisanslar gri](ui-rebuild/phase-2-commercial/screens/licensecards-grey.png) ·
[LFL senaryosu](ui-rebuild/phase-2-commercial/final/lfl-scenario-light.png) ·
[Ön Maliyet koyu](ui-rebuild/phase-2-commercial/screens/opencosting-dark.png).

## Yerel doğrulama ve risk

Hedefli test/guard sonuçları [kontrol kaydında](ui-rebuild/phase-2-commercial/checks.json).
6 kopyalama ve 4 Excel çıktısı referansla eşdeğer. 3 tema, temsilî 4 arayüz boyutu,
pencere klavyesi ve reduced-motion görüntüleri kaydedildi. Sonuçlar sınırlı bir
ara faz kontrolüdür; tüm envanter matrisi ve performans kabulü proje sonunda.
BLPerf karşılaştırması [ayrı kayıttadır](ui-rebuild/phase-2-commercial/performance-comparison.json).

P2: görünüm ve yerel modal erişilebilirliği. Veri şeması, senkronizasyon,
fiyat/royalty hesabı ve LCW AI motoru değişmedi. Eski görünümlerle geçici birlikte
çalışma sürer; Faz 3 CSS konsolidasyonu ve kalan nadir durumlar tamamlanmalıdır.

**Ara PR'da tam `npm test` çalıştırılmadı. Tam test, tüm uygulama ve Faz 3
tamamlandıktan sonra proje sonunda yapılacaktır.**

PR/push: yapılmadı; main PR'ı onaysız Actions tetikler. CI: çalışmadı.
Merge: yapılmadı. TEST: yayınlanmadı. STABLE: yayınlanmadı.

Temiz BLPerf: açılış **931.9 ms**, CP ilk geçiş **1063.9 ms**, 5000 kayıt **3022.8 ms**.
Başlangıca göre sırasıyla −8.6%, +9.1% (+88.5 ms), +0.9% (+26.9 ms). CP geçişindeki artış
Faz 3 konsolidasyonunda yeniden değerlendirilecektir; bütün ölçüler iyileşti denmemektedir.
