# Faz 6a — tekrar üretilebilir ölçüm planı

Durum: **hazırlık; ölçüm yok, kazanç iddiası yok**. Bu plan ve bağımsız
toplayıcının self-test'i, gerçek benchmark veya shadow sonucu sayılmaz.
İnce projeksiyon ve nihai ölçümler #885 sonrası Main'i bekler.

## 1. Sabitleme ve karşılaştırma kolları

1. #885 Main'e alındıktan sonra tam Main SHA'sını A olarak sabitle. Envanteri
   o SHA'da yeniden doğrula/güncelle; #885 compute/source/IPC farklarını ekle.
   B, aynı Main + ayrı ince projeksiyon uygulama commit'i olsun. Bu fazda B yok.
2. A ve B aynı sentetik kaynak byte'larını, aynı scope/izin/Horizon ayarlarını,
   aynı override/formül/model/not tanımlarını ve aynı sabit clock'u kullanmalı.
   Şema, iş kuralı, kaynak daraltma ve compute değişikliği A/B arasında farklı
   olmamalı. Kaynak dosyaları bir kere üretip byte/SHA ile kopyala; XLSX ZIP
   zaman damgası yüzünden yeniden üretimleri aynı seed ile eşdeğer varsayma.
3. `shadow-matrix.json` S01–S24 önce full/full kontrol, sonra full/shadow ile
   geçmeli. İş değeri, tür, own-key varlığı, sıralı satır kimlikleri ve kapsam
   eşitliği zorunlu. Değişen transport zarfı harici genel ignore listesi yok.
4. Önceden sabit fixture matrisi: 0/1/127/128/129/1.000/30.000 satır;
   dar/geniş özel sütun profili; tek/çoklu IAS parsiyel; uzun not/Unicode;
   restricted/moderator/forbidden sentetik kullanıcılar. Büyük makro seri 30k;
   diğerleri doğruluk ve ölçek kontrolü. Clock `2026-11-07T12:00:00.000Z`,
   TR/EN; UTC, Europe/Istanbul, America/New_York ayrı seriler.

Mevcut sentetik üretici ve başlangıç harness'i kaynakta doğrulandı:
`resources/app/scripts/generate-demo-data.js` ve
`resources/app/scripts/benchmark-startup-orders.js`. Başlangıç harness'i
`--rows`, `--source-fixture`, `--fixture-root`, `--app-root`, `--out` kabul eder;
yalnız `/tmp/buyerlog-startup-*` kökünü kullanır ve data/auth/local DB/config/temp
yollarını izole eder. #885 sonrası harness SHA'sını da yeniden sabitle.

```sh
# Yalnız #885 sonrası ölçüm oturumunda, A checkout resources/app içinden.
# Gerçek kurulumun data/local/cache veya credential dizinini kopyalama.
CHROMIUM_PATH=/usr/bin/chromium node scripts/benchmark-startup-orders.js --rows 30000 --out /tmp/phase6a-A1-startup.json
# Önceki çıktının fixtureRoot/source yolunu ikinci koşunun --source-fixture
# argümanına ver; yeni koşunun data/cache/DB kökü taze kalmalı.
```

Generator seed'i bu harness'te `7`'dir. Edge-case JSON fixture ailesinin seed'i
`buyerlog-phase6a-v1`'dir; bunlar aynı fixture ailesi olarak sunulmaz. Üretici,
sentetik marker ve her XLSX/JSON SHA'sı rapora konur. Bu komutlar bu fazda
**çalıştırılmadı**. Mevcut makro harness tek başına JSON parse/hydration
ayrıştırıcısı değildir; aşağıdaki bağımsız toplama ve browser ölçümleri gerekir.

## 2. Kaydedilecek ortam

Her artefact: A/B commit SHA, dirty durumu, harness SHA-256, fixture hash'leri,
row/column/segment sayıları, generation/source/authority revision, izin profili,
canonical sürüm, payload capture hash'i, Node/V8/ICU, Chromium veya Electron
sürümü, OS/arch, CPU, CPU kotası, RAM limiti, timezone/dil, kompresyon seviyesi,
profiler/GC ayarı ve cache senaryosu. Bu paketin Node ortamı `24.19.0`'dır;
nihai seri tek sabit Node/Chromium çiftiyle yapılır. Windows/Electron sonucu
Linux/Chromium'dan çıkarılmaz. Soğuk **süreç/uygulama cache** ile soğuk OS disk
cache birbirinden ayrılır; OS cache temizlenmediyse soğuk disk denmez.

