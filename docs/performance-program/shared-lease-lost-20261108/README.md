# SHARED_LEASE_LOST — salt okunur teşhis / read-only diagnosis

**[Doğrulandı]** Tamamlanan yazma kapsamıyla bekleyen yenilemenin yarışı,
owner token/generation değişmeden `renew:failed / SHARED_LEASE_LOST`
üretebiliyor. Kontrollü küçük örnekte ACK verilen event diskten yeniden açıldı.
**[Bilinmiyor]** Bu mekanizmanın #900'deki üç tarihsel uyarının nedeni olup
olmadığı. Tarihsel gözlem ne veri kaybı ne zararsız yarış olarak kapatıldı.

EN: A controlled completion/renewal race emits the warning without ownership
transfer, while its acknowledged event reopens correctly. Historical causality
remains unknown. No production correctness fix or acceptance decision is made.

8 Kasım / November 2026, Linux x64. Dal / branch:
`diag/shared-lease-lost-20261108`. Yalnız yeni teşhis betikleri ve kanıtlar eklendi.
Üretim, mevcut test/assertion/validator, i18n baseline ve #900 prototipi/kanıtları
değişmedi. SQLite pilotu, migrasyon, ürün düzeltmesi, PR, merge, rebase,
force-push, bağımsız inceleme, TEST/STABLE yayını yapılmadı.

## Kaynak ve ortam / Sources and environment

- Main bazı: `1796193f0a57c7785e7bf9fdb3557e33c550b25e`.
- Tarihsel #900 head: `abc683e4bcc247a7e8e412c07532bc8059fe3adb`.
- Takip belgesi **bu tarihsel committen** `git show` ile okundu:
  `docs/performance/local-db-sqlite-2026-11-07/shared-lease-lost-follow-up.md`.
  Git blob: `0cb24693482729a753d81308e5a9893077056e6d`.
- Çalışma worktree'si: `/workspace/buyerlog-diag-shared-lease-lost-20261108`.
  Başlangıçtaki `/workspace/Buyer-Log-Desktop` worktree'si değiştirilmedi.
- Mevcut runtime'lar: Node **22.23.4** ve Node **24.19.0**. İncelenen yerel
  araç/cache/workspace konumlarında Electron 39.0.0 / Node 22.20.0 yoktu;
  indirilmedi. Node 22.23.4 bile tarihsel runtime'ın birebir tekrarı değildir.
  `process.versions` her koşunun manifestindedir; SQLite sürüm alanının runtime
  metadatasında bulunması SQLite kullanıldığı anlamına gelmez.
- İlk kapasite kontrolü: `/workspace` yaklaşık 30 GB, `/tmp` 8.8 GB boş;
  kullanılabilir bellek yaklaşık 16 GiB. Her koşu kilit altında kapasiteyi
  tekrar kontrol etti: 200k için en az 4 GiB disk ve 4 GiB boş bellek gerekti.
  Kapasite blocker'ı oluşmadı. Kimsenin dosyası veya kilit silinmedi.
- Bütün koşu/testler `flock -n -E 75
  /tmp/buyerlog-performance-measurement.lock` altında **seri** çalıştı.
  Her deneme yeni `/tmp/buyerlog-shared-lease-diag-*` sentetik veri kökü kullandı.
  Mevcut testler ayrıca `/tmp/buyerlog-shared-lease-tests-*` altında çalıştı.
  Gerçek veri, credential, gerçek servis veya SMB kullanılmadı.

Çalıştırılan dört çekirdek kaynak main ve #900'de **byte olarak aynı**:

| Kaynak / Source (`resources/app/server/lib/`) | SHA-256 |
| --- | --- |
| `local-db.js` | `0809943a3c4c46a62a80fc5f42d2f85709775c33863b99087ef1ebf4472d8141` |
| `shared-file-transaction.js` | `c97b75950ddd726ce58d73a256c0953a98987451d6165bb99112a0e93faa1881` |
| `durable-file-recovery.js` | `ae283d148821f117e43c206f54cb1d9f8deb6d071d298b6f45a5ecbf42fd0c62` |
| `lease-worker-registry.js` | `5adc794a1101671859a16c78a2e7fc55399551080286c995bb6343927627038d` |

## Koşular / Trials

Yeni iş yükü #900 prototipini import etmez veya yeniden kurmaz. 200k **event**,
50k kayıt, ID başına dört güncelleme; 20 × 10k batch, %80 markSynced, ardından
varsayılan compact kullanır. Üretim WAL eşikleri, fsync ve lease ayarları aynen
kalır. Sabit iş verisi saati lease'in gerçek `Date.now()`/timer'ını etkilemez.
Tarihsel olay dağılımı, mixed workload, platform ve crash benchmark'ı eşlenmedi.

