# Codex performans incelemesi — bulgular (05.11.2026)

TR: Buyer Log 7.0.337 / kaynak `a4438317` üzerinde yapılan Codex incelemesinin 60 bulgusu, paylaşılan HTML raporundan metin olarak aktarıldı. Bu bir tarihsel inceleme kaydıdır, canlı source of truth değildir: satır numaraları o revizyona aittir ve uygulamadan önce güncel kodda hedefli doğrulanmalıdır. Uygulama sırası ve kapsam için birleşik görev paketi (Faz 0–7) esas alınır; bu dosyada **Faz 7** ile işaretli maddeler “önce ölç, maliyet varsa uygula” kuralına tabidir.

EN: The 60 findings of the Codex review of Buyer Log 7.0.337 (source `a4438317`), transcribed from the shared HTML report. This is a historical review record, not a live source of truth: line numbers refer to that revision and must be re-verified in current code. Items marked **Faz 7** follow the "measure first, implement only on measured cost" rule of the combined task packet.

| Kimlik | Öncelik | Efor | Faz 7 | Başlık |
|---|---|---|---|---|
| SHELL-01 | A | S |  | Birincil ekran hazırken diğer modüller açılış perdesini tutuyor |
| SHELL-02 | A | S |  | Kullanılabilirlik metriği kullanıcı etkileşimi açılmadan kaydediliyor |
| SHELL-03 | A | L |  | Açılmayan modüller başlangıç JavaScript maliyetine katılıyor |
| SHELL-04 | B | M |  | Modül stilleri başlangıçta render yolunu bekletiyor |
| SHELL-05 | B | L |  | Manuel native sekmeler tam uygulamayı ve veri hazırlığını çoğaltıyor |
| SHELL-06 | B | S |  | Revision polling sekmeler arasında ortaklaştırılmamış |
| SHELL-07 | C | M | evet | Dil güvenlik ağı bütün DOM değişimlerini anında işliyor |
| SHELL-08 | C | S | evet | Yatay grup başlığı takibinde ölçüm ve stil yazımı iç içe |
| ADMIN-01 | C | M | evet | Yedek üretiminin CRC/SHA işi API ana sürecinde çalışıyor |
| ADMIN-02 | C | L | evet | Tam yedekleme veriyi disk üzerinde birkaç kez dolaştırıyor |
| ADMIN-03 | B | M | evet | Yetki ve public profile türetimleri aynı hiyerarşiyi tekrar işliyor |
| CPR-01 | A | M |  | Koleksiyon alan okumalarında tam veri taramasını indeksle kaldır |
| CPR-02 | B | L |  | Koleksiyon tek hücre kaydını tüm workspace kopyalamadan ayır |
| CPR-03 | B | L |  | Koleksiyon geri alma geçmişini tam snapshot yerine patch ile tut |
| CPR-04 | A | M | evet | Koleksiyon render yolundan tam kural senkronu ve kayıt yan etkilerini çıkar |
| CPR-05 | A | M | evet | Quotation ile koleksiyon eşlemelerini sahip ve revizyon bazında indeksle |
| CPR-06 | B | L | evet | Fiyat matrisi hesaplarını model bazında güncelle ve büyük ilk çizimi pencerele |
| CPR-07 | B | M | evet | Quotation aramasında detail redraw ve tüm request istatistiklerini tekrar hesaplamayı kaldır |
| CPR-08 | A | M | evet | Formül sonuçlarını dirty satır ve bağımlılık grafiğiyle yeniden hesapla |
| CPR-09 | B | L | evet | CP kişisel kural ve checklist katmanını da worker/delta hesaplamaya al |
| CPR-10 | A | M | evet | Checklist toplu kayıt ve metin yazımındaki store/sync/render zincirini birleştir |
| CPR-11 | C | S | evet | Geçersiz kural formülünün derleme hatasını da önbellekle |
| CPR-12 | C | M | evet | Open Costing input güncellemesini değişen satır ve bölümle sınırla |
| ANA-01 | A | S |  | Ortak metin sıralayıcısında Intl.Collator yeniden kullanımı |
| ANA-02 | A | M | evet | Sipariş arama metnini ve temel predicate sonucunu tekrar üretme |
| ANA-03 | A | M | evet | Backlog pivot kapalı dalları da DOM'a basıyor |
| ANA-04 | A | M | evet | Backlog detay ve Intake ortak sanal tabloyu kullanmıyor |
| ANA-05 | A | L | evet | Teslimat analizi cache miss'inde renderer ana thread'i bloke ediyor |
| ANA-06 | A | M | evet | Backlog Chart ortak satır isteğini tekrar çekiyor |
| ANA-07 | B | M | evet | LFL tek tablo sıralamasında tüm görünümü ve türetilmiş modelleri yeniliyor |
| ANA-08 | B | M | evet | Overview tek aktif kırılım gösterirken tüm tabloları hazırlıyor |
| ANA-09 | C | M | evet | Freeze picker global flush ile virtualization'ı kaldırabiliyor |
| ANA-10 | B | M | evet | Bulk satır güncellemesi her kimlikte CP dizisini yeniden tarıyor |
| ANA-11 | B | S | evet | Transit özetinde grup başına tüm step listesi taranıyor |
| ANA-12 | B | M | evet | Eski analitik istekler sonuçları atılsa da çalışmaya devam ediyor |
| DS-01 | B | L | evet | Delta modunda çift kalıcılık ve senkron legacy yazma |
| DS-02 | A | M | evet | Cache anahtarı hesaplaması ana thread'de tüm kaynağı hash'liyor |
| DS-03 | A | M | evet | Tam override hash'i modül bazlı cache reuse kapsamını genişletiyor |
| DS-04 | A | M | evet | loadOverrides her okumada tam normalizasyon ve CP overlay yapıyor |
| DS-05 | A | M |  | On-demand cache miss projection'ları ana thread'de kuruluyor |
| DS-06 | A | S |  | Worker katalog şeması sunucu sözleşmesinden geri kalmış |
| DS-07 | A | M |  | Batch kapasitesine rağmen tekil WAL transaction/fsync tekrarları |
| DS-08 | B | L | evet | JSON snapshot serialization toplam veriyle büyüyen ana thread maliyeti |
| DS-09 | B | L |  | Collection owner paylaşımı tek hücrede tüm workspace'i taşıyor |
| DS-10 | B | M | evet | Değişikliksiz sync sonrası bile tam çalışma kümesi hydrate ediliyor |
| DS-11 | C | M | evet | Peer metadata taraması farklı cihazlarda ardışık RTT biriktiriyor |
| DS-12 | B | M |  | Ham source cache byte bütçesi ve kalıcı worker havuzu yok |
| INT-01 | A | M | evet | Ortak ASAS/IAS sonucunu hedef başına yeniden parse etme |
| INT-02 | A | M |  | AI/Studio XLSX ve PPTX üretimini backend ana iş parçacığından ayır |
| INT-03 | A | L | evet | PLM görsel indirmede toplam bayt belleğine sınır koy |
| INT-04 | A | S | evet | Yerel görseller için gereksiz ortak klasör taramasını kaldır |
| INT-05 | B | L | evet | Ortak görsel pack yayınını işlem bazında grupla |
| INT-06 | B | M | evet | Power BI checkpoint'i bütün sonuç yerine artımlı tut |
| INT-07 | B | M | evet | PLM BOM için ortak concurrency ve retry bütçesi |
| INT-08 | B | M | evet | Tablo için ingest sonrasında preview türevi üret |
| INT-09 | A | S | evet | LCW AI streaming sırasında yalnız aktif mesajı güncelle |
| INT-10 | C | S | evet | LCW AI ek yüklemelerinde sınırlı paralellik |
| INT-11 | B | M | evet | Parser kuyruklarında öncelik ve işe özel batch |
| INT-12 | C | M | evet | OAB kombinasyonlarında kontrollü paralellik denemesi |
| CARD-01 | C | M | evet | Kart listesi ile seçili detayı ayrı güncelle |

## SHELL-01 · Öncelik A · Efor S
_Codex kanıt düzeyi: Doğrulandı_
Birincil ekran hazırken diğer modüller açılış perdesini tutuyor
İlk pencerede modules hard gate CP veri ve karar motoru, Orders ve Koleksiyon kataloğu hazırlığını bekliyor. Ana ekran hazır olsa da devam düğmesi tüm zincir tamamlanana veya ilave 90 saniyelik limit dolana kadar açılmıyor. Background adı bu işi kritik yoldan çıkarmıyor.
- **Öneri:** Kimlik, yetki ve açılan ekranın birincil verisi hazır olduğunda kullanıma izin ver. Diğer modülleri gerçek arka planda; son kullanım veya açma niyetine göre önceliklendir. Modül bazlı hazır/yükleniyor/hata durumu göster.
- **Kazanç:** İlk çalışma anından CP/Orders/Koleksiyon ön hazırlık zincirini çıkarır; mutlak saniye kazancı güncel runtime A/B ölçümüne bağlıdır.
- **Risk:** Ürün davranışı değişir: hazırlanmamış modüle ilk girişte yükleme beklenebilir; kimlik/yetki/veri kapıları korunmalı.
- **Kabul/ölçüm:** Aynı sentetik veride birincil ekran hazır, perde geçilebilir ve perde kapandı zamanlarını ayrı ölç; CP/Orders ilk geçiş gecikmesini ve yetki kontrollerini birlikte karşılaştır.
- **Kaynak:** public/index.html:28 · public/index.html:132 · public/app-main.js:16674 · public/app-main.js:16708

## SHELL-02 · Öncelik A · Efor S
_Codex kanıt düzeyi: Doğrulandı_
Kullanılabilirlik metriği kullanıcı etkileşimi açılmadan kaydediliyor
UI_READY ve firstUsableInteractionMs kaydedildikten sonra modül ön hazırlığı başlatılıyor. Açılış perdesi bu sırada hâlâ ekranı kapatıyor; hazırlık sonunda kullanıcı ayrıca Continue düğmesine basıyor.
- **Öneri:** Birincil ekran hazır, perde geçilebilir ve perde kapandı metriklerini ayrı tut. Kullanıcının Continue öncesi düşünme süresini sistem hazırlık süresinden ayır. Mevcut bl:startup-ready ve bl:startup-complete olaylarını kullan.
- **Kazanç:** Yanlış hızlanma iddialarını ve darboğaz önceliklendirmesini engeller; kendi başına runtime hızlandırması değildir.
- **Risk:** Düşük; yalnız ölçüm semantiği ve geriye dönük rapor karşılaştırması etkilenir.
- **Kabul/ölçüm:** Metriklerin gerçek gate durumlarıyla sıralamasını doğrula; düşük veri ve 30 bin satırda primary-ready ile gate-ready farkını kaydet.
- **Kaynak:** public/app-main.js:16777 · public/index.html:143 · public/index.html:149 · public/index.html:157

