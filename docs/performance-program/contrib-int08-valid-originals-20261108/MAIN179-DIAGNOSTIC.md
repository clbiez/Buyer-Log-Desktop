# INT-08 — Main179 üzerinde geçerli sentetik orijinaller

Bu çalışma kabul edilmiş Main `1796193f0a57c7785e7bf9fdb3557e33c550b25e`
üzerindeki ayrı tanıdır. `resources/app` ağacı
`9a03e95b338a514bcb7a7ea323007bee81cefbf6` olarak donduruldu. #908 dalı
dahil edilmedi. Tarihsel README'nin #908 sonrası final kabul şartı korunur;
bu kanıt o kabulün yerine geçmez. Üretim preview uygulaması yapılmadı.

**Karar: bu iş yükünde INT-08'i atlama önerisi yok.** Üç çiftte de yaklaşık
459 MiB decoded image cache ve 1,4–1,6 sn ek decoder CPU maliyeti var.
Frame/long-task bulguları karışık; bir preview'in scroll kazancı henüz
ölçülmedi. 192 px yalnız sonraki kontrollü pilot için adaydır.

## Son seri: 12/12 koşu

Linux, Node v24.19.0, Chromium **154.0.8037.57**, cgroup **4 vCPU / 16 GiB**.
`cp-pairs-02` ve `orders-pairs-02` modül başına üç bağımsız dönüşümlü çifttir.
Son serinin bütün koşularında aynı probe SHA ve Main179 uygulama ağacı var.
Tablo değerleri medyandır. Bellek noktası ikinci scroll sonu; CPU penceresi
navigasyondan iki scroll sonuna kadar, hover/drawer hariçtir. CPU penceresinin
sınırını kesen eksik olay yoktur.

| Metrik | CP kontrol | CP original | Orders kontrol | Orders original |
| --- | ---: | ---: | ---: | ---: |
| Leaf decode thread CPU (ms) | 0,34 | 1.549,94 | 0,37 | 1.375,37 |
| `cc/image_memory` (MiB) | 0,078 | 459,45 | 0,078 | 459,46 |
| Renderer RSS toplamı (MiB) | 1.061,69 | 1.674,75 | 878,35 | 1.625,83 |
| V8 `backingStorageSize` (MiB) | 7,75 | 76,75 | 7,75 | 8,21 |

Eşleştirilmiş **original − kontrol** medyanı [min–max]:

| Metrik | CP | Orders |
| --- | ---: | ---: |
| Decode CPU (ms) | +1.549,53 [1.443,74; 1.748,21] | +1.375,03 [1.282,72; 1.498,37] |
| Decoded cache (MiB) | +459,38 [444,40; 459,40] | +459,39 [459,39; 459,39] |
| Renderer RSS (MiB) | +616,67 [371,88; 639,94] | +774,33 [691,48; 800,56] |

İlk görünür tablo noktasında original decoded cache medyanı CP **381,32 MiB**,
Orders **330,29 MiB**; drawer sonunda **463,21 / 463,23 MiB**. Allocator boyutu
RSS'e tekrar eklenmez. Mevcut warm cache'in 96 MiB sınırı encoded bayt
bütçesidir; decoded piksel belleği sınırı değildir.

**Toplam external açık:** dump'lar ayrı V8 external allocator sayacı sunmadı.
CDP `backingStorageSize` tüm external bellek değildir. Eşleştirilmiş farkı
CP'de −69,11…+69,13 MiB, Orders'ta +0,04…+58,80 MiB; GC zorlanmadı. Bu oynak
değer image external maliyeti veya retained heap diye kabul edilmez.

| Scroll metriği | CP kontrol → original | Orders kontrol → original |
| --- | ---: | ---: |
| İlk p95 frame (ms) | 33,4 → 33,4 | 16,8 → 33,4 |
| Tekrar p95 frame (ms) | 33,3 → 33,3 | 33,3 → 16,8 |
| İlk long-task / wall | %32,32 → %31,01 | %20,27 → %28,82 |
| Tekrar long-task / wall | %0 → %0 | %18,10 → %37,93 |

