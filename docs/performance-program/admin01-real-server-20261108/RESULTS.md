# ADMIN-01 — sonuç ve karar

**[Doğrulandı]** Altı gerçek sunucu yük koşusu ve üç ayrı dar profil tamamlandı.
HTTP penceresinde **2.599 gerçek health + 29 Overview + 29 Orders GET**,
**0 HTTP hata**. Dokuz gerçek API arşivinin her biri CRC/SHA/manifest ve
dosya bazında staging restore doğrulamasından geçti. Her arşivde 28 ZIP
kaydı / 27 içerik dosyası var. Üretim kaynakları değiştirilmedi.

**Karar:** Şimdilik worker taşıması yapılmamalı. CRC belirgin ana-thread
hotspot'u; bu iş yükünde gerçek sunucuya worker eklemenin faydasını gösteren
bir karşılaştırma bulunmuyor. Bu tanı worker gerekliliğini veya bir performans
SLO kabulünü kanıtlamaz. Ölçülen hazır projection yolu için yeni bir gzip/cache
optimizasyonu önerilmez: mevcut kod bunu zaten yapıyor.

## Ortam ve kimlik

- Baz: `1796193f0a57c7785e7bf9fdb3557e33c550b25e`.
- #896 hazırlığı: `04de59cdcfa959eab9923b9566ee09373daddee2`.
- Linux x64, kernel 6.18.57, Node v24.19.0, AMD EPYC 9V74.
- cgroup: 4 vCPU (`400000 100000`), 16 GiB RAM. Ölçüm dizini overlayfs,
  fs magic `0x794c7630`; `/tmp` kullanımı ölçüm veri diski olarak raporlanmaz.
- Her koşunun admission, kaynak/harness SHA'ları ve config ortamı kendi
  `report.json` dosyasında; fixture kimlikleri [fixture.json](fixture.json)
  ve [seed.json](seed.json) içinde. [inheritance.json](inheritance.json)
  değişmeden devralınan 39 dosyayı doğrular.
- Arşiv kaynağı: 272 MiB + 9 byte devralınmış payload ve gerçek sentetik
  sunucu metadata'sı. ZIP yaklaşık 290,33 MB (276,88 MiB). Sentetik Excel'ler
  ve page-cache, uygulamanın mevcut full-backup seçim kurallarıyla işlenir;
  sıcak projection'ların tamamı arşive zorla eklenmez.
- Fixture SHA:
  `18daf1cf78dba1b7e46be23c501333248b6e7ce31f207a7e7fa362ffdf42d8df`.
- Her iki projection **30.000 satır**; generation
  `mw7n9msq-e2d86f5c6ab9`, source revision
  `db5b4dd4979507e49dcb901bca360112ada502e34b6bfc1063ad363edcade9bb`.
  `refreshHistory=1`, diğer 14 store revision'ı 0; bütün koşularda önce/sonra
  eşit. Tam revision haritası ham raporlardadır.
- Mevcut backup-service SHA:
  `8c721b8c7f58c2aad98126435eb6e8a440034910835ea512a3c793cc62178d7f`.
  backup-archive SHA:
  `ece0469f3b916379e6a3061b9864cf7dfd6d86c31420038e4ec7e9fb0730d02d`.
  İkisi de #896'nın ölçtüğü kaynakla aynı. Yeni gerçek sunucu sayıları eski
  sentetik HTTP serisinin önce/sonra sonucu değildir.

## Gerçek HTTP gecikmesi

A = yedekleme + yalnız health probu. B = yedekleme + health + yetkili
Overview/Orders GET. Değerler ms; nearest-rank p50/p95/max, hata örnekleri
ayıklanmaz. Sadece başlangıcı gerçek backup `create` penceresine düşen
istekler dahil; pencere bittikten sonra tamamlanan yanıtlar da sayılır.

| Senaryo/koşu | Health n | p50 | p95 | max |
| --- | ---: | ---: | ---: | ---: |
| A1 | 375 | 2,58 | 14,21 | 119,17 |
| A2 | 406 | 2,47 | 12,39 | 118,18 |
| A3 | 435 | 2,49 | 13,73 | 110,02 |
| B1 | 397 | 2,60 | 20,42 | 110,22 |
| B2 | 526 | 2,82 | 15,59 | 118,69 |
| B3 | 460 | 2,49 | 20,02 | 136,27 |

