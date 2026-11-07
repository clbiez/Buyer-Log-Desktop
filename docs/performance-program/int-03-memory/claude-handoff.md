# INT-03 — ana sohbet entegrasyon ve tek P1 inceleme paketi

**Bu bir gönderim taslağıdır; Claude'a veya başka sohbete mesaj gönderilmedi.**
Kullanıcı üzerinden en fazla **bir** bağımsız Claude inceleme turu için hazır.
Üretim düzeltmesi ve nihai review Faz 7 sırasını bekler. Hazırlık incelemesi
üretim düzeltmesinin P1 kabulünü tamamlamaz.

## Ana sohbetten istenen entegrasyon

Bu dal üretim koduna özgün değişiklik eklemedi. #885 sonrası Main `63159fb3`
normal merge ile alındı; kanonik ingest/ownership/PLM revision blokları aynı.
Uyumluluk kaydı `main-compatibility/source-comparison.json` içinde. Tarihsel
ölçümler kendi `5a1656e9` kaynak pinleriyle korunur; yeni kampanya başlatılmadı.

Faz 7'de `server.js` ve gerekiyorsa mevcut ortak compute havuzu entegrasyonunu
ana sohbet üstlensin. **Worker gereksinimi ayrıca kanıtlanacak; worker'a taşımak
tek başına bellek sınırı çözümü sayılmayacak.** Bu sohbette yeni worker veya
paralel havuz kurulmayacak. `model-image-distribution.js`, `shared-image-store.js` Claude
sahipliğinde; `app-main.js`, `index.html`, `perf-runtime.js`, CSS salt okunur.
#892 istisnası bu sohbete app-main düzenleme izni vermez.

Önce ana sohbette şu sözleşmeleri somutlaştırın:

1. Byte budget süreçte eşzamanlı sync işleri arasında ortak olmalı. Rezerve
   edilen baytlar transfer, doğrulama ve kalıcı commit bitene kadar sahipli
   kalmalı; yalnız HTTP bitince permit bırakılmamalı. Bilinmeyen/yanlış
   Content-Length ve 20 MiB tek görsel sınırını chunk gelmeden hesaba katın.
   chunks+concat örtüşmesi, base64 string ve `saveCollectionImage` decode
   kopyası için headroom tanımlayın; yalnız `image.size` saymak RSS sınırı değildir.
   İndirme, doğrulama ve commit bekleyen Buffer'ları birlikte sayın.
   RSS ve reservation bütçesini ayrı metrikler olarak raporlayın.
2. Mevcut kuyruk concurrency üst sınırını koruyun. Hem in-flight hem commit
   batch baytı sınırlansın. Dolan bütçe yeni indirmeyi durdursun; yavaş commit
   sırasında waiter yığını veya dedup Buffer cache'i oluşmasın. Buffer'lar
   results, ready, retry closure ve URL tablosunda iş boyu tutulmasın.
3. Attachment kimliği URL dedup'u iş boyunca korunsun. Farklı URL'lerin aynı
   baytları mevcut tek commit'te dosya paylaşır; batch'ler arasında hash→ref
   bilgisini yalnız küçük metadata ile taşımak için kanonik ingest oturum
   sözleşmesini ana sohbette çözün. Buffer tutarak dedup sağlamayın.
4. `patchPlmImageLinks` her çağrıda revision artırır. Küçük commit'lerde
   revision, optimistic concurrency, ownership ve checkpoint sırası için
   mevcut sözleşmeyle uyumlu açık bir karar/entegrasyon gerekir. Revision
   kontrolünü atlayarak veya fixture validator'ını gevşeterek çözmeyin.
5. Manuel sahipliği commit anında güncel map/store ile tekrar doğrulayın.
   Başarılı önceki batch'ler sonraki hatada kaybolmasın. Commit failure'da yeni
   dosya rollback olsun. Eski ref hiçbir aktif kimlikten erişilmiyorsa ve
   yalnız izin verilen dropOldFiles kipinde silinsin. İptal bekleyen permit'leri
   kapatsın; tamamlanan güvenli yazımlar ve checkpoint'ler tutarlı kalsın.
