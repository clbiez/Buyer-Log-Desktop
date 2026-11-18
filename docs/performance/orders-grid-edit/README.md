# Orders hücre düzenleme · L2 performans kabulü

## Ölçüm sözleşmesi

Orders açılışı, filtreleme ve sanal pencere çizimi sıcak yol olduğu için L2 seçildi. Taban güncel `main` (`af8725bcc24d992f147a4daddfd0c5c79be51ccf`). Eşikler uygulamadan önce kaydedildi. Açılış, tekrar açılış, kaydırma, filtre, en uzun ve toplam ana iş parçacığı görevi, aynı yolun API istekleri ve yanıt baytları için Main tabanı geçerli. Tekrarlanabilir gerileme için tolerans uygulanmadı. İlk düzenleme niyetinin geri bildirim hedefi 200 ms ve en fazla bir CP projeksiyon isteği. Orders açılışı, kaydırma ve filtre CP istememeli.

- Aynı Linux ortamı, Node 24 ve Chromium 151. 1600×820 viewport, azaltılmış hareket, her koşuda yeni tarayıcı süreci. Aynı iki demo Excel dosyası iki izole HTTP sunucusunda işlendi. Senaryolar 1.200 ve 30.000 Orders satırı içerir. Kaydırma için uygulamadaki **Tümü** aralığı kullanıldı.
- Zamanlar milisaniye. İlk açılış navigasyondan etkileşim kurulabilen tablo boyasına kadar. Kaydırma altı konum, filtre üç tek sipariş kodu. Etkileşim ölçümü sonraki animasyon karesine kadar. Arama gecikmesi filtre zamanına dahil. Uygulamanın mevcut boşta modül hazırlığı iki tarafta da ölçümden çıkarıldı. Gerçek kabul betiği normal hazırlıkla çalıştı.
- Soğuk senaryo CP açılmadan, hazır senaryo CP belleğe alındıktan sonra koşuldu. Hazır senaryoda ayrıca beş CP → Orders dönüşü ve çöp toplama sonrası kalan DOM, dinleyici ve JS heap değerleri kaydedildi. Otomatik veri yenileme, uzak IAM ve yayın kapalıydı. Windows, Electron yerel katmanı, SMB ve üretim uç noktaları kapsama girmedi.
- Delete, Ctrl+D ve yapıştırma için işlem süresi bütçesi belirlenmedi. Bunlar açık kullanıcı komutları, mevcut önizleme ve kayıt akışından geçiyor. Kişisel not yazımı yerel ve yalnız seçilen hücreleri işler. Gerçek kabul betiği tuşları, önizlemeyi, geri alma ve sunucudan geri okumayı denetler.
- İlk adayda hazır kaydırma medyanı 1.200 satırda 337,7 → 402,2 ms ve 30.000 satırda 345,2 → 375,8 ms ölçüldü. Görünür pencerenin metin girişleri düzenleme niyetine taşındı. İzin ve değer, satır başına mevcut kanonik CP indeksinden okunur. Görünür pencerede çalışan gerçek CP editörü odak kaybında kaldırılır.

## Karar · FAIL

1.200 satırda CP yüklüyken kaydırma üç çiftin tamamında yavaşladı. Medyan 334,0 ms’den 389,0 ms’ye çıktı. 30.000 satırda hazır kaydırma medyanı 323,2 ms’den 365,3 ms’ye, hazır sekmeye dönüş 385,4 ms’den 445,7 ms’ye çıktı. Ana iş parçacığında bu yolların 50 ms üstü görevleri Main’de de vardı. Hazır kaydırma ve filtre toplam uzun görev medyanı 1.200 satırda 1.903 → 2.162 ms ve 30.000 satırda 2.289 → 2.601 ms. Son seride iki tarafta da hazır örneklerden önce seçim ve odak temizlendi.

Her boyutta sıra A→B, B→A, A→B. Satırlar **medyan (çift sırasıyla ham koşu değerleri)** biçiminde. Kaydırma, filtre ve sekmeye dönüş için bir koşunun değeri kendi etkileşimlerinin medyanıdır. Ham veri her etkileşimin süresini, uzun görevleri, kaynak ve fixture SHA-256 özetlerini ve istekleri içerir. `runtime` özetleri teslim edilen uygulama kaynaklarıyla eşleşir. [Ham ölçümler](samples.json)

### 1.200 satır

| Metrik | Main | Aday |
| --- | ---: | ---: |
| İlk açılış ve boyama | 3780,5 (4608,9 · 3780,5 · 3767,1) | 3444,1 (3862,1 · 3444,1 · 3207,6) |
| İlk ekran hazır olayı | 2796,7 (3452,5 · 2796,7 · 2681,8) | 2477,1 (2855,5 · 2477,1 · 2291,7) |
| Hazır sekmeye dönüş | 308,9 (329,3 · 308,9 · 294,8) | 319,7 (319,7 · 309,6 · 331,0) |
| Soğuk kaydırma | 375,6 (380,8 · 367,0 · 375,6) | 352,2 (352,2 · 343,4 · 371,8) |
| Hazır kaydırma | 334,0 (311,6 · 334,8 · 334,0) | 389,0 (432,8 · 389,0 · 359,3) |
| Soğuk filtre | 203,0 (203,0 · 207,2 · 201,9) | 212,0 (212,0 · 213,4 · 204,7) |
| Hazır filtre | 217,4 (204,7 · 217,4 · 217,8) | 209,9 (208,9 · 209,9 · 213,6) |
| İlk açılışta en uzun görev | 301,0 (342,0 · 301,0 · 283,0) | 258,0 (258,0 · 317,0 · 244,0) |
| İlk açılışta toplam uzun görev | 2070,0 (2447,0 · 2006,0 · 2070,0) | 1963,0 (2052,0 · 1963,0 · 1793,0) |
| Soğuk kaydırma ve filtrede en uzun görev | 319,0 (334,0 · 268,0 · 319,0) | 301,0 (301,0 · 328,0 · 282,0) |
| Soğuk kaydırma ve filtrede toplam uzun görev | 2081,0 (2279,9 · 1993,0 · 2081,0) | 2066,0 (2066,0 · 1992,0 · 2112,9) |
| Hazır kaydırma ve filtrede en uzun görev | 244,0 (309,0 · 240,0 · 244,0) | 297,0 (383,0 · 297,0 · 281,0) |
| Hazır kaydırma ve filtrede toplam uzun görev | 1903,0 (1909,0 · 1903,0 · 1891,0) | 2162,0 (2514,0 · 2162,0 · 2108,0) |
| Düzenleme geri bildirimi | — | 57,0 (57,0 · 49,4 · 66,5) |
| İlk editör açılana kadar | — | 684,4 (689,3 · 650,4 · 684,4) |


