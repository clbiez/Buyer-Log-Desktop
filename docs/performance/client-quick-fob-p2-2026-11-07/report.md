# #906 — Hızlı FOB P2 kapanışı

## Kapsam ve kullanıcı kararı

Kullanıcı lisans CARD-01 parçasının ölçülmüş belirsizlikle korunmasını seçti.
Önceki raporlar ve ham kanıtlar değiştirilmedi. Önceki rapordaki karar bekleyen
bölümün ardından alınan karar budur: lisans aramasında hızlanma veya gerilememe
iddiası yoktur. Önceki üç bağımsız çiftin arama p95 medyanı
2694,5→2785,5 ms (**+%3,38**), eşli yönleri **-%1,36 / -%6,63 / +%9,27**
olarak kalır. Yeni kanıtlar bu eski kohortun üzerine yazılmaz veya onunla
birleştirilmez.

Kullanıcının bildirdiği bağımsız ikinci model incelemesi
`f732c866405e62384c3c023d4a1abbec24c9b9c4` üzerinde tamamlandı: P1 yok,
bir P2 var. Bu devam yalnız o bulgunun kapanışıdır; yeni genel inceleme turu
açılmadı. Aşağıdaki kapanış doğrulaması uygulayıcı tarafından yapıldı;
yeni SHA üzerinde ikinci bağımsız inceleme yapıldığı anlamına gelmez.

Orijinal üç commit, 18 özgün kanıt dosyasının hash'i, iki eski kanıt dizinindeki
59 dosya ve mevcut 42 sürüm notu kaydı korundu (`preservation.json`). #885'i
içeren Main `63159fb3` fetch edildi ve zaten HEAD'in atası olduğu doğrulandı.
Rebase/force-push yapılmadı. Korunan dosyalara ve `server/**` ağacına dokunulmadı.

## Bulgu ve gerçek tarayıcıda RED

`license-cards.js/closeEditor` yalnız editörü ve kart satırını yeniliyordu.
Hızlı FOB'un seçenekleri ve hesap çıktısı daha önceki kural durumunda kalıyordu.
Ürün koduna dokunmadan önce inceleme SHA'sında gerçek izole Buyer Log sunucusu
ve Chromium ile iki hata yeniden üretildi. Sahte hesaplayıcı/sunucu kullanılmadı.

Fixture: 20 sentetik kaynak satırı, gerçek API ile kaydedilmiş iki demo lisans
kartı, royalty 8, TR/YD komisyonu 2, hologram 0,1; 1440×900 açık tema, TR.
Her senaryo Supp./YD/TR giriş yönlerinde ayrı kontrol edildi (altı işlevsel
senaryo; bunlar bağımsız performans koşusu değildir).

| Senaryo | RED gerçek çıktı | Aynı durumun tam çizim referansı |
| --- | --- | --- |
| Supp. FOB 100,00; royalty 8→20; kaydetmeden kapat | Kart 20; FOB 111,21; seçenekte eski royalty | Aynı kart 20; FOB 128,31; seçenekte taslak royalty 20 |
| Supp. FOB 100,00; taslak dönem 30; dönemi seç; yeniden aç ve iptal | Kaldırılan dönem hâlâ seçili; FOB 147,16 | Eski fallback sözleşme seçili; FOB 111,21; taslak dönem yok |

RED: `red/result.json`, `red/browser.log`, `red/rate-close.png`,
`red/period-cancel.png`. Altı kontrolün hepsinde FOB eşdeğerliği bozuldu;
üç dönem iptalinde seçim/fallback ve kaldırılan seçeneğin yokluğu da bozuldu.
Tutar, liste ve diğer satır kimliği zaten korunuyordu. Tarayıcı komutu exit 1
verdi. Sonrasında eklenen ilk 12 Node regression kontrolü de aynı iki nedenden
RED verdi (`red/unit.log.gz`); bu aşamaların hiçbirinde ürün düzeltmesi yoktu.

## En küçük düzeltme ve GREEN

`closeEditor` içinde mevcut `.lcQuick` bölümü `quickHtml()` ile değiştirilip
`runQuick()` çağrılır (iki ek satır). Formül, kaynak tutarı, seçim, filtreleme
ve fallback kuralları değiştirilmedi. Listeyi yenilemek için yeni çağrı yoktur;
önceden bulunan filtre dışındaki taslak satırın iptal fallback'i korunur.
Kartın geçerli sözleşmesi aynı kalır; iptal edilen dönem artık mevcut
`quickHtml()` fallback'inden geçer.

