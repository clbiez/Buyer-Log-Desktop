# ADR-0001 · Çakışmasız ortak yazım: tek yazarlı, değişmez olaylar

- **Durum:** Öneri. Kod değişikliği yok; uygulama aşamaları ayrı PR'lar olacak.
- **Tarih:** 2026-11-26
- **Öncelik (ürün sahibi):** 1) çakışma ve veri kaybı, 2) hız
- **Risk sınıfı:** Uygulama aşamaları **P1** (çok kullanıcılı veri tutarlılığı ve senkron). Her aşamada bağımsız ikinci model incelemesi değerlendirilir; performans kademesi **L2**.

## 1 · Bağlam: kanıt

| Bulgu | Kanıt düzeyi | Kaynak |
| --- | --- | --- |
| Ayrı OneDrive aynalarında aynı Koleksiyonu aynı anda yayımlayan iki cihazdan birinin düzenlemesi, çakışma kaydı bile bırakmadan kayboluyor. | **[Doğrulandı]**: 2026-11-26'da `npm test -- collection-sync-multi-device` koşuldu; `todo` testi `displaced edit must survive or be reported as a conflict` iddiasında düşüyor (13 pass, 1 todo-fail). | `tests/collection-sync-multi-device-v20261125.test.js:407` |
| Kök neden: zarfta yalnız tek bir `parentSha256` var. Kaybeden cihaz kendi yerinden edilmiş yayımını birleşim tabanı sayıyor ve kendi düzenlemesini "zaten tabanda" kabul ediyor. | **[Doğrulandı]** (source) | `server/lib/collection-replication.js:47-48, 679-681`; testin açıklama bloğu |
| Koleksiyon workspace'i, Koleksiyon izinleri, `model-images/revision.json`, `content-index` shard'ları, `personal-backups` ve birden fazla Moderatör cihazının master/business head'i **çok yazarlı değiştirilebilir dosyalar**. Kira (`write-lock`) OneDrive'ın ayrı yerel kopyalarında karşılıklı dışlama sağlamıyor. | **[Muhtemel]**: repo dokümanı ve source referansları; her satır ayrı ayrı canlı test edilmedi | `docs/ai/SHARED_FOLDER_WRITERS.md`; `server/lib/shared-file-transaction.js` |
| Sipariş ve genel sync zaten doğru desende: cihaz başına namespace (`changes/<device>/`), değişmez `.ready`/`.sync.gz` paketleri ve HLC sıralı olaylar. | **[Doğrulandı]** (source) | `server/lib/sync-settings.js`, `server/lib/hlc.js`, `server/lib/local-db.js:27` |
| Koleksiyon verisi genel delta yolundan bilinçli olarak çıkarıldı, çünkü izin farkındalığı olmayan genel sync emekli havuzu geri getirebiliyordu. | **[Doğrulandı]** (source yorumu) | `server/lib/collection-replication.js:1-20` |
| Yerel DB tek JSON zarfı ama sıcak yol için zaten append-only WAL'a sahip (50.000 satırda küçük yazım 207 ms olarak ölçülmüş ve WAL ile çözülmüş). | **[Doğrulandı]** (source yorumu; ölçüm bu ADR'de tekrarlanmadı) | `server/lib/local-db.js:452-478` |
| Sunucu Electron'un Node'u ile çalışıyor (`ELECTRON_RUN_AS_NODE`, Electron 44.3.0). Bu container'daki Node 22'de `node:sqlite` var ama deneysel uyarı veriyor. | **[Doğrulandı]** container için; Electron 44'ün Node'unda durumu **[Bilinmiyor]** | `electron/backend.js:7, 294`; `version` |

**Sonuç:** Sorun yeni bir mimari eksikliği değil. Uygulamada zaten doğru çalışan desen (tek yazarlı, değişmez, HLC sıralı olaylar) çok yazarlı dosyalara uygulanmamış. Kira bu dosyalarda yalnız SMB'de koruma sağlıyor.

## 2 · Karar

Ortak klasöre yazılan her iş verisi şu dört kurala uyar:

1. **Tek fiziksel yazar.** Bir dosyayı yalnız adını taşıyan cihaz (`<deviceId>`) yazar. Hesap veya rol, cihaz yerine geçmez.
2. **Değişmezlik.** Yayımlanan olay ve paket dosyalarının üzerine yazılmaz; yalnız yenileri eklenir. Değiştirilebilir "head" dosyası ya hiç yoktur ya da yalnız tek yazarlı bir işaretçidir; doğruluk ona bağlı değildir.
3. **Deterministik birleşim.** Aynı olay kümesini gören her cihaz aynı durumu üretir. Sıralama HLC artı `deviceId` eşitlik kırıcısıyla yapılır. Aynı alana eşzamanlı yazımda kaybeden değer **her zaman** çakışma kaydı olarak kalır.
4. **Yetki birleşimde denetlenir.** Bir olay, yazarının o olayın HLC anındaki yetkisine göre kabul ya da ret edilir. Yetki değişikliği de HLC'li bir olaydır. Böylece "geri alınan düzenleyicinin çevrimdışı yazısı yayımlanmaz" kuralı korunur.

Kilit/kira bu modelde doğruluk aracı olmaktan çıkar. Yalnız aynı cihazdaki süreçleri sıraya koymak ve gereksiz işi önlemek için kalabilir.

## 3 · Aşamalar

Her aşama ayrı PR'dır. Bir aşamanın kapısı geçmeden bir sonrakine başlanmaz.

### Aşama 0 · Sızıntıyı kapat (küçük, hemen)

Amaç, bilinen veri kaybını mevcut zarf protokolü içinde kapatmak.

- Zarfa sınırlı bir **soy zinciri** eklenir (son N `envelopeIdentity`, öneri N=32). Eski alanlar korunur, eski sürüm okuyucular etkilenmez.
- Cihaz, son yayımladığı kimliğin uzak zincirde olmadığını görürse yayımının yerinden edildiğini anlar. Bu durumda birleşim tabanı olarak kendi yayımını değil, **yayımdan önceki tabanı** kullanır. Bunun için yerel durumda bir önceki taban saklanır.
- Kabul: `todo` testi normal teste çevrilir ve geçer; mevcut 13 senaryo geçmeye devam eder; büyük zarfta (≥2 MiB) davranış ve kira süresi gerilemez (L2).

Bu aşama protokolü değiştirmez, yalnız kaybı **çakışma olarak görünür** kılar. Daha fazla bekleme gerektirmeyen bir veri kaybı düzeltmesidir.

### Aşama 1 · Koleksiyon için cihaz başına olay günlüğü (gölge mod)

- Yeni yol: `BUYER_LOG_SYNC/collection-ops/v1/<owner>/<device>/<seq>-<id>.ops.gz`. Her dosya o cihazın satır/alan değişikliklerini HLC ile taşır.
- Mevcut zarf yayımı **aynen sürer**. Olay günlüğü paralel yazılır; her cihaz günlükten durumu katlar (fold) ve sonucu zarf durumuyla karşılaştırıp farkı yalnız tanılama olarak kaydeder.
- Sahip cihaz periyodik olarak değişmez bir checkpoint (`checkpoints/<hlc>-<digest>.json.gz`) yayımlar. Checkpoint bir hızlandırıcıdır, doğruluk kaynağı değildir.
- Kabul: 20 cihazlı simülasyonda (mevcut `tests/helpers/collection-sync-sim.js`) ve OneDrive ayna senaryolarında fold sonucu her turda deterministik ve kayıpsız. Gölge farkı demo/test verisinde sıfır. Polling başına ek okuma, yazma ve süre ölçülmüş ve bütçe içinde (L2).

### Aşama 2 · Geçiş (cut-over)

- Gölge mod TEST kanalında en az bir sürüm boyunca sıfır farkla çalıştıktan sonra okuma kaynağı fold sonucuna çevrilir. Zarf, eski sürümler için bir süre üretilmeye devam eder (yalnız sahip cihaz yazar).
- Geri dönüş: bayrakla zarf okumaya dönülebilir; olay günlüğü silinmez.

### Aşama 3 · Desenin yayılması (risk sırasına göre)

