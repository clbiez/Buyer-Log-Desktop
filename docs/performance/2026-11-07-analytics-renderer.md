# ANA-05 / ANA-07 / ANA-11 — renderer ölçümü

RED görünüm kaynağı: `1d8e8d39` (#888). Son ölçüm ve test tabanı:
`2083ffd7` (#894, v714 düzeltmesi dahil). Ölçüm, uygulamadan **önce** başladı:
ilk pilotta teslimat cache miss timer aralığı 835 ms, ham input clone 681 ms,
Transit özeti 347 ms. Gerçek sıralama başlığındaki `.thLabel` üzerinden ikinci
pilotta LFL 253 ms ve tam render / üç framework dönüşümü doğrulandı. İlk
pilotun doğrudan `th.click()` çağrısı sıralamayı tetiklemedi; LFL maliyet kanıtı
olarak kullanılmadı. İlk dört test RED; eski araç callback’leri için ayrıca RED→GREEN doğrulandı.
Son durumda altı regresyon testi GREEN.

## Düzenek

- İzole fixture: `docs/performance-program/fixtures/source-30000-seed7-20261105.tar.gz`
  → `/tmp/buyerlog-startup-analytics/source/`. Arşiv SHA-256:
  `5913414603984b02b1c30b87f1f9231da3718ab797a007f4bd14067ec6cd5c70`.
- Gerçek Express uygulaması + Linux Chromium, 1440×1000, reduced motion.
  30.000 kaynak siparişinden 37.708 Backlog detay satırı ve 30.000 LFL satırı.
- Aynı sunucu, aynı fixture ve aynı tarayıcı; ayrı RED/GREEN context’leri.
  Sıra **RED₁ → GREEN₁ → RED₂ → GREEN₂ → RED₃ → GREEN₃**.
  RED dosyaları değiştirilmemiş temel kaynaktan Playwright route ile yüklenir.
- Her turda aynı grup tablosu sıralaması; teslimatta değişen ayarla cache miss,
  ayrıca yeni dizi referansıyla yeni dataset aktarımı. SHA ve bağımsız clone
  tanıları süre penceresinin dışında; tur başında iki tarafta da GC istenir.
- Transit için ayrıca deterministik **20.000 kayıt + 20.000 step**, 400
  ülke/taşıt grubu ve üç yıl. Adet/sevkiyat ağırlığı ile tüm yıllar/2026 kapsamı
  dönüşümlü sınanır. Bu stres verisi fixture’dan türetilmiş iş verisi değildir.
- Ana thread ölçütü 5 ms timer’ın en uzun gözlenen aralığıdır; gerçek kullanıcı
  input latency veya Windows/Electron ölçümü değildir. JSON’daki `longTasks`
  yardımcı tanıdır; ana sonuç timer aralığıdır. Ekran görüntüsü incelemesinde
  LFL hazırlık kartı görüldüğünden son üç çift koşuda kart gerçek tıklamayla
  kapatıldı ve sıralanacak başlığın görünürlüğü beklendi.

## ANA-05 özeti — timer aralığı ve toplam tamamlanma birlikte

Aşağıdaki değerler aynı üç dönüşümlü koşunun yuvarlanmış medyanlarıdır.

| Senaryo | En uzun renderer timer aralığı, RED → GREEN | Toplam tamamlanma, RED → GREEN |
|---|---|---|
| Yeni dataset | **673 → 209 ms** | **679 → 1583 ms** |
| Mevcut dataset cache miss | **973 → 474 ms** | **981 → 1362 ms** |

Ölçüt 5 ms timer'ın en uzun gözlenen aralığıdır. **Gerçek kullanıcı input
latency'si ölçülmedi; bu sonuç genel analiz hızlanması değildir.** Her iki
senaryoda da toplam tamamlanma uzar. Renderer timer aralığı azalırken kalan
bekleme yeni dataset'te yaklaşık **209 ms**, mevcut dataset cache miss'inde
**474 ms**'dir; ana iş parçacığındaki bütün bekleme kaldırılmış değildir.

### ANA-05 üç dönüşümlü koşu (ms)

| İş / ölçüt | RED 1 / 2 / 3 | GREEN 1 / 2 / 3 | Medyan RED → GREEN |
|---|---|---|---|
| ANA-05 yeni dataset, en uzun timer aralığı | 673,1 / 756,7 / 670,0 | 209,1 / 212,8 / 141,3 | **673,1 → 209,1** |
| ANA-05 yeni dataset, toplam tamamlanma | 678,8 / 762,1 / 675,6 | 1713,3 / 1582,6 / 1583,3 | **678,8 → 1583,3** |
| ANA-05 mevcut dataset cache miss, en uzun timer aralığı | 918,6 / 1079,5 / 973,3 | 484,2 / 421,8 / 474,4 | **973,3 → 474,4** |
| ANA-05 mevcut dataset cache miss, toplam tamamlanma | 926,4 / 1087,1 / 980,9 | 1396,2 / 1283,6 / 1361,8 | **980,9 → 1361,8** |

Timer gözlemi alıcı maliyetlerini de kapsar; bu koşular kalan aralığı
deserialize, GC ve çizim gibi bileşenlere tek tek ayırmaz. İşin tamamlanması
ve timer aralığı farklı ölçütlerdir; yalnız timer azalmasına dayanarak toplam
hesap süresi veya kullanıcı etkileşim gecikmesi hakkında sonuç çıkarılmaz.

### Structured clone

GREEN tarafındaki bağımsız tek-parça clone medyanları: ham input **425,6 ms**,
motor alanlarına indirgenmiş input **226,5 ms**, tam model output **642,0 ms**.
Projeksiyonun tek parça tanı maliyeti 124,8 ms; üretimde bu iş de parçalıdır.

Üretim yolu bu tek-parça clone’ları yapmaz. Yeni dataset 500’er satırlık **76**
input mesajıyla yüklenir: `postMessage` içindeki senkron kopyalama toplamı
138,4 / 106,3 / 121,7 ms; en pahalı tek mesaj **4,7 / 4,8 / 2,7 ms**.
Bu rakamlar alıcı deserialize maliyeti değildir. Mevcut dataset’te **0** input
paketi; yalnız ayar, bugün, dönem sınırı ve generation gönderilir. Output da
500 siparişlik paketlere bölünür; ana thread timer ölçümü alıcı maliyetini içerir.

500 satır/sipariş sınırı mesaj boyutuna ilişkindir. Ölçülen tek mesaj süreleri
garantili bir milisaniye üst sınırı değildir; toplam aktarım ve alıcı işi ortadan
kalkmaz.

## ANA-07 ve ANA-11 — ayrı istemci yolları

Bu ölçümler ANA-05 worker aktarımından ayrıdır; teslimatın toplam tamamlanma
süresine veya bütün uygulamanın hızına genellenmez.

| İş / ölçüt | RED 1 / 2 / 3 | GREEN 1 / 2 / 3 | Medyan RED → GREEN |
|---|---|---|---|
| ANA-07 sıralama callback’i | 163,9 / 224,9 / 180,3 | 25,2 / 17,1 / 15,6 | **180,3 → 17,1** |
| ANA-07 iki rAF’a kadar geçen süre | 184,2 / 266,2 / 204,1 | 49,8 / 38,2 / 35,2 | **204,1 → 38,2** |
| ANA-11 summarize | 249,3 / 303,6 / 165,0 | 53,8 / 51,9 / 21,6 | **249,3 → 51,9** |

Her üç madde önceki ölçülen kazançla uygulandı; atlanan madde yok. Bu takip
tesliminde yeni optimizasyon, benchmark veya ölçüm eklenmedi; ham koşular ve
çıktı SHA'ları değiştirilmedi.

## Eşdeğerlik ve davranış

Her RED/GREEN çiftinde tüm çıktı SHA-256’ları eşleşti. Teslimatta yalnız
`context.generatedAt` normalize edildi; tutarlar, sipariş kararları, sinyaller,
boyutlar ve risk listeleri bütünüyle hash’lendi. Non-enumerable `sourceRow`
clone ile kaybolduğu için ayrıca asıl satır kimliği ve risk listesi alias’ı
test edilir. Worker kanonik motoru/dependency’lerini `importScripts` ile
çalıştırır; hesap motoru değiştirilmedi. Tarih cevapları çağıranın kanonik
`dateOrdinal` fonksiyonundan gelir: Excel seri sayısı ve yerel biçim için
worker’ın farklı bir parser’a düşmesi engellenir.

| Çıktı | Tur 1 | Tur 2 | Tur 3 |
|---|---|---|---|
| Teslimat (mevcut/yeni dataset aynı) | `fabb17760c7b607583ac5783b6d3deb523cc720d4c18ff4816d303a7b41223e5` | `b179382f163926685703ccb8a9ab34bf6f13068c3151b2004b0c86929dd40cb5` | `e3f86aa03e6ce9532ec5db50e699849890c097ffa3542166928b4942024f8245` |
| LFL tablolarının export satırları | `a6defdbefd80ba4ef8626fd2b2db9b54ab677f48c85f0b10f2633e19a2fbcbad` | `a6fe0563b83d7f8c263055baad179d78b9935ecf34c9d53ff16d89ad4b5d3c2d` | `a6defdbefd80ba4ef8626fd2b2db9b54ab677f48c85f0b10f2633e19a2fbcbad` |
| Transit tüm özet | `d782ecdb6c883098e3b16d631d809c5aaa3b83ee32e34e9319907874fd4f66d6` | `c6b3691a3c8e88bf5bbc3a5706284f29add4540fa451fca8aed9d01312ebcd61` | `67d669e31d9be2e53d64ab5cafea5622bb431a23946f36656731ad3676bc1bfd` |

LFL sıralamasında tam render, KPI, source, üretici özeti, senaryo ve
frameworkRows çağrı sayıları GREEN’de **0**; diğer dört bölümün DOM kimliği
korunur. Tam render yeni tablo closure’ları kurduğu için ayrıca kalıcı view-model
cache’i eklenmedi. Trial/FX/filtre/dataset invalidation akışı değiştirilmedi.
Kalıcı Sütunlar/Filtreleri temizle butonları da en güncel callback’i kullanır;
eski dataset’e dönen closure ayrıca regresyon testiyle engellenir.

Worker iptali `terminate()` ile yapılır; eski fetch/worker sonucuna generation
ve worker kimliğiyle izin verilmez. Worker hatası loading durumunu bitirir ve
yenilemeyle toparlanır. Tarih filtresi worker’da uygulanır; drill-down aynı
orijinal satırları açar. Transit indeksinde yıllar arası aynı kodlu step’ler
birleştirilmez; mevcut sıralama ve ağırlıklar korunur.

## Yeniden çalıştırma

`resources/app` içinden:

```sh
mkdir -p /tmp/buyerlog-analytics-baseline
git show 1d8e8d39:resources/app/public/lfl.js > /tmp/buyerlog-analytics-baseline/lfl.js
git show 1d8e8d39:resources/app/public/transit-analysis.js > /tmp/buyerlog-analytics-baseline/transit-analysis.js
git show 1d8e8d39:resources/app/public/backlog-delivery-analysis.js > /tmp/buyerlog-analytics-baseline/backlog-delivery-analysis.js
node scripts/benchmark-analytics-renderer.js --baseline /tmp/buyerlog-analytics-baseline --out /tmp/analytics-results.json --measure-only
node scripts/benchmark-analytics-renderer.js --capture-only
node --test tests/analytics-renderer-performance.test.js
npm test -- backlog-delivery backlog-query-cache lfl transit-analysis analytics-renderer
mkdir -p /tmp/buyerlog-analytics-tests/app /tmp/buyerlog-analytics-tests/server
BUYER_LOG_DATA_ROOT=/tmp/buyerlog-analytics-tests/app \
BUYER_LOG_SERVER_DATA_ROOT=/tmp/buyerlog-analytics-tests/server \
BUYER_LOG_CONFIG_PATH=/tmp/buyerlog-analytics-tests/config.json npm test
npm run release:notes:validate
```

Ham ölçüm: [JSON](evidence/2026-11-07-analytics-renderer.json).
[RED](evidence/2026-11-07-analytics-red.txt) /
[GREEN](evidence/2026-11-07-analytics-green.txt).
Transit ekran görüntüsü, fixture’da canlı analizin yükleme talep tarihleri
olmadığından gerçek kayıt API’sine kaydedilen 36 kayıt / 48 step içeren
sentetik raporla çekildi. Dataset reload, analiz revision’ı ve TR/EN değişimi
gerçek tarayıcıda da doğrulandı. TR/EN notları ve gerçek uygulama PNG’leri `public/release-notes/next*` altındadır.
`perf-runtime.js` ve kullanıcının diğer kilitli dosyaları değiştirilmedi.


## Test sonucu

- İlgili paket: **31 dosya / 218 test PASS**. Yeni altı regression testi,
  iptal/generation, dataset reuse, worker hatası/toparlanma, kanonik tarih
  cevapları, sourceRow/risk alias, tablo kapsamı ve güncel araç callback’lerini
  korur. Eski query-cache testinin refresh sandbox’ına yeni iptal bağımlılığı
  eklendi; eski fetch’in güncel sonucu ezememe assertion’ı korunur.
- `npm run release:notes:validate`: **35 kayıt PASS**, üç yeni TR/EN notu ve
  üç gerçek post-change PNG. PNG’ler agent tarafından açılıp incelendi.
- İlk köksüz `npm test` denemesinde sandbox dışındaki varsayılan
  `/home/agent/.buyer-log/write-recovery` yoluna erişim başarısız oldu.
  Yukarıdaki izole veri kökleriyle tekrarlandı; test runner değiştirilmedi.
- İzole **tam `npm test` FAIL**: 3. batch’te
  `tests/local-iam-migration-authority.test.js:18` —
  `a partial established local directory without a valid recovery copy fails closed`;
  beklenen `IAM_LOCAL_INVALID`, gelen `undefined`.
- Aynı test değiştirilmemiş **2083ffd7** worktree’sinde tek başına da **6 PASS /
  1 FAIL** verdi ([kanıt](evidence/2026-11-07-analytics-iam-baseline.txt)).
  Bu, [#901](https://github.com/clbiez/Buyer-Log-Desktop/pull/901)'deki aynı
  **ortak Main IAM bulgusudur**. Ana kayıt ve ortak düzeltme takibi
  [ana sunucu entegrasyonu teslimindedir](https://github.com/clbiez/Buyer-Log-Desktop/blob/perf/pricing-costing-cpr-05-06-07-12/docs/performance/2026-11-07-iam-main-integration-handoff.md).
  #904'ün bu yerel kanıtı o bulguya bağlıdır; ayrı bir IAM düzeltmesi değildir.
  Ortak teslim güncel main `63159fb3` için de 6 PASS / 1 FAIL kaydeder;
  bu ek main IAM kaydı #901'in kanıtıdır, #904'te yeniden üretilmedi.
  Bu PR'ın server/IAM değişikliği yoktur. Bilinen v714, tabandaki #894 ile
  düzeltilmiş durumda; bu hata v714 değildir. Güvenlik davranışı, test veya
  assertion gevşetilmedi; IAM'i dışarıdan kapatarak yeşile çevirme yoktur.
- Runner ilk hatada durduğundan 4–10. batch’ler aynı sıralama, concurrency ve
  assertion’larla bellek içindeki runner devamından ayrıca çalıştırıldı.
  **4–10. batch’ler PASS**. Toplam 1240 dosyadaki 8706 testin
  8640 tanesi geçti, 1 tanesi başarısız, 65 tanesi skip.
  Bu sayılar **tanısal birleşik sonuçtur; başarılı tek filtresiz tam paket
  sayılmaz**. Ortak engelin main'de de bulunması tam regresyon şartını kaldırmaz.
  Kabul BLOKE; PR taslak ve merge edilmemiş kalır.

## Ortak düzeltme sonrası kabul kapısı — henüz tamamlanmadı

Ortak IAM engeli ana sunucu entegrasyonunda giderilip onaylı düzeltme #904
dalına alındığında, IAM düzeltme SHA'sı ve entegre son SHA kaydedilir. Bu PR
içinde yeni IAM düzeltmesi üretilmez. Aşağıdakiler **aynı son commit SHA** için
yeniden başarılı tamamlanmalıdır:

1. Worker `terminate`/generation, hata-toparlanma, dataset reuse, kanonik tarih
   ve `sourceRow`/risk alias eşdeğerliği regresyonları aynen korunarak ilgili
   paket çalışır; başarısız IAM testi de pakete dahil edilir:
   `npm test -- backlog-delivery backlog-query-cache lfl transit-analysis analytics-renderer local-iam-migration-authority`.
2. İzole veri kökleriyle **filtresiz `npm test`** tek koşuda bütün batch'leri
   başarıyla tamamlar. Hata sonrası batch'leri ayrı tamamlamak bu kapıyı açmaz.
3. `npm run i18n:check` ve `npm run release:notes:validate` yeniden çalışır.
4. #904 PR kontrolleri aynı son SHA'da yeniden doğrulanır; hızlı kontroller tam
   paketin veya başarısız güvenlik testinin yerine geçmez.
5. Ana kod değişikliklerinin ölçülen yola etkisi incelenir. Yolu, fixture'ı
   veya probe'u etkileyen değişiklik varsa yalnız ilgili ANA kıyası yenilenir;
   halen geçerli ölçümler gereksiz yere tekrarlanmaz. Şimdilik ek ölçüm yoktur.
6. Komut, ortam, exit code, log ve son inceleme SHA'sı kaydedilir. Gerekli
   inceleme ve kontroller tamamlanmadan merge onayı verilmiş sayılmaz.

Ortak engel giderilip bu dala alınmadığı için bu kabul kapısı tamamlanmış
veya yeşil gösterilmez. Sonucu etkileyen yeni kod değişikliğinde ilgili testler,
bütün tam regresyon batch'leri, i18n, release-note validator ve PR kontrolleri
yeniden doğrulanır. **TEST/STABLE yayımlanmaz.**

## İnceleme durumu

Ölçülen üretim/test kodunun son özinceleme SHA'sı
`b00cf2da8691735881b1bbe6e36b305ece3d861f` olarak korunur. Bu takip yalnız raporu
ve PR açıklamasını günceller; uygulama, regresyonlar ve mevcut ham kanıtlar
değiştirilmez. Bağımsız ikinci agent/model incelemesi yoktur; takip başında
GitHub review submission listesi de boştur. Belge güncellemesinin son inceleme
SHA'sı teslim mesajında ve PR açıklamasında ayrıca bildirilir; bu kayıt merge
onayı değildir.
