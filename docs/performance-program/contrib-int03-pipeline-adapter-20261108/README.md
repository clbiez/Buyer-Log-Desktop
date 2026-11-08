# INT-03 pipeline adapter prototipi

Dal: `contrib/int03-pipeline-adapter-20261108`.
Sabit başlangıç: `prep/phase6a-wiring-handoff-20261108`,
`ea49389836dba23f0970a974b4c0185f1b36ec0e`.
Devralınan katkı: `contrib/int03-byte-budget-20261108`,
`5a5b4f5e2b82d3f4584a818221b7d27a1c487d8a`.
Ayrı worktree: `/workspace/int03-pipeline-adapter-20261108`.

**Üretime bağlı değildir. INT-03 üretim kabulü değildir.** Yalnız izin verilen
iki dizine yazıldı. Üretim, compute, dağıtım/shared store, kilitli dosyalar,
mevcut test/assertion/timeout/validator ve boş i18n baseline değişmedi.
Yeni worker, concurrency artışı veya görsel kabul tavanında küçültme yok.
PR/merge/rebase/force-push, bağımsız inceleme ve TEST/STABLE başlatılmadı.

## Değişen davranış

Gerçek queue/sync/ingest fonksiyonlarının aday kopyaları prototip dizinindedir.
Queue retry/URL/MIME ve sync metadata/seçim/byUrl planı kullanılır. Mevcut
budget yardımcı kodu sabit Git blob'undan **aynen** yüklenir; helper veya #899
hazırlığı yeniden uygulanmadı, üretim ağacına taşınmadı.

`results` ve `ready` artık Buffer yerine özel staging dosyası handle'ı taşır.
İki sync işi aynı runtime/budget instance'ını paylaşır. Tam envelope GET'ten
önce alınır; transport/body/chunks/concat/validation/staging ve commit buffer
kullanıcıları settle olmadan bırakılmaz. Retry aynı envelope'u kullanır.
Kanonik commit serializer'ında staging birer dosya okunur; hash dedup tablosu,
created rollback listesi ve tek final revision/CAS patch sınırı korunur.
Bütün indirmelerin bitmesini Buffer/permit tutarak bekleyen bir döngü yoktur.

Manual ownership, explicit overwriteManual, source cache, URL/content dedup,
partial save/download failure, disk checkpoint/resume, patch rollback ve
future/aliased old-ref cleanup test edilir. Async kanonik beklemelerde manual
writer araya girerse güvenli CAS conflict ve toplu rollback oluşur; ownership-only
unchanged girişleri de son kontrolden geçer. Bu yeni async sınırın üretim/P1
incelemesi ana sohbettedir.

## Nihai AB / BA / AB ölçümü

Linux / Node v24.19.0. Aynı geçerli 1×1 PNG fixture'ından **2.048 değişken
boyutlu görsel**, iki eşzamanlı sync işi, iş başına mevcut concurrency 8.
Boyutlar 8/32/128/512 KiB; toplam 340 MiB. Her canonical save için her iki kolda
aynı 1 ms sentetik disk gecikmesi. Commit sırasında gerçek collection-image
save/decode, dosya index'i ve db.patchPlmImageLinks kullanılır. Başlangıç before
queue/sync/ingest üretim kaynaklarıdır; iki kolun stream transport/strict length
validation harness'i aynıdır. Bu, dokunulmamış üretim HTTPS hattının uçtan uca
ölçümü değildir. Gerçek PLM ağı/kimlik bilgisi/veri kullanılmaz; network fail-closed.

İki kola da aynı başlangıç ownership snapshot nesnesi enjekte edilir. Bu
koşul ve kaynak pins/hash'leri ham JSON/manifestlerde açıkça kayıtlıdır.
Üretimin genel çoklu writer eşdeğerliğine genişletilmez.

Altı ayrı süreç sırası: before, after / after, before / before, after.
Aşağıdaki değerler kol başına üç koşunun medyanıdır:

| Ölçüt | Before | Aday |
| --- | ---: | ---: |
| OS peak RSS | 646.55 MiB | 355.98 MiB |
| Örneklenen peak external | 393.24 MiB | 73.89 MiB |
| Örneklenen peak arrayBuffers | 390.76 MiB | 71.41 MiB |
| Peak reservation | 0.00 MiB | 328.67 MiB |
| Peak disk staging | 0.00 MiB | 340.00 MiB |
| İlk kalıcı kanonik link | 11.64 s | 12.90 s |
| Toplam süre | 34.65 s | 37.40 s |

RSS **%44,9**, örneklenen external **%81,2** azaldı. Toplam süre **%8,0**,
ilk kalıcı link süresi **%10,8** arttı. Bütçe küçük görsellerde de 20 MiB bilinmeyen
uzunluk envelope'u ayırdığı ve staging ek I/O yaptığı için bu ödünleşim beklenir;
tek koşu/az örnekle üretim performansı tahmini yapılmaz.

Before reservation 0, bütçe uygulanmadığı anlamındadır. **Reservation RSS
 değildir. İlk kalıcı link UI görünürlüğü değildir.** Staging tek final patch'i
koruduğu için ilk linki erkene çekmez; erken link için revision/atomicity ürün
sözleşmesini açıkça genişletmek gerekir.

Altı koşuda: completed/completed, hata 0, dosya sayısı 2.048, job başına bir
patch (toplam revision +2), çıktı/ownership/outcome hash'leri eşit. Son durumda
reserved byte, aktif permit, waiter, izlenen Buffer sahibi, staging byte ve
scope sayısı sıfır; bütün transport kullanıcıları settle olmuştur. External
belleğin sıfıra inmesi veya GC/RSS'nin anında düşmesi iddia edilmez.

