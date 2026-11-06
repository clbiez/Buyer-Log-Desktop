# Faz 4 — istemci hesapları ve katalog eşdeğerliği (P2)

DS-06: worker ve sunucu, `server/lib/collection-catalog.js` içindeki aynı builder,
12 canonical alan ve mevcut v3 şemasını kullanır. Sunucu v3'ün ilk değer seçimi,
token dedup ve sıralama semantiği korunur. Worker'ın eski v2 çıktısına yalnız
sürüm etiketi eklenmedi; manufacturer ve canonical kimlik seçimi de ortaklaştı.
Bağımsız, filtresiz DB ana katalog servisi değiştirilmedi. Girdi kullanıcı
kapsamı ve Horizon süzgeçleri aynı çağrı noktalarında kalır.

ANA-01: Türkçe, numeric, base hassasiyetli tek Intl.Collator yeniden kullanılır.
Mevcut dönem tanıma, artan/azalan düzen ve kararlı eşitlikler korunur.

CPR-01: `kolEffectiveValue`, mevcut `createValueReader` ile kurulan parent
indeksini satır dizisi + workspace revizyonunda yeniden kullanır. İndeks yalnız
ilk gerçek parent kalıtımı okumasında kurulur; açık override ve renk alanları
için tarama yapılmaz. WeakMap her
canlı dizi için yalnız son okuyucuyu tutar. Normalize, uzak satır yamaları,
kendi satırını rebase etme ve hazırlanmış kayıt onayı gibi yerel pointer
değişimleri revizyon cevabını beklemeden invalidate eder. Parent nesnesindeki
yerinde alan değişimleri aynı referanstan okunur. Boş metin, 0, false ve null
override'ları ve ilk duplicate parent davranışı korunur. Yetki ve fiyat kuralı
hesapları değiştirilmedi; diğer render/grup maliyetlerinin tümü giderildiği
iddia edilmez.

## Doğrulama

Yeni dört test, eski kodda worker şeması 2≠3, Collator sayısı 0≠1, eksik
revizyon okuyucusu ve tüketici entegrasyonu nedenleriyle RED oldu. Uygulamayla
GREEN: gerçek worker üç seed'de bütün katalog alanlarında sunucuyla eşit;
sıralama artan/azalan/0 yönünde eski localeCompare sonucu ve kararlı düzenle
eşit; reader yerel silme/değiştirme, revizyon değişimi ve falsy override'larda
eski değer çözümleyicisiyle eşit.

Gerçek app fonksiyonlarını çalıştıran testlerde uzak parent değişimi,
ertelenmiş DOM çizimi sırasında fiyat hesabından önce görülür. Kendi satırını
rebase etme de taslak kaydından önce parent indeksini yeniler. Eski katalog
testlerinin tüm değer/şema assertion'ları korunarak yeni ortak bağımlılık
factory'ye verildi; canonical worker assertion'ları ortak kaynağa taşındı ve
gerçek worker tam çıktı karşılaştırması eklendi. Mevcut CP/Orders sync VM
fixture'ının window ve workspace revision bağımlılıkları tamamlandı; iş kuralı
assertion'ları korunup hazırlık durum sırası assertion'ı eklendi.

LCW AI dinamik kolon testi yeni workspace revision bağımlılığı fixture'a
eklendikten sonra gerçek bir fazladan indeks taramasını yakaladı (2≠1).
Yeni lazy-index testi de ilk override okumasında 1≠0 ile RED oldu. Revizyon
okuyucusu kalıtım gerektiğinde indeks kuracak şekilde düzeltildi; açık
`createValueReader` her salt okunur işlem için taze indeks kurmayı sürdürür.
Mevcut AI testinin bütün assertion'ları korundu. Dosya adı `lcwai-final-green`
olan ara log gerçekte başarısızdır; kanıt paketinde açıkça ara başarısızlık
olarak tutulur.

`npm test -- collection client-computation-performance chronological-sorting
business-rules projection-worker lcwai-dynamic-columns`: **138 dosya / 798 test PASS**, fail/skip/cancel
0. i18n **0 eksik / baseline 0**, release notes **24 kayıt PASS**. Tam suite bu
fazda çalıştırılmadı. Testlerin kaynakları ve gerçek çıktıları kanıt paketindedir.

Gerçek 20 siparişlik demo uygulamada altı Koleksiyon satırı, yalnız boş ve
sahibinin düzenleyebildiği çalışma alanında canonical `cpRowToKolRow` ile
oluşturuldu. Fixture kabulü önce 0≠6 ile RED, gerçek seed ile GREEN oldu.
TR/açık ve EN/koyu görüntüleri incelendi; 12 alanlı katalog, manufacturer,
sahip yetkisi ve font +4 menü geometrisi kontrol edildi. Yeni ürün metni
eklenmedi; görünür performans notu TR/EN ve gerçek PNG ile eklendi.

