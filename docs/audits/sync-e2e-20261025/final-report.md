# Buyer Log — SYNC, eşzamanlı kullanım ve veri sağlığı denetimi

**İstenen 50 aktif kullanıcı + moderatör / 30 dakika hedefi sertifikalanamadı:** 8 GiB ortam, kademeli artışta bellek sınırına ulaştı. Daha düşük sayıda koşu bu hedefin yerine geçirilmedi. Gerçek uygulamada **6 aktif kullanıcı + ek moderatör, 6 backend/6 bağımsız yerel veri kökü ile 30 dakika** tamamlandı. Sınanan kalıcı veri/istemci/cold uzlaştırmalarında fark, karşılaştırılabilen hesaplamalarda hata bulunmadı. **19 kapsam içi ürün düzeltmesi** ve hedefli regresyonlar teslim edildi. Son tam regresyon kapsamı (ilk komutun hatası ve hedefli tamamlaması aşağıda açıklanır) **1,133 dosya / 7,978 test: 7,913 başarılı, 65 atlama, 0 hata** (ayraçlar binliktir). Atlamalar başarı sayılmadı.

Son üretim kodunu içeren doğrulama kaynağı `f2ff5a347ffefad2d52446df83ac2d9594b309a7`; uzun koşunun kaynağı `7e7b137d9419b937071a864aac1e1f8a00516331`. Son kaynak, uzun koşudan sonra bulunan yalnız SSE reload yetki düzeltmesini ayrıca içerir. Bu fark [source-scope-final-load.json](source-scope-final-load.json) ve aşağıdaki hedefli yeniden doğrulamayla açıkça ayrılır.

Bu raporda kısa senaryolar, tarihî kanıtlar ve yeni uzun koşu ayrı tutulur. **50 bağımsız aktif kullanıcı ve ek moderatörle 30 dakika hedefi ancak gerçekten tamamlanırsa geçti sayılır.** Gerçek SMB/OneDrive bulunmadığından sağlayıcı doğrulaması uygulanamaz. TEST/STABLE yayını bu görevin parçası değildir.

## Kaynak ve ortam

Referans main `4a70aa152d1b4eb3279ddebda19679ca2639b372` ve eski full kaynağı `62e9f4a7b65d6eae3b6e2fc85d48c194db6972c9` için aynı uygulama ağacı `5868505035e00bace8a1307198156010c9be3d71` doğrulandı. En son çalışma dalına alınan main `1c1602fb369b90ea6c15d1915d4b07a909cc4594` (7.0.311). Son upstream delta release metadata/arşivleri ve görsel kabulün yayın kapısı yerine danışma çıktısı olmasıyla ilgilidir; SYNC runtime değişmedi. Daha önceki birleşimlerde ilgili görsel test fixture farkları da devralındı. Birleşimde daha güçlü görsel kaynak/assertion zincirleri ve gerçek workbook yardımcısı korundu; ilgili hedefli kontroller geçti. Referansla dosya farkları [final-main-comparison.json](final-main-comparison.json), devralma kararları [inheritance.json](inheritance.json), eski scoped kaynak karşılaştırması ve son değişen sınırlar [source-scope-sharing-recovery.json](source-scope-sharing-recovery.json) içindedir. Bu kaynak karşılaştırması UI davranışının tümünü değişmemiş ilan etmez.

Yük koşusundan önceki üretim düzeltmesi `8ae86179`: odaklı editör korunurken otomatik kural alanlarının güncel kalması ve birleştirme sonrası paylaşım hatasının doğru bildirilip yeniden denenmesi. Yük dizisinin önceki entegrasyonu `dd6ea5c8b31ebe71b338c7ab1ea4f02ae2f527b2`; ilk görünür-toplam denetimli yük kaynağı `4c237664d67746c2ee0d3ab3e8d4ba6510d01eaa`; atomik sürücüyle son yük kaynağı `7e7b137d` (tam SHA manifestte). Önceki paylaşım düzeltmesi `67235e32`, bildirim/status düzeltmeleri `af9ee418` içindedir. Daha sonraki yalnız audit/manuel sürücü commit'leri üretim değişikliği değildir; her koşunun gerçek kaynak ve dirty bilgisi manifestinde saklanır.

Linux, Node 24.19, UTC; cgroup 2 CPU / 8 GiB. Seed `20261025`. Playwright 1.62.0 ve gerçek Chromium 151.0.7922.173 kullanıldı; sürücünün beklediği 151.0.7922.34 ile aynı build dalında, farklı patch'tedir. [environment-final.json](environment-final.json) ve her koşudaki `browser-environment.json` ayrıntıları saklar. İlk 1.57/151 uyumsuz koşuların kanıtları korunur; uyumsuzluğun bütün timeout'ların nedeni olduğu iddia edilmez. Eski eşleşen browser indirmesi ağ politikasıyla 403 reddedildi; politika aşılmadı.

Önceki 7.799-test sertifikası, 10 cihaz/20.000 işlem simülasyonu ve büyük Electron benchmarkları tarihî kapsamdır; başlangıçta alışkanlık olarak tekrarlanmadı, yeni 50 kullanıcı sonucu olarak sunulmadı. Tarihî “pending/PR open/full çalışmadı” ifadeleri güncel durum kabul edilmedi. UI değiştiği için eski masaüstü benchmarkları güncel performans sertifikası değildir.

## Gerçek topoloji ve kabul sınırı

Her kullanıcı ayrı BrowserContext, oturum ve browser storage kullanır. Aynı kullanıcının iki sekmesi aynı context içinde ayrıca sınanır. Ek moderatör ayrı context'tir. Gerçek masaüstü topolojisi bağımsız yerel Express backend/veri kökleri, HTTP/SSE ve dosya tabanlı Shared Hub'dır. Mantıksal replika sayısı açılan bağımsız kalıcı veri köklerinin sayısıdır; fiziksel makine ve disk sayısı birdir. Browser context, backend ve replika sayıları her koşuda ayrı raporlanır.

