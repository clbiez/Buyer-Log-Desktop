# SYNC uçtan uca çalışma kaydı

Bu klasör 2026-10-25 başlayan çalışmanın 2026-10-26 UTC devamını içerir. Nihai ölçümler `final-report.md` ve `final-results.json` içinde verilecektir. Ara başarısız koşular korunmuştur; tekrar sayısı bir kabul koşulu değildir.

## Devralma ve topoloji

Başlangıç main: `499c1718d228afbd41d7ebff2c1a2b68629137dd`. Referans `4a70aa152d1b4eb3279ddebda19679ca2639b372` ve eski tam regresyon kaynağı `62e9f4a7b65d6eae3b6e2fc85d48c194db6972c9` uygulama ağacı `5868505035e00bace8a1307198156010c9be3d71` ile aynı. Dosya bazında devralma: `inheritance.json`, tam değişiklik listesi: `reference-diff.txt`. Başlangıçta değişen sunucu kaynakları auth, central IAM, server ve ilgisiz AI çıktı temasıdır; istemci de değişmiştir. Bu nedenle eski yetkilendirme/UI sonuçları yeni sonuç yerine kullanılmadı. Değişmeyen finans motoru, vektörler, yerel DB ve Shared Hub protokolünün eski kanıtları tarihî kanıt olarak korundu.

Önceki 7.799 test, 20.000 işlem simülasyonu ve 30.000 siparişli Electron benchmarkları yeniden geliştirme kontrolü olarak çalıştırılmadı. Yeni final ile karıştırılmamalıdır.

Gerçek ürün yerel backend/veri kökü + dosya tabanlı Shared Hub + HTTP/SSE kullanır. Bağımsız browser context tek başına bağımsız cihaz değildir. Yeni sürücü her backend için ayrı server/app/local/auth/temp/config kökleri oluşturur. Merkezi yerel hub bir sentetik dosya sistemi köküdür. Gerçek SMB/UNC/OneDrive sağlayıcısı yoktur. Bunların lock/rename/offline/sağlayıcı semantiği doğrulanmış değildir. SQL havuzu, WebSocket ve tenant eklenmedi. Collection owner+grant izolasyonu test edilir.

## Kalıcılık ve davranış sözleşmesi

* Tarayıcı pending taslağı yerel kurtarma kopyasıdır; backend kabulü değildir.
* Collection worker gerçek dosya lease altında revizyon/yetki kontrolü ve atomik kalıcı dosya yazımından sonra kabul döner. HTTP 200 içindeki `applied` ve `conflicts` ayrı okunur. `replication` ayrı teslim durumudur. UI “bu cihazda kaydedildi” seviyesini ayırır. Fiziksel disk güç kaybı dayanıklılığı/SMB sunucu flush garantisi ölçülmedi.
* Aynı backend satır CAS uygular; farklı alan olsa bile aynı satırın bayat sürümü reddedilebilir. Kendi alanında mevcut otomatik üç yönlü yeniden tabanlama politikası korunur. Farklı backendler dosya protokolüyle üç yönlü alan birleştirmesi yapar; aynı alanda önce yayımlanan değer kalır, kaybeden değer Sync Conflicts kaydına alınır.
* Satır silme revizyona tabidir. Silinmiş satırın eski düzenlemesi yeni kayıt sayılmamalıdır. Yeniden deneme aynı ID kullanır; protokolde olmayan global exactly-once iddiası yapılmaz.
* Çevrimdışı Collection taslağı yerelde tutulur, hata/yerel durum gösterilir, yeniden bağlanınca gerçek uygulama kaydı çağrılır. Sayfa yenileme taslağın özgün sürümünü korumalıdır.
* TR maliyet iki ondalığa yuvarlanıp çarpan uygulanır; YD ara maliyet yuvarlanmadan çarpılır. Tarih/FX fallback ve fiyat geçmişi beklentisi BL017 ve mevcut vektörlerden gelir. FX ayı tam eşleşme, önceki ay, yoksa ilk ay sırasındadır. Manuel kur/fiyat otomatik kaynak değişince korunur.
* Pricing, FX ve transit sürümleri farklı kaynaklardır; eşit sürüm numarası dayatılmaz. Koleksiyon hesaplama lineage alanları gerçek kaynak snapshotlarıyla ve bağımsız aritmetikle karşılaştırılır. CP transit tarihi bağımsız UTC takvim hesabıyla kontrol edilir.
* Mevcut lisans peer sözleşmesi eski Master içeriğini geçersiz sayabilir. Daha yeni Master değişikliği sonrasında eski peer'in geçici geri uygulaması gözlendi; açık manuel sync turlarıyla yakınsama doğrulandı. `license-card-sync.test.js` bunu açıkça beklediği için otomatik politika değişikliği yapılmadı. Kullanıcıya sorulan öncelik kararı yanıtsızdır. Bu matematik hatası olarak sınıflandırılmadı; kaynak önceliği/tutarlılık riski olarak ayrıldı.