## SHELL-03 · Öncelik A · Efor L
_Codex kanıt düzeyi: Doğrulandı_
Açılmayan modüller başlangıç JavaScript maliyetine katılıyor
Güncel index.html statik envanterinde 125 senkron script etiketi, 124 yerel dosyada 6.161.201 bayt JS ve sıfır defer var. app-main.js 3.053.777 bayt/40.242 satır; başlangıç JS hacminin yaklaşık yarısı. Backlog raporları, Koleksiyon spreadsheet, Excel import ve checklist yardımcıları özellik açılmadan yükleniyor. Bunlar sıkıştırılmamış dosya boyutlarıdır; ağ aktarımı veya açılış süresi değildir.
- **Öneri:** Shell ve modül girişlerini ayır. Modüllere load/mount/activate/deactivate/dispose yaşam döngüsü ver; önce Backlog raporları, Excel içe aktarma ve Koleksiyon spreadsheet kodlarını mevcut BLPerf feature manifestine taşı. Framework değişimi gerekmez.
- **Kazanç:** Soğuk açılışta disk/HTTP turu, parse ve başlangıç yan etkilerini azaltır; her native sekmede yeniden kazanılır. Boyut azalması ile zaman kazancı ayrı ölçülmeli.
- **Risk:** Global semboller ve kayıt sırası bağımlılıkları var; bütün script etiketlerine doğrudan defer eklemek güvenli değildir.
- **Kabul/ölçüm:** Üretilen shell paket boyutu, başlangıç kaynak sayısı, long task toplamı, gerçek kullanılabilirlik ve modüllerin ilk açılışını karşılaştır. Import/export ve global kayıt sırası smoke kontrollerini koru.
- **Kaynak:** public/index.html:1623 · public/index.html:1659 · public/index.html:1682 · public/perf-runtime.js:219

## SHELL-04 · Öncelik B · Efor M
_Codex kanıt düzeyi: Doğrulandı_
Modül stilleri başlangıçta render yolunu bekletiyor
index.html statik envanterinde 45 blocking stylesheet ve 1.869.779 bayt CSS var. ui-components.css 1.124.066 bayt, toplamın yaklaşık yüzde 60'ı; app.css 299.398 bayt. LFL, Üreticiler, Lisans Kartları, Pricing Desk, Veri Yönetimi, AI ve Excel import stilleri modül açılmasa da head içinde yükleniyor.
- **Öneri:** Tokenlar, shell ve ortak tablo stillerini başlangıçta tut; modül CSS dosyalarını ilgili feature ile yükle. Büyük ui-components kaynaklarını modüllere ayırıp build sırasında ortak ve modül çıktıları üret; geçersizleşmiş tekrarları görsel regresyonla temizle.
- **Kazanç:** İlk render bağımlılıklarını, CSS parse ve stil eşleştirme işini azaltır. Gerçek süre kazancı browser trace ve A/B ile doğrulanmalıdır.
- **Risk:** Cascade sırası, tema ve TR/EN görsel uyumu değişebilir; görsel regresyon gerekir.
- **Kabul/ölçüm:** CSS coverage, ilk render/long task ve görünüm değişim trace'lerini karşılaştır; açık/koyu tema, ölçek, TR/EN ve lazy ilk açılışta stil sıçraması kontrolü yap.
- **Kaynak:** public/index.html:324 · public/index.html:342 · public/index.html:358

## SHELL-05 · Öncelik B · Efor L
_Codex kanıt düzeyi: Doğrulandı_
Manuel native sekmeler tam uygulamayı ve veri hazırlığını çoğaltıyor
Her manuel native sekme yeni WebContentsView ile aynı tam uygulama URL'sini module parametresiyle açıyor. Her renderer'da scheduleBackgroundModuleWarmup çağrılıyor; sonraki native sekmelerin modules gate'inin olmaması diğer modüllerin verilerini yüklemelerini engellemiyor. Önceki otomatik üç native sekme optimizasyonla kaldırılmış olsa da manuel çok sekmede çoğaltma sürüyor.
- **Öneri:** Native sekmeye modüle özel ince giriş ver; Orders sekmesi CP/Koleksiyon'u kendiliğinden hazırlamasın. Revizyon+kullanıcı+yetki kapsamına bağlı ortak projection/query katmanı üzerinden yalnız ihtiyaç duyulan görünüm/sayfa verisini al. Daha sonra bellek baskısında yalnız temiz ve uzun süre görünmeyen sekmeler state saklanarak unload edilebilir.
- **Kazanç:** Sekme sayısıyla büyüyen JS, veri, worker ve bellek maliyetini azaltır. Güncel RSS oranı ölçülmedi; geçmiş RSS ölçümü bugünün kazanım garantisi değildir.
- **Risk:** P1: sekme düzenleme durumu, kullanıcı/yetki kapsamı, stale veri ve geri yükleme doğruluğu korunmalı.
- **Kabul/ölçüm:** 1/3/5 native sekmede backend ve renderer CPU, JS heap/RSS, istek sayısı ve geçiş sürelerini karşılaştır; dirty edit, aktif iş, sekme taşıma ve yetki değişimi senaryolarını doğrula.
- **Kaynak:** electron/workspace-manager.js:399 · electron/workspace-manager.js:479 · public/app-main.js:16783 · public/app-main.js:16674

## SHELL-06 · Öncelik B · Efor S
_Codex kanıt düzeyi: Doğrulandı_
Revision polling sekmeler arasında ortaklaştırılmamış
Her renderer 2,5 saniye sonra /api/shared-revisions ister ve 7 saniyede bir sürdürür; görünürlük ve önceki isteğin bitme kontrolü yok. Endpoint revision store okur. Canlı SSE katmanı ise zaten BroadcastChannel + Web Locks lider seçimi kullanır.
- **Öneri:** Revision polling'i mevcut SSE liderine taşı ve sonucu BroadcastChannel ile paylaş. Fallback polling gerekiyorsa tek lider, in-flight tekilleştirme ve hata/idle backoff uygula. Native aktiflik sinyali mevcut; Global Flow zaten tüketiyor.
- **Kazanç:** N açık sekmenin yinelenen revision polling'ini yaklaşık tek akışa indirir; store disk/ağ maliyeti ve overlap azalır. Bu SSE'nin hiç olmadığı anlamına gelmez.
- **Risk:** Kopma sonrası revizyon catch-up ve lider devri korunmalı; heartbeat yaşam döngüsü ayrı değerlendirilir.
- **Kabul/ölçüm:** Çok sekmede revision endpoint istek sayısı, lider kapatma/değiştirme, ağ kopması ve değişiklik görünme gecikmesini ölç.
- **Kaynak:** public/app-main.js:15138 · server/server.js:9388 · public/app-main.js:38683 · public/overview-global-flow.js:2039

## SHELL-07 · Öncelik C · Efor M · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Dil güvenlik ağı bütün DOM değişimlerini anında işliyor
i18n-runtime belge kökündeki tüm subtree childList/characterData ve ilgili attribute değişimlerini gözlüyor; her eklenen düğüme anında applyTree uyguluyor. Dil değişiminde bütün body taranıyor. Dictionary başlangıçta 654.851 bayt olarak yükleniyor. Kodun hedef dile göre indeksleri lazy oluşturması ve tablo veri hücrelerini dışlaması mevcut doğru optimizasyonlardır; kalan maliyet büyüklüğü ölçülmedi.
- **Öneri:** Birincil yol modülün TR/EN üretimi olarak kalsın; fallback'i kayıtlı UI köklerine sınırla. Aynı turdaki kökleri tekilleştir, hidden modülleri aktivasyonda işle. Uzun vadede build sırasında modül/dil sözlükleri üret.
- **Kazanç:** Tekrarlanan render sonrası observer işi ve eager dictionary maliyeti azalabilir; güncel profilde belirgin payı varsa uygulanmalı.
- **Risk:** TR/EN kapsamı ve kullanıcı veri metnini çevirmeme sınırı korunmalı.
- **Kabul/ölçüm:** Büyük tablo ve modal render trace'lerinde observer süresini ölç; dil değiştirme, dinamik toast/tooltip, user data ve tablo hücrelerinin korunmasını doğrula.
- **Kaynak:** public/i18n-runtime.js:280 · public/i18n-runtime.js:292 · public/i18n-runtime.js:306 · public/index.html:237

## SHELL-08 · Öncelik C · Efor S · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Yatay grup başlığı takibinde ölçüm ve stil yazımı iç içe
table-header-tracking her grup başlığı için getBoundingClientRect çağrısından sonra visibility/maxWidth/transform yazar, ardından sonraki başlığı ölçer. Bu read/write sırası gereksiz layout hesabı yaratabilir; kullanıcıya etkisi henüz trace ile ölçülmedi. Motion+ tablo dalgasında benzer desen zaten okuma-yazma fazlarına ayrılmış.
- **Öneri:** Bütün grup geometrilerini bir okumada topla; ardından yalnız değişen stil değerlerini toplu yaz. Mevcut rAF tekilleştirmesini koru.
- **Kazanç:** Geniş ve çok gruplu tablolarda yatay kaydırma akıcılığı artabilir; büyük açılış/mimari işlerinin yerine geçmeyen yerel iyileştirmedir.
- **Risk:** Düşük; frozen grup başlıklarının hizası korunmalı.
- **Kabul/ölçüm:** Yatay scroll sırasında Layout/Recalculate Style ve frame sürelerini karşılaştır; farklı freeze sayısı ve pencere ölçeklerini kontrol et.
- **Kaynak:** public/table-header-tracking.js:19 · public/table-header-tracking.js:29 · public/motion-plus.js:62

## ADMIN-01 · Öncelik C · Efor M · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Yedek üretiminin CRC/SHA işi API ana sürecinde çalışıyor
/api/backups setImmediate içinde backupService.create çağırıyor; setImmediate ayrı worker değildir. Arşiv üretimi ve doğrulamasında SHA ve saf JavaScript byte döngülü CRC ana süreçte hesaplanıyor. Dosya okuma/yazma async stream olduğundan bütün yedeklemenin senkron kilitlediği söylenemez.
- **Öneri:** Büyük arşivler API gecikmesini etkiliyorsa güvenli snapshot/iş sözleşmesini ana süreçte kur; arşivleme ve doğrulamayı sınırlı tek worker kuyruğuna taşı. Chunk ve queue sınırlarını koru.
- **Kazanç:** Büyük yedekleme sırasında API yanıt verebilirliğini iyileştirebilir; toplam arşiv süresinin azalması garanti değildir.
- **Risk:** P1: snapshot tutarlılığı, yazıcı kilitleri ve doğrulama korunmalı; worker'a yalnız güvenli snapshot sözleşmesi aktarılmalı.
- **Kabul/ölçüm:** Sentetik büyük arşiv üretirken event-loop delay ve /api/health p95 ölç; üretilen arşiv CRC/SHA doğruluğu, kaynak değişimi yakalama ve restore uyumunu test et.
- **Kaynak:** server/server.js:6431 · server/lib/backup-service.js:144 · server/lib/backup-archive.js:29 · server/lib/backup-archive.js:46 · server/lib/backup-archive.js:128

