/* ===================================================================
   Buyer Log — Sürüm Geçmişi / Version History
   Buyer Log başlığının altındaki sürüm yazısına tıklayınca açılan
   pencerenin verisi. Her kaydın Türkçe (tr) ve İngilizce (en)
   karşılığı bulunur; pencere aktif dile göre gösterir.

   Yeni sürüm eklerken: listenin BAŞINA GERÇEK sürüm numarasıyla yeni bir nesne ekle.
   __CURRENT__ gibi hareketli placeholder KULLANMA; geçmiş kayıtlarını değiştirme/silme.
   { v:'7.211', date:'2026-10-03',
     title:{tr:'...', en:'...'},
     items:[ {tr:'...', en:'...'}, ... ] }
   =================================================================== */
window.BL_VERSION_HISTORY = [
  { v: "7.210", date: "2026-10-02", title: { tr: "IAS Database kaynağında teknik fact satırları Antrepo Excel iş granülüne normalize edildi", en: "IAS Database kaynağında teknik fact satırları Antrepo Excel iş granülüne normalize edildi" }, items: [
    { tr: "Buyer Log 7.0.210: IAS Database kaynağında teknik fact satırları Antrepo Excel iş granülüne normalize edildi. Supplier Portal Statü boş teknik satırlar artık gerçek sevkiyat gibi Backlog'a girmiyor; aynı gerçek parsiyelin teknik alt satırları birleştirilerek Yükleme Toplam Adet toplanıyor, gerçek farklı parsiyeller ayrı kalıyor. Mevcut ASAS–IAS eşleştirme kuralı korunuyor.", en: "Buyer Log 7.0.210: IAS Database kaynağında teknik fact satırları Antrepo Excel iş granülüne normalize edildi. Supplier Portal Statü boş teknik satırlar artık gerçek sevkiyat gibi Backlog'a girmiyor; aynı gerçek parsiyelin teknik alt satırları birleştirilerek Yükleme Toplam Adet toplanıyor, gerçek farklı parsiyeller ayrı kalıyor. Mevcut ASAS–IAS eşleştirme kuralı korunuyor." },
  ] },

  { v: "7.209", date: "2026-10-02", title: { tr: "IAS satırlarında Sipariş Kod / Model Adı / Renk Kod boş gelmesi ve ASAS eşleşmesinin 0 kalması düzeltildi", en: "IAS satırlarında Sipariş Kod / Model Adı / Renk Kod boş gelmesi ve ASAS eşleşmesinin 0 kalması düzeltildi" }, items: [
    { tr: "Buyer Log 7.0.209: IAS satırlarında Sipariş Kod / Model Adı / Renk Kod boş gelmesi ve ASAS eşleşmesinin 0 kalması düzeltildi. İthalat Dosya No Dim_Ithalat boyut tablosuna bağlı olsa da IAS sorgusu satır granülü olarak yükleme fact tablosunu (Ithalat) kullanır; sipariş alanları her parsiyel satırın kendi siparişinden okunur.", en: "Buyer Log 7.0.209: IAS satırlarında Sipariş Kod / Model Adı / Renk Kod boş gelmesi ve ASAS eşleşmesinin 0 kalması düzeltildi. İthalat Dosya No Dim_Ithalat boyut tablosuna bağlı olsa da IAS sorgusu satır granülü olarak yükleme fact tablosunu (Ithalat) kullanır; sipariş alanları her parsiyel satırın kendi siparişinden okunur." },
  ] },

  { v: "7.208", date: "2026-10-02", title: { tr: "TEST kanalındaki güncellemeler artık girişten sonra otomatik kontrol ediliyor (açılış kontrolü giriş öncesi STABLE…", en: "TEST kanalındaki güncellemeler artık girişten sonra otomatik kontrol ediliyor (açılış kontrolü giriş öncesi STABLE…" }, items: [
    { tr: "Buyer Log 7.0.208: TEST kanalındaki güncellemeler artık girişten sonra otomatik kontrol ediliyor (açılış kontrolü giriş öncesi STABLE kanalına düşüyordu). 7.0.207 içeriği dahil: IAS kaynağı DATABASE seçildiğinde veri gelmemesi düzeltildi; Backlog Overview’a CP, ASAS ve IAS filtreleri; Yol Süreleri analizi doğrudan IAS verisinden; timeline düzeltmeleri; ASAS Ex-Factory tarih tamamlama; dil göstergesi düzeltmesi.", en: "Buyer Log 7.0.208: TEST kanalındaki güncellemeler artık girişten sonra otomatik kontrol ediliyor (açılış kontrolü giriş öncesi STABLE kanalına düşüyordu). 7.0.207 içeriği dahil: IAS kaynağı DATABASE seçildiğinde veri gelmemesi düzeltildi; Backlog Overview’a CP, ASAS ve IAS filtreleri; Yol Süreleri analizi doğrudan IAS verisinden; timeline düzeltmeleri; ASAS Ex-Factory tarih tamamlama; dil göstergesi düzeltmesi." },
  ] },

  { v: "7.207", date: "2026-10-02", title: { tr: "IAS kaynağı DATABASE seçildiğinde veri gelmemesi düzeltildi (köşeli parantezli sütun başlıkları artık doğru okunuyor;…", en: "IAS kaynağı DATABASE seçildiğinde veri gelmemesi düzeltildi (köşeli parantezli sütun başlıkları artık doğru okunuyor;…" }, items: [
    { tr: "Buyer Log 7.0.207: IAS kaynağı DATABASE seçildiğinde veri gelmemesi düzeltildi (köşeli parantezli sütun başlıkları artık doğru okunuyor; okunamayan sonuç sessizce boş veri yerine hata veriyor). Backlog Overview’a CP, ASAS ve IAS filtreleri eklendi; Backlog teslim riski analizi sadeleştirildi. Yol Süreleri: İthalat Yol Süresi Raporu analizi ve kural önerisi, Excel’siz doğrudan IAS verisinden. Timeline sütun hizalama ve Bugün’e dön; segment oranları düzeltildi. ASAS: Ex-Factory’si boş renk aynı PO’nun diğer renginden tarih alır. Dil göstergesi düzeltildi.", en: "Buyer Log 7.0.207: IAS kaynağı DATABASE seçildiğinde veri gelmemesi düzeltildi (köşeli parantezli sütun başlıkları artık doğru okunuyor; okunamayan sonuç sessizce boş veri yerine hata veriyor). Backlog Overview’a CP, ASAS ve IAS filtreleri eklendi; Backlog teslim riski analizi sadeleştirildi. Yol Süreleri: İthalat Yol Süresi Raporu analizi ve kural önerisi, Excel’siz doğrudan IAS verisinden. Timeline sütun hizalama ve Bugün’e dön; segment oranları düzeltildi. ASAS: Ex-Factory’si boş renk aynı PO’nun diğer renginden tarih alır. Dil göstergesi düzeltildi." },
  ] },

  { v: "7.206", date: "2026-10-02", title: { tr: "CP › Lojistik akışında Buyer Log'un ASAS bakiyesi için açtığı \"Üretimde kalan\" satırı \"Eksik adet olarak işaretle\" ile…", en: "CP › Lojistik akışında Buyer Log'un ASAS bakiyesi için açtığı \"Üretimde kalan\" satırı \"Eksik adet olarak işaretle\" ile…" }, items: [
    { tr: "Buyer Log 7.0.206: CP › Lojistik akışında Buyer Log'un ASAS bakiyesi için açtığı \"Üretimde kalan\" satırı \"Eksik adet olarak işaretle\" ile kalıcı olarak Eksik Yükleme yapılabilir (parsiyellerin tamamı depodaysa Depoda - Eksik Yükleme); işaret Backlog, CP, Excel ve Planlanan & Gerçekleşen'e yansır, \"Geri al\" ile kaldırılır. ASAS'ta kapanmış ama IAS kaydı olmayan bakiye artık \"Parsiyel\" değil \"ASAS'ta kapanmış bakiye · IAS kaydı yok\" olarak gösterilir. Buyer Log'un açtığı satırların siparişin bütün bilgilerini (Sezon, Buyer, tarihler, kimlikler) taşıdığı testle güvence altında. Diğer sayfalar kısmi yenilenirken CP/Siparişler verisi korunur.", en: "Buyer Log 7.0.206: CP › Lojistik akışında Buyer Log'un ASAS bakiyesi için açtığı \"Üretimde kalan\" satırı \"Eksik adet olarak işaretle\" ile kalıcı olarak Eksik Yükleme yapılabilir (parsiyellerin tamamı depodaysa Depoda - Eksik Yükleme); işaret Backlog, CP, Excel ve Planlanan & Gerçekleşen'e yansır, \"Geri al\" ile kaldırılır. ASAS'ta kapanmış ama IAS kaydı olmayan bakiye artık \"Parsiyel\" değil \"ASAS'ta kapanmış bakiye · IAS kaydı yok\" olarak gösterilir. Buyer Log'un açtığı satırların siparişin bütün bilgilerini (Sezon, Buyer, tarihler, kimlikler) taşıdığı testle güvence altında. Diğer sayfalar kısmi yenilenirken CP/Siparişler verisi korunur." },
  ] },

  { v: "7.205", date: "2026-10-02", title: { tr: "Backlog tarih kayması düzeltildi — soğuk açılıştan sonra Planlanan & Gerçekleşen snapshot'larında Ex-Factory, Retail, In…", en: "Backlog tarih kayması düzeltildi — soğuk açılıştan sonra Planlanan & Gerçekleşen snapshot'larında Ex-Factory, Retail, In…" }, items: [
    { tr: "Buyer Log 7.0.205: Backlog tarih kayması düzeltildi — soğuk açılıştan sonra Planlanan & Gerçekleşen snapshot'larında Ex-Factory, Retail, In Store ve Handover tarihleri bir gün geri yazılıyordu ve analizde sahte \"-1 gün\" revizyonları çıkıyordu; kaynak veri artık canlı yenilemeyle aynı tiplerde yükleniyor, eski kaymış snapshot'lar okunurken otomatik düzeltiliyor. Sipariş Yerleştirme tarihi Excel Backlog V3'te gerçek tarih. \"Tarih · adet\" değerleri okunur (14.03.2026 · 39.641 adet). Backlog Genel Bakış ve Excel V3'e veri kalitesi uyarısı (boş Sezon, eksik tarih, Retail < Ex-Factory, saatli ham tarih). CP verisinin diğer sayfalar yenilenirken kaybolması düzeltildi.", en: "Buyer Log 7.0.205: Backlog tarih kayması düzeltildi — soğuk açılıştan sonra Planlanan & Gerçekleşen snapshot'larında Ex-Factory, Retail, In Store ve Handover tarihleri bir gün geri yazılıyordu ve analizde sahte \"-1 gün\" revizyonları çıkıyordu; kaynak veri artık canlı yenilemeyle aynı tiplerde yükleniyor, eski kaymış snapshot'lar okunurken otomatik düzeltiliyor. Sipariş Yerleştirme tarihi Excel Backlog V3'te gerçek tarih. \"Tarih · adet\" değerleri okunur (14.03.2026 · 39.641 adet). Backlog Genel Bakış ve Excel V3'e veri kalitesi uyarısı (boş Sezon, eksik tarih, Retail < Ex-Factory, saatli ham tarih). CP verisinin diğer sayfalar yenilenirken kaybolması düzeltildi." },
  ] },

  { v: "7.204", date: "2026-10-02", title: { tr: "Backlog ekranına Backlog Genel Bakış paneli — yüklenen oranı, aşama KPI kartları, Buyer · Buying Group · Üretici · Sezon…", en: "Backlog ekranına Backlog Genel Bakış paneli — yüklenen oranı, aşama KPI kartları, Buyer · Buying Group · Üretici · Sezon…" }, items: [
    { tr: "Buyer Log 7.0.204: Backlog ekranına Backlog Genel Bakış paneli — yüklenen oranı, aşama KPI kartları, Buyer · Buying Group · Üretici · Sezon · Kategori · Ülke · Yükleme Tipi bazında yığılmış aşama barları (fareyle bilgi, tıklayınca sağdan sipariş listesi), Ex-Factory / Antrepo / Retail / In-Store haftalık-aylık akış. Excel butonları: mevcut düzen \"Excel Legacy\" oldu; yeni \"Excel Backlog V3\" grafikli özet, haftalık akış, kırılımlar ve V3 detayıyla birlikte isteğe bağlı Planlanan & Gerçekleşen raporunu ve formülleriyle Legacy BACKLOG tablosunu içerir. PLM / ASAS senkron geri bildirimi standart Buyer Log bildirimleriyle hizalandı; bildirimler PLM işlem şeridinin üstünde konumlanıyor, senkron rehberi tercihi kullanıcı bazında saklanıyor.", en: "Buyer Log 7.0.204: Backlog ekranına Backlog Genel Bakış paneli — yüklenen oranı, aşama KPI kartları, Buyer · Buying Group · Üretici · Sezon · Kategori · Ülke · Yükleme Tipi bazında yığılmış aşama barları (fareyle bilgi, tıklayınca sağdan sipariş listesi), Ex-Factory / Antrepo / Retail / In-Store haftalık-aylık akış. Excel butonları: mevcut düzen \"Excel Legacy\" oldu; yeni \"Excel Backlog V3\" grafikli özet, haftalık akış, kırılımlar ve V3 detayıyla birlikte isteğe bağlı Planlanan & Gerçekleşen raporunu ve formülleriyle Legacy BACKLOG tablosunu içerir. PLM / ASAS senkron geri bildirimi standart Buyer Log bildirimleriyle hizalandı; bildirimler PLM işlem şeridinin üstünde konumlanıyor, senkron rehberi tercihi kullanıcı bazında saklanıyor." },
  ] },

  { v: "7.203", date: "2026-10-02", title: { tr: "PLM SYNC ve ASAS SYNC işlemlerine görsel kullanıcı rehberi eklendi", en: "PLM SYNC ve ASAS SYNC işlemlerine görsel kullanıcı rehberi eklendi" }, items: [
    { tr: "Buyer Log 7.0.203: PLM SYNC ve ASAS SYNC işlemlerine görsel kullanıcı rehberi eklendi. Senkron öncesinde tarayıcının açık tutulması, Allow Remote Debugging onayının verilmesi ve Remote Debugging bağlantısının hazır olması kullanıcıya adım adım anlatılıyor. Remote Debugging hazır değilse işlem engellenip Browser & Remote Debugging ayarlarına yönlendirme yapılıyor; Edge/Chrome inspect yolu gösteriliyor. Kullanıcı eğitim ekranını “bir daha gösterme” ile kapatabiliyor, ancak kritik bağlantı uyarıları gösterilmeye devam ediyor. Senkron sırasında da kompakt işlem bildirimi tarayıcıyı kapatmama ve Allow onayını hatırlatıyor.", en: "Buyer Log 7.0.203: PLM SYNC ve ASAS SYNC işlemlerine görsel kullanıcı rehberi eklendi. Senkron öncesinde tarayıcının açık tutulması, Allow Remote Debugging onayının verilmesi ve Remote Debugging bağlantısının hazır olması kullanıcıya adım adım anlatılıyor. Remote Debugging hazır değilse işlem engellenip Browser & Remote Debugging ayarlarına yönlendirme yapılıyor; Edge/Chrome inspect yolu gösteriliyor. Kullanıcı eğitim ekranını “bir daha gösterme” ile kapatabiliyor, ancak kritik bağlantı uyarıları gösterilmeye devam ediyor. Senkron sırasında da kompakt işlem bildirimi tarayıcıyı kapatmama ve Allow onayını hatırlatıyor." },
  ] },

  { v: "7.202", date: "2026-10-02", title: { tr: "OAB modülüne modül içi işlem rehberi eklendi", en: "OAB modülüne modül içi işlem rehberi eklendi" }, items: [
    { tr: "Buyer Log 7.0.202: OAB modülüne modül içi işlem rehberi eklendi. Hazırlık, tarayıcı bağlantısı, PASS/OAB girişi, veri çekme, işleme ve tamamlanma aşamaları görünür hale getirildi; tarayıcı kullanılan aşamalarda Edge/Chrome OAB sekmesinin kapatılmaması gerektiği açıkça uyarılıyor. Arayüz yalnız OAB kartı içinde kalıyor ve diğer Overview widget’larını örtmüyor. 7.0.201’deki Ex-Factory/Backlog revizyon düzeltmeleri korunmuştur.", en: "Buyer Log 7.0.202: OAB modülüne modül içi işlem rehberi eklendi. Hazırlık, tarayıcı bağlantısı, PASS/OAB girişi, veri çekme, işleme ve tamamlanma aşamaları görünür hale getirildi; tarayıcı kullanılan aşamalarda Edge/Chrome OAB sekmesinin kapatılmaması gerektiği açıkça uyarılıyor. Arayüz yalnız OAB kartı içinde kalıyor ve diğer Overview widget’larını örtmüyor. 7.0.201’deki Ex-Factory/Backlog revizyon düzeltmeleri korunmuştur." },
  ] },

  { v: "7.201", date: "2026-10-02", title: { tr: "Ex-Factory revizyonları Backlog’da tüm segmentlerde kullanıcı revizyonunu tutarlı gösteriyor; Orijinal Ex-Factory tarihi…", en: "Ex-Factory revizyonları Backlog’da tüm segmentlerde kullanıcı revizyonunu tutarlı gösteriyor; Orijinal Ex-Factory tarihi…" }, items: [
    { tr: "Buyer Log 7.0.201: Ex-Factory revizyonları Backlog’da tüm segmentlerde kullanıcı revizyonunu tutarlı gösteriyor; Orijinal Ex-Factory tarihi Focus görünümünde revize tarihinin yanında yer alıyor. IAS/HANDOVER gerçek yükleme ve transit hesabı için ayrı korunuyor. Orders salt-okunur revizyon geçmişi dahil 7.0.200 düzeltmeleri korunmuştur.", en: "Buyer Log 7.0.201: Ex-Factory revizyonları Backlog’da tüm segmentlerde kullanıcı revizyonunu tutarlı gösteriyor; Orijinal Ex-Factory tarihi Focus görünümünde revize tarihinin yanında yer alıyor. IAS/HANDOVER gerçek yükleme ve transit hesabı için ayrı korunuyor. Orders salt-okunur revizyon geçmişi dahil 7.0.200 düzeltmeleri korunmuştur." },
  ] },

  { v: "7.200", date: "2026-10-02", title: { tr: "Orders ekranında ekip arkadaşlarına ait salt-okunur siparişlerde Ex-Factory revizyon geçmişi artık orijinal tarih →…", en: "Orders ekranında ekip arkadaşlarına ait salt-okunur siparişlerde Ex-Factory revizyon geçmişi artık orijinal tarih →…" }, items: [
    { tr: "Buyer Log 7.0.200: Orders ekranında ekip arkadaşlarına ait salt-okunur siparişlerde Ex-Factory revizyon geçmişi artık orijinal tarih → revize tarih olarak gösteriliyor. Aynı davranış Retail Date ve In-Store tarih revizyonlarında da salt-okunur satırlar için tutarlı hale getirildi; LT ve Ex→Retail mevcut revizyon karşılaştırması korundu.", en: "Buyer Log 7.0.200: Orders ekranında ekip arkadaşlarına ait salt-okunur siparişlerde Ex-Factory revizyon geçmişi artık orijinal tarih → revize tarih olarak gösteriliyor. Aynı davranış Retail Date ve In-Store tarih revizyonlarında da salt-okunur satırlar için tutarlı hale getirildi; LT ve Ex→Retail mevcut revizyon karşılaştırması korundu." },
  ] },

  { v: "7.199", date: "2026-10-02", title: { tr: "Backlog › Planlanan & Gerçekleşen — plan penceresi (yüklenmesi planlanıp yüklenmeyen / tarihi geçmiş / geç / zamanında /…", en: "Backlog › Planlanan & Gerçekleşen — plan penceresi (yüklenmesi planlanıp yüklenmeyen / tarihi geçmiş / geç / zamanında /…" }, items: [
    { tr: "Buyer Log 7.0.199: Backlog › Planlanan & Gerçekleşen — plan penceresi (yüklenmesi planlanıp yüklenmeyen / tarihi geçmiş / geç / zamanında / kısmi), Buyer · Buying Group · MAG · MMYG · Ürün Ana Tanım · Üretici · Sezon bazında yatay yığılmış barlar (fareyle bilgi, tıklayınca sağdan sipariş listesi), plan günü ve Ex-Factory revizyon grafikleri, grafikli ve biçimli Excel dışa aktarımı; Handover tarihi boş yüklemeler artık gerçekleşen sayılıyor. Genel kültür arşivi 2.379 bilgiye çıktı; modül hazır olunca \"… ekranına devam et\"; LFL ve Backlog sayfalarında da bekleme ekranı. CP numune senkronu PLM SYNC gibi adımlı pencerede; açılıştaki Devam düğmesi hizası düzeltildi.", en: "Buyer Log 7.0.199: Backlog › Planlanan & Gerçekleşen — plan penceresi (yüklenmesi planlanıp yüklenmeyen / tarihi geçmiş / geç / zamanında / kısmi), Buyer · Buying Group · MAG · MMYG · Ürün Ana Tanım · Üretici · Sezon bazında yatay yığılmış barlar (fareyle bilgi, tıklayınca sağdan sipariş listesi), plan günü ve Ex-Factory revizyon grafikleri, grafikli ve biçimli Excel dışa aktarımı; Handover tarihi boş yüklemeler artık gerçekleşen sayılıyor. Genel kültür arşivi 2.379 bilgiye çıktı; modül hazır olunca \"… ekranına devam et\"; LFL ve Backlog sayfalarında da bekleme ekranı. CP numune senkronu PLM SYNC gibi adımlı pencerede; açılıştaki Devam düğmesi hizası düzeltildi." },
  ] },

  { v: "7.198", date: "2026-10-02", title: { tr: "PLM numune onay süreçleri — üretim sonrası aşamadaki veya sevk miktarı olan siparişler PLM'den bağımsız 'Onaylı · Üretim…", en: "PLM numune onay süreçleri — üretim sonrası aşamadaki veya sevk miktarı olan siparişler PLM'den bağımsız 'Onaylı · Üretim…" }, items: [
    { tr: "Buyer Log 7.0.198: PLM numune onay süreçleri — üretim sonrası aşamadaki veya sevk miktarı olan siparişler PLM'den bağımsız 'Onaylı · Üretim sonrası'; 'Customs & Port Operations' gümrük aşaması olarak tanınıyor; onaylı giriş önceliği ve aşama zinciri (S/Off → Artwork, PPS → Fit/S/Off/Artwork), Sample Evaluation onayı geçerli; CP › PLM SYNC › PLM NUMUNELERİ'nde Seçili / Eksik / Üretimdeki / Tümü; yeni öncelik kuralı: Ex-factory'ye 21 gün kala onaysız PPS; 24 saatten eski numune verisi CP açılışında arka planda tazelenir. Bekleme ekranları: sayfa yüklemelerinde genel kültür kartları, kart içi önceki/sonraki, açılışta 'Buyer Log hazır → Devam et', arşiv bitene kadar tekrar yok, açılıştaki yarım menü görüntüsü giderildi, girişten yumuşak geçiş.", en: "Buyer Log 7.0.198: PLM numune onay süreçleri — üretim sonrası aşamadaki veya sevk miktarı olan siparişler PLM'den bağımsız 'Onaylı · Üretim sonrası'; 'Customs & Port Operations' gümrük aşaması olarak tanınıyor; onaylı giriş önceliği ve aşama zinciri (S/Off → Artwork, PPS → Fit/S/Off/Artwork), Sample Evaluation onayı geçerli; CP › PLM SYNC › PLM NUMUNELERİ'nde Seçili / Eksik / Üretimdeki / Tümü; yeni öncelik kuralı: Ex-factory'ye 21 gün kala onaysız PPS; 24 saatten eski numune verisi CP açılışında arka planda tazelenir. Bekleme ekranları: sayfa yüklemelerinde genel kültür kartları, kart içi önceki/sonraki, açılışta 'Buyer Log hazır → Devam et', arşiv bitene kadar tekrar yok, açılıştaki yarım menü görüntüsü giderildi, girişten yumuşak geçiş." },
  ] },

  { v: "7.197", date: "2026-10-02", title: { tr: "Açılış bekleme ekranında kullanım ipuçları yerine 'Biliyor muydunuz?' kartları gösteriliyor: 14 kategoride 179 az bilinen…", en: "Açılış bekleme ekranında kullanım ipuçları yerine 'Biliyor muydunuz?' kartları gösteriliyor: 14 kategoride 179 az bilinen…" }, items: [
    { tr: "Buyer Log 7.0.197: Açılış bekleme ekranında kullanım ipuçları yerine 'Biliyor muydunuz?' kartları gösteriliyor: 14 kategoride 179 az bilinen genel kültür bilgisi, her kategoriye özgü hareketli çizimlerle. Görülmemiş bilgiler önce gelir; kullanım ipuçları F1 Kullanım Rehberi'nde kalmaya devam ediyor. 7.0.196 düzeltmelerini de içerir: ikinci kez başlatılan Buyer Log çalışan güncelleme denemesini geri almıyor; Check for Updates penceresine moderatöre özel Tekrar Dene düğmesi eklendi.", en: "Buyer Log 7.0.197: Açılış bekleme ekranında kullanım ipuçları yerine 'Biliyor muydunuz?' kartları gösteriliyor: 14 kategoride 179 az bilinen genel kültür bilgisi, her kategoriye özgü hareketli çizimlerle. Görülmemiş bilgiler önce gelir; kullanım ipuçları F1 Kullanım Rehberi'nde kalmaya devam ediyor. 7.0.196 düzeltmelerini de içerir: ikinci kez başlatılan Buyer Log çalışan güncelleme denemesini geri almıyor; Check for Updates penceresine moderatöre özel Tekrar Dene düğmesi eklendi." },
  ] },

  { v: "7.196", date: "2026-10-01", title: { tr: "Yeni sürüm açılırken ikinci kez başlatılan Buyer Log artık çalışan güncelleme denemesini geri almıyor; tek kopya kilidi…", en: "Yeni sürüm açılırken ikinci kez başlatılan Buyer Log artık çalışan güncelleme denemesini geri almıyor; tek kopya kilidi…" }, items: [
    { tr: "Buyer Log 7.0.196: Yeni sürüm açılırken ikinci kez başlatılan Buyer Log artık çalışan güncelleme denemesini geri almıyor; tek kopya kilidi güncelleme işlemlerinden önce alınıyor. Check for Updates penceresine, health check sonrası engellenen sürüm için moderatöre özel Tekrar Dene düğmesi eklendi.", en: "Buyer Log 7.0.196: Yeni sürüm açılırken ikinci kez başlatılan Buyer Log artık çalışan güncelleme denemesini geri almıyor; tek kopya kilidi güncelleme işlemlerinden önce alınıyor. Check for Updates penceresine, health check sonrası engellenen sürüm için moderatöre özel Tekrar Dene düğmesi eklendi." },
  ] },

  { v: "7.195", date: "2026-10-01", title: { tr: "Backlog alt detay pencereleri CP tablosuyla aynı tasarıma getirildi; Odak/Genişletilmiş/Tümü görünümü, alt satıra sarılan…", en: "Backlog alt detay pencereleri CP tablosuyla aynı tasarıma getirildi; Odak/Genişletilmiş/Tümü görünümü, alt satıra sarılan…" }, items: [
    { tr: "Buyer Log 7.0.195: Backlog alt detay pencereleri CP tablosuyla aynı tasarıma getirildi; Odak/Genişletilmiş/Tümü görünümü, alt satıra sarılan uzun sütun başlıkları, sürüklenerek ayarlanan kalıcı sütun genişlikleri, Sütunları Sığdır ve sütun filtreleri eklendi. Send to Pricing için taslak e-postayı yeniden açma eklendi. Price & Supplier ekranında aranabilir çoklu seçimli filtreler ve tüm alanların filtre olarak eklenebilmesi sağlandı. Dinamik sütun filtreleme ve Product Main Definition desteği eklendi. Sayfa yükleme durumlarında Thinking Orbs göstergesi kullanılıyor. Quotations'ta yeniden kullanılan Koleksiyon satır kimlikleri nedeniyle Best Price/fiyat geçmişinin karışması engellendi.", en: "Buyer Log 7.0.195: Backlog alt detay pencereleri CP tablosuyla aynı tasarıma getirildi; Odak/Genişletilmiş/Tümü görünümü, alt satıra sarılan uzun sütun başlıkları, sürüklenerek ayarlanan kalıcı sütun genişlikleri, Sütunları Sığdır ve sütun filtreleri eklendi. Send to Pricing için taslak e-postayı yeniden açma eklendi. Price & Supplier ekranında aranabilir çoklu seçimli filtreler ve tüm alanların filtre olarak eklenebilmesi sağlandı. Dinamik sütun filtreleme ve Product Main Definition desteği eklendi. Sayfa yükleme durumlarında Thinking Orbs göstergesi kullanılıyor. Quotations'ta yeniden kullanılan Koleksiyon satır kimlikleri nedeniyle Best Price/fiyat geçmişinin karışması engellendi." },
  ] },

  { v: "7.194", date: "2026-10-01", title: { tr: "Windows görev çubuğunda Buyer Log penceresinin BL logosu yerine genel beyaz dosya simgesiyle görünmesine neden olabilen…", en: "Windows görev çubuğunda Buyer Log penceresinin BL logosu yerine genel beyaz dosya simgesiyle görünmesine neden olabilen…" }, items: [
    { tr: "Buyer Log 7.0.194: Windows görev çubuğunda Buyer Log penceresinin BL logosu yerine genel beyaz dosya simgesiyle görünmesine neden olabilen AppUserModelID/kısayol eşleşmesi düzeltildi. BuyerLog.exe'yi hedefleyen Desktop, Start Menu ve sabitlenmiş Taskbar kısayollarının appUserModelId değeri artık çalışan Electron uygulamasındaki com.lcw.buyerlog kimliğiyle eşitleniyor. Bu hafif kimlik/simge eşitlemesi ilk BrowserWindow açılmadan önce çalışıyor; ağır EXE ikon yaması arka planda kalıyor. Eksik AppUserModelID için regresyon testi eklendi.", en: "Buyer Log 7.0.194: Windows görev çubuğunda Buyer Log penceresinin BL logosu yerine genel beyaz dosya simgesiyle görünmesine neden olabilen AppUserModelID/kısayol eşleşmesi düzeltildi. BuyerLog.exe'yi hedefleyen Desktop, Start Menu ve sabitlenmiş Taskbar kısayollarının appUserModelId değeri artık çalışan Electron uygulamasındaki com.lcw.buyerlog kimliğiyle eşitleniyor. Bu hafif kimlik/simge eşitlemesi ilk BrowserWindow açılmadan önce çalışıyor; ağır EXE ikon yaması arka planda kalıyor. Eksik AppUserModelID için regresyon testi eklendi." },
  ] },

  { v: "7.193", date: "2026-10-01", title: { tr: "PLM image jobs no longer fail every model one by one when the CoreNectum API token is missing or invalid; Buyer Log…", en: "PLM image jobs no longer fail every model one by one when the CoreNectum API token is missing or invalid; Buyer Log…" }, items: [
    { tr: "Buyer Log 7.0.193: PLM image jobs no longer fail every model one by one when the CoreNectum API token is missing or invalid; Buyer Log renews the PLM session automatically (silent SSO, then the CoreNectum login window) and retries once; if renewal still fails, the PLM User Sign-In screen opens (#250). CP image delete/update also revises the colour-named PLM image key so the old image no longer stays on screen (#249). Fixes: PLM Numune column source catalog entry, Partial View filter source and PLM request route module wiring. Includes everything in 7.0.192 (PLM sample requests in CP).", en: "Buyer Log 7.0.193: PLM image jobs no longer fail every model one by one when the CoreNectum API token is missing or invalid; Buyer Log renews the PLM session automatically (silent SSO, then the CoreNectum login window) and retries once; if renewal still fails, the PLM User Sign-In screen opens (#250). CP image delete/update also revises the colour-named PLM image key so the old image no longer stays on screen (#249). Fixes: PLM Numune column source catalog entry, Partial View filter source and PLM request route module wiring. Includes everything in 7.0.192 (PLM sample requests in CP)." },
  ] },

  { v: "7.192", date: "2026-10-01", title: { tr: "Buyer Log 7.0.192 TEST: PLM sample requests (CoreNectum Requests tab: Artwork, Fit Sample, Perfect Sign Off, PPS) are…", en: "Buyer Log 7.0.192 TEST: PLM sample requests (CoreNectum Requests tab: Artwork, Fit Sample, Perfect Sign Off, PPS) are…" }, items: [
    { tr: "Buyer Log 7.0.192 TEST: PLM sample requests (CoreNectum Requests tab: Artwork, Fit Sample, Perfect Sign Off, PPS) are tracked in CP. New read-only CP/Orders column \"PLM Numune\" next to Priority shows each sample type as Approved / Open / Rejected (\"No request\" when PLM has none). New CP › PLM SYNC › Update PLM Sample Status fetches requests for selected (or filtered) CP rows. Checklist PPS / S/Off / critical sample / new Artwork questions close automatically when PLM has an approved request; open or rejected requests are shown with their PLM status; questions without a PLM request are still asked. Right-click a style in CP/Orders › PLM sample requests shows the PLM request table. Collection PLM Sync does not fetch sample requests. Also includes: PLM images — main colour uses the front+back model image, other colours use their Options image (#246); Collection no longer treats hidden columns as read-only when writing or resolving dependencies (#248).", en: "Buyer Log 7.0.192 TEST: PLM sample requests (CoreNectum Requests tab: Artwork, Fit Sample, Perfect Sign Off, PPS) are tracked in CP. New read-only CP/Orders column \"PLM Numune\" next to Priority shows each sample type as Approved / Open / Rejected (\"No request\" when PLM has none). New CP › PLM SYNC › Update PLM Sample Status fetches requests for selected (or filtered) CP rows. Checklist PPS / S/Off / critical sample / new Artwork questions close automatically when PLM has an approved request; open or rejected requests are shown with their PLM status; questions without a PLM request are still asked. Right-click a style in CP/Orders › PLM sample requests shows the PLM request table. Collection PLM Sync does not fetch sample requests. Also includes: PLM images — main colour uses the front+back model image, other colours use their Options image (#246); Collection no longer treats hidden columns as read-only when writing or resolving dependencies (#248)." },
  ] },

  { v: "7.191", date: "2026-10-01", title: { tr: "Buyer Log 7.0.191 TEST: INTAKE no longer loses dimension values (blank Dönem Tanım / UrunKlasmanTanım rows) after saving…", en: "Buyer Log 7.0.191 TEST: INTAKE no longer loses dimension values (blank Dönem Tanım / UrunKlasmanTanım rows) after saving…" }, items: [
    { tr: "Buyer Log 7.0.191 TEST: INTAKE no longer loses dimension values (blank Dönem Tanım / UrunKlasmanTanım rows) after saving the view; saved field identities, filter values and labels are preserved and snapshots are remapped to current field IDs. Filter value lists no longer report a misleading 'live source unavailable' message. New weighted-average summarization: SEZON OTB (REZERV DAHİL) subtotals and grand total are weighted by Güncel Alım Bütçe. 'Check for Updates' menu label is unified for all users.", en: "Buyer Log 7.0.191 TEST: INTAKE no longer loses dimension values (blank Dönem Tanım / UrunKlasmanTanım rows) after saving the view; saved field identities, filter values and labels are preserved and snapshots are remapped to current field IDs. Filter value lists no longer report a misleading 'live source unavailable' message. New weighted-average summarization: SEZON OTB (REZERV DAHİL) subtotals and grand total are weighted by Güncel Alım Bütçe. 'Check for Updates' menu label is unified for all users." },
  ] },

  { v: "7.190", date: "2026-10-01", title: { tr: "Buyer Log 7.0.190 TEST: PLM SYNC now resolves category-prefixed OAB option names (e.g", en: "Buyer Log 7.0.190 TEST: PLM SYNC now resolves category-prefixed OAB option names (e.g" }, items: [
    { tr: "Buyer Log 7.0.190 TEST: PLM SYNC now resolves category-prefixed OAB option names (e.g. KK.BDY,GARFIELD-1-YD) and not-yet-ordered options via Collection model codes. Backlog detail tables now render images saved by PLM SYNC by reading each row's internal PLM/colour identity.", en: "Buyer Log 7.0.190 TEST: PLM SYNC now resolves category-prefixed OAB option names (e.g. KK.BDY,GARFIELD-1-YD) and not-yet-ordered options via Collection model codes. Backlog detail tables now render images saved by PLM SYNC by reading each row's internal PLM/colour identity." },
  ] },

  { v: "7.189", date: "2026-10-01", title: { tr: "Buyer Log 7.0.189 TEST: World Clock holidays now use a resilient live provider chain", en: "Buyer Log 7.0.189 TEST: World Clock holidays now use a resilient live provider chain" }, items: [
    { tr: "Buyer Log 7.0.189 TEST: World Clock holidays now use a resilient live provider chain. Nager remains primary, unsupported countries can fall back to a live ICS feed, India keeps verified central-government fallback data, and the last-known-good holiday calendar is cached locally so outages do not erase holidays. Full Buyer Log regression suite passed.", en: "Buyer Log 7.0.189 TEST: World Clock holidays now use a resilient live provider chain. Nager remains primary, unsupported countries can fall back to a live ICS feed, India keeps verified central-government fallback data, and the last-known-good holiday calendar is cached locally so outages do not erase holidays. Full Buyer Log regression suite passed." },
  ] },

  { v: "7.188", date: "2026-10-01", title: { tr: "Buyer Log 7.0.188 TEST: Global Flow detail drawers now mirror the CP column order, widths and Focus / Extended / All presets", en: "Buyer Log 7.0.188 TEST: Global Flow detail drawers now mirror the CP column order, widths and Focus / Extended / All presets" }, items: [
    { tr: "Buyer Log 7.0.188 TEST: Global Flow detail drawers now mirror the CP column order, widths and Focus / Extended / All presets. Partial-specific status, handover, shipment quantity and transport values are preserved. Full Buyer Log regression suite passed.", en: "Buyer Log 7.0.188 TEST: Global Flow detail drawers now mirror the CP column order, widths and Focus / Extended / All presets. Partial-specific status, handover, shipment quantity and transport values are preserved. Full Buyer Log regression suite passed." },
  ] },

  { v: "7.187", date: "2026-10-01", title: { tr: "Buyer Log 7.0.187 TEST: Overview dünya saatlerindeki resmi tatil görünümü için kullanıcı seçilebilir periyot eklendi", en: "Buyer Log 7.0.187 TEST: Overview dünya saatlerindeki resmi tatil görünümü için kullanıcı seçilebilir periyot eklendi" }, items: [
    { tr: "Buyer Log 7.0.187 TEST: Overview dünya saatlerindeki resmi tatil görünümü için kullanıcı seçilebilir periyot eklendi. Saatleri düzenle alanından Önümüzdeki 1, 3, 6 veya 12 ay seçilebilir; varsayılan 3 aydır ve tercih kullanıcı bazında saklanır. Seçilen periyottaki ulusal resmi tatiller listelenir; uzun listeler saat kartını büyütmek yerine kendi içinde kaydırılır. Takvim ayı sınırları ve ay sonu tarihleri güvenli şekilde hesaplanır. Tam Buyer Log regresyon testi geçti.", en: "Buyer Log 7.0.187 TEST: Overview dünya saatlerindeki resmi tatil görünümü için kullanıcı seçilebilir periyot eklendi. Saatleri düzenle alanından Önümüzdeki 1, 3, 6 veya 12 ay seçilebilir; varsayılan 3 aydır ve tercih kullanıcı bazında saklanır. Seçilen periyottaki ulusal resmi tatiller listelenir; uzun listeler saat kartını büyütmek yerine kendi içinde kaydırılır. Takvim ayı sınırları ve ay sonu tarihleri güvenli şekilde hesaplanır. Tam Buyer Log regresyon testi geçti." },
  ] },

  { v: "7.186", date: "2026-10-01", title: { tr: "Buyer Log 7.0.186 TEST: Overview dünya saatlerine isteğe bağlı resmi tatil bilgisi eklendi", en: "Buyer Log 7.0.186 TEST: Overview dünya saatlerine isteğe bağlı resmi tatil bilgisi eklendi" }, items: [
    { tr: "Buyer Log 7.0.186 TEST: Overview dünya saatlerine isteğe bağlı resmi tatil bilgisi eklendi. Saatleri düzenle alanındaki ayarla özellik açılıp kapatılabilir; desteklenen ülke saatlerinde önümüzdeki 45 gün içindeki en yakın 2 ulusal resmi tatil, Bugün/Yarın/X gün bilgisiyle saatin altında gösterilir. Tatil servisi erişilemezse saatler normal çalışmaya devam eder. Dünya saatleri resmi tatil kontrolleri ve regresyon testleri dahildir.", en: "Buyer Log 7.0.186 TEST: Overview dünya saatlerine isteğe bağlı resmi tatil bilgisi eklendi. Saatleri düzenle alanındaki ayarla özellik açılıp kapatılabilir; desteklenen ülke saatlerinde önümüzdeki 45 gün içindeki en yakın 2 ulusal resmi tatil, Bugün/Yarın/X gün bilgisiyle saatin altında gösterilir. Tatil servisi erişilemezse saatler normal çalışmaya devam eder. Dünya saatleri resmi tatil kontrolleri ve regresyon testleri dahildir." },
  ] },

  { v: "7.185", date: "2026-10-01", title: { tr: "tüm özellikleri gerçekten bilgisayara getiren son güncelleme", en: "tüm özellikleri gerçekten bilgisayara getiren son güncelleme" }, items: [
    { tr: "Buyer Log 7.0.185: tüm özellikleri gerçekten bilgisayara getiren son güncelleme. İlk açılışta tek seferlik kurulum onarımı çalışır: eski ekran önbelleği temizlenir (filtreler, ayarlar ve oturumlar korunur), güncellemeyi engelleyen eski geri alma kayıtları silinir ve uygulama dosyaları paket içindeki SHA-256 listesiyle tek tek doğrulanır; bozuk dosya varsa temiz kopya hazırlanıp sonraki açılışta uygulanır. Sonuç Sürüm Geçmişi › Güncellemeler panelinde 'Kurulum onarımı' satırında görünür. Yeni sürümün açılış onayı artık yeniden denenir; böylece sürüm sessizce geri alınmaz. 7.0.184 Endeksmatik başlık eşleşmesi düzeltmesi, F1 rehberi/ipuçları ve Horizon çoklu seçim dahil tüm özellikler bu pakettedir. Tam regresyon paketi geçti.", en: "Buyer Log 7.0.185: tüm özellikleri gerçekten bilgisayara getiren son güncelleme. İlk açılışta tek seferlik kurulum onarımı çalışır: eski ekran önbelleği temizlenir (filtreler, ayarlar ve oturumlar korunur), güncellemeyi engelleyen eski geri alma kayıtları silinir ve uygulama dosyaları paket içindeki SHA-256 listesiyle tek tek doğrulanır; bozuk dosya varsa temiz kopya hazırlanıp sonraki açılışta uygulanır. Sonuç Sürüm Geçmişi › Güncellemeler panelinde 'Kurulum onarımı' satırında görünür. Yeni sürümün açılış onayı artık yeniden denenir; böylece sürüm sessizce geri alınmaz. 7.0.184 Endeksmatik başlık eşleşmesi düzeltmesi, F1 rehberi/ipuçları ve Horizon çoklu seçim dahil tüm özellikler bu pakettedir. Tam regresyon paketi geçti." },
  ] },

  { v: "7.184", date: "2026-10-01", title: { tr: "tüm özellikleri gerçekten bilgisayara getiren son güncelleme", en: "tüm özellikleri gerçekten bilgisayara getiren son güncelleme" }, items: [
    { tr: "Buyer Log 7.0.184: tüm özellikleri gerçekten bilgisayara getiren son güncelleme. İlk açılışta tek seferlik kurulum onarımı çalışır: eski ekran önbelleği temizlenir (filtreler, ayarlar ve oturumlar korunur), güncellemeyi engelleyen eski geri alma kayıtları silinir ve uygulama dosyaları paket içindeki SHA-256 listesiyle tek tek doğrulanır; bozuk dosya varsa temiz kopya hazırlanıp sonraki açılışta uygulanır. Sonuç Sürüm Geçmişi › Güncellemeler panelinde 'Kurulum onarımı' satırında görünür. Yeni sürümün açılış onayı artık yeniden denenir; böylece sürüm sessizce geri alınmaz. F1 rehberi/ipuçları ve Horizon çoklu seçim dahil tüm özellikler bu pakettedir. Tam regresyon paketi geçti.", en: "Buyer Log 7.0.184: tüm özellikleri gerçekten bilgisayara getiren son güncelleme. İlk açılışta tek seferlik kurulum onarımı çalışır: eski ekran önbelleği temizlenir (filtreler, ayarlar ve oturumlar korunur), güncellemeyi engelleyen eski geri alma kayıtları silinir ve uygulama dosyaları paket içindeki SHA-256 listesiyle tek tek doğrulanır; bozuk dosya varsa temiz kopya hazırlanıp sonraki açılışta uygulanır. Sonuç Sürüm Geçmişi › Güncellemeler panelinde 'Kurulum onarımı' satırında görünür. Yeni sürümün açılış onayı artık yeniden denenir; böylece sürüm sessizce geri alınmaz. F1 rehberi/ipuçları ve Horizon çoklu seçim dahil tüm özellikler bu pakettedir. Tam regresyon paketi geçti." },
  ] },

  { v: "7.183", date: "2026-10-01", title: { tr: "Horizon (Veri Yönetimi kaynak filtresi) artık kullanıcı bazlı", en: "Horizon (Veri Yönetimi kaynak filtresi) artık kullanıcı bazlı" }, items: [
    { tr: "Buyer Log 7.0.183: Horizon (Veri Yönetimi kaynak filtresi) artık kullanıcı bazlı. \"Kaydet (yalnız benim için)\" filtreyi yalnız sizin kaydınıza yazar; Sync klasörü üzerinden başka bilgisayarlara gitmez, başka bir kullanıcının değişikliği sizin filtrenizi bozmaz. Bağlı modüllerde (Orders · Backlog · LFL · Price) kişisel filtre grubun hepsine uygulanır. Ortak varsayılan filtreyi yalnız yönetim yetkisi olanlar \"Herkes için\" düğmesiyle değiştirebilir; kişisel filtre \"Kişisel ×\" rozetinden kaldırılabilir. Tam regresyon paketi yerelde ve Windows CI'da geçti.", en: "Buyer Log 7.0.183: Horizon (Veri Yönetimi kaynak filtresi) artık kullanıcı bazlı. \"Kaydet (yalnız benim için)\" filtreyi yalnız sizin kaydınıza yazar; Sync klasörü üzerinden başka bilgisayarlara gitmez, başka bir kullanıcının değişikliği sizin filtrenizi bozmaz. Bağlı modüllerde (Orders · Backlog · LFL · Price) kişisel filtre grubun hepsine uygulanır. Ortak varsayılan filtreyi yalnız yönetim yetkisi olanlar \"Herkes için\" düğmesiyle değiştirebilir; kişisel filtre \"Kişisel ×\" rozetinden kaldırılabilir. Tam regresyon paketi yerelde ve Windows CI'da geçti." },
  ] },

  { v: "7.182", date: "2026-10-01", title: { tr: "Get OAB ve Veri Yönetimi › Browser & Remote Debugging artık 3–4 tarayıcıyı açıp kapatmaz — tarayıcı sürümü pencere…", en: "Get OAB ve Veri Yönetimi › Browser & Remote Debugging artık 3–4 tarayıcıyı açıp kapatmaz — tarayıcı sürümü pencere…" }, items: [
    { tr: "Buyer Log 7.0.182: Get OAB ve Veri Yönetimi › Browser & Remote Debugging artık 3–4 tarayıcıyı açıp kapatmaz — tarayıcı sürümü pencere açmadan kurulum klasöründen okunur, tarayıcı tek kez açılır. OAB: açık PASS sekmesi oturumu geçerliyse sekme yenilenmeden kullanılır; sekme yoksa tarayıcının boş başlangıç sekmesi doğrudan PASS'e gider; site raporu kendisi çalıştırmaz, veri sekmenin içinden doğrudan API ile çekilir. Model görselleri tarayıcı önbelleğinde gerçekten kalır: ilk açılış hızlanır, sayfalar arası geçişte görseller kaybolmaz. Tam regresyon paketi yerelde ve Windows CI'da geçti.", en: "Buyer Log 7.0.182: Get OAB ve Veri Yönetimi › Browser & Remote Debugging artık 3–4 tarayıcıyı açıp kapatmaz — tarayıcı sürümü pencere açmadan kurulum klasöründen okunur, tarayıcı tek kez açılır. OAB: açık PASS sekmesi oturumu geçerliyse sekme yenilenmeden kullanılır; sekme yoksa tarayıcının boş başlangıç sekmesi doğrudan PASS'e gider; site raporu kendisi çalıştırmaz, veri sekmenin içinden doğrudan API ile çekilir. Model görselleri tarayıcı önbelleğinde gerçekten kalır: ilk açılış hızlanır, sayfalar arası geçişte görseller kaybolmaz. Tam regresyon paketi yerelde ve Windows CI'da geçti." },
  ] },

  { v: "7.181", date: "2026-10-01", title: { tr: "Yenileme artık sayfa bazlı — CP yenilemesi yalnız CP sorgusunu çalıştırır, en geniş filtreyi (LFL · Fiyat & Üretici)…", en: "Yenileme artık sayfa bazlı — CP yenilemesi yalnız CP sorgusunu çalıştırır, en geniş filtreyi (LFL · Fiyat & Üretici)…" }, items: [
    { tr: "Buyer Log 7.0.181: Yenileme artık sayfa bazlı — CP yenilemesi yalnız CP sorgusunu çalıştırır, en geniş filtreyi (LFL · Fiyat & Üretici) beklemez; ortak filtreyi paylaşan sayfalar birlikte yenilenir, \"Tümünü yenile\" hepsini kapsar. Yeni: Kaynak değişince otomatik güncelleme — ASAS modeli işlendiğinde (son işlenme zamanı metadata ile okunur, ağır sorgu periyodik atılmaz) ekranlar arka planda kendiliğinden yenilenir, önce CP; hücre düzenlenirken veya pencere açıkken beklenir. Veri Yönetimi › Yenileme’den kapatılabilir (varsayılan açık). Kısmi yenilemede Horizon rozetleri korunur; yenileme sonrası ön-hazırlık yalnız yenilenen sayfaları yükler. Tam regresyon paketi yerelde ve Windows CI’da geçti.", en: "Buyer Log 7.0.181: Yenileme artık sayfa bazlı — CP yenilemesi yalnız CP sorgusunu çalıştırır, en geniş filtreyi (LFL · Fiyat & Üretici) beklemez; ortak filtreyi paylaşan sayfalar birlikte yenilenir, \"Tümünü yenile\" hepsini kapsar. Yeni: Kaynak değişince otomatik güncelleme — ASAS modeli işlendiğinde (son işlenme zamanı metadata ile okunur, ağır sorgu periyodik atılmaz) ekranlar arka planda kendiliğinden yenilenir, önce CP; hücre düzenlenirken veya pencere açıkken beklenir. Veri Yönetimi › Yenileme’den kapatılabilir (varsayılan açık). Kısmi yenilemede Horizon rozetleri korunur; yenileme sonrası ön-hazırlık yalnız yenilenen sayfaları yükler. Tam regresyon paketi yerelde ve Windows CI’da geçti." },
  ] },

  { v: "7.180", date: "2026-09-30", title: { tr: "Açılışta kullanıcı bilgileri ve ana ekran hazır olana kadar dinamik hazırlık ekranı; 66 konuluk TR/EN görselli kullanım…", en: "Açılışta kullanıcı bilgileri ve ana ekran hazır olana kadar dinamik hazırlık ekranı; 66 konuluk TR/EN görselli kullanım…" }, items: [
    { tr: "Buyer Log 7.0.180: Açılışta kullanıcı bilgileri ve ana ekran hazır olana kadar dinamik hazırlık ekranı; 66 konuluk TR/EN görselli kullanım rehberi ve F1 erişimi. Horizon filtrelerinde pencereyi kapatmadan çoklu seçim. Koleksiyon/ASAS eşleşmesinde katalogda olmayan değerler için hücre üzerinde kalıcı görünür uyarı işareti. Global Flow Map'te Gemi + Uçak gibi çoklu taşıma tiplerinde rota hover ve detay başlıklarında tam nakliye tipi gösterimi. 7.0.179 sonrasındaki bekleyen ana dal değişikliklerinin tamamı dahil edilmiştir.", en: "Buyer Log 7.0.180: Açılışta kullanıcı bilgileri ve ana ekran hazır olana kadar dinamik hazırlık ekranı; 66 konuluk TR/EN görselli kullanım rehberi ve F1 erişimi. Horizon filtrelerinde pencereyi kapatmadan çoklu seçim. Koleksiyon/ASAS eşleşmesinde katalogda olmayan değerler için hücre üzerinde kalıcı görünür uyarı işareti. Global Flow Map'te Gemi + Uçak gibi çoklu taşıma tiplerinde rota hover ve detay başlıklarında tam nakliye tipi gösterimi. 7.0.179 sonrasındaki bekleyen ana dal değişikliklerinin tamamı dahil edilmiştir." },
  ] },

  { v: "7.179", date: "2026-09-30", title: { tr: "Klasör kopyalanarak kurulan bilgisayarlar otomatik onarılır — her kurulum kendi cihaz kimliğini alır, kopyalar arasında…", en: "Klasör kopyalanarak kurulan bilgisayarlar otomatik onarılır — her kurulum kendi cihaz kimliğini alır, kopyalar arasında…" }, items: [
    { tr: "Buyer Log 7.0.179: Klasör kopyalanarak kurulan bilgisayarlar otomatik onarılır — her kurulum kendi cihaz kimliğini alır, kopyalar arasında kaçırılan senkron değişiklikleri gelir, aynı alandaki farklı düzenlemeler sessizce ezilmez, çakışma olarak gösterilir. Başka bilgisayardan kopyalanan sürüm işaretçisi düzeltilir; eski sürüme düşen kullanıcılar güncel özellikleri (ör. PLM → Koleksiyon sürükle-bırak) geri alır. Eksik paketle açılışta anlaşılır hata ve kurulum yönlendirmesi; yeni kullanıcılar için tek parça kurulum paketi. Hesaplanan sütun \"Koşula göre yaz\" birden çok kural (değilse eğer) destekler. Kullanıcı menüsünden herkes STABLE uygulama güncellemesini kontrol edip kurabilir; kanal seçimi yalnız moderatörde. Tam regresyon paketi yerelde ve Windows CI'da geçti.", en: "Buyer Log 7.0.179: Klasör kopyalanarak kurulan bilgisayarlar otomatik onarılır — her kurulum kendi cihaz kimliğini alır, kopyalar arasında kaçırılan senkron değişiklikleri gelir, aynı alandaki farklı düzenlemeler sessizce ezilmez, çakışma olarak gösterilir. Başka bilgisayardan kopyalanan sürüm işaretçisi düzeltilir; eski sürüme düşen kullanıcılar güncel özellikleri (ör. PLM → Koleksiyon sürükle-bırak) geri alır. Eksik paketle açılışta anlaşılır hata ve kurulum yönlendirmesi; yeni kullanıcılar için tek parça kurulum paketi. Hesaplanan sütun \"Koşula göre yaz\" birden çok kural (değilse eğer) destekler. Kullanıcı menüsünden herkes STABLE uygulama güncellemesini kontrol edip kurabilir; kanal seçimi yalnız moderatörde. Tam regresyon paketi yerelde ve Windows CI'da geçti." },
  ] },

  { v: "7.177", date: "2026-09-30", title: { tr: "Aynı bilgisayarda birden fazla kullanıcı — her profil kendi filtre, görünüm ve sütun ayarlarını ayrı kaydeder (hızlı…", en: "Aynı bilgisayarda birden fazla kullanıcı — her profil kendi filtre, görünüm ve sütun ayarlarını ayrı kaydeder (hızlı…" }, items: [
    { tr: "Buyer Log 7.0.177: Aynı bilgisayarda birden fazla kullanıcı — her profil kendi filtre, görünüm ve sütun ayarlarını ayrı kaydeder (hızlı filtre grupları, koleksiyon hızlı boyutları, hesaplanan sütunlar, Excel içe aktarma profilleri, sütun genişlikleri vb.); eski ortak kayıt yalnız ilk açan profile taşınır. Hesaplanan sütun \"Koşula göre yaz\" birden çok koşulu VE / VEYA ile bağlar. Otomasyon AI sözlüğü EN kipinde İngilizce; Sync durum penceresi kopuk render koruması. Tam regresyon paketi yerelde geçti.", en: "Buyer Log 7.0.177: Aynı bilgisayarda birden fazla kullanıcı — her profil kendi filtre, görünüm ve sütun ayarlarını ayrı kaydeder (hızlı filtre grupları, koleksiyon hızlı boyutları, hesaplanan sütunlar, Excel içe aktarma profilleri, sütun genişlikleri vb.); eski ortak kayıt yalnız ilk açan profile taşınır. Hesaplanan sütun \"Koşula göre yaz\" birden çok koşulu VE / VEYA ile bağlar. Otomasyon AI sözlüğü EN kipinde İngilizce; Sync durum penceresi kopuk render koruması. Tam regresyon paketi yerelde geçti." },
  ] },

  { v: "7.176", date: "2026-09-30", title: { tr: "EN/TR dil bütünlüğü — EN kipinde Türkçe, TR kipinde İngilizce kalan arayüz metinleri, tarih seçici, sunucu hata/durum…", en: "EN/TR dil bütünlüğü — EN kipinde Türkçe, TR kipinde İngilizce kalan arayüz metinleri, tarih seçici, sunucu hata/durum…" }, items: [
    { tr: "Buyer Log 7.0.176: EN/TR dil bütünlüğü — EN kipinde Türkçe, TR kipinde İngilizce kalan arayüz metinleri, tarih seçici, sunucu hata/durum mesajları ve giriş ekranı mesajları seçili dile çevrildi; dil değiştirince eski dilde kalan ekranlar düzeltildi. Otomasyonlar: hazır senaryolar, Hazır mı? paneli, alan denetimi ve AI ile yaz. Manuel fiyat regresyon testi yeni ortak Quotations davranışına hizalandı. Tam regresyon paketi yerelde geçti.", en: "Buyer Log 7.0.176: EN/TR dil bütünlüğü — EN kipinde Türkçe, TR kipinde İngilizce kalan arayüz metinleri, tarih seçici, sunucu hata/durum mesajları ve giriş ekranı mesajları seçili dile çevrildi; dil değiştirince eski dilde kalan ekranlar düzeltildi. Otomasyonlar: hazır senaryolar, Hazır mı? paneli, alan denetimi ve AI ile yaz. Manuel fiyat regresyon testi yeni ortak Quotations davranışına hizalandı. Tam regresyon paketi yerelde geçti." },
  ] },

  { v: "7.175", date: "2026-09-30", title: { tr: "Buyer Log 7.0.175 TEST: Claude ve ChatGPT güncellemeleri birleştirildi", en: "Buyer Log 7.0.175 TEST: Claude ve ChatGPT güncellemeleri birleştirildi" }, items: [
    { tr: "Buyer Log 7.0.175 TEST: Claude ve ChatGPT güncellemeleri birleştirildi. Hesaplanan sütunlar yeniden adlandırmalara dayanıklı kalıcı referanslar kullanıyor; Calculated Column akışı sadeleştirildi, formül sözlüğü/analizi ve AI handoff eklendi; EN/TR sütun adları korunuyor. PLM translation remembered-choice ve sütun display-name/persistence iyileştirmeleri dahil. Çalışma alanı sekme çubuğundaki BL logosu kaldırıldı; Capacity Request Excel seçim yokken disabled/soluk; CP/Orders seçim filtresi ve Collection toolbar/hiyerarşi düzenlemeleri dahil. Full Buyer Log regression suite GitHub Actions üzerinden başarıyla geçti. STABLE kanalına terfi edilmedi.", en: "Buyer Log 7.0.175 TEST: Claude ve ChatGPT güncellemeleri birleştirildi. Hesaplanan sütunlar yeniden adlandırmalara dayanıklı kalıcı referanslar kullanıyor; Calculated Column akışı sadeleştirildi, formül sözlüğü/analizi ve AI handoff eklendi; EN/TR sütun adları korunuyor. PLM translation remembered-choice ve sütun display-name/persistence iyileştirmeleri dahil. Çalışma alanı sekme çubuğundaki BL logosu kaldırıldı; Capacity Request Excel seçim yokken disabled/soluk; CP/Orders seçim filtresi ve Collection toolbar/hiyerarşi düzenlemeleri dahil. Full Buyer Log regression suite GitHub Actions üzerinden başarıyla geçti. STABLE kanalına terfi edilmedi." },
  ] },

  { v: "7.174", date: "2026-09-30", title: { tr: "Buyer Log 7.0.174 TEST: OAB/Get OAB artık PASS sekmesini tekrar tekrar açmıyor; istekler açık PASS sekmesindeki güncel…", en: "Buyer Log 7.0.174 TEST: OAB/Get OAB artık PASS sekmesini tekrar tekrar açmıyor; istekler açık PASS sekmesindeki güncel…" }, items: [
    { tr: "Buyer Log 7.0.174 TEST: OAB/Get OAB artık PASS sekmesini tekrar tekrar açmıyor; istekler açık PASS sekmesindeki güncel token ile gidiyor, reddedilirse kabul görmüş token ile bir kez yeniden deneniyor. Koleksiyon araç çubuğu ve hiyerarşisi sadeleştirildi (Yeni satır ikon oldu, gereksiz Selected Models etiketi kalktı, eylem geri bildirimi iyileşti); çalışma alanı sekme çubuğundan BL logosu kaldırıldı; Capacity Request dışa aktarımı satır seçilmeden kapalı. 7.0.172-7.0.173 Endeksmatik çoklu set ve USD modeli özellikleri dahildir. Node regression suite (766 dosya) başarıyla geçti. STABLE kanalına terfi edilmedi.", en: "Buyer Log 7.0.174 TEST: OAB/Get OAB artık PASS sekmesini tekrar tekrar açmıyor; istekler açık PASS sekmesindeki güncel token ile gidiyor, reddedilirse kabul görmüş token ile bir kez yeniden deneniyor. Koleksiyon araç çubuğu ve hiyerarşisi sadeleştirildi (Yeni satır ikon oldu, gereksiz Selected Models etiketi kalktı, eylem geri bildirimi iyileşti); çalışma alanı sekme çubuğundan BL logosu kaldırıldı; Capacity Request dışa aktarımı satır seçilmeden kapalı. 7.0.172-7.0.173 Endeksmatik çoklu set ve USD modeli özellikleri dahildir. Node regression suite (766 dosya) başarıyla geçti. STABLE kanalına terfi edilmedi." },
  ] },

  { v: "7.173", date: "2026-09-29", title: { tr: "Buyer Log 7.0.173 TEST: Endeksmatik yüklemesi, ENDEKSMATİK ekranındaki hedef hücreleri (E15..E18) farklı kurulmuş gerçek…", en: "Buyer Log 7.0.173 TEST: Endeksmatik yüklemesi, ENDEKSMATİK ekranındaki hedef hücreleri (E15..E18) farklı kurulmuş gerçek…" }, items: [
    { tr: "Buyer Log 7.0.173 TEST: Endeksmatik yüklemesi, ENDEKSMATİK ekranındaki hedef hücreleri (E15..E18) farklı kurulmuş gerçek ülke dosyalarını artık reddetmiyor. Fiyatı belirleyen bileşen Δ ve TOPLAM hücreleri (C15..C19) hâlâ imza ve Excel sonuç karşılaştırmasından geçmek zorunda; hedef hücreleri yalnız uyarı olarak raporlanır ve varsayılan düzeltme B21'den alınır (hesapta değiştirilebilir). Endeksmatik Setleri listesinde uyarı sayısı görünür. 7.0.172'deki çoklu Endeksmatik seti, USD modeli, TR fiyatı ve SING OFF özellikleri dahildir. Node regression suite (765 dosya) başarıyla geçti. STABLE kanalına terfi edilmedi.", en: "Buyer Log 7.0.173 TEST: Endeksmatik yüklemesi, ENDEKSMATİK ekranındaki hedef hücreleri (E15..E18) farklı kurulmuş gerçek ülke dosyalarını artık reddetmiyor. Fiyatı belirleyen bileşen Δ ve TOPLAM hücreleri (C15..C19) hâlâ imza ve Excel sonuç karşılaştırmasından geçmek zorunda; hedef hücreleri yalnız uyarı olarak raporlanır ve varsayılan düzeltme B21'den alınır (hesapta değiştirilebilir). Endeksmatik Setleri listesinde uyarı sayısı görünür. 7.0.172'deki çoklu Endeksmatik seti, USD modeli, TR fiyatı ve SING OFF özellikleri dahildir. Node regression suite (765 dosya) başarıyla geçti. STABLE kanalına terfi edilmedi." },
  ] },

  { v: "7.172", date: "2026-09-29", title: { tr: "Buyer Log 7.0.172 TEST: Endeksmatik yenilendi", en: "Buyer Log 7.0.172 TEST: Endeksmatik yenilendi" }, items: [
    { tr: "Buyer Log 7.0.172 TEST: Endeksmatik yenilendi. Koleksiyon › Araçlar › Endeksmatik Setleri ile birden çok ülke/bölge Endeksmatik dosyası (Bangladeş, Hindistan Kuzey/Güney, Myanmar, Çin) yüklenip saklanır; varsayılan set seçilir, setler adlandırılır/silinir. Yeni USD modeli dosyadan başlığa göre okunur; ENDEKSMATİK formül mantığı (imza) ve Excel önbellekli sonuçları Buyer Log yeniden hesabıyla karşılaştırılır, tutmazsa dosya \"model değişti\" diye reddedilir. Hesap penceresinde set ve hesap seviyesi (Klasman…MMYG) seçilir; TR fiyatı korunur; SING OFF bölümü FOB/landed avantaj ve gerekli fiyatı verir. Sonuç set sürümünü taşır, yeni set gelince \"Yeni veri var\" görünür. Eski TL şablonu çalışmaya devam eder. Ayrıca main'deki satin çelik ikon ve TR/EN/JA/ZH avatar baş harfleri dahildir. Node regression suite (765 dosya) başarıyla geçti. STABLE kanalına terfi edilmedi.", en: "Buyer Log 7.0.172 TEST: Endeksmatik yenilendi. Koleksiyon › Araçlar › Endeksmatik Setleri ile birden çok ülke/bölge Endeksmatik dosyası (Bangladeş, Hindistan Kuzey/Güney, Myanmar, Çin) yüklenip saklanır; varsayılan set seçilir, setler adlandırılır/silinir. Yeni USD modeli dosyadan başlığa göre okunur; ENDEKSMATİK formül mantığı (imza) ve Excel önbellekli sonuçları Buyer Log yeniden hesabıyla karşılaştırılır, tutmazsa dosya \"model değişti\" diye reddedilir. Hesap penceresinde set ve hesap seviyesi (Klasman…MMYG) seçilir; TR fiyatı korunur; SING OFF bölümü FOB/landed avantaj ve gerekli fiyatı verir. Sonuç set sürümünü taşır, yeni set gelince \"Yeni veri var\" görünür. Eski TL şablonu çalışmaya devam eder. Ayrıca main'deki satin çelik ikon ve TR/EN/JA/ZH avatar baş harfleri dahildir. Node regression suite (765 dosya) başarıyla geçti. STABLE kanalına terfi edilmedi." },
  ] },

  { v: "7.171", date: "2026-09-29", title: { tr: "Buyer Log 7.0.171 TEST: Collection'da Best Price / Conf", en: "Buyer Log 7.0.171 TEST: Collection'da Best Price / Conf" }, items: [
    { tr: "Buyer Log 7.0.171 TEST: Collection'da Best Price / Conf. Manufacturer hücresindeki ✎ (Enter price manually) düğmesine tek tıklama artık pencereyi arka arkaya defalarca açmıyor; tablo her yeniden çizildiğinde biriken tıklama dinleyicisi tek sefere indirildi ve katalog yüklenirken gelen ikinci tıklama ayrı pencere açmıyor. Ayrıca main'deki denim BL ikon güncellemesi dahildir: daha net ikon, giriş ekranında büyük ikon, kullanıcı avatarında aynı malzeme, görev çubuğu ikonu ve BuyerLog.exe ikonunun bir sonraki açılışta güncellenmesi. Windows Node regression suite başarıyla geçti. STABLE kanalına terfi edilmedi.", en: "Buyer Log 7.0.171 TEST: Collection'da Best Price / Conf. Manufacturer hücresindeki ✎ (Enter price manually) düğmesine tek tıklama artık pencereyi arka arkaya defalarca açmıyor; tablo her yeniden çizildiğinde biriken tıklama dinleyicisi tek sefere indirildi ve katalog yüklenirken gelen ikinci tıklama ayrı pencere açmıyor. Ayrıca main'deki denim BL ikon güncellemesi dahildir: daha net ikon, giriş ekranında büyük ikon, kullanıcı avatarında aynı malzeme, görev çubuğu ikonu ve BuyerLog.exe ikonunun bir sonraki açılışta güncellenmesi. Windows Node regression suite başarıyla geçti. STABLE kanalına terfi edilmedi." },
  ] },

  { v: "7.170", date: "2026-09-29", title: { tr: "Buyer Log 7.0.170 TEST: Açık Claude güncellemeleri main'e merge edilerek yayınlandı", en: "Buyer Log 7.0.170 TEST: Açık Claude güncellemeleri main'e merge edilerek yayınlandı" }, items: [
    { tr: "Buyer Log 7.0.170 TEST: Açık Claude güncellemeleri main'e merge edilerek yayınlandı. Backlog: ASAS sipariş düzeyi Kalan Alım Sipariş Miktarı ve Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo değerleri artık parsiyel adetine kopyalanmıyor, siparişin satırlarına dağıtılıyor ve toplamları ASAS ile birebir eşleşiyor. Retaile Aktarım Bekleniyor kuralı artık Kalan_Merkez eksi Kalan Alım farkına bakıyor; yalnız eksik yüklemesi kalan siparişlerin Depoda parsiyelleri Depoda kalıyor. Sipariş Backlog Raporu penceresinden alınan Excel'de parsiyel Antrepo Giriş Tarihi, Antrepo-Retail, handover ve onay tarihleri artık dolu. CP Database/Horizon sütunları ASAS/IAS'ta verisi olduğu halde boş kalmıyor. Açılış ekranında yeni thinking animasyonu; CP, Orders ve Collection'da Columns butonu tekrar tıklanabilir. Full Buyer Log regression suite başarıyla geçti. STABLE kanalına terfi edilmedi.", en: "Buyer Log 7.0.170 TEST: Açık Claude güncellemeleri main'e merge edilerek yayınlandı. Backlog: ASAS sipariş düzeyi Kalan Alım Sipariş Miktarı ve Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo değerleri artık parsiyel adetine kopyalanmıyor, siparişin satırlarına dağıtılıyor ve toplamları ASAS ile birebir eşleşiyor. Retaile Aktarım Bekleniyor kuralı artık Kalan_Merkez eksi Kalan Alım farkına bakıyor; yalnız eksik yüklemesi kalan siparişlerin Depoda parsiyelleri Depoda kalıyor. Sipariş Backlog Raporu penceresinden alınan Excel'de parsiyel Antrepo Giriş Tarihi, Antrepo-Retail, handover ve onay tarihleri artık dolu. CP Database/Horizon sütunları ASAS/IAS'ta verisi olduğu halde boş kalmıyor. Açılış ekranında yeni thinking animasyonu; CP, Orders ve Collection'da Columns butonu tekrar tıklanabilir. Full Buyer Log regression suite başarıyla geçti. STABLE kanalına terfi edilmedi." },
  ] },

  { v: "7.169", date: "2026-09-29", title: { tr: "Buyer Log 7.0.169 TEST: Son Claude güncellemesi main'e merge edilerek yayınlandı", en: "Buyer Log 7.0.169 TEST: Son Claude güncellemesi main'e merge edilerek yayınlandı" }, items: [
    { tr: "Buyer Log 7.0.169 TEST: Son Claude güncellemesi main'e merge edilerek yayınlandı. Collection alan önerileri artık ASAS master katalogdan License, Category, Country, Season, Line, Manufacturer ve Product Main Definition değerlerini kapsam/horizon filtresinden bağımsız okuyabiliyor; scoped katalog ile birleştiriliyor, eşleşmeyen değerler uyarılıyor ve kullanıcı katalog yenilemesi yapabiliyor. Önceki 7.0.168 kapsamındaki PLM Add as a New ve diğer güncel main değişiklikleri de dahildir. Full Buyer Log regression suite başarıyla geçti. STABLE kanalına terfi edilmedi.", en: "Buyer Log 7.0.169 TEST: Son Claude güncellemesi main'e merge edilerek yayınlandı. Collection alan önerileri artık ASAS master katalogdan License, Category, Country, Season, Line, Manufacturer ve Product Main Definition değerlerini kapsam/horizon filtresinden bağımsız okuyabiliyor; scoped katalog ile birleştiriliyor, eşleşmeyen değerler uyarılıyor ve kullanıcı katalog yenilemesi yapabiliyor. Önceki 7.0.168 kapsamındaki PLM Add as a New ve diğer güncel main değişiklikleri de dahildir. Full Buyer Log regression suite başarıyla geçti. STABLE kanalına terfi edilmedi." },
  ] },

  { v: "7.168", date: "2026-09-29", title: { tr: "Buyer Log 7.0.168 TEST: Existing Collection model karar ekranına Add as a New / Yeni olarak ekle seçeneği eklendi", en: "Buyer Log 7.0.168 TEST: Existing Collection model karar ekranına Add as a New / Yeni olarak ekle seçeneği eklendi" }, items: [
    { tr: "Buyer Log 7.0.168 TEST: Existing Collection model karar ekranına Add as a New / Yeni olarak ekle seçeneği eklendi. Aynı PLM ID, farklı In Store dönemleri için mevcut satır değiştirilmeden ikinci bağımsız Collection satırı olarak yalnız açık kullanıcı seçimiyle eklenebilir. Excel PLM importu ve PLM'de Seçili Modelleri Aktar aynı güvenli oluşturma hattını kullanır; otomatik planner mevcut PLM ID'leri kendiliğinden çoğaltmaz. Full Buyer Log regression suite başarıyla geçti.", en: "Buyer Log 7.0.168 TEST: Existing Collection model karar ekranına Add as a New / Yeni olarak ekle seçeneği eklendi. Aynı PLM ID, farklı In Store dönemleri için mevcut satır değiştirilmeden ikinci bağımsız Collection satırı olarak yalnız açık kullanıcı seçimiyle eklenebilir. Excel PLM importu ve PLM'de Seçili Modelleri Aktar aynı güvenli oluşturma hattını kullanır; otomatik planner mevcut PLM ID'leri kendiliğinden çoğaltmaz. Full Buyer Log regression suite başarıyla geçti." },
  ] },

  { v: "7.167", date: "2026-09-29", title: { tr: "Buyer Log 7.0.167 TEST: Güncel main dalından kesildi ve halihazırda merge edilmiş Claude güncellemelerinin tamamını içerir", en: "Buyer Log 7.0.167 TEST: Güncel main dalından kesildi ve halihazırda merge edilmiş Claude güncellemelerinin tamamını içerir" }, items: [
    { tr: "Buyer Log 7.0.167 TEST: Güncel main dalından kesildi ve halihazırda merge edilmiş Claude güncellemelerinin tamamını içerir. Önceki 7.0.166 kapsamındaki Collection Status anlık renk yenilemesi, arama/info düzeltmeleri, yeni ikon revizyonu ve eksik model görsellerini açılışta sessiz tamamlama dahil mevcut main içeriği TEST kanalına taşındı. Full Buyer Log regression suite başarıyla geçti. STABLE kanalına terfi edilmedi.", en: "Buyer Log 7.0.167 TEST: Güncel main dalından kesildi ve halihazırda merge edilmiş Claude güncellemelerinin tamamını içerir. Önceki 7.0.166 kapsamındaki Collection Status anlık renk yenilemesi, arama/info düzeltmeleri, yeni ikon revizyonu ve eksik model görsellerini açılışta sessiz tamamlama dahil mevcut main içeriği TEST kanalına taşındı. Full Buyer Log regression suite başarıyla geçti. STABLE kanalına terfi edilmedi." },
  ] },

  { v: "7.166", date: "2026-09-29", title: { tr: "Buyer Log 7.0.166 TEST: Collection Status hücre rengi seçim anında yenilenir; arama kutusu info butonu çoklama hatası…", en: "Buyer Log 7.0.166 TEST: Collection Status hücre rengi seçim anında yenilenir; arama kutusu info butonu çoklama hatası…" }, items: [
    { tr: "Buyer Log 7.0.166 TEST: Collection Status hücre rengi seçim anında yenilenir; arama kutusu info butonu çoklama hatası giderildi ve uzun aramalar hover/focus ile genişler; yeni Buyer Log ikon seti dahil edildi; eksik model görselleri açılışta sessiz ve kontrollü şekilde otomatik tamamlanır. Güncel main üzerindeki tüm değişiklikler dahil edildi. Full Buyer Log regression suite başarıyla geçti.", en: "Buyer Log 7.0.166 TEST: Collection Status hücre rengi seçim anında yenilenir; arama kutusu info butonu çoklama hatası giderildi ve uzun aramalar hover/focus ile genişler; yeni Buyer Log ikon seti dahil edildi; eksik model görselleri açılışta sessiz ve kontrollü şekilde otomatik tamamlanır. Güncel main üzerindeki tüm değişiklikler dahil edildi. Full Buyer Log regression suite başarıyla geçti." },
  ] },

  { v: "7.163", date: "2026-09-29", title: { tr: "Buyer Log 7.0.163 TEST: Eksik kalan Minimal Icon Library v3 sidebar revizyonu eklendi", en: "Buyer Log 7.0.163 TEST: Eksik kalan Minimal Icon Library v3 sidebar revizyonu eklendi" }, items: [
    { tr: "Buyer Log 7.0.163 TEST: Eksik kalan Minimal Icon Library v3 sidebar revizyonu eklendi. Overview BL-N01, CP Tracker BL-N03, Orders BL-N06, Backlog BL-N08, Shipping Comparison BL-N09, Collection BL-N11, Quotations BL-N13, Pricing History BL-N15, Price & Supplier Analysis BL-N17, LFL Analysis BL-N19, Open Costing BL-N21, Automations BL-N23 ve Data Management BL-N25 eşlemeleri uygulandı. Mevcut sidebar boyut, spacing, renk, hover ve alignment davranışı korunmuştur. Tam Buyer Log regresyon paketi başarıyla geçti.", en: "Buyer Log 7.0.163 TEST: Eksik kalan Minimal Icon Library v3 sidebar revizyonu eklendi. Overview BL-N01, CP Tracker BL-N03, Orders BL-N06, Backlog BL-N08, Shipping Comparison BL-N09, Collection BL-N11, Quotations BL-N13, Pricing History BL-N15, Price & Supplier Analysis BL-N17, LFL Analysis BL-N19, Open Costing BL-N21, Automations BL-N23 ve Data Management BL-N25 eşlemeleri uygulandı. Mevcut sidebar boyut, spacing, renk, hover ve alignment davranışı korunmuştur. Tam Buyer Log regresyon paketi başarıyla geçti." },
  ] },

  { v: "7.162", date: "2026-09-29", title: { tr: "Buyer Log 7.0.162 TEST: Claude tarafından hazırlanan Android-style Overview ana ekranı ve review düzeltmeleri entegre…", en: "Buyer Log 7.0.162 TEST: Claude tarafından hazırlanan Android-style Overview ana ekranı ve review düzeltmeleri entegre…" }, items: [
    { tr: "Buyer Log 7.0.162 TEST: Claude tarafından hazırlanan Android-style Overview ana ekranı ve review düzeltmeleri entegre edildi; widget yerleşimi, çoklu sayfa, sürükle-bırak, yeniden boyutlandırma, Active Order Breakdown ve senkron layout davranışları güncellendi. LFL ana analiz tablolarının yükseklikleri sabitlendi ve kullanıcı resize ayarı kalıcı hale getirildi. Tam Buyer Log regresyon paketi başarıyla geçti.", en: "Buyer Log 7.0.162 TEST: Claude tarafından hazırlanan Android-style Overview ana ekranı ve review düzeltmeleri entegre edildi; widget yerleşimi, çoklu sayfa, sürükle-bırak, yeniden boyutlandırma, Active Order Breakdown ve senkron layout davranışları güncellendi. LFL ana analiz tablolarının yükseklikleri sabitlendi ve kullanıcı resize ayarı kalıcı hale getirildi. Tam Buyer Log regresyon paketi başarıyla geçti." },
  ] },

  { v: "7.161", date: "2026-09-28", title: { tr: "Buyer Log 7.0.161 TEST: Price & Supplier Analysis filtre alanı özelleştirilebilir hale getirildi", en: "Buyer Log 7.0.161 TEST: Price & Supplier Analysis filtre alanı özelleştirilebilir hale getirildi" }, items: [
    { tr: "Buyer Log 7.0.161 TEST: Price & Supplier Analysis filtre alanı özelleştirilebilir hale getirildi. Kullanıcı Buying Group, Buyer, MAG, MMYG, Klasman, Ürün Grubu, Ülke ve Üretici filtrelerini ekleyip çıkarabilir; filtre düzeni kalıcıdır. Güncel ve kıyas sezonları için birbirinden bağımsız In-Store / OPD dönem alanı ve ay filtresi eklendi; farklı sezon ve aylar doğru şekilde karşılaştırılabilir. Tam Buyer Log regresyon paketi başarıyla geçti.", en: "Buyer Log 7.0.161 TEST: Price & Supplier Analysis filtre alanı özelleştirilebilir hale getirildi. Kullanıcı Buying Group, Buyer, MAG, MMYG, Klasman, Ürün Grubu, Ülke ve Üretici filtrelerini ekleyip çıkarabilir; filtre düzeni kalıcıdır. Güncel ve kıyas sezonları için birbirinden bağımsız In-Store / OPD dönem alanı ve ay filtresi eklendi; farklı sezon ve aylar doğru şekilde karşılaştırılabilir. Tam Buyer Log regresyon paketi başarıyla geçti." },
  ] },

  { v: "7.160", date: "2026-09-28", title: { tr: "Buyer Log 7.0.160 TEST: Claude tarafından bekleyen aktif geliştirmeler güncel main üzerine güvenli şekilde entegre edildi", en: "Buyer Log 7.0.160 TEST: Claude tarafından bekleyen aktif geliştirmeler güncel main üzerine güvenli şekilde entegre edildi" }, items: [
    { tr: "Buyer Log 7.0.160 TEST: Claude tarafından bekleyen aktif geliştirmeler güncel main üzerine güvenli şekilde entegre edildi. Price & Supplier Analysis yeniden inşa ve review düzeltmeleri; kullanıcı menüsünden self-service preset paylaşımı; IAS horizon mapping ve INTAKE filtre/yenileme tutarlılığı; Orders · Backlog · LFL · Price & Supplier için ortak horizon ve bağlı yenileme davranışı eklendi. Eski Global Flow/Earth Claude branchleri daha önce güncel main'e uyarlanarak merge edilmiş olduğundan tekrar uygulanmadı. Tüm birleşik değişiklikler final tam Buyer Log regresyon paketinden başarıyla geçti.", en: "Buyer Log 7.0.160 TEST: Claude tarafından bekleyen aktif geliştirmeler güncel main üzerine güvenli şekilde entegre edildi. Price & Supplier Analysis yeniden inşa ve review düzeltmeleri; kullanıcı menüsünden self-service preset paylaşımı; IAS horizon mapping ve INTAKE filtre/yenileme tutarlılığı; Orders · Backlog · LFL · Price & Supplier için ortak horizon ve bağlı yenileme davranışı eklendi. Eski Global Flow/Earth Claude branchleri daha önce güncel main'e uyarlanarak merge edilmiş olduğundan tekrar uygulanmadı. Tüm birleşik değişiklikler final tam Buyer Log regresyon paketinden başarıyla geçti." },
  ] },

  { v: "7.159", date: "2026-09-28", title: { tr: "Buyer Log 7.0.159 TEST: 7.0.158 sonrasındaki LFL düzeltmeleri yayınlandı", en: "Buyer Log 7.0.159 TEST: 7.0.158 sonrasındaki LFL düzeltmeleri yayınlandı" }, items: [
    { tr: "Buyer Log 7.0.159 TEST: 7.0.158 sonrasındaki LFL düzeltmeleri yayınlandı. MAG · MMYG · Classification · Product Description Comparison ve Manufacturer Order Volumes analiz tablolarının yükseklikleri kullanıcı yeniden boyutlandırmadıkça sabit tutuluyor; veri/etkileşim sonrası ekranın altına uzama davranışı engellendi. Multi-dimensional Comparison · Independent Scenarios alanındaki Columns açılır penceresi kendi tetikleyici butonuna doğru şekilde sabitlendi. İlgili regresyon testleri eklendi.", en: "Buyer Log 7.0.159 TEST: 7.0.158 sonrasındaki LFL düzeltmeleri yayınlandı. MAG · MMYG · Classification · Product Description Comparison ve Manufacturer Order Volumes analiz tablolarının yükseklikleri kullanıcı yeniden boyutlandırmadıkça sabit tutuluyor; veri/etkileşim sonrası ekranın altına uzama davranışı engellendi. Multi-dimensional Comparison · Independent Scenarios alanındaki Columns açılır penceresi kendi tetikleyici butonuna doğru şekilde sabitlendi. İlgili regresyon testleri eklendi." },
  ] },

  { v: "7.158", date: "2026-09-28", title: { tr: "7.0.155 sonrasındaki main güncellemeleri TEST kanalında yayınlandı", en: "7.0.155 sonrasındaki main güncellemeleri TEST kanalında yayınlandı" }, items: [
    { tr: "Buyer Log 7.0.158: 7.0.155 sonrasındaki main güncellemeleri TEST kanalında yayınlandı. OAB pivot alt detayları ortak sağ detay çekmecesine taşındı ve kalıcı sütun seçimi eklendi; PLM görsel/kimlik eşleştirmeleri OAB için genişletildi. Focus/Extended görünüm tercihleri oturumlar arasında kalıcı hale getirildi, seçili model PLM SYNC kapsamı düzeltildi, hızlı CP veri girişinde arka plan yenilemesinden kaynaklanan veri kaybı riski giderildi, INTAKE ay sıralaması ve sıfır bütçe filtresi düzeltildi, Collection durum renkleri TR/EN ortak katalogla eşlendi ve Global Flow Map gecikmiş sevkiyat sarı çerçeve davranışı güvenli biçimde düzeltildi.", en: "Buyer Log 7.0.158: 7.0.155 sonrasındaki main güncellemeleri TEST kanalında yayınlandı. OAB pivot alt detayları ortak sağ detay çekmecesine taşındı ve kalıcı sütun seçimi eklendi; PLM görsel/kimlik eşleştirmeleri OAB için genişletildi. Focus/Extended görünüm tercihleri oturumlar arasında kalıcı hale getirildi, seçili model PLM SYNC kapsamı düzeltildi, hızlı CP veri girişinde arka plan yenilemesinden kaynaklanan veri kaybı riski giderildi, INTAKE ay sıralaması ve sıfır bütçe filtresi düzeltildi, Collection durum renkleri TR/EN ortak katalogla eşlendi ve Global Flow Map gecikmiş sevkiyat sarı çerçeve davranışı güvenli biçimde düzeltildi." },
  ] },

  { v: "7.155", date: "2026-09-28", title: { tr: "Son iki gündeki başarısız/unmerged çalışmaların main'de eksik kalan parçaları güvenli biçimde geri alındı", en: "Son iki gündeki başarısız/unmerged çalışmaların main'de eksik kalan parçaları güvenli biçimde geri alındı" }, items: [
    { tr: "Buyer Log 7.0.155: Son iki gündeki başarısız/unmerged çalışmaların main'de eksik kalan parçaları güvenli biçimde geri alındı. Backlog Excel/grafik canlı senkron korumaları, IAS Horizon canlı şema/field mapping onarımı ve PLM Sync sırasında Royalty/Licensor bilgisinin korunması dahil edildi; mevcut OAB external browser ve INTAKE davranışları korunarak regression testleri güncellendi.", en: "Buyer Log 7.0.155: Son iki gündeki başarısız/unmerged çalışmaların main'de eksik kalan parçaları güvenli biçimde geri alındı. Backlog Excel/grafik canlı senkron korumaları, IAS Horizon canlı şema/field mapping onarımı ve PLM Sync sırasında Royalty/Licensor bilgisinin korunması dahil edildi; mevcut OAB external browser ve INTAKE davranışları korunarak regression testleri güncellendi." },
  ] },

  { v: "7.153", date: "2026-09-27", title: { tr: "Buyer Log 7.0.153 TEST sürümü yayınlandı", en: "Buyer Log 7.0.153 TEST sürümü yayınlandı" }, items: [
    { tr: "Buyer Log 7.0.153 TEST sürümü yayınlandı.", en: "Buyer Log 7.0.153 TEST sürümü yayınlandı." },
  ] },

  { v: "7.152", date: "2026-09-27", title: { tr: "Buyer Log 7.0.152 TEST sürümü yayınlandı", en: "Buyer Log 7.0.152 TEST sürümü yayınlandı" }, items: [
    { tr: "Buyer Log 7.0.152 TEST sürümü yayınlandı.", en: "Buyer Log 7.0.152 TEST sürümü yayınlandı." },
  ] },

  { v: "7.149", date: "2026-09-27", title: { tr: "Buyer Log 7.0.149 TEST sürümü yayınlandı", en: "Buyer Log 7.0.149 TEST sürümü yayınlandı" }, items: [
    { tr: "Buyer Log 7.0.149 TEST sürümü yayınlandı.", en: "Buyer Log 7.0.149 TEST sürümü yayınlandı." },
  ] },

  { v: "7.148", date: "2026-09-27", title: { tr: "Earth 3D artık varsayılan olarak ücretsiz ve anahtarsız NASA GIBS görüntülerini kullanır", en: "Earth 3D artık varsayılan olarak ücretsiz ve anahtarsız NASA GIBS görüntülerini kullanır" }, items: [
    { tr: "Buyer Log 7.0.148: Earth 3D artık varsayılan olarak ücretsiz ve anahtarsız NASA GIBS görüntülerini kullanır. NASA Kabartmalı Dünya ve NASA Blue Marble modları eklendi; tamamen çevrimdışı yerel küre korunur. Google Map Tiles yalnız isteğe bağlı sağlayıcı olarak bırakıldı; Google anahtarı yoksa ücretli modlar API anahtarı istemek yerine ücretsiz NASA görünümüne düşer. Moderatör sağlayıcı ayarları Free / Offline / optional Google olarak güncellendi. Mevcut Global Flow rota, araç, clustering, hover ve seçim davranışları korunmuş, tam Buyer Log regression paketi başarıyla geçmiştir.", en: "Buyer Log 7.0.148: Earth 3D artık varsayılan olarak ücretsiz ve anahtarsız NASA GIBS görüntülerini kullanır. NASA Kabartmalı Dünya ve NASA Blue Marble modları eklendi; tamamen çevrimdışı yerel küre korunur. Google Map Tiles yalnız isteğe bağlı sağlayıcı olarak bırakıldı; Google anahtarı yoksa ücretli modlar API anahtarı istemek yerine ücretsiz NASA görünümüne düşer. Moderatör sağlayıcı ayarları Free / Offline / optional Google olarak güncellendi. Mevcut Global Flow rota, araç, clustering, hover ve seçim davranışları korunmuş, tam Buyer Log regression paketi başarıyla geçmiştir." },
  ] },

  { v: "7.147", date: "2026-09-27", title: { tr: "Global Flow'a lazy yüklenen CesiumJS tabanlı Earth 3D görünümü ve Buyer Log ⇄ Earth harita motoru geçişi eklendi", en: "Global Flow'a lazy yüklenen CesiumJS tabanlı Earth 3D görünümü ve Buyer Log ⇄ Earth harita motoru geçişi eklendi" }, items: [
    { tr: "Buyer Log 7.0.147: Global Flow'a lazy yüklenen CesiumJS tabanlı Earth 3D görünümü ve Buyer Log ⇄ Earth harita motoru geçişi eklendi. Earth runtime/provider ayarları, Moderatör kontrollü sağlayıcı yapılandırması, görünürlük/sekme/daraltma durumlarına göre pause-resume ve soğuk WebGL kapatma yaşam döngüsü, çevrimdışı/fallback davranışı ve ilgili ayar API'leri eklendi. Mevcut Global Flow tam rota hover vurgusu, zoom seviyesine bağlı araç kümeleri, gruplu araçlarda ortalama transit günü, ortak koridor seçim çekmecesi, geniş 2D/3D zoom ve doğal globe sürükleme davranışı korunarak birleştirildi. Earth route modülü repo sözleşmesine hizalandı ve tam Buyer Log regression paketi geçti.", en: "Buyer Log 7.0.147: Global Flow'a lazy yüklenen CesiumJS tabanlı Earth 3D görünümü ve Buyer Log ⇄ Earth harita motoru geçişi eklendi. Earth runtime/provider ayarları, Moderatör kontrollü sağlayıcı yapılandırması, görünürlük/sekme/daraltma durumlarına göre pause-resume ve soğuk WebGL kapatma yaşam döngüsü, çevrimdışı/fallback davranışı ve ilgili ayar API'leri eklendi. Mevcut Global Flow tam rota hover vurgusu, zoom seviyesine bağlı araç kümeleri, gruplu araçlarda ortalama transit günü, ortak koridor seçim çekmecesi, geniş 2D/3D zoom ve doğal globe sürükleme davranışı korunarak birleştirildi. Earth route modülü repo sözleşmesine hizalandı ve tam Buyer Log regression paketi geçti." },
  ] },

  { v: "7.146", date: "2026-09-27", title: { tr: "Global Flow haritasında yakın gemi/uçak/tır simgeleri zoom seviyesine göre kümeleniyor ve yakınlaştırıldıkça ayrışıyor", en: "Global Flow haritasında yakın gemi/uçak/tır simgeleri zoom seviyesine göre kümeleniyor ve yakınlaştırıldıkça ayrışıyor" }, items: [
    { tr: "Buyer Log 7.0.146: Global Flow haritasında yakın gemi/uçak/tır simgeleri zoom seviyesine göre kümeleniyor ve yakınlaştırıldıkça ayrışıyor. Ortak rota koridorları tek hat olarak birleştiriliyor; ortak hatta tıklanınca Bangladesh · Sea / India · Sea / Combined benzeri ülke-taşıma seçenekleriyle ilgili sipariş ve parsiyeller açılıyor. 3D sürükleme yönü doğal yüzey sürükleme davranışına çevrildi; 2D/3D maksimum zoom artırıldı. Overview dünya saatlerinde ülke/saat dilimi araması eklendi; yeni saat kartları aynı satırda okunabilirliği koruyarak adaptif daralıyor. İlgili regresyon testleri eklendi ve tam Buyer Log test paketi geçti.", en: "Buyer Log 7.0.146: Global Flow haritasında yakın gemi/uçak/tır simgeleri zoom seviyesine göre kümeleniyor ve yakınlaştırıldıkça ayrışıyor. Ortak rota koridorları tek hat olarak birleştiriliyor; ortak hatta tıklanınca Bangladesh · Sea / India · Sea / Combined benzeri ülke-taşıma seçenekleriyle ilgili sipariş ve parsiyeller açılıyor. 3D sürükleme yönü doğal yüzey sürükleme davranışına çevrildi; 2D/3D maksimum zoom artırıldı. Overview dünya saatlerinde ülke/saat dilimi araması eklendi; yeni saat kartları aynı satırda okunabilirliği koruyarak adaptif daralıyor. İlgili regresyon testleri eklendi ve tam Buyer Log test paketi geçti." },
  ] },

  { v: "7.145", date: "2026-09-27", title: { tr: "Claude'un Global Flow ve performans geliştirmeleri güncel main ile birleştirildi", en: "Claude'un Global Flow ve performans geliştirmeleri güncel main ile birleştirildi" }, items: [
    { tr: "Buyer Log 7.0.145: Claude'un Global Flow ve performans geliştirmeleri güncel main ile birleştirildi. Global Flow artık CP/Orders için tam veri sağlayıcılarını kullanıyor; parsiyel bazlı sevkiyat modeli, Gemi Ad bazlı araç gruplama, Bangladesh/India Colombo aktarmalı Gemi+Uçak rotaları, ortak rota segmentleri, Critical/hızlı filtreler ve çoklu panel filtreleri eklendi. Mevcut 2D 2:1 harita oranı, geniş zoom aralığı, 3D inertia ve aydınlık tema kontrastı korundu. Ortak detay çekmecesinde büyük veri kümeleri parça parça çiziliyor, arama geciktiriliyor ve görsel indeksi tek kez kuruluyor; sayfa bazlı sütun tercihleri, panel genişletme ve Tüm/Görünen Sütunlar Excel aktarımı korunuyor. İlgili regression ve performans testleri güncellendi.", en: "Buyer Log 7.0.145: Claude'un Global Flow ve performans geliştirmeleri güncel main ile birleştirildi. Global Flow artık CP/Orders için tam veri sağlayıcılarını kullanıyor; parsiyel bazlı sevkiyat modeli, Gemi Ad bazlı araç gruplama, Bangladesh/India Colombo aktarmalı Gemi+Uçak rotaları, ortak rota segmentleri, Critical/hızlı filtreler ve çoklu panel filtreleri eklendi. Mevcut 2D 2:1 harita oranı, geniş zoom aralığı, 3D inertia ve aydınlık tema kontrastı korundu. Ortak detay çekmecesinde büyük veri kümeleri parça parça çiziliyor, arama geciktiriliyor ve görsel indeksi tek kez kuruluyor; sayfa bazlı sütun tercihleri, panel genişletme ve Tüm/Görünen Sütunlar Excel aktarımı korunuyor. İlgili regression ve performans testleri güncellendi." },
  ] },

  { v: "7.144", date: "2026-09-27", title: { tr: "kullanıcı menüsüne mevcut güvenli masaüstü OAB SSO akışını kullanan manuel OAB Kullanıcı Girişi eklendi", en: "kullanıcı menüsüne mevcut güvenli masaüstü OAB SSO akışını kullanan manuel OAB Kullanıcı Girişi eklendi" }, items: [
    { tr: "Buyer Log 7.0.144: kullanıcı menüsüne mevcut güvenli masaüstü OAB SSO akışını kullanan manuel OAB Kullanıcı Girişi eklendi. Global Flow haritasının aydınlık/gri temadaki deniz, kara ve ülke sınırı kontrastı artırıldı; koyu tema korunuyor. Ayrıca ortak alt detay çekmecesinde sütun tercihleri sayfa bazlı saklanıyor, Excel dışa aktarımında Tüm Sütunlar/Görünen Sütunlar seçilebiliyor, boş hücreler canonical/nested kaynak fallback ile tamamlanıyor ve panel sol kenardan sürüklenerek genişletilebiliyor.", en: "Buyer Log 7.0.144: kullanıcı menüsüne mevcut güvenli masaüstü OAB SSO akışını kullanan manuel OAB Kullanıcı Girişi eklendi. Global Flow haritasının aydınlık/gri temadaki deniz, kara ve ülke sınırı kontrastı artırıldı; koyu tema korunuyor. Ayrıca ortak alt detay çekmecesinde sütun tercihleri sayfa bazlı saklanıyor, Excel dışa aktarımında Tüm Sütunlar/Görünen Sütunlar seçilebiliyor, boş hücreler canonical/nested kaynak fallback ile tamamlanıyor ve panel sol kenardan sürüklenerek genişletilebiliyor." },
  ] },

  { v: "7.143", date: "2026-09-26", title: { tr: "Global Flow Map daha doğru Natural Earth ülke sınırlarıyla yenilendi; harita yüklenirken thinking-orbs Working görseli…", en: "Global Flow Map daha doğru Natural Earth ülke sınırlarıyla yenilendi; harita yüklenirken thinking-orbs Working görseli…" }, items: [
    { tr: "Buyer Log 7.0.143: Global Flow Map daha doğru Natural Earth ülke sınırlarıyla yenilendi; harita yüklenirken thinking-orbs Working görseli kullanılıyor. Deniz sevkiyatları Suez/Çanakkale gibi gerçekçi deniz koridorlarından geçirilir, rota hover alanı tüm çizgi boyunca kesintisiz çalışır. İhracat/ithalat dosya numarası bazında gemi, uçak ve tır simgeleri Handover tarihi ile ülke/yükleme yol süresi kurallarına göre rota ilerlemesine yerleştirilir ve yakın araçlar gruplanır. Araç tıklaması ilgili siparişleri, rota tıklaması tüm rota siparişlerini açar. İstanbul varışında Awaiting Retail Transfer, Customs Operation ve In Warehouse; kalkış ülkesinde Production ve Loading Operations ayrımları hover/click detaylarıyla gösterilir. Global Flow, LFL, Backlog, CP, Collection Analytics, Price & Supplier Analysis ve operasyonel uyarı detayları ortak sağ çekmece altyapısına taşındı. Çekmece model görsellerini, PLM Sync'i, kalıcı sütun seçimini, aramayı ve yalnız görünür sütunları görseller hücreye bağlı olacak şekilde Excel'e aktarmayı destekler. Regresyon testleri genişletildi.", en: "Buyer Log 7.0.143: Global Flow Map daha doğru Natural Earth ülke sınırlarıyla yenilendi; harita yüklenirken thinking-orbs Working görseli kullanılıyor. Deniz sevkiyatları Suez/Çanakkale gibi gerçekçi deniz koridorlarından geçirilir, rota hover alanı tüm çizgi boyunca kesintisiz çalışır. İhracat/ithalat dosya numarası bazında gemi, uçak ve tır simgeleri Handover tarihi ile ülke/yükleme yol süresi kurallarına göre rota ilerlemesine yerleştirilir ve yakın araçlar gruplanır. Araç tıklaması ilgili siparişleri, rota tıklaması tüm rota siparişlerini açar. İstanbul varışında Awaiting Retail Transfer, Customs Operation ve In Warehouse; kalkış ülkesinde Production ve Loading Operations ayrımları hover/click detaylarıyla gösterilir. Global Flow, LFL, Backlog, CP, Collection Analytics, Price & Supplier Analysis ve operasyonel uyarı detayları ortak sağ çekmece altyapısına taşındı. Çekmece model görsellerini, PLM Sync'i, kalıcı sütun seçimini, aramayı ve yalnız görünür sütunları görseller hücreye bağlı olacak şekilde Excel'e aktarmayı destekler. Regresyon testleri genişletildi." },
  ] },

  { v: "7.142", date: "2026-09-26", title: { tr: "Overview ekranındaki Global Flow Map görünürlük sorunu düzeltildi", en: "Overview ekranındaki Global Flow Map görünürlük sorunu düzeltildi" }, items: [
    { tr: "Buyer Log 7.0.142: Overview ekranındaki Global Flow Map görünürlük sorunu düzeltildi. Modül 7.0.141'de DOM ve layout durumuna doğru şekilde eklenmişti ancak uygulamanın genel section { display:none } kuralını override etmediği için ekranda görünmüyor, buna rağmen düzen yöneticisi modülü mevcut saydığı için Modül Ekle listesinde de çıkmıyordu. Global Flow Map artık Overview'da normal şekilde görünür; mevcut 2D/3D görünüm, CP/Orders/Backlog/Combined kaynakları, filtreler, animasyonlu rota akışları, tam ekran ve çift tık detay özellikleri korunur. Bu görünürlük davranışı için regresyon testi eklendi.", en: "Buyer Log 7.0.142: Overview ekranındaki Global Flow Map görünürlük sorunu düzeltildi. Modül 7.0.141'de DOM ve layout durumuna doğru şekilde eklenmişti ancak uygulamanın genel section { display:none } kuralını override etmediği için ekranda görünmüyor, buna rağmen düzen yöneticisi modülü mevcut saydığı için Modül Ekle listesinde de çıkmıyordu. Global Flow Map artık Overview'da normal şekilde görünür; mevcut 2D/3D görünüm, CP/Orders/Backlog/Combined kaynakları, filtreler, animasyonlu rota akışları, tam ekran ve çift tık detay özellikleri korunur. Bu görünürlük davranışı için regresyon testi eklendi." },
  ] },

  { v: "7.141", date: "2026-09-26", title: { tr: "Overview ekranına Global Flow Map eklendi", en: "Overview ekranına Global Flow Map eklendi" }, items: [
    { tr: "Buyer Log 7.0.141: Overview ekranına Global Flow Map eklendi. Harita CP, Orders, Backlog veya Combined veri kaynağını kullanabilir; Combined görünüm aynı siparişi Backlog > Orders > CP önceliğiyle tekilleştirir. 2D dünya haritası ve 3D küre görünümü, açık/koyu tema desteği, sürükleme, yakınlaştırma, tam ekran, KPI ve detay filtreleri bulunur. Üretimde, sevke hazır, yolda ve İstanbul/depo durumları görselleştirilir; Gemi, Uçak, Tır ve Gemi+Uçak akışları animasyonlu rota çizgileriyle gösterilir. Harita üzerindeki akışlara çift tıklayarak sipariş detay drawer'ı açılabilir. Backlog verisi mevcut yetki ve aktif filtreleri koruyan /api/backlog-export hattından alınır. Global Flow Map mevcut Overview Edit Layout sistemine tam genişlik, taşınabilir ve daraltılabilir modül olarak entegre edilmiştir.", en: "Buyer Log 7.0.141: Overview ekranına Global Flow Map eklendi. Harita CP, Orders, Backlog veya Combined veri kaynağını kullanabilir; Combined görünüm aynı siparişi Backlog > Orders > CP önceliğiyle tekilleştirir. 2D dünya haritası ve 3D küre görünümü, açık/koyu tema desteği, sürükleme, yakınlaştırma, tam ekran, KPI ve detay filtreleri bulunur. Üretimde, sevke hazır, yolda ve İstanbul/depo durumları görselleştirilir; Gemi, Uçak, Tır ve Gemi+Uçak akışları animasyonlu rota çizgileriyle gösterilir. Harita üzerindeki akışlara çift tıklayarak sipariş detay drawer'ı açılabilir. Backlog verisi mevcut yetki ve aktif filtreleri koruyan /api/backlog-export hattından alınır. Global Flow Map mevcut Overview Edit Layout sistemine tam genişlik, taşınabilir ve daraltılabilir modül olarak entegre edilmiştir." },
  ] },

  { v: "7.140", date: "2026-09-26", title: { tr: "Backlog grafik navigasyonunda uzun hover listeleri kaydırılabilir hale getirildi ve Average çizgisi alt toplamların değil…", en: "Backlog grafik navigasyonunda uzun hover listeleri kaydırılabilir hale getirildi ve Average çizgisi alt toplamların değil…" }, items: [
    { tr: "Buyer Log 7.0.140: Backlog grafik navigasyonunda uzun hover listeleri kaydırılabilir hale getirildi ve Average çizgisi alt toplamların değil görünür veri noktalarının gerçek ortalamasını kullanacak şekilde düzeltildi. Tüm radar diyagramlarında sağ/sol etiket kırpılması giderildi ve her radara bağımsız filtreleme eklendi. Delivery Risk alanında KPI kartları ile risk radarı varsayılan 50/50 yan yana yerleşime alındı; KPI'lar 2 sıra x 3 kolon düzeninde gösteriliyor. Planlanan & Gerçekleşen Analizi karanlık tema tokenlarına bağlandı. Overview dünya saatlerine Dijital / Analog / Analog + Dijital görünüm seçimi ve tüm IANA saat dilimlerinden saat ekleme desteği eklendi; boşta görünen Workspace ready mesajı kaldırıldı.", en: "Buyer Log 7.0.140: Backlog grafik navigasyonunda uzun hover listeleri kaydırılabilir hale getirildi ve Average çizgisi alt toplamların değil görünür veri noktalarının gerçek ortalamasını kullanacak şekilde düzeltildi. Tüm radar diyagramlarında sağ/sol etiket kırpılması giderildi ve her radara bağımsız filtreleme eklendi. Delivery Risk alanında KPI kartları ile risk radarı varsayılan 50/50 yan yana yerleşime alındı; KPI'lar 2 sıra x 3 kolon düzeninde gösteriliyor. Planlanan & Gerçekleşen Analizi karanlık tema tokenlarına bağlandı. Overview dünya saatlerine Dijital / Analog / Analog + Dijital görünüm seçimi ve tüm IANA saat dilimlerinden saat ekleme desteği eklendi; boşta görünen Workspace ready mesajı kaldırıldı." },
  ] },

  { v: "7.139", date: "2026-09-26", title: { tr: "Backlog sayfasına Planlanan & Gerçekleşen Analizi eklendi", en: "Backlog sayfasına Planlanan & Gerçekleşen Analizi eklendi" }, items: [
    { tr: "Buyer Log 7.0.139: Backlog sayfasına Planlanan & Gerçekleşen Analizi eklendi. Kullanıcı seçtiği iki tarih-saat arasındaki snapshotları karşılaştırarak yalnız değişen/sapan kayıtları görür; Ex-Factory revizyonları, planlanan ve gerçekleşen yükleme, gerçekleşmeyen plan açığı, geç yükleme, statü, tahmini antrepo giriş tarihi, miktar ve diğer tarih değişiklikleri analiz edilir. Ara revizyon trafiği ayrıca korunur; çoklu revizyon ve başlangıç değerine geri dönen değişiklikler görünür. Buyer, Buyer Group, üretici, sezon, MAG ve MMYG filtreleri ile gündem odaklı analiz desteklenir. Modül açılır/kapanır ve taşınabilir; kullanıcı konumu saklanır. Snapshot geçmişi tek sıkıştırılmış baz+delta dosyasında tutulur. Güncel Backlog radar/pivot geliştirmeleri korunmuş ve yeni regression testleri eklenmiştir.", en: "Buyer Log 7.0.139: Backlog sayfasına Planlanan & Gerçekleşen Analizi eklendi. Kullanıcı seçtiği iki tarih-saat arasındaki snapshotları karşılaştırarak yalnız değişen/sapan kayıtları görür; Ex-Factory revizyonları, planlanan ve gerçekleşen yükleme, gerçekleşmeyen plan açığı, geç yükleme, statü, tahmini antrepo giriş tarihi, miktar ve diğer tarih değişiklikleri analiz edilir. Ara revizyon trafiği ayrıca korunur; çoklu revizyon ve başlangıç değerine geri dönen değişiklikler görünür. Buyer, Buyer Group, üretici, sezon, MAG ve MMYG filtreleri ile gündem odaklı analiz desteklenir. Modül açılır/kapanır ve taşınabilir; kullanıcı konumu saklanır. Snapshot geçmişi tek sıkıştırılmış baz+delta dosyasında tutulur. Güncel Backlog radar/pivot geliştirmeleri korunmuş ve yeni regression testleri eklenmiştir." },
  ] },

  { v: '7.138', date: '2026-09-26', title: { tr: 'Daha hızlı sayfa geçişleri', en: 'Faster page switching' }, items: [
    { tr: 'Hazır ekran önbelleği artık gerçekten kullanılıyor: CP ilk açılışı ~8 sn yerine ~1 sn, Siparişler ilk açılışı ~24 sn yerine ~3,5 sn (30 bin satırlık veride).', en: 'The prepared-screen cache is now actually used: CP opens in ~1 s instead of ~8 s and Orders in ~3.5 s instead of ~24 s (30k-row data).' },
    { tr: 'Açılmış bir sayfaya geri dönmek anlıktır (CP, Siparişler, Genel Bakış ~0,1 sn; LFL ~0,8 sn yerine ~0,25 sn); veri değişmediyse sayfa yeniden hesaplanmaz.', en: 'Returning to an already opened page is instant (CP, Orders, Overview ~0.1 s; LFL ~0.25 s instead of ~0.8 s); pages are not recomputed when data has not changed.' },
    { tr: 'Siparişler ekranı kullanmadığı sipariş özetini artık indirmez (~%35 daha az veri); LFL ziyareti CP/Siparişler/Genel Bakış önbelleğini geçersiz kılmaz.', en: 'The Orders screen no longer downloads the order summary it does not use (~35% less data); visiting LFL no longer invalidates the CP/Orders/Overview cache.' },
  ] },

  { v: '7.137', date: '2026-09-26', title: { tr: 'Çok kullanıcılı senkron, yetkiler ve çoklu sekme', en: 'Multi-user sync, permissions and multiple tabs' }, items: [
    { tr: 'Fiyat talepleri ve üretici teklifleri yalnız yetkili kullanıcılara görünür (talep sahibi, koleksiyona erişimi olan veya siparişi görebilen kullanıcı ve Moderatör). Önceki sürümdeki "tüm kullanıcılar görüntüleyebilir" kuralı kaldırıldı.', en: 'Quotations and supplier offers are visible only to authorised users (owner, users with collection access or order scope, and Moderators). The previous "all users can view" rule was removed.' },
    { tr: 'Buyer rolü varsayılan olarak Kaynak Veri görüntüleme, fiyat talebi açma/düzenleme ve sahibin verdiği düzenleme yetkisiyle başkasının Koleksiyonunu düzenleme yetkisine sahiptir; mevcut kurulumlara otomatik uygulanır.', en: 'The Buyer role now includes Source Data view, quotation create/edit and editing another user\'s Collection when the owner grants edit access; applied automatically to existing installations.' },
    { tr: 'Kur, yol süreleri, royalty/landed kuralları, non-DTR üreticiler, e-posta grupları, Endeksmatik ve veri bağlantıları yalnız Moderatörün verdiği yetkiyle değiştirilebilir ve değişiklik herkese yansır. Bu yetki üst role miras kalmaz.', en: 'FX, transit times, royalty/landed rules, non-DTR manufacturers, email groups, Endeksmatik and data connections can be changed only with Moderator-granted permission, and changes reach everyone. The permission is not inherited upwards.' },
    { tr: 'CP notları ve elle yapılan revizeler kullanıcılar arasında yalnız sipariş kapsamı kadar aktarılır.', en: 'CP notes and manual revisions are shared between users only within their order scope.' },
    { tr: 'Aynı Koleksiyon iki cihazda eşzamanlı düzenlendiğinde değişiklikler birleşir: farklı alanlar birlikte korunur; aynı alanda önce kaydedilen değer kalır, diğeri Senkron çakışmalarına düşer ve oradan geri yazılabilir. Başka cihazdaki düzenleme açık ekrana birkaç saniyede ulaşır.', en: 'Concurrent edits of the same Collection on two devices are merged: different fields are both kept; for the same field the first saved value wins and the other goes to Sync Conflicts, where it can be restored. Edits from another device reach the open screen within seconds.' },
    { tr: 'Aynı alanın (ör. CP notu) iki cihazda eşzamanlı değiştirilmesi artık her durumda çakışma olarak algılanır; sessizce son yazan kazanmaz.', en: 'Concurrent changes to the same field (e.g. a CP note) on two devices are now always detected as a conflict; the last writer no longer wins silently.' },
    { tr: 'Aynı bilgisayardaki sekmeler tek canlı bağlantıyı paylaşır: çok sekme açıkken güncellemelerin gelmemesi ve 6. sekmeden sonra sayfanın açılmaması giderildi. Yeni modül sekmesi gereksiz CP/Genel Bakış verisi yüklemeden açılır.', en: 'Tabs on the same computer share one live connection: missing live updates with many tabs and pages not opening after the 6th tab are fixed. A new module tab opens without loading unnecessary CP/Overview data.' },
    { tr: 'Eşzamanlı oluşturulan fiyat taleplerinin ve e-posta grubu kayıtlarının senkron sırasında kaybolması, ortak ayar kopyasının cihaz ayarlarını ezmesi ve Koleksiyon görsellerinin paylaşılmaması gibi senkron hataları giderildi.', en: 'Fixed sync issues such as concurrently created quotations and email-group records being lost, the shared settings copy overwriting device settings, and Collection images not being shared.' },
    { tr: 'Arayüz: okunabilirlik tabanı, boş durum yönlendirmeleri, Kurşun tema, kullanıcı paneli, Genel Bakış "Bugün" modülü ve Backlog grafik v2 (canlı Excel aralığı).', en: 'UI: readability floor, empty-state guidance, Graphite theme, user panel, Overview "Today" module and Backlog chart v2 (live Excel range).' },
  ] },

  { v: '7.82', date: '2026-09-20', title: { tr: 'Güvenli otomatik güncelleme', en: 'Safe self-update' }, items: [
    { tr: 'TEST/STABLE kanallı, SHA-256 doğrulamalı, staged ve rollback destekli otomatik güncelleme altyapısı eklendi.', en: 'Added TEST/STABLE self-update with SHA-256 verification, staging and automatic rollback.' },
    { tr: 'Uygulama sürümü tek canonical SemVer kaynağından üretilir; arayüzdeki sürüm artık elle tutulmaz.', en: 'Application version now comes from one canonical SemVer source; the UI version is no longer maintained manually.' },
  ] },

  { v: '7.80', date: '2026-09-10', title: { tr: 'Bakım ve güncelleme', en: 'Maintenance and updates' }, items: [] },

  { v: '7.79', date: '2026-09-10', title: { tr: 'Bakım ve güncelleme', en: 'Maintenance and updates' }, items: [] },

  { v: '7.78', date: '2026-09-10', title: { tr: 'Bakım ve güncelleme', en: 'Maintenance and updates' }, items: [] },

  { v: '7.77', date: '2026-09-10', title: { tr: 'Bakım ve güncelleme', en: 'Maintenance and updates' }, items: [] },

  { v: '7.76', date: '2026-09-10', title: { tr: 'Bakım ve güncelleme', en: 'Maintenance and updates' }, items: [] },

  { v: '7.75', date: '2026-09-10', title: { tr: 'Bakım ve güncelleme', en: 'Maintenance and updates' }, items: [] },

  { v: '7.74', date: '2026-09-03', title: { tr: 'Dashboard renk eşleştirme düzeltmesi', en: 'Dashboard colour mapping fix' }, items: [
    { tr: 'Dashboard IAS/Antrepo yenilemesinde Renk Kod yerine Siparis Bilgileri.Renk Tanım alanı kullanılır ve ASAS Renk ile güvenli şekilde eşleştirilir.', en: 'Dashboard IAS/Antrepo refresh uses Siparis Bilgileri.Renk Tanım instead of Renk Kod and matches it safely with ASAS Renk.' },
    { tr: 'Database ve Excel kaynaklarının mevcut Renk Kod eşleştirmesi korunur.', en: 'The existing Renk Kod matching for Database and Excel sources remains unchanged.' },
  ] },

  { v: '7.73', date: '2026-09-03', title: { tr: 'CP Copilot veri kaynağı düzeltmesi', en: 'CP Copilot data-source fix' }, items: [
    { tr: 'CP’de model sayısı soruları artık yalnızca CP Tracker kayıtlarından hesaplanır; Orders verisiyle karışmaz.', en: 'CP model-count questions are now calculated only from CP Tracker records and cannot mix with Orders data.' },
    { tr: 'CP model sayımı canonical model alanı üzerinden deterministik olarak yapılır.', en: 'CP model counts are deterministic and use the canonical model field.' },
  ] },

  { v: '7.72', date: '2026-09-03', title: { tr: 'Dashboard alan çözümleme düzeltmesi', en: 'Dashboard field discovery fix' }, items: [
    { tr: 'Power BI sorgu gövdesindeki IAS/Antrepo alanları artık şema doğrulamasına dahil edilir; mevcut alanlar yanlışlıkla eksik gösterilmez.', en: 'IAS/Antrepo fields in the Power BI semantic query are now included in schema validation so existing fields are not reported as missing.' },
    { tr: 'Yenilemede gerekli alanları en kapsamlı taşıyan Dashboard sorgu şablonu kullanılır.', en: 'Refresh now uses the Dashboard query template carrying the most required fields.' },
  ] },

  { v: '7.71', date: '2026-09-03', title: { tr: 'Dashboard tarayıcı bağlantısı', en: 'Dashboard browser integration' }, items: [
    { tr: 'Antrepo Dashboard yenilemesi artık uzun ASAS sorgusundan önce mevcut Edge oturumunu doğrular; PLM düğmesine bağımlı değildir.', en: 'Antrepo Dashboard refresh now validates the existing Edge session before the long ASAS query and no longer depends on the PLM action.' },
    { tr: 'Ayrı otomasyon Edge profili kaldırıldı; bağlantı kopmalarında tek oturumlu yeniden bağlanma ve kullanıcı onayı bekleme akışı eklendi.', en: 'The separate automation Edge profile was removed, with single-session reconnect and user-approval waiting flows added.' },
  ] },

  { v: '7.70', date: '2026-09-02', title: { tr: 'Sürüm senkronizasyonu ve LFL alan eşlemesi', en: 'Version synchronization and LFL field mapping' }, items: [
    { tr: 'Güncellemelerde uygulama sürümü otomatik olarak +0,01 ilerler; tarayıcı önbellek etiketleri ve sürüm geçmişi aynı sürümde tutulur.', en: 'Application version now advances by +0.01 on updates; browser cache tags and version history stay synchronized.' },
    { tr: 'LFL Product Description alanı ASAS’taki gerçek Ürün Ana Tanım kaynağıyla eşleştirildi.', en: 'LFL Product Description is now mapped to the real Ürün Ana Tanım source from ASAS.' },
  ] },
  { v: '7.69', date: '2026-08-30', title: { tr: 'Final performans ve veri güvenliği denetimi', en: 'Final performance and data-safety audit' }, items: [
    { tr: 'Önceki performans aşamaları; kullanıcı izolasyonu, paylaşılan veri, local DB/delta sync, snapshot fallback, refresh iptali, sanal tablolar ve görsel cache bütünlüğü açısından birlikte doğrulandı.', en: 'The prior performance phases were verified together for user isolation, shared data, local DB/delta sync, snapshot fallback, refresh cancellation, virtualized tables, and image-cache integrity.' },
    { tr: 'Tarih revizyon bilgisinin dışa aktarımı ve LFL analiz cache çalışma zamanı erişimi düzeltildi; Excel görsel doğrulamaları Windows üzerinde platformdan bağımsız hale getirildi.', en: 'Date-revision info export and LFL analysis-cache runtime access were fixed; Excel image validation is now platform-independent on Windows.' },
    { tr: '50.000 satırlık ortak CP/Orders projection benchmarkında yinelenen üretime göre medyan süre %42,3 azaldı.', en: 'In the 50,000-row shared CP/Orders projection benchmark, median time decreased by 42.3% versus duplicate projection builds.' },
  ] },
  { v: '7.68', date: '2026-08-30', title: { tr: 'Görsel yükleme ve hover performansı', en: 'Image loading and hover performance' }, items: [
    { tr: 'CP, Orders ve Collection tablolarında görseller viewport görünürlüğüne göre lazy yüklenir; detay görselleri ortak gecikmeli hover önizlemesini kullanır.', en: 'CP, Orders, and Collection table images now load lazily by viewport visibility; detail images use the shared delayed hover preview.' },
    { tr: 'Görsel istekleri ortak kuyruk, negatif cache ve güncelleme sonrası cache geçersizleştirme ile yönetilir.', en: 'Image requests use a shared queue, negative cache, and cache invalidation after image updates.' },
  ] },
  { v: '7.67', date: '2026-08-30', title: { tr: 'Local-first açılış ve snapshot iyileştirmesi', en: 'Local-first startup and snapshot optimization' }, items: [
    { tr: 'İlk açılış yalnız hafif Overview projection ile devam eder; CP, Orders ve Collection verileri ilgili ekran açıldığında hazır modül cache’inden yüklenir.', en: 'Initial startup continues with the lightweight Overview projection; CP, Orders, and Collection load from their prepared module caches when opened.' },
    { tr: 'Model snapshot yazımı asenkron ve doğrulamalı hale getirildi; ortak CP/Orders/Backlog kaynak nesneleri tek kopya ve güvenli alias bilgisiyle saklanır.', en: 'Model snapshot writes are now asynchronous and validated; shared CP/Orders/Backlog source objects are stored once with safe alias metadata.' },
    { tr: 'Yeni snapshot formatına SHA-256 bütünlük kontrolü, eski format uyumluluğu ve bozuk ana dosyada yedek kopyaya güvenli dönüş eklendi.', en: 'The new snapshot format adds SHA-256 integrity validation, legacy compatibility, and safe fallback to the backup copy when the primary is corrupt.' },
  ] },
  { v: '7.66', date: '2026-08-30', title: { tr: 'Masaüstü paket kapsamı sadeleştirildi', en: 'Desktop package scope simplified' }, items: [
    { tr: 'Kullanılmayan istemci ve yardımcı bileşenler paket kapsamından çıkarıldı.', en: 'Unused client and helper components were removed from the package scope.' },
    { tr: 'Sunucunun yalnız yerel masaüstü kullanımındaki varsayılan akışı korundu.', en: 'The server default workflow for local desktop use was preserved.' },
  ] },
  { v: '7.65', date: '2026-08-30', title: { tr: 'Dinamik sütun veri tipi standardizasyonu', en: 'Dynamic column data type standardization' }, items: [
    { tr: 'Yeni ve dinamik sütunlar merkezi Column Schema/Type Registry üzerinden çözümlenir; tarih, sayı, quantity, decimal, currency, yüzde, boolean ve kod/ID davranışları ortaklaştırıldı.', en: 'New and dynamic columns resolve through a central Column Schema/Type Registry; date, numeric, quantity, decimal, currency, percentage, boolean, and code/ID behavior is shared.' },
    { tr: 'Ham kaynak değerleri değiştirilmeden tablo gösterimi, sıralama, filtreleme, kopyalama ve Collection Excel dışa aktarımı typed değerlerle çalışır.', en: 'Table display, sorting, filtering, copying, and Collection Excel export use typed values without changing raw source values.' },
    { tr: 'Geçersiz tarihler güvenli biçimde reddedilir; baştaki sıfırlar, sıfır ve false değerleri korunur.', en: 'Invalid dates are safely rejected; leading zeroes, zero, and false values are preserved.' },
  ] },
  { v: '7.64', date: '2026-08-30', title: { tr: 'Bağımsız Fiyat & Üretici Analizi merkezi', en: 'Standalone Price & Supplier Analysis hub' }, items: [
    { tr: 'Collection içindeki eski sabit analiz kaldırıldı; CP, Orders, Collection ve LFL kaynaklarını ayrı ayrı hazırlayan bağımsız ana navigasyon modülü eklendi.', en: 'The old fixed Collection analysis was removed and replaced by a standalone main-navigation module that prepares CP, Orders, Collection, and LFL sources independently.' },
    { tr: 'Çoklu kırılım, metrik seçimi, analiz ve tablo filtreleri, çoklu sıralama, sanal tablo, ayarlanabilir matris, drill-down ve kullanıcı bazlı kayıtlı analizler eklendi.', en: 'Multi-level dimensions, metric selection, analysis and table filters, multi-sort, a virtualized table, configurable matrix, drill-down, and user-scoped saved analyses were added.' },
    { tr: 'Kaynaklar arası karşılaştırma ve gerçek analiz veri kümesinden Excel aktarımı eklendi; farklı para birimleri için fiyat farkı hesaplaması güvenli biçimde engellenir.', en: 'Cross-source comparison and Excel export from the actual analysis dataset were added; price deltas are safely blocked when currencies differ.' },
  ] },
  { v: '7.63', date: '2026-08-30', title: { tr: 'Defender uyumlu başlangıç ve süreç kontrolü', en: 'Defender-safe startup and process control' }, items: [
    { tr: 'Normal başlangıçtan otomatik runtime indirme/kurulum, npm kurulumu ve PowerShell sağlık zinciri ayrıştırıldı; sunucu doğrudan Node watchdog ile başlatılır.', en: 'Automatic runtime download/installation, npm installation, and PowerShell health polling were separated from normal startup; the server starts directly through the Node watchdog.' },
    { tr: 'Durdurma yalnızca doğrulanmış Buyer Log watchdog/server PID ve parent PID bilgileriyle yapılır; global zorlayıcı süreç taraması kaldırıldı.', en: 'Stopping now uses only verified Buyer Log watchdog/server PID and parent PID metadata; global force-kill scanning was removed.' },
    { tr: 'Release arşivleri runtime, kullanıcı verisi, cache/log/temp, binary ve generated klasörleri dışarıda bırakacak şekilde temizlendi.', en: 'Release archives now exclude runtime, user data, cache/log/temp, binary, and generated directories.' },
  ] },
  { v: '7.62', date: '2026-08-30', title: { tr: 'Manufacturer Email Groups manuel başlık yönetimi', en: 'Manual heading management for Manufacturer Email Groups' }, items: [
    { tr: 'Ülke ve grup başlıkları artık tarayıcı promptu yerine uygulama içi küçük yöneticiyle manuel eklenebilir, kaldırılabilir ve kaydedilebilir.', en: 'Country and group headings can now be manually added, removed, and saved in a compact in-app manager instead of a browser prompt.' },
    { tr: 'Mevcut kayıtları kullanan başlıkları silme koruması ve sunucu revizyon kontrolü korunmuştur.', en: 'The protection against removing headings used by existing records and server revision checks remain in place.' },
    { tr: 'Kaynak Veri alanındaki yinelenen durum/hint metni, üst Backup kısa yolu ve ASAS Excel yükleme kısa yolu kaldırıldı; gerekli ayarlar menüsü erişimleri korunmuştur.', en: 'Duplicate status/hint text, the top Backup shortcut, and the ASAS Excel upload shortcut were removed from Source Data; required Settings access remains.' },
  ] },
  { v: '7.61', date: '2026-08-30', title: { tr: 'Local-First Delta Sync güvenliği güçlendirildi', en: 'Local-First Delta Sync safety strengthened' }, items: [
    { tr: 'Yerel journal kayıtlarına cihaz, sıra, işlem, kullanıcı, temel revizyon ve checksum metadatası eklendi; tekrar uygulanan event’ler ve çatışmalar kalıcı olarak izleniyor.', en: 'Local journal entries now carry device, sequence, operation, user, base revision and checksum metadata; duplicate events and conflicts are persisted.' },
    { tr: 'Yeni sync paketleri cihaz klasörlerine atomik geçici dosya doğrulamasıyla yazılır; ACK ve checkpoint desteği ile bozuk paketler atlanıp hata olarak raporlanır. Eski delta klasörü geriye uyumludur.', en: 'New sync packages are atomically validated in device folders; ACK and checkpoint support tracks delivery while corrupt packages are skipped and reported. The legacy delta folder remains compatible.' },
  ] },
  { v: '7.60', date: '2026-08-30', title: { tr: 'Horizon görünümü geri alındı', en: 'Horizon appearance restored' }, items: [
    { tr: 'Horizon kutuları 7.57 görünümüne döndürüldü; ilk açılış görünürlüğü ve köşesiz tasarım korunurken aç/kapa kontrolü yatay şerit üzerinde kaldı.', en: 'Horizon boxes returned to the 7.57 appearance; initial visibility and square corners remain, while the toggle stays on the horizontal strip.' },
  ] },
  { v: '7.59', date: '2026-08-30', title: { tr: 'Horizon alanı dikey açılır/kapanır hale getirildi', en: 'Horizon area now expands vertically' }, items: [
    { tr: 'Horizon ayrıntıları yatay genişleme yerine kompakt başlık satırının altında dikey olarak açılır; kapalı satır yüksekliği daraltıldı.', en: 'Horizon details expand vertically below a compact header instead of widening horizontally; collapsed row height was reduced.' },
  ] },
  { v: '7.58', date: '2026-08-30', title: { tr: 'Sync ve Koleksiyon ayarları iyileştirildi', en: 'Sync and Collection settings improved' }, items: [
    { tr: 'Sync durumunda DB klasörü güvenli biçimde düzenlenebilir ve taşınan yerel veritabanı doğrulanarak aktif konuma alınır.', en: 'The DB folder is editable from Sync status; the local database is verified before its active location changes.' },
    { tr: 'Koleksiyon hızlı filtre ayarları tüm tablo sütunlarını listeler ve CP ile uyumlu çark simgesi kullanır; Horizon rozeti yenileme öncesinde de görünür.', en: 'Collection quick-filter settings list all table columns and use the CP-compatible gear icon; the Horizon badge is also visible before refresh.' },
  ] },
  { v: '7.57', date: '2026-08-30', title: { tr: 'Sürümlü kullanıcı ve tam sistem yedekleri eklendi', en: 'Versioned user and full-system backups added' }, items: [
    { tr: 'Her kullanıcı yalnız kendi verilerini ve tercihlerini tek ZIP dosyasında indirebilir; moderatör ayrıca hassas kimlik bilgileri hariç tam sistem yedeği oluşturabilir.', en: 'Each user can download only their own data and preferences in one ZIP file; moderators can also create a full-system backup excluding sensitive credentials.' },
    { tr: 'Yedekler tutarlı dosya snapshot’ları, manifest, SHA-256 checksum, geçici dosya doğrulaması ve atomik adlandırma ile arka planda hazırlanır.', en: 'Backups are prepared in the background using consistent file snapshots, a manifest, SHA-256 checksums, temporary-file validation, and atomic naming.' },
  ] },
  { v: '7.56', date: '2026-08-30', title: { tr: 'Collection ve model görseli kullanımı iyileştirildi', en: 'Collection and model image usability improvements' }, items: [
    { tr: 'Görsel güncelleme ve boyut limit pencereleri sadeleştirildi; görsel limiti sürgüyle ayarlanabilir ve tüm görseller onayla silinebilir.', en: 'Image update and size-limit dialogs were simplified; the limit is adjustable with a slider and all images can be deleted after confirmation.' },
    { tr: 'Collection kapsamı, çalışma alanı ve hızlı filtre kontrolleri aynı kompakt tasarım diline getirildi; hızlı filtre grupları eklenip çıkarılabilir.', en: 'Collection scope, workspace and quick-filter controls now share a compact design language; quick-filter groups can be added or removed.' },
  ] },
  {
    v: '7.55', date: '2026-08-30',
    title: { tr: 'Kaynak klasörden PLM güncellemesi kaldırıldı', en: 'PLM Source Folder update removed' },
    items: [
      { tr: 'CP, Orders ve Koleksiyon araçlarından Kaynak Klasörden PLM Güncelle seçeneği ve buna ait uç noktalar kaldırıldı; mevcut kaynak klasör seçimi korundu.', en: 'The Update PLM from Source Folder option and its endpoints were removed from CP, Orders and Collection tools; the existing source-folder selection was preserved.' },
    ],
  },
  {
    v: '7.54', date: '2026-08-30',
    title: { tr: 'Durdurma seçeneği menüde sabitlendi', en: 'Stop action kept in the menu' },
    items: [
      { tr: 'Yenilemeyi Durdur seçeneği üst yenileme menüsünde her zaman görünür; yalnız aktif yenileme sırasında kullanılabilir.', en: 'Stop Refresh is always visible in the top refresh menu and is enabled only while a refresh is active.' },
    ],
  },
  {
    v: '7.53', date: '2026-08-30',
    title: { tr: 'Yenileme menüsü sadeleştirildi', en: 'Refresh menu streamlined' },
    items: [
      { tr: 'Üst yenileme menüsü kompakt hale getirildi; yenileme sürerken aynı menüden Yenilemeyi Durdur seçeneği kullanılabilir.', en: 'The top refresh menu is now compact; while refreshing, Stop Refresh is available from the same menu.' },
    ],
  },
  {
    v: '7.52', date: '2026-08-30',
    title: { tr: 'Yenileme penceresi sadeleştirildi', en: 'Refresh window streamlined' },
    items: [
      { tr: 'Yenileme aşamaları penceresi programın genel modal stiline yaklaştırıldı, küçültüldü ve durdurma düğmesi alt aksiyon alanında tutuldu.', en: 'The refresh stages window now matches the general modal style, is smaller, and keeps Stop Refresh in its action area.' },
    ],
  },
  {
    v: '7.51', date: '2026-08-30',
    title: { tr: 'Excel seçenekleri genişletildi', en: 'Excel options expanded' },
    items: [
      { tr: 'Excel seçenekleri penceresi büyütüldü; ASAS ve IAS/Antrepo sütunları artık seçerek ekleniyor ve seçilen sütunlara formül atanabiliyor.', en: 'The Excel options dialog is larger; ASAS and IAS/Warehouse columns can now be added selectively, and formulas can be assigned to selected columns.' },
    ],
  },
  {
    v: '7.50', date: '2026-08-30',
    title: { tr: 'Excel seçenekleri görünür hale getirildi', en: 'Excel options made visible' },
    items: [
      { tr: 'Backlog Excel seçenekleri penceresinde mevcut sütunlar ve yerleşik formüller artık görünür; formül alanları bölüm elemanları tarafından gizlenmiyor.', en: 'The Backlog Excel options dialog now shows the existing columns and built-in formulas; formula fields are no longer hidden by section styling.' },
    ],
  },
  {
    v: '7.49', date: '2026-08-30',
    title: { tr: 'Backlog Excel seçenekleri sadeleştirildi', en: 'Backlog Excel options streamlined' },
    items: [
      { tr: 'Backlog Excel canlı önizlemesi kaldırıldı; sütun ve formül düzenleme seçenekleri Excel seçenekleri penceresinde toplandı.', en: 'The Backlog Excel live preview was removed; column and formula editing options are now grouped in the Excel options dialog.' },
    ],
  },
  {
    v: '7.48', date: '2026-08-29',
    title: { tr: 'Yenileme durdurma sunucuya bağlandı', en: 'Refresh stop now reaches the server' },
    items: [
      { tr: 'Yenilemeyi Durdur artık istemci beklemesini ve sunucudaki yenileme işini güvenli aşama sınırlarında durdurur.', en: 'Stop Refresh now stops both client waiting and the server refresh job at safe phase boundaries.' },
    ],
  },
  {
    v: '7.47', date: '2026-08-29',
    title: { tr: 'Yenileme ve model araçları hızlı düzeltmeleri', en: 'Refresh and model tools quick fixes' },
    items: [
      { tr: 'Yenile düğmesi artık devam eden işlemi durdurmaz; durdurma yalnız Yenilemeyi Durdur düğmesinden yapılır. Koleksiyon kopyası seçilen satır sayısını korur; model link ve görsel işlemlerinde 5000 kayıt kesmesi kaldırıldı ve ilerleme durumu gösterilir.', en: 'The Refresh button no longer stops an active job; stopping is available only through Stop Refresh. Collection copy preserves the selected row count; the 5000-item cutoff was removed for model links and images and progress is shown.' },
    ],
  },
  {
    v: '7.46', date: '2026-08-29',
    title: { tr: 'Sync penceresinde DB klasör yolu gösteriliyor', en: 'Sync window shows the DB folder path' },
    items: [
      { tr: 'Sync durumu penceresine yerel veritabanının bulunduğu klasör yolu eklendi.', en: 'The Sync Status window now shows the folder containing the local database.' },
    ],
  },
  {
    v: '7.45', date: '2026-08-28',
    title: { tr: 'Açılışta otomatik sürüm ZIP’i oluşturulmuyor', en: 'No automatic release ZIP on startup' },
    items: [
      { tr: 'Kullanıcı talebi: “program versiyon değişiklikleri sırasında her ilk açılışta versiyon kopyasını zip olarak oluşturuyor. Buna gerek yok, yapmasın.” Gözetmen (server\\watchdog.js) her sunucu başlatmasında sürüm arşivleyicisini çağırıyordu; yeni sürümün ZIP’i yoksa oluşturuyor, sonra da üçten eski arşivleri siliyordu. Bu çağrı tamamen kaldırıldı.', en: 'Requested by the user: “on the first launch after a version change the program creates a zip copy of the version. That is not needed; stop doing it.” The watchdog (server\\watchdog.js) called the release archiver on every server start; if the new version had no ZIP it built one and then deleted archives older than the last three. That call has been removed entirely.' },
      { tr: 'Kaldırılan iki iş de açılışta paket klasörüne dokunuyordu: MEGABAYTLARCA YAZMA (paket çoğunlukla ağ klasöründe durduğu için ağ üzerinden) ve KENDİLİĞİNDEN DOSYA SİLME. Artık açılış paket klasörüne hiçbir şey yazmıyor ve hiçbir dosyayı kendiliğinden silmiyor.', en: 'Both removed steps touched the package folder at startup: WRITING MEGABYTES (over the network, since the package usually lives in a network folder) and DELETING FILES ON ITS OWN. Startup now writes nothing into the package folder and deletes nothing by itself.' },
      { tr: 'Arşivleyici betiği silinmedi: isteyen “npm run archive” ile o anki sürümün kopyasını elle çıkarabilir. Klasörde önceki sürümlerden kalan Buyer-Log-V7-xx.zip dosyaları varsa bunlar OLDUĞU GİBİ BIRAKILDI — kendiliğinden dosya silmek, kaldırdığımız davranışın ta kendisiydi. İstemiyorsanız elle silebilirsiniz; uygulamanın çalışmasıyla ilgileri yok.', en: 'The archiver script was not deleted: anyone who wants a copy of the current version can run “npm run archive” by hand. Any Buyer-Log-V7-xx.zip files left over from previous versions were LEFT UNTOUCHED — deleting files on its own is exactly the behaviour being removed. You can delete them by hand if you wish; the application does not use them.' },
      { tr: 'v5.42’de bu davranışı koruyan test silinmedi, amacı tersine çevrildi (§156): artık “gözetmen arşivi oluşturur” değil, “açılış paket klasörüne kendiliğinden yazmaz ve silmez” güvencesini koruyor.', en: 'The v5.42 test that protected this behaviour was not deleted but inverted (§156): instead of “the watchdog creates the archive” it now protects “startup neither writes to nor deletes from the package folder on its own”.' },
    ],
  },
  {
    v: '7.43', date: '2026-08-28',
    title: { tr: 'Ağ klasöründen başlatma düzeltildi (UNC yolu)', en: 'Starting from a network folder is fixed (UNC path)' },
    items: [
      { tr: 'Kullanıcının ekranındaki çıktı: “UNC paths are not supported. Defaulting to Windows directory… Ilk calistirma veya eksik kurulum - gerekli bilesenler kuruluyor…”. Sebebi bulundu: BAT başlatıcıları “cd /d %~dp0” ile başlıyordu, Windows komut istemi ise bir AĞ YOLUNU (\\\\lcw_fileserver\\…) çalışma klasörü olarak kabul etmez ve C:\\Windows’ta kalır.', en: 'What the user saw: “UNC paths are not supported. Defaulting to Windows directory… first run or missing install — installing components…”. The cause was found: the .bat launchers began with “cd /d %~dp0”, and the Windows command prompt refuses a NETWORK PATH (\\\\lcw_fileserver\\…) as a working directory, so it stays in C:\\Windows.' },
      { tr: 'SONUCU SESSİZ VE AĞIRDI. O noktadan sonra her göreli yol yanlış klasöre bakıyordu: config.json bulunamıyor, node_modules bulunamıyor (bu yüzden “ilk kurulum” adımı tetikleniyor) ve “npm install” C:\\WINDOWS İÇİNDE çalıştırılıyordu. Yani paket ağ klasöründeyken .bat başlatıcıları hiçbir zaman doğru çalışmamıştı; masaüstü kısayolu (VBS) çalıştığı için sorun bugüne kadar görünmedi — VBS çalışma klasörünü Windows API’siyle kurar ve ağ yolunu kabul eder.', en: 'THE EFFECT WAS SILENT AND SERIOUS. From that point every relative path pointed at the wrong folder: config.json not found, node_modules not found (which is what triggered the “first install” step), and “npm install” ran INSIDE C:\\WINDOWS. So the .bat launchers had never worked correctly from a network folder; the fault stayed hidden because the desktop shortcut (VBS) works — it sets the working directory through the Windows API, which does accept a network path.' },
      { tr: 'ÇÖZÜM: beş başlatıcı da artık ortak bir yardımcı çağırıyor (scripts\\goto-app-dir.cmd). Yardımcı önce yerel yolu deniyor, olmazsa “pushd” ile ağ yolunu geçici bir sürücü harfine bağlıyor. Doğru klasöre geçildiği VARSAYILMIYOR, package.json’ın orada olmasıyla kanıtlanıyor; kanıtlanamazsa iş yanlış yerde yapılmıyor: pencere durup “Ağ sürücüsü bağlan” yönergesini yazıyor.', en: 'THE FIX: all five launchers now call a shared helper (scripts\\goto-app-dir.cmd). It tries the local path first and otherwise uses “pushd” to bind the network path to a temporary drive letter. Reaching the right folder is not ASSUMED but proven by package.json being there; if it cannot be proven, no work is done in the wrong place — the window stops and explains how to map the network drive.' },
      { tr: 'Sunucu penceresi artık klasörünü ve Node’unu KENDİSİ kuruyor (scripts\\start-watchdog.cmd). Geçici sürücü harfi, onu ayıran pencere kapanınca kaybolur; sunucu o harfte çalışsaydı çalışma klasörü bir anda geçersizleşirdi. Aynı sebeple taşınabilir Node kurulumuna ve “node-portable buraya” yönergesine paketin GERÇEK yolu yazılıyor.', en: 'The server window now establishes its own folder and finds Node itself (scripts\\start-watchdog.cmd). A temporary drive letter disappears when the window that created it closes; had the server run on that letter, its working directory would have gone invalid mid-run. For the same reason the portable-Node install and the “put node-portable here” instructions print the package’s REAL path.' },
      { tr: 'Ağ klasöründen çalışırken Windows’un o korkutucu “UNC paths are not supported” uyarısı ekranda kalmaya devam eder (onu Windows, biz daha çalışmadan yazar); başlatıcı artık hemen altına bunun normal olduğunu ve klasörün hangi geçici sürücüye bağlandığını yazıyor. DÜRÜST SINIR: cmd.exe bu ortamda çalıştırılamadığı için düzeltme Windows üzerinde ölçülmedi; betiklerin yapısı (akış, etiketler, hataya düşme) testlerle denetlendi.', en: 'When running from a network folder Windows still prints its alarming “UNC paths are not supported” warning (it does so before our script runs at all); the launcher now writes, right below it, that this is normal and which temporary drive the folder was bound to. AN HONEST LIMIT: cmd.exe cannot be executed in this environment, so the fix was not measured on Windows; the scripts’ structure — flow, labels, fall-through — is checked by tests.' },
    ],
  },
  {
    v: '7.42', date: '2026-08-28',
    title: { tr: 'Sütun eklerken üst başlığı da siz seçiyorsunuz', en: 'You now choose the heading a new column sits under' },
    items: [
      { tr: 'Kullanıcı talebi: “sütun ve hesaplamalı sütun eklerken temel sütun başlığını da ayarlayabileyim. Şu an Calculated Column adı altında görünüyor, dilersem Order Info’ya dahil edebileyim, dilersem yeni alan adı yaratabileyim.” Hem “Hesaplanan sütun ekle” hem de “CP Veri Tabanından Sütun Ekle” penceresine ÜST BAŞLIK (GRUP) alanı eklendi: tabloda var olan başlıklar listeden seçilir ya da “＋ Yeni başlık oluştur…” ile serbestçe yeni bir başlık adı yazılır.', en: 'Requested by the user: “when I add a column or a calculated column I want to set the top-level heading too. Right now it shows under Calculated Column; I would like to include it in Order Info, or create a new heading.” Both the “Add calculated column” and the “Add CP Database Column” dialogs now have a HEADING (GROUP) field: pick one of the table’s existing headings from the list, or choose “＋ Create a new heading…” and type any name you like.' },
      { tr: 'SADECE AD VERMEK YETMEZDİ — SÜTUN TAŞINIYOR. Tablonun üst başlık bandı, sütunların grup adından değil YAN YANA duran aynı gruplu sütunlardan kurulur. Bir sütuna yalnızca “Order Info” demek, ekranda İKİNCİ bir “Order Info” bandı açardı ve kullanıcı haklı olarak “dahil edemedim” derdi. Bu yüzden sütun, seçilen başlığın en sonuna taşınıyor. Gerçek veriyle (10.864 satırlık CP) ölçüldü: Order Info bandı 35 sütundan 36’ya çıktı ve TEK bant kaldı; yeni sütunun solu “%” (Order Info), sağı “Kumaş Kategorisi” (Kumaş).', en: 'NAMING IT WAS NOT ENOUGH — THE COLUMN MOVES. The heading band is built from ADJACENT columns sharing a group, not from the group name alone. Merely labelling a column “Order Info” would have opened a SECOND “Order Info” band on screen, and it would rightly look as though the column had not joined it. So the column is moved to the end of the heading you pick. Measured against real data (a 10,864-row CP): the Order Info band went from 35 columns to 36 and stayed a SINGLE band, with the new column between “%” (Order Info) and “Kumaş Kategorisi” (Kumaş).' },
      { tr: 'Yeni bir başlık adı yazıldığında kendi bandını açıyor (ölçüldü: “Üretim Takibi” bandı tabloda belirdi). Var olan bir sütunun başlığını sonradan değiştirmek de aynı şekilde çalışıyor: “Hesaplanan”dan “Kumaş”a alınan sütun Kumaş bandının içine girdi, bant 7’den 8’e çıktı ve bölünmedi.', en: 'A new heading name opens its own band (measured: a “Üretim Takibi” band appeared in the table). Changing an existing column’s heading later works the same way: a column moved from “Hesaplanan” to “Kumaş” landed inside the Kumaş band, which grew from 7 to 8 columns without splitting.' },
      { tr: 'ELLE SÜRÜKLEDİĞİNİZ SIRA KORUNUYOR. Sütun yalnızca yeni eklendiğinde ya da başlığı değiştiğinde taşınıyor; her tazelemede taşımak, sütunu elle sürüklediğiniz yerden geri alırdı. Ölçüldü: elle 3. sıraya alınan hesaplanan sütun, eşitlemeden sonra da 3. sırada kaldı. Başlık seçilmezse eski davranış aynen sürüyor — hesaplanan sütun “Hesaplanan”, veri tabanı sütunu “Database” altında kalır.', en: 'YOUR MANUAL ORDER IS KEPT. A column is moved only when it is newly added or when its heading changes; moving it on every sync would have undone wherever you dragged it. Measured: a calculated column dragged to position 3 was still at position 3 after a sync. If you pick no heading, the previous behaviour is unchanged — calculated columns stay under “Hesaplanan” and database columns under “Database”.' },
      { tr: 'Tarayıcıda görülen iki kusur da düzeltildi: “yeni başlık adı” kutusu kapalıyken bile ekranda kalıyordu (display:flex kuralı [hidden] özniteliğini yeniyordu) ve veri tabanı penceresine yeni alan eklenince arama kutusu yarım genişliğe düşüyordu (tam genişlik kuralı sıraya bağlıydı, artık alanın kendi adına bağlı). Başlık adları serbest metin olduğu için tablo başlığına kaçışlı yazılıyor.', en: 'Two faults seen in the browser were fixed: the “new heading name” box stayed visible even when closed (a display:flex rule was overriding the [hidden] attribute), and adding the new field pushed the database dialog’s search box down to half width (the full-width rule keyed off position; it now keys off the field itself). Because heading names are free text, they are escaped when written into the table header.' },
      { tr: 'CP satır sayısı ölçüm boyunca 10.864’te sabit kaldı; hiçbir sütun sıradan düşmedi (§142). Sunucu, verilmeyen bir başlık için varsayılan uydurmuyor: alanı boş bırakıyor, varsayılanı arayüz koyuyor (§152).', en: 'The CP row count stayed at 10,864 throughout, and no column dropped out of the order (§142). The server invents no default for a heading that was not supplied: it stores an empty value and the interface applies the default (§152).' },
    ],
  },
  {
    v: '7.41', date: '2026-08-27',
    title: { tr: 'Yenileme artık yalnız yenilenen ekranları kilitliyor', en: 'A refresh now locks only the screens it actually redraws' },
    items: [
      { tr: 'Kullanıcı bulgusu: “CP yenilerken koleksiyon editlemesi kilitleniyor, gerek yok gibi.” Doğruydu. Kilit v6.34’te haklı bir sebeple konmuştu — yenileme TABLOYU YENİDEN ÇİZER, o an açık olan bir hücre düzenlemesi çizimle birlikte kaybolur — ama kilit TÜM UYGULAMAYA konuyordu. Oysa bir CP yenilemesi Koleksiyon tablosunu hiç çizmez.', en: 'Reported by the user: “when CP refreshes, editing in Collection locks up, which seems unnecessary.” It was right. The lock was added in v6.34 for a good reason — a refresh REDRAWS THE TABLE and an open cell edit is lost with it — but the lock covered the WHOLE application. A CP refresh never redraws the Collection table.' },
      { tr: 'HANGİ EKRANLARIN KİLİTLENECEĞİ ARTIK KODUN KENDİSİNDEN TÜRETİLİYOR, tahminle değil. Yenileme bittiğinde koşulsuz olarak CP, Siparişler ve Genel Bakış çiziliyor; bu üçü hangi hedef seçilirse seçilsin kapalı kalır. (“CP hedefi yalnız CP’yi çizer” diye varsaymak, Siparişler yenilemesi sırasında CP’ye yazılan bir hücreyi kaybettirirdi — v6.34’ün düzelttiği kusurun aynısı.) LFL yalnız LFL hedefinde, Backlog yalnız Backlog hedefinde kilitleniyor.', en: 'WHICH SCREENS LOCK IS NOW DERIVED FROM THE CODE ITSELF rather than assumed. When a refresh finishes it unconditionally redraws CP, Orders and Overview, so those three stay closed whichever target you pick. (Assuming “the cp target only redraws CP” would have lost a cell written to CP during an Orders refresh — the very fault v6.34 fixed.) LFL locks only on the LFL target, Backlog only on the Backlog target.' },
      { tr: 'KOLEKSİYON, NAKLİYE, ÖN MALİYET VE OTOMASYONLAR HİÇBİR YENİLEMEDE KİLİTLENMİYOR — bu ekranlar yenileme yollarının hiçbirinde çizilmiyor. Üstteki uyarı şeridi de artık hangi alanların duraklatıldığını adıyla yazıyor ve diğerlerinin açık olduğunu söylüyor.', en: 'COLLECTION, SHIPPING, OPEN COSTING AND AUTOMATIONS NO LONGER LOCK during any refresh — none of the refresh paths redraw them. The banner at the top now names the paused areas and states that the others remain editable.' },
      { tr: 'Gerçek bir CP yenilemesi sırasında ölçüldü: donan ekranlar “Genel Bakış, CP, Siparişler”; Koleksiyon yazmaya AÇIK, CP yazmaya kapalı; yenileme boyunca 20 ölçümün hepsinde aynı. Yenileme bitince donmuş ekran sayısı 0’a döndü, kilit sınıfı kalkmış durumda — ekran kilitli kalmıyor. Tam yenilemede LFL ve Backlog de dondu, Koleksiyon/Nakliye/Ön Maliyet/Otomasyonlar açık kaldı.', en: 'Measured during a real CP refresh: the frozen screens were “Overview, CP, Orders”; Collection was OPEN for writing and CP closed; identical across all 20 samples taken while it ran. When it finished the number of frozen screens returned to 0 and the lock class was gone — no screen stays stuck. On a full refresh LFL and Backlog froze too, while Collection, Shipping, Open Costing and Automations stayed open.' },
      { tr: 'İKİ İNCE NOKTA. Yenileme başlarken açık düzenleyiciyi kapatan adım artık yalnız DONACAK ekrandaki düzenleyiciyi kapatıyor; Koleksiyon’da fiyat yazarken CP yenilemesi başladığında imleciniz alandan atılmıyor. Ayrıca yenilemenin sonundaki Koleksiyon filtre tazelemesi, o an açık bir düzenleme varsa çizimi ERTELİYOR — filtre katalogları zaten belleğe yazıldığı için hiçbir veri kaybolmuyor (§142).', en: 'TWO FINE POINTS. The step that closes an open editor when a refresh starts now closes only the editor inside a screen that will freeze; typing a price in Collection while a CP refresh starts no longer throws your cursor out of the field. And the Collection filter refresh at the end of a refresh now DEFERS its redraw while an edit is open — the filter catalogues are already in memory, so nothing is lost (§142).' },
    ],
  },
  {
    v: '7.40', date: '2026-08-27',
    title: { tr: '“Seçenekleri ASAS’tan Tazele” düğmesi görünür yere alındı', en: 'The “Refresh options from ASAS” button was moved where it can be seen' },
    items: [
      { tr: 'Düğme v7.38’de FİLTRELER panelinin içine konmuştu; o panel varsayılan olarak KAPALI açılıyor, dolayısıyla düğme ancak “Filtreler”e basınca ortaya çıkıyordu. Kullanıcı ayarları ekranını açan biri onu göremezdi. Artık Kullanıcı & Yetki Yönetimi ekranının üst çubuğunda, arama kutusunun yanında ve “＋ Yeni Kullanıcı”nın solunda duruyor — panel açılmadan görünüyor.', en: 'In v7.38 the button had been placed inside the FILTERS panel, which opens closed by default, so it only appeared after pressing “Filters”. Anyone opening the user settings screen simply could not see it. It now sits in the top bar of User & Permission Management, next to the search box and to the left of “＋ New User” — visible without opening any panel.' },
      { tr: 'Tazeleme sonucu (hangi alandan kaç değer geldi, gelmediyse sebebi) araç çubuğunun hemen altında tam satır olarak yazılıyor. Düğme yalnız Data Model bağlantısı yetkisi olan kullanıcıya gösteriliyor; yetki kararı sunucuda veriliyor (§32).', en: 'The refresh outcome — how many values came from which field, or why they did not — is written as a full line right under the toolbar. The button is shown only to users with the Data Model connection permission, and the permission decision is made on the server (§32).' },
    ],
  },
  {
    v: '7.39', date: '2026-08-27',
    title: { tr: 'Kullanıcı adı artık tanımlanabiliyor', en: 'The user name can now be set' },
    items: [
      { tr: 'SORUNUN SEBEBİ: sunucu kullanıcı adını değiştirmeyi ZATEN kabul ediyordu, ama arayüzde böyle bir alan HİÇ YOKTU. Yeni kullanıcıda ad sessizce “Ad Soyad”tan türetiliyor, sonradan hiç değiştirilemiyordu. Adı boş kalan bir kayıt varsa giriş ekranı doğru uyarıyı veriyor ama düzeltilecek yer bulunamıyordu. Alan eklendi: Kullanıcı & Yetki Yönetimi > kullanıcıyı aç > Düzenle > “Kullanıcı adı”.', en: 'THE CAUSE: the server ALREADY accepted a change of user name, but no such field existed anywhere in the interface. For a new user the name was quietly derived from the full name and could never be changed afterwards. If a record was left without one, the login screen gave the right warning but there was nowhere to fix it. The field has been added: User & Permission Management > open the user > Edit > “User name”.' },
      { tr: 'Yeni Kullanıcı penceresinde de kendi alanı var; Ad Soyad yazdıkça kendiliğinden doluyor ama alana ELLE dokunduğunuz anda bir daha üzerine yazılmıyor — yazdığınızı silmek, alanı hiç sunmamaktan beterdi. Boş bırakırsanız eski davranış sürüyor: ad soyad kullanılıyor.', en: 'The New User window has its own field too; it fills in as you type the full name, but the moment you touch it by hand it is never overwritten again — erasing what you typed would have been worse than not offering the field at all. Left blank, the old behaviour continues: the full name is used.' },
      { tr: 'KULLANICI ADI ARTIK LİSTEDE GÖRÜNÜYOR, ayrı bir sütun olarak; tanımsız olan hem listede hem kullanıcı kartında UYARI olarak çıkıyor ve ne yapılacağı yazıyor. Eskiden tanımsız olanı bulmanın tek yolu kartları tek tek açmaktı. Giriş ekranındaki uyarı da artık düzeltilecek yeri adıyla söylüyor.', en: 'THE USER NAME NOW APPEARS IN THE LIST as its own column; one that is not set shows as a WARNING both in the list and on the user card, together with what to do about it. Finding such a user used to mean opening every card one by one. The warning on the login screen now names the place where it is fixed.' },
      { tr: 'Gerçek bir kullanıcıyla uçtan uca ölçüldü: kullanıcı adı “favci” iken “fatih.avci” yapıldı; sunucuda öyle kaydedildi, görünen ad değişmedi, YENİ adla giriş 200 döndü ve AYNI parola çalıştı, eski ad 401 ile reddedildi. Aynı adı başka bir kullanıcıya vermek 400 “Bu kullanıcı adı zaten kullanılıyor” ile reddedildi. Giriş ekranı önerisi de yeni adı gösterdi.', en: 'Measured end to end with a real user: the user name was changed from “favci” to “fatih.avci”; it was stored that way on the server, the display name did not change, signing in with the NEW name returned 200 with the SAME password, and the old name was refused with 401. Giving the same name to another user was refused with 400 “this user name is already in use”. The login suggestion showed the new name as well.' },
      { tr: 'Alan boş bırakılırsa kullanıcının mevcut adı DEĞİŞMEZ: boş değer sunucuya hiç gönderilmez. Gönderilseydi sunucu “Kullanıcı adı zorunludur” diyerek TÜM kaydetme işlemini reddederdi ve aynı formdaki diğer değişiklikler de kaybolurdu.', en: 'If the field is left blank the user’s existing name is UNCHANGED: an empty value is never sent to the server. Sending it would have made the server refuse the WHOLE save with “user name is required”, losing the other changes on the same form.' },
    ],
  },
  {
    v: '7.38', date: '2026-08-27',
    title: { tr: 'MAG / MMYG / Buying Group seçenekleri artık eksik gelmiyor', en: 'The MAG / MMYG / Buying Group options no longer come up short' },
    items: [
      { tr: 'BİLDİRİLEN KUSURUN İKİ AYRI SEBEBİ VARDI, İKİSİ DE DÜZELTİLDİ. Birincisi: seçim listeleri yalnız OKUNMUŞ sipariş satırlarından kuruluyordu. O satırlar ASAS kaynak filtresinden ve ufuktan geçmiş satırlardır — kurulum tek bir MAG/MMYG ile sınırlıysa liste de ondan ibaret kalıyordu. Ekranda görülen tam olarak buydu: tek MAG, tek MMYG ve yalnız o kapsamdaki Buyer Grupları.', en: 'THE REPORTED FAULT HAD TWO SEPARATE CAUSES, BOTH FIXED. The first: the option lists were built only from the order rows that had been READ. Those rows have passed the ASAS source filter and the horizon — if the installation is limited to a single MAG/MMYG, the list was limited to it as well. That is exactly what was on screen: one MAG, one MMYG, and only the Buyer Groups inside that scope.' },
      { tr: 'ARTIK SEÇENEKLER DOĞRUDAN VERİ MODELİNDEN OKUNABİLİYOR. Kullanıcı ekranındaki “Seçenekleri ASAS’tan Tazele” düğmesi, Merch Alt Grup Kod / Merch Marka Yaş Grup Kod / Buyer Grup (TR) alanlarının TEKİL değerlerini ASAS modelinden çeker; bu okumaya ufuk ya da kaynak filtresi UYGULANMAZ. Sonuç alan alan yazılır — kaç değer geldiği, gelmediyse sebebi. Bir alan okunamazsa diğerleri yine gelir. Liste yalnız BÜYÜR: daha önce görülmüş hiçbir değer düşmez (§142) ve katalog hiçbir yetki kararına girmez (§32).', en: 'THE OPTIONS CAN NOW BE READ STRAIGHT FROM THE DATA MODEL. The “Refresh options from ASAS” button on the user screen pulls the DISTINCT values of Merch Alt Grup Kod / Merch Marka Yaş Grup Kod / Buyer Grup (TR) from the ASAS model; no horizon and no source filter is applied to that read. The outcome is reported field by field — how many values arrived, or why they did not. If one field cannot be read the others still come. The list only GROWS: no value seen before is dropped (§142), and the catalogue takes part in no permission decision (§32).' },
      { tr: 'İKİNCİ SEBEP — “Buyer Grup’larda da bir kısmı geliyor”: liste, kullanıcının SEÇİLİ MAG/MMYG’siyle sınırlanıyordu. Katalogda var olan bir grup bile, o kapsamda geçmiyorsa hiç görünmüyordu. Artık kataloğun TAMAMI listeleniyor; ilgili değerler yalnız üstte “Seçili MAG / MMYG kapsamında” başlığı altında toplanıyor, kalanı “ASAS’taki diğer değerler” altında duruyor. Böylece sık kullanılan değer elde kalıyor ama hiçbir değer erişilemez olmuyor.', en: 'THE SECOND CAUSE — “only some of the Buyer Groups come”: the list was limited to the user’s SELECTED MAG/MMYG. A group present in the catalogue was invisible if it did not occur in that scope. The WHOLE catalogue is now listed; the relevant values are merely gathered at the top under “Within the selected MAG / MMYG”, with the rest under “Other values in ASAS”. The values you use most stay within reach, and none is unreachable.' },
      { tr: 'Tarayıcıda birebir ölçüldü: MAG CU4E ve MMYG KADIN atanmış bir kullanıcıda o kapsamda yalnız DOKUMA ve LİSANS varken, liste dört grubun tamamını gösterdi — “Seçili MAG / MMYG kapsamında: DOKUMA, LİSANS”, “ASAS’taki diğer değerler: AKSESUAR, ÖRME”. Tazeleme düğmesi de ASAS bağlantısı olmayan bir kurulumda sessiz kalmadı, sebebini yazdı.', en: 'Measured in a browser on the exact case: for a user assigned MAG CU4E and MMYG KADIN, where that scope holds only DOKUMA and LİSANS, the list showed all four groups — “Within the selected MAG / MMYG: DOKUMA, LİSANS”, “Other values in ASAS: AKSESUAR, ÖRME”. On an installation with no ASAS connection the refresh button did not stay silent either; it stated the reason.' },
      { tr: 'DÜRÜST SINIR: DAX okumasının kendisi bu ortamda çalıştırılamadı — veri modeli sorgusu Windows ve MSOLAP sürücüsü ister. Doğrulanan şey, alan eşleşmesinin çözülmesi (Siparis[MAG Kod] gibi), eşlenmemiş alanın sebebiyle bildirilmesi, hata durumunda mevcut kataloğun bozulmaması ve arayüzün sonucu alan alan yazmasıdır. Sorgunun kendisi ilk çalıştırmada sizin ortamınızda görülecek.', en: 'AN HONEST LIMIT: the DAX read itself could not be executed in this environment — a data model query needs Windows and the MSOLAP driver. What was verified is that the field mapping resolves (for example Siparis[MAG Kod]), that an unmapped field is reported with its reason, that a failed read leaves the existing catalogue intact, and that the interface states the outcome field by field. The query itself will be seen on its first run in your environment.' },
    ],
  },
  {
    v: '7.37', date: '2026-08-27',
    title: { tr: 'MAG, MMYG ve Buying Group artık çoktan seçmeli ve ASAS’tan besleniyor', en: 'MAG, MMYG and Buying Group are now multi-select and fed from ASAS' },
    items: [
      { tr: 'KULLANICI AYARLARINDA ÜÇ ALAN DA AYNI DENETİMİ KULLANIYOR. MAG ASAS’taki Merch Alt Grup, MMYG Merch Marka Yaş Grup, Buying Group ise Buyer Grup değerlerinden besleniyor. Seçenekler açılır listede sunuluyor; seçtiğiniz her değer bir çip olarak duruyor ve çarpıya basarak çıkarılıyor. SAYI SINIRI YOK: bir kullanıcıya istediğiniz kadar MAG, MMYG ve Buying Group atanabiliyor. Eskiden MAG ve MMYG tek değerlik metin kutusuydu, Buying Group ise sabit bir onay kutusu listesiydi.', en: 'ALL THREE FIELDS IN USER SETTINGS NOW USE THE SAME CONTROL. MAG is fed from Merch Sub Group in ASAS, MMYG from Merch Brand Age Group, and Buying Group from Buyer Group. The options are offered in a dropdown; every value you pick sits there as a chip and is removed with its ✕. THERE IS NO LIMIT: a user can be assigned as many MAGs, MMYGs and Buying Groups as you like. Previously MAG and MMYG were single-value text boxes and Buying Group was a fixed checkbox list.' },
      { tr: 'ELLE GİRİŞ AÇIK. Katalogda olmayan bir değeri yazıp Ekle’ye basabilir ya da Enter’a basabilirsiniz — Enter’ın formu göndermesi engellendi, aksi hâlde yazdığınız değer eklenmeden kayıt kapanırdı. Aynı değer iki kez eklenmiyor ve seçtiğiniz bir değer açılır listede ikinci kez görünmüyor.', en: 'MANUAL ENTRY IS OPEN. You can type a value that is not in the catalogue and press Add, or press Enter — Enter no longer submits the form, which would otherwise have closed the record without adding what you typed. The same value is never added twice, and a value you have chosen no longer appears in the dropdown.' },
      { tr: 'LİSTELER BİRBİRİNE GÖRE DARALIYOR: MMYG seçenekleri SEÇİLİ MAG’ların birleşimidir, Buying Group seçenekleri de seçili MAG/MMYG çiftlerinin birleşimi. Tek bir MAG’a bakmak, ikinci MAG’ın MMYG’lerini listede hiç göstermemek olurdu. Hiç MAG seçilmemişse tüm katalog gösterilir — sırayı ters de kurabilirsiniz.', en: 'THE LISTS NARROW EACH OTHER: the MMYG options are the union of the SELECTED MAGs, and the Buying Group options the union of the selected MAG/MMYG pairs. Looking at only one MAG would have hidden the second MAG’s MMYGs entirely. With no MAG selected the full catalogue is shown, so you can also work in the reverse order.' },
      { tr: 'DARALMA HİÇBİR SEÇİMİ SİLMEZ (§142). Bir MAG’ı çıkardığınızda yalnız seçenek listesi değişir; seçili MMYG ve Buying Group çipleri yerinde kalır. Tarayıcıda ölçüldü: bir MAG çıkarıldıktan sonra dört Buying Group çipinin dördü de duruyordu. Katalogda hiç olmayan bir değer (elle yazılmış ya da ASAS’tan artık gelmeyen) de listeden düşmüyor.', en: 'NARROWING DELETES NO SELECTION (§142). Removing a MAG changes only the option list; the selected MMYG and Buying Group chips stay. Measured in a browser: after removing a MAG all four Buying Group chips were still there. A value that is not in the catalogue at all — typed by hand, or no longer coming from ASAS — is not dropped either.' },
      { tr: 'Gerçek veriyle uçtan uca doğrulandı: ASAS’tan gelen katalogda 3 MAG, 3 MMYG ve 4 Buying Group vardı; üç MAG, iki MMYG ve üç Buying Group listeden seçilip bir Buying Group elle yazıldı. Kaydedilince sunucuda tam olarak bu değerler durdu ve form yeniden açıldığında hepsi çip olarak geri geldi. Yeni Kullanıcı penceresinde de aynı denetim var; dizinden bir buyer seçtiğinizde artık TÜM MAG ve MMYG değerleri ekleniyor — eskiden yalnız ilki alınıyor, gerisi sessizce düşüyordu.', en: 'Verified end to end on real data: the catalogue from ASAS held 3 MAGs, 3 MMYGs and 4 Buying Groups; three MAGs, two MMYGs and three Buying Groups were picked from the lists and one Buying Group was typed by hand. On save the server held exactly those values, and reopening the form brought them all back as chips. The New User window uses the same control; picking a buyer from the directory now adds ALL their MAG and MMYG values — previously only the first was taken and the rest were silently dropped.' },
    ],
  },
  {
    v: '7.36', date: '2026-08-27',
    title: { tr: 'Hızlı filtre başlıklarını artık siz ekleyip çıkarıyorsunuz', en: 'You now add and remove quick filter headings yourself' },
    items: [
      { tr: 'GENEL BAKIŞ, CP ve SİPARİŞLER şeritlerinin sağ ucuna bir ayar düğmesi geldi. Açılan pencerede hazır başlıkları (Sezon, Priority, Status, Ex-Factory, Del. Type, Sipariş Durumu) kapatıp açıyorsunuz ve tablonun HERHANGİ bir sütununu yeni başlık olarak ekliyorsunuz. Hesaplanan sütunlar (v7.31) ve ASAS/IAS’tan eklenen sütunlar (v7.34) da seçilebiliyor. Ayar kişiseldir: yalnız sizin ekranınızı değiştirir ve Profil Kopyalama ile aktarılabilir.', en: 'A settings button now sits at the right end of the OVERVIEW, CP and ORDERS strips. In the window that opens you switch the built-in headings (Season, Priority, Status, Ex-Factory, Del. Type, Order Status) on and off, and add ANY column of the table as a new heading. Calculated columns (v7.31) and columns brought in from ASAS/IAS (v7.34) can be chosen too. The setting is personal: it changes only your screen and can be transferred with Profile Copy.' },
      { tr: 'HAZIR BAŞLIKLAR YENİDEN YAZILMADI, yalnız gizlenebilir hâle geldi. Her birinin kendine özgü davranışı var — Priority tek bir hücrede birden çok değeri yakalar, Ex-Factory “Geçmiş / Bu Hafta / Bu Ay” gibi tarih kovaları üretir, renkler ve görünen adlar ayrıca dönüştürülür. Bunları genel bir motora çevirmek, çalışan davranışı sessizce değiştirme riskiydi. Hiç ayar yapmayan kullanıcı v7.35’teki şeridin AYNISINI görür.', en: 'THE BUILT-IN HEADINGS WERE NOT REWRITTEN, only made hideable. Each has behaviour of its own — Priority matches several values inside one cell, Ex-Factory builds date buckets such as “Past / This Week / This Month”, and colours and display names are transformed separately. Turning those into a generic engine would have risked silently changing working behaviour. A user who changes nothing sees exactly the v7.35 strip.' },
      { tr: 'EKLEDİĞİNİZ BAŞLIĞIN ÇİPLERİ GERÇEK SAYIMDIR. Gerçek veride ölçüldü: CP’ye “Ülke” başlığı eklendiğinde 10.864 satır üzerinden Bangladesh 3.998, Egypt 2.748, Turkey 1.983 … çıktı ve elle sayımla tek bir uyuşmazlık olmadı. Bangladesh çipine basıldığında tablo 3.998 satıra indi ve dönen satırların tamamı Bangladesh’ti. Siparişler’de aynı başlık 29.923 satır üzerinde çalıştı.', en: 'THE CHIPS ON A HEADING YOU ADD ARE REAL COUNTS. Measured on real data: adding a “Country” heading to CP gave Bangladesh 3,998, Egypt 2,748, Turkey 1,983 … across 10,864 rows, with not one mismatch against a manual count. Clicking the Bangladesh chip narrowed the table to 3,998 rows and every returned row was Bangladesh. The same heading ran over 29,923 rows on Orders.' },
      { tr: 'BİR DEĞER SEÇİNCE O BAŞLIĞIN DİĞER DEĞERLERİ KAYBOLMAZ. Bir başlığın çipleri KENDİ filtresi hariç sayılır; aksi hâlde seçim yaptığınız anda geriye tek çip kalır ve seçiminizi temizlemeden başka bir değere geçemezdiniz. Tarayıcıda doğrulandı: Bangladesh seçiliyken on ülke çipi de yerinde kaldı. Kendi filtresi yokken fazladan tarama yapılmaz — 10 binlerce satırda bu pahalıdır.', en: 'PICKING A VALUE DOES NOT MAKE THE OTHER VALUES DISAPPEAR. A heading’s chips are counted with its OWN filter excluded; otherwise one chip would be left the moment you chose a value and you could not switch to another without clearing your choice. Verified in a browser: with Bangladesh selected, all ten country chips remained. No extra scan runs when the heading has no filter of its own — over tens of thousands of rows that is expensive.' },
      { tr: 'BAŞLIK ÇIKARMAK HİÇBİR ŞEY SİLMEZ (§142). Sütun, satır ve filtre yerinde kalır; yalnız şerit değişir. Ölçüldü: “Ülke” başlığı çıkarıldığında Bangladesh filtresi çalışmaya devam etti, tablo 3.998 satırda kaldı ve filtre üstteki alanda görünür durumdaydı — sessizce kaybolmadı. Çok değerli bir sütunda çipler sınırlanır ve gösterilmeyen değer sayısı başlığın yanında “+28” gibi YAZILIR; sessizce kesmek “başka değer yok” demek olurdu.', en: 'REMOVING A HEADING DELETES NOTHING (§142). The column, the rows and the filter stay; only the strip changes. Measured: after removing the “Country” heading the Bangladesh filter kept working, the table stayed at 3,998 rows and the filter remained visible in the filters area — it did not vanish silently. On a column with many values the chips are capped and the number not shown is STATED next to the heading as “+28”; truncating silently would have meant “there are no other values”.' },
    ],
  },
  {
    v: '7.35', date: '2026-08-27',
    title: { tr: 'Prepare E-Mail kayıtları Üretici E-Posta Grupları’na taşındı', en: 'Prepare E-Mail records moved into Manufacturer Email Groups' },
    items: [
      { tr: 'ÜRETİCİ E-POSTA GRUPLARI EKRANINA “PREPARE E-MAIL’DEN TAŞI” DÜĞMESİ GELDİ. Prepare E-Mail listenizdeki üreticiler tek tıkla ortak alana geçer. Aday listesi İKİ yerden toplanır: penceredeki üretici listesi ve yıllar önce kaydedilmiş eski “üretici → e-posta” eşlemesi. Yalnız görünen listeyi almak, eski eşlemedeki adresleri geride bırakırdı. E-postası girilmemiş üretici de taşınır: eksik adres ortak ekranda görünür ve oradan tamamlanır — atlansaydı o üretici hiçbir listede görünmezdi.', en: 'THE MANUFACTURER EMAIL GROUPS SCREEN NOW HAS A “MOVE FROM PREPARE E-MAIL” BUTTON. The manufacturers in your Prepare E-Mail list move into the shared area in one click. Candidates are gathered from TWO places: the list in that window, and the old “manufacturer → email” mapping saved years ago. Taking only the visible list would have left the addresses in that old mapping behind. Manufacturers with no address move too: a missing address is visible on the shared screen and can be completed there — skipping them would have left those manufacturers in no list at all.' },
      { tr: 'TAŞIMA ÜZERİNE YAZMAZ (§142/§152). Ortak alandaki kayıtta FARKLI bir adres varsa hiçbir şey değiştirilmez; çakışma üreticinin adıyla bildirilir — hangi adresin doğru olduğuna program karar veremez. Ortak kayıtta adres BOŞSA doldurulur; bu kazançtır. Kaydı o an başkası düzenliyorsa dokunulmaz ve atlandığı söylenir. Sonuç sayılarla yazılır: sadece “taşındı” demek, neyin taşınmadığını gizlemek olurdu.', en: 'THE MOVE NEVER OVERWRITES (§142/§152). If the shared record already holds a DIFFERENT address, nothing is changed and the conflict is reported by manufacturer name — the program cannot decide which address is right. If the shared record’s address is EMPTY it is filled in, which is a gain. A record someone else is editing is left alone and reported as skipped. The outcome is stated in numbers: saying only “moved” would hide what did not move.' },
      { tr: 'Birleştirme SUNUCUDA ve TEK yazma işleminde yapılır. 20 kayıt 20 ayrı istek olsaydı ortadaki bir hata yarım taşınmış bir liste bırakırdı. Ağ klasöründe başka biri araya girerse revizyon çakışması bildirilir, kimsenin yazdığı sessizce kaybolmaz. Aynı üretici iki kez kaydedilmez: “ELSIWA APPAREL” ile “elsiwa apparel” aynı üretici sayılır (Türkçe’de noktalı/noktasız i farkı da göz önüne alınır).', en: 'The merge happens ON THE SERVER, in a SINGLE write. Twenty records as twenty separate requests would have left a half-moved list if one failed midway. If someone else writes at the same time over the network folder, the revision conflict is reported — nobody’s entry is silently lost. The same manufacturer is never stored twice: “ELSIWA APPAREL” and “elsiwa apparel” count as one (Turkish dotted/dotless i included).' },
      { tr: 'PREPARE E-MAIL ARTIK ADRESİ ORTAK ALANDAN OKUYOR. Taşımanın anlamı budur: adres tek yerden yönetilir, iki liste zamanla ayrışmaz. Pencere açılırken BOŞ adresler ortak alandan doldurulur — elle yazdığınız bir adresin üzerine YAZILMAZ. Ortak alan okunamazsa (ağ hatası) eski yerel listeye düşülür ve e-posta hazırlama akışı durmaz.', en: 'PREPARE E-MAIL NOW READS THE ADDRESS FROM THE SHARED AREA. That is what the move means: an address is managed in one place and the two lists cannot drift apart. When the window opens, EMPTY addresses are filled from the shared area — an address you typed yourself is never overwritten. If the shared area cannot be read (a network error), it falls back to the old local list and preparing an email is not interrupted.' },
      { tr: 'Tarayıcıda gerçek uygulama üzerinde ölçüldü: beş aday (dördü listeden, biri eski eşlemeden) için 3 kayıt taşındı, 1 boş adres dolduruldu, 1 çakışma üzerine yazılmadan bildirildi; ikinci kez basıldığında yeni kayıt oluşmadı (5 kayıt → 5 kayıt). Bu sırada gerçek bir kusur da bulundu ve düzeltildi: üretici listesi programda window üzerinde HİÇ görünmeyen bir değişkende duruyordu; doğrudan okumak sessizce boş liste verir ve taşıma yalnız eski eşlemeyi getirirdi.', en: 'Measured in a browser against the real application: for five candidates (four from the list, one from the old mapping) 3 records moved, 1 empty address was filled and 1 conflict was reported without being overwritten; pressing it a second time created nothing new (5 records → 5 records). A real fault surfaced during this and was fixed: the manufacturer list lives in a variable that is NOT visible on window, so reading it directly returned an empty list silently and the move would have carried only the old mapping.' },
    ],
  },
  {
    v: '7.34', date: '2026-08-27',
    title: { tr: 'Hesaplanan sütun: ASAS ve IAS-Antrepo sütunları da kaynak olabiliyor', en: 'Calculated columns can now source ASAS and IAS-Bonded columns' },
    items: [
      { tr: '“SÜTUN EKLE” İLE EKLEDİĞİNİZ SÜTUNLARIN NEDEN GÖRÜNMEDİĞİ BULUNDU. Bu sütunların satırdaki anahtarı sunucuda “__CPX_…” olarak üretiliyor; hesaplanan sütun penceresinin kaynak listesi ise “__ ile başlayan her anahtarı atla” diyordu. Kural görsel alanı gibi İÇ yardımcı alanları elemek için vardı, ama sizin eklediğiniz gerçek sütunları da eliyordu. Artık veri tabanı sütunları listede — hem CP hem Siparişler tablosunda.', en: 'THE REASON YOUR “ADD COLUMN” COLUMNS WERE MISSING WAS FOUND. The server gives those columns a row key of the form “__CPX_…”, while the calculated-column source list said “skip every key starting with __”. That rule existed to drop INTERNAL helper fields such as the image field, but it was dropping the real columns you had added as well. Database columns now appear in the list — on both the CP and Orders tables.' },
      { tr: 'Formülde sütuna İÇ ANAHTARIYLA değil ADIYLA başvuruluyor ([Üretici Kodu]); hesaplanan sütunlarda olduğu gibi. Açılır listede sütunun nereden geldiği yazıyor: “Üretici Kodu (ASAS)”, “Antrepo Adedi (IAS · Antrepo)” — iki bağlantı aynı adı taşıyabildiği için hangisini seçtiğinizi görmeniz gerekiyor. Aynı adı taşıyan gerçek bir satır alanı varsa O kazanır: mevcut formüllerinizin okuduğu değer değişmez.', en: 'A formula refers to the column BY NAME rather than by its internal key ([Vendor code]), exactly as with calculated columns. The dropdown states where each one comes from — “Vendor code (ASAS)”, “Bonded qty (IAS · Bonded)” — because two connections can carry the same name and you need to see which one you picked. If a real row field carries the same name, IT wins: the value your existing formulas read does not change.' },
      { tr: 'GERÇEK VERİDE ÖLÇÜLDÜ: “[Antrepo Adedi] − 10” formülü 10.864 satırın tamamında doğru çıktı, elle hesapla tek bir uyuşmazlık yok. Değeri henüz gelmemiş bir sütun 0 SAYILMIYOR: “Sütun bulunamadı” hatası veriliyor ve hücre “—” gösteriyor (§152) — yeni eklenen bir sütunun değerleri ilk CP yenilemesinde dolduğu için bu fark önemli.', en: 'MEASURED ON REAL DATA: the formula “[Bonded qty] − 10” came out right across all 10,864 rows, with not one mismatch against a manual calculation. A column whose values have not arrived yet is NOT treated as 0: it reports “column not found” and the cell shows “—” (§152) — which matters, because a newly added column only fills in on the next CP refresh.' },
      { tr: 'TABLONUN DIŞINDAN SÜTUN GETİREBİLİYORSUNUZ. Hesaplanan sütun penceresinde “+ ASAS / IAS-Antrepo’dan sütun getir” düğmesi var; mevcut “Sütun Ekle” penceresini açar (ikinci bir kopyası yazılmadı, tek bir akış bakımda kalır). Sütunu kaydettiğinizde formül penceresi AÇIK KALIR ve kaynak listesi yerinde tazelenir — yeni sütunu hemen formülde kullanabilirsiniz. Tarayıcıda doğrulandı: düğme ASAS ve IAS · Antrepo bağlantılarını listeleyen pencereyi açtı, formül penceresi kapanmadı.', en: 'YOU CAN BRING IN A COLUMN FROM OUTSIDE THE TABLE. The calculated-column window now has a “+ Bring a column from ASAS / IAS-Bonded” button that opens the existing “Add Column” window (no second copy was written — one flow stays maintained). When you save the column the formula window STAYS OPEN and the source list refreshes in place, so you can use the new column in the formula straight away. Verified in a browser: the button opened the window listing the ASAS and IAS · Bonded connections, and the formula window did not close.' },
      { tr: 'YETKİ SUNUCUDA (§32). Veri tabanı sütunu ORTAK Data Model bağlantısına yazılır; yalnız Data Model yetkisi olan kullanıcı ekleyebilir. Yetkisi olmayan kullanıcıya düğme gösterilip 403 aldırmak yerine sebebi yazılıyor. İki gerçek kullanıcıyla ölçüldü: Buyer hesabında düğme çizilmedi, açıklama göründü ve sunucuya doğrudan yazma denemesi 403 ile reddedildi. Nakliye Kıyaslama tablosunda bu yol hiç çizilmiyor — orada veri tabanı sütunu diye bir şey yok.', en: 'PERMISSION LIVES ON THE SERVER (§32). A database column is written to the SHARED Data Model connection, so only a user with the Data Model permission can add one. Rather than showing the button and letting it fail with a 403, the reason is stated instead. Measured with two real users: on the Buyer account the button was not drawn, the explanation appeared, and a direct write to the server was refused with 403. The path is not drawn at all on the Shipping Comparison table — there is no such thing as a database column there.' },
    ],
  },
  {
    v: '7.33', date: '2026-08-27',
    title: { tr: 'Ayarlar çekmecesindeki düğmeler geri geldi, tüm sayaçlar tek biçimde', en: 'The Settings drawer buttons are back; every counter uses one format' },
    items: [
      { tr: 'AYARLAR ÇEKMECESİNDEKİ DÜĞMELERİN NEDEN GÖRÜNMEDİĞİ BULUNDU. Düğmeler eksik değildi, kırpılıyorlardı: menü, kendisi kaydırılabilir olan Kaynak Veri gövdesinin içinde konumlanıyordu ve bir kapsayıcı, taşan çocuğunu keser. v7.31-32’de üç düğme daha eklenince (E-Mail Grupları, Kaynak Klasör, Kur Excel’i) menü uzadı ve üst kısmı gövdenin dışında kaldı; ekranda yalnız en alttaki birkaç düğme duruyordu.', en: 'THE REASON THE SETTINGS BUTTONS WERE INVISIBLE WAS FOUND. The buttons were not missing, they were being clipped: the menu was positioned inside the Source Data body, which scrolls, and a scrolling container cuts off a child that overflows it. When v7.31-32 added three more buttons (E-Mail Groups, Source Folder, FX Excel), the menu grew and its top ended up outside that body; only the bottom few buttons remained on screen.' },
      { tr: 'Menü artık kapsayıcıya değil GÖRÜNTÜ ALANINA göre konumlanıyor, yani hiçbir kapsayıcı onu kesemiyor. Açılırken düğmeye göre hesaplanıp ekran içine sığdırılıyor; pencere boyutu değişince veya sayfa kaydırılınca düğmesinden kopmuyor. Tarayıcıda ölçüldü: 950 piksellik pencerede on iki düğmenin tamamı (Veri Kaynağı ve Filtreler → Endeksmatik Güncelle) ekran içinde çizildi, ekran dışında kalan düğme sayısı sıfır.', en: 'The menu is now positioned against the VIEWPORT rather than a container, so no container can cut it. It is measured against its button when opened and kept inside the screen, and it does not drift away from the button when the window is resized or the page is scrolled. Measured in a browser: in a 950-pixel-tall window all twelve buttons (Source & Filters → Update Endeksmatik) were drawn on screen, with zero buttons off screen.' },
      { tr: 'İLERİDE AYNI HATA TEKRARLAMASIN diye menüye ekran yüksekliğine bağlı bir sınır ve kendi kaydırması verildi. 600 piksellik dar pencerede test edildi: menü yine ekran içinde kaldı ve içinde kaydırılabilir oldu — yeni bir ayar düğmesi eklendiğinde hiçbiri gizlenmeyecek.', en: 'SO THE SAME FAULT CANNOT RETURN, the menu was given a viewport-relative height limit and its own scrolling. Tested in a 600-pixel-tall window: it still stayed on screen and became scrollable inside — adding another settings button will not hide any of them.' },
      { tr: 'Çekmece görünür olunca ortaya çıkan bir eksik de düzeltildi: “Kaynak Klasör” komşularının aksine simgesiz duruyordu. Sebep eksik simge değil, açılışta düğmenin İÇERİĞİNİN TAMAMININ yeniden yazılmasıydı — simge ve dil etiketi siliniyordu. Artık yalnız seçili klasör yolu yazılıyor; simge yerinde kalıyor ve dil değiştirince yol kaybolmuyor. Tarayıcıda ölçüldü: çekmecede simgesiz düğme kalmadı.', en: 'A gap that only became visible once the drawer was: “Source Folder” sat there without an icon, unlike its neighbours. The cause was not a missing icon but that the button’s ENTIRE CONTENT was rewritten at startup, wiping both the icon and the language label. Only the selected folder path is written now; the icon stays and the path survives a language switch. Measured in a browser: no button in the drawer is left without an icon.' },
      { tr: 'TÜM SAYAÇLAR ARTIK “30,5 sn” BİÇİMİNDE: saniye, virgülden sonra tek basamak. Önceden aynı uygulamada üç farklı biçim vardı — ham milisaniye (“269.992 ms”), İngilizce ondalık nokta (“5.2s”) ve dakika:saniye (“03:12”). Hepsi tek bir biçimlendiriciden geçiyor; yeni bir sayaç eklendiğinde de biçim kendiliğinden doğru olacak. İngilizce arayüzde nokta ve “s” kullanılır.', en: 'EVERY COUNTER NOW READS LIKE “30.5 s”: seconds, one decimal place. Previously the application showed three different formats — raw milliseconds (“269,992 ms”), an English decimal point (“5.2s”) and minutes:seconds (“03:12”). They all run through a single formatter now, so a counter added later is formatted correctly without extra work. The English interface uses a dot and “s”.' },
      { tr: 'Ondalık basamak bilerek SABİT bir tanedir: 30 saniye “30 sn” değil “30,0 sn” yazar, böylece alt alta duran sayaçlar hizalı kalır. Süre TAHMİNLERİ (“~30 sn”) bilerek dışarıda bırakıldı; onlar ölçüm değil kestirimdir, ondalık eklemek olmayan bir kesinlik iddia ederdi.', en: 'The decimal is deliberately FIXED at one: 30 seconds reads “30.0 s”, not “30 s”, so counters stacked in a column stay aligned. Duration ESTIMATES (“~30 s”) were deliberately left out — they are predictions rather than measurements, and a decimal would claim a precision they do not have.' },
    ],
  },
  {
    v: '7.32', date: '2026-08-27',
    title: { tr: 'Üretici E-Posta Grupları: ortak alan, kart tasarımı, kayıt bazlı kilit', en: 'Manufacturer Email Groups: shared area, card design, per-record locking' },
    items: [
      { tr: 'Kaynak Veri > Ayarlar altına “E-Mail Grupları” geldi. Üretici e-posta adreslerini ÜLKE ve DOKUMA / ÖRME / TRİKO / DENİM gibi gruplarla düzenliyorsunuz; her iki başlık listesi de tamamen sizin — istediğinizi ekleyip çıkarabiliyorsunuz. Gruplar hazır gelir ama sabit değildir. Ülke listesi UYDURULMAZ, boş başlar: hangi ülkelerle çalıştığınızı veriden bilemezdim.', en: '“E-Mail Groups” now sits under Source Data > Settings. You organise manufacturer email addresses by COUNTRY and by groups such as Dokuma / Örme / Triko / Denim; both heading lists are entirely yours to add to and remove from. The groups ship as a starting point, not a fixed list. The country list is never invented — it starts empty, because the data cannot tell me which countries you work with.' },
      { tr: 'ALAN ORTAKTIR. Kayıtlar kullanıcı çalışma alanında değil, paylaşılan sunucu dosyasında durur; herkesin girdiği veri herkese görünür. Kayıtlar KART olarak çizilir: üretici, e-posta (tıklanabilir), ilgili kişi, telefon, not, ülke/grup etiketleri ve altında son güncelleme.', en: 'THE AREA IS SHARED. Records live in a shared server file rather than a per-user workspace, so everything anyone enters is visible to everyone. Records are drawn as CARDS: manufacturer, email (clickable), contact, phone, note, country/group chips, and the last update underneath.' },
      { tr: 'BİR KAYDI DÜZENLERKEN O KAYIT DİĞERLERİNE KAPANIR. Kartta “… düzenliyor” rozeti çıkar ve Düzenle düğmesi hiç çizilmez. İki gerçek kullanıcıyla tarayıcıda doğrulandı: ikinci kullanıcının hem düzenlemeye alma hem doğrudan yazma denemesi reddedildi (409) ve kayıt değişmedi. Engelleme SUNUCUDADIR (§32): istemcinin “kilit bende” demesi yeterli değil, her yazma isteğinde kilit sunucuda doğrulanır.', en: 'WHILE ONE PERSON EDITS A RECORD, IT CLOSES TO EVERYONE ELSE. The card shows a “… is editing” badge and the Edit button is not drawn at all. Verified in a real browser with two real users: the second user’s attempts to both take the record and write to it directly were rejected (409) and the record did not change. The block lives ON THE SERVER (§32) — a client claiming to hold the lock is not enough; every write revalidates the lock server-side.' },
      { tr: 'KİLİDİN SÜRESİ VAR — bu tasarımın en önemli parçası. Süresiz bir kilit, tarayıcısını kapatan kullanıcının o kaydı HERKES için kalıcı olarak kilitlemesi demekti ve elle müdahale gerektirirdi. Kilit iki dakikada düşer, düzenleme penceresi açık kaldıkça kalp atışıyla tazelenir, pencere kapanınca bırakılır. Kaydettiğiniz anda da kilit düşer, kayıt başkalarına açılır.', en: 'THE LOCK EXPIRES — the most important part of this design. A lock without expiry would let someone who simply closes their browser hold a record hostage for everyone, needing manual intervention. It expires after two minutes, is refreshed by a heartbeat while the edit window stays open, and is released when the window closes. Saving also releases it immediately, reopening the record to others.' },
      { tr: 'SON GÜNCELLEME KAYIT BAZINDA görünür: her kartın altında ne zaman ve KİM tarafından güncellendiği yazar; oluşturan bilgisi ayrıca korunur. Liste açıkken kendi kendine tazelenir ki kimin düzenlediği bayat kalmasın — ama sizin AÇIK olan düzenleme formunuz yeniden çizilmez, yazdığınız metin silinmez.', en: 'THE LAST UPDATE IS PER RECORD: each card states when and BY WHOM it was updated, and the creator is kept separately. The list refreshes itself while open so “who is editing” never goes stale — but your OPEN edit form is never redrawn, so what you typed is not wiped.' },
      { tr: 'İÇİNDE KAYIT OLAN BAŞLIK SİLİNEMEZ. Silinseydi o kayıtlar sahipsiz kalır ve hiçbir grupta görünmezdi (§142). Engellenirken kaç kaydın bağlı olduğu adıyla söylenir. Başlığı olmayan kayıtlar da “Atanmamış” bölümünde görünür — hiçbir kayıt gözden kaybolmaz. Ağ klasöründe iki Buyer Log aynı anda yazarsa biri sessizce kaybolmaz: revizyon çakışması bildirilir.', en: 'A HEADING THAT STILL HAS RECORDS CANNOT BE DELETED. Deleting it would orphan those records so they appeared in no group at all (§142). The refusal names the heading and how many records are attached. Records with no heading appear under “Unassigned”, so nothing disappears from view. If two Buyer Log instances write at once over the network folder, neither is silently lost — the revision conflict is reported.' },
    ],
  },
  {
    v: '7.31', date: '2026-08-27',
    title: { tr: 'Kaynak Veri sadeleşti, model adına sağ tık menüsü, OAB filtre hafızası', en: 'Simpler Source Data, right-click menu on model names, OAB filter memory' },
    items: [
      { tr: 'KAYNAK VERİ: sayfa başına yenileme detay listesi (CP/Overview, Orders, Backlog, LFL) kaldırıldı — aynı bilgi ve aynı yenileme işi başlıktaki Yenile menüsünde zaten var. "Excel’den yükle" ve "Antrepo Excel Yükle" düğmeleri kaldırıldı. Kur Excel’i Ayarlar sekmesine taşındı. "Excel’den yükle" kalkınca içindeki Kaynak Klasör seçici erişilemez kalacaktı; o da Ayarlar’a alındı, hiçbir yetenek kaybolmadı.', en: 'SOURCE DATA: the per-page refresh list (CP/Overview, Orders, Backlog, LFL) is gone — the same information and the same refresh action already live in the Refresh menu in the header. “Upload from Excel” and “Upload Antrepo Excel” were removed. FX Excel moved to the Settings tab. Removing “Upload from Excel” would have left the Source Folder picker inside it unreachable, so that moved to Settings too — no capability was lost.' },
      { tr: 'MODEL ADINA SAĞ TIK. Satır içi e-posta düğmeleri tablolardan kaldırıldı. Model adına sağ tıklayınca açılan menüde hem Outlook mail araması hem Araçlar menüsündeki işlemler var. Araçlar kopyalanmadı: menü o düğmeleri canlı okuyup seçilince GERÇEK düğmeye tıklıyor, böylece ileride yeni bir araç eklendiğinde burada hiçbir şey değişmesi gerekmiyor. Araçların çoğu seçili satırlara göre çalıştığı için, sağ tıklanan satır seçili değilse yalnız o satır seçilir ve menü başlığı neye uygulanacağını yazar — görünmeyen bir kümeye işlem yapılmaz. Menü yalnız model adı hücresinde açılır; diğer hücrelerde tarayıcının kendi kopyala/yapıştır menüsü çalışmaya devam eder.', en: 'RIGHT-CLICK ON A MODEL NAME. The inline email buttons were removed from the tables. Right-clicking a model name opens a menu with both the Outlook email search and the actions from the Tools menu. The tools are not duplicated: the menu reads those buttons live and clicks the REAL button when one is chosen, so adding a new tool later needs no change here. Because most tools act on the selected rows, right-clicking an unselected row selects just that row and the menu header states what the action will apply to — nothing runs against an unseen set. The menu only opens on the model-name cell; every other cell keeps the browser’s own copy/paste menu.' },
      { tr: 'OAB FİLTRE HAFIZASI. Klasman Tanımı, Tedarik Sepeti, Alım Bütçe Tipi gibi yerel pivot filtre seçimleri hesabınıza kaydediliyor ve bir sonraki açılışta geri geliyor (başka bilgisayardan girseniz de). Kayıtlı bir değer yeni raporda artık yoksa KÖRÜ KÖRÜNE UYGULANMIYOR: pivot bomboş görünür ve sebebini göremezdiniz. Uygulanamayan filtreler adlarıyla bildiriliyor.', en: 'OAB FILTER MEMORY. Local pivot filter selections such as Klasman Tanımı, Tedarik Sepeti and Alım Bütçe Tipi are saved to your account and come back next time, including from another computer. A saved value that no longer exists in the new report is NOT applied blindly — the pivot would look empty with no explanation. Filters that could not be applied are reported by name.' },
      { tr: 'HESAPLANAN SÜTUNLAR ARTIK BİRBİRİNE DAYANABİLİR. "Add calculated column" penceresinde kullanıcıların eklediği hesaplanan sütunlar da kaynak listesinde görünüyor; sütuna formülde ADIYLA başvuruluyor ([Üretim Süresi]). Sütunlar bağımlılık sırasına göre hesaplanıyor. Gerçek veride ölçüldü: "Gecikme = [Üretim Süresi] − 30" 10.864 satırda doğru çıktı (73→43, 16→−14), elle hesapla fark yok. Döngü kurulursa tarayıcı KİLİTLENMİYOR: X→Y→X 4 ms’de tespit edilip "Döngü" olarak bildiriliyor. Kendine gönderme ("Z = [Z] + 1") de çevrim sayılıyor — sayılmasaydı değer her yenilemede sessizce büyürdü.', en: 'CALCULATED COLUMNS CAN NOW BUILD ON EACH OTHER. In “Add calculated column”, calculated columns added by users now appear in the source list; a formula refers to one BY NAME ([Lead time]). Columns are evaluated in dependency order. Measured on real data: “Delay = [Lead time] − 30” came out right across 10,864 rows (73→43, 16→−14) with no mismatch against a manual calculation. A loop does NOT hang the browser: X→Y→X is detected in 4 ms and reported as a loop. A self-reference (“Z = [Z] + 1”) counts as a loop too — otherwise the value would silently grow on every refresh.' },
    ],
  },
  {
    v: '7.30', date: '2026-08-27',
    title: { tr: 'Edge’de “Allow remote debugging?” artık bir kez soruluyor', en: 'Edge’s “Allow remote debugging?” is now asked once' },
    items: [
      { tr: 'Edge 144+ remote debugging’e yaklaşan HER dış istek için ayrı bir onay penceresi açıyor ve bu pencereler üst üste biniyordu. Buyer Log artık Edge’e çok daha az yaklaşıyor: Edge’i açtıktan sonra bir kez Allow demeniz yetiyor. Aynı sahte “onay bekleyen Edge” karşısında ölçüldü — kullanıcının yaptığı olağan dizi (Otomasyon Ayarları’nı aç, Bağlantıyı kontrol et, PLM ekranı, sonra iki iş ve dört paralel iş) v7.29’da 18 yaklaşma üretiyordu, şimdi 1 üretiyor.', en: 'Edge 144+ opens a separate consent window for EVERY external request that approaches remote debugging, and those windows stacked up. Buyer Log now approaches Edge far less: one Allow per Edge launch is enough. Measured against the same simulated “consent pending” Edge — the ordinary sequence (open Automation Settings, Check connection, a PLM screen, then two jobs and four parallel jobs) produced 18 approaches on v7.29 and produces 1 now.' },
      { tr: 'Dört ayrı düzeltme: (1) 127.0.0.1 cevap verdiyse localhost bir daha sorulmuyor — onay beklenirken yanıt “DevTools değil” göründüğü için ikinci diyaloğu tam olarak bu açıyordu. (2) Bulunan adres önbelleğe alınıyor; sonraki çağrılar yalnız çıplak TCP ile bakıyor, DevTools’a istek gitmiyor. (3) Aynı anda gelen istekler tek bir arama sözünü paylaşıyor. (4) Başarısız aramadan sonra 4 saniyelik kısa bir bekleme var; onay penceresi ekranda dururken arka arkaya yeni pencereler açılmıyor. Bekleme bilerek kısa: Allow’a bastıktan sonraki denemeniz gecikmiyor, başarılı bağlantı beklemeyi anında sıfırlıyor.', en: 'Four separate fixes: (1) if 127.0.0.1 answers, localhost is not asked again — while consent is pending the reply looks “not DevTools”, which is exactly what opened the second dialog. (2) The discovered address is cached, and later calls check it with a bare TCP connect only, sending nothing to DevTools. (3) Concurrent requests share a single lookup. (4) After a failed lookup there is a short 4-second pause, so new windows do not pile up while a consent window is on screen. The pause is deliberately short: your attempt right after clicking Allow is not delayed, and a successful connection clears it immediately.' },
      { tr: '“Bağlantıyı kontrol et” ve Otomasyon Ayarları penceresi artık Edge’e HİÇ bağlanmıyor. Hazır olma bilgisi için bağlanmak gerekmiyordu: portun dinlenmesi zaten sizin işaretlediğiniz “Allow remote debugging for this browser instance” kutusunun karşılığı. Onay ise ilk gerçek bağlantıda bir kez isteniyor.', en: 'Check connection and the Automation Settings window no longer connect to Edge at all. Readiness never required connecting: a listening port is exactly what the “Allow remote debugging for this browser instance” checkbox controls. Consent is then requested once, on the first real connection.' },
      { tr: 'ONAY ATLANMIYOR. Bu pencere sizin oturumunuzu koruyor — o portu dinleyen herhangi bir yerel program çerezlerinizi okuyabilir. Chromium tarafında “beni hatırla” isteği “not planned” olarak kapatıldığı için onayı tarayıcıda kalıcılaştırmanın desteklenen bir yolu yok; yapılan tek şey Buyer Log’un kaç kere yaklaştığını azaltmak oldu. Adres yalnız bellekte tutuluyor, diske yazılmıyor.', en: 'CONSENT IS NOT BYPASSED. That window protects your session — any local program listening on that port could read your cookies. Chromium closed the “remember my choice” request as not planned, so there is no supported way to make the approval stick in the browser; the only change is how often Buyer Log approaches it. The address is kept in memory only and never written to disk.' },
    ],
  },
  {
    v: '7.29', date: '2026-08-27',
    title: { tr: 'Not Hatırlatıcısı artık yalnız SİZİN notlarınızı gösteriyor', en: 'The Notes Reminder now shows only YOUR notes' },
    items: [
      { tr: 'Genel Bakış’taki Not Hatırlatıcısı yalnız sizin yazdığınız notları listeler. Diğer kullanıcıların notları CP Tracker ve Siparişler ekranlarında aynen görünmeye devam eder — hiçbir not silinmedi, gizlenmedi, yalnız Genel Bakış listesi kişiselleşti.', en: 'The Notes Reminder on Overview now lists only the notes you wrote. Other users’ notes still appear exactly as before on CP Tracker and Orders — nothing was deleted or hidden; only the Overview list became personal.' },
      { tr: 'SÜZME ALAN BAZINDA yapılır, satır bazında değil: aynı siparişin "Notlar"ı sizin, "Ek Not"u bir başkasınınsa Genel Bakış’ta yalnız sizinki görünür. Not tarihleri de yalnız size ait alanlardan hesaplanır; aksi hâlde başkasının notunun tarihi sizin listenizin sıralamasını belirlerdi.', en: 'Filtering is PER FIELD, not per row: if the “Notes” of an order are yours and its “Additional Notes” belong to someone else, only yours appear on Overview. Note dates are computed only from your own fields too — otherwise someone else’s note date would drive the ordering of your list.' },
      { tr: 'Bunun için notlara YAZAR bilgisi eklendi. Yazar SUNUCUDA, oturumdan belirlenir; istemcinin gönderdiği bir yazar alanı kabul edilmez. Gerçek tarayıcıda sınandı: yapay bir istemci notu "BAŞKA BİRİ" adına yazmaya çalıştığında kayıt yine oturum sahibinin adına düştü. Not silinince yazar damgası da düşer, yoksa sonradan yazan kişinin notu yanlış kişiye atfedilirdi.', en: 'To make this possible, notes now carry an AUTHOR. The author is determined ON THE SERVER from the session; an author field sent by the client is never accepted. Verified in a real browser: when a synthetic client tried to write a note as “BAŞKA BİRİ”, the record still landed under the session owner’s name. Deleting a note also clears its author stamp — otherwise the next person’s note would be attributed to the wrong user.' },
      { tr: 'ESKİ NOTLAR: v7.28’e kadar yazar hiç tutulmadığı için geçmiş notların gerçek yazarı veriden çıkarılamıyor. Talimat üzerine yazarı bulunmayan tüm eski notlar GÖKBERK ÇELEBİ adına geri dolduruldu. Bu işlem not METNİNE, tarihine ve yazarı zaten olan notlara DOKUNMAZ ve tekrar çalıştığında hiçbir şeyi değiştirmez. Not: bu notlardan bir kısmı gerçekte başka kullanıcılar tarafından yazılmış olabilir — o notlar artık yalnız GÖKBERK ÇELEBİ’nin Genel Bakış listesinde çıkar, gerçek yazarının listesinde çıkmaz. CP ve Orders’da ise hepsi herkese görünmeye devam eder.', en: 'LEGACY NOTES: since no author was ever stored before v7.28, the real author of past notes cannot be derived from the data. As instructed, every note without an author was backfilled to GÖKBERK ÇELEBİ. The backfill never touches note TEXT, dates, or notes that already have an author, and re-running it changes nothing. Note: some of those notes may in fact have been written by other users — they will now surface only in GÖKBERK ÇELEBİ’s Overview list, not in their real author’s. On CP and Orders they all remain visible to everyone.' },
      { tr: 'Genel Bakış metinleri kuralı açıkça yazar ("Burada YALNIZ sizin yazdığınız notlar listelenir…") ki notunuz orada görünmediğinde bunun bir eksiklik değil kural olduğu belli olsun.', en: 'The Overview wording states the rule outright (“Only notes YOU wrote are listed here…”) so that a missing note reads as the rule at work, not as a bug.' },
    ],
  },
  {
    v: '7.28', date: '2026-08-27',
    title: { tr: 'Hesaplanan sütunlar: sütunlar arası formül yazın', en: 'Calculated columns: write formulas across columns' },
    items: [
      { tr: 'CP, Siparişler ve Nakliye Kıyaslama tablolarında Sütunlar panelinin altındaki "+ Hesaplanan Sütun" ile kendi sütununuzu kurabilirsiniz. FORMÜL YAZMANIZ GEREKMEZ: pencere HESAPLAMA kipinde açılır — [sütun] [işlem] [sütun] kutularını doldurursunuz, işlem listesi Excel\'deki gibi + − × ÷. Kutu ekleyerek zincir uzatılır ve istediğiniz yere sabit sayı yazabilirsiniz ([A] ÷ [B] × 100 gibi). Kaydedince tablo yeni sütuna kayar ve sütun kısa süre vurgulanır.', en: 'On the CP, Orders and Shipping Comparison tables, “+ Calculated Column” at the bottom of the Columns panel creates your own column. NO FORMULA TYPING IS NEEDED: the window opens in CALCULATION mode — you fill in [column] [operation] [column] boxes, with Excel’s own + − × ÷ signs. Add boxes to extend the chain and type a fixed number anywhere ([A] ÷ [B] × 100). After saving, the table scrolls to the new column and highlights it briefly.' },
      { tr: 'BİRLEŞTİRME kipi sütunları tek hücrede toplar. Birleştirilecek sütunları seçip sıralarsınız, ayracı bir tuşla belirlersiniz (tire, eğik çizgi, nokta, boşluk, virgül, dik çizgi veya kendi yazdığınız bir ayraç). Gerçek veride: MAG + MMYG + Buying Grup → "CK1E - CKW1 - ÖRME" (10.864 satırın tamamı dolu). "Boş hücreleri atla" açıkken aradaki sütun boşsa ayraç ÇİFT KALMAZ — A & " - " & B & " - " & C yazmanın asıl sorunu buydu: boş bir B "ELBİSE -  - MAVİ" üretiyordu.', en: 'JOIN mode brings columns together in one cell. You pick and order the columns to join, then choose the separator with one click (dash, slash, dot, space, comma, pipe, or one you type). On real data: MAG + MMYG + Buying Group → “CK1E - CKW1 - ÖRME” (all 10,864 rows filled). With “skip blank cells” on, a blank column in the middle does NOT leave a doubled separator — that was the real problem with writing A & " - " & B & " - " & C, where a blank B produced “ELBİSE -  - MAVİ”.' },
      { tr: 'KUTU SIRASI = HESAP SIRASI. Matematikte × ve ÷ önce işlendiği için "A − B × 2" kutuları soldan sağa okuyan kullanıcıya (A−B)×2 gibi görünürken A−(B×2) hesaplanırdı — görülmesi imkânsız bir fark (10−4×2: 12 yerine 2). Kurucu her adımı parantezleyerek kutu sırasını korur ve ürettiği formülü pencerede AÇIKÇA gösterir; oradan Gelişmiş kipe geçip elle geliştirebilirsiniz. Düzenlemeye açtığınızda formül kutulara geri çözülür; kutulara sığmayan bir formül (DAYS, IF, iç içe koşul…) uydurma kutu gösterilmeden Gelişmiş kipte açılır.', en: 'BOX ORDER = CALCULATION ORDER. Because × and ÷ bind first, “A − B × 2” looks like (A−B)×2 to someone reading the boxes left to right while actually computing A−(B×2) — an invisible difference (10−4×2 gives 2, not 12). The builder parenthesises each step to keep the box order, and shows the formula it produced IN PLAIN SIGHT; from there you can switch to Advanced mode and refine it by hand. Reopening a column decodes the formula back into boxes; a formula that does not fit the boxes (DAYS, IF, nested conditions…) opens in Advanced mode rather than being shown as misleading boxes.' },
      { tr: 'İKİ TARİHİN FARKI GÜNDÜR. ASAS tarihleri "20260302" gibi 8 haneli metin olarak da gelir; bunları sayı sanıp 20260302 − 20260216 = 86 üretmek sessiz ve pahalı bir hata olurdu. Gerçek bir takvim gününe karşılık gelen değerler tarih sayılır ve sonuç 14 gün çıkar; takvim günü olmayan 8 haneli sayılar sayı kalır. Gerçek ASAS verisinde ölçüldü: 10.864 CP satırının 10.841\'inde hesaplandı, elle yapılan bağımsız hesapla FARK YOK.', en: 'SUBTRACTING TWO DATES GIVES DAYS. ASAS dates also arrive as 8-digit text such as “20260302”; treating those as numbers would silently produce 20260302 − 20260216 = 86. Only values that are a real calendar day are treated as dates — the result is 14 days — while 8-digit numbers that are not calendar days stay numeric. Measured on real ASAS data: calculated on 10,841 of 10,864 CP rows with ZERO mismatches against an independent manual calculation.' },
      { tr: 'HATA GİZLENMEZ. Olmayan bir sütun, sıfıra bölme veya bozuk formül "0" değil HATA verir; hücrede "—" görünür ve başlıkta sebebi yazar. Kaç satırda hesaplanamadığı da sayılır ("10.864 satırın 23 tanesinde hesaplanamadı: geçerli bir tarih gerekiyor") — birkaç boş hücre yüzünden sütunun tamamı bozuk gösterilmez. BOŞ HÜCRE SIFIR DEĞİLDİR: boş bir hücreyle yapılan işlem boş verir, "0 gün fark" gibi görünmez.', en: 'ERRORS ARE NEVER HIDDEN. A missing column, a division by zero or a broken formula produces an ERROR, not “0”: the cell shows “—” and the header states why. The number of failing rows is counted too (“Could not be calculated on 23 of 10,864 rows: a valid date is required”), so a few blank cells do not make the whole column look broken. A BLANK CELL IS NOT ZERO: arithmetic with a blank cell yields blank, never a misleading “0 days”.' },
      { tr: 'Hesaplanan değer satıra GERÇEK bir değer olarak yazılır; bu yüzden sıralama, sütun filtreleri, sayfa filtreleri ve Excel\'e aktarma hiçbir özel duruma gerek kalmadan çalışır (azalan sıralama gerçek veride 460, 458, 457… verdi). Formül penceresinde kaydetmeden önce ilk satırlardaki sonucu canlı görürsünüz.', en: 'The calculated value is written onto the row as a REAL value, so sorting, column filters, page filters and Excel export all work with no special cases (descending sort on real data gave 460, 458, 457…). The formula window shows a live preview of the result on the first rows before you save.' },
      { tr: 'Gelişmiş kipte tüm fonksiyonlar var: DAYS, TODAY, ADDDAYS, YEAR/MONTH/DAY/WEEKNUM, IF, AND/OR/NOT, ROUND, MIN/MAX/SUM/AVG, ABS/SQRT/POWER/MOD, COALESCE, ISBLANK, IFERROR, TEXTJOIN, CONCAT ve & ile metin birleştirme, UPPER/LOWER/TRIM/LEN/LEFT/RIGHT/MID, CONTAINS. Metinlerde \\" ile tırnak kaçışı da çalışıyor — ayracına tırnak yazan bir sütun artık derlenmeden kalmıyor.', en: 'Advanced mode still has every function: DAYS, TODAY, ADDDAYS, YEAR/MONTH/DAY/WEEKNUM, IF, AND/OR/NOT, ROUND, MIN/MAX/SUM/AVG, ABS/SQRT/POWER/MOD, COALESCE, ISBLANK, IFERROR, TEXTJOIN, CONCAT and & for joining text, UPPER/LOWER/TRIM/LEN/LEFT/RIGHT/MID, CONTAINS. Quotes inside text can be escaped with \\" — a column whose separator contains a quote no longer fails to compile.' },
      { tr: 'Sütunlarınız kişiseldir ve hesabınıza kaydedilir: başka bir bilgisayardan girdiğinizde de duruyorlar. "Sütunlar" kategorisinde tutulduğu için Profil Kopyalama panelinden başka bir kullanıcıya aktarılabilirler. Sütunu silmek yalnız hesaplanan sütunu kaldırır — kaynak satır alanlarına dokunulmaz.', en: 'Your columns are personal and saved to your account, so they are there when you sign in from another computer. They live in the “Columns” category, so they can be handed to another user from the Profile Copy panel. Deleting a column removes only the calculated column — the source row fields are untouched.' },
    ],
  },
  {
    v: '7.27', date: '2026-08-26',
    title: { tr: 'Ufuk filtreleri artık DAX tarafında da alan eşlemesinden çözülüyor', en: 'Horizon filters now resolve through the field mapping on the DAX side too' },
    items: [
      { tr: 'v7.26 ile gelen Sayfa Ufku ekranı alanları ASAS başlığıyla sunuyor (MAG = "Merch Alt Grup Kod"). Veri tabanı modunda bu başlık DAX\'a OLDUĞU GİBİ yazılıyordu; modeldeki sütun başka adla duruyorsa (ör. "MAG Kodu") sorgu var olmayan bir sütuna filtre koyuyordu. Koşul sütunu artık alan eşlemesinden çözülüyor: eşlemede karşılığı varsa modeldeki gerçek tablo/sütun yazılıyor.', en: 'The Page Horizon screen added in v7.26 presents fields by their ASAS header (MAG = “Merch Alt Grup Kod”). In database mode that header was written into DAX VERBATIM; if the model column has another name (e.g. “MAG Kodu”) the query filtered on a column that does not exist. Condition columns now resolve through the field mapping: when the header has a mapping entry, the real model table/column is used.' },
      { tr: 'Eşlemede karşılığı olmayan alanlar eskisi gibi doğrudan kullanılıyor — model şemasından seçilerek kurulmuş eski ufuklar aynen çalışmaya devam ediyor. Bir başlık yanlışlıkla bir ÖLÇÜYE eşlenmişse filtreye alınmıyor (ölçü satır bağlamında filtrelenemez), alan adına düşülüyor.', en: 'Fields without a mapping entry are still used directly, so horizons built by picking columns from the model schema keep working unchanged. If a header is mapped to a MEASURE it is not used as a filter (a measure cannot be filtered in row context) and the field name is used instead.' },
      { tr: 'Aynı çözümleme sezon ve Ex-factory tarihi sütunlarında ve satır sayımı sorgusunda da uygulanıyor. Excel modu bu değişiklikten etkilenmez; orada ufuk zaten ASAS başlıklarıyla satır bazında süzülüyor.', en: 'The same resolution is applied to the season and Ex-factory date columns and to the row-count query. Excel mode is unaffected — there the horizon already filters rows by ASAS headers.' },
    ],
  },
  {
    v: '7.26', date: '2026-08-26',
    title: { tr: 'Sayfa ufku: Excel filtresi kadar basit — ve artık gerçekten süzüyor', en: 'Page horizon: as simple as an Excel filter — and it actually filters now' },
    items: [
      { tr: 'Her sayfanın kendi ufuk ekranı var: CP, Siparişler, Backlog ve LFL’de ufuk şeridine ÇİFT TIKLAYIN. Ekranda tek bir şey var — filtre satırları: [alan] [koşul] [değerler]. Sunucu, katalog, tablo ve DAX alanları burada yok; onlar Kaynak Veri ekranında kaldı.', en: 'Every page now has its own horizon screen: DOUBLE-CLICK the horizon strip on CP, Orders, Backlog and LFL. The screen shows one thing — filter rows: [field] [condition] [values]. Server, catalog, table and DAX settings are not here; they stayed on the Source Data screen.' },
      { tr: 'SESSİZ BİR HATA DÜZELTİLDİ: ufuktaki MAG / MMYG / Buying Group gibi koşullar satır süzmede hiç işletilmiyordu — yalnız sezon ve tarih işliyordu. Yani ASAS Excel modunda "MAG = CK1E" diye kurulan bir ufuk hiçbir şeyi süzmüyor, ekran her şeyi göstermeye devam ediyordu. Artık DAX tarafıyla aynı motor satır bazında da çalışıyor.', en: 'A SILENT BUG WAS FIXED: horizon conditions such as MAG / MMYG / Buying Group were never applied when filtering rows — only season and date were. So in ASAS Excel mode a horizon set to “MAG = CK1E” filtered nothing and the screen kept showing everything. The same engine as the DAX path now runs per row too.' },
      { tr: 'İki yol artık aynı önceliği uyguluyor: koşul filtresi varsa eski sezon/tarih alanları yok sayılır (veri tabanı tarafı bunu zaten böyle yapıyordu), koşul yoksa sezon ile tarih VEYA ile birleşir. Böylece aynı ufuk Excel modunda başka, veri tabanı modunda başka sonuç veremez.', en: 'Both paths now apply the same precedence: when condition filters exist the legacy season/date fields are ignored (the database side already did this), and with no conditions season and date combine with OR. The same horizon can no longer give one result in Excel mode and another in database mode.' },
      { tr: 'Değer listeleri UYDURULMAZ: bir alanın seçenekleri sizin yüklü ASAS verinizden gelir (gerçek dosyada ölçüldü — 29.923 satır, 4 MAG). Listede olmayan bir değeri elle de yazabilirsiniz. Kaydetmeden önce "6.896 / 29.923 satır bu ufka giriyor (%23)" gibi bir önizleme görürsünüz.', en: 'Value lists are never invented: a field’s options come from your loaded ASAS data (measured on the real file — 29,923 rows, 4 MAGs). You can also type a value that is not listed. Before saving you see a preview such as “6,896 / 29,923 rows are inside this horizon (23%)”.' },
      { tr: 'Ufuk ekranında ön ayar kaydetme, kullanıcıdan kopyalama ve "Bilgilerimden doldur" var. Sonuncusu kullanıcı kartınızdaki MAG / MMYG / Buying Group bilgisinden filtreyi tek tuşla kurar; üst düzey yöneticilerde çoklu seçim de desteklenir. ASAS başlık eşlemesi doğrulandı: MAG = Merch Alt Grup Kod, MMYG = Merch Marka Yaş Grup Kod, Buying Group = Buyer Grup (TR). (ASAS çıktısında "Buyer Group (EN)" sütunu yok; İngilizce başlık gelirse takma adlardan tutar.)', en: 'The horizon screen has preset saving, copy-from-user and “Fill from my profile”. The last one builds the filter in one click from the MAG / MMYG / Buying Group on your user card, with multi-select for senior managers. The ASAS header mapping was verified: MAG = Merch Alt Grup Kod, MMYG = Merch Marka Yaş Grup Kod, Buying Group = Buyer Grup (TR). (There is no “Buyer Group (EN)” column in the ASAS export; an English header would still match through aliases.)' },
      { tr: 'Model bağlantısı tanımlı olmayan kurulumlarda da ufuk kaydedilebiliyor ve uygulanıyor. Önceden kaydetmek bağlantıya bağlıydı ve bağlantısız (Excel) kurulumda kişisel ufuk hiç uygulanmıyordu.', en: 'A horizon can now be saved and applied even when no model connection is defined. Previously saving required a connection, and in a connection-less (Excel) setup a personal horizon was never applied at all.' },
      { tr: 'CP ve Siparişler’deki "Temel Filtreler" artık "Sayfa Filtreleri" ve KULLANILABİLİR. Panel tablonun arkasında açılıyordu: ölçümde panel açılıyor ama tam ortasındaki noktada en üstteki öğe sayfa içeriğiydi. Sebep, filtre şeridinin kırpma kutusu ve yığınlama bağlamıydı; panel artık görüntü penceresine sabitlenip her zaman önde açılıyor. Fareyle üzerinden geçince değil, tıklayınca açılıyor.', en: 'On CP and Orders “Basic Filters” is now “Page Filters” — and usable. The panel opened behind the table: measured, it did open but the topmost element at its centre was the page content. The cause was the filter strip’s clipping box and stacking context; the panel is now pinned to the viewport and always opens in front. It opens on click rather than on hover.' },
      { tr: 'Field Mapping ekranı kaldırıldı. Eşleme verisi duruyor ve gerekli (veri tabanı modunda DAX hangi sütunun "Sipariş Kod" olduğunu bilmeli) ama elle kurmaya gerek yok: eşleme model şemasından kendiliğinden kuruluyor ve bozulmuşsa onarılıyor; zorunlu bir alan gerçekten bulunamazsa Yenile eksik alanları adıyla söyleyip duruyor. Mevcut sütun/tablo eşlemeleri ve ASAS’tan elle sütun ekleme yolu aynen korundu.', en: 'The Field Mapping screen was removed. The mapping data remains and is needed (in database mode DAX must know which column is “Sipariş Kod”), but setting it by hand is not: it is built automatically from the model schema and repaired when broken; if a required field genuinely cannot be found, Refresh stops and names the missing fields. Existing column/table mappings and manual column addition from ASAS are untouched.' },
      { tr: 'Küçük düzenlemeler: "Güncelleme geçmişi" artık Bildirimler penceresinin içinde; Yenile menüsünde her sayfanın son güncellenme zamanı ve saati yazıyor; Kaynak Veri şeridindeki yenileme düğmeleri ve başlıktaki "Uygulamada Ara" kutusu kaldırıldı.', en: 'Smaller changes: “Update history” now lives inside the Notifications window; the Refresh menu shows each page’s last update time and clock; the refresh buttons on the Source Data strip and the “Search All” box in the header were removed.' },
    ],
  },
  {
    v: '7.25', date: '2026-08-26',
    title: { tr: 'Kullanıcı ayarlarında eksik MAG/MMYG/Buying Group, Moderatörün yöneticisi ve giriş ekranında tıklanamayan öneri', en: 'Missing MAG/MMYG/Buying Group in user settings, a manager for the Moderator, and the unclickable sign-in suggestion' },
    items: [
      { tr: 'Kullanıcı kartlarındaki MAG, MMYG ve Buying Group listeleri ASAS\'ın tamamını göstermiyordu. Sebep: bu listeler yetki haritasından türetiliyordu ve o harita bilerek dardır — yalnız sayısal sipariş kodu olan, adedi sıfırdan büyük ve "Buyer Grup ≠ YARDIM" olan satırları içerir; veri tabanı modunda ayrıca Moderatörün ufkuyla sınırlıdır. Adedi sıfırlanmış ya da ufuk dışında kalan bir Buying Group listede hiç görünmüyordu.', en: 'The MAG, MMYG and Buying Group lists on user cards did not show all of ASAS. The reason: they were derived from the authorization map, which is deliberately narrow — only rows with a numeric order code, a quantity above zero and “Buyer Group ≠ YARDIM”; in database mode it is also limited to the Moderator’s horizon. A Buying Group whose quantities were zeroed, or which fell outside the horizon, never appeared.' },
      { tr: 'Seçim listeleri artık AYRI ve BİRİKİMLİ bir katalogdan geliyor: sipariş kodu şartı yok ve bir kez görülen değer sonraki dar bir yenilemede listeden düşmüyor. Yetki haritasına dokunulmadı — yetki kararları hâlâ yalnız Moderatörün son ASAS anlık görüntüsünden çıkıyor.', en: 'The pickers now come from a separate, accumulating catalog: no order-code requirement, and a value seen once does not drop out on a later, narrower refresh. The authorization map is untouched — access decisions still come only from the Moderator’s last ASAS snapshot.' },
      { tr: 'Emniyet supabı: MAG ve MMYG alanlarına artık listede olmayan bir değer elle de yazılabiliyor, Buying Group için "elle ekle" kutusu var. MAG değiştiğinde yazılmış MMYG değeri artık silinmiyor — eskiden liste eşleşmediğinde sessizce boşaltılıyordu.', en: 'A safety valve: MAG and MMYG now accept a typed value that is not in the list, and Buying Group has an “add manually” box. Changing MAG no longer erases a typed MMYG — previously it was silently cleared when the lists did not match.' },
      { tr: 'Moderatör hesabının da yöneticisi olabiliyor. Önceden atansa bile her kayıtta siliniyordu. Hesabın korunan yanları yerinde: silinemez, rolü ve aktifliği sabittir; döngü koruması da duruyor — kimse kendi astına bağlanamaz. Yöneticisiz kalabilen tek hesap türü Moderatör olduğu için bir Moderatöre ancak başka bir Moderatör yönetici olabilir; liste boşsa arayüz bunun sebebini yazıyor.', en: 'The Moderator account can now have a manager. Previously it was cleared on every save even if assigned. The account’s protections stay: it cannot be deleted and its role and active status are fixed; cycle protection remains — nobody can report to their own subordinate. Since Moderator is the only account type that may exist without a manager, a Moderator can only report to another Moderator; when the list is empty the interface says why.' },
      { tr: 'Giriş ekranında bir öneriye tıklamak çoğu zaman işe yaramıyordu. Sebep: fare öneri üzerine geldiğinde liste bütünüyle yeniden çiziliyordu ve imleç ÖNERİ ÜZERİNDE DURURKEN bile bu kendini besleyen bir döngü kuruyordu — ölçümde imleç hiç kıpırdamadan 1,5 saniyede 92 yeniden çizim. Tıklamanın dayandığı düğme saniyede onlarca kez siliniyordu. Artık üzerine gelmek yalnız vurguyu değiştiriyor; ölçüm 92 → 0.', en: 'On the sign-in screen, clicking a suggestion usually did nothing. The reason: hovering redrew the entire list, and even with the pointer RESTING on a suggestion this became a self-feeding loop — 92 redraws in 1.5 seconds without the pointer moving. The button the click relied on was being destroyed dozens of times a second. Hovering now only changes the highlight; measured 92 → 0.' },
      { tr: 'Ayrıca: kullanıcı adı tanımlı olmayan bir öneri seçildiğinde yazdığınız metin artık silinmiyor, sebebi yazılıyor. Sipariş kodu boş olan ASAS satırları yetki haritasında "0" numaralı sahte bir sipariş açmıyor.', en: 'Also: selecting a suggestion with no user name no longer erases what you typed — the reason is shown instead. ASAS rows with an empty order code no longer create a bogus order “0” in the authorization map.' },
    ],
  },
  {
    v: '7.24', date: '2026-08-26',
    title: { tr: 'Koleksiyon paylaşımı ağ kesintisinden kendi kendine dönüyor', en: 'Collection sharing recovers on its own after a network outage' },
    items: [
      { tr: 'Koleksiyon açılırken "paylaşım başlatılamadı … Failed to fetch" hatası alındığında sayfa o oturum boyunca salt-okunur kalıyordu; paylaşıma dönmenin tek yolu programı kapatıp açmaktı. "Failed to fetch" bir sunucu cevabı değildir — istek hiç tamamlanmamıştır; sebebi genellikle sunucunun o an yeniden başlıyor olmasıdır.', en: 'When Collection failed to start sharing with “… Failed to fetch”, the page stayed read-only for the rest of the session and the only way back was restarting the program. “Failed to fetch” is not a server answer — the request never completed, usually because the server was restarting at that moment.' },
      { tr: 'Artık ağ düzeyindeki hata üç kez, artan beklemeyle yeniden deneniyor. Denemeler tükenirse sayfa yine yerel veriyle açılıyor ama sunucu geri geldiği anda paylaşım kendiliğinden kuruluyor; kullanıcı hiçbir şey yapmıyor.', en: 'A network-level failure is now retried three times with increasing delay. If the retries run out the page still opens with local data, but sharing is restored by itself the moment the server comes back — with no action from the user.' },
      { tr: 'Yetki veya sunucu hataları (401/403/500) yeniden DENENMİYOR: onlar birer cevaptır ve olduğu gibi bildiriliyor. Uyarı metni de artık sebebi söylüyor — sunucuya ulaşılamadıysa bunu yazıyor.', en: 'Authorization and server errors (401/403/500) are NOT retried: those are answers and are reported as they are. The warning now also states the cause — if the server could not be reached, it says so.' },
      { tr: 'Sunucu çökmesi durumunda ayrıntı %LOCALAPPDATA%\\BuyerLog\\logs\\server-error.log dosyasına yazılmaya devam ediyor; hata tekrarlarsa bu dosya sebebi gösterir.', en: 'If the server crashes, the detail is still written to %LOCALAPPDATA%\\BuyerLog\\logs\\server-error.log; if the error repeats, that file shows the cause.' },
    ],
  },
  {
    v: '7.23', date: '2026-08-26',
    title: { tr: 'OAB yeniden deneme, çoklu pivot filtresi ve kullanıcıya özgü ekranlar', en: 'OAB retry, multi-select pivot filters and user-specific screens' },
    items: [
      { tr: 'OAB toplu çekmede bir kombinasyon alınamadığında uyarı şeridi artık tıklanabilir: hangi kombinasyonun hangi hatayla düştüğü kodu ve mesajıyla açılıyor. Aynı pencereden "Yeniden dene" YALNIZ başarısız kombinasyonları çekiyor ve mevcut raporun üzerine ekliyor — baştan tam çekim yapılmıyor, eldeki veri kaybolmuyor.', en: 'When a combination fails during an OAB batch fetch, the warning strip is now clickable: it opens which combination failed with its code and message. From the same window “Retry” fetches ONLY the failed combinations and adds them to the current report — no full re-fetch, nothing already fetched is lost.' },
      { tr: 'Yeniden deneme sonucu artık kalıcı snapshot\'ı ezmiyor. Bu düzeltilmeseydi 9 kombinasyonu başarıyla çekip 1\'ini yeniden denedikten sonra program kapatılıp açıldığında elde yalnız 1 kombinasyon kalacaktı.', en: 'A retry no longer overwrites the stored snapshot. Without this fix, after fetching 9 combinations and retrying 1, reopening the program would have left only that 1 combination.' },
      { tr: 'v7.20\'den kalan sessiz bir kayıp giderildi: çoklu seçimle çekilen raporun seçimi snapshot\'a boş yazılıyordu, bu yüzden program yeniden açıldığında son OAB raporu hiç geri yüklenemiyordu.', en: 'A silent loss left over from v7.20 was fixed: the selection of a multi-select report was written empty into the snapshot, so the last OAB report could never be restored on reopening.' },
      { tr: 'OAB pivotundaki yerel filtreler (Klasman Tanımı, Line Tanımı, Fit, Persona ve diğerleri) artık çoklu seçim. Üst filtrelerdeki arama/tümü/hiçbiri bileşeninin aynısı kullanılıyor ve seçim PASS\'e yeni istek atmadan uygulanıyor.', en: 'Local filters in the OAB pivot (Klasman Tanımı, Line Tanımı, Fit, Persona and the rest) are now multi-select. They use the same search / all / none component as the top filters and apply without any new request to PASS.' },
      { tr: 'Nakliye kıyaslaması kullanıcıya özgü hâle geldi: her kullanıcı yalnız kendi satırlarını görüyor, biri satır silince başkasının ekranı etkilenmiyor. Önceki sürümlerden kalan ortak satırlar kaybolmuyor — sahibi bilinmediği için uydurma sahip atanmıyor; kullanıcı ilk kez yazana kadar eski satırları görmeye devam ediyor, ilk yazmada kendi kopyasına devralıyor.', en: 'Shipping comparison is now user-specific: each user sees only their own rows, and one user’s deletion no longer affects another’s screen. Rows left over from earlier versions are not lost — no owner is invented for them; each user keeps seeing them until their first write, which adopts them into their own copy.' },
      { tr: 'Kullanıcı kartlarına Buying Group alanı eklendi. Bir kullanıcı birden çok Buying Group\'tan sorumlu olabiliyor ve liste, seçilen MAG/MMYG\'de gerçekten var olan gruplarla sınırlanıyor; kayıtlı bir grup listede kalmasa bile sessizce düşürülmüyor.', en: 'A Buying Group field was added to user cards. A user can be responsible for several Buying Groups, and the list is limited to the groups that actually exist for the selected MAG/MMYG; an already-saved group is never dropped silently even if it leaves the list.' },
      { tr: 'Horizon ön ayarları geldi. Bir ufuk, MAG / MMYG / Buying Group kapsamıyla birlikte ön ayar olarak kaydedilebiliyor; kişisel ufku olmayan kullanıcı CP, Orders, Backlog ve LFL ekranlarını kendi MAG/MMYG/Buying Group bilgisine uyan ön ayarla açıyor. En özel eşleşme kazanıyor (Buying Group > MMYG > MAG).', en: 'Horizon presets were added. A horizon can be saved as a preset together with a MAG / MMYG / Buying Group scope; a user without a personal horizon opens CP, Orders, Backlog and LFL with the preset matching their own MAG/MMYG/Buying Group. The most specific match wins (Buying Group > MMYG > MAG).' },
      { tr: 'Ön ayar kişisel ufku EZMİYOR: kullanıcı kendi ufkunu bir kez seçtiyse sonradan tanımlanan bir ön ayar onun ekranını değiştiremiyor. Moderatör ve Yöneticiler kullanıcılar panelindeki yeni Horizon sekmesinden bir kullanıcıya ön ayar uygulayabiliyor veya kişisel ufkunu sıfırlayıp ön tanıma döndürebiliyor; yönetici yalnız kendi ekibindeki kullanıcıyı ayarlayabiliyor.', en: 'A preset never overrides a personal horizon: once a user has chosen their own, a preset defined later cannot change their screen. Moderators and Managers can apply a preset to a user — or reset their personal horizon back to the preset — from the new Horizon tab in the users panel; a manager can only do this for their own team.' },
    ],
  },
  {
    v: '7.22', date: '2026-08-26',
    title: { tr: 'Koleksiyon: aynı sayfada çalışan kullanıcılar artık birbirinin verisini kaybettirmiyor', en: 'Collection: users on the same page no longer lose each other’s data' },
    items: [
      { tr: 'Revizyon kontrolü bütün sayfa bazındaydı: bir kullanıcı 1. satırı, başka bir kullanıcı 900. satırı düzenlediğinde — aralarında hiçbir çakışma olmamasına rağmen — ikincisinin kaydı reddediliyor ve girişi atılıyordu. Kontrol artık satır bazında. Aynı testte iki kullanıcının da girişi korunuyor.', en: 'Revision checking was page-wide: when one user edited row 1 and another edited row 900 — with no conflict between them — the second save was rejected and that entry was discarded. Checking is now per row. In the same test both users’ entries are kept.' },
      { tr: '100 kullanıcı aynı Koleksiyon sayfasında farklı satırlara aynı anda yazdığında 100 girişin 100’ü de diske işleniyor, hiçbiri kaybolmuyor.', en: 'With 100 users writing to different rows of the same Collection page at once, all 100 entries reach disk and none are lost.' },
      { tr: 'Bir hücre değişikliğinde artık sayfanın tamamı değil yalnız değişen satır gönderiliyor. 1.000 satırlık bir sayfada gönderilen veri 59,4 KB’tan 0,81 KB’a indi.', en: 'A cell change now sends only the changed row instead of the whole page. On a 1,000-row page the payload dropped from 59.4 KB to 0.81 KB.' },
      { tr: 'Gerçekten aynı satıra iki kişi yazdığında ikincisi ne sessizce eziyor ne de sessizce atılıyor: hangi satırın kaydedilemediği adıyla bildiriliyor ve sunucudaki güncel değer ekrana yansıtılıyor.', en: 'When two people genuinely write to the same row, the second neither silently overwrites nor is silently dropped: the row that could not be saved is named and the server’s current value is shown on screen.' },
      { tr: 'Silme işlemi satırın yokluğundan çıkarılmıyor, açık bir kayıt olarak taşınıyor; ayrıca silinecek satırı bu arada başkası düzenlediyse silme sessizce uygulanmıyor.', en: 'Deletion is not inferred from a row’s absence but carried as an explicit record; and if someone else edited the row in the meantime, the deletion is not applied silently.' },
      { tr: 'Sütun düzeni, üretici listesi ve satır sırası satıra ait olmadığı için hâlâ sayfa revizyonuyla kilitleniyor. Sıralama gönderilirken listelenmeyen satırlar düşürülmüyor, sona ekleniyor.', en: 'Column layout, the manufacturer list and row order do not belong to a row, so they are still locked with the page revision. When a new order is sent, rows missing from that list are appended rather than dropped.' },
      { tr: 'Önceki sürümlerden kalan Koleksiyon dosyaları veri kaybı olmadan yükseltiliyor; Excel ve PLM içe aktarma gibi sayfanın tamamını değiştiren akışlar eski yoldan çalışmaya devam ediyor.', en: 'Collection files from earlier versions are upgraded without data loss, and flows that replace the whole page — such as Excel and PLM import — keep using the previous path.' },
    ],
  },
  {
    v: '7.21', date: '2026-08-26',
    title: { tr: 'Koleksiyon: bir kullanıcının kaydı artık kimseyi bekletmiyor', en: 'Collection: one user’s save no longer holds anyone up' },
    items: [
      { tr: 'Koleksiyon sayfasında bir ekip arkadaşı kayıt yaptığında, aynı sayfayı açık tutan herkese bildirim gidiyor, ekran salt-okunur moda düşüyor ve sayfa bütünüyle yeniden yükleniyordu. Bildirim tamamen kaldırıldı, kilit kaldırıldı. Artık yalnız değişen satırlar yerinde güncelleniyor; kaydırma konumu, satır seçimi ve geri-al geçmişi olduğu gibi kalıyor.', en: 'When a teammate saved on a Collection page, everyone with that page open got a notification, the screen switched to read-only and the whole page reloaded. The notification is gone and the lock is gone. Only the changed rows are updated in place; scroll position, row selection and undo history are kept.' },
      { tr: 'Asıl darboğaz kaydetmenin kendisiydi. Kaydetme sunucunun olay döngüsünü bloke ediyordu: 50.000 satırlık bir sayfada 307 milisaniye boyunca sunucu HİÇBİR isteğe yanıt vermiyordu — CP’ye de, Overview’a da, diğer kullanıcılara da. Yani tek bir kullanıcının kaydı bütün ekibi durduruyordu. Kaydetme artık ayrı bir iş parçacığında yürüyor; aynı ölçümde ana iş parçacığının bloke kaldığı süre 43 milisaniyeye indi.', en: 'The real bottleneck was the save itself. It blocked the server’s event loop: on a 50,000-row page the server answered NO request for 307 milliseconds — not CP, not Overview, not other users. One user’s save stopped the whole team. Saving now runs on a separate thread; in the same measurement main-thread blocking dropped to 43 milliseconds.' },
      { tr: 'Gövde artık ana iş parçacığında ayrıştırılmıyor ve kaydetme yanıtı küçültüldü. Önceden her kayıtta 18 MB’lık sayfa geri gönderiliyordu; istemci bundan yalnız yeni revizyon numarasını kullanıyordu.', en: 'The request body is no longer parsed on the main thread and the save response was made small. Previously every save sent the 18 MB page back; the client only used the new revision number from it.' },
      { tr: 'Farklı Koleksiyon sayfalarına yazan kullanıcılar birbirini beklemiyor. Aynı sayfaya art arda gelen yazmalar ise sıraya alınıyor, böylece dosya kilidi yarışından kaynaklanan “başka bir Buyer Log örneği güncelliyor” hatası oluşmuyor.', en: 'Users writing to different Collection pages no longer wait for each other. Writes to the same page are queued instead, so the “another Buyer Log instance is updating” error caused by a file-lock race no longer occurs.' },
      { tr: 'Değişen satır kısa süre yumuşak bir zeminle beliriyor: ekip arkadaşının girişi görünür kalıyor ama işi bölmüyor. O satırı siz düzenliyorsanız değişiklik ezilmiyor, düzenlemeniz bitince uygulanıyor. Kapsamınız dışındaki bir Koleksiyon sayfasının satırları ekranınıza hiç gönderilmiyor.', en: 'A changed row briefly lights up, so a teammate’s entry stays visible without interrupting your work. If you are editing that row your entry is not overwritten; the change applies when you finish. Rows from a Collection page outside your access are never sent to your screen.' },
      { tr: 'Not: satır bazlı KAYDETME ve satır bazlı revizyon bu sürümün dışında bırakıldı. Aynı sayfayı aynı anda düzenleyen iki kullanıcıdan birinin yazmasının reddedilmesi durumu bir sonraki sürümde ele alınacak.', en: 'Note: row-level SAVING and row-level revisions are not in this release. The case where one of two users editing the same page at the same time has their write rejected will be addressed in the next release.' },
    ],
  },
  {
    v: '7.20', date: '2026-08-26',
    title: { tr: 'OAB filtreleri çoklu seçim: tek raporda birden çok Season, MAG ve Buyer Group', en: 'OAB filters are multi-select: many Seasons, MAGs and Buyer Groups in one report' },
    items: [
      { tr: 'OAB sitesi Season, MAG ve Buyer Group filtrelerini tek seçime kapatıyor. Buyer Log artık üçünde de çoklu seçim yaptırıyor, seçilen kombinasyonların tamamını arka planda OAB\'dan çekiyor ve tek raporda birleştiriyor. Satırlar Sezon / Merch Alt Grup / Buyer Grup Tanımı bilgisini zaten taşıdığı için kırılım pivotta korunuyor.', en: 'The OAB site restricts Season, MAG and Buyer Group to a single choice each. Buyer Log now allows multi-select on all three, fetches every selected combination from OAB in the background and merges them into one report. Rows already carry Season / Merch Sub Group / Buyer Group, so the breakdown is preserved in the pivot.' },
      { tr: 'Seçim yapıldıkça kaç kombinasyon, kaç OAB isteği ve tahminen ne kadar süreceği yazıyor. Bu bilgi sunucudaki gerçek plandan geliyor; ekranda görünen sayı ile gerçekte çekilen sayı ayrışamaz. Uzun sürecek işler (3 dakikayı aşanlar) başlamadan önce onay istiyor.', en: 'As you select, the bar shows how many combinations, how many OAB requests and roughly how long it will take. That comes from the real server-side plan, so the number shown can never diverge from the number fetched. Jobs longer than three minutes ask for confirmation before starting.' },
      { tr: 'İşlem arka planda yürüyor: ilerleme çubuğu var, istediğiniz an iptal edebiliyorsunuz ve iptal ettiğinizde o ana kadar çekilen veriler korunuyor. Bir kombinasyon alınamazsa iş çöpe gitmiyor; başarısız olan adıyla bildiriliyor, başarılı olanlar rapora giriyor.', en: 'The job runs in the background with a progress bar and can be cancelled at any time; everything fetched up to that point is kept. If one combination fails the job is not discarded — the failure is reported by name and the successful ones still make it into the report.' },
      { tr: 'Seçtiğiniz kombinasyonların bir kısmı OAB\'da karşılıksız olabilir (bir MAG her sezonda, bir Buyer Group her MAG\'da bulunmayabilir). Bunlar sessizce atlanmıyor; kaç tane olduğu yazılıyor ve tıklayınca sebebiyle birlikte listeleniyor.', en: 'Some of the combinations you pick may not exist in OAB (a MAG may not be in every season, a Buyer Group not in every MAG). These are not skipped silently — the count is shown and clicking it lists them with the reason.' },
      { tr: 'PASS rapor parametresi Buyer Group için çoğul. Buyer Log bunu bir kez deneyip DÖNEN SATIRLARDAN doğruluyor: gerçekten çok gruplu geldiyse tek istekle çalışıyor ve bunu hatırlıyor, gelmediyse sessizce kombinasyon başına isteğe düşüyor. Bu sayede doğrulanırsa 41 Buyer Group\'luk bir seçim 41 istek yerine 1 istek oluyor.', en: 'The PASS report parameter for Buyer Group is plural. Buyer Log tries it once and verifies it FROM THE RETURNED ROWS: if the response really covers several groups it uses a single request and remembers that, otherwise it quietly falls back to one request per combination. Where it verifies, a 41-Buyer-Group selection becomes 1 request instead of 41.' },
      { tr: 'Tek kombinasyon seçildiğinde eski yol aynen çalışıyor: aynı önbellek, aynı davranış, aynı hata mesajları.', en: 'When a single combination is selected the previous path is used unchanged: same cache, same behaviour, same error messages.' },
    ],
  },
  {
    v: '7.19', date: '2026-08-26',
    title: { tr: 'Bir kullanıcının veri girişi artık diğer ekranları kilitlemiyor', en: 'One user’s data entry no longer locks everyone else’s screen' },
    items: [
      { tr: 'Bir ekip arkadaşı bir hücreyi kaydettiğinde, açık olan diğer bütün oturumlar tam bir kaynak yenilemesi başlatıyordu: ASAS ve Antrepo yeniden sorgulanıyor, karşılaştırma koşuyor, ekran "Veriler yenileniyor — düzenleme duraklatıldı" durumuna geçiyordu. Oysa bir hücre düzenlemesi ASAS ya da Antrepo verisini hiç değiştirmez.', en: 'When a teammate saved a cell, every other open session started a full source refresh: ASAS and the warehouse file were re-queried, comparison ran, and the screen switched to "Refreshing data — editing is paused". A cell edit never changes ASAS or warehouse data.' },
      { tr: 'Canlı olay artık "bir şey değişti" demiyor, değişikliğin kendisini taşıyor. Her ekran yalnız ilgili satırları yerinde güncelliyor: kaynak sorgusu yok, kilit yok, kaydırma konumu, satır seçimi ve geri-al geçmişi olduğu gibi kalıyor. 10.864 satırlık gerçek CP verisinde bir değişikliğin uygulanması 1 milisaniye sürüyor.', en: 'The live event no longer says "something changed" — it carries the change itself. Each screen updates only the affected rows in place: no source query, no lock, and scroll position, row selection and undo history are kept. On real CP data of 10,864 rows, applying a change takes 1 millisecond.' },
      { tr: 'Değişen satır kısa süre yumuşak bir zeminle beliriyor, böylece ekip arkadaşının girişi görünür oluyor ama işi bölmüyor. O sırada siz o satırı düzenliyorsanız değişiklik ezilmiyor; düzenlemeniz bitince uygulanıyor.', en: 'A changed row briefly lights up so a teammate’s entry is visible without interrupting your work. If you are editing that row at the time, your entry is not overwritten; the change is applied when you finish.' },
      { tr: 'Kapsamınız dışındaki bir siparişin alan değerleri (fiyat, not, revize tarih) artık ekranınıza hiç gönderilmiyor; canlı yayın her kullanıcı için ayrı ayrı yetkisine göre süzülüyor.', en: 'Field values of an order outside your data scope (price, notes, revised dates) are no longer sent to your screen at all; the live stream is filtered per user against their own authorization.' },
      { tr: 'Aynı düzenleme için ikinci bir yeniden yükleme tetikleyen yedek yol, canlı akış çalışırken devre dışı bırakıldı.', en: 'The fallback path that triggered a second reload for the same edit is now disabled while the live stream is running.' },
      { tr: 'Değişikliğin karşı ekrana ulaşma beklemesi 2,5 saniyeden 0,8 saniyeye indirildi. Bu bekleme, her olayın karşı tarafta tam yenileme başlattığı dönemde pahalı işi seyreltmek içindi; artık gereksiz. Art arda kaydedilen hücreler hâlâ tek bildirimde birleşiyor.', en: 'The wait before a change reaches other screens was cut from 2.5 seconds to 0.8. That delay existed to thin out expensive work back when every event triggered a full refresh on the other side; it is no longer needed. Cells saved in quick succession are still merged into a single notification.' },
    ],
  },
  {
    v: '7.18', date: '2026-08-26',
    title: { tr: 'Program açılışında otomatik yenileme yapılmıyor', en: 'No automatic refresh when the program opens' },
    items: [
      { tr: 'Program açıkken hazırlanan daha yeni veri, önceden olduğu gibi arka planda sessizce uygulanmaya devam eder; bu davranış bilerek korundu.', en: 'Newer data prepared while the program is already open still applies quietly in the background as before; that behaviour was deliberately kept.' },
      { tr: 'Aynı veri kuşağı için otomatik uygulama artık yalnız bir kez denenir. Uygulama herhangi bir sebeple ilerlemezse eskiden kendini besleyen bir istek döngüsü oluşabiliyordu.', en: 'Automatic application is now attempted only once per data generation. If the application did not advance for any reason, a self-feeding request loop could previously build up.' },
      { tr: 'Giriş ekranının önbellek etiketi sürümün gerisinde kalmıştı; yükseltmeden sonra tarayıcı eski giriş stilini kullanmaya devam ediyordu. Etiket artık ana ekranla birlikte ilerliyor.', en: 'The sign-in screen cache tag had fallen behind the version, so browsers kept using the old sign-in stylesheet after an upgrade. The tag now moves with the main screen.' },
    ],
  },
  {
    v: '7.17', date: '2026-08-26',
    title: { tr: 'Yenilemedeki page cache aşaması hızlandırıldı', en: 'Refresh page cache stage made fast' },
    items: [
      { tr: 'Yenilemenin son aşaması olan page cache, 1.155 satırlık bir turda 28 saniye sürüyordu. Sebep, her satır için düzenleme yetkisinin baştan hesaplanmasıydı; her hesap alt kullanıcı ağacını yürüyüp izin kümesini yeniden kuruyordu. Karar artık kullanıcı için bir kez, sonra sipariş kodu başına bir kez alınır.', en: 'The page cache stage that ends a refresh took 28 seconds on a run of 1,155 rows. Edit permission was recomputed for every row, and each computation walked the reporting tree and rebuilt the permission set. The decision is now made once per user and then once per order code.' },
      { tr: 'Yetki hesabında alt kullanıcı listesi her adımda yeniden kuruluyordu; yönetici-çocuk haritası tek seferde kurulacak şekilde düzeltildi. Rol tanımları da her kullanıcı için baştan üretilmiyor.', en: 'The permission calculation rebuilt the full profile list at every step; a manager-to-reports map is now built once. Role definitions are also no longer rebuilt for every user.' },
      { tr: 'Bu hesap her HTTP isteğinin yetki kontrolünde de kullanıldığı için genel arayüz tepkisi de iyileşir.', en: 'The same calculation runs in the permission check of every HTTP request, so overall interface responsiveness improves as well.' },
    ],
  },
  {
    v: '7.16', date: '2026-08-26',
    title: { tr: 'Yenileme karşılaştırma aşaması hızlandırıldı', en: 'Refresh comparison stage made fast' },
    items: [
      { tr: 'Yenilemenin "Comparison" aşaması dakikalarca sürebiliyordu. Antrepo satırlarını eşleştiren kod, her satırın imzasını defalarca üretiyor ve her üretimde 33 alanı yeniden kurulan bir karşılaştırıcıyla sıralıyordu. İmza satır başına bir kez üretiliyor ve karşılaştırıcı bir kez kuruluyor; gerçek veride bu aşama 7.000 ms yerine 400 ms sürüyor.', en: 'The refresh Comparison stage could take minutes. The code pairing warehouse rows rebuilt each row signature repeatedly, sorting 33 fields with a comparator rebuilt on every comparison. Signatures are now derived once per row and the comparator is built once; on real data the stage takes 400 ms instead of 7,000 ms.' },
      { tr: 'Aynı sipariş, model ve renk altındaki çok sayıda parsiyel tek kovaya düştüğünde eşleştirme maliyeti satır sayısının küpüyle artıyordu: tek kovada 240 parsiyel 43 saniye sürüyordu, artık 116 milisaniye. Karşılaştırma sonuçları birebir aynı kalır.', en: 'When many partial shipments under the same order, model and colour fell into one bucket, pairing cost grew with the cube of the row count: 240 partials in one bucket took 43 seconds and now take 116 milliseconds. Comparison results stay byte-identical.' },
      { tr: 'Değişmemiş satır çiftleri için artık pahalı detay nesnesi kurulmuyor; gerçek yenilemelerde çiftlerin neredeyse tamamı değişmemiş oluyor.', en: 'Unchanged row pairs no longer build the expensive detail object; in real refreshes almost every pair is unchanged.' },
    ],
  },
  {
    v: '7.15', date: '2026-08-26',
    title: { tr: 'Paylaşılan veri değişiminde hafif yeniden yükleme', en: 'Lean reload when shared data changes' },
    items: [
      { tr: 'Ayar kaydı, Excel yükleme ve bir ekip arkadaşının değişikliği sonrasında uygulama tam veri yanıtını çekiyordu. Gerçek ASAS verisinde bu yanıt 102 MB JSON ve tarayıcıda 9,5 saniyeydi; artık açılıştaki hafif yanıt kullanılıp yalnız açık olan ekran hazır önbellekten yükleniyor (0,8 saniye).', en: 'After a settings save, an Excel upload or a teammate change the app fetched the full data response. With real ASAS data that response was 102 MB of JSON and 9.5 seconds in the browser; it now uses the lean startup response and loads only the open screen from the ready cache (0.8 seconds).' },
      { tr: 'Bir kullanıcının CP termin düzenlemesi, açık olan diğer bütün oturumlarda tam yeniden yükleme tetikliyordu. Çok kullanıcılı kullanımda sunucu ve ağ yükü bu yolda yaklaşık on kat azaldı.', en: 'One user editing a CP date triggered a full reload in every other open session. On this path the server and network cost in multi-user use dropped roughly tenfold.' },
    ],
  },
  {
    v: '7.12', date: '2026-08-25',
    title: { tr: 'Koleksiyon paylaşımlı görüntüleme modunda büyük görsel önizlemesi', en: 'Large image preview in shared Collection view mode' },
    items: [
      { tr: 'Başka bir kullanıcının Koleksiyon workspace’i Görüntüleme modunda açıldığında model görsellerinin pointer event’lerini kapatan kural kaldırıldı; hover ile büyük görsel önizlemesi artık Edit ve View modlarında aynı şekilde çalışır.', en: 'When another user’s Collection workspace is opened in View mode, the rule that disabled pointer events on model images was removed; large hover preview now works identically in both Edit and View modes.' },
      { tr: 'Salt-okunur güvenlik korunur: View modunda tek tık görsel yapıştırma hedefi seçme, çift tık dosya değiştirme ve sağ tık silme/PLM’den çağırma aksiyonları bağlanmaz.', en: 'Read-only safety is preserved: in View mode, single-click paste-target selection, double-click image replacement, and right-click delete/fetch-from-PLM actions are not bound.' },
    ],
  },
  {
    v: '7.11', date: '2026-08-25',
    title: { tr: 'Outlook önizleme temizliği ve mail aksiyon düzeltmeleri', en: 'Outlook preview cleanup and email action fixes' },
    items: [
      { tr: 'Outlook sonuç kartlarındaki önizleme metni e-posta adresleri, mailto parçaları, quoted From/Sent/To/Cc/Subject blokları, yaygın imza kapanışları ve kurumsal disclaimer metinlerinden temizlenir.', en: 'Outlook result-card previews now remove email addresses, mailto fragments, quoted From/Sent/To/Cc/Subject blocks, common signature closings and corporate disclaimer text.' },
      { tr: 'Sipariş bağlamının ilişkilendirme kimliği artık dahili satır id yerine gerçek Order/PO kodunu önceliklendirir; Detay ve Gelişmeyi İncele salt-okunur sipariş erişiminde de çalışır.', en: 'Order context linking now prioritizes the actual Order/PO code over an internal row id; Detail and Review Development also work with read-only order access.' },
      { tr: 'Classic Outlook’ta Aç işlemi EntryID çözümlemesini tüm store’larda yeniden deneyebilir ve doğrudan açma başarısızsa InternetMessageId/Subject üzerinden kontrollü fallback araması yapar.', en: 'Open in Classic Outlook now retries EntryID resolution across mounted stores and uses a controlled InternetMessageId/Subject search fallback when direct opening fails.' },
    ],
  },
  {
    v: '7.10', date: '2026-08-25',
    title: { tr: 'Outlook ayar ekranı ve manuel anahtar kelime araması', en: 'Outlook settings screen and manual keyword search' },
    items: [
      { tr: 'Outlook mail drawer içindeki Ayarlar düğmesinin boş ekran oluşturmasına yol açabilecek gereksiz V2 mailbox discovery bağımlılığı kaldırıldı; ayar ekranı artık yalnız bağlantı durumunu yükler ve hata durumunda da görünür açıklama/yeniden dene ekranı gösterir.', en: 'The unnecessary V2 mailbox-discovery dependency that could leave the Outlook Settings view blank was removed; Settings now loads only connection status and always shows a visible error/retry state if loading fails.' },
      { tr: 'Ayar ekranından sipariş mail aramasına geri dönme eklendi ve drawer görünümü değiştirildiğinde scroll konumu güvenli biçimde başa alınır.', en: 'A Back to Search action was added to Outlook Settings, and drawer scroll is safely reset when switching views.' },
      { tr: 'Sipariş mail aramasına her zaman görünür Manuel kelime ekle alanı eklendi. Kullanıcı RFID, approval, strike off, termin, price veya shipment gibi ifadeleri sipariş/PLM/model kriterlerine ekleyebilir.', en: 'A permanently visible Add manual keywords field was added to order-email search. Users can add terms such as RFID, approval, strike off, delivery, price or shipment alongside order/PLM/model criteria.' },
      { tr: 'Virgül, noktalı virgül veya yeni satırla ayrılan birden fazla manuel ifade daraltma kriteri olarak birlikte uygulanır; Classic Outlook Local ve gelecekteki Microsoft Graph sorguları aynı davranışı kullanır.', en: 'Multiple manual phrases separated by commas, semicolons or new lines are applied together as narrowing criteria; Classic Outlook Local and future Microsoft Graph searches use the same behavior.' },
    ],
  },
  {
    v: '7.09', date: '2026-08-25',
    title: { tr: 'Koleksiyon kapsam alanı tasarım ve dil uyumu', en: 'Collection scope area redesign and language support' },
    items: [
      { tr: 'Collection sayfasındaki üst kapsam alanı tasarım sistemiyle uyumlu iki katmanlı yeni bir düzene geçirildi: Görünüm seçimi bir segmented control, Buyer Workspace / MMYG / MAG / Buying Group / Buyer seçimleri ise ikincil filter chip yapısına dönüştürüldü.', en: 'The Collection top scope area was rebuilt into a two-level layout that matches the design system: view selection is now a segmented control, while Buyer Workspace / MMYG / MAG / Buying Group / Buyer use secondary filter chips.' },
      { tr: 'Alan yeni container, daha dengeli boşluklar, daha net active/hover/focus durumları ve dar ekranlarda taşma yapmayan wrap davranışı ile yeniden düzenlendi.', en: 'The area was refreshed with a new container, more balanced spacing, clearer active/hover/focus states and responsive wrapping that avoids overflow on narrower screens.' },
      { tr: 'Benim Kayıtlarım, Tüm Erişilebilir Kayıtlar, Görünüm, Kapsam ve kapsam popover metinleri Türkçe/İngilizce dil seçeneğine bağlandı; Collection ekranında dil değişince ilgili üst alan da anında güncellenir.', en: 'My Records, All Accessible Records, View, Scope and the scope popover texts are now wired to Turkish/English localization, and the Collection header area updates immediately when the app language changes.' },
    ],
  },
  {
    v: '7.08', date: '2026-08-25',
    title: { tr: 'Classic Outlook yerel motoru ve Graph geçiş mimarisi', en: 'Classic Outlook local engine and Graph migration architecture' },
    items: [
      { tr: 'Microsoft Graph kurulumu olmayan şirket bilgisayarlarında Classic Outlook profili yerel Outlook Object Model üzerinden salt-okunur mail arama motoru olarak kullanılabilir.', en: 'On corporate PCs without Microsoft Graph setup, the Classic Outlook profile can now be used as a read-only local email search engine through the Outlook Object Model.' },
      { tr: 'Sipariş, PLM, model, renk, üretici ve manuel anahtar kelimeler Inbox + Sent Items üzerinde taranır; sonuçlar mevcut Buyer Log Outlook drawer DTO, relevance, filtre ve conversation yapısına normalize edilir.', en: 'Order, PLM, model, colour, manufacturer and manual keywords are scanned across Inbox + Sent Items and normalized into the existing Buyer Log Outlook drawer DTO, relevance, filter and conversation model.' },
      { tr: 'Yerel COM erişimi kullanılamazsa Outlook Bridge aynı sipariş bağlamını Classic Outlook Instant Search ekranında açar; hiçbir Microsoft 365 yönetici izni gerektirmez.', en: 'If local COM access is unavailable, Outlook Bridge opens the same order context in Classic Outlook Instant Search without requiring Microsoft 365 administrator permissions.' },
      { tr: 'AUTO motor Microsoft Graph bağlı olduğunda Graph’a, aksi halde Classic Outlook Local’a yönelir; böylece IT desteği geldiğinde arayüz ve sipariş arama mantığı yeniden yazılmadan Graph’a geçilebilir.', en: 'AUTO routes to Microsoft Graph when connected and otherwise to Classic Outlook Local, allowing a future IT-enabled Graph migration without rewriting the UI or order-search logic.' },
      { tr: 'Yerel motor mail göndermez, silmez, taşımaz veya okundu durumunu değiştirmez; yalnız mevcut Windows/Classic Outlook profilinin zaten erişebildiği içeriği okur.', en: 'The local engine does not send, delete, move, or mark messages as read; it only reads content already accessible to the current Windows/Classic Outlook profile.' },
    ],
  },
  {
    v: '7.07', date: '2026-08-25',
    title: { tr: 'Organizasyon aktif kullanıcı görünümü', en: 'Active-user Organization view' },
    items: [
      { tr: 'User & Authorization Management → Organizasyon ağacı yalnız ACTIVE durumundaki kullanıcıları gösterir; inaktif hesaplar Kullanıcılar ve audit kayıtlarında korunmaya devam eder.', en: 'User & Authorization Management → Organization now shows only ACTIVE users; inactive accounts remain preserved in Users and audit history.' },
      { tr: 'Aktif bir kullanıcının eski/inaktif bir yönetici referansı varsa kullanıcı ağaçtan kaybolmaz; görünür bir kök düğüm olarak gösterilir.', en: 'If an active user still references an inactive/legacy manager, the user is kept visible as a root node instead of disappearing from the tree.' },
      { tr: 'Microsoft 365 Kurulum Sihirbazı kişisel Outlook Web OAuth bağlantısının Client Secret değerini de uygulama içinden şifreli olarak yönetir; Secret tarayıcıya geri gönderilmez.', en: 'The Microsoft 365 Setup Wizard now securely manages the Client Secret for the personal Outlook Web OAuth connection in-app; the secret is never returned to the browser.' },
    ],
  },
  {
    v: '7.06', date: '2026-08-25',
    title: { tr: 'Uygulama içi Microsoft 365 kurulumu', en: 'In-app Microsoft 365 setup' },
    items: [
      { tr: 'CP ve Orders Outlook aksiyonunda kapsayıcı nesnede find çağrılmasına neden olan rows.find TypeError giderildi; satırlar artık tip kontrollü .rows dizisinden çözülür.', en: 'The rows.find TypeError caused by searching the CP/Orders wrapper object was fixed; rows are now resolved from the type-checked .rows array.' },
      { tr: 'Microsoft Graph, shared mailbox, application credentials, webhook/delta ve Outlook V2 feature flag ayarları için uygulama içi kurulum sihirbazı eklendi.', en: 'An in-app setup wizard was added for Microsoft Graph, shared mailboxes, application credentials, webhook/delta and Outlook V2 feature flags.' },
      { tr: 'Application secret, webhook clientState ve token şifreleme anahtarı AES-256-GCM ile saklanır; secret değerleri tarayıcıya geri verilmez ve IT ortam değişkenleri önceliğini korur.', en: 'The application secret, webhook clientState and token encryption key are stored with AES-256-GCM; secrets are never returned to the browser and IT environment variables retain precedence.' },
      { tr: 'Kurulum ekranı delegated bağlantı, shared mailbox, application token ve seçilen mailbox için Exchange RBAC erişimini ayrı ayrı test eder; Entra/Exchange/public HTTPS dış yönetici adımları açıkça gösterilir.', en: 'The setup screen separately tests delegated configuration, shared mailboxes, application tokens and Exchange RBAC access for the selected mailbox; external Entra/Exchange/public HTTPS admin steps are clearly shown.' },
    ],
  },
  {
    v: '7.05', date: '2026-08-25',
    title: { tr: 'Outlook Mail Intelligence V2', en: 'Outlook Mail Intelligence V2' },
    items: [
      { tr: 'Kişisel Outlook araması korunarak Microsoft tarafından erişim verilen shared mailbox araması ve kaynak seçimi eklendi.', en: 'Personal Outlook search remains intact while Microsoft-authorized shared mailbox search and source selection were added.' },
      { tr: 'Mail ilişkilendirme, pin/tag, iletişim timeline, order watch, attachment güvenli önizleme ve kullanıcı onaylı değişiklik adayları tamamlandı.', en: 'Mail linking, pin/tags, communication timeline, order watch, safe attachment preview and user-reviewed change candidates were completed.' },
      { tr: 'Termin, fiyat, miktar ve iptal algılama; yapılandırılmış AI özeti, prompt-injection koruması ve source traceability eklendi.', en: 'Delivery, price, quantity and cancellation detection, structured AI summaries, prompt-injection protection and source traceability were added.' },
      { tr: 'Managed mailbox registry, scoped application erişimi, webhook/lifecycle, idempotent queue, subscription renewal, dead letter ve delta recovery altyapısı eklendi.', en: 'Managed mailbox registry, scoped application access, webhooks/lifecycle, idempotent queue, subscription renewal, dead letter and delta recovery were added.' },
    ],
  },
  {
    v: '7.04', date: '2026-08-25',
    title: { tr: 'Microsoft 365 Outlook sipariş mailleri', en: 'Microsoft 365 Outlook order emails' },
    items: [
      { tr: 'Orders, CP, Backlog detay ve Collection satırlarına kullanıcı yetkisine bağlı Outlook mail arama aksiyonu eklendi.', en: 'A permission-aware Outlook email search action was added to Orders, CP, Backlog detail and Collection rows.' },
      { tr: 'Kullanıcı bazlı Authorization Code + PKCE bağlantısı, yalnız delegated Mail.Read yetkisi ve AES-GCM ile şifrelenen token deposu eklendi.', en: 'Per-user Authorization Code + PKCE, delegated Mail.Read only and AES-GCM encrypted token storage were added.' },
      { tr: 'Staged Graph Search, relevance skoru, eşleşme nedenleri, tekilleştirme, conversation gruplama, filtre, özel tarih ve sayfalama tamamlandı.', en: 'Staged Graph Search, relevance scoring, match reasons, deduplication, conversation grouping, filters, custom dates and paging were completed.' },
    ],
  },
  {
    v: '7.03', date: '2026-08-25',
    title: { tr: 'Rol workspace çalışma zamanı düzeltmesi', en: 'Role workspace runtime fix' },
    items: [
      { tr: 'V7.02 rol workspace çözümleyicisi sunucunun buildUserAccess çalışma zamanı nesnesine bağlandı; ana veri, Orders, Backlog ve LFL yanıtlarının TypeError ile kesilmesi giderildi.', en: 'The V7.02 role workspace resolver is now bound to the server buildUserAccess runtime object, preventing the main data, Orders, Backlog and LFL responses from failing with a TypeError.' },
      { tr: 'Regresyon testi sunucunun gerçek çalışma zamanı nesnesini ve oturum açılmış /api/data yanıt yolunu doğrulayacak şekilde genişletildi.', en: 'Regression coverage now validates the actual server runtime object and the authenticated /api/data response path.' },
    ],
  },
  {
    v: '7.02', date: '2026-08-24',
    title: { tr: 'Rol workspace varsayılanları ve standart şablonlar', en: 'Role workspace defaults and standard templates' },
    items: [
      { tr: 'Buyer, Manager, Senior Manager ve Moderator için mevcut bir kullanıcıdan snapshot alınarak yönetilebilen Standard Workspace şablonları eklendi.', en: 'Manageable Standard Workspace templates were added for Buyer, Manager, Senior Manager and Moderator, captured as snapshots from an existing user.' },
      { tr: 'Horizon fallback sırası Kullanıcı Modülü, Kullanıcı Varsayılanı, Rol Modülü, Rol Varsayılanı ve Uygulama Varsayılanı olarak tamamlandı.', en: 'The Horizon fallback order is now User Module, User Default, Role Module, Role Default and Application Default.' },
      { tr: 'Profil Kopyalama artık standart rol şablonunu kaynak olarak kullanabilir; aynı MERGE/REPLACE ve çoklu hedef motoru çalışır.', en: 'Profile Copy can now use a standard role template as its source through the same MERGE/REPLACE and multi-target engine.' },
      { tr: 'Rol şablonları kişisel workspace ayarlarını, yetkileri veya organizasyon bilgilerini ezmez; değişiklikler audit kaydına yazılır.', en: 'Role templates do not overwrite personal workspace settings, permissions or organization data; changes are recorded in the audit log.' },
    ],
  },
  {
    v: '7.01', date: '2026-08-24',
    title: { tr: 'Kişisel çalışma alanı ve profil kopyalama', en: 'Personal workspace and profile copy' },
    items: [
      { tr: 'Mevcut kullanıcı ve yetki sistemi genişletildi; her kullanıcının Horizon, filtre, kolon, görünüm, dashboard ve favori ayarları gerçek kullanıcı kimliğiyle bağımsız saklanır.', en: 'The existing user and authorization system was extended; each user’s Horizon, filters, columns, views, dashboard and favorites are stored independently by real user ID.' },
      { tr: 'Backlog, CP, Orders ve LFL Horizon ayarı sorgu oluşturulmadan önce oturum kullanıcısı ve modül için çözülür; kullanıcı sonuç cache’leri ve snapshot’ları birbirine karışmaz.', en: 'Backlog, CP, Orders and LFL Horizon settings are resolved for the authenticated user and module before query construction; personalized result caches and snapshots never mix.' },
      { tr: 'Yetki Kopyalama, önizlemeli Profil Kopyalama deneyimine genişletildi; kişisel yetkiler ve seçilen workspace kategorileri tek veya birden fazla hedefe MERGE ya da REPLACE modunda snapshot olarak aktarılır.', en: 'Copy Permissions was extended into Profile Copy with preview; personal permissions and selected workspace categories are applied as a snapshot to one or more targets in MERGE or REPLACE mode.' },
      { tr: 'Rol, MAG, MMYG ve Yönetici kopyalama varsayılan kapalıdır; parola, kimlik, oturum, kişisel audit ve operasyonel iş kayıtları profil kopyasına dahil edilmez.', en: 'Copying Role, MAG, MMYG and Manager is off by default; passwords, identities, sessions, personal audit and operational business records are excluded from profile copy.' },
      { tr: 'Role · Permission Matrix’e USER.PROFILE_COPY eklendi; Gökberk Moderatör korunur ve sahip olunmayan güvenlik yetkisinin devri mevcut yetki yükseltme kontrolüyle engellenir.', en: 'USER.PROFILE_COPY was added to the Role · Permission Matrix; Gökberk Moderator is preserved and existing escalation checks block copying security permissions the actor does not own.' },
      { tr: 'Kullanıcı menüsündeki Görünümümü Sıfırla, yalnız aktif modül ve oturum kullanıcısının kişisel görünümünü temizler.', en: 'Reset My View in the user menu clears only the authenticated user’s personal view for the active module.' },
    ],
  },
  {
    v: '7.00', date: '2026-08-24',
    title: { tr: 'Kullanıcı ve yetki yönetimi baştan tasarlandı', en: 'User and authorization management redesigned from scratch' },
    items: [
      { tr: 'Kullanıcı & Yetki Yönetimi arayüzü tamamen kaldırılıp sıfırdan yazıldı; mevcut kullanıcılar, moderatör hesabı, parolalar, yetkiler ve geçmiş kayıtları korundu.', en: 'The User & Authorization Management screen was removed and rebuilt from scratch; existing users, the moderator account, passwords, permissions and history were preserved.' },
      { tr: 'Ekran beş bölüme ayrıldı: Kullanıcılar, Roller & Yetkiler, Organizasyon, Yetki Kopyalama ve Değişiklik Geçmişi.', en: 'The screen is split into five sections: Users, Roles & Permissions, Organization, Copy Permissions and Change History.' },
      { tr: 'Tümü / Aktif / İnaktif sekmeleri sayaçlarıyla eklendi; inaktif kullanıcılar anında listelenir ve tek tıkla aktifleştirilir, kullanıcı hiçbir zaman silinmez.', en: 'All / Active / Inactive tabs with counters were added; inactive users are listed instantly and reactivated with one click, and a user is never deleted.' },
      { tr: 'Yeni kullanıcı Buyer veritabanından otomatik tamamlanarak seçilir; MAG ve MMYG bilgileri doldurulur, MMYG listesi seçilen MAG ile sınırlanır ve mükerrer hesap engellenir.', en: 'A new user is picked with autocomplete from the buyer database; MAG and MMYG are filled in, the MMYG list is limited to the chosen MAG and duplicate accounts are blocked.' },
      { tr: 'Rol · Yetki Matrisi yeniden yazıldı: rol seçimi, katlanabilir kategoriler, yetki arama, kolon başlığından toplu açma, sabit Modül sütunu ve toplu kaydetme.', en: 'The Role · Permission Matrix was rewritten with role selection, collapsible categories, permission search, bulk column toggles, a sticky Module column and batched saving.' },
      { tr: 'Yetki kopyalama önizlemeli hale geldi; Mevcut Yetkilere Ekle ve Kaynak Kullanıcıyla Aynı Yap kipleri eklendi, yalnız kullanıcıya özel yetkiler kopyalanır.', en: 'Copying permissions now has a preview and two modes, Add to Existing Permissions and Make Identical to Source; only user-specific permissions are copied.' },
      { tr: 'Organizasyon görsel ağaç olarak yeniden yapıldı; yönetici değiştirme, alt kullanıcı ekleme ve sürükle-bırak çalışır, döngüler sunucuda engellenir.', en: 'The organization is rebuilt as a visual tree with manager changes, adding reports and drag and drop; cycles are blocked by the server.' },
      { tr: 'Kullanıcı detayından parola belirlenebilir veya sıfırlanabilir; parola kuralları pencerede yazılıdır ve parola hash lenerek saklanır.', en: 'A password can be set or reset from the user detail panel; the rules are shown in the dialog and the password is stored hashed.' },
      { tr: 'Değişiklik Geçmişi teknik döküm yerine okunabilir cümleler gösterir; her ekranın yükleniyor, boş ve hata durumu vardır.', en: 'Change History shows readable sentences instead of a technical dump, and every screen has loading, empty and error states.' },
    ],
  },
  {
    v: '6.72', date: '2026-08-24',
    title: { tr: 'Kullanıcı, rol ve organizasyon yönetimi düzeltmeleri', en: 'User, role and organization management fixes' },
    items: [
      { tr: 'Pasif kullanıcı kartları yeniden çizim ve arama sonrasında da açılır; profil içinden parola atanıp kullanıcı aynı işlemde aktifleştirilebilir.', en: 'Inactive user cards remain selectable after rerendering and search; a password can be assigned and the user activated from the same profile.' },
      { tr: 'Sistem rolleri Buyer, Manager, Senior Manager ve Moderatör olarak düzenlendi; eski Standart Kullanıcı ve Sistem Yöneticisi kayıtları veri kaybı olmadan yeni rollere taşınır.', en: 'System roles are now Buyer, Manager, Senior Manager and Moderator; legacy Standard User and System Administrator records migrate without data loss.' },
      { tr: 'Rol · Yetki Matrisi iki sabit başlık sütunuyla hizalandı; her rol için izinler ve varsayılan veri kapsamı toplu olarak yönetilebilir.', en: 'The Role · Permission Matrix is aligned with two fixed header columns; permissions and default data scope can be managed in one batch for each role.' },
      { tr: 'MAG, MMYG ve veri kapsamı kullanıcı profilinde korunur; bir kullanıcının doğrudan yetkileri ve kapsam tanımları aynı anda birden fazla kullanıcıya kopyalanabilir.', en: 'MAG, MMYG and data scope remain on the user profile; one user’s direct permissions and scope assignments can be copied to multiple users at once.' },
      { tr: 'Organizasyon ekranına yönetici seçim paneli ve doğrulamalı sürükle-bırak ataması eklendi; yeni Moderator dışı kullanıcılarda bağlı yönetici zorunlu hale getirildi.', en: 'The Organization screen now has a manager assignment panel and validated drag-and-drop; a manager is required for newly created non-Moderator users.' },
      { tr: 'Korunan Gökberk moderatör hesabının kimliği, parolası, aktif durumu, yetkileri ve kök hiyerarşi konumu migrasyon boyunca korunur.', en: 'The protected Gökberk Moderator account retains its identity, password, active status, permissions and root hierarchy position throughout migration.' },
    ],
  },
  {
    v: '6.71', date: '2026-08-24',
    title: { tr: 'Kullanıcı ve yetkilendirme sistemi yeniden inşası', en: 'User and authorization system rebuild' },
    items: [
      { tr: 'Kullanıcı & Yetki Yönetimi; Kullanıcılar, Organizasyon, Roller & Yetkiler, Yetki Yönetimi ve Audit Log bölümleriyle tek merkezde yeniden oluşturuldu.', en: 'User & Authorization Management was rebuilt as one workspace with Users, Organization, Roles & Permissions, Permission Management and Audit Log sections.' },
      { tr: 'Organizasyon seviyesi sistem rolünden ayrıldı; Görev Tanımı, MMYG, MAG ve Yönetici seviyeleri Standart Kullanıcı, Moderatör ve Sistem Yöneticisi rollerinden bağımsız çalışır.', en: 'Organization levels were separated from system roles; Job Title, MMYG, MAG and Manager now work independently from Standard User, Moderator and System Administrator roles.' },
      { tr: 'Mevcut Gökberk moderatör hesabının sabit kimliği, şifresi, aktif durumu ve erişimleri idempotent migrasyonla korunur.', en: 'The existing Gökberk moderator account keeps its stable identity, password, active status and access through an idempotent migration.' },
      { tr: 'Merkezi Resource.Action izin sözlüğü, atanan/efektif kaynak görünümü, rekürsif iş yetkisi mirası, miras alınmayan güvenlik yetkileri ve süreli izinler eklendi.', en: 'A centralized Resource.Action registry, assigned/effective source view, recursive business permission inheritance, non-inheritable security permissions and temporary grants were added.' },
      { tr: 'Kurumsal/ASAS sabit kimlikleriyle mükerrer hesap, kendine yetki verme, sahip olunmayan yetkiyi devretme ve organizasyon döngüsü sunucuda engellenir.', en: 'Duplicate corporate/ASAS identities, self-escalation, granting unowned permissions and organization cycles are blocked by the server.' },
      { tr: 'SELF, TEAM, MMYG, MAG, ALL ve CUSTOM veri kapsamları CP, Orders, Backlog ve LFL yanıtlarında sunucu tarafında uygulanır; kritik değişiklikler gerekçe ve onayla audit kaydına yazılır.', en: 'SELF, TEAM, MMYG, MAG, ALL and CUSTOM data scopes are enforced server-side for CP, Orders, Backlog and LFL responses; critical changes are audited with reason and confirmation.' },
    ],
  },
  {
    v: '6.70', date: '2026-08-24',
    title: { tr: 'Logistics Flow görünür genişlik düzeltmesi', en: 'Logistics Flow visible-width fix' },
    items: [
      { tr: 'Logistics Flow detay kartı artık geniş CP tablosunun tamamına yayılmıyor; her zaman görünür tablo ve sayfa genişliğine sığıyor.', en: 'The Logistics Flow detail card no longer spans the full wide CP table and always fits the visible table and page width.' },
      { tr: 'Kart yatay tablo kaydırmasında görünür sol kenarda kalıyor; dar ekranlarda içeriğin kendi yatay kaydırması korunuyor.', en: 'The card stays at the visible left edge while the table scrolls horizontally, with internal scrolling retained on narrow screens.' },
      { tr: 'Akış içindeki 1–2–3 Priority sırasının üretim/eksik yükleme, depo öncesi ve depo segmentlerinden üretildiği doğrulandı.', en: 'The 1–2–3 Priority order was verified as production/shortage, pre-warehouse and warehouse segments.' },
    ],
  },
  {
    v: '6.69', date: '2026-08-24',
    title: { tr: 'LFL çeviri ve ASAS ürün alanları', en: 'LFL translation and ASAS product fields' },
    items: [
      { tr: 'Üretici & Ülke Sipariş Analizi ekranı ve Excel çıktısı aktif Türkçe/İngilizce dil seçimine tam olarak bağlandı.', en: 'The Manufacturer & Country Order Analysis screen and Excel output now fully follow the active Turkish/English language selection.' },
      { tr: 'ASAS Ürün Tanım alanı CP ve Orders tablolarına, LFL ana filtresine ve analiz detay Excel’ine eklendi.', en: 'The ASAS Product Description field was added to CP and Orders tables, the main LFL filter and analytics detail Excel.' },
      { tr: 'Analiz Kırılımı listesinin sonuna eklenen ASAS’tan Ekle seçeneği, ASAS veritabanı başlıklarını seçip LFL kırılımı olarak kaydetmeyi sağlar.', en: 'Add From ASAS at the end of the Analysis Breakdown list lets users select ASAS database headings and save them as LFL breakdowns.' },
    ],
  },
  {
    v: '6.68', date: '2026-08-24',
    title: { tr: 'LFL analiz tabloları katman düzeltmesi', en: 'LFL analytics table layering fix' },
    items: [
      { tr: 'Üretici & Ülke Sipariş Analizi tablolarındaki sabit başlık, sabit ilk sütun ve toplam satırı artık tema uyumlu opak arka plan kullanıyor.', en: 'Sticky headers, the frozen first column and the totals row in Manufacturer & Country Order Analysis now use theme-aware opaque backgrounds.' },
      { tr: 'Dağılım Matrisi köşe hücresi, sütun başlıkları ve satır başlıkları ayrı katmanlara alınarak yatay ve dikey kaydırmada metinlerin üst üste binmesi engellendi.', en: 'The Distribution Matrix corner, column headers and row headers now use separate layers to prevent text overlap during horizontal and vertical scrolling.' },
      { tr: 'Toplam satırına ayırıcı ve gölge eklendi; değerlerin tablo gövdesi metinleriyle karışması giderildi.', en: 'A divider and shadow were added to the totals row so its values no longer blend into table body text.' },
    ],
  },
  {
    v: '6.67', date: '2026-08-24',
    title: { tr: 'JavaScript çalışma zamanı kararlılığı', en: 'JavaScript runtime stability' },
    items: [
      { tr: 'Koleksiyon öneri paneli, satır yeniden çizilirken veya hücre ekran dışına çıkarken güvenli biçimde kapanıyor ve null DOM hatası üretmiyor.', en: 'The Collection suggestion panel now closes safely without a null DOM error when a row is re-rendered or its cell leaves the viewport.' },
      { tr: 'Sürüm Geçmişi dosyasındaki Türkçe metin sözdizimi düzeltildi; pencere yeniden güvenle yükleniyor.', en: 'The Turkish text syntax in the Version History file was corrected so the window loads reliably again.' },
      { tr: 'Bağımsız tarayıcı betiklerine sözdizimi ve Koleksiyon panel yaşam döngüsüne regresyon kontrolleri eklendi.', en: 'Syntax checks for standalone browser scripts and regression coverage for the Collection panel lifecycle were added.' },
    ],
  },
  {
    v: '6.66', date: '2026-08-23',
    title: { tr: 'Analiz modülleri görünürlük düzeltmesi', en: 'Analytics module visibility fix' },
    items: [
      { tr: 'LFL içindeki Üretici & Ülke Sipariş Analizi, ana sayfa sekmelerine özel genel görünürlük kuralından ayrıldı ve artık sonuçların altında görünür.', en: 'Manufacturer & Country Order Analysis in LFL is isolated from the main-page tab visibility rule and is now visible below the results.' },
      { tr: 'Collection Fiyat & Üretici Analizi için aynı iç içe section riski giderildi.', en: 'The same nested-section visibility risk was removed from Collection Price & Manufacturer Analysis.' },
    ],
  },
  {
    v: '6.65', date: '2026-08-23',
    title: { tr: 'Collection Multi-Buyer Fiyat & Üretici Analizi', en: 'Collection Multi-Buyer Price & Manufacturer Analysis' },
    items: [
      { tr: 'Kullanıcı yalnız erişim yetkisi bulunan Buyer workspace’lerini birlikte görüntüleyebilir; çoklu görünüm salt okunur, tekil workspace düzenleme yetkileri değişmez.', en: 'Users can view only Buyer workspaces they already have permission to access; multi-workspace mode is read-only and single-workspace edit permissions remain unchanged.' },
      { tr: 'MMYG, MAG, Buying Group ve Buyer için bağımlı çoklu filtreler ile Benim Kayıtlarım ve Tüm Erişilebilir Kayıtlar presetleri eklendi.', en: 'Dependent multi-select filters for MMYG, MAG, Buying Group and Buyer plus My Records and All Accessible Records presets were added.' },
      { tr: 'Aynı filtrelenmiş Collection satırlarını kullanan fiyat/üretici analizi; KPI, benchmark, IQR aykırı değer, yoğunluk, sezon, matris, drilldown ve çok sayfalı Excel sağlar.', en: 'Price and manufacturer analytics use the exact same filtered Collection rows and provide KPIs, benchmarks, IQR outliers, concentration, seasons, matrix, drilldown and multi-sheet Excel.' },
      { tr: 'Üretici teklifleri, onaylı/en iyi teklif, Target, FOB, Overseas/TR Landed, TR Price ve Previous FOB yalnız gerçek alanlardan üretilir; USD ve TRY birleştirilmez.', en: 'Manufacturer quotations, confirmed/best quote, Target, FOB, Overseas/TR Landed, TR Price and Previous FOB come only from real fields; USD and TRY are never mixed.' },
    ],
  },
  {
    v: '6.64', date: '2026-08-23',
    title: { tr: 'Üretici & Ülke Sipariş Analizi', en: 'Manufacturer & Country Order Analysis' },
    items: [
      { tr: 'LFL ekranına üretici, ülke, MAG ve klasman bazında sipariş hacmi, değişim, pay ve pay değişimini gösteren yeni salt-okunur analiz modülü eklendi.', en: 'A new read-only LFL module analyses order volume, change, share and share shift by manufacturer, country, MAG and classification.' },
      { tr: 'Yeni, Büyüyen, Stabil, Daralan ve Çıkış üretici durumları; yoğunluk KPI’ları, Top-N grafikleri, trend ve çapraz dağılım matrisi aynı agregasyon sonucundan üretiliyor.', en: 'Manufacturer states, concentration KPIs, Top-N charts, trend and cross-distribution matrix are generated from the same aggregate result.' },
      { tr: 'Modül ek veri sorgusu yapmaz; mevcut LFL güncel/kıyas satırlarını kullanır ve çok sayfalı Excel ile mevcut portföy drilldown’unu destekler.', en: 'The module performs no additional data query; it uses existing LFL current/comparison rows and supports multi-sheet Excel plus the existing portfolio drilldown.' },
    ],
  },
  {
    v: '6.63', date: '2026-08-23',
    title: { tr: 'Uygulama geneli tablo ve hover performansı', en: 'Application-wide table and hover performance' },
    items: [
      { tr: 'Koleksiyon, CP, Orders, Quotations, Open Costing, OAB/LFL ve alt detay görsellerinin ortak hover motoru kare bazlı ve GPU destekli hâle getirildi.', en: 'The shared image hover engine used by Collection, CP, Orders, Quotations, Open Costing, OAB/LFL and detail views is now frame-limited and GPU accelerated.' },
      { tr: 'Koleksiyon, Backlog, Shipping, LFL ve yoğun detay tablolarında ekran dışında kalan satırların çizimi erteleniyor; Excel ve yazdırma sırasında tam çizim korunuyor.', en: 'Off-screen row rendering is deferred in Collection, Backlog, Shipping, LFL and dense detail tables; full rendering is preserved for Excel and printing.' },
      { tr: 'Görsel aksiyon açıklaması artık büyük önizlemenin önüne çıkan tarayıcı araç ipucu oluşturmadan erişilebilir metin olarak saklanıyor.', en: 'Image action help is now stored as accessible text without creating a browser tooltip over the large preview.' },
    ],
  },
  {
    v: '6.62', date: '2026-08-22',
    title: { tr: 'ASAS Teknik Resim öncelikli kalıcı model görselleri', en: 'Persistent model images with ASAS Technical Image priority' },
    items: [
      { tr: 'ASAS Data Model/Excel kaynağındaki Teknik Resim alanı otomatik eşlenip Buyer Log model görseli olarak kaydediliyor.', en: 'The Technical Image field in the ASAS Data Model/Excel source is automatically mapped and stored as the Buyer Log model image.' },
      { tr: 'İlk toplu geçişte ASAS Teknik Resimleri mevcut PLM/manüel görsellerin üzerine yazılıyor; tamamlanan görseller sonraki yenilemelerde yeniden indirilmiyor.', en: 'On the first bulk pass, ASAS Technical Images replace existing PLM/manual images; completed images are not downloaded again on later refreshes.' },
      { tr: 'Sonraki yenilemeler yalnız görselsiz yeni kayıtları tamamlıyor; alınamayan ASAS görseli mevcut görseli silmiyor ve daha sonra yeniden deneniyor.', en: 'Later refreshes fill only new records without images; a failed ASAS image never deletes the current image and is retried later.' },
    ],
  },
  {
    v: '6.61', date: '2026-08-22',
    title: { tr: 'OAB: yerleşik filtre sözlüğü ve gelişmiş PASS teşhisi', en: 'OAB: bundled filter dictionary and improved PASS diagnostics' },
    items: [
      { tr: 'OAB\'de bir PASS isteği başarısız olduğunda, hangi endpoint\'in ve hangi HTTP metodunun başarısız olduğu artık ekranda gösteriliyor.', en: 'When a PASS request fails in OAB, the failing endpoint and HTTP method are now shown on screen.' },
      { tr: 'Season, MAG ve Buyer Group seçenekleri artık uygulamayla birlikte paketlenen OAB filtre metadata JSON\'undan okunuyor; filtre seçerken PASS bağlantısı veya metadata isteği yapılmıyor.', en: 'Season, MAG and Buyer Group options are now read from the OAB filter metadata JSON bundled with the app; selecting filters no longer opens PASS or sends metadata requests.' },
      { tr: 'Paketlenmiş filtre sözlüğü 4 Season, 147 benzersiz MAG ve 145 benzersiz Buyer Group içeriyor; PASS bağlantısı yalnız gerçek OAB raporu istendiğinde kuruluyor.', en: 'The bundled filter dictionary contains 4 Seasons, 147 unique MAGs and 145 unique Buyer Groups; PASS is only connected when the actual OAB report is requested.' },
    ],
  },
  {
    v: '6.60', date: '2026-08-22',
    title: { tr: 'OAB: doğru PASS adresi ve metadata/rapor akışının ayrılması', en: 'OAB: correct PASS address and metadata/report flow separation' },
    items: [
      { tr: 'PASS bağlantısı erişilemeyen bir adrese gidiyordu; doğru adrese (pass.lcwaikiki.com) düzeltildi.', en: 'The PASS connection was going to an unreachable address; fixed to the correct one (pass.lcwaikiki.com).' },
      { tr: 'Filtre metadata\'sı (Season/MAG/Buyer Group) artık rapor verisinden ayrı bir önbellekte tutuluyor; önbellek doluysa PASS\'e bağlanmadan gösteriliyor.', en: 'Filter metadata (Season/MAG/Buyer Group) is now cached separately from report data; shown without connecting to PASS when cached.' },
      { tr: 'PASS bağlantısı artık yalnız gerektiğinde (ilk kullanım veya Get OAB/Refresh OAB anında) kuruluyor.', en: 'The PASS connection is now only established when needed (first use, or when Get OAB/Refresh OAB is pressed).' },
    ],
  },
  {
    v: '6.59', date: '2026-08-22',
    title: { tr: 'OAB Overview\'da hiç görünmüyordu, düzeltildi', en: 'Fixed OAB never appearing in Overview' },
    items: [
      { tr: 'OAB bölümü Overview ekranında hiç görünmüyordu; bir CSS kuralı yüzünden kalıcı olarak gizli kalıyordu.', en: 'The OAB section never appeared in Overview; it was permanently hidden due to a CSS rule.' },
      { tr: 'Kök neden: bölüm yanlışlıkla sekme yönetimi için ayrılmış bir HTML etiketiyle işaretlenmişti. Artık doğru etiketle görünüyor.', en: 'Root cause: the section was mistakenly marked with an HTML tag reserved for tab management. It now renders correctly.' },
    ],
  },
  {
    v: '6.58', date: '2026-08-22',
    title: { tr: 'OAB Settings modalı açılışta bloklama hatası düzeltildi', en: 'Fixed OAB Settings modal blocking app startup' },
    items: [
      { tr: 'Uygulama açılır açılmaz boş bir "OAB Settings" modalı görünüp hiçbir işlem yapılamaması sorunu giderildi.', en: 'Fixed an issue where an empty "OAB Settings" modal appeared as soon as the app opened, blocking all interaction.' },
      { tr: 'Modal artık yalnız Ayarlar düğmesine tıklanınca oluşturuluyor ve kapatılınca tamamen kaldırılıyor.', en: 'The modal is now only created when the Settings button is clicked, and fully removed when closed.' },
    ],
  },
  {
    v: '6.57', date: '2026-08-22',
    title: { tr: 'Overview > OAB modülü (yeni)', en: 'Overview > OAB module (new)' },
    items: [
      { tr: 'Overview ekranına, PASS\'teki OrderBudget_List_Report raporuna bağlanan yeni bir "OAB" modülü eklendi.', en: 'A new "OAB" module was added to Overview, connecting to the OrderBudget_List_Report on PASS.' },
      { tr: 'Season → MAG → Buyer Group filtre zinciriyle yalnız seçilen kombinasyon sorgulanır; toplu tarama yapılmaz.', en: 'Only the selected Season → MAG → Buyer Group combination is queried; no bulk crawling.' },
      { tr: 'PASS oturum bilgisi hiçbir zaman koda, loga veya kalıcı depoya yazılmaz.', en: 'PASS session information is never written to code, logs, or persistent storage.' },
      { tr: 'Sonuçlar önbelleğe alınır (varsayılan 30 dakika); lokal filtreler ve pivot ayarları PASS\'e yeni istek göndermeden çalışır.', en: 'Results are cached (default 30 minutes); local filters and pivot settings work without new PASS requests.' },
    ],
  },
  {
    v: '6.56', date: '2026-08-21',
    title: { tr: 'İki filtre hatası düzeltildi', en: 'Two filter bugs fixed' },
    items: [
      { tr: '"Revised Only" filtresi artık çalışıyor; önceden CP ve Siparişler tablolarının satır süzme mekanizması bu seçimi hiç kontrol etmiyordu, yalnız değer filtresine bakıyordu.', en: 'The "Revised Only" filter now works; previously the CP and Orders row-filtering mechanism never checked this selection, only the value filter.' },
      { tr: '"Filtreleri Temizle" artık Koleksiyon\'daki satır işaret tiklerini de sıfırlıyor; önceden yalnız sütun değer filtreleri temizleniyordu.', en: '"Clear Filters" now also resets the row-check filter in Collection; previously only column value filters were cleared.' },
    ],
  },
  {
    v: '6.55', date: '2026-08-21',
    title: { tr: 'QTX dosyaları artık kalıcı olarak kaydediliyor', en: 'QTX files are now saved permanently' },
    items: [
      { tr: 'Colour Code hücresine sağ tıklayınca "Umbrella\'da Bul" (indirir ve kaydeder) ve "QTX İndir" (kayıtlıyı indirir) seçenekleri çıkıyor.', en: 'Right-clicking a Colour Code cell now shows "Find on Umbrella" (fetches and saves) and "Download QTX" (downloads the saved file).' },
      { tr: 'Colour Code tüm modellerde ortak olduğu için, kaydedilen bir QTX aynı Colour Code\'a sahip her satırda (CP, Siparişler, Koleksiyon) görünür ve indirilebilir.', en: 'Since Colour Code is shared across models, a saved QTX becomes visible and downloadable on every row with the same Colour Code, across CP, Orders, and Collection.' },
      { tr: 'Colour Code hücreleri artık varsayılan olarak sade; yalnız kayıtlı QTX\'i olanlar kalın ve mavi renkte gösteriliyor.', en: 'Colour Code cells are now plain by default; only ones with a saved QTX file appear bold and blue.' },
      { tr: 'Eski çift tıklama kaldırıldı; indirilen dosya artık sunucuda da saklanıyor, yalnız kullanıcının bilgisayarına inmiyor.', en: 'The old double-click behaviour was removed; the downloaded file is now also stored on the server, not only on the user\'s computer.' },
    ],
  },
  {
    v: '6.54', date: '2026-08-21',
    title: { tr: 'Koleksiyon ve PLM içe aktarma düzeltmeleri', en: 'Collection and PLM import fixes' },
    items: [
      { tr: 'PLM linki artık isim benzerliğiyle yanlış modele bağlanmıyor; Special Code boşken isim eşleşmesi devre dışı kalıyor.', en: 'PLM links no longer attach to the wrong model via name similarity; name matching is disabled while Special Code is empty.' },
      { tr: 'Koleksiyon tablosunda klavye ile (TAB, ok tuşları, Enter) ekran dışına çıkan hücrelere geçildiğinde görünüm artık otomatik kayıyor.', en: 'In the Collection table, the view now scrolls automatically when keyboard navigation (TAB, arrow keys, Enter) moves to a cell outside the visible area.' },
      { tr: 'PLM ID\'si olmayan yeni modeller artık "Pending File" durumuyla başlıyor.', en: 'New models without a PLM ID now start with the "Pending File" status.' },
      { tr: 'PLM Excel\'inden model aktarırken Lisansör bilgisi artık okunup Koleksiyon satırına yazılıyor.', en: 'Licensor information is now read from the PLM Excel import and written to the Collection row.' },
    ],
  },
  {
    v: '6.53', date: '2026-08-21',
    title: { tr: 'Denetim sonrası test tabanı temizliği', en: 'Post-audit test suite cleanup' },
    items: [
      { tr: 'Öncelik motorundaki "Delay" sınıflandırmasının daraltılması bilinçli bir karar olarak onaylandı; 400 vakalık regresyon karşılaştırması ve ilgili testler güncel davranışa göre yeniden temellendirildi.', en: 'The narrowing of the "Delay" classification in the priority engine was confirmed as an intentional decision; the 400-case regression fixture and related tests were rebaselined to match current behaviour.' },
      { tr: 'Ayrı "ASAS - Fabric" kaynağının (buton, API ucu, kalıcı depo) daha önce kaldırıldığı doğrulandı; bu kaldırılmış akışı sınayan bayat testler temizlendi, hâlâ geçerli olan kullanıcı/veri izolasyonu testleri korundu.', en: 'Confirmed that the separate "ASAS - Fabric" source (button, API route, persistent store) had already been removed; stale tests exercising that removed flow were cleaned up, while still-valid user/data isolation tests were kept.' },
      { tr: 'Antrepo/IAS eşleştirmesinin artık parsiyelleri birleştirmeden satır bazında koruduğu doğrulandı; ilgili test ve fixture güncel üçlü anahtar (Sipariş Kod + Model Adı + Renk Kod) şemasına göre yeniden yazıldı.', en: 'Confirmed that Antrepo/IAS matching now preserves partial shipments per row instead of merging them; the related test and fixture were rewritten for the current triple-key (order code + model name + colour code) schema.' },
      { tr: 'Fiyatlandırma Excel dışa aktarımındaki görsel en-boy oranı testindeki aşırı sıkı tolerans, xlsx yazma/okuma turunun kaçınılmaz alt-piksel yuvarlamasını hesaba katacak şekilde gevşetildi.', en: 'An overly strict tolerance in the pricing Excel export image aspect-ratio test was relaxed to account for the unavoidable sub-pixel rounding of an xlsx write/read round trip.' },
    ],
  },
  {
    v: '6.52', date: '2026-08-20',
    title: { tr: 'Üretici ve model bilgisi değişiklikleri kapalı kayıtlara da yansıyor', en: 'Manufacturer and model changes now propagate to closed records too' },
    items: [
      { tr: 'Üretici adı değişikliği artık kapalı quotation kayıtlarını da günceller; önceden yalnız açık kayıtlar kapsanıyordu.', en: 'A manufacturer rename now also updates closed quotation records; previously only active ones were covered.' },
      { tr: 'Bir modelin PLM ID, Model Name, Category, Colour, Season veya License bilgisi değiştiğinde, o modele ait quotation satırları (kapalı kayıtlar dahil) otomatik güncelleniyor.', en: 'When a model\'s PLM ID, Model Name, Category, Colour, Season, or License changes, the corresponding quotation lines — including closed records — update automatically.' },
      { tr: 'Her iki senkron da yalnız kullanıcının kendi sahip olduğu kayıtları etkiliyor.', en: 'Both syncs only affect records the user owns.' },
    ],
  },
  {
    v: '6.51', date: '2026-08-20',
    title: { tr: 'Kapalı quotation kayıtlarında içerik düzenleme yasağı kaldırıldı', en: 'Removed the content-edit lock on closed quotation records' },
    items: [
      { tr: 'Kapalı bir quotation kaydının fiyatı, onayı ve notu artık düzenlenebiliyor; sahiplik/erişim kontrolü değişmedi.', en: 'A closed quotation record\'s price, approval, and note can now be edited; ownership/access control is unchanged.' },
      { tr: 'Kapalı kayıtları sürükleyip birleştirme akışındaki gözden kaçan bir istemci kontrolü de kaldırıldı; v6.47\'de sürükleme açılmıştı ama bu ayrı kontrol birleştirmeyi sessizce reddediyordu.', en: 'A missed client-side check in the drag-to-merge flow for closed records was also removed; v6.47 opened dragging but this separate check was silently rejecting the merge.' },
      { tr: 'Koleksiyon\'daki düzenle penceresi kapalı bir quotation kaydını artık bulup güncelleyebiliyor; önceden bu kayıtlar atlandığı için yanlışlıkla ikinci bir kayıt açılabiliyordu.', en: 'The Collection edit window can now find and update a closed quotation record; previously these were skipped and a duplicate record could be opened by mistake.' },
    ],
  },
  {
    v: '6.50', date: '2026-08-20',
    title: { tr: 'LFL panel sürükleme özelliği artık gerçekten görünüyor', en: 'LFL panel drag-resize is now actually visible' },
    items: [
      { tr: 'Classification Comparison ile Manufacturer Order Volumes arasındaki sürüklenebilir ayırıcı düzeltildi; iki eski CSS kuralı ekran koşulundan bağımsız olarak panel düzenini sabitleyip ayırıcıyı gizliyordu.', en: 'The draggable divider between Classification Comparison and Manufacturer Order Volumes was fixed; two older CSS rules were unconditionally locking the panel layout and hiding the divider.' },
      { tr: 'Dar ekranlardaki tek sütun davranışı korundu; ayırıcının görünümü değişmedi.', en: 'The single-column behaviour on narrow screens is preserved; the divider\'s appearance is unchanged.' },
    ],
  },
  {
    v: '6.49', date: '2026-08-20',
    title: { tr: 'LFL alt detay pencereleri büyütüldü', en: 'LFL detail modals enlarged' },
    items: [
      { tr: 'Selected/Compared Portfolio Detail ve MAG · MMYG · Classification drill-down pencereleri artık ekranın neredeyse tamamını kaplıyor; önceden 1500×780 piksel ile sabitlenmişti.', en: 'The Selected/Compared Portfolio Detail and MAG · MMYG · Classification drill-down windows now use nearly the full screen; previously they were fixed at 1500×780 pixels.' },
      { tr: 'Tablo sütunları pencereye sığdırılmaya zorlanmıyor; taşan tablo yatay kaydırma ile görüntüleniyor.', en: 'Table columns are not forced to fit the window; an overflowing table scrolls horizontally instead.' },
    ],
  },
  {
    v: '6.48', date: '2026-08-20',
    title: { tr: 'Koleksiyon Durum listesine Capacity Request eklendi', en: 'Added Capacity Request to the Collection status list' },
    items: [
      { tr: 'Yeni durum Fiyatlamada ile Siparişe Hazır arasına eklendi ve Excel dışa aktarımında kendi rengiyle gösteriliyor.', en: 'The new status was added between Fiyatlamada and Siparişe Hazır and appears with its own colour in the Excel export.' },
    ],
  },
  {
    v: '6.47', date: '2026-08-20',
    title: { tr: 'Kapalı quotation kayıtları artık birleştirilebiliyor', en: 'Closed quotation records can now be merged' },
    items: [
      { tr: 'Kapalı quotation kayıtları da sürükleyip birleştirilebiliyor; kapalı bir kayıt hem kaynak hem hedef olabilir, hedef kapalıysa birleşme sonrası da kapalı kalır.', en: 'Closed quotation records can now be dragged and merged too; a closed record can be either source or target, and the result stays closed when the target is closed.' },
      { tr: 'Kapalı bir kaydın kendi içeriğini düzenleme kısıtlaması değişmedi; yalnız sürükleme/birleştirme izni ayrıldı.', en: 'A closed record\'s own content-editing restriction is unchanged; only the drag/merge permission was separated from it.' },
    ],
  },
  {
    v: '6.46', date: '2026-08-20',
    title: { tr: "Overseas Landed kopyalamada kâr yüzdesi Excel'e gidiyor", en: 'Overseas Landed copy now carries the profit percentage into Excel' },
    items: [
      { tr: 'Overseas Landed hücresini kopyalayıp Excel\'e yapıştırınca kâr yüzdesi artık görünüyor; önceden yalnız düz metin yapıştırmasında görünüyordu.', en: 'Pasting a copied Overseas Landed cell into Excel now shows the profit percentage; previously it only appeared in plain-text paste.' },
      { tr: 'Kâr içermeyen hücreler (TR Landed gibi) hâlâ saf sayı olarak kopyalanıp formülde kullanılabiliyor.', en: 'Cells without a profit figure (such as TR Landed) still copy as a plain number usable in formulas.' },
    ],
  },
  {
    v: '6.45', date: '2026-08-20',
    title: { tr: 'Yenileme özetinde boş meta alanları giderildi', en: 'Fixed blank meta fields in the refresh summary' },
    items: [
      { tr: 'Change details tablosundaki Antrepo satırlarında Sub-Mfr, Special Code, MAG, MMYG, Buyer, Buying Group, Season ve Manufacturer artık doğru geliyor; kök neden sipariş kodunun ASAS ve Antrepo tarafında farklı biçimlerde karşılaştırılmasıydı.', en: 'Sub-Mfr, Special Code, MAG, MMYG, Buyer, Buying Group, Season, and Manufacturer now populate correctly for Antrepo rows in the Change details table; the root cause was comparing the order code in two different formats between ASAS and Antrepo.' },
      { tr: 'Düzeltme yalnız bu raporun görüntüleme zenginleştirmesini kapsıyor; CP/Backlog üretim eşleştirmesi değişmedi.', en: 'The fix is scoped to this report\'s display enrichment only; the CP/Backlog production matching is unchanged.' },
    ],
  },
  {
    v: '6.44', date: '2026-08-20',
    title: { tr: 'Ekip çapında canlı senkronizasyon', en: 'Team-wide live sync' },
    items: [
      { tr: 'CP, Siparişler, Backlog ve Koleksiyon\'daki değişiklikler ekipteki diğer açık pencerelere otomatik ve sessizce yansıyor.', en: 'Changes in CP, Orders, Backlog, and Collection now propagate automatically and silently to other open windows across the team.' },
      { tr: 'Kendi yaptığın değişiklik kendi ekranına ayrıca yenileme tetiklemiyor.', en: 'Your own changes do not trigger an extra reload on your own screen.' },
      { tr: 'Koleksiyon\'da yalnız o an açık olan sayfa etkileniyorsa yenileniyor.', en: 'In Collection, only the page currently open is refreshed when it is the one affected.' },
      { tr: 'Yenileme, açık bir düzenleme varsa önce onu güvenle kapatıp bekleyen kayıtları bitirdikten sonra başlıyor; mevcut veri kaybı korumalarıyla aynı yolu kullanıyor.', en: 'A refresh first safely closes any open edit and finishes pending saves before starting, using the same path as the existing data-loss protections.' },
      { tr: 'Kısa sürede art arda gelen değişiklikler tek bir yenilemede birleştiriliyor.', en: 'Multiple changes arriving in quick succession are merged into a single refresh.' },
    ],
  },
  {
    v: '6.43', date: '2026-08-19',
    title: { tr: "Prepare E-Mail'de çoklu üretici taslakları", en: 'Multiple manufacturer drafts in Prepare E-Mail' },
    items: [
      { tr: 'Birden fazla üretici seçiliyken Outlookun otomatik açamadığı taslaklar artık her biri için ayrı ayrı indiriliyor; eskiden bu yalnız tek üretici seçiliyken oluyordu.', en: 'When multiple manufacturers are selected, drafts that Outlook cannot open automatically are now downloaded individually for each one; previously this only happened with a single manufacturer.' },
      { tr: 'Taslak oluştur butonu kaç ayrı taslak oluşturulacağını gösteriyor.', en: 'The create-draft button shows how many separate drafts will be created.' },
      { tr: 'Art arda birden fazla taslak indirilirken tarayıcının bunu engelleyebileceğine dair bir bilgi notu eklendi.', en: 'A notice was added explaining that the browser may block several consecutive downloads.' },
    ],
  },
  {
    v: '6.42', date: '2026-08-19',
    title: { tr: 'Koleksiyon: yeni durum, duplicate ve dışa aktarım düzeltmeleri', en: 'Collection: new status, duplicate and export fixes' },
    items: [
      { tr: 'Koleksiyon Durum listesine "Dummy PO Placed" eklendi.', en: '"Dummy PO Placed" was added to the Collection status list.' },
      { tr: 'Duplicate işleminden sonra hiçbir satır seçili kalmıyor; eskiden yeni oluşturulan satırlar otomatik seçiliyordu.', en: 'No rows remain selected after duplicating; previously the newly created rows stayed selected.' },
      { tr: 'Endeksmatik hücresinde sürükle-kopyala eklendi: bir satırın sonucu tutamaçla diğer satırlara sürüklenerek kopyalanabiliyor.', en: 'Drag-to-copy was added to the Endeksmatik cell: a row\'s result can be dragged onto other rows using the handle.' },
      { tr: 'Endeksmatik Excel dışa aktarımı artık ekranda göründüğü gibi fiyat ve endeks satırlarının ikisini de taşıyor.', en: 'The Endeksmatik Excel export now carries both the price and index lines, matching what the screen shows.' },
      { tr: 'Overseas Landed hücresinin kopyalama metnine ve Excel notuna kâr yüzdesi eklendi.', en: 'The profit percentage was added to the Overseas Landed cell\'s copy text and Excel note.' },
    ],
  },
  {
    v: '6.41', date: '2026-08-19',
    title: { tr: 'Yerleşik dış web betikleri düzenlenebiliyor', en: 'Built-in external web scripts are editable' },
    items: [
      { tr: 'CoreNectum görsel indirme ve küçültme ile Umbrella QTX indirme akışları Automations Terminal bölümünden düzenlenebiliyor.', en: 'The CoreNectum image download and resize flows and the Umbrella QTX download flow can be edited from the Automations terminal section.' },
      { tr: 'Varsayılan kod uygulamada olduğu gibi kalıyor; düzenleme yalnız üst katman olduğu için varsayılana dönüş her zaman çalışıyor.', en: 'The factory code stays in place; edits are only an overlay, so restoring the factory version always works.' },
      { tr: 'Kod kaydedilmeden önce sözdizimi denetleniyor ve kayıtlı bir betik bozuksa çalışma sırasında varsayılana dönülüyor.', en: 'Code is syntax-checked before saving, and a stored script that is broken falls back to the factory version at run time.' },
      { tr: 'Betikler değerleri params üzerinden alıyor; bölüm yalnız moderatör yetkisiyle açılıyor.', en: 'Scripts receive values through params, and the section is available to moderators only.' },
    ],
  },
  {
    v: '6.40', date: '2026-08-19',
    title: { tr: 'Görseli PLM\'den çağırma komutu', en: 'Fetch image from PLM command' },
    items: [
      { tr: 'Model görseline sağ tıklandığında açılan pencereye PLM\'den Çağır komutu eklendi; CP, Siparişler ve Koleksiyon ekranlarında tek modelin görselini getirir.', en: 'A Fetch from PLM command was added to the image right-click window; it fetches a single model\'s image in CP, Orders and Collection.' },
      { tr: 'Komut toplu eksik tamamlama akışının aynı sunucu ucunu kullanır, böylece bağlantı ve yetki kuralları tek yerde kalır.', en: 'The command uses the same server endpoint as the bulk completion flow, keeping connection and authorization rules in one place.' },
      { tr: 'PLM görsel döndürmezse işlem sessizce başarılı görünmez; bildirilen sebep gösterilir.', en: 'When PLM returns no image the action does not appear silently successful; the reported reason is shown.' },
    ],
  },
  {
    v: '6.39', date: '2026-08-19',
    title: { tr: 'Otomasyonlarda ASAS/IAS zincirleme', en: 'Chaining ASAS and IAS sources in automations' },
    items: [
      { tr: 'Bir otomasyon ikinci bir veri kaynağı bağlayabiliyor; satırlar Sipariş Kod üzerinden eşleştirilip koşullar iki tablonun başlıklarıyla birlikte kurulabiliyor.', en: 'An automation can chain a second data source; rows are matched on order code so conditions can use headers from both tables.' },
      { tr: 'Üç eşleşme kipi eklendi: yalnız eşleşenler, eşleşmeyenler de kalsın, yalnız eşleşmeyenler.', en: 'Three matching modes were added: matched only, keep unmatched too, and unmatched only.' },
      { tr: 'İkinci kaynağın alanları önekle gösteriliyor; aynı adı taşıyan başlıklar birbirini ezmiyor.', en: 'Fields from the second source are prefixed so identically named headers no longer overwrite each other.' },
      { tr: 'Ön izleme kaç satırın eşleştiğini, eşleşmediğini, aynı sipariş kodunu paylaşan satırları ve sipariş kodu okunamayan satırları raporluyor.', en: 'The preview reports matched and unmatched rows, rows sharing an order code, and rows with no readable order code.' },
      { tr: 'Zincirlenen kaynak da veri alanı yetki kontrolünden geçiyor.', en: 'The chained source is subject to the same data-area authorization check.' },
    ],
  },
  {
    v: '6.38', date: '2026-08-19',
    title: { tr: 'Silinen PLM görselleri yeniden yüklenebiliyor', en: 'Deleted PLM images can be fetched again' },
    items: [
      { tr: 'Görseli silinmiş modeller eksik sayılıyor ve PLM senkronunda yeniden yükleniyor; eskiden bu modeller ya eksik listesine hiç girmiyor ya da indirilen görsel ekranda görünmüyordu.', en: 'Models whose image was deleted now count as missing and are fetched again during PLM sync; previously they either never entered the missing list or the downloaded image never appeared.' },
      { tr: 'Yeniden yüklenen görsel yazılırken o modele ait silme kaydı temizleniyor, aynı modelin diğer renklerine ait görseller korunuyor.', en: 'Writing a refetched image clears that model\'s deletion record while images for the model\'s other colours are preserved.' },
      { tr: 'Görselin var olup olmadığı ekran, PLM senkronu ve eksik listesi tarafında aynı kuralla belirleniyor.', en: 'Whether an image exists is now decided by the same rule in the viewer, the PLM sync and the missing-items list.' },
    ],
  },
  {
    v: '6.37', date: '2026-08-19',
    title: { tr: 'Otomasyon panosu ve iki yollu otomasyon oluşturma', en: 'Automation dashboard and two ways to build automations' },
    items: [
      { tr: 'Otomasyonlar ekranının üstünde planlı otomasyon sayısı, son yedi gündeki e-posta sayısı ve hata sayısı gösteriliyor.', en: 'The Automations page now shows the number of scheduled automations, emails sent in the last seven days, and failures.' },
      { tr: 'Her otomasyon kartı ne yaptığını düz cümleyle anlatıyor; son çalışmanın sonucu ve sıradaki çalışma zamanı kartta görünüyor.', en: 'Each automation card describes what it does in plain language and shows the last run result and the next scheduled run.' },
      { tr: 'Otomasyon oluşturma Basit Arayüz ve Terminal olarak ikiye ayrıldı; Terminal yalnız moderatör yetkisiyle açılıyor.', en: 'Creating an automation is split into a simple builder and a terminal; the terminal is available to moderators only.' },
      { tr: 'Kaçırılan tetik uyarısındaki çizim hatası giderildi.', en: 'A rendering fault in the missed-trigger notice was fixed.' },
    ],
  },
  {
    v: '6.36', date: '2026-08-19',
    title: { tr: 'Agents kaldırıldı, otomasyon alıcıları ve kaçırılan tetikler', en: 'Agents removed, automation recipients and missed triggers' },
    items: [
      { tr: 'Agent Workflow Studio kaldırıldı; otomasyon işleri tek Automations ekranında toplandı. Web otomasyonu, PLM akışları ve terminali besleyen tarayıcı motoru korundu.', en: 'Agent Workflow Studio was removed and automation work is consolidated in the Automations page. The browser engine behind web automation, PLM flows and the terminal is preserved.' },
      { tr: 'Otomasyon adres defteri artık hem çalışma alanındaki üretici e-postalarını hem de Prepare E-Mail ekranında elle eklenen adresleri okuyor.', en: 'The automation address book now reads both workspace manufacturer emails and addresses added manually in Prepare E-Mail.' },
      { tr: 'Alıcı, satır alanına göre bölünebiliyor: her değere kendi kayıtlarıyla ayrı e-posta gider, karşılığı bulunamayan değerler raporlanır ve o değerler için gönderim yapılmaz.', en: 'Recipients can be split by a row field: each value receives its own email with its own records, and values without a match are reported instead of being emailed.' },
      { tr: 'Alıcısı eksik otomasyon kaydedilemiyor; eksiklik planlı çalışma saatinde sessiz başarısızlığa yol açıyordu.', en: 'Automations with unresolved recipients can no longer be saved; the gap used to surface only as a silent failure at the scheduled time.' },
      { tr: 'Planlanan saatte uygulama kapalıysa tetik sessizce geç çalıştırılmıyor; 90 dakikayı aşan gecikmeler kaçırıldı olarak gösterilip çalıştır veya atla seçenekleriyle soruluyor.', en: 'When the app is closed at the scheduled time the trigger is no longer run silently late; delays beyond 90 minutes are shown as missed with run or skip options.' },
      { tr: 'Planlı otomasyonlar Buyer Log sunucusu açık olduğu sürece uygulama içindeki Node zamanlayıcı tarafından çalıştırılır.', en: 'Scheduled automations run through the in-app Node scheduler while the Buyer Log server is running.' },
    ],
  },
  {
    v: '6.35', date: '2026-08-19',
    title: { tr: 'Backlog tarih kaynakları, LFL düzeni ve fiyat geçmişi sıralaması', en: 'Backlog date sources, LFL layout, and price-history ordering' },
    items: [
      { tr: 'Backlog raporundaki "Orijinal Exfactory Merch Tarih" her zaman ASAS tarihini gösterir; eskiden CP revizyonunu taşıyordu ve revize sütunuyla aynı değerdeydi.', en: 'The original ex-factory date in the Backlog report now always shows the ASAS date; previously it carried the CP revision and matched the revised column.' },
      { tr: 'Revize yükleme tarihi parsiyel satırlarda ANTREPO handover tarihinden, üretim satırlarında CP revizyonundan (yoksa ASAS tarihinden) gelir.', en: 'The revised loading date comes from the ANTREPO handover date on partial rows, and from the CP revision (or the ASAS date) on production rows.' },
      { tr: 'LFL karşılaştırma senaryolarının sonuncusu da silinebilir; liste boş bırakıldığında yeni senaryo üretilmez.', en: 'The last LFL comparison scenario can now be deleted; emptying the list no longer regenerates scenarios.' },
      { tr: 'Classification Comparison ile Manufacturer Order Volumes panelleri arasındaki çizgi sürüklenerek genişlikler ayarlanabilir; ayar saklanır ve çift tıklama varsayılana döner.', en: 'The divider between the Classification Comparison and Manufacturer Order Volumes panels can be dragged to resize them; the setting persists and double-click restores the default.' },
      { tr: 'Fiyat Geçmişi üretici bazlı görünümünde üretici sütunları sürükle bırak ile sıralanabilir ve sıra saklanır.', en: 'Manufacturer columns in the price-history by-manufacturer view can be reordered by drag and drop, and the order is remembered.' },
    ],
  },
  {
    v: '6.34', date: '2026-08-19',
    title: { tr: 'Veri kaybı önlemleri ve tablo filtreleri', en: 'Data-loss safeguards and table filters' },
    items: [
      { tr: 'Ex-Factory revizyonlarında veri kaybı giderildi: gecikmeli sunucu yazmaları artık Sipariş Kod + Model Adı + Renk Kod üçlüsüyle anahtarlanır, aynı siparişin farklı satırlarındaki ardışık düzenlemeler birbirini iptal etmez.', en: 'Data loss on Ex-Factory revisions was fixed: pending server writes are now keyed by Order Code + Model Name + Colour Code, so consecutive edits on different lines of the same order no longer cancel each other.' },
      { tr: 'Yenileme sırasında uygulama salt görüntüleme kipine geçer; açık düzenlemeler kapatılır, bekleyen yazmalar gönderilip tamamlanmaları beklenir ve ekranın üstünde bilgi şeridi gösterilir.', en: 'The app switches to view-only mode during a refresh; open editors are committed, pending writes are flushed and awaited, and an information banner is shown.' },
      { tr: 'Ex-factory, Retail Date ve In-Store sütunlarının filtre panelinde revizyon seçimi eklendi: Tümü, yalnız revize edilenler veya yalnız revize edilmeyenler.', en: 'A revision selector was added to the Ex-factory, Retail Date, and In-Store column filters: all, revised only, or not revised only.' },
      { tr: 'Tablo başlığındaki seçim kutusuna sağ tıklamak işaret filtresini Tümü, İşaretliler ve İşaretsizler arasında döndürür; filtre panelinde de İşaretsizler seçeneği yer alır.', en: 'Right-clicking the header checkbox cycles the selection filter through all, checked, and unchecked rows; the filter panel also offers an unchecked-only option.' },
      { tr: 'Best Price, Conf. Manufacturer ve Conf. FOB sütunları Target Price ile birlikte açılıp kapanmaz; sütun seçim panelinde tek tek yönetilir.', en: 'Best Price, Conf. Manufacturer, and Conf. FOB no longer toggle together with Target Price; each is managed individually in the column chooser.' },
      { tr: 'Koleksiyon alt toplam ve ortalama satırı, tam yeniden çizim gerektirmeyen düzenlemelerden sonra da tazelenir.', en: 'The Collection subtotal and average row is refreshed after edits that do not require a full redraw.' },
      { tr: 'Koleksiyon fiyat düzenleme penceresi mevcut Quotations kaydını yerinde günceller ve onay kutusu boş bırakıldığında ilgili üreticinin onayını kaldırır.', en: 'The Collection price editor updates the existing Quotations record in place, and clearing the confirmation checkbox removes that manufacturer\'s approval.' },
    ],
  },
  {
    v: '6.33', date: '2026-08-17',
    title: { tr: 'License Royalty tekrar Licensor bazlı', en: 'License Royalty back to Licensor matching' },
    items: [
      { tr: 'License Royalty Calculations ekranındaki Manufacturer alanı tekrar Licensor olarak değiştirildi; mevcut kural değerleri açılışta otomatik geri alınır.', en: 'The Manufacturer field in License Royalty Calculations was changed back to Licensor; existing rule values migrate back automatically at startup.' },
      { tr: 'CP, Orders, Endeksmatik ve Koleksiyon royalty/hologram hesapları yeniden Licensor + License eşleşmesiyle çalışır.', en: 'Royalty and hologram calculations in CP, Orders, Endeksmatik, and Collection match on Licensor + License again.' },
      { tr: 'Koleksiyon sayfasında Manufacturer alanı bulunmadığında royalty hesabının boş kalması engellendi.', en: 'Royalty calculations no longer come out empty on the Collection page where no Manufacturer field exists.' },
    ],
  },
  {
    v: '6.32', date: '2026-08-17',
    title: { tr: 'Görselsiz ve stabil Backlog Excel raporu', en: 'Image-free, stable Backlog Excel report' },
    items: [
      { tr: 'Backlog ana raporu ve detay Excel çıktılarında Görsel sütunu artık dosyaya eklenmez; kayıtlı görsel sütunu tercihi yok sayılır.', en: 'The image column is no longer written to the Backlog report or detail Excel exports; any stored image-column preference is ignored.' },
      { tr: 'Backlog ekranındaki görsel sütunu, hover önizlemesi ve uygulama içi görsel eşleştirme korunur; değişiklik yalnız Excel çıktısını kapsar.', en: 'The on-screen image column, hover preview, and in-app image matching are preserved; the change affects only the Excel output.' },
      { tr: 'Backlog Excel üretimi standart SheetJS yolundan ilerler; gömülü görsel kaynaklı dosya bozulması ve yavaşlama riski kaldırıldı.', en: 'Backlog Excel generation follows the standard SheetJS path, removing the file-corruption and slowdown risk caused by embedded images.' },
    ],
  },
  {
    v: '6.31', date: '2026-08-17',
    title: { tr: 'Quotation birleştirme ve Manufacturer bazlı royalty hesapları', en: 'Quotation merging and Manufacturer-based royalty calculations' },
    items: [
      { tr: 'Quotations ekranında bir kayıt diğerinin orta bölümüne sürüklenip bırakıldığında hedef kayıt korunarak iki kayıt; üretici, model, fiyat, onay, not ve kapasite bilgileriyle birleştirilir.', en: 'Dropping one record onto the middle of another in Quotations merges manufacturers, models, prices, approvals, notes, and capacity data into the target record.' },
      { tr: 'Supplier FOB Rules adı License Royalty Calculations olarak değiştirildi; mevcut Licensor değerleri Manufacturer alanına taşındı ve yeni eşleşmeler Manufacturer + License ile yapılır.', en: 'Supplier FOB Rules was renamed License Royalty Calculations; existing Licensor values migrate to Manufacturer and new matching uses Manufacturer + License.' },
      { tr: 'Colour Code hücreleri Excel çıktılarında metin biçiminde sabitlenerek 3E8 gibi kodların sayıya veya bilimsel gösterime dönüşmesi engellendi.', en: 'Colour Code cells are fixed as text in Excel exports so values such as 3E8 cannot become numbers or scientific notation.' },
      { tr: 'Koleksiyon, CP ve Orders ekranlarında PLM link ve görselleri seçilmiş Kaynak Klasör içindeki uygun Excel/CSV dosyasından da güncellenebilir.', en: 'PLM links and images can also be updated from a supported Excel/CSV file in the selected Source Folder from Collection, CP, and Orders.' },
    ],
  },
  {
    v: '6.30', date: '2026-08-16',
    title: { tr: 'Görsel limiti ve güvenilir Backlog filtre/Excel çıktısı', en: 'Image limit and reliable Backlog filters/Excel export' },
    items: [
      { tr: 'Source Data > Settings altındaki Görsel Boyut Limiti alanından 1–1024 KB arasında manuel sınır girilebilir; PLM, manuel yükleme ve mevcut görsel optimizasyonu aynı ayarı kullanır.', en: 'A manual 1–1024 KB limit can be set under Source Data > Settings; PLM imports, manual uploads, and existing-image optimization use the same setting.' },
      { tr: 'Retail date, In Store ve Warehouse entry date alanları Uygula işleminden önce kaydedilir; diskten geri yüklenen ISO tarihleri de filtrelemeden önce normalize edilir.', en: 'Retail date, In Store, and Warehouse entry date values are committed before Apply; restored ISO dates are normalized before filtering.' },
      { tr: 'Backlog Excel önizlemesi ve dışa aktarımı ekranla aynı merkezi filtre sorgusunu kullanır; Antrepo Entry Date filtresi çıktıya eksiksiz yansır.', en: 'Backlog Excel preview and export use the same canonical filter query as the screen, including the Antrepo Entry Date filter.' },
      { tr: 'Görselli Excel dosyalarında onarım uyarısına neden olan geçersiz drawing anchor niteliği kaldırıldı; görseller ve en-boy oranları korunur.', en: 'The invalid drawing anchor attribute that caused Excel repair warnings was removed while preserving images and their aspect ratios.' },
    ],
  },
  {
    v: '6.29', date: '2026-08-16',
    title: { tr: 'Düzenlenebilir otomasyon terminal kodu', en: 'Editable automation terminal code' },
    items: [
      { tr: 'Dış Web İşlemi ve Karma Otomasyon kayıtlarında her otomasyona özel JavaScript kodu görüntülenebilir, düzenlenebilir ve kalıcı olarak kaydedilebilir.', en: 'Each External Web Task and Mixed Automation now has visible, editable JavaScript code that is persisted with that automation.' },
      { tr: 'Kod, kayıtlı web adımlarından sonra bağlı Edge profilindeki hedef sayfada çalışır; document, window, fetch, item ve index değişkenleri kullanılabilir.', en: 'Code runs in the target page of the connected Edge profile after recorded web steps, with document, window, fetch, item, and index available.' },
      { tr: 'Yalnız kod içeren otomasyonlar desteklenir; Dry Run kodu çalıştırmaz ve kod içeriği denetim kayıtlarına yazılmaz.', en: 'Code-only automations are supported; Dry Run does not execute code, and code contents are never written to audit records.' },
      { tr: 'Editör Tab girintisi, Ctrl/Cmd+S ile kayıt, satır sayacı, 120.000 karakter sınırı ve mevcut HTTPS izin listesi korumasını içerir.', en: 'The editor includes Tab indentation, Ctrl/Cmd+S saving, a line counter, a 120,000-character cap, and the existing HTTPS allowlist protection.' },
    ],
  },
  {
    v: '6.28', date: '2026-08-16',
    title: { tr: 'Model görsellerinde maksimum 5 KB', en: '5 KB maximum for model images' },
    items: [
      { tr: 'PLM’den aktarılan ve elle yüklenen bütün model görselleri kesin olarak 5 KB veya altında saklanır.', en: 'All PLM and manually uploaded model images are stored at 5 KB or less.' },
      { tr: 'JPEG %50 başlangıç kalitesinden sonra kalite ve çözünürlük kademeli azaltılır; hedefe ulaşamayan görsel sunucu tarafından reddedilir.', en: 'After starting at 50% JPEG quality, quality and resolution are reduced progressively; an image that cannot meet the target is rejected by the server.' },
      { tr: 'Önceki 15 KB optimizasyon sürümündeki mevcut görseller ilk açılışta bir kez yeniden işlenir ve 5 KB sınırına indirilir.', en: 'Existing images from the previous 15 KB optimization version are processed once at startup and reduced to the 5 KB limit.' },
    ],
  },
  {
    v: '6.27', date: '2026-08-16',
    title: { tr: 'Model görsellerinde maksimum 15 KB', en: '15 KB maximum for model images' },
    items: [
      { tr: 'PLM’den çekilen ve elle yüklenen bütün model görselleri JPEG %50 başlangıç kalitesiyle işlenir; 15 KB sınırı aşılırsa kalite ve çözünürlük kademeli azaltılır.', en: 'All PLM and manually uploaded model images start at 50% JPEG quality; quality and dimensions are reduced progressively until the 15 KB limit is met.' },
      { tr: 'Sunucu 15 KB üzerindeki yeni model görsellerini reddeder; optimizasyon sınırı hiçbir kayıt yolunda atlanamaz.', en: 'The server rejects new model images above 15 KB, so no storage path can bypass the optimization limit.' },
      { tr: 'Eski 50 KB optimizasyon sürümündeki mevcut görseller uygulama açılışında bir kez yeniden kuyruğa alınır ve 15 KB veya altına indirilir.', en: 'Existing images from the former 50 KB optimization version are queued once at startup and reduced to 15 KB or less.' },
    ],
  },
  {
    v: '6.26', date: '2026-08-16',
    title: { tr: 'Hızlı ve köprüsüz Backlog Excel’i', en: 'Faster Backlog Excel without hyperlinks' },
    items: [
      { tr: 'Backlog ekranı, alt detayları, Excel önizlemesi ve Excel çıktısındaki Model Adı / Sipariş Kodu köprüleri kaldırıldı; hücreler düz veri olarak kalır.', en: 'Model Name and Order Code hyperlinks were removed from Backlog screens, drill-downs, the Excel preview, and Excel exports; cells remain plain data.' },
      { tr: 'Excel önizlemesi yalnız görünen ilk 100 satırı hazırlatır; filtre dışındaki siparişler gereksiz yere CP satırlarına dönüştürülmez.', en: 'The Excel preview prepares only the first 100 visible rows, and orders outside the active filter are no longer converted into CP rows unnecessarily.' },
      { tr: 'Tekrarlanan model görselleri yalnız bir kez indirilip hazırlanır ve Excel içinde tek medya kaydıyla yeniden kullanılır.', en: 'Repeated model images are downloaded and prepared once, then reused through a single media entry in the workbook.' },
      { tr: 'Backlog Excel Sütunları penceresi sabit sütun kataloğuyla güvenilir biçimde açılır; ASAS ve IAS başlıkları mevcutsa ayrıca listelenir.', en: 'The Backlog Excel Columns dialog now opens reliably with a fixed column catalog and lists ASAS and IAS headers when available.' },
    ],
  },
  {
    v: '6.25', date: '2026-08-16',
    title: { tr: 'QTX eşleştirmesinde yalnız Colour Code', en: 'Colour Code-only QTX matching' },
    items: [
      { tr: 'QTX Library araması artık yalnız çift tıklanan Colour Code değerini kullanır; Model Name ve PLM ID isteğe gönderilmez ve eşleştirmeye katılmaz.', en: 'QTX Library search now uses only the double-clicked Colour Code; Model Name and PLM ID are neither sent nor considered during matching.' },
      { tr: 'Renk kodu QTX satırında tam kod bileşenleriyle eşleştiğinde ilk uygun dosyanın indirmesi başlatılır ve tarama hemen durur.', en: 'When the colour code matches the exact code components in a QTX row, the first suitable file is downloaded and scanning stops immediately.' },
    ],
  },
  {
    v: '6.24', date: '2026-08-15',
    title: { tr: 'Tools menüsünde PLM ve Colour Code → QTX köprüsü', en: 'PLM in Tools and Colour Code → QTX bridge' },
    items: [
      { tr: 'Koleksiyon, CP ve Orders ekranlarındaki PLM Link ve Görsellerini Bul işlemi ilgili ekranın Tools menüsüne taşındı.', en: 'Find PLM Links & Images on Collection, CP, and Orders was moved into each screen’s Tools menu.' },
      { tr: 'Colour Code hücresine çift tıklamak, kullanıcının açık Edge oturumunda Umbrella → ROS → QTX Library akışını çalıştırır ve yalnız ilgili model + renk koduyla kesin eşleşen tek QTX dosyasını indirir.', en: 'Double-clicking a Colour Code cell runs Umbrella → ROS → QTX Library in the user’s open Edge session and downloads exactly one QTX file unambiguously matching that model and colour code.' },
      { tr: 'QTX Library sayfaları yalnız eşleşme bulunana kadar taranır; toplu indirme yapılmaz, aynı renk kodunun farklı modellerde tekrarlanması halinde belirsiz dosya indirilmez.', en: 'QTX Library pages are scanned only until a match is found; no bulk download occurs, and an ambiguous file is not downloaded when the same colour code is repeated across models.' },
    ],
  },
  {
    v: '6.23', date: '2026-08-15',
    title: { tr: '50 KB model görselleri ve özelleştirilebilir Backlog Excel’i', en: '50 KB model images and configurable Backlog Excel' },
    items: [
      { tr: 'PLM’den çekilen ve elle yüklenen model görselleri JPEG %50 kaliteyle işlenir; 50 KB üzerindeyse kalite ve boyut kademeli azaltılır. Mevcut görseller ilk açılışta bir kez aynı kuralla optimize edilir.', en: 'PLM and manually uploaded model images are processed as JPEG at 50% quality; quality and dimensions are reduced progressively above 50 KB. Existing images are optimized once on first startup.' },
      { tr: 'Backlog alt detayları PLM ve kalıcı görsel kimliğini doğrudan kaynak satırdan aldığı için görseller açık CP filtresinden bağımsız olarak tabloya ve büyük hover önizlemesine gelir.', en: 'Backlog drill-downs now receive the PLM and persistent image identity directly from the source row, so images appear in the table and large hover preview independently of the active CP filter.' },
      { tr: 'Backlog ve LFL alt detay Excel dosyalarına gerçek model görselleri gömülür; Model Adı ve Sipariş Kodu bağlantıları korunur.', en: 'Real model images are embedded in Backlog and LFL drill-down Excel files while Model Name and Order Code links are preserved.' },
      { tr: 'Backlog pivotunun altında Excel çıktısının canlı önizlemesi bulunur; Model Görseli ile ASAS ve IAS/Antrepo kaynak başlıkları Excel sütunları penceresinden seçilebilir.', en: 'A live preview of the Excel report appears below the Backlog pivot; Model Image and ASAS or IAS/Warehouse source headers can be selected in the Excel columns dialog.' },
    ],
  },
  {
    v: '6.22', date: '2026-08-15',
    title: { tr: 'Alt detaylarda büyük görsel önizleme', en: 'Large image preview in drill-down details' },
    items: [
      { tr: 'Backlog, seçili/kıyas portföyü ve Koleksiyon/LFL alt detay tablolarındaki model görselleri artık CP ekranındakiyle aynı büyük hover önizlemesini açar.', en: 'Model images in Backlog, selected/compared portfolio, and Collection/LFL drill-down tables now open the same large hover preview used on the CP screen.' },
      { tr: 'Sonradan açılan dinamik rapor pencereleri otomatik bağlanır; önizleme imleci takip eder ve imleç görselden ayrılınca kapanır.', en: 'Dynamically opened report windows are connected automatically; the preview follows the pointer and closes when it leaves the image.' },
      { tr: 'Alt detaylar yalnız önizleme katmanını paylaşır; CP ekranına özel görsel seçme, yapıştırma ve silme davranışları ayrıntı raporlarına taşınmaz.', en: 'Drill-downs share only the preview layer; CP-specific image selection, paste, and removal behaviors are not enabled in detail reports.' },
    ],
  },
  {
    v: '6.21', date: '2026-08-15',
    title: { tr: 'Görünür sayfa değiştirmeyen hızlı PLM API taraması', en: 'Fast PLM API scan without visible pagination' },
    items: [
      { tr: 'PLM Link ve Görsellerini Bul işlemi artık CoreNectum ekranındaki Sonraki Sayfa düğmesine hiçbir koşulda basmaz; yalnız yakalanan GetStyleList API isteğini arka planda yeniden kullanır.', en: 'Find PLM Links & Images no longer clicks the Next Page button in CoreNectum under any condition; it only replays the captured GetStyleList API request in the background.' },
      { tr: 'CoreNectum destekliyorsa en fazla 5.000 kayıtlık tek toplu API paketi denenir; büyük paket sınırlandırılırsa görünür sayfa değiştirmeden küçük API parçaları okunur ve bütün hedefler bulunduğunda tarama durur.', en: 'When supported by CoreNectum, one bulk API package of up to 5,000 records is attempted; if the service limits it, smaller background API chunks are read without visible pagination and scanning stops as soon as every target is found.' },
      { tr: 'İşlem ve sonuç bildirimleri gerçek davranışı gösterecek şekilde arka plan API isteği olarak yeniden adlandırılmıştır.', en: 'Progress and result notifications now describe the actual background API-request behavior.' },
    ],
  },
  {
    v: '6.20', date: '2026-08-15',
    title: { tr: 'Backlog alt detay görsel eşleştirme düzeltmesi', en: 'Backlog drill-down image matching fix' },
    items: [
      { tr: 'Alt detaylar artık yalnız açık CP/Orders satırlarının geçici görsel adreslerini taramaz; otomatik CoreNectum işleminin kalıcı PLM ID → imageRef haritasını doğrudan okur.', en: 'Drill-downs no longer scan only temporary image URLs on currently loaded CP/Orders rows; they now read the persistent PLM ID → imageRef map written by the automatic CoreNectum process.' },
      { tr: 'PLM bağlantı deposundaki Style Name ↔ PLM ID eşleşmesi sayesinde PLM ID sütunu taşımayan Backlog satırları Model Adı ve Renk Kodu ile doğru görsele bağlanır.', en: 'Using the Style Name ↔ PLM ID relationship in the PLM link store, Backlog rows without a PLM ID column now resolve the correct image by Model Name and Colour Code.' },
      { tr: 'Ortak görsel dosyaları CP, Orders, Backlog, Koleksiyon ve LFL yetkili alt detay ekranlarının tamamından okunabilir.', en: 'Shared image files can be read from every authorized CP, Orders, Backlog, Collection, and LFL drill-down screen.' },
    ],
  },
  {
    v: '6.19', date: '2026-08-15',
    title: { tr: 'Alt detaylarda model görselleri ve bağlantılar', en: 'Model images and links in drill-down details' },
    items: [
      { tr: 'Backlog, seçili/kıyas portföyü ve Koleksiyon/LFL alt detaylarında model görseli sütunu varsayılan olarak açık gelir; görseller CP, Orders ve Koleksiyon’un ortak havuzundan PLM ID + Renk Kodu, PLM ID veya Model Adı + Renk Kodu ile eşleştirilir.', en: 'The model-image column is enabled by default in Backlog, selected/compared portfolio, and Collection/LFL drill-downs; images are matched from the shared CP, Orders, and Collection pool by PLM ID + Colour Code, PLM ID, or Model Name + Colour Code.' },
      { tr: 'Bütün alt detay tablolarında Model Adı CoreNectum PLM’ye, Sipariş Kodu Troy’ya bağlanır; PLM ID düz metin olarak kalır.', en: 'Across all drill-down tables, Model Name links to CoreNectum PLM and Order Code links to Troy, while PLM ID remains plain text.' },
      { tr: 'Backlog ve Koleksiyon/LFL detay Excel’lerinde Model Adı ve Sipariş Kodu hücreleri tıklanabilir bağlantı olarak aktarılır.', en: 'Model Name and Order Code cells are exported as clickable links in Backlog and Collection/LFL detail workbooks.' },
    ],
  },
  {
    v: '6.18', date: '2026-08-15',
    title: { tr: 'PLM taraması CP, Orders ve Koleksiyon’da', en: 'PLM scan on CP, Orders, and Collection' },
    items: [
      { tr: 'PLM Link ve Görsellerini Bul düğmesi Koleksiyon araç çubuğuna da eklendi; CP, Orders ve Koleksiyon’daki üç düğme aynı merkezi hızlı CoreNectum taramasını çalıştırır.', en: 'Find PLM Links & Images was added to the Collection toolbar; the buttons on CP, Orders, and Collection all run the same centralized fast CoreNectum scan.' },
      { tr: 'İşlem hangi ekrandan başlatılırsa başlatılsın üç ekrandaki eksik modeller tek listede birleştirilir; model detayları tek tek açılmaz ve GetStyleList API taraması kullanılır.', en: 'Whichever screen starts the command, missing models from all three screens are combined into one list; model details are not opened individually and the GetStyleList API scan is used.' },
      { tr: 'Bulunan bağlantılar ve görseller ortak depoya kaydedilip üç ekrana uygulanır. PLM ID düz metin kalır; CoreNectum köprüsü yalnız Model Adı üzerindedir.', en: 'Retrieved links and images are saved to shared storage and applied across all three screens. PLM ID remains plain text; only Model Name carries the CoreNectum bridge.' },
    ],
  },
  {
    v: '6.17', date: '2026-08-15',
    title: { tr: 'Eksiksiz ASAS & Antrepo History detayları', en: 'Complete ASAS & Antrepo History details' },
    items: [
      { tr: 'History kaydı açık CP tablosundaki kullanıcı filtrelerinden etkilenmez; pencerede bu ayrım ve yeni kayıtların kullandığı kaynak bağlantı kapsamı gösterilir.', en: 'History records are not affected by user filters on the open CP table; the window now states this and shows the source-connection scope used by new records.' },
      { tr: 'Antrepo satırları geçici __ias_row_N sıra numarası yerine iş kimliğiyle çoklu-küme olarak eşleştirilir; sorgu sırasının değişmesi sahte güncellemeler oluşturmaz.', en: 'Bonded-warehouse rows are matched as a multiset by business identity rather than temporary __ias_row_N positions, so query-order changes no longer create false updates.' },
      { tr: 'Kaynaktaki bütün gerçek Antrepo sütunları karşılaştırılır ve her değişiklik Alan, Önceki ve Yeni değerleriyle gösterilir; Renk Kodu, İthalat Dosyası ve Konteyner bilgileri de eklenmiştir.', en: 'All real bonded-warehouse source columns are compared and each change shows Field, Previous, and New values; Colour Code, Import File, and Container were also added.' },
      { tr: 'Detay Excel’i genişletilmiş yirmi sütunun tamamını içerir. Eski kayıtlarda daha önce saklanmamış değerler üretilemez; mevcut Detay metinleri korunur.', en: 'The detail workbook contains all twenty expanded columns. Values that were never stored cannot be reconstructed for older records; their existing Detail text remains available.' },
      { tr: 'CoreNectum Attachment görsel kodunda aktarım sırasında bozulan MIME regex’i kaldırıldı; Unexpected identifier hatası oluşturmayan ve sözdizimi testinden geçen güvenli bir tür listesi kullanılıyor.', en: 'The MIME regex that became malformed while transferring CoreNectum Attachment image code was removed; a syntax-tested safe-type list now avoids the Unexpected identifier failure.' },
    ],
  },
  {
    v: '6.16', date: '2026-08-15',
    title: { tr: 'Attachment ağ gövdesi aktarımı', en: 'Attachment network-body transfer' },
    items: [
      { tr: 'Görsel Browser içinde indirildiği hâlde büyük Base64 sonucu değerlendirme kanalından dönemediğinde, aynı Attachment isteğinin ağ katmanında yakalanan ham gövdesi kullanılıyor.', en: 'When an image downloads in the browser but its large Base64 result cannot return through the evaluation channel, the raw body captured from the same Attachment request is used.' },
      { tr: 'Altı paralel işçi konsol kodundaki native fetch işlemini sürdürür ve oluşan Network.getResponseBody sonucunu bekler; model detay sayfaları tek tek açılmaz.', en: 'Six parallel workers retain the console collector’s native-fetch flow and wait for the resulting Network.getResponseBody; model detail pages are not opened individually.' },
      { tr: 'Kalan görsel hataları artık boş model.imageUrl, HTTP durumu, içerik biçimi veya CDP aktarım nedeni olarak sonuç bildiriminde ayrıştırılıyor.', en: 'Remaining image failures are now identified in the result notice as an empty model.imageUrl, HTTP status, content format, or CDP transfer cause.' },
    ],
  },
  {
    v: '6.15', date: '2026-08-15',
    title: { tr: 'CoreNectum binary Attachment görselleri', en: 'CoreNectum binary Attachment images' },
    items: [
      { tr: 'Görsel indirme, çalışan konsol koduyla aynı şekilde sayfanın kendi fetch işlevi, giriş bilgilerini içeren tarayıcı oturumu ve Blob baytları üzerinden yapılıyor.', en: 'Image download now mirrors the working console collector by using the page native fetch, signed-in browser credentials, and raw Blob bytes.' },
      { tr: 'Attachment servisi application/octet-stream döndürse bile JPEG, PNG, GIF ve WebP dosya imzasından tanınıyor; tarayıcının açabildiği diğer bitmapler PNG’ye dönüştürülüyor.', en: 'Even when Attachment returns application/octet-stream, JPEG, PNG, GIF, and WebP are detected from file signatures; other browser-decodable bitmaps are converted to PNG.' },
      { tr: 'Bulunan görseller Buyer Log’un kalıcı görsel deposuna yazılıyor ve PLM ID ortak görsel eşleştirmesi güncelleniyor.', en: 'Retrieved images are written to Buyer Log persistent image storage and the shared PLM-ID image mapping is updated.' },
    ],
  },
  {
    v: '6.14', date: '2026-08-15',
    title: { tr: 'Bildirim geçmişi', en: 'Notification history' },
    items: [
      { tr: 'Notebook’un hemen soluna Bildirim Geçmişi zil butonu eklendi; okunmamış bildirimler rozetle gösteriliyor.', en: 'A Notification History bell was added immediately left of Notebook, with an unread-count badge.' },
      { tr: 'Kısa ve ekran ortası bildirimleri tarih/saat bilgisiyle otomatik kaydediliyor; panelde arama, tek silme ve tümünü temizleme bulunuyor.', en: 'Toast and centre-screen notices are automatically saved with date and time; the panel supports search, individual removal, and clear all.' },
      { tr: 'En yeni 250 bildirim kullanıcı hesabına özel saklanıyor ve Notebook gibi farklı tarayıcılar arasında eşitleniyor.', en: 'The latest 250 notifications are stored per user and synchronized across browsers like Notebook.' },
    ],
  },
  {
    v: '6.13', date: '2026-08-15',
    title: { tr: 'Edge Tracking Prevention uyumluluğu', en: 'Edge Tracking Prevention compatibility' },
    items: [
      { tr: 'Attachment görselleri, GetStyleList isteğinden alınan geçici yetkilendirme başlığıyla indirilerek üçüncü taraf çerez/depolama engeline bağımlı olmaktan çıkarıldı.', en: 'Attachment images now use the temporary authorization header from GetStyleList, removing dependency on third-party cookie or storage access.' },
      { tr: 'Yetkilendirme bilgisi yalnız çalışan tarayıcı bağlantısının belleğinde tutuluyor; diske, loga veya Buyer Log verisine yazılmıyor.', en: 'Authorization data stays only in the active browser connection memory and is never written to disk, logs, or Buyer Log data.' },
    ],
  },
  {
    v: '6.12', date: '2026-08-15',
    title: { tr: 'CoreNectum Attachment görsel aktarımı', en: 'CoreNectum Attachment image transfer' },
    items: [
      { tr: 'Style List’in GetStyleList istek şablonu bir kez yakalanıyor; tüm API sayfaları doğrudan çağrıldığı için arayüz sayfaları tek tek açılmıyor.', en: 'The Style List GetStyleList request template is captured once; all API pages are called directly, so UI pages are not opened one by one.' },
      { tr: 'GetStyleList içindeki gerçek model.imageUrl alanı kullanılıyor; görsel aktarımı artık yalnız satır ve hover seçicisine bağlı değil.', en: 'The real model.imageUrl field in GetStyleList is now used; image transfer no longer depends only on row and hover selectors.' },
      { tr: 'Style List’in yüklediği Attachment/GetAttachment ağ yanıtları mevcut Edge oturumundan yakalanıp Buyer Log görsel deposuna kaydediliyor.', en: 'Attachment/GetAttachment network responses loaded by Style List are captured from the current Edge session and saved to Buyer Log image storage.' },
      { tr: 'Ağ yanıtı bulunamazsa Attachment adresleri tarayıcı oturumunda altı paralel işçiyle okunuyor; eski Image hücresi yöntemi son yedek olarak korunuyor.', en: 'If no captured response is available, Attachment URLs are read with six parallel browser workers; the previous Image-cell method remains as a final fallback.' },
    ],
  },
  {
    v: '6.11', date: '2026-08-15',
    title: { tr: 'CoreNectum Style List toplu tarama', en: 'CoreNectum Style List bulk scan' },
    items: [
      { tr: 'PLM Link ve Görsellerini Bul artık her modeli arama kutusuna yazıp detay sayfasını açmıyor; Style List’in GetStyleList sonuçlarını doğrudan okuyor.', en: 'Find PLM Links & Images no longer enters every model into search or opens every detail page; it reads Style List GetStyleList results directly.' },
      { tr: 'CP, Siparişler ve Koleksiyon’daki eksik modeller birleştiriliyor ve CoreNectum listesinin tüm sayfaları tek taramada geziliyor.', en: 'Missing models from CP, Orders, and Collection are combined and all CoreNectum list pages are traversed in one scan.' },
      { tr: 'Model görseli eşleşen Style List satırının Image hücresinden, varsa büyük hover önizlemesi kullanılarak kaydediliyor.', en: 'The model image is saved from the matching Style List row’s Image cell, using its large hover preview when available.' },
      { tr: 'Sonuç bildirimi taranan sayfa/satır, bulunan bağlantı ve kaydedilen görsel sayılarını gösteriyor.', en: 'The result notice reports scanned pages/rows, found links, and saved images.' },
    ],
  },
  {
    v: '6.10', date: '2026-08-15',
    title: { tr: 'PLM köprüsü yalnız Model Adı üzerinde', en: 'PLM bridge only on Model Name' },
    items: [
      { tr: 'CP, Siparişler ve ortak tablolardaki PLM ID değerlerinden CoreNectum köprüsü kaldırıldı; PLM ID artık düz metin gösteriliyor.', en: 'The CoreNectum bridge was removed from PLM ID values in CP, Orders, and shared tables; PLM ID is now displayed as plain text.' },
      { tr: 'Koleksiyon’daki PLM ID alanı düzenlenebilir düz alan olarak kaldı ve yanındaki bağlantı simgesi kaldırıldı.', en: 'The Collection PLM ID field remains a plain editable field and its adjacent link icon was removed.' },
      { tr: 'CoreNectum bağlantısı yalnız Model Adı hücrelerinde ve Koleksiyon’daki Model Adı açma simgesinde bulunuyor.', en: 'The CoreNectum link is now available only from Model Name cells and the Model Name open icon in Collection.' },
    ],
  },
  {
    v: '6.09', date: '2026-08-15',
    title: { tr: 'Edge WebSocket bağlantı düzeltmesi', en: 'Edge WebSocket connection fix' },
    items: [
      { tr: 'Edge’in yalnız ws:// DevTools adresi sunduğu kurulumlarda görülen “Protocol ws: not supported; Expected http:” hatası giderildi.', en: 'Fixed “Protocol ws: not supported; Expected http:” on Edge installations that expose only a ws:// DevTools endpoint.' },
      { tr: 'Tarayıcı ve sayfa kontrolü artık HTTP uçlarına ihtiyaç duymadan doğrudan WebSocket üzerindeki CDP Target oturumlarıyla çalışıyor.', en: 'Browser and page control now use CDP Target sessions directly over WebSocket without requiring HTTP endpoints.' },
      { tr: 'CoreNectum işlemi kullanıcının mevcut Edge profili ve açık oturumuyla devam ediyor; ayrı yönetilen profil açılmıyor.', en: 'CoreNectum continues to use the user’s current Edge profile and signed-in session; no separate managed profile is opened.' },
    ],
  },
  {
    v: '6.08', date: '2026-08-15',
    title: { tr: 'PLM bağlantısı doğrudan CP ve Siparişler’de', en: 'PLM connection directly in CP and Orders' },
    items: [
      { tr: 'PLM Link ve Görsellerini Bul işlemi artık mevcut Edge profilinin bağlantısını kendisi kontrol ediyor; bağlantı kapalıysa gerekli Edge ayar sayfasını doğrudan açıyor.', en: 'Find PLM Links & Images now checks the current Edge-profile connection itself and opens the required Edge settings page when the connection is disabled.' },
      { tr: 'CP ve Siparişler kullanıcılarının bağlantıyı hazırlamak için Otomasyonlar ekranına erişmesi gerekmiyor; ayrı yönetilen Edge profili veya sahte yardımcı sekme açılmıyor.', en: 'CP and Orders users no longer need access to Automations to prepare the connection; no separate managed Edge profile or fake helper tab is opened.' },
      { tr: 'Genel hata metni kaldırıldı. Edge bağlantısı, CoreNectum giriş gereksinimi ve değişmiş arama alanı artık ayrı hata kodlarıyla açıklanıyor.', en: 'The generic error message was removed. Edge connection, CoreNectum sign-in, and a changed search field are now explained with separate error codes.' },
    ],
  },
  {
    v: '6.07', date: '2026-08-15',
    title: { tr: 'CoreNectum Style Image aktarımı', en: 'CoreNectum Style Image import' },
    items: [
      { tr: 'CP ve Siparişler’deki PLM Link ve Görsellerini Bul düğmesi, eksik bağlantıların yanında CoreNectum model sayfasındaki büyük ana Style Image görselini de otomatik alıyor.', en: 'The Find PLM Links & Images button in CP and Orders now retrieves the large main Style Image from the CoreNectum model page together with missing links.' },
      { tr: 'Görsel, giriş yapılmış mevcut Edge oturumunda orijinal kaynaktan okunuyor; kaynak erişimi engellenirse yalnız ana görsel alanı kırpılmış PNG olarak yakalanıyor. Küçük önizleme veya tüm sayfa kaydedilmiyor.', en: 'The image is read from its original source in the existing signed-in Edge session; if source access is blocked, only the main image area is captured as a clipped PNG. Thumbnails and full-page screenshots are not saved.' },
      { tr: 'İndirilen görseller kalıcı Buyer Log görsel deposunda dosya olarak tutuluyor ve PLM ID üzerinden Koleksiyon, CP ve Siparişler’e ortak bağlanıyor.', en: 'Downloaded images are stored as files in Buyer Log’s persistent image storage and shared across Collection, CP, and Orders through the PLM ID.' },
      { tr: 'Mevcut Koleksiyon görselleri ve PLM ID + Colour Code ile elle atanmış renk bazlı görseller korunuyor; otomatik Style Image yalnız eksik alanı tamamlıyor.', en: 'Existing Collection images and manually assigned PLM ID + Colour Code images are preserved; the automatic Style Image only fills missing coverage.' },
    ],
  },
  {
    v: '6.06', date: '2026-08-15',
    title: { tr: 'Otomatik CoreNectum eşleştirmesi ve Model Adı köprüleri', en: 'Automatic CoreNectum matching and Model Name links' },
    items: [
      { tr: 'CoreNectum bağlantılarındaki hatalı styleId=_... biçimi kaldırıldı; bağlantılar artık CoreNectum’un orijinal styleId=... biçiminde açılıyor. CSV/Excel içindeki baştaki alt çizgi de içe aktarım sırasında temizleniyor.', en: 'The incorrect styleId=_... format was removed from CoreNectum links; links now open with CoreNectum’s original styleId=... format. A leading underscore in imported CSV/Excel values is also removed during import.' },
      { tr: 'Doğrulanmış PLM bağlantıları artık uygulamadaki tablolarda Model Adı üzerinden tek tıkla açılıyor. Aynı Model Adı birden fazla styleId ile eşleşiyorsa yanlış modele gitmemek için otomatik köprü oluşturulmuyor.', en: 'Verified PLM links now open with one click from Model Name cells across application tables. If the same Model Name maps to more than one styleId, no automatic link is created to prevent opening the wrong style.' },
      { tr: 'CP ve Siparişler araç çubuğundaki Eksik PLM Linklerini Bul düğmesi, mevcut ve giriş yapılmış Edge profilinde CoreNectum Style List’i otomatik arıyor, gerçek styleId değerini model URL’sinden alıyor ve ortak sözlüğe kaydediyor.', en: 'The Find Missing PLM Links button on CP and Orders automatically searches CoreNectum Style List in the existing signed-in Edge profile, reads the actual styleId from the style URL, and saves it to the shared dictionary.' },
      { tr: 'Otomatik eşleştirme sırasında CoreNectum parolası, oturum çerezi veya erişim anahtarı Buyer Log’a kopyalanmıyor ya da saklanmıyor.', en: 'CoreNectum passwords, session cookies, and access keys are neither copied to nor stored by Buyer Log during automatic matching.' },
    ],
  },
  {
    v: '6.05', date: '2026-08-15',
    title: { tr: 'CoreNectum PLM bağlantıları', en: 'CoreNectum PLM deep links' },
    items: [
      { tr: 'CoreNectum Style List’ten çıkarılan PLM Code ve Style ID eşleştirmeleri Koleksiyon > İçe / Dışa Aktar > PLM Linklerini Güncelle üzerinden CSV veya Excel olarak içe alınabiliyor.', en: 'PLM Code and Style ID mappings exported from CoreNectum Style List can now be imported from Collection > Import / Export > Update PLM Links as CSV or Excel.' },
      { tr: 'CP ve Orders tablolarındaki eşleşmiş PLM ID değerleri tek tıkla ilgili CoreNectum modelini açıyor; Koleksiyon’da düzenlenebilir PLM ID alanının yanındaki bağlantı düğmesi aynı işi yapıyor.', en: 'Matched PLM IDs in CP and Orders open the corresponding CoreNectum style with one click; the link button beside the editable PLM ID in Collection does the same.' },
      { tr: 'PLM Code ile CoreNectum’un iç styleId değeri ayrı tutuluyor. Yalnız doğrulanmış eşleşmeler linke dönüşüyor; eşleşmeyen modeller yanlış adrese gönderilmiyor.', en: 'PLM Code and CoreNectum’s internal styleId are stored separately. Only verified mappings become links, so unmatched styles are never sent to an incorrect page.' },
      { tr: 'PLM bağlantı sözlüğü sunucuda kalıcı ve ortak saklanıyor; yeni içe aktarımlar mevcut eşleşmeleri güvenli biçimde birleştiriyor ve değişen styleId değerlerini güncelliyor.', en: 'The PLM link dictionary is stored persistently and shared on the server; new imports safely merge with existing mappings and update changed styleId values.' },
    ],
  },
  {
    v: '6.04', date: '2026-08-15',
    title: { tr: 'CP türev tarih hücreleri canlı güncelleniyor', en: 'CP derived date cells now refresh live' },
    items: [
      { tr: 'CP’de Ex-Factory revizyonu geri alındığında veya silindiğinde Ex→Retail artık sayfa yenilemesi beklemeden aynı anda orijinal değerine dönüyor.', en: 'When an Ex-Factory revision is reverted or cleared in CP, Ex→Retail now returns to its original value immediately without waiting for a page refresh.' },
      { tr: 'Ex→Retail, LT ve Priority revizyon karşılaştırması artık satırdaki olası eski ham değere değil, o render için yeniden hesaplanan canlı değere bakıyor.', en: 'Revision comparison for Ex→Retail, LT and Priority now uses the live value recalculated for the current render rather than a potentially stale raw row value.' },
      { tr: 'LT sunucu CP/Orders satırına da yazılıyor; revizyon olmamasına rağmen “131→—” gibi sahte revizyon görünümü oluşmuyor.', en: 'LT is now included in the server CP/Orders row as well, preventing false revision displays such as “131→—” when no revision exists.' },
    ],
  },
  {
    v: '6.03', date: '2026-08-14',
    title: { tr: 'Otomatik yenileme', en: 'Automatic refresh' },
    items: [
      { tr: 'Kaynak Veri ayarlar menüsüne otomatik yenileme aralığı eklendi: 15 dk, 30 dk, 60 dk, 2 sa, 4 sa ya da kapalı. Varsayılan kapalıdır; seçtiğiniz aralık tarayıcınızda saklanır ve bir sonraki yenilemenin saati menüde yazar.', en: 'An automatic refresh interval was added to the Source Data settings menu: 15, 30 or 60 minutes, 2 or 4 hours, or off. It is off by default, the chosen interval is stored in your browser, and the time of the next run is shown in the menu.' },
      { tr: 'Yenileme zaten arka planda çalıştığı için uygulamayı kilitlemez; sayaç yalnız o işi belirli aralıklarla kendisi başlatır.', en: 'Because a refresh already runs in the background, this does not block the application; the timer merely starts that same job at intervals.' },
      { tr: 'Üç durumda tur atlanır ve bir sonraki aralığa ertelenir: zaten bir yenileme sürüyorsa, bir hücre düzenleniyorsa ya da ekranda açık bir pencere varsa. Böylece yazmakta olduğunuz bir değer yenileme yüzünden kaybolmaz ve işiniz bölünmez.', en: 'A run is skipped and deferred to the next interval in three cases: a refresh is already running, a cell is being edited, or a dialog is open. This keeps a value you are typing from being lost to a refresh and avoids interrupting your work.' },
      { tr: 'Elle yenileme yaptığınızda sayaç baştan başlar; hemen ardından ikinci bir tur çalışmaz.', en: 'Refreshing manually restarts the countdown, so a second run does not follow immediately.' },
    ],
  },
  {
    v: '6.02', date: '2026-08-14',
    title: { tr: 'Hedef düzeltme % alanı geri geldi ve ayarlanabilir', en: 'The target adjustment % field is back and adjustable' },
    items: [
      { tr: 'Endeksmatik ekranına “Hedef düzeltme %” alanı geri eklendi. Değer ENDEKSMATİK dosyasından okunur ve alanın altında hangi orijinal değerin geçerli olduğu yazar; başka bir değer yazarak o model için elle değiştirebilirsiniz.', en: 'The “Target adjustment %” field is back on the Endeksmatik screen. The value is read from the ENDEKSMATIK workbook and the original figure is shown beneath the field; typing another value overrides it for that model.' },
      { tr: 'Alan boş bırakılırsa dosyadan gelen orijinal değer kullanılır. Boş bırakmak düzeltmeyi kapatmaz; kapatmak için 0 yazmanız gerekir.', en: 'Leaving the field empty uses the original value from the workbook. An empty field does not switch the adjustment off; enter 0 to do that.' },
      { tr: 'Şu an yüklü olan Endeksmatik verisi bu bilgiyi içermediği için orijinal değer 0 görünür ve mevcut hesaplar değişmez. Yeni ENDEKSMATİK dosyasını yüklediğinizde dosyadaki değer (%3) varsayılan olarak gelir.', en: 'The Endeksmatik data currently loaded does not carry this figure, so the original value shows as 0 and existing calculations are unchanged. Once the new ENDEKSMATIK workbook is loaded, the value in the file (3%) becomes the default.' },
    ],
  },
  {
    v: '6.01', date: '2026-08-14',
    title: { tr: 'In Store ayı korunuyor, elle fiyat girişi, yeni durum', en: 'In Store month preserved, manual price entry, new status' },
    items: [
      { tr: 'Endeksmatik’te sipariş ayı girildiğinde In Store ayı otomatik değiştiriliyordu; artık dokunulmuyor. Sipariş ve In Store dönemleri aynı yılda olmak zorunda olmadığı için bu varsayım baştan hatalıydı. Dönemleri tek hamlede doldurmak isteyenler için ±1 yıl düğmeleri duruyor.', en: 'Entering an order month in Endeksmatik used to rewrite the In Store month; it is now left alone. Order and In Store periods need not fall in the same year, so that assumption was wrong to begin with. The ±1 year buttons remain for filling the periods in one go.' },
      { tr: 'Best Price ve Conf. Manufacturer hücrelerine elle giriş yapılabiliyor: hücrenin köşesindeki kalem simgesi üretici ve fiyat soruyor. Bu iki sütun türetilmiş olduğu için değer hücreye yazılmaz; girilen üretici ve fiyatla bir Quotations kaydı açılır, Best Price da kendiliğinden doğru değeri gösterir.', en: 'Best Price and Conf. Manufacturer cells accept manual entry through the pencil icon in the cell corner, which asks for a manufacturer and a price. Because both columns are derived, the value is not written into the cell: a Quotations record is created with that manufacturer and price, and Best Price then shows the right figure by itself.' },
      { tr: 'Koleksiyon durumlarına “Siparişe Hazır / Ready for Order” eklendi; iş akışındaki yeri Fiyatlamada ile Sipariş Onayda arasıdır.', en: 'A “Ready for Order” status was added to Collection, placed between In Pricing and Order in Approval to match the real workflow.' },
    ],
  },
  {
    v: '6.00', date: '2026-08-13',
    title: { tr: 'Endeksmatik güncellemeye iki yeni giriş', en: 'Two new ways to update Endeksmatik' },
    items: [
      { tr: 'Endeksmatik Güncelle düğmesi yalnız Koleksiyon > Araçlar menüsünde duruyordu. Aynı düğme artık Kaynak Veri ekranındaki ayarlar menüsünde de var.', en: 'The Update Endeksmatik button lived only in Collection > Tools. The same action is now also available from the settings menu on the Source Data screen.' },
      { tr: 'Endeksmatik penceresinin üstündeki son güncelleme notuna çift tıklayarak da yükleme açılıyor; not zaten hangi dosyadan ve ne zaman güncellendiğini gösterdiği için güncellemek isteyenin ilk baktığı yer orası.', en: 'Double-clicking the last-updated note at the top of the Endeksmatik window also opens the upload, since that note already shows which file was loaded and when.' },
      { tr: 'Üç giriş noktası da aynı dosya seçiciyi ve aynı doğrulama akışını kullanır; yetki kuralı değişmedi.', en: 'All three entry points use the same file picker and the same validation flow, and the permission rule is unchanged.' },
    ],
  },
  {
    v: '5.99', date: '2026-08-13',
    title: { tr: 'Filtre çökmesi, yüzde filtresi ve drop edilen fiyatlar', en: 'Filter crash, percentage filter and dropped prices' },
    items: [
      { tr: 'Ex→Retail sütununun filtresine dokunmak sayfayı çökertiyordu: filtre kodu projeden kaldırılmış bir yardımcıyı çağırıyordu. Değer zaten satırda hesaplanmış olarak durduğu için oradan okunuyor; sütun artık normal filtreleniyor ve “Belirli aralık” ile iki değer arası seçim yapılabiliyor.', en: 'Touching the filter on the Ex→Retail column crashed the page because the filter code called a helper that had been removed from the project. The value is already calculated on the row, so it is read from there; the column now filters normally and a range can be selected with “Belirli aralık”.' },
      { tr: 'Yüzde sütunları eski sayı panelini açtığı için değerler 0,8 / 0,75 gibi ham ondalık listeleniyor ve yüzde girişi çalışmıyordu. Yüzde sütunları artık aralık paneline yönlendiriliyor; değerler % olarak girilebiliyor.', en: 'Percentage columns opened the old numeric panel, listing raw decimals such as 0.8 or 0.75 and refusing percentage input. They now open the range panel and accept values entered as percentages.' },
      { tr: 'Quotations’ta drop edilen üreticinin fiyatı Koleksiyon’daki fiyat listesinden silinmediği için Best Price hesabına girmeye devam ediyordu. Drop işareti artık o üreticinin fiyatını Koleksiyon’dan da düşürüyor; onaylı üretici oysa onay kaldırılıyor ve drop geri alınınca fiyat geri geliyor. Drop yine yalnız o üretici satırına özel.', en: 'A manufacturer dropped in Quotations kept feeding the Best Price calculation because the price was never removed from the Collection price list. Dropping now removes that manufacturer’s price from Collection as well, clears the confirmation if it was the confirmed manufacturer, and restores the price when the drop is undone. Dropping still affects only that one manufacturer line.' },
      { tr: 'Fiyat Geçmişi veya Quotations üzerinden yapılan fiyat revizeleri ve silmeler artık Best Price ile üretici bilgisini de güncelliyor.', en: 'Price revisions and deletions made from Pricing History or Quotations now also update the Best Price and the manufacturer shown with it.' },
    ],
  },
  {
    v: '5.98', date: '2026-08-13',
    title: { tr: 'Notlar ve kişisel veriler tarayıcılar arasında taşınıyor', en: 'Notes and personal data now follow you across browsers' },
    items: [
      { tr: 'Not Defteri, mail şablonları ve kayıtlı görünüm/filtreler yalnız açık olan tarayıcının hafızasında duruyordu; bu yüzden Edge’de yazılan not Chrome’da görünmüyordu. Bu veriler artık kullanıcı hesabına bağlı olarak sunucuda da tutuluyor ve her açılışta birleştiriliyor.', en: 'The Notebook, mail templates and saved views/filters were kept only in the memory of the browser you happened to be using, so a note written in Edge did not appear in Chrome. This data is now also stored on the server against your account and merged at every start-up.' },
      { tr: 'Birleştirme iki yönlüdür ve daha yeni olan kazanır: bu tarayıcıda yazılmış notlar diğerlerine taşınır, diğerlerinde yazılanlar buraya gelir. Eski bir kopya yenisinin üzerine yazamaz.', en: 'The merge works both ways and the newer copy wins: notes written in this browser move to the others and vice versa. An older copy can never overwrite a newer one.' },
      { tr: 'Tema, sütun genişliği ve dondurma gibi ekrana özgü tercihler bilerek yerel kalır — büyük ekranda ayarlanan bir genişliği dizüstüne taşımak yardımcı olmaz.', en: 'Screen-specific preferences such as theme, column widths and freezing deliberately stay local, since a width set on a large monitor is no help on a laptop.' },
      { tr: 'Yazmalar kısa bir duraklamadan sonra gönderilir, sekme kapanırken bekleyen değişiklik kaybolmaz ve bağlantı yoksa yerel kopya yine de yazılır.', en: 'Writes are sent after a short pause, pending changes are not lost when the tab closes, and the local copy is still written when there is no connection.' },
    ],
  },
  {
    v: '5.97', date: '2026-08-13',
    title: { tr: 'Koleksiyon geri dönüşüm kutusu (30 gün)', en: 'Collection recycle bin (30 days)' },
    items: [
      { tr: 'Koleksiyon’da silinen modeller 30 gün saklanıyor ve araç çubuğundaki Geri Dönüşüm Kutusu düğmesinden geri çağrılabiliyor. Kayıt modelin tüm alanlarıyla saklanır: Pricing History bağlantısı, Confirmed Supplier/FOB, hedef fiyat, notlar ve özel sütunlar dahil.', en: 'Models deleted in Collection are kept for 30 days and can be restored from the Recycle Bin button in the toolbar. Each record keeps every field of the model, including the Pricing History link, Confirmed Supplier/FOB, target price, notes and custom columns.' },
      { tr: 'Listede her kaydın silinme zamanı, silen kullanıcı ve kalan gün sayısı görünür; son üç güne inen kayıtlar ayrıca işaretlenir. Süresi dolan kayıtlar liste her açıldığında temizlenir.', en: 'The list shows when each record was deleted, by whom, and how many days remain; records in their last three days are highlighted. Expired records are cleared whenever the list is opened.' },
      { tr: 'Geri yüklenecek modelin PLM ID’si hâlâ kullanılıyorsa çakışma uyarısı verilir ve karar kullanıcıya bırakılır — aynı PLM ID meşru şekilde iki satırda bulunabilir. Geri yüklenen satır yeni bir satır kimliği alır ve işlem geri alınabilir.', en: 'If a model’s PLM ID is still in use, a conflict warning is shown and the decision is left to the user, since the same PLM ID can legitimately appear on two rows. A restored row receives a new row identity and the action can be undone.' },
      { tr: 'Kutuyu görüntülemek Koleksiyon erişimi, geri yüklemek ve temizlemek düzenleme yetkisi gerektirir.', en: 'Viewing the bin requires Collection access; restoring and clearing require edit permission.' },
    ],
  },
  {
    v: '5.96', date: '2026-08-13',
    title: { tr: 'Fiyat Geçmişi’nde fiyat düzenleme ve silme', en: 'Editing and deleting prices in Pricing History' },
    items: [
      { tr: 'Fiyat Geçmişi’ndeki bir fiyat hücresine çift tıklayarak fiyatı yerinde revize edebilir, hücrenin köşesindeki × ile silebilirsiniz. Onaylanmış fiyatlar da dahil tüm fiyatlar için geçerlidir.', en: 'Double-click a price cell in Pricing History to revise the price in place, or use the × in the cell corner to delete it. This applies to all prices, including approved ones.' },
      { tr: 'Fiyat Geçmişi ayrı bir kayıt tutmaz; quotation kalemleri üzerinden kurulan bir görünümdür. Bu yüzden buradaki değişiklik doğrudan quotation kaydına yazılır ve Quotations ekranında da aynı anda görünür.', en: 'Pricing History keeps no separate records; it is a view built over the quotation lines. Changes made here are therefore written straight to the quotation record and appear in the Quotations screen at the same time.' },
      { tr: 'Silme işlemi kalemi kayıttan yok etmez, düşülmüş olarak işaretler: fiyat hem Fiyat Geçmişi’nden hem Quotations listesinden çıkar ama kaydın izi korunur. Silmeden önce teyit istenir.', en: 'Deleting does not destroy the line; it marks it as dropped, so the price leaves both Pricing History and the Quotations list while the record’s trace is kept. A confirmation is requested first.' },
      { tr: 'Bir fiyat değiştiğinde tablo baştan hesaplanır: madalyalar, hedef farkı ve fiyat sıralaması yeni değere göre yeniden çıkar.', en: 'When a price changes the table is recalculated from scratch, so the medals, target difference and price ranking all reflect the new value.' },
    ],
  },
  {
    v: '5.95', date: '2026-08-13',
    title: { tr: 'Yüzde sütunlarında aralık filtresi', en: 'Range filter on percentage columns' },
    items: [
      { tr: 'Yüzde sütunlarının başlık filtresi artık değer listesi yerine aralık kutuları açıyor: ÜST % > değer > ALT %. Değerler yüzde olarak girilir (12, %12 ya da 12,5 kabul edilir) ve sınırlar dahildir.', en: 'The header filter on percentage columns now opens range boxes instead of a value list: upper % > value > lower %. Values are entered as percentages (12, 12% or 12.5 are all accepted) and the bounds are inclusive.' },
      { tr: 'Bir kutuyu boş bırakmak o ucu sınırsız yapar. Sınırlar ters girilirse reddedilmez, yer değiştirilir. Boş hücreler aralığa girmez.', en: 'Leaving a box empty makes that end open. Reversed bounds are swapped rather than rejected. Empty cells are not included in a range.' },
    ],
  },
  {
    v: '5.94', date: '2026-08-13',
    title: { tr: 'Endeksmatik’te Royalty ve Hologram', en: 'Royalty and hologram in Endeksmatik' },
    items: [
      { tr: '“Hedef düzeltme %” alanı kaldırıldı. Yerine geçmiş sezon Overseas ve TR fiyatları için “Royalty ve Hologram dahil mi?” sorusu geldi; varsayılan Hayır’dır.', en: 'The “Target adjustment %” field was removed and replaced by a question for the previous-season overseas and TRY prices: “Are royalty and hologram included?”, defaulting to No.' },
      { tr: 'Hayır seçiliyse fiyat masrafsız kabul edilir: endeksmatik çalışır, sonuca modelin Royalty ve Hologram Cost masrafları eklenir. Evet seçiliyse önce girilen fiyatlardan bu masraflar çıkarılır, endeksmatik çalışır, sonuca tekrar eklenir. Sonuç her iki durumda da masraflar dahil verilir.', en: 'With No, the price is treated as net: the calculation runs and the model’s royalty and hologram cost are added to the result. With Yes, those costs are first removed from the entered prices, the calculation runs, and they are added back. Either way the result includes the costs.' },
      { tr: 'Böylece masraflar endekslenmiş olmaz; yalnız mal bedeli endekslenir. Kullanılan kural ayrıca seçilmez, modelin mevcut License Royalty eşleşmesinden gelir ve ekranda yazar. Eşleşen kural yoksa bu da bildirilir ve masraf uygulanmaz.', en: 'This keeps the costs out of the indexation, so only the goods value is indexed. The rule is not chosen separately: it comes from the model’s current License Royalty match and is shown on screen. When no rule matches, that is stated and no cost is applied.' },
      { tr: 'Hologram sabit bir USD birim maliyeti olduğu için TL fiyatta ilgili dönemin kuruyla çevrilir: eski fiyattan çıkarılırken eski dönem kuru, yeni fiyata eklenirken yeni dönem kuru.', en: 'Because the hologram is a fixed USD unit cost, it is converted for the TRY price using the exchange rate of the relevant period: the previous-period rate when removing it, the new-period rate when adding it.' },
    ],
  },
  {
    v: '5.93', date: '2026-08-13',
    title: { tr: 'License Royalty Rules’ta iki yönlü fiyat kontrolü', en: 'Two-way price check in License Royalty Rules' },
    items: [
      { tr: 'License Royalty Rules ekranına fiyat kontrolü eklendi: bir kural seçip Supp. FOB ya da Final FOB alanlarından birine yazdığınızda diğeri hesaplanır. Örneğin %20 royalty ve 0,01 hologram için 1,00 Supp. FOB → 1,26 Final FOB.', en: 'A price check was added to the License Royalty Rules screen: pick a rule, type into either the Supp. FOB or the Final FOB field, and the other is calculated. For example, with 20% royalty and 0.01 hologram, a Supp. FOB of 1.00 gives a Final FOB of 1.26.' },
      { tr: 'Ekran şimdiye kadar yalnız Final FOB → Supp. FOB yönünü hesaplıyordu; ters yön artık aynı kuraldan türetiliyor ve kullanılan formül sonucun altında gösteriliyor. Royalty %100 olduğunda bölme geçersiz olduğu için sonuç üretilmez ve sebebi yazılır.', en: 'The screen previously calculated only Final FOB to Supp. FOB; the reverse direction is now derived from the same rule and the formula used is shown beneath the result. When royalty is 100% the division is invalid, so no result is produced and the reason is stated.' },
    ],
  },
  {
    v: '5.92', date: '2026-08-13',
    title: { tr: 'PLM penceresi zemini ve Endeksmatik dönem eşleştirme', en: 'PLM dialog surface and Endeksmatik period matching' },
    items: [
      { tr: '“Import from PLM Excel” penceresinin zemini şeffaf geliyor, arka plandaki tablo metinlerin arasından görünüyordu. Pencere, kart zeminini veren ortak sınıfı taşımıyordu; başlık bloğunun da taban kuralı yoktu, bu yüzden başlık ile açıklama metni üst üste biniyordu. Her ikisi de düzeltildi ve aynı eksiği taşıyan PLM karar penceresi de kapsandı.', en: 'The “Import from PLM Excel” dialog had a transparent surface, letting the table behind show through the text. The dialog was missing the shared card-surface class, and the header block had no base rule, so the title and description overlapped. Both were fixed, and the PLM decision dialog that had the same gap was covered too.' },
      { tr: 'Endeksmatik’e iki düğme eklendi: eski dönemi girip “Yeni dönemi eskiden doldur (+1 yıl)”, ya da yeniyi girip “Eski dönemi yeniden doldur (−1 yıl)”. Sipariş ve In Store dönemleri birlikte eşlenir; ayrı TR dönemleri açıksa onlar da dahil edilir. Hangi tarihlerin dolduğu mesajla bildirilir.', en: 'Two buttons were added to Endeksmatik: enter the previous period and fill the new one (+1 year), or enter the new one and fill the previous (−1 year). Order and In Store periods are matched together, including the separate TRY periods when enabled, and the filled dates are reported in a message.' },
      { tr: 'Geçen sezon In Store ayı ilk açılışta artık boş gelmiyor: yeni In Store ayı modelden geldiği için onun bir yıl öncesi hazır geliyor. Daha önce kaydedilmiş bir değer varsa ona dokunulmaz.', en: 'The previous-season In Store month no longer starts empty: since the new In Store month comes from the model, the year before it is pre-filled. A previously saved value is left untouched.' },
    ],
  },
  {
    v: '5.91', date: '2026-08-13',
    title: { tr: 'Edge bağlantısı: yabancı sunucu tespiti ve WebSocket yolu', en: 'Edge connection: foreign server detection and WebSocket path' },
    items: [
      { tr: 'Hata ayıklama portunda cevap veren her sunucu Edge sanılıyordu. Artık yanıtın gerçekten Edge DevTools olduğu doğrulanıyor; değilse portu başka bir uygulamanın tuttuğu açıkça söyleniyor ve o uygulamayı bulmaya yarayan bilgiler (durum kodu, sunucu adı, yanıt başlangıcı) raporlanıyor.', en: 'Any server answering on the debugging port was assumed to be Edge. The response is now verified as genuine Edge DevTools; if it is not, the report says plainly that another application holds the port and includes details for identifying it.' },
      { tr: 'Edge, uzaktan hata ayıklamayı ayar sayfasındaki kutucukla açtığında HTTP uçlarını sunmayabiliyor. Bu durumda bağlantı artık doğrudan tarayıcının WebSocket adresi üzerinden kuruluyor; tanılama bu yolu da ayrı bir adım olarak raporluyor.', en: 'When remote debugging is enabled from the settings page checkbox, Edge may not serve its HTTP endpoints. The connection is now made directly over the browser WebSocket address instead, and the diagnostic reports that path as a separate step.' },
    ],
  },
  {
    v: '5.90', date: '2026-08-13',
    title: { tr: 'Siparişler’de sütun başlığı filtreleri doğru listeyi gösteriyor', en: 'Orders column filters now list the right values' },
    items: [
      { tr: 'Siparişler ekranındaki sütun başlığı filtreleri, seçenek listesini Siparişler tablosundan değil CP tablosundan üretiyordu. Bu yüzden Siparişler’de gerçekten bulunan bazı değerler listede hiç görünmüyor, CP’ye özgü değerler ise gereksiz yere görünüyordu. Liste artık Siparişler satırlarından üretiliyor.', en: 'The column header filters on the Orders screen built their option list from the CP table instead of the Orders table, so some values actually present in Orders never appeared while CP-only values did. The list is now built from the Orders rows.' },
      { tr: 'Çapraz filtre hesabı bir sebeple yapılamazsa artık yanlış tablonun satırlarına düşülmüyor; en azından Siparişler’in tüm satırları kullanılıyor.', en: 'If the cross-filter calculation cannot be made for some reason, the fallback no longer uses the wrong table’s rows; all Orders rows are used instead.' },
    ],
  },
  {
    v: '5.89', date: '2026-08-12',
    title: { tr: 'Yenileme sayacına tıklayınca aşama süreleri', en: 'Click the refresh counter for stage timings' },
    items: [
      { tr: 'Yenileme sırasında görünen sayaç artık tıklanabilir. Açılan panel aşamaları (sunucu sorgusu, karşılaştırma, kaydetme) ve her birinin kaç saniye sürdüğünü gösterir; yenileme sürerken canlı güncellenir.', en: 'The counter shown during a refresh is now clickable. The panel that opens lists the stages (server query, comparison, saving) with the seconds each one took, updating live while the refresh runs.' },
      { tr: 'Panelin ikinci bölümü her veri bağlantısı için sunucu sorgusu / veri yazımı / ayrıştırma sürelerini ve satır sayısını ayrı ayrı verir. Bu döküm sorgular bittiğinde oluştuğu için o ana kadar sebebi yazılır.', en: 'The second section of the panel breaks down server query, data write and parse time per data connection, along with the row count. That breakdown only exists once the queries finish, and the panel says so until then.' },
      { tr: 'Bu bilgiler önceden yalnız yenileme bittikten sonra tek satırlık bir bildirimde görünüyordu; artık istendiği zaman açılıp incelenebiliyor.', en: 'This information previously appeared only in a single-line notification after the refresh finished; it can now be opened and inspected at any time.' },
    ],
  },
  {
    v: '5.88', date: '2026-08-12',
    title: { tr: 'Edge bağlantı kurulumu doğru sayfayı açıyor', en: 'Edge connection setup opens the right page' },
    items: [
      { tr: 'Mevcut Edge profilini bağla düğmesi Edge’in Cihazlar sayfasını açıyor ve kullanıcıdan soldaki Remote debugging bölümüne kendisinin geçmesi bekleniyordu; seçeneği bulamayanlar oldu. Artık doğrudan edge://inspect/#remote-debugging açılıyor.', en: 'The Connect current Edge profile button opened Edge’s Devices page and expected the user to switch to the Remote debugging section on the left, which many could not find. It now opens edge://inspect/#remote-debugging directly.' },
      { tr: 'Yönerge metni de netleştirildi: kutu görünmüyorsa adresi elle yazma, hâlâ yoksa Edge’i güncelleme adımı eklendi. Bu seçenek yalnız yeni Edge sürümlerinde bulunuyor.', en: 'The instructions were clarified with a step for typing the address manually and, failing that, updating Edge — the option exists only in recent Edge versions.' },
      { tr: 'Bağlantı aranırken artık tek bir Edge profil klasörüne bakılmıyor: Beta, Dev ve Canary kanalları ile macOS/Linux yolları da taranıyor, dosya bulunamazsa yaygın hata ayıklama portları doğrudan yoklanıyor. Remote debugging açık olmasına rağmen bağlanamama vakalarının bir kısmı bu yüzdendi.', en: 'Connection discovery no longer looks at a single Edge profile folder: the Beta, Dev and Canary channels and the macOS/Linux paths are scanned too, and if no file is found the common debugging ports are probed directly. Some cases of “remote debugging is on but it will not connect” came from this.' },
      { tr: 'Otomasyon Ayarları’na “Neden bağlanmıyor?” düğmesi eklendi: Edge bulundu mu, hangi profil klasörlerine bakıldı, hata ayıklama dosyası var mı ve portta cevap alınıyor mu — hepsi tek satırda raporlanıyor.', en: 'A “Why not connecting?” button was added to Automation Settings, reporting in one line whether Edge was found, which profile folders were checked, whether the debugging file exists and whether the port responds.' },
    ],
  },
  {
    v: '5.87', date: '2026-08-12',
    title: { tr: 'Backlog Ayarlar sayfasına nakliye yol süreleri', en: 'Transit lead times added to the Backlog settings sheet' },
    items: [
      { tr: 'Backlog Excel’inin Ayarlar sayfasına NAKLİYE YOL SÜRELERİ tablosu eklendi: raporda kullanılan Transfer Lead Time kuralları ile her yükleme tipinin varsayılan süresi, kaynak/sezon/ülke/tarih aralığı bilgileriyle birlikte listeleniyor.', en: 'A TRANSIT LEAD TIMES table was added to the settings sheet of the Backlog Excel, listing the transfer lead-time rules used in the report plus the default for each loading type, together with source, season, country and date range.' },
      { tr: 'BACKLOG sayfasındaki yol süresi artık formüle gömülü bir sayı değil, bu tablodaki Gün hücresine bağlı. Ayarlar sayfasında bir Gün değerini elle değiştirdiğinde Antrepo Giriş Tarihi, gecikme bayrakları ve Risk aynı dosyada yeniden hesaplanır.', en: 'The lead time on the BACKLOG sheet is no longer a number baked into the formula but a link to the Day cell in that table. Editing a Day value on the settings sheet recalculates the warehouse arrival date, the delay flags and the risk within the same file.' },
      { tr: 'Sayfada YÜKLEME TİPİ değiştirilirse satır, o tipin varsayılan süresine düşer — bu değer de tablodan okunur.', en: 'If the loading type is changed on the sheet, the row falls back to that type’s default lead time, which is also read from the table.' },
    ],
  },
  {
    v: '5.86', date: '2026-08-12',
    title: { tr: 'Backlog Excel’indeki sarı renklendirmeler artık dosyaya giriyor', en: 'Backlog Excel highlights now reach the file' },
    items: [
      { tr: 'REVİZE YÜKLEME TARİHİ (EX-FACTORY) ve YÜKLEME TİPİ sarı renklendirmeleri, v5.75’te yazılmış olmasına rağmen indirilen dosyada hiç görünmüyordu. Kurallar yalnız sunucu tarafındaki dışa aktarım yoluna bağlanmıştı; Backlog ekranındaki Excel’e Aktar düğmesi ise çalışma kitabını tarayıcıda ürettiği için kurallar dosyaya hiç yazılmıyordu. Artık her iki yol da aynı kuralları taşıyor.', en: 'The yellow highlights on REVISED LOADING DATE (EX-FACTORY) and LOADING TYPE never appeared in the downloaded file even though they were written in v5.75. The rules were wired only into the server-side export path, while the Export to Excel button on the Backlog screen builds the workbook in the browser, so the rules were never written to the file. Both paths now carry the same rules.' },
      { tr: 'Aynı düzeltme Backlog detay penceresinden yapılan dışa aktarımı da kapsıyor.', en: 'The same fix covers exports made from the Backlog detail window.' },
    ],
  },
  {
    v: '5.85', date: '2026-08-12',
    title: { tr: 'Koleksiyon’da sütun dondurma, A→Z sütun seçici, iki kademe görsel', en: 'Collection freeze fix, A–Z column chooser, two image sizes' },
    items: [
      { tr: 'Koleksiyon’da sütun dondurma yarım çalışıyordu: dondurulan aralıktaki düzenlenebilir sütunlar yapışmıyor, yanlarındaki sütunlar yapışıyordu. Sebep bir stil çakışmasıydı — düzenlenebilir hücrelerin kendi konumlandırma kuralı dondurma kuralını bastırıyordu. Artık yalnız dondurulmuş hücrede dondurma kazanıyor; CP ve Siparişler de aynı korumayı aldı.', en: 'Column freezing worked only halfway on Collection: editable columns inside the frozen range did not stick while their neighbours did. A style conflict was the cause — the positioning rule on editable cells overrode the freeze rule. Freezing now wins on frozen cells only, and CP and Orders received the same protection.' },
      { tr: 'Sütun seçici penceresindeki seçenekler her sayfada A’dan Z’ye sıralanıyor. Sıralama Türkçe harf sırasına göre yapılır ve sayı içeren adlar doğal sırada gelir. Sütun sırası eskisi gibi başlık sürükleyerek değişir.', en: 'The options in the column chooser are now sorted A to Z on every page, using Turkish letter order, with numbered names in natural order. Column order is still changed by dragging headings.' },
      { tr: 'Koleksiyon görsel boyutunda en küçük kademe kaldırıldı; Orta ve Büyük olmak üzere iki kademe kaldı. Başlığa tıklayınca ikisi arasında geçilir. Ayarı küçükte kalmış kullanıcılar orta kademeye taşınır.', en: 'The smallest image-size step was removed from Collection, leaving Medium and Large. Clicking the heading switches between them, and anyone whose saved setting was the small step is moved to medium.' },
    ],
  },
  {
    v: '5.84', date: '2026-08-12',
    title: { tr: 'Yenileme sonrası güncelleme notları kendiliğinden açılıyor', en: 'Update notes open automatically after a refresh' },
    items: [
      { tr: 'Yenileme bittiğinde değişiklik bulunduysa ASAS & ANTREPO Geçmişi penceresi doğrudan o yenilemenin kaydında kendiliğinden açılıyor. Önceden sonuç yalnız Genel Bakış ekranındaki karta yazılıyordu; o ekranda değilsen neyin değiştiğini görmüyordun.', en: 'When a refresh finds changes, the ASAS & ANTREPO History window now opens by itself on that refresh’s record. Previously the result was only written to the card on the Overview screen, so you would not see what changed unless you were on that screen.' },
      { tr: 'Değişiklik yoksa pencere açılmaz; okunacak bir not yokken pencere açmak yalnız rahatsız ederdi. Ekranda başka bir açılır pencere varken de araya girilmez.', en: 'The window does not open when there are no changes, since opening it with nothing to read would only get in the way. It also stays out of the way while another dialog is open.' },
      { tr: 'Pencerenin alt kenarındaki kutucuktan bu davranış kapatılabilir; tercih hatırlanır ve sonuç kartı Genel Bakış’ta durmaya devam eder.', en: 'The behaviour can be switched off from the checkbox at the bottom of the window; the preference is remembered and the result card remains on the Overview screen.' },
    ],
  },
  {
    v: '5.83', date: '2026-08-12',
    title: { tr: 'Backlog rapor penceresindeki boş hücreler dolduruldu', en: 'Blank cells in the Backlog report window fixed' },
    items: [
      { tr: 'CP ve Siparişler ekranında Status hücresine çift tıklayınca açılan Sipariş Backlog Raporu’nda parsiyel satırları görünüyor ama Güncel Durum, Adet, Buyer Grup, Retail ve Model Bütçe tarihleri gibi hücrelerin çoğu boş geliyordu. Pencere sütun başlıklarını Backlog Excel başlık listesinden alıyor, satırlar ise ayrı ve kısaltılmış bir anahtar kümesiyle üretiliyordu; eşleşmeyen her anahtar boş hücre demekti.', en: 'In the Order Backlog Report opened by double-clicking a Status cell on CP and Orders, the partial rows appeared but most cells — current status, quantity, buyer group, retail and model-budget dates — came back empty. The window took its column headings from the Backlog Excel header list while the rows were produced with a separate, shortened set of keys, so every unmatched key rendered as a blank cell.' },
      { tr: 'Rapor satırları ile Backlog Excel satırları artık tek bir ortak eşlemeden geçiyor, dolayısıyla bir daha ayrışamazlar. Lisans, Risk, hafta/ay sütunları ve buying note gibi hiç üretilmeyen alanlar da artık geliyor.', en: 'Report rows and Backlog Excel rows now go through one shared mapping and can no longer drift apart. Fields that were never produced at all — licence, risk, the week/month columns and the buying note — now appear as well.' },
    ],
  },
  {
    v: '5.82', date: '2026-08-12',
    title: { tr: 'Nakliye kartları sadeleşti, uygulama adı düzeltildi', en: 'Slimmer shipping cards and a corrected app name' },
    items: [
      { tr: 'Navlun Hesaplama’daki “Landed çarpanı (FOB × …)” alanının adı “Ekstra Masraf Çarpanı (FOB × …)” oldu. Yalnız görünen etiket değişti; hesap ve kayıtlı ayarlar aynı.', en: 'The “Landed multiplier (FOB × …)” field in the Freight Calculator is now “Extra Costs Multiplier (FOB × …)”. Only the visible label changed; the calculation and stored settings are unchanged.' },
      { tr: 'Nakliye Kıyaslama kartlarında fiyatın hemen altındaki tekrar eden etiket (SOURCE PRICE, SEA LANDED, AIR LANDED…) kaldırıldı — kart başlığı zaten aynı bilgiyi veriyordu.', en: 'The repeated label under the price on the Shipping Comparison cards (SOURCE PRICE, SEA LANDED, AIR LANDED…) was removed, since the card heading already carried the same information.' },
      { tr: 'Kartların yüksekliği en aza indirildi: dolgu, satır aralıkları ve giriş kutusu yüksekliği kısıldı. Yazı boyutları okunaklılık için korundu.', en: 'Card height was reduced to a minimum by trimming padding, row spacing and input height. Font sizes were kept for readability.' },
      { tr: 'Uygulama adı artık her yerde yalnız “Buyer Log”: tarayıcı sekmesi, sunucu açılış satırı, başlatıcı penceresi ve üretilen Excel dosyalarının bilgi alanı.', en: 'The application is now called simply “Buyer Log” everywhere: the browser tab, the server start-up line, the launcher window and the metadata of generated Excel files.' },
    ],
  },
  {
    v: '5.81', date: '2026-08-12',
    title: { tr: 'Excel tarihlerindeki bir gün kayması giderildi', en: 'One-day shift in Excel dates fixed' },
    items: [
      { tr: 'Excel’e yazılan tarihler bir gün geriye kayıyordu (2.01.26 hücrede 01.01.26 görünüyordu). Sebep: kullanılan Excel motoru tarihi UTC üzerinden gün sayısına çeviriyordu; Türkiye UTC+3 olduğu için yerel gece yarısı bir önceki güne düşüyordu. Tarihler artık takvim gününden hesaplanan tam sayı gün numarası olarak yazılıyor ve hiçbir saat dilimi dönüşümünden geçmiyor.', en: 'Dates written to Excel shifted one day back (2 Jan appeared as 1 Jan). The Excel engine converted dates to day numbers via UTC, so local midnight fell into the previous day in UTC+3. Dates are now written as a whole day number derived from the calendar day, with no timezone conversion at any point.' },
      { tr: 'Aynı sorunun aynası okuma tarafında da vardı: Excel’den okunan bir tarih “bir önceki gün 23:59:04” olarak geri gelebiliyordu. Okunan tarihler artık gün başına oturtuluyor; gerçek saat taşıyan zaman damgaları etkilenmiyor.', en: 'The mirror of the same problem existed when reading: a date could come back as “the previous day at 23:59:04”. Dates read from Excel are now snapped to the start of the day, while genuine timestamps are left untouched.' },
      { tr: 'Otomasyon ve ajan katmanında tarih karşılaştırmaları da aynı sebeple bir gün kayabiliyordu; onlar da takvim gününü doğrudan okuyacak şekilde düzeltildi.', en: 'Date comparisons in the automation and agent layer could shift by a day for the same reason and now read the calendar day directly.' },
      { tr: 'Antrepo ve ASAS ana okuma yolu zaten doğruydu; oradan gelen veriler etkilenmemişti. Yazma ve okuma kancaları artık sunucunun tüm Excel giriş noktalarında ve tarayıcıda kurulu.', en: 'The main Antrepo and ASAS read path was already correct and unaffected. The read and write hooks are now installed at every Excel entry point on the server as well as in the browser.' },
    ],
  },
  {
    v: '5.80', date: '2026-08-12',
    title: { tr: 'Çoklu navlun hesabı, ESC kademesi ve Ctrl+C', en: 'Multi-order freight, stepwise ESC and Ctrl+C' },
    items: [
      { tr: 'Navlun Hesaplama artık birden fazla satırla açılabiliyor. Her sipariş KENDİ adedi ve fiyatıyla ayrı hesaplanır — koli sayısı, CBM ve charchable weight satır başına farklıdır. Alttaki toplam satırı adede göre ağırlıklı ortalamadır ve tek düğmeyle bütün siparişlere uygulanabilir.', en: 'The Freight Calculator now opens with more than one row. Every order is calculated with its own quantity and price, since carton count, CBM and chargeable weight differ per row. The total line is a quantity-weighted average and can be applied to every order at once.' },
      { tr: 'Koli ölçüleri üç ayrı geniş alan yerine tek satırda üç dar kutu (En × Boy × Yükseklik) ve varsayılan olarak 58 × 38 × 30 geliyor. Çoklu hesapta koli ölçüsü ve kg/adet tek düğmeyle tüm siparişlere kopyalanabiliyor.', en: 'Carton dimensions are now three compact boxes on one line (L × W × H) instead of three wide fields, and default to 58 × 38 × 30. In multi-order mode the carton size and kg/piece can be copied to every order with one button.' },
      { tr: 'Landed çarpanı eklendi ve ayarlanabilir. Landed = (FOB × çarpan) + birim navlun; çarpan navluna uygulanmaz. Varsayılan 1’dir, yani kaynak Excel’in sonucunu değiştirmez. Nakliye Kıyaslama’daki Gemi landed sütunu FOB × 1,11 ile hesaplandığından burayı 1,11 yapmak üç yükleme tipini aynı tabana oturtur.', en: 'An adjustable landed multiplier was added. Landed = (FOB × multiplier) + freight per piece; the multiplier is not applied to the freight. It defaults to 1, so the source workbook result is unchanged. Setting it to 1.11 puts all three shipment types on the same basis as the Sea landed column.' },
      { tr: 'Açılır pencere üzerinde tekerlek çevirince arkadaki sayfa artık kaymıyor.', en: 'Scrolling over a dialog no longer scrolls the page behind it.' },
      { tr: 'ESC açılır pencereleri kapatıyor; üst üste pencere varsa her ESC yalnız en üsttekini kapatıyor. Odak pencerenin dışındayken de çalışıyor.', en: 'ESC closes dialogs, and with stacked dialogs each press closes only the topmost one. It now works even when focus is outside the dialog.' },
      { tr: 'Ctrl+C (macOS’ta Cmd+C) etkin sayfanın Kopyala düğmesini çalıştırıyor. Bir alana yazarken, metin seçiliyken veya açık pencere varken devreye girmiyor.', en: 'Ctrl+C (Cmd+C on macOS) triggers the active page’s Copy button. It stays out of the way while typing, while text is selected, or while a dialog is open.' },
    ],
  },
  {
    v: '5.79', date: '2026-08-12',
    title: { tr: 'Koleksiyon kopyalaması Excel aktarımıyla aynı değerleri veriyor', en: 'Collection copy now matches the Excel export' },
    items: [
      { tr: 'Koleksiyon satırlarını Copy ile kopyalarken Landed sütunlarına hesaplanan landed fiyat yerine karttaki ilk kutunun değeri (TR Landed’de TL fiyatı, Overseas Landed’de boş çarpan) düşüyordu. Artık her iki sütun da Excel aktarımındaki sayıyı taşıyor ve Excel’de metin değil sayı olarak yapışıyor.', en: 'When copying Collection rows, the Landed columns carried the first input in the cell (the TL price for TR Landed, the empty multiplier for Overseas Landed) instead of the calculated landed price. Both columns now carry the same number as the Excel export and paste as a number rather than text.' },
      { tr: 'Endeksmatik hücresinin iki satırı kopyalarken ayırıcısız birbirine yapışıyordu. Artık dışa aktarımdaki gibi fiyat satırı ve endeks satırı ayrı satırlar olarak, tek hücre içinde kopyalanıyor.', en: 'The two lines of the Endeksmatik cell used to run together when copied. They now copy as separate lines inside a single cell, exactly as in the export.' },
      { tr: 'İçinde satır sonu, sekme veya tırnak bulunan hücreler düz metin panosunda tırnaklanıyor; böylece tek hücre birden çok satıra veya sütuna dağılmıyor.', en: 'Cells containing line breaks, tabs or quotes are quoted in the plain-text clipboard so a single cell no longer spills across rows or columns.' },
    ],
  },
  {
    v: '5.78', date: '2026-08-11',
    title: { tr: 'Navlun hesabında sayılar iki basamakla gösterilir', en: 'Freight figures now show two decimals' },
    items: [
      { tr: 'Navlun Hesaplama kartındaki tüm sayılar virgülden sonra iki basamakla gösterilir. CBM üç basamaktan, birim navlun dört basamaktan ikiye indi. Toplam koli tam sayı olarak kalır.', en: 'Every figure in the Freight Calculator now shows two decimals. CBM dropped from three and per-piece freight from four. The carton count stays a whole number.' },
      { tr: 'Uygula ile satıra yazılan Landed fiyat da iki basamağa yuvarlanır; kartta görünen sayı ile hücreye düşen sayı artık aynıdır.', en: 'The landed price written into the row by Apply is rounded to two decimals as well, so the figure on the card and the figure in the cell now match.' },
    ],
  },
  {
    v: '5.77', date: '2026-08-11',
    title: { tr: 'Navlun hesabında Toplam Koli yukarı yuvarlanır', en: 'Freight calculation now rounds total cartons up' },
    items: [
      { tr: 'Toplam Koli artık her zaman yukarı yuvarlanır. Kaynak Excel bu hücreyi tam sayı gösteriyor ama değerini ondalıklı bırakıyordu; yarım koli yüklenmediği için CBM ve brüt kilogram artık gerçek koli sayısıyla hesaplanır. Sonuçlar kaynak dosyadan bir miktar yüksek çıkar, bu fark kasıtlıdır.', en: 'The total carton count is now always rounded up. The source workbook displayed this cell as a whole number while keeping a fractional value; since half a carton is never shipped, CBM and gross weight are now calculated from the real carton count. Results come out slightly higher than the source file, and that difference is intentional.' },
      { tr: 'Adet koli başı adede tam bölünüyorsa yuvarlama hiçbir şey eklemez; tek adet bile taşarsa yeni koli açılır.', en: 'When the quantity divides exactly the rounding adds nothing; a single piece over opens a new carton.' },
    ],
  },
  {
    v: '5.76', date: '2026-08-11',
    title: { tr: 'Nakliye Kıyaslama’da Navlun Hesaplama', en: 'Freight calculation in Shipping Comparison' },
    items: [
      { tr: 'Nakliye Kıyaslama araç çubuğuna Navlun Hesapla eklendi. Çeki listesindeki kg/adet, adet, koli başı adet ve koli ölçüleri girilince Toplam Koli, CBM, Brüt Kilogram ve Charchable Weight hesaplanır; hangi ağırlığın faturalandığı (brüt mü hacimsel mi) kartta işaretlenir.', en: 'A Freight Calculator was added to the Shipping Comparison toolbar. Entering kg/piece, quantity, pieces per carton and carton dimensions from the packing list produces total cartons, CBM, gross weight and chargeable weight, and marks which weight is actually being charged.' },
      { tr: 'Her navlun rotası için navlun toplamı, birim navlun ve Landed fiyat listelenir. Uygula düğmesi sonucu doğrudan satıra yazar: Uçak ücretleri YD Fiyat (USD) Landed Uçak, Gemi+Uçak ücretleri YD Fiyat (USD) Landed Gemi+Uçak sütununa gider. Bu iki sütun daha önce elle dolduruluyordu.', en: 'For every freight route the total freight, per-piece freight and landed price are listed. Apply writes the result straight into the row: air rates into Landed Air, sea+air rates into Landed Sea+Air. Both columns were previously filled by hand.' },
      { tr: 'Tablonun başındaki navlun ücretleri artık program içinde güncellenebilir ve tüm kullanıcılar için ortak saklanır. Rota eklenip çıkarılabilir, hacimsel ağırlık katsayısı (varsayılan 167) değiştirilebilir. Ücret değiştirme iş kuralları yetkisine bağlıdır; hesap yapmak herkese açıktır.', en: 'The freight rates at the top of the table can now be updated inside the app and are stored centrally for everyone. Routes can be added or removed and the volumetric factor (167 by default) can be changed. Editing rates requires the business-rules permission; calculating is open to everyone.' },
      { tr: 'Girilen çeki listesi değerleri satırda saklanır, hesap yeniden açıldığında kaldığı yerden devam eder. Satır seçilmeden açılırsa hesap serbest modda çalışır ve hiçbir satırı değiştirmez.', en: 'Packing-list values are stored on the row so reopening the calculator resumes where it left off. Opened without a selected row it runs in standalone mode and changes nothing.' },
    ],
  },
  {
    v: '5.75', date: '2026-08-11',
    title: { tr: 'Backlog vurguları duruma göre biçimlendirme oldu', en: 'Backlog highlights became conditional formatting' },
    items: [
      { tr: 'REVİZE YÜKLEME TARİHİ (EX-FACTORY) ve YÜKLEME TİPİ sarıları artık hücreye gömülü dolgu değil, Excel koşullu biçimlendirme kuralı. Dosya içinde elle değişiklik yapıldığında renk kendiliğinden güncellenir.', en: 'The yellow highlights on REVISED LOADING DATE (EX-FACTORY) and LOADING TYPE are now Excel conditional-formatting rules instead of baked-in fills, so they update themselves when the file is edited by hand.' },
      { tr: 'Revize Ex-Factory hücresi yalnız raporun oluşturulduğu günden önceye kalmışsa (ve sipariş Üretimde ise) sarı olur; elle ileri bir tarihe revize edildiğinde sarı kalkar.', en: 'The revised Ex-Factory cell turns yellow only while its date stays before the report date (and the order is in Production); revising it to a later date clears the highlight.' },
      { tr: 'YÜKLEME TİPİ hücresinin sarısı RİSK (PRIORITY) sütununa bağlandı. Gemi yüklemesi Gemi+Uçak\'a alınıp risk YOK\'a düştüğünde sarı kalkar.', en: 'The loading-type highlight is now tied to the RISK (PRIORITY) column: switching a Sea shipment to Sea+Air clears it as soon as the risk drops back to NO.' },
    ],
  },
  {
    v: '5.74', date: '2026-08-11',
    title: { tr: 'Backlog risk ve gecikme vurguları', en: 'Backlog risk and delay highlights' },
    items: [
      { tr: 'Backlog Excel raporunda RİSK (PRIORITY) artık ANTREPO-RETAIL 5 veya daha düşükse YOK, 5 üzerindeyse VAR olur.', en: 'In the Backlog Excel report, RISK (PRIORITY) is now NO when ANTREPO-RETAIL is 5 or less, and YES when it is above 5.' },
      { tr: 'Üretimdeki siparişlerde revize Ex-Factory tarihi raporun çekildiği günden eskiyse ilgili hücre soft sarı ile vurgulanır.', en: 'For orders in Production, the revised Ex-Factory cell is highlighted soft yellow when its date is before the report date.' },
      { tr: 'Gemi/Sea yükleme tipinde ANTREPO-RETAIL 5 günden büyükse YÜKLEME TİPİ hücresi soft sarı ile vurgulanır.', en: 'For Sea/Ship delivery types, the YÜKLEME TİPİ cell is highlighted soft yellow when ANTREPO-RETAIL exceeds 5 days.' },
    ],
  },
  {
    v: '5.73', date: '2026-08-11',
    title: { tr: 'Backlog üretici tükleme teyidi ve sade Excel', en: 'Backlog manufacturer loading confirmation and simplified Excel' },
    items: [
      { tr: 'Backlog Excel raporunda ANTREPO-RETAIL sütununun yanına Üretici Tükleme Tipi Teyidi sütunu eklendi. Tüm siparişler VAR ile başlar ve yalnız VAR/YOK seçilebilir.', en: 'Added a Manufacturer Loading Type Confirmation column next to ANTREPO-RETAIL in Backlog Excel. All orders start as VAR and only VAR/YOK can be selected.' },
      { tr: 'Backlog Excel dışa aktarımında Pivot ve PivotVeri sayfaları artık oluşturulmaz; rapor yalnız BACKLOG ve Ayarlar sayfalarını içerir.', en: 'Backlog Excel export no longer creates Pivot or PivotVeri sheets; the report contains only BACKLOG and Settings.' },
    ],
  },
  {
    v: '5.72', date: '2026-08-11',
    title: { tr: 'Orders/CP Backlog detay veri bütünlüğü', en: 'Orders/CP Backlog detail data integrity' },
    items: [
      { tr: 'Orders veya CP sayfasında bir siparişin STATUS hücresine çift tıklanarak açılan Backlog raporunda, ASAS tarafında boş kalan sunum alanları artık çift tıklanan satırdaki çözülmüş değerlerden güvenli şekilde tamamlanır.', en: 'When a Backlog report is opened by double-clicking an order STATUS cell in Orders or CP, presentation fields that are blank on the ASAS side are safely completed from the resolved values of the clicked source row.' },
      { tr: 'Operasyonel miktar, IAS parsiyelleri, durum ve Antrepo hesapları bu fallback mekanizmasından etkilenmez; bunlar yine ASAS/IAS verilerinden hesaplanır.', en: 'Operational quantities, IAS partials, statuses and Antrepo calculations are not affected by this fallback; they continue to be calculated from ASAS/IAS data.' },
    ],
  },
  {
    v: '5.70', date: '2026-08-11',
    title: { tr: 'Overseas Landed ağırlıklı yüzde değişim', en: 'Overseas Landed weighted percentage change' },
    items: [
      { tr: 'Koleksiyon tablosunda Overseas Landed sütununun alt özetine adet ağırlıklı yüzde değişim bilgisi eklendi. Hesap yalnız hem Overseas Landed hem TR Landed değeri bulunan satırları ve satır adetlerini kullanır; (TR ağırlıklı ortalama − Overseas ağırlıklı ortalama) / TR ağırlıklı ortalama formülü uygulanır.', en: 'A quantity-weighted percentage change was added to the Overseas Landed footer summary. The calculation uses only rows that have both Overseas Landed and TR Landed values and weights them by row quantity, using (TR weighted average − Overseas weighted average) / TR weighted average.' },
      { tr: 'Pozitif ağırlıklı değişim yeşil, negatif değişim kırmızı metin olarak gösterilir; mevcut ağırlıklı ve aritmetik fiyat ortalamaları korunur.', en: 'A positive weighted change is shown as green text and a negative change as red text, while the existing weighted and arithmetic price averages remain unchanged.' },
    ],
  },
  {
    v: '5.68', date: '2026-08-11',
    title: { tr: 'Quotation ekranında Koleksiyon görselleri', en: 'Collection images in Quotations' },
    items: [
      { tr: 'Koleksiyon model görselleri Quotations ekranında artık yalnız eski picture alanından değil, modelin güncel Koleksiyon görsel kaynağından da çözülür. Sunucuda imgRef ile saklanan görseller /api/collection-images üzerinden gösterilir; bu nedenle daha önce oluşturulmuş quotation kayıtları da güncel görseli gösterebilir.', en: 'Collection model images in Quotations are now resolved from the current Collection image source rather than only the legacy picture field. Images stored by imgRef are shown through /api/collection-images, so existing quotation records can also display the current image.' },
      { tr: 'Yeni quotation kayıtları oluşturulurken görsel kaynağı img veya imgRef fark etmeksizin kayda alınır; Pricing History ve Quotation Excel hazırlığı da aynı çözümleme mantığını kullanır.', en: 'When new quotation records are created, the image source is captured regardless of whether the Collection row uses img or imgRef; Pricing History and Quotation Excel preparation use the same resolution logic.' },
    ],
  },
  {
    v: '5.67', date: '2026-08-11',
    title: { tr: 'Antrepo Excel Risk kuralı', en: 'Antrepo Excel Risk rule' },
    items: [
      { tr: 'Antrepo/Backlog Excel raporunda RİSK (PRIORITY) alanı artık ANTREPO-RETAIL değerini doğrudan takip eder: değer 0 veya negatifse YOK, pozitifse VAR yazılır. Excel içindeki ANTREPO-RETAIL formülü değiştiğinde Risk değeri de yeniden hesaplanır.', en: 'In the Antrepo/Backlog Excel report, RISK (PRIORITY) now follows ANTREPO-RETAIL directly: zero or negative produces NO, while a positive value produces YES. When the ANTREPO-RETAIL formula changes in Excel, Risk recalculates as well.' },
    ],
  },
  {
    v: '5.66', date: '2026-08-11',
    title: { tr: 'Backlog In Store tarih filtresi', en: 'Backlog In Store date filter' },
    items: [
      { tr: 'Backlog sayfasının üst zaman filtrelerine In Store başlangıç/bitiş aralığı eklendi. Filtre ASAS Model Bütçe Tarihi üzerinden çalışır; ekran, pivot detayı ve Excel export aynı In Store tarih aralığını kullanır.', en: 'An In Store from/to range was added to the Backlog top date filters. It uses the ASAS Model Budget Date, and the screen, pivot detail, and Excel export all use the same In Store date range.' },
    ],
  },
  {
    v: '5.65', date: '2026-08-10',
    title: { tr: 'Otomasyon veri koşulları, değişim tetikleyicisi ve hızlı e-posta', en: 'Automation data conditions, change trigger and faster email' },
    items: [
      { tr: 'Veri kaynağı ve koşullar bölümündeki alan seçimi arama destekli hale getirildi. Dahili _ / __ alanları kullanıcı listesinden çıkarıldı; ASAS ve IAS ham database başlıkları ayrı veri kaynakları olarak seçilebilir.', en: 'Field selection in Data Source and Conditions is now searchable. Internal _ / __ fields are removed from the user list, while raw ASAS and IAS database headers are available as separate data sources.' },
      { tr: 'Koşullara “Değiştiğinde” operatörü eklendi. Örneğin Ex-factory alanı seçildiğinde ilk gerçek çalışma mevcut değerleri başlangıç olarak kaydeder; sonraki çalışmalarda yalnız önceki değere göre değişen kayıtlar eşleşir.', en: 'A “When changed” operator was added. For example, when Ex-factory is selected, the first real run stores current values as the baseline and later runs match only rows whose value changed.' },
      { tr: 'Koşulun Değer alanı seçilen kolonun canlı değerlerini önerir; kullanıcı listeden seçim yapabildiği gibi serbest metin de yazabilir.', en: 'The condition Value field suggests live values from the selected column while still allowing free-text entry.' },
      { tr: 'Prepare E-Mail ekranındaki kayıtlı üretici/e-posta grupları Otomasyon e-posta grubu listesine otomatik dahil edilir. Bu kayıtlar Otomasyon Ayarlarında salt okunur gösterilir ve asıl Prepare E-Mail ekranından yönetilir.', en: 'Saved manufacturer/email groups from Prepare E-Mail are automatically included in the Automation email-group list. They are shown read-only in Automation Settings and remain managed from Prepare E-Mail.' },
      { tr: 'Raporda gösterilecek alanlara arama eklendi; seçilmiş alanlar her zaman listenin üstüne taşınır.', en: 'Search was added to report-field selection, and selected fields are always moved to the top of the list.' },
      { tr: 'Manuel otomasyonda onaylanan ön izleme veri snapshotı gerçek çalıştırmada yeniden kullanılır; aynı dataset gereksiz yere ikinci kez hazırlanmaz. .eml taslağını açma işlemi de sunucu yanıtını bekletmeyen asenkron moda alındı.', en: 'Manual automation now reuses the data snapshot confirmed in Preview, avoiding a redundant second dataset build. Opening .eml drafts is also asynchronous so it no longer blocks the server response.' },
    ],
  },
  {
    v: '5.64', date: '2026-08-10',
    title: { tr: 'Otomasyonlarda mevcut Edge profili ve oturum paylaşımı', en: 'Existing Edge profile and session sharing for automations' },
    items: [
      { tr: 'Dış web otomasyonu artık varsayılan olarak ayrı/boş bir Managed Edge profili açmaz. Edge içindeki aktif kullanıcı veri dizinine bağlanır; şirket SSO oturumları, cookie oturumları ve kullanıcının normal Edge profilindeki giriş durumu korunur.', en: 'External web automation no longer opens a separate/empty Managed Edge profile by default. It attaches to the active Edge user-data directory so company SSO, cookie sessions and the user’s normal Edge sign-in state are preserved.' },
      { tr: 'Otomasyonlar ve Agent > Browser Ayarları içine kod gerektirmeyen “Mevcut Edge profilini bağla” ve “Bağlantıyı kontrol et” akışı eklendi. Edge bağlantısı kapalı olduğunda arayüz Remote debugging iznini açmanız için yönlendirir; izin aktifken Buyer Log çalışan Edge oturumunu otomatik bulur.', en: 'Automation and Agent Browser Settings now provide no-code “Connect current Edge profile” and “Check connection” actions. When the Edge connection is disabled, the UI guides the user to enable Remote debugging; while it is active, Buyer Log automatically discovers the running Edge session.' },
      { tr: 'Yeni otomasyon sekmesi doğrudan açık Buyer Log sekmesinden oluşturulur. Böylece birden fazla Edge profili olsa bile otomasyon sekmesi Buyer Log’un bulunduğu aynı profile ait olur.', en: 'New automation tabs are opened directly from the active Buyer Log tab, so even with multiple Edge profiles the automation tab stays in the same profile as Buyer Log.' },
      { tr: 'Recorder kodu mevcut Edge’deki tüm açık sayfalara kurulmaz; yalnız kaydedilen otomasyon sekmesi ve onun açtığı izinli popup/yeni sekmeler izlenir. Şifre, OTP, token, PIN ve CVV kaydetmeme kuralı ve HTTPS allowlist korunur.', en: 'Recorder instrumentation is not installed across every open page in the existing Edge session; only the recorded automation tab and its allowed popups/new tabs are monitored. Password, OTP, token, PIN and CVV exclusion and the HTTPS allowlist remain enforced.' },
    ],
  },
  {
    v: '5.63', date: '2026-08-10',
    title: { tr: 'Koleksiyon Best Price ortalamaları', en: 'Collection Best Price averages' },
    items: [
      { tr: 'Koleksiyon tablosunda Best Price sütununun altına, filtrelenmiş görünümdeki geçerli en iyi fiyatları kullanarak adet ağırlıklı ortalama ve aritmetik ortalama eklendi.', en: 'Added quantity-weighted and arithmetic averages under the Collection Best Price column using valid best prices from the filtered view.' },
      { tr: 'Best Price alt toplamı, Target Price, Conf. FOB, FOB ve Landed sütunlarıyla aynı ortak ortalama footer yapısını kullanır.', en: 'The Best Price summary now uses the same shared average footer structure as Target Price, Conf. FOB, FOB and Landed columns.' },
    ],
  },
  {
    v: '5.62', date: '2026-08-10',
    title: { tr: 'Koleksiyon hücre yerleşimi, görsel silme ve erişilebilir yazı boyutu', en: 'Collection cell layout, image removal and accessible text sizing' },
    items: [
      { tr: 'Koleksiyon hücreleri dikeyde ortalandı; Endeksmatik ve Landed istisnaları dışında hücre tipografisi tek boyuta getirildi. Hücreye sığmayan içerikler fareyle üzerine gelindiğinde tam metin ön izlemesinde gösterilir.', en: 'Collection cells are vertically centered and use one consistent type size except for Endeksmatik and compact Landed helper inputs. Truncated cells reveal their complete text in a hover preview.' },
      { tr: 'Koleksiyon görsellerinde sağ tık, genel sağ-tuş sürükleme katmanından ayrıldı ve CP ile aynı görsel kaldırma onayını güvenilir biçimde açar.', en: 'Right-click on Collection images now bypasses the global right-drag layer and reliably opens the same remove-image confirmation used by CP.' },
      { tr: 'Overseas/TR Landed kartları Endeksmatik kart yüksekliğine getirildi. Overseas fiyat avantajı hücrenin soluna taşındı ve yalnız değer yeşil/kırmızı renkle gösterilir.', en: 'Overseas/TR Landed cards now match Endeksmatik card height. Overseas price advantage is placed at the far left and is shown only as green/red text without a badge background.' },
      { tr: 'Endeksmatik USD/TL para değerleri Excel benzeri üçüncü hane yuvarlamasıyla iki ondalık gösterilir.', en: 'Endeksmatik USD/TRY money values now display exactly two decimals using Excel-like third-decimal rounding.' },
      { tr: 'Notes alanında ALT+ENTER ile oluşturulan çok satırlı metin kopyalanıp yapıştırıldığında satır sonları aynı hücre içinde korunur.', en: 'Multi-line Notes created with ALT+ENTER now keep their line breaks inside the same cell when copied and pasted.' },
      { tr: 'Araç/Columns gibi geçici menüler karşılıklı olarak kapanır. Tema düğmesinin altına kalıcı Varsayılan/+1/+2/+3 yazı boyutu kontrolü eklendi.', en: 'Transient menus such as Tools and Columns now close each other. A persistent Default/+1/+2/+3 text-size control was added directly below Theme.' },
    ],
  },
  {
    v: '5.61', date: '2026-08-10',
    title: { tr: 'Giriş profili ve kullanıcı şifresi kurtarma düzeltmesi', en: 'Login profile and user credential recovery fix' },
    items: [
      { tr: 'Buyer Log başlangıçta artık özel Managed Edge profiliyle açılmaz; kullanıcının normal/default tarayıcı profili kullanılır. Böylece mevcut Buyer Log oturumu, şirket SSO profili ve parola yöneticisi sürüm değişiminde korunur.', en: 'Buyer Log no longer opens in a special Managed Edge profile at startup; the user’s normal/default browser profile is used so the existing Buyer Log session, company SSO profile and password manager survive version changes.' },
      { tr: 'Controlled Browser Automation kaldırılmadı. Yönetilen Edge yalnız dış web kaydı veya otomasyon gerçekten başlatıldığında talep üzerine açılır; bu nedenle eski http://log, http://beta, http://chatgpt gibi hatalı başlangıç sekmeleri geri gelmez.', en: 'Controlled Browser Automation remains available. Managed Edge now launches on demand only when external web recording or automation is actually started, so the old malformed startup tabs such as http://log, http://beta and http://chatgpt do not return.' },
      { tr: 'Kalıcı kullanıcı şifre deposu ile eski sürüm depoları karşılaştırılırken yalnız dosya tarihi kullanılmaz; şifreli aktif kullanıcı sayısı, revizyon ve kullanıcı kapsamı dikkate alınır. Daha zengin eski depo bulunursa hatalı/taze auth dosyası güvenli yedek alınarak kurtarılır.', en: 'When comparing the persistent credential store with legacy version stores, file date alone is no longer used; credential-bearing active users, revision and user coverage are considered. A richer legacy store can recover a stale/fresh auth file after a safety backup is created.' },
    ],
  },
  {
    v: '5.60', date: '2026-08-10',
    title: { tr: 'Kullanıcı şifrelerinin sürümler arasında kalıcı tutulması', en: 'Persistent user credentials across app versions' },
    items: [
      { tr: 'Kullanıcı adı/şifre kayıtları artık sürüm klasörünün server/data alanına bağlı değildir; normal masaüstü kullanımında sürümden bağımsız Buyer Log uygulama verisi altında saklanır.', en: 'Username/password records are no longer tied to a version folder server/data directory; normal desktop use stores them under version-independent Buyer Log application data.' },
      { tr: 'İlk çalıştırmada mevcut veya kardeş eski Buyer Log klasöründeki geçerli user-access.json bulunursa şifre hashleri değiştirilmeden yeni kalıcı alana taşınır.', en: 'On first run, a valid user-access.json from the current or a sibling older Buyer Log folder is migrated to persistent storage without changing password hashes.' },
      { tr: 'Özel BUYER_LOG_SERVER_DATA_ROOT kullanan kurulumların mevcut davranışı korunur; yedekleme kapsamı kalıcı kimlik verilerini de içerir.', en: 'Installations using an explicit BUYER_LOG_SERVER_DATA_ROOT keep their existing behavior, and backup scope continues to include persistent identity data.' },
    ],
  },
  {
    v: '5.59', date: '2026-08-10',
    title: { tr: 'Browser recorder Search düğmesi erken yakalama düzeltmesi', en: 'Browser recorder early capture fix for Search actions' },
    items: [
      { tr: 'Kurumsal SPA sayfalarında Search/Submit gibi düğmeler DOM’u çok hızlı yenilediğinde normal click olayı kaybolabiliyordu. Semantik aksiyon düğmeleri artık pointerdown aşamasında, sayfa değişmeden önce kaydedilir.', en: 'On enterprise SPA pages, Search/Submit buttons could replace the DOM before the normal click event was recorded. Semantic action controls are now captured on pointerdown before the page changes.' },
      { tr: 'Aynı fiziksel tıklamanın pointerup/click olayları ikinci bir kayıt üretmez; buna karşılık kullanıcının gerçekten ikinci kez yaptığı tıklama ayrı adım olarak korunur.', en: 'Pointerup/click events from the same physical interaction do not create duplicate steps, while a genuine second click remains a separate recorded action.' },
      { tr: 'Form submit işlemleri için ek submitter fallback eklendi. Böylece Search alanına değer yaz → Search düğmesine bas akışı Fill + Click olarak güvenli biçimde tekrar oynatılabilir.', en: 'A submitter fallback was added for form submissions, so the fill Search field → click Search flow is preserved as replayable Fill + Click steps.' },
    ],
  },
  {
    v: '5.58', date: '2026-08-10',
    title: { tr: 'Başlangıçta açılan hatalı Edge sekmeleri düzeltildi', en: 'Fixed invalid Edge tabs opening at startup' },
    items: [
      { tr: 'Yönetilen Edge başlatıcısında boşluk içeren portable profil yolu native argüman olarak doğru tırnaklanmadığı için klasör adındaki Log, Beta, -, ChatGPT ve Agent parçaları Edge tarafından ayrı URL olarak yorumlanabiliyordu. Profil ve başlangıç URL argümanları artık güvenli biçimde tırnaklanır.', en: 'The managed Edge launcher did not native-quote portable profile paths containing spaces, so path words such as Log, Beta, -, ChatGPT and Agent could be interpreted by Edge as separate URLs. Profile and startup URL arguments are now quoted safely.' },
      { tr: 'Eski sürümlerin oluşturduğu http://log/, http://beta/, http://-/, http://chatgpt/ ve managed-edge yol sekmeleri karakteristik grup halinde bulunursa başlangıçta otomatik kapatılır; tek başına benzer bir intranet sekmesine dokunulmaz.', en: 'Legacy http://log/, http://beta/, http://-/, http://chatgpt/ and managed-edge path tabs are automatically closed at startup only when the characteristic group is detected, avoiding interference with a lone similarly named intranet tab.' },
      { tr: 'Edge crash/session geri yükleme balonu da yönetilen otomasyon profilinde devre dışı bırakıldı; Buyer Log açılışında yalnız Buyer Log sekmesi ve kullanıcının daha sonra bilinçli açtığı izinli otomasyon sekmeleri kalır.', en: 'The Edge crash/session restore bubble is disabled for the managed automation profile; Buyer Log startup now keeps only the Buyer Log tab and any allowlisted automation tabs deliberately opened later.' },
    ],
  },
  {
    v: '5.57', date: '2026-08-10',
    title: { tr: 'Otomasyonlar artık iş türüne göre no-code kuruluyor', en: 'Automations are now built no-code by job type' },
    items: [
      { tr: 'Yeni Otomasyon açıldığında önce temel iş sorulur: dış web işlemi, e-posta/periyodik rapor, veri sorgulama/analiz, Buyer Log içi işlem veya karma otomasyon. Editör yalnız seçilen işe uygun alanları gösterir.', en: 'New Automation first asks for the main job: external web task, email/scheduled report, data query/analysis, Buyer Log task, or mixed automation. The editor shows only fields relevant to the chosen job.' },
      { tr: 'Browser kaydındaki Yaz/Seç adımlarında kullanıcı artık {{item...}} kodu yazmaz. Kaydettiğim sabit değer veya Buyer Log alanından al seçilir ve Order Code, PLM ID gibi canlı dataset alanları listeden bağlanır.', en: 'For recorded Fill/Select browser steps, users no longer type {{item...}} syntax. They choose Recorded fixed value or Use a Buyer Log field and bind Order Code, PLM ID, or other live dataset fields from a list.' },
      { tr: 'Ortak e-posta grupları eklendi. E-posta otomasyonları filtreli Buyer Log satırlarını HTML/CSV rapor olarak taslağa ekleyebilir; isteğe bağlı Outlook otomatik gönderim modu vardır.', en: 'Shared email groups were added. Email automations can include filtered Buyer Log rows as HTML/CSV reports in a draft, with an optional automatic Outlook send mode.' },
      { tr: 'E-posta otomasyonlarına günlük, haftalık veya saat aralıklı plan eklendi. Planlar Buyer Log sunucusu açık olduğu sürece deterministik olarak çalışır; scheduled browser işlemi otomatik etkinleştirilmez.', en: 'Email automations can run daily, weekly, or every N hours while the Buyer Log server is running; scheduled browser execution is not enabled automatically.' },
      { tr: 'Veri analizi için gruplama ve adet/toplam/ortalama/min/max özeti; Buyer Log içi işlemler için sayfa açma, veri yenileme ve sonuç raporu gösterme adımları eklendi.', en: 'Data analysis gained grouping and count/sum/average/min/max summaries; Buyer Log tasks gained open-page, refresh-data, and show-result actions.' },
    ],
  },
  {
    v: '5.56', date: '2026-08-10',
    title: { tr: 'Web recorder arama kutusu ve framework kontrollü alan yakalama düzeltmesi', en: 'Web recorder search-box and framework-controlled input capture fix' },
    items: [
      { tr: 'Yaptıklarımı Kaydet artık input/search/textarea/contenteditable alanlarına yapılan tıklamayı da gerçek bir adım olarak kaydeder; önceki sürümde editable alan tıklaması kasıtlı olarak atlandığı için PLM Search gibi kontrollerde playback odaklanmadan kalabiliyordu.', en: 'Record My Actions now stores clicks on input/search/textarea/contenteditable fields as real steps; the previous recorder intentionally skipped editable-field clicks, which could leave playback unfocused on controls such as the PLM Search box.' },
      { tr: 'Framework kontrollü arama kutularında input olayı kaçırılırsa beforeinput, paste, compositionend, keyup, focusout ve yalnız aktif alanda çalışan gerçek-değer watchdog yedekleriyle yazılan değer yakalanır.', en: 'If a framework-controlled search box suppresses a normal input event, the typed value is captured through beforeinput, paste, compositionend, keyup, focusout and a focused-field actual-value watchdog fallback.' },
      { tr: 'Searchbox/textbox rolleri playback locator tarafından tanınır; açık Shadow DOM ve aynı-origin iframe içindeki öğeler de locator taramasına dahil edilir.', en: 'Searchbox/textbox roles are now understood by the playback locator, and elements inside open Shadow DOM and same-origin iframes are included in locator discovery.' },
      { tr: 'Click → Fill → Enter gibi arama akışları ayrı ve sıralı adımlar olarak korunur; aynı alandaki art arda yazma olayları ise yalnız son gerçek değeri bırakacak şekilde birleştirilir.', en: 'Search sequences such as Click → Fill → Enter remain distinct ordered steps, while consecutive edits to the same field collapse to the final actual value.' },
    ],
  },
  {
    v: '5.55', date: '2026-08-10',
    title: { tr: 'AI maliyetsiz Otomasyonlar sayfası ve Browser Recipe motoru', en: 'Zero-AI-cost Automations page and Browser Recipe engine' },
    items: [
      { tr: 'Agent Workflow Studio korunurken ayrı bir Otomasyonlar sayfası eklendi; bu sayfa normal çalıştırmada hiçbir LLM veya n8n execution çağrısı yapmadan deterministik recipe çalıştırır.', en: 'Agent Workflow Studio remains available while a separate Automations page was added; normal automation execution is deterministic and makes no LLM or n8n execution calls.' },
      { tr: 'Dış web işlemleri bir kez Yaptıklarımı Kaydet ile öğretilir; tıklama/yazma/seçim adımları recipe içinde saklanır ve kayıtlı fill/select değerleri {{item.Alan}} placeholderlarıyla Buyer Log satır verisine bağlanabilir.', en: 'External web processes can be taught once with Record My Actions; click/fill/select steps are stored in a recipe and recorded fill/select values can be bound to Buyer Log row data with {{item.Field}} placeholders.' },
      { tr: 'Otomasyonlar CP, Orders, Backlog, LFL ve Collection canlı verilerini filtreleyebilir, en fazla 200 kaydı toplu işleyebilir, Dry Run ile kapsamı önceden gösterebilir ve isteğe bağlı başarı metni doğrulaması yapabilir.', en: 'Automations can filter live CP, Orders, Backlog, LFL and Collection data, batch up to 200 rows, preview scope with Dry Run, and optionally verify a success text after execution.' },
      { tr: 'Browser allowlist Agent ile ortaktır; yalnız HTTPS hostları çalışır. Şifre/OTP/token/PIN/CVV recorder tarafından kaydedilmez ve gerçek çalıştırma öncesi kullanıcıya açık onay özeti gösterilir.', en: 'The browser allowlist is shared with Agent and only HTTPS hosts are allowed. Password/OTP/token/PIN/CVV values are never recorded, and a clear user confirmation summary is shown before real execution.' },
    ],
  },
  {
    v: '5.54', date: '2026-08-10',
    title: { tr: 'Kontrollü Browser Automation Connector ve güvenilir web recorder', en: 'Controlled Browser Automation Connector and reliable web recorder' },
    items: [
      { tr: 'Yeni Agent Workflow Studio içine Browser Automation tool/node eklendi. İzinli harici HTTPS sayfaları Buyer Log’un yönetilen Microsoft Edge penceresinde yeni sekme olarak açılır; ayrı bir otomasyon tarayıcısı kullanılmaz.', en: 'A Browser Automation tool/node was added to the new Agent Workflow Studio. Allowlisted external HTTPS pages open as new tabs in Buyer Log’s managed Microsoft Edge window rather than a separate automation browser.' },
      { tr: 'Yaptıklarımı kaydet recorder’ı click/double-click, input, dropdown, checkbox, klavye ve popup/yeni sekme hareketlerini kaydeder; öğeler için data-testid/id/name/ARIA/role/text/CSS dahil birden fazla stabil hedef saklanır ve playback sırasında alternatifler sırayla denenir.', en: 'Record my actions captures clicks/double-clicks, inputs, dropdowns, checkboxes, keyboard actions and popup/new-tab transitions; multiple stable targets such as data-testid/id/name/ARIA/role/text/CSS are stored and tried in order during playback.' },
      { tr: 'Şifre/OTP/token/PIN/CVV verileri recorder’a alınmaz. Browser çalıştırmaları HTTPS allowlist, Agent permission/policy katmanı ve kullanıcı onayıyla sınırlandırılır; arbitrary JavaScript veya shell çalıştırılmaz.', en: 'Password/OTP/token/PIN/CVV data is never recorded. Browser runs are constrained by HTTPS allowlists, Agent permission/policy enforcement and user approval; no arbitrary JavaScript or shell execution is exposed.' },
      { tr: 'Browser Automation toplu replay destekler: dataset.query çıktıları items alanına bağlanabilir ve kayıtlı adımlarda {{item.Alan}} / {{index}} kullanılarak CP gibi kaynaklardan gelen birçok kayıt aynı öğretilmiş web akışıyla işlenebilir.', en: 'Browser Automation supports batch replay: dataset.query rows can be bound to items and recorded steps can use {{item.Field}} / {{index}} so multiple CP-style records can run through the same taught web flow.' },
    ],
  },
  {
    v: '5.53', date: '2026-08-10',
    title: { tr: 'Overseas Landed fiyat avantajı yüzdesi geri getirildi', en: 'Overseas Landed price-advantage percentage restored' },
    items: [
      { tr: 'Koleksiyon Overseas Landed hücresinde, TR Landed ile Overseas Landed arasındaki fiyat avantajı yüzdesi yeniden gösterilir.', en: 'The Collection Overseas Landed cell once again shows the price-advantage percentage between TR Landed and Overseas Landed.' },
      { tr: 'Yüzde, (TR Landed − Overseas Landed) / TR Landed formülüyle hesaplanır; pozitif ve negatif farklar ayrı görsel durumlarla gösterilir.', en: 'The percentage is calculated as (TR Landed − Overseas Landed) / TR Landed, with positive and negative differences shown using distinct visual states.' },
      { tr: 'V5.51’de kaldırılan tekrar çarpan rozetleri geri getirilmedi; yalnız kullanıcı tarafından yanlışlıkla kaldırılan fiyat avantajı yüzdesi geri eklendi ve kompakt hücre yüksekliği korundu.', en: 'The duplicate multiplier badges removed in V5.51 remain removed; only the accidentally removed price-advantage percentage was restored while keeping the compact cell height.' },
    ],
  },
  {
    v: '5.52', date: '2026-08-10',
    title: { tr: 'Koleksiyon Excel çıktısında Endeksmatik ve Landed hesapları', en: 'Endeksmatik and Landed calculations in Collection Excel export' },
    items: [
      { tr: 'Koleksiyon Excel dışa aktarımında Endeksmatik, Overseas Landed ve TR Landed artık satırdaki boş sentetik alanlardan okunmuyor; ekrandakiyle aynı hesap motorlarından yeniden üretilerek Excel’e yazılıyor.', en: 'Collection Excel export no longer reads Endeksmatik, Overseas Landed and TR Landed from empty synthetic row fields; the values are recalculated with the same engines used on screen and written to Excel.' },
      { tr: 'Overseas Landed ve TR Landed Excel’de gerçek sayısal USD hücreleri olarak aktarılır; böylece sıralama, filtreleme ve Excel formüllerinde doğrudan kullanılabilir.', en: 'Overseas Landed and TR Landed are exported as real numeric USD cells so they can be used directly in sorting, filtering and Excel formulas.' },
      { tr: 'Endeksmatik hücresi önerilen YD/TR fiyatlarını ve endeks oranlarını taşır; ilgili dönem bilgileri, Landed kaynak/çarpan/kur detayları ise hücre notlarında korunur.', en: 'The Endeksmatik cell carries suggested overseas/domestic prices and index rates, while period details and Landed source/multiplier/FX context are preserved in cell notes.' },
    ],
  },
  {
    v: '5.51', date: '2026-08-10',
    title: { tr: 'Koleksiyon Landed hücreleri sadeleştirildi', en: 'Collection Landed cells simplified' },
    items: [
      { tr: 'Overseas Landed hücresindeki kârlılık yüzdesi ve tekrar eden çarpan etiketi ile TR Landed hücresindeki tekrar çarpan rozeti kaldırıldı.', en: 'The profit percentage and duplicate multiplier label in Overseas Landed, and the duplicate multiplier badge in TR Landed, were removed.' },
      { tr: 'Ana landed fiyatı, kaynak fiyat ve manuel düzenlenebilir fiyat/çarpan/kur bilgileri tek satırda yeniden hizalandı.', en: 'The main landed value, source price, and manually editable price/multiplier/FX inputs were realigned into one row.' },
      { tr: 'Landed kart ve Koleksiyon satır yüksekliği küçültüldü; sütun genişlikleri de kompakt düzene göre daraltıldı.', en: 'The Landed card and Collection row height were reduced, and the columns were narrowed for the compact layout.' },
    ],
  },
  {
    v: '5.50', date: '2026-08-10',
    title: { tr: 'Endeksmatik ay/yıl seçici, ayrı Domestic TL dönemi ve hesap kopyalama', en: 'Endeksmatik month/year picker, separate Domestic TRY periods and setup copy' },
    items: [
      { tr: 'Endeksmatik dönem alanları manuel yazmayı korurken takvim düğmesinden yalnız ay ve yıl seçimine de izin verir. Sipariş ayı değiştirildiğinde karşılık gelen In Store yılı aynı yıla alınır; ay siparişten önceye düşecekse güvenli şekilde sipariş ayına çekilir ve sonrasında manuel değiştirilebilir.', en: 'Endeksmatik period fields keep manual entry while also offering a month/year-only picker. When an order month changes, the corresponding In Store year defaults to the same year; if that would make it earlier than the order month, it safely defaults to the order month and remains editable.' },
      { tr: 'Geçen/Yeni In Store ayının kendi sipariş ayından eski olması ve Yeni In Store ayının eski sezon In Store ayından eski olması hem arayüzde hem sunucuda engellenir.', en: 'Previous/New In Store cannot be earlier than its order month, and New In Store cannot be earlier than the prior-season In Store; these rules are enforced in both UI and server calculation.' },
      { tr: 'Overseas USD hesabı ortak eski dönemleri kullanmaya devam eder. İstenirse Domestic TL fiyatı için ayrı geçen sipariş ve geçen In Store ayları açılabilir; yeni sezon Sipariş/In Store hedef dönemleri her iki hesapta ortak kalır.', en: 'The Overseas USD calculation continues to use the shared previous periods. Optionally, Domestic TRY can use separate previous order and In Store months while the new-season target order/In Store periods remain shared.' },
      { tr: 'Endeksmatik hesap girdileri bir modelden kopyalanıp başka modele uygulanabilir. Hesap sonucu kopyalanmaz; hedef model kendi MMYG/MAG/Buying Group/Klasman bilgisiyle yeniden hesaplanır.', en: 'Endeksmatik calculation inputs can be copied from one model and applied to another. The computed result is not copied; the destination model is recalculated using its own MMYG/MAG/Buying Group/Class.' },
    ],
  },
  {
    v: '5.49', date: '2026-08-10',
    title: { tr: 'Koleksiyon Landed kart tasarımı ve ortak varsayılan çarpanlar', en: 'Collection Landed card design and shared default multipliers' },
    items: [
      { tr: 'Overseas Landed ve TR Landed hücreleri Endeksmatik ile aynı kompakt kart görsel diline geçirildi: aynı zemin, çerçeve, köşe, yükseklik, ana değer ve sağ üst rozet yapısı kullanılır.', en: 'Overseas Landed and TR Landed cells now use the same compact card visual language as Endeksmatik, including the same background, border, radius, height, primary value and top-right badge structure.' },
      { tr: 'Landed verileri kart içinde yeniden düzenlendi. Ana landed sonucu üstte, kârlılık veya etkin çarpan rozeti sağ üstte; fiyat, kaynak, kur ve manuel çarpan girdileri kompakt alt bilgi satırında tutulur.', en: 'Landed data was reorganized inside the card. The main landed result is on top, profitability or the effective multiplier appears as a top-right badge, while price, source, FX and manual multiplier inputs stay in a compact metadata row.' },
      { tr: 'Kaynak Veri > Ayarlar menüsüne Landed Çarpanları eklendi. Buradan Overseas ve TR için ortak varsayılanlar belirlenir; satırdaki çarpan boşsa bu değer kullanılır ve değişiklik tüm boş-override satırlarını yeniden hesaplar.', en: 'Landed Multipliers was added under Source Data > Settings. Shared Overseas and TR defaults are configured there; blank row multipliers use these values and changing a default recalculates all rows without a manual override.' },
      { tr: 'Model bazlı manuel Landed çarpanları korunur ve ortak varsayılanın önüne geçer. Varsayılan değişikliği daha önce elle girilmiş satır değerlerini silmez veya değiştirmez.', en: 'Per-model manual Landed multipliers are preserved and override the shared defaults. Changing a default never clears or changes previously entered row-level values.' },
    ],
  },
  {
    v: '5.48', date: '2026-08-10',
    title: { tr: 'Agent AI sağlayıcısını uygulama içinden güvenli yapılandırma', en: 'Secure in-app Agent AI provider configuration' },
    items: [
      { tr: 'Agent Workflow Studio başlığına Moderatör için AI Ayarları eklendi. OpenAI API anahtarı ve model uygulama içinden tanımlanabilir; artık yalnız Windows ortam değişkeni ayarlamaya gerek yoktur.', en: 'AI Settings were added to Agent Workflow Studio for the Moderator. The OpenAI API key and model can now be configured in-app instead of relying only on Windows environment variables.' },
      { tr: 'API anahtarı tarayıcıya geri gönderilmez ve server-data içinde AES-256-GCM ile şifreli saklanır. Ortam değişkeni tanımlıysa güvenlik amacıyla uygulama ayarından öncelikli olmaya devam eder.', en: 'The API key is never returned to the browser and is stored encrypted with AES-256-GCM under server-data. When an environment variable is present, it continues to take precedence for security.' },
      { tr: 'AI Ayarları penceresine OpenAI bağlantısını ve seçili model erişimini kaydetmeden önce doğrulayan Bağlantıyı test et işlemi eklendi; ayar değişiklikleri audit log’a yazılır.', en: 'AI Settings now includes Test connection to verify OpenAI authentication and selected model access before saving; settings changes are recorded in the audit log.' },
      { tr: 'AI bağlı değilken kullanılan yerel planner uyarıları daha açıklayıcı hale getirildi. AI bağlantısı yapıldığında Agent ile planla gerçek AI Planner üzerinden deklaratif workflow üretir; tool execution yine deterministic policy katmanında kalır.', en: 'Fallback planner messages are now clearer. Once AI is connected, Plan with Agent uses the real AI Planner to generate declarative workflows while tool execution remains under deterministic policy control.' },
    ],
  },
  {
    v: '5.47', date: '2026-08-10',
    title: { tr: 'Endeksmatik Koleksiyon benchmarkı ve Orders hızlı hesabı', en: 'Endeksmatik Collection benchmark and Orders quick calculation' },
    items: [
      { tr: 'ENDEKSMATİK Excel’in Kumaş, CMT, Aksesuar, Ek İşlem, klasman maliyet ağırlıkları ve USD/TL dönem mantığı Buyer Log içinde server-side Endeksmatik Engine olarak uygulandı; çalışma sırasında büyük Excel dosyasının açılması gerekmez.', en: 'The ENDEKSMATİK workbook logic for Fabric, CMT, Accessory, Extra Process, class cost weights and USD/TRY periods is implemented as a server-side Endeksmatik Engine; the large workbook does not need to be opened during normal use.' },
      { tr: 'Koleksiyon tablosuna Overseas Landed ve TR Landed’ın hemen solunda Endeksmatik sütunu eklendi. Geçen Sipariş, geçen In Store ve yeni Sipariş ayları manueldir; yeni In Store yalnız Koleksiyon In Store Month ile başlangıç değeri alır ve değiştirilebilir.', en: 'An Endeksmatik column was added immediately left of Overseas Landed and TR Landed in Collection. Previous Order, previous In Store and new Order months are manual; new In Store only starts from Collection In Store Month and remains editable.' },
      { tr: 'Previous Season FOB Endeksmatik penceresinde yalnız varsayılan USD referans fiyatıdır; kullanıcı manuel olarak değiştirebilir. TR referans fiyatı da manuel girilebilir ve hesaplanan benchmark mevcut Target/FOB/TR Price alanlarını otomatik değiştirmez.', en: 'Previous Season FOB is only the default USD reference price in the Endeksmatik dialog and can be manually changed. A TRY reference price can also be entered manually, and the benchmark never automatically changes existing Target/FOB/TR Price fields.' },
      { tr: 'Orders > Araçlar > Endeksmatik tek seçili siparişin OPD, In Store ve FOB değerleriyle açılır; yeni Sipariş/In Store dönemlerini +1 yıl önerir. Tüm alanlar hesaplamadan önce elle değiştirilebilir ve modelin Koleksiyon’a eklenmesi gerekmez.', en: 'Orders > Tools > Endeksmatik opens from the selected order’s OPD, In Store and FOB, suggesting +1 year for the new Order/In Store periods. Every field remains editable and the model does not need to be added to Collection.' },
      { tr: 'Endeksmatik Güncelle ile yeni workbook doğrulanarak ortak snapshot’a alınabilir. Tedarik Grup, MMYG + MAG + Buying Group + Klasman kombinasyonu tek anlamlıysa otomatik bulunur; belirsizse kullanıcıdan istenir.', en: 'Update Endeksmatik validates a new workbook into the shared snapshot. Supply Group is inferred automatically when MMYG + MAG + Buying Group + Class is unambiguous; otherwise the user is asked to provide it.' },
    ],
  },
  {
    v: '5.46', date: '2026-08-10',
    title: { tr: 'Agent Workflow Studio — kontrollü agentic runtime', en: 'Agent Workflow Studio — controlled agentic runtime' },
    items: [
      { tr: 'Önceki Agent implementasyonu tüm UI, API, runtime ve depolama bileşenleriyle kaldırıldı; yerine bağımsız, deklaratif workflow graph ve kontrollü execution runtime kuruldu.', en: 'The previous Agent implementation was removed across its UI, API, runtime and storage components and replaced with a declarative workflow graph and controlled execution runtime.' },
      { tr: 'Yeni Agent Workflow Studio n8n benzeri node canvas, bağlantılar, workflow kaydet/yükle, doğal dilden plan oluşturma, Dry Run, çalışma geçmişi ve node bazlı doğrulama izini tek ekranda sunar.', en: 'The new Agent Workflow Studio provides an n8n-inspired node canvas, connections, workflow save/load, natural-language planning, Dry Run, run history and node-level verification trace in one screen.' },
      { tr: 'Tool çalıştırma LLM’den ayrıldı: kullanıcı yetkisi, business-rule erişimi, write/external işlem onayı, HTTPS connector allowlist, verifier ve desteklenen rollback işlemleri sunucuda deterministik olarak uygulanır.', en: 'Tool execution is separated from the LLM: user permissions, business-rule access, write/external approval, HTTPS connector allowlist, verifier and supported rollback actions are enforced deterministically on the server.' },
      { tr: 'İlk tool seti CP, Siparişler, Backlog, LFL ve Koleksiyon sorguları; aggregate raporlama; mevcut refresh mekanizması; kontrollü sipariş override güncellemesi; özet rapor ve izinli HTTP connector içerir. Mevcut uygulama servisleri iş mantığının tek kaynağı olmaya devam eder.', en: 'The initial tool set covers CP, Orders, Backlog, LFL and Collection queries; aggregation; the existing refresh mechanism; controlled order override updates; summary reporting and allowlisted HTTP connectors. Existing application services remain the single source of truth for business logic.' },
    ],
  },
  {
    v: '5.42', date: '2026-08-09',
    title: { tr: 'Otomatik sürüm ZIP arşivi', en: 'Automatic release ZIP archive' },
    items: [
      { tr: 'Uygulama her yeni sürümle başlatıldığında proje klasöründe sürüm numaralı bir Buyer Log ZIP paketi otomatik oluşturulur.', en: 'Whenever the application starts with a new version, a versioned Buyer Log ZIP package is created automatically in the project folder.' },
      { tr: 'Arşiv klasöründe yalnız en yeni üç sürüm tutulur; daha eski Buyer Log sürüm ZIP’leri otomatik silinir.', en: 'Only the three newest releases are retained in the archive folder; older Buyer Log release ZIPs are removed automatically.' },
      { tr: 'Paket kullanıcı verilerini, gerçek yapılandırmayı, kaynak Excel dosyalarını, bağımlılık klasörünü ve önceki ZIP’leri içermez.', en: 'The package excludes user data, real configuration, source Excel files, dependency folders and previous ZIP archives.' },
    ],
  },
  {
    v: '5.41', date: '2026-08-09',
    title: { tr: 'Backlog için dinamik ASAS ve Antrepo grupları', en: 'Dynamic ASAS and Antrepo groups for Backlog' },
    items: [
      { tr: 'Backlog Grupla listesinin en altına Ekle seçeneği eklendi; kullanıcı kaynak olarak ASAS veya Antrepo’yu seçip o tablodaki istediği başlığı gruplamaya ekleyebilir.', en: 'An Add option was added to the bottom of the Backlog grouping list; users can choose ASAS or Antrepo and add any header from that source table as a grouping field.' },
      { tr: 'Eklenen özel başlıklar satır/sütun alanlarında sıralanabilir, değer bazında filtrelenebilir ve son kullanılan Backlog görünümüyle birlikte korunur.', en: 'Added custom headers can be reordered in row/column areas, filtered by value, and retained with the last-used Backlog view.' },
    ],
  },
  {
    v: '5.32', date: '2026-08-09',
    title: { tr: 'Daha hızlı açılış ve isteğe bağlı Siparişler yükleme', en: 'Faster startup and on-demand Orders loading' },
    items: [
      { tr: 'İlk açılışta görünmeyen Siparişler tablosunun 8.000+ satırlık geniş veri paketi artık hazırlanıp telefona gönderilmez; veri yalnız Siparişler sekmesi açıldığında yüklenir.', en: 'The 8,000+ row full Orders payload is no longer built and transferred during startup; it loads only when the Orders page is opened.' },
      { tr: 'Genel Bakış için tam sipariş nesneleri yerine yalnız filtre ve toplam alanlarını taşıyan hafif bir özet kullanılır; ilk ekran daha az JSON ayrıştırır ve daha erken çizilir.', en: 'Overview now uses a lean projection containing only filter and total fields, reducing JSON parsing and bringing the first screen up sooner.' },
      { tr: 'Backlog raporu da açılışta arka planda hesaplanmaz; ilk kez Backlog sekmesine girildiğinde yüklenir.', en: 'The Backlog report is no longer calculated in the background at startup and loads on first entry to the Backlog page.' },
    ],
  },
  {
    v: '5.28', date: '2026-08-08',
    title: { tr: 'In Store Month hatalı tarih önerileri temizlendi', en: 'Invalid full-date suggestions removed from In Store Month' },
    items: [
      { tr: 'In Store Month açılır listesinin CP/Orders içindeki tam In-Store (Model Budget) tarihlerini kaynak olarak kullanması kaldırıldı; böylece “Fri Apr 03 2026…” benzeri Date.toString() değerleri artık görünmez.', en: 'The In Store Month dropdown no longer uses full In-Store (Model Budget) dates from CP/Orders as a source, so Date.toString() values such as “Fri Apr 03 2026…” no longer appear.' },
      { tr: 'In Store Month yalnız geçerli ay+yıl değerlerini gösterir; eski veya hatalı tam tarih/metin değerleri boş gösterilir ve öneri listesine alınmaz.', en: 'In Store Month now displays only valid month+year values; stale or invalid full-date/text values render blank and are excluded from suggestions.' },
    ],
  },
  {
    v: '5.27', date: '2026-08-08',
    title: { tr: 'PLM öğrenme penceresi düzeltmeleri ve hızlı eşleştirme', en: 'PLM learning dialog fixes and quick matching' },
    items: [
      { tr: 'Teach PLM → ASAS penceresinin kart zemini ve çerçevesi düzeltildi; başlık, gövde ve alt işlem alanları artık opak kart içinde düzgün görünür.', en: 'The Teach PLM → ASAS dialog card background and frame were fixed; the header, body and footer now render properly inside an opaque card.' },
      { tr: 'Önerilerin tamamını otomatik eşleştir düğmesi eklendi. Bu düğme mevcut en güçlü ASAS adaylarını tüm satırlara doldurur, ancak önce hatalı olabileceğine dair bir uyarı gösterir ve kullanıcıdan sonuçları kontrol etmesini ister.', en: 'An Auto-match all suggestions action was added. It fills every row with the strongest current ASAS candidate, but first warns that it may be wrong and asks the user to review the results.' },
      { tr: 'Her eşleştirme satırına Olduğu gibi taşı / Keep as is seçeneği eklendi. Bu seçenek PLM metnini yalnız o aktarımda doğrudan kullanır; yeni bir PLM→ASAS kuralı öğretmez ve ortak sözlüğe kaydolmaz.', en: 'A Keep as is option was added to each mapping row. It uses the original PLM text directly for that import only; it does not teach a new PLM→ASAS rule and is not saved to the shared dictionary.' },
    ],
  },
  {
    v: '5.26', date: '2026-08-08',
    title: { tr: 'Öğrenen PLM → ASAS çeviri önerileri', en: 'Learning PLM → ASAS translation suggestions' },
    items: [
      { tr: 'PLM Excel’de daha önce güvenle eşlenmemiş Category, Line veya License değeri görüldüğünde Buyer Log güncel ASAS kataloğunu tarar ve benzerlik skoruna göre en yakın beş ASAS adayını sıralar.', en: 'When a PLM Excel contains a Category, Line or License value that has not been safely mapped before, Buyer Log scans the current ASAS catalog and ranks the five nearest ASAS candidates by similarity score.' },
      { tr: 'Benzerlik yalnız öneridir; hiçbir yeni eşleme otomatik uygulanmaz. Kullanıcı önerilen adaylardan birini seçebilir, ASAS listesinden başka bir değeri seçebilir veya alanı boş bırakarak bu aktarımda eşlemeyebilir.', en: 'Similarity is only a suggestion; no new mapping is applied automatically. The user can choose a suggested candidate, select another value from the ASAS list, or leave the field unmapped for that import.' },
      { tr: 'Kullanıcının onayladığı PLM → ASAS eşlemeleri ortak sunucu sözlüğünde kalıcı olarak saklanır ve sonraki PLM aktarımlarında tekrar sorulmadan uygulanır; onay kullanıcı/audit bilgisiyle kaydedilir.', en: 'User-approved PLM → ASAS mappings are persisted in a shared server dictionary and reused automatically in later PLM imports without asking again; approvals are recorded with user/audit metadata.' },
      { tr: 'Çeviri seçimleri ancak PLM aktarımı model kararlarıyla birlikte tamamlandıktan sonra kalıcı hale gelir; iptal edilen bir aktarım yeni sözlük kuralı bırakmaz.', en: 'Translation choices become persistent only after the PLM import completes its model decisions; a cancelled import leaves no new dictionary rule behind.' },
    ],
  },
  {
    v: '5.25', date: '2026-08-08',
    title: { tr: 'PLM modeli ASAS’ta olmasa da onaylı PLM → ASAS Category çevirisi', en: 'Approved PLM → ASAS Category translation even when the PLM style is absent from ASAS' },
    items: [
      { tr: 'PLM Excel içe aktarımında Category çevirisi artık yalnız aynı PLM ID/modelin ASAS’ta bulunmasına bağlı değildir; kullanıcıyla teyit edilmiş kalıcı PLM → ASAS sözlüğü ayrıca uygulanır.', en: 'Category translation during PLM Excel import no longer depends only on finding the same PLM ID/style in ASAS; a user-confirmed persistent PLM → ASAS dictionary is also applied.' },
      { tr: '2639 → KEY ORME BODY K.KOL-LİSANS, 2642 → KEY ORME TAKIM-LİSANS, 2634 → KEY ORME PANTOLON-LİSANS, 2637 → KEY ORME SWEAT-LİSANS ve 2638 → KEY ORME BODY U.KOL-LİSANS eşlemeleri kalıcı kural olarak eklendi.', en: 'The confirmed 2639, 2642, 2634, 2637 and 2638 PLM Category mappings were added as persistent translation rules.' },
      { tr: 'Öncelik sırası kesin ASAS PLM ID → kesin ASAS model eşleşmesi → onaylı PLM→ASAS kuralı → güncel ASAS’tan öğrenilen tek-anlamlı eşleme şeklindedir; çelişkili değerler tahmin edilmez.', en: 'Translation priority is exact ASAS PLM ID → exact ASAS model match → approved PLM→ASAS rule → unambiguous mapping learned from current ASAS; conflicting values are never guessed.' },
    ],
  },
  {
    v: '5.24', date: '2026-08-08',
    title: { tr: 'PLM → ASAS Category/Line çevirisi ve Koleksiyon kullanım düzeltmeleri', en: 'PLM → ASAS Category/Line translation and Collection workflow fixes' },
    items: [
      { tr: 'PLM Excel içe aktarımında Category, Line ve License artık güncel ASAS verisine göre otomatik çevrilir: önce aynı PLM ID’nin kesin ASAS değeri, sonra model adının tam suffix eşleşmesi, son olarak PLM kaynak değerinden öğrenilen tek-anlamlı ASAS çevirisi kullanılır; çelişkili sonuçlar tahmin edilmez.', en: 'During PLM Excel import, Category, Line and License are now translated automatically from current ASAS data: exact ASAS values for the same PLM ID take priority, followed by exact model-name suffix matches and finally unambiguous source-value translations learned from ASAS; conflicts are never guessed.' },
      { tr: 'Fit Koleksiyon tablosunda sabit ve görünür sütun olarak Fabric’in yanında tutulur; PLM Label Fit Name doğrudan bu alana aktarılır.', en: 'Fit is kept as a fixed visible Collection column beside Fabric, and PLM Label Fit Name flows directly into it.' },
      { tr: 'In Store Month değeri yoksa hücre artık örnek ay metni göstermeden tamamen boş görünür.', en: 'When In Store Month has no value, the cell now appears truly blank without an example month placeholder.' },
      { tr: 'MB Listesi Excel’i düğmesi Koleksiyon tablosundaki Seçilenler / Selected işlem grubuna taşındı.', en: 'The MB List Excel button was moved into the Selected action group in the Collection table toolbar.' },
      { tr: 'Koleksiyon görsellerinde sağ tık işlemi CP ile aynı görsele bağlı Kaldır / Vazgeç onay penceresini kullanır.', en: 'Right-clicking a Collection image now uses the same image-anchored Remove / Cancel confirmation flow as CP.' },
    ],
  },
  {
    v: '5.23', date: '2026-08-08',
    title: { tr: 'PLM importta model bazlı güncelleme onayı ve kullanıcı verisi koruması', en: 'Per-model PLM update approval with user-data preservation' },
    items: [
      { tr: 'PLM ID Koleksiyon’da zaten mevcutsa ikinci kayıt oluşturulmaz; kullanıcıya her mevcut model için tek tek Güncelle veya Mevcut kalsın / Atla kararı sorulur.', en: 'If a PLM ID already exists in Collection, a second row is never created; each existing model is presented individually for Update or Keep current / Skip.' },
      { tr: 'Model bazlı kararların tamamı alınmadan Koleksiyon’a hiçbir değişiklik yazılmaz; aktarım iptal edilirse kısmi güncelleme oluşmaz.', en: 'No Collection data is written until all per-model decisions are complete; cancelling the import cannot leave a partial update.' },
      { tr: 'PLM güncellemesi yalnız PLM’nin yönettiği doğrudan alanları değiştirir; Pricing History, fiyatlama kayıtları, notlar, Confirmed Supplier/FOB, Target Price, Buying Sample ve diğer kullanıcı girişleri korunur.', en: 'A PLM update changes only PLM-managed direct fields; Pricing History, pricing records, notes, Confirmed Supplier/FOB, Target Price, Buying Sample and other user-entered data are preserved.' },
      { tr: 'PLM görseli yalnız ilgili model için Güncelle seçilirse yenilenir; Atla denilen modelin alanları ve görseli değişmez.', en: 'The PLM picture is refreshed only when Update is chosen for that model; skipped models keep both their fields and picture.' },
      { tr: 'Koleksiyonda aynı PLM ID ile birden fazla eski kayıt varsa veya PLM Excel aynı PLM ID’yi tekrarlıyorsa güvenli tarafta kalınır: yeni kopya oluşturulmaz, belirsiz/tekrar satırlar atlanır.', en: 'If legacy Collection rows share a PLM ID or the PLM Excel repeats a PLM ID, the importer stays safe: no new duplicate is created and ambiguous/repeated rows are skipped.' },
    ],
  },
  {
    v: '5.22', date: '2026-08-08',
    title: { tr: 'PLM Excel → Koleksiyon otomatik model ve görsel aktarımı', en: 'PLM Excel → Collection automatic model and image import' },
    items: [
      { tr: 'Koleksiyon araç çubuğuna PLM Excelinden Aktar eklendi; PLM sütunları otomatik bulunur ve güvenli doğrudan eşlemeler ön izleme sonrası içe aktarılır.', en: 'Import from PLM Excel was added to the Collection toolbar; PLM columns are auto-detected and safe direct mappings are imported after preview.' },
      { tr: 'PLM Excel içindeki gömülü model görselleri drawing anchor kayıtlarından okunur, Koleksiyona kaydedilir ve PLM ID + Renk Kod kimliğiyle CP/Orders dahil ortak görsel havuzuna bağlanır.', en: 'Embedded model images are read from XLSX drawing anchors, stored in Collection and linked to the shared image pool using PLM ID + Colour Code for CP/Orders and other views.' },
      { tr: 'PLM ve ASAS arasında birebir PLM ID eşleşmelerinden Line, Category ve License için çeviri adayları üretilir; kullanıcı onayı olmadan bu çeviriler uygulanmaz.', en: 'Exact PLM ID matches between PLM and ASAS generate translation candidates for Line, Category and License; these translations are not applied until confirmed by the user.' },
      { tr: 'Mevcut Koleksiyon kayıtları benzersiz PLM ID ile güncellenir; aynı modelin tekrar eklenmesi engellenir ve yeni model girişleri doğrudan PLM kaynağından oluşturulabilir.', en: 'Existing Collection rows are updated by unique PLM ID, duplicate model creation is avoided and new styles can be created directly from the PLM source.' },
    ],
  },
  {
    v: '5.21', date: '2026-08-08',
    title: { tr: 'MB Excel akışı sadeleştirildi ve Assortment sabitlendi', en: 'MB Excel flow simplified and Assortment fixed in Collection' },
    items: [
      { tr: 'MB Listesi ekranı ve yalnız bu ekrana ait ortak not/API yapısı kaldırıldı; Koleksiyon → MB Excel aktarımı korunuyor.', en: 'The MB List screen and its screen-only shared note/API flow were removed; Collection → MB Excel export remains available.' },
      { tr: 'MB Listesi Excel düğmesi Style Management Excel düğmesinin hemen sağına sabitlendi.', en: 'The MB List Excel button is kept immediately to the right of the Style Management Excel button.' },
      { tr: 'MB Excel Supplier Name ve 7S Confirmed FOB alanları yalnız Confirmed Supplier / Confirmed FOB bilgisinden gelir; Best Price fallback kaldırıldı.', en: 'MB Excel Supplier Name and 7S Confirmed FOB now come only from Confirmed Supplier / Confirmed FOB; Best Price fallback was removed.' },
      { tr: 'Pricing History 1–5 alanları en düşük fiyattan yükseğe sıralanır ve her hücrede fiyat ile üretici adı birlikte yazılır.', en: 'Pricing History 1–5 is sorted from lowest to highest price and each cell contains both price and manufacturer.' },
      { tr: 'TR TARGET (TR FOB) Excel biçimi TL/₺ olarak düzeltildi.', en: 'TR TARGET (TR FOB) is now formatted as TRY/₺ in Excel.' },
      { tr: 'Assortment Koleksiyon tablosunda kalıcı düzenlenebilir sütun haline getirildi; daha önce elle eklenmiş Assortment özel sütunu otomatik taşınır.', en: 'Assortment is now a permanent editable Collection column; a previously user-added custom Assortment column is migrated automatically.' },
    ],
  },
  {
    v: '5.20', date: '2026-08-08',
    title: { tr: 'Ortak MB Listesi ve Koleksiyon → MB Excel akışı', en: 'Shared MB List and Collection → MB Excel flow' },
    items: [
      { tr: 'Yüklenen 7S MB Liste formatındaki 41 sütun incelendi ve program içinde ortak MB Listesi sayfası oluşturuldu.', en: 'The uploaded 41-column 7S MB List format was analyzed and implemented as a shared MB List page.' },
      { tr: 'Erişilebilen kullanıcı Koleksiyon çalışma alanlarındaki modeller MB Listesine otomatik akar; PBL adı kullanıcı hiyerarşisindeki üst yöneticiden, Buyer ve MAG Koleksiyon satırından alınır.', en: 'Models from accessible Collection workspaces flow automatically into MB List; PBL name comes from the user hierarchy supervisor while Buyer and MAG come from the Collection row.' },
      { tr: 'MB Listesi model alanlarında salt okunurdur; yalnız PBL NOT ortak listede düzenlenebilir ve ayrı kaydedilir.', en: 'MB List model fields are read-only; only PBL NOTE is editable and stored separately.' },
      { tr: 'Koleksiyon tablosuna MB için eksik olan Order Type, Colour Code, Previous Season FOB ve S6/S7 kumaş tedarikçi/fiyat alanları eklendi.', en: 'Collection gained MB-only source fields: Order Type, Colour Code, Previous Season FOB, and S6/S7 fabric supplier/price.' },
      { tr: 'Koleksiyon üzerinde seçilen modeller tek tuşla 7S MB Listesi Excel formatında dışa aktarılabilir.', en: 'Selected Collection models can be exported directly in the 7S MB List Excel format.' },
    ],
  },
  {
    v: '5.19', date: '2026-08-08',
    title: { tr: 'License Royalty Rules → Koleksiyon anlık senkronu', en: 'Instant License Royalty Rules → Collection sync' },
    items: [
      { tr: 'License Royalty Rules kaydedildiğinde Royalty, Hologram Cost, FOB ve bunlara bağlı Landed hesapları Koleksiyon satırlarına ağ isteğini beklemeden uygulanır.', en: 'When License Royalty Rules are saved, Royalty, Hologram Cost, FOB and dependent Landed calculations are applied to Collection rows without waiting for the network request.' },
      { tr: 'Sunucunun normalize ederek döndürdüğü son kural seti Koleksiyon ve CP üzerine ikinci kez uygulanır; istemci/sunucu kural farkı nedeniyle eski fiyat değerinin kalması engellenir.', en: 'The final normalized rule set returned by the server is applied again to Collection and CP, preventing stale pricing caused by client/server normalization differences.' },
      { tr: 'Tek bir kuraldaki Uygula düğmesi artık önce düzenlenmiş kural setini kaydeder ve Koleksiyon ile eşitler, ardından eşleşen CP siparişlerinin Supp. FOB değerlerini günceller.', en: 'The Apply action on an individual rule now saves and synchronizes the edited rule set with Collection before updating matching CP Supp. FOB values.' },
      { tr: 'Kural kaydı başarısız olursa geçici kural değişiklikleri geri alınır; CP ve Koleksiyon aynı kural setinde tutulur.', en: 'If rule persistence fails, temporary rule changes are rolled back so CP and Collection remain on the same rule set.' },
    ],
  },
  {
    v: '5.18', date: '2026-08-07',
    title: { tr: 'Görsellerde global en/boy oranı kilidi', en: 'Global image aspect-ratio lock' },
    items: [
      { tr: 'CP, Orders, Koleksiyon, Pricing History ve Open Costing görsellerinin tamamı contain/center kuralına bağlandı; hiçbir tablo görseli crop/stretch ile yeniden oranlanmaz.', en: 'All CP, Orders, Collection, Pricing History and Open Costing images now use contain/center behavior; table images are never re-proportioned with crop/stretch.' },
      { tr: 'Copy ve e-posta HTML çıktılarında width:100% + height:100% birlikte kullanılmıyor. Orijinal görsel oranı korunarak hesaplanan piksel ölçüleri yazılır.', en: 'Copy and email HTML no longer use width:100% and height:100% together. Calculated pixel dimensions preserve the original image ratio.' },
      { tr: 'Excel görselleri aspect-ratio kilitli one-cell drawing ankrajına geçirildi ve noChangeAspect kilidi dosyaya yazılıyor. Böylece satır/sütun oranı farklı değiştirilse bile resim yatay veya dikey olarak esnetilmiyor.', en: 'Excel images now use aspect-locked one-cell drawing anchors with noChangeAspect serialized into the workbook, preventing horizontal or vertical stretching when row/column proportions change.' },
      { tr: 'Excel dosyasına gömülen görselin orijinal çözünürlüğü korunur; yalnız ilk görünüm uygulamadaki seçili görsel hücresine oranlı olarak sığdırılır ve ortalanır.', en: 'Original image resolution remains embedded in Excel; only the initial display is proportionally fitted and centered to the selected in-app picture cell.' },
    ],
  },
  {
    v: '5.17', date: '2026-08-07',
    title: { tr: 'Excel görsellerinde gerçek hücre ankrajı', en: 'True cell anchoring for Excel images' },
    items: [
      { tr: 'CP, Orders, Koleksiyon ve e-posta Excel çıktılarındaki görseller artık ExcelJS kesirli sütun koordinatları yerine gerçek OOXML EMU koordinatlarıyla hücreye bağlanır; ince dikey şerit olarak görünme sorunu giderildi.', en: 'Images in CP, Orders, Collection and e-mail Excel exports now use true OOXML EMU cell coordinates instead of ExcelJS fractional column coordinates, fixing the thin vertical sliver issue.' },
      { tr: 'Görsel ilk açılışta hücrenin içine en/boy oranı bozulmadan sığdırılır ve yatay/dikey olarak ortalanır.', en: 'Each image initially fits inside its cell without changing its aspect ratio and is centered horizontally and vertically.' },
      { tr: 'Görseller iki hücreli ankraj ve editAs=twoCell ile yazılır; Excel tarafında Move and size with cells davranışı etkinleştirilir ve görselin noChangeAspect kilidi korunur.', en: 'Images are written with a two-cell anchor and editAs=twoCell, enabling Move and size with cells in Excel while preserving the image noChangeAspect lock.' },
      { tr: 'Görsellerin kaynak çözünürlüğü korunur; yalnız Excel içindeki başlangıç yerleşim kutusu hücre ölçülerine göre belirlenir.', en: 'Original image resolution is preserved; only the initial placement box in Excel is calculated from the cell dimensions.' },
    ],
  },
  {
    v: '5.16', date: '2026-08-07',
    title: { tr: 'Antrepo Excel eşleşme ve pivot yenileme düzeltmesi', en: 'Antrepo Excel matching and pivot refresh fix' },
    items: [
      { tr: 'Yüklenen gerçek ASAS ve Antrepo dosyalarıyla doğrulandı: 2.701 benzersiz Sipariş Kod + Model Adı/Ürün Ad + Renk Kod anahtarı birebir ortak. Antrepo kaynağındaki veri ve varsayılan eşleşme kuralı geçerli.', en: 'Verified with the supplied ASAS and Antrepo workbooks: 2,701 unique Order Code + Model Name/Product Name + Colour Code keys match exactly. The Antrepo source data and default matching rule are valid.' },
      { tr: 'Varsayılan üçlü eşleşmede gizli __MATCH_* model projeksiyonlarının kanonik Sipariş Kod / Model Adı / Renk Kod alanlarını gölgelemesi engellendi; kullanıcı tanımlı özel koşullar etkilenmez.', en: 'For the default three-field match, hidden __MATCH_* model projections can no longer override the canonical Order Code / Model Name / Colour Code fields; user-defined custom conditions remain supported.' },
      { tr: 'Antrepo parserındaki önceki satırdan kimlik taşıma yaklaşımı kaldırıldı. Eksik kimlik tahmin edilmez; yalnız Excel pivotunun gerçekten yazdığı tam kimlikli satırlar kullanılır.', en: 'The Antrepo parser no longer carries identity values from the previous row. Missing identities are never inferred; only full identities actually written by the Excel pivot are used.' },
      { tr: 'Excel pivot yenileme akışında OLAP PivotCache ikinci kez zorla yenilenmiyor. RefreshAll sonrasında her PivotTable RefreshTable ile yenileniyor ve Repeat Labels açıkça uygulanıyor.', en: 'The Excel pivot refresh flow no longer force-refreshes the OLAP PivotCache a second time. After RefreshAll, each PivotTable is refreshed via RefreshTable and Repeat Labels is explicitly applied.' },
      { tr: 'Başarılı Excel yenilemesinde kaç ASAS satırının Antrepo ile birebir eşleştiği yenileme notlarına yazılır.', en: 'After a successful Excel refresh, the refresh notes show how many ASAS rows matched Antrepo exactly.' },
    ],
  },
  {
    v: '5.15', date: '2026-08-07',
    title: { tr: 'Antrepo pivot boş satır düzeltmesi', en: 'Antrepo pivot blank-row fix' },
    items: [
      { tr: 'Antrepo Excel pivotunun veri alanından sonra kalan biçimlendirilmiş tamamen boş worksheet satırları artık IAS parsiyeli olarak değerlendirilmez.', en: 'Fully blank formatted worksheet rows remaining after the Antrepo pivot data area are no longer treated as IAS partial shipments.' },
      { tr: 'Gerçek Antrepo örneğinde 2.311 boş satırın son sipariş kimliğini miras alıp yanlış Yükleme Toplam Adet uyarısı üretmesine neden olan fill-down taşması giderildi.', en: 'Fixed pivot identity fill-down leaking into 2,311 trailing blank rows and producing false Loaded Quantity integrity warnings.' },
      { tr: 'Tamamen boş satır pivot kimlik zincirini keser; gerçek tekrarlanan pivot etiketleri için mevcut yüzde 100 Sipariş Kod + Model/Ürün + Renk Kod eşleşme kuralı korunur.', en: 'A fully blank row now resets the pivot identity chain while the exact Order Code + Model/Product + Colour Code matching rule remains unchanged for genuine repeated pivot labels.' },
    ],
  },
  {
    v: '5.14', date: '2026-08-07',
    title: { tr: 'Antrepo pivot eşleşme düzeltmesi', en: 'Antrepo pivot matching fix' },
    items: [
      { tr: 'Excel pivot yenilemesinden sonra tekrarlanan Sipariş Kod / Ürün Adı / Renk Kod etiketlerinin boş bırakıldığı satırlar, pivot hiyerarşisi içinde güvenli biçimde tamamlanarak ASAS ile yeniden tam üçlü eşleştiriliyor.', en: 'After Excel pivot refresh, rows whose repeated Order Code / Product Name / Colour Code labels are left blank are safely expanded within the pivot hierarchy and matched back to ASAS using the exact three-field identity.' },
      { tr: 'Tam eşleşme kuralı değişmedi: Sipariş Kod + Model Adı/Ürün Adı + Renk Kod alanlarının tamamı hâlâ %100 eşleşmek zorunda; fuzzy veya tahmini eşleşme eklenmedi.', en: 'The exact-match rule is unchanged: Order Code + Model Name/Product Name + Colour Code must still all match exactly; no fuzzy or approximate matching was added.' },
      { tr: 'Yenileme sonrası aynı Sipariş Kodları mevcut olduğu halde tam eşleşme sıfıra düşerse yeni Antrepo verisi sessizce uygulanmıyor; başarılı snapshot korunarak açık hata üretiliyor.', en: 'If exact matches collapse to zero after refresh while shared Order Codes still exist, the new Antrepo data is no longer applied silently; the last successful snapshot is preserved and an explicit error is raised.' }
    ]
  },
  {
    v: '5.13', date: '2026-08-07',
    title: { tr: 'Excel dışa aktarım bütünlüğü ve Backlog detay raporu', en: 'Excel export integrity and Backlog detail report parity' },
    items: [
      { tr: 'CP ve Orders standart Excel dışa aktarımı artık SheetJS dosyasını sonradan ExcelJS ile tekrar açıp yazmak yerine çalışma kitabını doğrudan ExcelJS ile üretir; sheet1.xml onarım hatasına yol açan karma yazma zinciri kaldırıldı.', en: 'CP and Orders standard Excel exports now build the workbook directly with ExcelJS instead of reopening a SheetJS workbook in ExcelJS, removing the mixed writer chain that could cause sheet1.xml repair errors.' },
      { tr: 'CP/Orders görselleri gerçek kaynak dosyadan hazırlanıp ekrandaki hücre genişliği ve satır yüksekliğine göre Excel hücresine gömülür; görsel ekleme hataları artık sessizce kaybolmak yerine konsola yazılır.', en: 'CP/Orders images are prepared from the actual source and embedded using the current on-screen cell width and row height; image embedding errors are now logged instead of being silently discarded.' },
      { tr: 'Backlog büyüteç detaylarının Excel çıktısı, ana Backlog raporuyla aynı kanonik sütun sırası, başlık biçimi, formül motoru, veri doğrulamaları ve sabit başlık davranışını kullanır.', en: 'Backlog magnifier detail exports now use the same canonical column order, header styling, formula engine, validations and frozen-header behavior as the main Backlog report.' },
      { tr: 'Orders standart Excel dışa aktarımı da ortak güvenli ExcelJS motoruna bağlandı.', en: 'Orders standard Excel export is now connected to the same safe ExcelJS export engine.' },
    ],
  },
  {
    v: '5.12', date: '2026-08-07',
    title: { tr: 'Notes Reminder tarih sıralaması', en: 'Notes Reminder date sorting' },
    items: [
      { tr: 'Notes Reminder başlığına notları kayıt tarihine göre Eski → Yeni / Yeni → Eski sıralayan kompakt bir düğme eklendi.', en: 'A compact Old → New / New → Old control was added to Notes Reminder to sort notes by registration date.' },
      { tr: 'Varsayılan sıralama eskiden yeniye olacak şekilde ayarlandı; tarihi bulunmayan eski notlar her iki yönde de listenin sonunda tutulur.', en: 'The default order is oldest to newest; legacy notes without a timestamp remain at the end in both directions.' },
    ],
  },
  {
    v: '5.11', date: '2026-08-07',
    title: { tr: 'Notes Reminder kayıt tarihleri', en: 'Notes Reminder registration dates' },
    items: [
      { tr: 'CP Notes ve Ek Not kayıtları değiştirildiğinde kayıt tarihi satır bazında kalıcı olarak saklanır.', en: 'When CP Notes or Additional Notes are changed, their registration timestamp is persisted per order line.' },
      { tr: 'Overview Notes Reminder başlıklarında not içeriğinin yanında GG.AA.YYYY biçiminde kayıt tarihi gösterilir.', en: 'Overview Notes Reminder headings show the note registration date next to the note text in DD.MM.YYYY format.' },
      { tr: 'Tarihi bulunmayan eski notlara tahmini tarih atanmaz; ilk sonraki düzenlemeden itibaren tarih kaydı oluşur.', en: 'Legacy notes without a timestamp are not assigned an estimated date; a timestamp is created on their next edit.' },
    ],
  },
  {
    v: '5.10', date: '2026-08-07',
    title: { tr: 'Antrepo pivot yenilemesi zorunlu ve yenileme sonuçları Overview’da', en: 'Mandatory Antrepo pivot refresh and refresh results on Overview' },
    items: [
      { tr: 'Antrepo kaynağı Excel olduğunda CP / Orders / Backlog yenilemesi, Antrepo çalışma kitabını gerçek Microsoft Excel ile açıp bağlantıları, PivotCache’leri ve PivotTable’ları yenilemeden veriyi okumaz.', en: 'When Antrepo uses Excel, CP / Orders / Backlog refresh will not read the workbook until Microsoft Excel has refreshed its connections, PivotCaches and PivotTables.' },
      { tr: 'Antrepo pivot yenilemesi başarısız olursa eski pivot verisi sessizce kullanılmaz; refresh fail-closed olarak durur ve mevcut başarılı snapshot korunur.', en: 'If Antrepo pivot refresh fails, stale pivot data is not silently used; refresh fails closed and the last successful snapshot is preserved.' },
      { tr: 'Yüklenen Antrepo Excel dosyaları da uygulama verisine alınmadan önce pivot yenilemesinden geçirilir.', en: 'Uploaded Antrepo Excel workbooks are also pivot-refreshed before their data is accepted by the application.' },
      { tr: 'Son yenileme sonucu ve değişiklik notlarının kısa özeti Overview ekranında doğrudan gösterilir; detay geçmişi karttaki Detayları aç düğmesinden erişilebilir.', en: 'The latest refresh result and a short preview of change notes are shown directly on Overview; full history is available from the Open details button.' },
    ],
  },
  {
    v: '5.09', date: '2026-08-07',
    title: { tr: 'Yenileme akışı güncel veriyi doğrulayarak yükler', en: 'Refresh flow now verifies and loads current data' },
    items: [
      { tr: 'Yenileme işleri benzersiz job kimliğiyle izleniyor; eski/boş durum kaydı artık başarılı refresh olarak kabul edilmiyor.', en: 'Refresh jobs are tracked with a unique job identity; stale or idle status can no longer be mistaken for a completed refresh.' },
      { tr: 'Refresh tamamlandıktan sonra /api/data no-store ile yeniden okunuyor ve dönen snapshot tamamlanan job ile doğrulanıyor.', en: 'After refresh completes, /api/data is reloaded with no-store and the returned snapshot is verified against the completed job.' },
      { tr: 'Source Data içindeki Refresh All artık CP, Orders, Backlog ve LFL hedeflerini açıkça yeniliyor; LFL kendi ekran cache’ini de yeni sunucu verisinden yeniden yüklüyor.', en: 'Refresh All now explicitly refreshes CP, Orders, Backlog and LFL; LFL also reloads its screen cache from the new server data.' },
      { tr: 'Arka-plan yenileme özeti ve değişiklik geçmişi güncel veriyle birlikte kullanıcıya geri taşınıyor.', en: 'Background refresh summary and change history are carried back together with the refreshed data.' },
    ],
  },
  {
    v: '5.08', date: '2026-08-07',
    title: { tr: 'Freeze Columns hover katman çakışması düzeltildi', en: 'Freeze Columns hover layer overlap fixed' },
    items: [
      { tr: 'Dondurulmuş sütunların hover zemini tamamen opak hale getirildi; yatay kaydırılan arka hücrelerin metinleri artık freeze alanından görünmüyor.', en: 'Frozen-column hover backgrounds are now fully opaque, so horizontally scrolling cells no longer bleed through the frozen area.' },
      { tr: 'CP, Orders ve Koleksiyon tablolarında freeze hücreleri ayrı bir katmanda izole edildi; başlık ve footer katman sıraları korunuyor.', en: 'Frozen cells are isolated in CP, Orders and Collection while preserving header and footer stacking.' },
    ],
  },
  {
    v: '5.07', date: '2026-08-07',
    title: { tr: 'LFL OPD ve Ex-F. kaynak alanları kesinleştirildi', en: 'LFL OPD and Ex-F. source fields locked' },
    items: [
      { tr: 'LFL detaylarındaki OPD yalnızca ASAS Sipariş Yerleştirme MerchTarih alanından alınır.', en: 'OPD in LFL details is read only from ASAS Sipariş Yerleştirme MerchTarih.' },
      { tr: 'LFL detaylarındaki Ex-F. yalnızca ASAS Orijinal Exfactory Merch Tarih alanından alınır; genel OPD / EX-FACTORY başlıklarına tahmini geri dönüş yapılmaz.', en: 'Ex-F. in LFL details is read only from ASAS Orijinal Exfactory Merch Tarih; generic OPD / EX-FACTORY headers are not used as fallback.' },
    ],
  },
  {
    v: '5.06', date: '2026-08-07',
    title: { tr: 'Backlog Sub Mfr ve LFL OPD / Ex-F. detayları', en: 'Backlog Sub Mfr and LFL OPD / Ex-F. details' },
    items: [
      { tr: 'Backlog filtre ve pivot kırılımlarına Sub Mfr / Alt Üretici eklendi. DTR siparişlerde Manufacturer, Non-DTR siparişlerde yalnız kullanıcı tarafından girilmiş Sub Mfr değeri kullanılır.', en: 'Sub Mfr is added to Backlog filters and pivot breakdowns. DTR orders use Manufacturer, while Non-DTR orders use only the user-entered Sub Mfr value.' },
      { tr: 'LFL portföy ve rapor detaylarına OPD ve Ex-F. tarihleri eklendi. Tarihler ana ASAS kaynağından gelir ve detay Excel çıktılarında da korunur.', en: 'OPD and Ex-F. dates are added to LFL portfolio and report details. Dates come from the main ASAS source and are also retained in detail Excel exports.' }
    ]
  },
  {
    v: '5.05', date: '2026-08-07',
    title: { tr: 'E-posta hazırlama sırasında canlı işlem bilgisi', en: 'Live processing status while preparing e-mail' },
    items: [
      { tr: 'Prepaire E-Mail işlemi başladıktan sonra kaynak CP veya Koleksiyon düğmesinin hemen altında canlı bir durum notu gösterilir; işlem bittiğinde veya hata oluştuğunda otomatik kapanır.', en: 'After Prepare E-Mail starts, a live status note appears directly below the source CP or Collection button and closes automatically when processing finishes or fails.' },
      { tr: 'Durum notu geçen süreyi, seçili kayıt/alıcı sayısını ve mevcut ek dosyalarının toplam adet/boyutunu gösterir; dosya boyutu ve iş yüküne göre sürenin uzayabileceğini açıkça belirtir.', en: 'The status note shows elapsed time, selected record/recipient counts, and attachment count/size, and clearly warns that processing can take longer depending on file size and workload.' },
      { tr: 'Excel hazırlama, 9,5 MB ek limiti planlama, e-posta görselleri/tablosu ve taslak oluşturma gibi aşamalar ilerledikçe durum metni güncellenir.', en: 'The status text updates as Excel generation, 9.5 MB attachment planning, e-mail image/table preparation, and draft creation progress.' }
    ]
  },
  {
    v: '5.04', date: '2026-08-07',
    title: { tr: 'Görsel dışa aktarımında hücreye bağlı ölçek ve orijinal çözünürlük', en: 'Cell-bound image scaling with original-resolution exports' },
    items: [
      { tr: 'Copy ile panoya alınan görseller artık hücre boyutuna küçültülmüş yeni bitmap olarak üretilmiyor. Orijinal görsel verisi korunuyor; ilk görünür ebat uygulamadaki mevcut görsel hücresini takip ediyor.', en: 'Images copied to the clipboard are no longer regenerated as downsampled cell-sized bitmaps. Original image data is preserved while the initial visible size follows the current in-app picture cell.' },
      { tr: 'Panoya kopyalanan görsel hücresi yüzde tabanlı görüntüleme kullanır; hedef e-posta/tablo hücresi büyütüldüğünde görsel de yeniden ölçeklenebilir ve düşük çözünürlüklü küçük kopyaya kilitlenmez.', en: 'Copied picture cells use percentage-based display sizing so the image can scale when the destination email/table cell is enlarged instead of being locked to a low-resolution thumbnail.' },
      { tr: 'CP, Orders, Koleksiyon ve e-posta Excel çıktılarındaki görseller orijinal çözünürlükle dosyaya gömülür; başlangıçta seçili Küçük/Orta/Büyük hücre ölçüsüne sığar ve Excel’de Move and size with cells mantığıyla satır/sütun boyutu değişikliklerini takip eder.', en: 'CP, Orders, Collection and email Excel exports embed the original-resolution image, initially fit it to the selected Small/Medium/Large cell size, and use Move and size with cells behavior so later row/column resizing also resizes the picture.' },
      { tr: 'Excel tarafından doğrudan desteklenmeyen görsel biçimleri PNG’ye çevrilirken 2400 piksel küçültme sınırı kaldırıldı; dönüşüm kaynak çözünürlüğünde yapılır.', en: 'The 2400-pixel downsampling cap was removed when converting image formats unsupported directly by Excel; conversion now preserves source resolution.' },
      { tr: 'E-posta taslaklarındaki CID görselleri de artık küçük bitmap kopyasına dönüştürülmüyor; orijinal çözünürlük ek içinde korunurken width/height yalnız ilk görünür boyutu belirliyor.', en: 'CID images in email drafts are no longer converted to low-resolution thumbnails; original resolution is retained in the attachment while width/height only define the initial display size.' }
    ]
  },
  {
    v: '5.03', date: '2026-08-07',
    title: { tr: 'Görsel boyutları yeniden hücreye bağlı ve satırlar kompakt', en: 'Image sizing is cell-responsive again with compact rows' },
    items: [
      { tr: 'CP, Orders ve Koleksiyon görsel modlarında satır yükseklikleri görsel oranından bağımsız, sabit ve daha kompakt hale getirildi.', en: 'Row heights in CP, Orders and Collection image modes are now fixed per mode, independent of image aspect ratio, and more compact.' },
      { tr: 'Panoya kopyalanan görseller kaynak dosyanın doğal piksel ölçüsüyle değil, ekranda görünen hücre/görsel ölçüsüne küçültülerek gömülür; Orta/Büyük/Küçük seçimi tekrar çıktı boyutunu değiştirir.', en: 'Clipboard images are downscaled to the visible cell/image dimensions instead of using source pixel dimensions, so Medium/Large/Small selection again changes output size.' },
      { tr: 'CP/Orders ve Koleksiyon Excel çıktılarında görsel sütunu, satır yüksekliği ve gömülü resim boyutu ekrandaki seçili görsel modunu takip eder; sabit dev satır ve sabit resim ölçüsü kaldırıldı.', en: 'CP/Orders and Collection Excel exports now follow the selected on-screen image mode for picture-column width, row height and embedded image size; fixed oversized rows/images were removed.' },
      { tr: 'E-posta gövdesindeki Picture alanı gerçek CID görsellerle doldurulur; CP ve Koleksiyon için seçili görsel boyutu korunur ve e-posta Excel tablolarına da görseller gömülür.', en: 'Picture fields in email bodies now use real CID images, preserve the selected CP/Collection image size, and are also embedded in email Excel tables.' },
      { tr: 'Açılışta kayıtlı model snapshotı doğrudan kullanılır; Antrepo Excel yeniden okuması ilk ekran yüklenmesini engellemez. Önceki Overview Notes, Orders toolbar ve Pricing History düzenlemeleri de korunur.', en: 'Saved model snapshots are used directly at startup so Antrepo Excel re-reading cannot block the first screen load. Previous Overview Notes, Orders toolbar and Pricing History adjustments are preserved.' }
    ]
  },
  {
    v: '5.00', date: '2026-08-07',
    title: { tr: 'Antrasit temasından geriye kalan taşıma kodu da silindi', en: 'The remaining Charcoal theme migration code was removed as well' },
    items: [
      { tr: 'Açılış betiğindeki charcoal→dark taşıması ve THEME_ALIAS tanımı kaldırıldı. Antrasit temasına ait tek bir satır bile kalmadı.', en: 'The charcoal-to-dark migration in the boot script and the THEME_ALIAS definition were removed. Not a single line of the Charcoal theme remains.' },
      { tr: 'applyTheme sadeleşti: tema adı doğrudan THEMES listesinde aranıyor. Tarayıcısında hâlâ eski tema tercihi kayıtlı bir kullanıcı olursa sistem temasına (Aydınlık veya Karanlık) düşer ve ilk tema değişiminde yeni tercihi kaydedilir.', en: 'applyTheme was simplified: the theme name is looked up directly in the THEMES list. If a user still has the old theme preference stored, they fall back to the system theme (Light or Dark) and their new choice is saved on the first theme switch.' },
      { tr: 'Sürüm koruma testi iki basamaklı gösterim biçimine uyarlandı ve kaldırılan temanın hiçbir dosyada geçmediğini de denetliyor.', en: 'The version guard test was adapted to the two-digit display format and now also verifies that the removed theme appears in no file.' }
    ]
  },
  {
    v: '4.99', date: '2026-08-07',
    title: { tr: 'Antrasit teması kaldırıldı; kaynak statüleri artık İngilizce kipte de çevriliyor', en: 'Charcoal theme removed; source statuses are now translated in English mode' },
    items: [
      { tr: 'Antrasit temasının artakalan CSS kuralları silindi (app.css, design.css, design-butunluk.css ve açılış perdesi stili; toplam 39 satır). Tema zaten THEME_ALIAS ile Karanlık\'a taşınmıştı, yalnız stiller geride kalmıştı.', en: 'The leftover CSS rules of the Charcoal theme were deleted (app.css, design.css, design-butunluk.css and the boot-guard style; 39 lines in total). The theme had already been migrated to Dark through THEME_ALIAS; only the styles remained behind.' },
      { tr: 'Kayıtlı tema tercihi hâlâ Antrasit olan kullanıcılar için charcoal→dark taşıması BİLEREK korundu; silinseydi bu kullanıcılar açılışta Aydınlık temaya düşerdi.', en: 'The charcoal-to-dark migration was deliberately kept for users whose stored theme preference is still Charcoal; removing it would have dropped them to the Light theme on start-up.' },
      { tr: 'Kaynak sistemden gelen operasyonel statüler (Üretimde, Depoda, Retaile Aktarım Bekleniyor, Eksik Yükleme, Depoda - Eksik Yükleme) İngilizce kipte artık çevrilerek gösteriliyor. Koleksiyon durum sözlüğüne de Konsept Onaylı, Konsept Onayı Bekleniyor, Buying Numunesi Onaylı karşılıkları eklendi.', en: 'Operational statuses coming from the source system (In Production, In Warehouse, Awaiting Retail Transfer, Shortage, In Warehouse - Shortage) are now shown translated in English mode. Concept Approved, Awaiting Concept Approval and Buying Sample Approved were added to the collection status dictionary as well.' },
      { tr: 'Çeviri YALNIZ gösterim katmanındadır. Statü değeri veriye her zaman ham Türkçe hâliyle yazılır; rozet rengi, sütun filtreleri, transit süresi çözümü, sevk kararı ve Backlog eşleştirmesi ham değerle çalışmaya devam eder. Filtre panelinde etiket çevrilir ama kutunun değeri ham kalır.', en: 'The translation lives in the display layer only. The status value is always stored in its raw Turkish form; badge colour, column filters, transit-time resolution, shipping decisions and Backlog matching keep working on the raw value. In the filter panel the label is translated while the checkbox value stays raw.' },
      { tr: 'Sözlükte karşılığı bulunmayan bir statü gelirse ham metin gösterilir; hiçbir koşulda boş hücre veya undefined oluşmaz. Bu davranış on ayrı testle koruma altına alındı.', en: 'If a status arrives without a dictionary entry, the raw text is displayed; no empty cell or undefined value can occur under any circumstances. Ten separate tests guard this behaviour.' }
    ]
  },
  {
    v: '4.98', date: '2026-08-07',
    title: { tr: 'Uygulama çekirdeği önbelleklenebilir dosyaya taşındı; tema düğmesi düzeltildi', en: 'Application core moved to a cacheable file; theme button corrected' },
    items: [
      { tr: 'index.html içindeki 1,36 MB\'lık satır içi betik app-main.js dosyasına alındı. index.html no-store ile sunulduğu için bu kod her sayfa açılışında yeniden indirilip yeniden ayrıştırılıyordu; artık ?v= sürüm etiketiyle bir yıl önbelleklenir. index.html 1.499 KB\'tan 125 KB\'a indi.', en: 'The 1.36 MB inline script inside index.html was moved into app-main.js. Because index.html is served with no-store, that code was re-downloaded and re-parsed on every page load; it is now cached for a year behind the ?v= version tag. index.html dropped from 1,499 KB to 125 KB.' },
      { tr: 'Dosya, eski satır içi bloğun tam olarak bulunduğu yerde ve defer/async olmadan yüklenir. Yürütme sırası bilerek birebir korunmuştur.', en: 'The file is loaded exactly where the former inline block sat, without defer or async. The execution order is deliberately identical to before.' },
      { tr: 'Ray tema düğmesinin ipucu "Aydınlık → Gri → Antrasit → Karanlık" yazıyordu; oysa Antrasit teması THEME_ALIAS ile Karanlık\'a taşınarak kaldırılmıştı ve Gri teması Kurşun olarak yeniden adlandırılmıştı. İpucu artık elle yazılmıyor, THEME_CYCLE listesinden üretiliyor; tema listesi değişirse metin kendiliğinden değişir.', en: 'The rail theme button tooltip read "Light → Grey → Charcoal → Dark", although the Charcoal theme had been removed via THEME_ALIAS in favour of Dark and the Grey theme had been renamed to Slate. The tooltip is no longer hand-written: it is generated from the THEME_CYCLE list, so it follows any change to the theme set.' },
      { tr: 'Tema seçim paneli İngilizce kipte de Türkçe tema adlarını gösteriyordu. Tema tanımlarına İngilizce etiketler eklendi.', en: 'The theme picker showed Turkish theme names even in English mode. English labels were added to the theme definitions.' },
      { tr: 'Sürüm numarası için koruma testi eklendi: package.json, tüm ?v= etiketleri, görünür sürüm yazısı, boot anahtarı ve sürüm geçmişindeki ilk kayıt artık birbirinden ayrışamaz. Statik dil işaretleri ve tema tek-kaynak kuralı da test altına alındı.', en: 'A guard test was added for the version number: package.json, every ?v= tag, the visible version label, the boot key and the first version-history entry can no longer drift apart. The static language markers and the single-source theme rule are covered by tests as well.' }
    ]
  },
  {
    v: '4.97', date: '2026-08-07',
    title: { tr: 'Araç ipuçları artık İngilizce kipte de çevriliyor', en: 'Tooltips are now translated in English mode as well' },
    items: [
      { tr: 'Arayüzdeki data-i18n-title işaretleri markup içinde duruyor ama hiçbir kod tarafından okunmuyordu; bu yüzden dil İngilizceye alındığında bütün araç ipuçları ve aria-label metinleri Türkçe kalıyordu. applyStaticI18n artık bu işaretleri de uyguluyor.', en: 'The data-i18n-title markers were present in the markup but never read by any code, so every tooltip and aria-label stayed Turkish when the language was switched to English. applyStaticI18n now applies them as well.' },
      { tr: 'Sol menü ve üst bardaki 20 araç ipucuna Türkçe/İngilizce karşılık çifti tanımlandı: Sürüm geçmişini gör, Menüyü daralt, Siparişler, Koleksiyon, Ön Maliyet, Nakliye Kıyaslama, Kaynak veriden oluştur, Uygulamada ara, Not Defteri, Tüm değişiklikleri kaydet, Veri Modelinden Güncelle, Kullanıcı menüsü ve diğerleri.', en: 'Turkish/English pairs were defined for 20 tooltips in the side rail and top bar: view version history, collapse menu, Orders, Collection, Open Costing, Shipping Comparison, build from source data, search all pages, Notebook, save all changes, refresh from data model, user menu and others.' },
      { tr: 'Karşılığı elle yazılmamış ipuçları TR_EN_DICT sözlüğünden çevrilir; sözlükte de yoksa Türkçe metin korunur, yani hiçbir ipucu boş kalmaz.', en: 'Tooltips without a hand-written counterpart fall back to the TR_EN_DICT dictionary; if the dictionary has no entry either, the Turkish text is kept, so no tooltip is ever left blank.' },
      { tr: 'Çeviri yalnız title ve aria-label özniteliklerine yazılır; düğmelerin içindeki simgeler korunur.', en: 'Translations are written only to the title and aria-label attributes, so the icons inside buttons are preserved.' },
      { tr: 'LFL doğrulama uyarısındaki "veritabanında" yazımı, arayüzün geri kalanıyla tutarlı olacak şekilde "veri tabanında" olarak düzeltildi.', en: 'The Turkish spelling in the LFL validation warning was corrected for consistency with the rest of the interface.' }
    ]
  },
  {
    v: '4.96', date: '2026-08-06',
    title: { tr: 'E-posta başlıklarına seçili model TP ekleri', en: 'Selected-model TP attachments for e-mail subjects' },
    items: [
      { tr: 'E-posta başlığı düzenleyicisindeki Excel ve gövde tablosu seçeneklerinin yanına Add TPs seçeneği eklendi. Ayar her e-posta başlığı ve kaynak ekran için ayrı saklanır.', en: 'An Add TPs option was added beside the Excel and body-table settings in the e-mail subject editor. The setting is stored separately for each e-mail subject and source screen.' },
      { tr: 'Add TPs açıkken seçili modellerin Buyer Log’da kayıtlı TP dosyaları otomatik olarak taslağa eklenir. CP satırları da PLM ID ve model adı üzerinden ilgili Koleksiyon modeliyle eşleştirilir.', en: 'When Add TPs is enabled, stored TP files of the selected models are attached automatically. CP rows are also matched to the relevant Collection model using PLM ID and model name.' },
      { tr: 'TP, manuel ek ve isteğe bağlı Excel dosyalarının tamamı mevcut fiyatlama ek motorundan geçirilir; her e-posta 9,5 MB altında tutulur, gerektiğinde dosyalar sıkıştırılır veya numaralı devam taslaklarına bölünür.', en: 'TPs, manual attachments, and the optional Excel file all use the existing pricing attachment engine; every e-mail stays below 9.5 MB, with compression or numbered continuation drafts when required.' },
      { tr: 'Mevcut Send to Pricing davranışını korumak için Add TPs fiyatlama başlıklarında varsayılan açık, genel e-posta başlıklarında varsayılan kapalıdır.', en: 'To preserve existing Send to Pricing behavior, Add TPs defaults to on for pricing subjects and off for general e-mail subjects.' }
    ]
  },
  {
    v: '4.95', date: '2026-08-06',
    title: { tr: 'Koleksiyon görsel yönetimi ve hücre hizası', en: 'Collection image management and cell alignment' },
    items: [
      { tr: 'Koleksiyon tablosunda model görselinin veya Picture hücresinin üzerine sağ tıklandığında, CP ile aynı yerel kaldırma onayı doğrudan ilgili görselin üzerinde açılır.', en: 'Right-clicking a model image or its Picture cell in Collection now opens the same local removal confirmation used in CP, anchored directly to the relevant image.' },
      { tr: 'Koleksiyon görselleri Picture hücrelerinde yatay ve dikey olarak ortalandı. Diğer Koleksiyon veri hücrelerinin Excel tipi sola hizalı düzeni korunur.', en: 'Collection images are now centered horizontally and vertically within Picture cells, while the Excel-style left alignment of other Collection data cells is preserved.' }
    ]
  },
  {
    v: '4.94', date: '2026-08-06',
    title: { tr: 'Hızlı öneri listelerinin scroll sırasında kapanması', en: 'Close quick suggestion lists on scroll' },
    items: [
      { tr: 'Koleksiyon ve diğer düzenlenebilir tablo hücrelerinde açılan hızlı öneri listeleri, tablo veya sayfa kaydırıldığı anda kapanır; artık hücreyi takip etmeye devam etmez.', en: 'Quick suggestion lists opened from Collection and other editable table cells now close as soon as the table or page scrolls instead of continuing to follow the cell.' },
      { tr: 'Öneri listesinin kendi içindeki kaydırma korunur; kullanıcı liste içindeki seçenekleri scroll ile gezmeye devam edebilir.', en: 'Scrolling inside the suggestion list itself is preserved so users can continue browsing its options.' }
    ]
  },
  {
    v: '4.93', date: '2026-08-06',
    title: { tr: 'Quotations ve Pricing History pencerelerinin büyütülmesi', en: 'Larger Quotations and Pricing History windows' },
    items: [
      { tr: 'Quotations ve Pricing History çalışma pencereleri ekranın neredeyse tamamını kullanacak şekilde büyütüldü; geniş tablolar için daha fazla yatay ve dikey alan sağlandı.', en: 'The Quotations and Pricing History workspaces now use nearly the full viewport, providing substantially more horizontal and vertical space for wide tables.' },
      { tr: 'Pricing History tablo alanı kalan pencere yüksekliğini tamamen kullanır; dar ekranlarda güvenli kenar boşlukları korunur.', en: 'The Pricing History table area now fills the remaining window height while safe viewport margins are retained on narrow screens.' }
    ]
  },
  {
    v: '4.92', date: '2026-08-06',
    title: { tr: 'Koleksiyon özetleri, görsel yönetimi ve royalty ayarları', en: 'Collection summaries, image management and royalty settings' },
    items: [
      { tr: 'Koleksiyon tablosunda Overseas Landed ve TR Landed sütunlarının altında adet ağırlıklı ortalamalar gösterilir. Target Price, Confirmed FOB, FOB ve iki Landed sütununda ağırlıklı ortalamanın yanında aritmetik ortalama da yer alır.', en: 'Quantity-weighted averages are now shown below the Overseas Landed and TR Landed columns. Target Price, Confirmed FOB, FOB and both Landed columns also display the arithmetic average next to the weighted average.' },
      { tr: 'Koleksiyon öneri listesi tek bir hücreye bağlı tekil panel olarak çalışır. Scroll veya yeniden çizim sonrasında ekran ortasında kalan ikinci öneri paneli temizlenir; genel Sub-Mfr/License öneri mekanizması Koleksiyon hücreleri için ikinci panel üretmez.', en: 'Collection suggestions now use a single panel anchored to one cell. Any duplicate panel left at the center after scrolling or rerendering is removed, and the generic Sub-Mfr/License suggestion system no longer creates a second panel for Collection cells.' },
      { tr: 'Koleksiyon, CP ve diğer düzenlenebilir model görseli alanlarında sağ tıkla silme, görselin üzerinde açılan yerel onay paneliyle yapılır. Koleksiyon ve Ön Maliyet görselleri de aynı genel davranışı kullanır.', en: 'Right-click image removal in Collection, CP and other editable style-image areas now uses a local confirmation panel positioned over the image. Collection and Open Costing images follow the same general behavior.' },
      { tr: 'Koleksiyon tablosundaki hücre içerikleri yatayda sola, dikeyde ortaya hizalandı; metin, sayı, fiyat, Landed ve görsel hücreleri aynı Excel tipi hizalama kuralına bağlandı.', en: 'Collection cell contents are now left-aligned horizontally and centered vertically, applying one Excel-like alignment rule to text, numbers, prices, Landed values and image cells.' },
      { tr: 'Supp. FOB Rules düğmesi CP işlem şeridinden kaldırıldı. Aynı kural yönetimi Source Data > Ayarlar menüsüne License Royalty Rules adıyla taşındı.', en: 'The Supp. FOB Rules button was removed from the CP action bar. The same rule management is now available under Source Data > Settings as License Royalty Rules.' }
    ]
  },
  {
    v: '4.91', date: '2026-08-06',
    title: { tr: 'Koleksiyon hücre editörü ve öneri paneli düzeltmeleri', en: 'Collection cell editor and suggestion panel fixes' },
    items: [
      { tr: 'Koleksiyon hücresindeki ASAS öneri paneli, tablo yatay veya dikey kaydırılırken bağlı olduğu hücrenin güncel ekran konumunu takip eder. Hücre görünüm alanından tamamen çıkarsa eski konumda asılı kalmak yerine kapanır.', en: 'The ASAS suggestion panel in Collection now follows the current screen position of its cell during horizontal or vertical table scrolling. If the cell leaves the viewport completely, the panel closes instead of remaining behind.' },
      { tr: 'Aktif hücrede yalnız Excel tipi yeşil hücre çerçevesi gösterilir. Metin giriş elemanının ayrıca kutu veya zemin çizmesi kaldırılarak çift çerçeve görünümü giderildi.', en: 'Only the Excel-style green cell outline is shown for the active cell. The separate box and background drawn by the text input were removed to eliminate the double-frame appearance.' }
    ]
  },
  {
    v: '4.90', date: '2026-08-06',
    title: { tr: 'Koleksiyon Landed formüllerinin düzeltilmesi', en: 'Corrected Collection Landed formulas' },
    items: [
      { tr: 'Overseas Landed hesabı DTR modellerde FOB × Landed Çarpanı olarak korunur. Non-DTR modellerde önce FOB ÷ (1 − Royalty %) + Hologram Cost hesaplanır, ardından Landed Çarpanı uygulanır.', en: 'For DTR models, Overseas Landed remains FOB × Landed Multiplier. For Non-DTR models, FOB ÷ (1 − Royalty %) + Hologram Cost is calculated first, then the Landed Multiplier is applied.' },
      { tr: 'TR Landed hesabı DTR modellerde (TR Fiyat ÷ Kur) × Landed Çarpanı olarak korunur. Non-DTR modellerde ((TR Fiyat ÷ Kur) ÷ (1 − Royalty %) + Hologram Cost) × Landed Çarpanı formülü kullanılır.', en: 'For DTR models, TR Landed remains (TR Price ÷ FX Rate) × Landed Multiplier. For Non-DTR models, the formula is ((TR Price ÷ FX Rate) ÷ (1 − Royalty %) + Hologram Cost) × Landed Multiplier.' },
      { tr: 'Royalty oranı %100 veya daha yüksek olduğunda geçersiz bölme yapılmaması için Landed sonucu boş bırakılır. Hücre açıklamaları da kullanılan yeni formülü gösterir.', en: 'When the royalty rate is 100% or higher, the Landed result is left blank to prevent an invalid division. Cell tooltips now display the corrected formula as well.' }
    ]
  },
  {
    v: '4.89', date: '2026-08-06',
    title: { tr: 'ASAS seçenekli Excel benzeri Koleksiyon tablosu', en: 'Excel-like Collection grid with ASAS suggestions' },
    items: [
      { tr: 'Category, MAG, MMYG, Buying Group, Buyer, Season, License, Licensor, Country ve Line seçenekleri LFL yerine doğrudan ASAS sipariş verilerinden sunucuda bir kez hazırlanır. Hücre odaklanırken LFL yükleme veya binlerce satırı tekrar tarama işlemi yapılmaz.', en: 'Suggestions for Category, MAG, MMYG, Buying Group, Buyer, Season, License, Licensor, Country, and Line are prepared once on the server directly from ASAS order data instead of LFL. Focusing a cell no longer loads LFL or repeatedly scans thousands of rows.' },
      { tr: 'Bu alanlar Excel hücresi gibi serbest metin kabul eder; yazarken Sub-Mfr alanındaki gibi ASAS seçenekleri gösterilir. Tam eşleşen girişler ASAS’taki kanonik yazıma dönüştürülür, eşleşmeyen özel girişler engellenmez.', en: 'These fields accept free text like Excel cells while showing ASAS suggestions similar to the Sub-Mfr field. Exact matches are normalized to the canonical ASAS spelling, while unmatched custom entries remain allowed.' },
      { tr: 'Koleksiyon tablosuna aktif hücre çerçevesi ve satır/sütun vurgusu eklendi. Enter ve Shift+Enter dikey, Tab ve Shift+Tab yatay ilerler; ok tuşları hücreler arasında gezinir, Escape düzenlemeyi geri alır ve Alt+Enter hücre içinde yeni satır ekler.', en: 'The Collection table now has an active-cell outline plus row and column highlighting. Enter and Shift+Enter move vertically, Tab and Shift+Tab move horizontally, arrow keys navigate cells, Escape cancels the edit, and Alt+Enter inserts a line break inside a cell.' },
      { tr: 'Excel’den kopyalanan çok satırlı ve çok sütunlu bloklar, seçilen Koleksiyon hücresinden başlayarak tabloya tek işlem halinde yapıştırılabilir; tüm blok tek geri-al adımıyla kaydedilir. Otomatik hesaplanan ve salt-okunur hücreler korunur.', en: 'Multi-row and multi-column blocks copied from Excel can be pasted into the Collection table starting at the selected cell and are saved as one operation with a single undo step. Calculated and read-only cells remain protected.' },
      { tr: 'Koleksiyon hücreleri daha kompakt Excel tipi ızgara çizgileri ve dikdörtgen düzenleme yüzeyi kullanır; mevcut fiyat, görsel, formül, filtre, sıralama ve sütun düzeni işlevleri korunur.', en: 'Collection cells now use compact Excel-style grid lines and rectangular editing surfaces while preserving existing pricing, image, formula, filter, sort, and column-layout behavior.' }
    ]
  },
  {
    v: '4.88', date: '2026-08-06',
    title: { tr: 'Non-DTR landed maliyetleri ve yeni satır konumu', en: 'Non-DTR landed costs and new-row placement' },
    items: [
      { tr: 'Koleksiyon Overseas Landed ve TR Landed hesaplarında Non-DTR satırlar için royalty ve hologram maliyeti landed çarpanından önce baz fiyata eklenir. Örneğin 1,00 USD + %25 royalty + 0,05 USD hologram = 1,30 USD baz landed fiyatı olur.', en: 'For Non-DTR Collection rows, royalty and hologram cost are added to the base price before the landed multiplier in both Overseas Landed and TR Landed calculations. For example, USD 1.00 + 25% royalty + USD 0.05 hologram produces a USD 1.30 landed base.' },
      { tr: 'TR fiyatı önce ilgili kurla USD’ye çevrilir; Non-DTR royalty ve hologram maliyeti daha sonra eklenir ve en son TR Landed çarpanı uygulanır. DTR satırların mevcut hesaplama davranışı değişmez.', en: 'The TR price is first converted to USD using the applicable exchange rate; Non-DTR royalty and hologram cost are then added, and the TR Landed multiplier is applied last. Existing DTR calculations remain unchanged.' },
      { tr: 'Add New Model ile eklenen boş satır, aktif filtre veya sıralamadan bağımsız olarak ilk gösterimde tablonun en üstünde açılır. İlk düzenleme ya da yeni bir filtre/sıralama işleminden sonra diğer satırlar gibi normal akışa döner.', en: 'A blank row added with Add New Model appears at the top on its first display regardless of active filters or sorting. After the first edit or a new filter/sort action, it returns to the normal table flow.' }
    ]
  },
  {
    v: '4.87', date: '2026-08-06',
    title: { tr: 'Sağ tık düzenleme engeli', en: 'Right-click editing guard' },
    items: [
      { tr: 'Sağ fare tuşunun pointer ve mouse olayları, tablo hücreleri veya düzenleme kontrollerine ulaşmadan pencere seviyesinde durdurulur; sağ tık artık hiçbir hücreyi düzenleme moduna sokmaz ve onay/seçim işlevi çalıştırmaz.', en: 'Secondary-button pointer and mouse events are stopped at window level before reaching table cells or editing controls; right-click no longer enters cell edit mode or activates approval/selection actions.' },
      { tr: 'Sağ tuşla el tipi kaydırma yatay, dikey ve çapraz yönlerde çalışmaya devam eder; sürükleme yapılmadığında normal sağ tık menüsü korunur.', en: 'Right-button hand panning continues to work horizontally, vertically and diagonally, while the normal context menu remains available when no dragging occurs.' },
      { tr: 'Sağ tuşla sürükleme sırasında hedef hücrenin focus, pointerdown veya mousedown akışları tetiklenmediği için kaydırma işlemi düzenleme davranışıyla kesintiye uğramaz.', en: 'During right-button dragging, target-cell focus, pointerdown and mousedown flows are not triggered, so panning is no longer interrupted by editing behavior.' }
    ]
  },
  {
    v: '4.86', date: '2026-08-06',
    title: { tr: 'Program köprülerinde çift tıkla açma', en: 'Double-click opening for program bridge links' },
    items: [
      { tr: 'Sipariş ve sevkiyat için program içinde oluşturulan Troy/CPS köprüleri artık tek tıkla açılmaz; bağlantı yalnız sol fare tuşuyla çift tıklandığında yeni sekmede açılır.', en: 'Troy/CPS bridges created in the program for orders and shipments no longer open on a single click; the link opens in a new tab only after a left-button double-click.' },
      { tr: 'Tek tıklama satır seçimi gibi tablo etkileşimlerini korur; bağlantıların üzerine gelindiğinde çift tıklama gereksinimini açıklayan Türkçe/İngilizce ipucu gösterilir.', en: 'A single click remains available for table interactions such as row selection, and Turkish/English tooltips explain that the links require a double-click.' },
      { tr: 'Klavye erişilebilirliği korunmuştur; Enter ile bağlantı etkinleştirme davranışı engellenmez.', en: 'Keyboard accessibility is preserved; link activation with Enter is not blocked.' }
    ]
  },
  {
    v: '4.85', date: '2026-08-06',
    title: { tr: 'Koleksiyon kaydırma performansı ve tam yönlü sağ tuş sürükleme', en: 'Collection scroll performance and true omnidirectional right-button panning' },
    items: [
      { tr: 'Koleksiyon tablosunda kaydırma sırasında pahalı satır hover hesapları geçici olarak durduruldu; fare hareketiyle eş zamanlı kaydırmada oluşan takılma azaltıldı.', en: 'Expensive row-hover hit testing is temporarily suspended while the Collection table is scrolling, reducing stutter when moving the pointer and scrolling at the same time.' },
      { tr: 'Koleksiyon satırları stil hesaplaması bakımından birbirinden izole edildi ve görsel önizleme kaydırma başladığında kapatılarak gereksiz yeniden boyamalar önlendi.', en: 'Collection rows are isolated for style calculation, and image preview is dismissed when scrolling begins to avoid unnecessary repaints.' },
      { tr: 'Sağ tuşla el tipi kaydırma gerçek tablo kaydırma yüzeyini önceliklendirir ve yatay/dikey konumları sürükleme başlangıcından birlikte hesaplar.', en: 'Right-button hand panning now prioritizes the actual table scroll surface and computes horizontal and vertical positions together from the drag origin.' },
      { tr: 'Yatay, dikey ve çapraz sürükleme tablonun hücre, giriş ve diğer alanlarından başlatılabilir; sürükleme yapılmadığında normal sağ tık davranışı korunur.', en: 'Horizontal, vertical, and diagonal dragging can start from cells, inputs, and other table areas; the normal context-menu behavior remains when no drag occurs.' }
    ]
  },
  {
    v: '4.84', date: '2026-08-06',
    title: { tr: 'Koleksiyon Excel içe aktarımı, doğrudan yeni satır ve güvenli çoğaltma', en: 'Collection Excel import, direct new row and safe duplication' },
    items: [
      { tr: 'Koleksiyon Excel içe aktarımında "Klasman - Buying Group" biçimindeki Category değerleri LFL kataloğundaki ana Klasman değerine otomatik olarak eşlenir.', en: 'During Collection Excel import, Category values in "Classification - Buying Group" format are automatically matched to the main Classification value in the LFL catalog.' },
      { tr: 'Eski bir Koleksiyon kaydındaki Category değeri Excel’de değişmeden kalmışsa, artık LFL kataloğunda bulunmaması diğer alanların içe aktarılmasını engellemez. Doğrulama yalnız yeni veya gerçekten değiştirilen Category değerlerine uygulanır.', en: 'When a legacy Collection Category remains unchanged in Excel, its absence from the current LFL catalog no longer blocks importing other fields. Validation applies only to new or genuinely changed Category values.' },
      { tr: 'Add New Model düğmesi artık açılır pencere açmadan doğrudan Koleksiyon tablosunun başına boş bir satır ekler ve Model Name hücresini düzenlemeye hazırlar.', en: 'Add New Model now inserts a blank row directly at the top of the Collection table without opening a dialog and prepares the Model Name cell for editing.' },
      { tr: 'Duplicate işlemi kaynak modelin pricing, Confirmed Manufacturer, Conf. FOB ve diğer verilerini ayrık bir snapshot ile korur. Yalnız yeni kopyanın fiyatlama ve onay geçmişi temizlenir.', en: 'Duplicate now preserves the source model pricing, Confirmed Manufacturer, Conf. FOB and all other data through a detached snapshot. Only the new copy has its pricing and approval history cleared.' }
    ]
  },
  {
    v: '4.83', date: '2026-08-06',
    title: { tr: 'Koleksiyon FOB fiyat önceliği ve tam yönlü sağ tuş kaydırma', en: 'Collection FOB price fallback and omnidirectional right-button panning' },
    items: [
      { tr: 'Koleksiyon FOB sütunu artık onaylı fiyat yoksa Best Price, o da yoksa Target Price üzerinden aynı royalty ve hologram formülüyle hesaplanır.', en: 'The Collection FOB column now uses Best Price when no price is confirmed, and Target Price when no quotation exists, with the same royalty and hologram formula.' },
      { tr: 'Onaysız Best Price veya Target Price üzerinden hesaplanan FOB değeri tabloda soluk referans olarak gösterilir; fiyat kaynağı hücre açıklamasında belirtilir.', en: 'FOB calculated from unconfirmed Best Price or Target Price is shown as a muted reference, with the source identified in the cell tooltip.' },
      { tr: 'Sağ fare tuşuyla el tipi kaydırma yatay, dikey ve çapraz yönlerde çalışacak şekilde pointer tabanlı olarak yeniden düzenlendi.', en: 'Right-button hand panning was rebuilt with pointer events to work horizontally, vertically, and diagonally.' },
      { tr: 'Sağ tuşla kaydırma girişler, düğmeler ve diğer program alanları üzerinden de başlatılabilir; sürükleme yapılmazsa normal sağ tık menüsü korunur.', en: 'Right-button panning can also start over inputs, buttons, and other application areas; the normal context menu remains available when no drag occurs.' }
    ]
  },
  {
    v: '4.82', date: '2026-08-06',
    title: { tr: 'Hızlı tema geçişi ve yeniden çizimsiz kopyalama', en: 'Fast theme switching and copy without rerendering' },
    items: [
      { tr: 'Tema değişimi sırasında aktif ağır tablo görünümü kısa süreli render dışına alınarak binlerce hücrenin aynı karede yeniden boyanması engellendi.', en: 'During theme changes, the active heavy table view is briefly excluded from rendering so thousands of cells are not repainted in the same frame.' },
      { tr: 'Kopyalama sırasında uygulama artık geçici olarak Aydınlık temaya geçirilmez; kaynak tablo işlem öncesinde ve sonrasında yeniden çizilmez.', en: 'Copying no longer temporarily switches the application to the Light theme, and the source table is not rerendered before or after copying.' },
      { tr: 'Seçili satırlar zaten ekrandaysa kademeli çizimde bekleyen ilgisiz satırlar tamamlanmadan kopyalama başlar.', en: 'When selected rows are already present on screen, copying begins without finishing unrelated rows still pending in progressive rendering.' },
      { tr: 'Hücre stilleri kopyalama boyunca önbelleğe alındı; aynı satırdaki görseller paralel hazırlanarak büyük seçimlerde pano üretimi hızlandırıldı.', en: 'Cell styles are cached during copying, and images in the same row are prepared in parallel to speed up clipboard generation for large selections.' }
    ]
  },
  {
    v: '4.81', date: '2026-08-06',
    title: { tr: 'Koleksiyon Best Price hücresinden Fiyat Geçmişi', en: 'Pricing History from Collection Best Price cell' },
    items: [
      { tr: 'Koleksiyon tablosundaki Best Price hücresine çift tıklandığında yalnız ilgili modelin Fiyat Geçmişi penceresi doğrudan açılır.', en: 'Double-clicking a Best Price cell in the Collection table now opens Pricing History directly for that model only.' },
      { tr: 'Best Price hücresinin açıklamasına çift tıklama yönlendirmesi eklendi; geçerli fiyat bulunmayan modellerde de ilgili modelin boş fiyat geçmişi görüntülenebilir.', en: 'The Best Price tooltip now includes the double-click hint, and the model-specific empty history can still be viewed when no valid price exists.' }
    ]
  },
  {
    v: '4.80', date: '2026-08-06',
    title: { tr: 'CP ve Siparişler içinde geniş Backlog detayı', en: 'Wide Backlog detail inside CP and Orders' },
    items: [
      { tr: 'CP ve Siparişler ekranındaki Seçili Backlog Raporu artık kullanıcıyı Backlog sayfasına geçirmeden mevcut ekranın üzerinde açılır.', en: 'The Selected Backlog Report on CP and Orders now opens over the current page without navigating to the Backlog page.' },
      { tr: 'CP ve Siparişler tablolarındaki STATUS hücresine çift tıklandığında ilgili Sipariş Kod + Model Adı + Renk Kod kimliğinin bütün Antrepo parsiyelleri aynı detay penceresinde gösterilir.', en: 'Double-clicking a STATUS cell in CP or Orders shows all Antrepo partial shipments for the matching Order Code + Model Name + Colour Code identity in the same detail window.' },
      { tr: 'Backlog detay penceresi ekranın neredeyse tamamını kullanacak şekilde büyütüldü; başlık satırı sabit, yatay ve dikey kaydırma alanları genişletildi.', en: 'The Backlog detail window now uses nearly the full screen, with a sticky header and enlarged horizontal and vertical scrolling areas.' },
      { tr: 'Açık Backlog detay satırlarını biçimlendirilmiş Excel dosyasına aktaran Excel’e Aktar düğmesi eklendi.', en: 'An Export to Excel action was added for exporting the currently displayed Backlog detail rows to a formatted workbook.' }
    ]
  },
  {
    v: '4.79', date: '2026-08-05',
    title: { tr: 'CP ve Siparişler için seçili Backlog raporu', en: 'Selected Backlog report for CP and Orders' },
    items: [
      { tr: 'CP ve Siparişler ekranlarının Seçilenler alanına Backlog Raporu düğmesi eklendi. Düğme yalnız satır seçildiğinde etkinleşir.', en: 'A Backlog Report button was added to the Selected area of the CP and Orders pages. It becomes active only when rows are selected.' },
      { tr: 'Rapor, Backlog pivotundaki büyüteç detayıyla aynı operasyon satırı görünümünü kullanır ve seçilen siparişlerin bütün IAS parsiyellerini gösterir.', en: 'The report uses the same operational-row detail view as the magnifier in the Backlog pivot and shows all IAS partial shipments for the selected orders.' },
      { tr: 'Seçimler Sipariş Kod + Model Adı + Renk Kod tam kimliğiyle çözülür; aynı sipariş kodunun seçilmeyen model veya renkleri rapora karışmaz.', en: 'Selections are resolved by the exact Order Code + Model Name + Colour Code identity, preventing unselected models or colours under the same order code from entering the report.' },
      { tr: 'CP seçimi CP veri ufkunu, Siparişler seçimi ise aktif ve pasif kayıtları kapsayan Siparişler veri ufkunu kullanır.', en: 'CP selections use the CP data horizon, while Orders selections use the Orders horizon that includes active and inactive records.' }
    ]
  },
  {
    v: '4.78', date: '2026-08-05',
    title: { tr: 'Uyarı detayları, yeni Freeze Columns ve sağ tuşla kaydırma', en: 'Warning details, rebuilt Freeze Columns and right-button panning' },
    items: [
      { tr: 'Satır bazlı veri uyarıları detaylandırıldı. Uyarılar penceresinde desteklenen bir kayda çift tıklanınca, ilgili ASAS veya Antrepo satırları LFL portföy detayı benzeri geniş ve kaydırılabilir bir tabloda açılır.', en: 'Row-based data warnings now include drill-down details. Double-clicking a supported warning opens the related ASAS or Antrepo rows in a wide, scrollable table similar to the LFL portfolio detail view.' },
      { tr: 'Birden fazla Ana Kumaş Mı = 1 kaydı bulunan sipariş kimlikleri ile geçersiz Yükleme Toplam Adet veya Net Alım Sipariş Miktarı taşıyan IAS satırları için kaynak satır, sipariş, model, renk ve lojistik alanları gösterilir.', en: 'Source row, order, model, colour and logistics fields are shown for order identities with multiple Main Fabric = 1 rows and IAS rows with invalid Loaded Quantity or Net Purchase Order Quantity.' },
      { tr: 'Freeze Columns baştan yazıldı. Düğme seçim sırasında soft kırmızı yanar; tablo üzerinde sütunun sağ kenarını izleyen lazer çizgisine tıklandığında seçilen sütun ve solundaki tüm sütunlar dondurulur. Düğmeye tekrar basmak dondurmayı kaldırır.', en: 'Freeze Columns was rebuilt. The button glows soft red while active; clicking the laser line that follows a column’s right edge freezes that column and every column to its left. Pressing the button again removes the freeze.' },
      { tr: 'Arama kutularında tarayıcı ve parola yöneticilerinin Saved Info önerilerini bastıran otomatik tamamlama işaretleri uygulandı.', en: 'Search inputs now apply autofill-suppression hints to prevent browser and password-manager Saved Info suggestions.' },
      { tr: 'Program alanları ve tablolar sağ fare tuşu basılı tutularak sürüklenebilir hâle getirildi; hareket yönüne göre en yakın yatay ve dikey kaydırma alanları el ile kaydırılır.', en: 'Application areas and tables can now be panned by holding the right mouse button and dragging; the nearest horizontal and vertical scroll containers follow the movement.' }
    ]
  },
  {
    v: '4.77', date: '2026-08-05',
    title: { tr: 'Açılır pencere, Field Mapping ve CP Priority düzenlemeleri', en: 'Popup, Field Mapping and CP Priority refinements' },
    items: [
      { tr: 'CP’de tıklanan model görselinin kalıcı seçili görünmesi kaldırıldı; yapıştırma hedefi korunurken yalnız kısa bir tıklama geri bildirimi gösterilir.', en: 'CP model images no longer remain visually selected after clicking; the paste target is preserved while only brief click feedback is shown.' },
      { tr: 'Columns Chooser ile ortak filtre ve seçim pencereleri tetikleyici düğmeyi ortalayacak, ekran sınırları içinde kalacak ve kendi listeleri kaydırılırken yer değiştirmeyecek şekilde düzenlendi.', en: 'Columns Chooser and shared filter/selection popups now center on their trigger, stay inside the viewport and remain stationary while their own lists are scrolled.' },
      { tr: 'Source Data ve ayar modallarındaki maliyetli arka plan blur efekti kaldırıldı. Data Model Connection genişletildi; otomatik sorgu/kod özetleri gizlendi ve açılışta gereksiz sorgu önizlemeleri çalıştırılmıyor.', en: 'Expensive background blur was removed from Source Data and settings modals. Data Model Connection was enlarged, generated query/code summaries were hidden, and unnecessary preview requests no longer run on open.' },
      { tr: 'Field Mapping ayrı ve geniş bir çalışma penceresine taşındı. Para Birimi (LFL) istisnası dışında zorunlu eşleşme eksikse Yenile düğmeleri kırmızı yanıp söner; Source Data altındaki uyarı Field Mapping ekranını doğrudan açar.', en: 'Field Mapping now has a separate wide workspace. Except for LFL Currency, missing required mappings make Refresh buttons blink red, and the Source Data warning opens Field Mapping directly.' },
      { tr: 'CP Priority’de Discount varsa Delay ve MB Delay, Delay varsa MB Delay gösterilmez. Shortage ana Status alanından çıkarıldı ve Priority içinde Eksik Yükleme notu olarak gösterilir.', en: 'In CP Priority, Discount suppresses Delay and MB Delay, while Delay suppresses MB Delay. Shortage was removed from the main Status field and is shown as a Shortage note in Priority.' }
    ]
  },
  {
    v: '4.76', date: '2026-08-05',
    title: { tr: 'Backlog, Koleksiyon ve tablo dondurma geliştirmeleri', en: 'Backlog, Collection and table-freezing improvements' },
    items: [
      { tr: 'Backlog pivotunun satır, sütun ve değer filtreleme boyutlarına Antrepo/ASAS yükleme bilgisinden gelen Vasıta Tipi eklendi.', en: 'Vehicle Type, sourced from the Antrepo/ASAS delivery information, was added to the Backlog pivot row, column and value-filter dimensions.' },
      { tr: 'Koleksiyon tablosuna düzenlenebilir Special Code ve Line sütunları eklendi; CP’den Koleksiyon’a aktarılan siparişlerde bu alanlar da taşınır.', en: 'Editable Special Code and Line columns were added to Collection, and these values now follow orders copied from CP.' },
      { tr: 'Quotation kayıtlarının Notebook ile otomatik bağlantısı kaldırıldı. Yeni kayıtlar Notebook sayfası oluşturmaz; eski sürümlerin otomatik quotation sayfaları normal kullanıcı notlarına dokunulmadan bir kez temizlenir.', en: 'Automatic quotation-to-Notebook linking was removed. New quotations no longer create Notebook pages, and legacy auto-generated quotation pages are cleaned once without touching normal user notes.' },
      { tr: 'CP ve Koleksiyon Freeze Columns işlevi yeniden düzenlendi: başlıklar ve donmuş grup bantları doğru ofsetle sabitlenir, iki sınır arasındaki alan kaydırılabilir kalır ve sütun genişliği değişince donmuş alanlar anında yeniden hizalanır.', en: 'Freeze Columns in CP and Collection was rebuilt: headers and frozen group bands remain aligned, the area between two boundaries stays scrollable, and frozen offsets are recalculated immediately after resizing.' },
      { tr: 'Dondurma seçim kipinde gövde hücre bazında kararır; ilk seçimden sonra sağ taraf, ikinci seçimden sonra yalnız iki seçim arasındaki alan aydınlık kalır. Seçili başlıklar belirginleştirildi ve bilgi kartı sabit konuma alındı.', en: 'Freeze-selection mode now dims body cells individually; after the first choice the right side stays bright, and after the second only the interval between the choices remains bright. Selected headers are clearer and the instruction card stays fixed.' },
      { tr: 'CP ve Siparişler tablolarındaki Order Info, Kumaş, Lojistik ve Notlar grup başlıkları sürüklenebilir hâle getirildi; bir grup taşındığında altındaki tüm sütunlar birlikte yer değiştirir.', en: 'The Order Info, Fabric, Logistics and Notes group headers in CP and Orders can now be dragged, moving every underlying column as one block.' }
    ]
  },
  {
    v: '4.75', date: '2026-08-05',
    title: { tr: 'LFL analiz kırılımı altı seviyeye çıkarıldı', en: 'LFL analysis breakdown increased to six levels' },
    items: [
      { tr: 'LFL Analysis Breakdown alanında seçilebilen iç içe kırılım seviyesi dört yerine altıya çıkarıldı.', en: 'The number of nested levels selectable in LFL Analysis Breakdown was increased from four to six.' },
      { tr: 'Hazır filtreler ve kayıtlı LFL görünüm ayarları artık altı kırılım seviyesini de kaydedip geri yükler.', en: 'Ready filters and saved LFL view settings now preserve and restore all six breakdown levels.' }
    ]
  },
  {
    v: '4.74', date: '2026-08-05',
    title: { tr: 'Model snapshot açılış hatası düzeltmesi', en: 'Model snapshot startup fix' },
    items: [
      { tr: 'Program açılışında kayıtlı model snapshot yüklenirken oluşan “parsedAsas is not defined” hatası giderildi. Snapshot içindeki ASAS, Antrepo, LFL ve kumaş başlık bilgileri artık tanımsız bir çalışma değişkenine erişmeden güvenle yüklenir.', en: 'Fixed the “parsedAsas is not defined” error that occurred while loading a saved model snapshot at startup. ASAS, Antrepo, LFL and fabric-header data are now restored safely without referencing an undefined runtime variable.' },
      { tr: 'Yeni ASAS yenilemelerinde ana kumaş başlık bilgisinin kaydedilmesi korunurken, açılışta mevcut snapshot üzerindeki kumaş başlık bilgisi doğrudan snapshot kaydından okunur.', en: 'Main-fabric header metadata continues to be saved during new ASAS refreshes, while startup restoration now reads the existing fabric-header metadata directly from the snapshot.' }
    ]
  },
  {
    v: '4.73', date: '2026-08-05',
    title: { tr: 'Sütun sığdırma, Sub-Mfr kuralları ve Approvals kaldırma', en: 'Column fitting, Sub-Mfr rules and Approvals removal' },
    items: [
      { tr: 'CP, Siparişler ve Koleksiyon tablolarında Freeze Columns düğmesinin soluna Fit Column Width / Sütunları Sığdır düğmesi eklendi. Düğme bütün sütun genişliklerini tek işlemle en dar okunabilir ölçülerine getirir ve yeni genişlikleri kalıcı olarak saklar.', en: 'A Fit Column Width button was added immediately to the left of Freeze Columns in the CP, Orders and Collection tables. It reduces every column to its narrowest readable width in one action and saves the resulting widths persistently.' },
      { tr: 'DTR siparişlerde Sub-Mfr bilgisi her zaman Manufacturer ile aynı olacak şekilde otomatik oluşturulur ve kullanıcı girişine kapalıdır. Non-DTR siparişlerde yalnız kullanıcı tarafından kaydedilen Sub-Mfr gösterilir; giriş bulunmuyorsa alan boş kalır.', en: 'For DTR orders, Sub-Mfr is automatically set to the Manufacturer and is read-only. For Non-DTR orders, only the user-entered Sub-Mfr is shown; the field remains blank when no entry exists.' },
      { tr: 'Approvals / Onaylar sayfası, tablo kodu, Excel içe/dışa aktarma işlevleri, filtreleri, genel arama ve kullanıcı yetki bağlantıları programdan kaldırıldı. Eski onay statüleri temizlenirken CP Notes ve Ek Not kayıtları ayrı not deposuna taşınarak korunur.', en: 'The Approvals page, table code, Excel import/export functions, filters, global-search entries and user-access links were removed. Legacy approval statuses are discarded while CP Notes and Additional Notes are migrated to the separate notes store and preserved.' },
      { tr: 'Eski Approvals görünüm/filtre profilleri ve tarayıcı tercihleri açılışta temizlenir. Siparişler sayfası genel arama ve kullanıcı erişim alanlarında tam bir sayfa olarak desteklenir; eski profillerde erişim CP yetkisinden güvenle devralınır.', en: 'Legacy Approvals view/filter profiles and browser preferences are cleaned on startup. The Orders page is now fully supported by global search and access areas; existing profiles safely inherit its access from CP when no explicit Orders setting exists.' }
    ]
  },
  {
    v: '4.72', date: '2026-08-05',
    title: { tr: 'Kumaş bilgilerinin doğrudan ASAS entegrasyonu', en: 'Direct ASAS integration for fabric information' },
    items: [
      { tr: 'CP ve LFL kumaş bilgileri artık ayrı bir Fabric Information kaynağından değil, doğrudan ana ASAS sorgusundan alınır. Update Fabric Informations işlevi, ayrı Fabric bağlantı rolü ve ilgili yenileme seçeneği programdan kaldırıldı.', en: 'CP and LFL fabric information is now read directly from the main ASAS query instead of a separate Fabric Information source. Update Fabric Informations, the separate Fabric connection role and its refresh option were removed.' },
      { tr: 'Aynı Sipariş Kod + Model Adı + Renk Kod kimliğine ait birden fazla ASAS satırı bulunduğunda yalnız Ana Kumaş Mı değeri 1 olan satırın Kumaş Kategorisi, Kumaşçı Ülkesi, Kumaşçı, Kumaş Tipi, İplik No, Gramaj ve Karışım bilgileri kullanılır; 0 veya boş olan yan kumaşlar dikkate alınmaz.', en: 'When multiple ASAS rows share the same Order Code + Model Name + Colour Code identity, only the row whose Main Fabric flag is 1 supplies Fabric Category, Fabric Supplier Country, Fabric Supplier, Fabric Type, Yarn Count, Weight and Composition; secondary fabrics marked 0 or blank are ignored.' },
      { tr: 'ASAS ana kumaş satırı yan kumaş satırından sonra gelse bile bilgiler aynı sipariş kaydında birleştirilir. Ana Kumaş Mı alanı kaynakta bulunamazsa yanlış kumaş eşleşmesi yapılmaz ve yenileme uyarısı gösterilir.', en: 'Fabric data is merged into the same order even when the main-fabric row appears after a secondary-fabric row. If the Main Fabric field is unavailable in the source, no potentially incorrect fabric match is made and a refresh warning is shown.' },
      { tr: 'Veri modeli sorgusu, yerel ASAS Excel yedeği ve manuel ASAS yükleme yollarının tamamı aynı ana kumaş kuralını kullanır; CP sütunları ile LFL filtre, kırılım ve portföy detayları bu ortak veriden beslenir.', en: 'Data-model queries, the local ASAS Excel fallback and manual ASAS uploads all use the same main-fabric rule; CP columns and LFL filters, breakdowns and portfolio details are supplied from this common data.' }
    ]
  },
  {
    v: '4.71', date: '2026-08-05',
    title: { tr: 'Aktif ve pasif siparişler için Siparişler sayfası', en: 'Orders page for active and inactive orders' },
    items: [
      { tr: 'CP sayfasının tablo, hızlı arama, boyut filtreleri, sütun yönetimi, görseller, kopyalama ve Excel aktarımı düzenini kullanan yeni Siparişler / Orders sayfası eklendi. Sayfa salt okunurdur ve sipariş geçmişini incelemek için hem aktif hem pasif siparişleri listeler.', en: 'A new Orders / Siparişler page was added using the CP page layout for the table, quick search, dimension filters, column management, images, copying and Excel export. The page is read-only and lists both active and inactive orders for reviewing order history.' },
      { tr: 'Hızlı filtrelerin başına Aktif ve Pasif seçenekleri eklendi. Yalnız aktif, yalnız pasif veya iki seçeneği birlikte kullanarak bütün siparişler görüntülenebilir.', en: 'Active and Inactive options were added at the beginning of the quick filters. Users can display active orders only, inactive orders only, or both together.' },
      { tr: 'ASAS ve Antrepo bağlantılarında Siparişler hedefi için CP ve Backlog’dan bağımsız kapsam ve ufuk çizgisi tanımlanabilir. Eski bağlantılar ilk açılışta CP ufkunun kopyasıyla güvenli biçimde başlatılır.', en: 'ASAS and Antrepo connections can now define a separate scope and horizon for the Orders target, independent of CP and Backlog. Existing connections are safely initialized with a copy of the CP horizon on first use.' },
      { tr: 'Pasif siparişler tabloda soluk biçimde ayrıştırılır; aktif siparişlerin mevcut lojistik parsiyel, durum ve Priority hesapları değiştirilmez.', en: 'Inactive orders are visually muted in the table, while the existing partial-shipment, status and Priority calculations for active orders remain unchanged.' }
    ]
  },
  {
    v: '4.70', date: '2026-08-05',
    title: { tr: 'Ana kumaş bilgileri CP ve LFL entegrasyonu', en: 'Main fabric integration for CP and LFL' },
    items: [
      { tr: 'ASAS kumaş kaynağında yalnız Ana Kumaş Mı değeri 1 olan satırlar kullanılır. Ana kumaş bilgisi Sipariş Kod + Model Adı + Renk Kod tam kimliğiyle ilgili siparişe bağlanır; 0 veya boş olan yan kumaş satırları dikkate alınmaz.', en: 'Only rows with Main Fabric equal to 1 are used from the ASAS fabric source. Main fabric data is linked by the exact Order Code + Model Name + Colour Code identity; secondary rows marked 0 or blank are ignored.' },
      { tr: 'Kumaş Kategorisi, Kumaşçı Ülkesi, Kumaşçı, Kumaş Tipi, İplik No, Gramaj ve Karışım alanları CP tablosunda istenen sırada yan yana gösterilir.', en: 'Fabric Category, Fabric Supplier Country, Fabric Supplier, Fabric Type, Yarn Count, Weight and Composition are displayed consecutively in the requested order in the CP table.' },
      { tr: 'LFL filtrelerine yedi kumaş alanı; kırılımlara Kumaş Kategorisi, Kumaş Tipi, Gramaj ve Karışım eklendi.', en: 'All seven fabric fields were added to LFL filters, while Fabric Category, Fabric Type, Weight and Composition were added as breakdown dimensions.' },
      { tr: 'Trial LFL düğmesinin yanındaki Kumaş Detayları seçeneği, ana kumaş alanlarını bütün LFL portföy detay tablolarında ve ilgili Excel detay sayfalarında gösterir veya gizler. Tercih kalıcı olarak saklanır.', en: 'The Fabric Details option beside Trial LFL shows or hides main fabric fields in every LFL portfolio detail table and related Excel detail sheet. The preference is saved persistently.' }
    ]
  },
  {
    v: '4.69', date: '2026-08-05',
    title: { tr: 'CP görsellerinde iki boyut seçeneği', en: 'Two CP image size options' },
    items: [
      { tr: 'CP Görsel sütunundaki Küçük boyut kaldırıldı. Görsel başlığına tıklayarak yalnız Orta ve Büyük görünüm arasında geçiş yapılır.', en: 'The Small option was removed from the CP Picture column. Clicking the picture header now switches only between Medium and Large.' },
      { tr: 'Daha önce Küçük boyutu seçmiş kullanıcıların tercihi ilk açılışta otomatik olarak Orta boyuta taşınır; eski dar sütun genişliği yeniden uygulanmaz.', en: 'Users who previously selected Small are automatically migrated to Medium on first launch, and the old narrow column width is not restored.' },
      { tr: 'Görsel ekleme, kaldırma, hover önizleme, kopyalama ve Excel aktarımı davranışları değişmeden korunur.', en: 'Image upload, removal, hover preview, copying and Excel export behavior remain unchanged.' }
    ]
  },
  {
    v: '4.68', date: '2026-08-05',
    title: { tr: 'CP hızlı aramasında PLM ID desteği', en: 'PLM ID support in CP quick search' },
    items: [
      { tr: 'CP tablosunun üzerindeki hızlı arama kutusuna PLM ID alanı eklendi. Kullanıcı PLM ID yazarak ilgili sipariş satırlarını doğrudan filtreleyebilir.', en: 'PLM ID was added to the quick search above the CP table. Users can now filter order rows directly by entering a PLM ID.' },
      { tr: 'Model, lisans, üretici, alt üretici, özel kod, renk kodu, sipariş kodu ve renk alanlarındaki mevcut arama davranışı korunur.', en: 'Existing search behavior for model, license, manufacturer, sub-manufacturer, special code, colour code, order code and colour remains unchanged.' }
    ]
  },
  {
    v: '4.67', date: '2026-08-05',
    title: { tr: 'CP Shipment Quantity sütunu', en: 'CP Shipment Quantity column' },
    items: [
      { tr: 'CP tablosunda Order Quantity sütununun hemen sağına Yükleme Adet sütunu eklendi. İngilizce görünümde başlık Shipment Qty olarak gösterilir.', en: 'A Shipment Qty column was added immediately to the right of Order Quantity in the CP table. Its Turkish heading is Yükleme Adet.' },
      { tr: 'Yükleme Adet değeri, aynı Sipariş Kod + Model Adı/Ürün Ad + Renk Kod kimliğiyle eşleşen tüm Antrepo parsiyellerinin Yükleme Toplam Adet toplamıdır.', en: 'Shipment Qty is the sum of Loading Total Quantity across all Antrepo partials matching the same Order Code + Model Name/Product Name + Colour Code identity.' },
      { tr: 'IAS/Antrepo kaydı bulunmayan siparişlerde Yükleme Adet sıfır gösterilir. Parsiyeller yenilendiğinde sütun ve Remaining hesabı aynı lojistik özetinden birlikte güncellenir.', en: 'Shipment Qty is shown as zero when no IAS/Antrepo record exists. When partials are refreshed, this column and Remaining are updated together from the same logistics summary.' },
      { tr: 'Yeni sütun CP kopyalama işlemlerine, standart Excel çıktısına ve Export with Approvals dosyasına sayısal sütun olarak dahil edildi.', en: 'The new column is included as a numeric field in CP copying, standard Excel export and Export with Approvals.' }
    ]
  },
  {
    v: '4.66', date: '2026-08-05',
    title: { tr: 'Koleksiyon fiyat sütunları ve Quotation tablo geri alımı', en: 'Collection pricing columns and Quotation table rollback' },
    items: [
      { tr: 'Quotations ekranına yanlışlıkla uygulanan sütun taşıma düzeni ve Confirmed Manufacturer / Conf. FOB sütunları geri alındı. Quotation tablosu v4.64 düzenine döndü; quotation notu, Capacity Confirmed ve Pricing History iyileştirmeleri korundu.', en: 'The column-reordering layout and Confirmed Manufacturer / Conf. FOB columns that were mistakenly applied to Quotations were rolled back. The Quotation table returned to its v4.64 layout while quotation notes, Capacity Confirmed and Pricing History improvements were retained.' },
      { tr: 'Koleksiyon tablosundaki Best Price, Confirmed Manufacturer ve Conf. FOB sütunları artık diğer Koleksiyon sütunları gibi sürükle-bırak ile taşınabilir ve genişlikleri kalıcı olarak ayarlanabilir.', en: 'Best Price, Confirmed Manufacturer and Conf. FOB in the Collection table can now be moved by drag and drop and resized persistently like the other Collection columns.' },
      { tr: 'Henüz onaylı üretici veya fiyat yoksa Confirmed Manufacturer ve Conf. FOB hücrelerinde Best Price üreticisi ve fiyatı soluk gri referans değeri olarak gösterilir. Referans değer onay sayılmaz ve FOB hesaplamasına girmez.', en: 'When no manufacturer or price is confirmed, Confirmed Manufacturer and Conf. FOB show the Best Price manufacturer and price as muted grey reference values. The reference is not treated as an approval and is not used in FOB calculations.' },
      { tr: 'Koleksiyon sütun sırası ve sentetik fiyat sütunlarının genişlikleri kullanıcı görünümünde saklanır. Overseas Landed ve TR Landed için mevcut en sağda kalma kuralı korunur.', en: 'The Collection column order and widths of synthetic pricing columns are saved per user view. The existing rule keeping Overseas Landed and TR Landed at the far right remains in place.' }
    ]
  },
  {
    v: '4.65', date: '2026-08-04',
    title: { tr: 'Quotation notu, kapasite teyidi ve Pricing History iyileştirmeleri', en: 'Quotation notes, capacity confirmation and Pricing History improvements' },
    items: [
      { tr: 'Quotations tablosundaki sütunlar sürükle-bırak ile taşınabilir hâle getirildi. Best Price, Confirmed Manufacturer ve Conf. FOB dahil tüm sütunların genişlikleri ayrı ayrı ayarlanıp kalıcı olarak saklanır.', en: 'Quotation table columns can now be reordered by drag and drop. Widths for every column, including Best Price, Confirmed Manufacturer and Conf. FOB, can be resized and are saved persistently.' },
      { tr: 'Confirmed Manufacturer ve Conf. FOB sütunları eklendi. Onaylı kayıt varsa gerçek onay bilgisi; henüz onay yoksa Best Price ve ilgili üretici soluk referans değeri olarak gösterilir.', en: 'Confirmed Manufacturer and Conf. FOB columns were added. Actual approval data is shown when available; otherwise the Best Price and its manufacturer appear as muted reference values.' },
      { tr: 'Her quotation kaydına, üst bilgi şeridinden açılan bağımsız bir not alanı eklendi. Notlar quotation düzeyinde saklanır ve model satırlarına bağlı değildir.', en: 'Each quotation now has its own note field opened from the compact header strip. Notes are stored at quotation level and are not tied to individual model rows.' },
      { tr: 'Quotation düzeyinde Capacity Confirmed kutusu eklendi. Bu quotation içindeki üretici fiyatları Pricing History’de yumuşak mavi tik ile işaretlenir.', en: 'A quotation-level Capacity Confirmed checkbox was added. Manufacturer prices from that quotation are marked with a soft blue check in Pricing History.' },
      { tr: 'Pricing History varsayılan olarak Price Order görünümünde açılır. Model görselleri artık kırpılmadan contain biçiminde gösterilir ve hover büyük önizleme çalışır.', en: 'Pricing History now opens in Price Order view by default. Model images use contain sizing without cropping and support hover preview.' }
    ]
  },
  {
    v: '4.64', date: '2026-08-04',
    title: { tr: 'Shortage Priority ve depo eksik yükleme durumu', en: 'Shortage priority and warehouse-shortage status' },
    items: [
      { tr: 'Eksik Yükleme durumundaki siparişler Priority hesabında artık Üretimde kabul edilmez. Siparişin tamamı ASAS Ex-Factory tarihinde yüklenmiş varsayılır; geçmiş Ex-Factory tarihi bugüne taşınarak sahte Delay veya Discount üretilmez.', en: 'Orders in Shortage are no longer treated as In Production for priority. The full order is assumed loaded on the ASAS Ex-Factory date, preventing false Delay or Discount flags caused by moving a past Ex-Factory date to today.' },
      { tr: 'Shortage için tahmini antrepo ve zamanlama değerlendirmesi Ex-Factory + ülke, sezon ve yükleme tipine uygun transit süresiyle yapılır. Sentetik shortage antrepo tarihi gerçek IAS varışı sayılmadığı için Ant. Delay ve Handover uyarısı üretmez.', en: 'Shortage arrival and timing are evaluated using Ex-Factory plus the transit time matching country, season and delivery type. Because the synthetic shortage arrival is not an actual IAS arrival, it does not create Ant. Delay or Handover warnings.' },
      { tr: 'Eksik Yükleme bakiyesi bulunan siparişin bütün gerçek Antrepo parsiyelleri Depoda ise CP ve Backlog durumu Depoda - Eksik Yükleme olur. İngilizce CP görünümünde In Warehouse - Shortage yazılır.', en: 'When an order has a shortage balance and all real Antrepo partials are In Warehouse, CP and Backlog display Depoda - Eksik Yükleme. The English CP view displays In Warehouse - Shortage.' },
      { tr: 'Backlog Excel canlı Priority formülleri de aynı kurala geçirildi: Shortage satırında Ex-Factory doğrudan kullanılır, Discount yalnız Üretimde satırlarında hesaplanır.', en: 'Backlog Excel live Priority formulas now follow the same rule: Shortage uses the Ex-Factory date directly, while Discount is calculated only for In Production rows.' }
    ]
  },
  {
    v: '4.63', date: '2026-08-04',
    title: { tr: 'CP görsellerinde PLM ID + Colour Code bağlantısı', en: 'PLM ID + Colour Code binding for CP images' },
    items: [
      { tr: 'CP görsellerinin kalıcı kimliği PLM ID + Colour Code olarak değiştirildi. Aynı PLM ID’nin farklı renk kodları artık birbirinden bağımsız görsel kullanır.', en: 'The persistent CP image identity is now PLM ID + Colour Code. Different colour codes under the same PLM ID can now use separate images.' },
      { tr: 'Aynı PLM ID ve Colour Code kimliğini paylaşan farklı sipariş satırlarında görsel ortak kalır; bir satırdaki ekleme, değiştirme veya kaldırma yalnız bu birleşik kimliğe uygulanır.', en: 'Rows sharing the same PLM ID and Colour Code retain one shared image; add, replace or remove actions apply only to that combined identity.' },
      { tr: 'Önceki PLM ID bazlı ve daha eski sipariş satırı bazlı görseller geçiş uyumluluğuyla görünmeye devam eder. Yeni işlem yapıldığında PLM ID + Colour Code anahtarı kalıcı olarak yazılır.', en: 'Earlier PLM-only and older order-line images remain visible through migration compatibility. New actions persist the PLM ID + Colour Code key.' },
      { tr: 'PLM ID veya Colour Code bulunmayan CP satırlarında görsel ekleme ve kaldırma engellenerek yanlış kimliğe kayıt yapılması önlenir.', en: 'Image add and remove actions are blocked for CP rows missing PLM ID or Colour Code, preventing writes to an incorrect identity.' }
    ]
  },
  {
    v: '4.62', date: '2026-08-04',
    title: { tr: 'CP genel aramasında genişletilmiş sütun kapsamı', en: 'Expanded column coverage in CP global search' },
    items: [
      { tr: 'CP tablosunun başındaki genel arama kutusu Manufacturer, Sub-Manufacturer, Special Code ve Colour Code alanlarını da doğrudan tarar.', en: 'The global search box at the top of the CP table now directly searches Manufacturer, Sub-Manufacturer, Special Code and Colour Code.' },
      { tr: 'Mevcut Model Name, License, Order Code ve Colour aramaları korunur; yeni alanlar aynı birleşik arama sorgusuna eklenmiştir.', en: 'Existing Model Name, License, Order Code and Colour searches are preserved, with the new fields added to the same combined query.' },
      { tr: 'Sub Manufacturer ve Color Code yazım varyasyonları da desteklenir; böylece farklı kaynak başlıkları aynı arama davranışını sürdürür.', en: 'Sub Manufacturer and Color Code header variants are also supported so different source headings retain the same search behavior.' }
    ]
  },
  {
    v: '4.61', date: '2026-08-04',
    title: { tr: 'CP görsellerinde PLM ID bazlı bağlantı', en: 'PLM ID-based CP image binding' },
    items: [
      { tr: 'CP görsellerinin kalıcı bağlantısı Sipariş Kod + Model Adı + Renk Kod üçlüsünden çıkarıldı ve doğrudan PLM ID anahtarına geçirildi.', en: 'The persistent CP image link was moved from the Order Code + Model Name + Colour Code identity to a direct PLM ID key.' },
      { tr: 'Aynı PLM ID’ye sahip farklı sipariş, model satırı veya renk kayıtları CP’de tek görseli paylaşır. Bir satırdan görsel eklemek, değiştirmek veya kaldırmak aynı PLM ID’ye bağlı bütün CP satırlarına uygulanır.', en: 'Different order, model-line or colour records sharing the same PLM ID now use one CP image. Adding, replacing or removing an image from one row applies to every CP row linked to that PLM ID.' },
      { tr: 'ASAS veya Antrepo yenilemesinde Sipariş Kod, Model Adı ya da Renk Kod değişse bile PLM ID aynı kaldığı sürece görsel bağlantısı korunur.', en: 'The image link is preserved through ASAS or Antrepo refreshes when Order Code, Model Name or Colour Code changes, as long as the PLM ID remains the same.' },
      { tr: 'Önceki sürümlerde sipariş satırı anahtarıyla kaydedilmiş görseller geçiş uyumluluğuyla görünmeye devam eder. PLM bazlı ilk ekleme, değiştirme veya kaldırma işleminden sonra yeni bağlantı kuralı kalıcı olarak kullanılır.', en: 'Images saved by the former order-line key remain visible through migration compatibility. After the first PLM-based add, replace or remove action, the new binding rule is used persistently.' },
      { tr: 'PLM ID bulunmayan CP satırlarına görsel bağlanması engellenir; böylece görselin yanlış veya geçici bir sipariş kimliğine kaydedilmesi önlenir.', en: 'Attaching an image to a CP row without a PLM ID is blocked, preventing images from being stored against an incorrect or temporary order identity.' }
    ]
  },
  {
    v: '4.60', date: '2026-08-04',
    title: { tr: 'Quotation kapatma izolasyonu ve güvenli fiyat kaydı', en: 'Quotation close isolation and reliable price commits' },
    items: [
      { tr: 'Quotation kaydını Kapandı durumuna almak artık yalnız Quotations açılır penceresindeki takip listesini etkiler. Kayıttaki fiyatlar, onaylar, Koleksiyon fiyatları ve Pricing History satırları korunur.', en: 'Setting a quotation to Closed now affects only the tracking list in the Quotations dialog. Recorded prices, approvals, Collection prices and Pricing History rows are retained.' },
      { tr: 'Quotation Price hücresindeki değer change olayına ek olarak blur sırasında da kaydedilir. Kullanıcı hücreden fareyle başka bir alana geçtiğinde giriş kaybolmaz.', en: 'Quotation Price values are now committed on blur in addition to change. Entries are not lost when the user clicks elsewhere after editing a cell.' },
      { tr: 'Quotation penceresindeki liste, filtre, durum, onay, kapatma veya başka bir kontrole tıklanmadan önce odaktaki fiyat hücresi açıkça commit edilir.', en: 'Before clicking the quotation list, filters, status, approval, close or another control, the focused price cell is explicitly committed.' },
      { tr: 'Quotation durumu değiştirilmeden önce bekleyen fiyat, onay ve Drop kayıt kuyruğunun sunucuya tamamlanması beklenir. Böylece içerik PUT çağrısı ile durum PATCH çağrısı arasındaki yarış ve kapalı kayıtta veri kaybı engellenir.', en: 'Before changing quotation status, the pending price, approval and Drop save queue is allowed to finish. This prevents races between the content PUT and status PATCH calls and avoids data loss when closing a record.' }
    ]
  },
  {
    v: '4.59', date: '2026-08-04',
    title: { tr: 'Minimal beşli Nakliye Kıyas fiyat şeridi', en: 'Compact five-card Shipping Comparison price strip' },
    items: [
      { tr: 'Nakliye Kıyaslama kartları daha dar ve minimal bir yapıya geçirildi. Geniş model kartı fiyatların solundan kaldırıldı; model, sipariş ve operasyon bilgileri fiyatların üzerinde kompakt bir bilgi şeridinde gösterilir.', en: 'Shipping Comparison cards now use a narrower, more minimal layout. The wide model card was removed from the left of the prices; model, order and operational details are shown in a compact information strip above them.' },
      { tr: 'Fiyat kartlarının soldan sağa sırası sabitlendi: FOB, Domestic FOB, SEA Landed, SEA+AIR Landed ve AIR Landed. Ham FOB da diğer fiyatlarla aynı dikey konumda ve aynı sayı biçiminde gösterilir.', en: 'The price-card order is fixed from left to right: FOB, Domestic FOB, SEA Landed, SEA+AIR Landed and AIR Landed. Raw FOB is displayed at the same vertical position and with the same numeric formatting as the other prices.' },
      { tr: 'Her kartta Domestic FOB’a göre yüzde oranı görünür. Domestic FOB yüzde referansı olarak 0,0% gösterilir; ham FOB yalnız fiyat zincirinin kaynağıdır ve En Ucuz taşıma kararına dahil edilmez.', en: 'Every card shows its percentage versus Domestic FOB. Domestic FOB displays 0.0% as the percentage baseline; raw FOB is only the source of the price chain and is excluded from the Cheapest transport decision.' },
      { tr: 'Kart boşlukları, başlıkları, fiyat alanları, rozetleri ve giriş kutuları sıkılaştırıldı. Dar tarayıcı pencerelerinde kartlar birbirine girmek yerine kendi alanlarında yatay kaydırılır.', en: 'Card spacing, headings, price areas, badges and inputs were tightened. In narrow browser windows the cards scroll horizontally within their own area instead of overlapping.' }
    ]
  },
  {
    v: '4.58', date: '2026-08-04',
    title: { tr: 'Nakliye Kıyas kartlarında canlı formül hesaplama', en: 'Live formula calculation in Shipping Comparison cards' },
    items: [
      { tr: 'Nakliye Kıyaslama kartlarındaki TR fiyatı, kur, Gemi + Uçak landed, Uçak landed ve Ex-Factory alanları yazılırken formüller artık anında yeniden hesaplanır; kartı terk etmeyi beklemeden fiyat, yüzde, toplam fark ve tahmini antrepo sonuçları güncellenir.', en: 'Domestic price, FX rate, Sea + Air landed, Air landed and Ex-Factory inputs in Shipping Comparison now recalculate formulas immediately while typing, updating price, percentage, total difference and estimated arrival without waiting to leave the card.' },
      { tr: 'Kart girişleri tablo hücreleriyle aynı kalıcı kayıt yoluna bağlandı. Change, blur, Enter, sekme geçişi ve işlem düğmesine basma durumlarında aktif değer güvenli biçimde kaydedilir.', en: 'Card inputs now use the same persistent commit path as table cells. The active value is safely saved on change, blur, Enter, tab navigation and action-button use.' },
      { tr: 'Türkçe ve İngilizce sayı biçimleri birlikte desteklenir. 1.234,50, 1234,50 ve 1234.50 gibi girişler doğru sayıya çevrilir; geçersiz değerler kırmızı alan ve açık uyarıyla gösterilir.', en: 'Both Turkish and English numeric formats are supported. Inputs such as 1.234,50, 1234,50 and 1234.50 are parsed correctly; invalid values are shown with a red field and a clear warning.' },
      { tr: 'Canlı önizleme gerçek kayıt satırını değiştirmeden geçici bir kopya üzerinde hesaplanır. Böylece yazma sırasında istem dışı kayıt veya undo girdisi oluşmaz; kalıcı kayıt yalnız commit aşamasında yapılır.', en: 'Live preview is calculated on a temporary copy without mutating the stored row. This prevents unintended saves or undo entries while typing; persistence occurs only at commit time.' }
    ]
  },
  {
    v: '4.57', date: '2026-08-04',
    title: { tr: 'CP sipariş görselleri ve görselli dışa aktarma', en: 'CP order images and image-aware exports' },
    items: [
      { tr: 'CP tablosuna sipariş satırı bazında kalıcı Görsel sütunu eklendi. Görseller Sipariş Kod + Model Adı + Renk Kod kimliğiyle saklanır; ASAS veya Antrepo yenilemesinde kaybolmaz.', en: 'A persistent Picture column was added to the CP table at order-line level. Images are stored by Order Code + Model Name + Colour Code identity and remain available after ASAS or Antrepo refreshes.' },
      { tr: 'Koleksiyonla aynı kullanım uygulanır: tek tık görsel yapıştırma hedefini seçer, Ctrl+V panodaki görseli kaydeder, çift tık dosya seçtirir, sağ tık görseli kaldırır ve üzerine gelince büyük önizleme açılır.', en: 'The Collection interaction model is reused: single-click selects the paste target, Ctrl+V saves a clipboard image, double-click opens file selection, right-click removes the image and hover shows a large preview.' },
      { tr: 'Görsel başlığına tıklayarak Küçük, Orta ve Büyük görünüm arasında geçiş yapılabilir. Boyut tercihi kullanıcı bazında saklanır ve kademeli çizilen uzun CP tablolarında sonradan eklenen satırlara da uygulanır.', en: 'Clicking the Picture header cycles between Small, Medium and Large views. The size preference is stored per user and also applies to rows appended later in progressively rendered long CP tables.' },
      { tr: 'CP kopyalama işlemi görselleri HTML panosuna gerçek resim olarak ekler. Standart CP Excel ve Export with Approvals çıktıları görselleri hücreye bağlı, oranı korunmuş resimler olarak dışarı aktarır.', en: 'CP copy embeds images as real pictures in the HTML clipboard. Standard CP Excel and Export with Approvals outputs export images as cell-bound pictures while preserving aspect ratio.' },
      { tr: 'Görsel alanı CP sütun yönetimine dahildir; gizlenirse ekranda, kopyalamada ve Excel çıktısında yer almaz. CP görüntüleme yetkisi olmayan kullanıcılar görsel uç noktalarına erişemez.', en: 'The Picture field participates in CP column management; when hidden it is omitted from the screen, copy and Excel outputs. Users without CP access cannot use the image endpoints.' }
    ]
  },
  {
    v: '4.56', date: '2026-08-04',
    title: { tr: 'Koleksiyon revizyonlarında kalıcı Pricing History kimliği', en: 'Persistent Pricing History identity across Collection revisions' },
    items: [
      { tr: 'Pricing History artık Koleksiyon modelini değiştirilebilir PLM ID ve Model Adı alanlarıyla değil, quotation kaydında saklanan değişmez Koleksiyon satır kimliğiyle eşleştirir.', en: 'Pricing History now matches a Collection model through the immutable Collection row identity stored in the quotation record instead of mutable PLM ID and Model Name fields.' },
      { tr: 'Model kartında Model Adı, PLM ID, Category, Season, In Store Month, adet veya diğer bilgiler güncellendiğinde geçmiş fiyatlar aynı model altında görünmeye devam eder.', en: 'Historical prices remain visible under the same model when Model Name, PLM ID, Category, Season, In Store Month, quantity or other model-card details are revised.' },
      { tr: 'Fiyat geçmişindeki model başlığı ve güncel model metadatası mevcut Koleksiyon kartından alınırken fiyat, üretici, hedef, onay ve kayıt tarihi quotation geçmişindeki tarihsel değerlerini korur.', en: 'The model heading and current metadata in Pricing History come from the current Collection card, while price, manufacturer, target, approval and record date retain their historical quotation values.' },
      { tr: 'Duplicate Model yeni bir satır kimliği aldığı için kaynak modelin Pricing History kayıtlarını devralmaz. Satır kimliği bulunmayan çok eski quotation kayıtlarında PLM ID + Model Adı geriye uyumluluğu korunur.', en: 'Duplicate Model receives a new row identity and therefore does not inherit the source model\'s Pricing History. PLM ID + Model Name fallback remains available for very old quotation records that do not contain a row identity.' }
    ]
  },
  {
    v: '4.55', date: '2026-08-04',
    title: { tr: 'Pricing History Category ve kaynak geçmişi sınırı', en: 'Pricing History Category and source-history limit' },
    items: [
      { tr: 'Pricing History tablosuna Category sütunu eklendi. Category bilgisi Koleksiyon veya CP model kartından, gerektiğinde fiyatlama kaydından alınır; üretici bazlı ve fiyat sırası görünümlerinde gösterilir.', en: 'A Category column was added to Pricing History. Category is read from the Collection or CP model card, with the pricing record as fallback, and is shown in both manufacturer and price-order views.' },
      { tr: 'Category, Pricing History aramasına ve sütun sıralamasına dahil edildi. Her iki Pricing History Excel görünümü de Category sütununu Model Name öncesinde dışarı aktarır.', en: 'Category is included in Pricing History search and column sorting. Both Pricing History Excel views export Category before Model Name.' },
      { tr: 'ASAS & ANTREPO Geçmişi yalnız en yeni 10 yenileme kaydını saklar. On birinci kayıt oluştuğunda en eski kayıt kalıcı depodan otomatik silinir; mevcut uzun geçmişler ilk okumada son 10 kayda daraltılır.', en: 'ASAS & ANTREPO History now retains only the latest 10 refresh records. When an eleventh record is created, the oldest one is permanently removed; existing longer histories are trimmed to the latest 10 on first read.' },
      { tr: 'ASAS & ANTREPO Geçmişi penceresine Tümünü Sil düğmesi eklendi. İşlem açık bir onaydan sonra bütün geçmiş kayıtlarını kalıcı olarak temizler ve revizyon çakışmalarına karşı korunur.', en: 'A Delete All button was added to the ASAS & ANTREPO History window. After explicit confirmation it permanently clears all history records and remains protected against revision conflicts.' }
    ]
  },
  {
    v: '4.54', date: '2026-08-04',
    title: { tr: 'Open Costing akışkan genişlik ve taşma önleme', en: 'Open Costing fluid width and overflow prevention' },
    items: [
      { tr: 'Open Costing ekranındaki eski yüzde 66,67 sabit genişlik kuralı kaldırıldı. Araç çubuğu ve çalışma alanı kullanılabilir pencere genişliğini akışkan biçimde kullanır ve 1600 px güvenli üst sınıra sahiptir.', en: 'The old fixed 66.67% width rule was removed from Open Costing. The toolbar and workspace now use the available window width fluidly with a safe 1600 px maximum.' },
      { tr: 'Tarayıcı penceresi daraltıldığında kayıt listesi, model bilgi formu, maliyet özeti ve maliyet tabloları kademeli olarak yeniden yerleşir; metinler ve giriş alanları birbirinin üzerine binmez.', en: 'When the browser window is narrowed, the record list, style information form, cost summary and cost tables progressively reflow without text or controls overlapping.' },
      { tr: 'Maliyet tablosu okunabilir asgari genişliğinin altına sıkıştırılmaz. Dar alanda yalnız tablo kapsayıcısında yatay kaydırma oluşur; sayfanın tamamında yatay taşma meydana gelmez.', en: 'The costing table is no longer compressed below its readable minimum width. In narrow spaces only the table wrapper scrolls horizontally, without causing page-level horizontal overflow.' },
      { tr: 'Maliyet kalemi, açıklama, birim, tüketim, birim fiyat, döviz, fire, toplam ve silme sütunları sabit ve sürdürülebilir sınıf tabanlı genişliklere geçirildi.', en: 'Cost item, description, unit, usage, unit price, currency, waste, total and delete columns now use stable class-based widths.' },
      { tr: 'Bölüm başlıkları, toplamlar, uzun açıklamalar, özet satırları ve araç çubuğu düğmeleri dar pencerelerde güvenli biçimde sarılır veya gerektiğinde alt satıra geçer.', en: 'Section headings, totals, long descriptions, summary rows and toolbar buttons wrap or move to the next line safely in narrow windows.' }
    ]
  },
  {
    v: '4.53', date: '2026-08-04',
    title: { tr: 'Open Costing etkileşim ve geç yükleme düzeltmesi', en: 'Open Costing interaction and lazy-load fix' },
    items: [
      { tr: 'Open Costing modülü sayfa açıldıktan sonra performans amacıyla yüklendiğinde DOMContentLoaded olayı daha önce tamamlandığı için buton ve liste olayları bağlanmıyordu. Başlatma akışı aktif DOM durumunu kontrol edecek şekilde düzeltildi.', en: 'When Open Costing was loaded on demand after the page had opened, DOMContentLoaded had already completed and button/list handlers were not attached. Initialisation now checks the current DOM state.' },
      { tr: 'Yeni Maliyet, Çoğalt, Sil, Karşılaştır, Kur Güncelle, İçeri Aktar, Dışarı Aktar ve Kaydet kontrolleri yeniden kullanılabilir hâle getirildi.', en: 'New Costing, Duplicate, Delete, Compare, Update FX, Import, Export and Save controls are usable again.' },
      { tr: 'Kayıt listesinden ön maliyet seçme, editör alanlarına giriş yapma ve maliyet satırı ekleme/silme olayları yeniden bağlandı.', en: 'Selecting saved costings, editing fields, and adding or deleting cost lines are bound again.' },
      { tr: 'Olay bağlama işlemi idempotent hâle getirildi; modül birden fazla kez başlatılsa dahi aynı kontrol için mükerrer olay dinleyicisi oluşmuyor.', en: 'Event binding is now idempotent, preventing duplicate listeners even if the module is initialised more than once.' }
    ]
  },
  {
    v: '4.52', date: '2026-08-04',
    title: { tr: 'Koleksiyon model kartı ve Style Management Excel akışı', en: 'Collection model card and Style Management Excel workflow' },
    items: [
      { tr: 'Duplicate Model işlemi artık yalnız model kartı ve operasyonel girişleri çoğaltır. Fiyat teklifleri, fiyatlamaya gönderim geçmişi, onaylı üretici, onaylı fiyat ve bunlardan hesaplanan FOB yeni modele aktarılmaz.', en: 'Duplicate Model now copies only the model card and operational inputs. Price quotations, pricing-send history, approved manufacturer, approved price and the FOB calculated from them are not transferred to the new model.' },
      { tr: 'Add New Model düğmesi doğrudan boş satır açmak yerine kapsamlı bir model kartı penceresi açar. MAG, MMYG ve Buyer kullanıcı profilinden otomatik gelir ancak diğer manuel alanlarla birlikte düzenlenebilir.', en: 'Add New Model now opens a complete model-card dialog instead of inserting an empty row directly. MAG, MMYG and Buyer are prefilled from the user profile but remain editable together with the other manual fields.' },
      { tr: 'Export Excel for Style Management düğmesi eklendi. Oluşturulan dosya yalnız düzenlenebilir Koleksiyon alanlarını içerir; görsel, teklif geçmişi, onaylı fiyat/üretici ve hesaplanan alanlar dışarı aktarılmaz.', en: 'An Export Excel for Style Management button has been added. The workbook contains only editable Collection fields; images, quotation history, approved price/manufacturer and calculated fields are excluded.' },
      { tr: 'Style Management Excel dosyası mevcut Import Excel düğmesiyle geri alınabilir. Yeni satırlar Koleksiyona model olarak eklenir; mevcut modellerdeki değişiklikler model bazında mevcut ve yeni değerleri gösteren onay penceresinden sonra uygulanır.', en: 'A Style Management workbook can be imported through the existing Import Excel button. New rows are added as Collection models, while changes to existing models are applied only after a model-by-model confirmation dialog shows current and incoming values.' },
      { tr: 'Mevcut modeller görünmez satır kimliğiyle takip edildiği için PLM ID veya Model Name Excelde değiştirildiğinde de doğru kayıt güncellenir. Excel içe aktarımı görsellere hiçbir koşulda dokunmaz.', en: 'Existing models are tracked with an embedded row identity, allowing the correct record to be updated even when PLM ID or Model Name changes in Excel. Excel import never modifies images.' },
      { tr: 'Overseas Landed ve TR Landed sütunları varsayılan, kaydedilmiş ve sürükle-bırak sütun düzenlerinde her zaman Koleksiyon tablosunun en sağında tutulur.', en: 'Overseas Landed and TR Landed are always kept at the far right of the Collection table in default, saved and drag-and-drop column layouts.' }
    ]
  },
  {
    v: '4.51', date: '2026-08-04',
    title: { tr: 'CP Remaining ve Eksik Yükleme lojistik statüsü', en: 'CP Remaining and Shortage logistics status' },
    items: [
      { tr: 'CP Remaining hücresi artık ASAS Net Alım Sipariş Miktarı eksi aynı siparişe eşleşen bütün Antrepo parsiyellerinin Yükleme Toplam Adet toplamıdır. ASAS Kalan Alım Sipariş Miktarı bu hücrenin hesabında kullanılmaz.', en: 'The CP Remaining cell is now ASAS Net Purchase Order Quantity minus the sum of Loading Total Quantity across all matched Antrepo partials. ASAS Remaining Purchase Order Quantity is not used for this cell.' },
      { tr: 'Kalan fark sipariş toplamının yüzde 5ine eşit veya büyükse sentetik lojistik satırı oluşturulur. Fark yüzde 5 ile yüzde 10 arasında veya tam yüzde 10 ise durum Eksik Yükleme; yüzde 10dan büyükse Üretimde olur.', en: 'A synthetic logistics row is created when the remainder is at least five percent of the order total. A remainder from five through ten percent, including exactly ten percent, is Shortage; a remainder above ten percent is In Production.' },
      { tr: 'Eksik Yükleme üretim statüsü sayılmaz. CP İngilizce görünümünde Shortage, Türkçe görünümünde Eksik Yükleme yazılır; onay ve üretimde sipariş kapsamlarına dahil edilmez.', en: 'Shortage is not treated as a production status. CP displays Shortage in English and Eksik Yükleme in Turkish, and it is excluded from approval and in-production order scopes.' },
      { tr: 'Eksik Yükleme satırının Priority ve tahmini antrepo hesabı ASAS Ex-Factory tarihi ve mevcut yol süresi kurallarını kullanır. Backlog Excel formülleri de aynı Ex-Factory bazlı mantığı korur.', en: 'Priority and estimated warehouse arrival for a Shortage row use the ASAS Ex-Factory date and the current transit-time rules. Backlog Excel formulas preserve the same Ex-Factory-based logic.' },
      { tr: 'Backlog Excel raporunda Eksik Yükleme satırının miktarı Adet sütununda gösterilir; bu satır üretimde miktarı veya gelen miktar olarak sayılmaz.', en: 'In the Backlog Excel report, a Shortage row quantity is shown in the Quantity column and is not counted as an in-production or received quantity.' }
    ]
  },
  {
    v: '4.50', date: '2026-08-04',
    title: { tr: 'ASAS sipariş toplamı, parsiyel Adet sütunu ve yüzde 5 dahil üretim bakiyesi', en: 'ASAS order total, partial Quantity column and inclusive five-percent production balance' },
    items: [
      { tr: 'Varsayılan ASAS–Antrepo eşleşmesi Sipariş Kod + Model Adı/Ürün Ad + Renk Kod üçlüsüne sıfırlandı. Üç koşul birlikte ve birebir eşleşmeden hiçbir Antrepo parsiyeli siparişe bağlanmaz.', en: 'The default ASAS–Antrepo match has been reset to Order Code + Model Name/Product Name + Colour Code. No Antrepo partial is linked unless all three conditions match exactly together.' },
      { tr: 'Net Alım Sipariş Miktarı artık her zaman yalnız ASAS kaynağından alınır ve aynı siparişin bütün Backlog satırlarında tam sipariş miktarı olarak sabit kalır. Antrepo içindeki aynı adlı alan kullanılmaz.', en: 'Net Purchase Order Quantity now always comes exclusively from ASAS and remains the full constant order quantity on every Backlog row for that order. The similarly named Antrepo field is not used.' },
      { tr: 'Backlog Excel raporunda Net Alım Sipariş Miktarının hemen sağına Adet sütunu eklendi. Her gerçek parsiyelde Antrepo Yükleme Toplam Adet, sentetik Üretimde satırında ise ASAS toplamı eksi bütün parsiyellerin toplamı gösterilir.', en: 'A Quantity column has been added immediately to the right of Net Purchase Order Quantity in the Backlog Excel report. It shows Antrepo Loading Total Quantity for each real partial and ASAS total minus all partial totals for a synthetic In Production row.' },
      { tr: 'Üretim bakiyesi Net Alım Sipariş Miktarının yüzde 5ine eşit veya daha büyükse ayrı Üretimde satırı oluşturulur. Yalnız yüzde 5in altındaki küçük fark için satır oluşturulmaz.', en: 'A separate In Production row is created when the production balance is equal to or greater than five percent of Net Purchase Order Quantity. Only differences below five percent are ignored.' },
      { tr: 'Antrepo Excelde birbirinin tamamen aynısı olan satırlar dahi kaynak satır kimliğiyle ayrı parsiyel olarak korunur. Worker üzerinden kaybolan parser meta bilgisi geri iliştirildiği için hatalı satır granülü uyarısı artık gerçek satır kaybı olmadan oluşmaz.', en: 'Even completely identical rows in Antrepo Excel are preserved as separate partials using their source-row identity. Parser metadata lost across the worker boundary is reattached, preventing false row-grain integrity errors when no row was actually lost.' },
      { tr: 'Mevcut kurulumlarda kalmış eski özel eşleştirme ayarı ilk açılışta bir kez varsayılan üçlüye taşınır; kullanıcı daha sonra Matching Rule ekranından kuralları yeniden düzenleyebilir.', en: 'Any legacy custom matching configuration is migrated once to the default triple on first launch; users can edit the rules again later from the Matching Rule screen.' }
    ]
  },
  {
    v: '4.49', date: '2026-08-04',
    title: { tr: 'Backlog parsiyel bakiyesi ve kayıpsız sipariş miktarı', en: 'Backlog partial balance and lossless order quantity' },
    items: [
      { tr: 'Eşleşen IAS parsiyellerinin Yükleme Toplam Adet toplamı sipariş toplamından çıkarılır. Kalan miktar sipariş toplamının yüzde 5ini aşıyorsa, bu miktar için ayrı bir Üretimde satırı oluşturulur.', en: 'The sum of Loading Total Quantity across matched IAS partials is subtracted from the order total. When the remainder exceeds five percent of the order total, a separate In Production row is created for that quantity.' },
      { tr: 'Kalan miktar tam yüzde 5 veya daha azsa Üretimde satırı oluşturulmaz. Yüzde 5 eşiği yalnız küçük üretim bakiyesini görmezden gelmek için kullanılır; parsiyel statülerini değiştirmez.', en: 'No In Production row is created when the remainder is exactly five percent or less. The five-percent threshold is used only to ignore small production balances and does not alter partial-shipment statuses.' },
      { tr: 'Backlog Exceldeki Net Alım Sipariş Miktarı satırları artık parsiyel miktarları ile varsa Üretimde bakiyesinin toplamıdır; böylece sipariş adedi raporda kaybolmaz.', en: 'Net Purchase Order Quantity rows in the Backlog Excel report now consist of the partial quantities plus any In Production balance, preventing order quantity loss in the report.' },
      { tr: 'Antrepo kaynağında Net Alım Sipariş Miktarı alanı bulunuyorsa sipariş toplamı bu değerden alınır. Mevcut eski Antrepo Excel formatında bu sütun yoksa ASAS Net Alım Sipariş Miktarı kullanılır; Yükleme Toplam Adet hiçbir zaman sipariş toplamı olarak kabul edilmez.', en: 'When the Antrepo source contains Net Purchase Order Quantity, that value is used as the order total. If the column is absent in the existing legacy Antrepo Excel format, ASAS Net Purchase Order Quantity is used; Loading Total Quantity is never treated as the order total.' },
      { tr: 'Aynı siparişin parsiyellerinde farklı Net Alım Sipariş Miktarı değerleri bulunursa uygulama bir değer tahmin etmez ve yanlış Backlog üretmek yerine yenilemeyi durdurur.', en: 'If partials of the same order contain different Net Purchase Order Quantity values, the application does not guess a value and stops refresh instead of producing an incorrect Backlog.' },
      { tr: 'Aynı bakiye mantığı CP Logistic ayrıntılarına da uygulanır; Üretimde bakiyesi ilk öncelikte, ardından depo öncesi parsiyeller ve depo parsiyelleri gösterilir.', en: 'The same balance logic is applied to CP Logistics details: the In Production balance is shown first, followed by pre-warehouse partials and warehouse partials.' }
    ]
  },
  {
    v: '4.48', date: '2026-08-03',
    title: { tr: 'Merkez sevke hazır depo için yüzde 5 retail aktarım kuralı', en: 'Five-percent retail-transfer rule for ready-depot balance' },
    items: [
      { tr: 'IAS statüsü Depoda olan bir siparişte, ASAS database Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo değeri Net Alım Sipariş Miktarının yüzde 5inden büyükse statü Retaile Aktarım Bekleniyor olarak gösterilir.', en: 'For an order whose IAS status is In Warehouse, the status is shown as Waiting for Retail Transfer when the ASAS database Remaining Purchase Order Quantity_Ready for Central Shipment value is greater than five percent of the Net Purchase Order Quantity.' },
      { tr: 'Eşik tam yüzde 5 ise Depoda statüsü korunur; yalnız yüzde 5in üzerindeki değerler dönüşür.', en: 'At exactly five percent, the In Warehouse status is preserved; only values above five percent are converted.' },
      { tr: 'Kural CP Logistic, Backlog ekranı ve Backlog Excel raporunda birlikte uygulanır. IAS kaydı bulunan siparişler için sentetik Üretimde satırı oluşturulmaz.', en: 'The rule is applied consistently in CP Logistics, the Backlog page and the Backlog Excel report. No synthetic In Production row is created for orders with an IAS record.' }
    ]
  },
  {
    v: '4.47', date: '2026-08-03',
    title: { tr: 'Yüzde 5 üretim statüsü kuralı kaldırıldı', en: 'Five-percent production-status rule removed' },
    items: [
      { tr: 'Sipariş için en az bir birebir eşleşen IAS parsiyeli bulunduğunda, ASAS toplamı ile IAS yükleme toplamı arasındaki fark artık yüzde 5 eşiğine göre sentetik Üretimde satırı oluşturmaz.', en: 'When an order has at least one exactly matched IAS partial shipment, the difference between the ASAS total and IAS loaded total no longer creates a synthetic In Production row based on a five-percent threshold.' },
      { tr: 'IAS parsiyeli bulunan siparişlerin lojistik durumu yalnız gerçek IAS satırlarından gelir. Sipariş ancak IAS tarafında hiç eşleşen kayıt yoksa tamamı Üretimde kabul edilir.', en: 'For orders with IAS partials, logistics status now comes only from real IAS rows. The whole order is treated as In Production only when there is no matching IAS record at all.' },
      { tr: 'Değişiklik CP Logistic, Backlog ekranı ve Backlog Excel raporuna birlikte uygulandı.', en: 'The change is applied consistently to CP Logistics, the Backlog page and the Backlog Excel report.' }
    ]
  },
  {
    v: '4.46', date: '2026-08-03',
    title: { tr: 'Kalan miktara bağlı lojistik statü dönüşümü kaldırıldı', en: 'Remaining-quantity logistics status conversion removed' },
    items: [
      { tr: 'ASAS Kalan Alım Sipariş Miktarının sipariş toplamının %5’inden fazla olması artık IAS’tan gelen Depoda statüsünü Retaile Aktarım Bekleniyor statüsüne dönüştürmez.', en: 'ASAS Remaining Purchase Order Quantity exceeding 5% of the order total no longer converts an IAS In Warehouse status into Awaiting Retail Transfer.' },
      { tr: 'CP Logistic, Backlog ekranı ve Backlog Excel raporu parsiyel statüsünü IAS kaynağında geldiği biçimde korur. Retaile Aktarım Bekleniyor yalnız IAS verisinde açıkça bu statü bulunuyorsa gösterilir.', en: 'CP Logistics, the Backlog page and the Backlog Excel report preserve each partial status exactly as supplied by IAS. Awaiting Retail Transfer is shown only when IAS explicitly provides that status.' },
      { tr: 'Üretimde kalan adet hesabı ve %5 veya altındaki küçük yükleme farklarını üretim bakiyesi saymama kuralı değiştirilmedi.', en: 'The production remainder calculation and the rule that ignores loading differences of 5% or less as production remainder remain unchanged.' }
    ]
  },
  {
    v: '4.45', date: '2026-08-03',
    title: { tr: 'Antrepo Excel kaynağı, üçlü eşleştirme ve hızlı kaynak ayarları', en: 'Antrepo Excel source, triple matching and faster source settings' },
    items: [
      { tr: 'Antrepo ana kaynağı yeniden kaynak klasöründeki en güncel Antrepo Excel dosyası yapıldı. Database seçeneği kaldırılmadı; yalnız kullanıcı özellikle seçtiğinde IAS Data Model bağlantısı sorgulanır.', en: 'The primary Antrepo source is once again the latest Antrepo Excel workbook in the selected source folder. The Database option remains available and queries the IAS Data Model connection only when explicitly selected.' },
      { tr: 'Varsayılan ASAS–IAS eşleştirmesi Sipariş Kod + Model Adı/Ürün Ad + Renk Kod üçlüsüdür. Üç alan AND ile birlikte değerlendirilir; model ve renk kodunda yaklaşık, kademeli veya yedek eşleştirme yapılmaz.', en: 'The default ASAS–IAS match is Order Code + Model Name/Product Name + Colour Code. All three fields are joined with AND; no approximate, stepwise or fallback matching is used for model or colour code.' },
      { tr: 'Sipariş Kodunun Excel ve Data Model katmanlarında sayı, metin veya .00 biçiminde gelmesi aynı iş kodu olarak ele alınır. Bu yalnız sayısal gösterim farkını giderir; alfasayısal kodlar, model adı ve renk kodu birebir kalır.', en: 'Order Codes returned as a number, text or with a .00 suffix by Excel and the Data Model are treated as the same business code. This only resolves numeric representation differences; alphanumeric codes, model names and colour codes remain exact.' },
      { tr: 'Eski Database tabanlı Antrepo snapshotı Excel modunda açılışta kullanılmaz. Program en güncel Antrepo Excel dosyasını okuyup CP ve Backlog önbelleğine uygular; dosya yoksa eski ve farklı kaynaktan gelen IAS verisini sessizce kullanmaz.', en: 'An old Database-based Antrepo snapshot is not reused when Excel mode is active. The application reads the latest Antrepo workbook into the CP and Backlog cache; when the file is missing, it does not silently reuse IAS data from a different source.' },
      { tr: 'Source, ASAS–IAS Matching Rule ve Data Model Connection pencereleri açılırken tam model şeması artık otomatik taranmaz. Şema yalnız alan seçileceğinde yüklenir; metadata 10 dakika, filtre değerleri 5 dakika önbelleğe alınır ve eşzamanlı istekler birleştirilir.', en: 'The full model schema is no longer scanned automatically when opening Source, ASAS–IAS Matching Rule or Data Model Connection. Schema is loaded only when a field is selected; metadata is cached for 10 minutes, filter values for 5 minutes, and concurrent requests are deduplicated.' },
      { tr: 'Antrepo Excel yükleme işlemi atomik hâle getirildi: dosya önce geçici konumda gerçek parser ile doğrulanır, yalnız başarılıysa kaynak dosyanın yerine alınır ve CP ile Backlog aynı parsiyel haritasıyla hemen güncellenir.', en: 'Antrepo Excel upload is now atomic: the workbook is validated with the real parser in a temporary location, replaces the source file only when valid, and immediately updates CP and Backlog with the same partial-shipment map.' }
    ]
  },
  {
    v: '4.44', date: '2026-08-03',
    title: { tr: 'IAS fact satırı sorgusu ve Backlog veri bütünlüğü', en: 'IAS fact-row query and Backlog data integrity' },
    items: [
      { tr: 'IAS otomatik sorgusu SUMMARIZECOLUMNS gruplamasından çıkarıldı. Sorgu artık İthalat Dosya No alanının bağlı olduğu gerçek IAS fact tablosundan başlar ve SELECTCOLUMNS ile her kaynak satırını bağımsız parsiyel olarak korur.', en: 'The automatic IAS query no longer uses SUMMARIZECOLUMNS grouping. It now starts from the real IAS fact table bound to Import File Number and preserves every source row as an independent partial shipment through SELECTCOLUMNS.' },
      { tr: 'Yükleme Toplam Adet ve diğer ölçüler her fact satırının kendi bağlamında hesaplanır. İlişkili tablolardaki Sipariş Kod, Ürün Ad ve Renk Kod gibi alanlar yalnız tek bir kesin değer varsa alınır; belirsiz ilişkilerde ilk, yakın veya tahmini değer seçilmez.', en: 'Loading Total Quantity and other measures are evaluated in the context of each fact row. Related-table fields such as Order Code, Product Name and Colour Code are returned only when there is one exact value; no first, nearest or estimated value is chosen for ambiguous relationships.' },
      { tr: 'Field Mapping’e İthalat Dosya No zorunlu IAS satır-tablosu alanı olarak eklendi; Konteyner No ve operasyon ayrıntıları da otomatik eşlenir. IAS alanlarında aynı adlı sütun ve ölçü birlikte varsa satır granülünü korumak için gerçek sütun tercih edilir.', en: 'Import File Number is added to Field Mapping as the required IAS row-table field, while Container Number and operational details are also auto-mapped. When an IAS column and measure share a name, the real column is preferred to preserve row grain.' },
      { tr: 'Aynı İthalat Dosya No veya Konteyner No altında birden fazla parsiyel bulunması artık tekrar veya çelişki kabul edilmez. Modelden dönen her satır tek başına tutulur; parsiyeller tekilleştirilmez, birleştirilmez ve farklı satırlardan alan tamamlanmaz.', en: 'Multiple partial shipments under the same Import File Number or Container Number are no longer treated as duplicates or conflicts. Every returned model row is retained independently; partials are not deduplicated, merged or completed with fields from another row.' },
      { tr: 'Veri bütünlüğü kontrolleri tahmini oranlardan arındırıldı. Zorunlu IAS sütunları veya Yükleme Toplam Adet eksikse yanlış rapor üretmek yerine yenileme durur; IAS toplamının ASAS miktarını aşması ise gerçek fazla yükleme olabileceğinden satır silme ya da birleştirme nedeni sayılmaz.', en: 'Integrity checks no longer use estimated ratios. Refresh stops instead of producing an incorrect report when required IAS columns or Loading Total Quantity are missing; an IAS total exceeding ASAS quantity does not trigger row deletion or merging because it may represent a real over-shipment.' }
    ]
  },
  {
    v: '4.43', date: '2026-08-03',
    title: { tr: 'CP Logistic parsiyel görünümü ve operasyon öncelikleri', en: 'CP Logistics partial-shipment view and operation priorities' },
    items: [
      { tr: 'CP ana tablosunda Sipariş Kod + Model Adı + Renk Kod kimliği tek satır olarak korunur. Logistic durumundaki ok açıldığında, IAS parsiyelleri ile ASAS toplamından hesaplanan üretim bakiyesi ana satırın altında ayrıntılı olarak gösterilir.', en: 'The Order Code + Model Name + Colour Code identity remains a single row in the main CP table. Expanding the Logistics indicator shows every IAS partial shipment and the production remainder calculated from the ASAS total beneath the parent row.' },
      { tr: 'Lojistik ayrıntıları zorunlu iş önceliğiyle sıralanır: 1) Üretimde kalan miktar ve Ex-Factory bazlı antrepo tarihi, 2) üretimi tamamlanmış fakat depoya ulaşmamış parsiyeller, 3) Depoda veya Retaile Aktarım Bekleniyor parsiyelleri.', en: 'Logistics details follow the required business priority: 1) quantity still in production and its Ex-Factory-based warehouse ETA, 2) production-complete partials not yet at the warehouse, and 3) In Warehouse or Awaiting Retail Transfer partials.' },
      { tr: 'Her IAS parsiyeli adet, statü, tahmini antrepo tarihi, vasıta ve handover bilgileriyle ayrı tutulur; aynı statüde olsalar bile parsiyeller birleştirilmez. Üretim bakiyesi ayrıca hesaplanmış bir satırdır.', en: 'Each IAS partial remains separate with its own quantity, status, estimated warehouse arrival, vehicle and handover values; partials are not merged even when they share a status. The production remainder is a separate calculated line.' },
      { tr: 'Ana CP satırındaki Logistic özetinde bütün operasyon durumları miktarlarıyla görünür. Ana STATUS, Ant. Arrival ve Del. Type değerleri mevcut en yüksek öncelikli lojistik ayrıntıdan alınır.', en: 'The Logistics summary on the main CP row displays all operational statuses with quantities. Main STATUS, Ant. Arrival and Del. Type values come from the currently highest-priority logistics detail.' },
      { tr: 'STATUS, Ant. Arrival ve Del. Type filtreleri yalnız ana özeti değil siparişin bütün parsiyellerini değerlendirir. Açılan parsiyel detayları CP seçimine ve sipariş bazlı toplu işlemlere ayrı satır olarak katılmaz.', en: 'STATUS, Ant. Arrival and Del. Type filters evaluate every partial of the order rather than only the main summary. Expanded partial details do not become separate CP selections or duplicate order-level bulk actions.' }
    ]
  },
  {
    v: '4.42', date: '2026-08-03',
    title: { tr: 'Backlog ASAS–IAS parsiyel mantığı sıfırdan kuruldu', en: 'Backlog ASAS–IAS partial-shipment logic rebuilt from scratch' },
    items: [
      { tr: 'Backlog veri işleme mantığı eski durum birleştirme ve sipariş özeti kurallarından ayrıldı. Sayfa, filtreler ve Excel rapor biçimi korunurken ASAS ile IAS verisinin işlenmesi yeni bir operasyon satırı modeliyle baştan kuruldu.', en: 'Backlog data processing has been separated from the previous status-merging and order-summary rules. The page, filters and Excel report format are retained while ASAS and IAS processing is rebuilt around a new operational-row model.' },
      { tr: 'Varsayılan eşleştirme ASAS Sipariş Kod + Model Adı + Renk Kod ile IAS Sipariş Kod + Ürün Ad + Renk Kod alanlarının birlikte birebir eşleşmesidir. Uygulama içinden değiştirilen ek koşulların tamamı da AND mantığıyla karakter karakter eşleşmek zorundadır.', en: 'The default match requires ASAS Order Code + Model Name + Colour Code to equal IAS Order Code + Product Name + Colour Code together. Every custom condition configured in the application is also joined with AND and must match character for character.' },
      { tr: 'Aynı siparişe ait her IAS satırı bağımsız parsiyel olarak korunur. Parsiyel miktarı IAS Yükleme Toplam Adet alanından alınır; statü, antrepo tarihi, vasıta ve handover bilgileri yalnız kendi IAS satırından gelir ve farklı satırların alanları birleştirilmez.', en: 'Every IAS row belonging to the same order is retained as an independent partial shipment. Its quantity comes from IAS Loading Total Quantity; status, bonded-warehouse date, vehicle and handover data come only from that same IAS row, with no field merging across rows.' },
      { tr: 'Üretimde kalan miktar, ASAS Net Alım Sipariş Miktarı eksi tüm eşleşen IAS parsiyellerinin Yükleme Toplam Adet toplamıdır. Kalan miktar toplam siparişin %5’inden büyükse ayrıca Üretimde satırı oluşturulur; IAS kaydı yoksa siparişin tamamı Üretimde kabul edilir.', en: 'The production remainder is ASAS Net Purchase Order Quantity minus the sum of Loading Total Quantity across all matching IAS partials. A separate In Production row is created when the remainder exceeds 5% of the order total; if IAS has no matching row, the whole order is treated as In Production.' },
      { tr: 'Herhangi bir parsiyel Depoda iken ASAS Kalan Alım Sipariş Miktarı toplam siparişin %5’inden fazlaysa o Depoda parsiyeli Retaile Aktarım Bekleniyor olarak raporlanır.', en: 'When a partial is In Warehouse while ASAS Remaining Purchase Order Quantity exceeds 5% of the order total, that warehouse partial is reported as Awaiting Retail Transfer.' },
      { tr: 'Üretimde satırlarının tahmini antrepo tarihi, Ex-Factory tarihi ile ülke ve yükleme tipine uygun mevcut yol süresi kurallarından hesaplanır. CP Logistic çalışma düzeni bu sürümde değiştirilmedi.', en: 'Estimated bonded-warehouse arrival for production rows is calculated from Ex-Factory using the existing transit-time rule matching country and delivery type. CP Logistics behaviour is unchanged in this release.' }
    ]
  },
  {
    v: '4.41', date: '2026-08-03',
    title: { tr: 'Field Mapping seçim paneli modalın önünde', en: 'Field Mapping picker above the modal' },
    items: [
      { tr: 'Data Source and Filters içindeki Field Mapping açılır seçim paneli artık modalın blur ve karartma katmanının arkasında kalmaz; ekranın en önünde açılır ve seçenekler tıklanabilir.', en: 'The Field Mapping picker in Data Source and Filters no longer remains behind the modal blur and dimming layer; it opens at the front and its options are clickable.' },
      { tr: 'Ortak filtre bileşeni modal içinden çağrıldığını otomatik algılar. Böylece aynı bileşeni kullanan diğer modal içi arama ve seçim panelleri de doğru katmanda gösterilir.', en: 'The shared filter component now automatically detects when it is opened from a modal, so other modal-based search and selection panels using the same component also appear on the correct layer.' }
    ]
  },
  {
    v: '4.40', date: '2026-08-03',
    title: { tr: 'IAS tekrarlarında tek satır bütünlüğü', en: 'Single-row integrity for duplicate IAS matches' },
    items: [
      { tr: 'Aynı ASAS - IAS eşleştirme anahtarına birden fazla IAS satırı düştüğünde yalnız Tahmini Antrepo Giriş Tarihi en yeni olan satır seçilir.', en: 'When multiple IAS rows share the same ASAS - IAS matching key, only the row with the latest estimated bonded-warehouse arrival date is selected.' },
      { tr: 'Seçilen IAS satırının statü, araç tipi, handover tarihi ve diğer tüm alanları tek parça hâlinde kullanılır; farklı satırlardan alan tamamlama veya veri birleştirme yapılmaz.', en: 'The selected IAS row is used as one intact record for status, vehicle type, handover date and every other field; values are never filled or merged from other rows.' },
      { tr: 'Tahmini Antrepo Giriş Tarihleri eşitse kaynak sonuçta daha sonra gelen IAS satırı, yine bütünüyle, seçilir.', en: 'If estimated bonded-warehouse arrival dates are equal, the IAS row appearing later in the source result is selected, again as a complete record.' }
    ]
  },
  {
    v: '4.39', date: '2026-08-03',
    title: { tr: 'Backlog Excel kapsamı ve manuel ASAS - IAS eşleştirme koşulları', en: 'Backlog Excel scope and manual ASAS - IAS matching conditions' },
    items: [
      { tr: 'Backlog Excel raporu artık CP veri kapsamını kullanmaz. Ekrandaki aktif Backlog kapsamı; Retail, Antrepo tarihi, Buyer Grup ve diğer boyut filtreleriyle birlikte rapora birebir uygulanır.', en: 'The Backlog Excel report no longer uses the CP data scope. The active Backlog scope is applied exactly together with Retail, bonded-warehouse date, Buyer Group and all other dimension filters.' },
      { tr: 'ASAS - IAS Eşleştirme Kuralı ekranı satırlarda ASAS ve IAS, sütunlarda Koşul 1, Koşul 2 ve devamı olacak şekilde yenilendi. Kullanıcı tek koşuldan başlayarak istediği sayıda koşul ekleyebilir veya kaldırabilir.', en: 'The ASAS - IAS Matching Rule screen now shows ASAS and IAS as rows and Condition 1, Condition 2 and onward as columns. Users can add or remove any number of conditions starting from one.' },
      { tr: 'Her koşuldaki model sütunu arama yapılarak seçilir. Auto Match, Field Mapping içindeki Sipariş Kod, Model/Ürün Adı, Renk Kod ve Renk/Renk Tanım çiftlerini bulabildiği ölçüde önerir.', en: 'Model columns in each condition are selected through search. Auto Match proposes the Order Code, Model/Product Name, Colour Code and Colour/Colour Description pairs wherever they exist in Field Mapping.' },
      { tr: 'Bütün koşullar AND ile bağlıdır. Seçili alanlardan biri boşsa veya değerler karakter karakter aynı değilse IAS verisi bağlanmaz; yakın, tahmini, kademeli veya yedek eşleştirme yapılmaz.', en: 'All conditions are joined with AND. If any selected field is empty or the values are not character-for-character identical, no IAS data is attached; there is no near, speculative, stepwise or fallback matching.' },
      { tr: 'Kural kaydedildiğinde seçilen model sütunları sorguya eklenir ve CP ile Backlog birlikte yenilenir. Eşleştirme denetimi de aktif manuel koşullara göre sonuç ve uyuşmazlık örnekleri gösterir.', en: 'When the rule is saved, the selected model columns are added to the query and CP and Backlog refresh together. The matching audit also shows results and mismatch samples based on the active manual conditions.' },
      { tr: 'Aynı sipariş kodu, model ve renk kodunu taşıyan fakat ek manuel koşullarla ayrılan satırların statü, antrepo tarihi, yükleme tipi, öncelik ve not bilgileri Backlog Excel içinde birbirine karışmaz.', en: 'Rows sharing the same order code, model and colour code but separated by additional manual conditions no longer mix status, bonded-warehouse date, delivery type, priority or note data in Backlog Excel.' }
    ]
  },
  {
    v: '4.38', date: '2026-08-03',
    title: { tr: 'Kaynak filtresi zorunluluğu ve yenileme geri bildirimi', en: 'Required source filters and clearer refresh feedback' },
    items: [
      { tr: 'Program açılışında CP / Genel Bakış kapsamı için Veri Kaynağı ve Filtreler alanında tamamlanmış bir koşul yoksa kayıtlı snapshot ekrana getirilmez. Kullanıcı doğrudan ilgili ayar penceresine yönlendirilir.', en: 'At startup, if CP / Overview has no complete condition in Data Source and Filters, the saved snapshot is not shown and the user is directed straight to the relevant settings window.' },
      { tr: 'CP, Backlog ve LFL yenilemeleri kendi ASAS kapsamlarında açık bir filtre olmadan çalıştırılamaz. Böylece yanlışlıkla tüm veri modelinin sorgulanması engellenir.', en: 'CP, Backlog and LFL refreshes cannot run without an explicit filter in their own ASAS scope, preventing accidental full-model queries.' },
      { tr: 'Model Ufku rozetindeki Kapsamı düzenle düğmesi artık boş bir sayfaya geçmek yerine Veri Kaynağı ve Filtreler penceresini açar ve ilgili ekranı besleyen bağlantıyı seçer.', en: 'The Edit scope button in the Model Horizon badge now opens Data Source and Filters and selects the connection feeding the relevant page instead of navigating to a blank page.' },
      { tr: 'Yenileme sırasında sağ üst Yenile düğmesi görünür biçimde döner ve kilitlenir. Veri modeli yenileme bildirimindeki sembol, geçen süreyi canlı gösteren sayaçla değiştirildi.', en: 'During refresh, the top-right Refresh button visibly spins and is locked. The symbol in the data-model refresh notice was replaced with a live elapsed-time counter.' },
      { tr: 'Başlangıç ve yenileme metinleri, aktif filtre kapsamı ile veri hacmine göre bekleme süresinin uzayabileceğini açıkça bildirir.', en: 'Startup and refresh messages now clearly state that waiting time may increase with the active filter scope and data volume.' }
    ]
  },
  {
    v: '4.37', date: '2026-08-03',
    title: { tr: 'ASAS ile IAS eşleşmesi kayıpsız ve yalnız birebir üçlü', en: 'ASAS to IAS matching is lossless and strictly three-field only' },
    items: [
      { tr: 'Hücre başı/sonu boşlukları temizlendikten sonra ASAS Sipariş Kod + Model Adı + Renk Kod ile IAS Sipariş Kod + Ürün Adı + Renk Kod alanlarının üçü birlikte birebir aynı değilse eşleşme kurulmaz. Yakın değer, yalnız sipariş kodu, renk tanımı veya başka bir yedek anahtar kullanılmaz.', en: 'After trimming outer cell whitespace, no match is made unless ASAS order code, model name and colour code are exactly identical to IAS order code, product name and colour code together. No near value, order-only, colour-description or other fallback key is used.' },
      { tr: 'Eski kayıtlı order, order+ccode, order+model ve auto kuralları otomatik olarak katı üçlü kurala taşındı; arayüz ve API artık yalnız bu kuralı kabul ediyor.', en: 'Previously saved order, order+ccode, order+model and auto rules are automatically migrated to the strict three-field rule; the UI and API now accept only that rule.' },
      { tr: 'Eşleştirme sırasında büyük/küçük harf, Türkçe karakter, noktalama, baştaki sıfır veya ondalık yazımı dönüştürülmüyor. Örneğin A-001 ile A001, ŞIK ile SIK ve 001 ile 1 farklı kabul edilir.', en: 'Matching no longer transforms case, Turkish characters, punctuation, leading zeros or decimal notation. For example, A-001 differs from A001, ŞIK differs from SIK, and 001 differs from 1.' },
      { tr: 'ASAS satır tekilleştirmesi de aynı üçlü kimliğe geçirildi; aynı sipariş ve renk tanımı altında bulunan farklı model veya renk kodu satırları artık eşleşmeden önce kaybolmuyor.', en: 'ASAS row deduplication now uses the same three-field identity, so different model or colour-code lines under the same order and colour description are no longer lost before matching.' },
      { tr: 'Model Adı/Ürün Adı veya Renk Kod alanı eksik IAS satırları reddediliyor; CP, Backlog ve Backlog Excel içindeki bağlantılar da aynı kayıpsız üçlü anahtarı kullanıyor.', en: 'IAS rows missing model/product name or colour code are rejected, and CP, Backlog and Backlog Excel joins now use the same lossless three-field key.' }
    ]
  },
  {
    v: '4.36', date: '2026-08-03',
    title: { tr: 'Birebir üçlü eşleşme ve eşleştirme denetimi', en: 'Exact three-field matching and a matching audit' },
    items: [
      { tr: 'Varsayılan eşleştirme kuralı Sipariş Kod ile Model Adı ile Renk Kod oldu. Üç alan da birebir tutmuyorsa IAS kaydı bağlanmaz; tahmine dayalı hiçbir eşleşme kurulmaz.', en: 'The default matching rule is now order code with model name and colour code. If all three do not match exactly, the IAS record is not attached and no speculative match is made.' },
      { tr: 'Eşleştirme anahtarı, kullanıcı düzenlemelerinin saklandığı anahtardan ayrıldı ve üç alan ayrı ayrı normalleştiriliyor: renk kodu sayısal geldiğinde baştaki sıfır ve ondalık farkı yok sayılıyor, model adı büyük harf ve Türkçe karakter farkına takılmıyor. Bu bir tahmin değil, aynı değerin farklı yazımının tanınmasıdır; farklı değerler asla birbirine benzetilmiyor.', en: 'The matching key was separated from the key used to store user edits, and each of the three fields is normalised on its own: leading zeros and decimals are ignored for numeric colour codes, and model names are insensitive to case and Turkish characters. This is not guessing but recognition of the same value written differently; different values are never treated as equal.' },
      { tr: 'Kaynak ekranındaki eşleştirme kuralı penceresine "Denetle" düğmesi eklendi. Üç alanın her biri için iki taraftaki değer sayısı, ortak değer sayısı ve yalnız bir tarafta bulunan örnekler gösteriliyor; ortak değeri sıfıra yakın olan alan kırmızı işaretleniyor.', en: 'An Audit button was added to the matching rule window on the Source screen. For each of the three fields it shows how many values each side has, how many are shared and samples that exist on only one side, marking in red any field whose shared count is near zero.' },
      { tr: 'Denetim ayrıca sipariş kodu iki tarafta da bulunan ama satırı eşleşmeyen örnekleri ASAS ve IAS değerleriyle yan yana listeliyor ve tutmayan alanın adını yazıyor.', en: 'The audit also lists cases where the order code exists on both sides but the line does not match, showing the ASAS and IAS values side by side and naming the field that does not match.' }
    ]
  },
  {
    v: '4.35', date: '2026-08-03',
    title: { tr: 'ASAS - IAS eşleştirme kuralı seçilebilir hâle geldi', en: 'The ASAS to IAS matching rule is now selectable' },
    items: [
      { tr: 'Kaynak ekranındaki Ayarlar menüsüne "ASAS - IAS Eşleştirme Kuralı" penceresi eklendi. Bir sipariş satırının IAS kaydıyla eşleştirilmesinde hangi alanların birebir tutması gerektiği buradan seçilir.', en: 'A window called ASAS - IAS Matching Rule was added to the Settings menu on the Source screen. It decides which fields must match exactly when an order line is paired with its IAS record.' },
      { tr: 'Seçenekler: Sipariş Kod ile Model Adı ile Renk Kod, Sipariş Kod ile Renk Kod, Sipariş Kod ile Model Adı, yalnız Sipariş Kod, ve kademeli otomatik. Varsayılan artık Sipariş Kod ile Renk Kod.', en: 'The options are order code with model name and colour code, order code with colour code, order code with model name, order code alone, and stepwise automatic. The default is now order code with colour code.' },
      { tr: 'Kademeli seçenek dışında yedek düzey yoktur: seçilen alanlar tutmazsa eşleşme kurulmaz ve satır Üretimde kalır. Böylece yanlış eşlenmiş bir sütun, yanlış veri üretmek yerine görünür oluyor.', en: 'Apart from the stepwise option there is no fallback level: if the selected fields do not match, no match is made and the line stays in production, so a wrongly mapped column becomes visible instead of producing wrong data.' },
      { tr: 'Seçilen kuralı CP, Sipariş Özeti, Backlog, Backlog detayı ve Backlog Excel raporunun tamamı birlikte kullanıyor. Yenileme bildirimi hangi kuralla çalışıldığını ve kaç satırda birden fazla adaya denk gelindiğini yazıyor.', en: 'The selected rule is used together by CP, the order summary, Backlog, the Backlog detail window and the Backlog Excel report. The refresh notice states which rule was used and how many lines matched more than one candidate.' }
    ]
  },
  {
    v: '4.34', date: '2026-08-03',
    title: { tr: 'IAS tarafındaki model sütunu tanınıyor: Ürün Adı', en: 'The model column on the IAS side is now recognised: Ürün Adı' },
    items: [
      { tr: 'ASAS tarafında Model Adı olan sütun IAS tarafında Ürün Adı olarak geçiyor. Alan kataloğunda bu ad tanınmadığı için otomatik eşleme model alanını hiç bulamıyor, sorgu model adını getirmiyor ve sipariş eşleşmesi üçlü anahtar yerine renk tanımına düşüyordu. Ürün Adı artık Model Adı alanının tanıdığı adlar arasında.', en: 'The column called Model Adı on the ASAS side appears as Ürün Adı on the IAS side. Because that name was unknown to the field catalogue, automatic mapping never found the model field, the query never returned the model name and order matching fell back to colour description instead of the triple key. Ürün Adı is now among the names recognised for the model field.' },
      { tr: 'Aynı takma ad kumaş bağlantısına ve ASAS bağlantısına da eklendi; ham sorgu çıktısı yeniden adlandırılmadan geldiğinde de Ürün Adı sütunu model adı olarak okunuyor.', en: 'The same alias was added to the fabric and ASAS connections, and a raw query result whose column is still named Ürün Adı is now read as the model name too.' },
      { tr: 'Sipariş Kodu, Model Adı ve Renk Kodu alanlarından biri beklenmedik bir sütuna bağlıysa yenileme bildiriminde uyarı çıkıyor. Bu üç alan eşleşmede birebir kullanıldığı için yanlış bağlanmaları hata üretmeden sessizce yanlış veri doğuruyordu.', en: 'A warning now appears in the refresh notice when order code, model name or colour code is bound to an unexpected column. These three fields are used verbatim in matching, so a wrong binding used to produce wrong data silently rather than an error.' },
      { tr: 'Sipariş kodu iki tarafta da bulunup satırı eşleşmeyen örnekler, ASAS ve IAS değerleri yan yana gösteriliyor; alanın boş mu geldiği yoksa başka bir sütuna mı bağlandığı doğrudan görünüyor.', en: 'Where an order code exists on both sides but the line does not match, the ASAS and IAS values are now shown side by side, making it obvious whether the field arrived empty or was bound to the wrong column.' }
    ]
  },
  {
    v: '4.33', date: '2026-08-03',
    title: { tr: 'ASAS ile IAS eşleşmesi artık birebir', en: 'ASAS to IAS matching is now exact' },
    items: [
      { tr: 'IAS kaydında hem Model Adı hem Renk Kodu doluysa, o kayıt yalnız Sipariş Kodu, Model Adı ve Renk Kodu birebir tutan satıra bağlanır. Üçlü anahtar tutmuyorsa kayıt artık renk tanımı veya yalnız sipariş kodu üzerinden başka bir satıra bağlanamaz.', en: 'When an IAS record carries both model name and colour code it is attached only to the line whose order code, model name and colour code match exactly. If the triple key does not match, the record can no longer reach another line through colour description or order code alone.' },
      { tr: 'Gevşek eşleşme yalnız iki durumda kaldı: IAS kaydında model adı veya renk kodu boşsa, ya da ASAS satırında bu alanlar boşsa. Her iki durum da yenileme bildiriminde sayıyla raporlanıyor.', en: 'Looser matching now applies in only two cases: when the IAS record lacks model name or colour code, or when the ASAS line lacks them. Both cases are reported with counts in the refresh notice.' },
      { tr: 'Kumaş bilgisi eşleşmesi de aynı birebir kurala alındı; bir modelin kumaş bilgisi artık aynı siparişteki başka bir modele geçmiyor.', en: 'Fabric information matching now follows the same exact rule, so one model\u2019s fabric details no longer leak onto another model in the same order.' },
      { tr: 'Yenileme bildirimi genişletildi: birebir kurulamayan eşleşme sayısı, eksik alan yüzünden gevşek kalan satır sayısı ve eşleşmeyen ASAS ile IAS anahtarlarından örnekler gösteriliyor.', en: 'The refresh notice now shows how many matches could not be made exactly, how many lines stayed loose because of missing fields, and sample unmatched keys from both ASAS and IAS.' }
    ]
  },
  {
    v: '4.32', date: '2026-08-03',
    title: { tr: 'Backlog: ASAS ile IAS arasında sipariş satırı eşleşmesi düzeltildi', en: 'Backlog: order line matching between ASAS and IAS fixed' },
    items: [
      { tr: 'Bir sipariş kodunun IAS tarafında yalnız tek satırı varsa, aynı siparişin diğer model ve renk satırları da o kaydın statüsünü, antrepo giris tarihini ve yükleme tipini devralıyordu. Artık iki tarafın da dolu olduğu model adı veya renk kodu alanında fark varsa o IAS kaydı bu satıra hiçbir düzeyde bağlanmıyor.', en: 'When only one line of an order code existed on the IAS side, the other model and colour lines of the same order inherited its status, warehouse arrival date and delivery type. An IAS record is now never attached to a line that differs on model name or colour code when both sides have those fields filled.' },
      { tr: 'IAS tarafında model adı ve renk kodu boş olan bağlantılarda eski kademeli eşleşme aynen sürüyor, yani mevcut kurulumlar bozulmuyor.', en: 'Where the IAS side leaves model name and colour code empty, the previous stepwise matching continues unchanged, so existing setups keep working.' },
      { tr: 'Pivotta bir gruba tıklandığında açılan detay penceresi, o gruptaki sipariş kodlarının bütün satırlarını getiriyordu. Detay artık tıklanan düğümün tam satır kümesini, pivotla aynı filtrelerle sunucuda çözerek gösteriyor.', en: 'Opening the detail window for a pivot group returned every line of that group\u2019s order codes. The detail now resolves the exact row set of the clicked node on the server, using the same filters as the pivot.' },
      { tr: 'Backlog Excel raporunda operasyon alanları sipariş kodu ve renk tanımıyla eşleniyordu; aynı renk tanımına sahip iki model çakışıp birbirinin Ex-factory, yükleme tipi, risk ve antrepo tarihi değerlerini alabiliyordu. Eşleme Sipariş Kodu, Model Adı ve Renk Kodu üçlüsüne alındı.', en: 'In the Backlog Excel report the operational fields were matched by order code and colour description, so two models sharing a colour description could take each other\u2019s ex-factory, delivery type, risk and warehouse dates. Matching now uses order code, model name and colour code together.' },
      { tr: 'Yenileme bildirimi, IAS tarafında yalnız başka bir model veya renk koduna ait kayıt bulunduğu için eşleşmeyen satır sayısını gösteriyor. Bu sayı yüksekse sorun eşleştirmede değil, sorgunun o satırları hiç getirmemesindedir.', en: 'The refresh notice now reports how many lines went unmatched because IAS only held a record for a different model or colour code. A high number means the query is not returning those lines rather than the matching being at fault.' },
      { tr: 'Pivot yanıtından sipariş kodu listeleri kaldırıldı; büyük Backlog sonuçlarında sunucu yanıtı belirgin şekilde küçüldü.', en: 'Order code lists were removed from the pivot response, noticeably shrinking the server payload for large Backlog results.' }
    ]
  },
  {
    v: '4.31', date: '2026-08-03',
    title: { tr: 'Kopyalama, fiyat geçmişi, TPs ve Koleksiyon görünüm düzeltmeleri', en: 'Copy, pricing history, TPs and Collection view fixes' },
    items: [
      { tr: 'CP kopyalamada Order Info, Logistic ve Notes gibi grup başlıkları kaldırıldı; yalnız gerçek sütun başlıkları kopyalanıyor.', en: 'CP copy now omits group headings such as Order Info, Logistic and Notes, copying only the actual column headings.' },
      { tr: 'Supp. FOB hem panoya kopyalamada hem standart Excel aktarımında FOB ile aynı dolar para biçimini kullanıyor.', en: 'Supplier FOB now uses the same dollar currency format as FOB in both clipboard copy and standard Excel export.' },
      { tr: 'Pricing History penceresine Üretici bazlı ve Fiyat sırası görünümleri eklendi. Fiyat sırası görünümünde modelin teklifleri düşükten yükseğe diziliyor ve her hücre fiyat ile üretici adını birlikte gösteriyor.', en: 'Pricing History now offers By manufacturer and Price order views. Price order sorts each model’s offers from low to high and shows the price together with the manufacturer in each cell.' },
      { tr: 'TPs penceresindeki dosya durumu ve sıralama menüleri modalın üzerinde doğru katmanda açılıyor ve seçimler listeye uygulanıyor.', en: 'The file-status and sorting menus in TPs now open above the modal correctly and apply their selections to the list.' },
      { tr: 'Koleksiyon sütun dondurma seçimi çalışır hâle getirildi; gövde kararır, başlıklar belirgin kalır, seçilen başlık yumuşak renkle vurgulanır ve yönlendirme ekranın ortasında gösterilir.', en: 'Collection column freezing now works; the body dims, headers remain prominent, selected headers receive a soft highlight and the guidance appears in the centre of the screen.' },
      { tr: 'Overseas Landed ve TR Landed, eski kayıtlı sütun düzenlerinde de bir kez FOB sütununun hemen sağına taşınır.', en: 'Overseas Landed and TR Landed are moved once to immediately follow FOB even for previously saved column layouts.' }
    ]
  },
  {
    v: '4.30', date: '2026-08-03',
    title: { tr: 'Landed hücrelerinde giriş düzeltmesi ve sade görünüm', en: 'Landed cells: input fix and a plainer look' },
    items: [
      { tr: 'Türkiye fiyatı yazıldığında hiçbir şey değişmiyordu. Değer kaydediliyor ama satır yeniden çizilmediği için hesaplanan hücreler eski değerde kalıyordu. Landed alanlarının tümü artık anında yeniden hesaplanıyor.', en: 'Typing a domestic price changed nothing. The value was saved, but the row was not redrawn so the calculated cells kept their old value. All landed fields now recalculate immediately.' },
      { tr: 'Giriş alanları artık kutu gibi durmuyor: normalde yalnız yazılan değer görünür, üzerine gelince ince bir çerçeve belirir, tıklandığında düzenleme moduna geçer.', en: 'The input fields no longer look like boxes: only the entered value is visible, a thin border appears on hover, and clicking switches to edit mode.' },
      { tr: 'Kutucuklar kalktığı için sütunlar daraldı ve alanlar içeriğe göre boyutlanıyor.', en: 'With the boxes gone the columns are narrower and the fields size themselves to their content.' },
      { tr: 'Yurt dışı kârlılık yüzdesi artık yurt dışı fiyatının hemen solunda.', en: 'The overseas profit percentage now sits immediately to the left of the overseas price.' }
    ]
  },
  {
    v: '4.29', date: '2026-08-03',
    title: { tr: 'Landed sütunları yeniden konumlandı ve daraltıldı', en: 'Landed columns repositioned and made compact' },
    items: [
      { tr: 'Overseas Landed sütunu FOB sütununun hemen sağına, TR Landed ise onun sağına alındı.', en: 'The overseas landed column now sits immediately to the right of the FOB column, with domestic landed to its right.' },
      { tr: 'Hücre içindeki bilgiler alt alta değil yan yana dizildi. İki satırlık düzen tablodaki bütün satırları yükseltiyordu; satır yüksekliği artık diğer hücrelerle aynı.', en: 'The information inside the cells is now laid out side by side instead of stacked. The two line layout was making every row in the table taller; row height now matches the other cells.' },
      { tr: 'Yurt dışı hücresinde Supp. FOB kaynağı yer kaplamaması için C, B veya T harfiyle gösterilir; tam adı ve üretici araç ipucundadır.', en: 'In the overseas cell the supplier FOB source is shown as a single letter to save space; the full name and the manufacturer are in the tooltip.' }
    ]
  },
  {
    v: '4.28', date: '2026-08-03',
    title: { tr: 'Koleksiyon: Türkiye ve yurt dışı landed karşılaştırması', en: 'Collection: domestic and overseas landed comparison' },
    items: [
      { tr: 'İki yeni sütun eklendi. TR Landed = Türkiye fiyatı (TL) ÷ kur × landed çarpanı; Yurt Dışı Landed = Supp. FOB × landed çarpanı. Yurt dışı hücresinde ayrıca Türkiye fiyatına göre kâr oranı görünür.', en: 'Two new columns have been added. Domestic landed is the domestic price in lira divided by the rate and multiplied by the landed factor; overseas landed is the supplier FOB multiplied by its landed factor. The overseas cell also shows the profit ratio against the domestic price.' },
      { tr: 'Supp. FOB şu sırayla seçilir: önce Confirmed fiyat, yoksa en iyi fiyat, o da yoksa Target Price. Hangisinin kullanıldığı hücrede rozetle yazar, çünkü aynı rakam üç farklı anlam taşıyabilir.', en: 'The supplier FOB is chosen in this order: the confirmed price first, then the best price, and failing that the target price. A badge in the cell states which one was used, since the same figure can carry three different meanings.' },
      { tr: 'Landed çarpanları ve kur otomatik gelir ve elle değiştirilebilir. Kur, Ex-Factory tarihinin ayına göre seçilir. Fazladan sütun açılmadı: giriş alanları sonucun altında, kendi hücresindedir.', en: 'The landed factors and the exchange rate arrive automatically and can be changed by hand. The rate is taken from the month of the ex-factory date. No extra columns were added: the input fields sit beneath the result inside the same cell.' },
      { tr: 'Bir değer elle girildiğinde alanın çerçevesi belirginleşir; boş bırakılan alanda otomatik değer yer tutucu olarak görünür.', en: 'When a value is entered by hand the field border is emphasised; a field left empty shows the automatic value as a placeholder.' },
      { tr: 'Her iki sütun Excel aktarımında da para biçiminde yer alır.', en: 'Both columns are included in the Excel export in currency format.' }
    ]
  },
  {
    v: '4.27', date: '2026-08-02',
    title: { tr: 'Ön maliyet: formüllü Excel aktarımı ve içeri aktarma', en: 'Preliminary costing: Excel export with formulas and import' },
    items: [
      { tr: 'Dışa aktarım artık hesaplanmış sayılar yerine canlı formüller yazıyor. Satır toplamları, grup ara toplamları, fire, genel gider, finansman, kâr zinciri, birim FOB, hedef sapması ve toplam sipariş maliyeti Excel içinde yeniden hesaplanır; bir tüketim ya da birim fiyat değiştirildiğinde tüm sonuçlar güncellenir.', en: 'The export now writes live formulas instead of calculated numbers. Line totals, group subtotals, the waste, overhead, finance and profit chain, unit FOB, target gap and total order cost are recalculated inside Excel, so changing a usage or unit price updates every result.' },
      { tr: 'Satırların para birimi kayıt para biriminden farklı olabildiği için kurlar ayrı bir Kurlar sayfasına yazılır ve satır formülleri oradan okur. Kur da elle düzeltilebilir.', en: 'Because a line can use a different currency from the record, rates are written to a separate rates sheet that the line formulas read from. The rate can also be corrected by hand.' },
      { tr: 'İçeri Aktar düğmesi eklendi. Bu ekrandan aktarılmış bir dosya geri yüklenebilir: Excel\'de değiştirilen değerler ve eklenen satırlar uygulamaya geri gelir.', en: 'An import button has been added. A file exported from this screen can be loaded back: values changed in Excel and rows added there return to the application.' },
      { tr: 'Geri yükleme, dosyadaki görünmez anahtar sütununa dayanır; satır sırası değişse veya araya satır eklense de dosya okunur. Dosyadaki kimlik mevcut bir kayda aitse o kayıt güncellenir, değilse yeni kayıt oluşturulur; başka bir kayıt hiçbir durumda ezilmez.', en: 'Loading back relies on a hidden key column in the file, so it can be read even if the row order changes or rows are inserted. If the identity in the file belongs to an existing record that record is updated, otherwise a new record is created; no other record is ever overwritten.' },
      { tr: 'İçe aktarılan veri doğrudan kaydedilmez; ekranda kaydedilmemiş değişiklik olarak görünür ve Kaydet ile onaylanır.', en: 'Imported data is not saved directly; it appears as an unsaved change and is confirmed with save.' }
    ]
  },
  {
    v: '4.26', date: '2026-08-02',
    title: { tr: 'Nakliye Kıyaslama: model kartları ve kart içinde veri girişi', en: 'Shipping comparison: model cards and data entry inside the cards' },
    items: [
      { tr: 'Artık tek model değil, tüm siparişler alt alta listeleniyor. Her satırda solda model kartı, sağa doğru dört karşılaştırma kartı yer alıyor.', en: 'All orders are now listed one under another instead of a single model. Each row shows the model card on the left and four comparison cards to the right.' },
      { tr: 'Model kartında model adı ve altında sezon, ülke, üretici, klasman, renk kodu, adet ve retail tarihi görünüyor.', en: 'The model card shows the model name with season, country, supplier, category, colour code, quantity and retail date beneath it.' },
      { tr: 'Elle girilen değerler kendi kartında düzenleniyor: Ex-Factory model kartında, TR fiyatı ve kur Domestic kartında, Gemi+Uçak ve Uçak landed fiyatları kendi kartlarında. Girilen değer aynı anda alttaki tabloya da yansıyor; ikisi aynı veriyi gösteriyor.', en: 'Manually entered values are edited in their own card: ex-factory on the model card, the domestic price and FX rate on the domestic card, and the sea plus air and air landed prices on their own cards. A value entered here appears in the table below at the same time; both show the same data.' },
      { tr: 'Nakliye süreleri artık Kaynak bölümündeki Transfer Lead Times kurallarından canlı çözülüyor: satırın kendi ülkesi, sezonu ve Ex-Factory tarihine göre. Kural bulunamazsa satırın oluşturulma anındaki değer, o da yoksa varsayılan süreler kullanılıyor. Model kartında hangi sürelerin kullanıldığı yazıyor.', en: 'Transit times are now resolved live from the transfer lead time rules in the source section, based on the row own country, season and ex-factory date. If no rule matches, the value captured when the row was created is used, and failing that the default durations. The model card states which durations were used.' },
      { tr: 'Kart listesi uzayabildiği için tabloyu gizleyip gösteren bir düğme eklendi.', en: 'A button to hide and show the table has been added, since the card list can grow long.' }
    ]
  },
  {
    v: '4.25', date: '2026-08-02',
    title: { tr: 'Nakliye Kıyaslama: karar kartları', en: 'Shipping comparison: decision cards' },
    items: [
      { tr: 'Tablonun üstüne dört karşılaştırma kartı eklendi: TR Üretim, Gemi, Gemi + Uçak ve Uçak. Karar bu dört seçenek arasında veriliyordu ama karşılaştırma 47 sütunluk tabloda üç ayrı avantaj sütunu ve üç ayrı teslim tarihi olarak dağılmıştı.', en: 'Four comparison cards have been added above the table: domestic, vessel, vessel plus air, and air. The decision is made between these four options, but the comparison was spread across three separate advantage columns and three separate arrival dates in a table of 47 columns.' },
      { tr: 'Her kartta birim landed fiyat, TR karşısındaki yüzde, tahmini antrepo teslim tarihi ve toplam fark görünür. En ucuz ve en erken seçenekler rozetle işaretlenir; ikisi aynı karttaysa karar açıktır, farklıysa ödünleşim görünür hâle gelir.', en: 'Each card shows the unit landed price, the percentage against domestic, the estimated arrival date and the total difference. The cheapest and earliest options are marked with badges; when both fall on the same card the decision is clear, and when they do not the trade-off becomes visible.' },
      { tr: 'Toplam fark hesabı eklendi: birim farkı adet ile çarpılır. Avantaj sütunları yalnız birim yüzdesi veriyordu; aynı yüzde 500 adette başka, 50.000 adette başka bir karar gerektirir.', en: 'A total difference calculation has been added: the unit difference multiplied by the quantity. The advantage columns gave only a unit percentage, yet the same percentage calls for a different decision at 500 units than at 50,000.' },
      { tr: 'Tabloda bir satıra tıklamak kartları o siparişe çevirir ve satır işaretli kalır.', en: 'Clicking a row in the table switches the cards to that order and keeps the row marked.' },
      { tr: 'Kartlar yalnız gösterir: hiçbir değeri değiştirmez, Nihai Vasıta PBL Karar elle girilmeye devam eder. Tablo sütunları ve Excel şablonu değişmedi.', en: 'The cards only display: they change no value and the final transport decision is still entered by hand. The table columns and the Excel template are unchanged.' }
    ]
  },
  {
    v: '4.24', date: '2026-08-02',
    title: { tr: 'Quotations\'ta Drop düğmesinin ikinci tıklamayı beklemesi giderildi', en: 'Fixed the drop button in quotations requiring a second click' },
    items: [
      { tr: 'Bir modeli drop ettikten sonra diğer modelleri drop ederken düğmeye iki kez basmak gerekiyordu. Aynı sorun onaylama, fiyat girişi ve silme için de geçerliydi.', en: 'After dropping one model, dropping the others required pressing the button twice. The same problem applied to approving, price entry and deleting.' },
      { tr: 'Neden: kayıt sunucuya yazıldıktan sonra dönen yanıt, yerel depodaki istek nesnesini yenisiyle değiştiriyordu. Ekrandaki düğmeler ise çizim anındaki nesneye bağlı kalıyor, böylece artık depoda olmayan bir kopyayı güncelliyordu; ekran ise depodaki yeni kaydı çizdiği için tıklama etkisiz görünüyordu.', en: 'Cause: after a record was saved, the response replaced the request object in local storage with a new one. The buttons on screen remained bound to the object from the time of rendering and therefore updated a copy that was no longer in storage, while the screen drew the new record, so the click appeared to do nothing.' },
      { tr: 'Sunucudan gelen kayıt artık mevcut nesnenin üzerine yerinde yazılıyor; nesne kimliği korunuyor ve tek tıklama yeterli oluyor.', en: 'The record from the server is now merged into the existing object in place, so its identity is preserved and a single click is enough.' }
    ]
  },
  {
    v: '4.23', date: '2026-08-02',
    title: { tr: 'En iyi üç fiyat artık madalya rozetiyle işaretleniyor', en: 'The three best prices are now marked with a medal badge' },
    items: [
      { tr: 'Hücre arka planı ve fiyat metni boyanmıyor; dolgu ve renkli rakam okunurluğu düşürüyordu. Fiyatın soluna küçük bir altın, gümüş veya bronz rozet konuyor, hücre nötr kalıyor.', en: 'The cell background and the price text are no longer coloured; the fill and the coloured figure reduced legibility. A small gold, silver or bronze badge is placed to the left of the price and the cell stays neutral.' },
      { tr: 'Sıralama kuralı aynı: en ucuz üç farklı fiyat işaretlenir, eşit fiyatlar aynı basamağı paylaşır.', en: 'The ranking rule is unchanged: the three cheapest distinct prices are marked and equal prices share the same place.' },
      { tr: 'Onaylanmış fiyatın yeşil şeridi eskisi gibi duruyor ve rozetle çakışmıyor.', en: 'The green stripe of a confirmed price remains as before and does not clash with the badge.' }
    ]
  },
  {
    v: '4.22', date: '2026-08-02',
    title: { tr: 'Fiyat geçmişinde en iyi üç fiyat renklendirildi', en: 'The three best prices are now coloured in pricing history' },
    items: [
      { tr: 'Her modelin satırında en ucuz üç farklı fiyat yumuşak altın, gümüş ve bronz renklerle işaretlenir.', en: 'In each model row the three cheapest distinct prices are marked in soft gold, silver and bronze.' },
      { tr: 'Eşit fiyatlar aynı basamağı paylaşır ve bir sonraki farklı fiyat bir alt sıraya geçer. İki üretici aynı en iyi fiyatı verdiyse ikisi de altın olur, bir sonraki fiyat gümüş olur.', en: 'Equal prices share the same place and the next distinct price moves up one. If two manufacturers give the same best price both are gold and the next price is silver.' },
      { tr: 'Onaylanmış fiyatın yeşili madalyanın üstünde kalır; onay bir sonuç, madalya bir kıyaslamadır ve onayın görünürlüğü kaybolmaz.', en: 'The green of a confirmed price stays above the medal: confirmation is an outcome while the medal is a comparison, so confirmation remains visible.' },
      { tr: 'Aynı renkler Excel aktarımında da uygulanır.', en: 'The same colours are applied in the Excel export.' }
    ]
  },
  {
    v: '4.21', date: '2026-08-02',
    title: { tr: 'Backlog ve alan eşlemesi filtreleri CP ile aynı panele geçti', en: 'Backlog and field mapping filters moved to the same panel as CP' },
    items: [
      { tr: 'Buyer Grup açılır penceresi boş geliyordu: içeriği yalnız CP verisi yüklenirken bir kez dolduruluyor, Backlog kendi değerlerine geçtiğinde boş kalıyordu. Artık diğer boyutlarla aynı paneli açıyor.', en: 'The buyer group dropdown came up empty: its contents were filled only once while CP data loaded, and stayed empty once Backlog moved to its own values. It now opens the same panel as the other dimensions.' },
      { tr: 'Backlog\'daki bütün filtre pencereleri CP\'deki sütun filtresiyle aynı bileşeni kullanıyor: Ara, Tümü, Temizle, Uygula, Geçerli Seçime Ekle ve Filtreyi Kaldır.', en: 'Every filter window in Backlog now uses the same component as the CP column filter: search, all, clear, apply, add to current and remove filter.' },
      { tr: 'Antrepo Giriş Tarihi artık Yıl, Ay, Hafta ve Gün kademeleriyle filtrelenebiliyor; CP\'deki tarih sütunu filtresiyle aynı akordiyon.', en: 'The bonded warehouse arrival date can now be filtered by year, month, week and day, using the same accordion as the date column filter in CP.' },
      { tr: 'Üst çubuktaki hızlı filtreler ile boyut düğmeleri aynı pencereyi açar; iki ayrı filtre arayüzü kalmadı.', en: 'The quick filters in the top bar and the dimension buttons open the same window; there are no longer two separate filter interfaces.' },
      { tr: 'Alan eşlemesinde açılır liste yerine aranabilir seçici geldi. Yazmaya başlayınca yazdığınızı içeren sütunlar listelenir; model şeması yüzlerce sütun içerdiğinde aramadan bulmak zordu.', en: 'Field mapping now uses a searchable picker instead of a dropdown. Typing lists the columns containing what you typed; with hundreds of columns in a model schema, finding one without search was difficult.' }
    ]
  },
  {
    v: '4.20', date: '2026-08-02',
    title: { tr: 'Backlog filtreleri CP\'den bağımsız hâle getirildi', en: 'Backlog filters made independent of CP' },
    items: [
      { tr: 'Backlog filtre listeleri CP veri kümesinden üretiliyordu. CP kapsamı Backlog kapsamından dar olduğu için, raporda bulunan MAG ve Buying Group değerleri filtre listesinde hiç görünmüyor ve filtrelenemiyordu. Değerler artık Backlog\'un kendi veri kümesinden gelir.', en: 'Backlog filter lists were built from the CP data set. Because the CP scope is narrower than the Backlog scope, values present in the report never appeared in the filter list and could not be filtered. Values now come from the Backlog data set itself.' },
      { tr: 'Satırlar veya Sütunlar alanına eklenen her boyut artık kendi filtre düğmesini alır; Buying Group dahil. Üst çubuktaki kısayollar ile bu düğmeler aynı seçimi düzenler.', en: 'Every dimension added to the rows or columns area now has its own filter button, including Buying Group. The shortcuts in the top bar and these buttons edit the same selection.' },
      { tr: 'Bir boyutu filtrelemek diğer boyutların seçeneklerini listeden kaldırmaz; yalnız halen veri getiren değerler vurgulanır, getirmeyenler soluk gösterilir.', en: 'Filtering one dimension no longer removes options from the other dimensions; values that still return data are highlighted while the rest are shown faded.' },
      { tr: 'Filtre listeleri tarih penceresine göre tazelenir: retail veya antrepo tarih aralığının dışındaki değerler listede yer almaz.', en: 'Filter lists refresh with the date window: values outside the retail or bonded warehouse date range are not listed.' }
    ]
  },
  {
    v: '4.19', date: '2026-08-02',
    title: { tr: 'Kullanıcı düzenlemeleri de sipariş + model + renk koduna geçti', en: 'User edits now also use order, model and colour code' },
    items: [
      { tr: 'Onaylar, notlar, alt üretici, Supp. FOB, teslim tipi, lisansör ve tarih revizyonları eskiden yalnız sipariş koduyla saklanıyordu; bir siparişin bütün modelleri aynı değeri paylaşıyordu. Artık her satır kendi değerini tutar.', en: 'Approvals, notes, sub-manufacturer, supplier FOB, delivery type, licensor and date revisions used to be stored by order code alone, so every model in an order shared one value. Each line now holds its own value.' },
      { tr: 'Bugüne kadar sipariş bazında kaydedilmiş veriler SİLİNMEDİ. Okuma önce satır anahtarını, bulamazsa eski sipariş anahtarını dener; bir satır ilk kez düzenlendiğinde eski kayıt tohum olarak alınır. Alt üretici ve not bilgileri korunur.', en: 'Data saved by order code so far has NOT been deleted. Reading tries the line key first and falls back to the old order key; the first time a line is edited the old record is used as its starting point. Sub-manufacturer and note data are preserved.' },
      { tr: 'Supp. FOB kuralları artık satır bazında uygulanır: aynı siparişteki farklı modeller kendi FOB değerlerinden kendi Supp. FOB sonuçlarını alır. Önceden yalnız ilk satır hesaplanıp değeri tüm siparişe yazılıyordu.', en: 'Supplier FOB rules now apply per line: different models in the same order derive their own result from their own FOB. Previously only the first line was calculated and its value written across the whole order.' },
      { tr: 'CP ve Onay Excel içe aktarmalarında dosyada Model Adı ve Renk Kodu sütunları varsa düzenleme doğrudan satıra yazılır; yoksa eski sipariş bazlı davranış sürer.', en: 'In the CP and approval Excel imports, if the file contains model name and colour code columns the edit is written directly to the line; otherwise the previous order-based behaviour continues.' },
      { tr: 'Onay içe aktarmasında aynı sipariş kodunun farklı modelleri artık çelişki sayılmıyor.', en: 'In the approval import, different models under the same order code are no longer treated as a conflict.' }
    ]
  },
  {
    v: '4.18', date: '2026-08-02',
    title: { tr: 'Revize hücrelerde köprü ve orijinale tam dönüş', en: 'Links in revised cells, and an exact return to the original' },
    items: [
      { tr: 'Revize edilen Ex→Retail hücresindeki köprü bağlantısı siliniyordu. Artık yeni değer bağlantılı kalıyor, eski değer düz metin olarak gösteriliyor.', en: 'The link in a revised Ex→Retail cell was being removed. The new value now keeps its link while the old value is shown as plain text.' },
      { tr: 'Manuel tarih silindiğinde Ex→Retail orijinal değerine bir gün sapmayla dönüyordu. ASAS orijinalleri artık hem sunucuda gün bazına indirgeniyor hem de tarayıcıda gerçek tarihe çevriliyor; daha önce canlı değer tarih, orijinal ise metin olarak taşınıyordu.', en: 'When a manual date was cleared, Ex→Retail returned to its original with a one day drift. The original values from the source are now reduced to day precision on the server and converted to real dates in the browser; previously the live value was a date while the original was carried as text.' },
      { tr: 'Hücre boşaltıldığında geri konan tarih her zaman gün bazlı bir tarihe çevriliyor; Retail ve In-Store için de aynısı geçerli.', en: 'The date restored when a cell is cleared is always converted to a day precision date, for Retail and In-Store as well.' }
    ]
  },
  {
    v: '4.17', date: '2026-08-02',
    title: { tr: 'Sipariş eşleşmesi artık Sipariş Kodu + Model Adı + Renk Kodu', en: 'Order matching now uses order code, model name and colour code' },
    items: [
      { tr: 'Bir sipariş kodunun altında aynı renk koduna sahip birden fazla model olabildiği için, veri kaynakları arasındaki eşleşme üçlü anahtara geçirildi. Eski kural bu durumda yanlış satırın Antrepo veya kumaş bilgisini getirebiliyordu.', en: 'Because one order code can contain several models sharing the same colour code, matching between data sources now uses a three-part key. The previous rule could bring the bonded-warehouse or fabric data of the wrong line.' },
      { tr: 'IAS ve Kumaş bağlantılarının alan listesine Model Adı ve Renk Kod eklendi. Bu alanlar eşlenene kadar eşleştirme eski kurala düşer ve yenileme bildiriminde bu durum açıkça uyarı olarak yazılır.', en: 'Model name and colour code have been added to the field list of the bonded-warehouse and fabric connections. Until they are mapped, matching falls back to the previous rule and the refresh notification states this explicitly.' },
      { tr: 'Eşleştirme kademeli çalışır: sipariş+model+renk kodu, sonra sipariş+renk kodu, sonra sipariş+model, sonra sipariş+renk tanımı, en son yalnız sipariş kodu. Böylece alan eksikse eşleşme sessizce kopmaz.', en: 'Matching is graduated: order+model+colour code, then order+colour code, then order+model, then order+colour description, and finally order code alone. A missing field therefore never breaks matching silently.' },
      { tr: 'Her yenilemede hangi düzeyde kaç siparişin eşleştiği bildirimde gösterilir; asıl kuralın gerçekten çalışıp çalışmadığı böylece görünür.', en: 'Every refresh reports how many orders matched at each level, making it visible whether the intended rule is actually being used.' }
    ]
  },
  {
    v: '4.16', date: '2026-08-02',
    title: { tr: 'Manuel tarih revizyonları artık kalıcı', en: 'Manual date revisions are now permanent' },
    items: [
      { tr: 'CP\'de elle girilen Ex-factory, Retail ve In-Store tarihleri kalıcı olarak kaydediliyor. Yenileme sonrası veritabanından gelen tarih artık manuel girişi silmiyor.', en: 'Ex-factory, Retail and In-Store dates entered by hand in CP are now stored permanently. After a refresh the date coming from the database no longer erases the manual entry.' },
      { tr: 'Aynı revize tarihler CP, Sipariş Özeti ve Backlog tarafından da kullanılıyor; üç sayfa aynı tarihi görüyor.', en: 'The same revised dates are now used by CP, the order summary and Backlog, so all three pages see the same date.' },
      { tr: 'Orijinal değerin üstü artık çizilmiyor; yalnız daha soluk gösteriliyor.', en: 'The original value is no longer struck through, only shown in a lighter tone.' },
      { tr: 'Ex-Factory renklendirmesi (geçmiş, bu hafta, gelecek hafta) her zaman veritabanından gelen tarihe göre yapılıyor. Elle yapılan revizyon rengi değiştirmiyor.', en: 'Ex-Factory colouring (past, this week, next week) is always based on the date from the database. A manual revision does not change the colour.' },
      { tr: 'Tarih hücresi boşaltıldığında revizyon kaldırılıyor ve hücre veritabanındaki orijinal değere dönüyor. Retail boşaltılırsa In-Store da orijinaline dönüyor.', en: 'Clearing a date cell removes the revision and returns the cell to the original value from the database. Clearing Retail also returns In-Store to its original.' },
      { tr: 'Geçersiz bir tarih metni yazıldığında hücre artık kilitlenmiyor; son geçerli değere dönüp düzenleme normal şekilde kapanıyor. Esc ile vazgeçilebiliyor.', en: 'Typing invalid date text no longer traps the cell; it returns to the last valid value and editing closes normally. Esc cancels.' },
      { tr: 'Yıl yazılmadan tarih girilebiliyor: 15.12 yazıldığında içinde bulunduğumuz yıl kabul ediliyor. Ayraçsız girişler de çalışıyor: 1512, 151226.', en: 'Dates can be entered without a year: typing 15.12 assumes the current year. Entries without separators also work: 1512, 151226.' },
      { tr: 'Tarih metnini yazdıktan sonra Enter kaydedip düzenlemeyi bitiriyor.', en: 'After typing a date, Enter saves it and ends editing.' }
    ]
  },
  {
    v: '4.15', date: '2026-08-02',
    title: { tr: 'Manuel tarih revizyonunda eski ve yeni değer birlikte görünüyor', en: 'Manual date revisions now show the old and new value together' },
    items: [
      { tr: 'CP\'de Ex-factory, Retail veya In-Store tarihi elle revize edildiğinde hücre artık "eski → yeni" biçiminde görünür: eski değer solda soluk ve üstü çizili, yeni değer sağda vurgulu.', en: 'When an Ex-factory, Retail or In-Store date is revised by hand in CP, the cell now reads "old → new": the old value on the left, faded and struck through, the new value on the right in bold.' },
      { tr: 'Aynı gösterim, o revizyondan etkilenen bütün hücrelerde geçerlidir: Ex→Retail, Ür. Sür. (LT), Priority ve retail ile in-store arasındaki ±14 günlük eşleşme. Ex→Retail 67 iken 35 olduysa hücrede 67→35 yazar.', en: 'The same display applies to every cell affected by that revision: Ex→Retail, LT, Priority and the ±14 day pairing between retail and in-store. If Ex→Retail went from 67 to 35 the cell reads 67→35.' },
      { tr: 'Karşılaştırma her zaman veritabanından gelen ilk değere göredir, bir önceki revizyona göre değil. Aynı hücre ikinci kez revize edilse bile solda hep orijinal değer kalır.', en: 'The comparison is always against the value that came from the database, not against the previous revision. Even after a second revision the original value remains on the left.' },
      { tr: 'Değer orijinaline geri döndürülürse ok kendiliğinden kaybolur. "Değişiklikleri geri al" tüm okları temizler.', en: 'If a value is set back to its original the arrow disappears by itself. "Revert changes" clears every arrow.' },
      { tr: 'Kopyalama, revize hücrelerde eski ve yeni değeri birlikte alır; daha önce Priority sütununda revize öncesi değer kopyalanıyordu.', en: 'Copying takes both the old and the new value from revised cells; previously the Priority column copied the value from before the revision.' }
    ]
  },
  {
    v: '4.14', date: '2026-08-02',
    title: { tr: 'Ufuk rozeti: model kapsamı sayfalarda görünür', en: 'Horizon badge: the model scope is visible on the pages' },
    items: [
      { tr: 'CP, Backlog ve LFL sayfalarının üstünde model ufkunu gösteren bir rozet eklendi: hangi koşullarla veri çekildiği ve kaç sipariş geldiği yazar.', en: 'A badge showing the model horizon has been added to the top of the CP, Backlog and LFL pages: it states the conditions the data was pulled with and how many orders arrived.' },
      { tr: 'Sayfa filtresi seçenekleri yalnız çekilmiş satırlardan üretilir; ufkun dışarıda bıraktığı bir sezon filtre listesinde hiç görünmez. Rozet, veri yok ile veri çekilmedi arasındaki farkı görünür kılar.', en: 'Page filter options are built only from the rows that were pulled, so a season excluded by the horizon never appears in the filter list at all. The badge makes the difference between no data and data not pulled visible.' },
      { tr: 'Ufukta hiç koşul yoksa rozet uyarı rengine döner ve tüm tablonun çekildiğini belirtir.', en: 'When the horizon has no conditions the badge turns to the warning colour and states that the whole table is being pulled.' },
      { tr: 'Rozetteki bağlantı doğrudan kapsam ayarına götürür. LFL kendi kapsamı yoksa CP kapsamını gösterir; sunucudaki davranışla aynıdır.', en: 'The link on the badge goes straight to the scope settings. If LFL has no scope of its own it shows the CP scope, matching the server behaviour.' }
    ]
  },
  {
    v: '4.13', date: '2026-08-02',
    title: { tr: 'Bellek hatasına yol açan satır koruması düzeltildi', en: 'Row guard that caused the memory error fixed' },
    items: [
      { tr: 'v4.12\'de eklenen sabit koruma sütunu, SUMMARIZECOLUMNS\'ın boş satır elemesini kapatıyordu. O eleme aynı zamanda farklı tablolardan gelen gruplama sütunlarını birbirine bağlayan mekanizmadır; kapatılınca iki tablonun tam kartezyen çarpımı üretildi ve sunucu bellek hatası verdi.', en: 'The constant guard column added in v4.12 disabled the blank-row removal of SUMMARIZECOLUMNS. That removal is also the mechanism that joins grouping columns from different tables; with it disabled the full cartesian product of the two tables was produced and the server ran out of memory.' },
      { tr: 'Koruma artık sabit bir değer değil, varlık ölçüsüdür: gruplamaya katılan her tablonun geçerli filtre bağlamında satırı varsa sonuç üretilir. Var olmayan kombinasyonlar yine elenir, ama kullanıcının ölçüsü boş olan satırlar korunur.', en: 'The guard is now an existence measure rather than a constant: a value is produced only when every table taking part in the grouping has rows in the current filter context. Non-existent combinations are still removed, while rows whose measure is blank are preserved.' },
      { tr: 'Sunucudan gelen bellek hatası artık nedenini açıklayan bir mesajla gösterilir; sorgunun ara sonucunu küçültmek için ne yapılabileceği yazılır.', en: 'A memory error returned by the server is now shown with a message explaining the likely cause and what can be done to reduce the size of the query result.' }
    ]
  },
  {
    v: '4.12', date: '2026-08-02',
    title: { tr: 'Model sorgusunda kaybolan satırların düzeltilmesi', en: 'Fixing rows lost in the model query' },
    items: [
      { tr: 'SUMMARIZECOLUMNS, bütün ölçü sütunları boş olan satırları sonuçtan tamamen çıkarır. Antrepo sorgusunda tek ölçü HANDOVER Tarihi olduğu için, handover tarihi henüz oluşmamış siparişler modelden hiç dönmüyordu. Bu siparişler uygulamada Antrepo kaydı yok sayılıp CP\'de Üretimde görünüyordu.', en: 'SUMMARIZECOLUMNS removes rows where all measure columns are blank. Because the only measure in the bonded-warehouse query was the handover date, orders without a handover date yet never came back from the model. Those orders were treated as having no bonded-warehouse record and appeared as In Production in CP.' },
      { tr: 'Ölçü içeren her otomatik sorguya, hiçbir zaman boş olmayan bir koruma sütunu eklendi. Böylece satır eleme koşulu hiç oluşmaz ve sonuç eksilmez.', en: 'Every generated query that contains a measure now includes a guard column that is never blank, so the row-removal condition never occurs and no rows are lost.' },
      { tr: 'Aynı tuzak ASAS tarafında da vardı: bütün ölçüleri boş olan sipariş satırları sessizce düşüyordu. Koruma her iki bağlantıda da geçerlidir.', en: 'The same trap existed on the ASAS side: order rows with all measures blank were silently dropped. The guard applies to both connections.' },
      { tr: 'Koruma sütunu sonuçtan temizlenir; önizlemede ve sütun listelerinde görünmez.', en: 'The guard column is stripped from the result and does not appear in previews or column lists.' }
    ]
  },
  {
    v: '4.11', date: '2026-08-02',
    title: { tr: 'Antrepo statü dağılımı teşhisi', en: 'Bonded-warehouse status distribution diagnostics' },
    items: [
      { tr: 'Yenileme bildiriminde artık modelden gelen Supplier Portal Statü değerlerinin dağılımı gösterilir. Bir statü bu listede hiç görünmüyorsa sorun eşleştirmede değil, sorgunun o satırları hiç getirmemesindedir.', en: 'The refresh notification now shows the distribution of Supplier Portal Status values returned by the model. If a status does not appear in this list at all, the problem is not matching but that the query never returned those rows.' },
      { tr: 'Modelden gelip hiçbir siparişe denk gelmeyen Antrepo kayıtlarının sayısı ayrıca raporlanır; bu sayı anahtar sorunu ile eksik satır sorununu birbirinden ayırır.', en: 'The number of bonded-warehouse records that matched no order is now reported separately; this distinguishes a key problem from a missing-row problem.' }
    ]
  },
  {
    v: '4.10', date: '2026-08-02',
    title: { tr: 'Antrepo sütun eşleştirmesi ve sessiz başarısızlığın giderilmesi', en: 'Bonded-warehouse column matching and the end of silent failures' },
    items: [
      { tr: 'Antrepo sonucundaki sütunlar birebir ada göre aranıyordu. Başlık tek harf bile farklıysa (Sipariş Kodu, Renk Tanımı, Renk gibi) sonuç hiç okunamıyor ve bütün siparişler CP\'de Üretimde görünüyordu. Artık sırayla birebir ad, takma ad ve içerme denenir.', en: 'Bonded-warehouse result columns were matched by exact name. A single character difference in a header meant the result could not be read at all and every order appeared as In Production in CP. Exact name, alias and partial match are now tried in order.' },
      { tr: 'Sütunlar çözülemediğinde artık sessizce boş sonuç dönmez. Yenileme bildiriminde modelden dönen sütun adları ve hangi alanın eksik olduğu yazılır.', en: 'When columns cannot be resolved the result is no longer silently empty. The refresh notification lists the column names returned by the model and which field is missing.' },
      { tr: 'Her yenilemede Antrepo eşleşme özeti gösterilir: kaç satır geldiği, kaç sipariş-renk kaydı üretildiği ve kaç siparişin eşleştiği.', en: 'Every refresh now shows a bonded-warehouse match summary: how many rows arrived, how many order-colour records were produced and how many orders matched.' },
      { tr: 'Hiçbir sipariş eşleşmezse iki taraftan örnek anahtarlar ve okunan sütun adları bildirimde gösterilir, böylece sorun tahmin edilmeden görülür.', en: 'If no order matches, sample keys from both sides and the resolved column names are shown in the notification, so the problem is visible instead of guessed.' },
      { tr: 'Supplier Portal Statü sütunu boş gelen satır sayısı ayrıca raporlanır; bu satırlar CP\'de Üretimde görünmeye devam eder.', en: 'The number of rows arriving with an empty Supplier Portal Status is reported separately; those rows continue to appear as In Production in CP.' },
      { tr: 'Renk sütunu aranırken Renk Kod gibi kod sütunları dışlanır.', en: 'Code columns such as Colour Code are excluded when resolving the colour column.' }
    ]
  },
  {
    v: '4.09', date: '2026-08-02',
    title: { tr: 'Antrepo sipariş kodu eşleştirmesi ve ASAS daraltmasının kaldırılması', en: 'Bonded-warehouse order code matching and removal of the ASAS narrowing' },
    items: [
      { tr: 'Sipariş kodu artık ASAS ve Antrepo taraflarında tek bir kurala göre normalize ediliyor. Model sonucundaki "1.234.569", "1234569,00", "0001234569" gibi biçimler daha önce sayıya çevrilemiyor, o satırlar eşleşmeden düşüyor ve sipariş CP\'de Üretimde görünüyordu.', en: 'Order codes are now normalised with a single rule on both the ASAS and bonded-warehouse sides. Formats coming from the model such as "1.234.569", "1234569,00" or "0001234569" previously failed to convert to a number, so those rows dropped out of matching and the order appeared as In Production in CP.' },
      { tr: 'Çevrilemeyen sipariş kodları daha önce tek bir ortak anahtar altında toplanıyor ve aynı renkteki farklı siparişlerin Antrepo bilgisi birbirinin üstüne yazılıyordu. Bu karışma ortadan kalktı.', en: 'Order codes that failed to convert previously collapsed into one shared key, so bonded-warehouse data from different orders sharing a colour overwrote each other. That cross-contamination is gone.' },
      { tr: 'Antrepo verisini ASAS\'tan gelen sipariş kodlarıyla sınırlayan daraltma programdan tamamen kaldırıldı. Antrepo artık yalnız kendi kapsam koşullarıyla çalışır.', en: 'The narrowing that limited bonded-warehouse data to the order codes returned by ASAS has been removed from the program entirely. Bonded-warehouse data now runs only with its own scope conditions.' },
      { tr: 'Antrepo sorgusu ASAS sorgusunu beklemediği için iki sorgu paralel çalışır; yenileme süresi kısalır.', en: 'Because the bonded-warehouse query no longer waits for the ASAS query, the two run in parallel and refresh time is shorter.' },
      { tr: 'Bağlantı penceresindeki "CP siparişlerine göre sınırla" seçeneği yalnız Kumaş rolünde kalır; Antrepo rolünde kayıtlı eski değer açılışta kapatılır.', en: 'The "Limit to CP orders" option in the connection window remains only for the Fabric role; any stored value on the bonded-warehouse role is cleared at startup.' }
    ]
  },
  {
    v: '4.08', date: '2026-08-02',
    title: { tr: 'CP Antrepo durum eşleştirmesi düzeltildi', en: 'CP bonded-warehouse status matching fixed' },
    items: [
      { tr: 'Antrepo kaydında Yükleme Operasyonları, Yol Operasyonları veya benzeri gerçek bir durum bulunduğunda CP artık yanlışlıkla Üretimde durumuna düşmez.', en: 'When a real bonded-warehouse status such as Loading Operations or In-Transit Operations exists, CP no longer falls back incorrectly to In Production.' },
      { tr: 'Aynı sipariş-renk için gelen tekrar satırlarında daha yeni satırın statüsü boşsa, önceki dolu operasyon durumu korunur.', en: 'For duplicate order-colour rows, a blank status on a newer row no longer overwrites an earlier populated operational status.' },
      { tr: 'ASAS ve Antrepo renk tanımları birebir eşleşmediğinde önce noktalama ve boşluk farkları tolere edilir; sipariş bazlı eşleştirme yalnız bütün Antrepo satırları aynı statüyü gösteriyorsa yapılır.', en: 'When ASAS and bonded-warehouse colour descriptions do not match exactly, punctuation and spacing differences are tolerated first; order-level fallback is used only when all bonded-warehouse rows agree on the same status.' },
      { tr: 'CP, Genel Bakış, Backlog ve yenileme değişiklik özeti aynı güvenli Antrepo eşleştirme kuralını kullanır.', en: 'CP, Overview, Backlog and refresh change summaries now use the same safe bonded-warehouse matching rule.' }
    ]
  },
  {
    v: '4.07', date: '2026-08-02',
    title: { tr: 'Trial sırasında Marka Müdürlükleri filtresi devre dışı', en: 'Brand Directorate filter disabled during Trial' },
    items: [
      { tr: 'LFL Trial aktif edildiğinde Marka Müdürlükleri seçimi otomatik olarak Tümü durumuna alınır ve önceki seçim temizlenir.', en: 'When LFL Trial is activated, the Brand Directorate selection is automatically reset to All and any previous selection is cleared.' },
      { tr: 'Marka Müdürlükleri filtre butonu Trial açıkken karartılır ve seçime kapatılır; Trial kapatıldığında yeniden kullanılabilir olur.', en: 'The Brand Directorate filter button is dimmed and disabled while Trial is active, and becomes available again when Trial is turned off.' },
      { tr: 'Trial açıkken Marka Müdürlüğü filtresi ana analizde ve karşılaştırma hesaplarında uygulanmaz; diğer LFL filtreleri normal şekilde çalışmaya devam eder.', en: 'While Trial is active, Brand Directorate filtering is ignored in the main analysis and comparison calculations; all other LFL filters continue to work normally.' }
    ]
  },
  {
    v: '4.06', date: '2026-08-02',
    title: { tr: 'Quotation durum sınıflandırması ve kayıt bazlı düzenleme yetkisi', en: 'Quotation status classification and record-level editing permission' },
    items: [
      { tr: 'Quotation kayıtları Devam ediyor ve Kapandı olarak sınıflandırılabilir. Kapanan kayıtlar silinmez, varsayılan listeden gizlenir ve Kapandı veya Tümü görünümünden yeniden açılabilir.', en: 'Quotation records can be classified as In progress or Closed. Closed records are retained, hidden from the default list and accessible from the Closed or All view.' },
      { tr: 'Tüm kullanıcılar diğer kullanıcıların oluşturduğu quotation kayıtlarını görüntüleyebilir. Kayıt sahibi ve Moderatör dışındaki kullanıcılar varsayılan olarak yalnız görüntüleme yetkisine sahiptir.', en: 'All users can view quotations created by other users. Users other than the owner and Moderator have view-only access by default.' },
      { tr: 'Kayıt sahibi, quotation detayındaki Düzenleme Yetkisi ekranından belirli kullanıcılara kayıt bazında düzenleme yetkisi verebilir veya bu yetkiyi kaldırabilir.', en: 'The owner can grant or revoke record-level editing permission for selected users from the Editing Permission dialog in quotation details.' },
      { tr: 'Quotation kayıtları sunucuda ortak ve yetki kontrollü olarak saklanır. Eski tarayıcı kayıtları ilk açılışta güvenli biçimde ortak depoya taşınır.', en: 'Quotation records are stored in a shared, permission-controlled server store. Legacy browser records are migrated safely to the shared store on first launch.' },
      { tr: 'Kapalı quotation içerikleri kazara değişikliklere karşı kilitlenir; yeniden düzenlemek için durumun Devam ediyor yapılması gerekir.', en: 'Closed quotation content is locked against accidental changes and must be reopened before editing.' }
    ]
  },
  {
    v: '4.05', date: '2026-08-02',
    title: { tr: 'Trial değerleri LFL filtre seçeneklerine eklendi', en: 'Trial values added to LFL filter options' },
    items: [
      { tr: 'Trial aktifken yalnız Trial modellerinde bulunan In-Store ayı, MAG, MMYG, Marka Müdürlüğü, Klasman, ülke, üretici, Buying Group ve Buyer değerleri ana LFL filtre listelerinde seçilebilir hâle gelir.', en: 'When Trial is active, In-Store month, MAG, MMYG, Brand Directorate, Classification, country, manufacturer, Buying Group and Buyer values found only in Trial models become selectable in the main LFL filter lists.' },
      { tr: 'Trial güncel döneme ait olduğu için Trial ayları yalnız Güncel In-Store filtresine eklenir; Kıyas In-Store seçenekleri gerçek kıyas dönemi verisinden gelmeye devam eder.', en: 'Because Trial belongs to the current period, Trial months are added only to the Current In-Store filter; Comparison In-Store options continue to come from actual comparison-period data.' },
      { tr: 'Filtre seçenekleri aktif diğer filtreler Trial satırını geçici olarak dışarıda bıraksa bile Trial değerlerini korur; seçilen değerler analizde normal LFL filtre mantığıyla uygulanır.', en: 'Filter options retain Trial values even when other active filters temporarily exclude the Trial row; selected values are applied using the normal LFL filtering logic in analysis.' },
      { tr: 'Bağımsız Comparison senaryolarının güncel dönem ay ve portföy seçimleri de aktif Trial değerlerini içerir.', en: 'Current-period month and portfolio selectors in independent Comparison scenarios also include active Trial values.' }
    ]
  },
  {
    v: '4.04', date: '2026-08-02',
    title: { tr: 'Trial modelleri aktif LFL filtrelerine bağlandı', en: 'Trial models now follow active LFL filters' },
    items: [
      { tr: 'Trial modelleri artık gerçek LFL satırlarıyla aynı sezon, In-Store ayı, MAG, MMYG, Marka Müdürlüğü, Klasman, Ülke, Üretici, Buying Group ve Buyer filtrelerinden geçer.', en: 'Trial models now pass through the same season, In-Store month, MAG, MMYG, Brand Directorate, Classification, Country, Manufacturer, Buying Group and Buyer filters as actual LFL rows.' },
      { tr: 'Aktif filtreyle eşleşmeyen Trial modelleri Trial sepetinde korunur ancak analiz, kırılım, karşılaştırma, KPI ve Excel çıktısına dahil edilmez; filtre değiştirildiğinde otomatik olarak yeniden değerlendirilir.', en: 'Trial models that do not match the active filter remain in the Trial basket but are excluded from analysis, breakdowns, comparisons, KPIs and Excel exports; they are reevaluated automatically when filters change.' },
      { tr: 'Çok Boyutlu Karşılaştırma ve bağımsız Comparison senaryolarındaki Trial filtre atlama davranışı da kaldırıldı.', en: 'The Trial filter bypass was also removed from multi-dimensional comparisons and independent Comparison scenarios.' }
    ]
  },
  {
    v: '4.03', date: '2026-08-02',
    title: { tr: 'Trial uygulama ve düzeltme kaydı ayrıldı', en: 'Trial application separated from correction saving' },
    items: [
      { tr: 'Simulation Basket Check altındaki Düzeltmeleri kaydet ve Trial’ı uygula işlemleri iki bağımsız butona ayrıldı.', en: 'Save corrections and Apply Trial are now independent actions in Simulation Basket Check.' },
      { tr: 'Trial, ekrandaki geçici düzeltmeler Koleksiyon’a yazılmadan LFL analizine uygulanabilir; kaydetme yalnız kullanıcı Düzeltmeleri kaydet dediğinde yapılır.', en: 'Trial can use temporary on-screen corrections in LFL without writing them to Collection; persistence occurs only when Save corrections is selected.' },
      { tr: 'Koleksiyon görüntüleme modunda dahi geçici düzeltme ve otomatik öneri Trial için kullanılabilir; yalnız kalıcı kaydetme devre dışı kalır.', en: 'Temporary edits and auto suggestions remain available for Trial in view-only Collection mode; only permanent saving is disabled.' }
    ]
  },
  {
    v: '4.02', date: '2026-08-01',
    title: { tr: 'Eski analiz kalıntıları temizlendi', en: 'Retired analysis remnants removed' },
    items: [
      { tr: 'Kullanılmayan eski analiz Excel yükleyicisi, sütun kataloğu, seçim/sıralama durumları ve tablo filtre dalları kaldırıldı.', en: 'The unused legacy analysis workbook loader, column catalogue, selection/sort state and table-filter branches were removed.' },
      { tr: 'Genel Bakış ve Backlog tarafından kullanılan gerekli veri akışı tarafsız bir sipariş özeti olarak yeniden adlandırıldı; mevcut işlevler korunarak eski özellik adı koddan çıkarıldı.', en: 'The data flow still required by Overview and Backlog was renamed to a neutral order summary, preserving behavior while removing the retired feature name from the code.' }
    ]
  },
  {
    v: '4.01', date: '2026-08-01',
    title: { tr: 'Simulation Basket görünümü', en: 'Simulation Basket visibility' },
    items: [
      { tr: 'Üretici, Trial doğrulamasında zorunlu katalog alanı olmaktan çıkarıldı. Koleksiyonda üreticisi boş modeller sanal Trial üreticisiyle analize alınır ve üretici için düzeltme uyarısı oluşturulmaz.', en: 'Manufacturer is no longer a mandatory catalog field in Trial validation. Collection models with no manufacturer are analyzed with the synthetic Trial manufacturer and never receive a manufacturer correction warning.' },
      { tr: 'Düzeltme gerekli ve Aktif filtre dışında sekmelerinin sayaçları dolu olduğu hâlde içerik alanının boş kalmasına yol açan template tabanlı çizim kaldırıldı; sekmeler doğrudan ve doğrulamalı içerik çizimi kullanıyor.', en: 'The template-based rendering path that could leave Needs correction and Outside active filter blank despite non-zero counters was removed; tabs now use direct, verified content rendering.' },
      { tr: 'Simulation Basket sekmeleri fare, dokunma ve klavye ile seçilebilir hâle getirildi; uzun model listeleri doğal olarak aşağı uzar ve görünür kalır.', en: 'Simulation Basket tabs can now be selected with mouse, touch or keyboard; long model lists grow naturally downward and remain visible.' },
      { tr: 'Dar ekran düzeni eklenerek tablo ve modallerin küçük pencerelerde taşmadan kullanılabilmesi sağlandı.', en: 'A narrow-screen layout was added so tables and modals remain usable in smaller windows.' }
    ],
  },
  {
    v: '4.00', date: '2026-08-01',
    title: { tr: 'Simulation Basket Check yeniden oluşturuldu', en: 'Simulation Basket Check rebuilt' },
    items: [
      { tr: 'Toplam model, Hazır, Düzeltme gerekli ve Aktif filtre dışında sayaçları tıklanabilir sekmelere dönüştürüldü; her sekme kendi model listesini anında gösteriyor.', en: 'Total models, Ready, Needs correction and Outside active filter counters are now clickable tabs, and each tab immediately displays its own model list.' },
      { tr: 'Düzeltme gereken modeller hata başlıkları altında listelenmeye devam ediyor. Hata başlığındaki Otomatik Öneri, yalnız o hataya sahip tüm modelleri topluca revize ediyor.', en: 'Models requiring correction remain grouped under error headings. Auto Suggestion in an error heading revises every model with that specific error in one operation.' },
      { tr: 'Model listesi önce çiziliyor, öneriler arayüzü kilitlemeden parça parça hesaplanıyor. Böylece sepet büyüdüğünde boş ekran oluşmuyor ve sekmeler her zaman kullanılabiliyor.', en: 'The model list is rendered first and suggestions are calculated incrementally without blocking the interface, preventing blank screens and keeping the tabs usable as the basket grows.' },
      { tr: 'LFL doğrulama katalogları ve öneri eşleşme indeksleri veri yüklemesi başına bir kez hazırlanıyor; her model için bütün veri kaynağının tekrar taranması kaldırıldı.', en: 'LFL validation catalogs and suggestion matching indexes are prepared once per data load, eliminating repeated full-source scans for every model.' },
      { tr: 'Aktif filtre dışında kalan geçerli modeller yalnız bilgilendirme sekmesinde gösteriliyor, Koleksiyon verileri değiştirilmeden Trial analizine dahil edilmeye devam ediyor.', en: 'Valid models outside active filters appear only in the informational tab and continue to be included in Trial analysis without changing Collection data.' },
      { tr: 'Pencere ve model listesi doğal olarak aşağı doğru uzuyor; dış katman kaydırması ve sabit işlem çubuğu uzun sepetlerde içeriklerin iç içe geçmesini önlüyor.', en: 'The dialog and model list grow naturally downward; overlay scrolling and a sticky action bar prevent content overlap in long baskets.' }
    ],
  },
  {
    v: '3.99', date: '2026-08-01',
    title: { tr: 'Simulation Basket veri doğrulaması ve filtre dışı Trial akışı', en: 'Simulation Basket data validation and out-of-filter Trial flow' },
    items: [
      { tr: 'Simulation Basket listesi sabit ekran yüksekliğine sıkıştırılmıyor; model sayısı arttıkça pencere aşağı doğru uzuyor ve dış katman üzerinden kaydırılıyor.', en: 'The Simulation Basket list is no longer compressed into a fixed viewport height; the dialog grows downward as models increase and scrolls through the outer overlay.' },
      { tr: 'Düzeltme gereken modeller hata türüne göre gruplandı. Her hata başlığındaki Otomatik Öneri düğmesi, yalnız o hata grubundaki tüm modeller için en yakın geçerli veritabanı değerini uygular.', en: 'Models needing correction are grouped by error type. The Auto Suggestion button in each error heading applies the closest valid database value to every model in that error group only.' },
      { tr: 'Aktif LFL filtresi dışında kalan fakat verisi doğru modeller artık düzeltme hatası sayılmıyor, öneriyle değiştirilmiyor ve Koleksiyon verisine yazılmıyor; ayrı bir bilgilendirme bölümünde gösteriliyor.', en: 'Models with valid data that fall outside active LFL filters are no longer treated as correction errors, changed by suggestions or written back to Collection; they appear in a separate information section.' },
      { tr: 'Koleksiyondan Trial’a gönderilen modeller MAG, MMYG, Klasman, Buyer, Buying Group, ülke, üretici, Marka Müdürlüğü veya ay filtresiyle eşleşmese bile güncel dönem Trial analizine dahil ediliyor.', en: 'Models sent from Collection to Trial are included in the current-period Trial analysis even when they do not match MAG, MMYG, Classification, Buyer, Buying Group, country, manufacturer, Brand Directorate or month filters.' },
      { tr: 'MAG gibi metin alanları yalnız gerçek LFL veritabanındaki katalogla doğrulanıyor. CU3W gibi veritabanında olmayan veya yazım hatalı değerler uyarılıyor; öneri aktif filtreye göre değil en yakın geçerli veritabanı değerine göre hazırlanıyor.', en: 'Text fields such as MAG are validated only against the real LFL database catalog. Missing or mistyped values such as CU3W are flagged, and suggestions are based on the closest valid database value rather than the active filter.' }
    ],
  },
  {
    v: '3.98', date: '2026-08-01',
    title: { tr: 'Simulation Basket yalnız uyumsuz modeller için sadeleştirildi', en: 'Simulation Basket simplified to show only incompatible models' },
    items: [
      { tr: 'Simulation Basket içindeki Koleksiyon kataloğu ve tüm hazır model kartları kaldırıldı; modeller Koleksiyon sayfasından seçilmeye devam ediyor.', en: 'The Collection catalog and all ready-model cards were removed from Simulation Basket; models continue to be selected from the Collection page.' },
      { tr: 'Sepette yalnız eksik, geçersiz veya aktif LFL kapsamıyla uyumsuz modeller listeleniyor. Uyumlu modeller yalnız hazır model sayısında gösteriliyor.', en: 'Only models with missing, invalid or active-LFL-scope mismatches are listed. Compatible models are represented only in the ready-model count.' },
      { tr: 'Her uyumsuz modelde tüm alanlar yerine yalnız düzeltilmesi gereken alanlar açılıyor; düzeltme tamamlandığında kart otomatik olarak listeden kalkıyor.', en: 'Each incompatible model exposes only the fields that need correction, and its card automatically leaves the list once corrected.' },
      { tr: 'Toplam, hazır ve düzeltme gereken model sayaçları ile sabit işlem çubuğu eklenerek çok satırlı sepetlerde veri sıkışması giderildi.', en: 'Total, ready and needs-correction counters plus a fixed action bar eliminate data compression in large baskets.' },
      { tr: 'Her uyumsuz alan için aktif filtre, aynı MAG/MMYG, Buyer, Buying Group, ülke, üretici ve benzer LFL satırları birlikte değerlendirilerek en mantıklı düzeltme öneriliyor; öneri tek tek, model bazında veya topluca uygulanabiliyor.', en: 'Each incompatible field receives a best-fit suggestion based on the active filter, matching MAG/MMYG, Buyer, Buying Group, country, manufacturer and similar LFL rows; suggestions can be applied individually, per model or all at once.' },
      { tr: 'Kullanıcının onayladığı Trial düzeltmeleri simülasyonla birlikte ilgili Koleksiyon satırına da tek geri-alınabilir işlem olarak kaydediliyor; Koleksiyon yalnız görüntülenebilir durumdaysa veri yazımı engelleniyor.', en: 'Approved Trial corrections are saved to the matching Collection row together with the simulation as one undoable operation; writes are blocked when Collection is view-only.' }
    ],
  },
  {
    v: '3.97', date: '2026-08-01',
    title: { tr: 'Trial aç/kapa kontrolü ve Koleksiyon Klasman doğrulaması', en: 'Trial on/off control and Collection Classification validation' },
    items: [
      { tr: 'LFL üst şeridindeki Trial kontrolü çift yönlü hâle getirildi. Trial kapatıldığında simülasyon sepeti silinmiyor; analiz gerçek veriye dönüyor ve aynı düğmeyle yeniden açılabiliyor.', en: 'The Trial control in the LFL banner is now bidirectional. Turning Trial off preserves the simulation basket, returns the analysis to real data and allows it to be turned on again with the same button.' },
      { tr: 'Koleksiyon Category alanı yalnız LFL kaynağındaki kayıtlı Klasman seçeneklerini kabul ediyor. Liste dışındaki serbest girişler kaydedilmiyor ve önceki değer güvenli biçimde korunuyor.', en: 'The Collection Category field now accepts only registered Classification options from the LFL source. Free-text values outside the list are not saved and the previous value is safely preserved.' },
      { tr: 'LFL Klasman kataloğu henüz yüklenmemişse Category hücresi açıldığında arka planda yükleniyor; kullanıcı kayıtlı seçenekleri popup içinde arayıp seçebiliyor.', en: 'If the LFL Classification catalog has not loaded yet, it is loaded in the background when a Category cell is opened, allowing the user to search and select registered options from the popup.' }
    ],
  },
  {
    v: '3.96', date: '2026-08-01',
    title: { tr: 'LFL Trial sonrası analiz performansı hızlandırıldı', en: 'LFL analysis performance accelerated after Trial' },
    items: [
      { tr: 'Trial modellerinin oluşturduğu yeni kırılım gruplarında tüm LFL satırlarının her grup için yeniden taranmasına neden olan katlanarak büyüyen hesap kaldırıldı; gruplar artık tek geçişte hazırlanıyor.', en: 'The compounding calculation that rescanned all LFL rows for every new breakdown group created by Trial models was removed; groups are now prepared in a single pass.' },
      { tr: 'Ülke, MAG, MMYG, Buyer, Buying Group ve diğer filtre kimlikleri satır bazında önbelleğe alındı; aynı metin normalizasyonları her tablo ve özet hesabında tekrar yapılmıyor.', en: 'Country, MAG, MMYG, Buyer, Buying Group and other filter identities are cached per row, avoiding repeated text normalization in every table and summary calculation.' },
      { tr: 'Trial modeli hazırlanırken LFL boyut adlarını bulmak için tüm gerçek veri kümesini tekrar tekrar tarayan arama, sabit zamanlı indeks yapısına taşındı.', en: 'The repeated full-dataset lookup used to resolve LFL dimension labels while preparing Trial models was replaced with a constant-time index.' },
      { tr: 'Trial Studio ay seçenekleri her model kartında yeniden üretilmek yerine tek kez hesaplanıyor; çok sayıda model içeren simülasyon sepetleri daha akıcı açılıyor ve düzenleniyor.', en: 'Trial Studio month options are computed once instead of once per model card, making large simulation baskets smoother to open and edit.' }
    ],
  },
  {
    v: '3.95', date: '2026-08-01',
    title: { tr: 'LFL Trial eşleşmesi ve Koleksiyon veri girişi düzeltildi', en: 'LFL Trial matching and Collection data entry fixed' },
    items: [
      { tr: 'Trial aktarımında boş değerlerin 0 kabul edilmesi nedeniyle Quantity ve FOB bilgilerinin kaybolması giderildi; değerler artık Koleksiyon satırından doğru biçimde alınıyor.', en: 'Quantity and FOB values no longer disappear because empty values were treated as zero; they are now read correctly from the Collection row.' },
      { tr: 'Trial fiyatı Confirmed Price, yoksa Best Price, yoksa Target Price sırasıyla seçiliyor ve merkezi Koleksiyon formülüyle Royalty ile Hologram Cost dahil edilerek LFL FOB üretiliyor.', en: 'Trial pricing now selects Confirmed Price, then Best Price, then Target Price and produces LFL FOB with Royalty and Hologram Cost through the central Collection formula.' },
      { tr: 'India/HİNDİSTAN gibi ülke adları ile büyük-küçük harf, Türkçe karakter, boşluk ve noktalama farkları aynı filtre değeri olarak değerlendiriliyor.', en: 'Country aliases such as India/HİNDİSTAN and differences in case, Turkish characters, spacing and punctuation are treated as the same filter value.' },
      { tr: 'Koleksiyon Trial satırları Marka Müdürlüğü filtresine takılmıyor; üretici boşsa Trial olarak tamamlanıyor.', en: 'Collection trial rows are not blocked by the Brand Directorate filter; an empty manufacturer is completed as Trial.' },
      { tr: 'Koleksiyon MAG, MMYG, Buyer, Buying Group, Category ve In Store Month hücrelerine sistemdeki kayıtlı değerleri gösteren seçim popup’ları eklendi. Yeni modellerde MAG, MMYG ve Buyer kullanıcı profilinden otomatik geliyor.', en: 'Selection popups with registered system values were added to Collection MAG, MMYG, Buyer, Buying Group, Category and In Store Month cells. New models receive MAG, MMYG and Buyer from the user profile automatically.' }
    ],
  },
  {
    v: '3.94', date: '2026-08-01',
    title: { tr: 'LFL Trial Studio baştan kuruldu', en: 'LFL Trial Studio rebuilt from scratch' },
    items: [
      { tr: 'Koleksiyonda seçilen modeller artık doğrudan LFL Trial simülasyon sepetine gönderilebiliyor; gerçek sipariş, CP ve Koleksiyon verileri değiştirilmeden analiz ediliyor.', en: 'Models selected in Collection can now be sent directly to the LFL Trial simulation basket and analysed without changing real order, CP or Collection data.' },
      { tr: 'Her trial modelinde adet, LFL FOB, In-Store ayı ve portföy alanları uygulanmadan önce düzenlenip doğrulanıyor; eksik veya aktif filtre dışında kalan kayıtlar sessizce kaybolmak yerine açıkça gösteriliyor.', en: 'Quantity, LFL FOB, In-Store month and portfolio fields can be edited and validated before applying each trial model; missing or out-of-scope records are shown instead of disappearing silently.' },
      { tr: 'Mevcut gerçek LFL, simülasyon sonrası LFL ve net trial etkisi ayrı sonuçlar olarak gösteriliyor. Trial satırları detaylarda ve Excel çıktısında açıkça işaretleniyor.', en: 'Current real LFL, simulated LFL and net trial impact are shown separately. Trial rows are clearly marked in details and Excel exports.' },
      { tr: 'Siparişe dönüşmüş veya iptal edilmiş Koleksiyon modelleri trial sepetine yeniden eklenmiyor; simülasyon oturumu temizlenebiliyor ve gerçek veri kaynağına hiçbir kayıt yazılmıyor.', en: 'Collection models already converted to orders or cancelled are not added again; the simulation session can be cleared and no records are written to the real data source.' },
      { tr: 'Koleksiyonun YYYYMM ay biçimi ile LFL\'nin YYYY-MM biçimi arasındaki uyumsuzluk giderildi; trial satırlarının ay filtresinde görünmeden kaybolması önlendi.', en: 'The mismatch between Collection YYYYMM and LFL YYYY-MM month formats was fixed, preventing trial rows from disappearing under month filters.' }
    ],
  },
  {
    v: '3.93', date: '2026-07-31',
    title: { tr: 'LFL Trial baştan kuruldu', en: 'LFL Trial rebuilt' },
    items: [
      { tr: 'Trial satırlarına artık koleksiyonun kendi sezonu değil, LFL\'de seçili olan güncel sezon ve ay veriliyor. Önceki sürümlerde koleksiyon sezonu LFL verisinde bulunmadığı için satırlar eklendikten sonra sezon süzgecine takılıp rapora hiç girmiyordu.', en: 'Trial rows are now given the current season and month selected in LFL rather than the season of the collection. In earlier versions the collection season did not exist in the LFL data, so rows were filtered out by the season filter and never entered the report.' },
      { tr: 'Trial açıkken analiz sayfasının üstünde kaç modelin sipariş gibi sayıldığını gösteren bir şerit çıkıyor; oradan tek tıkla kapatılabiliyor.', en: 'While Trial is on, a banner at the top of the analysis page shows how many models are being counted as orders, and it can be switched off from there with a single click.' },
      { tr: 'Modelin koleksiyondaki kendi sezonu tabloda ayrı bir sütun olarak görünüyor, böylece hangi sezondan alındığı kaybolmuyor.', en: 'The season the model has in the collection is shown as a separate column in the table, so it is not lost.' },
      { tr: 'Sezon artık zorunlu alan değil: koleksiyon sezonu boş olan modeller de denemeye alınabiliyor.', en: 'Season is no longer a required field, so models with an empty collection season can also be included in a trial.' }
    ],
  },
  {
    v: '3.92', date: '2026-07-31',
    title: { tr: 'LFL Trial: sezon listesi, sütun filtreleri ve başlık düzeltmesi', en: 'LFL Trial: season list, column filters and header fix' },
    items: [
      { tr: 'Trial\'in çalışmama sebebi bulundu: LFL sezon listesi yalnız sunucu verisinden kuruluyordu, bu yüzden trial modellerinin sezonu listede hiç yer almıyor ve seçilemiyordu. Sezon listesi artık sunucu verisi ile mevcut satırların birleşimi.', en: 'The reason Trial did not work was found: the LFL season list was built only from server data, so the season of trial models never appeared in the list and could not be selected. The season list is now the union of server data and the current rows.' },
      { tr: 'Uygula sonrası trial satırlarının hiçbiri seçili sezona girmiyorsa ve hepsi tek bir sezona aitse, o sezona otomatik geçiliyor.', en: 'After Apply, if none of the trial rows fall into the selected season and they all belong to a single season, that season is selected automatically.' },
      { tr: 'Trial tablosuna sütun filtreleri eklendi; başlığın altındaki satırdan her sütun kendi değer listesinden süzülebiliyor.', en: 'Column filters were added to the Trial table; each column can be filtered from its own value list in the row beneath the header.' },
      { tr: 'Kaydırma sırasında satırların sütun başlıklarının üstünde görünmesine yol açan boşluk giderildi. Başlık ve filtre satırı artık düzgün sabitleniyor.', en: 'The gap that made rows appear above the column headers while scrolling was removed. The header and filter row now stay fixed correctly.' }
    ],
  },
  {
    v: '3.91', date: '2026-07-31',
    title: { tr: 'Fiyat Geçmişi adedi, onaylı hücre boyaması ve giriş ekranı', en: 'Pricing History quantity, approved cell fill and sign-in screen' },
    items: [
      { tr: 'Fiyat Geçmişinde adet her zaman 0 görünüyordu: boş bir adet sayıya çevrildiğinde sıfır oluyor ve geçerli sayılıp yedek değere düşülmüyordu. Boş adet artık açıkça yok sayılıyor.', en: 'Quantity always appeared as zero in Pricing History: an empty quantity became zero when converted to a number and was treated as valid, so the fallback value was never used. An empty quantity is now treated as missing.' },
      { tr: 'Fiyat Geçmişi Excel çıktısında onaylanan fiyatların hücreleri yumuşak yeşille boyanıyor (fiyat ve yüzde birlikte).', en: 'In the Pricing History Excel export, cells of approved prices are filled with a soft green, covering both the price and the percentage.' },
      { tr: 'Koleksiyon araç çubuğundaki seçime bağlı düğmeler seçim yokken CP sayfasındaki gibi karartılıyor.', en: 'Selection-dependent buttons on the Collection toolbar are now dimmed when nothing is selected, matching the CP page.' },
      { tr: 'Giriş ekranındaki işlevsiz "Şifre tekrar" alanı kaldırıldı. İlk kurulumda en az 6 karakter kuralı korunuyor.', en: 'The non-functional Confirm password field was removed from the sign-in screen. The minimum of six characters still applies on first setup.' }
    ],
  },
  {
    v: '3.90', date: '2026-07-31',
    title: { tr: 'LFL Trial: tablo görünümü, aç/kapa anahtarı ve FOB hesabı', en: 'LFL Trial: table view, on/off switch and FOB calculation' },
    items: [
      { tr: 'Uygula düğmesi satırları ekliyordu ancak seçili sezon ve In-Store ay süzgecine takıldıkları için raporda hiçbir değişiklik görünmüyordu. Artık kaç trial satırının güncel analize girdiği pencerede ve bildirimde yazıyor; hiçbiri girmiyorsa satırların hangi sezona ait olduğu belirtiliyor.', en: 'The Apply button was adding rows, but they were filtered out by the selected season and In-Store month, so nothing appeared to change. The window and the notification now state how many trial rows entered the current analysis, and which season they belong to when none do.' },
      { tr: 'Pencerenin sağ üst köşesine aç/kapa anahtarı eklendi: açıkken seçili koleksiyon modelleri LFL sayfasına girer, kapatıldığında anında çıkar.', en: 'An on/off switch was added to the top right of the window: while on, the selected collection models enter the LFL page and they are removed immediately when it is switched off.' },
      { tr: 'Pencere tablo düzenine geçti: sıralanabilir başlıklar, arama, toplu seçim ve sabit başlık satırı. In-Store ayı sütunu da eklendi.', en: 'The window now uses a table layout with sortable headers, search, bulk selection and a fixed header row. An In-Store Month column was also added.' },
      { tr: 'Trial FOB\'u artık royalty ve hologram maliyeti dahil hesaplanıyor (fiyat / (1 − royalty%) + hologram), böylece LFL ağırlıklı ortalamasına gerçek FOB ile giriyor.', en: 'The trial FOB now includes royalty and hologram cost (price divided by one minus royalty, plus hologram), so it enters the LFL weighted average as a real FOB.' }
    ],
  },
  {
    v: '3.89', date: '2026-07-31',
    title: { tr: 'LFL Trial düzeltmeleri ve Koleksiyon sütun değişiklikleri', en: 'LFL Trial fixes and Collection column changes' },
    items: [
      { tr: 'Trial penceresinde seçimler artık anında görünüyor. Seçim yerel tutuluyor ve rapora ancak Uygula düğmesiyle işleniyor; düğme kaç modelin ekleneceğini yazıyor.', en: 'Selections in the Trial window are now visible immediately. The selection is kept locally and applied to the report only with the Apply button, which states how many models will be added.' },
      { tr: 'Üretici bilgisi olmayan koleksiyon modelleri de Trial\'a alınabiliyor; bu satırlarda üretici adı Trial olarak geçiyor.', en: 'Collection models without a manufacturer can now be included in Trial; the manufacturer is recorded as Trial on those rows.' },
      { tr: 'Koleksiyon tablosundaki Classification sütunu kaldırıldı. Klasman bilgisi Category sütunundan alınıyor.', en: 'The Classification column was removed from the Collection table. The classification is taken from the Category column.' },
      { tr: 'In Store Month hücresi AY YIL biçiminde gösteriliyor (ŞUBAT 2027 · FEBRUARY 2027). Ne yazılırsa yazılsın bu biçime çevriliyor ve LFL Trial ay bilgisini buradan alıyor.', en: 'The In Store Month cell is shown as MONTH YEAR (FEBRUARY 2027). Whatever is typed is converted to this format, and LFL Trial takes the month from it.' },
      { tr: 'In Store tarihi boş olan modeller de Trial\'a girebiliyor: ayın ilk günü kullanılıyor.', en: 'Models with an empty In Store date can also enter Trial; the first day of the month is used.' }
    ],
  },
  {
    v: '3.88', date: '2026-07-31',
    title: { tr: 'LFL sayfası düzeltildi', en: 'LFL page fixed' },
    items: [
      { tr: 'v3.87\'de Trial düğmesi filtre ızgarasının içine ekleniyor ve ızgaradaki tüm filtre alanlarını bir hücre kaydırıyordu. Düğme artık eylem düğmelerinin yanında, sabit yerinde duruyor; filtre alanları eski düzenine döndü.', en: 'In v3.87 the Trial button was inserted into the filter grid and shifted every filter field by one cell. The button now sits in its own fixed place next to the action buttons and the filter fields are back to their original layout.' },
      { tr: 'Trial düğmesinin bağlanması artık LFL kurulumunun en sonunda ve kendi hatasını yutarak yapılıyor; bir sorun çıksa bile filtre düğmeleri çalışmaya devam eder.', en: 'The Trial button is now bound at the very end of the LFL setup and swallows its own errors, so the filter buttons keep working even if something goes wrong.' }
    ],
  },
  {
    v: '3.87', date: '2026-07-31',
    title: { tr: 'LFL Trial', en: 'LFL Trial' },
    items: [
      { tr: 'LFL sayfasına Trial düğmesi eklendi: siparişe dönmemiş koleksiyon modelleri sipariş gibi sayılıp rapora dahil edilebiliyor, olası LFL sonucu görülebiliyor.', en: 'A Trial button was added to the LFL page: collection models that have not become orders can be counted as if they had and included in the report, so the possible LFL outcome can be seen.' },
      { tr: 'Modeller tek tek seçilebilir, tümü tek tıkla eklenip çıkarılabilir. Trial kapatıldığında rapor anında gerçek veriye döner; sunucudan gelen gerçek satırlar hiçbir zaman değiştirilmez.', en: 'Models can be selected individually and all of them added or removed with a single click. When Trial is switched off the report returns to real data immediately, and the real rows from the server are never modified.' },
      { tr: 'Adet koleksiyondaki adet alanından, fiyat ise sırasıyla onaylı teklif, best price ve hedef fiyattan alınır; hangi kaynağın kullanıldığı listede yazar.', en: 'The quantity comes from the collection quantity field and the price from the approved quote, then best price, then target price; the list shows which source was used.' },
      { tr: 'LFL için zorunlu alanlardan biri eksik olan veya adedi ya da fiyatı olmayan modeller sessizce düşürülmez; hangi alanın eksik olduğu ayrı bir listede gösterilir.', en: 'Models missing one of the fields LFL requires, or lacking a quantity or a price, are not dropped silently; a separate list shows which field is missing.' }
    ],
  },
  {
    v: '3.86', date: '2026-07-31',
    title: { tr: 'Koleksiyona LFL boyut sütunları', en: 'LFL dimension columns added to Collection' },
    items: [
      { tr: 'Koleksiyon tablosuna MAG, MMYG, Klasman, Buying Group ve Buyer sütunları eklendi. Bu beş alan LFL raporunun zorunlu kırılımları; siparişe dönmemiş bir modelin LFL Trial\'a girebilmesi için Koleksiyon tarafında taşınmaları gerekiyor.', en: 'MAG, MMYG, Classification, Buying Group and Buyer columns were added to the Collection table. These five fields are required breakdowns of the LFL report and must be carried on the Collection side before a model that has not become an order can enter LFL Trial.' },
      { tr: 'Yeni sütunlar Excel dışa/içe aktarımına kendiliğinden dahil olur; mevcut kayıtlarda boş olarak açılır ve hiçbir eski veri değişmez.', en: 'The new columns are automatically included in Excel export and import; on existing records they start empty and no existing data is changed.' }
    ],
  },
  {
    v: '3.85', date: '2026-07-31',
    title: { tr: 'Bağımsız LFL senaryolarında sabit filtre kapsamı', en: 'Frozen filter scope for independent LFL scenarios' },
    items: [
      { tr: '“Aktif ana filtreleri temel al” seçeneği yeni karşılaştırmalarda varsayılan olarak kapalı gelir.', en: '“Use active main filters” is now disabled by default for new comparisons.' },
      { tr: 'Yeni senaryo oluşturulurken mevcut ana LFL filtreleri senaryonun bağımsız kapsamına kopyalanır; ana filtreler sonradan değişse bile senaryo sonucu değişmez.', en: 'When a new scenario is created, the current main LFL filters are copied into its independent scope, so later main-filter changes do not alter the scenario result.' },
      { tr: 'Canlı ana filtre devralma açıkken kapatılırsa, o anda geçerli olan kapsam senaryoya sabitlenir. Senaryodaki özel seçimler korunur, yalnız boş alanlar ana filtrelerden tamamlanır.', en: 'When live main-filter inheritance is turned off, the effective scope at that moment is frozen into the scenario. Explicit scenario selections are preserved and only empty fields are filled from the main filters.' },
      { tr: 'v3.84 kayıtları yeni kapsama güvenli biçimde taşınır; daha önce canlı devralma kullanan karşılaştırmalar mevcut filtre kapsamını kaybetmeden bağımsız hâle gelir.', en: 'v3.84 records are migrated safely; comparisons that previously used live inheritance become independent without losing their effective filter scope.' }
    ],
  },
  {
    v: '3.84', date: '2026-07-31',
    title: { tr: 'Çok Boyutlu Karşılaştırma: bağımsız dönem ve portföy senaryoları', en: 'Multi-dimensional Comparison: independent period and portfolio scenarios' },
    items: [
      { tr: 'Çok Boyutlu Karşılaştırma, tek bir dönem ve referans satırı mantığından çıkarıldı. Her karşılaştırma artık kendi güncel sezonu, kıyas sezonu ve iki ayrı In-Store ay setiyle bağımsız hesaplanır.', en: 'Multi-dimensional Comparison no longer relies on one shared period and a reference row. Every comparison now calculates independently with its own current season, comparison season and two separate In-Store month sets.' },
      { tr: 'Aynı ekranda A Buying Group Şubat-Mart, A Buying Group Şubat-Nisan, yalnız Nisan veya B Buying Group gibi farklı kapsamlar yan yana kart ve tablo satırı olarak gösterilebilir.', en: 'Different scopes such as Buying Group A February-March, Buying Group A February-April, April only or Buying Group B can be shown side by side as cards and table rows.' },
      { tr: 'Her senaryoda Ülke, MAG, MMYG, Marka Müdürlükleri, Klasman, Üretici, Buying Group ve Buyer alanları çoklu seçilebilir. Aynı alandaki değerler VEYA, farklı alanlar VE mantığıyla uygulanır.', en: 'Country, MAG, MMYG, Brand Directorates, Classification, Manufacturer, Buying Group and Buyer can be multi-selected per scenario. Values within one field use OR, while different fields use AND.' },
      { tr: 'Senaryo filtresi aynı ana LFL filtresinin yerine geçer; diğer ana filtreler isteğe bağlı olarak devralınır. Böylece ana ekranda A seçiliyken ayrı bir senaryoda B Buying Group doğru biçimde hesaplanabilir.', en: 'A scenario filter replaces the matching main LFL filter, while other main filters can optionally be inherited. This allows Buying Group B to be calculated correctly in a separate scenario even when A is selected on the main page.' },
      { tr: 'Ağırlıklı FOB, adet ağırlığıyla hesaplanır; LFL aynı para birimlerini karşılaştırır. Senaryolar çoğaltılabilir, silinebilir, ayrıntıları açılabilir ve bağımsız karşılaştırma tablosu Excel’e aktarılır.', en: 'Weighted FOB uses quantity weights and LFL compares matching currencies. Scenarios can be duplicated, deleted and drilled into, and the independent comparison table is included in Excel export.' }
    ],
  },
  {
    v: '3.83', date: '2026-07-31',
    title: { tr: 'Manuel kullanıcı hesapları, hızlı hiyerarşi yönetimi ve Pricing History alanları', en: 'Manual user accounts, faster hierarchy management and Pricing History fields' },
    items: [
      { tr: 'Kullanıcı hesapları artık kaynak Excel veya sistem isimlerinden oluşturulmuyor. Moderatörler, müdürler ve yetkili ekip liderleri kullanıcı adı, görünen ad ve başlangıç şifresiyle hesap oluşturabiliyor.', en: 'User accounts are no longer created from source Excel files or system names. Moderators, managers and authorized team leads can create accounts with a username, display name and initial password.' },
      { tr: 'Giriş ekranı kullanıcı listesini topluca göstermiyor. Kullanıcı adı yazıldıkça yalnız aynı metinle başlayan en fazla 10 öneri; Title, MAG, MMYG ve Buying Group bilgileriyle birlikte gösteriliyor.', en: 'The sign-in screen no longer renders the full user list. As a username is typed, up to 10 prefix matches are shown together with Title, MAG, MMYG and Buying Group details.' },
      { tr: 'Kullanıcı profilinde Title zorunlu; MAG, MMYG ve Buying Group alanları isteğe bağlı ve çoklu seçimlidir. Bir kullanıcıya birden fazla Buying Group atanabilir.', en: 'Title is required on user profiles; MAG, MMYG and Buying Group are optional multi-value fields. A user can be assigned to multiple Buying Groups.' },
      { tr: 'Hiyerarşi yönetimi hafif kart görünümüne geçirildi. Kullanıcılar rol seviyeleri arasında veya üst yönetici kartlarının üzerine sürüklenebilir; rol taslağı ve devralınan yetkiler yeni konuma göre güncellenir.', en: 'Hierarchy management now uses a lightweight card board. Users can be dragged between role levels or onto supervisor cards; role templates and inherited permissions update for the new position.' },
      { tr: 'Eski kaynak veriden otomatik oluşmuş hesaplar silinmeden pasif hâle getirilir ve giriş önerilerinde görünmez; moderatör tarafından manuel kullanıcı adına, şifreye ve profile dönüştürülebilir.', en: 'Legacy accounts that were generated from source data are preserved but disabled and hidden from sign-in suggestions; a moderator can convert them into manual accounts with a username, password and profile.' },
      { tr: 'Pricing History tablosunda Model Adı öncesine Görsel, Sezon ve In Store Month; sonrasına Quantity eklendi. License sütunu ve filtresi kaldırıldı.', en: 'Pricing History now places Picture, Season and In Store Month before Model Name and Quantity after it. The License column and filter were removed.' }
    ],
  },
  {
    v: '3.82', date: '2026-07-31',
    title: { tr: 'Çok Boyutlu Karşılaştırma: In-Store Ayı ve Marka Müdürlükleri kırılımı', en: 'Multi-dimensional Comparison: In-Store Month and Brand Directorates breakdowns' },
    items: [
      { tr: 'Kırılım listesi filtre alanlarıyla aynı kapsama açıldı: In-Store Ayı ve Marka Müdürlükleri artık kırılım olarak seçilebiliyor.', en: 'The breakdown list now covers the same fields as the filters: In-Store Month and Brand Directorates can be chosen as breakdowns.' },
      { tr: 'In-Store ayı satırlarda YYYYAA kodu olarak tutuluyor; kırılım olarak kullanıldığında ham kod yerine okunur ay adı gösterilir (202602 → Şubat 2026).', en: 'The in-store month is stored as a YYYYMM code; when used as a breakdown it is shown as a readable month name instead of the raw code (202602 becomes February 2026).' },
      { tr: 'İki ayı karşılaştırmak için ayrı bir kip gerekmiyor: iki ay seçilip biri Referans işaretlendiğinde tablodaki Ref. Hacim / Sipariş / FOB Farkı sütunları diğerinin ona göre farkını verir.', en: 'Comparing two months needs no separate mode: select two months and mark one as Reference, and the Volume, Orders and FOB versus Reference columns show the difference of the other against it.' }
    ],
  },
  {
    v: '3.81', date: '2026-07-31',
    title: { tr: 'Fiyat Geçmişi: model bazlı tablo, filtre ve Excel', en: 'Pricing History: model-per-row table, filters and Excel' },
    items: [
      { tr: 'Tablo yeniden düzenlendi: her model tek satır, sütunlarda üreticiler. Her hücrede o üreticinin fiyatı ve hedefe göre yüzde farkı birlikte görünür.', en: 'The table was restructured: one row per model, manufacturers as columns. Each cell shows that manufacturer price together with the percentage difference against target.' },
      { tr: 'Model, PLM ID ve lisansta arama; lisans ve üretici seçimi; yalnız hedefin altındaki fiyatları gösterme filtresi eklendi.', en: 'Search across model, PLM ID and license, license and manufacturer pickers, and a filter for showing only prices at or below target were added.' },
      { tr: 'Üretici sütun başlığına tıklanınca modeller o üreticinin fiyatına göre sıralanır; fiyat vermemiş üreticiler her zaman sona düşer.', en: 'Clicking a manufacturer column header sorts models by that manufacturer price; manufacturers with no quote always sort last.' },
      { tr: 'Tablo Excel olarak dışa aktarılabilir. Aktarım ekranda görüneni verir: aktif filtre ve sıralama korunur, fiyat ve yüzde alanları sayı biçiminde yazılır.', en: 'The table can be exported to Excel. The export reflects what is on screen: the active filter and sorting are preserved, and price and percentage fields are written as numbers.' },
      { tr: 'Üretici e-posta bilgisi tablodan kaldırıldı.', en: 'The manufacturer email column was removed from the table.' }
    ],
  },
  {
    v: '3.80', date: '2026-07-31',
    title: { tr: 'Fiyat Geçmişi ekranı', en: 'Pricing History view' },
    items: [
      { tr: 'Koleksiyon ve CP sayfalarına Fiyat Geçmişi düğmesi eklendi: seçili modellerin bugüne kadar aldığı tüm geçerli fiyatlar, üretici ve e-posta bilgisiyle birlikte tek tabloda görünür.', en: 'A Pricing History button was added to the Collection and CP pages: every valid price the selected models have received so far is shown in one table together with the manufacturer and email.' },
      { tr: 'Tablo varsayılan olarak ucuzdan pahalıya sıralanır; model, üretici, tarih, hedef, fiyat ve hedefe fark sütunlarının başlığına tıklanarak sıralama değiştirilebilir.', en: 'The table is sorted from cheapest to most expensive by default; clicking the model, manufacturer, date, target, price or difference header changes the sorting.' },
      { tr: 'Her satırda o günkü hedef fiyata göre yüzde fark gösterilir; hedefin altındaki fiyatlar yeşil, üstündekiler kırmızı görünür.', en: 'Each row shows the percentage difference against the target price of that day; prices below target appear green and those above appear red.' },
      { tr: 'Yalnız geçerli fiyatlar listelenir: drop edilmiş satırlar ve henüz fiyat girilmemiş talep satırları gösterilmez. Ekran salt okunurdur, hiçbir kaydı değiştirmez.', en: 'Only valid prices are listed: dropped lines and request lines with no price yet are not shown. The view is read-only and changes no records.' }
    ],
  },
  {
    v: '3.79', date: '2026-07-31',
    title: { tr: 'Önce filtre, sonra seçim · kopyalamada beyaz parlama giderildi', en: 'Filter first, then selection · white flash on copy removed' },
    items: [
      { tr: 'E-posta hazırlarken, aktif filtre yüzünden ekranda görünmeyen satırlar işaretli kalmış olsa bile artık e-postaya alınmıyor. Yalnızca hem görünen hem işaretli satırlar işlenir.', en: 'When preparing an email, rows hidden by the active filter are no longer included even if they remained selected. Only rows that are both visible and selected are processed.' },
      { tr: 'Aynı kural CP sayfasındaki tüm toplu işlemler için geçerli: Excel, durum değişikliği ve Koleksiyona kopyalama da gizli satırları almaz.', en: 'The same rule applies to every bulk action on the CP page: Excel, status changes and copy-to-collection also skip hidden rows.' },
      { tr: 'Satırları kopyalarken ekranın bir an bembeyaz olmasının önüne geçildi. Hücre biçimleri okunurken tema hâlâ geçici olarak açığa alınıyor, ancak bu değişim artık mevcut temanın renklerini taşıyan bir perdenin arkasında yapılıyor.', en: 'The momentary white screen when copying rows is gone. The theme is still switched to light while cell formats are read, but the switch now happens behind a curtain that keeps the current theme colours.' }
    ],
  },
  {
    v: '3.78', date: '2026-07-31',
    title: { tr: 'Send to Pricing: ek küçültme yeniden çalışıyor', en: 'Send to Pricing: attachment shrinking works again' },
    items: [
      { tr: 'Model dosyaları yeniden eşit oranda küçültülerek tüm ekler tek bir 9,5 MB e-postaya sığdırılıyor. PDF küçültme motoru yüklenmediği için küçültme sessizce başarısız oluyor, dosyalar numaralı parçalara bölünüp birden fazla taslak oluşturuluyordu.', en: 'Model files are again scaled down proportionally so that all attachments fit into a single 9.5 MB email. The PDF compression engine was not being loaded, so shrinking failed silently and files were split into numbered parts across several drafts.' },
      { tr: 'Küçültülen PDF dosyaları PDF olarak kalır; uzantıları değiştirilmez.', en: 'Compressed PDF files remain PDFs; their extension is not changed.' },
      { tr: 'Küçültme motoru gerçekten yüklenemezse artık sessizce bölmek yerine açık bir hata gösterilir.', en: 'If the compression engine genuinely cannot be loaded, a clear error is now shown instead of silently splitting.' }
    ],
  },
  {
    v: '3.77', date: '2026-07-31',
    title: { tr: 'Açılış hatası giderildi', en: 'Startup failure fixed' },
    items: [
      { tr: 'Uygulama sağlıklı olduğu hâlde "Açılış tamamlanamadı" ekranında kalıyordu: açılış sağlık kontrolü, tasarımdan kaldırılmış eski bir kenar çubuğu öğesini arıyordu. Kontrol artık sayfada gerçekten bulunan öğelere bakıyor.', en: 'The application stayed on the "startup could not be completed" screen although it was healthy: the startup health check was looking for an old sidebar element that had been removed from the design. The check now looks at elements that actually exist.' },
      { tr: 'Açılış başarısız olursa hangi parçanın eksik olduğu hata kaydına yazılır.', en: 'If startup does fail, the log now records which part was missing.' }
    ],
  },
  {
    v: '3.76', date: '2026-07-31',
    title: { tr: 'Kullanıcı rolü ve yetki alanı yönetimi', en: 'User role and access-area management' },
    items: [
      { tr: 'Moderatörler her kullanıcı için rolün yanında erişebileceği modülleri ayrı ayrı belirleyebilir: Overview, CP Tracker, Onaylar, Koleksiyon, LFL, Ön Maliyet, Backlog, Nakliye ve Kaynak Veri.', en: 'Moderators can define each user’s accessible modules separately from their role: Overview, CP Tracker, Approvals, Collection, LFL, Open Costing, Backlog, Shipping and Source Data.' },
      { tr: 'Rol, yetki alanı, işlem yetkisi ve sipariş kapsamı birbirinden ayrıldı; böylece bir kullanıcıya ekran erişimi verilmeden yönetim işlemi veya veri kapsamı açılmaz.', en: 'Role, access area, action permission and order scope are now separate layers, preventing screen access, administration actions or data scope from being granted implicitly.' },
      { tr: 'Ekip Liderleri ve Müdürler, bağlı kullanıcıların yetki alanlarını hiyerarşik olarak devralır; doğrudan ve devralınan alanlar yönetim ekranında ayrı gösterilir.', en: 'Team Leads and Managers inherit the access areas of reporting users hierarchically, with direct and inherited areas shown separately in the administration screen.' },
      { tr: 'Yetkisiz modüller menüden ve global aramadan kaldırılır; Koleksiyon, LFL, Backlog, Nakliye, Ön Maliyet ve Kaynak Veri işlemleri sunucu tarafında da alan kontrolüne tabi tutulur.', en: 'Unauthorised modules are removed from navigation and global search, while Collection, LFL, Backlog, Shipping, Open Costing and Source Data operations are also protected by server-side area checks.' },
      { tr: 'Eski kullanıcı profilleri geriye uyumlu biçimde mevcut tüm alanlarla açılır; moderatör özel alan seçimi yaptığında kısıtlama devreye girer.', en: 'Existing user profiles remain backward compatible with all current areas enabled until a moderator explicitly applies a restricted area selection.' }
    ],
  },
  {
    v: '3.75', date: '2026-07-31',
    title: { tr: 'Kullanıcı hiyerarşisi ve paylaşılan Koleksiyon çalışma alanları', en: 'User hierarchy and shared Collection workspaces' },
    items: [
      { tr: 'Kullanıcı rolleri Buyer, Ekip Lideri, Müdür ve Moderatör olarak genişletildi; moderatörler kullanıcı rollerini, yöneticilerini, sipariş kapsamlarını ve uygulama yetkilerini merkezi yönetim ekranından ayarlayabilir.', en: 'User roles were expanded to Buyer, Team Lead, Manager and Moderator; moderators can manage roles, supervisors, order scopes and application permissions from the central administration screen.' },
      { tr: 'Ekip liderleri ve müdürler, sorumlu oldukları kullanıcıların sipariş kapsamlarını, atanmış uygulama yetkilerini ve Koleksiyon çalışma alanı erişimlerini güvenli biçimde devralır.', en: 'Team leads and managers securely inherit the order scopes, assigned application permissions and Collection workspace access of the users reporting to them.' },
      { tr: 'Koleksiyon verileri kullanıcı bazlı, sunucu tarafında ve revizyon kontrollü çalışma alanlarına taşındı; moderatörler diğer kullanıcılara görüntüleme veya düzenleme erişimi verebilir.', en: 'Collection data now lives in per-user, server-side, revision-controlled workspaces, and moderators can grant other users view or edit access.' },
      { tr: 'Kullanıcı kendi Koleksiyon sayfasını düzenlemeye devam eder; yetki verilen çalışma alanları üst seçim alanından açılır ve yalnız görüntüleme yetkisinde tüm düzenleme kontrolleri kilitlenir.', en: 'Users continue editing their own Collection page; shared workspaces are opened from the workspace selector and all editing controls are locked for view-only access.' },
      { tr: 'Geçersiz yönetici ataması, hiyerarşi döngüsü, yetki yükseltme ve eşzamanlı Koleksiyon kayıt çakışmaları sunucu tarafında engellenir.', en: 'Invalid supervisor assignments, hierarchy cycles, privilege escalation and concurrent Collection save conflicts are blocked on the server.' }
    ],
  },
  {
    v: '3.74', date: '2026-07-31',
    title: { tr: 'Animasyonlu sütun taşıma önizlemesi', en: 'Animated column reorder preview' },
    items: [
      { tr: 'Tablo sütunu sürüklenirken başlık fareyi takip eder; aradaki sütunlar gerçek bırakma konumuna göre yumuşak bir kayma animasyonuyla önizlenir.', en: 'While a table column is dragged, its header follows the pointer and neighbouring columns preview the real drop position with a smooth sliding animation.' },
      { tr: 'Koleksiyon tablosundaki Target Price ile ona bağlı Best Price, onaylı üretici ve onaylı fiyat başlıkları önizlemede tek blok olarak birlikte hareket eder.', en: 'In Collection, Target Price and its linked Best Price, confirmed manufacturer and confirmed price headers move together as one preview block.' },
      { tr: 'Animasyon yalnız başlık katmanında çalışır; büyük tablolarda gövde hücreleri her fare hareketinde yeniden boyanmadığı için sürükleme performansı korunur.', en: 'The animation runs only in the header layer, avoiding body-cell repaints on every pointer movement and preserving drag performance on large tables.' }
    ],
  },
  {
    v: '3.73', date: '2026-07-31',
    title: { tr: 'Filtre kapsamlı dışa aktarım ve Source araçları', en: 'Filter-aware export and Source tools' },
    items: [
      { tr: 'Tablolarda mevcut filtre görünümünde işaretli satır yoksa Excel dışa aktarımı otomatik olarak filtrelenmiş tüm satırları kullanır; başka bir görünümden kalan gizli seçimler dışa aktarımı boşaltmaz.', en: 'When no row is selected in the current filtered table view, Excel export automatically uses all filtered rows; hidden selections left from another view no longer produce an empty export.' },
      { tr: 'Yedekle / Geri Yükle simgesi üst bardan Kaynak Veri penceresine taşındı.', en: 'The Backup / Restore icon was moved from the top bar into the Source Data panel.' },
      { tr: 'Kur Excel’i düğmesi Source panelinde görünür hâle getirildi. Son yüklemenin ayı bittikten yedi gün sonra düğmede minimal Güncelle uyarısı gösterilir.', en: 'The FX Excel button is now visible in the Source panel. Seven days after the upload month ends, a minimal Update warning appears on the button.' }
    ],
  },
  {
    v: '3.72', date: '2026-07-31',
    title: { tr: 'Kaynak yenileme süre sayaçları', en: 'Source refresh duration counters' },
    items: [
      { tr: 'Kaynak panelindeki CP, Backlog, LFL, Kumaş ve Tümünü Yenile düğmelerinin soluna minimal süre sayaçları eklendi.', en: 'Minimal duration counters were added to the left of the CP, Backlog, LFL, Fabric and Refresh All buttons in the Source panel.' },
      { tr: 'Sayaç işlem boyunca onda bir saniye hassasiyetle ilerler ve yenileme tamamlandığında toplam süre ekranda sabit kalır.', en: 'Each counter advances to tenths of a second while the refresh runs and keeps the final duration visible after completion.' }
    ],
  },
  {
    v: '3.71', date: '2026-07-31',
    title: { tr: 'Güvenilir ilk açılış ve otomatik kurtarma', en: 'Reliable cold start and automatic recovery' },
    items: [
      { tr: 'Windows ve macOS başlatıcıları artık sabit süre beklemek yerine Buyer Log sunucusunun gerçek sağlık yanıtını bekler; yavaş bilgisayarlarda tarayıcının sunucudan önce açılması engellendi.', en: 'The Windows and macOS launchers now wait for the real Buyer Log health response instead of a fixed delay, preventing the browser from opening before the server on slower computers.' },
      { tr: 'Ana HTML belge tarayıcıda saklanmaz ve her açılış benzersiz URL ile yapılır; önceki başarısız veya boş sekmenin geri yüklenmesi önlendi.', en: 'The main HTML document is no longer stored by the browser and every launch uses a unique URL, preventing restoration of a previous failed or blank tab.' },
      { tr: 'İlk kullanıcı bağlamı isteği ile ana belge arasındaki oturum yarış koşulu giderildi; user-context.js hiçbir zaman yönlendirme HTML’i olarak dönmez.', en: 'The session race between the first user-context request and the main document was removed, so user-context.js can no longer be returned as redirect HTML.' },
      { tr: 'Ana arayüz geçici bir kaynak yükleme hatasıyla başlatılamazsa sayfa bir kez otomatik yenilenir; ikinci hatada boş ekran yerine ortada anlaşılır bir yeniden deneme notu gösterilir.', en: 'If a transient resource failure prevents the main interface from starting, the page automatically reloads once; a second failure shows a clear centred retry notice instead of a blank screen.' },
      { tr: 'Başlangıç veri isteği kısa ağ yarışlarında üç kez kontrollü olarak yeniden denenir; kullanıcıdan F5 ile müdahale beklenmez.', en: 'The initial data request is retried up to three times during short network races, removing the need for the user to press F5.' }
    ],
  },
  {
    v: '3.70', date: '2026-07-31',
    title: { tr: 'Koleksiyon içe aktarımında görsel koruması', en: 'Image protection on Collection import' },
    items: [
      { tr: 'Programa yüklenmiş model görselleri Excel içe aktarımında hiçbir koşulda silinmez veya değiştirilmez; görsel alanları karşılaştırmaya da yazmaya da kapalıdır.', en: 'Model images already uploaded to the program are never deleted or altered by an Excel import; image fields are excluded from both comparison and writing.' },
      { tr: 'Eşleşen modeller yerinde güncellenir; kayıt yeni bir nesneyle değiştirilmediği için görsel dışındaki dokunulmayan alanlar da korunur.', en: 'Matched models are updated in place; because the record is not replaced with a new object, untouched fields other than the image are preserved as well.' }
    ],
  },
  {
    v: '3.69', date: '2026-07-31',
    title: { tr: 'Yenileme bildirimi, geçmiş silme ve Koleksiyon içe aktarım eşlemesi', en: 'Refresh notice, history deletion and Collection import matching' },
    items: [
      { tr: 'Yenileme bittiğinde değişiklik varsa ASAS & ANTREPO geçmişi penceresi her zaman açılır; kayıt listesi yanıtla gelmediyse doğrudan sunucudan çekilir.', en: 'When a refresh finds changes, the ASAS & ANTREPO history window always opens; the record list is fetched from the server if it did not arrive with the response.' },
      { tr: 'Değişiklik bulunmadığında sonuç, alt kenardaki bildirim yerine ekranın ortasında minimal bir notla gösterilir.', en: 'When no changes are found, the result appears as a minimal note in the centre of the screen instead of a bottom-edge notification.' },
      { tr: 'ASAS & ANTREPO geçmişinde kayıtlar, açılmadan listedeki çöp kutusu simgesiyle silinebilir.', en: 'Records in the ASAS & ANTREPO history can be deleted straight from the list with a trash icon, without opening them.' },
      { tr: 'Koleksiyon Excel içe aktarımı satırları PLM ID ve Model Adı ile mevcut modellere eşler; onay penceresinde alan alan değişiklikler gösterilir ve onaylandığında mevcut kayıtların üzerine yazılır.', en: 'Collection Excel import matches rows to existing models by PLM ID and Model Name, shows field-level changes in a confirmation window and overwrites the existing records once approved.' },
      { tr: 'Eşleşmeyen satırlar yeni model olarak eklenir; görsellere hiçbir koşulda dokunulmaz, görseller Excel ile içe aktarılmaz.', en: 'Unmatched rows are added as new models; images are never touched and are not imported from Excel.' }
    ],
  },
  {
    v: '3.68', date: '2026-07-31',
    title: { tr: 'Önbellek güvenliği ve asenkron sıkıştırma', en: 'Cache safety and asynchronous compression' },
    items: [
      { tr: 'Vendor betikleri yalnız sürümlü URL ile uzun süreli immutable önbelleğe alınır; eski kütüphane sürümünün tarayıcıda takılı kalma riski kaldırıldı.', en: 'Vendor scripts now receive long-lived immutable caching only when their URL is versioned, preventing stale libraries from remaining in the browser.' },
      { tr: 'Lazy yükleyici loading, loaded ve error durumlarını izler; geçmiş load olayında sonsuza kadar bekleme ve aynı betiği birden fazla yükleme riski giderildi.', en: 'The lazy loader now tracks loading, loaded and error states, preventing hangs after a past load event and duplicate script loads.' },
      { tr: 'Statik dosya ve büyük API yanıtı sıkıştırması asenkron zlib ile yapılır; Node ana iş parçacığı sıkıştırma sırasında bloke edilmez.', en: 'Static files and large API responses are compressed with asynchronous zlib so the Node main thread is not blocked during compression.' },
      { tr: 'Statik gzip önbelleğine LRU giriş ve bellek sınırı eklendi; aynı dosyanın eşzamanlı sıkıştırma istekleri tek işte birleştirildi.', en: 'The static gzip cache now has LRU entry and memory limits, and concurrent compression requests for the same file are coalesced into one job.' }
    ],
  },

  {
    v: '3.67', date: '2026-07-31',
    title: { tr: 'Filtreleme, çizim ve sunucu yanıtı hızlandırmaları', en: 'Faster filtering, table rendering and server responses' },
    items: [
      { tr: 'Excel dışa aktarma ve Kopyala, tablo hâlâ oluşturulurken çalıştırılsa bile artık her zaman tüm satırları içerir.', en: 'Excel export and Copy now always include every row, even when run while the table is still being built.' },
      { tr: 'Dondurulmuş sütunlar, tablo parça parça dolarken de hizalı kalır.', en: 'Frozen columns stay aligned while the table fills in progressively.' },
      { tr: 'CP sayfası, hızlı filtre sayaçlarını ve tabloyu tek veri taramasıyla hesaplar; filtre ve sıralama tepkisi belirgin biçimde hızlandı.', en: 'The CP page now computes its quick-filter counters and table from a single data pass, making filtering and sorting noticeably faster.' },
      { tr: 'Sütun filtreleri, satır başına yeniden kurulan arama listeleri yerine önceden hazırlanmış aramalar kullanır.', en: 'Column filters use prepared lookups instead of rebuilding search lists for every row.' },
      { tr: 'Açılışta yalnız görüntülenen sayfa çizilir; CP, Onaylar ve Overview ilk kez açıldıklarında oluşturulur.', en: 'Only the visible page is drawn at startup; CP, Approvals and Overview are built the first time they are opened.' },
      { tr: 'Sunucu yanıtları tek geçişte üretilir ve metin yanıtları sıkıştırılarak gönderilir.', en: 'Server responses are produced in a single pass and text responses are sent compressed.' },
      { tr: 'Vendor dosyaları ve fontlar tarayıcıda kalıcı olarak önbelleğe alınır.', en: 'Vendor libraries and fonts are cached persistently by the browser.' }
    ],
  },
  {
    v: '3.66', date: '2026-07-31',
    title: { tr: 'Performans ve açılış optimizasyonu', en: 'Performance and startup optimisation' },
    items: [
      { tr: 'Büyük tablolar ilk görünür satırları hemen, kalan satırları tarayıcı boş kaldıkça parça parça oluşturur; uzun ana iş parçacığı kilitlenmeleri azaltıldı.', en: 'Large tables render the first visible rows immediately and append the rest during browser idle time, reducing long main-thread stalls.' },
      { tr: 'ExcelJS, JSZip, PDF.js ve jsPDF yalnız ilgili dışa aktarma veya PDF işlemi başlatıldığında yüklenir.', en: 'ExcelJS, JSZip, PDF.js and jsPDF are loaded only when the related export or PDF operation starts.' },
      { tr: 'Sürüm geçmişi ve Ön Maliyet modülleri talep üzerine yüklenerek başlangıç JavaScript yükü ve bellek kullanımı azaltıldı.', en: 'Version history and Open Costing modules now load on demand, reducing startup JavaScript work and memory use.' }
    ],
  },
  {
    v: '3.65', date: '2026-07-31',
    title: { tr: 'Kararlılık, hata yönetimi ve kaynak doğrulaması', en: 'Startup resilience, API errors and source validation' },
    items: [
      { tr: 'Bozuk veya geçersiz config.json artık uygulamanın açılmasını engellemiyor; hata loglanıyor ve güvenli varsayılan ayarlarla başlatılıyor.', en: 'A malformed or invalid config.json no longer prevents startup; the failure is logged and safe defaults are used.' },
      { tr: 'Port, sunucu adresi ve Excel yenileme zaman aşımı ayarları güvenli aralıklarda doğrulanıyor; geçerli özel ayarlar ve bilinmeyen geriye uyumlu seçenekler korunuyor.', en: 'Port, bind host and Excel refresh timeout settings are validated against safe ranges while valid custom and backward-compatible options are preserved.' },
      { tr: 'Geçersiz veya izin verilen boyutu aşan JSON istekleri teknik HTML yerine tutarlı ve kullanıcıya anlaşılır API hata kodları döndürüyor.', en: 'Malformed or oversized JSON requests now return consistent, user-readable API errors instead of technical HTML responses.' },
      { tr: 'Tüm proje JavaScript dosyaları sözdizimi taramasından geçirildi; sürüm geçmişindeki iki kaçırılmamış apostrof nedeniyle oluşan gerçek yükleme hatası düzeltildi.', en: 'Every project JavaScript file was syntax-checked, uncovering and fixing a real load failure caused by two unescaped apostrophes in the version history.' },
    ],
  },
  {
    v: '3.64', date: '2026-07-31',
    title: { tr: 'Kapsamlı yenileme menüsü ve veri modeli sütunları', en: 'Scoped refresh menu and data-model columns' },
    items: [
      { tr: 'Sağ üst Yenile düğmesi artık CP, Backlog, LFL, Kumaş Bilgisi veya Tümü seçeneklerini gösteren minimal bir menü açıyor.', en: 'The top-right Refresh button now opens a compact menu for CP, Backlog, LFL, Fabric Information or All.' },
      { tr: 'Source Data penceresi açıldığında sayfanın geri kalanı bulanıyor; Ayarlar alt menüsünün açık kalmasına neden olan hidden stil çakışması giderildi.', en: 'Opening Source Data now blurs the rest of the page, and the hidden-style conflict that kept the Settings submenu open was fixed.' },
      { tr: 'CP Columns paneline ASAS ve IAS veri modeli sütunlarından özel sütun ekleme geldi. Görünen başlık kullanıcı tarafından belirleniyor, kaynak tablo/sütun aranarak seçiliyor.', en: 'The CP Columns panel can now add custom columns from ASAS and IAS model fields. The visible heading is user-defined and the source table/column is searchable.' },
      { tr: 'Data Model Connection koşul sütunu seçicisi tablo ve sütun adına göre aranabilir hâle geldi. Fabric ayrı scope hedefi oldu; IAS ve Fabric kapsamları CP kapsamından dönen sipariş kodlarıyla sınırlandırılabiliyor.', en: 'The Data Model Connection condition-column picker is now searchable by table and column. Fabric is a separate scope target, and IAS/Fabric scopes can be limited to order codes returned by the CP scope.' },
    ],
  },
  {
    v: '3.63', date: '2026-07-30',
    title: { tr: 'Kaynak paneli sadeleştirildi', en: 'The Source panel was simplified' },
    items: [
      { tr: 'Kaynak penceresi baştan kuruldu. Önceki hâlde tek satırda on dört düğme vardı ve dört ayrı iş yan yana duruyordu: Excel yükleme, yenileme, kurulum ayarları ve geçmiş.', en: 'The Source panel was rebuilt. It previously held fourteen buttons in a single row, mixing four unrelated jobs side by side: Excel uploads, refreshing, setup settings and history.' },
      { tr: 'Artık panel bir sayfa listesi: CP + order summary, Backlog, LFL ve Kumaş. Her satırda en son ne zaman güncellendiği, kaç satır olduğu ve yalnız o sayfayı yenileyen bir düğme var.', en: 'The panel is now a list of pages: CP + order summary, Backlog, LFL and Fabric. Each row shows when it was last updated, how many rows it holds and a button that refreshes only that page.' },
      { tr: 'Altında tek bir "Tümünü Yenile" düğmesi ve kurulum işlerini toplayan "Ayarlar" menüsü duruyor. Veri kaynağı ve filtreler, yol süreleri ve Non-DTR üreticiler oraya taşındı.', en: 'Below it sit a single "Refresh All" button and a "Settings" menu that gathers the setup work: the data source and filters, transfer lead times and Non-DTR manufacturers.' },
      { tr: 'Excel yükleme düğmeleri katlanmış bir bölüme alındı. Veri artık modelden geldiği için günlük kullanımda görünmüyorlar, ama yedek yol olarak duruyorlar.', en: 'The Excel upload buttons moved into a collapsed section. Data now comes from the model so they are out of the way in daily use, but they remain available as a fallback.' },
      { tr: 'Bağlantı penceresinde sorgu modu, çıktı dosyası ve biçim "Gelişmiş ayarlar" altına, alan eşleme tablosu da katlanabilir bir bölüme alındı. Günlük iş olan filtre kurma öne çıktı.', en: 'In the connection window the query mode, output file and format moved under "Advanced settings" and the field mapping table became collapsible, bringing the everyday job of setting filters to the front.' },
    ],
  },
  {
    v: '3.62', date: '2026-07-30',
    title: { tr: '"Sorgu çok uzun" hatası düzeltildi', en: 'Fixed the "query too long" error' },
    items: [
      { tr: 'Sipariş kodu filtresi 10.000 koda kadar sorguya gömülüyordu, ancak sorgu uzunluğu sınırı 20.000 karakterdi. Bir sipariş kodu listede yaklaşık 12 karakter yer kapladığı için sınır 1.600 kod civarında aşılıyor ve yenileme "Sorgu çok uzun" hatasıyla duruyordu. İki sınır baştan beri birbiriyle çelişiyordu.', en: 'The order code filter was pushed into the query for up to ten thousand codes, while the query length limit was twenty thousand characters. Since each code takes about twelve characters in the list, the limit was exceeded at around sixteen hundred codes and the refresh stopped with a "query too long" error. The two limits had always contradicted each other.' },
      { tr: 'Uzunluk sınırı ikiye ayrıldı. Elle yazılan DAX için 20.000 karakter sınırı aynen duruyor; amacı zaten yazım veya yapıştırma kazasını yakalamak. Uygulamanın kendi ürettiği sorgular denetim altında olduğu için ayrı ve çok daha yüksek bir sınıra tabi.', en: 'The length limit was split in two. Hand-written DAX keeps its twenty thousand character limit, whose purpose is to catch typing or paste accidents, while queries the application builds itself are under our control and have a separate, far higher limit.' },
      { tr: 'Sipariş kodu listesinin sorguya gömülüp gömülmeyeceği artık kod sayısına değil, oluşan metnin boyutuna bakılarak kararlaştırılıyor. Kod uzunlukları değişken olduğu için asıl sınırlayıcı olan boyuttur. Bütçe aşılırsa süzme eskisi gibi uygulama içinde yapılıyor ve uyarı veriliyor.', en: 'Whether the order code list is pushed into the query is now decided by the size of the resulting text rather than the number of codes, since code lengths vary and size is the real constraint. If the budget is exceeded the filtering happens inside the application as before and a warning is shown.' },
    ],
  },
  {
    v: '3.61', date: '2026-07-30',
    title: { tr: 'Bağlantı çoğaltma, silme ve aynı rolde birden çok bağlantı', en: 'Duplicating and deleting connections, and several connections in one role' },
    items: [
      { tr: 'Kayıtlı bağlantı satırlarına çoğalt ve sil düğmeleri eklendi. Çoğaltma, eşlemeyi ve koşulları olduğu gibi kopyalıyor; silme onay istiyor.', en: 'Duplicate and delete buttons were added to the saved connection rows. Duplicating copies the mapping and the conditions as they are, and deleting asks for confirmation.' },
      { tr: 'Aynı roldeki birden çok bağlantı artık birlikte çalışıyor. Önceden roldeki yalnız ilk bağlantı kullanılıyor, diğerleri sessizce yok sayılıyordu; bu yüzden ASAS\'ı çoğaltıp kopyayı LFL\'e bağlamak işe yaramazdı. Artık her hedefi hangi bağlantının beslediği ayrı ayrı çözülüyor.', en: 'Several connections in the same role now work together. Previously only the first connection in a role was used and the rest were silently ignored, so duplicating ASAS and pointing the copy at LFL had no effect. Which connection feeds each target is now resolved individually.' },
      { tr: 'Bir hedefi yalnız tek bağlantı besleyebilir. İki bağlantı aynı hedefi isterse listedeki ilki kazanıyor ve durum yenileme uyarılarında bildiriliyor.', en: 'A target can be fed by only one connection. If two ask for the same target the first in the list wins and the situation is reported in the refresh warnings.' },
      { tr: 'Kopya, kaynağın hedeflerini olduğu gibi almıyor: boştaki hedefleri devralıyor, boşta hedef kalmamışsa kapsamı kapalı geliyor. Böylece kopya sessizce çalışmayan bir bağlantı olarak kalmıyor.', en: 'A copy does not inherit the source\'s targets as they are. It takes over whichever targets are free, and if none are, its scope arrives disabled, so a copy never ends up as a connection that silently does nothing.' },
      { tr: 'Bağlantı satırında artık hangi sayfaları beslediği de yazıyor.', en: 'The connection row now also shows which pages it feeds.' },
    ],
  },
  {
    v: '3.60', date: '2026-07-30',
    title: { tr: 'Sayfa bazlı yenileme ve kapsam düzeltmeleri', en: 'Per-page refresh and scope fixes' },
    items: [
      { tr: 'Kaynak paneline "Sadece CP", "Sadece Backlog" ve "Sadece LFL" düğmeleri eklendi. Bunlar yalnız ilgili sayfanın kapsamını sorguluyor; diğer sayfaların verisi olduğu gibi kalıyor. Tek bir sayfayı güncellemek için artık bütün sorguların bitmesi beklenmiyor.', en: 'CP only, Backlog only and LFL only buttons were added to the Source panel. Each queries just that page\'s scope and leaves the other pages\' data untouched, so updating one page no longer waits for every query to finish.' },
      { tr: 'Ufuk bölümünde kalan eski "Koşul Grubu Ekle" düğmesi kaldırıldı. Bu düğme grubu hiçbir kapsama ait olmayacak şekilde ekliyordu, dolayısıyla o grupta CP, Backlog ve LFL seçenekleri çıkmıyordu. Koşul grupları artık yalnız bir kapsamın içinden ekleniyor.', en: 'The leftover "Add condition group" button in the Horizon section was removed. It created groups that belonged to no scope, which is why the CP, Backlog and LFL choices did not appear on them. Condition groups are now added from inside a scope only.' },
      { tr: 'Model şeması, bağlantı düzenleyicisi açılır açılmaz kendiliğinden okunuyor. Koşul sütunu listesi artık "Otomatik Eşle" çalıştırmadan da dolu geliyor; IAS tarafında Sezon, Merch Alt Grup Kod, Merch Marka Yaş Grup Kod ve Marka Müdürlükleri bu yüzden görünmüyordu.', en: 'The model schema is read as soon as the connection editor opens, so the condition column list is populated without running "Match automatically" first. This was why the season, merch sub-group, merch brand age group and brand directorate fields did not appear on the IAS side.' },
    ],
  },
  {
    v: '3.59', date: '2026-07-30',
    title: { tr: 'Sayfa başına ayrı veri koşulları (kapsamlar)', en: 'Separate data conditions per page (scopes)' },
    items: [
      { tr: 'Bir bağlantı artık tek ufuk yerine "kapsam" listesi tutuyor. Her kapsamın kendi hedefleri (CP, Backlog, LFL) ve kendi koşulları var. Aynı kapsamda birden çok hedef varsa tek sorgu çalışıp sonuç paylaşılıyor; hedefler ayrı kapsamlara konursa her biri kendi koşullarıyla ayrı sorgu alıyor.', en: 'A connection now holds a list of scopes instead of a single horizon. Each scope has its own targets, CP, Backlog and LFL, and its own conditions. Targets sharing a scope share one query, while targets placed in separate scopes each get their own query with their own conditions.' },
      { tr: 'ASAS için CP ve Backlog\'ü bir kapsamda, LFL\'i ayrı bir kapsamda tutmak artık mümkün. CP ile Backlog de istenirse ayrı kapsamlara bölünebiliyor.', en: 'For ASAS, CP and Backlog can share one scope while LFL sits in another, and CP and Backlog can also be split into separate scopes if wanted.' },
      { tr: 'IAS yalnız CP ve Backlog hedeflerini alabiliyor; LFL bu rolde seçilemiyor. Her iki hedef için ayrı koşul kurulabiliyor.', en: 'IAS can only take the CP and Backlog targets, LFL is not offered for that role, and a separate condition set can be built for each of the two targets.' },
      { tr: 'IAS eşlemesine Sezon, Merch Alt Grup Kod, Merch Marka Yaş Grup Kod ve Marka Müdürlükleri eklendi; bunlara göre ufuk koşulu kurulabiliyor. Bu alanlar Antrepo verisi için zorunlu değil, yalnız filtreleme içindir.', en: 'Season, Merch sub-group code, Merch brand age group code and brand directorates were added to the IAS mapping so horizon conditions can be built on them. These fields are not required for the warehouse data itself and exist only for filtering.' },
      { tr: 'Her kapsamın üreteceği sorgu kendi kutusunda canlı gösteriliyor, hangi hedefi beslediği başlıkta yazıyor.', en: 'The query each scope will run is shown live in its own box, with the targets it feeds written above it.' },
      { tr: 'Kapsam tanımlanmamış eski bağlantılar, mevcut tek ufuklarını tüm hedefleri kapsayan bir kapsama çevriliyor; davranışları değişmiyor.', en: 'Existing connections without scopes have their single horizon converted into one scope covering every target, so their behaviour does not change.' },
    ],
  },
  {
    v: '3.58', date: '2026-07-30',
    title: { tr: 'Koleksiyon tablosuna sütun ekleme ve silme', en: 'Adding and removing Collection table columns' },
    items: [
      { tr: 'Koleksiyon sayfasındaki sütun seçme panelinin altına "Sütun ekle" düğmesi geldi. Verdiğin adla yeni bir sütun oluşuyor ve tablonun sonuna ekleniyor.', en: 'An "Add column" button was added to the bottom of the column panel on the Collection page. A new column is created with the name given and appended to the table.' },
      { tr: 'Eklenen sütunların hücreleri serbest metin olarak düzenleniyor; sıralama, sütun filtresi, sürükleyerek yer değiştirme, genişlik ayarı ve dışa aktarma sabit sütunlarla aynı şekilde çalışıyor.', en: 'Cells in an added column are edited as free text, and sorting, column filtering, drag reordering, width adjustment and export all behave exactly as they do for the built-in columns.' },
      { tr: 'Panelde özel sütunun adına tıklayarak yeniden adlandırılıyor, yanındaki çarpı ile siliniyor. Silmeden önce kaç satırda dolu değer olduğu söylenip onay isteniyor, çünkü sütunla birlikte o değerler de gidiyor.', en: 'Clicking a custom column\'s name in the panel renames it and the cross beside it deletes it. Before deleting, the number of rows holding a value is reported and confirmation is requested, because those values are removed along with the column.' },
      { tr: 'Sütun tanımları sıralama, gizleme ve genişlik ayarlarıyla birlikte kalıcı olarak saklanıyor.', en: 'Column definitions are stored persistently together with the order, visibility and width settings.' },
    ],
  },
  {
    v: '3.57', date: '2026-07-30',
    title: { tr: 'Açılışta uygulamanın çökmesi düzeltildi', en: 'Fixed the application failing to start' },
    items: [
      { tr: 'v3.55 ile gelen sütun daraltma özelliği, tutamağa yazdığı ipucu için dil değişkenini o anda okuyordu. Backlog tablosunun tutamakları betiğin ortasında doğrudan kurulduğu ve dil değişkeni çok daha aşağıda tanımlandığı için bu okuma hata veriyor, betik orada duruyordu. Sonuç: uygulama açılıyor ama hiçbir veri gelmiyor ve hiçbir düğme çalışmıyordu.', en: 'The column collapse feature added in v3.55 read the language variable while writing the handle tooltip. The Backlog handles are created part-way through the script while the language variable is declared much further down, so that read threw and execution stopped there. The result was an application that opened but loaded no data and responded to no button.' },
      { tr: 'İpucu artık fare tutamağın üstüne gelince yazılıyor. Bu hem açılış sorununu çözüyor hem de dil değiştirildiğinde ipucunun güncel kalmasını sağlıyor. Çift tıklayarak daraltma davranışı aynen duruyor.', en: 'The tooltip is now written when the pointer reaches the handle, which both fixes startup and keeps the tooltip correct after a language change. The double-click collapse behaviour itself is unchanged.' },
      { tr: 'Aynı hatanın tekrarlamaması için betik yükleme sırasını denetleyen testler eklendi.', en: 'Tests that check the script load order were added so the same mistake cannot return unnoticed.' },
    ],
  },
  {
    v: '3.56', date: '2026-07-30',
    title: { tr: 'Kumaş bilgisi yalnız talep üzerine ve ASAS kapsamında güncelleniyor', en: 'Fabric information updated on demand only, within the ASAS scope' },
    items: [
      { tr: 'Veri modeli bağlantılarına "Kumaş" rolü eklendi. Bu roldeki bağlantı Yenile akışına hiç girmiyor; ASAS ve Antrepo seçimine karışmıyor.', en: 'A "Fabric" role was added to the data model connections. A connection in this role never takes part in the Refresh flow and is not considered when the ASAS and Antrepo connections are chosen.' },
      { tr: 'Kumaş bilgisi artık yalnız Kaynak panelindeki "Kumaş Bilgilerini Güncelle" düğmesiyle güncelleniyor. Yenile\'ye basmak kumaş bilgisini veri tabanından sorgulamıyor; yüklü olan kayıtlar olduğu gibi kullanılıyor.', en: 'Fabric information is now updated only by the "Update Fabric Informations" button in the Source panel. Pressing Refresh does not query fabric information from the database and the stored records are used as they are.' },
      { tr: 'Güncelleme kapsamı ASAS bağlantısının koşullarından geçen siparişlerdir. Yalnız ekranda yüklü sipariş kodları sorgulanıyor, kumaş tablosunun tamamı değil.', en: 'The update covers the orders that passed the ASAS connection conditions. Only the order codes currently loaded are queried, not the entire fabric table.' },
      { tr: 'Sipariş kodu filtresi mümkün olduğunda doğrudan sorguya gömülüyor. Kod sayısı sınırı aşarsa veya bağlantı manuel DAX modundaysa süzme uygulama içinde yapılıyor ve bu durum uyarı olarak bildiriliyor.', en: 'The order code filter is pushed into the query where possible. If the code count exceeds the limit or the connection is in manual DAX mode, the filtering happens inside the application and this is reported as a warning.' },
      { tr: 'Kumaş rolünde bir bağlantı tanımlı değilse eski Excel yolu ("ASAS - Fabric" dosyası) çalışmaya devam ediyor.', en: 'If no connection is defined in the fabric role, the previous Excel path using the "ASAS - Fabric" file keeps working.' },
    ],
  },
  {
    v: '3.55', date: '2026-07-30',
    title: { tr: 'Sütun tutamağına çift tıklayarak daraltma', en: 'Double-click a column handle to collapse it' },
    items: [
      { tr: 'Sütunlar arasındaki genişlik ayarlama çizgisine çift tıklandığında ilgili sütun izin verilen en dar genişliğe iniyor. Bu, CP, order summary, Onaylar, Backlog ağacı ve Koleksiyon tablolarının hepsinde geçerli.', en: 'Double-clicking the width handle between two columns collapses that column to its narrowest allowed width. This applies to the CP, order summary, Approvals, Backlog tree and Collection tables.' },
      { tr: 'Alt sınır her sütunun kendi minimumudur; başlık metni, filtre ve sıralama okları sığmaya devam eder, yani sütun okunamaz hâle gelmez.', en: 'The lower bound is each column\'s own minimum, so the header text and the filter and sort arrows still fit and the column never becomes unreadable.' },
      { tr: 'Daraltılmış bir sütuna ikinci kez çift tıklandığında eski genişliğine dönüyor. Aksi hâlde geri açmanın tek yolu birkaç piksellik tutamağı yakalayıp sürüklemek olurdu.', en: 'Double-clicking a collapsed column again restores its previous width, since otherwise the only way back would be to grab and drag a handle a few pixels wide.' },
      { tr: 'Genişlik değişikliği diğer sütun ayarları gibi kalıcı olarak kaydediliyor.', en: 'The new width is stored persistently like every other column setting.' },
    ],
  },
  {
    v: '3.54', date: '2026-07-30',
    title: { tr: 'Ufuk koşullarında değerler listeden seçiliyor', en: 'Horizon condition values are now picked from a list' },
    items: [
      { tr: 'Koşul değerleri artık elle yazılmıyor. Değer kutusuna tıklandığında CP ve LFL sayfalarındaki sütun filtresinin aynısı açılıyor: arama kutusu, işaret kutuları, Tümü ve Temizle düğmeleri.', en: 'Condition values are no longer typed by hand. Clicking the value box opens the same filter used on the CP and LFL pages, with a search box, checkboxes and All and Clear buttons.' },
      { tr: 'Listelenen değerler modelin kendisinden okunuyor, yani gerçekte var olan değerler görünüyor. Bir sütunun değerleri bir kez okunup önbelleğe alınıyor; aynı sütun tekrar açıldığında anında geliyor.', en: 'The listed values are read from the model itself, so only values that actually exist are shown. A column is read once and cached, so reopening it is instant.' },
      { tr: 'Sütun seçicisi ikiye ayrıldı: üstte uygulamadaki adlarıyla eşlenmiş alanlar, altta modelin diğer sütunları. Ham model sütun adlarını hatırlamak gerekmiyor.', en: 'The column picker is split in two: mapped fields under their application names first, then the remaining model columns, so raw model column names no longer need to be remembered.' },
      { tr: '"İçerir" ve "ile başlar" işleçlerinde tek değer seçiliyor; tarih ve sayı aralıkları eskisi gibi kutulardan giriliyor.', en: 'The contains and starts with operators take a single value, while date and number ranges are still entered in their own boxes.' },
    ],
  },
  {
    v: '3.53', date: '2026-07-30',
    title: { tr: 'Serbest ufuk koşulları ve Antrepo\'nun ASAS\'a bağlanması', en: 'Free-form horizon conditions and Antrepo linked to ASAS' },
    items: [
      { tr: 'Ufuk artık yalnız sezon ve tarihle sınırlı değil. İstenen sayıda koşul kurulabiliyor: sezon, MAG, üretici, lisans, tarih, sayı ve benzeri her sütun için "şunlardan biri", "şunlardan biri değil", "aralığında", "büyük/eşit", "küçük/eşit", "içerir", "ile başlar", "boş" ve "dolu" işleçleri kullanılabiliyor.', en: 'The horizon is no longer limited to season and date. Any number of conditions can be built on any column using is one of, is not one of, between, greater or equal, less or equal, contains, starts with, is empty and is not empty.' },
      { tr: 'Birleştirme modeli: bir grubun içindeki koşullar VE ile, gruplar ise birbiriyle VEYA ile bağlanır. Böylece hem "sezon W6 ve MAG 320" gibi daraltmalar hem de "şu sezonlar veya şu tarih aralığı" gibi genişletmeler aynı ekranda kurulabiliyor.', en: 'Conditions inside a group are combined with AND and the groups themselves with OR, so both narrowing combinations and alternative criteria can be expressed on the same screen.' },
      { tr: 'Mevcut sezon ve tarih ayarları otomatik olarak koşullara dönüştürülüyor; eski davranış korunuyor.', en: 'Existing season and date settings are converted into conditions automatically, preserving the previous behaviour.' },
      { tr: 'Antrepo bağlantısına "ASAS\'tan gelen sipariş kodlarıyla sınırla" seçeneği eklendi ve varsayılan olarak açık. Antrepo kayıtları yalnız ASAS ufkundan dönen sipariş kodları için getiriliyor.', en: 'The bonded warehouse connection gained a "Limit to order codes coming from ASAS" option, on by default. Warehouse records are fetched only for the order codes the ASAS horizon returned.' },
      { tr: 'Sipariş kodu sayısı 10.000\'e kadarsa filtre doğrudan sorguya gömülüyor ve ağdan yalnız gereken satırlar geçiyor. Üzerindeyse Antrepo kendi ufkuyla çekilip süzme uygulama içinde yapılıyor ve bu durum uyarı olarak bildiriliyor.', en: 'Up to ten thousand order codes the filter is pushed into the query itself so only the needed rows travel. Above that the warehouse is fetched with its own horizon and filtered inside the application, which is reported as a warning.' },
    ],
  },
  {
    v: '3.52', date: '2026-07-30',
    title: { tr: 'Elle alan ekleme ve arka planda yenileme', en: 'Manual field entry and background refresh' },
    items: [
      { tr: 'Alan eşleme bölümüne "Alan Ekle" düğmesi eklendi. Rol kataloğunda bulunmayan alanlar elle eklenip model sütunlarıyla eşlenebiliyor, gerektiğinde kaldırılabiliyor.', en: 'An "Add field" button was added to the field mapping section. Fields that are not in the role catalogue can be added manually, mapped to model columns and removed again.' },
      { tr: 'Antrepo (IAS) rolünde sezon filtresi çalışmıyordu: katalogda "Sezon" alanı olmadığı için ufuk adımı sezon sütununu bulamıyor ve yenilemeyi durduruyordu. Artık ufuk ayarında elle yazılan sezon veya tarih sütunu doğrudan kullanılıyor; eşlemeden gelen değer elle girilen sütunu ezmiyor.', en: 'The season filter did not work for the bonded warehouse (IAS) role: the catalogue has no season field, so the horizon step could not find a season column and stopped the refresh. A season or date column typed into the horizon settings is now used directly, and a mapped value no longer overwrites a manually entered column.' },
      { tr: 'Yenileme artık arka planda çalışıyor. Yenile\'ye basıldığında istek hemen dönüyor, uygulama ekrandaki verilerle kullanılmaya devam ediyor ve iş bittiğinde yeni veri sessizce yerine geçiyor. Düğme üzerinde geçen süre saniye saniye gösteriliyor.', en: 'Refresh now runs in the background. The request returns immediately, the application stays usable with the data already on screen, and the new data takes its place once the job finishes. Elapsed time is shown on the button as it runs.' },
      { tr: 'Bu değişiklik sorguyu hızlandırmaz, beklemeyi ortadan kaldırır. Sorgunun kendisi yavaşsa süre dökümü bunu göstermeye devam eder.', en: 'This does not make the query faster, it removes the waiting. If the query itself is slow the timing breakdown still shows it.' },
    ],
  },
  {
    v: '3.51', date: '2026-07-30',
    title: { tr: 'Yenileme hızlandırıldı ve süresi ölçülebilir hale getirildi', en: 'Refresh made faster and its duration measurable' },
    items: [
      { tr: 'CSV yazma döngüsü yeniden yazıldı. Önceki sürüm her hücre için bir ForEach-Object ardışık düzeni kurup dört ayrı regex çalıştırıyordu; yüz binlerce satırda bu, sürenin büyük kısmını tek başına yiyordu. Artık yeniden kullanılan tek bir StringBuilder var, hücre başına fonksiyon çağrısı ve regex yok, pahalı işlemler yalnız gerçekten gerektiğinde yapılıyor.', en: 'The CSV writing loop was rewritten. The previous version set up a ForEach-Object pipeline and ran four regular expressions for every single cell, which on hundreds of thousands of rows consumed most of the total time. It now reuses a single StringBuilder with no per-cell function calls or regular expressions, and does the expensive work only where it is actually needed.' },
      { tr: 'Yenileme süresi artık parçalara ayrılıyor: model sunucusunun sorguyu çalıştırma süresi, sonucun yazılma süresi ve uygulamanın ayrıştırma süresi ayrı ayrı ölçülüyor.', en: 'Refresh time is now broken down: the time the model server spends running the query, the time spent writing the result and the time the application spends parsing it are measured separately.' },
      { tr: 'Yenile tamamlandığında bu döküm bağlantı bazında bildirim olarak gösteriliyor; yavaşlığın hangi adımdan geldiği tahmin edilmeden görülüyor.', en: 'When a refresh finishes the breakdown is shown per connection as a notification, so the slow step can be identified instead of guessed.' },
    ],
  },
  {
    v: '3.50', date: '2026-07-30',
    title: { tr: 'Sezon filtresinde gerçek model alanı çözümleme', en: 'Resolved model field for season filtering' },
    items: [
      { tr: 'Varsayılan sezon filtresi artık ana sorgu tablosunda Sezon adlı bir sütun olduğunu varsaymaz; Data Model Connection içindeki Sezon alan eşlemesinin gerçek tablo ve sütununu kullanır.', en: 'The default season filter no longer assumes a column named Season exists in the main query table; it uses the actual table and column from the Season field mapping.' },
      { tr: 'Örneğin Sezon alanı Model Özellikleri tablosundaki Sipariş Sezon Kod sütununa eşlenmişse TREATAS filtresi doğrudan bu alana uygulanır; Siparis Bilgileri[Sezon] şeklinde hatalı DAX üretilmez.', en: 'For example, when Season maps to Order Season Code in the Model Properties table, TREATAS targets that field directly and no invalid Siparis Bilgileri[Season] DAX is generated.' },
      { tr: 'Refresh, sorgu önizleme, Test/Run ve satır sayımı aynı alan çözümleme kuralını kullanır; düzeltilen ufuk bilgisi bağlantı ayarına kalıcı kaydedilir.', en: 'Refresh, query preview, Test/Run and row counting use the same field-resolution rule, and the corrected horizon is persisted to the connection settings.' },
    ],
  },
  {
    v: '3.49', date: '2026-07-30',
    title: { tr: 'Hızlı açılış ve optimize veri modeli yenilemesi', en: 'Fast startup and optimized data-model refresh' },
    items: [
      { tr: 'Program açılışı artık veri modeline otomatik sorgu göndermez; son başarılı snapshot hemen yüklenir, snapshot yoksa uygulama boş ama kullanılabilir biçimde anında açılır.', en: 'Application startup no longer sends an automatic model query; the last successful snapshot loads immediately, or the app opens empty and usable when no snapshot exists.' },
      { tr: 'Buyer profillerinde kullanıcıya ait snapshot yoksa aynı ham model verisini taşıyan Moderatör snapshotı güvenli başlangıç önbelleği olarak kullanılır; kullanıcıya özel override verileri kopyalanmaz.', en: 'When a Buyer profile has no own snapshot, the Moderator snapshot is used as a safe startup cache for the same raw model data without copying user-specific overrides.' },
      { tr: 'ASAS ve Antrepo bağlantıları art arda değil paralel sorgulanır; toplam bekleme süresi iki sorgunun toplamı yerine yaklaşık en yavaş bağlantının süresine iner.', en: 'ASAS and Antrepo connections are queried in parallel rather than sequentially, reducing total wait time to roughly the slower connection instead of the sum of both.' },
      { tr: 'Büyük model sonuçları hücre başına JSON dönüştürmek yerine akışsal CSV ile aktarılır ve uygulamada ayrıştırılır; veri aktarım ve dönüştürme yükü azaltılır.', en: 'Large model results are transferred as streaming CSV and parsed in the app instead of performing per-cell JSON conversion, reducing transfer and serialization overhead.' },
      { tr: 'Yalnız sezon filtresi kullanılan otomatik DAX, tüm fact tablosunu FILTER ile taramak yerine TREATAS kullanır; W6, W7, S6 ve S7 filtresi modele daha verimli uygulanır.', en: 'Automatic DAX with a season-only horizon uses TREATAS instead of scanning the full fact table with FILTER, applying the W6, W7, S6 and S7 filter more efficiently.' },
      { tr: 'Model sorgularına beş dakikalık güvenli zaman aşımı eklendi; bağlantı süresiz beklemez ve sorun olduğunda anlaşılır hata verir.', en: 'A five-minute safety timeout was added to model queries so a connection cannot wait indefinitely and returns a clear error when it stalls.' },
    ],
  },
  {
    v: '3.48', date: '2026-07-30',
    title: { tr: 'Data Model için dört sezonluk varsayılan ufuk', en: 'Four-season default horizon for Data Model refresh' },
    items: [
      { tr: 'Yeni ASAS bağlantıları ve daha önce ufuk ayarı yapılmamış eski bağlantılar varsayılan olarak yalnız W6, W7, S6 ve S7 sezonlarını sorgular.', en: 'New ASAS connections and legacy connections with no configured horizon now query only seasons W6, W7, S6 and S7 by default.' },
      { tr: 'Daha önce özel sezon veya tarih aralığı tanımlanmış bağlantılar değiştirilmez; kullanıcı varsayılan uygulandıktan sonra sezon listesini bilinçli olarak boşaltabilir.', en: 'Connections with an existing custom season or date horizon are left unchanged, and users can deliberately clear the list after the default has been applied.' },
      { tr: 'Varsayılan sezon sınırı DAX sorgusuna doğrudan eklenerek modelden çekilen satır hacmini ve yenileme süresini azaltır.', en: 'The default season boundary is written directly into the DAX query to reduce rows pulled from the model and shorten refresh time.' },
    ],
  },
  {
    v: '3.47', date: '2026-07-30',
    title: { tr: 'Data Model eşlemelerinde otomatik onarım', en: 'Automatic repair for Data Model mappings' },
    items: [
      { tr: 'Bağlantı ayarlarını kaydeden katmanda eşleme nesnelerini [object Object] metnine dönüştüren hata giderildi; tablo, sütun, tür ve klasör bilgileri yapılandırılmış biçimde korunuyor.', en: 'Fixed the storage-layer bug that converted mapping objects into [object Object]; table, column, kind and folder data are now preserved in structured form.' },
      { tr: 'Eski sürümden kalmış bozuk eşlemeler Refresh veya bağlantı Test/Run sırasında model şemasından otomatik yeniden eşleniyor; kullanıcıdan bütün alanları yeniden seçmesi istenmiyor.', en: 'Mappings corrupted by an older version are automatically rebuilt from the model schema during Refresh or connection Test/Run, without requiring the user to select every field again.' },
      { tr: 'Otomatik onarılan eşleme bağlantı ayarlarına kalıcı olarak yazılıyor; sonraki yenilemeler doğrudan düzeltilmiş kayıtla çalışıyor.', en: 'The repaired mapping is persisted back to the connection settings, so later refreshes use the corrected record directly.' },
      { tr: 'Düz metin, JSON metni ve yapılandırılmış eski eşleme biçimleri ortak normalizatörle geriye dönük uyumlu biçimde okunuyor.', en: 'Legacy plain-text, JSON-text and structured mapping formats are read through a backward-compatible common normalizer.' },
    ],
  },
  {
    v: '3.46', date: '2026-07-30',
    title: { tr: 'TPs harf duyarsız arama ve DAX eşleme düzeltmesi', en: 'Case-insensitive TPs search and DAX mapping fix' },
    items: [
      { tr: 'TPs model araması büyük/küçük harf ve Türkçe karakter farklarını yok sayıyor; örneğin MINECRAFT modeli Minecraft yazarak bulunabiliyor.', en: 'TPs model search now ignores letter case and Turkish character variants, so a model named MINECRAFT can be found by typing Minecraft.' },
      { tr: 'Alan eşlemeleri {tablo, ad, tür} nesnesi olarak saklandığında otomatik DAX artık nesneyi [object Object] metnine çevirmiyor; gerçek tablo ve sütun adını kullanıyor.', en: 'When field mappings are stored as {table, name, kind} objects, automatic DAX no longer serializes them as [object Object] and uses the actual table and column names.' },
      { tr: 'Ölçü bulunmasa bile alanlar birden fazla tablodan geliyorsa ilişkili tabloları güvenli birleştirmek için SUMMARIZECOLUMNS seçiliyor.', en: 'Even without measures, SUMMARIZECOLUMNS is selected when mapped columns come from multiple tables so related tables are combined safely.' },
      { tr: 'Herhangi bir kod yolu yeniden [object Object] içeren sorgu üretirse sorgu modele gönderilmeden anlaşılır alan eşleme hatasıyla durduruluyor.', en: 'If any code path produces a query containing [object Object] again, it is stopped before reaching the model with a clear field-mapping error.' },
    ],
  },
  {
    v: '3.45', date: '2026-07-30',
    title: { tr: 'TPs tema uyumu ve kaydırılabilir model listesi', en: 'Theme-safe TPs filters and scrollable model list' },
    items: [
      { tr: 'TPs penceresindeki dosya durumu ve sıralama seçimleri, işletim sisteminin beyaz yerel çekmecesi yerine uygulamanın tema değişkenlerini kullanan özel seçim menüsüne geçirildi.', en: 'The file-status and sorting controls in the TPs window now use the application\'s theme-aware custom picker instead of the operating system\'s white native drawer.' },
      { tr: 'Açık, gri, antrasit ve karanlık temalarda seçim yüzeyi, metin, seçili satır ve hover renkleri ilgili temadan geliyor; yerel select için de tema uyumlu güvenli geri dönüş tanımlandı.', en: 'Light, grey, charcoal and dark themes now supply the picker surface, text, selected-row and hover colours, with a theme-aware native-select fallback as well.' },
      { tr: 'Sol model listesi gerçek bir bağımsız dikey kaydırma alanına dönüştürüldü; panel ve grid yükseklik kısıtları düzeltilerek uzun model listelerinin tamamına erişim sağlandı.', en: 'The left model list is now an independent vertical scroll area; panel and grid height constraints were corrected so long model lists remain fully reachable.' },
    ],
  },
  {
    v: '3.44', date: '2026-07-30',
    title: { tr: 'Yenilemenin doğrudan veri modeli bağlantılarından yapılması', en: 'Refresh directly from data model connections' },
    items: [
      { tr: 'Ana Yenile işlemi artık ASAS ve Antrepo Excel dosyalarını kaynak klasörden okumuyor; Data Model Connection ekranında Yenile için etkinleştirilen bağlantıları doğrudan sorguluyor.', en: 'The main Refresh action no longer reads the ASAS and Antrepo Excel workbooks from the source folder; it queries the connections enabled for Refresh in Data Model Connection directly.' },
      { tr: 'ASAS rolünden gelen satırlar CP Tracker, Backlog ve LFL verisini; Antrepo rolünden gelen satırlar operasyon ve depo durumlarını besliyor.', en: 'Rows from the ASAS role feed CP Tracker, Backlog and LFL, while rows from the Antrepo role feed operational and warehouse status data.' },
      { tr: 'Her bağlantının ufuk, alan eşlemesi ve otomatik veya manuel DAX ayarları ana yenilemede kullanılıyor. Aynı rol için yalnız bir bağlantı etkin tutuluyor.', en: 'Each connection\'s horizon, field mapping and automatic or manual DAX settings are used by the main refresh. Only one connection remains active for each role.' },
      { tr: 'Son başarılı model sonucu kullanıcı bazında sıkıştırılmış yerel snapshot olarak saklanıyor ve program yeniden açıldığında kaynak Excel klasörüne dönmeden geri yükleniyor.', en: 'The last successful model result is stored as a compressed per-user local snapshot and restored on startup without returning to the Excel source folder.' },
      { tr: 'Yenileme hataları artık Data Model Connection rol ve eşlemelerini, ağ bağlantısını ve şirket dışındaki VPN girişini kontrol etmeye yönlendiriyor.', en: 'Refresh errors now direct the user to check Data Model Connection roles and mappings, network access and VPN sign-in outside the company network.' },
    ],
  },
  {
    v: '3.43', date: '2026-07-30',
    title: { tr: 'Ölçülerin bulunması ve tüm modeli tarayan otomatik eşleme', en: 'Measure discovery and whole-model automatic mapping' },
    items: [
      { tr: 'Alan keşfi artık ölçüleri de buluyor. FOB Fiyatı ve miktar alanları modelde boyut sütunu değil, "ASAS / Miktarlar" gibi klasörlerdeki ölçülerdir; önceki sürüm yalnız boyut sütunlarına baktığı için bu alanları hiç göremiyordu.', en: 'Field discovery now also finds measures. FOB price and quantity fields are not dimension columns but measures inside folders such as "ASAS / Miktarlar", and the previous version looked only at dimension columns, so it never saw them.' },
      { tr: '"Otomatik Eşle" artık modelin tamamını tarıyor. Önce tablo seçme zorunluluğu kalktı; alanlar hangi tabloda veya ölçü grubunda olursa olsun bulunuyor ve en çok alanın geldiği tablo ufuk tablosu olarak öneriliyor.', en: '"Match automatically" now scans the whole model. Picking a table first is no longer required: fields are found wherever they live, and the table contributing the most fields is proposed as the horizon table.' },
      { tr: 'Eşleme tablosunda her alanın hangi tablodan veya hangi ölçü klasöründen geldiği gösteriliyor.', en: 'The mapping table shows which table or measure folder each field comes from.' },
      { tr: 'Ölçü içeren eşlemelerde sorgu SUMMARIZECOLUMNS ile üretiliyor — pivotun yaptığı işin aynısı. Ölçüler SELECTCOLUMNS içinde doğru değerlendirilemediği için bu şart. Ölçü yoksa eski SELECTCOLUMNS şekli korunuyor.', en: 'Mappings containing measures now generate SUMMARIZECOLUMNS, which is what a pivot does. This is required because measures cannot be evaluated correctly inside SELECTCOLUMNS. Without measures the previous SELECTCOLUMNS shape is kept.' },
      { tr: 'Gruplanan sütunlar modelde "Tablo[Sütun]" adıyla döndüğü için çıktı başlıkları, uygulamanın beklediği adlara sonuç yazılırken çevriliyor.', en: 'Grouped columns come back named "Table[Column]", so output headers are translated to the names the application expects while the result is written.' },
    ],
  },
  {
    v: '3.42', date: '2026-07-30',
    title: { tr: 'Ufuk, alan eşlemesi ve LFL\'in aynı çekime bağlanması', en: 'Horizon, field mapping and LFL served by the same pull' },
    items: [
      { tr: 'Veri modeli penceresine "Ufuk" bölümü eklendi: sezon listesi ve tarih aralığı. İkisi VEYA ile birleşir — iki koşuldan birini sağlayan sipariş gelir. Böylece CP kayan tarih penceresini, LFL ise karşılaştırdığı sezonların tamamını aynı sorgudan alır.', en: 'A "Horizon" section was added to the data model window: a season list and a date range, combined with OR so an order matching either one is included. CP gets its rolling date window and LFL gets the full seasons it compares, from a single query.' },
      { tr: 'LFL için ayrı bir kaynak gerekmiyor. LFL\'in kullandığı alanların neredeyse tamamı sipariş tablosunda zaten var; Lisansör ve DTR/Non-DTR uygulamada lisanstan türetiliyor. Gerçekten eklenen tek alan "Marka Müdürlükleri".', en: 'LFL needs no separate source. Almost every field it uses already exists in the order table, and Licensor and DTR/Non-DTR are derived from the licence inside the application. The only field genuinely added is "Marka Müdürlükleri".' },
      { tr: 'Alan eşleme tablosu eklendi: solda uygulamanın beklediği başlıklar, sağda model sütunları. "Otomatik Eşle" düğmesi Türkçe karakter ve noktalama farklarını yok sayarak eşleştirir, eşleşmeyen ve eksik zorunlu alanları bildirir.', en: 'A field mapping table was added, listing the headers the application expects on the left and the model columns on the right. "Match automatically" ignores Turkish character and punctuation differences, and reports unmatched and missing required fields.' },
      { tr: 'Üretilen DAX sorgusu pencerede canlı gösteriliyor; ayarlar değiştikçe güncelleniyor.', en: 'The generated DAX query is shown live in the window and updates as the settings change.' },
      { tr: '"Satır Say" düğmesi, veri çekmeden ufka kaç satırın uyduğunu söylüyor. Hacim kararını çekim yapmadan vermeyi sağlar.', en: 'A "Count rows" action reports how many rows match the horizon without pulling any data, so the volume decision can be made before a full fetch.' },
      { tr: 'Sorgu modu seçilebilir: Otomatik (ufuk ve eşlemeden üretilir) veya Manuel DAX (keşif ve hata ayıklama için korunur).', en: 'The query mode is selectable: Automatic, built from the horizon and mapping, or Manual DAX, kept for exploration and debugging.' },
    ],
  },
  {
    v: '3.41', date: '2026-07-30',
    title: { tr: 'Yönetici yetkisi olmadan tablo listeleme', en: 'Table discovery without administrator rights' },
    items: [
      { tr: 'Tablo listesi artık yönetici yetkisi istemeyen görünümlerden okunuyor. Önceden yalnız TMSCHEMA sorgulanıyordu ve normal okuma yetkisine sahip hesaplar "needs to be an administrator to read the metadata" hatası alıyordu. Sırayla TMSCHEMA, ardından Excel\'in pivot alan listesini doldurduğu MDSCHEMA, ardından DBSCHEMA denenir ve ilk başarılı olan kullanılır.', en: 'Table discovery now falls back to views that do not require administrator rights. Previously only TMSCHEMA was queried, so accounts with plain read access received a "needs to be an administrator to read the metadata" error. TMSCHEMA, then the MDSCHEMA views Excel uses for its pivot field list, then DBSCHEMA are tried in order and the first that works is used.' },
      { tr: 'Sonuç panelinde tablo adlarının hangi kaynaktan okunduğu gösteriliyor.', en: 'The result panel shows which view the table names were read from.' },
      { tr: 'Bir tabloya tıklandığında o tablonun sütun adları da listeleniyor; sorguyu yazarken alan adları göz önünde oluyor.', en: 'Clicking a table also lists its column names, so field names are visible while writing the query.' },
      { tr: 'ModelQuery.ps1 artık UTF-8 BOM ile kaydediliyor. PowerShell 5.1 BOM\'suz dosyaları ANSI okuduğu için hata mesajlarındaki Türkçe karakterler bozuluyordu.', en: 'ModelQuery.ps1 is now saved with a UTF-8 byte order mark. PowerShell 5.1 reads files without one as ANSI, which garbled Turkish characters in error messages.' },
    ],
  },
  {
    v: '3.40', date: '2026-07-30',
    title: { tr: 'Veri modeli penceresinde ilk kullanım düzeltmeleri', en: 'First-use fixes in the data model window' },
    items: [
      { tr: '"Bilinen modelleri ekle" düğmesi sorgu kutusuna örnek tablo adını yazmayı bıraktı. Önceden bu metin gerçek sorgu sanılıp çalıştırılıyor ve model "Cannot find table" hatası döndürüyordu; artık sorgu boş gelir ve doğal ilk adım "Tabloları Listele" olur.', en: 'The "Add known models" button no longer writes the sample table name into the query box. That text used to run as a real query and the model answered with a "Cannot find table" error; the query now starts empty so the natural first step is "List tables".' },
      { tr: 'Sorgu kutusu boşken "Sorguyu Çalıştır" düğmesi kapalı duruyor, sorgu yazıldığında açılıyor.', en: 'The "Run query" button stays disabled while the query box is empty and enables as soon as a query is written.' },
      { tr: 'PowerShell çıktısı UTF-8 olarak sabitlendi; hata mesajlarındaki Türkçe karakterler artık bozulmuyor.', en: 'PowerShell output is now fixed to UTF-8, so Turkish characters in error messages are no longer garbled.' },
      { tr: 'Modelde bulunmayan bir tablo veya sütun adı artık "sözdizimi hatası" diye etiketlenmiyor; hata mesajı kullanıcıyı tablo listesine yönlendiriyor.', en: 'A table or column name that does not exist in the model is no longer labelled a syntax error; the message points to the table list instead.' },
    ],
  },
  {
    v: '3.39', date: '2026-07-30',
    title: { tr: 'Veri modeline doğrudan bağlanma (Kaynak penceresinde yeni düğme)', en: 'Direct data model connection (new button in the Source panel)' },
    items: [
      { tr: 'Kaynak Veri penceresine "Veri Modeli Bağlantısı" düğmesi eklendi. Kaynak Excel dosyalarındaki pivotların bağlı olduğu tabular modele (ör. lcwtabular_s30 / ASAS_30, lcwtabular_p32 / IASv2) Excel açılmadan bağlanılabiliyor.', en: 'A "Data Model Connection" button was added to the Source Data panel. It connects to the tabular model behind the source pivots (for example lcwtabular_s30 / ASAS_30 and lcwtabular_p32 / IASv2) without opening Excel.' },
      { tr: 'Pencerede birden çok bağlantı kaydedilebiliyor; "Tabloları Listele" modeldeki tablo adlarını getiriyor, "Sorguyu Çalıştır" yazılan DAX sorgusunu çalıştırıp sonucu CSV veya JSON olarak dışa aktarma klasörüne yazıyor.', en: 'Several connections can be stored. "List tables" returns the table names in the model and "Run query" executes the DAX query, writing the result to the export folder as CSV or JSON.' },
      { tr: 'Her çalıştırma sonrası satır sayısı, sütun sayısı, süre, kullanılan sağlayıcı ve ilk satırların önizlemesi gösteriliyor; böylece süre Excel yenilemesiyle karşılaştırılabiliyor.', en: 'Each run reports the row count, column count, duration, provider in use and a preview of the first rows, so the duration can be compared against the Excel refresh.' },
      { tr: 'Kaynak Veriden Güncelle akışı değişmedi: uygulama verisi hâlâ Excel dosyalarından okunuyor. Yeni bağlantı yalnız ölçüm ve dışa aktarma amaçlıdır.', en: 'Refresh From Source is unchanged: application data is still read from the Excel files. The new connection is for measurement and export only.' },
    ],
  },
  {
    v: '3.38', date: '2026-07-30',
    title: { tr: 'LFL yüzde renkleri, portföy detayı ve tablo bazlı Excel aktarımı', en: 'LFL percentage colours, portfolio drill-down and per-table Excel export' },
    items: [
      { tr: 'LFL tablolarındaki yüzde değişimleri üst FOB Change alanıyla aynı kurala bağlandı: negatif değerler yeşil, pozitif değerler kırmızı gösterilir.', en: 'Percentage changes in LFL tables now follow the top FOB Change rule: negative values are green and positive values are red.' },
      { tr: 'Comparison, Manufacturer Order Volumes ve Multi-dimensional Comparison tablolarında ilk metin hücresine çift tıklanınca seçimin gerçek güncel ve kıyas portföy satırlarını gösteren ayrıntı penceresi açılır.', en: 'Double-clicking the first text cell in Comparison, Manufacturer Order Volumes or Multi-dimensional Comparison opens the real current and comparison portfolio rows for that selection.' },
      { tr: 'Portföy ayrıntı penceresine ve LFL sayfasındaki her veri tablosuna ayrı Excel dışa aktarma düğmesi eklendi; tablo düğmeleri Columns kontrolünün solunda bulunur.', en: 'The portfolio detail dialog and every LFL data table now have their own Excel export action, positioned to the left of Columns for tables.' },
    ],
  },
  {
    v: '3.37', date: '2026-07-30',
    title: { tr: 'Not değişikliklerinin Overview alanına canlı yansıtılması', en: 'Live Overview updates for note changes' },
    items: [
      { tr: 'CP tablosunda Notes veya Ek Not kaydedildiğinde Overview sayfasındaki Not Hatırlatıcısı artık sayfa yenilemeden güncellenir.', en: 'Saving Notes or Additional Notes in the CP table now updates the Overview Notes Reminder without reloading the page.' },
      { tr: 'Not silme ile geri al/ileri al işlemleri de aynı canlı güncelleme zincirini kullanır.', en: 'Clearing notes and undo/redo operations use the same live-update path.' },
      { tr: 'Arka arkaya gelen satır değişiklikleri tek ekran karesinde birleştirilerek gereksiz Overview çizimleri önlenir.', en: 'Rapid row changes are coalesced into one animation frame to avoid unnecessary Overview redraws.' },
    ],
  },
  {
    v: '3.36', date: '2026-07-30',
    title: { tr: 'Tümünü seç işleminde seçimli eylemlerin etkinleştirilmesi', en: 'Selection actions enabled after Select All' },
    items: [
      { tr: 'CP tablosundaki Tümünü Seç işlemi artık tekil satır seçimiyle aynı seçim değişikliği olayını tetikler.', en: 'Select All in the CP table now triggers the same selection-change event as selecting individual rows.' },
      { tr: 'Create OC, Prepaire E-Mail, Nakliye Kıyaslamaya Aktar ve Koleksiyona Kopyala düğmeleri toplu seçim veya seçimi kaldırma sonrasında anında güncellenir.', en: 'Create OC, Prepaire E-Mail, transfer to Shipping Comparison and copy to Collection actions now update immediately after selecting or clearing all rows.' },
      { tr: 'Ortak tablo altyapısında tekil ve toplu checkbox değişiklikleri tek bir onSelectionChange geri çağrısına bağlandı.', en: 'Individual and bulk checkbox changes in the shared table framework now use one onSelectionChange callback.' },
    ],
  },
  {
    v: '3.35', date: '2026-07-30',
    title: { tr: 'Source Data penceresinin düğmeye bağlı konumlandırılması', en: 'Source Data popover anchored to its button' },
    items: [
      { tr: 'Source Data penceresi artık sol alt köşede bağımsız açılmak yerine Source Data düğmesinin hemen sağında, sayfa içeriğinin üzerinde açılır.', en: 'The Source Data panel now opens immediately to the right of the Source Data button, above the page content, instead of appearing independently in the lower-left corner.' },
      { tr: 'Pencere boyutu ve dikey konumu ekran sınırlarına göre ayarlanır; dar ekranlarda güvenli tam genişlik yerleşimine geçer.', en: 'The panel size and vertical position are clamped to the viewport, with a safe full-width fallback on narrow screens.' },
      { tr: 'Pencere açıkken ekran boyutu, kaydırma veya sol menünün daraltılması değişirse konumu düğmeye göre yeniden hesaplanır.', en: 'While open, the panel is repositioned against the button after resizing, scrolling or collapsing the navigation rail.' },
    ],
  },
  {
    v: '3.34', date: '2026-07-29',
    title: { tr: 'LFL tablolarının CP tablo altyapısıyla birleştirilmesi', en: 'LFL tables unified with the CP table framework' },
    items: [
      { tr: 'LFL sayfasındaki tüm veri tabloları CP Tracker ile aynı ortak tablo çizici ve sütun filtre altyapısını kullanır.', en: 'All data tables on the LFL page now use the same shared table renderer and column-filter framework as CP Tracker.' },
      { tr: 'Sıralama, değer/sayı/tarih filtreleri, arama, çoklu seçim, aktif filtre göstergeleri ve filtre penceresi davranışları CP ile birebir aynıdır.', en: 'Sorting, value/number/date filters, search, multi-selection, active-filter indicators and filter-popover behaviour now match CP exactly.' },
      { tr: 'Sütun sırası, genişlik ayarı, görünürlük yönetimi, sütun dondurma ve filtre temizleme işlemleri bütün LFL tablolarında kullanılabilir.', en: 'Column ordering, resizing, visibility management, freezing and clearing filters are available across all LFL tables.' },
    ],
  },
  {
    v: '3.33', date: '2026-07-29',
    title: { tr: 'LFL çok boyutlu karşılaştırmanın tek panel görünümü', en: 'Single-pane LFL multidimensional comparison' },
    items: [
      { tr: 'Çok Boyutlu Karşılaştırma alanındaki sol özet penceresi kaldırıldı.', en: 'The left summary pane was removed from the Multi-dimensional Comparison area.' },
      { tr: 'Ayrıntılı karşılaştırma tablosu kartın tüm kullanılabilir genişliğini kullanır.', en: 'The detailed comparison table now uses the full available width of the card.' },
    ],
  },
  {
    v: '3.32', date: '2026-07-29',
    title: { tr: 'LFL kıyas ve üretici hacimlerinin yan yana görünümü', en: 'Side-by-side LFL comparison and manufacturer volumes' },
    items: [
      { tr: 'Grup bazlı Comparison tablosu ile Manufacturer Order Volumes bölümü geniş ekranlarda aynı satırda yan yana yerleştirildi.', en: 'The group Comparison table and Manufacturer Order Volumes section are placed side by side on wide screens.' },
      { tr: 'Her iki kart eşit kullanılabilir alanı paylaşır; tablo ve üretici listesi kendi içinde kaydırılabilir kalır.', en: 'Both cards share the available row while the comparison table and manufacturer list remain independently scrollable.' },
      { tr: '1280 piksel ve altındaki ekranlarda kartlar okunabilirliği korumak için yeniden alt alta yerleşir.', en: 'At 1280 pixels and below, the cards stack again to preserve readability.' },
    ],
  },
  {
    v: '3.31', date: '2026-07-29',
    title: { tr: 'LFL tablo filtrelerinin başlığa bağlı konumlandırılması', en: 'Header-anchored LFL table filters' },
    items: [
      { tr: 'LFL tablolarındaki sütun filtre pencereleri sayfa, tablo veya kaydırılabilir kapsayıcı hareket ettikçe ilgili sütun başlığına göre yeniden konumlandırılır.', en: 'Column-filter popovers in LFL tables are repositioned against their header whenever the page, table or a scrollable container moves.' },
      { tr: 'Filtre düğmesi görünüm alanından çıktığında pencere otomatik kapanır; ekranda açıldığı konumda sabit kalmaz.', en: 'The popover closes automatically when its filter button leaves the viewport instead of remaining fixed at its opening position.' },
    ],
  },
  {
    v: '3.30', date: '2026-07-29',
    title: { tr: 'LFL hacimlerinin yalnız rakamsal gösterimi', en: 'Numeric-only LFL volume display' },
    items: [
      { tr: 'LFL sayfasındaki üretici hacmi ve çok boyutlu karşılaştırma grafik çubukları kaldırıldı.', en: 'Graphical bars were removed from the manufacturer-volume and multidimensional-comparison areas on the LFL page.' },
      { tr: 'Güncel ve kıyas sezonu sipariş hacimleri, sezon adlarıyla birlikte doğrudan rakamsal olarak gösterilir.', en: 'Current and comparison-season order volumes are now displayed directly as numbers with their season labels.' },
      { tr: 'Sipariş sayıları, sezon FOB değerleri, FOB değişimleri ve ayrıntılı karşılaştırma tabloları korunmuştur.', en: 'Order counts, seasonal FOB values, FOB changes and detailed comparison tables remain available.' },
    ],
  },
  {
    v: '3.29', date: '2026-07-29',
    title: { tr: 'LFL Marka Müdürlükleri filtresi', en: 'LFL Brand Directorates filter' },
    items: [
      { tr: 'LFL KAYNAK dosyasındaki Marka Müdürlükleri sütunu okunarak LFL filtrelerine yeni bir çoklu seçim alanı eklendi.', en: 'The Brand Directorates column in the LFL source workbook is now read and exposed as a new multi-select LFL filter.' },
      { tr: 'Filtre; güncel ve kıyas portföyü, KPI’lar, üretici hacimleri, özel karşılaştırmalar, analiz tabloları ve Excel dışa aktarımının tamamına uygulanır.', en: 'The filter applies throughout the current and comparison portfolios, KPIs, manufacturer volumes, custom comparisons, analysis tables and Excel export.' },
      { tr: 'Marka Müdürlükleri seçimi hazır filtrelerle birlikte kaydedilir ve filtre penceresindeki arama desteğini kullanır.', en: 'Brand Directorate selections are saved with ready filters and support search inside the filter popover.' },
    ],
  },
  {
    v: '3.28', date: '2026-07-29',
    title: { tr: 'LFL sezon FOB görünümü ve CP tipi tablo filtreleri', en: 'LFL seasonal FOB view and CP-style table filters' },
    items: [
      { tr: 'Üretici Sipariş Hacimleri bölümünde güncel ve kıyas sezonlarının ağırlıklı FOB değerleri, FOB değişiminin yanında ayrı ayrı gösterilir.', en: 'Manufacturer Order Volumes now shows the current and comparison seasons’ weighted FOB values separately beside the FOB change.' },
      { tr: 'Grup kıyası, Seçili Portföy Detayı ve Kıyaslanan Portföy Detayı tablolarındaki sabit filtre satırları kaldırıldı; CP tablosundaki gibi sütun başlığı filtre düğmeleri eklendi.', en: 'The fixed filter rows were removed from the group comparison, Selected Portfolio Detail and Comparison Portfolio Detail tables, and CP-style header filter buttons were added.' },
      { tr: 'Sütun başlığı metnine tıklayarak artan/azalan sıralama yapılır; filtre menüsünde arama, değer seçimi ve filtreyi kaldırma işlemleri kullanılabilir.', en: 'Clicking a column-header label sorts ascending or descending, while the filter menu supports search, value selection and removing the filter.' },
      { tr: 'Güncel/Kıyas In-Store, Ülke, MAG, MMYG, Klasman, Üretici, Buying Group ve Buyer filtrelerinin açılır pencerelerindeki arama görünürlüğü düzeltildi.', en: 'Search visibility was fixed inside the Current/Comparison In-Store, Country, MAG, MMYG, Classification, Manufacturer, Buying Group and Buyer filter popovers.' },
    ],
  },
  {
    v: '3.27', date: '2026-07-29',
    title: { tr: 'LFL esnek kırılım ve çok boyutlu karşılaştırma', en: 'Flexible LFL breakdowns and multidimensional comparison' },
    items: [
      { tr: 'LFL filtrelerinin iç araması nokta, boşluk ve Türkçe karakter farklarına dayanıklı hale getirildi; K.KOL gibi parçalı aramalar seçeneklerin herhangi bir bölümünde eşleşir.', en: 'Search inside LFL filters is now tolerant of punctuation, spacing and Turkish characters, so partial queries such as K.KOL match anywhere in an option.' },
      { tr: 'Analiz kırılımı en fazla dört seviyede serbestçe kurulabilir. MAG + Ülke + Klasman gibi birleşimler gerçek alt detay grupları olarak hesaplanır.', en: 'Analysis breakdowns can be built freely with up to four levels. Combinations such as MAG + Country + Classification are calculated as actual nested groups.' },
      { tr: 'Özel kıyas alanı üç kırılıma kadar gerçek portföy kesişimleri üretir. Seçilen referans gruba göre hacim, sipariş sayısı ve FOB farkları ayrıca gösterilir.', en: 'The custom comparison area creates actual portfolio intersections across up to three dimensions and also shows volume, order-count and FOB differences against a selected reference group.' },
      { tr: 'Grup kıyası ile güncel ve kıyas portföyü tablolarına sütun bazlı filtreleme ve sıralama eklendi. Fiyat iyileştirmeleri negatif ve yeşil, fiyat artışları pozitif ve kırmızı gösterilir.', en: 'Column filtering and sorting were added to the group, current-portfolio and comparison-portfolio tables. Price improvements are shown as negative green values, while increases are positive red values.' },
      { tr: 'Üretici Sipariş Hacimleri alanı sipariş miktarına ek olarak ağırlıklı FOB değişimini gösterir; En Yüksek Hacimli Gruplar grafiği kaldırıldı.', en: 'Manufacturer Order Volumes now shows weighted FOB change alongside order quantity, and the Highest Volume Groups chart was removed.' },
    ],
  },
  {
    v: '3.26', date: '2026-07-29',
    title: { tr: 'LFL özel seçim karşılaştırma oluşturucusu', en: 'LFL custom selection comparison builder' },
    items: [
      { tr: 'LFL sayfasına MAG, MMYG, Klasman, Buyer, Buying Group, Ülke, Üretici veya MAG · MMYG · Klasman kırılımında özel değerler seçerek karşılaştırma yapabileceğin yeni bir alan eklendi.', en: 'A new LFL area lets you select and compare specific values by MAG, MMYG, Classification, Buyer, Buying Group, Country, Manufacturer or MAG · MMYG · Classification.' },
      { tr: 'En fazla 10 seçim; güncel ve kıyas sezonu sipariş hacmi, sipariş sayısı, ağırlıklı FOB, hacim değişimi ve fiyat iyileştirmesiyle çift çubuklu grafik ve ayrıntılı tabloda yan yana gösteriliyor.', en: 'Up to 10 selections are shown side by side in a dual-bar chart and detailed table with current/comparison volume, order count, weighted FOB, volume change and price improvement.' },
      { tr: 'Ana LFL filtreleri korunurken yalnız karşılaştırılan boyutun genel filtresi bu kartta kart içi seçimlerle değiştirilir. Özel kıyas sonuçları Excel dışa aktarımına da eklenir.', en: 'All main LFL filters remain active, while only the compared dimension’s global filter is replaced by the card selections. Custom comparison results are also included in Excel export.' },
    ],
  },
  {
    v: '3.25', date: '2026-07-29',
    title: { tr: 'LFL üretici sipariş hacmi karşılaştırması', en: 'LFL manufacturer order-volume comparison' },
    items: [
      { tr: 'LFL sayfasına, mevcut En Yüksek Hacimli grup analizine ek olarak üreticilerin sipariş hacimlerini gösteren yeni bir bölüm eklendi.', en: 'A new section showing manufacturer order volumes was added to the LFL page alongside the existing highest-volume group analysis.' },
      { tr: 'Üreticiler güncel sezon sipariş adedine göre büyükten küçüğe sıralanıyor; güncel ve kıyas sezonu adetleri aynı satırdaki iki çubukla karşılaştırılıyor.', en: 'Manufacturers are ranked by current-season order quantity, with current and comparison-season quantities displayed as two bars on the same row.' },
      { tr: 'Bölüm tüm LFL sezon, dönem, ülke, MAG, MMYG, klasman, üretici, Buying Group ve Buyer filtrelerine uyar; her üretici için iki sezondaki benzersiz sipariş sayısı da gösterilir.', en: 'The section follows all LFL season, period, country, MAG, MMYG, classification, manufacturer, Buying Group and Buyer filters, and also shows unique order counts for both seasons.' },
    ],
  },
  {
    v: '3.24', date: '2026-07-29',
    title: { tr: 'Tablo seçim ve toplam kapsülünün hizalanması', en: 'Aligned table selection and total pill' },
    items: [
      { tr: 'Tabloların alt satırındaki Total/Toplam etiketi, seçili satır sayısıyla aynı kapsül içine alındı.', en: 'The Total label in table footers now shares the same pill as the selected-row count.' },
      { tr: 'Seçim sayısı ayrı, sağ hizalı ve tabular rakamlı bir bölümde gösterildiği için sayı büyüdükçe Total metniyle çakışmıyor.', en: 'The selected count is displayed in a separate right-aligned tabular-number area, preventing overlap with the Total label as the number grows.' },
      { tr: 'Kapsül ortak tablo alt toplam bileşeninde düzenlendi; CP Tracker ve Nakliye gibi seçimli toplam tabloları aynı davranışı kullanıyor.', en: 'The shared table-footer component was updated, so selectable total tables such as CP Tracker and Shipping use the same behavior.' },
    ],
  },
  {
    v: '3.23', date: '2026-07-29',
    title: { tr: 'Prepaire Email üretici listesinin alfabetik sıralanması', en: 'Alphabetical manufacturer sorting in Prepare Email' },
    items: [
      { tr: 'Prepaire Email açılır penceresindeki kayıtlı üretici listesi A’dan Z’ye sıralanacak şekilde güncellendi.', en: 'The saved manufacturer list in the Prepare Email dialog is now sorted from A to Z.' },
      { tr: 'Sıralama Türkçe ve İngilizce karakterlere duyarlıdır; üretici düzenleme veya ekleme sonrasında liste anında yeniden sıralanır.', en: 'Sorting is locale-aware for Turkish and English characters, and the list is immediately re-sorted after editing or adding a manufacturer.' },
      { tr: 'Seçili üreticiler bölümü de aynı alfabetik sırayı kullanırken seçim, düzenleme ve silme işlemleri üreticinin gerçek kayıt indeksini korur.', en: 'The selected-manufacturers section uses the same alphabetical order while selection, editing and deletion preserve each manufacturer’s actual record index.' },
    ],
  },
  {
    v: '3.22', date: '2026-07-29',
    title: { tr: 'Not odaklı Overview hatırlatıcısı', en: 'Note-focused Overview reminder' },
    items: [
      { tr: 'Overview sayfasındaki Önceliklendirme Hatırlatıcısı, risk puanı yerine yalnız Notes veya Ek Not alanı dolu siparişleri gösterecek şekilde değiştirildi.', en: 'The Overview Prioritisation Reminder was changed to show only orders with a value in Notes or Additional Notes instead of calculating risk scores.' },
      { tr: 'Aynı not metnine sahip siparişler tek not kartı altında birlikte gösteriliyor; not karşılaştırması büyük-küçük harf ve gereksiz boşluklardan etkilenmiyor.', en: 'Orders with identical note text are grouped under one note card; matching ignores letter case and redundant whitespace.' },
      { tr: 'Her gruptaki siparişler sipariş koduna göre sıralanıyor ve siparişe tıklanınca ilgili kayıt CP Tracker’da açılıyor.', en: 'Orders within each group are sorted by order code, and clicking an order opens the related record in CP Tracker.' },
    ],
  },
  {
    v: '3.21', date: '2026-07-29',
    title: { tr: 'TPs arama, dosya filtreleri ve kalıcı temizlik', en: 'TPs search, file filters and permanent cleanup' },
    items: [
      { tr: 'TPs penceresine model adıyla anlık arama, dosyası olan/olmayan filtreleri ve model adı veya dosya durumuna göre sıralama seçenekleri eklendi.', en: 'The TPs window now includes live model-name search, filters for models with or without files, and sorting by model name or file status.' },
      { tr: 'Model kartlarındaki kırmızı ve yeşil dosya göstergeleri daha küçük, sade ve minimal LED görünümüne geçirildi.', en: 'The red and green file indicators on model cards were changed to a smaller, cleaner and more minimal LED style.' },
      { tr: 'Koleksiyon modelinin silinmesi sırasında ilişkili TPs dosyaları önce bilgisayardaki fiziksel depodan ve index kaydından kaldırılıyor. Temizlik başarısız olursa model satırı silinmeyerek yetim dosya oluşması engelleniyor.', en: 'When a Collection model is deleted, its related TPs files are first removed from physical storage and the index. If cleanup fails, the model row is not deleted, preventing orphaned files.' },
    ],
  },
  {
    v: '3.20', date: '2026-07-29',
    title: { tr: 'Akıllı Önceliklendirme Hatırlatıcısı', en: 'Smart Prioritisation Reminder' },
    items: [
      { tr: 'Overview sayfasına, mevcut filtrelere göre riskli siparişleri otomatik sıralayan Önceliklendirme Hatırlatıcısı eklendi.', en: 'A Prioritisation Reminder was added to Overview, automatically ranking risky orders under the current filters.' },
      { tr: 'Risk puanı; mevcut Priority işaretleri, Ex-factory tarihinin yakınlığı veya gecikmesi, eksik onaylar, kalan sipariş oranı, retail/tahmini varış gecikmeleri ve eksik kritik bilgiler birlikte değerlendirilerek hesaplanıyor.', en: 'Risk scores combine existing Priority flags, ex-factory proximity or delay, incomplete approvals, remaining-order ratio, overdue retail/estimated-arrival dates and missing critical information.' },
      { tr: 'En riskli sekiz sipariş gerekçeleriyle gösteriliyor; depoya ulaşmış siparişler dışarıda bırakılıyor ve karta tıklanınca ilgili sipariş CP Tracker’da açılıyor.', en: 'The eight highest-risk orders are shown with reasons; warehouse-completed orders are excluded, and clicking a card opens the order in CP Tracker.' },
    ],
  },
  {
    v: '3.19', date: '2026-07-29',
    title: { tr: 'Canlı e-posta başlığı ön izlemesi ve Subject terminolojisi', en: 'Live e-mail subject preview and Subject terminology' },
    items: [
      { tr: 'Konu düzenleme penceresinde Add to Subject alanları, üretici, seçili sipariş/model değerleri, düzenlenebilir başlık ve tarih kullanılarak oluşacak nihai e-posta başlığı anlık gösteriliyor.', en: 'The subject editor now shows the final e-mail subject live using the Add to Subject fields, manufacturer, selected order/model values, editable title and date.' },
      { tr: 'Prepaire E-Mail ekranındaki Email Topics, Topic, Add to Topic ve ilgili düğme/uyarı metinleri E-mail Subjects, Subject ve Add to Subject terminolojisine geçirildi.', en: 'Email Topics, Topic, Add to Topic and related button/message text on the Prepare E-Mail screen were renamed to E-mail Subjects, Subject and Add to Subject.' },
      { tr: 'E-mail Subjects listesindeki kategori etiketi kaldırıldı. Her seçenek artık yalnız Subject Name alanına girilen ana başlığı gösteriyor.', en: 'The category label was removed from the E-mail Subjects list. Each option now shows only the main heading entered in Subject Name.' },
    ],
  },
  {
    v: '3.18', date: '2026-07-29',
    title: { tr: 'Backlog Pivot stili ve kalın model başlıkları', en: 'Backlog Pivot style and bold model headers' },
    items: [
      { tr: 'Excel içinde BACKLOG tablosundan sonradan oluşturulan PivotTable’ların başlık stili daha katı hâle getirildi. Tüm Pivot başlık, alt başlık, filtre, subtotal ve toplam bölgeleri doğrudan #F2F4F7 zemin ve #475467 yazı rengine bağlandı.', en: 'The header style for PivotTables created later from the BACKLOG data was made more deterministic. All Pivot header, subheading, filter, subtotal and total regions now use a direct #F2F4F7 fill and #475467 text colour.' },
      { tr: 'Pivot diferansiyel dolgusuna ön plan ve arka plan için aynı doğrudan RGB rengi yazılıyor; Excel tema veya varsayılan stilinden siyah dolgu devralınması engelleniyor.', en: 'The Pivot differential fill now writes the same direct RGB value to both foreground and background, preventing a black fill from being inherited from an Excel theme or default style.' },
      { tr: 'BACKLOG sayfasındaki Sipariş Kod ve Model Adı sütun başlıkları sarı vurgularını koruyarak kalın yazıya geçirildi.', en: 'The Order Code and Model Name column headers on the BACKLOG sheet are now bold while retaining their yellow emphasis.' },
    ],
  },
  {
    v: '3.17', date: '2026-07-29',
    title: { tr: 'Send to Pricing ayrımı ve sade konu düzenleyicisi', en: 'Isolated Send to Pricing and simplified topic editor' },
    items: [
      { tr: 'Send to Pricing artık varsayılan olarak yalnız kendi Quotation Excel’ini, fiyatlama e-posta metnini, ön izlemesini ve model dosyalarını oluşturuyor. Seçili sipariş/model bilgilerini içeren ilave Excel ve gövde tablosu ancak konu ayarlarında ayrı ayrı açılırsa ekleniyor.', en: 'Send to Pricing now defaults to only its own Quotation Excel, pricing email text, preview and model files. The additional selected-order/model Excel and body table are added only when their separate topic settings are enabled.' },
      { tr: 'Yerleşik Production Status Request konusu kaldırıldı; eski tarayıcı kayıtlarında kalan prodstatus dalı da otomatik temizleniyor.', en: 'The built-in Production Status Request topic was removed, and any legacy prodstatus branch remaining in browser storage is automatically cleaned up.' },
      { tr: 'Konu satırındaki kalem düğmesi artık ayrı Email Templates/taslak kütüphanesi açmıyor. Tek düzenleme penceresinde taslak metni, e-posta konu başlığı, ayrı Excel eki, gövde tablosu, sütunlar ve Konuya Ekle alanları birlikte yönetiliyor; ayrı ataç düğmesi kaldırıldı.', en: 'The pencil button no longer opens a separate Email Templates/draft library. One editor now manages the draft text, email subject title, separate Excel attachment, body table, columns and Add to Topic fields; the separate paperclip button was removed.' },
    ],
  },
  {
    v: '3.16', date: '2026-07-29',
    title: { tr: 'Backlog Excel sabit başlık ve Pivot renkleri', en: 'Backlog Excel frozen header and Pivot colours' },
    items: [
      { tr: 'Backlog Excel raporundaki BACKLOG sayfasının ilk satırı donduruldu; aşağı kaydırıldığında sütun başlıkları görünür kalıyor.', en: 'The first row of the BACKLOG sheet is now frozen, keeping column headers visible while scrolling.' },
      { tr: 'Hazır Pivot sayfasının başlık hücreleri #F2F4F7 zemin ve #475467 yazı rengine geçirildi.', en: 'Header cells on the prepared Pivot sheet now use a #F2F4F7 fill and #475467 text.' },
      { tr: 'Excel içinde sonradan oluşturulan PivotTable’ların siyah başlığa düşmemesi için özel varsayılan Pivot stili eksiksiz whole-table ve header tanımlarıyla, Office temasından bağımsız doğrudan RGB renkleriyle yeniden kuruldu.', en: 'The custom default PivotTable style was rebuilt with complete whole-table and header definitions plus direct RGB colours, preventing newly created PivotTables from falling back to black Office-theme headers.' },
    ],
  },
  {
    v: '3.15', date: '2026-07-29',
    title: { tr: 'E-posta konu satırı sıralaması', en: 'Email subject-line ordering' },
    items: [
      { tr: 'Prepaire E-Mail konu satırları artık seçime bağlı olarak MMYG, MAG, Sezon, Üretici, diğer seçili sütun içerikleri, düzenlenebilir konu başlığı ve tarih sırasıyla oluşturuluyor.', en: 'Prepare Email subject lines are now composed, when selected, in this order: MMYG, MAG, Season, Manufacturer, other selected column values, editable subject title and date.' },
      { tr: 'MMYG, MAG ve Sezon seçilmiş alanlar arasında nerede görünürse görünsün konu satırının başına sabit sırayla taşınıyor; diğer seçilmiş alanların kendi mevcut sırası korunuyor.', en: 'MMYG, MAG and Season are moved to the beginning in a fixed order wherever they appear among selected fields, while the existing order of all other selected fields is preserved.' },
    ],
  },
  {
    v: '3.14', date: '2026-07-29',
    title: { tr: 'TPs tüm model kapsamı ve dosya durum LED’leri', en: 'All-model TPs scope and file-status LEDs' },
    items: [
      { tr: 'Koleksiyon TPs penceresi artık seçim yapılmadan açıldığında tüm modelleri listeler; en az bir model seçilmişse yalnızca seçili modellerle çalışır.', en: 'The Collection TPs window now lists every model when opened without a selection; when at least one model is selected it works only with the selected models.' },
      { tr: 'Her model kutusunun en sağına dosya durum LED’i eklendi: yeşil dosya bulunduğunu, kırmızı ise model için henüz dosya yüklenmediğini gösterir. Dosya ekleme veya silme sonrasında gösterge anında yenilenir.', en: 'A file-status LED was added to the far right of every model card: green means files are available and red means no file has been uploaded for the model. The indicator refreshes immediately after uploads or deletions.' },
      { tr: 'Tüm modellerin dosya bilgisi alınırken çok uzun istek adreslerini önlemek için model anahtarları güvenli gruplar hâlinde yüklenir.', en: 'When file information is loaded for all models, model keys are fetched in safe batches to prevent excessively long request URLs.' },
    ],
  },
  {
    v: '3.13', date: '2026-07-29',
    title: { tr: 'Konuya özel e-posta konu satırları', en: 'Topic-specific email subject lines' },
    items: [
      { tr: 'Her e-posta taslağı için listede görünen konu adından bağımsız bir “E-posta konu başlığı” alanı eklendi; kalem düğmesiyle açılan konu düzenleyicisinden değiştirilebiliyor.', en: 'Each email template now has an Email subject title independent from the topic name shown in the list, editable from the topic editor opened with the pencil button.' },
      { tr: 'Ataçla açılan sütun seçim ekranında Üretici ve her sütun için “Konuya Ekle / Add to Topic” seçimi eklendi. Ayarlar CP ve Koleksiyon için konu bazında ayrı saklanıyor.', en: 'The column picker opened from the paperclip now includes Add to Topic controls for Manufacturer and every source column. Settings are stored separately per topic for CP and Collection.' },
      { tr: 'Taslak konu satırı; isteğe bağlı üretici, düzenlenebilir konu başlığı, seçilen sütunların benzersiz içerikleri ve tarih sırasıyla oluşturuluyor. Birden fazla siparişte tekrar eden değerler tek kez yazılıyor.', en: 'Draft subjects are composed from the optional manufacturer, editable subject title, unique contents of selected source columns and the date. Repeated values across selected orders are written only once.' },
    ],
  },
  {
    v: '3.12', date: '2026-07-29',
    title: { tr: 'Koleksiyon için İptal durumu', en: 'Dropped status for Collection' },
    items: [
      { tr: 'Koleksiyon sayfasındaki Durum sütununa “İptal” seçeneği eklendi; İngilizce arayüzde aynı durum “Dropped” olarak gösteriliyor.', en: 'An “İptal” option was added to the Status column on the Collection page and is displayed as “Dropped” in the English interface.' },
    ],
  },
  {
    v: '3.11', date: '2026-07-29',
    title: { tr: 'Konu yönetimi ve konuya özel e-posta tabloları', en: 'Topic management and topic-specific email tables' },
    items: [
      { tr: 'Prepaire E-Mail konu satırlarının soluna tablo sütunu seçimi için ataç, konu düzenleme için kalem ve sonradan oluşturulan konuları silmek için çöp kutusu düğmeleri eklendi. Yerleşik Send to Pricing, Ask Production Status ve General E-Mail konuları yanlışlıkla silinmeye karşı korunuyor.', en: 'Prepare Email topic rows now have a paperclip for table-column selection, a pencil for editing and a trash button for deleting user-created topics. The built-in Send to Pricing, Ask Production Status and General E-Mail topics are protected from accidental deletion.' },
      { tr: 'Yeni konu düğmesi konu listesinin sabit üst bölümüne taşındı; pencerenin sol altındaki eski “Seçili konuyu düzenle” ve “Yeni konu” düğmeleri kaldırıldı.', en: 'The New Topic button moved to the fixed header of the topic list, and the old Edit Selected Topic and New Topic buttons were removed from the lower-left footer.' },
      { tr: 'Her e-posta konusu için CP ve Koleksiyon kaynaklarında kullanılacak tablo sütunları ayrı ayrı seçilip kaydedilebiliyor.', en: 'Table columns can now be selected and saved separately for CP and Collection sources for every email topic.' },
      { tr: 'Seçilen sütunlar taslak e-postanın gövdesine açık gri başlıklı HTML tablo olarak ekleniyor ve aynı veriler düzenlenebilir Excel dosyası olarak e-postaya iliştiriliyor. Send to Pricing mevcut Quotation Excel, Quotations kaydı ve model dosyası akışını korurken seçilen sipariş tablosunu da ekliyor.', en: 'Selected columns are inserted into the draft body as an HTML table with light-grey headers and attached as an editable Excel file. Send to Pricing keeps its existing Quotation Excel, Quotations record and model-file flow while also adding the selected order table.' },
    ],
  },
  {
    v: '3.10', date: '2026-07-29',
    title: { tr: 'E-posta hazırlama, görselli kopyalama ve Excel Pivot biçimi', en: 'Email preparation, image copy and Excel Pivot formatting' },
    items: [
      { tr: 'Koleksiyon satırları başlıkları ve biçimleriyle kopyalandığında model görselleri artık pano HTML’ine gerçek görsel olarak gömülüyor; Excel’e yapıştırmada görsel hücresi boş kalmıyor.', en: 'When Collection rows are copied with headers and formatting, model images are now embedded as real images in the clipboard HTML, so the image cell no longer stays empty when pasted into Excel.' },
      { tr: 'Ask Production Status ve Send to Pricing tek bir “E-Posta Hazırla / Prepaire E-Mail” penceresinde birleştirildi. Üretici alanının yanındaki Konu/Topic alanından kayıtlı taslak seçilebilir, düzenlenebilir veya yeni taslak oluşturulabilir.', en: 'Ask Production Status and Send to Pricing are unified in one “Prepaire E-Mail” window. A saved draft can be selected, edited or created from the Topic area next to the manufacturer area.' },
      { tr: 'Send to Pricing seçildiğinde Quotations kaydı, fiyatlama Excel’i ve kayıtlı model dosyaları çalışmaya devam ediyor. Diğer konular kayıtlı model dosyalarını otomatik almıyor; yalnız manuel eklenen dosyalar e-posta başına 9.5 MB sınırına göre sıkıştırılıyor veya bölünüyor.', en: 'When Send to Pricing is selected, the Quotations record, pricing Excel and stored model files continue to work. Other topics do not load stored model files automatically; only manually added files are compressed or split to stay below 9.5 MB per email.' },
      { tr: 'Üretim durumu e-postasındaki tablo başlıkları Send to Pricing Excel’iyle aynı açık gri zemin, koyu gri yazı ve ince gri çerçeve biçimini kullanıyor.', en: 'The production-status email table headers now use the same light-grey fill, dark-grey text and thin-grey border as the Send to Pricing Excel file.' },
      { tr: 'Backlog Excel dosyasına, yeni oluşturulan PivotTable başlıklarının rapor başlığıyla aynı renkleri kullanmasını sağlayan varsayılan BuyerLogPivot stili eklendi.', en: 'Backlog Excel files now include a default BuyerLogPivot style so newly created PivotTable headers use the same colours as the report header.' },
      { tr: 'Kaynak yenilemesi başarısız olduğunda yenileme düğmesi kırmızı yanıp sönüyor ve internet, VPN ile kaynak klasörde manuel güncelleme adımlarını açıklayan uyarı gösteriliyor.', en: 'When source refresh fails, the refresh button pulses red and a warning explains the internet, VPN and manual source-folder update steps.' },
    ],
  },
  {
    v: '3.09', date: '2026-07-29',
    title: { tr: 'Açılış hızı: tarih dönüşümü', en: 'Startup speed: date conversion' },
    items: [
      { tr: 'Sunucudan gelen veride her siparişin yedi tarih alanı tek tek dönüştürülüyor; 10.000 siparişte bu 140.000 dönüşüm demek. Dönüştürücü, sunucunun her zaman gönderdiği biçimi en son deniyordu ve aynı tarihi yüzlerce kez yeniden ayrıştırıyordu.', en: 'Every order has seven date fields that are converted one by one when data arrives from the server, which is 140,000 conversions for 10,000 orders. The converter tried the format the server always sends last, and re-parsed the same date hundreds of times.' },
      { tr: 'Artık en olası biçim ilk sırada deneniyor ve çözülen tarihler bellekte tutuluyor. Aynı iş ölçümde yüzde 79 daha hızlı tamamlanıyor. Sonuçlar birebir aynı; her çağrı yine kendi Date nesnesini alıyor, bellek paylaşılan nesne döndürmüyor.', en: 'The most likely format is now tried first and resolved dates are kept in memory. The same work completes 79 percent faster in measurement. Results are identical, and every call still gets its own Date object rather than a shared one.' },
      { tr: 'Davranışın değişmediği, eski ve yeni dönüştürücünün geniş bir girdi kümesinde birebir aynı sonucu verdiğini doğrulayan bir testle güvence altına alındı.', en: 'A test guards that behaviour did not change by checking that the old and new converters return identical results across a wide set of inputs.' },
    ],
  },
  {
    v: '3.08', date: '2026-07-29',
    title: { tr: 'Yeni görsel dil: Industry', en: 'New visual language: Industry' },
    items: [
      { tr: 'Tüm arayüz Claude Design’da hazırlanan Industry tasarımına taşındı: tek vurgu rengi çelik mavisi, açık zemin, kare köşeler, saç teli çerçeveler ve kartların dört köşesinde artı biçimli hizalama işaretleri.', en: 'The whole interface moved to the Industry design prepared in Claude Design: a single steel blue accent, a light ground, square corners, hairline frames and plus shaped registration marks at the four corners of each card.' },
      { tr: 'Yazı tipi Barlow ailesine geçti: başlıklar Barlow Condensed, gövde Barlow. Yazı tipleri programın içine kopyalandı, internetten indirilmiyor; çevrimdışı çalışma bozulmadı ve Türkçe karakterlerin tamamı destekleniyor.', en: 'Typography moved to the Barlow family: Barlow Condensed for headings, Barlow for body text. The fonts are bundled inside the program rather than downloaded, so offline use still works and every Turkish character is supported.' },
      { tr: 'Dört tema da yeni palete uyarlandı; tema düğmesi eskisi gibi Aydınlık, Gri, Antrasit ve Karanlık arasında geziyor.', en: 'All four themes were adapted to the new palette; the theme button still cycles through Light, Grey, Charcoal and Dark.' },
      { tr: 'Öncelik ve durum rozetlerinin renkleri ile tablo başlığı tonu bilerek korundu. Excel’e Aktar ve Kopyala bu renkleri ekrandan okuyup çıktıya yazdığı için, değiştirilseydi Excel çıktısı da değişecekti.', en: 'The colours of the priority and status badges and the table header tone were deliberately preserved. Export to Excel and Copy read those colours from the screen and write them into the output, so changing them would have changed the Excel output too.' },
      { tr: 'Sürüm 3.06’da onaylanan bant yerleşimi aynen duruyor: üstte hızlı filtreler, altta eylemler, seçime bağlı düğmeler ayrı bir kümede.', en: 'The band layout approved in version 3.06 is unchanged: quick filters on top, actions below, and selection dependent buttons in their own cluster.' },
    ],
  },
  {
    v: '3.07', date: '2026-07-29',
    title: { tr: 'Sürüm tek kaynağa bağlandı ve kumaş sayacı düzeltildi', en: 'Version bound to a single source and the fabric counter corrected' },
    items: [
      { tr: 'Sürüm bilgisi artık yalnız package.json dosyasında tutuluyor; sunucu, ekrandaki Version yazısı, dosya önbellek işaretleri ve Windows fırlatıcısı bu tek değerden türetiliyor. Önceki çıkışta ekran 3.06, sunucu 3.04 diyordu; bu tutarsızlık giderildi.', en: 'The version is now kept only in package.json; the server, the Version label on screen, the cache markers on files and the Windows launcher are all derived from that single value. In the previous release the screen said 3.06 while the server said 3.04; that mismatch is resolved.' },
      { tr: 'Yeni bir sürüm çıkarmak için tek komut yeterli: node scripts/set-version.js 3.08. Sürüm gösteren bir dosya atlanırsa testler kırmızıya döner.', en: 'Cutting a new release now takes one command: node scripts/set-version.js 3.08. If any file that shows the version is missed, the tests turn red.' },
      { tr: 'ASAS - Fabric okumasında, sipariş kodu ve rengi olan fakat karışım, iplik, gramaj ve kumaş tipi alanlarının dördü de boş olan satırlar uygulanan kayıt olarak sayılıyordu. Bu satırlar artık sayılmıyor; kumaş bilgisi uygulanan kayıt sayısı gerçek değeri gösteriyor. Siparişlere yazılan kumaş verisi değişmedi.', en: 'When reading ASAS - Fabric, rows that had an order code and colour but left blend, yarn, weight and fabric type all empty were counted as applied records. Those rows are no longer counted, so the number of records with fabric data applied now shows its true value. The fabric data written onto orders is unchanged.' },
    ],
  },
  {
    v: '3.06', date: '2026-07-28',
    title: { tr: 'Bant yerleşimi: filtre şeridi, seçim kümesi ve tablo araçları', en: 'Band layout: filter lane, selection cluster and table tools' },
    items: [
      { tr: 'Üst bant iki şeride ayrıldı: üstte veriyi tanımlayan hızlı filtreler, altta veriye uygulanan eylemler. Sayfa kaydırılırken bant ekranda kalır.', en: 'The top band is split into two lanes: quick filters that define the data on top, actions that apply to it below. The band stays on screen while the page scrolls.' },
      { tr: 'Seçim gerektiren düğmeler (Maliyet Oluştur, Fiyatlamaya Gönder, Üretim Durumu Sor, Nakliye Kıyaslama) “Seçilenler” ayracının sağında toplandı; seçim yokken hepsi birlikte soluk kalır, seçim gelince çivit renkli kenar şeridiyle canlanır.', en: 'Buttons that need a selection (Create OC, Send to Pricing, Ask Production Status, Shipping Comparison) are grouped to the right of a “Selected” divider; without a selection they stay dim together and light up with an indigo edge marker once rows are selected.' },
      { tr: 'Hızlı filtre düğmeleri filtre yokken sade adıyla ve sessiz görünür (“Buying Group: hepsi” yerine “Buying Group”); filtre seçilince çivit renkli çipe dönüşür.', en: 'Quick filter buttons now show just their name and a quiet style when no filter is set (“Buying Group” instead of “Buying Group: all”), and turn into an indigo chip once a filter is applied.' },
      { tr: 'Supp. FOB Kuralları gibi ayar düğmeleri şeridin sağ ucuna alınıp sessizleştirildi; Geri ve İleri yalnız ikona indi (ipucu ve kısayolları korunur).', en: 'Settings style buttons such as Supp. FOB Rules moved to the far right of the lane in a quieter style, and Undo and Redo became icon only, keeping their tooltips and shortcuts.' },
      { tr: 'Yerleşim kuralı netleşti: ekranda ne göründüğünü değiştiren araçlar tablonun kendi çubuğunda düz ve sessiz, çıktı üreten veya veriyi başka sayfaya taşıyan eylemler üst bantta kabarık düğmeler olarak durur.', en: 'One layout rule now holds: tools that change what is on screen sit flat and quiet in the table toolbar, while actions that produce output or move data to another page sit as raised buttons in the top band.' },
    ],
  },
  {
    v: '3.05', date: '2026-07-28',
    title: { tr: 'Yeni görsel dil: Selvedge', en: 'New visual language: Selvedge' },
    items: [
      { tr: 'Tüm arayüz yeni bir görsel katman (design.css) üzerine taşındı: zemin tonu derinleştirildi, paneller çerçeve yerine yumuşak gölgeli yapraklar hâline geldi, üst bar ile eylem çubuğu tek bir sakin şerit olarak birleştirildi.', en: 'The whole interface moved onto a new visual layer (design.css): the workspace tone is deeper, panels became soft shadowed sheets instead of outlined boxes, and the top bar and action bar now read as one calm band.' },
      { tr: 'Kimlik rengi çivit mavisine alındı ve dört temanın (Aydınlık, Gri, Antrasit, Karanlık) yüzey basamakları yeniden dengelendi.', en: 'The identity color changed to indigo and the surface steps of all four themes (Light, Grey, Charcoal, Dark) were rebalanced.' },
      { tr: 'Durum bilgisi artık ortak bir kenar şeridi diliyle veriliyor: rozetler, KPI rozetleri, seçili sekme, kaydetme şeridi, değişen satırlar ve bildirimler solunda 3 piksellik renkli şerit taşıyor.', en: 'State is now carried by one shared edge marker: badges, KPI chips, the selected tab, the save bar, changed rows and toasts all show a 3 pixel colored strip on their left.' },
      { tr: 'Araç çubuğu düğmeleri çerçevelerinden arındırıldı; vurgu artık üzerine gelindiğinde hafif bir yükselme ile veriliyor.', en: 'Toolbar buttons lost their outlines; emphasis now comes from a slight lift on hover.' },
      { tr: 'Tablo başlık tonu, çizgi renkleri ve tüm durum renkleri bilerek değiştirilmedi; Excel’e Aktar ve Kopyala biçimlendirmesinde hiçbir fark oluşmaz. Yazı tipleri ve kontrol yükseklikleri de sabit bırakıldı.', en: 'Table header tone, line colors and all status colors were deliberately left unchanged, so Export to Excel and Copy formatting stay identical. Fonts and control heights were kept as well.' },
    ],
  },
  {
    v: '3.04', date: '2026-07-28',
    title: { tr: 'Tablo seçim sayaçları ve Koleksiyon ağırlıklı ortalamaları', en: 'Table selection counters and Collection weighted averages' },
    items: [
      { tr: 'Checkbox bulunan ana tablolarda mevcut filtrede işaretli satır sayısı, seçim sütununun altındaki sabit özet hücresinde gösterilir ve seçim değiştikçe anında güncellenir.', en: 'Main tables with row checkboxes now show the number of selected rows within the current filtered view in a footer cell directly below the checkbox column, updating immediately as selection changes.' },
      { tr: 'Koleksiyon tablosunun alt özetinde mevcut filtreye uyan model sayısı “XX Model” olarak gösterilir; Quantity sütununun toplamı korunur.', en: 'The Collection footer now shows the number of models matching the current filters as “XX Model”, while preserving the Quantity total.' },
      { tr: 'Target Price, Conf. FOB ve FOB sütunlarının altında yalnız geçerli fiyat ve pozitif adet içeren filtrelenmiş modeller kullanılarak adet ağırlıklı ortalamalar hesaplanır.', en: 'Quantity-weighted averages are shown below Target Price, Conf. FOB and FOB using only filtered models with a valid price and positive quantity.' },
    ],
  },
  {
    v: '3.03', date: '2026-07-28',
    title: { tr: 'Excel sıralama serbestisi ve Koleksiyon Drop', en: 'Excel sorting and Collection Drop' },
    items: [
      { tr: 'Backlog ve Export Approvals çalışma sayfalarındaki koruma kaldırılarak Excel başlık filtrelerinden satır sıralama yeniden kullanılabilir hâle getirildi; açılır liste doğrulamaları ve gizli yardımcı sütunlar korunur.', en: 'Worksheet protection was removed from Backlog and Export Approvals so row sorting works again from Excel header filters; dropdown validations and hidden helper columns remain.' },
      { tr: 'Koleksiyon araç çubuğuna Delete Selected düğmesinin solunda İptal Et / Drop düğmesi eklendi; seçili aktif modeller iptal görünümüne alınır ve işlem Undo ile geri alınabilir.', en: 'A Drop button was added immediately left of Delete Selected in Collection; selected active models are marked as dropped and the action can be reversed with Undo.' },
      { tr: 'Drop işlemi satırları silmez; modeller Koleksiyon tablosunda karartılmış ve üzeri çizili biçimde görünmeye devam eder.', en: 'Dropping does not delete rows; models remain visible in Collection with the existing greyed and struck-through appearance.' },
    ],
  },
  {
    v: '3.02', date: '2026-07-28',
    title: { tr: 'Backlog başlık vurgu düzeltmesi', en: 'Backlog header emphasis correction' },
    items: [
      { tr: 'Backlog Excel’de soft sarı dolgu yalnız Sipariş Kod ve Model Adı sütun başlıklarında uygulanır; diğer başlıklar önceki biçimlerine döndürülür.', en: 'In Backlog Excel, the soft-yellow fill is applied only to the Order Code and Model Name headers; all other headers return to their previous formatting.' },
      { tr: 'Sipariş Kod ve Model Adı başlıklarının yazısı normal kalır; yalnız bu sütunların başlık altındaki veri hücreleri kalın yazılır.', en: 'Order Code and Model Name header labels use normal font weight, while only the data cells below those headers remain bold.' },
      { tr: 'Aynı biçimlendirme kuralı hem tarayıcıdan hem sunucu şablonundan oluşturulan Backlog dosyalarında uygulanır.', en: 'The same formatting rule is applied to both browser-generated and server-template Backlog workbooks.' },
    ],
  },
  {
    v: '3.01', date: '2026-07-28',
    title: { tr: 'Approvals Excel siyah hücre düzeltmesi', en: 'Approvals Excel black-cell fix' },
    items: [
      { tr: 'Export Approvals çalışma kitabı xlsx-js-style yerine ExcelJS ile oluşturulacak şekilde yeniden düzenlendi; böylece onay dolguları Excel ve Office temasından bağımsız gerçek açık renkler olarak yazılır.', en: 'Export Approvals was rebuilt with ExcelJS instead of xlsx-js-style, so approval fills are written as true light colours independent of Excel and Office themes.' },
      { tr: 'Gövde hücreleri açık beyaz, onay hücreleri pastel durum renkleri ve koyu okunabilir yazı renkleriyle doğrudan ARGB stil alır.', en: 'Body cells receive an explicit white fill, while approval cells use pastel status fills and readable dark font colours through direct ARGB styles.' },
      { tr: 'Durum değişikliklerindeki otomatik renklendirme ExcelJS diferansiyel biçimleriyle oluşturulur; siyah dolguya yol açan eski stil serileştirme yolu tamamen kaldırıldı.', en: 'Automatic recolouring after status changes now uses ExcelJS differential formats, completely removing the old style-serialization path that produced black fills.' },
      { tr: 'Onay açılır listeleri, kaynak hücre kilitleri, düzenlenebilir Notes / Ek Not alanları ve Instructions sayfası koruması korunur.', en: 'Approval dropdowns, locked source cells, editable Notes / Ek Not fields and Instructions-sheet protection are preserved.' },
    ],
  },
  {
    v: '3.00', date: '2026-07-28',
    title: { tr: 'Backlog Alt Üretici sütunu', en: 'Backlog Sub-Manufacturer column' },
    items: [
      { tr: 'Backlog raporunda Üretici sütununun hemen sağına görünür Alt Üretici sütunu eklendi.', en: 'A visible Sub-Manufacturer column was added immediately after Manufacturer in the Backlog report.' },
      { tr: 'Alt Üretici değeri siparişin Sub Mfr kaydından gelir; kayıt boşsa Üretici değeri otomatik kullanılır.', en: 'The Sub-Manufacturer value comes from the order’s Sub Mfr record and automatically falls back to Manufacturer when blank.' },
      { tr: 'Yeni sütun hem tarayıcıdan hem sunucu şablonundan oluşturulan Backlog dosyalarında aynı sırada ve görünümde yer alır.', en: 'The new column appears in the same position and view in both browser-generated and server-template Backlog files.' },
    ],
  },
  {
    v: '2.99', date: '2026-07-28',
    title: { tr: 'Backlog sütun görünümü ve korumalı Onay Excel’i', en: 'Backlog column view and protected Approval workbook' },
    items: [
      { tr: 'Backlog Excel varsayılan görünümünde yalnız belirlenen 28 operasyon sütunu açık kalır; diğer iş sütunları Excel’in 1/2 ve +/- outline kontrolleriyle kolayca açılıp kapatılabilen gizli gruplara alınır.', en: 'The default Backlog Excel view keeps only the requested 28 operational columns visible; other business columns are placed in hidden groups that can be expanded or collapsed with Excel’s 1/2 and +/- outline controls.' },
      { tr: 'Formül yardımcı sütunları gizli ve kilitli kalır. Korumalı sayfada sütun gruplarını kullanabilmek için sütun görünümü değişikliğine izin verilir; formül hücreleri yine düzenlenemez.', en: 'Formula-helper columns remain hidden and locked. Column visibility changes are allowed on the protected sheet so outline groups work, while formula cells remain non-editable.' },
      { tr: 'Backlog sütun başlıkları soft sarı renge getirildi; Sipariş Kod ve Model Adı sütunlarının bütün veri hücreleri kalın yazılır.', en: 'Backlog headers now use a soft yellow fill, and all data cells in Order Code and Model Name columns are bold.' },
      { tr: 'Export Approvals dosyasında yalnız dokuz onay sütunu ile Notes ve Ek Not düzenlenebilir; kaynak/kimlik alanları ve Instructions sayfası kilitlidir.', en: 'In Export Approvals, only the nine approval columns plus Notes and Ek Not are editable; source/identity fields and the Instructions sheet are locked.' },
      { tr: 'Approvals hücreleri uygulama ve Office temasından bağımsız doğrudan RGB kullanan daha açık bir paletle oluşturulur.', en: 'Approval cells use a lighter direct-RGB palette independent of both the application and Office themes.' },
    ],
  },
  {
    v: '2.98', date: '2026-07-28',
    title: { tr: 'Görünür sütun ayraçları ve üretimdeki Onaylar', en: 'Visible column dividers and production-only Approvals' },
    items: [
      { tr: 'Genişliği ayarlanabilen tablo başlıklarının sınırlarına, başlık yüksekliğinden kısa ve sürekli görünür minimal dikey ayraçlar eklendi; geniş sürükleme alanı korunur ve ayraç üzerine gelince vurgu rengine döner.', en: 'Resizable table headers now show short, always-visible vertical boundary markers; the wider drag target remains available and the marker changes to the accent colour on hover.' },
      { tr: 'Quotation tablolarındaki özel genişlik tutamacı da aynı ayraç görünümüne getirildi.', en: 'The dedicated resize handle in Quotation tables now uses the same divider treatment.' },
      { tr: 'Approvals yalnız Güncel Durumu üretimde olan siparişlerden model + renk kodu grupları oluşturur; filtre seçenekleri, KPI sayıları, seçim ve Excel dışa aktarımı aynı üretim kapsamını kullanır.', en: 'Approvals now creates model + colour-code groups only from orders currently in production; filter choices, KPIs, selection and Excel export share the same production scope.' },
      { tr: 'Export Approvals dosyası uygulamanın açık/koyu temasından bağımsız sabit aydınlık Excel paletiyle oluşturulur; gövde hücreleri beyaz, başlık ve durum renkleri açık temaya uygun katı dolgulardır.', en: 'Export Approvals now uses a fixed light Excel palette independent of the app theme, with white body cells and solid light header/status fills.' },
    ],
  },
  {
    v: '2.97', date: '2026-07-28',
    title: { tr: 'Backlog Status doğrulaması ve gerçek Excel tarihleri', en: 'Backlog Status validation and native Excel dates' },
    items: [
      { tr: 'Backlog Excel’de Güncel Durum / Status hücreleri zorunlu açılır listeye bağlandı; dosyadaki mevcut özel durumlar korunurken liste dışı serbest metin engellenir.', en: 'Current Status cells in Backlog Excel now use a required dropdown; existing source-specific statuses are preserved while free-text values outside the list are blocked.' },
      { tr: 'SheetJS kullanan bütün tarayıcı Excel çıktıları ortak tarih katmanından geçirilir; OPD, Ex-Factory, Retail, In-Store, Handover, Antrepo ve diğer tarih sütunları metin yerine gerçek Excel tarihi olarak yazılır.', en: 'Every browser Excel export using SheetJS now passes through a shared date layer, writing OPD, Ex-Factory, Retail, In-Store, Handover, warehouse and other date columns as native Excel dates instead of text.' },
      { tr: 'Koleksiyon, fiyatlama ve quotation geçmişindeki ExcelJS çıktıları da aynı tarih kuralını kullanır; ay ve hafta etiketleri bilerek metin olarak kalır.', en: 'ExcelJS exports for Collection, pricing and quotation history use the same date rule, while month and week labels intentionally remain text.' },
      { tr: 'Sunucu tarafından oluşturulan Backlog dosyasında da tarih tipi ve dd.mm.yyyy biçimi yeniden doğrulanır.', en: 'Server-generated Backlog workbooks also revalidate native date typing and the dd.mm.yyyy format.' },
    ],
  },
  {
    v: '2.96', date: '2026-07-28',
    title: { tr: 'Backlog formül koruması ve Risk doğrulaması', en: 'Backlog formula protection and Risk validation' },
    items: [
      { tr: 'Backlog Excel’de Net Gelen, Antrepo Giriş Tarihi ve Antrepo-Retail formül hücreleri sayfa korumasıyla düzenlemeye kapatıldı.', en: 'Formula cells for Net Received, Warehouse Arrival and Warehouse-to-Retail are locked by worksheet protection in Backlog Excel.' },
      { tr: 'Gizli formül yardımcı sütunları kilitli ve gizli kalır; korumalı sayfada sütun biçimlendirme engellendiği için normal kullanımda açılamaz veya değiştirilemez.', en: 'Hidden formula-helper columns remain locked and hidden; column formatting is blocked on the protected sheet so they cannot normally be exposed or edited.' },
      { tr: 'Formül olmayan görünür veri hücreleri düzenlenebilir kalır; filtreleme ve sıralama kullanılmaya devam eder.', en: 'Visible non-formula data cells remain editable, while filtering and sorting stay available.' },
      { tr: 'Risk (Priority) çıktısı yalnız VAR veya YOK değerine dönüştürüldü ve hücreler zorunlu açılır listeyle bu iki seçenekle sınırlandırıldı.', en: 'Risk (Priority) output is reduced to VAR or YOK and its cells are restricted to those two required dropdown values.' },
    ],
  },
  {
    v: '2.95', date: '2026-07-28',
    title: { tr: 'Model bazlı onay yönetimi ve dinamik Excel renkleri', en: 'Model-level approval management and dynamic Excel colours' },
    items: [
      { tr: 'Approvals tablosunda aynı Model Adı ve Renk Kodu altındaki birden fazla sipariş tek model satırında birleştirilir; sipariş kodlarının tamamı aynı hücrede bağlantılı gösterilir.', en: 'The Approvals table combines multiple orders with the same Model Name and Colour Code into one model row, showing every linked order code in the same cell.' },
      { tr: 'Pre-Prod Sample Approved seçildiğinde Lab Dip, Fabric Quality, Accessory ve Artwork; Gold Sample Approved seçildiğinde bunlara ek olarak Pre-Prod Sample otomatik Approved olur. Alanlar daha sonra bağımsız biçimde değiştirilebilir.', en: 'Selecting Approved for Pre-Prod Sample also approves Lab Dip, Fabric Quality, Accessory and Artwork; approving Gold Sample additionally approves Pre-Prod Sample. Each field can still be changed independently afterwards.' },
      { tr: 'İşaretli bir modelde onay durumu değiştirildiğinde, geçerli filtrelerde görünür ve işaretli olan tüm düzenlenebilir modellere aynı değişiklik uygulanır; görüntüleme yetkili modeller atlanır.', en: 'Changing an approval on a selected model applies the same change to every editable selected model visible under the current filters; view-only models are skipped.' },
      { tr: 'Export Approvals Excel’indeki onay hücrelerine koşullu biçimlendirme eklendi; açılır listeden durum değiştirildiğinde hücrenin rengi de otomatik güncellenir.', en: 'Conditional formatting was added to approval cells in the Export Approvals workbook, so choosing a different dropdown status automatically updates the cell colour.' },
      { tr: 'Approvals sayfasındaki eski genel Export to Excel düğmesi kaldırıldı; kontrollü Export Approvals ve Import Approvals akışı tek Excel yöntemi olarak bırakıldı.', en: 'The old generic Export to Excel action was removed from Approvals, leaving the controlled Export Approvals and Import Approvals workflow as the single Excel method.' },
    ],
  },
  {
    v: '2.94', date: '2026-07-27',
    title: { tr: 'Onay Excel aktarımı ve Backlog giriş doğrulaması', en: 'Approval Excel roundtrip and Backlog input validation' },
    items: [
      { tr: 'Onaylar sayfasındaki filtrelenmiş kayıtlar Excel’e aktarılabilir; düzenlenen dokuz onay durumu ile Notes ve Ek Not alanları tekrar içeri alınarak topluca güncellenir.', en: 'Filtered records on the Approvals page can be exported to Excel; the edited nine approval statuses plus Notes and Ek Not can be imported back as a batch update.' },
      { tr: 'Excel’deki onay hücreleri yalnız Pending, Submitted, Approved, Revision ve N/A seçeneklerini kabul eden zorunlu açılır listelerdir; serbest metin engellenir.', en: 'Approval cells in Excel are required dropdowns limited to Pending, Submitted, Approved, Revision and N/A; free-text values are blocked.' },
      { tr: 'Backlog ay/hafta alanları, Risk (Priority) ve Revize Yükleme Tarihi formül yerine doğrudan değer olarak yazılır; ay/hafta hücreleri metin biçimiyle Türkçe Excel uyumsuzluklarından korunur.', en: 'Backlog month/week fields, Risk (Priority) and Revised Loading Date are written as direct values instead of formulas; month/week cells use text format to avoid Turkish Excel locale errors.' },
      { tr: 'Tahmini Antrepo Giriş, Antrepo-Retail ve Net Gelen miktar formülleri korunur; Yükleme Tipi yalnız dört tanımlı seçenekten seçilebilen kontrollü bir açılır listedir.', en: 'Estimated warehouse arrival, warehouse-to-retail and net-received formulas remain; Delivery Type is a controlled dropdown limited to the four defined choices.' },
    ],
  },
  {
    v: '2.93', date: '2026-07-27',
    title: { tr: 'Gökberk Moderatör varsayılanı ve kullanıcı seçimi düzeltmesi', en: 'Gökberk Moderator default and user-selection fix' },
    items: [
      { tr: 'Yeni program oturumu doğrudan Gökberk adlı Moderatör profiliyle açılır; kullanıcı seçimi yalnız kullanıcı menüsünden istendiğinde gösterilir.', en: 'A fresh program session opens directly with the Moderator profile named Gökberk; user selection is shown only when requested from the user menu.' },
      { tr: 'Moderatör kimliği teknik olarak aynı `moderator` ID’sini korur; mevcut tema, filtre, görünüm, kolon ve diğer kişisel ayar anahtarları değişmez.', en: 'The Moderator keeps the same technical `moderator` ID, preserving existing theme, filter, view, column and other personal preference keys.' },
      { tr: 'Eski tek-kullanıcılı ve olası Gökberk-adlı tercih anahtarları yalnız eksik hedeflere güvenli ve tekrar çalışabilir biçimde taşınır.', en: 'Legacy single-user and possible Gökberk-named preference keys are migrated safely and idempotently only when the destination is missing.' },
      { tr: 'Kullanıcı Değiştir işlemi `/select-user.html` adresini kullanır; `/select-user`, son eğik çizgi ve HTML adreslerinin tamamı sunucuda desteklenir.', en: 'Switch User uses `/select-user.html`, while the server supports `/select-user`, its trailing-slash form and the explicit HTML path.' },
      { tr: 'Başka bir kullanıcı seçilene kadar mevcut oturum korunur; seçim ekranının kapatılması uygulamayı oturumsuz bırakmaz.', en: 'The current session is kept until another user is successfully selected, so closing the selection page does not leave the app signed out.' },
      { tr: 'Windows başlatıcısı 4173 portunda çalışan eski Buyer Log sürümünü algılar, eski gözetmen sürecini kapatır ve yalnız güncel paketi başlatır; böylece yeni rotaların eski sunucuda kaybolması engellenir.', en: 'The Windows launcher detects an older Buyer Log instance on port 4173, stops its watchdog process and starts only the current package, preventing new routes from being requested from a stale server.' },
    ],
  },
  {
    v: '2.92', date: '2026-07-27',
    title: { tr: 'Kullanıcıya özel kaynak klasörleri ve açık kaynak işlemleri', en: 'Per-user source folders and open source operations' },
    items: [
      { tr: 'Her kullanıcı kendi kaynak klasörünü seçer; ASAS, ANTREPO, ASAS - Fabric ve LFL verileri kullanıcı çalışma alanlarında ayrı okunur ve önbelleğe alınır.', en: 'Each user selects a private source folder; ASAS, ANTREPO, ASAS - Fabric and LFL data are read and cached in separate user workspaces.' },
      { tr: 'Kumaş verisi, LFL verisi, ASAS & ANTREPO yenileme geçmişi ve döviz kurları kullanıcılar arasında birbirini değiştirmez.', en: 'Fabric data, LFL data, ASAS & ANTREPO refresh history and FX rates no longer overwrite those of another user.' },
      { tr: 'Kaynak klasördeki Sub-Mfr/CP-update değerleri kullanıcı çalışma alanında uygulanır ve ortak Sub-Mfr veya Supp. FOB kayıtlarının üzerine yazılmaz.', en: 'Sub-Mfr/CP-update values from the source folder are applied inside the user workspace and do not overwrite shared Sub-Mfr or Supp. FOB records.' },
      { tr: 'ASAS ve ANTREPO yenileme, Fabric ve LFL güncelleme, kaynak klasörü seçimi, kullanıcının kendi ASAS & ANTREPO geçmişini silme ve döviz kuru düzenleme işlemleri tüm kullanıcılara açıldı.', en: 'ASAS and ANTREPO refresh, Fabric and LFL update, source-folder selection, deletion of the user’s own ASAS & ANTREPO history and FX editing are available to every user.' },
      { tr: 'Sipariş değişikliklerinde Buyer kapsam yetkileri korunur; kaynak yönetimi yetkisi başka Buyer gruplarındaki siparişleri değiştirme hakkı vermez.', en: 'Buyer order-scope permissions remain enforced; source-management access does not grant edit rights over another Buyer group’s orders.' },
      { tr: 'Buyer tarafından yönetilen kaynak dosyaları yetkilendirme kaynağı sayılmaz; kullanıcı kapsamları ve sipariş sahipliği yalnız Moderatör ASAS kaynağının son başarılı görüntüsünden alınır.', en: 'Buyer-managed source files are not trusted for authorisation; user scopes and order ownership come only from the last successful Moderator ASAS snapshot.' },
      { tr: 'Ortak teslimat tipi temizliği yalnız aktif kullanıcının kaynak ASAS dosyasındaki sipariş kodlarına uygulanır.', en: 'Shared delivery-type cleanup is limited to order codes present in the active user’s ASAS source.' },
    ],
  },
  {
    v: '2.91', date: '2026-07-27',
    title: { tr: 'Kullanıcı seçimi ve Buyer bazlı yetkilendirme', en: 'User selection and Buyer-based authorisation' },
    items: [
      { tr: 'Program açılışında Moderatör veya ASAS Buyer alanından otomatik oluşturulan Buyer kullanıcısı seçilir.', en: 'At startup, users select the Moderator or a Buyer profile generated automatically from the ASAS Buyer field.' },
      { tr: 'Buyer kullanıcıları tüm siparişleri görebilir; yalnız kendi Buyer kapsamlarında veya MAG + MMYG + Buying Group üçlüsü birlikte eşleşen siparişlerde değişiklik yapabilir.', en: 'Buyer users can view every order but can edit only their own Buyer scope or orders where MAG + MMYG + Buying Group all match.' },
      { tr: 'Kapsam dışı CP, order summary, CP bağlantılı quotation ve nakliye işlemleri görüntüleme modunda kilitlenir; kritik yazımlar sunucuda yeniden doğrulanır.', en: 'Out-of-scope CP, order summary, CP-linked quotation and shipping actions are locked to view-only mode, with critical writes revalidated by the server.' },
      { tr: 'Tema, dil, filtre, görünüm, kolon ve benzeri kullanıcı tercihleri her kullanıcı için ayrı saklanır.', en: 'Theme, language, filters, views, columns and similar preferences are stored separately for each user.' },
      { tr: 'Moderatör kullanıcıları etkinleştirebilir, PIN ve özel kapsam belirleyebilir; oturum ve değişiklik olayları denetim kaydına yazılır.', en: 'The Moderator can enable users, set PINs and define custom scopes; session and change events are written to an audit log.' },
      { tr: 'Moderatör ilk girişte PIN oluşturur; tekrarlanan hatalı PIN denemeleri geçici olarak sınırlandırılır.', en: 'The Moderator creates a PIN on first sign-in, and repeated incorrect PIN attempts are temporarily rate-limited.' },
    ],
  },
  {
    v: '2.90', date: '2026-07-27',
    title: { tr: 'Koleksiyon filtreleri ve LFL DTR sınıflandırması', en: 'Collection filters and LFL DTR classification' },
    items: [
      { tr: 'Koleksiyon Conf. Manufacturer sütunu, fiyat hücresindeki geçerli onaya göre filtrelenebilir hale getirildi.', en: 'Collection Conf. Manufacturer can now be filtered using the effective approval on the price cell.' },
      { tr: 'Buying Numunesi onayında hücre arka planı artık yeşile dönmez; yalnız onay tiki yeşil gösterilir.', en: 'Buying Sample approval no longer colours the cell background; only the approval tick is green.' },
      { tr: 'Non-DTR üretici listesi CP Licensor alanına değer yazmaz veya alanı kilitlemez.', en: 'The Non-DTR manufacturer list no longer writes to or locks the CP Licensor field.' },
      { tr: 'LFL sınıflandırmasında listedeki üreticiler NON-DTR, liste dışındaki tüm siparişler DTR kabul edilir; kaynak Lisans/Licensor/DTR alanları bu sonucu değiştirmez.', en: 'In LFL, listed manufacturers are NON-DTR and every order outside the list is DTR; source License/Licensor/DTR fields do not change the result.' },
    ],
  },
  {
    v: '2.89', date: '2026-07-27',
    title: { tr: 'ASAS & ANTREPO geçmiş yönetimi', en: 'ASAS & ANTREPO history management' },
    items: [
      { tr: 'Kaynak Veri bölümündeki Güncelleme Notları butonu ASAS & ANTREPO Geçmişi olarak yeniden adlandırıldı.', en: 'The Update Notes action in Source Data was renamed ASAS & ANTREPO History.' },
      { tr: 'Seçili yenileme geçmişi kaydı, detay panelindeki çöp kutusu düğmesiyle kalıcı olarak silinebilir.', en: 'The selected refresh-history record can be permanently deleted with the trash action in the detail panel.' },
      { tr: 'Geçmiş silme işlemi revizyon kontrollüdür; başka pencere tarafından değiştirilen güncel geçmiş eski bir görünümden ezilemez.', en: 'History deletion uses optimistic revision control so a stale window cannot overwrite newer history changes.' },
    ],
  },
  {
    v: '2.88', date: '2026-07-27',
    title: { tr: 'Buying Numunesi ve ortak üretici önerileri', en: 'Buying Sample and shared manufacturer suggestions' },
    items: [
      { tr: 'Koleksiyon tablosuna üretici seçimi ile onay tikini tek hücrede birleştiren Buying Numunesi sütunu eklendi.', en: 'A Buying Sample column combining manufacturer selection and an approval tick in one cell was added to Collection.' },
      { tr: 'Buying Numunesi üretici alanı CP Sub-Mfr hücresiyle aynı serbest giriş ve özel öneri açılır penceresini kullanır.', en: 'The Buying Sample manufacturer field uses the same free-text entry and custom suggestion popup as the CP Sub-Mfr cell.' },
      { tr: 'Üretici adı değiştirildiğinde önceki Buying Numunesi onayı otomatik kaldırılır; onay her Koleksiyon satırında ayrı saklanır.', en: 'Changing the manufacturer automatically clears the previous Buying Sample approval; approval is stored separately per Collection row.' },
      { tr: 'Non-DTR üretici girişindeki tarayıcı datalist’i kaldırılarak CP Sub-Mfr ile aynı özel üretici öneri bileşeni kullanıldı.', en: 'The browser datalist in Non-DTR manufacturer entry was replaced with the same custom manufacturer suggestion component used by CP Sub-Mfr.' },
    ],
  },
  {
    v: '2.87', date: '2026-07-27',
    title: { tr: 'LFL başlangıç okuması ve formüllü Backlog Excel', en: 'LFL startup read and formula-driven Backlog Excel' },
    items: [
      { tr: 'Program açılışında LFL KAYNAK dosyasının kayıtlı hali otomatik okunur; Excel bağlantıları veya pivotları yenilenmez.', en: 'At startup, the saved LFL KAYNAK workbook is read automatically without refreshing Excel connections or pivots.' },
      { tr: 'LFL Excel yenilemesi yalnız LFL Verisini Yenile / Refresh LFL Data butonuyla çalışır.', en: 'The LFL workbook is refreshed only through the Refresh LFL Data action.' },
      { tr: 'Backlog dışa aktarımındaki ay, hafta, net gelen, revize Ex-Factory, tahmini Antrepo, Antrepo-Retail ve Priority alanları Excel formülü olarak yazılır.', en: 'Backlog export writes month, week, net received, revised Ex-Factory, estimated warehouse arrival, warehouse-to-retail and Priority fields as Excel formulas.' },
      { tr: 'Revize Ex-Factory, Retail veya Model Bütçe tarihleri Excel içinde değiştirildiğinde bağlı hesaplar otomatik yeniden hesaplanır.', en: 'Changing Revised Ex-Factory, Retail or Model Budget dates in Excel automatically recalculates dependent fields.' },
    ],
  },
  {
    v: '2.86', date: '2026-07-27',
    title: { tr: 'Ayrı kumaş kaynağı ve Backlog kural sadeleştirmesi', en: 'Separate fabric source and Backlog rule cleanup' },
    items: [
      { tr: 'During Buying Approval statü kuralı ve Antrepo buying-onay miktarı bağımlılığı programdan kaldırıldı.', en: 'The During Buying Approval status rule and its Antrepo pending-buying-approval quantity dependency were removed.' },
      { tr: 'Backlog Revize Yükleme Tarihi alanları doğrudan ASAS Orijinal Exfactory Merch Tarih değerini kullanır.', en: 'Backlog Revised Loading Date fields now use the ASAS Original Exfactory Merch Date directly.' },
      { tr: 'Kumaş bilgileri, Kaynak Veri bölümündeki ayrı butonla en yeni ASAS - Fabric Excel dosyasından güncellenir.', en: 'Fabric information is updated from the newest ASAS - Fabric workbook using a separate Source Data action.' },
      { tr: 'Genel Kaynak Veriden Güncelle işlemi kumaş kaynağını değiştirmez; son başarılı kumaş verisi korunur.', en: 'General Refresh From Source does not replace the fabric source; the last successful fabric dataset is preserved.' },
    ],
  },
  {
    v: '2.85', date: '2026-07-27',
    title: { tr: 'Quotation paylaşımı, satır bazlı Drop ve yenileme deneyimi', en: 'Quotation sharing, row-level Drop and refresh experience' },
    items: [
      { tr: 'Best Price / Mfr aynı kaynak ve aynı modeli içeren tüm quotation kayıtlarındaki geçerli fiyatları birlikte değerlendirir.', en: 'Best Price / Mfr evaluates valid prices across all quotation records containing the same source and model.' },
      { tr: 'Drop yalnız seçilen üretici satırına uygulanır; aynı quotation içindeki diğer üreticiler etkilenmez.', en: 'Drop applies only to the selected manufacturer line; other manufacturers in the same quotation remain unaffected.' },
      { tr: 'Anlık bildirimler blur kullanılan açılır pencerelerin üzerinde gösterilir.', en: 'Transient notifications are displayed above blurred modal overlays.' },
      { tr: 'ASAS/ANTREPO yenilemesi uygulamayı kilitlemez; CP ekranında yenileme bitene kadar değişiklik yapılmamasını öneren iki dilli bilgi kartı gösterilir.', en: 'ASAS/ANTREPO refresh no longer locks the application; a bilingual advisory recommends avoiding CP edits until refresh completes.' },
    ],
  },
  {
    v: '2.84', date: '2026-07-26',
    title: { tr: 'Koleksiyon görsel oranı ve Status görünümü', en: 'Collection image ratio and Status appearance' },
    items: [
      { tr: 'Koleksiyon Status hücresindeki yerel açılır liste oku kaldırıldı; seçim işlevi korunur.', en: 'The native dropdown arrow was removed from the Collection Status cell while keeping the select functional.' },
      { tr: 'Koleksiyon görsellerinin ekrandaki genişlik ve yüksekliği tek bir ölçek katsayısından hesaplanarak her boyutta kaynak en/boy oranı korunur.', en: 'Collection image width and height are calculated from one scale factor so the source aspect ratio is preserved at every display size.' },
      { tr: 'Excel görselleri iki hücreli esnetme ankrajı yerine sabit piksel ölçülü tek hücreli ankrajla yazılır; Send to Pricing ve Quotation History aynı düzeltmeyi kullanır.', en: 'Excel images now use a one-cell anchor with fixed pixel extents instead of a two-cell stretch anchor; Send to Pricing and Quotation History share the fix.' },
      { tr: 'WebP, GIF ve SVG görseller Excel’e eklenmeden önce aynı oranla PNG’ye dönüştürülür; GIF için görünen ilk kare kullanılır.', en: 'WebP, GIF and SVG images are converted to PNG with the same aspect ratio before Excel embedding; GIF uses the visible first frame.' },
    ],
  },
  {
    v: '2.83', date: '2026-07-26',
    title: { tr: 'Canlı Target farkları ve Quotation Best Price', en: 'Live Target deltas and Quotation Best Price' },
    items: [
      { tr: 'Koleksiyon Target Price değiştiğinde Best Price yüzde farkı anında yeniden hesaplanır; eski yüzde görüntüsü kalmaz.', en: 'Changing Collection Target Price immediately recalculates the Best Price percentage so no stale delta remains.' },
      { tr: 'Confirmed FOB hücresinde Target Price’a göre imzalı yüzde fark gösterilir.', en: 'Confirmed FOB now displays its signed percentage difference from Target Price.' },
      { tr: 'Quotation fiyat giriş tablosunda Target Price’ın sağına Best Price ve bu fiyatı veren üreticiyi birlikte gösteren sütun eklendi.', en: 'A column showing Best Price together with the manufacturer offering it was added to the right of Target Price in the quotation entry table.' },
      { tr: 'Her Quotation Price girişinin yanında Target Price’a göre yüzde fark canlı olarak güncellenir.', en: 'Each Quotation Price input now shows a live percentage difference from Target Price.' },
    ],
  },
  {
    v: '2.82', date: '2026-07-26',
    title: { tr: 'Quotation Drop, görünüm ve Enter kayıt düzeltmeleri', en: 'Quotation Drop, viewport and Enter-save fixes' },
    items: [
      { tr: 'Drop artık yalnız açık olan quotation kaydındaki ilgili modele uygulanır; Koleksiyon satırını veya başka quotation kayıtlarını değiştirmez.', en: 'Drop now applies only to the related model in the open quotation record; it does not modify the Collection row or other quotation records.' },
      { tr: 'Önceki sürümlerde quotation Drop nedeniyle Koleksiyon satırlarına yazılmış işaretler bir defaya mahsus ayrıştırılarak modellerin Koleksiyon tablosunda yeniden görünmesi sağlanır.', en: 'Legacy Drop marks written to Collection rows by earlier quotation versions are detached once so the models remain visible in the Collection table.' },
      { tr: 'Fiyat, onay, Drop, filtre veya sıralama değişikliklerinden sonra quotation tablosunun yatay ve dikey kaydırma konumu korunur.', en: 'The quotation table preserves its horizontal and vertical scroll position after price, approval, Drop, filter or sort changes.' },
      { tr: 'Enter veya ok tuşuyla başka fiyat hücresine geçmeden önce aktif hücre doğrudan kaydedilir; tablo yeniden oluşturulmadığı için kayıt ve odak geçişi tutarlı çalışır.', en: 'Before Enter or an arrow key moves to another price cell, the active value is committed directly; avoiding a table rerender makes saving and focus movement reliable.' },
    ],
  },
  {
    v: '2.81', date: '2026-07-26',
    title: { tr: 'Ayarlanabilir Quotation sütunları ve Kategori', en: 'Resizable Quotation columns and Category' },
    items: [
      { tr: 'Quotation tablolarındaki tüm sütunlar başlık kenarından sürüklenerek genişletilip daraltılabilir; seçilen genişlikler kayıtlar ve oturumlar arasında korunur.', en: 'Every column in Quotation tables can be widened or narrowed by dragging its header edge; selected widths persist across records and sessions.' },
      { tr: 'Bir sütun ayırıcısına çift tıklamak o sütunun varsayılan genişliğini geri getirir.', en: 'Double-clicking a column separator restores that column’s default width.' },
      { tr: 'Model sütununun sağına Kategori / Category sütunu eklendi; eski kayıtlar güncel Koleksiyon veya CP satırından tamamlanır.', en: 'A Category column was added immediately after Model; older records are completed from the current Collection or CP row.' },
      { tr: 'Model altındaki kumaş detayı dar sütunlarda kesilerek gösterilir ve satır ya da sütun genişliğini zorla büyütmez.', en: 'The fabric detail beneath Model is clipped in narrow columns and no longer forces the row or column wider.' },
    ],
  },
  {
    v: '2.80', date: '2026-07-26',
    title: { tr: 'Görsele göre kompakt Koleksiyon satırları', en: 'Image-fitted compact Collection rows' },
    items: [
      { tr: 'Koleksiyon satırları artık seçili görsel boyutunun sabit azami yüksekliğini kullanmaz; her satır kendi görselinin gerçek en/boy oranına göre ayrı ayrı daraltılır.', en: 'Collection rows no longer use the fixed maximum height of the selected image size; each row is compacted independently according to its image aspect ratio.' },
      { tr: 'Boş görselli satırlar 34 px taban yüksekliğe iner; metin, tarih ve seçim editörleri daha kompakt hâle getirilirken kullanılabilir alt sınır korunur.', en: 'Rows without an image collapse to a 34 px baseline; text, date and selection editors are compacted while preserving a usable minimum.' },
      { tr: 'Büyük görsel modunun azami yüksekliği de azaltıldı; geniş görseller daha da kısa satırlarda, dikey görseller ise oranları bozulmadan gösterilir.', en: 'The maximum height of large image mode was also reduced; wide images use even shorter rows while portrait images keep their aspect ratio.' },
    ],
  },
  {
    v: '2.79', date: '2026-07-26',
    title: { tr: 'Windows fsync ve kalıcı kayıt hatası düzeltmesi', en: 'Windows fsync and persistent write fix' },
    items: [
      { tr: 'Windows, OneDrive veya güvenlik yazılımı fsync işlemini EPERM ile reddettiğinde kur, Koleksiyon görseli, model dosyası indeksi ve yedek geri yükleme kayıtlarının tamamen başarısız olmasına neden olan hata düzeltildi.', en: 'Fixed an issue where Windows, OneDrive or security software rejecting fsync with EPERM caused FX, Collection image, model-file index and backup-restore writes to fail completely.' },
      { tr: 'Geçici dosyalar artık yazılabilir tanıtıcıyla oluşturulur; desteklenmeyen fsync yalnız dayanıklılık adımı olarak atlanırken atomik değiştirme ve yedek kopya korunur.', en: 'Temporary files are now created with a writable handle; unsupported fsync is skipped only as a durability step while atomic replacement and backup copies remain intact.' },
      { tr: 'Disk doluluğu ve gerçek giriş/çıkış hataları gizlenmez; başarısız yazımlarda geçici dosyalar temizlenir ve eski kayıt korunur.', en: 'Disk-full and genuine I/O errors are not hidden; temporary files are cleaned up after failed writes and the previous record is preserved.' },
    ],
  },
  {
    v: '2.78', date: '2026-07-26',
    title: { tr: 'Send to Pricing üretici silme', en: 'Delete manufacturers in Send to Pricing' },
    items: [
      { tr: 'Send to Pricing penceresindeki kayıtlı üretici satırlarında Düzenle düğmesinin sağına çöp kutusu ikonlu silme düğmesi eklendi.', en: 'A trash-icon delete button was added immediately to the right of Edit on saved manufacturer rows in Send to Pricing.' },
      { tr: 'Silme öncesinde iki dilde onay istenir; işlem yalnız kayıtlı üretici listesini değiştirir, mevcut quotation geçmişi ve girilmiş fiyatlar korunur.', en: 'A bilingual confirmation is shown before deletion; only the saved manufacturer list is changed, while existing quotation history and entered prices are preserved.' },
      { tr: 'Silinen üretici seçiliyse seçim güvenli biçimde kaldırılır ve kalan üretici indeksleri yeniden eşlenir.', en: 'If the deleted manufacturer was selected, it is safely removed from the selection and the remaining manufacturer indexes are remapped.' },
    ],
  },
  {
    v: '2.77', date: '2026-07-26',
    title: { tr: 'LFL yenileme akışı sadeleştirildi', en: 'Simplified LFL refresh flow' },
    items: [
      { tr: 'LFL Verisini Yenile butonundaki işlem öncesi dosya boyutu ve süre onayı kaldırıldı; yenileme artık tek tıklamayla başlar.', en: 'The file-size and duration confirmation was removed from Refresh LFL Data; refresh now starts with one click.' },
      { tr: 'LFL yenilemesi sırasında tüm sayfayı bulanıklaştıran ve kullanıma kapatan kilit kaldırıldı; yalnız LFL yenileme butonu işlem tamamlanana kadar pasif kalır.', en: 'The full-page blur and interaction lock were removed from LFL refresh; only the LFL refresh button remains disabled until completion.' },
      { tr: 'LFL KAYNAK Excel gereksinimini belirten iki dilli hover açıklaması ile başarı ve hata sonuçları korunmuştur.', en: 'The bilingual hover reminder for the required LFL KAYNAK workbook and the success/error results remain in place.' },
    ],
  },
  {
    v: '2.76', date: '2026-07-26',
    title: { tr: 'ASAS ve Antrepo yenileme dayanıklılığı', en: 'Resilient ASAS and bonded-warehouse refresh' },
    items: [
      { tr: 'Excel bağlantı veya pivot yenilemesi tek dosyada hata verdiğinde tüm kaynak yenilemesinin durmasına neden olan davranış kaldırıldı.', en: 'A connection or pivot refresh failure in one workbook no longer aborts the entire source refresh.' },
      { tr: 'ASAS ve Antrepo dosyaları birbirinden bağımsız yenilenir; Excel otomasyonu başarısız olan dosyanın mevcut kayıtlı hali yine okunur ve kullanıcıya uyarı gösterilir.', en: 'ASAS and bonded-warehouse workbooks refresh independently; when Excel automation fails, the currently saved workbook is still read and a warning is shown.' },
      { tr: 'Excel yenileme ve ayrıştırma zaman aşımı dosya boyutuna göre 5–20 dakika arasında otomatik ayarlanır.', en: 'Excel refresh and parsing timeouts now scale automatically between 5 and 20 minutes according to workbook size.' },
      { tr: 'Eski açık tarayıcı oturumlarında Non-DTR yardımcı fonksiyonunun eksik olması artık başarılı kaynak yanıtını hataya dönüştürmez; iş kuralı dosyasına sürüm bazlı cache-busting eklendi.', en: 'An older open browser session missing the Non-DTR helper no longer turns a successful source response into an error; versioned cache-busting was added for the business-rules script.' },
    ],
  },
  {
    v: '2.75', date: '2026-07-26',
    title: { tr: 'Non-DTR üretici kuralları ve yenileme geri bildirimi', en: 'Non-DTR manufacturer rules and refresh feedback' },
    items: [
      { tr: 'Transfer Lead Times yanına Non-DTR Üreticiler yönetimi eklendi; listedeki üreticiler CP, order summary, Overview ve LFL genelinde Non-DTR kabul edilir.', en: 'A Non-DTR Mfr manager was added next to Transfer Lead Times; listed manufacturers are treated as Non-DTR across CP, order summary, Overview and LFL.' },
      { tr: 'Kaynak yenileme sırasında tüm uygulama bulanıklaştırılıp kilitleniyor; ASAS ve ANTREPO dosya yüküne bağlı süre uyarısı ve değişiklik yok sonucu gösteriliyor.', en: 'The application is blurred and locked during source refresh, with a duration warning based on ASAS and ANTREPO workbook load and an explicit no-change result.' },
      { tr: 'LFL yenileme butonuna LFL KAYNAK dosyası gereksinimi için hover ve işlem öncesi iki dilli uyarı eklendi.', en: 'The LFL refresh button now shows bilingual hover and pre-operation warnings requiring the LFL KAYNAK workbook.' },
    ],
  },
  {
    v: '2.74', date: '2026-07-26',
    title: { tr: 'Oranlı Excel görselleri, Quotation Excel aktarımı ve Drop kararı', en: 'Aspect-safe Excel images, quotation export and Drop decision' },
    items: [
      { tr: 'Send to Pricing ve görselli Koleksiyon Excel’lerinde görseller artık en/boy oranı korunarak hücreye sığdırılır; görsel sütunu genişletildi ve yatay görseller hücre genişliğini kullanır.', en: 'Images in Send to Pricing and Collection picture workbooks now fit cells without distorting their aspect ratio; the image column is wider and landscape images use the available cell width.' },
      { tr: 'Quotation geçmişine Excel’e Aktar düğmesi eklendi. Dosya, Send to Pricing Excel’iyle aynı sütunları kullanır ve her Sub. MFR için sona ayrı [Sub. MFR] Quotation Price sütunu ekler.', en: 'An Export to Excel button was added to quotation history. The workbook uses the same columns as Send to Pricing and appends a separate [Sub. MFR] Quotation Price column for each Sub. MFR.' },
      { tr: 'Quotation onayının yanına Drop tiki eklendi. Koleksiyon siparişi Drop olarak işaretlendiğinde ilgili satır anında kararır ve üzeri çizilir; işaret kaldırıldığında görünüm normale döner.', en: 'A Drop tick was added beside quotation approval. Marking a Collection order as Drop immediately greys and strikes through the related row; removing the mark restores it.' },
    ],
  },
  {
    v: '2.73', date: '2026-07-26',
    title: { tr: 'Quotations filtreleri, kumaş detayı ve Target odaklı Best Price', en: 'Quotation filters, fabric detail and target-aware Best Price' },
    items: [
      { tr: 'Quotations tablolarındaki Model, Üretici, Hedef Fiyat, Teklif Fiyatı ve Onay sütunları başlıktan filtrelenebilir ve artan/azalan sıralanabilir.', en: 'Model, Manufacturer, Target Price, Quotation Price and Approval columns in Quotations tables can be filtered and sorted ascending or descending from their headers.' },
      { tr: 'Model altındaki PLM, sipariş, lisans ve renk detayları kaldırıldı; bu alanda yalnız kumaş bilgisi gösterilir ve eski kayıtlar güncel Koleksiyon/CP satırından tamamlanır.', en: 'PLM, order, license and colour details below models were removed; only fabric information is shown, with legacy records completed from the current Collection/CP row.' },
      { tr: 'Best Price yalnız Target Price’a eşit veya düşük olduğunda yeşil olur; fiyatın solunda Target Price’a göre imzalı yüzde fark gösterilir.', en: 'Best Price is green only when it is equal to or below Target Price, with the signed percentage difference shown to the left of the price.' },
      { tr: 'Quotation sıralama sürüklemesinden sonra başka kayıt seçilememesine neden olan kalıcı drag kilidi düzeltildi.', en: 'Fixed the stale drag lock that prevented selecting another quotation after reordering requests.' },
    ],
  },
  {
    v: '2.72', date: '2026-07-26',
    title: { tr: 'Final denetim: atomik sipariş yazımları, Excel worker ve akış tabanlı yedek', en: 'Final audit: atomic order writes, Excel workers and streaming backup' },
    items: [
      { tr: 'Sipariş override ve Supp. FOB yazımları sıralı mutasyon kuyruğu, alt revizyonlar ve bileşik çakışma kontrolüyle korunur; eski pencere yeni veriyi sessizce ezemez.', en: 'Order override and Supp. FOB writes are protected by an ordered mutation queue, sub-revisions and composite conflict checks, preventing stale windows from silently overwriting newer data.' },
      { tr: 'CP Excel içe aktarma yüzlerce ayrı dosya yazımı yerine tek atomik toplu işlem kullanır; kısmi sonuç bırakmaz.', en: 'CP Excel import uses one atomic batch operation instead of hundreds of separate file writes and cannot leave a partial result.' },
      { tr: 'ASAS, Antrepo, Sub-Mfr, LFL ve Backlog Excel işlemleri sıralı worker kuyruğuna taşındı; ana Node event loop uzun hesaplamalar sırasında yanıt vermeye devam eder.', en: 'ASAS, Antrepo, Sub-Mfr, LFL and Backlog Excel work runs through a serial worker queue so the main Node event loop remains responsive during long calculations.' },
      { tr: 'Yeni .blgbackup biçimi dosyaları 256 KiB parçalar halinde akışla işler; tamlık, SHA-256, bitiş kaydı ve kapsam doğrulamaları uygulanır. Eski yedekler desteklenmeye devam eder.', en: 'The new .blgbackup format streams files in 256 KiB chunks with completeness, SHA-256, end-record and scope validation while retaining legacy backup compatibility.' },
      { tr: 'Sipariş senkronizasyonu ve yedekleme arayüzü büyük index.html dosyasından bağımsız modüllere ayrıldı; 22 otomatik test başarıyla tamamlandı.', en: 'Order synchronization and backup UI were extracted from the large index.html into independent modules; all 22 automated tests pass.' },
    ],
  },
  {
    v: '2.71', date: '2026-07-25',
    title: { tr: 'Veri bütünlüğü, tam yedekleme ve Koleksiyon görsel deposu', en: 'Data integrity, full backup and Collection image storage' },
    items: [
      { tr: 'Görünümler, filtreler, fiyat/transit kuralları, nakliye, ön maliyet ve kur verileri revizyon numarasıyla korunur; eski bir pencerenin yeni veriyi sessizce ezmesi engellenir.', en: 'Views, filters, pricing/transit rules, shipping, preliminary costing and FX data are protected with revisions so a stale window cannot silently overwrite newer data.' },
      { tr: 'Yedekle ve Geri Yükle aracı sunucu verilerini, model dosyalarını, Koleksiyon görsellerini, kur verisini, yapılandırmayı ve tarayıcı ayarlarını tek doğrulamalı .blgbackup paketinde taşır.', en: 'Backup & Restore packages server data, model files, Collection images, FX data, configuration and browser settings in one validated .blgbackup file.' },
      { tr: 'Koleksiyon görselleri localStorage yerine kalıcı dosya deposunda tutulur; eski base64 görseller arka planda güvenli biçimde taşınır.', en: 'Collection images are stored in persistent file storage instead of localStorage, with safe background migration of legacy base64 images.' },
      { tr: 'Kullanıcı verisi konumları tek modülde merkezileştirildi; yedek geri yükleme SHA-256 doğrulama, güvenli yol kontrolü, hazırlama alanı ve hata durumunda geri alma kullanır.', en: 'User-data locations are centralized; restore uses SHA-256 verification, safe-path checks, staging and rollback on failure.' },
      { tr: 'Faz 3 ile test paketi 19 senaryoya çıkarıldı; boş yedek kapsamı, eş zamanlı yazma, görsel depolama ve tam geri yükleme sınırları doğrulandı.', en: 'Phase 3 expands the suite to 19 tests covering empty backup scopes, concurrent writes, image storage and complete restore boundaries.' },
    ],
  },
  {
    v: '2.70', date: '2026-07-25',
    title: { tr: 'Regresyon testleri ve ortak iş kuralı motoru', en: 'Regression tests and shared business-rule engine' },
    items: [
      { tr: 'Priority, Discount, Delay, MB Delay, Handover ve Ant. Delay çekirdeği frontend ve backend için tek saf fonksiyonda merkezileştirildi.', en: 'The Priority, Discount, Delay, MB Delay, Handover and Ant. Delay core is centralized in one pure function shared by frontend and backend.' },
      { tr: 'Del. Type kanonikleri, transit kural eşleştirme/öncelik, varsayılan yol süreleri, half-up yuvarlama ve Supp. FOB hesabı ortak bağımlılıksız modüle taşındı.', en: 'Delivery-type canonicalization, transit rule matching/specificity, default transit durations, half-up rounding and Supp. FOB calculation moved to a shared dependency-free module.' },
      { tr: 'Node yerleşik test çalıştırıcısıyla 14 test ve önceki v2.69 davranışından üretilmiş 400 senaryolu regresyon matrisi eklendi.', en: 'Added 14 tests with the built-in Node test runner, including a 400-case regression matrix generated from v2.69 behavior.' },
      { tr: 'CP/Koleksiyon ve LFL sezon sıralama politikaları belirsiz iş kuralı değiştirilmeden açık isimlerle ayrı ayrı korunuyor.', en: 'CP/Collection and LFL season sorting policies remain explicitly separate without guessing or changing an ambiguous business rule.' },
    ],
  },
  {
    v: '2.69', date: '2026-07-25',
    title: { tr: 'İlk kapsamlı denetim ve güvenli temel iyileştirmeleri', en: 'Initial comprehensive audit and safe foundation improvements' },
    items: [
      { tr: 'Sunucu varsayılan olarak yalnız 127.0.0.1 üzerinde dinler; ağ erişimi ancak config.json içinde açıkça host tanımlanırsa açılır.', en: 'The server now listens on 127.0.0.1 by default; network access is enabled only when a host is explicitly configured.' },
      { tr: 'Kalıcı JSON verileri geçici dosya, fsync ve yedek kopya kullanılarak atomik yazılır; bozuk ana dosyada .bak yedeği okunur.', en: 'Persistent JSON data is written atomically with a temporary file, fsync and backup; the .bak copy is read if the primary file is corrupt.' },
      { tr: 'Global arama kayıtları pencere açılışında bir kez oluşturulur; her tuşta tüm tablolar yeniden taranmaz.', en: 'Global-search records are built once per search session instead of rescanning every table on each keystroke.' },
      { tr: 'API yanıtlarında eski verinin tarayıcı önbelleğinden dönmesini engelleyen no-store başlıkları eklendi ve kullanılmayan eski HTML yedeği paketten kaldırıldı.', en: 'No-store headers were added to API responses and the unused legacy HTML backup was removed from the package.' },
    ],
  },
  {
    v: '2.68', date: '2026-07-25',
    title: { tr: 'Model dosyaları eşit oranda sıkıştırılıyor', en: 'Model files are now compressed evenly' },
    items: [
      { tr: 'Send to Pricing artık ek dosyalarını dosya başına ayrı bütçeyle değil, tümüne AYNI sıkıştırma kademesini (aynı çözünürlük/kalite) uygulayarak eşit oranda küçültüyor; böylece kimi dosya çok ezilip kimi el değmeden kalmıyor.', en: 'Send to Pricing no longer gives each file a separate byte budget; it applies the SAME compression level (equal resolution/quality) to every file, so files are reduced evenly instead of some being crushed and others left untouched.' },
      { tr: 'En yüksek kaliteli kademeden başlanır ve tüm dosyalar birlikte 9,5 MB’ın altına sığana kadar tek tık aşağı inilir. Dosyalar özgün hâlleriyle zaten sığıyorsa hiçbirine dokunulmaz.', en: 'It starts from the highest-quality tier and steps down only until all files together fit below 9.5 MB. If the originals already fit, nothing is altered.' },
      { tr: 'Zaten küçük/vektörel dosyalar asla şişirilmez; sıkıştırma onları büyütecekse özgün hâlleri korunur.', en: 'Already-small or vector files are never inflated; if compression would enlarge them, the originals are kept.' },
    ],
  },
  {
    v: '2.67', date: '2026-07-25',
    title: { tr: 'PDF model dosyaları da sıkıştırılıp tek e-postada tutuluyor', en: 'PDF model files are now compressed and kept in one email' },
    items: [
      { tr: 'Send to Pricing artık PDF model dosyalarını sayfa sayfa daha düşük çözünürlükte yeniden oluşturarak (rasterize) küçültüyor; büyük görsel içeren teknik-paket PDF’leri tek e-postada 9,5 MB sınırının altına sığıyor.', en: 'Send to Pricing now shrinks PDF model files by re-rendering each page at a lower resolution; image-heavy tech-pack PDFs fit below the 9.5 MB limit in a single email.' },
      { tr: 'Görseller ve PDF’ler ortak ek bütçesini paylaşır ve her dosya tek tek hedefe sığdırılır; ekler artık farklı e-postalara bölünmez ve dosya formatı değiştirilmez.', en: 'Images and PDFs share the same attachment budget and each file is fitted to its target individually; attachments are no longer split across separate emails and their formats are kept intact.' },
      { tr: 'E-postayı bölme yalnızca tek bir dosya en düşük çözünürlükte bile 9,5 MB’a sığmazsa devreye giren son çare olarak kaldı.', en: 'Splitting into multiple emails remains only a last resort, used solely when a single file cannot fit under 9.5 MB even at the lowest resolution.' },
    ],
  },
  {
    v: '2.66', date: '2026-07-25',
    title: { tr: 'Fiyatlama eklerinde gelişmiş sıkıştırma ve otomatik bölme', en: 'Advanced compression and automatic splitting for pricing attachments' },
    items: [
      { tr: 'Görsel olmayan dosyalar, ayrı GZIP dosyalarından daha küçük olduğunda maksimum sıkıştırmalı tek ZIP arşivine alınır.', en: 'Non-image files are placed in one maximum-compression ZIP archive whenever it is smaller than separate GZIP files.' },
      { tr: 'Görseller gerektiğinde daha düşük kalite ve çözünürlük seviyelerine kadar ayrı ayrı küçültülür.', en: 'Images can be reduced individually to lower quality and resolution levels when required.' },
      { tr: 'Tüm kayıpsız dosyalar tek 9,5 MB e-postaya sığmıyorsa hata vermek veya dosya atlamak yerine numaralı devam taslakları otomatik oluşturulur.', en: 'If the complete lossless set cannot fit in one 9.5 MB message, numbered continuation drafts are created automatically instead of failing or dropping files.' },
      { tr: 'Tek başına çok büyük olan dosyalar byte kaybı olmadan numaralı parçalara bölünür ve geri birleştirme açıklaması eklenir.', en: 'Individually oversized files are split into numbered byte-perfect parts with restoration instructions.' },
    ],
  },
  {
    v: '2.64', date: '2026-07-25',
    title: { tr: 'Tüm fiyatlama eklerini 9,5 MB altında tutma', en: 'Keep every pricing attachment below 9.5 MB' },
    items: [
      { tr: 'Send to Pricing artık dosyaları sırayla ekleyip sığmayanları dışarıda bırakmaz; seçili model dosyalarının tamamı ek planına alınır.', en: 'Send to Pricing no longer attaches files sequentially and omits those that do not fit; every selected model file is included in the attachment plan.' },
      { tr: 'Excel’den kalan ek bütçesi bütün görseller arasında dağıtılır ve her görsel, toplam 9,5 MB sınırı korunacak şekilde ayrı ayrı yeniden boyutlandırılır.', en: 'The attachment budget remaining after the Excel file is distributed across all images, and each image is resized individually while keeping the total below 9.5 MB.' },
      { tr: 'Görsel olmayan dosyalar korunur; gerekirse her biri ayrı ayrı kayıpsız GZIP sıkıştırmasına alınır. Tam dosya seti korunamıyorsa eksik taslak üretmek yerine açık hata verilir.', en: 'Non-image files are preserved and, when necessary, individually losslessly GZIP-compressed. If the complete file set cannot be preserved, the app reports a clear error instead of creating an incomplete draft.' },
    ],
  },
  {
    v: '2.63', date: '2026-07-25',
    title: { tr: 'Kalıcı model dosyaları ve 9,5 MB fiyatlama eki', en: 'Persistent model files and 9.5 MB pricing attachments' },
    items: [
      { tr: 'Koleksiyon araç çubuğunda Add New Model sağında Dosyalar / TPs düğmesi eklendi; seçili modellere yüklenen dosyalar Buyer Log’da kalıcı saklanır.', en: 'A Files / TPs button was added to the right of Add New Model in Collection; files uploaded for selected models are stored persistently in Buyer Log.' },
      { tr: 'Seçili modellere ait kayıtlı dosyalar Send to Pricing penceresindeki model dosyaları alanına otomatik yüklenir ve model adıyla gösterilir.', en: 'Stored files for selected models are loaded automatically into the model-files area of the Send to Pricing dialog and shown with their model name.' },
      { tr: 'Quotation Excel ile tüm model dosyalarının toplam ek sınırı 10 MB’dan 9,5 MB’a indirildi; sığması gereken görseller gerektiğinde otomatik küçültülür.', en: 'The combined attachment limit for the Quotation Excel and all model files was reduced from 10 MB to 9.5 MB; images are reduced automatically when required to fit.' },
    ],
  },
  {
    v: '2.62', date: '2026-07-25',
    title: { tr: 'Görselli Excel satırları ve hücreye bağlı görseller', en: 'Picture Excel rows and cell-bound images' },
    items: [
      { tr: 'Görselli Koleksiyon Excel’i ve fiyatlama talebi Excel’indeki sipariş satırları 145 piksel yüksekliğe ayarlandı.', en: 'Order rows in the picture-enabled Collection workbook and pricing-request workbook are set to 145 pixels high.' },
      { tr: 'Görseller artık hücrelerle birlikte hareket eder ve hücre boyutu değiştirildiğinde görselle birlikte yeniden boyutlanır.', en: 'Images now move with their cells and resize when the cell dimensions change.' },
      { tr: 'Görseller, Excel’in iki hücreli sabitleme yöntemiyle görsel sütunundaki ilgili sipariş satırına bağlandı.', en: 'Images are bound to their order row in the picture column using Excel two-cell anchoring.' },
    ],
  },
  {
    v: '2.61', date: '2026-07-25',
    title: { tr: 'Fiyatlama e-postalarına 10 MB kontrollü model dosyaları', en: 'Model files with a 10 MB limit in pricing emails' },
    items: [
      { tr: 'Fiyatlamaya Gönder penceresine çoklu model dosyası seçme ve sürükle-bırak alanı eklendi.', en: 'A multi-file picker and drag-and-drop area were added to the Send to Pricing dialog.' },
      { tr: 'Excel ve model dosyalarının toplamı 10 MB altında tutulur; yalnız gerektiğinde görseller otomatik küçültülür, sığmayan diğer dosyalar taslağa eklenmez.', en: 'Excel and model-file attachments are kept below 10 MB; images are reduced only when necessary, while other files that do not fit are omitted.' },
      { tr: 'Taslak sonuç penceresi eklenen ve dışarıda bırakılan model dosyası sayılarını, toplam boyutu ve eklenmeyen dosya adlarını gösterir.', en: 'The draft result window shows the included and omitted model-file counts, total size and omitted filenames.' },
    ],
  },
  {
    v: '2.60', date: '2026-07-25',
    title: { tr: 'ASAS ve Antrepo güncelleme geçmişi', en: 'ASAS and bonded warehouse update history' },
    items: [
      { tr: 'Tek seferlik yenileme özeti, Sürüm Geçmişi tasarımındaki kalıcı ASAS ve Antrepo Güncelleme Notları penceresine dönüştürüldü.', en: 'The one-off refresh summary was replaced with a persistent ASAS and bonded warehouse Update Notes window using the Version History layout.' },
      { tr: 'Yalnız gerçek değişiklik varsa tarih ve saat bilgili kayıt oluşturulur; değişiklik olmayan yenilemeler geçmişe eklenmez.', en: 'A dated and time-stamped record is created only when actual changes exist; no-change refreshes are not added to history.' },
      { tr: 'Sol panel geçmiş yenilemeleri, sağ panel özet ve ayrıntılı ASAS/Antrepo değişikliklerini gösterir; kayıt bazında Excel indirme korunur.', en: 'The left panel lists past refreshes, while the right panel shows summaries and detailed ASAS/bonded-warehouse changes; per-record Excel export remains available.' },
    ],
  },
  {
    v: '2.59', date: '2026-07-25',
    title: { tr: 'Koleksiyon fiyat çalışmalarında model görselleri', en: 'Model images in Collection quotations' },
    items: [
      { tr: 'Koleksiyon Fiyat Çalışmaları tablosunda model adının hemen soluna satır yüksekliğini değiştirmeyen küçük model görseli eklendi.', en: 'A compact model thumbnail was added immediately left of the model name in the Collection Quotations table without increasing row height.' },
      { tr: 'Görselin üzerinde beklenince Koleksiyon tablosundakiyle aynı büyük önizleme açılır; CP Fiyat Çalışmaları değiştirilmedi.', en: 'Hovering the thumbnail opens the same large preview used in Collection; CP Quotations remain unchanged.' },
    ],
  },
  {
    v: '2.58', date: '2026-07-25',
    title: { tr: 'Global arama ve Koleksiyon filtre sırası', en: 'Global search and Collection filter order' },
    items: [
      { tr: 'Üst çubuktaki arama, CP ile sınırlı olmaktan çıkarılıp tüm uygulamada anlık ve yaklaşık eşleşmeli aramaya dönüştürüldü.', en: 'The header search was expanded from CP-only search to live fuzzy search across the application.' },
      { tr: 'Sonuç seçildiğinde ilgili sayfa veya pencere açılır ve eşleşen kayıt vurgulanır.', en: 'Selecting a result opens the related page or dialog and highlights the matching record.' },
      { tr: 'Koleksiyon sütun filtresi altındaki buton sırası Uygula, Geçerli Seçime Ekle, Filtreyi Kaldır olarak sabitlendi.', en: 'Collection column-filter actions are fixed to Apply, Add to Current, Remove Filter.' },
    ],
  },
  {
    v: '2.57', date: '2026-07-25',
    title: { tr: 'Filtre, sıralama, araç çubuğu ve dil düzeltmeleri', en: 'Filter, sorting, toolbar and language fixes' },
    items: [
      { tr: 'Del. Type hızlı filtreleri İngilizce görünümde Sea, Sea+Air ve Air değerlerini kanonik teslimat türleriyle doğru eşleştirir.', en: 'Del. Type quick filters now correctly match Sea, Sea+Air and Air to canonical delivery types in English.' },
      { tr: 'Season sıralaması önce metindeki sayıyı, eşit sayıda ise S harfini W harfinden daha eski kabul eder.', en: 'Season sorting prioritizes the number in the text and treats S as older than W when the numbers are equal.' },
      { tr: 'CP ve Approvals sütun filtreleri aynı düzene getirildi; Add to Current ve Remove Filter sırası güncellendi.', en: 'CP and Approvals column filters now use the same layout, with Add to Current and Remove Filter reordered.' },
      { tr: 'CP, Approvals, Collection ve Shipping sayfalarının dışa aktarım, görünüm, filtre ve tablo işlem düğmeleri istenen konumlara taşındı.', en: 'Export, page-option, filter and table-action controls were moved to the requested positions across CP, Approvals, Collection and Shipping.' },
      { tr: 'Dil değişiminde aktif sayfa başlığı korunur; Overview yazımı, Koleksiyon askı simgesi ve Page Options / Filters çevirileri düzeltildi.', en: 'The active page title is preserved when switching languages; Overview capitalization, the Collection hanger icon and Page Options / Filters translations were fixed.' },
    ],
  },
  {
    v: '2.56', date: '2026-07-25',
    title: { tr: 'Tablo arama ve işlem çubukları yeniden düzenlendi', en: 'Table search and action toolbars reorganised' },
    items: [
      { tr: 'Koleksiyon arama alanı tablonun hemen üstüne taşındı; Undo, Redo, Copy, Duplicate, Add New Model, Delete Selected, Columns, Freeze Columns ve Clear Filters belirtilen sırada yanına yerleştirildi.',
        en: 'The Collection search field was moved directly above the table, followed by Undo, Redo, Copy, Duplicate, Add New Model, Delete Selected, Columns, Freeze Columns and Clear Filters in the requested order.' },
      { tr: 'Approvals ve CP tablo işlemleri de arama alanının sağına taşındı ve arama kutuları tüm kontrollerin aynı satıra sığması için daraltıldı.',
        en: 'Approvals and CP table actions were also moved beside their search fields, with narrower search boxes so the controls fit on one row.' },
      { tr: 'Koleksiyon model sayısı, Approvals model/sipariş özeti ve onay durumu seçimi ile CP model/toplam sipariş özeti görünümden kaldırıldı.',
        en: 'The Collection model count, Approvals model/order summary and approval-status selector, and CP model/total-order summary were removed from view.' },
    ],
  },
  {
    v: '2.55', date: '2026-07-25',
    title: { tr: 'CP sütun filtreleri sadeleştirildi', en: 'CP column filters simplified' },
    items: [
      { tr: 'CP sütun filtrelerinin üst kısmındaki A→Z, Z→A ve Filtreyi Temizle düğmeleri kaldırıldı.',
        en: 'The A→Z, Z→A and Clear Filter controls were removed from the top of CP column filters.' },
      { tr: 'CP filtre pencerelerinde Add to Current düğmesinin soluna Remove Filter / Filtreyi Kaldır düğmesi eklendi.',
        en: 'A Remove Filter button was added to the left of Add to Current in CP filter panels.' },
      { tr: 'Filtreyi Kaldır, ilgili sütunun mevcut filtresini tek adımda temizleyip tabloyu yeniler.',
        en: 'Remove Filter clears the active filter for that column in one step and refreshes the table.' },
    ],
  },
  {
    v: '2.54', date: '2026-07-24',
    title: { tr: 'Filtre seçimleri ve Approvals başlık görünümü düzeltildi', en: 'Filter selections and Approvals header appearance fixed' },
    items: [
      { tr: 'Sütun filtresinde arama yapıldıktan sonra Apply/Enter artık yalnız görünür ve işaretli değerleri uygular; arama sonucundaki tüm değerler otomatik seçilmez.',
        en: 'After searching in a column filter, Apply/Enter now uses only visible checked values instead of automatically selecting every search result.' },
      { tr: 'Add to Current aynı seçim mantığını kullanır ve yalnız işaretlenen arama sonuçlarını mevcut filtreye ekler.',
        en: 'Add to Current uses the same selection logic and adds only checked search results to the existing filter.' },
      { tr: 'Approvals tablosunun üst grup bandındaki renkli/mavi vurgu çizgileri kaldırıldı; nötr grup ayraçları korunur.',
        en: 'Colored/blue accent lines were removed from the upper group band of the Approvals table while neutral group dividers remain.' },
    ],
  },
  {
    v: '2.53', date: '2026-07-24',
    title: { tr: 'Not ve fiyat çalışması listelerinde sürükle-bırak', en: 'Drag-and-drop for notes and quotation lists' },
    items: [
      { tr: 'Not Defteri sayfaları sol panelde basılı tutup sürüklenerek yeniden sıralanabilir; oluşturulan sıra kalıcı olarak saklanır.',
        en: 'Notebook pages can be reordered by dragging them in the left panel, and the chosen order is saved persistently.' },
      { tr: 'Koleksiyon ve CP Fiyat Çalışmaları kayıtları sol panelde sürükle-bırak ile sıralanabilir ve seçili kayıt çöp kutusu düğmesiyle silinebilir.',
        en: 'Collection and CP quotation requests can be reordered by drag-and-drop and the selected request can be deleted with the trash button.' },
      { tr: 'Silinen fiyat çalışmasına bağlı otomatik Not Defteri sayfası da kaldırılır; Koleksiyon tablosuna daha önce aktarılmış fiyat/onay bilgisi korunur.',
        en: 'The linked auto-generated Notebook page is removed with a deleted quotation, while price and approval data already written to Collection remains intact.' },
      { tr: 'Fiyat Çalışmaları tablosunda üretici satırlarında artık iletişim adresi gösterilmez; yalnızca üretici adı yer alır.',
        en: 'Quotation tables now show only the manufacturer name and no longer display contact addresses beneath it.' },
    ],
  },
  {
    v: '2.52', date: '2026-07-24',
    title: { tr: 'Koleksiyon tarihleri CP biçimine getirildi', en: 'Collection dates aligned with CP formatting' },
    items: [
      { tr: 'Koleksiyon tarih hücreleri artık CP gibi normal durumda GG.AA.YY metni olarak görünür; tıklanınca klavye ve takvim destekli ortak tarih editörü açılır.',
        en: 'Collection date cells now appear as GG.MM.YY text like CP and open the shared keyboard-and-calendar date editor when clicked.' },
      { tr: 'Koleksiyon Ex-Factory tarihi değiştirildiğinde Ex→Retail değeri aynı anda yeniden hesaplanıp ekranda güncellenir.',
        en: 'When the Collection Ex-Factory date changes, Ex→Retail is recalculated and refreshed immediately.' },
    ],
  },
  {
    v: '2.51', date: '2026-07-24',
    title: { tr: 'Fiyat Çalışmaları ve Best Price takibi', en: 'Quotations workspace and Best Price tracking' },
    items: [
      { tr: 'Koleksiyon ve CP ekranlarına Not Defteri yerleşiminde Fiyat Çalışmaları / Quotations penceresi eklendi.',
        en: 'A Notebook-style Quotations workspace was added to Collection and CP.' },
      { tr: 'Her onaylanan Send to Pricing işlemi model ve üretici satırlarıyla ayrı bir geçmiş kaydı oluşturur; fiyatlar hücre içinde düzenlenebilir ve tedarikçi onaylanabilir.',
        en: 'Every confirmed Send to Pricing action creates a separate history record with model and manufacturer lines; prices are editable in-cell and a supplier can be approved.' },
      { tr: 'Koleksiyon fiyatları Best Price alanına, onaylanan üretici ve fiyat ise Conf. Manufacturer / Conf. FOB alanlarına aktarılır; CP kayıtları yalnız takip amaçlıdır.',
        en: 'Collection quotations feed Best Price, while the approved supplier and price feed Conf. Manufacturer / Conf. FOB; CP records are tracking-only.' },
      { tr: 'Üretici bazlı fiyat sütunları Koleksiyon tablosundan kaldırıldı ve fiyatlandırma talepleri Not Defteri sayfalarında da gösterildi.',
        en: 'Manufacturer-specific price columns were removed from the Collection table, and pricing requests are also shown as Notebook pages.' },
    ],
  },
  {
    v: '2.50', date: '2026-07-24',
    title: { tr: 'Del. Type hızlı filtre eşleştirmesi düzeltildi', en: 'Del. Type quick-filter matching fixed' },
    items: [
      { tr: 'Del. Type hızlı filtreleri artık görüntü dilinden bağımsız olarak kanonik teslimat türüyle eşleşir.',
        en: 'Del. Type quick filters now match the canonical delivery type independently of the display language.' },
      { tr: 'İngilizce görünümde Sea, Sea+Air ve Air sayaçlarına tıklandığında ilgili Gemi, Gemi+Uçak ve Uçak siparişleri doğru şekilde listelenir.',
        en: 'In English view, clicking Sea, Sea+Air and Air counters correctly lists the matching Gemi, Gemi+Uçak and Uçak orders.' },
      { tr: 'Hızlı filtre ile sütun başlığı filtresi aynı Del. Type değerini kullandığında seçili durum ve sonuç kümesi senkron kalır.',
        en: 'Quick filters and column-header filters stay synchronized when they represent the same Del. Type value.' },
    ],
  },
  {
    v: '2.49', date: '2026-07-24',
    title: { tr: 'Discount yalnızca Üretimde siparişlere uygulandı', en: 'Discount limited to In Production orders' },
    items: [
      { tr: 'Discount uyarısı yalnızca Status / Durum değeri Üretimde olan siparişlerde hesaplanır.',
        en: 'The Discount warning is calculated only for orders whose Status is In Production.' },
      { tr: 'Üretimde siparişlerde Bugün − Ex-Factory farkı 9 günden büyükse Discount mevcut Priority değerinin sonuna eklenir.',
        en: 'For In Production orders, Discount is appended to the current Priority when Today minus Ex-Factory is greater than 9 days.' },
      { tr: 'Üretimde dışındaki statülerde Ex-Factory tarihi gecikmiş olsa bile Discount gösterilmez.',
        en: 'Discount is not shown for statuses other than In Production, even when Ex-Factory is overdue.' },
    ],
  },
  {
    v: '2.48', date: '2026-07-24',
    title: { tr: 'Discount kuralı bugünün tarihine göre düzeltildi', en: 'Discount rule corrected to use today' },
    items: [
      { tr: 'Discount hesabı Bugün − ekranda görünen Ex-Factory olarak uygulanır.',
        en: 'Discount is calculated as Today minus the currently displayed Ex-Factory date.' },
      { tr: 'Takvim günü farkı 9’dan büyükse, yani Ex-Factory 10 gün veya daha fazla geçmişse uyarı oluşur.',
        en: 'The warning is created when the calendar-day difference is greater than 9, meaning Ex-Factory is 10 or more days in the past.' },
      { tr: 'Discount mevcut Priority değerini değiştirmez; sonuna eklenir.',
        en: 'Discount does not replace the existing Priority; it is appended.' },
    ],
  },
  {
    v: '2.46', date: '2026-07-24',
    title: { tr: 'Del. Type çevirileri ve grup ayraçları', en: 'Del. Type translations and group separators' },
    items: [
      { tr: 'Del. Type değerleri İngilizce görünümde Gemi → Sea, Gemi+Uçak → Sea+Air ve Uçak → Air olarak gösterilir; Türkçe değerler değişmez.',
        en: 'Del. Type values are displayed as Gemi → Sea, Gemi+Uçak → Sea+Air and Uçak → Air in English; Turkish values remain unchanged.' },
      { tr: 'CP ve Onaylar tablolarındaki üst grup bantlarının ve başladıkları sütunların arasına belirgin dikey ayraçlar eklendi.',
        en: 'Clear vertical separators were added between the upper group bands and the columns where each group begins in CP and Approvals.' },
      { tr: 'Filtreler, hızlı filtreler, kopyalama ve Excel çıktıları seçili dildeki Del. Type etiketlerini kullanır.',
        en: 'Filters, quick filters, copy and Excel exports use the Del. Type labels for the selected language.' },
    ],
  },
  {
    v: '2.45', date: '2026-07-24',
    title: { tr: 'Aydınlık tema tablo başlıkları standartlaştırıldı', en: 'Light-theme table headers standardized' },
    items: [
      { tr: 'Aydınlık temada Nakliye Kıyaslama dışındaki tüm tablo sütun başlıklarının zemini #F2F4F7 olarak güncellendi.',
        en: 'In the light theme, all table column headers except Shipping Comparison now use #F2F4F7.' },
      { tr: 'JavaScript tarafından doğrudan mavi zemin verilen dinamik tablo başlıkları da aynı gri tona getirildi.',
        en: 'Dynamically generated table headers that previously used an inline blue background are also normalized to the same grey.' },
      { tr: 'Koyu, gri ve antrasit tema renkleri ile Nakliye Kıyaslama başlıkları değiştirilmedi.',
        en: 'Dark, grey and charcoal themes, as well as Shipping Comparison headers, remain unchanged.' },
    ],
  },
  {
    v: '2.44', date: '2026-07-24',
    title: { tr: 'Düzenlenen satırlarda sütun dondurma korunuyor', en: 'Frozen columns are preserved on edited rows' },
    items: [
      { tr: 'CP veya Onaylar tablosunda bir hücre düzenlendiğinde yalnız yenilenen satırın dondurulmuş sütunlarının bozulması düzeltildi.',
        en: 'Fixed frozen columns being lost only on the row refreshed after editing a CP or Approvals cell.' },
      { tr: 'Satır yenilendikten sonra soldan/sağdan dondurulan hücre sınıfları, ofsetleri ve kenar gölgeleri aynı satıra yeniden uygulanır.',
        en: 'After a row refresh, left/right frozen-cell classes, offsets and edge shadows are reapplied to that row.' },
      { tr: 'Diğer satırlar ve tablonun yatay kaydırma konumu etkilenmez.',
        en: 'Other rows and the table horizontal scroll position are not affected.' },
    ],
  },
  {
    v: '2.43', date: '2026-07-24',
    title: { tr: 'Discount ASAS orijinal Ex-Factory revizyonuna bağlandı', en: 'Discount tied to the ASAS original Ex-Factory revision' },
    items: [
      { tr: 'Discount artık bugünün tarihine göre hesaplanmaz; ASAS Orijinal Exfactory Merch Tarih ile ekranda görünen mevcut Ex-Factory karşılaştırılır.',
        en: 'Discount is no longer calculated against today; the ASAS Original Exfactory Merch Date is compared with the currently displayed Ex-Factory.' },
      { tr: 'Mevcut Ex-Factory, ASAS orijinal tarihinden 10 gün veya daha fazla ilerideyse Discount / İndirim mevcut Priority değerinin sonuna eklenir.',
        en: 'When the current Ex-Factory is 10 or more days later than the ASAS original date, Discount is appended to the current Priority.' },
      { tr: 'ASAS orijinal tarihi satırda gizli kaynak değeri olarak korunur; kullanıcı Ex-Factory hücresini değiştirdiğinde karşılaştırma kaybolmaz.',
        en: 'The ASAS original date is retained as hidden source metadata, so the comparison remains available when the user edits the Ex-Factory cell.' },
    ],
  },

  {
    v: '2.42', date: '2026-07-24',
    title: { tr: 'Discount uyarısı 10. günden itibaren mevcut Priority değerine ekleniyor', en: 'Discount warning is appended to the current Priority from day 10' },
    items: [
      { tr: 'Ex-Factory tarihi bugün itibarıyla 10 gün veya daha fazla geçmişse Discount / İndirim uyarısı oluşur.',
        en: 'The Discount warning is created when the Ex-Factory date is 10 or more days in the past.' },
      { tr: 'Uyarı mevcut Priority değerini değiştirmez; In Time | Discount, Delay | Discount veya MB Delay | Discount gibi sonuna eklenir.',
        en: 'The warning does not replace the current Priority; it is appended, such as In Time | Discount, Delay | Discount or MB Delay | Discount.' },
      { tr: 'Kural artık sipariş statüsünden bağımsız olarak Ex-Factory tarih farkına göre uygulanır.',
        en: 'The rule is now applied from the Ex-Factory age regardless of order status.' },
    ],
  },
  {
    v: '2.41', date: '2026-07-24',
    title: { tr: 'Koleksiyon görsel boyutu ve satır yüksekliği birlikte değişiyor', en: 'Collection image size and row height now change together' },
    items: [
      { tr: 'Picture / Görsel sütunu başlığı artık menü açmaz; her tıklamada Küçük, Orta ve Büyük boyutlar arasında sırayla geçiş yapar.',
        en: 'The Picture column header no longer opens a menu; each click cycles through Small, Medium and Large.' },
      { tr: 'Görsel küçültüldüğünde Koleksiyon satırı ve çok satırlı metin alanları da aynı anda küçülür.',
        en: 'When the image is reduced, the Collection row and multiline text fields shrink at the same time.' },
      { tr: 'Görsel boyutu menüsündeki Görsel sütununu kaldır eylemi kaldırıldı; sütun görünürlüğü genel Columns panelinden yönetilmeye devam eder.',
        en: 'The Remove Image Column action was removed from the image-size control; visibility remains available in the standard Columns panel.' },
    ],
  },
  {
    v: '2.40', date: '2026-07-24',
    title: { tr: 'Taslak e-posta ekranında üretici bilgileri yerinde düzenlenebiliyor', en: 'Manufacturer details can be edited inline in draft email screens' },
    items: [
      { tr: 'Üretici seçim listesindeki her seçim kutusunun altına kalem düğmesi eklendi.',
        en: 'A pencil button was added directly below each manufacturer selection checkbox.' },
      { tr: 'Kaleme basınca üretici adı ve e-posta adresi aynı kartın içinde düzenlenebilir alanlara dönüşür; ayrı pencere açılmaz.',
        en: 'Pressing the pencil turns the manufacturer name and email into editable fields inside the same card, without opening another window.' },
      { tr: 'Düzenleme kalem düğmesindeki onay işaretiyle veya Ctrl+Enter ile kaydedilir; Esc değişikliği iptal eder.',
        en: 'Edits are saved with the check button or Ctrl+Enter; Esc cancels the edit.' },
      { tr: 'Üretici adı değiştirildiğinde Koleksiyon fiyatları ve onaylı üretici bağlantıları yeni ada taşınır.',
        en: 'When a manufacturer name changes, Collection prices and confirmed-manufacturer links are migrated to the new name.' },
    ],
  },
  {
    v: '2.39', date: '2026-07-23',
    title: { tr: 'Koleksiyon görsel boyutu seçilebiliyor', en: 'Collection image size is now selectable' },
    items: [
      { tr: 'Koleksiyon ekranında görsel sütununun başlığına tıklayarak boyutu değiştirebilirsin: Küçük, Orta, Büyük.',
        en: 'On the Collection screen you can change the image size by clicking the image column header: Small, Medium, Large.' },
      { tr: 'Orta boyut büyüğün, küçük boyut da ortanın en ve boy olarak yarısıdır. Varsayılan Büyük olarak kalır.',
        en: 'Medium is half the width and height of Large, and Small is half of Medium. The default remains Large.' },
      { tr: 'Aynı menüden görsel sütununu tamamen kaldırabilirsin.',
        en: 'From the same menu you can remove the image column entirely.' },
      { tr: 'Excel aktarımları ve kopyalama işlemleri seçimini dikkate alır; görsel sütunu kaldırıldığında çıktıda da yer almaz.',
        en: 'Excel exports and copy operations follow your choice; when the image column is removed it is left out of the output as well.' },
      { tr: 'Görselin üzerine gelince büyüyen önizleme eskisi gibi çalışmaya devam eder.',
        en: 'The preview that enlarges when hovering over an image continues to work as before.' },
    ],
  },
  {
    v: '2.38', date: '2026-07-23',
    title: { tr: 'Üretici seçim penceresi yenilendi', en: 'Manufacturer selection window redesigned' },
    items: [
      { tr: '"Fiyatlamaya Gönder" ve "Üretim Durumu Sor" pencereleri Not Defteri ile aynı tasarıma geçti: solda üretici listesi, sağda seçili üreticilerin e-posta adresleri.',
        en: 'The "Send to Pricing" and "Ask Production Status" windows now use the same design as the Notebook: manufacturer list on the left, email addresses of the selected manufacturers on the right.' },
      { tr: 'Üretim durumu sorarken artık ilgili üreticiyle sınırlı değilsin; listeden istediğin kadar başka üretici de seçebilirsin.',
        en: 'When asking for production status you are no longer limited to the related manufacturer; you can select as many others from the list as you like.' },
      { tr: 'Pencere açıldığında seçili siparişlerin üreticileri işaretli gelmeye devam eder.',
        en: 'When the window opens, the manufacturers of the selected orders remain preselected.' },
      { tr: 'Siparişlerde geçip listede bulunmayan üreticiler listeye eklenir ve işaretli gelir.',
        en: 'Manufacturers that appear in the orders but are missing from the list are added and preselected.' },
      { tr: 'Üretici araması, e-posta adreslerinin anında kaydedilmesi ve eksik e-posta uyarısı eklendi.',
        en: 'Manufacturer search, instant saving of email addresses and a warning for missing emails were added.' },
    ],
  },
  {
    v: '2.37', date: '2026-07-23',
    title: { tr: 'Yazım düzeni: büyük harf kullanımı gözden geçirildi', en: 'Typography: capitalisation reviewed throughout' },
    items: [
      { tr: 'Uygulamadaki hiçbir metin artık tamamı büyük harfle yazılmıyor. Sütun başlıkları, grup başlıkları, kart ve panel başlıkları düzgün büyük/küçük harf düzenine geçirildi.',
        en: 'No text in the application is written in all capitals any more. Column headers, group headers, card and panel titles now use proper capitalisation.' },
      { tr: 'Metinleri büyük harfe zorlayan stil kuralları kaldırıldı. Bu kurallar Türkçe karakterleri de bozuyordu (i harfi İ yerine I oluyordu).',
        en: 'The style rules that forced text into capitals were removed. Those rules also corrupted Turkish characters.' },
      { tr: 'FOB, OPD, MAG, MMYG, PLM ID gibi kısaltmalar büyük harf olarak korundu.',
        en: 'Abbreviations such as FOB, OPD, MAG, MMYG and PLM ID remain capitalised.' },
      { tr: 'İngilizce sürümde Türkçe karakter kullanılmadığı doğrulandı; her iki dilde de yazım kurallarına uygunluk gözden geçirildi.',
        en: 'The English version was verified to contain no Turkish characters, and spelling conventions were reviewed in both languages.' },
      { tr: 'Sütun genişliği ölçümü gerçek başlık metnine göre yapılır; başlıklar artık büyük harfe çevrilmediği için genişlikler doğru hesaplanıyor.',
        en: 'Column widths are measured from the actual header text, so widths are calculated correctly now that headers are no longer uppercased.' },
    ],
  },
  {
    v: '2.36', date: '2026-07-23',
    title: { tr: 'Üretim durumu sorma ve düzenlenebilir e-posta metinleri', en: 'Production status requests and editable email texts' },
    items: [
      { tr: 'CP ekranına "Üretim Durumu Sor" düğmesi eklendi; seçili siparişler için merchandiser\'lara taslak e-posta oluşturur.',
        en: 'An "Ask Production Status" button was added to the CP screen, creating draft emails to merchandisers for the selected orders.' },
      { tr: 'Siparişler üreticiye göre gruplanır ve her üretici için ayrı taslak hazırlanır; sipariş listesi e-postanın içine tablo olarak eklenir.',
        en: 'Orders are grouped by manufacturer and a separate draft is prepared for each; the order list is embedded in the email as a table.' },
      { tr: 'Durumu "Üretimde" olan siparişler öne alınır, diğerleri listeye alınmaz ve bu pencerede belirtilir.',
        en: 'Orders with the "Üretimde" status are prioritised; the others are left out and this is noted in the window.' },
      { tr: 'Hem "Fiyatlamaya Gönder" hem "Üretim Durumu Sor" taslaklarının metni artık düzenlenebilir. "Metni düzenle" ile farklı şablonlar oluşturup adlandırabilir ve aralarında geçiş yapabilirsin.',
        en: 'The text of both "Send to Pricing" and "Ask Production Status" drafts is now editable. With "Edit text" you can create, name and switch between different templates.' },
      { tr: 'Üretici e-posta adresleri hatırlanır; bir sonraki seferde hazır gelir.',
        en: 'Manufacturer email addresses are remembered and prefilled next time.' },
    ],
  },
  {
    v: '2.35', date: '2026-07-23',
    title: { tr: 'Tablo başlıkları ve kopyalama kenarlıkları', en: 'Table headers and copy borders' },
    items: [
      { tr: 'Aydınlık temada tablo sütun başlıkları Gri temadaki gri tona geçirildi; başlık satırı artık gövdeden net ayrılıyor.',
        en: 'In the light theme, table column headers now use the grey tone from the Grey theme, so the header row stands out clearly from the body.' },
      { tr: 'Dışa aktarılan Excel dosyaları ve kopyalanan tablolar da aynı gri başlık biçimlendirmesini kullanır.',
        en: 'Exported Excel files and copied tables use the same grey header formatting.' },
      { tr: 'Excel\'e yapıştırılan satırlarda kenarlıklar kalın görünüyordu; ince kenarlığa çevrildi.',
        en: 'Borders looked thick when pasting rows into Excel; they were changed to thin borders.' },
      { tr: 'Antrasit temadayken dışa aktarma sonrası tema geri yüklenirken oluşan küçük bir hata giderildi.',
        en: 'Fixed a small issue when restoring the Charcoal theme after an export.' },
    ],
  },
  {
    v: '2.34', date: '2026-07-23',
    title: { tr: 'Sütun dondurma (Bölmeleri Dondur)', en: 'Freeze columns (freeze panes)' },
    items: [
      { tr: 'Tablolara Excel\'deki "Bölmeleri Dondur" mantığıyla çalışan sütun dondurma eklendi. Araç çubuğundaki "Satırları Dondur" düğmesiyle başlatılır.',
        en: 'Column freezing was added to the tables, working like Excel\'s "Freeze Panes". Start it with the "Freeze Columns" button in the toolbar.' },
      { tr: 'Tek sütun seçersen o sütun dahil solundakiler sabitlenir, sağdaki sütunlar yatay kaydırılır.',
        en: 'Selecting a single column freezes that column and everything to its left, while the columns to the right scroll horizontally.' },
      { tr: 'İki sütun seçersen aradaki alan kaydırılabilir kalır; her iki yandaki sütunlar sabitlenir.',
        en: 'Selecting two columns keeps the range between them scrollable while the columns on both sides stay fixed.' },
      { tr: 'Seçim fare ile sütun başlıklarına tıklanarak yapılır; Enter veya "Uygula" ile uygulanır, Esc ile çıkılır.',
        en: 'Selection is done by clicking column headers with the mouse; apply with Enter or "Apply", exit with Esc.' },
      { tr: '"Dondurmayı Kaldır" ile eski görünüme dönülür. Seçim tablo bazında saklanır ve program yeniden açıldığında korunur.',
        en: '"Unfreeze" restores the previous view. The setting is stored per table and preserved when the program is reopened.' },
    ],
  },
  {
    v: '2.33', date: '2026-07-23',
    title: { tr: 'Not Defteri: yeni ad ve pencere yüksekliği', en: 'Notebook: new name and window height' },
    items: [
      { tr: 'TO DO penceresinin adı TR "Not Defteri" / EN "Notebook" olarak değiştirildi.',
        en: 'The TO DO window was renamed to "Notebook" (TR "Not Defteri").' },
      { tr: 'Pencere artık ekran yüksekliğinin %70\'i kadar açılır; yazma alanı kalan boşluğu doldurur.',
        en: 'The window now opens at 70% of the viewport height, with the writing area filling the remaining space.' },
      { tr: 'Mevcut not sayfaların ve içerikleri olduğu gibi korundu.',
        en: 'Your existing note pages and their contents were preserved as they were.' },
    ],
  },
  {
    v: '2.32', date: '2026-07-23',
    title: { tr: 'Sunucu penceresi tarayıcıyla birlikte kapanır', en: 'Server window closes with the browser' },
    items: [
      { tr: 'Tarayıcıdaki Buyer Log kapatıldığında sunucu penceresi de kendiliğinden kapanır; artık elle kapatman gerekmiyor.',
        en: 'When Buyer Log is closed in the browser, the server window now closes by itself; you no longer need to close it manually.' },
      { tr: 'Kapanma sinyali sekme kapatma, pencere kapatma ve tarayıcıdan çıkma durumlarının hepsinde gönderilir.',
        en: 'The shutdown signal is sent when closing a tab, closing the window, or quitting the browser entirely.' },
      { tr: 'Sinyal hiç ulaşmazsa (çökme, ani kapanma) sunucu sessizlik süresini algılayıp en geç bir dakika içinde kapanır.',
        en: 'If no signal arrives at all (crash or abrupt close) the server detects the silence and shuts down within a minute at most.' },
      { tr: 'Sayfayı yenilemek sunucuyu kapatmaz; kısa bekleme penceresi korunur.',
        en: 'Refreshing the page does not shut the server down; the short grace period is preserved.' },
    ],
  },
  {
    v: '2.31', date: '2026-07-23',
    title: { tr: 'Not penceresi yüksekliği', en: 'Notes window height' },
    items: [
      { tr: 'Not düzenleme penceresi artık pencere yüksekliğinin %70\'i kadar açılır; metin alanı kalan boşluğu doldurur.',
        en: 'The note editor window now opens at 70% of the viewport height, with the text area filling the remaining space.' },
      { tr: 'Metin alanının sabit yüksekliği kaldırıldı; pencere büyüdükçe yazma alanı da büyür.',
        en: 'The fixed height of the text area was removed, so the writing area grows together with the window.' },
    ],
  },
  {
    v: '2.30', date: '2026-07-23',
    title: { tr: 'CP: ikinci not sütunu', en: 'CP: second notes column' },
    items: [
      { tr: 'CP tablosuna ikinci bir not sütunu eklendi (TR "Ek Notlar" / EN "Notes 2"); mevcut Notlar sütunuyla aynı tasarım ve biçimlendirmeyi kullanır.',
        en: 'A second notes column was added to the CP table (EN "Notes 2" / TR "Ek Notlar"), using the same design and formatting as the existing Notes column.' },
      { tr: 'Her iki not sütunu da aynı düzenleme penceresini, silme düğmesini, geri alma desteğini ve sütun genişliğini paylaşır.',
        en: 'Both notes columns share the same editor window, delete button, undo support and column width.' },
      { tr: 'Ek notlar kaydedilir ve Excel dışa/içe aktarımında ayrı sütun olarak yer alır.',
        en: 'Additional notes are saved and appear as a separate column in Excel export and import.' },
    ],
  },
  {
    v: '2.29', date: '2026-07-23',
    title: { tr: 'TO DO çok sayfalı not defteri oldu', en: 'TO DO became a multi-page notebook' },
    items: [
      { tr: 'TO DO penceresi, Sürüm Geçmişi ile aynı yerleşime geçti: solda not sayfaları listesi, sağda seçili sayfanın metni.',
        en: 'The TO DO window now uses the same layout as Version History: note pages on the left, the selected page text on the right.' },
      { tr: '"Yeni not" ile istediğin kadar ayrı not sayfası açabilir, her birine kendi başlığını verebilirsin.',
        en: 'With "New note" you can create as many separate note pages as you like, each with its own title.' },
      { tr: 'Not başlıklarında ve metinlerinde arama yapılabilir; sayfalar tarayıcıda kalıcı olarak saklanır.',
        en: 'You can search across note titles and text; pages are stored persistently in the browser.' },
      { tr: 'Önceki tek metinli TO DO içeriği ilk not sayfasına taşındı, hiçbir şey kaybolmadı.',
        en: 'The previous single-text TO DO content was migrated into the first note page, so nothing was lost.' },
      { tr: 'Sürüm Geçmişi notları sade madde listesi görünümüne geri döndürüldü.',
        en: 'Version History notes were reverted to the plain bullet list view.' },
    ],
  },
  {
    v: '2.28', date: '2026-07-23',
    title: { tr: 'Ok tuşu düzeltmesi, Koleksiyon lisans önerileri, daha uzun tablolar', en: 'Arrow key fix, Collection license suggestions, longer tables' },
    items: [
      { tr: 'Hücreye veri girip yukarı/aşağı ok tuşuna bastığında sayfanın kayması engellendi. Hedef hücre bulunamadığında (son satır, ayraç satırı veya eşleşen sütun yoksa) tarayıcının varsayılan kaydırma davranışı devreye giriyordu.',
        en: 'Fixed the page scrolling when pressing up/down arrows after entering data in a cell. When no target cell was found (last row, separator row, or no matching column) the browser default scroll took over.' },
      { tr: 'Açılır liste hücrelerinde ok tuşu eskisi gibi seçenekler arasında gezinmeye devam eder.',
        en: 'In dropdown cells the arrow keys still move between options as before.' },
      { tr: 'Koleksiyon sayfasındaki LICENSE sütunu, Sub-Mfr hücreleriyle aynı şekilde çalışır: sistemdeki lisanslar önerilir, serbest metin de yazılabilir.',
        en: 'The LICENSE column on the Collection page now works like the Sub-Mfr cells: licenses in the system are suggested and free text can still be typed.' },
      { tr: 'Lisans önerileri CP, order summary ve Koleksiyon satırlarından toplanır.',
        en: 'License suggestions are collected from CP, order summary and Collection rows.' },
      { tr: 'Tablolar aşağıya doğru üç kat uzatıldı; LFL tabloları ve grafikleri de aynı oranda büyütüldü.',
        en: 'Tables were extended to three times their vertical length; LFL tables and charts were enlarged proportionally.' },
    ],
  },
  {
    v: '2.26', date: '2026-07-23',
    title: { tr: 'Sürüm Geçmişi: sürüm seçici ve not düzeltmesi', en: 'Version History: version selector and notes fix' },
    items: [
      { tr: 'Pencerede sol tarafta tüm sürümler alt alta listelenir; en yeni sürüm en üsttedir. Bir sürüme tıklayınca notları sağda görünür.',
        en: 'All versions are listed vertically on the left, newest at the top. Clicking a version shows its notes on the right.' },
      { tr: 'Güncelleme notlarının görünmemesine yol açan liste biçimlendirme hatası düzeltildi.',
        en: 'Fixed a list styling issue that prevented update notes from being displayed.' },
      { tr: 'Pencere açıldığında en yeni sürüm otomatik seçili gelir; arama sonuçlarında ilk sürüm seçilir.',
        en: 'The newest version is selected automatically when the window opens; searching selects the first matching version.' },
    ],
  },
  {
    v: '2.25', date: '2026-07-23',
    title: { tr: 'Sürüm Geçmişi penceresi', en: 'Version History window' },
    items: [
      { tr: 'Başlıktaki sürüm yazısına tıklayınca sürümler arası tüm güncellemelerin listelendiği "Sürüm Geçmişi" penceresi açılır.',
        en: 'Clicking the version label in the header opens a "Version History" window listing every update between releases.' },
      { tr: 'Pencere içinde sürüm veya değişiklik metinlerinde arama yapılabilir.',
        en: 'The window supports searching across version numbers and change descriptions.' },
      { tr: 'İçerik seçili dile (TR/EN) göre gösterilir; dil değiştirildiğinde pencere de güncellenir.',
        en: 'Content follows the selected language (TR/EN) and refreshes when the language is switched.' },
    ],
  },
  {
    v: '2.24', date: '2026-07-23',
    title: { tr: 'Kopyalama, Excel çıktısıyla aynı hücre biçiminde', en: 'Copy now matches the Excel export cell format' },
    items: [
      { tr: 'Kopyalama, "Excel\'e Aktar" ile aynı hücre biçimini üretir: renkler, hizalama ve kalınlık ekrandaki tablodan okunur.',
        en: 'Copy produces the same cell formatting as "Export to Excel": colours, alignment and weight are read from the on-screen table.' },
      { tr: 'Koyu veya antrasit temada kopyalarken çıktı otomatik olarak aydınlık tema renkleriyle üretilir; tema ve kaydırma konumu sonra geri yüklenir.',
        en: 'When copying in dark or charcoal themes the output is produced with light-theme colours, then the theme and scroll position are restored.' },
      { tr: 'Gruplu (birleştirilmiş) başlıklar korunur.',
        en: 'Grouped (merged) headers are preserved.' },
      { tr: 'CP, Onaylar, Nakliye Kıyaslama ve Koleksiyon tablolarının tümünde geçerlidir.',
        en: 'Applies to the CP, Approvals, Shipping Comparison and Collection tables.' },
    ],
  },
  {
    v: '2.23', date: '2026-07-23',
    title: { tr: 'CP fiyatlama akışı ve Koleksiyona Kopyala', en: 'CP pricing flow and Copy to Collection' },
    items: [
      { tr: 'CP\'deki "Fiyatlamaya Gönder" artık Koleksiyon ile aynı akışı kullanır (üretici seçimi, taslak e-posta ve Excel eki).',
        en: 'CP "Send to Pricing" now uses the same flow as Collection (manufacturer selection, draft email and Excel attachment).' },
      { tr: 'CP\'den gönderirken satırlar Koleksiyon\'a kopyalanmaz; işlem doğrudan CP üzerinden yürür.',
        en: 'Sending from CP no longer copies rows into Collection; the process runs directly on CP.' },
      { tr: 'Hedef fiyat alanına CP\'deki Supp. FOB değeri yazılır.',
        en: 'The target price field is filled from the Supp. FOB value in CP.' },
      { tr: 'Yeni "Koleksiyona Kopyala" butonu eklendi (Kopyala butonunun solunda, yalnızca CP sekmesinde).',
        en: 'New "Copy to Collection" button added (left of Copy, visible only on the CP tab).' },
    ],
  },
  {
    v: '2.22', date: '2026-07-23',
    title: { tr: 'Sil butonu, LT sütunu ve kopyalama teması', en: 'Delete button, LT column and copy theme' },
    items: [
      { tr: 'Ön Maliyet satırlarındaki sil butonu artık tam görünür; sütun genişliği sabitlendi.',
        en: 'The delete button on Open Costing rows is now fully visible; its column width is fixed.' },
      { tr: 'CP tablosuna üretim süresi sütunu eklendi (TR "Ür. Sür." / EN "LT"): Ex-Factory eksi OPD, gün cinsinden.',
        en: 'Production lead-time column added to the CP table (EN "LT" / TR "Ür. Sür."): Ex-Factory minus OPD, in days.' },
      { tr: 'Kopyalanan tablo başlıkları lacivert yerine aydınlık temanın gri başlık rengiyle üretilir.',
        en: 'Copied table headers use the light theme grey instead of navy blue.' },
    ],
  },
  {
    v: '2.21', date: '2026-07-22',
    title: { tr: 'CP işlem çubuğu sıralaması', en: 'CP action bar ordering' },
    items: [
      { tr: 'Geri (Undo) ve İleri (Redo) butonları işlem çubuğunun başına taşındı.',
        en: 'Undo and Redo buttons moved to the start of the action bar.' },
      { tr: 'Kopyala, Excel\'e Aktar, Onaylarla Dışa Aktar, Supp. FOB Kuralları, Maliyet Oluştur, Fiyatlamaya Gönder, Nakliye Kıyaslama, Filtreleri Temizle ve Sütunlar kontrolleri sıraya alındı.',
        en: 'Copy, Export, Export with Approvals, Supp. FOB Rules, Create OC, Send to Pricing, Shipping Comparison, Clear Filters and Columns controls were reordered.' },
      { tr: 'Görünüm ve Filtre menüleri Sütunlar kontrolünün yanına alındı.',
        en: 'View and Filter menus were moved next to the Columns control.' },
    ],
  },
  {
    v: '2.20', date: '2026-07-22',
    title: { tr: 'Kur güncellemesi ayrıldı, LFL için ASAS yükleme', en: 'FX update separated, ASAS upload for LFL' },
    items: [
      { tr: '"Kaynak Veriden Güncelle" artık yalnızca ASAS ve Antrepo verisini tazeler; kur tablosuna dokunmaz.',
        en: '"Refresh From Source" now refreshes only ASAS and Bonded Warehouse data; it no longer touches the FX table.' },
      { tr: 'Kurlar yalnızca "Kur Dosyası Yükle" ile elle güncellenir.',
        en: 'Exchange rates are updated manually via "Upload Exchange Rates" only.' },
      { tr: '"LFL İçin ASAS Yükle" butonu eklendi; seçilen Excel, LFL analizinin kullandığı ayrıştırıcıdan geçer.',
        en: '"Upload ASAS for LFL" button added; the selected Excel goes through the same parser the LFL analysis uses.' },
    ],
  },
  {
    v: '2.19', date: '2026-07-22',
    title: { tr: 'CP butonlarının kaldırılması', en: 'Removal of CP buttons' },
    items: [
      { tr: '"CP Dışa Aktar", "CP İçe Aktar" ve "CP Yükle" butonları arayüzden tamamen kaldırıldı.',
        en: '"Export CP", "Import CP" and "Load CP" buttons were fully removed from the interface.' },
      { tr: 'ASAS\'tan CP üretme mantığı korundu; sürükle-bırak ile dosya bırakıldığında CP üretimi çalışmaya devam eder.',
        en: 'The ASAS-to-CP generation logic was preserved; dropping a file still generates the CP.' },
      { tr: '"Kur Dosyası Yükle" butonu Antrepo butonunun soluna alındı.',
        en: '"Upload Exchange Rates" button moved to the left of the Bonded Warehouse button.' },
    ],
  },
  {
    v: '2.18', date: '2026-07-22',
    title: { tr: 'Araç çubuğu, uzun tablolar ve Kaynak Veri paneli', en: 'Toolbar, longer tables and Source Data panel' },
    items: [
      { tr: 'İşlem butonları Geri/İleri butonlarının soluna alındı.',
        en: 'Action buttons were moved to the left of the Undo/Redo buttons.' },
      { tr: 'Tablolar aşağıya doğru iki kat uzatıldı; LFL tabloları ve grafikleri de aynı oranda büyütüldü.',
        en: 'Tables were extended to twice their vertical length; LFL tables and charts were enlarged proportionally.' },
      { tr: 'Kaynak Veri paneli yeniden adlandırıldı: Kaynak Veri, ASAS Yükle, Antrepo Yükle, Kaynak Veriden Güncelle, Kaynak Klasör.',
        en: 'The Source Data panel was renamed: Source Data, Upload ASAS, Upload Antrepo, Refresh From Source, Source Folder.' },
      { tr: '"Kur Dosyası Yükle" butonu eklendi.',
        en: '"Upload Exchange Rates" button was added.' },
    ],
  },
  {
    v: '2.17', date: '2026-07-22',
    title: { tr: 'Ön Maliyet ergonomi düzeltmeleri', en: 'Open Costing ergonomics fixes' },
    items: [
      { tr: 'Yeni bir maliyet oluşturulduğunda tüm maliyet grupları kapalı gelir; kayıtlı maliyet açıldığında yalnızca veri girilmiş gruplar açılır.',
        en: 'All cost sections start collapsed on a new costing; on a saved costing only sections containing data are expanded.' },
      { tr: '"Açıklama / Özellik" başlığı "Açıklama" olarak sadeleştirildi.',
        en: 'The "Description / Specification" header was simplified to "Description".' },
      { tr: '"Çoğalt" butonu artık anında, maliyetin son halinin birebir kopyasını oluşturur.',
        en: '"Duplicate" now instantly creates an exact copy of the costing in its current state.' },
      { tr: 'Maliyet listesindeki kayıtlar tek tıkla açılır.',
        en: 'Records in the costing list open with a single click.' },
      { tr: 'Maliyet tablosu her yakınlaştırma seviyesinde panelin içine sığar.',
        en: 'The cost table fits inside its panel at every zoom level.' },
    ],
  },
  {
    v: '2.16', date: '2026-07-22',
    title: { tr: 'Maliyet Oluştur, buton durumları ve panel katmanları', en: 'Create OC, button states and panel layering' },
    items: [
      { tr: 'CP ve Koleksiyon\'a "Maliyet Oluştur" butonu eklendi; seçili satırlardan ön maliyet kayıtları üretir.',
        en: '"Create OC" button added to CP and Collection; it creates Open Costing records from the selected rows.' },
      { tr: 'Seçime bağlı butonlar seçim yokken pasif, seçim varken aktif hale getirildi.',
        en: 'Selection-dependent buttons are disabled without a selection and enabled when rows are selected.' },
      { tr: 'Nakliye butonu ve sayfası "Nakliye Kıyaslama" olarak adlandırıldı.',
        en: 'The shipping button and page were renamed "Shipping Comparison".' },
      { tr: 'CP boyut filtreleri Geri/İleri altına taşındı; açılır panelleri her zaman tablonun önünde açılır.',
        en: 'CP dimension filters moved below Undo/Redo; their panels always open in front of the table.' },
      { tr: 'Favori Görünüm ve Filtre ayarları her sayfaya ilk girişte otomatik uygulanır.',
        en: 'Favourite View and Filter settings are applied automatically on first visit to each page.' },
    ],
  },
  {
    v: '2.15', date: '2026-07-22',
    title: { tr: 'Dördüncü tema: Antrasit', en: 'Fourth theme: Charcoal' },
    items: [
      { tr: 'Gri ile Karanlık arasında konumlanan "Antrasit" teması eklendi; tema döngüsü Aydınlık, Gri, Antrasit, Karanlık şeklindedir.',
        en: 'A "Charcoal" theme sitting between Grey and Dark was added; the cycle is Light, Grey, Charcoal, Dark.' },
      { tr: 'Tüm arayüz renkleri okunabilirlik açısından gözden geçirildi.',
        en: 'All interface colours were reviewed for readability.' },
    ],
  },
  {
    v: '2.14', date: '2026-07-22',
    title: { tr: 'Ön Maliyet seçim kutuları ve ortalanmış yerleşim', en: 'Open Costing pickers and centered layout' },
    items: [
      { tr: 'Model, Üretici, Ülke, Sezon, Lisans, Kategori, Para Birimi ve Kur Ayı alanları aynı aranabilir açılır liste tasarımını kullanır.',
        en: 'Model, Manufacturer, Country, Season, License, Category, Currency and FX Month share the same searchable dropdown design.' },
      { tr: 'Ön Maliyet çalışma alanı sayfa genişliğinin yaklaşık üçte ikisine ortalandı.',
        en: 'The Open Costing workspace is centered at about two-thirds of the page width.' },
    ],
  },
  {
    v: '2.03', date: '2026-07-22',
    title: { tr: 'Excel\'den kur güncelleme ve yeniden tasarım', en: 'FX update from Excel and redesign' },
    items: [
      { tr: '"Kur Güncelle" ile Aylık Kur Tahmin Raporu Excel\'i yüklenerek kurlar toplu güncellenir.',
        en: '"Update FX" allows bulk updating rates by uploading the Monthly FX Forecast Excel.' },
      { tr: 'Kur bilgisi uygulama genelinde ortak bir modül üzerinden kullanılır.',
        en: 'Exchange rates are served application-wide through a shared module.' },
      { tr: 'LFL ve Ön Maliyet sayfaları tek ölçü sistemiyle yeniden tasarlandı.',
        en: 'The LFL and Open Costing pages were redesigned on a single sizing system.' },
    ],
  },
  {
    v: '2.02', date: '2026-07-22',
    title: { tr: 'Ön Maliyet: kur girişi ve döviz dönüşümü', en: 'Open Costing: FX entry and currency conversion' },
    items: [
      { tr: 'Ay bazlı döviz kuru girişi eklendi.',
        en: 'Month-based exchange rate entry was added.' },
      { tr: 'Ön maliyet kaydedildiğinde oluşturulduğu ayın kuru kaydın içine yazılır ve sonradan değişmez.',
        en: 'When a costing is saved, the rate for its creation month is stored with it and stays fixed.' },
      { tr: 'Karşılaştırma penceresine para birimi seçici eklendi; her kayıt kendi kuruyla çevrilir.',
        en: 'A currency selector was added to the comparison window; each record is converted using its own rate.' },
    ],
  },
  {
    v: '2.01', date: '2026-07-22',
    title: { tr: 'Ön Maliyet: karşılaştırma', en: 'Open Costing: comparison' },
    items: [
      { tr: 'İki veya daha fazla ön maliyeti yan yana karşılaştırma penceresi eklendi.',
        en: 'A window for comparing two or more costings side by side was added.' },
      { tr: 'Satır bazında en düşük ve en yüksek değerler renklendirilir; baz alınan çalışmaya göre farklar hesaplanır.',
        en: 'Lowest and highest values are highlighted per row, and differences are calculated against the chosen baseline.' },
    ],
  },
  {
    v: '2.00', date: '2026-07-22',
    title: { tr: 'Yeni tasarım ve başlatıcılar', en: 'New design and launchers' },
    items: [
      { tr: 'Arayüz yeni bir tasarım sistemine geçirildi; aydınlık, gri ve karanlık temalar eklendi.',
        en: 'The interface moved to a new design system; light, grey and dark themes were added.' },
      { tr: 'Masaüstü kısayolu ve yönetici izni gerektirmeyen başlatıcılar eklendi.',
        en: 'A desktop shortcut and launchers that require no administrator permission were added.' },
      { tr: 'Tüm sekmeler kapatıldığında sunucu kendini kapatır.',
        en: 'The server shuts itself down when all tabs are closed.' },
    ],
  },
];