## Bulgular ve değişiklikten sonra yapılan kontroller

| Bulgu | Küçük tekrar / kök neden | Düzeltme | Kanıt |
|---|---|---|---|
| Silinmiş satır eski save ile diriliyor | Aynı satırı okuyan A düzenlerken B siler; missing ID create yoluna giriyordu | expected-existing intent, legacy pozitif rev koruması; açık row-missing çatışması | deleted-stale-red/green.log; controlled-1 delete-before-stale-save |
| Kuyrukta bekleyen save iptal edilmiş yetkiyle kabul ediliyor | Ayrı süreç workspace lease tutar, PATCH bekler, grant iptal edilir | Worker kilidi aldıktan sonra ve commit öncesinde güncel kullanıcı/grant/credential kontrolü; native PATCH+PUT actor guard | revocation-red.log gerçek 200; green.log gerçek 403; worker testleri; controlled-revoke-ui-2 |
| Boş metin normalizasyonu yanlış cihazlar arası çatışma üretiyor | B'nin model değişikliği ile A'nın farklı specialCode alanı; renderer missing metni boş string yapıyor | Yalnız canonical text/code alanlarında absent/null/empty eşdeğerliği; finansal/nested değerlerde aynı kural uygulanmaz | empty-text-red/green; controlled-extra-7 gerçek UI+iki backend |
| Geç GET son kabulü geri alıp eski değeri yeniden yazabiliyor | GET temizken başlar; arada edit+ACK; eski yanıt sonra gelir | Owner/revision/baseline/dirty/save/focus kontrolü, bayat yanıtı atma ve taze okuma; SSE revision geriye gidemez | targeted-4 gerçek kalıcı yanlış değer kanıtı; late-read ve SSE RED/GREEN; controlled-late-read-final |
| Yenilemede taslak özgün CAS/existence bilgisini kaybediyor | Offline edit, peer delete/add, reload | Schema2 orijinal baseline+intent; yalnız yerel delta restore; remote-only eklemeler korunur; create collision açık row-exists; legacy taslak belirsizliğinde ihtiyatlı mevcut satır beklentisi | review-findings-red/green; pending-draft-recovery testleri; review-offline-ui-* |
| Odaklı temiz editör sonsuz tam GET üretiyor | Editor odaklı, reload olayı; guard false, 200ms retry | Focusout'a kadar owner flag ile defer; HTTP polling yok | review-findings-red/green, focused-editor testi |
| Açılışta seçili alan yerine kişisel boş alan başlatılıyor | Yetkili ortak scope seçiliyken reload; uyumluluk cache'i yanlış owner'a taşınabiliyor | Kaydedilmiş yetkili tek scope'u ilk fetch öncesinde seç | Bootstrap VM regresyonu; review-offline UI |

Bir bağımsız, salt-okuma reviewer turu yapıldı. Son iki taslak/focus açığını buldu; tekrar reviewer turu açılmadı. Raporlanan testlerin ardından gerekli kaynak değişiklikleri bu kayıtta ve loglarda izlenir.

## Sürücü/fixture düzeltmeleri (ürün hatası sayılmadı)

