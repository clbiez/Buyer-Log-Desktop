# FX tanısının Main entegrasyonu / Main integration of the FX diagnosis

Bu belge güncel entegrasyon kaydıdır. [Önceki tanı raporu](phase-5-fx-timeout-diagnosis.md),
onun manifest/arşivleri ve `diagnose-fx-timeout.js` / testi `6d09a4c2` teslimindeki
baytlarıyla korunmuştur. Eski raporun merge ve doğrulama ifadeleri tarihsel kayıttır.

Birbirinden ayrı kalan iki sonuç:

1. **[Doğrulandı — kontrollü tarihsel deney]** `69950f28` üzerindeki altı kontrollü
   FX timeout'unda 5000 ms bütçe dispatch öncesinde kuyrukta dolar.
2. **[Bilinmiyor — tarihsel normal seri]** Önceki dört timeout'un bireysel nedeni
   hâlâ bilinmiyor. Yeni sonuçlar bu dört olayın geriye dönük açıklaması değildir.

Sabit `69950f289a012f0bb7c61290bec9890f340f6c64` kaynağı **#892'yi içermez**.
Bu tarihsel kanıttan güncel kabul, hızlanma veya bağımsız P1 inceleme sonucu
türetilmez. Bu PR P1 incelemesinin yerine geçmez.

EN: Frozen evidence is unchanged. Controlled queue exhaustion is established;
individual attribution of the historical four timeouts remains unknown. The
frozen source excludes #892 and establishes no current acceptance or P1 review.

## Gerçek GitHub durumu / Actual GitHub state