GREEN aynı tarayıcı scripti ve aynı mevcut assertion'larla geçti
(`green/result.json`, `green/browser.log`). Her altı senaryoda:

- Hızlı FOB seçenekleri, seçili sözleşme, girişler ve durum metninin normalize
  edilmiş DOM'u aynı durumun tam uygulama çizimiyle birebir eşleşir.
- Tüm liste satırlarının HTML'i ve kapalı detay durumu tam çizimle eşleşir.
- Liste düğümü, diğer kartın düğümü ve scroll konumu kısmi kapatma boyunca kalır.
- Kullanıcının kaynak tutarı aynen kalır; geçerli seçim korunur; kaldırılan
  taslak dönem seçiciden çıkar ve mevcut fallback tam çizimle eşleşir.
- Eski ve yeni hesap farklıdır; yalnız boş/etkisiz çıktı eşitliği sınanmaz.

Tarayıcı referansı karşılaştırma öncesi DOM input value/option selected
özelliklerini HTML niteliklerine taşır; hesaplayıcının property güncellemeleri
yanlış biçimde eski HTML değeri sayılmaz. Beklenen çıktı, düzeltmeden sonraki
kısmi çizimden türetilmez; aynı durum tam çizdirilir.

`green-final/result.json` ve `green-final/browser.log`, mevcut kontrolleri
gevşetmeden eklenen yeniden açma kontrolünü de içerir: hem tutulan 20 oranı
hem iptal sonrası 8 oranı doğru; açılan detay HTML'i tam çizimle eşleşir.

Yeni Node regression dosyası gerçek lisans motorunu ve ortak FOB matematiğini
kullanır. İki ana durum TR/EN × Supp./YD/TR olarak korunur; ayrıca başka geçerli
sözleşme seçiminin korunması ve hiç kural kalmayan fallback kontrol edilir
(14 test). Mevcut assertion'lar değiştirilmedi/gevşetilmedi. Yeni dosya gerçek
GitHub fast-check işinin mevcut lisans adımına da eklendi.

Gerçek GREEN görselleri `green/rate-close.png` ve `green/period-cancel.png`
incelendi. Son GREEN koşusundaki aynı senaryonun görseli yeni bir isimle sürüm notlarına eklendi:
`resources/app/public/release-notes/next-assets/license-quick-fob-draft-close.png`.
Önceki dört PNG'nin baytları korunur. TR/EN düzeltme notu mevcut 42 kayda
eklenen 43. kayıttır; arama performansı iddiası içermez.

## Ölçüm kapsamı

Ürün düzeltmesi seçim/arama/kayıt ölçümlerinin gövdelerine dokunmaz. Ancak
mevcut `card-render-acceptance.js` arama öncesi ölçülmeyen hazırlıkta bir kez
`closeEditor` çağırır. Bu hazırlığın da güncellenmesi nedeniyle yalnız lisans
alt kıyası aynı fixture/ortamda A/B–B/A–A/B olarak yenilendi; her kol yeni Node
ve Chromium sürecidir ve başka benchmark/test eşzamanlı çalıştırılmadı.

A önceki eşli kohortla aynı Main kaynaklarıdır; B iki satırlık düzeltmeyi içeren
dondurulmuş son istemci kaynaklarıdır. Hash'ler ve süreç/zaman aralıkları
`license-pairs/manifest.json` içindedir. Manifest HEAD'i sürücünün çalıştığı
inceleme commit'ini gösterir; henüz commit edilmemiş B'nin gerçek kimliği
manifestteki dosya hash'idir ve `preservation.json` ile eşleşir.

Her kol 500 ve **5.000 kayıt üzerinde 10 seçim, 10 arama, 5 kayıt** örneği
çalıştırır. 5.000 seçim yapılmamıştır. p95 koşu içindeki 10 örneğin maksimumudur.
İç örnekler bağımsız tekrar sayılmaz. Sonuçlar yalnız sentetik renderer
kapsamındadır; uygulama geneli veya Windows/Electron hızlanması değildir.
Yeni kohort da arama hızlanması/gerilememe iddiası için kullanılmaz.

Yenilenen üç bağımsız çift (önceki kohortla birleştirilmez):

