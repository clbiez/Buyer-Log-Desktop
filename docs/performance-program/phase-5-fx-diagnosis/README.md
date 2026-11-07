# Faz 5 B1 — FX timeout tanısı

**[Doğrulandı] Kontrollü 30k yükünde timeout kuyrukta doluyor.** Adayın altı
dolu-havuz koşulunda FX için `dispatch`/worker giriş olayı yok; gerçek havuz
metrikleri `durationMs:0`, `postMessageMs:0`. Soğuk/ısınmış boş havuzda timeout
yok. Worker açılışı veya KUR parser yürütmesi bu altı hatanın nedeni değil.
Üretim düzeltmesi uygulanmadı. B1'in genel kabulü kapanmış sayılmaz.

Sabit aday: #885 `69950f289a012f0bb7c61290bec9890f340f6c64`.
Baz FX yolu: Main #888 `1d8e8d39257b66443fad8e80739261b4f0a82227`.
`e493546c..69950f28` arasında `resources/app` farkı yok; bu nedenle dondurulmuş
son rapordaki uygulama kaynaklarıyla aynı aday kodu kullanıldı.

6a karşılaştırması: yerel `5736f337` ve #891 uzak head aynı; dosya farkı ve
ek bulgu yok. İkinci envanter veya ikinci envanter PR'ı oluşturulmadı.

## Ölçüm ve ham kanıt

[results.json](results.json): 36 koşunun tüm olayları, ns/UTC zaman damgaları,
gerçek FX store/revision, HTTP yanıtları, worker/pool metrikleri ve kaynak
SHA-256'ları. [summary.json](summary.json): gruplar, sınırlar ve artefact
hash'leri. [validation.log](validation.log): 29 test PASS, fail/skip/cancel 0.

Üç taze süreç tekrarı × baz/aday × KUR yok/geçerli × soğuk/ısınmış/dolu havuz.
Sıra AB/BA/AB. Aynı seed-7, 30.000 ASAS satırı ve Antrepo demo byte'ları her
koşuda SHA ile doğrulandı. Linux, Node 24.19.0, V8 13.6, 4 CPU kotası ve
16 GiB limit; GC/profiler/affinity müdahalesi yok.

| KUR | Havuz | Baz medyan ms | Aday medyan ms | Aday timeout |
| --- | --- | ---: | ---: | --- |
| yok | soğuk boş | 131,792 | 155,788 | 0/3 |
| yok | health ile ısınmış, boş | 129,091 | 99,471 | 0/3 |
| yok | iki 30k projeksiyon aktif | 152,638 | 5001,415 | 3/3, kuyruk |
| geçerli | soğuk boş | 142,979 | 172,075 | 0/3 |
| geçerli | health ile ısınmış, boş | 139,215 | 104,310 | 0/3 |
| geçerli | iki 30k projeksiyon aktif | 160,746 | 5001,128 | 3/3, kuyruk |

Bu süreler FX çağrısının native işe kabulden sonuca kadar olan tanı süreleridir;
makro açılış veya genel performans kazancı değildir. Bazın 18 koşusunda
timeout 0; adayın 18 koşusunda 6. Dolu havuzdaki 24 gerçek projeksiyon işi
tamamlandı; worker yürütmeleri 8,318–8,835 saniye aralığında.

Bir gerçek iz (tekrar 1, KUR yok, aday; `hrtime` nanosecond):

| Olay | ns |
| --- | ---: |
| FX kabulü | 1837960375326 |
| Gerçek 5000 ms timer kaydı | 1837960419792 |
| Timer callback | 1842961732906 |
| Promise reddi | 1842961981503 |
| FX dispatch / worker giriş / sonuç post | yok / yok / yok |

Timer 5001,313 ms sonra çalıştı. Havuz kendi hesabıyla kuyrukta 5001,522 ms,
yürütmede 0 ms bildirdi. Timer anında iki worker aktif, bir FX işi pending.
Altı timeout'un tamamında bu durum doğrulandı; FX `findKurWorkbook` veya
`readFxWorkbook` çağrısına ulaşmadı. Boş-soğuk aday worker'larının gerçek
constructor → listener-ready süresi yaklaşık 58–64 ms; soğuk açılış izi
ayrıca kaydedildi. `online` olayının ana thread'e geliş saati ile worker'ın
kendi preload/listener/receive zamanları birbirine karıştırılmadı.

