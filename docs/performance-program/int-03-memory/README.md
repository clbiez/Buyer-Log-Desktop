# INT-03 — Faz 7 için tanı ve ölçüm hazırlığı / Phase 7 preparation

**Üretim uygulaması yok. INT-03 açık; merge, TEST ve STABLE kapalı.**
**No production implementation. INT-03 remains open; no merge or publication.**

Bu dal yalnız sentetik fixture, gerçek kanonik yol üzerinde tanı, test ve
ölçüm aracı ekler. Bayt bütçesi/backpressure üretime uygulanmadı. Faz 7 sırası
beklenir. Üç mevcut-kod koşusu bir **before** kohortudur; **after** uygulama ve
kabulü beklemededir. Baz sonuçlarını önce/sonra kazanımı olarak sunmayın.

## Kaynak doğrulaması

Kaynak: `5a1656e98deeb573f6245f4b24a8135cc77a0d7b` (Main, #892 dahil).
`CLAUDE.md` ve `docs/performance/2026-11-05-codex-review-findings.md:560–568`
okundu. İnceleme SHA'ları taşınmadı; rebase/force-push yok.

| Kaynak / source | Doğrulanan sözleşme / verified contract |
| --- | --- |
| `plm-image-download-queue.js:230` | `runBounded` bütün sonuçları `results` içinde tutuyor. Sekiz aktif slot toplam Buffer baytlarına sınır değil. |
| `plm-image-download-queue.js:172–183` | HTTPS gövdesi chunks + `Buffer.concat`; tek görsel için 20 MiB sınır var. Toplam süreç bütçesi yok. |
| `plm-image-sync-service.js:324–361` | Attachment kimliğiyle URL dedup; bütün indirmelerden sonra `ready` ve tek ingest commit. |
| `plm-image-ingest.js:197,227,242` | İçerik hash dedup tablosu commit'e yerel; naif parçalama ayrı URL'deki aynı baytları yeniden dosyalayabilir. |
| `plm-image-ingest.js:251–286` | Link yazma hatasında yeni dosyaları geri al; linklerden sonra ownership; eski ref yalnız başka aktif link yoksa sil. |
| `server/db.js:1017–1050` | Her başarılı `patchPlmImageLinks` orders revision artırır; yeni batch sayısını mevcut revision sözleşmesiyle uzlaştırmadan üretime geçme. |
| `server/server.js:4205–4214,4890–4935` | Kanonik ingest bağlantısı ve tüm sync tamamlandıktan sonraki yayın/yanıt; ilk UI görünürlüğü yalnız küçük yerel commit ile ispatlanmaz. |

Modül açıklamasındaki “aynı anda yalnız concurrency kadar gövde” iddiası gerçek
sonuç saklamasıyla uyuşmuyor; kapsam dondurulduğu için açıklama dahil üretim
dosyaları değiştirilmedi. Paket import'un ayrı `ready` biriktirmesi bu çalışmanın
uygulama kapsamına eklenmedi.

## Fixture ve ölçüm sınırları

- 2.048 benzersiz Attachment, 8/32/128/512 KiB döngüsü; toplam **356.515.840 bayt
  (340 MiB)**. Deterministik 1×1 RGBA PNG, boyutu değiştiren geçerli ancillary
  tEXt chunk; CRC, IDAT inflate, tam boyut ve deterministik hash testleri var.
  Gerçek resimlerin boyut/çözünürlük dağılımı veya decode maliyeti iddiası yok.
- Fixture tanımlayıcıları Buffer tutmaz. Her mock GET'te içerik yeniden üretilir.
  1 ms sentetik gecikme, concurrency=8; gerçek `downloadImage` tip doğrulaması,
  gerçek `runPlmImageSync`, ingest, `saveCollectionImage`, `patchPlmImageLinks`,
  ownership ve diskte PNG/index/revision yazımı çalışır.
- Büyük koşuda checkpoint enjekte edilmedi; shared publish/lease, yetkili
  route ve UI çalışmadı. Süre tam PLM yenilemesinin uçtan uca süresi değildir.
- HTTP/TLS, gerçek HTTPS chunks/concat, socket ve ağ gecikmesi modellenmez.
  Mock ile baseline daha az taşıma belleği kullanabilir. Gerçek PLM/iş verisi,
  credential, refresh POST ve retry yok. Ağ girişleri process içinde hata verir.
  Bütün veri/config/temp/local-db kökleri yeni `os.tmpdir()` altındadır; sonra silinir.
- `firstCanonicalLinkMs`: yeni ref diskteki overrides'a yazıldıktan ve bağlı
  dosya kanonik depodan bulunabildikten sonraki zaman. **Tarayıcı ilk paint'i
  veya kullanıcıya görünürlük ölçümü değildir.** Gerçek UI ölçümü ana sohbetin
  route/progress entegrasyonuyla Faz 7'de tamamlanmalı.
- `totalMs`: service çağrısının başından sonuna; fixture byte üretimi, mock
  gecikme, doğrulama, kanonik disk/index/ownership yazımı dahil. Modül açılışı,
  disk sonrası oracle doğrulaması ve temizlik hariç. Sentetik PNG üretiminin
  CRC CPU maliyeti dahildir; süreyi yalnız indirmeye atfetmeyin.
- `sampledPeak*`: 5 ms timer + her download/save/commit/link noktasında
  `process.memoryUsage()`. Senkron allocation/free arasındaki zirveler kaçabilir;
  external belleği için mutlak sınır kanıtı değildir. `osPeakRssBytes`, süreç
  başlangıcından service bitimine kadar Linux `resourceUsage.maxRSS` (KiB→bayt).
  Force GC ve soğuk OS cache iddiası yok. Ölçüm örnekleri en çok 4.096 kayıttır;
  pik skalerleri örnek listesi dolduğunda da güncellenir.
- Peak commit input: aynı Buffer'a bakan renkleri yalnız bir kez sayan,
  ingest girişindeki benzersiz Buffer toplamı; transport/encoding geçici
  kopyalarını veya gerçek RSS'yi temsil etmez. Küçük `retention` senaryosundaki
  128 KiB `diagnosticBudgetBytes` ürün varsayılanı veya kabul eşiği değildir.

Ortam: Linux x64, Node 24.19.0, CPU kotası 4, bellek kotası 16 GiB. Kesin
ortam, fixture, runtime ve harness SHA'ları `artifacts/before/cohort-metadata.json` içinde.
Üç taze süreç aynı ortamda ardışık çalıştı; başka test/ölçüm eşzamanlı koşmadı.
`/tmp/buyer-log-performance.lock` ikinci collector'ı reddeder; farklı araçların
bu kilide uyması ayrıca koordinasyon gerektirir.

## Kanıt ve sonuç

Son kabul edilen **tanı** kohortu: `artifacts/before/summary.json` ve üç ham
`before-N.stdout.json.gz`; her koşunun tüm döndürülmüş Node trace parçaları gzip
olarak saklı. Trace'ler service penceresinin yanında açılış, oracle ve temizliği
de içerir; service süreleri JSON collector'dan gelir.

| Koşu | OS peak RSS (MiB) | Sampled peak external (MiB) | İlk kanonik link (sn) | Service toplam (sn) |
| --- | ---: | ---: | ---: | ---: |
| Before 1 | 662,41 | 412,12 | 18,290 | 18,312 |
| Before 2 | 639,84 | 411,84 | 16,832 | 16,856 |
| Before 3 | 664,11 | 412,40 | 17,261 | 17,282 |
| **Before medyan** | **662,41** | **412,12** | **17,261** | **17,282** |
| After | Faz 7 bekliyor | Faz 7 bekliyor | Faz 7 bekliyor | Faz 7 bekliyor |

Üçünde de 2.048 başarılı indirme, tek commit, ilk link anında 2.048 tamamlanmış
indirme, orders revision deltası 1, commit girişinde **340 MiB** benzersiz Buffer.
Bütün kanonik linkler tekrar okunup fixture hash'iyle doğrulandı. Bellek
O(tüm indirilen bayt) gözlemi tekrarlanıyor; üretim sınırı veya kazanç ispatı yok.

`artifacts/evidence-audit.json` her nihai trace'in iki parçasını, bütünlük
hash'lerini ve başlangıç olaylarının korunduğunu doğrulayan kontrol sonucudur.
Ham stdout/cohort JSON'ları inceleme diff'ini küçük tutmak için sonradan,
byte-eşit roundtrip kontrolüyle gzip'lendi; `cohort-metadata.json` okunabilir
özetidir. Collector yeni çıktıda düz JSON üretir. Arşivlenen kohortu araca
vermek için önce ayrı bir geçici dizine açın; kanıt klasörünü değiştirmeyin.

İlk üç koşu `artifacts/initial-partial-trace/` altında korunur. Collector ilk
denemede sabit trace adı kullandığı için Node rotasyonu önceki parçaları ezdi.
Bu serinin bellek JSON'ları geçerli gözlemlerdir, fakat eksik trace nedeniyle
ana kanıt/medyan tablosuna karıştırılmaz. Düzeltme bütün `${rotation}` parçalarını
ayrı saklar, JSON/gzip roundtrip ve SHA kontrolü yapar. Regresyon testi iki trace
parçasının da korunmasını ve eksik trace'in hata vermesini sınar.

İlk harness RED log'u (eksik collector) `artifacts/harness-red.txt.gz` içinde;
bu **üretim bütçe davranışının RED→GREEN kanıtı değildir**. Üretim davranışı
değişmedi. Faz 7 bütçe davranışı testleri önce mevcut kodda RED, uygulamada
GREEN olmak zorunda. Mevcut test ve validator'lar değiştirilmedi.

## Tekrar üretme / Reproduction

Repo kökünden, başka ölçüm/test çalışmazken; her çağrı için yeni çıktı dizini:

```sh
node resources/app/scripts/benchmark-plm-image-memory.js before /tmp/int03-before-fresh
# Faz 7 sonrası committed aday kaynakta, AYNI harness/fixture/ortam ile:
node resources/app/scripts/benchmark-plm-image-memory.js after /tmp/int03-after-fresh
node resources/app/scripts/benchmark-plm-image-memory.js compare /tmp/int03-before-fresh /tmp/int03-after-fresh
```

Her kol üç koşudur; medyan ancak üç başarılı, oracle-eşdeğer koşuda hesaplanır.
Eksik after, iki aynı kaynak, fixture/harness/korunan kaynak/ortam farkı, #892
atalığı eksikliği veya sayısal olmayan metrik karşılaştırmayı reddeder. Başarısız
stdout/stderr/trace yerinde kalır; aynı dizine yeniden yazılmaz. Bu araç bir
performans kabul veya tam eşdeğerlik validator'ı değildir.

#885 sonrası Main değişeceğinden mevcut before nihai Faz 7 kabul bazı değildir.
Güncel before ve aday after aynı #892 ve aynı Main/compute entegrasyonlarını
içerecek şekilde tekrar alınmalı. Korunan kaynak hash'i değişirse eski kohort
ile kıyaslama yapmak yerine güncel kaynakta yeni before+after alınır.

## Doğrulama ve kalan kapılar

Yeni testler gerçek kanonik disk yolu üzerinde manuel koruma, URL dedup,
farklı URL'lerde aynı içerik dedup, no-op ikinci koşuda indirme/revision sabitliği,
kısmi hata, iptal, dropOldFiles true/false, başka anahtarın tuttuğu eski ref ve
patch hatasında dosya rollback/ownership/revision korumasını sınar. Collector
testi bug'ın sürmesini zorunlu tutmaz; mevcut biriktirmenin kesin kanıtı ham
ölçümlerde kalır. Bütün üretim dosyaları, mevcut testler ve i18n baseline aynı.

Son kontroller: **16 dosya / 123 test PASS**, fail/skip/cancel/todo=0 (10 yeni
hazırlık testi dahil); i18n **0 yeni / 0 baseline**; mevcut **32 release-note
PASS**. Ham loglar `artifacts/targeted-tests.txt`, `i18n.txt`, `release-notes.txt`.
`comparison-pending.txt` eksik after kolunun bilerek reddedildiğini gösterir;
başarısız zorunlu test diye gizlenmez veya after kabulü sayılmaz.
Tam regresyon bu hazırlıkta çalıştırılmadı; aşağıdaki zorunluluk sürüyor.

Faz 6 / son program PR'ında #885 sonrası sabit Main+uygulama SHA'sında
`resources/app` içinden filtresiz **npm test zorunlu**. Hedefli test, hızlı PR
checks veya bu collector tam regresyonun yerine geçmez. Kod değişirse ilgili
kontroller ve etkilenen ölçümler yenilenir. Eşdeğerlik, yetki, veri kaybı veya
zorunlu kırmızı kontrol varsa ilerleme durur. i18n baseline boş kalır.

Ürün/UI değişikliği bulunmadığından bu hazırlığa sürüm notu/screenshot eklenmedi.
Gelecekte görünür değişiklikte kendi TR/EN release-note kaydı, gerçek post-change
PNG ve görüntünün agent/insan incelemesi zorunlu. Motion+, reduced-motion,
canonical alanlar ve TR/EN sözleşmeleri korunacak.

Tek bağımsız P1 Claude incelemesi için kullanıcı üzerinden verilecek paket:
[claude-handoff.md](claude-handoff.md). Henüz gönderilmedi veya incelenmedi.
Üretim entegrasyonu isteği de bu pakette; bu dal `server.js`/compute'a dokunmaz.

EN: This is a synthetic diagnostic rehearsal, with a three-run baseline and a
guarded future before/after collector. No byte budget, backpressure or small
commits have been enabled in production. Browser visibility, a production after
cohort, Phase 7 behavioral RED→GREEN, and Phase 6 final full regression remain
pending. Main/server/compute integration belongs to the main chat. No independent
Claude review has occurred, and no merge, TEST or STABLE release is authorized.