## 3. Payload

CP ve Orders projection endpoint'leri post-885 Main kaynaklarından saptanıp
capture konumları sabitlenir. Hazır gzip hit, on-demand miss ve ortak/farklı
CP/Orders kaynak kapsamı ayrı koşullardır.

| Ölçü | Yöntem / birim |
| --- | --- |
| Serileştirilmiş JSON | Tam response gövdesinin `Buffer.byteLength(text,'utf8')`; JS string length kullanılmaz |
| HTTP gövde | gzip/content-encoding durumuna göre yakalanmış gerçek body byte; header byte ayrı |
| Kontrol kompresyonu | Aynı JSON için Node zlib gzip level 4; gerçek HTTP transferiyle karıştırılmaz |
| Zarf ve satır | cpModelColumns/metadata ve rows byte'ları ayrı; toplam da korunur |
| Hydration | Açılan detaylar, fetch sayısı, başarı/hata, compressed/raw byte ve duplicate fetch ayrı |
| Oturum toplamı | İlk liste + sabit detay izi + export/AI hydration + refresh byte'ları; yalnız ilk liste düşüşü toplam kazanç diye yazılmaz |

Sabit kullanıcı izi: CP aç → arama/iki filtre/bir sort → ilk 20 farklı satırın
detayını sırayla aç/kapat → ilk 5'i yeniden aç → Orders aç/aynı eylemler →
seçili 10 ve filtrelenmiş tüm satırları export veri modeline hazırla → LCW AI
bağlamını **yerel** oluştur → refresh → CP'ye dön. Gerçek AI, mail/export
yayını, shared kaydetme yok. Her adımın yetkili satır kimlikleri hash ile tutulur.

## 4. JSON parse ve sentetik retained heap mikro ölçümü

[measure-json.cjs](measure-json.cjs) hazırlanmıştır; bu fazda `run` çağrılmadı.
Araç uygulama import etmez, sunucu başlatmaz, ağa çıkmaz. Post-885 capture
oturumunda `/tmp/buyerlog-phase6a-*` altında full/thin JSON gövdeleri ve aşağıdaki
manifest hazırlanır. Placeholder'lar gerçek ölçüm SHA'larıyla doldurulmadan
araç çalışmaz; marker'lar #885 merge veya shadow doğruluğunun bağımsız ispatı
değildir, önkoşul raporları ayrıca incelenir.

```json
{
  "synthetic": true,
  "phaseGate": "post-885-main",
  "shadowStatus": "passed",
  "mainSha": "<40 hex A SHA>",
  "candidateSha": "<40 hex B SHA>",
  "fixtureSha256": "<64 hex fixture manifest SHA>",
  "shadowReportSha256": "<64 hex S01-S24 result report SHA>",
  "rows": 30000,
  "full": {"file": "full.json", "sha256": "<64 hex exact body SHA>"},
  "thin": {"file": "thin.json", "sha256": "<64 hex exact body SHA>"}
}
```

```sh
# Bu komut bu fazda çalıştırılmayacak.
node docs/performance-program/phase-6a/measure-json.cjs run /tmp/buyerlog-phase6a-CASE/manifest.json > /tmp/phase6a-json-result.json
```

Protokol araçta sabittir: 10 taze süreç çifti, AB/BA dönüşümlü sıra, her süreçte
20 parse ısınması + 30 ölçüm. Aynı Node executable, `--max-old-space-size=4096`,
tek bir payload. Buffer okuma ve UTF-8 decode parse süresinin dışında; decode
süresi ve tutulan string heap farkı ayrıca kaydedilir. Gzip boyut hesabı bütün
parse/heap zaman pencerelerinin dışındadır. Parse penceresi yalnız
`performance.now()` çevresindeki `JSON.parse(input)`'tır; disk, ağ, gunzip,
response.json decode, structured clone, render ve hydration dahil değildir.

