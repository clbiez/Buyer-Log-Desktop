# Faz 5 B1 — sabit FX timeout tanısı / frozen FX timeout diagnosis

**Tanı kaynağı: #885, `69950f289a012f0bb7c61290bec9890f340f6c64`. B1 ve P1 incelemesi açık.**

TR: Bu dal yalnız yeni tanı script'i, test ve kanıt içerir. `server.js`,
`app-main.js`, compute/Excel/FX üretim dosyaları ve Claude sözleşmeleri değişmez.
#892 bu sabit kaynakta **yoktur**. Sonuç güncel Main, #892 veya resmî kabul
ölçümü değildir. İnceleme dalı rebase/force-push edilmez; merge/TEST/STABLE yok.

EN: Diagnostic-only branch based on frozen #885. It excludes #892 and does not
replace the outstanding P1 review or the official performance acceptance cohort.
No production changes, replacement workers, extended deadlines, merge or release.

## Sonuç ve kanıt sınırı / Finding and limits

**[Doğrulandı]** Geçerli üretim Office işleriyle kontrollü yükte ve mevcut native
ortak havuzda, KUR olmayan / geçerli KUR bulunan iki senaryonun her birinde üç
FX timeout'u yeniden üretilir: dolu slotlar, aynı serialization anahtarı ve
tutulmuş çıktı lease'i. Altısının tamamı **kuyrukta** dolar. Hiçbirinde FX işi
worker'a dispatch edilmez. Native `durationMs=0`, `queueWaitMs≈5000`; worker
yürütme zaman damgaları yoktur. Yokluk, ölçülmüş sıfır parser süresi sayılmaz.

**[Doğrulandı]** Bazdaki Excel istemcisi sayacı `start()` içinde, native worker
constructor'ından sonra kurar. Kuyruk beklemesi 5000 ms'ye dahil değildir.
Adayda sayaç `compute-pool.run()` kabulünde, `pump()` öncesinde başlar; kuyruk,
constructor, worker başlatma/mesaj teslimi, yürütme ve yanıt aynı bütçededir.
Kaynak: baz `1d8e8d39:resources/app/server/excel-worker-client.js` ve aday
`server/lib/compute-pool.js` (`run`, `pump`, `start`, `timing`). FX işi
`background`, `serializationKey='shared-fx'`, `timeoutMs=5000` gönderilir.

**[Bilinmiyor]** Önceki resmî üçlüdeki dört timeout'un her birinin tam aşaması.
O kayıtlarda job/dispatch/worker zaman çizelgesi yoktur; yeni kontrollü deneyler
geriye dönük olay kanıtı değildir. Eski baz 0 / aday 1–2–1 bulgusu korunur.
Yeni gerçek 30k tekrarlarının sonuçları aşağıdaki ayrı koşu envanterindedir.

EN: Six controlled FX timeouts exhaust the shared queue deadline before any FX
dispatch. The migration also changes which stages consume the five seconds.
Historical four-event attribution remains unknown without historical traces.

## Kontrollü matris / Controlled matrix

[Ham JSON ve loglar](phase-5-fx-timeout-evidence/matrix-03/index.json).
Her hücre taze süreç/store ve izole sentetik dizin kullanır; işlemler seridir.
FX timeout'u beklenen tanı sonucu olabilir; `completed` koşu durumu FX başarısı
anlamına gelmez. Aynı native `compute-pool`, `compute-service`, `compute-worker`
ve `excel-worker` çalışır.

| Senaryo | KUR yok: kuyruk ms | Geçerli KUR: kuyruk ms | FX sonucu / FX outcome |
| --- | ---: | ---: | --- |
| Soğuk boş havuz | 0.34 | 0.35 | missing / apply |
| Isıtılmış boş havuz | 0.05 | 0.16 | missing / apply |
| İki slot, 14 interactive Office işi | 5000.06 | 5000.08 | queue timeout / queue timeout |
| Bir slot meşgul, 6 Office işi aynı `shared-fx` anahtarında | 5001.27 | 5001.16 | queue timeout / queue timeout |
| Aynı Office yükü farklı anahtarda | 0.32 | 0.09 | missing / apply |
| Health çıktı lease'i tutulmuş | 5000.90 | 5001.29 | queue timeout / queue timeout |
| Aynı lease ~1000 ms'de bırakılmış | 998.88 | 1000.44 | missing / apply |

