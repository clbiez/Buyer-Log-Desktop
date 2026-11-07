# Faz 6 istemci hazırlığı — ana sohbet teslimi

**Durum: BLOCKED / RED.** Üretim uygulaması başlamadı. Kaynak Main
`5a1656e98deeb573f6245f4b24a8135cc77a0d7b`; #892 bu SHA ile merge edildi.
#885 gözlenen head `69950f289a012f0bb7c61290bec9890f340f6c64` ile hâlâ açık.
İki merge şartı birlikte sağlanmadığı için `app-main.js` değiştirilmedi.
Dal: `prep/phase-6-client-contracts`. Bu bir faz kapanışı veya ayrı entegrasyon
PR'ı değildir; ana sohbetin faz başına tek entegrasyon PR'ı korunur.

EN: Preparation only. PR #892 is merged, #885 remains open. The new source-based
regression has three passing controls and two failing Orders hydration cases.
No production implementation, merge, publication, or performance claim.

## Durduran bulgu

`app-main.js` içindeki `loadFromServer` Orders dalları şu çağrıları yapıyor:

```js
invalidateUnifiedPriorityDecisions('server-orders-hydrated');
invalidateUnifiedPriorityDecisions('server-orders-deferred');
```

`tables` verilmediğinde gerçek invalidator hem CP hem Orders sayılır;
`_cpDecisionInputRevision` ve CP tablo revizyonu artar, CP cache temizlenir ve
Global Flow olayı iki tabloyu içerir. Yalnız Orders işlemi için istenen sayaç
ayrımı bu iki dalda korunmuyor. Aynı Main'deki `ensureOrdersLoaded` ise
`['orders']` kapsamını zaten veriyor.

[Yeni regresyon](revision-contract.test.cjs), üretim dosyasındaki gerçek
invalidator, kişisel bağlam listener'ı, on-demand Orders loader'ı ve ortak
yükleyicinin Orders dallarını VM'de çalıştırır; kaynak metnini dönüştürmez.
[Fixture](revision-fixtures.cjs) sentetiktir. Ağ, çalışan sunucu, kullanıcı
verisi veya credential kullanılmaz. Ortak yükleyicinin iki dalı izole edilir;
bütün `loadFromServer` akışının veya tarayıcı performansının çalıştırıldığı
iddia edilmez.

- Kişisel bağlam listener'ı: CP girdi sayacı sabit; CP tablo revizyonu, cache
  temizliği, Global Flow bildirimi ve render devam eder — **PASS**.
- Gerçek on-demand Orders loader'ı: CP sayacı/cache/seçim/dirty state korunur;
  Orders yetkisi view-only kalır — **PASS**.
- İptal edilen Orders isteği veri veya revizyon yayımlamaz — **PASS**.
- Ortak yükleyici Orders hydrated dalı: CP nesnesi aynı, sayaç beklenen `1`,
  gerçek `2` — **RED**.
- Ortak yükleyici Orders deferred dalı: CP nesnesi aynı, sayaç beklenen `1`,
  gerçek `2` — **RED**.

Bu açık RED hazırlık testi normal app test koleksiyonuna henüz eklenmedi;
mevcut hiçbir test, runner veya validator değiştirilmedi. Entegratör düzeltme
yaparken testi kalıcı regresyon paketine dahil etmeli. RED gizlenmez veya
beklenen hata sayılarak yeşile çevrilmez.

**Ana sohbet için en küçük düzeltme adayı:** yalnız bu iki çağrının Orders
kapsamını açık vermesi. Bu bir öneridir, uygulanmış düzeltme değildir.
Getter `_cpDecisionInputRevision` olarak kalmalı. Kişisel bağlam listener'ının
invalidation çağrısı, CP tablo revizyonu/cache temizliği ve Global Flow olayı
korunmalı. Son kodda gerçek CP yükleme/değişiklikleri ve Orders-only yolları
birlikte yeniden doğrulanmalı. RED nedeniyle başka üretim veya test geliştirmesi
yapılmadan duruldu.

## #891 kaynak farkı — ikinci alan envanteri yok