## ADMIN-02 · Öncelik C · Efor L · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Tam yedekleme veriyi disk üzerinde birkaç kez dolaştırıyor
Arşiv oluşturma kaynak→snapshot, snapshot→ZIP, ZIP→tam doğrulama aşamalarından oluşuyor; yaklaşık üç veri okuması ve iki yazma yapılıyor, geçici snapshot ve ZIP birlikte tutuluyor. ZIP store yönteminde; güvenlik amaçlı snapshot ve son doğrulama bilinçli maliyetlerdir.
- **Öneri:** Büyük/sık yedeklerde disk maliyeti baskınsa değişmeyen dosyaları hash ile tekrar kullanabilen artımlı snapshot/arşiv tasarımını ayrı faz olarak değerlendir. JPEG/PDF gibi zaten sıkıştırılmış içerik için koşulsuz deflate ekleme. Mevcut SHA/CRC ve kaynak değişimi kontrollerini koru.
- **Kazanç:** Çoğunluğu değişmeyen veriyle sık yedeklerde disk I/O ve geçici alan azalabilir; az kullanılan küçük yedekler için düşük önceliklidir.
- **Risk:** P1: arşiv formatı, geriye uyumlu restore ve snapshot tutarlılığı etkilenir; doğrulama kaldırılmamalı.
- **Kabul/ölçüm:** Değişim oranı yüzde 0/1/20 olan sentetik arşivlerde toplam disk baytı, temp peak, süre ve restore doğruluğunu karşılaştır; kesinti ve bozuk blok kurtarmasını doğrula.
- **Kaynak:** server/lib/backup-archive.js:379 · server/lib/backup-archive.js:395 · server/lib/backup-archive.js:82 · server/lib/backup-service.js:127

## ADMIN-03 · Öncelik B · Efor M · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Yetki ve public profile türetimleri aynı hiyerarşiyi tekrar işliyor
publicProfile aynı profil için scopes, effective permissions, access areas, capabilities, descendants ve canAdmin hesaplarını çağırıyor; bunlar hiyerarşi haritalarını ve permission set'lerini tekrar üretiyor. Yönetim listesinde profil başına tekrar türetim var. readStore zaten paylaşılan dosya-imza cache'i kullanıyor; her kontrolde tüm JSON yeniden okunuyor iddiası güncel kod için doğru değildir.
- **Öneri:** Request başına ortak yetki bağlamı ve tek public DTO üretimi kullan. Store nesnesine bağlı WeakMap ile hiyerarşi indekslerini paylaş. Daha kalıcı permission cache düşünülürse en yakın validFrom/validUntil sınırında ve store değişiminde geçersizleştir.
- **Kazanç:** Kullanıcı ve hiyerarşi sayısı büyüdükçe tekrar CPU taramalarını azaltır; güncel gecikme ve toplam katkı ölçülmedi.
- **Risk:** P1 yetki sınırı: geçici izin zamanları, merkezi IAM revizyonu ve fail-closed davranışı korunmalı; yalnız revision anahtarlı uzun ömürlü cache güvenli değildir.
- **Kabul/ölçüm:** Farklı kullanıcı/ağaç büyüklüklerinde publicProfile ve admin list p50/p95 ölç; manager/team inherited izinleri, grant başlangıç/bitiş anları, yetki iptali ve IAM revizyon geçişlerinde aynı sonucu doğrula.
- **Kaynak:** server/lib/user-access.js:1115 · server/lib/user-access.js:379 · server/lib/user-access.js:617 · server/lib/user-access.js:1667 · server/lib/iam-core.js:348 · server/lib/iam-core.js:389

## CPR-01 · Öncelik A · Efor M
_Codex kanıt düzeyi: Doğrulandı_
Koleksiyon alan okumalarında tam veri taramasını indeksle kaldır
Ana kolEffectiveValue her alan okumasında effectiveValue(row,key,kolRows) çağırır. Parent index verilmediğinde model alanı için groupFor tüm koleksiyonu filter eder. Arama imzası 28 alanı her satırda okur; sıralama ve analytics projection aynı yolu kullanır. Bazı erken dönüşler dışında maliyet satır sayısıyla ikinci dereceden büyür.
- **Öneri:** Mevcut createValueReader ve group/parent/byId indekslerini koleksiyon revizyonu başına kur; grid, filtre, arama, sıralama, fiyat ve analytics aynı reader kullanmalı. Sort anahtarlarını bir defa hesapla.
- **Kazanç:** Çok yüksek aday. Sentetik gerçek-engine ölçümünde 6000 satır ve dört alan taraması medyan 2636,8 ms, indeks kurma dahil reader 4,58 ms. Bu UI veya uygulama geneli hızlanma oranı değildir. Hedef O(N²×alan) yerine O(N×alan).
- **Risk:** Model/renk mirası, açık boş override ve parent değişiminde invalidation doğruluğu korunmalı.
- **Kabul/ölçüm:** Önerilen kabul: tek/model/variant/boş override fixture eşitliği; parent edit ve grup değişiminde cache invalidation; 1k/3k/6k/30k arama/sıralama ve heap ölçümü. Mikrobenchmark scripti ve sonuç JSON'u saklandı.
- **Kaynak:** public/app-main.js:24997 · public/collection-model-groups.js:140 · public/collection-model-groups.js:148 · public/collection-model-groups.js:167 · public/app-main.js:25968 · public/app-main.js:29962

## CPR-02 · Öncelik B · Efor L
_Codex kanıt düzeyi: Doğrulandı_
Koleksiyon tek hücre kaydını tüm workspace kopyalamadan ayır
saveKolRows tüm satırları normalize eder; normalizeRows her satırı JSON clone yapar. Ardından tüm rows JSON, ikinci workspace JSON/localStorage ve pending persistence çalışır. Grup editinde setSharedValue/setVariantOverride clone ve normalize işlemi kayıt öncesinde de tekrarlanır.
- **Öneri:** Normalizasyonu yükleme/migrasyon ve etkilenen grupla sınırla. Yerel changed-row/group patch journal'ı ve seyrek checkpoint kullan; sunucu CAS sözleşmesini koruyarak istemci serialization tekrarlarını azalt.
- **Kazanç:** Büyük koleksiyonda edit gecikmesi, kopya bellek ve GC baskısında yüksek kazanç beklenir; uygulama runtime kazancı ölçülmedi.
- **Risk:** P1: dayanıklı pending journal, acknowledgement, conflict recovery, CAS/revision ve sahip kapsamı korunmalı.
- **Kabul/ölçüm:** Önerilen kabul: tek hücre/grup/paste için serialized byte ve clone sayısını ölç; ağ kopması/kapanış/yeniden başlatma/conflict/başka buyer görünümü senaryolarında kayıp ve yanlış sahip yazımı olmadığını doğrula.
- **Kaynak:** public/app-main.js:25790 · public/app-main.js:25800 · public/app-main.js:25014 · public/collection-model-groups.js:23 · public/collection-model-groups.js:54

## CPR-03 · Öncelik B · Efor L
_Codex kanıt düzeyi: Doğrulandı_
Koleksiyon geri alma geçmişini tam snapshot yerine patch ile tut
kolSnapshot tüm koleksiyonu JSON clone yapar. Her edit bu snapshot'ı undo'ya ekler ve 50 geçmiş saklanır. Bulk draft ayrıca birden çok full structuredClone oluşturur. Geçmiş bellek maliyeti yaklaşık historyCount×dataset ile büyür.
- **Öneri:** Command/inverse-patch undo ve byte sınırı kullan. Grup ve toplu işlemleri tek transaction tut; seyrek tam checkpoint ile geri dönüşü destekle.
- **Kazanç:** Büyük veri ve uzun oturumda yüksek heap/GC kazancı beklenir; gerçek heap profili çalıştırılmadı.
- **Risk:** P1: remote değişiklik sonrası undo rebase, model grubu işlemleri ve atomik bulk davranışı korunmalı.
- **Kabul/ölçüm:** Önerilen kabul: 30k satırda 50 tek hücre editinden sonra retained heap/GC ve undo gecikmesini ölç; remote change+undo/redo ile aynı canonical sonuçları doğrula.
- **Kaynak:** public/app-main.js:26590 · public/app-main.js:26600 · public/app-main.js:26607

## CPR-04 · Öncelik A · Efor M · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Koleksiyon render yolundan tam kural senkronu ve kayıt yan etkilerini çıkar
renderKol çizimden önce PLM, licensor ve fiyat senkronunu tüm koleksiyona uygular ve değişiklikte kayıt yapabilir. OPD eksik her koleksiyon satırı CP rows içinde find yapar. Veri sağlığı sayımı da render sonrası tüm satırlarda beş kontrol çalıştırır.
- **Öneri:** Render salt projection olsun. İş verisi değişiminde etkilenen satırları güncelle; OPD eşlemesinde de byOrder index kullan. Sağlık sayımını delta/generation/visibility ile birleştir.
- **Kazanç:** Görünüm/filtre/sayfa değişimlerinde tekrarlayan tüm veri hesaplarını kaldırır; OPD eksik toplulukta O(K×CP) eşlemeyi lineer indekse indirir. UI kazancı ölçülmedi.
- **Risk:** P1: CP/rule/quotation/FX değişimleri için eksiksiz dependency invalidation ve hesap doğruluğu şart.
- **Kabul/ölçüm:** Önerilen kabul: filtre/sıralama/kolon görünümü salt işlemlerinde rule-eval/save sayısının sıfır olması; CP OPD, lisans ve quotation değişince gereken satırların anında güncellenmesi; health chip eşitliği.
- **Kaynak:** public/app-main.js:28581 · public/app-main.js:27664 · public/app-main.js:27694 · public/app-main.js:28342 · public/app-main.js:25203

## CPR-05 · Öncelik A · Efor M · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Quotation ile koleksiyon eşlemelerini sahip ve revizyon bazında indeksle
qFindCollectionRow her item için owner scope oluşturup rows.find yapar. Multi buyer scope ayrıca tüm yüklü rows'u filter eder. Fiyat Masası lineInfo bu yolu ve çok sayıda effective field read kullanır; infoCache birçok render'da sıfırlanır.
- **Öneri:** Owner+workspace revision başına rowId/orderCode index ve indexed value reader kur; quotation item değişimi ile collection revision değişimini ayrı invalidate et.
- **Kazanç:** Çok buyer ve yüksek quotation line sayısında tekrarlayan M×N eşleme/alan okuma maliyetini azaltır. Kazanç runtime'da ölçülmedi.
- **Risk:** P1: aynı rowId başka buyer'a ait olabilir; owner scope ve yetki sınırları korunmalı.
- **Kabul/ölçüm:** Önerilen kabul: aynı rowId'li iki buyer ve multi scope fixture; load/owner switch/revision/legacy orderCode eşlemeleri; 10k quotation line için eşleme çağrı ve tarama sayıları.
- **Kaynak:** public/quotations.js:355 · public/quotations.js:364 · public/quotations.js:409 · public/pricing-desk.js:124 · public/pricing-desk.js:257

## CPR-06 · Öncelik B · Efor L · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Fiyat matrisi hesaplarını model bazında güncelle ve büyük ilk çizimi pencerele
renderMatrix scorecards, requestMatrix, bulk candidates ve gain için ayrı full passes yapar. Partial DOM row update vardır ama refreshModelRow yine bütün matrix ve supplierScorecards/analyze hesaplar. İlk çizim tüm model satırlarını ve görünür supplier hücrelerini üretir.
- **Öneri:** Request revision/modelKey bazlı matrix, rowStats, negotiation ve supplier katkı indeksleri kullan. Tek fiyat editinde ilgili model/supplier katkısını güncelle. Büyük ilk açılış için satır/sütun pencereleme ekle.
- **Kazanç:** Tek hücre commit CPU maliyetini talep boyutundan ayırma ve ilk açılış DOM boyutunu sınırlama potansiyeli yüksek. Mevcut partial DOM update korunur; her edit full DOM çiziyor iddiası yapılmamalı.
- **Risk:** P1: onay/best/outlier/negotiation sonucu, focus, klavye ve sticky kolon davranışı korunmalı.
- **Kabul/ölçüm:** Önerilen kabul: 1k model×20 supplier ilk açılış/tek fiyat edit ölçümü; best/approved/outlier/round gain parity; tab/enter/paste/focus/scroll davranışı.
- **Kaynak:** public/pricing-desk.js:255 · public/pricing-desk.js:229 · public/pricing-desk.js:285 · public/pricing-desk.js:323 · public/pricing-desk.js:345 · public/pricing-desk-engine.js:131