Office yükü: normalleştiriciden hatasız geçen altı sayfa × 5000 satır × 20
sütun (toplam 30k sentetik satır), gerçek XLSX renderer. Worker içinde sleep,
spin veya sahte görev yok. `key-*` hücrelerinde Office işlerine verilen anahtar
**deneysel scheduler kontrolüdür**, gerçek Office çağrı sözleşmesi değildir.
Farklı anahtar deneyinde FX'in `shared-fx` anahtarı değiştirilmez.

Normal hücreler üretim varsayılanını kullanır: 2 worker / 4 GiB. Bellek hücreleri
ayrı, açıkça daraltılmış bütçeyi kullanır: bir worker; bütçe `32 MiB + FX
estimatedBytes + 512 byte`. Gerçek health sonucunun 1024 byte lease'i işi
çalıştırmayı engeller. Kuyruğa kabul başarılıdır; `COMPUTE_QUEUE_BUSY` veya
iş-boyutu reddi değildir. Bu hücreler eski dört olayın bellek baskısından
kaynaklandığını göstermez. Native sayaç/lease/idle-cache tahliyesi korunur.

`wait-state` örnekleri dolu havuzda yalnız `slots`, anahtar deneyinde yalnız
`serializationKey`, bellek deneyinde yalnız `memory` gösterir. Bunlar 50 ms
örnekleme ve gerçek havuz durum değişimlerinden alınır; ayrı toplanabilecek CPU
süreleri değildir. Kesintisiz zaman bilgisi native queue metriğinden gelir.

## Gerçek zaman çizelgesi / Timestamp evidence

İzler `performance.timeOrigin + performance.now()` ile epoch milisaniyesi
kaydeder. `submit`/`submitted` gerçek enqueue anını sınırlar; native
`queueWaitMs`/`durationMs` aynen saklanır. `dispatch`, native `postMessage`
öncesidir. `worker-boot` preload başlangıcı, `worker-receive` gerçek worker
handler'ından hemen önce, `worker-finish` üretim result mesajından hemen öncedir.
`main-receive`, havuz resolve/reject'i ve lease bırakılması ayrıdır.

Örnek: geçerli KUR, soğuk boş havuz:

| Olay / Event | Epoch ms |
| --- | ---: |
| Dispatch | 1794072787009.2913 |
| Worker preload başlangıcı | 1794072787051.9016 |
| Worker mesaj alımı | 1794072787097.0437 |
| Worker sonuç gönderimi öncesi | 1794072787255.7207 |

Constructor 2.06 ms; dispatch→receive 87.75 ms; receive→finish 158.68 ms.
Isıtılmış worker'da aynı ilk FX işi için dispatch→receive 0.12 ms,
receive→finish 146.53 ms; sonraki değişikliksiz FX kontrolü sub-ms düzeyindedir.
İlk FX görevinde modül yükleme/decode/parser hazırlığı worker yürütme span'ına
dahildir. Bu alt işlemler ayrıca zamanlanmadığından hepsine “XLSX parse” veya
“worker startup” denmez. OS planlama/mesaj teslimi de dispatch→receive içindedir.

`service-submit`→`submit` kodlama/kabul öncesi hazırlığı sınırlar;
başarılı servisin `paramsSerializeMs` metriği ayrıca saklanır. Timeout'ta
servis bu metriği eklemeden reject eder; o hücre için sınırlandırılmış span
kullanılır. `postMessageMs` structured-clone/transfer çağrısıdır; worker açılışı
ve tüm yürütme yerine kullanılmaz.

## FX verisi, revision ve durum / Semantic parity

Gerçek `syncFxFromKurWorkbook` fonksiyonu source'tan değişmeden çıkarılır;
gerçek `db.loadFx/saveFx`, gerçek native havuz ve gerçek `/api/fx` route handler'ı
çalıştırılır. Kimlik middleware'i sentetiktir; bu matris HTTP ağ gecikmesi ölçmez.

- KUR yok / boş havuz: `found:false, updated:false, reason:'KUR Excel bulunamadı'`;
  store ve revision aynıdır, `folderSync:null`.
- KUR yok / timeout: store/revision aynıdır; yanıt `parse-failed`,
  `folderSync` varsayılan `KUR.xlsx` ile parse-failed olur. Durum eşdeğerliği
  **başarısızdır**. Gerçekte bulunmayan dosya için parse hatası bildirilir.
