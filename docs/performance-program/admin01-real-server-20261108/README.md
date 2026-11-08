# ADMIN-01 — gerçek Buyer Log sunucusunda tanı

Üretim kaynağı `1796193f0a57c7785e7bf9fdb3557e33c550b25e`.
Dal `diag/admin01-real-server-20261108`. Üretim optimizasyonu ve worker
entegrasyonu yapılmaz. Yedekleme yalnız ve yedekleme + interaktif GET yükü
ayrı senaryolardır; kod önce/sonra kıyası veya hızlanma iddiası değildir.

**Tamamlandı:** [sonuçlar ve worker kararı](RESULTS.md),
[dokuz koşunun özeti](cohort-v3/summary.json),
[14 dosya / 80 test + i18n doğrulaması](validation-v1.json).

## Devralınan hazırlık

[#896](https://github.com/clbiez/Buyer-Log-Desktop/pull/896), commit
`04de59cdcfa959eab9923b9566ee09373daddee2` değişmeden devralındı.
[inheritance.json](inheritance.json) bütün devralınan dosyaların byte SHA-256
kimliğini ve eski yollarını kaydeder. Eski profiller, başarısız loglar, fixture
üreticisi ve dokuz güvenlik/restore testi korunur. Eski altı sentetik HTTP koşusu
yeniden çalıştırılmaz. `inherited/README.md` tarihsel hazırlık raporudur;
oradaki `/api/health` yokluğu eski baz için geçerlidir.

Yeni adapter, devralınan aynı fixture üreticisini bir kez çağırır; fixture SHA:
`18daf1cf78dba1b7e46be23c501333248b6e7ce31f207a7e7fa362ffdf42d8df`.
8 × 32 MiB dosya, 16 MiB buffer, boş dosya ve `123456789` vektörü:
272 MiB + 9 byte. Byte eşitliği doğrulanır. Gerçek full-backup servisi
dosya sistemini topladığı için 16 MiB buffer da disk dosyası olarak
`local/admin01-payload/` altına konur. Gerçek arşivde bütün bu dosyalar veri
aşamasındadır; hazırlıktaki buffer/settings aşaması ve eski arşiv manifestiyle
tam arşiv eşitliği ileri sürülmez.

Overview/Orders için mevcut `resources/app/scripts/generate-demo-data.js:build`
kullanılır: 30.000 satır, seed 7, sabit tarih `2026-11-07`. Hiçbir kaynak veri
dizini dışarıdan alınmaz. Normal ilk moderatör parola kurulumu, login ve tek
refresh POST ile yeni sunucu seed'i hazırlanır. Bu sunucu verisi #896'nın salt
binary arşiv fixture'ına eklenen tanı girdisidir. Excel kaynakları ve payload
hazırlık hatasından sonra tekrar üretilmez; aynı hash'li byte'lar devralınır.

## Yöntem ve sınırlar

- Bütün ölçüm/test komutları makine çapındaki
  `flock -n -E 75 /tmp/buyerlog-performance-measurement.lock` altında çalışır.
  Kilit doluysa komut 75 ile çıkar; paralel koşu veya kilit silme yoktur.
- Her koşu taze gerçek `resources/app/server/server.js` sürecidir. Uygulama,
  auth, local DB, config, HOME/cache ve temp alanları yalnız yeni demo köküne
  yönlendirilir. Ortam allowlist ile kurulur; gerçek credential veya bağlı
  servis ayarları miras alınmaz. Paylaşılan hub/merkezi IAM yapılandırılmaz;
  normal yerel yetki akışı çalışır. Guard, validator ve kaynak değişimi
  kontrolleri değiştirilmez.
- Giriş öncesi Orders GET'in 401/403 verdiği doğrulanır; sonra sentetik
  moderatör normal parola ile giriş yapar. Hiçbir POST otomatik tekrar
  denenmez. Ölçüm koşusunda yalnız bir login ve bir full-backup POST vardır.
- Her işlemden önce disk/bellek admission vardır. Koşu başına en az 3 GiB
  serbest disk ve 4 GiB cgroup bellek boşluğu aranır; seed hazırlığında disk
  eşiği 5 GiB'dir. Başka worktree/kanıt silinmez. Runtime büyük dosyaları
  `runtime/` altında yerinde tutulur, Git'e eklenmez.
- İki senaryonun sırası A1/B1/B2/A2/A3/B3. A = yalnız yedekleme + health
  probu; B = yedekleme + health + yetkili Overview/Orders GET. Ardından üç
  ayrı dar CPU profili alınır; bunlar gecikme medyanlarına katılmaz.
- Startup hydration tamamlandıktan sonra 10 saniye beklenir; gerçek local
  DB boyutu/mtime'ının ayrıca en az 3 saniye sabit kalması aranır. Yazıcı
  durdurulmaz ve snapshot kontrolü gevşetilmez. Seed ve her koşu normal
  startup/refresh arka plan işlerini çalıştırır.
- HTTP istemcisi sunucudan ayrı Node sürecidir. Health her 10 ms, her
  projection her 500 ms gönderilir; yanıt bitişi beklenerek yeni isteğin
  zamanlanması ertelenmez. En fazla 100 bekleyen isteğe izin verilir; aşım
  hata olarak saklanır. Başlangıç ve planlanan gönderim saatleri ham JSON'dadır.
- Gerçek `/api/health` için 200 ve `{ok:true,app:'Buyer Log'}` doğrulanır.
  Interaktif uçlar `/api/page-projection/overview` ve
  `/api/page-projection/orders`; `Accept-Encoding: gzip` ve normal session
  cookie kullanılır. Gecikme tam HTTP body teslimini içerir; renderer
  parse/render süresini içermez. Cookie ve parola kanıtlara yazılmaz.
- Projection'lar ölçümden önce normal GET ile ısıtılır. Her yanıtın sıkıştırılmış
  byte SHA'sı ve generation başlığı başlangıç yanıtına eşit olmalıdır.
  Başlangıç/bitiş JSON parse kontrolleri ölçüm dışındadır: iki projection da
  30.000 satır, aynı generation, source revision ve store revision'ları
  taşır. Kaynak XLSX ve payload hash'leri de önce/sonra doğrulanır.
- Yalnız sunucuda `backupService.create` çevresinde forwarding observer
  preload'u vardır. Aynı factory, girdi, onProgress callback'i, sonuç ve hata
  yolu korunur. Gerçek API route'u, servis, arşivleme, snapshot, doğrulama ve
  rename çalışır. Zaman penceresi gerçek `create` başlangıç/bitişidir;
  HTTP POST→hazır süresi ayrıca verilir.
- Sunucu ana event loop'undaki 10 ms timer yalnız belleğe gap kaydeder.
  Operasyonu kesen tam aralıklar korunur; nominal 10 ms aralık gap'e dahildir.
  p50/p95/max timer gap, HTTP gecikmesinden farklı metriktir. JSON/log I/O'su
  ölçüm bitince yapılır. Observer overhead'i çıkarılmaz; iki senaryoda aynıdır.
- CPU, `process.cpuUsage` user+system farkıdır. Node sürecindeki thread'leri
  içerir; ayrı compute alt süreçlerini içermez. Dış süreçten 50 ms `/proc`
  poll'u parent ve alt süreç RSS/CPU tick'lerini saklar. Parent sampled peak,
  eşzamanlı süreç ağacı RSS toplamı ve lifetime maxRSS ayrı tutulur; RSS
  toplamı paylaşılan sayfaları tekrar sayabilir. 50 ms örnekleme ara tepeleri
  kaçırabilir. Heap/external/arrayBuffer başlangıç/bitiş değerleri de kayıttadır.
- CRC/SHA için profiler yalnız backup `create` çevresinde açılır; 1 ms V8
  örneklemesi, `snapshotEntry`/`validateZip` ancestry ile ayrılır. Örneklenmiş
  self süre, pencereye göre yüzde ve idle payı raporlanır; kesin fonksiyon
  timer'ı veya süreç CPU toplamı diye sunulmaz.
- Başarı sonrası API'den indirilen gerçek arşiv yeniden CRC/SHA/manifest
  doğrulamasından ve staging extract'ten geçer. Manifestteki her dosyanın
  restore sonrası byte SHA ve boyutu eşleşmelidir. Bu doğrulama backup/HTTP
  ölçüm penceresinin dışındadır; canlı restore apply yapılmaz.
- Linux/overlayfs, sıcak OS cache ve hazır projection yolu ölçülür. Windows,
  Electron, SMB, soğuk cache, aktif iş yazmaları, çok kullanıcılı yoğun yük
  ve görünür ekran render gecikmesi için genelleme yapılmaz. GC zorlanmaz.

## Saklanan başarısız denemeler

İlk sandbox hazırlığı `spawnSync df EPERM` ile admission sırasında durdu;
fixture/POST yoktu. Dış yürütmede normal auth kökü yanlışlıkla sunucu veri
alanının dışında seçilmişti; login 500 verdi. Yeni kökte auth normal
SERVER_DATA_ROOT'a alındı, güvenlik değiştirilmedi. Bu yeni bağımsız kurulumun
POST'u önceki job'un tekrarı değildir.

`cohort-v1` sunucu başlamadan adapter değişken adı çakışmasıyla durdu.
`cohort-v2` gerçek startup DB hydration sırasında kaynak değişimini gördü:
`Backup snapshot tamamlanmadan kaynak değişti: system/local-data/BuyerLogLocal.db`.
Arşiv başarı sayılmadı. Final yöntem startup ve DB durulmasını bekler.
Başarısız JSON, istemci denemeleri, observer çıktısı ve loglar korunur;
uygulamanın hata durumunda kendi sildiği geçici snapshot'ı koruma amacıyla
üretim temizliği değiştirilmez.

Üçüncü dar profil başlamadan önce `memory.current` nedeniyle 4 GiB boşluk
admission'ı reddetti. Sunucu ve POST başlamadı. Başarısız admission JSON/log'u
`cohort-v3/profile-3-admission-failed/` ve `profile-3.driver.log` içinde.
Yalnız tamamlanmış kendi koşularımızın runtime dosyalarına `fsync` ardından
`POSIX_FADV_DONTNEED` uygulandı: dosya byte'ları, boyut ve mtime değişmedi;
728 dosya korundu, hiçbir dosya silinmedi. Seed, sonraki koşu ve diğer
worktree'lerin cache'i hedeflenmedi. `memory.current` 13.661.286.400'dan
1.512.562.688 byte'a indi; [cache-admission.json](cache-admission.json).
Eşik düşürülmedi. Üçüncü profil yeni bağımsız kökte geçti. Altı ana ölçüm
bu işlemden önce bitmişti. Bu müdahale dar profil yorumunun sınırı olarak
saklanır; soğuk cache veya önce/sonra kıyası değildir.

## Tekrar üretme

Repo kökünde, her seferinde yeni çıktı isimleri kullanın. Node ve mevcut app
bağımlılıkları gerekir. `inherited/resources/app/server` ve `public` symlink'leri
aynı repodaki salt okunur üretim kaynaklarını gösterir.

```sh
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  node scripts/prototypes/admin01-real-server-20261108/run.cjs prepare \
  docs/performance-program/admin01-real-server-20261108/runtime/repro-seed

# 16 GiB ortamda saklanan eski dosya cache'i admission'ı doldurmasın diye
# tamamlanan bu yeni koşuların cache'ini dosyaları silmeden bırakın.
set -e
diag=docs/performance-program/admin01-real-server-20261108
proto=scripts/prototypes/admin01-real-server-20261108
test ! -e "$diag/cohort-repro"
mkdir "$diag/cohort-repro"
for spec in backup-only:1 backup-interactive:1 backup-interactive:2 backup-only:2 backup-only:3 backup-interactive:3 profile:1 profile:2 profile:3; do
  scenario=${spec%:*}; ordinal=${spec#*:}; name=$scenario-$ordinal
  flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
    node "$proto/run.cjs" run "$diag/runtime/repro-seed" \
    "$diag/cohort-repro/$name" "$scenario" "$ordinal" \
    > "$diag/cohort-repro/$name.driver.log" 2>&1
  flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
    python3 "$diag/reclaim-completed-cache.py" "$diag/cohort-repro" \
    "$diag/cohort-repro/cache-$name.json"
done
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  node "$proto/analyze.cjs" "$diag/cohort-repro"

flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  node "$diag/validate.cjs" validation-repro
```

Seed hazırlığı fixture materyalizasyonu + normal API hazırlığıdır; eski #896
hazırlık benchmark serisini yeniden çalıştırmaz. Eski hazırlık profilleri
`inherited/artifacts/cohort-v1/` altındadır. Yeni CPU profilleri ve bütün
başarılı/başarısız HTTP girişimleri her koşunun kendi dizinindedir.

Final ana seri, `series.sh runtime/seed-v3 cohort-v3` ile çalıştı. Yukarıdaki
tekrar komutu admission için her tamamlanan koşunun dosya cache'ini ayrıca
bırakır; final seride bu yalnız üçüncü dar profilden önce gerekli oldu.
Ölçülen harness dosyaları final seriden sonra değiştirilmedi.

EN: Diagnostics only on the real Buyer Log server with verified synthetic data,
normal local authentication and unmodified production sources. Three independent
backup-only runs, three backup-plus-interactive-GET runs and three separate narrow
profiles. Scenarios are not code before/after results. Historical #896 preparation
and failures are retained. No worker integration, PR, merge, independent review
or TEST/STABLE publication is performed.
