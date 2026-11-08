# INT-06 bounded snapshot — tek aday, RSS kabulü başarısız

**INT-06 açık. Bu aday kalan bellek gerilemesini kapatmadı ve RSS için kabul
edilmedi.** Aynı kohortta legacy peak RSS medyanı 549.54 MiB, aday
581.69 MiB; **+%5.85**. Üretim entegrasyonu ve aktivasyon yapılmadı.

## Sabitler ve dar değişiklik

- Fetch ile doğrulanan teslim: `392cc5574464690423e6e9cf6f9031549bae6188`.
- Görev başlangıcındaki `origin/main`: `1796193f0a57c7785e7bf9fdb3557e33c550b25e`.
  Uzakta `Main` yok; gerçek ad `main`. İlk fetch'in bu isim hatasıyla durmasının
  ardından gerçek ref fetch edildi. Merge/rebase yapılmadı.
- Katkı dalı: `contrib/int06-bounded-snapshot-20261108`.
- Ölçülen kod/test/harness commit'i: `4e66c955e51e01ac84a0e799d5e1c491008f6393`.
  Sonraki commit yalnız handoff/kanıt ve bunları okuyan audit script'lerini ekler.
- Önce CLAUDE.md, INT-06 bulgusu, adapter sözleşmesi ve önceki RSS tanısı okundu.
  Preparation yeniden üretilmedi; devralınan kaynaklar aynen kullanıldı.
- Tek helper adayı: snapshot payload'ı bir kez stringify edilir; tam escaped zarf
  stringify'ı yerine 64 Ki UTF-16 birimlik string parçaları escape/UTF-8 encode
  edilip tek wx/0600 temp descriptor'üne yazılır. Surrogate çifti bölünmez;
  kısa yazım tamamlanır, sıfır ilerleme EIO verir.
- Public API, format=2, payload hash'i, byte sırası/newline, sequence/delta,
  tek writer sahipliği, file+directory fsync/ACK, poison/reopen, retirement ve
  v1 export sözleşmeleri korunur. Sıcak batch pack yolu değişmez.
- Yardımcıdaki fark 30 eklenen / 3 çıkarılan satırdır. Üretim çağrısı eklenmedi.
  [Dar patch ve API devri](handoff.md), [kesin dosya listesi](file-list.txt).

## Yaşam döngüsü kanıtı

`before-lifecycle.json` mevcut teslim helper'ını, `after-lifecycle.json` adayı
aynı gerçek 100k helper/fixture yolunda gözler. İki koşuda da forced GC ve heap
sampler kapalıdır; phase/FS/JSON probları yine allocation/GC/zamanı etkiler.
**Bu tanılar kabul ölçümü değildir.** `before-gc` event adı devralınan profiler'ın
etiketidir; `forceGC=false` iken collection çağrısı yapılmaz.

[Özet](lifecycle-summary.json) ve ham JSON/log dosyaları korunur:

- Önce son snapshot payload'ı **28.846.686** karakter; escaped zarf **32.391.000**
  karakter (+ newline). Zarf stringify öncesi/sonrası heap artışı gözlemsel olarak
  **61,78 MiB**. Write öncesi/sonrası external artışı **31,67 MiB**; araya GC
  girdiğinden heap farkını saf allocation boyutu diye toplamak doğru değildir.
- Sonra aynı payload uzunluğu kalır, tam zarf stringify sayısı **1 → 0** olur.
  Son snapshot aynı **33.205.289 UTF-8 byte**, **443** sınırlı yazımla çıkar;
  en büyük tek encoding buffer'ı **76.460 byte**. Sekiz snapshot gözlendi:
  init + altı periodic + final explicit compact.
- Tek scratch tahsisi sınırlıdır; GC bekleyen string/Buffer toplamı sınırlı
  değildir. Son diagnostic yazımda gözlenen external maksimum hâlâ yaklaşık
  **23,64 MiB**. Tam payload, manifest uyumluluk dizileri ve owned state kalır.
  Yeni graph kopyası veya GC zorlama eklenmedi.
- `after-diagnostic-replay.json` eski, değiştirilmemiş observer ile koştuğu için
  descriptor üzerinden yazılan snapshot baytlarını saymaz; checkpointBytes alanı
  **eksik tanı sayımıdır**. Aşağıdaki altılı ölçüm bu alanı kullanmaz. Yeni
  descriptor-aware observer ayrıca testlidir ve tarihsel byte toplamlarıyla eşleşir.