- Geçerli KUR / başarı: deterministic parser, fingerprint, provenance ve sparse
  aylar korunur; Eylül TRY ve Ekim CHF saklanır, Kasım kur değerleri eklenir;
  revision 1→2. Aynı dosyanın sonraki kontrolünde revision 2 kalır ve tam durum
  değişmez. Bağımsız başarılı süreçler karşılaştırılırken yalnız `updatedAt` ve
  `_updatedAt` saat alanları dışarıda bırakılır.
- Geçerli KUR / timeout: mevcut store değer/revision'ı korunur (1 kalır),
  yeni dosya uygulanmaz; `found:false` / parse-failed döner. Başarılı okuma ile
  veri, revision ve durum eşdeğerliği **sağlanmaz**. Yanlış kur yazıldığına
  ilişkin kanıt yoktur; mevcut kurun güncellenmemesi kanıtlanır.

Timeout catch'i `saveFx` çağırmaz. İş worker'a hiç gitmediğinden timeout sonrası
geç uygulanmış kur da yoktur. Başarısız FX kontrolü script tarafından tekrar
denenmez; her taze F0 kökünde refresh POST'u yalnız bir kez gönderilir.

## Tekrar üretim ve saklama / Reproduction and retention

`resources/app` içinden, başka benchmark/test çalışmıyorken:

```sh
node scripts/diagnose-fx-timeout.js matrix /tmp/buyerlog-fx-new-matrix
node scripts/diagnose-fx-timeout.js verify /tmp/buyerlog-fx-new-matrix
```

Tüm matris hücrelerinin JSON/trace/logları saklanır. `matrix-01` Office giriş
şeması eksik olduğu için geçersiz yük deneyidir: Office hataları gizlenmez.
`matrix-02` geçerli daha kısa yükle queue beklemesini gösterir; slot/anahtar
hücrelerinde timeout üretmez. `matrix-03` daha uzun, önceden tanımlı işi kullanır;
önceki örneklerin yerine başarılı/başarısız örnek seçilmemiştir.

Observer ana süreçte gözlemleri bellekte tutup kapanışta yazar; native worker'a
yalnız preload eklenir. Ek telemetry mesajlarının ölçüm etkisi sıfır sayılmaz.
CPU profiler açılmamıştır; oluşmamış CPU profili varmış gibi sunulmaz. Ham trace
bir CPU profili değildir. Test RED→GREEN ve başarısız observer geliştirme logları
da saklanır. Üretim hash'leri ve bütün kanıtlar SHA manifestiyle bağlanır.

## En küçük düzeltme önerisi / Smallest proposed correction

**Uygulanmadı; ölçülmemiş kazanç yok.** İlk dar düzeltme, parse gerçekleşmeden
oluşan `COMPUTE_TIMEOUT`/admission hatasını `parse-failed` saymayan geçici
okuma/kuyruk durumu olmalıdır; kur/revision korunmalıdır. Eski dört olayın
dosyasız girdisi için kanonik dosya seçimini koruyan async KUR ön kontrolü,
dosya yoksa FX işini havuza sokmadan missing sonucunu üretebilir. Bu öneri
geçerli dosyanın dolu havuzda gecikmesini tek başına çözmez.

Geçerli dosya için ayrı küçük scheduler deneyi gerekir: mevcut havuzda
deadline'a göre adil dispatch ve aynı kaynak kimliğine ait yinelenen FX
kontrollerini birleştirme. Yalnız priority değiştirmek kuyruktaki eski işlerin
önüne geçmeyi garanti etmez; anahtarı kaldırmak FX yazma sırasını bozabilir.
Çıktı lease'i gerçekten RAM bütçesini tüketiyorsa admission atlanamaz. Toplam
5000 ms bütçe korunmalı; timeout'u dispatch'te yeniden başlatmak çözüm sayılmaz.

Yeni üretim düzeltmesi için yetki/revision/CAS, kaynak değişimi ve TR/EN durum
eşdeğerliği ayrıca doğrulanmalıdır. Görünür değişiklikte Motion+, reduced-motion
ve gerçek post-change PNG'li release note kuralları geçerlidir. Bu tanı bunları,
mevcut P1 incelemesini, 200 ms kabulünü veya refresh ürün kararını kapatmaz.