Tüm hesaplar ve veriler sentetiktir. Ayrı server/local/auth/temp/config kökleri kullanıldı; kişisel kurulum değiştirilmedi. Yerel sentetik hub, gerçek SMB/UNC/OneDrive sağlayıcısı değildir. SQL havuzu, WebSocket veya tenant yapısı eklenmedi. Office COM bu SYNC işinin önkoşulu yapılmadı.

1. Ham input gönderilmemiş düzenlemedir. Browser taslağı yalnız bu tarayıcıdaki kurtarma kopyasıdır.
2. Worker dosya lease'i altında güncel yetki ve CAS kontrolünü, atomik yerel yazımı tamamladığında yerel kabul üretir. HTTP 200 tek başına kabul değildir; `applied` ve `conflicts` ayrılır.
3. `replication` makbuzu paylaşım durumudur. Başka backend'in veriyi alması ve gerçek istemci DOM'unda göstermesi ayrıca doğrulanır.
4. Soğuk backend açılışı kalıcılık kanıtıdır. Güç kaybı, fiziksel disk donanımı ve gerçek ağ sağlayıcısının dayanıklılığı ölçülmedi.

Aynı backend satır CAS uygular; farklı alanlar olsa da bayat satır açıkça reddedilebilir. Kişisel alandaki mevcut yerel-delta rebase korunur. Backend'ler son ortak tabandan alan bazında birleşir; aynı alan yarışında yayımlanmış uzak değer korunur ve kaybeden değer Sync Conflicts'e ayrılır. Ret alan paylaşılan satır özgün CAS'ını korur; otomatik kural yenilemesi reddi sessizce kabule çeviremez. Silinen eski satırdaki edit create olarak diriltilmez.

## Senaryo bazında kapsam

Aşağıdaki “geçti” ifadeleri yalnız belirtilen kısa native senaryoya aittir. Yeni uzun koşunun tamamında 50 kullanıcıyla bu senaryoların geçtiği anlamına gelmez. Kaynaklar ve özgün sonuç dosyaları [scenario-evidence.json](scenario-evidence.json) ve [engineering-notes.md](engineering-notes.md) içindedir.

| Senaryo | Durum | Gerçek doğrulama ve sınır |
|---|---|---|
| 50 kullanıcı + moderatör / 30 dakika | Çalıştırılamadı — ortam kapasitesi | 50 hedefli ramp bellek guard’ında durdu: son açılan 10 context/backend/kök; yalnız 9 kullanıcı UI tamamladı, ölçüm başlamadı. |
| 6 kullanıcı + moderatör / 30 dakika | Geçti — belirtilen kaynakta alt kapsam | 6 backend/kök, tüm 30 dakika altı aktif kullanıcı; son SSE filtresi ayrı final native testte doğrulandı. |
| A — günlük çalışma | Hedefli kontroller geçti | UI edit, hesaplama, filtre; kişisel UI create/delete. Ortak alanda UI create/delete → peer DOM → tek recycle kaydı → cold2 (`bl-final-shared-crud`). Uzun yük ayrıca raporlanır. |
| B — eşzamanlı değişiklik | Hedefli kontroller geçti | Aynı alan, farklı alan, silme-kayıt, eski GET/satır, aynı context'te iki sekme; native backend'ler arası alan birleşimi. Son UI farklı-alan bariyeri `bl-final-cross-fields`; pull/base/CAS yarışları ayrı RED/GREEN. |
| C — moderatör | Hedefli kontroller geçti; izlenebilirlik sınırı açık | Gerçek UI lisans/transit/XLSX FX; hesaplamadan önce, sürerken ve kayıttan önce bariyerler; manuel FX/fiyat korunması. İki moderatör kontrolü iki kimliği doğrulanmış HTTP istemcisidir; iki moderatör UI tıklaması değildir. |
| D — kopma/yeniden deneme | Seçili kontroller geçti | Gönderim öncesi offline, gerçek request gövdesi sırasında kesme, kalıcı kabul sonrası gerçek yanıt kaybı, refresh/sekme, cookie kaybı, gerçek HMAC verifier saatini +13 saat ilerleterek PATCH/SSE401. Gerçek 12 saat beklenmedi; global exactly-once iddiası yok. |
| D — paylaşım yayını toparlanması | Geçti | Gerçek yerel EISDIR → native kabul + paylaşım bekliyor → aynı envelope geri gelir → peer DOM 1.008s → origin rozeti → cold2 (`bl-sharing-pending-green`). Gerçek SMB değildir. |
| E — erişim ve izolasyon | Hedefli kontroller ve son SSE regresyonu geçti | Aktif grant iptali, açık bağlantı/reconnect, gerçek lease arkasındaki bekleyen yazının 403 reddi, owner izolasyonu. Son native SSE kontrolünde yabancı owner olayı ve revoke sonrası veri olayı sıfır; ilgili revoke invalidation teslim edilir. Tenant yapısı yoktur. |
| F — kilit/toparlanma | Hedefli kontroller geçti; UI bulgusu ayrıca açık | Tutulan lease ≥700ms; ilgisiz owner 63ms. Gerçek watchdog child SIGKILL, ACK kaybı, peer DOM toparlanması 9.369s/backend kesintisi 3.939s. İç kuyruk telemetrisi ölçülmüş gibi sunulmaz. |
| Gerçek SMB/OneDrive sağlayıcısı | Uygulanamaz | Ortamda gerçek ağ paylaşımı yok. |
| SQL havuzu / WebSocket / tenant | Uygulanamaz | Ürün bunları kullanmıyor; karşılıkları dosya lease'i, HTTP/SSE ve owner/grant sınırıdır. |

Temel native kanıt kökleri: `bl-controlled-1`, `bl-controlled-extra-6`, `bl-controlled-extra-7`, `bl-current-interactions`, `bl-final-blocking-revoke`, `bl-active-watchdog-restart-3`, `bl-final-transit`, `bl-session-expiry-2`, `bl-manual-fx-price`, `bl-rejected-retry-green`, `bl-shared-recovery-ui-guarded`. Eski kontrol yalnız ilgili kaynak/yapılandırma/kapsam değişmediyse devralındı. Değişen save, queue/pull, edit ve feedback sınırları hedefli native kontroller ve son full ile yeniden ele alındı. Olası bütün protokol tekrar/sıra kombinasyonları tüketilmiş değildir.