İlk TR oracle ara yuvarlamayı atlıyordu; BL017 ile düzeltildi. Yanlış enabled/status fixture ACTIVE kaldığı için gerçek iptal değildi; INACTIVE düzeltildi. Playwright route `times:1` ilgisiz GET'i tüketebiliyordu; gerçek PATCH seçici ve bounded deadline kullanıldı. Route gerçek yanıt beklenmeden unregister edilmemelidir. İlk CP tarih karşılaştırması Date.toString ile ISO'yu karşılaştırıyordu; UTC ISO düzeltildi. Sürücü hazır süreç yerine eski portu kabul edebiliyordu; yeni süreç logunda SERVER_READY zorunlu oldu. Son reload sürücüsü app boot tamamlanmadan native scope seçiyordu ve localStorage anahtarını BLStorage namespace'i olmadan yazıyordu; gerçek kolLoadWorkspaceBatch ile kapsam tercihi kaydedilir ve boot beklenir. Bu başarısız denemeler saklanır.

`pre-final` 3 kullanıcı/3 backend/65 saniye ve önceki kısa smokelar geliştirme kanıtıdır; 50 kullanıcı veya final 30 dakika yerine sunulmaz. Final tam test ve yük ayrı sırada yürütülür.

## Ölçüm sınırları

Gerçek signed token 12 saat geçerlidir; kısa test browser cookie kaybını/yeniden girişi doğrular, 12 saatlik gerçek expiry sınırını değil. İki moderatör CAS testi iki kimliği doğrulanmış BrowserContext.request istemcisidir; iki moderatörün UI tıklama testi olarak sunulmaz. Normal moderator kural değişiklikleri ve günlük kullanıcı işlemleri gerçek UI'dadır. HTTP ağ baytları tamamlanmış isteklerden gelir; açık SSE akışları ve setup trafiği dışında tutulur. `/proc` RSS toplamları paylaşılan sayfaları birden fazla sayabilir; container memory.current ayrıca verilir. Dosya lease beklemesi kontrollü senaryoda ölçülür; ürünün sunmadığı ayrıntılı global kuyruk telemetrisi varmış gibi sayısal değer uydurulmaz.

## Final öncesi main güncellemesi

Tekrar fetch sonucunda main `94df09447834c82adc964e772360614344472313` oldu. Çalışma bu main üzerine rebase edildi. Yeni farklar Motion+, tablo başlık/özet hizalama ve çıktı editörüdür; SYNC/finans motoru değişmedi. Kaynak/test farkları `main-refresh.json` içinde. Son hedefli 45 test, i18n 0 eksik ve 8 not doğrulaması önceki main üzerinde tamamlanmıştı; final tam paket ve yeni kısa UI smoke entegre kaynakta çalıştırılır. Sürüm notu çatışması ID bazında birleştirildi, main'in Smart Layout Studio kaydı korunur (toplam 9 not). Motion+ talimatı okundu; bağımsız animasyon eklenmedi.

Son taslak tekrarları `review-offline-ui-1..7` tek bir açığı daraltan kontrollü denemelerdir; başarılı sayılmadı. Storage yazma stack'leri renderKol → kolSyncRulePricing → saveKolRows yolunun restore öncesinde taslağı ezdiğini kanıtladı. Baseline capture ve taslak restore render öncesine alındı; baseline yokken render otomatik kayıt yapmaz. `review-offline-ui-8` geçti. `review-focus-ui` 1.100 ms odak gözleminde sıfır tam GET ve focusout sonrasında gerçek GET ile geçti. `blocking-revoke-final` başka owner kaydını gerçek lease tutulurken 63 ms'de kabul etti, bekleyen iptal edilmiş işlem 403 aldı.

## Final tam paket: ilk deneme

`f5e5f21b` kaynağında standart runner 1.118 dosyayla başladı. İlk batch 75,7 saniyede iki fixture/sözleşme hatasıyla durdu; `full-suite-attempt-1-failed.log` saklanır. Checklist VM'i yeni baseline/dependency'leri yüklemiyordu; gerçek draft merge yardımcıları ve başlangıç snapshot'ı eklendi, hiçbir kullanıcı beklentisi kaldırılmadı. Güncellenen main'in eski KPI kaynak-regex testi yeni `running.delete(el)` temizliğini ve ilk kare render güvenliğini tanımıyordu; regexler bu daha güçlü güncel dalları açıkça ister. Main'in gerçek Motion+ runtime testleri son metin, yeniden çizim, çakışmama ve reduced motion sınırlarını korur. İlgili üç dosya 32/32 geçti. Ürün kodu bu düzeltmede değişmedi. Son test ağacı değiştiği ve standart runner batch 1'de durduğu için tam paket finalde yeniden başlatılır; yük koşusu hâlâ başlamadı.

