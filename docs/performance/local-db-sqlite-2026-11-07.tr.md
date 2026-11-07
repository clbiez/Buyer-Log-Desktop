# Yerel JSON/WAL ve SQLite: prototip karar raporu

Tarih: 7 Kasım 2026. [English](local-db-sqlite-2026-11-07.en.md).

## Karar ve kapsam

**Kullanıcı kararı: #900 taslak ve merge edilmemiş olarak bekleyecek. Yeni pilot,
migrasyon, ürün değişikliği veya TEST/STABLE yayını başlatılmayacak.** Mevcut
kanıtlar ve TR/EN raporları korunur.

Karar özetinin sınırları:

- Açılış ölçümü UI açılışı değildir; SQLite tüm kayıtları yüklemez.
- 200k tam kayıt okuması JSON→SQLite **24,7→1188,1 ms**: mevcut tüm-state
  API'siyle otomatik kazanım yoktur.
- Yedekleme güvenceleri eşit değildir; toplam disk farkı doğrudan tasarruf
  sayılamaz.
- SIGKILL sonuçları elektrik kesintisi dayanıklılığını kanıtlamaz.
- Ölçülen **Electron 39.0.0** ile güncel **Electron 44.3.0** hedefi ayrıdır;
  sonuçlar 44/Windows hedefini doğrulamaz.

**Prototip PR'ını merge etmek, uyumluluk pilotunu başlatmak ve canlı migrasyon
üç ayrı karardır; hiçbiri diğerine otomatik izin vermez.** Faz 6'nın tam
`npm test` şartı kaldırılmadı. Merge değerlendirmesinden önce güncel entegrasyon
üzerinde gerekli tam regresyon ve inceleme tamamlanmalıdır; mevcut hedefli
testler ve PR hızlı kontrolleri bu şartın yerine geçmez. Bu teslim güncellemesi
bu çalışmaları başlatmaz.

[Muhtemel] Sentetik iş yükündeki SQLite açılış, indeksli sorgu ve compaction
avantajları gelecekte ayrı bir uyumluluk pilotunu değerlendirmeyi destekler;
bu teknik öneri pilot veya migrasyon izni değildir. Ayrı
[SHARED_LEASE_LOST takip bulgusu](local-db-sqlite-2026-11-07/shared-lease-lost-follow-up.md)
yalnız gözlemi teslim eder; kök neden ve etki bilinmiyor.

[Doğrulandı] Değişiklik yalnız `scripts/prototypes/` ve `docs/` altındadır.
Ürün kodu, manifest/lock dosyaları ve sürüm notları değişmedi. Veri tamamen
sentetiktir; gerçek kurulum, SMB veya paylaşılan klasör kullanılmadı.

[Doğrulandı] `local-db.js` compaction yorumunda geçen **295 MB** tarihsel bir
kurulum notudur; bu çalışmanın güncel müşteri ölçümü değildir. `large-json.js`
gerçekten 256 MiB üstünde parçalı parser kullanır. Boyutlar aşağıdaki sentetik
deneye aittir; MB/MiB birbirinin yerine kullanılmaz (1 MiB = 1.048.576 bayt).

## Runtime, bağımlılık ve imza etkisi

[Doğrulandı] Ana deney resmi **Electron 39.0.0 / Node 22.20.0 / V8
14.2.231.14-electron.0 / SQLite 3.50.4 / Linux x64** üzerinde,
`ELECTRON_RUN_AS_NODE=1` ile çalıştı. `node:sqlite.DatabaseSync` gerçekten
yüklendi; yalnız aynı Node sürümünü taşıyan bağımsız Node ile varsayılmadı.
Runtime, CPU, cgroup sınırları, kaynak commit/hash'leri ve ham sonuçlar
[raw.json](local-db-sqlite-2026-11-07/raw.json) içindedir.

[Doğrulandı] Bu checkout'un `.github/installer/runtime.json` dosyası artık
**Electron 44.3.0** gösteriyor. İstenen 39 hedefi ayrıca indirilen runtime ile
ölçüldü; ürün manifesti geriye alınmadı. [Bilinmiyor] Mevcut Windows paketinin ve
Electron 44'ün aynı sonuçları verip vermediği bu deneyde sınanmadı.