Bu deney yalnız tam zarf/UTF-8 tahsis mekanizmasını azalttığını kanıtlar;
RSS kazancını kanıtlamaz. İkinci bir aday döngüsüne girilmedi. Somut sonraki
API sınırı ve payload/GC engeli [handoff.md](handoff.md) içindedir.

## RED → GREEN ve gerçek test sonuçları

- `red-bounded.tap.gz`: sabit teslim helper'ında **7 test: 3 PASS / 4 FAIL**.
  Tam zarf sayımı 2≠0; yeni mid-body EIO/zero ve SIGKILL noktaları eski yazım
  yolunda devreye girmez. Byte eşitliği testleri eski helper'da zaten yeşildir.
  Ham TAP whitespace byte'ları değiştirilmeden gzip ile saklanır; açılmış hash `red-evidence-sha256.txt` içindedir. Bu, yeni yol için beklenen RED'dir; gözlenmiş veri kaybı/bozuk eşdeğerlik yoktur.
- `green-bounded.tap`: **7/7 PASS**. Init/periodic/explicit v2 byte eşitliği,
  Unicode/escape/lone surrogate/sınırdaki emoji, tüm terminal durumlar,
  çok satırlı order, short write, EIO/zero, poison/disk replay ve snapshot
  gövdesinde gerçek SIGKILL sınanır. Hash ve v1 export aynı kalır.
- `green-native.tap` ilk geniş denemenin başarısız kanıtıdır: **31 PASS / 2 FAIL**;
  iki native dosya helper'a ulaşmadan varsayılan `/home/agent/.buyer-log` alanı
  bulunamadığı için ENOENT verir. Bu kayıt silinmedi/üzerine yazılmadı.
- Mevcut uygulama env API'siyle boş sentetik `BUYER_LOG_DATA_ROOT` ve
  `BUYER_LOG_SERVER_DATA_ROOT` seçilip aynı testler yeniden koştu:
  `native.tap`: **116/116 PASS**, fail/skip/cancel=0. Bunun içinde değişmeyen
  **102 native**, **9 yeni test** ve **5 i18n guard** testi var; nested devralınan
  koşu ayrıca **17/17 PASS**. Eski assertion/test/timeout/runner gevşetilmedi.
- `i18n.log`: **0 yeni / 0 baseline eksik**; baseline `files` boş kalır.
  Tam filtresiz entegre regresyon yapılmadı; ana sohbet aşamasıdır.

## 100k steady: altı taze süreç, A/B–B/A–A/B

Kapasite kontrolleri `capacity-before.txt` ve `capacity-cohort.txt` içindedir:
16 GiB cgroup limiti, yaklaşık 30 GiB workspace boş alanı, bağımsız aktif
ölçüm yok. Ortak lock her test/tanı/ölçüm için
`env -u NODE_OPTIONS -u NODE_PATH flock -n -E 75
/tmp/buyerlog-performance-measurement.lock` ile tutuldu. Lock silinmedi veya
başka adla aşılmadı. Yalnız sentetik/demo fixture; servis/credential yok.

Sıra `legacy-store/journal`, `journal/legacy-store`, `legacy-store/journal`.
Node v24.19.0, aynı fixture/trace, batch=250, 400 terminal batch,
snapshotEvery=64; init, tüm altı periodic snapshot ve final compact dahildir.
Kabul kohortunda preload/profiler/GC flag/heap limiti yoktur. Code/fixture/trace/
çıktı hash'leri ve byte toplamları `cohort-verification.json` ile doğrulanmıştır.

Aşağıda üç örneğin **medyan [min–max]** değerleri; MiB=2²⁰ byte.
Heap/external değerleri checkpoint dönüşündeki **örneklenmiş maksimumdur**,
fonksiyon içi sürekli peak değildir. RSS kernel process-lifetime high-water'ıdır;
load/oracle/materialize doğrulama ve final hash hesaplarından önce kaydedilir.

| Kol | Peak RSS MiB | External MiB (örneklenmiş) | Heap used MiB (örneklenmiş) |
| --- | ---: | ---: | ---: |
| legacy-store | 549.54 [458.20–551.44] | 2.18 [2.18–2.18] | 342.11 [245.17–342.36] |
| journal | 581.69 [579.42–607.82] | 23.60 [23.60–23.60] | 357.28 [346.40–360.11] |

