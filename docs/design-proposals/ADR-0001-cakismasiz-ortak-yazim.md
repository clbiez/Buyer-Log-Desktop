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

## 7 · Aşama 0 uygulaması ve kabul kriterleri (performans ölçümünden ÖNCE yazıldı, 2026-11-26)

### Mekanizma

- **Yayım kapsama haritası (version vector, `heads`):** zarf, kurulum kimliği → o kurulumun bu kopyaya dahil son yayımının **içerik adresli** kimliği haritasını taşır. Sayaç yoktur: yedekten dönme veya yeniden kurulum bir sayacı geri sarıp yayımı sahte biçimde "kapsanmış" gösteremez. Girdi yalnız o yayımın üstüne (CAS veya üç yönlü birleşimle) kurulan zarfa aktarılır; birleşim uzak tarafın değişikliğini korur ya da çakışmaya alır. Harita kendi özetiyle doğrulanır; tutmazsa yok sayılır. Eski istemcilerin doğruladığı `sha256`/`chainSha256` değişmez; eski istemci haritayı düşürürse `parentSha256` zinciri kullanılır. Budama yoktur (boyut kurulum sayısıyla büyür, kurulum başına ~110 bayt).
- **İlk sürümdeki 32'lik soy listesi kaldırıldı:** 40 yayım sonrası, silinen satırı geri getiren bir gerileme ürettiği testle gösterildi.
- **Bekleyen yayım:** Yayım, onu kapsayan bir halef görülene kadar beklemede kalır; kendi dosyasını görmek onay değildir. Saklanan: ilk taban (tam kopya, yeniden adlandırma ile) ve yayım başına küçük değişiklik farkı (JSONL). Kapsanan yayımın tam tabanı ilk taban + farklarla kesin kurulur. Bekleyen zincirde yabancı birleşim olmaz, çünkü her yabancı birleşim kaydı temizler.
- **Kurulum kimliği:** Durum dosyasında kalıcıdır ve bilgisayar + kullanıcı parmak izine bağlıdır (`installation-fingerprint.js`). Kopyalanan veri klasörü yeni kimlik alır.

### Doğruluk kanıtı (veri bütünlüğü: eleme kriteri)

| Kriter | Sonuç |
| --- | --- |
| Mevcut Koleksiyon testleri | Ayrıca raporlanır |
| Sınır senaryoları: uzun çevrimdışı (40+ yayım), yarıda kalan yayım + yeniden başlatma, 3 cihaz + çakışan birleşimler, eski istemci, kimlik kalıcılığı, kopyalanan klasör, yeniden kurulum, yedekten eski durum, taban yazım hatası | Hepsi geçmeli |
| Rastgele bulut modeli, gerçekçi (eski tabanlı yükleme yerinden edilir), ≥100 seed | 0 sessiz kayıp, 0 çakışmaya düşen kayıp, 0 geri gelen silme, 0 yanlış silme, 0 yanlış çakışma, tam yakınsama |
| Rastgele bulut modeli, düşmanca (eski tabanlı yükleme %50 kazanır) | Düzeltme öncesine göre gerileme yok; kalan durumlar `todo` olarak belgelenir |

**Bilinen sınırlar:** (a) Sırasız teslim: daha yeni taban üzerine eski sürüm gelmesi. Bu sorun Aşama 0'dan önce de vardı. (b) Düşmanca bulutta oluşan kardeş dal. İkisi de tüm-belge + tek taban modelinde ortak ata bilinmediği için kapatılamaz. ADR-0003 kapsamında alan düzeyi nedensellik veya olay günlüğü araştırılır.

### Performans kabul kriterleri (L2)

- **Senaryolar:** 30.000 satır (~9,2 MB) zarf.
  - S1: tek satır düzenleme → yayım (uçtan uca).
  - S2: karşı cihazın benimsemesi (uçtan uca).
  - S3: 20 ardışık onaylanmamış yayımdan sonraki yayım (fark günlüğünün büyümesi).
  - S4: yerinden edilmiş birleşim (yeni yol; ana dalda karşılığı yok, çünkü ana dal bu durumda veri kaybediyordu).