| Senaryo/koşu | Yetkili projection | n | p50 | p95 | max |
| --- | --- | ---: | ---: | ---: | ---: |
| B1 | Overview | 8 | 16,86 | 24,97 | 24,97 |
| B2 | Overview | 11 | 14,04 | 16,31 | 16,31 |
| B3 | Overview | 10 | 16,57 | 36,65 | 36,65 |
| B1 | Orders | 8 | 25,95 | 33,96 | 33,96 |
| B2 | Orders | 11 | 26,62 | 35,30 | 35,30 |
| B3 | Orders | 10 | 30,92 | 60,40 | 60,40 |

Koşu p95'lerinin medyanı: health A **13,73**, health B **20,02**,
Overview B **24,97**, Orders B **35,30 ms**. Gözlenen bütün koşuların en
kötü health yanıtı **136,27 ms**. Üç interaktif koşuda yalnız 8–11 örnek/endpoint
olduğu için p95 her koşuda max'a eşittir; kuyruk davranışı için geniş örnekli
bir tail/SLO kabulü ileri sürülmez.

Overview gzip body 952.040 byte, Orders 5.675.954 byte. Bütün başarılı
yanıtlar başlangıçtaki sıkıştırılmış body SHA'sını ve generation başlığını
korudu. Gerçek UI'nin hazır `/api/page-projection/:module` GET yolu ölçüldü;
renderer açılışı, JSON parse ve görünür satır boyaması ölçülmedi.

## Backup, event loop ve kaynaklar

Duvar/CPU ms. CPU, sunucu sürecinin user+system toplamıdır; birden çok thread
nedeniyle duvar süresinden büyük olabilir. Gap nominal 10 ms aralığı içerir;
HTTP gecikmesi değildir. RSS dış süreçten 50 ms aralıkla örneklenmiştir.

| Koşu | Backup duvar | CPU user | CPU system | Gap p95 | Gap max | Parent RSS peak MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A1 | 3845,57 | 6228,81 | 592,50 | 11,22 | 124,34 | 356,25 |
| A2 | 4190,02 | 5744,00 | 951,42 | 11,50 | 124,18 | 396,48 |
| A3 | 4486,41 | 6036,55 | 1182,51 | 11,81 | 123,14 | 402,51 |
| B1 | 4054,46 | 6210,79 | 643,76 | 13,00 | 120,80 | 421,72 |
| B2 | 5434,05 | 6986,54 | 1814,45 | 12,65 | 122,75 | 412,85 |
| B3 | 4744,80 | 6031,28 | 1286,25 | 12,57 | 142,09 | 411,12 |

Koşu metriklerinin medyanı: A duvar **4190,02 ms**, CPU **6821,31 ms**,
RSS **396,48 MiB**; B duvar **4744,80 ms**, CPU **7317,53 ms**, RSS
**412,85 MiB**. Bunlar farklı yük senaryolarıdır; kod kazanım/kaybı değildir.
En büyük tam gap **142,09 ms**. Heap başlangıç/bitiş aralıkları A
69,63–70,74 / 54,40–55,32 MiB, B 73,82–82,20 / 55,03–59,83 MiB.
Heap azalması GC sonrası anlık gözlemdir; sızıntı testi veya zorlanmış GC yoktur.
Ölçüm penceresinde ayrı alt süreç gözlenmedi; bu yüzden parent ve süreç ağacı
RSS tepe toplamı eşit. Thread'ler parent RSS/CPU içindedir.

## Ayrı dar CRC/SHA profili

Üç taze sunucuda interaktif/health yükü kapalı; backup API aynı. V8 profiler
`create` çevresinde açılır. Pencere 30 ms timer yerleşmesini ve profiler
başlatma/durdurma overhead'ini de içerir; duvar süreleriyle bire bir eşit
değildir. Gecikme serisine katılmaz. Yüzdeler idle dahil örnekleme
penceresinin self-time payıdır, toplam süreç CPU'sunun kesin payı değildir.

