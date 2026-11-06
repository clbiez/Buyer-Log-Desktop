# Faz 3 — birincil ekran ve açılış perdesi (P2)

Kimlik/yetki, ilk veri ve açılan ekran hazır olduğunda Continue kullanılabilir.
CP, Orders ve Koleksiyon hazırlığı bu kapının koşulu değildir. Hazırlık gerçek
perde kaldırma olayından ve iki çizim karesinden sonra başlar. Ardışık işler,
son açma niyeti ve kullanıcıya özgü yerel son kullanım kaydıyla seçilir; kaynak,
yetki ve bellek sınırlamaları korunur. Gizli tablolar çizilmez.

Yetkili modüllerin menüsünde Bekliyor/Yükleniyor/Hazır/Hata durumu TR/EN görünür.
CP/Orders yükleme hataları Retry sunar; betik timeout kilidi Reload gerektirir.
Motion+ ve reduced-motion yolu korunur. Başlangıç ekranının mevcut yetkili hata
fallback'i korunmuştur; arka plan tamamlanması kimlik veya veri kapısını aşamaz.

`primaryScreenReadyMs`, `startupGateReadyMs`, gerçek perde kaldırma ve sistem
tamamlanma zamanı ayrıdır. Kullanıcının Continue öncesi beklemesi sistem süresinden
çıkarılır; kuyruğa takılan giriş, yakalama ve Motion süresi sistemde kalır.
`firstUsableInteractionMs` gerçek perde kaldırmada kaydedilir. Bu olay, sonraki
hesaplamaların kesintisiz akıcı olduğunu tek başına kanıtlamaz.

## Ölçüm düzeni ve kanıt

Yalnız sentetik 30.000 sipariş, seed 7; Faz 0 ile aynı Excel dosyaları kullanıldı.
Dosyaların arşivi ve SHA değerleri `fixtures/source-30000-seed7-20261105.*`
dosyalarındadır. Linux, 4 vCPU kotası, headless Chromium; Windows/Electron sonucu
değildir. Her modül sayfası sonraki ölçümden önce kapatılır. Long-task penceresi
ilk 10 saniyedir; pencereyi aşan kısımlar kırpılır. Heap ölçümü GC zorlanmadan
alınır. `/api/health` 404 döndürür; bunun RTT'si başarılı sağlık kontrolü gibi
sunulmaz. Başarılı `/api/status` gecikmesi ayrıca raporlanır.

Sunucunun mevcut inspector stall profilleyicisi iki kolda da açıktır. Üçüncü
baz ilk-niyet koşusunun profilinde `inspector.post` için `65722 ms` self örnek
kaydedildi. [Muhtemel] Tanılama yükü de süreleri etkileyebilir; profiler kapalı
A/B yapılmadığı için etkinin büyüklüğü [Bilinmiyor]. Profil örneği tek başına
aynı uzunlukta saf uygulama hesap süresi olarak yorumlanmaz. Ham profiller de
güncel kanıt paketinde saklanır.

İlk izole seri, Faz 2 üzerinde tamamlandı ve ayrı
`phase-3-isolated-artifacts/` klasöründe saklandı. Ana dala daha sonra gelen
Ex-factory ve LCW AI değişiklikleri korunarak entegre edildi. Güncel karşılaştırma
yeniden, aynı ana dal üzerinde üçer önce/sonra koşuyla yapıldı; iki seri birbirine
karıştırılmadı. Güncel ham JSON, log, sunucu stall kayıtları ve özet
`phase-3-current-artifacts/` altındadır.

Faz 0'ın `sameTab` senaryosu ön hazırlık bitişini bekler; ilk giriş değildir.
Ek `benchmark-first-transitions.js`, her CP/Orders denemesinde yeni tarayıcı
bağlamında Overview açar ve gerçek Continue tamamlanır tamamlanmaz hedefe niyet
gönderir. Giriş kuyruğu, veri hazır olma, görünür satır çizimi ve otomatik
sıfır-insan-beklemeli modül Continue süresi ölçülür. Sabit bir saniyelik gözlem
penceresi gecikme metriğine eklenmez; pencere içinde engel yeniden çıkarsa
etkileşime dönüş zamanı ayrıca uzar. Önce/sonra aynı karşılık gelen cache kopyasını
kullanır. Satır, erişim, tüm projection response generation'ları, revizyon ve
disk manifest kimliği zorunludur. Metadata-only başlangıç cevabının generation
alanının null olması gerçek projection kimlik denetimini kaldırmaz.
`startedWithRows`, ilk niyetten önce modül verisinin zaten hazırlanmış olup
olmadığını kaydeder; baz sürümün perde altında yaptığı hazırlık bu alanda görünür.

## Güncel ana dalda sonuçlar

Üç tam Faz 0 koşusunun medyanları; önce `82c6cf38`, sonra `6525e625`.
Satır/generation/revizyon/cache kontrollerinin tamamı başarılıdır.

| Modül | Primary hazır sn | Gate hazır sn | Sistem complete sn | Eşleşmiş primary → gate ms |
| --- | ---: | ---: | ---: | ---: |
| Overview | 4.778 → 4.660 | 40.472 → 4.683 | 156.481 → 4.765 | 35,694.0 → 21.6 |
| Koleksiyon | 10.936 → 17.978 | 33.952 → 17.991 | 34.017 → 18.067 | 22,722.4 → 17.3 |
| CP | 6.527 → 59.644 | 63.676 → 59.665 | 200.655 → 59.876 | 57,687.2 → 21.0 |
| Orders | 9.778 → 6.687 | 40.649 → 6.710 | 41.043 → 6.832 | 29,133.0 → 21.1 |