## Gerçek 30k tekrarları / Actual 30k repetitions

[Koşu envanteri](phase-5-fx-timeout-evidence/startup-catalog.json) tüm keşif ve
nihai koşuları içerir. Her taze kökte bir refresh POST'u gönderildi. Başka
benchmark/test aynı anda çalışmadı. Hiçbir koşuda FX compute timeout'u oluşmadı.

| Koşu / Run | Kaynak ve disk | FX kontrolü | Sonuç / Outcome |
| --- | --- | ---: | --- |
| Kısa Overview, KUR yok | 07.11 seed-7, `/tmp` tmpfs | 1 | missing |
| Kısa Overview, ilk KUR denemesi | 07.11, tmpfs | 0 | FX yolunu gözlemez; KUR fixture'ı da geçersiz |
| Tam F0, KUR yok | 07.11, tmpfs | 5 | missing |
| Tam F0, birebir eski kaynak, KUR yok | 05.11, `/workspace` overlay | 5 | missing |
| Tam F0, ilk KUR denemesi | 05.11, overlay | 5 | Parser `found:true, updated:false, parse-failed`; **geçerli KUR kanıtı değil** |
| Tam F0, kanonik parser'dan geçmiş KUR | 05.11, overlay | 5 | 1 apply + 4 değişikliksiz kontrol |

Eski üç kaynak SHA'sı birebir yeniden üretilmiştir:

```text
ASAS - Demo.xlsx    2ce763911d9e89525d9254415ca0270ba6241d065acbd9df75f4efc20bb5dc99
Antrepo - Demo.xlsx c4820f94b941c01368e34bafe696d81c4fd72ba20fb177dd5801e7b811493a0d
LFL - Demo.xlsx     8f816621fb5fba8868dfa10378b00c646ac6404706b1d4412d63bde98b63019f
```

Harness SHA `f6a619c0002d40cc4bfae67adf051fa55323d933ffad2d3553fb492f619797dc`,
Node 24.19.0, Chromium 154.0.8037.57, CPU modeli ve 16 GiB sınırı aynı.
Eski CPU kotası `1600000 400000`, yeni `400000 100000`: ikisi dört CPU
eşdeğeridir, dönemleri farklıdır. OS cache zorlanmadı. Tmpfs keşifleri disk
ölçümüne eşit sayılmaz. Bu koşular observer yüklü tanısal tekrardır; eski
resmî serinin yerine geçmez ve hızlanma iddiası oluşturmaz.

Kanonik geçerli KUR ile FX queueWait **0.022–0.154 ms**; ilk görev MAIN
params serialization **0.045 ms**, postMessage **5.064 ms**, native duration
**282.678 ms**, worker execution **276.592 ms**. Dört sonraki kontrol revision'ı
artırmaz. Gerçek kalıcı [FX store](phase-5-fx-timeout-evidence/buyerlog-startup-fx-canonical-valid/final-fx-store.json)
revision **1**, source fingerprint
`466eb00813b0690828d1e42d813bc278b4c8d3e73417ef1da2bbfd04ac2931f3` ve Kasım
USD=1 / TRY=40 / EUR=0.95 içerir. Bu taze F0 store'u, önceden revision 1 ile
başlatılan kontrollü matrisin store'uyla karıştırılmaz.

İlk tek-ay fixture'ı kanonik layout algılamasını geçmedi. Hata silinmedi;
`fixture-classification.json` bunu işaretler. Yeni regression testi gerçek
parser'da RED oldu, üretici düzeltildikten sonra GREEN oldu. Üretici artık
ölçüme başlamadan `readFxWorkbook()` ile doğrulanır. Validator değişmedi.
Yalnız ilk okuma/hydration denemelerinin `invalid-unhydrated-fx-snapshot.json`
çıktıları kalıcılık kanıtı olarak kullanılmaz; doğru final store ayrıca saklanır.

**Karar:** Normal F0'daki tarihsel dört olay bu ortamda yeniden üretilmedi.
Kuyrukta bütçe tüketme mekanizması ve durum/veri eşdeğerliğinin yük altında
bozulması kontrollü deneyde kanıtlandı. “Eski dört timeout kesin kuyruktu”
veya “FX/P1 kapandı” sonucu çıkmaz.