| Deneme / Trial | Runtime | Müdahale / Perturbation | Uyarı | ACK → gerçek yeniden açılış / actual reopen |
| --- | --- | --- | ---: | --- |
| `node22-plain-200k-retry` | 22.23.4 | API sınırları dışında yok | 0 | 200,000 → 200,000 event; 50,000 kayıt |
| `node22-trace-200k` | 22.23.4 | Gözlem kancaları | 0 | 200,000 → 200,000 event; 50,000 kayıt |
| `node22-completion-race` | 22.23.4 | Callback ve yenileme-read kapısı | 1 | 1 → 1; owner değişmedi |
| `node22-contention` | 22.23.4 | İlk callback bekletildi | 0 | 2 → 2; ikinci süreç önce busy aldı |
| `node22-active-before-write` | 22.23.4 | Canlı owner dizini fixture tarafından taşındı | 0 | B: 1 → 1; A lease-lost reddi, WAL'a yazmadı |
| `node22-active-after-fsync` | 22.23.4 | WAL fsync sonrası owner dizini taşındı | 0 | B: 1 ACK + A: 1 **ACK'siz** event → 2 |
| `node24-plain-200k` | **24.19.0** | API sınırları dışında yok | 0 | 200,000 → 200,000 event; 50,000 kayıt |
| `node24-completion-race` | **24.19.0** | Callback ve yenileme-read kapısı | 1 | 1 → 1; owner değişmedi |

Sekiz senaryonun assertion'ları geçti. Beklenen busy/lease-lost reddi başarılı
işlem sayılmadı. Önce enstrümantasyonsuz Node 22 koşusu tamamlandı; sonra
gözlem kancalı koşu, kontroller, ayrı Node 24 koşuları ve mevcut testler koştu.
İlk sandbox başlatması ölçümden önce `spawnSync git EPERM` verdi; başarısız
[başlatma kaydı](node22-plain-200k/startup-failure.md) korundu. Ayrı adlı retry,
aynı kaynakla ve aynı kilitle sandbox dışında tamamlandı. Bu hata 200k koşu
veya SHARED_LEASE_LOST gözlemi sayılmadı.

## Aynı zaman çizelgesi / Correlated timeline

Tam kayıtlar acquisition token/generation, owner metadata publish/read/rename,
yenileme, callback kapanışı, yazma/fsync, bırakma, ACK ve fresh-process reopen
olaylarını içerir. `ns`, aynı Linux host monotonic saatidir; `wall` UTC'dir.
Pipe receipt zamanı emit zamanına eşit sayılmaz. Ayrıntı:
[timeline-excerpts.json](timeline-excerpts.json), ilgili `*.timeline.jsonl`.

Node 22 küçük tamamlanma yarışı, A sürecinin başlangıcından itibaren:

| Zaman / ms | Olay / Event |
| ---: | --- |
| 16.064 | Lease edinildi; token `89ed5de3-55e1-4ab7-9c2e-6cb28f302423`, generation 1 |
| 20026.943 | Gerçek varsayılan timer `renew()` çağırdı |
| 20028.366 | Aynı token/generation'ı okuyan yenileme-read dönüşü fixture'da bekletildi |
| 20033.953 | Gerçek WAL `sync()` tamamlandı |
| 20034.478 | Üretim callback'i tamamlandı |
| 20034.513 | Gerçek `finishOperation()` başladı; kapanan kapsam fence'i devrede |
| 20034.592 | Bekleyen read dönüşü serbest bırakıldı |
| 20034.831 | Yenileme `SHARED_LEASE_LOST` ile reddedildi |
| 20034.947 | Uyarı stdout'a yazıldı; yutulmadı |
| 20036.143 | `finishOperation()` aynı fiziksel owner'ı doğrulayarak tamamlandı |
| 20037.038 | `owner.json` yalnız kendi token'ı için silindi |
| 20037.274 | `diag-a-0` API ACK'i geldi; ayrı süreç event'i ve alanlarını doğruladı |

Kaynak mekanizması: `shared-file-transaction.js` 339–350'de
`assertOwnedAsync()` hem token/generation'ı hem finishing/completed scope'u
denetler. 392–404'te gerçek interval yenilemeyi başlatırken, callback kapanışı
scope'u tamamlanmış işaretler ve `finishOperation()` çağırır; sonra timer
kapatılır, yenileme drain edilir ve lease bırakılır. Bekleyen read devam
ettiğinde **scope kapanışı** fiziksel sahiplik değişimiyle aynı `lost()` kodunu
üretebilir. `local-db.js:807` WAL yazma öncesinde ve fsync sonrasında gerçek
sahiplik fence'lerini çalıştırır. Bu teşhis bu denetimleri atlamaz/değiştirmez.