- **Yöntem:** Aynı makine, Node ve veri. Ana dal (`df778c0`) ile aday dönüşümlü ≥5 çift; her koşuda 8 ölçüm, koşu medyanı alınır. Gürültü aralığı için aynı yöntemle ≥5 A/A çifti (ana dal ↔ ana dal). Ham örnekler kaydedilir.
- **Karar (S1–S3):** Aday−ana çift farklarının medyanı A/A çift farklarının [min, max] aralığındaysa **PASS**. Medyan A/A üst sınırını aşıyorsa ve çiftlerin çoğunluğunda tekrarlanıyorsa **FAIL**. Aksi durumda **BLOCKED**. Genel bir "izinli yavaşlama yüzdesi" yoktur.
- **Karar (S4):** Yeni yetenek. Bütçe, aynı veride normal üç yönlü birleşimin (S2'nin birleşimli varyantı) medyanı + fark uygulama süresi; ham değer raporlanır. 2 MiB üstü zarfta kira altı birleşim yapılmaması kuralı değişmez.
- **Bayt:** Zarf artışı yayım yapan kurulum başına ≤ ~200 bayt. Yayım başına ek yerel yazım: durum dosyası + tek fark satırı. İlk bekleyen yayımda yeniden adlandırma dışında tam kopya yazımı yoktur.
- **Öncelik:** Veri bütünlüğü kriterini geçmeyen aday, performans sonucundan bağımsız olarak elenir. Performans için bütünlük mekanizması zayıflatılmaz; ek state yazımı kira dışına ancak aynı kesinti testleri geçerse taşınır.

### Sonuçlar (2026-11-26, Linux container, Node 22; Windows/OneDrive gerçek ortamı ölçülmedi)

**Veri bütünlüğü.** Rastgele bulut modelinde, düzeltme öncesi (`df778c0`) ile aday karşılaştırıldı:

| Model | Sürüm | Seed | Düşen senaryo | Sessiz kayıp | Çakışmaya düşen kayıp | Geri gelen silme | Yanlış çakışma |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Gerçekçi | Düzeltme öncesi | 40 | 40 | 257 | 9 | 153 | 12 |
| Gerçekçi | Aday | 212 | 0 | 0 | 0 | 0 | 0 |
| Düşmanca | Düzeltme öncesi | 40 | 40 | 258 | 5 | 147 | 10 |
| Düşmanca | Aday | 40 | 4 | 2 | 3 | 3 | 4 |

Testin geliştirilmesi sırasında bulunup düzeltilen hatalar:
- 32'lik soy listesi, 40 yayım sonrası silinen satırı geri getiriyordu.
- İlk yayımda taban boş kaldığı için iki yönlü birleşime düşülüyordu.
- `_rev` eşit ama içeriği farklı satır farka girmiyordu.
- Yeniden yazım sırasında bir yardımcı fonksiyon yanlışlıkla silinmişti; mevcut izleyici testi yakaladı.

**Performans (L2).** 30k satır, 6 sıra-dönüşümlü çift + 6 A/A çifti, aday `0b37faceb85b`:

| Senaryo | Ana dal medyanı | Aday medyanı | Çift farkları (ms) | A/A aralığı | Kriter metnine göre | Yorum |
| --- | --- | --- | --- | --- | --- | --- |
| S1 yayım | 420,2 | 448,5 | +35, +114, +42, +63, +26, +14 (medyan +38) | [−38, +98] | PASS | **6/6 pozitif:** muhtemelen gerçek ~25–40 ms maliyet (fark hesabı) |
| S2 benimseme | 406,2 | 401,2 | medyan −10 | [−38, +51] | PASS | Gerileme yok |
| S3 20 yayım sonrası | 413,1 | 458,8 | +21, +46, +122, +24, +25, +10 (medyan +25) | [−52, +31] | PASS | **6/6 pozitif:** aynı maliyet |
| S4 yerinden edilmiş birleşim | 1668,8 | 1614,7 | medyan −54 | [−83, +81] | PASS | Ana dal bu yolda veri kaybediyor |

- İlk ölçüm turunda (optimizasyon öncesi) S1/S3 **FAIL** idi: +88 ve +116 ms, 5/5 çift A/A üstündeydi. Neden: fark hesabında satır başına `JSON.stringify`. Bunun yerine string üretmeyen tam eşitlik kullanıldı; `_rev`'e güvenilerek içerik karşılaştırması atlanmadı, çünkü atlamak bütünlüğü zayıflatırdı.
- **Dürüst değerlendirme:** Önceden yazılan kural ("medyan A/A [min, max] içinde") tek bir A/A aykırı değeriyle (+98) genişleyen aralık yüzünden gevşek kaldı. Çift farklarının işareti 6/6 pozitif. Bu yüzden S1/S3 sonucu "gerileme yok" diye sunulmaz: yayım başına yaklaşık +25–40 ms'lik (%6–9) muhtemel gerçek maliyet **BLOCKED / ürün kararı** olarak kayda geçer. Seçenekler: (a) bütünlüğün bedeli olarak kabul; (b) fark hesabını kira dışına veya worker'a taşımak (yeni kesinti testleriyle).
- **Bayt:** 2 kurulumlu zarfta +197 bayt (kriter: kurulum başına ≤ ~200).

## 8 · Kapsama haritasının garantileri ve sınırları

### Klasik version vector'den farkı

| | Klasik version vector | Buyer Log `heads` (Aşama 0) |
| --- | --- | --- |
| Değer | Kurulum başına monoton sayaç | Kurulumun bu kopyaya dahil son yayımının **içerik adresli kimliği** (`chainSha256`) |
| Sıralama | `VV1 ≤ VV2` karşılaştırması kısmi sırayı (ata/eşzamanlı) doğrudan verir | **Vermez.** İki farklı kimlik, hangisinin diğerini kapsadığını tek başına kanıtlamaz. |
| Sorduğu soru | "A, B'nin ardılı mı?" | Yalnız: "Bu kopya **benim son bekleyen yayımımı** kapsıyor mu?" (eşitlik testi) |
| Geri sarılma riski | Yedekten dönen veya yeniden kurulan kurulum sayacı tekrar kullanabilir; sahte "kapsandı" mümkün | Kimlik içerikten türer; aynı değer ancak aynı içerik ve ebeveynle oluşur |
| Nedenselliğin kaynağı | Veri yapısının kendisi | **Protokol değişmezi** (aşağıda); veri yapısı tek başına kanıt değildir |

### Protokol değişmezi (garantinin dayanağı)

- **D1.** `heads[k] = X` girdisi bir zarfa yalnız iki yolla girer: (a) k kurulumunun X yayımının kendisi; (b) `nextHeads(current)`, yani girdiyi taşıyan `current` zarfının üstüne CAS ile ya da üç yönlü birleşimle kurulan yeni zarf.
- **D2.** (b)'deki birleşim `current`'ın değişikliklerini ya korur ya da çakışma kaydına alır. Silme + eşzamanlı düzenlemede satır korunur ve bildirilir.
- **Sonuç:** `heads[k] = X` taşıyan her zarfın verisi X'in değişikliklerini içerir; ya da bunlar bilinçli bir çakışma çözümüyle, nedensel olarak sonraki bir yazımla veya bilinçli bir silmeyle geçersiz kılınmıştır. Bu garanti tümevarımsaldır ve D1–D2'ye uyan istemcilere bağlıdır.

### Garantinin geçerli olmadığı durumlar

- **Eski istemci:** Haritayı düşürür. Yerine geçen `parentSha256` yalnız bir adım geriyi gösterir; harita yeniden kurulana kadar bekleyen yayım temkinli tabana düşer. Kayıp oluşmaz, fazladan çakışma kaydı olabilir.
- **Kötü niyetli veya elle düzenlenmiş dosya:** `headsSha256` bir **imza değildir**, yalnız bozulmaya karşı özet denetimidir. Dosyayı yazabilen biri tutarlı sahte bir harita üretebilir. Bu tehdit modeli ortak klasöre yazma yetkisi olanları zaten güvenilir sayar; erişim güvenliği klasör izniyle sağlanır.
- **Sırasız teslim (daha yeni taban üzerine eski sürüm) ve düşmanca bulut (eski tabanlı yükleme kazanır):** İçerik kimliği sıralamaz ve tüm-belge birleşimi ortak atayı bilmez. Bu iki açık kapanmaz (`todo` testleri).
- **Geri gelen satır:** Silinip eşzamanlı düzenlenen ve geri gelen satırın silinme öncesi hâli taban olarak bilinmez, bu yüzden iki yönlü birleşir. Sonuç sessiz kayıp değil, çakışma kaydıdır (`todo`).

### Test kapsamı ≠ garanti kapsamı

| Test (2026-11-26) | Model | Sonuç |
| --- | --- | --- |
| Tek sahipli rastgele bulut | Gerçekçi, 252 seed | 0 ihlal |
| Nedensellik oracle'lı (aynı satır/alan, silme-düzenleme, kesinti, yeniden başlatma) | Gerçekçi, 120 seed | Kesin ihlal 0. Bilinen sınır: 120 seed'in 10'unda bildirilmiş (çakışma kaydında) durum. |
| Aynı | Düşmanca, 40 seed | 4 seed kesin ihlalli: 2 sessiz kayıp, 11 sessizce düşen yeni değer. Kardeş dal sınırı. |
| Düzeltme öncesi (`df778c0`), aynı oracle | Gerçekçi, 40 seed | 40/40 ihlalli: 111 sessiz kayıp, 376 sessizce düşen yeni değer, 32 silmenin yuttuğu düzenleme, 16 gereksiz geri gelme |

**Oracle değişiklikleri.** Oracle üç kez düzeltildi; üçü de izle gösterilmiş yanlış alarmlardı:
1. Silen cihazın gördüğü değer artık kayıp sayılmıyor.
2. Kaybeden ama bildirilmiş düzenleme, silmenin "yuttuğu" düzenleme sayılmıyor.
3. Üzerine yazılmış değerin düşmesi artık kayıp sayılmıyor; zincirin ucu ayrıca denetleniyor.

Her düzeltmeden sonra yeni seed kümesi koşuldu. Bağımsız incelemede oracle da denetlenir.

**Kapsanmayanlar:** Gerçek OneDrive istemci davranışı, Windows dosya kilitleri, saat kayması, yetki geri alma ile eşzamanlı birleşim, 3'ten fazla yazar cihaz, 30k satırlık rastgele senaryo.

## 9 · Aşama 0'ın bağımsız yayımlanabilirliği (değerlendirme; karar ürün sahibinde)

| Soru | Bulgu |
| --- | --- |
| Mevcut sürüme göre güvenli bir iyileştirme mi? | Ölçülen her bütünlük kategorisinde aday, düzeltme öncesinden iyi ya da eşit; gerileme görülen kategori yok. Bunun tek istisnası "çakışmaya düşen kayıp": sessiz kaybın yerini aldığı için sayısı artıyor; bu bilinçli bir takas. |
| Karma sürüm filosu (eski + yeni istemci) | Eski istemci yeni zarfı doğrular (sha/chain değişmedi; test). Yeni alanları düşürür, yeni istemci temkinli tabana düşer. Mevcut davranıştan kötü değil. |
| Geri dönüş (yeni sürümden eskiye) | Eski sürüm bekleyen-taban dosyalarını (`*.pending-first.json`, `*.pending-log.jsonl`) ve `heads`'i yok sayar. Dosyalar zararsız kalır. |
| Disk etkisi | İlk bekleyen yayımda taban dosyası yeniden adlandırılır (ek kopya yok). Yayım başına küçük bir JSONL satırı eklenir; onayla silinir. Onaysız tek kullanıcı senaryosunda günlük büyür (yayım başına ~satır boyu) [Muhtemel]; sınırı ölçülmedi. |
| Performans | Yayım +25–40 ms (%6–9). Ürün sahibi bütünlük bedeli olarak kabul etti. |
| Açık riskler | Sırasız teslim ve düşmanca bulut açıkları sürüyor ve düzeltme öncesinde de vardı. Gerçek OneDrive davranışı doğrulanmadı. Bağımsız ikinci model incelemesi ve tam `npm test` sonuçları ayrıca raporlanır. |
| Öneri | Yayımlanırsa "bilinen açıkları kapatan tam çözüm" değil, "ölçülmüş risk azaltma" olarak yayımlanmalı. Önce TEST kanalında iki gerçek Windows + OneDrive makinesiyle kısa bir ıslatma (soak) testi yapılmalı. |

## 10 · Bağımsız ikinci model incelemesi (2026-11-26) ve düzeltmeler

İnceleme farklı bir modelle, yalnız diff ve test üzerinden yapıldı. **§7–§8'deki iki iddia yanlış çıktı:**
- "Kapsanan yayım listede yoksa / zincir kırılırsa ilk tabana düşülür; bu temkinlidir, kayıp olmaz."
- "120 seed'de 0 ihlal." Testteki kesinti hiçbir zaman gerçek bir hub yazım hatası üretmediği için bu sonuç yazım hatalarını kapsamıyordu.

| # | Bulgu | Doğrulama | Düzeltme | Test |
| --- | --- | --- | --- | --- |
| F1 | Hub yazımı düşünce zincir kalıcı "kırık" sayılıyor ve eski ilk tabana düşülüyor; başka cihazın bilinçli geri alması (A→B→A) sessizce kayboluyor | İnceleme betiği bu oturumda yeniden üretildi [Doğrulandı] | Uzak kopya günlükte inmiş bir kayıtsa günlük oradan kesilip zincir sürer, değilse zincir uzak kopyadan yeniden başlar. İkisi de kesin: yayım yolunda uzak kopya CAS ile tabanımızdır, yabancı her birleşim kaydı zaten temizler. | `collection-sync-write-failures` F1, RED→GREEN |
| F4 | Taban dosyasının bekleyen ilk tabana taşınması düşünce hata yutuluyor; yerinden edilmede bekleyen silme geri geliyor | Yeniden üretildi [Doğrulandı] | Taşıma düşerse kopya yazılır; o da düşerse yayım iptal edilir. Dosya işlemleri durum güncellemesinden önce yapılır; taban okuması taşınmış dosyaya da bakar. | F4, RED→GREEN |
| F5a | Yarım yazılmış son günlük satırı, sonraki kayıtları erişilmez kılıyor | Kod okuması + test | Eklemeden önce yarım son satır kesilir; o satır yayımı inmemiş bir kayda aittir. | F5, RED→GREEN |
| F5b | Satır ekleme/silme farkı ~30k kimlikli tüm sıra dizisini taşıyor | Test | Sıra yalnız gerçek sıra değişiminde saklanır. | F5, RED→GREEN |
| F2 | Nedensellik testindeki "kesintili yayım" hedefi dizine çevirdiği için okumada düşüyor; bekleyen-kayıt yolunu hiç çalıştırmıyordu | İnceleme 40 seed'de 7 ihlal gösterdi | Kesinti artık gerçek hub yazım hatası (atomik yeniden adlandırmada `EIO`) | — |
| F3 | Oracle'ın silme denetiminde "üzerine yazılmış değer" muafiyeti yoktu; yanlış alarm veriyordu | Seed 26421 | Muafiyet eklendi | — |

**Düzeltme sonrası** (gerçek hub yazım hatasıyla):
- Nedensellik modeli, gerçekçi bulut, 120 seed (incelemenin ihlal bulduğu 26401–26440 aralığı dahil): kesin ihlal 0.
- Bilinen sınır (bildirilmiş, `todo`) 11/120 seed'de görülüyor.
- Düşmanca bulut, 40 seed: 4 seed kesin ihlalli (bilinen kardeş dal sınırı).
- Tek sahipli model: 292 seed, 0 ihlal.

**Hâlâ açık:**
- Rastgele üreteç benzersiz değer kullandığı için "eski değere geri alma" (A→B→A) üretemiyor; bu durum yalnız deterministik testlerle kapsanıyor.
- Tek kurulumlu kullanıcıda bekleyen kayıt hiç onaylanmıyor; günlük ve ilk taban dosyası birikir. Bir saklama politikası gerekir; şimdilik ölçülmedi.
- Bozuk (ortası yarım) günlükte ilk tabana düşülür ve bu kayıp üretebilir. Bu durum yalnız disk bozulmasında beklenir.
- Gerçek OneDrive davranışı doğrulanmadı.

### Son kod üzerinde L2 (aday `8b48377`, kaynak sha `2a8c2603a413`; 6 sıra-dönüşümlü çift + 6 A/A; sakin makine)

| Senaryo | Ana dal | Aday | Çift farkları (ms) | Medyan | A/A aralığı | Karar |
| --- | --- | --- | --- | --- | --- | --- |
| S1 yayım | 335,3 | 375,4 | +28, +32, +47, +52, +73, +40 | **+43,6 (+%13,0)** | [−18, +18] | **FAIL**: 6/6 çift A/A üstünde |
| S2 benimseme | 330,2 | 329,2 | +5, −29, −24, +8, +7, +3 | +4,2 | [−14, +13] | PASS |
| S3 20 ardışık yayım sonrası | 324,6 | 356,0 | +20, +30, +25, +32, +66, +52 | **+31,0 (+%9,6)** | [−24, +19] | **FAIL**: 6/6 |
| S4 yerinden edilmiş birleşim (yeni yol) | 1314,2 | 1408,6 | +113, +59, +78, +162, +186, +98 | **+105,5 (+%8,0)** | [−69, +53] | Bütçe aşıldı: 6/6 |

**Yorum:**
- Ürün sahibinin bütünlük bedeli olarak kabul ettiği aralık yayım başına 25–40 ms idi. Son ölçüm +44 ms ile bu aralığın biraz üstünde; karar ürün sahibinde.
- S4 ana dalda veri kaybettiren yol. İnceleme düzeltmelerinden sonra (taban günlükten kurulur, ek dosya okuma ve fark uygulama) +106 ms.
- Ürün sahibinin talimatı gereği bu maliyeti düşürmek için mekanizmaya yeni karmaşıklık eklenmedi.

## 11 · Performans istisnası (ürün sahibi kararı, 2026-11-26)

- **Karar kaydı:** S1 yayım **FAIL** (+43,6 ms, +%13,0) ve S3 **FAIL** (+31,0 ms, +%9,6) olarak kalır; önceden yazılmış kriter geriye dönük değiştirilmez.
- **İstisna:** Veri bütünlüğü kazanımı nedeniyle (gerçekçi modelde sessiz kayıp 111 → 0) gerekçeli ve **geçici** bir performans istisnası tanımlandı. Bu istisna merge, TEST veya STABLE onayı değildir.
- **Ayrı kayıt:** S4 yerinden edilmiş birleşim +105,5 ms (+%8,0). Ana dal bu yolda veri kaybediyordu.
- **İstisnanın bitişi:** Aşama 1 (değişmez olay günlüğü) tüm-belge yayımını kaldırdığında bu maliyetin kaynağı da kalkar; istisna o zaman kapanır. Bu süre içinde maliyeti düşürmek için mevcut mekanizmaya karmaşıklık eklenmez.

## 12 · TEST kanalı ve dayanıklılık (soak) testi kapsamı

### TEST kanalı mevcut kullanıcı verisinden yalıtılmış mı?

**Hayır.**
- **[Doğrulandı: source] (2026-11-26 düzeltmesi):** Veri kökleri kanala bağlı değildir. Masaüstü başlatıcısı (`electron/portable-paths.js`) arka uca veri köklerini **koşulsuz** olarak `<BuyerLog.exe klasörü>\data\…` biçiminde verir; dışarıdan verilen değişkenleri ezer. `server/lib/data-roots.js`'teki `%APPDATA%`/`%LOCALAPPDATA%` varsayılanı yalnız başlatıcısız çalıştırmada geçerlidir. Bu bölümün ilk sürümü bunu yanlış yazmıştı. Ortak klasör yapılandırılmış Shared Hub'dır.
- Bu nedenle yalıtım ortam değişkeniyle **masaüstü uygulamasında yapılamaz**. `tools/soak/` sunucuyu doğrudan, yalıtılmış köklerle çalıştırır. Paketlenmiş sürüm ayrıca çalıştırdığı kodun bütünlük denetimini yapar; kurulum kopyasına dal kodu koymak bu yüzden çalışmaz [Muhtemel; Windows'ta denenmedi].
- **[Muhtemel: dağıtım belgesi]** TEST sürümü aynı kurulumu yerinde günceller.
- Güncelleme deneme politikası (`electron/update/trial-backend.js`) yalnız güncellemenin hemen ardından, sürüm onaylanana kadar yazmaları durdurur; bu bir yalıtım değildir.

**Sonuç:** Aşama 0'ı TEST kanalına çıkarmak, gerçek Koleksiyon zarflarına `heads`/`headsSha256` alanlarını ve gerçek yerel veriye bekleyen-kayıt dosyalarını yazar. Eski istemci uyumu testle doğrulandı, ama karışık filoda temkinli tabana düşme olur. **Aşama 0 için ilk adım TEST kanalı değil, aşağıdaki yalıtılmış ortamdır.**

### Yalıtılmış dayanıklılık ortamı (öneri)

| Bileşen | Kurulum |
| --- | --- |
| Cihazlar | 2 gerçek Windows makinesi (tercihen farklı kullanıcı hesapları), her birinde OneDrive istemcisi |
| Uygulama | Dalın taşınabilir (portable) kopyası. Kurulu Buyer Log'a dokunulmaz, güncelleme kanalı kullanılmaz. |
| Veri kökleri | Her makinede ortam değişkenleriyle ayrı klasör: `BUYER_LOG_DATA_ROOT`, `BUYER_LOG_LOCAL_DATA_ROOT`, `BUYER_LOG_SERVER_DATA_ROOT`, `BUYER_LOG_CONFIG_PATH`, `BUYER_LOG_TEMP_ROOT` → `C:\BuyerLogSoak\<makine>\…` |
| Ortak klasör | Yalnız bu test için açılmış ayrı bir OneDrive klasörü (gerçek Shared Hub değil) |
| Veri | `scripts/generate-demo-data.js` ile sentetik/anonim veri. Gerçek iş verisi ve gerçek kullanıcı çalışma alanı yok. |
| Kimlik | Test kullanıcıları; gerçek hesap ya da credential yok |

### Senaryolar (her biri en az 3 kez)

1. Aynı Koleksiyonun farklı satırlarında ve aynı satırın farklı alanlarında eşzamanlı düzenleme.
2. Aynı alanda eşzamanlı düzenleme. Beklenen: önce yayımlanan kalır, diğeri çakışma kaydına düşer.
3. Bir cihazda OneDrive "duraklat" → iki tarafta düzenleme → "devam". Bu, gerçek `-PC` çakışma kopyası üretir; beklenen: kayıp yok, kopya sayısı ve çözüm kaydedilir.
4. Ağ kesintisi / uyku modu ve yeniden bağlanma; uzun çevrimdışı (≥40 yayım).
5. Yayım sırasında süreci sonlandırma (Görev Yöneticisi) → yeniden başlatma.
6. Hedef dosyayı başka bir uygulamayla kısa süre kilitleme (antivirüs/indeksleme benzeri) → yazım hatası yolu (F1/F4).
7. Silme + eşzamanlı düzenleme; silinip geri gelen satır.
8. Bir cihaz düzeltme öncesi sürümle, diğeri Aşama 0 ile (karışık filo).

### Ölçülecekler ve kabul

- Her cihaz düzenlemelerini benzersiz değerlerle yerel bir denetim günlüğüne yazar. Test sonunda nedensellik oracle'ı (`tests/collection-sync-causal-cloud-*` kuralları) bu günlüklere karşı çalıştırılır. **Kabul: 0 sessiz kayıp, 0 yanlış silme, 0 gereksiz geri gelme, tam yakınsama.**
- Toplanacak veriler: `-PC` kopya sayısı, çakışma kayıtları, bekleyen günlük boyutu, yayım süreleri, replikasyon izleri.
- **Durdurma ölçütü:** Tek bir sessiz kayıp ya da yakınsamama. Bu durumda test durur ve kök neden incelenir; Aşama 0 TEST kanalına çıkmaz.
- Süre önerisi: 2 iş günü etkin kullanım + 1 gece boşta.
- Bu test bu container'da çalıştırılamaz; kurulum ürün sahibinin onayı ve iki gerçek makine gerektirir.

## 13 · TEST kararı (ürün sahibi, 2026-11-26 gece)

- Ürün sahibi, gerçek Windows/OneDrive dayanıklılık testinin TEST'ten **önce** yapılması kuralını kaldırdı. Aşama 0, TEST 8.0.19 ile yayımlanır; gerçek ortam doğrulaması TEST kanalında yapılır.
- §11 performans istisnası aynen geçerlidir: S1/S3 **FAIL** kaydı korunur. TEST'e alınması ölçütün PASS sayıldığı anlamına gelmez.
- **STABLE ön koşulu:** TEST kullanıcılarında Koleksiyon senkronu gözlemlenir. Bakılacaklar: OneDrive `-PC` çakışma kopyası sonrası kayıp, Senkron çakışmaları listesi, bekleyen yayım günlükleri (`*.pending-log.jsonl`), açılış ve yayım süresi. Açıklanamayan tek bir kayıp STABLE'ı durdurur.
- `tools/soak/` (geliştirme dalında) isteğe bağlı olarak kullanılmaya devam eder; artık TEST için ön koşul değildir.

## 14 · STABLE kapısı ve geri dönüş koşulu (ürün sahibi, 2026-11-27)

- 8.0.20 TEST'te kalır. Aşama 0 için geri alma PR'ı açılmaz.
- **Windows tam regresyonunun geçmesi gerçek OneDrive senkron davranışının doğrulandığı anlamına gelmez.** §13'te kaldırılan ön koşul **STABLE için geri gelir**: STABLE'dan önce gerçek iki Windows cihazı + gerçek OneDrive ile çok cihazlı doğrulama yapılır (`tools/soak/` ya da TEST kullanıcılarında eşdeğer gözlem).
- Tek bir açıklanamayan veri kaybı STABLE terfisini engeller. Bilinen açıklar (düşman bulut modeli 4/40, sırasız teslim) ve §11 performans istisnası (S1/S3 FAIL) aynen geçerlidir.
- **Geri dönüş koşulu:** Gerçek bir kayıp görülürse geri dönüş, yeni mekanizmanın oluşturduğu bekleyen yayım kayıtları (`<owner>.pending-first.json`, `<owner>.pending-log.jsonl`) ve henüz yayımlanmamış kullanıcı değişiklikleri güvence altına alınmadan yapılmaz. Eski sürüm bu dosyaları tanımaz; önce bekleyen yayım tamamlanır ya da kayıtlar dışa aktarılır, sonra geri dönülür.
