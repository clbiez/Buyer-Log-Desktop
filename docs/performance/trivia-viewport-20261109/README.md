# Genel kültür alanı / Continue erişimi

**Karar: PASS — P2 yerel arayüz düzeltmesi.**

Taban Main: `62f2153d258374e98f5582994042119c6b6cc495`.
Son ürün kaynak commit'i: `a04831d1` (tam SHA ve iki dosyanın SHA-256 özetleri
[samples.json](samples.json) içinde). Ardından yalnız kabul betiğine 320 px
kontrolü ve bu kanıtlar eklendi; ürün kaynaklarının özetleri tekrar doğrulandı.
Önceden kaydedilen [bütçeler](budgets.md) değiştirilmedi.

## Sorun ve kabul

Gerçek Buyer Log, izole demo sunucusu, boş iş verisi ve yerleşik genel kültür
arşivi kullanıldı. Yükleme durumu gerçek `BLTrivia` gözlemcisiyle karta, sonra
hazır katmanına dönüştürüldü. Başlangıç perdesi normal giriş/hazır olma kapılarıyla
geçildi. Test, ürünün zamanlayıcılarını Playwright saatiyle ilerletir; CPU/layout
CDP ölçümleri gerçek çalışma süreleridir, bekleme süreleri performans kazancı
olarak sunulmaz. Aynı yerel sunucu, aynı Chromium ve aynı varlık yönlendirme yolu
kullanıldı. Veri boyutu bu düzeltmenin maliyetini belirlemez: veri motoru, tablo
satırları ve hesaplama yolları değiştirilmedi.

Tabanda 430 px modülün Continue düğmesi katmanın dışında kaldı ve merkezinde hit
test başarısız oldu. İçerik yüksekliği sıfıra düşünce katman tamamen gizlendi.
Yeni unit test önce bu nedenle başarısız, değişiklikten sonra başarılı oldu.
Son sürümde içerik yüksekliği sıfırken bile katman pencerenin kalanına uzanır.

İlk taramada 432 kontrol geçti. Son kabul betiğiyle CP, Siparişler ve Koleksiyon;
TR/EN × açık/koyu × dört arayüz boyutu × dört pencere boyutu = **192 kontrol**
geçti. 320×568 kontrolü uygulamanın mevcut daraltılmış menüsüyle yapıldı.
Her durumda Continue tamamen görünür ve hit-test edilebilir; içerik kaydırıldıktan
sonra da erişilebilir, yatay taşma yok, okuma alanı sıfırdan büyük. Klavyeyle
Enter, gizli sekme ve geri dönüş kontrol edildi. Beş aç/kapat döngüsünün her
birinde `_holds.size === 0`; aynı kart tekrar kullanılabiliyor.

Gerçek değişiklik sonrası PNG:
[960×480 CP Tracker](../../../resources/app/public/release-notes/next-assets/trivia-continue-viewport.png).

## Performans kanıtı

Linux, Node 24.19.0, Chromium 151.0.7922.173; seri çalışma kilidi
`/tmp/buyerlog-performance-measurement.lock`. Üç A/A taban tekrarı, ardından
üç dönüşümlü Main/aday çifti. Tüm ham örnekler, GC sonrası heap/DOM/listener
sayıları, uzun görevler ve varlık özetleri [samples.json](samples.json) içindedir.
Üç gözlemden p95 çıkarılmadı.

| Ölçüm (medyan) | Main | Aday |
| --- | ---: | ---: |
| Giriş niyeti → hazır Continue, ms | 2146.02 | 2096.33 |
| Ürünün `startupGateReadyMs` ölçümü, ms | 1461 | 1418 |
| İlk yükleme → hazır kart → kapatma, toplam ana iş parçacığı CPU, ms | 71.669 | 79.196 |
| Tekrar döngüsü toplam ana iş parçacığı CPU, ms | 31.358 | 29.480 |
| İlk döngü layout, ms | 6.544 | 7.256 |
| Tekrar layout, ms | 2.036 | 2.412 |
| İlk Continue aktivasyonu → katmanın kaldırılması, ms | 10.893 | 8.149 |
| Tekrar Continue aktivasyonu → kaldırılması, ms | 8.432 | 6.094 |

Tabanda görünmeyen düğmenin süre karşılaştırması programatik aktivasyonla
alındı; kullanıcı erişimi iyileşmesi hit testlerle ayrıca doğrulandı. Adayda
ölçülen en yavaş Continue 51.75 ms: önceden belirlenen 200 ms sınırının altında.
Yeni >50 ms uzun görev gözlenmedi.

İlk CPU/layout farkları ve küçük tekrar-layout farkı için A/A kontrolü yapıldı:
A/A ilk CPU 75.092–130.855 ms, ilk layout 7.329–13.846 ms; tekrar-layout koşu
medyanları 2.459, 2.594, 2.106 ms idi. Adayın küçük farkları bu ölçülmüş
koşular arası değişim içinde kaldı; genel bir yüzde toleransı uygulanmadı.
Tekrar CPU ve etkileşim medyanları gerilemedi; genel hızlanma iddiası yok.

GC sonrası heap örnekleri 15.8–16.25 MB aralığında; adayın beş döngüsünde sürekli
artan retained DOM/listener serisi görülmedi. Aynı uygulama arka plan göstergeleri
Main'de de küçük geçici dalgalanmalar üretiyor. Bu heap ölçümü tepe RSS olarak
sunulmaz. Düzeltme yeni allocation sahibi, ağ isteği, observer, listener veya
timer eklemez: JS değişikliği yalnız mevcut position hesabındaki alt sınırdır.

Sunucu, worker, tablo/veri kopyalama, native/preload ve Electron sekme yolları
N/A: bu dosya/çağrı zincirleri değişmedi. Chromium kanıtı Windows/Electron ölçümü
olarak sunulmaz. Lazy yükleme, dil çiftleri ve mevcut reduced-motion/kapanış
akışı korundu; bağımsız hareket motoru eklenmedi.

## Yeniden çalıştırma

`resources/app` içinden (Playwright ve Chromium bulunan ortamda):

```sh
BUYER_LOG_TRIVIA_BASE_REF=62f2153d258374e98f5582994042119c6b6cc495 \
BUYER_LOG_TRIVIA_VARIANTS=base,base,base,base,candidate,base,candidate,base,candidate \
BUYER_LOG_TRIVIA_ARTIFACTS=/workspace/work/trivia-viewport-verification \
flock /tmp/buyerlog-performance-measurement.lock \
node scripts/trivia-viewport-ui-acceptance.js
```

Hedefli Node testleri: **93 PASS, 0 FAIL**. i18n, agent sözleşmesi, görsel sürüm
notları, startup/trivia, Manifest ve token kontrolleri dahil. Sürüm notu
validator: **6 kayıt PASS**. Yeni regresyon testi PR hızlı kontrolüne eklendi.
Tam regresyon / TEST / STABLE bu P2 arayüz değişikliği için tetiklenmedi.
Main branch protection API'de `protected: false`; PR CI sonucunu ayrıca beklemek
zorunludur, otomatik dal koruması olduğu iddia edilmez.
