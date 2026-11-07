# INT-01 — DB ortak parse tanı ve test hazırlığı

**Hazırlık tamamlandı. Tam kopyalama adayı üretim için reddedildi. INT-01
uygulaması Faz 7 sırasını ve 6c kaynak sahipliği sözleşmesini bekliyor.
PR merge'i / TEST / STABLE yok.**

EN: Preparation completed. The full-copy candidate is rejected for production.
INT-01 implementation awaits phase 7 ordering and the phase 6c source-ownership
contract. No merge or TEST/STABLE publication.

#885 sonrası Main `63159fb32ff3d5bdc5f142b4a8f16ca6a3983240` normal merge ile
alındı; merge commit'i `fa632abe4a2023e75f57b2d65707be14508843d6`.
Harness/fixture/test kodu, parse anchor'ları ve eski ölçümler değiştirilmedi.
Yeni uyumluluk kanıtı [main-compatibility](main-compatibility/) altındadır:
**16 dosya / 140 test PASS; fail/skip/cancel=0**, i18n **0 yeni / 0 baseline**.
Bu turda yeni performans kampanyası veya aday geliştirme yapılmadı.

[6c sahibine tasarım girdisi](6c-design-input.md): tam grafik kopyalamanın
parse tasarrufunu tüketmesi; immutable taban sahibi, ince mutable overlay,
run/rule/parser sürümü, generation ve commit öncesi yayın sınırının birlikte
tasarlanması. Worker'a taşıma tek başına kopyalama maliyetini çözmüş sayılmaz.
Bağımsız inceleme kullanıcının güncel talimatıyla başlatılmadı.

EN: Main after #885 was incorporated by a normal merge. Harness, fixture, test
code, parse anchors and historical measurements remain unchanged. Compatibility
passes 140 tests in 16 files and i18n 0/0; no new benchmark/candidate was run.
The linked design input is for the 6c owner. Independent review is not started.

## İlk ölçümün kaynağı ve sınırı

- Bulgudaki INT-01, `server/lib/model-refresh.js` içindeki `runRoleScopes` →
  `loadFromModelConnections` zincirinde doğrulandı. Aynı connection/scope bir
  `run` paylaşır; ASAS dört, IAS üç hedef için yeniden parse edilir. LFL ayrı
  parser'dır ve ASAS cache'ine katılmaz.
- Baz: Main **`5a1656e98deeb573f6245f4b24a8135cc77a0d7b`**, birleşmiş #892.
  İki ölçüm kolunda üretim ağacı, #892 kodu, fixture ve harness aynıdır.
  `plan.json` tam SHA-256 envanterini taşır. `server.js`, `app-main.js`,
  ortak compute/worker dosyaları ve Claude'un dosyaları değiştirilmez.
- Açık #885, #890, #891 ve #893'ün dosya listeleri kontrol edildi; bu pakette
  yalnız INT-01'e ait yeni dosyalar vardır. #892'nin özel `app-main.js`
  istisnası kullanılmadı/genişletilmedi. İnceleme SHA'larına rebase/force-push yok.
- 6c referansı: #885 salt okunur `69950f289a012f0bb7c61290bec9890f340f6c64`
  içindeki `docs/performance-program/phase-5-source-ownership.md`.
  Ham grafiğin owner/generation yaşam döngüsü, Date/ISO ayrımı, enumerable
  olmayan IAS metadata/alias, commit öncesi yayımlamama ve ana süreçte yetki
  doğrulaması korunmalıdır. Bu paket bunları uygulamaz veya tamamlanmış saymaz.

EN: The real source deduplicates queries but repeats target parsing. This package
adds only diagnostic scripts/tests/documents, based on Main with #892. All locked
production and Claude files remain read-only. The frozen #885 ownership contract
is a prerequisite, not an implemented feature of this preparation.

## Harness ve deney

`int-01-refresh-harness.js` gerçek `model-refresh.js` kaynağını ayrı bir Node
Module içinde derler. İki tam parse çağrısı ve refresh giriş anchor'ı yalnız
bellekte gözlemciye yönlendirilir; diskteki kaynak değişmez. Anchor tekil değilse
çalışma durur. Test, gözlenen baz ile doğrudan değişmemiş üretim modülünün
sonuçlarını karşılaştırır. Sorgu planlama, DB-row normalizasyonu, LFL, IAS
integrity/audit ve target raporlama gerçek koddur. Transport ve şema keşfi
taklittir; credential, gerçek DB/iş verisi, HTTP veya refresh POST yoktur.