## Önemli bulgular ve düzeltmeler

Her satırdaki RED/GREEN kanıtı ve etkilenen sınırın ayrıntısı [engineering-notes.md](engineering-notes.md) içindedir. Başarısız özgün veriler düzeltme sonrası başarılı veriyle değiştirilmedi.

| Bulgu / etkilenen sınır | Küçük tekrar ve gerçekleşen davranış | Kök neden ve düzeltme | Regresyon / kanıt |
|---|---|---|---|
| P0 — silinmiş satırın dirilmesi | A okur, B siler, A eski kaydı save eder; ret yerine create olur | Missing edit/create ayrılmıyordu. Expected-existing/new intent ve legacy pozitif-rev koruması; açık row-missing/row-exists | deleted-stale RED/GREEN; worker/full ve native delete-before-stale-save |
| P0 — iptal edilmiş yetkiyle bekleyen yazı | Gerçek lease arkasında PATCH bekler; moderator erişimi kaldırır; eski kod 200 verir | Yetki yalnız kuyruğa girmeden okunuyordu. Worker lease sonrasında ve commit öncesi güncel actor/grant/credential denetimi | revocation native RED 200/GREEN 403; blocking-revoke; son worker kaynakları/full |
| P0 — geç GET yeni kabulü geri alır | Temiz GET başlar, edit+ACK olur, eski GET gelir ve tekrar kaydedilir | Owner/revision/baseline/dirty/save/focus guard; bayat yanıt atılır, sınırlı taze okuma; SSE rev gerilemez | late-read RED/GREEN, current-interactions, full |
| P0 — offline taslağın sürüm/niyet kaybı | Offline edit + peer delete/add + refresh; eski taslak yeni kabul sürümüne bağlanır veya render tarafından ezilir | Schema2 özgün baseline+intent; yalnız yerel delta restore; remote-only ekleme korunur; restore render'dan önce; doğru başlangıç scope'u | review-offline-ui-8, pending-draft testleri/full |
| P1 — metin normalizasyonundan yanlış conflict | Başka cihazın boş/eksik text alanı ile UI'nin boş string'i sahte değişiklik sayılır | Yalnız canonical text/code alanlarında absent/null/empty eşdeğerliği; finans/nested değerler korunur | empty-text RED/GREEN, farklı-alan native merge, coedit/full |
| P1 — alınmış dosya açık UI'ye bildirilmez | GET remote dosyayı poll'dan önce alır; dosyada kayıt varken peer DOM'unda yoktur | Uygulama sınırında onApplied→SSE; poll'daki çift bildirim kaldırıldı | shared-crud RED/GREEN ve son kaynakta final-shared-crud |
| P1 — uzak güncelleme editörü koparır | A yazarken B başka satırı kaydeder; A input DOM'dan çıkar/focus kaybolur | Model/baseline güncel kalır; görsel render aktif editör bitene kadar birleştirilir; ham input ayrı editing durumu | remote-editor RED/GREEN; davranış VM/full; uzun gerçek UI |
| P1 — blur sırasında tıklamanın yutulması | Pointerdown sonrası 350 ms tutulurken focusout hedef düğmeyi kaldırır | Pointer yaşam döngüsü boyunca görsel yenileme ertelenir; pointerup/cancel ve click sonrasında flush | gerçek pointer-refresh RED/GREEN + trace/PNG; focusout VM/full |
| P0 — kabul edilmiş yazıyı eski pull ezer | 2 backend bariyeri: eski pull okur, native PATCH commit eder, publish bekler, pull eski dosyayı yazar; sonra PATCH 200/applied | Replace lease altında expectedSha256 ile tekrar denetlenir; kesilen import stamp'i tüketilmez | native accepted-pull-race RED/GREEN; queue sonrasında aynı kontrol; full |
| P0 — eski envelope ile yeni merge base karışır | Pull state read'de beklerken aynı owner publish base'i ilerletir; eski GET yeni kabul edilmiş alanı geri alır | Aynı owner'ın sync/publish işlemleri sıralanır; başka owner bağımsız ilerler; nested publish internal kalır | accepted-base-race RED/GREEN; bağımsız-owner queue unit/full |
| P0 — açık ret daha sonra otomatik kabul olur | A'nın RACE-A kaydı kabul, B'nin RACE-B'si ret; moderator fiyat yenilemesi B'nin eski satırını fresh rev ile tekrar kabul ettirir | Shared ret sırasında baseline tek başına ilerletiliyordu. Artık özgün CAS korunur; own-area gerçek delta rebase aynı kalır | native rejected-retry RED/GREEN; exact-request oracle; 56 hedefli test/full |
| P1 — yanlış “kaydedildi” rozeti | applied:[]/row-revision reddi sonrasında uzak olay badge'i “bu cihazda kaydedildi” yapar; browser taslağı da aynı görünür | Editing, draft, sending, native kabul, sharing-pending, conflict/failed ayrıldı; ret/failed uzak olayda korunur; TR/EN | feedback RED/GREEN, gerçek native ret sonrası UI, full; incelenmiş PNG |
| P1 — odaklı ekranda gereksiz GET döngüsü | Temiz fakat odaklı editor yenilemeyi reddeder; her 200 ms tam GET | Focusout'a kadar owner flag; boş tam GET polling'i durur | 1.100 ms odakta 0 GET, focusout sonrası gerçek GET; VM/full |

Düzeltme sırasında test araçları da ayrıştırıldı: kaynakla uyumsuz XLSX 0.18.5 kurulumu lock'taki 0.20.3 ile düzeltildi; generator üreticileri gerçek `{name,email}` şemasına alındı; eski başlık/KPI VM fixture'ları güncel sözleşmeye uyarlandı; driver satırı sticky footer altına bırakmadan ortalayarak normal tıklar. Framework retry, force click veya deadline artırımıyla hata gizlenmedi.

## Finansal doğruluk, sürüm ve açık iş kararı