| Seçenek | Bağımlılık / dağıtım | İmza / paket etkisi | Kanıt |
| --- | --- | --- | --- |
| `node:sqlite` (deneyde seçilen) | Ek npm veya `.node` dosyası yok; SQLite runtime içinde. 22.20.0'da deneysel API uyarısı var. | Var olan runtime kullanılabiliyorsa yeni native modül yok. Gelecekte ürün kodu/paket baytları değişirse normal manifest/hash/imza ve sürüm süreci gerekir; runtime değişimi tam kurulum değerlendirmesidir. | [Doğrulandı] Electron 39.0.0 Linux'ta çalıştı. |
| `better-sqlite3` | Ek kilitli bağımlılık, lisans/SBOM/advisory takibi; hedef OS/arch ve Electron ABI'sine uygun native binary/rebuild gerekir. Standalone Node ABI 127 ile Electron 39 ABI 140 aynı değildir. | `.node` dosyası da paket envanterine, bütünlük manifestine ve imzalanan arşive girer. Mevcut manual-patch `mutablePath` yalnız `server/` ve `public/` değişimini kabul eder; `node_modules/` eklemek bu yolla doğrudan dağıtılamaz. Tam paketleme ve hedef mimari testleri gerekir. | [Muhtemel] Native paketleme riski; performansı ve paketlenmiş yüklemesi ölçülmedi. |

[Doğrulandı] Mevcut Electron backend'i de `ELECTRON_RUN_AS_NODE` süreci kullanır
(`resources/app/electron/backend.js`). Bu, deneyin runtime kipini destekler;
imzalı Windows ürün kabul testi yerine geçmez. [Muhtemel] `DatabaseSync` uzun
işlemleri backend olay döngüsünde bloklayabilir; worker/ayrı süreç tasarımı ve
HTTP/UI gecikmesi ayrıca sınanmalıdır. Bu prototip worker mimarisi önerisini
ürüne uygulamaz.

## Deney tasarımı ve eşitlik sınırı

- Boyutlar: **10.000 / 50.000 / 200.000 olay**; bunlar kayıt sayısı değildir.
  Her on olayın üçü sipariş, altısı checklist cevabı, biri ayar patch'idir.
  Aynı sipariş tekrar güncellenir; checklist metinleri, durum, rapor numarası ve
  ek dosya künyeleri taşınır, dosya içerikleri/base64 yoktur.
- Her boyutun fikstürü bir defa gerçek API üzerinden 10.000'lik batch'lerle
  üretilir; %80 olay yüklenmiş işaretlenir, **ACK verilmez**. Fikstür üretim
  süresi ayrı ham alandır, ölçülen koşulara ve bellek tepesine karışmaz.
- Her motor için üç yeni süreç/özel dosya kopyası: **JSON→SQLite,
  SQLite→JSON, JSON→SQLite**. Aynı deterministik 300 işlemlik iz: 150 tek kayıt
  okuma, 60 filtre, 30 `pending(100)`, 30 tek yazma, 30 adet 20'li yazma.
  Her koşu 630 yeni olay ekler. Motorlar sırayla koşar; ölçüm sırasında başka
  test/build çalıştırılmadı.
- JSON gerçek `createLocalDb` API'sini, varsayılan **1 MiB / 2000 WAL kaydı**
  eşiğini, lease, fsync, yedek ve recovery yollarını kullanır. SQLite WAL +
  `synchronous=FULL`, 8 MiB sayfa cache'i, 256 sayfalık otomatik checkpoint,
  prepared statement ve kayıt/olay tabloları kullanır. İki taraf da tek
  yazmaya/batch'e bir kalıcılık sınırı uygular; SQLite `OFF/NORMAL` ile
  avantajlı gösterilmedi. JSON eşiği aşılınca gerçek snapshot maliyeti dahildir.
