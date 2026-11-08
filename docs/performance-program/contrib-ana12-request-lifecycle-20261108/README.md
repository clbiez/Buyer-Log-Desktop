# ANA-12 · bağımsız request/subscriber yardımcısı

Başlangıç: `1796193f0a57c7785e7bf9fdb3557e33c550b25e`.
Dal: `contrib/ana12-request-lifecycle-20261108`.
Devralınan hazırlık: [#895](https://github.com/clbiez/Buyer-Log-Desktop/pull/895),
`12d628ed9c07a7d964c3df00bd66f33009507d51`.

Bu katkı üretime bağlı değildir. ANA-12 açık kalır. HTTP→queued/running job
bağlantısı, backend CPU durma kanıtı, üretim entegrasyonu ve son tam regresyon
root sahibindedir. PR, merge, rebase, force-push, bağımsız inceleme ve
TEST/STABLE yapılmadı.

## Teslim

- `resources/app/public/backlog-request-lifecycle.js`: CJS ve isteğe bağlı
  tarayıcı globali `BLBacklogRequestLifecycle`. Yükleyen script/import eklenmedi.
- `resources/app/tests/ana12-request-lifecycle-*.test.js`: paylaşım, hızlı
  sorgular, hazırlık, kapanış, geç completion, body/parse ve gerçek loopback fetch.
- `resources/app/tests/fixtures/ana12-request-lifecycle/`: kontrollü sentetik
  transport ve sabit #895 girdileri. Üç özgün dosya hash ile byte eşitliği
  denetlenir; dokuz özgün testin ve beş istemci sözleşmesinin assertion'ları korunur.
  `diagnose.cjs` yalnız kullanılan VM/client/summary/validation bölümlerini taşır;
  repo yolu taşınabilir yapılmıştır. Ölçüm CLI'si alınmadı, tanı yeniden üretilmedi.
- [adapter-contract.md](adapter-contract.md): sonraki istemci ve backend bağlantısı.
- [manifest.json](manifest.json): yeni dosyalar ve salt okunur kaynak pinleri.

## Hedefli doğrulanan mevcut davranış

`backlog-overview.js` içindeki `rowsQueryKey`, sıralanmış query alanlarından
yalnız `groupBy`, `antrepoDateLevels`, `lazyDimensions` alanlarını çıkarır.
Scope/generation/filter/includeSourceDetails gibi diğer alanları korur.
`loadData` aynı key için aynı promise ve sonucu döndürür; doğrudan çağrısı pivot
hazırlığını beklemez. `loadRows` mevcut `whenRowsReady()` kapısından geçer.

`rowsCache` ve `rowsRevisions` ayrı, en çok dörder giriş tutar. `invalidate()`
yalnız `rowsCache`'i temizler; transportu iptal etmez, revizyonla satır kimliği
reuse bilgisi kalır. Yeni yardımcı bunları değiştirmez veya kopyalamaz.
Yalnız pending flight'ları tutar, terminal durumda Map girdisini bırakır.

## Gerçek doğrulama sonuçları

- [red-direct.txt](red-direct.txt): yeni yardımcı yokken paylaşım testlerinde
  1 PASS / 8 FAIL (`MODULE_NOT_FOUND`). İlk native RED'in sandbox altında
  alt-test ayrıntısı görünmediği için bu doğrudan Node testi de kaydedildi.
- [red-before-publish.txt.gz](red-before-publish.txt.gz): parse sonrası hazırlık
  kancası eklenmeden 9 PASS / 1 FAIL; ardından uygulandı ve son pakette geçti.
- [red-transport-rejection.txt.gz](red-transport-rejection.txt.gz): 10 PASS / 1 FAIL;
  Error nesnesi olmayan falsy transport reddinin yanlışlıkla başarı sayılması
  sabitlendi; terminal durum artık açık başarı/hata bayrağıyla ayrılır.
- [native-green.txt](native-green.txt): **15 dosya / 134 PASS**, fail/skip/cancel 0.
  Yeni dört dosyada **33 test**; #895'in dokuz testi ve beş sözleşme senaryosu dahil.
  Değişiklikten önceki ilk GREEN ayrıca `native-initial-green.txt` içindedir.
- [i18n.txt](i18n.txt): `npm run i18n:check`; yeni eksik 0, baseline 0.
- `loopback-initial.txt`: test yazımı sırasında geçersiz `t.setTimeout` çağrısı;
  Node'un standart `{timeout:5000}` test seçeneğine düzeltildi.
  `loopback-sandbox-failure.txt`: sandbox `listen EPERM` sonucu.
  Ağ yetkili [loopback-green.txt](loopback-green.txt) ve son native koşu geçti.

Loopback testinde iki tüketicinin sonuncusu ayrılınca gerçek fetch sinyali
abort olur, `Response.text()` AbortError alır ve sunucu incomplete HTTP kapanışı
görür. Normal yanıt bağımsız, iptal edilmemiş tam JSON oracle'ıyla eşittir;
bu sentetik protokol eşitliğidir, gerçek iş projeksiyonu eşitliği değildir.
Kontrollü testte on hızlı filtre değişimi eski tek tüketicili transportları
iptal eder; ilk sorguda kalan başka panelin isteğini korur. Paylaşılan tüm
sonuç grafiği ve tek body read/yayın assertion ile doğrulanır.

Benchmark, gerçek veri, gerçek backend route/pool veya CPU ölçümü yapılmadı.
Backend jobs ve iptal sonrası CPU **bilinmiyor**. Mevcut pool testlerinin geçmesi
HTTP→job entegrasyonu kabulü değildir. Filtresiz `npm test` root'ta kalır.

## Tekrar çalıştırma

Repo kökünden yeni testler:

```sh
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  node --test --test-concurrency=1 resources/app/tests/ana12-request-lifecycle-*.test.js
```

`resources/app` içinden kullanılan native paket ve i18n komutları:

```sh
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  env BUYER_LOG_TEST_CONCURRENCY=1 npm test -- \
  ana12-request-lifecycle backlog-query-cache backlog-chart-shared-preparation \
  backlog-dynamic-chart backlog-shared-analysis-filters backlog-analysis-performance \
  backlog-delivery-analysis-wiring backlog-plan-actual-wiring compute-read-service \
  compute-read-guard compute-response server-compute-pool
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock npm run i18n:check
```

Bütün test koşuları aynı lock altında seri çalıştırıldı. Lock meşgulse exit 75
başarı sayılmaz. Loopback/native testleri için bu ortamda socket izni gerekir;
son native koşuda ağ erişimli sandbox kullanıldı. Assertion/timeout gevşetilmedi.

## Sınırlar

JSON.parse senkron başladıktan sonra kesilemez; son ref body read sırasında veya
parse başlamadan bırakılmışsa parse başlamaz. Native fetch'i durdurmak için adapter
verilen sinyali gerçek fetch'e geçirmelidir. Sinyali yok sayan transport fiziksel
olarak sürebilir; yardımcı subscriber promise'ini kapatır, parse/yayını engeller.
Hazırlık sağlayıcısının ortak işini tek panel adına iptal etmez.

Yeni helper bozuk JSON'u reddeder. Mevcut `loadData` ise parse hatasını `{}`'a
çevirir. Üretime bağlanırken bu fark ve mevcut hata sunumu açıkça ele alınmalıdır;
bu katkıda mevcut davranış değişmedi. Görünür entegrasyonun TR/EN ve release-note
kabulü ayrıca root'a aittir.