BL-017 finans sözleşmeleri ve mevcut `financial-contract-vectors.json` esas alındı. TR ara maliyet iki ondalığa yuvarlandıktan sonra çarpılır; YD ara maliyet yuvarlanmadan çarpılır. FX tam ay → önceki ay → ilk ay fallback'i korunur; yeni expiry eşiği icat edilmedi. Manuel kur/fiyatlar otomatik kaynak değişiminden korunur. Mevcut vektörler sıfır/fractional royalty, 1.005/24.925 sınırları, geçersiz royalty, eksik FX ve takvim/timezone sınırlarını son full'de kapsar. Native CP transit sonucu ayrıca bağımsız UTC takvim hesabıyla sınandı.

Koleksiyonun otomatik alanları mevcut render/kural yenilemesi yolunda yeniden hesaplanır. Hesaplama anındaki gerçek rule/FX girdileri, rule ID, ayrı kaynak revizyonları ve geçerlilik tarihleri journal'da saklanıp bağımsız aritmetikle karşılaştırılır. Kaynakların revision numaralarının aynı olması beklenmez. Belgede olmayan global financial transaction/snapshot sınırı eklenmedi.

**Matematik sonucu**, **izlenebilirlik eksikliği** ve **iş kuralı kararı** ayrıdır:

- Sayısal örneklem sonuçları final ölçüm tablosunda verilir.
- Kalıcı satırdaki `_pricingRuleId`, geçmişte kullanılan bütün rule/FX sürümlerinin değişmez tarihçesi değildir. Anlık lineage/ham kaynak örnekleri kullanılan mevcut girdileri kanıtlar; her eski kalıcı sonucun tarihî hesap tarifini ürünün tek başına geri kurduğu iddia edilmez. Bilinmeyen sürümler doldurulmadı.
- Mevcut license-peer sözleşmesi, daha yeni Master içeriği sonrasında eski peer içeriğini geri uygulayabilir. Bu davranışı mevcut test açıkça beklediğinden kaynak önceliği politikası sessizce değiştirilmedi. Kullanıcıya sorulan “Master mı/peer mi/causal precedence mı” kararı yanıtsız kaldı. Manuel sync turlarıyla yakınsama, bu açık ürün kararını çözmüş sayılmaz.

## Ek önemli düzeltmeler

| Bulgu | Küçük tekrar / beklenen ve gerçekleşen | Düzeltme ve kanıt |
|---|---|---|
| Ret sonrası kullanıcı taslağından çıkış | Ret alan taslak otomatik kabul edilmemeli; kullanıcı açıkça sunucudakini seçebilmelidir. İptal/ağ hatası/yeni input/owner-rev değişiminde taslak korunmalı. | TR/EN native confirm; gerçek ve geçerli GET sonrası eşzamanlı apply öncesinde temizleme. Native2user/1backend iptal → EN etiket → kabul → yeni yazı; guard regresyonları/full. |
| P1 — status çizim maliyeti | Her hücrenin her seçeneği bütün alanı tarıyordu: eski kaynakla 50 satırda 750 row-aware çağrı/1454ms. | Render-local güncel katalog, renk ve etiket snapshot'ı:1 çağrı/3.45ms, aynı HTML hash. TR/EN/custom/freshness regresyonları. Bu tüm uygulama benchmarkı değildir. Native50row paint552ms, filtre49DOMrow1162ms, clear50row1089ms. |
| P1 — bildirim sonsuz döngüsü | Dört bildirimin biri animasyonla kapanırken beşinci gelir; closed öğe DOM'da kaldığı için eviction while ilerlemez. Gerçek paused stack/profile315s notify/26s showToast. | Immediate close kapanan öğeyi de kaldırır; no-op hook durumunda eviction ilerlemesi korunur. RED3fail→GREEN3; gerçek native queue cap4 ve sonraki UI edit/native kabul geçti. Eski timeout'ların tamamının bu neden olduğu kanıtlanmadı. |
| P1 — bekleyen yayının toparlanmaması; birleştirme hatası | Gerçek EISDIR sonrası yerel kabul doğru; aynı dosya restore edilince mtime+size cache poll'u atlar, peer eski kalır. Yerel veri kaybolmaz. | Başarısız publication stamp'i invalidate eder; mevcut canlı poll normal izin/CAS/owner kuyruğuyla tekrar dener. Gerçek retry-publication olayı origin UI'yi de günceller. RED actual-fs unit; replication/coedit/trial kontrolleri; native2/2+peerDOM+originbadge+cold2. Birleştirme sırasında I/O hatası da ayrı actual-fs RED/GREEN testinde doğrulandı: hata makbuzu `ok:false/state:error/publicationPending` taşır ve poll başarısız stamp’i tüketmez. |
| P1 — odak korunurken eski otomatik maliyet | Aynı pricing20/FX3/row39 ile çekmece6,09, güncel yüklenmiş kurala göre5,93 bekleniyordu. Finans motoru doğruydu; remote paint ertelenirken otomatik royalty27 eski kalmıştı. | Gerçek2context/1backend, yalnız gerçek yanıt bekletilerek6,09 RED; aktif DOM’u değiştirmeden mevcut automatic-rule helper’ları veri üzerinde çalıştırınca5,93 GREEN. Raw incoming baseline/CAS ayrı korunur. Native same-field ret/auto-price RACE-A korunması, farklı-alan birleşimi ve manuel FX/fiyat kontrolleri geçti. |

## Test aracına ait bulgular

- Eski kaybolmuş-ACK oracle'ı, upstream kayıtta request UUID bulunmadığı için op29 gerçekten kalıcı/DOM'da iken op21 bekledi. Özgün failed sonuç korunur. Tek gerçek body/user/target eşleşmesiyle ek `oracle-correction.json`,6 durable/cold ve3 DOM farkının0 olduğunu gösterir. Yeni kayıt özgün request/session UUID taşır; belirsiz eşleşme tahmin edilmez.
- Explicit app retry artık ilk işlem kimliğini korur. Tarihî offline op119 gerçek native request UUID/body ve row3 conflict makbuzuyla açık ret olarak çözüldü; kayıp kabul sayılmadı. Önceki derived analysis dosyaları ayrı korunur.
- Native Fetch unsafe6697/6566 portları uygulama açılış hatası değildi. Yeni sürecin SERVER_READY/dinlemesi vardı; Fetch bad-port reddi ayrı kanıtlandı. Güvenli7320–7369 ve açık `TEST_HTTP_UNSAFE_PORT` ayrımı kullanılır; ağ politikası değiştirilmedi. Özgün failed port koşusu ve cold resume kayıtları durur.
- Manuel sürücüde tekil UI/evaluate ve tüm action için bounded watchdog vardır; timeout'lar ürün SLO'su değildir. Framework retry0, force click yoktur. Uygulamanın gerçek retry'ları ve kullanıcının açık sunucu-verisini-yükle seçimi ayrı kaydedilir. Başarı, hesaplama veya kalıcı kabul taklit edilmez.
- Events-only trace varsayılandır; snapshots/screenshots içeren ağır trace ölçümü etkileyebilir. Bütün timeout'ların bundan kaynaklandığı kanıtlanmadı. Hata sonrası gerçek paused stack/PNG/profile korunur. İlk kesilmiş `bl-drawer-trace-6` sonuçsuz/interrupted'dır; sonraki yeni root eski kanıtı ezmez.