Fixture, mevcut Faz 0 demo üreticisinin `build` fonksiyonundan seed=7 ve sabit
**2026-11-05 UTC** tarihiyle object-row üretir: 30.000 ASAS, 12.726 IAS kaydı.
IAS satırlarına sentetik parsiyel kimliği eklenir. Bu **Faz 0 XLSX byte fixture'ı
değildir**; DB sonuç fixture'ının SHA'sı raporlarda dondurulmuştur. Ayrı scope
testinde gerçek farklı DAX koşulları ve farklı sonuç alt kümeleri kullanılır.

Tanı prototipi yalnız `scripts/lib` altındadır; uygulama tarafından import edilmez.
Cache her refresh başında oluşur; anahtar gerçek **run nesne kimliği + parser
türü + normalize match config + parser sürümü**dür. Aynı rows dizisine sahip
farklı run'lar birleştirilmez. Parser sürümü bu deneyde `parse.js` SHA-256'sıdır;
diğer parser bağımlılıkları kohort manifestinde sabitlenir. Üretimde bağımlılıkları
da kapsayan sürüm/owner sözleşmesi ayrıca tasarlanmalıdır.

Cache tabanı closure içinde saklanır, yalnız okunur ve tüketiciye verilmez.
`Object.freeze(Date)` değişmezlik garantisi sayılmaz. Her hedefe Date, nested
alanlar, null-prototype map, enumerable olmayan metadata ve grafik içi alias'ları
koruyan **tam mutable kopya** verilir. Böylece hedefler birbirini değiştiremez.
Bu, ince immutable taban + alan bazlı overlay tasarımı değildir; tam kopyalama
maliyetinin güvenli bir kontrol deneyidir. Yalnız parser'ın mevcut
plain-object/array/Date grafiği kapsanır; genel V8/Map/Set clone hizmeti değildir.
Run.rows refresh sırasında değişmez kabul edilir; mutasyona uğrayan aynı run'ı
yeniden kullanmak desteklenmez.

EN: The harness runs the real refresh module with three guarded in-memory
instrumentation anchors and a mock transport. The fixed-date DB-row fixture is
derived from the phase 0 demo generator, not its XLSX bytes. The private,
refresh-local parse base is never exposed. Every target receives a complete
mutable graph copy preserving Date, hidden metadata, prototypes and aliases.
This is a diagnostic full-copy control, not a production overlay design.

## Kanıt ve tekrar üretme

İlk `diagnosis-before.cpuprofile.gz` adayı yazmadan önce alındı: gerçek iki taklit
sorgu, 4 ASAS + 3 IAS parse. `diagnosis-before.json` / `.log.gz` ham sonucu içerir.
Profil açıkken ölçülen ilk 7,55 sn ve 7,57 sn event-loop max, aşağıdaki profilsiz
resmî kohorta **katılmaz**. Profil, parse zinciri ve GC örneklemesi içindir;
profilleme yüzdeleri ürün performans kabulü değildir.

İlk artifact dizini hatası `preflight-failed.txt` içinde saklıdır. İlk kohort
preflight'ında `ps -C node` boş seçim nedeniyle exit=1 döndü; hiçbir ölçüm
başlamadı. `cohort-preflight-failed.log.gz` saklıdır. Süreç gözlemi tüm süreç
listesinde node/MainThread seçimiyle düzeltildi. Ham loglar whitespace dahil baytları korunarak deterministik gzip ile saklanır; artifacts/manifest.json açılmış ve sıkıştırılmış SHA/byte değerlerini içerir. İlk RED ve tamamlanmış helper
API'siyle alınan RED loglarının ikisi de saklıdır; beklenen parse-count
regresyonları GREEN raporuyla birlikte okunmalıdır.

Tarihsel tekrar üretme komutu yalnız ilk teslim SHA'sı
`3c11c6e0cbbc260f1cc436b58f6708bcc8b4bc37` checkout'unda geçerlidir.
Collector'ın sabit eski baz kontrolü yeni Main için değiştirilmedi; güncel
merge üzerinde yeni kampanya başlatılmayacak. Eski kanıtların manifesti de
yalnız o SHA'nın dosyalarıyla doğrulanır; güncel README'ye göre yenilenmez.

Eski checkout'ta, başka test/benchmark çalışmıyorken:

```sh
node docs/performance-program/int-01/measure.cjs /tmp/int01-new-cohort
```