## Mikro ölçüm yöntemi

`scripts/benchmark-client-computation.js`: her örnek taze süreç. Üç tekrar,
before/after → after/before → before/after; her iş yükünde altı örnek ve tüm
çıktılarda aynı SHA-256 zorunludur. Linux / 4 vCPU / Node 24.19 / 16 GiB.
Test, UI veya başka benchmark aynı anda çalıştırılmaz; GC zorlanmaz.

- Catalog: aynı sentetik 30k Orders gzip'i gerçek projection worker'a verilir.
  Worker açılışı/mesajı/kapanışı ve katalog üretimi ölçülür. Eski v2 sonucu
  gerçek sunucu v3 builder'ıyla Orders açma/parse/yeniden üretme/gzip fallback'ini
  gerektirir; yeni v3 sonuç bu onarımı atlar. Nihai 12 alanlı çıktı SHA'sı eşittir.
  Bu mikro pipeline süresidir; çıplak builder veya gerçek HTTP latency değildir.
  Collator kazanımı da aynı fazın bu pipeline sonucuna dahildir.
- Sort: 30.000 karma dönem/metin değeri, artan ve azalan sıralama. İki tam
  sıralanmış dizi SHA ile karşılaştırılır.
- Reader: 5.000 model/renk satırında yedi alan, 35.000 gerçek `kolEffectiveValue`
  çağrısı; parent indeksi kurulumu ölçüme dahildir. Bütün değerler SHA ile eşittir.

İlk araç denemesinde sandbox `git spawnSync EPERM` hatası çıktı; JSON örneği
yazılmadı. Sonraki v1 serisi eşit çıktılar üretti ancak katalog Excel ve runtime
hash'leri aynı metadata alanına yazılıyordu. Doğrulama bunu yakaladı; v1 sonuçları
ön kanıt olarak korundu. Alanlar `fixtureHashes` ve `runtimeSourceHashes` olarak
ayrıldı ve v2 yeniden alındı. Son tüketici kontrolünde lazy-index düzeltmesi
gerektiği için v2 de ön seri olarak korundu; nihai kodla **v3, tam 18 taze
süreç** yeniden çalıştırıldı. Runtime dosyalarının gerçek SHA'ları, dirty
bayrağı ve harness SHA'sı her örnekte bulunur; final doğrulama 18 dosyanın
hash'ini mevcut kaynakla karşılaştırdı. Mikro aday kaydı dirty `5f2c38d7`
üstündeki lazy düzeltmedir; ölçülen runtime, sonradan commit edilen
`41789cca` ile byte eşittir. Ön uygulama `67fe95d8` temizdir.

Nihai v3 mikro sonuçları (üçer örnek; milisaniye):

| İş yükü | Önce medyan | Sonra medyan | Önce min–max | Sonra min–max |
| --- | ---: | ---: | ---: | ---: |
| Worker + katalog onarımı pipeline | 5525.734 | 1961.454 | 4967.683–6858.626 | 1497.054–2201.886 |
| 30k artan ve azalan sıralama | 5562.102 | 358.282 | 5321.334–5705.391 | 343.398–386.381 |
| 5k × 7 alan okuması | 1571.498 | 17.979 | 1525.599–1626.838 | 16.069–18.002 |

[Doğrulandı] Her iş yükünde altı çıktı aynı SHA-256'ya sahiptir. Her eşleşmiş
çiftte süre kısaldı. Bu sonucun kapsamı ölçülen iş yüküdür; aynı oranda tüm
uygulama kazanımı iddia edilmez. Ön v2 serisinin ilk katalog çifti
13.323 → 34.239 sn ile kötüleşmişti; geniş varyansın nedeni [Bilinmiyor].
Ön örnekler dışlanmadı ve final seriyle karıştırılmadı.

## Faz 0 tam uygulama karşılaştırması

Aynı 7.0.339 tabanı, aynı 30k kaynak Excel SHA'ları, ayrı fixture kökleri ve
süreçler kullanılır. Ön çalışma ağacı `67fe95d8`, aday parent `873a14f4` ile
`resources/app` altında byte eşittir (`git diff --exit-code` başarılı).
İlk altı koşu before/after, after/before, before/after sırasıyla `5f2c38d7`
adayıyla PASS oldu. Sonrasında tespit edilen lazy-index düzeltmesi nedeniyle
bu üç after sonucu yalnız ön kanıt olarak tutuldu. Kod değişmeyen üç before
örneği korunup final `41789cca` ile üç yeni after seri olarak alınır. Bu son
after örnekleri zaman açısından before ile dönüşümlü değildir; çevresel
varyansın tümü izole edildiği iddia edilmez.

