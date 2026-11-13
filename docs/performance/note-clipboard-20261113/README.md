# Not kopyalama/yapıştırma kabulü

- Risk: P2; mevcut yetki, revizyonlu toplu kayıt ve geri alma yolları kullanılır.
- Kademe: L1, PASS. Değişiklik kullanıcı tarafından başlatılan yerel not
  yapıştırma eylemindedir; başlangıç, tablo render, polling veya sync altyapısı
  değişmez. Orders, CP kaydını yalnız ilk not yapıştırma niyetinde gerekirse yükler.
- Taban: `b54f62fccffa7af95549a1fbf8315756b325fe5d`.
- Ortam: Linux, Node 24.19.0, headless Chromium 154.0.8037.57, aynı makine.
- Senaryo: iki boş başlangıç paragrafı, tek satır kalın metin, bir boş bitiş
  paragrafı içeren HTML'yi boş not editörüne yapıştırma. Her kaynak için bir koşu.
- Main → aday: senkron yapıştırma ve layout 13,8 → 8,1 ms; sonraki görünür kare
  18,6 → 10,2 ms. Gerileme gözlenmedi. Tek örnek genel hızlanma/p95 iddiası değildir.
- Çıktı: Main fazladan satırları saklıyor; aday yalnız metni ve kalın biçimi
  saklıyor. Ham metin, HTML ve süreler `results.json` içindedir.
- Ağ isteği yok; testin sonunda sayfalar ve tarayıcı kapatılır.

Yeniden çalıştırma (Playwright ve Chromium kurulu olmalı):

```sh
PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_PATH=/usr/bin/chromium \
  node docs/performance/note-clipboard-20261113/measure.cjs
```

Gerçek uygulamada izole demo verisiyle ayrıca doğrulanan davranışlar:

- Not pencereleri arasında yerel Ctrl+C/Ctrl+V; metin ve kalın biçim korunur.
- Başlangıç/bitiş boş paragrafları ve NBSP dolgusu temizlenir; içerideki HTML
  satır araları değişmez.
- CP not hücresi başka satıra yapıştırılır, sunucu kaydı okunarak doğrulanır;
  tek geri alma hedefi eski haline döndürür.
- Orders Ek Not hücresine yapıştırılır, sunucu kaydı doğrulanır. CP istemci
  verisi boşaltılarak ilk kullanımda lazy yükleme yolu da çalıştırılır.
- Koleksiyon'da iki modelin not hücreleri arasında yerel Ctrl+C/Ctrl+V çalışır.

Bu ölçüm Chromium web arayüzünü doğrular; Windows/Electron native kabuğunda
ölçüm yapılmadı. Test ve sürüm notu dosyaları için performans N/A: üretim işi eklemezler.