Her örnek: dışarıda forced GC → heap baseline (input Buffer/string elde) →
parse zamanı → immediate heap → GC → sonuç hâlâ canlıyken retained heap →
sonucu bırak. `heapUsed`, RSS, external ve arrayBuffers ayrı byte değerleridir.
Immediate fark peak heap değildir; retained fark da gerçek uygulama heap'i
değildir. GC, örnek/proses kurulumu parse zamanına dahil edilmez; GC maliyeti
ayrı makro inceleme konusudur. Ufak/negatif delta gürültüsü saklanır.

Araç ham 600 parse örneğini ve nearest-rank median/p95 özetini verir. Süreç
çiftleri bağımsız deney birimidir: karar raporunda her sürecin medyanı/p95'i,
10 eşli fark ve medyan eşli fark ayrıca hesaplanır; 600 örneği 600 bağımsız
koşu diye sunma. Aynı collector hydration response'larında ayrı çalıştırılır;
yalnız thin gövdenin parse azalması oturum kazancı sayılmaz.

## 5. Gerçek istemci heap'i ve parse yolu

Üç taze tarayıcı/sunucu oturum çifti AB/BA/AB ile aynı kullanıcı izini çalıştır.
Her çift yeni izole data/cache kökünde aynı sentetik kaynakları kullanır;
uygulama-warm revisit ayrıca ölçülür. CP ve Orders'ın ortak satır referansları,
cache'leri ve worker ömürleri korunur; heap'leri toplayıp iki kez sayma.

- Aynı browser build'inde CDP `Performance.getMetrics` ile JSHeapUsedSize /
  JSHeapTotalSize; `Runtime.getHeapUsage` ile heap/embedded/external verileri
  ayrı tutulur. Varsa worker target'ları ayrı kaydedilir; main renderer metriği
  tüm worker/server belleği sayılmaz. Browser/renderer RSS ve sunucu
  `process.memoryUsage` ayrı serilerdir.
- Kontrol noktaları: giriş idle → CP liste hazır → 20 detay sonrası → kapatma
  ve işlerin bitmesi → Orders → export/AI bağlamı sonrası → refresh sonrası →
  modülden çıkış/worker terminate sonrası. Her birinde doğal heap ve ayrı
  forced-GC retained heap alınır. Forced-GC koşusu latency serisine katılmaz.
- CDP HeapProfiler snapshot'ları doğal latency serisinden ayrı tanısal koşuda
  alınır. Parent/child row, duplicate strings, source bags, detached DOM ve
  cache retaining path'leri karşılaştırılır. Snapshot/profiler etkisi yokmuş
  gibi latency raporlanmaz.
- Ağ alınışı → decompression/decode → JSON parse → state kurulumu → ilk anlamlı
  çizim sınırları browser trace veya bağımsız test collector'ında ayrı işaretlenir.
  `response.json()` toplamı parse-only diye etiketlenmez. Worker structured clone
  gönderim/dönüş süresi ve taşınan byte yaklaşımı ayrı tutulur.

## 6. Sonuç ve kabul

Her payload profili için ham örnekler, tüm başarısız denemeler, timeout/hata
sayısı, median/p95, eşli mutlak fark (byte/ms/MiB) ve oranlar birlikte verilir.
Outlier silme yok; doğruluk başarısız örnek hızlı diye başarıya dahil edilmez.
Başarılı altküme gecikmesi gösteriliyorsa all-attempt sonuçları da verilir.
Başarısız seri düzeltildikten sonra ayrı seri adıyla tekrarlanır; eski sonuç
yerine yazılmaz. p95 için nearest-rank yöntemi sabittir.

Zorunlu kabul: S01–S24 sıfır iş farkı, scope/yetki eşitliği, açık dinamik alan
bağımlılığı kalmaması, hydration/error/stale yaşam döngüsü doğruluğu. Sayısal
performans hedefi bu fazda belirlenmedi; ölçülmemiş yüzde veya ms kazancı yok.
Önce full payload, sonra thin ilk payload, ardından detay/export/AI dahil
**oturum toplamı** ayrı raporlanır. Sonuçlar yalnız ölçülen fixture ve ortama
aittir. Merge veya TEST/STABLE yayın bu plana dahil değildir.