## CPR-07 · Öncelik B · Efor M · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Quotation aramasında detail redraw ve tüm request istatistiklerini tekrar hesaplamayı kaldır
Arama her tuşta qRenderWorkspaceAll çağırır; nav ve detail birlikte çizilir. Arama haystack'i request item'larını ve category eşlemelerini tekrar okur. Status tabları her status için requestStats üzerinden tüm request item'larını yeniden tarar.
- **Öneri:** Aramada sadece nav güncellensin. Request revision bazlı arama dizini ve requestStats cache kullan; 150-200ms birleştirme uygula. Detail aktif request veya ilgili veri değişiminde güncellensin.
- **Kazanç:** Büyük quotation geçmişinde gereksiz hesap ve detail DOM değişimini azaltır. Canlı kullanıcı süresi ölçülmedi.
- **Risk:** Aktif fiyat editörünün commit ve korunma davranışı bozulmamalı.
- **Kabul/ölçüm:** Önerilen kabul: aramada detail render sayısı, item scan sayısı ve long task ölçümü; aktif fiyat input'u kaybı ve status sayımları regresyonu olmamalı.
- **Kaynak:** public/quotations.js:2028 · public/quotations.js:2000 · public/quotations.js:1089 · public/quotations.js:1107 · public/pricing-workspace-engine.js:27

## CPR-08 · Öncelik A · Efor M · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Formül sonuçlarını dirty satır ve bağımlılık grafiğiyle yeniden hesapla
Formüllü CP/sipariş render'ı tüm kaynak satırlara formülleri yeniden uygular. AST cache mevcut fakat sonuç/dirty-row cache yok. Formül tanımları ve bağımlılık sırası yeniden hazırlanır. Formülsüz tabloda erken dönüş vardır; bulgu formül kullanan tablolar içindir.
- **Öneri:** Tanım revizyonunda DAG/alias/program planını bir kez oluştur; veri değişiminde yalnız dirty satır ve etkilenen formülleri hesapla. Görünüm, filtre, sıralama ve seçim aynı eval zincirini tekrar başlatmasın.
- **Kazanç:** Çoğu etkileşimde N×F yerine değişen satır×etkilenen formül maliyeti. Gerçek-engine 30k×20 basit formül mikro ölçümü tekrar koşumda 219,8 ms, ilk koşumda 740,7 ms; JIT/ortam yükü nedeniyle sabit baseline veya UI hızı değildir.
- **Risk:** P1: canonical field değişimleri, bağımlı formüller, tarih/gün invalidation ve export doğruluğu korunmalı.
- **Kabul/ölçüm:** Önerilen kabul: formül DAG, alias, cycle, tarih ve dependent update parity; salt görünüm işlemlerinde eval sayısı sıfır; 30k satırda edit/filtre/export ölçümleri. Mikrobenchmark scripti saklandı.
- **Kaynak:** public/app-main.js:9258 · public/app-main.js:9569 · public/app-main.js:13419 · public/formula-columns.js:221 · public/formula-columns.js:237 · public/formula-columns.js:312

## CPR-09 · Öncelik B · Efor L · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
CP kişisel kural ve checklist katmanını da worker/delta hesaplamaya al
CP worker temel analizi hesaplar. Worker sonrası applyPersonalLayer tüm analizleri klonlar, tüm satırlara kuralları uygulayıp recount/checklist summarize işlemlerini senkron çalıştırır. Genel Bakış recompute yolu ayrıca senkrondur.
- **Öneri:** Kişisel katmanı ortak worker/cooperative pipeline'a dahil et; değişen orderKey/option cevapları için delta hesapla. CP ve Genel Bakış aynı analiz revizyonunu paylaşsın.
- **Kazanç:** Ana thread tepkiselliğinde yüksek potansiyel; toplam CPU kazancı delta hesaplamaya bağlıdır. Gerçek UI süresi ölçülmedi.
- **Risk:** P1: manuel cevap önceliği, option tekrar kullanımı, kullanıcı/context iptali ve yetki izolasyonu korunmalı.
- **Kabul/ölçüm:** Önerilen kabul: 30k satırda base+personal+checklist ayrı span/long task ölçümü; kullanıcı switch/cancel/manuel-auto cevap/option paylaşımı parity.
- **Kaynak:** public/cp-overview-assistant.js:4375 · public/cp-overview-assistant.js:4453 · public/cp-overview-assistant.js:4495 · public/cp-overview-assistant.js:4520

## CPR-10 · Öncelik A · Efor M · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Checklist toplu kayıt ve metin yazımındaki store/sync/render zincirini birleştir
Toplu checklist her hedefte setChecklistAnswer çağırır; her çağrı tüm answers store'unu JSON'a çevirip context event yayınlar. Olay journal/column refresh/sync tetikler; sonda tekrar recompute vardır. Evidence açıklamasında her input ve change aynı store/sync/render yoluna gider.
- **Öneri:** applyChecklistBatch transaction ile bir dayanıklı answers/journal commit, tek event ve tek delta render/sync uygula. Metinler için yerel dirty journal + 250-400ms debounce/coalescing ve blur/close flush kullan.
- **Kazanç:** K hedef×tam cevap deposu serialization yerine tek commit; büyük toplu işlemde çok yüksek aday. Metin yazarken gereksiz full hesap ve senkron azaltılır. Ağdaki mevcut 200'lük batching bu yerel tekrarları çözmez.
- **Risk:** P1: monoton timestamp, journal dayanıklılığı, option cevabı, scoped set, conflict/reject ve kapanışta son yazının korunması şart.
- **Kabul/ölçüm:** Önerilen kabul: 100/1000 hedef bulk'ta store write/event/render sayısı; ağ kopması/kapanış/conflict ile son metnin ve cevapların kaybolmaması; timestamp ve option davranış eşitliği.
- **Kaynak:** public/cp-overview-assistant.js:4053 · public/cp-overview-assistant.js:383 · public/cp-overview-assistant.js:389 · public/checklist-supplier-sync.js:2777 · public/checklist-supplier-sync.js:2537 · public/checklist-supplier-sync.js:2583

## CPR-11 · Öncelik C · Efor S · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Geçersiz kural formülünün derleme hatasını da önbellekle
cp-rules-engine içindeki !compiled koşulu aynı kaynak ve kayıtlı hata olmasına rağmen her satırda yeniden parse/throw yaptırır.
- **Öneri:** Kaynak/tanım revizyonu değişmedikçe başarısız derlemeyi de cache'le; hatayı normalize/validate aşamasında göster.
- **Kazanç:** Bozuk formül bulunan veri setine koşullu, düşük maliyetli kazanç. 30k invalid '=AND(' matchesRule mikro ölçümü son koşumda 587,8 ms; negatif-cache guard 1,20 ms. Uygulama geneli oran değildir.
- **Risk:** Düşük: kaynak düzeltildiğinde yeniden derleme zorunlu.
- **Kabul/ölçüm:** Önerilen kabul: hatalı kaynağın bir kez compile edilmesi; düzeltince cache invalidation; geçerli/geçersiz sonuçların ve hata mesajlarının korunması.
- **Kaynak:** public/cp-rules-engine.js:973

## CPR-12 · Öncelik C · Efor M · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Open Costing input güncellemesini değişen satır ve bölümle sınırla
calculateRecord lineer bir motor. Ancak updateCalculatedDom her input'ta tüm satırları hesaplar; sonra tüm satırları ikinci kez lineTotal ile hesaplayıp her biri için global DOM query yapar. lineTotal tekrar FX snapshot çözer.
- **Öneri:** Changed-line/bölüm subtotal ve cached DOM refs kullan; FX snapshot'ı işlem başına paylaş. Büyük costing sheet profili maliyeti doğrularsa uygula.
- **Kazanç:** Büyük costing sheet'lerinde yazım tepkiselliği ve DOM query azalması; diğer A/B adaylarından düşük öncelikli. Gerçek süre ölçülmedi.
- **Risk:** FX ayı/kuru, toplamlar ve finansal yuvarlama doğruluğu korunmalı; aritmetik motorunu değiştirmek için kanıt yok.
- **Kabul/ölçüm:** Önerilen kabul: 100/1000 satırlı costing fixture'da input süresi/query sayısı; para birimi/ay değişimi, eksik kur ve roundHalfUp sonucu parity.
- **Kaynak:** public/open-costing-engine.js:36 · public/open-costing.js:180 · public/open-costing.js:183 · public/open-costing.js:201 · public/open-costing.js:785

## ANA-01 · Öncelik A · Efor S
_Codex kanıt düzeyi: Doğrulandı_
Ortak metin sıralayıcısında Intl.Collator yeniden kullanımı
Ortak kronolojik karşılaştırıcı metin karşılaştırmalarında localeCompare('tr',{numeric:true,sensitivity:'base'}) çağırıyor; bu yol core grid, filtre ve pivotlarda kullanılıyor.
- **Öneri:** Tek Intl.Collator oluşturup compare metodunu yeniden kullan; mevcut kronolojik öncelik mantığını aynen koru.
- **Kazanç:** 30.000 sentetik Türkçe metin/ID/sezon sıralamasında 5 tur medyan 3435 ms'den 198 ms'ye, yaklaşık 17,3 kat comparator hızlanması; çıktı birebir eşit. Uygulamanın tamamının hızlanması değildir.
- **Risk:** Düşük; Türkçe, sayısal kimlik, boş değer, sezon/ay ve yön semantiği korunmalı.
- **Kabul/ölçüm:** /tmp/buyerlog-order-audit-bench.cjs mevcut kaynak comparator'ını alternatifle karşılaştırdı. Node v24.19.0, paylaşılan cloud CPU. chronological-sorting.test.js ve backlog-delivery-engine-v946.test.js iki test dosyası geçti.
- **Kaynak:** public/chronological-values.js:66 · public/app-main.js:9212

## ANA-02 · Öncelik A · Efor M · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Sipariş arama metnini ve temel predicate sonucunu tekrar üretme
ordersEvaluateAll eşleşen satır için ordersPassesBase'i active filtresi hariç ve dahil iki kez çağırıyor; her çağrıda 12 alanın normalize edilmiş arama metni yeniden birleştiriliyor. Grup kontrolleri de tekrar ediliyor. CP'de de haystack her aramada üretiliyor.
- **Öneri:** Satır revision'ına bağlı arama metni cache'i/index kur; base predicate'i bir kez değerlendirip active filtresini ayrı uygula, grup sonuçlarını tek sefer üret.
- **Kazanç:** Eşleşen 30k siparişte yalnız arama alanlarında 720k normalizasyon ve birleştirme çağrısı var; indeks sonrası query başına bunları yeniden üretme gerekmez. UI kazancı ayrıca ölçülmeli.
- **Risk:** Çapraz facet kapsamları ve değişen alanlar için doğru invalidation gerekir.
- **Kabul/ölçüm:** 30k/100k sentetik veriyle arama p95 ve long-task ölç; çoklu token, kişisel not, status ve facet kapsamlarının mevcut çıktılarla eşitliğini karşılaştır.
- **Kaynak:** public/app-main.js:9438 · public/app-main.js:9485 · public/app-main.js:9067