## Açık panel bulgusu ve önceki başarısız uzun koşular

Son UI kaynakta `bl-final-status-feedback-6`,6 kullanıcı+ek moderatör/6backend ile dört tam dakika aktif kaldı. Op142/userIndex4/row5 için gerçek click döndü fakat `.cpdDrawer`30s görünmedi. Aynı owner/modelop141 ve temiz save bayrakları önce/sonra korunuyordu. Hata anında CPU düşüktü; donanım sınırı tek neden diye açıklanamaz. Ekrandaki hover preview yalnız textContent idi; interaktif buton kopyası değildi. Kök neden henüz kanıtlanmadı; yeni kaynakta paneli düzelttiğini iddia eden bir değişiklik yapılmadı.

2context/2backend35hesaplamalı kısa tanı ve6user+mod/6backend5dakikalık olay izli kontrol (`bl-drawer-trace-6-resumed`) bu hatayı üretmedi. İkincide her dakika6aktif kullanıcı,180UIgrubu ve durable/actualDOM/cold6 farkı0 vardı. Bu, eski başarısız30dakikalık koşunun sonucunu değiştirmez. Son yeni uzun koşu aşağıda ayrıca verilir. İlk tamamlanan30dakika (`bl-final-sharing-recovery-6`) backend/kalıcılık bakımından geçtiği halde, bağımsız gerçek-DOM denetiminde1/212 maliyet örneği uyumsuz çıktı. Özgün driver `result.json` değiştirilmedi; `final-run-disposition.json` genel sonucu **failed-independent-visible-oracle** olarak kaydeder. Bu koşu nihai başarı değildir; küçük native RED/GREEN sonrası etkilenen uzun koşu tekrarlandı.

Daha eski8user/8backend koşusu21tam dakika;6user/6backend koşusu26tam dakika sonra UI timeout ile durdu. Hiçbiri30dakika geçişi değildir. Cold recovery'de son kabul edilmiş model intent'leri korunmuştu; bu sınırlı model kontrolü başarısız koşuların bütün ilişkiler için tam uzlaştırma sertifikası değildir. Bütün özgün journal/failure/screenshot/recovery dosyaları saklanır.


## Önceki tam paket: korunmuş başarısız komut ve kapsam tamamlama

Kaynak `dd6ea5c8`: **1.132 dosya /7.971 benzersiz test;7.906 başarılı,65 atlama,0 çözülmemiş assertion hatası.** Tam paket sırasında tarayıcı yükü çalışmadı;concurrency2,frameworkretry0. Atlamalar başarı değildir ve isimleri ayrı dosyadadır.

İlk standart komut900dosyaya ulaştı. `refresh-pipeline-perf-v251` alt süreci assertion/heap exception üretmeden sonlandı; aynı aralıkta cgroup `oom_kill`2→3 arttı. Kesin eşzamanlı tahsis/victim kimliği spec log’dan kanıtlanamaz. Değişmemiş8testli dosya standard runner ile tek başına9,9s/573MiB konteyner tepe kullanımı ve0yeniOOM ile geçti. Ardından henüz ulaşılmamış232dosya aynı standard runner/assertion/env ile74,7s’de tamamlandı. Önceki900yeniden başlatılmadı. Runner artık bu worker fixture’ını ayrı çalıştırır; veri/assertion/deadline azaltılmadı.

Dört önceden geçmiş partialcase ve Node’un sentetik file-fail vakası çift sayımdan çıkarıldı. Özgün failed komut korunur: bu **tek komutta temiz full** değildir. [Completion](final-full-suite-deferred-projection-completion.json), [ilk komut](final-full-suite-deferred-projection.log), [izole kontrol](refresh-pipeline-isolated.log), [bellek kanıtı](refresh-pipeline-isolated-result.json), [kalan232](final-full-suite-deferred-projection-remaining.log), [65atlama](final-full-suite-deferred-projection-skips.txt). Önceki temiz7.966-test koşusu yalnız eski kaynağı sertifikalandırır.

## Bağımsız muhasebe ve yorum kuralları

Her UI intent benzersiz işlem kimliği; gerçek request ayrı UUID/session/user/backend taşır. `submitted`, native `applied/conflicts`, kaybolan gerçek ACK, UI badge/draft, gerçek peer DOM ve soğuk dosya ayrı kayıtlardır. Aynı işlem için native request gövdesindeki hedef alan/değer kabul makbuzuyla eşleştirilir; yalnız op etiketi veya HTTP200 kabul sayılmaz. Yerel kabul belirsizse native kalıcı durum araştırılır.

Uzlaştırma yalnız sayım değildir: hedef model alanları, seed’de sabit kalan lisans/ülke/üretici/fiyat/tarih/owner ilişkileri, unique ID’ler, controlled conflict alanı, tüm replika canonical içeriği, gerçek DOM ve cold reopen kontrol edilir. Final recovery/GET bir origin kaybını onarmadan önce raw workspace dosyaları saklanır; model intent’leri ve seed alanları bu pre-quiescence dosyalarda ayrıca denetlenir.