CP'de p95 için sistematik fark yok. Orders ilk/tekrar geçişleri farklı yönde;
tekrar long-task farkı −19,37…+21,56 yüzde puan. Scroll için genel hızlanma
oranı çıkarılmaz. Her original koşunun iki geçişinde de **32 ayrı original**
görünürlük örneklerinde görüldü; workload azaltılmadı.

İlk original **load** medyanı CP **8,482 sn**, Orders **3,361 sn** ve altı
koşunun hepsinde perde arkasındaydı. İlk gözlenen **görünür original** medyanı
CP **15,051 sn** [15,027–15,911], Orders **4,155 sn** [3,769–4,451]. Saat
navigasyon başlangıcıdır. Hazırlıkta daha önce oluşan canonical ref, UI zamanı
olarak kullanılmaz. Kontrolde original olmadığı için karşılığı sıfır değil,
uygulanamazdır.

[Tam analiz](analysis-main179/recomputed-analysis.json) ve
[eşleştirilmiş değerler](analysis-main179/paired-summary.json) ham izlerden
yeniden hesaplanabilir; `analyze.py` ve `summarize.py` komutları kaydedildi.

## Temsilci türevler: kalite / bellek / zaman

Altı temsilci (her boyut × codec sınıfından birer dosya), ingest-sonrası ayrı
tanısal alanda 96/192/384 maksimum kenara indirildi. Portrait boyutları
72×96 / 144×192 / 288×384; aynı JPEG92/PNG ayarları kullanıldı. Bütün türevler
verify+decode, boyut ve SHA kontrolünden geçti. Render-time canvas kullanılmadı.

| Seçenek | Altı dosya toplamı | Native decode medyanı* | Resize+encode medyanı** | Altı RGBA tahmini |
| --- | ---: | ---: | ---: | ---: |
| Original | 30.112.326 B | 57,75 ms | — | — |
| 96 px | 26.571 B | 3,10 ms | 7,15 ms | 0,158 MiB |
| 192 px | 95.287 B | 2,90 ms | 13,01 ms | 0,633 MiB |
| 384 px | 399.205 B | 3,40 ms | 44,68 ms | 2,531 MiB |

\* Her dosya için taze Chromium context'inde tek `Image.decode` gözlemi;
data URL ataması/parse dahil, transfer öncesi hazırlık hariç. Original aralığı
16,1–246,8 ms. Bu CP/Orders preview A/B veya thread CPU değildir; 192'nin
96'dan hızlı olduğu sonucu çıkarılmaz.

\** Decode edilmiş kaynak üstündeki işlem; ayrıca kaynak decode medyanı
39,04 ms. Kaynak her original için bir defa açılır. Disk yazımı/post-write
doğrulama timer'a dahil değildir. RGBA sayıları allocator ölçümü değildir.

[Pafta](quality-main179/quality-contact-sheet.png) görsel olarak incelendi:
96'da büyütülmüş ince örgü/dikiş çizgileri birleşiyor, cep/siluet kenarları
yumuşuyor; 192 ana form/renk/cep çizgisini korusa da ince doku/keskinlik
kaybı sürüyor; 384 bu sentetik referansa daha yakın. Pafta 96'yı 4×, 192'yi 2×
büyütür; gerçek tablo ekran görüntüsü değildir. Gerçek tasarım detayı, farklı
DPR, ICC/EXIF/alpha ve üretim dağılımı kabul edilmedi. PSNR ürün kararı olarak
kullanılmadı. **192 px yalnız pilot adayıdır; ürün standardı kabulü değildir.**

[Türev SHA/boyut/süreleri](quality-main179/representative-derivatives.json),
[native decoder gözlemleri](quality-main179/native-decode/native-decode.json).

## Küçük root patch / API önerisi — uygulanmadı

Mevcut tek depo ve canonical ref içinde, başarılı `saveCollectionImage`
ingest'inden sonra sınırlı arka plan işi hazır variant yayımlayabilir:

```text
existing image record.variants.table192v1 =
  {sourceSha256, encodedSha256, width, height, mimeType, storedName}
GET /api/collection-images/:id?variant=table192v1&v=<variant-sha>
getThumbnail(input, {purpose:'table', edge:192}) -> hazır variant / original
clipboard / prepareForExcel / preloadOriginal -> aynı original
```

Kökler mevcut `server/user-data.js:saveCollectionImage`, mevcut GET hattı,
`model-image-cache.js:getThumbnail/bind` ve `app-main.js:BLImageRuntime` tablo
warmup'ıdır. **Yalnız getThumbnail değişikliği yetmez:** original warmup sürerse
full decode belleği yeniden oluşur. Tablo bind ve tablo warmup aynı purpose
temsilcisini kullanmalı; canonical model/renk/ref, `data-src`, satır geometrisi,
hover/drawer original çözümü ve original byte/URL korunmalıdır. Yeni sistem
veya render sırasında canvas dönüşümü kurulmaz.

Bugünkü `model-image-cache.js:imageUrl()` query'leri kaldırıp original URL'ye
normalize eder. Variant URL'si mevcut canonical registry'ye original yerine
yazılmamalı; purpose-aware tablo çözümleyicisi variant/sürüm bilgisini koruyarak
bu normalizer'ın onu tekrar original'a düşürmesini önlemelidir.

Variant iş revizyonu/projection'ı değiştirmemeli; ayrı sürümlü URL ile
yayınlanmalıdır. Emekli yerinde optimize/replace yolu açılmamalı. Mevcut area
ve `collection-image-authority` denetimleri variant okumadan önce çalışmalı;
private no-store korunmalı. Pixel/encoded admission, sınırlı eşzamanlılık ve
türev disk bütçesi gerekir. 384 daha çok ayrıntı, encoded/piksel/encode maliyeti
getirir; 96 daha ucuz ama ayrıntı kaybı daha görünür. Ölçülmüş tablo preview
kazancı bu turda yoktur.

Üretim uygulaması ayrı görevdir: gerçek kalite incelemesi, variant A/B,
original SHA/işlev eşitliği ve #908 sonrası güncel Main kabulü gerekir. CP yolu
değişirse #916 iki kolda da korunarak üç first-CP-intent çifti ayrıca ölçülür;
buradaki doğrudan CP navigasyonu o kabul değildir.

## Girdi ve taşınabilirlik

- Hazırlık dalı fetch edildi ve SHA
  `d4565563bc21eabc06fdb66d6251475bed5078e8` doğrulandı. Portable manifest
  SHA-256: `529dc8c652eab19db8ac436fc3e1536d1c1e4e59c0c2d2446dda0190d016aa05`.
  On iki v2 dosyası kendi raw SHA değerleriyle doğrulandı; orijinal hazırlık
  dosyaları değiştirilmedi.
- Executable kopya: `scripts/prototypes/int08-valid-originals-20261108/diagnostic-main179/`.
  Repo, dependencies, source-cache, work-root, Chromium ve Playwright yolları
  açık CLI girdileridir. Tarihsel `/workspace` / `/tmp` yolları kullanılmadı.
- Kaynak tar SHA-256:
  `5913414603984b02b1c30b87f1f9231da3718ab797a007f4bd14067ec6cd5c70`.
  Üç XLSX kaynak hash'i doğrulandı. Değişmemiş Faz0 betiği tek başarılı refresh
  POST'uyla cache üretti. Kaynak 30.000, CP 24.982, Orders 30.000 satırdır;
  CP sayısı mevcut iş filtresinin sonucudur.
- Faz0'ın sonraki Chromium açılışı uzun Unix socket yolu nedeniyle başarısız
  oldu. Refresh tekrarlanmadı. Hazırlanan cache'in checksum/generation/kaynak
  revizyonu ve satırları sonraki probe'larda bağımsız doğrulandı. Faz0'ın tüm
  benchmark'ı geçtiği iddia edilmez. Ham raporun checkout HEAD alanı `d4565563`
  olarak korunur; gerçek uygulama kaynağını Main179 pinleri belirler.
