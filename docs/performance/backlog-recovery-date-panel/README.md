# Backlog boş sonuç ve tarih paneli kabulü

**PASS — P2.** Özel/Regular kapsamı boşken, yüklemede ve hatada kapsam seçimi erişilebilir kalır. Analiz filtreleri açıkça düzenlenebilir/temizlenebilir. Tarih paneli daraltılır ve taşınır; taslaklar korunur, açık/kapalı durum ve konum kullanıcı ayarına kaydedilir. Veri hesaplama, native köprü ve paylaşılan yazma sınırları değişmez.

## Son kaynak ve ölçüm

- Main tabanı: `d0fdb8889f188e2cc1387b0850f61a841aa7e6d5` (#949 gezinme entegrasyonu dahil).
- Son ölçülen uygulama kaynağı: `c7c53fe28ea4958ad6b7353c599bc10f093960a0`. Sonraki değişiklikler yalnız test/probe/kanıt ve aynı görünümü gösteren demo PNG'lerdir.
- Linux / Chromium `154.0.8037.57`. Aynı makine/runtime, izole demo hesap ve kaynak klasörü; gerçek iş verisi yoktur.
- Normal veri: gerçek demo importundan 220 sipariş / 273 operasyon satırı. Büyük UI verisi: aynı JSON rapor şemasında 30.000 sentetik satır, mevcut rapor uç noktasına tarayıcı route fixture'ı üzerinden verilir. Hash'ler ve bütün örnekler `date-only-results.json` içindedir.
- Her veri için üç dönüşümlü Main/aday çifti. Her kolda beş × dört etkileşim; yalnız en hızlı koşu seçilmez. p95 iddiası yoktur.
- Main'de yeni kontroller bulunmadığı için aynı Backlog belgesindeki mevcut Overview aç/kapat ve Plan & Actual panel taşıma akışları referanstır. Adayda tarih aç/kapat ve taşıma ölçülür. Yeni işe ayrılan sınırlar değişmez: ilk görünür yanıt ≤200 ms, ek Backlog isteği 0, yeni poller/iş kuyruğu 0, döngülerde DOM/dinleyici birikimi 0.
- #949'un gerçek `bl:background-warmup-done` sinyali beklenir; aynı hazırlık sınırı projenin native kabul harness'inde de kullanılır. Başlangıç ve ilk kullanılabilir Overview ayrıca kaydedilir; aktif kontrol ölçümü hazırlık tamamlandıktan sonradır. Her iki kolda aynı 100 ms girdi aralığı, gerçek düğme odağı ve görünür geometri okuması kullanılır. Önceki aksiyonun boyanması beklenir; testin zorunlu son-GC'si etkileşim penceresine dahil edilmez.

Süreler ms. İlk üç süre üç koşunun medyanıdır; etkileşim sütunu 60 gözlemin medyanı / maksimumudur. Uzun görev sütunu sayı / maksimum ms'dir.

| Veri | Sürüm | Başlangıç | İlk Overview | Hazırlık sonu | Etkileşim medyan / maks. | >50 ms görev sayı / maks. |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 220 | Main referansı | 3734.8 | 449.6 | 7506.9 | 14.8 / 148.6 | 15 / 152 |
| 220 | Aday | 3717.1 | 421.3 | 7323.7 | 17.1 / 82.8 | 3 / 84 |
| 30000 | Main referansı | 12160.9 | 8123.7 | 21044.0 | 15.2 / 572.3 | 21 / 579 |
| 30000 | Aday | 10878.8 | 6200.0 | 18454.7 | 16.6 / 43.1 | 1 / 51 |

**120/120** yeni etkileşim ≤200 ms; maksimum **82.8 ms**. Her aday koşusunda ek Backlog isteği 0; beş döngü öncesi/sonrası belge, DOM ve dinleyici sayıları birebir aynı. Her Main/aday çiftinin rapor toplamları eşittir. Aç/kapat/taşıma tarih filtresini uygulamaz veya veri isteği başlatmaz.

Mevcut ortak belge yerleşiminde uzun görevler vardır ve gizlenmez: Main referansında normal/büyük veride 15/21, adayda 3/1. Adayda maksimum 84/51 ms'lik ortak yerleşim örnekleri korunur. Yeni sürekli iş veya tekrarlanabilir büyüme görülmez; bütün uygulama veya hazırlık aşaması için “hiç uzun görev yok / her koşulda ≤200 ms” iddiası değildir. GC sonrası retained heap farkı adayda yaklaşık 549–574 KB, referansta 573–609 KB'dir; bu tepe RSS ölçümü değildir. CDP CPU/heap teşhis alanları test GC'sini de içerir ve etkileşim bütçesi yerine kullanılmaz.

A/A kayıtları `control-*.json` içindedir. Güncel Main için `control-layout-large-results.json` aynı kaynağın başlangıç/ilk kullanım dalgalanmasını gösterir. Genel bir yüzde toleransı uygulanmaz. Son adayın başlangıç, ilk kullanım ve hazırlık medyanlarında tekrarlanabilir gerileme yoktur; yeni işlemler bağımsız sayısal bütçeye uyar.

## İşlev ve testler

- Kaydedilmiş boş Special kapsamından reload sonrası All'a dönüş; boş, yükleniyor, hata ve henüz yüklenmemiş durumlarda kurtarma kontrolleri.
- Tarih taslağının aç/kapat ve taşımada korunması; kapalı başlıkta yalnız uygulanmış aralıklar; tüm konumlar ve içerik gizlenince erişilebilir üst konuma dönüş.
- Reload sonrası açık/kapalı durum ve konum; başlangıçta kapalı gövdenin yeniden açıldığında inert kalmaması.
- TR/EN × light/dark × compact/standard/large/xl, klavye Enter, normal/reduced motion. `moveBefore` bulunmayan tarayıcı yolu da aynı gerçek uygulama akışıyla doğrulanır.
- **82 dosya / 543 kontrol PASS**; release-notes doğrulayıcısı 17 pending kaydı kabul eder. Yeni kurtarma testleri eski kaynakta RED, yeni kaynakta GREEN. İlk DOM kurulumunun ölçüm yapmamasını koruyan iki test de önceki kaynakta RED, yeni kaynakta GREEN; kullanıcı etkileşiminde ortak Motion+ çağrısı ayrıca korunur.
- İlk CI, modül CSS'indeki iki görünüm tanımını yakaladı. Aynı renk/yazı boyutu tanımları ortak `ui-components.css` sahibine taşındı; testler gevşetilmedi. Önceki dosya adı filtresi `ui-manifest-contract` testini seçmiyordu; son komut bu genel görünüm bekçisini de içerir. İlk CI hatası `first-ci-failure.log.gz` içinde tutulur.
- İlk çizimde ortak disclosure API'sinin `initial` yolunda bile geometri okuduğu doğrulandı. Başlangıç artık HTML hidden/ARIA durumunu ölçümsüz kurar; gerçek aç/kapat işlemi ortak Motion+ yolunda kalır. Taşıma desteklenen tarayıcıda bağlı DOM'u ve odağı korur; eski tarayıcı fallback'i korunur.

## Kanıt ve sınırlar

`final-tests.log.gz`, `release-validation.log.gz`, `red.log.gz`, `initialization-red.log.gz`, `initialization-green.log.gz`, `functional-results.json`, `functional-fallback-results.json` ve `layout-final.log.gz` son kabulün kanıtıdır. TR/EN sürüm notları ve iki gerçek post-change demo PNG vardır.

Önceki `initial-*`, `pre-*`, `before-focus-*`, `unfocused-*`, `mixed-scope-*`, `unsettled-*` kayıtları silinmez ve son kabul serisine katılmaz. Bunlarda eski kaynaklar, hazırlıkla çakışan hızlı programatik aksiyonlar, eksik odak/paint veya GC penceresi ayrılır. Kabul eşiği yükseltilmez. `browser-results.json` eski Overview kapsam karşılaştırmasıdır; son kararın yeni kontrol kaydı `date-only-results.json` dosyasıdır.

30k siparişin tam sunucu modeli import denemesi bağlantı kapanmasıyla tamamlanamadı (`initial-import-failure.log.gz`); bunun kök nedeni bu frontend PR'ında teşhis edilmiş veya düzeltilmiş sayılmaz. Büyük UI kabulü 30.000 rapor satırını kapsar; sunucu importu için PASS iddiası yoktur. Sunucu/import kodu değişmez. Windows/Excel/SMB ve native Electron köprü performansı bu frontend testinin doğrulanmış kapsamı dışındadır. TEST/STABLE tetiklenmez.

## Komutlar

Repository kökünden; ağır ölçüm/testler aynı lock ile sıraya alınır:

```sh
NODE_PATH=/workspace/.buyerlog-tools/node_modules flock /tmp/buyerlog-performance-measurement.lock node docs/performance/backlog-recovery-date-panel/browser.cjs --date-only
NODE_PATH=/workspace/.buyerlog-tools/node_modules flock /tmp/buyerlog-performance-measurement.lock node docs/performance/backlog-recovery-date-panel/browser.cjs --functional
NODE_PATH=/workspace/.buyerlog-tools/node_modules flock /tmp/buyerlog-performance-measurement.lock node docs/performance/backlog-recovery-date-panel/browser.cjs --functional --fallback
cd resources/app
npm test -- backlog i18n-coverage motion-plus ui-manifest release-visual-assets notification-navigation checklist-components collection-artwork-detail persistent-page-navigation
npm run release:notes:validate
```

A/A için `--control --large --date-only`; eski Overview karşılaştırması için flag'siz çağrı kullanılabilir. Probe yalnız izole demo klasörüne yazar.