Bir başka backend’in eski model değerini içeren bulk row body’sinin `applied` makbuzu, modelin yeni bir kullanıcı kararıyla değiştirildiği anlamına gelmez. Üç yönlü birleşimin gerçek makbuzu, yerel önceki görünüm ve pre-import/final dosyalar birlikte incelenir. Sonraki meşru güncelleme ve açık ret, açıklamasız kabul kaybından ayrılır. Eski koşudaki böyle bir gövde gerçek `replication.merged:true` ile yeni kanonik modeli korudu; sırf gövdede eski değer var diye kayıp ilan edilmedi.

Hesaplama oracle’ı backend/helper sonucuyla yetinmez; gerçek paneldeki iki toplam ve kaynak etiketlerini kaydeder. Aynı gözlenen row/pricing/FX sürümlerinde görünen iki ondalık sayı, mevcut BL-017 formülünden bağımsız hesaplanan sayıyla karşılaştırılır. Farklı gözlenen row sürümü tek başına matematik hatası veya global snapshot ihlali sayılmaz; karşılaştırılamayan örnekler ayrıca sayılır. Farklı kaynakların sayısal sürümlerinin birbirine eşit olması beklenmez.

Görünürlük gecikmesi ilk farklı backend’de gerçek DOM gözlemidir; tüm peer’lerin teslim gecikmesine eşit değildir. Odaklı editörü koruyan görsel erteleme ve observer aralığı dahildir. Son yakınsamada kullanıcı normal şekilde editörden tabloya odaklanır; driver veri reload zorlamaz. Ürün SLO’su bulunmayan ölçümlere yeni geçti/kaldı eşiği eklenmedi.

Kaynak ölçümleri driver/backend/application-renderer/browser-driver olarak ayrılır. RSS paylaşılan sayfaları çift sayabilir; CPU/disk farkları yalnız örneklenen yaşam aralığını kapsar. Browser HTTP byte sayıları açık SSE/setup trafiğini ve process bazında ağ ayrımını kapsamaz. Outstanding browser HTTP sayısı iç kilit kuyruğu değildir. Yardımcı CLI/profiling etkisi ve2CPU/8GiB ortamı nedeniyle sayılar üretim kapasite garantisi değildir.

## Yük öncesi sürücü düzeltmesi ve önceki kapsamın devralınması

4c237664 kaynaklı tekrar11.dakikada `op-20261025-405` için kirli/taslak gözlemiyle durdu. Gerçek kullanıcı değişikliği hata kaydından47msönce native `applied` almıştı; sonraki tanıda `saveTimer:true` ve594mssonra yeni otomatik pricing isteği,608mssonra açık CAS retleri vardı. Bu, quietwait ile ayrı evaluate arasındaki sürücü yarışıydı. Cold6 kökte son kabul edilen model intent’leri korundu. Özgün failure ve ayrı `final-run-disposition.json` saklanır;11dakika başka koşunun süresine eklenmez.

`B.settle` tek browserturn’ünde değişmez durum görüntüsü yakalar. Terminal olmayan kirli taslak, aynı45s sınırında beklenir; açık conflict/failed aynen döner; kalıcı kirli durum timeout olur. Veri yeniden gönderilmez, frameworkretry eklenmez. Sonuç okuması30s ve handle temizliği3s ile ayrıca sınırlıdır. Üç yeni regresyon eklendi. Önceki bounded log’un 6/6 diye özetlenmesi yanlıştı; log parse hatası içeriyordu. Final paket bunu yakaladı ve fixture parantezi düzeltildikten sonra gerçek standart hedefli kontrol 6/6 geçti. Gerçek2user+mod/2backend35s kısa kontrol51UIgrubu ve origin/durable/actualDOM/cold2fark0 ile geçti.

Bu değişiklik ürün koduna dokunmadı. Önceki coverage kaydının bu aşamayı 7974/7909/65 diye sertifikalaması son test dosyasının gerçek sonucuyla uyuşmuyordu. [Kayıt düzeltmesi](coverage-record-correction.json) eski JSON’u ve başarısız bounded log’u açıkça ilişkilendirir. Geçerli güncel sayım, final paketin özgün hatası + düzeltilmiş fixture için [gerçek 6/6 kontrol](settle-oracle-syntax-final.log) + kalan üç dosyanın sonucu üzerinden [tamamlama kaydında](final-full-suite-sse-isolation-completion.json) verilir.

## Nihai 30 dakikalık koşu: sınanmış altı kullanıcı kapsamı

Kök `/workspace/scratch/bl-final-atomic-settle-6`. Seed `20261025`. Ölçüm **2026-10-27 00:34:54.908–01:04:54.908 UTC**; ramp/ısınma dahil değil. Son işlemlerin bitmesi ve taslakların açık kararla ele alınması için ek drain **13.206 saniye**. Her 30 dakikalık pencerede altı kullanıcı gerçek UI işlemi tamamladı: [dakika/kullanıcı CSV](final-minute-activity.csv). Ek moderatör ayrı BrowserContext’tir. Aynı fiziksel Linux makine/disk üzerinde altı native backend ve altı bağımsız veri kökü/logical replica vardır; gerçek SMB veya altı fiziksel cihaz değildir. Ortak fixture altı modeldir; 50-ramp fixture’ı 50 modeldi.

