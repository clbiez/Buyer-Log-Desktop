# Test sözleşmelerinin taşınması

Ham renk ve i18n baseline'ları boştur; tasarım guard istisnaları odak, dar
kapsamlı tablo başlık/satır ayırıcıları ve donmuş export kurallarıyla sınırlıdır.

- Görünüm artık `ui-components.css`, değerler `ui-tokens.css`, geometri eski
  modül dosyasındadır. Kaynak metni testleri gerçek sahipleri birlikte okur.
  `manifest-css` yalnız root kapsamını ve boşlukları normalize eder; değer veya
  deklarasyon eklemez. Modülün namespacing/ham renk kontrolleri yalnız modül
  dosyasını okumaya devam eder.
- Taşınan token adlarının beklentileri kanonik karşılıklarına geçti. Tek bir
  CSS bloğunda ardışık olma beklentileri, geometri ve tipografi sahiplerinde ayrı
  denetlenir. Kullanılmayan yorum başlığına göre kesmek yerine gerçek seçici
  ailesi seçilir. HTML id denetimleri aynı id'yi, eklenen data kancalarıyla kabul eder.
- Kapsül köşe/çerçeve/glow/dekoratif animasyon iddiaları kullanıcı tarafından
  seçilmiş kare, yüzey ve statik durum sözleşmesiyle değiştirildi. Odak görünür
  2px outline, aktif spreadsheet imleci ve tabloda ana grup ayırıcıları korunur.
- Ortak reset/focus/static-motion doğrulamaları gerçek global kurala bakar.
  Üretici drilldown, filtre ve preset DOM davranışı testleri korunur. Tablo,
  clipboard, kanonik alan, fiyat, yetki, güvenlik, veri ve eski asset SHA
  doğrulamaları gevşetilmedi.
- CSS optimizasyonunda eşit özgüllüklü basit `:is()` listeleri açıldı. Kompleks
  seçici özgün koşulu koruyup sıfır özgüllüklü `:where` ön filtresi ekler. Başlık
  kenarlığı guard'ı yalnız üç tablonun iki başlık katmanındaki bu tam seçicileri
  kabul eder; herhangi bir tbody/td veya genel border istisnası eklenmedi.
- Hedefli testlerde bulunan gerçek eksikler: dar menü içerik genişliği, sürükleme
  hedefinin görünürlüğü, onaylı fiyat durumu, kural sebebi hata yüzeyi ve görsel
  tıklama geri bildirimi düzeltildi. Onay ayrıca TR/EN metin taşır; kural alanı
  oluşturma ve değişiklikte `aria-invalid` günceller. 24 kombinasyonlu ilgili
  ekran çekimleri `state-final/` ve `rail-final/` altındadır.

İlk CSS tüketici koşusu: 2.169 test / 2.080 başarılı / 89 başarısız. Sahiplik ve
eski tasarım beklentileri taşınırken ara başarısızlıklar loglarda saklandı.
Sonrasında yalnız ilgili testler tekrar çalıştırıldı. Proje sonu tam koşunun
sonucu `checks.json` ve tam test logunda ayrıca verilir; hedefli koşu tam paket
veya CI olarak sunulmaz.

Çekim aracı hataları da korunur: `state-revision` dragstart olayına DataTransfer
vermediği için JS hata bildirimi oluşmuştu. `state-final` gerçek DataTransfer
ile yeniden çekildi; ürün işleyicisi değiştirilmedi. Geçersiz kuralın kapanmayı
engellemesi mevcut doğrulama davranışıdır; araç, çekim sonrası geçerli sebebi
geri yazarak normal kapatma yolunu kullanır. `rail-final` fareyi sol menüden
uzaklaştırarak dar görünümü gösterir; ilk çekimde fare hover menüyü açıyordu.

Son tam koşularda ayrıca ek data kancalı section ankrajı, sabit nakliye export
paleti dalı, yıldızsız LCW AI etiketleri ve ortak tooltip katmanı beklentileri
yeni kaynak sahipliğine geçirildi. İlgili iş/motor/çıktı assertleri korundu.
Kişisel Horizon editörünün 74 stili de public/server JS+HTML referansı bulunmadığı
kanıtlanarak silindi (`retired-horizon-css.json`). Aktif dmf filtre grubu yüzey
sözleşmesi ve silinen hz stillerinin geri gelmemesi ayrıca sınanır. Bu son CSS
silme işlemi hiçbir render edilmiş öğeyi etkilemediği için görsel/BLPerf matrisi
yinelenmedi.


Giriş ekranı için Faz 1'de eklenen `buyerlog.ui.appearance` anahtarı yalnız cihazın
kimlik doğrulama öncesi son tema/boyut görünümünü taşır. Depolama guard'ında bu
**tam anahtar** ayrıca sınıflandırıldı; bir prefix veya key ailesi muaf tutulmadı.
`ui-appearance-storage.test.js` üretim okuyucu/yazıcısını VM'de çalıştırarak üç
tema/dört boyutu, geçersiz girdiyi, yalnız `{theme,step}` şemasını ve iki ayrı
kullanıcının `lcw_theme` değerlerinin değişmemesini sınar. Tema değiştiren gerçek
fonksiyonun testi de yazılan nesnenin tamamını karşılaştırır. Böylece iş verisi,
kimlik, token veya başka kişisel alan bu önbelleğe eklenirse test başarısız olur.
Bu, yeni giriş görünümünün bilinçli depolama sözleşmesidir; kullanıcı tercihlerini
cihaz geneline taşıyan bir üretim değişikliği yapılmadı.

Son tam koşu: 1.060 dosya, 7.529 geçen / 0 başarısız / 65 mevcut atlama.
Kaynak sözleşmesi düzeltmelerinden sonra başarılı tam paket tekrar edilmedi.
