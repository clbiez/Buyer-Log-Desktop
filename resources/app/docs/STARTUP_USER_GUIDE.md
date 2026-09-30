# Buyer Log açılış ekranı ve kullanım rehberi

Açılış perdesi, ana arayüz, ilk veri, açılan ekranın ana projeksiyonu ve sağ üstteki kullanıcı erişim bilgisi hazır olduğunda kapanır. Ayrı Overview kartları ve görünmeyen modüller gerektiğinde yüklenmeye devam eder.

Kısa ipuçları ve ayrıntılı rehber aynı `public/buyerlog-guide-data.js` kütüphanesini kullanır. İlk sürüm 16 konu grubu altında 66 doğrulanmış kullanım konusunu içerir. Bu liste tüm uygulama kontrollerinin eksiksiz envanteri olarak sunulmaz; yeni işlevler aynı şemaya eklenir.

## Kullanıcı erişimi

- Üst çubuktaki rehber düğmesi, kullanıcı menüsündeki Kullanım Rehberi veya F1.
- Modül seçimi, konu araması, önceki/sonraki sayfa ve Ekrana Git.
- Ekrana Git yalnız yetkili modülü açar ve varsa görünür kontrolü vurgular; gönderme, kaydetme, silme veya başka bir iş işlemini tetiklemez.
- Başlangıçta 12 saniyede bir ipucu; önceki/sonraki ve duraklatma kontrolleri. Tip alanında hover veya kontrol odağı, açık rehber ve gizli sekme otomatik geçişi duraklatır.
- 15 saniyede uzun bekleme açıklaması, 120 saniyede yeniden deneme seçeneği. Normal yavaş açılış otomatik yenileme döngüsü başlatmaz.
- TR/EN metinler, mevcut tema tokenları, klavye odağı ve azaltılmış hareket desteği.

## Görseller ve doğruluk

Kartlar gerçek şirket kaydı içermeyen, kodla çizilen **örnek arayüz görselleri** kullanır; gerçek ekran görüntüsü oldukları iddia edilmez. Her kart gerçek bir işlem yolu, üç kullanım adımı, kaynak dosyası ve yetki kapsamı içerir. Görseller internetten yüklenmez.

Önemli sınırlar: CP / Orders Add Column kaynak bağlantısından ortak alan ekler; Koleksiyon Add Column boş metin alanıdır. Hesaplanan sütun desteği yalnız CP, Orders ve Shipping içindir. Partial View CP / Orders satır sunumunu değiştirir. Aynı PLM modeli için Yeni olarak ekle kararı PLM aktarımındadır.

## Konu envanteri