- #916 ancestor `0c85445f1989cafbae4f104c13ddf5d8f0b84c6c` doğrulandı.
  Dört CP guard dosyası/testi bu referansla byte/hash eşitliğini korur.

## Geçerli görseller ve sabit iş yükü

32 ayrı seed7 desen/dikiş/doku görseli: 24 JPEG + 8 PNG. Boyutlar
768×1024 / 1536×2048 / 3072×4096; sınıf sayıları 11 / 11 / 10.
Pillow `verify()` ve gerçek `load()`; dosya boyutu, MIME, dimensions ve SHA
kontrolleri yapıldı. Toplam gerçek encoded boyut **100.905.030 bayt**;
en büyük dosya **18.553.201 bayt**. En büyük muhafazakâr JSON yükleme üst
sınırı **24.741.700 bayt**; gerçek native payload boyutları ayrıca kaydedilir.
50 MiB raw / 70 MiB nominal / 100 MiB etkin JSON sınırları değiştirilmedi.

676.331.520 baytlık toplam RGBA hesabı yalnız piksel tahminidir; decoded
bellek ölçümü değildir. Placeholder veya bozuk dosya maliyetsizlik kanıtı
olarak kullanılmadı. Görselsiz kol yalnız karşılaştırma kontrolüdür.

Her modülde üç taze, bağımsız çift: kontrol/orijinal, orijinal/kontrol,
kontrol/orijinal. Her koşuda 180 frame × iki ileri/geri scroll geçişi vardır.
İlk frame'in hizalama aralığını quantile hesabından çıkarma davranışı v2'den
korunur; 180 ham frame'in tamamı saklanır. Sabit 2200 px üst sınır altında
gerçek scroller mesafesi kullanılır. Bu, 30k kaynak üzerinde ilk tablo
penceresi/32 görsel senaryosudur; 30k ayrı görsel veya bütün satırları gezen
uzun scroll senaryosu değildir.

Native `cpSaveRowImage` → POST → canonical PATCH akışı korunur. Her yükleme
Orders revizyonunu artırdığı için orijinal kolda +32, kontrolde +0; Supp. FOB
ve kaynak revizyonu sabitliği doğrulanır. CP/Orders/catalog GET'leri iki kolda
da hazırlanır; ikinci okumada tek generation şartı aranır. Ardından yeni
Chromium açılır. Gerçek projection başlıkları, checksum, aktif modül satırları,
renderer revizyonları, DOM model/renk canonical anahtarı ve original boyutları
doğrulanır. İlk API ref'i görünür görsel zamanı olarak kullanılmaz.

## Kanıtın anlamı

- `Decode Image` leaf olaylarının `tdur` değerleri thread CPU'dur. İç içe
  `ImageDecodeTask`/cache wrapper süreleri tekrar toplanmaz. `dur` ayrı elapsed
  thread toplamıdır; UI gecikmesi veya CPU diye yeniden adlandırılmaz.
- Decoded bellek `cc/image_memory` allocator kanıtından ayrıştırılır. Encoded
  warm cache, V8 heap/external/backing storage, renderer RSS ve RGBA tahmini
  ayrı metriklerdir. RSS process toplamı paylaşılan sayfaları içerebilir.
- Chromium trace request GUID'lerini yeniden numaralandırır. Snapshot'lar
  fazın `performance.mark` zamanı ve onu izleyen gerçek renderer dump'ıyla
  eşleştirilir; ham request GUID eşitliği varsayılmaz.
- İlk load olayı perde arkasında olabilir. Perde kalktıktan sonra viewport
  içindeki gerçek original'ın iki rAF ile gözlenen zamanı ayrıca kaydedilir.
  Bu headless görünürlük gözlemidir; fiziksel ekran ilk piksel ölçümü değildir.