## Final tam paket: bağımlılık ortamı düzeltmesi

İkinci deneme (`fac88b0f`) batch 1'i geçti; batch 2 kurulu XLSX 0.18.5 ile lock/public reader 0.20.3 uyuşmazlığında durdu. Mevcut ortamın önceden kurulu node_modules içeriği kilide uygun değildi; kaynak veya lock değiştirilmedi. `npm ci --ignore-scripts` 74 paketi kilitten kurdu. Kurulu ve tarayıcı reader SHA-256 artık aynı: `cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41` (951.904 bayt), sürüm 0.20.3. Üç bağımlılık/parser/FX test dosyası 15/15 geçti. Başarısız log ve memory.events saklanır; büyük Buffer karşılaştırmalarında süreç sonlandırması görüldü, ürün veri kaybı olarak sayılmadı. Tam paketin bağımlılık ortamı değiştiği için standart final baştan çalıştırılır. Önceki kısa XLSX server fixture kontrolleri yeni sürüm sonucu olarak sunulmaz; final UI moderator FX akışı doğru bağımlılıklarla çalışacaktır.

## İlk 50'ye çıkışta bulunan gerçek ürün hatası

`bl-final-50`: 50 hesap/50 backend istendi, 6 browser context ve 6 gerçek backend açıldı; ölçüm başlamadan op-20261025-27 durdurdu. Bu bir kapasite sınırı olarak sınıflandırılmadı (tepe bellek yaklaşık 4,50 GiB; guard tetiklenmedi). Sunucu satır 4 için expectedRev5/currentRev6 ile `applied:[]`, açık `row-revision` reddi döndü. Sonraki reload olayı `kolPersistPendingWorkspace('remote-change')` üzerinden bu ret rozetini `local` (“Bu cihazda kaydedildi”) yaptı. Yani reddedilmiş taslak için yanlış başarı bildirimi vardı. Browser localStorage taslağı saklamak da aynı `local` etiketini kullanıyordu.

Düzeltme: yeni TR/EN `draft` durumu sunucuya kaydedilmediğini açıkça söyler; uzak olay önceki conflict/failed durumunu korur. Sending, backend durable-local ve sharing-pending ayrı kalır. RED hedefli testler iki sorunu kanıtladı; GREEN 38/38 ve ardından genişletilmiş ilgili kontroller geçti. Gerçek iki kullanıcılı bariyerli CAS reddinden sonra remote reload handler'ı aynı şekilde tetiklenerek UI'de conflict korunması doğrulandı (`bl-final-feedback`, gerçek backend yanıtı). Post-change PNG incelendi. Native request/ACK taklidi yoktur.

Yarım kalan koşunun özgün dosyaları `pre-recovery-device-*` olarak saklandı. 6 gerçek backend soğuk açılıp native GET ile incelendi: son kabul edilmiş yazıların origin ve diğer kalıcı köklerde açıklamasız kaybı yok (`ownMissing:[]`, `coldMissing:[]`). Op27 zaten reddedilmişti; kayıp sayılmaz. Kapanış sonrasındaki “page closed” hataları ayrı cleanup sonuçlarıdır. `failed-run-recovery.json`, ilk failure.json ve tüm journal korunur. Topoloji ve süre 50 kullanıcı/30 dakika olarak sunulmaz.

Tam paket fac88b0f üzerinde 1.118 dosya/7.908 test (7.843 pass,0 fail,65 skip),273,4 saniye ile geçmişti. Yeni gerçek final bulgusu ortak persistence primitive'ini ve kullanıcıya verilen kalıcılık sözünü değiştirdiği için ilgili kontrollerden sonra son kaynakta tam paket yeniden yapılır; sonra 50'ye çıkış etkilenmiş final bölümüdür ve yeniden çalıştırılır. Bu, geliştirme boyunca alışkanlıkla full/uzun yük tekrarı değildir.