| Ölçüm | Sonuç |
|---|---|
| Ölçüm içindeki tamamlanan UI işlem grupları | **1.046**: 633 edit, 211 hesaplama, 159 liste/filtre, 5 create/delete, 2 controlled-conflict, 36 moderatör güncellemesi |
| Moderatör | 12 lisans/royalty, 12 transit, 12 gerçek XLSX FX güncellemesi |
| Bağımsız makbuz sınıflaması | 535 kabul, 141 açık ret, 370 kayıt yazmayan tamamlanmış işlem; belirsiz/gönderilmemiş 0 |
| UI/sürücü hatası; page error | 0; 0 |
| Kabul edilmiş editin UI sonuç gecikmesi, p50/p95/p99 | **642 / 2.859 / 8.630 ms**, 492 örnek |
| Hesaplama UI gecikmesi, p50/p95/p99 | **931 / 2.891 / 4.505 ms** |
| İlk farklı backend’de gerçek DOM görünürlüğü, p50/p95/p99 | **3.589 / 13.477 / 23.718 ms**, 492 kabul edilmiş örnek |
| Uygulamanın gerçek yeniden denemesi | 2; framework otomatik tekrarı 0 |
| Satır CAS retleri | Tüm journal’da 850 row-revision satır makbuzu; mantıksal ret sayısıyla aynı değildir. Ölçümde 141 işlem açıkça reddedildi |
| Yanlış yerel-kayıt başarısı; reddedilen intent’in peer’de görülmesi | 0; 0 |
| Yinelenen request UUID; sınanan arşiv çift yan etkisi | 0; 0. Bu global exactly-once kanıtı değildir |
| Outstanding browser Collection request | Tepe 4; sonda 0. Bu iç kilit kuyruğu sayacı değildir |
| Ham bağımsız aritmetik | 218 örnek, 0 yanlış kontrol |
| Gerçek panel toplamı + aynı kaynak sürümleri | **212 geçti**; gözlenen kaynak sürümleri farklı 6 örnek karşılaştırılamadı, başarılı sayılmadı |
| Pre-import seed/owner/ID/ilişki/fiyat alanı farkı | 6 dosyada 0 |
| Son kabul edilmiş kullanıcı model intent’i | 6/6 eşleşti; origin pre-import farkı 0 |
| Tam canonical replika, gerçek istemci görünümü, soğuk yeniden açılış | Fark 0; 0; cold 6/6 tam içerik korundu |

Save ölçümü UI’den kabul sonucu görülene kadardır; yalnız server CPU süresi değildir. Görünürlük ilk farklı backend gözlemidir; bütün cihazların aynı anda teslim gecikmesi değildir. Ürün hedefi bulunmadığından bu sayılara uydurma SLO eklenmedi. İstemci son durumu beklemeleri sınırlı ve her kontrol için 30 saniyeydi; atomik bir bütün-istemci yakınsama zaman damgası ayrıca ölçülmedi. Gerçek kesinti/restart kısa senaryosunda peer DOM toparlanması 9.369 saniye, backend kesintisi 3.939 saniye ölçüldü.

Uzun koşuda hem kabulden sonra yanıt kaybı hem gönderim öncesi offline kesinti ve iki gerçek app retry kaydedildi. Kontrollü iki backend yarışında her yerel backend kendi yazısını kabul edebilir; ardından gerçek replika çakışma/pending makbuzu ayrı kaydedilir. Bunu aynı backend’in beklenen tek-kazanan CAS testiyle karıştırmayın. Günlük kullanımda bildirilen CAS retleri sıfır beklenen bir ürün gereksinimi değildir; sessiz kabul veya kayıp sayılmadı. Native kısa aynı-field/farklı-field yarışları ayrıca geçti.

İki bulk otomatik alan kaydı eski model gövdesi taşıdığı için bağımsız intent denetimince işaretlendi. Gerçek makbuzları `replication.merged:true`; birinde eşzamanlı yayın başı değiştiği için açık `publicationPending/state:error` vardır. Bu body’ler yeni model-edit kararı diye sayılmadı. Sonraki pre-import, canonical ve cold dosyalar bağımsız eşleştirilmiş yeni kullanıcı modellerini korudu. Ayrıntı `bulk-acceptance-explanation.json`; hiçbir ham makbuz değiştirilmedi.

| Süreç grubu | Örnekler arası CPU saniye | Tepe toplam RSS MiB | Fiziksel yazılan MiB |
|---|---:|---:|---:|
| driver | 168.99 | 803.4 | 121.9 |
| backend | 430.00 | 1481.3 | 545.9 |
| application-renderer | 990.14 | 3099.0 | 0.0 |
| browser-driver | 201.00 | 639.8 | 0.0 |

Container gözlenen tepe bellek **6.188 GiB**. HTTP istek/yanıt byte’ları kullanıcı/backend bazında özgün `result.json` içindedir. RSS paylaşımları çift sayabilir; açık SSE için byte ve süreç bazında ağ sayaçları yoktur. İç worker/lease kuyruk uzunlukları ölçülmedi; native yavaş-lease ve bağımsız-owner ilerleme kontrolü ile gerçek HTTP outstanding davranışı raporlandı. Kaynak ölçümlerinin bu sınırları test sürücüsünü ürün darboğazı saymamak içindir.

Ham `operations.jsonl`, `operation-accounting.json`, `analysis.json`, `intent-reconciliation.json`, `visible-calculation-reconciliation.json`, `data-health-supplement.json`, `reconciliation.json`, pre-quiescence/durable/cold dosyaları ve trace/PNG aynı kökte, teslim ZIP’inde `runs/bl-final-atomic-settle-6/` altındadır. [Özet JSON](final-load-summary.json).

## Son SSE izolasyonu düzeltmesi ve etkilenen yeniden doğrulama

P0 yetki bulgusu: yabancı özel alan GET403 iken rowless reload, owner kimliği ve aktivite zamanını yabancı SSE abonesine gönderiyordu. Patch alan değerleri zaten süzülüyordu; **satır içeriği sızdığı iddia edilmez**. Native RED: `bl-sse-owner-isolation-red/result.json`. Teslimde taze oturum/alan yetkisi kontrolü eklendi. İzin iptalinde ilgili alıcı izin listesini temizleyecek invalidation’ı yine alır; farklı alıcıların iptalleri tek throttle meta’sında kaybolmaz. İş kuralı veya replika birleşim politikası değiştirilmedi.

Dört yeni regression ve mevcut SSE kontrolleri **23/23 geçti**. Commit sonrası temiz kaynakta `bl-sse-owner-isolation-final`: 3 gerçek kimliği doğrulanmış ham SSE abonesi, 1 gerçek BrowserContext, 1 backend/replica; yetkili reload teslimi, yabancı owner olayı 0, açık bağlantıda revoke sonrası veri olayı 0, ilgili iptal bildirimi teslimi ve yeniden login+GET403 geçti. Bu 3 abone bir UI yük koşusu diye sayılmadı. [Unit](sse-owner-isolation-unit-final.log), [native](sse-owner-isolation-native-final.log), [tekrar script’i](sse-owner-isolation-native.cjs).