- Scroll long-task süreleri yalnız kendi başlangıç/bitiş penceresine kırpılır.
  Kontrol/orijinal satır geometrisi farkı saklanır; frame farkının tamamı
  decoder'a atfedilmez. Detaylı trace/dump araçlarının ek yükü iki kolda aynıdır.

## Korunan başarısız/erken denemeler

| Etiket | Sonuç / nedeni |
| --- | --- |
| Faz0 | Refresh/cache başarılı; sonraki browser açılışı socket path sınırında durdu. POST tekrarlanmadı. |
| cp-smoke-01 | Boş olabilen `app` dizini tarihsel cache'te var sanılmıştı; app başlamadan durdu. Kopyada boş özel dizin desteği eklendi. |
| cp-smoke-02/03/04 | Eklenen ilk generation varsayımı Main179'un `mode=initial` sözleşmesine uymadı. Gerçek projection header doğrulaması kullanıldı. |
| cp-smoke-05 | Native +32 Orders revizyonu sonrası yeni generation görülünce sıkı kontrol durdu; post-ingest freeze ayrıldı. |
| cp-smoke-06 | İşlev/XLSX kontrolleri geçti; 151.260.889 bayt raw trace, 128 MiB tahmini aştı. Sonraki start durdu; gzip round-trip kanıtı korundu ve bütçe gözleme göre hesaplandı. |
| cp-smoke-07 / orders-smoke-01 | İlk protokolün başarılı smoke'ları. |
| cp-pairs-01 | CP'nin üç çifti tamamlandı; sonraki ortak protokol değişikliği nedeniyle son seri yerine kullanılmadı. |
| orders-pairs-01 | İlk original kol, eksik catalog'un generation yayımlaması nedeniyle durdu. CP/Orders checksum'ları değişmemişti. Kontrol gevşetilmeden catalog hazırlığı eklendi. |
| cp-smoke-08 / orders-smoke-02 | Ortak, daha sıkı son protokolün başarılı smoke'ları. |

Erken cp-smoke-06 içindeki geniş `decodeCpuMs` alanı iç içe wrapper elapsed
sürelerini de içerir; decoder CPU kararı için kullanılmadı. Son seri leaf
`Decode Image` olaylarının `tdur` değerlerini kullanır.

Önceki dosyalar ve etiketler değiştirilmedi. Son protokol için tüm çiftler
taze `cp-pairs-02` / `orders-pairs-02` köklerinde tamamlandı.

## Güvenlik ve kapsam sınırı

Ölçümler/testler aynı `/tmp/buyerlog-performance-measurement.lock` üzerinde
`flock -n -E 75 -F` altında seridir. Kilit silinmedi veya aşılmadı. Kaynak
dosyaların içerik/mode/device/inode güvenliği her koşudan önce/sonra denetlenir;
yalnız üç doğrulanmış XLSX hardlink edilir. Mutable veri özel kopyadır.
Kaynak klasör kapsamı için açık source-cache yolu korunur. Deneme sırasında
source write girişimi örneği geçersiz kılar.

Tüm sabit iş yükü için disk/memory/inode admission yapılır. İlk trace bütçe
aşımından sonra gözlenen boyutlarla bütün plan tekrar kabul edildi; catalog
düzeltmesinden sonra kalan 14 koşu için 12 GiB disk bütçesi ve 9 GiB ardışık
bellek tepe bütçesiyle tekrar kontrol edildi. Başkasının dosyası veya eski kanıt
silinmedi. Raw dosya ancak server/browser çıkışı, gzip SHA ve bağımsız
decompression uzunluk/SHA round-trip manifesti fsync edildikten sonra bırakılır.

Yalnız yerel demo/sentetik veri kullanılır. Üretim dosyaları, benchmark harness,
`scripts/lib/**`, canonical sözleşmeler ve i18n baseline korunur. Native GET
alias'larında sessionsız 401 ve yetkili byte/MIME/cache kontrolleri yapılır;
özel sahiplik/görünüm kapsamı ayrıca ilgili testlerle değerlendirilir.