Tek alan envanteri [#891 / 5736f337](https://github.com/clbiez/Buyer-Log-Desktop/pull/891)
içindeki `docs/performance-program/phase-6a/field-inventory.json` dosyasıdır.
Envanter veya tarayıcı yeniden üretilmedi, kopyalanmadı, sınıflar değiştirilmedi.
42 alanın 32 gerekli / 10 belirsiz / 0 güvenle ayrılmış tembel aday sonucu
geçerlilik incelemesi bekler; belirsiz alan kaldırılabilir sayılmaz.

[Kaynak farkı kaydı](evidence/source-drift.json), özgün envanterin 72 dosya
SHA'sını güncel kaynakla karşılaştırır. Yalnız değişen yedi dosyayı içerir;
yeni alan/okuyucu sınıflandırması veya yeni envanter değildir.

| Değişen kaynak | Main değişikliği / yeniden doğrulama ihtiyacı |
| --- | --- |
| `public/app-main.js` | #892 sayaç ayrımı; envanter bazına göre 5 ek / 1 silinen satır. Yukarıdaki çağrı kapsamı açığı burada. |
| `public/checklist-components-engine.js` | #886 checklist hazırlama/özet sınırları. |
| `public/checklist-supplier-sync.js` | #886/#889/#892 checklist sütun hazırlama ve delta bağımlılıkları. |
| `public/cp-checklist-engine.js` | #886/#892 özet/katkı cache eşdeğerliği. |
| `public/cp-overview-assistant.js` | #892 kişisel katman deltası; satır referansı, epoch ve girdi revizyonu. |
| `public/lcwai-output-editor.js` | #887 Office çıktı biçimi; tam veri isteyen export sınırı. |
| `public/test-report-import.js` | #888 toplu checklist bildirim zinciri. |

Browser/server canonical dosyaları bu kıyasta değişmedi. #885 sonrası Main
henüz yoktur; compute, kaynak sahipliği, IPC ve yeni tüketiciler için sonraki
doğrulama yapılmış sayılmaz. #891 C01–C15 ve S01–S24 kapsamı korunur.

## Ana sohbetten sabitlenmesi gereken sunucu sözleşmeleri

Bunlar istemcinin uygulama önkoşullarıdır; onaylanmış yeni wire şeması veya
endpoint tanımı değildir. Üretim uygulaması öncesinde ana sohbetin sunucu
sözleşmesine bağlanmaları gerekir.

1. **6a:** capability/sürüm anlaşması, canonical alan seçimi, dinamik
   formül/not/model alanları, satır kimliği, owner/kullanıcı/yetki kapsamı,
   source generation ve revision bağları. Eski sunucunun tam veri yolu açık
   tanımlanmalı; yetki/stale/hata yanıtı uyumsuzluk sanılarak fallback yapılmamalı.
2. **6a detay:** full/hydrated tamlık sınırı, aynı scope/revision üzerinden
   birleştirme, in-flight paylaşımı, iptal ve stale yanıtın yayımlanmaması.
   Seçim, clipboard, export, hesap ve diğer tam veri tüketicileri eksik alanı
   boş/0 kabul etmemeli. Bellekteki `__canonical` ve non-enumerable kaynak
   ilişkileri JSON round-trip ile eşdeğer varsayılmamalı.
3. **6c:** canonical hücre/satır patch anahtarları, açık base revision,
   missing/delete/null/boş/0/false ayrımı, authoritative edit kontrolü,
   acknowledgement ve dayanıklı pending journal. Eski tam snapshot istemcisi
   aynı yetki/CAS/merge sınırından geçmeli.
4. **6c undo:** inverse patch'in kapsamı ve byte sınırı, remote değişiklik
   sonrası üç yönlü rebase/conflict, model/variant mirası, toplu işlemin atomikliği,
   kapanış/offline/restart ve başarısız acknowledgement toparlanması.
   Sunucu sahibi kesinleşmeden istemci yeni delta biçimi icat etmemeli.

Sıra **6a → 6c → 6b → Faz 7**. 6a/6c uygulama commit'leri ana sohbetin tek
faz entegrasyon PR'ına SHA ile teslim edilecek. 6b yaşam döngüsü/sekme/SSE
entegrasyonunda Claude'un index/perf/CSS/motor dosyaları salt okunur kalır.
Faz 7'de CPR-04/08 ve ANA-02/03/04/08/09/10 ayrı küçük PR'lardır; önce güncel
Faz 0 veya Chrome/Node trace maliyeti gerekir. Worker gereksinimi ana sohbetin
mevcut havuz entegrasyonuna iletilir.

## Doğrulama ve kanıt sınırı

Komutlar depo kökünden; mevcut testler ve validator'lar `resources/app` içinden:

```sh
node --test --test-reporter=tap docs/performance-program/phase-6-client/revision-contract.test.cjs
```

Sonuç **exit 1, 3 PASS / 2 FAIL / 0 skip / 0 cancel**;
[tam RED kaydı](evidence/revision-contract.red.tap).
Metin görünümünde yalnız satır sonu boşlukları temizlendi; özgün stdout/stderr
baytları [raw gzip kaydında](evidence/revision-contract.red.tap.gz) korundu.

Mevcut CP, checklist delta/özet, canonical, field ownership, Orders filtre,
clipboard/export ve Global Flow paketinden 12 dosya seçildi. İlk komut
**71 PASS / 1 dosya başlayamadı**: Global Flow partial testi varsayılan
`/home/agent/.buyer-log/write-recovery` kökünde ENOENT verdi. İzole kök
başlangıçta bu komuta verilmemişti; [ilk başarısız kayıt](evidence/existing-regressions.tap)
korundu. Aynı başarısız dosya, `mktemp -d /tmp/buyerlog-phase6-client-XXXXXX`
altında aşağıdaki beş ayarla tek başına tekrar çalıştırıldı; assertion/test
değişikliği yok:

```text
BUYER_LOG_SERVER_DATA_ROOT=<demo>/server
BUYER_LOG_DATA_ROOT=<demo>/app
BUYER_LOG_LOCAL_DATA_ROOT=<demo>/local
BUYER_LOG_TEMP_ROOT=<demo>/temp
BUYER_LOG_CONFIG_PATH=<demo>/config.json
```

[İzole tekrar](evidence/global-flow-isolated.tap): **19 PASS, 0 fail/skip/cancel**.
Böylece seçilmiş mevcut 12 dosyanın testleri iki koşuda toplam **90 PASS**;
ilk komutun başarısızlığı ve yeni regresyonun iki RED'i açık kalır.

- `npm run i18n:check`: [0 yeni eksik / 0 baseline](evidence/i18n.txt).
- `npm run release:notes:validate`: [32 kayıt PASS](evidence/release-notes.txt).
- Görünür davranış değişmedi; yeni release-note veya PNG üretilmedi.
- Tam `npm test` çalıştırılmadı; RED ve #885/sözleşme kapısı açıkken faz
  kapanışına geçilmedi. Faz 6 / son program PR'ında sabitlenmiş entegre son
  kodda filtresiz tam test zorunludur; kod değişirse kontroller yenilenir.
- S01–S24 full/full veya full/shadow, payload/parse/heap ve 3+3 medyan ölçümleri
  **çalıştırılmadı**. Hazırlık dosyaları performans kazanımı değildir. İleride
  kıyasın iki kolu aynı #892 kodunu, aynı fixture ve satır/generation/revision
  kontrollerini içermeli; başarısız örnekler saklanmalı, refresh POST retry yok.
- P1 bağımsız Claude incelemesi yapılmadı; üretim diff'i sonrası kullanıcı
  üzerinden en fazla bir tur hazırlanacak. Merge, TEST ve STABLE yapılmadı.

Ana sohbetin durdurma kararını verebilmesi için bu dosya, kaynak farkı ve RED
testi birlikte teslim edilir. Bu ortamda doğrudan sohbetler arası mesaj aracı
bulunmadığı için otomatik gönderim yapıldığı iddia edilmez.