- SQLite prototipi **yalnız yerel otoritatif patch alt kümesini** uygular.
  Kayıtlar, alan revizyon/yazarları, HLC, journal checksum, duplicate davranışı,
  filtre ve pending sonuçları küçük eşitlik testinde karşılaştırılır. Büyük
  koşularda iş verisi digest'i, olay kimlikleri, sayaçlar ve okuma sonuç
  checksum'ları iki motorda eşleşir; compaction sonrası yeniden açılış da
  doğrulanır. Tüm `read()` zarfı ve yüklenmiş journal metadata eşitliği iddia
  edilmez; tombstone/uzak merge/owner yetkisi/ACK/package/checkpoint kapsam dışıdır.
- Checklist biçimli veriler bu deneyde local-db kayıtlarıdır. Mevcut
  `checklist-supplier-store.js` ayrı dosya yolu kullanır; bu, checklist HTTP
  akışının uçtan uca hızlanacağını ispatlamaz.

[Doğrulandı] Başlangıç, adapter açma + `ensure` + ilk kayıt ve pending-count
sorgusudur; Electron UI açılışı değildir. SQLite tüm DB'yi materialize etmeden
hazır olabilir. Tam kayıt okuma ayrıca ölçülür: JSON cache'deki canlı nesneyi
verir, SQLite bütün kayıt JSON'larını parse eder. İndeksli filtrede SQLite
indeksinden 50 sonuç alır; mevcut API tarafı `read().records` üzerinden tarayıp
sıralar. Bu fark önerilen erişim modelinin etkisidir; SQL indekslerinin faydası
ürüne sorgu API'si uyarlaması yapılmadan kendiliğinden gelmez.

[Doğrulandı] OS dosya cache'i sıcaktır; cache düşürülmedi. Aynı container/local
dosya sisteminde, 16 GiB cgroup bellek ve 4 CPU kotasıyla ölçüldü. Üç koşu
tekrarlanabilirlik için alt sınırdır; güven aralığı veya müşteri cihazı SLA'sı
vermez. [Bilinmiyor] Soğuk disk, Windows/antivirüs, eşzamanlı süreçler, hedef SSD
ve gerçek veri dağılımının etkisi.

## Ölçümler

Aşağıdaki tablolar üç koşunun medyanıdır; p95 sütunları her koşunun p95'inin
medyanıdır. Yüzdelik, sıralı örneklerde sıfır tabanlı `floor((n−1)×0.95)`
indeksinden alınır; en uzun yazma ayrıca gösterilir. Her koşunun tüm değerleri
ve dosya dökümü ham JSON'dadır.
Süreler ms; bellek/disk MiB. RSS native SQLite belleğini de kapsar. Kalıcı/steady
bellek işlem izi sonrasında zorunlu GC ile hâlâ süreçte kalan bellektir;
heap, RSS ile aynı değildir. Tepe RSS Linux `ru_maxrss` sayacıdır; senkron
işlemlerde timer örneklemesinin kaçırabileceği yükselmeleri de yakalar.
Tepe açılış + iz + tam okuma + compaction'ı içerir; en sonda yapılan pahalı
doğrulama digest'ini ve fikstür üretimini içermez. GC süreleri süre tablolarına
eklenmez. İşletim sistemi page cache belleği RSS tablosunda sayılmaz.

Medyan duvar saati süresi (ms)

| Olay | Motor | Açılış + ilk sorgular | Karma iz | Tam kayıt okuma | Compaction |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | local | 355.1 | 378.4 | 1.773 | 1047.1 |
| 10,000 | sqlite | 2.179 | 65.3 | 71.2 | 61.1 |
| 50,000 | local | 1068.2 | 3437.1 | 9.015 | 5029.6 |
| 50,000 | sqlite | 2.331 | 67.1 | 297.2 | 326.2 |
| 200,000 | local | 2542.7 | 3431.9 | 24.7 | 20977.7 |
| 200,000 | sqlite | 3.603 | 70.0 | 1188.1 | 1385.1 |

Koşu p95 medyanları (ms; batch = 20 olay)