| Grup | Konu | Gerçek işlem yolu | Kaynak |
| --- | --- | --- | --- |
| Genel kullanım | Araçlar: önce kapsam, sonra işlem | CP / Siparişler / Koleksiyon → Araçlar | public/app-main.js |
| Genel kullanım | Aramada hangi alanlar taranır? | CP / Siparişler → Arama → i | public/table-search-help.js |
| Genel kullanım | Filtreler birlikte çalışır | CP / Siparişler / Koleksiyon → Tablo Filtreleri | public/app-main.js |
| Genel kullanım | Görünüm ve filtre profilleri | Tablo → ⋯ → Görünüm / Filtre | public/app-main.js |
| Genel kullanım | Dil, tema ve ekran yoğunluğu | Sol menü → alt bölüm | public/app-main.js |
| Genel kullanım | Rehber her zaman elinizin altında | Üst çubuk → Kullanım Rehberi / F1 | public/buyerlog-guide.js |
| Görünümler ve sütunlar | Focus: günlük işinize odaklanın | CP / Siparişler / Koleksiyon → Görünüm → Odak | public/app-main.js |
| Görünümler ve sütunlar | Extended: daha fazla operasyonel ayrıntı | Tablo → Görünüm → Genişletilmiş | public/app-main.js |
| Görünümler ve sütunlar | All: eksik sütunu bulun | Tablo → Görünüm → Tümü | public/app-main.js |
| Görünümler ve sütunlar | Partial View: durumları ayrı satırlarda görün | CP / Siparişler → Görünüm → Partial View | public/app-main.js |
| Görünümler ve sütunlar | Sütunları gösterin, gizleyin, adlandırın | Tablo → Sütunlar | public/app-main.js |
| Görünümler ve sütunlar | Sütun genişliği ve gizleme | Tablo → sütun başlığı | public/app-main.js |
| Görünümler ve sütunlar | Add Column: kaynaktan alan ekleyin | CP / Siparişler → ⋯ → Sütun Ekle | public/app-main.js |
| Görünümler ve sütunlar | Add Calculated Column: kişisel hesaplama | CP / Siparişler → ⋯ → Hesaplanan Sütun Ekle; Nakliye → Sütunlar → Hesaplanan Sütun | public/formula-columns.js |
| Görünümler ve sütunlar | Formül yazarken temel kurallar | Hesaplanan Sütun → Gelişmiş → Sözlük | public/formula-columns.js |
| Görünümler ve sütunlar | Boş hücre ve sıfıra bölme | Hesaplanan Sütun → Gelişmiş | public/formula-columns.js |
| Görünümler ve sütunlar | AI ile formül önerisi alın | Hesaplanan Sütun → AI ile yaz | public/formula-columns.js |
| Kopyalama ve yapıştırma | Satır kopyası ile hücre kopyası farklıdır | Koleksiyon → checkbox / hücre alanı → Kopyala | public/collection-spreadsheet.js |
| Kopyalama ve yapıştırma | Excel’e başlıklarıyla kopyalama | Koleksiyon → Kopyala → Excel | public/app-main.js |
| Kopyalama ve yapıştırma | Excel bloğunu aktif hücreden yapıştırın | Koleksiyon → başlangıç hücresi → Ctrl+V | public/collection-spreadsheet.js |
| Kopyalama ve yapıştırma | Hücre alanı seçimi ve klavye | Koleksiyon → hücre alanı | public/collection-spreadsheet.js |
| Kopyalama ve yapıştırma | Koleksiyon’da geri al ve ileri al | Koleksiyon → Geri / İleri | public/app-main.js |
| CP Tracker | CP Tracker: üretim ve termin takibi | CP Tracker → tarih sütunları | public/app-main.js |
| CP Tracker | Capacity Request Excel | CP Tracker → Araçlar → Capacity Request Excel Oluştur | public/app-main.js |
| CP Tracker | Kendi Excel’inizi alanlara eşleyin | CP Tracker → Araçlar → Kullanıcı Excelini İçeri Aktar | public/index.html |
| CP Tracker | CP’de PLM ve ASAS senkronizasyonu | CP Tracker → PLM SYNC | public/app-main.js |
| Siparişler | Siparişler ekranını daraltın | Siparişler → Arama / Görünüm | public/app-main.js |
| Siparişler | Sipariş için Endeksmatik | Siparişler → Araçlar → Endeksmatik | public/app-main.js |
| Koleksiyon | Aynı modeli farklı In Store ayına ekleme | Koleksiyon → PLM SYNC → model aktarımı → mevcut model kararı | public/app-main.js |
| Koleksiyon | Ana renk ve alt renk görünümü | Koleksiyon → model oku / toplu alt renk simgesi | public/app-main.js |
| Koleksiyon | Koleksiyon’a serbest metin sütunu | Koleksiyon → ⋯ → Sütun Ekle | public/app-main.js |
| Koleksiyon | Modelleri fiyatlamaya gönderin | Koleksiyon → Araçlar → Fiyatlamaya Gönder | public/app-main.js |
| Koleksiyon | Nakliye kıyaslamasına model aktarın | Koleksiyon → Araçlar → Nakliye Kıyaslamaya Gönder | public/app-main.js |
| Koleksiyon | Status etiketleri ve renkleri | Koleksiyon → Araçlar → Statusları Yönet | public/app-main.js |
| Koleksiyon | Model dosyaları | Koleksiyon → Araçlar → Dosyalar / TPs | public/app-main.js |
| Koleksiyon | Endeksmatik ülke / bölge setleri | Koleksiyon → Araçlar → Endeksmatik Setleri | public/app-main.js |
| Koleksiyon | Model görselleriyle Excel oluşturun | Koleksiyon → Excel’e Aktar | public/app-main.js |
| Koleksiyon | Silinen modelleri geri bulun | Koleksiyon → Geri Dönüşüm Kutusu | public/app-main.js |
| Koleksiyon | Model çoğaltma | Koleksiyon → satır seçimi → Çoğalt | public/app-main.js |
| Quotations | Teklifleri karşılaştırın ve onaylayın | Quotations → çalışma → teklif satırı | public/quotations.js |
| Quotations | Quotation notu ve düzenleme yetkisi | Quotations → Quotation Notu / Düzenleme Yetkisi | public/quotations.js |
| Quotations | Fiyatı beklenen üreticilere hatırlatma | Quotations → Hatırlatma Gönder | public/quotations.js |
| Fiyat Geçmişi | Fiyat geçmişinden benchmark | Fiyat Geçmişi → fiyat kaydı | public/quotations.js |
| Fiyat & Üretici Analizi | Fiyat ve üretici analizinde kapsam | Fiyat & Üretici Analizi → Season / Compare | public/app-main.js |
| Backlog | Backlog: gruplar ve alt detay | Backlog → grup / alt detay | public/app-main.js |
| Backlog | Backlog Excel sütunlarını seçin | Backlog → Excel dışa aktarım sütun ayarları | public/app-main.js |
| Nakliye Kıyaslama | Nakliye seçeneklerini kıyaslayın | Nakliye Kıyaslama → model tablosu | public/app-main.js |
| LFL Analizi | LFL: bağımsız senaryolar | LFL Analizi → Multi-dimensional Comparison | public/lfl.js |
| Koleksiyon | Seçili modellerle LFL Trial | Koleksiyon → Araçlar → LFL Trial | public/app-main.js |
| Koleksiyon | Ön Maliyet oluşturma | Koleksiyon → Araçlar → Maliyet Oluştur | public/index.html |
| Ön Maliyet | Kur verisini kontrol edin | Ön Maliyet → kur işlemleri | public/app-main.js |
| Overview, OAB ve Intake | Global Flow Map: görünüm ve ölçü | Overview → Global Flow Map | public/index.html |
| Overview, OAB ve Intake | Yolda geciken sevkiyatı fark edin | Overview → Global Flow Map → sembol | public/overview-global-flow.js |
| Overview, OAB ve Intake | Overview sayfalarınızı düzenleyin | Overview → Edit | public/overview-layout.js |
| Overview, OAB ve Intake | OAB: önce kapsamı seçin | Overview → OAB → Get OAB | public/oab.js |
| Overview, OAB ve Intake | OAB alt detayını yan panelde inceleyin | Overview → OAB → alt detay | public/oab.js |
| Overview, OAB ve Intake | Intake: sıfır bütçeleri gizleyin | Overview → Intake → Ayarlar | public/intake.js |
| Otomasyonlar | Otomasyonu çalıştırmadan önce deneyin | Otomasyonlar → düzenleyici → Dene | public/automations.js |
| Otomasyonlar | İkinci veri kaynağıyla eşleştirme | Otomasyonlar → Gelişmiş ayarlar → İkinci kaynak | public/automations.js |
| Veri Yönetimi | Veri Yönetimi ve kaynak kapsamı | Veri Yönetimi → kaynak ayarları | public/app-main.js |
| Genel kullanım | Yenileme ve ilk açılış aynı şey değildir | Üst çubuk / tablo → Yenile | public/app-main.js |
| Genel kullanım | Ön ayar paylaşımı | Sağ üst kullanıcı menüsü → Ön Ayar Paylaşımı | public/user-access-ui.js |
| Genel kullanım | Kişisel görünümü sıfırlama | Kullanıcı menüsü → Görünümümü Sıfırla | public/user-access-ui.js |
| Genel kullanım | Backup ayarlarına erişim | Kullanıcı menüsü → Backup | public/user-access-ui.js |
| Genel kullanım | Outlook bağlantı ayarları | Kullanıcı menüsü → Microsoft 365 · Outlook | public/user-access-ui.js |
| Genel kullanım | Uygulama güncellemesi | Kullanıcı menüsü → Uygulama Güncellemesi | public/user-access-ui.js |