| Koşul | A koşu p95 medyanı | B koşu p95 medyanı | Eşli p95 farkları (1 / 2 / 3) |
| --- | ---: | ---: | --- |
| license-cards/500/select | 460.9 ms | 154.8 ms | -63.14% / -65.98% / -69.54% |
| license-cards/500/search | 330.6 ms | 279.0 ms | -13.39% / -18.72% / +2.01% |
| license-cards/500/save | 845.6 ms | 411.4 ms | -43.35% / -51.35% / -55.33% |
| license-cards/5000/select | 5166.3 ms | 1428.2 ms | -78.13% / -72.36% / -70.12% |
| license-cards/5000/search | 2317.1 ms | 2883.0 ms | +15.21% / +24.42% / +27.23% |
| license-cards/5000/save | 8398.1 ms | 4499.6 ms | -47.68% / -48.99% / -37.49% |

5.000 kayıt arama p95 medyanı 2317,1→2883,0 ms (**+%24,42**); bu yeni
kohortun üç eşli arama farkı da pozitiftir: **+%15,21 / +%24,42 / +%27,23**.
Önceki kohortun +%3,38 medyan farkı ve karışık yönleri değişmeden yukarıda ve
önceki raporda kalır. Yeni kohort önceki belirsizliği gideren bir gerilememe
kanıtı değildir; bu koşullarda arama kuyruğunda daha uzun süre gözlendi.
İki satırlık P2 düzeltmesinin bu farkın nedeni olduğu gösterilmiş değildir.
Kullanıcının lisans parçasını koruma talimatı uygulanır; yeni arama sonucu
ayrıca görünür tutulur ve merge için otomatik performans onayı sayılmaz.

Altı kolun tamamında liste/detay HTML'i, kayıt isteği SHA-256 eşitliği ve
kayıt sonucu geçti. B kollarında liste/satır kimliği, scroll, dil ve kilit
kontrolleri de geçti. `license-paired-summary.json` bütün ham iç örnekleri
korur. Koşular 18:59:50–19:08:57 UTC arasında örtüşmeden tamamlandı.

Bu artışın aşamasını ayırmak için son kaynaklarla ayrı dar A/B trace'i alındı.
Trace yalnız 5.000 kayıt üzerindeki 10 arama sırasında açık; profilli kollar
bağımsız çift sayısına veya normal p95 özetine eklenmez. Ham trace/profiller
`trace/`, ayrıştırma `trace-summary.json`, aynı iş miktarı sayaçları
`trace-dom-counts.json` içindedir.

| 10 işaretli aramanın toplamı (tanısal) | A | B |
| --- | ---: | ---: |
| Süre | 13751,7 ms | 13147,2 ms |
| HTML parsing | 1928,9 ms | 1887,4 ms |
| Style/layout | 8389,4 ms | 8244,6 ms |
| GC ile ilişkili süre | 517,8 ms | 500,7 ms |
| Diğer (JS ve sınıflanmamış native) | 2915,6 ms | 2514,6 ms |
| Örneklenen lisans model çağrı ağacı CPU | 514,4 ms | 96,7 ms |
| Örneklenen selector CPU | 105,8 ms | 204,9 ms |

**Doğrulandı:** Aynı 9. işaretli örnekte (filtreyi temizleme) A 2106,4 ms,
B 2891,9 ms'dir. +785,5 ms farkın +398,2 ms'si style/layout, +291,1 ms'si
GC ile ilişkili süre, +65,1 ms'si HTML parsing, +31,0 ms'si diğer süredir.
İki kolda da bir restyle (245108 element) ve bir layout (380157 dirty /
380166 toplam nesne) vardır. Yeni kural hesabı veya ek layout çağrısı
kanıtlanmadı. DOM sayaçları detached düğümleri ve fixture'ın eşdeğerlik için
ürettiği kopyaları da içerir; 5.000 veri kaydı veya gerçek ürün bellek
kullanımı olarak yorumlanmaz.

**Bilinmiyor:** Profilli koşuda en uzun örnek A'da 7., B'de 9. aramadır;
profilli maksimum 3234,4→2891,9 ms ve toplam süre de normal kohortun ters
yönündedir. Bu tanısal koşu normal üç çiftteki artışı kararlı biçimde yeniden
üretmez. Normal koşuda profiler olmadığından o p95'lerin kesin kod kök nedeni
atanamaz. Dar trace yalnız native style/layout + GC aşamalarını ayırır;
P2 düzeltmesinin nedenselliğini veya küçük bir performans düzeltmesini
ispatlamaz. Yeni optimizasyon, arama sistemi veya sanallaştırma eklenmedi.