EN: Exact historical source bytes were regenerated. Both the missing-workbook
and canonically valid-workbook full F0 repetitions complete five FX checks
without a compute timeout. Earlier invalid workbook attempts remain labelled.
Controlled queue exhaustion is proven; attribution of the historical four
timeouts is still unresolved.

## Doğrulama ve yeniden çalıştırma / Validation and replay

Yeni testler: **7/7 GREEN**. İlk zamanlama sözleşmesi, kuyruk sonrası açılan
worker constructor'ının doğru işe bağlanması ve gerçek KUR fixture parser hatası
için ayrı RED logları korunur. Kuyruk pompasının yeni worker'ı bir `run()`
çağrısı dışında açması mümkündür; nihai analiz constructor'ı worker kimliği ve
ilk dispatch üzerinden bağlar. Eski raw trace/result dosyaları değiştirilmez;
yeniden türetilen `fx-summary.json` bu bağlamayı kullanır.

Son ilgili paket **43 dosya / 183 test PASS**, fail/skip/cancel 0.
İlk ortam hatası (varsayılan `/home/agent/.buyer-log` yolu) 165 pass / 5 fail
olarak korunur; aynı testler izole environment yollarıyla geçer. Test veya
assertion gevşetilmedi. i18n **0 yeni / 0 baseline**; mevcut release-note
validator **36 OK**. Tam regresyon ve bağımsız P1 incelemesi yapılmış sayılmaz.

```sh
# Repo bu tanı dalında; resources/app içinden. Her ROOT yeni olmalı.
node scripts/diagnose-fx-timeout.js matrix /tmp/buyerlog-fx-new-matrix
node scripts/diagnose-fx-timeout.js verify /tmp/buyerlog-fx-new-matrix

# Diskte, eski 30k kaynak SHA'larını kontrol ederek tam F0:
mkdir -p /workspace/buyerlog-benchmark-temp
TMPDIR=/workspace/buyerlog-benchmark-temp CHROMIUM_PATH=/usr/bin/chromium \
  node scripts/diagnose-fx-timeout.js startup \
  /workspace/buyerlog-benchmark-temp/buyerlog-startup-fx-new-missing missing
TMPDIR=/workspace/buyerlog-benchmark-temp CHROMIUM_PATH=/usr/bin/chromium \
  node scripts/diagnose-fx-timeout.js startup \
  /workspace/buyerlog-benchmark-temp/buyerlog-startup-fx-new-valid valid

# Benchmark'lar tamamlandıktan sonra:
fx_test_root=$(mktemp -d /tmp/buyerlog-fx-tests.XXXXXX)
export BUYER_LOG_DATA_ROOT="$fx_test_root/app"
export BUYER_LOG_LOCAL_DATA_ROOT="$fx_test_root/local"
export BUYER_LOG_SERVER_DATA_ROOT="$fx_test_root/server"
export BUYER_LOG_AUTH_DATA_ROOT="$fx_test_root/auth"
export BUYER_LOG_TEMP_ROOT="$fx_test_root/tmp"
export BUYER_LOG_CONFIG_PATH="$fx_test_root/config.json"
export BUYER_LOG_CENTRAL_IAM_ENABLED=0
npm test -- compute fx server-compute-pool
npm run i18n:check
npm run release:notes:validate
```

`matrix`, `scenario`, `startup` ve server preload, ilgili üretim yollarının
sabit inceleme SHA'sıyla eşleşmesini zorunlu kılar. Mevcut kök üstüne startup
tekrar çalıştırılmaz. `analyze ROOT` yalnız saklanmış trace'leri yeniden türetir.
`verify` 14 kontrollü hücrenin gerçek veri/revision/durum beklentilerini denetler;
performans kabul validator'ı değildir.

Ölçüm sırasında kullanılan iki observer source snapshot'ı kanıtta saklanır;
son script'e sonradan yalnız fixture/replay guard ve constructor bağlama
doğrulamaları eklenmiştir. Source hash'leri manifestte ayrıdır. Eski başarısız
Office deneyi ve kısa yük serisi `matrix-01.tar.gz` / `matrix-02.tar.gz`,
ek keşif açılışları `supplemental-startups.tar.gz` içindedir. Ham JSON/log
baytları SHA manifestiyle korunur; CPU profiler açılmamıştır.