Collector altı taze Node sürecini **AB / BA / AB** sırasıyla tek tek çalıştırır;
aynı ortamda ikinci collector için exclusive lock kullanır. Kaynak SHA'larını
her koşu öncesi/sonrası doğrular; her denemenin zamanını, logunu, JSON'unu ve
başarısızlığını saklar; sonuç dosyasını yeniden yazmaz. Eşdeğerlik/count kontrolü
başarısızsa durur. Fail/eksik örnek yerine örnek seçilmez. POST retry yoktur.

Linux / Node 24.19; cgroup CPU ve bellek kotası `cohort/plan.json` içindedir.
Force GC ve soğuk OS cache iddiası yoktur. Peak RSS, fixture ve setup dahil
ölçüm bitişine kadarki OS process high-water'dır; yalnız parse allocation'ı veya
retained heap değildir. Çıktı hash'leri daha sonra hesaplanır. Event-loop max,
10 ms monitor ve iki yanda 30 ms idle ile tek senkron refresh zincirini kapsar;
az örnekli p95 bir HTTP/UX kabul metriği değildir. LFL ve IAS audit süreleri
refresh duvar süresine dahildir. Native parse süreleri alt bileşendir, toplam
duvar süresine ayrıca eklenmez. Target copy/key süresi, gözlemci süresinden
native parse çıkarılarak ölçülür; yalnız allocation süresi diye sunulmaz.

Resmî 3+3 sonuç ve medyan: [cohort/summary.json](artifacts/cohort/summary.json).
Her koşuda tüm hedeflerin tam JSON SHA'ları, IAS hidden metadata SHA'sı, LFL ve
uyarı SHA'ları karşılaştırılır. Hash eşitliği tek başına tip/alias kanıtı değildir;
bunlar canlı unit testlerde ayrıca doğrulanır.

| Medyan / median | Önce / before | Tanı prototipi / after |
| --- | ---: | ---: |
| ASAS / IAS parse sayısı / calls | 4 / 3 | 1 / 1 |
| Native parse toplam / total | 4.144,6 ms | 1.166,1 ms |
| Target copy + key (native parse hariç / excluded) | 0,1 ms | 4.669,9 ms |
| Refresh zinciri duvar süresi / chain wall | 7.121,6 ms | 8.928,2 ms |
| Process CPU | 9.893,3 ms | 10.763,4 ms |
| Event-loop max | 7.134,5 ms | 8.942,3 ms |
| OS process peak RSS | 1.009,25 MiB | 830,13 MiB |

**Karar [Doğrulandı]:** tekrar parse maliyeti var; tam kopya prototipi bir
üretim hızlanması değildir. Parse toplamı %71,9 azalırken duvar süresi **%25,4
artar**, event-loop max da artar. Peak RSS medyanı %17,7 düşer. Before duvar
aralığı 7.099,6–8.838,5 ms; after 8.676,4–13.282,8 ms'dir. Son yavaş after
örneği atılmadı. Üç örnek belirsizliği bütünüyle gidermez; üretim/Windows/SMB
kazancı veya 200 ms kabulü iddia edilmez. Daha ince immutable base/overlay ve
owner/worker seçenekleri ana sohbetin 6c/Faz 7 sözleşmesini beklemelidir.

EN: Duplicate parsing is measurable, but the full-copy prototype is **25.4%
slower** by median wall time. Native parse time falls 71.9%, peak RSS falls
17.7%, and event-loop blocking worsens. All six samples, including the slowest
after sample, are retained. This is evidence against shipping this prototype,
not production performance acceptance.

EN: Six fresh processes run sequentially in AB/BA/AB order, with three samples
per arm and medians. All attempts and failures are retained. A source or parity
mismatch stops the collector. No concurrent measurements, forced GC or HTTP
retries. RSS is the OS process high-water including setup; event-loop max covers
the synchronous mocked refresh, not production HTTP/UX responsiveness.

## Doğrulama ve kapılar

`tests/int-01-parse-preparation.test.js` ortak/ayrı scope, gerçek farklı match
rule, run kimliği, parser sürümü, yeni refresh, hedefler arası Date/nested/hidden
metadata mutation, alias/descriptor ve null-LFL eşdeğerliğini sınar.
`INT01_STRATEGY=before` aynı assertion'ları mevcut tekrar parse davranışına
uygulayan RED tanısıdır; varsayılan test her zaman aday stratejiyi çalıştırır.
Mevcut test/assertion/validator veya i18n baseline değiştirilmez.