| Olay | Motor | Tek kayıt | Filtre | Bekleyen 100 | Tek yazma | Batch 20 | En uzun yazma (medyan) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | local | 0.310 | 2.771 | 1.047 | 4.103 | 6.289 | 9.894 |
| 10,000 | sqlite | 0.026 | 0.525 | 0.426 | 0.179 | 1.469 | 1.724 |
| 50,000 | local | 0.335 | 12.8 | 1.760 | 4.704 | 6.359 | 2489.9 |
| 50,000 | sqlite | 0.043 | 0.578 | 0.404 | 0.171 | 1.478 | 1.806 |
| 200,000 | local | 0.385 | 67.3 | 6.865 | 6.249 | 7.243 | 11.0 |
| 200,000 | sqlite | 0.029 | 0.500 | 0.388 | 0.200 | 1.748 | 2.302 |

Medyan süreç belleği (MiB; RSS native belleği içerir)

| Olay | Motor | Açılış RSS | Kalıcı RSS | Kalıcı heap | Compaction sonrası RSS | Tepe RSS |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | local | 188.7 | 190.2 | 21.8 | 208.3 | 301.9 |
| 10,000 | sqlite | 77.8 | 87.0 | 3.206 | 117.2 | 126.5 |
| 50,000 | local | 252.8 | 528.0 | 94.3 | 410.2 | 675.4 |
| 50,000 | sqlite | 78.1 | 89.0 | 3.206 | 237.5 | 246.9 |
| 200,000 | local | 908.8 | 536.4 | 372.3 | 1145.8 | 2002.3 |
| 200,000 | sqlite | 78.7 | 90.7 | 3.206 | 519.9 | 529.2 |

Medyan disk alanı (MiB; primary + WAL + tüm yedek/recovery dosyaları)

| Olay | Motor | Compaction öncesi | Compaction sonrası | Kapanış sonrası | Compaction sonrası primary |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | local | 28.4 | 25.2 | 25.2 | 12.6 |
| 10,000 | sqlite | 23.7 | 14.4 | 14.4 | 14.4 |
| 50,000 | local | 200.6 | 112.9 | 112.9 | 56.5 |
| 50,000 | sqlite | 117.9 | 71.4 | 71.3 | 71.3 |
| 200,000 | local | 804.8 | 445.9 | 445.9 | 222.9 |
| 200,000 | sqlite | 485.2 | 299.5 | 298.9 | 298.9 |

18 koşu; 18 SIGKILL sınaması; validation=passed.

[Doğrulandı] 200k'da medyan açılış 2542,7→3,6 ms, compaction
20977,7→1385,1 ms; kalıcı RSS 536,4→90,7 MiB oldu (JSON→SQLite).
Buna karşılık tüm kayıtları materialize eden okuma 24,7→1188,1 ms sürdü.
SQLite'ı mevcut tüm-state erişimine sarmalamak bu önemli karşı maliyeti taşır.

[Doğrulandı] 50k JSON koşularında tek bir yazma 2386,5–2526,9 ms sürdü;
varsayılan WAL eşiğindeki snapshot işini değiştirmedik. p95 bu seyrek durmayı
gizleyebilir; tabloda koşu başına en uzun tek/batch yazmanın medyanı da vardır.
Bu yüzden 50k karma süre 200k'ya yakın çıkar; üç boyuttan düzgün bir ölçek
eğrisi veya sabit hız çarpanı türetilmemelidir.

Disk toplamı **primary + mevcut/eski WAL + tüm yedek/recovery dosyaları**dır;
yalnız `.db` dosyasını kıyaslamaz. JSON kurtarma için iki tam görüntü saklar;
SQLite prototipi bağımsız yedek oluşturmaz. Bu nedenle toplam disk farkı eşit
yedekleme güvencesi altında kanıtlanmış tasarruf değildir. SQLite için en az bir
bağımsız yedek, boş alan ve retention maliyeti pilotta ayrıca ölçülmelidir.
SQLite WAL checkpoint/VACUUM ve JSON journal budama + snapshot/yedek
doğrulaması aynı kullanıcı amacına hizmet eder, aynı algoritma değildir.
[Doğrulandı] 200k compaction sonrasında SQLite primary **298,9 MiB**, JSON
primary **222,9 MiB**: SQL dosyasının tek başına daha küçük olduğu iddia edilemez.