Aktif kayıp kontrollerinde A canlıyken fixture lock dizinini ayrı bir konuma
taşıdı; B gerçek üretim acquisition yoluyla **yeni token ve generation 2** aldı.
Bu, protokolün canlı owner'ı kendiliğinden devralması değildir. A'nın eski
lease'i gerçek write fence'inde reddedildi. A'nın release'i B'nin owner'ını
silmedi; B henüz callback kapısındayken bu ayrıca assert edildi. WAL öncesinde
A'nın event'i yoktu. Fsync sonrasında A'nın event'i kalıcıydı fakat ACK yoktu;
A'nın cache'i de disk durumunu yeniden yükledi. B her iki kontrolde başarıyla
yazdı. Bu sonuç **ACK verilmiş veri kaybı değildir**; fsync ile API cevabı
arasındaki reddin geri alma garantisi olmadığını gösterir.

## Kanıt düzeyi ve sınır / Evidence level and limits

- **[Doğrulandı]** İki farklı durum ayrıldı: aynı owner ile kapsam tamamlanması
  sonrası yenileme reddi; aktif kapsamda token/generation değişimine karşı
  write fence reddi. İkinci durumun bu küçük kontrollerinde heartbeat henüz
  gelmediği için `renew:failed` yoktu; gerçek kayıp yalnız bu loga bakılarak
  aranamaz. İncelenen bütün kabul edilmiş event'ler ve iş alanları korundu.
- **[Doğrulandı]** Enstrümante 200k koşunun 23 lease kapsamındaki en uzun callback'i
  11,417.580 ms; ilk 20,000 ms heartbeat'e ulaşmadı. Enstrümantasyonsuz
  koşularda renewal metot sayısı doğrudan ölçülmedi. `summary.json` içindeki
  plain `leaseCount/renewalCalls = 0`, **gözlem kancası yok** anlamındadır.
- **[Muhtemel]** Gözlem kancalarının ek promise callback/JSON parsing/allocation
  maliyeti Node 22 trace koşusunun daha uzun ve daha yüksek RSS olmasına katkı
  yaptı: plain 113.315 s / 1.256 GB peak RSS; trace 140.200 s / 1.659 GB.
  Bunlar tek sıralı koşulardır; cache/sıra etkileri ayrıştırılmadı, bir hız
  benchmark'ı veya saf enstrümantasyon maliyeti tahmini değildir.
- **[Hipotez]** Aynı kaynakta kanıtlanan tamamlanma yarışı tarihsel üç uyarıyı
  açıklayabilir. Yeni 200k iş yüklerinin hiçbiri o uyarıyı doğal olarak üretmedi.
  Küçük örnek, tarihsel 200k koşunun birebir tekrarı sayılmaz.
- **[Bilinmiyor]** Tarihsel uyarıların hangi işlem/fsync/ACK sınırında olduğu,
  owner değişimi veya veri doğruluğu etkisi. Tarihsel raw.json uyarı stdout'unu
  saklamadığı için yeni küçük örnekle bu boşluk kapatılamaz. Exact Electron
  39.0.0 / Node 22.20.0, Windows/SMB ve gerçek üretim koşulları burada sınanmadı.
  Fsync dönüşü gözlendi; güç kesintisi dayanıklılığı iddia edilmez.

Yeni teşhis koşularında TTL 60,000 ms, heartbeat 20,000 ms ve acquisition timeout
3,000 ms üretim varsayılanlarıdır; lease kontrolleri değişmedi. Mevcut testlerin
kendi fixture ayarları da değiştirilmedi. Gözlem kancaları returned promise ve
throw'ları korur; fakat gözlem callback'leri ve tampon JSON ayrıştırması zamanlama
ve bellek davranışını etkiler. Küçük kontroller ayrıca açık I/O/callback
kapıları veya dış owner displacement uygular. Bunların etkisi doğal koşulardan
ayrı etiketlendi. Uyarı çıktısı açık bırakıldı.

## Kanıtlar ve doğrulama / Evidence and validation

- [summary.json](summary.json): sekiz koşunun özeti.
- [ack-reopen.json](ack-reopen.json): gerçek ACK sayısı ile izin verilen
  ACK'siz kalıcı event'lerin ayrı karşılaştırması; event-ID hash eşitliği.
- Her koşuda `manifest.json`, config/exit JSON, tam `*.stdout.log` ve
  `*.stderr.log`, base64 byte kayıtları `*.streams.jsonl`, `*.timeline.jsonl`.
  Üretim uyarıları doğrudan stdout loglarında saklandı. `.log` dosyaları repo
  ignore kuralına rağmen **yalnız izinli kanıt dizininde** açıkça eklendi.