## Bakım ve doğrulama

Yeni kart için benzersiz id, module, visual, gerçek selector, TR/EN title/summary/path/steps, evidence ve areas ekleyin. Desteklenmeyen eylemi anlatmayın. capability gerekiyorsa gerçek capability anahtarını kullanın. Her işlem yolu güncel source ile doğrulanmalıdır.

`node --test tests/startup-guide-v20260930.test.js tests/boot-thinking-orb-v20260929.test.js tests/startup-initialization-order-v772.test.js tests/clipboard-contract-v1085.test.js`

Bu çalışma ortamında 27 hedefli test ve JavaScript sözdizimi kontrolleri geçti. Tarayıcı çalıştırıcısı bulunmadığı ve tarayıcı indirmesi başarısız olduğu için canlı görsel kontrol yapılmadı. Tam repository test paketi / Windows portable build bu ortamda çalıştırılmadı.

Birleştirmeden / sürüm dağıtımından önce Windows üzerinde: soğuk açılış, cached açılış, ağ gecikmesi, hatalı ilk veri, rol kısıtlaması, `?module=cp` / `orders`, TR/EN, açık/koyu tema, dar ekran, rehberde arama/modül gezinmesi, F1/Escape/Tab ve rehber açıkken Ctrl+Z/Ctrl+C kontrollerini doğrulayın.