[Doğrulandı] Birincil hazır ile gate farkı sonrasında yaklaşık sıfırdır.
Eşleşmiş fark medyanı, ayrı primary/gate medyanlarının farkı değildir.
Koleksiyon birincil hazır medyanı ve tüm aynı-sekme medyanları kötüleşti:
CP **15.893 → 46.168 sn**, Orders **2.195 → 3.524 sn**, Koleksiyon
**0.123 → 0.164 sn**. Bu fazın tüm istemci işlemlerini hızlandırdığı iddia edilmez.
[Bilinmiyor] Bu geniş varyanslı tekrarların nedenleri bu seriyle izole edilmedi.

Refresh medyanı **42.664 → 46.636 sn**; bu istemci fazında bir sunucu refresh
kazanımı ölçülmedi. Başarılı `/api/status` refresh p95 medyanı
**24.69 → 37.17 ms**. `/api/health` 404 RTT p95 medyanı **1,017.43 → 893.02 ms**;
ikinci değer yalnız başarısız HTTP round-trip ölçümüdür. Faz 0 başlangıç refresh
bazı 53.231 sn idi; sonradan ana dala gelen iş kuralı değişiklikleri nedeniyle
faz katkıları bu tarihsel değer üzerinden tek tek toplanmaz.

İlk niyet senaryosunda üç CP baz örneği doğrulandı. Orders bazında iki örnek
başarılı, üçüncü örnek 900 saniyede timeout oldu (`actualRows:null`, sıfır görünür
satır). Bu koşuda pageerror, yanlış satır/generation/revizyon/yetki sonucu
gözlenmedi; Orders hazır olmadığı için o sonuç eşdeğerlik başarısı sayılmadı.
[Bilinmiyor] Baz timeout'un kök nedeni bu kanıtla ayrıştırılamadı. Başarısız
JSON/log ve profiller saklandı; aynı baz denemesi kanıtsız tekrarlanmadı.
Adayın üç ilk-niyet çalıştırmasının tamamında CP ve Orders veri kimliği geçti.

| İlk niyet | Niyetten görünür/etkileşilebilir satıra sn | Sayfa başlangıcından satıra sistem sn |
| --- | ---: | ---: |
| CP | 4.769 → 76.695 | 180.787 → 81.538 |
| Orders | 19.863 / 38.055 / >900 timeout → 23.751 medyan | 163.786 / 251.459 / >1006 timeout → 28.589 medyan |

CP bazında ilk niyet geldiğinde 24.982 satır zaten bellektedir; adayda üç
örnekte de başlangıçta CP satırı yoktur. [Doğrulandı] CP'nin ilk tıklama beklemesi
arttı, sayfa açılışından görünür CP satırına medyan süre azaldı. Orders bazına
üç başarılı sayısal örnek varmış gibi bir medyan atanmaz. Sağdan sansürlü
dağılımın tanımlanabilen medyanı 38.055 sn'dir (üçüncü değer >900 sn olduğu için
ortanca bilinir); özette `median:null` ve ayrı `identifiableCensoredMedian`
alanlarıyla bu ayrım korunur. Başarılı iki örneğin alt küme medyanı genel baz
medyanı olarak sunulmaz. Tüm örnekler ve geniş aralıklar ham pakette bulunur.

Görünür CP'nin birincil hazır tanımı artık sayfa profili ve zorunlu ortak öncelik
motorunun görünür sonucu hazır olmasını kapsar. Eski veri-yüklendi işaretiyle ham
CP primary süreleri aynı semantik değildir; perde ve ilk geçiş sonuçları birlikte
değerlendirilmelidir.

## Doğrulama

RED → GREEN: birincil kapı ve 120 sinyal sıralaması, zorunlu kapı eksiklikleri,
insan beklemesi/giriş kuyruğu/Motion saati, kullanıcıya özgü yerel geçmiş,
niyet önceliği, başarısız CP işinin hazır yayınlayamaması ve hata Retry akışı.
Mevcut Manifest testi stil sahipliği ihlalini yakaladı; görünüm tokenları ortak
`ui-components.css` katmanına taşındı. Test veya i18n baseline gevşetilmedi.

Ana dal entegrasyonu sonrası ilgili `npm test -- startup snapshot-startup
user-prefs-sync first-transition ui-manifest-contract ui-inline-contract
loading-approval-exfactory cp-background-personal-decisions boot-thinking-orb
current-ui-regressions lcwai-data-query lcwai-chat-data-query
lcwai-chat-retry-context`: 40 dosya, 262 alt test başarılı.
`npm run i18n:check`: 0 eksik, baseline 0.
`npm run release:notes:validate`: 22 kayıt başarılı.

20 sentetik siparişle gerçek tarayıcı kabulü: TR/açık başlangıç, EN/koyu Orders,
font +4 ile menü metin çakışması, CP ve Orders için 500 → Retry → Ready.
Başlangıç PNG'si `public/release-notes/next-assets/startup-primary-ready.png`;
EN/koyu ve hata PNG'leri güncel kanıt paketindedir. Görseller incelendi.

## Karar ve sınırlar

Ürün kararı gereği sonraki modülün hazırlık beklemesi ilk girişe taşınabilir.
Ölçümde kötüleşen sonuçlar da raporlanır. Bu faz payload azaltma, genel istemci
hesap optimizasyonu veya sunucu worker havuzu değildir; bunlar sonraki sıralı
fazların kapsamıdır. TEST ve STABLE yayını yapılmadı.