## Neden ve eşdeğerlik

Kaynakta `server/server.js:6965` otomatik FX'i **background**, `shared-fx`
serialization key ve **5000 ms** ile ortak servise verir.
`compute-service.js:111` aynı havuzda `excel-utility` kabul eder.
`compute-pool.js:173–184` timer'ı kuyruğa eklemeden önce kurar; kuyruk ve
yürütme tek son tarihi paylaşır. İki non-preemptive worker 5 saniyeden uzun
işlerle doluyken kabul edilen FX işinin bu bütçede başlayamaması beklenen
sonuçtur. Bu kontrollü yükte başka pending rakip iş veya `shared-fx` kilidi
yok: iki worker kapasitesi dolu olduğu için başlanamıyor. Önceliği değiştirmek
çalışmakta olan bu işleri kesmez.

Bazın gerçek `excel-worker-client` yolu FX'i ayrı mevcut Excel worker yolunda
çalıştırır; timer worker başlatılırken kurulur. Kontrol kolunda aynı aday
ortak havuz yükü tutuldu, fakat FX bazın değişmemiş sync/client/native worker,
store ve route kodunu kullandı. Bu, tam F0 baz oturumunun yeniden ölçümü değildir.

| Durum | FX veri/revision eşitliği | Durum/yanıt eşitliği |
| --- | --- | --- |
| Tüm boş-havuz koşulları | eşit | eşit |
| KUR yok, dolu | eşit; revision 1, save yok | eşit değil: baz `KUR Excel bulunamadı`, aday `parse-failed`; aday folderSync hata durumu |
| Geçerli KUR, dolu | eşit değil: baz Ekim'i uygular/revision 2; aday eski Eylül/revision 1 | eşit değil: aday false `found:false`, `parse-failed`; resolve Eylül'e fallback yapar |

Timeout catch'i `saveFx` veya publish çağırmıyor: **yanlış kur yazımı/revision
artışı gözlenmedi**. Geçerli dosyada güncelleme gerçekleşmiyor; bu, eşdeğerlik
başarısı değildir. `/api/fx` ve resolve her iki kolda HTTP 200 dönebildiği için
yalnız HTTP kodu kıyası hatayı kaçırır. Ham JSON'lar korunur; anlamsal kıyasta
yalnız doğal audit alanları `updatedAt`/`_updatedAt` normalize edildi.
Kur değerleri, aylar, provenance, kaynak mtime, fingerprint, revision,
folderSync ve resolve `exact` bayrağı normalize edilmedi.

## En küçük düzeltme önerisi — uygulanmadı

1. **Tarihsel dosyasız hata için dar düzeltme:** otomatik FX'te dosya yokluğunu
   havuza iş koymadan, küçük async dizin/stat okumasıyla belirle. Mevcut KUR
   ad/uzantı, dizin önceliği ve mtime seçim sözleşmesini koru. Dosya yoksa aynı
   `found:false, updated:false, reason:"KUR Excel bulunamadı"`, null folderSync
   ve değişmemiş store/revision sonucunu ver. Yeni worker veya daha uzun
   timeout gerekmez. Yalnız `existsSync('KUR.xlsx')` eşdeğer bir çözüm değildir.
2. **Geçerli KUR sınırı:** yokluk kontrolü dolu-havuz/geçerli-dosya hatasını
   çözmez. En küçük aday, açılıştaki otomatik FX'i mevcut warmup zincirinde
   ilk uzun bulk projeksiyonların *öncesine* bağımlılık olarak sıralamaktır;
   aynı havuz ve aynı 5000 ms korunur. Bu bir öneridir; yeni yük altında
   doğrulanmadan düzeltti denmez. Zaten dolu havuza sonradan gelen çağrıda,
   >5 saniyelik kesilemeyen işler bitmeden aynı 5 saniyelik son tarihle başarı
   garantisi verilemez. Öncelik tek başına yeterli değildir.
3. Kuyruk timeout'unu parser hatası diye sunma; operasyonel durum ile gerçek
   parse hatasını ayır. Bu durum sözleşmesi değişikliği ayrıca test edilmelidir;
   sessiz başarı veya sahte dosya-yok sonucu üretilmemelidir.

Öneriler burada uygulanmadı; timeout artırılmadı, havuz/worker değiştirilmedi.