Final altı örnek **PASS**: Overview/Orders 30.000, CP 24.982, Koleksiyon 0
satır; generation, kaynak hash ve revizyon kontrolleri her koşuda eşittir.
Ölçümler Linux / 4 vCPU / Node 24.19 / Chromium 154 / 16 GiB ortamındadır.

| Tam uygulama metriği | Önce medyan (sn) | Sonra medyan (sn) |
| --- | ---: | ---: |
| Yenileme | 47.862 | 40.150 |
| Overview: birincil hazır | 6.507 | 4.639 |
| Overview: perde hazır | 6.523 | 4.661 |
| Overview: sistem açılışı | 6.693 | 4.743 |
| CP: birincil hazır | 60.278 | 60.322 |
| CP: perde hazır | 60.299 | 60.339 |
| CP: sistem açılışı | 60.480 | 60.493 |
| Orders: birincil hazır | 7.522 | 7.796 |
| Orders: perde hazır | 7.555 | 7.814 |
| Orders: sistem açılışı | 7.952 | 7.937 |
| Koleksiyon: birincil hazır | 15.092 | 10.967 |
| Koleksiyon: perde hazır | 15.107 | 11.027 |
| Koleksiyon: sistem açılışı | 15.225 | 11.074 |
| Aynı sekme: CP | 43.934 | 44.885 |
| Aynı sekme: Orders | 2.789 | 2.655 |
| Aynı sekme: Koleksiyon | 0.147 | 0.151 |

Yenileme boyunca başarılı `/api/status` p95 medyanı 35.416 → 16.730 ms; `/api/health` hâlâ 404: p95 RTT 1038.091 → 770.792 ms. Bu ikinci sayı başarılı health yanıtı değildir.

Bütün tekil örnekler, sabit 0–10 sn long-task değerleri, GC zorlanmadan
alınan heap/RSS örnekleri, refresh alt adımları, sunucu logları ve stall CPU
profilleri [kanıt paketinde](phase-4-artifacts/summary.json) tutulur. İlk Faz 0
yenileme medyanı 53.231 sn tarihsel referanstır; arada fazlar ve upstream
değişimleri olduğundan yalnız Faz 4 etkisi olarak sunulmaz. Koleksiyon makrosu
0 satır içerir; 5k dolu veri için yalnız ayrı alan okuma mikrosu ölçüldü.

[Doğrulandı] CP sıcak geçişi ve Koleksiyon sıcak geçişi medyanı kötüleşti;
Orders birincil hazır süresi de arttı. Bu faz bütün ekranları hızlandırdı
iddiasında değildir. Yenileme medyanındaki farkın tümünü tek bir optimizasyona
atfetmek için ölçüm yeterli değildir.

## Ana dal entegrasyonu

Ölçüm sürerken ana dala giren #880 (`c225f911`) royalty düzeltmesi tümüyle
korundu; business-rules, ilgili testler, gerçek PNG ve sürüm notu birleştirildi.
Bu değişiklik `resolveOrderLicensor` sınıflandırmasını etkiler; ortak sıralama
ve okuyucu işlevlerini değiştirmez. Yukarıdaki süreler entegrasyon öncesi
`41789cca` adayına aittir; yeni royalty sınıflandırma maliyeti ölçülmüş sayılmaz.
Faz 5 baz çizgisi birleşik uygulamadan alınacaktır.

İlk entegrasyon test komutunda geçici veri kökü tanımlanmadığı için dört dosya
varsayılan ev dizini oluşturma hatasıyla test gövdelerine giremedi. Log korunur.
Testler değiştirilmeden komut ayrı demo app/local/server/temp/config yollarıyla
yeniden çalıştırıldı: aynı filtre + `dtr-manufacturer-licensor`, **139 dosya /
803 test PASS**, fail/skip/cancel 0. i18n **0 / baseline 0**, **25 sürüm notu
PASS**. Ardından birleşik uygulamada TR/açık ve EN/koyu altı satırlık gerçek
Koleksiyon kabulü yeniden PASS oldu; iki PNG incelendi. Sürüm notu doğrulayıcı
son PNG'den sonra tekrar PASS oldu. Kod testten sonra değiştirilmedi.

## Yayın ve risk

TEST: yapılmadı. STABLE: yapılmadı. Bu faz P2'dir; P1 fazlarının bağımsız inceleme
kuralı sonraki ilgili fazlarda uygulanır. Worker v2→v3 iç payload'ının değişmesi
beklenen düzeltmedir; karşılaştırılan kullanıcı çıktısı mevcut sunucu v3'tür.
Makro açılış kazanımı ancak tamamlanan Faz 0 örnekleriyle raporlanır.
