# Agent Ofisi — grafik düzeltmeleri, 10 Ekim 2026

## Uygulama

Sabit kameralı iki katlı Pixel Atölye mimarisi, mevcut temalı kontroller ve ajan bağlantıları korunur. Bu değişiklikte yeni AI çağrısı, veri taşıma veya sunucu davranışı yoktur.

- Alt katın arka/ön zemin koordinatları ayrıldı. Halılar zemin perspektifine oturur ve yüzey sınırlarını aşmaz. Dolap ve askılıklar arka duvara oturur; uzun nesnelerin oranları tavana sığarken korunur.
- Çizim sırası navigasyon hücresi yerine gerçek oturma/yürüme pozunu kullanır. Koltuğun ön kenarı, toplantının arka koltukları ve merdiven fiziksel derinliğe göre çizilir.
- Üst giyim, pantolon, saç, ten ve ayakkabı kaynak atlas üzerindeki ayrı malzeme maskeleriyle renklendirilir. Ceket/gömlek/atkı detayları kıyafete kırpılır ve kaynak alfa sınırlarını korur. Kulaklıklar pozlara bağlı piksel ankrajları kullanır.
- Üç karakter için yeni profil yürüyüş atlası eklenmiştir. Altı aşamalı adım ritmi dünya mesafesine bağlıdır; engelde beklerken ilerlemez. Arka görünüm mevcut atlası kullanır. Hareket süreleri yatay adımda 0,72, dikey adımda 0,6, merdivende 6,8 saniyedir.
- Tavan ışıklarının tüm saydam destek alanı çizilir; kare kesilme ve başka kata sızma kaldırılır. Mobilyalara ve ayakta duran karakterlere zemine kırpılmış yumuşak temas gölgeleri eklendi.
- Duvar ve zemin nesneleri aynı çizim/ters sürükleme sözleşmesini kullanır. Yatay pano hareketi artık sıra atlatmaz.

Referanstaki iki kat, sabit perspektif, merdiven, üst çalışma masaları ve alt toplantı/kahve/dinlenme alanları korunur. Bu teslim yeni bir 3D sahne veya referansın birebir kopyası iddiası değildir; mevcut düzenlenebilir sahnenin belirtilen grafik hatalarını giderir.

## Doğrulama

- Yeni zemin, halı, malzeme, adım ve ters sürükleme kontrolleri; mevcut kalıcı görünüm/yerleşim testleri: **17/17**.
- Gerçek Chromium/anonim Buyer Log: **72 poz × 8 değişiklik = 576** kıyafet varyasyonu kaynak siluetini korur. Canlı ön izleme, görünüm kaydet/yeniden aç, mobilya kaydet/yeniden aç ve geri al geçti.
- Üç masa stili; 1×/1,3× ve iki yön: klavye/el teması ve kaynak oranları doğrulandı.
- 1920×1080, 1440×900, 1366×768: sahne 16:9, yatay taşma yok, alt kontroller görünür. Açık/koyu tema sahne piksellerini değiştirmez.
- Dört atmosfer, lamba kapatma, manuel seçimi yeniden açma ve azaltılmış hareket geçti. Boşta AI isteği, ofis JS hatası veya bozuk ofis görsel/API bağlantısı görülmedi.
- Gerçek dekoratif dolaşım dört yönü kullandı; dolu hücreler ayrık, önbellek sınırları korundu. Dört kişilik görev durum fikstürü ayrı toplantı koltuklarına ulaştı; sonuç gerçek LCW AI işinin tamamlandığı anlamına gelmez.
- Canonical test runner'ın **913 dosyası** kapsandı. İlk `npm test`, Batch 7'de OneDrive üç tohum simülasyonunun 15 saniyelik zaman aşımıyla durdu. Aynı dosya tek başına **12 başarılı, 1 isteğe bağlı atlama**, 9,6 saniye ile geçti; hiç koşmamış Batch 8 ayrıca **609/609** geçti. Son kapsama **6.518 başarılı kontrol, 66 mevcut platform/isteğe bağlı atlama**; ilk zaman aşımı gizlenmedi, testler/sınırlar değiştirilmedi.
- TR/EN görsel sürüm notları: **66 kayıt**, PNG doğrulaması başarılı. Canonical sürüm **7.0.271** değişmedi.

## Performans ve sınırlar

Başsız Chromium, Linux, Canvas 2D; 30 saniye ısınma ardından 15 saniyelik gerçek dekoratif dolaşım: ortalama çizim **0,97 ms**, ana iş parçacığı görev zamanı **%14,7**, JS heap **16,2 MiB**, ışık/görünüm önbelleği **3,37 MiB**. Ölçümde 266 kare, 46 karakter sprite'ı ve 36 kaynak malzeme girdisi vardı. Kaynak maskeleri ve renklendirme önbelleğe alınır; her kare piksel taraması yapılmaz.

Bu değerler desteklenen bütün masaüstü donanımlarında FPS/GPU garantisi değildir. Windows/Edge kontrolleri bu Linux oturumunda atlandı; gerçek LCW AI oturumu ve donanım GPU profili bu grafik değişikliği kapsamında ölçülmedi. Yeni TEST/STABLE yayını yapılmadı.

Güncel gerçek arayüz görüntüleri `resources/app/public/release-notes/next-assets/agent-office-graphics-*.png` altındadır; şirket verisi yerine anonim demo kullanılır.