| Hedef | Önerilen dönüşüm | Not |
| --- | --- | --- |
| `collection-permissions/v1.json` | Cihaz/aktör namespace'li, değişmez grant/revoke olayları | Aşama 1'deki "yetki birleşimde" kuralının ön koşulu; Aşama 1 ile birlikte tasarlanmalı |
| `model-images/revision.json` | Global sayaç yerine HLC + `deviceId` | Mevcut ownership/ordering sözleşmesi korunur |
| `personal-backups/.../<user>_<saniye>.zip`, `latest.json` | Dosya adına `deviceId` + benzersiz ek; cihaz başına `latest` | Küçük; Aşama 0 ile birlikte yapılabilir |
| Birden fazla Moderatör cihazı → master/business head, `order-access.json` | Hub başına açık yayıncı `deviceId` ve devralma (takeover) olayı | Ürün kararı gerekir (§5) |
| `content-index` shard'ları | Cihaz başına sınırlı index + okuma birleşimi | Mevcut dosya sayısı kazanımı korunmalı |

### Aşama 4 · Hız (öncelik 2)

Doğruluk aşamaları bitmeden ve ölçüm yapılmadan hız işi yapılmaz.

- Önce ölçüm: 30k fixture ile başlangıç, Koleksiyon açılışı, senkron turu ve yerel DB compaction süreleri.
- Yerel DB'yi SQLite'a taşımak yalnız ölçüm, darboğazın JSON anlık görüntü/compaction olduğunu gösterirse değerlendirilir. Ön koşul: Electron 44'ün Node'unda `node:sqlite` durumunun doğrulanması. Yerel bağımlılık (`better-sqlite3`) portable ve bağımlılıksız kurulum ilkesiyle çatışır.
- Olay günlüğü modeli hız için de yararlıdır: senkron turu tüm zarfı okumak yerine yalnız yeni olay dosyalarını okur. Bu bir **[Hipotez]** olarak kalır ve Aşama 1'de ölçülür.

## 4 · Reddedilen alternatifler

- **Toptan yeniden yazım:** Mevcut 13 çok cihazlı senaryo ve yıllar içinde biriken kenar durumları tek seferde yeniden kanıtlanamaz.
- **Merkezi sunucu/veritabanı:** Ürünün yerel öncelikli ve ortak klasör tabanlı dağıtım modelini değiştirir; altyapı ve yetki kararı gerektirir. Bu ADR kapsamı dışında.
- **Daha güçlü kilit (ör. lock dosyasında yeniden deneme, daha uzun kira):** OneDrive ayrı yerel kopyalarında hiçbir kilit karşılıklı dışlama sağlayamaz. Sorunu küçültür, kapatmaz.
- **OneDrive `-PC` çakışma kopyalarını birleşim girdisi olarak okumak:** Sağlayıcı davranışına bağlıdır, her zaman oluşmaz. Tanılama için kalabilir, doğruluk aracı olamaz.
- **Koleksiyonu genel delta yoluna geri almak:** İzin farkındalığı olmadığı için bilinçli olarak emekli edildi (§1).

## 5 · Ürün sahibinin vermesi gereken kararlar

1. **Aynı alana eşzamanlı yazımda kazanan:** Bugün "ilk yayımlanan" kazanıyor. Ayrı OneDrive aynalarında "ilk yayımlanan" tanımsızdır. Öneri: HLC'si **sonra** olan değer kazanır ve diğer değer her zaman çakışma kaydına düşer. Alternatif olarak HLC'si önce olan kazanır, bu da bugünkü davranışa en yakın olanıdır. İkisi de deterministiktir; tercih iş kuralıdır.
2. **Birden fazla Moderatör cihazı:** Hub başına tek yayıncı cihaz ve açık devralma mı olacak, yoksa her Moderatör cihazı kendi checkpoint'ini yayımlayıp okuyucular birleştirecek mi?
3. **Eski sürüm desteği süresi:** Zarf üretimi kaç sürüm boyunca sürecek?

## 6 · Kabul ölçütü (genel)

- Bilinen her çok yazarlı yol için ayrı OneDrive ayna simülasyonu: düzenleme ya korunur ya da çakışma olarak raporlanır. Sessiz kayıp sıfır.
- Mevcut senkron, yetki geri alma ve bozuk dosya senaryoları geçmeye devam eder.
- L2 performans: senkron turu, Koleksiyon açılışı ve büyük zarf yayımında gerileme yok.
- `tests/fixtures/i18n-coverage-baseline.json` boş kalır. Kullanıcıya görünen çakışma metinleri TR/EN birlikte eklenir.