## ANA-03 · Öncelik A · Efor M · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Backlog pivot kapalı dalları da DOM'a basıyor
Backlog flat ağacının tüm düğümleri HTML'e çevriliyor; kapalı dallar display:none satırları olarak DOM'da kalıyor. Her expand/collapse bütün HTML ve satır listener'ları yeniden kuruluyor; yatay pivot tüm sütunları üretir.
- **Öneri:** Yalnız görünür açık düğümlerden liste üret; satır virtualization ve gerektiğinde yatay pencere kullan; tek delegated listener kur.
- **Kazanç:** DOM üretim maliyeti toplam ağaç ve sütun sayısı yerine görünür pencereyle ölçeklenir; yüksek cardinality kırılımlarında potansiyel yüksek.
- **Risk:** Expand state, path kimlikleri, drill, sticky başlık ve export toplamları korunmalı.
- **Kabul/ölçüm:** 10k/30k düğüm, farklı expand derinlikleri ve çok sütunlu pivotlarda click-to-paint, DOM node sayısı, heap ve drill/export toplam eşitliğini ölç.
- **Kaynak:** public/app-main.js:18368 · public/app-main.js:18238

## ANA-04 · Öncelik A · Efor M · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Backlog detay ve Intake ortak sanal tabloyu kullanmıyor
Backlog detay tüm satır ve sütunlarını bir kerede HTML'e çeviriyor. Intake tüm viewRows'u map/innerHTML ile çiziyor; server satır limiti 10.000. Intake'de tablo imzası cache'i var fakat gerçek veri/düzen değişiminde tam çizim devam ediyor.
- **Öneri:** İki görünümü ortak grid/range/virtual renderer'a geçir; özet ve export'u tam filtreli modelden hesapla, ekrana yalnız pencereyi çiz. Intake tableSignature optimizasyonunu koru.
- **Kazanç:** 10k satırlı Intake ve geniş Backlog detail modalında DOM/bellek ve ilk çizim maliyeti önemli ölçüde düşebilir; üretim yüzdesi ölçülmedi.
- **Risk:** Intake subtotal/WAVG, kolon türleri, görsel scope, clipboard ve export tamlığı korunmalı.
- **Kabul/ölçüm:** 10k Intake ve 30k detay satırında ilk paint, scroll FPS, DOM/heap, WAVG/subtotal ve export satır sayısı eşitliğini ölç.
- **Kaynak:** public/app-main.js:18995 · public/app-main.js:19033 · public/intake.js:424 · server/lib/intake-report.js:453

## ANA-05 · Öncelik A · Efor L · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Teslimat analizi cache miss'inde renderer ana thread'i bloke ediyor
computeModel cache miss'inde Engine.analyze(rows) renderer thread'de senkron çağrılıyor. Saf motor tüm satırların risk ve çok boyutlu ölçülerini hesaplıyor.
- **Öneri:** Canonical saf motoru ortak analytics worker'da aynen çalıştır; dataset'i revision başına bir kez gönder, filtrelerde küçük parametreler ilet; eski job sonuçlarını iptal/yok say. LFL'nin ağır cache miss'leri için aynı model değerlendirilmeli.
- **Kazanç:** Güncel saf motor 30k sentetik satırda 1115/996/844 ms sürdü; worker bu işi UI thread'den kaldırabilir. Toplam hesap süresini kendiliğinden azaltmaz.
- **Risk:** Worker structured-clone/bellek maliyeti; canonical motor, tarih/today ve rule revision tutarlılığı korunmalı.
- **Kabul/ölçüm:** /tmp/buyerlog-backlog-compute-bench.cjs üç turda 30k satır ve 30.000.000 adet doğruladı. Gerçek Electron'da input latency, long task, clone maliyeti ve sonuç eşitliği ölçülmeli.
- **Kaynak:** public/backlog-delivery-analysis.js:149 · public/backlog-delivery-engine.js:414

## ANA-06 · Öncelik A · Efor M · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Backlog Chart ortak satır isteğini tekrar çekiyor
Chart kendi /api/backlog-export isteğini çekiyor ve her Backlog render'da invalidate+force render yapıyor. Overview ve risk paneli zaten BLBacklogRows promise/revision cache'ini paylaşıyor.
- **Öneri:** Ortak cache'i rows, headers, rowsRevision ve calendar envelope'una genişletip Chart'ı bağla; cache anahtarını tüm sorgu/scope variant'larıyla kur.
- **Kazanç:** Aynı filtrede ikinci tam payload, JSON parse ve allocation maliyeti kaldırılabilir.
- **Risk:** Yetki/scope/query/sourceColumns/revision anahtarları tam olmalı; includeSourceDetails variant'ları yanlış birleştirilmemeli.
- **Kabul/ölçüm:** Açık grafik+Overview+risk panelinde network request/payload sayısı, parse süresi ve satır revision eşitliğini kontrol et; farklı kullanıcı scope ve includeSourceDetails variant'larını test et.
- **Kaynak:** public/backlog-chart.js:887 · public/backlog-chart.js:1154 · public/backlog-overview.js:140

## ANA-07 · Öncelik B · Efor M · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
LFL tek tablo sıralamasında tüm görünümü ve türetilmiş modelleri yeniliyor
Her tablo rerender/sort tam LFL render'ına dönüyor. compute cache hit olsa bile manufacturerVolumes tüm current/compare satırlarını yeniden grupluyor ve summary hesaplıyor; frameworkRows her çizimde yeni satır nesneleri oluşturuyor.
- **Öneri:** Analiz revision'ına bağlı üretici/grup/framework view-model cache'i kullan; sort/filter yalnız ilgili tabloyu çizsin. KPI/source/scenario/Trial bölümleri değişmediyse DOM'a dokunma.
- **Kazanç:** Sıcak cache'li tekrar sıralamada gereksiz O(N) taramalar, object allocation ve tüm sayfa DOM kurulumu azalır.
- **Risk:** Trial, global filtre, fiyat ve kur değişimlerinde tam invalidation gerekir.
- **Kabul/ölçüm:** Aynı analizde ardışık sort/filter click-to-paint ve allocation ölç; Trial/FX/dataset revision değişiminde sonuçların tazeliğini karşılaştır.
- **Kaynak:** public/lfl.js:2161 · public/lfl.js:1239 · public/lfl.js:940 · public/lfl.js:1198

## ANA-08 · Öncelik B · Efor M · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Overview tek aktif kırılım gösterirken tüm tabloları hazırlıyor
renderOverviewNow her render'da ülke/alt üretici/sezon/buying-group taramalarını yapıp ilgili tabloları yeniden kuruyor; Breakdown widget tek aktif dimension/view gösterse de tüm tablolar hazırlanıyor.
- **Öneri:** Data/filter revision'a bağlı tek aggregate view-model; yalnız aktif widget pane'ini render et; değişmeyen KPI/HTML'i koru, satır güncellemesinde sadece etkilenen widget'ları dirty işaretle.
- **Kazanç:** Overview tekrar ziyareti ve ufak düzenlemelerde tam dataset tarama ve gizli DOM kurulumu azalabilir.
- **Risk:** Kırılım drill'leri ve kullanıcı widget görünümü korunmalı.
- **Kabul/ölçüm:** Widget görünürlük/aktif boyut kombinasyonlarında hesap çağrılarını, render sürelerini ve drill/toplam eşitliğini ölç.
- **Kaynak:** public/app-main.js:11230 · public/overview-breakdown.js:127

## ANA-09 · Öncelik C · Efor M · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Freeze picker global flush ile virtualization'ı kaldırabiliyor
Freeze picker global flushPendingTableRenders çağırıyor. Fonksiyon tüm pending tabloları tamamlatıyor; virtual flushToFull tüm state.rows'u DOM'a basıp virtualization'ı kapatıyor.
- **Öneri:** Freeze yalnız başlığı ölçsün; gerekli flush tabloya özel ve bounded olsun. DOM gerektirmeyen export/clipboard işlemlerini modelden yürüt; mevcut managed export iyileştirmelerini koru.
- **Kazanç:** Tümü modunda dondurma sırasında büyük DOM allocation/donma ve ilgisiz tabloların materialization maliyetini önler.
- **Risk:** Özellikle Tümü seçilmiş büyük tablolarda etkili; varsayılan 50 satır sayfada kazanç sınırlı. Selection/clipboard/export tamlığı korunmalı.
- **Kabul/ölçüm:** Tümü ve 50 satır sayfa, birden fazla hazırlanmış tablo, freeze pick/cancel/commit senaryolarında DOM node sayısı ve input latency ölç.
- **Kaynak:** public/app-main.js:7387 · public/app-main.js:7298 · public/app-main.js:7451

## ANA-10 · Öncelik B · Efor M · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Bulk satır güncellemesi her kimlikte CP dizisini yeniden tarıyor
refreshRowsEverywhere kimlik listesini tek tek refreshCpRowOnly'ye yollar. Her kimlik için CP'de find yapılır; görünmeyen satırda bile DOM kontrolünden önce computeFlags çağrılır.
- **Öneri:** Revision'a bağlı Map<id,row> ve görünür DOM row map'i kur; bulk patch'te yalnız görünür/etkilenen hücreleri değiştir, flags'i gerçekten gerekli yerde hesapla.
- **Kazanç:** K değişen satır için O(K*N) lookup yerine O(N+K)/O(K); görünmeyen satırların gereksiz hesapları azalır.
- **Risk:** Satır kimliği/reset ve unified priority türetimi korunmalı.
- **Kabul/ölçüm:** 30k CP'de 1/100/1000 satır bulk patch sürelerini ve görünür dirty/priority hücre sonuçlarını karşılaştır.
- **Kaynak:** public/app-main.js:9711 · public/app-main.js:9678

## ANA-11 · Öncelik B · Efor S · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Transit özetinde grup başına tüm step listesi taranıyor
Her ülke/taşıt grubu için tüm steps listesi tekrar filtrelenip ülke normalize ediliyor; O(G*S). Source grupları için records ayrıca tekrar taranıyor.
- **Öneri:** Normalize country key'i bir kez üret; basis/year/vehicle/country anahtarlı steps index'i ve source count map'i oluştur.
- **Kazanç:** 20k step limitine yaklaşan ithalat raporlarında tekrar tarama ve normalizasyonlar azalır; üretim kazancı ölçülmedi.
- **Risk:** Sevkiyat/adet ağırlığı ve yıl kapsamı değişmemeli.
- **Kabul/ölçüm:** 20k records/steps, çok ülke/taşıt/yıl verisinde mevcut ve index'li sonuçların tüm weighted mean/percentile toplamlarını karşılaştır, süre ölç.
- **Kaynak:** public/transit-analysis.js:651 · public/transit-analysis.js:493

## ANA-12 · Öncelik B · Efor M · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Eski analitik istekler sonuçları atılsa da çalışmaya devam ediyor
Plan/gerçekleşen generation ile eski yanıtı yok sayıyor ancak eski fetch iptal edilmiyor. Chart ve ortak satır yüklemesi de fetch iptal etmiyor.
- **Öneri:** Query değişiminde AbortController; server işlerinde cooperative cancellation veya job supersession. Ortak istekler için subscriber/refcount yaşam döngüsü kullan.
- **Kazanç:** Hızlı ardışık filtrelerde eski ağ/parse/hesap işlerinin birikmesi azalabilir; yanıtı yok saymak tek başına bu maliyeti kaldırmaz.
- **Risk:** Paylaşılan promise bir tüketici kapandı diye diğer tüketiciler için iptal edilmemeli; server cancellation cooperative olmalı.
- **Kabul/ölçüm:** Yavaşlatılmış bağlantıda hızlı 10 filtre değişimi ile aktif request/job sayısı, son filtre sonucu doğruluğu ve iptal sonrası kaynak kullanımını izle.
- **Kaynak:** public/backlog-plan-actual.js:139 · public/backlog-chart.js:887 · public/backlog-overview.js:140