GitHub API'ye göre [#885](https://github.com/clbiez/Buyer-Log-Desktop/pull/885)
**merged**, kapanış/merge zamanı `2026-11-07T17:56:03Z` (20:56 TSİ), merge SHA'sı
`76ddbaf4a2a85132d2ad9dff8d1465377e1f81aa`. Eski PR açıklamasının “merge yok”
cümlesi güncel durum değildir. [#902](https://github.com/clbiez/Buyer-Log-Desktop/pull/902)
entegrasyonu Main'de `63159fb32ff3d5bdc5f142b4a8f16ca6a3983240` olarak bulunur.

#907 dalı bu Main'i `2d1e2498fe7dccd8acf8fe562716e234d9ecc548` normal merge'iyle
aldı. Rebase/force-push yapılmadı. Main'e göre toplam PR diff'i yalnız tanı
script/test/doküman/kanıt ekler; eski üretim kodunu geri alan değişiklik yoktur.
Main'in #892, kur, profiler, LFL, test ve mevcut release-note değişiklikleri korunur.
#907 merge edilmez; TEST/STABLE yayımlanmaz.

## Salt okunur kaynak karşılaştırması / Read-only source comparison

[Dosya hash karşılaştırması](phase-5-fx-main-evidence/source-comparison.json),
`69950f28` ile Main `63159fb3` arasındaki ilgili akışı bağlar. Compute pool/service,
native compute ve Excel worker, Excel client, FX workbook/parser, DB ve FX route
dosyaları bu iki kaynakta aynıdır. `server.js` çağrı bağlantısı değişmiştir:

- Tarihsel: `serverCompute().runExcelUtility(...)`, background, toplam kuyruk +
  yürütme bütçesi 5000 ms.
- Güncel Main: `runExcelTask(...)`, ayrı mevcut Excel istemcisi; timeout 5000 ms
  ve `serializationKey='shared-fx'` aynı kalır. Sayaç worker constructor'ından
  sonra başlar; kuyruk süresi bu yürütme timeout'una dahil değildir.

Bu bağlantı değişikliği Main'in
`d0bab2acc839fee71a84b436eebe14b6feb57ae7` commit'idir; burada uygulanmadı.
Güncel Main #892'yi içerir. Yeni kontrol dosyaları/eserleri `phase-5-fx-main-*`
adıyla ayrı tutulur; tarihsel `phase-5-fx-timeout-evidence` içine eklenmez.

## Güncel dar doğrulama / Current narrow validation

Nihai seride beş izole sentetik senaryo seri çalıştı. Yeni 30k kampanyası ve refresh
POST'u yok. Gerçek Main fonksiyonu VM'e değiştirilmeden alınır; gerçek DB,
kanonik parser, native Excel istemcisi ve `/api/fx` yanıt handler'ı çalışır.
Kimlik middleware'i sentetiktir; ölçüm HTTP/kimlik veya Windows/SMB kabulü değildir.

| Main senaryosu | Gözlem | FX verisi / revision / durum |
| --- | --- | --- |
| KUR yok, boş Excel kuyruğu | Native Excel işi kabul edildi; compute çağrısı 0 | missing; revision 1 sabit; folderSync null |
| Geçerli KUR, boş kuyruk | Native kuyruk 0.238 ms | apply; revision 1→2; sparse eski aylar korunur |
| Geçerli KUR, Excel kuyruğunda >5 sn bekleme | Kuyruk **6175.791 ms**, yürütme 155.331 ms; timeout yok | apply; revision 1→2 |
| KUR yok, Excel kuyruğu dolu | 2 aktif + varsayılan 64 bekleyen health işi; FX `EXCEL_WORKER_BUSY` ile reddedildi | `parse-failed`; revision 1 sabit; folderSync parse-failed |
| Geçerli KUR, Excel kuyruğu dolu | Aynı varsayılan admission reddi; FX dispatch edilmedi | güncelleme kaçırıldı; revision 1 sabit; `parse-failed` |

“verified” senaryo durumu beklenen davranışın gözlendiğini belirtir; son iki
FX işlemi başarılı değildir. Bütün senaryolarda compute çağrısı **0** ve gerçek
FX seçenekleri `{timeoutMs:5000, serializationKey:'shared-fx'}` olarak kaldı.
Worker sayısı/bellek/pending sınırları değiştirilmedi. >5 sn kontrolü mevcut
altı `diagnosticSpin` göreviyle (her biri 2000 ms), dolu-kuyruk kontrolü mevcut
native health görevleriyle kuruldu; işçilerde yeni geciktirme mekanizması yoktur.
Dolu-kuyruk deneyindeki yardımcı işler gözlemden sonra iptal edilip native exit
beklendi. Gerçek servis veya credential kullanılmadı.

Bu dar kontroller, ortak compute kuyruğundaki tarihsel timeout'un güncel Main
akışında devam ettiğini **göstermiyor**. Güncel Excel kuyruğunun sınırsız bekleme
sağlığını da kabul edilmiş saymıyor. Gösterdikleri: admission reddinin parse
hatası olarak sunulması ve bu reddin geçerli FX güncellemesini atlatması.
Gerçek yürütme timeout'u bu yeni seride üretilmedi; catch'in genel olması tek
başına yeni bir timeout olayı veya tarihsel dört olayın nedeni değildir.

EN: Main now uses the existing dedicated Excel client. A 6.176 s queue wait
still applies valid FX, with unchanged five-second execution timeout. At the
unchanged 64-pending admission limit, EXCEL_WORKER_BUSY is misreported as a
parse failure and a valid update is missed. These are separate current findings.

## Ana sunucu sahibine teslim / Server-owner handoff

| Teslim başlığı | Güncel Main durumu | Ayrı dar düzeltme için sınır |
| --- | --- | --- |
| Kuyruk timeout'unun parse hatası olarak bildirilmesi | Eski compute kuyruğu timeout yolu artık FX'e bağlı değil. Excel admission reddi `EXCEL_WORKER_BUSY` ise hâlâ parse-failed olarak sunuluyor. | Geçici admission/yürütme hatasını gerçek parse hatasından ayırmak; mevcut FX/revision'ı korumak. Gerçek timeout olayı ayrıca test edilmeden olmuş sayılmaz. |
| Eksik KUR'u admission öncesinde eleme | Eksik dosya için dahi native Excel işine giriliyor; kuyruk doluysa missing yerine parse-failed oluyor. | Async yerel yokluk kontrolü ancak tüm kaynak/fallback dizinleri, uzantı/case, dizin önceliği, mtime seçimi ve explicit kaynak onayı korunarak değerlendirilmeli. Burada uygulanmadı. |
| Geçerli KUR güncellemesinin kuyruk baskısında kaçırılması | Kabul edilmiş >5 sn bekleme sonunda güncelleniyor. Excel kuyruğu doluyken admission reddi güncellemeyi kaçırıyor. | Admission reddini ayrı geçici durum yapmak; gerekiyorsa kaynak kimliğiyle iş birleştirme/yeniden zamanlama ayrı kapsam ve ürün kararıdır. Burada retry eklenmedi. |

Bu teslim üretim düzeltmesi onayı değildir. Timeout, serializationKey,
admission/bellek kuralları, mevcut store/CAS veya worker mekanizması değiştirilmez.
Kapsamı sunucu sahibi ayrı işte değerlendirmelidir. Görünür düzeltmede TR/EN,
Motion+, reduced-motion ve gerçek post-change PNG release-note sözleşmesi sürer.

## Tarihsel tekrar çalıştırılabilirlik / Historical replay

Main üzerinde tarihsel komutun kaynak guard'ı bilerek durur. Guard gevşetilmez.
Yeni Main dosyaları eski deneymiş gibi çalıştırılmaz. Aşağıdaki yöntem source'u
ve tanı script/test baytlarını sabitler; var olan dal rebase/force-push edilmez:

```sh
# Repo kökünden, yeni yol seçerek:
git fetch origin 69950f289a012f0bb7c61290bec9890f340f6c64
git worktree add --detach /tmp/buyerlog-fx-frozen-replay \
  69950f289a012f0bb7c61290bec9890f340f6c64
git show 6d09a4c2:resources/app/scripts/diagnose-fx-timeout.js \
  > /tmp/buyerlog-fx-frozen-replay/resources/app/scripts/diagnose-fx-timeout.js
git show 6d09a4c2:resources/app/tests/fx-timeout-diagnostic.test.js \
  > /tmp/buyerlog-fx-frozen-replay/resources/app/tests/fx-timeout-diagnostic.test.js
# Pinli package/vendor bağımlılıklarını hazırla; kendi ortamında npm ci kullanılabilir.
# Sonra bu worktree'nin resources/app dizininden yalnız ihtiyaç duyulan senaryoyu çalıştır.
```

Bu yöntem bu teslimde gerçekten uygulandı: sabit kaynakta native `cold-empty`
missing ve valid senaryoları geçti; kaynak/ürün dosyası diff'i boş kaldı.
Kopyalanan script SHA-256
`586c9b9d76f03815ea591f7ea1a832fa40e26d19f43750c41cb88d1ea8128e46`, test
SHA-256 `7b687f8eff16249acb03a37c7fbfaf7d16185c3a8fb3ab38cfb186f39cd534a1`.
Yeni replay smoke, eski 14 hücre/30k ölçümünün veya eski olayların yeni ölçümü
değildir. Eski arşivden çıkarılan 14 hücre de yeniden doğrulanabilir; ham kanıtın
kendi manifesti değişmemiştir.

Güncel Main kontrolünü yeniden çalıştırmak için (başka benchmark/test yokken):

```sh
cd resources/app
node scripts/diagnose-fx-main.js run /tmp/buyerlog-fx-main-new
```

Komut `source-comparison.json` içindeki Main dosya hash'lerini doğrular; farklı
üretim kaynağında ölçüm başlamaz. Yeni testlerin `runtime-contract-only`
çıktıları güncel Main ölçümü diye etiketlenmez.

## Doğrulama ve kapsam / Validation and scope

Yeni test önce RED (tanı modülü yok), sonra **3/3 GREEN**; native kayıp-dosya,
geçerli KUR/revision ve yanlış olumlu sonuç vermeyen tanı assertion'ları korunur.
Main üstünde ilgili paket: **47 dosya / 197 test PASS**, fail/skip/cancel 0.
i18n **0 yeni / 0 baseline**; mevcut release-note validator **38 OK**.
Mevcut test, validator veya i18n baseline gevşetilmedi.

GitHub kontrolleri son pushed SHA üzerinde ayrıca beklenir; yerel sonuçlar CI
sonucu olarak sunulmaz. Tam regresyon, yeni resmî kabul ve bağımsız P1 incelemesi
iddia edilmez. Entegrasyonun yeşil olması bu açıkların kapandığı anlamına gelmez.

Nihai ham JSON/loglar `main-narrow-02.tar.gz` içindedir. İlk dar seride eski
kök hazırlama yardımcısı yalnız güvenlik marker'ına tarihsel `reviewSha`
yazıyordu; `result.json` dosyaları doğru Main hash'lerini taşısa da bu marker
karışıklığı giderildi. Gerçek marker assertion'ı önce RED, sonra GREEN oldu;
beş kısa senaryo doğru Main etiketiyle yeniden alındı. İlk seri ve o sıradaki
tanı source'u `main-narrow-01-preliminary.tar.gz` / `main-probe-initial-source.txt`
olarak saklanır, nihai veri yerine kullanılmaz. Tarihsel kanıt dosyaları bu
düzeltmede değiştirilmedi.