İlk teslim SHA'sındaki yerel ilgili paket: **16 dosya / 137 test PASS; fail/skip/cancel=0**
(`artifacts/targeted-tests-final.log.gz`). Yeni hazırlık testleri **10/10**.
i18n **0 yeni / 0 baseline** (`i18n.log.gz`); mevcut release-note paketi **32 OK**
(`release-notes.log.gz`). Test kapsamı parser tarih/Excel timezone, canonical
alanlar, scope/query, IAS seçim/eşleşme/metadata ve null-LFL kalıcılığını içerir.
Tam `npm test` bu hazırlıkta çalıştırılmadı. PR fast checks gerçek head üzerinde
ayrıca değerlendirilir; yerel sonuç uzak CI başarısı sayılmaz. Main dal koruması
bu hazırlıkta doğrulanmadı; etkinmiş gibi varsayılmaz.

EN: Historical first-delivery validation passed 137 tests in 16 files, including all 10 new
preparation tests, with zero failures/skips/cancellations. i18n remains 0/0;
the existing 32 pending release notes validate. Full regression was not run.
Remote fast checks are evaluated separately; branch protection is unverified.

**Faz 6 / son program PR'ı:** sabitlenmiş #885 sonrası Main + uygulama SHA'sında
`resources/app` içinden **filtresiz `npm test` zorunludur**. Bu hazırlıktaki
hedefli testler veya fast checks tam regresyonun yerine geçmez. Zorunlu
fail/skip/cancel geçer sayılamaz; sonucu etkileyen kod değişirse kontroller
yenilenir. Bu kapı burada pending'dir.

Görünür ürün davranışı/UI/metni değişmediğinden yeni release-note/PNG yoktur.
TR/EN, Motion+ ve reduced-motion kaynakları değişmedi. Sonraki görünür
uygulamada kendi TR/EN release-note kaydı ve incelenmiş gerçek post-change PNG
zorunluluğu sürer; #892 istisnası bunu değiştirmez.

EN: Targeted tests and fast checks do not replace the unfiltered full regression
required on the fixed post-#885 Main plus implementation SHA at phase 6/final
program closure. Mandatory failures/skips/cancellations cannot pass. Checks must
be renewed after relevant code changes. There is no visible product change;
the later implementation still requires its own bilingual note and reviewed
real post-change screenshot.

## Ana sohbet / bağımsız inceleme durumu

Ana sohbetten istenecek: Faz 7 sırası ve 6c sahibi netleşince DB parse'ın mevcut
ortak worker/owner yoluna entegrasyon sınırı, sürüm anahtarı ve hedef overlay
sözleşmesi. Yeni worker veya DB migrasyonu önerilmedi/kurulmadı. Owner handle,
generation, yetki, commit/snapshot ve raw-source yaşam döngüsü bu PR'ın dışında.

**Güncel talimat: bağımsız inceleme başlatma.** PR'ın incelemeye hazır olması
üretim adayının onayı veya bağımsız model turunun başlatılması değildir.
Aşağıdaki tek turluk kapsam ancak ayrıca istendiğinde kullanılacak:

1. PR'ın sabit head SHA'sını ve alınan Main `63159fb32ff3d5bdc5f142b4a8f16ca6a3983240`
   farkını verin; inceleme bitene kadar bu SHA'lara rebase/force-push yapmayın.
2. Yalnız bu yeni INT-01 script/test/kanıt dosyalarını ve INT-01/6c sözleşmesini
   inceleyin. Claude'un veya açık diğer PR'ların dosyalarını düzenlemeyin.
3. Run/rule/version anahtarı, refresh ömrü, Date/metadata/alias izolasyonu,
   null-LFL, full-copy maliyetinin dürüst raporlanması, kohort kaynak/fixture
   eşitliği ve başarısız örneklerin saklanmasını değerlendirin.
4. Bloke eden bulguları dosya/satır ve tekrar üretimle bildirin. Bu paket için
   üretim optimizasyonu veya worker entegrasyonu onayı varsaymayın.

İnceleme bu sohbetten gönderilmedi/gerçekleştirilmedi. Kullanıcıya somut PR ve
kanıt paketi teslim edilir; inceleme sonucu yokken yapılmış denmez.

EN: Independent review is not started per the current instruction. The single
P1 review scope is retained for a later explicit request, against the merged Main
and the PR's pinned head. Ready-for-review status is not approval of the rejected
production candidate or initiation of an independent model review. Production
worker/owner integration still awaits the phase-order and ownership gates.