Uzun koşu final SSE filtresinden önceki kaynaktır. Değişmeyen UI/finans/save/replication akışları için kaynak hash’leri korunur; filtreye bağlı yetkili teslim ve yetki iptali final kaynakta yeniden çalıştırıldı. Bu dar değişiklik için tamamlanmış 30 dakikayı ve aynı donanım kapasite rampasını tekrar başlatmadık. Üretim değiştiği için **tam paketi finalde yeniden çalıştırdık**.

## Teslimden önceki son tam regresyon

Kaynak `f2ff5a347ffefad2d52446df83ac2d9594b309a7`; sourceDirty `audit-only files changed; server/public/tests match source`. Komut `cd resources/app && BUYER_LOG_TEST_CONCURRENCY=2 npm test`, framework retry 0, paralel browser yükü yok. **1133 dosya, 7978 test; 7913 başarılı, 65 atlama, 0 hata** (etkin kapsam; ilk komut exit1). İlk standart komut, yalnız sürücü test fixture’ındaki eksik parantez nedeniyle exit1 ile durdu; 1130 dosyaya ulaşmıştı. Fixture düzeltmesi standard runner ile 6/6 geçti; henüz çalışmamış 3 izole dosya aynı runner ile 28,5 saniyede geçti. Sentetik tek file-fail çıkarıldı. **Tek komutta temiz full değildir**; özgün başarısız sonuç korunur. [Tamamlama kaydı](final-full-suite-sse-isolation-completion.json), [fixture kontrolü](settle-oracle-syntax-final.log), [kalan üç dosya](final-full-suite-sse-isolation-remaining.log). [Manifest](final-full-suite-sse-isolation-manifest.json), [sonuç](final-full-suite-sse-isolation-result.json), [tam log](final-full-suite-sse-isolation.log), [atlama listesi](final-full-suite-sse-isolation-skips.txt). Sonrasında ürün/test davranışı değişmedi; yalnız denetim raporları ve paketleme indeksi tamamlandı.

## Kalan risk ve sınırlar

- 50aktif kullanıcı/30dakika kabul ölçütü karşılanmadı. Gerçek RAMguard denemesi10context/backend ve9tamamlanmışUIkullanıcısında durdu; sayaç başlamadı. Bu uygulamanın azami kullanıcı sayısının9olduğunu göstermez.
- Gerçek SMB/UNC/OneDrive sağlayıcısı, Windows/Electron50cihaz dağıtımı, fiziksel güç kaybı ve disk donanımı dayanıklılığı bu ortamda doğrulanmadı. Yerel replika testi bunların yerine sunulmaz.
- Eski sporadik panel açılmaması bulgusunun kök nedeni kanıtlanmadı. Yeniden üretmeyen kısa/uzun kontroller, o eski başarısız kaydı geçişe çeviremez.
- Kural/FX’in değişmez tarihî hesap reçetesi kalıcı kayıtta tam değildir. Anlık örnekler korunur; bilinmeyen geçmiş sürümler doldurulmaz. Master/peer kaynak önceliği mevcut sözleşmede bırakıldı; yeni iş kuralı uygulanmadı.
- Bütün arıza birleşimleri tüketilmedi. Özellikle paylaşım hedefi ilk kez oluşmadan I/O hatası ve gerçek sağlayıcıya özgü rename/lock/offline davranışı için genel durable-outbox/exactly-once garantisi iddia edilmez. Merge-publish I/O yolu actual-fs unit’te, doğrudan paylaşım hatası native uygulamada ayrı doğrulandı.
- Önceki dosya OOM’unun tam rakip tahsisi/victim kimliği kanıtlanmadı. Daha sonra eklenen SSE yetki düzeltmesi nedeniyle yeni bir final full gerçekten çalıştırıldı; önceki başarısız log korunur.

## Yeniden çalıştırma ve kanıt paketinin içeriği

```bash
cd resources/app
npm ci
BUYER_LOG_TEST_CONCURRENCY=2 npm test
# Full biter;aynı makinede yük ile eşzamanlı çalıştırılmaz.
export BUYER_LOG_PLAYWRIGHT_MODULE=/workspace/scratch/bl-playwright-aligned/node_modules/playwright
export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
node scripts/sync-e2e/run.cjs --users=50 --backends=50 --seconds=1800 \
  --seed=20261025 --port=7320 --diagnostics=1 --root=/tmp/bl-new-50
# Daha küçük kapsam açıkça ayrı adlandırılır:
node scripts/sync-e2e/run.cjs --users=6 --backends=6 --seconds=1800 \
  --seed=20261025 --port=7320 --diagnostics=1 --root=/tmp/bl-new-6
```

Playwright1.62.0 geçici bir test dizinine kurulur;uygulama yayın paketine eklenmez. Browser build dalı doğrulaması zorunludur. Her root yeni olmalıdır; eski kanıt silinmez. Genel kurulum ve hedefli seçiciler [manuel E2E README](../../../resources/app/scripts/sync-e2e/README.md) içindedir.

`analyze-run.py ROOT`,`audit-intents.py ROOT`,`audit-visible-calculations.py ROOT`,`summarize-health.py ROOT` özgün sonucu değiştirmeden bağımsız muhasebe üretir. `recover-failed-run.cjs ROOT --port=6720` gerçek cold backend açar ve önceki snapshot’ları korur.

Teslim ZIP’i kaynak düzeltme patch’i, audit raporları, senaryo indeksi, bağımsız journal’lar, resource logları, gerçek HTTP makbuzları, trace/PNG/CPUprofilleri, pre-import/durable/cold sentetik dosyalar ve SHA256manifestini içerir. Authstore’lar ve kişisel/üretim verileri dahil edilmez. İçindeki TEST/STABLE ifadesi bir uygulama yayını değildir; ZIP bir test/kanıt paketidir.

PR[764](https://github.com/clbiez/Buyer-Log-Desktop/pull/764) bu çalışmanın kaydıdır. Merge ve son CI durumu paket kökündeki `buyer-log-sync-delivery-status-20261025.json` ile gerçek GitHub durumundan doğrulanır. Kullanıcı merge yetkisi verdi;bu görevden TEST/STABLE yayını başlatılmadı. Dal korumasının etkin olmadığı API’den gözlendi;etkinmiş gibi sunulmaz.