## DS-01 · Öncelik B · Efor L · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Delta modunda çift kalıcılık ve senkron legacy yazma
Shared Hub aktivasyonu delta modunu seçiyor; bu mod WAL yanında legacy JSON yazmayı sürdürüyor. saveRevisioned tam belgeyi senkron dayanıklı replace yoluna gönderiyor. Çalışan kurulumun gerçek modu ayrıca ölçülmedi.
- **Öneri:** Okuma, kurtarma ve backup yolları taşınmış store'ları tek tek delta-only'ye geçirmek; legacy uyumluluğunu test edilen migration sınırı olarak yönetmek.
- **Kazanç:** Küçük düzenlemede tam legacy belge serialization/yazması ve dosya lease maliyetini kaldırır; gerçek kazanç store boyutu ve disk/ağ konumuna bağlıdır.
- **Risk:** Yüksek: mixed-version okuyucu, backup/recovery ve store otoritesi doğrulanmalı.
- **Kabul/ölçüm:** Store bazında CRUD, restart/WAL replay, disk dolu/yarım yazma, eski istemci, rollback ve aynı alana eşzamanlı düzenleme senaryoları; p95 save ve event-loop ölçümü.
- **Kaynak:** server/server.js:1794 · server/lib/delta-store.js:106 · server/db.js:218 · server/user-data.js:173

## DS-02 · Öncelik A · Efor M · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Cache anahtarı hesaplaması ana thread'de tüm kaynağı hash'liyor
derived-input-keys her çağrıda yeni WeakMap oluşturup kaynak ve override nesnelerini JSON.stringify+SHA256 ile tarıyor. Memoization çağrılar arasında yaşamıyor. 30 bin x40 alan sentetik kaynakta 179 ms, ayrı CP/Orders/Backlog array kopyalarında 443 ms medyan ölçüldü.
- **Öneri:** İçerik kimliğini ingest/publish anında üretip immutable source generation üzerinde saklamak; yetki/horizon/override revision'larını ayrı anahtarlamak.
- **Kazanç:** Değişmemiş kaynakta O(kaynak baytı) hash maliyetini tekrar eden cache kontrolünden kaldırır.
- **Risk:** Orta: içerik kimliği ile zaman damgası birbirine karıştırılırsa stale cache oluşabilir.
- **Kabul/ölçüm:** Aynı içerik yeni loadedAt, değişen içerik aynı satır sayısı, in-place mutation, farklı scope/yetki ve gün değişiminde cache doğruluğu; 30k/100k kaynakta hash CPU süresi.
- **Kaynak:** server/lib/derived-input-keys.js:5 · server/lib/derived-input-keys.js:9 · server/server.js:8117

## DS-03 · Öncelik A · Efor M · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Tam override hash'i modül bazlı cache reuse kapsamını genişletiyor
Tüm overrides ortak hash'e katılıyor ve CP, Overview, Orders, order-summary, catalog ve Backlog anahtarlarına yayılıyor. Context tarafında dar revision seçimi yapılmış olsa da ikinci katman unrelated override değişikliklerinde tüm input key'lerini değiştirebiliyor.
- **Öneri:** Gerçek modül/alan bağımlılık grafiği oluşturmak; görsel/not/fiyat/royalty/kaynak değişikliklerini yalnız etkilenen projection revision'ına taşımak.
- **Kazanç:** Küçük değişiklikte ilgisiz projection'ların yeniden üretimini ve disk generation yazmasını önler; mevcut reuse mekanizmasının isabetini artırır.
- **Risk:** Orta: bağımlılık eksik yazılırsa finansal veya tarih bazlı görünüm bayat kalabilir.
- **Kabul/ölçüm:** Her override alanı için etkilenen modül matrisi; değişmesi gereken çıktının değiştiği, ilgisiz cache byte/checksum'larının aynı kaldığı kontroller.
- **Kaynak:** server/lib/derived-input-keys.js:13 · server/lib/derived-input-keys.js:17 · server/server.js:7977

## DS-04 · Öncelik A · Efor M · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
loadOverrides her okumada tam normalizasyon ve CP overlay yapıyor
loadOverrides clone, legacy normalizasyon/migration, royalty migration ve tüm CP kayıtlarının overlay'ini tekrar çalıştırıyor. pageProjectionContext gibi cache hit öncesi yollar da çağırıyor. 30 bin sentetik CP kaydında overlay tek başına 87 ms medyan sürdü.
- **Öneri:** Store ve CP collection revision'ıyla anahtarlanmış salt okunur normalize snapshot; değişen CP kaydının legacy projection'ını incremental güncellemek; yazarlara clone-on-write sağlamak.
- **Kazanç:** Değişmemiş veriyi her istekte normalize/clone/overlay etme maliyetini kaldırır; cache hit yolunun CPU ve allocation yükünü azaltır.
- **Risk:** Orta: paylaşılan mutable nesne döndürülürse çağıranlar cache'i bozabilir; clone-on-write sınırı gerekli.
- **Kabul/ölçüm:** Migration uyumu, null tombstone, legacy note fallback, eşzamanlı staged write/rollback; aynı revision'da snapshot reuse ve mutation izolasyonu.
- **Kaynak:** server/db.js:353 · server/lib/cp-shared-store.js:155 · server/server.js:7962

## DS-05 · Öncelik A · Efor M
_Codex kanıt düzeyi: Doğrulandı_
On-demand cache miss projection'ları ana thread'de kuruluyor
Toplu refresh büyük kaynakta worker kullanıyor; /api/data/cp ve /api/data/overview cache miss yolları doğrudan build fonksiyonlarını ana thread'de çağırıyor. Bu yollarda worker satır eşiği uygulanmıyor.
- **Öneri:** Refresh ve on-demand build işlemlerini aynı worker scheduler/saf projection sözleşmesinde birleştirmek; mevcut single-flight'i korumak.
- **Kazanç:** Büyük soğuk cache isteğinin diğer API yanıtlarını CPU boyunca durdurmasını önler; algılanan responsiveness ve eşzamanlı p95 gecikmesini iyileştirir.
- **Risk:** Orta: worker'a taşımada scope, canlı yetki ve generation yayınlama kontrolü korunmalı.
- **Kabul/ölçüm:** Cache silinmiş 30k kaynakta CP/Overview açılışı sırasında bağımsız hafif API heartbeat'i; sonuç eşitliği, yetki değişimi ve eski generation'ın yayımlanmaması.
- **Kaynak:** server/server.js:8134 · server/server.js:8517 · server/server.js:8531

## DS-06 · Öncelik A · Efor S
_Codex kanıt düzeyi: Doğrulandı_
Worker katalog şeması sunucu sözleşmesinden geri kalmış
Sunucu catalogSchemaVersion=3 ve manufacturer alanını bekliyor; worker schemaVersion=2 ve manufacturer içermeyen katalog üretiyor. Gerçek worker sentetik çağrısında schema2/manufacturer yok sonucu doğrulandı. Normal /api/data/collection-catalog tamlık kontrolüyle tekrar hesaplar; doğrudan gzip projection yolu eksik eski biçimi gönderebilir.
- **Öneri:** Katalog schema, alan listesi ve builder'ını tek saf ortak modüle almak; worker/normal yol çıktı sözleşmesini eşitlemek.
- **Kazanç:** Worker'ın ürettiği catalog'un normal API'de reddedilip tekrar hesaplanmasını önler; gzip yolunda manufacturer alanı eksikliğini giderir.
- **Risk:** Düşük-orta: katalog alanlarının ve canonical binding'lerin ortak sözleşmesi korunmalı.
- **Kabul/ölçüm:** Worker ve normal builder için schema3, manufacturer dahil tüm katalog alanları ve canonical değer eşitliği; normal API ile doğrudan gzip yolunu ayrı doğrulamak.
- **Kaynak:** server/projection-worker.js:11 · server/server.js:7935 · server/server.js:7942 · server/server.js:8568

## DS-07 · Öncelik A · Efor M
_Codex kanıt düzeyi: Doğrulandı_
Batch kapasitesine rağmen tekil WAL transaction/fsync tekrarları
Her append transaction lease/open/write/fsync/close ve tag kontrollerini tekrar ediyor. queuePatches mevcut; delta-store toplu removeMirrored her id'yi ayrı tombstone transaction'ıyla siliyor. İzole gerçek API testinde 200 queuePatch 2645 ms; tek 200 kayıt queuePatches 65,6 ms toplam sürdü.
- **Öneri:** Bulk import/edit/delete için tek transactional batch; yoğun ardışık düzenlemelerde sınırlı group commit. Başarı yanıtını ortak fsync tamamlandıktan sonra döndürmek.
- **Kazanç:** Sentetik testte yaklaşık 40 kat toplam throughput farkı görüldü; üretim tıklama gecikmesi için aynı katsayı vaat edilemez.
- **Risk:** Orta: her kullanıcıya dayanıklı commit tamamlanmadan başarı dönülmemeli; kayıt sırası ve CAS korunmalı.
- **Kabul/ölçüm:** Batch içinde bir işlemin hata vermesi, process crash, aynı kayda sıralı patch, eşzamanlı CAS ve fsync-before-ack; 1/10/100/1000 kayıt throughput karşılaştırması.
- **Kaynak:** server/lib/local-db.js:778 · server/lib/local-db.js:804 · server/lib/local-db.js:1084 · server/lib/delta-store.js:290

## DS-08 · Öncelik B · Efor L · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
JSON snapshot serialization toplam veriyle büyüyen ana thread maliyeti
WAL 1 MB/2000 entry eşiğinde tam snapshot yazıyor. Async dosya I/O öncesinde jsonToBuffer senkron CPU tüketiyor. Yaklaşık 3,2 MB sentetik iş durumunda serialization 267 ms medyan; business hash 264 ms. setImmediate yalnız stringify başlangıcını erteliyor, işi bölmüyor.
- **Öneri:** Kısa vadede worker üzerinde generation kontrollü checkpoint/serialization; orta vadede yerel transactional ve indeksli store (ör. desteklenen SQLite adapter) değerlendirmesi. DB dosyasını SMB'ye taşımamak.
- **Kazanç:** Checkpoint sırasında API event-loop donmasını azaltır; indeksli store tam belge yerine değişen kayıtları yazarak büyük veri tavanını yükseltebilir.
- **Risk:** Yüksek: store migration HLC, tombstone, CAS, replay, dedup ve recovery semantiğini korumalı.
- **Kabul/ölçüm:** Snapshot/WAL failpoint ve recovery testleri, büyük DB startup/replay/checkpoint süresi, peak RSS, p95 save, bozuk primary/backup ve migration rollback.
- **Kaynak:** server/lib/local-db.js:234 · server/lib/local-db.js:467 · server/lib/local-db.js:816 · server/lib/large-json.js:84 · server/user-data.js:209

