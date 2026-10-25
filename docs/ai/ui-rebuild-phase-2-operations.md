# Manifest — Faz 2.3 / Operasyon ve Ayarlar

Yerel dal: `ui-rebuild/phase-2-operations`. Taban: ticari grup `b42b410c`.
Faz 1 onayı sonrası yetkilendirilen modül göçüdür. Üretime merge edilmedi.

## Değişiklik

Sekiz modül CSS'i yerleşim/veri geometrisine indirildi: Otomasyon alanları,
Veri Bakımı, Kullanıcı Yönetimi, LCW AI, PLM rehberi, Kullanım Rehberi,
Veri Yönetimi ve sürüm notları. Modül ve genel dosyalardaki 1503 kuralın
3616 görünüm bildirimi ortak bileşen kaynağına taşındı; renk, yazı, durum ve
z-index değerleri kanonik tokenlara bağlandı. Eski dosyaların kalan kuralları
ve uyumluluk katmanı Faz 3'te temizlenecek.

- Veri Yönetimi: ağır gölgeler kaldırıldı; laboratuvar ve kaynaklar ortak yüzeylerde.
  Veri denetçisi adımları numaralı, boşlukla ayrılan akış kullanır.
- Kullanıcılar: tablo, yetki matrisi, rol sekmeleri ve diyaloglar ortak sistemde.
  Avatar rengi nötr; seçili sayaç metni kontrolün kontrast çiftini devralır.
- Otomasyonlar: numaralı şablon kataloğu, ortak düzenleyici ve ayarlar.
  Şablon seçimi yalnız yerel taslak oluşturur; testte kaydetme/çalıştırma yapılmadı.
- LCW AI: kullanıcı ve asistan kayıtları aynı hizada, yazar alanları belirli.
  Balon ve yıldız görünümü yok; tek motor, bağlam, gönderim ve çıktı yolları aynı.
- Kullanım/PLM rehberi ve sürüm arşivi: ortak tipografi, yüzey, durum ve odak.
  Eski sürümlerin PNG arşivi değişmedi; yeni arayüz bu arşivi gösterir.
- Bildirimler ve bekleme: ortak pencere, kare durum işareti. Eager küre scriptleri
  kaldırıldı, harita yükleyicisinde canvas döngüsü yok. Eski hook adları korunur.

Kullanıcı yönetiminin dış penceresi, otomasyon oluşturma/ayarlar/sütun pencereleri,
LCW AI bağlantı/yardımcı pencereleri ve bildirimler mevcut BLLayerSystem'e bağlandı.
PLM rehberinin eksik Escape callback ve kapanış temizliği tamamlandı.
Kirli form onayı, yetkiler ve kullanıcı veri işlemleri değişmedi.

## Kanıt

[Son ana ekranlar](ui-rebuild/phase-2-operations/final/capture.json): 30 gerçek PNG,
üç tema. [Alt durumlar](ui-rebuild/phase-2-operations/states/capture.json): 20 PNG;
rol, ek rol, şablon, organizasyon, kopyalama, karşılaştırma, aktarım, geçmiş,
veri denetçisi/laboratuvarı, otomasyon oluşturma/ayarlar/düzenleyici/sütunlar,
LCW AI hata durumu. [Son düzeltmeler](ui-rebuild/phase-2-operations/last/capture.json):
14 PNG; numaralı katalog, bildirim metni ve 1280×720'de dört veri-denetçisi ölçeği.
Aynı isimde `last/` görüntüsü eski `states/` veya `final/` görüntüsünü geçersiz kılar.

İngilizce doğrulamada yalnız `appLang` değişkenini atayan ilk araç gerçek dil
geçişini temsil etmedi. [Dil kontrolü](ui-rebuild/phase-2-operations/language/capture.json)
kanonik `applyLanguage('en')` yolunu kullanır; `language/` içindeki üç görüntü
önceki İngilizce görüntülerin yerine geçer. Bu araç hatası ürün kusuru diye raporlanmaz.

Son görüntülerde örneklenen geometri, metin kontrastı ve belge taşma hatası yok.
15 modal Tab/Shift+Tab/Escape denemesi geçti. Bunlar ara fazın hedefli kontrolleridir;
tüm envanter/tema/ölçek matrisi ve tam erişilebilirlik kabulü proje sonunda yapılacak.

Gerçek tarayıcı/gerçek uygulama; deterministik demo siparişleri. Yerel fixture,
yalnız ürünün yerleşik varsayılan profil/model adlarını anonim gösterim adlarıyla
değiştirir; canonical ID, yetki ve iş verisi davranışı korunur. İlk deneme PNG'leri
varsayılan ürün adlarını gösterdiğinden teslim edilmedi; ilk bulgu JSON'u saklandı.
LCW AI kaydı yerel anonim fixture'dır; kurumsal AI'a istek/giriş yapılmadı.
PLM ve veri modeli bağlantı durumları bu Linux demo ortamında kapalıdır.

## Kontroller

Hedefli koşular ve ilk başarısızlıklar [checks.json](ui-rebuild/phase-2-operations/checks.json)
içinde. İlk 170 testin yedisi eski CSS sahibi veya katı HTML etiketi varsayımıydı;
sözleşmeler kanonik sahibi izler, ilgili davranış doğrulaması korunur.
Son 43 test/guard ve 38 katman/bileşen/LCW AI/PLM/sütun testi geçti.
TR/EN: sıfır yeni eksik, boş baseline. Sekiz ayrı TR/EN release note ve gerçek PNG.
Sürüm sözleşmesi değişmedi; `version:assert` bu ara fazda çalıştırılmadı.
Tam `npm test` çalıştırılmadı; yalnız Faz 3 sonrası proje sonunda çalışacak.

Guard: operasyon CSS'inde görünüm/legacy token bağımlılığı yasaklandı; kürelerin
başlangıçta yüklenmemesi ve ortak pencere bağlantıları doğrulanır. Ham renk
baseline'ı yalnız küçüldü: app.css 32→20, experience.css 21→9; PLM rehberi ve
kullanıcı CSS'i sıfıra indiği için listeden çıkarıldı. İstisna eklenmedi.
Eski küre dosyalarının kullanılmayan test/geometri kodu Faz 3 kaldırma listesinde.

Export: bu grupta Excel/kopyalama üreticisi veya dondurulmuş palet değiştirilmedi.
Önceki eşdeğerlik kanıtları korunur; bu fazda aynı export matrisi tekrarlanmadı.
Son proje doğrulamasında uygulama/export eşdeğerliği yeniden değerlendirilecek.

## Performans ve durum

[BLPerf karşılaştırması](ui-rebuild/phase-2-operations/performance-comparison.json):
açılış **968.8 ms**, CP ilk geçiş **1046.9 ms**, 5000 kayıt **3022.4 ms**.
Başlangıca göre −5.0%, +7.3% (+71.5 ms), +0.9% (+26.5 ms).
Görünmeyen modüller eager yüklenmedi; başlangıçta CP/Siparişler satırı sıfır,
5000 kayıtta DOM 50 satır. Windows/Electron veya soğuk disk ölçümü değildir.
Faz 3 konsolidasyonunda CP geçişi yeniden ölçülecek.

PR: [yerel taslak](ui-rebuild-phase-2-operations-pr.md), açılmadı; main PR'ı Actions
tetikler. CI: çalışmadı. Merge: yapılmadı. TEST: yayınlanmadı. STABLE: yayınlanmadı.
Sonraki dal kalan ekranlar grubudur; ardından Faz 3 ve proje sonu doğrulama gelir.