| Profil | Örnekleme ms | Snapshot CRC ms | Validation CRC ms | CRC toplam % | SHA update ms | SHA % | Idle % |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 4171,78 | 1226,40 | 1067,09 | 54,98 | 324,02 | 7,77 | 15,72 |
| 2 | 4321,23 | 1660,57 | 1081,15 | 63,45 | 310,73 | 7,19 | 10,32 |
| 3 | 3981,21 | 1135,35 | 1123,36 | 56,73 | 337,76 | 8,48 | 13,73 |

CRC toplam self medyanı **2293,50 ms / %56,73**, SHA update self medyanı
**324,02 ms / %7,77**. Snapshot ve son doğrulama CRC'si ayrı ayrı anlamlıdır;
yalnız ZIP yazmayı taşımak snapshot CRC'sini ana thread'de bırakır.
Ham `.cpuprofile.gz` ve ancestry attribution her `profile-N/` dizinindedir.
Üçüncü profil öncesindeki tamamlanmış dosya cache'i admission müdahalesi
[yöntemde](README.md) açıkça kaydedilmiştir.

## Mevcut çözüm ve worker kararı

**[Doğrulandı]** `backup-archive.js` zaten 256 KiB stream chunk'ları,
async dosya I/O, kaynak boyut/mtime değişimi kontrolü, özel snapshot,
CRC/SHA/manifest doğrulaması ve final rename kullanıyor. Bütün backup'ın
senkron kilitlediği iddiası doğru değil. Mevcut GET yolu
`server.js:ensureComputedProjection` ile hazır gzip byte'larını doğrudan
aktarır; yetki/context/generation kontrolleri korunur. Bu yolları yeniden
uygulama önerisi yoktur.

**[Doğrulandı]** CRC, ana V8 thread'inin dar profilinde baskın. Buna rağmen bu
30000 satırlı sıcak GET iş yükünde health p95 medyanları 13,73/20,02 ms;
ölçülen en büyük health 136,27 ms ve event-loop gap 142,09 ms. Bunlar her
üretim ortamında yeterlilik kanıtı değildir; tanımlı bir ürün SLO'su verilmedi.

**[Bilinmiyor]** Aynı gerçek sunucuda bounded worker kuyruğunun bu gecikmeleri
ne kadar azaltacağı, snapshot/IPC/queue maliyetinin ve toplam arşiv süresinin
nasıl değişeceği ölçülmedi. Dolayısıyla **taşıma ertelenmeli**. İleride
yetkilendirilmiş bir worker deneyi yapılırsa aynı fixture, normal yetki,
snapshot/source-change/restore eşitliği, queue sınırları ve gerçek health +
GET sonuçları birlikte karşılaştırılmalı. Mevcut sayılar bu faydanın yerine
geçmez. Aktif kullanıcı yazması sırasında kaynak değişimiyle güvenli ret
pilotunda gözlendi; o ret, worker taşımasıyla kendiliğinden çözülmüş sayılmaz.

## Doğrulama ve teslim sınırı

- **14 test dosyası / 80 PASS, 0 FAIL/SKIP/CANCEL.** Mevcut backup,
  full-system-restore, user-restore, selective scope, shared-personal,
  legacy güvenlik ve compute-response testleri; #896'nın değişmemiş dokuz
  CRC/SHA/snapshot/iptal testi ve üç adapter testi.
- `i18n:check`: **yeni 0 / baseline 0**.
- [Komutlar ve exit code'lar](validation-v1.json), [test log'u](validation-v1-related-tests.log),
  [i18n log'u](validation-v1-i18n.log). Tam `npm test` çalıştırılmadı;
  üretim davranışına müdahale edilmedi, istenen ilgili paket çalıştırıldı.
- Eski ve yeni başarısız JSON/log/profiller korundu. İki izinli dizin
  dışındaki mevcut üretim, test ve benchmark dosyaları değişmedi.
- Normal push teslimi; PR, merge, rebase/force-push, bağımsız inceleme,
  TEST ve STABLE yayını yapılmadı.

EN: All six real-server latency runs and three separate narrow profiles passed
archive/restore correctness. 2,657 HTTP requests, zero failures. Median health
p95: 13.73 ms for backup-only and 20.02 ms with authorized interactive GET load.
CRC median sampled-window self share 56.73%; SHA update 7.77%. These are separate
load scenarios, not optimization results. Existing streamed backups and compressed
projection delivery already reduce work. Worker benefit on the real server remains
unproven, so integration is deferred. 80 tests passed; i18n new/baseline 0/0.