## DS-09 · Öncelik B · Efor L
_Codex kanıt düzeyi: Doğrulandı_
Collection owner paylaşımı tek hücrede tüm workspace'i taşıyor
publishOwnerCas tüm workspace'i yükleyip hash'liyor, remote envelope'ı bütünüyle okuyup doğruluyor ve tüm belgeyi yazıyor. recordBase ayrıca tam taban snapshot ve hash tutuyor. Maliyet değişen hücre yerine workspace boyutuyla büyüyor.
- **Öneri:** Owner yetkisini koruyan row/field delta protokolü, küçük revision/head manifest'i ve periyodik checkpoint. Genel ortak delta alanına taşımadan owner erişim sınırını korumak.
- **Kazanç:** Tek hücre düzenlemesinde O(workspace baytı) ağ/serialization yükünü değişiklik boyutuna yaklaştırır; büyük paylaşılan koleksiyonlarda yüksek potansiyel.
- **Risk:** Yüksek: owner yetkisi, lineage CAS, üç yönlü merge ve çatışma saklama korunmalı.
- **Kabul/ölçüm:** Offline iki cihaz, aynı/farklı alan düzenleme, silme-vs-edit, yeni satır id çakışması, read-only kullanıcı, yetki iptali, yarım publish ve ancestry CAS testleri; ağ baytları ölçümü.
- **Kaynak:** server/lib/collection-replication.js:337 · server/lib/collection-replication.js:464 · server/lib/collection-replication.js:527

## DS-10 · Öncelik B · Efor M · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Değişikliksiz sync sonrası bile tam çalışma kümesi hydrate ediliyor
Arka plan/scheduled sync sonucundan bağımsız hydrate çağırıyor. hydrate tüm records map'ini tarayıp koleksiyon map'lerini yeniden kuruyor; etkili değişiklik yokken bile O(toplam kayıt) allocation gerçekleşiyor.
- **Öneri:** Sync sonucunda etkili değişen id/collection revision'larını döndürmek; zero-change turunda hydrate atlamak, değişen kayıtlara incremental uygulama yapmak.
- **Kazanç:** Boş sync turunda tam veri taramasını, bellek churn'ünü ve GC yükünü kaldırır.
- **Risk:** Orta-yüksek: inflight staged yazım ve rollback sırası bozulmamalı.
- **Kabul/ölçüm:** No-op sync'te map kimliklerinin korunması; remote delta ile inflight local patch yarışı, başarısız mirror rollback, tombstone ve restart parity testleri.
- **Kaynak:** server/server.js:425 · server/server.js:435 · server/lib/delta-store.js:253

## DS-11 · Öncelik C · Efor M · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Peer metadata taraması farklı cihazlarda ardışık RTT biriktiriyor
Peer head'leri ve gereken klasör listeleri sırayla bekleniyor. Head/checkpoint erken atlama ve applied-package suppression mevcut, fakat değişiklik olmasa bile cihaz sayısı kadar ardışık metadata erişimi gerekebiliyor.
- **Öneri:** Farklı cihazların head/list okumasında ölçülmüş sınırlı concurrency; aynı cihaz paketlerini sıralı uygulamak. Yüksek cihaz sayısında hub service/change feed seçeneğini değerlendirmek.
- **Kazanç:** Yüksek SMB RTT ve çok cihazda sync turunu kısaltabilir; gerçek RTT/cihaz sayısı ölçülmeden kazanç oranı bilinmiyor.
- **Risk:** Orta: aynı cihaz olay sırası ve ağ eşzamanlılık sınırı korunmalı.
- **Kabul/ölçüm:** 10/50/200 peer ve gerçekçi RTT ile tur süresi/ağ çağrı sayısı; sırasız tamamlanan okumalarda deterministik uygulama, timeout ve corrupt paket davranışı.
- **Kaynak:** server/lib/sync-settings.js:615 · server/lib/sync-settings.js:622 · server/lib/sync-settings.js:645

## DS-12 · Öncelik B · Efor M
_Codex kanıt düzeyi: Doğrulandı_
Ham source cache byte bütçesi ve kalıcı worker havuzu yok
Compressed LRU 48 MB ile sınırlı; ham sourceCaches yalnız 24 saat idle eviction kullanıyor, toplam byte/kullanıcı sınırı yok. Projection işleri global kuyrukta ama her işte yeni worker ve büyük workerData clone'u üretiliyor; split plan kaynakları iki worker'a kopyalıyor.
- **Öneri:** Ham source cache için byte bütçesi/LRU; aynı immutable source generation'ını güvenli paylaşmak; küçük sabit worker havuzu, aynı generation işleri için birleştirme ve eskimiş işleri iptal etmek.
- **Kazanç:** Uzun oturum/çok profil ve büyük veri setlerinde RSS tavanını kontrol eder; worker startup ve veri kopyalama maliyetini azaltabilir.
- **Risk:** Orta: ortak kaynak generation paylaşılırken scope/yetki izolasyonu; worker concurrency artışında peak bellek korunmalı.
- **Kabul/ölçüm:** Tek/çok profil oturumu, 30k/100k satır, art arda refresh ve iptal testlerinde peak RSS/GC/worker queue süreleri; kullanıcılar arası veri izolasyonu.
- **Kaynak:** server/server.js:6644 · server/server.js:6650 · server/lib/page-projection-cache.js:20 · server/lib/projection-worker-client.js:8 · server/lib/projection-worker-client.js:32

## INT-01 · Öncelik A · Efor M · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Ortak ASAS/IAS sonucunu hedef başına yeniden parse etme
runRoleScopes aynı bağlantı/kapsam sorgusunu tekilleştirip aynı run nesnesini hedeflere dağıtıyor. loadFromModelConnections ise CP, Orders, Backlog ve Price Analysis için parseASASRows'u; IAS hedefleri için parseAntrepoRows'u yeniden çağırıyor.
- **Öneri:** Yenileme ömrüyle sınırlı run + matchRule + parserVersion memoization uygula. Büyük DB sonuçlarını Excel yolu gibi worker içinde parse et. Ortak parse sonucunu mutable hedef state'iyle karıştırma.
- **Kazanç:** 30.000 sentetik kayıt -> 30.000 order tek parse 946,5 / 668,8 / 694,2 ms ve 137-139 MiB geçici heap artışı. Aynı kapsam dört hedefi besliyorsa dört parse yerine bir parse; bu kısmın yinelenen CPU/alloc maliyeti kalkar.
- **Risk:** Orta: tüketicilerin ortak order nesnelerini değiştirmesi halinde immutable taban ve hedef overlay ayrımı gerekir.
- **Kabul/ölçüm:** Ortak/ayrı kapsam, farklı match rule, farklı target ve null-LFL senaryolarında sonuç eşitliği; parse çağrı sayısı, event-loop gecikmesi ve peak RSS ölçümü.
- **Kaynak:** server/lib/model-refresh.js:1084 · server/lib/model-refresh.js:1325 · server/lib/model-refresh.js:1398 · server/lib/parse.js:1329

## INT-02 · Öncelik A · Efor M
_Codex kanıt düzeyi: Doğrulandı_
AI/Studio XLSX ve PPTX üretimini backend ana iş parçacığından ayır
Çıktı servisi renderWorkbook/renderPresentation'ı HTTP route'tan senkron çağırıyor; OOXML ZIP her parçada deflateRawSync kullanıyor. Store ve draft yazımları da senkron.
- **Öneri:** Ortak bellek bütçeli çıktı kuyruğu ve worker kullan. Sonuç Buffer'larını transfer et; dosya/index işlemlerini async ve atomik tut. Mevcut Backlog Excel worker yaklaşımını genişlet.
- **Kazanç:** 5.000 x 40 hücre sentetik render 354,5 / 320,4 / 297,0 ms senkron CPU ve 54-88 MiB heap artışı. Worker toplam export süresini mutlaka azaltmaz; diğer API ve senkron işlemlerinin bu aralıkta beklemesini önler.
- **Risk:** Düşük-orta: renderer modüllerindeki global layout state nedeniyle aynı worker içinde eşzamanlı render yapılmamalı veya state instance'a taşınmalı.
- **Kabul/ölçüm:** Aynı çıktı için OOXML/biçim eşitliği, eşzamanlı export ve normal API p95 gecikmesi, queue wait, peak RSS, iptal/timeout.
- **Kaynak:** server/lib/lcwai-output/output-service.js:125 · server/lib/lcwai-output/output-zip.js:37 · server/routes/lcwai-routes.js:262 · server/lib/lcwai-output/output-pptx.js:29 · server/lib/lcwai-output/output-drafts.js:35

## INT-03 · Öncelik A · Efor L · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
PLM görsel indirmede toplam bayt belleğine sınır koy
Sekiz aktif indirme limiti toplam görsel belleğini sınırlamıyor: runBounded her sonucu results dizisinde tutuyor; sync servisi bütün indirmelerden sonra Buffer'ları ready dizisinde biriktirip tek commit yapıyor.
- **Öneri:** İndirme -> doğrulama -> küçük kanonik commit -> Buffer bırakma zincirine byte budget ve backpressure ekle. URL/kimlik dedup ve güvenli checkpoint'i koru.
- **Kazanç:** Bellek O(tüm indirilen bayt) yerine O(inflight + commit batch baytı). İlk başarılı görseller daha erken görünür. Gerçek PLM görsel boyutları ölçülmedi.
- **Risk:** Orta-yüksek: manual ownership, iptal, revision ve dropOldFiles davranışı parça commitlerinde korunmalı.
- **Kabul/ölçüm:** Binlerce sentetik değişken boyutlu görselde peak RSS, ilk görünür görsel, toplam süre; kısmi hata, iptal, manuel görsel ve eski dosya temizliği testleri.
- **Kaynak:** server/lib/plm-image-download-queue.js:238 · server/lib/plm-image-sync-service.js:333 · server/lib/plm-image-sync-service.js:361 · server/server.js:4889

## INT-04 · Öncelik A · Efor S · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Yerel görseller için gereksiz ortak klasör taramasını kaldır
model-image-distribution bütün modeller için shared lookup'u önce yapıyor; mode=missing ile yerelde bulunduğu için atlanacak kayıtlar daha sonra ayrılıyor. lookupMany her çağrıda cihaz heads ve manifestolarını okuyor.
- **Öneri:** Önce yerel/manual/role kontrollerinden unresolved listesini çıkar; yalnız bunları shared lookup'a gönder. Tümü yereldeyse ortak klasör turunu atla. Manifestleri cihaz revision'ına göre cache'lemeyi de değerlendir.
- **Kazanç:** Tamamen yerel missing senaryosunda SMB metadata turu sıfırlanır. Ağ gecikmeli ortamlarda yüksek kazanç adayı; Windows/SMB süreleri ölçülmedi.
- **Risk:** Düşük-orta: mevcut yerel/manual/role ve kaynak önceliği aynen korunmalı.
- **Kabul/ölçüm:** Yerel hit, role refresh, manuel koruma, shared manuel ve kaynak ayrımı sonuç eşitliği; SMB işlem sayısı ve wall time karşılaştırması.
- **Kaynak:** server/lib/model-image-distribution.js:217 · server/lib/model-image-distribution.js:250 · server/lib/shared-image-store.js:325