## Crash/replay ve veri dayanıklılığı

[Doğrulandı] Her boyut/motor için üç ayrı **gerçek SIGKILL** sınaması vardır:
onaylı beş yazma sonrası; devam eden yazma sırasında; compaction sırasında.
JSON'da devam eden yazma WAL byte'ları yazıldıktan **fsync öncesinde**, SQLite'ta
commit öncesi açık transaction içinde kesilir. Compaction JSON geçici görüntü
yazıldıktan fsync öncesinde; SQLite payload budama transaction'ı commit edilmeden
kesilir. SQLite `VACUUM` ortasında veya JSON primary rename sonrasında kesinti
bu deneyde ayrıca enjekte edilmedi.

Onaylı beş yazının tamamı yeniden açılışta korunmalıdır; bu assertion koşuyu
başarısız yapar. Compaction kesintisinde başlangıç iş verisi digest'i korunmalıdır.
SQLite her kurtarmada `integrity_check=ok` vermelidir. Ham sonuçlar her sınamanın
replay süresini ve henüz onaylanmamış kaydın görünürlüğünü içerir. JSON'da tam
ama fsync edilmemiş WAL satırının süreç ölümü sonrası görünmesi mümkündür;
onaylanmamış işlemin yokluğu garanti değildir. SQLite açık transaction'ı geri alır.
[Doğrulandı] 18 sınamanın tümü geçti; 200k'daki üç kurtarma açılışı JSON'da
2548,3–2674,6 ms, SQLite'ta 2,0–51,8 ms sürdü. Sonraki iş verisi digest'i bu
açılış süresine dahil değildir; SQLite burada da tüm kayıtları yüklemez.

[Doğrulandı] Ayrı prototip testinde JSON'un yırtık son satırı onarıp sonraki
yazmayı koruduğu ve checksum bozulduğunda yazmayı `DATA_INTEGRITY_ERROR` ile
engellediği doğrulanır. Mevcut compaction/crash/WAL/business-integrity/HLC
testleri de çalıştırıldı; ayrıntı [validation.md](local-db-sqlite-2026-11-07/validation.md).

[Doğrulandı] 200k JSON ölçümlerinde `renew:failed / SHARED_LEASE_LOST` uyarıları
gözlendi; API çağrıları döndü ve sonuç doğrulamaları geçti. Bu uyarı gizlenmedi
ve ürün kodu değiştirilmedi. [Bilinmiyor] Kök neden, veri kaybı olup olmadığı
ve eşzamanlı yazanlar altındaki etkisi. Başarılı testler zararsız yarış sonucunu
kanıtlamaz. Gözlem ayrı takip bulgusu olarak teslim edildi; bu PR'da üretim
düzeltmesi veya yeni inceleme çalışması başlatılmaz.

[Bilinmiyor] SIGKILL elektrik kesintisi değildir: host cache ve disk kontrolcüsü
çalışır. Donanım flush doğruluğu, disk dolması, bit çürümesi, tüm rename/rotation
aralıkları ve Windows güç kaybı bu raporda kanıtlanmadı. Yorumlardaki mutlak
"hiç kaybolmaz" ifadesi tüm arıza modelleri için ölçüm sonucu sayılamaz.

## Migrasyon riskleri ve geri dönüş planı — yalnız tasarım

[Doğrulandı] Prototip, ürün migrasyonu için hazır değildir. Gelecekteki değişiklik
yerel dosya biçimini ve sync sözleşmesini etkiler; P1 olarak ayrı inceleme ister.

1. **Semantik kayıp:** revision, deviceId/localSequence, HLC, field/subfield/list
   yazarları, tombstone, açık/kapalı conflict, event checksum/kimliği, pending,
   uploaded ve ACK ayrımı, kompakt ledger, checkpoint/package idempotency ve
   causalKnowledge korunmalıdır. [Bilinmiyor] Bu alanların tamamında SQL eşitliği.