6. Yerel ilk link, UI'da ilk görünürlük değildir. Route/progress, cache
   invalidation, publish ve istemci gözlem zincirini ana sohbette mevcut
   mekanizmaya bağlayın. Yetki sınırları ve refresh POST retry yasağı korunsun.

## Faz 7 RED→GREEN ve ölçüm matrisi

Hazırlıktaki çalıştırılabilir testler temel sözleşmeleri kapsar. Şu yeni
davranışlar henüz uygulanmadı veya doğrulanmadı; Faz 7'de RED→GREEN gerektirir:

| Senaryo | Zorunlu gözlem |
| --- | --- |
| 2.048 değişken boyut, yavaş commit | Toplam reservation ve batch byte tavanı; Buffer referansları commit sonrasında bırakılır; ilk kanonik link kalan indirmelerden önce |
| İki eşzamanlı sync işi | Aynı toplam bütçe, adalet ve deadlock yok |
| Content-Length yok/yanlış/küçük/büyük; chunked; tek görsel sınırı | Güvenli pre-allocation/transport backpressure, taşmada ve hata/retry'da permit sızıntısı yok |
| Aynı URL ve farklı URL'de aynı içerik, batch sınırları | URL istek sayısı ve kalıcı içerik dedup eşdeğerliği; dosya sayısı/referans bütünlüğü |
| Bütçe/commit beklerken iptal, indirme sırasında iptal | Yeni dispatch yok; tamamlananlar/checkpoint tutarlı; kilit/permit sızıntısı yok |
| Her batch sınırında kısmi indirme/commit hatası | Önceki başarılı linkler kalır; yeni yetim yok; doğru partial/failed/cancelled |
| Manuel görsel, overwriteManual, eşzamanlı manuel değiştirme | Açık kullanıcı kararı dışında manuel ref/ownership korunur |
| dropOldFiles false/true, eski ref başka kimlikte, aynı işte ileri batch'te kullanım | Aktif/gelecek referans silinmez; kaldırma yalnız başarılı linkten sonra |
| Revision ve aynı kaynaktan ikinci koşu | Veri/revision/ownership/no-op sözleşmesi; checkpoint diskten resume; kaynak kimliği sabitken ağ yok |

Bu uyumluluk turunda bellek kampanyası yok. Faz 7 uygulama sırası geldiğinde
önce #885 sonrası güncel Main'de yeni before; sonra aynı #892/Main/harness/
fixture/ortamda en az üç before + üç after, medyan. İşleri zaman içinde AB/BA/AB
sıralamak için her süreç çağrısını ayrı koordine edin; mevcut collector bir
kolu üç ardışık süreçte alır, interleaving yaptığı iddia edilmez. Aynı ortamda
başka ölçüm/test koşmayın. Başarısız koşuları ve trace parçalarını saklayın.
Linux sentetik sonuçları Windows/Electron/gerçek PLM kabulü saymayın.

## Kullanıcı üzerinden tek Claude incelemesine verilecek kapsam

- Sabit review head ve base SHA, yalnız nihai ilgili diff, bu README ve
  `artifacts/before/summary.json`; SHA manifesti ham kanıta bağlar.
- Üretim değişikliği yokken inceleme yalnız tanı doğruluğu ve hazırlık
  eksikleriyle sınırlı. Bu tur henüz kullanılmadı; yeni agent/reviewer açılmadı.
- Özellikle bütçe muhasebesi, batch'ler arası dedup/revision, manual race,
  iptal/partial rollback ve dropOldFiles sınırlarını inceletin. Eşdeğerlik,
  yetki, veri kaybı veya kırmızı zorunlu kontrolde durun.
- Filtresiz `npm test` Faz 6 / son program PR kapısıdır; ilgili testler ve
  PR fast checks yerine geçmez. Kod değişince ilgili kontroller yenilenir.
- Merge öncesinde durun. TEST/STABLE yayınlamayın.

EN: Unsent handoff for the main chat and at most one user-mediated independent
Claude review. Post-#885 Main was merged without rebasing; old measurements keep
their original source pins. The main chat owns server integration and any
separately justified common-pool work; moving work to a worker does not itself
bound memory. Reservation bytes and RSS are distinct metrics. No runtime
implementation or review approval is claimed. Resolve cross-batch content dedup,
revision/manual ownership and safe cleanup before enabling a byte-bounded pipeline.