## Kısmi hata ve iptal çiftleri

Ayrıca aynı 48 görsellik değişken fixture için her senaryoda üç dönüşümlü çift
(12 süreç) çalıştı. Partial: bir gövde geçersiz MIME. Cancel: bütün indirmeler
bitmişken ilk canonical save sırasında iptal; başlamış kanonik işlem tamamlanır.
Status, hata listesi, final içerik hash'i, revision, checkpoint ve temiz kapanış
iki kolda eşittir. Aktif transport/admission iptali ayrıca gate testleriyle
sınanır; farklı concurrency'de indirme sırasında iptal edilen subset'in byte-byte
aynı olacağı iddia edilmez.

| Senaryo / ölçüt | Before | Aday |
| --- | ---: | ---: |
| partial / RSS | 99.62 MiB | 97.18 MiB |
| partial / External | 44.29 MiB | 36.28 MiB |
| partial / Reservation | 0.00 MiB | 328.67 MiB |
| partial / İlk link | 479.41 ms | 502.06 ms |
| partial / Toplam | 501.52 ms | 528.86 ms |
| cancel / RSS | 100.94 MiB | 98.78 MiB |
| cancel / External | 44.34 MiB | 36.28 MiB |
| cancel / Reservation | 0.00 MiB | 328.67 MiB |
| cancel / İlk link | 478.34 ms | 518.38 ms |
| cancel / Toplam | 502.34 ms | 544.26 ms |

## Doğrulama ve kanıtlar

- `green-final-2.txt`: 23/23 prototip testi. RED gerçek baseline'da aynı
  backpressure assertion'ı ile `red.txt.gz` içinde korunur.
- `helper-tests.txt`: değiştirilmemiş katkı testleri 29/29.
- `preparation-tests.txt`: değiştirilmemiş #899 hazırlık testleri 10/10.
- `native-tests.txt`: 12 ilgili dosya, 99/99 assertion. İlk ortam hatası korunur.
- `i18n.txt`: yeni eksik 0, baseline 0; `i18n-guard.txt` mevcut guard testleri 5/5.
- `measurement-[1-6]-*.json.gz`: kayıpsız ham süreç çıktısı, scalar memory
  samples dahil. `.status.json` uncompressed SHA-256, exit code ve wall time taşır.
- `partial-*` / `cancel-*`: final fault ham sonuçları; `measurement-summary.json`
  ve `fault-measurement-summary.json` hesaplanan medyanlardır.
- `source-manifest.json`, `inherited-source-manifest.json`, `validation.json`
  kaynak/kanıt bağını ve yalnız izinli kapsamı doğrular.
- `failure-notes.md`: başarısız ve superseded kanıtların açıklaması. `attempt-*`
  final medyana katılmaz. Hiçbir mevcut kontrol gevşetilmedi.

Kapasite ilk kontrolde yaklaşık 30 GiB boş disk / 16 GiB kullanılabilir
bellekti. Bütün test ve ölçüm kampanyaları ortak
`flock -n -E 75 /tmp/buyerlog-performance-measurement.lock` altında çalıştı.
Başkasının dosyası veya lock silinmedi. Yalnız kendi sentetik scope'ları temizlendi.

## Yeniden çalıştırma

Repo clone'unda pinned katkı/hazırlık commit'leri yoksa önce getir:

```sh
git fetch origin 5a5b4f5e2b82d3f4584a818221b7d27a1c487d8a b2a4a579c5369f59e5cfb9181140a00176d944ef
# NODE_PATH bu cloud ortamındaki hazır bağımlılıklardır; uygun mevcut kurulumla değiştirilebilir.
export NODE_PATH=/workspace/.buyerlog-tools/node_modules
bash scripts/prototypes/int03-pipeline-adapter-20261108/check.sh
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock python3 scripts/prototypes/int03-pipeline-adapter-20261108/measure.py
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock python3 scripts/prototypes/int03-pipeline-adapter-20261108/measure-faults.py
python3 scripts/prototypes/int03-pipeline-adapter-20261108/validate.py
```

Yeniden ölçmeden önce kapasiteyi kontrol et; mevcut ham dosyaları üzerine yazmadan
arşivle. Bağımlılık kurulumu/üretim değişikliği bu komutların parçası değildir.

## Ana sohbete devir

[Gerçek yaşam döngüsü](source-lifecycle.md) ve
[somut canonical adapter sözleşmesi](canonical-adapter-contract.md) okunmalı.
Root değişiklikleri: süreç ömürlü ortak instance; iptal köprüsü ve Node transport;
bounded disk staging yaşam döngüsü/kota/crash recovery; staged ingest API;
güncel ownership/map ile writer serializer + revision/CAS; route/progress/cache/
publish bağlantıları. Üretim wiring, tam regresyon, gerçek TLS/Windows/Electron
ölçümü ve P1 incelemesi açıktır. 1 MiB native/TLS headroom gerçek platformda
kanıtlanmadı; süreçler arası transaction/ownership crash atomikliği iddia edilmez.

EN: Prototype only. A shared admission budget and bounded disk spool remove
retained image buffers from real queue/sync candidate functions, preserving one
canonical dedup/rollback/revision patch per job. Median RSS and external memory
fall, with slower first durable links and total time. This is not production
acceptance or UI visibility. Root integration and P1 review remain in the main chat.