Bu çalışma entegre tam regresyon, Windows/Electron veya üretim görsel
dağılımı kabulü değildir. GC zorlanmaz; OS disk cache'i temizlenmez. Clipboard
kanıtı üretim clipboard payload hazırlamasının byte eşitliğidir; işletim sistemi
clipboard entegrasyonu kabulü değildir. Preview ürün kararı ve #908 sonrası
final kabul açık kalır.

## Doğrulama ve teslim

- İlgili paket: **77 dosya / 461 test PASS**, skip/fail 0. Image, canonical,
  model asset scope, private replication, IAM session, startup/transition ve
  i18n guard'larını içerir.
- #916 fast step'in dokuz dosyası: **23 test PASS**, skip/fail 0.
- `npm run i18n:check`: yeni eksik **0**, baseline **0**. Baseline'ın mevcut
  `note` + boş `files` şeması ve MAX_ENTRIES/FROZEN_FILES bekçileri korunur.
- [Kaynak/kilit doğrulaması](input-validation-main179-04/input-and-lock-validation.json):
  checkout + dondurulmuş uygulamada **3.303 Git blob**, orijinal 12 v2 dosyası,
  **29** koşunun kaynak inode/mode/hash audit'i, son altı original kolda
  **192** fiziksel dosya/canonical ref eşlemesi; dört ayrı read-only guard
  negatif kontrolü ve ikinci flock'un beklenen **75** çıkışı geçti.
- Windows `.cmd` dosyalarının kayıtlı `text eol=crlf` gösterimi Git blob'una
  normalize edilerek denetlendi; hiçbir dosyanın EOL'si değiştirilmedi. Raw
  image/JS/guard pinleri ayrıca byte SHA ile doğrulandı. Yeni tanısal doğrulayıcı
  bu EOL gösterimi ve baseline wrapper şeması için kalibre edildi; mevcut
  üretim test/validator/timeout'ları değiştirilmedi. İlk denemeler log'da korunur.
- İlk test paketi varsayılan `/home/agent/.buyer-log/write-recovery` kökünde
  ENOENT nedeniyle durdu. Mevcut testler aynı içerikle özel data/auth/local/
  config köklerine yönlendirilince 461/461 geçti. İlk hata log'u da korunur.

[Test logları](tests-main179/), [tam komutlar](COMMANDS-MAIN179.md),
[portable raw kanıt manifesti](evidence-main179/portable-evidence-manifest.json),
[kopya/gzip doğrulaması](portable-archive-validation.json),
[kesin dosya listesi](DELIVERY-FILES.txt) ve [teslim SHA manifesti](DELIVERY-SHA256.json).

Portable kanıt tüm tam trace gzip'lerini, sonuçları, başarısız denemeleri,
source audit'lerini, 32 original raster'ı ve original XLSX'leri içerir. Özel
mutable fixture/auth state tekrar yayımlanmaz; yerel `work/` kökünde kayıpsız
korunur. Orijinal compression manifestleri bu yerel artefact'ları da kayıtlı
tutar. Portable doğrulayıcı eski mutlak köklere erişmeden teslim edilen bütün
dosyaları ve gzip round-trip'lerini kontrol eder. Ayrıca [portable yeniden hesaplama](portable-recompute-validation.json)
eski work köküne `open` erişimi audit hook ile engellenmişken 12/12 analizi
tamamladı; bütün sayısal/işlevsel alanlar yerel hesapla birebir eşleşti.
`analyze.py --portable` yalnız teslim ağacını kullanır. Dondurulmuş app'in kaynağı
Git Main179 ağacından tekrar alınabilir; source tar repo'da zaten kayıtlıdır.

Üretim kodu değişmedi. PR/merge/bağımsız inceleme/rebase/force-push ve
TEST/STABLE yapılmadı. Bu teslim yalnız tanı ve API önerisidir; INT-08 üretim
kabulü, toplam external metriği ve #908 sonrası final kabul açık kalır.