## Tekrar üretme

Bu PR'ın checkout'u üretim kaynaklarında sabit adayla aynı olmalı. Baz için
ayrı salt okunur checkout kullan:

```sh
git worktree add --detach /tmp/buyerlog-fx-base 1d8e8d39257b66443fad8e80739261b4f0a82227
export NODE_PATH=/path/to/existing/resources/app/node_modules
FX_B1_SOURCE=$(mktemp -d /tmp/buyerlog-fx-b1-source-XXXXXX)
export FX_B1_SOURCE
node - <<'JS'
const fs=require('node:fs'),path=require('node:path'),XLSX=require('xlsx');
const data=require('./resources/app/scripts/generate-demo-data').build({rows:30000,seed:7,today:new Date('2026-11-07T12:00:00.000Z')});
for(const [file,sheet,key] of [['ASAS - Demo.xlsx','ASAS','asas'],['Antrepo - Demo.xlsx','Antrepo Raporu','antrepo'],['LFL - Demo.xlsx','LFL','lfl']]){
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(data[key]),sheet);
  XLSX.writeFile(wb,path.join(process.env.FX_B1_SOURCE,file),{bookType:'xlsx'});
}
JS
node docs/performance-program/phase-5-fx-diagnosis/diagnose-fx-timeout.cjs prepare "$FX_B1_SOURCE"
node docs/performance-program/phase-5-fx-diagnosis/diagnose-fx-timeout.cjs run "$FX_B1_SOURCE" /tmp/buyerlog-fx-base/resources/app /tmp/fx-reproduction.json 3
```

Sabit tarihli üretim komutunun üç XLSX dosyası ölçülen fixture ile byte/SHA
eşdeğer doğrulandı. `prepare`, geçerli KUR.xlsx'i de üretir ve doğrular;
source v8 kopyası, XLSX'ler ve KUR her koşulda hash kontrolünden geçer.
DB/config/auth/temp yalnız yeni `/tmp/buyerlog-fx-b1-run-*` altındadır.
Gerçek veri/credential veya dış ağ yok; HTTP yalnız loopback. Express
permission middleware'i demo allow stub'dır; gerçek yetki testi yapılmış sayılmaz.

Gözlemci mevcut WorkerClass test seam'inde **gerçek native Worker** kullanır;
worker entry dosyaları değişmez. Ayrı preload/message port yalnız timer,
dispatch, preload/listener, receive/result ve dosya arama/parse olaylarını
zamanlar. Fake timer, spin/sleep ile dolu havuz taklidi veya yeni worker motoru
yok. 10 ms gözlem beklemesi ve 20 ms observer drain, FX ölçüm penceresi dışındadır.

Yeni test, ham 36 izden sınıflandırmayı tekrar çıkarır; worker'a hiç gitmeyen
işi yürütme hatası saymayı, geç dispatch'i geçmiş deadline'a yazmayı veya
veri/revision/durum farkını normalizasyonla gizlemeyi reddeder. Testte beklenen
gerilemenin doğrulanması üretim eşdeğerliği geçti demek değildir.

## Sınırlar ve GitHub

Önceki normal F0 serisinin dört hatası için per-job zaman damgası kaydedilmemişti;
o dört olayın her birini geriye dönük kesin faza atamıyoruz. Aynı sabit aday
kodu ve gerçek 30k yükle **yeniden üretilebilen kuyruk nedeni** kanıtlandı.
Bu kontrollü seri yeni sentetik dosyalardır; tarihsel F0 byte'larının aynısı
veya UI/refresh oturumunun yeniden oynatılması olduğu iddia edilmez.

İlk metadata preflight, bazda bulunmayan compute-pool dosyasını hash'lemeye
çalışınca durdu; [başarısız kayıt](preflight-failed.json) korundu. Araçta bu
yokluk null olarak kaydedildi; üretim kontrolü gevşetilmedi. Sandbox'ın
spawnSync/listen kısıtları ölçüm öncesinde çözüldü; sonuç serisi ayrı tutuldu.

Yalnız yeni tanı script'leri, test ve kanıtlar var. 29 ilgili test PASS;
tam regresyon çalıştırılmadı ve onun yerine geçtiği iddia edilmez. Ayrı tanı
dalı/taslak PR; ikinci envanter PR'ı yok. Merge, TEST ve STABLE yok.