## INT-05 · Öncelik B · Efor L · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Ortak görsel pack yayınını işlem bazında grupla
publish her entry için seri putPackedContent bekliyor. Her yeni nesne pack lease/open/stat/write/fsync/head JSON ve içerik index oku/yaz döngüsü yapıyor; manifest sonra yayınlanıyor.
- **Öneri:** Aynı pack'e çoklu görseli tek batch append, tek fsync ve head yayınıyla yaz. Hash prefix index güncellemelerini grupla. Mevcut pack dedup mimarisini koru.
- **Kazanç:** SMB round-trip ve küçük metadata yazımı sayısı düşer. Gerçek Windows/SMB kazancı ölçülmedi; yerel diskteki kazanım daha düşük olabilir.
- **Risk:** Yüksek: pack baytları kalıcı olmadan locator/manifest yayımlanmamalı; lease ve crash recovery korunmalı.
- **Kabul/ölçüm:** SMB round-trip/bytes, 200-1.000 görsel publish süresi; her commit aşamasında kill/restart, iki cihaz yarışı, dedup ve silme senaryoları.
- **Kaynak:** server/lib/shared-image-store.js:390 · server/lib/shared-image-store.js:419 · server/lib/shared-image-store.js:502 · server/lib/shared-image-store.js:539

## INT-06 · Öncelik B · Efor M · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Power BI checkpoint'i bütün sonuç yerine artımlı tut
Her batch sonrasında tüm order state'leri sayılıyor; büyüyen allRows/orderStates kopyalanıyor ve checkpoint synchronous stringify/write/rename ile tamamen yeniden yazılıyor. Varsayılan batch 250.
- **Öneri:** Batch sonucu append journal, artımlı sayaç ve periyodik atomik snapshot kullan. Progress event'inde bütün manifest yerine sayaç/delta taşı.
- **Kazanç:** Yaklaşık O(N²/batchSize) tekrar kopyalama/serileştirme yerine artımlı çalışma. Uzak sorgu hızlıysa yerel overhead payı belirgin düşebilir; kurumsal servis ölçülmedi.
- **Risk:** Orta: resume bütünlüğü ve SUCCESS/NOT_FOUND/FAILED kapsamı korunmalı.
- **Kabul/ölçüm:** 30k/100k order, batch ve split retry senaryolarında checkpoint byte toplamı, CPU ve peak RSS; her batch'te kill/resume ve final coverage eşitliği.
- **Kaynak:** server/lib/power-bi-import-dashboard.js:499 · server/lib/power-bi-import-dashboard.js:568 · server/lib/power-bi-import-dashboard.js:636 · server/server.js:7257

## INT-07 · Öncelik B · Efor M · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
PLM BOM için ortak concurrency ve retry bütçesi
BOM dış target havuzu beş, Set Style başına child havuzu yine beş. İç içe havuzlar aynı anda 25 child isteğe çıkabilir. API client retry'ının üzerinde BOM işi üç tam retry turu çalıştırıyor; ortak semaphore görünmüyor.
- **Öneri:** Endpoint/owner başına ortak semaphore, toplam retry/deadline bütçesi, geçici/kalıcı hata ayrımı, Retry-After ve jitter uygula. Üst job iptalini aktif fetch AbortSignal'ına bağla.
- **Kazanç:** 429/timeout kuyrukları ve gereksiz retry trafiği sınırlandırılır; p95 süre ve iptal tepki süresi iyileşebilir. Kurumsal kapasite ve mevcut 429 oranı ölçülmedi.
- **Risk:** Orta: kısmi başarı ve kullanıcının yeniden deneme tercihi korunmalı.
- **Kabul/ölçüm:** Sahte 429/5xx/timeout ve beş Set Style x çoklu child ile maksimum aktif istek sayısı; toplam attempt, cancel-to-stop, kısmi başarı ve auth recovery.
- **Kaynak:** server/lib/plm-bom-sync.js:24 · server/lib/plm-bom-sync.js:253 · server/lib/plm-bom-sync.js:304 · server/lib/plm-bom-sync.js:308 · server/lib/corenectum-api-client.js:58

## INT-08 · Öncelik B · Efor M · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Tablo için ingest sonrasında preview türevi üret
getThumbnail bugün orijinal source'u döndürüyor. Bu bilinçli karar: render sırasında canvas thumbnail üretimi önceki akışta import'u geciktirmiş ve görsel kalitesini bozmuş.
- **Öneri:** Orijinali koru; ingest sonrasında arka planda kalite kontrollü preview üret. Tabloda preview, drawer/zoom/clipboard/export'ta original kullan. Render anında canvas üretimine geri dönme.
- **Kazanç:** Büyük orijinallerde decode belleği, scroll ve ilk görüntü maliyeti düşebilir. Mevcut görsellerin piksel/byte dağılımı ölçülmedi; kazanç hipotezdir.
- **Risk:** Orta: preview tasarım ayrıntısını kaybetmemeli; original ve export kalitesi korunmalı.
- **Kabul/ölçüm:** 96/192/384 px preview kalite incelemesi; decoded image memory, first-image ve scroll frame süresi; original export byte eşitliği.
- **Kaynak:** public/model-image-cache.js:176 · public/model-image-cache.js:182

## INT-09 · Öncelik A · Efor S · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
LCW AI streaming sırasında yalnız aktif mesajı güncelle
rAF paint batching mevcut, ancak her streaming paint'te tüm sohbet geçmişi Markdown parse edilip innerHTML ile baştan kuruluyor. Eski AI mesajları da tekrar md() çağrısı alıyor.
- **Öneri:** Tamamlanmış mesajların DOM'unu ve güvenli Markdown sonucunu cache'le. Yalnız aktif yanıt düğümünü güncelle; streaming render'ını 30-60 ms bütçeyle sınırla, uzun geçmişi gerektiğinde window'la.
- **Kazanç:** Streaming işi sohbet geçmişinin toplam boyutundan bağımsızlaşır; daha az DOM/Markdown CPU, daha stabil seçim ve scroll. Gerçek uzun sohbet profili ölçülmedi.
- **Risk:** Düşük: Markdown sanitizasyonu, tamamlanmamış code fence ve son render korunmalı.
- **Kabul/ölçüm:** 100 mesaj ve uzun yanıtla scripting/long task/frame süreleri; Markdown/XSS regression, kullanıcı scroll konumu ve metin seçimi.
- **Kaynak:** public/lcwai-chat.js:687 · public/lcwai-chat.js:709 · public/lcwai-chat.js:866 · public/lcwai-chat.js:886

## INT-10 · Öncelik C · Efor S · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
LCW AI ek yüklemelerinde sınırlı paralellik
askWithFiles en fazla beş dosyayı tek tek await ederek yüklüyor.
- **Öneri:** Owner başına en fazla iki upload concurrency dene; hata olursa kalanları iptal et. Gerekirse owner+hash+upstream expiry ile aynı oturumda ek tekrar kullanımını araştır; token veya özel veri saklama kapsamını genişletme.
- **Kazanç:** Upstream bağımsız upload'u kaldırıyorsa upload aşaması kısalır; kurumsal servis üzerinde ölçülmedi ve kazanç hipotezdir.
- **Risk:** Düşük-orta: tüm ekler hazır olmadan mesaj gönderilmemeli; upstream kapasitesi doğrulanmalı.
- **Kabul/ölçüm:** Bir/beş ek, yavaş ağ ve bir ek hatasıyla total upload time; attachment sırası, cancellation ve yarım bağlamla mesaj gönderilmemesi.
- **Kaynak:** server/lib/lcwai/lcwai-engine.js:93 · server/lib/lcwai/lcwai-config.js:69

## INT-11 · Öncelik B · Efor M · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Parser kuyruklarında öncelik ve işe özel batch
Genel parser client tek aktif process kullanıyor. Test-report isolated-extract dosya başına seri Parser.run çağırıp her dosya için yeni process açıyor; uzun importlar diğer parser işlerini bekletebilir.
- **Öneri:** İş sınıfı/öncelik kuyrukları ve ortak RAM admission ekle. Çoklu rapor dosyasını aynı işe özel limitli process'te batch parse ederek açılış maliyetini azaltmayı ölç. Kullanıcılar arasında sıcak untrusted parser havuzu kurma.
- **Kazanç:** Küçük kullanıcı aksiyonlarının uzun import arkasındaki beklemesi ve dosya başına process açılış overhead'i azalabilir. Gerçek dosya dağılımı ölçülmedi.
- **Risk:** Orta: process izolasyonu, 256/768 MiB heap, ZIP genişleme sınırı, timeout ve iptal korunmalı.
- **Kabul/ölçüm:** Küçük/büyük ve kötü amaçlı ZIP/PDF setlerinde queue p95, spawn overhead, peak RSS; kullanıcılar arası izolasyon, timeout ve iptal.
- **Kaynak:** server/lib/parser-process-client.js:3 · server/lib/test-reports/isolated-extract.js:5 · server/workers/file-parser-process.js:3

## INT-12 · Öncelik C · Efor M · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
OAB kombinasyonlarında kontrollü paralellik denemesi
OAB kalan kombinasyonları seri çekiyor. Doğrulanmış buyer-group batching ve fresh cache zaten var; yeniden batch ekleme önerisi mevcut çözümü tekrarlamış olur.
- **Öneri:** Önce batch capability/cache hit oranlarını ölç. Sonra bağımsız kombinasyonlarda iki paralellik A/B denemesi yap. Sınırsız Promise.all kullanma; kısmi başarı, iptal, continuation ve auth recovery korunmalı.
- **Kazanç:** Uzak servis izin verirse toplam bekleme kısalır. Kurumsal OAB kapasitesi ve gerçek kazanç ölçülmedi; öneri koşulludur.
- **Risk:** Orta-yüksek: login recovery ve transport ortak durumu, yetki iptali ve servis kapasitesi doğrulanmalı.
- **Kabul/ölçüm:** Aynı kombinasyon setinde seri/iki paralel p50/p95, hata ve throttling; auth expiry, access revoke, iptal ve devam sonuç kapsamı eşitliği.
- **Kaynak:** server/lib/oab-batch-service.js:104 · server/lib/oab-batch-service.js:136 · server/lib/oab-batch-service.js:145

## CARD-01 · Öncelik C · Efor M · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Kart listesi ile seçili detayı ayrı güncelle
Üreticiler render() her seçim/filtrede listeyi ve detay HTML’ini beraber yeniden kuruyor. Lisanslar render() liste ve sayaçlar için ayrı E.rows geçişleri yapıp bütün görünümü yeniden kuruyor. Rehberde de liste+detay birlikte üretiliyor. Katalog büyüklüğü bilinmediğinden bunun baskın darboğaz olduğu söylenemez.
- **Öneri:** Revizyon anahtarlı tek liste view-model’i, kararlı satır kimlikleri ve yalnız seçilen detay için ayrı render. Gerçek katalog satır sayısı/trace gerektirirse ortak sayfalama veya virtualization ekle.
- **Kazanç:** Büyük kart/rehber listelerinde gereksiz DOM ve filtre hesapları azalır; mevcut cache’ler korunur. Nicel üretim kazancı ölçülmedi.
- **Risk:** Düşük/orta; taslak, imleç, scroll, aktif kilit ve filtre durumları korunmalı.
- **Kabul/ölçüm:** 500/5.000 sentetik kartta arama, kart seçimi ve taslak kaydı; focus/scroll/lock doğruluğu ve p95 render süresi.
- **Kaynak:** public/manufacturers.js:338 · public/license-cards.js:225 · public/license-cards.js:304 · public/email-groups.js:305