CPR-11'in beşer eski ölçümü, hata metni/false kararı/formül metni +
`EXPRESSION_VERSION` anahtarı değişmedi. INT-09 ve Markdown/sanitizer kaynakları
değişmedi. Bu benchmark'lar tekrar çalıştırılmadı.

## Yeniden çalıştırma

Uygulama dizininden, Playwright ve Chromium bulunan ortamda:

```sh
node scripts/license-quick-fob-acceptance.js /tmp/license-quick-fob-proof
node --test tests/license-quick-fob-close.test.js
```

Script demo veriyi kendi geçici dizininde oluşturur, gerçek API ile kaydeder;
sonuç JSON'u ve iki gerçek PNG üretir, eşdeğerlik bozulursa exit 1 verir.
RED'i tekrar görmek için ürün dosyası inceleme SHA'sından ayrı izole checkout'a
alınmalıdır; mevcut GREEN kaynak üstüne yazılmamalıdır.

Merge öncesinde durulur. TEST ve STABLE yayımlanmadı.

## Son entegre kodun doğrulaması

- İlgili son filtre: 64 dosya, 542 test, 0 hata/skip. Yeni 14 FOB regression
  kontrolü ve mevcut CP/LCW AI korumaları dahildir. İlk ilgili koşu da
  korunur; yalnız boş-kural fixture'ı netleştirildikten sonra son koşu yapıldı.
- Tam `npm test`: **1293 dosyanın 10 batch'i tamamlandı; 8865 geçti,
  0 hata, 65 mevcut skip**; 114,7 saniye. v714 geliştirme metrikleri
  testi de geçti. Skip'ler başarılı test sayılmadı. Her batch özeti
  `validation/full-npm-test.txt`, bütün ham çıktı `validation/npm-test.log.gz`
  içindedir; hiçbir batch atlanmadı.
- i18n: 0 yeni ve 0 baseline eksik. Release-note validator: 43 kayıt geçerli.
- Yeni browser scripti/testinin Node syntax kontrolü ve `git diff --check` geçti.
- CPR-11'in birebir hata metni/false kararı/formül ve sürüm invalidation testleri;
  LCW AI güvenli Markdown, streaming/final çıktı ve dil eşdeğerliği ilgili
  ve tam pakette geçti. Bu kaynaklar değiştirilmedi.
- Yerel testler son ürün kodu ve not/görsel üzerinde çalıştı. Sonraki düzenleme
  yalnız bu kanıt raporudur; ürün/test kodu yeniden değiştirilmedi.
- Gerçek GitHub CI son commit push'undan sonra #906 checks üzerinden doğrulanır;
  f732 üzerindeki eski yeşil sonuç yeni SHA için kullanılmaz. Yeni 14 test
  mevcut gerçek CI lisans adımına eklenmiştir. Kesin son SHA ve CI sonucu
  PR tesliminde bildirilir; rapor içine kendi commit hash'i yazılmaz.

Komutlar uygulama dizininden:

```sh
APPDATA=/tmp/buyerlog-client-tests/roaming LOCALAPPDATA=/tmp/buyerlog-client-tests/localapp BUYER_LOG_SERVER_DATA_ROOT=/tmp/buyerlog-client-tests/server npm test -- cp-rule cp-checklist business-rules lcwai markdown license-card license-quick manufacturer email-group card-list-model supp-fob
APPDATA=/tmp/buyerlog-client-tests/roaming LOCALAPPDATA=/tmp/buyerlog-client-tests/localapp BUYER_LOG_SERVER_DATA_ROOT=/tmp/buyerlog-client-tests/server npm test
npm run i18n:check
npm run release:notes:validate
```

Ölçüm ve trace komutları mevcut `client-paired-benchmark.js`,
`card-search-trace.js`, `analyze-client-pairs.js` ve
`analyze-card-search-trace.js` araçlarını kullanır. Tam lisans komutu:

```sh
node scripts/client-paired-benchmark.js --suite card --module license-cards --baseline-dir /tmp/client-followup-sources/A --candidate-dir /tmp/client-quick-fob-final-source --output /tmp/license-final-pairs
```

Kullanıcı talimatıyla lisans parçası korunur. Arama artışı açıkça raporlanır;
merge onayı verilmiş sayılmaz. Merge, TEST ve STABLE yapılmadı.
