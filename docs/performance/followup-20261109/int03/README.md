# INT-03 — PLM görsel indirme/commit bayt bütçesi

Kapsam: [#937, Paket 2 / INT-03](https://github.com/clbiez/Buyer-Log-Desktop/issues/937).
Taban Main: `511cb2fae629cd6e0c1ad31eb773775e5c95841d`.
Dal: `fix/followup-plm-image-budget-20261109`; ayrı worktree: `/workspace/buyerlog-int03`.

## Sorun ve çözüm

`runBounded` worker sonuçlarını saklıyordu. `runPlmImageSync` bütün indirme
sonuçlarından `ready` oluşturduğu için indirme concurrency'si 8 olsa bile işin
tüm görselleri Buffer olarak son commit'e kadar tutuluyordu. [RED](red.log),
12 × 2 MiB görselin tamamının commit öncesinde tutulduğunu gösterir.

Yeni, yalnız bu yola özel helper süreçteki bütün canlı görsel sync işlerine
FIFO ağırlıklı 256 MiB rezervasyon bütçesi uygular:

- İndirme başına 40 MiB: 20 MiB akış parçaları ve 20 MiB birleştirilmiş Buffer.
  Content-Length eksik veya yanlış olsa da baştan azami rezervasyon alınır.
  Parça geldikçe rezervasyon artırmak birden fazla okuyucuyu kilitleyebilirdi.
- Permit, indirme/doğrulama ve özel geçici dosyaya yazma tamamlanana kadar tutulur.
  Kuyruk sonuçlarında yalnız dosya tanımları kalır. Dizin POSIX'te 0700,
  dosyalar 0600'dür; adları kaynaktan/PLM URL'sinden türetilmez.
- Son kanonik commit başına 192 MiB: iki geçici görsel Buffer'ı, 50 MiB mevcut
  orijinal, UTF-16 base64 ve depoya yazımın decoded kopyası için muhafazakâr pay.
  Gerçek kanonik ingest diziyi sırayla okur; `buffer` getter'ı yalnız son okunan
  dosyayı önbellekte tutar. Kopya zarfının dayandığı mevcut 50 MiB limit test edilir.
- Tek son commit korunur. Erken registry/sahiplik yazımı veya eski dosya silme
  eklenmez; iş çapındaki hash dedup ve patch hatasındaki dosya geri alma korunur.
- Permit'ler `finally` ile bırakılır. Kuyruk, aktif HTTP akışı ve retry beklemesi
  mevcut iptal koşulunu yoklar. Başarıyla indirilen alt küme iptalden sonra da
  önceki gibi son commit'e girer; senkron commit ortasından kesilmez.

**Rezervasyon RSS değildir.** Bu bütçe uygulamanın tuttuğu görsel baytları ve
belirtilen geçici kopyalar içindir; GC gecikmesi, ağ/işletim sistemi tamponları,
metadata ve uygulamanın diğer tüketicilerini süreç RSS tavanı olarak sınırlamaz.

## Kanıtlar

- [Hedefli GREEN](targeted.log): standart runner ile 13 dosya, 109 PASS,
  0 FAIL/SKIP/CANCEL. Bunların 11'i INT-03 testidir: iki iş, yavaş commit,
  ağırlıklı kuyruk, queued/active/retry iptali, stream timeout, büyük/bilinmeyen
  uzunluk, disk dolması, registry rollback, içerik/dedup/revision/sahiplik ve
  iş tamamlanmadan silmeme.
- [Gerçek uygulama kabulü](acceptance.json), [ham sunucu logu](acceptance-server.log),
  [tekrar çalıştırılabilir harness](acceptance.cjs): gerçek Buyer Log sunucusu,
  gerçek yerel oturum/izin kapıları, gerçek indirme kuyruğu, ingest, kalıcı depo
  ve Chromium CP Tracker. Yalnız upstream PLM metadata/transport loopback
  sentetik fixture'dır; üretim PLM servisi, credential veya iş verisi kullanılmaz.
  Demo üretici 24 satır üretir; mevcut aktif CP filtresi 21 satır gösterir.
  21 indirme/21 birebir HTTP içerik kontrolü/11 bilinmeyen Content-Length;
  ikinci missing çağrısında 21 cache hit, 0 indirme. UI'da mevcut
  `applySyncedPlmImages` ve `plmSyncRepaintAll` yanıt uygulama yolu kullanılır.
- [Post-change PNG](../../../../resources/app/public/release-notes/next-assets/int03-shared-image-byte-budget-20261109.png):
  gerçek sentetik CP Tracker ekranı, 1600×900. Agent görseli açıp inceledi;
  placeholder yerine indirilen renkli sentetik görseller görünür. Ekran görüntüsü
  bellek metriği kanıtı olarak sunulmaz.
- [Taban dar RSS ölçümü](rss-base.json), [son kaynak dar RSS ölçümü](rss-post.json),
  [harness](measure.cjs): ayrı Node süreçlerinde iki eşzamanlı iş, iş başına
  40 adet 1–5 MiB sentetik görsel (toplam 240 MiB); gerçek kanonik ingest ve
  `saveCollectionImage`. 80 sonuç içerik hash'inin toplu SHA-256'sı eşittir.
  Fixture, decode ölçümü yapmadan ingest'in mevcut raster-imza doğrulamasından
  geçen sentetik baytlar kullanır; gerçek PNG/UI kabulü ayrı harness'tadır.
  Tek yerel örneklem üretim kapasitesi/hızlanması iddiası değildir.
- [i18n](i18n.log): yeni eksik 0, baseline eksik 0. Yeni hata metinlerinde ve
  release note'ta TR/EN çifti vardır; baseline değiştirilmez.
- [Sürüm notu doğrulaması](release-notes.log): 7 kayıt. Eklenen tek ID:
  `int03-shared-image-byte-budget-20261109`. Önceden var olan bütün manifest
  metni byte düzeyinde aynıdır; diğer altı kayıt/asset değiştirilmez.
- [Kaynak manifesti](source-manifest.json): taban, final çalışma dosyalarının
  SHA-256'ları ve runner ortamı. PR son SHA/CI sonucu issue final yorumundadır.

## Tam regresyon ve yeniden çalıştırma

[Tam test ham logu](full-test.log), standart `npm test` ve varsayılan
concurrency=4 ile tek kesintisiz koşudur. Runner bütün batch'leri kendisi sırayla
çalıştırır; batch'ler elle birleştirilmez. Özet final yorumunda ve aşağıdaki
[test-summary.json](test-summary.json) dosyasında yer alır.

Sonuç: **1315 dosya / 10 batch / 9032 PASS / 0 FAIL / 65 SKIP / 0 CANCEL**,
toplam 9097 test; 191,9 saniye, Linux x64 / Node v24.19.0. Skip'ler mevcut
platform/ortam koşullarındandır; yeni INT-03 testlerinde skip yoktur. Bağımlılıklar
mevcut checkout'un node_modules dizininden geçici bağlantıyla kullanıldı;
package/lock veya sürüm güncellemesi yapılmadı, bağlantı commit'e alınmadı.

| Dar ölçüm (iki eşzamanlı iş) | Taban Main | Son kaynak |
| --- | ---: | ---: |
| Örneklenen RSS tepe değeri | 379,6 MiB | 179,4 MiB |
| Commit girişindeki azami eager Buffer kökleri, iş başına | 120 MiB | 0 MiB |
| Ortak rezervasyon tepe değeri | Yok | 240 MiB / 256 MiB bütçe |
| Sonuç içerik hash'leri | 80 | Aynı 80 |

Sıfır eager kök, sıfır bellek demek değildir: lazy cache, aktif indirmeler ve
kanonik yazım kopyaları yukarıdaki rezervasyonlarla kapsanır.

İlk hedefli deneme, varsayılan kullanıcı dizini sandbox dışında olduğu için
`ENOENT /home/agent/.buyer-log/write-recovery` verdi
([ham log](targeted-initial-env-failed.log)). Korumalar/testler değiştirilmedi;
yeniden denemede uygulamanın mevcut ortam değişkenleriyle geçici, yazılabilir
fixture kökleri verildi. İlk tam denemede sarmalayıcının açık TEMP/AUTH override'ı,
testlerin kendi geçici dizinleriyle çakıştı: batch 2'de 8 hata
([ham log](full-test-initial-env-failed.log)). TEMP override'ı mevcut
`os.tmpdir()` yazma iznini daraltıyordu; AUTH override'ı test başına server
kökünü izlemiyordu. Bu iki override kaldırıldı; uygulamanın normal varsayılan
kuralları değiştirilmedi. Önce aynı 6 dosya geçti
([ortam kontrolü](environment-recheck.log)), sonra **bütün** standart koşu
baştan başlatıldı. Bu alt koşu tam test yerine sayılmaz.
[run-tests.cjs](run-tests.cjs) yalnız varsayılan veri köklerini hazırlar,
normal `npm test` çağırır ve bitince fixture'ı temizler.

Repo kökünden:

```sh
flock /tmp/buyerlog-performance-measurement.lock node docs/performance/followup-20261109/int03/run-tests.cjs plm-image plm-colour-image plm-main-option plm-sync-image
flock /tmp/buyerlog-performance-measurement.lock node docs/performance/followup-20261109/int03/acceptance.cjs
flock /tmp/buyerlog-performance-measurement.lock node docs/performance/followup-20261109/int03/measure.cjs --baseline
flock /tmp/buyerlog-performance-measurement.lock node docs/performance/followup-20261109/int03/measure.cjs
flock /tmp/buyerlog-performance-measurement.lock node docs/performance/followup-20261109/int03/run-tests.cjs
```

## Sahiplik, eleştirel diff incelemesi ve sınırlar

Üretim değişikliği yalnız `plm-image-download-queue.js`,
`plm-image-sync-service.js` içindeki `runPlmImageSync` ve benzersiz
`plm-image-byte-budget-int03.js` helper'ındadır. `runPackageImport` değiştirilmez.
Tek benzersiz test, tek release-note kaydı/PNG ve bu dizindeki kanıtlar eklenir.
`server.js`, ingest çekirdeği, PLM auth/transport/BOM kaynakları, IAM, FX,
compute, withRowCache, checklist testi/CI ve genel limitler değiştirilmez.

Aynı agent diff'i bağımsız bir turda permit yaşam döngüsü, Buffer kökleri,
kanonik ingest'in getter'ı okuduğu try/catch sınırı, hash önbelleğinin yalnız
metadata tutması, patch rollback, manuel sahiplik ve silme sırası açısından
inceledi. İkinci model incelemesi yapılmış olarak sunulmaz.

Ödünleşim: görüntü baytları için geçici disk yazma/okuma gerekir. Disk dolması
kısmi sonuç verir; olağan başarı/hata/iptal yolları dosyaları temizler. Süreç
zorla öldürülürse işletim sistemi geçici dizininde özel artık dosyalar kalabilir;
yeni genel recovery/cleanup altyapısı eklenmez. Gerçek kurumsal PLM kapasitesi,
gerçek Windows/Electron kabulü veya üretim RSS tavanı iddia edilmez.
Merge, TEST/STABLE, yayın, dal silme ve issue kapatma yapılmaz.
