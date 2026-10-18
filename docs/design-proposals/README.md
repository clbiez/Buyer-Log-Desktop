# Tasarım önerileri (demo mock-up)

Tarayıcıda doğrudan açılan, bağımsız HTML demo dosyaları. Tüm sipariş, üretici ve
sevkiyat bilgileri deterministik **demo veridir**; uygulama koduna bağlı değildir.

| Dosya | İçerik |
| --- | --- |
| `buyer-log-tasarim-onerisi.html` | Kompakt ray, komut paleti (Ctrl K), canlı KPI'lar, akan sipariş şeridi, LCW AI içgörü kartı, yoğun sipariş tablosu ve detay çekmecesi. Üç yön: **A Industry Lite**, **B Gece Vardiyası**, **C Atölye**; yoğunluk ve animasyon anahtarları, numaralı öneri notları. |
| `backlog-rapor-studyosu.html` | Backlog çıktısı mock-up'ı: animasyonlu HTML rapor (operasyon akışı, dünya haritasında sevkiyat, 30 günlük projeksiyon, ürün aşama mozaiği, risk matrisi, plan & gerçekleşen, haftalık akış, kırılım, aksiyonlar, backlog ağacı, veri kalitesi) + PDF (A4, 5 sayfa) ve Excel (Backlog V3, 7 sayfa) önizlemeleri ve "Çıktı oluştur" akışı. |
| `overview-premium-study.html` | Premium Overview: hareketli rota haritası, KPI'lar, aksiyonlar, termin grafiği, ürün vitrini ve ticari bütçe grafikleri. Üç tema, TR/EN, hareket/durdurma ve detay etkileşimleri. Tamamen çevrimdışı, gömülü font/harita, temsili veri. / Premium Overview with animated routes, KPIs, actions, delivery horizon, product showcase and budget charts; three themes, TR/EN and motion controls, fully offline with illustrative data. |
| `overview-premium-review.md` | Mevcut 10 widget'ın incelemesi, revizyon önerileri, yeni widget'lar, hareket sözleşmesi ve uygulama sırası. / Review of all ten widgets, proposed revisions, new widgets, motion specification and implementation sequence. |

Notlar
- İlk iki demoda yazı tipleri Google Fonts'tan yüklenir; çevrimdışıyken sistem yazı tipine düşer. Premium Overview fontları gömülüdür. / The first two demos use Google Fonts with an offline fallback; Premium Overview embeds its fonts.
- İlk iki mock-up yalnız Türkçe; uygulamaya taşınırken her metin `L(tr,en)` çiftiyle yazılmalıdır (§4.1). Premium Overview demosu TR/EN destekler. / The first two mock-ups are Turkish-only; the Premium Overview demo supports TR/EN.
- Harita noktaları Natural Earth (world-atlas 50m, kamu malı) verisinden üretilmiştir.