2. **Geri dönüşü olmayan dosya geçişi:** eski sürüm SQLite okuyamaz. JSON'un
   adını değiştirip üzerine SQLite yazmak veya sessiz otomatik fallback yapmak
   güvenli bir rollback değildir. Eski yedeği geri getirmek, SQLite sonrasında
   onaylanmış yazıları kaybettirebilir. [Doğrulandı] Biçimler farklıdır.
3. **Gelecekteki geçiş:** tüm yazanları durdur/fence et; JSON + WAL + yedek ve
   recovery ailesinin tutarlı bir kopyasını ve hash manifestini sakla. Ayrı
   geçici SQLite oluştur; tüm metadata ve iş hash'lerini doğrula, yeniden aç,
   integrity ve örnek sync testlerini geçir. Kaynak dosyaları değiştirmeden,
   doğrulanmış DB'ye atomik bir seçim kaydıyla geç. Alan ihtiyacını önce ölç;
   her iki format + yedekler + compaction geçici alanı için pay bırak.
4. **Geçişten sonra rollback:** önce yazmaları durdur. Son onaylı SQLite
   işlemini belirle. Ya aynı olay kimliklerini ve tüm sync metadata'yı koruyan,
   önceden sınanmış SQLite→JSON exporter ile **yeni** JSON üret, ya da sınanmış
   durable replay kaydıyla geçiş sonrası bütün olayları eski görüntüye uygula.
   İş hash'i, tombstone/ledger, pending ve ACK sayaçları, sequence/HLC ve yeniden
   açılış doğrulanmadan eski sürüme geçme. Bu yol yoksa otomatik eski yedeğe
   dönme; yazmayı durdurup veriyi koru. Exporter/replay bu PR'da yoktur.
5. **Prototipin geri alınması:** PR'ı kapat/revert et ve yalnız oluşturduğu
   sentetik geçici dosyaları kaldır. Ürün DB'sine dokunulmadığı için ürün verisi
   geri dönüşü veya migrasyon işlemi gerekmez.

## Sonraki karar için kabul koşulları

[Hipotez] İndeksli/az sayfalı erişimle SQLite cihazdaki büyük DB'ler için daha
iyi büyüme davranışı sunabilir. [Muhtemel] Mevcut tüm-state API'sini aynen
materialize eden bir SQL sarmalayıcı bu kazancın önemli kısmını kaybedebilir.
Karar için imzalı hedef Windows paketinde gerçekçi anonim boyut/alan dağılımı,
soğuk/sıcak açılış, UI/HTTP gecikmesi, eşzamanlı yerel süreç, disk-full/güç kesme,
backup/restore ve bütün sync regresyonları gerekir. Tam çift yönlü exporter ve
geçiş sonrası yazıları koruyan rollback kabul edilmeden canlı migrasyon yok.

Güncel kullanıcı kararı beklemektir. İleride prototip PR'ının merge kararı,
uyumluluk pilotu ve canlı migrasyon ayrı ayrı değerlendirilir ve yetkilendirilir.
Merge değerlendirmesinden önce güncel entegrasyonda Faz 6 tam `npm test`, gerekli
regresyon ve inceleme tamamlanmalıdır. TEST/STABLE yayını yapılmadı.

## Kaynaklar ve tekrar çalıştırma

- [Prototip komutları ve sınırlar](../../scripts/prototypes/local-db-sqlite/README.md)
- [Ham ölçümler](local-db-sqlite-2026-11-07/raw.json),
  [doğrulama](local-db-sqlite-2026-11-07/validation.md)
- Kaynak: `resources/app/server/lib/local-db.js` (`createLocalDb`, `compact`, WAL),
  `large-json.js`, `checklist-supplier-store.js`, `electron/backend.js`,
  `electron/manual-patch/signature.js`; hash ve checkout commit'i ham kayıttadır.
- [Resmi Electron sürüm tablosu](https://releases.electronjs.org/releases.json),
  [Node 22.20 SQLite API](https://nodejs.org/download/release/v22.20.0/docs/api/sqlite.html),
  [Electron native modüller](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)