- **Ham şema notu:** `verify.result.json.acceptedEvents`, oracle'a verilen
  beklenen kalıcı kümenin büyüklüğüdür. `active-after-fsync` için 2'nin yalnızca
  **1'i ACK almıştır**. Doğru ACK kaynağı `manifest.accepted` veya
  `ack-reopen.json.acknowledgedCount` alanıdır. Ham alanlar yeniden yazılmadı.
- [disk-evidence.json](disk-evidence.json): silinmeyen sentetik disk dosyalarının
  SHA-256/byte/inode/yol kaydı. Büyük DB'ler Git'e kopyalanmadı; `/tmp` ömrü bu
  ortamın ömrüyle sınırlıdır. Git'teki stdout/timeline/oracle/hash kanıtları kalır.
- [integrity.json](integrity.json), [SHA256SUMS](SHA256SUMS): çekirdek/harness
  pinleri ve stream'lerden byte-byte yeniden oluşturulan stdout/stderr eşitliği.
  İlk paketleyicinin manifest şema hatası ve başarısız çıktısı
  [seal-v1-failure.md](seal-v1-failure.md) içinde korundu; v2 yalnız veri kökü
  seçimini düzeltti, bütün doğrulama assertion'larını korudu.
- [targeted-tests.tap](targeted-tests.tap): Node 22.23.4 ile mevcut **109/109**
  test geçti, fail/skip/cancel 0. Altı lease dosyası, yedi local-db
  business/compaction/crash/HLC/WAL dosyası, agent sözleşmesi ve i18n guard.
  Tam liste/komut `validate.sh` içindedir. Mevcut testler değiştirilmedi.
- [i18n.stdout.log](i18n.stdout.log): `npm run i18n:check`, **yeni 0 / eski 0**.
  `tests/fixtures/i18n-coverage-baseline.json` byte olarak değişmedi, `files: {}`.
- Timeline oracle sekiz koşuda geçti; betiklerin syntax kontrolleri geçti.
  Tam `npm test` ve CI çalıştırılmadı. Yerel hedefli testler tam regresyon veya
  nihai kabul yerine geçmez; üretim kodu değişmediği bu teslimde merge yoktur.

## Tekrar ve ana sohbete devir / Replay and handoff

Betik sözleşmesi ve komutlar:
[scripts README](../../../scripts/prototypes/shared-lease-lost-20261108/README.md).
Bu checkout'un mevcut kanıt etiketleri üzerine yazılmaz; her tekrar yeni etiket
ve yeni sentetik veri kökü kullanmalıdır. Eski runtime kullanılabilir hale
gelirse **yeni bir etiketle** aynı dar senaryo denenebilir; bu yine #900 exact
iş yükü tekrarı sayılmaz.

```sh
git show abc683e4bcc247a7e8e412c07532bc8059fe3adb:docs/performance/local-db-sqlite-2026-11-07/shared-lease-lost-follow-up.md

DIAG_NODE=/workspace/.buyerlog-tools/node_modules/node/bin/node \
  bash scripts/prototypes/shared-lease-lost-20261108/run.sh \
  replay-node22-plain-200k 200000 plain

flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  /workspace/.buyerlog-tools/node_modules/node/bin/node \
  scripts/prototypes/shared-lease-lost-20261108/scenarios.cjs \
  replay-node22-completion-race completion-race

DIAG_NODE=node bash scripts/prototypes/shared-lease-lost-20261108/run.sh \
  replay-node24-plain-200k 200000 plain
```

Bu sandbox'ta Node alt süreç başlatması EPERM verdiğinden başarılı komutlar
onaylanan sandbox dışı yürütmede aynı flock/sentetik köklerle çalıştı.
Çalıştırma kaydı ve yeni deneme verisi dışında ortam/ürün ayarı değiştirilmedi.

**Ana sohbet kararı:** Üretim doğruluk ihlali doğrulanmadı; burada uygulanacak
bir üretim düzeltmesi yok. Tamamlanma yarışının gösterilmesi tarihsel bulguyu
kapatmak için yeterli değildir. Daha sonra ürün değişikliği değerlendirilirse
en dar aday, kapanan scope nedeniyle yenileme reddini fiziksel token/generation
uyuşmazlığından neden bilgisiyle ayırmaktır; uyarıyı genel olarak yutmak veya
lease fence'ini gevşetmek değildir. Bu yalnız öneri, doğrulanmış düzeltme değildir.
Gelecekteki düzeltme/kabul ana sohbette kalır; gerçek owner kaybı, detached write
fencing ve fsync sonrası ACK belirsizliği regression kapsamı korunmalıdır.