| Kol | Toplam replay CPU s | Toplam replay süre s | Checkpoint CPU s | Checkpoint süre s | Yazılan mantıksal byte |
| --- | ---: | ---: | ---: | ---: | ---: |
| legacy-store | 58.797 | 58.198 | 56.879 | 56.352 | 6,777,574,427 |
| journal | 7.266 | 7.025 | 5.854 | 5.659 | 193,920,022 |

Toplam replay fixture/trace hazırlığı, hash ve checkpoint'i içerir;
load/oracle/assertion'ları ve süreç bootstrap'ını dışarıda bırakır. **Toplam
connector refresh değildir.** Checkpoint süreleri her iki kolda aynı dar store
bölgesini ölçer; legacy'nin input sayaç/uyumluluk hazırlığı süre dışında,
full copy + store serialize/write bölgesi süre içindedir. Observer/boundary
örneklemesi ölçüm overhead'i ekler. Legacy fsync yapmaz; durability eşit değildir.
Byte metriği metadata/device/physical I/O değildir.

Tam çıktı hash'leri altı örnekte de aynı:

```text
fixture       ec444e07a3ced97eac68cd2aa63821ecff4ef7050da13288403f4f327adfac56
trace         27d5d251218d188018124d7a2117875fd7af721810143a075c16aee02b39bfef
rows+states   98264b7df975ab65f90badaa6b2347f2a614ae95731da5ced9ed68bacd2ef34f
full manifest 6976f5eb913623f9ad066c91906fc42e65fcf6c047f36882d5e83f32fd34da88
rows          4eb05c2154a465f4c81a60b7be8c81274a7024898e7b591e6c6e259740eafab6
orderStates   4ae90273ad355c0e7c76c944b98d1d89cb85a9e65686a37078ca8edd7d93d76f
```

Tam manifest hash'i object key'lerini sıralayan canonical görünümden alınır;
array/row sırası korunur. Bu yalnız ölçüm sonrası doğrulama içindir, persistence
formatını değiştirmez. Trace/fixture/rows+states hash'leri eski 100k kanıtlarıyla
da aynıdır. Ham altı JSON, min/medyan/max ve başarısızlık logları korunmuştur.

Önceki kohortun **485,07 / 548,20 MiB (+%13,02)** sonucu tarihsel olarak korunur;
yeni kohortun **549.54 / 581.69 MiB (+%5.85)** sonucuyla
birleştirilmez. Bunlar önce/sonra journal performans kazancı kanıtı değildir.
Yeni kohortun kendi içinde de RSS gerilemesi pozitiftir; CPU/yazım azalması bu
bellek hedefinin yerine sayılmaz. **Aday RSS hedefinden kaldı.**

`/tmp` tmpfs; **disk/SMB/üretim kabulü yoktur**. Windows/Electron, gerçek
power-loss ve load/export/reopen tepe belleği iyileşmesi iddia edilmez.

## Koruma, yeniden üretim ve devir

135 eski kanıt/devralınan fixture dosyası başlangıç hash'leriyle
`preserved-inputs.json` içinde sabitlendi. `preservation-audit.json` ayrıca
62 protected production dosyasını ve önceki INT-06 test/fixture'larını doğrular.
Eski kanıtlar, protected source, validator ve runner değişmedi.

Yeni çıktı dizini seçerek altılı kohortu yeniden koş:

```sh
env -u NODE_OPTIONS -u NODE_PATH flock -n -E 75 \
  /tmp/buyerlog-performance-measurement.lock \
  node scripts/prototypes/int06-bounded-snapshot-20261108/cohort.cjs \
  /tmp/int06-bounded-new-evidence
```

`validate.sh` bu teslimin test komutlarını ve sentetik env hazırlığını gösterir;
mevcut native.tap/i18n.log üzerine yazmayı reddeder. Tekrar koşarken yeni kanıt
hedefleri kullanılır. Mevcut validator/test runner değiştirilmedi.

Kesin dosyalar ve SHA-256/byte boyutları `file-list.txt` ve
`evidence-manifest.json` içindedir. Dar uygulanabilir patch ve değişmeyen API
sözleşmesi `handoff.md` içindedir. Kendi katkı dalına normal push/uzak SHA
kontrolünün sonucu final teslim mesajındadır. PR açma, üretime bağlama,
bağımsız inceleme, merge, rebase/force-push veya TEST/STABLE yapılmadı.