### 30.000 satır

| Metrik | Main | Aday |
| --- | ---: | ---: |
| İlk açılış ve boyama | 7058,0 (6578,5 · 7058,0 · 7831,8) | 7509,4 (7509,4 · 7379,1 · 7811,7) |
| İlk ekran hazır olayı | 5272,6 (4953,4 · 5272,6 · 6136,6) | 5845,4 (6028,7 · 5745,3 · 5845,4) |
| Hazır sekmeye dönüş | 385,4 (368,7 · 385,4 · 448,5) | 445,7 (445,7 · 463,3 · 440,5) |
| Soğuk kaydırma | 453,5 (420,8 · 519,0 · 453,5) | 403,4 (429,6 · 403,4 · 400,1) |
| Hazır kaydırma | 323,2 (445,2 · 316,2 · 323,2) | 365,3 (363,5 · 376,9 · 365,3) |
| Soğuk filtre | 315,1 (315,1 · 310,6 · 334,3) | 306,8 (303,1 · 306,8 · 336,8) |
| Hazır filtre | 335,3 (320,2 · 338,2 · 335,3) | 327,9 (334,4 · 314,7 · 327,9) |
| İlk açılışta en uzun görev | 2337,0 (2032,0 · 2337,0 · 2618,0) | 1743,0 (1453,0 · 1743,0 · 2532,0) |
| İlk açılışta toplam uzun görev | 5194,0 (4772,0 · 5194,0 · 5548,0) | 5381,0 (5330,0 · 5381,0 · 5701,0) |
| Soğuk kaydırma ve filtrede en uzun görev | 376,0 (359,0 · 376,0 · 472,0) | 405,0 (371,0 · 405,0 · 616,0) |
| Soğuk kaydırma ve filtrede toplam uzun görev | 3070,0 (2661,0 · 3184,0 · 3070,0) | 2753,0 (2736,0 · 2753,0 · 3164,0) |
| Hazır kaydırma ve filtrede en uzun görev | 238,0 (379,0 · 238,0 · 226,0) | 299,0 (365,0 · 276,0 · 299,0) |
| Hazır kaydırma ve filtrede toplam uzun görev | 2289,0 (3067,0 · 2253,0 · 2289,0) | 2601,0 (2624,0 · 2601,0 · 2536,0) |
| Düzenleme geri bildirimi | — | 56,6 (62,7 · 41,7 · 56,6) |
| İlk editör açılana kadar | — | 4063,5 (4063,5 · 3795,5 · 4180,7) |

## İstek ve bellek

- Orders ilk açılış, kaydırma ve filtre sırasında CP projeksiyon isteği her koşuda 0. İlk düzenleme ile adayın her koşusunda 1 CP projeksiyon isteği görüldü. İlk geri bildirim bütün örneklerde 200 ms altında.
- 1.200 satır soğuk API istek sayısı Main **43 · 42 · 42**, aday **42 · 41 · 41**. Yanıt baytları Main **274503 · 288872 · 288985**, aday **271787 · 286689 · 286836**.
- 30.000 satır soğuk API istek sayısı Main **49 · 48 · 49**, aday **48 · 47 · 47**. Yanıt baytları Main **6000905 · 6011229 · 6016871**, aday **5932897 · 5943689 · 5944411**.
- İlk boyada her koşuda 46 satır ve 2.485 tablo hücresi vardı. Son sekme dönüşünde 30.000 satır için GC sonrası JS heap Main’de **136,32 · 136,53 · 136,53 MiB**, adayda **140,10 · 140,42 · 140,45 MiB**. Yeni düzenleme yolu mevcut satır indeksi ve görünür editör tetikleyicilerini hazır durumda tutuyor. Beş dönüşte dinleyici sayısı ilk dönüşten sonra sabit kaldı ve DOM sayısı sürekli büyümedi. Bu ölçümler GC sonrası renderer örnekleridir.

## Yeniden çalıştırma

Main ve aday checkout’larında uygulama bağımlılıklarını kurun. `PLAYWRIGHT_MODULE` ve `CHROMIUM_PATH` yerel kurulumdan okunabilir. Çıktı JSON’unda çalışma sırası, kaynak ve fixture SHA-256 özetleri, her etkileşimin zaman damgası ve uzun görevler bulunur.

```sh
flock /tmp/buyerlog-performance-measurement.lock \
  node docs/performance/orders-grid-edit/measure.cjs \
  "$MAIN_CHECKOUT" "$CANDIDATE_CHECKOUT" "$MEASUREMENT_JSON"
```
