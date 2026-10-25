# Logo ve genel kültür görselleri düzeltmesi

Kullanıcının HTML incelemesi iki gerçek CSS regresyonunu buldu: `brandMarkImage`
opacity:0 ile gizlenmiş, boot içindeki trivia figure/visual display:none olmuştu.
Orijinal paketli logo geri gösterilir, metin taklidi kaldırılır. Yerel kategori
SVG çizimleri iki sütunlu düzenle döner; dar ekranda tek sütun, dekoratif animasyon
ve emoji kapalı kalır. Görseller yüklenememe veya dış bağlantı hatası değildi.

`runtime-check.json`: 3 tema × 4 boyut × 2 viewport = 24 kombinasyon,
her birinde gerçek logo ve açılış PNG'si (48 dosya). Logo decode/opacity/boyut,
SVG görünürlüğü, reduced-motion ve belge taşması kontrol edildi. Açık standart
ve koyu XL/1280 açılış, açık/koyu logo PNG'leri tam boyutta incelendi.
Önceki galeri geçmiş sürümün kanıtıdır; güncel odaklı galeri `inceleme.html`.

İlgili 32 guard testi ve 78 kayıtlı release-note doğrulaması başarılı.
Son tam test başarılı: 7.529 geçen, 0 başarısız, 65 mevcut atlama; `checks.json`. Üretim kodunda sonrasında
başka değişiklik yapılmadı. PR/CI/merge/TEST/STABLE tetiklenmedi.
