# Main uyumluluğu — yalnız hazırlık

**ANA-12 açık. Faz 7 üretim entegrasyonu yapılmadı.** Kaynak Main: `63159fb32ff3d5bdc5f142b4a8f16ca6a3983240` (#902 üzerinden #885 ve ek düzeltmeler). Eski hazırlık head'i `e165be5d22bcc14fa08d696510a06f5401ac8dc2`; normal merge commit'i `4ae0730103d438c049dfe1419a41eed9489ba1ad`, ebeveynleri bu hazırlık head'i ve Main'dir. Rebase/force-push yok. Main'e göre PR değişiklikleri yalnız `docs/performance-program/ana-12` altındadır; server/app-main/compute/Claude dosyalarında özel değişiklik yok.

## Kaynak karşılaştırması ve harness uyarlaması

[Makinece doğrulanan kaynak karşılaştırması](artifacts/main-63159fb3/source-comparison.json) ve [tam hedefli public diff](artifacts/main-63159fb3/public-source.diff.gz):

| İncelenen yol | Sonuç |
|---|---|
| `backlog-plan-actual.js` | Eski üretim pini `5a1656e9` ile tüm dosya aynı. |
| `backlog-chart.js` | Tüm dosya aynı; generation kontrolü ve cache yayın sırası aynı. |
| `backlog-delivery-analysis.js` | Tüm dosya aynı; `BLBacklogRows.load` tüketimi sürüyor. |
| `backlog-overview.js` | Tek değişiklik `loadRows`: artık async ve `whenRowsReady()` bekliyor. İncelenen wrapper eski wrapper ile değiştirilerek bütün dosyanın eski kaynakla byte eşitliği doğrulandı. |
| Ortak row cache/transport, overview refresh/close | Readiness wrapper dışındaki ölçülen blok SHA'ları aynı. Refcount veya fetch abort eklenmedi. |
| `compute-pool`, `compute-read-service`, `compute-response` | Önce incelenen `69950f28` ile tüm dosyalar byte eşit. Artık güncel Main'de mevcutlar. |

Yeni pine geçiş öncesi bu fark incelendi; hash/ankorlar körlemesine değiştirilmedi. Güncel app-main readiness sağlayıcısı ve server/guard çapaları da kayıttadır. Harness'in eski window/root ayrımı readiness yolunu bağlamıyordu. Yalnız tanı harness'i, overview/delivery ve chart için aynı kontrollü readiness sağlayıcısını kullanacak şekilde uyarlandı. Chart `prepareQuery` stub'ı bu kapıyı bekler. Gerçek app-main pivot, source-column hazırlığı, DOM veya backend burada çalıştırılmaz; bu sınır kabul iddiasına dönüştürülmez.

İki yeni test önce RED oldu: pivot kapısı açılmadan transport başlamaması; readiness reddedilince fetch yapılmaması. Uyarlamadan sonra **9/9 GREEN**. Üç tüketicinin kapıdan geçmesi, kapı açılınca tek istek paylaşması ve son işaretin doğruluğu sınandı. Önceki **yedi testin/assertion'ın tamamı verbatim korunur**; kaynak denetçisi bunu eski head ile doğrular. Mevcut test veya validator gevşetilmedi.

## Yenilenen seri A/A

Ölçülen async yol değiştiğinden eski sayılar güncel Main sonucu sayılmadı. Dört senaryo için **3+3 A/A, toplam 24 koşu** yeniden çalıştırıldı; AB/BA/AB blok sırası, aynı değişmemiş 30k probe fixture SHA'sı `7e6f563f…9fe3a3`, aynı Linux/Node 24.19, 4 CPU kotası/16 GiB. Testler ve diğer ölçümlerle çakışma yok. İki kol da aynı #892 ve #885 kodunu içeren `63159fb3` üretim ağacıdır; A/B kod farkı yok.

| Üç koşunun medyanı | A tüm/eski parse (ms) | B tüm/eski parse (ms) | A/B process CPU (ms) |
|---|---:|---:|---:|
| Plan | 103,50 / 95,92 | 99,19 / 91,53 | 255,47 / 286,57 |
| Overview + chart ortak | 86,94 / 79,58 | 103,66 / 94,55 | 301,31 / 298,62 |
| Chart fallback | 111,45 / 101,00 | 85,16 / 77,57 | 268,80 / 262,14 |
| İki panel kapanışı | 92,38 / 83,67 | 99,94 / 90,62 | 289,30 / 324,21 |

Her koşu **10 gönderilen/tepe aktif istek**, **0 sinyal/abort**, 30.331.020 byte parse; son sorgu başladıktan sonra eski dokuz yanıt **27.297.918 byte** parse eder. İki panel ortak sorguda tek transport paylaşır. Kapanış senaryosunda 10 tamamlanma da kapanıştan sonra; açık panel senaryolarında son `demo-9` işareti doğru. Probe işareti tam iş projeksiyonu eşdeğerliği değildir.

Bu değerler **VM + geciktirilmiş loopback HTTP tanısıdır**. Process CPU sentetik sunucuyu da içerir; hazırlık kapısı ölçümde resolved Promise stub'ıdır. Gerçek tarayıcı/backend kabulü, OS bant genişliği testi, optimizasyon kazancı veya retained heap iddiası yok. Backend gönderilen/başlayan/tamamlanan/iptal job sayıları ve iptal sonrası CPU **null/bilinmiyor**. Hiç iptal gerçekleşmedi; son sorgu sonrasındaki CPU, iptal sonrası CPU diye sunulmaz.

[Ham 24 kayıt ve CPU profilleri](artifacts/main-63159fb3/cohort/), [ortam ve harness SHA](artifacts/main-63159fb3/cohort/environment.json), [medyanlar](artifacts/main-63159fb3/cohort/summary.json), [kaynak/kanıt doğrulaması](artifacts/main-63159fb3/evidence-check.txt).

İlk inline source-check, blok sınırında `async` kelimesini cache koduna dahil ettiği için RED oldu. Ayrıca büyük app-main kaynağı Node subprocess varsayılan çıktı tamponunu aştı. Her iki başarısızlık korundu; sınır tüm declaration prefix'ini dışlayacak şekilde düzeltildi ve yalnız tanı aracının çıktı tamponu genişletildi. İlk shell fail-fast olmadığı için bağımsız kampanyanın sürmesi de [başarısızlık notunda](artifacts/main-63159fb3/source-check-initial-failure.txt) açıkça kayıtlıdır. Son denetim gerçek kaynak farkını, tüm assertion'ları, ham koşu/byte toplamlarını, 24 CPU izini ve medyanları doğrular. Üretim timeout veya havuz bütçesi değiştirilmedi.

## Eski kanıt ve kontroller

Eski `cohort`, `final-cohort`, trace-summary, test logları, source-evidence ve manifest üzerine yazılmadı. [Eski manifest](artifacts/manifest.json), **`e165be5d` snapshot'ının** 119 dosya hash'idir; değişen canlı README/harness'in hash manifesti değildir. Denetçi bu 119 hash'i `git show e165be5d:<path>` ile doğrular ve eski artifact dosyalarının diskte de aynen kaldığını ayrıca denetler. Güncel seri ayrı `artifacts/main-63159fb3` dizinindedir; kendi [manifesti](artifacts/main-63159fb3/manifest.json) kullanılır.

- Harness: **9 PASS**, fail/skip/cancel 0; readiness RED logu saklı.
- Backlog/canonical ve read-service/read-guard/response/pool regresyonları: **64 dosya, 443 PASS**, fail/skip/cancel 0. Yeni Main'in gerçek pivot nesli/paylaşımını sınayan mevcut `backlog-chart-shared-preparation` testleri dahil.
- Agent/Motion+/reduced-motion: **27 PASS**, fail/skip/cancel 0.
- i18n yeni **0**, baseline **0**; mevcut release notes **38 PASS**. Görünür ürün değişikliği yok.
- [Güncel açık PR dosya kilitleri](artifacts/main-63159fb3/open-pr-locks.json) kontrol edildi; ANA-12 diziniyle başka PR çakışması yok.
- Tam `npm test` çalıştırılmadı. Faz 6/son program PR kapanışındaki filtresiz tam regresyon şartı aynen korunur. Gerçek üretim entegrasyonu için RED→GREEN, tam yanıt/iş eşdeğerliği, yetki/veri kaybı kapıları, gerekli bağımsız inceleme ve görünür değişiklikte TR/EN release-note + incelenmiş gerçek PNG şartları sürer.

Tekrar doğrulama, repo kökünden:

```sh
node --test docs/performance-program/ana-12/diagnose.test.cjs
node docs/performance-program/ana-12/compatibility-check.cjs
node docs/performance-program/ana-12/diagnose.cjs /tmp/ana12-another-empty-output
```

## Kalan bağımlılıklar

Ana sunucu sahibinin HTTP son subscriber → queued abort ve running gerçek durma/supersession bağlantısı uygulanmadı. Normal tamamlanmanın abort sayılmaması, cache ownership ile subscriber ref'lerinin ayrılması, scope/generation/includeSourceDetails korunması, diğer tüketici/ortak source hazırlığının sürmesi, geç cache yayınının engellenmesi ve request/job/CPU kanıtı [güncel devir notunda](handoff.md) ayrıntılıdır. Plan/gerçekleşen archive/analysis route'u ayrıca kapsanmalıdır. Client üretim adapter'ı ve gerçek tarayıcı kapanış/reopen testleri de Faz 7'yi bekler.

PR'ın incelemeye hazır olması yalnız **hazırlık uyumluluğu** içindir. ANA-12 kapanmaz; merge ve TEST/STABLE yapılmaz. Kullanıcı üzerinden en fazla bir Claude incelemesi için paket hazırdır, inceleme gönderilmedi/yapılmadı.

EN: Preparation compatibility only. Main 63159fb3 was merged normally. The only relevant client source change adds the row-readiness await; the harness now exercises that controlled gate, retaining all seven original tests and adding two RED→GREEN assertions. A new non-overlapping 24-run A/A campaign is stored separately, with unchanged historical evidence verified at its own commit. VM/loopback results are not browser/backend acceptance or an optimization gain. Actual cancellation, full production equivalence, full regression and required review remain pending; ANA-12 stays open. No merge/TEST/STABLE.
